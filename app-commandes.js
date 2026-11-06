let weekCalendarSelectedDate = '';
let _commandeModalClientOptions = [];

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
        // Bouteilles offertes (en plus de la commande) : tracées, jamais facturées
        const ligneTotal = (priceUsed != null && !item.offert) ? priceUsed * (item.quantite || 0) : 0;
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
    // Le titre de la barre du haut suit le mode (commandes actives ou archives)
    const titleEl = document.getElementById('pageTitle');
    if (titleEl) titleEl.textContent = showArchives ? 'Archives' : 'Commandes';

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
                return `${i.quantite}× ${a?.nom || '?'} ${f?.nom || '?'}${libelleEnPlus(i)}`;
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
        ${pageToolbar(`
            <button type="button" class="btn btn-secondary" onclick="toggleArchives()" title="${showArchives ? 'Voir commandes actives' : 'Voir archives'}">
                ${showArchives ? '← Actives' : 'Archives'}
            </button>
            ${showArchives
                ? `<button type="button" class="btn btn-secondary" onclick="exportArchivesExcel(false)" title="Exporter Excel">📤 Excel</button>`
                : `<button type="button" class="btn btn-secondary" onclick="checkStockAndUpdateCommandes()" title="Marquer produites les commandes en attente réalisables avec le stock libre (hors bouteilles réservées aux commandes déjà produites)">✓ Stock</button>
                   <button type="button" class="btn btn-primary" onclick="showCommandeModal()">+ Créer</button>`}
        `)}

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
        <form id="commandeForm" data-record-id="${escapeHtml(commande?.id || generateId())}">
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

const saveCommande = async (event, id) => {
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

        const dateLivraison = formData.get('dateLivraison');
        if (!dateLivraison || Number.isNaN(new Date(dateLivraison).getTime())) {
            showToast('Date de livraison invalide', 'error');
            return;
        }
        if (!id) requireNumberingConnection();

        if (clientId === '__ponctuel__') {
            const nom = String(formData.get('ponctuelNom') || '').trim();
            if (!nom) {
                showToast('Veuillez saisir le nom du client ponctuel', 'error');
                return;
            }
            // actif: false → n'apparaît pas dans les prochaines commandes ni les filtres
            const nouveauClient = {
                id: form.dataset.ponctuelClientId || generateId(),
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
            form.dataset.ponctuelClientId = nouveauClient.id;
            const clientsDb = DB.get('clients');
            const clientIndex = clientsDb.findIndex(client => client.id === nouveauClient.id);
            if (clientIndex === -1) clientsDb.push(nouveauClient);
            else clientsDb[clientIndex] = nouveauClient;
            if (!DB.set('clients', clientsDb)) return;
            clientId = nouveauClient.id;
        }

        const recordId = id || form.dataset.recordId || generateId();
        form.dataset.recordId = recordId;
        const commande = {
            ...(commandeExistante || {}),
            id: recordId,
            ...(id ? { numero: commandeExistante.numero } : {}),
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
            if (!DB.set('commandes', commandes)) return;
        } else {
            if (!form._numberingAttempt) form._numberingAttempt = v11Clone(commande);
            const created = await createNumberedRecord('commandes', commande);
            if (!created) return;
            if (created.statut === 'livrée') {
                modal.hide();
                showToast('Cette commande a déjà été livrée sur un autre appareil et ne peut plus être modifiée.', 'warning');
                renderCommandes();
                return;
            }
            const updated = v11MergeRecord(form._numberingAttempt, commande, created).record;
            if (!v11Equal(created, updated)) {
                const current = DB.get('commandes');
                const index = current.findIndex(record => record.id === created.id);
                if (index === -1) return;
                current[index] = updated;
                if (!DB.set('commandes', current)) return;
            }
        }
        if (commande.statut === 'annulee') {
            deleteBLForCommande(commande.id);
        }

        modal.hide();
        showToast('Commande enregistrée');
        renderCurrentView();
    } catch (e) {
        console.error('Error saving commande:', e);
        showToast(id ? 'Erreur lors de l\'enregistrement de la commande' : (e.message || 'Création de la commande impossible.'), 'error');
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

// Avant de passer « produite », la règle d'attribution vérifie que les bouteilles
// libres (vendables à la date de livraison, assez longues pour le client) suffisent
const marquerCommandeProduite = async (id) => {
    const { plan } = planAttributionCommandes(new Date(), { forceProduite: id });
    const p = plan.get(id);
    const manques = (p?.lignes || []).filter(l => l.manque > 0);
    if (manques.length > 0) {
        const detail = manques.map(l => `${l.manque} bt ${l.arome.nom} ${l.format.nom}`).join(', ');
        const ok = await confirmDialog(
            `Pour #${getCommandeNumero(p.commande)} · ${p.client ? getClientLabel(p.client) : 'client inconnu'}, il manque ${detail} (bouteilles libres${p.minJours ? ` et assez longues pour ce client, ${p.minJours} j minimum` : ''}). La marquer produite quand même ?`,
            { title: 'Stock insuffisant', confirmLabel: 'Marquer quand même' }
        );
        if (!ok) return;
    }
    // updateCommandeStatut relit les commandes : rien n'est gardé d'avant la confirmation
    if (updateCommandeStatut(id, 'produite')) {
        modal.hide();
        showToast('Commande marquée comme produite');
    }
};

const restaurerCommande = (id) => {
    const cmdAffichee = (DB.get('commandes') || []).find(c => c.id === id);
    if (!cmdAffichee) { showToast('Commande non trouvée', 'error'); return; }

    const statutConfirme = cmdAffichee.statut;
    const estLivree = statutConfirme === 'livrée';
    const estAnnulee = statutConfirme === 'annulee';
    if (!estLivree && !estAnnulee) { showToast('Cette commande ne peut pas être restaurée', 'error'); return; }

    const message = estLivree
        ? 'Restaurer cette commande ? Le stock sera restitué (bouteilles re-créditées aux lots), le bulletin de livraison sera supprimé, et la commande repassera en statut « produite ».'
        : 'Restaurer cette commande ? Elle repassera en statut « en attente ».';

    confirmDialog(message, { danger: false }).then(ok => {
        if (!ok) return;

        // Relecture APRÈS la confirmation : DB.set réécrit la table entière, et un
        // autre appareil a pu créer ou modifier des commandes pendant la boîte.
        const commandes = DB.get('commandes') || [];
        const cmd = commandes.find(c => c.id === id);
        if (!cmd || cmd.statut !== statutConfirme) {
            showToast('La commande a changé entre-temps : restauration annulée. Rouvrez-la pour vérifier son état.', 'warning');
            return;
        }

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
            // Les bouteilles livrées en plus reviennent au stock avec le reste :
            // la commande retrouve ses seules quantités commandées
            cmd.items = getItems(cmd).filter(i => !i.enPlus);
            delete cmd.dateLivraisonEffective;
            delete cmd.clientLivraison;
            delete cmd.numeroBL;
            cmd.blGenerationId = generateId();
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
// options (v13.0) : extras [{ aromeId, formatId, quantite, offert }] — bouteilles
// livrées en plus de la commande, incluses dans les allocations ; partielle —
// autorise à livrer moins que commandé, le reste devient un reliquat « en attente »
// (reliquatId, reliquatNumero) écrit dans la même transaction.
// Renvoie { lotsUtilises, reliquat }.
const deliverCommandeTransaction = async (commandeId, allocations, options = {}) => {
    const { extras = [], partielle = false, reliquatId = null, reliquatNumero = null } = options;
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

    // Bouteilles en plus par article (comptées dans les allocations)
    const extrasAgg = new Map();  // itemKey → { quantite, offert }
    for (const x of extras) {
        const q = Number(x.quantite);
        if (!Number.isInteger(q) || q <= 0) throw new Error('Quantité de bouteilles en plus invalide. Livraison annulée.');
        const k = `${x.aromeId}|${x.formatId}`;
        const prev = extrasAgg.get(k);
        extrasAgg.set(k, { quantite: (prev?.quantite || 0) + q, offert: !!x.offert });
    }
    if (partielle && !reliquatId) throw new Error('Identifiant de reliquat manquant. Livraison annulée.');

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

        // Vérifier chaque article alloué : la part « commandée » (alloué − en plus)
        // ne dépasse jamais la commande distante ; un article hors commande n'est
        // livrable qu'en bouteilles en plus déclarées
        for (const [itemKey, allocatedQty] of itemAgg) {
            const remoteQty = remoteItemsMap.get(itemKey);
            const extraQty = extrasAgg.get(itemKey)?.quantite || 0;
            if (remoteQty === undefined && !extraQty) {
                throw new Error(
                    `L'article (${itemKey}) a été retiré de la commande distante. Livraison annulée.`
                );
            }
            const base = allocatedQty - extraQty;
            if (base < 0 || base > (remoteQty || 0)) {
                throw new Error(
                    `Quantité allouée incorrecte pour l'article (${itemKey}) : ` +
                    `alloué ${allocatedQty} dont ${extraQty} en plus, requis ${remoteQty || 0} d'après la commande distante. ` +
                    'Livraison annulée.'
                );
            }
        }
        for (const itemKey of extrasAgg.keys()) {
            if (!itemAgg.has(itemKey)) throw new Error(`Bouteilles en plus sans lot alloué (${itemKey}). Livraison annulée.`);
        }
        // Vérifier qu'aucun article distant n'est oublié (sauf livraison partielle)
        const baseLivree = new Map();
        for (const [itemKey, remoteQty] of remoteItemsMap) {
            const base = (itemAgg.get(itemKey) || 0) - (extrasAgg.get(itemKey)?.quantite || 0);
            baseLivree.set(itemKey, base);
            if (base !== remoteQty && !partielle) {
                throw new Error(
                    `L'article (${itemKey}) est absent ou mal alloué dans cette livraison ` +
                    `(alloué ${base}, requis ${remoteQty} d'après la commande distante). ` +
                    'Livraison annulée.'
                );
            }
        }

        // Lignes livrées (part commandée, puis bouteilles en plus) et reliquat
        const itemsLivres = [];
        const itemsReliquat = [];
        const resteBase = new Map(baseLivree);
        remoteItems.forEach(item => {
            const k = `${item.aromeId}|${item.formatId}`;
            const q = Number(item.quantite) || 0;
            const livre = Math.min(q, Math.max(0, resteBase.get(k) || 0));
            resteBase.set(k, (resteBase.get(k) || 0) - livre);
            if (livre > 0) itemsLivres.push({ ...item, quantite: livre });
            if (q - livre > 0) itemsReliquat.push({ ...item, quantite: q - livre });
        });
        extrasAgg.forEach((x, k) => {
            const [aromeId, formatId] = k.split('|');
            itemsLivres.push({ aromeId, formatId, quantite: x.quantite, enPlus: true, ...(x.offert ? { offert: true } : {}) });
        });
        if (itemsLivres.length === 0) throw new Error('Aucune bouteille à livrer. Livraison annulée.');

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
            items: itemsLivres,
            statut: 'livrée',
            lotsUtilises,
            dateLivraisonEffective: now
        };
        // Livraison partielle : le reste devient une commande « en attente » liée
        let reliquat = null;
        if (itemsReliquat.length > 0) {
            reliquat = { ...commande, id: reliquatId, numero: reliquatNumero || `${getCommandeNumero(commande)}-2`, statut: 'en_attente', items: itemsReliquat, reliquatDe: commandeId };
            ['lotsUtilises', 'dateLivraisonEffective', 'clientLivraison', 'numeroBL', 'blGenerationId', 'reliquatId'].forEach(f => delete reliquat[f]);
            updatedCommande.reliquatId = reliquatId;
            transaction.set(v11GetRecordRef('commandes', reliquatId), {
                record: reliquat,
                updatedAt: now,
                _version: txVersion
            });
        }
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
            reliquat,
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
    } else {
        allCommandes.push(result.updatedCommande);
    }
    if (result.reliquat) {
        const reliquatIdx = allCommandes.findIndex(c => c.id === result.reliquat.id);
        if (reliquatIdx === -1) allCommandes.push(result.reliquat);
        else allCommandes[reliquatIdx] = result.reliquat;
    }
    DB._applyRemoteSnapshot('commandes', allCommandes);

    // Met à jour les versions commande
    if (!V11._versions['commandes']) V11._versions['commandes'] = {};
    V11._versions['commandes'][commandeId] = txVersion;
    v11SetBase('commandes', commandeId, result.updatedCommande);
    if (result.reliquat) {
        V11._versions['commandes'][result.reliquat.id] = txVersion;
        v11SetBase('commandes', result.reliquat.id, result.reliquat);
    }

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
        // Base de fusion alignée sur l'état réellement écrit
        const rec = allLots.find(l => String(l.id) === String(info.lotId)) || null;
        v11SetBase('lots', info.lotId, rec);
    }
    v11SaveVersions();

    return { lotsUtilises: result.lotsUtilises, reliquat: result.reliquat };
};

// --- Livraison d'une commande (v13.0) ---
// Les lots sont pré-remplis selon la règle d'attribution : DLV la plus proche
// d'abord, parmi les lots vendables aujourd'hui, assez longs pour le client et non
// prévus pour d'autres commandes (planAttributionCommandes). Tout reste modifiable.
// Livraison partielle : ce qui manque devient un reliquat « en attente ». Bouteilles
// en plus (menus ⋯) : sur une ligne ou un article hors commande, facturées ou offertes.
let livraisonState = null;

// Lots vendables aujourd'hui pour un arôme × format (normalisés), DLV la plus
// proche d'abord, avec la part prévue pour d'autres commandes
const livraisonLotsPour = (key, minJours, autresParLot, today) => {
    const limiteMin = today.getTime() + minJours * 86400000;
    return (DB.get('lots') || [])
        .filter(l => stockCellKey(l.arome, l.format) === key && Number(l.quantite) > 0 && isLotSellable(l, today))
        .sort(stockFefo)
        .map(lot => {
            const autres = autresParLot.get(lot.id) || [];
            const reserveAutres = autres.reduce((s, r) => s + r.quantite, 0);
            return {
                lot,
                max: Number(lot.quantite),
                libre: Math.max(0, Number(lot.quantite) - reserveAutres),
                autres,
                tropCourt: minJours > 0 && stockSaleLimit(lot) < limiteMin
            };
        });
};

// Répartit `cible` bouteilles sur les lots d'une ligne, DLV la plus proche
// d'abord, sans toucher aux bouteilles prévues pour d'autres commandes
const remplirLigneLivraison = (ligne, cible) => {
    let reste = Math.max(0, cible);
    ligne.lots.forEach(l => {
        const pris = l.tropCourt ? 0 : Math.min(l.libre, reste);
        ligne.qte[l.lot.id] = pris;
        reste -= pris;
    });
};

const livraisonTotalLigne = (ligne) => ligne.lots.reduce((s, l) => s + (ligne.qte[l.lot.id] || 0), 0);

// État d'une ligne : alloué, livré au titre de la commande, en plus, reliquat
const livraisonEtatLigne = (ligne) => {
    const alloue = livraisonTotalLigne(ligne);
    const base = Math.min(alloue, ligne.commande);
    const enPlus = Math.max(0, alloue - ligne.commande);
    return { alloue, base, enPlus, reliquat: ligne.commande - base, depasse: enPlus > 0 && !ligne.enPlusOuvert };
};

const livraisonStatutLigneHtml = (ligne) => {
    const e = livraisonEtatLigne(ligne);
    if (e.depasse) return `<span class="liv-statut is-danger">${e.alloue} / ${ligne.commande} · dépasse la commande</span>`;
    if (ligne.horsCommande) return `<span class="liv-statut is-plus">${e.enPlus} en plus</span>`;
    if (e.enPlus > 0) return `<span class="liv-statut is-plus">${e.alloue} / ${ligne.commande} · ${e.enPlus} en plus</span>`;
    if (e.reliquat > 0) return `<span class="liv-statut is-warning">${e.alloue} / ${ligne.commande} · ${e.reliquat} en reliquat</span>`;
    return `<span class="liv-statut is-ok">${e.alloue} / ${ligne.commande} ✓</span>`;
};

const livraisonLigneHtml = (ligne) => {
    const e = livraisonEtatLigne(ligne);
    const today = dateOnly(new Date()).getTime();
    const jours = (lot) => {
        const t = stockSaleLimit(lot);
        return Number.isFinite(t) ? Math.round((t - today) / 86400000) : null;
    };
    const lotsHtml = ligne.lots.map(l => {
        const j = jours(l.lot);
        const dlv = l.lot.dlv || l.lot.dlc;
        const info = `${twinFmtInt(l.max)} bt${dlv ? ` · DLV ${formatDate(dlv)}` : ''}${j !== null ? ` (${j} j)` : ''}`;
        if (l.tropCourt) {
            return `<li class="liv-lot is-off">
                <span class="liv-lot-num">#${escapeHtml(formatLotNumero(getLotNumero(l.lot)))}</span>
                <span class="liv-lot-info">${escapeHtml(info)} · trop court pour ce client (min ${livraisonState.minJours} j)</span>
            </li>`;
        }
        const autres = l.autres.length
            ? `<span class="liv-lot-autres">prévu pour ${l.autres.map(r => `#${escapeHtml(getCommandeNumero(r.commande))} (${r.quantite} bt, ${escapeHtml(stockLivraisonLabel(r.commande.dateLivraison))})`).join(', ')}</span>`
            : '';
        return `<li class="liv-lot">
            <span class="liv-lot-num">#${escapeHtml(formatLotNumero(getLotNumero(l.lot)))}</span>
            <span class="liv-lot-info">${escapeHtml(info)}${autres}</span>
            <input type="number" class="liv-lot-qte" min="0" max="${safeNumAttr(l.max)}" step="1" inputmode="numeric"
                   value="${safeNumAttr(ligne.qte[l.lot.id] || 0)}" data-ligne="${escapeHtml(ligne.id)}" data-lot="${escapeHtml(l.lot.id)}"
                   aria-label="${escapeHtml(`Bouteilles du lot ${formatLotNumero(getLotNumero(l.lot))}`)}" oninput="majLivraisonQte(this)">
        </li>`;
    }).join('');
    const enPlusHtml = (ligne.enPlusOuvert || ligne.horsCommande) ? `
        <div class="liv-en-plus">
            <label for="livPlus-${escapeHtml(ligne.id)}">${ligne.horsCommande ? 'Bouteilles livrées' : 'Bouteilles en plus'}</label>
            <input type="number" id="livPlus-${escapeHtml(ligne.id)}" min="0" step="1" inputmode="numeric" value="${e.enPlus || ''}"
                   data-ligne="${escapeHtml(ligne.id)}" oninput="majLivraisonEnPlus(this)">
            <label class="liv-offert"><input type="checkbox" ${ligne.offert ? 'checked' : ''} data-ligne="${escapeHtml(ligne.id)}" onchange="majLivraisonOffert(this)"> offertes</label>
        </div>` : '';
    const menu = ligne.horsCommande
        ? rowMenuHtml(`${ligne.aromeNom} ${ligne.formatNom}`, `<button type="button" class="is-danger" data-click="livraison-retirer-ligne" data-ligne="${escapeHtml(ligne.id)}">Retirer cet article</button>`)
        : (ligne.enPlusOuvert ? '' : rowMenuHtml(`${ligne.aromeNom} ${ligne.formatNom}`, `<button type="button" data-click="livraison-en-plus" data-ligne="${escapeHtml(ligne.id)}">Ajouter des bouteilles en plus</button>`));
    return `<section class="liv-ligne" data-ligne="${escapeHtml(ligne.id)}">
        <div class="liv-ligne-head">
            <span class="liv-ligne-nom">${escapeHtml(`${ligne.aromeNom} ${ligne.formatNom}`)}${ligne.horsCommande ? ' <span class="stock-tag">hors commande</span>' : ''}</span>
            <span class="liv-ligne-statut" id="livStatut-${escapeHtml(ligne.id)}">${livraisonStatutLigneHtml(ligne)}</span>
            ${menu}
        </div>
        ${ligne.lots.length ? `<ul class="liv-lots">${lotsHtml}</ul>` : '<p class="liv-vide">Aucun lot vendable pour cet article.</p>'}
        ${enPlusHtml}
    </section>`;
};

// Pied de fenêtre : récapitulatif et libellé du bouton
const majPiedLivraison = () => {
    if (!livraisonState) return;
    let alloue = 0, reliquat = 0, enPlus = 0, offertes = 0, depasse = false;
    livraisonState.lignes.forEach(l => {
        const e = livraisonEtatLigne(l);
        alloue += e.alloue;
        reliquat += e.reliquat;
        enPlus += e.enPlus;
        if (l.offert) offertes += e.enPlus;
        depasse = depasse || e.depasse;
    });
    const recap = document.getElementById('livRecap');
    if (recap) {
        recap.textContent = [
            `${alloue} bt à livrer`,
            enPlus ? `dont ${enPlus} en plus${offertes ? ` (${offertes} offerte${offertes > 1 ? 's' : ''})` : ''}` : '',
            reliquat ? `reliquat de ${reliquat} bt` : ''
        ].filter(Boolean).join(' · ');
    }
    const note = document.getElementById('livReliquatNote');
    if (note) {
        note.hidden = !(reliquat > 0 && alloue > 0);
        note.textContent = `Il manque ${reliquat} bt : les bouteilles prêtes partent maintenant et un reliquat ${livraisonState.reliquatNumero} de ${reliquat} bt reste « en attente » (même client, même date).`;
    }
    const btn = document.getElementById('confirm-livraison-btn');
    if (btn && !btn.disabled) btn.textContent = depasse ? 'Livrer' : reliquat > 0 && alloue > 0 ? `Livrer ${alloue} bt · reliquat de ${reliquat}` : `Livrer ${alloue} bt`;
};

const majLigneLivraisonDom = (ligne, { valeursLots = true, champEnPlus = true } = {}) => {
    const statut = document.getElementById(`livStatut-${ligne.id}`);
    if (statut) statut.innerHTML = livraisonStatutLigneHtml(ligne);
    if (valeursLots) {
        document.querySelectorAll(`.liv-lot-qte[data-ligne="${ligne.id}"]`).forEach(inp => {
            inp.value = ligne.qte[inp.dataset.lot] || 0;
        });
    }
    if (champEnPlus) {
        const plus = document.getElementById(`livPlus-${ligne.id}`);
        if (plus) plus.value = livraisonEtatLigne(ligne).enPlus || '';
    }
    majPiedLivraison();
};

const livraisonLigne = (id) => livraisonState?.lignes.find(l => l.id === id);

const majLivraisonQte = (input) => {
    const ligne = livraisonLigne(input.dataset.ligne);
    if (!ligne) return;
    const v = parseInt(input.value, 10);
    ligne.qte[input.dataset.lot] = Number.isFinite(v) && v > 0 ? v : 0;
    majLigneLivraisonDom(ligne, { valeursLots: false });
};

const majLivraisonEnPlus = (input) => {
    const ligne = livraisonLigne(input.dataset.ligne);
    if (!ligne) return;
    const n = Math.max(0, parseInt(input.value, 10) || 0);
    remplirLigneLivraison(ligne, ligne.commande + n);
    majLigneLivraisonDom(ligne, { champEnPlus: false });
};

const majLivraisonOffert = (input) => {
    const ligne = livraisonLigne(input.dataset.ligne);
    if (!ligne) return;
    ligne.offert = input.checked;
    majPiedLivraison();
};

const rerenderLigneLivraison = (ligne) => {
    const el = document.querySelector(`.liv-ligne[data-ligne="${ligne.id}"]`);
    if (el) el.outerHTML = livraisonLigneHtml(ligne);
    majPiedLivraison();
};

const ouvrirEnPlusLivraison = (id) => {
    const ligne = livraisonLigne(id);
    if (!ligne) return;
    ligne.enPlusOuvert = true;
    rerenderLigneLivraison(ligne);
    document.getElementById(`livPlus-${ligne.id}`)?.focus();
};

// Articles hors commande proposables : arôme × format avec des bouteilles libres
// (vendables aujourd'hui, assez longues pour le client), absents des lignes
const livraisonArticlesHorsCommande = () => {
    const aromes = DB.get('aromes') || [];
    const formats = DB.get('formats') || [];
    const today = dateOnly(new Date());
    const dejaLa = new Set(livraisonState.lignes.map(l => l.key));
    const parCle = new Map();
    aromes.forEach(a => formats.forEach(f => {
        const key = stockCellKey(a.nom, f.nom);
        if (dejaLa.has(key) || parCle.has(key)) return;
        const lots = livraisonLotsPour(key, livraisonState.minJours, livraisonState.autresParLot, today).filter(l => !l.tropCourt);
        const libre = lots.reduce((s, l) => s + l.libre, 0);
        if (libre > 0) parCle.set(key, { key, arome: a, format: f, libre });
    }));
    return [...parCle.values()].sort((x, y) => `${x.arome.nom} ${x.format.nom}`.localeCompare(`${y.arome.nom} ${y.format.nom}`, 'fr'));
};

const montrerHorsCommandeLivraison = () => {
    const bloc = document.getElementById('livHorsCommande');
    if (!bloc || !livraisonState) return;
    const options = livraisonArticlesHorsCommande();
    bloc.hidden = false;
    bloc.innerHTML = options.length === 0
        ? '<p class="liv-vide">Aucun autre article n\'a de bouteilles libres.</p>'
        : `<label for="livHorsSelect">Article hors commande</label>
           <div class="liv-hors-row">
               <select id="livHorsSelect">${options.map(o => `<option value="${escapeHtml(o.key)}">${escapeHtml(`${o.arome.nom} ${o.format.nom} — ${o.libre} bt libres`)}</option>`).join('')}</select>
               <button type="button" class="btn btn-secondary" data-click="livraison-hors-commande-ajouter">Ajouter</button>
           </div>`;
    document.getElementById('livHorsSelect')?.focus();
};

const ajouterHorsCommandeLivraison = () => {
    const key = document.getElementById('livHorsSelect')?.value;
    const choix = livraisonArticlesHorsCommande().find(o => o.key === key);
    if (!choix) return;
    const ligne = {
        id: `h${Date.now()}`,
        key,
        aromeId: choix.arome.id,
        formatId: choix.format.id,
        aromeNom: choix.arome.nom,
        formatNom: choix.format.nom,
        commande: 0,
        horsCommande: true,
        enPlusOuvert: true,
        offert: false,
        lots: livraisonLotsPour(key, livraisonState.minJours, livraisonState.autresParLot, dateOnly(new Date())),
        qte: {}
    };
    livraisonState.lignes.push(ligne);
    const bloc = document.getElementById('livHorsCommande');
    if (bloc) {
        bloc.hidden = true;
        bloc.innerHTML = '';
    }
    document.getElementById('livLignes')?.insertAdjacentHTML('beforeend', livraisonLigneHtml(ligne));
    majPiedLivraison();
    document.getElementById(`livPlus-${ligne.id}`)?.focus();
};

const retirerLigneLivraison = (id) => {
    if (!livraisonState) return;
    livraisonState.lignes = livraisonState.lignes.filter(l => l.id !== id || !l.horsCommande);
    document.querySelector(`.liv-ligne[data-ligne="${id}"]`)?.remove();
    majPiedLivraison();
};

// Numéro du reliquat : « 00048-2 », puis « -3 »… (parseInt l'ignore pour la
// numérotation des commandes)
const prochainNumeroReliquat = (numero) => {
    const base = String(numero || '').split('-')[0];
    let max = 1;
    (DB.get('commandes') || []).forEach(c => {
        const [b, suffixe] = String(c.numero || '').split('-');
        if (b === base && /^\d+$/.test(suffixe || '')) max = Math.max(max, parseInt(suffixe, 10));
    });
    return `${base}-${max + 1}`;
};

const showLivraisonBouteillesModal = (commandeId) => {
    const commandes = DB.get('commandes') || [];
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
    const clientName = client ? getClientLabel(client) : 'Client inconnu';
    const minJours = clientDureeVieMin(client);
    const today = dateOnly(new Date());

    // Bouteilles prévues pour les AUTRES commandes (règle d'attribution commune)
    const { parLot } = planAttributionCommandes(today);
    const autresParLot = new Map();
    parLot.forEach((liste, lotId) => {
        const autres = liste.filter(r => r.commande.id !== commandeId);
        if (autres.length) autresParLot.set(lotId, autres);
    });

    // Une ligne par arôme × format commandé (quantités cumulées)
    const parCle = new Map();
    getItems(cmd).forEach(item => {
        if (item.enPlus) return;
        const itemKey = `${item.aromeId}|${item.formatId}`;
        const arome = aromes.find(a => a.id === item.aromeId);
        const format = resolveCommandeFormat(item, formats)?.format;
        if (!parCle.has(itemKey)) {
            parCle.set(itemKey, {
                id: `l${parCle.size}`,
                aromeId: item.aromeId,
                formatId: item.formatId,
                aromeNom: arome?.nom || '?',
                formatNom: format?.nom || '?',
                key: stockCellKey(arome?.nom || '', format?.nom || ''),
                commande: 0,
                horsCommande: false,
                enPlusOuvert: false,
                offert: false,
                lots: [],
                qte: {}
            });
        }
        parCle.get(itemKey).commande += Number(item.quantite) || 0;
    });
    const lignes = [...parCle.values()];
    lignes.forEach(l => {
        l.lots = livraisonLotsPour(l.key, minJours, autresParLot, today);
        remplirLigneLivraison(l, l.commande);
    });

    livraisonState = { commandeId, minJours, autresParLot, lignes, reliquatNumero: `#${prochainNumeroReliquat(getCommandeNumero(cmd))}` };

    modal.show(`Livrer #${getCommandeNumero(cmd)} · ${clientName}`, `
        <div class="liv-modal">
            <p class="text-muted liv-intro">Livraison prévue ${escapeHtml(formatDate(cmd.dateLivraison))}${minJours ? ` · durée de vie minimale du client : ${minJours} j` : ''}</p>
            <div id="livLignes">${lignes.map(livraisonLigneHtml).join('')}</div>
            <div id="livHorsCommande" class="liv-hors" hidden></div>
            <p id="livReliquatNote" class="trace-alert" hidden></p>
        </div>
    `, `
        ${rowMenuHtml('livraison', '<button type="button" data-click="livraison-hors-commande">Ajouter un article hors commande</button>')}
        <span id="livRecap" class="liv-recap"></span>
        <button class="btn btn-secondary" data-click="close-modal">Annuler</button>
        <button class="btn btn-success" id="confirm-livraison-btn" data-click="livraison-confirmer">Livrer</button>
    `, 'large');
    majPiedLivraison();
};

const confirmerLivraison = async () => {
    const state = livraisonState;
    if (!state) return;
    const btn = document.getElementById('confirm-livraison-btn');
    if (btn?.disabled) return;

    const allocations = [];
    const extras = [];
    let total = 0;
    let partielle = false;
    for (const ligne of state.lignes) {
        const e = livraisonEtatLigne(ligne);
        if (e.depasse) {
            showToast(`${ligne.aromeNom} ${ligne.formatNom} : ${e.alloue} bt pour ${ligne.commande} commandées. Pour livrer plus, passez par ⋯ → « Ajouter des bouteilles en plus ».`, 'error');
            return;
        }
        for (const l of ligne.lots) {
            const q = ligne.qte[l.lot.id] || 0;
            if (!q) continue;
            if (!Number.isInteger(q) || q < 0 || q > l.max || l.tropCourt) {
                showToast(`Quantité invalide sur le lot #${formatLotNumero(getLotNumero(l.lot))}`, 'error');
                return;
            }
            allocations.push({
                lotId: l.lot.id,
                quantite: q,
                itemKey: `${ligne.aromeId}|${ligne.formatId}`,
                expectedArome: ligne.aromeNom,
                expectedFormat: ligne.formatNom
            });
        }
        if (e.enPlus > 0) extras.push({ aromeId: ligne.aromeId, formatId: ligne.formatId, quantite: e.enPlus, offert: !!ligne.offert });
        if (e.reliquat > 0) partielle = true;
        total += e.alloue;
    }
    if (total === 0) {
        showToast('Aucune bouteille à livrer : saisissez au moins une quantité', 'error');
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Livraison en cours…';
    }
    try {
        const commande = (DB.get('commandes') || []).find(c => c.id === state.commandeId);
        const options = { extras, partielle };
        if (partielle) {
            options.reliquatId = generateId();
            options.reliquatNumero = prochainNumeroReliquat(getCommandeNumero(commande || {}));
        }
        // UNE transaction Firestore multi-documents atomique
        const resultat = await deliverCommandeTransaction(state.commandeId, allocations, options);
        livraisonState = null;
        modal.hide();
        showToast(`Commande livrée : ${total} bt, stock déduit`);
        if (resultat?.reliquat) {
            showToast(`Reliquat #${resultat.reliquat.numero} créé : ${getItems(resultat.reliquat).reduce((s, i) => s + (Number(i.quantite) || 0), 0)} bt en attente`, 'warning');
        }
        renderCurrentView();
        confirmDialog('Générer un bulletin de livraison maintenant ?').then(ok => {
            if (!ok) return;
            prepareCommandeBLExport(state.commandeId);
        });
    } catch (e) {
        console.error('Échec de la transaction de livraison :', e);
        const isNetworkError = e && (
            e.code === 'unavailable' ||
            e.code === 'deadline-exceeded' ||
            /firestore.*(network|unavailable|timeout)/i.test(e.message || '') ||
            /ERR_NETWORK|ERR_CONNECTION|fetch/i.test(e.message || '')
        );
        const isAuthError = e && (e.code === 'permission-denied' || e.code === 'unauthenticated');
        const isConcurrencyError = e && (e.code === 'aborted' || e.code === 'failed-precondition');
        if (isAuthError) {
            showToast('Session expirée ou refusée par le serveur. Reconnectez-vous puis réessayez la livraison. Aucun stock n\'a été déduit.', 'error');
        } else if (isConcurrencyError) {
            showToast('La commande ou les lots ont été modifiés sur un autre appareil. Rechargez la page et réessayez. Aucun stock n\'a été déduit.', 'error');
        } else if (isNetworkError) {
            showToast('Erreur réseau : la transaction n\'a pas pu aboutir. Vérifiez votre connexion et réessayez. Aucun stock n\'a été déduit.', 'error');
        } else {
            showToast(e.message || 'Erreur lors de la livraison. Aucune modification effectuée.', 'error');
        }
        if (btn) {
            btn.disabled = false;
            majPiedLivraison();
        }
    }
};

const checkStockAndUpdateCommandes = () => {
    const commandes = DB.get('commandes') || [];
    const lots = DB.get('lots') || [];
    const formats = DB.get('formats') || [];
    const aromes = DB.get('aromes') || [];
    const clients = DB.get('clients') || [];
    const now = new Date();
    // Même rapprochement que la règle d'attribution : noms normalisés, durée de
    // vie minimale du client, bouteilles « en plus » ignorées
    const stockPool = createStockPool(lots, now, lot => stockCellKey(lot.arome, lot.format));
    const minJoursDe = (cmd) => clientDureeVieMin(clients.find(c => c.id === cmd.clientId));
    let updatedCount = 0;

    const commandesTriees = sortCommandesByDateLivraison(commandes);
    const updatedCommandes = [...commandes];

    // Bouteilles nécessaires par arôme-format ; null si une quantité est invalide
    const besoinsDe = (cmd) => {
        const needed = {};
        for (const item of getItems(cmd)) {
            if (item.enPlus) continue;
            const quantite = Number(item.quantite);
            if (!Number.isInteger(quantite) || quantite <= 0) return null;
            const format = resolveCommandeFormat(item, formats)?.format;
            const arome = aromes.find(a => a.id === item.aromeId);
            const key = stockCellKey(arome?.nom || item.aromeId, format?.nom || item.formatId);
            needed[key] = (needed[key] || 0) + quantite;
        }
        return needed;
    };

    // Les commandes déjà « produites » ne sont pas encore livrées : leurs bouteilles
    // sont toujours dans les lots et leur sont réservées en priorité.
    commandesTriees.forEach(({ commande: cmd }) => {
        if (cmd.statut !== 'produite') return;
        Object.entries(besoinsDe(cmd) || {}).forEach(([key, qty]) => {
            stockPool.take(key, qty, cmd.dateLivraison, minJoursDe(cmd));
        });
    });

    commandesTriees.forEach(({ commande: cmd, index }) => {
        if (cmd.statut !== 'en_attente' || getItems(cmd).length === 0) return;
        const needed = besoinsDe(cmd);
        if (!needed) return;
        const minJours = minJoursDe(cmd);
        const canProduce = Object.entries(needed).every(([key, qty]) => stockPool.available(key, cmd.dateLivraison, minJours) >= qty);
        if (!canProduce) return;
        Object.entries(needed).forEach(([key, qty]) => {
            stockPool.take(key, qty, cmd.dateLivraison, minJours);
        });
        updatedCount++;
        updatedCommandes[index] = { ...cmd, statut: 'produite' };
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

// Badge d'état de la commande (en retard si la livraison prévue est passée)
const commandeStatusBadge = (commande) => {
    const enRetard = (commande.statut === 'en_attente' || commande.statut === 'produite')
        && (twinDaysUntil(commande.dateLivraison) ?? 0) < 0;
    if (enRetard) return '<span class="trace-status trace-status--danger">En retard</span>';
    const cls = { en_attente: 'warning', produite: 'info', livrée: 'success' }[commande.statut] || 'neutral';
    return `<span class="trace-status trace-status--${cls}">${escapeHtml(getCommandeStatutLabel(commande.statut))}</span>`;
};

// Étapes datées : commandée → produite → livrée (ou livraison prévue)
const commandeStepsHtml = (commande) => {
    if (commande.statut === 'annulee') return '<p class="trace-alert">Commande annulée : elle n\'est plus produite ni livrée. « Restaurer » la remet en attente.</p>';
    const rang = { en_attente: 0, produite: 1, livrée: 2 }[commande.statut] ?? 0;
    const jours = twinDaysUntil(commande.dateLivraison);
    const livraisonRel = jours === null ? ''
        : jours < 0 ? `en retard de ${twinFmtInt(-jours)} j`
        : jours === 0 ? "aujourd'hui" : jours === 1 ? 'demain' : `dans ${twinFmtInt(jours)} j`;
    const steps = [
        { label: 'Commandée', date: commande.dateCommande ? formatDate(commande.dateCommande) : '—', rel: '' },
        { label: 'Produite', date: rang === 2 ? 'Faite' : rang === 1 ? 'Prête à livrer' : 'À produire', rel: '' },
        rang === 2
            ? { label: 'Livrée', date: commande.dateLivraisonEffective ? formatJourTrace(commande.dateLivraisonEffective) : formatDate(commande.dateLivraison), rel: commande.numeroBL ? `BL ${commande.numeroBL}` : '' }
            : { label: 'Livraison prévue', date: commande.dateLivraison ? formatDate(commande.dateLivraison) : 'sans date', rel: livraisonRel, retard: jours !== null && jours < 0 }
    ];
    return `<ol class="cmd-steps">${steps.map((s, i) => {
        const etat = i < rang || rang === 2 ? 'done' : i === rang ? 'current' : 'todo';
        return `
            <li class="cmd-step cmd-step--${etat}">
                <span class="cmd-step-dot" aria-hidden="true">${etat === 'done' ? '✓' : i + 1}</span>
                <span class="cmd-step-label">${escapeHtml(s.label)}</span>
                <span class="cmd-step-date">${escapeHtml(s.date)}</span>
                ${s.rel ? `<span class="cmd-step-rel${s.retard ? ' is-danger' : ''}">${escapeHtml(s.rel)}</span>` : ''}
            </li>`;
    }).join('')}</ol>`;
};

const showCommandeDetails = (id) => {
    const commandes = DB.get('commandes') || [];
    const clients = DB.get('clients') || [];
    const aromes = DB.get('aromes') || [];
    const formats = DB.get('formats') || [];

    const commande = commandes.find(c => c.id === id);
    if (!commande) return;

    const client = clients.find(c => c.id === commande.clientId);
    const clientName = client ? (client.societe || client.nom) : (commande.clientLivraison?.societe || commande.clientLivraison?.nom || 'Client inconnu');
    const contact = client?.societe && client?.nom && client.nom !== client.societe ? client.nom : '';
    const items = getItems(commande);
    const montant = diagnoseCommandeMontant(commande, clients, formats);
    const ouverte = commande.statut === 'en_attente' || commande.statut === 'produite';

    // Couverture prévisionnelle par le stock (règle d'attribution v13.0), par ligne
    const couverture = new Map();
    if (ouverte) {
        const prevu = planAttributionCommandes().plan.get(id);
        const itemsPlan = prevu ? getItems(prevu.commande) : [];
        (prevu?.lignes || []).forEach(l => couverture.set(itemsPlan.indexOf(l.item), l));
    }
    const couvertureHtml = (idx) => {
        const l = couverture.get(idx);
        if (!l) return '';
        if (l.manque <= 0) return '<span class="cmd-line-cover is-ok">✓ Couvert par le stock</span>';
        const enStock = l.demande - l.manque;
        const texte = commande.statut === 'produite'
            ? `Stock insuffisant : manque ${twinFmtInt(l.manque)} bt`
            : `${enStock > 0 ? `${twinFmtInt(enStock)} bt en stock · ` : ''}${twinFmtInt(l.manque)} bt à produire`;
        return `<span class="cmd-line-cover${commande.statut === 'produite' ? ' is-danger' : ' is-todo'}">${escapeHtml(texte)}</span>`;
    };

    const lignesHtml = items.map((item, idx) => {
        const arome = aromes.find(a => a.id === item.aromeId);
        const format = resolveCommandeFormat(item, formats)?.format;
        const prix = montant.items[idx];
        const prixHtml = prix?.priceUsed > 0
            ? `<span class="cmd-line-price">${item.offert ? 'offert' : escapeHtml(formatChf(prix.ligneTotal))}</span>
               <span class="cmd-line-unit">${escapeHtml(`${twinFmtInt(item.quantite)} × ${formatChf(prix.priceUsed)}`)}</span>`
            : '';
        return `
            <li class="cmd-line">
                <span class="aroma-tile-dot" style="background:${safeColor(arome?.couleur)}"></span>
                <div class="cmd-line-main">
                    <div class="cmd-line-name">${escapeHtml(arome?.nom || '?')} <span class="stock-group-format">· ${escapeHtml(format?.nom || '?')}</span>${item.enPlus ? ` <span class="stock-tag">${item.offert ? 'en plus · offert' : 'en plus'}</span>` : ''}</div>
                    ${couvertureHtml(idx)}
                </div>
                <span class="cmd-line-qty">${item.enPlus ? '+' : ''}${escapeHtml(twinFmtInt(item.quantite))} bt</span>
                ${prixHtml ? `<div class="cmd-line-amount">${prixHtml}</div>` : ''}
            </li>`;
    }).join('');

    const totalBt = items.filter(i => !i.enPlus).reduce((s, i) => s + (Number(i.quantite) || 0), 0);
    const enPlusBt = items.filter(i => i.enPlus).reduce((s, i) => s + (Number(i.quantite) || 0), 0);
    const nbAromes = new Set(items.map(i => i.aromeId)).size;

    // Livraison partielle : liens entre la commande livrée et son reliquat
    const lienCommande = (cid, libelle) => {
        const c = commandes.find(x => x.id === cid);
        return c ? `<p class="trace-note cmd-link-note">${escapeHtml(libelle)} <button type="button" class="trace-journey-link" data-click="show-commande-details" data-id="${escapeHtml(c.id)}">#${escapeHtml(getCommandeNumero(c))}</button> (${escapeHtml(getCommandeStatutLabel(c.statut).toLowerCase())})</p>` : '';
    };

    const lotsHtml = (commande.lotsUtilises || []).length === 0 ? '' : `
        <section class="trace-section">
            <h4 class="trace-section-title">Lots livrés</h4>
            <ul class="cmd-lots">${commande.lotsUtilises.map(lot => {
                const arome = aromes.find(a => normalizeName(a.nom) === normalizeName(lot.arome));
                return `
                    <li>
                        <button type="button" class="cmd-lot" data-click="show-lot-trace" data-id="${escapeHtml(String(lot.lotId))}" aria-label="${escapeHtml(`Tracer le lot ${formatLotNumero(lot.numLot || lot.lotId)}`)}">
                            <span class="stock-lot-num">#${escapeHtml(formatLotNumero(lot.numLot || lot.lotId))}</span>
                            <span class="cmd-lot-name"><span class="aroma-tile-dot" style="background:${safeColor(arome?.couleur)}"></span>${escapeHtml(lot.arome || '?')} <span class="stock-group-format">· ${escapeHtml(lot.format || '?')}</span></span>
                            <span class="cmd-lot-dlv">${lot.dlv ? `DLV ${escapeHtml(formatDate(lot.dlv))}` : ''}</span>
                            <span class="cmd-line-qty">${escapeHtml(twinFmtInt(lot.quantite))} bt</span>
                            ${dashIcon('chevron')}
                        </button>
                    </li>`;
            }).join('')}</ul>
        </section>`;

    const initiales = !client && !commande.clientLivraison ? '?' : String(clientName).trim().split(/\s+/).slice(0, 2).map(m => m.charAt(0)).join('').toUpperCase() || '?';
    const modalBody = `
        <div class="trace-sheet">
            <div class="trace-hero">
                <span class="trace-hero-swatch cmd-hero-avatar" aria-hidden="true">${escapeHtml(initiales)}</span>
                <div class="trace-hero-text">
                    <div class="trace-hero-name">${client ? `<button type="button" class="client-name-link" data-click="show-client-details" data-id="${escapeHtml(client.id)}">${escapeHtml(clientName)}</button>` : escapeHtml(clientName)}</div>
                    <div class="trace-hero-sub">${escapeHtml([`Commande #${getCommandeNumero(commande)}`, contact].filter(Boolean).join(' · '))}</div>
                </div>
                ${commandeStatusBadge(commande)}
            </div>

            ${commandeStepsHtml(commande)}
            ${commande.reliquatDe ? lienCommande(commande.reliquatDe, 'Reliquat de la commande') : ''}
            ${commande.reliquatId ? lienCommande(commande.reliquatId, 'Livraison partielle : reliquat') : ''}

            <div class="trace-kpis cmd-kpis">
                <div class="trace-kpi"><span class="trace-kpi-value">${escapeHtml(`${twinFmtInt(totalBt)} bt`)}</span><span class="trace-kpi-label">${escapeHtml(enPlusBt > 0 ? `Bouteilles · +${twinFmtInt(enPlusBt)} en plus` : 'Bouteilles')}</span></div>
                <div class="trace-kpi"><span class="trace-kpi-value">${escapeHtml(twinFmtInt(nbAromes))}</span><span class="trace-kpi-label">${nbAromes > 1 ? 'Arômes' : 'Arôme'}</span></div>
                <div class="trace-kpi trace-kpi--stock"><span class="trace-kpi-value">${escapeHtml(montant.hasPrice ? formatChf(montant.total) : '—')}</span><span class="trace-kpi-label">${montant.hasPrice ? 'Montant' : 'Montant (tarif inconnu)'}</span></div>
            </div>

            <section class="trace-section">
                <h4 class="trace-section-title">Articles</h4>
                ${lignesHtml ? `<ul class="cmd-lines">${lignesHtml}</ul>` : '<p class="text-muted">Aucun article</p>'}
            </section>
            ${lotsHtml}
        </div>
    `;

    const btn = (cls, action, label) => `<button class="btn ${cls}" data-click="${action}" data-id="${escapeHtml(id)}">${label}</button>`;
    const annuler = `<button class="btn btn-ghost btn-ghost-danger modal-footer-start" data-click="confirm-annuler-commande" data-id="${escapeHtml(id)}">Annuler la commande</button>`;
    const fermer = '<button class="btn btn-secondary" onclick="modal.hide()">Fermer</button>';
    let actionsHtml = fermer;
    if (commande.statut === 'en_attente') {
        actionsHtml = annuler + btn('btn-secondary', 'duplicate-commande', 'Dupliquer') + btn('btn-secondary', 'edit-commande', 'Modifier')
            + btn('btn-success', 'marquer-commande-produite', 'Marquer produite');
    } else if (commande.statut === 'produite') {
        actionsHtml = annuler + btn('btn-secondary', 'duplicate-commande', 'Dupliquer') + btn('btn-secondary', 'edit-commande', 'Modifier')
            + btn('btn-success', 'livrer-commande', 'Livrer');
    } else if (commande.statut === 'livrée') {
        actionsHtml = btn('btn-ghost modal-footer-start', 'restaurer-commande', 'Restaurer') + btn('btn-secondary', 'duplicate-commande', 'Dupliquer')
            + fermer + btn('btn-primary', 'commande-bl', 'Bulletin de livraison');
    } else if (commande.statut === 'annulee') {
        actionsHtml = fermer + btn('btn-primary', 'restaurer-commande', 'Restaurer');
    }
    modal.show(`Commande #${getCommandeNumero(commande)}`, modalBody, actionsHtml);
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
    // Seules les quantités commandées sont reprises (pas les bouteilles livrées en plus)
    showCommandeModal(null, {
        clientId: original.clientId,
        items: getItems(original).filter(i => !i.enPlus).map(({ enPlus, offert, ...i }) => ({ ...i }))
    });
};

const toggleArchives = () => {
    const showArchives = localStorage.getItem('thecol_show_archives') === 'true';
    localStorage.setItem('thecol_show_archives', showArchives ? 'false' : 'true');
    renderCommandes();
};

const getArchivesFiltrees = (commandes, applyFilters = true) => {
    const filterYear = applyFilters ? DB.getFilter('archive_year') : '';
    const filterClient = applyFilters ? DB.getFilter('archive_client') : '';
    const filterStatut = applyFilters ? DB.getFilter('archive_statut') : '';
    return commandes.filter(c => {
        if (c.statut !== 'livrée' && c.statut !== 'annulee') return false;
        const year = c.dateCommande ? c.dateCommande.substring(0, 4) : '2024';
        return (!filterYear || year === filterYear)
            && (!filterClient || c.clientId === filterClient)
            && (!filterStatut || c.statut === filterStatut);
    }).sort((a, b) => new Date(b.dateCommande) - new Date(a.dateCommande));
};

const renderArchives = () => {
    const savedFilterYear = DB.getFilter('archive_year');
    const savedFilterClient = DB.getFilter('archive_client');
    const savedFilterStatut = DB.getFilter('archive_statut') || '';

    const commandes = getArchivesFiltrees(DB.get('commandes'), false);
    const clients = DB.get('clients') || [];
    const aromes = DB.get('aromes') || [];
    const formats = DB.get('formats') || [];

    const years = [...new Set(commandes.map(c => c.dateCommande ? c.dateCommande.substring(0, 4) : '2024'))].sort().reverse();

    const filteredCommandes = getArchivesFiltrees(commandes);

    let html = `
        ${pageToolbar(`
            <button type="button" class="btn btn-secondary" onclick="exportArchivesExcel()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Exporter Excel
            </button>`)}
        <div class="card">

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
                                    return escapeHtml(`${i.quantite}x ${a?.nom || '?'} ${f?.nom || '?'}${libelleEnPlus(i)}`);
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

const exportArchivesExcel = (applyFilters = true) => {
    const commandes = getArchivesFiltrees(DB.get('commandes'), applyFilters);
    const clients = DB.get('clients');
    const aromes = DB.get('aromes');
    const formats = DB.get('formats');

    const data = commandes.map(cmd => {
        const client = clients.find(c => c.id === cmd.clientId);
        const items = getItems(cmd).map(item => {
            const a = aromes.find(a => a.id === item.aromeId);
            const f = formats.find(f => f.id === item.formatId);
            return `${item.quantite}x ${a?.nom || '?'} ${f?.nom || '?'}${libelleEnPlus(item)}`;
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
