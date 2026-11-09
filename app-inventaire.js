// Consommables « contenants » toujours attendus (bouteilles + bouchons)
const CONTAINER_CONSOMMABLES = [
    { nom: 'Bouteilles vides 25cl', unite: 'pcs', seuilAlerte: 0 },
    { nom: 'Bouteilles vides 50cl', unite: 'pcs', seuilAlerte: 0 },
    { nom: 'Bouteilles vides 1L', unite: 'pcs', seuilAlerte: 0 },
    { nom: 'Bouchons 25cl', unite: 'pcs', seuilAlerte: 0 },
    { nom: 'Bouchons 50cl/100cl', unite: 'pcs', seuilAlerte: 0 }
];

// Articles proposés pour un inventaire vide, sur demande explicite : une fonction
// de rendu n'écrit jamais (un appareil neuf, avant le premier chargement cloud,
// semait des doublons — audit du 23.10, n° 7).
const DEFAULT_CONSOMMABLES = [
    { nom: 'Eau', unite: 'L', seuilAlerte: 0 },
    { nom: 'Sucre', unite: 'kg', seuilAlerte: 0 },
    { nom: 'Citron', unite: 'kg', seuilAlerte: 0 },
    { nom: 'Menthe', unite: 'kg', seuilAlerte: 0 },
    { nom: 'Hibiscus', unite: 'kg', seuilAlerte: 0 },
    { nom: 'Mûre sauvage', unite: 'kg', seuilAlerte: 0 },
    { nom: 'Poire à botzi', unite: 'kg', seuilAlerte: 0 },
    { nom: 'Sureau', unite: 'kg', seuilAlerte: 0 },
    { nom: 'Herbes des alpes', unite: 'kg', seuilAlerte: 0 },
    { nom: 'Étiquettes', unite: 'pcs', seuilAlerte: 0 },
    ...CONTAINER_CONSOMMABLES
];

// Migration unique : garantit la présence des bouteilles et bouchons dans un
// inventaire existant. Jamais sur un inventaire vide (pas encore chargé).
const ensureContainerConsommables = (items) => {
    if (items.length === 0 || localStorage.getItem('thecol_migr_contenants') === '1') return items;
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

const seedInventaireParDefaut = () => {
    const items = DB.get('inventaire') || [];
    if (items.length > 0) {
        renderInventaire();
        return;
    }
    DB.set('inventaire', DEFAULT_CONSOMMABLES.map(c => ({ ...c, id: generateId(), categorie: 'consommable', quantite: 0 })));
    localStorage.setItem('thecol_migr_contenants', '1');
    showToast('Articles de base créés');
    renderInventaire();
};

// --- Inventaire : ingrédients suivis par lot fournisseur (v12.9) ---
// Contenants (bouteilles, bouchons, étiquettes…) : comptés sans lot. Les autres
// consommables sont des ingrédients ; tous sauf l'eau sont suivis par lot.
// article.lots = [{ id, numLot, quantite, quantiteRecue, dateReception,
// fournisseur, dateLimite, dateRetrait }] ; article.quantite reste le total, et
// la part non couverte par les lots est le stock « sans n° de lot » (antérieur
// au suivi), utilisé en premier.
const isContenantNom = (nom) => /^(bouteille|bouchon|etiquette|capsule|carton|caisse|couvercle)/.test(normalizeName(nom));
const isIngredientArticle = (item) => !!item && item.categorie !== 'equipement' && !isContenantNom(item.nom);
const isLotSuiviArticle = (item) => isIngredientArticle(item) && !isWaterIngredient(item.nom);

const arrondiInv = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
const invFmtNombre = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('fr-CH', { maximumFractionDigits: 2 });
const invFmtQte = (n, unite) => `${invFmtNombre(n)} ${displayUnit(unite || '')}`.trim();
const normLotFournisseur = (v) => String(v ?? '').trim().toLowerCase();

const prixAchatDansUnite = (item, unite, lot) => {
    const prix = lot?.prixAchat ?? item?.prixAchat;
    if (!estMontantConnu(prix?.montant)) return null;
    const quantite = convertQuantity(1, unite, prix.unite);
    return quantite === null ? null : prix.montant * quantite;
};

const invChampPrixAchat = (id, unite, montant = null) => `
    <div class="form-group">
        <label for="${id}">Prix d’achat (CHF / ${escapeHtml(unite)})</label>
        <input type="number" id="${id}" min="0" step="any" inputmode="decimal" value="${estMontantConnu(montant) ? montant : ''}">
    </div>`;

const showInventairePrixModal = (id) => {
    const item = DB.get('inventaire').find(i => i.id === id);
    if (!item || item.categorie === 'equipement') return;
    const unite = displayUnit(item.unite);
    modal.show(`Prix d’achat · ${item.nom}`, `
        <form id="invPrixForm" data-unite="${escapeHtml(unite)}">
            ${invChampPrixAchat('invPrixAchat', unite, prixAchatDansUnite(item, unite))}
            <p class="text-muted">Saisissez le prix d’une unité. Ce prix sert de référence pour les stocks sans prix de lot. Laissez vide si le prix est inconnu ou saisissez 0 si l’article est gratuit.</p>
        </form>
    `, `
        <button class="btn btn-secondary" data-click="close-modal">Annuler</button>
        <button class="btn btn-primary" data-click="inventaire-prix-save" data-id="${escapeHtml(id)}">Enregistrer</button>
    `);
    document.getElementById('invPrixAchat')?.focus();
};

const saveInventairePrix = (id) => {
    const form = document.getElementById('invPrixForm');
    if (!form?.reportValidity()) return;
    const items = DB.get('inventaire');
    const item = items.find(i => i.id === id);
    if (!item || displayUnit(item.unite) !== form.dataset.unite) {
        showToast('L’article a changé. Rouvrez son prix d’achat.', 'error');
        return;
    }
    const valeur = document.getElementById('invPrixAchat').value;
    if (valeur === '') delete item.prixAchat;
    else item.prixAchat = { montant: Number(valeur), unite: form.dataset.unite };
    if (!DB.set('inventaire', items)) return;
    modal.hide();
    showToast('Prix d’achat enregistré');
    renderCurrentView();
};

const invLotsEnStock = (item) => (item?.lots || []).filter(l => Number(l.quantite) > 0);
const invSansLot = (item) => Math.max(0, arrondiInv((Number(item?.quantite) || 0) - invLotsEnStock(item).reduce((s, l) => s + Number(l.quantite), 0)));
const invDateTri = (d) => {
    const t = d ? dateOnly(d).getTime() : NaN;
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
};
// Ordre d'utilisation : date limite la plus proche, puis réception la plus ancienne
const invLotsOrdreUsage = (item) => invLotsEnStock(item).slice().sort((a, b) =>
    (invDateTri(a.dateLimite) - invDateTri(b.dateLimite))
    || (invDateTri(a.dateReception) - invDateTri(b.dateReception))
    || String(a.numLot).localeCompare(String(b.numLot)));

// Retire `qty` des lots d'un ingrédient : d'abord le stock sans n° de lot (le plus
// ancien), puis les lots dans l'ordre d'utilisation. Ne touche pas à `quantite`
// (l'appelant la diminue). Renvoie [{ numLot, fournisseur, quantite }], numLot ''
// pour le stock sans n° de lot ou ce qui dépasse le stock.
const consommerLotsIngredient = (item, qty) => {
    const allocations = [];
    let reste = arrondiInv(qty);
    const sansLot = invSansLot(item);
    if (sansLot > 0 && reste > 0) {
        const pris = Math.min(sansLot, reste);
        allocations.push({ numLot: '', fournisseur: '', quantite: arrondiInv(pris) });
        reste = arrondiInv(reste - pris);
    }
    for (const lot of invLotsOrdreUsage(item)) {
        if (reste <= 0) break;
        const pris = Math.min(Number(lot.quantite), reste);
        lot.quantite = arrondiInv(Number(lot.quantite) - pris);
        reste = arrondiInv(reste - pris);
        const prix = prixAchatDansUnite(item, item.unite, lot);
        allocations.push({ numLot: lot.numLot, fournisseur: lot.fournisseur || '', quantite: arrondiInv(pris), ...(estMontantConnu(prix) ? { prixUnitaire: prix } : {}) });
    }
    if (reste > 0) allocations.push({ numLot: '', fournisseur: '', quantite: reste });
    return allocations;
};

// Consommation prévue des commandes à produire (même déduction qu'une production
// confirmée : recette × litres × perte, bouteilles vides, bouchons + marge),
// simulée sur une copie de l'inventaire. N'écrit rien.
const computeInventairePrevu = () => {
    const aromes = DB.get('aromes') || [];
    const formats = DB.get('formats') || [];
    const parArome = new Map();
    buildStockOverview().cells.forEach(cell => {
        if (cell.aProduire <= 0) return;
        const [rowKey, colKey] = cell.key.split('|');
        const arome = aromes.find(a => normalizeName(a.nom) === rowKey);
        const format = formats.find(f => normalizeName(f.nom) === colKey);
        if (!arome || !format) return;
        const e = parArome.get(arome.nom) || { produced: [], litres: 0 };
        e.produced.push({ format, quantite: cell.aProduire });
        e.litres += cell.aProduire * (Number(format.contenanceCl) || 0) / 100;
        parArome.set(arome.nom, e);
    });

    const origine = DB.get('inventaire') || [];
    const copie = JSON.parse(JSON.stringify(origine));
    const alertes = new Set();
    parArome.forEach((e, nom) => {
        const { warnings, conversionErrors } = deduireInventaireProduction(copie, nom, e.produced, e.litres);
        warnings.forEach(w => {
            if (w.startsWith('Stock insuffisant')) return;
            alertes.add(w.startsWith('Recette introuvable')
                ? `${nom} : pas de recette, les ingrédients des ${invFmtNombre(e.litres)} L à produire ne sont pas comptés`
                : w);
        });
        conversionErrors.forEach(w => alertes.add(w));
    });

    const besoin = new Map();
    origine.forEach(item => {
        const apres = copie.find(c => c.id === item.id);
        const b = arrondiInv((Number(item.quantite) || 0) - (Number(apres?.quantite) || 0));
        if (b > 0) besoin.set(item.id, b);
    });
    return { besoin, alertes: [...alertes] };
};

// Quantité à commander : de quoi rester au-dessus du seuil après la production
// prévue (ou de quoi la couvrir sans seuil), arrondie au-dessus — 0,1 kg ou L,
// une unité sinon
const invACommander = (item, besoin) => {
    const apres = (Number(item.quantite) || 0) - besoin;
    const seuil = Number(item.seuilAlerte) || 0;
    const brut = seuil > 0 ? seuil - apres : -apres;
    if (brut <= 1e-9) return 0;
    const pas = ['kg', 'L'].includes(normalizeUnit(item.unite)) ? 0.1 : 1;
    return arrondiInv(Math.ceil(arrondiInv(brut / pas)) * pas);
};

const INV_ICON_LEAF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>';
const INV_ICON_BOX = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>';

// Résumé des lots d'un ingrédient (ligne de la liste)
const invLotsResumeHtml = (item) => {
    const lots = invLotsOrdreUsage(item);
    const sansLot = invSansLot(item);
    if (lots.length === 0) {
        return sansLot > 0
            ? `<div class="inv-lots is-warning">${escapeHtml(invFmtQte(sansLot, item.unite))} sans n° de lot</div>`
            : '';
    }
    const prochain = lots[0];
    const now = dateOnly(new Date()).getTime();
    const perime = lots.find(l => l.dateLimite && invDateTri(l.dateLimite) < now);
    const proche = !perime && lots.find(l => l.dateLimite && invDateTri(l.dateLimite) - now <= 30 * 86400000);
    return `<div class="inv-lots">
        ${lots.length} lot${lots.length > 1 ? 's' : ''} · prochain utilisé :
        ${sansLot > 0
            ? `sans n° de lot (${escapeHtml(invFmtQte(sansLot, item.unite))})`
            : `<code class="inv-lot-num">${escapeHtml(prochain.numLot)}</code> ${escapeHtml(invFmtQte(prochain.quantite, item.unite))}${prochain.dateLimite ? `, limite ${escapeHtml(formatDate(prochain.dateLimite))}` : ''}`}
        ${perime ? `<span class="inv-lots-alert is-danger">lot ${escapeHtml(perime.numLot)} : date limite dépassée</span>` : ''}
        ${proche ? `<span class="inv-lots-alert">lot ${escapeHtml(proche.numLot)} : limite le ${escapeHtml(formatDate(proche.dateLimite))}</span>` : ''}
    </div>`;
};

const invRowHtml = (item, besoin = 0) => {
    const id = escapeHtml(item.id);
    const stock = Number(item.quantite) || 0;
    const apres = arrondiInv(stock - besoin);
    const seuil = Number(item.seuilAlerte) || 0;
    const equipement = item.categorie === 'equipement';
    const prix = prixAchatDansUnite(item, item.unite);
    const aCommander = equipement ? 0 : invACommander(item, besoin);
    const etat = !equipement && apres < 0 ? 'manque' : aCommander > 0 ? 'commander' : 'ok';
    const chip = etat === 'manque' ? `<span class="badge badge-expire">manque ${escapeHtml(invFmtQte(-apres, item.unite))}</span>`
        : etat === 'commander' ? '<span class="badge badge-bientot">à commander</span>' : '';
    const echelle = Math.max(stock, seuil * 2, besoin, 1);
    const pct = (v) => safeNumAttr(Math.round(Math.min(100, Math.max(0, v / echelle * 100)) * 10) / 10);
    const suivi = isLotSuiviArticle(item);
    const action = suivi
        ? `<button type="button" class="btn btn-sm btn-secondary" data-click="inventaire-lots" data-id="${id}">Lots</button>`
        : `<button type="button" class="btn btn-sm btn-secondary" data-click="inventaire-ajuster" data-id="${id}">Ajuster</button>`;
    return `
        <li class="inv-row inv-row--${etat}">
            <div class="inv-row-main">
                <div class="inv-row-name">${escapeHtml(item.nom)} ${chip}</div>
                ${equipement ? '' : `<button type="button" class="btn btn-sm btn-ghost" data-click="inventaire-prix" data-id="${id}">
                    ${estMontantConnu(prix) ? escapeHtml(`${formatChfUnitaire(prix)} / ${displayUnit(item.unite)}`) : 'Saisir le prix d’achat'}
                </button>`}
                ${equipement ? '' : `<div class="inv-bar" aria-hidden="true"><span style="width:${pct(stock)}%"></span>${seuil > 0 ? `<i style="left:${pct(seuil)}%"></i>` : ''}</div>`}
                ${suivi ? invLotsResumeHtml(item) : ''}
            </div>
            <div class="inv-row-qty">
                <strong>${escapeHtml(invFmtQte(stock, item.unite))}</strong>
                ${seuil > 0 ? `<span>seuil ${escapeHtml(invFmtNombre(seuil))}</span>` : ''}
            </div>
            <div class="inv-row-prevu">
                ${besoin > 0
                    ? `<span>prévu −${escapeHtml(invFmtNombre(besoin))}</span><span class="${etat !== 'ok' ? 'is-low' : ''}">après ${escapeHtml(invFmtNombre(apres))}</span>`
                    : (equipement ? '' : '<span class="text-muted">—</span>')}
            </div>
            <div class="inv-row-actions">
                ${action}
                ${rowMenuHtml(item.nom, `
                    ${suivi ? `<button type="button" data-click="inventaire-reception" data-id="${id}">Réception</button>` : ''}
                    <button type="button" data-click="show-inventaire-modal" data-type="${escapeHtml(item.categorie || 'consommable')}" data-id="${id}">Modifier l'article</button>
                    <button type="button" class="is-danger" data-click="delete-inventaire-item" data-id="${id}">Supprimer</button>`)}
            </div>
        </li>`;
};

// Inventaire
const renderInventaire = () => {
    const items = ensureContainerConsommables(DB.get('inventaire') || []);
    const query = (DB.getFilter('inventaire_search') || '').toString();
    const q = query.trim();
    const { besoin, alertes } = items.length ? computeInventairePrevu() : { besoin: new Map(), alertes: [] };
    const parNom = (a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr');
    const visible = (item) => includesText(`${item.nom} ${item.unite || ''} ${(item.lots || []).map(l => `${l.numLot} ${l.fournisseur || ''}`).join(' ')}`, q);

    const consommables = items.filter(i => i.categorie !== 'equipement');
    const ingredients = consommables.filter(isIngredientArticle).sort(parNom);
    const contenants = consommables.filter(i => !isIngredientArticle(i)).sort(parNom);
    const equipement = items.filter(i => i.categorie === 'equipement').sort(parNom);

    const aCommander = consommables
        .map(item => {
            const b = besoin.get(item.id) || 0;
            return { item, b, qte: invACommander(item, b), apres: arrondiInv((Number(item.quantite) || 0) - b) };
        })
        .filter(x => x.qte > 0)
        .sort((x, y) => (x.apres < 0 ? 0 : 1) - (y.apres < 0 ? 0 : 1) || parNom(x.item, y.item));

    const commanderHtml = (aCommander.length || alertes.length) ? `
        <section class="stock-section" aria-labelledby="invCommanderTitle">
            <div class="stock-section-head">
                <h2 class="stock-section-title" id="invCommanderTitle">À commander</h2>
                <span class="stock-section-meta">d'après les commandes à produire et les seuils</span>
            </div>
            <div class="stock-group inv-order">
                <ul class="inv-order-list">
                    ${aCommander.map(({ item, b, qte, apres }) => {
                        const seuil = Number(item.seuilAlerte) || 0;
                        const detail = [
                            apres < 0 ? `manque ${invFmtQte(-apres, item.unite)} pour la production prévue`
                                : b > 0 ? `${invFmtQte(apres, item.unite)} après la production prévue` : `${invFmtQte(apres, item.unite)} en stock`,
                            seuil > 0 ? `seuil ${invFmtNombre(seuil)}` : ''
                        ].filter(Boolean).join(', ');
                        return `<li class="inv-order-row${apres < 0 ? ' is-danger' : ''}">
                            <span class="inv-order-icon">${isIngredientArticle(item) ? INV_ICON_LEAF : INV_ICON_BOX}</span>
                            <span class="inv-order-main"><span class="inv-order-name">${escapeHtml(item.nom)}</span><span class="inv-order-sub">${escapeHtml(detail)}</span></span>
                            <strong class="inv-order-qty">${escapeHtml(invFmtQte(qte, item.unite))}</strong>
                        </li>`;
                    }).join('')}
                    ${alertes.map(a => `<li class="inv-order-row is-warning">
                        <span class="inv-order-icon">${dashIcon('attention')}</span>
                        <span class="inv-order-main"><span class="inv-order-sub">${escapeHtml(a)}</span></span>
                        ${/recette/i.test(a) ? '<a href="#parametres" class="btn btn-sm btn-secondary">Paramètres</a>' : ''}
                    </li>`).join('')}
                </ul>
                ${aCommander.length ? `<div class="inv-order-foot"><button type="button" class="btn btn-sm btn-secondary" data-click="inventaire-copier-commande">Copier la liste</button></div>` : ''}
            </div>
        </section>` : '';

    const section = (id, titre, meta, list, opts = {}) => {
        const rows = list.filter(visible);
        if (rows.length === 0 && (q || list.length === 0)) return '';
        return `
            <section class="stock-section" aria-labelledby="${id}">
                <div class="stock-section-head">
                    <h2 class="stock-section-title" id="${id}">${titre}</h2>
                    <span class="stock-section-meta">${escapeHtml(meta)}</span>
                </div>
                <div class="stock-group"><ul class="inv-list">${rows.map(item => invRowHtml(item, opts.sansPrevu ? 0 : (besoin.get(item.id) || 0))).join('')}</ul></div>
            </section>`;
    };

    const equipVisibles = equipement.filter(visible);
    const equipOpen = q ? equipVisibles.length > 0 : DB.getFilter('inventaire_equip') === 'open';
    const equipementHtml = equipement.length ? `
        <details class="inv-equip"${equipOpen ? ' open' : ''} ontoggle="if (!${q ? 'true' : 'false'}) DB.setFilter('inventaire_equip', this.open ? 'open' : '')">
            <summary class="inv-equip-summary">Équipement <span class="stock-section-meta">${equipement.length} article${equipement.length > 1 ? 's' : ''}</span></summary>
            <div class="stock-group"><ul class="inv-list">${equipVisibles.map(item => invRowHtml(item, 0)).join('') || '<li class="stock-lot-empty">Aucun équipement ne correspond à la recherche</li>'}</ul></div>
        </details>` : '';

    const vide = items.length === 0;
    const sections = [
        section('invIngredientsTitle', 'Ingrédients', `${ingredients.length} article${ingredients.length > 1 ? 's' : ''} · suivis par lot`, ingredients),
        section('invContenantsTitle', 'Contenants', 'bouteilles, bouchons, étiquettes', contenants)
    ].join('');

    const html = `
        ${pageToolbar(`
            <button type="button" class="btn btn-secondary" data-click="show-inventaire-modal" data-type="consommable">+ Article</button>
            <button type="button" class="btn btn-primary" data-click="inventaire-reception">Réception</button>`,
            vide ? '' : `<div class="stock-search inv-search">
                <svg class="stock-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="search" id="filterInventaireSearch" placeholder="Article, n° de lot, fournisseur…" aria-label="Rechercher un article" value="${escapeHtml(query)}" data-live-search="inventaire_search">
            </div>`)}
        ${vide ? `
            <div class="empty-state">
                <p>L'inventaire est vide. Créez les articles de base (ingrédients, bouteilles, bouchons, étiquettes) ou ajoutez-les un par un.</p>
                <button type="button" class="btn btn-primary" data-click="inventaire-seed">Créer les articles de base</button>
            </div>` : `
            ${q ? '' : commanderHtml}
            ${sections || (q ? `<div class="commande-empty">Aucun article ne correspond à « ${escapeHtml(q)} »</div>` : '')}
            ${equipementHtml}
            ${q ? '' : `<button type="button" class="btn btn-ghost inv-add-equip" data-click="show-inventaire-modal" data-type="equipement">+ Équipement</button>`}`}
    `;

    safeRender(html);
};

// Liste « À commander » copiée pour un fournisseur (repli : fenêtre à copier)
const copierListeACommander = () => {
    const items = DB.get('inventaire') || [];
    const { besoin } = computeInventairePrevu();
    const lignes = items
        .filter(i => i.categorie !== 'equipement')
        .map(item => ({ item, qte: invACommander(item, besoin.get(item.id) || 0) }))
        .filter(x => x.qte > 0)
        .sort((a, b) => String(a.item.nom).localeCompare(String(b.item.nom), 'fr'))
        .map(({ item, qte }) => `${item.nom} : ${invFmtQte(qte, item.unite)}`);
    if (lignes.length === 0) {
        showToast('Rien à commander', 'warning');
        return;
    }
    const texte = `À commander (${formatDate(new Date())})\n${lignes.join('\n')}`;
    const fenetre = () => modal.show('Liste à commander', `
        <textarea class="inv-copy-text" rows="${Math.min(12, lignes.length + 2)}" readonly>${escapeHtml(texte)}</textarea>`,
        '<button class="btn btn-secondary" data-click="close-modal">Fermer</button>');
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(texte)
            .then(() => showToast(`Liste copiée (${lignes.length} article${lignes.length > 1 ? 's' : ''})`))
            .catch(fenetre);
    } else {
        fenetre();
    }
};

// Ajuster un article sans lot (contenant, équipement, eau) : réception,
// recomptage ou sortie, avec aperçu du résultat
const INV_MODES = {
    add: { label: 'Réception', champ: 'Quantité reçue' },
    set: { label: 'Recomptage', champ: 'Quantité comptée' },
    sub: { label: 'Sortie', champ: 'Quantité sortie' }
};

const ouvrirAjusterInventaire = (id) => {
    const item = (DB.get('inventaire') || []).find(i => i.id === id);
    if (!item) return;
    if (isLotSuiviArticle(item)) showInventaireLotsModal(id);
    else showInventaireAjusterModal(id);
};

const showInventaireAjusterModal = (id, mode = 'add') => {
    const item = (DB.get('inventaire') || []).find(i => i.id === id);
    if (!item) return;
    const unite = displayUnit(item.unite || '');
    const seuil = Number(item.seuilAlerte) || 0;
    modal.show(item.nom, `
        <form id="invAjusterForm" data-stock="${safeNumAttr(item.quantite)}" data-unite="${escapeHtml(unite)}">
            <p class="text-muted" style="margin: 0 0 12px;">${escapeHtml(invFmtQte(item.quantite, unite))} en stock${seuil > 0 ? ` · seuil ${escapeHtml(invFmtQte(seuil, unite))}` : ''}</p>
            <input type="hidden" name="mode" value="${mode}">
            <div class="segmented-filter" role="group" aria-label="Type d'ajustement">
                ${Object.entries(INV_MODES).map(([m, d]) => `<button type="button" class="segment${m === mode ? ' active' : ''}" data-click="inventaire-ajuster-mode" data-mode="${m}" aria-pressed="${m === mode}">${d.label}</button>`).join('')}
            </div>
            <div class="form-group" style="margin-top: 14px;">
                <label for="invAjQte" id="invAjLabel">${INV_MODES[mode].champ} (${escapeHtml(unite)})</label>
                <input type="number" id="invAjQte" name="quantite" min="0" step="any" inputmode="decimal" required oninput="majApercuAjusterInventaire()">
            </div>
            <p id="invAjApercu" class="inv-apercu" aria-live="polite"></p>
        </form>
    `, `
        <button class="btn btn-secondary" data-click="close-modal">Annuler</button>
        <button class="btn btn-primary" data-click="inventaire-ajuster-save" data-id="${escapeHtml(id)}">Enregistrer</button>
    `);
    majApercuAjusterInventaire();
    document.getElementById('invAjQte')?.focus();
};

const invCalculAjustement = (stock, mode, v) => (mode === 'add' ? stock + v : mode === 'sub' ? Math.max(0, stock - v) : v);

const majApercuAjusterInventaire = () => {
    const form = document.getElementById('invAjusterForm');
    const out = document.getElementById('invAjApercu');
    if (!form || !out) return;
    const stock = Number(form.dataset.stock) || 0;
    const unite = form.dataset.unite || '';
    const v = parseFloat(form.querySelector('[name="quantite"]').value);
    const mode = form.querySelector('[name="mode"]').value;
    out.innerHTML = Number.isFinite(v) && v >= 0
        ? `${escapeHtml(invFmtQte(stock, unite))} → <strong>${escapeHtml(invFmtQte(invCalculAjustement(stock, mode, v), unite))}</strong>`
        : '';
};

const choisirModeAjusterInventaire = (mode) => {
    const form = document.getElementById('invAjusterForm');
    if (!form || !INV_MODES[mode]) return;
    form.querySelector('[name="mode"]').value = mode;
    form.querySelectorAll('[data-click="inventaire-ajuster-mode"]').forEach(b => {
        const actif = b.getAttribute('data-mode') === mode;
        b.classList.toggle('active', actif);
        b.setAttribute('aria-pressed', String(actif));
    });
    const label = document.getElementById('invAjLabel');
    if (label) label.textContent = `${INV_MODES[mode].champ} (${form.dataset.unite || ''})`;
    majApercuAjusterInventaire();
    document.getElementById('invAjQte')?.focus();
};

const saveAjusterInventaire = (id) => {
    const form = document.getElementById('invAjusterForm');
    const mode = form?.querySelector('[name="mode"]')?.value || 'add';
    const v = parseFloat(form?.querySelector('[name="quantite"]')?.value);
    if (!Number.isFinite(v) || v < 0 || (mode !== 'set' && v === 0)) {
        showToast('Saisissez une quantité valide', 'error');
        return;
    }
    const items = DB.get('inventaire') || [];
    const item = items.find(i => i.id === id);
    if (!item) {
        modal.hide();
        showToast('Article introuvable : il a peut-être été supprimé sur un autre appareil', 'error');
        renderCurrentView();
        return;
    }
    const avant = Number(item.quantite) || 0;
    item.quantite = arrondiInv(invCalculAjustement(avant, mode, v));
    DB.set('inventaire', items);
    modal.hide();
    showToast(`${item.nom} : ${invFmtQte(avant, item.unite)} → ${invFmtQte(item.quantite, item.unite)}`);
    renderCurrentView();
};

// Fenêtre d'un ingrédient : lots en stock dans l'ordre d'utilisation, stock sans
// n° de lot, lots épuisés ou retirés avec les lots de bouteilles qui les ont utilisés
const showInventaireLotsModal = (id) => {
    const item = (DB.get('inventaire') || []).find(i => i.id === id);
    if (!item) return;
    const unite = displayUnit(item.unite || '');
    const seuil = Number(item.seuilAlerte) || 0;
    const besoin = computeInventairePrevu().besoin.get(id) || 0;
    const sansLot = invSansLot(item);
    const enStock = invLotsOrdreUsage(item);
    const passes = (item.lots || []).filter(l => !(Number(l.quantite) > 0))
        .sort((a, b) => invDateTri(b.dateRetrait || b.dateReception) - invDateTri(a.dateRetrait || a.dateReception));
    const usages = getUsagesLotIngredient(item.nom);
    const now = dateOnly(new Date()).getTime();
    const idAttr = escapeHtml(id);

    const lotHtml = (lot, epuise) => {
        const u = usages.get(normLotFournisseur(lot.numLot)) || [];
        const limite = lot.dateLimite ? invDateTri(lot.dateLimite) : null;
        const prix = prixAchatDansUnite(item, unite, lot);
        const meta = [
            lot.dateReception ? `reçu le ${formatDate(lot.dateReception)}` : '',
            lot.fournisseur || '',
            lot.dateLimite ? `limite ${formatDate(lot.dateLimite)}` : '',
            lot.dateRetrait ? `retiré le ${formatDate(lot.dateRetrait)}` : '',
            estMontantConnu(prix) ? `${formatChfUnitaire(prix)} / ${unite}${lot.prixAchat ? '' : ' (référence)'}` : ''
        ].filter(Boolean).join(' · ');
        return `<li class="inv-lot${epuise ? ' is-epuise' : ''}">
            <div class="inv-lot-head">
                <code class="inv-lot-num">${escapeHtml(lot.numLot)}</code>
                <strong>${epuise ? (lot.dateRetrait ? 'retiré' : 'épuisé') : escapeHtml(invFmtQte(lot.quantite, unite))}</strong>
            </div>
            <div class="inv-lot-meta">${escapeHtml(meta)}${!epuise && limite !== null && limite < now ? ' <span class="inv-lots-alert is-danger">date limite dépassée</span>' : ''}</div>
            ${u.length ? `<div class="inv-lot-meta">Utilisé dans ${u.map(x => `<button type="button" class="hist-entry-lot" data-click="show-lot-rappel" data-num="${escapeHtml(x.numLot)}">#${escapeHtml(formatLotNumero(x.numLot))}</button>`).join(' ')}</div>` : ''}
            <div class="inv-lot-actions">
                ${epuise ? '' : `<button type="button" class="btn btn-sm btn-ghost" data-click="inventaire-lot-corriger" data-id="${idAttr}" data-lot="${escapeHtml(lot.id)}">Corriger</button>
                <button type="button" class="btn btn-sm btn-ghost btn-ghost-danger" data-click="inventaire-lot-retirer" data-id="${idAttr}" data-lot="${escapeHtml(lot.id)}">Retirer</button>`}
                ${u.length ? `<button type="button" class="btn btn-sm btn-ghost" data-click="inventaire-rappel-fournisseur" data-id="${idAttr}" data-lot="${escapeHtml(lot.numLot)}">Rappel fournisseur</button>` : ''}
            </div>
        </li>`;
    };

    modal.show(item.nom, `
        <div class="inv-lots-modal">
            <p class="text-muted" style="margin: 0 0 12px;">${escapeHtml(invFmtQte(item.quantite, unite))} en stock${seuil > 0 ? ` · seuil ${escapeHtml(invFmtQte(seuil, unite))}` : ''}${besoin > 0 ? ` · prévu −${escapeHtml(invFmtQte(besoin, unite))} pour les commandes` : ''}</p>
            <h4 class="inv-lots-title">En stock, dans l'ordre d'utilisation</h4>
            <ul class="inv-lot-list">
                ${sansLot > 0 ? `<li class="inv-lot is-sans">
                    <div class="inv-lot-head"><span class="inv-lot-num is-sans">sans n° de lot</span><strong>${escapeHtml(invFmtQte(sansLot, unite))}</strong></div>
                    <div class="inv-lot-meta">Stock d'avant le suivi des lots, utilisé en premier</div>
                    <div class="inv-lot-actions"><button type="button" class="btn btn-sm btn-ghost" data-click="inventaire-lot-corriger" data-id="${idAttr}" data-lot="">Corriger</button></div>
                </li>` : ''}
                ${enStock.map(l => lotHtml(l, false)).join('')}
                ${sansLot <= 0 && enStock.length === 0 ? '<li class="inv-lot-empty">Aucun stock. Enregistrez une réception avec le n° de lot du fournisseur.</li>' : ''}
            </ul>
            ${passes.length ? `
                <h4 class="inv-lots-title">Lots épuisés ou retirés</h4>
                <ul class="inv-lot-list">${passes.map(l => lotHtml(l, true)).join('')}</ul>` : ''}
        </div>
    `, `
        <button class="btn btn-secondary" data-click="close-modal">Fermer</button>
        <button class="btn btn-primary" data-click="inventaire-reception" data-id="${idAttr}" data-retour="lots">Réception</button>
    `, 'large');
};

// Réception d'un article ; pour un ingrédient suivi, le n° de lot du fournisseur
// est obligatoire (fournisseur et date limite facultatifs). `retour` : 'lots' pour
// revenir à la fenêtre de l'ingrédient.
const showReceptionModal = (itemId = '', retour = '', fournisseurPrecedent = '') => {
    const items = (DB.get('inventaire') || []).filter(i => i.categorie !== 'equipement');
    if (items.length === 0) {
        showToast('Ajoutez d\'abord un article à l\'inventaire', 'warning');
        return;
    }
    const parNom = (a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr');
    const option = (i) => `<option value="${escapeHtml(i.id)}"${i.id === itemId ? ' selected' : ''}>${escapeHtml(i.nom)} (${escapeHtml(displayUnit(i.unite || ''))})</option>`;
    const fournisseurs = [...new Set((DB.get('inventaire') || []).flatMap(i => (i.lots || []).map(l => l.fournisseur).filter(Boolean)))].sort((a, b) => a.localeCompare(b, 'fr'));

    modal.show('Réception', `
        <form id="receptionForm" data-retour="${escapeHtml(retour)}">
            <div class="form-group">
                <label for="recArticle">Article</label>
                <select id="recArticle" name="article" required onchange="majChampsReception()">
                    <option value="">Choisir un article…</option>
                    <optgroup label="Ingrédients">${items.filter(isIngredientArticle).sort(parNom).map(option).join('')}</optgroup>
                    <optgroup label="Contenants">${items.filter(i => !isIngredientArticle(i)).sort(parNom).map(option).join('')}</optgroup>
                </select>
            </div>
            <div class="form-group">
                <label for="recQte" id="recQteLabel">Quantité reçue</label>
                <input type="number" id="recQte" name="quantite" min="0" step="any" inputmode="decimal" required>
            </div>
            <div id="recLotFields">
                <div class="form-group">
                    <label for="recLot">N° de lot du fournisseur</label>
                    <input type="text" id="recLot" name="numLot" maxlength="60" autocomplete="off" placeholder="Ex. H-2026-044">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label for="recFournisseur">Fournisseur (facultatif)</label>
                        <input type="text" id="recFournisseur" name="fournisseur" maxlength="80" list="recFournisseurs" value="${escapeHtml(fournisseurPrecedent)}">
                        <datalist id="recFournisseurs">${fournisseurs.map(f => `<option value="${escapeHtml(f)}">`).join('')}</datalist>
                    </div>
                    <div class="form-group">
                        <label for="recLimite">Date limite (facultatif)</label>
                        <input type="date" id="recLimite" name="dateLimite">
                    </div>
                </div>
                <div class="form-group">
                    <label for="recPrix" id="recPrixLabel">Prix d’achat du lot en CHF (facultatif)</label>
                    <input type="number" id="recPrix" name="prixAchat" min="0" step="any" inputmode="decimal" aria-describedby="recPrixAide">
                    <small class="text-muted" id="recPrixAide">Ce prix s’applique à tout le lot fournisseur. Laissez vide pour conserver son prix ou utiliser le prix de référence.</small>
                </div>
            </div>
        </form>
    `, `
        <button class="btn btn-secondary" data-click="close-modal">Annuler</button>
        ${retour ? '' : '<button class="btn btn-secondary" data-click="inventaire-reception-save" data-suite="1">Enregistrer et continuer</button>'}
        <button class="btn btn-primary" data-click="inventaire-reception-save">Enregistrer</button>
    `);
    majChampsReception();
    document.getElementById(itemId ? 'recQte' : 'recArticle')?.focus();
};

const majChampsReception = () => {
    const id = document.getElementById('recArticle')?.value || '';
    const item = (DB.get('inventaire') || []).find(i => i.id === id);
    const suivi = isLotSuiviArticle(item);
    const bloc = document.getElementById('recLotFields');
    if (bloc) bloc.hidden = !suivi;
    const lot = document.getElementById('recLot');
    if (lot) lot.required = suivi;
    const label = document.getElementById('recQteLabel');
    if (label) label.textContent = item ? `Quantité reçue (${displayUnit(item.unite || '')})` : 'Quantité reçue';
    const prix = document.getElementById('recPrix');
    prix.value = '';
    prix.disabled = !suivi;
    prix.dataset.unite = suivi ? displayUnit(item.unite) : '';
    document.getElementById('recPrixLabel').textContent = suivi ? `Prix d’achat du lot (CHF / ${prix.dataset.unite}, facultatif)` : '';
};

const saveReception = (suite = false) => {
    const form = document.getElementById('receptionForm');
    if (!form?.reportValidity()) return;
    const get = (n) => (form.querySelector(`[name="${n}"]`)?.value || '').trim();
    const itemId = get('article');
    const qte = parseFloat(get('quantite'));
    const retour = form.dataset.retour || '';
    if (!Number.isFinite(qte) || qte <= 0) {
        showToast('Saisissez une quantité reçue', 'error');
        return;
    }
    const items = DB.get('inventaire') || [];
    const item = items.find(i => i.id === itemId);
    if (!item) {
        showToast('Article introuvable', 'error');
        return;
    }
    const suivi = isLotSuiviArticle(item);
    const prixSaisi = suivi ? get('prixAchat') : '';
    const unite = displayUnit(item.unite);
    if (prixSaisi !== '' && document.getElementById('recPrix').dataset.unite !== unite) {
        showToast('L’unité de l’article a changé. Rouvrez la réception.', 'error');
        return;
    }
    const prixAchat = prixSaisi === '' ? null : { montant: Number(prixSaisi), unite };
    const numLot = get('numLot');
    const fournisseur = get('fournisseur');
    const dateLimite = get('dateLimite');
    if (suivi && !numLot) {
        showToast('Le n° de lot du fournisseur est obligatoire pour un ingrédient', 'error');
        return;
    }
    item.quantite = arrondiInv((Number(item.quantite) || 0) + qte);
    if (suivi) {
        item.lots = item.lots || [];
        // Même n° de lot reçu une seconde fois : on complète le lot existant
        const existant = item.lots.find(l => normLotFournisseur(l.numLot) === normLotFournisseur(numLot));
        if (existant) {
            existant.quantite = arrondiInv((Number(existant.quantite) || 0) + qte);
            existant.quantiteRecue = arrondiInv((Number(existant.quantiteRecue) || 0) + qte);
            if (fournisseur && !existant.fournisseur) existant.fournisseur = fournisseur;
            if (dateLimite && !existant.dateLimite) existant.dateLimite = dateLimite;
            if (prixAchat) existant.prixAchat = prixAchat;
            delete existant.dateRetrait;
        } else {
            item.lots.push({
                id: generateId(), numLot, quantite: arrondiInv(qte), quantiteRecue: arrondiInv(qte),
                dateReception: getLocalDateISOString(),
                ...(fournisseur ? { fournisseur } : {}),
                ...(dateLimite ? { dateLimite } : {}),
                ...(prixAchat ? { prixAchat } : {})
            });
        }
    }
    DB.set('inventaire', items);
    showToast(`Réception : +${invFmtQte(qte, item.unite)} ${item.nom}${suivi ? ` (lot ${numLot})` : ''}`);
    if (retour === 'lots') {
        showInventaireLotsModal(item.id);
    } else if (suite) {
        showReceptionModal('', '', fournisseur);
    } else {
        modal.hide();
    }
    if (window.location.hash.startsWith('#inventaire')) renderInventaire();
};

// Corriger la quantité restante d'un lot (ou du stock sans n° de lot : lotId vide)
const showCorrigerLotModal = (itemId, lotId) => {
    const item = (DB.get('inventaire') || []).find(i => i.id === itemId);
    if (!item) return;
    const lot = lotId ? (item.lots || []).find(l => l.id === lotId) : null;
    if (lotId && !lot) return;
    const actuel = lot ? Number(lot.quantite) || 0 : invSansLot(item);
    const unite = displayUnit(item.unite || '');
    modal.show(`Corriger ${lot ? `le lot ${lot.numLot}` : 'le stock sans n° de lot'}`, `
        <form id="corrigerLotForm" data-unite="${escapeHtml(unite)}">
            <p class="text-muted" style="margin: 0 0 12px;">${escapeHtml(item.nom)} · actuellement ${escapeHtml(invFmtQte(actuel, unite))}</p>
            <div class="form-group">
                <label for="corrLotQte">Quantité restante comptée (${escapeHtml(unite)})</label>
                <input type="number" id="corrLotQte" name="quantite" min="0" step="any" inputmode="decimal" value="${safeNumAttr(actuel)}" required>
            </div>
            ${lot ? `${invChampPrixAchat('corrLotPrix', unite, lot.prixAchat ? prixAchatDansUnite(item, unite, lot) : null)}
                <p class="text-muted">Laissez le prix vide pour utiliser le prix de référence de l’article.</p>` : ''}
        </form>
    `, `
        <button class="btn btn-secondary" data-click="inventaire-lots" data-id="${escapeHtml(itemId)}">Retour</button>
        <button class="btn btn-primary" data-click="inventaire-lot-corriger-save" data-id="${escapeHtml(itemId)}" data-lot="${escapeHtml(lotId || '')}">Enregistrer</button>
    `);
    document.getElementById('corrLotQte')?.select();
};

const saveCorrigerLot = (itemId, lotId) => {
    const form = document.getElementById('corrigerLotForm');
    if (!form?.reportValidity()) return;
    const v = parseFloat(document.getElementById('corrLotQte')?.value);
    if (!Number.isFinite(v) || v < 0) {
        showToast('Saisissez une quantité valide', 'error');
        return;
    }
    const items = DB.get('inventaire') || [];
    const item = items.find(i => i.id === itemId);
    const lot = lotId ? (item?.lots || []).find(l => l.id === lotId) : null;
    if (!item || (lotId && !lot)) {
        modal.hide();
        showToast('Lot introuvable : il a peut-être changé sur un autre appareil', 'error');
        renderCurrentView();
        return;
    }
    if (displayUnit(item.unite) !== form.dataset.unite) {
        showToast('L’unité de l’article a changé. Rouvrez la correction.', 'error');
        return;
    }
    const delta = lot ? v - (Number(lot.quantite) || 0) : v - invSansLot(item);
    if (lot) {
        lot.quantite = arrondiInv(v);
        if (v > 0) delete lot.dateRetrait;
        const valeur = document.getElementById('corrLotPrix').value;
        if (valeur === '') delete lot.prixAchat;
        else lot.prixAchat = { montant: Number(valeur), unite: form.dataset.unite };
    }
    item.quantite = arrondiInv(Math.max(0, (Number(item.quantite) || 0) + delta));
    DB.set('inventaire', items);
    showToast(`${item.nom}${lot ? ` · lot ${lot.numLot}` : ''} : ${invFmtQte(v, item.unite)}`);
    showInventaireLotsModal(itemId);
    if (window.location.hash.startsWith('#inventaire')) renderInventaire();
};

// Retirer un lot du stock (périmé, perdu) : il reste listé comme « retiré »
const retirerLotIngredient = (itemId, lotId) => {
    const avant = (DB.get('inventaire') || []).find(i => i.id === itemId);
    const lotAvant = (avant?.lots || []).find(l => l.id === lotId);
    if (!lotAvant) return;
    confirmDialog(`Retirer le lot ${lotAvant.numLot} (${invFmtQte(lotAvant.quantite, avant.unite)}) du stock ? À utiliser pour un lot périmé, perdu ou jeté.`, { danger: true, confirmLabel: 'Retirer' }).then(ok => {
        // Relecture après la confirmation (DB.set réécrit la table entière)
        const items = DB.get('inventaire') || [];
        const item = items.find(i => i.id === itemId);
        const lot = (item?.lots || []).find(l => l.id === lotId);
        if (ok && item && lot) {
            const q = Number(lot.quantite) || 0;
            lot.quantite = 0;
            lot.dateRetrait = getLocalDateISOString();
            item.quantite = arrondiInv(Math.max(0, (Number(item.quantite) || 0) - q));
            DB.set('inventaire', items);
            showToast(`Lot ${lot.numLot} retiré du stock`);
            if (window.location.hash.startsWith('#inventaire')) renderInventaire();
        }
        if (item) showInventaireLotsModal(itemId);
    });
};

// Lots de bouteilles produits avec un lot d'ingrédient : entrées PROD- de
// l'historique, une seule fois par production (productionId)
const getUsagesLotIngredient = (articleNom, numLot = null) => {
    const cible = normalizeName(articleNom);
    const parLot = new Map();
    const vues = new Set();
    (DB.get('history') || []).forEach(h => {
        if (getHistoryType(h) !== 'prod' || !Array.isArray(h.ingredients)) return;
        h.ingredients.forEach(ing => {
            if (normalizeName(ing.article) !== cible || !ing.numLot) return;
            const cle = normLotFournisseur(ing.numLot);
            if (numLot !== null && cle !== normLotFournisseur(numLot)) return;
            if (!parLot.has(cle)) parLot.set(cle, []);
            const liste = parLot.get(cle);
            let u = liste.find(x => normLotNumero(x.numLot) === normLotNumero(h.numLot || h.lotId));
            if (!u) {
                u = { numLot: String(h.numLot || h.lotId), arome: h.arome || '', dateProduction: h.productionDate || '', formats: new Set(), quantite: 0, unite: ing.unite || '' };
                liste.push(u);
            }
            if (h.format) u.formats.add(h.format);
            const vue = `${cle}|${h.productionId || h.id}|${ing.numLot}`;
            if (!vues.has(vue)) {
                vues.add(vue);
                u.quantite = arrondiInv(u.quantite + (Number(ing.quantite) || 0));
            }
        });
    });
    parLot.forEach(liste => liste.sort((a, b) => String(a.dateProduction).localeCompare(String(b.dateProduction))));
    return parLot;
};

// Rappel fournisseur : lots de bouteilles produits avec un lot d'ingrédient,
// et où ils sont partis (via le rappel de chaque lot)
const showRappelFournisseurModal = (itemId, numLot) => {
    const item = (DB.get('inventaire') || []).find(i => i.id === itemId);
    if (!item) return;
    const usages = getUsagesLotIngredient(item.nom, numLot).get(normLotFournisseur(numLot)) || [];
    const lotIng = (item.lots || []).find(l => normLotFournisseur(l.numLot) === normLotFournisseur(numLot));
    const lignes = usages.map(u => {
        const r = getLotRappelData(u.numLot);
        return `<tr>
            <td><strong>#${escapeHtml(formatLotNumero(u.numLot))}</strong></td>
            <td>${escapeHtml(u.arome || '?')}<br><span class="text-muted">${escapeHtml([...u.formats].join(', '))}</span></td>
            <td>${u.dateProduction ? escapeHtml(formatDate(u.dateProduction)) : '—'}</td>
            <td>${escapeHtml(invFmtQte(u.quantite, u.unite || item.unite))}</td>
            <td>${r.totalLivre} bt · ${r.nbDestinataires} dest.<br><span class="text-muted">${r.enStock} bt en stock</span></td>
            <td><button type="button" class="btn btn-sm btn-secondary" data-click="show-lot-rappel" data-num="${escapeHtml(u.numLot)}">Rappel du lot</button></td>
        </tr>`;
    }).join('');
    modal.show(`Rappel fournisseur · ${item.nom} ${numLot}`, `
        <div class="commande-details">
            <p style="margin: 0 0 12px;">${lotIng ? escapeHtml([lotIng.fournisseur, lotIng.dateReception ? `reçu le ${formatDate(lotIng.dateReception)}` : '', lotIng.dateLimite ? `limite ${formatDate(lotIng.dateLimite)}` : ''].filter(Boolean).join(' · ')) : ''}</p>
            ${usages.length === 0 ? '<p class="text-muted">Aucune production enregistrée avec ce lot.</p>' : `
                <p class="trace-alert">${usages.length} lot${usages.length > 1 ? 's' : ''} de bouteilles produit${usages.length > 1 ? 's' : ''} avec ce lot. Ouvrez le rappel de chacun pour voir les clients livrés, l'exporter ou bloquer le stock restant.</p>
                <div class="trace-scroll"><table class="details-table">
                    <thead><tr><th>Lot</th><th>Arôme</th><th>Production</th><th>Utilisé</th><th>Parti</th><th></th></tr></thead>
                    <tbody>${lignes}</tbody>
                </table></div>`}
        </div>
    `, `
        <button class="btn btn-secondary" data-click="inventaire-lots" data-id="${escapeHtml(itemId)}">Retour</button>
    `, 'large');
};

// Ajouter ou modifier un article (nom, unité, seuil). La quantité d'un article
// existant ne change que par Réception, Ajuster ou les lots.
const showInventaireModal = (categorie, id = null) => {
    const items = DB.get('inventaire') || [];
    const item = id ? items.find(i => i.id === id) : null;
    if (id && !item) return;
    const cat = item?.categorie || categorie || 'consommable';
    const unites = ['pcs', 'kg', 'L', 'mL', 'g', 'm', 'caisse(s)'];
    const uniteBloquee = !!item && invLotsEnStock(item).length > 0;

    modal.show(item ? 'Modifier l\'article' : (cat === 'equipement' ? 'Nouvel équipement' : 'Nouvel article'), `
        <form id="inventaireForm">
            <input type="hidden" name="categorie" value="${escapeHtml(cat)}">
            <div class="form-group">
                <label for="invNom">Nom</label>
                <input type="text" id="invNom" name="nom" value="${escapeHtml(item?.nom || '')}" maxlength="80" required>
            </div>
            <div class="form-row">
                ${item ? '' : `<div class="form-group">
                    <label for="invQte">Quantité actuelle</label>
                    <input type="number" id="invQte" name="quantite" value="0" min="0" step="any" required>
                </div>`}
                <div class="form-group">
                    <label for="invUnite">Unité</label>
                    <select id="invUnite" name="unite" required ${uniteBloquee ? 'disabled' : ''}>
                        ${unites.map(u => `<option value="${u}" ${displayUnit(item?.unite) === displayUnit(u) ? 'selected' : ''}>${u}</option>`).join('')}
                    </select>
                </div>
            </div>
            ${cat === 'equipement' ? '' : `<div class="form-row">
                <div class="form-group">
                    <label for="invSeuil">Seuil d'alerte</label>
                    <input type="number" id="invSeuil" name="seuilAlerte" value="${safeNumAttr(item?.seuilAlerte || 0)}" min="0" step="any">
                </div>
                <div class="form-group">
                    <label for="invBouteille">Bouteille vide</label>
                    <select id="invBouteille" name="bouteilleCl">
                        ${[[0, 'Non'], [25, '25 cl'], [50, '50 cl'], [100, '1 L']].map(([cl, label]) => `<option value="${cl}" ${(Number(item?.bouteilleCl) || 0) === cl ? 'selected' : ''}>${label}</option>`).join('')}
                    </select>
                </div>
            </div>`}
        </form>
    `, `
        <button class="btn btn-secondary" data-click="close-modal">Annuler</button>
        <button class="btn btn-primary" data-click="save-inventaire-item" data-id="${escapeHtml(id || '')}">Enregistrer</button>
    `);
};

const saveInventaireItem = (event, id) => {
    const reenable = disableSaveBtn(event);
    try {
        const form = document.getElementById('inventaireForm');
        if (!form?.reportValidity()) return;
        const formData = new FormData(form);
        const nom = (formData.get('nom') || '').toString().trim();
        if (!nom) {
            showToast('Le nom est obligatoire', 'error');
            return;
        }

        const items = DB.get('inventaire') || [];
        // Taille de bouteille vide (25, 50 ou 100 cl) : place l'article sur la bonne palette de l'atelier 3D
        const bouteilleCl = [25, 50, 100].find(cl => cl === Number(formData.get('bouteilleCl'))) || 0;
        const doublon = items.find(i => i.id !== id && normalizeName(i.nom) === normalizeName(nom));
        if (doublon) {
            showToast(`« ${doublon.nom} » existe déjà dans l'inventaire`, 'error');
            return;
        }

        if (id) {
            const item = items.find(i => i.id === id);
            if (!item) {
                modal.hide();
                showToast('Article introuvable : il a peut-être été supprimé sur un autre appareil', 'error');
                renderCurrentView();
                return;
            }
            item.nom = nom;
            if (formData.has('unite')) item.unite = displayUnit(formData.get('unite'));
            if (formData.has('seuilAlerte')) item.seuilAlerte = parseFloat(formData.get('seuilAlerte')) || 0;
            if (bouteilleCl) item.bouteilleCl = bouteilleCl;
            else if (formData.has('bouteilleCl')) delete item.bouteilleCl;
        } else {
            items.push({
                id: generateId(),
                categorie: formData.get('categorie') || 'consommable',
                nom,
                quantite: Math.max(0, parseFloat(formData.get('quantite')) || 0),
                unite: displayUnit(formData.get('unite')),
                seuilAlerte: parseFloat(formData.get('seuilAlerte')) || 0,
                ...(bouteilleCl ? { bouteilleCl } : {})
            });
        }
        DB.set('inventaire', items);

        modal.hide();
        showToast('Article enregistré');
        renderCurrentView();
    } catch (e) {
        console.error('Error saving inventaire item:', e);
        showToast('Erreur lors de l\'enregistrement de l\'article', 'error');
    } finally {
        if (reenable) reenable();
    }
};

// Ajustement rapide (± du jumeau 3D). Une baisse d'un ingrédient suivi puise
// dans ses lots dans l'ordre d'utilisation ; une hausse va au stock sans n° de lot.
const updateInventaireQty = (id, delta) => {
    const items = DB.get('inventaire');
    const item = items.find(i => i.id === id);
    if (item) {
        const avant = Number(item.quantite) || 0;
        const apres = Math.max(0, avant + delta);
        if (apres < avant && isLotSuiviArticle(item)) consommerLotsIngredient(item, avant - apres);
        item.quantite = arrondiInv(apres);
        DB.set('inventaire', items);
        renderCurrentView();
    }
};

// Delete inventaire item
const deleteInventaireItem = (id) => {
    const item = (DB.get('inventaire') || []).find(i => i.id === id);
    if (!item) return;
    const lots = invLotsEnStock(item).length;
    confirmDialog(`Supprimer l'article « ${item.nom} » ?${lots ? ` Ses ${lots} lot${lots > 1 ? 's' : ''} en stock disparaîtront aussi ; la traçabilité des productions passées est conservée.` : ''}`, { danger: true }).then(ok => {
        if (!ok) return;
        const items = DB.get('inventaire').filter(i => i.id !== id);
        DB.set('inventaire', items);
        modal.hide();
        showToast('Article supprimé');
        renderCurrentView();
    });
};
