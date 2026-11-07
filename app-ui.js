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
    initRowMenus();
    initLiveSearch();
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
            renderInventaire: renderInventaire,
            renderDashboard: renderDashboard
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
// Tableau de bord
// ---------------------------------------------------------------------------
CLICK_HANDLERS['toggle-todo'] = (el) => toggleTodo(el.getAttribute('data-id'));
CLICK_HANDLERS['delete-todo'] = (el) => deleteTodo(el.getAttribute('data-id'));
CLICK_HANDLERS['dash-add-todo'] = () => {
    const input = document.getElementById('todoInput');
    if (!input) return;
    const text = input.value;
    input.value = '';
    addTodo(text);
    document.getElementById('todoInput')?.focus();
};
CLICK_HANDLERS['dash-clear-todos'] = () => clearDoneTodos();
CLICK_HANDLERS['dash-new-commande'] = () => showCommandeModal();
CLICK_HANDLERS['dash-new-lot'] = () => showNouveauLotModal();
// Jour du bandeau « Livraisons · 7 jours » → page Commandes filtrée sur ce jour
CLICK_HANDLERS['dash-goto-day'] = (el) => {
    weekCalendarSelectedDate = el.getAttribute('data-date') || '';
    gotoPage('commandes');
};

// ---------------------------------------------------------------------------
// Stock / Historique
// ---------------------------------------------------------------------------
CLICK_HANDLERS['stock-select-cell'] = (el) => selectStockCell(el.getAttribute('data-key') || '', el.hasAttribute('data-force'));
CLICK_HANDLERS['stock-focus'] = (el) => toggleStockFocus(el.getAttribute('data-value') || '');
CLICK_HANDLERS['stock-goto-production'] = () => { window.location.hash = '#production'; };
CLICK_HANDLERS['stock-goto-hors-vente'] = () => showStockHorsVente();
CHANGE_HANDLERS['update-lot-dates'] = (el) => {
    const form = el.form;
    if (!form || !el.value) return;
    const dates = calculateDates(el.value);
    form.elements.dlv.value = dates.dlv;
    form.elements.dlc.value = dates.dlc;
};
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
CLICK_HANDLERS['sortir-lots-perimes'] = (el) => sortirLotsPerimes((el.getAttribute('data-ids') || '').split(',').filter(Boolean));

// ---------------------------------------------------------------------------
// Pointage
// ---------------------------------------------------------------------------
CLICK_HANDLERS['pointage-vue'] = (el) => {
    const vue = el.getAttribute('data-value');
    DB.setFilter('pointage_vue', vue === 'mois' || vue === 'annee' ? vue : 'semaine');
    renderPointage();
};
CLICK_HANDLERS['pointage-voir-mois'] = (el) => pointageVoirMois(el.getAttribute('data-mois') || '');
CLICK_HANDLERS['pointage-nav'] = (el) => pointageNaviguer(Number(el.getAttribute('data-dir')) || 0);
CLICK_HANDLERS['pointage-saisir'] = () => showPointageJourModal();
CLICK_HANDLERS['pointage-jour'] = (el) => showPointageJourModal({
    employeId: el.getAttribute('data-emp') || '',
    date: el.getAttribute('data-date') || '',
    focusId: el.getAttribute('data-focus') || ''
});
CLICK_HANDLERS['pointage-plage-ajout'] = () => ajouterPlageJour();
CLICK_HANDLERS['pointage-plage-suppr'] = (el) => retirerPlageJour(el);
CLICK_HANDLERS['save-pointage-jour'] = () => savePointageJour();
CLICK_HANDLERS['pointage-maintenant-modal'] = () => showPointerMaintenantModal();
CLICK_HANDLERS['pointage-maintenant'] = (el) => {
    const id = el.getAttribute('data-id');
    const ok = el.getAttribute('data-sens') === 'depart' ? clockOutEmployee(id) : clockInEmployee(id);
    if (!ok) return;
    modal.hide();
    renderCurrentView();
};
CLICK_HANDLERS['pointage-export'] = () => (DB.getFilter('pointage_vue') === 'annee' ? exportPointagesAnnee() : exportPointagesMois());
CLICK_HANDLERS['delete-pointage'] = (el) => deletePointage(el.getAttribute('data-id'));
CLICK_HANDLERS['cloturer-pointage'] = (el) => cloturerPointage(el.getAttribute('data-id'));
CHANGE_HANDLERS['pointage-jour-cible'] = () => chargerPlagesJour();
CLICK_HANDLERS['pointage-import'] = () => ouvrirImportPointages();
CHANGE_HANDLERS['pointage-import-fichier'] = (el) => lirePointagesExcel(el);
CHANGE_HANDLERS['pointage-import-personne'] = () => majPointageImport();
CLICK_HANDLERS['pointage-import-confirmer'] = () => importerPointagesExcel();

// ---------------------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------------------
CLICK_HANDLERS['select-week-day'] = (el) => selectWeekDay(el.getAttribute('data-date'));
CLICK_HANDLERS['toggle-pill-statut'] = (el) => togglePillStatut(el.getAttribute('data-value'));
CLICK_HANDLERS['show-commande-details'] = (el) => showCommandeDetails(el.getAttribute('data-id'));
CLICK_HANDLERS['save-commande'] = (el, e) => saveCommande(e, el.getAttribute('data-id') || '');
CLICK_HANDLERS['edit-commande'] = (el) => editCommande(el.getAttribute('data-id'));
CLICK_HANDLERS['duplicate-commande'] = (el, e) => duplicateCommande(el.getAttribute('data-id'), e);
CLICK_HANDLERS['marquer-commande-produite'] = (el) => marquerCommandeProduite(el.getAttribute('data-id'));
CLICK_HANDLERS['confirm-annuler-commande'] = (el) => confirmAnnulerCommande(el.getAttribute('data-id'));
CLICK_HANDLERS['livrer-commande'] = (el) => showLivraisonBouteillesModal(el.getAttribute('data-id'));
CLICK_HANDLERS['livraison-en-plus'] = (el) => ouvrirEnPlusLivraison(el.getAttribute('data-ligne'));
CLICK_HANDLERS['livraison-hors-commande'] = () => montrerHorsCommandeLivraison();
CLICK_HANDLERS['livraison-hors-commande-ajouter'] = () => ajouterHorsCommandeLivraison();
CLICK_HANDLERS['livraison-retirer-ligne'] = (el) => retirerLigneLivraison(el.getAttribute('data-ligne'));
CLICK_HANDLERS['livraison-confirmer'] = () => confirmerLivraison();
CLICK_HANDLERS['restaurer-commande'] = (el) => restaurerCommande(el.getAttribute('data-id'));
CLICK_HANDLERS['commande-bl'] = (el) => prepareCommandeBLExport(el.getAttribute('data-id'));

// ---------------------------------------------------------------------------
// Livraisons / BL
// ---------------------------------------------------------------------------
CLICK_HANDLERS['show-livraison-details'] = (el) => showLivraisonDetails(el.getAttribute('data-id'));
CLICK_HANDLERS['prepare-bl-export'] = (el) => showPrepareBLExportModal(el.getAttribute('data-id'));
CLICK_HANDLERS['delete-livraison'] = (el) => deleteLivraison(el.getAttribute('data-id'));
CLICK_HANDLERS['close-modal'] = () => modal.hide();
CLICK_HANDLERS['bl-caisse-step'] = (el) => {
    const input = document.getElementById(el.getAttribute('data-target'));
    if (!input) return;
    input.value = String(Math.max(0, (parseInt(input.value, 10) || 0) + (Number(el.getAttribute('data-delta')) || 0)));
};
CLICK_HANDLERS['bl-facturation-mode'] = (el) => setBLFacturationMode(el.getAttribute('data-mode'));
CLICK_HANDLERS['export-bl-excel'] = (el) => exportPreparedBL(el.getAttribute('data-id'), 'excel');
CLICK_HANDLERS['export-bl-pdf'] = (el) => exportPreparedBL(el.getAttribute('data-id'), 'pdf');

// ---------------------------------------------------------------------------
// Production
// ---------------------------------------------------------------------------
CLICK_HANDLERS['production-mode'] = (el) => setProductionMode(el.getAttribute('data-value'));
CLICK_HANDLERS['production-select'] = (el) => productionSelect(el.getAttribute('data-value'));
CLICK_HANDLERS['production-manual-reset'] = () => { productionManualQuantities = {}; productionVolumes = {}; renderProduction(); };
CLICK_HANDLERS['production-stats'] = () => showProductionStatsModal();
CLICK_HANDLERS['production-reveal'] = (el) => stockRevealSection(el.getAttribute('data-target'), true);
CLICK_HANDLERS['production-goto'] = (el) => { window.location.hash = el.getAttribute('data-href') || '#production'; };
CLICK_HANDLERS['production-produire'] = (el) => showProductionModal(el.getAttribute('data-brassin'),
    el.hasAttribute('data-index') ? Number(el.getAttribute('data-index')) : null);
CLICK_HANDLERS['production-valider'] = (el, e) => validerProduction(e);
CLICK_HANDLERS['production-annuler'] = (el) => annulerProduction(el.getAttribute('data-id'));

// ---------------------------------------------------------------------------
// Inventaire
// ---------------------------------------------------------------------------
CLICK_HANDLERS['update-inventaire-qty'] = (el) => updateInventaireQty(el.getAttribute('data-id'), Number(el.getAttribute('data-delta')));
CLICK_HANDLERS['show-inventaire-modal'] = (el) => showInventaireModal(el.getAttribute('data-type'), el.getAttribute('data-id'));
CLICK_HANDLERS['delete-inventaire-item'] = (el) => deleteInventaireItem(el.getAttribute('data-id'));
CLICK_HANDLERS['save-inventaire-item'] = (el, e) => saveInventaireItem(e, el.getAttribute('data-id') || '');
CLICK_HANDLERS['inventaire-prix'] = (el) => showInventairePrixModal(el.getAttribute('data-id'));
CLICK_HANDLERS['inventaire-prix-save'] = (el) => saveInventairePrix(el.getAttribute('data-id'));

CLICK_HANDLERS['inventaire-ajuster'] = (el) => ouvrirAjusterInventaire(el.getAttribute('data-id'));
CLICK_HANDLERS['inventaire-ajuster-mode'] = (el) => choisirModeAjusterInventaire(el.getAttribute('data-mode'));
CLICK_HANDLERS['inventaire-ajuster-save'] = (el) => saveAjusterInventaire(el.getAttribute('data-id'));
CLICK_HANDLERS['inventaire-lots'] = (el) => showInventaireLotsModal(el.getAttribute('data-id'));
CLICK_HANDLERS['inventaire-reception'] = (el) => showReceptionModal(el.getAttribute('data-id') || '', el.getAttribute('data-retour') || '');
CLICK_HANDLERS['inventaire-reception-save'] = (el) => saveReception(el.hasAttribute('data-suite'));
CLICK_HANDLERS['inventaire-lot-corriger'] = (el) => showCorrigerLotModal(el.getAttribute('data-id'), el.getAttribute('data-lot') || '');
CLICK_HANDLERS['inventaire-lot-corriger-save'] = (el) => saveCorrigerLot(el.getAttribute('data-id'), el.getAttribute('data-lot') || '');
CLICK_HANDLERS['inventaire-lot-retirer'] = (el) => retirerLotIngredient(el.getAttribute('data-id'), el.getAttribute('data-lot'));
CLICK_HANDLERS['inventaire-rappel-fournisseur'] = (el) => showRappelFournisseurModal(el.getAttribute('data-id'), el.getAttribute('data-lot'));
CLICK_HANDLERS['inventaire-copier-commande'] = () => copierListeACommander();
CLICK_HANDLERS['inventaire-seed'] = () => seedInventaireParDefaut();
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
CLICK_HANDLERS['show-client-details'] = (el) => showClientDetails(el.getAttribute('data-id'));
CLICK_HANDLERS['client-new-commande'] = (el) => { modal.hide(); showCommandeModal(null, { clientId: el.getAttribute('data-id') }); };
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
    // Un menu « ⋯ » ouvert dans la page disparaît avec elle
    if (RowMenuPortail.menu && el?.contains(RowMenuPortail.menu)) fermerRowMenuPortail();
    if (el) el.innerHTML = html;
};

// En-tête de page (v12.8) : le titre est celui de la barre du haut (#pageTitle) ;
// la page n'affiche qu'une barre d'outils — à gauche des onglets ou un sélecteur
// de mode, à droite ses actions (l'action principale en dernier).
const pageToolbar = (actionsHtml = '', leadHtml = '') => (actionsHtml || leadHtml) ? `
    <div class="page-toolbar">
        ${leadHtml ? `<div class="page-toolbar-lead">${leadHtml}</div>` : ''}
        ${actionsHtml ? `<div class="page-toolbar-actions">${actionsHtml}</div>` : ''}
    </div>` : '';

const ROW_MENU_ICON ='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';

// Menu « ⋯ » d'une ligne : actions secondaires, dont les suppressions (v12.8).
// `label` (texte brut) nomme la ligne pour les lecteurs d'écran.
const rowMenuHtml = (label, itemsHtml) => `
    <details class="row-menu">
        <summary class="btn btn-sm btn-secondary row-menu-btn" aria-label="${escapeHtml(`Autres actions : ${label}`)}">${ROW_MENU_ICON}</summary>
        <div class="row-menu-list">${itemsHtml}</div>
    </details>`;

// Menus « ⋯ » : un seul ouvert à la fois, fermé par un clic ailleurs, par Échap
// ou après le choix d'une action. Pendant l'ouverture, la liste est sortie dans
// <body> en position fixe (v13.6) : un tableau défilant, une carte arrondie ou une
// fenêtre ne peut plus la rogner ; elle s'ouvre vers le bas ou vers le haut selon
// la place et reste dans l'écran (au-dessus de la barre d'onglets mobile).
const RowMenuPortail = { menu: null, liste: null, repere: null, pointeur: 0 };

const fermerRowMenuPortail = () => {
    const { liste, repere } = RowMenuPortail;
    if (liste) {
        liste.classList.remove('is-portal');
        ['top', 'left', 'max-height'].forEach(p => liste.style.removeProperty(p));
        if (repere?.isConnected) repere.replaceWith(liste);
        else liste.remove();
    } else {
        repere?.remove();
    }
    RowMenuPortail.menu = RowMenuPortail.liste = RowMenuPortail.repere = null;
};

const placerRowMenuPortail = () => {
    const { menu, liste } = RowMenuPortail;
    if (!menu || !liste) return;
    if (!menu.isConnected || !menu.open) {
        fermerRowMenuPortail();
        return;
    }
    const bouton = menu.querySelector('summary').getBoundingClientRect();
    const largeur = document.documentElement.clientWidth;
    const nav = document.querySelector('.bottom-nav');
    const navHaut = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().top : window.innerHeight;
    const bas = Math.min(window.innerHeight, navHaut);
    const marge = 8;
    liste.style.maxHeight = `${Math.max(120, bas - 2 * marge)}px`;
    const h = liste.offsetHeight;
    const w = liste.offsetWidth;
    const dessous = bas - bouton.bottom - marge;
    const dessus = bouton.top - marge;
    let top = (h + 4 <= dessous || dessous >= dessus) ? bouton.bottom + 4 : bouton.top - 4 - h;
    top = Math.min(Math.max(marge, top), bas - h - marge);
    // Alignée sur le bord droit du bouton, ou sur son bord gauche si elle déborderait à gauche
    const gauche = bouton.right - w >= marge ? bouton.right - w : bouton.left;
    const left = Math.min(Math.max(marge, gauche), largeur - w - marge);
    liste.style.top = `${Math.round(top)}px`;
    liste.style.left = `${Math.round(left)}px`;
};

const ouvrirRowMenuPortail = (menu) => {
    fermerRowMenuPortail();
    const liste = menu.querySelector(':scope > .row-menu-list');
    if (!liste) return;
    const repere = document.createComment('row-menu');
    liste.replaceWith(repere);
    liste.classList.add('is-portal');
    document.body.appendChild(liste);
    Object.assign(RowMenuPortail, { menu, liste, repere });
    placerRowMenuPortail();
    // Ouvert au clavier : le focus passe sur la première action
    if (Date.now() - RowMenuPortail.pointeur > 600) liste.querySelector('button')?.focus();
};

const initRowMenus = () => {
    if (window.__rowMenusReady) return;
    window.__rowMenusReady = true;
    document.addEventListener('pointerdown', () => { RowMenuPortail.pointeur = Date.now(); }, true);
    document.addEventListener('click', (e) => {
        if (RowMenuPortail.menu && !RowMenuPortail.menu.isConnected) fermerRowMenuPortail();
        const inside = e.target.closest?.('.row-menu');
        const choix = e.target.closest?.('.row-menu-list button');
        document.querySelectorAll('.row-menu[open]').forEach(menu => {
            if (menu !== inside || choix) menu.removeAttribute('open');
        });
    });
    document.addEventListener('keydown', (e) => {
        const ouvert = RowMenuPortail.menu?.isConnected ? RowMenuPortail.menu : document.querySelector('.row-menu[open]');
        if (!ouvert) return;
        const resume = ouvert.querySelector('summary');
        if (e.key === 'Escape') {
            ouvert.removeAttribute('open');
            resume?.focus();
            return;
        }
        const liste = RowMenuPortail.liste;
        if (!liste || !liste.contains(document.activeElement)) return;
        const boutons = [...liste.querySelectorAll('button')];
        const i = boutons.indexOf(document.activeElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            boutons[(i + (e.key === 'ArrowDown' ? 1 : boutons.length - 1)) % boutons.length]?.focus();
        } else if (e.key === 'Tab') {
            // La liste est hors de la page : Tab reprend l'ordre normal depuis le bouton « ⋯ »
            ouvert.removeAttribute('open');
            resume?.focus();
        }
    });
    // « toggle » ne remonte pas, d'où la capture
    document.addEventListener('toggle', (e) => {
        const menu = e.target;
        if (!menu.classList?.contains('row-menu')) return;
        if (menu.open) ouvrirRowMenuPortail(menu);
        else if (RowMenuPortail.menu === menu) fermerRowMenuPortail();
    }, true);
    window.addEventListener('scroll', placerRowMenuPortail, true);
    window.addEventListener('resize', placerRowMenuPortail);
};

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
        DB.setFilter('stockCell', '');
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
    const btn = event.target.closest?.('button') || event.target;
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
        if (RowMenuPortail.menu && document.getElementById('modalContainer')?.contains(RowMenuPortail.menu)) fermerRowMenuPortail();
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
        // Fiches de consultation (traçabilité, commande) : focus sur la fermeture, pas sur un lien du contenu
        const fiche = bodyEl?.querySelector('.trace-sheet');
        const target = fiche ? document.getElementById('modalClose') : (bodyFocusables[0] || footerFocusables[0] || document.getElementById('modalClose'));
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
    const morePages = ['dashboard', 'pointage', 'livraisons', 'inventaire', 'comptabilite', 'parametres'];
    if (morePages.includes(page)) {
        document.getElementById('moreNavBtn')?.classList.add('active');
    }

    const titles = {
        jumeau: 'Jumeau numérique',
        dashboard: 'Tableau de bord',
        stock: 'Stock',
        pointage: 'Pointage',
        commandes: 'Commandes',
        livraisons: 'Livraisons',
        archives: 'Archives',
        production: 'Production',
        historique: 'Historique',
        inventaire: 'Inventaire',
        comptabilite: 'Comptabilité',
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
        comptabilite: renderComptabilite,
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
const renderCurrentView = router;

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
    { page: 'comptabilite', label: 'Comptabilité — journal, bilan, créances', keys: 'G F' },
    { page: 'archives', label: 'Archives des commandes', keys: 'G A' },
    { page: 'parametres', label: 'Paramètres', keys: 'G R' }
];
const GOTO_KEYS = { j: 'jumeau', d: 'dashboard', c: 'commandes', p: 'production', s: 'stock', l: 'livraisons', h: 'pointage', i: 'inventaire', f: 'comptabilite', a: 'archives', r: 'parametres' };
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
        { label: 'Saisir des heures de travail', run: () => showPointageJourModal() },
        { label: 'Importer des heures depuis Excel', run: () => ouvrirImportPointages() },
        { label: 'Nouvelle écriture comptable', run: () => { gotoPage('comptabilite'); setTimeout(() => showComptaEcritureModal(), 80); }, hidden: !comptaExerciceCourant() },
        { label: 'Importer la comptabilité depuis Excel', run: () => ouvrirImportCompta() },
        { label: 'Exporter la comptabilité en Excel', run: () => exporterComptaExcel(null), hidden: !comptaExerciceCourant() },
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
            if (twinCloseQualityMenu()) { e.preventDefault(); return; }
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
