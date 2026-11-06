// Settings
const renderParametres = () => {
    const employes = DB.get('employees') || [];
    const aromes = DB.get('aromes') || [];
    const formats = DB.get('formats') || [];
    const recettes = DB.get('recettes') || [];
    const clients = DB.get('clients') || [];
    const syncConflicts = v11GetQueue().filter(op => op.blockedReason);

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
                                ${e.actif ? '' : '<span class="badge badge-default">Inactif</span>'}
                            </div>
                            <div class="settings-item-actions">
                                 <button class="btn btn-sm btn-secondary" data-click="show-employe-modal" data-id="${escapeHtml(e.id)}">Modifier</button>
                                 ${rowMenuHtml(`${e.prenom || ''} ${e.nom || ''}`, `<button type="button" class="is-danger" data-click="delete-employe" data-id="${escapeHtml(e.id)}">Supprimer</button>`)}
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
                                ${a.actif ? '' : '<span class="badge badge-default">Inactif</span>'}
                            </div>
                            <div class="settings-item-actions">
                                 <button class="btn btn-sm btn-secondary" data-click="show-arome-modal" data-id="${escapeHtml(a.id)}">Modifier</button>
                                 ${rowMenuHtml(a.nom, `<button type="button" class="is-danger" data-click="delete-arome" data-id="${escapeHtml(a.id)}">Supprimer</button>`)}
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
                                <span class="text-muted">(${escapeHtml(f.contenanceCl)} cl)</span>
                                ${f.actif ? '' : '<span class="badge badge-default">Inactif</span>'}
                            </div>
                            <div class="settings-item-actions">
                                 <button class="btn btn-sm btn-secondary" data-click="show-format-modal" data-id="${escapeHtml(f.id)}">Modifier</button>
                                 ${rowMenuHtml(f.nom, `<button type="button" class="is-danger" data-click="delete-format" data-id="${escapeHtml(f.id)}">Supprimer</button>`)}
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
                          const ingredientCount = Array.isArray(r.ingredients) ? r.ingredients.length : 0;
                          return `
                            <li class="settings-item">
                                <div class="settings-item-info">
                                    <span class="color-dot" style="background: ${safeColor(arome?.couleur)}"></span>
                                    <span>${escapeHtml(r.nom)}</span>
                                    <span class="text-muted">(${ingredientCount} ingrédient${ingredientCount > 1 ? 's' : ''})</span>
                                </div>
                                <div class="settings-item-actions">
                                    <button class="btn btn-sm btn-secondary" data-click="show-recette-modal" data-id="${escapeHtml(r.id)}">Modifier</button>
                                    ${rowMenuHtml(r.nom, `<button type="button" class="is-danger" data-click="delete-recette" data-id="${escapeHtml(r.id)}">Supprimer</button>`)}
                                </div>
                            </li>
                          `;
                      }).join('')}
                </ul>
            </div>

            <div class="settings-card" style="grid-column: 1 / -1;">
                <div class="settings-card-header">
                    <h3>Clients</h3>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <input type="file" id="importClientsFile" accept=".xlsx,.xls" style="display:none" data-change="import-clients-excel">
                        <button class="btn btn-sm btn-primary" data-click="show-client-modal">+ Ajouter</button>
                        ${rowMenuHtml('tous les clients', `
                            <button type="button" data-click="export-clients-excel">Exporter Excel</button>
                            <button type="button" data-click="trigger-import-clients">Importer Excel</button>
                            <button type="button" class="is-danger" data-click="reset-clients">Effacer les clients sans commande</button>`)}
                    </div>
                </div>
                <ul class="settings-list">
                    ${clients.length === 0 ? '<li class="settings-item text-muted">Aucun client</li>' :
                      clients.map(c => `
                        <li class="settings-item">
                            <div class="settings-item-info">
                                <div><button type="button" class="client-name-link" data-click="show-client-details" data-id="${escapeHtml(c.id)}"><strong>${escapeHtml(c.societe || '')}</strong> ${escapeHtml(c.nom || '')}</button></div>
                                <div class="text-muted" style="font-size:12px;">${escapeHtml(c.adresse || '')} ${escapeHtml(c.npa || '')}</div>
                                ${c.actif ? '' : `<span class="badge badge-default">${c.ponctuel ? 'Ponctuel' : 'Inactif'}</span>`}
                            </div>
                            <div class="settings-item-actions">
                                <button class="btn btn-sm btn-secondary" data-click="show-client-details" data-id="${escapeHtml(c.id)}">Fiche</button>
                                ${rowMenuHtml(c.societe || c.nom || 'client', `
                                    <button type="button" data-click="show-client-modal" data-id="${escapeHtml(c.id)}">Modifier</button>
                                    <button type="button" class="is-danger" data-click="delete-client" data-id="${escapeHtml(c.id)}">Supprimer</button>`)}
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
                    <input type="file" id="importDataFile" accept=".json" style="display:none" onchange="importAllData(event)">
                </div>
                ${syncConflicts.length > 0 ? `<p class="text-warning" style="padding: 0 12px 12px;">${syncConflicts.length} modification(s) en conflit nécessitent une vérification. Sauvegardez-les avant toute intervention ; elles ne seront pas appliquées automatiquement.</p>` : ''}
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
            if (index === -1) {
                showToast('Cet employé a été supprimé sur un autre appareil', 'error');
                return;
            }
            // Conserver les champs que le formulaire n'affiche pas
            employes[index] = { ...employes[index], ...employe };
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
                    <input type="number" name="contenanceCl" value="${escapeHtml(safeNumAttr(format?.contenanceCl ?? 50))}" min="1" required>
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
            <button type="button" class="btn btn-sm btn-ghost btn-ghost-danger" onclick="this.parentElement.remove()" aria-label="Retirer cet ingrédient">×</button>
        </div>
    `).join('') : `<div class="ingredient-row"><input type="text" name="ingredients[0][nom]" placeholder="Ingrédient" list="${suggestionsId}" required><input type="number" name="ingredients[0][quantite]" placeholder="Qté" step="0.01" min="0.01" required><input type="text" name="ingredients[0][unite]" placeholder="Unité" required><button type="button" class="btn btn-sm btn-ghost btn-ghost-danger" onclick="this.parentElement.remove()" aria-label="Retirer cet ingrédient">×</button></div>`;

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
        <button type="button" class="btn btn-sm btn-ghost btn-ghost-danger" onclick="this.parentElement.remove()" aria-label="Retirer cet ingrédient">×</button>
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
const TARIF_CATEGORIE_LABELS = { custom: 'Personnalisé', distributeur: 'Distributeur', prive: 'Privé', restaurant: 'Restaurant' };

// Prix appliqué à un client pour une contenance : son prix, sinon celui de sa catégorie
const clientPrixEffectif = (client, key) => {
    const propre = parseFloat(String(client?.[key] || '').replace(',', '.'));
    if (propre > 0) return { prix: propre, source: 'client' };
    const preset = parseFloat(TARIF_PRESETS[normalizeTarifKey(client?.tarifs)]?.[key]);
    return preset > 0 ? { prix: preset, source: 'categorie' } : null;
};

// Ligne de commande cliquable (fiche client)
const clientCommandeRowHtml = (cmd) => {
    const bt = getItems(cmd).reduce((s, i) => s + (Number(i.quantite) || 0), 0);
    const date = cmd.statut === 'livrée' && cmd.dateLivraisonEffective ? formatJourTrace(cmd.dateLivraisonEffective) : (cmd.dateLivraison ? formatDate(cmd.dateLivraison) : 'sans date');
    const jours = twinDaysUntil(cmd.dateLivraison);
    const quand = cmd.statut === 'livrée' ? `livrée le ${date}`
        : cmd.statut === 'annulee' ? `prévue le ${date}`
        : jours === null ? 'sans date'
        : jours < 0 ? `livraison ${date} · en retard de ${twinFmtInt(-jours)} j`
        : `livraison ${date} · ${jours === 0 ? "aujourd'hui" : jours === 1 ? 'demain' : `dans ${twinFmtInt(jours)} j`}`;
    return `
        <li>
            <button type="button" class="cmd-lot client-cmd" data-click="show-commande-details" data-id="${escapeHtml(cmd.id)}">
                <span class="stock-lot-num">#${escapeHtml(getCommandeNumero(cmd))}</span>
                <span class="client-cmd-when">${escapeHtml(quand)}</span>
                ${commandeStatusBadge(cmd)}
                <span class="cmd-line-qty">${escapeHtml(twinFmtInt(bt))} bt</span>
                ${dashIcon('chevron')}
            </button>
        </li>`;
};

const showClientDetails = (id) => {
    const clients = DB.get('clients') || [];
    const client = clients.find(c => c.id === id);
    if (!client) {
        showToast('Client introuvable', 'error');
        return;
    }
    const formats = DB.get('formats') || [];
    const aromes = DB.get('aromes') || [];
    const commandes = (DB.get('commandes') || []).filter(c => c.clientId === id);
    const nom = client.societe || client.nom || 'Client sans nom';
    const contact = client.societe && client.nom && client.nom !== client.societe ? client.nom : '';
    const categorie = normalizeTarifKey(client.tarifs);
    const initiales = String(nom).trim().split(/\s+/).slice(0, 2).map(m => m.charAt(0)).join('').toUpperCase() || '?';

    const ouvertes = sortCommandesByDateLivraison(commandes.filter(c => c.statut === 'en_attente' || c.statut === 'produite'))
        .map(({ commande }) => commande);
    const dateLivree = (c) => c.dateLivraisonEffective || c.dateLivraison || '';
    const livrees = commandes.filter(c => c.statut === 'livrée')
        .sort((a, b) => (Date.parse(dateLivree(b)) || 0) - (Date.parse(dateLivree(a)) || 0));
    const annee = new Date().getFullYear();
    const livreesAnnee = livrees.filter(c => String(dateLivree(c)).slice(0, 4) === String(annee));
    const btDe = (c) => getItems(c).reduce((s, i) => s + (Number(i.quantite) || 0), 0);
    const btAnnee = livreesAnnee.reduce((s, c) => s + btDe(c), 0);
    const montants = livreesAnnee.map(c => getCommandeMontant(c, clients, formats)).filter(m => m !== null);
    const caAnnee = montants.length ? montants.reduce((s, m) => s + m, 0) : null;
    const derniere = livrees[0] ? dateLivree(livrees[0]) : '';
    const historique = commandes.filter(c => c.statut === 'livrée' || c.statut === 'annulee')
        .sort((a, b) => (Date.parse(dateLivree(b)) || 0) - (Date.parse(dateLivree(a)) || 0));

    // Arômes les plus livrés (toutes années)
    const parArome = new Map();
    livrees.forEach(c => getItems(c).forEach(i => parArome.set(i.aromeId, (parArome.get(i.aromeId) || 0) + (Number(i.quantite) || 0))));
    const topAromes = [...parArome.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxArome = topAromes[0]?.[1] || 1;

    const kpi = (label, value, extra = '') => `<div class="trace-kpi${extra}"><span class="trace-kpi-value">${escapeHtml(value)}</span><span class="trace-kpi-label">${escapeHtml(label)}</span></div>`;
    const prixHtml = [['prix25cl', '25 cl'], ['prix50cl', '50 cl'], ['prix100cl', '1 l']].map(([key, label]) => {
        const p = clientPrixEffectif(client, key);
        return `
            <div class="trace-date">
                <span class="trace-date-label">${escapeHtml(label)}</span>
                <span class="trace-date-value">${escapeHtml(p ? formatChf(p.prix) : '—')}</span>
                <span class="trace-date-rel">${escapeHtml(p ? (p.source === 'client' ? 'prix du client' : 'prix de la catégorie') : 'pas de prix')}</span>
            </div>`;
    }).join('');
    const duree = clientDureeVieMin(client);
    const badge = client.actif !== false
        ? '<span class="trace-status trace-status--success">Actif</span>'
        : `<span class="trace-status trace-status--neutral">${client.ponctuel ? 'Ponctuel' : 'Inactif'}</span>`;

    modal.show(nom, `
        <div class="trace-sheet">
            <div class="trace-hero">
                <span class="trace-hero-swatch cmd-hero-avatar" aria-hidden="true">${escapeHtml(initiales)}</span>
                <div class="trace-hero-text">
                    <div class="trace-hero-name">${escapeHtml(nom)}</div>
                    <div class="trace-hero-sub">${escapeHtml([contact, `Tarif ${TARIF_CATEGORIE_LABELS[categorie] || 'personnalisé'}`].filter(Boolean).join(' · '))}</div>
                </div>
                ${badge}
            </div>

            <div class="bl-dest">
                ${client.adresse || client.npa || client.localite
                    ? [client.adresse, `${client.npa || ''} ${client.localite || ''}`.trim()].filter(Boolean).map(l => `<div class="rappel-client-info">${escapeHtml(l)}</div>`).join('')
                    : '<div class="rappel-client-info text-muted">Pas d\'adresse enregistrée</div>'}
                <div class="rappel-client-info">${client.coord ? linkifyContact(client.coord) : '<span class="text-muted">Pas de coordonnées enregistrées</span>'}</div>
                ${client.modeFact ? `<div class="rappel-client-info">Facturation : ${escapeHtml(client.modeFact)}</div>` : ''}
            </div>

            <div class="trace-kpis bl-kpis">
                ${kpi('En cours', twinFmtInt(ouvertes.length))}
                ${kpi(`Livré en ${annee}`, `${twinFmtInt(btAnnee)} bt`)}
                ${kpi(`CA ${annee}`, caAnnee === null ? '—' : formatChf(caAnnee), ' trace-kpi--stock')}
                ${kpi('Dernière livraison', derniere ? formatJourTrace(derniere) : '—')}
            </div>

            <section class="trace-section">
                <h4 class="trace-section-title">Tarifs <span class="trace-section-hint">${escapeHtml(duree > 0 ? `DLV d'au moins ${twinFmtInt(duree)} j à la livraison` : 'aucune exigence de durée de vie')}</span></h4>
                <div class="trace-life"><div class="trace-dates">${prixHtml}</div></div>
            </section>

            <section class="trace-section">
                <h4 class="trace-section-title">Commandes en cours</h4>
                ${ouvertes.length ? `<ul class="cmd-lots">${ouvertes.map(clientCommandeRowHtml).join('')}</ul>` : '<p class="text-muted">Aucune commande en cours.</p>'}
            </section>

            ${topAromes.length ? `
            <section class="trace-section">
                <h4 class="trace-section-title">Arômes les plus livrés</h4>
                <ul class="client-aromes">${topAromes.map(([aromeId, n]) => {
                    const a = aromes.find(x => x.id === aromeId);
                    return `
                        <li>
                            <span class="client-arome-name"><span class="aroma-tile-dot" style="background:${safeColor(a?.couleur)}"></span>${escapeHtml(a?.nom || '?')}</span>
                            <span class="client-arome-bar"><span style="width:${safeNumAttr(Math.max(4, Math.round(n / maxArome * 100)))}%;background:${safeColor(a?.couleur)}"></span></span>
                            <span class="cmd-line-qty">${escapeHtml(twinFmtInt(n))} bt</span>
                        </li>`;
                }).join('')}</ul>
            </section>` : ''}

            ${historique.length ? `
            <section class="trace-section">
                <h4 class="trace-section-title">Historique <span class="trace-section-hint">${escapeHtml(historique.length > 6 ? `6 dernières sur ${twinFmtInt(historique.length)}` : dashPlural(historique.length, 'commande'))}</span></h4>
                <ul class="cmd-lots">${historique.slice(0, 6).map(clientCommandeRowHtml).join('')}</ul>
            </section>` : ''}
        </div>
    `, `
        ${commandes.length === 0 ? `<button class="btn btn-ghost btn-ghost-danger modal-footer-start" data-click="delete-client" data-id="${escapeHtml(id)}">Supprimer</button>` : ''}
        <button class="btn btn-secondary" data-click="show-client-modal" data-id="${escapeHtml(id)}">Modifier</button>
        ${client.actif !== false ? `<button class="btn btn-primary" data-click="client-new-commande" data-id="${escapeHtml(id)}">+ Commande</button>` : '<button class="btn btn-secondary" data-click="close-modal">Fermer</button>'}
    `, 'large');
};

const showClientModal = (id = null) => {
    const clients = DB.get('clients') || [];
    const client = id ? clients.find(c => c.id === id) : null;
    const cat = normalizeTarifKey(client?.tarifs);
    const prixPreset = (valeur) => valeur === '' || valeur === undefined ? '—' : formatChf(parseFloat(valeur)).replace(/^CHF\s*/, '');
    const categories = ['custom', 'distributeur', 'prive', 'restaurant'].map(k => {
        const p = TARIF_PRESETS[k];
        const definis = p ? [['25 cl', p.prix25cl], ['50 cl', p.prix50cl], ['1 l', p.prix100cl]].filter(([, v]) => v) : [];
        const detail = !p ? 'Vos propres prix'
            : definis.length === 3 ? `CHF ${definis.map(([, v]) => prixPreset(v)).join(' · ')}`
            : definis.map(([l, v]) => `${l} CHF ${prixPreset(v)}`).join(' · ');
        return `
            <label class="choice-card">
                <input type="radio" name="tarifs" value="${k}" ${cat === k ? 'checked' : ''} onchange="applyTarifPreset(this)">
                <span class="choice-card-title">${escapeHtml(TARIF_CATEGORIE_LABELS[k])}</span>
                <span class="choice-card-text">${escapeHtml(detail)}</span>
            </label>`;
    }).join('');
    const prix = (name, label) => `
        <div class="form-group">
            <label for="client_${name}">${escapeHtml(label)}</label>
            <div class="input-affix"><span class="input-affix-text" aria-hidden="true">CHF</span>
                <input type="text" id="client_${name}" name="${name}" inputmode="decimal" value="${escapeHtml(client?.[name] || '')}" placeholder="—" oninput="onPrixInputChange()">
            </div>
        </div>`;

    modal.show(id ? 'Modifier le client' : 'Nouveau client', `
        <form id="clientForm" class="form-sheet">
            <fieldset class="form-section">
                <legend class="trace-section-title">Identité</legend>
                <div class="form-row">
                    <div class="form-group">
                        <label for="client_societe">Société</label>
                        <input type="text" id="client_societe" name="societe" autocomplete="organization" value="${escapeHtml(client?.societe || '')}" placeholder="Ex. Café du Lac">
                    </div>
                    <div class="form-group">
                        <label for="client_nom">Prénom et nom</label>
                        <input type="text" id="client_nom" name="nom" autocomplete="name" value="${escapeHtml(client?.nom || '')}" placeholder="Personne de contact">
                    </div>
                </div>
            </fieldset>

            <fieldset class="form-section">
                <legend class="trace-section-title">Adresse et contact</legend>
                <div class="form-group">
                    <label for="client_adresse">Adresse</label>
                    <input type="text" id="client_adresse" name="adresse" autocomplete="street-address" value="${escapeHtml(client?.adresse || '')}" placeholder="Rue et numéro">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label for="client_npa">NPA et localité</label>
                        <input type="text" id="client_npa" name="npa" value="${escapeHtml(client?.npa || '')}" placeholder="1201 Genève">
                    </div>
                    <div class="form-group">
                        <label for="client_coord">Téléphone, e-mail</label>
                        <input type="text" id="client_coord" name="coord" value="${escapeHtml(client?.coord || '')}" placeholder="079 123 45 67 · nom@exemple.ch">
                    </div>
                </div>
            </fieldset>

            <fieldset class="form-section">
                <legend class="trace-section-title">Tarifs</legend>
                <div class="choice-cards">${categories}</div>
                <div class="form-row form-row--3">
                    ${prix('prix25cl', 'Prix 25 cl')}
                    ${prix('prix50cl', 'Prix 50 cl')}
                    ${prix('prix100cl', 'Prix 1 l')}
                </div>
            </fieldset>

            <fieldset class="form-section">
                <legend class="trace-section-title">Livraison et facturation</legend>
                <div class="form-row">
                    <div class="form-group">
                        <label for="client_modeFact">Mode de facturation</label>
                        <input type="text" id="client_modeFact" name="modeFact" value="${escapeHtml(client?.modeFact || '')}" placeholder="Ex. facture mensuelle">
                    </div>
                    <div class="form-group">
                        <label for="clientDureeVie">Durée de vie minimale à la livraison</label>
                        <div class="input-affix input-affix--end">
                            <input type="number" id="clientDureeVie" name="dureeVieMinJours" min="0" step="1" inputmode="numeric" value="${clientDureeVieMin(client) || ''}" placeholder="Aucune exigence">
                            <span class="input-affix-text" aria-hidden="true">jours</span>
                        </div>
                    </div>
                </div>
            </fieldset>

            <label class="switch-row">
                <span>
                    <span class="switch-row-title">Client actif</span>
                    <span class="switch-row-text">Un client inactif n'est plus proposé dans les nouvelles commandes.</span>
                </span>
                <input type="checkbox" name="actif" class="switch" ${client?.actif !== false ? 'checked' : ''}>
            </label>
        </form>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Annuler</button>
        <button class="btn btn-primary" data-click="save-client" data-id="${escapeHtml(id || '')}">Enregistrer</button>
    `, 'large');
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
            dureeVieMinJours: Math.max(0, parseInt(formData.get('dureeVieMinJours'), 10) || 0),
            actif: form.querySelector('input[name="actif"]').checked
        };
        if (!client.societe.trim() && !client.nom.trim()) {
            showToast('Veuillez renseigner le nom ou la société du client', 'error');
            return;
        }

        const clients = DB.get('clients');
        if (id) {
            const index = clients.findIndex(c => c.id === id);
            if (index === -1) {
                modal.hide();
                showToast('Client introuvable : il a peut-être été supprimé sur un autre appareil', 'error');
                renderCurrentView();
                return;
            }
            // Fusion : garde les champs absents du formulaire (ponctuel, email…)
            clients[index] = { ...clients[index], ...client };
        } else {
            clients.push(client);
        }
        DB.set('clients', clients);

        modal.hide();
        showToast('Client enregistré');
        renderCurrentView();
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
        renderCurrentView();
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

// Effacement en masse des clients : seuls les clients sans commande sont
// supprimés (même règle que deleteClient). Les clients liés à une commande
// restent : commandes, BL et rappels de lot y font référence.
const resetClients = () => {
    const clientsCommandes = new Set((DB.get('commandes') || []).map(c => c.clientId));
    const clients = DB.get('clients') || [];
    const aEffacer = new Set(clients.filter(c => !clientsCommandes.has(c.id)).map(c => c.id));
    if (aEffacer.size === 0) {
        showToast(clients.length === 0
            ? 'Aucun client à effacer'
            : 'Aucun client à effacer : tous ont des commandes associées', 'warning');
        return;
    }
    const conserves = clients.length - aEffacer.size;
    const message = `Effacer ${aEffacer.size} client(s) sans commande ?`
        + (conserves > 0 ? ` ${conserves} client(s) lié(s) à des commandes seront conservé(s).` : '');
    confirmDialog(message, { danger: true, confirmLabel: 'Effacer' }).then(ok => {
        if (!ok) return;
        // Relecture après la confirmation : seuls les clients listés, et toujours
        // sans commande, sont effacés (un autre appareil a pu en ajouter entre-temps).
        const commandesActuelles = new Set((DB.get('commandes') || []).map(c => c.clientId));
        const actuels = DB.get('clients') || [];
        const restants = actuels.filter(c => !aEffacer.has(c.id) || commandesActuelles.has(c.id));
        DB.set('clients', restants);
        showToast(`${actuels.length - restants.length} client(s) effacé(s)`);
        renderParametres();
    });
};
