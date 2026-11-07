// =============================================================================
// Comptabilité (v13.6) — le classeur « Comptabilité SàRL » (modèle Buchhaltung
// v2.4) repris tel quel : même plan comptable (emplacements fixes), même journal
// en partie double (le n° d'écriture est la ligne Excel et sert de n° de facture),
// mêmes bilans, compte de résultat, créances clients et dettes. Le classeur
// s'importe et s'exporte dans le même format (templates/compta_template.xlsx).
// =============================================================================

// Emplacements du plan comptable, dans l'ordre du classeur (feuille « Plan de Compte »)
const COMPTA_CLASSES = [
    { id: 'actif', label: 'Actifs', places: 15, lignePlan: 9 },
    { id: 'passif', label: 'Passifs', places: 18, lignePlan: 25 },
    { id: 'charge', label: 'Charges', places: 19, lignePlan: 54 },
    { id: 'produit', label: 'Produits', places: 16, lignePlan: 74 }
];
const COMPTA_XLSX = {
    modele: 'templates/compta_template.xlsx',
    journal: [12, 1619],      // lignes d'écritures du Journal
    creances: [7, 199],       // feuille Créance-client
    dettes: [9, 97],          // feuille Dette fournisseur
    feuilles: {
        base: 'xl/worksheets/sheet1.xml', plan: 'xl/worksheets/sheet2.xml', ouverture: 'xl/worksheets/sheet3.xml',
        journal: 'xl/worksheets/sheet4.xml', bilan: 'xl/worksheets/sheet5.xml', resultat: 'xl/worksheets/sheet6.xml',
        paye: 'xl/worksheets/sheet7.xml', creances: 'xl/worksheets/sheet8.xml', dettes: 'xl/worksheets/sheet9.xml'
    }
};
const COMPTA_VUES = [
    ['journal', 'Journal'], ['grand-livre', 'Grand livre'], ['bilan', 'Bilan'], ['resultat', 'Résultat'], ['stats', 'Statistiques'],
    ['creances', 'Créances'], ['dettes', 'Dettes'], ['plan', 'Plan comptable']
];
const COMPTA_JOURNAL_PAGE = 150;

let comptaJournalTout = false;
let comptaDerniereDate = '';
let comptaImport = null;
let comptaOuvertureEdition = false;
let comptaOuvertureBrouillon = null;
let comptaOuvertureFocus = false;

// --- Formats -------------------------------------------------------------------
const comptaRound = (n) => Math.round((Number(n) || 0) * 100) / 100;
const comptaFmt = (n) => comptaRound(n).toLocaleString('fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const comptaDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : (iso || ''));
const comptaDateCourte = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : '');
const comptaIsoValide = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso || '') && !Number.isNaN(new Date(`${iso}T12:00:00`).getTime());
// Numéros de série Excel (1 = 01.01.1900 ; Excel compte un 29.02.1900 qui n'existe pas)
const comptaSerialVersIso = (n) => new Date(Math.round((Number(n) + (Number(n) < 60 ? 1 : 0) - 25569) * 86400000)).toISOString().slice(0, 10);
const comptaIsoVersSerial = (iso) => {
    const n = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000 + 25569;
    return n < 61 ? n - 1 : n;
};
const comptaNum = (v) => String(v ?? '').trim();
const comptaEstClasseBilan = (classe) => classe === 'actif' || classe === 'passif';

// N° d'une pièce (facture, dette) : la ligne du journal, préfixée de l'année hors de l'exercice affiché
const comptaNumeroPiece = (e, annee) => (e.annee === annee ? String(e.ligne) : `${e.annee}-${e.ligne}`);

// --- Données -----------------------------------------------------------------------
const comptaExercices = () => (DB.get('compta_exercices') || []).slice().sort((a, b) => a.annee - b.annee);
const comptaExerciceCourant = () => {
    const liste = comptaExercices();
    if (!liste.length) return null;
    const choisi = Number(DB.getFilter('compta_annee'));
    return liste.find(e => e.annee === choisi) || liste[liste.length - 1];
};
const comptaEcrituresDe = (annee, toutes = DB.get('compta_ecritures') || []) => toutes.filter(e => e.annee === annee);
const comptaProchaineLigne = (annee, toutes = DB.get('compta_ecritures') || []) =>
    Math.max(COMPTA_XLSX.journal[0] - 1, ...comptaEcrituresDe(annee, toutes).map(e => Number(e.ligne) || 0)) + 1;
const comptaExercicePourDate = (iso, exercices = comptaExercices()) => exercices.find(x => iso >= x.debut && iso <= x.fin) || null;

// Emplacements vides du plan (68), dans l'ordre du classeur
const comptaPlanVide = () => COMPTA_CLASSES.flatMap(c => Array.from({ length: c.places }, () => ({ classe: c.id, numero: '', nom: '', remarque: '', ouverture: 0 })));

// Un compte n'existe pour le classeur que s'il a un numéro ET un nom (en-têtes du
// grand livre, ligne 7 du Journal) : les écritures sur les autres sont ignorées.
const comptaCompteActif = (c) => !!(comptaNum(c.numero) && String(c.nom || '').trim());

// Soldes, bilan et résultat, calculés comme les formules du classeur
const comptaCalcul = (ex, ecritures) => {
    const comptes = (ex.comptes || []).map((c, place) => ({ ...c, place, numero: comptaNum(c.numero), actif: comptaCompteActif(c), debit: 0, credit: 0 }));
    const parNum = new Map();
    comptes.forEach(c => { if (c.actif && !parNum.has(c.numero)) parNum.set(c.numero, c); });
    const inconnues = [];
    ecritures.forEach(e => {
        const montant = Number(e.montant) || 0;
        const d = parNum.get(comptaNum(e.debit));
        const k = parNum.get(comptaNum(e.credit));
        if (d) d.debit += montant;
        if (k) k.credit += montant;
        if (!d || !k) inconnues.push(e);
    });
    comptes.forEach(c => {
        const ouverture = comptaEstClasseBilan(c.classe) ? comptaRound(c.ouverture) : 0;
        c.ouverture = ouverture;
        c.debit = comptaRound(c.debit);
        c.credit = comptaRound(c.credit);
        c.solde = !c.actif ? null : (c.classe === 'actif' || c.classe === 'charge')
            ? comptaRound(ouverture + c.debit - c.credit)
            : comptaRound(ouverture + c.credit - c.debit);
    });
    const somme = (classe, champ) => comptaRound(comptes.filter(c => c.classe === classe && c.actif).reduce((s, c) => s + c[champ], 0));
    const ouvertureTotal = (classe) => comptaRound(comptes.filter(c => c.classe === classe).reduce((s, c) => s + c.ouverture, 0));
    const actifs = somme('actif', 'solde');
    const passifs = somme('passif', 'solde');
    const charges = somme('charge', 'solde');
    const produits = somme('produit', 'solde');
    const resultat = comptaRound(produits - charges);
    return {
        comptes, parNum, inconnues, actifs, passifs, charges, produits, resultat,
        ouvertureActifs: ouvertureTotal('actif'), ouverturePassifs: ouvertureTotal('passif'),
        ecart: comptaRound(actifs - passifs - resultat)
    };
};

// Pièces ouvertes : factures (débit du compte de créances) et dettes (crédit du
// compte de dettes) pas encore réglées, de l'exercice et des précédents
const comptaEstFacture = (e, ex) => !!ex.compteCreances && comptaNum(e.debit) === comptaNum(ex.compteCreances);
const comptaEstDette = (e, ex) => !!ex.compteDettes && comptaNum(e.credit) === comptaNum(ex.compteDettes);
const comptaOuverteAu = (e, dateFin) => !e.regle || (!!e.regle.date && e.regle.date > dateFin);
const comptaPieces = (ex, type, toutes = DB.get('compta_ecritures') || [], exercices = comptaExercices()) => {
    const parAnnee = new Map(exercices.map(x => [x.annee, x]));
    return toutes.filter(e => {
        const exE = parAnnee.get(e.annee);
        if (!exE || e.annee > ex.annee) return false;
        return type === 'creance' ? comptaEstFacture(e, exE) : comptaEstDette(e, exE);
    });
};
const comptaPiecesOuvertes = (ex, type, toutes, exercices) => {
    const fin = ex.fin < getLocalDateISOString() ? ex.fin : '9999-12-31';
    return comptaPieces(ex, type, toutes, exercices)
        .filter(e => comptaOuverteAu(e, fin))
        .sort((a, b) => a.annee - b.annee || a.ligne - b.ligne);
};

// Texte d'une pièce : client de la facture, objet de la dette
const comptaPieceTexte = (e, type) => {
    if (e.piece?.texte) return e.piece.texte;
    const lib = String(e.libelle || '').trim();
    if (type === 'creance') return lib.replace(/^(livraison|facturation|facture|envoi facture)\s+/i, '');
    const m = /^\S+\s+a\s+pay[ée]\s+(.+)$/i.exec(lib);
    return m ? m[1] : lib;
};
const comptaPieceTiers = (e, type) => {
    if (e.piece?.tiers) return e.piece.tiers;
    if (type !== 'dette') return '';
    const m = /^(\S+)\s+a\s+pay[ée]\s/i.exec(String(e.libelle || '').trim());
    return m ? m[1] : '';
};

// =============================================================================
// Vue
// =============================================================================
const renderComptabilite = () => {
    const exercices = comptaExercices();
    const ex = comptaExerciceCourant();
    const vueFiltre = DB.getFilter('compta_vue');
    const vue = COMPTA_VUES.some(([v]) => v === vueFiltre) ? vueFiltre : 'journal';
    if (!ex) {
        safeRender(`
            <div class="cpt">
                <div class="empty-state">
                    <p>Aucune comptabilité pour l'instant.</p>
                    <button type="button" class="btn btn-primary" data-click="compta-import">Importer le classeur Excel</button>
                    <button type="button" class="btn btn-secondary" data-click="compta-exercice-nouveau">Nouvel exercice</button>
                </div>
            </div>`);
        return;
    }
    const toutes = DB.get('compta_ecritures') || [];
    const ecritures = comptaEcrituresDe(ex.annee, toutes);
    const calc = comptaCalcul(ex, ecritures);
    const ctx = { ex, exercices, toutes, ecritures, calc };

    const segment = ([v, label]) => `<button type="button" class="segment${vue === v ? ' active' : ''}" data-click="compta-vue" data-value="${v}" aria-pressed="${vue === v}">${escapeHtml(label)}</button>`;
    const choixExercice = exercices.length > 1
        ? `<select class="cpt-exercice" data-change="compta-exercice-choix" aria-label="Exercice">${exercices.map(x => `<option value="${x.annee}"${x.annee === ex.annee ? ' selected' : ''}>${x.annee}</option>`).join('')}</select>`
        : `<span class="cpt-exercice-seul">${ex.annee}</span>`;
    const menu = rowMenuHtml('Comptabilité', `
        <button type="button" data-click="compta-import">Importer Excel</button>
        <button type="button" data-click="compta-exercice-donnees">Données de base</button>
        <button type="button" data-click="compta-ouverture">Bilan d'ouverture</button>
        <button type="button" data-click="compta-exercice-nouveau">Nouvel exercice</button>`);
    const actions = `${choixExercice}${menu}<button type="button" class="btn btn-secondary" data-click="compta-export">Exporter Excel</button><button type="button" class="btn btn-primary" data-click="compta-ecriture-nouvelle">+ Écriture</button>`;

    const contenu = {
        journal: comptaJournalHtml,
        'grand-livre': comptaGrandLivreHtml,
        bilan: comptaBilanHtml,
        resultat: comptaResultatHtml,
        stats: comptaStatsHtml,
        creances: (c) => comptaPiecesHtml(c, 'creance'),
        dettes: (c) => comptaPiecesHtml(c, 'dette'),
        plan: comptaPlanHtml
    }[vue];

    safeRender(`
        <div class="cpt">
            ${pageToolbar(actions, `<div class="cpt-vues"><div class="segmented-filter" role="group" aria-label="Vue">${COMPTA_VUES.map(segment).join('')}</div></div>`)}
            ${contenu(ctx)}
        </div>`);
    if (vue === 'bilan' && comptaOuvertureEdition) initComptaOuvertureEdition();
    if (vue === 'stats') {
        bindBarChart(document.getElementById('cptStatsChart'));
        bindDetailsMemoire();
    }
};

const comptaCompteHtml = (calc, num) => {
    const c = calc.parNum.get(comptaNum(num));
    const nom = c ? c.nom : 'compte inconnu';
    return `<span class="cpt-compte" title="${escapeHtml(`${comptaNum(num)} ${nom}`)}"><b>${escapeHtml(comptaNum(num) || '—')}</b> ${escapeHtml(nom)}</span>`;
};

// --- Journal -----------------------------------------------------------------------
const comptaJournalHtml = ({ ex, ecritures, calc, toutes, exercices }) => {
    const q = DB.getFilter('compta_recherche');
    const compte = DB.getFilter('compta_compte');
    const mois = DB.getFilter('compta_mois');
    const qn = paletteNorm(q.trim());
    const qNombre = /^\d+([.,]\d+)?$/.test(q.trim()) ? Number(q.trim().replace(',', '.')) : null;
    const comptesUtilises = [...new Set(ecritures.flatMap(e => [comptaNum(e.debit), comptaNum(e.credit)]))].filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));

    const doublons = new Set();
    const vus = new Set();
    ecritures.forEach(e => { if (vus.has(e.ligne)) doublons.add(e.ligne); vus.add(e.ligne); });

    const liste = ecritures.filter(e => {
        if (compte && comptaNum(e.debit) !== compte && comptaNum(e.credit) !== compte) return false;
        if (mois && String(e.date || '').slice(5, 7) !== mois) return false;
        if (!qn) return true;
        if (qNombre !== null && (Number(e.ligne) === qNombre || comptaRound(e.montant) === comptaRound(qNombre))) return true;
        return paletteNorm(`${e.libelle} ${e.debit} ${e.credit} ${calc.parNum.get(comptaNum(e.debit))?.nom || ''} ${calc.parNum.get(comptaNum(e.credit))?.nom || ''}`).includes(qn);
    }).sort((a, b) => b.ligne - a.ligne || String(b.date).localeCompare(String(a.date)));
    const affichees = comptaJournalTout ? liste : liste.slice(0, COMPTA_JOURNAL_PAGE);
    const total = comptaRound(liste.reduce((s, e) => s + (Number(e.montant) || 0), 0));

    const etat = (e) => {
        const tags = [];
        if (doublons.has(e.ligne)) tags.push('<span class="badge badge-danger">n° en double</span>');
        if (!calc.parNum.has(comptaNum(e.debit)) || !calc.parNum.has(comptaNum(e.credit))) tags.push('<span class="badge badge-danger">compte inconnu</span>');
        if (!comptaIsoValide(e.date) || e.date < ex.debut || e.date > ex.fin) tags.push('<span class="badge badge-warning">date hors exercice</span>');
        return tags.join('');
    };
    const ligne = (e) => {
        const label = `Écriture n° ${e.ligne}`;
        return `
            <tr>
                <td class="num cpt-col-n">${escapeHtml(e.ligne)}</td>
                <td class="cpt-col-date">${escapeHtml(comptaDate(e.date))}</td>
                <td class="cpt-col-compte">${comptaCompteHtml(calc, e.debit)}</td>
                <td class="cpt-col-compte">${comptaCompteHtml(calc, e.credit)}</td>
                <td class="cpt-col-lib">
                    <button type="button" class="cpt-link" data-click="compta-ecriture-modifier" data-id="${escapeHtml(e.id)}">${escapeHtml(e.libelle || '(sans libellé)')}</button>
                    <span class="cpt-meta-mobile">n° ${escapeHtml(e.ligne)} · ${escapeHtml(comptaDate(e.date))} · ${escapeHtml(comptaNum(e.debit))} → ${escapeHtml(comptaNum(e.credit))}</span>
                    ${etat(e)}
                </td>
                <td class="num cpt-col-montant">${escapeHtml(comptaFmt(e.montant))}${Number(e.montantEur) ? `<span class="cpt-eur">${escapeHtml(comptaFmt(e.montantEur))} EUR</span>` : ''}</td>
                <td class="cpt-col-menu">${rowMenuHtml(label, `
                    <button type="button" data-click="compta-ecriture-modifier" data-id="${escapeHtml(e.id)}">Modifier</button>
                    <button type="button" data-click="compta-ecriture-dupliquer" data-id="${escapeHtml(e.id)}">Dupliquer</button>
                    ${doublons.has(e.ligne) ? `<button type="button" data-click="compta-ecriture-renumeroter" data-id="${escapeHtml(e.id)}">Nouveau numéro</button>` : ''}
                    <button type="button" class="is-danger" data-click="compta-ecriture-supprimer" data-id="${escapeHtml(e.id)}">Supprimer</button>`)}</td>
            </tr>`;
    };
    const moisNoms = Array.from({ length: 12 }, (_, i) => [String(i + 1).padStart(2, '0'), dashCapitalize(new Date(2026, i, 1, 12).toLocaleDateString('fr-CH', { month: 'long' }))]);
    return `
        <div class="cpt-filtres">
            <input type="search" id="cptRecherche" data-live-search="compta_recherche" value="${escapeHtml(q)}" placeholder="Libellé, n°, montant, compte" aria-label="Rechercher dans le journal" autocomplete="off">
            <select data-change="compta-filtre" data-name="compta_compte" aria-label="Compte">
                <option value="">Tous les comptes</option>
                ${comptesUtilises.map(n => `<option value="${escapeHtml(n)}"${n === compte ? ' selected' : ''}>${escapeHtml(`${n} ${calc.parNum.get(n)?.nom || ''}`.trim())}</option>`).join('')}
            </select>
            <select data-change="compta-filtre" data-name="compta_mois" aria-label="Mois">
                <option value="">Toute l'année</option>
                ${moisNoms.map(([v, l]) => `<option value="${v}"${v === mois ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}
            </select>
        </div>
        <section class="stock-section">
            <div class="stock-section-head">
                <h2 class="stock-section-title">Journal ${ex.annee}</h2>
                <span class="stock-section-meta">${escapeHtml(dashPlural(liste.length, 'écriture'))} · ${escapeHtml(comptaFmt(total))} CHF</span>
            </div>
            ${liste.length ? `
                <div class="table-container cpt-table-wrap">
                    <table class="cpt-table cpt-journal">
                        <thead><tr><th class="num">N°</th><th>Date</th><th>Débit</th><th>Crédit</th><th>Libellé</th><th class="num">Montant CHF</th><th aria-label="Actions"></th></tr></thead>
                        <tbody>${affichees.map(ligne).join('')}</tbody>
                    </table>
                </div>
                ${liste.length > affichees.length ? `<button type="button" class="btn btn-secondary cpt-plus" data-click="compta-journal-tout">Afficher les ${escapeHtml(twinFmtInt(liste.length))} écritures</button>` : ''}`
            : `<div class="commande-empty">${ecritures.length ? 'Aucune écriture ne correspond.' : 'Aucune écriture.'}</div>`}
        </section>`;
};

// --- Grand livre ---------------------------------------------------------------------
const comptaGrandLivreHtml = ({ ex, ecritures, calc }) => {
    const actifs = calc.comptes.filter(c => c.actif);
    const memo = DB.getFilter('compta_compte_gl');
    const c = actifs.find(x => x.numero === memo) || actifs.find(x => x.numero === comptaNum(ex.compteBanque)) || actifs[0];
    if (!c) return '<div class="commande-empty">Aucun compte dans le plan comptable.</div>';
    const sensDebit = c.classe === 'actif' || c.classe === 'charge';
    let solde = c.ouverture;
    const mouvements = ecritures
        .filter(e => comptaNum(e.debit) === c.numero || comptaNum(e.credit) === c.numero)
        .sort((a, b) => a.ligne - b.ligne)
        .map(e => {
            const montant = Number(e.montant) || 0;
            const debit = comptaNum(e.debit) === c.numero ? montant : 0;
            const credit = comptaNum(e.credit) === c.numero ? montant : 0;
            solde = comptaRound(solde + (sensDebit ? debit - credit : credit - debit));
            const contre = comptaNum(e.debit) === c.numero ? e.credit : e.debit;
            return { e, debit, credit, solde, contre };
        });
    const option = (x) => `<option value="${escapeHtml(x.numero)}"${x === c ? ' selected' : ''}>${escapeHtml(`${x.numero} ${x.nom}`)}</option>`;
    const groupe = (cl) => {
        const liste = actifs.filter(x => x.classe === cl.id);
        return liste.length ? `<optgroup label="${escapeHtml(cl.label)}">${liste.map(option).join('')}</optgroup>` : '';
    };
    const rang = (m) => `
        <tr>
            <td class="num cpt-col-n">${escapeHtml(m.e.ligne)}</td>
            <td class="cpt-col-date">${escapeHtml(comptaDate(m.e.date))}</td>
            <td class="cpt-col-lib"><button type="button" class="cpt-link" data-click="compta-ecriture-modifier" data-id="${escapeHtml(m.e.id)}">${escapeHtml(m.e.libelle || '(sans libellé)')}</button><span class="cpt-meta-mobile">n° ${escapeHtml(m.e.ligne)} · ${escapeHtml(comptaDate(m.e.date))} · ${escapeHtml(comptaNum(m.contre))}</span></td>
            <td class="cpt-col-compte">${comptaCompteHtml(calc, m.contre)}</td>
            <td class="num">${m.debit ? escapeHtml(comptaFmt(m.debit)) : ''}</td>
            <td class="num">${m.credit ? escapeHtml(comptaFmt(m.credit)) : ''}</td>
            <td class="num cpt-solde">${escapeHtml(comptaFmt(m.solde))}</td>
        </tr>`;
    return `
        <div class="cpt-filtres">
            <select data-change="compta-filtre" data-name="compta_compte_gl" aria-label="Compte">${COMPTA_CLASSES.map(groupe).join('')}</select>
        </div>
        <section class="stock-section">
            <div class="stock-section-head">
                <h2 class="stock-section-title">${escapeHtml(`${c.numero} ${c.nom}`)}</h2>
                <span class="stock-section-meta">${escapeHtml(dashPlural(mouvements.length, 'mouvement'))} · solde ${escapeHtml(comptaFmt(c.solde))} CHF</span>
            </div>
            <div class="table-container cpt-table-wrap">
                <table class="cpt-table cpt-livre">
                    <thead><tr><th class="num">N°</th><th>Date</th><th>Libellé</th><th>Contrepartie</th><th class="num">Débit</th><th class="num">Crédit</th><th class="num">Solde</th></tr></thead>
                    <tbody>
                        ${comptaEstClasseBilan(c.classe) ? `<tr class="cpt-row-ouverture"><td class="num cpt-col-n"></td><td class="cpt-col-date"></td><td class="cpt-col-lib">Solde d'ouverture</td><td class="cpt-col-compte"></td><td></td><td></td><td class="num cpt-solde">${escapeHtml(comptaFmt(c.ouverture))}</td></tr>` : ''}
                        ${mouvements.map(rang).join('')}
                    </tbody>
                    <tfoot><tr><td class="num cpt-col-n"></td><td class="cpt-col-date"></td><td class="cpt-col-lib">Total</td><td class="cpt-col-compte"></td><td class="num">${escapeHtml(comptaFmt(c.debit))}</td><td class="num">${escapeHtml(comptaFmt(c.credit))}</td><td class="num cpt-solde">${escapeHtml(comptaFmt(c.solde))}</td></tr></tfoot>
                </table>
            </div>
        </section>`;
};

// --- Bilan et compte de résultat ---------------------------------------------------
const comptaResultatLabel = (r) => (r > 0 ? 'Bénéfice' : r < 0 ? 'Perte' : 'Résultat');

// Présentation du classeur (feuilles Bilan Final et Compte de résultat) : un côté à
// gauche, l'autre à droite, un montant par compte, comptes à zéro masqués, perte
// ou bénéfice du côté qui équilibre, totaux égaux sur la même ligne
const comptaDeuxCotesHtml = (calc, cotes) => {
    const lignes = cotes.map(cote => {
        const comptes = calc.comptes.filter(c => c.classe === cote.classe && c.actif && comptaRound(cote.valeur(c)) !== 0);
        const rangs = comptes.map(c => `
            <li>
                <button type="button" class="cpt-t-row" data-click="compta-compte-grand-livre" data-num="${escapeHtml(c.numero)}">
                    <span class="cpt-t-num">${escapeHtml(c.numero)}</span>
                    <span class="cpt-t-nom">${escapeHtml(c.nom)}</span>
                    <span class="cpt-t-montant">${escapeHtml(comptaFmt(cote.valeur(c)))}</span>
                </button>
            </li>`);
        if (cote.resultat) {
            rangs.push(`
            <li class="cpt-t-row is-resultat is-${cote.resultat.label === 'Perte' ? 'perte' : 'benefice'}">
                <span class="cpt-t-nom">${escapeHtml(cote.resultat.label)}</span>
                <span class="cpt-t-montant">${escapeHtml(comptaFmt(cote.resultat.montant))}</span>
            </li>`);
        }
        return rangs;
    });
    const hauteur = Math.max(...lignes.map(l => l.length));
    return `
        <div class="cpt-t">
            ${cotes.map((cote, i) => `
                <div class="cpt-t-cote">
                    <h3 class="cpt-t-titre">${escapeHtml(cote.titre)}</h3>
                    <ul class="cpt-t-liste">
                        ${lignes[i].join('')}
                        ${'<li class="cpt-t-row is-vide" aria-hidden="true"></li>'.repeat(hauteur - lignes[i].length)}
                    </ul>
                    <div class="cpt-t-total"><span>Total</span><span class="cpt-t-montant">${escapeHtml(comptaFmt(cote.total))}</span></div>
                </div>`).join('')}
        </div>`;
};

const comptaBilanHtml = ({ ex, calc }) => {
    const ouverture = DB.getFilter('compta_bilan_mode') === 'ouverture';
    if (ouverture && comptaOuvertureEdition) return comptaOuvertureEditionHtml({ ex, calc });
    const r = calc.resultat;
    const avert = [];
    if (ouverture && calc.ouvertureActifs !== calc.ouverturePassifs) avert.push(`Bilan d'ouverture déséquilibré : actifs ${comptaFmt(calc.ouvertureActifs)}, passifs ${comptaFmt(calc.ouverturePassifs)}`);
    if (!ouverture && calc.ecart) avert.push(`Écart de ${comptaFmt(calc.ecart)} CHF entre actifs et passifs`);
    if (!ouverture && calc.inconnues.length) avert.push(`${dashPlural(calc.inconnues.length, 'écriture')} sur un compte inconnu, ignorée${calc.inconnues.length > 1 ? 's' : ''} comme dans le classeur`);
    const mode = (v, label) => `<button type="button" class="segment${(v === 'ouverture') === ouverture ? ' active' : ''}" data-click="compta-bilan-mode" data-value="${v}" aria-pressed="${(v === 'ouverture') === ouverture}">${label}</button>`;
    const cotes = ouverture
        ? [
            { classe: 'actif', titre: 'Actifs', valeur: c => c.ouverture, total: calc.ouvertureActifs },
            { classe: 'passif', titre: 'Passifs', valeur: c => c.ouverture, total: calc.ouverturePassifs }
        ]
        : [
            { classe: 'actif', titre: 'Actifs', valeur: c => c.solde, total: comptaRound(calc.actifs + (r < 0 ? -r : 0)), resultat: r < 0 ? { label: 'Perte', montant: -r } : null },
            { classe: 'passif', titre: 'Passifs', valeur: c => c.solde, total: comptaRound(calc.passifs + (r > 0 ? r : 0)), resultat: r > 0 ? { label: 'Bénéfice', montant: r } : null }
        ];
    return `
        <section class="stock-section">
            <div class="stock-section-head cpt-t-head">
                <h2 class="stock-section-title">${ouverture ? `Bilan d'ouverture au ${escapeHtml(comptaDate(ex.debut))}` : `Bilan au ${escapeHtml(comptaDate(ex.fin))}`}</h2>
                <div class="segmented-filter" role="group" aria-label="Bilan">${mode('ouverture', 'Ouverture')}${mode('cloture', 'Clôture')}</div>
                ${ouverture ? '<button type="button" class="btn btn-sm btn-secondary" data-click="compta-ouverture">Modifier</button>' : ''}
            </div>
            ${avert.map(a => `<p class="cpt-avert">${escapeHtml(a)}</p>`).join('')}
            ${comptaDeuxCotesHtml(calc, cotes)}
        </section>`;
};

const comptaResultatHtml = ({ ex, calc }) => {
    const r = calc.resultat;
    return `
        <section class="stock-section">
            <div class="stock-section-head cpt-t-head">
                <h2 class="stock-section-title">Compte de résultat du ${escapeHtml(comptaDate(ex.debut))} au ${escapeHtml(comptaDate(ex.fin))}</h2>
            </div>
            ${comptaDeuxCotesHtml(calc, [
                { classe: 'charge', titre: 'Charges', valeur: c => c.solde, total: comptaRound(calc.charges + (r > 0 ? r : 0)), resultat: r > 0 ? { label: 'Bénéfice', montant: r } : null },
                { classe: 'produit', titre: 'Produits', valeur: c => c.solde, total: comptaRound(calc.produits + (r < 0 ? -r : 0)), resultat: r < 0 ? { label: 'Perte', montant: -r } : null }
            ])}
        </section>`;
};

// --- Statistiques : chiffres clés, mois par mois, classements (tout vient du journal) ---
const COMPTA_STATS_MESURES = [['ventes', 'Ventes'], ['charges', 'Charges'], ['resultat', 'Résultat'], ['tresorerie', 'Trésorerie']];
const comptaJours = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const comptaPct = (n) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toLocaleString('fr-CH', { maximumFractionDigits: 1 })} %`;

const comptaStatsModele = ({ ex, ecritures, calc, toutes, exercices }) => {
    const actifs = calc.comptes.filter(c => c.actif);
    const nums = (filtre) => new Set(actifs.filter(filtre).map(c => c.numero));
    const ventesNums = (() => {
        const v = nums(c => c.classe === 'produit' && /vente/i.test(c.nom));
        return v.size ? v : nums(c => c.classe === 'produit');
    })();
    const produitsNums = nums(c => c.classe === 'produit');
    const chargesNums = nums(c => c.classe === 'charge');
    const liquidesNums = nums(c => c.classe === 'actif' && /caisse|banque|poste/i.test(c.nom));

    // Mois de l'exercice (12 en général)
    const mois = [];
    for (let d = new Date(`${ex.debut.slice(0, 7)}-01T12:00:00`); d.toISOString().slice(0, 7) <= ex.fin.slice(0, 7) && mois.length < 24; d.setMonth(d.getMonth() + 1)) {
        mois.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const today = getLocalDateISOString();
    const moisCourant = today.slice(0, 7);
    const parMois = mois.map(m => ({ m, ventes: 0, produits: 0, charges: 0, flux: 0 }));
    const indexMois = new Map(mois.map((m, i) => [m, i]));
    const net = (e, set) => (set.has(comptaNum(e.credit)) ? 1 : 0) - (set.has(comptaNum(e.debit)) ? 1 : 0);
    const parCanal = new Map();
    const parCharge = new Map();
    ecritures.forEach(e => {
        const montant = Number(e.montant) || 0;
        const i = comptaIsoValide(e.date) ? indexMois.get(e.date.slice(0, 7)) : undefined;
        const v = net(e, ventesNums) * montant;
        const c = -net(e, chargesNums) * montant;
        if (i !== undefined) {
            parMois[i].ventes += v;
            parMois[i].produits += net(e, produitsNums) * montant;
            parMois[i].charges += c;
            parMois[i].flux += -net(e, liquidesNums) * montant;
        }
        if (v) {
            const contre = ventesNums.has(comptaNum(e.credit)) ? comptaNum(e.debit) : comptaNum(e.credit);
            parCanal.set(contre, (parCanal.get(contre) || 0) + v);
        }
        // Par compte, chaque côté compte (un virement entre deux charges les touche toutes deux)
        if (chargesNums.has(comptaNum(e.debit))) parCharge.set(comptaNum(e.debit), (parCharge.get(comptaNum(e.debit)) || 0) + montant);
        if (chargesNums.has(comptaNum(e.credit))) parCharge.set(comptaNum(e.credit), (parCharge.get(comptaNum(e.credit)) || 0) - montant);
    });
    let tresorerie = comptaRound(actifs.filter(c => liquidesNums.has(c.numero)).reduce((s, c) => s + c.ouverture, 0));
    const tresorerieDebut = tresorerie;
    parMois.forEach(p => {
        tresorerie = comptaRound(tresorerie + p.flux);
        p.ventes = comptaRound(p.ventes);
        p.charges = comptaRound(p.charges);
        p.resultat = comptaRound(p.produits - p.charges);
        p.tresorerie = p.m > moisCourant ? null : tresorerie;
        p.futur = p.m > moisCourant;
        p.current = p.m === moisCourant;
    });

    const nom = (num) => calc.parNum.get(num)?.nom || num || '—';
    const classer = (map, libelle) => [...map.entries()]
        .map(([cle, valeur]) => ({ label: libelle(cle), valeur: comptaRound(valeur) }))
        .filter(r => r.valeur)
        .sort((a, b) => b.valeur - a.valeur);
    const canaux = classer(parCanal, (num) => (num === comptaNum(ex.compteCreances) ? `Sur facture (${nom(num)})`
        : chargesNums.has(num) ? `Frais retenus (${nom(num)})` : nom(num)));
    const charges = classer(parCharge, nom);

    // Factures : clients, délai de paiement, factures ouvertes
    const factures = ecritures.filter(e => comptaEstFacture(e, ex));
    const parClient = new Map();
    factures.forEach(e => {
        const texte = String(comptaPieceTexte(e, 'creance') || '').trim();
        const cle = paletteNorm(texte).replace(/\s+/g, ' ');
        if (!cle) return;
        const r = parClient.get(cle) || { label: dashCapitalize(texte), valeur: 0, n: 0 };
        r.valeur += Number(e.montant) || 0;
        r.n++;
        parClient.set(cle, r);
    });
    const clients = [...parClient.values()].map(r => ({ ...r, valeur: comptaRound(r.valeur) })).sort((a, b) => b.valeur - a.valeur);
    const delais = factures
        .filter(e => e.regle?.date && comptaIsoValide(e.date) && e.date >= ex.debut)
        .map(e => comptaJours(e.date, e.regle.date))
        .filter(j => j >= 0);
    const ouvertes = comptaPiecesOuvertes(ex, 'creance', toutes, exercices);

    // Exercice précédent, s'il est dans l'app
    const precedent = exercices.find(x => x.annee === ex.annee - 1) || null;
    let ventesPrec = null;
    if (precedent) {
        const cp = comptaCalcul(precedent, comptaEcrituresDe(precedent.annee, toutes));
        const v = cp.comptes.filter(c => c.actif && c.classe === 'produit' && /vente/i.test(c.nom));
        ventesPrec = comptaRound((v.length ? v : cp.comptes.filter(c => c.actif && c.classe === 'produit')).reduce((s, c) => s + c.solde, 0));
    }

    const ventes = comptaRound(parMois.reduce((s, p) => s + p.ventes, 0) + 0);
    const moisEcoules = Math.max(1, parMois.filter(p => !p.futur).length);
    const derniereDate = ecritures.map(e => e.date).filter(d => comptaIsoValide(d) && d >= ex.debut && d <= ex.fin).sort().pop() || '';
    return {
        mois: parMois, moisEcoules, ventes, ventesPrec, precedent,
        ventesTotal: comptaRound(actifs.filter(c => ventesNums.has(c.numero)).reduce((s, c) => s + c.solde, 0)),
        tresorerie: comptaRound(actifs.filter(c => liquidesNums.has(c.numero)).reduce((s, c) => s + c.solde, 0)),
        tresorerieDebut, derniereDate, canaux, charges, clients,
        factures: factures.length,
        delaiMoyen: delais.length ? delais.reduce((s, j) => s + j, 0) / delais.length : null,
        delaiN: delais.length,
        delaiLong: delais.filter(j => j > 30).length,
        ouvertes, ouvertesTotal: comptaRound(ouvertes.reduce((s, e) => s + (Number(e.montant) || 0), 0))
    };
};

// Histogramme mensuel (composant du tableau de bord, infobulle bindBarChart),
// avec des barres sous zéro pour les mois en perte
const comptaChartHtml = (id, titre, colonnes) => {
    const valeurs = colonnes.map(c => c.valeur);
    const presentes = valeurs.filter(v => v !== null);
    const max = Math.max(0, ...presentes);
    const min = Math.min(0, ...presentes);
    let bas = 0;
    let haut = 0;
    let ticks = [0];
    if (max > min) {
        const raw = (max - min) / 4;
        const p = Math.pow(10, Math.floor(Math.log10(raw)));
        const pas = Math.max(1, [1, 2, 5, 10].map(s => s * p).find(s => s >= raw));
        bas = Math.floor(min / pas) * pas;
        haut = Math.ceil(max / pas) * pas;
        ticks = [];
        for (let t = bas; t <= haut + pas / 2; t += pas) ticks.push(Math.round(t));
    }
    const pct = (v) => (haut > bas ? ((v - bas) / (haut - bas) * 100) : 0);
    const iMax = presentes.length ? valeurs.indexOf(Math.max(...presentes)) : -1;
    const iCourant = colonnes.findIndex(c => c.current);
    const arret = iCourant >= 0 ? iCourant : Math.max(0, iMax);
    const col = (c, i) => {
        const v = c.valeur;
        const valeur = v === null ? '—' : `${comptaFmt(v)} CHF`;
        const barre = v === null || !v ? '' : `<span class="dash-bar${v < 0 ? ' is-negatif' : ''}" style="--b:${pct(Math.min(0, v)).toFixed(2)}%;--h:${(pct(Math.abs(v) + bas) - pct(bas)).toFixed(2)}%">${i === iMax && v > 0 ? `<span class="dash-bar-label">${escapeHtml(dashCompact(v))}</span>` : ''}</span>`;
        return `
            <div class="dash-col${c.current ? ' is-current' : ''}" tabindex="${i === arret ? '0' : '-1'}" data-title="${escapeHtml(c.titre)}" data-value="${escapeHtml(valeur)}" data-sub="${escapeHtml(c.sub || '')}" aria-label="${escapeHtml([`${c.titre} : ${valeur}`, c.sub].filter(Boolean).join(', '))}">
                ${barre}
            </div>`;
    };
    return `
        <div class="dash-chart cpt-chart" id="${id}" role="group" aria-label="${escapeHtml(titre)}" style="--cols:${colonnes.length}">
            <div class="dash-chart-plot">
                <div class="dash-chart-area">
                    ${ticks.map(v => `<div class="dash-chart-line${v === 0 ? ' is-base' : ''}" style="bottom:${pct(v).toFixed(2)}%" aria-hidden="true"><span>${escapeHtml(dashCompact(v))}</span></div>`).join('')}
                    <div class="dash-chart-cols">${colonnes.map(col).join('')}</div>
                </div>
                <div class="dash-tip" aria-hidden="true" hidden>
                    <span class="dash-tip-value"></span><span class="dash-tip-label"></span><span class="dash-tip-sub"></span>
                </div>
            </div>
            <div class="dash-chart-x" aria-hidden="true">${colonnes.map((c, i) => `<span${c.current ? ' class="is-current"' : ''}${i % 2 ? ' data-mineur' : ''}>${escapeHtml(c.label)}</span>`).join('')}</div>
        </div>`;
};

const comptaRangHtml = (titre, lignes, total, { max = 8, details = null } = {}) => {
    const visibles = lignes.slice(0, max);
    const autres = lignes.slice(max);
    const haut = visibles.length ? Math.max(...visibles.map(r => Math.abs(r.valeur))) : 0;
    const resteTotal = comptaRound(autres.reduce((s, r) => s + r.valeur, 0));
    return `
        <div class="stock-group cpt-carte cpt-stats-carte">
            <h3 class="cpt-stats-sous-titre">${escapeHtml(titre)}</h3>
            ${visibles.length ? `
                <ol class="dash-rank-list cpt-rang">
                    ${visibles.map(r => `
                        <li class="dash-rank-row">
                            <span class="dash-rank-label"><span class="dash-rank-name" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}</span></span>
                            <span class="dash-rank-value">${escapeHtml(comptaFmt(r.valeur))}<small> · ${total ? `${Math.round(r.valeur / total * 100)} %` : ''}${details ? ` · ${escapeHtml(details(r))}` : ''}</small></span>
                            <span class="dash-rank-track" aria-hidden="true"><span class="dash-rank-bar" style="width:${haut ? Math.max(0, r.valeur / haut * 100).toFixed(1) : 0}%"></span></span>
                        </li>`).join('')}
                </ol>
                ${autres.length ? `<p class="cpt-rang-plus">${escapeHtml(`+ ${dashPlural(autres.length, 'autre')} · ${comptaFmt(resteTotal)}`)}</p>` : ''}`
            : '<p class="commande-empty">Aucune donnée.</p>'}
        </div>`;
};

const comptaStatsHtml = (ctx) => {
    const { ex, calc } = ctx;
    const s = comptaStatsModele(ctx);
    const r = calc.resultat;
    const mesureFiltre = DB.getFilter('compta_stats_mesure');
    const mesure = COMPTA_STATS_MESURES.some(([v]) => v === mesureFiltre) ? mesureFiltre : 'ventes';
    // « 1 234,50 CHF » : l'unité en petit, pour que le montant tienne sur téléphone
    const stat = (label, value, sub = '', classe = '') => `
        <div class="dash-stat${classe ? ` ${classe}` : ''}">
            <span class="dash-stat-label">${escapeHtml(label)}</span>
            <span class="dash-stat-value">${escapeHtml(value).replace(/ CHF$/, ' <small>CHF</small>')}</span>
            ${sub ? `<span class="dash-stat-sub">${escapeHtml(sub)}</span>` : ''}
        </div>`;
    const parMois = (n) => `moyenne ${comptaFmt(n / s.moisEcoules)} par mois`;
    const ventesSub = s.ventesPrec !== null && s.ventesPrec
        ? `${s.precedent.annee} : ${comptaFmt(s.ventesPrec)} (${comptaPct((s.ventesTotal - s.ventesPrec) / Math.abs(s.ventesPrec) * 100)})`
        : parMois(s.ventesTotal);
    const plusAncienne = s.ouvertes[0];
    const cles = [
        stat('Ventes', `${comptaFmt(s.ventesTotal)} CHF`, ventesSub),
        stat('Charges', `${comptaFmt(calc.charges)} CHF`, parMois(calc.charges)),
        stat(comptaResultatLabel(r), `${comptaFmt(Math.abs(r))} CHF`, s.ventesTotal ? `${comptaPct(r / s.ventesTotal * 100)} des ventes` : '', r < 0 ? 'is-perte' : r > 0 ? 'is-benefice' : ''),
        stat('Trésorerie', `${comptaFmt(s.tresorerie)} CHF`, `caisse et banque · ${comptaFmt(s.tresorerieDebut)} au ${comptaDate(ex.debut)}`),
        stat('Factures ouvertes', `${comptaFmt(s.ouvertesTotal)} CHF`, s.ouvertes.length ? `${dashPlural(s.ouvertes.length, 'facture')} · la plus ancienne du ${comptaDate(plusAncienne.date)}` : 'aucune'),
        stat('Délai de paiement', s.delaiMoyen === null ? '—' : `${dashPlural(Math.round(s.delaiMoyen), 'jour')}`, s.delaiN ? `en moyenne sur ${dashPlural(s.delaiN, 'facture payée', 'factures payées')}${s.delaiLong ? ` · ${twinFmtInt(s.delaiLong)} après 30 jours` : ''}` : '')
    ].join('');

    const colonnes = s.mois.map(p => {
        const d = new Date(`${p.m}-01T12:00:00`);
        const valeur = mesure === 'tresorerie' ? p.tresorerie : p.futur ? null : p[mesure];
        const sub = mesure === 'resultat' && !p.futur ? `ventes ${comptaFmt(p.ventes)} · charges ${comptaFmt(p.charges)}`
            : mesure === 'tresorerie' && !p.futur ? 'caisse et banque en fin de mois' : '';
        return {
            label: d.toLocaleDateString('fr-CH', { month: 'short' }).replace('.', ''),
            titre: dashCapitalize(d.toLocaleDateString('fr-CH', { month: 'long', year: 'numeric' })),
            valeur, sub, current: p.current
        };
    });
    const nomMesure = { ventes: 'Ventes', charges: 'Charges', resultat: 'Résultat', tresorerie: 'Trésorerie en fin de mois' }[mesure];
    const segment = ([v, label]) => `<button type="button" class="segment${mesure === v ? ' active' : ''}" data-click="compta-stats-mesure" data-value="${v}" aria-pressed="${mesure === v}">${escapeHtml(label)}</button>`;
    const ligneTable = (p) => {
        const d = new Date(`${p.m}-01T12:00:00`);
        const cell = (v) => `<td>${v === null || p.futur ? '—' : escapeHtml(comptaFmt(v))}</td>`;
        return `<tr><th scope="row">${escapeHtml(dashCapitalize(d.toLocaleDateString('fr-CH', { month: 'long' })))}</th>${cell(p.ventes)}${cell(p.charges)}${cell(p.resultat)}${cell(p.tresorerie)}</tr>`;
    };

    return `
        <div class="dash-stats cpt-stats-cles">${cles}</div>
        <section class="stock-group cpt-carte cpt-stats-carte">
            <div class="cpt-stats-entete">
                <h3 class="cpt-stats-sous-titre">${escapeHtml(nomMesure)} par mois</h3>
                <div class="segmented-filter" role="group" aria-label="Mesure">${COMPTA_STATS_MESURES.map(segment).join('')}</div>
            </div>
            ${comptaChartHtml('cptStatsChart', `${nomMesure} par mois en ${ex.annee}`, colonnes)}
            <details class="dash-table cpt-stats-table" data-dash-key="compta-stats-table"${dashOpenAttr('compta-stats-table')}>
                <summary>Voir les données</summary>
                <div class="dash-table-wrap">
                    <table>
                        <thead><tr><th scope="col">Mois</th><th scope="col">Ventes</th><th scope="col">Charges</th><th scope="col">Résultat</th><th scope="col">Trésorerie</th></tr></thead>
                        <tbody>${s.mois.map(ligneTable).join('')}</tbody>
                    </table>
                </div>
            </details>
        </section>
        <div class="cpt-stats-grille">
            ${comptaRangHtml('Charges par compte', s.charges, calc.charges)}
            ${comptaRangHtml('Ventes par mode de paiement', s.canaux, s.ventesTotal)}
            ${comptaRangHtml('Factures par client', s.clients, s.clients.reduce((t, c) => t + c.valeur, 0), { details: (c) => dashPlural(c.n, 'facture') })}
        </div>`;
};

// --- Créances et dettes ----------------------------------------------------------------
const comptaPiecesHtml = ({ ex, calc, toutes, exercices }, type) => {
    const estC = type === 'creance';
    const compte = comptaNum(estC ? ex.compteCreances : ex.compteDettes);
    const nomCompte = calc.parNum.get(compte)?.nom || '';
    if (!compte) {
        return `<div class="empty-state"><p>Aucun compte de ${estC ? 'créances clients' : 'dettes'} choisi.</p><button type="button" class="btn btn-primary" data-click="compta-exercice-donnees">Données de base</button></div>`;
    }
    const today = getLocalDateISOString();
    const ouvertes = comptaPiecesOuvertes(ex, type, toutes, exercices);
    const total = comptaRound(ouvertes.reduce((s, e) => s + (Number(e.montant) || 0), 0));
    const solde = calc.parNum.get(compte)?.solde ?? 0;
    const reglees = comptaPieces(ex, type, toutes, exercices)
        .filter(e => !ouvertes.includes(e))
        .sort((a, b) => b.annee - a.annee || b.ligne - a.ligne)
        .slice(0, 60);
    const rang = (e, ouverte) => {
        const num = comptaNumeroPiece(e, ex.annee);
        const echeance = e.piece?.echeance || '';
        const retard = ouverte && !e.regle && echeance && echeance < today;
        const rappels = [e.piece?.rappel1, e.piece?.rappel2].filter(Boolean).map(comptaDate).join(', ');
        const regleTxt = e.regle ? (e.regle.date ? `réglée le ${comptaDate(e.regle.date)}` : 'réglée') : '';
        const menu = rowMenuHtml(`${estC ? 'Facture' : 'Dette'} n° ${num}`, `
            <button type="button" data-click="compta-piece" data-id="${escapeHtml(e.id)}">Modifier la pièce</button>
            <button type="button" data-click="compta-voir-journal" data-id="${escapeHtml(e.id)}">Voir dans le journal</button>
            ${!e.regle
                ? `<button type="button" data-click="compta-marquer-regle" data-id="${escapeHtml(e.id)}">Marquer comme ${estC ? 'payée' : 'réglée'}</button>`
                : `<button type="button" data-click="compta-rouvrir" data-id="${escapeHtml(e.id)}">Rouvrir</button>`}`);
        return `
            <tr>
                <td class="num cpt-col-n">${escapeHtml(num)}</td>
                <td class="cpt-col-date">${escapeHtml(comptaDate(e.date))}</td>
                <td class="cpt-col-lib">
                    <button type="button" class="cpt-link" data-click="compta-piece" data-id="${escapeHtml(e.id)}">${escapeHtml(comptaPieceTexte(e, type) || '(sans texte)')}</button>
                    <span class="cpt-meta-mobile">n° ${escapeHtml(num)} · ${escapeHtml(comptaDate(e.date))}${echeance ? ` · échéance ${escapeHtml(comptaDate(echeance))}` : ''}</span>
                    ${comptaPieceTiers(e, type) ? `<span class="cpt-sub">${escapeHtml(estC ? 'De' : 'En faveur de')} ${escapeHtml(comptaPieceTiers(e, type))}</span>` : ''}
                    ${retard ? '<span class="badge badge-danger">en retard</span>' : ''}
                    ${rappels ? `<span class="badge badge-warning">rappel ${escapeHtml(rappels)}</span>` : ''}
                    ${regleTxt ? `<span class="badge badge-success">${escapeHtml(regleTxt)}</span>` : ''}
                </td>
                <td class="cpt-col-date">${escapeHtml(comptaDate(echeance))}</td>
                <td class="num cpt-col-montant">${escapeHtml(comptaFmt(e.montant))}</td>
                <td class="cpt-col-action">${!e.regle ? `<button type="button" class="btn btn-sm btn-secondary" data-click="compta-regler" data-id="${escapeHtml(e.id)}">${estC ? 'Encaisser' : 'Payer'}</button>` : ''}</td>
                <td class="cpt-col-menu">${menu}</td>
            </tr>`;
    };
    const tableau = (liste, ouverte) => `
        <div class="table-container cpt-table-wrap">
            <table class="cpt-table cpt-pieces">
                <thead><tr><th class="num">N°</th><th>Date</th><th>${estC ? 'Client' : 'Objet'}</th><th>${estC ? "Payable jusqu'à" : 'Échue le'}</th><th class="num">Montant CHF</th><th aria-label="Règlement"></th><th aria-label="Actions"></th></tr></thead>
                <tbody>${liste.map(e => rang(e, ouverte)).join('')}</tbody>
            </table>
        </div>`;
    return `
        <section class="stock-section">
            <div class="stock-section-head">
                <h2 class="stock-section-title">${estC ? 'Factures ouvertes' : 'Dettes ouvertes'}</h2>
                <span class="stock-section-meta">${escapeHtml(dashPlural(ouvertes.length, estC ? 'facture' : 'dette'))} · ${escapeHtml(comptaFmt(total))} CHF · compte ${escapeHtml(`${compte} ${nomCompte}`.trim())} ${escapeHtml(comptaFmt(solde))} CHF</span>
            </div>
            ${total !== comptaRound(solde) ? `<p class="cpt-avert">Écart de ${escapeHtml(comptaFmt(solde - total))} CHF avec le solde du compte ${escapeHtml(compte)}</p>` : ''}
            ${ouvertes.length ? tableau(ouvertes, true) : `<div class="commande-empty">Aucune ${estC ? 'facture ouverte' : 'dette ouverte'}.</div>`}
        </section>
        ${reglees.length ? `
            <details class="stock-section cpt-reglees">
                <summary class="stock-section-head"><span class="stock-section-title">${estC ? 'Factures réglées' : 'Dettes réglées'}</span><span class="stock-section-meta">${escapeHtml(twinFmtInt(reglees.length))}</span></summary>
                ${tableau(reglees, false)}
            </details>` : ''}`;
};

// --- Plan comptable ------------------------------------------------------------------
const comptaPlanHtml = ({ ex, calc }) => {
    const roles = new Map([[comptaNum(ex.compteCreances), 'créances clients'], [comptaNum(ex.compteDettes), 'dettes'], [comptaNum(ex.compteBanque), 'paiements']]);
    const groupe = (cl) => {
        const places = calc.comptes.filter(c => c.classe === cl.id);
        return `
            <div class="stock-group cpt-carte">
                <div class="stock-group-head"><span class="stock-group-title">${escapeHtml(cl.label)}</span><span class="stock-group-meta">${escapeHtml(`${places.filter(c => c.actif).length} / ${cl.places}`)}</span></div>
                <ul class="ptg-list cpt-plan">
                    ${places.map(c => `
                        <li class="ptg-row cpt-plan-row${c.actif ? '' : ' is-vide'}">
                            <button type="button" class="cpt-plan-btn" data-click="compta-compte-modifier" data-place="${c.place}">
                                <b class="cpt-plan-num">${escapeHtml(c.numero || '—')}</b>
                                <span class="ptg-row-main">
                                    <span class="ptg-row-name">${escapeHtml(c.nom || (c.numero ? 'sans nom' : 'emplacement libre'))}${roles.has(c.numero) && c.numero ? `<span class="stock-tag">${escapeHtml(roles.get(c.numero))}</span>` : ''}</span>
                                    ${c.remarque ? `<span class="ptg-row-sub">${escapeHtml(c.remarque)}</span>` : ''}
                                </span>
                                ${c.actif ? `<strong class="cpt-plan-solde">${escapeHtml(comptaFmt(c.solde))}</strong>` : ''}
                            </button>
                        </li>`).join('')}
                </ul>
            </div>`;
    };
    return `<div class="cpt-deux">${COMPTA_CLASSES.map(groupe).join('')}</div>`;
};

// =============================================================================
// Saisie d'une écriture
// =============================================================================
const comptaOptionsComptes = (ex, choisi, { vide = true, classes = null } = {}) => {
    const comptes = (ex.comptes || []).filter(comptaCompteActif);
    const num = comptaNum(choisi);
    const connu = comptes.some(c => comptaNum(c.numero) === num);
    const groupes = COMPTA_CLASSES.filter(cl => !classes || classes.includes(cl.id)).map(cl => {
        const liste = comptes.filter(c => c.classe === cl.id);
        return liste.length ? `<optgroup label="${escapeHtml(cl.label)}">${liste.map(c => `<option value="${escapeHtml(comptaNum(c.numero))}"${comptaNum(c.numero) === num ? ' selected' : ''}>${escapeHtml(`${c.numero} ${c.nom}`)}</option>`).join('')}</optgroup>` : '';
    }).join('');
    return `${vide ? '<option value="">Choisir un compte</option>' : ''}${num && !connu ? `<option value="${escapeHtml(num)}" selected>${escapeHtml(`${num} (compte inconnu)`)}</option>` : ''}${groupes}`;
};

const showComptaEcritureModal = ({ id = '', dupliquer = false } = {}) => {
    const ex = comptaExerciceCourant();
    if (!ex) return;
    const toutes = DB.get('compta_ecritures') || [];
    const source = id ? toutes.find(e => e.id === id) : null;
    if (id && !source) {
        showToast('Écriture introuvable (supprimée sur un autre appareil ?)', 'error');
        renderCurrentView();
        return;
    }
    const edition = !!source && !dupliquer;
    const exE = edition ? (comptaExercices().find(x => x.annee === source.annee) || ex) : ex;
    const today = getLocalDateISOString();
    const dateDefaut = comptaDerniereDate && comptaDerniereDate >= ex.debut && comptaDerniereDate <= ex.fin
        ? comptaDerniereDate : (today >= ex.debut && today <= ex.fin ? today : ex.fin);
    const e = source ? { ...source } : { date: dateDefaut, debit: '', credit: '', libelle: '', montant: '', montantEur: '' };
    if (dupliquer) { e.date = dateDefaut; delete e.regle; delete e.piece; }
    const titre = edition ? `Écriture n° ${source.ligne}` : `Nouvelle écriture n° ${comptaProchaineLigne(ex.annee, toutes)}`;
    const libelles = [...new Set(comptaEcrituresDe(ex.annee, toutes).sort((a, b) => b.ligne - a.ligne).map(x => String(x.libelle || '').trim()).filter(Boolean))].slice(0, 300);
    modal.show(titre, `
        <form id="comptaEcrForm" class="cpt-form cpt-ecr" data-id="${edition ? escapeHtml(source.id) : ''}" novalidate>
            <div class="form-group cpt-ecr-date">
                <label for="cptEcrDate">Date</label>
                <input type="date" id="cptEcrDate" name="date" value="${escapeHtml(e.date || '')}" required>
            </div>
            <div class="cpt-ecr-paire">
                <div class="form-group">
                    <label for="cptEcrDebit">Débit</label>
                    <select id="cptEcrDebit" name="debit" data-change="compta-ecr-comptes">${comptaOptionsComptes(exE, e.debit)}</select>
                </div>
                <span class="cpt-ecr-fleche" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></span>
                <div class="form-group">
                    <label for="cptEcrCredit">Crédit</label>
                    <select id="cptEcrCredit" name="credit" data-change="compta-ecr-comptes">${comptaOptionsComptes(exE, e.credit)}</select>
                </div>
            </div>
            <div class="form-group">
                <label for="cptEcrLibelle">Libellé</label>
                <input type="text" id="cptEcrLibelle" name="libelle" value="${escapeHtml(e.libelle || '')}" list="cptEcrLibelles" autocomplete="off">
                <datalist id="cptEcrLibelles">${libelles.map(l => `<option value="${escapeHtml(l)}"></option>`).join('')}</datalist>
            </div>
            <div class="cpt-ecr-montants">
                <div class="form-group">
                    <label for="cptEcrMontant">Montant</label>
                    <div class="cpt-montant"><input type="text" id="cptEcrMontant" name="montant" inputmode="decimal" autocomplete="off" value="${e.montant === '' || e.montant === undefined ? '' : escapeHtml(comptaFmt(e.montant))}" placeholder="0,00" required><span class="cpt-montant-unite" aria-hidden="true">CHF</span></div>
                </div>
                <div class="form-group" id="cptEcrEurGroupe"${Number(e.montantEur) ? '' : ' hidden'}>
                    <label for="cptEcrEur">Montant en euros</label>
                    <div class="cpt-montant"><input type="text" id="cptEcrEur" name="montantEur" inputmode="decimal" autocomplete="off" value="${Number(e.montantEur) ? escapeHtml(comptaFmt(e.montantEur)) : ''}" placeholder="0,00"><span class="cpt-montant-unite" aria-hidden="true">EUR</span></div>
                </div>
                ${Number(e.montantEur) ? '' : '<button type="button" class="btn btn-ghost btn-sm cpt-ecr-eur" data-click="compta-ecr-eur">+ EUR</button>'}
            </div>
            <div id="cptEcrPiece"></div>
        </form>
    `, `
        <button type="button" class="btn btn-secondary" data-click="close-modal">Annuler</button>
        ${edition ? '' : '<button type="button" class="btn btn-secondary" data-click="compta-ecriture-enregistrer" data-suite="1">Enregistrer et nouvelle</button>'}
        <button type="button" class="btn btn-primary" data-click="compta-ecriture-enregistrer">Enregistrer</button>
    `);
    const form = document.getElementById('comptaEcrForm');
    if (form) {
        form.__piece = e.piece || null;
        form.__regle = edition ? toutes.filter(x => x.regle?.ecritureId === source.id).map(x => x.id)[0] || '' : '';
        form.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter' || ev.isComposing || !ev.target.matches?.('input')) return;
            ev.preventDefault();
            enregistrerComptaEcriture({ suite: !edition });
        });
        // Montants remis au format suisse en quittant le champ
        form.addEventListener('focusout', (ev) => {
            if (!ev.target.matches?.('#cptEcrMontant, #cptEcrEur')) return;
            const v = comptaLireMontant(ev.target.value);
            if (v !== null && ev.target.value.trim()) ev.target.value = comptaFmt(v);
        });
    }
    majComptaEcriturePiece();
    if (!edition) setTimeout(() => document.getElementById(e.date ? (e.debit ? 'cptEcrMontant' : 'cptEcrDebit') : 'cptEcrDate')?.focus(), 30);
};

// Champs de pièce selon les comptes choisis : client d'une facture, objet d'une
// dette, ou facture / dette que l'écriture règle
const majComptaEcriturePiece = () => {
    const form = document.getElementById('comptaEcrForm');
    const zone = document.getElementById('cptEcrPiece');
    if (!form || !zone) return;
    const ex = comptaExerciceCourant();
    if (!ex) return;
    const debit = form.elements.debit.value;
    const credit = form.elements.credit.value;
    const id = form.getAttribute('data-id') || '';
    const piece = form.__piece || {};
    const garde = (name) => zone.querySelector(`[name="${name}"]`)?.value;
    const val = (name, defaut) => escapeHtml(garde(name) ?? defaut ?? '');
    const html = [];
    if (debit && debit === comptaNum(ex.compteCreances)) {
        html.push(`
            <fieldset class="cpt-ecr-piece">
                <legend>Facture client</legend>
                <div class="form-row">
                    <div class="form-group"><label for="cptPieceTexte">Client</label><input type="text" id="cptPieceTexte" name="pieceTexte" value="${val('pieceTexte', piece.texte)}"></div>
                    <div class="form-group"><label for="cptPieceEcheance">Payable jusqu'à</label><input type="date" id="cptPieceEcheance" name="pieceEcheance" value="${val('pieceEcheance', piece.echeance)}"></div>
                </div>
            </fieldset>`);
    }
    if (credit && credit === comptaNum(ex.compteDettes)) {
        html.push(`
            <fieldset class="cpt-ecr-piece">
                <legend>Dette</legend>
                <div class="form-row">
                    <div class="form-group"><label for="cptPieceTexte2">Objet</label><input type="text" id="cptPieceTexte2" name="pieceTexte" value="${val('pieceTexte', piece.texte)}"></div>
                    <div class="form-group"><label for="cptPieceTiers">En faveur de</label><input type="text" id="cptPieceTiers" name="pieceTiers" value="${val('pieceTiers', piece.tiers)}"></div>
                </div>
            </fieldset>`);
    }
    const choixRegle = (type, label) => {
        const toutes = DB.get('compta_ecritures') || [];
        const exercices = comptaExercices();
        const dernier = exercices[exercices.length - 1] || ex;
        const ouvertes = comptaPiecesOuvertes(dernier, type, toutes, exercices);
        const lie = form.__regle ? toutes.find(x => x.id === form.__regle) : null;
        const liste = lie && !ouvertes.includes(lie) ? [lie, ...ouvertes] : ouvertes;
        const choisi = garde('regle') ?? (lie?.id || '');
        return `
            <fieldset class="cpt-ecr-piece">
                <legend>Règlement</legend>
                <div class="form-group">
                <label for="cptEcrRegle">${escapeHtml(label)}</label>
                <select id="cptEcrRegle" name="regle" data-change="compta-ecr-regle">
                    <option value="">Aucune</option>
                    ${liste.filter(x => x.id !== id).map(x => `<option value="${escapeHtml(x.id)}"${x.id === choisi ? ' selected' : ''}>${escapeHtml(`n° ${comptaNumeroPiece(x, ex.annee)} · ${comptaDate(x.date)} · ${comptaPieceTexte(x, type)} · ${comptaFmt(x.montant)}`)}</option>`).join('')}
                </select>
                </div>
            </fieldset>`;
    };
    if (credit && credit === comptaNum(ex.compteCreances)) html.push(choixRegle('creance', 'Facture réglée'));
    if (debit && debit === comptaNum(ex.compteDettes)) html.push(choixRegle('dette', 'Dette réglée'));
    zone.innerHTML = html.join('');
};

// Choix d'une facture ou d'une dette réglée : montant et libellé proposés
const preRemplirComptaReglement = () => {
    const form = document.getElementById('comptaEcrForm');
    const ex = comptaExerciceCourant();
    if (!form || !ex) return;
    const cible = (DB.get('compta_ecritures') || []).find(x => x.id === form.elements.regle?.value);
    if (!cible) return;
    const type = comptaNum(form.elements.credit.value) === comptaNum(ex.compteCreances) ? 'creance' : 'dette';
    if (!form.elements.montant.value) form.elements.montant.value = comptaFmt(cible.montant);
    if (!form.elements.libelle.value.trim()) form.elements.libelle.value = comptaLibelleReglement(cible, type, ex.annee);
};

const comptaLibelleReglement = (piece, type, annee) => {
    const ref = `${comptaNumeroPiece(piece, annee)} du ${comptaDateCourte(piece.date)}`;
    return type === 'creance' ? `${comptaPieceTexte(piece, 'creance')} paye la facture ${ref}` : `paiement facture ${ref}`;
};

const lireComptaEcritureForm = (form) => {
    const montant = String(form.elements.montant.value).trim();
    const eur = String(form.elements.montantEur.value).trim();
    return {
        date: form.elements.date.value,
        debit: comptaNum(form.elements.debit.value),
        credit: comptaNum(form.elements.credit.value),
        libelle: form.elements.libelle.value.trim(),
        montant: montant === '' ? NaN : (comptaLireMontant(montant) ?? NaN),
        montantEur: eur === '' ? null : (comptaLireMontant(eur) ?? NaN),
        pieceTexte: form.elements.pieceTexte?.value.trim(),
        pieceEcheance: form.elements.pieceEcheance?.value || '',
        pieceTiers: form.elements.pieceTiers?.value.trim(),
        regle: form.elements.regle?.value || ''
    };
};

const enregistrerComptaEcriture = ({ suite = false } = {}) => {
    const form = document.getElementById('comptaEcrForm');
    if (!form) return;
    const v = lireComptaEcritureForm(form);
    const exercices = comptaExercices();
    if (!comptaIsoValide(v.date)) { showToast('Date invalide', 'error'); form.elements.date.focus(); return; }
    const exE = comptaExercicePourDate(v.date, exercices);
    if (!exE) { showToast(`Aucun exercice pour le ${comptaDate(v.date)}`, 'error'); form.elements.date.focus(); return; }
    if (!v.debit || !v.credit) { showToast('Choisissez le compte au débit et au crédit', 'error'); return; }
    if (v.debit === v.credit) { showToast('Le débit et le crédit doivent être deux comptes différents', 'error'); return; }
    if (!Number.isFinite(v.montant) || v.montant === 0) { showToast('Montant invalide', 'error'); form.elements.montant.focus(); return; }
    if (v.montantEur !== null && !Number.isFinite(v.montantEur)) { showToast('Montant en euros invalide', 'error'); form.elements.montantEur.focus(); return; }

    // Relecture au moment d'écrire (autre appareil)
    const toutes = DB.get('compta_ecritures') || [];
    const id = form.getAttribute('data-id') || '';
    const avant = id ? toutes.find(x => x.id === id) : null;
    if (id && !avant) { showToast('Écriture supprimée sur un autre appareil', 'error'); modal.hide(); renderCurrentView(); return; }
    const changeExercice = avant && avant.annee !== exE.annee;
    const ligne = avant && !changeExercice ? avant.ligne : comptaProchaineLigne(exE.annee, toutes);
    if (ligne > COMPTA_XLSX.journal[1]) { showToast(`Le journal ${exE.annee} est plein (${COMPTA_XLSX.journal[1] - COMPTA_XLSX.journal[0] + 1} écritures)`, 'error'); return; }

    const ecriture = { ...(avant || {}), id: avant?.id || generateId(), annee: exE.annee, ligne, date: v.date, debit: v.debit, credit: v.credit, libelle: v.libelle, montant: v.montant };
    if (v.montantEur) ecriture.montantEur = v.montantEur; else delete ecriture.montantEur;
    if (comptaEstFacture(ecriture, exE) || comptaEstDette(ecriture, exE)) {
        const piece = { ...(ecriture.piece || {}) };
        if (v.pieceTexte !== undefined) piece.texte = v.pieceTexte;
        if (comptaEstFacture(ecriture, exE)) piece.echeance = v.pieceEcheance;
        if (v.pieceTiers !== undefined) piece.tiers = v.pieceTiers;
        Object.keys(piece).forEach(k => { if (!piece[k]) delete piece[k]; });
        if (Object.keys(piece).length) ecriture.piece = piece; else delete ecriture.piece;
    }
    if (!avant) delete ecriture.regle;

    // Règlement : la facture ou la dette choisie est marquée réglée par cette écriture
    const regleAvant = avant ? toutes.filter(x => x.regle?.ecritureId === avant.id).map(x => x.id) : [];
    const suivantes = toutes.map(x => {
        if (x.id === ecriture.id) return ecriture;
        if (regleAvant.includes(x.id) && x.id !== v.regle) { const y = { ...x }; delete y.regle; return y; }
        if (v.regle && x.id === v.regle) return { ...x, regle: { date: v.date, ecritureId: ecriture.id } };
        return x;
    });
    if (!avant) suivantes.push(ecriture);
    if (!DB.set('compta_ecritures', suivantes)) return;
    comptaDerniereDate = v.date;
    if (exE.annee !== comptaExerciceCourant()?.annee) DB.setFilter('compta_annee', String(exE.annee));
    showToast(`Écriture n° ${ligne} enregistrée`);
    renderCurrentView();
    if (suite) showComptaEcritureModal();
    else modal.hide();
};

const supprimerComptaEcriture = async (id) => {
    const e = (DB.get('compta_ecritures') || []).find(x => x.id === id);
    if (!e) return;
    const ok = await confirmDialog(`Supprimer l'écriture n° ${e.ligne} (${comptaFmt(e.montant)} CHF) ?`, { danger: true, confirmLabel: 'Supprimer' });
    if (!ok) return;
    const toutes = DB.get('compta_ecritures') || [];
    if (!toutes.some(x => x.id === id)) { renderCurrentView(); return; }
    const suivantes = toutes.filter(x => x.id !== id).map(x => {
        if (x.regle?.ecritureId !== id) return x;
        const y = { ...x };
        delete y.regle;
        return y;
    });
    if (!DB.set('compta_ecritures', suivantes)) return;
    showToast(`Écriture n° ${e.ligne} supprimée`);
    renderCurrentView();
};

const renumeroterComptaEcriture = (id) => {
    const toutes = DB.get('compta_ecritures') || [];
    const e = toutes.find(x => x.id === id);
    if (!e) return;
    const ligne = comptaProchaineLigne(e.annee, toutes);
    if (!DB.set('compta_ecritures', toutes.map(x => (x.id === id ? { ...x, ligne } : x)))) return;
    showToast(`Écriture renumérotée n° ${ligne}`);
    renderCurrentView();
};

// --- Règlement d'une facture ou d'une dette depuis sa liste ------------------------------
const showComptaReglerModal = (id) => {
    const ex = comptaExerciceCourant();
    const piece = (DB.get('compta_ecritures') || []).find(x => x.id === id);
    if (!ex || !piece) return;
    const exP = comptaExercices().find(x => x.annee === piece.annee) || ex;
    const type = comptaEstFacture(piece, exP) ? 'creance' : 'dette';
    const today = getLocalDateISOString();
    const compteDefaut = comptaNum(ex.compteBanque) || '';
    modal.show(`${type === 'creance' ? 'Encaisser la facture' : 'Payer la dette'} n° ${comptaNumeroPiece(piece, ex.annee)}`, `
        <form id="comptaReglerForm" class="cpt-form cpt-ecr" data-id="${escapeHtml(piece.id)}" novalidate>
            <p class="cpt-form-resume"><strong>${escapeHtml(comptaPieceTexte(piece, type))}</strong><span>${escapeHtml(`${comptaDate(piece.date)} · ${comptaFmt(piece.montant)} CHF`)}</span></p>
            <div class="form-row">
                <div class="form-group"><label for="cptRegDate">Date</label><input type="date" id="cptRegDate" name="date" value="${escapeHtml(today)}" required></div>
                <div class="form-group"><label for="cptRegMontant">Montant</label><div class="cpt-montant"><input type="text" id="cptRegMontant" name="montant" inputmode="decimal" autocomplete="off" value="${escapeHtml(comptaFmt(piece.montant))}" required><span class="cpt-montant-unite" aria-hidden="true">CHF</span></div></div>
            </div>
            <div class="form-group">
                <label for="cptRegCompte">${type === 'creance' ? 'Encaissé sur' : 'Payé depuis'}</label>
                <select id="cptRegCompte" name="compte">${comptaOptionsComptes(ex, compteDefaut, { vide: false, classes: ['actif', 'passif'] })}</select>
            </div>
            <div class="form-group">
                <label for="cptRegLibelle">Libellé</label>
                <input type="text" id="cptRegLibelle" name="libelle" value="${escapeHtml(comptaLibelleReglement(piece, type, ex.annee))}">
            </div>
        </form>
    `, `
        <button type="button" class="btn btn-secondary" data-click="close-modal">Annuler</button>
        <button type="button" class="btn btn-primary" data-click="compta-regler-enregistrer">Enregistrer</button>
    `);
};

const enregistrerComptaReglement = () => {
    const form = document.getElementById('comptaReglerForm');
    if (!form) return;
    const id = form.getAttribute('data-id');
    const date = form.elements.date.value;
    const montant = comptaLireMontant(form.elements.montant.value) || 0;
    const compte = comptaNum(form.elements.compte.value);
    const libelle = form.elements.libelle.value.trim();
    const exercices = comptaExercices();
    if (!comptaIsoValide(date)) { showToast('Date invalide', 'error'); return; }
    const exE = comptaExercicePourDate(date, exercices);
    if (!exE) { showToast(`Aucun exercice pour le ${comptaDate(date)}`, 'error'); return; }
    if (!montant) { showToast('Montant invalide', 'error'); return; }
    if (!compte) { showToast('Choisissez un compte', 'error'); return; }
    const toutes = DB.get('compta_ecritures') || [];
    const piece = toutes.find(x => x.id === id);
    if (!piece) { showToast('Pièce supprimée sur un autre appareil', 'error'); modal.hide(); renderCurrentView(); return; }
    if (piece.regle) { showToast('Cette pièce est déjà réglée', 'warning'); modal.hide(); renderCurrentView(); return; }
    const exP = exercices.find(x => x.annee === piece.annee) || exE;
    const estC = comptaEstFacture(piece, exP);
    const ligne = comptaProchaineLigne(exE.annee, toutes);
    if (ligne > COMPTA_XLSX.journal[1]) { showToast(`Le journal ${exE.annee} est plein`, 'error'); return; }
    const ecriture = {
        id: generateId(), annee: exE.annee, ligne, date, libelle, montant,
        debit: estC ? compte : comptaNum(exP.compteDettes),
        credit: estC ? comptaNum(exP.compteCreances) : compte
    };
    const suivantes = toutes.map(x => (x.id === id ? { ...x, regle: { date, ecritureId: ecriture.id } } : x));
    suivantes.push(ecriture);
    if (!DB.set('compta_ecritures', suivantes)) return;
    modal.hide();
    showToast(`Écriture n° ${ligne} enregistrée`);
    renderCurrentView();
};

const marquerComptaRegle = (id) => {
    const toutes = DB.get('compta_ecritures') || [];
    if (!toutes.some(x => x.id === id)) return;
    if (!DB.set('compta_ecritures', toutes.map(x => (x.id === id ? { ...x, regle: { date: getLocalDateISOString(), ecritureId: '' } } : x)))) return;
    showToast('Pièce marquée comme réglée');
    renderCurrentView();
};

const rouvrirComptaPiece = async (id) => {
    const e = (DB.get('compta_ecritures') || []).find(x => x.id === id);
    if (!e?.regle) return;
    const paiement = e.regle.ecritureId ? (DB.get('compta_ecritures') || []).find(x => x.id === e.regle.ecritureId) : null;
    if (paiement) {
        const ok = await confirmDialog(`Rouvrir la pièce n° ${e.ligne} ? L'écriture de règlement n° ${paiement.ligne} reste dans le journal.`, { confirmLabel: 'Rouvrir' });
        if (!ok) return;
    }
    const toutes = DB.get('compta_ecritures') || [];
    if (!DB.set('compta_ecritures', toutes.map(x => {
        if (x.id !== id) return x;
        const y = { ...x };
        delete y.regle;
        return y;
    }))) return;
    showToast('Pièce rouverte');
    renderCurrentView();
};

// --- Pièce (colonnes des feuilles Créance-client / Dette fournisseur) -------------------
const showComptaPieceModal = (id) => {
    const e = (DB.get('compta_ecritures') || []).find(x => x.id === id);
    const ex = comptaExerciceCourant();
    if (!e || !ex) return;
    const exP = comptaExercices().find(x => x.annee === e.annee) || ex;
    const estC = comptaEstFacture(e, exP);
    const type = estC ? 'creance' : 'dette';
    const p = e.piece || {};
    const champ = (id2, name, label, value, typeInput = 'text') => `<div class="form-group"><label for="${id2}">${escapeHtml(label)}</label><input type="${typeInput}" id="${id2}" name="${name}" value="${escapeHtml(value || '')}"></div>`;
    modal.show(`${estC ? 'Facture' : 'Dette'} n° ${comptaNumeroPiece(e, ex.annee)}`, `
        <form id="comptaPieceForm" class="cpt-form" data-id="${escapeHtml(e.id)}" novalidate>
            <p class="cpt-form-resume"><strong>${escapeHtml(e.libelle || '')}</strong><span>${escapeHtml(`${comptaDate(e.date)} · ${comptaFmt(e.montant)} CHF`)}</span></p>
            <div class="form-row">
                ${champ('cptPTexte', 'texte', estC ? 'Client' : 'Objet', p.texte || comptaPieceTexte(e, type))}
                ${champ('cptPTiers', 'tiers', estC ? 'De' : 'En faveur de', p.tiers || comptaPieceTiers(e, type))}
            </div>
            <div class="form-row">
                ${champ('cptPEcheance', 'echeance', estC ? "Payable jusqu'à" : 'Échue le', p.echeance, 'date')}
                ${estC ? champ('cptPRappel1', 'rappel1', '1er rappel', p.rappel1, 'date') : ''}
                ${estC ? champ('cptPRappel2', 'rappel2', '2e rappel', p.rappel2, 'date') : ''}
            </div>
        </form>
    `, `
        <button type="button" class="btn btn-secondary" data-click="close-modal">Annuler</button>
        <button type="button" class="btn btn-primary" data-click="compta-piece-enregistrer">Enregistrer</button>
    `);
};

const enregistrerComptaPiece = () => {
    const form = document.getElementById('comptaPieceForm');
    if (!form) return;
    const id = form.getAttribute('data-id');
    const piece = {};
    ['texte', 'tiers', 'echeance', 'rappel1', 'rappel2'].forEach(k => {
        const v = form.elements[k]?.value.trim();
        if (v) piece[k] = v;
    });
    const toutes = DB.get('compta_ecritures') || [];
    if (!toutes.some(x => x.id === id)) { showToast('Pièce supprimée sur un autre appareil', 'error'); modal.hide(); renderCurrentView(); return; }
    if (!DB.set('compta_ecritures', toutes.map(x => {
        if (x.id !== id) return x;
        const y = { ...x, piece };
        if (!Object.keys(piece).length) delete y.piece;
        return y;
    }))) return;
    modal.hide();
    showToast('Pièce enregistrée');
    renderCurrentView();
};

// =============================================================================
// Exercice : données de base, plan comptable, bilan d'ouverture, nouvel exercice
// =============================================================================
const comptaEnregistrerExercice = (annee, maj) => {
    const exercices = DB.get('compta_exercices') || [];
    const ex = exercices.find(x => x.annee === annee);
    if (!ex) { showToast('Exercice supprimé sur un autre appareil', 'error'); modal.hide(); renderCurrentView(); return false; }
    return DB.set('compta_exercices', exercices.map(x => (x.annee === annee ? maj({ ...x, comptes: (x.comptes || []).map(c => ({ ...c })) }) : x)));
};

const showComptaDonneesModal = () => {
    const ex = comptaExerciceCourant();
    if (!ex) return;
    const sel = (id, name, label, valeur, classes) => `<div class="form-group"><label for="${id}">${escapeHtml(label)}</label><select id="${id}" name="${name}">${comptaOptionsComptes(ex, valeur, { classes })}</select></div>`;
    modal.show(`Données de base ${ex.annee}`, `
        <form id="comptaDonneesForm" class="cpt-form" novalidate>
            <div class="form-row">
                <div class="form-group"><label for="cptDEntreprise">Nom de l'entreprise</label><input type="text" id="cptDEntreprise" name="entreprise" value="${escapeHtml(ex.entreprise || '')}"></div>
                <div class="form-group"><label for="cptDSiege">Siège</label><input type="text" id="cptDSiege" name="siege" value="${escapeHtml(ex.siege || '')}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label for="cptDDebut">Début de l'exercice</label><input type="date" id="cptDDebut" name="debut" value="${escapeHtml(ex.debut)}" required></div>
                <div class="form-group"><label for="cptDFin">Fin de l'exercice</label><input type="date" id="cptDFin" name="fin" value="${escapeHtml(ex.fin)}" required></div>
            </div>
            <div class="form-row">
                ${sel('cptDCreances', 'compteCreances', 'Compte des créances clients', ex.compteCreances, ['actif'])}
                ${sel('cptDDettes', 'compteDettes', 'Compte des dettes', ex.compteDettes, ['passif'])}
            </div>
            ${sel('cptDBanque', 'compteBanque', 'Compte de paiement', ex.compteBanque, ['actif', 'passif'])}
        </form>
    `, `
        <button type="button" class="btn btn-secondary" data-click="close-modal">Annuler</button>
        <button type="button" class="btn btn-primary" data-click="compta-exercice-donnees-enregistrer">Enregistrer</button>
    `);
};

const enregistrerComptaDonnees = () => {
    const form = document.getElementById('comptaDonneesForm');
    const ex = comptaExerciceCourant();
    if (!form || !ex) return;
    const f = form.elements;
    if (!comptaIsoValide(f.debut.value) || !comptaIsoValide(f.fin.value) || f.fin.value < f.debut.value) { showToast('Période invalide', 'error'); return; }
    const autre = comptaExercices().find(x => x.annee !== ex.annee && f.debut.value <= x.fin && f.fin.value >= x.debut);
    if (autre) { showToast(`La période chevauche l'exercice ${autre.annee}`, 'error'); return; }
    if (!comptaEnregistrerExercice(ex.annee, x => ({
        ...x, entreprise: f.entreprise.value.trim(), siege: f.siege.value.trim(), debut: f.debut.value, fin: f.fin.value,
        compteCreances: comptaNum(f.compteCreances.value), compteDettes: comptaNum(f.compteDettes.value), compteBanque: comptaNum(f.compteBanque.value)
    }))) return;
    modal.hide();
    showToast('Données de base enregistrées');
    renderCurrentView();
};

const showComptaCompteModal = (place) => {
    const ex = comptaExerciceCourant();
    const c = ex?.comptes?.[place];
    if (!c) return;
    const classe = COMPTA_CLASSES.find(x => x.id === c.classe);
    modal.show(`${classe?.label || 'Compte'} — emplacement ${place - COMPTA_CLASSES.slice(0, COMPTA_CLASSES.indexOf(classe)).reduce((s, x) => s + x.places, 0) + 1}`, `
        <form id="comptaCompteForm" class="cpt-form" data-place="${place}" novalidate>
            <div class="form-row">
                <div class="form-group"><label for="cptCNumero">Numéro</label><input type="text" id="cptCNumero" name="numero" inputmode="numeric" value="${escapeHtml(c.numero || '')}"></div>
                <div class="form-group"><label for="cptCNom">Nom du compte</label><input type="text" id="cptCNom" name="nom" value="${escapeHtml(c.nom || '')}"></div>
            </div>
            <div class="form-group"><label for="cptCRemarque">Remarque</label><input type="text" id="cptCRemarque" name="remarque" value="${escapeHtml(c.remarque || '')}"></div>
        </form>
    `, `
        <button type="button" class="btn btn-secondary" data-click="close-modal">Annuler</button>
        <button type="button" class="btn btn-primary" data-click="compta-compte-enregistrer">Enregistrer</button>
    `);
};

const enregistrerComptaCompte = async () => {
    const form = document.getElementById('comptaCompteForm');
    const ex0 = comptaExerciceCourant();
    if (!form || !ex0) return;
    const place = Number(form.getAttribute('data-place'));
    const numero = comptaNum(form.elements.numero.value);
    const nom = form.elements.nom.value.trim();
    const remarque = form.elements.remarque.value.trim();
    if (numero && !/^\d{1,6}$/.test(numero)) { showToast('Le numéro de compte ne contient que des chiffres', 'error'); return; }
    if (numero && (ex0.comptes || []).some((c, i) => i !== place && comptaNum(c.numero) === numero)) { showToast(`Le compte ${numero} existe déjà`, 'error'); return; }
    const ancien = comptaNum(ex0.comptes?.[place]?.numero);
    const annee = ex0.annee;
    const concernees = ancien && ancien !== numero
        ? comptaEcrituresDe(annee).filter(e => comptaNum(e.debit) === ancien || comptaNum(e.credit) === ancien).length : 0;
    let reporter = false;
    if (concernees && numero) {
        modal.hide();
        reporter = await confirmDialog(`Reporter le nouveau numéro ${numero} sur ${concernees > 1 ? `les ${concernees} écritures` : "l'écriture"} du compte ${ancien} ?`, { confirmLabel: 'Reporter', cancelLabel: 'Ne pas reporter' });
    }
    if (!comptaEnregistrerExercice(annee, x => {
        x.comptes[place] = { ...x.comptes[place], numero, nom, remarque };
        ['compteCreances', 'compteDettes', 'compteBanque'].forEach(k => { if (ancien && comptaNum(x[k]) === ancien && numero) x[k] = numero; });
        return x;
    })) return;
    if (reporter) {
        // Relecture après la confirmation
        const toutes = DB.get('compta_ecritures') || [];
        DB.set('compta_ecritures', toutes.map(e => {
            if (e.annee !== annee) return e;
            const d = comptaNum(e.debit) === ancien ? numero : e.debit;
            const k = comptaNum(e.credit) === ancien ? numero : e.credit;
            return d === e.debit && k === e.credit ? e : { ...e, debit: d, credit: k };
        }));
    }
    modal.hide();
    showToast(`Compte ${numero || ancien} enregistré`);
    renderCurrentView();
};

// Saisie du bilan d'ouverture dans le bilan lui-même, comme la feuille « Bilan
// d'ouverture » du classeur : un champ par compte, totaux et écart en direct.
// Le brouillon survit à un re-rendu (synchronisation d'un autre appareil).
const comptaLireMontant = (v) => {
    const s = String(v ?? '').replace(/[\s'’]/g, '').replace(',', '.');
    if (!s) return 0;
    const n = Number(s);
    return Number.isFinite(n) ? comptaRound(n) : null;
};

const comptaOuvertureEditionHtml = ({ ex, calc }) => {
    const brouillon = comptaOuvertureBrouillon || new Map();
    const cote = (classe, titre) => ({
        classe, titre,
        rangs: calc.comptes.filter(c => c.classe === classe && c.actif).map(c => `
            <li class="cpt-t-row is-saisie">
                <label class="cpt-t-saisie-label" for="cptOuv${c.place}"><span class="cpt-t-num">${escapeHtml(c.numero)}</span><span class="cpt-t-nom">${escapeHtml(c.nom)}</span></label>
                <input type="text" inputmode="decimal" autocomplete="off" class="cpt-t-input" id="cptOuv${c.place}" data-place="${c.place}" data-classe="${classe}" value="${escapeHtml(brouillon.has(c.place) ? brouillon.get(c.place) : (c.ouverture ? comptaFmt(c.ouverture) : ''))}" placeholder="0,00">
            </li>`)
    });
    const cotes = [cote('actif', 'Actifs'), cote('passif', 'Passifs')];
    const hauteur = Math.max(...cotes.map(c => c.rangs.length));
    return `
        <section class="stock-section" id="cptOuvEdition">
            <div class="stock-section-head cpt-t-head">
                <h2 class="stock-section-title">Bilan d'ouverture au ${escapeHtml(comptaDate(ex.debut))}</h2>
            </div>
            <div class="cpt-t">
                ${cotes.map(c => `
                    <div class="cpt-t-cote">
                        <h3 class="cpt-t-titre">${escapeHtml(c.titre)}</h3>
                        <ul class="cpt-t-liste">
                            ${c.rangs.join('')}
                            ${'<li class="cpt-t-row is-vide" aria-hidden="true"></li>'.repeat(hauteur - c.rangs.length)}
                        </ul>
                        <div class="cpt-t-total"><span>Total</span><span class="cpt-t-montant" data-total="${c.classe}"></span></div>
                    </div>`).join('')}
            </div>
            <div class="cpt-t-actions">
                <p class="cpt-avert" id="cptOuvEcart" aria-live="polite" hidden></p>
                <button type="button" class="btn btn-secondary" data-click="compta-ouverture-annuler">Annuler</button>
                <button type="button" class="btn btn-primary" data-click="compta-ouverture-enregistrer">Enregistrer</button>
            </div>
        </section>`;
};

const majComptaOuvertureTotaux = () => {
    const zone = document.getElementById('cptOuvEdition');
    if (!zone) return null;
    const totaux = { actif: 0, passif: 0 };
    let invalide = false;
    comptaOuvertureBrouillon = new Map();
    zone.querySelectorAll('input[data-place]').forEach(el => {
        comptaOuvertureBrouillon.set(Number(el.dataset.place), el.value);
        const v = comptaLireMontant(el.value);
        el.classList.toggle('is-invalid', v === null);
        if (v === null) invalide = true;
        else totaux[el.dataset.classe] = comptaRound(totaux[el.dataset.classe] + v);
    });
    zone.querySelectorAll('[data-total]').forEach(el => { el.textContent = comptaFmt(totaux[el.dataset.total] || 0); });
    const ecart = comptaRound(totaux.actif - totaux.passif);
    const msg = document.getElementById('cptOuvEcart');
    if (msg) {
        msg.hidden = !ecart;
        msg.textContent = ecart ? `Écart de ${comptaFmt(Math.abs(ecart))} CHF : ${ecart > 0 ? 'les actifs dépassent les passifs' : 'les passifs dépassent les actifs'}` : '';
    }
    return { totaux, ecart, invalide };
};

const initComptaOuvertureEdition = () => {
    const zone = document.getElementById('cptOuvEdition');
    if (!zone) return;
    zone.addEventListener('input', majComptaOuvertureTotaux);
    // Entrée passe au compte suivant, comme dans le classeur ; au dernier, enregistre
    zone.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing || !e.target.matches?.('input[data-place]')) return;
        e.preventDefault();
        const champs = [...zone.querySelectorAll('input[data-place]')];
        const suivant = champs[champs.indexOf(e.target) + 1];
        if (suivant) { suivant.focus(); suivant.select(); } else enregistrerComptaOuverture();
    });
    // Montant remis au format suisse en quittant le champ
    zone.addEventListener('focusout', (e) => {
        if (!e.target.matches?.('input[data-place]')) return;
        const v = comptaLireMontant(e.target.value);
        if (v !== null) e.target.value = v ? comptaFmt(v) : '';
        majComptaOuvertureTotaux();
    });
    majComptaOuvertureTotaux();
    if (comptaOuvertureFocus) {
        comptaOuvertureFocus = false;
        const premier = zone.querySelector('input[data-place]');
        premier?.focus();
        premier?.select();
    }
};

const ouvrirComptaOuverture = () => {
    DB.setFilter('compta_vue', 'bilan');
    DB.setFilter('compta_bilan_mode', 'ouverture');
    comptaOuvertureEdition = true;
    comptaOuvertureBrouillon = null;
    comptaOuvertureFocus = true;
    if (window.location.hash.slice(1).split('?')[0] === 'comptabilite') renderComptabilite();
    else gotoPage('comptabilite');
};

const fermerComptaOuverture = () => {
    comptaOuvertureEdition = false;
    comptaOuvertureBrouillon = null;
};

const enregistrerComptaOuverture = async () => {
    const zone = document.getElementById('cptOuvEdition');
    const ex = comptaExerciceCourant();
    if (!zone || !ex) return;
    const etat = majComptaOuvertureTotaux();
    if (etat.invalide) {
        showToast('Montant invalide', 'error');
        zone.querySelector('input.is-invalid')?.focus();
        return;
    }
    const valeurs = new Map([...zone.querySelectorAll('input[data-place]')].map(el => [Number(el.dataset.place), comptaLireMontant(el.value)]));
    const annee = ex.annee;
    if (etat.ecart) {
        const ok = await confirmDialog(`Le bilan d'ouverture n'est pas équilibré : actifs ${comptaFmt(etat.totaux.actif)}, passifs ${comptaFmt(etat.totaux.passif)}. Enregistrer quand même ?`, { confirmLabel: 'Enregistrer' });
        if (!ok) return;
    }
    // Relecture de l'exercice au moment d'écrire (comptaEnregistrerExercice)
    if (!comptaEnregistrerExercice(annee, x => {
        x.comptes.forEach((c, i) => { if (valeurs.has(i)) c.ouverture = valeurs.get(i); });
        return x;
    })) return;
    fermerComptaOuverture();
    showToast("Bilan d'ouverture enregistré");
    renderComptabilite();
};

// Nouvel exercice : plan repris du dernier, bilan d'ouverture = bilan final,
// résultat reporté sur le compte « Report » (2200 Report bénéficiaire)
const creerComptaExercice = async () => {
    const exercices = comptaExercices();
    const dernier = exercices[exercices.length - 1] || null;
    const annee = dernier ? dernier.annee + 1 : new Date().getFullYear();
    let comptes = comptaPlanVide();
    let message = `Créer l'exercice ${annee} avec un plan comptable vide ?`;
    if (dernier) {
        const calc = comptaCalcul(dernier, comptaEcrituresDe(dernier.annee));
        const report = calc.comptes.find(c => c.actif && c.classe === 'passif' && /report/i.test(c.nom));
        comptes = calc.comptes.map(c => ({
            classe: c.classe, numero: c.numero, nom: c.nom || '', remarque: c.remarque || '',
            ouverture: comptaEstClasseBilan(c.classe) && c.actif ? comptaRound(c.solde + (report && c.place === report.place ? calc.resultat : 0)) : 0
        }));
        message = `Créer l'exercice ${annee} ? Le plan comptable de ${dernier.annee} est repris et son bilan final devient le bilan d'ouverture`
            + (calc.resultat && report ? `, ${calc.resultat > 0 ? 'bénéfice' : 'perte'} de ${comptaFmt(Math.abs(calc.resultat))} CHF reporté${calc.resultat > 0 ? '' : 'e'} sur ${report.numero} ${report.nom}.` : '.');
    }
    const ok = await confirmDialog(message, { confirmLabel: 'Créer' });
    if (!ok) return;
    const actuels = DB.get('compta_exercices') || [];
    if (actuels.some(x => x.annee === annee)) { showToast(`L'exercice ${annee} existe déjà`, 'warning'); return; }
    const ex = {
        id: `exercice-${annee}`, annee, entreprise: dernier?.entreprise || '', siege: dernier?.siege || '',
        debut: `${annee}-01-01`, fin: `${annee}-12-31`, comptes,
        compteCreances: dernier?.compteCreances || '', compteDettes: dernier?.compteDettes || '', compteBanque: dernier?.compteBanque || ''
    };
    if (!DB.set('compta_exercices', [...actuels, ex])) return;
    DB.setFilter('compta_annee', String(annee));
    showToast(`Exercice ${annee} créé`);
    renderCurrentView();
};

// =============================================================================
// Import du classeur Excel
// =============================================================================
const ouvrirImportCompta = () => {
    let input = document.getElementById('comptaImportFile');
    if (!input) {
        input = document.createElement('input');
        input.type = 'file';
        input.id = 'comptaImportFile';
        input.accept = '.xlsx,.xlsm,.xls';
        input.hidden = true;
        input.setAttribute('data-change', 'compta-import-fichier');
        document.body.appendChild(input);
    }
    input.click();
};

const lireComptaExcel = async (input) => {
    const fichier = input.files?.[0];
    input.value = '';
    if (!fichier) return;
    if (typeof XLSX === 'undefined') { showToast('Erreur: Bibliothèque Excel non chargée', 'error'); return; }
    let analyse;
    try {
        const wb = XLSX.read(await fichier.arrayBuffer(), { type: 'array', dense: true, cellFormula: false, cellHTML: false, cellText: false, cellStyles: false });
        analyse = analyserComptaClasseur(wb);
    } catch (e) {
        console.error('Import comptabilité :', e);
        showToast('Fichier illisible', 'error');
        return;
    }
    if (!analyse) { showToast('Classeur non reconnu : feuilles « Plan de Compte » et « Journal » introuvables', 'error'); return; }
    comptaImport = { fichier: fichier.name, ...analyse };
    showComptaImportModal();
};

const comptaValeurDate = (v) => {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return comptaSerialVersIso(v);
    if (v instanceof Date && !Number.isNaN(v.getTime())) return toLocalDayKey(v.getTime());
    const s = String(v ?? '').trim();
    let m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(s);
    if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
};
const comptaValeurNombre = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const s = String(v ?? '').replace(/[’'\s]/g, '').replace(',', '.');
    return s && Number.isFinite(Number(s)) ? Number(s) : null;
};
const comptaValeurTexte = (v) => (v === null || v === undefined ? '' : String(v).trim());
const comptaValeurCompte = (v) => (typeof v === 'number' ? String(Math.round(v)) : comptaValeurTexte(v));

// Lecture des feuilles du modèle Buchhaltung v2.4 (positions fixes)
const analyserComptaClasseur = (wb) => {
    const norm = (s) => paletteNorm(s).replace(/[^a-z]/g, '');
    const nomFeuille = (debut) => wb.SheetNames.find(n => norm(n).startsWith(debut));
    const lignes = (debut) => {
        const nom = nomFeuille(debut);
        const ws = nom ? wb.Sheets[nom] : null;
        if (!ws || !ws['!ref']) return null;
        const plage = XLSX.utils.decode_range(ws['!ref']);
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true, range: { s: { r: 0, c: 0 }, e: { r: plage.e.r, c: Math.min(plage.e.c, 11) } } });
        return (r, c) => data[r - 1]?.[c] ?? null; // r : ligne Excel (1…), c : colonne (A = 0)
    };
    const plan = lignes('plandecompte');
    const journal = lignes('journal');
    if (!plan || !journal) return null;
    const base = lignes('donneedebase');
    const ouverture = lignes('bilandouverture');
    const creances = lignes('creance');
    const dettes = lignes('dette');

    const comptes = [];
    COMPTA_CLASSES.forEach(cl => {
        for (let k = 0; k < cl.places; k++) {
            const r = cl.lignePlan + k;
            const ouv = !ouverture ? 0 : cl.id === 'actif' ? comptaValeurNombre(ouverture(10 + k, 4)) : cl.id === 'passif' ? comptaValeurNombre(ouverture(10 + k, 10)) : 0;
            comptes.push({ classe: cl.id, numero: comptaValeurCompte(plan(r, 2)), nom: comptaValeurTexte(plan(r, 3)), remarque: comptaValeurTexte(plan(r, 4)), ouverture: comptaRound(ouv || 0) });
        }
    });

    const ecritures = [];
    for (let r = COMPTA_XLSX.journal[0]; r <= COMPTA_XLSX.journal[1]; r++) {
        const brut = [0, 1, 3, 5, 6, 7].map(c => journal(r, c));
        if (brut.every(v => v === null || v === '')) continue;
        ecritures.push({
            ligne: r,
            date: comptaValeurDate(brut[0]),
            debit: comptaValeurCompte(brut[1]),
            credit: comptaValeurCompte(brut[2]),
            libelle: comptaValeurTexte(brut[3]),
            montant: comptaRound(comptaValeurNombre(brut[4]) ?? 0),
            montantEur: comptaValeurNombre(brut[5])
        });
    }

    // Exercice : période de « Donnée de base », sinon l'année la plus présente du journal
    let debut = base ? comptaValeurDate(base(10, 1)) : '';
    let fin = base ? comptaValeurDate(base(10, 3)) : '';
    if (!debut || !fin) {
        const annees = new Map();
        ecritures.forEach(e => { const a = Number(e.date.slice(0, 4)); if (a > 2000) annees.set(a, (annees.get(a) || 0) + 1); });
        const annee = [...annees.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || new Date().getFullYear();
        debut = `${annee}-01-01`;
        fin = `${annee}-12-31`;
    }
    const annee = Number(fin.slice(0, 4));

    // Pièces ouvertes listées dans les feuilles Créance-client et Dette fournisseur
    const lirePieces = (get, [r0, r1], cols) => {
        const res = new Map();
        if (!get) return res;
        for (let r = r0; r <= r1; r++) {
            const n = comptaValeurNombre(get(r, 0));
            if (!n || !Number.isInteger(n)) continue;
            const p = {};
            Object.entries(cols).forEach(([k, c]) => {
                const v = get(r, c);
                const t = ['echeance', 'rappel1', 'rappel2', 'payeLe'].includes(k) ? comptaValeurDate(v) : comptaValeurTexte(v);
                if (t) p[k] = t;
            });
            res.set(n, p);
        }
        return res;
    };
    const piecesC = creances ? lirePieces(creances, COMPTA_XLSX.creances, { texte: 5, tiers: 6, echeance: 7, payeLe: 8, rappel1: 9, rappel2: 10 }) : null;
    const piecesD = dettes ? lirePieces(dettes, COMPTA_XLSX.dettes, { texte: 2, tiers: 3, echeance: 7, payeLe: 8 }) : null;

    // Comptes de créances et de dettes : ceux des pièces listées
    const parLigne = new Map(ecritures.map(e => [e.ligne, e]));
    const plusFrequent = (pieces, champ) => {
        const n = new Map();
        (pieces || new Map()).forEach((_, ligne) => { const v = parLigne.get(ligne)?.[champ]; if (v) n.set(v, (n.get(v) || 0) + 1); });
        return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    };
    const parNom = (classe, re) => comptes.find(c => c.classe === classe && comptaCompteActif(c) && re.test(c.nom))?.numero || '';
    const compteCreances = plusFrequent(piecesC, 'debit') || parNom('actif', /cr[ée]ances?/i);
    const compteDettes = plusFrequent(piecesD, 'credit') || parNom('passif', /dettes?/i);
    const compteBanque = parNom('actif', /banque/i) || parNom('actif', /poste/i);

    const anomalies = [];
    const nums = new Set(comptes.filter(comptaCompteActif).map(c => c.numero));
    ecritures.forEach(e => {
        const motifs = [];
        if (!e.date) motifs.push('date manquante');
        else if (e.date < debut || e.date > fin) motifs.push(`date ${comptaDate(e.date)} hors de l'exercice`);
        if (!nums.has(e.debit)) motifs.push(e.debit ? `compte ${e.debit} inconnu` : 'débit manquant');
        if (!nums.has(e.credit)) motifs.push(e.credit ? `compte ${e.credit} inconnu` : 'crédit manquant');
        if (!e.montant) motifs.push('montant manquant');
        if (motifs.length) anomalies.push({ ligne: e.ligne, texte: `${comptaDate(e.date)} · ${e.libelle}`.replace(/^ · /, ''), motif: motifs.join(', ') });
    });
    piecesC?.forEach((_, n) => { if (!parLigne.has(n)) anomalies.push({ ligne: n, texte: 'Créance-client', motif: `facture ${n} absente du journal` }); });
    piecesD?.forEach((_, n) => { if (!parLigne.has(n)) anomalies.push({ ligne: n, texte: 'Dette fournisseur', motif: `dette ${n} absente du journal` }); });
    anomalies.sort((a, b) => a.ligne - b.ligne);

    return {
        annee,
        exercice: {
            id: `exercice-${annee}`, annee, debut, fin,
            entreprise: base ? comptaValeurTexte(base(7, 1)) : '', siege: base ? comptaValeurTexte(base(8, 1)) : '',
            comptes, compteCreances, compteDettes, compteBanque
        },
        ecritures, piecesC, piecesD, anomalies
    };
};

// Lien « paye la facture 599 du 02.10 » → écriture 599 (pour retrouver le paiement)
const comptaReferencesPieces = (libelle) => {
    const refs = [];
    const s = String(libelle || '');
    for (const m of s.matchAll(/fact\w*\s+(?:[a-zà-ÿ]+\s+){0,3}(?:n[°o.]\s*)?(\d{1,4})(?![\d.-])/gi)) refs.push(Number(m[1]));
    for (const m of s.matchAll(/(?:^|[\s(])(\d{1,4})\s+du\s+\d{1,2}\.\d{1,2}/g)) refs.push(Number(m[1]));
    return [...new Set(refs)];
};

// Plan d'import sur les données enregistrées à cet instant (ajout et mise à jour, jamais de suppression)
const planComptaImport = (imp, toutes, exercices, { remplacerModifiees = false, remplacerPlan = false } = {}) => {
    const existant = exercices.find(x => x.annee === imp.annee) || null;
    const ex = existant && !remplacerPlan ? existant : {
        ...(existant || {}), ...imp.exercice,
        ...(existant ? { compteCreances: imp.exercice.compteCreances || existant.compteCreances, compteDettes: imp.exercice.compteDettes || existant.compteDettes, compteBanque: imp.exercice.compteBanque || existant.compteBanque } : {})
    };
    const planDiffere = !!existant && JSON.stringify((existant.comptes || []).map(c => [comptaNum(c.numero), c.nom || '', c.remarque || '', comptaRound(c.ouverture)]))
        !== JSON.stringify(imp.exercice.comptes.map(c => [c.numero, c.nom, c.remarque, comptaRound(c.ouverture)]));
    const actuelles = comptaEcrituresDe(imp.annee, toutes);
    const parLigne = new Map(actuelles.map(e => [e.ligne, e]));
    const pareil = (a, b) => a.date === b.date && comptaNum(a.debit) === b.debit && comptaNum(a.credit) === b.credit
        && String(a.libelle || '') === b.libelle && comptaRound(a.montant) === comptaRound(b.montant) && comptaRound(a.montantEur) === comptaRound(b.montantEur);
    const nouvelles = [];
    const modifiees = [];
    const presentes = [];
    imp.ecritures.forEach(l => {
        const e = parLigne.get(l.ligne);
        if (!e) nouvelles.push(l);
        else if (pareil(e, l)) presentes.push(e);
        else modifiees.push({ avant: e, l });
    });

    // Écritures résultantes de l'exercice
    const resultat = new Map(actuelles.map(e => [e.id, { ...e }]));
    const construire = (l, base = null) => {
        const e = { ...(base || {}), id: base?.id || `ecr-${imp.annee}-${l.ligne}`, annee: imp.annee, ligne: l.ligne, date: l.date, debit: l.debit, credit: l.credit, libelle: l.libelle, montant: l.montant };
        if (l.montantEur) e.montantEur = comptaRound(l.montantEur); else delete e.montantEur;
        return e;
    };
    nouvelles.forEach(l => {
        let e = construire(l);
        if (resultat.has(e.id)) e = { ...e, id: generateId() };
        resultat.set(e.id, e);
    });
    if (remplacerModifiees) modifiees.forEach(({ avant, l }) => resultat.set(avant.id, construire(l, avant)));

    // Créances et dettes : ouvertes si listées dans le fichier, sinon réglées
    const liste = [...resultat.values()];
    const parLigneRes = new Map(liste.map(e => [e.ligne, e]));
    const nouveauxIds = new Set(nouvelles.map(l => parLigneRes.get(l.ligne)?.id));
    let regleesDepuis = 0;
    // Une pièce absente de la liste du fichier n'est réglée que si son écriture est
    // dans le fichier (une facture saisie dans l'app après ce classeur reste ouverte)
    const lignesFichier = new Set(imp.ecritures.map(l => l.ligne));
    const appliquer = (type, pieces) => {
        const estPiece = (e) => (type === 'creance' ? comptaEstFacture(e, ex) : comptaEstDette(e, ex));
        const paiements = liste.filter(e => (type === 'creance' ? comptaNum(e.credit) === comptaNum(ex.compteCreances) : comptaNum(e.debit) === comptaNum(ex.compteDettes)));
        liste.filter(estPiece).forEach(e => {
            const p = pieces.get(e.ligne);
            const nouvelle = nouveauxIds.has(e.id);
            if (p) {
                const { payeLe, ...piece } = p;
                if (nouvelle || !e.piece) e.piece = { ...(e.piece || {}), ...piece };
                if (payeLe && !e.regle) e.regle = { date: payeLe, ecritureId: '' };
                return;
            }
            if (e.regle || !lignesFichier.has(e.ligne)) return;
            if (!nouvelle) regleesDepuis++;
            const paiement = paiements.find(x => x.ligne > e.ligne && comptaReferencesPieces(x.libelle).includes(e.ligne));
            e.regle = { date: paiement?.date || '', ecritureId: paiement?.id || '' };
        });
    };
    if (ex.compteCreances && imp.piecesC) appliquer('creance', imp.piecesC);
    if (ex.compteDettes && imp.piecesD) appliquer('dette', imp.piecesD);

    return { ex, existant, planDiffere, nouvelles, modifiees, presentes, regleesDepuis, liste };
};

const showComptaImportModal = () => {
    const imp = comptaImport;
    if (!imp) return;
    modal.show('Importer la comptabilité', `
        <form id="comptaImportForm" class="ptg-import cpt-import" novalidate>
            <p class="ptg-import-file">
                <strong>${escapeHtml(imp.fichier)}</strong>
                <span>${escapeHtml(`Exercice ${imp.annee} · ${dashPlural(imp.ecritures.length, 'écriture')} · ${comptaDate(imp.exercice.debut)} – ${comptaDate(imp.exercice.fin)}`)}</span>
            </p>
            <dl class="ptg-import-bilan" id="cptImpBilan"></dl>
            <div id="cptImpOptions"></div>
            <div id="cptImpVerifier"></div>
        </form>
    `, `
        <button type="button" class="btn btn-secondary" data-click="close-modal">Annuler</button>
        <button type="button" class="btn btn-primary" id="cptImpOk" data-click="compta-import-confirmer">Importer</button>
    `);
    majComptaImport();
};

const lireComptaImportOptions = () => {
    const form = document.getElementById('comptaImportForm');
    return {
        remplacerModifiees: !!form?.elements.remplacerModifiees?.checked,
        remplacerPlan: !!form?.elements.remplacerPlan?.checked
    };
};

const majComptaImport = () => {
    const imp = comptaImport;
    const form = document.getElementById('comptaImportForm');
    if (!imp || !form) return;
    const options = lireComptaImportOptions();
    const plan = planComptaImport(imp, DB.get('compta_ecritures') || [], comptaExercices(), options);
    const calc = comptaCalcul(plan.ex, plan.liste);
    const ouvertes = (type) => plan.liste.filter(e => (type === 'creance' ? comptaEstFacture(e, plan.ex) : comptaEstDette(e, plan.ex)) && !e.regle);
    const somme = (l) => comptaFmt(l.reduce((s, e) => s + (Number(e.montant) || 0), 0));
    const rang = (label, valeur) => `<div class="ptg-import-bilan-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(valeur)}</dd></div>`;
    const oc = ouvertes('creance');
    const od = ouvertes('dette');
    document.getElementById('cptImpBilan').innerHTML = [
        rang('Exercice', plan.existant ? `${imp.annee} (déjà présent)` : `${imp.annee} (nouveau)`),
        rang('Plan comptable', `${dashPlural(plan.ex.comptes.filter(comptaCompteActif).length, 'compte')}`),
        rang('À importer', plan.nouvelles.length ? dashPlural(plan.nouvelles.length, 'écriture') : 'aucune écriture'),
        plan.presentes.length ? rang('Déjà enregistrées', twinFmtInt(plan.presentes.length)) : '',
        plan.modifiees.length ? rang('Modifiées dans le fichier', twinFmtInt(plan.modifiees.length)) : '',
        plan.regleesDepuis ? rang('Réglées depuis', dashPlural(plan.regleesDepuis, 'pièce')) : '',
        rang('Factures ouvertes', `${twinFmtInt(oc.length)} · ${somme(oc)} CHF`),
        rang('Dettes ouvertes', `${twinFmtInt(od.length)} · ${somme(od)} CHF`),
        rang(comptaResultatLabel(calc.resultat), `${comptaFmt(Math.abs(calc.resultat))} CHF`)
    ].join('');

    const opts = document.getElementById('cptImpOptions');
    const coche = (name, label, checked) => `<label class="cpt-check"><input type="checkbox" name="${name}" data-change="compta-import-option"${checked ? ' checked' : ''}> ${escapeHtml(label)}</label>`;
    opts.innerHTML = [
        plan.modifiees.length ? coche('remplacerModifiees', `Remplacer les ${plan.modifiees.length} écritures modifiées`, options.remplacerModifiees) : '',
        plan.existant && plan.planDiffere ? coche('remplacerPlan', "Remplacer le plan comptable et le bilan d'ouverture", options.remplacerPlan) : ''
    ].join('');

    const zone = document.getElementById('cptImpVerifier');
    const ouvert = !!zone.querySelector('details')?.open;
    zone.innerHTML = imp.anomalies.length ? `
        <details class="ptg-import-details"${ouvert ? ' open' : ''}>
            <summary>Lignes à vérifier <span class="stock-section-meta">${escapeHtml(twinFmtInt(imp.anomalies.length))}</span></summary>
            <ul class="ptg-import-issues">${imp.anomalies.map(a => `
                <li><span>${escapeHtml(`Ligne ${a.ligne}${a.texte ? ` · ${a.texte}` : ''}`)}</span><span class="ptg-import-issue-why">${escapeHtml(a.motif)}</span></li>`).join('')}
            </ul>
        </details>` : '';

    const aFaire = plan.nouvelles.length + (options.remplacerModifiees ? plan.modifiees.length : 0) + plan.regleesDepuis + (!plan.existant || options.remplacerPlan ? 1 : 0);
    const ok = document.getElementById('cptImpOk');
    if (ok) {
        ok.disabled = aFaire === 0;
        ok.textContent = plan.nouvelles.length ? `Importer ${dashPlural(plan.nouvelles.length, 'écriture')}` : 'Importer';
    }
};

const importerComptaExcel = () => {
    const imp = comptaImport;
    if (!imp) return;
    // Relecture au moment d'importer
    const exercices = DB.get('compta_exercices') || [];
    const toutes = DB.get('compta_ecritures') || [];
    const options = lireComptaImportOptions();
    const plan = planComptaImport(imp, toutes, exercices.slice().sort((a, b) => a.annee - b.annee), options);
    if (!plan.existant || options.remplacerPlan) {
        const autres = exercices.filter(x => x.annee !== imp.annee);
        if (!DB.set('compta_exercices', [...autres, plan.ex])) return;
    }
    const ids = new Set(plan.liste.map(e => e.id));
    const suivantes = [...toutes.filter(e => e.annee !== imp.annee && !ids.has(e.id)), ...plan.liste];
    if (!DB.set('compta_ecritures', suivantes)) return;
    DB.setFilter('compta_annee', String(imp.annee));
    comptaImport = null;
    modal.hide();
    showToast(plan.nouvelles.length ? `${dashPlural(plan.nouvelles.length, 'écriture')} importée${plan.nouvelles.length > 1 ? 's' : ''}` : 'Comptabilité mise à jour');
    if (window.location.hash.slice(1).split('?')[0] === 'comptabilite') renderCurrentView();
    else gotoPage('comptabilite');
};

// =============================================================================
// Export dans le classeur Excel (même format que « Comptabilité SàRL »)
// =============================================================================
const comptaXmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const comptaXmlValeur = (v) => (typeof v === 'number' ? String(comptaRound(v)) : v);

// Écrit des valeurs dans les cellules existantes du modèle. valeurs : Map réf → { v, cache }
// - cellule à formule : la formule est gardée, v devient sa valeur en cache
// - cellule simple : v la remplace (nombre ou texte) ; une réf. absente est une erreur
// - cache : n'écrit que sur une cellule à formule
const comptaXmlCellules = (xml, valeurs) => {
    const vues = new Set();
    const res = xml.replace(/<c r="([A-Z]+[0-9]+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (m, ref, attrs, inner) => {
        const val = valeurs.get(ref);
        if (!val) return m;
        vues.add(ref);
        const s = (/\ss="\d+"/.exec(attrs) || [''])[0];
        const formule = inner ? (/<f[^>]*\/>|<f[^>]*>[\s\S]*?<\/f>/.exec(inner) || [null])[0] : null;
        const v = val.v;
        if (formule) {
            if (v === null || v === undefined || v === '') return m;
            if (typeof v === 'number') return `<c r="${ref}"${s}>${formule}<v>${comptaXmlValeur(v)}</v></c>`;
            if (val.erreur) return `<c r="${ref}"${s} t="e">${formule}<v>${comptaXmlEsc(v)}</v></c>`;
            return `<c r="${ref}"${s} t="str">${formule}<v>${comptaXmlEsc(v)}</v></c>`;
        }
        if (val.cache) return m;
        if (v === null || v === undefined || v === '') return `<c r="${ref}"${s}/>`;
        if (typeof v === 'number') return `<c r="${ref}"${s}><v>${comptaXmlValeur(v)}</v></c>`;
        return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${comptaXmlEsc(v)}</t></is></c>`;
    });
    const manquantes = [...valeurs.entries()].filter(([ref, val]) => !val.cache && !vues.has(ref)).map(([ref]) => ref);
    if (manquantes.length) throw new Error(`cellules absentes du modèle : ${manquantes.slice(0, 5).join(', ')}`);
    return res;
};

const comptaCompteXlsx = (num) => (/^\d+$/.test(comptaNum(num)) ? Number(comptaNum(num)) : comptaNum(num));

// Lignes 12…1619 du Journal, générées à partir de la ligne 12 du modèle (formules du
// grand livre recopiées ligne par ligne, comme dans le classeur d'origine)
const comptaJournalXml = (xml, ecritures, calc, versLigne) => {
    const m = /<row r="12"[^>]*>([\s\S]*?)<\/row>/.exec(xml);
    if (!m) throw new Error('ligne 12 du journal absente du modèle');
    const ouverture = m[0].slice(0, m[0].indexOf('>') + 1);
    const cellules = [...m[1].matchAll(/<c r="([A-Z]+)12"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)];
    const iSuite = cellules.findIndex(c => c[1] === 'I');
    if (iSuite < 0) throw new Error('colonnes du journal inattendues');
    const tete = new Map(cellules.slice(0, iSuite).map(c => [c[1], { s: (/\ss="\d+"/.exec(c[2]) || [''])[0], f: c[3] ? (/<f>([\s\S]*?)<\/f>/.exec(c[3]) || [])[1] : null }]));
    const decoupe = (txt) => txt.split(/([A-Z])12(?![0-9])/);
    const recoud = (parts, r) => { let s = ''; for (let i = 0; i < parts.length; i++) s += i % 2 ? parts[i] + r : parts[i]; return s; };
    const suite = decoupe(cellules.slice(iSuite).map(c => c[0]).join(''));
    const formules = new Map([...tete].filter(([, c]) => c.f).map(([col, c]) => [col, decoupe(c.f)]));
    const parLigne = new Map(ecritures.map(e => [e.ligne, e]));
    const cell = (col, r, v) => {
        const s = tete.get(col)?.s || '';
        if (v === null || v === undefined || v === '') return `<c r="${col}${r}"${s}/>`;
        if (typeof v === 'number') return `<c r="${col}${r}"${s}><v>${comptaXmlValeur(v)}</v></c>`;
        return `<c r="${col}${r}"${s} t="inlineStr"><is><t xml:space="preserve">${comptaXmlEsc(v)}</t></is></c>`;
    };
    const formule = (col, r, nom) => {
        const s = tete.get(col)?.s || '';
        const f = recoud(formules.get(col), r);
        if (nom === undefined) return `<c r="${col}${r}"${s}><f>${f}</f></c>`;
        if (nom === null) return `<c r="${col}${r}"${s} t="e"><f>${f}</f><v>#N/A</v></c>`;
        return `<c r="${col}${r}"${s} t="str"><f>${f}</f><v>${comptaXmlEsc(nom)}</v></c>`;
    };
    const nomDe = (num) => (num ? (calc.parNum.get(comptaNum(num))?.nom ?? null) : undefined);
    const out = [];
    const [r0, r1] = COMPTA_XLSX.journal;
    for (let r = r0; r <= r1; r++) {
        const e = parLigne.get(r);
        out.push(ouverture.replace(' r="12"', ` r="${r}"`));
        out.push(cell('A', r, e && comptaIsoValide(e.date) ? comptaIsoVersSerial(e.date) : ''));
        out.push(cell('B', r, e ? comptaCompteXlsx(e.debit) : ''));
        out.push(formules.has('C') ? formule('C', r, e ? nomDe(e.debit) : undefined) : cell('C', r, ''));
        out.push(cell('D', r, e ? comptaCompteXlsx(e.credit) : ''));
        out.push(formules.has('E') ? formule('E', r, e ? nomDe(e.credit) : undefined) : cell('E', r, ''));
        out.push(cell('F', r, e ? e.libelle || '' : ''));
        out.push(cell('G', r, e ? comptaRound(e.montant) : ''));
        out.push(cell('H', r, e && Number(e.montantEur) ? comptaRound(e.montantEur) : ''));
        out.push(recoud(suite, r));
        out.push('</row>');
    }
    let res = xml.slice(0, m.index) + out.join('') + xml.slice(m.index + m[0].length);
    // Ouverture du fichier sur les dernières écritures, comme le classeur tenu à la main
    const suivante = Math.min(r1, Math.max(r0, versLigne));
    res = res.replace(/<selection activeCell="A12" sqref="A12"\/>/, `<selection activeCell="A${suivante}" sqref="A${suivante}"/>`)
        .replace(/<sheetView tabSelected="1"/, `<sheetView tabSelected="1" topLeftCell="A${Math.max(1, suivante - 20)}"`);
    return res;
};

// Valeurs de toutes les feuilles (et valeurs en cache des formules, pour un affichage
// correct même en « mode protégé » d'Excel, qui ne recalcule pas)
const comptaValeursExport = (ex, ecritures, calc, toutes, exercices) => {
    const V = () => new Map();
    const set = (map, ref, v, opts = {}) => map.set(ref, { v, ...opts });
    const cache = (map, ref, v, opts = {}) => { if (v !== '' && v !== null && v !== undefined) map.set(ref, { v, cache: true, ...opts }); };
    const debutTxt = comptaDate(ex.debut);
    const finTxt = comptaDate(ex.fin);
    const entete1 = `${ex.entreprise || ''}, ${ex.siege || ''}`;
    const entete3 = `Rechnungsperiode: ${debutTxt} – ${finTxt}`;
    const entetes = (map) => { cache(map, 'A1', entete1); cache(map, 'A3', entete3); return map; };
    const f = { base: entetes(V()), plan: entetes(V()), ouverture: entetes(V()), journal: entetes(V()), bilan: entetes(V()), resultat: entetes(V()), paye: entetes(V()), creances: entetes(V()), dettes: entetes(V()) };

    // Donnée de base
    set(f.base, 'B7', ex.entreprise || '');
    set(f.base, 'B8', ex.siege || '');
    set(f.base, 'B10', debutTxt);
    set(f.base, 'D10', finTxt);

    // Plan de compte, bilan d'ouverture, bilan final, compte de résultat
    let place = 0;
    COMPTA_CLASSES.forEach(cl => {
        for (let k = 0; k < cl.places; k++, place++) {
            const c = calc.comptes[place] || { numero: '', nom: '', remarque: '', ouverture: 0, actif: false, solde: null };
            const r = cl.lignePlan + k;
            set(f.plan, `C${r}`, c.numero ? comptaCompteXlsx(c.numero) : '');
            set(f.plan, `D${r}`, c.nom || '');
            set(f.plan, `E${r}`, c.remarque || '');
            const num = c.numero ? comptaCompteXlsx(c.numero) : '';
            if (cl.id === 'actif' || cl.id === 'passif') {
                const rb = 10 + k;
                const [cn, cnom, cv] = cl.id === 'actif' ? ['B', 'C', 'E'] : ['H', 'I', 'K'];
                set(f.ouverture, `${cv}${rb}`, c.ouverture ? comptaRound(c.ouverture) : '');
                cache(f.ouverture, `${cn}${rb}`, num);
                cache(f.ouverture, `${cnom}${rb}`, c.nom || '');
                cache(f.bilan, `${cn}${rb}`, num);
                cache(f.bilan, `${cnom}${rb}`, c.nom || '');
                if (c.actif) cache(f.bilan, `${cv}${rb}`, c.solde);
            } else {
                const rr = 10 + k;
                const [cn, cnom, cv] = cl.id === 'charge' ? ['B', 'C', 'E'] : ['H', 'I', 'K'];
                cache(f.resultat, `${cn}${rr}`, num);
                cache(f.resultat, `${cnom}${rr}`, c.nom || '');
                if (c.actif) cache(f.resultat, `${cv}${rr}`, c.solde);
            }
        }
    });
    cache(f.ouverture, 'E30', calc.ouvertureActifs);
    cache(f.ouverture, 'K30', calc.ouverturePassifs);
    const r = calc.resultat;
    const perte = r < 0 ? -r : 0;
    const benefice = r > 0 ? r : 0;
    cache(f.bilan, 'D7', `Bilan Final ${finTxt}`);
    if (calc.passifs > calc.actifs) cache(f.bilan, 'C28', 'Perte');
    if (calc.passifs < calc.actifs) cache(f.bilan, 'I28', 'Bénéfices');
    if (perte) cache(f.bilan, 'E28', perte);
    if (benefice) cache(f.bilan, 'K28', benefice);
    cache(f.bilan, 'E31', comptaRound(calc.actifs + perte));
    cache(f.bilan, 'K31', comptaRound(calc.passifs + benefice));
    cache(f.resultat, 'D7', `Erfolgsrechnung ${debutTxt} - ${finTxt}`);
    if (benefice) { cache(f.resultat, 'C29', 'Bénéfices'); cache(f.resultat, 'E29', benefice); }
    if (perte) { cache(f.resultat, 'I29', 'Perte'); cache(f.resultat, 'K29', perte); }
    cache(f.resultat, 'E32', comptaRound(calc.charges + benefice));
    cache(f.resultat, 'K32', comptaRound(calc.produits + perte));
    cache(f.journal, 'A11', debutTxt);
    cache(f.journal, 'G11', calc.ouvertureActifs);

    // Créance-client et Dette fournisseur : pièces ouvertes à la fin de l'exercice
    const ouvertes = (type) => comptaPieces(ex, type, toutes, exercices).filter(e => comptaOuverteAu(e, ex.fin)).sort((a, b) => a.annee - b.annee || a.ligne - b.ligne);
    const oc = ouvertes('creance');
    const od = ouvertes('dette');
    const [c0, c1] = COMPTA_XLSX.creances;
    const [d0, d1] = COMPTA_XLSX.dettes;
    if (oc.length > c1 - c0 + 1) throw new Error(`trop de factures ouvertes pour la feuille Créance-client (${oc.length})`);
    if (od.length > d1 - d0 + 1) throw new Error(`trop de dettes ouvertes pour la feuille Dette fournisseur (${od.length})`);
    const numPiece = (e) => (e.annee === ex.annee ? e.ligne : `${e.annee}-${e.ligne}`);
    const dateXl = (iso) => (comptaIsoValide(iso) ? comptaIsoVersSerial(iso) : '');
    let totalC = 0;
    oc.forEach((e, i) => {
        const rr = c0 + i;
        const montant = comptaRound(e.montant);
        totalC += montant;
        set(f.creances, `A${rr}`, numPiece(e));
        set(f.creances, `B${rr}`, dateXl(e.date));
        set(f.creances, `C${rr}`, montant);
        set(f.creances, `F${rr}`, comptaPieceTexte(e, 'creance'));
        set(f.creances, `G${rr}`, e.piece?.tiers || '');
        set(f.creances, `H${rr}`, dateXl(e.piece?.echeance));
        set(f.creances, `J${rr}`, dateXl(e.piece?.rappel1));
        set(f.creances, `K${rr}`, dateXl(e.piece?.rappel2));
        cache(f.creances, `D${rr}`, montant / 107.6 * 100);
        cache(f.creances, `E${rr}`, montant / 107.6 * 7.6);
        cache(f.creances, `L${rr}`, montant);
    });
    cache(f.creances, 'C5', comptaRound(totalC));
    cache(f.creances, 'L498', comptaRound(totalC));
    cache(f.creances, 'A4', ` Zur Zeit ausstehende Rechnungen: ${comptaRound(totalC)} CHF`);
    let totalD = 0;
    od.forEach((e, i) => {
        const rr = d0 + i;
        const montant = comptaRound(e.montant);
        totalD += montant;
        set(f.dettes, `A${rr}`, numPiece(e));
        set(f.dettes, `B${rr}`, dateXl(e.date));
        set(f.dettes, `C${rr}`, comptaPieceTexte(e, 'dette'));
        set(f.dettes, `D${rr}`, comptaPieceTiers(e, 'dette'));
        set(f.dettes, `E${rr}`, montant);
        set(f.dettes, `H${rr}`, dateXl(e.piece?.echeance));
    });
    cache(f.dettes, 'E7', comptaRound(totalD));
    return f;
};

const exporterComptaExcel = async (btn) => {
    const ex = comptaExerciceCourant();
    if (!ex) return;
    if (typeof JSZip === 'undefined') { showToast('Erreur: Bibliothèque ZIP non chargée', 'error'); return; }
    const toutes = DB.get('compta_ecritures') || [];
    const exercices = comptaExercices();
    const ecritures = comptaEcrituresDe(ex.annee, toutes);
    const lignes = new Set();
    for (const e of ecritures) {
        if (e.ligne < COMPTA_XLSX.journal[0] || e.ligne > COMPTA_XLSX.journal[1]) { showToast(`Écriture n° ${e.ligne} hors des lignes du journal Excel`, 'error'); return; }
        if (lignes.has(e.ligne)) { showToast(`N° ${e.ligne} en double dans le journal : donnez-lui un nouveau numéro avant l'export`, 'error'); return; }
        lignes.add(e.ligne);
    }
    const restaurer = setBusy(btn, 'Export…');
    try {
        const reponse = await fetch(COMPTA_XLSX.modele);
        if (!reponse.ok) throw new Error('modèle introuvable');
        const zip = await JSZip.loadAsync(await reponse.arrayBuffer());
        const calc = comptaCalcul(ex, ecritures);
        const valeurs = comptaValeursExport(ex, ecritures, calc, toutes, exercices);
        for (const [cle, chemin] of Object.entries(COMPTA_XLSX.feuilles)) {
            const fichier = zip.file(chemin);
            if (!fichier) throw new Error(`feuille absente du modèle : ${chemin}`);
            let xml = await fichier.async('string');
            // valeurs d'abord (modèle léger), puis les 1608 lignes du journal
            xml = comptaXmlCellules(xml, valeurs[cle] || new Map());
            if (cle === 'journal') xml = comptaJournalXml(xml, ecritures, calc, Math.max(COMPTA_XLSX.journal[0] - 1, ...ecritures.map(e => e.ligne)) + 1);
            zip.file(chemin, xml);
        }
        const blob = await zip.generateAsync({
            type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 },
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Comptabilité SàRL ${ex.annee}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast(`Comptabilité ${ex.annee} exportée`);
    } catch (e) {
        console.error('Export comptabilité :', e);
        showToast(`Export impossible : ${e.message || e}`, 'error');
    } finally {
        restaurer();
    }
};

// =============================================================================
// Actions
// =============================================================================
CLICK_HANDLERS['compta-vue'] = (el) => {
    const vue = el.getAttribute('data-value') || 'journal';
    DB.setFilter('compta_vue', COMPTA_VUES.some(([v]) => v === vue) ? vue : 'journal');
    comptaJournalTout = false;
    fermerComptaOuverture();
    renderComptabilite();
};
CHANGE_HANDLERS['compta-exercice-choix'] = (el) => { DB.setFilter('compta_annee', el.value); comptaJournalTout = false; fermerComptaOuverture(); renderComptabilite(); };
CHANGE_HANDLERS['compta-filtre'] = (el) => {
    const nom = el.getAttribute('data-name');
    if (!['compta_compte', 'compta_mois', 'compta_compte_gl'].includes(nom)) return;
    DB.setFilter(nom, el.value);
    renderComptabilite();
};
CLICK_HANDLERS['compta-bilan-mode'] = (el) => {
    DB.setFilter('compta_bilan_mode', el.getAttribute('data-value') === 'ouverture' ? 'ouverture' : '');
    fermerComptaOuverture();
    renderComptabilite();
};
CLICK_HANDLERS['compta-stats-mesure'] = (el) => {
    DB.setFilter('compta_stats_mesure', el.getAttribute('data-value') || 'ventes');
    renderComptabilite();
};
CLICK_HANDLERS['compta-journal-tout'] = () => { comptaJournalTout = true; renderComptabilite(); };
CLICK_HANDLERS['compta-ecriture-nouvelle'] = () => showComptaEcritureModal();
CLICK_HANDLERS['compta-ecriture-modifier'] = (el) => showComptaEcritureModal({ id: el.getAttribute('data-id') });
CLICK_HANDLERS['compta-ecriture-dupliquer'] = (el) => showComptaEcritureModal({ id: el.getAttribute('data-id'), dupliquer: true });
CLICK_HANDLERS['compta-ecriture-supprimer'] = (el) => supprimerComptaEcriture(el.getAttribute('data-id'));
CLICK_HANDLERS['compta-ecriture-renumeroter'] = (el) => renumeroterComptaEcriture(el.getAttribute('data-id'));
CLICK_HANDLERS['compta-ecriture-enregistrer'] = (el) => enregistrerComptaEcriture({ suite: el.getAttribute('data-suite') === '1' });
CHANGE_HANDLERS['compta-ecr-comptes'] = () => majComptaEcriturePiece();
CLICK_HANDLERS['compta-ecr-eur'] = (el) => {
    const groupe = document.getElementById('cptEcrEurGroupe');
    if (!groupe) return;
    groupe.hidden = false;
    el.remove();
    document.getElementById('cptEcrEur')?.focus();
};
CHANGE_HANDLERS['compta-ecr-regle'] = () => preRemplirComptaReglement();
CLICK_HANDLERS['compta-regler'] = (el) => showComptaReglerModal(el.getAttribute('data-id'));
CLICK_HANDLERS['compta-regler-enregistrer'] = () => enregistrerComptaReglement();
CLICK_HANDLERS['compta-marquer-regle'] = (el) => marquerComptaRegle(el.getAttribute('data-id'));
CLICK_HANDLERS['compta-rouvrir'] = (el) => rouvrirComptaPiece(el.getAttribute('data-id'));
CLICK_HANDLERS['compta-piece'] = (el) => showComptaPieceModal(el.getAttribute('data-id'));
CLICK_HANDLERS['compta-piece-enregistrer'] = () => enregistrerComptaPiece();
CLICK_HANDLERS['compta-voir-journal'] = (el) => {
    const e = (DB.get('compta_ecritures') || []).find(x => x.id === el.getAttribute('data-id'));
    if (!e) return;
    DB.setFilter('compta_annee', String(e.annee));
    DB.setFilter('compta_vue', 'journal');
    DB.setFilter('compta_recherche', String(e.ligne));
    DB.setFilter('compta_compte', '');
    DB.setFilter('compta_mois', '');
    renderComptabilite();
};
CLICK_HANDLERS['compta-compte-grand-livre'] = (el) => {
    DB.setFilter('compta_compte_gl', el.getAttribute('data-num') || '');
    DB.setFilter('compta_vue', 'grand-livre');
    renderComptabilite();
};
CLICK_HANDLERS['compta-compte-modifier'] = (el) => showComptaCompteModal(Number(el.getAttribute('data-place')));
CLICK_HANDLERS['compta-compte-enregistrer'] = () => enregistrerComptaCompte();
CLICK_HANDLERS['compta-exercice-donnees'] = () => showComptaDonneesModal();
CLICK_HANDLERS['compta-exercice-donnees-enregistrer'] = () => enregistrerComptaDonnees();
CLICK_HANDLERS['compta-ouverture'] = () => ouvrirComptaOuverture();
CLICK_HANDLERS['compta-ouverture-annuler'] = () => { fermerComptaOuverture(); renderComptabilite(); };
CLICK_HANDLERS['compta-ouverture-enregistrer'] = () => enregistrerComptaOuverture();
CLICK_HANDLERS['compta-exercice-nouveau'] = () => creerComptaExercice();
CLICK_HANDLERS['compta-import'] = () => ouvrirImportCompta();
CHANGE_HANDLERS['compta-import-fichier'] = (el) => lireComptaExcel(el);
CHANGE_HANDLERS['compta-import-option'] = () => majComptaImport();
CLICK_HANDLERS['compta-import-confirmer'] = () => importerComptaExcel();
CLICK_HANDLERS['compta-export'] = (el) => exporterComptaExcel(el);

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
    // Ancien backup pré-synchro (synchro legacy) : sa restauration repoussait des
    // valeurs périmées vers le cloud ; il n'est plus créé ni restaurable.
    localStorage.removeItem('thecol_backup_pre_sync');
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
