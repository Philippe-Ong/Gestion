// =============================================================================
// Production (v13.2)
// =============================================================================
// Un seul plan pour la page Production, le tableau de bord et le jumeau 3D
// (buildProductionPlan). Mode auto : les bouteilles à produire sont les manques
// de la règle d'attribution commune (planAttributionCommandes — commandes
// « produites » d'abord, puis par date de livraison, lots vendables à la
// livraison et assez longs pour le client), pour les commandes retenues ; les
// autres gardent leur stock réservé. Mode manuel : les quantités saisies.
// Chaque arôme forme un brassin, réparti en récipients (cuves 25 L, casseroles)
// puis placé sur les postes de l'atelier, fournée après fournée, par échéance.

let productionPlannerState = null; // dernier plan affiché (buildProductionPlan)
let productionSelectedCommandes = null; // Set des commandes retenues ; null = toutes (jamais personnalisé)
let productionFocusTarget = null; // 'selectAll' | 'deselectAll' | commandeId
let productionMode = null; // 'auto' | 'manuel' — initialisé paresseusement depuis le filtre persistant
let productionManualQuantities = {}; // { `${aromeId}|${formatId}`: nombre de bouteilles }
let productionVolumes = {}; // litres réglés au curseur : { [clé du brassin]: [litres par récipient] }

const roundHalfLiter = (value) => Math.round((parseFloat(value) || 0) * 2) / 2;
// Volume à brasser : arrondi au demi-litre SUPÉRIEUR (jamais moins que les bouteilles)
const ceilHalfLiter = (value) => Math.ceil(Math.round((parseFloat(value) || 0) * 2000) / 1000) / 2;

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

const calculerIngredientsRecipient = (recette, litres) => {
    if (!recette || !Array.isArray(recette.ingredients) || litres <= 0) return [];
    return recette.ingredients.map(ing => ({
        nom: ing.nom,
        quantite: parseFloat(((parseFloat(ing.quantite) || 0) * litres).toFixed(2)),
        unite: ing.unite
    }));
};

// Répartit les bouteilles de chaque format entre les récipients au prorata de
// leurs litres (plus forts restes) : la somme par format reste exacte, aucune
// bouteille ne se perd d'un récipient à l'autre. r.bouteilles = { formatId: n }
const repartirBouteillesRecipients = (besoins, recipients) => {
    const total = recipients.reduce((s, r) => s + r.litres, 0);
    recipients.forEach(r => { r.bouteilles = {}; });
    if (total <= 0) return;
    besoins.forEach(b => {
        const parts = recipients.map((r, i) => {
            const exact = b.aProduire * r.litres / total;
            return { i, n: Math.floor(exact), reste: exact - Math.floor(exact) };
        });
        let restant = b.aProduire - parts.reduce((s, p) => s + p.n, 0);
        [...parts].sort((x, y) => y.reste - x.reste || x.i - y.i).forEach(p => {
            if (restant > 0) { p.n++; restant--; }
        });
        parts.forEach(p => { if (p.n > 0) recipients[p.i].bouteilles[b.format.id] = p.n; });
    });
};

const majRecipientsBrassin = (brassin) => {
    brassin.recipients.forEach(r => { r.ingredients = calculerIngredientsRecipient(brassin.recette, r.litres); });
    repartirBouteillesRecipients(brassin.besoins, brassin.recipients);
};

// Postes de l'atelier pour une fournée : les cuves, puis les casseroles des plaques
const atelierPostesVides = () => ({
    cuves: Array.from({ length: CONSTANTS.ATELIER_CUVES }, (_, i) => ({ kind: 'cuve', numero: i + 1, capacite: CONSTANTS.CUVE_MAX_L, recipient: null })),
    casseroles: CONSTANTS.ATELIER_CASSEROLES_L.map((capacite, i) => ({ kind: 'casserole', numero: i + 1, capacite, recipient: null }))
});

// Place les récipients des brassins (déjà triés par échéance) sur les postes :
// premier poste libre de la première fournée qui a de la place. Une casserole va
// sur la plaque de sa taille, sinon sur une plaque assez grande, sinon dans une
// cuve libre plutôt que d'attendre la fournée suivante.
const planifierAtelier = (brassins) => {
    const fournees = [];
    const placer = (f, r) => {
        if (r.type === 'casserole') {
            const plaque = f.casseroles.find(p => !p.recipient && p.capacite === r.capacite)
                || f.casseroles.find(p => !p.recipient && p.capacite >= r.litres);
            if (plaque) return plaque;
        }
        return f.cuves.find(p => !p.recipient) || null;
    };
    brassins.forEach(b => b.recipients.forEach(r => {
        let fournee = null;
        let poste = null;
        for (const f of fournees) {
            poste = placer(f, r);
            if (poste) { fournee = f; break; }
        }
        if (!poste) {
            fournee = { numero: fournees.length + 1, ...atelierPostesVides() };
            fournees.push(fournee);
            poste = placer(fournee, r);
        }
        poste.recipient = r;
        if (poste.kind === 'cuve' && r.type !== 'cuve') {
            r.type = 'cuve';
            r.capacite = poste.capacite;
        }
        r.fournee = fournee.numero;
        r.posteKind = poste.kind;
        r.posteNumero = poste.numero;
        r.poste = poste.kind === 'cuve' ? `Cuve ${poste.numero}` : `Casserole ${poste.capacite} L`;
    }));
    return fournees;
};

// Plan de production. Options : mode 'auto' | 'manuel', selection (Set des
// commandes retenues, null = toutes), manuel ({ `${aromeId}|${formatId}`: bt }),
// volumes (réglages des curseurs), attribution (résultat de planAttributionCommandes
// déjà calculé). Ne lit que la base, n'écrit rien.
const buildProductionPlan = ({ mode = 'auto', selection = null, manuel = {}, volumes = {}, referenceDate = new Date(), attribution = null } = {}) => {
    const aromes = DB.get('aromes') || [];
    const formats = DB.get('formats') || [];
    const recettes = DB.get('recettes') || [];
    const besoins = new Map();
    const commandes = [];
    const besoinDe = (arome, format) => {
        const key = stockCellKey(arome.nom, format.nom);
        if (!besoins.has(key)) {
            besoins.set(key, {
                key, arome, format, aromeNom: arome.nom, formatNom: format.nom,
                contenanceCl: Number(format.contenanceCl) || resolveFormatContenance(format.nom, formats) || 0,
                demande: 0, aProduire: 0, commandes: []
            });
        }
        return besoins.get(key);
    };

    if (mode === 'manuel') {
        Object.entries(manuel).forEach(([key, qty]) => {
            const quantite = Math.max(0, parseInt(qty, 10) || 0);
            const sep = key.indexOf('|');
            if (quantite <= 0 || sep < 0) return;
            const arome = aromes.find(a => a.id === key.slice(0, sep));
            const format = formats.find(f => f.id === key.slice(sep + 1));
            if (!arome || !format) return;
            const b = besoinDe(arome, format);
            b.demande += quantite;
            b.aProduire += quantite;
        });
    } else {
        (attribution || planAttributionCommandes(referenceDate)).plan.forEach(({ commande, client, lignes }) => {
            const retenue = !selection || selection.has(commande.id);
            const manquantes = lignes.filter(l => l.manque > 0);
            commandes.push({
                commande, client, retenue,
                aProduire: manquantes.reduce((s, l) => s + l.manque, 0),
                lignes: manquantes.map(l => ({ aromeNom: l.arome.nom, couleur: safeColor(l.arome.couleur), formatNom: l.format.nom, quantite: l.manque }))
            });
            if (!retenue) return;
            lignes.forEach(l => {
                const b = besoinDe(l.arome, l.format);
                b.demande += l.demande;
                if (l.manque <= 0) return;
                b.aProduire += l.manque;
                b.commandes.push({ commande, client, quantite: l.manque });
            });
        });
        const ordre = new Map(sortCommandesByDateLivraison(commandes.map(c => c.commande)).map(({ commande }, i) => [commande.id, i]));
        commandes.sort((a, b) => ordre.get(a.commande.id) - ordre.get(b.commande.id));
    }

    const parArome = new Map();
    besoins.forEach(b => {
        if (b.aProduire <= 0) return;
        const k = normalizeName(b.aromeNom) || '?';
        if (!parArome.has(k)) parArome.set(k, []);
        parArome.get(k).push(b);
    });

    const brassins = [...parArome.entries()].map(([key, liste]) => {
        const arome = liste[0].arome;
        liste.sort((a, b) => b.contenanceCl - a.contenanceCl);
        const litres = Math.round(liste.reduce((s, b) => s + b.aProduire * b.contenanceCl / 100, 0) * 1000) / 1000;
        const volume = ceilHalfLiter(litres);
        const parCommande = new Map();
        liste.forEach(b => b.commandes.forEach(c => {
            const e = parCommande.get(c.commande.id) || { commande: c.commande, client: c.client, lignes: [] };
            e.lignes.push({ formatNom: b.formatNom, quantite: c.quantite });
            parCommande.set(c.commande.id, e);
        }));
        const cmds = sortCommandesByDateLivraison([...parCommande.values()].map(e => e.commande))
            .map(({ commande }) => parCommande.get(commande.id));
        return {
            key, arome, aromeNom: arome.nom, couleur: safeColor(arome.couleur),
            recette: recettes.find(r => r.aromeId === arome.id) || null,
            besoins: liste, litres, volume,
            bouteilles: liste.reduce((s, b) => s + b.aProduire, 0),
            commandes: cmds,
            dateEcheance: cmds[0]?.commande.dateLivraison || '',
            echeance: cmds.length ? twinDaysUntil(cmds[0].commande.dateLivraison) : null,
            recipients: getProductionRecipients(volume)
        };
    }).sort((a, b) => (a.echeance ?? 9999) - (b.echeance ?? 9999) || b.volume - a.volume);

    const fournees = planifierAtelier(brassins);

    // Réglages des curseurs : repris tant que le brassin garde le même volume
    // et le même nombre de récipients
    brassins.forEach(b => {
        const reglage = volumes[b.key];
        if (Array.isArray(reglage) && reglage.length === b.recipients.length
            && roundHalfLiter(reglage.reduce((s, v) => s + v, 0)) === roundHalfLiter(b.recipients.reduce((s, r) => s + r.litres, 0))
            && reglage.every((v, i) => v >= 0.5 && v <= b.recipients[i].capacite)) {
            b.recipients.forEach((r, i) => { r.litres = roundHalfLiter(reglage[i]); });
        }
        majRecipientsBrassin(b);
    });

    const matieres = controlerMatieresProduction(brassins);
    const retenues = commandes.filter(c => c.retenue && c.aProduire > 0);
    return {
        mode, brassins, fournees, commandes, matieres,
        totaux: {
            litres: brassins.reduce((s, b) => s + b.litres, 0),
            volume: brassins.reduce((s, b) => s + b.volume, 0),
            bouteilles: brassins.reduce((s, b) => s + b.bouteilles, 0),
            recipients: brassins.reduce((s, b) => s + b.recipients.length, 0),
            commandes: retenues.length
        }
    };
};

// Contrôle des matières du plan : même déduction qu'une production confirmée
// (recette × litres × pertes, bouteilles vides, bouchons + marge), simulée sur
// une copie de l'inventaire, brassin après brassin dans l'ordre des échéances.
// Renseigne brassin.manques / brassin.alertes ; renvoie les lignes par article.
const controlerMatieresProduction = (brassins) => {
    const origine = DB.get('inventaire') || [];
    const copie = JSON.parse(JSON.stringify(origine));
    const erreurs = [];
    brassins.forEach(b => {
        const produits = b.besoins.map(x => ({ format: x.format, quantite: x.aProduire }));
        const { warnings, conversionErrors } = deduireInventaireProduction(copie, b.aromeNom, produits, b.litres);
        b.manques = warnings.filter(w => w.startsWith('Stock insuffisant: ')).map(w => w.slice('Stock insuffisant: '.length));
        b.alertes = [...conversionErrors, ...warnings.filter(w => !w.startsWith('Stock insuffisant') && !w.startsWith('Recette introuvable'))];
        erreurs.push(...conversionErrors);
    });
    const lignes = origine.map((item, i) => {
        const apres = Number(copie[i]?.quantite) || 0;
        const besoin = arrondiInv((Number(item.quantite) || 0) - apres);
        if (besoin <= 0) return null;
        return { item, besoin, stock: Number(item.quantite) || 0, apres: arrondiInv(apres), manque: apres < -1e-9 };
    }).filter(Boolean).sort((a, b) => (b.manque - a.manque) || String(a.item.nom).localeCompare(String(b.item.nom), 'fr'));
    return { lignes, erreurs: [...new Set(erreurs)] };
};

// Plan de la page (mode et sélection courants), mémorisé pour les curseurs et la validation
const computeProductionPlan = () => {
    const plan = buildProductionPlan({
        mode: productionMode === 'manuel' ? 'manuel' : 'auto',
        selection: productionSelectedCommandes,
        manuel: productionManualQuantities,
        volumes: productionVolumes
    });
    productionPlannerState = plan;
    return plan;
};

// --- Rendu de la page ---

const prodFmtL = (l) => `${(Math.round((Number(l) || 0) * 10) / 10).toLocaleString('fr-CH', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L`;

// « liv. jeu. 30.10 » / « en retard (lun. 20.10) » ; classe d'urgence
const prodEcheanceHtml = (dateLivraison) => {
    const days = twinDaysUntil(dateLivraison);
    const cls = days === null ? '' : days < 0 ? ' is-late' : days <= 1 ? ' is-soon' : '';
    return `<span class="prod-when${cls}">${escapeHtml(stockLivraisonLabel(dateLivraison))}</span>`;
};

const prodPosteLabel = (r) => `F${r.fournee} · ${r.poste}`;
// Date du journal : horodatage (dateAdded), ou date seule pour les anciennes entrées
const prodFmtDate = (d) => (!d ? '—' : /^\d{4}-\d{2}-\d{2}$/.test(d) ? formatDate(dateOnly(d)) : formatDateTime(d));

const productionKpiHtml = (plan) => {
    const t = plan.totaux;
    const tile = (valeur, label, sub = '') => `
        <div class="prod-kpi">
            <span class="prod-kpi-value">${escapeHtml(valeur)}</span>
            <span class="prod-kpi-label">${escapeHtml(label)}</span>
            ${sub ? `<span class="prod-kpi-sub">${escapeHtml(sub)}</span>` : ''}
        </div>`;
    const postes = CONSTANTS.ATELIER_CUVES + CONSTANTS.ATELIER_CASSEROLES_L.length;
    return `
        <div class="prod-kpis">
            ${tile(prodFmtL(t.litres), 'À produire', `${twinFmtInt(t.bouteilles)} bt`)}
            ${tile(twinFmtInt(plan.brassins.length), plan.brassins.length > 1 ? 'Brassins' : 'Brassin', dashPlural(t.recipients, 'récipient'))}
            ${tile(twinFmtInt(plan.fournees.length), plan.fournees.length > 1 ? 'Fournées' : 'Fournée',
                plan.fournees.length ? `${plan.fournees[0].cuves.concat(plan.fournees[0].casseroles).filter(p => p.recipient).length}/${postes} postes en 1re` : 'atelier libre')}
            ${plan.mode === 'manuel'
                ? tile(twinFmtInt(plan.matieres.lignes.filter(l => l.manque).length), 'Matières en manque', `${plan.matieres.lignes.length} article(s) utilisés`)
                : tile(twinFmtInt(t.commandes), t.commandes > 1 ? 'Commandes à couvrir' : 'Commande à couvrir', `${plan.commandes.length} ouverte(s)`)}
        </div>`;
};

const productionAlertsHtml = (plan) => {
    const items = [];
    if (plan.mode !== 'manuel') {
        const retard = plan.commandes.filter(c => c.retenue && c.aProduire > 0 && (twinDaysUntil(c.commande.dateLivraison) ?? 0) < 0);
        if (retard.length) {
            items.push({
                level: 'danger', icon: 'horloge',
                title: `En retard · ${dashPlural(retard.length, 'commande')} à produire`,
                text: retard.slice(0, 3).map(c => `#${getCommandeNumero(c.commande)} ${getClientLabel(c.client)}`).join(', ') + (retard.length > 3 ? '…' : ''),
                attrs: { 'data-click': 'production-reveal', 'data-target': 'prodCommandesTitle' }
            });
        }
    }
    const sansRecette = plan.brassins.filter(b => !b.recette);
    if (sansRecette.length) {
        items.push({
            level: 'warning', icon: 'attention',
            title: `Recette manquante · ${sansRecette.map(b => b.aromeNom).join(', ')}`,
            text: 'Ingrédients ni calculés ni déduits de l\'inventaire : ajoutez la recette dans les Paramètres',
            attrs: { 'data-click': 'production-goto', 'data-href': '#parametres' }
        });
    }
    const manques = plan.matieres.lignes.filter(l => l.manque);
    if (manques.length) {
        items.push({
            level: 'danger', icon: 'stock',
            title: `Matières insuffisantes · ${dashPlural(manques.length, 'article')}`,
            text: manques.slice(0, 3).map(l => `${l.item.nom} (manque ${invFmtQte(-l.apres, l.item.unite)})`).join(', ') + (manques.length > 3 ? '…' : ''),
            attrs: { 'data-click': 'production-reveal', 'data-target': 'prodMatieresTitle' }
        });
    }
    const autres = [...new Set(plan.brassins.flatMap(b => b.alertes || []))];
    if (autres.length) {
        items.push({
            level: 'warning', icon: 'info',
            title: `À vérifier dans l'inventaire · ${dashPlural(autres.length, 'point')}`,
            text: autres.slice(0, 3).join(' · ') + (autres.length > 3 ? '…' : ''),
            attrs: { 'data-click': 'production-goto', 'data-href': '#inventaire' }
        });
    }
    if (plan.fournees.length > 1) {
        items.push({
            level: 'info', icon: 'production',
            title: `${plan.fournees.length} fournées nécessaires`,
            text: `L'atelier (${CONSTANTS.ATELIER_CUVES} cuves, ${CONSTANTS.ATELIER_CASSEROLES_L.length} casseroles) ne suffit pas en une fois : les brassins les plus urgents passent en premier`,
            attrs: { 'data-click': 'production-reveal', 'data-target': 'prodAtelierTitle' }
        });
    }
    return dashAlertesSectionHtml(items, 'prodAlertsTitle');
};

// Mode auto : commandes qui demandent une production (case = retenue dans le plan)
const productionCommandesHtml = (plan) => {
    const aProduire = plan.commandes.filter(c => c.aProduire > 0);
    const couvertes = plan.commandes.length - aProduire.length;
    const retenues = aProduire.filter(c => c.retenue).length;
    const row = (c) => `
        <li>
            <label class="prod-cmd${c.retenue ? '' : ' is-off'}">
                <input type="checkbox" data-commande-id="${escapeHtml(c.commande.id)}" ${c.retenue ? 'checked' : ''}
                       aria-label="${escapeHtml(`Retenir la commande #${getCommandeNumero(c.commande)} dans le plan`)}">
                <span class="prod-cmd-main">
                    <span class="prod-cmd-title">#${escapeHtml(getCommandeNumero(c.commande))} · ${escapeHtml(getClientLabel(c.client))}
                        ${c.commande.statut === 'produite' ? '<span class="badge badge-produite">Produite</span>' : ''}</span>
                    <span class="prod-cmd-lines">${c.lignes.map(l => `<span><span class="aroma-tile-dot" style="background:${safeColor(l.couleur)}"></span>${escapeHtml(`${twinFmtInt(l.quantite)} × ${l.aromeNom} ${l.formatNom}`)}</span>`).join('')}</span>
                </span>
                <span class="prod-cmd-side">
                    ${prodEcheanceHtml(c.commande.dateLivraison)}
                    <span class="prod-cmd-qty">${escapeHtml(twinFmtInt(c.aProduire))} bt</span>
                </span>
            </label>
        </li>`;
    return `
        <section class="stock-section" aria-labelledby="prodCommandesTitle">
            <div class="stock-section-head">
                <h2 class="stock-section-title" id="prodCommandesTitle">Commandes à couvrir</h2>
                <span class="stock-section-meta">${escapeHtml(`${retenues}/${aProduire.length} retenue(s)${couvertes ? ` · ${couvertes} couverte(s) par le stock` : ''}`)}</span>
                ${aProduire.length > 1 ? `
                <div class="stock-section-action prod-cmd-actions">
                    <button type="button" class="btn btn-sm btn-secondary" id="productionSelectAllBtn" data-click="production-select" data-value="all">Tout cocher</button>
                    <button type="button" class="btn btn-sm btn-secondary" id="productionDeselectAllBtn" data-click="production-select" data-value="none">Tout décocher</button>
                </div>` : ''}
            </div>
            ${aProduire.length === 0
                ? `<div class="commande-empty">${escapeHtml(plan.commandes.length ? 'Le stock vendable couvre toutes les commandes ouvertes.' : 'Aucune commande ouverte.')}</div>`
                : `<div class="stock-group"><ul class="prod-cmd-list" id="productionCommandeList">${aProduire.map(row).join('')}</ul></div>`}
        </section>`;
};

// Mode manuel : une ligne par arôme actif, un champ par format actif
const productionManualHtml = () => {
    const aromesActifs = getActive('aromes');
    const formatsActifs = getActive('formats');
    if (aromesActifs.length === 0 || formatsActifs.length === 0) {
        return `<section class="stock-section"><div class="commande-empty">Ajoutez des arômes et des formats dans les Paramètres pour saisir une production.</div></section>`;
    }
    return `
        <section class="stock-section" aria-labelledby="prodManualTitle">
            <div class="stock-section-head">
                <h2 class="stock-section-title" id="prodManualTitle">Bouteilles à produire</h2>
                <span class="stock-section-meta">Pour le stock, sans lien avec les commandes</span>
                <button type="button" class="btn btn-sm btn-secondary stock-section-action" data-click="production-manual-reset">Tout remettre à zéro</button>
            </div>
            <div class="stock-group prod-manual" id="productionManual">
                ${aromesActifs.map(arome => `
                    <div class="prod-manual-row">
                        <span class="prod-manual-arome"><span class="aroma-tile-dot" style="background:${safeColor(arome.couleur)}"></span>${escapeHtml(arome.nom)}</span>
                        <div class="prod-manual-fields">
                            ${formatsActifs.map(format => {
                                const key = `${arome.id}|${format.id}`;
                                const val = productionManualQuantities[key];
                                return `
                                  <label class="prod-manual-field">
                                    <span>${escapeHtml(format.nom)}</span>
                                    <input type="number" min="0" step="1" inputmode="numeric" placeholder="0"
                                           data-manual-key="${escapeHtml(key)}"
                                           aria-label="${escapeHtml(`${arome.nom} ${format.nom}, bouteilles`)}"
                                           value="${val ? escapeHtml(String(val)) : ''}">
                                  </label>`;
                            }).join('')}
                        </div>
                    </div>`).join('')}
            </div>
        </section>`;
};

const productionAtelierHtml = (plan) => {
    if (plan.fournees.length === 0) return '';
    const poste = (p) => {
        const r = p.recipient;
        const b = r ? plan.brassins.find(x => x.recipients.includes(r)) : null;
        const fill = r ? Math.round(Math.min(1, r.litres / p.capacite) * 100) : 0;
        const nom = p.kind === 'cuve' ? `Cuve ${p.numero}` : `Cass. ${p.capacite} L`;
        const detail = r ? `${b?.aromeNom || ''} · ${prodFmtL(r.litres)}` : 'libre';
        return `
            <div class="dash-poste${r ? '' : ' is-idle'}" role="listitem" aria-label="${escapeHtml(`${nom} : ${detail}`)}">
                <span class="dash-vessel dash-vessel--${p.kind}" aria-hidden="true">
                    <span class="dash-vessel-fill" style="height:${fill}%;--fill:${safeColor(b?.couleur)}"></span>
                </span>
                <span class="dash-poste-name" aria-hidden="true">${escapeHtml(nom)}</span>
                <span class="dash-poste-sub" aria-hidden="true">${escapeHtml(r ? (b?.aromeNom || '') : 'Libre')}</span>
                ${r ? `<span class="dash-poste-sub prod-poste-l" aria-hidden="true">${escapeHtml(prodFmtL(r.litres))}</span>` : ''}
            </div>`;
    };
    return `
        <section class="stock-section" aria-labelledby="prodAtelierTitle">
            <div class="stock-section-head">
                <h2 class="stock-section-title" id="prodAtelierTitle">Planning de l'atelier</h2>
                <span class="stock-section-meta">${escapeHtml(`${dashPlural(plan.fournees.length, 'fournée')} · ${CONSTANTS.ATELIER_CUVES} cuves ${CONSTANTS.CUVE_MAX_L} L, casseroles ${CONSTANTS.ATELIER_CASSEROLES_L.join(' L et ')} L`)}</span>
            </div>
            <div class="prod-fournees">
                ${plan.fournees.map(f => {
                    const postes = [...f.cuves, ...f.casseroles];
                    const litres = postes.reduce((s, p) => s + (p.recipient?.litres || 0), 0);
                    return `
                    <div class="stock-group prod-fournee">
                        <div class="stock-group-head">
                            <span class="stock-group-title">Fournée ${f.numero}<span class="stock-group-format"> · ${f.numero === 1 ? 'à lancer' : 'ensuite'}</span></span>
                            <span class="stock-group-meta">${escapeHtml(`${postes.filter(p => p.recipient).length}/${postes.length} postes · ${prodFmtL(litres)}`)}</span>
                        </div>
                        <div class="dash-postes prod-postes" role="list" aria-label="${escapeHtml(`Postes de la fournée ${f.numero}`)}">${postes.map(poste).join('')}</div>
                    </div>`;
                }).join('')}
            </div>
        </section>`;
};

const productionRecipientHtml = (b, r, index) => {
    const fill = r.capacite > 0 ? Math.round((r.litres / r.capacite) * 100) : 0;
    const bouteilles = b.besoins.filter(x => r.bouteilles[x.format.id] > 0)
        .map(x => `${twinFmtInt(r.bouteilles[x.format.id])} × ${x.formatNom}`).join(' · ');
    return `
        <li class="prod-recipient" data-brassin="${escapeHtml(b.key)}" data-recipient-index="${index}">
            <div class="prod-recipient-head">
                <span class="prod-recipient-poste">${escapeHtml(prodPosteLabel(r))}</span>
                <span class="prod-recipient-litres" data-role="litres">${escapeHtml(`${prodFmtL(r.litres)} / ${r.capacite} L · ${fill} %`)}</span>
                ${b.recipients.length > 1 ? `<button type="button" class="btn btn-sm btn-secondary" data-click="production-produire" data-brassin="${escapeHtml(b.key)}" data-index="${index}"
                    aria-label="${escapeHtml(`Produire ${b.aromeNom}, ${prodPosteLabel(r)}`)}">Produite</button>` : ''}
            </div>
            <div class="prod-fill" aria-hidden="true"><span data-role="fill" style="width:${Math.min(100, fill)}%;background:${safeColor(b.couleur)}"></span></div>
            ${b.recipients.length > 1 ? `
            <div class="cuve-slider-row">
                <input type="range" class="cuve-slider" min="0.5" max="${safeNumAttr(r.capacite)}" step="0.5" value="${safeNumAttr(r.litres)}"
                       data-brassin="${escapeHtml(b.key)}" data-recipient-index="${index}"
                       aria-label="${escapeHtml(`Litres dans ${prodPosteLabel(r)}`)}">
            </div>` : ''}
            <div class="prod-recipient-bt" data-role="bouteilles">${escapeHtml(bouteilles || '—')}</div>
            ${r.ingredients.length ? `
            <ul class="ingredient-list prod-ingredients" data-role="ingredients">${prodIngredientsHtml(r.ingredients)}</ul>` : ''}
        </li>`;
};

const prodIngredientsHtml = (ingredients) => ingredients.map(ing => `
    <li><span>${escapeHtml(ing.nom)}</span><strong>${escapeHtml(invFmtNombre(ing.quantite))} ${escapeHtml(displayUnit(ing.unite))}</strong></li>`).join('');

const productionBrassinHtml = (b) => {
    const etat = !b.recette
        ? '<span class="dash-chip is-warn">Recette manquante</span>'
        : b.manques.length
            ? `<span class="dash-chip is-danger">${escapeHtml(`Manque : ${b.manques.join(', ')}`)}</span>`
            : '<span class="dash-chip is-ok">Matières disponibles</span>';
    return `
        <article class="stock-group prod-brassin" aria-labelledby="${escapeHtml(`prodBrassin-${b.key}`)}">
            <div class="stock-group-head prod-brassin-head">
                <span class="stock-group-title" id="${escapeHtml(`prodBrassin-${b.key}`)}"><span class="aroma-tile-dot" style="background:${safeColor(b.couleur)}"></span>${escapeHtml(b.aromeNom)}</span>
                <span class="stock-group-meta">${escapeHtml(`${prodFmtL(b.litres)} · ${twinFmtInt(b.bouteilles)} bt`)}</span>
                <button type="button" class="btn btn-sm btn-primary" data-click="production-produire" data-brassin="${escapeHtml(b.key)}"
                    aria-label="${escapeHtml(`Produire tout le brassin ${b.aromeNom}`)}">${b.recipients.length > 1 ? 'Produire tout' : 'Produire'}</button>
            </div>
            <div class="prod-brassin-meta">
                <span class="prod-brassin-formats">${escapeHtml(b.besoins.map(x => `${twinFmtInt(x.aProduire)} × ${x.formatNom}`).join(' · '))}</span>
                ${etat}
                ${b.dateEcheance ? prodEcheanceHtml(b.dateEcheance) : ''}
            </div>
            ${b.commandes.length ? `
            <div class="prod-brassin-cmds">Pour ${b.commandes.slice(0, 4).map(c => `<span>#${escapeHtml(getCommandeNumero(c.commande))} ${escapeHtml(getClientLabel(c.client))}</span>`).join(', ')}${b.commandes.length > 4 ? ` et ${b.commandes.length - 4} autre(s)` : ''}</div>` : ''}
            <ul class="prod-recipient-list">${b.recipients.map((r, i) => productionRecipientHtml(b, r, i)).join('')}</ul>
        </article>`;
};

const productionMatieresHtml = (plan) => {
    if (plan.brassins.length === 0) return '';
    const { lignes } = plan.matieres;
    const row = (l) => `
        <li class="prod-mat${l.manque ? ' is-short' : ''}">
            <span class="prod-mat-name">${escapeHtml(l.item.nom)}</span>
            <span class="prod-mat-num"><span class="prod-mat-lbl">Besoin</span>${escapeHtml(invFmtQte(l.besoin, l.item.unite))}</span>
            <span class="prod-mat-num"><span class="prod-mat-lbl">Stock</span>${escapeHtml(invFmtQte(l.stock, l.item.unite))}</span>
            <span class="prod-mat-num prod-mat-after"><span class="prod-mat-lbl">${l.manque ? 'Manque' : 'Après'}</span>${escapeHtml(invFmtQte(l.manque ? -l.apres : l.apres, l.item.unite))}</span>
        </li>`;
    return `
        <section class="stock-section" aria-labelledby="prodMatieresTitle">
            <div class="stock-section-head">
                <h2 class="stock-section-title" id="prodMatieresTitle">Matières nécessaires</h2>
                <span class="stock-section-meta">${escapeHtml(`${dashPlural(lignes.length, 'article')}${lignes.some(l => l.manque) ? ` · ${lignes.filter(l => l.manque).length} en manque` : ''}`)}</span>
                <a href="#inventaire" class="btn btn-sm btn-secondary stock-section-action">Inventaire</a>
            </div>
            ${lignes.length
                ? `<div class="stock-group"><ul class="prod-mat-list">${lignes.map(row).join('')}</ul></div>`
                : '<div class="commande-empty">Aucun article de l\'inventaire n\'est concerné (recettes ou contenants absents).</div>'}
        </section>`;
};

const productionResultsHtml = (plan) => {
    if (plan.brassins.length === 0) {
        return `
            ${productionAlertsHtml(plan)}
            <section class="stock-section">
                ${dashEmptyHtml('check', 'Rien à produire', plan.mode === 'manuel'
                    ? 'Saisissez des quantités ci-dessus pour calculer les brassins.'
                    : 'Le stock vendable couvre les commandes retenues.')}
            </section>`;
    }
    return `
        ${productionAlertsHtml(plan)}
        ${productionAtelierHtml(plan)}
        <section class="stock-section" aria-labelledby="prodBrassinsTitle">
            <div class="stock-section-head">
                <h2 class="stock-section-title" id="prodBrassinsTitle">Brassins</h2>
                <span class="stock-section-meta">${escapeHtml(`${dashPlural(plan.brassins.length, 'arôme')} · par échéance`)}</span>
            </div>
            ${plan.brassins.map(productionBrassinHtml).join('')}
        </section>
        ${productionMatieresHtml(plan)}`;
};

// --- Journal des productions (entrées PROD- de l'historique, groupées par production) ---

const getProductionsJournal = () => {
    const formats = DB.get('formats') || [];
    const groupes = new Map();
    (DB.get('history') || []).forEach(h => {
        if (!String(h.id || '').startsWith('PROD-')) return;
        const key = h.productionId || h.id;
        if (!groupes.has(key)) groupes.set(key, []);
        groupes.get(key).push(h);
    });
    return [...groupes.entries()].map(([key, entries]) => {
        const e0 = entries[0];
        const quantite = entries.reduce((s, h) => s + (Number(h.quantity) || 0), 0);
        return {
            key,
            productionId: e0.productionId || null,
            entries,
            date: entries.map(h => h.dateAdded || '').sort().pop() || e0.productionDate || '',
            aromeNom: e0.arome || '',
            numLot: e0.numLot || '',
            formats: entries.map(h => ({ format: h.format || '', quantite: Number(h.quantity) || 0, lotId: h.lotId, coutMatiereUnitaire: h.coutMatiereUnitaire })),
            quantite,
            litres: Number.isFinite(Number(e0.litres)) && e0.litres !== undefined
                ? Number(e0.litres)
                : entries.reduce((s, h) => s + calcProductionLitres(h.quantity, h.format, formats), 0),
            ingredients: Array.isArray(e0.ingredients) ? e0.ingredients : [],
            contenants: Array.isArray(e0.contenants) ? e0.contenants : null,
            commandes: Array.isArray(e0.commandes) ? e0.commandes : []
        };
    }).sort((a, b) => String(b.date).localeCompare(String(a.date)));
};

// Raison qui empêche d'annuler une production ('' = annulable)
const productionAnnulationBlocage = (prod) => {
    if (!prod.productionId || !prod.contenants) {
        return 'Production enregistrée avant le journal (v13.2) ou lot saisi à la main : corrigez le lot depuis le Stock.';
    }
    const lots = DB.get('lots') || [];
    const besoinParLot = new Map();
    prod.formats.forEach(f => besoinParLot.set(String(f.lotId), (besoinParLot.get(String(f.lotId)) || 0) + f.quantite));
    for (const [lotId, q] of besoinParLot) {
        const lot = lots.find(l => String(l.id) === lotId);
        if (!lot || (Number(lot.quantite) || 0) < q) {
            return `Des bouteilles du lot #${formatLotNumero(prod.numLot)} ont déjà été vendues, livrées ou sorties : annulation impossible.`;
        }
    }
    const commandes = DB.get('commandes') || [];
    const livree = prod.commandes.find(c => commandes.find(x => x.id === c.id)?.statut === 'livrée');
    if (livree) return `La commande #${livree.numero || ''} couverte par cette production est déjà livrée : annulation impossible.`;
    return '';
};

const PRODUCTION_JOURNAL_MAX = 12;

const productionJournalHtml = () => {
    const journal = getProductionsJournal();
    const aromes = DB.get('aromes') || [];
    const visibles = journal.slice(0, PRODUCTION_JOURNAL_MAX);
    const row = (p) => {
        const arome = aromes.find(a => normalizeName(a.nom) === normalizeName(p.aromeNom));
        const lotsIng = new Set(p.ingredients.filter(i => i.numLot).map(i => `${i.article}|${i.numLot}`)).size;
        const details = [
            `${prodFmtL(p.litres)}`,
            p.productionId ? (lotsIng ? dashPlural(lotsIng, "lot d'ingrédient", "lots d'ingrédients") : 'ingrédients sans n° de lot') : 'saisi à la main',
            p.commandes.length ? `${p.commandes.map(c => `#${c.numero}`).join(', ')} → produite${p.commandes.length > 1 ? 's' : ''}` : ''
        ].filter(Boolean).join(' · ');
        const couts = p.formats.filter(f => estMontantConnu(f.coutMatiereUnitaire));
        const annulable = !productionAnnulationBlocage(p);
        const premierLot = p.formats.find(f => f.lotId)?.lotId;
        return `
            <li class="stock-lot prod-journal-row">
                <div class="stock-lot-id">
                    <span class="stock-lot-num">#${escapeHtml(formatLotNumero(p.numLot))}</span>
                    <span class="stock-lot-qty">${escapeHtml(`${twinFmtInt(p.quantite)} bt`)}</span>
                </div>
                <div class="stock-lot-life">
                    <div class="stock-lot-name"><span class="aroma-tile-dot" style="background:${safeColor(arome?.couleur)}"></span>${escapeHtml(p.aromeNom || '?')}
                        <span class="stock-group-format">· ${escapeHtml(p.formats.map(f => `${twinFmtInt(f.quantite)} × ${f.format}`).join(', '))}</span></div>
                    <div class="stock-lot-dates">${escapeHtml(`${prodFmtDate(p.date)} · ${details}`)}</div>
                    ${couts.length ? `<div class="stock-lot-dates">Coût matières · ${escapeHtml(couts.map(f => `${f.format} : ${formatChfUnitaire(f.coutMatiereUnitaire)} / bt`).join(' · '))}</div>` : ''}
                </div>
                <div class="stock-lot-actions">
                    ${premierLot ? `<button type="button" class="btn btn-sm btn-secondary" data-click="show-lot-trace" data-id="${escapeHtml(premierLot)}">Tracer</button>` : ''}
                    ${annulable ? rowMenuHtml(`production ${p.aromeNom} lot ${formatLotNumero(p.numLot)}`,
                        `<button type="button" class="is-danger" data-click="production-annuler" data-id="${escapeHtml(p.productionId)}">Annuler la production</button>`) : ''}
                </div>
            </li>`;
    };
    return `
        <section class="stock-section" aria-labelledby="prodJournalTitle">
            <div class="stock-section-head">
                <h2 class="stock-section-title" id="prodJournalTitle">Journal des productions</h2>
                <span class="stock-section-meta">${escapeHtml(journal.length > visibles.length ? `${visibles.length} dernières sur ${journal.length}` : dashPlural(journal.length, 'production'))}</span>
                <a href="#historique" class="btn btn-sm btn-secondary stock-section-action">Tout l'historique</a>
            </div>
            ${visibles.length
                ? `<div class="stock-group"><ul class="stock-lot-list">${visibles.map(row).join('')}</ul></div>`
                : '<div class="commande-empty">Aucune production enregistrée.</div>'}
        </section>`;
};

const setProductionMode = (mode) => {
    const next = mode === 'manuel' ? 'manuel' : 'auto';
    if (productionMode === next) return;
    productionMode = next;
    productionVolumes = {};
    DB.setFilter('productionMode', next);
    renderProduction();
};

// Mode manuel : recalcule le plan et ne remplace que les chiffres et les
// résultats, sans reconstruire la grille de saisie (focus préservé)
const refreshProductionResults = () => {
    const plan = computeProductionPlan();
    const kpiEl = document.getElementById('productionKpi');
    if (kpiEl) kpiEl.innerHTML = productionKpiHtml(plan);
    const resultsEl = document.getElementById('productionResults');
    if (resultsEl) resultsEl.innerHTML = productionResultsHtml(plan);
};

const renderProduction = () => {
    if (productionMode === null) {
        productionMode = DB.getFilter('productionMode') === 'manuel' ? 'manuel' : 'auto';
    }
    const plan = computeProductionPlan();
    const modeToggleHtml = `
        <div class="segmented-filter" role="group" aria-label="Mode de calcul">
            <button type="button" class="segment ${productionMode !== 'manuel' ? 'active' : ''}" data-click="production-mode" data-value="auto" aria-pressed="${productionMode !== 'manuel'}">Commandes</button>
            <button type="button" class="segment ${productionMode === 'manuel' ? 'active' : ''}" data-click="production-mode" data-value="manuel" aria-pressed="${productionMode === 'manuel'}">Manuel</button>
        </div>`;

    safeRender(`
        ${pageToolbar('<button type="button" class="btn btn-secondary" data-click="production-stats">Statistiques</button>', modeToggleHtml)}
        <div id="productionKpi">${productionKpiHtml(plan)}</div>
        ${productionMode === 'manuel' ? productionManualHtml() : productionCommandesHtml(plan)}
        <div id="productionResults">${productionResultsHtml(plan)}</div>
        ${productionJournalHtml()}
    `);
    attacherProductionEvents();
};

const attacherProductionEvents = () => {
    const content = document.getElementById('content');
    if (content && !content.__prodSlider) {
        // Délégué une seule fois sur #content : survit aux re-rendus partiels
        content.__prodSlider = true;
        content.addEventListener('input', (e) => {
            const slider = e.target.closest?.('.cuve-slider[data-brassin]');
            if (slider) rebalanceRecipients(slider.dataset.brassin, parseInt(slider.dataset.recipientIndex, 10), parseFloat(slider.value));
        });
    }
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
    document.querySelectorAll('#productionCommandeList input[data-commande-id]').forEach(cb => {
        cb.addEventListener('change', (e) => toggleProductionCommande(e.target.dataset.commandeId));
    });

    // Focus rendu après un re-rendu déclenché par la sélection
    if (productionFocusTarget === 'selectAll') {
        document.getElementById('productionSelectAllBtn')?.focus();
    } else if (productionFocusTarget === 'deselectAll') {
        document.getElementById('productionDeselectAllBtn')?.focus();
    } else if (productionFocusTarget) {
        [...document.querySelectorAll('#productionCommandeList input[data-commande-id]')]
            .find(c => c.dataset.commandeId === productionFocusTarget)?.focus();
    }
    productionFocusTarget = null;
};

// Sélection des commandes : un Set explicite dès la première modification
// (les nouvelles commandes arrivent alors décochées)
const toggleProductionCommande = (id) => {
    if (!id) return;
    if (!productionSelectedCommandes) {
        productionSelectedCommandes = new Set((productionPlannerState?.commandes || []).map(c => c.commande.id));
    }
    if (productionSelectedCommandes.has(id)) productionSelectedCommandes.delete(id);
    else productionSelectedCommandes.add(id);
    productionFocusTarget = id;
    productionVolumes = {};
    renderProduction();
};

const productionSelect = (value) => {
    productionSelectedCommandes = value === 'all' ? null : new Set();
    productionFocusTarget = value === 'all' ? 'selectAll' : 'deselectAll';
    productionVolumes = {};
    renderProduction();
};

// Curseur d'un récipient : les autres récipients du brassin compensent (pas de
// 0,5 L) pour garder le volume total ; bouteilles et ingrédients suivent.
const rebalanceRecipients = (brassinKey, recipientIndex, nouvelleValeur) => {
    const brassin = productionPlannerState?.brassins.find(b => b.key === brassinKey);
    const recipients = brassin?.recipients;
    const recipient = recipients?.[recipientIndex];
    if (!recipient) return;

    const autresIndices = recipients.map((_, i) => i).filter(i => i !== recipientIndex);
    const totalAvant = roundHalfLiter(recipients.reduce((sum, r) => sum + r.litres, 0));
    const borne = (r, v) => Math.max(0.5, Math.min(r.capacite, roundHalfLiter(v)));

    if (autresIndices.length > 0) {
        recipient.litres = borne(recipient, nouvelleValeur);
        let units = Math.round((totalAvant - recipients.reduce((sum, r) => sum + r.litres, 0)) * 2);
        while (units !== 0) {
            const candidats = autresIndices.filter(i => units > 0 ? recipients[i].litres < recipients[i].capacite : recipients[i].litres > 0.5);
            if (candidats.length === 0) break;
            for (const i of candidats) {
                if (units === 0) break;
                recipients[i].litres = roundHalfLiter(recipients[i].litres + (units > 0 ? 0.5 : -0.5));
                units += units > 0 ? -1 : 1;
            }
        }
        // Les autres sont en butée : le récipient réglé absorbe le reste
        if (units !== 0) recipient.litres = borne(recipient, recipient.litres + units / 2);
    }

    majRecipientsBrassin(brassin);
    productionVolumes[brassinKey] = recipients.map(r => r.litres);
    mettreAJourRecipientsUI(brassin);
};

const mettreAJourRecipientsUI = (brassin) => {
    document.querySelectorAll('.prod-recipient[data-brassin]').forEach(li => {
        if (li.dataset.brassin !== brassin.key) return;
        const r = brassin.recipients[parseInt(li.dataset.recipientIndex, 10)];
        if (!r) return;
        const fill = r.capacite > 0 ? Math.round((r.litres / r.capacite) * 100) : 0;
        const litres = li.querySelector('[data-role="litres"]');
        if (litres) litres.textContent = `${prodFmtL(r.litres)} / ${r.capacite} L · ${fill} %`;
        const bar = li.querySelector('[data-role="fill"]');
        if (bar) bar.style.width = `${Math.min(100, fill)}%`;
        const slider = li.querySelector('.cuve-slider');
        if (slider && document.activeElement !== slider) slider.value = r.litres;
        const bt = li.querySelector('[data-role="bouteilles"]');
        if (bt) {
            bt.textContent = brassin.besoins.filter(x => r.bouteilles[x.format.id] > 0)
                .map(x => `${twinFmtInt(r.bouteilles[x.format.id])} × ${x.formatNom}`).join(' · ') || '—';
        }
        const ing = li.querySelector('[data-role="ingredients"]');
        if (ing) ing.innerHTML = prodIngredientsHtml(r.ingredients);
    });
};

const normalizeName = (value) => {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
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
        .replace(/[̀-ͯ]/g, '');
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

// --- Validation d'une production ---

// Lot qui recevra la production : celui de l'arôme produit aujourd'hui, sinon un nouveau numéro
const productionLotPrevu = (aromeNom, lots = DB.get('lots') || [], history = DB.get('history') || []) => {
    const dateProduction = getLocalDateISOString();
    const existant = lots.find(l => l.arome === aromeNom && l.dateProduction === dateProduction);
    return {
        dateProduction,
        ...calculateDates(dateProduction),
        numLot: existant ? (existant.numLot || existant.id) : nextLotNumero(lots, history),
        existant: !!existant
    };
};

// Commandes en attente que la production saisie rendrait entièrement couvertes
// (règle d'attribution rejouée avec les lots qu'elle créerait) et qui ne
// l'étaient pas avant : candidates au statut « produite ».
const commandesPretesApresProduction = (aromeNom, producedByFormat) => {
    if (producedByFormat.length === 0) return [];
    const now = new Date();
    const lots = DB.get('lots') || [];
    const prevu = productionLotPrevu(aromeNom, lots);
    const simules = [...lots, ...producedByFormat.map(({ format, quantite }) => ({
        id: `__sim-${format.id}`, numLot: prevu.numLot, arome: aromeNom, format: format.nom, quantite,
        dateProduction: prevu.dateProduction, dlv: prevu.dlv, dlc: prevu.dlc
    }))];
    const avant = planAttributionCommandes(now).plan;
    const pretes = [];
    planAttributionCommandes(now, { lots: simules }).plan.forEach(({ commande, client, lignes }) => {
        if (commande.statut !== 'en_attente' || lignes.length === 0 || lignes.some(l => l.manque > 0)) return;
        if (!avant.get(commande.id)?.lignes.some(l => l.manque > 0)) return;
        pretes.push({ commande, client });
    });
    return pretes;
};

// Bouteilles saisies dans la fenêtre de production
const productionSaisie = (form) => {
    const formats = DB.get('formats') || [];
    const producedByFormat = [];
    form?.querySelectorAll('input[data-format-id]').forEach(input => {
        const format = formats.find(f => f.id === input.dataset.formatId);
        const quantite = Math.max(0, parseInt(input.value, 10) || 0);
        if (format && quantite > 0) producedByFormat.push({ format, quantite });
    });
    return {
        producedByFormat,
        totalBouteilles: producedByFormat.reduce((s, p) => s + p.quantite, 0),
        litresProduit: producedByFormat.reduce((s, p) => s + ((Number(p.format.contenanceCl) || 0) * p.quantite) / 100, 0)
    };
};

const showProductionModal = (brassinKey, recipientIndex = null) => {
    const b = productionPlannerState?.brassins.find(x => x.key === brassinKey);
    const recipients = b ? (recipientIndex === null ? b.recipients : [b.recipients[recipientIndex]].filter(Boolean)) : [];
    if (!b || recipients.length === 0) {
        showToast('Plan de production introuvable, rechargez la page', 'error');
        return;
    }
    const prefill = {};
    recipients.forEach(r => Object.entries(r.bouteilles || {}).forEach(([fid, n]) => { prefill[fid] = (prefill[fid] || 0) + n; }));
    const formats = (DB.get('formats') || []).filter(f => f.actif !== false || prefill[f.id] > 0);
    const volume = recipients.reduce((s, r) => s + r.litres, 0);
    const capacite = recipients.reduce((s, r) => s + r.capacite, 0);
    const ingredients = calculerIngredientsRecipient(b.recette, volume);
    const lot = productionLotPrevu(b.aromeNom);

    modal.show(`Production · ${b.aromeNom}`, `
        <form id="productionForm" data-arome="${escapeHtml(b.aromeNom)}" data-brassin="${escapeHtml(b.key)}" data-capacite="${safeNumAttr(capacite)}" onsubmit="return false">
            <div class="workflow-summary">
                <div><span>Postes</span><strong>${escapeHtml([...new Set(recipients.map(r => r.fournee))]
                    .map(f => `F${f} · ${recipients.filter(r => r.fournee === f).map(r => r.poste).join(', ')}`).join(' ; '))}</strong></div>
                <div><span>Volume prévu</span><strong>${escapeHtml(`${prodFmtL(volume)} / ${capacite} L`)}</strong></div>
                <div><span>Lot</span><strong>#${escapeHtml(formatLotNumero(lot.numLot))}${lot.existant ? ' (complété)' : ''}</strong></div>
                <div><span>DLV · DLC</span><strong>${escapeHtml(lot.dlv ? `${formatDate(lot.dlv)} · ${formatDate(lot.dlc)}` : '—')}</strong></div>
            </div>
            <div class="prod-modal-grid">
                <div>
                    <h4 class="prod-modal-h">Bouteilles remplies</h4>
                    <div class="prod-modal-formats">
                        ${formats.length ? formats.map(f => `
                            <label class="prod-manual-field">
                                <span>${escapeHtml(f.nom)}</span>
                                <input type="number" min="0" step="1" inputmode="numeric" data-format-id="${escapeHtml(String(f.id))}" value="${prefill[f.id] || 0}">
                            </label>`).join('') : '<p class="text-muted">Aucun format actif</p>'}
                    </div>
                    <p class="prod-modal-total" id="prodModalTotal" aria-live="polite"></p>
                </div>
                <div>
                    <h4 class="prod-modal-h">À peser pour ${escapeHtml(prodFmtL(volume))}</h4>
                    ${ingredients.length
                        ? `<ul class="ingredient-list">${prodIngredientsHtml(ingredients)}</ul>`
                        : '<p class="text-muted">Aucune recette pour cet arôme : rien ne sera déduit en ingrédients.</p>'}
                </div>
            </div>
            <h4 class="prod-modal-h">Déduit de l'inventaire</h4>
            <div id="prodModalMatieres"></div>
            <h4 class="prod-modal-h">Commandes prêtes après cette production</h4>
            <div id="prodModalCommandes"></div>
        </form>
    `, `
        <button type="button" class="btn btn-secondary" onclick="modal.hide()">Annuler</button>
        <button type="button" class="btn btn-primary" data-click="production-valider" id="prodModalConfirm">Confirmer la production</button>
    `, 'large');

    const form = document.getElementById('productionForm');
    form?.addEventListener('input', (e) => {
        if (e.target.matches?.('input[data-format-id]')) majProductionModal();
    });
    majProductionModal();
};

// Total, déduction d'inventaire et commandes prêtes, recalculés à chaque saisie
const majProductionModal = () => {
    const form = document.getElementById('productionForm');
    if (!form) return;
    const aromeNom = form.dataset.arome;
    const capacite = Number(form.dataset.capacite) || 0;
    const s = productionSaisie(form);

    const total = document.getElementById('prodModalTotal');
    if (total) {
        total.textContent = s.totalBouteilles
            ? `${twinFmtInt(s.totalBouteilles)} bt = ${prodFmtL(s.litresProduit)}${s.litresProduit > capacite + 1e-9 ? ` : plus que la capacité des récipients (${capacite} L)` : ''}`
            : '';
        total.classList.toggle('is-danger', s.litresProduit > capacite + 1e-9);
    }

    const matEl = document.getElementById('prodModalMatieres');
    if (matEl) {
        const inventaire = DB.get('inventaire') || [];
        const copie = JSON.parse(JSON.stringify(inventaire));
        const { warnings, conversionErrors, ingredients, contenants, couts } = deduireInventaireProduction(copie, aromeNom, s.producedByFormat, s.litresProduit);
        const parArticle = new Map();
        [...ingredients, ...contenants].forEach(l => {
            const e = parArticle.get(l.article) || { article: l.article, itemId: l.itemId, unite: l.unite, quantite: 0, lots: [] };
            e.quantite = arrondiInv(e.quantite + l.quantite);
            if (l.numLot) e.lots.push(l.numLot);
            parArticle.set(l.article, e);
        });
        const lignes = [...parArticle.values()].map(e => {
            const apres = Number(copie.find(c => c.id === e.itemId)?.quantite) || 0;
            const item = inventaire.find(i => i.id === e.itemId);
            return `
                <li class="prod-mat${apres < -1e-9 ? ' is-short' : ''}">
                    <span class="prod-mat-name">${escapeHtml(e.article)}${e.lots.length ? `<small> · lot${e.lots.length > 1 ? 's' : ''} ${escapeHtml([...new Set(e.lots)].join(', '))}</small>` : ''}</span>
                    <span class="prod-mat-num"><span class="prod-mat-lbl">Déduit</span>${escapeHtml(invFmtQte(e.quantite, item?.unite || e.unite))}</span>
                    <span class="prod-mat-num prod-mat-after"><span class="prod-mat-lbl">${apres < -1e-9 ? 'Manque' : 'Reste'}</span>${escapeHtml(invFmtQte(Math.abs(apres), item?.unite || e.unite))}</span>
                </li>`;
        }).join('');
        const notes = [...conversionErrors, ...warnings.filter(w => !w.startsWith('Stock insuffisant'))];
        const prixManquants = [...new Set([...couts.values()].flatMap(c => [...c.manquants]))];
        const coutsHtml = s.producedByFormat.map(({ format }) => {
            const cout = couts.get(format.id).unitaire;
            return `<li>${escapeHtml(format.nom)} · <strong>${estMontantConnu(cout) ? `${escapeHtml(formatChfUnitaire(cout))} / bt` : 'indisponible'}</strong></li>`;
        }).join('');
        matEl.innerHTML = `
            ${lignes ? `<ul class="prod-mat-list prod-mat-list--compact">${lignes}</ul>` : '<p class="text-muted">Rien à déduire.</p>'}
            ${notes.length ? `<ul class="prod-modal-notes">${notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : ''}
            ${coutsHtml ? `<h4 class="prod-modal-h">Coût matières par bouteille</h4>
                <ul class="ingredient-list">${coutsHtml}</ul>
                ${prixManquants.length ? `<p class="text-muted">Données manquantes ou incompatibles : ${escapeHtml(prixManquants.join(', '))}. Vérifiez les recettes et les prix d’achat dans l’inventaire.</p>` : ''}` : ''}`;
    }

    const cmdEl = document.getElementById('prodModalCommandes');
    if (cmdEl) {
        const avant = new Map([...cmdEl.querySelectorAll('input[data-commande-id]')].map(i => [i.dataset.commandeId, i.checked]));
        const pretes = commandesPretesApresProduction(aromeNom, s.producedByFormat);
        cmdEl.innerHTML = pretes.length
            ? `<ul class="prod-modal-cmds">${pretes.map(({ commande, client }) => `
                <li><label class="prod-modal-cmd">
                    <input type="checkbox" data-commande-id="${escapeHtml(commande.id)}" ${avant.get(commande.id) === false ? '' : 'checked'}>
                    <span>#${escapeHtml(getCommandeNumero(commande))} · ${escapeHtml(getClientLabel(client))}</span>
                    ${prodEcheanceHtml(commande.dateLivraison)}
                </label></li>`).join('')}</ul>`
            : '<p class="text-muted">Aucune commande en attente ne devient entièrement couverte.</p>';
    }
};

// Déductions d'inventaire d'une production (ingrédients de la recette, bouteilles
// vides, bouchons) appliquées au tableau `inventaire` fourni. N'écrit rien en base.
// `ingredients` : lots d'ingrédients consommés, dans l'ordre d'utilisation
// ({ itemId, article, unite, numLot, fournisseur, quantite } ; numLot '' = sans n° de lot).
// `contenants` : bouteilles vides et bouchons déduits ({ itemId, article, unite, quantite }),
// pour pouvoir annuler la production à l'identique.
const deduireInventaireProduction = (inventaire, aromeNom, producedByFormat, litresProduit) => {
    const aromes = DB.get('aromes') || [];
    const recettes = DB.get('recettes') || [];
    const arome = aromes.find(a => a.nom === aromeNom);
    const recette = recettes.find(r => r.aromeId === arome?.id);
    const warnings = [];
    const ingredients = [];
    const contenants = [];
    const manquantsLiquide = new Set();
    let coutLiquide = 0;
    // Erreurs de conversion incompatibles : bloquantes, distinctes des
    // avertissements métier (stock / ingrédient manquant). Une incohérence
    // d'unités ne peut jamais être confirmée par l'utilisateur.
    const conversionErrors = [];

    if (recette && Array.isArray(recette.ingredients)) {
        recette.ingredients.forEach(ing => {
            const eau = isWaterIngredient(ing.nom);
            const ingQty = parseFloat(ing.quantite);
            if (!estMontantConnu(ingQty)) {
                manquantsLiquide.add(ing.nom);
                if (!eau) warnings.push(`Quantité de recette invalide pour ${ing.nom}`);
                return;
            }
            if (ingQty === 0) return;
            const besoinMajore = ingQty * litresProduit * CONSTANTS.PRODUCTION_LOSS;
            const item = findInventaireItemByName(inventaire, ing.nom);
            if (eau) {
                const prix = prixAchatDansUnite(item, ing.unite);
                if (estMontantConnu(prix)) coutLiquide += besoinMajore * prix;
                else manquantsLiquide.add(ing.nom);
                return;
            }
            if (!item) {
                manquantsLiquide.add(ing.nom);
                warnings.push(`Ingrédient absent: ${ing.nom}`);
                return;
            }
            const ingUnit = displayUnit(ing.unite);
            const invUnit = displayUnit(item.unite);
            if (!areUnitsCompatible(ingUnit, invUnit)) {
                manquantsLiquide.add(ing.nom);
                conversionErrors.push(`Unité incompatible pour ${ing.nom} (recette: ${ingUnit}, inventaire: ${invUnit})`);
                return;
            }
            const converted = ingUnit !== invUnit ? convertQuantity(besoinMajore, ingUnit, invUnit) : besoinMajore;
            if (converted === null) {
                manquantsLiquide.add(ing.nom);
                conversionErrors.push(`Conversion impossible pour ${ing.nom}`);
                return;
            }
            if ((item.quantite || 0) < converted) warnings.push(`Stock insuffisant: ${item.nom}`);
            const allocations = isLotSuiviArticle(item)
                ? consommerLotsIngredient(item, converted)
                : [{ numLot: '', fournisseur: '', quantite: arrondiInv(converted) }];
            allocations.forEach(a => {
                const prix = a.numLot ? a.prixUnitaire : prixAchatDansUnite(item, invUnit);
                if (estMontantConnu(prix)) coutLiquide += a.quantite * prix;
                else if (a.quantite > 0) manquantsLiquide.add(item.nom);
                ingredients.push({ itemId: item.id, article: item.nom, unite: invUnit, ...a, ...(estMontantConnu(prix) ? { prixUnitaire: prix } : {}) });
            });
            item.quantite = Math.round(((item.quantite || 0) - converted) * 10000) / 10000;
        });
    } else {
        manquantsLiquide.add(`recette ${aromeNom}`);
        warnings.push(`Recette introuvable pour ${aromeNom}`);
    }

    const deduireContenant = (item, quantite) => {
        if ((item.quantite || 0) < quantite) warnings.push(`Stock insuffisant: ${item.nom}`);
        item.quantite = (item.quantite || 0) - quantite;
        contenants.push({ itemId: item.id, article: item.nom, unite: displayUnit(item.unite), quantite });
    };

    // Bouchons : déduction par taille (25cl vs 50/100cl)
    let btPetitBouchon = 0, btGrandBouchon = 0;
    producedByFormat.forEach(({ format, quantite }) => {
        if ((format.contenanceCl || 0) < 50) btPetitBouchon += quantite;
        else btGrandBouchon += quantite;
    });

    const bouchonsPetitsNecessaires = Math.ceil(btPetitBouchon * CONSTANTS.BOUCHON_MARGIN);
    const bouchonsGrandsNecessaires = Math.ceil(btGrandBouchon * CONSTANTS.BOUCHON_MARGIN);
    const nomPetit = 'Bouchons 25cl';
    const nomGrand = 'Bouchons 50cl/100cl';
    const bouchonPetitItem = findInventaireItemByName(inventaire, nomPetit);
    const bouchonGrandItem = findInventaireItemByName(inventaire, nomGrand);
    const etiquettes = findInventaireItemByName(inventaire, 'Étiquettes');
    const couts = new Map();

    producedByFormat.forEach(({ format, quantite }) => {
        const bottleItem = getBottleInventoryItem(inventaire, format);
        if (!bottleItem) warnings.push(`Bouteilles vides absentes pour ${format.nom}`);
        else deduireContenant(bottleItem, quantite);

        const petit = (format.contenanceCl || 0) < 50;
        const litres = Number(format.contenanceCl) / 100;
        const manquants = new Set(manquantsLiquide);
        let unitaire = litresProduit > 0 ? coutLiquide * litres / litresProduit : 0;
        if (!(litres > 0) || !(litresProduit > 0)) manquants.add(`contenance ${format.nom}`);
        const emballages = [
            { item: bottleItem, nom: `Bouteilles vides ${format.nom}`, parBouteille: 1 },
            { item: petit ? bouchonPetitItem : bouchonGrandItem, nom: petit ? nomPetit : nomGrand,
                parBouteille: petit ? bouchonsPetitsNecessaires / btPetitBouchon : bouchonsGrandsNecessaires / btGrandBouchon },
            { item: etiquettes, nom: 'Étiquettes', parBouteille: 1 }
        ];
        emballages.forEach(({ item, nom, parBouteille }) => {
            const prix = prixAchatDansUnite(item, 'pcs');
            if (estMontantConnu(prix)) unitaire += prix * parBouteille;
            else manquants.add(nom);
        });
        couts.set(format.id, { unitaire: manquants.size || !estMontantConnu(unitaire) ? null : unitaire, manquants });
    });

    if (bouchonsPetitsNecessaires > 0) {
        if (bouchonPetitItem) deduireContenant(bouchonPetitItem, bouchonsPetitsNecessaires);
        else warnings.push('Bouchons 25cl absents de l\'inventaire');
    }
    if (bouchonsGrandsNecessaires > 0) {
        if (bouchonGrandItem) deduireContenant(bouchonGrandItem, bouchonsGrandsNecessaires);
        else warnings.push('Bouchons 50cl/100cl absents de l\'inventaire');
    }

    return { warnings, conversionErrors, ingredients, contenants, couts };
};

// Annule une production pour incohérence d'unités (premier élément + nombre restant)
const annulerProductionUnites = (conversionErrors) => {
    const first = conversionErrors[0];
    const remaining = conversionErrors.length - 1;
    showToast(
        `Production annulée : ${first}${remaining > 0 ? ` (+${remaining} autre${remaining > 1 ? 's' : ''})` : ''}. Corrigez les unités de la recette.`,
        'error'
    );
    return false;
};

// Enregistre une production : lots (un n° par arôme et par jour), entrées PROD-
// de l'historique (lots d'ingrédients, contenants, commandes couvertes),
// déduction d'inventaire, et passage « produite » des commandes cochées.
const finaliserProductionFormats = async (aromeNom, producedByFormat, litresProduit, { commandeIds = [] } = {}) => {
    // Contrôle sur une copie, avant toute persistance : une incohérence d'unités
    // annule, les avertissements (stock, ingrédient manquant) se confirment.
    const controle = deduireInventaireProduction(
        JSON.parse(JSON.stringify(DB.get('inventaire') || [])), aromeNom, producedByFormat, litresProduit);
    if (controle.conversionErrors.length > 0) return annulerProductionUnites(controle.conversionErrors);

    if (controle.warnings.length > 0) {
        const ok = await confirmDialog(
            `Attention: ${controle.warnings[0]}${controle.warnings.length > 1 ? ` (+${controle.warnings.length - 1})` : ''}. Confirmer quand même la production ?`,
            { danger: true, confirmLabel: 'Confirmer quand même', title: 'Inventaire insuffisant' }
        );
        if (!ok) return false;
    }

    // Relecture APRÈS la confirmation : pendant la boîte, un autre appareil a pu
    // modifier l'inventaire, les lots, l'historique ou les commandes. DB.set
    // réécrit la table entière : des tableaux lus avant l'attente effaceraient
    // ces changements sans qu'aucun conflit ne soit détecté.
    const inventaire = (DB.get('inventaire') || []).map(item => ({ ...item, ...(Array.isArray(item.lots) ? { lots: item.lots.map(l => ({ ...l })) } : {}) }));
    const { warnings, conversionErrors, ingredients, contenants, couts } = deduireInventaireProduction(inventaire, aromeNom, producedByFormat, litresProduit);
    if (conversionErrors.length > 0) return annulerProductionUnites(conversionErrors);
    const lots = DB.get('lots') || [];
    const history = DB.get('history') || [];
    const commandes = DB.get('commandes') || [];

    // Seules les commandes encore en attente passent « produite »
    const marquees = [];
    commandes.forEach(c => {
        if (!commandeIds.includes(c.id) || c.statut !== 'en_attente') return;
        c.statut = 'produite';
        marquees.push({ id: c.id, numero: getCommandeNumero(c) });
    });

    // Traçabilité : chaque entrée PROD- de cette production porte les lots
    // d'ingrédients utilisés et les contenants (quantités pour toute la
    // production, tous formats), le volume et les commandes couvertes
    const productionId = generateId();
    const tracesProduction = {
        productionId,
        litres: Math.round(litresProduit * 1000) / 1000,
        contenants,
        ...(ingredients.length ? { ingredients } : {}),
        ...(marquees.length ? { commandes: marquees } : {})
    };

    const { dateProduction, dlv, dlc, numLot } = productionLotPrevu(aromeNom, lots, history);
    producedByFormat.forEach(({ format, quantite }) => {
        const cout = couts.get(format.id).unitaire;
        let lot = lots.find(l => l.arome === aromeNom && l.format === format.nom && l.dateProduction === dateProduction);
        if (lot) {
            if (!lot.numLot) lot.numLot = numLot;
        } else {
            lot = { id: generateId(), numLot, arome: aromeNom, format: format.nom, quantite: 0, dateProduction, dlv, dlc };
            lots.push(lot);
        }
        ajouterBouteillesAuLot(lot, quantite, cout);
        history.unshift(buildLotHistoryEntry('PROD', lot, quantite, {
            ...tracesProduction, ...(estMontantConnu(cout) ? { coutMatiereUnitaire: cout } : {})
        }));
    });

    DB.set('inventaire', inventaire);
    DB.set('lots', lots);
    DB.set('history', history);
    if (marquees.length) DB.set('commandes', commandes);
    return { warnings, numLot, commandes: marquees };
};

const validerProduction = async (event) => {
    const form = document.getElementById('productionForm');
    if (!form) {
        showToast('Données de production introuvables', 'error');
        return;
    }
    // Tout est lu avant l'éventuelle confirmation, qui remplace le contenu de la fenêtre
    const aromeNom = form.dataset.arome;
    const brassinKey = form.dataset.brassin;
    const { producedByFormat, totalBouteilles, litresProduit } = productionSaisie(form);
    const commandeIds = [...form.querySelectorAll('#prodModalCommandes input[data-commande-id]:checked')].map(i => i.dataset.commandeId);
    if (producedByFormat.length === 0) {
        showToast('Veuillez saisir au moins une quantité produite', 'warning');
        return;
    }

    const reenable = disableSaveBtn(event);
    try {
        const result = await finaliserProductionFormats(aromeNom, producedByFormat, litresProduit, { commandeIds });
        if (!result) return;

        modal.hide();
        // Mode manuel : ce qui vient d'être produit sort de la saisie
        const aromes = DB.get('aromes') || [];
        const arome = aromes.find(a => a.nom === aromeNom);
        if (arome) {
            producedByFormat.forEach(({ format, quantite }) => {
                const key = `${arome.id}|${format.id}`;
                if (!productionManualQuantities[key]) return;
                const reste = productionManualQuantities[key] - quantite;
                if (reste > 0) productionManualQuantities[key] = reste;
                else delete productionManualQuantities[key];
            });
        }
        delete productionVolumes[brassinKey];

        const cmds = result.commandes.length ? ` · ${result.commandes.map(c => `#${c.numero}`).join(', ')} produite${result.commandes.length > 1 ? 's' : ''}` : '';
        showToast(`Production confirmée : ${totalBouteilles} bt, lot #${formatLotNumero(result.numLot)}${cmds}`);
        if (result.warnings.length > 0) {
            showToast(`Attention: ${result.warnings[0]}${result.warnings.length > 1 ? ` (+${result.warnings.length - 1})` : ''}`, 'warning');
        }
        renderCurrentView();
    } catch (e) {
        console.error('Error validating production:', e);
        showToast('Erreur lors de la validation de la production', 'error');
    } finally {
        if (reenable) reenable();
    }
};

// Défait une production du journal : bouteilles retirées des lots, ingrédients
// (dans leurs lots fournisseur), bouteilles vides et bouchons rendus à
// l'inventaire, commandes couvertes remises « en attente », entrées PROD- retirées.
const annulerProduction = async (productionId) => {
    const prod = getProductionsJournal().find(p => p.productionId === productionId);
    if (!prod) { showToast('Production introuvable', 'error'); return; }
    const blocage = productionAnnulationBlocage(prod);
    if (blocage) { showToast(blocage, 'warning'); return; }

    const ok = await confirmDialog(
        `Annuler la production ${prod.aromeNom} du ${prodFmtDate(prod.date)} (lot #${formatLotNumero(prod.numLot)}, ${prod.quantite} bt) ? `
        + 'Les bouteilles sortent du stock, les ingrédients, bouteilles vides et bouchons reviennent à l\'inventaire'
        + (prod.commandes.length ? ` et ${prod.commandes.map(c => `#${c.numero}`).join(', ')} repasse${prod.commandes.length > 1 ? 'nt' : ''} « en attente »` : '')
        + '. La production disparaît du journal.',
        { danger: true, title: 'Annuler une production', confirmLabel: 'Annuler la production', cancelLabel: 'Garder' }
    );
    if (!ok) return;

    // Relecture après la confirmation (DB.set réécrit les tables entières)
    const actuelle = getProductionsJournal().find(p => p.productionId === productionId);
    const blocageApres = actuelle ? productionAnnulationBlocage(actuelle) : 'Production introuvable';
    if (blocageApres) { showToast(blocageApres, 'warning'); return; }

    const lots = DB.get('lots') || [];
    const history = DB.get('history') || [];
    const inventaire = DB.get('inventaire') || [];
    const commandes = DB.get('commandes') || [];

    actuelle.formats.forEach(f => {
        const index = lots.findIndex(l => String(l.id) === String(f.lotId));
        if (index < 0) return;
        const lot = lots[index];
        lot.quantite = (Number(lot.quantite) || 0) - f.quantite;
        const mouvements = history.filter(h => String(h.lotId) === String(lot.id) && h.productionId !== productionId);
        if (mouvements.every(h => String(h.id).startsWith('PROD-') && estMontantConnu(h.coutMatiereUnitaire))
            && mouvements.reduce((s, h) => s + Number(h.quantity), 0) === lot.quantite && lot.quantite > 0) {
            lot.coutMatiereUnitaire = mouvements.reduce((s, h) => s + h.quantity * h.coutMatiereUnitaire, 0) / lot.quantite;
        } else {
            delete lot.coutMatiereUnitaire;
        }
        // Comme une vente qui vide un lot : le lot à 0 disparaît, l'historique reste
        if (lots[index].quantite <= 0) lots.splice(index, 1);
    });

    const article = (l) => inventaire.find(i => i.id === l.itemId) || findInventaireItemByName(inventaire, l.article);
    actuelle.ingredients.forEach(l => {
        const item = article(l);
        if (!item) return;
        item.quantite = arrondiInv((Number(item.quantite) || 0) + (Number(l.quantite) || 0));
        if (!l.numLot) return;
        const lot = (item.lots || []).find(x => normLotFournisseur(x.numLot) === normLotFournisseur(l.numLot)
            && normLotFournisseur(x.fournisseur) === normLotFournisseur(l.fournisseur));
        if (lot) lot.quantite = arrondiInv((Number(lot.quantite) || 0) + (Number(l.quantite) || 0));
    });
    actuelle.contenants.forEach(l => {
        const item = article(l);
        if (item) item.quantite = arrondiInv((Number(item.quantite) || 0) + (Number(l.quantite) || 0));
    });

    const remises = [];
    commandes.forEach(c => {
        if (!actuelle.commandes.some(x => x.id === c.id) || c.statut !== 'produite') return;
        c.statut = 'en_attente';
        remises.push(c.id);
    });

    DB.set('lots', lots);
    DB.set('inventaire', inventaire);
    DB.set('history', history.filter(h => !(String(h.id || '').startsWith('PROD-') && h.productionId === productionId)));
    if (remises.length) DB.set('commandes', commandes);
    showToast(`Production annulée : ${actuelle.quantite} bt retirées du lot #${formatLotNumero(actuelle.numLot)}`);
    renderCurrentView();
};
