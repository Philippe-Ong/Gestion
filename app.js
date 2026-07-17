// ThéCol Gestion - Application JavaScript

// Application-wide constants
const CONSTANTS = {
    PRODUCTION_LOSS: 1.015,    // +1.5% loss buffer applied to ingredient consumption
    CAPSULE_LOSS: 1.075,       // +7.5% loss buffer for capsules
    BOUCHON_MARGIN: 1.05,      // +5% margin on caps shown in the production planner
    CUVE_MAX_L: 25,            // max litres per production cuve
    STOCK_WARN_DAYS: 30        // DLC warning threshold in days
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

const getNextBLNumero = () => {
    const livraisons = DB.get('livraisons');
    let maxNum = 0;
    livraisons.forEach(liv => {
        const num = parseInt(liv.numeroBL || '0', 10);
        if (num > maxNum) maxNum = num;
    });
    return String(maxNum + 1).padStart(5, '0');
};

const getBLNumero = (livraison) => {
    return livraison.numeroBL || livraison.id.slice(-5);
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

// ---------------------------------------------------------------------------
// Livraisons / BL
// ---------------------------------------------------------------------------
CLICK_HANDLERS['show-livraison-details'] = (el) => showLivraisonDetails(el.getAttribute('data-id'));
CLICK_HANDLERS['prepare-bl-export'] = (el) => showPrepareBLExportModal(el.getAttribute('data-id'));
CLICK_HANDLERS['delete-livraison'] = (el) => deleteLivraison(el.getAttribute('data-id'));

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

const calculateAvailableStock = (lots, referenceDate = new Date()) => {
    const stock = {};
    lots.filter(lot => isLotSellable(lot, referenceDate)).forEach(lot => {
        const key = `${lot.arome}-${lot.format}`;
        if (!stock[key]) stock[key] = 0;
        stock[key] += lot.quantite || 0;
    });
    return stock;
};

const getLotNumero = (lot) => String(lot?.numLot || lot?.id || '');

// Prochain numéro de lot AFFICHÉ : entier séquentiel robuste, indépendant de la
// forme des id internes. On scanne les numLot purement numériques (lots + historique)
// pour ne jamais réutiliser un numéro et ne jamais retomber sur un « _ab12… ».
const nextLotNumero = (lots, history) => {
    let max = 0;
    const scan = (v) => {
        const s = String(v ?? '').trim();
        if (/^\d+$/.test(s)) { const n = parseInt(s, 10); if (n > max) max = n; }
    };
    (lots || []).forEach(l => scan(l.numLot));
    (history || []).forEach(h => scan(h.numLot));
    return String(max + 1).padStart(6, '0');
};

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

        let max = 0;
        const scan = (v) => { const s = String(v ?? '').trim(); if (/^\d+$/.test(s)) { const n = parseInt(s, 10); if (n > max) max = n; } };
        lots.forEach(l => scan(l.numLot));
        history.forEach(h => scan(h.numLot));

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
                const hash = window.location.hash.slice(1) || 'dashboard';
                const page = hash.split('?')[0];
                if (page !== 'dashboard' && page !== 'stock' && page !== 'commandes' &&
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

const getStatus = (dlc) => {
    const now = dateOnly(new Date());
    const dlcDate = dateOnly(dlc);
    const oneMonthFromNow = dateOnly(new Date());
    oneMonthFromNow.setDate(oneMonthFromNow.getDate() + CONSTANTS.STOCK_WARN_DAYS);

    if (!dlc || Number.isNaN(dlcDate.getTime())) return 'expired';
    if (now > dlcDate) return 'expired';
    if (dlcDate <= oneMonthFromNow) return 'warning';
    return 'ok';
};

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
        if (includesText(label, q) || includesText(liv.dateBL, q)) {
            matches.push({ type: 'livraison', id: liv.id, label, meta: liv.dateBL || 'Livraison' });
        }
    });

    lots.forEach(lot => {
        const label = `Lot #${String(lot.numLot || lot.id).slice(-6)} - ${lot.arome || ''} ${lot.format || ''}`;
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
    const hash = window.location.hash.slice(1) || 'dashboard';
    const page = hash.split('?')[0];
    navigateTo(page);
};

const navigateTo = (page) => {
    document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll(`[data-page="${page}"]`).forEach(el => el.classList.add('active'));
    // L'historique fait partie de la section Stock : garder l'onglet Stock actif
    if (page === 'historique') {
        document.querySelectorAll('[data-page="stock"]').forEach(el => el.classList.add('active'));
    }
    // Pages du menu « Plus » : allumer le bouton Plus
    const morePages = ['pointage', 'livraisons', 'inventaire', 'parametres'];
    if (morePages.includes(page)) {
        document.getElementById('moreNavBtn')?.classList.add('active');
    }

    const titles = {
        dashboard: 'Dashboard',
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
    if (titleEl) titleEl.textContent = titles[page] || 'Dashboard';

    const views = {
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

    const viewFn = views[page];
    if (typeof viewFn === 'function') {
        viewFn();
    } else {
        renderDashboard();
    }
};

// Render Current View dynamically
const renderCurrentView = () => {
    if (!window.firebaseReady || !window._appStarted) return;
    const hash = window.location.hash.slice(1) || 'dashboard';
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

    const expiries = lots.filter(lot => getStatus(lot.dlc) === 'expired').length;
    const moinsUnMois = lots.filter(lot => getStatus(lot.dlc) === 'warning').length;
    const sellableBottles = lots.filter(lot => isLotSellable(lot, today)).reduce((sum, lot) => sum + (lot.quantite || 0), 0);

    // Stock produit ces 7 derniers jours
    const stockLast7Days = lots
        .filter(lot => lot.dateProduction && new Date(lot.dateProduction) >= sevenDaysAgo)
        .reduce((sum, lot) => sum + (lot.quantite || 0), 0);

    const commandesEnAttente = commandes.filter(c => c.statut === 'en_attente');
    const commandesUrgentes = commandesEnAttente.filter(c => c.dateLivraison && new Date(c.dateLivraison) <= inThreeDays).length;

    const commandesPeriode = commandes.filter(c => c.statut !== 'annulee' && c.statut !== 'livrée');
    const stockDisponible = calculateAvailableStock(lots, today);

    const besoins = {};
    commandesPeriode.forEach(cmd => {
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
                    quantite: 0
                };
            }
            besoins[key].quantite += item.quantite;
        });
    });

    const bouteillesAProduire = Object.entries(besoins).map(([key, b]) => {
        const disponible = stockDisponible[key] || 0;
        const aProduire = Math.max(0, b.quantite - disponible);
        return { ...b, disponible, aProduire };
    }).filter(b => b.aProduire > 0).sort((a, b) => b.aProduire - a.aProduire);

    const totalBouteillesAProduire = bouteillesAProduire.reduce((sum, b) => sum + b.aProduire, 0);

    const showAlert = expiries > 0 || moinsUnMois > 0;

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
                    ${expiries > 0 ? `${expiries} expiré${expiries > 1 ? 's' : ''}` : ''}${expiries > 0 && moinsUnMois > 0 ? ' • ' : ''}${moinsUnMois > 0 ? `${moinsUnMois} DLC < 1 mois` : ''}
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
        if (savedStatut) {
            const st = getStatus(lot.dlc);
            if (st !== savedStatut) return false;
        }
        if (savedQuery) {
            const hay = `${lot.id || ''} ${lot.arome || ''} ${lot.format || ''} ${lot.quantite || ''}`.toLowerCase();
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
        (DB.get('commandes') || []).forEach(cmd => {
            (cmd.lotsUtilises || []).forEach(lu => {
                const idS = String(lu.lotId || '');
                if (!idS || knownIds.has(idS) || archived[idS]) return;
                archived[idS] = { id: idS, numLot: lu.numLot || idS, arome: lu.arome || '', format: lu.format || '', dlc: lu.dlc || '', dateProduction: '' };
            });
        });
        (DB.get('history') || []).forEach(h => {
            const idS = String(h.lotId || '');
            if (!idS || knownIds.has(idS)) return;
            if (!archived[idS]) {
                archived[idS] = { id: idS, numLot: h.numLot || idS, arome: h.arome || '', format: h.format || '', dlc: '', dateProduction: h.productionDate || '' };
            } else if (!archived[idS].dateProduction) {
                archived[idS].dateProduction = h.productionDate || '';
            }
        });
        const matches = Object.values(archived)
            .filter(l => `${l.id} ${l.arome} ${l.format}`.toLowerCase().includes(savedQuery))
            .slice(0, 12);
        if (matches.length > 0) {
            archivedLotsHtml = `
                <h3 style="margin: 16px 0 8px; font-size: 15px;">Lots épuisés (traçabilité)</h3>
                ${matches.map(l => {
                    const arome = aromes.find(a => a.nom === l.arome);
                    return `<div class="lot-card">
                        <div class="lot-card-header">
                            <span class="lot-card-numero">#${escapeHtml(String(l.numLot || l.id).padStart(6, '0'))}</span>
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
            const status = getStatus(lot.dlc);
            const badgeClass = status === 'expired' ? 'badge-expire' : status === 'warning' ? 'badge-bientot' : 'badge-ok';
            const statusLabel = status === 'expired' ? 'Expiré' : status === 'warning' ? '< 1 mois' : 'OK';
            return `<div class="lot-card lot-status-${status}">
                <div class="lot-card-header">
                    <span class="lot-card-numero">#${escapeHtml(String(lot.numLot || lot.id).padStart(6, '0'))}</span>
                    <span class="badge ${badgeClass}">${statusLabel}</span>
                </div>
                <div class="lot-card-aroma">
                    <span class="aroma-tile-dot" style="background:${safeColor(arome?.couleur)}"></span>
                    <span class="lot-card-aroma-name">${escapeHtml(lot.arome || '?')}</span>
                    <span class="lot-card-aroma-format">• ${escapeHtml(lot.format || '?')}</span>
                </div>
                <div class="lot-card-meta">
                    <span><strong class="lot-card-qty">${escapeHtml(String(lot.quantite))}</strong> bt</span>
                    <span>Prod. <strong>${formatDate(lot.dateProduction)}</strong></span>
                    <span>DLC <strong>${formatDate(lot.dlc)}</strong></span>
                </div>
                <div class="lot-card-actions">
                    ${status !== 'expired' ? `<button class="btn btn-sm btn-success" data-click="sell-lot" data-id="${escapeHtml(lot.id)}">Vendre</button>` : ''}
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
            <span class="stock-pills-label">DLC :</span>
            <button type="button" class="status-pill ${!savedStatut ? 'active' : ''}" onclick="toggleStockStatutFilter('')">Tous</button>
            ${statPill('ok', 'OK')}
            ${statPill('warning', '< 1 mois')}
            ${statPill('expired', 'Expiré')}
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
            const id = String(r.id);
            if (id.startsWith('VENTE-') || id.startsWith('RESTAURE-')) continue;
            sum += calcProductionLitres(r.quantity, r.format, formats);
        }
        return sum;
    })();

    const savedQuery  = (DB.getFilter('histQuery') || '').toString().toLowerCase().trim();
    const savedType   = DB.getFilter('histType')   || ''; // '', 'prod', 'vente'
    const savedArome  = DB.getFilter('histArome')  || '';
    const savedFormat = DB.getFilter('histFormat') || '';
    const savedPeriod = DB.getFilter('histPeriod') || ''; // '', '7', '30', '90'

    const aromeColor = {};
    aromes.forEach(a => { aromeColor[a.nom] = a.couleur || '#ccc'; });

    const periodDays = parseInt(savedPeriod, 10);
    const cutoff = !isNaN(periodDays) ? Date.now() - periodDays * 86400000 : null;

    const entries = history.map(r => {
        const isVente = String(r.id).startsWith('VENTE-');
        const isRestauration = String(r.id).startsWith('RESTAURE-');
        const when = r.dateAdded ? new Date(r.dateAdded).getTime()
                   : r.productionDate ? new Date(r.productionDate).getTime() : 0;
        return { ...r, isVente, isRestauration, when };
    }).filter(e => {
        if (e.isRestauration) return false;
        if (savedType === 'prod'  &&  e.isVente) return false;
        if (savedType === 'vente' && !e.isVente) return false;
        if (savedArome  && e.arome  !== savedArome)  return false;
        if (savedFormat && e.format !== savedFormat) return false;
        if (cutoff !== null && e.when < cutoff)      return false;
        if (savedQuery) {
            const hay = `${e.lotId || ''} ${e.arome || ''} ${e.format || ''} ${e.quantity || ''}`.toLowerCase();
            if (!hay.includes(savedQuery)) return false;
        }
        return true;
    }).sort((a, b) => b.when - a.when);

    const totalVente = entries.filter(e =>  e.isVente).reduce((s, e) => s + (e.quantity || 0), 0);

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
            const dProd  = dayEntries.filter(e => !e.isVente).reduce((s, e) => s + (e.quantity || 0), 0);
            const dVente = dayEntries.filter(e =>  e.isVente).reduce((s, e) => s + (e.quantity || 0), 0);
            const meta = [dProd ? `+${dProd}` : '', dVente ? `−${dVente}` : ''].filter(Boolean).join('  ·  ');
            return `
            <div class="hist-day">
                <div class="hist-day-head">
                    <span class="hist-day-label">${dayLabel(key)}</span>
                    <span class="hist-day-meta">${meta}</span>
                </div>
                <div class="hist-day-list">
                    ${dayEntries.map(e => {
                        const lotNum = e.lotId ? '#' + escapeHtml(String(e.numLot || e.lotId).padStart(6, '0')) : 'Lot ?';
                        const color = safeColor(aromeColor[e.arome]);
                        return `
                        <div class="hist-entry ${e.isVente ? 'is-vente' : 'is-prod'}">
                            <span class="hist-entry-dot" style="background:${color}"></span>
                            <div class="hist-entry-main">
                                <div class="hist-entry-title">${escapeHtml(e.arome || '?')} <span class="hist-entry-format">${escapeHtml(e.format || '')}</span></div>
                                <div class="hist-entry-sub">
                                    <span class="hist-entry-tag ${e.isVente ? 'tag-vente' : 'tag-prod'}">${e.isVente ? 'Vente directe' : 'Production'}</span>
                                    <button type="button" class="hist-entry-lot" data-click="show-lot-trace" data-id="${escapeHtml(String(e.lotId))}">${lotNum}</button>
                                    ${e.isVente && e.productionDate ? `<span class="hist-entry-note">prod. ${formatDate(e.productionDate)}</span>` : ''}
                                </div>
                            </div>
                            <div class="hist-entry-qty ${e.isVente ? 'neg' : 'pos'}">${e.isVente ? '−' : '+'}${e.quantity}</div>
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

    // Production entries only (exclure VENTE- et RESTAURE-)
    const prodEntries = history.filter(r => {
        const id = String(r.id);
        return !id.startsWith('VENTE-') && !id.startsWith('RESTAURE-');
    });

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
        const dlv = formData.get('dlv');
        const dlc = formData.get('dlc');

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

        let newId, numLot;
        if (existingLot) {
            existingLot.quantite = (existingLot.quantite || 0) + quantite;
            newId = existingLot.id;
            numLot = existingLot.numLot || existingLot.id;
        } else {
            newId = generateId();
            numLot = nextLotNumero(lots, history);

            const lot = {
                id: newId,
                numLot,
                arome,
                format,
                quantite,
                dateProduction,
                dlv,
                dlc
            };
            lots.push(lot);
        }

        history.unshift({
            id: `PROD-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
            lotId: newId,
            numLot,
            arome,
            format,
            quantity: quantite,
            productionDate: dateProduction,
            dateAdded: new Date().toISOString()
        });

        DB.set('lots', lots);
        DB.set('history', history);

        modal.hide();
        showToast('Lot créé avec succès');
        renderCurrentView();
    } catch (e) {
        console.error('Error saving lot:', e);
        showToast('Erreur lors de la création du lot', 'error');
    } finally {
        if (reenable) reenable();
    }
};

const deleteLot = (id) => {
    confirmDialog('Êtes-vous sûr de vouloir supprimer ce lot ?', { danger: true }).then(ok => {
        if (!ok) return;
        const lots = DB.get('lots').filter(l => l.id !== id);
        DB.set('lots', lots);
        showToast('Lot supprimé');
        renderStock();
    });
};

const showVendreModal = (lotId) => {
    const lots = DB.get('lots');
    const lot = lots.find(l => l.id === lotId);
    if (!lot) return;
    if (!isLotSellable(lot)) {
        showToast('Ce lot ne peut pas être vendu (DLV/DLC expirée ou absente).', 'error');
        return;
    }

    modal.show('Vendre des bouteilles', `
        <form id="vendreForm">
            <div class="form-group">
                <label>Quantité à vendre</label>
                <input type="number" name="quantite" min="1" max="${safeNumAttr(lot.quantite)}" step="1" value="1" required>
                <small class="text-muted">Stock disponible: ${escapeHtml(String(lot.quantite))}</small>
            </div>
        </form>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Annuler</button>
        <button class="btn btn-success" data-click="vendre-lot" data-id="${escapeHtml(lotId)}">Vendre</button>
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

    // Vérifier que le lot est vendable (DLV/DLC valide)
    if (!isLotSellable(lot)) {
        showToast('Ce lot ne peut plus être vendu (DLV/DLC expirée).', 'error');
        return;
    }

    const quantite = Number(document.querySelector('#vendreForm input[name="quantite"]')?.value);
    const stockDisponible = Number(lot.quantite);
    if (!Number.isInteger(quantite) || quantite <= 0 || !Number.isFinite(stockDisponible) || quantite > stockDisponible) {
        showToast('Quantité invalide : saisissez un nombre entier disponible en stock', 'error');
        return;
    }

    lot.quantite -= quantite;

    // Traçabilité : journaliser la vente directe
    const history = DB.get('history') || [];
    history.unshift({
        id: `VENTE-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
        lotId: lot.id,
        numLot: lot.numLot || lot.id,
        arome: lot.arome,
        format: lot.format,
        quantity: quantite,
        productionDate: lot.dateProduction,
        dateAdded: new Date().toISOString()
    });

    if (lot.quantite <= 0) {
        lots.splice(lotIndex, 1);
    }

    DB.set('lots', lots);
    DB.set('history', history);
    modal.hide();
    showToast(`${quantite} bouteille(s) vendu(e)s`);
    renderStock();
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

    const productions = history.filter(h => String(h.lotId) === idStr && String(h.id).startsWith('PROD-'));
    const totalProduit = productions.reduce((s, h) => s + (h.quantity || 0), 0);

    const ventes = history.filter(h => String(h.lotId) === idStr && String(h.id).startsWith('VENTE-'));
    const totalVenteDirecte = ventes.reduce((s, h) => s + (h.quantity || 0), 0);

    const livraisonsClients = [];
    commandes.forEach(cmd => {
        (cmd.lotsUtilises || []).forEach(lu => {
            if (String(lu.lotId) !== idStr || !(lu.quantite > 0)) return;
            const client = clients.find(c => c.id === cmd.clientId);
            const bl = livraisons.find(l => l.commandeId === cmd.id);
            livraisonsClients.push({
                date: cmd.dateLivraison || '',
                commandeNumero: getCommandeNumero(cmd),
                clientNom: client ? (client.societe || client.nom) : '(client inconnu)',
                numeroBL: bl?.numeroBL || '',
                quantite: lu.quantite,
                arome: lu.arome || '',
                format: lu.format || '',
                dlc: lu.dlc || ''
            });
        });
    });
    livraisonsClients.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    const totalLivre = livraisonsClients.reduce((s, l) => s + l.quantite, 0);

    // Infos de référence : lot en stock, sinon production, sinon trace de livraison
    const ref = lot || productions[productions.length - 1] || livraisonsClients[0] || ventes[0] || {};
    return {
        lotId: idStr,
        numLot: lot?.numLot || productions[0]?.numLot || idStr,
        lot,
        arome: ref.arome || '',
        format: ref.format || '',
        dateProduction: lot?.dateProduction || ref.productionDate || '',
        dlc: lot?.dlc || ref.dlc || '',
        enStock: lot ? (lot.quantite || 0) : 0,
        totalProduit,
        totalLivre,
        totalVenteDirecte,
        livraisonsClients,
        ventes
    };
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

    // Écart = produit − livré − vendu − en stock (pertes, casse, ajustements manuels)
    const ecart = t.totalProduit > 0 ? t.totalProduit - t.totalLivre - t.totalVenteDirecte - t.enStock : null;

    const livraisonsHtml = t.livraisonsClients.length === 0
        ? '<p class="text-muted">Aucune livraison client pour ce lot</p>'
        : `<table class="details-table">
            <thead>
                <tr><th>Date</th><th>Client</th><th>Cmd</th><th>BL</th><th>Qté</th></tr>
            </thead>
            <tbody>
                ${t.livraisonsClients.map(l => `
                    <tr>
                        <td>${l.date ? formatDate(l.date) : '—'}</td>
                        <td>${escapeHtml(l.clientNom)}</td>
                        <td>#${escapeHtml(String(l.commandeNumero || '—'))}</td>
                        <td>${l.numeroBL ? escapeHtml(String(l.numeroBL)) : '—'}</td>
                        <td><strong>${l.quantite} bt</strong></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;

    const ventesHtml = t.ventes.length === 0 ? '' : `
        <h4 style="margin-top: 16px;">Ventes directes</h4>
        ${t.ventes.map(v => `
            <div class="flex-between" style="padding: 6px 0; border-bottom: 1px solid var(--border-light); font-size: 13px;">
                <span>${v.dateAdded ? new Date(v.dateAdded).toLocaleDateString('fr-CH') : '—'}</span>
                <strong>${v.quantity} bt</strong>
            </div>
        `).join('')}`;

    modal.show(`Traçabilité lot #${escapeHtml(String(t.numLot || t.lotId).padStart(6, '0'))}`, `
        <div class="commande-details">
            ${ligne('Arôme / Format', `${escapeHtml(t.arome || '?')} • ${escapeHtml(t.format || '?')}`)}
            ${t.dateProduction ? ligne('Date de production', formatDate(t.dateProduction)) : ''}
            ${t.dlc ? ligne('DLC', formatDate(t.dlc)) : ''}
            ${t.totalProduit > 0 ? ligne('Produit', `${t.totalProduit} bt`) : ''}
            ${ligne('Livré aux clients', `${t.totalLivre} bt`)}
            ${t.totalVenteDirecte > 0 ? ligne('Ventes directes', `${t.totalVenteDirecte} bt`) : ''}
            ${ligne('En stock', t.lot ? `${t.enStock} bt` : '<span class="badge badge-default">Épuisé</span>')}
            ${ecart !== null && ecart !== 0 ? ligne('Écart (pertes / ajustements)', `${ecart} bt`) : ''}

            <h4 style="margin-top: 16px;">Livraisons clients</h4>
            ${livraisonsHtml}
            ${ventesHtml}
        </div>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Fermer</button>
    `);
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

        const lots = DB.get('lots');
        const lotIndex = lots.findIndex(l => l.id === lotId);

        if (lotIndex !== -1) {
            lots[lotIndex].arome = arome;
            lots[lotIndex].format = format;
            lots[lotIndex].quantite = quantite;
            lots[lotIndex].dateProduction = dateProduction;
            lots[lotIndex].dlv = dlv;
            lots[lotIndex].dlc = dlc;
            DB.set('lots', lots);
            modal.hide();
            showToast('Lot modifié');
            renderStock();
        }
    } catch (e) {
        console.error('Error editing lot:', e);
        showToast('Erreur lors de la modification du lot', 'error');
    } finally {
        if (reenable) reenable();
    }
};

// Pointage — helper functions
const pointageSelectEmployee = (empId) => {
    pointageSelectedEmployeId = empId;
    renderPointage();
};

const pointageQuickArrivee = () => {
    if (!pointageSelectedEmployeId) {
        showToast('Sélectionne un employé', 'error');
        return;
    }
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const heureDebut = `${hh}:${mm}`;
    const today = getLocalDateISOString();
    const pointages = DB.get('pointages') || [];
    const enCours = pointages.find(p => p.date === today && p.employeId === pointageSelectedEmployeId && !p.heureFin);
    if (enCours) {
        showToast('Pointage déjà en cours pour cet employé', 'error');
        return;
    }
    pointages.push({
        id: generateId(),
        employeId: pointageSelectedEmployeId,
        date: today,
        heureDebut,
        heureFin: '',
        pause: 0
    });
    DB.set('pointages', pointages);
    showToast(`Arrivée pointée à ${heureDebut}`);
    renderPointage();
};

const pointageQuickDepart = () => {
    if (!pointageSelectedEmployeId) {
        showToast('Sélectionne un employé', 'error');
        return;
    }
    const today = getLocalDateISOString();
    const pointages = DB.get('pointages') || [];
    const enCours = pointages.find(p => p.date === today && p.employeId === pointageSelectedEmployeId && !p.heureFin);
    if (!enCours) {
        showToast('Aucun pointage en cours pour cet employé', 'error');
        return;
    }
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    enCours.heureFin = `${hh}:${mm}`;
    DB.set('pointages', pointages);
    showToast(`Départ pointé à ${enCours.heureFin}`);
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

    // Pointages du jour, indexés par employé pour détecter le "live" (pas de heureFin) ou état du jour
    const pointagesAujourdhui = pointages.filter(p => p.date === today);
    const pointageEnCoursParEmp = {};
    pointagesAujourdhui.forEach(p => {
        if (!p.heureFin) pointageEnCoursParEmp[p.employeId] = p;
    });

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

const showCommandeModal = (id = null) => {
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

    // Inclure le client de la commande même s'il est inactif (ex: client ponctuel)
    const clientOptions = [...clients];
    if (commande?.clientId && !clientOptions.some(c => c.id === commande.clientId)) {
        const existing = DB.get('clients').find(c => c.id === commande.clientId);
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
                        ${clientOptions.map(c => `<option value="${escapeHtml(c.id)}" ${commande?.clientId === c.id ? 'selected' : ''}>${escapeHtml(c.societe || c.nom)}</option>`).join('')}
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
                                ${formats.map(f => `<th>${escapeHtml(f.nom)}</th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>
                            ${aromes.map(a => `
                                <tr>
                                    <td>${escapeHtml(a.nom)}</td>
                                    ${formats.map(f => {
                                        const item = commande?.items?.find(i => i.aromeId === a.id && i.formatId === f.id);
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
        renderCommandes();
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
        renderCommandes();
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

                newHistoryEntries.push({
                    id: `RESTAURE-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
                    lotId: entry.lotId,
                    numLot: entry.numLot || entry.lotId,
                    arome: entry.arome,
                    format: entry.format,
                    quantity: entry.quantite,
                    productionDate: entry.dateProduction || '',
                    dateAdded: new Date().toISOString()
                });
            });

            DB.set('lots', lots);

            cmd.lotsUtilises = [];
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
                `Le lot #${String(lotId).slice(-6)} est alloué à des articles incompatibles ` +
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
                    `Lot introuvable sur le serveur (#${String(lotId).slice(-6)}). ` +
                    'La commande n\'a pas été modifiée.'
                );
            }
            const lotData = lotSnap.data();
            const lot = lotData && lotData.record;
            if (!lot) {
                throw new Error(
                    `Données de lot corrompues (#${String(lotId).slice(-6)}). Livraison annulée.`
                );
            }

            // Vérification arome/format depuis les données DISTANTES
            const remoteNorm = normalize(lot.arome) + '|' + normalize(lot.format);
            const expectedNorm = [...la.aromes][0] + '|' + [...la.formats][0];
            if (remoteNorm !== expectedNorm) {
                throw new Error(
                    `Le lot #${String(lot.numLot || lotId).slice(-6)} ne correspond plus à l'article commandé ` +
                    `(attendu « ${expectedNorm} », trouvé « ${remoteNorm} » à distance). Livraison annulée.`
                );
            }

            // Vérification DLV (Date Limite de Vente) — si présente
            const today = dateOnly(new Date());
            if (lot.dlv) {
                const dlvDate = dateOnly(lot.dlv);
                if (Number.isNaN(dlvDate.getTime()) || dlvDate < today) {
                    throw new Error(
                        `Le lot #${String(lot.numLot || lotId).slice(-6)} a une DLV expirée ` +
                        `(${lot.dlv}). Livraison annulée.`
                    );
                }
            }

            // Vérification DLC (Date Limite de Consommation)
            if (!lot.dlc) {
                throw new Error(
                    `Le lot #${String(lot.numLot || lotId).slice(-6)} n'a pas de DLC ` +
                    'et ne peut pas être livré.'
                );
            }
            const dlcDate = dateOnly(lot.dlc);
            if (Number.isNaN(dlcDate.getTime()) || dlcDate < today) {
                throw new Error(
                    `Le lot #${String(lot.numLot || lotId).slice(-6)} a une DLC expirée ` +
                    `(${lot.dlc}). Livraison annulée.`
                );
            }

            // Vérification stock suffisant depuis les données DISTANTES
            const disponible = Number(lot.quantite);
            if (!Number.isFinite(disponible) || disponible < la.totalQty) {
                throw new Error(
                    `Stock insuffisant sur le lot #${String(lot.numLot || lotId).slice(-6)} : ` +
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
        const updatedCommande = {
            ...commande,
            statut: 'livrée',
            lotsUtilises
        };
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
                    <span style="font-size: 12px;">#${escapeHtml(String(lot.numLot || lot.id).slice(-6))} — ${escapeHtml(lot.arome)} ${escapeHtml(lot.format)} <em style="color: var(--text-muted);">(Stock: ${escapeHtml(String(lot.quantite))})</em></span>
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
                showToast(`Lot indisponible ou stock insuffisant sur #${lot ? String(lot.numLot || lot.id).slice(-6) : String(lotId).slice(-6)}. Livraison non effectuée.`, 'error');
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
    const stockDisponible = calculateAvailableStock(lots, now);
    let updatedCount = 0;

    const commandesTriees = commandes
        .map((commande, index) => ({ commande, index }))
        .sort((a, b) => {
            const aDate = dateOnly(a.commande.dateLivraison).getTime();
            const bDate = dateOnly(b.commande.dateLivraison).getTime();
            const aSort = Number.isNaN(aDate) ? Number.POSITIVE_INFINITY : aDate;
            const bSort = Number.isNaN(bDate) ? Number.POSITIVE_INFINITY : bDate;
            return aSort - bSort || a.index - b.index;
        });
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
            const disponible = stockDisponible[key] || 0;
            if (disponible < qty) canProduce = false;
        });

        if (canProduce) {
            Object.entries(needed).forEach(([key, qty]) => {
                stockDisponible[key] -= qty;
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
                <td><a href="#" style="color: var(--primary); font-weight: 600;" data-click="show-lot-trace" data-id="${escapeHtml(String(lot.lotId))}" data-prevent>#${escapeHtml(String(lot.numLot || lot.lotId).slice(-6))}</a></td>
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
        actionsHtml = `<button class="btn btn-secondary" data-click="duplicate-commande" data-id="${escapeHtml(id)}">Dupliquer</button>`
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
    const copy = {
        id: generateId(),
        numero: getNextCommandeNumero(),
        clientId: original.clientId,
        dateCommande: getLocalDateISOString(),
        dateLivraison: '',
        statut: 'en_attente',
        items: (original.items || []).map(i => ({ ...i }))
    };
    commandes.push(copy);
    DB.set('commandes', commandes);
    modal.hide();
    showToast(`Commande dupliquée → #${copy.numero}`);
    showCommandeModal(copy.id);
};

const toggleArchives = () => {
    const showArchives = localStorage.getItem('thecol_show_archives') === 'true';
    localStorage.setItem('thecol_show_archives', showArchives ? 'false' : 'true');
    renderCommandes();
};

// Archives
const renderArchives = () => {
    const savedFilterYear = DB.getFilter('archive_year');
    const savedFilterClient = DB.getFilter('archive_client');
    const savedFilterStatut = DB.getFilter('archive_statut') || '';

    const commandes = DB.get('commandes').filter(c => c.statut === 'livrée' || c.statut === 'annulee');
    const clients = DB.get('clients') || [];
    const aromes = DB.get('aromes') || [];
    const formats = DB.get('formats') || [];

    const years = [...new Set(commandes.map(c => c.dateCommande ? c.dateCommande.substring(0, 4) : '2024'))].sort().reverse();

    const filteredCommandes = commandes.filter(c => {
        const year = c.dateCommande ? c.dateCommande.substring(0, 4) : '2024';
        const matchesYear = !savedFilterYear || year === savedFilterYear;
        const matchesClient = !savedFilterClient || c.clientId === savedFilterClient;
        const matchesStatut = !savedFilterStatut || c.statut === savedFilterStatut;
        return matchesYear && matchesClient && matchesStatut;
    });

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
    const commandes = DB.get('commandes').filter(c => c.statut === 'livrée' || c.statut === 'annulee');
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
            ...(l.lignes || []).map(line => `${line.aromeNom || ''} ${line.formatNom || ''}`)
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
                <input type="search" id="filterLivraisonSearch" placeholder="Rechercher BL, client, commande..." value="${escapeHtml(savedSearch)}" oninput="DB.setFilter('livraison_search', this.value); window.__focusLivraisonSearch = true; renderLivraisons()">
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
                        const lastExport = liv.dateDernierExport ? formatDateTime(liv.dateDernierExport) : 'Jamais exporté';

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
            <td>#${escapeHtml(String(lot.numLot || lot.lotId || '').slice(-6))}</td>
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
            <p><strong>Dernier export:</strong> ${livraison.dateDernierExport ? formatDateTime(livraison.dateDernierExport) : 'Jamais exporté'}</p>
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
            dlc: lot.dlc || '',
            quantite: lot.quantite || 0,
            forceStockInsuffisant: !!lot.forceStockInsuffisant
        }));
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
            <td>#${escapeHtml(String(lot.numLot || lot.lotId || '').slice(-6))}</td>
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
        <button class="btn btn-secondary" onclick="modal.hide()">Annuler</button>
        <button class="btn btn-primary" id="confirmBLExportBtn">Exporter Excel</button>
    `, 'large');

    document.getElementById('confirmBLExportBtn')?.addEventListener('click', () => {
        const saved = saveBLPreparation(livraisonId);
        if (!saved) return;
        modal.hide();
        exportBLExcel(saved.id);
    });
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

    const livraison = {
        id: generateId(),
        numeroBL: getNextBLNumero(),
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

    const livraisons = DB.get('livraisons') || [];
    livraisons.push(livraison);
    DB.set('livraisons', livraisons);

    return livraison;
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
                    const freshLivraisons = DB.get('livraisons') || [];
                    const freshIndex = freshLivraisons.findIndex(l => l.id === livraison.id);
                    if (freshIndex !== -1) {
                        freshLivraisons[freshIndex] = {
                            ...freshLivraisons[freshIndex],
                            dateDernierExport: new Date().toISOString()
                        };
                        DB.set('livraisons', freshLivraisons);
                    }
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
    const stockDisponible = calculateAvailableStock(lots, now);

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

        commandesAInclure.forEach(cmd => {
            (cmd.items || []).forEach(item => {
                const arome = aromes.find(a => a.id === item.aromeId);
                const format = formats.find(f => f.id === item.formatId);
                const key = `${arome?.nom || ''}-${format?.nom || ''}`;
                if (!besoins[key]) {
                    besoins[key] = { aromeId: item.aromeId, formatId: item.formatId, aromeNom: arome?.nom || '', formatNom: format?.nom || '', quantite: 0 };
                }
                besoins[key].quantite += item.quantite;
            });
        });
    }

    // Production nécessaire. En mode manuel on produit exactement la quantité
    // saisie ; en mode auto on déduit le stock déjà disponible.
    const productionNecesaire = {};
    Object.entries(besoins).forEach(([key, b]) => {
        const disponible = stockDisponible[key] || 0;
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

const isWaterIngredient = (nom) => {
    const normalized = normalizeName(nom);
    return normalized.includes('eau');
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
        const existingLot = lots.find(l => l.arome === aromeNom && l.format === format.nom && l.dateProduction === dateProduction);
        let lotId;
        if (existingLot) {
            existingLot.quantite = (existingLot.quantite || 0) + quantite;
            if (!existingLot.numLot) existingLot.numLot = numLot;
            lotId = existingLot.id;
        } else {
            lotId = generateId();
            lots.push({ id: lotId, numLot, arome: aromeNom, format: format.nom, quantite, dateProduction, dlv: dates.dlv, dlc: dates.dlc });
        }
        history.unshift({
            id: `PROD-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
            lotId,
            numLot,
            arome: aromeNom,
            format: format.nom,
            quantity: quantite,
            productionDate: dateProduction,
            dateAdded: new Date().toISOString()
        });
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
        renderInventaire();
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
        renderInventaire();
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
        renderInventaire();
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

            <div class="settings-card" style="grid-column: 1 / -1; border: 2px solid var(--danger);">
                <div class="settings-card-header">
                    <h3>Réinitialisation</h3>
                </div>
                <div style="padding: 12px;">
                    <button class="btn btn-danger" onclick="resetCounters()">Réinitialiser les compteurs</button>
                    <p style="margin-top: 8px; font-size: 12px; color: var(--text-light);">
                        Remet les numéros de lots et de commandes à 1. Cette action est irréversible.
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

// Settings - Counters
const resetCounters = () => {
    showToast('Les compteurs sont maintenant calculés dynamiquement depuis les données existantes');
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
        renderParametres();
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
