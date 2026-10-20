// ThéCol Gestion - Application JavaScript

// Application-wide constants
const CONSTANTS = {
    PRODUCTION_LOSS: 1.015,    // +1.5% loss buffer applied to ingredient consumption
    CAPSULE_LOSS: 1.075,       // +7.5% loss buffer for capsules
    BOUCHON_MARGIN: 1.05,      // +5% margin on caps shown in the production planner
    CUVE_MAX_L: 25,            // max litres per production cuve
    ATELIER_CUVES: 4,          // cuves de 25 L de l'atelier (jumeau 3D)
    ATELIER_CASSEROLES_L: [9, 4], // casseroles des plaques à induction 1 et 2 (jumeau 3D)
    STOCK_WARN_DAYS: 30,       // DLC warning threshold in days (lots legacy sans DLV)
    DLV_WARN_DAYS: 7           // DLV warning threshold in days (« DLV proche »)
};

// Utility Functions
const generateId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    }
    return '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
};
const formatDate = (date) => new Date(date).toLocaleDateString('fr-CH');
const formatDateTime = (date) => new Date(date).toLocaleString('fr-CH');
const formatTime = (time) => time.substring(0, 5);

// Parse "HH:MM" → total minutes since midnight, or null if invalid.
const parseHHMM = (str) => {
    if (typeof str !== 'string') return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(str.trim());
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return h * 60 + min;
};

// Calcule la durée en minutes d'un pointage, en gérant les pointages de nuit
// (fin < début = la fin est le lendemain, ex. 22:00→02:00 = 240 min).
// Le passage à minuit doit être résolu AVANT de soustraire la pause : sinon
// un pointage court avec une pause supérieure à la durée travaillée (ex.
// 09:00→09:15, pause 30min) devient artificiellement négatif et se voit
// ajouter 24h, affichant 23h45 au lieu d'être rejeté.
const computePointageMinutes = (debutMin, finMin, pause = 0) => {
    if (debutMin === null || finMin === null) return null;
    let worked = finMin - debutMin;
    if (worked < 0) worked += 1440; // franchit minuit
    const diff = worked - pause;
    return diff >= 0 ? diff : null;
};

// Null-safe accessor for command/order line items.
const getItems = (cmd) => (cmd && Array.isArray(cmd.items)) ? cmd.items : [];

// Returns active rows from a DB table (rows where actif !== false).
const getActive = (tableName) => DB.get(tableName).filter(r => r.actif !== false);

// Custom confirmation dialog returning a Promise<boolean>.
// Uses the same modal infrastructure as the rest of the app.
// Resolves false on Escape, overlay click, or close-X (any external dismissal).
const confirmDialog = (message, { danger = false, confirmLabel = 'Confirmer', cancelLabel = 'Annuler', title = 'Confirmation' } = {}) => {
    return new Promise((resolve) => {
        const safeMsg = escapeHtml(message);
        const confirmBtnClass = danger ? 'btn-danger' : 'btn-primary';
        modal.show(title,
            `<p style="margin: 8px 0;">${safeMsg}</p>`,
            `<button class="btn btn-secondary" id="__confirmCancelBtn" type="button">${escapeHtml(cancelLabel)}</button>
             <button class="btn ${confirmBtnClass}" id="__confirmOkBtn" type="button">${escapeHtml(confirmLabel)}</button>`
        );
        const overlayEl = document.getElementById('modalOverlay');
        let settled = false;
        const settle = (result) => {
            if (settled) return;
            settled = true;
            observer?.disconnect();
            modal.hide();
            resolve(result);
        };
        // Watch for the modal overlay losing the 'active' class (Escape, overlay click, X button).
        const observer = overlayEl ? new MutationObserver(() => {
            if (!overlayEl.classList.contains('active')) settle(false);
        }) : null;
        observer?.observe(overlayEl, { attributes: true, attributeFilter: ['class'] });
        document.getElementById('__confirmOkBtn')?.addEventListener('click', () => settle(true));
        document.getElementById('__confirmCancelBtn')?.addEventListener('click', () => settle(false));
    });
};

// Toggle a button's busy/loading state. Disables, swaps content, returns a restore() function.
const setBusy = (btnEl, label = '…') => {
    if (!btnEl) return () => {};
    const originalHTML = btnEl.innerHTML;
    const originalDisabled = btnEl.disabled;
    btnEl.disabled = true;
    btnEl.setAttribute('aria-busy', 'true');
    btnEl.innerHTML = `<span class="spinner" aria-hidden="true"></span> ${escapeHtml(label)}`;
    return () => {
        btnEl.innerHTML = originalHTML;
        btnEl.disabled = originalDisabled;
        btnEl.removeAttribute('aria-busy');
    };
};
const getLocalDateISOString = () => {
    const date = new Date();
    const offset = date.getTimezoneOffset();
    date.setMinutes(date.getMinutes() - offset);
    return date.toISOString().split('T')[0];
};

const toLocalDayKey = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const csvCell = (v) => {
    // Preserve legitimate JS numbers as-is (no formula risk from numeric type)
    if (typeof v === 'number') return String(v);
    const s = String(v ?? '');
    // Neutralize CSV formula injection: prefix ' when first non-whitespace char
    // is one of = + - @.  Preserves leading whitespace in the final value.
    const neutralized = /^[=+\-@]/.test(s.trim()) ? "'" + s : s;
    if (/[",\n]/.test(neutralized)) return '"' + neutralized.replace(/"/g, '""') + '"';
    return neutralized;
};

const getNextCommandeNumero = () => {
    const commandes = DB.get('commandes');
    let maxNum = 0;
    commandes.forEach(cmd => {
        const num = parseInt(cmd.numero || '0', 10);
        if (num > maxNum) maxNum = num;
    });
    return String(maxNum + 1).padStart(5, '0');
};

const getCommandeNumero = (commande) => {
    // (commande.id || '') : le total de la modale passe une commande temporaire sans id
    return commande.numero || (commande.id || '').slice(-5);
};

const getCommandeStatutLabel = (statut) => ({
    en_attente: 'En attente',
    produite: 'Produite',
    livrée: 'Livrée',
    annulee: 'Annulée'
}[statut] || statut || '');

// Un numéro de BL n'est jamais réattribué : on tient compte des BL existants,
// des numéros mémorisés sur les commandes et de ceux des livraisons annulées
// (entrées RESTAURE- de l'historique).
const getNextBLNumero = () => {
    let maxNum = 0;
    const scan = (v) => {
        const num = parseInt(v || '0', 10);
        if (num > maxNum) maxNum = num;
    };
    DB.get('livraisons').forEach(liv => scan(liv.numeroBL));
    DB.get('commandes').forEach(cmd => scan(cmd.numeroBL));
    DB.get('history').forEach(h => scan(h.numeroBL));
    return String(maxNum + 1).padStart(5, '0');
};

const getBLNumero = (livraison) => {
    return livraison.numeroBL || livraison.id.slice(-5);
};

// Local-only timestamps for BL Excel exports. v11.7 : un export local ne doit
// pas créer d'opération V11 ni déclencher de conflit Firestore, donc on stocke
// la date d'export dans une clé localStorage séparée (jamais synchronisée).
const BL_EXPORT_DATES_KEY = 'thecol_bl_export_dates';
const readBLExportDates = () => {
    try {
        const raw = localStorage.getItem(BL_EXPORT_DATES_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
        console.warn('[BL] Lecture des dates d\'export impossible :', e);
        return {};
    }
};
const writeBLExportDates = (map) => {
    try {
        localStorage.setItem(BL_EXPORT_DATES_KEY, JSON.stringify(map));
        return true;
    } catch (e) {
        console.warn('[BL] Écriture des dates d\'export impossible :', e);
        return false;
    }
};
const recordBLExportDate = (livraisonId) => {
    if (!livraisonId) return;
    const map = readBLExportDates();
    map[livraisonId] = new Date().toISOString();
    writeBLExportDates(map);
};
// Local-first : retourne la date stockée dans la clé dédiée, sinon retombe
// sur le champ historique `livraison.dateDernierExport` pour rétrocompatibilité.
const getBLLastExportDate = (livraison) => {
    if (!livraison) return null;
    const localMap = readBLExportDates();
    if (localMap && localMap[livraison.id]) return localMap[livraison.id];
    return livraison.dateDernierExport || null;
};

// Unit Normalization & Conversion
const CANONICAL_UNITS = ['g', 'kg', 'mL', 'L', 'pcs', 'm', 'caisse(s)'];
const UNIT_ALIASES = {
    'gr': 'g', 'gramme': 'g', 'grammes': 'g',
    'ml': 'mL', 'millilitre': 'mL', 'millilitres': 'mL',
    'l': 'L', 'litre': 'L', 'litres': 'L',
    'kilogramme': 'kg', 'kilogrammes': 'kg'
};
const UNIT_FAMILY = {
    'g': 'mass', 'kg': 'mass',
    'mL': 'volume', 'L': 'volume',
    'pcs': 'count', 'caisse(s)': 'count',
    'm': 'length'
};
const CONVERSION_FACTORS = {
    mass: { gToKg: 0.001, kgToG: 1000 },
    volume: { mLToL: 0.001, LToML: 1000 }
};

const normalizeUnit = (unit) => {
    if (!unit) return null;
    const lower = String(unit).toLowerCase().trim();
    return UNIT_ALIASES[lower] || lower;
};

const isValidUnit = (unit) => {
    return CANONICAL_UNITS.includes(normalizeUnit(unit));
};

const getUnitFamily = (unit) => {
    return UNIT_FAMILY[normalizeUnit(unit)] || null;
};

const areUnitsCompatible = (unit1, unit2) => {
    const u1 = normalizeUnit(unit1);
    const u2 = normalizeUnit(unit2);
    if (!u1 || !u2) return false;
    return getUnitFamily(u1) === getUnitFamily(u2) && getUnitFamily(u1) !== null;
};

const convertQuantity = (quantity, fromUnit, toUnit) => {
    const from = normalizeUnit(fromUnit);
    const to = normalizeUnit(toUnit);
    if (!from || !to) return null;
    if (!areUnitsCompatible(from, to)) return null;

    const qty = parseFloat(quantity);
    if (isNaN(qty)) return null;

    if (from === to) return qty;

    const family = getUnitFamily(from);
    if (family === 'mass') {
        if (from === 'g' && to === 'kg') return qty * CONVERSION_FACTORS.mass.gToKg;
        if (from === 'kg' && to === 'g') return qty * CONVERSION_FACTORS.mass.kgToG;
    }
    if (family === 'volume') {
        if (from === 'mL' && to === 'L') return qty * CONVERSION_FACTORS.volume.mLToL;
        if (from === 'L' && to === 'mL') return qty * CONVERSION_FACTORS.volume.LToML;
    }
    return null;
};

const displayUnit = (unit) => {
    return normalizeUnit(unit) || unit;
};

// Presets de tarifs clients — choisis dans la fiche client (champ tarifs)
const TARIF_PRESETS = {
    distributeur: { prix25cl: '2.25', prix50cl: '3.80', prix100cl: '6.00' },
    prive:        { prix25cl: '3.00', prix50cl: '5.00', prix100cl: '8.50' },
    restaurant:   { prix25cl: '',     prix50cl: '',     prix100cl: '4.00' }
};

const normalizeTarifKey = (raw) => {
    if (!raw) return 'custom';
    const s = String(raw).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    if (s.startsWith('distrib')) return 'distributeur';
    if (s.startsWith('priv'))    return 'prive';
    if (s.startsWith('rest'))    return 'restaurant';
    return 'custom';
};

const migrateClientTarifs = () => {
    try {
        const clients = DB.get('clients') || [];
        let changedKey = 0, changedPrix = 0;
        const isEmpty = (v) => v === undefined || v === null || String(v).trim() === '';
        clients.forEach(c => {
            const canonical = normalizeTarifKey(c.tarifs);
            if (c.tarifs !== canonical) {
                c.tarifs = canonical;
                changedKey++;
            }
            const preset = TARIF_PRESETS[c.tarifs];
            if (preset) {
                if (isEmpty(c.prix25cl)  && !isEmpty(preset.prix25cl))  { c.prix25cl  = preset.prix25cl;  changedPrix++; }
                if (isEmpty(c.prix50cl)  && !isEmpty(preset.prix50cl))  { c.prix50cl  = preset.prix50cl;  changedPrix++; }
                if (isEmpty(c.prix100cl) && !isEmpty(preset.prix100cl)) { c.prix100cl = preset.prix100cl; changedPrix++; }
            }
        });
        if (changedKey + changedPrix > 0) {
            DB.set('clients', clients);
        }
    } catch (e) {
        console.warn('[migration] migrateClientTarifs failed:', e);
    }
};

const applyTarifPresetIfEmpty = () => {
    const form = document.getElementById('clientForm');
    if (!form) return;
    const cat = form.tarifs?.value;
    const preset = TARIF_PRESETS[cat];
    if (!preset) return;
    const isEmpty = (v) => v === undefined || v === null || String(v).trim() === '';
    if (isEmpty(form.prix25cl.value))  form.prix25cl.value  = preset.prix25cl;
    if (isEmpty(form.prix50cl.value))  form.prix50cl.value  = preset.prix50cl;
    if (isEmpty(form.prix100cl.value)) form.prix100cl.value = preset.prix100cl;
};

const getFormatPriceKey = (format) => {
    if (!format) return null;
    const cl = Number(format.contenanceCl);
    if (cl === 25)  return 'prix25cl';
    if (cl === 50)  return 'prix50cl';
    if (cl === 100) return 'prix100cl';
    const nom = String(format.nom || '').toLowerCase().replace(/\s+/g, '');
    if (/^25cl$/.test(nom))                  return 'prix25cl';
    if (/^50cl$/.test(nom))                  return 'prix50cl';
    if (/^(100cl|1l|1000ml|1\.0l)$/.test(nom)) return 'prix100cl';
    return null;
};

const applyTarifPreset = (selectEl) => {
    const cat = selectEl.value;
    const preset = TARIF_PRESETS[cat];
    if (!preset) return;
    const form = document.getElementById('clientForm');
    if (!form) return;
    form.prix25cl.value = preset.prix25cl;
    form.prix50cl.value = preset.prix50cl;
    form.prix100cl.value = preset.prix100cl;
};

const onPrixInputChange = () => {
    const form = document.getElementById('clientForm');
    if (!form) return;
    const cat = form.tarifs?.value;
    const preset = TARIF_PRESETS[cat];
    if (!preset) return;
    const matches = form.prix25cl.value === preset.prix25cl
                 && form.prix50cl.value === preset.prix50cl
                 && form.prix100cl.value === preset.prix100cl;
    if (!matches) form.tarifs.value = 'custom';
};

const resolveCommandeFormat = (item, formats) => {
    if (!item) return null;
    let fmt = formats.find(f => f.id === item.formatId);
    if (fmt) return { format: fmt, source: 'id' };
    if (item.formatNom) {
        fmt = formats.find(f => f.nom === item.formatNom);
        if (fmt) return { format: fmt, source: 'formatNom' };
    }
    if (item.formatId) {
        const norm = String(item.formatId).toLowerCase().replace(/\s+/g, '');
        fmt = formats.find(f => String(f.nom || '').toLowerCase().replace(/\s+/g, '') === norm);
        if (fmt) return { format: fmt, source: 'formatId-as-name' };
    }
    return null;
};

// Toutes les tables persistées
const ALL_TABLES = ['employees', 'aromes', 'formats', 'recettes', 'clients', 'lots', 'commandes', 'pointages', 'inventaire', 'livraisons', 'history', 'todos'];

// V11 — Firestore collaborative sync (one document per record)
const V11 = {
    VERSION: 11,
    SYNC_META_COLLECTION: 'syncMeta',
    SCHEMA_DOC: 'schema',
    TABLES_COLLECTION: 'tables',
    RECORDS_SUBCOLLECTION: 'records',
    LOCK_DOC: 'migrationLock',
    LOCK_EXPIRY_MS: 30000,
    QUEUE_KEY: 'thecol_v11_queue',
    READY_KEY: 'thecol_v11_ready',
    VERSIONS_KEY: 'thecol_v11_versions',
    // Internal state
    _sessionId: generateId(),  // unique per session for lock ownership
    _listeners: {},            // { table: unsubscribeFn }
    _localCache: {},           // { table: [records] } — shadow copy for snapshot merge
    _versions: {},             // { table: { recordId: _version } } — last known remote version per record
    _debounceTimer: null,
    _pendingRender: false,   // rendu différé car un champ de saisie dans #content est actif
    _isReady: false,
    _flushPromise: null,       // serializes v11FlushQueue calls
    _bootPromise: null,        // serializes v11BootFirebase calls
    _conflictNotified: new Set(), // Set of "table/recordId" notified once per session
    _bootstrapping: false,    // true during boot before first remote load when ready locally
    _migrating: false,         // true during migration (lock acquired → finally)
    _memoryProtectedTables: new Set() // tables whose queue could not be persisted; no pull/snapshot
};

// Early init: enable v11 queuing BEFORE bootLocal runs so all local changes go to queue.
// Read persisted ready flag to set _isReady, but always set _bootstrapping so writes queue.
if (localStorage.getItem(V11.READY_KEY) === '1') {
    V11._isReady = true;
}
V11._bootstrapping = true;

// Helpers pour le suivi des tables non synchronisées (hors-band, pas dans ALL_TABLES)
const getDirtyTables = () => {
    try { return JSON.parse(localStorage.getItem('thecol_dirty_tables') || '[]'); }
    catch { return []; }
};
const markDirty = (key) => {
    const dirty = getDirtyTables();
    if (!dirty.includes(key)) { dirty.push(key); localStorage.setItem('thecol_dirty_tables', JSON.stringify(dirty)); }
};
const unmarkDirty = (key) => {
    const dirty = getDirtyTables().filter(k => k !== key);
    localStorage.setItem('thecol_dirty_tables', JSON.stringify(dirty));
};

// V11 — Persistent offline operation queue (localStorage)
const v11GetQueue = () => {
    try { return JSON.parse(localStorage.getItem(V11.QUEUE_KEY) || '[]'); }
    catch { return []; }
};
const v11SetQueue = (queue) => {
    try {
        localStorage.setItem(V11.QUEUE_KEY, JSON.stringify(queue));
        return true;
    } catch (e) {
        console.error('[V11] Queue write error:', e);
        return false;
    }
};

// V11 — Persist known versions to localStorage (survives page reload)
const v11SaveVersions = () => {
    try { localStorage.setItem(V11.VERSIONS_KEY, JSON.stringify(V11._versions)); }
    catch (e) { console.error('[V11] Versions save error:', e); }
};
const v11LoadVersions = () => {
    try {
        const raw = localStorage.getItem(V11.VERSIONS_KEY);
        if (raw) V11._versions = JSON.parse(raw);
        // Ensure object structure
        for (const table of ALL_TABLES) {
            if (!V11._versions[table] || typeof V11._versions[table] !== 'object') V11._versions[table] = {};
        }
    } catch (e) { console.warn('[V11] Load versions error:', e); }
};

/* Merge semantics for the operation queue:
   - upsert after delete for same recordId → remove delete, keep upsert
   - delete after upsert for same recordId → keep delete, remove upsert
   Two successive upserts for same recordId → keep the latest (replace in place)
*/
const v11MergeOp = (queue, newOp) => {
    const idx = queue.findIndex(op => op.table === newOp.table && op.recordId === newOp.recordId);
    if (idx !== -1) {
        const existing = queue[idx];
        // delete after upsert → keep the delete, preserve knownVersion
        if (newOp.type === 'delete' && existing.type === 'upsert') {
            newOp.id = generateId(); // fresh id so flush removal is safe
            newOp.knownVersion = existing.knownVersion;
            queue[idx] = newOp;
            return;
        }
        // upsert after delete → replace delete with upsert, preserve knownVersion
        if (newOp.type === 'upsert' && existing.type === 'delete') {
            newOp.id = generateId(); // fresh id so flush removal is safe
            newOp.knownVersion = existing.knownVersion;
            queue[idx] = newOp;
            return;
        }
        // upsert after upsert → keep the OLDEST knownVersion but create a new op.id
        // so flush only removes the latest merged op, never a more recent one.
        if (newOp.type === 'upsert' && existing.type === 'upsert') {
            const oldestKnownVersion = existing.knownVersion !== null ? existing.knownVersion : newOp.knownVersion;
            newOp.id = generateId(); // fresh id so flush removal is safe
            newOp.knownVersion = oldestKnownVersion;
            queue[idx] = newOp;
            return;
        }
        // delete after delete → no-op, already deleted
        return;
    }
    queue.push(newOp);
};

const v11EnqueueOp = (table, type, recordId, record) => {
    const queue = v11GetQueue();
    // Store the last known remote version for this record (null if never synced)
    const knownVersion = V11._versions[table]?.[recordId] ?? null;
    v11MergeOp(queue, { id: generateId(), table, type, recordId, record, timestamp: Date.now(), knownVersion });
    const persisted = v11SetQueue(queue);
    if (!persisted) {
        // Queue could NOT be persisted to localStorage — mark table as memory-protected.
        // This blocks all pull/snapshot for this table during the session.
        V11._memoryProtectedTables.add(table);
        console.error('[V11] ÉCHEC CRITIQUE : la file d\'attente n\'a pas pu être stockée pour', table,
            '. Toute synchronisation distante est bloquée pour cette table durant cette session.');
    }
    // Persist versions after each enqueue (so versions survive crash during offline ops)
    v11SaveVersions();
};

// --- V11 — Centralized Firestore ID validation ---
// Returns null if valid, or a French error string if invalid.
// When `seen` is provided, also checks uniqueness.
const v11ValidateId = (id, seen) => {
    if (!id || typeof id !== 'string' || id.trim() === '') {
        return 'ID absent ou invalide';
    }
    const trimmed = id.trim();
    // Strict trim check — the persisted id must equal its trimmed form
    if (id !== trimmed) {
        return `L'ID « ${id} » contient des espaces en début ou fin`;
    }
    if (trimmed.includes('/')) {
        return `L'ID « ${trimmed} » contient '/' (invalide pour Firestore)`;
    }
    if (trimmed === '.' || trimmed === '..') {
        return `L'ID « ${trimmed} » est interdit (Firestore)`;
    }
    if (/^__.*__$/.test(trimmed)) {
        return `L'ID « ${trimmed} » utilise le préfixe réservé __`;
    }
    // Allow-list : lettres, chiffres, _, :, -, . (1-128 caractères)
    if (!/^[a-zA-Z0-9_:\-.]{1,128}$/.test(trimmed)) {
        return `L'ID « ${trimmed} » contient des caractères non autorisés. Seuls les lettres, chiffres, _, :, -, . sont acceptés (1-128 caractères). Données conservées localement mais synchronisation bloquée.`;
    }
    if (seen) {
        if (seen.has(trimmed)) {
            return `ID dupliqué « ${trimmed} »`;
        }
        seen.add(trimmed);
    }
    return null; // valid
};

// V11 — Validate a full table's records before diff/queue.
// Returns { valid: true } or { valid: false, reason: '...' }
const v11ValidateTable = (table, data) => {
    if (!Array.isArray(data)) return { valid: false, reason: 'Les données doivent être un tableau' };
    const seen = new Set();
    for (const rec of data) {
        const err = v11ValidateId(rec && rec.id, seen);
        if (err) return { valid: false, reason: err };
    }
    return { valid: true };
};

// V11 — Validate dirty tables from raw localStorage BEFORE any push or merge.
// Reads raw JSON (never DB.get which silently returns [] on corruption),
// validates each record's ID, and caches the parsed data for reuse.
// Returns { valid: true, cache: { tableName: [records] } } on success,
// or { valid: false, reason: '...' } on first error (abort).
const v11ValidateDirtyTables = (dirtyTables) => {
    const cache = {};
    for (const key of dirtyTables) {
        if (!ALL_TABLES.includes(key)) continue;
        const raw = localStorage.getItem('thecol_' + key);
        let data = [];
        if (raw !== null) {
            try {
                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed)) {
                    return { valid: false, reason: `Données locales corrompues pour « ${key} » : tableau attendu.`, table: key };
                }
                data = parsed;
            } catch (e) {
                return { valid: false, reason: `Données locales corrompues pour « ${key} » : JSON invalide.`, table: key };
            }
        }
        // Validate every record ID
        const seen = new Set();
        for (const rec of data) {
            const err = v11ValidateId(rec && rec.id, seen);
            if (err) {
                return { valid: false, reason: `${err} dans les données locales de « ${key} ».`, table: key };
            }
        }
        cache[key] = data;
    }
    return { valid: true, cache };
};

// V11 — Track tables whose last DB.set had invalid records.
// Persisted so the constraint survives page reload.
const V11_INVALID_TABLES_KEY = 'thecol_v11_invalid_tables';
const v11GetInvalidTables = () => {
    try { return JSON.parse(localStorage.getItem(V11_INVALID_TABLES_KEY) || '[]'); }
    catch { return []; }
};
const v11MarkTableInvalid = (table) => {
    const list = v11GetInvalidTables();
    if (!list.includes(table)) { list.push(table); localStorage.setItem(V11_INVALID_TABLES_KEY, JSON.stringify(list)); }
};
const v11ClearTableInvalid = (table) => {
    const list = v11GetInvalidTables().filter(t => t !== table);
    localStorage.setItem(V11_INVALID_TABLES_KEY, JSON.stringify(list));
};

// Data Storage with Firebase sync
const DB = {
    firebaseSynced: false,
    // Prevents re-entrant sync when a snapshot writes to localStorage
    _skipSync: false,

    get: (key) => {
        const data = localStorage.getItem('thecol_' + key);
        if (!data) return [];
        try {
            const parsed = JSON.parse(data);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            console.error('Error parsing data for key ' + key, e);
            showToast('Données corrompues pour « ' + key + ' ». Restaurez depuis Firebase.', 'error');
            return [];
        }
    },

    set: (key, data) => {
        // Contrat : renvoie true si l'écriture locale a réussi ET que la préparation
        // de la synchronisation n'a rencontré aucun échec (tableau valide, validation
        // V11 OK, queue persistée pour cette table, pas d'exception dans le calcul
        // différentiel). Renvoie false dans tous les autres cas. Les appelants
        // existants qui ignoraient la valeur de retour continuent à fonctionner
        // inchangés ; les appelants transactionnels (importAllData) peuvent
        // s'appuyer dessus pour décider d'un rollback.
        // 0. Validate input
        if (!Array.isArray(data)) {
            console.error('[V11] DB.set: data must be an array for', key, typeof data);
            showToast('Erreur interne : les données doivent être un tableau', 'error');
            return false;
        }

        // 1. Read previous state for diff computation
        const prev = DB.get(key);

        // 2. Write to localStorage (always preserve locally even with invalid records)
        let localOk = true;
        try {
            localStorage.setItem('thecol_' + key, JSON.stringify(data));
        } catch (e) {
            localOk = false;
            console.warn('localStorage full for key ' + key, e);
        }

        // 3. Determine if v11 sync should be applied
        // _migrating forces queue path during migration, never legacy
        const v11Active = !DB._skipSync && (V11._isReady || V11._bootstrapping || V11._migrating);

        // Track sync-preparation success separately from local write.
        // localOk reflects localStorage only; syncOk reflects the V11/legacy path
        // (validation + diff + persist queue). The function only returns true when
        // both succeeded.
        let syncOk = true;

        if (v11Active) {
            // V11 mode: validate table before producing any diff/op
            const validation = v11ValidateTable(key, data);
            if (!validation.valid) {
                console.error('[V11] DB.set: validation échouée pour', key, '-', validation.reason);
                showToast(
                    `Données invalides dans « ${key} » : ${validation.reason}. Enregistrement local conservé mais synchronisation désactivée pour cette table.`,
                    'error'
                );
                // Mark table persistently invalid
                v11MarkTableInvalid(key);
                // Save locally but produce NO v11 operations for this table
                if (!localOk) showToast('Stockage local plein.', 'warning');
                return false;
            }

            // Validation passed — if table was previously invalid, clear the flag
            const wasInvalid = v11GetInvalidTables().includes(key);
            if (wasInvalid) {
                v11ClearTableInvalid(key);
            }

            try {
                const validRecords = data.filter(r => r.id && typeof r.id === 'string' && r.id.trim() !== '');

                if (wasInvalid) {
                    // Full resync: upsert ALL valid records, NEVER deletes derived from invalid state.
                    // This guarantees no data loss from a previous invalid save.
                    for (const record of validRecords) {
                        v11EnqueueOp(key, 'upsert', record.id, record);
                    }
                } else {
                    // Normal differential sync
                    const prevMap = new Map(prev.map(r => [r.id, r]));
                    const currentIds = new Set(validRecords.map(r => r.id));

                    // Upserts: valid records that are new or changed
                    for (const record of validRecords) {
                        const prevRec = prevMap.get(record.id);
                        if (!prevRec || JSON.stringify(prevRec) !== JSON.stringify(record)) {
                            v11EnqueueOp(key, 'upsert', record.id, record);
                        }
                    }
                    // Deletes: records in prev that are no longer in current data
                    for (const prevRec of prev) {
                        if (!prevRec.id || typeof prevRec.id !== 'string' || prevRec.id.trim() === '') continue;
                        if (!currentIds.has(prevRec.id)) {
                            v11EnqueueOp(key, 'delete', prevRec.id, null);
                        }
                    }
                }
            } catch (e) {
                console.error('[V11] Differential write error:', e);
                syncOk = false;
            }
            // Check if queue persistence failed and table is now memory-protected
            if (V11._memoryProtectedTables.has(key)) {
                showToast(
                    `ERREUR : la file d'attente de synchronisation n'a pas pu être stockée pour « ${key} ». Toute synchronisation distante est bloquée pour cette table. Exportez vos données depuis Paramètres → Exporter, puis rechargez la page.`,
                    'error'
                );
                syncOk = false;
            } else if (window.firebaseReady && window.firebaseDb) {
                // Non-blocking flush if Firebase is available and queue is persisted
                setTimeout(() => v11FlushQueue(), 0);
            }
        } else if (!DB._skipSync) {
            // Legacy path (pre-migration): count invalid records
            const invalidRecords = data.filter(r => !r.id || typeof r.id !== 'string' || r.id.trim() === '');
            const invalidCount = invalidRecords.length;
            if (invalidCount > 0) {
                console.error('[V11] DB.set: enregistrement(s) sans ID valide dans', key, invalidRecords);
                showToast(
                    `${invalidCount} enregistrement(s) sans ID valide dans « ${key} ». Synchronisation refusée.`,
                    'error'
                );
            }

            if (window.firebaseReady && window.firebaseDb && invalidCount === 0) {
                DB.syncToFirebase(key, data);
            } else {
                // Offline or invalid data: mark dirty for legacy path
                markDirty(key);
            }
        }

        if (!localOk) {
            showToast('Stockage local plein.', 'warning');
        }

        return localOk && syncOk;
    },

    // Called by real-time listeners — updates localStorage WITHOUT triggering sync
    _applyRemoteSnapshot: (key, records) => {
        // Ne jamais écraser localStorage d'une table invalidée
        if (v11GetInvalidTables().includes(key)) {
            console.warn('[V11] _applyRemoteSnapshot refusé pour table invalidée', key);
            return;
        }
        const prevFlag = DB._skipSync;
        DB._skipSync = true;
        try {
            localStorage.setItem('thecol_' + key, JSON.stringify(records));
            V11._localCache[key] = records;
        } catch (e) {
            console.error('[V11] Error applying remote snapshot for', key, e);
        } finally {
            DB._skipSync = prevFlag;
        }
    },

    syncToFirebase: async (key, data) => {
        if (!window.firebaseReady || !window.firebaseDb || !window.firebaseApi) { markDirty(key); return false; }
        try {
            const { setDoc, doc } = window.firebaseApi;
            await setDoc(doc(window.firebaseDb, 'data', key), { data: data, updatedAt: new Date().toISOString() });
            unmarkDirty(key);
            return true;
        } catch(e) {
            console.error('Firebase sync error:', e);
            markDirty(key);
            showToast('Synchronisation cloud échouée pour « ' + key + ' » — données enregistrées localement uniquement.', 'error');
            return false;
        }
    },

    loadFromFirebase: async (showNotification = true, skipTables = []) => {
        if (!window.firebaseReady || !window.firebaseDb || !window.firebaseApi) return;
        if (V11._isReady === true) return;
        try {
            // Backup before sync
            const backup = {};
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k.startsWith('thecol_') && !k.startsWith('thecol_backup_')) {
                    backup[k] = localStorage.getItem(k);
                }
            }
            localStorage.setItem('thecol_backup_pre_sync', JSON.stringify(backup));

            const { getDocs, collection } = window.firebaseApi;
            const snapshot = await getDocs(collection(window.firebaseDb, 'data'));
            const hasData = !snapshot.empty;
            snapshot.forEach(docSnap => {
                if (skipTables.includes(docSnap.id)) return;
                const cloudData = docSnap.data().data;
                if (Array.isArray(cloudData)) {
                    localStorage.setItem('thecol_' + docSnap.id, JSON.stringify(cloudData));
                }
            });
            if (hasData) {
                DB.firebaseSynced = true;
                if (showNotification) showToast('Données synchronisées depuis le cloud');
            } else if (showNotification) {
                showToast('Aucune donnée dans le cloud');
            }
        } catch(e) {
            console.error('Firebase load error:', e);
        }
    },

    init: () => {
        ALL_TABLES.forEach(table => {
            if (!localStorage.getItem('thecol_' + table)) {
                localStorage.setItem('thecol_' + table, '[]');
            }
        });
    },

    // UI filter persistence — keeps storage keys uniform under "thecol_filter_<name>".
    getFilter: (name) => localStorage.getItem('thecol_filter_' + name) || '',
    setFilter: (name, value) => localStorage.setItem('thecol_filter_' + name, value || ''),

    // Sync from Firebase on page load
    initFromFirebase: async () => {
        if (!window.firebaseReady || !window.firebaseDb) return;
        await DB.loadFromFirebase();
    }
};

// =============================================================================
// Central Event Delegation — DRY, XSS-safe, works on rerendered content + modals
// =============================================================================
// Replaces all inline onclick/onchange/oninput/onkeydown that interpolate
// business data.  Elements carry a data-click / data-change attribute whose
// value is a dotted action key; the handlers below read data-* attributes for
// parameters.  The document-level listener catches events from rerendered HTML
// and modal content alike.
// =============================================================================

const CLICK_HANDLERS = {};

// Register a document-level click delegation listener.
// Reads data-click + optional data-prevent / data-stop flags.
const _onClick = (e) => {
    const el = e.target.closest('[data-click]');
    if (!el) return;
    const action = el.getAttribute('data-click');
    if (!action) return;
    if (el.hasAttribute('data-prevent')) e.preventDefault();
    if (el.hasAttribute('data-stop')) e.stopPropagation();
    const fn = CLICK_HANDLERS[action];
    if (fn) fn(el, e);
};

const CHANGE_HANDLERS = {};

const _onChange = (e) => {
    const el = e.target.closest('[data-change]');
    if (!el) return;
    const action = el.getAttribute('data-change');
    if (!action) return;
    if (el.hasAttribute('data-prevent')) e.preventDefault();
    if (el.hasAttribute('data-stop')) e.stopPropagation();
    const fn = CHANGE_HANDLERS[action];
    if (fn) fn(el, e);
};

const initEventDelegation = () => {
    if (window.__delegationReady) return;
    window.__delegationReady = true;
    document.addEventListener('click', _onClick);
    document.addEventListener('change', _onChange);
};

// ---------------------------------------------------------------------------
// Action: set-filter — called by segmented-filter buttons
// ---------------------------------------------------------------------------
CLICK_HANDLERS['set-filter'] = (el) => {
    const name = el.getAttribute('data-name');
    const value = el.getAttribute('data-value') || '';
    const renderFn = el.getAttribute('data-render');
    DB.setFilter(name, value);
    if (renderFn) {
        // Whitelist explicite — jamais window[renderFn]
        const RENDER_WHITELIST = {
            renderInventaire: renderInventaire
        };
        const fn = RENDER_WHITELIST[renderFn] || renderCurrentView;
        fn();
    }
};

// ---------------------------------------------------------------------------
// Action: global-search-result
// ---------------------------------------------------------------------------
CLICK_HANDLERS['global-search-result'] = (el) => {
    openGlobalSearchResult(el.getAttribute('data-type'), el.getAttribute('data-id'));
};

// ---------------------------------------------------------------------------
// Dash todos
// ---------------------------------------------------------------------------
CLICK_HANDLERS['toggle-todo'] = (el) => toggleTodo(el.getAttribute('data-id'));
CLICK_HANDLERS['delete-todo'] = (el) => deleteTodo(el.getAttribute('data-id'));

// ---------------------------------------------------------------------------
// Stock / Historique
// ---------------------------------------------------------------------------
CLICK_HANDLERS['toggle-stock-arome-filter'] = (el) => toggleStockAromeFilter(el.getAttribute('data-value'));
CLICK_HANDLERS['toggle-stock-format-filter'] = (el) => toggleStockFormatFilter(el.getAttribute('data-value'));
CLICK_HANDLERS['toggle-stock-statut-filter'] = (el) => toggleStockStatutFilter(el.getAttribute('data-value'));
CLICK_HANDLERS['show-lot-trace'] = (el) => showLotTraceModal(el.getAttribute('data-id'));
CLICK_HANDLERS['sell-lot'] = (el) => showVendreModal(el.getAttribute('data-id'));
CLICK_HANDLERS['edit-lot'] = (el) => showEditLotModal(el.getAttribute('data-id'));
CLICK_HANDLERS['edit-lot-save'] = (el, e) => saveEditLot(e, el.getAttribute('data-id'));
CLICK_HANDLERS['delete-lot'] = (el) => deleteLot(el.getAttribute('data-id'));
CLICK_HANDLERS['confirm-delete-lot'] = (el) => confirmDeleteLot(el.getAttribute('data-id'));
CLICK_HANDLERS['show-lot-rappel'] = (el) => showLotRappelModal(el.getAttribute('data-num'));
CLICK_HANDLERS['export-lot-rappel'] = (el) => exportLotRappelExcel(el.getAttribute('data-num'));
CLICK_HANDLERS['bloquer-lot'] = (el) => showBloquerLotModal(el.getAttribute('data-num'));
CLICK_HANDLERS['confirm-bloquer-lot'] = (el) => confirmBloquerLot(el.getAttribute('data-num'));
CLICK_HANDLERS['debloquer-lot'] = (el) => debloquerLot(el.getAttribute('data-num'));
CLICK_HANDLERS['set-hist-filter'] = (el) => setHistFilter(el.getAttribute('data-key'), el.getAttribute('data-value'));
CLICK_HANDLERS['delete-hist-record'] = (el) => deleteHistoryRecord(el.getAttribute('data-id'));

// ---------------------------------------------------------------------------
// Vente directe / Vendre
// ---------------------------------------------------------------------------
CLICK_HANDLERS['vendre-lot'] = (el) => vendreLot(el.getAttribute('data-id'));

// ---------------------------------------------------------------------------
// Pointage
// ---------------------------------------------------------------------------
CLICK_HANDLERS['pointage-select-employee'] = (el) => pointageSelectEmployee(el.getAttribute('data-id'));
CLICK_HANDLERS['delete-pointage'] = (el) => deletePointage(el.getAttribute('data-id'));
CLICK_HANDLERS['cloturer-pointage'] = (el) => showCloturePointageModal(el.getAttribute('data-id'));
CLICK_HANDLERS['save-cloture-pointage'] = (el) => saveCloturePointage(el.getAttribute('data-id'));

// ---------------------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------------------
CLICK_HANDLERS['select-week-day'] = (el) => selectWeekDay(el.getAttribute('data-date'));
CLICK_HANDLERS['toggle-pill-statut'] = (el) => togglePillStatut(el.getAttribute('data-value'));
CLICK_HANDLERS['show-commande-details'] = (el) => showCommandeDetails(el.getAttribute('data-id'));
CLICK_HANDLERS['save-commande'] = (el, e) => saveCommande(e, el.getAttribute('data-id') || '');
CLICK_HANDLERS['edit-commande'] = (el) => editCommande(el.getAttribute('data-id'));
CLICK_HANDLERS['duplicate-commande'] = (el) => duplicateCommande(el.getAttribute('data-id'));
CLICK_HANDLERS['marquer-commande-produite'] = (el) => marquerCommandeProduite(el.getAttribute('data-id'));
CLICK_HANDLERS['confirm-annuler-commande'] = (el) => confirmAnnulerCommande(el.getAttribute('data-id'));
CLICK_HANDLERS['livrer-commande'] = (el) => showLivraisonBouteillesModal(el.getAttribute('data-id'));
CLICK_HANDLERS['restaurer-commande'] = (el) => restaurerCommande(el.getAttribute('data-id'));
CLICK_HANDLERS['commande-bl'] = (el) => prepareCommandeBLExport(el.getAttribute('data-id'));

// ---------------------------------------------------------------------------
// Livraisons / BL
// ---------------------------------------------------------------------------
CLICK_HANDLERS['show-livraison-details'] = (el) => showLivraisonDetails(el.getAttribute('data-id'));
CLICK_HANDLERS['prepare-bl-export'] = (el) => showPrepareBLExportModal(el.getAttribute('data-id'));
CLICK_HANDLERS['delete-livraison'] = (el) => deleteLivraison(el.getAttribute('data-id'));
CLICK_HANDLERS['close-modal'] = () => modal.hide();
CLICK_HANDLERS['export-bl-excel'] = (el) => exportPreparedBL(el.getAttribute('data-id'), 'excel');
CLICK_HANDLERS['export-bl-pdf'] = (el) => exportPreparedBL(el.getAttribute('data-id'), 'pdf');

// ---------------------------------------------------------------------------
// Production
// ---------------------------------------------------------------------------
CLICK_HANDLERS['confirmer-production-arome'] = (el) => confirmerProductionArome(el.getAttribute('data-arome'));
CLICK_HANDLERS['confirmer-production'] = (el) => confirmerProduction(el.getAttribute('data-arome'), Number(el.getAttribute('data-index')));
CLICK_HANDLERS['valider-production'] = (el, e) => validerProduction(e, el.getAttribute('data-arome'), Number(el.getAttribute('data-index')));
CLICK_HANDLERS['valider-production-arome'] = (el, e) => validerProductionArome(e, el.getAttribute('data-arome'));

// ---------------------------------------------------------------------------
// Inventaire
// ---------------------------------------------------------------------------
CLICK_HANDLERS['update-inventaire-qty'] = (el) => updateInventaireQty(el.getAttribute('data-id'), Number(el.getAttribute('data-delta')));
CLICK_HANDLERS['show-inventaire-modal'] = (el) => showInventaireModal(el.getAttribute('data-type'), el.getAttribute('data-id'));
CLICK_HANDLERS['delete-inventaire-item'] = (el) => deleteInventaireItem(el.getAttribute('data-id'));
CLICK_HANDLERS['save-inventaire-item'] = (el, e) => saveInventaireItem(e, el.getAttribute('data-id') || '');

CHANGE_HANDLERS['set-inventaire-qty'] = (el) => setInventaireQty(el.getAttribute('data-id'), el.value);
CHANGE_HANDLERS['import-clients-excel'] = (el, e) => importClientsExcel(e);

// ---------------------------------------------------------------------------
// Paramètres CRUD
// ---------------------------------------------------------------------------
CLICK_HANDLERS['show-employe-modal'] = (el) => showEmployeModal(el.getAttribute('data-id'));
CLICK_HANDLERS['delete-employe'] = (el) => deleteEmploye(el.getAttribute('data-id'));
CLICK_HANDLERS['show-arome-modal'] = (el) => showAromeModal(el.getAttribute('data-id'));
CLICK_HANDLERS['delete-arome'] = (el) => deleteArome(el.getAttribute('data-id'));
CLICK_HANDLERS['show-format-modal'] = (el) => showFormatModal(el.getAttribute('data-id'));
CLICK_HANDLERS['delete-format'] = (el) => deleteFormat(el.getAttribute('data-id'));
CLICK_HANDLERS['show-recette-modal'] = (el) => showRecetteModal(el.getAttribute('data-id'));
CLICK_HANDLERS['delete-recette'] = (el) => deleteRecette(el.getAttribute('data-id'));
CLICK_HANDLERS['show-client-modal'] = (el) => showClientModal(el.getAttribute('data-id'));
CLICK_HANDLERS['delete-client'] = (el) => deleteClient(el.getAttribute('data-id'));
CLICK_HANDLERS['save-employe'] = (el, e) => saveEmploye(e, el.getAttribute('data-id') || '');
CLICK_HANDLERS['save-arome'] = (el, e) => saveArome(e, el.getAttribute('data-id') || '');
CLICK_HANDLERS['save-format'] = (el, e) => saveFormat(e, el.getAttribute('data-id') || '');
CLICK_HANDLERS['save-recette'] = (el, e) => saveRecette(e, el.getAttribute('data-id') || '');
CLICK_HANDLERS['save-client'] = (el, e) => saveClient(e, el.getAttribute('data-id') || '');
CLICK_HANDLERS['sync-recettes-inventaire'] = () => syncRecettesInventaire();
CLICK_HANDLERS['export-clients-excel'] = () => exportClientsExcel();
CLICK_HANDLERS['trigger-import-clients'] = () => document.getElementById('importClientsFile').click();
CLICK_HANDLERS['reset-clients'] = () => resetClients();

// Trie les commandes par date de livraison croissante (dates invalides en dernier,
// ordre d'origine en cas d'égalité). Renvoie des paires { commande, index }.
const sortCommandesByDateLivraison = (commandes) => (commandes || [])
    .map((commande, index) => ({ commande, index }))
    .sort((a, b) => {
        const aDate = dateOnly(a.commande.dateLivraison).getTime();
        const bDate = dateOnly(b.commande.dateLivraison).getTime();
        const aSort = Number.isNaN(aDate) ? Number.POSITIVE_INFINITY : aDate;
        const bSort = Number.isNaN(bDate) ? Number.POSITIVE_INFINITY : bDate;
        return aSort - bSort || a.index - b.index;
    });

// Réserve de stock vendable consommée lot par lot, par DLV croissante (repli DLC).
// Chaque commande ne reçoit que des lots encore vendables à SA date de livraison
// (une date passée ou invalide vaut aujourd'hui) : traiter les commandes par date
// de livraison croissante évite de compter un lot qui expirera avant la livraison.
const createStockPool = (lots, referenceDate = new Date(), keyOf = (lot) => `${lot.arome}-${lot.format}`) => {
    const today = dateOnly(referenceDate);
    const saleLimit = (lot) => {
        const t = dateOnly(lot.dlv || lot.dlc).getTime();
        return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
    };
    const entries = (lots || [])
        .filter(lot => isLotSellable(lot, today) && (lot.quantite || 0) > 0)
        .map(lot => ({ lot, key: keyOf(lot), reste: lot.quantite || 0 }))
        .sort((a, b) => saleLimit(a.lot) - saleLimit(b.lot));
    const eligible = (key, dateLivraison) => {
        const d = dateOnly(dateLivraison);
        const ref = Number.isNaN(d.getTime()) || d < today ? today : d;
        return entries.filter(e => e.key === key && e.reste > 0 && isLotSellable(e.lot, ref));
    };
    return {
        available: (key, dateLivraison) => eligible(key, dateLivraison).reduce((sum, e) => sum + e.reste, 0),
        // Consomme jusqu'à `qty` bouteilles ; renvoie la quantité effectivement couverte.
        take: (key, qty, dateLivraison) => {
            let reste = qty;
            for (const e of eligible(key, dateLivraison)) {
                if (reste <= 0) break;
                const used = Math.min(e.reste, reste);
                e.reste -= used;
                reste -= used;
            }
            return qty - reste;
        }
    };
};

const getLotNumero = (lot) => String(lot?.numLot || lot?.id || '');

// Numéro de lot affiché : 6 chiffres pour les numéros séquentiels, 6 derniers
// caractères pour les anciens identifiants opaques.
const formatLotNumero = (value) => {
    const s = String(value ?? '').trim();
    if (!s) return '';
    return /^\d+$/.test(s) ? s.padStart(6, '0') : s.slice(-6);
};

// Clé de comparaison d'un numéro de lot (« 42 » et « 000042 » sont le même lot)
const normLotNumero = (value) => {
    const s = String(value ?? '').trim();
    return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s;
};

// Plus grand numéro de lot séquentiel jamais attribué. On scanne aussi les
// commandes livrées et les BL : un lot épuisé dont l'entrée PROD- a été
// supprimée ne doit jamais voir son numéro réattribué.
const maxLotNumero = (lots, history, commandes = DB.get('commandes') || [], livraisons = DB.get('livraisons') || []) => {
    let max = 0;
    const scan = (v) => {
        const s = String(v ?? '').trim();
        if (/^\d+$/.test(s)) { const n = parseInt(s, 10); if (n > max) max = n; }
    };
    (lots || []).forEach(l => scan(l.numLot));
    (history || []).forEach(h => scan(h.numLot));
    (commandes || []).forEach(c => (c.lotsUtilises || []).forEach(lu => scan(lu.numLot)));
    (livraisons || []).forEach(l => (l.lotsTraces || []).forEach(t => scan(t.numLot)));
    return max;
};

// Prochain numéro de lot AFFICHÉ : entier séquentiel robuste, indépendant de la
// forme des id internes, jamais réutilisé et jamais un « _ab12… ».
const nextLotNumero = (lots, history) => String(maxLotNumero(lots, history) + 1).padStart(6, '0');

// --- Historique des mouvements de lots ---
// PROD- production, VENTE- vente directe, SORTIE- autre sortie motivée,
// AJUST- correction de quantité (signée), RESTAURE- livraison annulée.
const SORTIE_MOTIFS = {
    vente: 'Vente directe',
    echantillon: 'Dégustation / échantillon',
    casse: 'Casse / perte',
    destruction: 'Destruction / péremption',
    correction: 'Correction de saisie'
};

const getHistoryType = (entry) => {
    const id = String(entry?.id || '');
    if (id.startsWith('VENTE-')) return 'vente';
    if (id.startsWith('SORTIE-')) return 'sortie';
    if (id.startsWith('AJUST-')) return 'ajust';
    if (id.startsWith('RESTAURE-')) return 'retour';
    return 'prod';
};

// Effet de l'entrée sur le stock du lot (en bouteilles, signé)
const getHistoryDelta = (entry) => {
    const q = Number(entry?.quantity) || 0;
    const type = getHistoryType(entry);
    if (type === 'ajust') return q;
    return (type === 'vente' || type === 'sortie') ? -Math.abs(q) : Math.abs(q);
};

const buildLotHistoryEntry = (prefix, lot, quantity, extra = {}) => ({
    id: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    lotId: lot.id,
    numLot: lot.numLot || lot.id,
    arome: lot.arome || '',
    format: lot.format || '',
    quantity,
    productionDate: lot.dateProduction || '',
    dlv: lot.dlv || '',
    dlc: lot.dlc || '',
    dateAdded: new Date().toISOString(),
    ...extra
});

// Client courant s'il existe encore, sinon instantané pris à la livraison
const getClientLabelForTrace = (client, snapshot) =>
    (client || snapshot) ? getClientLabel(client || snapshot) : '(client inconnu)';

// Répercute le renommage d'un arôme/format sur les lots, l'historique et les
// livraisons. Indispensable car les lots référencent l'arôme/format par NOM (texte),
// pas par id : sans cela, un renommage rend les anciens lots invisibles au stock.
const cascadeRenameLots = (field, oldNom, newNom) => {
    if (!oldNom || oldNom === newNom) return;
    const norm = (s) => (s || '').toString().toLowerCase().trim();
    const target = norm(oldNom);
    if (!target) return;

    const lots = DB.get('lots') || [];
    let lotsChanged = false;
    lots.forEach(l => { if (norm(l[field]) === target) { l[field] = newNom; lotsChanged = true; } });
    if (lotsChanged) DB.set('lots', lots);

    const history = DB.get('history') || [];
    let histChanged = false;
    history.forEach(h => { if (norm(h[field]) === target) { h[field] = newNom; histChanged = true; } });
    if (histChanged) DB.set('history', history);

    const commandes = DB.get('commandes') || [];
    let cmdChanged = false;
    commandes.forEach(c => (c.lotsUtilises || []).forEach(lu => { if (norm(lu[field]) === target) { lu[field] = newNom; cmdChanged = true; } }));
    if (cmdChanged) DB.set('commandes', commandes);
};

// Migration idempotente : convertit les anciens numéros de lot non numériques
// (« _ab12… ») en numéros séquentiels lisibles. Ne touche JAMAIS aux id internes
// (clés de sync) ; ne renumérote que numLot + le miroir dans historique/livraisons.
const migrateLotNumeros = () => {
    try {
        const lots = DB.get('lots') || [];
        const history = DB.get('history') || [];
        const needs = lots.filter(l => !/^\d+$/.test(String(l.numLot ?? '').trim()));
        if (needs.length === 0) return;

        let max = maxLotNumero(lots, history);

        const remap = new Map();

        // 1) Lots dont l'id est déjà numérique : on conserve ce numéro lisible tel quel.
        const aMinter = [];
        needs.forEach(l => {
            const idStr = String(l.id ?? '').trim();
            if (/^\d+$/.test(idStr)) {
                l.numLot = idStr;
                remap.set(String(l.id), idStr);
                const n = parseInt(idStr, 10); if (n > max) max = n;
            } else {
                aMinter.push(l);
            }
        });

        // 2) Lots « _ab12… » : on attribue un nouveau numéro séquentiel (sans collision).
        aMinter.sort((a, b) =>
            String(a.dateProduction || '').localeCompare(String(b.dateProduction || '')) ||
            String(a.id).localeCompare(String(b.id))
        );
        aMinter.forEach(l => { max += 1; const nn = String(max).padStart(6, '0'); l.numLot = nn; remap.set(String(l.id), nn); });

        DB.set('lots', lots);

        let histChanged = false;
        history.forEach(h => { const nn = remap.get(String(h.lotId)); if (nn && h.numLot !== nn) { h.numLot = nn; histChanged = true; } });
        if (histChanged) DB.set('history', history);

        const commandes = DB.get('commandes') || [];
        let cmdChanged = false;
        commandes.forEach(c => (c.lotsUtilises || []).forEach(lu => { const nn = remap.get(String(lu.lotId)); if (nn && lu.numLot !== nn) { lu.numLot = nn; cmdChanged = true; } }));
        if (cmdChanged) DB.set('commandes', commandes);
    } catch (e) {
        console.warn('[migration] migrateLotNumeros failed:', e);
    }
};

// Manual sync function — v11-aware flow when ready
window.forceFirebaseSync = async () => {
    const syncBtn = document.getElementById('syncBtn');
    const restoreBtn = setBusy(syncBtn, 'Sync…');
    modal.show('Synchronisation',
        '<div style="text-align:center; padding: 20px;" aria-busy="true"><p><span class="spinner" aria-hidden="true"></span> Synchronisation en cours avec le Cloud...</p><p>Veuillez patienter.</p></div>',
        '');
    document.getElementById('modalClose').style.display = 'none'; // Lock modal during sync
    try {
        // Ensure Firebase is available; attempt dynamic init if absent
        if (!window.firebaseReady || !window.firebaseDb) {
            const ok = await window.initFirebase?.();
            if (!ok) {
                showToast('Impossible de connecter Firebase. Vérifiez votre connexion.', 'error');
                document.getElementById('modalClose').style.display = 'block';
                modal.hide();
                restoreBtn();
                return;
            }
        }

        const queue = v11GetQueue();
        const hasV11Pending = V11._bootstrapping || V11._migrating || queue.length > 0 || V11._isReady;

        if (hasV11Pending && window.firebaseReady && window.firebaseDb) {
            // V11 path: boot (migration si nécessaire) + flush + record store
            await v11BootFirebase();
            // After boot (safe even if already ready — _bootPromise serializes), do full cycle
            if (V11._isReady) {
                // Before pull: capture validated dirty v10 tables' raw data
                const staleDirty = getDirtyTables().filter(t => ALL_TABLES.includes(t));
                const dirtyState = {};
                let dirtyPullBlocked = false;
                if (staleDirty.length > 0) {
                    const validated = v11ValidateDirtyTables(staleDirty);
                    if (!validated.valid) {
                        // Invalid dirty source: don't pull that table, keep local cache
                        showToast(validated.reason + ' Données conservées localement pour cette table.', 'error');
                        dirtyPullBlocked = true;
                    } else {
                        Object.assign(dirtyState, validated.cache);
                    }
                }

                // Flush any pending queue ops first
                await v11FlushQueue();

                // Load record-store from remote
                for (const table of ALL_TABLES) {
                    // If dirty source was invalid, skip pulling this table
                    if (dirtyPullBlocked && staleDirty.includes(table)) {
                        continue;
                    }
                    await v11LoadTableRecords(table);
                }

                // Convert v10 dirty state to v11 operations (local authoritative)
                if (staleDirty.length > 0 && !dirtyPullBlocked) {
                    for (const table of staleDirty) {
                        if (!(table in dirtyState)) continue;
                        const currentRecords = DB.get(table);
                        const dirtyRecords = dirtyState[table];
                        const dirtyIds = new Set(dirtyRecords.map(r => r.id));
                        const currentIds = new Set(currentRecords.map(r => r.id));

                        // Upsert: records present in dirty v10 state
                        for (const rec of dirtyRecords) {
                            if (rec.id) {
                                v11EnqueueOp(table, 'upsert', rec.id, rec);
                            }
                        }
                        // Delete: records in current store but absent from dirty v10
                        for (const curRec of currentRecords) {
                            if (curRec.id && !dirtyIds.has(curRec.id)) {
                                v11EnqueueOp(table, 'delete', curRec.id, null);
                            }
                        }
                    }
                }

                // Apply queue overlay then flush
                v11OverlayQueueOnCache();
                await v11FlushQueue();

                // Only clear dirty flags AFTER queue is persisted
                if (staleDirty.length > 0 && !dirtyPullBlocked) {
                    staleDirty.forEach(t => unmarkDirty(t));
                }

                v11StopAllListeners();
                v11StartAllListeners();
                _renderCurrentViewSafe();
                showToast('Synchronisation collaborative terminée', 'success');
            }
        } else {
            // Legacy flow (pre-migration, aucune trace v11)
            const dirty = getDirtyTables();
            const failedTables = [];
            if (dirty.length > 0) {
                // Validate ALL dirty tables' raw local data BEFORE any push
                const validated = v11ValidateDirtyTables(dirty);
                if (!validated.valid) {
                    showToast(validated.reason + ' Synchronisation légacy refusée. Corrigez les données locales puis réessayez.', 'error');
                    failedTables.push(...dirty.filter(t => ALL_TABLES.includes(t)));
                } else {
                    for (const key of dirty) {
                        if (!ALL_TABLES.includes(key)) continue;
                        // Use cached validated raw data, never DB.get (silently returns [] on corruption)
                        const data = validated.cache[key] || [];
                        const success = await DB.syncToFirebase(key, data);
                        if (!success) failedTables.push(key);
                    }
                    if (failedTables.length > 0) {
                        showToast(`${failedTables.length} table(s) locale(s) non synchronisée(s) — pull partiel`, 'warning');
                    }
                }
            }
            await DB.loadFromFirebase(true, failedTables);
            renderCurrentView();
        }
    } catch(e) {
        console.error('[Sync] Erreur synchronisation:', e);
        showToast('Erreur lors de la synchronisation', 'error');
    } finally {
        document.getElementById('modalClose').style.display = 'block';
        modal.hide();
        restoreBtn();
    }
};

// =============================================================================
// V11 — Firestore collaborative sync: queue flush, per-record API, migration,
//        real-time listeners
// =============================================================================

// --- Queue flush (transactional per-record with conflict detection) ---
// Serialized: only one flush promise at a time. After each success, removes
// ONLY the successful op by op.id from the latest queue snapshot.
const v11FlushQueue = async () => {
    if (!window.firebaseReady || !window.firebaseDb || !window.firebaseApi) return;
    if (!V11._isReady) return;
    // Serialize: if a flush is already in progress, return its promise
    if (V11._flushPromise) return V11._flushPromise;

    const { runTransaction, doc } = window.firebaseApi;
    const rawQueue = v11GetQueue();
    // Strip operations for memory-protected tables (queue persistence failed)
    const protectedCount = rawQueue.filter(op => V11._memoryProtectedTables.has(op.table)).length;
    const startQueue = rawQueue.filter(op => !V11._memoryProtectedTables.has(op.table));
    if (protectedCount > 0) {
        console.warn('[V11]', protectedCount, 'opération(s) ignorée(s) pour table(s) protégée(s) en mémoire');
        v11SetQueue(startQueue);
    }
    if (startQueue.length === 0) return;

    const promise = (async () => {
        const successfulIds = new Set();

        for (const op of startQueue) {
            try {
                const ref = doc(window.firebaseDb, V11.TABLES_COLLECTION, op.table, V11.RECORDS_SUBCOLLECTION, op.recordId);
                let newVersion = Date.now();
                const result = await runTransaction(window.firebaseDb, async (transaction) => {
                    const snap = await transaction.get(ref);
                    const remoteVersion = snap.exists() ? snap.data()._version : null;

                    // Determine conflict: remote changed since we queued
                    let isConflict = false;
                    if (op.type === 'upsert') {
                        if (snap.exists() && (op.knownVersion === null || remoteVersion !== op.knownVersion)) {
                            isConflict = true;
                        } else if (!snap.exists() && op.knownVersion !== null) {
                            isConflict = true;
                        }
                    } else if (op.type === 'delete') {
                        if (snap.exists() && (op.knownVersion === null || remoteVersion !== op.knownVersion)) {
                            isConflict = true;
                        }
                    }

                    // Apply local last-write-wins regardless of conflict
                    if (op.type === 'upsert' && op.record) {
                        transaction.set(ref, {
                            record: op.record,
                            updatedAt: new Date().toISOString(),
                            _version: newVersion
                        });
                    } else if (op.type === 'delete') {
                        if (snap.exists()) {
                            transaction.delete(ref);
                        }
                    }

                    return { isConflict };
                });

                // Notification de conflit (une fois par session par enregistrement).
                // Cas bénin : écriture locale sans version de base connue (1re sync, ou
                // migration au boot avant chargement des versions V11) → LWW local, pas
                // d'alerte utilisateur (console seulement). Seul un vrai conflit concurrent
                // (version de base connue mais divergente à distance) alerte l'utilisateur.
                if (result.isConflict) {
                    const key = `${op.table}/${op.recordId}`;
                    if (op.knownVersion === null) {
                        console.warn(`[V11] « ${op.table} »/${op.recordId} écrit sans version de base connue — version locale conservée (bénin).`);
                    } else if (!V11._conflictNotified.has(key)) {
                        V11._conflictNotified.add(key);
                        showToast(`Conflit sur « ${op.table} »/${op.recordId} : version locale conservée.`, 'warning');
                    }
                }

                // Update local version map
                if (op.type === 'upsert' && op.recordId) {
                    if (!V11._versions[op.table]) V11._versions[op.table] = {};
                    V11._versions[op.table][op.recordId] = newVersion;
                } else if (op.type === 'delete' && op.recordId) {
                    delete V11._versions[op.table]?.[op.recordId];
                }

                successfulIds.add(op.id);
            } catch (e) {
                console.error('[V11] Transaction error for', op.table, op.recordId, e);
            }
        }

        // Remove ONLY the successfully flushed operations by their op.id
        // from the LATEST queue (ops added/merged during await survive).
        const latestQueue = v11GetQueue();
        const remaining = latestQueue.filter(op => !successfulIds.has(op.id));
        if (remaining.length > 0) {
            v11SetQueue(remaining);
            if (successfulIds.size === 0) {
                showToast('Échec de la synchronisation : la file d\'attente attend la reconnexion.', 'warning');
            } else {
                showToast(`${remaining.length} opération(s) en attente de reconnexion`, 'warning');
            }
        } else {
            v11SetQueue([]);
        }

        // Persist updated versions
        v11SaveVersions();
    })();

    V11._flushPromise = promise;
    try {
        await promise;
    } finally {
        V11._flushPromise = null;
        // Détecter les opérations réellement nouvelles ajoutées PENDANT le flush
        // (id absent de startQueue). Planifier exactement un flush additionnel
        // si nécessaire — jamais de retry serré des mêmes opérations en échec.
        const latestQueue = v11GetQueue();
        const startIds = new Set(startQueue.map(op => op.id));
        const hasNewOps = latestQueue.some(op => !startIds.has(op.id));
        if (hasNewOps && window.firebaseReady && window.firebaseDb && V11._isReady) {
            setTimeout(() => v11FlushQueue(), 0);
        }
    }
};

// --- V11 Firestore record helpers ---
const v11GetRecordRef = (table, recordId) => {
    const { doc } = window.firebaseApi;
    return doc(window.firebaseDb, V11.TABLES_COLLECTION, table, V11.RECORDS_SUBCOLLECTION, recordId);
};
const v11GetRecordsCollRef = (table) => {
    const { collection } = window.firebaseApi;
    return collection(window.firebaseDb, V11.TABLES_COLLECTION, table, V11.RECORDS_SUBCOLLECTION);
};

// V11 — Validate ALL documents from a snapshot in a buffer before apply.
// Returns { valid: true, records, versions } or { valid: false, reason: '...' }
// Rules per document: `record` must be a non-null object, `record.id` validated
// via v11ValidateId, unique per buffer, equal to docSnap.id, `_version` finite number.
const v11ValidateSnapshotBuffer = (snapDocs, table) => {
    const records = [];
    const versions = {};
    const seenIds = new Set();
    for (const docSnap of snapDocs) {
        const data = docSnap.data();
        // `record` must be a non-null object
        if (!data || typeof data.record !== 'object' || data.record === null) {
            return { valid: false, reason: `Document ${docSnap.id} : « record » absent ou non-objet.` };
        }
        // `record.id` must exist
        const recId = data.record.id;
        if (!recId || typeof recId !== 'string' || recId.trim() === '') {
            return { valid: false, reason: `Document ${docSnap.id} : « record.id » absent ou invalide.` };
        }
        // Must equal docSnap.id
        if (recId.trim() !== docSnap.id) {
            return { valid: false, reason: `Document ${docSnap.id} : « record.id » (« ${recId} ») ≠ docSnap.id.` };
        }
        // Validate id format
        const idErr = v11ValidateId(recId, seenIds);
        if (idErr) {
            return { valid: false, reason: `Document ${docSnap.id} : ${idErr}` };
        }
        // Duplicate within buffer (v11ValidateId handles uniqueness via seenIds)
        // _version must be a finite number
        if (typeof data._version !== 'number' || !isFinite(data._version)) {
            return { valid: false, reason: `Document ${docSnap.id} : « _version » non numérique ou non finie.` };
        }
        records.push(data.record);
        versions[recId] = data._version;
    }
    return { valid: true, records, versions };
};

// Load all records for a table from the v11 store into localStorage.
// Validates the entire snapshot buffer before applying anything.
// On validation failure, keeps local cache, shows toast, logs, returns null (no partial apply).
const v11LoadTableRecords = async (table) => {
    if (!window.firebaseReady || !window.firebaseDb || !window.firebaseApi) return;
    // Skip memory-protected tables (queue persistence failed)
    if (V11._memoryProtectedTables.has(table)) {
        console.warn('[V11] Table protégée en mémoire, pull refusé pour', table);
        return null;
    }
    // Skip invalidated tables — réactivation possible via DB.set valide
    if (v11GetInvalidTables().includes(table)) {
        console.warn('[V11] Table invalidée, pull refusé pour', table);
        return null;
    }
    try {
        const { getDocs } = window.firebaseApi;
        const snap = await getDocs(v11GetRecordsCollRef(table));
        // Buffer all docs before any validation
        const docList = [];
        snap.forEach(docSnap => docList.push(docSnap));
        // Validate the entire buffer
        const result = v11ValidateSnapshotBuffer(docList, table);
        if (!result.valid) {
            console.error('[V11] Snapshot validation échouée pour', table, '-', result.reason);
            showToast(
                `Données cloud invalides pour « ${table} » : ${result.reason}. Cache local conservé.`,
                'error'
            );
            return null; // Keep local cache
        }
        // All valid — apply
        if (!V11._versions[table]) V11._versions[table] = {};
        Object.assign(V11._versions[table], result.versions);
        v11SaveVersions();
        DB._applyRemoteSnapshot(table, result.records);
        return result.records;
    } catch (e) {
        console.error('[V11] Error loading table records for', table, e);
        return null;
    }
};

// --- V11 Migration ---
const v11GetSchemaDocRef = () => {
    const { doc } = window.firebaseApi;
    return doc(window.firebaseDb, V11.SYNC_META_COLLECTION, V11.SCHEMA_DOC);
};

const v11CheckMigrationStatus = async () => {
    if (!window.firebaseReady || !window.firebaseDb || !window.firebaseApi) return { migrated: false };
    try {
        const { getDoc } = window.firebaseApi;
        const snap = await getDoc(v11GetSchemaDocRef());
        if (snap.exists()) {
            const data = snap.data();
            if (data.version === V11.VERSION && data.ready === true) {
                return { migrated: true, partial: false, data };
            }
            return { migrated: false, partial: true, data };
        }
        return { migrated: false, partial: false, data: null };
    } catch (e) {
        console.error('[V11] Migration status check error:', e);
        return { migrated: false, partial: false, error: e };
    }
};

const v11AcquireMigrationLock = async () => {
    if (!window.firebaseReady || !window.firebaseDb || !window.firebaseApi) return false;
    try {
        const { runTransaction, doc } = window.firebaseApi;
        const lockRef = doc(window.firebaseDb, V11.SYNC_META_COLLECTION, V11.LOCK_DOC);
        const schemaRef = v11GetSchemaDocRef();
        const result = await runTransaction(window.firebaseDb, async (transaction) => {
            // 1. Check if schema already ready in the SAME transaction
            const schemaSnap = await transaction.get(schemaRef);
            if (schemaSnap.exists()) {
                const sd = schemaSnap.data();
                if (sd.version === V11.VERSION && sd.ready === true) {
                    throw new Error('ALREADY_READY');
                }
            }

            // 2. Check lock
            const snap = await transaction.get(lockRef);
            if (snap.exists()) {
                const data = snap.data();
                const now = Date.now();
                const lockTime = data.lockedAt ? new Date(data.lockedAt).getTime() : 0;
                if (data.locked === true && (now - lockTime) < V11.LOCK_EXPIRY_MS) {
                    if (data.owner === V11._sessionId) {
                        // Our own stale lock — allow re-acquire (lease expired)
                    } else {
                        throw new Error('LOCKED');
                    }
                }
            }
            transaction.set(lockRef, {
                locked: true,
                owner: V11._sessionId,
                lockedAt: new Date().toISOString(),
                version: V11.VERSION
            });
            return true;
        });
        return result;
    } catch (e) {
        if (e.message === 'LOCKED') {
            console.error('[V11] Migration lock held by another client');
            showToast('Migration déjà en cours sur un autre appareil. Réessayez dans quelques instants.', 'warning');
        } else if (e.message === 'ALREADY_READY') {
            // Schema already ready — not an error
            return false;
        } else {
            console.error('[V11] Lock acquisition error:', e);
        }
        return false;
    }
};

const v11ReleaseMigrationLock = async () => {
    if (!window.firebaseReady || !window.firebaseDb || !window.firebaseApi) return;
    try {
        const { runTransaction, doc } = window.firebaseApi;
        const lockRef = doc(window.firebaseDb, V11.SYNC_META_COLLECTION, V11.LOCK_DOC);
        await runTransaction(window.firebaseDb, async (transaction) => {
            const snap = await transaction.get(lockRef);
            if (snap.exists()) {
                const data = snap.data();
                // Only delete if we own the lock — never clear another client's lock
                if (data.owner === V11._sessionId) {
                    transaction.delete(lockRef);
                }
            }
            // If lock doesn't exist or we don't own it, no-op
        });
    } catch (e) {
        console.error('[V11] Lock release error:', e);
    }
};

// Helper: refresh lease on the migration lock (called before each table/chunk)
const v11RefreshLease = async () => {
    if (!window.firebaseReady || !window.firebaseDb || !window.firebaseApi) return false;
    try {
        const { runTransaction, doc } = window.firebaseApi;
        const lockRef = doc(window.firebaseDb, V11.SYNC_META_COLLECTION, V11.LOCK_DOC);
        await runTransaction(window.firebaseDb, async (transaction) => {
            const snap = await transaction.get(lockRef);
            if (!snap.exists()) {
                throw new Error('LOCK_LOST');
            }
            const data = snap.data();
            if (data.owner !== V11._sessionId) {
                throw new Error('LOCK_LOST');
            }
            transaction.set(lockRef, {
                locked: true,
                owner: V11._sessionId,
                lockedAt: new Date().toISOString(),
                version: V11.VERSION
            });
        });
        return true;
    } catch (e) {
        if (e.message === 'LOCK_LOST') {
            console.error('[V11] Lease refresh failed — lock perdu ou inexistant');
            showToast('Verrou de migration perdu. Migration annulée.', 'error');
        } else {
            console.error('[V11] Lease refresh error:', e);
        }
        return false;
    }
};

const v11RunMigration = async () => {
    // Check status first
    const status = await v11CheckMigrationStatus();
    if (status.migrated) {
        console.log('[V11] Migration already complete');
        return { success: true, alreadyMigrated: true };
    }

    // Acquire lock — only set lockAcquired after true confirmation
    let lockAcquired = false;
    let lockError = null;
    try {
        const locked = await v11AcquireMigrationLock();
        if (!locked) return { success: false, error: 'LOCK_FAILED' };
        lockAcquired = true;
        V11._migrating = true;   // all writes go to queue during migration
    } catch (e) {
        lockError = e;
    } finally {
        if (lockAcquired) {
            // Will be released in the outer finally after migration completes or fails
        } else if (lockError) {
            console.error('[V11] Lock acquisition threw:', lockError);
            return { success: false, error: 'LOCK_THREW' };
        } else {
            return { success: false, error: 'LOCK_FAILED' };
        }
    }

    const { doc, getDoc, getDocs, collection, runTransaction } = window.firebaseApi;
    const lockRef = doc(window.firebaseDb, V11.SYNC_META_COLLECTION, V11.LOCK_DOC);
    const CHUNK_MAX = 499; // max records per chunk; +1 lock mutation = 500 Firestore limit

    try {
        // Step 1: Push dirty legacy tables (v10 unsynced changes) — VALIDATE FIRST
        const dirty = getDirtyTables();
        const dirtySet = new Set(dirty);
        // Pre-validate ALL dirty tables' raw local data before any push
        // Cache validated data for reuse in Step 2 merge logic.
        const dirtyCache = {};
        if (dirty.length > 0) {
            const validated = v11ValidateDirtyTables(dirty);
            if (!validated.valid) {
                showToast(validated.reason + ' Migration annulée, données locales intactes.', 'error');
                return { success: false, error: 'DIRTY_VALIDATION_FAILED:' + validated.table, table: validated.table };
            }
            Object.assign(dirtyCache, validated.cache);
            // Push only validated dirty tables using cached raw data, never DB.get
            for (const key of dirty) {
                if (!ALL_TABLES.includes(key)) continue;
                try {
                    const data = dirtyCache[key] || [];
                    const ok = await DB.syncToFirebase(key, data);
                    if (!ok) {
                        console.error('[V11] Échec push dirty pre-migration pour', key, '— impossible de garantir cohérence cloud. Migration annulée.');
                        showToast(
                            `Échec de synchronisation cloud de la table « ${key} ». Migration annulée, données legacy intactes.`,
                            'error'
                        );
                        return { success: false, error: 'DIRTY_PUSH_FAILED:' + key, table: key };
                    }
                } catch (e) {
                    console.error('[V11] Pre-migration push threw for', key, e);
                    showToast(
                        `Erreur lors de la synchronisation de « ${key} » vers le cloud. Migration annulée, données legacy intactes.`,
                        'error'
                    );
                    return { success: false, error: 'DIRTY_PUSH_THREW:' + key, table: key };
                }
            }
        }

        // Step 2: Validate ALL records and build merged maps
        // Read localStorage RAW — never pass through DB.get which normalizes [] for corruption.
        // Reuse dirtyCache for tables already validated and pushed.
        // Distinguish: missing key → []; parse error → abort; not array → abort.
        const allTablesValid = [];
        for (const table of ALL_TABLES) {
            let localData = [];
            if (table in dirtyCache) {
                // Reuse cached validated data from Step 1
                localData = dirtyCache[table];
            } else {
                const raw = localStorage.getItem('thecol_' + table);
                if (raw !== null) {
                    try {
                        const parsed = JSON.parse(raw);
                        if (!Array.isArray(parsed)) {
                            showToast(`Données locales corrompues pour « ${table} » : tableau attendu. Migration annulée.`, 'error');
                            console.error('[V11] Table', table, 'local data is not an array');
                            return { success: false, error: 'INVALID_LOCAL_DATA', table };
                        }
                        localData = parsed;
                    } catch (e) {
                        showToast(`Données locales corrompues pour « ${table} » : JSON invalide. Migration annulée.`, 'error');
                        console.error('[V11] Table', table, 'local data malformed JSON:', e);
                        return { success: false, error: 'MALFORMED_LOCAL_DATA', table };
                    }
                } // else: key missing → empty array (permit)
            }

            // Read legacy cloud data (base for merge) — fail-closed
            let legacyData = [];
            try {
                const legacySnap = await getDoc(doc(window.firebaseDb, 'data', table));
                if (legacySnap.exists()) {
                    const d = legacySnap.data().data;
                    if (!Array.isArray(d)) {
                        // Legacy doc exists but data is NOT an array → abort immediately.
                        // No cleanup/write/ready after an invalid source.
                        showToast(
                            `Données legacy cloud corrompues pour « ${table} » (tableau attendu). Migration annulée, données legacy intactes.`,
                            'error'
                        );
                        console.error('[V11] Legacy doc for', table, 'exists but data is not an array:', typeof d);
                        return { success: false, error: 'LEGACY_NOT_ARRAY:' + table, table };
                    }
                    legacyData = d;
                }
            } catch (e) {
                console.error('[V11] Erreur lecture legacy doc pour', table, e);
                showToast(
                    `Erreur lors de la lecture des données legacy pour « ${table} ». Migration annulée, données legacy intactes.`,
                    'error'
                );
                return { success: false, error: 'LEGACY_READ_FAILED:' + table, table };
            }

            // Validate IDs using the centralized helper
            const validateIds = (records, sourceLabel) => {
                const seen = new Set();
                for (const rec of records) {
                    const err = v11ValidateId(rec && rec.id, seen);
                    if (err) {
                        showToast(
                            `${err} dans les données ${sourceLabel} de « ${table} ». Migration annulée, données legacy intactes.`,
                            'error'
                        );
                        console.error(`[V11] ${err} dans ${sourceLabel} de`, table, rec);
                        return { valid: false };
                    }
                }
                return { valid: true };
            };

            const legOk = validateIds(legacyData, 'legacy (cloud)');
            if (!legOk.valid) {
                return { success: false, error: 'INVALID_LEGACY_ID:' + table, table };
            }

            const hasPendingOps = v11GetQueue().some(op => op.table === table);
            const useLocal = dirtySet.has(table) || hasPendingOps || legacyData.length === 0;

            if (useLocal && !(table in dirtyCache)) {
                // Only validate if not already validated via dirty cache
                const locOk = validateIds(localData, 'locales');
                if (!locOk.valid) {
                    return { success: false, error: 'INVALID_LOCAL_ID:' + table, table };
                }
            }

            // Build merged map: start with cloud legacy as base
            const mergedMap = new Map();
            for (const rec of legacyData) {
                mergedMap.set(rec.id, rec);
            }
            if (useLocal) {
                for (const rec of localData) {
                    mergedMap.set(rec.id, rec);
                }
            }

            const merged = Array.from(mergedMap.values());

            allTablesValid.push({ table, merged, legacyPreserved: legacyData.length > 0 });
        }

        // Step 3: For each table, DELETE stale v11 records that are NOT in the final merged set
        // (handles partial migration reprise — cleans up orphaned docs)
        // Each chunk uses runTransaction to atomically verify lock + perform mutations + renew lease.
        for (const { table, merged } of allTablesValid) {
            // Refresh lease before each table
            const leaseOk = await v11RefreshLease();
            if (!leaseOk) {
                return { success: false, error: 'LEASE_LOST', table };
            }

            // List existing v11 records for this table
            let existingIds = new Set();
            try {
                const collRef = collection(window.firebaseDb, V11.TABLES_COLLECTION, table, V11.RECORDS_SUBCOLLECTION);
                const snap = await getDocs(collRef);
                existingIds = new Set();
                snap.forEach(docSnap => { existingIds.add(docSnap.id); });
            } catch (e) {
                console.error('[V11] Erreur liste enregistrements v11 pour', table, e);
                showToast(
                    `Erreur lors de la lecture des enregistrements v11 pour « ${table} ». Migration annulée, données legacy intactes.`,
                    'error'
                );
                return { success: false, error: 'V11_RECORDS_READ_FAILED:' + table, table };
            }

            // Determine stale IDs: existing but not in final merged set
            const mergedIdSet = new Set(merged.map(r => r.id));
            const staleIds = [];
            for (const id of existingIds) {
                if (!mergedIdSet.has(id)) staleIds.push(id);
            }

            // Delete stale records in transactional chunks (max 499 + 1 lock mutation)
            if (staleIds.length > 0) {
                console.log(`[V11] Cleaning ${staleIds.length} stale record(s) from`, table);
                for (let i = 0; i < staleIds.length; i += CHUNK_MAX) {
                    const chunk = staleIds.slice(i, i + CHUNK_MAX);
                    try {
                        await runTransaction(window.firebaseDb, async (transaction) => {
                            // Verify lock ownership + lease INSIDE transaction
                            const ls = await transaction.get(lockRef);
                            if (!ls.exists()) throw new Error('LOCK_LOST');
                            const ld = ls.data();
                            if (ld.owner !== V11._sessionId) throw new Error('LOCK_LOST');
                            const lockT = ld.lockedAt ? new Date(ld.lockedAt).getTime() : 0;
                            if (Date.now() - lockT >= V11.LOCK_EXPIRY_MS) throw new Error('LOCK_EXPIRED');

                            for (const id of chunk) {
                                const ref = doc(window.firebaseDb, V11.TABLES_COLLECTION, table, V11.RECORDS_SUBCOLLECTION, id);
                                transaction.delete(ref);
                            }

                            // Renew lock in same transaction
                            transaction.set(lockRef, {
                                locked: true,
                                owner: V11._sessionId,
                                lockedAt: new Date().toISOString(),
                                version: V11.VERSION
                            });
                        });
                    } catch (e) {
                        if (e.message === 'LOCK_LOST' || e.message === 'LOCK_EXPIRED') {
                            console.error('[V11] Lease perdu pendant nettoyage', table, '-', e.message);
                            showToast('Verrou de migration perdu ou expiré. Migration annulée.', 'error');
                        } else {
                            console.error('[V11] Stale cleanup transaction error for', table, e);
                            showToast('Erreur lors du nettoyage des enregistrements obsolètes. Migration annulée.', 'error');
                        }
                        return { success: false, error: 'CLEANUP_FAILED:' + e.message, table };
                    }
                }
            }
        }

        // Step 4: Write merged records for all tables — transactional chunks (max 499 + lock)
        for (const { table, merged } of allTablesValid) {
            // Refresh lease before each table's write phase
            const leaseOk = await v11RefreshLease();
            if (!leaseOk) {
                return { success: false, error: 'LEASE_LOST', table };
            }

            for (let i = 0; i < merged.length; i += CHUNK_MAX) {
                const chunk = merged.slice(i, i + CHUNK_MAX);
                try {
                    let hasWrites = false;
                    await runTransaction(window.firebaseDb, async (transaction) => {
                        // Verify lock ownership + lease INSIDE transaction
                        const ls = await transaction.get(lockRef);
                        if (!ls.exists()) throw new Error('LOCK_LOST');
                        const ld = ls.data();
                        if (ld.owner !== V11._sessionId) throw new Error('LOCK_LOST');
                        const lockT = ld.lockedAt ? new Date(ld.lockedAt).getTime() : 0;
                        if (Date.now() - lockT >= V11.LOCK_EXPIRY_MS) throw new Error('LOCK_EXPIRED');

                        for (const record of chunk) {
                            // Use centralized validator — never create op with invalid ID
                            const idErr = v11ValidateId(record.id);
                            if (idErr) {
                                console.error('[V11] BUG: ID invalide après validation dans', table, record.id, '-', idErr);
                                continue;
                            }
                            const ref = doc(window.firebaseDb, V11.TABLES_COLLECTION, table, V11.RECORDS_SUBCOLLECTION, record.id);
                            const now = Date.now();
                            transaction.set(ref, {
                                record,
                                updatedAt: new Date().toISOString(),
                                _version: now
                            });
                            if (!V11._versions[table]) V11._versions[table] = {};
                            V11._versions[table][record.id] = now;
                            hasWrites = true;
                        }

                        // Renew lock in same transaction (total = chunk.length + 1 ≤ 500)
                        transaction.set(lockRef, {
                            locked: true,
                            owner: V11._sessionId,
                            lockedAt: new Date().toISOString(),
                            version: V11.VERSION
                        });
                    });
                    // v11SaveVersions outside the transaction (Firestore has no callback after commit)
                    if (hasWrites) {
                        v11SaveVersions();
                    }
                } catch (e) {
                    if (e.message === 'LOCK_LOST' || e.message === 'LOCK_EXPIRED') {
                        console.error('[V11] Lease perdu pendant écriture', table, '-', e.message);
                        showToast('Verrou de migration perdu ou expiré. Migration annulée.', 'error');
                    } else {
                        console.error('[V11] Write transaction error for', table, 'chunk', i, e);
                        showToast('Erreur lors de l\'écriture des données migrées. Migration annulée.', 'error');
                    }
                    return { success: false, error: 'WRITE_FAILED:' + e.message, table, chunk: i };
                }
            }
            console.log('[V11] Table migrée:', table, merged.length, 'enregistrements');
        }

        // Step 5: Mark schema as ready via transaction — verify lease + ownership atomically
        try {
            await runTransaction(window.firebaseDb, async (transaction) => {
                // Re-read schema inside transaction
                const schemaSnap = await transaction.get(v11GetSchemaDocRef());
                if (schemaSnap.exists()) {
                    const sd = schemaSnap.data();
                    if (sd.version === V11.VERSION && sd.ready === true) {
                        // Already ready — not a failure
                        return;
                    }
                }
                // Re-verify lock: owner + lease
                const lRef = doc(window.firebaseDb, V11.SYNC_META_COLLECTION, V11.LOCK_DOC);
                const lockSnap = await transaction.get(lRef);
                if (!lockSnap.exists()) throw new Error('LOCK_LOST');
                const lData = lockSnap.data();
                if (lData.owner !== V11._sessionId) throw new Error('LOCK_LOST');
                const lockTime = lData.lockedAt ? new Date(lData.lockedAt).getTime() : 0;
                if (Date.now() - lockTime >= V11.LOCK_EXPIRY_MS) throw new Error('LOCK_EXPIRED');
                // Write ready
                transaction.set(v11GetSchemaDocRef(), {
                    version: V11.VERSION,
                    ready: true,
                    migratedAt: new Date().toISOString(),
                    tables: ALL_TABLES
                });
                // Renew lock alongside schema ready (atomic)
                transaction.set(lRef, {
                    locked: true,
                    owner: V11._sessionId,
                    lockedAt: new Date().toISOString(),
                    version: V11.VERSION
                });
            });
        } catch (e) {
            if (e.message === 'LOCK_LOST' || e.message === 'LOCK_EXPIRED') {
                console.error('[V11] Schema ready transaction failed:', e.message);
                showToast(
                    'Verrou de migration perdu ou expiré lors de la finalisation. Migration annulée, données legacy intactes.',
                    'error'
                );
            } else {
                console.error('[V11] Schema ready transaction error:', e);
                showToast(
                    'Erreur lors de la finalisation de la migration. Les documents legacy sont conservés.',
                    'error'
                );
            }
            return { success: false, error: 'SCHEMA_READY_FAILED:' + e.message };
        }

        localStorage.setItem(V11.READY_KEY, '1');
        v11SaveVersions();
        console.log('[V11] Migration terminée');
        showToast('Migration v11 terminée avec succès', 'success');
        return { success: true };
    } catch (e) {
        console.error('[V11] Migration error:', e);
        showToast('Erreur lors de la migration des données. Les documents legacy sont conservés intacts.', 'error');
        return { success: false, error: e.message };
    } finally {
        V11._migrating = false;
        if (lockAcquired) {
            try {
                await v11ReleaseMigrationLock();
            } catch (releaseErr) {
                console.error('[V11] Échec libération verrou de migration:', releaseErr);
            }
        }
    }
};

// --- V11 Real-time listeners ---
const v11StartListener = (table) => {
    if (!window.firebaseReady || !window.firebaseDb || !window.firebaseApi) return null;
    // If a listener already exists, unsubscribe first (idempotent relogin/restart)
    if (V11._listeners[table]) {
        const old = V11._listeners[table];
        delete V11._listeners[table];
        if (typeof old === 'function') {
            try { old(); } catch (e) { /* ignore unsubscribe error */ }
        }
    }
    // Skip memory-protected tables (queue persistence failed)
    if (V11._memoryProtectedTables.has(table)) {
        console.warn('[V11] Table protégée en mémoire, listener refusé pour', table);
        return null;
    }
    // Skip invalidated tables — réactivation possible via DB.set valide
    if (v11GetInvalidTables().includes(table)) {
        console.warn('[V11] Table invalidée, listener refusé pour', table);
        return null;
    }
    try {
        const { onSnapshot } = window.firebaseApi;
        const collRef = v11GetRecordsCollRef(table);
        const unsubscribe = onSnapshot(collRef, (snapshot) => {
            // Guard: discard snapshot if session changed (logout/login)
            const sessionGen = _appSessionGen;
            if (!window.firebaseReady || !window._appStarted) return;

            // Buffer ALL docs first, then validate before any apply
            const docList = [];
            let isEmptyStore = true;
            snapshot.forEach(docSnap => {
                isEmptyStore = false;
                docList.push(docSnap);
            });

            // If the snapshot is empty and v11 is not marked ready, don't overwrite local
            if (isEmptyStore && !V11._isReady) {
                return;
            }

            // Validate the entire buffer before applying anything
            const result = v11ValidateSnapshotBuffer(docList, table);
            if (!result.valid) {
                console.error('[V11] Snapshot listener validation échouée pour', table, '-', result.reason);
                showToast(
                    `Données cloud invalides reçues pour « ${table} » : ${result.reason}. Cache local conservé.`,
                    'error'
                );
                return; // No partial apply
            }

            const records = result.records;
            const remoteVersions = result.versions;

            // Map id -> record pour détecter le self-echo de l'écriture locale.
            // Si le document distant reçu par le snapshot est strictement égal
            // au payload en attente (op.record), c'est l'écho renvoyé par
            // Firestore après l'upsert local : aucun conflit à notifier pour
            // cette op. Les vrais conflits concurrents (vraie divergence sur
            // un autre device) ne sont pas affectés.
            const snapshotRecordMap = new Map();
            for (const r of records) {
                if (r && r.id) snapshotRecordMap.set(r.id, r);
            }

            // Conflict detection: compare known versions in pending queue ops with remote versions.
            // Harmonized with flush transaction logic (Fix v11.2): tout document distant existant
            // avec base version inconnue est un conflit LWW local. _conflictNotified évite les doublons.
            const queue = v11GetQueue();
            const pendingForTable = queue.filter(op => op.table === table);
            for (const op of pendingForTable) {
                if (op.type === 'upsert' && op.recordId) {
                    const remoteVersion = remoteVersions[op.recordId];
                    const conflictKey = `${table}/${op.recordId}`;
                    if (remoteVersion !== undefined) {
                        // Self-echo : le snapshot distant est strictement le payload
                        // qu'on vient d'écrire. On saute la notification de conflit
                        // pour cette op, sans toucher à la queue et sans désactiver
                        // les vrais conflits sur d'autres enregistrements.
                        const remoteRecord = snapshotRecordMap.get(op.recordId);
                        if (op.record && remoteRecord &&
                            JSON.stringify(op.record) === JSON.stringify(remoteRecord)) {
                            continue;
                        }
                        if (op.knownVersion === null) {
                            // Bénin : écriture locale sans version de base connue (1re sync /
                            // migration au boot). LWW local — console seulement, pas de toast.
                            console.warn(`[V11] « ${table} »/${op.recordId} : écriture locale sans version de base connue (distante ${remoteVersion}), version locale conservée (bénin).`);
                        } else if (op.knownVersion !== remoteVersion && !V11._conflictNotified.has(conflictKey)) {
                            // Vrai conflit concurrent : version de base connue mais divergente à distance.
                            V11._conflictNotified.add(conflictKey);
                            console.warn(`[V11] Conflit détecté sur « ${table} »/${op.recordId}: version distante ${remoteVersion} ≠ version connue ${op.knownVersion}. Conservation de la version locale.`);
                            showToast(`Conflit sur un enregistrement de « ${table} » : version locale conservée.`, 'warning');
                        }
                    }
                }
            }

            // Update version map with remote versions
            if (!V11._versions[table]) V11._versions[table] = {};
            Object.assign(V11._versions[table], remoteVersions);
            v11SaveVersions();

            // Guard: discard if session changed after validation
            if (sessionGen !== _appSessionGen) return;

            // Apply remote snapshot to localStorage (without triggering sync loop)
            DB._applyRemoteSnapshot(table, records);
            if (sessionGen !== _appSessionGen) return;

            // Re-apply pending queue operations for this table (local wins unconditionally)
            const current = DB.get(table);
            const resultMap = new Map(current.map(r => [r.id, r]));
            for (const op of pendingForTable) {
                if (op.type === 'upsert' && op.record) {
                    resultMap.set(op.recordId, op.record);
                } else if (op.type === 'delete') {
                    resultMap.delete(op.recordId);
                }
            }
            DB._applyRemoteSnapshot(table, Array.from(resultMap.values()));
            if (sessionGen !== _appSessionGen) return;

            // Debounced re-render of current view — différé si un champ dans
            // #content est actif (saisie en cours) ; le snapshot est déjà
            // appliqué à localStorage, seul le re-render visuel est reporté.
            if (V11._debounceTimer) clearTimeout(V11._debounceTimer);
            V11._debounceTimer = setTimeout(() => {
                V11._debounceTimer = null;
                if (sessionGen !== _appSessionGen) return;
                const hash = window.location.hash.slice(1) || 'jumeau';
                const page = hash.split('?')[0];
                if (page !== 'jumeau' && page !== 'dashboard' && page !== 'stock' && page !== 'commandes' &&
                    page !== 'pointage' && page !== 'livraisons' && page !== 'production' &&
                    page !== 'inventaire' && page !== 'parametres' && page !== 'archives' &&
                    page !== 'historique') return;
                _renderCurrentViewSafe();
            }, 300);
        }, (error) => {
            console.error('[V11] Snapshot error for table', table, error);
        });

        V11._listeners[table] = unsubscribe;
        return unsubscribe;
    } catch (e) {
        console.error('[V11] Failed to start listener for', table, e);
        return null;
    }
};

const v11StartAllListeners = () => {
    for (const table of ALL_TABLES) {
        v11StartListener(table);
    }
};

// --- Re-render protection : ne pas remplacer #content pendant qu'une saisie
// est en cours à l'intérieur (les champs dans une modale hors #content sont
// ignorés). Le snapshot est déjà appliqué à localStorage, seul le re-render
// visuel est différé.
const _isContentFieldActive = () => {
    const active = document.activeElement;
    if (!active || active === document.body) return false;
    const content = document.getElementById('content');
    if (!content || !content.contains(active)) return false;
    const tag = (active.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (active.isContentEditable) return true;
    return false;
};

const _renderCurrentViewSafe = () => {
    // Session valide ?
    if (!window.firebaseReady || !window._appStarted) return;
    if (_isContentFieldActive()) {
        V11._pendingRender = true;
        return;
    }
    V11._pendingRender = false;
    renderCurrentView();
};

const _flushPendingRender = () => {
    if (!V11._pendingRender) return;
    V11._pendingRender = false;
    if (!window.firebaseReady || !window._appStarted) return;
    // L'utilisateur a peut-être déjà ouvert un nouveau champ dans #content
    // pendant le délai ; re-vérifier avant de remplacer le DOM.
    if (_isContentFieldActive()) {
        V11._pendingRender = true;
        return;
    }
    // Différer au prochain tick pour ne pas voler le focus tout de suite
    setTimeout(() => {
        if (!window.firebaseReady || !window._appStarted) { V11._pendingRender = false; return; }
        if (_isContentFieldActive()) {
            V11._pendingRender = true;
            return;
        }
        V11._pendingRender = false;
        renderCurrentView();
    }, 50);
};

// Quand un champ dans #content perd le focus, tenter de rejouer le rendu
// différé. Délégation au niveau document pour survivre aux re-renders.
// Le drapeau V11._pendingRender n'est positionné QUE par
// _renderCurrentViewSafe() lorsqu'un rendu doit avoir lieu mais qu'un champ
// de saisie actif dans #content l'empêche. Aucun listener focusin ne doit
// armer ce drapeau en dehors de ce chemin.
if (!window.__v11ContentBlurBound) {
    window.__v11ContentBlurBound = true;
    document.addEventListener('focusout', (e) => {
        const target = e.target;
        if (!target) return;
        const content = document.getElementById('content');
        if (!content || !content.contains(target)) return;
        const tag = (target.tagName || '').toUpperCase();
        const isField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
        if (!isField) return;
        // Idempotent : flusher seulement si un rendu est réellement en attente.
        // _flushPendingRender vérifie lui-même V11._pendingRender et sort sinon.
        if (!V11._pendingRender) return;
        // Attendre que le focus se soit posé ailleurs
        setTimeout(_flushPendingRender, 0);
    }, true);
}

const v11StopAllListeners = () => {
    if (V11._debounceTimer) { clearTimeout(V11._debounceTimer); V11._debounceTimer = null; }
    V11._pendingRender = false;
    for (const [table, unsubscribe] of Object.entries(V11._listeners)) {
        if (typeof unsubscribe === 'function') {
            try { unsubscribe(); } catch (e) { /* ignore */ }
        }
    }
    V11._listeners = {};
};

// Helper: overlay pending queue operations onto a local cache snapshot
// so that local offline changes are never invisible or overwritten.
const v11OverlayQueueOnCache = () => {
    const queue = v11GetQueue();
    if (queue.length === 0) return;
    const byTable = {};
    for (const op of queue) {
        if (!byTable[op.table]) byTable[op.table] = [];
        byTable[op.table].push(op);
    }
    for (const [table, ops] of Object.entries(byTable)) {
        // Skip invalidated tables — ne jamais écraser leur localStorage
        if (v11GetInvalidTables().includes(table)) continue;
        const current = DB.get(table);
        const resultMap = new Map(current.map(r => [r.id, r]));
        for (const op of ops) {
            if (op.type === 'upsert' && op.record && op.record.id) {
                resultMap.set(op.recordId, op.record);
            } else if (op.type === 'delete') {
                resultMap.delete(op.recordId);
            }
        }
        DB._applyRemoteSnapshot(table, Array.from(resultMap.values()));
    }
};

// --- Dynamic Firebase init (retryable) ---
// Fallback utilisé quand le module script d'index.html n'a pas pu se charger
// (réseau lent, cache manquant). Configure à la fois Firestore et Auth pour
// garantir que le callback onAuthStateChanged restaure la session persistée.
// N'appelle JAMAIS initializeApp si une app existe déjà (getApps/getApp).
// Ne montre JAMAIS le bouton Sync — seul le callback auth le fait.
window.initFirebase = async (maxRetries = 3) => {
    if (window.firebaseReady && window.firebaseDb) return true;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const { initializeApp, getApps, getApp } = await import('https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js');
            const {
                getFirestore, doc, setDoc, getDoc, getDocs, collection,
                onSnapshot, deleteDoc, writeBatch, runTransaction
            } = await import('https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js');
            const {
                getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
                setPersistence, browserLocalPersistence
            } = await import('https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js');

            const firebaseConfig = {
                apiKey: "AIzaSyDnENEDX6e9P3KLkuY85qTpSNuAUy3Cb7Y",
                authDomain: "thecol-gestion.firebaseapp.com",
                projectId: "thecol-gestion",
                storageBucket: "thecol-gestion.firebasestorage.app",
                messagingSenderId: "882272705805",
                appId: "1:882272705805:web:542b45499ff27b12a4e444",
                measurementId: "G-E67CGE3Y57"
            };

            // Éviter double initializeApp si le module script a déjà créé l'app
            const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
            const db = getFirestore(app);
            const auth = getAuth(app);
            setPersistence(auth, browserLocalPersistence).catch(() => {});

            window.firebaseApi = {
                doc, setDoc, getDoc, getDocs, collection,
                onSnapshot, deleteDoc, writeBatch, runTransaction
            };
            window.firebaseDb = db;

            // Exposer l'auth si pas déjà fait
            if (!window.firebaseAuth) {
                window.firebaseAuth = {
                    signIn: (password) => signInWithEmailAndPassword(auth, 'gestion@thecol.ch', password),
                    signOut: () => signOut(auth),
                    isAuthenticated: () => !!(auth && auth.currentUser)
                };
            } else if (typeof window.firebaseAuth.isAuthenticated !== 'function') {
                // Si l'init module a exposé l'objet avant ce fallback, ajouter
                // la méthode isAuthenticated en s'appuyant sur cet auth.
                window.firebaseAuth.isAuthenticated = () => !!(auth && auth.currentUser);
            }

            // Restaurer la session persistée — ce callback est essentiel pour
            // que firebaseReady ne devienne true qu'après authentification.
            // Sans lui, initFirebase contournerait l'écran de verrouillage.
            // Le bouton Sync n'est affiché que par ce callback, jamais ici.
            onAuthStateChanged(auth, (user) => {
                const loginScreen = document.getElementById('loginScreen');
                const loginLoading = document.getElementById('loginLoading');
                const loginForm = document.getElementById('loginForm');

                if (user) {
                    window.firebaseReady = true;
                    if (loginScreen) { loginScreen.style.display = 'none'; unlockShell(); }
                    const pwdField = document.getElementById('loginPassword');
                    if (pwdField) pwdField.value = '';
                    document.getElementById('loginError')?.removeAttribute('style');
                    if (typeof window.startApp === 'function') {
                        window.startApp();
                    }
                } else {
                    resetAppSession();
                }
            });

            console.log('Firebase connecté (dynamique avec Auth)');
            return true;
        } catch (e) {
            console.error('[initFirebase] Tentative ' + (attempt + 1) + '/' + maxRetries + ' échouée:', e);
            window.firebaseReady = false;
            if (attempt < maxRetries - 1) {
                await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            }
        }
    }
    return false;
};

// --- V11 boot ---
const v11BootFirebase = async () => {
    // Serialize: if a boot is already in progress, return its promise
    if (V11._bootPromise) return V11._bootPromise;

    // Warn if any table is memory-protected (queue persistence failure)
    if (V11._memoryProtectedTables.size > 0) {
        console.warn('[V11]', V11._memoryProtectedTables.size, 'table(s) protégée(s) en mémoire :',
            [...V11._memoryProtectedTables].join(', '));
    }

    const promise = (async () => {
        // Load persisted versions from localStorage so we always have them even after reload
        v11LoadVersions();

        // Bootstrap mode: if local ready flag is '1' before cloud check,
        // treat DB.set as v11 mode so local changes go to queue, not legacy/dirty.
        if (localStorage.getItem(V11.READY_KEY) === '1') {
            V11._bootstrapping = true;
            V11._isReady = true;
        }

        const waitForFirebase = (timeoutMs = 4000) => new Promise(resolve => {
            const deadline = Date.now() + timeoutMs;
            const check = () => {
                if (window.firebaseReady === true) return resolve(true);
                if (window.firebaseReady === false) return resolve(false);
                if (Date.now() >= deadline) return resolve(false);
                setTimeout(check, 100);
            };
            check();
        });

        const firebaseAvailable = await waitForFirebase();
        if (!firebaseAvailable) {
            console.warn('[V11] Firebase indisponible — fonctionnement hors ligne');
            if (V11._isReady) {
                console.log('[V11] V11 mode actif hors ligne (déjà migré)');
                V11._bootstrapping = false;  // _isReady keeps v11Active true
            } else {
                // Première migration offline : on garde _bootstrapping=true
                // pour que les changements locaux continuent d'être mis en file d'attente
                console.log('[V11] V11 mode actif hors ligne (première migration)');
            }
            return;
        }

        try {
            // 1. Check if v11 is already ready
            const status = await v11CheckMigrationStatus();
            const wasReady = status.migrated;

            if (!wasReady) {
                // If was in bootstrap mode but cloud says not ready -> migration incomplete
                // Transition: disable bootstrap _isReady temporarily for migration
                // (local changes already in queue survive because v11RunMigration reads queue)
                if (V11._bootstrapping) {
                    V11._isReady = false;
                    V11._bootstrapping = false;
                }

                // Run migration — it reads raw validated dirty data (never DB.get) and pushes it,
                // then validates ALL sources before merge. No push happens before validation.
                const result = await v11RunMigration();
                if (!result.success) {
                    console.error('[V11] Migration failed:', result.error);
                    showToast('Migration v11 échouée. Les données locales sont intactes.', 'error');
                    // Keep _bootstrapping = true so writes stay in queue,
                    // never dirty/pull legacy, until next v11Boot.
                    V11._bootstrapping = true;
                    return;
                }
            }

            // Mark v11 as ready for real
            V11._isReady = true;
            V11._bootstrapping = false;
            localStorage.setItem(V11.READY_KEY, '1');

            // 2. Load all table records from v11 store into localStorage
            //    (this may overwrite local-only changes, but v11OverlayQueueOnCache restores them)
            for (const table of ALL_TABLES) {
                await v11LoadTableRecords(table);
            }

            // 3. Overlay pending queue operations on cache (they must survive the pull)
            v11OverlayQueueOnCache();

            // 4. Flush any pending operations to remote
            await v11FlushQueue();

            // 5. Start real-time listeners
            v11StartAllListeners();

            // 6. Re-render current view — protégé si l'utilisateur saisit
            _renderCurrentViewSafe();

            console.log('[V11] Boot complete — collaborative sync active');
            showToast('Synchronisation collaborative active', 'success');
        } catch (e) {
            console.error('[V11] Boot error:', e);
            showToast('Erreur lors de l\'initialisation de la synchronisation', 'error');
        }
    })();

    V11._bootPromise = promise;
    try {
        return await promise;
    } finally {
        V11._bootPromise = null;
    }
};

// Export v11 functions for testing
window.v11Debug = {
    getQueue: v11GetQueue,
    flushQueue: v11FlushQueue,
    mergeOp: v11MergeOp,
    runMigration: v11RunMigration,
    getVersions: () => V11._versions,
    saveVersions: v11SaveVersions,
    conflictNotified: () => V11._conflictNotified,
    status: () => ({
        isReady: V11._isReady,
        bootstrapping: V11._bootstrapping,
        sessionId: V11._sessionId,
        queueLength: v11GetQueue().length,
        listeners: Object.keys(V11._listeners).length,
        hasFlushPromise: V11._flushPromise !== null
    })
};

// Default values from Stock project
const DEFAULT_AROMES = ['hibiscus', 'mure sauvage', 'poire à botzi', 'sureau', 'herbes des alpes'];
const DEFAULT_FORMATS = ['0.25l', '0.5l', '1l'];
const DEFAULT_COULEURS = {
    'hibiscus': '#E74C3C',
    'mure sauvage': '#8E44AD',
    'poire à botzi': '#27AE60',
    'sureau': '#3498DB',
    'herbes des alpes': '#2ECC71'
};

// Initialize default data if empty
// Calculate dates (same as Stock project)
const calculateDates = (productionDate) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(productionDate || ''));
    if (!match) return { dlv: '', dlc: '' };

    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    const source = new Date(year, monthIndex, day);
    if (source.getFullYear() !== year || source.getMonth() !== monthIndex || source.getDate() !== day) {
        return { dlv: '', dlc: '' };
    }

    const addCalendarMonths = (months) => {
        const rawTargetMonth = monthIndex + months;
        const targetYear = year + Math.floor(rawTargetMonth / 12);
        const targetMonthIndex = rawTargetMonth % 12;
        const lastDay = new Date(targetYear, targetMonthIndex + 1, 0).getDate();
        const targetDay = Math.min(day, lastDay);
        return `${targetYear}-${String(targetMonthIndex + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
    };

    return { dlv: addCalendarMonths(1), dlc: addCalendarMonths(6) };
};

const escapeHtml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Safe numeric helper for HTML attribute interpolation.
// Returns the number as a string if finite, otherwise '0'.
const safeNumAttr = (v) => { const n = Number(v); return Number.isFinite(n) ? String(n) : '0'; };

// Allow-list for hex colour values used inline in style attributes.
// Accepts 3/4/6/8 hex digits with optional leading #. Returns the value with
// a leading #, or a safe fallback (#cccccc) when the input is not valid.
const safeColor = (v) => {
    if (!v) return '#cccccc';
    const s = String(v).trim();
    const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(s);
    return m ? '#' + m[1] : '#cccccc';
};

const dateOnly = (d) => {
    if (d instanceof Date) {
        const dt = new Date(d.getTime());
        dt.setHours(0, 0, 0, 0);
        return dt;
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ''));
    if (match) {
        const dt = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        if (dt.getFullYear() === Number(match[1]) && dt.getMonth() === Number(match[2]) - 1 && dt.getDate() === Number(match[3])) {
            return dt;
        }
    }

    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return new Date(NaN);
    dt.setHours(0, 0, 0, 0);
    return dt;
};

const isValidDateOnly = (value) => !Number.isNaN(dateOnly(value).getTime());

const isLotDateRangeValid = (dateProduction, dlv, dlc) => {
    if (!isValidDateOnly(dateProduction) || !isValidDateOnly(dlv) || !isValidDateOnly(dlc)) return false;
    const productionDate = dateOnly(dateProduction);
    const saleLimit = dateOnly(dlv);
    const consumptionLimit = dateOnly(dlc);
    return productionDate <= saleLimit && saleLimit <= consumptionLimit;
};

const isLotSellable = (lot, referenceDate = new Date()) => {
    if (!lot) return false;
    // Lot bloqué (rappel, suspicion qualité) : jamais vendable ni livrable
    if (lot.bloque) return false;
    const refDate = dateOnly(referenceDate);
    if (Number.isNaN(refDate.getTime())) return false;

    // DLV (Date Limite de Vente) est la date de vente primaire
    // Si DLV est présente, elle doit être >= aujourd'hui
    if (lot.dlv) {
        const dlvDate = dateOnly(lot.dlv);
        if (Number.isNaN(dlvDate.getTime()) || dlvDate < refDate) return false;
    }

    // DLC (Date Limite de Consommation) — toujours requise
    if (!lot.dlc) return false;
    const dlcDate = dateOnly(lot.dlc);
    return !Number.isNaN(dlcDate.getTime()) && dlcDate >= refDate;
};

// Statut d'un lot, aligné sur isLotSellable (hors blocage, affiché par un badge
// « Bloqué » distinct) : la DLV fait foi pour la vente,
// la DLC pour la consommation. Lots legacy sans DLV : repli sur la DLC.
//   'expired'    DLC absente, invalide ou dépassée
//   'invendable' DLV dépassée (ou invalide) mais DLC encore valide
//   'warning'    DLV dans moins de DLV_WARN_DAYS jours (legacy : DLC < STOCK_WARN_DAYS)
//   'ok'         sinon
const getLotStatus = (lot, referenceDate = new Date()) => {
    const now = dateOnly(referenceDate);
    const dlcDate = dateOnly(lot?.dlc);
    if (!lot?.dlc || Number.isNaN(dlcDate.getTime()) || now > dlcDate) return 'expired';

    const limit = lot.dlv ? dateOnly(lot.dlv) : dlcDate;
    if (Number.isNaN(limit.getTime()) || now > limit) return 'invendable';

    const warnLimit = new Date(now.getTime());
    warnLimit.setDate(warnLimit.getDate() + (lot.dlv ? CONSTANTS.DLV_WARN_DAYS : CONSTANTS.STOCK_WARN_DAYS));
    return limit <= warnLimit ? 'warning' : 'ok';
};

const getLotStatusLabel = (status, lot) => ({
    expired: 'Expiré',
    invendable: 'Invendable',
    warning: lot?.dlv ? 'DLV proche' : 'DLC proche',
    ok: 'OK'
}[status] || status);

// Toast Notifications
const showToast = (message, type = 'success') => {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
            ${type === 'success' ? '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>' :
              type === 'error' ? '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>' :
              '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'}
        </svg>
        <span>${escapeHtml(message)}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
};

const safeRender = (html) => {
    const el = document.getElementById('content');
    if (el) el.innerHTML = html;
};

const renderEmptyState = (message, actionHtml = '') => `
    <div class="empty-state">
        <p>${escapeHtml(message)}</p>
        ${actionHtml}
    </div>
`;

const formatChf = (n) => {
    if (n === null || n === undefined || isNaN(n)) return 'CHF \u2014';
    if (n === 0) return 'CHF 0.\u2013';
    const abs = Math.abs(n);
    const fixed = abs.toFixed(2);
    const isWhole = fixed.endsWith('.00');
    const integerPart = Math.floor(abs).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
    const sign = n < 0 ? '-' : '';
    return isWhole
        ? `CHF ${sign}${integerPart}.\u2013`
        : `CHF ${sign}${integerPart}.${fixed.split('.')[1]}`;
};

const diagnoseCommandeMontant = (commande, clients, formats) => {
    const client = clients.find(c => c.id === commande.clientId);
    const report = {
        cmdId: commande.id,
        cmdNumero: getCommandeNumero(commande),
        clientId: commande.clientId,
        clientFound: !!client,
        clientLabel: client ? (client.societe || client.nom || '(sans nom)') : '(client introuvable)',
        tarifsCategorie: client ? (client.tarifs || '(vide)') : null,
        items: [],
        total: 0,
        hasPrice: false
    };
    if (!client) return report;
    getItems(commande).forEach((item, idx) => {
        const resolved = resolveCommandeFormat(item, formats);
        const fmt = resolved?.format;
        const key = fmt ? getFormatPriceKey(fmt) : null;
        const rawClient = key ? client[key] : null;
        let priceClient = parseFloat(String(rawClient || '').replace(',', '.'));
        if (isNaN(priceClient)) priceClient = null;
        let pricePreset = null;
        if (key && TARIF_PRESETS[client.tarifs]) {
            pricePreset = parseFloat(TARIF_PRESETS[client.tarifs][key]);
            if (isNaN(pricePreset)) pricePreset = null;
        }
        const priceUsed = (priceClient && priceClient > 0)
            ? priceClient
            : (pricePreset && pricePreset > 0 ? pricePreset : null);
        const ligneTotal = (priceUsed != null) ? priceUsed * (item.quantite || 0) : 0;
        report.items.push({
            idx,
            aromeId: item.aromeId,
            formatId: item.formatId,
            formatFound: !!fmt,
            formatSource: resolved?.source || null,
            formatNom: fmt?.nom || null,
            contenanceCl: fmt?.contenanceCl ?? null,
            priceKey: key,
            priceFromClient: priceClient,
            priceFromPreset: pricePreset,
            priceUsed,
            quantite: item.quantite || 0,
            ligneTotal
        });
        if (priceUsed && priceUsed > 0) {
            report.total += ligneTotal;
            report.hasPrice = true;
        }
    });
    if (!report.hasPrice) report.total = null;
    return report;
};

const getCommandeMontant = (commande, clients, formats) => {
    const r = diagnoseCommandeMontant(commande, clients, formats);
    return r.hasPrice ? r.total : null;
};

if (typeof window !== 'undefined') {
    window.debugMontants = () => {
        const cmds = (DB.get('commandes') || []).slice(0, 20);
        const clients = DB.get('clients') || [];
        const formats = DB.get('formats') || [];
        const report = cmds.map(cmd => diagnoseCommandeMontant(cmd, clients, formats));
        try {
            console.table(report.map(r => ({
                cmd: r.cmdNumero, client: r.clientLabel,
                items: r.items.length, total: r.total, hasPrice: r.hasPrice
            })));
        } catch (_) {}
        console.log('[debugMontants] formats in DB:', formats);
        console.log('[debugMontants] full diag:', report);
        return report;
    };
}

const updateCommandeTotalModal = () => {
    const form = document.getElementById('commandeForm');
    if (!form) return;
    const clientId = form.querySelector('select[name="clientId"]')?.value;
    const clients = DB.get('clients') || [];
    const formats = DB.get('formats') || [];

    const items = [];
    let totalBouteilles = 0;
    form.querySelectorAll('.item-qty-input').forEach(input => {
        const qty = parseInt(input.value, 10) || 0;
        if (qty > 0) {
            const match = input.name.match(/items\[([^\]]+)\]\[([^\]]+)\]/);
            if (match) {
                items.push({ aromeId: match[1], formatId: match[2], quantite: qty });
                totalBouteilles += qty;
            }
        }
    });
    // Client ponctuel : client temporaire avec la catégorie tarif choisie
    let effectiveClients = clients;
    if (clientId === '__ponctuel__') {
        const tarif = form.querySelector('select[name="ponctuelTarif"]')?.value || 'prive';
        effectiveClients = clients.concat({ id: '__ponctuel__', tarifs: tarif });
    }

    const tempCmd = { clientId, items };
    const montant = getCommandeMontant(tempCmd, effectiveClients, formats);

    const totalValueEl = document.getElementById('commandeTotalValue');
    const totalSubEl = document.getElementById('commandeTotalSub');
    if (totalValueEl) totalValueEl.textContent = formatChf(montant);
    if (totalSubEl) totalSubEl.textContent = `${totalBouteilles} bouteille${totalBouteilles > 1 ? 's' : ''}`;
};

const showCommandeMontantDiagModal = (commandeId) => {
    const commandes = DB.get('commandes') || [];
    const clients = DB.get('clients') || [];
    const formats = DB.get('formats') || [];
    const aromes = DB.get('aromes') || [];
    const commande = commandes.find(c => c.id === commandeId);
    if (!commande) return;
    const r = diagnoseCommandeMontant(commande, clients, formats);

    const headerLine = (label, value, ok) => `
        <div style="display:flex; justify-content:space-between; padding: 6px 0; border-bottom: 1px solid var(--border-light); font-size: 12px;">
            <span style="color: var(--text-light);">${escapeHtml(label)}</span>
            <span style="font-weight: 600; color: ${ok ? 'var(--success-light)' : 'var(--danger)'};">${escapeHtml(value)}</span>
        </div>`;

    const itemRows = r.items.map(it => {
        const arome = aromes.find(a => a.id === it.aromeId);
        const aromeNom = arome?.nom || '(arôme inconnu)';
        const fmtLabel = it.formatFound
            ? `<span style="color: var(--success-light);">\u2713 ${escapeHtml(it.formatNom || '')}${it.contenanceCl ? ' (' + it.contenanceCl + ' cl)' : ''}</span>`
            : `<span style="color: var(--danger);">\u2717 format introuvable<br><small style="color: var(--text-light);">formatId: ${escapeHtml(String(it.formatId || ''))}</small></span>`;
        const keyLabel = it.priceKey
            ? `<span style="color: var(--success-light);">${escapeHtml(it.priceKey)}</span>`
            : `<span style="color: var(--danger);">\u2014 (mapping inconnu)</span>`;
        const priceSource = it.priceFromClient > 0 ? `${it.priceFromClient.toFixed(2)} CHF (client)`
                          : it.priceFromPreset > 0 ? `${it.priceFromPreset.toFixed(2)} CHF (preset)`
                          : '\u2014';
        const lineColor = it.priceUsed > 0 ? 'var(--success-light)' : 'var(--danger)';
        return `
            <div style="background: var(--bg-secondary); border-radius: var(--radius-md); padding: 10px; margin-bottom: 8px;">
                <div style="font-weight: 700; color: var(--text); margin-bottom: 6px;">${escapeHtml(aromeNom)} \u00d7 ${it.quantite} bt</div>
                <div style="display:flex; justify-content:space-between; padding: 4px 0; font-size: 12px;"><span style="color: var(--text-light);">Format</span>${fmtLabel}</div>
                <div style="display:flex; justify-content:space-between; padding: 4px 0; font-size: 12px;"><span style="color: var(--text-light);">Cl\u00e9 prix</span>${keyLabel}</div>
                <div style="display:flex; justify-content:space-between; padding: 4px 0; font-size: 12px;"><span style="color: var(--text-light);">Prix utilis\u00e9</span><span style="color: ${lineColor}; font-weight: 600;">${escapeHtml(priceSource)}</span></div>
                <div style="display:flex; justify-content:space-between; padding: 4px 0; font-size: 12px;"><span style="color: var(--text-light);">Total ligne</span><span style="font-weight: 700; color: ${lineColor};">${it.ligneTotal > 0 ? formatChf(it.ligneTotal) : '\u2014'}</span></div>
            </div>`;
    }).join('');

    const recommendation = !r.clientFound
        ? '<p style="color: var(--danger);">\u26a0 Client introuvable : <code>' + escapeHtml(String(r.clientId)) + '</code></p>'
        : r.items.some(i => !i.formatFound)
            ? '<p style="color: var(--warning);">\u26a0 Au moins un format de la commande n\'existe plus en DB (renomm\u00e9/supprim\u00e9). Ouvre la commande pour la modifier et res\u00e9lectionner les formats actuels.</p>'
            : r.items.some(i => !i.priceKey)
                ? '<p style="color: var(--warning);">\u26a0 Le format de cette commande n\'a pas de prix correspondant (contenance non standard : 25cl/50cl/1L attendus).</p>'
                : r.hasPrice
                    ? ''
                    : '<p style="color: var(--warning);">\u26a0 Tous les prix sont vides. Configure les prix du client ou applique un preset (Distributeur/Priv\u00e9).</p>';

    modal.show('Diagnostic Total CHF',
        `<div style="font-size: 13px;">
            <div style="background: var(--white); border-radius: var(--radius-lg); padding: 12px; margin-bottom: 12px; border: 1px solid var(--border-light);">
                ${headerLine('Commande', '#' + r.cmdNumero, true)}
                ${headerLine('Client trouv\u00e9', r.clientLabel, r.clientFound)}
                ${headerLine('Cat\u00e9gorie tarif', r.tarifsCategorie || '\u2014', !!r.tarifsCategorie && r.tarifsCategorie !== 'custom')}
                ${headerLine('Items', String(r.items.length), r.items.length > 0)}
                ${headerLine('Total calculable', r.hasPrice ? 'Oui' : 'Non', r.hasPrice)}
            </div>
            <div style="margin-bottom: 12px;">${recommendation}</div>
            <h4 style="margin-bottom: 8px; font-size: 15px;">D\u00e9tail par ligne</h4>
            ${itemRows || '<p style="color: var(--text-light);">Aucun article.</p>'}
        </div>`,
        `<button class="btn btn-secondary" onclick="modal.hide()">Fermer</button>`
    );
};

const renderSegmentedFilter = (name, currentValue, options, renderFnName) => `
    <div class="segmented-filter" role="group" aria-label="${escapeHtml(name)}">
        ${options.map(opt => `
            <button type="button" class="segment ${currentValue === opt.value ? 'active' : ''}" data-click="set-filter" data-name="${escapeHtml(name)}" data-value="${escapeHtml(opt.value)}" data-render="${escapeHtml(renderFnName)}">
                ${escapeHtml(opt.label)}
            </button>
        `).join('')}
    </div>
`;

const getClientLabel = (client) => client ? (client.societe || client.nom || 'Client sans nom') : 'N/A';

const getStatusLabel = (status) => getCommandeStatutLabel(status);

const includesText = (value, query) => {
    if (!query) return true;
    return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(
        String(query || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    );
};

const getGlobalSearchMatches = (query) => {
    const q = String(query || '').trim();
    if (q.length < 2) return [];

    const commandes = DB.get('commandes') || [];
    const clients = DB.get('clients') || [];
    const livraisons = DB.get('livraisons') || [];
    const lots = DB.get('lots') || [];
    const matches = [];

    commandes.forEach(cmd => {
        const client = clients.find(c => c.id === cmd.clientId);
        const label = `Commande #${getCommandeNumero(cmd)} - ${getClientLabel(client)}`;
        if (includesText(label, q) || includesText(cmd.statut, q)) {
            matches.push({ type: 'commande', id: cmd.id, label, meta: getStatusLabel(cmd.statut) });
        }
    });

    clients.forEach(client => {
        const label = getClientLabel(client);
        if (includesText(label, q) || includesText(client.email, q) || includesText(client.telephone, q)) {
            matches.push({ type: 'client', id: client.id, label, meta: 'Client' });
        }
    });

    livraisons.forEach(liv => {
        const client = clients.find(c => c.id === liv.clientId);
        const label = `BL-${getBLNumero(liv)} - ${getClientLabel(client)}`;
        const lotTrouve = (liv.lotsTraces || []).find(t => includesText(formatLotNumero(t.numLot || t.lotId), q));
        if (includesText(label, q) || includesText(liv.dateBL, q) || lotTrouve) {
            const meta = lotTrouve ? `Lot #${formatLotNumero(lotTrouve.numLot || lotTrouve.lotId)} livré` : (liv.dateBL || 'Livraison');
            matches.push({ type: 'livraison', id: liv.id, label, meta });
        }
    });

    lots.forEach(lot => {
        const label = `Lot #${formatLotNumero(getLotNumero(lot))} - ${lot.arome || ''} ${lot.format || ''}`;
        if (includesText(label, q) || includesText(lot.dlc, q)) {
            matches.push({ type: 'lot', id: lot.id, label, meta: `${lot.quantite || 0} bt` });
        }
    });

    return matches.slice(0, 8);
};

const renderGlobalSearchResults = () => {
    const input = document.getElementById('globalSearchInput');
    const resultsEl = document.getElementById('globalSearchResults');
    if (!input || !resultsEl) return;

    const matches = getGlobalSearchMatches(input.value);
    if (matches.length === 0) {
        resultsEl.classList.remove('active');
        resultsEl.innerHTML = '';
        return;
    }

    resultsEl.innerHTML = matches.map(match => `
        <button type="button" class="global-search-result" data-click="global-search-result" data-type="${escapeHtml(match.type)}" data-id="${escapeHtml(match.id)}">
            <span>${escapeHtml(match.label)}</span>
            <small>${escapeHtml(match.meta)}</small>
        </button>
    `).join('');
    resultsEl.classList.add('active');
};

const openGlobalSearchResult = (type, id) => {
    const input = document.getElementById('globalSearchInput');
    const resultsEl = document.getElementById('globalSearchResults');
    if (input) input.value = '';
    if (resultsEl) {
        resultsEl.classList.remove('active');
        resultsEl.innerHTML = '';
    }

    if (type === 'commande') {
        window.location.hash = '#commandes';
        setTimeout(() => showCommandeDetails(id), 100);
        return;
    }
    if (type === 'client') {
        DB.setFilter('commandeClient', id);
        if (window.location.hash === '#commandes') renderCommandes();
        else window.location.hash = '#commandes';
        return;
    }
    if (type === 'livraison') {
        window.location.hash = '#livraisons';
        setTimeout(() => showLivraisonDetails(id), 100);
        return;
    }
    if (type === 'lot') {
        DB.setFilter('stockQuery', id);
        DB.setFilter('stockArome', '');
        DB.setFilter('stockFormat', '');
        DB.setFilter('stockStatut', '');
        if (window.location.hash === '#stock') renderStock();
        else window.location.hash = '#stock';
    }
};

const initGlobalSearch = () => {
    if (window._initGlobalSearchDone) return;
    window._initGlobalSearchDone = true;
    const input = document.getElementById('globalSearchInput');
    const resultsEl = document.getElementById('globalSearchResults');
    if (!input || !resultsEl) return;

    input.addEventListener('input', renderGlobalSearchResults);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            input.value = '';
            resultsEl.classList.remove('active');
            resultsEl.innerHTML = '';
        }
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.global-search')) {
            resultsEl.classList.remove('active');
        }
    });
};

// UI Lock helper (Anti-Double Clic)
const disableSaveBtn = (event) => {
    if (!event || !event.target) return null;
    const btn = event.target;
    if (btn.tagName !== 'BUTTON') return null;
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'En cours...';
    return () => {
        btn.disabled = false;
        btn.innerHTML = originalText;
    };
};

// Modal
const modal = {
    _previouslyFocused: null,
    show: (title, body, footer, size = '') => {
        const titleEl = document.getElementById('modalTitle');
        const bodyEl = document.getElementById('modalBody');
        const footerEl = document.getElementById('modalFooter');
        const overlayEl = document.getElementById('modalOverlay');
        if (titleEl) titleEl.textContent = title || '';
        if (bodyEl) bodyEl.innerHTML = body || '';
        if (footerEl) footerEl.innerHTML = footer || '';
        if (overlayEl) {
            overlayEl.classList.add('active');
            overlayEl.setAttribute('aria-hidden', 'false');
        }
        const container = document.getElementById('modalContainer');
        if (container) {
            container.className = 'modal-container' + (size === 'large' ? ' modal-large' : '');
        }
        modal._previouslyFocused = document.activeElement;
        const focusableSelector = 'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])';
        // Prefer focusing inside the body (form fields). Fall back to footer (action buttons),
        // which is what we want for confirmDialog whose body has no inputs.
        const bodyFocusables = bodyEl ? bodyEl.querySelectorAll(focusableSelector) : [];
        const footerFocusables = footerEl ? footerEl.querySelectorAll(focusableSelector) : [];
        const target = bodyFocusables[0] || footerFocusables[0] || document.getElementById('modalClose');
        if (target) setTimeout(() => target.focus(), 0);
    },
    hide: () => {
        const overlayEl = document.getElementById('modalOverlay');
        if (overlayEl) {
            overlayEl.classList.remove('active');
            overlayEl.setAttribute('aria-hidden', 'true');
        }
        if (modal._previouslyFocused && typeof modal._previouslyFocused.focus === 'function') {
            modal._previouslyFocused.focus();
            modal._previouslyFocused = null;
        }
    }
};

document.getElementById('modalClose').addEventListener('click', modal.hide);
document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) modal.hide();
});

// Close modal on Escape; trap Tab inside modal while open
document.addEventListener('keydown', (e) => {
    const overlayEl = document.getElementById('modalOverlay');
    if (!overlayEl || !overlayEl.classList.contains('active')) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        modal.hide();
        return;
    }
    if (e.key === 'Tab') {
        const focusables = overlayEl.querySelectorAll(
            'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }
});

// State variables for pointage and weekly calendar
let pointageSelectedEmployeId = null;
let pointageClockInterval = null;
let weekCalendarSelectedDate = '';
let _commandeModalClientOptions = [];

// Session generation counter — incremented on each successful login/logout
// so that async callbacks (snapshots, debounce) from a prior session are inert.
let _appSessionGen = 0;

// Navigation
const router = () => {
    if (!window.firebaseReady || !window._appStarted) return;
    const hash = window.location.hash.slice(1) || 'jumeau';
    const page = hash.split('?')[0];
    navigateTo(page);
};

let _lastRenderedPage = null;
let _contentEnterTimer = 0;

const navigateTo = (page) => {
    document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll(`[data-page="${page}"]`).forEach(el => el.classList.add('active'));
    // L'historique fait partie de la section Stock : garder l'onglet Stock actif
    if (page === 'historique') {
        document.querySelectorAll('[data-page="stock"]').forEach(el => el.classList.add('active'));
    }
    // Pages du menu « Plus » : allumer le bouton Plus
    const morePages = ['dashboard', 'pointage', 'livraisons', 'inventaire', 'parametres'];
    if (morePages.includes(page)) {
        document.getElementById('moreNavBtn')?.classList.add('active');
    }

    const titles = {
        jumeau: 'Jumeau numérique',
        dashboard: 'Tableau de bord',
        stock: 'Gestion du stock',
        pointage: 'Pointage',
        commandes: 'Commandes',
        livraisons: 'Livraisons',
        archives: 'Archives',
        production: 'Planificateur de production',
        historique: 'Historique de production',
        inventaire: 'Inventaire',
        parametres: 'Paramètres'
    };
    const titleEl = document.getElementById('pageTitle');
    if (titleEl) titleEl.textContent = titles[page] || titles.jumeau;

    const views = {
        jumeau: renderJumeau,
        dashboard: renderDashboard,
        stock: renderStock,
        pointage: renderPointage,
        commandes: renderCommandes,
        livraisons: renderLivraisons,
        archives: renderArchives,
        production: renderProduction,
        historique: renderHistorique,
        inventaire: renderInventaire,
        parametres: renderParametres
    };

    const contentEl = document.getElementById('content');
    if (!contentEl) return;

    const target = typeof views[page] === 'function' ? page : 'jumeau';
    contentEl.classList.toggle('content--twin', target === 'jumeau');
    // Transition d'entrée uniquement au changement de page (pas sur un re-rendu temps réel)
    if (_lastRenderedPage !== target) {
        _lastRenderedPage = target;
        contentEl.classList.remove('content-enter');
        void contentEl.offsetWidth;
        contentEl.classList.add('content-enter');
        clearTimeout(_contentEnterTimer);
        _contentEnterTimer = setTimeout(() => contentEl.classList.remove('content-enter'), 450);
    }
    views[target]();
};

// Render Current View dynamically
const renderCurrentView = () => {
    if (!window.firebaseReady || !window._appStarted) return;
    const hash = window.location.hash.slice(1) || 'jumeau';
    const page = hash.split('?')[0];
    navigateTo(page);
};

// Global Error Handling
window.addEventListener('error', (e) => {
    if (e.message && e.message.includes('ResizeObserver')) return; // Ignore benign browser errors
    showToast(`Erreur système : ${e.message}`, 'error');
});
window.addEventListener('unhandledrejection', (e) => {
    showToast(`Erreur réseau/sync : ${e.reason || 'inconnue'}`, 'error');
});

// Cross-tab synchronization
window.addEventListener('storage', (e) => {
    if (!window.firebaseReady || !window._appStarted) return;
    if (e.key && e.key.startsWith('thecol_')) {
        renderCurrentView();
    }
});

window.addEventListener('hashchange', router);

const addTodo = (text) => {
    if (!text || !text.trim()) return;
    const todos = DB.get('todos') || [];
    todos.unshift({
        id: generateId(),
        text: text.trim(),
        done: false,
        dateAdded: new Date().toISOString()
    });
    DB.set('todos', todos);
    renderDashboard();
};

const toggleTodo = (id) => {
    const todos = DB.get('todos') || [];
    const todo = todos.find(t => t.id === id);
    if (todo) {
        todo.done = !todo.done;
        DB.set('todos', todos);
        renderDashboard();
    }
};

const deleteTodo = (id) => {
    const todos = (DB.get('todos') || []).filter(t => t.id !== id);
    DB.set('todos', todos);
    renderDashboard();
};

// Dashboard
const renderDashboard = () => {
    const lots = DB.get('lots') || [];
    const commandes = DB.get('commandes') || [];
    const todos = DB.get('todos') || [];
    const aromes = DB.get('aromes') || [];
    const formats = DB.get('formats') || [];

    const today = new Date();
    const inSevenDays = new Date();
    inSevenDays.setDate(inSevenDays.getDate() + 7);
    const inThreeDays = new Date();
    inThreeDays.setDate(inThreeDays.getDate() + 3);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const lotStatuses = lots.map(lot => getLotStatus(lot, today));
    const expiries = lotStatuses.filter(st => st === 'expired').length;
    const invendables = lotStatuses.filter(st => st === 'invendable').length;
    const dlvProches = lotStatuses.filter(st => st === 'warning').length;
    const sellableBottles = lots.filter(lot => isLotSellable(lot, today)).reduce((sum, lot) => sum + (lot.quantite || 0), 0);

    // Stock produit ces 7 derniers jours
    const stockLast7Days = lots
        .filter(lot => lot.dateProduction && new Date(lot.dateProduction) >= sevenDaysAgo)
        .reduce((sum, lot) => sum + (lot.quantite || 0), 0);

    const commandesEnAttente = commandes.filter(c => c.statut === 'en_attente');
    const commandesUrgentes = commandesEnAttente.filter(c => c.dateLivraison && new Date(c.dateLivraison) <= inThreeDays).length;

    const commandesPeriode = commandes.filter(c => c.statut !== 'annulee' && c.statut !== 'livrée');
    const stockPool = createStockPool(lots, today);

    const besoins = {};
    sortCommandesByDateLivraison(commandesPeriode).forEach(({ commande: cmd }) => {
        getItems(cmd).forEach(item => {
            const arome = aromes.find(a => a.id === item.aromeId);
            const format = formats.find(f => f.id === item.formatId);
            const key = `${arome?.nom || ''}-${format?.nom || ''}`;
            if (!besoins[key]) {
                besoins[key] = {
                    aromeId: item.aromeId,
                    formatId: item.formatId,
                    aromeNom: arome?.nom || '',
                    formatNom: format?.nom || '',
                    quantite: 0,
                    disponible: 0
                };
            }
            besoins[key].quantite += item.quantite;
            besoins[key].disponible += stockPool.take(key, Number(item.quantite) || 0, cmd.dateLivraison);
        });
    });

    const bouteillesAProduire = Object.values(besoins).map(b => {
        const aProduire = Math.max(0, b.quantite - b.disponible);
        return { ...b, aProduire };
    }).filter(b => b.aProduire > 0).sort((a, b) => b.aProduire - a.aProduire);

    const totalBouteillesAProduire = bouteillesAProduire.reduce((sum, b) => sum + b.aProduire, 0);

    const alertParts = [
        expiries > 0 ? `${expiries} expiré${expiries > 1 ? 's' : ''}` : '',
        invendables > 0 ? `${invendables} invendable${invendables > 1 ? 's' : ''} (DLV dépassée)` : '',
        dlvProches > 0 ? `${dlvProches} DLV proche${dlvProches > 1 ? 's' : ''}` : ''
    ].filter(Boolean);
    const showAlert = alertParts.length > 0;

    safeRender(`
        <div class="page-header-big">
            <h1>Aujourd'hui</h1>
            <div class="header-subtext">${formatDate(today)}</div>
        </div>

        <div class="card" style="margin-bottom: 16px;">
            <div class="card-header" style="margin-bottom: 12px; padding-bottom: 0; border: none;">
                <h3 class="card-title">À faire</h3>
            </div>
            <div style="display:flex; gap:8px; margin-bottom:12px;">
                <input type="text" id="todoInput" placeholder="Ajouter une tâche..." style="flex:1;" onkeydown="if(event.key==='Enter'){addTodo(this.value); this.value='';}">
                <button class="btn btn-primary btn-sm" onclick="const inp=document.getElementById('todoInput'); addTodo(inp.value); inp.value='';">Ajouter</button>
            </div>
            <div class="dash-todo-list">
                ${todos.length === 0 ? '<p style="color: var(--text-light); font-size: 13px; padding: 8px 0;">Aucune tâche. Ajoute-en une ci-dessus.</p>' : todos.map(t => `
                    <div class="dash-todo-item ${t.done ? 'done' : ''}" style="cursor:pointer;" data-click="toggle-todo" data-id="${escapeHtml(t.id)}">
                        <span class="dash-todo-check" style="${t.done ? 'display:flex;align-items:center;justify-content:center;color:white;font-size:12px;' : ''}">${t.done ? '✓' : ''}</span>
                        <span class="dash-todo-label">${escapeHtml(t.text)}</span>
                        <button class="btn-bare" style="color: var(--text-lighter); font-size: 16px; padding: 0 4px;" data-click="delete-todo" data-id="${escapeHtml(t.id)}" data-stop aria-label="Supprimer">✕</button>
                    </div>
                `).join('')}
            </div>
        </div>

        <div class="dash-kpi-grid">
            <a href="#stock" class="dash-kpi-card">
                <div class="dash-kpi-label">Stock vendable</div>
                <div class="dash-kpi-value">${sellableBottles}</div>
                <div class="dash-kpi-sub">${stockLast7Days > 0 ? `↑ +${stockLast7Days} cette semaine` : 'aucune prod cette semaine'}</div>
            </a>
            <a href="#commandes" class="dash-kpi-card">
                <div class="dash-kpi-label">Commandes</div>
                <div class="dash-kpi-value">${commandesEnAttente.length}</div>
                <div class="dash-kpi-sub ${commandesUrgentes > 0 ? 'urgent' : ''}">${commandesUrgentes > 0 ? `${commandesUrgentes} urgente${commandesUrgentes > 1 ? 's' : ''}` : 'en attente'}</div>
            </a>
        </div>

        ${showAlert ? `
            <a href="#stock" class="dash-alert">
                <span class="dash-alert-icon">⚠️</span>
                <div class="dash-alert-text">
                    <strong>Stock à vérifier</strong>
                    ${alertParts.join(' • ')}
                </div>
                <span class="dash-todo-arrow">›</span>
            </a>
        ` : ''}

        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Bouteilles à produire</h3>
                ${totalBouteillesAProduire > 0 ? `<a href="#production" class="btn btn-sm btn-ghost">Voir tout</a>` : ''}
            </div>
            ${bouteillesAProduire.length === 0 ? '<p style="color: var(--text-light); font-size: 13px;">Tout le stock est disponible ✓</p>' : `
                ${bouteillesAProduire.slice(0, 5).map((b, index, arr) => {
                    const arome = aromes.find(a => a.id === b.aromeId);
                    const format = formats.find(f => f.id === b.formatId);
                    const formatLitres = format?.contenanceCl ? `${(format.contenanceCl / 100).toFixed(2).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')}l` : b.formatNom;
                    return `<div class="flex-between" style="padding: 10px 0; ${index < arr.length - 1 ? 'border-bottom: 1px solid var(--border-light);' : ''}">
                        <span style="display: inline-flex; align-items: center; gap: 8px;"><span class="color-dot" style="background: ${safeColor(arome?.couleur)}; width: 10px; height: 10px; border-radius: 50%; display: inline-block;"></span>${escapeHtml(b.aromeNom)} ${escapeHtml(formatLitres)}</span>
                        <div style="text-align: right;">
                            <div style="font-size: 12px; color: var(--text-light);">Stock : ${b.disponible}</div>
                            <strong style="color: var(--primary);">À produire : ${b.aProduire}</strong>
                        </div>
                    </div>`;
                }).join('')}
                ${bouteillesAProduire.length > 5 ? `<div style="text-align: center; padding-top: 10px;"><a href="#production" style="color: var(--primary); font-size: 12px; text-decoration: none;">+ ${bouteillesAProduire.length - 5} autres</a></div>` : ''}
                <div class="flex-between" style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-light);">
                    <strong>Total : ${totalBouteillesAProduire} bt</strong>
                    <a href="#production" class="btn btn-sm btn-primary">Planifier</a>
                </div>
            `}
        </div>
    `);
};

// =============================================================================
// Jumeau numérique 3D (v12.0) — TWIN-3D
// L'atelier ThéCol reconstruit en 3D à partir des données synchronisées :
// cuves (besoins de production), entrepôt (lots par arôme × format), quai
// d'expédition (commandes actives), magasin (consommables) et équipe
// (pointages du jour). Three.js est embarqué dans vendor/three/ et chargé à la
// demande via import() : aucun coût pour les autres pages, fonctionne hors ligne.
// =============================================================================

const TWIN_ZONES = [
    { id: 'production', label: 'Production', key: '1', bounds: [-11.4, -7.4, -1.8, -1.0], token: '--primary' },
    { id: 'stock', label: 'Entrepôt', key: '2', bounds: [1.8, -7.4, 11.4, -1.0], token: '--info' },
    { id: 'expedition', label: 'Expédition', key: '3', bounds: [1.8, 1.4, 11.4, 7.4], token: '--warning' },
    { id: 'magasin', label: 'Consommables', key: '4', bounds: [-11.4, 1.4, -1.8, 7.4], token: '--warning-dark' },
    { id: 'equipe', label: 'Équipe', key: '5', bounds: [-1.4, 1.6, 1.4, 7.4], token: '--success' }
];
const TWIN_VIEW_OVERVIEW = { target: [1.2, 0, 0.2], pos: [3.8, 15.5, 17.5] };
const TWIN_STAFF_COLORS = ['#5D7B3E', '#2E72B8', '#B9770E', '#8E44AD', '#C0392B', '#16A085', '#D35400', '#34495E'];

const twinClamp = (v, min, max) => Math.min(max, Math.max(min, v));
const twinFmtInt = (n) => Math.round(Number(n) || 0).toLocaleString('fr-CH');
const twinFmtLitres = (l) => `${(Math.round((Number(l) || 0) * 10) / 10).toLocaleString('fr-CH')} L`;
const twinFmtDuration = (minutes) => {
    const m = Math.max(0, Math.round(Number(minutes) || 0));
    return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
};
const twinDaysUntil = (dateStr) => {
    if (!dateStr || !isValidDateOnly(dateStr)) return null;
    return Math.round((dateOnly(dateStr).getTime() - dateOnly(new Date()).getTime()) / 86400000);
};
const twinRelativeDay = (days) => {
    if (days === null) return 'sans date';
    if (days === 0) return "aujourd'hui";
    if (days === 1) return 'demain';
    if (days === -1) return 'hier';
    return days > 0 ? `dans ${days} j` : `en retard de ${-days} j`;
};
const twinCrateSize = (contenanceCl) => (contenanceCl <= 30 ? 24 : contenanceCl <= 60 ? 12 : 6);
const twinPresenceMinutes = (p, nowMin) => {
    const debut = parseHHMM(p.heureDebut);
    if (debut === null) return 0;
    if (!p.heureFin) return computePointageMinutes(debut, nowMin, 0) || 0;
    return computePointageMinutes(debut, parseHHMM(p.heureFin), Number(p.pause) || 0) || 0;
};

// --- Modèle : projection des tables métier vers les objets de l'atelier ---
const buildTwinModel = () => {
    const now = new Date();
    const todayKey = getLocalDateISOString();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const lots = DB.get('lots') || [];
    const commandes = DB.get('commandes') || [];
    const aromes = DB.get('aromes') || [];
    const formats = DB.get('formats') || [];
    const clients = DB.get('clients') || [];
    const recettes = DB.get('recettes') || [];
    const inventaire = DB.get('inventaire') || [];
    const employees = DB.get('employees') || [];
    const pointages = DB.get('pointages') || [];

    const findArome = (nom) => aromes.find(a => normalizeName(a.nom) === normalizeName(nom));
    const aromeColor = (nom) => safeColor(findArome(nom)?.couleur || DEFAULT_COULEURS[String(nom || '').toLowerCase()]);
    const aromeNames = new Map();
    const formatNames = new Map();
    const addName = (map, nom) => {
        const k = normalizeName(nom);
        if (k && !map.has(k)) map.set(k, nom);
    };
    aromes.filter(a => a.actif !== false).forEach(a => addName(aromeNames, a.nom));
    [...formats]
        .sort((a, b) => (Number(a.contenanceCl) || 0) - (Number(b.contenanceCl) || 0))
        .forEach(f => addName(formatNames, f.nom));

    const activeCommandes = commandes.filter(c => c.statut !== 'annulee' && c.statut !== 'livrée');
    const demand = new Map();
    // Stock couvrant la demande : lots vendables à la date de livraison de chaque
    // commande, consommés par DLV croissante (même règle que le planificateur).
    const stockPool = createStockPool(lots, now, lot => `${normalizeName(lot.arome)}|${normalizeName(lot.format)}`);
    const covered = new Map();
    sortCommandesByDateLivraison(activeCommandes).forEach(({ commande: cmd }) => getItems(cmd).forEach(item => {
        const arome = aromes.find(a => a.id === item.aromeId);
        const format = resolveCommandeFormat(item, formats)?.format;
        const qty = Number(item.quantite) || 0;
        if (!arome || !format || qty <= 0) return;
        addName(aromeNames, arome.nom);
        addName(formatNames, format.nom);
        const key = `${normalizeName(arome.nom)}|${normalizeName(format.nom)}`;
        demand.set(key, (demand.get(key) || 0) + qty);
        covered.set(key, (covered.get(key) || 0) + stockPool.take(key, qty, cmd.dateLivraison));
    }));

    const groups = new Map();
    lots.forEach(lot => {
        if ((Number(lot.quantite) || 0) <= 0) return;
        addName(aromeNames, lot.arome);
        addName(formatNames, lot.format);
        const key = `${normalizeName(lot.arome)}|${normalizeName(lot.format)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(lot);
    });

    const slotKeys = new Set([...groups.keys(), ...demand.keys()]);
    const slotList = [...slotKeys];
    const rowKeys = [...aromeNames.keys()].filter(ak => slotList.some(k => k.startsWith(`${ak}|`)));
    const colKeys = [...formatNames.keys()].filter(fk => slotList.some(k => k.endsWith(`|${fk}`)));

    const stacks = [];
    rowKeys.forEach((ak, row) => colKeys.forEach((fk, col) => {
        const key = `${ak}|${fk}`;
        if (!slotKeys.has(key)) return;
        const arome = aromeNames.get(ak);
        const format = formatNames.get(fk);
        const contenanceCl = resolveFormatContenance(format, formats);
        const lotsInfo = (groups.get(key) || [])
            .slice()
            .sort((a, b) => String(a.dlv || a.dlc || '').localeCompare(String(b.dlv || b.dlc || '')))
            .map(lot => ({
                id: lot.id,
                numero: getLotNumero(lot),
                quantite: Number(lot.quantite) || 0,
                dlv: lot.dlv || '',
                dlc: lot.dlc || '',
                dateProduction: lot.dateProduction || '',
                status: getLotStatus(lot, now),
                bloque: !!lot.bloque,
                sellable: isLotSellable(lot, now)
            }));
        const total = lotsInfo.reduce((s, l) => s + l.quantite, 0);
        const sellable = lotsInfo.filter(l => l.sellable).reduce((s, l) => s + l.quantite, 0);
        const expired = lotsInfo.filter(l => l.status === 'expired').length;
        const invendable = lotsInfo.filter(l => l.status === 'invendable').length;
        const warning = lotsInfo.filter(l => l.status === 'warning').length;
        const demande = demand.get(key) || 0;
        const manque = Math.max(0, demande - (covered.get(key) || 0));
        stacks.push({
            id: `stack:${key}`, zone: 'stock', kind: 'stack', row, col,
            arome, format, couleur: aromeColor(arome), contenanceCl, crateSize: twinCrateSize(contenanceCl),
            total, sellable, demande, manque, expired, invendable, warning, lots: lotsInfo,
            status: expired ? 'expired' : invendable ? 'invendable' : manque > 0 ? 'rupture' : warning ? 'warning' : 'ok',
            label: `${arome} · ${format}`,
            sub: manque > 0 ? `${twinFmtInt(sellable)} vendables · manque ${twinFmtInt(manque)}` : `${twinFmtInt(sellable)} bt vendables`
        });
    }));

    const needs = new Map();
    stacks.forEach(s => {
        if (s.manque <= 0) return;
        const ak = normalizeName(s.arome);
        const need = needs.get(ak) || { litres: 0, besoins: [] };
        const litres = s.manque * (s.contenanceCl || 0) / 100;
        need.litres += litres;
        need.besoins.push({ format: s.format, bouteilles: s.manque, litres });
        needs.set(ak, need);
    });
    // Plan de production réparti sur l'équipement réel (cuves 25 L, casseroles 9 L / 4 L),
    // par ordre d'urgence des commandes, avec la logique du planificateur (getProductionRecipients)
    const urgency = new Map();
    activeCommandes.forEach(cmd => {
        const days = twinDaysUntil(cmd.dateLivraison);
        getItems(cmd).forEach(item => {
            const arome = aromes.find(a => a.id === item.aromeId);
            if (!arome) return;
            const k = normalizeName(arome.nom);
            const d = days === null ? 9999 : days;
            if (!urgency.has(k) || d < urgency.get(k)) urgency.set(k, d);
        });
    });
    const productionAromes = [...needs.entries()].map(([ak, need]) => {
        const arome = aromeNames.get(ak) || ak;
        const couleur = aromeColor(arome);
        const litres = Math.round(need.litres * 10) / 10;
        const recette = recettes.find(r => r.aromeId === findArome(arome)?.id);
        return {
            arome, couleur, litres, besoins: need.besoins, hasRecette: !!recette,
            bouteilles: need.besoins.reduce((sum, b) => sum + b.bouteilles, 0),
            urgency: urgency.has(ak) ? urgency.get(ak) : 9999,
            recipients: getProductionRecipients(litres).map(r => ({
                ...r, arome, couleur, hasRecette: !!recette, poste: null,
                ingredients: recette ? calculerIngredientsRecipient(recette, r.litres) : []
            }))
        };
    }).filter(p => p.recipients.length).sort((a, b) => a.urgency - b.urgency || b.litres - a.litres);

    const cuveSlots = Array.from({ length: CONSTANTS.ATELIER_CUVES }, () => null);
    const potSlots = CONSTANTS.ATELIER_CASSEROLES_L.map(capacite => ({ capacite, recipient: null }));
    const enAttente = [];
    productionAromes.forEach(p => p.recipients.forEach(r => {
        if (r.type === 'cuve') {
            const i = cuveSlots.indexOf(null);
            if (i >= 0) {
                cuveSlots[i] = r;
                r.poste = `Cuve ${i + 1}`;
            } else enAttente.push(r);
            return;
        }
        const pot = potSlots.find(p2 => !p2.recipient && p2.capacite === r.capacite)
            || potSlots.find(p2 => !p2.recipient && p2.capacite >= r.litres);
        if (pot) {
            pot.recipient = r;
            r.poste = `Casserole ${pot.capacite} L`;
        } else enAttente.push(r);
    }));
    const equipementItem = (kind, numero, capacite, r) => ({
        id: `equip:${kind}-${numero}`, zone: 'production', kind, numero, capacite,
        arome: r?.arome || '', couleur: r?.couleur || '', litres: r?.litres || 0,
        fill: r ? twinClamp(r.litres / capacite, 0, 1) : 0,
        ingredients: r?.ingredients || [], hasRecette: r ? r.hasRecette : true,
        status: r ? 'planned' : 'idle',
        label: kind === 'cuve' ? `Cuve ${numero} · ${capacite} L` : `Casserole ${capacite} L · plaque ${numero}`,
        sub: r ? `${r.arome} · ${twinFmtLitres(r.litres)}` : (kind === 'cuve' ? 'Libre' : 'Plaque éteinte')
    });
    const equipement = [
        ...cuveSlots.map((r, i) => equipementItem('cuve', i + 1, CONSTANTS.CUVE_MAX_L, r)),
        ...potSlots.map((p, i) => equipementItem('casserole', i + 1, p.capacite, p.recipient))
    ];
    const production = {
        aromes: productionAromes,
        enAttente,
        litres: Math.round(productionAromes.reduce((sum, p) => sum + p.litres, 0) * 10) / 10,
        bouteilles: productionAromes.reduce((sum, p) => sum + p.bouteilles, 0),
        postesOccupes: equipement.filter(e => e.status === 'planned').length
    };

    const orders = activeCommandes
        .filter(c => c.statut === 'en_attente' || c.statut === 'produite')
        .map(cmd => {
            const client = clients.find(c => c.id === cmd.clientId);
            const days = twinDaysUntil(cmd.dateLivraison);
            const items = getItems(cmd).map(item => {
                const arome = aromes.find(a => a.id === item.aromeId);
                const format = resolveCommandeFormat(item, formats)?.format;
                return {
                    arome: arome?.nom || '—',
                    format: format?.nom || '—',
                    quantite: Number(item.quantite) || 0,
                    couleur: safeColor(arome?.couleur)
                };
            });
            const totalBt = items.reduce((s, i) => s + i.quantite, 0);
            const late = days !== null && days < 0;
            const urgent = !late && cmd.statut === 'en_attente' && days !== null && days <= 3;
            let montant = null;
            try { montant = getCommandeMontant(cmd, clients, formats); } catch (_) { montant = null; }
            const numero = getCommandeNumero(cmd);
            return {
                id: `order:${cmd.id}`, zone: 'expedition', kind: 'order', commandeId: cmd.id,
                numero, client: getClientLabel(client), statut: cmd.statut,
                dateLivraison: cmd.dateLivraison || '', days, late, urgent, totalBt, items, montant,
                status: late ? 'late' : urgent ? 'urgent' : cmd.statut === 'produite' ? 'ready' : 'waiting',
                label: `#${numero} · ${getClientLabel(client)}`,
                sub: `${twinFmtInt(totalBt)} bt · livraison ${twinRelativeDay(days)}`
            };
        })
        .sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999));

    const bins = inventaire
        .filter(i => i.categorie === 'consommable')
        .sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr'))
        .map(i => {
            const quantite = Number(i.quantite) || 0;
            const seuil = Number(i.seuilAlerte) || 0;
            const state = seuil > 0
                ? (quantite <= seuil ? 'critical' : quantite <= seuil * 2 ? 'low' : 'ok')
                : (quantite <= 0 ? 'empty' : 'unknown');
            return {
                id: `bin:${i.id}`, zone: 'magasin', kind: 'bin', itemId: i.id,
                nom: i.nom || 'Article', quantite, unite: i.unite, seuil, state,
                level: seuil > 0 ? twinClamp(quantite / (seuil * 4), 0.06, 1) : (quantite > 0 ? 0.55 : 0),
                label: i.nom || 'Article',
                sub: `${quantite} ${displayUnit(i.unite)}${seuil > 0 ? ` · seuil ${seuil}` : ''}`
            };
        });

    const staff = employees.filter(e => e.actif).map((emp, index) => {
        const todays = pointages.filter(p => p.employeId === emp.id && p.date === todayKey);
        const open = findPointageEnCours(pointages, emp.id, todayKey);
        const minutes = todays.reduce((s, p) => s + twinPresenceMinutes(p, nowMin), 0);
        const nom = `${emp.prenom || ''} ${emp.nom || ''}`.trim() || 'Employé';
        return {
            id: `staff:${emp.id}`, zone: 'equipe', kind: 'staff', employeId: emp.id, nom,
            initiales: nom.split(/\s+/).map(p => p[0] || '').join('').slice(0, 2).toUpperCase(),
            present: !!open, since: open?.heureDebut || '', minutes,
            couleur: TWIN_STAFF_COLORS[index % TWIN_STAFF_COLORS.length],
            status: open ? 'present' : 'absent',
            label: nom,
            sub: open ? `Présent depuis ${open.heureDebut}` : (minutes > 0 ? `Parti · ${twinFmtDuration(minutes)} aujourd'hui` : 'Absent')
        };
    });

    const alerts = [];
    orders.forEach(o => {
        if (o.late) alerts.push({ level: 'danger', id: o.id, title: `Commande #${o.numero} en retard`, text: `${o.client} · prévue le ${formatDate(o.dateLivraison)}` });
        else if (o.urgent) alerts.push({ level: 'warning', id: o.id, title: `Livraison ${twinRelativeDay(o.days)} · #${o.numero}`, text: `${o.client} · encore à produire` });
    });
    stacks.forEach(s => {
        if (s.expired) alerts.push({ level: 'danger', id: s.id, title: `${s.label} : ${s.expired} lot${s.expired > 1 ? 's' : ''} expiré${s.expired > 1 ? 's' : ''}`, text: 'À retirer ou corriger dans le stock' });
        else if (s.invendable) alerts.push({ level: 'danger', id: s.id, title: `${s.label} : ${s.invendable} lot${s.invendable > 1 ? 's' : ''} invendable${s.invendable > 1 ? 's' : ''}`, text: 'DLV dépassée : sortie (échantillon, casse, destruction) uniquement' });
        else if (s.warning) alerts.push({ level: 'info', id: s.id, title: `${s.label} : DLV proche`, text: `${s.warning} lot${s.warning > 1 ? 's' : ''} à écouler en priorité` });
    });
    productionAromes.forEach(p => {
        const poste = equipement.find(e => e.arome === p.arome) || equipement[0];
        if (!poste) return;
        alerts.push({ level: 'warning', id: poste.id, title: `${p.arome} : ${twinFmtLitres(p.litres)} à produire`, text: `${twinFmtInt(p.bouteilles)} bt manquantes · ${p.recipients.map(r => r.poste || 'en attente').join(', ')}` });
    });
    if (enAttente.length && equipement[0]) {
        alerts.push({ level: 'info', id: equipement[0].id, title: `${enAttente.length} contenant${enAttente.length > 1 ? 's' : ''} en attente`, text: "Capacité de l'atelier atteinte : prévoir une 2e fournée" });
    }
    bins.forEach(b => {
        if (b.state === 'critical') alerts.push({ level: 'danger', id: b.id, title: `${b.nom} sous le seuil`, text: `${b.quantite} ${displayUnit(b.unite)} (seuil ${b.seuil})` });
        else if (b.state === 'low') alerts.push({ level: 'warning', id: b.id, title: `${b.nom} bientôt épuisé`, text: `${b.quantite} ${displayUnit(b.unite)} (seuil ${b.seuil})` });
    });
    const levelOrder = { danger: 0, warning: 1, info: 2 };
    alerts.sort((a, b) => levelOrder[a.level] - levelOrder[b.level]);

    const kpis = {
        aProduireL: production.litres,
        aProduireBt: production.bouteilles,
        postesOccupes: production.postesOccupes,
        postesTotal: equipement.length,
        enAttente: enAttente.length,
        stockVendable: stacks.reduce((s, x) => s + x.sellable, 0),
        lotsExpires: stacks.reduce((s, x) => s + x.expired, 0),
        lotsInvendables: stacks.reduce((s, x) => s + x.invendable, 0),
        lotsWarning: stacks.reduce((s, x) => s + x.warning, 0),
        commandes: orders.length,
        urgentes: orders.filter(o => o.urgent).length,
        enRetard: orders.filter(o => o.late).length,
        pretes: orders.filter(o => o.statut === 'produite').length,
        consoCritiques: bins.filter(b => b.state === 'critical').length,
        consoBas: bins.filter(b => b.state === 'low').length,
        consoTotal: bins.length,
        presents: staff.filter(s => s.present).length,
        effectif: staff.length
    };

    const items = [...equipement, ...stacks, ...orders, ...bins, ...staff];
    return {
        builtAt: now, equipement, production, stacks, orders, bins, staff, alerts, kpis, items,
        byId: new Map(items.map(i => [i.id, i])),
        grid: { rows: rowKeys.map(k => aromeNames.get(k)), cols: colKeys.map(k => formatNames.get(k)) }
    };
};

// --- Moteur 3D ---
const Twin = {
    lib: null,
    loading: null,
    supported: null,
    renderer: null,
    scene: null,
    camera: null,
    controls: null,
    raycaster: null,
    ndc: null,
    dynamic: null,
    markers: null,
    container: null,
    labelsEl: null,
    tooltipEl: null,
    model: null,
    objects: new Map(),
    pickables: [],
    labels: [],
    signatures: new Map(),
    prevFill: new Map(),
    fills: [],
    flashes: [],
    bobbers: [],
    pulseMats: [],
    selectedId: null,
    hoveredId: null,
    focusZone: 'overview',
    tween: null,
    raf: 0,
    needsRender: true,
    pointer: null,
    pointerDirty: false,
    downAt: null,
    resizeObserver: null,
    viewInitialized: false,
    size: null,
    viewOffset: { x: 0, y: 0 },
    viewOffsetTarget: { x: 0, y: 0 },
    geo: {},
    mats: {},
    palette: null,
    tmp: null
};

const _twinMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
const twinReducedMotion = () => !!_twinMotionQuery?.matches;

const twinIsSupported = () => {
    if (Twin.supported !== null) return Twin.supported;
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        Twin.supported = !!gl;
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch (_) {
        Twin.supported = false;
    }
    return Twin.supported;
};

const twinLoadLibrary = () => {
    if (Twin.lib) return Promise.resolve(Twin.lib);
    if (!Twin.loading) {
        Twin.loading = Promise.all([
            import('./vendor/three/three.module.min.js'),
            import('./vendor/three/OrbitControls.js'),
            import('./vendor/three/RoomEnvironment.js')
        ]).then(([THREE, controls, room]) => {
            Twin.lib = { THREE, OrbitControls: controls.OrbitControls, RoomEnvironment: room.RoomEnvironment };
            return Twin.lib;
        }).catch(err => {
            Twin.loading = null;
            throw err;
        });
    }
    return Twin.loading;
};

const twinCssColor = (name, fallback) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return /^#[0-9a-f]{3,8}$/i.test(v) ? v : fallback;
};

const twinGeo = (key, factory) => Twin.geo[key] || (Twin.geo[key] = factory());
const twinMat = (key, factory) => Twin.mats[key] || (Twin.mats[key] = factory());
const twinStd = (key, color, opts = {}) => twinMat(`std:${key}:${color}`, () =>
    new Twin.lib.THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, ...opts }));
const twinBasic = (key, color, opts = {}) => twinMat(`basic:${key}:${color}`, () =>
    new Twin.lib.THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, ...opts }));
const twinLathe = (points, segments) => new Twin.lib.THREE.LatheGeometry(
    points.map(([x, y]) => new Twin.lib.THREE.Vector2(x, y)), segments);

// Échelle réelle : 1 unité = 1 mètre. Implantation de l'atelier (coordonnées monde).
const TWIN_LAB = {
    tableX: -9.0, tableZ: -7.65, tableW: 4.0, tableD: 0.7, tableH: 0.9,
    plate: (i) => [-10.55 + i * 0.6, -7.68],
    cuve: (i) => [-10.6 + i * 0.7, -5.9],
    bottling: [-5.0, -7.7]
};
// Dimensions réelles : cuve 25 L (Ø 34 cm, rebord à 90 cm), casseroles 9 L / 4 L
const TWIN_CUVE = { R: 0.17, H: 0.42, stand: 0.48 };
const TWIN_POTS = { 9: { r: 0.14, h: 0.22 }, 4: { r: 0.11, h: 0.15 } };
// Bouteilles (hauteur, diamètre) selon la contenance ; casier = 30 × 40 cm, 8 par couche de palette
const twinBottleSpec = (cl) => (cl <= 30 ? { h: 0.2, d: 0.056 } : cl <= 60 ? { h: 0.25, d: 0.068 } : { h: 0.31, d: 0.085 });

// Postes de travail occupés par les employés présents (ordre de remplissage)
const TWIN_STATIONS = [
    { x: -10.25, z: -6.95, ry: Math.PI },
    { x: -9.55, z: -5.2, ry: Math.PI },
    { x: -5.0, z: -7.0, ry: Math.PI },
    { x: 5.4, z: -0.6, ry: Math.PI },
    { x: 6.5, z: 1.0, ry: 0 },
    { x: -7.8, z: 3.5, ry: Math.PI }
];

const twinGeometries = () => {
    const { THREE } = Twin.lib;
    return {
        box: twinGeo('box', () => new THREE.BoxGeometry(1, 1, 1)),
        cyl: twinGeo('cyl', () => new THREE.CylinderGeometry(1, 1, 1, 32)),
        cylLow: twinGeo('cylLow', () => new THREE.CylinderGeometry(1, 1, 1, 10)),
        sphere: twinGeo('sphere', () => new THREE.SphereGeometry(1, 24, 16)),
        dome: twinGeo('dome', () => new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2)),
        cone: twinGeo('cone', () => new THREE.ConeGeometry(1, 1, 24)),
        ring: twinGeo('ring', () => new THREE.RingGeometry(0.86, 1, 56)),
        plane: twinGeo('plane', () => new THREE.PlaneGeometry(1, 1)),
        capsule: twinGeo('capsule', () => new THREE.CapsuleGeometry(0.5, 1, 6, 14)),
        torus: twinGeo('torus', () => new THREE.TorusGeometry(1, 0.06, 8, 48)),
        edges: twinGeo('edges', () => new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1))),
        bottle: twinGeo('bottle', () => twinLathe([[0, 0], [0.92, 0], [1, 0.05], [1, 0.6], [0.86, 0.7], [0.42, 0.82], [0.33, 0.88], [0.33, 1], [0, 1]], 8)),
        tankShell: twinGeo('tankShell', () => twinLathe([[0.1, 0], [0.13, 0.02], [1, 0.26], [1, 1], [0.985, 1.03], [0.95, 1.045]], 40)),
        pot: twinGeo('pot', () => twinLathe([[0, 0], [0.96, 0], [1, 0.04], [1, 0.97], [1.05, 1], [1.05, 1.03], [0.97, 1.03], [0.97, 0.06], [0, 0.06]], 32)),
        sack: twinGeo('sack', () => twinLathe([[0, 0], [0.9, 0.02], [1, 0.2], [0.96, 0.72], [0.72, 0.94], [0.3, 1], [0, 1]], 14))
    };
};

const twinMesh = (geometry, material, { cast = true, receive = false } = {}) => {
    const mesh = new Twin.lib.THREE.Mesh(geometry, material);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    return mesh;
};

const twinMaterials = () => {
    const p = Twin.palette;
    const { THREE } = Twin.lib;
    return {
        floor: twinStd('floor', p.floor, { roughness: 0.9 }),
        ground: twinStd('ground', p.ground, { roughness: 1 }),
        wall: twinStd('wall', '#FBFAF6', { roughness: 0.92 }),
        wallTrim: twinStd('wallTrim', '#E4E0D6', { roughness: 0.85 }),
        windowFrame: twinStd('windowFrame', '#3C4247', { roughness: 0.5, metalness: 0.4 }),
        windowGlass: twinStd('windowGlass', '#BFD8E6', { roughness: 0.08, metalness: 0.1, emissive: '#9CC3DA', emissiveIntensity: 0.35 }),
        steel: twinStd('steel', '#C3CBD1', { metalness: 0.72, roughness: 0.3 }),
        steelShell: twinMat('steelShell', () => new THREE.MeshStandardMaterial({ color: '#CDD4D9', metalness: 0.78, roughness: 0.26, side: THREE.DoubleSide })),
        steelDark: twinStd('steelDark', '#6E7880', { metalness: 0.55, roughness: 0.42 }),
        chrome: twinStd('chrome', '#E9EEF1', { metalness: 0.95, roughness: 0.12 }),
        rubber: twinStd('rubber', '#202427', { roughness: 0.92 }),
        plastic: twinStd('plastic', '#25292D', { roughness: 0.45 }),
        plasticLight: twinStd('plasticLight', '#3A3F45', { roughness: 0.4 }),
        glassTop: twinStd('glassTop', '#0F1113', { roughness: 0.06, metalness: 0.35 }),
        inductionOff: twinStd('inductionOff', '#4A4F55', { roughness: 0.3 }),
        inductionOn: twinStd('inductionOn', '#FF7A1A', { emissive: '#FF5A00', emissiveIntensity: 0.9, roughness: 0.3 }),
        ledOn: twinStd('ledOn', '#5CE07A', { emissive: '#5CE07A', emissiveIntensity: 1.2 }),
        ledOff: twinStd('ledOff', '#555B60', { roughness: 0.5 }),
        valveRed: twinStd('valveRed', '#C7342B', { roughness: 0.5 }),
        sightGlass: twinStd('sightGlass', '#E8F3F6', { roughness: 0.05, transparent: true, opacity: 0.35 }),
        jarGlass: twinStd('jarGlass', '#EAF4F2', { roughness: 0.05, transparent: true, opacity: 0.3 }),
        bottleTint: twinStd('bottleTint', '#FFFFFF', { roughness: 0.12, metalness: 0.15 }),
        cap: twinStd('cap', '#C9A64B', { metalness: 0.7, roughness: 0.35 }),
        tint: twinStd('tint', '#FFFFFF', { roughness: 0.72 }),
        stateTint: twinStd('stateTint', '#FFFFFF', { roughness: 0.82 }),
        basin: twinStd('basin', '#7D878E', { metalness: 0.6, roughness: 0.35 }),
        wood: twinStd('wood', '#BE9461', { roughness: 0.9 }),
        woodDark: twinStd('woodDark', '#93693D', { roughness: 0.9 }),
        woodLight: twinStd('woodLight', '#DDBF92', { roughness: 0.8 }),
        kraft: twinStd('kraft', '#C9A878', { roughness: 0.92 }),
        kraftTape: twinStd('kraftTape', '#A9844F', { roughness: 0.6 }),
        film: twinStd('film', p.primaryLight, { roughness: 0.2, transparent: true, opacity: 0.4 }),
        label: twinStd('label', '#F6F5F0', { roughness: 0.7 }),
        binPlastic: twinStd('binPlastic', '#4E7DA6', { roughness: 0.55 }),
        rackBlue: twinStd('rackBlue', '#2F5C8A', { roughness: 0.45, metalness: 0.3 }),
        rackOrange: twinStd('rackOrange', '#D9822B', { roughness: 0.5, metalness: 0.2 }),
        locker: twinStd('locker', '#98A6AF', { roughness: 0.5, metalness: 0.35 }),
        lockerDoor: twinStd('lockerDoor', '#B4C0C7', { roughness: 0.45, metalness: 0.35 }),
        skin: twinStd('skin', '#F0DCC4', { roughness: 0.8 }),
        apron: twinStd('apron', '#F7F7F4', { roughness: 0.85 }),
        pants: twinStd('pants', '#3A4148', { roughness: 0.85 }),
        absent: twinMat('absent', () => new THREE.MeshStandardMaterial({ color: '#B9B6AE', roughness: 0.9, transparent: true, opacity: 0.45 })),
        marking: twinBasic('marking', '#E2C25A', { opacity: 0.9 }),
        hazard: twinStd('hazard', '#E9B825', { roughness: 0.6 }),
        dark: twinStd('dark', '#2F3438', { roughness: 0.7 }),
        glassDark: twinStd('glassDark', '#34444F', { roughness: 0.12, metalness: 0.35 }),
        white: twinStd('white', '#F7F7F2', { roughness: 0.65 }),
        whiteDark: twinStd('whiteDark', '#E3E4DE', { roughness: 0.65 }),
        brand: twinStd('brand', p.primary, { roughness: 0.55 }),
        lamp: twinStd('lamp', '#FFF3D6', { emissive: '#FFE9B8', emissiveIntensity: 1 }),
        screen: twinStd('screen', p.primaryLight, { emissive: p.primaryLight, emissiveIntensity: 0.9 }),
        extinguisher: twinStd('extinguisher', '#C7342B', { roughness: 0.4, metalness: 0.2 }),
        ringDanger: twinBasic('ringDanger', p.danger, { opacity: 0.85 }),
        ringWarning: twinBasic('ringWarning', p.warning, { opacity: 0.85 }),
        ringWarningSoft: twinBasic('ringWarningSoft', p.warning, { opacity: 0.4 }),
        ringSuccess: twinBasic('ringSuccess', p.success, { opacity: 0.7 }),
        ringPlanned: twinBasic('ringPlanned', p.info, { opacity: 0.55 }),
        beaconDanger: twinStd('beaconDanger', p.danger, { emissive: p.danger, emissiveIntensity: 0.8 }),
        beaconWarning: twinStd('beaconWarning', p.warning, { emissive: p.warning, emissiveIntensity: 0.8 }),
        ghost: twinMat('ghost', () => new THREE.LineBasicMaterial({ color: p.danger, transparent: true, opacity: 0.75 })),
        ghostFill: twinBasic('ghostFill', p.danger, { opacity: 0.06 }),
        proxy: twinMat('proxy', () => new THREE.MeshBasicMaterial())
    };
};

const twinColorMats = (color) => ({
    liquid: twinStd('liquid', color, { roughness: 0.2, emissive: color, emissiveIntensity: 0.12, transparent: true, opacity: 0.92 }),
    band: twinStd('band', color, { roughness: 0.45, emissive: color, emissiveIntensity: 0.25 }),
    figure: twinStd('figure', color, { roughness: 0.7 })
});

const TWIN_STATE_COLORS = { critical: '#D9776C', empty: '#D9776C', low: '#E3B85A', ok: '#8DB86A', unknown: '#B9BDB5' };

const twinShade = (hex, factor) => {
    let h = safeColor(hex).slice(1);
    if (h.length < 6) h = h.slice(0, 3).split('').map(c => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    const ch = (shift) => {
        const v = (n >> shift) & 255;
        const out = factor <= 1 ? v * factor : v + (255 - v) * (factor - 1);
        return Math.round(Math.min(255, out)).toString(16).padStart(2, '0');
    };
    return `#${ch(16)}${ch(8)}${ch(0)}`;
};

// --- Textures dessinées (plaques, enseigne, carrelage) ---
const twinCanvasMaterial = (key, w, h, draw, opts = {}) => twinMat(`tex:${key}`, () => {
    const { THREE } = Twin.lib;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    draw(canvas.getContext('2d'), w, h);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    if (opts.repeat) {
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        map.repeat.set(opts.repeat[0], opts.repeat[1]);
    }
    return new THREE.MeshStandardMaterial({ map, roughness: opts.roughness ?? 0.6 });
});

const twinPlateMaterial = (key, title, sub, accent) => twinCanvasMaterial(`plate:${key}`, 256, 128, (g, w, h) => {
    g.fillStyle = '#F6F5F0';
    g.fillRect(0, 0, w, h);
    g.fillStyle = accent;
    g.fillRect(0, 0, w, 16);
    g.fillStyle = '#2A2A2A';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '700 46px Outfit, sans-serif';
    g.fillText(title, w / 2, sub ? 56 : 70);
    if (sub) {
        g.fillStyle = '#6B6B6B';
        g.font = '500 30px Outfit, sans-serif';
        g.fillText(sub, w / 2, 100);
    }
});

const twinSignMaterial = (key, bg, fg, title, sub) => twinCanvasMaterial(`sign:${key}`, 1024, 256, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '700 132px Outfit, sans-serif';
    g.fillText(title, w / 2, sub ? 104 : 128);
    if (sub) {
        g.font = '500 46px Outfit, sans-serif';
        g.fillText(sub, w / 2, 200);
    }
});

const twinTileMaterial = (rx, ry) => twinCanvasMaterial(`tiles:${rx}x${ry}`, 128, 128, (g) => {
    g.fillStyle = '#F1F2EE';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#D3D7D0';
    g.lineWidth = 4;
    g.strokeRect(2, 2, 124, 124);
}, { repeat: [rx, ry], roughness: 0.5 });

// --- Assemblage instancié : un InstancedMesh par couple géométrie × matériau ---
const twinBatch = () => new Map();

const twinBatchFlush = (batch, parent) => {
    const { THREE } = Twin.lib;
    const color = new THREE.Color();
    batch.forEach(e => {
        const mesh = new THREE.InstancedMesh(e.geo, e.mat, e.matrices.length);
        e.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
        if (e.colors.some(Boolean)) e.colors.forEach((c, i) => mesh.setColorAt(i, color.set(c || '#ffffff')));
        mesh.castShadow = e.cast;
        mesh.receiveShadow = e.receive;
        mesh.computeBoundingSphere();
        parent.add(mesh);
    });
    batch.clear();
};

// Repère local (position + rotation Y) : part() alimente le lot instancié,
// mesh() crée un objet individuel (animé), point() convertit en coordonnées monde.
const twinBuilder = (batch, parent, x, z, rotY = 0, y = 0) => {
    const { THREE } = Twin.lib;
    const origin = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z);
    const dummy = Twin.dummy;
    const matrix = (p, s, o = {}) => {
        dummy.position.set(p[0], p[1], p[2]);
        dummy.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
        dummy.scale.set(s[0], s[1], s[2]);
        dummy.updateMatrix();
        return new THREE.Matrix4().multiplyMatrices(origin, dummy.matrix);
    };
    return {
        matrix,
        part(geo, mat, p, s, o = {}) {
            const key = `${geo.uuid}|${mat.uuid}`;
            let e = batch.get(key);
            if (!e) {
                e = { geo, mat, matrices: [], colors: [], cast: o.cast !== false && !mat.transparent, receive: o.receive !== false && !mat.transparent };
                batch.set(key, e);
            }
            e.matrices.push(matrix(p, s, o));
            e.colors.push(o.color || null);
        },
        mesh(geo, mat, p, s, o = {}) {
            const mesh = twinMesh(geo, mat, { cast: o.cast !== false && !mat.transparent, receive: !!o.receive });
            matrix(p, s, o).decompose(mesh.position, mesh.quaternion, mesh.scale);
            if (o.renderOrder) mesh.renderOrder = o.renderOrder;
            parent.add(mesh);
            return mesh;
        },
        point(p) {
            return new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(origin);
        }
    };
};

const twinFlat = (b, geo, mat, x, y, z, w, d, o = {}) =>
    b.part(geo, mat, [x, y, z], [w, d, 1], { rx: -Math.PI / 2, cast: false, receive: false, ...o });

const twinInitEngine = () => {
    const { THREE, OrbitControls } = Twin.lib;
    Twin.palette = {
        primary: twinCssColor('--primary', '#5D7B3E'),
        primaryLight: twinCssColor('--primary-light', '#8BA66B'),
        danger: twinCssColor('--danger', '#C0392B'),
        warning: twinCssColor('--warning', '#C8960A'),
        success: twinCssColor('--success', '#5C8A3C'),
        info: twinCssColor('--info', '#2E72B8'),
        bg: twinCssColor('--bg', '#F5F5F0'),
        floor: twinCssColor('--bg-secondary', '#FAFAF7'),
        ground: twinCssColor('--bg-tertiary', '#EFECE4'),
        zones: Object.fromEntries(TWIN_ZONES.map(z => [z.id, twinCssColor(z.token, '#5D7B3E')]))
    };
    const compact = window.matchMedia?.('(max-width: 768px)').matches;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compact ? 1.75 : 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.className = 'twin-gl';
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', "Vue 3D de l'atelier ThéCol. Utilisez la liste des objets pour une navigation au clavier.");

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(Twin.palette.bg);
    scene.fog = new THREE.Fog(Twin.palette.bg, 45, 95);
    // Reflets d'atelier pour l'inox (sans carte d'environnement, le métal paraît noir)
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new Twin.lib.RoomEnvironment();
    scene.environment = pmrem.fromScene(room, 0.04).texture;
    scene.environmentIntensity = 0.55;
    room.dispose?.();
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(38, 1.6, 0.05, 250);
    camera.position.set(...TWIN_VIEW_OVERVIEW.pos);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.8;
    controls.maxDistance = 48;
    controls.maxPolarAngle = Math.PI * 0.46;
    controls.screenSpacePanning = false;
    controls.autoRotateSpeed = 0.5;
    controls.target.set(...TWIN_VIEW_OVERVIEW.target);
    controls.addEventListener('change', () => {
        twinClampTarget();
        twinWake();
    });
    controls.addEventListener('start', () => { Twin.tween = null; });
    controls.update();

    scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d2c0, 0.85));
    const sun = new THREE.DirectionalLight(0xfff4e2, 2.2);
    sun.position.set(-8, 17, 11);
    sun.castShadow = true;
    sun.shadow.mapSize.set(compact ? 1024 : 2048, compact ? 1024 : 2048);
    Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 14, bottom: -14, near: 2, far: 50 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.015;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xe8f0ff, 0.45);
    fill.position.set(10, 9, -7);
    scene.add(fill);

    Object.assign(Twin, {
        renderer, scene, camera, controls,
        raycaster: new THREE.Raycaster(),
        ndc: new THREE.Vector2(),
        tmp: new THREE.Vector3(),
        dummy: new THREE.Object3D(),
        dynamic: new THREE.Group(),
        markers: new THREE.Group(),
        proxies: new THREE.Group()
    });
    scene.add(Twin.dynamic);
    scene.add(Twin.markers);
    twinBuildEnvironment();
    twinBuildMarkers();

    const canvas = renderer.domElement;
    canvas.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch') return;
        Twin.pointer = { x: e.clientX, y: e.clientY };
        Twin.pointerDirty = true;
        twinWake();
    });
    canvas.addEventListener('pointerleave', () => {
        Twin.pointer = null;
        Twin.pointerDirty = true;
        twinWake();
    });
    canvas.addEventListener('pointerdown', (e) => {
        Twin.downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
        Twin.tween = null;
    });
    canvas.addEventListener('pointerup', (e) => {
        const down = Twin.downAt;
        Twin.downAt = null;
        if (!down || e.button > 0) return;
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || performance.now() - down.t > 600) return;
        const id = twinPick(e.clientX, e.clientY);
        twinSelect(id, { fly: false });
    });
    canvas.addEventListener('dblclick', (e) => {
        const id = twinPick(e.clientX, e.clientY);
        if (id) twinSelect(id, { fly: true });
    });
};

// --- Éléments réutilisables (dimensions réelles) ---
// Palette Europe 1,20 × 0,80 × 0,144 m (longueur sur x)
const twinPallet = (b, x, z) => {
    const g = twinGeometries();
    const m = twinMaterials();
    [-0.32, -0.16, 0, 0.16, 0.32].forEach(dz => b.part(g.box, m.wood, [x, 0.132, z + dz], [1.2, 0.022, 0.1]));
    [-0.525, 0, 0.525].forEach(dx => [-0.33, 0, 0.33].forEach(dz => b.part(g.box, m.woodDark, [x + dx, 0.083, z + dz], [0.15, 0.078, 0.14])));
    [-0.33, 0, 0.33].forEach(dz => b.part(g.box, m.wood, [x, 0.022, z + dz], [1.2, 0.022, 0.14]));
};
const TWIN_PALLET_TOP = 0.144;

// Casier à bouteilles 30 × 40 cm (x × z), hauteur selon le format
const twinCrate = (b, x, y, z, color, h) => {
    const g = twinGeometries();
    const m = twinMaterials();
    const rim = twinShade(color, 0.72);
    b.part(g.box, m.tint, [x, y + 0.006, z], [0.29, 0.012, 0.39], { color });
    b.part(g.box, m.tint, [x, y + h / 2, z + 0.195], [0.3, h, 0.01], { color });
    b.part(g.box, m.tint, [x, y + h / 2, z - 0.195], [0.3, h, 0.01], { color });
    b.part(g.box, m.tint, [x + 0.145, y + h / 2, z], [0.01, h, 0.38], { color });
    b.part(g.box, m.tint, [x - 0.145, y + h / 2, z], [0.01, h, 0.38], { color });
    b.part(g.box, m.tint, [x, y + h - 0.008, z + 0.195], [0.31, 0.016, 0.016], { color: rim });
    b.part(g.box, m.tint, [x, y + h - 0.008, z - 0.195], [0.31, 0.016, 0.016], { color: rim });
    b.part(g.box, m.tint, [x + 0.145, y + h - 0.008, z], [0.016, 0.016, 0.39], { color: rim });
    b.part(g.box, m.tint, [x - 0.145, y + h - 0.008, z], [0.016, 0.016, 0.39], { color: rim });
    b.part(g.box, m.dark, [x, y + h * 0.72, z + 0.201], [0.12, 0.03, 0.004], { cast: false });
    b.part(g.box, m.dark, [x, y + h * 0.72, z - 0.201], [0.12, 0.03, 0.004], { cast: false });
};

const twinCrateBottles = (b, x, y, z, count, crateSize, contenanceCl, color) => {
    const g = twinGeometries();
    const m = twinMaterials();
    const [cols, rows] = crateSize >= 24 ? [4, 6] : crateSize >= 12 ? [3, 4] : [2, 3];
    const spec = twinBottleSpec(contenanceCl);
    const dx = 0.28 / cols;
    const dz = 0.38 / rows;
    const r = Math.min(spec.d / 2, Math.min(dx, dz) / 2 - 0.003);
    const liquid = twinShade(color, 1.18);
    for (let i = 0; i < Math.min(count, cols * rows); i++) {
        const bx = x - 0.14 + dx * (i % cols + 0.5);
        const bz = z - 0.19 + dz * (Math.floor(i / cols) + 0.5);
        b.part(g.bottle, m.bottleTint, [bx, y, bz], [r, spec.h, r], { color: liquid });
        b.part(g.cylLow, m.cap, [bx, y + spec.h + 0.006, bz], [r * 0.36, 0.014, r * 0.36]);
    }
};

const twinFigureParts = (emit, mats) => {
    const g = twinGeometries();
    [-1, 1].forEach(sx => {
        emit(g.capsule, mats.pants, [sx * 0.1, 0.46, 0], [0.14, 0.42, 0.14]);
        emit(g.box, mats.dark, [sx * 0.1, 0.04, 0.04], [0.12, 0.08, 0.26]);
        emit(g.capsule, mats.shirt, [sx * 0.27, 1.13, 0.02], [0.11, 0.28, 0.11], { rz: sx * 0.12 });
        emit(g.sphere, mats.skin, [sx * 0.31, 0.84, 0.04], [0.05, 0.055, 0.05]);
    });
    emit(g.capsule, mats.shirt, [0, 1.17, 0], [0.42, 0.3, 0.26]);
    emit(g.box, mats.apron, [0, 1.0, 0.13], [0.34, 0.58, 0.02]);
    emit(g.sphere, mats.skin, [0, 1.62, 0], [0.105, 0.125, 0.11]);
    emit(g.dome, mats.cap, [0, 1.66, -0.01], [0.12, 0.09, 0.125]);
    [-1, 1].forEach(sx => emit(g.sphere, mats.dark, [sx * 0.04, 1.64, 0.1], [0.012, 0.012, 0.012]));
};

// --- Environnement statique (atelier d'environ 24 × 16 m) ---
const twinBuildEnvironment = () => {
    const { THREE } = Twin.lib;
    const m = twinMaterials();
    const g = twinGeometries();
    const env = new THREE.Group();
    const batch = twinBatch();
    const b = twinBuilder(batch, env, 0, 0);

    const ground = b.mesh(g.plane, m.ground, [0, -0.21, 0], [140, 140, 1], { rx: -Math.PI / 2, cast: false, receive: true });
    ground.receiveShadow = true;
    b.part(g.box, m.floor, [0, -0.1, 0], [24.4, 0.2, 16.4], { cast: false });
    const tiles = b.mesh(g.plane, twinTileMaterial(34, 23), [-6.9, 0.002, -4.55], [10.3, 7.0, 1], { rx: -Math.PI / 2, cast: false });
    tiles.receiveShadow = true;

    TWIN_ZONES.forEach(zone => {
        const [x0, z0, x1, z1] = zone.bounds;
        const color = Twin.palette.zones[zone.id];
        const w = x1 - x0;
        const d = z1 - z0;
        const cx = (x0 + x1) / 2;
        const cz = (z0 + z1) / 2;
        twinFlat(b, g.plane, twinBasic(`zoneTint:${zone.id}`, color, { opacity: 0.07 }), cx, 0.004, cz, w, d);
        const border = twinBasic(`zoneBorder:${zone.id}`, color, { opacity: 0.6 });
        twinFlat(b, g.plane, border, cx, 0.006, z0, w, 0.06);
        twinFlat(b, g.plane, border, cx, 0.006, z1, w, 0.06);
        twinFlat(b, g.plane, border, x0, 0.006, cz, 0.06, d);
        twinFlat(b, g.plane, border, x1, 0.006, cz, 0.06, d);
    });
    for (let x = -11.2; x < 11.2; x += 0.8) twinFlat(b, g.plane, m.marking, x + 0.2, 0.007, 0.2, 0.42, 0.06);
    for (let z = -7.4; z < 1.2; z += 0.8) twinFlat(b, g.plane, m.marking, 0, 0.007, z + 0.2, 0.06, 0.42);
    twinFlat(b, g.plane, m.dark, -9.55, 0.005, -4.75, 3.2, 0.12);

    // Murs : fond haut (fenêtres + enseigne), côtés bas en coupe, quais de chargement
    const backZ = -8.1;
    const inner = backZ + 0.1;
    b.part(g.box, m.wall, [0, 1.4, backZ], [24.4, 3.0, 0.2], { receive: true });
    b.part(g.box, m.wallTrim, [0, 2.92, backZ], [24.5, 0.06, 0.26]);
    [-12.1, -6.1, 6.1, 12.1].forEach(x => b.part(g.box, m.wallTrim, [x, 1.4, inner + 0.07], [0.3, 3.0, 0.14]));
    [-8.6, -3.6, 3.6, 8.6].forEach(x => {
        b.part(g.box, m.windowFrame, [x, 1.9, inner + 0.02], [3.0, 1.25, 0.04]);
        b.part(g.box, m.windowGlass, [x, 1.9, inner + 0.045], [2.86, 1.11, 0.01], { cast: false });
        [-0.72, 0, 0.72].forEach(dx => b.part(g.box, m.windowFrame, [x + dx, 1.9, inner + 0.055], [0.04, 1.11, 0.012], { cast: false }));
    });
    b.mesh(g.box, twinSignMaterial('thecol', Twin.palette.primary, '#FFFFFF', 'ThéCol', 'Thé froid artisanal'), [0, 2.0, inner + 0.03], [2.6, 0.65, 0.03], { cast: false });
    b.part(g.box, m.wall, [-12.1, 0.5, 0], [0.2, 1.2, 16.2], { receive: true });
    b.part(g.box, m.wallTrim, [-12.1, 1.12, 0], [0.26, 0.05, 16.2]);
    const docks = [3.2, 6.0];
    [[-8.2, 2.0], [4.4, 4.8], [7.2, 8.2]].forEach(([z0, z1]) => {
        b.part(g.box, m.wall, [12.1, 0.5, (z0 + z1) / 2], [0.2, 1.2, z1 - z0], { receive: true });
        b.part(g.box, m.wallTrim, [12.1, 1.12, (z0 + z1) / 2], [0.26, 0.05, z1 - z0]);
    });
    docks.forEach(dz => {
        b.part(g.box, m.steelDark, [11.5, 0.02, dz], [1.0, 0.04, 2.2], { receive: true });
        for (let k = 0; k < 11; k++) b.part(g.box, m.tint, [10.94, 0.008, dz - 1.0 + k * 0.2], [0.12, 0.01, 0.2], { color: k % 2 ? '#26282B' : '#E9B825', cast: false });
        [-1, 1].forEach(s => {
            b.part(g.box, m.hazard, [12.1, 0.62, dz + s * 1.15], [0.24, 1.24, 0.1]);
            b.part(g.box, m.rubber, [12.32, 0.55, dz + s * 0.95], [0.18, 0.3, 0.22]);
        });
        b.part(g.box, m.steelDark, [11.92, 1.45, dz - 1.45], [0.06, 0.06, 0.35]);
        b.part(g.box, m.lamp, [11.92, 1.4, dz - 1.3], [0.14, 0.08, 0.14], { cast: false });
    });

    [docks[0] - 1.35, (docks[0] + docks[1]) / 2, docks[1] + 1.35].forEach(bz => {
        b.part(g.cylLow, m.hazard, [10.7, 0.45, bz], [0.08, 0.9, 0.08]);
        b.part(g.cylLow, m.dark, [10.7, 0.75, bz], [0.083, 0.06, 0.083]);
    });

    // Camion porteur à quai (porte 1) : caisse 5,8 m, plancher à 1 m
    const t = twinBuilder(batch, env, 15.4, docks[0]);
    t.part(g.box, m.white, [0, 2.15, 0], [5.8, 2.3, 2.3]);
    for (let k = 0; k < 9; k++) t.part(g.box, m.whiteDark, [-2.84 + k * 0.71, 2.15, 0], [0.04, 2.32, 2.33]);
    t.part(g.box, m.brand, [0, 1.06, 0], [5.82, 0.16, 2.32]);
    t.part(g.box, m.dark, [-2.91, 2.15, 0], [0.02, 2.1, 2.1], { cast: false });
    [-1, 1].forEach(s => t.part(g.box, m.whiteDark, [-2.38, 2.15, s * 1.18], [1.05, 2.1, 0.035]));
    const truckSign = twinSignMaterial('truck', '#FFFFFF', Twin.palette.primary, 'ThéCol', 'Livraison fraîche');
    t.mesh(g.box, truckSign, [0.4, 2.25, 1.157], [3.9, 0.98, 0.008], { cast: false });
    t.mesh(g.box, truckSign, [0.4, 2.25, -1.157], [3.9, 0.98, 0.008], { cast: false, ry: Math.PI });
    t.part(g.box, m.dark, [0.6, 0.72, 0], [7.4, 0.2, 1.1]);
    [-1.5, 3.95].forEach(x => [-1, 1].forEach(s => {
        t.part(g.cyl, m.rubber, [x, 0.4, s * 0.95], [0.4, 0.28, 0.4], { rx: Math.PI / 2 });
        t.part(g.cylLow, m.chrome, [x, 0.4, s * 1.1], [0.18, 0.02, 0.18], { rx: Math.PI / 2 });
    }));
    t.part(g.box, m.brand, [3.95, 1.55, 0], [1.9, 2.0, 2.3]);
    t.part(g.box, m.brand, [3.7, 2.68, 0], [1.2, 0.26, 2.1]);
    t.part(g.box, m.glassDark, [4.91, 1.95, 0], [0.04, 0.75, 1.95], { cast: false });
    [-1, 1].forEach(s => {
        t.part(g.box, m.glassDark, [4.25, 1.95, s * 1.155], [0.8, 0.55, 0.02], { cast: false });
        t.part(g.box, m.lamp, [4.925, 0.85, s * 0.8], [0.03, 0.15, 0.28], { cast: false });
        t.part(g.box, m.dark, [4.75, 2.05, s * 1.32], [0.07, 0.3, 0.05]);
        t.part(g.box, m.dark, [4.75, 2.1, s * 1.24], [0.03, 0.03, 0.16]);
        t.part(g.box, m.steelDark, [4.1, 0.45, s * 1.16], [0.45, 0.05, 0.1]);
    });
    t.part(g.box, m.dark, [4.91, 1.0, 0], [0.04, 0.5, 1.2], { cast: false });
    t.part(g.box, m.dark, [4.98, 0.5, 0], [0.14, 0.22, 2.3]);
    t.part(g.cyl, m.chrome, [2.2, 0.62, -0.75], [0.24, 0.8, 0.24], { rz: Math.PI / 2 });

    // Plan de travail inox adossé au mur : plaques (dynamiques), planche, bocaux, balance, évier
    const L = TWIN_LAB;
    const w = twinBuilder(batch, env, L.tableX, L.tableZ);
    const Ht = L.tableH;
    const half = L.tableW / 2;
    w.part(g.box, m.steel, [0, Ht - 0.02, 0], [L.tableW, 0.04, L.tableD], { receive: true });
    w.part(g.box, m.steel, [0, Ht + 0.1, -L.tableD / 2 + 0.01], [L.tableW, 0.2, 0.02]);
    w.part(g.box, m.steel, [0, Ht - 0.09, L.tableD / 2 - 0.01], [L.tableW, 0.1, 0.02]);
    [-half + 0.05, 0, half - 0.05].forEach(lx => [-1, 1].forEach(s => w.part(g.box, m.steel, [lx, (Ht - 0.04) / 2, s * (L.tableD / 2 - 0.05)], [0.04, Ht - 0.04, 0.04])));
    w.part(g.box, m.steel, [0, 0.2, 0], [L.tableW - 0.06, 0.02, L.tableD - 0.08], { receive: true });
    [-1.6, -1.15, -0.7].forEach(sx => w.part(g.sack, m.kraft, [sx, 0.21, 0.02], [0.2, 0.28, 0.13]));
    [0.55, 0.85].forEach(sx => {
        w.part(g.box, m.white, [sx, 0.37, 0], [0.24, 0.32, 0.16]);
        w.part(g.cylLow, m.valveRed, [sx + 0.07, 0.55, -0.04], [0.025, 0.04, 0.025]);
    });
    w.part(g.box, m.woodLight, [-0.2, Ht + 0.01, 0.06], [0.4, 0.02, 0.28]);
    w.part(g.box, m.chrome, [-0.16, Ht + 0.024, 0.06], [0.2, 0.004, 0.025], { ry: 0.3 });
    w.part(g.box, m.dark, [-0.29, Ht + 0.026, 0.1], [0.08, 0.01, 0.022], { ry: 0.3 });
    w.part(g.cylLow, m.steel, [0.2, Ht + 0.08, -0.15], [0.06, 0.16, 0.06]);
    [[-0.02, 0.1], [0.02, -0.08]].forEach(([dx, rz]) => {
        w.part(g.box, m.steel, [0.2 + dx, Ht + 0.24, -0.15], [0.012, 0.22, 0.012], { rz });
        w.part(g.sphere, m.steel, [0.2 + dx * 3, Ht + 0.36, -0.15], [0.03, 0.02, 0.03]);
    });
    ['#C0392B', '#6C3483', '#E8E4C9', '#4E8B3A'].forEach((c, i) => {
        const jx = 0.45 + i * 0.14;
        w.part(g.cyl, m.tint, [jx, Ht + 0.065, -0.2], [0.045, 0.12, 0.045], { color: c });
        w.part(g.cylLow, m.jarGlass, [jx, Ht + 0.09, -0.2], [0.055, 0.18, 0.055]);
        w.part(g.cyl, m.steel, [jx, Ht + 0.19, -0.2], [0.058, 0.02, 0.058]);
    });
    w.part(g.box, m.white, [1.15, Ht + 0.025, 0.05], [0.25, 0.05, 0.25]);
    w.part(g.box, m.steel, [1.15, Ht + 0.054, 0.02], [0.22, 0.008, 0.18]);
    w.part(g.box, m.screen, [1.15, Ht + 0.03, 0.176], [0.1, 0.025, 0.003], { cast: false });
    w.part(g.box, m.steelDark, [1.6, Ht + 0.001, 0.02], [0.52, 0.003, 0.42], { cast: false });
    w.part(g.box, m.basin, [1.6, Ht + 0.003, 0.02], [0.44, 0.002, 0.34], { cast: false });
    w.part(g.cylLow, m.chrome, [1.6, Ht + 0.13, -0.26], [0.018, 0.26, 0.018]);
    w.part(g.cylLow, m.chrome, [1.6, Ht + 0.26, -0.18], [0.014, 0.17, 0.014], { rx: Math.PI / 2 });
    w.part(g.cylLow, m.chrome, [1.6, Ht + 0.22, -0.095], [0.012, 0.08, 0.012]);
    w.part(g.box, m.chrome, [1.6, Ht + 0.28, -0.28], [0.02, 0.015, 0.09]);

    // Poste d'embouteillage adossé au mur + caisses vides
    const e = twinBuilder(batch, env, L.bottling[0], L.bottling[1]);
    e.part(g.box, m.steel, [0, 0.88, 0], [1.6, 0.04, 0.6], { receive: true });
    [-0.76, 0.76].forEach(lx => [-1, 1].forEach(s => e.part(g.box, m.steel, [lx, 0.43, s * 0.26], [0.04, 0.86, 0.04])));
    e.part(g.box, m.steel, [0, 0.18, 0], [1.54, 0.02, 0.52], { receive: true });
    e.part(g.box, m.steel, [-0.15, 1.34, -0.12], [0.5, 0.24, 0.22]);
    e.part(g.cylLow, m.steelDark, [-0.15, 1.5, -0.12], [0.07, 0.08, 0.07]);
    [-1, 1].forEach(s => e.part(g.box, m.steelDark, [-0.15 + s * 0.22, 1.08, -0.2], [0.04, 0.38, 0.04]));
    const fill = twinBottleSpec(50);
    for (let k = 0; k < 4; k++) {
        const nx = -0.33 + k * 0.12;
        e.part(g.cylLow, m.chrome, [nx, 1.18, -0.05], [0.01, 0.08, 0.01]);
        e.part(g.bottle, m.bottleTint, [nx, 0.9, -0.05], [fill.d / 2, fill.h, fill.d / 2], { color: '#D9A86C' });
    }
    e.part(g.box, m.white, [0.5, 1.05, -0.18], [0.22, 0.3, 0.16]);
    e.part(g.cylLow, m.ledOn, [0.45, 1.12, -0.098], [0.02, 0.006, 0.02], { rx: Math.PI / 2, cast: false });
    e.part(g.cylLow, m.valveRed, [0.55, 1.12, -0.098], [0.02, 0.006, 0.02], { rx: Math.PI / 2, cast: false });
    twinCrate(e, 0.4, 0.9, 0.06, '#8E959B', 0.18);
    [0, 1, 2, 3, 4].forEach(k => twinCrate(e, 1.3, k * 0.18, 0.0, '#8E959B', 0.18));

    // Chariot inox (ingrédients) et enrouleur de tuyau de lavage
    const c = twinBuilder(batch, env, -6.6, -3.6, 0.35);
    [0.16, 0.5, 0.86].forEach(y => c.part(g.box, m.steel, [0, y, 0], [0.8, 0.02, 0.5], { receive: true }));
    [-1, 1].forEach(sx => [-1, 1].forEach(sz => {
        c.part(g.cylLow, m.steel, [sx * 0.39, 0.5, sz * 0.24], [0.012, 0.8, 0.012]);
        c.part(g.cyl, m.rubber, [sx * 0.39, 0.04, sz * 0.24], [0.04, 0.03, 0.04], { rx: Math.PI / 2 });
    }));
    c.part(g.cylLow, m.steel, [-0.39, 0.95, 0], [0.012, 0.5, 0.012], { rx: Math.PI / 2 });
    [-1, 1].forEach(sz => c.part(g.cylLow, m.steel, [-0.39, 0.92, sz * 0.24], [0.01, 0.06, 0.01]));
    [-0.22, 0.03, 0.26].forEach((sx, i) => c.part(g.sack, m.kraft, [sx, 0.87, 0], [0.11, 0.2 - i * 0.02, 0.09]));
    [-0.18, 0.18].forEach(sx => c.part(g.box, m.white, [sx, 0.28, 0], [0.3, 0.22, 0.3]));
    const hose = twinBuilder(batch, env, -6.7, inner);
    hose.part(g.box, m.steelDark, [0, 1.0, 0.02], [0.4, 0.4, 0.04]);
    hose.part(g.cylLow, m.hazard, [0, 1.0, 0.11], [0.18, 0.12, 0.18], { rx: Math.PI / 2 });
    hose.part(g.torus, m.dark, [0, 1.0, 0.11], [0.15, 0.15, 1.6]);
    hose.part(g.cylLow, m.chrome, [0.24, 0.6, 0.06], [0.015, 0.4, 0.015]);

    // Vestiaire : casiers, banc, pointeuse
    for (let k = 0; k < 6; k++) {
        const lz = 4.0 + k * 0.41;
        b.part(g.box, m.locker, [1.15, 0.9, lz], [0.45, 1.8, 0.4]);
        b.part(g.box, m.lockerDoor, [0.922, 0.9, lz], [0.008, 1.72, 0.37]);
        [0, 1, 2].forEach(v => b.part(g.box, m.dark, [0.917, 1.62 - v * 0.045, lz], [0.004, 0.02, 0.22], { cast: false }));
        b.part(g.box, m.chrome, [0.915, 0.95, lz + 0.13], [0.008, 0.1, 0.02], { cast: false });
    }
    b.part(g.box, m.woodDark, [0.4, 0.44, 5.0], [0.3, 0.04, 2.2]);
    [4.1, 5.9].forEach(z => b.part(g.box, m.steelDark, [0.4, 0.21, z], [0.26, 0.42, 0.04]));
    b.part(g.box, m.steelDark, [1.2, 0.6, 2.2], [0.08, 1.2, 0.08]);
    b.part(g.box, m.dark, [1.13, 1.35, 2.2], [0.12, 0.3, 0.24]);
    b.part(g.box, m.screen, [1.068, 1.4, 2.2], [0.004, 0.14, 0.18], { cast: false });
    b.part(g.box, m.steel, [1.068, 1.26, 2.2], [0.004, 0.04, 0.1], { cast: false });

    // Extincteurs, transpalette
    [[-1.5, inner, 0], [12.0, 1.2, -Math.PI / 2]].forEach(([x, z, ry]) => {
        const f = twinBuilder(batch, env, x, z, ry);
        f.part(g.cyl, m.extinguisher, [0, 0.4, 0.12], [0.08, 0.5, 0.08]);
        f.part(g.cylLow, m.dark, [0, 0.69, 0.12], [0.035, 0.08, 0.035]);
        f.part(g.box, m.dark, [0.04, 0.72, 0.12], [0.1, 0.02, 0.02]);
        f.part(g.box, m.extinguisher, [0, 1.15, 0.01], [0.2, 0.2, 0.01], { cast: false });
    });
    const pj = twinBuilder(batch, env, 10.6, -1.6, Math.PI / 2);
    [-1, 1].forEach(s => {
        pj.part(g.box, m.steelDark, [0.1, 0.045, s * 0.2], [1.15, 0.05, 0.16]);
        pj.part(g.cylLow, m.rubber, [0.6, 0.04, s * 0.2], [0.04, 0.1, 0.04], { rx: Math.PI / 2 });
    });
    pj.part(g.box, m.rackOrange, [-0.6, 0.28, 0], [0.26, 0.46, 0.52]);
    pj.part(g.cyl, m.rubber, [-0.6, 0.08, 0], [0.08, 0.12, 0.08], { rx: Math.PI / 2 });
    pj.part(g.cylLow, m.steelDark, [-0.82, 0.82, 0], [0.02, 0.9, 0.02], { rz: 0.35 });
    pj.part(g.box, m.dark, [-0.98, 1.24, 0], [0.05, 0.05, 0.3]);

    twinBatchFlush(batch, env);
    Twin.scene.add(env);
};

const twinBuildMarkers = () => {
    const { THREE } = Twin.lib;
    const p = Twin.palette;
    const hover = twinMesh(twinGeometries().ring, new THREE.MeshBasicMaterial({ color: p.primary, transparent: true, opacity: 0.45, depthWrite: false }), { cast: false });
    hover.rotation.x = -Math.PI / 2;
    hover.visible = false;
    const select = twinMesh(twinGeometries().ring, new THREE.MeshBasicMaterial({ color: p.primary, transparent: true, opacity: 0.95, depthWrite: false }), { cast: false });
    select.rotation.x = -Math.PI / 2;
    select.visible = false;
    const pin = new THREE.Group();
    const pinMat = new THREE.MeshStandardMaterial({ color: p.primary, emissive: p.primary, emissiveIntensity: 0.5 });
    const stem = twinMesh(twinGeometries().cyl, pinMat, { cast: false });
    stem.scale.set(0.03, 0.9, 0.03);
    stem.position.y = 0.75;
    const tip = twinMesh(twinGeometries().cone, pinMat, { cast: false });
    tip.scale.set(0.2, 0.36, 0.2);
    tip.rotation.x = Math.PI;
    tip.position.y = 0.18;
    pin.add(stem, tip);
    pin.visible = false;
    Twin.markers.add(hover, select, pin);
    Object.assign(Twin, { hoverRing: hover, selectRing: select, pin });
};

// Volume de sélection invisible (hors scène) + ancrages des marqueurs et labels
const twinRegister = (item, b, { hit, top, radius, base = [0, 0, 0] }) => {
    const { THREE } = Twin.lib;
    const proxy = new THREE.Mesh(twinGeometries().box, twinMaterials().proxy);
    b.matrix(hit.p, hit.s).decompose(proxy.position, proxy.quaternion, proxy.scale);
    proxy.userData.twinId = item.id;
    Twin.proxies.add(proxy);
    Twin.objects.set(item.id, {
        id: item.id, zone: item.zone, radius,
        base: b.point(base),
        top: b.point([base[0], top, base[2]])
    });
};

const twinSetLiquid = (mesh, base, radius, h) => {
    mesh.scale.set(radius, h, radius);
    mesh.position.y = base + h / 2;
};

const twinAddFill = (id, targets, fill) => {
    const from = Twin.prevFill.has(id) ? Twin.prevFill.get(id) : fill;
    const start = performance.now();
    targets.forEach(t => {
        Twin.fills.push({ ...t, from, to: fill, start });
        twinSetLiquid(t.mesh, t.base, t.radius, Math.max(0.002, (twinReducedMotion() ? fill : from) * t.maxH));
    });
    Twin.prevFill.set(id, fill);
};

// --- Équipement de production : cuve inox 25 L sur trépied ---
const twinBuildCuve = (batch, e, x, z) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const cm = e.couleur ? twinColorMats(e.couleur) : null;
    const b = twinBuilder(batch, Twin.dynamic, x, z);
    const { R, H, stand } = TWIN_CUVE;
    const cone = 0.26 * H;
    const body0 = stand + cone;
    const rim = stand + H;
    const planned = e.status === 'planned';
    // Pieds jusqu'au fond conique (rayon 0,14 m → hauteur de contact sur le cône)
    const legR = 0.14;
    const legTop = stand + (legR - 0.1 * R) / (0.9 * R) * cone;
    for (let k = 0; k < 3; k++) {
        const a = -Math.PI / 2 + k * (Math.PI * 2 / 3);
        const lx = Math.cos(a) * legR;
        const lz = Math.sin(a) * legR;
        b.part(g.cylLow, m.steel, [lx, legTop / 2, lz], [0.011, legTop, 0.011]);
        b.part(g.cylLow, m.rubber, [lx, 0.008, lz], [0.022, 0.016, 0.022]);
    }
    b.part(g.torus, m.steel, [0, 0.16, 0], [legR, legR, 0.5], { rx: Math.PI / 2 });
    b.part(g.tankShell, m.steelShell, [0, stand, 0], [R, H, R]);
    b.part(g.torus, m.steel, [0, rim + 0.004, 0], [R * 0.955, R * 0.955, 0.8], { rx: Math.PI / 2 });
    [0.5, 0.78].forEach(f => b.part(g.torus, m.steelDark, [0, stand + H * f, 0], [R * 1.003, R * 1.003, 0.3], { rx: Math.PI / 2, cast: false }));
    b.part(g.torus, cm ? cm.band : m.steelDark, [0, rim - 0.04, 0], [R * 1.01, R * 1.01, 0.7], { rx: Math.PI / 2, cast: false });
    [-1, 1].forEach(s => {
        b.part(g.box, m.steel, [s * (R + 0.028), rim - 0.08, 0], [0.012, 0.012, 0.09]);
        [-0.04, 0.04].forEach(dz => b.part(g.box, m.steel, [s * (R + 0.014), rim - 0.08, dz], [0.028, 0.01, 0.01]));
    });
    // Vanne de vidange sous la pointe du cône
    b.part(g.cylLow, m.steel, [0, stand - 0.04, 0], [0.012, 0.09, 0.012]);
    b.part(g.cylLow, m.steel, [0, stand - 0.08, 0.06], [0.011, 0.13, 0.011], { rx: Math.PI / 2 });
    b.part(g.box, m.chrome, [0, stand - 0.08, 0.13], [0.035, 0.035, 0.03]);
    b.part(g.box, m.valveRed, [0.02, stand - 0.055, 0.13], [0.075, 0.008, 0.014]);
    // Tube de niveau en verre + raccords + graduations
    const tubeX = 0.1;
    const tubeZ = Math.sqrt(R * R - tubeX * tubeX) + 0.028;
    const t0 = body0 + 0.02;
    const t1 = rim - 0.07;
    const tubeLen = t1 - t0;
    b.part(g.cylLow, m.sightGlass, [tubeX, (t0 + t1) / 2, tubeZ], [0.009, tubeLen, 0.009]);
    [t0, t1].forEach(ty => b.part(g.cylLow, m.steel, [tubeX, ty, tubeZ - 0.02], [0.006, 0.04, 0.006], { rx: Math.PI / 2 }));
    for (let k = 1; k < 5; k++) b.part(g.box, m.dark, [tubeX + 0.014, t0 + tubeLen * k / 5, tubeZ], [0.01, 0.002, 0.002], { cast: false });
    const plateX = -0.075;
    b.mesh(g.box, twinPlateMaterial(`cuve${e.numero}`, `CUVE ${e.numero}`, `${e.capacite} L`, Twin.palette.primary),
        [plateX, stand + H * 0.58, Math.sqrt(R * R - plateX * plateX) + 0.004], [0.11, 0.055, 0.003], { cast: false, ry: Math.asin(plateX / R) });
    // Couvercle : ouvert (charnière arrière) si une production est planifiée
    if (planned) {
        const a = 1.42;
        b.part(g.cyl, m.steel, [0, rim + 0.012 + Math.sin(a) * R, -R + Math.cos(a) * R], [R * 1.03, 0.008, R * 1.03], { rx: -a });
        b.part(g.box, m.steelDark, [0, rim + 0.01, -R - 0.006], [0.08, 0.016, 0.016]);
        twinFlat(b, g.ring, m.ringPlanned, 0, 0.008, 0, 0.3, 0.3);
    } else {
        b.part(g.cyl, m.steel, [0, rim + 0.01, 0], [R * 1.03, 0.008, R * 1.03]);
        b.part(g.torus, m.chrome, [0, rim + 0.004, 0], [R * 1.035, R * 1.035, 0.5], { rx: Math.PI / 2, cast: false });
        b.part(g.cylLow, m.steelDark, [0, rim + 0.025, 0], [0.018, 0.022, 0.018]);
    }
    if (planned && cm) {
        const liquid = b.mesh(g.cyl, cm.liquid, [0, 0, 0], [1, 1, 1], { cast: false });
        const tube = b.mesh(g.cylLow, cm.liquid, [tubeX, 0, tubeZ], [1, 1, 1], { cast: false });
        twinAddFill(e.id, [
            { mesh: liquid, base: body0 - 0.004, radius: R * 0.965, maxH: rim - 0.02 - body0 },
            { mesh: tube, base: t0, radius: 0.006, maxH: tubeLen }
        ], e.fill);
    } else {
        Twin.prevFill.set(e.id, 0);
    }
    twinRegister(e, b, { hit: { p: [0, (rim + 0.04) / 2, 0], s: [0.38, rim + 0.04, 0.38] }, top: rim + 0.4, radius: 0.3 });
};

// --- Équipement de production : plaque à induction posée sur le plan + casserole ---
const twinBuildInduction = (batch, e, x, z) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const Ht = TWIN_LAB.tableH;
    const b = twinBuilder(batch, Twin.dynamic, x, z, 0, Ht);
    const on = e.status === 'planned';
    b.part(g.box, m.plastic, [0, 0.028, 0], [0.29, 0.056, 0.36]);
    b.part(g.box, m.glassTop, [0, 0.059, -0.03], [0.28, 0.006, 0.28]);
    b.part(g.torus, on ? m.inductionOn : m.inductionOff, [0, 0.063, -0.03], [0.1, 0.1, 0.25], { rx: Math.PI / 2, cast: false });
    b.part(g.box, m.plasticLight, [0, 0.058, 0.145], [0.27, 0.006, 0.05]);
    [-0.07, -0.03, 0.01].forEach(bx => b.part(g.cylLow, m.dark, [bx, 0.063, 0.145], [0.009, 0.004, 0.009], { cast: false }));
    b.part(g.box, on ? m.ledOn : m.ledOff, [0.08, 0.062, 0.145], [0.03, 0.003, 0.008], { cast: false });
    const { r, h } = TWIN_POTS[e.capacite] || TWIN_POTS[9];
    const py = 0.062;
    b.part(g.pot, m.steelShell, [0, py, -0.03], [r, h, r]);
    [-1, 1].forEach(s => {
        b.part(g.box, m.dark, [s * (r + 0.055), py + h - 0.03, -0.03], [0.08, 0.016, 0.026]);
        b.part(g.box, m.steel, [s * (r + 0.012), py + h - 0.03, -0.03], [0.024, 0.02, 0.03]);
    });
    if (on) {
        b.part(g.cyl, m.steel, [0.04, py + h + 0.035, -0.05], [r * 1.04, 0.006, r * 1.04], { rz: 0.3 });
        b.part(g.sphere, m.dark, [0.035, py + h + 0.052, -0.05], [0.016, 0.012, 0.016]);
    } else {
        b.part(g.cyl, m.steel, [0, py + h * 1.03 + 0.004, -0.03], [r * 1.05, 0.006, r * 1.05]);
        b.part(g.sphere, m.dark, [0, py + h * 1.03 + 0.016, -0.03], [0.016, 0.012, 0.016]);
    }
    if (on && e.couleur) {
        const liquid = b.mesh(g.cyl, twinColorMats(e.couleur).liquid, [0, 0, -0.03], [1, 1, 1], { cast: false });
        twinAddFill(e.id, [{ mesh: liquid, base: Ht + py + h * 0.065, radius: r * 0.95, maxH: h * 0.88 }], e.fill);
    } else {
        Twin.prevFill.set(e.id, 0);
    }
    // Étiquette sur le bandeau avant du plan de travail
    const front = TWIN_LAB.tableZ + TWIN_LAB.tableD / 2 - z + 0.002;
    b.mesh(g.box, twinPlateMaterial(`plaque${e.numero}`, `PLAQUE ${e.numero}`, `Casserole ${e.capacite} L`, '#2A2A2A'),
        [0, -0.09, front], [0.18, 0.08, 0.003], { cast: false });
    twinRegister(e, b, { hit: { p: [0, (py + h) / 2 + 0.01, -0.01], s: [0.36, py + h + 0.06, 0.4] }, top: py + h + 0.4, radius: 0.24 });
};

// --- Entrepôt : palette Europe + casiers (8 par couche) + bouteilles visibles ---
const TWIN_ORDER_SLOTS = 16;
const TWIN_SLOTS_8 = [-0.45, -0.15, 0.15, 0.45].flatMap(dx => [0.2, -0.2].map(dz => [dx, dz]));

const twinBuildStack = (batch, s, x, z) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const b = twinBuilder(batch, Twin.dynamic, x, z);
    twinPallet(b, 0, 0);
    [-1, 1].forEach(sx => [-1, 1].forEach(sz => {
        twinFlat(b, g.plane, m.marking, sx * 0.68, 0.006, sz * 0.36, 0.04, 0.2);
        twinFlat(b, g.plane, m.marking, sx * 0.6, 0.006, sz * 0.46, 0.2, 0.04);
    }));
    const spec = twinBottleSpec(s.contenanceCl);
    const crateH = Math.round(spec.h * 0.7 * 100) / 100;
    const crates = s.total > 0 ? Math.ceil(s.total / s.crateSize) : 0;
    const layers = Math.min(8, Math.ceil(crates / 8));
    let top = TWIN_PALLET_TOP;
    if (crates > 0) {
        for (let l = 0; l < layers; l++) {
            const inLayer = l < layers - 1 || crates > layers * 8 ? 8 : crates - (layers - 1) * 8;
            const y = TWIN_PALLET_TOP + l * crateH;
            for (let c = 0; c < inLayer; c++) {
                const [cx, cz] = TWIN_SLOTS_8[c];
                twinCrate(b, cx, y, cz, s.couleur, crateH);
                if (l === layers - 1) {
                    const last = crates <= layers * 8 && c === inLayer - 1;
                    const count = last ? (s.total - (crates - 1) * s.crateSize) : s.crateSize;
                    twinCrateBottles(b, cx, y + 0.012, cz, count, s.crateSize, s.contenanceCl, s.couleur);
                }
            }
        }
        top = TWIN_PALLET_TOP + (layers - 1) * crateH + 0.012 + spec.h + 0.02;
        // Fiche palette sur le premier casier (toujours présent)
        const [lx] = TWIN_SLOTS_8[0];
        b.part(g.box, m.label, [lx, TWIN_PALLET_TOP + crateH * 0.45, 0.403], [0.16, 0.08, 0.003], { cast: false });
        b.part(g.box, m.tint, [lx, TWIN_PALLET_TOP + crateH * 0.45 + 0.03, 0.405], [0.16, 0.016, 0.003], { color: s.couleur, cast: false });
        for (let k = 0; k < 7; k++) b.part(g.box, m.dark, [lx - 0.05 + k * 0.016, TWIN_PALLET_TOP + crateH * 0.45 - 0.012, 0.405], [0.006, 0.03, 0.002], { cast: false });
    } else {
        const ghost = new Twin.lib.THREE.LineSegments(g.edges, m.ghost);
        b.matrix([0, TWIN_PALLET_TOP + 0.2, 0], [1.2, 0.4, 0.8]).decompose(ghost.position, ghost.quaternion, ghost.scale);
        Twin.dynamic.add(ghost);
        b.part(g.box, m.ghostFill, [0, TWIN_PALLET_TOP + 0.2, 0], [1.2, 0.4, 0.8]);
        top = TWIN_PALLET_TOP + 0.4;
    }
    const ring = { expired: m.ringDanger, invendable: m.ringDanger, rupture: m.ringWarning, warning: m.ringWarningSoft }[s.status];
    if (ring) twinFlat(b, g.ring, ring, 0, 0.008, 0, 0.82, 0.82);
    twinRegister(s, b, { hit: { p: [0, top / 2, 0], s: [1.2, top, 0.8] }, top: top + 0.3, radius: 0.78 });
};

// --- Expédition : palette Europe de cartons de 12 bouteilles (8 par couche) ---
const twinBuildOrder = (batch, o, x, z) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const b = twinBuilder(batch, Twin.dynamic, x, z);
    twinPallet(b, 0, 0);
    const boxH = 0.26;
    const cartons = Math.max(1, Math.ceil(o.totalBt / 12));
    const layers = Math.min(6, Math.ceil(cartons / 8));
    const krafts = ['#C9A878', '#C2A070', '#D0B183'];
    const stripe = o.late ? '#C0392B' : o.urgent ? '#C8960A' : o.statut === 'produite' ? '#5C8A3C' : '#2E72B8';
    for (let l = 0; l < layers; l++) {
        const inLayer = l < layers - 1 || cartons > layers * 8 ? 8 : cartons - (layers - 1) * 8;
        const y = TWIN_PALLET_TOP + l * boxH;
        for (let c = 0; c < inLayer; c++) {
            const [cx, cz] = TWIN_SLOTS_8[c];
            b.part(g.box, m.tint, [cx, y + boxH / 2, cz], [0.296, boxH - 0.004, 0.396], { color: krafts[(l + c) % 3] });
            if (l === layers - 1) {
                b.part(g.box, m.kraftTape, [cx, y + boxH + 0.001, cz], [0.05, 0.003, 0.4], { cast: false });
                if (cz > 0) {
                    b.part(g.box, m.label, [cx, y + boxH * 0.55, cz + 0.2], [0.12, 0.08, 0.003], { cast: false });
                    b.part(g.box, m.tint, [cx, y + boxH * 0.55 + 0.032, cz + 0.202], [0.12, 0.014, 0.002], { color: stripe, cast: false });
                    for (let k = 0; k < 6; k++) b.part(g.box, m.dark, [cx - 0.04 + k * 0.016, y + boxH * 0.55 - 0.014, cz + 0.202], [0.006, 0.03, 0.002], { cast: false });
                }
            }
        }
    }
    const top = TWIN_PALLET_TOP + layers * boxH;
    if (o.statut === 'produite') {
        // Film étirable ajusté à l'emprise réelle des cartons (couche du bas, la plus complète)
        const used = TWIN_SLOTS_8.slice(0, Math.min(8, cartons));
        const x0 = Math.min(...used.map(p => p[0])) - 0.155;
        const x1 = Math.max(...used.map(p => p[0])) + 0.155;
        const z0 = Math.min(...used.map(p => p[1])) - 0.205;
        const z1 = Math.max(...used.map(p => p[1])) + 0.205;
        const fh = layers * boxH;
        b.part(g.box, m.film, [(x0 + x1) / 2, TWIN_PALLET_TOP + fh / 2, (z0 + z1) / 2], [x1 - x0, fh + 0.01, z1 - z0]);
        [x0, x1].forEach(cx => [z0, z1].forEach(cz => b.part(g.box, m.kraftTape, [cx, TWIN_PALLET_TOP + fh / 2, cz], [0.035, fh, 0.035])));
    }
    if (o.late || o.urgent) {
        // Gyrophare posé sur le premier carton de la couche du haut
        const [bx, bz] = TWIN_SLOTS_8[0];
        b.part(g.cylLow, m.steelDark, [bx + 0.08, top + 0.16, bz + 0.1], [0.015, 0.32, 0.015]);
        b.part(g.sphere, o.late ? m.beaconDanger : m.beaconWarning, [bx + 0.08, top + 0.37, bz + 0.1], [0.06, 0.06, 0.06], { cast: false });
        twinFlat(b, g.ring, o.late ? m.ringDanger : m.ringWarning, 0, 0.008, 0, 0.82, 0.82);
    } else if (o.statut === 'produite') {
        twinFlat(b, g.ring, m.ringSuccess, 0, 0.008, 0, 0.82, 0.82);
    }
    twinRegister(o, b, { hit: { p: [0, top / 2, 0], s: [1.2, top, 0.8] }, top: top + 0.55, radius: 0.78 });
};

// --- Consommables : rayonnage 2 × 0,6 × 2 m, 4 niveaux de 3 bacs ---
const TWIN_SHELF_LEVELS = [0.12, 0.6, 1.08, 1.56];

const twinBuildShelving = (batch, x, z) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const b = twinBuilder(batch, Twin.dynamic, x, z);
    [-1.0, 1.0].forEach(px => {
        [-0.28, 0.28].forEach(pz => {
            b.part(g.box, m.rackBlue, [px, 1.0, pz], [0.05, 2.0, 0.05]);
            b.part(g.box, m.steelDark, [px, 0.005, pz], [0.1, 0.01, 0.1]);
        });
        [0.4, 1.0, 1.95].forEach(y => b.part(g.box, m.rackBlue, [px, y, 0], [0.025, 0.025, 0.56]));
        b.part(g.box, m.rackBlue, [px, 0.7, 0], [0.02, 0.65, 0.02], { rx: 0.62 });
        b.part(g.box, m.rackBlue, [px, 1.47, 0], [0.02, 0.65, 0.02], { rx: -0.62 });
    });
    TWIN_SHELF_LEVELS.forEach(y => {
        [-0.28, 0.28].forEach(pz => b.part(g.box, m.rackOrange, [0, y - 0.03, pz], [1.95, 0.05, 0.03]));
        b.part(g.box, m.steel, [0, y, 0], [1.95, 0.02, 0.56], { receive: true });
    });
    const slots = [];
    TWIN_SHELF_LEVELS.forEach(y => [-0.64, 0, 0.64].forEach(sx => slots.push([x + sx, y + 0.01, z])));
    return slots;
};

const twinBuildBin = (batch, item, x, y, z) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const b = twinBuilder(batch, Twin.dynamic, x, z, 0, y);
    const W = 0.58;
    const D = 0.4;
    const H = 0.28;
    b.part(g.box, m.binPlastic, [0, 0.006, 0], [W - 0.02, 0.012, D - 0.02]);
    b.part(g.box, m.binPlastic, [0, H / 2, -D / 2 + 0.006], [W, H, 0.012]);
    [-1, 1].forEach(s => b.part(g.box, m.binPlastic, [s * (W / 2 - 0.006), H / 2, 0], [0.012, H, D]));
    b.part(g.box, m.binPlastic, [0, 0.07, D / 2 - 0.006], [W, 0.14, 0.012]);
    const stateColor = TWIN_STATE_COLORS[item.state] || TWIN_STATE_COLORS.unknown;
    b.part(g.box, m.label, [0, 0.085, D / 2 + 0.002], [0.2, 0.07, 0.003], { cast: false });
    b.part(g.box, m.tint, [0, 0.114, D / 2 + 0.004], [0.2, 0.014, 0.003], { color: stateColor, cast: false });
    if (item.level > 0) {
        const h = Math.max(0.03, 0.24 * item.level);
        const family = getUnitFamily(item.unite);
        if (family === 'mass') {
            [-0.14, 0.14].forEach(sx => b.part(g.sack, m.stateTint, [sx, 0.012, 0], [0.13, h, 0.16], { color: stateColor }));
        } else if (family === 'volume') {
            [-0.14, 0.14].forEach(sx => {
                b.part(g.box, m.stateTint, [sx, 0.012 + h / 2, 0], [0.22, h, 0.3], { color: stateColor });
                b.part(g.cylLow, m.dark, [sx + 0.06, 0.012 + h + 0.012, -0.09], [0.02, 0.024, 0.02]);
            });
        } else {
            b.part(g.box, m.stateTint, [0, 0.012 + h / 2, 0], [W - 0.04, h, D - 0.04], { color: stateColor });
            [-0.13, 0.13].forEach(sx => b.part(g.box, m.dark, [sx, 0.012 + h + 0.001, 0], [0.004, 0.002, D - 0.05], { cast: false }));
        }
    }
    // Voyant clignotant sur l'étiquette (un anneau au sol déborderait de l'étagère)
    if (item.state === 'critical' || item.state === 'low') {
        b.part(g.sphere, item.state === 'critical' ? m.beaconDanger : m.beaconWarning, [0.085, 0.085, D / 2 + 0.008], [0.013, 0.013, 0.013], { cast: false });
    }
    twinRegister(item, b, { hit: { p: [0, H / 2, 0], s: [W, H, D] }, top: H + 0.3, radius: 0.36 });
};

// --- Équipe : personnage en tenue de production (1,75 m) ---
const twinBuildFigure = (batch, s, x, z, ry, phase) => {
    const { THREE } = Twin.lib;
    const m = twinMaterials();
    const g = twinGeometries();
    const b = twinBuilder(batch, Twin.dynamic, x, z, ry);
    if (s.present) {
        const holder = new THREE.Group();
        holder.position.set(x, 0, z);
        holder.rotation.y = ry;
        const body = new THREE.Group();
        holder.add(body);
        const local = twinBuilder(batch, body, 0, 0);
        const mats = { pants: m.pants, dark: m.dark, shirt: twinColorMats(s.couleur).figure, skin: m.skin, apron: m.apron, cap: m.apron };
        twinFigureParts((geo, mat, p, sc, o) => local.mesh(geo, mat, p, sc, o), mats);
        Twin.dynamic.add(holder);
        Twin.bobbers.push({ mesh: body, phase });
        twinFlat(b, g.ring, m.ringSuccess, 0, 0.008, 0, 0.4, 0.4);
    } else {
        const ghost = { pants: m.absent, dark: m.absent, shirt: m.absent, skin: m.absent, apron: m.absent, cap: m.absent };
        twinFigureParts((geo, mat, p, sc, o) => b.part(geo, mat, p, sc, o), ghost);
    }
    twinRegister(s, b, { hit: { p: [0, 0.88, 0], s: [0.6, 1.76, 0.45] }, top: 2.0, radius: 0.4 });
};

const twinSignature = (item) => {
    switch (item.kind) {
        case 'cuve':
        case 'casserole': return `${item.arome}|${item.litres}`;
        case 'stack': return `${item.total}|${item.sellable}|${item.status}`;
        case 'order': return `${item.statut}|${item.totalBt}|${item.status}`;
        case 'bin': return `${item.quantite}|${item.state}`;
        case 'staff': return `${item.present}`;
        default: return '';
    }
};

const twinClearDynamic = () => {
    Twin.dynamic.traverse(o => { if (o.isInstancedMesh) o.dispose(); });
    Twin.dynamic.clear();
    Twin.proxies.clear();
    Twin.objects.clear();
    Twin.pickables = [];
    Twin.fills = [];
    Twin.bobbers = [];
};

const twinBuildDynamic = (model) => {
    twinClearDynamic();
    const batch = twinBatch();
    const zone = (id) => TWIN_ZONES.find(z => z.id === id).bounds;

    let cuveIndex = 0;
    let plateIndex = 0;
    model.equipement.forEach(e => {
        if (e.kind === 'cuve' && cuveIndex < 6) twinBuildCuve(batch, e, ...TWIN_LAB.cuve(cuveIndex++));
        else if (e.kind === 'casserole' && plateIndex < 3) twinBuildInduction(batch, e, ...TWIN_LAB.plate(plateIndex++));
    });

    const [sx0, sz0, sx1, sz1] = zone('stock');
    const cols = Math.max(1, model.grid.cols.length);
    const rows = Math.max(1, model.grid.rows.length);
    const stepX = Math.min(1.8, (sx1 - sx0 - 2.0) / cols);
    const stepZ = Math.min(1.25, (sz1 - sz0 - 0.6) / rows);
    const gridX0 = sx0 + 1.8 + stepX / 2;
    const gridZ0 = sz0 + 0.5 + stepZ / 2;
    Twin.stockLayout = { gridX0, gridZ0, stepX, stepZ, rows, cols };
    model.stacks.forEach(s => twinBuildStack(batch, s, gridX0 + s.col * stepX, gridZ0 + s.row * stepZ));

    model.orders.slice(0, TWIN_ORDER_SLOTS).forEach((o, i) => twinBuildOrder(batch, o, 9.4 - (i % 4) * 1.9, 2.4 + Math.floor(i / 4) * 1.5));

    const unitCenters = [2.4, 4.6, 6.8].flatMap(uz => [-10.3, -7.8, -5.3, -2.8].map(ux => [ux, uz]));
    const units = Math.min(unitCenters.length, Math.ceil(model.bins.length / 12));
    const slots = [];
    for (let u = 0; u < units; u++) slots.push(...twinBuildShelving(batch, ...unitCenters[u]));
    model.bins.slice(0, slots.length).forEach((bin, i) => twinBuildBin(batch, bin, ...slots[i]));

    let station = 0;
    let overflow = 0;
    let absent = 0;
    model.staff.forEach((s, i) => {
        if (s.present && station < TWIN_STATIONS.length) {
            const st = TWIN_STATIONS[station++];
            twinBuildFigure(batch, s, st.x, st.z, st.ry, i);
        } else if (s.present && overflow < 6) {
            twinBuildFigure(batch, s, overflow % 2 ? 0.55 : -0.55, 2.2 + Math.floor(overflow / 2) * 0.7, 0, i);
            overflow++;
        } else if (!s.present && absent < 8) {
            twinBuildFigure(batch, s, -0.9 + (absent % 2) * 0.6, 4.1 + Math.floor(absent / 2) * 0.55, Math.PI / 2, i);
            absent++;
        }
    });

    twinBatchFlush(batch, Twin.dynamic);
    Twin.proxies.updateMatrixWorld(true);
    Twin.pickables = Twin.proxies.children;

    const nextSignatures = new Map(model.items.map(i => [i.id, twinSignature(i)]));
    if (Twin.signatures.size) {
        nextSignatures.forEach((sig, id) => {
            if (Twin.signatures.get(id) !== sig) twinFlash(id);
        });
    }
    Twin.signatures = nextSignatures;
    const mats = twinMaterials();
    Twin.pulseMats = [mats.ringDanger, mats.ringWarning, mats.beaconDanger, mats.beaconWarning];
    Twin.pulsing = model.items.some(i => ['expired', 'invendable', 'rupture', 'late', 'urgent'].includes(i.status) || i.state === 'critical');
    Twin.glowing = model.equipement.some(e => e.kind === 'casserole' && e.status === 'planned');
};

const twinFlash = (id) => {
    const obj = Twin.objects.get(id);
    if (!obj || twinReducedMotion()) return;
    const { THREE } = Twin.lib;
    const mesh = twinMesh(twinGeometries().ring, new THREE.MeshBasicMaterial({
        color: Twin.palette.info, transparent: true, opacity: 0.9, depthWrite: false
    }), { cast: false });
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(obj.base);
    mesh.position.y += 0.02;
    Twin.markers.add(mesh);
    Twin.flashes.push({ mesh, radius: obj.radius, start: performance.now() });
};

// --- Labels HTML projetés sur la scène ---
const twinAddLabel = (pos, html, cls, { id = null, far = 999, near = 0 } = {}) => {
    const el = document.createElement(id ? 'button' : 'div');
    el.className = `twin-label ${cls}`;
    el.innerHTML = html;
    if (id) {
        el.type = 'button';
        el.tabIndex = -1;
        el.setAttribute('data-click', 'twin-select');
        el.setAttribute('data-id', id);
    }
    Twin.labelsEl.appendChild(el);
    Twin.labels.push({ el, pos, far, near });
};

const twinBuildLabels = (model) => {
    if (!Twin.labelsEl) return;
    const { THREE } = Twin.lib;
    Twin.labelsEl.innerHTML = '';
    Twin.labels = [];
    const k = model.kpis;
    const zoneSub = {
        production: k.aProduireL > 0 ? `${twinFmtLitres(k.aProduireL)} · ${k.postesOccupes}/${k.postesTotal} postes${k.enAttente ? ` · +${k.enAttente}` : ''}` : 'Rien à produire',
        stock: `${twinFmtInt(k.stockVendable)} bt vendables`,
        expedition: `${k.commandes} commande${k.commandes > 1 ? 's' : ''}${model.orders.length > TWIN_ORDER_SLOTS ? ` (+${model.orders.length - TWIN_ORDER_SLOTS})` : ''}`,
        magasin: `${k.consoTotal} articles${k.consoCritiques ? ` · ${k.consoCritiques} sous seuil` : ''}`,
        equipe: `${k.presents}/${k.effectif} présents`
    };
    TWIN_ZONES.forEach(zone => {
        const [x0, , , z1] = zone.bounds;
        twinAddLabel(new THREE.Vector3(x0 + 0.2, 0.03, z1 + 0.22),
            `<strong>${escapeHtml(zone.label)}</strong><span>${escapeHtml(zoneSub[zone.id])}</span>`,
            `twin-label--zone twin-label--${zone.id}`, { near: 8 });
    });
    const sl = Twin.stockLayout;
    if (sl) {
        model.grid.rows.forEach((nom, row) => twinAddLabel(
            new THREE.Vector3(sl.gridX0 - sl.stepX / 2 - 0.15, 0.03, sl.gridZ0 + row * sl.stepZ),
            escapeHtml(nom), 'twin-label--tag twin-label--right', { far: 30 }));
        model.grid.cols.forEach((nom, col) => twinAddLabel(
            new THREE.Vector3(sl.gridX0 + col * sl.stepX, 0.03, sl.gridZ0 + (sl.rows - 0.5) * sl.stepZ + 0.2),
            escapeHtml(nom), 'twin-label--tag', { far: 30 }));
    }
    model.items.forEach(item => {
        const obj = Twin.objects.get(item.id);
        if (!obj) return;
        let badge = null;
        if ((item.kind === 'cuve' || item.kind === 'casserole') && item.status === 'planned') badge = [`${twinFmtLitres(item.litres)}`, 'info'];
        else if (item.status === 'expired') badge = ['Expiré', 'danger'];
        else if (item.status === 'invendable') badge = ['Invendable', 'danger'];
        else if (item.status === 'rupture') badge = [`−${twinFmtInt(item.manque)}`, 'warning'];
        else if (item.status === 'late') badge = ['Retard', 'danger'];
        else if (item.status === 'urgent') badge = [item.days === 0 ? "Auj." : `J-${item.days}`, 'warning'];
        else if (item.kind === 'bin' && item.state === 'critical') badge = ['Seuil', 'danger'];
        else if (item.kind === 'staff') badge = [item.initiales, item.present ? 'success' : 'muted'];
        if (badge) twinAddLabel(obj.top.clone(), escapeHtml(badge[0]), `twin-label--badge twin-badge--${badge[1]}`, { id: item.id, far: item.kind === 'staff' ? 30 : 60 });
    });
    Twin.needsRender = true;
};

const twinUpdateLabels = () => {
    if (!Twin.labelsEl || !Twin.labels.length) return;
    const w = Twin.labelsEl.clientWidth;
    const h = Twin.labelsEl.clientHeight;
    const v = Twin.tmp;
    const camPos = Twin.camera.position;
    const zoom = camPos.distanceTo(Twin.controls.target);
    // En vue rapprochée, masquer les étiquettes lointaines (les labels HTML ne sont pas occultés par la 3D)
    const reach = zoom < 10 ? zoom * 1.8 + 2 : Infinity;
    Twin.labels.forEach(label => {
        v.copy(label.pos).project(Twin.camera);
        const dist = camPos.distanceTo(label.pos);
        const visible = v.z < 1 && v.x > -1.15 && v.x < 1.15 && v.y > -1.15 && v.y < 1.15
            && dist < Math.min(label.far, reach) && zoom >= label.near;
        if (!visible) {
            if (label.el.style.display !== 'none') label.el.style.display = 'none';
            return;
        }
        if (label.el.style.display === 'none') label.el.style.display = '';
        const x = (v.x * 0.5 + 0.5) * w;
        const y = (-v.y * 0.5 + 0.5) * h;
        label.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    });
};

// --- Interaction : sélection, survol, caméra ---
const twinPick = (clientX, clientY) => {
    if (!Twin.renderer || !Twin.pickables.length) return null;
    const rect = Twin.renderer.domElement.getBoundingClientRect();
    Twin.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    Twin.raycaster.setFromCamera(Twin.ndc, Twin.camera);
    const hit = Twin.raycaster.intersectObjects(Twin.pickables, false)[0];
    return hit ? hit.object.userData.twinId : null;
};

const twinUpdateHover = () => {
    Twin.pointerDirty = false;
    const id = Twin.pointer && !Twin.downAt ? twinPick(Twin.pointer.x, Twin.pointer.y) : null;
    const tooltip = Twin.tooltipEl;
    if (id !== Twin.hoveredId) {
        Twin.hoveredId = id;
        Twin.renderer.domElement.style.cursor = id ? 'pointer' : '';
        twinPositionMarkers();
        Twin.needsRender = true;
    }
    if (!tooltip) return;
    const item = id ? Twin.model?.byId.get(id) : null;
    if (!item || !Twin.pointer) {
        tooltip.hidden = true;
        return;
    }
    const html = `<strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.sub)}</span>`;
    if (tooltip.innerHTML !== html) tooltip.innerHTML = html;
    tooltip.hidden = false;
    const rect = Twin.container.getBoundingClientRect();
    tooltip.style.transform = `translate3d(${Math.round(Twin.pointer.x - rect.left + 14)}px, ${Math.round(Twin.pointer.y - rect.top + 16)}px, 0)`;
};

const twinPositionMarkers = () => {
    if (!Twin.selectRing) return;
    const sel = Twin.selectedId ? Twin.objects.get(Twin.selectedId) : null;
    Twin.selectRing.visible = !!sel;
    Twin.pin.visible = !!sel;
    if (sel) {
        Twin.selectRing.position.set(sel.base.x, sel.base.y + 0.02, sel.base.z);
        Twin.selectRing.scale.set(sel.radius * 1.12, sel.radius * 1.12, 1);
        Twin.pin.position.set(sel.top.x, sel.top.y, sel.top.z);
        Twin.pin.scale.setScalar(twinClamp(sel.radius * 1.4, 0.35, 1));
    }
    const hov = Twin.hoveredId && Twin.hoveredId !== Twin.selectedId ? Twin.objects.get(Twin.hoveredId) : null;
    Twin.hoverRing.visible = !!hov;
    if (hov) {
        Twin.hoverRing.position.set(hov.base.x, hov.base.y + 0.02, hov.base.z);
        Twin.hoverRing.scale.set(hov.radius * 1.12, hov.radius * 1.12, 1);
    }
};

const twinClampTarget = () => {
    const t = Twin.controls?.target;
    if (!t) return;
    t.x = twinClamp(t.x, -13, 20);
    t.z = twinClamp(t.z, -9, 9);
    t.y = twinClamp(t.y, 0, 2.5);
};

const twinAspectView = ({ target, pos }) => {
    const aspect = Twin.camera?.aspect || 1.6;
    const k = aspect < 1.5 ? Math.pow(1.5 / aspect, 0.8) : 1;
    return {
        target,
        pos: pos.map((v, i) => target[i] + (v - target[i]) * k)
    };
};

const twinViewForZone = (zoneId) => {
    const zone = TWIN_ZONES.find(z => z.id === zoneId);
    if (!zone) return twinAspectView(TWIN_VIEW_OVERVIEW);
    const [x0, z0, x1, z1] = zone.bounds;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const d = Math.max(x1 - x0, (z1 - z0) * 1.3) * 0.95 + 1.5;
    return twinAspectView({ target: [cx, 0.5, cz], pos: [cx + d * 0.15, d * 0.8, cz + d * 0.92] });
};

const twinViewForObject = (id) => {
    const obj = Twin.objects.get(id);
    if (!obj) return null;
    const s = twinClamp(obj.radius * 1.1, 0.35, 1.0);
    const target = [obj.base.x, (obj.base.y + obj.top.y) / 2 - 0.1, obj.base.z];
    return twinAspectView({ target, pos: [target[0] + 2.2 * s, target[1] + 8 * s, target[2] + 5.6 * s] });
};

const twinFlyTo = (view, duration = 850) => {
    if (!view || !Twin.camera) return;
    const { THREE } = Twin.lib;
    const toPos = new THREE.Vector3(...view.pos);
    const toTarget = new THREE.Vector3(...view.target);
    if (twinReducedMotion() || duration <= 0) {
        Twin.tween = null;
        Twin.camera.position.copy(toPos);
        Twin.controls.target.copy(toTarget);
        Twin.controls.update();
        twinWake();
        return;
    }
    Twin.tween = {
        fromPos: Twin.camera.position.clone(),
        fromTarget: Twin.controls.target.clone(),
        toPos, toTarget,
        start: performance.now(),
        duration
    };
    twinWake();
};

const twinSetActiveZone = (zoneId) => {
    Twin.focusZone = TWIN_ZONES.some(z => z.id === zoneId) ? zoneId : 'overview';
    DB.setFilter('twin_zone', Twin.focusZone);
    document.querySelectorAll('.twin-zone-btn').forEach(btn => {
        const active = btn.getAttribute('data-zone') === Twin.focusZone;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', String(active));
    });
};

const twinFocusZone = (zoneId, { instant = false } = {}) => {
    twinSetActiveZone(zoneId);
    if (Twin.camera) twinFlyTo(twinViewForZone(Twin.focusZone), instant ? 0 : 850);
};

const twinSelect = (id, { fly = false, focusInspector = false } = {}) => {
    const next = id && Twin.model?.byId.has(id) ? id : null;
    Twin.selectedId = next;
    twinPositionMarkers();
    if (next && fly) twinSetActiveZone(Twin.model.byId.get(next).zone);
    if (next && fly && Twin.camera) twinFlyTo(twinViewForObject(next));
    twinRenderInspector({ focus: focusInspector });
    twinRenderPanel();
    twinWake();
};

const twinCycle = (dir) => {
    const model = Twin.model;
    if (!model) return;
    const current = Twin.selectedId ? model.byId.get(Twin.selectedId) : null;
    const zone = current?.zone || (Twin.focusZone !== 'overview' ? Twin.focusZone : 'production');
    const list = model.items.filter(i => i.zone === zone);
    if (!list.length) return;
    const idx = current ? list.findIndex(i => i.id === current.id) : -1;
    const next = list[(idx + dir + list.length) % list.length];
    twinSelect(next.id, { fly: true });
};

// --- Boucle de rendu (à la demande : s'arrête quand rien ne bouge) ---
const twinWake = () => {
    Twin.needsRender = true;
    if (!Twin.raf && Twin.container?.isConnected && Twin.renderer) {
        Twin.raf = requestAnimationFrame(twinFrame);
    }
};

const twinEase = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

const twinAnimate = (now) => {
    let active = false;
    if (Twin.tween) {
        const tw = Twin.tween;
        const k = Math.min(1, (now - tw.start) / tw.duration);
        const e = twinEase(k);
        Twin.camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
        Twin.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
        Twin.camera.lookAt(Twin.controls.target);
        if (k >= 1) Twin.tween = null;
        active = true;
    }
    if (Twin.fills.length) {
        Twin.fills = Twin.fills.filter(f => {
            const k = Math.min(1, (now - f.start) / 1100);
            twinSetLiquid(f.mesh, f.base, f.radius, Math.max(0.01, (f.from + (f.to - f.from) * twinEase(k)) * f.maxH));
            return k < 1;
        });
        active = true;
    }
    if (Twin.flashes.length) {
        Twin.flashes = Twin.flashes.filter(f => {
            const k = Math.min(1, (now - f.start) / 1400);
            const s = f.radius * (1 + k * 1.6);
            f.mesh.scale.set(s, s, 1);
            f.mesh.material.opacity = 0.9 * (1 - k);
            if (k >= 1) {
                Twin.markers.remove(f.mesh);
                f.mesh.material.dispose();
                return false;
            }
            return true;
        });
        active = true;
    }
    if (twinViewOffsetPending()) {
        const vo = Twin.viewOffset;
        const vt = Twin.viewOffsetTarget;
        const k = twinReducedMotion() ? 1 : 0.2;
        vo.x += (vt.x - vo.x) * k;
        vo.y += (vt.y - vo.y) * k;
        twinApplyViewOffset();
        active = true;
    }
    if (twinReducedMotion()) return active;
    if (Twin.pulsing) {
        const k = (Math.sin(now / 320) + 1) / 2;
        Twin.pulseMats.forEach(mat => {
            if (mat.emissiveIntensity !== undefined && mat.emissive) mat.emissiveIntensity = 0.3 + 1.1 * k;
            else mat.opacity = 0.35 + 0.6 * k;
        });
        active = true;
    }
    if (Twin.glowing) {
        twinMaterials().inductionOn.emissiveIntensity = 0.75 + 0.35 * Math.sin(now / 700);
        active = true;
    }
    if (Twin.bobbers.length) {
        Twin.bobbers.forEach(b => { b.mesh.position.y = Math.sin(now / 520 + b.phase) * 0.035; });
        active = true;
    }
    if (Twin.pin?.visible) {
        Twin.pin.position.y = (Twin.objects.get(Twin.selectedId)?.top.y || 0) + Math.sin(now / 380) * 0.08 * Twin.pin.scale.y;
        active = true;
    }
    return active;
};

const twinFrame = (now) => {
    Twin.raf = 0;
    if (!Twin.container || !Twin.container.isConnected) {
        twinSuspend();
        return;
    }
    const moved = Twin.tween ? false : Twin.controls.update();
    const smooth = moved || twinViewOffsetPending() || !!(Twin.tween || Twin.fills.length || Twin.flashes.length || Twin.controls.autoRotate);
    // Animations d'ambiance (pulsations, personnages) limitées à ~30 i/s pour la batterie
    if (!smooth && !Twin.needsRender && !Twin.pointerDirty && now - (Twin.lastFrame || 0) < 33) {
        Twin.raf = requestAnimationFrame(twinFrame);
        return;
    }
    const active = twinAnimate(now) || smooth;
    if (Twin.pointerDirty) twinUpdateHover();
    Twin.lastFrame = now;
    Twin.renderer.render(Twin.scene, Twin.camera);
    twinUpdateLabels();
    Twin.needsRender = false;
    if (active) Twin.raf = requestAnimationFrame(twinFrame);
};

const twinSuspend = () => {
    if (Twin.raf) cancelAnimationFrame(Twin.raf);
    Twin.raf = 0;
    Twin.resizeObserver?.disconnect();
    Twin.container = null;
    Twin.labelsEl = null;
    Twin.tooltipEl = null;
    Twin.hoveredId = null;
    Twin.tween = null;
    if (Twin.controls) Twin.controls.autoRotate = false;
};

const twinResize = () => {
    const stage = Twin.container?.querySelector('.twin-stage');
    if (!stage || !Twin.renderer) return;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    Twin.size = { w, h };
    Twin.renderer.setSize(w, h, false);
    Twin.camera.aspect = w / h;
    twinRefreshViewOffset({ instant: true });
    twinWake();
};

// Recentre la projection sur la zone libre (entre panneau, inspecteur et indicateurs)
const twinViewOffsetPending = () => Math.abs(Twin.viewOffset.x - Twin.viewOffsetTarget.x) > 0.5
    || Math.abs(Twin.viewOffset.y - Twin.viewOffsetTarget.y) > 0.5;

const twinApplyViewOffset = () => {
    const { w, h } = Twin.size || {};
    if (!w || !h || !Twin.camera) return;
    Twin.camera.setViewOffset(w, h, Twin.viewOffset.x, Twin.viewOffset.y, w, h);
};

const twinRefreshViewOffset = ({ instant = false } = {}) => {
    const root = Twin.container;
    if (!root || !Twin.camera) return;
    const box = root.getBoundingClientRect();
    const mobile = !!window.matchMedia?.('(max-width: 768px)').matches;
    const panel = root.querySelector('.twin-panel');
    const insp = root.querySelector('.twin-inspector');
    const kpis = root.querySelector('.twin-kpis');
    const toolbar = root.querySelector('.twin-toolbar');
    let left = 0;
    let right = 0;
    let top = toolbar ? toolbar.getBoundingClientRect().bottom - box.top : 0;
    let bottom = kpis ? box.bottom - kpis.getBoundingClientRect().top : 0;
    if (!mobile && panel && panel.offsetParent !== null) left = panel.getBoundingClientRect().right - box.left;
    if (insp && !insp.hidden) {
        if (mobile) bottom = Math.max(bottom, box.bottom - insp.getBoundingClientRect().top);
        else right = box.right - insp.getBoundingClientRect().left;
    }
    top = Math.max(0, top);
    Twin.viewOffsetTarget = { x: Math.round((right - left) / 2), y: Math.round((bottom - top) / 2) };
    if (instant) {
        Twin.viewOffset = { ...Twin.viewOffsetTarget };
        twinApplyViewOffset();
    }
    twinWake();
};

const twinMount = (root) => {
    if (!Twin.renderer) twinInitEngine();
    Twin.container = root;
    Twin.labelsEl = root.querySelector('.twin-labels');
    Twin.tooltipEl = root.querySelector('.twin-tooltip');
    root.querySelector('.twin-stage').appendChild(Twin.renderer.domElement);
    Twin.resizeObserver = Twin.resizeObserver || new ResizeObserver(() => twinResize());
    Twin.resizeObserver.observe(root.querySelector('.twin-stage'));
    Twin.controls.autoRotate = false;
    twinResize();
    if (!Twin.viewInitialized) {
        Twin.viewInitialized = true;
        twinFocusZone(DB.getFilter('twin_zone') || 'overview', { instant: true });
    } else {
        twinFocusZone(Twin.focusZone, { instant: true });
    }
    twinWake();
};

const twinApplyModel = (model) => {
    Twin.model = model;
    if (!Twin.renderer || !Twin.container) return;
    twinBuildDynamic(model);
    twinBuildLabels(model);
    if (Twin.selectedId && !model.byId.has(Twin.selectedId)) Twin.selectedId = null;
    if (Twin.hoveredId && !model.byId.has(Twin.hoveredId)) Twin.hoveredId = null;
    twinPositionMarkers();
    twinWake();
};

// --- Interface (HUD) ---
const TWIN_ICONS = {
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/></svg>',
    rotate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>',
    full: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',
    reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 3 3 9 9 9"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>',
    target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><line x1="12" y1="1" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="23"/><line x1="1" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="23" y2="12"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
};

const twinLiveStatus = () => {
    if (!navigator.onLine) return { cls: 'offline', label: 'Hors ligne' };
    if (V11._isReady && Object.keys(V11._listeners || {}).length > 0) return { cls: 'live', label: 'En direct' };
    return { cls: 'local', label: 'Local' };
};

const twinShellHtml = () => {
    const fullscreen = !!document.fullscreenEnabled;
    const panelClosed = DB.getFilter('twin_panel') === 'closed';
    const panelExpanded = !twinCompactLayout() && !panelClosed;
    return `
        <section class="twin ${panelClosed ? 'is-panel-closed' : ''}" id="twinRoot" aria-label="Jumeau numérique de l'atelier">
            <div class="twin-stage" id="twinStage">
                <div class="twin-loading" id="twinLoading"><span class="spinner" aria-hidden="true"></span>Construction de l'atelier 3D…</div>
            </div>
            <div class="twin-labels" aria-hidden="true"></div>
            <div class="twin-tooltip" role="tooltip" hidden></div>
            <div class="twin-toolbar">
                <div class="twin-zones" role="toolbar" aria-label="Zones de l'atelier">
                    <button type="button" class="twin-zone-btn" data-click="twin-zone" data-zone="overview" aria-pressed="false"><kbd>0</kbd>Vue d'ensemble</button>
                    ${TWIN_ZONES.map(z => `<button type="button" class="twin-zone-btn" data-click="twin-zone" data-zone="${z.id}" aria-pressed="false"><span class="twin-zone-dot twin-zone-dot--${z.id}"></span><kbd>${z.key}</kbd>${escapeHtml(z.label)}</button>`).join('')}
                </div>
                <div class="twin-tools">
                    <span class="twin-live" id="twinLive"></span>
                    <button type="button" class="twin-icon-btn twin-panel-toggle" data-click="twin-toggle-panel" aria-controls="twinPanel" aria-expanded="${panelExpanded}" title="Liste et alertes">${TWIN_ICONS.list}</button>
                    <button type="button" class="twin-icon-btn" data-click="twin-zone" data-zone="overview" title="Réinitialiser la vue (R)">${TWIN_ICONS.reset}</button>
                    <button type="button" class="twin-icon-btn" data-click="twin-autorotate" aria-pressed="false" title="Rotation automatique">${TWIN_ICONS.rotate}</button>
                    ${fullscreen ? `<button type="button" class="twin-icon-btn" data-click="twin-fullscreen" title="Plein écran (F)">${TWIN_ICONS.full}</button>` : ''}
                </div>
            </div>
            <aside class="twin-panel" id="twinPanel" aria-label="Alertes et objets de l'atelier"></aside>
            <aside class="twin-inspector" id="twinInspector" aria-label="Détails de l'objet sélectionné" hidden></aside>
            <div class="twin-kpis" id="twinKpis"></div>
            <div class="twin-hint" aria-hidden="true">Glisser : pivoter · Clic droit ou 2 doigts : déplacer · Molette : zoom · Clic : inspecter · ←/→ : objet suivant</div>
        </section>`;
};

const twinRenderKpis = (model) => {
    const el = document.getElementById('twinKpis');
    if (!el) return;
    const k = model.kpis;
    const cards = [
        { zone: 'production', label: 'À produire', value: twinFmtLitres(k.aProduireL), sub: k.aProduireBt ? `${twinFmtInt(k.aProduireBt)} bt · ${k.postesOccupes}/${k.postesTotal} postes${k.enAttente ? ` · ${k.enAttente} en attente` : ''}` : 'Stock suffisant', state: k.aProduireL > 0 ? 'warning' : 'ok' },
        { zone: 'stock', label: 'Stock vendable', value: `${twinFmtInt(k.stockVendable)} bt`, sub: k.lotsExpires ? `${k.lotsExpires} lot${k.lotsExpires > 1 ? 's' : ''} expiré${k.lotsExpires > 1 ? 's' : ''}` : k.lotsInvendables ? `${k.lotsInvendables} invendable${k.lotsInvendables > 1 ? 's' : ''} (DLV)` : k.lotsWarning ? `${k.lotsWarning} DLV proche${k.lotsWarning > 1 ? 's' : ''}` : 'DLV/DLC en ordre', state: (k.lotsExpires || k.lotsInvendables) ? 'danger' : k.lotsWarning ? 'warning' : 'ok' },
        { zone: 'expedition', label: 'Commandes', value: twinFmtInt(k.commandes), sub: k.enRetard ? `${k.enRetard} en retard` : k.urgentes ? `${k.urgentes} urgente${k.urgentes > 1 ? 's' : ''}` : `${k.pretes} prête${k.pretes > 1 ? 's' : ''} à livrer`, state: k.enRetard ? 'danger' : k.urgentes ? 'warning' : 'ok' },
        { zone: 'magasin', label: 'Consommables', value: k.consoCritiques ? `${k.consoCritiques} sous seuil` : 'OK', sub: k.consoBas ? `${k.consoBas} bientôt épuisé${k.consoBas > 1 ? 's' : ''}` : `${k.consoTotal} articles suivis`, state: k.consoCritiques ? 'danger' : k.consoBas ? 'warning' : 'ok' },
        { zone: 'equipe', label: 'Équipe', value: `${k.presents}/${k.effectif}`, sub: 'présents aujourd\'hui', state: 'neutral' }
    ];
    el.innerHTML = cards.map(c => `
        <button type="button" class="twin-kpi twin-kpi--${c.state}" data-click="twin-zone" data-zone="${c.zone}">
            <span class="twin-kpi-label"><span class="twin-zone-dot twin-zone-dot--${c.zone}"></span>${escapeHtml(c.label)}</span>
            <span class="twin-kpi-value">${escapeHtml(c.value)}</span>
            <span class="twin-kpi-sub">${escapeHtml(c.sub)}</span>
        </button>`).join('');
};

const twinRenderLive = (model) => {
    const el = document.getElementById('twinLive');
    if (!el) return;
    const status = twinLiveStatus();
    el.className = `twin-live twin-live--${status.cls}`;
    el.textContent = `${status.label} · ${model.builtAt.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
};

const twinRenderPanel = () => {
    const el = document.getElementById('twinPanel');
    const model = Twin.model;
    if (!el || !model) return;
    const tab = DB.getFilter('twin_tab') || 'alertes';
    const scroll = el.querySelector('.twin-panel-body')?.scrollTop || 0;
    const alertsHtml = model.alerts.length === 0
        ? '<p class="twin-empty">Aucune alerte — l\'atelier est en ordre ✓</p>'
        : model.alerts.map(a => `
            <button type="button" class="twin-alert twin-alert--${a.level} ${a.id === Twin.selectedId ? 'is-selected' : ''}" data-click="twin-select" data-id="${escapeHtml(a.id)}" data-fly="1">
                <span class="twin-alert-dot" aria-hidden="true"></span>
                <span class="twin-alert-text"><strong>${escapeHtml(a.title)}</strong><small>${escapeHtml(a.text)}</small></span>
            </button>`).join('');
    const objectsHtml = TWIN_ZONES.map(zone => {
        const list = model.items.filter(i => i.zone === zone.id);
        return `
            <div class="twin-group">
                <h4 class="twin-group-title"><span class="twin-zone-dot twin-zone-dot--${zone.id}"></span>${escapeHtml(zone.label)}<small>${list.length}</small></h4>
                ${list.length === 0 ? '<p class="twin-empty twin-empty--sm">Vide</p>' : list.map(i => `
                    <button type="button" class="twin-item twin-item--${escapeHtml(i.status || i.state || '')} ${i.id === Twin.selectedId ? 'is-selected' : ''}" data-click="twin-select" data-id="${escapeHtml(i.id)}" data-fly="1" aria-current="${i.id === Twin.selectedId}">
                        <span class="twin-item-swatch" style="background:${safeColor(i.couleur || '')}"></span>
                        <span class="twin-item-label">${escapeHtml(i.label)}</span>
                        <span class="twin-item-meta">${escapeHtml(i.sub)}</span>
                    </button>`).join('')}
            </div>`;
    }).join('');
    el.innerHTML = `
        <div class="twin-tabs" role="tablist" aria-label="Contenu du panneau">
            <button type="button" role="tab" class="twin-tab" aria-selected="${tab === 'alertes'}" data-click="twin-tab" data-tab="alertes">Alertes${model.alerts.length ? ` <span class="twin-count">${model.alerts.length}</span>` : ''}</button>
            <button type="button" role="tab" class="twin-tab" aria-selected="${tab === 'objets'}" data-click="twin-tab" data-tab="objets">Objets <span class="twin-count twin-count--muted">${model.items.length}</span></button>
        </div>
        <div class="twin-panel-body" role="tabpanel">${tab === 'objets' ? objectsHtml : alertsHtml}</div>`;
    const body = el.querySelector('.twin-panel-body');
    if (body) body.scrollTop = scroll;
};

const twinStatusChip = (item) => {
    const map = {
        expired: ['Lots expirés', 'danger'], invendable: ['Lots invendables (DLV)', 'danger'], rupture: ['Stock insuffisant', 'warning'], warning: ['DLV proche', 'warning'], ok: ['En ordre', 'success'],
        late: ['En retard', 'danger'], urgent: ['Urgente', 'warning'], ready: ['Prête à livrer', 'success'], waiting: ['En attente', 'info'],
        planned: ['Planifiée', 'info'], idle: ['Libre', 'default'],
        critical: ['Sous le seuil', 'danger'], low: ['Bientôt épuisé', 'warning'], unknown: ['Sans seuil', 'default'], empty: ['Épuisé', 'danger'],
        present: ['Présent', 'success'], absent: ['Absent', 'default']
    };
    const [label, cls] = map[item.status || item.state] || ['—', 'default'];
    return `<span class="badge badge-${cls}">${escapeHtml(label)}</span>`;
};

const twinInspectorBody = (item) => {
    if (item.kind === 'cuve' || item.kind === 'casserole') {
        const prod = Twin.model?.production;
        const pa = prod?.aromes.find(p => p.arome === item.arome);
        const planned = item.status === 'planned';
        return `
            <div class="twin-insp-hero">
                <div class="twin-gauge" aria-hidden="true"><div class="twin-gauge-fill" style="height:${Math.round(item.fill * 100)}%; background:${safeColor(item.couleur)}"></div></div>
                <div>
                    <div class="twin-insp-big">${planned ? `${escapeHtml(twinFmtLitres(item.litres))} <small>/ ${item.capacite} L</small>` : 'Libre'}</div>
                    <div class="twin-insp-sub">${planned ? `${escapeHtml(item.arome)} · ${Math.round(item.fill * 100)} % de la capacité` : (item.kind === 'cuve' ? 'Cuve vide, couvercle fermé' : 'Plaque à induction éteinte')}</div>
                </div>
            </div>
            ${planned && item.ingredients.length ? `<h4 class="twin-insp-h">Ingrédients pour ce contenant</h4>
                <ul class="twin-rows twin-rows--compact">${item.ingredients.map(i => `<li><span>${escapeHtml(i.nom)}</span><strong>${escapeHtml(String(i.quantite))} ${escapeHtml(displayUnit(i.unite))}</strong></li>`).join('')}</ul>` : ''}
            ${planned && !item.hasRecette ? '<p class="twin-note">Aucune recette définie pour cet arôme (Paramètres › Recettes).</p>' : ''}
            ${pa ? `<h4 class="twin-insp-h">${escapeHtml(pa.arome)} · ${escapeHtml(twinFmtLitres(pa.litres))} au total</h4>
                <ul class="twin-rows">${pa.besoins.map(b => `<li><span>${escapeHtml(b.format)}</span><strong>${twinFmtInt(b.bouteilles)} bt</strong></li>`).join('')}</ul>
                <h4 class="twin-insp-h">Répartition</h4>
                <ul class="twin-rows twin-rows--compact">${pa.recipients.map(r => `<li><span>${escapeHtml(r.poste || 'En attente')}</span><strong>${escapeHtml(twinFmtLitres(r.litres))} / ${r.capacite} L</strong></li>`).join('')}</ul>` : ''}
            ${prod?.enAttente.length ? `<h4 class="twin-insp-h">Prochaine fournée (${prod.enAttente.length})</h4>
                <ul class="twin-rows twin-rows--compact">${prod.enAttente.map(r => `<li><span><span class="twin-item-swatch" style="background:${safeColor(r.couleur)}"></span>${escapeHtml(r.arome)} · ${r.type === 'cuve' ? 'cuve' : 'casserole'} ${r.capacite} L</span><strong>${escapeHtml(twinFmtLitres(r.litres))}</strong></li>`).join('')}</ul>` : ''}
            ${!planned && !prod?.aromes.length ? '<p class="twin-empty">Aucune production requise : le stock couvre les commandes actives.</p>' : ''}
            <div class="twin-insp-actions">
                <a href="#production" class="btn btn-primary btn-sm">Planifier la production</a>
                ${item.arome ? `<button type="button" class="btn btn-secondary btn-sm" data-click="twin-goto-stock" data-arome="${escapeHtml(item.arome)}">Voir le stock</button>` : ''}
            </div>`;
    }
    if (item.kind === 'stack') {
        return `
            <div class="twin-insp-stats">
                <div><span class="twin-stat-val">${twinFmtInt(item.sellable)}</span><span class="twin-stat-lbl">vendables</span></div>
                <div><span class="twin-stat-val">${twinFmtInt(item.total)}</span><span class="twin-stat-lbl">en stock</span></div>
                <div><span class="twin-stat-val">${twinFmtInt(item.demande)}</span><span class="twin-stat-lbl">commandées</span></div>
            </div>
            <h4 class="twin-insp-h">Lots (${item.lots.length})</h4>
            ${item.lots.length === 0 ? `<p class="twin-empty">Aucun lot en stock${item.manque ? ` — il manque ${twinFmtInt(item.manque)} bt pour les commandes` : ''}.</p>` : `
            <ul class="twin-lots">${item.lots.map(l => `
                <li class="twin-lot">
                    <div class="twin-lot-main">
                        <strong>Lot ${escapeHtml(l.numero)}</strong>
                        <span>${twinFmtInt(l.quantite)} bt${l.dlv ? ` · DLV ${escapeHtml(formatDate(l.dlv))}` : ''} · DLC ${l.dlc ? escapeHtml(formatDate(l.dlc)) : '—'}</span>
                    </div>
                    ${l.bloque ? '<span class="badge badge-danger">Bloqué</span>' : ''}
                    <span class="badge badge-${l.status === 'expired' || l.status === 'invendable' ? 'danger' : l.status === 'warning' ? 'warning' : 'success'}">${escapeHtml(getLotStatusLabel(l.status, l))}</span>
                    <div class="twin-lot-actions">
                        <button type="button" class="btn btn-sm btn-primary" data-click="sell-lot" data-id="${escapeHtml(l.id)}" title="Vente directe, dégustation, casse ou destruction">Sortie</button>
                        <button type="button" class="btn btn-sm btn-secondary" data-click="edit-lot" data-id="${escapeHtml(l.id)}">Modifier</button>
                        <button type="button" class="btn btn-sm btn-secondary" data-click="show-lot-trace" data-id="${escapeHtml(l.id)}">Traçabilité</button>
                    </div>
                </li>`).join('')}
            </ul>`}
            <div class="twin-insp-actions">
                <button type="button" class="btn btn-secondary btn-sm" data-click="twin-goto-stock" data-arome="${escapeHtml(item.arome)}" data-format="${escapeHtml(item.format)}">Ouvrir dans Stock</button>
            </div>`;
    }
    if (item.kind === 'order') {
        return `
            <div class="twin-insp-meta">${escapeHtml(item.client)}</div>
            <div class="twin-insp-stats">
                <div><span class="twin-stat-val">${item.dateLivraison ? escapeHtml(formatDate(item.dateLivraison)) : '—'}</span><span class="twin-stat-lbl">${escapeHtml(twinRelativeDay(item.days))}</span></div>
                <div><span class="twin-stat-val">${twinFmtInt(item.totalBt)}</span><span class="twin-stat-lbl">bouteilles</span></div>
                ${item.montant !== null ? `<div><span class="twin-stat-val">${escapeHtml(formatChf(item.montant))}</span><span class="twin-stat-lbl">montant</span></div>` : ''}
            </div>
            ${renderStepTracker(item.statut)}
            <h4 class="twin-insp-h">Articles</h4>
            <ul class="twin-rows">${item.items.map(i => `<li><span><span class="twin-item-swatch" style="background:${safeColor(i.couleur)}"></span>${escapeHtml(i.arome)} · ${escapeHtml(i.format)}</span><strong>${twinFmtInt(i.quantite)}</strong></li>`).join('')}</ul>
            <div class="twin-insp-actions">
                ${item.statut === 'en_attente' ? `<button type="button" class="btn btn-primary btn-sm" data-click="marquer-commande-produite" data-id="${escapeHtml(item.commandeId)}">Marquer produite</button>` : ''}
                ${item.statut === 'produite' ? `<button type="button" class="btn btn-primary btn-sm" data-click="livrer-commande" data-id="${escapeHtml(item.commandeId)}">Livrer</button>` : ''}
                <button type="button" class="btn btn-secondary btn-sm" data-click="show-commande-details" data-id="${escapeHtml(item.commandeId)}">Détails</button>
                <button type="button" class="btn btn-secondary btn-sm" data-click="edit-commande" data-id="${escapeHtml(item.commandeId)}">Modifier</button>
            </div>`;
    }
    if (item.kind === 'bin') {
        const unit = escapeHtml(displayUnit(item.unite));
        return `
            <div class="twin-insp-hero">
                <div class="twin-gauge" aria-hidden="true"><div class="twin-gauge-fill twin-gauge-fill--${escapeHtml(item.state)}" style="height:${Math.round(item.level * 100)}%"></div></div>
                <div>
                    <div class="twin-insp-big">${escapeHtml(String(item.quantite))} <small>${unit}</small></div>
                    <div class="twin-insp-sub">${item.seuil > 0 ? `Seuil d'alerte : ${escapeHtml(String(item.seuil))} ${unit}` : 'Aucun seuil défini'}</div>
                </div>
            </div>
            <div class="twin-stepper" role="group" aria-label="Ajuster la quantité">
                ${[-10, -1, 1, 10].map(d => `<button type="button" class="btn btn-secondary btn-sm" data-click="update-inventaire-qty" data-id="${escapeHtml(item.itemId)}" data-delta="${d}" aria-label="${d > 0 ? 'Ajouter' : 'Retirer'} ${Math.abs(d)}">${d > 0 ? '+' : '−'}${Math.abs(d)}</button>`).join('')}
            </div>
            <div class="twin-insp-actions">
                <button type="button" class="btn btn-secondary btn-sm" data-click="show-inventaire-modal" data-type="consommable" data-id="${escapeHtml(item.itemId)}">Modifier l'article</button>
                <a href="#inventaire" class="btn btn-secondary btn-sm">Inventaire complet</a>
            </div>`;
    }
    if (item.kind === 'staff') {
        return `
            <div class="twin-insp-hero">
                <div class="twin-avatar" style="background:${item.present ? safeColor(item.couleur) : 'var(--text-lighter)'}">${escapeHtml(item.initiales)}</div>
                <div>
                    <div class="twin-insp-big">${item.present ? 'Présent' : 'Absent'}</div>
                    <div class="twin-insp-sub">${item.present ? `Arrivé à ${escapeHtml(item.since)} · ` : ''}${escapeHtml(twinFmtDuration(item.minutes))} aujourd'hui</div>
                </div>
            </div>
            <div class="twin-insp-actions">
                ${item.present
                    ? `<button type="button" class="btn btn-depart btn-sm" data-click="twin-clock-out" data-id="${escapeHtml(item.employeId)}">Pointer le départ</button>`
                    : `<button type="button" class="btn btn-arrivee btn-sm" data-click="twin-clock-in" data-id="${escapeHtml(item.employeId)}">Pointer l'arrivée</button>`}
                <a href="#pointage" class="btn btn-secondary btn-sm">Ouvrir le pointage</a>
            </div>`;
    }
    return '';
};

const twinRenderInspector = ({ focus = false } = {}) => {
    const el = document.getElementById('twinInspector');
    const root = document.getElementById('twinRoot');
    if (!el || !root) return;
    const model = Twin.model;
    const item = Twin.selectedId && model ? model.byId.get(Twin.selectedId) : null;
    if (!item) {
        el.hidden = true;
        el.innerHTML = '';
        root.classList.remove('has-inspector');
        twinRefreshViewOffset();
        return;
    }
    const zone = TWIN_ZONES.find(z => z.id === item.zone);
    const siblings = model.items.filter(i => i.zone === item.zone);
    const pos = siblings.findIndex(i => i.id === item.id) + 1;
    const active = el.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = active ? ['data-click', 'data-id', 'data-delta', 'data-dir']
        .map(a => active.hasAttribute(a) ? `[${a}="${CSS.escape(active.getAttribute(a))}"]` : '').join('') : '';
    const sameItem = el.dataset.itemId === item.id;
    const scroll = sameItem ? el.scrollTop : 0;
    el.dataset.itemId = item.id;
    el.hidden = false;
    root.classList.add('has-inspector');
    el.innerHTML = `
        <div class="twin-insp-head">
            <div class="twin-insp-kicker"><span class="twin-zone-dot twin-zone-dot--${zone.id}"></span>${escapeHtml(zone.label)} · ${pos}/${siblings.length}</div>
            <div class="twin-insp-nav">
                <button type="button" class="twin-icon-btn" data-click="twin-cycle" data-dir="-1" aria-label="Objet précédent" title="Précédent (←)">${TWIN_ICONS.prev}</button>
                <button type="button" class="twin-icon-btn" data-click="twin-cycle" data-dir="1" aria-label="Objet suivant" title="Suivant (→)">${TWIN_ICONS.next}</button>
                <button type="button" class="twin-icon-btn" data-click="twin-center" aria-label="Centrer la vue sur l'objet" title="Centrer">${TWIN_ICONS.target}</button>
                <button type="button" class="twin-icon-btn" data-click="twin-close-inspector" aria-label="Fermer le panneau" title="Fermer (Échap)">${TWIN_ICONS.close}</button>
            </div>
            <h3 class="twin-insp-title" tabindex="-1">${escapeHtml(item.label)}</h3>
            ${twinStatusChip(item)}
        </div>
        <div class="twin-insp-body">${twinInspectorBody(item)}</div>`;
    el.scrollTop = scroll;
    if (focus) el.querySelector('.twin-insp-title')?.focus({ preventScroll: true });
    else if (focusKey) el.querySelector(focusKey)?.focus({ preventScroll: true });
    twinRefreshViewOffset();
};

const twinShowFallback = (root, reason) => {
    root.classList.add('twin--fallback', 'is-panel-open');
    root.classList.remove('is-panel-closed');
    const stage = root.querySelector('.twin-stage');
    if (stage) {
        stage.innerHTML = `<div class="twin-fallback">
            <strong>${reason === 'webgl' ? 'Affichage 3D indisponible sur cet appareil' : "Le moteur 3D n'a pas pu être chargé"}</strong>
            <span>Toutes les données de l'atelier restent accessibles dans la liste ci-contre.</span>
        </div>`;
    }
    if (!DB.getFilter('twin_tab')) DB.setFilter('twin_tab', 'objets');
    twinRenderPanel();
};

const renderJumeau = () => {
    const model = buildTwinModel();
    const existing = document.getElementById('twinRoot');
    if (existing && existing.isConnected) {
        Twin.model = model;
        twinRenderKpis(model);
        twinRenderLive(model);
        if (Twin.container === existing) twinApplyModel(model);
        twinRenderPanel();
        twinRenderInspector();
        return;
    }
    safeRender(twinShellHtml());
    const root = document.getElementById('twinRoot');
    Twin.model = model;
    if (Twin.selectedId && !model.byId.has(Twin.selectedId)) Twin.selectedId = null;
    twinRenderKpis(model);
    twinRenderLive(model);
    twinRenderPanel();
    twinRenderInspector();
    if (!twinIsSupported()) {
        twinShowFallback(root, 'webgl');
        return;
    }
    root.classList.add('is-loading');
    twinLoadLibrary().then(() => {
        if (!root.isConnected) return;
        root.classList.remove('is-loading');
        document.getElementById('twinLoading')?.remove();
        twinMount(root);
        twinApplyModel(Twin.model);
        if (Twin.selectedId) twinFlyTo(twinViewForObject(Twin.selectedId), 0);
        twinRenderInspector();
    }).catch(err => {
        console.error('Jumeau 3D : chargement impossible', err);
        if (root.isConnected) twinShowFallback(root, 'load');
    });
};

const twinToggleFullscreen = () => {
    const root = document.getElementById('twinRoot');
    if (!root || !document.fullscreenEnabled) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else root.requestFullscreen?.().catch(() => showToast('Plein écran indisponible', 'error'));
};

// --- Pointage rapide réutilisable (page Pointage + jumeau 3D) ---
const clockInEmployee = (empId) => {
    if (!empId) {
        showToast('Sélectionne un employé', 'error');
        return false;
    }
    const today = getLocalDateISOString();
    const pointages = DB.get('pointages') || [];
    const enCours = findPointageEnCours(pointages, empId, today);
    if (enCours) {
        showToast(`Pointage déjà en cours pour cet employé (depuis le ${formatDate(enCours.date)} ${enCours.heureDebut || ''})`, 'error');
        return false;
    }
    const now = new Date();
    const heureDebut = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    pointages.push({ id: generateId(), employeId: empId, date: today, heureDebut, heureFin: '', pause: 0 });
    DB.set('pointages', pointages);
    showToast(`Arrivée pointée à ${heureDebut}`);
    return true;
};

const clockOutEmployee = (empId) => {
    if (!empId) {
        showToast('Sélectionne un employé', 'error');
        return false;
    }
    const today = getLocalDateISOString();
    const pointages = DB.get('pointages') || [];
    const enCours = findPointageEnCours(pointages, empId, today);
    if (!enCours) {
        showToast('Aucun pointage en cours pour cet employé', 'error');
        return false;
    }
    const now = new Date();
    enCours.heureFin = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    DB.set('pointages', pointages);
    showToast(`Départ pointé à ${enCours.heureFin}${enCours.date !== today ? ` (pointage du ${formatDate(enCours.date)})` : ''}`);
    return true;
};

CLICK_HANDLERS['twin-zone'] = (el) => twinFocusZone(el.getAttribute('data-zone'));
CLICK_HANDLERS['twin-select'] = (el) => {
    const id = el.getAttribute('data-id');
    const fromList = el.hasAttribute('data-fly');
    twinSelect(id, { fly: true, focusInspector: fromList });
    if (fromList && window.matchMedia?.('(max-width: 768px)').matches) {
        document.getElementById('twinRoot')?.classList.remove('is-panel-open');
    }
};
CLICK_HANDLERS['twin-close-inspector'] = () => twinSelect(null);
CLICK_HANDLERS['twin-cycle'] = (el) => twinCycle(Number(el.getAttribute('data-dir')) || 1);
CLICK_HANDLERS['twin-center'] = () => { if (Twin.selectedId) twinFlyTo(twinViewForObject(Twin.selectedId)); };
CLICK_HANDLERS['twin-tab'] = (el) => {
    DB.setFilter('twin_tab', el.getAttribute('data-tab') || 'alertes');
    twinRenderPanel();
};
const twinCompactLayout = () => !!window.matchMedia?.('(max-width: 1024px)').matches;
CLICK_HANDLERS['twin-toggle-panel'] = (el) => {
    const root = document.getElementById('twinRoot');
    if (!root) return;
    if (twinCompactLayout()) {
        el.setAttribute('aria-expanded', String(root.classList.toggle('is-panel-open')));
    } else {
        const closed = root.classList.toggle('is-panel-closed');
        DB.setFilter('twin_panel', closed ? 'closed' : '');
        el.setAttribute('aria-expanded', String(!closed));
    }
    twinRefreshViewOffset();
};
CLICK_HANDLERS['twin-autorotate'] = (el) => {
    if (!Twin.controls) return;
    Twin.controls.autoRotate = !Twin.controls.autoRotate;
    el.setAttribute('aria-pressed', String(Twin.controls.autoRotate));
    twinWake();
};
CLICK_HANDLERS['twin-fullscreen'] = () => twinToggleFullscreen();
CLICK_HANDLERS['twin-goto-stock'] = (el) => {
    DB.setFilter('stockQuery', '');
    DB.setFilter('stockArome', el.getAttribute('data-arome') || '');
    DB.setFilter('stockFormat', el.getAttribute('data-format') || '');
    DB.setFilter('stockStatut', '');
    window.location.hash = '#stock';
};
CLICK_HANDLERS['twin-clock-in'] = (el) => { if (clockInEmployee(el.getAttribute('data-id'))) renderCurrentView(); };
CLICK_HANDLERS['twin-clock-out'] = (el) => { if (clockOutEmployee(el.getAttribute('data-id'))) renderCurrentView(); };

window.addEventListener('online', () => { if (document.getElementById('twinRoot') && Twin.model) twinRenderLive(Twin.model); });
window.addEventListener('offline', () => { if (document.getElementById('twinRoot') && Twin.model) twinRenderLive(Twin.model); });

// =============================================================================
// Palette de commandes (Ctrl/⌘ + K) et raccourcis clavier (v12.0)
// =============================================================================
const PALETTE_PAGES = [
    { page: 'jumeau', label: 'Jumeau 3D — atelier', keys: 'G J' },
    { page: 'dashboard', label: 'Tableau de bord', keys: 'G D' },
    { page: 'commandes', label: 'Commandes', keys: 'G C' },
    { page: 'production', label: 'Planificateur de production', keys: 'G P' },
    { page: 'stock', label: 'Stock — lots', keys: 'G S' },
    { page: 'historique', label: 'Historique de production' },
    { page: 'livraisons', label: 'Livraisons (BL)', keys: 'G L' },
    { page: 'pointage', label: 'Pointage des heures', keys: 'G H' },
    { page: 'inventaire', label: 'Inventaire', keys: 'G I' },
    { page: 'archives', label: 'Archives des commandes', keys: 'G A' },
    { page: 'parametres', label: 'Paramètres', keys: 'G R' }
];
const GOTO_KEYS = { j: 'jumeau', d: 'dashboard', c: 'commandes', p: 'production', s: 'stock', l: 'livraisons', h: 'pointage', i: 'inventaire', a: 'archives', r: 'parametres' };
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

const Palette = { items: [], index: 0, lastFocus: null };

const paletteNorm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const paletteScore = (text, query) => {
    const tokens = paletteNorm(query).split(/\s+/).filter(Boolean);
    if (!tokens.length) return 1;
    const t = paletteNorm(text);
    let score = 0;
    for (const tok of tokens) {
        const i = t.indexOf(tok);
        if (i < 0) return 0;
        score += i === 0 ? 4 : /[\s·—\-#(]/.test(t[i - 1]) ? 3 : 1;
    }
    return score;
};

const gotoPage = (page) => {
    if (window.location.hash.slice(1).split('?')[0] === page) renderCurrentView();
    else window.location.hash = `#${page}`;
};

const getPaletteEntries = (query) => {
    const entries = [];
    PALETTE_PAGES.forEach(p => entries.push({ group: 'Aller à', label: p.label, keys: p.keys, run: () => gotoPage(p.page) }));
    [
        { label: 'Nouvelle commande', run: () => showCommandeModal() },
        { label: 'Nouveau lot de production', run: () => showNouveauLotModal() },
        { label: 'Ajouter un consommable', run: () => showInventaireModal('consommable') },
        { label: 'Nouveau client', run: () => showClientModal() },
        { label: 'Ajouter une tâche au tableau de bord', run: () => { gotoPage('dashboard'); setTimeout(() => document.getElementById('todoInput')?.focus(), 80); } },
        { label: 'Synchroniser avec le cloud', run: () => window.forceFirebaseSync?.(), hidden: !window.firebaseReady },
        { label: 'Afficher les raccourcis clavier', keys: '?', run: () => showShortcutsHelp() }
    ].filter(a => !a.hidden).forEach(a => entries.push({ group: 'Actions', ...a }));
    TWIN_ZONES.forEach(z => entries.push({
        group: 'Jumeau 3D', label: `Zone ${z.label}`, keys: z.key,
        run: () => { DB.setFilter('twin_zone', z.id); Twin.focusZone = z.id; gotoPage('jumeau'); setTimeout(() => twinFocusZone(z.id), 60); }
    }));
    (DB.get('employees') || []).filter(e => e.actif).forEach(emp => {
        const nom = `${emp.prenom || ''} ${emp.nom || ''}`.trim();
        const today = getLocalDateISOString();
        const present = !!findPointageEnCours(DB.get('pointages') || [], emp.id, today);
        entries.push({
            group: 'Pointage', label: present ? `Pointer le départ — ${nom}` : `Pointer l'arrivée — ${nom}`,
            run: () => { if (present ? clockOutEmployee(emp.id) : clockInEmployee(emp.id)) renderCurrentView(); }
        });
    });

    const q = String(query || '').trim();
    let ranked = entries
        .map((e, order) => ({ ...e, score: paletteScore(`${e.label} ${e.group}`, q), order }))
        .filter(e => e.score > 0);
    if (q) ranked.sort((a, b) => b.score - a.score || a.order - b.order);

    if (q.length >= 2) {
        const twinModel = Twin.model || null;
        if (twinModel) {
            twinModel.items
                .map(i => ({ i, score: paletteScore(`${i.label} ${i.sub}`, q) }))
                .filter(x => x.score > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, 5)
                .forEach(({ i }) => ranked.push({
                    group: 'Dans l\'atelier 3D', label: i.label, meta: i.sub,
                    run: () => { gotoPage('jumeau'); setTimeout(() => twinSelect(i.id, { fly: true, focusInspector: true }), 120); }
                }));
        }
        getGlobalSearchMatches(q).forEach(match => ranked.push({
            group: 'Résultats', label: match.label, meta: match.meta,
            run: () => openGlobalSearchResult(match.type, match.id)
        }));
    }
    if (!q) ranked = ranked.filter(e => e.group !== 'Pointage');
    return ranked.slice(0, 40);
};

const paletteRender = () => {
    const list = document.getElementById('cmdkList');
    const input = document.getElementById('cmdkInput');
    if (!list || !input) return;
    Palette.items = getPaletteEntries(input.value);
    Palette.index = Math.min(Palette.index, Math.max(0, Palette.items.length - 1));
    if (!Palette.items.length) {
        list.innerHTML = '<div class="cmdk-empty">Aucun résultat</div>';
        input.removeAttribute('aria-activedescendant');
        return;
    }
    let lastGroup = null;
    list.innerHTML = Palette.items.map((item, i) => {
        const header = item.group !== lastGroup ? `<div class="cmdk-group" role="presentation">${escapeHtml(item.group)}</div>` : '';
        lastGroup = item.group;
        return `${header}<div class="cmdk-item ${i === Palette.index ? 'is-active' : ''}" role="option" id="cmdk-opt-${i}" data-index="${i}" aria-selected="${i === Palette.index}">
            <span class="cmdk-item-label">${escapeHtml(item.label)}</span>
            ${item.meta ? `<span class="cmdk-item-meta">${escapeHtml(item.meta)}</span>` : ''}
            ${item.keys ? `<span class="cmdk-item-keys">${item.keys.split(' ').map(k => `<kbd>${escapeHtml(k)}</kbd>`).join('')}</span>` : ''}
        </div>`;
    }).join('');
    input.setAttribute('aria-activedescendant', `cmdk-opt-${Palette.index}`);
};

const paletteMove = (delta) => {
    if (!Palette.items.length) return;
    Palette.index = (Palette.index + delta + Palette.items.length) % Palette.items.length;
    const list = document.getElementById('cmdkList');
    list?.querySelectorAll('.cmdk-item').forEach(el => {
        const active = Number(el.getAttribute('data-index')) === Palette.index;
        el.classList.toggle('is-active', active);
        el.setAttribute('aria-selected', String(active));
        if (active) el.scrollIntoView({ block: 'nearest' });
    });
    document.getElementById('cmdkInput')?.setAttribute('aria-activedescendant', `cmdk-opt-${Palette.index}`);
};

const paletteIsOpen = () => !document.getElementById('cmdkOverlay')?.hidden;

const openPalette = (initial = '') => {
    const overlay = document.getElementById('cmdkOverlay');
    const input = document.getElementById('cmdkInput');
    if (!overlay || !input || !window._appStarted) return;
    if (document.getElementById('modalOverlay')?.classList.contains('active')) return;
    closeBottomSheet();
    Palette.lastFocus = document.activeElement;
    Palette.index = 0;
    input.value = initial;
    overlay.hidden = false;
    document.body.classList.add('cmdk-open');
    paletteRender();
    requestAnimationFrame(() => input.focus());
};

const closePalette = ({ restoreFocus = true } = {}) => {
    const overlay = document.getElementById('cmdkOverlay');
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    document.body.classList.remove('cmdk-open');
    if (restoreFocus && Palette.lastFocus?.focus) Palette.lastFocus.focus();
    Palette.lastFocus = null;
};

const paletteRun = (index) => {
    const item = Palette.items[index];
    if (!item) return;
    closePalette({ restoreFocus: false });
    try {
        item.run();
    } catch (e) {
        console.error('Palette : action en échec', e);
        showToast('Action impossible', 'error');
    }
};

const showShortcutsHelp = () => {
    const mod = IS_MAC ? '⌘' : 'Ctrl';
    const rows = [
        [`${mod} K`, 'Ouvrir la palette de commandes'],
        ['/', 'Rechercher (commande, client, BL, lot)'],
        ['?', 'Afficher cette aide'],
        ['G puis J / D / C / P / S', 'Aller au jumeau, tableau de bord, commandes, production, stock'],
        ['G puis L / H / I / A / R', 'Livraisons, pointage, inventaire, archives, paramètres'],
        ['0 – 5', 'Jumeau 3D : vue d\'ensemble ou zone'],
        ['← / →', 'Jumeau 3D : objet précédent / suivant'],
        ['R · F · Échap', 'Jumeau 3D : réinitialiser la vue · plein écran · fermer le panneau']
    ];
    modal.show('Raccourcis clavier', `
        <table class="shortcuts-table">
            <tbody>${rows.map(([k, d]) => `<tr><td>${k.split(' ').map(part => /^(puis|\/|·|–)$/.test(part) ? `<span class="shortcuts-sep">${escapeHtml(part)}</span>` : `<kbd>${escapeHtml(part)}</kbd>`).join(' ')}</td><td>${escapeHtml(d)}</td></tr>`).join('')}</tbody>
        </table>`,
        '<button type="button" class="btn btn-primary" data-click="close-modal">Fermer</button>');
};

const isTypingTarget = (el) => {
    if (!el) return false;
    const tag = (el.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};

let _gotoPending = 0;

const initPaletteAndShortcuts = () => {
    if (window._paletteReady) return;
    window._paletteReady = true;
    const overlay = document.getElementById('cmdkOverlay');
    const input = document.getElementById('cmdkInput');
    const list = document.getElementById('cmdkList');
    document.getElementById('cmdkTrigger')?.addEventListener('click', () => openPalette());
    document.querySelectorAll('.cmdk-trigger-key').forEach(el => { el.textContent = IS_MAC ? '⌘K' : 'Ctrl K'; });
    if (overlay && input && list) {
        overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closePalette(); });
        input.addEventListener('input', () => { Palette.index = 0; paletteRender(); });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); paletteMove(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); paletteMove(-1); }
            else if (e.key === 'Enter') { e.preventDefault(); paletteRun(Palette.index); }
            else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
            else if (e.key === 'Tab') e.preventDefault();
        });
        list.addEventListener('mousemove', (e) => {
            const opt = e.target.closest('.cmdk-item');
            if (!opt) return;
            const idx = Number(opt.getAttribute('data-index'));
            if (idx !== Palette.index) paletteMove(idx - Palette.index);
        });
        list.addEventListener('click', (e) => {
            const opt = e.target.closest('.cmdk-item');
            if (opt) paletteRun(Number(opt.getAttribute('data-index')));
        });
    }

    document.addEventListener('keydown', (e) => {
        if (!window._appStarted || document.body.classList.contains('body--locked') || !e.key) return;
        if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            if (paletteIsOpen()) closePalette();
            else openPalette();
            return;
        }
        if (paletteIsOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
        if (document.getElementById('modalOverlay')?.classList.contains('active')) return;
        if (isTypingTarget(e.target)) return;

        const key = e.key;
        const page = (window.location.hash.slice(1) || 'jumeau').split('?')[0];
        if (_gotoPending && Date.now() - _gotoPending < 1200) {
            _gotoPending = 0;
            const target = GOTO_KEYS[key.toLowerCase()];
            if (target) {
                e.preventDefault();
                gotoPage(target);
            }
            return;
        }
        if (key === 'g' || key === 'G') { _gotoPending = Date.now(); return; }
        if (key === '?') { e.preventDefault(); showShortcutsHelp(); return; }
        if (key === '/') {
            const search = document.getElementById('globalSearchInput');
            if (search && search.offsetParent !== null) { e.preventDefault(); search.focus(); }
            else { e.preventDefault(); openPalette(); }
            return;
        }
        if (page !== 'jumeau' || !document.getElementById('twinRoot')) return;
        if (key === 'Escape') {
            if (Twin.selectedId) { e.preventDefault(); twinSelect(null); }
            return;
        }
        if (/^[0-5]$/.test(key)) {
            e.preventDefault();
            twinFocusZone(key === '0' ? 'overview' : TWIN_ZONES.find(z => z.key === key)?.id);
        } else if (key === 'ArrowRight' || key === 'ArrowLeft') {
            e.preventDefault();
            twinCycle(key === 'ArrowRight' ? 1 : -1);
        } else if (key === 'r' || key === 'R') {
            twinFocusZone('overview');
        } else if (key === 'f' || key === 'F') {
            twinToggleFullscreen();
        }
    });
};


// Toggles de filtres Stock
const toggleStockAromeFilter = (aromeNom) => {
    const current = DB.getFilter('stockArome') || '';
    DB.setFilter('stockArome', current === aromeNom ? '' : aromeNom);
    renderStock();
};
const toggleStockFormatFilter = (formatNom) => {
    const current = DB.getFilter('stockFormat') || '';
    DB.setFilter('stockFormat', current === formatNom ? '' : formatNom);
    renderStock();
};
const toggleStockStatutFilter = (statut) => {
    const current = DB.getFilter('stockStatut') || '';
    DB.setFilter('stockStatut', current === statut ? '' : statut);
    renderStock();
};

// Sous-onglets de la section Stock (Lots / Historique)
const stockSubTabs = (active) => `
    <div class="sub-tabs" role="tablist" aria-label="Vues du stock">
        <a href="#stock" class="sub-tab ${active === 'lots' ? 'active' : ''}" role="tab" aria-selected="${active === 'lots'}">Lots</a>
        <a href="#historique" class="sub-tab ${active === 'historique' ? 'active' : ''}" role="tab" aria-selected="${active === 'historique'}">Historique</a>
    </div>`;

// Stock Management
const renderStock = () => {
    const lots = DB.get('lots') || [];
    const aromes = DB.get('aromes') || [];
    const formats = DB.get('formats') || [];

    const today = new Date();

    const savedQuery  = (DB.getFilter('stockQuery')  || '').toString().toLowerCase().trim();
    const savedArome  = DB.getFilter('stockArome')  || '';
    const savedFormat = DB.getFilter('stockFormat') || '';
    const savedStatut = DB.getFilter('stockStatut') || '';

    const sellableBottles = lots
        .filter(lot => isLotSellable(lot, today))
        .reduce((sum, lot) => sum + (lot.quantite || 0), 0);

    const sellableByAroma = {};
    aromes.filter(a => a.actif).forEach(a => { sellableByAroma[a.nom] = 0; });
    lots.forEach(lot => {
        if (!isLotSellable(lot, today)) return;
        if (sellableByAroma[lot.arome] !== undefined) {
            sellableByAroma[lot.arome] += (lot.quantite || 0);
        }
    });

    const filteredLots = lots.filter(lot => {
        if (savedArome  && lot.arome  !== savedArome)  return false;
        if (savedFormat && lot.format !== savedFormat) return false;
        if (savedStatut === 'bloque') {
            if (!lot.bloque) return false;
        } else if (savedStatut) {
            const st = getLotStatus(lot, today);
            if (st !== savedStatut) return false;
        }
        if (savedQuery) {
            const hay = `${formatLotNumero(getLotNumero(lot))} ${lot.numLot || ''} ${lot.id || ''} ${lot.arome || ''} ${lot.format || ''} ${lot.quantite || ''}`.toLowerCase();
            if (!hay.includes(savedQuery)) return false;
        }
        return true;
    }).sort((a, b) => new Date(b.dateProduction || 0) - new Date(a.dateProduction || 0));

    const tileAromas = aromes.filter(a => a.actif);
    const formatsActifs = formats.filter(f => f.actif);

    const aromaTilesHtml = `
        <a href="#stock" class="aroma-tile aroma-all ${!savedArome ? 'active' : ''}" data-click="toggle-stock-arome-filter" data-value="" data-prevent>
            <div class="aroma-tile-header"><span class="aroma-tile-dot"></span><span class="aroma-tile-name">Tous</span></div>
            <div class="aroma-tile-value">${sellableBottles}</div>
            <div class="aroma-tile-sub">btl vendables</div>
        </a>
        ${tileAromas.map(a => `
            <a href="#stock" class="aroma-tile ${savedArome === a.nom ? 'active' : ''}" data-click="toggle-stock-arome-filter" data-value="${escapeHtml(a.nom)}" data-prevent>
                <div class="aroma-tile-header">
                    <span class="aroma-tile-dot" style="background:${safeColor(a.couleur)}"></span>
                    <span class="aroma-tile-name">${escapeHtml(a.nom)}</span>
                </div>
                <div class="aroma-tile-value">${sellableByAroma[a.nom] || 0}</div>
                <div class="aroma-tile-sub">btl vendables</div>
            </a>
        `).join('')}
    `;

    const fmtPill = (val, label) => `<button type="button" class="status-pill ${savedFormat === val ? 'active' : ''}" data-click="toggle-stock-format-filter" data-value="${escapeHtml(val)}">${escapeHtml(label)}</button>`;
    const statPill = (val, label) => `<button type="button" class="status-pill ${savedStatut === val ? 'active' : ''}" data-click="toggle-stock-statut-filter" data-value="${escapeHtml(val)}">${escapeHtml(label)}</button>`;

    // Traçabilité : retrouver les lots épuisés (disparus du stock) via la recherche
    let archivedLotsHtml = '';
    if (savedQuery) {
        const knownIds = new Set(lots.map(l => String(l.id)));
        const archived = {};
        const addArchived = (src) => {
            const idS = String(src.lotId || '');
            if (!idS || knownIds.has(idS)) return;
            const a = archived[idS] || (archived[idS] = { id: idS, numLot: '', arome: '', format: '', dlc: '', dateProduction: '' });
            if (!a.numLot && src.numLot) a.numLot = src.numLot;
            if (!a.arome && src.arome) a.arome = src.arome;
            if (!a.format && src.format) a.format = src.format;
            if (!a.dlc && src.dlc) a.dlc = src.dlc;
            const prod = src.dateProduction || src.productionDate;
            if (!a.dateProduction && prod) a.dateProduction = prod;
        };
        (DB.get('commandes') || []).forEach(cmd => (cmd.lotsUtilises || []).forEach(addArchived));
        (DB.get('livraisons') || []).forEach(liv => (liv.lotsTraces || []).forEach(addArchived));
        (DB.get('history') || []).forEach(addArchived);
        const matches = Object.values(archived)
            .filter(l => `${formatLotNumero(l.numLot || l.id)} ${l.numLot} ${l.id} ${l.arome} ${l.format}`.toLowerCase().includes(savedQuery))
            .slice(0, 12);
        if (matches.length > 0) {
            archivedLotsHtml = `
                <h3 style="margin: 16px 0 8px; font-size: 15px;">Lots épuisés (traçabilité)</h3>
                ${matches.map(l => {
                    const arome = aromes.find(a => a.nom === l.arome);
                    return `<div class="lot-card">
                        <div class="lot-card-header">
                            <span class="lot-card-numero">#${escapeHtml(formatLotNumero(l.numLot || l.id))}</span>
                            <span class="badge badge-default">Épuisé</span>
                        </div>
                        <div class="lot-card-aroma">
                            <span class="aroma-tile-dot" style="background:${safeColor(arome?.couleur)}"></span>
                            <span class="lot-card-aroma-name">${escapeHtml(l.arome || '?')}</span>
                            <span class="lot-card-aroma-format">• ${escapeHtml(l.format || '?')}</span>
                        </div>
                        <div class="lot-card-meta">
                            ${l.dateProduction ? `<span>Prod. <strong>${formatDate(l.dateProduction)}</strong></span>` : ''}
                            ${l.dlc ? `<span>DLC <strong>${formatDate(l.dlc)}</strong></span>` : ''}
                        </div>
                        <div class="lot-card-actions">
                            <button class="btn btn-sm btn-ghost" data-click="show-lot-trace" data-id="${escapeHtml(l.id)}">Tracer</button>
                        </div>
                    </div>`;
                }).join('')}
            `;
        }
    }

    const lotCardsHtml = filteredLots.length === 0
        ? '<div class="commande-empty">Aucun lot ne correspond aux filtres</div>'
        : filteredLots.map(lot => {
            const arome = aromes.find(a => a.nom === lot.arome);
            const status = getLotStatus(lot, today);
            const badgeClass = status === 'expired' || status === 'invendable' ? 'badge-expire' : status === 'warning' ? 'badge-bientot' : 'badge-ok';
            const statusLabel = getLotStatusLabel(status, lot);
            return `<div class="lot-card lot-status-${status}${lot.bloque ? ' lot-bloque' : ''}">
                <div class="lot-card-header">
                    <span class="lot-card-numero">#${escapeHtml(formatLotNumero(getLotNumero(lot)))}</span>
                    <span class="lot-card-badges">
                        ${lot.bloque ? `<span class="badge badge-danger" title="${escapeHtml(lot.motifBlocage || '')}">Bloqué</span>` : ''}
                        <span class="badge ${badgeClass}">${statusLabel}</span>
                    </span>
                </div>
                <div class="lot-card-aroma">
                    <span class="aroma-tile-dot" style="background:${safeColor(arome?.couleur)}"></span>
                    <span class="lot-card-aroma-name">${escapeHtml(lot.arome || '?')}</span>
                    <span class="lot-card-aroma-format">• ${escapeHtml(lot.format || '?')}</span>
                </div>
                <div class="lot-card-meta">
                    <span><strong class="lot-card-qty">${escapeHtml(String(lot.quantite))}</strong> bt</span>
                    <span>Prod. <strong>${formatDate(lot.dateProduction)}</strong></span>
                    ${lot.dlv ? `<span>DLV <strong>${formatDate(lot.dlv)}</strong></span>` : ''}
                    <span>DLC <strong>${formatDate(lot.dlc)}</strong></span>
                </div>
                <div class="lot-card-actions">
                    <button class="btn btn-sm btn-success" data-click="sell-lot" data-id="${escapeHtml(lot.id)}" title="Vente directe, dégustation, casse ou destruction">Sortie</button>
                    <button class="btn btn-sm btn-ghost" data-click="show-lot-trace" data-id="${escapeHtml(lot.id)}">Tracer</button>
                    <button class="btn btn-sm btn-ghost" data-click="edit-lot" data-id="${escapeHtml(lot.id)}">Modifier</button>
                    <button class="btn btn-sm btn-ghost" style="color: var(--danger);" data-click="delete-lot" data-id="${escapeHtml(lot.id)}">Supprimer</button>
                </div>
            </div>`;
        }).join('');

    const html = `
        <div class="commandes-toolbar">
            <h1>Stock</h1>
            <button class="btn btn-primary btn-sm" onclick="showNouveauLotModal()">+ Lot</button>
        </div>

        ${stockSubTabs('lots')}

        <div class="stock-search">
            <svg class="stock-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="search"
                   placeholder="Rechercher un lot, arôme, format…"
                   value="${escapeHtml(savedQuery)}"
                   oninput="DB.setFilter('stockQuery', this.value); renderStock(); document.querySelector('.stock-search input')?.focus();">
        </div>

        <div class="aroma-tile-grid">
            ${aromaTilesHtml}
        </div>

        ${formatsActifs.length > 0 ? `
            <div class="stock-pills-row">
                <span class="stock-pills-label">Format :</span>
                <button type="button" class="status-pill ${!savedFormat ? 'active' : ''}" onclick="toggleStockFormatFilter('')">Tous</button>
                ${formatsActifs.map(f => fmtPill(f.nom, f.nom)).join('')}
            </div>
        ` : ''}

        <div class="stock-pills-row">
            <span class="stock-pills-label">Statut :</span>
            <button type="button" class="status-pill ${!savedStatut ? 'active' : ''}" onclick="toggleStockStatutFilter('')">Tous</button>
            ${statPill('ok', 'OK')}
            ${statPill('warning', 'DLV proche')}
            ${statPill('invendable', 'Invendable')}
            ${statPill('expired', 'Expiré')}
            ${(lots.some(l => l.bloque) || savedStatut === 'bloque') ? statPill('bloque', 'Bloqué') : ''}
        </div>

        <div class="commande-section" style="padding: 0; background: transparent; border: none; box-shadow: none;">
            <div class="commande-section-title" style="padding: 0 4px;">Lots récents</div>
            ${lotCardsHtml}
            ${archivedLotsHtml}
        </div>
    `;

    safeRender(html);
};

const showNouveauLotModal = () => {
    const aromes = getActive('aromes');
    const formats = getActive('formats');
    const prodDate = getLocalDateISOString();
    const dates = calculateDates(prodDate);

    modal.show('Nouveau lot de production', `
        <form id="lotForm">
            <div class="form-row">
                <div class="form-group">
                    <label>Arôme</label>
                    <select name="arome" required>
                        ${aromes.length === 0 ? '<option value="">Aucun arôme disponible</option>' :
                          aromes.map(a => `<option value="${escapeHtml(a.nom)}">${escapeHtml(a.nom)}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Format</label>
                    <select name="format" required>
                        ${formats.length === 0 ? '<option value="">Aucun format disponible</option>' :
                          formats.map(f => `<option value="${escapeHtml(f.nom)}">${escapeHtml(f.nom)}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Quantité</label>
                    <input type="number" name="quantite" min="1" value="1" required>
                </div>
                <div class="form-group">
                    <label>Date de production</label>
                    <input type="date" name="dateProduction" value="${prodDate}" onchange="updateLotDates()" required>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>DLV (Date limite de vente)</label>
                    <input type="date" name="dlv" value="${dates.dlv}" required>
                </div>
                <div class="form-group">
                    <label>DLC (Date limite de consommation)</label>
                    <input type="date" name="dlc" value="${dates.dlc}" required>
                </div>
            </div>
        </form>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Annuler</button>
        <button class="btn btn-primary" onclick="saveLot(event)">Créer le lot</button>
    `);
};

const updateLotDates = () => {
    const prodDate = document.querySelector('input[name="dateProduction"]').value;
    if (prodDate) {
        const dates = calculateDates(prodDate);
        document.querySelector('input[name="dlv"]').value = dates.dlv;
        document.querySelector('input[name="dlc"]').value = dates.dlc;
    }
};

// Applique/retire un filtre de l'historique (toggle) puis re-rend la page
const setHistFilter = (name, value) => {
    const key = 'hist' + name;
    const current = DB.getFilter(key) || '';
    DB.setFilter(key, current === value ? '' : value);
    renderHistorique();
};

// Helpers pour le calcul des litres de production
const resolveFormatContenance = (formatName, formats) => {
    if (!formatName) return 0;
    const lower = formatName.toLowerCase().trim();
    // Exact match (case-sensitive then case-insensitive)
    let fmt = formats.find(f => f.nom === formatName);
    if (fmt) { const c = Number(fmt.contenanceCl); if (isFinite(c) && c > 0) return c; }
    fmt = formats.find(f => f.nom.toLowerCase() === lower);
    if (fmt) { const c = Number(fmt.contenanceCl); if (isFinite(c) && c > 0) return c; }
    // No configured format matches — parse the label as a size string
    const cleaned = lower.replace(/\s+/g, '');
    const m = cleaned.match(/^(\d+(?:[.,]\d+)?)(cl|ml|l)$/);
    if (m) {
        const num = parseFloat(m[1].replace(',', '.'));
        if (isFinite(num) && num > 0) {
            if (m[2] === 'cl') return num;
            if (m[2] === 'ml') return num / 10;
            if (m[2] === 'l')  return num * 100;
        }
    }
    return 0;
};

const calcProductionLitres = (quantity, formatName, formats) => {
    const qty = Number(quantity);
    if (!isFinite(qty) || qty <= 0) return 0;
    const cl = resolveFormatContenance(formatName, formats);
    return cl > 0 ? qty * cl / 100 : 0;
};

// Page dédiée : Historique de production (timeline groupée par jour + filtres)
const renderHistorique = () => {
    const history = DB.get('history') || [];
    const aromes  = DB.get('aromes')  || [];
    const formats = DB.get('formats') || [];

    // Cumul production non filtré (pour la carte « litres produits »)
    const totalAllProductionLitres = (() => {
        let sum = 0;
        for (const r of history) {
            if (getHistoryType(r) !== 'prod') continue;
            sum += calcProductionLitres(r.quantity, r.format, formats);
        }
        return sum;
    })();

    const savedQuery  = (DB.getFilter('histQuery') || '').toString().toLowerCase().trim();
    const savedType   = DB.getFilter('histType')   || ''; // '', 'prod', 'vente', 'sortie', 'ajust'
    const savedArome  = DB.getFilter('histArome')  || '';
    const savedFormat = DB.getFilter('histFormat') || '';
    const savedPeriod = DB.getFilter('histPeriod') || ''; // '', '7', '30', '90'

    const aromeColor = {};
    aromes.forEach(a => { aromeColor[a.nom] = a.couleur || '#ccc'; });

    const periodDays = parseInt(savedPeriod, 10);
    const cutoff = !isNaN(periodDays) ? Date.now() - periodDays * 86400000 : null;

    const clients = DB.get('clients') || [];
    const clientNomEntree = (e) => {
        if (!e.clientId && !e.clientNom) return '';
        const client = clients.find(c => c.id === e.clientId);
        return client ? getClientLabel(client) : (e.clientNom || '');
    };

    // Les retours (RESTAURE-) restent hors de la timeline : les livraisons n'y
    // figurent pas non plus. Ils sont visibles dans la traçabilité du lot.
    const entries = history.map(r => {
        const type = getHistoryType(r);
        const delta = getHistoryDelta(r);
        const isVente = type === 'vente';
        const when = r.dateAdded ? new Date(r.dateAdded).getTime()
                   : r.productionDate ? new Date(r.productionDate).getTime() : 0;
        return { ...r, type, delta, isVente, when, clientLabel: clientNomEntree(r) };
    }).filter(e => {
        if (e.type === 'retour') return false;
        if (savedType && e.type !== savedType)       return false;
        if (savedArome  && e.arome  !== savedArome)  return false;
        if (savedFormat && e.format !== savedFormat) return false;
        if (cutoff !== null && e.when < cutoff)      return false;
        if (savedQuery) {
            const hay = `${formatLotNumero(e.numLot || e.lotId)} ${e.numLot || ''} ${e.lotId || ''} ${e.arome || ''} ${e.format || ''} ${e.quantity || ''} ${SORTIE_MOTIFS[e.motif] || ''} ${e.clientLabel} ${e.note || ''}`.toLowerCase();
            if (!hay.includes(savedQuery)) return false;
        }
        return true;
    }).sort((a, b) => b.when - a.when);

    const totalVente = entries.filter(e =>  e.isVente).reduce((s, e) => s + (e.quantity || 0), 0);

    const typeLabel = (e) => {
        if (e.type === 'vente')  return 'Vente directe';
        if (e.type === 'sortie') return SORTIE_MOTIFS[e.motif] || 'Sortie';
        if (e.type === 'ajust')  return 'Ajustement';
        return 'Production';
    };

    // Regroupement par jour (entrées déjà triées du plus récent au plus ancien)
    const dayKeys = [];
    const byDay = {};
    entries.forEach(e => {
        const key = e.when ? toLocalDayKey(e.when) : 'na';
        if (!byDay[key]) { byDay[key] = []; dayKeys.push(key); }
        byDay[key].push(e);
    });

    const todayKey = getLocalDateISOString();
    const yesterdayKey = (() => {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        return d.toISOString().slice(0, 10);
    })();
    const dayLabel = (key) => {
        if (key === todayKey) return "Aujourd'hui";
        if (key === yesterdayKey) return 'Hier';
        if (key === 'na') return 'Date inconnue';
        const lbl = dateOnly(key).toLocaleDateString('fr-CH', { weekday: 'long', day: 'numeric', month: 'long' });
        return lbl.charAt(0).toUpperCase() + lbl.slice(1);
    };

    const typePill   = (val, label) => `<button type="button" class="status-pill ${savedType   === val ? 'active' : ''}" data-click="set-hist-filter" data-key="Type" data-value="${escapeHtml(val)}">${label}</button>`;
    const aromePill  = (val)        => `<button type="button" class="status-pill ${savedArome  === val ? 'active' : ''}" data-click="set-hist-filter" data-key="Arome" data-value="${escapeHtml(val)}">${escapeHtml(val)}</button>`;
    const formatPill = (val)        => `<button type="button" class="status-pill ${savedFormat === val ? 'active' : ''}" data-click="set-hist-filter" data-key="Format" data-value="${escapeHtml(val)}">${escapeHtml(val)}</button>`;
    const periodPill = (val, label) => `<button type="button" class="status-pill ${savedPeriod === val ? 'active' : ''}" data-click="set-hist-filter" data-key="Period" data-value="${escapeHtml(val)}">${label}</button>`;

    const aromesActifs  = aromes.filter(a => a.actif);
    const formatsActifs = formats.filter(f => f.actif);

    const listHtml = entries.length === 0
        ? `<div class="commande-empty">${history.length === 0 ? "Aucun mouvement de production pour l'instant." : 'Aucun mouvement ne correspond aux filtres.'}</div>`
        : dayKeys.map(key => {
            const dayEntries = byDay[key];
            const dPlus  = dayEntries.filter(e => e.delta > 0).reduce((s, e) => s + e.delta, 0);
            const dMoins = dayEntries.filter(e => e.delta < 0).reduce((s, e) => s - e.delta, 0);
            const meta = [dPlus ? `+${dPlus}` : '', dMoins ? `−${dMoins}` : ''].filter(Boolean).join('  ·  ');
            return `
            <div class="hist-day">
                <div class="hist-day-head">
                    <span class="hist-day-label">${dayLabel(key)}</span>
                    <span class="hist-day-meta">${meta}</span>
                </div>
                <div class="hist-day-list">
                    ${dayEntries.map(e => {
                        const lotNum = e.lotId ? '#' + escapeHtml(formatLotNumero(e.numLot || e.lotId)) : 'Lot ?';
                        const color = safeColor(aromeColor[e.arome]);
                        const notes = [
                            e.type !== 'prod' && e.productionDate ? `prod. ${formatDate(e.productionDate)}` : '',
                            e.clientLabel ? escapeHtml(e.clientLabel) : '',
                            e.note ? escapeHtml(e.note) : ''
                        ].filter(Boolean);
                        return `
                        <div class="hist-entry is-${e.type}">
                            <span class="hist-entry-dot" style="background:${color}"></span>
                            <div class="hist-entry-main">
                                <div class="hist-entry-title">${escapeHtml(e.arome || '?')} <span class="hist-entry-format">${escapeHtml(e.format || '')}</span></div>
                                <div class="hist-entry-sub">
                                    <span class="hist-entry-tag tag-${e.type}">${escapeHtml(typeLabel(e))}</span>
                                    <button type="button" class="hist-entry-lot" data-click="show-lot-trace" data-id="${escapeHtml(String(e.lotId))}">${lotNum}</button>
                                    ${notes.map(n => `<span class="hist-entry-note">${n}</span>`).join('')}
                                </div>
                            </div>
                            <div class="hist-entry-qty ${e.delta < 0 ? 'neg' : 'pos'}">${e.delta < 0 ? '−' : '+'}${Math.abs(e.delta)}</div>
                            <button type="button" class="hist-entry-del" title="Supprimer" aria-label="Supprimer cet enregistrement" data-click="delete-hist-record" data-id="${escapeHtml(e.id)}">✕</button>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }).join('');

    const html = `
        <div class="commandes-toolbar">
            <h1>Historique</h1>
            <button class="btn btn-primary btn-sm" onclick="showNouveauLotModal()">+ Lot</button>
        </div>

        ${stockSubTabs('historique')}

        <div class="hist-summary">
            <button type="button" class="hist-summary-stat hist-summary-stat-btn" onclick="showProductionStatsModal()" aria-label="Voir les statistiques de production">
                <span class="hist-summary-val pos">${totalAllProductionLitres.toLocaleString('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 0 })} L</span>
                <span class="hist-summary-lbl">litres produits</span>
            </button>
            <div class="hist-summary-stat">
                <span class="hist-summary-val neg">${totalVente}</span>
                <span class="hist-summary-lbl">vendues (directes)</span>
            </div>
            <div class="hist-summary-stat">
                <span class="hist-summary-val">${entries.length}</span>
                <span class="hist-summary-lbl">mouvement${entries.length !== 1 ? 's' : ''}</span>
            </div>
        </div>

        <div class="stock-search" id="histSearch">
            <svg class="stock-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="search"
                   placeholder="Rechercher un lot, arôme, format…"
                   value="${escapeHtml(savedQuery)}"
                   oninput="DB.setFilter('histQuery', this.value); renderHistorique(); document.querySelector('#histSearch input')?.focus();">
        </div>

        <div class="stock-pills-row">
            <span class="stock-pills-label">Type :</span>
            <button type="button" class="status-pill ${!savedType ? 'active' : ''}" onclick="setHistFilter('Type', '')">Tout</button>
            ${typePill('prod', 'Production')}
            ${typePill('vente', 'Ventes')}
            ${typePill('sortie', 'Sorties')}
            ${typePill('ajust', 'Ajustements')}
        </div>

        ${aromesActifs.length > 0 ? `
        <div class="stock-pills-row">
            <span class="stock-pills-label">Arôme :</span>
            <button type="button" class="status-pill ${!savedArome ? 'active' : ''}" onclick="setHistFilter('Arome', '')">Tous</button>
            ${aromesActifs.map(a => aromePill(a.nom)).join('')}
        </div>` : ''}

        ${formatsActifs.length > 0 ? `
        <div class="stock-pills-row">
            <span class="stock-pills-label">Format :</span>
            <button type="button" class="status-pill ${!savedFormat ? 'active' : ''}" onclick="setHistFilter('Format', '')">Tous</button>
            ${formatsActifs.map(f => formatPill(f.nom)).join('')}
        </div>` : ''}

        <div class="stock-pills-row">
            <span class="stock-pills-label">Période :</span>
            <button type="button" class="status-pill ${!savedPeriod ? 'active' : ''}" onclick="setHistFilter('Period', '')">Tout</button>
            ${periodPill('7', '7 jours')}
            ${periodPill('30', '30 jours')}
            ${periodPill('90', '90 jours')}
        </div>

        <div class="hist-timeline">
            ${listHtml}
        </div>
    `;

    safeRender(html);
};

const showProductionStatsModal = () => {
    const history = DB.get('history') || [];
    const aromes  = DB.get('aromes')  || [];
    const formats = DB.get('formats') || [];

    // Production entries only (exclure ventes, sorties, ajustements et retours)
    const prodEntries = history.filter(r => getHistoryType(r) === 'prod');

    // Normaliser chaque quantity une seule fois : Number + Number.isFinite + strictement positif
    const validEntries = [];
    for (const e of prodEntries) {
        const n = Number(e.quantity);
        const q = Number.isFinite(n) && n > 0 ? n : 0;
        if (q > 0) validEntries.push({ ...e, _q: q });
    }

    const totalBottles = validEntries.reduce((s, e) => s + e._q, 0);
    const totalLitres  = validEntries.reduce((s, e) => s + calcProductionLitres(e._q, e.format, formats), 0);
    const totalMvt     = validEntries.length;

    const fmtL = (v) => v.toLocaleString('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 0 });

    // Aggregations
    const byArome  = {};
    const byFormat = {};
    const cross    = {};

    validEntries.forEach(e => {
        const a = e.arome || 'Inconnu';
        const f = e.format || 'Inconnu';
        const q = e._q;
        const l = calcProductionLitres(q, e.format, formats);

        if (!byArome[a])  byArome[a]  = { bottles: 0, litres: 0 };
        byArome[a].bottles  += q;
        byArome[a].litres   += l;

        if (!byFormat[f]) byFormat[f] = { bottles: 0, litres: 0 };
        byFormat[f].bottles += q;
        byFormat[f].litres  += l;

        const key = a + '\x00' + f;
        if (!cross[key]) cross[key] = { arome: a, format: f, bottles: 0, litres: 0 };
        cross[key].bottles += q;
        cross[key].litres  += l;
    });

    const makeRows = (map, cols) => {
        const keys = Object.keys(map);
        if (keys.length === 0) {
            return `<tr><td colspan="${cols}" class="text-center text-muted" style="padding:16px;">Aucune donnée</td></tr>`;
        }
        return keys.sort((a, b) => a.localeCompare(b)).map(k => {
            const d = map[k];
            if ('arome' in d && 'format' in d) {
                // cross row has arome+format keys
                return `<tr><td>${escapeHtml(d.arome)}</td><td>${escapeHtml(d.format)}</td><td>${d.bottles}</td><td>${fmtL(d.litres)} L</td></tr>`;
            }
            return `<tr><td>${escapeHtml(k)}</td><td>${d.bottles}</td><td>${fmtL(d.litres)} L</td></tr>`;
        }).join('');
    };

    const aromeRows  = makeRows(byArome, 3);
    const formatRows = makeRows(byFormat, 3);
    const crossRows  = makeRows(cross, 4);

    const body = `
        <div class="prod-stats-dashboard">
            <div class="prod-stats-kpis">
                <div class="prod-stats-kpi"><span class="prod-stats-kpi-val">${fmtL(totalLitres)} L</span><span class="prod-stats-kpi-lbl">Litres produits</span></div>
                <div class="prod-stats-kpi"><span class="prod-stats-kpi-val">${totalBottles}</span><span class="prod-stats-kpi-lbl">Bouteilles produites</span></div>
                <div class="prod-stats-kpi"><span class="prod-stats-kpi-val">${totalMvt}</span><span class="prod-stats-kpi-lbl">Mouvements</span></div>
            </div>

            <h4 class="prod-stats-title">Par arôme</h4>
            <div class="table-container">
                <table>
                    <thead><tr><th>Arôme</th><th>Bouteilles</th><th>Litres</th></tr></thead>
                    <tbody>${aromeRows}</tbody>
                </table>
            </div>

            <h4 class="prod-stats-title">Par format / taille</h4>
            <div class="table-container">
                <table>
                    <thead><tr><th>Format</th><th>Bouteilles</th><th>Litres</th></tr></thead>
                    <tbody>${formatRows}</tbody>
                </table>
            </div>

            <h4 class="prod-stats-title">Par arôme et format</h4>
            <div class="table-container">
                <table>
                    <thead><tr><th>Arôme</th><th>Format</th><th>Bouteilles</th><th>Litres</th></tr></thead>
                    <tbody>${crossRows}</tbody>
                </table>
            </div>
        </div>
    `;

    modal.show('Statistiques de production cumulées', body, '', 'large');
};

const deleteHistoryRecord = (recordId) => {
    confirmDialog('Supprimer cet enregistrement ?', { danger: true }).then(ok => {
        if (!ok) return;
        const history = DB.get('history') || [];
        const index = history.findIndex(r => r.id === recordId);
        if (index !== -1) {
            history.splice(index, 1);
            DB.set('history', history);
            showToast('Enregistrement supprimé');
            renderCurrentView();
        }
    });
};

const saveLot = (event) => {
    const reenable = disableSaveBtn(event);
    try {
        const form = document.getElementById('lotForm');
        if (!form) return;
        const formData = new FormData(form);

        const arome = formData.get('arome');
        const format = formData.get('format');
        const quantite = Number(formData.get('quantite'));
        const dateProduction = formData.get('dateProduction');
        // let : remplacées par les dates du lot de référence si le numéro est partagé
        let dlv = formData.get('dlv');
        let dlc = formData.get('dlc');

        if (!arome || !format || !Number.isInteger(quantite) || quantite <= 0) {
            showToast('Veuillez remplir tous les champs obligatoires', 'error');
            return;
        }
        if (!isLotDateRangeValid(dateProduction, dlv, dlc)) {
            showToast('Les dates du lot sont invalides ou incohérentes', 'error');
            return;
        }

        const lots = DB.get('lots');
        const history = DB.get('history') || [];

        const existingLot = lots.find(l =>
            l.arome === arome &&
            l.format === format &&
            l.dateProduction === dateProduction
        );

        let targetLot, numLot;
        let dateOverridden = false;
        if (existingLot) {
            existingLot.quantite = (existingLot.quantite || 0) + quantite;
            targetLot = existingLot;
        } else {
            const referenceLot = lots.find(l =>
                l.arome === arome &&
                l.dateProduction === dateProduction
            );

            if (referenceLot) {
                numLot = referenceLot.numLot || referenceLot.id;
                if (referenceLot.dlv !== dlv || referenceLot.dlc !== dlc) {
                    dlv = referenceLot.dlv || dlv;
                    dlc = referenceLot.dlc || dlc;
                    dateOverridden = true;
                }
            } else {
                numLot = nextLotNumero(lots, history);
            }

            targetLot = {
                id: generateId(),
                numLot,
                arome,
                format,
                quantite,
                dateProduction,
                dlv,
                dlc
            };
            lots.push(targetLot);
        }

        history.unshift(buildLotHistoryEntry('PROD', targetLot, quantite));

        DB.set('lots', lots);
        DB.set('history', history);

        modal.hide();
        showToast('Lot créé avec succès');
        if (dateOverridden) {
            showToast('Dates du lot existant reprises (DLV/DLC) pour conserver le même numéro de lot', 'warning');
        }
        renderCurrentView();
    } catch (e) {
        console.error('Error saving lot:', e);
        showToast('Erreur lors de la création du lot', 'error');
    } finally {
        if (reenable) reenable();
    }
};

// Suppression d'un lot : les bouteilles restantes sortent du stock avec un motif
// journalisé (SORTIE-, ou AJUST- si le lot avait été créé par erreur).
const deleteLot = (id) => {
    const lot = (DB.get('lots') || []).find(l => l.id === id);
    if (!lot) return;
    const restant = Number(lot.quantite) || 0;
    modal.show('Supprimer le lot', `
        <form id="deleteLotForm">
            <p style="margin: 0 0 12px;">Le lot <strong>#${escapeHtml(formatLotNumero(getLotNumero(lot)))}</strong> (${escapeHtml(lot.arome || '?')} • ${escapeHtml(lot.format || '?')}) contient encore <strong>${escapeHtml(String(restant))} bt</strong>. Pour conserver la traçabilité, indiquez ce que deviennent ces bouteilles.</p>
            <div class="form-group">
                <label for="deleteLotMotif">Motif</label>
                <select id="deleteLotMotif" name="motif" required>
                    <option value="destruction">${escapeHtml(SORTIE_MOTIFS.destruction)}</option>
                    <option value="casse">${escapeHtml(SORTIE_MOTIFS.casse)}</option>
                    <option value="correction">Lot créé par erreur (correction de saisie)</option>
                </select>
            </div>
            <div class="form-group">
                <label for="deleteLotNote">Note (facultatif)</label>
                <input type="text" id="deleteLotNote" name="note" maxlength="200" placeholder="Ex. bouteilles périmées détruites">
            </div>
        </form>
    `, `
        <button class="btn btn-secondary" data-click="close-modal">Annuler</button>
        <button class="btn btn-danger" data-click="confirm-delete-lot" data-id="${escapeHtml(id)}">Supprimer le lot</button>
    `);
};

const confirmDeleteLot = (id) => {
    const form = document.getElementById('deleteLotForm');
    const motif = form?.querySelector('[name="motif"]')?.value || '';
    const note = (form?.querySelector('[name="note"]')?.value || '').trim();
    if (!['destruction', 'casse', 'correction'].includes(motif)) {
        showToast('Veuillez choisir un motif', 'error');
        return;
    }

    const lots = DB.get('lots') || [];
    const index = lots.findIndex(l => l.id === id);
    if (index === -1) {
        modal.hide();
        showToast('Lot introuvable', 'error');
        return;
    }
    const lot = lots[index];
    const restant = Number(lot.quantite) || 0;
    const history = DB.get('history') || [];
    if (restant > 0) {
        const extra = { motif, ...(note ? { note } : {}) };
        history.unshift(motif === 'correction'
            ? buildLotHistoryEntry('AJUST', lot, -restant, extra)
            : buildLotHistoryEntry('SORTIE', lot, restant, extra));
    }
    lots.splice(index, 1);
    DB.set('lots', lots);
    DB.set('history', history);
    modal.hide();
    showToast(restant > 0 ? `Lot supprimé — ${restant} bt journalisée(s) : ${SORTIE_MOTIFS[motif]}` : 'Lot supprimé');
    renderCurrentView();
};

// Sortie de stock d'un lot : vente directe ou autre sortie motivée, avec client
// facultatif (retrouvable en cas de rappel).
const SORTIE_MOTIFS_SAISIE = ['vente', 'echantillon', 'casse', 'destruction'];

const showVendreModal = (lotId) => {
    const lot = (DB.get('lots') || []).find(l => l.id === lotId);
    if (!lot) return;
    const vendable = isLotSellable(lot);
    const motifs = SORTIE_MOTIFS_SAISIE.filter(m => m !== 'vente' || vendable);
    const clients = (DB.get('clients') || [])
        .filter(c => c.actif !== false)
        .sort((a, b) => getClientLabel(a).localeCompare(getClientLabel(b), 'fr'));

    modal.show('Sortie de stock', `
        <form id="vendreForm">
            <p class="text-muted" style="margin: 0 0 12px;">Lot #${escapeHtml(formatLotNumero(getLotNumero(lot)))} — ${escapeHtml(lot.arome || '?')} • ${escapeHtml(lot.format || '?')} — ${escapeHtml(String(lot.quantite))} bt en stock</p>
            ${!vendable ? `<p class="trace-alert">${lot.bloque ? 'Lot bloqué' : 'DLV/DLC dépassée ou absente'} : la vente est impossible, seules les autres sorties sont proposées.</p>` : ''}
            <div class="form-group">
                <label for="sortieMotif">Motif</label>
                <select id="sortieMotif" name="motif">
                    ${motifs.map(m => `<option value="${m}">${escapeHtml(SORTIE_MOTIFS[m])}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label for="sortieQuantite">Quantité</label>
                <input type="number" id="sortieQuantite" name="quantite" min="1" max="${safeNumAttr(lot.quantite)}" step="1" value="1" required>
                <small class="text-muted">Stock disponible: ${escapeHtml(String(lot.quantite))}</small>
            </div>
            <div class="form-group">
                <label for="sortieClient">Client (facultatif)</label>
                <select id="sortieClient" name="clientId">
                    <option value="">— Aucun / inconnu —</option>
                    ${clients.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(getClientLabel(c))}</option>`).join('')}
                </select>
                <small class="text-muted">Permet de retrouver le destinataire en cas de rappel.</small>
            </div>
            <div class="form-group">
                <label for="sortieNote">Note (facultatif)</label>
                <input type="text" id="sortieNote" name="note" maxlength="200" placeholder="Ex. marché du samedi, casse au transport">
            </div>
        </form>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Annuler</button>
        <button class="btn btn-success" data-click="vendre-lot" data-id="${escapeHtml(lotId)}">Enregistrer la sortie</button>
    `);
};

const vendreLot = (lotId) => {
    const lots = DB.get('lots');
    const lotIndex = lots.findIndex(l => l.id === lotId);

    if (lotIndex === -1) {
        showToast('Lot introuvable', 'error');
        return;
    }

    const lot = lots[lotIndex];
    const form = document.getElementById('vendreForm');
    const motif = form?.querySelector('[name="motif"]')?.value || 'vente';
    if (!SORTIE_MOTIFS_SAISIE.includes(motif)) {
        showToast('Motif de sortie invalide', 'error');
        return;
    }

    // Une vente exige un lot vendable (DLV/DLC valides, lot non bloqué)
    if (motif === 'vente' && !isLotSellable(lot)) {
        showToast('Ce lot ne peut plus être vendu (DLV/DLC expirée ou lot bloqué).', 'error');
        return;
    }

    const quantite = Number(form?.querySelector('[name="quantite"]')?.value);
    const stockDisponible = Number(lot.quantite);
    if (!Number.isInteger(quantite) || quantite <= 0 || !Number.isFinite(stockDisponible) || quantite > stockDisponible) {
        showToast('Quantité invalide : saisissez un nombre entier disponible en stock', 'error');
        return;
    }

    const clientId = form?.querySelector('[name="clientId"]')?.value || '';
    const client = clientId ? (DB.get('clients') || []).find(c => c.id === clientId) : null;
    const note = (form?.querySelector('[name="note"]')?.value || '').trim();

    lot.quantite -= quantite;

    // Traçabilité : journaliser la sortie (motif, client et note facultatifs)
    const extra = { motif };
    if (client) {
        extra.clientId = client.id;
        extra.clientNom = getClientLabel(client);
    }
    if (note) extra.note = note;
    const history = DB.get('history') || [];
    history.unshift(buildLotHistoryEntry(motif === 'vente' ? 'VENTE' : 'SORTIE', lot, quantite, extra));

    if (lot.quantite <= 0) {
        lots.splice(lotIndex, 1);
    }

    DB.set('lots', lots);
    DB.set('history', history);
    modal.hide();
    showToast(`${quantite} bouteille(s) sortie(s) du stock — ${SORTIE_MOTIFS[motif]}`);
    renderCurrentView();
};

// --- Traçabilité des bouteilles : parcours complet d'un lot ---
const getLotTraceData = (lotId) => {
    const idStr = String(lotId);
    const lots = DB.get('lots') || [];
    const history = DB.get('history') || [];
    const commandes = DB.get('commandes') || [];
    const clients = DB.get('clients') || [];
    const livraisons = DB.get('livraisons') || [];

    const lot = lots.find(l => String(l.id) === idStr) || null;

    const entries = history.filter(h => String(h.lotId) === idStr);
    const ofType = (type) => entries.filter(h => getHistoryType(h) === type);
    const sumQty = (list) => list.reduce((s, h) => s + (Number(h.quantity) || 0), 0);

    const productions = ofType('prod');
    const ventes = ofType('vente');
    const sorties = ofType('sortie');
    const ajustements = ofType('ajust');
    const retours = ofType('retour');

    const totalProduit = sumQty(productions);
    const totalVenteDirecte = sumQty(ventes);
    const totalSorties = sumQty(sorties);
    const totalAjustements = sumQty(ajustements);
    const totalRetours = sumQty(retours);

    const livraisonsClients = [];
    commandes.forEach(cmd => {
        (cmd.lotsUtilises || []).forEach(lu => {
            if (String(lu.lotId) !== idStr || !(lu.quantite > 0)) return;
            const client = clients.find(c => c.id === cmd.clientId);
            const bl = livraisons.find(l => l.commandeId === cmd.id);
            livraisonsClients.push({
                date: cmd.dateLivraisonEffective || cmd.dateLivraison || '',
                dateEffective: !!cmd.dateLivraisonEffective,
                commandeId: cmd.id,
                commandeNumero: getCommandeNumero(cmd),
                clientId: cmd.clientId || '',
                clientNom: getClientLabelForTrace(client, cmd.clientLivraison),
                clientLivraison: cmd.clientLivraison || null,
                numeroBL: bl?.numeroBL || cmd.numeroBL || '',
                quantite: lu.quantite,
                numLot: lu.numLot || '',
                arome: lu.arome || '',
                format: lu.format || '',
                dateProduction: lu.dateProduction || '',
                dlv: lu.dlv || '',
                dlc: lu.dlc || ''
            });
        });
    });
    livraisonsClients.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    const totalLivre = livraisonsClients.reduce((s, l) => s + l.quantite, 0);

    // Infos de référence : lot en stock, puis production la plus ancienne, puis
    // toute autre trace (les entrées récentes portent DLV/DLC, les livraisons aussi)
    const sources = [lot, ...productions.slice().reverse(), ...livraisonsClients, ...ventes, ...sorties, ...ajustements, ...retours].filter(Boolean);
    const first = (...fields) => {
        for (const s of sources) {
            for (const f of fields) { if (s[f]) return s[f]; }
        }
        return '';
    };

    return {
        lotId: idStr,
        numLot: first('numLot') || idStr,
        lot,
        arome: first('arome'),
        format: first('format'),
        dateProduction: first('dateProduction', 'productionDate'),
        dlv: first('dlv'),
        dlc: first('dlc'),
        enStock: lot ? (Number(lot.quantite) || 0) : 0,
        bloque: !!lot?.bloque,
        motifBlocage: lot?.motifBlocage || '',
        dateBlocage: lot?.dateBlocage || '',
        totalProduit,
        totalLivre,
        totalVenteDirecte,
        totalSorties,
        totalAjustements,
        totalRetours,
        livraisonsClients,
        ventes,
        sorties,
        ajustements,
        retours
    };
};

// Bouteilles non expliquées : produit + ajustements − livré − vendu − sorti − stock.
// Les retours (commandes restaurées) n'entrent pas dans le bilan : la livraison
// annulée a déjà disparu des livraisons et le stock a été re-crédité.
const getLotTraceEcart = (t) => t.totalProduit > 0
    ? t.totalProduit + t.totalAjustements - t.totalLivre - t.totalVenteDirecte - t.totalSorties - t.enStock
    : null;

const formatJourTrace = (value) => {
    if (!value) return '—';
    const s = String(value);
    return s.length > 10 ? new Date(s).toLocaleDateString('fr-CH') : formatDate(s);
};

const showLotTraceModal = (lotId) => {
    const t = getLotTraceData(lotId);
    if (!t.arome && t.livraisonsClients.length === 0 && t.totalProduit === 0) {
        showToast('Aucune donnée de traçabilité pour ce lot', 'error');
        return;
    }

    const ligne = (label, value) => `
        <div class="flex-between" style="padding: 6px 0; border-bottom: 1px solid var(--border-light);">
            <span style="color: var(--text-light);">${escapeHtml(label)}</span>
            <strong>${value}</strong>
        </div>`;

    const ecart = getLotTraceEcart(t);

    const livraisonsHtml = t.livraisonsClients.length === 0
        ? '<p class="text-muted">Aucune livraison client pour ce lot</p>'
        : `<div class="trace-scroll"><table class="details-table">
            <thead>
                <tr><th>Date</th><th>Client</th><th>Cmd</th><th>BL</th><th>Qté</th></tr>
            </thead>
            <tbody>
                ${t.livraisonsClients.map(l => `
                    <tr>
                        <td>${formatJourTrace(l.date)}${l.date && !l.dateEffective ? ' <span class="text-muted">(prévue)</span>' : ''}</td>
                        <td>${escapeHtml(l.clientNom)}</td>
                        <td>#${escapeHtml(String(l.commandeNumero || '—'))}</td>
                        <td>${l.numeroBL ? escapeHtml(String(l.numeroBL)) : '—'}</td>
                        <td><strong>${l.quantite} bt</strong></td>
                    </tr>
                `).join('')}
            </tbody>
        </table></div>`;

    const mouvements = [...t.ventes, ...t.sorties, ...t.ajustements]
        .sort((a, b) => new Date(a.dateAdded || 0) - new Date(b.dateAdded || 0));
    const mouvementLabel = (h) => {
        const type = getHistoryType(h);
        if (type === 'vente') return 'Vente directe';
        if (type === 'ajust') return `Ajustement${h.motif && h.motif !== 'correction' ? ` (${SORTIE_MOTIFS[h.motif] || h.motif})` : ''}`;
        return SORTIE_MOTIFS[h.motif] || 'Sortie';
    };
    const mouvementsHtml = mouvements.length === 0 ? '' : `
        <h4 style="margin-top: 16px;">Ventes directes, sorties et ajustements</h4>
        <div class="trace-scroll"><table class="details-table">
            <thead><tr><th>Date</th><th>Type</th><th>Client / note</th><th>Qté</th></tr></thead>
            <tbody>
                ${mouvements.map(h => {
                    const delta = getHistoryDelta(h);
                    const detail = [h.clientNom, h.note].filter(Boolean).join(' — ');
                    return `<tr>
                        <td>${formatJourTrace(h.dateAdded)}</td>
                        <td>${escapeHtml(mouvementLabel(h))}</td>
                        <td>${detail ? escapeHtml(detail) : '—'}</td>
                        <td><strong>${delta < 0 ? '−' : '+'}${Math.abs(delta)} bt</strong></td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table></div>`;

    const retoursHtml = t.retours.length === 0 ? '' : `
        <h4 style="margin-top: 16px;">Livraisons annulées (commandes restaurées)</h4>
        <div class="trace-scroll"><table class="details-table">
            <thead><tr><th>Annulée le</th><th>Client</th><th>Cmd</th><th>BL</th><th>Qté re-créditée</th></tr></thead>
            <tbody>
                ${t.retours.map(r => `<tr>
                    <td>${formatJourTrace(r.dateAdded)}</td>
                    <td>${r.clientNom ? escapeHtml(r.clientNom) : '—'}</td>
                    <td>${r.commandeNumero ? `#${escapeHtml(String(r.commandeNumero))}` : '—'}</td>
                    <td>${r.numeroBL ? escapeHtml(String(r.numeroBL)) : '—'}</td>
                    <td><strong>${Number(r.quantity) || 0} bt</strong></td>
                </tr>`).join('')}
            </tbody>
        </table></div>`;

    const numLotAffiche = formatLotNumero(t.numLot || t.lotId);

    modal.show(`Traçabilité lot #${numLotAffiche}`, `
        <div class="commande-details">
            ${t.bloque ? `<p class="trace-alert trace-alert-danger"><strong>Lot bloqué</strong>${t.motifBlocage ? ` — ${escapeHtml(t.motifBlocage)}` : ''}${t.dateBlocage ? ` (depuis le ${formatJourTrace(t.dateBlocage)})` : ''}</p>` : ''}
            ${ligne('Arôme / Format', `${escapeHtml(t.arome || '?')} • ${escapeHtml(t.format || '?')}`)}
            ${t.dateProduction ? ligne('Date de production', formatDate(t.dateProduction)) : ''}
            ${t.dlv ? ligne('DLV', formatDate(t.dlv)) : ''}
            ${t.dlc ? ligne('DLC', formatDate(t.dlc)) : ''}
            ${t.totalProduit > 0 ? ligne('Produit', `${t.totalProduit} bt`) : ''}
            ${ligne('Livré aux clients', `${t.totalLivre} bt`)}
            ${t.totalVenteDirecte > 0 ? ligne('Ventes directes', `${t.totalVenteDirecte} bt`) : ''}
            ${t.totalSorties > 0 ? ligne('Autres sorties', `${t.totalSorties} bt`) : ''}
            ${t.totalAjustements !== 0 ? ligne('Ajustements', `${t.totalAjustements > 0 ? '+' : '−'}${Math.abs(t.totalAjustements)} bt`) : ''}
            ${ligne('En stock', t.lot ? `${t.enStock} bt` : '<span class="badge badge-default">Épuisé</span>')}
            ${ecart !== null && ecart !== 0 ? ligne('Écart non expliqué', `${ecart} bt`) : ''}

            <h4 style="margin-top: 16px;">Livraisons clients</h4>
            ${livraisonsHtml}
            ${mouvementsHtml}
            ${retoursHtml}
        </div>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Fermer</button>
        <button class="btn btn-primary" data-click="show-lot-rappel" data-num="${escapeHtml(String(t.numLot || t.lotId))}">Rappel du lot (tous formats)</button>
    `);
};

// --- Rappel de lot : vue consolidée d'un numéro de lot (tous formats) ---
const getLotRappelData = (numLot) => {
    const key = normLotNumero(numLot);
    const lots = DB.get('lots') || [];
    const history = DB.get('history') || [];
    const commandes = DB.get('commandes') || [];
    const livraisons = DB.get('livraisons') || [];
    const clients = DB.get('clients') || [];

    const correspond = (num, id) => !!key && normLotNumero(num || id) === key;
    const ids = new Set();
    lots.forEach(l => { if (correspond(l.numLot, l.id)) ids.add(String(l.id)); });
    history.forEach(h => { if (h.lotId && correspond(h.numLot, h.lotId)) ids.add(String(h.lotId)); });
    commandes.forEach(c => (c.lotsUtilises || []).forEach(lu => { if (lu.lotId && correspond(lu.numLot, lu.lotId)) ids.add(String(lu.lotId)); }));
    livraisons.forEach(l => (l.lotsTraces || []).forEach(t => { if (t.lotId && correspond(t.numLot, t.lotId)) ids.add(String(t.lotId)); }));

    const traces = [...ids].map(id => getLotTraceData(id))
        .sort((a, b) => `${a.arome} ${a.format}`.localeCompare(`${b.arome} ${b.format}`, 'fr'));

    const uniq = (list) => [...new Set(list.filter(Boolean))];
    const sum = (field) => traces.reduce((s, t) => s + (Number(t[field]) || 0), 0);
    const coordonnees = (clientId, snapshot) => {
        const client = clients.find(c => c.id === clientId);
        const src = client || snapshot || {};
        return {
            clientNom: getClientLabelForTrace(client, snapshot),
            adresse: [src.adresse, src.npa].filter(Boolean).join(', '),
            coord: src.coord || ''
        };
    };

    const livraisonsClients = traces
        .flatMap(t => t.livraisonsClients.map(l => ({ ...l, ...coordonnees(l.clientId, l.clientLivraison) })))
        .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    const sorties = traces
        .flatMap(t => [...t.ventes, ...t.sorties, ...t.ajustements])
        .map(h => ({ ...h, type: getHistoryType(h), ...(h.clientId || h.clientNom ? coordonnees(h.clientId, { nom: h.clientNom }) : { clientNom: '', adresse: '', coord: '' }) }))
        .sort((a, b) => new Date(a.dateAdded || 0) - new Date(b.dateAdded || 0));
    const retours = traces.flatMap(t => t.retours)
        .sort((a, b) => new Date(a.dateAdded || 0) - new Date(b.dateAdded || 0));

    const destinataires = uniq([
        ...livraisonsClients.map(l => l.clientId || l.clientNom),
        ...sorties.filter(s => s.clientId || s.clientNom).map(s => s.clientId || s.clientNom)
    ]);

    return {
        numLot: String(numLot ?? ''),
        numLotAffiche: formatLotNumero(numLot),
        traces,
        aromes: uniq(traces.map(t => t.arome)),
        datesProduction: uniq(traces.map(t => t.dateProduction)),
        dlvs: uniq(traces.map(t => t.dlv)),
        dlcs: uniq(traces.map(t => t.dlc)),
        totalProduit: sum('totalProduit'),
        totalLivre: sum('totalLivre'),
        totalVenteDirecte: sum('totalVenteDirecte'),
        totalSorties: sum('totalSorties'),
        totalAjustements: sum('totalAjustements'),
        enStock: sum('enStock'),
        nbDestinataires: destinataires.length,
        livraisonsClients,
        sorties,
        retours,
        lotsEnStock: lots.filter(l => ids.has(String(l.id)))
    };
};

const showLotRappelModal = (numLot) => {
    const r = getLotRappelData(numLot);
    if (r.traces.length === 0) {
        showToast('Aucune donnée de traçabilité pour ce numéro de lot', 'error');
        return;
    }

    const listeDates = (list) => list.length ? list.map(d => formatDate(d)).join(', ') : '—';
    const ambigu = r.aromes.length > 1 || r.datesProduction.length > 1;
    const lotsBloques = r.lotsEnStock.filter(l => l.bloque);
    const lotsLibres = r.lotsEnStock.filter(l => !l.bloque);
    const numAttr = escapeHtml(r.numLot);

    const formatsHtml = `
        <div class="trace-scroll"><table class="details-table">
            <thead><tr><th>Format</th><th>Produit</th><th>Livré</th><th>Ventes / sorties</th><th>Stock</th><th></th></tr></thead>
            <tbody>
                ${r.traces.map(t => `<tr>
                    <td>${escapeHtml(t.format || '?')}${r.aromes.length > 1 ? ` <span class="text-muted">${escapeHtml(t.arome || '')}</span>` : ''}</td>
                    <td>${t.totalProduit}</td>
                    <td>${t.totalLivre}</td>
                    <td>${t.totalVenteDirecte + t.totalSorties}</td>
                    <td>${t.lot ? `${t.enStock}${t.bloque ? ' <span class="badge badge-danger">Bloqué</span>' : ''}` : '<span class="badge badge-default">Épuisé</span>'}</td>
                    <td><button type="button" class="btn btn-sm btn-ghost" data-click="show-lot-trace" data-id="${escapeHtml(t.lotId)}">Détail</button></td>
                </tr>`).join('')}
            </tbody>
        </table></div>`;

    const clientsHtml = r.livraisonsClients.length === 0
        ? '<p class="text-muted">Aucune livraison client pour ce lot</p>'
        : `<div class="trace-scroll"><table class="details-table">
            <thead><tr><th>Date</th><th>Client</th><th>Adresse / contact</th><th>Cmd</th><th>BL</th><th>Format</th><th>Qté</th></tr></thead>
            <tbody>
                ${r.livraisonsClients.map(l => `<tr>
                    <td>${formatJourTrace(l.date)}${l.date && !l.dateEffective ? ' <span class="text-muted">(prévue)</span>' : ''}</td>
                    <td><strong>${escapeHtml(l.clientNom)}</strong></td>
                    <td>${escapeHtml([l.adresse, l.coord].filter(Boolean).join(' — ') || '—')}</td>
                    <td>#${escapeHtml(String(l.commandeNumero || '—'))}</td>
                    <td>${l.numeroBL ? escapeHtml(String(l.numeroBL)) : '—'}</td>
                    <td>${escapeHtml(l.format || '?')}</td>
                    <td><strong>${l.quantite}</strong></td>
                </tr>`).join('')}
            </tbody>
        </table></div>`;

    const sortiesHtml = r.sorties.length === 0 ? '' : `
        <h4 style="margin-top: 16px;">Ventes directes, sorties et ajustements</h4>
        <div class="trace-scroll"><table class="details-table">
            <thead><tr><th>Date</th><th>Motif</th><th>Client</th><th>Format</th><th>Qté</th><th>Note</th></tr></thead>
            <tbody>
                ${r.sorties.map(s => {
                    const delta = getHistoryDelta(s);
                    const motif = s.type === 'vente' ? 'Vente directe' : s.type === 'ajust' ? 'Ajustement' : (SORTIE_MOTIFS[s.motif] || 'Sortie');
                    return `<tr>
                        <td>${formatJourTrace(s.dateAdded)}</td>
                        <td>${escapeHtml(motif)}</td>
                        <td>${s.clientNom ? escapeHtml(s.clientNom) : '<span class="text-muted">inconnu</span>'}</td>
                        <td>${escapeHtml(s.format || '?')}</td>
                        <td><strong>${delta < 0 ? '−' : '+'}${Math.abs(delta)}</strong></td>
                        <td>${s.note ? escapeHtml(s.note) : ''}</td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table></div>`;

    const retoursHtml = r.retours.length === 0 ? '' : `
        <h4 style="margin-top: 16px;">Livraisons annulées (commandes restaurées)</h4>
        <div class="trace-scroll"><table class="details-table">
            <thead><tr><th>Annulée le</th><th>Client</th><th>Cmd</th><th>BL</th><th>Format</th><th>Qté</th></tr></thead>
            <tbody>
                ${r.retours.map(x => `<tr>
                    <td>${formatJourTrace(x.dateAdded)}</td>
                    <td>${x.clientNom ? escapeHtml(x.clientNom) : '—'}</td>
                    <td>${x.commandeNumero ? `#${escapeHtml(String(x.commandeNumero))}` : '—'}</td>
                    <td>${x.numeroBL ? escapeHtml(String(x.numeroBL)) : '—'}</td>
                    <td>${escapeHtml(x.format || '?')}</td>
                    <td>${Number(x.quantity) || 0}</td>
                </tr>`).join('')}
            </tbody>
        </table></div>`;

    const footer = `
        <button class="btn btn-secondary" data-click="close-modal">Fermer</button>
        <button class="btn btn-secondary" data-click="export-lot-rappel" data-num="${numAttr}">Exporter Excel</button>
        ${lotsBloques.length > 0 ? `<button class="btn btn-secondary" data-click="debloquer-lot" data-num="${numAttr}">Débloquer le stock</button>` : ''}
        ${lotsLibres.length > 0 ? `<button class="btn btn-danger" data-click="bloquer-lot" data-num="${numAttr}">Bloquer le stock restant</button>` : ''}
    `;

    modal.show(`Rappel du lot #${r.numLotAffiche}`, `
        <div class="commande-details">
            ${ambigu ? '<p class="trace-alert">Ce numéro est partagé par plusieurs arômes ou dates de production : vérifiez chaque ligne avant d\'agir.</p>' : ''}
            ${lotsBloques.length > 0 ? `<p class="trace-alert trace-alert-danger"><strong>Stock bloqué</strong> (${lotsBloques.reduce((s, l) => s + (Number(l.quantite) || 0), 0)} bt)${lotsBloques[0].motifBlocage ? ` — ${escapeHtml(lotsBloques[0].motifBlocage)}` : ''}</p>` : ''}
            <div class="workflow-summary">
                <div><span>Produit</span><strong>${r.totalProduit} bt</strong></div>
                <div><span>Livré</span><strong>${r.totalLivre} bt</strong></div>
                <div><span>Ventes et sorties</span><strong>${r.totalVenteDirecte + r.totalSorties} bt</strong></div>
                <div><span>En stock</span><strong>${r.enStock} bt</strong></div>
                <div><span>Destinataires connus</span><strong>${r.nbDestinataires}</strong></div>
            </div>
            <p><strong>Arôme :</strong> ${escapeHtml(r.aromes.join(', ') || '?')}</p>
            <p><strong>Production :</strong> ${listeDates(r.datesProduction)} · <strong>DLV :</strong> ${listeDates(r.dlvs)} · <strong>DLC :</strong> ${listeDates(r.dlcs)}</p>

            <h4 style="margin-top: 16px;">Par format</h4>
            ${formatsHtml}

            <h4 style="margin-top: 16px;">Clients livrés</h4>
            ${clientsHtml}
            ${sortiesHtml}
            ${retoursHtml}
        </div>
    `, footer, 'large');
};

const exportLotRappelExcel = (numLot) => {
    if (typeof XLSX === 'undefined') {
        showToast('Erreur: Bibliothèque Excel non chargée', 'error');
        return;
    }
    const r = getLotRappelData(numLot);
    if (r.traces.length === 0) {
        showToast('Aucune donnée de traçabilité pour ce numéro de lot', 'error');
        return;
    }
    const jour = (value) => {
        if (!value) return '';
        const s = String(value);
        return s.length > 10 ? toLocalDayKey(new Date(s).getTime()) : s;
    };
    const feuille = (rows) => XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ Information: 'Aucune donnée' }]);

    const synthese = [
        ['N° de lot', r.numLotAffiche],
        ['Arôme(s)', r.aromes.join(', ')],
        ['Date(s) de production', r.datesProduction.join(', ')],
        ['DLV', r.dlvs.join(', ')],
        ['DLC', r.dlcs.join(', ')],
        ['Produit (bt)', r.totalProduit],
        ['Livré aux clients (bt)', r.totalLivre],
        ['Ventes directes (bt)', r.totalVenteDirecte],
        ['Autres sorties (bt)', r.totalSorties],
        ['Ajustements (bt)', r.totalAjustements],
        ['En stock (bt)', r.enStock],
        ['Stock bloqué (bt)', r.lotsEnStock.filter(l => l.bloque).reduce((s, l) => s + (Number(l.quantite) || 0), 0)],
        ['Destinataires connus', r.nbDestinataires],
        ['Export du', getLocalDateISOString()]
    ].map(([rubrique, valeur]) => ({ Rubrique: rubrique, Valeur: valeur }));

    const parFormat = r.traces.map(t => ({
        'Arôme': t.arome,
        'Format': t.format,
        'Production': t.dateProduction,
        'DLV': t.dlv,
        'DLC': t.dlc,
        'Produit': t.totalProduit,
        'Livré': t.totalLivre,
        'Ventes directes': t.totalVenteDirecte,
        'Autres sorties': t.totalSorties,
        'Ajustements': t.totalAjustements,
        'En stock': t.enStock,
        'Bloqué': t.bloque ? 'Oui' : 'Non'
    }));

    const clientsLivres = r.livraisonsClients.map(l => ({
        'Date': jour(l.date),
        'Date effective': l.dateEffective ? 'Oui' : 'Non (date prévue)',
        'Client': l.clientNom,
        'Adresse': l.adresse,
        'Contact': l.coord,
        'Commande': l.commandeNumero,
        'BL': l.numeroBL,
        'Arôme': l.arome,
        'Format': l.format,
        'Quantité': l.quantite
    }));

    const sorties = r.sorties.map(s => ({
        'Date': jour(s.dateAdded),
        'Type': s.type === 'vente' ? 'Vente directe' : s.type === 'ajust' ? 'Ajustement' : (SORTIE_MOTIFS[s.motif] || 'Sortie'),
        'Client': s.clientNom,
        'Adresse': s.adresse,
        'Contact': s.coord,
        'Arôme': s.arome,
        'Format': s.format,
        'Quantité': getHistoryDelta(s),
        'Note': s.note || ''
    }));

    const annulations = r.retours.map(x => ({
        'Annulée le': jour(x.dateAdded),
        'Client': x.clientNom || '',
        'Commande': x.commandeNumero || '',
        'BL': x.numeroBL || '',
        'Livrée le': jour(x.dateLivraison),
        'Format': x.format,
        'Quantité re-créditée': Number(x.quantity) || 0
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, feuille(synthese), 'Synthèse');
    XLSX.utils.book_append_sheet(wb, feuille(parFormat), 'Par format');
    XLSX.utils.book_append_sheet(wb, feuille(clientsLivres), 'Clients livrés');
    XLSX.utils.book_append_sheet(wb, feuille(sorties), 'Sorties');
    if (annulations.length > 0) XLSX.utils.book_append_sheet(wb, feuille(annulations), 'Annulations');
    XLSX.writeFile(wb, `rappel_lot_${r.numLotAffiche}_${getLocalDateISOString()}.xlsx`);
    showToast('Export Excel du rappel réussi');
};

// Blocage : le stock restant du numéro de lot devient invendable et non livrable
// (isLotSellable + transaction de livraison) jusqu'au déblocage.
const showBloquerLotModal = (numLot) => {
    const r = getLotRappelData(numLot);
    const aBloquer = r.lotsEnStock.filter(l => !l.bloque);
    if (aBloquer.length === 0) {
        showToast('Aucun stock à bloquer pour ce lot', 'warning');
        return;
    }
    const total = aBloquer.reduce((s, l) => s + (Number(l.quantite) || 0), 0);
    const numAttr = escapeHtml(r.numLot);
    modal.show(`Bloquer le lot #${r.numLotAffiche}`, `
        <form id="bloquerLotForm">
            <p style="margin: 0 0 12px;">Le stock restant (<strong>${total} bt</strong> sur ${aBloquer.length} format(s)) ne pourra plus être vendu ni alloué à une livraison jusqu'au déblocage.</p>
            <div class="form-group">
                <label for="motifBlocage">Motif du blocage</label>
                <textarea id="motifBlocage" name="motif" rows="2" maxlength="300" required placeholder="Ex. suspicion qualité, rappel fournisseur"></textarea>
            </div>
        </form>
    `, `
        <button class="btn btn-secondary" data-click="show-lot-rappel" data-num="${numAttr}">Retour</button>
        <button class="btn btn-danger" data-click="confirm-bloquer-lot" data-num="${numAttr}">Bloquer</button>
    `);
};

const confirmBloquerLot = (numLot) => {
    const motif = (document.getElementById('motifBlocage')?.value || '').trim();
    if (!motif) {
        showToast('Le motif du blocage est obligatoire', 'error');
        return;
    }
    const ids = new Set(getLotRappelData(numLot).lotsEnStock.map(l => String(l.id)));
    const lots = DB.get('lots') || [];
    const now = new Date().toISOString();
    let count = 0;
    lots.forEach(l => {
        if (!ids.has(String(l.id)) || l.bloque) return;
        l.bloque = true;
        l.motifBlocage = motif;
        l.dateBlocage = now;
        count++;
    });
    if (count === 0) {
        showToast('Aucun stock à bloquer pour ce lot', 'warning');
        return;
    }
    DB.set('lots', lots);
    showToast(`Lot #${formatLotNumero(numLot)} bloqué (${count} format(s))`, 'warning');
    renderCurrentView();
    showLotRappelModal(numLot);
};

const debloquerLot = (numLot) => {
    confirmDialog(`Débloquer le lot #${formatLotNumero(numLot)} ? Le stock redeviendra vendable, sous réserve des DLV/DLC.`).then(ok => {
        if (ok) {
            const ids = new Set(getLotRappelData(numLot).lotsEnStock.map(l => String(l.id)));
            const lots = DB.get('lots') || [];
            let count = 0;
            lots.forEach(l => {
                if (!ids.has(String(l.id)) || !l.bloque) return;
                delete l.bloque;
                delete l.motifBlocage;
                delete l.dateBlocage;
                count++;
            });
            if (count > 0) {
                DB.set('lots', lots);
                showToast(`Lot #${formatLotNumero(numLot)} débloqué`);
                renderCurrentView();
            }
        }
        showLotRappelModal(numLot);
    });
};

const showEditLotModal = (lotId) => {
    const lots = DB.get('lots');
    const lot = lots.find(l => l.id === lotId);
    if (!lot) return;

    const aromes = DB.get('aromes') || [];
    const formats = DB.get('formats') || [];
    const norm = (s) => (s || '').toString().toLowerCase().trim();
    const aromeConnu = aromes.some(a => norm(a.nom) === norm(lot.arome));
    const formatConnu = formats.some(f => norm(f.nom) === norm(lot.format));

    // Si le nom stocké ne correspond à aucun arôme/format actuel (lot orphelin après
    // renommage), on garde une option « inconnu » présélectionnée pour ne pas la perdre.
    const aromeOptions = [
        aromeConnu ? '' : `<option value="${escapeHtml(lot.arome || '')}" selected>${escapeHtml(lot.arome || '(vide)')} — inconnu</option>`,
        ...aromes.map(a => `<option value="${escapeHtml(a.nom)}" ${norm(a.nom) === norm(lot.arome) ? 'selected' : ''}>${escapeHtml(a.nom)}${a.actif === false ? ' (inactif)' : ''}</option>`)
    ].join('');
    const formatOptions = [
        formatConnu ? '' : `<option value="${escapeHtml(lot.format || '')}" selected>${escapeHtml(lot.format || '(vide)')} — inconnu</option>`,
        ...formats.map(f => `<option value="${escapeHtml(f.nom)}" ${norm(f.nom) === norm(lot.format) ? 'selected' : ''}>${escapeHtml(f.nom)}${f.actif === false ? ' (inactif)' : ''}</option>`)
    ].join('');

    modal.show('Modifier le lot', `
        <form id="editLotForm">
            <div class="form-row">
                <div class="form-group">
                    <label>Arôme</label>
                    <select name="arome" required>${aromeOptions}</select>
                </div>
                <div class="form-group">
                    <label>Format</label>
                    <select name="format" required>${formatOptions}</select>
                </div>
            </div>
            <div class="form-group">
                <label>Quantité</label>
                <input type="number" name="quantite" value="${escapeHtml(safeNumAttr(lot.quantite))}" min="1" required>
            </div>
            <div class="form-group">
                <label>Date de production</label>
                <input type="date" name="dateProduction" value="${escapeHtml(lot.dateProduction)}" onchange="updateEditLotDates()" required>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Date limite de vente (DLV)</label>
                    <input type="date" name="dlv" value="${escapeHtml(lot.dlv)}" required>
                </div>
                <div class="form-group">
                    <label>Date limite de consommation (DLC)</label>
                    <input type="date" name="dlc" value="${escapeHtml(lot.dlc)}" required>
                </div>
            </div>
            <div class="form-group">
                <label for="editLotNote">Motif de la correction (facultatif)</label>
                <input type="text" id="editLotNote" name="note" maxlength="200" placeholder="Ex. recomptage du stock">
                <small class="text-muted">Un changement de quantité est journalisé comme ajustement. Le numéro de lot (#${escapeHtml(formatLotNumero(getLotNumero(lot)))}) ne change pas ; les livraisons déjà effectuées gardent leurs informations d'origine.</small>
            </div>
        </form>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Annuler</button>
        <button class="btn btn-primary" data-click="edit-lot-save" data-id="${escapeHtml(lotId)}">Enregistrer</button>
    `);
};

const updateEditLotDates = () => {
    const prodDate = document.querySelector('#editLotForm input[name="dateProduction"]').value;
    if (prodDate) {
        const dates = calculateDates(prodDate);
        document.querySelector('#editLotForm input[name="dlv"]').value = dates.dlv;
        document.querySelector('#editLotForm input[name="dlc"]').value = dates.dlc;
    }
};

const saveEditLot = (event, lotId) => {
    const reenable = disableSaveBtn(event);
    try {
        const form = document.getElementById('editLotForm');
        if (!form) return;
        const formData = new FormData(form);
        const quantite = Number(formData.get('quantite'));
        const dateProduction = formData.get('dateProduction');
        const dlv = formData.get('dlv');
        const dlc = formData.get('dlc');
        const arome = formData.get('arome');
        const format = formData.get('format');
        if (!arome || !format) {
            showToast('Veuillez choisir un arôme et un format', 'error');
            return;
        }
        if (!Number.isInteger(quantite) || quantite <= 0) {
            showToast('La quantité doit être un entier positif', 'error');
            return;
        }
        if (!isLotDateRangeValid(dateProduction, dlv, dlc)) {
            showToast('Les dates du lot sont invalides ou incohérentes', 'error');
            return;
        }

        const note = (formData.get('note') || '').toString().trim();

        const lots = DB.get('lots');
        const lotIndex = lots.findIndex(l => l.id === lotId);

        if (lotIndex !== -1) {
            const lot = lots[lotIndex];
            const delta = quantite - (Number(lot.quantite) || 0);
            const identiteModifiee = lot.arome !== arome || lot.format !== format || lot.dateProduction !== dateProduction
                || lot.dlv !== dlv || lot.dlc !== dlc;
            lot.arome = arome;
            lot.format = format;
            lot.quantite = quantite;
            lot.dateProduction = dateProduction;
            lot.dlv = dlv;
            lot.dlc = dlc;

            // Traçabilité : les entrées d'historique du lot suivent la correction
            // (le numLot, imprimé sur les bouteilles, ne change jamais), et un
            // changement de quantité est journalisé comme ajustement signé.
            const history = DB.get('history') || [];
            let histChanged = false;
            if (identiteModifiee) {
                history.forEach(h => {
                    if (String(h.lotId) !== String(lot.id)) return;
                    h.arome = arome;
                    h.format = format;
                    h.productionDate = dateProduction;
                    if (h.dlv !== undefined || h.dlc !== undefined) {
                        h.dlv = dlv;
                        h.dlc = dlc;
                    }
                    histChanged = true;
                });
            }
            if (delta !== 0) {
                history.unshift(buildLotHistoryEntry('AJUST', lot, delta, { motif: 'correction', ...(note ? { note } : {}) }));
                histChanged = true;
            }

            DB.set('lots', lots);
            if (histChanged) DB.set('history', history);
            modal.hide();
            showToast(delta !== 0 ? `Lot modifié — ajustement de ${delta > 0 ? '+' : '−'}${Math.abs(delta)} bt journalisé` : 'Lot modifié');
            renderCurrentView();
        }
    } catch (e) {
        console.error('Error editing lot:', e);
        showToast('Erreur lors de la modification du lot', 'error');
    } finally {
        if (reenable) reenable();
    }
};

// Pointage — helper functions

// Dernier pointage ouvert (sans heure de fin) de l'employé, daté d'aujourd'hui ou d'hier
// (pointage de nuit : arrivée 22:00, départ 02:00). Les plus anciens sont traités à part
// via la carte « Pointages non clôturés ».
const findPointageEnCours = (pointages, empId, today) => {
    const hier = toLocalDayKey(new Date(`${today}T12:00:00`).getTime() - 86400000);
    return pointages
        .filter(p => p.employeId === empId && !p.heureFin && (p.date === today || p.date === hier))
        .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.heureDebut || '').localeCompare(a.heureDebut || ''))[0] || null;
};

const pointageSelectEmployee = (empId) => {
    pointageSelectedEmployeId = empId;
    renderPointage();
};

const pointageQuickArrivee = () => {
    if (clockInEmployee(pointageSelectedEmployeId)) renderPointage();
};

const pointageQuickDepart = () => {
    if (clockOutEmployee(pointageSelectedEmployeId)) renderPointage();
};

// Clôture manuelle d'un pointage resté ouvert les jours précédents
const showCloturePointageModal = (id) => {
    const p = (DB.get('pointages') || []).find(x => x.id === id);
    if (!p) {
        showToast('Pointage non trouvé', 'error');
        return;
    }
    const emp = (DB.get('employees') || []).find(e => e.id === p.employeId);
    modal.show('Clôturer le pointage', `
        <form id="cloturePointageForm">
            <p><strong>${escapeHtml(((emp?.prenom || '') + ' ' + (emp?.nom || '')).trim() || 'N/A')}</strong> — arrivée le ${escapeHtml(formatDate(p.date))} à ${escapeHtml(p.heureDebut || '?')}</p>
            <div class="form-row">
                <div class="form-group">
                    <label>Heure de départ</label>
                    <input type="time" name="heureFin" required>
                </div>
                <div class="form-group">
                    <label>Pause (min)</label>
                    <input type="number" name="pause" value="${escapeHtml(String(parseInt(p.pause, 10) || 0))}" min="0">
                </div>
            </div>
            <p style="font-size: 12px; color: var(--text-light);">Si le départ est avant l'arrivée, il est compté le lendemain (pointage de nuit).</p>
        </form>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Annuler</button>
        <button class="btn btn-primary" data-click="save-cloture-pointage" data-id="${escapeHtml(id)}">Clôturer</button>
    `);
};

const saveCloturePointage = (id) => {
    const form = document.getElementById('cloturePointageForm');
    if (!form) return;
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }
    const formData = new FormData(form);
    const heureFin = String(formData.get('heureFin') || '');
    const pause = parseInt(formData.get('pause'), 10) || 0;
    const finMin = parseHHMM(heureFin);
    if (finMin === null) {
        showToast('Format d\'heure invalide (attendu HH:MM)', 'error');
        return;
    }
    const pointages = DB.get('pointages') || [];
    const p = pointages.find(x => x.id === id);
    if (!p) {
        showToast('Pointage non trouvé', 'error');
        return;
    }
    const debutMin = parseHHMM(p.heureDebut);
    if (debutMin !== null && computePointageMinutes(debutMin, finMin, pause) === null) {
        showToast('La pause dépasse la durée travaillée', 'error');
        return;
    }
    p.heureFin = heureFin;
    p.pause = pause;
    DB.set('pointages', pointages);
    modal.hide();
    showToast('Pointage clôturé');
    renderPointage();
};

const showPointageStatsModal = () => {
    const pointages = DB.get('pointages') || [];
    const employes = DB.get('employees') || [];
    const employesActifs = employes.filter(e => e.actif);
    const stats = getPointageStats(pointages, employes);
    modal.show('Statistiques pointage',
        `<div class="form-row" style="margin-bottom: 16px;">
            <div class="form-group">
                <label>Employé</label>
                <select id="statsEmploye" onchange="refreshPointageStatsModal()">
                    <option value="">Tous</option>
${employesActifs.map(e => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.prenom + ' ' + (e.nom || ''))}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>Période</label>
                <select id="statsPeriod" onchange="refreshPointageStatsModal()">
                    <option value="week">Semaine en cours</option>
                    <option value="month">Mois en cours</option>
                    <option value="year">Année en cours</option>
                </select>
            </div>
        </div>
        <div id="statsModalBody">
            <div class="dash-kpi-grid">
                <div class="dash-kpi-card"><div class="dash-kpi-label">Total heures</div><div class="dash-kpi-value">${stats.totalHours}h</div></div>
                <div class="dash-kpi-card"><div class="dash-kpi-label">Jours travaillés</div><div class="dash-kpi-value">${stats.daysWorked}</div></div>
            </div>
            <div class="dash-kpi-card" style="margin-bottom: 16px;"><div class="dash-kpi-label">Moyenne / jour</div><div class="dash-kpi-value">${stats.avgHours}h</div></div>
            ${stats.employeeStats.length > 0 ? `
                <h4 style="margin: 12px 0 8px; font-size: 15px;">Répartition par employé</h4>
                <div class="bar-chart">
                    ${stats.employeeStats.map((emp, i) => `
                        <div class="bar-row">
                            <span class="bar-label">${escapeHtml(emp.name)}</span>
                            <div class="bar-container">
                                <div class="bar" style="width: ${emp.percent}%; background: hsl(${i * 40 + 100}, 35%, 45%);"></div>
                            </div>
                            <span class="bar-value">${emp.hours}h</span>
                        </div>
                    `).join('')}
                </div>` : ''}
        </div>`,
        `<button class="btn btn-secondary" onclick="modal.hide()">Fermer</button>`
    );
};

const refreshPointageStatsModal = () => {
    const employes = DB.get('employees') || [];
    const pointages = DB.get('pointages') || [];
    const stats = getPointageStats(pointages, employes);
    const body = document.getElementById('statsModalBody');
    if (!body) return;
    body.innerHTML = `
        <div class="dash-kpi-grid">
            <div class="dash-kpi-card"><div class="dash-kpi-label">Total heures</div><div class="dash-kpi-value">${stats.totalHours}h</div></div>
            <div class="dash-kpi-card"><div class="dash-kpi-label">Jours travaillés</div><div class="dash-kpi-value">${stats.daysWorked}</div></div>
        </div>
        <div class="dash-kpi-card" style="margin-bottom: 16px;"><div class="dash-kpi-label">Moyenne / jour</div><div class="dash-kpi-value">${stats.avgHours}h</div></div>
        ${stats.employeeStats.length > 0 ? `
            <h4 style="margin: 12px 0 8px; font-size: 15px;">Répartition par employé</h4>
            <div class="bar-chart">
                ${stats.employeeStats.map((emp, i) => `
                    <div class="bar-row">
                        <span class="bar-label">${escapeHtml(emp.name)}</span>
                        <div class="bar-container">
                            <div class="bar" style="width: ${emp.percent}%; background: hsl(${i * 40 + 100}, 35%, 45%);"></div>
                        </div>
                        <span class="bar-value">${emp.hours}h</span>
                    </div>
                `).join('')}
            </div>` : ''}
    `;
};

const showPointageHistoriqueModal = () => {
    const employes = DB.get('employees') || [];
    const employesActifs = employes.filter(e => e.actif);
    const pointages = DB.get('pointages') || [];
    modal.show('Historique complet',
        `<div class="filters" style="margin-bottom: 12px;">
            <select id="filterEmploye" onchange="refreshPointageHistoriqueModal()">
                <option value="">Tous les employés</option>
                ${employesActifs.map(e => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.prenom + ' ' + (e.nom || ''))}</option>`).join('')}
            </select>
            <input type="date" id="filterDateFrom" placeholder="Du" onchange="refreshPointageHistoriqueModal()">
            <input type="date" id="filterDateTo" placeholder="Au" onchange="refreshPointageHistoriqueModal()">
        </div>
        <div class="table-container">
            <table>
                <thead>
                    <tr><th>Date</th><th>Employé</th><th>Début</th><th>Fin</th><th>Pause</th><th>Total</th><th></th></tr>
                </thead>
                <tbody id="historiqueModalBody">${renderHistoriqueTable(pointages, employes)}</tbody>
            </table>
        </div>`,
        `<button class="btn btn-secondary" onclick="exportPointageExcel()">Exporter CSV</button>
         <button class="btn btn-primary" onclick="modal.hide()">Fermer</button>`
    );
};

const refreshPointageHistoriqueModal = () => {
    const pointages = DB.get('pointages') || [];
    const employes = DB.get('employees') || [];
    const tbody = document.getElementById('historiqueModalBody');
    if (tbody) tbody.innerHTML = renderHistoriqueTable(pointages, employes);
};

// Pointage view
const renderPointage = (_tabIgnored) => {
    // Backward-compat : si renderPointage est appelé avec 'historique'/'stats'/'employes' (anciens onglets),
    // on ignore et on affiche la single-page. Les anciennes fonctionnalités sont accessibles via les modals.
    const pointages = DB.get('pointages') || [];
    const employes = DB.get('employees') || [];
    const today = getLocalDateISOString();

    // Nettoyer l'ancien interval pour ne pas en accumuler
    if (pointageClockInterval) {
        clearInterval(pointageClockInterval);
        pointageClockInterval = null;
    }

    const currentTime = new Date().toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
    const dateTxt = new Date().toLocaleDateString('fr-CH', { weekday: 'long', day: 'numeric', month: 'long' });

    const employesActifs = employes.filter(e => e.actif);

    // Auto-sélectionner le premier employé actif si rien n'est sélectionné ou que l'employé sélectionné n'existe plus
    if (!pointageSelectedEmployeId || !employesActifs.some(e => e.id === pointageSelectedEmployeId)) {
        pointageSelectedEmployeId = employesActifs[0]?.id || null;
    }

    // Pointages du jour + pointage "live" (pas de heureFin) par employé, y compris une arrivée de la veille (nuit)
    const pointagesAujourdhui = pointages.filter(p => p.date === today);
    const pointageEnCoursParEmp = {};
    employesActifs.forEach(e => {
        const enCours = findPointageEnCours(pointages, e.id, today);
        if (enCours) pointageEnCoursParEmp[e.id] = enCours;
    });

    // Pointages restés ouverts les jours précédents (départ oublié ou à clôturer)
    const pointagesOuverts = pointages
        .filter(p => p.date && p.date < today && !p.heureFin)
        .sort((a, b) => b.date.localeCompare(a.date) || (b.heureDebut || '').localeCompare(a.heureDebut || ''));

    const selectedEmpId = pointageSelectedEmployeId;
    const selectedEmp = employesActifs.find(e => e.id === selectedEmpId);
    const pointageEnCours = selectedEmpId ? pointageEnCoursParEmp[selectedEmpId] : null;
    const dejaArrive = !!pointageEnCours;

    const initiales = (e) => {
        if (!e) return '?';
        const p = (e.prenom || '').trim();
        const n = (e.nom || '').trim();
        return ((p[0] || '') + (n[0] || '')).toUpperCase() || '?';
    };

    // Historique du jour : pointages déjà terminés (avec heureFin), triés par heure de début
    const historiqueJour = pointagesAujourdhui
        .slice()
        .sort((a, b) => (a.heureDebut || '').localeCompare(b.heureDebut || ''));

    safeRender(`
        <div class="page-header-big">
            <h1>Pointage</h1>
        </div>

        <div class="pointage-hero">
            <div class="section-label">${selectedEmp ? escapeHtml(selectedEmp.prenom + ' ' + (selectedEmp.nom || '')) : 'Aucun employé sélectionné'}</div>
            <div class="pointage-clock-big current-time">${currentTime}</div>
            <div class="pointage-date">${escapeHtml(dateTxt)}</div>
            <div class="pointage-actions">
                <button type="button" class="btn btn-arrivee" ${dejaArrive || !selectedEmp ? 'disabled' : ''} onclick="pointageQuickArrivee()">
                    ▶ Arrivée
                </button>
                <button type="button" class="btn btn-depart" ${!dejaArrive ? 'disabled' : ''} onclick="pointageQuickDepart()">
                    ⏹ Départ
                </button>
            </div>
        </div>

        <div class="card">
            <div class="card-header" style="margin-bottom: 12px; padding-bottom: 0; border: none;">
                <h3 class="card-title">Qui pointe ?</h3>
            </div>
            ${employesActifs.length === 0 ? '<p style="color: var(--text-light);">Aucun employé actif. Ajoute-en depuis Paramètres.</p>' : `
                <div class="employee-grid">
                    ${employesActifs.map(e => {
                        const isSelected = e.id === selectedEmpId;
                        const isLive = !!pointageEnCoursParEmp[e.id];
                        return `<a href="#pointage" class="employee-card ${isSelected ? 'selected' : ''}" data-click="pointage-select-employee" data-id="${escapeHtml(e.id)}" data-prevent>
                            <div class="avatar ${isLive ? 'avatar-live' : ''}">${escapeHtml(initiales(e))}</div>
                            <div class="employee-info">
                                <div class="employee-name">${escapeHtml(e.prenom)} ${escapeHtml(e.nom || '')}</div>
                                <div class="employee-sub">${isLive ? '● en cours' : 'libre'}</div>
                            </div>
                        </a>`;
                    }).join('')}
                </div>
            `}
        </div>

        <div class="card">
            <div class="card-header" style="margin-bottom: 12px; padding-bottom: 0; border: none;">
                <h3 class="card-title">Saisie manuelle</h3>
            </div>
            <form id="quickPointageForm">
                <div class="form-row">
                    <div class="form-group">
                        <label>Employé</label>
                        <select name="employeId" required>
                            ${employesActifs.length === 0 ? '<option value="">Aucun employé</option>' :
                              employesActifs.map(e => `<option value="${escapeHtml(e.id)}" ${e.id === selectedEmpId ? 'selected' : ''}>${escapeHtml(e.prenom + ' ' + (e.nom || ''))}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Date</label>
                        <input type="date" name="date" value="${today}" required>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Arrivée</label>
                        <input type="time" name="heureDebut" required>
                    </div>
                    <div class="form-group">
                        <label>Départ</label>
                        <input type="time" name="heureFin" required>
                    </div>
                    <div class="form-group">
                        <label>Pause (min)</label>
                        <input type="number" name="pause" value="0" min="0">
                    </div>
                </div>
                <button type="button" class="btn btn-primary" onclick="saveQuickPointage(event)">Enregistrer</button>
            </form>
        </div>

        ${pointagesOuverts.length === 0 ? '' : `
        <div class="card">
            <div class="card-header" style="margin-bottom: 12px; padding-bottom: 0; border: none;">
                <h3 class="card-title">Pointages non clôturés</h3>
                <span style="font-size: 12px; color: var(--text-light);">${pointagesOuverts.length} pointage${pointagesOuverts.length !== 1 ? 's' : ''} resté${pointagesOuverts.length !== 1 ? 's' : ''} ouvert${pointagesOuverts.length !== 1 ? 's' : ''}</span>
            </div>
            ${pointagesOuverts.map(p => {
                const emp = employes.find(x => x.id === p.employeId);
                return `<div class="history-row">
                    <div class="avatar avatar-sm">${escapeHtml(initiales(emp))}</div>
                    <div class="history-row-info">
                        <div class="history-row-name">${escapeHtml((emp?.prenom || '') + ' ' + (emp?.nom || ''))}</div>
                        <div class="history-row-times">${escapeHtml(formatDate(p.date))} • arrivée ${escapeHtml(p.heureDebut || '?')} → départ non pointé</div>
                    </div>
                    <div class="history-row-total">
                        <button type="button" class="btn btn-sm btn-secondary" data-click="cloturer-pointage" data-id="${escapeHtml(p.id)}">Clôturer</button>
                        <button type="button" class="btn btn-sm btn-danger" data-click="delete-pointage" data-id="${escapeHtml(p.id)}">Supprimer</button>
                    </div>
                </div>`;
            }).join('')}
        </div>`}

        <div class="card">
            <div class="card-header" style="margin-bottom: 12px; padding-bottom: 0; border: none;">
                <h3 class="card-title">Historique du jour</h3>
                <span style="font-size: 12px; color: var(--text-light);">${historiqueJour.length} pointage${historiqueJour.length !== 1 ? 's' : ''}</span>
            </div>
            ${historiqueJour.length === 0 ? '<p style="color: var(--text-light); font-size: 13px;">Aucun pointage aujourd\'hui pour l\'instant.</p>' : `
                ${historiqueJour.map(p => {
                    const emp = employes.find(x => x.id === p.employeId);
                    const debutMin = parseHHMM(p.heureDebut);
                    const finMin = parseHHMM(p.heureFin);
                    const pause = parseInt(p.pause, 10) || 0;
                    let totalLabel = '— en cours';
                    if (debutMin !== null && finMin !== null) {
                        const totalMin = computePointageMinutes(debutMin, finMin, pause);
                        if (totalMin > 0) {
                            const h = Math.floor(totalMin / 60);
                            const m = totalMin % 60;
                            totalLabel = `${h}h${m > 0 ? ' ' + m + 'min' : ''}`;
                        }
                    }
                    return `<div class="history-row">
                        <div class="avatar avatar-sm">${escapeHtml(initiales(emp))}</div>
                        <div class="history-row-info">
                            <div class="history-row-name">${escapeHtml((emp?.prenom || '') + ' ' + (emp?.nom || ''))}</div>
                            <div class="history-row-times">${escapeHtml(p.heureDebut || '?')} → ${escapeHtml(p.heureFin || '...')}${pause ? ' • pause ' + pause + ' min' : ''}</div>
                        </div>
                        <div class="history-row-total">${totalLabel}</div>
                    </div>`;
                }).join('')}
            `}
        </div>

        <div class="flex gap-4" style="margin-top: 16px; flex-wrap: wrap;">
            <button type="button" class="btn btn-ghost btn-sm" onclick="showPointageStatsModal()">📊 Voir stats</button>
            <button type="button" class="btn btn-ghost btn-sm" onclick="showPointageHistoriqueModal()">📅 Historique complet</button>
            <button type="button" class="btn btn-ghost btn-sm" onclick="exportPointageExcel()">📤 Export CSV</button>
        </div>
    `);

    // Update time every second
    pointageClockInterval = setInterval(() => {
        const timeEl = document.querySelector('.pointage-hero .current-time');
        if (timeEl) {
            timeEl.textContent = new Date().toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
        } else {
            // L'élément n'est plus dans le DOM → l'utilisateur a navigué ailleurs, on arrête
            clearInterval(pointageClockInterval);
            pointageClockInterval = null;
        }
    }, 1000);
};

const renderHistoriqueTable = (pointages, employes) => {
    const filterEmploye = document.getElementById('filterEmploye')?.value || '';
    const filterDateFrom = document.getElementById('filterDateFrom')?.value || '';
    const filterDateTo = document.getElementById('filterDateTo')?.value || '';

    const filtered = pointages
        .filter(p => {
            if (filterEmploye && p.employeId !== filterEmploye) return false;
            if (filterDateFrom && p.date < filterDateFrom) return false;
            if (filterDateTo && p.date > filterDateTo) return false;
            return true;
        })
        .sort((a, b) => new Date(b.date) - new Date(a.date));

    if (filtered.length === 0) {
        return '<tr><td colspan="7" class="text-center">Aucun pointage</td></tr>';
    }

    return filtered.map(p => {
        const emp = employes.find(e => e.id === p.employeId);
        const debutMin = parseHHMM(p.heureDebut);
        const finMin = parseHHMM(p.heureFin);
        let totalMinutes = 0;
        if (debutMin !== null && finMin !== null) {
            totalMinutes = computePointageMinutes(debutMin, finMin, p.pause || 0);
        }
        const heures = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;

        return `
            <tr>
                <td>${formatDate(p.date)}</td>
                <td>${emp ? escapeHtml(emp.prenom + ' ' + emp.nom) : 'N/A'}</td>
                <td>${escapeHtml(p.heureDebut || '-')}</td>
                <td>${escapeHtml(p.heureFin || '-')}</td>
                <td>${p.pause || 0} min</td>
                <td>${totalMinutes > 0 ? `${heures}h ${mins}min` : '-'}</td>
                <td>
                    <button class="btn btn-sm btn-danger" data-click="delete-pointage" data-id="${escapeHtml(p.id)}">Supprimer</button>
                </td>
            </tr>
        `;
    }).join('');
};

const getMonday = (d) => {
    const dt = new Date(d);
    const day = dt.getDay();
    const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(dt.getFullYear(), dt.getMonth(), diff);
};

const getPointageStats = (pointages, employes) => {
    const statsEmploye = document.getElementById('statsEmploye')?.value || '';
    const statsPeriod = document.getElementById('statsPeriod')?.value || 'week';

    const now = new Date();
    let startDate, endDate;

    if (statsPeriod === 'week') {
        startDate = getMonday(now);
        endDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + 6);
    } else if (statsPeriod === 'month') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    } else {
        startDate = new Date(now.getFullYear(), 0, 1);
        endDate = new Date(now.getFullYear(), 11, 31);
    }

    const formatDateISO = (d) => {
        const cloned = new Date(d.getTime());
        const offset = cloned.getTimezoneOffset();
        cloned.setMinutes(cloned.getMinutes() - offset);
        return cloned.toISOString().split('T')[0];
    };

    const startStr = formatDateISO(startDate);
    const endStr = formatDateISO(endDate);

    let filtered = pointages.filter(p => p.date >= startStr && p.date <= endStr && p.heureFin);

    if (statsEmploye) {
        filtered = filtered.filter(p => p.employeId === statsEmploye);
    }

    const totalMinutes = filtered.reduce((acc, p) => {
        const debutMin = parseHHMM(p.heureDebut);
        const finMin = parseHHMM(p.heureFin);
        if (debutMin === null || finMin === null) return acc;
        const diff = computePointageMinutes(debutMin, finMin, p.pause || 0);
        return acc + (diff > 0 ? diff : 0);
    }, 0);

    const totalHours = (totalMinutes / 60).toFixed(1);
    const daysWorked = new Set(filtered.map(p => p.date)).size;
    const avgHours = daysWorked > 0 ? (totalMinutes / 60 / daysWorked).toFixed(1) : 0;

    // Employee stats
    const empStats = {};
    filtered.forEach(p => {
        if (!empStats[p.employeId]) empStats[p.employeId] = 0;
        const debutMin = parseHHMM(p.heureDebut);
        const finMin = parseHHMM(p.heureFin);
        if (debutMin === null || finMin === null) return;
        const diff = computePointageMinutes(debutMin, finMin, p.pause || 0);
        if (diff > 0) empStats[p.employeId] += diff / 60;
    });

    const maxHours = Math.max(...Object.values(empStats), 1);
    const employeeStats = Object.entries(empStats).map(([id, hours]) => {
        const emp = employes.find(e => e.id === id);
        return {
            name: emp ? emp.prenom + ' ' + emp.nom : 'Inconnu',
            hours: hours.toFixed(1),
            percent: (hours / maxHours) * 100
        };
    }).sort((a, b) => parseFloat(b.hours) - parseFloat(a.hours));

    return { totalHours, daysWorked, avgHours, employeeStats };
};

const saveQuickPointage = (event) => {
    const reenable = disableSaveBtn(event);
    try {
        const form = document.getElementById('quickPointageForm');
        const formData = new FormData(form);

        const employeId = formData.get('employeId');
        const date = formData.get('date');
        const heureDebut = formData.get('heureDebut');
        const heureFin = formData.get('heureFin');
        const pause = parseInt(formData.get('pause')) || 0;

        if (!employeId || !date || !heureDebut || !heureFin) {
            showToast('Veuillez remplir tous les champs', 'error');
            return;
        }
        if (parseHHMM(heureDebut) === null || parseHHMM(heureFin) === null) {
            showToast('Format d\'heure invalide (attendu HH:MM)', 'error');
            return;
        }

        const pointages = DB.get('pointages') || [];
        const pointage = {
            id: generateId(),
            employeId,
            date,
            heureDebut,
            heureFin,
            pause
        };
        pointages.push(pointage);
        DB.set('pointages', pointages);

        form.reset();
        document.querySelector('#quickPointageForm input[name="date"]').value = getLocalDateISOString();
        showToast('Pointage ajouté');
        renderPointage('pointage');
    } catch (e) {
        console.error('Error saving quick pointage:', e);
        showToast('Erreur lors de l\'enregistrement du pointage', 'error');
    } finally {
        if (reenable) reenable();
    }
};

const exportPointageExcel = () => {
    const pointages = DB.get('pointages') || [];
    const employes = DB.get('employees') || [];
    const filterEmploye = document.getElementById('filterEmploye')?.value || '';
    const filterDateFrom = document.getElementById('filterDateFrom')?.value || '';
    const filterDateTo = document.getElementById('filterDateTo')?.value || '';

    const filtered = pointages
        .filter(p => {
            if (filterEmploye && p.employeId !== filterEmploye) return false;
            if (filterDateFrom && p.date < filterDateFrom) return false;
            if (filterDateTo && p.date > filterDateTo) return false;
            return true;
        })
        .sort((a, b) => new Date(b.date) - new Date(a.date));

    // Create CSV content
    let csv = '\uFEFFDate,Employé,Début,Fin,Pause,Durée\n';

    filtered.forEach(p => {
        const emp = employes.find(e => e.id === p.employeId);
        const empName = emp ? emp.prenom + ' ' + emp.nom : 'N/A';

        const debutMin = parseHHMM(p.heureDebut);
        const finMin = parseHHMM(p.heureFin);
        let totalMinutes = 0;
        if (debutMin !== null && finMin !== null) {
            totalMinutes = computePointageMinutes(debutMin, finMin, p.pause || 0);
        }
        const heures = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        const duree = totalMinutes > 0 ? `${heures}h ${mins}min` : '-';

        csv += [p.date, empName, p.heureDebut || '-', p.heureFin || '-', p.pause || 0, duree].map(csvCell).join(',') + '\n';
    });

    // Download CSV
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `pointages_${getLocalDateISOString()}.csv`;
    link.click();

    showToast('Exporté en CSV');
};

const deletePointage = (id) => {
    confirmDialog('Êtes-vous sûr de vouloir supprimer ce pointage ?', { danger: true }).then(ok => {
        if (!ok) return;
        const pointages = DB.get('pointages').filter(p => p.id !== id);
        DB.set('pointages', pointages);
        showToast('Pointage supprimé');
        renderPointage();
    });
};

// Step tracker and week calendar for commandes
const renderStepTracker = (statut) => {
    if (statut === 'annulee') return '';
    const steps = [
        { key: 'creee',    label: 'Créée' },
        { key: 'produite', label: 'Produite' },
        { key: 'livree',   label: 'Livrée' }
    ];
    const currentIdx = statut === 'en_attente' ? 0
                     : statut === 'produite'   ? 1
                     : statut === 'livrée'      ? 2 : 0;
    const treatAsDone = statut === 'livrée';
    return `<div class="step-tracker">
        ${steps.map((s, i) => {
            const state = treatAsDone
                ? 'done'
                : (i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'pending');
            const connector = i < steps.length - 1
                ? `<div class="step-connector ${(treatAsDone || i < currentIdx) ? 'done' : ''}"></div>`
                : '';
            return `<div class="step ${state}">
                <div class="step-dot">${state === 'done' ? '✓' : i + 1}</div>
                <div class="step-label">${s.label}</div>
            </div>${connector}`;
        }).join('')}
    </div>`;
};

let weekCalendarOffset = 0;

const renderWeekCalendar = (commandesByDate) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const monday = new Date(today);
    const day = (monday.getDay() + 6) % 7;
    monday.setDate(monday.getDate() - day + (weekCalendarOffset * 7));
    const days = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        days.push(d);
    }
    const iso = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day2 = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day2}`;
    };
    const todayIso = iso(today);
    const monthLabel = monday.toLocaleDateString('fr-CH', { month: 'long', year: 'numeric' });
    return `<div class="week-calendar-wrap">
        <div class="week-calendar-header">
            <button type="button" class="btn-bare" onclick="changeWeekCalendar(-1)" aria-label="Semaine précédente">‹</button>
            <span class="week-month">${escapeHtml(monthLabel)}</span>
            <button type="button" class="btn-bare" onclick="changeWeekCalendar(1)" aria-label="Semaine suivante">›</button>
        </div>
        <div class="week-calendar">
            ${days.map(d => {
                const dStr = iso(d);
                const isToday = dStr === todayIso;
                const isSelected = dStr === weekCalendarSelectedDate;
                const hasOrders = (commandesByDate[dStr] || 0) > 0;
                const dayLetter = ['L', 'M', 'M', 'J', 'V', 'S', 'D'][(d.getDay() + 6) % 7];
                return `<button type="button" class="week-day ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}" data-click="select-week-day" data-date="${escapeHtml(dStr)}">
                    <span class="week-day-name">${dayLetter}</span>
                    <span class="week-day-num">${d.getDate()}</span>
                    ${hasOrders ? '<span class="week-day-dot"></span>' : ''}
                </button>`;
            }).join('')}
        </div>
    </div>`;
};

const changeWeekCalendar = (delta) => {
    weekCalendarOffset += delta;
    renderCommandes();
};
const selectWeekDay = (dateStr) => {
    weekCalendarSelectedDate = (weekCalendarSelectedDate === dateStr) ? '' : dateStr;
    renderCommandes();
};

// Commandes
const renderCommandes = () => {
    const savedFilterStatut = DB.getFilter('statut') || '';
    const savedFilterClient = DB.getFilter('commandeClient') || '';
    const showArchives = localStorage.getItem('thecol_show_archives') === 'true';

    const allCommandes = DB.get('commandes') || [];
    const commandesScope = showArchives
        ? allCommandes.filter(c => c.statut === 'livrée' || c.statut === 'annulee')
        : allCommandes.filter(c => c.statut !== 'livrée' && c.statut !== 'annulee');
    const clients = DB.get('clients') || [];
    const clientFiltre = savedFilterClient ? clients.find(c => c.id === savedFilterClient) : null;
    const aromes = DB.get('aromes') || [];
    const formats = DB.get('formats') || [];

    const countByStatut = { en_attente: 0, produite: 0, 'livrée': 0, annulee: 0 };
    commandesScope.forEach(c => { if (countByStatut[c.statut] !== undefined) countByStatut[c.statut]++; });

    const commandesByDate = {};
    commandesScope.forEach(c => {
        if (c.dateLivraison) {
            const k = String(c.dateLivraison).slice(0, 10);
            commandesByDate[k] = (commandesByDate[k] || 0) + 1;
        }
    });

    let filtered = commandesScope;
    if (!showArchives) {
        if (savedFilterStatut) filtered = filtered.filter(c => c.statut === savedFilterStatut);
        if (weekCalendarSelectedDate) {
            filtered = filtered.filter(c => String(c.dateLivraison || '').slice(0, 10) === weekCalendarSelectedDate);
        }
        if (savedFilterClient) filtered = filtered.filter(c => c.clientId === savedFilterClient);
    }
    filtered.sort((a, b) => new Date(b.dateCommande) - new Date(a.dateCommande));

    const pillBtn = (key, label) => `
        <button type="button" class="status-pill ${savedFilterStatut === key ? 'active' : ''}" data-click="toggle-pill-statut" data-value="${escapeHtml(key)}">
            ${label}
            <span class="pill-count">${countByStatut[key] || 0}</span>
        </button>`;

    const cardsHtml = filtered.length === 0
        ? '<div class="commande-empty">Aucune commande</div>'
        : filtered.map(cmd => {
            const client = clients.find(cl => cl.id === cmd.clientId);
            const clientLabel = client?.societe || client?.nom || 'Client inconnu';
            const safeItems = cmd.items || [];
            const totalItems = safeItems.reduce((sum, i) => sum + (i.quantite || 0), 0);
            const articlesPreview = safeItems.slice(0, 3).map(i => {
                const a = aromes.find(a => a.id === i.aromeId);
                const f = formats.find(f => f.id === i.formatId);
                return `${i.quantite}× ${a?.nom || '?'} ${f?.nom || '?'}`;
            }).join(' • ');
            const more = safeItems.length > 3 ? ` • +${safeItems.length - 3}` : '';
            const montant = getCommandeMontant(cmd, clients, formats);
            const badgeMap = {
                'en_attente': 'badge-en-attente',
                'produite':   'badge-produite',
                'livrée':      'badge-livree',
                'annulee':    'badge-annulee'
            };
            const cardClass = `commande-card statut-${escapeHtml(cmd.statut === 'livrée' ? 'livree' : cmd.statut)}`;
            return `<a href="#commandes" class="${cardClass}" data-click="show-commande-details" data-id="${escapeHtml(cmd.id)}" data-prevent>
                <div class="commande-card-header">
                    <span class="commande-card-numero">#${escapeHtml(getCommandeNumero(cmd))}</span>
                    <span class="badge ${badgeMap[cmd.statut] || 'badge-default'}">${escapeHtml(getCommandeStatutLabel(cmd.statut))}</span>
                </div>
                <div class="commande-card-name">${escapeHtml(clientLabel)}</div>
                <div class="commande-card-items">${escapeHtml(articlesPreview + more)} • ${totalItems} bt</div>
                <div class="commande-card-footer">
                    <span class="commande-card-date">Livraison ${formatDate(cmd.dateLivraison)}</span>
                    <span class="commande-card-amount ${montant === null ? 'muted' : ''}">${formatChf(montant)}</span>
                </div>
            </a>`;
        }).join('');

    const html = `
        <div class="commandes-toolbar">
            <h1>${showArchives ? 'Archives' : 'Commandes'}</h1>
            <div class="header-actions" style="display:flex; gap:8px;">
                <button class="btn btn-ghost btn-sm" onclick="toggleArchives()" title="${showArchives ? 'Voir commandes actives' : 'Voir archives'}">
                    ${showArchives ? '← Actives' : 'Archives'}
                </button>
                ${showArchives
                    ? `<button class="btn btn-ghost btn-sm" onclick="exportArchivesExcel()" title="Exporter Excel">📤 Excel</button>`
                    : `<button class="btn btn-ghost btn-sm" onclick="checkStockAndUpdateCommandes()" title="Marquer produites les commandes en attente réalisables avec le stock actuel">✓ Stock</button>
                       <button class="btn btn-primary btn-sm" onclick="showCommandeModal()">+ Créer</button>`}
            </div>
        </div>

        ${!showArchives ? renderWeekCalendar(commandesByDate) : ''}

        ${!showArchives ? `
            <div class="status-pills">
                <button type="button" class="status-pill ${!savedFilterStatut ? 'active' : ''}" onclick="togglePillStatut('')">
                    Toutes
                    <span class="pill-count">${commandesScope.length}</span>
                </button>
                ${pillBtn('en_attente', 'En attente')}
                ${pillBtn('produite', 'Produite')}
            </div>
        ` : ''}

        ${!showArchives && weekCalendarSelectedDate ? `<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background: var(--bg-secondary); border-radius: var(--radius-md); margin-bottom: 12px; font-size: 12px;">
            <span>📅 Filtre : livraisons du ${formatDate(weekCalendarSelectedDate)}</span>
            <button type="button" class="btn-bare" style="color: var(--primary); font-size: 12px; padding: 0;" data-click="select-week-day" data-date="${escapeHtml(weekCalendarSelectedDate)}">Effacer ✕</button>
        </div>` : ''}
        ${!showArchives && savedFilterClient && clientFiltre ? `<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background: var(--bg-secondary); border-radius: var(--radius-md); margin-bottom: 12px; font-size: 12px;">
            <span>👤 Filtre : ${escapeHtml(clientFiltre.societe || clientFiltre.nom || 'Client')}</span>
            <button type="button" class="btn-bare" style="color: var(--primary); font-size: 12px; padding: 0;" onclick="DB.setFilter('commandeClient', ''); renderCommandes()">Effacer ✕</button>
        </div>` : ''}

        <div class="commandes-list">
            ${cardsHtml}
        </div>
    `;

    safeRender(html);
};

const onMatrixCellInput = (input) => {
    const cell = input.closest('td');
    if (cell) {
        const val = parseInt(input.value, 10) || 0;
        cell.classList.toggle('filled', val > 0);
    }
    updateCommandeTotalModal();
};

const onCommandeClientChange = (select) => {
    const fields = document.getElementById('ponctuelFields');
    if (fields) fields.style.display = select.value === '__ponctuel__' ? '' : 'none';
    updateCommandeTotalModal();
};

const filterClientOptions = (query) => {
    const select = document.querySelector('select[name="clientId"]');
    if (!select) return;
    const q = (query || '').trim();
    const previousValue = select.value;

    // Reconstruire les options via DOM API à partir de la source sûre
    select.textContent = '';
    const matching = !q
        ? _commandeModalClientOptions
        : _commandeModalClientOptions.filter(c => includesText(c.label, q));

    matching.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.label;
        select.appendChild(opt);
    });

    const ponctuelOpt = document.createElement('option');
    ponctuelOpt.value = '__ponctuel__';
    ponctuelOpt.textContent = '➕ Client ponctuel (non récurrent)';
    select.appendChild(ponctuelOpt);

    // Restaurer la sélection si elle correspond encore, sinon aucune sélection automatique
    if (previousValue && Array.from(select.options).some(o => o.value === previousValue)) {
        select.value = previousValue;
    } else {
        select.selectedIndex = -1;
    }

    onCommandeClientChange(select);
};

const showCommandeModal = (id = null, prefill = null) => {
    const clients = getActive('clients');
    const aromes = getActive('aromes');
    const formats = getActive('formats');
    const commandes = DB.get('commandes');

    let commande = null;
    if (id) {
        commande = commandes.find(c => c.id === id);
    }

    if (id && !commande) {
        showToast('Commande non trouvée', 'error');
        return;
    }

    if (commande?.statut === 'livrée') {
        showToast('Une commande livrée ne peut plus être modifiée', 'warning');
        return;
    }

    if (aromes.length === 0 || formats.length === 0) {
        showToast('Veuillez d\'abord configurer aromes et formats', 'error');
        return;
    }

    // Source du pré-remplissage : la commande modifiée, ou le modèle d'une duplication
    const source = commande || prefill;

    // Arômes/formats désactivés mais présents dans la commande : on les garde dans la matrice
    // pour que l'enregistrement ne supprime pas ces lignes
    const usedIds = (key) => new Set((source?.items || []).map(i => i[key]));
    const usedAromeIds = usedIds('aromeId');
    const usedFormatIds = usedIds('formatId');
    const matrixAromes = [...aromes, ...DB.get('aromes').filter(a => !a.actif && usedAromeIds.has(a.id))];
    const matrixFormats = [...formats, ...DB.get('formats').filter(f => !f.actif && usedFormatIds.has(f.id))];
    const inactifTag = (r) => (r.actif ? '' : ' <small>(inactif)</small>');

    // Inclure le client de la commande même s'il est inactif (ex: client ponctuel)
    const clientOptions = [...clients];
    if (source?.clientId && !clientOptions.some(c => c.id === source.clientId)) {
        const existing = DB.get('clients').find(c => c.id === source.clientId);
        if (existing) clientOptions.push(existing);
    }
    _commandeModalClientOptions = clientOptions.map(c => ({ id: c.id, label: c.societe || c.nom }));

    modal.show(id ? 'Modifier commande' : 'Nouvelle commande', `
        <form id="commandeForm">
            <div class="form-row">
                <div class="form-group">
                    <label>Client</label>
                    <input type="search" placeholder="Filtrer les clients…" aria-label="Filtrer les clients" oninput="filterClientOptions(this.value)" style="margin-bottom: 8px;">
                    <select name="clientId" required onchange="onCommandeClientChange(this)">
                        ${clientOptions.map(c => `<option value="${escapeHtml(c.id)}" ${source?.clientId === c.id ? 'selected' : ''}>${escapeHtml(c.societe || c.nom)}</option>`).join('')}
                        <option value="__ponctuel__">➕ Client ponctuel (non récurrent)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Date de livraison</label>
                    <input type="date" name="dateLivraison" value="${escapeHtml(commande?.dateLivraison || '')}" required>
                </div>
            </div>
            <div id="ponctuelFields" style="display: none;">
                <div class="form-row">
                    <div class="form-group">
                        <label>Nom du client ponctuel</label>
                        <input type="text" name="ponctuelNom" placeholder="Nom ou société">
                    </div>
                    <div class="form-group">
                        <label>Catégorie tarif</label>
                        <select name="ponctuelTarif" onchange="updateCommandeTotalModal()">
                            <option value="prive">Privé (3.– / 5.– / 8.50)</option>
                            <option value="distributeur">Distributeur (2.25 / 3.80 / 6.–)</option>
                            <option value="restaurant">Restaurant (litre 4.–)</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label>Adresse (optionnel)</label>
                    <input type="text" name="ponctuelAdresse" placeholder="Adresse, NPA, localité">
                </div>
            </div>
            <div class="form-group">
                <label>Articles</label>
                <div class="items-matrix-container">
                    <table class="items-matrix">
                        <thead>
                            <tr>
                                <th>Arome</th>
                                ${matrixFormats.map(f => `<th>${escapeHtml(f.nom)}${inactifTag(f)}</th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>
                            ${matrixAromes.map(a => `
                                <tr>
                                    <td>${escapeHtml(a.nom)}${inactifTag(a)}</td>
                                    ${matrixFormats.map(f => {
                                        const item = source?.items?.find(i => i.aromeId === a.id && i.formatId === f.id);
                                        const qty = item ? item.quantite : '';
                                        const safeName = `items[${escapeHtml(a.id)}][${escapeHtml(f.id)}]`; return `<td><input type="number" name="${safeName}" value="${escapeHtml(String(qty ?? ''))}" min="0" placeholder="0" class="item-qty-input" oninput="onMatrixCellInput(this)"></td>`;
                                    }).join('')}
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="commande-total" id="commandeTotalRow">
                <div>
                    <div class="commande-total-label">Total</div>
                    <div class="commande-total-sub" id="commandeTotalSub">— bouteilles</div>
                </div>
                <div class="commande-total-value" id="commandeTotalValue">CHF —</div>
            </div>

        </form>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Annuler</button>
        <button class="btn btn-primary" data-click="save-commande" data-id="${escapeHtml(id || '')}">Enregistrer</button>
    `);

    // Visibilité des champs ponctuels + recalcul initial du total
    const clientSelect = document.querySelector('#commandeForm select[name="clientId"]');
    if (clientSelect) {
        onCommandeClientChange(clientSelect);
    } else {
        updateCommandeTotalModal();
    }
};

const saveCommande = (event, id) => {
    const reenable = disableSaveBtn(event);
    try {
        const form = document.getElementById('commandeForm');
        if (!form) return;

        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        const commandes = DB.get('commandes') || [];
        const commandeExistante = id ? commandes.find(c => c.id === id) : null;
        if (id && !commandeExistante) {
            showToast('Commande non trouvée', 'error');
            return;
        }
        if (commandeExistante?.statut === 'livrée') {
            showToast('Une commande livrée ne peut plus être modifiée', 'warning');
            return;
        }

        const formData = new FormData(form);
        const statut = (id && commandeExistante) ? commandeExistante.statut : 'en_attente';

        const items = [];
        const qtyInputs = document.querySelectorAll('.item-qty-input');
        qtyInputs.forEach(input => {
            const qty = parseInt(input.value, 10) || 0;
            if (qty > 0) {
                const name = input.name;
                const match = name.match(/items\[([^\]]+)\]\[([^\]]+)\]/);
                if (match) {
                    items.push({ aromeId: match[1], formatId: match[2], quantite: qty });
                }
            }
        });

        if (items.length === 0) {
            showToast('Ajoutez au moins un article', 'error');
            return;
        }

        let clientId = formData.get('clientId');
        if (!clientId) {
            showToast('Veuillez sélectionner un client', 'error');
            return;
        }

        if (clientId === '__ponctuel__') {
            const nom = String(formData.get('ponctuelNom') || '').trim();
            if (!nom) {
                showToast('Veuillez saisir le nom du client ponctuel', 'error');
                return;
            }
            // actif: false → n'apparaît pas dans les prochaines commandes ni les filtres
            const nouveauClient = {
                id: generateId(),
                societe: '',
                nom,
                adresse: String(formData.get('ponctuelAdresse') || '').trim(),
                npa: '',
                tarifs: formData.get('ponctuelTarif') || 'prive',
                prix25cl: '',
                prix50cl: '',
                prix100cl: '',
                modeFact: '',
                coord: '',
                actif: false,
                ponctuel: true
            };
            const clientsDb = DB.get('clients');
            clientsDb.push(nouveauClient);
            DB.set('clients', clientsDb);
            clientId = nouveauClient.id;
        }

        const dateLivraison = formData.get('dateLivraison');
        if (!dateLivraison || Number.isNaN(new Date(dateLivraison).getTime())) {
            showToast('Date de livraison invalide', 'error');
            return;
        }

        const commande = {
            id: id || generateId(),
            numero: id ? commandeExistante.numero : getNextCommandeNumero(),
            clientId,
            dateCommande: id ? commandeExistante.dateCommande : getLocalDateISOString(),
            dateLivraison,
            statut,
            items
        };

        if (id) {
            const index = commandes.findIndex(c => c.id === id);
            if (index !== -1) {
                commandes[index] = commande;
            } else {
                commandes.push(commande);
            }
        } else {
            commandes.push(commande);
        }
        DB.set('commandes', commandes);
        if (commande.statut === 'annulee') {
            deleteBLForCommande(commande.id);
        }

        modal.hide();
        showToast('Commande enregistrée');
        renderCurrentView();
    } catch (e) {
        console.error('Error saving commande:', e);
        showToast('Erreur lors de l\'enregistrement de la commande', 'error');
    } finally {
        if (reenable) reenable();
    }
};

const editCommande = (id) => showCommandeModal(id);

const updateCommandeStatut = (id, statut, { fromLivraison = false } = {}) => {
    if (!['en_attente', 'produite', 'livrée', 'annulee'].includes(statut)) {
        showToast('Statut de commande invalide', 'error');
        return false;
    }
    if (statut === 'livrée' && !fromLivraison) {
        showToast('Le statut « Livrée » est réservé à la confirmation de livraison', 'error');
        return false;
    }

    const commandes = DB.get('commandes') || [];
    const index = commandes.findIndex(c => c.id === id);
    if (index !== -1) {
        commandes[index].statut = statut;
        DB.set('commandes', commandes);
        if (statut === 'annulee') {
            deleteBLForCommande(id);
        }
        renderCurrentView();
        return true;
    }
    return false;
};

const marquerCommandeProduite = (id) => {
    updateCommandeStatut(id, 'produite');
    modal.hide();
    showToast('Commande marquée comme produite');
};

const restaurerCommande = (id) => {
    const commandes = DB.get('commandes') || [];
    const cmd = commandes.find(c => c.id === id);
    if (!cmd) { showToast('Commande non trouvée', 'error'); return; }

    const estLivree = cmd.statut === 'livrée';
    const estAnnulee = cmd.statut === 'annulee';
    if (!estLivree && !estAnnulee) { showToast('Cette commande ne peut pas être restaurée', 'error'); return; }

    const message = estLivree
        ? 'Restaurer cette commande ? Le stock sera restitué (bouteilles re-créditées aux lots), le bulletin de livraison sera supprimé, et la commande repassera en statut « produite ».'
        : 'Restaurer cette commande ? Elle repassera en statut « en attente ».';

    confirmDialog(message, { danger: false }).then(ok => {
        if (!ok) return;

        if (estLivree) {
            const lots = DB.get('lots') || [];
            const history = DB.get('history') || [];
            const lotsUtilises = cmd.lotsUtilises || [];
            const newHistoryEntries = [];

            // Traçabilité : la livraison annulée reste documentée dans les entrées
            // RESTAURE- (commande, client, BL, date), et son n° de BL n'est jamais réattribué.
            const client = (DB.get('clients') || []).find(c => c.id === cmd.clientId);
            const bl = (DB.get('livraisons') || []).find(l => l.commandeId === id);
            const contexteLivraison = {
                commandeId: cmd.id,
                commandeNumero: getCommandeNumero(cmd),
                clientId: cmd.clientId || '',
                clientNom: getClientLabelForTrace(client, cmd.clientLivraison),
                numeroBL: bl?.numeroBL || cmd.numeroBL || '',
                dateLivraison: cmd.dateLivraisonEffective || cmd.dateLivraison || ''
            };

            lotsUtilises.forEach(entry => {
                const existingLot = lots.find(l => String(l.id) === String(entry.lotId));
                if (existingLot) {
                    existingLot.quantite = (existingLot.quantite || 0) + entry.quantite;
                } else {
                    // Recréer le lot supprimé
                    const prodEntry = history.find(h => String(h.lotId) === String(entry.lotId) && String(h.id).startsWith('PROD-'));
                    const nouveauLot = {
                        id: entry.lotId,
                        numLot: entry.numLot || entry.lotId,
                        arome: entry.arome,
                        format: entry.format,
                        quantite: entry.quantite,
                        dlc: entry.dlc,
                        // Utiliser dlv distant s'il est présent (v11 transaction), fallback sur dlc (legacy)
                        dlv: entry.dlv || entry.dlc,
                        // Utiliser dateProduction distante si présente, fallback sur history
                        dateProduction: entry.dateProduction || (prodEntry ? (prodEntry.productionDate || '') : '')
                    };
                    lots.push(nouveauLot);
                }

                newHistoryEntries.push(buildLotHistoryEntry('RESTAURE', {
                    id: entry.lotId,
                    numLot: entry.numLot,
                    arome: entry.arome,
                    format: entry.format,
                    dateProduction: entry.dateProduction || '',
                    dlv: entry.dlv,
                    dlc: entry.dlc
                }, entry.quantite, contexteLivraison));
            });

            DB.set('lots', lots);

            cmd.lotsUtilises = [];
            delete cmd.dateLivraisonEffective;
            delete cmd.clientLivraison;
            delete cmd.numeroBL;
            DB.set('commandes', commandes);

            deleteBLForCommande(id);

            history.unshift(...newHistoryEntries);
            DB.set('history', history);
        }

        updateCommandeStatut(id, estLivree ? 'produite' : 'en_attente');
        modal.hide();
        showToast(estLivree ? 'Commande restaurée — stock restitué et BL supprimé' : 'Commande restaurée');
    });
};

// =============================================================================
// Transaction atomique de livraison — multi-documents Firestore
// =============================================================================
// Exécute UNE transaction Firestone pour :
//  1. Lire la commande (exiger existence + statut « produite »)
//  2. Lire chaque lot alloué (exiger stock, DLC, arome/format)
//  3. Écrire commande → « livrée » avec lotsUtilises
//  4. Mettre à jour ou supprimer les lots
//  Toute divergence annule la transaction sans modifier aucun document.
//
// allocations attend : [{ lotId, quantite, expectedArome, expectedFormat }]
// Les quantités sont agrégées en interne par lotId pour éviter double décrément.
const deliverCommandeTransaction = async (commandeId, allocations) => {
    // --- Guardes : exiger Firebase prêt, V11 prêt, authentifié ---
    if (!window.firebaseReady || !window.firebaseDb || !window.firebaseApi) {
        throw new Error(
            'Connexion requise pour garantir le stock. ' +
            'Vérifiez votre connexion internet et réessayez. Aucune donnée locale n\'a été modifiée.'
        );
    }
    if (!V11._isReady) {
        throw new Error(
            'La synchronisation collaborative n\'est pas encore prête. ' +
            'Veuillez patienter quelques instants puis réessayer.'
        );
    }
    if (!window.firebaseAuth) {
        throw new Error(
            'Authentification requise. Veuillez vous connecter puis réessayer.'
        );
    }
    if (typeof window.firebaseAuth.isAuthenticated === 'function'
            ? !window.firebaseAuth.isAuthenticated()
            : !window.firebaseReady) {
        throw new Error(
            'Session expirée. Veuillez vous reconnecter puis réessayer la livraison. ' +
            'Aucune donnée locale n\'a été modifiée.'
        );
    }

    // --- Guarde réseau : refus immédiat si offline ---
    if (navigator.onLine === false) {
        throw new Error(
            'Vous êtes hors ligne. La livraison nécessite une connexion réseau ' +
            'pour garantir l\'intégrité du stock. Réessayez une fois connecté. ' +
            'Aucune donnée locale n\'a été modifiée.'
        );
    }

    // --- Guarde file d'attente : flusher + vérifier aucune op pendante ne cible commande/lots ---
    await v11FlushQueue();
    const queue = v11GetQueue();
    const allLotIds = new Set(allocations.map(a => a.lotId));
    const pendingOps = queue.filter(op =>
        (op.table === 'commandes' && op.recordId === commandeId) ||
        (op.table === 'lots' && allLotIds.has(op.recordId))
    );
    if (pendingOps.length > 0) {
        throw new Error(
            `Des modifications locales sont encore en attente de synchronisation ` +
            `(${pendingOps.length} opération(s) sur la commande ou les lots). ` +
            'Veuillez attendre la fin de la synchronisation puis réessayer. ' +
            'Aucune donnée n\'a été modifiée.'
        );
    }

    const normalize = (s) => (s || '').toString().toLowerCase().trim();
    const { runTransaction } = window.firebaseApi;
    const txVersion = Date.now();
    const now = new Date().toISOString();
    // Instantané du destinataire au moment de la livraison (traçabilité : survit
    // à une modification ou à une suppression ultérieure du client)
    const clientsLocaux = DB.get('clients') || [];

    // Agrégation par lot (pour décrément) + par itemKey (pour validation articles)
    // ET vérification qu'un même lot ne sert pas deux couples (arome,format) incompatibles
    const lotsAgg = new Map();  // lotId → { totalQty, aromes: Set, formats: Set }
    const itemAgg = new Map();  // itemKey → totalQty

    for (const a of allocations) {
        // Cumul par article
        itemAgg.set(a.itemKey, (itemAgg.get(a.itemKey) || 0) + a.quantite);

        // Cumul par lot + suivi des arome/format
        if (!lotsAgg.has(a.lotId)) {
            lotsAgg.set(a.lotId, { totalQty: 0, aromes: new Set(), formats: new Set() });
        }
        const la = lotsAgg.get(a.lotId);
        la.totalQty += a.quantite;
        la.aromes.add(normalize(a.expectedArome));
        la.formats.add(normalize(a.expectedFormat));
    }

    // Vérification : un lot ne doit servir qu'à un seul couple (arome, format)
    for (const [lotId, la] of lotsAgg) {
        if (la.aromes.size > 1 || la.formats.size > 1) {
            throw new Error(
                `Le lot #${formatLotNumero(lotId)} est alloué à des articles incompatibles ` +
                '(arômes ou formats différents). Corrigez les allocations et réessayez.'
            );
        }
    }

    // Transaction Firestore multi-documents
    const result = await runTransaction(window.firebaseDb, async (transaction) => {
        // --- 1. Lecture et validation de la commande distante ---
        const cmdRef = v11GetRecordRef('commandes', commandeId);
        const cmdSnap = await transaction.get(cmdRef);
        if (!cmdSnap.exists()) {
            throw new Error('Commande introuvable sur le serveur. Livraison annulée.');
        }
        const cmdData = cmdSnap.data();
        const commande = cmdData && cmdData.record;
        if (!commande || commande.statut !== 'produite') {
            throw new Error(
                'Cette commande a déjà été livrée ou son statut a changé. ' +
                'Aucune modification effectuée. Rechargez la page et vérifiez l\'état de la commande.'
            );
        }

        // --- 2. Validation des ARTICLES distants : totaux alloués ≈ totaux commandés ---
        const remoteItems = getItems(commande);
        const remoteItemsMap = new Map(); // "aromeId|formatId" → quantite total
        for (const item of remoteItems) {
            const key = `${item.aromeId}|${item.formatId}`;
            remoteItemsMap.set(key, (remoteItemsMap.get(key) || 0) + Number(item.quantite));
        }

        // Vérifier que chaque article alloué existe dans la commande distante avec le bon total
        for (const [itemKey, allocatedQty] of itemAgg) {
            const remoteQty = remoteItemsMap.get(itemKey);
            if (remoteQty === undefined) {
                throw new Error(
                    `L'article (${itemKey}) a été retiré de la commande distante. Livraison annulée.`
                );
            }
            if (allocatedQty !== remoteQty) {
                throw new Error(
                    `Quantité allouée incorrecte pour l'article (${itemKey}) : ` +
                    `alloué ${allocatedQty}, requis ${remoteQty} d'après la commande distante. ` +
                    'Livraison annulée.'
                );
            }
        }
        // Vérifier qu'aucun article distant n'est oublié
        for (const [itemKey, remoteQty] of remoteItemsMap) {
            const allocatedQty = itemAgg.get(itemKey) || 0;
            if (allocatedQty !== remoteQty) {
                throw new Error(
                    `L'article (${itemKey}) est absent ou mal alloué dans cette livraison ` +
                    `(alloué ${allocatedQty}, requis ${remoteQty} d'après la commande distante). ` +
                    'Livraison annulée.'
                );
            }
        }

        // --- 3. Lecture et validation de chaque lot distant ---
        const lotsUtilises = [];
        const updatedLots = [];

        for (const [lotId, la] of lotsAgg) {
            const lotRef = v11GetRecordRef('lots', lotId);
            const lotSnap = await transaction.get(lotRef);
            if (!lotSnap.exists()) {
                throw new Error(
                    `Lot introuvable sur le serveur (#${formatLotNumero(lotId)}). ` +
                    'La commande n\'a pas été modifiée.'
                );
            }
            const lotData = lotSnap.data();
            const lot = lotData && lotData.record;
            if (!lot) {
                throw new Error(
                    `Données de lot corrompues (#${formatLotNumero(lotId)}). Livraison annulée.`
                );
            }

            // Vérification arome/format depuis les données DISTANTES
            const remoteNorm = normalize(lot.arome) + '|' + normalize(lot.format);
            const expectedNorm = [...la.aromes][0] + '|' + [...la.formats][0];
            if (remoteNorm !== expectedNorm) {
                throw new Error(
                    `Le lot #${formatLotNumero(lot.numLot || lotId)} ne correspond plus à l'article commandé ` +
                    `(attendu « ${expectedNorm} », trouvé « ${remoteNorm} » à distance). Livraison annulée.`
                );
            }

            // Lot bloqué (rappel, suspicion qualité) — jamais livrable
            if (lot.bloque) {
                throw new Error(
                    `Le lot #${formatLotNumero(lot.numLot || lotId)} est bloqué` +
                    `${lot.motifBlocage ? ` (${lot.motifBlocage})` : ''}. Livraison annulée.`
                );
            }

            // Vérification DLV (Date Limite de Vente) — si présente
            const today = dateOnly(new Date());
            if (lot.dlv) {
                const dlvDate = dateOnly(lot.dlv);
                if (Number.isNaN(dlvDate.getTime()) || dlvDate < today) {
                    throw new Error(
                        `Le lot #${formatLotNumero(lot.numLot || lotId)} a une DLV expirée ` +
                        `(${lot.dlv}). Livraison annulée.`
                    );
                }
            }

            // Vérification DLC (Date Limite de Consommation)
            if (!lot.dlc) {
                throw new Error(
                    `Le lot #${formatLotNumero(lot.numLot || lotId)} n'a pas de DLC ` +
                    'et ne peut pas être livré.'
                );
            }
            const dlcDate = dateOnly(lot.dlc);
            if (Number.isNaN(dlcDate.getTime()) || dlcDate < today) {
                throw new Error(
                    `Le lot #${formatLotNumero(lot.numLot || lotId)} a une DLC expirée ` +
                    `(${lot.dlc}). Livraison annulée.`
                );
            }

            // Vérification stock suffisant depuis les données DISTANTES
            const disponible = Number(lot.quantite);
            if (!Number.isFinite(disponible) || disponible < la.totalQty) {
                throw new Error(
                    `Stock insuffisant sur le lot #${formatLotNumero(lot.numLot || lotId)} : ` +
                    `disponible ${disponible}, requis ${la.totalQty}. Livraison annulée.`
                );
            }

            lotsUtilises.push({
                lotId: lot.id,
                numLot: lot.numLot || lot.id,
                arome: lot.arome,
                format: lot.format,
                dateProduction: lot.dateProduction || '',
                dlv: lot.dlv || '',
                dlc: lot.dlc || '',
                quantite: la.totalQty
            });
            updatedLots.push({ ref: lotRef, lot, newQty: disponible - la.totalQty });
        }

        // --- 4. Écriture de la commande livrée ---
        const clientLocal = clientsLocaux.find(c => c.id === commande.clientId);
        const updatedCommande = {
            ...commande,
            statut: 'livrée',
            lotsUtilises,
            dateLivraisonEffective: now
        };
        if (clientLocal) {
            updatedCommande.clientLivraison = {
                societe: clientLocal.societe || '',
                nom: clientLocal.nom || '',
                adresse: clientLocal.adresse || '',
                npa: clientLocal.npa || '',
                coord: clientLocal.coord || ''
            };
        }
        transaction.set(cmdRef, {
            record: updatedCommande,
            updatedAt: now,
            _version: txVersion
        });

        // --- 5. Écriture / suppression de chaque lot ---
        for (const { ref, lot, newQty } of updatedLots) {
            if (newQty <= 0) {
                transaction.delete(ref);
            } else {
                transaction.set(ref, {
                    record: { ...lot, quantite: newQty },
                    updatedAt: now,
                    _version: txVersion + 1
                });
            }
        }

        return {
            updatedCommande,
            lotsUtilises,
            lotResults: updatedLots.map(u => ({
                lotId: u.lot.id,
                numLot: u.lot.numLot || u.lot.id,
                newQty: u.newQty
            }))
        };
    });

    // --- Réconciliation immédiate du localStorage / versions ---
    // (sans passer par DB.set, sans enqueue de doublons)

    // Met à jour la commande dans le cache local
    const allCommandes = DB.get('commandes');
    const cmdIdx = allCommandes.findIndex(c => c.id === commandeId);
    if (cmdIdx !== -1) {
        allCommandes[cmdIdx] = result.updatedCommande;
    }
    DB._applyRemoteSnapshot('commandes', allCommandes);

    // Met à jour les versions commande
    if (!V11._versions['commandes']) V11._versions['commandes'] = {};
    V11._versions['commandes'][commandeId] = txVersion;

    // Met à jour / supprime les lots dans le cache local
    const allLots = DB.get('lots');
    for (const info of result.lotResults) {
        const lotIdx = allLots.findIndex(l => String(l.id) === String(info.lotId));
        if (lotIdx !== -1) {
            if (info.newQty <= 0) {
                allLots.splice(lotIdx, 1);
            } else {
                allLots[lotIdx].quantite = info.newQty;
            }
        }
    }
    DB._applyRemoteSnapshot('lots', allLots);

    // Met à jour les versions lots
    if (!V11._versions['lots']) V11._versions['lots'] = {};
    for (const info of result.lotResults) {
        if (info.newQty <= 0) {
            delete V11._versions['lots'][info.lotId];
        } else {
            V11._versions['lots'][info.lotId] = txVersion + 1;
        }
    }
    v11SaveVersions();

    return result.lotsUtilises;
};

const showLivraisonBouteillesModal = (commandeId) => {
    const commandes = DB.get('commandes') || [];
    const lots = DB.get('lots') || [];
    const aromes = DB.get('aromes') || [];
    const formats = DB.get('formats') || [];
    const clients = DB.get('clients') || [];

    const cmd = commandes.find(c => c.id === commandeId);
    if (!cmd) {
        showToast('Commande non trouvée', 'error');
        return;
    }
    if (cmd.statut !== 'produite') {
        showToast('Seule une commande produite peut être livrée', 'error');
        return;
    }

    const client = clients.find(cl => cl.id === cmd.clientId);
    const clientName = client ? (client.societe || client.nom) : 'N/A';
    const totalItems = (cmd.items || []).reduce((sum, i) => sum + i.quantite, 0);

    const normalize = (s) => (s || '').toString().toLowerCase().trim();

    const sortedLots = [...lots]
        .filter(lot => isLotSellable(lot))
        .sort((a, b) => new Date(a.dateProduction || '1970-01-01') - new Date(b.dateProduction || '1970-01-01'));

    const lignesHtml = getItems(cmd).map(item => {
        const arome = aromes.find(a => a.id === item.aromeId);
        const format = formats.find(f => f.id === item.formatId);
        const aromeNom = arome?.nom || '?';
        const formatNom = format?.nom || '?';
        const aromeNorm = normalize(aromeNom);
        const formatNorm = normalize(formatNom);

        const lotsDisponibles = sortedLots.filter(lot =>
            normalize(lot.arome) === aromeNorm &&
            normalize(lot.format) === formatNorm &&
            lot.quantite > 0
        );

        const lotsRow = lotsDisponibles.length === 0
            ? `<em class="text-muted">Aucun lot disponible</em>`
            : lotsDisponibles.map(lot => {
                return `<div class="flex-between" style="padding: 4px 0;">
                    <span style="font-size: 12px;">#${escapeHtml(formatLotNumero(getLotNumero(lot)))} — ${escapeHtml(lot.arome)} ${escapeHtml(lot.format)} <em style="color: var(--text-muted);">(Stock: ${escapeHtml(String(lot.quantite))})</em></span>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <input type="number" class="lot-qty-input" data-lot="${escapeHtml(lot.id)}" data-item="${escapeHtml(item.aromeId)}|${escapeHtml(item.formatId)}" value="0" min="0" max="${Number.isFinite(lot.quantite) ? lot.quantite : 0}" style="width: 60px;">
                        <span style="font-size: 12px; color: var(--text-muted);">/ ${escapeHtml(String(lot.quantite))}</span>
                    </div>
                </div>`;
            }).join('');

        const itemKey = `${item.aromeId}|${item.formatId}`;
        const filledTotal = 0;
        const totalId = `item-total-${itemKey}`.replace(/[^a-zA-Z0-9]/g, '_');

        return `<div style="margin-bottom: 16px; padding: 12px; background: var(--bg-secondary); border-radius: var(--radius);">
            <div class="flex-between" style="margin-bottom: 8px;">
                <strong>${escapeHtml(aromeNom)} ${escapeHtml(formatNom)}</strong>
                <span style="color: var(--text-muted); font-size: 12px;">${escapeHtml(String(item.quantite))} commandées</span>
            </div>
            <div id="${totalId}" class="item-total-display" data-required="${Number.isFinite(item.quantite) ? item.quantite : 0}">
                <span style="font-size: 12px;">Alloué: <strong id="${totalId}-count">${escapeHtml(String(filledTotal))}</strong> / ${escapeHtml(String(item.quantite))}</span>
            </div>
            <div style="margin-top: 8px;">${lotsRow}</div>
        </div>`;
    }).join('');

    const validateAndDeliver = async () => {
        const inputs = document.querySelectorAll('.lot-qty-input');
        const allocations = {};
        const allocationsParLot = new Map();
        let allocationInvalide = false;

        inputs.forEach(input => {
            const valeur = input.value.trim();
            const quantite = valeur === '' ? 0 : Number(valeur);
            const maximum = Number(input.max);
            const lotId = String(input.dataset.lot || '');
            const itemKey = input.dataset.item || '';

            if (!Number.isInteger(quantite) || quantite < 0 || !Number.isInteger(maximum) || maximum < 0 || quantite > maximum) {
                allocationInvalide = true;
                return;
            }
            if (quantite === 0) return;
            if (!lotId || !itemKey) {
                allocationInvalide = true;
                return;
            }

            if (!allocations[itemKey]) allocations[itemKey] = [];
            allocations[itemKey].push({ lotId, quantite });
            allocationsParLot.set(lotId, (allocationsParLot.get(lotId) || 0) + quantite);
        });

        if (allocationInvalide) {
            showToast('Les quantités allouées doivent être des entiers compris dans le stock disponible', 'error');
            return;
        }

        const commandesActuelles = DB.get('commandes') || [];
        const cmdIndex = commandesActuelles.findIndex(c => c.id === commandeId);
        const commandeActuelle = commandesActuelles[cmdIndex];
        if (!commandeActuelle || commandeActuelle.statut !== 'produite') {
            showToast('Cette commande ne peut plus être livrée', 'error');
            return;
        }

        const itemsCommande = getItems(commandeActuelle);
        if (itemsCommande.length === 0) {
            showToast('La commande ne contient aucun article à livrer', 'error');
            return;
        }

        for (const item of itemsCommande) {
            const quantiteDemandee = Number(item.quantite);
            if (!Number.isInteger(quantiteDemandee) || quantiteDemandee <= 0) {
                showToast('La commande contient une quantité invalide', 'error');
                return;
            }

            const key = `${item.aromeId}|${item.formatId}`;
            const alloue = allocations[key]?.reduce((s, allocation) => s + allocation.quantite, 0) || 0;
            if (alloue !== quantiteDemandee) {
                const arome = aromes.find(a => a.id === item.aromeId);
                const format = formats.find(f => f.id === item.formatId);
                showToast(`Quantité incorrecte pour ${arome?.nom || '?'} ${format?.nom || '?'} : alloué ${alloue} / ${quantiteDemandee}`, 'error');
                return;
            }
        }

        const allLots = DB.get('lots') || [];
        const lotsParId = new Map(allLots.map(lot => [String(lot.id), lot]));
        for (const [itemKey, group] of Object.entries(allocations)) {
            const [aromeId, formatId] = itemKey.split('|');
            const arome = aromes.find(item => item.id === aromeId);
            const format = formats.find(item => item.id === formatId);
            const aromeAttendu = normalize(arome?.nom || aromeId);
            const formatAttendu = normalize(format?.nom || formatId);

            for (const { lotId } of group) {
                const lot = lotsParId.get(String(lotId));
                if (!lot || normalize(lot.arome) !== aromeAttendu || normalize(lot.format) !== formatAttendu) {
                    showToast('Un lot alloué ne correspond pas à l\'article commandé', 'error');
                    return;
                }
            }
        }
        for (const [lotId, quantite] of allocationsParLot) {
            const lot = lotsParId.get(lotId);
            const disponible = Number(lot?.quantite);
            if (!lot || !isLotSellable(lot) || !Number.isFinite(disponible) || disponible < quantite) {
                showToast(`Lot indisponible ou stock insuffisant sur #${formatLotNumero(lot ? getLotNumero(lot) : lotId)}. Livraison non effectuée.`, 'error');
                return;
            }
        }

        // --- Validation locale réussie → exécution atomique distante ---

        // État busy : désactiver le bouton Confirmer (anti-double-clic)
        const btn = document.getElementById('confirm-livraison-btn');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Livraison en cours…';
        }

        try {
            // Construire le tableau d'allocations pour la transaction
            // Chaque entrée porte l'itemKey (aromeId|formatId) pour la validation distante des articles
            const allocationsForTx = [];
            for (const [itemKey, group] of Object.entries(allocations)) {
                const [aromeId, formatId] = itemKey.split('|');
                const arome = aromes.find(a => a.id === aromeId);
                const format = formats.find(f => f.id === formatId);
                const expectedArome = arome?.nom || aromeId;
                const expectedFormat = format?.nom || formatId;
                for (const { lotId, quantite } of group) {
                    allocationsForTx.push({ lotId, quantite, itemKey, expectedArome, expectedFormat });
                }
            }

            // UNE transaction Firestore multi-documents atomique
            await deliverCommandeTransaction(commandeId, allocationsForTx);

            // Succès
            modal.hide();
            showToast('Commande livrée et stock déduit avec succès');

            // Prompt de génération BL (préservé)
            confirmDialog('Générer un bulletin de livraison maintenant ?').then(ok => {
                if (!ok) return;
                prepareCommandeBLExport(commandeId);
            });
        } catch (e) {
            console.error('Échec de la transaction de livraison :', e);
            // Détecter les erreurs réseau Firebase pour message utilisateur clair
            const isNetworkError = e && (
                e.code === 'unavailable' ||
                e.code === 'deadline-exceeded' ||
                /firestore.*(network|unavailable|timeout)/i.test(e.message || '') ||
                /ERR_NETWORK|ERR_CONNECTION|fetch/i.test(e.message || '')
            );
            const isAuthError = e && (e.code === 'permission-denied' || e.code === 'unauthenticated');
            const isConcurrencyError = e && (e.code === 'aborted' || e.code === 'failed-precondition');
            if (isAuthError) {
                showToast(
                    'Session expirée ou refusée par le serveur. ' +
                    'Veuillez vous reconnecter puis réessayer la livraison. ' +
                    'Aucun stock n\'a été déduit.',
                    'error'
                );
            } else if (isConcurrencyError) {
                showToast(
                    'La commande ou les lots ont été modifiés sur un autre appareil. ' +
                    'Rechargez la page et réessayez. Aucun stock n\'a été déduit.',
                    'error'
                );
            } else if (isNetworkError) {
                showToast(
                    'Erreur réseau : la transaction n\'a pas pu aboutir. ' +
                    'Vérifiez votre connexion et réessayez. Aucun stock n\'a été déduit.',
                    'error'
                );
            } else {
                showToast(e.message || 'Erreur lors de la livraison. Aucune modification effectuée.', 'error');
            }
            // Restaurer le bouton en cas d'échec
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Confirmer la livraison';
            }
        }
    };

    const inputsByItemKey = () => {
        const all = Array.from(document.querySelectorAll('.lot-qty-input'));
        const map = {};
        for (const inp of all) {
            const key = inp.dataset.item;
            if (key === undefined) continue;
            if (!map[key]) map[key] = [];
            map[key].push(inp);
        }
        return map;
    };

    const computeTotals = () => {
        let totalAlloueGlobal = 0;
        let ecarts = 0;
        const byKey = inputsByItemKey();
        for (const [itemKey, itemInputs] of Object.entries(byKey)) {
            const total = itemInputs.reduce((s, inp) => s + (parseInt(inp.value, 10) || 0), 0);
            const totalEl = document.getElementById(`item-total-${itemKey}`.replace(/[^a-zA-Z0-9]/g, '_') + '-count');
            if (totalEl) totalEl.textContent = total;
        }
        getItems(cmd).forEach(item => {
            const itemKey = `${item.aromeId}|${item.formatId}`;
            const itemInputs = byKey[itemKey] || [];
            const total = itemInputs.reduce((s, inp) => s + (parseInt(inp.value, 10) || 0), 0);
            totalAlloueGlobal += total;
            if (total !== item.quantite) ecarts++;
        });
        const totalEl = document.getElementById('livraison-total-alloue');
        const ecartsEl = document.getElementById('livraison-ecarts');
        if (totalEl) totalEl.textContent = totalAlloueGlobal;
        if (ecartsEl) ecartsEl.textContent = ecarts === 0 ? 'Aucun écart' : `${ecarts} écart(s)`;
    };

    modal.show(`Livrer commande #${getCommandeNumero(cmd)} — ${clientName}`, `
        <div style="max-height: 65vh; overflow-y: auto;">
            <div class="workflow-summary">
                <div><span>Client</span><strong>${escapeHtml(clientName)}</strong></div>
                <div><span>Commandé</span><strong>${totalItems}</strong></div>
                <div><span>Alloué</span><strong id="livraison-total-alloue">0</strong></div>
                <div><span>Écarts</span><strong id="livraison-ecarts">Calcul...</strong></div>
            </div>
            ${lignesHtml}
        </div>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Annuler</button>
        <button class="btn btn-success" id="confirm-livraison-btn">Confirmer la livraison</button>
    `, 'large');

    document.querySelectorAll('.lot-qty-input').forEach(input => {
        input.addEventListener('input', computeTotals);
    });

    document.getElementById('confirm-livraison-btn')?.addEventListener('click', validateAndDeliver);
    computeTotals();
};

const checkStockAndUpdateCommandes = () => {
    const commandes = DB.get('commandes') || [];
    const lots = DB.get('lots') || [];
    const formats = DB.get('formats') || [];
    const aromes = DB.get('aromes') || [];
    const now = new Date();
    const stockPool = createStockPool(lots, now);
    let updatedCount = 0;

    const commandesTriees = sortCommandesByDateLivraison(commandes);
    const updatedCommandes = [...commandes];

    commandesTriees.forEach(({ commande: cmd, index }) => {
        if (cmd.statut !== 'en_attente') return;

        const needed = {};
        let canProduce = getItems(cmd).length > 0;
        getItems(cmd).forEach(item => {
            const quantite = Number(item.quantite);
            if (!Number.isInteger(quantite) || quantite <= 0) {
                canProduce = false;
                return;
            }
            const format = formats.find(f => f.id === item.formatId);
            const arome = aromes.find(a => a.id === item.aromeId);
            const aromeName = arome?.nom || item.aromeId;
            const formatName = format?.nom || item.formatId;
            const key = `${aromeName}-${formatName}`;
            if (!needed[key]) needed[key] = 0;
            needed[key] += quantite;
        });

        Object.entries(needed).forEach(([key, qty]) => {
            if (stockPool.available(key, cmd.dateLivraison) < qty) canProduce = false;
        });

        if (canProduce) {
            Object.entries(needed).forEach(([key, qty]) => {
                stockPool.take(key, qty, cmd.dateLivraison);
            });
            updatedCount++;
            updatedCommandes[index] = { ...cmd, statut: 'produite' };
        }
    });

    if (updatedCount > 0) {
        DB.set('commandes', updatedCommandes);
    }
    renderCommandes();

    if (updatedCount > 0) {
        showToast(`${updatedCount} commande(s) mise(s) en production`);
    } else {
        showToast('Aucune commande à mettre en production');
    }
};

const showCommandeDetails = (id) => {
    const commandes = DB.get('commandes');
    const clients = DB.get('clients');
    const aromes = DB.get('aromes');
    const formats = DB.get('formats');

    const commande = commandes.find(c => c.id === id);
    if (!commande) return;

    const client = clients.find(c => c.id === commande.clientId);
    const clientName = client ? (client.societe || client.nom) : 'N/A';

    const itemsHtml = getItems(commande).map(item => {
        const arome = aromes.find(a => a.id === item.aromeId);
        const format = formats.find(f => f.id === item.formatId);
        return `<tr>
            <td>${escapeHtml(arome?.nom || '?')}</td>
            <td>${escapeHtml(format?.nom || '?')}</td>
            <td>${escapeHtml(String(item.quantite))}</td>
        </tr>`;
    }).join('');

    const lotsUtilisesHtml = commande.lotsUtilises && commande.lotsUtilises.length > 0
        ? commande.lotsUtilises.map(lot => `
            <tr>
                <td><a href="#" style="color: var(--primary); font-weight: 600;" data-click="show-lot-trace" data-id="${escapeHtml(String(lot.lotId))}" data-prevent>#${escapeHtml(formatLotNumero(lot.numLot || lot.lotId))}</a></td>
                <td>${escapeHtml(lot.arome)}</td>
                <td>${escapeHtml(lot.format)}</td>
                <td>${escapeHtml(String(lot.quantite))}</td>
            </tr>
        `).join('')
        : '';

    const livraisons = DB.get('livraisons') || [];
    const livraison = livraisons.find(l => l.commandeId === id);

    const totalItems = (commande.items || []).reduce((sum, i) => sum + i.quantite, 0);

    const modalTitle = `Commande #${getCommandeNumero(commande)}`;
    const modalBody = `
        <div class="commande-details">
            <p><strong>Client:</strong> ${escapeHtml(clientName)}</p>
            <p><strong>Date commande:</strong> ${formatDate(commande.dateCommande)}</p>
            <p><strong>Date livraison:</strong> ${formatDate(commande.dateLivraison)}</p>
            ${commande.dateLivraisonEffective ? `<p><strong>Livrée le:</strong> ${formatDateTime(commande.dateLivraisonEffective)}</p>` : ''}
            <p><strong>Statut:</strong> ${escapeHtml(getCommandeStatutLabel(commande.statut))}</p>
            ${renderStepTracker(commande.statut)}
            <p><strong>Total:</strong> ${totalItems} articles</p>
            <table class="details-table">
                <thead>
                    <tr>
                        <th>Arôme</th>
                        <th>Format</th>
                        <th>Quantité</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHtml}
                </tbody>
            </table>
            ${lotsUtilisesHtml ? `
            <h4 style="margin-top:20px;">Lots utilisés</h4>
            <table class="details-table">
                <thead>
                    <tr>
                        <th>Lot</th>
                        <th>Arôme</th>
                        <th>Format</th>
                        <th>Quantité</th>
                    </tr>
                </thead>
                <tbody>
                    ${lotsUtilisesHtml}
                </tbody>
            </table>
            ` : ''}
        </div>
    `;

    let actionsHtml = `<button class="btn btn-secondary" onclick="modal.hide()">Fermer</button>`;
    if (commande.statut === 'en_attente') {
        actionsHtml = `<button class="btn btn-secondary" data-click="edit-commande" data-id="${escapeHtml(id)}">Modifier</button>`
            + `<button class="btn btn-secondary" data-click="duplicate-commande" data-id="${escapeHtml(id)}">Dupliquer</button>`
            + `<button class="btn btn-success" data-click="marquer-commande-produite" data-id="${escapeHtml(id)}">Marquer produite</button>`
            + `<button class="btn btn-danger" data-click="confirm-annuler-commande" data-id="${escapeHtml(id)}">Annuler la commande</button>` + actionsHtml;
    } else if (commande.statut === 'produite') {
        actionsHtml = `<button class="btn btn-secondary" data-click="edit-commande" data-id="${escapeHtml(id)}">Modifier</button>`
            + `<button class="btn btn-secondary" data-click="duplicate-commande" data-id="${escapeHtml(id)}">Dupliquer</button>`
            + `<button class="btn btn-success" data-click="livrer-commande" data-id="${escapeHtml(id)}">Livrer</button>`
            + `<button class="btn btn-danger" data-click="confirm-annuler-commande" data-id="${escapeHtml(id)}">Annuler la commande</button>` + actionsHtml;
    } else if (commande.statut === 'livrée') {
        actionsHtml = `<button class="btn btn-secondary" data-click="commande-bl" data-id="${escapeHtml(id)}">Bulletin de livraison</button>`
            + `<button class="btn btn-secondary" data-click="duplicate-commande" data-id="${escapeHtml(id)}">Dupliquer</button>`
            + `<button class="btn btn-secondary" data-click="restaurer-commande" data-id="${escapeHtml(id)}">Restaurer</button>` + actionsHtml;
    } else if (commande.statut === 'annulee') {
        actionsHtml = `<button class="btn btn-secondary" data-click="restaurer-commande" data-id="${escapeHtml(id)}">Restaurer</button>` + actionsHtml;
    }
    modal.show(modalTitle, modalBody, actionsHtml);
};

const deleteCommande = (id) => {
    confirmDialog('Êtes-vous sûr de vouloir supprimer cette commande ?', { danger: true }).then(ok => {
        if (!ok) return;
        const commandes = DB.get('commandes').filter(c => c.id !== id);
        DB.set('commandes', commandes);
        showToast('Commande supprimée');
        renderCommandes();
    });
};

const togglePillStatut = (statut) => {
    const current = DB.getFilter('statut') || '';
    DB.setFilter('statut', current === statut ? '' : statut);
    renderCommandes();
};

const confirmAnnulerCommande = (id) => {
    confirmDialog('Annuler définitivement cette commande ? Le bulletin de livraison associé sera supprimé.', { danger: true, confirmLabel: 'Annuler la commande' }).then(ok => {
        if (!ok) return;
        updateCommandeStatut(id, 'annulee');
        modal.hide();
        showToast('Commande annulée');
    });
};

const duplicateCommande = (id) => {
    const commandes = DB.get('commandes') || [];
    const original = commandes.find(c => c.id === id);
    if (!original) return;
    // Rien n'est enregistré ici : la copie n'existe qu'au clic sur Enregistrer
    modal.hide();
    showCommandeModal(null, {
        clientId: original.clientId,
        items: (original.items || []).map(i => ({ ...i }))
    });
};

const toggleArchives = () => {
    const showArchives = localStorage.getItem('thecol_show_archives') === 'true';
    localStorage.setItem('thecol_show_archives', showArchives ? 'false' : 'true');
    renderCommandes();
};

// Archives : commandes livrées/annulées filtrées par année, client et statut (filtres persistés)
const getArchivesFiltrees = (commandes) => {
    const savedFilterYear = DB.getFilter('archive_year');
    const savedFilterClient = DB.getFilter('archive_client');
    const savedFilterStatut = DB.getFilter('archive_statut') || '';
    return commandes.filter(c => {
        const year = c.dateCommande ? c.dateCommande.substring(0, 4) : '2024';
        const matchesYear = !savedFilterYear || year === savedFilterYear;
        const matchesClient = !savedFilterClient || c.clientId === savedFilterClient;
        const matchesStatut = !savedFilterStatut || c.statut === savedFilterStatut;
        return matchesYear && matchesClient && matchesStatut;
    });
};

const renderArchives = () => {
    const savedFilterYear = DB.getFilter('archive_year');
    const savedFilterClient = DB.getFilter('archive_client');
    const savedFilterStatut = DB.getFilter('archive_statut') || '';

    const commandes = DB.get('commandes').filter(c => c.statut === 'livrée' || c.statut === 'annulee');
    const clients = DB.get('clients') || [];
    const aromes = DB.get('aromes') || [];
    const formats = DB.get('formats') || [];

    const years = [...new Set(commandes.map(c => c.dateCommande ? c.dateCommande.substring(0, 4) : '2024'))].sort().reverse();

    const filteredCommandes = getArchivesFiltrees(commandes);

    let html = `
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Archives des commandes</h3>
                <button class="btn btn-secondary" onclick="exportArchivesExcel()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Exporter Excel
                </button>
            </div>

            <div class="filters">
                <select id="filterArchiveYear" onchange="DB.setFilter('archive_year', this.value); renderArchives()">
                    <option value="">Toutes les années</option>
                    ${years.map(y => `<option value="${y}" ${savedFilterYear === y ? 'selected' : ''}>${y}</option>`).join('')}
                </select>
                <select id="filterArchiveClient" onchange="DB.setFilter('archive_client', this.value); renderArchives()">
                    <option value="">Tous les clients</option>
                    ${clients.filter(c => c.actif).map(c => `<option value="${escapeHtml(c.id)}" ${savedFilterClient === c.id ? 'selected' : ''}>${escapeHtml(c.societe || c.nom)}</option>`).join('')}
                </select>
                <select id="filterArchiveStatut" onchange="DB.setFilter('archive_statut', this.value); renderArchives()">
                    <option value="">Tous les statuts</option>
                    <option value="livrée" ${savedFilterStatut === 'livrée' ? 'selected' : ''}>Livrées</option>
                    <option value="annulee" ${savedFilterStatut === 'annulee' ? 'selected' : ''}>Annulées</option>
                </select>
            </div>

            <div class="table-container" id="archivesTableContainer">
                <table>
                    <thead>
                        <tr>
                            <th>N°</th>
                            <th>Statut</th>
                            <th>Client</th>
                            <th>Date commande</th>
                            <th>Date livraison</th>
                            <th>Articles</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filteredCommandes.length === 0 ? '<tr><td colspan="7" class="text-center">Aucune commande archivée</td></tr>' :
                          filteredCommandes.sort((a, b) => new Date(b.dateCommande) - new Date(a.dateCommande))
                            .map(cmd => {
                                const client = clients.find(cl => cl.id === cmd.clientId);
                                const safeItems = cmd.items || [];
                                const totalItems = safeItems.reduce((sum, i) => sum + i.quantite, 0);
                                const articlesPreview = safeItems.slice(0, 2).map(i => {
                                    const a = aromes.find(a => a.id === i.aromeId);
                                    const f = formats.find(f => f.id === i.formatId);
                                    return escapeHtml(`${i.quantite}x ${a?.nom || '?'} ${f?.nom || '?'}`);
                                }).join(', ');

                                return `
                                    <tr>
                                        <td>${escapeHtml(getCommandeNumero(cmd))}</td>
                                        <td>${cmd.statut === 'annulee' ? '<span class="badge badge-annulee">Annulée</span>' : '<span class="badge badge-livree">Livrée</span>'}</td>
                                        <td>${escapeHtml(client?.societe || client?.nom || 'N/A')}</td>
                                        <td>${formatDate(cmd.dateCommande)}</td>
                                        <td>${formatDate(cmd.dateLivraison)}</td>
                                        <td>${articlesPreview}${safeItems.length > 2 ? '...' : ''} (${totalItems})</td>
                                        <td>
                                            <button class="btn btn-sm btn-secondary" data-click="show-commande-details" data-id="${escapeHtml(cmd.id)}">Détails</button>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    safeRender(html);
};

const exportArchivesExcel = () => {
    // Même filtres (année/client/statut) que ceux affichés dans renderArchives
    const commandes = getArchivesFiltrees(DB.get('commandes').filter(c => c.statut === 'livrée' || c.statut === 'annulee'));
    const clients = DB.get('clients');
    const aromes = DB.get('aromes');
    const formats = DB.get('formats');

    const data = commandes.map(cmd => {
        const client = clients.find(c => c.id === cmd.clientId);
        const items = getItems(cmd).map(item => {
            const a = aromes.find(a => a.id === item.aromeId);
            const f = formats.find(f => f.id === item.formatId);
            return `${item.quantite}x ${a?.nom || '?'} ${f?.nom || '?'}`;
        }).join(', ');

        return {
            'N°': getCommandeNumero(cmd),
            'Statut': cmd.statut === 'annulee' ? 'Annulée' : 'Livrée',
            'Client': client?.societe || client?.nom || 'N/A',
            'Date commande': cmd.dateCommande,
            'Date livraison': cmd.dateLivraison,
            'Articles': items,
            'Total': getItems(cmd).reduce((sum, i) => sum + i.quantite, 0)
        };
    });

    if (typeof XLSX !== 'undefined') {
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Archives');
        XLSX.writeFile(wb, `archives_commandes_${getLocalDateISOString()}.xlsx`);
        showToast('Export Excel réussi');
    } else {
        showToast('Erreur: Bibliothèque Excel non chargée', 'error');
    }
};

const resetLivraisonFilters = () => {
    DB.setFilter('livraison_year', '');
    DB.setFilter('livraison_client', '');
    DB.setFilter('livraison_search', '');
    renderLivraisons();
};

// Livraisons / Bulletins de Livraison
const renderLivraisons = () => {
    const livraisons = DB.get('livraisons') || [];
    const commandes = DB.get('commandes') || [];
    const clients = DB.get('clients') || [];
    const aromes = DB.get('aromes') || [];
    const formats = DB.get('formats') || [];

    const savedFilterYear = DB.getFilter('livraison_year');
    const savedFilterClient = DB.getFilter('livraison_client');
    const savedSearch = DB.getFilter('livraison_search');

    const years = [...new Set(livraisons.map(l => l.dateBL ? l.dateBL.substring(0, 4) : '2024'))].sort().reverse();

    const filteredLivraisons = livraisons.filter(l => {
        const year = l.dateBL ? l.dateBL.substring(0, 4) : '2024';
        const commande = commandes.find(c => c.id === l.commandeId);
        const client = clients.find(cl => cl.id === l.clientId);
        const searchText = [
            `BL-${getBLNumero(l)}`,
            commande ? `#${getCommandeNumero(commande)}` : '',
            client?.societe || '',
            client?.nom || '',
            l.dateBL || '',
            ...(l.lignes || []).map(line => `${line.aromeNom || ''} ${line.formatNom || ''}`),
            ...((l.lotsTraces && l.lotsTraces.length > 0) ? l.lotsTraces : buildLotsTracesForCommande(commande))
                .map(t => `lot ${formatLotNumero(t.numLot || t.lotId)}`)
        ].join(' ').toLowerCase();
        const matchesYear = !savedFilterYear || year === savedFilterYear;
        const matchesClient = !savedFilterClient || l.clientId === savedFilterClient;
        const matchesSearch = !savedSearch || searchText.includes(savedSearch.toLowerCase().trim());
        return matchesYear && matchesClient && matchesSearch;
    });

    let html = `
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Bulletins de Livraison</h3>
            </div>

            <div class="filters">
                <input type="search" id="filterLivraisonSearch" placeholder="Rechercher BL, client, commande, n° de lot..." value="${escapeHtml(savedSearch)}" oninput="DB.setFilter('livraison_search', this.value); window.__focusLivraisonSearch = true; renderLivraisons()">
                <select id="filterLivraisonYear" onchange="DB.setFilter('livraison_year', this.value); renderLivraisons()">
                    <option value="">Toutes les années</option>
                    ${years.map(y => `<option value="${y}" ${savedFilterYear === y ? 'selected' : ''}>${y}</option>`).join('')}
                </select>
                <select id="filterLivraisonClient" onchange="DB.setFilter('livraison_client', this.value); renderLivraisons()">
                    <option value="">Tous les clients</option>
                    ${clients.filter(c => c.actif).map(c => `<option value="${escapeHtml(c.id)}" ${savedFilterClient === c.id ? 'selected' : ''}>${escapeHtml(c.societe || c.nom)}</option>`).join('')}
                </select>
                ${(savedFilterYear || savedFilterClient || savedSearch) ? `<button class="btn btn-sm btn-secondary" onclick="resetLivraisonFilters()">Réinitialiser</button>` : ''}
            </div>

            <div class="livraisons-list">
                ${filteredLivraisons.length === 0 ? '<div class="commande-empty">Aucun bulletin de livraison</div>' :
                  filteredLivraisons.sort((a, b) => new Date(b.dateBL) - new Date(a.dateBL))
                    .map(liv => {
                        const commande = commandes.find(c => c.id === liv.commandeId);
                        const client = clients.find(cl => cl.id === liv.clientId);
                        const totalItems = (liv.lignes || []).reduce((sum, l) => sum + l.quantite, 0);
                        const traceItems = (liv.lotsTraces || []).reduce((sum, l) => sum + (l.quantite || 0), 0);
                        const articlesPreview = (liv.lignes || []).slice(0, 3).map(l => {
                            const a = aromes.find(a => a.id === l.aromeId);
                            const f = formats.find(f => f.id === l.formatId);
                            return `${l.quantite}× ${a?.nom || l.aromeNom || '?'} ${f?.nom || l.formatNom || '?'}`;
                        }).join(' • ');
                        const more = (liv.lignes || []).length > 3 ? ` • +${liv.lignes.length - 3}` : '';
                        const lastExportRaw = getBLLastExportDate(liv);
                        const lastExport = lastExportRaw ? formatDateTime(lastExportRaw) : 'Jamais exporté';

                        return `<div class="commande-card">
                            <div class="commande-card-header">
                                <span class="commande-card-numero">BL-${escapeHtml(String(getBLNumero(liv)))}</span>
                                <span class="commande-card-date">${formatDate(liv.dateBL)}</span>
                            </div>
                            <div class="commande-card-name">${escapeHtml(client?.societe || client?.nom || 'N/A')}</div>
                            <div class="commande-card-items">${escapeHtml(articlesPreview + more)} • ${totalItems} bt</div>
                            <div class="commande-card-footer">
                                <span class="badge ${traceItems > 0 ? 'badge-success' : 'badge-default'}">${traceItems > 0 ? `${traceItems} bt tracées` : 'Non tracé'}</span>
                                <span class="text-muted" style="font-size: 11px;">${escapeHtml(lastExport)}</span>
                            </div>
                            <div class="lot-card-actions" style="margin-top: 10px;">
                                <button class="btn btn-sm btn-secondary" data-click="show-livraison-details" data-id="${escapeHtml(liv.id)}">Détails</button>
                                <button class="btn btn-sm btn-primary" data-click="prepare-bl-export" data-id="${escapeHtml(liv.id)}">Préparer / Exporter</button>
                                <button class="btn btn-sm btn-danger" data-click="delete-livraison" data-id="${escapeHtml(liv.id)}">Supprimer</button>
                            </div>
                        </div>`;
                    }).join('')}
            </div>
        </div>
    `;

    safeRender(html);

    if (window.__focusLivraisonSearch) {
        const input = document.getElementById('filterLivraisonSearch');
        if (input) {
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
        }
        window.__focusLivraisonSearch = false;
    }
};

const showLivraisonDetails = (id) => {
    const livraisons = DB.get('livraisons') || [];
    const clients = DB.get('clients') || [];
    const aromes = DB.get('aromes') || [];
    const formats = DB.get('formats') || [];
    const commandes = DB.get('commandes') || [];

    const livraison = livraisons.find(l => l.id === id);
    if (!livraison) return;

    const client = clients.find(c => c.id === livraison.clientId);
    const commande = commandes.find(c => c.id === livraison.commandeId);

    const lignesHtml = (livraison.lignes || []).map(l => {
        const a = aromes.find(a => a.id === l.aromeId);
        const f = formats.find(f => f.id === l.formatId);
        return `<tr>
            <td>${escapeHtml(a?.nom || l.aromeNom || '?')}</td>
            <td>${escapeHtml(f?.nom || l.formatNom || '?')}</td>
            <td>${l.quantite}</td>
        </tr>`;
    }).join('');

    const lotsTraces = (livraison.lotsTraces && livraison.lotsTraces.length > 0)
        ? livraison.lotsTraces
        : buildLotsTracesForCommande(commande);
    const traceHtml = lotsTraces.map(lot => `
        <tr>
            <td><a href="#" style="color: var(--primary); font-weight: 600;" data-click="show-lot-trace" data-id="${escapeHtml(String(lot.lotId))}" data-prevent>#${escapeHtml(formatLotNumero(lot.numLot || lot.lotId))}</a></td>
            <td>${escapeHtml(lot.arome || '?')}</td>
            <td>${escapeHtml(lot.format || '?')}</td>
            <td>${lot.dlc ? formatDate(lot.dlc) : 'N/A'}</td>
            <td>${lot.quantite || 0}</td>
        </tr>
    `).join('');
    const forcedTraceCount = lotsTraces.filter(lot => lot.forceStockInsuffisant).length;
    const totalItems = (livraison.lignes || []).reduce((sum, l) => sum + l.quantite, 0);
    const totalTrace = lotsTraces.reduce((sum, lot) => sum + (lot.quantite || 0), 0);
    const caissesVertes = parseInt(livraison.caissesVertesLivrees, 10) || 0;
    const caissesNoires = parseInt(livraison.caissesNoiresLivrees, 10) || 0;

    modal.show(`BL #${getBLNumero(livraison)}`, `
        <div class="commande-details">
            <p><strong>Client:</strong> ${escapeHtml(client?.societe || client?.nom || 'N/A')}</p>
            <p><strong>Date BL:</strong> ${formatDate(livraison.dateBL)}</p>
            <p><strong>N° commande:</strong> #${escapeHtml(commande ? getCommandeNumero(commande) : livraison.commandeId.slice(-5))}</p>
            <p><strong>Dernier export:</strong> ${(() => { const d = getBLLastExportDate(livraison); return d ? formatDateTime(d) : 'Jamais exporté'; })()}</p>
            <p><strong>Caisses IFCO:</strong> ${caissesVertes} verte(s), ${caissesNoires} noire(s)</p>
            ${livraison.notes ? `<p><strong>Notes internes:</strong> ${escapeHtml(livraison.notes)}</p>` : ''}
            <p><strong>Total:</strong> ${totalItems} articles</p>
            <table class="details-table">
                <thead>
                    <tr>
                        <th>Arôme</th>
                        <th>Format</th>
                        <th>Quantité</th>
                    </tr>
                </thead>
                <tbody>
                    ${lignesHtml}
                </tbody>
            </table>
            <h4 style="margin-top:20px;">Traçabilité interne</h4>
            ${forcedTraceCount > 0 ? `<p class="badge badge-warning">Alerte interne: ${forcedTraceCount} ligne(s) avec stock insuffisant confirmé.</p>` : ''}
            ${traceHtml ? `
            <p class="text-muted">${totalTrace} bouteille(s) tracée(s) depuis les lots réellement livrés.</p>
            <table class="details-table">
                <thead>
                    <tr>
                        <th>Lot</th>
                        <th>Arôme</th>
                        <th>Format</th>
                        <th>DLC</th>
                        <th>Quantité livrée</th>
                    </tr>
                </thead>
                <tbody>
                    ${traceHtml}
                </tbody>
            </table>
            ` : '<p class="text-muted">Aucune trace de lot enregistrée pour ce BL.</p>'}
        </div>
    `, `
        <button class="btn btn-danger" data-click="delete-livraison" data-id="${escapeHtml(id)}">Supprimer</button>
        <button class="btn btn-secondary" onclick="modal.hide()">Fermer</button>
        <button class="btn btn-primary" data-click="prepare-bl-export" data-id="${escapeHtml(id)}">Préparer / Exporter</button>
    `);
};

const deleteBLForCommande = (commandeId) => {
    const livraisons = DB.get('livraisons') || [];
    const filtered = livraisons.filter(l => l.commandeId !== commandeId);
    if (filtered.length !== livraisons.length) {
        DB.set('livraisons', filtered);
    }
};

const deleteLivraison = (id) => {
    confirmDialog('Êtes-vous sûr de vouloir supprimer ce bulletin de livraison ?', { danger: true }).then(ok => {
        if (!ok) return;
        const livraisons = DB.get('livraisons').filter(l => l.id !== id);
        DB.set('livraisons', livraisons);
        showToast('Bulletin de livraison supprimé');
        renderLivraisons();
    });
};

const getAromeBLName = (nom) => {
    if (!nom) return nom;
    // Look up canonical display name from DB aromes — accepte tout arôme (actif ou inactif)
    const aromes = DB.get('aromes') || [];
    const lower = nom.toLowerCase().trim();
    const found = aromes.find(a => a.nom && a.nom.toLowerCase().trim() === lower);
    return found ? found.nom : nom;
};

const buildLotsTracesForCommande = (commande) => {
    if (!commande || !Array.isArray(commande.lotsUtilises)) return [];
    return commande.lotsUtilises
        .filter(lot => (lot.quantite || 0) > 0)
        .map(lot => ({
            lotId: lot.lotId,
            numLot: lot.numLot || '',
            arome: lot.arome || '',
            format: lot.format || '',
            dlv: lot.dlv || '',
            dlc: lot.dlc || '',
            quantite: lot.quantite || 0,
            forceStockInsuffisant: !!lot.forceStockInsuffisant
        }));
};

// Mémorise le n° de BL sur la commande : un BL supprimé puis régénéré garde son
// numéro, et ce numéro n'est jamais attribué à une autre commande.
const memoriserNumeroBLCommande = (commandes, commande, numeroBL) => {
    if (!numeroBL || commande.numeroBL === numeroBL) return;
    commande.numeroBL = numeroBL;
    DB.set('commandes', commandes);
};

const syncBLTraceFromCommande = (livraison, commande) => {
    const lotsTraces = buildLotsTracesForCommande(commande);
    return {
        ...livraison,
        lotsTraces: lotsTraces.length > 0 ? lotsTraces : (livraison.lotsTraces || [])
    };
};

const getOrCreateBL = (commandeId) => {
    const commandes = DB.get('commandes') || [];
    const livraisons = DB.get('livraisons') || [];
    const commande = commandes.find(c => c.id === commandeId);
    if (!commande) {
        showToast('Commande non trouvée', 'error');
        return null;
    }

    const existingIndex = livraisons.findIndex(l => l.commandeId === commandeId);
    if (existingIndex !== -1) {
        const updated = syncBLTraceFromCommande(livraisons[existingIndex], commande);
        livraisons[existingIndex] = updated;
        DB.set('livraisons', livraisons);
        memoriserNumeroBLCommande(commandes, commande, updated.numeroBL);
        return updated;
    }

    return generateBL(commandeId);
};

const prepareCommandeBLExport = (commandeId) => {
    const livraison = getOrCreateBL(commandeId);
    if (!livraison) return;
    showPrepareBLExportModal(livraison.id);
};

const saveBLPreparation = (livraisonId) => {
    const livraisons = DB.get('livraisons') || [];
    const commandes = DB.get('commandes') || [];
    const index = livraisons.findIndex(l => l.id === livraisonId);
    if (index === -1) {
        showToast('Livraison non trouvée', 'error');
        return null;
    }

    const parseCaisseInput = (id) => {
        const raw = document.getElementById(id)?.value.trim() || '';
        if (raw === '') return 0;
        return parseInt(raw, 10);
    };
    const vertes = parseCaisseInput('blCaissesVertes');
    const noires = parseCaisseInput('blCaissesNoires');
    if ((Number.isNaN(vertes) || vertes < 0) || (Number.isNaN(noires) || noires < 0)) {
        showToast('Les caisses IFCO doivent être des nombres positifs', 'error');
        return null;
    }

    const commande = commandes.find(c => c.id === livraisons[index].commandeId);
    livraisons[index] = syncBLTraceFromCommande({
        ...livraisons[index],
        caissesVertesLivrees: vertes,
        caissesNoiresLivrees: noires,
        notes: document.getElementById('blNotesInternes')?.value.trim() || ''
    }, commande);
    DB.set('livraisons', livraisons);
    return livraisons[index];
};

const showPrepareBLExportModal = (livraisonId) => {
    const livraisons = DB.get('livraisons') || [];
    const clients = DB.get('clients') || [];
    const commandes = DB.get('commandes') || [];
    const livraison = livraisons.find(l => l.id === livraisonId);
    if (!livraison) {
        showToast('Livraison non trouvée', 'error');
        return;
    }

    const commande = commandes.find(c => c.id === livraison.commandeId);
    const client = clients.find(c => c.id === livraison.clientId);
    const totalItems = (livraison.lignes || []).reduce((sum, l) => sum + (l.quantite || 0), 0);
    const lotsTraces = (livraison.lotsTraces && livraison.lotsTraces.length > 0)
        ? livraison.lotsTraces
        : buildLotsTracesForCommande(commande);
    const totalTrace = lotsTraces.reduce((sum, lot) => sum + (lot.quantite || 0), 0);
    const forcedCount = lotsTraces.filter(lot => lot.forceStockInsuffisant).length;
    const tracePreview = lotsTraces.slice(0, 4).map(lot => `
        <tr>
            <td>#${escapeHtml(formatLotNumero(lot.numLot || lot.lotId))}</td>
            <td>${escapeHtml(lot.arome || '?')}</td>
            <td>${escapeHtml(lot.format || '?')}</td>
            <td>${lot.dlc ? formatDate(lot.dlc) : 'N/A'}</td>
            <td>${lot.quantite || 0}</td>
        </tr>
    `).join('');

    modal.show(`Préparer BL-${getBLNumero(livraison)}`, `
        <div class="commande-details">
            <div class="workflow-summary">
                <div><span>Client</span><strong>${escapeHtml(client?.societe || client?.nom || 'N/A')}</strong></div>
                <div><span>Commande</span><strong>#${escapeHtml(commande ? getCommandeNumero(commande) : String(livraison.commandeId).slice(-5))}</strong></div>
                <div><span>Articles</span><strong>${totalItems}</strong></div>
                <div><span>Trace interne</span><strong>${totalTrace}</strong></div>
            </div>
            ${forcedCount > 0 ? `<p class="badge badge-warning">Alerte interne: ${forcedCount} ligne(s) livrée(s) avec stock insuffisant confirmé.</p>` : ''}
            <div class="form-row">
                <div class="form-group">
                    <label for="blCaissesVertes">Caisses vertes livrées (IFCO)</label>
                    <input type="number" id="blCaissesVertes" min="0" step="1" value="${parseInt(livraison.caissesVertesLivrees, 10) || 0}">
                </div>
                <div class="form-group">
                    <label for="blCaissesNoires">Caisses noires livrées (IFCO)</label>
                    <input type="number" id="blCaissesNoires" min="0" step="1" value="${parseInt(livraison.caissesNoiresLivrees, 10) || 0}">
                </div>
            </div>
            <div class="form-group">
                <label for="blNotesInternes">Notes internes</label>
                <textarea id="blNotesInternes" rows="3" placeholder="Notes non imprimées sur le BL client">${escapeHtml(livraison.notes || '')}</textarea>
            </div>
            <h4 style="margin-top:16px;">Traçabilité interne</h4>
            ${tracePreview ? `
            <table class="details-table">
                <thead>
                    <tr>
                        <th>Lot</th>
                        <th>Arôme</th>
                        <th>Format</th>
                        <th>DLC</th>
                        <th>Quantité</th>
                    </tr>
                </thead>
                <tbody>${tracePreview}</tbody>
            </table>
            ${lotsTraces.length > 4 ? `<p class="text-muted">+${lotsTraces.length - 4} autre(s) ligne(s) tracée(s)</p>` : ''}
            ` : '<p class="text-muted">Aucun lot tracé pour cette livraison.</p>'}
        </div>
    `, `
        <button class="btn btn-secondary" data-click="close-modal">Annuler</button>
        <button class="btn btn-secondary" data-click="export-bl-excel" data-id="${escapeHtml(livraisonId)}">Exporter Excel</button>
        <button class="btn btn-primary" data-click="export-bl-pdf" data-id="${escapeHtml(livraisonId)}">Exporter PDF</button>
    `, 'large');
};

const generateBL = (commandeId) => {
    const commandes = DB.get('commandes') || [];
    const aromes = DB.get('aromes') || [];
    const formats = DB.get('formats') || [];

    const commande = commandes.find(c => c.id === commandeId);
    if (!commande) {
        showToast('Commande non trouvée', 'error');
        return null;
    }

    const lignes = getItems(commande).filter(item => item.quantite > 0).map(item => {
        const a = aromes.find(ar => ar.id === item.aromeId);
        const f = formats.find(fmt => fmt.id === item.formatId);
        return {
            aromeId: item.aromeId,
            aromeNom: getAromeBLName(a?.nom) || item.aromeId,
            formatId: item.formatId,
            formatNom: f ? f.contenanceCl + ' cl' : item.formatId,
            quantite: item.quantite
        };
    });

    // Un BL régénéré pour la même livraison reprend le numéro mémorisé sur la commande
    const livraisonsExistantes = DB.get('livraisons') || [];
    const numeroMemorise = commande.numeroBL && !livraisonsExistantes.some(l => l.numeroBL === commande.numeroBL)
        ? commande.numeroBL
        : '';

    const livraison = {
        id: generateId(),
        numeroBL: numeroMemorise || getNextBLNumero(),
        commandeId: commandeId,
        clientId: commande.clientId,
        dateBL: getLocalDateISOString(),
        lignes: lignes,
        retours: [],
        facturationMode: '',
        notes: '',
        signatureNom: '',
        caissesVertesLivrees: 0,
        caissesNoiresLivrees: 0,
        dateDernierExport: '',
        lotsTraces: buildLotsTracesForCommande(commande)
    };

    livraisonsExistantes.push(livraison);
    DB.set('livraisons', livraisonsExistantes);
    memoriserNumeroBLCommande(commandes, commande, livraison.numeroBL);

    return livraison;
};

const exportPreparedBL = (livraisonId, format) => {
    const saved = saveBLPreparation(livraisonId);
    if (!saved) return;
    modal.hide();
    if (format === 'pdf') {
        exportBLPDF(saved.id);
    } else {
        exportBLExcel(saved.id);
    }
};

const exportBLPDF = (livraisonId) => {
    let popup = null;
    try {
        const livraisons = DB.get('livraisons') || [];
        const clients = DB.get('clients') || [];
        const formats = DB.get('formats') || [];

        const livraison = livraisons.find(l => l.id === livraisonId);
        if (!livraison) {
            showToast('Livraison non trouvée', 'error');
            return;
        }

        const client = clients.find(c => c.id === livraison.clientId);

        const lignesFiltered = (livraison.lignes || []).filter(l => Number(l.quantite) > 0);
        if (lignesFiltered.length === 0) {
            showToast('Aucun article à livrer', 'warning');
            return;
        }

        const merged = {};
        let skippedCount = 0;
        lignesFiltered.forEach(l => {
            const fmt = formats.find(f => f.id === l.formatId);
            const fmtLabel = fmt ? `${fmt.contenanceCl} cl` : (l.formatNom || '');
            if (!fmtLabel || !fmtLabel.trim()) {
                skippedCount++;
                return;
            }
            const canonicalArome = getAromeBLName(l.aromeNom || '') || l.aromeNom || '';
            const key = `${canonicalArome}|${fmtLabel}`;
            if (merged[key]) {
                merged[key].quantite += Number(l.quantite) || 0;
            } else {
                merged[key] = { aromeNom: canonicalArome, formatNom: fmtLabel, quantite: Number(l.quantite) || 0 };
            }
        });

        if (skippedCount > 0) {
            showToast(`${skippedCount} article(s) ignoré(s) — libellé de format indisponible`, 'warning');
        }

        const sortedItems = Object.values(merged).sort((a, b) => {
            const aN = (a.aromeNom || '').toLowerCase();
            const bN = (b.aromeNom || '').toLowerCase();
            if (aN < bN) return -1;
            if (aN > bN) return 1;
            return (a.formatNom || '').localeCompare(b.formatNom || '');
        });

        if (sortedItems.length === 0) {
            showToast('Aucune ligne exploitable pour générer le BL — tous les articles ont été ignorés (format manquant)', 'error');
            return;
        }

        const cVerte = parseInt(livraison.caissesVertesLivrees, 10) || 0;
        const cNoire = parseInt(livraison.caissesNoiresLivrees, 10) || 0;

        const clientSociete = client ? (client.societe || '') : '';
        const clientContact = client ? (client.nom || '') : '';
        const clientAdresse = client ? (client.adresse || '') : '';
        const clientLocalite = client ? (`${client.npa || ''} ${client.localite || ''}`.trim()) : '';
        const blNum = getBLNumero(livraison);
        const blDate = livraison.dateBL || '';

        const PER_PAGE = 18;
        const LAST_PAGE_MAX = 5;
        const buildPageChunks = (total) => {
            if (total <= LAST_PAGE_MAX) return [total];
            const chunks = [];
            let remaining = total;
            while (remaining > PER_PAGE) {
                chunks.push(PER_PAGE);
                remaining -= PER_PAGE;
            }
            if (remaining > LAST_PAGE_MAX) {
                chunks.push(remaining - LAST_PAGE_MAX);
                chunks.push(LAST_PAGE_MAX);
            } else if (remaining > 0) {
                chunks.push(remaining);
            }
            return chunks;
        };
        const pageChunks = buildPageChunks(sortedItems.length);
        const pageCount = pageChunks.length;

        const fullPageUrl = new URL('icons/bl-template/page-full.png', window.location.href).href;
        const continuationPageUrl = new URL('icons/bl-template/page-continuation.png', window.location.href).href;
        const escapeAttr = (v) => escapeHtml(v).replace(/"/g, '&quot;');

        const recipientLines = [clientSociete, clientContact, clientAdresse, clientLocalite].filter(Boolean).slice(0, 4);
        const clientBottom = clientSociete || clientContact;
        const factMark = (mode) => (livraison.facturationMode === mode ? 'x' : '');

        let pagesHtml = '';
        let offset = 0;
        for (let p = 0; p < pageChunks.length; p++) {
            const isLastPage = p === pageChunks.length - 1;
            const pageNumber = p + 1;
            const size = pageChunks[p];
            const chunk = sortedItems.slice(offset, offset + size);
            offset += size;
            const rowsHtml = chunk.map(it => `
                <div class="pdf-row">
                    <div class="pdf-cell pdf-qtt">${escapeHtml(String(it.quantite))}</div>
                    <div class="pdf-cell pdf-desc">ThéCol - Thé Froid Artisanal</div>
                    <div class="pdf-cell pdf-arome">${escapeHtml(it.aromeNom || '')}</div>
                    <div class="pdf-cell pdf-format">${escapeHtml(it.formatNom || '')}</div>
                </div>
            `).join('');

            pagesHtml += `
                <div class="pdf-page">
                    <img class="pdf-template-bg" src="${escapeAttr(isLastPage ? fullPageUrl : continuationPageUrl)}" alt="">
                    <div class="pdf-blnum">${escapeHtml(blNum)}</div>
                    <div class="pdf-date">${escapeHtml(blDate)}</div>
                    <div class="pdf-recipient">${recipientLines.map(line => `<div>${escapeHtml(line)}</div>`).join('')}</div>
                    ${!isLastPage ? `<div class="pdf-suite">Suite — page ${pageNumber}</div>` : ''}
                    <div class="pdf-table-head pdf-table-arome">Arôme</div>
                    <div class="pdf-table-head pdf-table-format">Format</div>
                    <div class="pdf-rows">${rowsHtml}</div>
                    ${isLastPage ? `
                        <div class="pdf-ifco pdf-ifco-green">${escapeHtml(String(cVerte || ''))}</div>
                        <div class="pdf-ifco pdf-ifco-black">${escapeHtml(String(cNoire || ''))}</div>
                        <div class="pdf-fact-mark pdf-fact-email">${factMark('email')}</div>
                        <div class="pdf-fact-mark pdf-fact-poste">${factMark('poste')}</div>
                        <div class="pdf-fact-mark pdf-fact-other">${factMark('autre')}</div>
                        <div class="pdf-client-bottom">${escapeHtml(clientBottom)}</div>
                    ` : ''}
                    ${pageCount > 1 ? `<div class="pdf-page-footer">BL-${escapeHtml(blNum)} · Page ${pageNumber} / ${pageCount}</div>` : ''}
                </div>
            `;
        }

        const css = `
            * { box-sizing: border-box; }
            html, body { margin: 0; padding: 0; background: #fff; color: #1f1f1f; font-family: Calibri, Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .no-print { position: fixed; top: 12px; right: 12px; z-index: 1000; }
            .no-print button { background: #1f1f1f; color: #fff; border: none; padding: 10px 18px; border-radius: 4px; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.18); }
            .no-print button:hover { background: #000; }
            @page { size: A4; margin: 0; }
            .pdf-page { position: relative; width: 210mm; height: 297mm; margin: 0 auto; padding: 0; overflow: hidden; break-after: page; page-break-after: always; }
            .pdf-page:last-child { break-after: auto; page-break-after: auto; }
            .pdf-template-bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; z-index: 0; }
            .pdf-blnum, .pdf-date, .pdf-recipient, .pdf-suite, .pdf-table-head, .pdf-rows, .pdf-ifco, .pdf-fact-mark, .pdf-client-bottom, .pdf-page-footer { position: absolute; z-index: 1; }
            .pdf-blnum { left: 101.3mm; top: 16mm; width: 10mm; font-size: 14px; font-weight: 700; text-align: center; }
            .pdf-date { left: 163.5mm; top: 50.8mm; width: 17.7mm; font-family: Calibri, Arial, sans-serif; font-size: 11pt; text-align: right; white-space: nowrap; }
            .pdf-recipient { left: 144.5mm; top: 61.7mm; width: 36.8mm; max-height: 21.4mm; overflow: visible; font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 5.29mm; text-align: right; white-space: nowrap; }
            .pdf-suite { left: 121mm; top: 21mm; width: 42mm; color: #666; font-size: 8.5px; text-align: center; }
            .pdf-table-head { top: 97.3mm; color: #000; font-family: Calibri, Arial, sans-serif; font-size: 11pt; font-weight: 400; line-height: 4mm; }
            .pdf-table-arome { left: 86.1mm; width: 29mm; }
            .pdf-table-format { left: 115.7mm; width: 11mm; text-align: left; }
            .pdf-rows { left: 25.4mm; top: 101mm; width: 101mm; font-family: Calibri, Arial, sans-serif; font-size: 11pt; }
            .pdf-row { display: grid; grid-template-columns: 13% 47% 29% 11%; width: 100%; height: 5.29mm; font-family: Calibri, Arial, sans-serif; font-size: 11pt; }
            .pdf-cell { display: flex; align-items: center; min-width: 0; padding: 0 1mm; overflow: hidden; white-space: nowrap; }
            .pdf-qtt { justify-content: center; font-weight: 600; }
            .pdf-format { justify-content: flex-end; text-align: right; }
            .pdf-ifco { left: 25.4mm; width: 13mm; font-size: 10.5px; font-weight: 700; text-align: center; }
            .pdf-ifco-green { top: 154.7mm; }
            .pdf-ifco-black { top: 160mm; }
            .pdf-fact-mark { left: 115.5mm; width: 8mm; font-size: 10.5px; font-weight: 700; text-align: center; }
            .pdf-fact-email { top: 149mm; }
            .pdf-fact-poste { top: 154.35mm; }
            .pdf-fact-other { top: 159.7mm; }
            .pdf-client-bottom { left: 27mm; top: 192.65mm; width: 75mm; font-family: Calibri, Arial, sans-serif; font-size: 16pt; }
            .pdf-page-footer { left: 0; bottom: 3mm; width: 100%; color: #777; font-size: 8.5px; text-align: center; }
            @media print {
                .no-print { display: none !important; }
                .pdf-page { margin: 0; }
            }
        `;

        const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Bulletin de Livraison ${escapeHtml(blNum)}</title>
<style>${css}</style>
</head>
<body>
<div class="no-print"><button onclick="window.print()">Imprimer / Enregistrer en PDF</button></div>
${pagesHtml}
</body>
</html>`;

        popup = window.open('', '_blank');
        if (!popup) {
            showToast('Autorisez les popups pour exporter le PDF', 'warning');
            return;
        }
        popup.document.open();
        popup.document.write(html);
        popup.document.close();

        const triggerPrint = () => {
            try {
                popup.focus();
                popup.print();
            } catch (e) {
                console.error('exportBLPDF: print failed', e);
            }
            recordBLExportDate(livraisonId);
            if (window.location.hash === '#livraisons') {
                renderLivraisons();
            }
        };

        if (popup.document.readyState === 'complete') {
            setTimeout(triggerPrint, 250);
        } else {
            popup.addEventListener('load', () => setTimeout(triggerPrint, 250), { once: true });
        }
    } catch (e) {
        console.error('exportBLPDF: échec de génération', e);
        if (popup && !popup.closed) {
            try { popup.close(); } catch (_) { /* ignore */ }
        }
        showToast('Erreur lors de la génération du PDF', 'error');
    }
};

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

const exportBLExcel = (livraisonId) => {
    const livraisons = DB.get('livraisons') || [];
    const clients = DB.get('clients') || [];
    const formats = DB.get('formats') || [];

    const livraison = livraisons.find(l => l.id === livraisonId);
    if (!livraison) {
        showToast('Livraison non trouvée', 'error');
        return;
    }

    const client = clients.find(c => c.id === livraison.clientId);

    const lignesFiltered = (livraison.lignes || []).filter(l => l.quantite > 0);
    if (lignesFiltered.length === 0) {
        showToast('Aucun article à livrer', 'warning');
        return;
    }

    const merged = {};
    let skippedCount = 0;
    lignesFiltered.forEach(l => {
        const fmt = formats.find(f => f.id === l.formatId);
        if (!fmt) {
            skippedCount++;
            return;
        }
        const fmtLabel = fmt.contenanceCl + ' cl';
        const canonicalArome = getAromeBLName(l.aromeNom || '') || l.aromeNom || '';
        const key = `${canonicalArome}|${fmtLabel}`;
        if (merged[key]) {
            merged[key].quantite += l.quantite;
        } else {
            merged[key] = { aromeNom: l.aromeNom, formatNom: fmtLabel, quantite: l.quantite };
        }
    });

    if (skippedCount > 0) {
        showToast(`${skippedCount} article(s) ignoré(s) — format introuvable`, 'warning');
    }

    const templatePath = 'templates/bl_template.xlsx';
    const xhr = new XMLHttpRequest();
    xhr.open('GET', templatePath, true);
    xhr.responseType = 'arraybuffer';

    xhr.onload = () => {
        if (xhr.status !== 200) {
            showToast('Template non trouvé: ' + templatePath, 'error');
            return;
        }

        JSZip.loadAsync(xhr.response).then(zip => {
            const sheetFile = zip.file('xl/worksheets/sheet1.xml');
            const ssFile = zip.file('xl/sharedStrings.xml');

            if (!sheetFile) {
                showToast('Feuille non trouvée dans le template', 'error');
                return;
            }

            Promise.all([
                sheetFile.async('string'),
                ssFile ? ssFile.async('string') : Promise.resolve(null)
            ]).then(([sheetXml, ssXml]) => {
                let ssStrings = [];
                let ssModified = false;

                if (ssXml) {
                    const ssParser = new DOMParser();
                    const ssDoc = ssParser.parseFromString(ssXml, 'text/xml');
                    if (ssDoc.getElementsByTagName('parsererror').length > 0) {
                        showToast('Erreur lecture des chaînes partagées', 'error');
                        return;
                    }
                    const siEls = ssDoc.getElementsByTagName('si');
                    for (let i = 0; i < siEls.length; i++) {
                        const t = siEls[i].getElementsByTagName('t')[0];
                        ssStrings.push(t ? t.textContent : '');
                    }
                }

                const parser = new DOMParser();
                const sheetDoc = parser.parseFromString(sheetXml, 'text/xml');

                if (sheetDoc.getElementsByTagName('parsererror').length > 0) {
                    showToast('Erreur parsing du template XML', 'error');
                    return;
                }

                const getOrAddSS = (text) => {
                    let idx = ssStrings.indexOf(text);
                    if (idx === -1) {
                        idx = ssStrings.length;
                        ssStrings.push(text);
                        ssModified = true;
                    }
                    return idx;
                };

                const blNum = `BL-${getBLNumero(livraison)}`;
                const blDate = livraison.dateBL;
                const clientSociete = client ? (client.societe || '') : '';
                const clientContact = client ? (client.nom || '') : '';
                const clientAdresse = client ? (client.adresse || '') : '';
                const clientLocalite = client ? (`${client.npa || ''} ${client.localite || ''}`.trim()) : '';
                const cVerteLivree = parseInt(livraison.caissesVertesLivrees, 10) || 0;
                const cNoireLivree = parseInt(livraison.caissesNoiresLivrees, 10) || 0;

                const setCellTextDom = (cell, text) => {
                    cell.setAttribute('t', 's');
                    const fEls = cell.getElementsByTagName('f');
                    for (let fi = fEls.length - 1; fi >= 0; fi--) fEls[fi].parentNode.removeChild(fEls[fi]);
                    const idx = getOrAddSS(text);
                    let vEl = cell.getElementsByTagName('v')[0];
                    if (!vEl) {
                        vEl = sheetDoc.createElementNS(NS, 'v');
                        cell.appendChild(vEl);
                    }
                    vEl.textContent = idx;
                };

                const setCellValueDom = (cell, value) => {
                    cell.removeAttribute('t');
                    const fEls = cell.getElementsByTagName('f');
                    for (let fi = fEls.length - 1; fi >= 0; fi--) fEls[fi].parentNode.removeChild(fEls[fi]);
                    let vEl = cell.getElementsByTagName('v')[0];
                    if (!vEl) {
                        vEl = sheetDoc.createElementNS(NS, 'v');
                        cell.appendChild(vEl);
                    }
                    vEl.textContent = value;
                };

                const clearCellDom = (cell) => {
                    cell.removeAttribute('t');
                    const fEls = cell.getElementsByTagName('f');
                    for (let fi = fEls.length - 1; fi >= 0; fi--) fEls[fi].parentNode.removeChild(fEls[fi]);
                    let vEl = cell.getElementsByTagName('v')[0];
                    if (vEl) vEl.textContent = '';
                };

                const findCellByRef = (row, ref) => {
                    const cells = row.getElementsByTagName('c');
                    for (let c = 0; c < cells.length; c++) {
                        if (cells[c].getAttribute('r') === ref) return cells[c];
                    }
                    return null;
                };

                const allRows = sheetDoc.getElementsByTagName('row');

                const sortedItems = Object.values(merged).sort((a, b) => {
                    const aN = (a.aromeNom || '').toLowerCase();
                    const bN = (b.aromeNom || '').toLowerCase();
                    if (aN < bN) return -1;
                    if (aN > bN) return 1;
                    return (a.formatNom || '').localeCompare(b.formatNom || '');
                });

                const DATA_START = 15;
                const DATA_END = 38;
                const dataRowEls = {};

                for (let i = 0; i < allRows.length; i++) {
                    const r = allRows[i];
                    const rn = parseInt(r.getAttribute('r'), 10);
                    if (rn >= DATA_START && rn <= DATA_END) {
                        dataRowEls[rn] = r;
                        r.setAttribute('hidden', '1');
                    }
                }

                const extraRows = Math.max(0, sortedItems.length - 24);
                const FO = extraRows;

                if (FO > 0) {
                    const footerRows = [];
                    for (let i = 0; i < allRows.length; i++) {
                        const rn = parseInt(allRows[i].getAttribute('r'), 10);
                        if (rn >= 39) footerRows.push(allRows[i]);
                    }
                    footerRows.sort((a, b) => parseInt(b.getAttribute('r'), 10) - parseInt(a.getAttribute('r'), 10));
                    footerRows.forEach(row => {
                        const oldR = parseInt(row.getAttribute('r'), 10);
                        const newR = oldR + FO;
                        row.setAttribute('r', String(newR));
                        const cells = row.getElementsByTagName('c');
                        for (let ci = 0; ci < cells.length; ci++) {
                            const cell = cells[ci];
                            const ref = cell.getAttribute('r');
                            cell.setAttribute('r', ref.replace(/[0-9]+$/, '') + newR);
                        }
                    });
                    const dimEl = sheetDoc.getElementsByTagName('dimension')[0];
                    if (dimEl) {
                        dimEl.setAttribute('ref', dimEl.getAttribute('ref').replace(/\d+$/, function(m) { return String(parseInt(m) + FO); }));
                    }
                    const mergeCells = sheetDoc.getElementsByTagName('mergeCell');
                    for (let mi = 0; mi < mergeCells.length; mi++) {
                        mergeCells[mi].setAttribute('ref', mergeCells[mi].getAttribute('ref').replace(/\d+/g, function(m) { return String(parseInt(m) + FO); }));
                    }
                    const sheetDataEl = sheetDoc.getElementsByTagName('sheetData')[0];
                    const newFooterStart = 39 + FO;
                    for (let i = 0; i < FO; i++) {
                        const newRowNum = 39 + i;
                        let insertBefore = null;
                        for (let j = 0; j < allRows.length; j++) {
                            if (parseInt(allRows[j].getAttribute('r'), 10) === newFooterStart) {
                                insertBefore = allRows[j];
                                break;
                            }
                        }
                        const templateRow = dataRowEls[DATA_END] || dataRowEls[DATA_START];
                        const newRow = sheetDoc.createElementNS(NS, 'row');
                        newRow.setAttribute('r', String(newRowNum));
                        newRow.setAttribute('spans', '1:6');
                        newRow.setAttribute('hidden', '1');
                        ['A', 'B', 'C', 'D'].forEach(col => {
                            const nc = sheetDoc.createElementNS(NS, 'c');
                            nc.setAttribute('r', col + newRowNum);
                            if (templateRow) {
                                const tc = findCellByRef(templateRow, col + DATA_END);
                                if (tc) {
                                    const s = tc.getAttribute('s');
                                    if (s) nc.setAttribute('s', s);
                                }
                            }
                            const vEl = sheetDoc.createElementNS(NS, 'v');
                            vEl.textContent = '0';
                            nc.appendChild(vEl);
                            newRow.appendChild(nc);
                        });
                        if (insertBefore && insertBefore.parentNode) {
                            insertBefore.parentNode.insertBefore(newRow, insertBefore);
                        } else {
                            sheetDataEl.appendChild(newRow);
                        }
                        dataRowEls[newRowNum] = newRow;
                    }
                }

                sortedItems.forEach(function(item, idx) {
                    const targetRowNum = DATA_START + idx;
                    const row = dataRowEls[targetRowNum];
                    if (!row) return;
                    const rStr = row.getAttribute('r');
                    const cellA = findCellByRef(row, 'A' + rStr);
                    if (cellA) setCellValueDom(cellA, item.quantite);
                    const cellB = findCellByRef(row, 'B' + rStr);
                    if (cellB) setCellTextDom(cellB, 'ThéCol - Thé Froid Artisanal');
                    const cellC = findCellByRef(row, 'C' + rStr);
                    if (cellC) setCellTextDom(cellC, item.aromeNom);
                    const cellD = findCellByRef(row, 'D' + rStr);
                    if (cellD) setCellTextDom(cellD, item.formatNom);
                    row.removeAttribute('hidden');
                });

                for (let rn = DATA_START + sortedItems.length; rn <= DATA_END + FO; rn++) {
                    const row = dataRowEls[rn];
                    if (!row) continue;
                    row.setAttribute('hidden', '1');
                    const rStr = row.getAttribute('r');
                    const cellA = findCellByRef(row, 'A' + rStr);
                    if (cellA) { clearCellDom(cellA); setCellValueDom(cellA, 0); }
                    const cellB = findCellByRef(row, 'B' + rStr);
                    if (cellB) setCellTextDom(cellB, ' ');
                    const cellC = findCellByRef(row, 'C' + rStr);
                    if (cellC) setCellTextDom(cellC, ' ');
                    const cellD = findCellByRef(row, 'D' + rStr);
                    if (cellD) setCellTextDom(cellD, ' ');
                }

                for (let i = 0; i < allRows.length; i++) {
                    const row = allRows[i];
                    const rowNum = parseInt(row.getAttribute('r'));

                    if (rowNum >= 15 && rowNum <= 38 + FO) continue;

                    if (rowNum === 2) {
                        let cellC2 = findCellByRef(row, 'C2');
                        if (!cellC2) {
                            cellC2 = sheetDoc.createElementNS(NS, 'c');
                            cellC2.setAttribute('r', 'C2');
                            row.appendChild(cellC2);
                        }
                        setCellTextDom(cellC2, blNum);
                    }

                    if (rowNum === 5) {
                        const cellF = findCellByRef(row, 'F5');
                        if (cellF) setCellTextDom(cellF, blDate);
                    }

                    if (rowNum === 7) {
                        const cellF = findCellByRef(row, 'F7');
                        if (cellF) setCellTextDom(cellF, clientSociete || ' ');
                    }

                    if (rowNum === 8) {
                        const cellF = findCellByRef(row, 'F8');
                        if (cellF) setCellTextDom(cellF, clientContact || ' ');
                    }

                    if (rowNum === 9) {
                        const cellF = findCellByRef(row, 'F9');
                        if (cellF) setCellTextDom(cellF, clientAdresse || ' ');
                    }

                    if (rowNum === 10) {
                        const cellF = findCellByRef(row, 'F10');
                        if (cellF) setCellTextDom(cellF, clientLocalite || ' ');
                    }

                    if (rowNum === 54 + FO) {
                        const cellA = findCellByRef(row, 'A' + (54 + FO));
                        if (cellA) setCellTextDom(cellA, clientSociete || ' ');
                    }

                    if (rowNum >= 47 + FO && rowNum <= 49 + FO) {
                        const expectedMode = rowNum === 47 + FO ? 'email' : rowNum === 48 + FO ? 'poste' : 'autre';
                        const cellD = findCellByRef(row, 'D' + rowNum);
                        if (cellD) {
                            if (livraison.facturationMode === expectedMode) {
                                setCellTextDom(cellD, 'x');
                            } else {
                                setCellTextDom(cellD, ' ');
                            }
                        }
                    }

                    if (rowNum >= 48 + FO && rowNum <= 51 + FO) {
                        const cellA = findCellByRef(row, 'A' + rowNum);
                        if (cellA) {
                            if (rowNum === 48 + FO) {
                                setCellValueDom(cellA, cVerteLivree);
                            } else if (rowNum === 49 + FO) {
                                setCellValueDom(cellA, cNoireLivree);
                            } else {
                                clearCellDom(cellA);
                            }
                        }
                    }

                    if (rowNum >= 57 + FO && rowNum <= 59 + FO) {
                        const clearCols = ['D', 'E', 'F'];
                        clearCols.forEach(col => {
                            const cell = findCellByRef(row, col + rowNum);
                            if (cell) {
                                clearCellDom(cell);
                            }
                        });
                    }
                }

                const serialized = new XMLSerializer().serializeToString(sheetDoc);
                const cleaned = serialized
                    .replace(/<ns\d+:/g, '<')
                    .replace(/<\/ns\d+:/g, '</')
                    .replace(/ xmlns:ns\d+="[^"]*"/g, '');
                const newSheetXml = cleaned.startsWith('<?xml')
                    ? cleaned
                    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + cleaned;

                if (ssModified) {
                    let ssContent = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
                    ssContent += `<sst xmlns="${NS}" count="${ssStrings.length}" uniqueCount="${ssStrings.length}">`;
                    ssStrings.forEach(s => {
                        const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                        ssContent += `<si><t xml:space="preserve">${esc}</t></si>`;
                    });
                    ssContent += '</sst>';
                    zip.file('xl/sharedStrings.xml', ssContent);
                }

                zip.file('xl/worksheets/sheet1.xml', newSheetXml);

                zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }).then(blob => {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `BL-${getBLNumero(livraison)}_${livraison.dateBL}.xlsx`;
                    a.click();
                    URL.revokeObjectURL(url);
                    recordBLExportDate(livraison.id);
                    showToast('Bulletin de livraison exporté');
                    if (window.location.hash === '#livraisons') renderLivraisons();
                }).catch(err => {
                    console.error('ZIP gen error:', err);
                    showToast('Erreur génération fichier', 'error');
                });
            }).catch(err => {
                console.error('Parse error:', err);
                showToast('Erreur lecture template', 'error');
            });
        }).catch(err => {
            console.error('JSZip error:', err);
            showToast('Erreur ouverture template', 'error');
        });
    };

    xhr.onerror = () => {
        showToast('Erreur chargement template', 'error');
    };

    xhr.send();
};

let productionPlannerState = null;
let productionSelectedCommandes = null; // null = toutes les commandes éligibles (jamais personnalisé)
let productionSelectionCustomized = false; // true dès que l'utilisateur modifie la sélection
let productionSelectorOpen = false;
let productionFocusTarget = null; // 'selectAll' | 'deselectAll' | commandeId
let productionMode = null; // 'auto' | 'manuel' — initialisé paresseusement depuis le filtre persistant
let productionManualQuantities = {}; // { `${aromeId}|${formatId}`: nombre de bouteilles }

const roundHalfLiter = (value) => Math.round((parseFloat(value) || 0) * 2) / 2;

const createProductionRecipient = (type, nom, capacite, litres, numero = null) => ({
    type,
    nom,
    capacite,
    litres: roundHalfLiter(litres),
    numero,
    ingredients: []
});

const distributeBalancedCuves = (litresTotal) => {
    const totalUnits = Math.round(litresTotal * 2);
    const count = Math.max(1, Math.ceil(litresTotal / CONSTANTS.CUVE_MAX_L));
    const baseUnits = Math.floor(totalUnits / count);
    let remainder = totalUnits - (baseUnits * count);

    return Array.from({ length: count }, (_, index) => {
        const units = baseUnits + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder--;
        return createProductionRecipient('cuve', `Cuve ${index + 1}`, CONSTANTS.CUVE_MAX_L, units / 2, index + 1);
    });
};

const getProductionRecipients = (litresTotal) => {
    const litres = roundHalfLiter(litresTotal);
    if (litres <= 0) return [];

    if (litres <= CONSTANTS.CUVE_MAX_L) {
        return [createProductionRecipient('cuve', 'Cuve 25L', CONSTANTS.CUVE_MAX_L, litres, 1)];
    }

    const reste = roundHalfLiter(litres - CONSTANTS.CUVE_MAX_L);
    if (reste > 0 && reste <= 4) {
        return [
            createProductionRecipient('cuve', 'Cuve 25L', CONSTANTS.CUVE_MAX_L, CONSTANTS.CUVE_MAX_L, 1),
            createProductionRecipient('casserole', 'Casserole 4L', 4, reste, 1)
        ];
    }

    if (reste > 0 && reste <= 9) {
        return [
            createProductionRecipient('cuve', 'Cuve 25L', CONSTANTS.CUVE_MAX_L, CONSTANTS.CUVE_MAX_L, 1),
            createProductionRecipient('casserole', 'Casserole 9L', 9, reste, 1)
        ];
    }

    return distributeBalancedCuves(litres);
};

// Production Planner
// Calcule le plan de production selon le mode courant (auto = commandes
// sélectionnées, manuel = quantités saisies) et met à jour productionPlannerState.
const computeProductionPlan = () => {
    const aromes = DB.get('aromes');
    const formats = DB.get('formats');
    const recettes = DB.get('recettes');
    const lots = DB.get('lots') || [];

    const now = new Date();
    const stockPool = createStockPool(lots, now);

    const besoins = {};
    let commandesAInclure = [];
    let commandesDisponibles = [];

    if (productionMode === 'manuel') {
        // Besoins saisis manuellement : `${aromeId}|${formatId}` -> bouteilles
        Object.entries(productionManualQuantities).forEach(([key, qty]) => {
            const quantite = Math.max(0, parseInt(qty, 10) || 0);
            if (quantite <= 0) return;
            const sep = key.indexOf('|');
            if (sep < 0) return;
            const aromeId = key.slice(0, sep);
            const formatId = key.slice(sep + 1);
            const arome = aromes.find(a => a.id === aromeId);
            const format = formats.find(f => f.id === formatId);
            if (!arome || !format) return;
            const bkey = `${arome.nom}-${format.nom}`;
            besoins[bkey] = { aromeId, formatId, aromeNom: arome.nom, formatNom: format.nom, quantite };
        });
    } else {
        // Toutes les commandes non annulées / non livrées
        const commandes = DB.get('commandes');
        commandesDisponibles = commandes.filter(c =>
            c.statut !== 'annulee' &&
            c.statut !== 'livrée'
        );

        // Sélection en mémoire (null = toutes éligibles, jamais personnalisé)
        if (productionSelectedCommandes === null || !productionSelectionCustomized) {
            productionSelectedCommandes = new Set(commandesDisponibles.map(c => c.id));
        }
        // Non personnalisé : toutes les commandes éligibles sont incluses dynamiquement.
        // Personnalisé : seul le Set gouverne (nouvelles commandes décochées par défaut).
        commandesAInclure = commandesDisponibles.filter(c => productionSelectedCommandes.has(c.id));

        // Par date de livraison croissante : chaque commande ne consomme que les
        // lots encore vendables à sa date de livraison (DLV croissante).
        sortCommandesByDateLivraison(commandesAInclure).forEach(({ commande: cmd }) => {
            (cmd.items || []).forEach(item => {
                const arome = aromes.find(a => a.id === item.aromeId);
                const format = formats.find(f => f.id === item.formatId);
                const key = `${arome?.nom || ''}-${format?.nom || ''}`;
                if (!besoins[key]) {
                    besoins[key] = { aromeId: item.aromeId, formatId: item.formatId, aromeNom: arome?.nom || '', formatNom: format?.nom || '', quantite: 0, disponible: 0 };
                }
                besoins[key].quantite += item.quantite;
                besoins[key].disponible += stockPool.take(key, Number(item.quantite) || 0, cmd.dateLivraison);
            });
        });
    }

    // Production nécessaire. En mode manuel on produit exactement la quantité
    // saisie ; en mode auto on déduit le stock vendable à la date de livraison.
    const productionNecesaire = {};
    Object.entries(besoins).forEach(([key, b]) => {
        const disponible = productionMode === 'manuel' ? stockPool.available(key) : b.disponible;
        const aProduire = productionMode === 'manuel' ? b.quantite : Math.max(0, b.quantite - disponible);
        productionNecesaire[key] = { ...b, disponible, aProduire };
    });

    // Litres par arôme (production nécessaire uniquement)
    const litresParArome = {};
    Object.values(productionNecesaire).filter(b => b.aProduire > 0).forEach(b => {
        const format = formats.find(f => f.nom === b.formatNom);
        const litres = (format?.contenanceCl || 0) * b.aProduire / 100;
        if (!litresParArome[b.aromeNom]) litresParArome[b.aromeNom] = 0;
        litresParArome[b.aromeNom] += litres;
    });

    const recipientsParArome = {};
    Object.entries(litresParArome).forEach(([aromeNom, litresTotal]) => {
        const arome = aromes.find(a => a.nom === aromeNom);
        const recette = recettes.find(r => r.aromeId === arome?.id);
        recipientsParArome[aromeNom] = getProductionRecipients(litresTotal).map(recipient => ({
            ...recipient,
            ingredients: calculerIngredientsRecipient(recette, recipient.litres)
        }));
    });

    productionPlannerState = {
        productionNecesaire,
        litresParArome,
        recipientsParArome
    };

    return { aromes, formats, productionNecesaire, litresParArome, recipientsParArome, commandesAInclure, commandesDisponibles };
};

const buildProductionKpiHtml = (plan) => {
    const { productionNecesaire, litresParArome, commandesAInclure } = plan;
    const totalBouteillesProduction = Object.values(productionNecesaire).reduce((sum, b) => sum + (b.aProduire || 0), 0);
    const totalLitresProduction = Object.values(litresParArome).reduce((sum, litres) => sum + litres, 0);
    const isManuel = productionMode === 'manuel';
    const firstValue = isManuel ? Object.keys(litresParArome).length : commandesAInclure.length;
    const firstLabel = isManuel ? 'Arômes à produire' : 'Commandes à produire';
    return `
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon blue">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/></svg>
                </div>
                <div class="stat-content"><h3>${firstValue}</h3><p>${firstLabel}</p></div>
            </div>
            <div class="stat-card">
                <div class="stat-icon green">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
                </div>
                <div class="stat-content"><h3>${totalBouteillesProduction}</h3><p>Bouteilles à produire</p></div>
            </div>
            <div class="stat-card">
                <div class="stat-icon orange">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.2 7.8l-7.7 7.7-4-4-5.7 5.7"/></svg>
                </div>
                <div class="stat-content"><h3>${totalLitresProduction.toFixed(1)}</h3><p>Litres</p></div>
            </div>
        </div>
    `;
};

const buildProductionResultsHtml = (plan) => {
    const { aromes, formats, productionNecesaire, litresParArome, recipientsParArome, commandesAInclure } = plan;
    const isManuel = productionMode === 'manuel';

    // Bouteilles à produire par format + bouchons nécessaires
    // (50cl et 100cl partagent le même bouchon, les 25cl en ont un différent)
    const bouteillesParFormat = {};
    Object.values(productionNecesaire).filter(b => b.aProduire > 0).forEach(b => {
        if (!bouteillesParFormat[b.formatNom]) {
            const format = formats.find(f => f.nom === b.formatNom);
            bouteillesParFormat[b.formatNom] = { formatNom: b.formatNom, contenanceCl: format?.contenanceCl || 0, quantite: 0 };
        }
        bouteillesParFormat[b.formatNom].quantite += b.aProduire;
    });
    const formatsTries = Object.values(bouteillesParFormat).sort((a, b) => b.contenanceCl - a.contenanceCl);
    const btGrandBouchon = formatsTries.filter(f => f.contenanceCl >= 50).reduce((s, f) => s + f.quantite, 0);
    const btPetitBouchon = formatsTries.filter(f => f.contenanceCl < 50).reduce((s, f) => s + f.quantite, 0);
    const bouchonsGrands = Math.ceil(btGrandBouchon * CONSTANTS.BOUCHON_MARGIN);
    const bouchonsPetits = Math.ceil(btPetitBouchon * CONSTANTS.BOUCHON_MARGIN);

    const totalBouteillesProduction = Object.values(productionNecesaire).reduce((sum, b) => sum + (b.aProduire || 0), 0);
    const totalLitresProduction = Object.values(litresParArome).reduce((sum, litres) => sum + litres, 0);

    const emptyBt = isManuel ? 'Saisissez des quantités ci-dessus' : 'Aucune commande';
    const emptyStock = isManuel ? 'Saisissez des quantités ci-dessus' : 'Tout le stock est disponible';

    // Render results
    return `
        <div class="production-summary">
            <div class="production-item">
                <h4>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/></svg>
                    Bouteilles à produire
                </h4>
                ${Object.values(productionNecesaire).length === 0 ? `<p class="text-muted">${emptyBt}</p>` :
                  Object.values(productionNecesaire).map(b => {
                      const arome = aromes.find(a => a.nom === b.aromeNom);
                      return `<div class="flex-between" style="padding: 8px 0; border-bottom: 1px solid var(--border-light);">
                          <span><span class="color-dot" style="background: ${safeColor(arome?.couleur)}"></span>${escapeHtml(b.aromeNom)} ${escapeHtml(b.formatNom)}</span>
                          <div style="text-align: right;">
                              <div style="font-size: 12px; color: var(--text-muted);">Stock: ${b.disponible} bt</div>
                              <strong>À produire: ${b.aProduire} bt</strong>
                          </div>
                      </div>`;
                  }).join('')}
            </div>

            <div class="production-item">
                <h4>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M20.2 7.8l-7.7 7.7-4-4-5.7 5.7"/></svg>
                    Litres à produire (par arôme)
                </h4>
                ${Object.entries(litresParArome).length === 0 ? `<p class="text-muted">${emptyStock}</p>` :
                  Object.entries(litresParArome).map(([aromeNom, litres]) => {
                      const arome = aromes.find(a => a.nom === aromeNom);
                      return `<div class="flex-between" style="padding: 8px 0; border-bottom: 1px solid var(--border-light);">
                          <span><span class="color-dot" style="background: ${safeColor(arome?.couleur)}"></span>${escapeHtml(aromeNom)}</span>
                          <strong>${litres.toFixed(1)} L</strong>
                      </div>`;
                  }).join('')}
            </div>

            <div class="production-item">
                <h4>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M8 2h8M9 2v3.5L5.5 12A4.5 4.5 0 0 0 9.5 22h5a4.5 4.5 0 0 0 4-6.5L15 5.5V2"/></svg>
                    Bouteilles & bouchons
                </h4>
                ${formatsTries.length === 0 ? `<p class="text-muted">${emptyStock}</p>` : `
                  ${formatsTries.map(f => `<div class="flex-between" style="padding: 8px 0; border-bottom: 1px solid var(--border-light);">
                      <span>Bouteilles ${escapeHtml(f.formatNom)}</span>
                      <strong>${f.quantite} bt</strong>
                  </div>`).join('')}
                  ${bouchonsGrands > 0 ? `<div class="flex-between" style="padding: 8px 0; border-bottom: 1px solid var(--border-light);">
                      <span>Bouchons 50cl / 100cl</span>
                      <strong>${bouchonsGrands} pcs</strong>
                  </div>` : ''}
                  ${bouchonsPetits > 0 ? `<div class="flex-between" style="padding: 8px 0; border-bottom: 1px solid var(--border-light);">
                      <span>Bouchons 25cl</span>
                      <strong>${bouchonsPetits} pcs</strong>
                  </div>` : ''}
                  <p class="text-muted" style="font-size: 12px; margin-top: 8px;">Bouchons : marge de 5% incluse</p>
                `}
            </div>

            <div class="production-item" style="grid-column: 1 / -1;">
                <h4>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                    Répartition par récipients
                </h4>
                ${Object.entries(recipientsParArome).length === 0 ? `<p class="text-muted">${emptyStock}</p>` :
                  Object.entries(recipientsParArome).map(([aromeNom, recipients]) => {
                      const arome = aromes.find(a => a.nom === aromeNom);
                      const totalLitres = recipients.reduce((sum, r) => sum + r.litres, 0);
                      const totalCapacite = recipients.reduce((sum, r) => sum + r.capacite, 0);
                      const remplissageMoyen = totalCapacite > 0 ? (totalLitres / totalCapacite) * 100 : 0;
                      return `
                        <div class="cuve-arome">
                          <div class="cuve-header">
                            <span class="color-dot" style="background: ${safeColor(arome?.couleur)}"></span>
                            <strong>${escapeHtml(aromeNom)}</strong>
                            <span> - ${totalLitres.toFixed(1)}L (${recipients.length} récipient${recipients.length > 1 ? 's' : ''}, remplissage moyen ${remplissageMoyen.toFixed(0)}%)</span>
                            <button class="btn btn-sm btn-success" data-click="confirmer-production-arome" data-arome="${escapeHtml(aromeNom)}">Produire tout l'arôme</button>
                          </div>
                          ${recipients.map((recipient, recipientIndex) => {
                              const fillPercent = recipient.capacite > 0 ? Math.round((recipient.litres / recipient.capacite) * 100) : 0;
                              return `
                            <div class="cuve-detail" data-arome="${escapeHtml(aromeNom)}" data-recipient-index="${recipientIndex}">
                              <div class="flex-between" style="margin-bottom: 8px;">
                                <div class="cuve-title" style="margin-bottom: 0;">${escapeHtml(recipient.nom)} (${escapeHtml(String(recipient.litres.toFixed(1)))}L / ${escapeHtml(String(recipient.capacite))}L - ${escapeHtml(String(fillPercent))}%)</div>
                                <button class="btn btn-sm btn-success" data-click="confirmer-production" data-arome="${escapeHtml(aromeNom)}" data-index="${recipientIndex}">Produite</button>
                              </div>
                              <div class="cuve-slider-row">
                                <input type="range" class="cuve-slider" min="0.5" max="${safeNumAttr(recipient.capacite)}" step="0.5" value="${safeNumAttr(recipient.litres)}" data-arome="${escapeHtml(aromeNom)}" data-recipient-index="${recipientIndex}">
                                <span class="cuve-litres-display">${recipient.litres.toFixed(1)}L</span>
                              </div>
                              <ul class="ingredient-list">
                                ${recipient.ingredients.map(ing => `
                                  <li>
                                    <span>${escapeHtml(ing.nom)}</span>
                                    <strong>${escapeHtml(String(ing.quantite))} ${escapeHtml(displayUnit(ing.unite))}</strong>
                                  </li>
                                `).join('')}
                              </ul>
                            </div>
                              `;
                          }).join('')}
                        </div>
                      `;
                  }).join('')}
            </div>
        </div>

        <div style="margin-top: 24px; padding: 16px; background: var(--bg-secondary); border-radius: var(--radius);">
            ${isManuel
                ? `<strong>Résumé:</strong> Production manuelle — ${totalBouteillesProduction} bouteille(s) · ${totalLitresProduction.toFixed(1)} L`
                : `<strong>Résumé:</strong> ${commandesAInclure.length} commande(s) incluse(s) - Stock déduit automatiquement`}
        </div>
    `;
};

// Grille de saisie manuelle : une ligne par arôme actif, un champ par format actif.
const buildManualGridHtml = () => {
    const aromesActifs = getActive('aromes');
    const formatsActifs = getActive('formats');

    if (aromesActifs.length === 0 || formatsActifs.length === 0) {
        return `
            <div class="production-manual">
                <p class="text-muted">Ajoutez des arômes et des formats dans les paramètres pour saisir une production manuelle.</p>
            </div>
        `;
    }

    return `
        <div class="production-manual" id="productionManual">
            <div class="production-manual-header">
                <span class="text-muted" style="font-size:13px;">Nombre de bouteilles à produire par arôme et format</span>
                <button type="button" class="btn btn-sm btn-text" id="productionManualReset">Tout remettre à zéro</button>
            </div>
            <div class="production-manual-grid">
                ${aromesActifs.map(arome => `
                    <div class="production-manual-row">
                        <span class="production-manual-arome">
                            <span class="color-dot" style="background: ${safeColor(arome.couleur)}"></span>
                            ${escapeHtml(arome.nom)}
                        </span>
                        <div class="production-manual-fields">
                            ${formatsActifs.map(format => {
                                const key = `${arome.id}|${format.id}`;
                                const val = productionManualQuantities[key];
                                return `
                                  <label class="production-manual-field">
                                    <span>${escapeHtml(format.nom)}</span>
                                    <input type="number" min="0" step="1" inputmode="numeric" placeholder="0"
                                           data-manual-key="${escapeHtml(key)}"
                                           value="${val ? escapeHtml(String(val)) : ''}">
                                  </label>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
};

const setProductionMode = (mode) => {
    const next = mode === 'manuel' ? 'manuel' : 'auto';
    if (productionMode === next) return;
    productionMode = next;
    DB.setFilter('productionMode', next);
    renderProduction();
};

// Mise à jour en direct (mode manuel) : recalcule le plan et remplace uniquement
// les blocs KPI + résultats, sans reconstruire la grille de saisie (focus préservé).
const refreshProductionResults = () => {
    const plan = computeProductionPlan();
    const kpiEl = document.getElementById('productionKpi');
    if (kpiEl) kpiEl.innerHTML = buildProductionKpiHtml(plan);
    const resultsEl = document.getElementById('productionResults');
    if (resultsEl) resultsEl.innerHTML = buildProductionResultsHtml(plan);
    attacherSliderEvents();
};

const attacherManualGridEvents = () => {
    document.querySelectorAll('#productionManual input[data-manual-key]').forEach(input => {
        input.addEventListener('input', (e) => {
            const key = e.target.dataset.manualKey;
            if (!key) return;
            const v = Math.max(0, parseInt(e.target.value, 10) || 0);
            if (v > 0) productionManualQuantities[key] = v;
            else delete productionManualQuantities[key];
            refreshProductionResults();
        });
    });
    document.getElementById('productionManualReset')?.addEventListener('click', () => {
        productionManualQuantities = {};
        renderProduction();
    });
};

const renderProduction = () => {
    if (productionMode === null) {
        productionMode = DB.getFilter('productionMode') === 'manuel' ? 'manuel' : 'auto';
    }

    const plan = computeProductionPlan();
    const { formats, commandesAInclure, commandesDisponibles } = plan;
    const clients = DB.get('clients') || [];

    const modeToggleHtml = `
        <div class="segmented-filter production-mode-toggle" role="group" aria-label="Mode de calcul">
            <button type="button" class="segment ${productionMode !== 'manuel' ? 'active' : ''}" onclick="setProductionMode('auto')">Auto (commandes)</button>
            <button type="button" class="segment ${productionMode === 'manuel' ? 'active' : ''}" onclick="setProductionMode('manuel')">Manuel (bouteilles)</button>
        </div>
    `;

    let toolbarHtml = '';
    if (productionMode === 'manuel') {
        toolbarHtml = buildManualGridHtml();
    } else {
        // Sélecteur de commandes éligibles (cases à cocher)
        const selectorItemsHtml = commandesDisponibles.map(cmd => {
            const client = clients.find(cl => cl.id === cmd.clientId);
            const clientName = client ? getClientLabel(client) : 'N/A';
            const totalBt = (cmd.items || []).reduce((s, i) => {
                const q = parseFloat(i.quantite);
                return s + (Number.isFinite(q) && q >= 0 ? q : 0);
            }, 0);
            let totalL = 0;
            (cmd.items || []).forEach(item => {
                const fmt = formats.find(f => f.id === item.formatId);
                const q = parseFloat(item.quantite);
                const safeQ = Number.isFinite(q) && q >= 0 ? q : 0;
                totalL += ((fmt?.contenanceCl || 0) * safeQ) / 100;
            });
            const checked = commandesAInclure.some(c => c.id === cmd.id) ? 'checked' : '';
            return `
                <label class="production-commande-item">
                    <input type="checkbox" data-commande-id="${escapeHtml(cmd.id)}" ${checked}>
                    <span class="production-commande-info">
                        <span class="production-commande-numero">#${escapeHtml(getCommandeNumero(cmd))}</span>
                        <span class="production-commande-client">${escapeHtml(clientName)}</span>
                    </span>
                    <span class="production-commande-details">${totalBt} bt · ${totalL.toFixed(1)}L · ${formatDate(cmd.dateLivraison)}</span>
                </label>
            `;
        }).join('');

        toolbarHtml = `
            <div class="production-toolbar">
                <button type="button" class="btn btn-sm btn-text production-commande-toggle${productionSelectorOpen ? ' active' : ''}" id="productionCommandeToggle" aria-expanded="${productionSelectorOpen}" aria-controls="productionCommandeSelector" aria-label="Choisir les commandes">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    Choisir les commandes (${commandesAInclure.length})
                </button>
            </div>
            <div class="production-commande-selector${productionSelectorOpen ? ' open' : ''}" id="productionCommandeSelector" role="region" aria-label="Sélection des commandes">
                <div class="production-commande-selector-header">
                    <span class="text-muted" style="font-size:13px;">${commandesDisponibles.length} commande(s) éligible(s)</span>
                    <div>
                        <button type="button" class="btn btn-sm btn-text" id="productionSelectAllBtn">Tout sélectionner</button>
                        <button type="button" class="btn btn-sm btn-text" id="productionDeselectAllBtn">Tout désélectionner</button>
                    </div>
                </div>
                <div class="production-commande-selector-list">
                    ${selectorItemsHtml}
                </div>
            </div>
        `;
    }

    const html = `
        <div id="productionKpi">${buildProductionKpiHtml(plan)}</div>
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Planificateur de production</h3>
                ${modeToggleHtml}
            </div>
            ${toolbarHtml}
            <div id="productionResults">${buildProductionResultsHtml(plan)}</div>
        </div>
    `;

    safeRender(html);
    attacherSliderEvents();
    if (productionMode === 'manuel') {
        attacherManualGridEvents();
    } else {
        attacherCommandeSelectorEvents();
    }
};

const attacherSliderEvents = () => {
    document.querySelectorAll('.cuve-slider').forEach(slider => {
        slider.addEventListener('input', (e) => {
            const aromeNom = e.target.dataset.arome;
            const recipientIndex = parseInt(e.target.dataset.recipientIndex, 10);
            const nouvelleValeur = parseFloat(e.target.value);
            rebalanceRecipients(aromeNom, recipientIndex, nouvelleValeur);
        });
    });
};

const attacherCommandeSelectorEvents = () => {
    const toggle = document.getElementById('productionCommandeToggle');
    if (toggle) {
        toggle.addEventListener('click', toggleProductionCommandeSelector);
    }
    document.getElementById('productionSelectAllBtn')?.addEventListener('click', productionSelectAll);
    document.getElementById('productionDeselectAllBtn')?.addEventListener('click', productionDeselectAll);
    document.querySelectorAll('.production-commande-item input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const id = e.target.dataset.commandeId;
            if (id) toggleProductionCommande(id);
        });
    });

    // Restore focus after re-render (dataset-based, no fragile id selectors)
    if (productionFocusTarget === 'selectAll') {
        document.getElementById('productionSelectAllBtn')?.focus();
    } else if (productionFocusTarget === 'deselectAll') {
        document.getElementById('productionDeselectAllBtn')?.focus();
    } else if (productionFocusTarget) {
        const targetCb = Array.from(document.querySelectorAll('.production-commande-item input[type="checkbox"]'))
            .find(c => c.dataset.commandeId === productionFocusTarget);
        if (targetCb) targetCb.focus();
    }
    productionFocusTarget = null;
};

// Command selector helpers for production planner
const toggleProductionCommandeSelector = () => {
    productionSelectorOpen = !productionSelectorOpen;
    const panel = document.getElementById('productionCommandeSelector');
    if (panel) panel.classList.toggle('open', productionSelectorOpen);
    const toggleBtn = document.getElementById('productionCommandeToggle');
    if (toggleBtn) {
        toggleBtn.classList.toggle('active', productionSelectorOpen);
        toggleBtn.setAttribute('aria-expanded', String(productionSelectorOpen));
    }
};

const toggleProductionCommande = (id) => {
    if (!productionSelectedCommandes || !id) return;
    productionSelectionCustomized = true;
    productionFocusTarget = id;
    if (productionSelectedCommandes.has(id)) {
        productionSelectedCommandes.delete(id);
    } else {
        productionSelectedCommandes.add(id);
    }
    renderProduction();
};

const productionSelectAll = () => {
    const commandes = DB.get('commandes');
    const disponibles = commandes.filter(c => c.statut !== 'annulee' && c.statut !== 'livrée');
    productionSelectedCommandes = new Set(disponibles.map(c => c.id));
    productionSelectionCustomized = true;
    productionFocusTarget = 'selectAll';
    renderProduction();
};

const productionDeselectAll = () => {
    if (!productionSelectedCommandes) return;
    productionSelectionCustomized = true;
    productionSelectedCommandes.clear();
    productionFocusTarget = 'deselectAll';
    renderProduction();
};

const rebalanceRecipients = (aromeNom, recipientIndex, nouvelleValeur) => {
    const state = productionPlannerState;
    if (!state || !state.recipientsParArome || !state.recipientsParArome[aromeNom]) return;

    const recipients = state.recipientsParArome[aromeNom];
    if (!recipients || recipients.length === 0) return;

    const recipient = recipients[recipientIndex];
    if (!recipient) return;

    const autresIndices = recipients.map((_, i) => i).filter(i => i !== recipientIndex);
    const totalAvant = roundHalfLiter(recipients.reduce((sum, r) => sum + r.litres, 0));

    if (autresIndices.length === 0) {
        recipient.litres = totalAvant;
        mettreAJourRecipientsUI(aromeNom);
        return;
    }

    recipient.litres = Math.max(0.5, Math.min(recipient.capacite, roundHalfLiter(nouvelleValeur)));
    const delta = roundHalfLiter(totalAvant - recipients.reduce((sum, r) => sum + r.litres, 0));

    if (Math.abs(delta) < 0.001) {
        mettreAJourRecipientsUI(aromeNom);
        return;
    }

    const ajustables = autresIndices.filter(i => {
        if (delta > 0) return recipients[i].litres < recipients[i].capacite;
        return recipients[i].litres > 0.5;
    });

    if (ajustables.length === 0) {
        recipient.litres = Math.max(0.5, Math.min(recipient.capacite, roundHalfLiter(totalAvant - autresIndices.reduce((s, i) => s + recipients[i].litres, 0))));
        mettreAJourRecipientsUI(aromeNom);
        return;
    }

    let remainingUnits = Math.round(delta * 2);
    while (remainingUnits !== 0) {
        const candidates = ajustables.filter(i => remainingUnits > 0
            ? recipients[i].litres < recipients[i].capacite
            : recipients[i].litres > 0.5
        );
        if (candidates.length === 0) break;

        candidates.forEach(i => {
            if (remainingUnits === 0) return;
            const step = remainingUnits > 0 ? 0.5 : -0.5;
            const next = roundHalfLiter(recipients[i].litres + step);
            if (next >= 0.5 && next <= recipients[i].capacite) {
                recipients[i].litres = next;
                remainingUnits += remainingUnits > 0 ? -1 : 1;
            }
        });
    }

    const nouveauTotal = roundHalfLiter(recipients.reduce((sum, r) => sum + r.litres, 0));
    const erreur = roundHalfLiter(totalAvant - nouveauTotal);

    if (Math.abs(erreur) > 0.001) {
        const correctionIndices = autresIndices.filter(i => {
            if (erreur > 0) return recipients[i].litres < recipients[i].capacite;
            return recipients[i].litres > 0.5;
        });

        if (correctionIndices.length > 0) {
            const i = correctionIndices[0];
            recipients[i].litres = Math.max(0.5, Math.min(recipients[i].capacite, roundHalfLiter(recipients[i].litres + erreur)));
        } else {
            recipient.litres = Math.max(0.5, Math.min(recipient.capacite, roundHalfLiter(recipient.litres + erreur)));
        }
    }

    const aromes = DB.get('aromes') || [];
    const recettes = DB.get('recettes') || [];
    const arome = aromes.find(a => a.nom === aromeNom);
    const recette = recettes.find(r => r.aromeId === arome?.id);

    recipients.forEach(r => {
        r.ingredients = calculerIngredientsRecipient(recette, r.litres);
    });

    mettreAJourRecipientsUI(aromeNom);
};

const calculerIngredientsRecipient = (recette, litres) => {
    if (!recette || !Array.isArray(recette.ingredients) || litres <= 0) return [];
    return recette.ingredients.map(ing => ({
        nom: ing.nom,
        quantite: parseFloat(((parseFloat(ing.quantite) || 0) * litres).toFixed(2)),
        unite: ing.unite
    }));
};

const mettreAJourRecipientsUI = (aromeNom) => {
    const state = productionPlannerState;
    if (!state || !state.recipientsParArome || !state.recipientsParArome[aromeNom]) return;

    const recipients = state.recipientsParArome[aromeNom];

    document.querySelectorAll('.cuve-slider').forEach(slider => {
        if (slider.dataset.arome !== aromeNom) return;
        const idx = parseInt(slider.dataset.recipientIndex, 10);
        const recipient = recipients[idx];
        if (!recipient) return;

        slider.max = recipient.capacite;
        slider.value = recipient.litres;

        const detail = slider.closest('.cuve-detail');
        if (detail) {
            const display = detail.querySelector('.cuve-litres-display');
            if (display) display.textContent = `${recipient.litres.toFixed(1)}L`;

            const titre = detail.querySelector('.cuve-title');
            if (titre) {
                const fillPercent = recipient.capacite > 0 ? Math.round((recipient.litres / recipient.capacite) * 100) : 0;
                titre.textContent = `${recipient.nom} (${recipient.litres.toFixed(1)}L / ${recipient.capacite}L - ${fillPercent}%)`;
            }

            const ingList = detail.querySelector('.ingredient-list');
            if (ingList && recipient.ingredients) {
                ingList.innerHTML = recipient.ingredients.map(ing => `
                    <li>
                        <span>${escapeHtml(ing.nom)}</span>
                        <strong>${ing.quantite} ${displayUnit(ing.unite)}</strong>
                    </li>
                `).join('');
            }
        }
    });
};

const normalizeName = (value) => {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');
};

const findInventaireItemByName = (items, nom) => {
    const target = normalizeName(nom);
    return items.find(i => normalizeName(i.nom) === target) || null;
};

// Reconnaît « eau » comme mot entier (Eau, Eau minérale…), pas « Sureau » ou « Poireau »
const isWaterIngredient = (nom) => {
    const normalized = String(nom || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    return /(^|[^a-z0-9])eaux?($|[^a-z0-9])/.test(normalized);
};

const getBottleInventoryItem = (items, format) => {
    if (!format) return null;

    const cl = format.contenanceCl || 0;

    const normalizedInvItems = items.map(item => ({
        item,
        normalized: normalizeName(item.nom)
    }));

    const exactMatch = normalizedInvItems.find(({ normalized }) => {
        const hasNom = format.nom && normalizeName(`Bouteilles vides ${format.nom}`) === normalized;
        const hasCl = cl > 0 && normalizeName(`Bouteilles vides ${cl}cl`) === normalized;
        const hasL = cl > 0 && cl % 100 === 0 && normalizeName(`Bouteilles vides ${cl / 100}L`) === normalized;
        return hasNom || hasCl || hasL;
    });
    if (exactMatch) return exactMatch.item;

    const looseMatch = normalizedInvItems.find(({ normalized }) => {
        if (!normalized.includes('bouteillesvides') && !normalized.includes('bouteille')) return false;
        const numericPart = parseFloat(normalized.replace(/[^0-9.]/g, ''));
        if (!isNaN(numericPart) && numericPart > 0) {
            const inMl = numericPart < 10 ? numericPart * 1000 : numericPart < 100 ? numericPart * 10 : numericPart;
            return Math.abs(inMl - cl * 10) < 1;
        }
        return false;
    });
    if (looseMatch) return looseMatch.item;

    return null;
};

const confirmerProduction = (aromeNom, recipientIndex) => {
    try {
        const formats = DB.get('formats') || [];
        const state = productionPlannerState;

        if (!state || !state.recipientsParArome || !state.recipientsParArome[aromeNom]) {
            showToast('Plan de production introuvable, rechargez la page', 'error');
            return;
        }

        const recipient = state.recipientsParArome[aromeNom][recipientIndex];
        if (!recipient) {
            showToast('Récipient introuvable', 'error');
            return;
        }

        const litresTotalArome = state.litresParArome[aromeNom] || 0;
        const ratioRecipient = litresTotalArome > 0 ? (recipient.litres / litresTotalArome) : 0;

        const besoinsArome = Object.values(state.productionNecesaire || {}).filter(b => b.aromeNom === aromeNom && b.aProduire > 0);
        const prefillByFormat = {};
        besoinsArome.forEach(b => {
            prefillByFormat[b.formatNom] = Math.max(0, Math.floor((b.aProduire || 0) * ratioRecipient));
        });

        const formRows = formats.map(format => {
            const prefill = prefillByFormat[format.nom] || 0;
            return `
                <div class="form-group" style="margin-bottom: 10px;">
                    <label>${escapeHtml(format.nom)}</label>
                    <input type="number" min="0" step="1" data-format-id="${escapeHtml(String(format.id))}" value="${Number.isFinite(prefill) ? prefill : 0}">
                </div>
            `;
        }).join('');

        modal.show(`Production - ${aromeNom} - ${recipient.nom}`, `
            <form id="productionRecipientForm">
                <div style="margin-bottom: 16px; padding: 12px; background: var(--bg-secondary); border-radius: var(--radius);">
                    <strong>Ingrédients prévus pour ce récipient (${recipient.litres.toFixed(1)}L / ${recipient.capacite}L)</strong>
                    <ul class="ingredient-list" style="margin-top: 8px;">
                        ${recipient.ingredients.map(ing => `
                            <li>
                                <span>${escapeHtml(ing.nom)}</span>
                                <strong>${ing.quantite} ${displayUnit(ing.unite)}</strong>
                            </li>
                        `).join('')}
                    </ul>
                </div>
                <div>
                    <strong>Bouteilles produites (modifiable)</strong>
                    <div style="margin-top: 8px;">
                        ${formRows || '<p class="text-muted">Aucun format actif</p>'}
                    </div>
                </div>
            </form>
        `, `
            <button class="btn btn-secondary" onclick="modal.hide()">Annuler</button>
            <button class="btn btn-success" data-click="valider-production" data-arome="${escapeHtml(aromeNom)}" data-index="${recipientIndex}">Confirmer la production</button>
        `);
    } catch (e) {
        console.error('Error opening production modal:', e);
        showToast('Erreur ouverture confirmation production', 'error');
    }
};

const confirmerProductionArome = (aromeNom) => {
    try {
        const formats = DB.get('formats') || [];
        const aromes = DB.get('aromes') || [];
        const recettes = DB.get('recettes') || [];
        const state = productionPlannerState;

        if (!state || !state.recipientsParArome || !state.recipientsParArome[aromeNom]) {
            showToast('Plan de production introuvable, rechargez la page', 'error');
            return;
        }

        const recipients = state.recipientsParArome[aromeNom] || [];
        const totalLitres = recipients.reduce((sum, r) => sum + (r.litres || 0), 0);
        const besoinsArome = Object.values(state.productionNecesaire || {}).filter(b => b.aromeNom === aromeNom && b.aProduire > 0);
        const arome = aromes.find(a => a.nom === aromeNom);
        const recette = recettes.find(r => r.aromeId === arome?.id);
        const ingredients = calculerIngredientsRecipient(recette, totalLitres);

        const formRows = formats.map(format => {
            const prefill = besoinsArome.find(b => b.formatNom === format.nom)?.aProduire || 0;
            return `
                <div class="form-group" style="margin-bottom: 10px;">
                    <label>${escapeHtml(format.nom)}</label>
                    <input type="number" min="0" step="1" data-format-id="${escapeHtml(String(format.id))}" value="${Number.isFinite(prefill) ? prefill : 0}">
                </div>
            `;
        }).join('');

        modal.show(`Production groupée - ${aromeNom}`, `
            <form id="productionAromeForm">
                <div class="workflow-summary">
                    <div><span>Arôme</span><strong>${escapeHtml(aromeNom)}</strong></div>
                    <div><span>Récipients</span><strong>${recipients.length}</strong></div>
                    <div><span>Litres prévus</span><strong>${totalLitres.toFixed(1)} L</strong></div>
                    <div><span>Formats</span><strong>${besoinsArome.length}</strong></div>
                </div>
                <div style="margin-bottom: 16px; padding: 12px; background: var(--bg-secondary); border-radius: var(--radius);">
                    <strong>Ingrédients prévus pour tout l'arôme</strong>
                    <ul class="ingredient-list" style="margin-top: 8px;">
                        ${ingredients.map(ing => `
                            <li>
                                <span>${escapeHtml(ing.nom)}</span>
                                <strong>${ing.quantite} ${displayUnit(ing.unite)}</strong>
                            </li>
                        `).join('')}
                    </ul>
                </div>
                <div>
                    <strong>Bouteilles produites (modifiable)</strong>
                    <div style="margin-top: 8px;">
                        ${formRows || '<p class="text-muted">Aucun format actif</p>'}
                    </div>
                </div>
            </form>
        `, `
            <button class="btn btn-secondary" onclick="modal.hide()">Annuler</button>
            <button class="btn btn-success" data-click="valider-production-arome" data-arome="${escapeHtml(aromeNom)}">Confirmer tout l'arôme</button>
        `, 'large');
    } catch (e) {
        console.error('Error opening grouped production modal:', e);
        showToast('Erreur ouverture production groupée', 'error');
    }
};

const finaliserProductionFormats = async (aromeNom, producedByFormat, litresProduit, totalBouteilles) => {
    const aromes = DB.get('aromes') || [];
    const recettes = DB.get('recettes') || [];
    const inventaire = (DB.get('inventaire') || []).map(item => ({ ...item }));
    const lots = DB.get('lots') || [];
    const history = DB.get('history') || [];
    const arome = aromes.find(a => a.nom === aromeNom);
    const recette = recettes.find(r => r.aromeId === arome?.id);
    const warnings = [];
    // Erreurs de conversion incompatibles : bloquantes, distinctes des
    // avertissements métier (stock / ingrédient manquant). Une incohérence
    // d'unités ne peut jamais être confirmée par l'utilisateur : on annule
    // AVANT toute persistance (premier DB.set plus bas) et on prévient en
    // français avec le premier élément + le nombre restant.
    const conversionErrors = [];

    if (recette && Array.isArray(recette.ingredients)) {
        recette.ingredients.forEach(ing => {
            if (isWaterIngredient(ing.nom)) return;
            const ingQty = parseFloat(ing.quantite);
            if (Number.isNaN(ingQty)) {
                warnings.push(`Quantité de recette invalide pour ${ing.nom}`);
                return;
            }
            const besoinMajore = ingQty * litresProduit * CONSTANTS.PRODUCTION_LOSS;
            const item = findInventaireItemByName(inventaire, ing.nom);
            if (!item) {
                warnings.push(`Ingrédient absent: ${ing.nom}`);
                return;
            }
            const ingUnit = displayUnit(ing.unite);
            const invUnit = displayUnit(item.unite);
            if (!areUnitsCompatible(ingUnit, invUnit)) {
                conversionErrors.push(`Unité incompatible pour ${ing.nom} (recette: ${ingUnit}, inventaire: ${invUnit})`);
                return;
            }
            const converted = ingUnit !== invUnit ? convertQuantity(besoinMajore, ingUnit, invUnit) : besoinMajore;
            if (converted === null) {
                conversionErrors.push(`Conversion impossible pour ${ing.nom}`);
                return;
            }
            if ((item.quantite || 0) < converted) warnings.push(`Stock insuffisant: ${item.nom}`);
            item.quantite = Math.round(((item.quantite || 0) - converted) * 10000) / 10000;
        });
    } else {
        warnings.push(`Recette introuvable pour ${aromeNom}`);
    }

    if (conversionErrors.length > 0) {
        const first = conversionErrors[0];
        const remaining = conversionErrors.length - 1;
        showToast(
            `Production annulée : ${first}${remaining > 0 ? ` (+${remaining} autre${remaining > 1 ? 's' : ''})` : ''}. Corrigez les unités de la recette.`,
            'error'
        );
        return false;
    }

    producedByFormat.forEach(({ format, quantite }) => {
        const bottleItem = getBottleInventoryItem(inventaire, format);
        if (!bottleItem) {
            warnings.push(`Bouteilles vides absentes pour ${format.nom}`);
        } else {
            if ((bottleItem.quantite || 0) < quantite) warnings.push(`Stock insuffisant: ${bottleItem.nom}`);
            bottleItem.quantite = (bottleItem.quantite || 0) - quantite;
        }
    });

    // Bouchons : déduction par taille (25cl vs 50/100cl)
    let btPetitBouchon = 0, btGrandBouchon = 0;
    producedByFormat.forEach(({ format, quantite }) => {
        if ((format.contenanceCl || 0) < 50) btPetitBouchon += quantite;
        else btGrandBouchon += quantite;
    });

    const bouchonsPetitsNecessaires = Math.ceil(btPetitBouchon * CONSTANTS.CAPSULE_LOSS);
    const bouchonsGrandsNecessaires = Math.ceil(btGrandBouchon * CONSTANTS.CAPSULE_LOSS);

    if (bouchonsPetitsNecessaires > 0) {
        const bouchonPetitItem = findInventaireItemByName(inventaire, 'Bouchons 25cl');
        if (bouchonPetitItem) {
            if ((bouchonPetitItem.quantite || 0) < bouchonsPetitsNecessaires) warnings.push(`Stock insuffisant: ${bouchonPetitItem.nom}`);
            bouchonPetitItem.quantite = (bouchonPetitItem.quantite || 0) - bouchonsPetitsNecessaires;
        } else {
            warnings.push('Bouchons 25cl absents de l\'inventaire');
        }
    }
    if (bouchonsGrandsNecessaires > 0) {
        const bouchonGrandItem = findInventaireItemByName(inventaire, 'Bouchons 50cl/100cl');
        if (bouchonGrandItem) {
            if ((bouchonGrandItem.quantite || 0) < bouchonsGrandsNecessaires) warnings.push(`Stock insuffisant: ${bouchonGrandItem.nom}`);
            bouchonGrandItem.quantite = (bouchonGrandItem.quantite || 0) - bouchonsGrandsNecessaires;
        } else {
            warnings.push('Bouchons 50cl/100cl absents de l\'inventaire');
        }
    }

    if (warnings.length > 0) {
        const ok = await confirmDialog(
            `Attention: ${warnings[0]}${warnings.length > 1 ? ` (+${warnings.length - 1})` : ''}. Confirmer quand même la production ?`,
            { danger: true, confirmLabel: 'Confirmer quand même', title: 'Inventaire insuffisant' }
        );
        if (!ok) return false;
    }

    const dateProduction = getLocalDateISOString();
    const dates = calculateDates(dateProduction);

    // Un seul numLot par arôme + date de production (commun à tous les formats)
    let numLot;
    const existingLotForArome = lots.find(l => l.arome === aromeNom && l.dateProduction === dateProduction);
    if (existingLotForArome) {
        numLot = existingLotForArome.numLot || existingLotForArome.id;
    } else {
        numLot = nextLotNumero(lots, history);
    }

    producedByFormat.forEach(({ format, quantite }) => {
        let lot = lots.find(l => l.arome === aromeNom && l.format === format.nom && l.dateProduction === dateProduction);
        if (lot) {
            lot.quantite = (lot.quantite || 0) + quantite;
            if (!lot.numLot) lot.numLot = numLot;
        } else {
            lot = { id: generateId(), numLot, arome: aromeNom, format: format.nom, quantite, dateProduction, dlv: dates.dlv, dlc: dates.dlc };
            lots.push(lot);
        }
        history.unshift(buildLotHistoryEntry('PROD', lot, quantite));
    });

    DB.set('inventaire', inventaire);
    DB.set('lots', lots);
    DB.set('history', history);
    return { warnings };
};

const validerProductionArome = async (event, aromeNom) => {
    const reenable = disableSaveBtn(event);
    try {
        const form = document.getElementById('productionAromeForm');
        if (!form) {
            showToast('Données de production introuvables', 'error');
            return;
        }

        const formats = DB.get('formats') || [];
        const producedByFormat = [];
        let totalBouteilles = 0;
        let litresProduit = 0;

        formats.forEach(format => {
            const input = [...form.querySelectorAll('[data-format-id]')].find(el => el.dataset.formatId === format.id);
            const quantite = Math.max(0, parseInt(input?.value, 10) || 0);
            if (quantite > 0) {
                producedByFormat.push({ format, quantite });
                totalBouteilles += quantite;
                litresProduit += ((format.contenanceCl || 0) * quantite) / 100;
            }
        });

        if (producedByFormat.length === 0) {
            showToast('Veuillez saisir au moins une quantité produite', 'warning');
            return;
        }

        const result = await finaliserProductionFormats(aromeNom, producedByFormat, litresProduit, totalBouteilles);
        if (!result) return;

        modal.hide();
        showToast(`Production groupée confirmée: ${totalBouteilles} bouteille(s) ajoutée(s)`);
        if (result.warnings.length > 0) {
            showToast(`Attention: ${result.warnings[0]}${result.warnings.length > 1 ? ` (+${result.warnings.length - 1})` : ''}`, 'warning');
        }
        renderProduction();
    } catch (e) {
        console.error('Error validating grouped production:', e);
        showToast('Erreur lors de la validation de la production groupée', 'error');
    } finally {
        if (reenable) reenable();
    }
};

const validerProduction = async (event, aromeNom, recipientIndex) => {
    const reenable = disableSaveBtn(event);
    try {
        const state = productionPlannerState;
        const form = document.getElementById('productionRecipientForm');
        if (!form || !state || !state.recipientsParArome || !state.recipientsParArome[aromeNom]) {
            showToast('Données de production introuvables', 'error');
            return;
        }

        const recipient = state.recipientsParArome[aromeNom][recipientIndex];
        if (!recipient) {
            showToast('Récipient introuvable', 'error');
            return;
        }

        const formats = DB.get('formats') || [];
        const producedByFormat = [];
        let totalBouteilles = 0;
        let litresProduit = 0;

        formats.forEach(format => {
            const input = [...form.querySelectorAll('[data-format-id]')].find(el => el.dataset.formatId === format.id);
            const quantite = Math.max(0, parseInt(input?.value, 10) || 0);
            if (quantite > 0) {
                producedByFormat.push({ format, quantite });
                totalBouteilles += quantite;
                litresProduit += ((format.contenanceCl || 0) * quantite) / 100;
            }
        });

        if (producedByFormat.length === 0) {
            showToast('Veuillez saisir au moins une quantité produite', 'warning');
            return;
        }

        const result = await finaliserProductionFormats(aromeNom, producedByFormat, litresProduit, totalBouteilles);
        if (!result) return;

        modal.hide();
        showToast(`Production confirmée: ${totalBouteilles} bouteille(s) ajoutée(s) au stock`);
        if (result.warnings.length > 0) {
            showToast(`Attention: ${result.warnings[0]}${result.warnings.length > 1 ? ` (+${result.warnings.length - 1})` : ''}`, 'warning');
        }
        renderProduction();
    } catch (e) {
        console.error('Error validating production:', e);
        showToast('Erreur lors de la validation de la production', 'error');
    } finally {
        if (reenable) reenable();
    }
};

// Consommables « contenants » toujours attendus (bouteilles + bouchons)
const CONTAINER_CONSOMMABLES = [
    { nom: 'Bouteilles vides 25cl', unite: 'pcs', seuilAlerte: 0 },
    { nom: 'Bouteilles vides 50cl', unite: 'pcs', seuilAlerte: 0 },
    { nom: 'Bouteilles vides 1L', unite: 'pcs', seuilAlerte: 0 },
    { nom: 'Bouchons 25cl', unite: 'pcs', seuilAlerte: 0 },
    { nom: 'Bouchons 50cl/100cl', unite: 'pcs', seuilAlerte: 0 }
];

// Migration unique : garantit la présence des bouteilles et bouchons dans un inventaire existant
const ensureContainerConsommables = (items) => {
    if (localStorage.getItem('thecol_migr_contenants') === '1') return items;
    let changed = false;

    // Héritage : un ancien article « Capsules » devient « Bouchons 50cl/100cl »
    const capsulesAncien = items.find(item => normalizeName(item.nom).includes('capsule'));
    if (capsulesAncien && !findInventaireItemByName(items, 'Bouchons 50cl/100cl')) {
        capsulesAncien.nom = 'Bouchons 50cl/100cl';
        changed = true;
    }

    CONTAINER_CONSOMMABLES.forEach(c => {
        if (!findInventaireItemByName(items, c.nom)) {
            items.push({ id: generateId(), categorie: 'consommable', quantite: 0, ...c });
            changed = true;
        }
    });

    if (changed) DB.set('inventaire', items);
    localStorage.setItem('thecol_migr_contenants', '1');
    return items;
};

// Inventaire
const renderInventaire = () => {
    // Initialize default consumables if list is empty
    const defaultConsommables = [
        { nom: 'Eau', unite: 'L', seuilAlerte: 0 },
        { nom: 'Sucre', unite: 'kg', seuilAlerte: 0 },
        { nom: 'Citron', unite: 'kg', seuilAlerte: 0 },
        { nom: 'Menthe', unite: 'kg', seuilAlerte: 0 },
        { nom: 'Hibiscus', unite: 'kg', seuilAlerte: 0 },
        { nom: 'Mûre sauvage', unite: 'kg', seuilAlerte: 0 },
        { nom: 'Poire à botzi', unite: 'kg', seuilAlerte: 0 },
        { nom: 'Sureau', unite: 'kg', seuilAlerte: 0 },
        { nom: 'Herbes des alpes', unite: 'kg', seuilAlerte: 0 },
        { nom: 'Bouchons 25cl', unite: 'pcs', seuilAlerte: 0 },
        { nom: 'Bouchons 50cl/100cl', unite: 'pcs', seuilAlerte: 0 },
        { nom: 'Étiquettes', unite: 'pcs', seuilAlerte: 0 },
        { nom: 'Bouteilles vides 25cl', unite: 'pcs', seuilAlerte: 0 },
        { nom: 'Bouteilles vides 50cl', unite: 'pcs', seuilAlerte: 0 },
        { nom: 'Bouteilles vides 1L', unite: 'pcs', seuilAlerte: 0 }
    ];

    let items = DB.get('inventaire');
    if (items.length === 0) {
        items = defaultConsommables.map(item => ({
            ...item,
            id: generateId(),
            categorie: 'consommable',
            quantite: 0
        }));
        DB.set('inventaire', items);
    }
    // Ajoute bouteilles + bouchons aux inventaires existants qui ne les ont pas encore (une seule fois)
    items = ensureContainerConsommables(items);

    const savedSearch = DB.getFilter('inventaire_search');
    const savedType = DB.getFilter('inventaire_type') || 'tous';
    const filterInventaireItem = (item) => {
        const isAlerte = item.seuilAlerte && item.quantite <= item.seuilAlerte;
        const matchesType = savedType === 'tous' ||
            (savedType === 'alerte' && isAlerte) ||
            item.categorie === savedType;
        return matchesType && includesText(`${item.nom} ${item.unite} ${item.categorie}`, savedSearch);
    };

    const consommables = items.filter(i => i.categorie === 'consommable').filter(filterInventaireItem);
    const equipement = items.filter(i => i.categorie === 'equipement').filter(filterInventaireItem);
    const allConsommablesCount = items.filter(i => i.categorie === 'consommable').length;
    const allEquipementCount = items.filter(i => i.categorie === 'equipement').length;
    const alertItems = items.filter(item => item.seuilAlerte && (item.quantite || 0) <= item.seuilAlerte);

    const unités = ['pcs', 'kg', 'L', 'mL', 'g', 'm', 'caisse(s)'];

    let html = `
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon blue">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                </div>
                <div class="stat-content"><h3>${items.length}</h3><p>Articles total</p></div>
            </div>
            <div class="stat-card">
                <div class="stat-icon green">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
                </div>
                <div class="stat-content"><h3>${allConsommablesCount}</h3><p>Consommables</p></div>
            </div>
            <div class="stat-card">
                <div class="stat-icon orange">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
                </div>
                <div class="stat-content"><h3>${allEquipementCount}</h3><p>Équipement</p></div>
            </div>
            <a href="#inventaire" class="stat-card stat-link" onclick="DB.setFilter('inventaire_type', 'alerte'); renderInventaire()">
                <div class="stat-icon red">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
                </div>
                <div class="stat-content"><h3>${alertItems.length}</h3><p>Stock bas</p></div>
            </a>
        </div>

        ${alertItems.length > 0 ? `
        <div class="card" style="border-left: 4px solid var(--warning); background: var(--bg-warning);">
            <div class="flex-between">
                <div>
                    <strong>Articles sous seuil</strong>
                    <p style="margin-top: 4px; color: var(--text-light);">${alertItems.slice(0, 4).map(item => `${escapeHtml(item.nom)} (${escapeHtml(String(item.quantite))} ${escapeHtml(displayUnit(item.unite))})`).join(', ')}${alertItems.length > 4 ? ` +${alertItems.length - 4}` : ''}</p>
                </div>
                <button class="btn btn-sm btn-secondary" onclick="DB.setFilter('inventaire_type', 'alerte'); renderInventaire()">Voir</button>
            </div>
        </div>
        ` : ''}

        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Inventaire</h3>
                <div class="card-actions">
                    <button class="btn btn-sm btn-secondary" onclick="showInventaireModal('consommable')">+ Consommable</button>
                    <button class="btn btn-sm btn-secondary" onclick="showInventaireModal('equipement')">+ Équipement</button>
                </div>
            </div>

            <div class="filters">
                ${renderSegmentedFilter('inventaire_type', savedType, [
                    { value: 'tous', label: 'Tous' },
                    { value: 'alerte', label: 'Stock bas' },
                    { value: 'consommable', label: 'Consommables' },
                    { value: 'equipement', label: 'Équipement' }
                ], 'renderInventaire')}
                <input type="search" id="filterInventaireSearch" placeholder="Rechercher un item..." value="${escapeHtml(savedSearch)}" oninput="DB.setFilter('inventaire_search', this.value); window.__focusInventaireSearch = true; renderInventaire()">
            </div>

            <!-- Consommables Section -->
            <div class="inventaire-section">
                <h4>Consommables</h4>
                <div class="inventaire-grid">
                    ${consommables.length === 0 ? renderEmptyState('Aucun consommable trouvé.', '<button class="btn btn-primary" onclick="showInventaireModal(\'consommable\')">Ajouter un consommable</button>') :
                        consommables.map(item => {
                            const isAlerte = item.seuilAlerte && item.quantite <= item.seuilAlerte;
                            return `
                            <div class="inventaire-item ${isAlerte ? 'alerte' : ''}">
                                <span class="inventaire-item-name">${escapeHtml(item.nom)}</span>
                                <div class="inventaire-qty-controls">
                                    <button class="btn btn-sm btn-secondary" data-click="update-inventaire-qty" data-id="${escapeHtml(item.id)}" data-delta="-1">−</button>
                                    <input class="inventaire-qty-input" type="number" step="0.01" value="${escapeHtml(safeNumAttr(item.quantite))}" data-change="set-inventaire-qty" data-id="${escapeHtml(item.id)}">
                                    <span class="inventaire-unit">${escapeHtml(item.unite)}</span>
                                    <button class="btn btn-sm btn-secondary" data-click="update-inventaire-qty" data-id="${escapeHtml(item.id)}" data-delta="1">+</button>
                                </div>
                                <div class="inventaire-item-actions">
                                    <button class="btn btn-sm btn-secondary" data-click="show-inventaire-modal" data-type="consommable" data-id="${escapeHtml(item.id)}">✏️</button>
                                    <button class="btn btn-sm btn-danger" data-click="delete-inventaire-item" data-id="${escapeHtml(item.id)}">×</button>
                                </div>
                            </div>
                            ${isAlerte ? `<div class="inventaire-alerte-text">Stock bas! Seuil: ${item.seuilAlerte} ${item.unite}</div>` : ''}
                          `;
                      }).join('')}
                </div>
            </div>

            <!-- Équipement Section (collapsible) -->
            <div class="inventaire-section">
                <h4 class="inventaire-section-heading">
                    <button type="button" class="inventaire-section-header" onclick="toggleEquipementSection()" aria-expanded="false" aria-controls="equipementContent">
                        <span>Équipement</span>
                        <span class="inventaire-toggle" id="equipementToggle">▶</span>
                    </button>
                </h4>
                <div class="inventaire-grid collapse-content" id="equipementContent">
                    ${equipement.length === 0 ? renderEmptyState('Aucun équipement trouvé.', '<button class="btn btn-primary" onclick="showInventaireModal(\'equipement\')">Ajouter un équipement</button>') :
                      equipement.map(item => {
                            const isAlerte = item.seuilAlerte && item.quantite <= item.seuilAlerte;
                            return `
                            <div class="inventaire-item ${isAlerte ? 'alerte' : ''}">
                                <span class="inventaire-item-name">${escapeHtml(item.nom)}</span>
                                <div class="inventaire-qty-controls">
                                    <button class="btn btn-sm btn-secondary" data-click="update-inventaire-qty" data-id="${escapeHtml(item.id)}" data-delta="-1">−</button>
                                    <input class="inventaire-qty-input" type="number" step="0.01" value="${escapeHtml(safeNumAttr(item.quantite))}" data-change="set-inventaire-qty" data-id="${escapeHtml(item.id)}">
                                    <span class="inventaire-unit">${escapeHtml(item.unite)}</span>
                                    <button class="btn btn-sm btn-secondary" data-click="update-inventaire-qty" data-id="${escapeHtml(item.id)}" data-delta="1">+</button>
                                </div>
                                <div class="inventaire-item-actions">
                                    <button class="btn btn-sm btn-secondary" data-click="show-inventaire-modal" data-type="equipement" data-id="${escapeHtml(item.id)}">✏️</button>
                                    <button class="btn btn-sm btn-danger" data-click="delete-inventaire-item" data-id="${escapeHtml(item.id)}">×</button>
                                </div>
                            </div>
                            ${isAlerte ? `<div class="inventaire-alerte-text">Stock bas! Seuil: ${item.seuilAlerte} ${item.unite}</div>` : ''}
                          `;
                      }).join('')}
                </div>
            </div>
        </div>
    `;

    safeRender(html);
    if (window.__focusInventaireSearch) {
        const input = document.getElementById('filterInventaireSearch');
        if (input) {
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
        }
        window.__focusInventaireSearch = false;
    }
};

// Toggle equipement section
const toggleEquipementSection = () => {
    const content = document.getElementById('equipementContent');
    const toggle = document.getElementById('equipementToggle');
    const isOpen = content.classList.toggle('open');
    toggle.textContent = isOpen ? '▼' : '▶';
    toggle.parentElement?.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
};

// Show inventaire modal
const showInventaireModal = (categorie, id = null) => {
    const items = DB.get('inventaire') || [];
    const item = id ? items.find(i => i.id === id) : null;

    const unités = ['pcs', 'kg', 'L', 'mL', 'g', 'm', 'caisse(s)'];

    modal.show(id ? 'Modifier item' : 'Nouvel item', `
        <form id="inventaireForm">
            <input type="hidden" name="categorie" value="${escapeHtml(categorie)}">
            <div class="form-group">
                <label>Nom</label>
                <input type="text" name="nom" value="${escapeHtml(item?.nom || '')}" required>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Quantité</label>
                    <input type="number" name="quantite" value="${escapeHtml(safeNumAttr(item?.quantite))}" min="0" required>
                </div>
                <div class="form-group">
                    <label>Unité</label>
                    <select name="unite" required>
                        ${unités.map(u => `<option value="${u}" ${item?.unite === u ? 'selected' : ''}>${u}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label>Seuil d'alerte (stock bas)</label>
                <input type="number" name="seuilAlerte" value="${item?.seuilAlerte || 0}" min="0">
                <small class="text-muted">Alerte quand la quantité est en dessous de ce seuil</small>
            </div>
        </form>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Annuler</button>
        <button class="btn btn-primary" data-click="save-inventaire-item" data-id="${escapeHtml(id || '')}">Enregistrer</button>
    `);
};

// Save inventaire item
const saveInventaireItem = (event, id) => {
    const reenable = disableSaveBtn(event);
    try {
        const form = document.getElementById('inventaireForm');
        if (!form?.reportValidity()) return;
        const formData = new FormData(form);

        const item = {
            id: id || generateId(),
            categorie: formData.get('categorie'),
            nom: formData.get('nom'),
            quantite: parseFloat(formData.get('quantite')) || 0,
            unite: displayUnit(formData.get('unite')),
            seuilAlerte: parseFloat(formData.get('seuilAlerte')) || 0
        };

        const items = DB.get('inventaire');
        if (id) {
            const index = items.findIndex(i => i.id === id);
            items[index] = item;
        } else {
            items.push(item);
        }
        DB.set('inventaire', items);

        modal.hide();
        showToast('Item enregistré');
        renderCurrentView();
    } catch (e) {
        console.error('Error saving inventaire item:', e);
        showToast('Erreur lors de l\'enregistrement de l\'item', 'error');
    } finally {
        if (reenable) reenable();
    }
};

// Update inventaire quantity
const updateInventaireQty = (id, delta) => {
    const items = DB.get('inventaire');
    const item = items.find(i => i.id === id);
    if (item) {
        item.quantite = Math.max(0, (item.quantite || 0) + delta);
        DB.set('inventaire', items);
        renderCurrentView();
    }
};

const setInventaireQty = (id, value) => {
    const items = DB.get('inventaire');
    const item = items.find(i => i.id === id);
    if (!item) return;
    const qty = parseFloat(value);
    if (Number.isNaN(qty) || qty < 0) {
        showToast('Quantité invalide', 'error');
        renderInventaire();
        return;
    }
    item.quantite = Math.round(qty * 100) / 100;
    DB.set('inventaire', items);
    showToast(`${item.nom}: stock ajusté à ${item.quantite} ${displayUnit(item.unite)}`);
    renderInventaire();
};

// Delete inventaire item
const deleteInventaireItem = (id) => {
    confirmDialog('Supprimer cet item ?', { danger: true }).then(ok => {
        if (!ok) return;
        const items = DB.get('inventaire').filter(i => i.id !== id);
        DB.set('inventaire', items);
        showToast('Item supprimé');
        renderCurrentView();
    });
};

// Restauration du backup pré-synchronisation
const restorePreSyncBackup = () => {
    confirmDialog('Restaurer les données telles qu\'elles étaient avant la dernière synchronisation cloud ? Les modifications effectuées depuis seront perdues.', { danger: true, confirmLabel: 'Restaurer' }).then(ok => {
        if (!ok) return;
        try {
            const backup = JSON.parse(localStorage.getItem('thecol_backup_pre_sync') || '{}');
            Object.entries(backup).forEach(([k, v]) => localStorage.setItem(k, v));
            showToast('Backup pré-synchro restauré');
            renderCurrentView();
        } catch(e) {
            console.error('restorePreSyncBackup:', e);
            showToast('Erreur lors de la restauration du backup', 'error');
        }
    });
};

// Settings
const renderParametres = () => {
    const employes = DB.get('employees') || [];
    const aromes = DB.get('aromes') || [];
    const formats = DB.get('formats') || [];
    const recettes = DB.get('recettes') || [];
    const clients = DB.get('clients') || [];

    let html = `
        <div class="settings-grid">
            <div class="settings-card">
                <div class="settings-card-header">
                    <h3>Employés</h3>
                    <button class="btn btn-sm btn-primary" data-click="show-employe-modal">+ Ajouter</button>
                </div>
                <ul class="settings-list">
                    ${employes.length === 0 ? '<li class="settings-item text-muted">Aucun employé</li>' :
                      employes.map(e => `
                        <li class="settings-item">
                            <div class="settings-item-info">
                                <span class="color-dot" style="background: var(--primary)"></span>
                                <span>${escapeHtml(e.prenom)} ${escapeHtml(e.nom)}</span>
                                <span class="badge ${e.actif ? 'badge-success' : 'badge-default'}">${e.actif ? 'Actif' : 'Inactif'}</span>
                            </div>
                            <div class="settings-item-actions">
                                 <button class="btn btn-sm btn-secondary" data-click="show-employe-modal" data-id="${escapeHtml(e.id)}">Modifier</button>
                                 <button class="btn btn-sm btn-danger" data-click="delete-employe" data-id="${escapeHtml(e.id)}">Supprimer</button>
                            </div>
                        </li>
                      `).join('')}
                </ul>
            </div>

            <div class="settings-card">
                <div class="settings-card-header">
                    <h3>Arômes</h3>
                     <button class="btn btn-sm btn-primary" data-click="show-arome-modal">+ Ajouter</button>
                </div>
                <ul class="settings-list">
                    ${aromes.length === 0 ? '<li class="settings-item text-muted">Aucun arôme</li>' :
                      aromes.map(a => `
                        <li class="settings-item">
                            <div class="settings-item-info">
                                <span class="color-dot" style="background: ${safeColor(a.couleur)}"></span>
                                <span>${escapeHtml(a.nom)}</span>
                                <span class="badge ${a.actif ? 'badge-success' : 'badge-default'}">${a.actif ? 'Actif' : 'Inactif'}</span>
                            </div>
                            <div class="settings-item-actions">
                                 <button class="btn btn-sm btn-secondary" data-click="show-arome-modal" data-id="${escapeHtml(a.id)}">Modifier</button>
                                 <button class="btn btn-sm btn-danger" data-click="delete-arome" data-id="${escapeHtml(a.id)}">Supprimer</button>
                            </div>
                        </li>
                      `).join('')}
                </ul>
            </div>

            <div class="settings-card">
                <div class="settings-card-header">
                    <h3>Formats</h3>
                     <button class="btn btn-sm btn-primary" data-click="show-format-modal">+ Ajouter</button>
                </div>
                <ul class="settings-list">
                    ${formats.length === 0 ? '<li class="settings-item text-muted">Aucun format</li>' :
                      formats.map(f => `
                        <li class="settings-item">
                            <div class="settings-item-info">
                                <span>${escapeHtml(f.nom)}</span>
                                <span class="text-muted">(${f.contenanceCl} cl)</span>
                                <span class="badge ${f.actif ? 'badge-success' : 'badge-default'}">${f.actif ? 'Actif' : 'Inactif'}</span>
                            </div>
                            <div class="settings-item-actions">
                                 <button class="btn btn-sm btn-secondary" data-click="show-format-modal" data-id="${escapeHtml(f.id)}">Modifier</button>
                                 <button class="btn btn-sm btn-danger" data-click="delete-format" data-id="${escapeHtml(f.id)}">Supprimer</button>
                            </div>
                        </li>
                      `).join('')}
                </ul>
            </div>

            <div class="settings-card">
                <div class="settings-card-header">
                    <h3>Recettes</h3>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-sm btn-secondary" data-click="sync-recettes-inventaire">Synchroniser inventaire</button>
                        <button class="btn btn-sm btn-primary" data-click="show-recette-modal">+ Ajouter</button>
                    </div>
                </div>
                <ul class="settings-list">
                    ${recettes.length === 0 ? '<li class="settings-item text-muted">Aucune recette</li>' :
                      recettes.map(r => {
                          const arome = aromes.find(a => a.id === r.aromeId);
                          return `
                            <li class="settings-item">
                                <div class="settings-item-info">
                                    <span class="color-dot" style="background: ${safeColor(arome?.couleur)}"></span>
                                    <span>${escapeHtml(r.nom)}</span>
                                    <span class="text-muted">(${r.ingredients.length} ingrédient${r.ingredients.length > 1 ? 's' : ''})</span>
                                </div>
                                <div class="settings-item-actions">
                                    <button class="btn btn-sm btn-secondary" data-click="show-recette-modal" data-id="${escapeHtml(r.id)}">Modifier</button>
                                    <button class="btn btn-sm btn-danger" data-click="delete-recette" data-id="${escapeHtml(r.id)}">Supprimer</button>
                                </div>
                            </li>
                          `;
                      }).join('')}
                </ul>
            </div>

            <div class="settings-card" style="grid-column: 1 / -1;">
                <div class="settings-card-header">
                    <h3>Clients</h3>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <button class="btn btn-sm btn-secondary" data-click="export-clients-excel">Exporter Excel</button>
                        <button class="btn btn-sm btn-secondary" data-click="trigger-import-clients">Importer Excel</button>
                        <input type="file" id="importClientsFile" accept=".xlsx,.xls" style="display:none" data-change="import-clients-excel">
                        <button class="btn btn-sm btn-primary" data-click="show-client-modal">+ Ajouter</button>
                        <button class="btn btn-sm btn-danger" data-click="reset-clients">Effacer tout</button>
                    </div>
                </div>
                <ul class="settings-list">
                    ${clients.length === 0 ? '<li class="settings-item text-muted">Aucun client</li>' :
                      clients.map(c => `
                        <li class="settings-item">
                            <div class="settings-item-info">
                                <div><strong>${escapeHtml(c.societe || '')}</strong> ${escapeHtml(c.nom || '')}</div>
                                <div class="text-muted" style="font-size:12px;">${escapeHtml(c.adresse || '')} ${escapeHtml(c.npa || '')}</div>
                                <span class="badge ${c.actif ? 'badge-success' : 'badge-default'}">${c.actif ? 'Actif' : (c.ponctuel ? 'Ponctuel' : 'Inactif')}</span>
                            </div>
                            <div class="settings-item-actions">
                                <button class="btn btn-sm btn-secondary" data-click="show-client-modal" data-id="${escapeHtml(c.id)}">Modifier</button>
                                <button class="btn btn-sm btn-danger" data-click="delete-client" data-id="${escapeHtml(c.id)}">Supprimer</button>
                            </div>
                        </li>
                      `).join('')}
                </ul>
            </div>

            <div class="settings-card" style="grid-column: 1 / -1;">
                <div class="settings-card-header">
                    <h3>Sauvegarde & Restauration</h3>
                </div>
                <div style="display: flex; gap: 12px; flex-wrap: wrap; padding: 12px;">
                    <button class="btn btn-primary" onclick="exportAllData()">💾 Sauvegarder tout (JSON)</button>
                    <button class="btn btn-secondary" onclick="document.getElementById('importDataFile').click()">📂 Restaurer depuis JSON</button>
                    ${localStorage.getItem('thecol_backup_pre_sync') ? `
                    <button class="btn btn-secondary" onclick="restorePreSyncBackup()">♻️ Restaurer le backup pré-synchro</button>
                    ` : ''}
                    <input type="file" id="importDataFile" accept=".json" style="display:none" onchange="importAllData(event)">
                </div>
                <p class="text-muted" style="font-size: 12px; padding: 0 12px 12px;">
                    La sauvegarde inclut: employés, aromes, formats, recettes, clients, lots, commandes et pointages.
                </p>
            </div>

            <div class="settings-card" style="grid-column: 1 / -1;">
                <div class="settings-card-header">
                    <h3>Compte</h3>
                </div>
                <div style="padding: 12px;">
                    <button class="btn btn-secondary" id="logoutBtnSettings" type="button">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                        Déconnexion
                    </button>
                    <p style="margin-top: 8px; font-size: 12px; color: var(--text-light);">
                        Fermer la session et revenir à l'écran de verrouillage.
                    </p>
                </div>
            </div>
        </div>
    `;

    safeRender(html);

    // Attacher l'écouteur du bouton Déconnexion (rendu via innerHTML)
    const logoutSettingsBtn = document.getElementById('logoutBtnSettings');
    if (logoutSettingsBtn) {
        logoutSettingsBtn.addEventListener('click', window.handleLogout);
    }
};

// Settings - Employes
const showEmployeModal = (id = null) => {
    const employes = DB.get('employees');
    const emp = id ? employes.find(e => e.id === id) : null;

    modal.show(id ? 'Modifier employé' : 'Nouvel employé', `
        <form id="employeForm">
            <div class="form-row">
                <div class="form-group">
                    <label>Nom</label>
                    <input type="text" name="nom" value="${escapeHtml(emp?.nom || '')}" required>
                </div>
                <div class="form-group">
                    <label>Prénom</label>
                    <input type="text" name="prenom" value="${escapeHtml(emp?.prenom || '')}" required>
                </div>
            </div>
            <div class="form-row">

                <div class="form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" name="actif" ${emp?.actif !== false ? 'checked' : ''}>
                        Actif
                    </label>
                </div>
            </div>
        </form>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Annuler</button>
        <button class="btn btn-primary" data-click="save-employe" data-id="${escapeHtml(id || '')}">Enregistrer</button>
    `);
};

const saveEmploye = (event, id) => {
    const reenable = disableSaveBtn(event);
    try {
        const form = document.getElementById('employeForm');
        if (!form?.reportValidity()) return;
        const formData = new FormData(form);

        const employe = {
            id: id || generateId(),
            nom: formData.get('nom'),
            prenom: formData.get('prenom'),
            actif: form.querySelector('input[name="actif"]').checked
        };

        const employes = DB.get('employees');
        if (id) {
            const index = employes.findIndex(e => e.id === id);
            employes[index] = employe;
        } else {
            employes.push(employe);
        }
        DB.set('employees', employes);

        modal.hide();
        showToast('Employé enregistré');
        renderParametres();
    } catch (e) {
        console.error('Error saving employee:', e);
        showToast('Erreur lors de l\'enregistrement de l\'employé', 'error');
    } finally {
        if (reenable) reenable();
    }
};

const deleteEmploye = (id) => {
    const pointages = DB.get('pointages');
    const hasPointages = pointages.some(p => p.employeId === id);

    if (hasPointages) {
        showToast('Impossible de supprimer cet employé : il a des pointages enregistrés. Vous pouvez le désactiver à la place.', 'error');
        return;
    }

    confirmDialog('Êtes-vous sûr de vouloir supprimer cet employé ?', { danger: true }).then(ok => {
        if (!ok) return;
        const employes = DB.get('employees').filter(e => e.id !== id);
        DB.set('employees', employes);
        showToast('Employé supprimé');
        renderParametres();
    });
};

// Settings - Aromes
const showAromeModal = (id = null) => {
    const aromes = DB.get('aromes');
    const arome = id ? aromes.find(a => a.id === id) : null;

    modal.show(id ? 'Modifier arôme' : 'Nouvel arôme', `
        <form id="aromeForm">
            <div class="form-group">
                <label>Nom</label>
                <input type="text" name="nom" value="${escapeHtml(arome?.nom || '')}" required>
            </div>
            <div class="form-group">
                <label>Couleur (code hex)</label>
                <input type="color" name="couleur" value="${escapeHtml(arome?.couleur || '#5D7B3E')}" style="height: 40px; padding: 4px;">
            </div>
            <div class="form-group">
                <label class="checkbox-label">
                    <input type="checkbox" name="actif" ${arome?.actif !== false ? 'checked' : ''}>
                    Actif
                </label>
            </div>
        </form>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Annuler</button>
        <button class="btn btn-primary" data-click="save-arome" data-id="${escapeHtml(id || '')}">Enregistrer</button>
    `);
};

const saveArome = (event, id) => {
    const reenable = disableSaveBtn(event);
    try {
        const form = document.getElementById('aromeForm');
        if (!form?.reportValidity()) return;
        const formData = new FormData(form);

        const arome = {
            id: id || generateId(),
            nom: formData.get('nom'),
            couleur: formData.get('couleur'),
            actif: form.querySelector('input[name="actif"]').checked
        };

        const aromes = DB.get('aromes');
        let ancienNom = null;
        if (id) {
            const index = aromes.findIndex(a => a.id === id);
            ancienNom = aromes[index]?.nom || null;
            aromes[index] = arome;
        } else {
            aromes.push(arome);
        }
        DB.set('aromes', aromes);
        // Répercute le renommage sur les lots/historique/livraisons (référencés par nom)
        if (id && ancienNom && ancienNom !== arome.nom) {
            cascadeRenameLots('arome', ancienNom, arome.nom);
        }

        modal.hide();
        showToast('Arôme enregistré');
        renderParametres();
    } catch (e) {
        console.error('Error saving arome:', e);
        showToast('Erreur lors de l\'enregistrement de l\'arôme', 'error');
    } finally {
        if (reenable) reenable();
    }
};

const deleteArome = (id) => {
    const commandes = DB.get('commandes');
    const recettes = DB.get('recettes');

    const isUsedInCommandes = commandes.some(c => getItems(c).some(i => i.aromeId === id));
    const isUsedInRecettes = recettes.some(r => r.aromeId === id);

    if (isUsedInCommandes || isUsedInRecettes) {
        showToast('Impossible de supprimer cet arôme : il est utilisé dans des commandes ou des recettes. Vous pouvez le désactiver à la place.', 'error');
        return;
    }

    confirmDialog('Êtes-vous sûr de vouloir supprimer cet arôme ?', { danger: true }).then(ok => {
        if (!ok) return;
        const aromes = DB.get('aromes').filter(a => a.id !== id);
        DB.set('aromes', aromes);
        showToast('Arôme supprimé');
        renderParametres();
    });
};

// Settings - Formats
const showFormatModal = (id = null) => {
    const formats = DB.get('formats');
    const format = id ? formats.find(f => f.id === id) : null;

    modal.show(id ? 'Modifier format' : 'Nouveau format', `
        <form id="formatForm">
            <div class="form-row">
                <div class="form-group">
                    <label>Nom (ex: 50cl, 1L)</label>
                    <input type="text" name="nom" value="${escapeHtml(format?.nom || '')}" required>
                </div>
                <div class="form-group">
                    <label>Contenance (cl)</label>
                    <input type="number" name="contenanceCl" value="${format?.contenanceCl || 50}" min="1" required>
                </div>
            </div>
            <div class="form-group">
                <label class="checkbox-label">
                    <input type="checkbox" name="actif" ${format?.actif !== false ? 'checked' : ''}>
                    Actif
                </label>
            </div>
        </form>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Annuler</button>
        <button class="btn btn-primary" data-click="save-format" data-id="${escapeHtml(id || '')}">Enregistrer</button>
    `);
};

const saveFormat = (event, id) => {
    const reenable = disableSaveBtn(event);
    try {
        const form = document.getElementById('formatForm');
        if (!form?.reportValidity()) return;
        const formData = new FormData(form);

        const format = {
            id: id || generateId(),
            nom: formData.get('nom'),
            contenanceCl: parseInt(formData.get('contenanceCl')),
            actif: form.querySelector('input[name="actif"]').checked
        };

        const formats = DB.get('formats');
        let ancienNom = null;
        if (id) {
            const index = formats.findIndex(f => f.id === id);
            ancienNom = formats[index]?.nom || null;
            formats[index] = format;
        } else {
            formats.push(format);
        }
        DB.set('formats', formats);
        // Répercute le renommage sur les lots/historique/livraisons (référencés par nom)
        if (id && ancienNom && ancienNom !== format.nom) {
            cascadeRenameLots('format', ancienNom, format.nom);
        }

        modal.hide();
        showToast('Format enregistré');
        renderParametres();
    } catch (e) {
        console.error('Error saving format:', e);
        showToast('Erreur lors de l\'enregistrement du format', 'error');
    } finally {
        if (reenable) reenable();
    }
};

const deleteFormat = (id) => {
    const commandes = DB.get('commandes');
    const isUsedInCommandes = commandes.some(c => getItems(c).some(i => i.formatId === id));

    if (isUsedInCommandes) {
        showToast('Impossible de supprimer ce format : il est utilisé dans des commandes. Vous pouvez le désactiver à la place.', 'error');
        return;
    }

    confirmDialog('Êtes-vous sûr de vouloir supprimer ce format ?', { danger: true }).then(ok => {
        if (!ok) return;
        const formats = DB.get('formats').filter(f => f.id !== id);
        DB.set('formats', formats);
        showToast('Format supprimé');
        renderParametres();
    });
};

// Settings - Recettes
const showRecetteModal = (id = null) => {
    const aromes = DB.get('aromes');
    const recettes = DB.get('recettes');
    const recette = id ? recettes.find(r => r.id === id) : null;

    if (aromes.length === 0) {
        showToast('Veuillez d\'abord ajouter des aromes', 'error');
        return;
    }

    const inventaire = DB.get('inventaire') || [];
    const consumableNames = inventaire.filter(i => i.categorie === 'consommable').map(i => i.nom);
    const suggestionsId = 'ingredientSuggestions';
    const suggestionsList = consumableNames.length > 0
        ? `<datalist id="${suggestionsId}">${consumableNames.map(n => `<option value="${escapeHtml(n)}">`).join('')}</datalist>`
        : '';

    const ingredientsHtml = recette ? recette.ingredients.map((ing, idx) => `
        <div class="ingredient-row">
            <input type="text" name="ingredients[${idx}][nom]" value="${escapeHtml(ing.nom)}" placeholder="Ingrédient" list="${suggestionsId}" required>
            <input type="number" name="ingredients[${idx}][quantite]" value="${escapeHtml(safeNumAttr(ing.quantite))}" placeholder="Qté" step="0.01" min="0.01" required>
            <input type="text" name="ingredients[${idx}][unite]" value="${escapeHtml(displayUnit(ing.unite))}" placeholder="Unité" required>
            <button type="button" class="btn btn-sm btn-danger" onclick="this.parentElement.remove()">×</button>
        </div>
    `).join('') : `<div class="ingredient-row"><input type="text" name="ingredients[0][nom]" placeholder="Ingrédient" list="${suggestionsId}" required><input type="number" name="ingredients[0][quantite]" placeholder="Qté" step="0.01" min="0.01" required><input type="text" name="ingredients[0][unite]" placeholder="Unité" required><button type="button" class="btn btn-sm btn-danger" onclick="this.parentElement.remove()">×</button></div>`;

    // Filter out aromes that already have a recipe (except the one being edited)
    const availableAromes = aromes.filter(a => {
        if (!a.actif) return false;
        if (recette && recette.aromeId === a.id) return true;
        const existingRecipe = recettes.find(r => r.aromeId === a.id);
        return !existingRecipe;
    });

    modal.show(id ? 'Modifier recette' : 'Nouvelle recette', `
        <form id="recetteForm">
            <div class="form-group">
                <label>Arôme (recette pour 1 litre)</label>
                <select name="aromeId" required ${id ? 'disabled' : ''}>
                    ${availableAromes.length === 0 && !recette ? '<option value="">Aucun arôme disponible</option>' :
                      aromes.filter(a => {
                          if (!a.actif) return false;
                          if (recette && recette.aromeId === a.id) return true;
                          const existingRecipe = recettes.find(r => r.aromeId === a.id);
                          return !existingRecipe;
                      }).map(a => `<option value="${escapeHtml(a.id)}" ${recette?.aromeId === a.id ? 'selected' : ''}>${escapeHtml(a.nom)}</option>`).join('')}
                </select>
                ${id ? '<input type="hidden" name="aromeId" value="' + escapeHtml(recette.aromeId) + '">' : ''}
            </div>
            <div class="form-group">
                <label>Ingrédients (pour 1 litre de cet arôme)</label>
                ${suggestionsList}
                <div id="ingredientsContainer" style="display: flex; flex-direction: column; gap: 8px;">
                    ${ingredientsHtml}
                </div>
                <button type="button" class="btn btn-sm btn-secondary mt-4" onclick="addIngredient()">+ Ajouter ingrédient</button>
            </div>
        </form>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Annuler</button>
        <button class="btn btn-primary" data-click="save-recette" data-id="${escapeHtml(id || '')}">Enregistrer</button>
    `);
};

const addIngredient = () => {
    const container = document.getElementById('ingredientsContainer');
    const index = container.querySelectorAll('.ingredient-row').length;

    const div = document.createElement('div');
    div.className = 'ingredient-row';
    div.innerHTML = `
        <input type="text" name="ingredients[${index}][nom]" placeholder="Ingrédient" list="ingredientSuggestions" required>
        <input type="number" name="ingredients[${index}][quantite]" placeholder="Qté" step="0.01" min="0.01" required>
        <input type="text" name="ingredients[${index}][unite]" placeholder="Unité" required>
        <button type="button" class="btn btn-sm btn-danger" onclick="this.parentElement.remove()">×</button>
    `;
    container.appendChild(div);
};

const saveRecette = (event, id) => {
    const reenable = disableSaveBtn(event);
    const form = document.getElementById('recetteForm');
    if (!form) {
        showToast('Formulaire de recette introuvable', 'error');
        if (reenable) reenable();
        return;
    }
    const formData = new FormData(form);

    const ingredients = [];
    const incompleteIngredients = [];
    const invalidQuantities = [];
    const invalidUnits = [];
    const rows = document.querySelectorAll('.ingredient-row');
    rows.forEach((row, idx) => {
        const nom = row.querySelector(`input[name="ingredients[${idx}][nom]"]`)?.value || row.querySelector('[name*="nom"]')?.value;
        const quantite = row.querySelector(`input[name="ingredients[${idx}][quantite]"]`)?.value || row.querySelector('[name*="quantite"]')?.value;
        const rawUnite = row.querySelector(`input[name="ingredients[${idx}][unite]"]`)?.value || row.querySelector('[name*="unite"]')?.value;

        if (!nom || !quantite || !rawUnite) {
            incompleteIngredients.push(`Ingrédient ${idx + 1}`);
            return;
        }

        const quantiteValue = Number(quantite);
        if (!Number.isFinite(quantiteValue) || quantiteValue <= 0) {
            invalidQuantities.push(nom);
            return;
        }

        const unite = displayUnit(rawUnite);
        if (!isValidUnit(unite)) {
            invalidUnits.push(`${nom} (${rawUnite})`);
            return;
        }
        ingredients.push({ nom, quantite: quantiteValue, unite });
    });

    if (incompleteIngredients.length > 0) {
        showToast('Veuillez compléter tous les ingrédients', 'error');
        if (reenable) reenable();
        return;
    }
    if (invalidQuantities.length > 0) {
        showToast(`La quantité doit être supérieure à zéro: ${invalidQuantities.join(', ')}`, 'error');
        if (reenable) reenable();
        return;
    }
    if (invalidUnits.length > 0) {
        showToast(`Unité invalide: ${invalidUnits.join(', ')}`, 'error');
        if (reenable) reenable();
        return;
    }

    const inventaire = DB.get('inventaire') || [];
    const missingIngredients = ingredients.filter(ing => {
        if (isWaterIngredient(ing.nom)) return false;
        return !findInventaireItemByName(inventaire, ing.nom);
    });
    if (missingIngredients.length > 0) {
        showToast(`Ingrédient(s) absents de l'inventaire: ${missingIngredients.map(i => i.nom).join(', ')}`, 'warning');
    }

    // Get aromeId from select or hidden input
    let aromeId = formData.get('aromeId');
    if (!aromeId) {
        const hiddenInput = form.querySelector('input[name="aromeId"][type="hidden"]');
        aromeId = hiddenInput?.value;
    }

    const recettes = DB.get('recettes');
    const arome = DB.get('aromes').find(a => a.id === aromeId);
    if (!arome) {
        showToast('Arôme de recette invalide', 'error');
        if (reenable) reenable();
        return;
    }

    const recette = {
        id: id || generateId(),
        aromeId: aromeId,
        nom: arome.nom,
        ingredients
    };

    if (id) {
        const index = recettes.findIndex(r => r.id === id);
        recettes[index] = recette;
    } else {
        recettes.push(recette);
    }
    DB.set('recettes', recettes);

    if (reenable) reenable();
    modal.hide();
    showToast('Recette enregistrée');
    renderParametres();
};

const deleteRecette = (id) => {
    confirmDialog('Êtes-vous sûr de vouloir supprimer cette recette ?', { danger: true }).then(ok => {
        if (!ok) return;
        const recettes = DB.get('recettes').filter(r => r.id !== id);
        DB.set('recettes', recettes);
        showToast('Recette supprimée');
        renderParametres();
    });
};

const syncRecettesInventaire = () => {
    const recettes = DB.get('recettes') || [];
    const inventaire = DB.get('inventaire') || [];

    const uniqueIngredients = new Map();

    recettes.forEach(recette => {
        (recette.ingredients || []).forEach(ing => {
            if (isWaterIngredient(ing.nom)) return;
            const normalized = normalizeName(ing.nom);
            if (!uniqueIngredients.has(normalized)) {
                uniqueIngredients.set(normalized, { nom: ing.nom, unite: ing.unite || 'pcs' });
            }
        });
    });

    let ajouteCount = 0;

    uniqueIngredients.forEach(({ nom, unite }, normalized) => {
        const existing = findInventaireItemByName(inventaire, nom);
        if (!existing) {
            inventaire.push({
                id: generateId(),
                categorie: 'consommable',
                nom,
                quantite: 0,
                unite,
                seuilAlerte: 0
            });
            ajouteCount++;
        }
    });

    // Migration bouchons : 2 articles distincts par taille (25cl vs 50/100cl)
    const bouchon25Existant = findInventaireItemByName(inventaire, 'Bouchons 25cl');
    const bouchon50Existant = findInventaireItemByName(inventaire, 'Bouchons 50cl/100cl');
    const capsulesAncien = inventaire.find(item => normalizeName(item.nom).includes('capsule'));

    if (capsulesAncien && !bouchon50Existant) {
        capsulesAncien.nom = 'Bouchons 50cl/100cl';
    }
    if (!bouchon25Existant && !findInventaireItemByName(inventaire, 'Bouchons 25cl')) {
        inventaire.push({ id: generateId(), categorie: 'consommable', nom: 'Bouchons 25cl', quantite: 0, unite: 'pcs', seuilAlerte: 0 });
        ajouteCount++;
    }
    if (!findInventaireItemByName(inventaire, 'Bouchons 50cl/100cl') && !capsulesAncien) {
        inventaire.push({ id: generateId(), categorie: 'consommable', nom: 'Bouchons 50cl/100cl', quantite: 0, unite: 'pcs', seuilAlerte: 0 });
        ajouteCount++;
    }

    DB.set('inventaire', inventaire);

    if (ajouteCount === 0) {
        showToast('Inventaire déjà synchronisé — aucun ingrédient manquant');
    } else {
        showToast(`${ajouteCount} ingrédient(s) ajouté(s) à l'inventaire`);
        renderInventaire();
    }
};

// Settings - Clients
const showClientModal = (id = null) => {
    const clients = DB.get('clients');
    const client = id ? clients.find(c => c.id === id) : null;

    modal.show(id ? 'Modifier client' : 'Nouveau client', `
        <form id="clientForm">
            <div class="form-row">
                <div class="form-group">
                    <label>Société</label>
                    <input type="text" name="societe" value="${escapeHtml(client?.societe || '')}">
                </div>
                <div class="form-group">
                    <label>Prénom & Nom</label>
                    <input type="text" name="nom" value="${escapeHtml(client?.nom || '')}">
                </div>
            </div>
            <div class="form-group">
                <label>Adresse</label>
                <input type="text" name="adresse" value="${escapeHtml(client?.adresse || '')}">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>NPA & Localité</label>
                    <input type="text" name="npa" value="${escapeHtml(client?.npa || '')}">
                </div>
                <div class="form-group">
                    <label>Catégorie tarif</label>
                    <select name="tarifs" onchange="applyTarifPreset(this)">
                        ${(() => {
                            const cat = normalizeTarifKey(client?.tarifs);
                            return `
                            <option value="custom" ${cat === 'custom' ? 'selected' : ''}>Personnalisé</option>
                            <option value="distributeur" ${cat === 'distributeur' ? 'selected' : ''}>Distributeur (2.25 / 3.80 / 6.–)</option>
                            <option value="prive" ${cat === 'prive' ? 'selected' : ''}>Privé (3.– / 5.– / 8.50)</option>
                            <option value="restaurant" ${cat === 'restaurant' ? 'selected' : ''}>Restaurant (litre 4.–)</option>`;
                        })()}
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Prix 25cl</label>
                    <input type="text" name="prix25cl" value="${escapeHtml(client?.prix25cl || '')}" oninput="onPrixInputChange()">
                </div>
                <div class="form-group">
                    <label>Prix 50cl</label>
                    <input type="text" name="prix50cl" value="${escapeHtml(client?.prix50cl || '')}" oninput="onPrixInputChange()">
                </div>
                <div class="form-group">
                    <label>Prix 100cl</label>
                    <input type="text" name="prix100cl" value="${escapeHtml(client?.prix100cl || '')}" oninput="onPrixInputChange()">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Mode facturation</label>
                    <input type="text" name="modeFact" value="${escapeHtml(client?.modeFact || '')}">
                </div>
                <div class="form-group">
                    <label>Coordonnées</label>
                    <input type="text" name="coord" value="${escapeHtml(client?.coord || '')}">
                </div>
            </div>
            <div class="form-group">
                <label class="checkbox-label">
                    <input type="checkbox" name="actif" ${client?.actif !== false ? 'checked' : ''}>
                    Actif
                </label>
            </div>
        </form>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Annuler</button>
        <button class="btn btn-primary" data-click="save-client" data-id="${escapeHtml(id || '')}">Enregistrer</button>
    `);
};

const saveClient = (event, id) => {
    const reenable = disableSaveBtn(event);
    try {
        const form = document.getElementById('clientForm');
        if (!form?.reportValidity()) return;
        const formData = new FormData(form);

        const client = {
            id: id || generateId(),
            societe: formData.get('societe') || '',
            nom: formData.get('nom') || '',
            adresse: formData.get('adresse') || '',
            npa: formData.get('npa') || '',
            tarifs: formData.get('tarifs') || '',
            prix25cl: formData.get('prix25cl') || '',
            prix50cl: formData.get('prix50cl') || '',
            prix100cl: formData.get('prix100cl') || '',
            modeFact: formData.get('modeFact') || '',
            coord: formData.get('coord') || '',
            actif: form.querySelector('input[name="actif"]').checked
        };
        if (!client.societe.trim() && !client.nom.trim()) {
            showToast('Veuillez renseigner le nom ou la société du client', 'error');
            return;
        }

        const clients = DB.get('clients');
        if (id) {
            const index = clients.findIndex(c => c.id === id);
            clients[index] = client;
        } else {
            clients.push(client);
        }
        DB.set('clients', clients);

        modal.hide();
        showToast('Client enregistré');
        renderCurrentView();
    } catch (e) {
        console.error('Error saving client:', e);
        showToast('Erreur lors de l\'enregistrement du client', 'error');
    } finally {
        if (reenable) reenable();
    }
};

const deleteClient = (id) => {
    const commandes = DB.get('commandes');
    const isUsedInCommandes = commandes.some(c => c.clientId === id);

    if (isUsedInCommandes) {
        showToast('Impossible de supprimer ce client : il a des commandes associées. Vous pouvez le désactiver à la place.', 'error');
        return;
    }

    confirmDialog('Êtes-vous sûr de vouloir supprimer ce client ?', { danger: true }).then(ok => {
        if (!ok) return;
        const clients = DB.get('clients').filter(c => c.id !== id);
        DB.set('clients', clients);
        showToast('Client supprimé');
        renderParametres();
    });
};

// Excel: Export/Import Clients
const exportClientsExcel = () => {
  const clients = DB.get('clients') || [];
  const data = clients.map(c => ({
    Société: c.societe || '',
    'Prénom & Nom': c.nom || '',
    Adresse: c.adresse || '',
    'NPA & Localité': c.npa || '',
    Tarifs: c.tarifs || '',
    '25cl': c.prix25cl || '',
    '50cl': c.prix50cl || '',
    '100cl': c.prix100cl || '',
    'Mode facturation': c.modeFact || '',
    Coordonnées: c.coord || '',
    Actif: c.actif ? 'Oui' : 'Non'
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Clients');
  const date = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `clients_${date}.xlsx`);
  showToast('Clients exportés (Excel)');
};

const importClientsExcel = (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const data = e.target.result;
    const wb = XLSX.read(data, { type: 'array' });
    const wsName = wb.SheetNames[0];
    const ws = wb.Sheets[wsName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    if (!rows || rows.length < 2) {
      showToast('Fichier Excel vide ou invalide', 'error');
      return;
    }
    const headers = rows[0].map(h => String(h).toLowerCase().trim());
    const findIdx = (names) => {
      for (let i = 0; i < names.length; i++) {
        const idx = headers.findIndex(h => h.includes(names[i]));
        if (idx >= 0) return idx;
      }
      return -1;
    };
    const idx = {
      societe: findIdx(['société', 'societe']),
      nom: findIdx(['nom', 'prénom', 'prenom']),
      adresse: findIdx(['adresse']),
      npa: findIdx(['npa', 'localité', 'localite']),
      tarifs: findIdx(['tarif']),
      '25cl': findIdx(['25cl']),
      '50cl': findIdx(['50cl']),
      '100cl': findIdx(['100cl']),
      modeFact: findIdx(['mode', 'facturation']),
      coord: findIdx(['coordonnées', 'coordonnees', 'contact'])
    };
    const newClients = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;
      const getVal = (i) => row[i] !== undefined ? String(row[i]).trim() : '';
      newClients.push({
        id: generateId(),
        societe: idx.societe >= 0 ? getVal(idx.societe) : '',
        nom: idx.nom >= 0 ? getVal(idx.nom) : '',
        adresse: idx.adresse >= 0 ? getVal(idx.adresse) : '',
        npa: idx.npa >= 0 ? getVal(idx.npa) : '',
        tarifs: idx.tarifs >= 0 ? getVal(idx.tarifs) : '',
        prix25cl: idx['25cl'] >= 0 ? getVal(idx['25cl']) : '',
        prix50cl: idx['50cl'] >= 0 ? getVal(idx['50cl']) : '',
        prix100cl: idx['100cl'] >= 0 ? getVal(idx['100cl']) : '',
        modeFact: idx.modeFact >= 0 ? getVal(idx.modeFact) : '',
        coord: idx.coord >= 0 ? getVal(idx.coord) : '',
        actif: true
      });
    }
    if (newClients.length > 0) {
      const clients = DB.get('clients') || [];
      clients.push(...newClients);
      DB.set('clients', clients);
      showToast(`${newClients.length} client(s) importé(s)`);
      renderParametres();
    } else {
      showToast('Aucun client détecté', 'error');
    }
  };
  reader.readAsArrayBuffer(file);
  event.target.value = '';
};

// Mobile menu toggle
const openSidebar = () => {
    document.querySelector('.sidebar').classList.add('open');
    document.getElementById('sidebarOverlay')?.classList.add('active');
};

const closeSidebar = () => {
    document.querySelector('.sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay')?.classList.remove('active');
};

document.getElementById('menuToggle')?.addEventListener('click', () => {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar.classList.contains('open')) {
        closeSidebar();
    } else {
        openSidebar();
    }
});

// Close sidebar on overlay tap
document.getElementById('sidebarOverlay')?.addEventListener('click', closeSidebar);

// Close sidebar when navigating on mobile
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        if (window.innerWidth <= 768) closeSidebar();
    });
});

// Reset clients data if corrupted
const resetClients = () => {
    confirmDialog('Voulez-vous effacer tous les clients et recommencer ?', { danger: true, confirmLabel: 'Effacer tout' }).then(ok => {
        if (!ok) return;
        DB.set('clients', []);
        showToast('Clients effacés');
        renderParametres();
    });
};

// Export all data to JSON
const exportAllData = () => {
    const data = {};
    ALL_TABLES.forEach(table => {
        data[table] = DB.get(table) || [];
    });
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().split('T')[0];
    a.href = url;
    a.download = `sauvegarde_${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
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

const importAllData = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            const tablesToImport = ALL_TABLES.filter(table => Array.isArray(data[table]));

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
        } catch(err) {
            console.error('Import rollback:', err);
            showToast('Erreur: fichier invalide', 'error');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
};

// Bottom sheet (Plus menu) toggle
const toggleBottomSheet = () => {
    const overlay = document.getElementById('bottomSheetOverlay');
    const sheet = document.getElementById('bottomSheet');
    if (!overlay || !sheet) return;
    const isActive = overlay.classList.toggle('active');
    sheet.classList.toggle('active', isActive);
};
const closeBottomSheet = () => {
    document.getElementById('bottomSheetOverlay')?.classList.remove('active');
    document.getElementById('bottomSheet')?.classList.remove('active');
};

// V11 — Online listener: s'il y a queue, bootstrap ou schéma non prêt,
// appelle v11BootFirebase() (qui sérialise via _bootPromise), sinon flush.
// Ne déclenche jamais loadFromFirebase legacy pour une queue v11 pending.
// GARDE stricte : si non authentifié, sortir immédiatement sans réinitialiser
// Firebase — le SDK est déjà chargé, c'est juste l'utilisateur qui n'est pas
// connecté. Initialiser dynamiquement UNIQUEMENT si les objets SDK n'existent pas.
if (!window.__v11OnlineListenerRegistered) {
    window.__v11OnlineListenerRegistered = true;
    window.addEventListener('online', async () => {
        // Si pas authentifié, rien à synchroniser
        if (!window.firebaseReady) {
            // SDK jamais chargé (module script a échoué) → tenter init
            // pour permettre une reconnexion ultérieure
            if (!window.firebaseDb && !window.firebaseAuth) {
                await window.initFirebase?.();
            }
            return; // Jamais de V11 sans session
        }
        const queue = v11GetQueue();
        const needsBoot = queue.length > 0 || V11._bootstrapping || V11._migrating || !V11._isReady;
        if (needsBoot) {
            console.log('[V11] Online — boot nécessaire (queue=' + queue.length + ', bootstrapping=' + V11._bootstrapping + ', isReady=' + V11._isReady + ')');
            v11BootFirebase();
        } else if (V11._isReady) {
            console.log('[V11] Online — déclenchement du flush');
            setTimeout(() => v11FlushQueue(), 100);
        }
    });
}

// =============================================================================
// Authentification — Login / Logout
// =============================================================================

// Connexion : appelée depuis le formulaire de l'écran de verrouillage.
// Lit le mot de passe saisi, appelle Firebase Auth (email technique fixe),
// affiche les erreurs en français sans révéler l'adresse email.
window.handleLogin = async () => {
    const passwordInput = document.getElementById('loginPassword');
    const errorEl = document.getElementById('loginError');
    const busyEl = document.getElementById('loginBusy');
    const btn = document.getElementById('loginBtn');

    if (!passwordInput) return;

    // Si le SDK Auth n'a jamais été chargé (module script a échoué),
    // tenter un init dynamique avant d'abandonner
    if (!window.firebaseAuth) {
        try {
            await window.initFirebase?.();
        } catch (_) {}
        if (!window.firebaseAuth) {
            // Auth toujours indisponible même après tentative
            if (errorEl) { errorEl.textContent = 'Service d\'authentification indisponible. Vérifiez votre connexion réseau.'; errorEl.style.display = 'block'; }
            return;
        }
    }

    const password = passwordInput.value;
    if (!password || !password.trim()) {
        if (errorEl) { errorEl.textContent = 'Veuillez saisir le mot de passe.'; errorEl.style.display = 'block'; }
        passwordInput.focus();
        return;
    }

    // État « en cours »
    if (errorEl) { errorEl.textContent = ''; errorEl.style.display = 'none'; }
    if (busyEl) busyEl.style.display = 'flex';
    if (btn) btn.style.display = 'none';
    passwordInput.disabled = true;

    try {
        await window.firebaseAuth.signIn(password);
        // Le callback onAuthStateChanged dans le module Firebase gère la suite
        // (masquer l'écran, lancer l'app)
    } catch (e) {
        // Restaurer le formulaire
        passwordInput.disabled = false;
        if (busyEl) busyEl.style.display = 'none';
        if (btn) btn.style.display = 'inline-flex';
        passwordInput.focus();
        passwordInput.select();

        // Traduire les erreurs Firebase en français sans révéler l'email technique
        const code = e?.code || '';
        let message = 'Erreur de connexion.';
        if (code === 'auth/wrong-password' || code === 'auth/invalid-credential' || code === 'auth/user-not-found') {
            message = 'Mot de passe incorrect.';
        } else if (code === 'auth/too-many-requests') {
            message = 'Trop de tentatives. Réessayez plus tard.';
        } else if (code === 'auth/network-request-failed' || code === 'auth/internal-error') {
            message = 'Erreur réseau. Vérifiez votre connexion.';
        } else if (code === 'auth/invalid-email') {
            message = 'Identifiant invalide.';
        } else {
            message = 'Erreur de connexion. Vérifiez votre mot de passe et votre réseau.';
        }
        if (errorEl) { errorEl.textContent = message; errorEl.style.display = 'block'; }
        console.error('[Login]', code, e?.message);
    }
};

// Déconnexion : délègue tout le nettoyage au callback onAuthStateChanged
// via resetAppSession(). SignOut() déclenche le callback user=null qui
// exécute resetAppSession (idempotent). handleLogout n'effectue aucun
// cleanup manuel — plus de duplication ni de double incrément.
window.handleLogout = async () => {
    const ok = await confirmDialog('Voulez-vous vraiment vous déconnecter ?', {
        danger: true,
        confirmLabel: 'Se déconnecter',
        cancelLabel: 'Annuler',
        title: 'Déconnexion'
    });
    if (!ok) return;

    // La déconnexion Firebase Auth déclenche onAuthStateChanged(user=null)
    // dont le callback appelle resetAppSession() qui nettoie tout
    // (firebaseReady, _appStarted, sessionGen, listeners, contenu, login).
    // Aucun cleanup manuel ici — resetAppSession est idempotent.
    if (window.firebaseAuth) {
        try {
            await window.firebaseAuth.signOut();
        } catch (e) {
            console.error('[Logout]', e);
            showToast('Erreur lors de la déconnexion. Réessayez.', 'error');
        }
    } else {
        // Pas de Firebase — réinitialisation manuelle
        resetAppSession();
    }
};

// Attacher les écouteurs de l'écran de connexion (appelé au démarrage)
const initLoginListeners = () => {
    const btn = document.getElementById('loginBtn');
    if (btn) btn.addEventListener('click', window.handleLogin);

    const passwordInput = document.getElementById('loginPassword');
    if (passwordInput) {
        passwordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                window.handleLogin();
            }
        });
    }

    // Bouton Déconnexion dans l'en-tête
    const logoutHeaderBtn = document.getElementById('logoutBtnHeader');
    if (logoutHeaderBtn) {
        logoutHeaderBtn.addEventListener('click', window.handleLogout);
    }
};

// Exposer v11StopAllListeners pour le module Firebase Auth
window.v11StopAllListeners = v11StopAllListeners;

// =============================================================================
// Verrouillage/déverrouillage du shell — zéro flash, zéro exposition aux
// lecteurs d'écran avant authentification.
// =============================================================================
const lockShell = () => {
    document.body.classList.add('body--locked');
    // Inerter le shell pour les lecteurs d'écran
    document.querySelector('.sidebar')?.setAttribute('aria-hidden', 'true');
    document.querySelector('.main-content')?.setAttribute('aria-hidden', 'true');
    document.querySelector('.bottom-nav')?.setAttribute('aria-hidden', 'true');
};
const unlockShell = () => {
    document.body.classList.remove('body--locked');
    document.querySelector('.sidebar')?.removeAttribute('aria-hidden');
    document.querySelector('.main-content')?.removeAttribute('aria-hidden');
    document.querySelector('.bottom-nav')?.removeAttribute('aria-hidden');
};
// Exposer pour le module Firebase et initFirebase dynamique
window.lockShell = lockShell;
window.unlockShell = unlockShell;

// =============================================================================
// Reset centralisé et idempotent de session — appelé par les deux callbacks
// onAuthStateChanged (module index + fallback initFirebase) quand user === null.
// Garantit : _appStarted=false, incrément unique de session, stop listeners,
// nettoyage du contenu métier, verrouillage shell/login, unhide sync.
// Le garde-fou _resetLock évite le double traitement lors d'un logout volontaire
// où signOut() et handleLogout bis se chevaucheraient.
// =============================================================================
let _resetLock = false;
const resetAppSession = () => {
    if (_resetLock) return;
    _resetLock = true;

    // 1. Flag d'état — invalide toute session
    window.firebaseReady = false;
    window._appStarted = false;
    _appSessionGen++;

    // 2. Arrêt des listeners temps réel et debounce
    v11StopAllListeners();
    if (V11._debounceTimer) { clearTimeout(V11._debounceTimer); V11._debounceTimer = null; }
    V11._pendingRender = false;

    // 3. Verrouillage du shell (aria-hidden + body--locked)
    lockShell();

    // 4. Nettoyage du contenu métier
    const content = document.getElementById('content');
    if (content) content.innerHTML = '';
    window.location.hash = '';

    // 5. Cacher le bouton Déconnexion dans l'en-tête
    const logoutBtn = document.getElementById('logoutBtnHeader');
    if (logoutBtn) logoutBtn.style.display = 'none';

    // 6. Afficher l'écran de verrouillage, réinitialiser le formulaire
    const loginScreen   = document.getElementById('loginScreen');
    const loginLoading  = document.getElementById('loginLoading');
    const loginForm     = document.getElementById('loginForm');
    const loginPassword = document.getElementById('loginPassword');
    const loginError    = document.getElementById('loginError');
    const loginBusy     = document.getElementById('loginBusy');
    const loginBtn      = document.getElementById('loginBtn');

    if (loginPassword) { loginPassword.value = ''; loginPassword.disabled = false; }
    if (loginError)    { loginError.textContent = ''; loginError.style.display = 'none'; }
    if (loginBusy)     loginBusy.style.display = 'none';
    if (loginBtn)      loginBtn.style.display = 'inline-flex';
    if (loginLoading)  loginLoading.style.display = 'none';
    if (loginForm)     loginForm.style.display = 'block';
    if (loginScreen)   loginScreen.style.display = 'flex';

    // 7. Cacher le bouton Sync
    const syncBtn = document.getElementById('syncBtn');
    if (syncBtn) syncBtn.style.display = 'none';

    // Libérer le verrou après un délai pour absorber un éventuel
    // second appel dans la même séquence (ex. module + fallback)
    setTimeout(() => { _resetLock = false; }, 500);
};
// Exposée pour le module Firebase (index.html) qui ne peut pas accéder
// aux const de app.js, et pour le fallback initFirebase en cas de signOut
// sans callback (pas de Firebase disponible).
window.resetAppSession = resetAppSession;

// =============================================================================
// Démarrage de l'application (appelé après authentification)
// =============================================================================

// Rendu « local d'abord » : on affiche l'écran immédiatement à partir des données
// locales (localStorage), SANS attendre le réseau. Sinon, quand Firebase est lent
// (réseau mobile) le premier rendu est retardé et l'app démarre sur un dashboard
// vide — il faut retoucher un onglet pour qu'il s'affiche. La synchronisation
// Firebase se fait ensuite en arrière-plan, avec un re-rendu si des données arrivent.
const bootLocal = () => {
    DB.init();
    initGlobalSearch();
    initPaletteAndShortcuts();
    // Migration silencieuse : normalise les valeurs legacy de client.tarifs
    try { migrateClientTarifs(); } catch (e) { console.warn('[migration] initiale', e); }
    // Renumérote les anciens lots « _ab12… » en numéros séquentiels (idempotent)
    try { migrateLotNumeros(); } catch (e) { console.warn('[migration] lots', e); }
    // Bottom sheet listeners (idempotent au relogin)
    if (!window._bottomSheetListenersDone) {
        window._bottomSheetListenersDone = true;
        document.getElementById('moreNavBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            toggleBottomSheet();
        });
        document.getElementById('bottomSheetOverlay')?.addEventListener('click', closeBottomSheet);
        document.querySelectorAll('.bottom-sheet-item').forEach(item => {
            item.addEventListener('click', closeBottomSheet);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeBottomSheet();
        });
    }
    initEventDelegation();
    router();
};

const bootFirebaseSync = async () => {
    // V11 flow: migration + real-time listeners
    await v11BootFirebase();
};

// Fonction idempotente appelée par le module Firebase après authentification
// restaurée (session persistante) ou réussie (login). Exécute le rendu local
// puis la synchronisation Firebase en arrière-plan.
window.startApp = () => {
    // Éviter le double démarrage
    if (window._appStarted) return;

    // Garde-fu de sécurité : démarrer l'app exige une session Firebase active.
    // Si un appelant non authentifié (console, script tiers, ordre de boot
    // précoce) tente unlockShell()+startApp(), on réinitialise la session
    // de manière sûre (flag, listeners, contenu métier, verrouillage shell)
    // et on abandonne le boot pour empêcher l'affichage des données locales.
    if (window.firebaseReady !== true) {
        if (typeof window.resetAppSession === 'function') {
            window.resetAppSession();
        }
        return;
    }

    window._appStarted = true;

    // Attacher les écouteurs de connexion/déconnexion si pas déjà fait
    if (!window._loginListenersInitialized) {
        initLoginListeners();
        window._loginListenersInitialized = true;
    }

    // Rendre visible le bouton Déconnexion dans l'en-tête
    const logoutBtn = document.getElementById('logoutBtnHeader');
    if (logoutBtn) logoutBtn.style.display = 'inline-flex';

    // Boot local d'abord (rendu immédiat depuis localStorage)
    bootLocal();

    // Boot Firebase / V11 en arrière-plan
    bootFirebaseSync();
};

// --- Amorçage initial : attacher les écouteurs de connexion ---
// On les attache dès que le DOM est prêt pour que le formulaire soit
// fonctionnel quand le module Firebase le révèle.
// Le flag _loginListenersInitialized évite les doublons si startApp
// est appelé avant DOMContentLoaded (session persistée).
if (!window._loginListenersInitialized) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            if (!window._loginListenersInitialized) {
                initLoginListeners();
                window._loginListenersInitialized = true;
            }
        }, { once: true });
    } else {
        initLoginListeners();
        window._loginListenersInitialized = true;
    }
}
