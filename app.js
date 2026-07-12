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
    const s = String(v ?? '');
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
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

// Data Storage with Firebase sync
const DB = {
    firebaseSynced: false,

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
        let localOk = true;
        try {
            localStorage.setItem('thecol_' + key, JSON.stringify(data));
        } catch (e) {
            localOk = false;
            if (e.name === 'QuotaExceededError' || e.code === 22) {
                console.warn('localStorage full for key ' + key + ', attempting Firebase sync');
            } else {
                console.error('Error saving data for key ' + key, e);
            }
        }
        if (window.firebaseReady && window.firebaseDb) {
            DB.syncToFirebase(key, data);
        } else {
            markDirty(key);
        }
        if (!localOk) {
            showToast('Stockage local plein. Synchronisation cloud effectuée.', 'warning');
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

// Manual sync function
window.forceFirebaseSync = async () => {
    const syncBtn = document.getElementById('syncBtn');
    const restoreBtn = setBusy(syncBtn, 'Sync…');
    modal.show('Synchronisation',
        '<div style="text-align:center; padding: 20px;" aria-busy="true"><p><span class="spinner" aria-hidden="true"></span> Synchronisation en cours avec le Cloud...</p><p>Veuillez patienter.</p></div>',
        '');
    document.getElementById('modalClose').style.display = 'none'; // Lock modal during sync
    try {
        const dirty = getDirtyTables();
        const failedTables = [];
        if (dirty.length > 0) {
            for (const key of dirty) {
                const data = DB.get(key);
                const success = await DB.syncToFirebase(key, data);
                if (!success) failedTables.push(key);
            }
            if (failedTables.length > 0) {
                showToast(`${failedTables.length} table(s) locale(s) non synchronisée(s) — pull partiel`, 'warning');
            }
        }
        await DB.loadFromFirebase(true, failedTables);
        renderCurrentView();
    } catch(e) {
        showToast('Erreur lors de la synchronisation', 'error');
    } finally {
        document.getElementById('modalClose').style.display = 'block';
        modal.hide();
        restoreBtn();
    }
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

const escapeHtml = (str) => {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
    if (!lot?.dlc) return false;
    const dlcDate = dateOnly(lot.dlc);
    const refDate = dateOnly(referenceDate);
    return !Number.isNaN(dlcDate.getTime()) && !Number.isNaN(refDate.getTime()) && dlcDate >= refDate;
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
            <button type="button" class="segment ${currentValue === opt.value ? 'active' : ''}" onclick="DB.setFilter('${name}', '${opt.value}'); ${renderFnName}()">
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
        <button type="button" class="global-search-result" onclick="openGlobalSearchResult('${match.type}', '${match.id}')">
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

// Navigation
const router = () => {
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
                    <div class="dash-todo-item ${t.done ? 'done' : ''}" style="cursor:pointer;" onclick="toggleTodo('${t.id}')">
                        <span class="dash-todo-check" style="${t.done ? 'display:flex;align-items:center;justify-content:center;color:white;font-size:12px;' : ''}">${t.done ? '✓' : ''}</span>
                        <span class="dash-todo-label">${escapeHtml(t.text)}</span>
                        <button class="btn-bare" style="color: var(--text-lighter); font-size: 16px; padding: 0 4px;" onclick="event.stopPropagation(); deleteTodo('${t.id}')" aria-label="Supprimer">✕</button>
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
                        <span style="display: inline-flex; align-items: center; gap: 8px;"><span class="color-dot" style="background: ${arome?.couleur || '#ccc'}; width: 10px; height: 10px; border-radius: 50%; display: inline-block;"></span>${escapeHtml(b.aromeNom)} ${escapeHtml(formatLitres)}</span>
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
        <a href="#stock" class="aroma-tile aroma-all ${!savedArome ? 'active' : ''}" onclick="event.preventDefault(); toggleStockAromeFilter(''); return false;">
            <div class="aroma-tile-header"><span class="aroma-tile-dot"></span><span class="aroma-tile-name">Tous</span></div>
            <div class="aroma-tile-value">${sellableBottles}</div>
            <div class="aroma-tile-sub">btl vendables</div>
        </a>
        ${tileAromas.map(a => `
            <a href="#stock" class="aroma-tile ${savedArome === a.nom ? 'active' : ''}"
               onclick="event.preventDefault(); toggleStockAromeFilter('${escapeHtml(a.nom).replace(/'/g, '\\\'')}'); return false;">
                <div class="aroma-tile-header">
                    <span class="aroma-tile-dot" style="background:${escapeHtml(a.couleur || '#ccc')}"></span>
                    <span class="aroma-tile-name">${escapeHtml(a.nom)}</span>
                </div>
                <div class="aroma-tile-value">${sellableByAroma[a.nom] || 0}</div>
                <div class="aroma-tile-sub">btl vendables</div>
            </a>
        `).join('')}
    `;

    const fmtPill = (val, label) => `<button type="button" class="status-pill ${savedFormat === val ? 'active' : ''}" onclick="toggleStockFormatFilter('${escapeHtml(val).replace(/'/g, '\\\'')}')">${escapeHtml(label)}</button>`;
    const statPill = (val, label) => `<button type="button" class="status-pill ${savedStatut === val ? 'active' : ''}" onclick="toggleStockStatutFilter('${val}')">${escapeHtml(label)}</button>`;

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
                            <span class="aroma-tile-dot" style="background:${escapeHtml(arome?.couleur || '#ccc')}"></span>
                            <span class="lot-card-aroma-name">${escapeHtml(l.arome || '?')}</span>
                            <span class="lot-card-aroma-format">• ${escapeHtml(l.format || '?')}</span>
                        </div>
                        <div class="lot-card-meta">
                            ${l.dateProduction ? `<span>Prod. <strong>${formatDate(l.dateProduction)}</strong></span>` : ''}
                            ${l.dlc ? `<span>DLC <strong>${formatDate(l.dlc)}</strong></span>` : ''}
                        </div>
                        <div class="lot-card-actions">
                            <button class="btn btn-sm btn-ghost" onclick="showLotTraceModal('${escapeHtml(l.id)}')">Tracer</button>
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
                    <span class="aroma-tile-dot" style="background:${escapeHtml(arome?.couleur || '#ccc')}"></span>
                    <span class="lot-card-aroma-name">${escapeHtml(lot.arome || '?')}</span>
                    <span class="lot-card-aroma-format">• ${escapeHtml(lot.format || '?')}</span>
                </div>
                <div class="lot-card-meta">
                    <span><strong class="lot-card-qty">${lot.quantite}</strong> bt</span>
                    <span>Prod. <strong>${formatDate(lot.dateProduction)}</strong></span>
                    <span>DLC <strong>${formatDate(lot.dlc)}</strong></span>
                </div>
                <div class="lot-card-actions">
                    ${status !== 'expired' ? `<button class="btn btn-sm btn-success" onclick="showVendreModal('${lot.id}')">Vendre</button>` : ''}
                    <button class="btn btn-sm btn-ghost" onclick="showLotTraceModal('${lot.id}')">Tracer</button>
                    <button class="btn btn-sm btn-ghost" onclick="showEditLotModal('${lot.id}')">Modifier</button>
                    <button class="btn btn-sm btn-ghost" style="color: var(--danger);" onclick="deleteLot('${lot.id}')">Supprimer</button>
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

    const typePill   = (val, label) => `<button type="button" class="status-pill ${savedType   === val ? 'active' : ''}" onclick="setHistFilter('Type', '${val}')">${label}</button>`;
    const aromePill  = (val)        => `<button type="button" class="status-pill ${savedArome  === val ? 'active' : ''}" onclick="setHistFilter('Arome', '${escapeHtml(val).replace(/'/g, "\\'")}')">${escapeHtml(val)}</button>`;
    const formatPill = (val)        => `<button type="button" class="status-pill ${savedFormat === val ? 'active' : ''}" onclick="setHistFilter('Format', '${escapeHtml(val).replace(/'/g, "\\'")}')">${escapeHtml(val)}</button>`;
    const periodPill = (val, label) => `<button type="button" class="status-pill ${savedPeriod === val ? 'active' : ''}" onclick="setHistFilter('Period', '${val}')">${label}</button>`;

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
                        const lotNum = e.lotId ? `#${String(e.numLot || e.lotId).padStart(6, '0')}` : 'Lot ?';
                        const color = aromeColor[e.arome] || '#ccc';
                        return `
                        <div class="hist-entry ${e.isVente ? 'is-vente' : 'is-prod'}">
                            <span class="hist-entry-dot" style="background:${escapeHtml(color)}"></span>
                            <div class="hist-entry-main">
                                <div class="hist-entry-title">${escapeHtml(e.arome || '?')} <span class="hist-entry-format">${escapeHtml(e.format || '')}</span></div>
                                <div class="hist-entry-sub">
                                    <span class="hist-entry-tag ${e.isVente ? 'tag-vente' : 'tag-prod'}">${e.isVente ? 'Vente directe' : 'Production'}</span>
                                    <button type="button" class="hist-entry-lot" onclick="showLotTraceModal('${escapeHtml(String(e.lotId))}')">${lotNum}</button>
                                    ${e.isVente && e.productionDate ? `<span class="hist-entry-note">prod. ${formatDate(e.productionDate)}</span>` : ''}
                                </div>
                            </div>
                            <div class="hist-entry-qty ${e.isVente ? 'neg' : 'pos'}">${e.isVente ? '−' : '+'}${e.quantity}</div>
                            <button type="button" class="hist-entry-del" title="Supprimer" aria-label="Supprimer cet enregistrement" onclick="deleteHistoryRecord('${e.id}')">✕</button>
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

        let newId;
        if (existingLot) {
            existingLot.quantite = (existingLot.quantite || 0) + quantite;
            newId = existingLot.id;
        } else {
            let maxNum = 0;
            let hasNumericId = false;
            lots.forEach(l => {
                const num = parseInt(l.id, 10);
                if (!isNaN(num)) {
                    hasNumericId = true;
                    if (num > maxNum) maxNum = num;
                }
            });
            newId = hasNumericId
                ? String(maxNum + 1).padStart(6, '0')
                : generateId();

            const lot = {
                id: newId,
                numLot: newId,
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
            numLot: newId,
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

    modal.show('Vendre des bouteilles', `
        <form id="vendreForm">
            <div class="form-group">
                <label>Quantité à vendre</label>
                <input type="number" name="quantite" min="1" max="${lot.quantite}" step="1" value="1" required>
                <small class="text-muted">Stock disponible: ${lot.quantite}</small>
            </div>
        </form>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Annuler</button>
        <button class="btn btn-success" onclick="vendreLot('${lotId}')">Vendre</button>
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

    modal.show('Modifier le lot', `
        <form id="editLotForm">
            <div class="form-group">
                <label>Quantité</label>
                <input type="number" name="quantite" value="${lot.quantite}" min="1" required>
            </div>
            <div class="form-group">
                <label>Date de production</label>
                <input type="date" name="dateProduction" value="${lot.dateProduction}" onchange="updateEditLotDates()" required>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Date limite de vente (DLV)</label>
                    <input type="date" name="dlv" value="${lot.dlv}" required>
                </div>
                <div class="form-group">
                    <label>Date limite de consommation (DLC)</label>
                    <input type="date" name="dlc" value="${lot.dlc}" required>
                </div>
            </div>
        </form>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Annuler</button>
        <button class="btn btn-primary" onclick="saveEditLot(event, '${lotId}')">Enregistrer</button>
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
                    ${employesActifs.map(e => `<option value="${e.id}">${escapeHtml(e.prenom + ' ' + (e.nom || ''))}</option>`).join('')}
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
                ${employesActifs.map(e => `<option value="${e.id}">${escapeHtml(e.prenom + ' ' + (e.nom || ''))}</option>`).join('')}
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
                        return `<a href="#pointage" class="employee-card ${isSelected ? 'selected' : ''}" onclick="event.preventDefault(); pointageSelectEmployee('${e.id}'); return false;">
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
                              employesActifs.map(e => `<option value="${e.id}" ${e.id === selectedEmpId ? 'selected' : ''}>${escapeHtml(e.prenom + ' ' + (e.nom || ''))}</option>`).join('')}
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
                    <button class="btn btn-sm btn-danger" onclick="deletePointage('${p.id}')">Supprimer</button>
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
                return `<button type="button" class="week-day ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}"
                    onclick="selectWeekDay('${dStr}')">
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
        <button type="button" class="status-pill ${savedFilterStatut === key ? 'active' : ''}"
            onclick="togglePillStatut('${key}')">
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
            const cardClass = `commande-card statut-${cmd.statut === 'livrée' ? 'livree' : cmd.statut}`;
            return `<a href="#commandes" class="${cardClass}" onclick="event.preventDefault(); showCommandeDetails('${cmd.id}'); return false;">
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
            <button type="button" class="btn-bare" style="color: var(--primary); font-size: 12px; padding: 0;" onclick="selectWeekDay('${weekCalendarSelectedDate}')">Effacer ✕</button>
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
                        ${clientOptions.map(c => `<option value="${c.id}" ${commande?.clientId === c.id ? 'selected' : ''}>${escapeHtml(c.societe || c.nom)}</option>`).join('')}
                        <option value="__ponctuel__">➕ Client ponctuel (non récurrent)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Date de livraison</label>
                    <input type="date" name="dateLivraison" value="${commande?.dateLivraison || ''}" required>
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
                                        return `<td><input type="number" name="items[${a.id}][${f.id}]" value="${qty}" min="0" placeholder="0" class="item-qty-input" oninput="onMatrixCellInput(this)"></td>`;
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
        <button class="btn btn-primary" onclick="saveCommande(event, '${id || ''}')">Enregistrer</button>
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
                        dlv: entry.dlc,
                        dateProduction: prodEntry ? (prodEntry.productionDate || '') : ''
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
                    productionDate: '',
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
                    <span style="font-size: 12px;">#${String(lot.numLot || lot.id).slice(-6)} — ${escapeHtml(lot.arome)} ${escapeHtml(lot.format)} <em style="color: var(--text-muted);">(Stock: ${lot.quantite})</em></span>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <input type="number" class="lot-qty-input" data-lot="${lot.id}" data-item="${item.aromeId}|${item.formatId}" value="0" min="0" max="${lot.quantite}" style="width: 60px;">
                        <span style="font-size: 12px; color: var(--text-muted);">/ ${lot.quantite}</span>
                    </div>
                </div>`;
            }).join('');

        const itemKey = `${item.aromeId}|${item.formatId}`;
        const filledTotal = 0;
        const totalId = `item-total-${itemKey}`.replace(/[^a-zA-Z0-9]/g, '_');

        return `<div style="margin-bottom: 16px; padding: 12px; background: var(--bg-secondary); border-radius: var(--radius);">
            <div class="flex-between" style="margin-bottom: 8px;">
                <strong>${escapeHtml(aromeNom)} ${escapeHtml(formatNom)}</strong>
                <span style="color: var(--text-muted); font-size: 12px;">${item.quantite} commandées</span>
            </div>
            <div id="${totalId}" class="item-total-display" data-required="${item.quantite}">
                <span style="font-size: 12px;">Alloué: <strong id="${totalId}-count">${filledTotal}</strong> / ${item.quantite}</span>
            </div>
            <div style="margin-top: 8px;">${lotsRow}</div>
        </div>`;
    }).join('');

    const validateAndDeliver = () => {
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
                    showToast('Un lot alloué ne correspond pas à l’article commandé', 'error');
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

        const lotsUtilises = [];
        Object.values(allocations).forEach(group => {
            group.forEach(({ lotId, quantite }) => {
                const lot = lotsParId.get(String(lotId));
                lot.quantite = Number(lot.quantite) - quantite;
                lotsUtilises.push({
                    lotId: lot.id,
                    numLot: lot.numLot || lot.id,
                    arome: lot.arome,
                    format: lot.format,
                    dlc: lot.dlc || '',
                    quantite
                });
            });
        });

        if (allLots.some(lot => !Number.isFinite(Number(lot.quantite)) || Number(lot.quantite) < 0)) {
            showToast('Stock invalide : livraison non effectuée', 'error');
            return;
        }

        DB.set('lots', allLots.filter(lot => Number(lot.quantite) > 0));
        commandesActuelles[cmdIndex].lotsUtilises = lotsUtilises;
        DB.set('commandes', commandesActuelles);
        updateCommandeStatut(commandeId, 'livrée', { fromLivraison: true });
        modal.hide();
        showToast('Commande livrée et stock déduit');

        confirmDialog('Générer un bulletin de livraison maintenant ?').then(ok => {
            if (!ok) return;
            prepareCommandeBLExport(commandeId);
        });
    };

    const computeTotals = () => {
        let totalAlloueGlobal = 0;
        let ecarts = 0;
        document.querySelectorAll('.lot-qty-input').forEach(input => {
            const itemKey = input.dataset.item;
            const itemInputs = document.querySelectorAll(`.lot-qty-input[data-item="${itemKey}"]`);
            const total = Array.from(itemInputs).reduce((s, inp) => s + (parseInt(inp.value, 10) || 0), 0);
            const totalEl = document.getElementById(`item-total-${itemKey}`.replace(/[^a-zA-Z0-9]/g, '_') + '-count');
            if (totalEl) totalEl.textContent = total;
        });
        getItems(cmd).forEach(item => {
            const itemKey = `${item.aromeId}|${item.formatId}`;
            const itemInputs = document.querySelectorAll(`.lot-qty-input[data-item="${itemKey}"]`);
            const total = Array.from(itemInputs).reduce((s, inp) => s + (parseInt(inp.value, 10) || 0), 0);
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
            <td>${item.quantite}</td>
        </tr>`;
    }).join('');

    const lotsUtilisesHtml = commande.lotsUtilises && commande.lotsUtilises.length > 0
        ? commande.lotsUtilises.map(lot => `
            <tr>
                <td><a href="#" style="color: var(--primary); font-weight: 600;" onclick="event.preventDefault(); showLotTraceModal('${escapeHtml(String(lot.lotId))}')">#${String(lot.numLot || lot.lotId).slice(-6)}</a></td>
                <td>${escapeHtml(lot.arome)}</td>
                <td>${escapeHtml(lot.format)}</td>
                <td>${lot.quantite}</td>
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
        actionsHtml = `<button class="btn btn-secondary" onclick="editCommande('${id}')">Modifier</button>`
            + `<button class="btn btn-secondary" onclick="duplicateCommande('${id}')">Dupliquer</button>`
            + `<button class="btn btn-success" onclick="marquerCommandeProduite('${id}')">Marquer produite</button>`
            + `<button class="btn btn-danger" onclick="confirmAnnulerCommande('${id}')">Annuler la commande</button>` + actionsHtml;
    } else if (commande.statut === 'produite') {
        actionsHtml = `<button class="btn btn-secondary" onclick="editCommande('${id}')">Modifier</button>`
            + `<button class="btn btn-secondary" onclick="duplicateCommande('${id}')">Dupliquer</button>`
            + `<button class="btn btn-success" onclick="showLivraisonBouteillesModal('${id}')">Livrer</button>`
            + `<button class="btn btn-danger" onclick="confirmAnnulerCommande('${id}')">Annuler la commande</button>` + actionsHtml;
    } else if (commande.statut === 'livrée') {
        actionsHtml = `<button class="btn btn-secondary" onclick="duplicateCommande('${id}')">Dupliquer</button>`
            + `<button class="btn btn-secondary" onclick="restaurerCommande('${id}')">Restaurer</button>` + actionsHtml;
    } else if (commande.statut === 'annulee') {
        actionsHtml = `<button class="btn btn-secondary" onclick="restaurerCommande('${id}')">Restaurer</button>` + actionsHtml;
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
                    ${clients.filter(c => c.actif).map(c => `<option value="${c.id}" ${savedFilterClient === c.id ? 'selected' : ''}>${escapeHtml(c.societe || c.nom)}</option>`).join('')}
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
                                        <td>${getCommandeNumero(cmd)}</td>
                                        <td>${cmd.statut === 'annulee' ? '<span class="badge badge-annulee">Annulée</span>' : '<span class="badge badge-livree">Livrée</span>'}</td>
                                        <td>${escapeHtml(client?.societe || client?.nom || 'N/A')}</td>
                                        <td>${formatDate(cmd.dateCommande)}</td>
                                        <td>${formatDate(cmd.dateLivraison)}</td>
                                        <td>${articlesPreview}${safeItems.length > 2 ? '...' : ''} (${totalItems})</td>
                                        <td>
                                            <button class="btn btn-sm btn-secondary" onclick="showCommandeDetails('${cmd.id}')">Détails</button>
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
                    ${clients.filter(c => c.actif).map(c => `<option value="${c.id}" ${savedFilterClient === c.id ? 'selected' : ''}>${escapeHtml(c.societe || c.nom)}</option>`).join('')}
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
                                <span class="commande-card-numero">BL-${getBLNumero(liv)}</span>
                                <span class="commande-card-date">${formatDate(liv.dateBL)}</span>
                            </div>
                            <div class="commande-card-name">${escapeHtml(client?.societe || client?.nom || 'N/A')}</div>
                            <div class="commande-card-items">${escapeHtml(articlesPreview + more)} • ${totalItems} bt</div>
                            <div class="commande-card-footer">
                                <span class="badge ${traceItems > 0 ? 'badge-success' : 'badge-default'}">${traceItems > 0 ? `${traceItems} bt tracées` : 'Non tracé'}</span>
                                <span class="text-muted" style="font-size: 11px;">${escapeHtml(lastExport)}</span>
                            </div>
                            <div class="lot-card-actions" style="margin-top: 10px;">
                                <button class="btn btn-sm btn-secondary" onclick="showLivraisonDetails('${liv.id}')">Détails</button>
                                <button class="btn btn-sm btn-primary" onclick="showPrepareBLExportModal('${liv.id}')">Préparer / Exporter</button>
                                <button class="btn btn-sm btn-danger" onclick="deleteLivraison('${liv.id}')">Supprimer</button>
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
            <td>#${String(lot.numLot || lot.lotId || '').slice(-6)}</td>
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
            <p><strong>N° commande:</strong> #${commande ? getCommandeNumero(commande) : livraison.commandeId.slice(-5)}</p>
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
        <button class="btn btn-danger" onclick="deleteLivraison('${id}')">Supprimer</button>
        <button class="btn btn-secondary" onclick="modal.hide()">Fermer</button>
        <button class="btn btn-primary" onclick="showPrepareBLExportModal('${id}')">Préparer / Exporter</button>
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

const AROME_BL_NAMES = {
    // Canonical name -> ROW_MAP key
    'mures sauvages': 'Mûres Sauvages',
    'mure sauvage': 'Mûres Sauvages',
    'mûres sauvages': 'Mûres Sauvages',
    'mûre sauvage': 'Mûres Sauvages',
    'poire a botzi': 'Poire à Botzi',
    'poire à botzi': 'Poire à Botzi',
    'herbes des alpes': 'Herbes des Alpes',
    'sureau': 'Sureau',
    'hibiscus': 'Hibiscus',
    'coing': 'Coing',
    'edition noel': 'Edition Noël',
    'menthe': 'Menthe'
};

const getAromeBLName = (nom) => {
    if (!nom) return nom;
    const lower = nom.toLowerCase().trim();
    const mapped = AROME_BL_NAMES[lower];
    if (mapped) return mapped;
    const base = lower.replace(/s$/, '');
    return AROME_BL_NAMES[base] || nom;
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
            <td>#${String(lot.numLot || lot.lotId || '').slice(-6)}</td>
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
                <div><span>Commande</span><strong>#${commande ? getCommandeNumero(commande) : String(livraison.commandeId).slice(-5)}</strong></div>
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

const ROW_MAP = {
    'Poire à Botzi|25 cl': 15,
    'Poire à Botzi|50 cl': 16,
    'Poire à Botzi|100 cl': 17,
    'Mûres Sauvages|25 cl': 21,
    'Mûres Sauvages|50 cl': 22,
    'Mûres Sauvages|100 cl': 23,
    'Herbes des Alpes|25 cl': 24,
    'Herbes des Alpes|50 cl': 25,
    'Herbes des Alpes|100 cl': 26,
    'Menthe|25 cl': 18,
    'Menthe|50 cl': 19,
    'Menthe|100 cl': 20,
    'Hibiscus|25 cl': 27,
    'Hibiscus|50 cl': 28,
    'Hibiscus|100 cl': 29,
    'Sureau|25 cl': 30,
    'Sureau|50 cl': 31,
    'Sureau|100 cl': 32,
    'Coing|25 cl': 33,
    'Coing|50 cl': 34,
    'Coing|100 cl': 35,
    'Edition Noël|25 cl': 36,
    'Edition Noël|50 cl': 37,
    'Edition Noël|100 cl': 38
};

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

                const normalize = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
                const itemKeyOf = (m) => {
                    const canon = getAromeBLName(m.aromeNom || '') || m.aromeNom || '';
                    return `${normalize(canon)}|${m.formatNom}`;
                };

                const allRows = sheetDoc.getElementsByTagName('row');
                const matchedKeys = new Set();
                const mergedNormToKey = {};
                Object.values(merged).forEach(m => { mergedNormToKey[itemKeyOf(m)] = m; });

                for (let i = 0; i < allRows.length; i++) {
                    const row = allRows[i];
                    const rowNum = parseInt(row.getAttribute('r'));

                    if (rowNum >= 15 && rowNum <= 38) {
                        const cellA = findCellByRef(row, `A${rowNum}`);
                        if (!cellA) continue;

                        const mapEntry = Object.entries(ROW_MAP).find(([, r]) => r === rowNum);
                        if (!mapEntry) {
                            row.setAttribute('hidden', '1');
                            const vA = cellA.getElementsByTagName('v')[0];
                            if (vA) vA.textContent = '0';
                            const cellB = findCellByRef(row, `B${rowNum}`);
                            if (cellB) setCellTextDom(cellB, ' ');
                            continue;
                        }
                        const [mapKeyForRow, ] = mapEntry;
                        const [mapArome, mapFormat] = mapKeyForRow.split('|');
                        const normArome = normalize(mapArome);
                        const item = mergedNormToKey[`${normArome}|${mapFormat}`];

                        if (item) {
                            setCellValueDom(cellA, item.quantite);
                            row.removeAttribute('hidden');
                            matchedKeys.add(itemKeyOf(item));
                            const cellB = findCellByRef(row, `B${rowNum}`);
                            if (cellB) setCellTextDom(cellB, 'ThéCol - Thé Froid Artisanal');
                        } else {
                            row.setAttribute('hidden', '1');
                            const vA = cellA.getElementsByTagName('v')[0];
                            if (vA) vA.textContent = '0';
                            const cellB = findCellByRef(row, `B${rowNum}`);
                            if (cellB) setCellTextDom(cellB, ' ');
                        }
                    }

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

                    if (rowNum === 54) {
                        const cellA = findCellByRef(row, 'A54');
                        if (cellA) setCellTextDom(cellA, clientSociete || ' ');
                    }

                    if (rowNum >= 47 && rowNum <= 49) {
                        const expectedMode = rowNum === 47 ? 'email' : rowNum === 48 ? 'poste' : 'autre';
                        const cellD = findCellByRef(row, `D${rowNum}`);
                        if (cellD) {
                            if (livraison.facturationMode === expectedMode) {
                                setCellTextDom(cellD, 'x');
                            } else {
                                setCellTextDom(cellD, ' ');
                            }
                        }
                    }

                    if (rowNum >= 48 && rowNum <= 51) {
                        const cellA = findCellByRef(row, `A${rowNum}`);
                        if (cellA) {
                            if (rowNum === 48) {
                                setCellValueDom(cellA, cVerteLivree);
                            } else if (rowNum === 49) {
                                setCellValueDom(cellA, cNoireLivree);
                            } else {
                                clearCellDom(cellA);
                            }
                        }
                    }

                    if (rowNum >= 57 && rowNum <= 59) {
                        const clearCols = ['D', 'E', 'F'];
                        clearCols.forEach(col => {
                            const cell = findCellByRef(row, `${col}${rowNum}`);
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

                const unmatched = Object.values(merged).filter(m => !matchedKeys.has(itemKeyOf(m)));
                if (unmatched.length > 0) {
                    const labels = unmatched.slice(0, 3).map(m => `${m.aromeNom} ${m.formatNom} (${m.quantite}x)`).join(', ');
                    const suffix = unmatched.length > 3 ? ` +${unmatched.length - 3}` : '';
                    showToast(`Lignes non reconnues: ${labels}${suffix}`, 'warning');
                }

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
const renderProduction = () => {
    const commandes = DB.get('commandes');
    const aromes = DB.get('aromes');
    const formats = DB.get('formats');
    const recettes = DB.get('recettes');
    const lots = DB.get('lots') || [];

    // All non-cancelled, non-delivered orders
    const commandesPeriode = commandes.filter(c =>
        c.statut !== 'annulee' &&
        c.statut !== 'livrée'
    );

    const now = new Date();
    const stockDisponible = calculateAvailableStock(lots, now);

    // Calculate totals by arome and format (using names from commands)
    const besoins = {};

    commandesPeriode.forEach(cmd => {
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

    // Calculate production needed (total - available stock)
    const productionNecesaire = {};
    Object.entries(besoins).forEach(([key, b]) => {
        const disponible = stockDisponible[key] || 0;
        const aProduire = Math.max(0, b.quantite - disponible);
        productionNecesaire[key] = { ...b, disponible, aProduire };
    });

    // Calculate liters per arome (for production needed only)
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

    const totalBouteillesProduction = Object.values(productionNecesaire).reduce((sum, b) => sum + (b.aProduire || 0), 0);
    const totalLitresProduction = Object.values(litresParArome).reduce((sum, litres) => sum + litres, 0);

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
    const kpiHtml = `
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon blue">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/></svg>
                </div>
                <div class="stat-content"><h3>${commandesPeriode.length}</h3><p>Commandes à produire</p></div>
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

    // Render results
    const resultHtml = `
        <div class="production-summary">
            <div class="production-item">
                <h4>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/></svg>
                    Bouteilles à produire
                </h4>
                ${Object.values(productionNecesaire).length === 0 ? '<p class="text-muted">Aucune commande</p>' :
                  Object.values(productionNecesaire).map(b => {
                      const arome = aromes.find(a => a.nom === b.aromeNom);
                      return `<div class="flex-between" style="padding: 8px 0; border-bottom: 1px solid var(--border-light);">
                          <span><span class="color-dot" style="background: ${escapeHtml(arome?.couleur || '#ccc')}"></span>${escapeHtml(b.aromeNom)} ${escapeHtml(b.formatNom)}</span>
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
                ${Object.entries(litresParArome).length === 0 ? '<p class="text-muted">Tout le stock est disponible</p>' :
                  Object.entries(litresParArome).map(([aromeNom, litres]) => {
                      const arome = aromes.find(a => a.nom === aromeNom);
                      return `<div class="flex-between" style="padding: 8px 0; border-bottom: 1px solid var(--border-light);">
                          <span><span class="color-dot" style="background: ${arome?.couleur || '#ccc'}"></span>${escapeHtml(aromeNom)}</span>
                          <strong>${litres.toFixed(1)} L</strong>
                      </div>`;
                  }).join('')}
            </div>

            <div class="production-item">
                <h4>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M8 2h8M9 2v3.5L5.5 12A4.5 4.5 0 0 0 9.5 22h5a4.5 4.5 0 0 0 4-6.5L15 5.5V2"/></svg>
                    Bouteilles & bouchons
                </h4>
                ${formatsTries.length === 0 ? '<p class="text-muted">Tout le stock est disponible</p>' : `
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
                ${Object.entries(recipientsParArome).length === 0 ? '<p class="text-muted">Tout le stock est disponible</p>' :
                  Object.entries(recipientsParArome).map(([aromeNom, recipients]) => {
                      const arome = aromes.find(a => a.nom === aromeNom);
                      const totalLitres = recipients.reduce((sum, r) => sum + r.litres, 0);
                      const totalCapacite = recipients.reduce((sum, r) => sum + r.capacite, 0);
                      const remplissageMoyen = totalCapacite > 0 ? (totalLitres / totalCapacite) * 100 : 0;
                      return `
                        <div class="cuve-arome">
                          <div class="cuve-header">
                            <span class="color-dot" style="background: ${arome?.couleur || '#ccc'}"></span>
                            <strong>${escapeHtml(aromeNom)}</strong>
                            <span> - ${totalLitres.toFixed(1)}L (${recipients.length} récipient${recipients.length > 1 ? 's' : ''}, remplissage moyen ${remplissageMoyen.toFixed(0)}%)</span>
                            <button class="btn btn-sm btn-success" onclick="confirmerProductionArome('${encodeURIComponent(aromeNom)}')">Produire tout l'arôme</button>
                          </div>
                          ${recipients.map((recipient, recipientIndex) => {
                              const fillPercent = recipient.capacite > 0 ? Math.round((recipient.litres / recipient.capacite) * 100) : 0;
                              return `
                            <div class="cuve-detail" data-arome="${escapeHtml(aromeNom)}" data-recipient-index="${recipientIndex}">
                              <div class="flex-between" style="margin-bottom: 8px;">
                                <div class="cuve-title" style="margin-bottom: 0;">${escapeHtml(recipient.nom)} (${recipient.litres.toFixed(1)}L / ${recipient.capacite}L - ${fillPercent}%)</div>
                                <button class="btn btn-sm btn-success" onclick="confirmerProduction('${encodeURIComponent(aromeNom)}', ${recipientIndex})">Produite</button>
                              </div>
                              <div class="cuve-slider-row">
                                <input type="range" class="cuve-slider" min="0.5" max="${recipient.capacite}" step="0.5" value="${recipient.litres}" data-arome="${escapeHtml(aromeNom)}" data-recipient-index="${recipientIndex}">
                                <span class="cuve-litres-display">${recipient.litres.toFixed(1)}L</span>
                              </div>
                              <ul class="ingredient-list">
                                ${recipient.ingredients.map(ing => `
                                  <li>
                                    <span>${escapeHtml(ing.nom)}</span>
                                    <strong>${ing.quantite} ${displayUnit(ing.unite)}</strong>
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
            <strong>Résumé:</strong> ${commandesPeriode.length} commande(s) à produire - Stock déduit automatiquement
        </div>
    `;

    let html = `
        ${kpiHtml}
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Planificateur de production</h3>
            </div>
            ${resultHtml}
        </div>
    `;

    safeRender(html);
    attacherSliderEvents();
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

const confirmerProduction = (encodedAromeNom, recipientIndex) => {
    try {
        const aromeNom = decodeURIComponent(encodedAromeNom || '');
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
                    <input type="number" min="0" step="1" name="format_${format.id}" value="${prefill}">
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
            <button class="btn btn-success" onclick="validerProduction(event, '${encodeURIComponent(aromeNom)}', ${recipientIndex})">Confirmer la production</button>
        `);
    } catch (e) {
        console.error('Error opening production modal:', e);
        showToast('Erreur ouverture confirmation production', 'error');
    }
};

const confirmerProductionArome = (encodedAromeNom) => {
    try {
        const aromeNom = decodeURIComponent(encodedAromeNom || '');
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
                    <input type="number" min="0" step="1" name="format_${format.id}" value="${prefill}">
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
            <button class="btn btn-success" onclick="validerProductionArome(event, '${encodeURIComponent(aromeNom)}')">Confirmer tout l'arôme</button>
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
                warnings.push(`Unité incompatible pour ${ing.nom} (recette: ${ingUnit}, inventaire: ${invUnit})`);
                return;
            }
            const converted = ingUnit !== invUnit ? convertQuantity(besoinMajore, ingUnit, invUnit) : besoinMajore;
            if (converted === null) {
                warnings.push(`Conversion impossible pour ${ing.nom}`);
                return;
            }
            if ((item.quantite || 0) < converted) warnings.push(`Stock insuffisant: ${item.nom}`);
            item.quantite = Math.round(((item.quantite || 0) - converted) * 10000) / 10000;
        });
    } else {
        warnings.push(`Recette introuvable pour ${aromeNom}`);
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
        let maxNum = 0;
        let hasNumeric = false;
        lots.forEach(l => {
            const num = parseInt(l.numLot || l.id, 10);
            if (!isNaN(num)) { hasNumeric = true; if (num > maxNum) maxNum = num; }
        });
        numLot = hasNumeric ? String(maxNum + 1).padStart(6, '0') : generateId();
    }

    producedByFormat.forEach(({ format, quantite }) => {
        const existingLot = lots.find(l => l.arome === aromeNom && l.format === format.nom && l.dateProduction === dateProduction);
        let lotId;
        if (existingLot) {
            existingLot.quantite = (existingLot.quantite || 0) + quantite;
            if (!existingLot.numLot) existingLot.numLot = numLot;
            lotId = existingLot.id;
        } else {
            let maxId = 0;
            let hasNumericId = false;
            lots.forEach(l => {
                const num = parseInt(l.id, 10);
                if (!isNaN(num)) { hasNumericId = true; if (num > maxId) maxId = num; }
            });
            lotId = hasNumericId ? String(maxId + 1).padStart(6, '0') : generateId();
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

const validerProductionArome = async (event, encodedAromeNom) => {
    const reenable = disableSaveBtn(event);
    try {
        const aromeNom = decodeURIComponent(encodedAromeNom || '');
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
            const input = form.querySelector(`input[name="format_${format.id}"]`);
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

const validerProduction = async (event, encodedAromeNom, recipientIndex) => {
    const reenable = disableSaveBtn(event);
    try {
        const aromeNom = decodeURIComponent(encodedAromeNom || '');
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
            const input = form.querySelector(`input[name="format_${format.id}"]`);
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
                    <p style="margin-top: 4px; color: var(--text-light);">${alertItems.slice(0, 4).map(item => `${escapeHtml(item.nom)} (${item.quantite} ${displayUnit(item.unite)})`).join(', ')}${alertItems.length > 4 ? ` +${alertItems.length - 4}` : ''}</p>
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
                                    <button class="btn btn-sm btn-secondary" onclick="updateInventaireQty('${item.id}', -1)">−</button>
                                    <input class="inventaire-qty-input" type="number" step="0.01" value="${item.quantite}" onchange="setInventaireQty('${item.id}', this.value)">
                                    <span class="inventaire-unit">${escapeHtml(item.unite)}</span>
                                    <button class="btn btn-sm btn-secondary" onclick="updateInventaireQty('${item.id}', 1)">+</button>
                                </div>
                                <div class="inventaire-item-actions">
                                    <button class="btn btn-sm btn-secondary" onclick="showInventaireModal('consommable', '${item.id}')">✏️</button>
                                    <button class="btn btn-sm btn-danger" onclick="deleteInventaireItem('${item.id}')">×</button>
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
                                    <button class="btn btn-sm btn-secondary" onclick="updateInventaireQty('${item.id}', -1)">−</button>
                                    <input class="inventaire-qty-input" type="number" step="0.01" value="${item.quantite}" onchange="setInventaireQty('${item.id}', this.value)">
                                    <span class="inventaire-unit">${escapeHtml(item.unite)}</span>
                                    <button class="btn btn-sm btn-secondary" onclick="updateInventaireQty('${item.id}', 1)">+</button>
                                </div>
                                <div class="inventaire-item-actions">
                                    <button class="btn btn-sm btn-secondary" onclick="showInventaireModal('equipement', '${item.id}')">✏️</button>
                                    <button class="btn btn-sm btn-danger" onclick="deleteInventaireItem('${item.id}')">×</button>
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
                    <input type="number" name="quantite" value="${item?.quantite || 0}" min="0" required>
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
        <button class="btn btn-primary" onclick="saveInventaireItem(event, '${id || ''}')">Enregistrer</button>
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
                    <button class="btn btn-sm btn-primary" onclick="showEmployeModal()">+ Ajouter</button>
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
                                <button class="btn btn-sm btn-secondary" onclick="showEmployeModal('${e.id}')">Modifier</button>
                                <button class="btn btn-sm btn-danger" onclick="deleteEmploye('${e.id}')">Supprimer</button>
                            </div>
                        </li>
                      `).join('')}
                </ul>
            </div>

            <div class="settings-card">
                <div class="settings-card-header">
                    <h3>Arômes</h3>
                    <button class="btn btn-sm btn-primary" onclick="showAromeModal()">+ Ajouter</button>
                </div>
                <ul class="settings-list">
                    ${aromes.length === 0 ? '<li class="settings-item text-muted">Aucun arôme</li>' :
                      aromes.map(a => `
                        <li class="settings-item">
                            <div class="settings-item-info">
                                <span class="color-dot" style="background: ${escapeHtml(a.couleur || '#ccc')}"></span>
                                <span>${escapeHtml(a.nom)}</span>
                                <span class="badge ${a.actif ? 'badge-success' : 'badge-default'}">${a.actif ? 'Actif' : 'Inactif'}</span>
                            </div>
                            <div class="settings-item-actions">
                                <button class="btn btn-sm btn-secondary" onclick="showAromeModal('${a.id}')">Modifier</button>
                                <button class="btn btn-sm btn-danger" onclick="deleteArome('${a.id}')">Supprimer</button>
                            </div>
                        </li>
                      `).join('')}
                </ul>
            </div>

            <div class="settings-card">
                <div class="settings-card-header">
                    <h3>Formats</h3>
                    <button class="btn btn-sm btn-primary" onclick="showFormatModal()">+ Ajouter</button>
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
                                <button class="btn btn-sm btn-secondary" onclick="showFormatModal('${f.id}')">Modifier</button>
                                <button class="btn btn-sm btn-danger" onclick="deleteFormat('${f.id}')">Supprimer</button>
                            </div>
                        </li>
                      `).join('')}
                </ul>
            </div>

            <div class="settings-card">
                <div class="settings-card-header">
                    <h3>Recettes</h3>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-sm btn-secondary" onclick="syncRecettesInventaire()">Synchroniser inventaire</button>
                        <button class="btn btn-sm btn-primary" onclick="showRecetteModal()">+ Ajouter</button>
                    </div>
                </div>
                <ul class="settings-list">
                    ${recettes.length === 0 ? '<li class="settings-item text-muted">Aucune recette</li>' :
                      recettes.map(r => {
                          const arome = aromes.find(a => a.id === r.aromeId);
                          return `
                            <li class="settings-item">
                                <div class="settings-item-info">
                                    <span class="color-dot" style="background: ${arome?.couleur || '#ccc'}"></span>
                                    <span>${escapeHtml(r.nom)}</span>
                                    <span class="text-muted">(${r.ingredients.length} ingrédient${r.ingredients.length > 1 ? 's' : ''})</span>
                                </div>
                                <div class="settings-item-actions">
                                    <button class="btn btn-sm btn-secondary" onclick="showRecetteModal('${r.id}')">Modifier</button>
                                    <button class="btn btn-sm btn-danger" onclick="deleteRecette('${r.id}')">Supprimer</button>
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
                        <button class="btn btn-sm btn-secondary" onclick="exportClientsExcel()">Exporter Excel</button>
                        <button class="btn btn-sm btn-secondary" onclick="document.getElementById('importClientsFile').click()">Importer Excel</button>
                        <input type="file" id="importClientsFile" accept=".xlsx,.xls" style="display:none" onchange="importClientsExcel(event)">
                        <button class="btn btn-sm btn-primary" onclick="showClientModal()">+ Ajouter</button>
                        <button class="btn btn-sm btn-danger" onclick="resetClients()">Effacer tout</button>
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
                                <button class="btn btn-sm btn-secondary" onclick="showClientModal('${c.id}')">Modifier</button>
                                <button class="btn btn-sm btn-danger" onclick="deleteClient('${c.id}')">Supprimer</button>
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

            ${window.StressTest ? `
            <div class="settings-card" style="grid-column: 1 / -1; border: 2px solid var(--warning);">
                <div class="settings-card-header">
                    <h3>🔧 Outils de développement</h3>
                </div>
                <div style="padding: 12px; display: flex; gap: 12px; flex-wrap: wrap; align-items: center;">
                    <button class="btn btn-warning" onclick="window.StressTest.attachUI(); window.StressTest.run()">Lancer le stress test</button>
                    <span style="font-size: 12px; color: var(--text-light);">Teste la performance, les workflows et la résilience de l'application. Sauvegarde automatique des données.</span>
                </div>
            </div>
            ` : ''}

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
        <button class="btn btn-primary" onclick="saveEmploye(event, '${id || ''}')">Enregistrer</button>
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
        <button class="btn btn-primary" onclick="saveArome(event, '${id || ''}')">Enregistrer</button>
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
        if (id) {
            const index = aromes.findIndex(a => a.id === id);
            aromes[index] = arome;
        } else {
            aromes.push(arome);
        }
        DB.set('aromes', aromes);

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
        <button class="btn btn-primary" onclick="saveFormat(event, '${id || ''}')">Enregistrer</button>
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
        if (id) {
            const index = formats.findIndex(f => f.id === id);
            formats[index] = format;
        } else {
            formats.push(format);
        }
        DB.set('formats', formats);

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
            <input type="number" name="ingredients[${idx}][quantite]" value="${ing.quantite}" placeholder="Qté" step="0.01" min="0.01" required>
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
                      }).map(a => `<option value="${a.id}" ${recette?.aromeId === a.id ? 'selected' : ''}>${escapeHtml(a.nom)}</option>`).join('')}
                </select>
                ${id ? '<input type="hidden" name="aromeId" value="' + recette.aromeId + '">' : ''}
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
        <button class="btn btn-primary" onclick="saveRecette(event, '${id || ''}')">Enregistrer</button>
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
        <button class="btn btn-primary" onclick="saveClient(event, '${id || ''}')">Enregistrer</button>
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
const importAllData = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            let count = 0;
            ALL_TABLES.forEach(table => {
                if (data[table] && Array.isArray(data[table])) {
                    DB.set(table, data[table]);
                    count++;
                }
            });
            showToast(`${count} tables restaurées`);
            router();
        } catch(err) {
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

// Initialize app
//
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
    // Bottom sheet listeners
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
    router();
};

const bootFirebaseSync = async () => {
    // Hors-ligne, le module Firebase du CDN ne se charge pas et firebaseReady reste
    // false : ne jamais bloquer indéfiniment.
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
    if (firebaseAvailable) {
        // Push dirty tables before pull
        const dirty = getDirtyTables();
        const failedTables = [];
        if (dirty.length > 0) {
            for (const key of dirty) {
                const data = DB.get(key);
                const success = await DB.syncToFirebase(key, data);
                if (!success) failedTables.push(key);
            }
        }
        if (failedTables.length > 0) {
            showToast(`${failedTables.length} table(s) locale(s) non synchronisée(s) — pull partiel`, 'warning');
        }
        await DB.loadFromFirebase(false, failedTables);
        // Re-migration après import cloud, puis re-rendu de la vue courante.
        try { migrateClientTarifs(); } catch (e) { console.warn('[migration] post-sync', e); }
        renderCurrentView();
    } else {
        console.warn('Firebase indisponible — démarrage sur les données locales');
    }
};

// app.js s'exécute pendant le parsing du HTML : le shell (#content, nav, header) est
// déjà présent (défini plus haut dans index.html), on rend donc tout de suite — avant
// même que le module Firebase (chargé en différé) ne bloque DOMContentLoaded.
bootLocal();

// La synchronisation Firebase attend que le module se soit exécuté : DOMContentLoaded
// se déclenche après les scripts différés (dont le module Firebase).
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootFirebaseSync, { once: true });
} else {
    bootFirebaseSync();
}
