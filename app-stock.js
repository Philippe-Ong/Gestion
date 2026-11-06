// Sous-onglets de la section Stock (Lots / Historique)
const stockSubTabs = (active) => `
    <div class="sub-tabs" role="tablist" aria-label="Vues du stock">
        <a href="#stock" class="sub-tab ${active === 'lots' ? 'active' : ''}" role="tab" aria-selected="${active === 'lots'}">Lots</a>
        <a href="#historique" class="sub-tab ${active === 'historique' ? 'active' : ''}" role="tab" aria-selected="${active === 'historique'}">Historique</a>
    </div>`;

// Recherche « en direct » (Stock, Historique) : la saisie est gardée telle quelle
// (espaces, majuscules) et la vue n'est re-rendue qu'après une courte pause, jamais
// pendant une composition (clavier prédictif) ; le curseur est ensuite replacé.
// Champ : <input data-live-search="<filtre>">, filtre déclaré ci-dessous.
const LIVE_SEARCH_RENDERS = {
    stockQuery: () => renderStockLots(),
    histQuery: () => renderHistorique(),
    livraison_search: () => renderLivraisons(),
    inventaire_search: () => renderInventaire()
};
let liveSearchTimer = null;
const onLiveSearchInput = (el) => {
    const filterName = el.getAttribute('data-live-search');
    const render = LIVE_SEARCH_RENDERS[filterName];
    if (!render) return;
    DB.setFilter(filterName, el.value);
    clearTimeout(liveSearchTimer);
    if (el.__composing) return;
    liveSearchTimer = setTimeout(() => {
        const { id } = el;
        const hadFocus = document.activeElement === el;
        const pos = el.selectionStart;
        render();
        const input = id ? document.getElementById(id) : null;
        if (hadFocus && input && document.activeElement !== input) {
            input.focus();
            try { input.setSelectionRange(pos, pos); } catch (_) { /* champ sans sélection */ }
        }
    }, 250);
};
// Écouteurs délégués (il n'existe pas d'attribut oncompositionstart en HTML)
const initLiveSearch = () => {
    if (window.__liveSearchReady) return;
    window.__liveSearchReady = true;
    const champ = (e) => e.target.closest?.('[data-live-search]');
    document.addEventListener('input', (e) => { const el = champ(e); if (el) onLiveSearchInput(el); });
    document.addEventListener('compositionstart', (e) => { const el = champ(e); if (el) el.__composing = true; });
    document.addEventListener('compositionend', (e) => {
        const el = champ(e);
        if (!el) return;
        el.__composing = false;
        onLiveSearchInput(el);
    });
};

// --- Stock : vue d'ensemble par arôme × format ---
// Les lots référencent l'arôme et le format par NOM : on compare les noms
// normalisés (casse, accents), comme la livraison, pour qu'un lot « hibiscus »
// compte bien dans « Hibiscus ».
const stockCellKey = (arome, format) => `${normalizeName(arome) || '?'}|${normalizeName(format) || '?'}`;

const stockSaleLimit = (lot) => {
    const t = dateOnly(lot?.dlv || lot?.dlc).getTime();
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
};
// Premier périmé, premier sorti : DLV croissante (repli DLC), puis production
const stockFefo = (a, b) => (stockSaleLimit(a) - stockSaleLimit(b))
    || String(a.dateProduction || '').localeCompare(String(b.dateProduction || ''));

// Bouteilles vendables, réservées et à produire par arôme × format. Les commandes
// ouvertes réservent le stock par date de livraison, les « produite » d'abord
// (leurs bouteilles sont déjà dans les lots), comme « ✓ Stock » ; la part non
// couverte est « à produire ». La réservation est une prévision : à la livraison,
// on choisit toujours les lots. Les lots invendables (DLV/DLC dépassée, blocage,
// quantité invalide) sont rangés à part, « hors vente ».
const buildStockOverview = (referenceDate = new Date()) => {
    const lots = DB.get('lots') || [];
    const aromes = DB.get('aromes') || [];
    const formats = DB.get('formats') || [];
    const today = dateOnly(referenceDate);

    const findArome = (nom) => aromes.find(a => normalizeName(a.nom) === normalizeName(nom));
    const findFormat = (nom) => formats.find(f => normalizeName(f.nom) === normalizeName(nom));
    const couleurDe = (nom) => safeColor(findArome(nom)?.couleur || DEFAULT_COULEURS[String(nom || '').toLowerCase()]);

    // Lignes (arômes) et colonnes (formats) : les actifs toujours, les autres
    // seulement s'ils portent du stock vendable ou une commande. Un nom absent
    // des Paramètres reste affiché (« inconnu ») pour ne perdre aucune bouteille.
    const rows = new Map();
    const cols = new Map();
    const addRow = (nom) => {
        const key = normalizeName(nom) || '?';
        if (rows.has(key)) return;
        const arome = findArome(nom);
        rows.set(key, {
            key,
            nom: arome?.nom || nom || '(sans arôme)',
            couleur: couleurDe(nom),
            inconnu: !arome,
            inactif: !!arome && arome.actif === false
        });
    };
    const addCol = (nom) => {
        const key = normalizeName(nom) || '?';
        if (cols.has(key)) return;
        const format = findFormat(nom);
        cols.set(key, {
            key,
            nom: format?.nom || nom || '(sans format)',
            contenanceCl: resolveFormatContenance(format?.nom || nom, formats) || Number.POSITIVE_INFINITY,
            inconnu: !format,
            inactif: !!format && format.actif === false
        });
    };
    aromes.filter(a => a.actif !== false).forEach(a => addRow(a.nom));
    formats.filter(f => f.actif !== false).forEach(f => addCol(f.nom));

    const cells = new Map();
    const cellOf = (arome, format) => {
        const key = stockCellKey(arome, format);
        if (!cells.has(key)) {
            cells.set(key, { key, vendable: 0, reserve: 0, aProduire: 0, dlvProche: 0, lots: [], horsVente: [], commandes: new Map() });
        }
        return cells.get(key);
    };

    const horsVente = [];
    const ecouler = [];
    const inconnus = [];
    lots.forEach(lot => {
        const quantite = Number(lot.quantite);
        const cell = cellOf(lot.arome, lot.format);
        if (!findArome(lot.arome) || !findFormat(lot.format)) inconnus.push(lot);
        if (!Number.isFinite(quantite) || quantite <= 0 || !isLotSellable(lot, today)) {
            cell.horsVente.push(lot);
            horsVente.push(lot);
            return;
        }
        addRow(lot.arome);
        addCol(lot.format);
        cell.vendable += quantite;
        cell.lots.push(lot);
        if (getLotStatus(lot, today) === 'warning') {
            cell.dlvProche += quantite;
            ecouler.push(lot);
        }
    });

    // Réservations : la règle d'attribution commune (planAttributionCommandes)
    const { plan, parLot } = planAttributionCommandes(today);
    plan.forEach(({ commande: cmd, client, lignes }) => {
        lignes.forEach(l => {
            addRow(l.arome.nom);
            addCol(l.format.nom);
            const cell = cellOf(l.arome.nom, l.format.nom);
            const pris = l.demande - l.manque;
            cell.reserve += pris;
            cell.aProduire += l.manque;
            if (!cell.commandes.has(cmd.id)) {
                cell.commandes.set(cmd.id, {
                    commande: cmd,
                    numero: getCommandeNumero(cmd),
                    client: client ? getClientLabel(client) : 'Client inconnu',
                    reserve: 0,
                    aProduire: 0
                });
            }
            const resa = cell.commandes.get(cmd.id);
            resa.reserve += pris;
            resa.aProduire += l.manque;
        });
    });

    cells.forEach(c => c.lots.sort(stockFefo));
    ecouler.sort(stockFefo);

    const totals = { libre: 0, reserve: 0, aProduire: 0, commandesEnManque: 0 };
    const enManque = new Set();
    cells.forEach(c => {
        totals.libre += c.vendable - c.reserve;
        totals.reserve += c.reserve;
        totals.aProduire += c.aProduire;
        c.commandes.forEach((r, id) => { if (r.aProduire > 0) enManque.add(id); });
    });
    totals.commandesEnManque = enManque.size;

    return {
        rows: [...rows.values()],
        cols: [...cols.values()].sort((a, b) => a.contenanceCl - b.contenanceCl || String(a.nom).localeCompare(String(b.nom), 'fr')),
        cells, horsVente, ecouler, inconnus, totals, couleurDe, parLot
    };
};

// Attribution prévisionnelle des lots aux commandes ouvertes (v13.0), règle unique
// de l'app (page Stock, livraison, « ✓ Stock », contrôle avant « produite ») :
// commandes « produite » d'abord, puis « en attente », par date de livraison ;
// chaque ligne prend les lots vendables à sa date de livraison et assez longs pour
// le client, la DLV la plus proche d'abord. Rien n'est réservé en base : la
// livraison propose ces lots, modifiables. `forceProduite` traite une commande en
// attente comme produite (contrôle avant « Marquer produite ») ; `lots` remplace
// les lots de la base (production simulée, v13.2).
// Renvoie plan : Map(commandeId → { commande, client, minJours, lignes:
// [{ key, item, arome, format, demande, lots: [{ lot, quantite }], manque }] })
// et parLot : Map(lotId → [{ commande, quantite }]).
const planAttributionCommandes = (referenceDate = new Date(), { forceProduite = null, lots: lotsSimules = null } = {}) => {
    const lots = lotsSimules || DB.get('lots') || [];
    const commandes = DB.get('commandes') || [];
    const aromes = DB.get('aromes') || [];
    const formats = DB.get('formats') || [];
    const clients = DB.get('clients') || [];
    const pool = createStockPool(lots, referenceDate, lot => stockCellKey(lot.arome, lot.format));
    const prioritaire = (c) => c.statut === 'produite' || c.id === forceProduite;
    const ouvertes = sortCommandesByDateLivraison(commandes.filter(c => c.statut === 'produite' || c.statut === 'en_attente'))
        .map(({ commande }) => commande);
    const plan = new Map();
    const parLot = new Map();
    [...ouvertes.filter(prioritaire), ...ouvertes.filter(c => !prioritaire(c))].forEach(cmd => {
        const client = clients.find(c => c.id === cmd.clientId) || null;
        const minJours = clientDureeVieMin(client);
        const lignes = [];
        getItems(cmd).forEach(item => {
            if (item.enPlus) return;
            const arome = aromes.find(a => a.id === item.aromeId);
            const format = resolveCommandeFormat(item, formats)?.format;
            const qty = Number(item.quantite);
            if (!arome || !format || !Number.isFinite(qty) || qty <= 0) return;
            const key = stockCellKey(arome.nom, format.nom);
            const pris = pool.takeLots(key, qty, cmd.dateLivraison, minJours);
            pris.forEach(p => {
                if (!parLot.has(p.lot.id)) parLot.set(p.lot.id, []);
                parLot.get(p.lot.id).push({ commande: cmd, quantite: p.quantite });
            });
            lignes.push({ key, item, arome, format, demande: qty, lots: pris, manque: qty - pris.reduce((s, p) => s + p.quantite, 0) });
        });
        plan.set(cmd.id, { commande: cmd, client, minJours, lignes });
    });
    return { plan, parLot };
};

// Nom affiché d'une case du tableau (repli sur le nom stocké dans ses lots)
const stockCellInfo = (ov, key) => {
    const [rowKey, colKey] = String(key).split('|');
    const cell = ov.cells.get(key);
    const exemple = cell?.lots[0] || cell?.horsVente[0];
    const row = ov.rows.find(r => r.key === rowKey);
    const col = ov.cols.find(c => c.key === colKey);
    return {
        nom: row?.nom || exemple?.arome || '?',
        formatNom: col?.nom || exemple?.format || '?',
        couleur: row?.couleur || ov.couleurDe(exemple?.arome)
    };
};

// « liv. jeu. 30.10 », « en retard (lun. 20.10) », « sans date »
const stockLivraisonLabel = (dateLivraison) => {
    const days = twinDaysUntil(dateLivraison);
    if (days === null) return 'sans date';
    const jour = dashWeekdayDay(dateOnly(dateLivraison));
    if (days < 0) return `en retard (${jour})`;
    if (days === 0) return "liv. aujourd'hui";
    if (days === 1) return 'liv. demain';
    return `liv. ${jour}`;
};

const stockLotDates = (lot) => [
    ['Prod.', lot.dateProduction], ['DLV', lot.dlv], ['DLC', lot.dlc]
].filter(([, d]) => d && isValidDateOnly(d)).map(([label, d]) => `${label} ${formatDate(d)}`).join(' · ');

// `reservations` : [{ commande, quantite }] de la règle d'attribution (v13.0)
const stockLotRowHtml = (lot, { premier = false, now = new Date(), reservations = [] } = {}) => {
    const id = escapeHtml(lot.id);
    const num = escapeHtml(formatLotNumero(getLotNumero(lot)));
    const tag = getLotStatus(lot, now) === 'warning'
        ? `<span class="badge badge-bientot">À écouler d'abord</span>`
        : premier ? '<span class="stock-tag">À sortir en premier</span>' : '';
    const prevu = reservations.length
        ? `<div class="stock-lot-resa">Prévu pour ${reservations.map(r => `<button type="button" class="hist-entry-lot" data-click="show-commande-details" data-id="${escapeHtml(r.commande.id)}">#${escapeHtml(getCommandeNumero(r.commande))}</button> ${escapeHtml(twinFmtInt(r.quantite))} bt`).join(', ')}</div>`
        : '';
    return `
        <li class="stock-lot">
            <div class="stock-lot-id">
                <span class="stock-lot-num">#${num}</span>
                <span class="stock-lot-qty">${escapeHtml(twinFmtInt(lot.quantite))} bt</span>
            </div>
            <div class="stock-lot-life">
                ${lotShelfLifeHtml(lot, now)}
                <div class="stock-lot-dates">${escapeHtml(stockLotDates(lot))}${tag}</div>
                ${prevu}
            </div>
            <div class="stock-lot-actions">
                <button type="button" class="btn btn-sm btn-success" data-click="sell-lot" data-id="${id}" title="Vente directe, dégustation, casse ou destruction">Sortie</button>
                ${rowMenuHtml(`lot #${formatLotNumero(getLotNumero(lot))}`, `
                    <button type="button" data-click="show-lot-trace" data-id="${id}">Tracer</button>
                    <button type="button" data-click="edit-lot" data-id="${id}">Modifier</button>
                    <button type="button" class="is-danger" data-click="delete-lot" data-id="${id}">Supprimer</button>`)}
            </div>
        </li>`;
};

const stockHorsVenteRowHtml = (ov, lot, now) => {
    const id = escapeHtml(lot.id);
    const num = escapeHtml(formatLotNumero(getLotNumero(lot)));
    const quantite = Number(lot.quantite);
    const qtyInvalide = !Number.isFinite(quantite) || quantite <= 0;
    const raison = qtyInvalide
        ? 'Quantité invalide : corrigez-la avec « Modifier » ou supprimez le lot'
        : lot.bloque ? `Bloqué${lot.motifBlocage ? ` : ${lot.motifBlocage}` : ''}`
        : getLotShelfLife(lot, now).text;
    const action = qtyInvalide
        ? `<button type="button" class="btn btn-sm btn-secondary" data-click="edit-lot" data-id="${id}">Modifier</button>`
        : lot.bloque
            ? `<button type="button" class="btn btn-sm btn-secondary" data-click="show-lot-rappel" data-num="${escapeHtml(getLotNumero(lot))}">Rappel</button>`
            : `<button type="button" class="btn btn-sm btn-secondary" data-click="sell-lot" data-id="${id}" title="Destruction, casse ou dégustation">Sortir</button>`;
    const menu = rowMenuHtml(`lot #${formatLotNumero(getLotNumero(lot))}`, `
        ${lot.bloque && !qtyInvalide ? `<button type="button" data-click="sell-lot" data-id="${id}">Sortie</button>` : ''}
        <button type="button" data-click="show-lot-trace" data-id="${id}">Tracer</button>
        ${qtyInvalide ? '' : `<button type="button" data-click="edit-lot" data-id="${id}">Modifier</button>`}
        <button type="button" class="is-danger" data-click="delete-lot" data-id="${id}">Supprimer</button>`);
    return `
        <li class="stock-lot is-hors-vente">
            <div class="stock-lot-id">
                <span class="stock-lot-num">#${num}</span>
                <span class="stock-lot-qty">${escapeHtml(String(lot.quantite ?? '?'))} bt</span>
            </div>
            <div class="stock-lot-life">
                <div class="stock-lot-name"><span class="aroma-tile-dot" style="background:${ov.couleurDe(lot.arome)}"></span>${escapeHtml(lot.arome || '?')} <span class="stock-group-format">· ${escapeHtml(lot.format || '?')}</span></div>
                <div class="stock-lot-reason${lot.bloque && !qtyInvalide ? '' : ' is-danger'}">${escapeHtml(raison)}</div>
                <div class="stock-lot-dates">${escapeHtml(stockLotDates(lot))}</div>
            </div>
            <div class="stock-lot-actions">${action}${menu}</div>
        </li>`;
};

const stockGroupHtml = (ov, cell, lots, now) => {
    const { nom, formatNom, couleur } = stockCellInfo(ov, cell.key);
    const dateVal = (cmd) => { const t = dateOnly(cmd.dateLivraison).getTime(); return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t; };
    const resas = [...cell.commandes.values()].sort((a, b) => dateVal(a.commande) - dateVal(b.commande));
    const resasHtml = resas.map(r => `
        <button type="button" class="stock-resa" data-click="show-commande-details" data-id="${escapeHtml(r.commande.id)}">
            <span class="stock-resa-main">#${escapeHtml(r.numero)} · ${escapeHtml(r.client)} · ${escapeHtml(stockLivraisonLabel(r.commande.dateLivraison))}</span>
            ${r.reserve > 0 ? `<span class="stock-resa-qty">${escapeHtml(twinFmtInt(r.reserve))} réservées</span>` : ''}
            ${r.aProduire > 0 ? `<span class="stock-resa-qty is-danger">${escapeHtml(twinFmtInt(r.aProduire))} à produire</span>` : ''}
            <span class="badge ${r.commande.statut === 'produite' ? 'badge-produite' : 'badge-en-attente'}">${escapeHtml(getCommandeStatutLabel(r.commande.statut))}</span>
        </button>`).join('');
    const lotsHtml = lots.length === 0
        ? `<li class="stock-lot-empty">${cell.lots.length ? 'Aucun lot ne correspond aux filtres' : 'Aucun lot vendable'}</li>`
        : lots.map(lot => stockLotRowHtml(lot, { premier: cell.lots.length > 1 && cell.lots[0] === lot, now, reservations: ov.parLot?.get(lot.id) || [] })).join('');
    return `
        <div class="stock-group">
            <div class="stock-group-head">
                <span class="aroma-tile-dot" style="background:${couleur}"></span>
                <span class="stock-group-title">${escapeHtml(nom)} <span class="stock-group-format">· ${escapeHtml(formatNom)}</span></span>
                <span class="stock-group-meta">${escapeHtml(`${twinFmtInt(cell.vendable)} vendables · ${twinFmtInt(cell.vendable - cell.reserve)} libres`)}</span>
            </div>
            ${resasHtml ? `<div class="stock-resas">${resasHtml}</div>` : ''}
            <ul class="stock-lot-list">${lotsHtml}</ul>
        </div>`;
};

// Bandeau « À traiter » : n'apparaît que s'il y a quelque chose à faire
const stockAlertsHtml = (ov) => {
    const bt = (list) => list.reduce((s, l) => s + Math.max(0, Number(l.quantite) || 0), 0);
    const items = [];
    if (ov.ecouler.length) {
        items.push({
            level: 'warning', icon: 'horloge',
            title: `À écouler d'abord · ${dashPlural(ov.ecouler.length, 'lot')}, ${twinFmtInt(bt(ov.ecouler))} bt`,
            text: `DLV dans ${CONSTANTS.DLV_WARN_DAYS} jours ou moins : à vendre ou livrer en priorité`,
            attrs: { 'data-click': 'stock-focus', 'data-value': 'warning' }
        });
    }
    if (ov.totals.aProduire > 0) {
        const manques = [];
        ov.cells.forEach(cell => cell.commandes.forEach(r => {
            if (r.aProduire > 0) manques.push({ cell, r, days: twinDaysUntil(r.commande.dateLivraison) });
        }));
        manques.sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999));
        const vus = new Set();
        const details = [];
        manques.forEach(({ cell, r }) => {
            if (vus.has(cell.key)) return;
            vus.add(cell.key);
            const { nom, formatNom } = stockCellInfo(ov, cell.key);
            details.push(`${nom} ${formatNom} (${stockLivraisonLabel(r.commande.dateLivraison)})`);
        });
        const premier = manques[0]?.days;
        items.push({
            level: premier !== null && premier !== undefined && premier <= 3 ? 'danger' : 'info', icon: 'production',
            title: `À produire · ${twinFmtInt(ov.totals.aProduire)} bt pour ${dashPlural(ov.totals.commandesEnManque, 'commande')}`,
            text: details.slice(0, 3).join(', ') + (details.length > 3 ? ` et ${details.length - 3} autre(s)` : ''),
            attrs: { 'data-click': 'stock-goto-production' }
        });
    }
    if (ov.horsVente.length) {
        const invalides = ov.horsVente.filter(l => !(Number(l.quantite) > 0)).length;
        const bloques = ov.horsVente.filter(l => l.bloque && Number(l.quantite) > 0).length;
        const perimes = ov.horsVente.length - invalides - bloques;
        items.push({
            level: 'warning', icon: 'stock',
            title: `Hors vente · ${dashPlural(ov.horsVente.length, 'lot')}, ${twinFmtInt(bt(ov.horsVente))} bt`,
            text: [
                perimes ? `${perimes} à sortir (DLV ou DLC dépassée)` : '',
                bloques ? dashPlural(bloques, 'bloqué') : '',
                invalides ? `${invalides} à quantité invalide` : ''
            ].filter(Boolean).join(' · '),
            attrs: { 'data-click': 'stock-goto-hors-vente' }
        });
    }
    if (ov.inconnus.length) {
        items.push({
            level: 'warning', icon: 'attention',
            title: `Nom inconnu · ${dashPlural(ov.inconnus.length, 'lot')}`,
            text: 'Arôme ou format absent des Paramètres : corrigez-le avec « Modifier »',
            attrs: { 'data-click': 'stock-select-cell', 'data-key': stockCellKey(ov.inconnus[0].arome, ov.inconnus[0].format), 'data-force': '1' }
        });
    }
    return dashAlertesSectionHtml(items, 'stockAlertsTitle');
};

// Tableau arôme × format : bouteilles libres en grand, réservées, à produire, DLV proche
const stockMatrixHtml = (ov, selected) => {
    if (ov.rows.length === 0 || ov.cols.length === 0) return '';
    const { libre, reserve, aProduire } = ov.totals;
    const meta = [
        `${twinFmtInt(libre)} libres`,
        reserve ? `${twinFmtInt(reserve)} réservées` : '',
        aProduire ? `${twinFmtInt(aProduire)} à produire` : ''
    ].filter(Boolean).join(' · ');
    const tag = (x) => (x.inconnu ? '<span class="stock-tag">inconnu</span>' : x.inactif ? '<span class="stock-tag">inactif</span>' : '');
    const cellHtml = (row, col) => {
        const key = `${row.key}|${col.key}`;
        const c = ov.cells.get(key);
        const horsVente = c ? c.horsVente.length : 0;
        if (!c || (c.vendable === 0 && c.commandes.size === 0 && horsVente === 0)) {
            return `<td><span class="stock-cell is-empty"><span aria-hidden="true">—</span><span class="dash-sr">${escapeHtml(`${row.nom} ${col.nom} : aucun stock`)}</span></span></td>`;
        }
        const libreCell = c.vendable - c.reserve;
        const vide = c.vendable === 0 && c.commandes.size === 0;
        const subs = [
            c.aProduire > 0 ? ['is-danger', `${twinFmtInt(c.aProduire)} à produire`] : null,
            c.reserve > 0 ? ['', `${twinFmtInt(c.reserve)} rés.`] : null,
            c.dlvProche > 0 ? ['is-warning', 'DLV proche'] : null,
            vide ? ['', 'hors vente'] : null
        ].filter(Boolean);
        const label = [
            `${row.nom} ${col.nom}`,
            vide ? 'aucune bouteille vendable, lots hors vente' : `${twinFmtInt(libreCell)} libres`,
            c.reserve ? `${twinFmtInt(c.reserve)} réservées` : '',
            c.aProduire ? `${twinFmtInt(c.aProduire)} à produire` : '',
            c.dlvProche ? `${twinFmtInt(c.dlvProche)} en DLV proche` : ''
        ].filter(Boolean).join(', ');
        const isSel = selected === key;
        return `<td><button type="button" class="stock-cell${isSel ? ' is-selected' : ''}${libreCell <= 0 && c.aProduire > 0 ? ' is-short' : ''}" data-click="stock-select-cell" data-key="${escapeHtml(key)}" aria-pressed="${isSel}" aria-label="${escapeHtml(label)}">
            <span class="stock-cell-value">${vide ? '—' : escapeHtml(twinFmtInt(libreCell))}</span>
            ${subs.map(([cls, txt]) => `<span class="stock-cell-sub ${cls}">${escapeHtml(txt)}</span>`).join('')}
        </button></td>`;
    };
    return `
        <section class="stock-section" aria-labelledby="stockDispoTitle">
            <div class="stock-section-head">
                <h2 class="stock-section-title" id="stockDispoTitle">Disponible à la vente</h2>
                <span class="stock-section-meta">${escapeHtml(meta)}</span>
            </div>
            <div class="stock-matrix-wrap">
                <table class="stock-matrix" style="--stock-cols: ${ov.cols.length}">
                    <colgroup><col class="stock-matrix-label">${ov.cols.map(() => '<col>').join('')}</colgroup>
                    <thead><tr><td></td>${ov.cols.map(col => `<th scope="col">${escapeHtml(col.nom)}${tag(col)}</th>`).join('')}</tr></thead>
                    <tbody>${ov.rows.map(row => `
                        <tr>
                            <th scope="row"><span class="stock-row-name"><span class="aroma-tile-dot" style="background:${row.couleur}"></span><span class="stock-row-label">${escapeHtml(row.nom)}</span></span>${tag(row)}</th>
                            ${ov.cols.map(col => cellHtml(row, col)).join('')}
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        </section>`;
};

// Lots vendables groupés par arôme × format (ordre du tableau, FEFO dans chaque
// groupe), puis lots hors vente, puis lots épuisés retrouvés par la recherche.
const stockLotsHtml = (ov) => {
    const query = (DB.getFilter('stockQuery') || '').toString().trim();
    const selected = DB.getFilter('stockCell') || '';
    const focus = DB.getFilter('stockStatut') === 'warning' ? 'warning' : '';
    const now = new Date();
    const aromes = DB.get('aromes') || [];
    const lots = DB.get('lots') || [];
    const matchLot = (lot) => includesText(
        `${formatLotNumero(getLotNumero(lot))} ${lot.numLot || ''} ${lot.id || ''} ${lot.arome || ''} ${lot.format || ''} ${lot.quantite ?? ''}`,
        query
    );
    const inCell = (key) => !selected || key === selected;
    const filtre = !!(query || selected || focus);

    const ordre = [];
    ov.rows.forEach(r => ov.cols.forEach(c => ordre.push(`${r.key}|${c.key}`)));
    const dansTableau = new Set(ordre);
    ov.cells.forEach((_, key) => { if (!dansTableau.has(key)) ordre.push(key); });

    let nbLots = 0;
    let nbBt = 0;
    const groupsHtml = ordre.map(key => ov.cells.get(key)).filter(c => c && inCell(c.key)).map(cell => {
        const visibles = cell.lots.filter(lot => matchLot(lot) && (!focus || getLotStatus(lot, now) === 'warning'));
        const afficher = filtre
            ? visibles.length > 0 || (cell.key === selected && !query && !focus)
            : cell.lots.length > 0 || cell.commandes.size > 0;
        if (!afficher) return '';
        nbLots += visibles.length;
        nbBt += visibles.reduce((s, l) => s + (Number(l.quantite) || 0), 0);
        return stockGroupHtml(ov, cell, visibles, now);
    }).join('');

    const rang = (lot) => (!(Number(lot.quantite) > 0) ? 0 : lot.bloque ? 3 : getLotStatus(lot, now) === 'expired' ? 1 : 2);
    const horsVente = focus ? [] : ov.horsVente
        .filter(lot => inCell(stockCellKey(lot.arome, lot.format)) && matchLot(lot))
        .sort((a, b) => rang(a) - rang(b) || stockFefo(a, b));
    // Sortie groupée (péremption) : lots périmés affichés, hors lots bloqués (rappel) et quantités invalides
    const perimes = horsVente.filter(isLotPerimeSortable);

    const chips = [
        selected ? (() => {
            const { nom, formatNom } = stockCellInfo(ov, selected);
            return `<button type="button" class="stock-chip" data-click="stock-select-cell" data-key="${escapeHtml(selected)}" aria-label="${escapeHtml(`Retirer le filtre ${nom} ${formatNom}`)}">${escapeHtml(`${nom} · ${formatNom}`)}${dashIcon('croix')}</button>`;
        })() : '',
        focus ? `<button type="button" class="stock-chip" data-click="stock-focus" data-value="warning" aria-label="Retirer le filtre DLV proche">DLV proche${dashIcon('croix')}</button>` : ''
    ].join('');

    const vide = lots.length === 0
        ? 'Aucun lot en stock. Créez un lot avec « + Lot » ou terminez une production.'
        : filtre ? 'Aucun lot vendable ne correspond aux filtres.' : 'Aucun lot vendable en stock.';

    // Traçabilité : retrouver les lots épuisés (disparus du stock) via la recherche
    let epuisesHtml = '';
    if (query) {
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
            .filter(l => includesText(`${formatLotNumero(l.numLot || l.id)} ${l.numLot} ${l.id} ${l.arome} ${l.format}`, query))
            .slice(0, 12);
        if (matches.length > 0) {
            epuisesHtml = `
                <section class="stock-section" aria-labelledby="stockEpuisesTitle">
                    <div class="stock-section-head"><h2 class="stock-section-title" id="stockEpuisesTitle">Lots épuisés (traçabilité)</h2></div>
                    <div class="stock-group"><ul class="stock-lot-list">${matches.map(l => {
                        const arome = aromes.find(a => normalizeName(a.nom) === normalizeName(l.arome));
                        return `
                            <li class="stock-lot is-hors-vente">
                                <div class="stock-lot-id"><span class="stock-lot-num">#${escapeHtml(formatLotNumero(l.numLot || l.id))}</span><span class="stock-lot-qty">Épuisé</span></div>
                                <div class="stock-lot-life">
                                    <div class="stock-lot-name"><span class="aroma-tile-dot" style="background:${safeColor(arome?.couleur)}"></span>${escapeHtml(l.arome || '?')} <span class="stock-group-format">· ${escapeHtml(l.format || '?')}</span></div>
                                    <div class="stock-lot-dates">${escapeHtml(stockLotDates({ dateProduction: l.dateProduction, dlc: l.dlc }))}</div>
                                </div>
                                <div class="stock-lot-actions"><button type="button" class="btn btn-sm btn-secondary" data-click="show-lot-trace" data-id="${escapeHtml(l.id)}">Tracer</button></div>
                            </li>`;
                    }).join('')}</ul></div>
                </section>`;
        }
    }

    return `
        <section class="stock-section" aria-labelledby="stockLotsTitle">
            <div class="stock-section-head">
                <h2 class="stock-section-title" id="stockLotsTitle">Lots vendables</h2>
                <span class="stock-section-meta">${escapeHtml(`${dashPlural(nbLots, 'lot')} · ${twinFmtInt(nbBt)} bt`)}</span>
                ${chips ? `<div class="stock-chips">${chips}</div>` : ''}
            </div>
            ${groupsHtml || `<div class="commande-empty">${escapeHtml(vide)}</div>`}
        </section>
        ${horsVente.length ? `
        <section class="stock-section" aria-labelledby="stockHorsVenteTitle">
            <div class="stock-section-head">
                <h2 class="stock-section-title" id="stockHorsVenteTitle">Hors vente</h2>
                <span class="stock-section-meta">${escapeHtml(`${dashPlural(horsVente.length, 'lot')} · ${twinFmtInt(horsVente.reduce((s, l) => s + Math.max(0, Number(l.quantite) || 0), 0))} bt`)}</span>
                ${perimes.length ? `<button type="button" class="btn btn-sm btn-secondary stock-section-action" data-click="sortir-lots-perimes" data-ids="${escapeHtml(perimes.map(l => l.id).join(','))}">Tout sortir (péremption)</button>` : ''}
            </div>
            <div class="stock-group"><ul class="stock-lot-list">${horsVente.map(lot => stockHorsVenteRowHtml(ov, lot, now)).join('')}</ul></div>
        </section>` : ''}
        ${epuisesHtml}`;
};

// Stock Management
const renderStock = () => {
    const ov = buildStockOverview();
    const search = document.activeElement?.id === 'stockSearch' ? document.activeElement : null;
    const caret = search ? search.selectionStart : null;
    const query = (DB.getFilter('stockQuery') || '').toString();
    const selected = DB.getFilter('stockCell') || '';

    const html = `
        ${pageToolbar('<button type="button" class="btn btn-primary" onclick="showNouveauLotModal()">+ Lot</button>', stockSubTabs('lots'))}

        <div class="stock-search">
            <svg class="stock-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="search" id="stockSearch"
                   placeholder="Rechercher un lot, arôme, format…"
                   aria-label="Rechercher un lot"
                   value="${escapeHtml(query)}"
                   data-live-search="stockQuery">
        </div>

        ${stockAlertsHtml(ov)}
        ${stockMatrixHtml(ov, selected)}
        <div id="stockLots">${stockLotsHtml(ov)}</div>
    `;

    safeRender(html);
    // Re-rendu pendant la saisie (synchro d'un autre appareil) : garder le focus
    if (search) {
        const input = document.getElementById('stockSearch');
        input?.focus();
        try { input?.setSelectionRange(caret, caret); } catch (_) { /* champ sans sélection */ }
    }
};

// Recherche : seule la liste des lots est re-rendue (le champ garde le focus)
const renderStockLots = () => {
    const el = document.getElementById('stockLots');
    if (!el) { renderStock(); return; }
    el.innerHTML = stockLotsHtml(buildStockOverview());
};

const stockScrollBehavior = () => (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth');

// Fait défiler jusqu'à une section si son titre n'est pas visible
const stockRevealSection = (id, force = false) => {
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    if (force || top < 0 || top > window.innerHeight - 120) {
        el.scrollIntoView({ behavior: stockScrollBehavior(), block: 'start' });
    }
};

// Filtre sur une case du tableau (un second appui le retire) ; `force` l'impose
const selectStockCell = (key, force = false) => {
    const current = DB.getFilter('stockCell') || '';
    const next = !force && current === key ? '' : key;
    DB.setFilter('stockCell', next);
    renderStock();
    if (key && window.CSS?.escape) {
        document.querySelector(`.stock-cell[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
    }
    if (next) stockRevealSection('stockLotsTitle');
};

const toggleStockFocus = (value) => {
    const current = DB.getFilter('stockStatut') || '';
    const next = current === value ? '' : value;
    DB.setFilter('stockStatut', next);
    renderStock();
    if (next) stockRevealSection('stockLotsTitle');
};

const showStockHorsVente = () => {
    if (DB.getFilter('stockCell') || DB.getFilter('stockStatut')) {
        DB.setFilter('stockCell', '');
        DB.setFilter('stockStatut', '');
        renderStock();
    }
    stockRevealSection('stockHorsVenteTitle', true);
};

// Bouteilles libres de l'arôme × format d'un lot vendable, pour avertir quand une
// sortie entame le stock réservé aux commandes ; null s'il n'y a rien de réservé.
const getStockReservation = (lot) => {
    if (!lot || !isLotSellable(lot)) return null;
    const cell = buildStockOverview().cells.get(stockCellKey(lot.arome, lot.format));
    if (!cell || cell.reserve <= 0) return null;
    return {
        libre: cell.vendable - cell.reserve,
        reserve: cell.reserve,
        commandes: [...cell.commandes.values()].filter(r => r.reserve > 0).map(r => `#${r.numero}`).join(', ')
    };
};

const sortieReserveWarningText = (libre, quantite, commandes) => {
    const entame = quantite - Math.max(0, libre);
    const s = entame > 1 ? 's' : '';
    return `Cette sortie entame ${entame} bouteille${s} réservée${s} aux commandes ${commandes} : leur livraison pourrait manquer de stock.`;
};

const updateSortieReserveWarning = (input) => {
    const warn = document.getElementById('sortieReserveWarn');
    if (!warn) return;
    const quantite = Number(input.value);
    const libre = Number(input.dataset.libre);
    const show = Number.isInteger(quantite) && quantite > libre;
    warn.hidden = !show;
    if (show) warn.textContent = sortieReserveWarningText(libre, quantite, input.dataset.commandes || '');
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
                    <input type="date" name="dateProduction" value="${prodDate}" data-change="update-lot-dates" required>
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

    const rawQuery    = (DB.getFilter('histQuery') || '').toString();
    const savedQuery  = rawQuery.trim();
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
            const hay = `${formatLotNumero(e.numLot || e.lotId)} ${e.numLot || ''} ${e.lotId || ''} ${e.arome || ''} ${e.format || ''} ${e.quantity || ''} ${SORTIE_MOTIFS[e.motif] || ''} ${e.clientLabel} ${e.note || ''}`;
            if (!includesText(hay, savedQuery)) return false;
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
        ${pageToolbar('<button type="button" class="btn btn-primary" onclick="showNouveauLotModal()">+ Lot</button>', stockSubTabs('historique'))}

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
            <input type="search" id="histSearchInput"
                   placeholder="Rechercher un lot, arôme, format…"
                   aria-label="Rechercher dans l'historique"
                   value="${escapeHtml(rawQuery)}"
                   data-live-search="histQuery">
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

// `saisie` : valeurs à remettre dans le formulaire (retour depuis l'avertissement
// de stock réservé).
const showVendreModal = (lotId, saisie = null) => {
    const lot = (DB.get('lots') || []).find(l => l.id === lotId);
    if (!lot) return;
    const vendable = isLotSellable(lot);
    const motifs = SORTIE_MOTIFS_SAISIE.filter(m => m !== 'vente' || vendable);
    const clients = (DB.get('clients') || [])
        .filter(c => c.actif !== false)
        .sort((a, b) => getClientLabel(a).localeCompare(getClientLabel(b), 'fr'));
    const resa = getStockReservation(lot);
    const quantiteInit = Number.isInteger(saisie?.quantite) && saisie.quantite > 0 ? saisie.quantite : 1;

    modal.show('Sortie de stock', `
        <form id="vendreForm">
            <p class="text-muted" style="margin: 0 0 12px;">Lot #${escapeHtml(formatLotNumero(getLotNumero(lot)))} — ${escapeHtml(lot.arome || '?')} • ${escapeHtml(lot.format || '?')} — ${escapeHtml(String(lot.quantite))} bt en stock</p>
            ${!vendable ? `<p class="trace-alert">${lot.bloque ? 'Lot bloqué' : 'DLV/DLC dépassée ou absente'} : la vente est impossible, seules les autres sorties sont proposées.</p>` : ''}
            <div class="form-group">
                <label for="sortieMotif">Motif</label>
                <select id="sortieMotif" name="motif">
                    ${motifs.map(m => `<option value="${m}"${saisie?.motif === m ? ' selected' : ''}>${escapeHtml(SORTIE_MOTIFS[m])}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label for="sortieQuantite">Quantité</label>
                <input type="number" id="sortieQuantite" name="quantite" min="1" max="${safeNumAttr(lot.quantite)}" step="1" value="${quantiteInit}" required
                       ${resa ? `data-libre="${safeNumAttr(resa.libre)}" data-commandes="${escapeHtml(resa.commandes)}" oninput="updateSortieReserveWarning(this)"` : ''}>
                <small class="text-muted">Stock disponible: ${escapeHtml(String(lot.quantite))}</small>
                ${resa ? `<small class="text-muted" style="display: block;">${escapeHtml(`${lot.arome} ${lot.format} : ${twinFmtInt(Math.max(0, resa.libre))} libre(s), ${twinFmtInt(resa.reserve)} réservée(s) aux commandes ${resa.commandes}`)}</small>` : ''}
            </div>
            ${resa ? `<p class="trace-alert" id="sortieReserveWarn" role="status"${quantiteInit > resa.libre ? '' : ' hidden'}>${escapeHtml(quantiteInit > resa.libre ? sortieReserveWarningText(resa.libre, quantiteInit, resa.commandes) : '')}</p>` : ''}
            <div class="form-group">
                <label for="sortieClient">Client (facultatif)</label>
                <select id="sortieClient" name="clientId">
                    <option value="">— Aucun / inconnu —</option>
                    ${clients.map(c => `<option value="${escapeHtml(c.id)}"${saisie?.clientId === c.id ? ' selected' : ''}>${escapeHtml(getClientLabel(c))}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label for="sortieNote">Note (facultatif)</label>
                <input type="text" id="sortieNote" name="note" maxlength="200" placeholder="Ex. marché du samedi, casse au transport" value="${escapeHtml(saisie?.note || '')}">
            </div>
        </form>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Annuler</button>
        <button class="btn btn-success" data-click="vendre-lot" data-id="${escapeHtml(lotId)}">Enregistrer la sortie</button>
    `);
};

const vendreLot = async (lotId) => {
    const form = document.getElementById('vendreForm');
    const saisie = {
        motif: form?.querySelector('[name="motif"]')?.value || 'vente',
        quantite: Number(form?.querySelector('[name="quantite"]')?.value),
        clientId: form?.querySelector('[name="clientId"]')?.value || '',
        note: (form?.querySelector('[name="note"]')?.value || '').trim()
    };
    const { motif, quantite, clientId, note } = saisie;
    if (!SORTIE_MOTIFS_SAISIE.includes(motif)) {
        showToast('Motif de sortie invalide', 'error');
        return;
    }

    // Message d'erreur si la sortie est impossible sur ce lot, sinon ''
    const refus = (lot) => {
        if (!lot) return 'Lot introuvable';
        // Une vente exige un lot vendable (DLV/DLC valides, lot non bloqué)
        if (motif === 'vente' && !isLotSellable(lot)) return 'Ce lot ne peut plus être vendu (DLV/DLC expirée ou lot bloqué).';
        const stockDisponible = Number(lot.quantite);
        if (!Number.isInteger(quantite) || quantite <= 0 || !Number.isFinite(stockDisponible) || quantite > stockDisponible) {
            return 'Quantité invalide : saisissez un nombre entier disponible en stock';
        }
        return '';
    };

    const lotAvant = (DB.get('lots') || []).find(l => l.id === lotId);
    const erreur = refus(lotAvant);
    if (erreur) {
        showToast(erreur, 'error');
        return;
    }

    // Stock promis aux commandes : confirmer avant de l'entamer
    const resa = getStockReservation(lotAvant);
    if (resa && quantite > resa.libre) {
        const ok = await confirmDialog(
            `${sortieReserveWarningText(resa.libre, quantite, resa.commandes)} Enregistrer quand même cette sortie ?`,
            { danger: true, title: 'Stock réservé', confirmLabel: 'Sortir quand même', cancelLabel: 'Revenir' }
        );
        if (!ok) {
            showVendreModal(lotId, saisie);
            return;
        }
    }

    // Relecture après la confirmation : un autre appareil a pu modifier le stock
    const lots = DB.get('lots') || [];
    const lotIndex = lots.findIndex(l => l.id === lotId);
    const lot = lots[lotIndex];
    const erreurApres = refus(lot);
    if (erreurApres) {
        modal.hide();
        showToast(erreurApres, 'error');
        renderCurrentView();
        return;
    }

    const client = clientId ? (DB.get('clients') || []).find(c => c.id === clientId) : null;

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

// Lot hors vente que la sortie groupée peut détruire : quantité valide, non
// vendable (DLV/DLC dépassée) et non bloqué (un lot bloqué passe par le rappel).
const isLotPerimeSortable = (lot) => {
    const quantite = Number(lot?.quantite);
    return !!lot && Number.isFinite(quantite) && quantite > 0 && !lot.bloque && !isLotSellable(lot);
};

// Sortie groupée des lots périmés affichés dans « Hors vente » (motif destruction / péremption)
const sortirLotsPerimes = async (ids) => {
    const cibles = new Set(ids);
    const avant = (DB.get('lots') || []).filter(l => cibles.has(String(l.id)) && isLotPerimeSortable(l));
    if (avant.length === 0) {
        showToast('Aucun lot périmé à sortir', 'error');
        renderCurrentView();
        return;
    }
    const nbBt = avant.reduce((s, l) => s + Number(l.quantite), 0);
    const ok = await confirmDialog(
        `Sortir ${dashPlural(avant.length, 'lot')} (${twinFmtInt(nbBt)} bt) du stock pour destruction / péremption ? Les lots bloqués ne sont pas concernés : traitez-les depuis leur rappel.`,
        { danger: true, title: 'Sortie des lots périmés', confirmLabel: 'Tout sortir' }
    );
    if (!ok) return;

    // Relecture après la confirmation : un autre appareil a pu modifier le stock
    const lots = DB.get('lots') || [];
    const history = DB.get('history') || [];
    let nbLots = 0;
    let total = 0;
    const restants = lots.filter(lot => {
        if (!cibles.has(String(lot.id)) || !isLotPerimeSortable(lot)) return true;
        const quantite = Number(lot.quantite);
        history.unshift(buildLotHistoryEntry('SORTIE', lot, quantite, { motif: 'destruction' }));
        nbLots += 1;
        total += quantite;
        return false;
    });
    if (nbLots === 0) {
        showToast('Aucun lot périmé à sortir', 'error');
        renderCurrentView();
        return;
    }
    DB.set('lots', restants);
    DB.set('history', history);
    showToast(`${dashPlural(nbLots, 'lot sorti', 'lots sortis')} du stock — ${twinFmtInt(total)} bt, ${SORTIE_MOTIFS.destruction}`);
    renderCurrentView();
};

// --- Traçabilité des bouteilles : parcours complet d'un lot ---
const readLotTraceTables = () => ({
    lots: DB.get('lots') || [],
    history: DB.get('history') || [],
    commandes: DB.get('commandes') || [],
    clients: DB.get('clients') || [],
    livraisons: DB.get('livraisons') || []
});

const getLotTraceData = (lotId, tables = readLotTraceTables()) => {
    const idStr = String(lotId);
    const { lots, history, commandes, clients, livraisons } = tables;

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
    // Traçabilité amont (v12.9) : lots d'ingrédients des productions de ce lot,
    // une fois par production (quantités pour toute la production, tous formats)
    const productionsVues = new Set();
    const ingredients = [];
    productions.forEach(p => {
        if (!Array.isArray(p.ingredients)) return;
        const cle = p.productionId || p.id;
        if (productionsVues.has(cle)) return;
        productionsVues.add(cle);
        p.ingredients.forEach(ing => ingredients.push({ ...ing, productionId: cle, dateProduction: p.productionDate || '' }));
    });

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
        productions,
        ventes,
        sorties,
        ajustements,
        retours,
        ingredients
    };
};

// Tableau des lots d'ingrédients utilisés (Tracer et Rappel du lot)
const ingredientsTraceHtml = (ingredients, totalProduit) => {
    if (ingredients.length === 0) {
        return totalProduit > 0
            ? '<p class="text-muted">Lots d\'ingrédients non suivis pour ce lot.</p>'
            : '';
    }
    return `<div class="trace-scroll"><table class="details-table">
        <thead><tr><th>Ingrédient</th><th>N° de lot</th><th>Fournisseur</th><th>Quantité</th></tr></thead>
        <tbody>
            ${ingredients.map(ing => `<tr>
                <td>${escapeHtml(ing.article || '?')}</td>
                <td>${ing.numLot ? `<code class="inv-lot-num">${escapeHtml(ing.numLot)}</code>` : '<span class="text-muted">sans n° de lot</span>'}</td>
                <td>${ing.fournisseur ? escapeHtml(ing.fournisseur) : '—'}</td>
                <td>${escapeHtml(invFmtQte(ing.quantite, ing.unite))}</td>
            </tr>`).join('')}
        </tbody>
    </table></div>`;
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

// « il y a 12 j », « dans 3 j », « aujourd'hui » (dates de la frise du lot)
const traceRelativeDay = (value) => {
    const days = twinDaysUntil(value);
    if (days === null) return '';
    if (days === 0) return "aujourd'hui";
    return days > 0 ? `dans ${twinFmtInt(days)} j` : `il y a ${twinFmtInt(-days)} j`;
};

// Badge d'état du lot en tête de la fiche de traçabilité
const traceStatusBadge = (t) => {
    if (!t.lot) return '<span class="trace-status trace-status--neutral">Épuisé</span>';
    if (t.bloque) return '<span class="trace-status trace-status--danger">Bloqué</span>';
    const status = getLotStatus(t.lot);
    const [cls, label] = {
        ok: ['success', 'Vendable'],
        warning: ['warning', getLotStatusLabel('warning', t.lot)],
        invendable: ['danger', 'Invendable'],
        expired: ['danger', 'Expiré']
    }[status] || ['neutral', status];
    return `<span class="trace-status trace-status--${cls}">${escapeHtml(label)}</span>`;
};

// Parcours chronologique du lot : production, livraisons, ventes, sorties, ajustements, retours
const traceJourneyItems = (t) => {
    const temps = (v) => { const ms = Date.parse(v || ''); return Number.isNaN(ms) ? 0 : ms; };
    const items = [];
    t.productions.forEach(p => items.push({
        kind: 'prod', date: p.productionDate || p.dateAdded, titre: 'Production', detail: '', delta: Number(p.quantity) || 0
    }));
    t.livraisonsClients.forEach(l => items.push({
        kind: 'livraison',
        date: l.date,
        titre: l.clientNom || 'Client',
        detail: [
            l.commandeNumero ? `Cmd #${l.commandeNumero}` : '',
            l.numeroBL ? `BL ${l.numeroBL}` : '',
            l.date && !l.dateEffective ? 'livraison prévue' : ''
        ].filter(Boolean).join(' · '),
        delta: -(Number(l.quantite) || 0),
        commandeId: l.commandeId
    }));
    [...t.ventes, ...t.sorties, ...t.ajustements].forEach(h => {
        const type = getHistoryType(h);
        const titre = type === 'vente' ? 'Vente directe'
            : type === 'ajust' ? `Ajustement${h.motif && h.motif !== 'correction' ? ` (${SORTIE_MOTIFS[h.motif] || h.motif})` : ''}`
            : SORTIE_MOTIFS[h.motif] || 'Sortie';
        items.push({ kind: type, date: h.dateAdded, titre, detail: [h.clientNom, h.note].filter(Boolean).join(' — '), delta: getHistoryDelta(h) });
    });
    t.retours.forEach(r => items.push({
        kind: 'retour',
        date: r.dateAdded,
        titre: `Livraison annulée${r.clientNom ? ` — ${r.clientNom}` : ''}`,
        detail: [r.commandeNumero ? `Cmd #${r.commandeNumero}` : '', r.numeroBL ? `BL ${r.numeroBL}` : '', 're-crédité en stock'].filter(Boolean).join(' · '),
        delta: Number(r.quantity) || 0
    }));
    return items.sort((a, b) => temps(a.date) - temps(b.date));
};

const showLotTraceModal = (lotId) => {
    const t = getLotTraceData(lotId);
    if (!t.arome && t.livraisonsClients.length === 0 && t.totalProduit === 0) {
        showToast('Aucune donnée de traçabilité pour ce lot', 'error');
        return;
    }

    const ecart = getLotTraceEcart(t);
    const numLotAffiche = formatLotNumero(t.numLot || t.lotId);
    const arome = (DB.get('aromes') || []).find(a => normalizeName(a.nom) === normalizeName(t.arome));
    const fmtBt = (n) => `${twinFmtInt(n)} bt`;

    // Frise Prod. → DLV → DLC (lot encore en stock) et dates avec leur échéance
    const datesLot = { dateProduction: t.dateProduction, dlv: t.dlv, dlc: t.dlc };
    const dates = [['Production', t.dateProduction], ['DLV', t.dlv], ['DLC', t.dlc]]
        .filter(([, d]) => d && isValidDateOnly(d));
    const datesHtml = dates.length === 0 ? '' : `
        <div class="trace-dates">${dates.map(([label, d]) => `
            <div class="trace-date">
                <span class="trace-date-label">${escapeHtml(label)}</span>
                <span class="trace-date-value">${escapeHtml(formatDate(d))}</span>
                <span class="trace-date-rel">${escapeHtml(traceRelativeDay(d))}</span>
            </div>`).join('')}
        </div>`;

    // Où sont passées les bouteilles : livré, vendu, sorti, en stock
    const sorti = t.totalVenteDirecte + t.totalSorties;
    const parts = [
        { cls: 'livre', label: 'Livré aux clients', n: t.totalLivre },
        { cls: 'vente', label: 'Ventes directes', n: t.totalVenteDirecte },
        { cls: 'sortie', label: 'Autres sorties', n: t.totalSorties },
        { cls: 'stock', label: 'En stock', n: t.enStock }
    ].filter(p => p.n > 0);
    const base = parts.reduce((s, p) => s + p.n, 0);
    const fluxHtml = base === 0 ? '' : `
        <div class="trace-flow-bar" role="img" aria-label="${escapeHtml(parts.map(p => `${p.label} ${fmtBt(p.n)}`).join(', '))}">
            ${parts.map(p => `<span class="trace-flow-seg trace-flow-seg--${p.cls}" style="flex-grow:${safeNumAttr(p.n)}"></span>`).join('')}
        </div>
        <ul class="trace-flow-legend">
            ${parts.map(p => `<li><span class="trace-flow-dot trace-flow-seg--${p.cls}"></span>${escapeHtml(p.label)} <strong>${escapeHtml(fmtBt(p.n))}</strong></li>`).join('')}
        </ul>`;

    const kpi = (label, value, extra = '') => `
        <div class="trace-kpi${extra}">
            <span class="trace-kpi-value">${value}</span>
            <span class="trace-kpi-label">${escapeHtml(label)}</span>
        </div>`;

    const parcours = traceJourneyItems(t);
    const parcoursHtml = parcours.length === 0
        ? '<p class="text-muted">Aucun mouvement enregistré pour ce lot.</p>'
        : `<ol class="trace-journey">${parcours.map(it => {
            const qte = `${it.delta < 0 ? '−' : '+'}${twinFmtInt(Math.abs(it.delta))} bt`;
            const titre = it.commandeId
                ? `<button type="button" class="trace-journey-link" data-click="show-commande-details" data-id="${escapeHtml(it.commandeId)}">${escapeHtml(it.titre)}</button>`
                : escapeHtml(it.titre);
            return `
                <li class="trace-journey-item trace-journey-item--${escapeHtml(it.kind)}">
                    <span class="trace-journey-dot" aria-hidden="true"></span>
                    <div class="trace-journey-main">
                        <div class="trace-journey-title">${titre}</div>
                        <div class="trace-journey-meta">${escapeHtml([it.date ? formatJourTrace(it.date) : 'date inconnue', it.detail].filter(Boolean).join(' · '))}</div>
                    </div>
                    <span class="trace-journey-qty${it.delta < 0 ? ' is-out' : ''}">${escapeHtml(qte)}</span>
                </li>`;
        }).join('')}</ol>`;

    const ingredientsHtml = t.ingredients.length || t.totalProduit > 0
        ? `<section class="trace-section"><h4 class="trace-section-title">Ingrédients utilisés</h4>${ingredientsTraceHtml(t.ingredients, t.totalProduit)}</section>`
        : '';

    modal.show(`Traçabilité lot #${numLotAffiche}`, `
        <div class="trace-sheet">
            <div class="trace-hero">
                <span class="trace-hero-swatch" style="background:${safeColor(arome?.couleur)}" aria-hidden="true"></span>
                <div class="trace-hero-text">
                    <div class="trace-hero-name">${escapeHtml(t.arome || '?')}</div>
                    <div class="trace-hero-sub">${escapeHtml(t.format || '?')} · lot #${escapeHtml(numLotAffiche)}</div>
                </div>
                ${traceStatusBadge(t)}
            </div>

            ${t.bloque ? `<p class="trace-alert trace-alert-danger"><strong>Lot bloqué</strong>${t.motifBlocage ? ` — ${escapeHtml(t.motifBlocage)}` : ''}${t.dateBlocage ? ` (depuis le ${formatJourTrace(t.dateBlocage)})` : ''}</p>` : ''}

            <div class="trace-life">
                ${t.lot ? lotShelfLifeHtml(datesLot) : ''}
                ${datesHtml}
            </div>

            <div class="trace-kpis">
                ${t.totalProduit > 0 ? kpi('Produit', escapeHtml(fmtBt(t.totalProduit))) : ''}
                ${kpi('Livré', escapeHtml(fmtBt(t.totalLivre)))}
                ${kpi('Vendu / sorti', escapeHtml(fmtBt(sorti)))}
                ${kpi('En stock', t.lot ? escapeHtml(fmtBt(t.enStock)) : 'Épuisé', ' trace-kpi--stock')}
            </div>
            ${fluxHtml}
            ${t.totalAjustements !== 0 ? `<p class="trace-note">Ajustements de quantité : ${t.totalAjustements > 0 ? '+' : '−'}${escapeHtml(fmtBt(Math.abs(t.totalAjustements)))}</p>` : ''}
            ${ecart !== null && ecart !== 0 ? `<p class="trace-alert">Écart non expliqué : <strong>${escapeHtml(fmtBt(ecart))}</strong> (produit + ajustements − livré − vendu − sorti − stock)</p>` : ''}

            <section class="trace-section">
                <h4 class="trace-section-title">Parcours du lot</h4>
                ${parcoursHtml}
            </section>
            ${ingredientsHtml}
        </div>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Fermer</button>
        ${t.lot && t.enStock > 0 ? `<button class="btn btn-secondary" data-click="sell-lot" data-id="${escapeHtml(t.lotId)}">Sortie de stock</button>` : ''}
        <button class="btn btn-primary" data-click="show-lot-rappel" data-num="${escapeHtml(String(t.numLot || t.lotId))}">Rappel du lot (tous formats)</button>
    `);
};

// --- Rappel de lot : vue consolidée d'un numéro de lot (tous formats) ---
const getLotRappelData = (numLot) => {
    const key = normLotNumero(numLot);
    const tables = readLotTraceTables();
    const { lots, history, commandes, clients, livraisons } = tables;

    const correspond = (num, id) => !!key && normLotNumero(num || id) === key;
    const ids = new Set();
    lots.forEach(l => { if (correspond(l.numLot, l.id)) ids.add(String(l.id)); });
    history.forEach(h => { if (h.lotId && correspond(h.numLot, h.lotId)) ids.add(String(h.lotId)); });
    commandes.forEach(c => (c.lotsUtilises || []).forEach(lu => { if (lu.lotId && correspond(lu.numLot, lu.lotId)) ids.add(String(lu.lotId)); }));
    livraisons.forEach(l => (l.lotsTraces || []).forEach(t => { if (t.lotId && correspond(t.numLot, t.lotId)) ids.add(String(t.lotId)); }));

    const traces = [...ids].map(id => getLotTraceData(id, tables))
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
    // Lots d'ingrédients : une production couvre tous les formats du numéro
    const productionsVues = new Set();
    const ingredients = traces.flatMap(t => t.ingredients).filter(ing => {
        const cle = `${ing.productionId}|${ing.article}|${ing.numLot}|${ing.quantite}`;
        if (productionsVues.has(cle)) return false;
        productionsVues.add(cle);
        return true;
    });

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
        ingredients,
        lotsEnStock: lots.filter(l => ids.has(String(l.id)))
    };
};

// Coordonnées libres d'un client : e-mails et numéros de téléphone deviennent cliquables
const linkifyContact = (text) => {
    const re = /([\w.+-]+@[\w-]+(?:\.[\w-]+)+)|(\+?\d[\d .\/-]{7,}\d)/g;
    const s = String(text || '');
    let html = '';
    let last = 0;
    s.replace(re, (m, email, tel, offset) => {
        html += escapeHtml(s.slice(last, offset));
        html += email
            ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`
            : `<a href="tel:${escapeHtml(tel.replace(/[^\d+]/g, ''))}">${escapeHtml(tel)}</a>`;
        last = offset + m.length;
        return m;
    });
    return html + escapeHtml(s.slice(last));
};

// Destinataires du rappel, regroupés par client : livraisons et sorties nominatives
const rappelDestinataires = (r) => {
    const groupes = new Map();
    const groupe = (clientId, clientNom, adresse, coord) => {
        const cle = clientId || `nom:${normalizeName(clientNom)}`;
        if (!groupes.has(cle)) groupes.set(cle, { clientNom, adresse, coord, total: 0, envois: [] });
        const g = groupes.get(cle);
        if (!g.adresse && adresse) g.adresse = adresse;
        if (!g.coord && coord) g.coord = coord;
        return g;
    };
    r.livraisonsClients.forEach(l => {
        const g = groupe(l.clientId, l.clientNom, l.adresse, l.coord);
        g.total += Number(l.quantite) || 0;
        // Une commande livrée en plusieurs formats : une seule ligne
        const meme = l.commandeId ? g.envois.find(e => e.commandeId === l.commandeId) : null;
        if (meme) {
            meme.parFormat.push({ format: l.format, quantite: Number(l.quantite) || 0 });
            return;
        }
        g.envois.push({
            date: l.date,
            libelle: [l.commandeNumero ? `Cmd #${l.commandeNumero}` : 'Livraison', l.numeroBL ? `BL ${l.numeroBL}` : '', l.date && !l.dateEffective ? 'prévue' : ''].filter(Boolean).join(' · '),
            commandeId: l.commandeId,
            parFormat: [{ format: l.format, quantite: Number(l.quantite) || 0 }]
        });
    });
    r.sorties.filter(s => s.type !== 'ajust' && (s.clientId || s.clientNom)).forEach(s => {
        const g = groupe(s.clientId, s.clientNom, s.adresse, s.coord);
        const q = Math.abs(getHistoryDelta(s));
        g.total += q;
        g.envois.push({ date: s.dateAdded, libelle: [s.type === 'vente' ? 'Vente directe' : (SORTIE_MOTIFS[s.motif] || 'Sortie'), s.note].filter(Boolean).join(' · '), parFormat: [{ format: s.format, quantite: q }] });
    });
    return [...groupes.values()].sort((a, b) => b.total - a.total || String(a.clientNom).localeCompare(String(b.clientNom), 'fr'));
};

const showLotRappelModal = (numLot) => {
    const r = getLotRappelData(numLot);
    if (r.traces.length === 0) {
        showToast('Aucune donnée de traçabilité pour ce numéro de lot', 'error');
        return;
    }

    const fmtBt = (n) => `${twinFmtInt(n)} bt`;
    const listeDates = (list) => list.length ? list.map(d => formatDate(d)).join(', ') : '—';
    const ambigu = r.aromes.length > 1 || r.datesProduction.length > 1;
    const lotsBloques = r.lotsEnStock.filter(l => l.bloque);
    const lotsLibres = r.lotsEnStock.filter(l => !l.bloque && Number(l.quantite) > 0);
    const btBloques = lotsBloques.reduce((s, l) => s + (Number(l.quantite) || 0), 0);
    const btLibres = lotsLibres.reduce((s, l) => s + (Number(l.quantite) || 0), 0);
    const numAttr = escapeHtml(r.numLot);
    const couleurs = DB.get('aromes') || [];
    const couleurDe = (nom) => safeColor(couleurs.find(a => normalizeName(a.nom) === normalizeName(nom))?.couleur);
    const destinataires = rappelDestinataires(r);
    const anonymes = r.sorties.filter(s => s.type !== 'ajust' && !s.clientId && !s.clientNom)
        .reduce((s, h) => s + Math.abs(getHistoryDelta(h)), 0);

    const badge = btLibres > 0
        ? '<span class="trace-status trace-status--warning">Stock non bloqué</span>'
        : btBloques > 0 ? '<span class="trace-status trace-status--danger">Stock bloqué</span>'
        : '<span class="trace-status trace-status--neutral">Plus de stock</span>';

    // Plan de rappel : bloquer, prévenir, exporter
    const etape = (etat, titre, texte, action = '') => `
        <li class="rappel-step rappel-step--${etat}">
            <span class="rappel-step-dot" aria-hidden="true">${etat === 'done' ? '✓' : ''}</span>
            <div class="rappel-step-main">
                <div class="rappel-step-title">${escapeHtml(titre)}</div>
                <div class="rappel-step-text">${escapeHtml(texte)}</div>
            </div>
            ${action}
        </li>`;
    const planHtml = `
        <ol class="rappel-plan">
            ${btLibres > 0
                ? etape('todo', 'Bloquer le stock restant', `${fmtBt(btLibres)} encore vendables ou livrables${btBloques > 0 ? ` (${fmtBt(btBloques)} déjà bloquées)` : ''}.`,
                    `<button type="button" class="btn btn-sm btn-primary" data-click="bloquer-lot" data-num="${numAttr}">Bloquer ${escapeHtml(fmtBt(btLibres))}</button>`)
                : btBloques > 0
                    ? etape('done', 'Stock bloqué', `${fmtBt(btBloques)} bloquées${lotsBloques[0].motifBlocage ? ` : ${lotsBloques[0].motifBlocage}` : ''}.`,
                        `<button type="button" class="btn btn-sm btn-ghost" data-click="debloquer-lot" data-num="${numAttr}">Débloquer</button>`)
                    : etape('done', 'Aucun stock restant', 'Toutes les bouteilles de ce lot sont sorties du stock.')}
            ${destinataires.length > 0
                ? etape('todo', 'Prévenir les destinataires', `${dashPlural(destinataires.length, 'client')} à contacter (${fmtBt(destinataires.reduce((s, d) => s + d.total, 0))}), coordonnées ci-dessous.${anonymes > 0 ? ` ${fmtBt(anonymes)} vendues sans client connu.` : ''}`)
                : etape('done', 'Aucun destinataire connu', anonymes > 0 ? `${fmtBt(anonymes)} sorties sans client enregistré.` : 'Aucune bouteille de ce lot n\'a quitté l\'atelier.')}
            ${etape('todo', 'Archiver le dossier', 'Export Excel : synthèse, formats, ingrédients, clients et sorties.',
                `<button type="button" class="btn btn-sm btn-secondary" data-click="export-lot-rappel" data-num="${numAttr}">Exporter Excel</button>`)}
        </ol>`;

    const destinatairesHtml = destinataires.length === 0 ? '' : `
        <section class="trace-section">
            <h4 class="trace-section-title">Destinataires à contacter</h4>
            <div class="rappel-clients">${destinataires.map(d => `
                <article class="rappel-client">
                    <div class="rappel-client-head">
                        <span class="rappel-client-name">${escapeHtml(d.clientNom || 'Client')}</span>
                        <span class="cmd-line-qty">${escapeHtml(fmtBt(d.total))}</span>
                    </div>
                    ${d.adresse ? `<div class="rappel-client-info">${escapeHtml(d.adresse)}</div>` : ''}
                    <div class="rappel-client-info">${d.coord ? linkifyContact(d.coord) : '<span class="text-muted">Pas de coordonnées enregistrées</span>'}</div>
                    <ul class="rappel-client-envois">${d.envois.map(e => `
                        <li>
                            <span>${escapeHtml(e.date ? formatJourTrace(e.date) : '—')}</span>
                            ${e.commandeId
                                ? `<button type="button" class="trace-journey-link" data-click="show-commande-details" data-id="${escapeHtml(e.commandeId)}">${escapeHtml(e.libelle)}</button>`
                                : `<span>${escapeHtml(e.libelle)}</span>`}
                            <span class="rappel-client-envoi-qty">${escapeHtml(e.parFormat.map(f => `${f.format || '?'} · ${fmtBt(f.quantite)}`).join(', '))}</span>
                        </li>`).join('')}
                    </ul>
                </article>`).join('')}
            </div>
        </section>`;

    const formatsHtml = `
        <section class="trace-section">
            <h4 class="trace-section-title">Par format</h4>
            <ul class="cmd-lots">${r.traces.map(t => `
                <li>
                    <button type="button" class="cmd-lot rappel-format" data-click="show-lot-trace" data-id="${escapeHtml(t.lotId)}" aria-label="${escapeHtml(`Traçabilité ${t.arome || ''} ${t.format || ''}`)}">
                        <span class="cmd-lot-name"><span class="aroma-tile-dot" style="background:${couleurDe(t.arome)}"></span>${escapeHtml(t.format || '?')}${r.aromes.length > 1 ? ` <span class="stock-group-format">· ${escapeHtml(t.arome || '')}</span>` : ''}</span>
                        <span class="rappel-format-stats">${escapeHtml(`produit ${twinFmtInt(t.totalProduit)} · livré ${twinFmtInt(t.totalLivre)} · sorti ${twinFmtInt(t.totalVenteDirecte + t.totalSorties)}`)}</span>
                        ${!t.lot ? '<span class="trace-status trace-status--neutral">Épuisé</span>'
                            : t.bloque ? `<span class="trace-status trace-status--danger">${escapeHtml(fmtBt(t.enStock))} bloquées</span>`
                            : `<span class="trace-status trace-status--warning">${escapeHtml(fmtBt(t.enStock))} en stock</span>`}
                        ${dashIcon('chevron')}
                    </button>
                </li>`).join('')}
            </ul>
        </section>`;

    const mouvements = [
        ...r.sorties.map(s => ({
            kind: s.type,
            date: s.dateAdded,
            titre: s.type === 'vente' ? 'Vente directe' : s.type === 'ajust' ? 'Ajustement' : (SORTIE_MOTIFS[s.motif] || 'Sortie'),
            detail: [s.format, s.clientNom || (s.type === 'ajust' ? '' : 'client inconnu'), s.note].filter(Boolean).join(' · '),
            delta: getHistoryDelta(s)
        })),
        ...r.retours.map(x => ({
            kind: 'retour',
            date: x.dateAdded,
            titre: `Livraison annulée${x.clientNom ? ` — ${x.clientNom}` : ''}`,
            detail: [x.format, x.commandeNumero ? `Cmd #${x.commandeNumero}` : '', x.numeroBL ? `BL ${x.numeroBL}` : ''].filter(Boolean).join(' · '),
            delta: Number(x.quantity) || 0
        }))
    ].sort((a, b) => (Date.parse(a.date || '') || 0) - (Date.parse(b.date || '') || 0));
    const mouvementsHtml = mouvements.length === 0 ? '' : `
        <section class="trace-section">
            <h4 class="trace-section-title">Ventes directes, sorties et annulations</h4>
            <ol class="trace-journey">${mouvements.map(m => `
                <li class="trace-journey-item trace-journey-item--${escapeHtml(m.kind)}">
                    <span class="trace-journey-dot" aria-hidden="true"></span>
                    <div class="trace-journey-main">
                        <div class="trace-journey-title">${escapeHtml(m.titre)}</div>
                        <div class="trace-journey-meta">${escapeHtml([m.date ? formatJourTrace(m.date) : 'date inconnue', m.detail].filter(Boolean).join(' · '))}</div>
                    </div>
                    <span class="trace-journey-qty${m.delta < 0 ? ' is-out' : ''}">${escapeHtml(`${m.delta < 0 ? '−' : '+'}${fmtBt(Math.abs(m.delta))}`)}</span>
                </li>`).join('')}
            </ol>
        </section>`;

    const sorti = r.totalVenteDirecte + r.totalSorties;
    const kpi = (label, value, extra = '') => `<div class="trace-kpi${extra}"><span class="trace-kpi-value">${escapeHtml(value)}</span><span class="trace-kpi-label">${escapeHtml(label)}</span></div>`;

    modal.show(`Rappel du lot #${r.numLotAffiche}`, `
        <div class="trace-sheet">
            <div class="trace-hero">
                <span class="trace-hero-swatch" style="background:${couleurDe(r.aromes[0])}" aria-hidden="true"></span>
                <div class="trace-hero-text">
                    <div class="trace-hero-name">${escapeHtml(r.aromes.join(', ') || '?')}</div>
                    <div class="trace-hero-sub">${escapeHtml(`Lot #${r.numLotAffiche} · ${dashPlural(r.traces.length, 'format')}`)}</div>
                </div>
                ${badge}
            </div>

            ${ambigu ? '<p class="trace-alert">Ce numéro est partagé par plusieurs arômes ou dates de production : vérifiez chaque format avant d\'agir.</p>' : ''}

            <div class="trace-life">
                <div class="trace-dates">
                    <div class="trace-date"><span class="trace-date-label">Production</span><span class="trace-date-value">${escapeHtml(listeDates(r.datesProduction))}</span></div>
                    <div class="trace-date"><span class="trace-date-label">DLV</span><span class="trace-date-value">${escapeHtml(listeDates(r.dlvs))}</span></div>
                    <div class="trace-date"><span class="trace-date-label">DLC</span><span class="trace-date-value">${escapeHtml(listeDates(r.dlcs))}</span></div>
                </div>
            </div>

            <div class="trace-kpis rappel-kpis">
                ${kpi('Produit', fmtBt(r.totalProduit))}
                ${kpi('Livré', fmtBt(r.totalLivre))}
                ${kpi('Vendu / sorti', fmtBt(sorti))}
                ${kpi(btBloques > 0 && btLibres === 0 ? 'En stock (bloqué)' : 'En stock', fmtBt(r.enStock))}
                ${kpi('Destinataires', twinFmtInt(r.nbDestinataires), ' trace-kpi--stock')}
            </div>

            <section class="trace-section">
                <h4 class="trace-section-title">Plan de rappel</h4>
                ${planHtml}
            </section>
            ${destinatairesHtml}
            ${formatsHtml}
            ${r.ingredients.length || r.totalProduit > 0 ? `<section class="trace-section"><h4 class="trace-section-title">Ingrédients utilisés</h4>${ingredientsTraceHtml(r.ingredients, r.totalProduit)}</section>` : ''}
            ${mouvementsHtml}
        </div>
    `, `
        <button class="btn btn-secondary" data-click="close-modal">Fermer</button>
        <button class="btn btn-primary" data-click="export-lot-rappel" data-num="${numAttr}">Exporter Excel</button>
    `, 'large');
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

    const ingredients = r.ingredients.map(ing => ({
        'Production': ing.dateProduction || '',
        'Ingrédient': ing.article || '',
        'N° de lot fournisseur': ing.numLot || 'sans n° de lot',
        'Fournisseur': ing.fournisseur || '',
        'Quantité': Number(ing.quantite) || 0,
        'Unité': displayUnit(ing.unite || '')
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, feuille(synthese), 'Synthèse');
    XLSX.utils.book_append_sheet(wb, feuille(parFormat), 'Par format');
    if (ingredients.length > 0) XLSX.utils.book_append_sheet(wb, feuille(ingredients), 'Ingrédients');
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
                <input type="date" name="dateProduction" value="${escapeHtml(lot.dateProduction)}" data-change="update-lot-dates" required>
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
            </div>
        </form>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Annuler</button>
        <button class="btn btn-primary" data-click="edit-lot-save" data-id="${escapeHtml(lotId)}">Enregistrer</button>
    `);
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
