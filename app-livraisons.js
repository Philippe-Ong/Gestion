const getBLNumero = (livraison) => {
    return livraison.numeroBL || livraison.id.slice(-5);
};

// Local-only timestamps for BL Excel exports. v11.7 : un export local ne doit
// pas créer d'opération V11 ni déclencher de conflit Firestore, donc on stocke
// la date d'export dans une clé localStorage séparée (jamais synchronisée).
const BL_EXPORT_DATES_KEY = 'thecol_bl_export_dates';
const readBLExportDates = () => {
    try {
        const raw = localStorage.getItem(BL_EXPORT_DATES_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
        console.warn('[BL] Lecture des dates d\'export impossible :', e);
        return {};
    }
};
const writeBLExportDates = (map) => {
    try {
        localStorage.setItem(BL_EXPORT_DATES_KEY, JSON.stringify(map));
        return true;
    } catch (e) {
        console.warn('[BL] Écriture des dates d\'export impossible :', e);
        return false;
    }
};
const recordBLExportDate = (livraisonId) => {
    if (!livraisonId) return;
    const map = readBLExportDates();
    map[livraisonId] = new Date().toISOString();
    writeBLExportDates(map);
};
// Local-first : retourne la date stockée dans la clé dédiée, sinon retombe
// sur le champ historique `livraison.dateDernierExport` pour rétrocompatibilité.
const getBLLastExportDate = (livraison) => {
    if (!livraison) return null;
    const localMap = readBLExportDates();
    if (localMap && localMap[livraison.id]) return localMap[livraison.id];
    return livraison.dateDernierExport || null;
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
            ...(l.lignes || []).map(line => `${line.aromeNom || ''} ${line.formatNom || ''}`),
            ...((l.lotsTraces && l.lotsTraces.length > 0) ? l.lotsTraces : buildLotsTracesForCommande(commande))
                .map(t => `lot ${formatLotNumero(t.numLot || t.lotId)}`)
        ].join(' ').toLowerCase();
        const matchesYear = !savedFilterYear || year === savedFilterYear;
        const matchesClient = !savedFilterClient || l.clientId === savedFilterClient;
        const matchesSearch = !savedSearch || searchText.includes(savedSearch.toLowerCase().trim());
        return matchesYear && matchesClient && matchesSearch;
    });

    let html = `
        <div class="card">
            <div class="filters">
                <input type="search" id="filterLivraisonSearch" placeholder="Rechercher BL, client, commande, n° de lot..." value="${escapeHtml(savedSearch)}" aria-label="Rechercher un bulletin de livraison" data-live-search="livraison_search">
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
                        const lastExportRaw = getBLLastExportDate(liv);
                        const lastExport = lastExportRaw ? formatDateTime(lastExportRaw) : 'Jamais exporté';

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
                                <button class="btn btn-sm btn-primary" data-click="prepare-bl-export" data-id="${escapeHtml(liv.id)}">Préparer / Exporter</button>
                                <button class="btn btn-sm btn-secondary" data-click="show-livraison-details" data-id="${escapeHtml(liv.id)}">Détails</button>
                                ${rowMenuHtml(`BL-${getBLNumero(liv)}`, `<button type="button" class="is-danger" data-click="delete-livraison" data-id="${escapeHtml(liv.id)}">Supprimer</button>`)}
                            </div>
                        </div>`;
                    }).join('')}
            </div>
        </div>
    `;

    safeRender(html);
};

// En-tête commun des fiches BL : client, n° de BL, commande liée, état de l'export
const blHeroHtml = (livraison, client, commande) => {
    const nom = client?.societe || client?.nom || commande?.clientLivraison?.societe || commande?.clientLivraison?.nom || 'Client inconnu';
    const initiales = client || commande?.clientLivraison
        ? String(nom).trim().split(/\s+/).slice(0, 2).map(m => m.charAt(0)).join('').toUpperCase()
        : '?';
    const exporte = getBLLastExportDate(livraison);
    const cmd = commande
        ? `<button type="button" class="trace-journey-link" data-click="show-commande-details" data-id="${escapeHtml(commande.id)}">commande #${escapeHtml(getCommandeNumero(commande))}</button>`
        : escapeHtml(`commande #${String(livraison.commandeId || '').slice(-5)}`);
    return `
        <div class="trace-hero">
            <span class="trace-hero-swatch cmd-hero-avatar" aria-hidden="true">${escapeHtml(initiales || '?')}</span>
            <div class="trace-hero-text">
                <div class="trace-hero-name">${escapeHtml(nom)}</div>
                <div class="trace-hero-sub">BL-${escapeHtml(String(getBLNumero(livraison)))} · ${cmd}</div>
            </div>
            ${exporte
                ? '<span class="trace-status trace-status--success">Exporté</span>'
                : '<span class="trace-status trace-status--warning">Jamais exporté</span>'}
        </div>`;
};

// Lots tracés d'un BL (interne, non imprimé) : liste cliquable vers la traçabilité du lot
const blLotsHtml = (lotsTraces, aromes) => `
    <ul class="cmd-lots">${lotsTraces.map(lot => {
        const arome = aromes.find(a => normalizeName(a.nom) === normalizeName(lot.arome));
        const limite = lot.dlv ? `DLV ${formatDate(lot.dlv)}` : lot.dlc ? `DLC ${formatDate(lot.dlc)}` : '';
        return `
            <li>
                <button type="button" class="cmd-lot" data-click="show-lot-trace" data-id="${escapeHtml(String(lot.lotId))}" aria-label="${escapeHtml(`Tracer le lot ${formatLotNumero(lot.numLot || lot.lotId)}`)}">
                    <span class="stock-lot-num">#${escapeHtml(formatLotNumero(lot.numLot || lot.lotId))}</span>
                    <span class="cmd-lot-name"><span class="aroma-tile-dot" style="background:${safeColor(arome?.couleur)}"></span>${escapeHtml(lot.arome || '?')} <span class="stock-group-format">· ${escapeHtml(lot.format || '?')}</span></span>
                    <span class="cmd-lot-dlv">${escapeHtml(limite)}</span>
                    <span class="cmd-line-qty">${escapeHtml(twinFmtInt(lot.quantite || 0))} bt</span>
                    ${dashIcon('chevron')}
                </button>
            </li>`;
    }).join('')}</ul>`;

// Alerte si la trace interne ne couvre pas exactement les bouteilles du BL
const blTraceAlertHtml = (totalItems, totalTrace, forcedCount) => [
    forcedCount > 0 ? `<p class="trace-alert">Alerte interne : ${escapeHtml(dashPlural(forcedCount, 'ligne'))} livrée(s) avec stock insuffisant confirmé.</p>` : '',
    totalTrace !== totalItems ? `<p class="trace-alert">${escapeHtml(`${twinFmtInt(totalTrace)} bt tracées pour ${twinFmtInt(totalItems)} bt sur le BL : vérifiez les lots de la livraison.`)}</p>` : ''
].join('');

const buildBLTraceSummary = (livraison, commande) => {
    const lotsTraces = livraison.lotsTraces?.length > 0
        ? livraison.lotsTraces
        : buildLotsTracesForCommande(commande);
    return {
        lotsTraces,
        totalItems: (livraison.lignes || []).reduce((sum, l) => sum + (Number(l.quantite) || 0), 0),
        totalTrace: lotsTraces.reduce((sum, lot) => sum + (Number(lot.quantite) || 0), 0),
        forcedCount: lotsTraces.filter(lot => lot.forceStockInsuffisant).length
    };
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
    const lignes = livraison.lignes || [];

    const lignesHtml = lignes.map(l => {
        const a = aromes.find(a => a.id === l.aromeId);
        const f = formats.find(f => f.id === l.formatId);
        return `
            <li class="cmd-line bl-line">
                <span class="aroma-tile-dot" style="background:${safeColor(a?.couleur)}"></span>
                <div class="cmd-line-main"><div class="cmd-line-name">${escapeHtml(a?.nom || l.aromeNom || '?')} <span class="stock-group-format">· ${escapeHtml(f?.nom || l.formatNom || '?')}</span></div></div>
                <span class="cmd-line-qty">${escapeHtml(twinFmtInt(l.quantite))} bt</span>
            </li>`;
    }).join('');

    const { lotsTraces, totalItems, totalTrace, forcedCount } = buildBLTraceSummary(livraison, commande);
    const caissesVertes = parseInt(livraison.caissesVertesLivrees, 10) || 0;
    const caissesNoires = parseInt(livraison.caissesNoiresLivrees, 10) || 0;
    const dernierExport = getBLLastExportDate(livraison);

    // Destinataire imprimé sur le BL (client actuel, sinon instantané pris à la livraison)
    const dest = client || commande?.clientLivraison || null;
    const destLignes = dest ? [
        dest.societe && dest.nom && dest.nom !== dest.societe ? dest.nom : '',
        dest.adresse,
        `${dest.npa || ''} ${dest.localite || ''}`.trim()
    ].filter(Boolean) : [];

    const kpi = (label, value, extra = '') => `<div class="trace-kpi${extra}"><span class="trace-kpi-value">${escapeHtml(value)}</span><span class="trace-kpi-label">${escapeHtml(label)}</span></div>`;

    modal.show(`BL-${getBLNumero(livraison)}`, `
        <div class="trace-sheet">
            ${blHeroHtml(livraison, client, commande)}

            <div class="trace-life">
                <div class="trace-dates">
                    <div class="trace-date"><span class="trace-date-label">Date du BL</span><span class="trace-date-value">${escapeHtml(livraison.dateBL ? formatDate(livraison.dateBL) : '—')}</span></div>
                    <div class="trace-date"><span class="trace-date-label">Livrée le</span><span class="trace-date-value">${escapeHtml(commande?.dateLivraisonEffective ? formatJourTrace(commande.dateLivraisonEffective) : '—')}</span></div>
                    <div class="trace-date"><span class="trace-date-label">Dernier export</span><span class="trace-date-value">${escapeHtml(dernierExport ? formatJourTrace(dernierExport) : 'Jamais')}</span>${dernierExport ? `<span class="trace-date-rel">${escapeHtml(new Date(dernierExport).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' }))}</span>` : ''}</div>
                </div>
            </div>

            <div class="trace-kpis bl-kpis">
                ${kpi('Bouteilles', `${twinFmtInt(totalItems)} bt`)}
                ${kpi('Caisses vertes', twinFmtInt(caissesVertes))}
                ${kpi('Caisses noires', twinFmtInt(caissesNoires))}
                ${kpi('Tracées', `${twinFmtInt(totalTrace)} bt`, totalTrace === totalItems ? ' trace-kpi--stock' : ' trace-kpi--warn')}
            </div>

            ${dest ? `
            <section class="trace-section">
                <h4 class="trace-section-title">Destinataire</h4>
                <div class="bl-dest">
                    <div class="rappel-client-name">${escapeHtml(dest.societe || dest.nom || '')}</div>
                    ${destLignes.map(l => `<div class="rappel-client-info">${escapeHtml(l)}</div>`).join('')}
                    ${dest.coord ? `<div class="rappel-client-info">${linkifyContact(dest.coord)}</div>` : ''}
                </div>
            </section>` : ''}

            <section class="trace-section">
                <h4 class="trace-section-title">Articles livrés</h4>
                ${lignesHtml ? `<ul class="cmd-lines">${lignesHtml}</ul>` : '<p class="text-muted">Aucun article</p>'}
            </section>

            ${livraison.notes ? `<p class="bl-notes"><strong>Notes internes</strong>${escapeHtml(livraison.notes)}</p>` : ''}

            <section class="trace-section">
                <h4 class="trace-section-title">Traçabilité interne</h4>
                ${blTraceAlertHtml(totalItems, totalTrace, forcedCount)}
                ${lotsTraces.length ? blLotsHtml(lotsTraces, aromes) : '<p class="text-muted">Aucune trace de lot enregistrée pour ce BL.</p>'}
            </section>
        </div>
    `, `
        <button class="btn btn-ghost btn-ghost-danger modal-footer-start" data-click="delete-livraison" data-id="${escapeHtml(id)}">Supprimer</button>
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

const getAromeBLName = (nom, aromes) => {
    if (!nom) return nom;
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
            dlv: lot.dlv || '',
            dlc: lot.dlc || '',
            quantite: lot.quantite || 0,
            forceStockInsuffisant: !!lot.forceStockInsuffisant
        }));
};

// Mémorise le n° de BL sur la commande : un BL supprimé puis régénéré garde son
// numéro, et ce numéro n'est jamais attribué à une autre commande.
const memoriserNumeroBLCommande = (commandes, commande, numeroBL) => {
    if (!numeroBL || commande.numeroBL === numeroBL) return;
    commande.numeroBL = numeroBL;
    DB.set('commandes', commandes);
};

const syncBLTraceFromCommande = (livraison, commande) => {
    const lotsTraces = buildLotsTracesForCommande(commande);
    return {
        ...livraison,
        lotsTraces: lotsTraces.length > 0 ? lotsTraces : (livraison.lotsTraces || [])
    };
};

const getOrCreateBL = async (commandeId) => {
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
        memoriserNumeroBLCommande(commandes, commande, updated.numeroBL);
        return updated;
    }

    return generateBL(commandeId);
};

const prepareCommandeBLExport = async (commandeId) => {
    try {
        const livraison = await getOrCreateBL(commandeId);
        if (!livraison) return;
        showPrepareBLExportModal(livraison.id);
    } catch (e) {
        console.error('Création du BL impossible :', e);
        showToast(e.message || 'Création du bulletin de livraison impossible.', 'error');
    }
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
    const aromes = DB.get('aromes') || [];
    const livraison = livraisons.find(l => l.id === livraisonId);
    if (!livraison) {
        showToast('Livraison non trouvée', 'error');
        return;
    }

    const commande = commandes.find(c => c.id === livraison.commandeId);
    const client = clients.find(c => c.id === livraison.clientId);
    const { lotsTraces, totalItems, totalTrace, forcedCount } = buildBLTraceSummary(livraison, commande);

    // Compteur de caisses IFCO avec boutons − / + (saisie directe toujours possible)
    const compteur = (id, label, valeur, couleur) => `
        <div class="bl-counter">
            <label for="${id}" class="bl-counter-label"><span class="bl-crate bl-crate--${couleur}" aria-hidden="true"></span>${escapeHtml(label)}</label>
            <div class="bl-counter-ctrl">
                <button type="button" class="btn btn-secondary bl-counter-btn" data-click="bl-caisse-step" data-target="${id}" data-delta="-1" aria-label="${escapeHtml(`${label} : une de moins`)}">−</button>
                <input type="number" id="${id}" min="0" step="1" inputmode="numeric" value="${safeNumAttr(valeur)}">
                <button type="button" class="btn btn-secondary bl-counter-btn" data-click="bl-caisse-step" data-target="${id}" data-delta="1" aria-label="${escapeHtml(`${label} : une de plus`)}">+</button>
            </div>
        </div>`;

    modal.show(`Préparer BL-${getBLNumero(livraison)}`, `
        <div class="trace-sheet">
            ${blHeroHtml(livraison, client, commande)}

            <section class="trace-section">
                <h4 class="trace-section-title">Caisses IFCO livrées</h4>
                <div class="bl-counters">
                    ${compteur('blCaissesVertes', 'Caisses vertes', parseInt(livraison.caissesVertesLivrees, 10) || 0, 'verte')}
                    ${compteur('blCaissesNoires', 'Caisses noires', parseInt(livraison.caissesNoiresLivrees, 10) || 0, 'noire')}
                </div>
            </section>

            <div class="form-group" style="margin: 0;">
                <label for="blNotesInternes">Notes internes</label>
                <textarea id="blNotesInternes" rows="3" placeholder="Non imprimées sur le BL client">${escapeHtml(livraison.notes || '')}</textarea>
            </div>

            <section class="trace-section">
                <h4 class="trace-section-title">Traçabilité interne <span class="trace-section-hint">${escapeHtml(`${twinFmtInt(totalTrace)} / ${twinFmtInt(totalItems)} bt tracées`)}</span></h4>
                ${blTraceAlertHtml(totalItems, totalTrace, forcedCount)}
                ${lotsTraces.length ? blLotsHtml(lotsTraces, aromes) : '<p class="text-muted">Aucun lot tracé pour cette livraison.</p>'}
            </section>
        </div>
    `, `
        <button class="btn btn-secondary" data-click="close-modal">Annuler</button>
        <button class="btn btn-secondary" data-click="export-bl-excel" data-id="${escapeHtml(livraisonId)}">Exporter Excel</button>
        <button class="btn btn-primary" data-click="export-bl-pdf" data-id="${escapeHtml(livraisonId)}">Exporter PDF</button>
    `, 'large');
};

const generateBL = async (commandeId) => {
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
            aromeNom: getAromeBLName(a?.nom, aromes) || item.aromeId,
            formatId: item.formatId,
            formatNom: f ? f.contenanceCl + ' cl' : item.formatId,
            quantite: item.quantite
        };
    });

    const livraison = {
        id: generateId(),
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

    return createNumberedRecord('livraisons', livraison);
};

const exportPreparedBL = (livraisonId, format) => {
    const saved = saveBLPreparation(livraisonId);
    if (!saved) return;
    modal.hide();
    if (format === 'pdf') {
        exportBLPDF(saved.id);
    } else {
        exportBLExcel(saved.id);
    }
};

// v11.12 : fonds de page du template BL (dataURL) mis en cache pour jsPDF.
const BL_PDF_ASSETS = {};
const loadBLTemplateAsset = (file) => {
    if (!BL_PDF_ASSETS[file]) {
        BL_PDF_ASSETS[file] = new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', 'icons/bl-template/' + file, true);
            xhr.responseType = 'blob';
            xhr.onload = () => {
                if (xhr.status !== 200) {
                    reject(new Error('Template introuvable : ' + file + ' (HTTP ' + xhr.status + ')'));
                    return;
                }
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('Lecture impossible : ' + file));
                reader.readAsDataURL(xhr.response);
            };
            xhr.onerror = () => reject(new Error('Chargement impossible : ' + file));
            xhr.send();
        }).catch(err => {
            // Échec non mis en cache : la prochaine tentative rechargera l'image.
            delete BL_PDF_ASSETS[file];
            throw err;
        });
    }
    return BL_PDF_ASSETS[file];
};

const prepareBLExport = (livraisonId) => {
    const livraison = DB.get('livraisons').find(l => l.id === livraisonId);
    if (!livraison) {
        showToast('Livraison non trouvée', 'error');
        return null;
    }

    const formats = DB.get('formats');
    const aromes = DB.get('aromes');
    const merged = new Map();
    let skippedCount = 0;
    for (const ligne of livraison.lignes || []) {
        const quantite = Number(ligne.quantite);
        if (!Number.isFinite(quantite) || quantite <= 0) continue;
        const format = formats.find(f => f.id === ligne.formatId);
        const formatNom = format ? `${format.contenanceCl} cl` : String(ligne.formatNom ?? '').trim();
        if (!formatNom) {
            skippedCount++;
            continue;
        }
        const aromeNom = getAromeBLName(ligne.aromeNom || '', aromes);
        const key = JSON.stringify([aromeNom, formatNom]);
        const item = merged.get(key);
        if (item) item.quantite += quantite;
        else merged.set(key, { aromeNom, formatNom, quantite });
    }

    if (skippedCount > 0) {
        showToast(`${skippedCount} article(s) ignoré(s) — libellé de format indisponible`, 'warning');
    }
    if (!merged.size) {
        if (skippedCount) {
            showToast('Aucune ligne exploitable pour générer le BL — tous les articles ont été ignorés (format manquant)', 'error');
        } else {
            showToast('Aucun article à livrer', 'warning');
        }
        return null;
    }

    const sortedItems = [...merged.values()].sort((a, b) => {
        const aN = a.aromeNom.toLowerCase();
        const bN = b.aromeNom.toLowerCase();
        if (aN < bN) return -1;
        if (aN > bN) return 1;
        return a.formatNom.localeCompare(b.formatNom);
    });
    const client = DB.get('clients').find(c => c.id === livraison.clientId);
    return {
        livraison, sortedItems,
        blNum: getBLNumero(livraison),
        blDate: livraison.dateBL || '',
        cVerte: parseInt(livraison.caissesVertesLivrees, 10) || 0,
        cNoire: parseInt(livraison.caissesNoiresLivrees, 10) || 0,
        clientSociete: client?.societe || '',
        clientContact: client?.nom || '',
        clientAdresse: client?.adresse || '',
        clientLocalite: `${client?.npa || ''} ${client?.localite || ''}`.trim()
    };
};

const downloadBLExport = (blob, filename, livraisonId, message) => {
    downloadBlob(blob, filename);
    recordBLExportDate(livraisonId);
    showToast(message);
    if (window.location.hash === '#livraisons') renderLivraisons();
};

const exportBLPDF = (livraisonId) => {
    try {
        const data = prepareBLExport(livraisonId);
        if (!data) return;
        const {
            livraison, sortedItems, blNum, blDate, cVerte, cNoire,
            clientSociete, clientContact, clientAdresse, clientLocalite
        } = data;

        const PER_PAGE = 18;
        const LAST_PAGE_MAX = 5;
        const buildPageChunks = (total) => {
            if (total <= LAST_PAGE_MAX) return [total];
            const chunks = [];
            let remaining = total;
            while (remaining > PER_PAGE) {
                chunks.push(PER_PAGE);
                remaining -= PER_PAGE;
            }
            if (remaining > LAST_PAGE_MAX) {
                chunks.push(remaining - LAST_PAGE_MAX);
                chunks.push(LAST_PAGE_MAX);
            } else if (remaining > 0) {
                chunks.push(remaining);
            }
            return chunks;
        };
        const pageChunks = buildPageChunks(sortedItems.length);
        const pageCount = pageChunks.length;

        if (!window.jspdf || !window.jspdf.jsPDF) {
            showToast('Bibliothèque PDF non chargée — vérifiez la connexion internet puis rechargez l\'app', 'error');
            return;
        }

        const recipientLines = [clientSociete, clientContact, clientAdresse, clientLocalite].filter(Boolean).slice(0, 4);
        const clientBottom = clientSociete || clientContact;
        const factMark = (mode) => (livraison.facturationMode === mode ? 'x' : '');

        // v11.12 : génération d'un vrai fichier .pdf via jsPDF. Fonds de page =
        // scans du template Excel ; données variables dessinées en vectoriel aux
        // mêmes cotes (mm) que le gabarit d'impression v11.11.
        Promise.all([
            loadBLTemplateAsset('page-full.png'),
            pageCount > 1 ? loadBLTemplateAsset('page-continuation.png') : Promise.resolve(null)
        ]).then(([fullPageImg, continuationImg]) => {
            const doc = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
            doc.setProperties({ title: 'Bulletin de Livraison ' + blNum });

            const PT_TO_MM = 25.4 / 72;
            const ROW_H = 5.29; // hauteur d'une ligne du tableau (mm)
            // Ligne de base PDF depuis un « top » CSS du gabarit : métriques Calibri
            // (ascent 0.75 em, interligne « normal » ≈ 1.226 em).
            const baselineFromTop = (topMm, sizePt, lineHeightMm) => {
                const fontMm = sizePt * PT_TO_MM;
                const lh = lineHeightMm || 1.226 * fontMm;
                return topMm + (lh - fontMm) / 2 + 0.75 * fontMm;
            };
            // maxWidth : réduit la taille de police pour tenir dans la colonne
            // (équivalent borné du « nowrap » du gabarit HTML).
            const drawText = (str, x, baselineY, sizePt, opts = {}) => {
                const text = String(str === null || str === undefined ? '' : str);
                if (!text.trim()) return;
                doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
                let size = sizePt;
                if (opts.maxWidth) {
                    doc.setFontSize(size);
                    const w = doc.getTextWidth(text);
                    if (w > opts.maxWidth) size = Math.max(6, size * opts.maxWidth / w);
                }
                doc.setFontSize(size);
                const g = opts.gray === undefined ? 31 : opts.gray; // #1f1f1f par défaut
                doc.setTextColor(g, g, g);
                doc.text(text, x, baselineY, { align: opts.align || 'left' });
            };

            let offset = 0;
            for (let p = 0; p < pageChunks.length; p++) {
                const isLastPage = p === pageChunks.length - 1;
                const pageNumber = p + 1;
                const chunk = sortedItems.slice(offset, offset + pageChunks[p]);
                offset += pageChunks[p];

                if (p > 0) doc.addPage();
                doc.addImage(isLastPage ? fullPageImg : continuationImg, 'PNG', 0, 0, 210, 297);

                drawText(blNum, 106.3, baselineFromTop(16, 10.5), 10.5, { bold: true, align: 'center' });
                drawText(blDate, 181.2, baselineFromTop(50.8, 11), 11, { align: 'right' });
                recipientLines.forEach((line, i) => {
                    drawText(line, 181.3, baselineFromTop(61.7 + i * ROW_H, 11, ROW_H), 11, { align: 'right' });
                });
                if (!isLastPage) {
                    drawText('Suite — page ' + pageNumber, 142, baselineFromTop(21, 6.375), 6.375, { align: 'center', gray: 102 });
                }
                drawText('Arôme', 86.1, baselineFromTop(97.3, 11, 4), 11);
                drawText('Format', 115.7, baselineFromTop(97.3, 11, 4), 11);
                chunk.forEach((it, i) => {
                    const y = baselineFromTop(101 + i * ROW_H, 11, ROW_H);
                    drawText(String(it.quantite), 31.97, y, 11, { bold: true, align: 'center' });
                    drawText('ThéCol - Thé Froid Artisanal', 39.53, y, 11, { maxWidth: 45.5 });
                    drawText(it.aromeNom || '', 87, y, 11, { maxWidth: 26 });
                    drawText(it.formatNom || '', 125.4, y, 11, { align: 'right', maxWidth: 12 });
                });
                if (isLastPage) {
                    drawText(String(cVerte || ''), 31.9, baselineFromTop(154.7, 7.875), 7.875, { bold: true, align: 'center' });
                    drawText(String(cNoire || ''), 31.9, baselineFromTop(160, 7.875), 7.875, { bold: true, align: 'center' });
                    drawText(factMark('email'), 119.5, baselineFromTop(149, 7.875), 7.875, { bold: true, align: 'center' });
                    drawText(factMark('poste'), 119.5, baselineFromTop(154.35, 7.875), 7.875, { bold: true, align: 'center' });
                    drawText(factMark('autre'), 119.5, baselineFromTop(159.7, 7.875), 7.875, { bold: true, align: 'center' });
                    drawText(clientBottom, 27, baselineFromTop(192.65, 16), 16);
                }
                if (pageCount > 1) {
                    // Pied de page : boîte de ligne calée à 3 mm du bord inférieur.
                    drawText('BL-' + blNum + ' · Page ' + pageNumber + ' / ' + pageCount, 105,
                        baselineFromTop(294 - 1.226 * 6.375 * PT_TO_MM, 6.375), 6.375, { align: 'center', gray: 119 });
                }
            }

            const blob = doc.output('blob');
            downloadBLExport(blob, `BL-${blNum}_${blDate}.pdf`, livraisonId, 'Bulletin de livraison exporté en PDF');
        }).catch(e => {
            console.error('exportBLPDF: échec de génération', e);
            showToast('Erreur lors de la génération du PDF', 'error');
        });
    } catch (e) {
        console.error('exportBLPDF: échec de génération', e);
        showToast('Erreur lors de la génération du PDF', 'error');
    }
};

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

const exportBLExcel = (livraisonId) => {
    const data = prepareBLExport(livraisonId);
    if (!data) return;
    const {
        livraison, sortedItems, blNum, blDate, cVerte, cNoire,
        clientSociete, clientContact, clientAdresse, clientLocalite
    } = data;

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
                        setCellTextDom(cellC2, `BL-${blNum}`);
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
                                setCellValueDom(cellA, cVerte);
                            } else if (rowNum === 49 + FO) {
                                setCellValueDom(cellA, cNoire);
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
                    downloadBLExport(blob, `BL-${blNum}_${blDate}.xlsx`, livraison.id, 'Bulletin de livraison exporté');
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
