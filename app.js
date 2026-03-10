// ThéCol Gestion - Application JavaScript

// Utility Functions
const generateId = () => '_' + Math.random().toString(36).substr(2, 9);
const formatDate = (date) => new Date(date).toLocaleDateString('fr-CH');
const formatDateTime = (date) => new Date(date).toLocaleString('fr-CH');
const formatTime = (time) => time.substring(0, 5);
const getLocalDateISOString = () => {
    const date = new Date();
    const offset = date.getTimezoneOffset();
    date.setMinutes(date.getMinutes() - offset);
    return date.toISOString().split('T')[0];
};

// Data Storage
const DB = {
    get: (key) => {
        const data = localStorage.getItem('thecol_' + key);
        try {
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('Error parsing data for key ' + key, e);
            return [];
        }
    },
    set: (key, data) => {
        localStorage.setItem('thecol_' + key, JSON.stringify(data));
    },
    init: () => {
        const tables = ['employees', 'aromes', 'formats', 'recettes', 'clients', 'lots', 'commandes', 'pointages'];
        tables.forEach(table => {
            if (!localStorage.getItem('thecol_' + table)) {
                DB.set(table, []);
            }
        });
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
const initDefaultData = () => {
    if (DB.get('aromes').length === 0) {
        DB.set('aromes', DEFAULT_AROMES.map(nom => ({
            id: generateId(),
            nom,
            couleur: DEFAULT_COULEURS[nom] || '#5D7B3E',
            actif: true
        })));
    }
    if (DB.get('formats').length === 0) {
        DB.set('formats', DEFAULT_FORMATS.map(nom => ({
            id: generateId(),
            nom,
            contenanceCl: parseFloat(nom) * 100,
            actif: true
        })));
    }
};

// Calculate dates (same as Stock project)
const calculateDates = (productionDate) => {
    const prod = new Date(productionDate);
    const saleLimit = new Date(prod);
    saleLimit.setMonth(saleLimit.getMonth() + 1);
    const consumptionLimit = new Date(prod);
    consumptionLimit.setMonth(consumptionLimit.getMonth() + 6);
    return {
        dlv: saleLimit.toISOString().split('T')[0],
        dlc: consumptionLimit.toISOString().split('T')[0]
    };
};

// Get status
const getStatus = (dlc) => {
    const now = new Date();
    const dlcDate = new Date(dlc);
    const oneMonthFromNow = new Date();
    oneMonthFromNow.setMonth(oneMonthFromNow.getMonth() + 1);
    
    if (now > dlcDate) return 'expired';
    if (dlcDate <= oneMonthFromNow) return 'warning';
    return 'ok';
};

// Toast Notifications
const showToast = (message, type = 'success') => {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
            ${type === 'success' ? '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>' : 
              type === 'error' ? '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>' :
              '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'}
        </svg>
        <span>${message}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
};

// Modal
const modal = {
    show: (title, body, footer) => {
        document.getElementById('modalTitle').textContent = title;
        document.getElementById('modalBody').innerHTML = body;
        document.getElementById('modalFooter').innerHTML = footer;
        document.getElementById('modalOverlay').classList.add('active');
    },
    hide: () => {
        document.getElementById('modalOverlay').classList.remove('active');
    }
};

document.getElementById('modalClose').addEventListener('click', modal.hide);
document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) modal.hide();
});

// Navigation
const router = () => {
    const hash = window.location.hash.slice(1) || 'dashboard';
    const page = hash.split('?')[0];
    navigateTo(page);
};

const navigateTo = (page) => {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
    
    const titles = {
        dashboard: 'Dashboard',
        stock: 'Gestion du stock',
        pointage: 'Pointage',
        commandes: 'Commandes',
        production: 'Planificateur de production',
        parametres: 'Paramètres'
    };
    document.getElementById('pageTitle').textContent = titles[page] || 'Dashboard';
    
    const views = {
        dashboard: renderDashboard,
        stock: renderStock,
        pointage: renderPointage,
        commandes: renderCommandes,
        production: renderProduction,
        parametres: renderParametres
    };
    
    (views[page] || renderDashboard)();
};

window.addEventListener('hashchange', router);

// Dashboard
const renderDashboard = () => {
    const lots = DB.get('lots') || [];
    const commandes = DB.get('commandes') || [];
    const pointages = DB.get('pointages') || [];
    const employes = DB.get('employees') || [];
    
    const today = new Date();
    const todayStr = getLocalDateISOString();
    const oneMonthFromNow = new Date();
    oneMonthFromNow.setMonth(oneMonthFromNow.getMonth() + 1);
    
    const totalBouteilles = lots.reduce((sum, lot) => sum + (lot.quantite || 0), 0);
    const expiries = lots.filter(lot => lot.dlc && new Date(lot.dlc) < today).length;
    const moinsUnMois = lots.filter(lot => {
        if (!lot.dlc) return false;
        const dlc = new Date(lot.dlc);
        return dlc >= today && dlc <= oneMonthFromNow;
    }).length;
    const sellableBottles = lots.filter(lot => lot.dlc && new Date(lot.dlc) >= today).reduce((sum, lot) => sum + (lot.quantite || 0), 0);
    
    const commandesEnAttente = commandes.filter(c => c.statut === 'en_attente').length;
    
    const heuresAujourdhui = pointages
        .filter(p => p.date === todayStr)
        .reduce((sum, p) => {
            if (!p.heureDebut || !p.heureFin) return sum;
            const debut = parseInt(p.heureDebut.replace(':', ''));
            const fin = parseInt(p.heureFin.replace(':', ''));
            if (debut && fin) {
                const minutes = (fin - debut) - (p.pause || 0);
                return sum + minutes / 60;
            }
            return sum;
        }, 0);

    document.getElementById('content').innerHTML = `
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon green">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
                </div>
                <div class="stat-content">
                    <h3>${sellableBottles}</h3>
                    <p>Bouteilles vendables</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon orange">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                </div>
                <div class="stat-content">
                    <h3>${totalBouteilles}</h3>
                    <p>Total bouteilles</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon red">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
                </div>
                <div class="stat-content">
                    <h3>${expiries}</h3>
                    <p>Expirés (DLC)</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon blue">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/></svg>
                </div>
                <div class="stat-content">
                    <h3>${commandesEnAttente}</h3>
                    <p>Commandes en attente</p>
                </div>
            </div>
        </div>
        
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Actions rapides</h3>
            </div>
            <div class="flex gap-4">
                <a href="#stock" class="btn btn-primary">Nouveau lot</a>
                <a href="#pointage" class="btn btn-secondary">Pointer</a>
                <a href="#commandes" class="btn btn-secondary">Nouvelle commande</a>
            </div>
        </div>
        
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Heures aujourd'hui</h3>
            </div>
            <p>Total: <strong>${heuresAujourdhui.toFixed(1)}h</strong></p>
        </div>
    `;
    
    document.getElementById('headerActions').innerHTML = '';
};

// Stock Management
const renderStock = () => {
    const lots = DB.get('lots') || [];
    const aromes = DB.get('aromes') || [];
    const formats = DB.get('formats') || [];
    
    const today = new Date();
    const oneMonthFromNow = new Date();
    oneMonthFromNow.setMonth(oneMonthFromNow.getMonth() + 1);
    
    const totalBouteilles = lots.reduce((sum, lot) => sum + (lot.quantite || 0), 0);
    const expiries = lots.filter(lot => lot.dlc && new Date(lot.dlc) < today).length;
    const moinsUnMois = lots.filter(lot => {
        if (!lot.dlc) return false;
        const dlc = new Date(lot.dlc);
        return dlc >= today && dlc <= oneMonthFromNow;
    }).length;
    const sellableBottles = lots.filter(lot => lot.dlc && new Date(lot.dlc) >= today).reduce((sum, lot) => sum + (lot.quantite || 0), 0);
    
    let html = `
        <div class="stats-grid" style="margin-bottom: 24px;">
            <div class="stat-card">
                <div class="stat-icon green">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
                </div>
                <div class="stat-content">
                    <h3>${sellableBottles}</h3>
                    <p>Bouteilles vendables</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon orange">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                </div>
                <div class="stat-content">
                    <h3>${totalBouteilles}</h3>
                    <p>Total bouteilles</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon red">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
                </div>
                <div class="stat-content">
                    <h3>${expiries}</h3>
                    <p>Expirés (DLC)</p>
                </div>
            </div>
        </div>
        
        ${renderSellableSummary(lots, aromes, formats, today)}
        
        <div class="card" style="margin-bottom: 24px;">
            <button class="flex items-center gap-2" style="background:none;border:none;cursor:pointer;font-size:16px;font-weight:500;color:var(--text);" onclick="toggleHistory()">
                <span id="historyArrow" style="font-size:12px;">▶</span> Historique de production
            </button>
            <div id="historyContent" style="display:none;margin-top:16px;">
                <div class="table-container" style="max-height:300px;overflow-y:auto;">
                    <table>
                        <thead>
                            <tr>
                                <th>Date prod.</th>
                                <th>Arôme</th>
                                <th>Format</th>
                                <th>Qté</th>
                                <th>Ajouté le</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            ${renderHistoryTable()}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
        
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Historique de production</h3>
                <button class="btn btn-primary" onclick="showNouveauLotModal()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Nouveau lot
                </button>
            </div>
            
            <div class="filters">
                <select id="filterArome" onchange="renderStock()">
                    <option value="">Tous les arômes</option>
                    ${aromes.filter(a => a.actif).map(a => `<option value="${a.nom}">${a.nom}</option>`).join('')}
                </select>
                <select id="filterFormat" onchange="renderStock()">
                    <option value="">Tous les formats</option>
                    ${formats.filter(f => f.actif).map(f => `<option value="${f.nom}">${f.nom}</option>`).join('')}
                </select>
            </div>
            
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Lot</th>
                            <th>Arôme</th>
                            <th>Format</th>
                            <th>Qté</th>
                            <th>Prod.</th>
                            <th>DLV</th>
                            <th>DLC</th>
                            <th>Statut</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${lots.length === 0 ? '<tr><td colspan="9" class="text-center">Aucun lot en stock</td></tr>' : 
                          lots.filter(lot => {
                              const filterArome = document.getElementById('filterArome')?.value || '';
                              const filterFormat = document.getElementById('filterFormat')?.value || '';
                              return (!filterArome || lot.arome === filterArome) && (!filterFormat || lot.format === filterFormat);
                          }).map(lot => {
                              const arome = aromes.find(a => a.nom === lot.arome);
                              const status = getStatus(lot.dlc);
                              const statusBadge = status === 'expired' ? '<span class="badge badge-danger">Expiré</span>' : 
                                                  status === 'warning' ? '<span class="badge badge-warning">&lt; 1 mois</span>' : 
                                                  '<span class="badge badge-success">OK</span>';
                              
                              return `
                                <tr>
                                    <td>#${String(lot.id).padStart(6, '0')}</td>
                                    <td><span class="color-dot" style="background: ${arome?.couleur || '#ccc'}"></span>${lot.arome}</td>
                                    <td>${lot.format}</td>
                                    <td><span id="qty-${lot.id}">${lot.quantite}</span></td>
                                    <td>${formatDate(lot.dateProduction)}</td>
                                    <td>${formatDate(lot.dlv)}</td>
                                    <td>${formatDate(lot.dlc)}</td>
                                    <td>${statusBadge}</td>
                                    <td class="table-actions">
                                        <button class="btn btn-sm btn-success" onclick="showVendreModal('${lot.id}')">Vendre</button>
                                        <button class="btn btn-sm btn-secondary" onclick="showEditLotModal('${lot.id}')">Modifier</button>
                                        <button class="btn btn-sm btn-danger" onclick="deleteLot('${lot.id}')">Supprimer</button>
                                    </td>
                                </tr>
                              `;
                          }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
    
    document.getElementById('content').innerHTML = html;
};

const showNouveauLotModal = () => {
    const aromes = DB.get('aromes').filter(a => a.actif);
    const formats = DB.get('formats').filter(f => f.actif);
    const prodDate = getLocalDateISOString();
    const dates = calculateDates(prodDate);
    
    modal.show('Nouveau lot de production', `
        <form id="lotForm">
            <div class="form-row">
                <div class="form-group">
                    <label>Arôme</label>
                    <select name="arome" required>
                        ${aromes.length === 0 ? '<option value="">Aucun arôme disponible</option>' : 
                          aromes.map(a => `<option value="${a.nom}">${a.nom}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Format</label>
                    <select name="format" required>
                        ${formats.length === 0 ? '<option value="">Aucun format disponible</option>' : 
                          formats.map(f => `<option value="${f.nom}">${f.nom}</option>`).join('')}
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
        <button class="btn btn-primary" onclick="saveLot()">Créer le lot</button>
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

const toggleHistory = () => {
    const content = document.getElementById('historyContent');
    const arrow = document.getElementById('historyArrow');
    if (content.style.display === 'none') {
        content.style.display = 'block';
        arrow.textContent = '▼';
    } else {
        content.style.display = 'none';
        arrow.textContent = '▶';
    }
};

const renderHistoryTable = () => {
    const history = DB.get('history') || [];
    if (history.length === 0) {
        return '<tr><td colspan="6" class="text-center">Aucun historique</td></tr>';
    }
    return history.map(record => `
        <tr>
            <td>${formatDate(record.productionDate)}</td>
            <td>${record.arome}</td>
            <td>${record.format}</td>
            <td style="color:var(--primary);font-weight:bold;">${record.quantity}</td>
            <td>${new Date(record.dateAdded).toLocaleDateString('fr-CH')}</td>
            <td><button class="btn btn-sm btn-danger" onclick="deleteHistoryRecord('${record.id}')">✕</button></td>
        </tr>
    `).join('');
};

const deleteHistoryRecord = (recordId) => {
    if (confirm('Supprimer cet enregistrement ?')) {
        const history = DB.get('history') || [];
        const index = history.findIndex(r => r.id === recordId);
        if (index !== -1) {
            history.splice(index, 1);
            DB.set('history', history);
            showToast('Enregistrement supprimé');
            renderStock();
        }
    }
};

const saveLot = () => {
    const form = document.getElementById('lotForm');
    const formData = new FormData(form);
    
    const arome = formData.get('arome');
    const format = formData.get('format');
    const quantite = parseInt(formData.get('quantite'));
    const dateProduction = formData.get('dateProduction');
    const dlv = formData.get('dlv');
    const dlc = formData.get('dlc');
    
    const lots = DB.get('lots');
    const history = DB.get('history') || [];
    
    // Check if lot with same arome, format and production date exists
    const existingLot = lots.find(l => 
        l.arome === arome && 
        l.format === format && 
        l.dateProduction === dateProduction
    );
    
    let newId;
    if (existingLot) {
        existingLot.quantite += quantite;
        newId = existingLot.id;
    } else {
        // Generate sequential ID
        const counter = parseInt(localStorage.getItem('thecol_lot_counter') || '0', 10);
        newId = String(counter + 1).padStart(6, '0');
        localStorage.setItem('thecol_lot_counter', String(counter + 1));
        
        const lot = {
            id: newId,
            arome,
            format,
            quantite,
            dateProduction,
            dlv,
            dlc
        };
        lots.push(lot);
    }
    
    // Add to production history
    history.unshift({
        id: `PROD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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
    renderStock();
};

const deleteLot = (id) => {
    if (confirm('Êtes-vous sûr de vouloir supprimer ce lot ?')) {
        const lots = DB.get('lots').filter(l => l.id !== id);
        DB.set('lots', lots);
        showToast('Lot supprimé');
        renderStock();
    }
};

const renderSellableSummary = (lots, aromes, formats, today) => {
    if (!lots || lots.length === 0) return '';
    
    const sellableLots = lots.filter(lot => getStatus(lot.dlc) === 'ok');
    
    if (sellableLots.length === 0) return '';
    
    const summary = (aromes || []).filter(a => a && a.actif).map(arome => {
        const formatsData = (formats || []).filter(f => f && f.actif).map(format => {
            const total = sellableLots
                .filter(l => l.arome === arome.nom && l.format === format.nom)
                .reduce((sum, l) => sum + l.quantite, 0);
            return { format: format.nom, total };
        }).filter(f => f.total > 0);
        
        const totalArome = formatsData.reduce((sum, f) => sum + f.total, 0);
        return { arome: arome.nom, couleur: arome.couleur, formats: formatsData, total: totalArome };
    }).filter(item => item.total > 0);
    
    if (summary.length === 0) return '';
    
    return `
        <div class="card" style="margin-bottom: 24px;">
            <h3 class="card-title" style="margin-bottom: 16px;">Stock vendable</h3>
            <div class="sellable-grid">
                ${summary.map(item => `
                    <div class="sellable-item">
                        <div class="sellable-header">
                            <span class="color-dot" style="background: ${item.couleur || '#5D7B3E'}"></span>
                            <strong>${item.arome}</strong>
                            <span class="badge badge-success">${item.total} bt</span>
                        </div>
                        <div class="sellable-formats">
                            ${item.formats.map(f => `
                                <span>${f.format}: <strong>${f.total}</strong></span>
                            `).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
};

const isSellable = (lot) => {
    return new Date(lot.dlc) >= new Date();
};

const showVendreModal = (lotId) => {
    const lots = DB.get('lots');
    const lot = lots.find(l => l.id === lotId);
    if (!lot) return;
    
    modal.show('Vendre des bouteilles', `
        <form id="vendreForm">
            <div class="form-group">
                <label>Quantité à vendre</label>
                <input type="number" name="quantite" min="1" max="${lot.quantite}" value="1" required>
                <small class="text-muted">Stock disponible: ${lot.quantite}</small>
            </div>
        </form>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Annuler</button>
        <button class="btn btn-success" onclick="vendreLot('${lotId}')">Vendre</button>
    `);
};

const vendreLot = (lotId) => {
    const quantite = parseInt(document.querySelector('#vendreForm input[name="quantite"]').value);
    const lots = DB.get('lots');
    const lotIndex = lots.findIndex(l => l.id === lotId);
    
    if (lotIndex === -1) return;
    
    const lot = lots[lotIndex];
    lot.quantite -= quantite;
    
    if (lot.quantite <= 0) {
        lots.splice(lotIndex, 1);
    }
    
    DB.set('lots', lots);
    modal.hide();
    showToast(`${quantite} bouteille(s) vendu(e)s`);
    renderStock();
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
        <button class="btn btn-primary" onclick="saveEditLot('${lotId}')">Enregistrer</button>
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

const saveEditLot = (lotId) => {
    const form = document.getElementById('editLotForm');
    const formData = new FormData(form);
    
    const lots = DB.get('lots');
    const lotIndex = lots.findIndex(l => l.id === lotId);
    
    if (lotIndex !== -1) {
        lots[lotIndex].quantite = parseInt(formData.get('quantite'));
        lots[lotIndex].dateProduction = formData.get('dateProduction');
        lots[lotIndex].dlv = formData.get('dlv');
        lots[lotIndex].dlc = formData.get('dlc');
        DB.set('lots', lots);
        modal.hide();
        showToast('Lot modifié');
        renderStock();
    }
};

// Pointage
const renderPointage = () => {
    const pointages = DB.get('pointages') || [];
    const employes = DB.get('employees') || [];
    const today = getLocalDateISOString();
    
    const currentTime = new Date().toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
    
    let html = `
        <div class="pointage-clock">
            <div class="current-time">${currentTime}</div>
            <div class="current-date">${formatDate(today)}</div>
            <div class="pointage-actions">
                <button class="btn btn-success" onclick="showSaisieManuelleModal()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"/></svg>
                    Saisie heures
                </button>
            </div>
        </div>
        
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Historique des pointages</h3>
            </div>
            
            <div class="filters">
                <select id="filterEmploye" onchange="renderPointage()">
                    <option value="">Tous les employés</option>
                    ${employes.filter(e => e.actif).map(e => `<option value="${e.id}">${e.prenom} ${e.nom}</option>`).join('')}
                </select>
                <input type="date" id="filterDate" value="${today}" onchange="renderPointage()">
            </div>
            
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Employé</th>
                            <th>Début</th>
                            <th>Fin</th>
                            <th>Pause</th>
                            <th>Total</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${pointages.length === 0 ? '<tr><td colspan="7" class="text-center">Aucun pointage</td></tr>' : 
                          pointages
                            .filter(p => {
                                const filterEmploye = document.getElementById('filterEmploye')?.value || '';
                                const filterDate = document.getElementById('filterDate')?.value || '';
                                return (!filterEmploye || p.employeId === filterEmploye) && 
                                       (!filterDate || p.date === filterDate);
                            })
                            .sort((a, b) => new Date(b.date + b.heureDebut) - new Date(a.date + a.heureDebut))
                            .map(p => {
                                const emp = employes.find(e => e.id === p.employeId);
                                let totalMinutes = 0;
                                if (p.heureDebut && p.heureFin) {
                                    const [h1, m1] = p.heureDebut.split(':').map(Number);
                                    const [h2, m2] = p.heureFin.split(':').map(Number);
                                    totalMinutes = (h2 * 60 + m2) - (h1 * 60 + m1) - (p.pause || 0);
                                }
                                const heures = Math.floor(totalMinutes / 60);
                                const mins = totalMinutes % 60;
                                
                                return `
                                    <tr>
                                        <td>${formatDate(p.date)}</td>
                                        <td>${emp ? emp.prenom + ' ' + emp.nom : 'N/A'}</td>
                                        <td>${p.heureDebut || '-'}</td>
                                        <td>${p.heureFin || '-'}</td>
                                        <td>${p.pause || 0} min</td>
                                        <td>${totalMinutes > 0 ? `${heures}h ${mins}min` : '-'}</td>
                                        <td>
                                            <button class="btn btn-sm btn-secondary" onclick="deletePointage('${p.id}')">Supprimer</button>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
    
    document.getElementById('content').innerHTML = html;
    
    // Update time every second
    setInterval(() => {
        const timeEl = document.querySelector('.current-time');
        if (timeEl) {
            timeEl.textContent = new Date().toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
        }
    }, 1000);
};

const showPointageModal = (type) => {
    const employes = DB.get('employees').filter(e => e.actif);
    
    if (employes.length === 0) {
        showToast('Veuillez d\'abord ajouter des employés dans les paramètres', 'error');
        return;
    }
    
    modal.show(type === 'arrivee' ? 'Pointer arrivée' : 'Pointer départ', `
        <form id="pointageForm">
            <div class="form-group">
                <label>Employé</label>
                <select name="employeId" required>
                    ${employes.map(e => `<option value="${e.id}">${e.prenom} ${e.nom}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>Date</label>
                <input type="date" name="date" value="${getLocalDateISOString()}" required>
            </div>
            <div class="form-group">
                <label>Heure</label>
                <input type="time" name="heure" value="" required>
            </div>
            <div class="form-group">
                <label>Pause (minutes)</label>
                <input type="number" name="pause" value="0" min="0">
            </div>
        </form>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Annuler</button>
        <button class="btn btn-primary" onclick="savePointage('${type}')">Valider</button>
    `);
};

const showSaisieManuelleModal = () => {
    const employes = DB.get('employees').filter(e => e.actif);
    
    if (employes.length === 0) {
        showToast('Veuillez d\'abord ajouter des employés dans les paramètres', 'error');
        return;
    }
    
    modal.show('Saisie manuelle des heures', `
        <form id="saisieManuelleForm">
            <div class="form-group">
                <label>Employé</label>
                <select name="employeId" required>
                    ${employes.map(e => `<option value="${e.id}">${e.prenom} ${e.nom}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>Date</label>
                <input type="date" name="date" value="${getLocalDateISOString()}" required>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Heure de début</label>
                    <input type="time" name="heureDebut" required>
                </div>
                <div class="form-group">
                    <label>Heure de fin</label>
                    <input type="time" name="heureFin" required>
                </div>
            </div>
            <div class="form-group">
                <label>Pause (minutes)</label>
                <input type="number" name="pause" value="0" min="0">
            </div>
        </form>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Annuler</button>
        <button class="btn btn-primary" onclick="saveSaisieManuelle()">Enregistrer</button>
    `);
};

const saveSaisieManuelle = () => {
    const form = document.getElementById('saisieManuelleForm');
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
    
    const pointages = DB.get('pointages');
    
    // Check if there's already a pointage for this employee on this date
    let pointage = pointages.find(p => p.employeId === employeId && p.date === date);
    
    if (pointage) {
        pointage.heureDebut = heureDebut;
        pointage.heureFin = heureFin;
        pointage.pause = pause;
    } else {
        pointage = {
            id: generateId(),
            employeId,
            date,
            heureDebut,
            heureFin,
            pause
        };
        pointages.push(pointage);
    }
    
    DB.set('pointages', pointages);
    modal.hide();
    showToast('Heures enregistrées');
    renderPointage();
};

const savePointage = (type) => {
    const form = document.getElementById('pointageForm');
    const formData = new FormData(form);
    const employeId = formData.get('employeId');
    const date = formData.get('date');
    const heure = formData.get('heure');
    
    const pointages = DB.get('pointages');
    
    // Check if there's already a pointage for this employee on this date
    let pointage = pointages.find(p => p.employeId === employeId && p.date === date);
    
    if (!pointage) {
        pointage = {
            id: generateId(),
            employeId,
            date,
            pause: parseInt(formData.get('pause')) || 0
        };
        pointages.push(pointage);
    }
    
    if (type === 'arrivee') {
        pointage.heureDebut = heure;
    } else {
        pointage.heureFin = heure;
        pointage.pause = parseInt(formData.get('pause')) || 0;
    }
    
    DB.set('pointages', pointages);
    modal.hide();
    showToast(type === 'arrivee' ? 'Arrivée pointée' : 'Départ pointé');
    renderPointage();
};

const deletePointage = (id) => {
    if (confirm('Êtes-vous sûr de vouloir supprimer ce pointage ?')) {
        const pointages = DB.get('pointages').filter(p => p.id !== id);
        DB.set('pointages', pointages);
        showToast('Pointage supprimé');
        renderPointage();
    }
};

// Commandes
const renderCommandes = () => {
    const commandes = DB.get('commandes') || [];
    const clients = DB.get('clients') || [];
    const aromes = DB.get('aromes') || [];
    const formats = DB.get('formats') || [];
    
    let html = `
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Liste des commandes</h3>
                <button class="btn btn-primary" onclick="showCommandeModal()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Nouvelle commande
                </button>
            </div>
            
            <div class="filters">
                <select id="filterClient" onchange="renderCommandes()">
                    <option value="">Tous les clients</option>
                    ${clients.filter(c => c.actif).map(c => `<option value="${c.id}">${c.nom}</option>`).join('')}
                </select>
                <select id="filterStatut" onchange="renderCommandes()">
                    <option value="">Tous les statuts</option>
                    <option value="en_attente">En attente</option>
                    <option value="produite">Produite</option>
                    <option value="livrée">Livrée</option>
                    <option value="annulee">Annulée</option>
                </select>
            </div>
            
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>N°</th>
                            <th>Client</th>
                            <th>Date commande</th>
                            <th>Date livraison</th>
                            <th>Articles</th>
                            <th>Statut</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${commandes.length === 0 ? '<tr><td colspan="7" class="text-center">Aucune commande</td></tr>' : 
                          commandes
                            .filter(c => {
                                const filterClient = document.getElementById('filterClient')?.value || '';
                                const filterStatut = document.getElementById('filterStatut')?.value || '';
                                return (!filterClient || c.clientId === filterClient) && 
                                       (!filterStatut || c.statut === filterStatut);
                            })
                            .sort((a, b) => new Date(b.dateCommande) - new Date(a.dateCommande))
                            .map(cmd => {
                                const client = clients.find(cl => cl.id === cmd.clientId);
                                const totalItems = cmd.items.reduce((sum, i) => sum + i.quantite, 0);
                                const articlesPreview = cmd.items.slice(0, 2).map(i => {
                                    const a = aromes.find(a => a.id === i.aromeId);
                                    const f = formats.find(f => f.id === i.formatId);
                                    return `${i.quantite}x ${a?.nom || '?'} ${f?.nom || '?'}`;
                                }).join(', ');
                                
                                const badgeClass = cmd.statut === 'en_attente' ? 'badge-warning' : 
                                                  cmd.statut === 'produite' ? 'badge-info' :
                                                  cmd.statut === 'livrée' ? 'badge-success' : 'badge-danger';
                                
                                return `
                                    <tr>
                                        <td>${cmd.id.slice(-6)}</td>
                                        <td>${client?.nom || 'N/A'}</td>
                                        <td>${formatDate(cmd.dateCommande)}</td>
                                        <td>${formatDate(cmd.dateLivraison)}</td>
                                        <td>${articlesPreview}${cmd.items.length > 2 ? '...' : ''} (${totalItems})</td>
                                        <td><span class="badge ${badgeClass}">${cmd.statut}</span></td>
                                        <td>
                                            <button class="btn btn-sm btn-secondary" onclick="editCommande('${cmd.id}')">Modifier</button>
                                            <button class="btn btn-sm btn-danger" onclick="deleteCommande('${cmd.id}')">Supprimer</button>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
    
    document.getElementById('content').innerHTML = html;
};

const showCommandeModal = (id = null) => {
    const clients = DB.get('clients').filter(c => c.actif);
    const aromes = DB.get('aromes').filter(a => a.actif);
    const formats = DB.get('formats').filter(f => f.actif);
    const commandes = DB.get('commandes');
    
    let commande = null;
    if (id) {
        commande = commandes.find(c => c.id === id);
    }
    
    if (clients.length === 0 || aromes.length === 0 || formats.length === 0) {
        showToast('Veuillez d\'abord configurer clients, aromes et formats', 'error');
        return;
    }
    
    const itemsHtml = commande ? commande.items.map((item, idx) => `
        <div class="item-row" data-index="${idx}">
            <select name="items[${idx}][aromeId]" required>
                ${aromes.map(a => `<option value="${a.id}" ${item.aromeId === a.id ? 'selected' : ''}>${a.nom}</option>`).join('')}
            </select>
            <select name="items[${idx}][formatId]" required>
                ${formats.map(f => `<option value="${f.id}" ${item.formatId === f.id ? 'selected' : ''}>${f.nom}</option>`).join('')}
            </select>
            <input type="number" name="items[${idx}][quantite]" value="${item.quantite}" min="1" required>
            <button type="button" class="btn btn-sm btn-danger" onclick="this.parentElement.remove()">×</button>
        </div>
    `).join('') : '<div class="item-row"><select name="items[0][aromeId]" required></select><select name="items[0][formatId]" required></select><input type="number" name="items[0][quantite]" value="1" min="1" required><button type="button" class="btn btn-sm btn-danger" onclick="this.parentElement.remove()">×</button></div>';
    
    // Populate arome options
    const aromeOptions = aromes.map(a => `<option value="${a.id}">${a.nom}</option>`).join('');
    const formatOptions = formats.map(f => `<option value="${f.id}">${f.nom}</option>`).join('');
    
    modal.show(id ? 'Modifier commande' : 'Nouvelle commande', `
        <form id="commandeForm">
            <div class="form-row">
                <div class="form-group">
                    <label>Client</label>
                    <select name="clientId" required>
                        ${clients.map(c => `<option value="${c.id}" ${commande?.clientId === c.id ? 'selected' : ''}>${c.nom}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Date de livraison</label>
                    <input type="date" name="dateLivraison" value="${commande?.dateLivraison || ''}" required>
                </div>
            </div>
            <div class="form-group">
                <label>Articles</label>
                <div id="itemsContainer" data-aromes="${aromeOptions}" data-formats="${formatOptions}">
                    ${itemsHtml}
                </div>
                <button type="button" class="btn btn-sm btn-secondary mt-4" onclick="addItem()">+ Ajouter un article</button>
            </div>
            <div class="form-group">
                <label>Statut</label>
                <select name="statut">
                    <option value="en_attente" ${commande?.statut === 'en_attente' ? 'selected' : ''}>En attente</option>
                    <option value="produite" ${commande?.statut === 'produite' ? 'selected' : ''}>Produite</option>
                    <option value="livrée" ${commande?.statut === 'livrée' ? 'selected' : ''}>Livrée</option>
                    <option value="annulee" ${commande?.statut === 'annulee' ? 'selected' : ''}>Annulée</option>
                </select>
            </div>
        </form>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Annuler</button>
        <button class="btn btn-primary" onclick="saveCommande('${id || ''}')">Enregistrer</button>
    `);
    
    // Set initial options in selects
    document.querySelectorAll('#itemsContainer select[name*="aromeId"]').forEach(sel => {
        if (!sel.value) sel.innerHTML = aromeOptions;
    });
    document.querySelectorAll('#itemsContainer select[name*="formatId"]').forEach(sel => {
        if (!sel.value) sel.innerHTML = formatOptions;
    });
};

const addItem = () => {
    const container = document.getElementById('itemsContainer');
    const index = container.querySelectorAll('.item-row').length;
    const aromeOptions = container.dataset.aromes;
    const formatOptions = container.dataset.formats;
    
    const div = document.createElement('div');
    div.className = 'item-row';
    div.innerHTML = `
        <select name="items[${index}][aromeId]" required>${aromeOptions}</select>
        <select name="items[${index}][formatId]" required>${formatOptions}</select>
        <input type="number" name="items[${index}][quantite]" value="1" min="1" required>
        <button type="button" class="btn btn-sm btn-danger" onclick="this.parentElement.remove()">×</button>
    `;
    container.appendChild(div);
};

const saveCommande = (id) => {
    const form = document.getElementById('commandeForm');
    const formData = new FormData(form);
    
    const items = [];
    const itemRows = document.querySelectorAll('.item-row');
    itemRows.forEach((row, idx) => {
        const aromeId = row.querySelector(`select[name="items[${idx}][aromeId]"]`)?.value || row.querySelector('[name*="aromeId"]')?.value;
        const formatId = row.querySelector(`select[name="items[${idx}][formatId]"]`)?.value || row.querySelector('[name*="formatId"]')?.value;
        const quantite = row.querySelector(`input[name="items[${idx}][quantite]"]`)?.value || row.querySelector('[name*="quantite"]')?.value;
        
        if (aromeId && formatId && quantite) {
            items.push({ aromeId, formatId, quantite: parseInt(quantite) });
        }
    });
    
    const commande = {
        id: id || generateId(),
        clientId: formData.get('clientId'),
        dateCommande: id ? DB.get('commandes').find(c => c.id === id)?.dateCommande : getLocalDateISOString(),
        dateLivraison: formData.get('dateLivraison'),
        statut: formData.get('statut'),
        items
    };
    
    const commandes = DB.get('commandes');
    if (id) {
        const index = commandes.findIndex(c => c.id === id);
        commandes[index] = commande;
    } else {
        commandes.push(commande);
    }
    DB.set('commandes', commandes);
    
    modal.hide();
    showToast('Commande enregistrée');
    renderCommandes();
};

const editCommande = (id) => showCommandeModal(id);

const deleteCommande = (id) => {
    if (confirm('Êtes-vous sûr de vouloir supprimer cette commande ?')) {
        const commandes = DB.get('commandes').filter(c => c.id !== id);
        DB.set('commandes', commandes);
        showToast('Commande supprimée');
        renderCommandes();
    }
};

// Production Planner
const renderProduction = () => {
    const commandes = DB.get('commandes') || [];
    const aromes = DB.get('aromes') || [];
    const formats = DB.get('formats') || [];
    const recettes = DB.get('recettes') || [];
    
    const today = new Date();
    const weekEnd = new Date();
    weekEnd.setDate(weekEnd.getDate() + 7);
    
    let html = `
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Planificateur de production</h3>
            </div>
            
            <div class="filters">
                <div class="form-group" style="margin-bottom: 0;">
                    <label>Période des commandes</label>
                    <div style="display: flex; gap: 8px;">
                        <input type="date" id="prodDateDebut" value="${getLocalDateISOString()}">
                        <input type="date" id="prodDateFin" value="${weekEnd.toISOString().split('T')[0]}">
                        <button class="btn btn-primary" onclick="calculerProduction()">Calculer</button>
                    </div>
                </div>
            </div>
            
            <div id="productionResult">
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
                    <h3>Sélectionnez une période</h3>
                    <p>Choisissez les dates des commandes à produire et cliquez sur "Calculer"</p>
                </div>
            </div>
        </div>
    `;
    
    document.getElementById('content').innerHTML = html;
};

const calculerProduction = () => {
    const commandes = DB.get('commandes');
    const aromes = DB.get('aromes');
    const formats = DB.get('formats');
    const recettes = DB.get('recettes');
    
    const dateDebut = document.getElementById('prodDateDebut').value;
    const dateFin = document.getElementById('prodDateFin').value;
    
    // Filter commandes in period
    const commandesPeriode = commandes.filter(c => 
        c.dateLivraison >= dateDebut && 
        c.dateLivraison <= dateFin &&
        c.statut !== 'annulee' &&
        c.statut !== 'livrée'
    );
    
    // Calculate totals by arome and format
    const besoins = {};
    
    commandesPeriode.forEach(cmd => {
        cmd.items.forEach(item => {
            const key = `${item.aromeId}-${item.formatId}`;
            if (!besoins[key]) {
                besoins[key] = { aromeId: item.aromeId, formatId: item.formatId, quantite: 0 };
            }
            besoins[key].quantite += item.quantite;
        });
    });
    
    // Calculate liters per arome
    const litresParArome = {};
    Object.values(besoins).forEach(b => {
        const format = formats.find(f => f.id === b.formatId);
        const litres = (format?.contenanceCl || 0) * b.quantite / 100;
        if (!litresParArome[b.aromeId]) litresParArome[b.aromeId] = 0;
        litresParArome[b.aromeId] += litres;
    });
    
    // Calculate ingredients needed
    const ingredientsTotal = {};
    Object.entries(litresParArome).forEach(([aromeId, litres]) => {
        const recette = recettes.find(r => r.aromeId === aromeId);
        if (recette) {
            recette.ingredients.forEach(ing => {
                const besoin = ing.quantite * litres;
                if (!ingredientsTotal[ing.nom]) ingredientsTotal[ing.nom] = { quantite: 0, unite: ing.unite };
                ingredientsTotal[ing.nom].quantite += besoin;
            });
        }
    });
    
    // Render results
    const resultHtml = `
        <div class="production-summary">
            <div class="production-item">
                <h4>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/></svg>
                    Bouteilles à produire
                </h4>
                ${Object.values(besoins).length === 0 ? '<p class="text-muted">Aucune commande dans cette période</p>' : 
                  Object.values(besoins).map(b => {
                      const arome = aromes.find(a => a.id === b.aromeId);
                      const format = formats.find(f => f.id === b.formatId);
                      return `<div class="flex-between" style="padding: 8px 0; border-bottom: 1px solid var(--border-light);">
                          <span><span class="color-dot" style="background: ${arome?.couleur || '#ccc'}"></span>${arome?.nom || 'N/A'} ${format?.nom || ''}</span>
                          <strong>${b.quantite} bt</strong>
                      </div>`;
                  }).join('')}
            </div>
            
            <div class="production-item">
                <h4>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M20.2 7.8l-7.7 7.7-4-4-5.7 5.7"/></svg>
                    Litres par arôme
                </h4>
                ${Object.entries(litresParArome).length === 0 ? '<p class="text-muted">Aucun litre à produire</p>' : 
                  Object.entries(litresParArome).map(([aromeId, litres]) => {
                      const arome = aromes.find(a => a.id === aromeId);
                      return `<div class="flex-between" style="padding: 8px 0; border-bottom: 1px solid var(--border-light);">
                          <span><span class="color-dot" style="background: ${arome?.couleur || '#ccc'}"></span>${arome?.nom || 'N/A'}</span>
                          <strong>${litres.toFixed(1)} L</strong>
                      </div>`;
                  }).join('')}
            </div>
            
            <div class="production-item">
                <h4>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                    Ingrédients nécessaires
                </h4>
                ${Object.keys(ingredientsTotal).length === 0 ? '<p class="text-muted">Aucune recette définie</p>' : 
                  `<ul class="ingredient-list">
                    ${Object.entries(ingredientsTotal).map(([nom, data]) => `
                        <li>
                            <span>${nom}</span>
                            <strong>${data.quantite.toFixed(2)} ${data.unite}</strong>
                        </li>
                    `).join('')}
                  </ul>`}
            </div>
        </div>
        
        <div style="margin-top: 24px; padding: 16px; background: var(--bg-secondary); border-radius: var(--radius);">
            <strong>Résumé:</strong> ${commandesPeriode.length} commande(s) à produire pour cette période
        </div>
    `;
    
    document.getElementById('productionResult').innerHTML = resultHtml;
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
                                <span>${e.prenom} ${e.nom}</span>
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
                                <span class="color-dot" style="background: ${a.couleur}"></span>
                                <span>${a.nom}</span>
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
                                <span>${f.nom}</span>
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
                    <button class="btn btn-sm btn-primary" onclick="showRecetteModal()">+ Ajouter</button>
                </div>
                <ul class="settings-list">
                    ${recettes.length === 0 ? '<li class="settings-item text-muted">Aucune recette</li>' : 
                      recettes.map(r => {
                          const arome = aromes.find(a => a.id === r.aromeId);
                          return `
                            <li class="settings-item">
                                <div class="settings-item-info">
                                    <span class="color-dot" style="background: ${arome?.couleur || '#ccc'}"></span>
                                    <span>${r.nom}</span>
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
                    <button class="btn btn-sm btn-primary" onclick="showClientModal()">+ Ajouter</button>
                </div>
                <ul class="settings-list">
                    ${clients.length === 0 ? '<li class="settings-item text-muted">Aucun client</li>' : 
                      clients.map(c => `
                        <li class="settings-item">
                            <div class="settings-item-info">
                                <span>${c.nom}</span>
                                <span class="text-muted">${c.email || ''}</span>
                                <span class="badge ${c.actif ? 'badge-success' : 'badge-default'}">${c.actif ? 'Actif' : 'Inactif'}</span>
                            </div>
                            <div class="settings-item-actions">
                                <button class="btn btn-sm btn-secondary" onclick="showClientModal('${c.id}')">Modifier</button>
                                <button class="btn btn-sm btn-danger" onclick="deleteClient('${c.id}')">Supprimer</button>
                            </div>
                        </li>
                      `).join('')}
                </ul>
            </div>
        </div>
    `;
    
    document.getElementById('content').innerHTML = html;
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
                    <input type="text" name="nom" value="${emp?.nom || ''}" required>
                </div>
                <div class="form-group">
                    <label>Prénom</label>
                    <input type="text" name="prenom" value="${emp?.prenom || ''}" required>
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
        <button class="btn btn-primary" onclick="saveEmploye('${id || ''}')">Enregistrer</button>
    `);
};

const saveEmploye = (id) => {
    const form = document.getElementById('employeForm');
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
};

const deleteEmploye = (id) => {
    const pointages = DB.get('pointages');
    const hasPointages = pointages.some(p => p.employeId === id);
    
    if (hasPointages) {
        alert('Impossible de supprimer cet employé car il possède des pointages enregistrés. Vous pouvez le désactiver à la place.');
        return;
    }

    if (confirm('Êtes-vous sûr de vouloir supprimer cet employé ?')) {
        const employes = DB.get('employees').filter(e => e.id !== id);
        DB.set('employees', employes);
        showToast('Employé supprimé');
        renderParametres();
    }
};

// Settings - Aromes
const showAromeModal = (id = null) => {
    const aromes = DB.get('aromes');
    const arome = id ? aromes.find(a => a.id === id) : null;
    
    modal.show(id ? 'Modifier arôme' : 'Nouvel arôme', `
        <form id="aromeForm">
            <div class="form-group">
                <label>Nom</label>
                <input type="text" name="nom" value="${arome?.nom || ''}" required>
            </div>
            <div class="form-group">
                <label>Couleur (code hex)</label>
                <input type="color" name="couleur" value="${arome?.couleur || '#5D7B3E'}" style="height: 40px; padding: 4px;">
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
        <button class="btn btn-primary" onclick="saveArome('${id || ''}')">Enregistrer</button>
    `);
};

const saveArome = (id) => {
    const form = document.getElementById('aromeForm');
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
};

const deleteArome = (id) => {
    const commandes = DB.get('commandes');
    const recettes = DB.get('recettes');
    
    const isUsedInCommandes = commandes.some(c => c.items.some(i => i.aromeId === id));
    const isUsedInRecettes = recettes.some(r => r.aromeId === id);
    
    if (isUsedInCommandes || isUsedInRecettes) {
        alert('Impossible de supprimer cet arôme car il est utilisé dans des commandes ou des recettes. Vous pouvez le désactiver à la place.');
        return;
    }

    if (confirm('Êtes-vous sûr de vouloir supprimer cet arôme ?')) {
        const aromes = DB.get('aromes').filter(a => a.id !== id);
        DB.set('aromes', aromes);
        showToast('Arôme supprimé');
        renderParametres();
    }
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
                    <input type="text" name="nom" value="${format?.nom || ''}" required>
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
        <button class="btn btn-primary" onclick="saveFormat('${id || ''}')">Enregistrer</button>
    `);
};

const saveFormat = (id) => {
    const form = document.getElementById('formatForm');
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
};

const deleteFormat = (id) => {
    const commandes = DB.get('commandes');
    const isUsedInCommandes = commandes.some(c => c.items.some(i => i.formatId === id));
    
    if (isUsedInCommandes) {
        alert('Impossible de supprimer ce format car il est utilisé dans des commandes. Vous pouvez le désactiver à la place.');
        return;
    }

    if (confirm('Êtes-vous sûr de vouloir supprimer ce format ?')) {
        const formats = DB.get('formats').filter(f => f.id !== id);
        DB.set('formats', formats);
        showToast('Format supprimé');
        renderParametres();
    }
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
    
    const ingredientsHtml = recette ? recette.ingredients.map((ing, idx) => `
        <div class="ingredient-row">
            <input type="text" name="ingredients[${idx}][nom]" value="${ing.nom}" placeholder="Ingrédient" required>
            <input type="number" name="ingredients[${idx}][quantite]" value="${ing.quantite}" placeholder="Qté" step="0.01" required>
            <input type="text" name="ingredients[${idx}][unite]" value="${ing.unite}" placeholder="Unité" required>
            <button type="button" class="btn btn-sm btn-danger" onclick="this.parentElement.remove()">×</button>
        </div>
    `).join('') : '<div class="ingredient-row"><input type="text" name="ingredients[0][nom]" placeholder="Ingrédient" required><input type="number" name="ingredients[0][quantite]" placeholder="Qté" step="0.01" required><input type="text" name="ingredients[0][unite]" placeholder="Unité" required><button type="button" class="btn btn-sm btn-danger" onclick="this.parentElement.remove()">×</button></div>';
    
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
                      }).map(a => `<option value="${a.id}" ${recette?.aromeId === a.id ? 'selected' : ''}>${a.nom}</option>`).join('')}
                </select>
                ${id ? '<input type="hidden" name="aromeId" value="' + recette.aromeId + '">' : ''}
            </div>
            <div class="form-group">
                <label>Ingrédients (pour 1 litre de cet arôme)</label>
                <div id="ingredientsContainer" style="display: flex; flex-direction: column; gap: 8px;">
                    ${ingredientsHtml}
                </div>
                <button type="button" class="btn btn-sm btn-secondary mt-4" onclick="addIngredient()">+ Ajouter ingrédient</button>
            </div>
        </form>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Annuler</button>
        <button class="btn btn-primary" onclick="saveRecette('${id || ''}')">Enregistrer</button>
    `);
};

const addIngredient = () => {
    const container = document.getElementById('ingredientsContainer');
    const index = container.querySelectorAll('.ingredient-row').length;
    
    const div = document.createElement('div');
    div.className = 'ingredient-row';
    div.style.display = 'flex';
    div.style.gap = '8px';
    div.innerHTML = `
        <input type="text" name="ingredients[${index}][nom]" placeholder="Ingrédient" required style="flex: 2;">
        <input type="number" name="ingredients[${index}][quantite]" placeholder="Qté" step="0.01" required style="flex: 1;">
        <input type="text" name="ingredients[${index}][unite]" placeholder="Unité" required style="flex: 1;">
        <button type="button" class="btn btn-sm btn-danger" onclick="this.parentElement.remove()">×</button>
    `;
    container.appendChild(div);
};

const saveRecette = (id) => {
    const form = document.getElementById('recetteForm');
    const formData = new FormData(form);
    
    const ingredients = [];
    const rows = document.querySelectorAll('.ingredient-row');
    rows.forEach((row, idx) => {
        const nom = row.querySelector(`input[name="ingredients[${idx}][nom]"]`)?.value || row.querySelector('[name*="nom"]')?.value;
        const quantite = row.querySelector(`input[name="ingredients[${idx}][quantite]"]`)?.value || row.querySelector('[name*="quantite"]')?.value;
        const unite = row.querySelector(`input[name="ingredients[${idx}][unite]"]`)?.value || row.querySelector('[name*="unite"]')?.value;
        
        if (nom && quantite && unite) {
            ingredients.push({ nom, quantite: parseFloat(quantite), unite });
        }
    });
    
    // Get aromeId from select or hidden input
    let aromeId = formData.get('aromeId');
    if (!aromeId) {
        const hiddenInput = form.querySelector('input[name="aromeId"][type="hidden"]');
        aromeId = hiddenInput?.value;
    }
    
    const recettes = DB.get('recettes');
    const arome = DB.get('aromes').find(a => a.id === aromeId);
    
    const recette = {
        id: id || generateId(),
        aromeId: aromeId,
        nom: arome ? arome.nom : 'Recette',
        ingredients
    };
    
    if (id) {
        const index = recettes.findIndex(r => r.id === id);
        recettes[index] = recette;
    } else {
        recettes.push(recette);
    }
    DB.set('recettes', recettes);
    
    modal.hide();
    showToast('Recette enregistrée');
    renderParametres();
};

const deleteRecette = (id) => {
    if (confirm('Êtes-vous sûr de vouloir supprimer cette recette ?')) {
        const recettes = DB.get('recettes').filter(r => r.id !== id);
        DB.set('recettes', recettes);
        showToast('Recette supprimée');
        renderParametres();
    }
};

// Settings - Clients
const showClientModal = (id = null) => {
    const clients = DB.get('clients');
    const client = id ? clients.find(c => c.id === id) : null;
    
    modal.show(id ? 'Modifier client' : 'Nouveau client', `
        <form id="clientForm">
            <div class="form-group">
                <label>Nom</label>
                <input type="text" name="nom" value="${client?.nom || ''}" required>
            </div>
            <div class="form-group">
                <label>Adresse</label>
                <input type="text" name="adresse" value="${client?.adresse || ''}">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Email</label>
                    <input type="email" name="email" value="${client?.email || ''}">
                </div>
                <div class="form-group">
                    <label>Téléphone</label>
                    <input type="tel" name="telephone" value="${client?.telephone || ''}">
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
        <button class="btn btn-primary" onclick="saveClient('${id || ''}')">Enregistrer</button>
    `);
};

const saveClient = (id) => {
    const form = document.getElementById('clientForm');
    const formData = new FormData(form);
    
    const client = {
        id: id || generateId(),
        nom: formData.get('nom'),
        adresse: formData.get('adresse'),
        email: formData.get('email'),
        telephone: formData.get('telephone'),
        actif: form.querySelector('input[name="actif"]').checked
    };
    
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
};

const deleteClient = (id) => {
    const commandes = DB.get('commandes');
    const isUsedInCommandes = commandes.some(c => c.clientId === id);
    
    if (isUsedInCommandes) {
        alert('Impossible de supprimer ce client car il a des commandes associées. Vous pouvez le désactiver à la place.');
        return;
    }

    if (confirm('Êtes-vous sûr de vouloir supprimer ce client ?')) {
        const clients = DB.get('clients').filter(c => c.id !== id);
        DB.set('clients', clients);
        showToast('Client supprimé');
        renderParametres();
    }
};

// Mobile menu toggle
document.getElementById('menuToggle')?.addEventListener('click', () => {
    document.querySelector('.sidebar').classList.toggle('open');
});

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    DB.init();
    initDefaultData();
    router();
});
