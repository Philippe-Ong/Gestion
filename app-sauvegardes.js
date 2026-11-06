// Export all data to JSON
const exportAllData = () => {
    const data = {};
    ALL_TABLES.forEach(table => {
        data[table] = DB.get(table) || [];
    });
    data.syncConflicts = v11GetQueue().filter(op => op.blockedReason);
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const date = new Date().toISOString().split('T')[0];
    downloadBlob(blob, `sauvegarde_${date}.json`);
    showToast('Sauvegarde créée');
};

// Import all data from JSON
// ---------------------------------------------------------------------------
// Capture l'état local (localStorage + caches mémoire V11) AVANT toute écriture,
// puis applique les DB.set séquentiellement. Si une étape échoue (DB.set renvoie
// autre chose que true ou lève), rollback synchrone immédiat : restauration des
// valeurs brutes localStorage (clé absente si elle n'existait pas au départ),
// de V11._localCache, V11._versions, queue, versions, invalid tables et
// _memoryProtectedTables. Aucune ré-entrée dans DB.set pendant le rollback.
// ---------------------------------------------------------------------------
const _importSnapshotLocalStorage = (keys) => {
    const snap = {};
    for (const k of keys) {
        const raw = localStorage.getItem(k);
        snap[k] = { existed: raw !== null, raw };
    }
    return snap;
};
const _importRestoreLocalStorage = (snap) => {
    for (const k of Object.keys(snap)) {
        const entry = snap[k];
        if (entry.existed) {
            try { localStorage.setItem(k, entry.raw); }
            catch (e) { console.error('Import rollback: setItem failed for', k, e); }
        } else {
            localStorage.removeItem(k);
        }
    }
};
const _importCloneLocalCache = () => {
    const out = {};
    for (const t of Object.keys(V11._localCache || {})) {
        out[t] = JSON.parse(JSON.stringify(V11._localCache[t]));
    }
    return out;
};
const _importCloneVersions = () => JSON.parse(JSON.stringify(V11._versions || {}));

const validateImportData = (data) => {
    const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
    const hasField = (record, field) => Object.prototype.hasOwnProperty.call(record, field);
    const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
    if (!isRecord(data)) return { valid: false, reason: 'La sauvegarde doit être un objet' };

    const numericFields = {
        employees: ['tauxHoraire'],
        formats: ['contenanceCl'],
        lots: ['quantite'],
        pointages: ['pause'],
        inventaire: ['quantite', 'seuilAlerte'],
        livraisons: ['caissesVertesLivrees', 'caissesNoiresLivrees'],
        history: ['quantity']
    };
    const nestedFields = {
        recettes: { ingredients: true },
        inventaire: { lots: false },
        history: { ingredients: false },
        commandes: { items: true, lotsUtilises: false },
        livraisons: { lignes: true, lotsTraces: false }
    };
    const tables = ALL_TABLES.filter(table => hasField(data, table));
    if (tables.length === 0) return { valid: false, reason: 'Aucune table reconnue dans la sauvegarde' };

    for (const table of tables) {
        if (!Array.isArray(data[table])) {
            return { valid: false, reason: `« ${table} » doit être un tableau` };
        }
        for (const [index, record] of data[table].entries()) {
            const path = `${table}[${index}]`;
            if (!isRecord(record)) return { valid: false, reason: `« ${path} » doit être un objet` };
            if (table === 'commandes' && hasField(record, 'clientLivraison') && record.clientLivraison !== null && !isRecord(record.clientLivraison)) {
                return { valid: false, reason: `« ${path}.clientLivraison » doit être un objet` };
            }
            for (const field of numericFields[table] || []) {
                if (hasField(record, field) && !isNumber(record[field])) {
                    return { valid: false, reason: `« ${path}.${field} » doit être un nombre fini` };
                }
            }
            for (const [field, required] of Object.entries(nestedFields[table] || {})) {
                if (!required && !hasField(record, field)) continue;
                if (!Array.isArray(record[field])) {
                    return { valid: false, reason: `« ${path}.${field} » doit être un tableau` };
                }
                for (const [childIndex, child] of record[field].entries()) {
                    const childPath = `${path}.${field}[${childIndex}]`;
                    if (!isRecord(child)) return { valid: false, reason: `« ${childPath} » doit être un objet` };
                    if (hasField(child, 'quantiteRecue') && !isNumber(child.quantiteRecue)) {
                        return { valid: false, reason: `« ${childPath}.quantiteRecue » doit être un nombre fini` };
                    }
                    if (!isNumber(child.quantite)) {
                        return { valid: false, reason: `« ${childPath}.quantite » doit être un nombre fini` };
                    }
                }
            }
        }
    }
    return { valid: true, tables };
};

// Libellés des tables pour le bilan de restauration
const IMPORT_TABLE_LABELS = {
    employees: 'employés', aromes: 'arômes', formats: 'formats', recettes: 'recettes',
    clients: 'clients', lots: 'lots', commandes: 'commandes', pointages: 'pointages',
    inventaire: 'articles d\'inventaire', livraisons: 'BL', history: 'mouvements d\'historique', todos: 'tâches'
};

// Bilan d'une restauration par rapport aux données locales : ce que DB.set
// enverra au cloud (ajouts, modifications, suppressions par table).
const _importBilan = (data, tables) => {
    let ajouts = 0;
    let modifications = 0;
    let suppressions = 0;
    const detail = [];
    for (const table of tables) {
        const actuels = new Map(DB.get(table).map(r => [r.id, r]));
        const idsFichier = new Set();
        for (const rec of data[table]) {
            idsFichier.add(rec.id);
            const actuel = actuels.get(rec.id);
            if (!actuel) ajouts++;
            else if (JSON.stringify(actuel) !== JSON.stringify(rec)) modifications++;
        }
        const supprimes = [...actuels.keys()].filter(id => !idsFichier.has(id)).length;
        if (supprimes > 0) detail.push(`${supprimes} ${IMPORT_TABLE_LABELS[table] || table}`);
        suppressions += supprimes;
    }
    return { ajouts, modifications, suppressions, detailSuppressions: detail.join(', ') };
};

// Écriture des tables restaurées, une fois la restauration confirmée.
const _importAppliquer = (data, tablesToImport) => {
    try {
        // ----- SNAPSHOT pré-écriture : tout ce que DB.set peut modifier -----
        const dataKeys = tablesToImport.map(t => 'thecol_' + t);
        const metaKeys = [V11.QUEUE_KEY, V11.VERSIONS_KEY, V11_INVALID_TABLES_KEY];
        const snap = _importSnapshotLocalStorage([...dataKeys, ...metaKeys]);
        const cacheSnap = _importCloneLocalCache();
        const versionsSnap = _importCloneVersions();
        const memoryProtectedSnap = new Set(V11._memoryProtectedTables);

        let count = 0;
        let failed = false;
        // Séquentiel (pas forEach) pour court-circuiter dès qu'un appel
        // renvoie autre chose que true ou lève.
        for (const table of tablesToImport) {
            let result;
            try {
                result = DB.set(table, data[table]);
            } catch (writeErr) {
                console.error('Import rollback:', writeErr);
                failed = true;
                break;
            }
            if (result !== true) {
                console.error('Import rollback: DB.set a retourné une valeur inattendue pour', table, result);
                failed = true;
                break;
            }
            count++;
        }

        if (failed) {
            // -------- ROLLBACK synchrone --------
            // Restaurer localStorage (tables + métadonnées V11) en écrivant
            // directement, sans repasser par DB.set (qui enfilerait de
            // nouvelles opérations V11 et piétinerait le rollback).
            _importRestoreLocalStorage(snap);
            // Restaurer les caches mémoire V11 depuis les clones capturés.
            V11._localCache = cacheSnap;
            V11._versions = versionsSnap;
            V11._memoryProtectedTables = memoryProtectedSnap;
            showToast(
                `Restauration annulée : une erreur est survenue pendant l'écriture des tables. Aucune modification n'a été appliquée.`,
                'error'
            );
            // Pas de router(), pas de toast de succès.
            return;
        }

        showToast(`${count} tables restaurées`);
        router();
    } catch (err) {
        console.error('Import rollback:', err);
        showToast('Erreur lors de la restauration', 'error');
    }
};

const importAllData = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        let data;
        try {
            data = JSON.parse(e.target.result);
        } catch (err) {
            console.error('Import:', err);
            showToast('Erreur: fichier invalide', 'error');
            return;
        }
        const importValidation = validateImportData(data);
        if (!importValidation.valid) {
            showToast(`Restauration annulée : ${importValidation.reason}.`, 'error');
            return;
        }
        const tablesToImport = importValidation.tables;

        for (const table of tablesToImport) {
            const validation = v11ValidateTable(table, data[table]);
            if (!validation.valid) {
                showToast(
                    `Restauration annulée : données invalides dans « ${table} » (${validation.reason}).`,
                    'error'
                );
                return;
            }
        }

        // Chaque table du fichier remplace la table actuelle sur tous les appareils :
        // bilan avant confirmation, puis sauvegarde de l'état actuel avant écriture.
        const bilan = _importBilan(data, tablesToImport);
        confirmDialog(
            `Restaurer « ${file.name} » ? Les données actuelles seront remplacées sur tous les appareils : `
            + `${bilan.ajouts} ajout(s), ${bilan.modifications} modification(s), ${bilan.suppressions} suppression(s)`
            + `${bilan.detailSuppressions ? ` (${bilan.detailSuppressions})` : ''}. `
            + 'Une sauvegarde JSON de l\'état actuel sera d\'abord téléchargée.',
            { danger: true, confirmLabel: 'Restaurer', title: 'Restaurer une sauvegarde' }
        ).then(ok => {
            if (!ok) {
                showToast('Restauration annulée', 'warning');
                return;
            }
            exportAllData();
            _importAppliquer(data, tablesToImport);
        });
    };
    reader.readAsText(file);
    event.target.value = '';
};
