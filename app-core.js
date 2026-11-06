// ThéCol Gestion - Application JavaScript

// Application-wide constants
const CONSTANTS = {
    PRODUCTION_LOSS: 1.015,    // +1.5% loss buffer applied to ingredient consumption
    BOUCHON_MARGIN: 1.05,      // +5% margin on caps (planner and production deduction)
    CUVE_MAX_L: 25,            // max litres per production cuve
    ATELIER_CUVES: 4,          // cuves de 25 L de l'atelier (jumeau 3D)
    ATELIER_CASSEROLES_L: [9, 4], // casseroles des plaques à induction 1 et 2 (jumeau 3D)
    STOCK_WARN_DAYS: 30,       // DLC warning threshold in days (lots legacy sans DLV)
    DLV_WARN_DAYS: 7,          // DLV warning threshold in days (« DLV proche »)
    POINTAGE_OUVERT_MAX_H: 16  // pointage sans départ au-delà de ce délai : départ oublié, « à clôturer »
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

const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    try {
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
    } finally {
        URL.revokeObjectURL(url);
    }
};

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

// Mention des bouteilles livrées en plus de la commande (v13.0)
const libelleEnPlus = (item) => (item?.enPlus ? (item.offert ? ' (en plus, offert)' : ' (en plus)') : '');

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
// `minJours` (v13.0) : durée de vie minimale exigée par le client — la limite de
// vente du lot doit tomber au moins ce nombre de jours après la livraison.
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
    const eligible = (key, dateLivraison, minJours = 0) => {
        const d = dateOnly(dateLivraison);
        const ref = Number.isNaN(d.getTime()) || d < today ? today : d;
        const limiteMin = ref.getTime() + Math.max(0, minJours) * 86400000;
        return entries.filter(e => e.key === key && e.reste > 0 && isLotSellable(e.lot, ref)
            && (!minJours || saleLimit(e.lot) >= limiteMin));
    };
    // Consomme jusqu'à `qty` bouteilles ; renvoie les lots pris [{ lot, quantite }]
    const takeLots = (key, qty, dateLivraison, minJours = 0) => {
        const pris = [];
        let reste = qty;
        for (const e of eligible(key, dateLivraison, minJours)) {
            if (reste <= 0) break;
            const used = Math.min(e.reste, reste);
            e.reste -= used;
            reste -= used;
            pris.push({ lot: e.lot, quantite: used });
        }
        return pris;
    };
    return {
        available: (key, dateLivraison, minJours = 0) => eligible(key, dateLivraison, minJours).reduce((sum, e) => sum + e.reste, 0),
        // Consomme jusqu'à `qty` bouteilles ; renvoie la quantité effectivement couverte.
        take: (key, qty, dateLivraison, minJours = 0) => takeLots(key, qty, dateLivraison, minJours).reduce((s, p) => s + p.quantite, 0),
        takeLots
    };
};

// Durée de vie minimale exigée par un client à la livraison, en jours avant la
// limite de vente du lot (fiche client, v13.0) ; 0 = aucune exigence
const clientDureeVieMin = (client) => Math.max(0, parseInt(client?.dureeVieMinJours, 10) || 0);

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

// Default values from Stock project
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

// Durée de vie d'un lot pour l'affichage : phrase « Vendable encore N j » et frise
// Prod. → DLV → DLC (en % de la durée totale). La limite de vente est la DLV, ou la
// DLC pour les lots legacy sans DLV. `bar` vaut null si les dates ne permettent pas
// de tracer la frise (production absente, dates incohérentes).
const getLotShelfLife = (lot, referenceDate = new Date()) => {
    const DAY = 86400000;
    const status = getLotStatus(lot, referenceDate);
    const now = dateOnly(referenceDate).getTime();
    // dateOnly(null) donnerait le 01.01.1970 : une DLC absente reste absente
    const dlc = lot?.dlc ? dateOnly(lot.dlc).getTime() : NaN;
    const saleLimit = lot?.dlv ? dateOnly(lot.dlv).getTime() : dlc;
    const daysTo = (t) => Math.round((t - now) / DAY);

    let text = '';
    if (status === 'expired') text = Number.isNaN(dlc) ? 'DLC absente' : `DLC dépassée de ${-daysTo(dlc)} j`;
    else if (status === 'invendable') text = Number.isNaN(saleLimit) ? 'DLV invalide' : `DLV dépassée de ${-daysTo(saleLimit)} j`;
    else {
        const d = daysTo(saleLimit);
        text = d === 0 ? 'Dernier jour de vente' : `Vendable encore ${d} j`;
    }

    const prod = lot?.dateProduction ? dateOnly(lot.dateProduction).getTime() : NaN;
    let bar = null;
    if (![prod, dlc, saleLimit].some(Number.isNaN) && prod < dlc && prod <= saleLimit && saleLimit <= dlc) {
        const pct = (t) => Math.round(Math.min(100, Math.max(0, (t - prod) / (dlc - prod) * 100)) * 10) / 10;
        const warnDays = lot.dlv ? CONSTANTS.DLV_WARN_DAYS : CONSTANTS.STOCK_WARN_DAYS;
        const warnStart = pct(Math.max(prod, saleLimit - warnDays * DAY));
        const saleEnd = pct(saleLimit);
        // Largeurs des segments (vente, DLV proche, après la limite de vente) et repère du jour
        bar = {
            sale: warnStart,
            warn: Math.round((saleEnd - warnStart) * 10) / 10,
            after: Math.round((100 - saleEnd) * 10) / 10,
            today: pct(now),
            pastSale: now > saleLimit
        };
    }
    return { status, text, bar };
};

const lotShelfLifeHtml = (lot, referenceDate = new Date()) => {
    const { status, text, bar } = getLotShelfLife(lot, referenceDate);
    const dates = [
        lot?.dateProduction ? `production ${formatDate(lot.dateProduction)}` : '',
        lot?.dlv ? `DLV ${formatDate(lot.dlv)}` : '',
        lot?.dlc ? `DLC ${formatDate(lot.dlc)}` : ''
    ].filter(Boolean).join(', ');
    return `<div class="shelf-life shelf-life--${escapeHtml(status)}">
        <div class="shelf-life-text">${escapeHtml(text)}</div>
        ${bar ? `<div class="shelf-life-bar" role="img" aria-label="${escapeHtml(`${text} — ${dates}`)}">
            <span class="shelf-life-seg shelf-life-seg--sale" style="width:${safeNumAttr(bar.sale)}%"></span>
            <span class="shelf-life-seg shelf-life-seg--warn" style="width:${safeNumAttr(bar.warn)}%"></span>
            <span class="shelf-life-seg shelf-life-seg--after${bar.pastSale ? ' is-past' : ''}" style="width:${safeNumAttr(bar.after)}%"></span>
            <span class="shelf-life-today" style="left:${safeNumAttr(bar.today)}%" title="Aujourd'hui"></span>
        </div>` : ''}
    </div>`;
};

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
