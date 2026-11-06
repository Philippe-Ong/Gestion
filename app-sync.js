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
    _memoryProtectedTables: new Set(), // tables whose queue could not be persisted; no pull/snapshot
    _base: {},                 // { table: { recordId: record } } — dernier état serveur connu (fusion 3 voies)
    _conflicts: []             // journal des conflits de champs détectés pendant la session
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
        const existingHasBase = Object.prototype.hasOwnProperty.call(existing, 'base');
        const originalBase = existingHasBase ? existing.base : null;
        const baseCaptured = existing.baseCaptured === true || !!existing.base;
        if (existing.blockedReason) newOp.blockedReason = existing.blockedReason;
        // delete after upsert → keep the delete, preserve knownVersion + base
        if (newOp.type === 'delete' && existing.type === 'upsert') {
            newOp.id = generateId(); // fresh id so flush removal is safe
            newOp.knownVersion = existing.knownVersion;
            newOp.base = originalBase;
            newOp.baseCaptured = baseCaptured;
            queue[idx] = newOp;
            return;
        }
        // upsert after delete → replace delete with upsert, preserve knownVersion + base
        if (newOp.type === 'upsert' && existing.type === 'delete') {
            newOp.id = generateId(); // fresh id so flush removal is safe
            newOp.knownVersion = existing.knownVersion;
            newOp.base = originalBase;
            newOp.baseCaptured = baseCaptured;
            queue[idx] = newOp;
            return;
        }
        // upsert after upsert → keep the OLDEST knownVersion AND the OLDEST base
        // (état serveur au moment de la première modification locale), et créer un
        // nouvel op.id pour que le flush ne retire que l'opération fusionnée.
        if (newOp.type === 'upsert' && existing.type === 'upsert') {
            const oldestKnownVersion = existing.knownVersion !== null ? existing.knownVersion : newOp.knownVersion;
            newOp.id = generateId(); // fresh id so flush removal is safe
            newOp.knownVersion = oldestKnownVersion;
            newOp.base = originalBase;
            newOp.baseCaptured = baseCaptured;
            queue[idx] = newOp;
            return;
        }
        // delete after delete → no-op, already deleted
        return;
    }
    queue.push(newOp);
};

// --- V11 — Fusion à trois voies (base serveur / local / distant) ---
// Empêche d'écraser un champ modifié par un autre appareil :
//   - champ modifié seulement localement  → valeur locale
//   - champ modifié seulement à distance  → valeur distante
//   - champ modifié des deux côtés avec la même valeur → valeur commune
//   - champ modifié différemment des deux côtés → conflit explicite (locale conservée)
const v11Clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// Égalité profonde indépendante de l'ordre des clés (JSON.stringify en dépendrait).
const v11Equal = (a, b) => {
    if (a === b) return true;
    if (a === null || b === null || a === undefined || b === undefined) return false;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object') return false;
    const aArr = Array.isArray(a);
    if (aArr !== Array.isArray(b)) return false;
    if (aArr) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (!v11Equal(a[i], b[i])) return false;
        return true;
    }
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
        if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
        if (!v11Equal(a[k], b[k])) return false;
    }
    return true;
};

// Retourne { record, conflicts } où conflicts liste les champs divergents.
const v11MergeRecord = (base, local, remote) => {
    const conflicts = [];
    if (!base) return { record: v11Clone(local), conflicts };
    if (!local) return { record: v11Clone(remote), conflicts };
    if (!remote) return { record: v11Clone(local), conflicts };
    const out = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
    for (const k of keys) {
        const hasB = Object.prototype.hasOwnProperty.call(base, k);
        const hasL = Object.prototype.hasOwnProperty.call(local, k);
        const hasR = Object.prototype.hasOwnProperty.call(remote, k);
        const b = hasB ? base[k] : undefined;
        const l = hasL ? local[k] : undefined;
        const r = hasR ? remote[k] : undefined;
        if (l === undefined && r === undefined) continue;
        const localChanged = !v11Equal(l, b);
        const remoteChanged = !v11Equal(r, b);
        if (!localChanged) {
            if (hasR) out[k] = v11Clone(r);
        } else if (!remoteChanged) {
            if (hasL) out[k] = v11Clone(l);
        } else if (v11Equal(l, r)) {
            if (hasL) out[k] = v11Clone(l);
        } else {
            out[k] = v11Clone(l);
            conflicts.push(k);
        }
    }
    return { record: out, conflicts };
};

const v11GetBase = (table, recordId) => {
    const t = V11._base[table];
    if (!t) return null;
    const rec = t[recordId];
    return rec === undefined ? null : rec;
};

const v11SetBase = (table, recordId, record) => {
    if (!V11._base[table]) V11._base[table] = {};
    if (record === null || record === undefined) delete V11._base[table][recordId];
    else V11._base[table][recordId] = v11Clone(record);
};

const v11SetBaseFromRemote = (table, records) => {
    const map = {};
    for (const r of (records || [])) {
        if (r && typeof r.id === 'string' && r.id) map[r.id] = v11Clone(r);
    }
    V11._base[table] = map;
};

// Aligne le cache local sur le résultat fusionné, uniquement si l'enregistrement
// local n'a pas été modifié entre-temps (sinon le listener réconciliera).
const v11ApplyMergedLocal = (table, recordId, localBefore, merged) => {
    if (v11Equal(localBefore, merged)) return;
    const current = DB.get(table);
    const idx = current.findIndex(r => r && r.id === recordId);
    if (idx === -1) return;
    if (!v11Equal(current[idx], localBefore)) return;
    current[idx] = v11Clone(merged);
    DB._applyRemoteSnapshot(table, current);
    if (V11._localCache[table]) {
        const cacheIdx = V11._localCache[table].findIndex(r => r && r.id === recordId);
        if (cacheIdx !== -1) V11._localCache[table][cacheIdx] = v11Clone(merged);
    }
};

const v11EnqueueOp = (table, type, recordId, record, base) => {
    const queue = v11GetQueue();
    // Store the last known remote version for this record (null if never synced)
    const knownVersion = V11._versions[table]?.[recordId] ?? null;
    // Base de fusion : dernier état serveur connu au moment de la modification locale.
    const baseRecord = base !== undefined ? base : v11GetBase(table, recordId);
    v11MergeOp(queue, { id: generateId(), table, type, recordId, record, timestamp: Date.now(), knownVersion, base: baseRecord || null, baseCaptured: true });
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
                const prevMap = new Map(prev.map(r => [r.id, r]));

                if (wasInvalid) {
                    // Full resync: upsert ALL valid records, NEVER deletes derived from invalid state.
                    // This guarantees no data loss from a previous invalid save.
                    for (const record of validRecords) {
                        v11EnqueueOp(key, 'upsert', record.id, record, v11GetBase(key, record.id) || prevMap.get(record.id) || null);
                    }
                } else {
                    // Normal differential sync
                    const currentIds = new Set(validRecords.map(r => r.id));

                    // Upserts: valid records that are new or changed
                    for (const record of validRecords) {
                        const prevRec = prevMap.get(record.id);
                        if (!prevRec || JSON.stringify(prevRec) !== JSON.stringify(record)) {
                            v11EnqueueOp(key, 'upsert', record.id, record, v11GetBase(key, record.id) || prevRec || null);
                        }
                    }
                    // Deletes: records in prev that are no longer in current data
                    for (const prevRec of prev) {
                        if (!prevRec.id || typeof prevRec.id !== 'string' || prevRec.id.trim() === '') continue;
                        if (!currentIds.has(prevRec.id)) {
                            v11EnqueueOp(key, 'delete', prevRec.id, null, v11GetBase(key, prevRec.id) || prevRec);
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
    setFilter: (name, value) => localStorage.setItem('thecol_filter_' + name, value || '')
};

const requireNumberingConnection = () => {
    if (!navigator.onLine || !window.firebaseReady || !window.firebaseDb || !window.firebaseApi || !V11._isReady || V11._bootstrapping || V11._migrating || !window.firebaseAuth?.isAuthenticated()) {
        throw new Error('La création d’une commande ou d’un BL nécessite une connexion et une synchronisation active.');
    }
};

const checkNumberingContext = (table, candidate, recordId, session) => {
    requireNumberingConnection();
    if (session !== _appSessionGen) {
        const error = new Error('La session a changé. Rouvrez le document avant de réessayer.');
        error.numbering = true;
        throw error;
    }
    const pending = v11GetQueue().some(op => (
        op.table === table && (
            op.recordId === candidate.id || op.recordId === recordId ||
            (table === 'livraisons' && (op.record?.commandeId === candidate.commandeId || op.base?.commandeId === candidate.commandeId))
        )
    ) || (table === 'livraisons' && op.table === 'commandes' && op.recordId === candidate.commandeId));
    if (pending) {
        const error = new Error('Synchronisez les modifications de ce document avant de le créer ou de l’exporter.');
        error.numbering = true;
        throw error;
    }
};

const createNumberedRecord = async (table, candidate) => {
    if (!['commandes', 'livraisons'].includes(table)) throw new Error('Type de document invalide.');
    requireNumberingConnection();
    const session = _appSessionGen;
    try {
        checkNumberingContext(table, candidate, candidate.id, session);
        const { doc, collection, getDocs, runTransaction } = window.firebaseApi;
        const sources = table === 'livraisons' ? ['livraisons', 'commandes', 'history'] : ['commandes'];
        const snapshots = await Promise.all(sources.map(source => getDocs(collection(window.firebaseDb, V11.TABLES_COLLECTION, source, V11.RECORDS_SUBCOLLECTION))));
        const remote = {};
        sources.forEach((source, index) => {
            const docs = [];
            snapshots[index].forEach(entry => docs.push(entry));
            const validation = v11ValidateSnapshotBuffer(docs, source);
            if (!validation.valid) throw new Error(validation.reason);
            remote[source] = validation.records;
        });
        const field = table === 'commandes' ? 'numero' : 'numeroBL';
        const records = sources.flatMap(source => [...remote[source], ...DB.get(source)]);
        const maximum = records.reduce((max, record) => {
            const match = /^(\d+)(?:-\d+)*$/.exec(String(record[field] || ''));
            const number = match ? Number(match[1]) : 0;
            return Number.isSafeInteger(number) && number > max ? number : max;
        }, 0);
        const existing = table === 'livraisons' ? remote.livraisons.find(record => record.commandeId === candidate.commandeId) : null;
        checkNumberingContext(table, candidate, existing?.id || candidate.id, session);
        const counterRef = doc(window.firebaseDb, V11.SYNC_META_COLLECTION, `numbering-${table}`);
        const result = await runTransaction(window.firebaseDb, async transaction => {
            const commandeRef = table === 'livraisons'
                ? doc(window.firebaseDb, V11.TABLES_COLLECTION, 'commandes', V11.RECORDS_SUBCOLLECTION, candidate.commandeId)
                : null;
            const commandeSnap = commandeRef ? await transaction.get(commandeRef) : null;
            const commande = commandeSnap?.exists() ? commandeSnap.data().record : null;
            if (commandeRef && (!commande || commande.id !== candidate.commandeId)) throw new Error('Commande distante introuvable.');
            const deliveryKey = String(commande?.dateLivraisonEffective || commande?.blGenerationId || 'initial').replace(/[^a-zA-Z0-9_-]/g, '');
            const key = table === 'livraisons' ? `${candidate.commandeId}-${deliveryKey}` : candidate.id;
            const reservationRef = doc(window.firebaseDb, V11.SYNC_META_COLLECTION, `number-${table}-${key}`);
            const reservation = await transaction.get(reservationRef);
            const counter = await transaction.get(counterRef);
            const reserved = reservation.exists() ? reservation.data() : null;
            const recordId = reserved?.recordId || existing?.id || candidate.id;
            const recordRef = doc(window.firebaseDb, V11.TABLES_COLLECTION, table, V11.RECORDS_SUBCOLLECTION, recordId);
            const current = await transaction.get(recordRef);
            checkNumberingContext(table, candidate, recordId, session);
            if (current.exists()) {
                const data = current.data();
                if (!data.record || data.record.id !== recordId || !data.record[field]) throw new Error('Document distant invalide.');
                if (commande && data.record.commandeId !== commande.id) throw new Error('BL distant incohérent.');
                if (!reserved) transaction.set(reservationRef, { recordId, numero: data.record[field] });
                let linked = null;
                if (commande && commande.numeroBL !== data.record.numeroBL) {
                    linked = { record: { ...commande, numeroBL: data.record.numeroBL }, version: Date.now() };
                    transaction.set(commandeRef, { record: linked.record, updatedAt: new Date().toISOString(), _version: linked.version });
                }
                return { record: data.record, version: data._version, linked };
            }
            const lastNumber = counter.exists() ? counter.data().lastNumber : 0;
            if (!Number.isSafeInteger(lastNumber) || lastNumber < 0) throw new Error('Compteur distant invalide.');
            const nextNumber = Math.max(lastNumber, maximum) + 1;
            if (!Number.isSafeInteger(nextNumber)) throw new Error('Limite de numérotation atteinte.');
            const memorised = commande?.numeroBL && !remote.livraisons.some(record => record.numeroBL === commande.numeroBL && record.commandeId !== commande.id)
                ? commande.numeroBL : null;
            const numero = reserved?.numero || memorised || String(nextNumber).padStart(5, '0');
            if (!/^\d+$/.test(String(numero))) throw new Error('Numéro réservé invalide.');
            const record = { ...candidate, id: recordId, [field]: String(numero) };
            const version = Date.now();
            transaction.set(counterRef, { lastNumber: Math.max(lastNumber, maximum, Number(numero)) });
            transaction.set(reservationRef, { recordId, numero: String(numero) });
            transaction.set(recordRef, { record, updatedAt: new Date().toISOString(), _version: version });
            const linked = commande ? { record: { ...commande, numeroBL: record.numeroBL }, version } : null;
            if (linked) transaction.set(commandeRef, { record: linked.record, updatedAt: new Date().toISOString(), _version: version });
            return { record, version, linked };
        });
        if (session !== _appSessionGen || !window.firebaseReady) return null;
        checkNumberingContext(table, candidate, result.record.id, session);
        const current = DB.get(table);
        const index = current.findIndex(record => record.id === result.record.id);
        if (index === -1) current.push(result.record);
        else current[index] = result.record;
        v11SetBase(table, result.record.id, result.record);
        if (!V11._versions[table]) V11._versions[table] = {};
        V11._versions[table][result.record.id] = result.version;
        if (result.linked) {
            const linked = result.linked;
            v11SetBase('commandes', linked.record.id, linked.record);
            if (!V11._versions.commandes) V11._versions.commandes = {};
            V11._versions.commandes[linked.record.id] = linked.version;
            if (!v11GetQueue().some(op => op.table === 'commandes' && op.recordId === linked.record.id)) {
                const commandes = DB.get('commandes');
                const index = commandes.findIndex(record => record.id === linked.record.id);
                if (index === -1) commandes.push(linked.record);
                else commandes[index] = linked.record;
                DB._applyRemoteSnapshot('commandes', commandes);
            }
        }
        v11SaveVersions();
        DB._applyRemoteSnapshot(table, current);
        return result.record;
    } catch (e) {
        console.error('Attribution du numéro impossible :', e);
        if (e.numbering) throw e;
        throw new Error('Création impossible : vérifiez votre connexion et réessayez. Aucun nouveau numéro local n’a été attribué.');
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
const v11NotifyBlockedOp = (op) => {
    const conflictKey = `blocked/${op.table}/${op.recordId}`;
    if (V11._conflictNotified.has(conflictKey)) return;
    V11._conflictNotified.add(conflictKey);
    const reason = op.blockedReason === 'remote-deleted'
        ? "l'enregistrement a été supprimé sur un autre appareil"
        : op.blockedReason === 'id-collision'
            ? "un autre enregistrement utilise déjà cet identifiant"
            : "l'état d'origine de la modification est inconnu";
    showToast(`Conflit sur « ${op.table} » : ${reason}. Vos modifications restent conservées dans la file d'attente, sans modifier les données cloud.`, 'warning');
};

const v11FlushQueue = async () => {
    if (!window.firebaseReady || !window.firebaseDb || !window.firebaseApi) return;
    if (!V11._isReady) return;
    // Serialize: if a flush is already in progress, return its promise
    if (V11._flushPromise) return V11._flushPromise;

    const { runTransaction, doc } = window.firebaseApi;
    const rawQueue = v11GetQueue();
    // Strip operations for memory-protected tables (queue persistence failed)
    const protectedCount = rawQueue.filter(op => V11._memoryProtectedTables.has(op.table)).length;
    const unprotectedQueue = rawQueue.filter(op => !V11._memoryProtectedTables.has(op.table));
    if (protectedCount > 0) {
        console.warn('[V11]', protectedCount, 'opération(s) ignorée(s) pour table(s) protégée(s) en mémoire');
        v11SetQueue(unprotectedQueue);
    }
    unprotectedQueue.filter(op => op.blockedReason).forEach(v11NotifyBlockedOp);
    const startQueue = unprotectedQueue.filter(op => !op.blockedReason);
    if (startQueue.length === 0) return;

    const promise = (async () => {
        const successfulIds = new Set();

        for (const op of startQueue) {
            try {
                const ref = doc(window.firebaseDb, V11.TABLES_COLLECTION, op.table, V11.RECORDS_SUBCOLLECTION, op.recordId);
                const newVersion = Date.now();
                const result = await runTransaction(window.firebaseDb, async (transaction) => {
                    const snap = await transaction.get(ref);
                    const remoteRecord = snap.exists() && snap.data().record ? snap.data().record : null;
                    const base = op.base || null;
                    const hasCapturedBase = op.baseCaptured === true || !!base;

                    if (op.type === 'delete') {
                        if (!snap.exists()) return { action: 'noop', conflicts: [] };
                        if (!base || (remoteRecord && !v11Equal(remoteRecord, base))) {
                            // Modifié ailleurs depuis notre base : ne pas détruire ces modifications.
                            return { action: 'blocked-delete', conflicts: [], merged: remoteRecord };
                        }
                        transaction.delete(ref);
                        return { action: 'deleted', conflicts: [] };
                    }

                    if (!op.record) return { action: 'noop', conflicts: [] };

                    if (!snap.exists()) {
                        if (base || !hasCapturedBase) {
                            return { action: 'blocked-upsert', reason: base ? 'remote-deleted' : 'base-unknown', merged: null };
                        }
                        const record = v11Clone(op.record);
                        transaction.set(ref, { record, updatedAt: new Date().toISOString(), _version: newVersion });
                        return { action: 'created', conflicts: [], merged: record };
                    }

                    if (!base) {
                        if (v11Equal(op.record, remoteRecord)) return { action: 'noop', conflicts: [] };
                        return { action: 'blocked-upsert', reason: hasCapturedBase ? 'id-collision' : 'base-unknown', merged: remoteRecord };
                    }

                    const merge = v11MergeRecord(base, op.record, remoteRecord);
                    transaction.set(ref, { record: merge.record, updatedAt: new Date().toISOString(), _version: newVersion });
                    return { action: 'merged', conflicts: merge.conflicts, merged: merge.record };
                });

                const conflictKey = `${op.table}/${op.recordId}`;

                if (result.action === 'blocked-upsert') {
                    const latestQueue = v11GetQueue();
                    const pending = latestQueue.find(item => item.table === op.table && item.recordId === op.recordId);
                    if (pending && pending.type === 'upsert') {
                        pending.blockedReason = result.reason;
                        pending.blockedAt = new Date().toISOString();
                        if (!v11SetQueue(latestQueue)) {
                            V11._memoryProtectedTables.add(op.table);
                            showToast(`Le conflit sur « ${op.table} » n'a pas pu être sauvegardé. Exportez vos données avant de recharger la page.`, 'error');
                            continue;
                        }
                        const current = DB.get(op.table).filter(record => record.id !== op.recordId);
                        if (result.merged) current.push(v11Clone(result.merged));
                        DB._applyRemoteSnapshot(op.table, current);
                        v11SetBase(op.table, op.recordId, result.merged);
                        if (!result.merged) delete V11._versions[op.table]?.[op.recordId];
                        V11._conflicts.push({ table: op.table, recordId: op.recordId, fields: [result.reason], at: pending.blockedAt });
                        v11NotifyBlockedOp(pending);
                    }
                    continue;
                }

                if (result.action === 'blocked-delete') {
                    v11SetBase(op.table, op.recordId, result.merged);
                    V11._conflicts.push({ table: op.table, recordId: op.recordId, fields: ['(suppression)'], at: new Date().toISOString() });
                    if (!V11._conflictNotified.has(conflictKey)) {
                        V11._conflictNotified.add(conflictKey);
                        showToast(`Suppression annulée sur « ${op.table} » : l'enregistrement a été modifié sur un autre appareil.`, 'warning');
                    }
                    // Rétablir l'enregistrement local (il avait été retiré par DB.set).
                    const cur = DB.get(op.table);
                    if (!cur.some(r => r && r.id === op.recordId)) {
                        cur.push(v11Clone(result.merged));
                        DB._applyRemoteSnapshot(op.table, cur);
                    }
                    successfulIds.add(op.id);
                    continue;
                }

                if (result.action === 'noop') {
                    successfulIds.add(op.id);
                    continue;
                }

                const pendingQueue = v11GetQueue();
                const pending = pendingQueue.find(item => item.table === op.table && item.recordId === op.recordId && item.id !== op.id);
                if (pending && pending.type === 'upsert' && !pending.blockedReason) {
                    const localBefore = v11Clone(pending.record);
                    if (result.merged) {
                        pending.record = op.type === 'upsert'
                            ? v11MergeRecord(op.record, pending.record, result.merged).record
                            : pending.record;
                        pending.base = v11Clone(result.merged);
                        pending.knownVersion = newVersion;
                    } else {
                        pending.base = null;
                        pending.knownVersion = null;
                    }
                    pending.baseCaptured = true;
                    if (v11SetQueue(pendingQueue)) {
                        v11ApplyMergedLocal(op.table, op.recordId, localBefore, pending.record);
                    } else {
                        V11._memoryProtectedTables.add(op.table);
                        showToast(`Les modifications récentes de « ${op.table} » n'ont pas pu être préparées pour la synchronisation. Exportez vos données avant de recharger la page.`, 'error');
                    }
                }

                if (result.conflicts && result.conflicts.length > 0) {
                    V11._conflicts.push({ table: op.table, recordId: op.recordId, fields: result.conflicts, at: new Date().toISOString() });
                    if (!V11._conflictNotified.has(conflictKey)) {
                        V11._conflictNotified.add(conflictKey);
                        showToast(
                            `Conflit sur « ${op.table} » (${result.conflicts.join(', ')}) : votre version a été conservée, les autres champs ont été fusionnés.`,
                            'warning'
                        );
                    }
                    console.warn('[V11] Conflit de champs', conflictKey, result.conflicts);
                }

                // La base devient l'état réellement écrit sur le serveur.
                if (result.action === 'deleted') {
                    v11SetBase(op.table, op.recordId, null);
                } else if (result.merged) {
                    v11SetBase(op.table, op.recordId, result.merged);
                    if (op.type === 'upsert') v11ApplyMergedLocal(op.table, op.recordId, op.record, result.merged);
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
        const pendingCount = remaining.filter(op => !op.blockedReason).length;
        if (remaining.length > 0) {
            v11SetQueue(remaining);
            if (pendingCount > 0 && successfulIds.size === 0) {
                showToast('Échec de la synchronisation : la file d\'attente attend la reconnexion.', 'warning');
            } else if (pendingCount > 0) {
                showToast(`${pendingCount} opération(s) en attente de reconnexion`, 'warning');
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
        const hasNewOps = latestQueue.some(op => !op.blockedReason && !startIds.has(op.id));
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
        // Base de fusion = état serveur de référence
        v11SetBaseFromRemote(table, result.records);
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

            // Update version map with remote versions
            if (!V11._versions[table]) V11._versions[table] = {};
            Object.assign(V11._versions[table], remoteVersions);
            v11SaveVersions();

            // Guard: discard if session changed after validation
            if (sessionGen !== _appSessionGen) return;

            // Le snapshot distant devient la base de fusion.
            v11SetBaseFromRemote(table, records);

            // Superposition des modifications locales en attente, champ par champ :
            // les champs que l'autre appareil a modifiés sont conservés, les champs
            // modifiés localement gardent la valeur locale. Aucun écrasement global.
            const pendingNow = v11GetQueue().filter(op => op.table === table);
            const working = new Map(records.map(r => [r.id, r]));
            for (const op of pendingNow) {
                if (op.blockedReason) continue;
                if (op.type === 'delete') { working.delete(op.recordId); continue; }
                if (!op.record) continue;
                const remoteRec = working.get(op.recordId) || null;
                if (!remoteRec) { working.set(op.recordId, v11Clone(op.record)); continue; }
                const merge = v11MergeRecord(op.base || null, op.record, remoteRec);
                working.set(op.recordId, merge.record);
            }
            DB._applyRemoteSnapshot(table, Array.from(working.values()));
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
            if (op.blockedReason) {
                const remoteRecord = v11GetBase(table, op.recordId);
                if (remoteRecord) resultMap.set(op.recordId, v11Clone(remoteRecord));
                else resultMap.delete(op.recordId);
                continue;
            }
            if (op.type === 'delete') { resultMap.delete(op.recordId); continue; }
            if (!op.record || !op.record.id) continue;
            const remoteRec = resultMap.get(op.recordId) || null;
            if (!remoteRec) { resultMap.set(op.recordId, v11Clone(op.record)); continue; }
            // Fusion champ par champ avec la base distante : ne réécrase pas
            // les modifications faites entre-temps sur un autre appareil.
            const base = op.base || null;
            resultMap.set(op.recordId, v11MergeRecord(base, op.record, remoteRec).record);
        }
        DB._applyRemoteSnapshot(table, Array.from(resultMap.values()));
    }
};

const configureFirebase = (appSdk, firestoreSdk, authSdk) => {
    if (window.firebaseDb && window.firebaseAuth) return;
    const { initializeApp, getApps, getApp } = appSdk;
    const {
        getFirestore, doc, setDoc, getDoc, getDocs, collection,
        onSnapshot, deleteDoc, writeBatch, runTransaction
    } = firestoreSdk;
    const {
        getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
        setPersistence, browserLocalPersistence
    } = authSdk;

    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    const db = getFirestore(app);
    const auth = getAuth(app);
    setPersistence(auth, browserLocalPersistence).catch(() => {});

    onAuthStateChanged(auth, (user) => {
        if (!user) {
            resetAppSession();
            return;
        }

        window.firebaseReady = true;
        unlockShell();
        const loginScreen = document.getElementById('loginScreen');
        const loginPassword = document.getElementById('loginPassword');
        const loginError = document.getElementById('loginError');
        const loginBusy = document.getElementById('loginBusy');
        const loginBtn = document.getElementById('loginBtn');
        const syncBtn = document.getElementById('syncBtn');
        if (loginScreen) loginScreen.style.display = 'none';
        if (loginPassword) loginPassword.value = '';
        if (loginError) { loginError.textContent = ''; loginError.style.display = 'none'; }
        if (loginBusy) loginBusy.style.display = 'none';
        if (loginBtn) loginBtn.style.display = 'inline-flex';
        if (syncBtn) syncBtn.style.display = 'inline-flex';
        window.startApp();
    });

    window.firebaseApi = {
        doc, setDoc, getDoc, getDocs, collection,
        onSnapshot, deleteDoc, writeBatch, runTransaction
    };
    window.firebaseDb = db;
    window.firebaseAuth = {
        signIn: (password) => signInWithEmailAndPassword(auth, FIREBASE_AUTH_EMAIL, password),
        signOut: () => signOut(auth),
        isAuthenticated: () => !!auth.currentUser
    };
};

window.initFirebase = async (maxRetries = 3) => {
    if (window.firebaseDb && window.firebaseAuth) return true;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const [appSdk, firestoreSdk, authSdk] = await Promise.all([
                import('https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js'),
                import('https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js'),
                import('https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js')
            ]);
            configureFirebase(appSdk, firestoreSdk, authSdk);
            return true;
        } catch (e) {
            if (window.firebaseDb && window.firebaseAuth) return true;
            console.error('[initFirebase] Tentative ' + (attempt + 1) + '/' + maxRetries + ' échouée:', e);
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
    conflicts: () => V11._conflicts,
    blocked: () => v11GetQueue().filter(op => op.blockedReason),
    base: () => V11._base,
    mergeRecord: v11MergeRecord,
    equal: v11Equal,
    status: () => ({
        isReady: V11._isReady,
        bootstrapping: V11._bootstrapping,
        sessionId: V11._sessionId,
        queueLength: v11GetQueue().length,
        blockedCount: v11GetQueue().filter(op => op.blockedReason).length,
        listeners: Object.keys(V11._listeners).length,
        hasFlushPromise: V11._flushPromise !== null
    })
};
