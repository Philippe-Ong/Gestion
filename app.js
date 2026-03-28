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

const getNextCommandeNumero = () => {
    let counter = parseInt(localStorage.getItem('thecol_compteur_commandes') || '0');
    counter++;
    localStorage.setItem('thecol_compteur_commandes', counter.toString());
    return counter.toString().padStart(5, '0');
};

const getCommandeNumero = (commande) => {
    return commande.numero || commande.id.slice(-5);
};

const getNextBLNumero = () => {
    let counter = parseInt(localStorage.getItem('thecol_compteur_bl') || '0');
    counter++;
    localStorage.setItem('thecol_compteur_bl', counter.toString());
    return counter.toString().padStart(5, '0');
};

const getBLNumero = (livraison) => {
    return livraison.numeroBL || livraison.id.slice(-5);
};

// Data Storage with Firebase sync
const DB = {
    firebaseSynced: false,
    
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
        // Sync to Firebase if available
        if (window.firebaseReady && window.firebaseDb) {
            DB.syncToFirebase(key, data);
        }
    },
    
    syncToFirebase: async (key, data) => {
        if (!window.firebaseReady || !window.firebaseDb) return;
        try {
            const { setDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
            await setDoc(doc(window.firebaseDb, 'data', key), { data: data, updatedAt: new Date().toISOString() });
        } catch(e) {
            console.error('Firebase sync error:', e);
        }
    },
    
    loadFromFirebase: async (showNotification = true) => {
        if (!window.firebaseReady || !window.firebaseDb) return;
        try {
            const { getDocs, collection } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
            const snapshot = await getDocs(collection(window.firebaseDb, 'data'));
            let hasData = false;
            snapshot.forEach(docSnap => {
                const key = docSnap.id;
                const cloudData = docSnap.data().data;
                if (cloudData && Array.isArray(cloudData) && cloudData.length > 0) {
                    localStorage.setItem('thecol_' + key, JSON.stringify(cloudData));
                    hasData = true;
                }
            });
            if (hasData) {
                DB.firebaseSynced = true;
                if (showNotification) showToast('Données synchronisées depuis le cloud');
            } else if (showNotification) {
                showToast('Aucune donnée dans le cloud');
            }
        } catch(e) {
            console.error('Firebase load error:', e);
        }
    },
    
    init: () => {
        const tables = ['employees', 'aromes', 'formats', 'recettes', 'clients', 'lots', 'commandes', 'pointages', 'inventaire'];
        tables.forEach(table => {
            if (!localStorage.getItem('thecol_' + table)) {
                localStorage.setItem('thecol_' + table, '[]');
            }
        });
    },
    
    // Sync from Firebase on page load
    initFromFirebase: async () => {
        if (!window.firebaseReady || !window.firebaseDb) return;
        await DB.loadFromFirebase();
    }
};

// Manual sync function
window.forceFirebaseSync = () => {
    DB.loadFromFirebase();
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
        livraisons: 'Livraisons',
        archives: 'Archives',
        production: 'Planificateur de production',
        inventaire: 'Inventaire',
        parametres: 'Paramètres'
    };
    document.getElementById('pageTitle').textContent = titles[page] || 'Dashboard';
    
    const views = {
        dashboard: renderDashboard,
        stock: renderStock,
        pointage: renderPointage,
        commandes: renderCommandes,
        livraisons: renderLivraisons,
        archives: renderArchives,
        production: renderProduction,
        inventaire: renderInventaire,
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
            <button class="flex items-center gap-2" style="background:none;border:none;cursor:pointer;font-size:16px;font-weight:500;color:var(--text);padding:10px 0;" onclick="toggleHistory()">
                <span id="historyArrow" style="font-size:12px;">▶</span> Historique de production
            </button>
            <div id="historyContent" style="display:none;margin-top:16px;">
                <div class="table-container" style="max-height:300px;overflow-y:auto;">
                    <table>
                        <thead>
                            <tr>
                                <th>Lot</th>
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
                <h3 class="card-title">Stock</h3>
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
        return '<tr><td colspan="7" class="text-center">Aucun historique</td></tr>';
    }
    return history.map(record => {
        const lotNum = record.lotId ? `#${String(record.lotId)}` : 'N/A';
        return `
        <tr>
            <td>${lotNum}</td>
            <td>${formatDate(record.productionDate)}</td>
            <td>${record.arome}</td>
            <td>${record.format}</td>
            <td style="color:var(--primary);font-weight:bold;">${record.quantity}</td>
            <td>${new Date(record.dateAdded).toLocaleDateString('fr-CH')}</td>
            <td><button class="btn btn-sm btn-danger" onclick="deleteHistoryRecord('${record.id}')">✕</button></td>
        </tr>
    `}).join('');
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
        lotId: newId,
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
    if (!aromes || aromes.length === 0) return '';
    
    const summary = aromes.filter(a => a && a.actif).map(arome => {
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
const renderPointage = (tab = 'pointage') => {
    const pointages = DB.get('pointages') || [];
    const employes = DB.get('employees') || [];
    const today = getLocalDateISOString();
    
    const currentTime = new Date().toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
    
    let html = `
        <div class="tabs">
            <button class="tab ${tab === 'pointage' ? 'active' : ''}" onclick="renderPointage('pointage')">Pointage</button>
            <button class="tab ${tab === 'historique' ? 'active' : ''}" onclick="renderPointage('historique')">Historique</button>
            <button class="tab ${tab === 'stats' ? 'active' : ''}" onclick="renderPointage('stats')">Stats</button>
            <button class="tab ${tab === 'employes' ? 'active' : ''}" onclick="renderPointage('employes')">Employés</button>
        </div>
    `;
    
    if (tab === 'pointage') {
        html += `
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
                <h3 class="card-title" style="margin-bottom: 16px;">Ajouter un pointage</h3>
                <form id="quickPointageForm">
                    <div class="form-row">
                        <div class="form-group">
                            <label>Employé</label>
                            <select name="employeId" required>
                                ${employes.filter(e => e.actif).length === 0 ? '<option value="">Aucun employé</option>' : 
                                  employes.filter(e => e.actif).map(e => `<option value="${e.id}">${e.prenom} ${e.nom}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Date</label>
                            <input type="date" name="date" value="${today}" required>
                        </div>
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
                        <input type="number" name="pause" value="0" min="0" style="max-width: 150px;">
                    </div>
                    <button type="button" class="btn btn-primary" onclick="saveQuickPointage()">Ajouter</button>
                </form>
            </div>
        `;
    } else if (tab === 'historique') {
        html += `
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Historique des pointages</h3>
                    <button class="btn btn-secondary" onclick="exportPointageExcel()">Exporter Excel</button>
                </div>
                
                <div class="filters">
                    <select id="filterEmploye" onchange="renderPointage('historique')">
                        <option value="">Tous les employés</option>
                        ${employes.filter(e => e.actif).map(e => `<option value="${e.id}">${e.prenom} ${e.nom}</option>`).join('')}
                    </select>
                    <input type="date" id="filterDateFrom" placeholder="Du" onchange="renderPointage('historique')">
                    <input type="date" id="filterDateTo" placeholder="Au" onchange="renderPointage('historique')">
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
                            ${renderHistoriqueTable(pointages, employes)}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    } else if (tab === 'stats') {
        const stats = getPointageStats(pointages, employes);
        html += `
            <div class="card">
                <h3 class="card-title" style="margin-bottom: 16px;">Statistiques</h3>
                <div class="form-row" style="margin-bottom: 20px;">
                    <div class="form-group">
                        <label>Employé</label>
                        <select id="statsEmploye" onchange="renderPointage('stats')">
                            <option value="">Tous</option>
                            ${employes.filter(e => e.actif).map(e => `<option value="${e.id}">${e.prenom} ${e.nom}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Période</label>
                        <select id="statsPeriod" onchange="renderPointage('stats')">
                            <option value="week">Semaine en cours</option>
                            <option value="month">Mois en cours</option>
                            <option value="year">Année en cours</option>
                        </select>
                    </div>
                </div>
                
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-icon green">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        </div>
                        <div class="stat-content">
                            <h3>${stats.totalHours}h</h3>
                            <p>Total heures</p>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon blue">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        </div>
                        <div class="stat-content">
                            <h3>${stats.daysWorked}</h3>
                            <p>Jours travaillés</p>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon orange">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                        </div>
                        <div class="stat-content">
                            <h3>${stats.avgHours}h</h3>
                            <p>Moyenne/jour</p>
                        </div>
                    </div>
                </div>
                
                ${stats.employeeStats.length > 0 ? `
                <div style="margin-top: 24px;">
                    <h4 style="margin-bottom: 12px;">Répartition par employé</h4>
                    <div class="bar-chart">
                        ${stats.employeeStats.map((emp, i) => `
                            <div class="bar-row">
                                <span class="bar-label">${emp.name}</span>
                                <div class="bar-container">
                                    <div class="bar" style="width: ${emp.percent}%; background: hsl(${i * 40}, 60%, 45%);"></div>
                                </div>
                                <span class="bar-value">${emp.hours}h</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                ` : ''}
            </div>
        `;
    } else if (tab === 'employes') {
        html += `
            <div class="card">
                <h3 class="card-title" style="margin-bottom: 16px;">Gérer les employés</h3>
                <div class="form-row" style="margin-bottom: 20px;">
                    <div class="form-group">
                        <label>Nouvel employé</label>
                        <input type="text" id="newEmployeeName" placeholder="Nom de l'employé">
                    </div>
                    <div class="form-group">
                        <label>Prénom</label>
                        <input type="text" id="newEmployeePrenom" placeholder="Prénom">
                    </div>
                    <div class="form-group form-group-btn-end">
                        <button class="btn btn-success" onclick="addNewEmployee()">Ajouter</button>
                    </div>
                </div>
                
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Nom</th>
                                <th>Prénom</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${employes.length === 0 ? '<tr><td colspan="4" class="text-center">Aucun employé</td></tr>' : 
                              employes.map(e => `
                                <tr>
                                    <td>${e.nom}</td>
                                    <td>${e.prenom}</td>
                                    <td><span class="badge ${e.actif ? 'badge-success' : 'badge-default'}">${e.actif ? 'Actif' : 'Inactif'}</span></td>
                                    <td>
                                        <button class="btn btn-sm btn-danger" onclick="deleteEmployee('${e.id}')">Supprimer</button>
                                    </td>
                                </tr>
                              `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }
    
    document.getElementById('content').innerHTML = html;
    
    // Update time every second if on pointage tab
    if (tab === 'pointage') {
        setInterval(() => {
            const timeEl = document.querySelector('.current-time');
            if (timeEl) {
                timeEl.textContent = new Date().toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
            }
        }, 1000);
    }
};

const renderHistoriqueTable = (pointages, employes) => {
    const filterEmploye = document.getElementById('filterEmploye')?.value || '';
    const filterDateFrom = document.getElementById('filterDateFrom')?.value || '';
    const filterDateTo = document.getElementById('filterDateTo')?.value || '';
    
    const filtered = pointages
        .filter(p => {
            if (filterEmploye && p.employeId !== filterEmploye) return false;
            if (filterDateFrom && p.date < filterDateFrom) return false;
            if (filterDateTo && p.date > filterDateTo) return false;
            return true;
        })
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    
    if (filtered.length === 0) {
        return '<tr><td colspan="7" class="text-center">Aucun pointage</td></tr>';
    }
    
    return filtered.map(p => {
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
                    <button class="btn btn-sm btn-danger" onclick="deletePointage('${p.id}')">Supprimer</button>
                </td>
            </tr>
        `;
    }).join('');
};

const getPointageStats = (pointages, employes) => {
    const statsEmploye = document.getElementById('statsEmploye')?.value || '';
    const statsPeriod = document.getElementById('statsPeriod')?.value || 'week';
    
    const now = new Date();
    let startDate, endDate;
    
    if (statsPeriod === 'week') {
        const day = now.getDay();
        const diff = now.getDate() - day + (day === 0 ? -6 : 1);
        startDate = new Date(now.getFullYear(), now.getMonth(), diff);
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);
    } else if (statsPeriod === 'month') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    } else {
        startDate = new Date(now.getFullYear(), 0, 1);
        endDate = new Date(now.getFullYear(), 11, 31);
    }
    
    const formatDateISO = (d) => {
        const offset = d.getTimezoneOffset();
        d.setMinutes(d.getMinutes() - offset);
        return d.toISOString().split('T')[0];
    };
    
    const startStr = formatDateISO(startDate);
    const endStr = formatDateISO(endDate);
    
    let filtered = pointages.filter(p => p.date >= startStr && p.date <= endStr && p.heureFin);
    
    if (statsEmploye) {
        filtered = filtered.filter(p => p.employeId === statsEmploye);
    }
    
    const totalMinutes = filtered.reduce((acc, p) => {
        if (!p.heureDebut || !p.heureFin) return acc;
        const [h1, m1] = p.heureDebut.split(':').map(Number);
        const [h2, m2] = p.heureFin.split(':').map(Number);
        return acc + ((h2 * 60 + m2) - (h1 * 60 + m1) - (p.pause || 0));
    }, 0);
    
    const totalHours = (totalMinutes / 60).toFixed(1);
    const daysWorked = new Set(filtered.map(p => p.date)).size;
    const avgHours = daysWorked > 0 ? (totalMinutes / 60 / daysWorked).toFixed(1) : 0;
    
    // Employee stats
    const empStats = {};
    filtered.forEach(p => {
        if (!empStats[p.employeId]) empStats[p.employeId] = 0;
        if (p.heureDebut && p.heureFin) {
            const [h1, m1] = p.heureDebut.split(':').map(Number);
            const [h2, m2] = p.heureFin.split(':').map(Number);
            empStats[p.employeId] += ((h2 * 60 + m2) - (h1 * 60 + m1) - (p.pause || 0)) / 60;
        }
    });
    
    const maxHours = Math.max(...Object.values(empStats), 1);
    const employeeStats = Object.entries(empStats).map(([id, hours]) => {
        const emp = employes.find(e => e.id === id);
        return {
            name: emp ? emp.prenom + ' ' + emp.nom : 'Inconnu',
            hours: hours.toFixed(1),
            percent: (hours / maxHours) * 100
        };
    }).sort((a, b) => parseFloat(b.hours) - parseFloat(a.hours));
    
    return { totalHours, daysWorked, avgHours, employeeStats };
};

const saveQuickPointage = () => {
    const form = document.getElementById('quickPointageForm');
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
    
    const pointages = DB.get('pointages') || [];
    const pointage = {
        id: generateId(),
        employeId,
        date,
        heureDebut,
        heureFin,
        pause
    };
    pointages.push(pointage);
    DB.set('pointages', pointages);
    
    form.reset();
    document.querySelector('#quickPointageForm input[name="date"]').value = getLocalDateISOString();
    showToast('Pointage ajouté');
    renderPointage('pointage');
};

const addNewEmployee = () => {
    const nom = document.getElementById('newEmployeeName').value.trim();
    const prenom = document.getElementById('newEmployeePrenom').value.trim();
    
    if (!nom || !prenom) {
        showToast('Veuillez entrer nom et prénom', 'error');
        return;
    }
    
    const employes = DB.get('employees') || [];
    employes.push({
        id: generateId(),
        nom,
        prenom,
        actif: true
    });
    DB.set('employees', employes);
    
    document.getElementById('newEmployeeName').value = '';
    document.getElementById('newEmployeePrenom').value = '';
    showToast('Employé ajouté');
    renderPointage('employes');
};

const deleteEmployee = (id) => {
    if (confirm('Supprimer cet employé ?')) {
        const employes = DB.get('employees').filter(e => e.id !== id);
        DB.set('employees', employes);
        showToast('Employé supprimé');
        renderPointage('employes');
    }
};

const exportPointageExcel = () => {
    const pointages = DB.get('pointages') || [];
    const employes = DB.get('employees') || [];
    const filterEmploye = document.getElementById('filterEmploye')?.value || '';
    const filterDateFrom = document.getElementById('filterDateFrom')?.value || '';
    const filterDateTo = document.getElementById('filterDateTo')?.value || '';
    
    const filtered = pointages
        .filter(p => {
            if (filterEmploye && p.employeId !== filterEmploye) return false;
            if (filterDateFrom && p.date < filterDateFrom) return false;
            if (filterDateTo && p.date > filterDateTo) return false;
            return true;
        })
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    
    // Create CSV content
    let csv = 'Date,Employé,Début,Fin,Pause,Durée\n';
    
    filtered.forEach(p => {
        const emp = employes.find(e => e.id === p.employeId);
        const empName = emp ? emp.prenom + ' ' + emp.nom : 'N/A';
        
        let totalMinutes = 0;
        if (p.heureDebut && p.heureFin) {
            const [h1, m1] = p.heureDebut.split(':').map(Number);
            const [h2, m2] = p.heureFin.split(':').map(Number);
            totalMinutes = (h2 * 60 + m2) - (h1 * 60 + m1) - (p.pause || 0);
        }
        const heures = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        const duree = totalMinutes > 0 ? `${heures}h ${mins}min` : '-';
        
        csv += `${p.date},${empName},${p.heureDebut || '-'},${p.heureFin || '-'},${p.pause || 0},${duree}\n`;
    });
    
    // Download CSV
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `pointages_${getLocalDateISOString()}.csv`;
    link.click();
    
    showToast('Exporté en CSV');
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
    const savedFilterClient = localStorage.getItem('thecol_filter_client') || '';
    const savedFilterStatut = localStorage.getItem('thecol_filter_statut') || '';
    const showArchives = localStorage.getItem('thecol_show_archives') === 'true';
    
    const allCommandes = DB.get('commandes') || [];
    const commandes = showArchives 
        ? allCommandes.filter(c => c.statut === 'livrée')
        : allCommandes.filter(c => c.statut !== 'livrée');
    const clients = DB.get('clients') || [];
    const aromes = DB.get('aromes') || [];
    const formats = DB.get('formats') || [];
    
    let html = `
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">${showArchives ? 'Archives' : 'Liste des commandes'}</h3>
                <div class="header-actions">
                    ${!showArchives ? `
                    <button class="btn btn-secondary" onclick="checkStockAndUpdateCommandes()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
                        Vérifier stock
                    </button>
                    ` : ''}
                    <button class="btn btn-secondary" onclick="toggleArchives()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>
                        ${showArchives ? '← Commandes' : 'Archives'}
                    </button>
                    ${!showArchives ? `
                    <button class="btn btn-primary" onclick="showCommandeModal()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        Nouvelle commande
                    </button>
                    ` : `
                    <button class="btn btn-secondary" onclick="exportArchivesExcel()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        Exporter Excel
                    </button>
                    `}
                </div>
            </div>
            
            ${!showArchives ? `
            <div class="filters">
                <select id="filterClient" onchange="localStorage.setItem('thecol_filter_client', this.value); renderCommandes()">
                    <option value="">Tous les clients</option>
                    ${clients.filter(c => c.actif).map(c => `<option value="${c.id}" ${savedFilterClient === c.id ? 'selected' : ''}>${c.societe || c.nom}</option>`).join('')}
                </select>
                <select id="filterStatut" onchange="localStorage.setItem('thecol_filter_statut', this.value); renderCommandes()">
                    <option value="">Tous les statuts</option>
                    <option value="en_attente" ${savedFilterStatut === 'en_attente' ? 'selected' : ''}>En attente</option>
                    <option value="produite" ${savedFilterStatut === 'produite' ? 'selected' : ''}>Produite</option>
                    <option value="livrée" ${savedFilterStatut === 'livrée' ? 'selected' : ''}>Livrée</option>
                    <option value="annulee" ${savedFilterStatut === 'annulee' ? 'selected' : ''}>Annulée</option>
                </select>
            </div>
            ` : ''}
            
            <div class="table-container" id="commandesTableContainer">
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
                                        <td>${getCommandeNumero(cmd)}</td>
                                        <td>${client?.societe || client?.nom || 'N/A'}</td>
                                        <td>${formatDate(cmd.dateCommande)}</td>
                                        <td>${formatDate(cmd.dateLivraison)}</td>
                                        <td>${articlesPreview}${cmd.items.length > 2 ? '...' : ''} (${totalItems})</td>
                                        <td class="status-cell">
                                            <span class="badge ${badgeClass} status-badge" onclick="showStatusDropdown(event, '${cmd.id}')">${cmd.statut}</span>
                                            <div class="status-dropdown" id="statusDropdown-${cmd.id}">
                                                <div class="status-option" onclick="updateCommandeStatut('${cmd.id}', 'en_attente')">En attente</div>
                                                <div class="status-option" onclick="updateCommandeStatut('${cmd.id}', 'produite')">Produite</div>
                                                <div class="status-option" onclick="updateCommandeStatut('${cmd.id}', 'livrée')">Livrée</div>
                                                <div class="status-option" onclick="updateCommandeStatut('${cmd.id}', 'annulee')">Annulée</div>
                                            </div>
                                        </td>
                                        <td class="actions-cell">
                                            <button class="btn btn-sm btn-secondary" onclick="showCommandeDetails('${cmd.id}')">Détails</button>
                                            ${cmd.statut === 'produite' ? `<button class="btn btn-sm btn-success" onclick="livrerCommande('${cmd.id}')">Livrer</button>` : ''}
                                            ${cmd.statut === 'livrée' ? `<button class="btn btn-sm btn-secondary" onclick="restaurerCommande('${cmd.id}')">Restaurer</button>` : ''}
                                            ${cmd.statut !== 'livrée' ? `<button class="btn btn-sm btn-secondary" onclick="editCommande('${cmd.id}')">Modifier</button>` : ''}
                                            <button class="btn btn-sm btn-danger" onclick="deleteCommande('${cmd.id}')">Supprimer</button>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                    </tbody>
                </table>
            </div>
            ${!showArchives ? '' : ''}
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
            <select name="aromeId" required>
                ${aromes.map(a => `<option value="${a.id}" ${item.aromeId === a.id ? 'selected' : ''}>${a.nom}</option>`).join('')}
            </select>
            <select name="formatId" required>
                ${formats.map(f => `<option value="${f.id}" ${item.formatId === f.id ? 'selected' : ''}>${f.nom}</option>`).join('')}
            </select>
            <input type="number" name="quantite" value="${item.quantite}" min="1" required>
            <button type="button" class="btn btn-sm btn-danger" onclick="this.parentElement.remove()">×</button>
        </div>
    `).join('') : '<div class="item-row"><select name="aromeId" required></select><select name="formatId" required></select><input type="number" name="quantite" value="1" min="1" required><button type="button" class="btn btn-sm btn-danger" onclick="this.parentElement.remove()">×</button></div>';
    
    // Populate arome options
    const aromeOptions = aromes.map(a => `<option value="${a.id}">${a.nom}</option>`).join('');
    const formatOptions = formats.map(f => `<option value="${f.id}">${f.nom}</option>`).join('');
    
    // Store options as JSON to avoid HTML escaping issues
    const aromeOptionsJson = JSON.stringify(aromes.map(a => ({ id: a.id, nom: a.nom })));
    const formatOptionsJson = JSON.stringify(formats.map(f => ({ id: f.id, nom: f.nom })));
    
    modal.show(id ? 'Modifier commande' : 'Nouvelle commande', `
        <form id="commandeForm">
            <div class="form-row">
                <div class="form-group">
                    <label>Client</label>
                    <select name="clientId" required>
                        ${clients.map(c => `<option value="${c.id}" ${commande?.clientId === c.id ? 'selected' : ''}>${c.societe || c.nom}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Date de livraison</label>
                    <input type="date" name="dateLivraison" value="${commande?.dateLivraison || ''}" required>
                </div>
            </div>
            <div class="form-group">
                <label>Articles</label>
                <div class="items-matrix-container">
                    <table class="items-matrix">
                        <thead>
                            <tr>
                                <th>Arome</th>
                                ${formats.map(f => `<th>${f.nom}</th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>
                            ${aromes.map(a => `
                                <tr>
                                    <td>${a.nom}</td>
                                    ${formats.map(f => {
                                        const item = commande?.items?.find(i => i.aromeId === a.id && i.formatId === f.id);
                                        const qty = item ? item.quantite : '';
                                        return `<td><input type="number" name="items[${a.id}][${f.id}]" value="${qty}" min="0" placeholder="0" class="item-qty-input"></td>`;
                                    }).join('')}
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
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
    
    // Set initial options in selects (for existing items that need options)
    const container = document.getElementById('itemsContainer');
    const aromesData = JSON.parse(container.dataset.aromes || '[]');
    const formatsData = JSON.parse(container.dataset.formats || '[]');
    const aromeOpts = aromesData.map(a => `<option value="${a.id}">${a.nom}</option>`).join('');
    const formatOpts = formatsData.map(f => `<option value="${f.id}">${f.nom}</option>`).join('');
    
    container.querySelectorAll('select[name="aromeId"]:not([value])').forEach(sel => {
        sel.innerHTML = aromeOpts;
    });
    container.querySelectorAll('select[name="formatId"]:not([value])').forEach(sel => {
        sel.innerHTML = formatOpts;
    });
};

const addItem = () => {
    const container = document.getElementById('itemsContainer');
    const aromes = JSON.parse(container.dataset.aromes || '[]');
    const formats = JSON.parse(container.dataset.formats || '[]');
    
    const aromeOptions = aromes.map(a => `<option value="${a.id}">${a.nom}</option>`).join('');
    const formatOptions = formats.map(f => `<option value="${f.id}">${f.nom}</option>`).join('');
    
    const div = document.createElement('div');
    div.className = 'item-row';
    div.innerHTML = `
        <select name="aromeId" required>${aromeOptions}</select>
        <select name="formatId" required>${formatOptions}</select>
        <input type="number" name="quantite" value="1" min="1" required>
        <button type="button" class="btn btn-sm btn-danger" onclick="this.parentElement.remove()">×</button>
    `;
    container.appendChild(div);
};

const saveCommande = (id) => {
    const form = document.getElementById('commandeForm');
    const formData = new FormData(form);
    
    const items = [];
    const qtyInputs = document.querySelectorAll('.item-qty-input');
    qtyInputs.forEach(input => {
        const qty = parseInt(input.value) || 0;
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
    
    const commande = {
        id: id || generateId(),
        numero: id ? DB.get('commandes').find(c => c.id === id)?.numero : getNextCommandeNumero(),
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

const showStatusDropdown = (event, id) => {
    event.stopPropagation();
    document.querySelectorAll('.status-dropdown.active').forEach(d => {
        if (d.id !== 'statusDropdown-' + id) d.classList.remove('active');
    });
    const dropdown = document.getElementById('statusDropdown-' + id);
    dropdown.classList.toggle('active');
};

const updateCommandeStatut = (id, statut) => {
    const commandes = DB.get('commandes');
    const index = commandes.findIndex(c => c.id === id);
    if (index !== -1) {
        commandes[index].statut = statut;
        DB.set('commandes', commandes);
        document.querySelectorAll('.status-dropdown.active').forEach(d => d.classList.remove('active'));
        renderCommandes();
    }
};

const livrerCommande = (id) => {
    const commandes = DB.get('commandes');
    let lots = DB.get('lots') || [];
    const aromes = DB.get('aromes');
    const formats = DB.get('formats');
    
    const cmdIndex = commandes.findIndex(c => c.id === id);
    if (cmdIndex === -1) return;
    
    const cmd = commandes[cmdIndex];
    
    // Normaliser les noms pour comparaison (minuscules, sans espaces)
    const normalize = (s) => (s || '').toString().toLowerCase().trim();
    
    // FIFO: trier lots par date de production (plus ancien primero)
    const sortedLots = [...lots].sort((a, b) => 
        new Date(a.dateProduction || '1970-01-01') - new Date(b.dateProduction || '1970-01-01')
    );
    
    let totalDeducted = 0;
    const lotsUtilises = [];
    
    cmd.items.forEach(item => {
        const arome = aromes.find(a => a.id === item.aromeId);
        const format = formats.find(f => f.id === item.formatId);
        const aromeNom = normalize(arome?.nom || item.aromeId);
        const formatNom = normalize(format?.nom || item.formatId);
        
        let qtyToDeduct = item.quantite;
        
        for (let lot of sortedLots) {
            if (normalize(lot.arome) === aromeNom && normalize(lot.format) === formatNom && lot.quantite > 0) {
                const qtyTaken = Math.min(lot.quantite, qtyToDeduct);
                lotsUtilises.push({
                    lotId: lot.id,
                    arome: lot.arome,
                    format: lot.format,
                    quantite: qtyTaken
                });
                
                lot.quantite -= qtyTaken;
                totalDeducted += qtyTaken;
                qtyToDeduct -= qtyTaken;
                
                if (qtyToDeduct <= 0) break;
            }
        }
    });
    
    // Mettre à jour les lots dans la base
    lots = sortedLots.map(l => l).filter(l => l.quantite > 0);
    DB.set('lots', lots);
    
    // Stocker les lots utilisés dans la commande
    commandes[cmdIndex].lotsUtilises = lotsUtilises;
    DB.set('commandes', commandes);
    
    // Mettre à jour le statut
    updateCommandeStatut(id, 'livrée');
    showToast(`Commande livrée - ${totalDeducted} bouteille(s) déduite(s) du stock`);
    
    // Proposer de générer un bulletin de livraison
    if (confirm('Générer un bulletin de livraison maintenant?')) {
        const livraison = generateBL(id);
        if (livraison) {
            showToast(`BL-${getBLNumero(livraison)} créé`);
            exportBLExcel(livraison.id);
        }
    }
};

const archiverCommande = (id) => {
    if (confirm('Archiver cette commande? Elle sera déplacée vers les archives.')) {
        showToast('Commande archivée');
        renderCommandes();
    }
};

const restaurerCommande = (id) => {
    if (confirm('Restaurer cette commande? Elle redeviendra "produite".')) {
        updateCommandeStatut(id, 'produite');
        showToast('Commande restaurée');
    }
};

document.addEventListener('click', () => {
    document.querySelectorAll('.status-dropdown.active').forEach(d => d.classList.remove('active'));
});

const checkStockAndUpdateCommandes = () => {
    const commandes = DB.get('commandes');
    const lots = DB.get('lots') || [];
    const formats = DB.get('formats');
    const aromes = DB.get('aromes');
    const now = new Date();
    
    const stockDisponible = {};
    lots.filter(lot => {
        if (!lot.dlc) return true;
        return new Date(lot.dlc) >= now;
    }).forEach(lot => {
        const key = `${lot.arome}-${lot.format}`;
        if (!stockDisponible[key]) {
            stockDisponible[key] = 0;
        }
        stockDisponible[key] += lot.quantite || 0;
    });
    
    let updatedCount = 0;
    const updatedCommandes = commandes.map(cmd => {
        if (cmd.statut !== 'en_attente') return cmd;
        
        const needed = {};
        cmd.items.forEach(item => {
            const format = formats.find(f => f.id === item.formatId);
            const arome = aromes.find(a => a.id === item.aromeId);
            const aromeName = arome?.nom || item.aromeId;
            const formatName = format?.nom || item.formatId;
            const key = `${aromeName}-${formatName}`;
            if (!needed[key]) needed[key] = 0;
            needed[key] += item.quantite;
        });
        
        let canProduce = true;
        Object.entries(needed).forEach(([key, qty]) => {
            const disponible = stockDisponible[key] || 0;
            if (disponible < qty) canProduce = false;
        });
        
        if (canProduce) {
            updatedCount++;
            return { ...cmd, statut: 'produite' };
        }
        return cmd;
    });
    
    DB.set('commandes', updatedCommandes);
    renderCommandes();
    
    if (updatedCount > 0) {
        showToast(`${updatedCount} commande(s) mise(s) en production`);
    } else {
        showToast('Aucune commande à mettre en production');
    }
};

const showCommandeDetails = (id) => {
    const commandes = DB.get('commandes');
    const clients = DB.get('clients');
    const aromes = DB.get('aromes');
    const formats = DB.get('formats');
    
    const commande = commandes.find(c => c.id === id);
    if (!commande) return;
    
    const client = clients.find(c => c.id === commande.clientId);
    const clientName = client ? (client.societe || client.nom) : 'N/A';
    
    const itemsHtml = commande.items.map(item => {
        const arome = aromes.find(a => a.id === item.aromeId);
        const format = formats.find(f => f.id === item.formatId);
        return `<tr>
            <td>${arome?.nom || '?'}</td>
            <td>${format?.nom || '?'}</td>
            <td>${item.quantite}</td>
        </tr>`;
    }).join('');
    
    const lotsUtilisesHtml = commande.lotsUtilises && commande.lotsUtilises.length > 0 
        ? commande.lotsUtilises.map(lot => `
            <tr>
                <td>#${String(lot.lotId).slice(-6)}</td>
                <td>${lot.arome}</td>
                <td>${lot.format}</td>
                <td>${lot.quantite}</td>
            </tr>
        `).join('')
        : '';
    
    const livraisons = DB.get('livraisons') || [];
    const livraison = livraisons.find(l => l.commandeId === id);
    
    const totalItems = commande.items.reduce((sum, i) => sum + i.quantite, 0);
    
    modal.show(`Commande #${getCommandeNumero(commande)}`, `
        <div class="commande-details">
            <p><strong>Client:</strong> ${clientName}</p>
            <p><strong>Date commande:</strong> ${formatDate(commande.dateCommande)}</p>
            <p><strong>Date livraison:</strong> ${formatDate(commande.dateLivraison)}</p>
            <p><strong>Statut:</strong> ${commande.statut}</p>
            <p><strong>Total:</strong> ${totalItems} articles</p>
            <table class="details-table">
                <thead>
                    <tr>
                        <th>Arôme</th>
                        <th>Format</th>
                        <th>Quantité</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHtml}
                </tbody>
            </table>
            ${lotsUtilisesHtml ? `
            <h4 style="margin-top:20px;">Lots utilisés</h4>
            <table class="details-table">
                <thead>
                    <tr>
                        <th>Lot</th>
                        <th>Arôme</th>
                        <th>Format</th>
                        <th>Quantité</th>
                    </tr>
                </thead>
                <tbody>
                    ${lotsUtilisesHtml}
                </tbody>
            </table>
            ` : ''}
        </div>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Fermer</button>
    `);
};

const deleteCommande = (id) => {
    if (confirm('Êtes-vous sûr de vouloir supprimer cette commande ?')) {
        const commandes = DB.get('commandes').filter(c => c.id !== id);
        DB.set('commandes', commandes);
        showToast('Commande supprimée');
        renderCommandes();
    }
};

const toggleArchives = () => {
    const showArchives = localStorage.getItem('thecol_show_archives') === 'true';
    localStorage.setItem('thecol_show_archives', showArchives ? 'false' : 'true');
    renderCommandes();
};

// Archives
const renderArchives = () => {
    const savedFilterYear = localStorage.getItem('thecol_filter_archive_year') || '';
    const savedFilterClient = localStorage.getItem('thecol_filter_archive_client') || '';
    
    const commandes = DB.get('commandes').filter(c => c.statut === 'livrée');
    const clients = DB.get('clients') || [];
    const aromes = DB.get('aromes') || [];
    const formats = DB.get('formats') || [];
    
    const years = [...new Set(commandes.map(c => c.dateCommande ? c.dateCommande.substring(0, 4) : '2024'))].sort().reverse();
    
    const filteredCommandes = commandes.filter(c => {
        const year = c.dateCommande ? c.dateCommande.substring(0, 4) : '2024';
        const matchesYear = !savedFilterYear || year === savedFilterYear;
        const matchesClient = !savedFilterClient || c.clientId === savedFilterClient;
        return matchesYear && matchesClient;
    });
    
    let html = `
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Archives des commandes</h3>
                <button class="btn btn-secondary" onclick="exportArchivesExcel()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Exporter Excel
                </button>
            </div>
            
            <div class="filters">
                <select id="filterArchiveYear" onchange="localStorage.setItem('thecol_filter_archive_year', this.value); renderArchives()">
                    <option value="">Toutes les années</option>
                    ${years.map(y => `<option value="${y}" ${savedFilterYear === y ? 'selected' : ''}>${y}</option>`).join('')}
                </select>
                <select id="filterArchiveClient" onchange="localStorage.setItem('thecol_filter_archive_client', this.value); renderArchives()">
                    <option value="">Tous les clients</option>
                    ${clients.filter(c => c.actif).map(c => `<option value="${c.id}" ${savedFilterClient === c.id ? 'selected' : ''}>${c.societe || c.nom}</option>`).join('')}
                </select>
            </div>
            
            <div class="table-container" id="archivesTableContainer">
                <table>
                    <thead>
                        <tr>
                            <th>N°</th>
                            <th>Client</th>
                            <th>Date commande</th>
                            <th>Date livraison</th>
                            <th>Articles</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filteredCommandes.length === 0 ? '<tr><td colspan="6" class="text-center">Aucune commande archivée</td></tr>' : 
                          filteredCommandes.sort((a, b) => new Date(b.dateCommande) - new Date(a.dateCommande))
                            .map(cmd => {
                                const client = clients.find(cl => cl.id === cmd.clientId);
                                const totalItems = cmd.items.reduce((sum, i) => sum + i.quantite, 0);
                                const articlesPreview = cmd.items.slice(0, 2).map(i => {
                                    const a = aromes.find(a => a.id === i.aromeId);
                                    const f = formats.find(f => f.id === i.formatId);
                                    return `${i.quantite}x ${a?.nom || '?'} ${f?.nom || '?'}`;
                                }).join(', ');
                                
                                return `
                                    <tr>
                                        <td>${getCommandeNumero(cmd)}</td>
                                        <td>${client?.societe || client?.nom || 'N/A'}</td>
                                        <td>${formatDate(cmd.dateCommande)}</td>
                                        <td>${formatDate(cmd.dateLivraison)}</td>
                                        <td>${articlesPreview}${cmd.items.length > 2 ? '...' : ''} (${totalItems})</td>
                                        <td>
                                            <button class="btn btn-sm btn-secondary" onclick="showCommandeDetails('${cmd.id}')">Détails</button>
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

const exportArchivesExcel = () => {
    const commandes = DB.get('commandes').filter(c => c.statut === 'livrée');
    const clients = DB.get('clients');
    const aromes = DB.get('aromes');
    const formats = DB.get('formats');
    
    const data = commandes.map(cmd => {
        const client = clients.find(c => c.id === cmd.clientId);
        const items = cmd.items.map(item => {
            const a = aromes.find(a => a.id === item.aromeId);
            const f = formats.find(f => f.id === item.formatId);
            return `${item.quantite}x ${a?.nom || '?'} ${f?.nom || '?'}`;
        }).join(', ');
        
        return {
            'N°': getCommandeNumero(cmd),
            'Client': client?.societe || client?.nom || 'N/A',
            'Date commande': cmd.dateCommande,
            'Date livraison': cmd.dateLivraison,
            'Articles': items,
            'Total': cmd.items.reduce((sum, i) => sum + i.quantite, 0)
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

// Livraisons / Bulletins de Livraison
const renderLivraisons = () => {
    const livraisons = DB.get('livraisons') || [];
    const commandes = DB.get('commandes') || [];
    const clients = DB.get('clients') || [];
    const aromes = DB.get('aromes') || [];
    const formats = DB.get('formats') || [];
    
    const savedFilterYear = localStorage.getItem('thecol_filter_livraison_year') || '';
    const savedFilterClient = localStorage.getItem('thecol_filter_livraison_client') || '';
    
    const years = [...new Set(livraisons.map(l => l.dateBL ? l.dateBL.substring(0, 4) : '2024'))].sort().reverse();
    
    const filteredLivraisons = livraisons.filter(l => {
        const year = l.dateBL ? l.dateBL.substring(0, 4) : '2024';
        const matchesYear = !savedFilterYear || year === savedFilterYear;
        const matchesClient = !savedFilterClient || l.clientId === savedFilterClient;
        return matchesYear && matchesClient;
    });
    
    let html = `
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Bulletins de Livraison</h3>
            </div>
            
            <div class="filters">
                <select id="filterLivraisonYear" onchange="localStorage.setItem('thecol_filter_livraison_year', this.value); renderLivraisons()">
                    <option value="">Toutes les années</option>
                    ${years.map(y => `<option value="${y}" ${savedFilterYear === y ? 'selected' : ''}>${y}</option>`).join('')}
                </select>
                <select id="filterLivraisonClient" onchange="localStorage.setItem('thecol_filter_livraison_client', this.value); renderLivraisons()">
                    <option value="">Tous les clients</option>
                    ${clients.filter(c => c.actif).map(c => `<option value="${c.id}" ${savedFilterClient === c.id ? 'selected' : ''}>${c.societe || c.nom}</option>`).join('')}
                </select>
            </div>
            
            <div class="table-container" id="livraisonsTableContainer">
                <table>
                    <thead>
                        <tr>
                            <th>N° BL</th>
                            <th>N° Commande</th>
                            <th>Client</th>
                            <th>Date BL</th>
                            <th>Articles</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filteredLivraisons.length === 0 ? '<tr><td colspan="6" class="text-center">Aucun bulletin de livraison</td></tr>' : 
                          filteredLivraisons.sort((a, b) => new Date(b.dateBL) - new Date(a.dateBL))
                            .map(liv => {
                                const commande = commandes.find(c => c.id === liv.commandeId);
                                const client = clients.find(cl => cl.id === liv.clientId);
                                const totalItems = liv.lignes.reduce((sum, l) => sum + l.quantite, 0);
                                const articlesPreview = liv.lignes.slice(0, 2).map(l => {
                                    const a = aromes.find(a => a.id === l.aromeId);
                                    const f = formats.find(f => f.id === l.formatId);
                                    return `${l.quantite}x ${a?.nom || '?'} ${f?.nom || '?'}`;
                                }).join(', ');
                                
                                return `
                                    <tr>
                                        <td>BL-${getBLNumero(liv)}</td>
                                        <td>#${commande ? getCommandeNumero(commande) : liv.commandeId.slice(-5)}</td>
                                        <td>${client?.societe || client?.nom || 'N/A'}</td>
                                        <td>${formatDate(liv.dateBL)}</td>
                                        <td>${articlesPreview}${liv.lignes.length > 2 ? '...' : ''} (${totalItems})</td>
                                        <td>
                                            <button class="btn btn-sm btn-secondary" onclick="showLivraisonDetails('${liv.id}')">Détails</button>
                                            <button class="btn btn-sm btn-primary" onclick="exportBLExcel('${liv.id}')">Export Excel</button>
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
    
    const lignesHtml = livraison.lignes.map(l => {
        const a = aromes.find(a => a.id === l.aromeId);
        const f = formats.find(f => f.id === l.formatId);
        return `<tr>
            <td>${a?.nom || '?'}</td>
            <td>${f?.nom || '?'}</td>
            <td>${l.quantite}</td>
        </tr>`;
    }).join('');
    
    const totalItems = livraison.lignes.reduce((sum, l) => sum + l.quantite, 0);
    
    modal.show(`BL #${getBLNumero(livraison)}`, `
        <div class="commande-details">
            <p><strong>Client:</strong> ${client?.societe || client?.nom || 'N/A'}</p>
            <p><strong>Date BL:</strong> ${formatDate(livraison.dateBL)}</p>
            <p><strong>N° Commande:</strong> #${commande ? getCommandeNumero(commande) : livraison.commandeId.slice(-5)}</p>
            <p><strong>Total:</strong> ${totalItems} articles</p>
            <table class="details-table">
                <thead>
                    <tr>
                        <th>Arôme</th>
                        <th>Format</th>
                        <th>Quantité</th>
                    </tr>
                </thead>
                <tbody>
                    ${lignesHtml}
                </tbody>
            </table>
        </div>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Fermer</button>
        <button class="btn btn-primary" onclick="exportBLExcel('${id}')">Export Excel</button>
    `);
};

const AROME_BL_NAMES = {
    'mure sauvage': 'Mûres Sauvages',
    'poire a botzi': 'Poire à Botzi',
    'poire à botzi': 'Poire à Botzi',
    'herbes des alpes': 'Herbes des Alpes',
    'sureau': 'Sureau',
    'hibiscus': 'Hibiscus',
    'coing': 'Coing',
    'edition noel': 'Edition Noël',
    'edition noel': 'Edition Noël',
    'menthe': 'Menthe',
    'menthe ': 'Menthe'
};

const getAromeBLName = (nom) => {
    if (!nom) return nom;
    const lower = nom.toLowerCase().trim();
    return AROME_BL_NAMES[lower] || nom;
};

const generateBL = (commandeId) => {
    const commandes = DB.get('commandes') || [];
    const aromes = DB.get('aromes') || [];
    const formats = DB.get('formats') || [];
    
    const commande = commandes.find(c => c.id === commandeId);
    if (!commande) {
        showToast('Commande non trouvée', 'error');
        return null;
    }
    
    const lignes = commande.items.filter(item => item.quantite > 0).map(item => {
        const a = aromes.find(ar => ar.id === item.aromeId);
        const f = formats.find(fmt => fmt.id === item.formatId);
        return {
            aromeId: item.aromeId,
            aromeNom: getAromeBLName(a?.nom) || item.aromeId,
            formatId: item.formatId,
            formatNom: f ? f.contenanceCl + ' cl' : item.formatId,
            quantite: item.quantite
        };
    });
    
    const livraison = {
        id: generateId(),
        numeroBL: getNextBLNumero(),
        commandeId: commandeId,
        clientId: commande.clientId,
        dateBL: getLocalDateISOString(),
        lignes: lignes,
        retours: [],
        facturationMode: '',
        notes: '',
        signatureNom: ''
    };
    
    const livraisons = DB.get('livraisons') || [];
    livraisons.push(livraison);
    DB.set('livraisons', livraisons);
    
    return livraison;
};

const exportBLExcel = (livraisonId) => {
    const livraisons = DB.get('livraisons') || [];
    const clients = DB.get('clients') || [];
    const formats = DB.get('formats') || [];

    const livraison = livraisons.find(l => l.id === livraisonId);
    if (!livraison) {
        showToast('Livraison non trouvée', 'error');
        return;
    }

    const client = clients.find(c => c.id === livraison.clientId);

    const lignesFiltered = livraison.lignes.filter(l => l.quantite > 0);
    if (lignesFiltered.length === 0) {
        showToast('Aucun article à livrer', 'warning');
        return;
    }

    const merged = {};
    lignesFiltered.forEach(l => {
        const fmt = formats.find(f => f.id === l.formatId);
        if (!fmt) return;
        const fmtLabel = fmt.contenanceCl + ' cl';
        const key = `${l.aromeNom || ''}|${fmtLabel}`;
        merged[key] = { aromeNom: l.aromeNom, formatNom: fmtLabel, quantite: l.quantite };
    });

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
                    const parser = new DOMParser();
                    const ssDoc = parser.parseFromString(ssXml, 'text/xml');
                    const siEls = ssDoc.getElementsByTagName('si');
                    for (let i = 0; i < siEls.length; i++) {
                        const t = siEls[i].getElementsByTagName('t')[0];
                        ssStrings.push(t ? t.textContent : '');
                    }
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

                const parser = new DOMParser();
                const sheetDoc = parser.parseFromString(sheetXml, 'text/xml');
                const allRows = sheetDoc.getElementsByTagName('row');

                const blNum = `BL-${getBLNumero(livraison)}`;
                const blDate = livraison.dateBL;
                const clientName = client ? (client.societe || client.nom || '') : '';
                const clientAdresse = client ? (client.adresse || '') : '';
                const clientLocalite = client ? (`${client.npa || ''} ${client.localite || ''}`.trim()) : '';

                for (let i = 0; i < allRows.length; i++) {
                    const row = allRows[i];
                    const rowNum = parseInt(row.getAttribute('r'));

                    if (rowNum >= 15 && rowNum <= 44) {
                        const cells = row.getElementsByTagName('c');
                        let cellA = null, cellC = null, cellD = null;
                        for (let c = 0; c < cells.length; c++) {
                            const ref = cells[c].getAttribute('r');
                            if (ref === `A${rowNum}`) cellA = cells[c];
                            if (ref === `C${rowNum}`) cellC = cells[c];
                            if (ref === `D${rowNum}`) cellD = cells[c];
                        }

                        if (cellA && cellC && cellD) {
                            const vC = cellC.getElementsByTagName('v')[0];
                            const vD = cellD.getElementsByTagName('v')[0];
                            if (vC && vD) {
                                const aromeIdx = parseInt(vC.textContent);
                                const formatIdx = parseInt(vD.textContent);
                                const aromeName = ssStrings[aromeIdx] || '';
                                const formatName = ssStrings[formatIdx] || '';

                                let matched = false;
                                for (const item of Object.values(merged)) {
                                    if (item.aromeNom.trim().toLowerCase() === aromeName.trim().toLowerCase() &&
                                        item.formatNom.trim().toLowerCase() === formatName.trim().toLowerCase()) {
                                        const vA = cellA.getElementsByTagName('v')[0];
                                        if (vA) vA.textContent = item.quantite;
                                        matched = true;
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    if (rowNum === 3) {
                        const cells = row.getElementsByTagName('c');
                        let cellE = null;
                        for (let c = 0; c < cells.length; c++) {
                            if (cells[c].getAttribute('r') === 'E3') { cellE = cells[c]; break; }
                        }
                        if (cellE) {
                            const newIdx = getOrAddSS(blNum);
                            cellE.setAttribute('t', 's');
                            const vEl = cellE.getElementsByTagName('v')[0];
                            if (vEl) vEl.textContent = newIdx; else {
                                const v = sheetDoc.createElement('v');
                                v.textContent = newIdx;
                                cellE.appendChild(v);
                            }
                        }
                    }

                    if (rowNum === 5) {
                        const cells = row.getElementsByTagName('c');
                        let cellF = null;
                        for (let c = 0; c < cells.length; c++) {
                            if (cells[c].getAttribute('r') === 'F5') { cellF = cells[c]; break; }
                        }
                        if (cellF) {
                            const newIdx = getOrAddSS(blDate);
                            cellF.setAttribute('t', 's');
                            const vEl = cellF.getElementsByTagName('v')[0];
                            if (vEl) vEl.textContent = newIdx; else {
                                const v = sheetDoc.createElement('v');
                                v.textContent = newIdx;
                                cellF.appendChild(v);
                            }
                        }
                    }

                    if (rowNum === 7 && clientName) {
                        const cells = row.getElementsByTagName('c');
                        let cellF = null;
                        for (let c = 0; c < cells.length; c++) {
                            if (cells[c].getAttribute('r') === 'F7') { cellF = cells[c]; break; }
                        }
                        if (cellF) {
                            const newIdx = getOrAddSS(clientName);
                            cellF.setAttribute('t', 's');
                            const vEl = cellF.getElementsByTagName('v')[0];
                            if (vEl) vEl.textContent = newIdx; else {
                                const v = sheetDoc.createElement('v');
                                v.textContent = newIdx;
                                cellF.appendChild(v);
                            }
                        }
                    }

                    if (rowNum === 8 && clientAdresse) {
                        const cells = row.getElementsByTagName('c');
                        let cellF = null;
                        for (let c = 0; c < cells.length; c++) {
                            if (cells[c].getAttribute('r') === 'F8') { cellF = cells[c]; break; }
                        }
                        if (cellF) {
                            const newIdx = getOrAddSS(clientAdresse);
                            cellF.setAttribute('t', 's');
                            const vEl = cellF.getElementsByTagName('v')[0];
                            if (vEl) vEl.textContent = newIdx; else {
                                const v = sheetDoc.createElement('v');
                                v.textContent = newIdx;
                                cellF.appendChild(v);
                            }
                        }
                    }

                    if (rowNum === 9 && clientLocalite) {
                        const cells = row.getElementsByTagName('c');
                        let cellF = null;
                        for (let c = 0; c < cells.length; c++) {
                            if (cells[c].getAttribute('r') === 'F9') { cellF = cells[c]; break; }
                        }
                        if (cellF) {
                            const newIdx = getOrAddSS(clientLocalite);
                            cellF.setAttribute('t', 's');
                            const vEl = cellF.getElementsByTagName('v')[0];
                            if (vEl) vEl.textContent = newIdx; else {
                                const v = sheetDoc.createElement('v');
                                v.textContent = newIdx;
                                cellF.appendChild(v);
                            }
                        }
                    }

                    if (rowNum >= 47 && rowNum <= 49 && livraison.facturationMode) {
                        const expectedMode = rowNum === 47 ? 'email' : rowNum === 48 ? 'poste' : 'autre';
                        if (livraison.facturationMode === expectedMode) {
                            const cells = row.getElementsByTagName('c');
                            let cellD = null;
                            for (let c = 0; c < cells.length; c++) {
                                if (cells[c].getAttribute('r') === `D${rowNum}`) { cellD = cells[c]; break; }
                            }
                            if (cellD) {
                                const newIdx = getOrAddSS('☑');
                                cellD.setAttribute('t', 's');
                                const vEl = cellD.getElementsByTagName('v')[0];
                                if (vEl) vEl.textContent = newIdx; else {
                                    const v = sheetDoc.createElement('v');
                                    v.textContent = newIdx;
                                    cellD.appendChild(v);
                                }
                            }
                        }
                    }
                }

                let newSheetXml = new XMLSerializer().serializeToString(sheetDoc);

                if (ssModified) {
                    let ssContent = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
                    ssContent += `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${ssStrings.length}" uniqueCount="${ssStrings.length}">`;
                    ssStrings.forEach(s => {
                        const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                        ssContent += `<si><t xml:space="preserve">${esc}</t></si>`;
                    });
                    ssContent += '</sst>';
                    zip.file('xl/sharedStrings.xml', ssContent);
                }

                zip.file('xl/worksheets/sheet1.xml', newSheetXml);

                zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }).then(blob => {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `BL-${getBLNumero(livraison)}_${livraison.dateBL}.xlsx`;
                    a.click();
                    URL.revokeObjectURL(url);
                    showToast('Bulletin de livraison exporté');
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

// Production Planner
const renderProduction = () => {
    const commandes = DB.get('commandes');
    const aromes = DB.get('aromes');
    const formats = DB.get('formats');
    const recettes = DB.get('recettes');
    const lots = DB.get('lots') || [];
    
    // All non-cancelled, non-delivered orders
    const commandesPeriode = commandes.filter(c => 
        c.statut !== 'annulee' &&
        c.statut !== 'livrée'
    );
    
    // Calculate available stock (non-expired) - using arome/format names
    const now = new Date();
    const stockDisponible = {};
    lots.filter(lot => {
        if (!lot.dlc) return true;
        return new Date(lot.dlc) >= now;
    }).forEach(lot => {
        const key = `${lot.arome}-${lot.format}`;
        if (!stockDisponible[key]) {
            stockDisponible[key] = 0;
        }
        stockDisponible[key] += lot.quantite || 0;
    });
    
    // Calculate totals by arome and format (using names from commands)
    const besoins = {};
    
    commandesPeriode.forEach(cmd => {
        cmd.items.forEach(item => {
            const arome = aromes.find(a => a.id === item.aromeId);
            const format = formats.find(f => f.id === item.formatId);
            const key = `${arome?.nom || ''}-${format?.nom || ''}`;
            if (!besoins[key]) {
                besoins[key] = { aromeId: item.aromeId, formatId: item.formatId, aromeNom: arome?.nom || '', formatNom: format?.nom || '', quantite: 0 };
            }
            besoins[key].quantite += item.quantite;
        });
    });
    
    // Calculate production needed (total - available stock)
    const productionNecesaire = {};
    Object.entries(besoins).forEach(([key, b]) => {
        const disponible = stockDisponible[key] || 0;
        const aProduire = Math.max(0, b.quantite - disponible);
        productionNecesaire[key] = { ...b, disponible, aProduire };
    });
    
    // Calculate liters per arome (for production needed only)
    const litresParArome = {};
    Object.values(productionNecesaire).filter(b => b.aProduire > 0).forEach(b => {
        const format = formats.find(f => f.nom === b.formatNom);
        const litres = (format?.contenanceCl || 0) * b.aProduire / 100;
        if (!litresParArome[b.aromeNom]) litresParArome[b.aromeNom] = 0;
        litresParArome[b.aromeNom] += litres;
    });
    
    // Calculate ingredients needed (for total display)
    const ingredientsTotal = {};
    Object.entries(litresParArome).forEach(([aromeNom, litres]) => {
        const arome = aromes.find(a => a.nom === aromeNom);
        const recette = recettes.find(r => r.aromeId === arome?.id);
        if (recette) {
            recette.ingredients.forEach(ing => {
                const besoin = ing.quantite * litres;
                if (!ingredientsTotal[ing.nom]) ingredientsTotal[ing.nom] = { quantite: 0, unite: ing.unite };
                ingredientsTotal[ing.nom].quantite += besoin;
            });
        }
    });
    
    // Calculate cuves per arome (max 25L per cuve)
    const CUVE_MAX = 25;
    const cuvesParArome = {};
    
    Object.entries(litresParArome).forEach(([aromeNom, litresTotal]) => {
        const nombreCuves = Math.ceil(litresTotal / CUVE_MAX);
        cuvesParArome[aromeNom] = [];
        
        let litresRestants = litresTotal;
        for (let i = 0; i < nombreCuves; i++) {
            const litresCuve = Math.min(litresRestants, CUVE_MAX);
            
            const arome = aromes.find(a => a.nom === aromeNom);
            const recette = recettes.find(r => r.aromeId === arome?.id);
            const ingredientsCuve = [];
            
            if (recette) {
                recette.ingredients.forEach(ing => {
                    ingredientsCuve.push({
                        nom: ing.nom,
                        quantite: (ing.quantite * litresCuve).toFixed(2),
                        unite: ing.unite
                    });
                });
            }
            
            cuvesParArome[aromeNom].push({
                numero: i + 1,
                litres: litresCuve,
                ingredients: ingredientsCuve
            });
            
            litresRestants -= litresCuve;
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
                ${Object.values(productionNecesaire).length === 0 ? '<p class="text-muted">Aucune commande</p>' : 
                  Object.values(productionNecesaire).map(b => {
                      const arome = aromes.find(a => a.nom === b.aromeNom);
                      return `<div class="flex-between" style="padding: 8px 0; border-bottom: 1px solid var(--border-light);">
                          <span><span class="color-dot" style="background: ${arome?.couleur || '#ccc'}"></span>${b.aromeNom} ${b.formatNom}</span>
                          <div style="text-align: right;">
                              <div style="font-size: 12px; color: var(--text-muted);">Stock: ${b.disponible} bt</div>
                              <strong>À produire: ${b.aProduire} bt</strong>
                          </div>
                      </div>`;
                  }).join('')}
            </div>
            
            <div class="production-item">
                <h4>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M20.2 7.8l-7.7 7.7-4-4-5.7 5.7"/></svg>
                    Litres à produire (par arôme)
                </h4>
                ${Object.entries(litresParArome).length === 0 ? '<p class="text-muted">Tout le stock est disponible</p>' : 
                  Object.entries(litresParArome).map(([aromeNom, litres]) => {
                      const arome = aromes.find(a => a.nom === aromeNom);
                      return `<div class="flex-between" style="padding: 8px 0; border-bottom: 1px solid var(--border-light);">
                          <span><span class="color-dot" style="background: ${arome?.couleur || '#ccc'}"></span>${aromeNom}</span>
                          <strong>${litres.toFixed(1)} L</strong>
                      </div>`;
                  }).join('')}
            </div>
            
            <div class="production-item" style="grid-column: 1 / -1;">
                <h4>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                    Production par cuves (max 25L)
                </h4>
                ${Object.entries(cuvesParArome).length === 0 ? '<p class="text-muted">Tout le stock est disponible</p>' : 
                  Object.entries(cuvesParArome).map(([aromeNom, cuves]) => {
                      const arome = aromes.find(a => a.nom === aromeNom);
                      const totalLitres = cuves.reduce((sum, c) => sum + c.litres, 0);
                      return `
                        <div class="cuve-arome">
                          <div class="cuve-header">
                            <span class="color-dot" style="background: ${arome?.couleur || '#ccc'}"></span>
                            <strong>${aromeNom}</strong>
                            <span> - ${totalLitres.toFixed(1)}L (${cuves.length} cuve${cuves.length > 1 ? 's' : ''})</span>
                          </div>
                          ${cuves.map(cuve => `
                            <div class="cuve-detail">
                              <div class="cuve-title">Cuve ${cuve.numero} (${cuve.litres.toFixed(1)}L)</div>
                              <ul class="ingredient-list">
                                ${cuve.ingredients.map(ing => `
                                  <li>
                                    <span>${ing.nom}</span>
                                    <strong>${ing.quantite} ${ing.unite}</strong>
                                  </li>
                                `).join('')}
                              </ul>
                            </div>
                          `).join('')}
                        </div>
                      `;
                  }).join('')}
            </div>
        </div>
        
        <div style="margin-top: 24px; padding: 16px; background: var(--bg-secondary); border-radius: var(--radius);">
            <strong>Résumé:</strong> ${commandesPeriode.length} commande(s) à produire - Stock déduit automatiquement
        </div>
    `;
    
    let html = `
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Planificateur de production</h3>
            </div>
            ${resultHtml}
        </div>
    `;
    
    document.getElementById('content').innerHTML = html;
};

// Inventaire
const renderInventaire = () => {
    // Initialize default consumables if list is empty
    const defaultConsommables = [
        { nom: 'Eau', unite: 'L', seuilAlerte: 0 },
        { nom: 'Sucre', unite: 'kg', seuilAlerte: 0 },
        { nom: 'Citron', unite: 'kg', seuilAlerte: 0 },
        { nom: 'Menthe', unite: 'kg', seuilAlerte: 0 },
        { nom: 'Hibiscus', unite: 'kg', seuilAlerte: 0 },
        { nom: 'Mûre sauvage', unite: 'kg', seuilAlerte: 0 },
        { nom: 'Poire à botzi', unite: 'kg', seuilAlerte: 0 },
        { nom: 'Sureau', unite: 'kg', seuilAlerte: 0 },
        { nom: 'Herbes des alpes', unite: 'kg', seuilAlerte: 0 },
        { nom: 'Capsules', unite: 'pcs', seuilAlerte: 0 },
        { nom: 'Étiquettes', unite: 'pcs', seuilAlerte: 0 },
        { nom: 'Bouteilles vides 25cl', unite: 'pcs', seuilAlerte: 0 },
        { nom: 'Bouteilles vides 50cl', unite: 'pcs', seuilAlerte: 0 },
        { nom: 'Bouteilles vides 1L', unite: 'pcs', seuilAlerte: 0 }
    ];
    
    let items = DB.get('inventaire');
    if (items.length === 0) {
        items = defaultConsommables.map(item => ({
            ...item,
            id: generateId(),
            categorie: 'consommable',
            quantite: 0
        }));
        DB.set('inventaire', items);
    }
    
    const consommables = items.filter(i => i.categorie === 'consommable');
    const equipement = items.filter(i => i.categorie === 'equipement');
    
    const unités = ['pcs', 'kg', 'L', 'mL', 'g', 'm', 'caisse(s)'];
    
    let html = `
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Inventaire</h3>
                <div class="card-actions">
                    <button class="btn btn-sm btn-secondary" onclick="showInventaireModal('consommable')">+ Consommable</button>
                    <button class="btn btn-sm btn-secondary" onclick="showInventaireModal('equipement')">+ Équipement</button>
                </div>
            </div>
            
            <!-- Consommables Section -->
            <div class="inventaire-section">
                <h4>Consommables</h4>
                <div class="inventaire-grid">
                    ${consommables.length === 0 ? '<p class="text-muted">Aucun consommable</p>' : 
                      consommables.map(item => {
                          const isAlerte = item.seuilAlerte && item.quantite <= item.seuilAlerte;
                          return `
                            <div class="inventaire-item ${isAlerte ? 'alerte' : ''}">
                                <span class="inventaire-item-name">${item.nom}</span>
                                <div class="inventaire-qty-controls">
                                    <button class="btn btn-sm btn-secondary" onclick="updateInventaireQty('${item.id}', -1)">−</button>
                                    <span class="inventaire-qty">${item.quantite} ${item.unite}</span>
                                    <button class="btn btn-sm btn-secondary" onclick="updateInventaireQty('${item.id}', 1)">+</button>
                                </div>
                                <div class="inventaire-item-actions">
                                    <button class="btn btn-sm btn-secondary" onclick="showInventaireModal('consommable', '${item.id}')">✏️</button>
                                    <button class="btn btn-sm btn-danger" onclick="deleteInventaireItem('${item.id}')">×</button>
                                </div>
                            </div>
                            ${isAlerte ? `<div class="inventaire-alerte-text">Stock bas! Seuil: ${item.seuilAlerte} ${item.unite}</div>` : ''}
                          `;
                      }).join('')}
                </div>
            </div>
            
            <!-- Équipement Section (collapsible) -->
            <div class="inventaire-section">
                <div class="inventaire-section-header" onclick="toggleEquipementSection()">
                    <h4>Équipement</h4>
                    <span class="inventaire-toggle" id="equipementToggle">▶</span>
                </div>
                <div class="inventaire-grid collapse-content" id="equipementContent">
                    ${equipement.length === 0 ? '<p class="text-muted">Aucun équipement</p>' : 
                      equipement.map(item => {
                          const isAlerte = item.seuilAlerte && item.quantite <= item.seuilAlerte;
                          return `
                            <div class="inventaire-item ${isAlerte ? 'alerte' : ''}">
                                <span class="inventaire-item-name">${item.nom}</span>
                                <div class="inventaire-qty-controls">
                                    <button class="btn btn-sm btn-secondary" onclick="updateInventaireQty('${item.id}', -1)">−</button>
                                    <span class="inventaire-qty">${item.quantite} ${item.unite}</span>
                                    <button class="btn btn-sm btn-secondary" onclick="updateInventaireQty('${item.id}', 1)">+</button>
                                </div>
                                <div class="inventaire-item-actions">
                                    <button class="btn btn-sm btn-secondary" onclick="showInventaireModal('equipement', '${item.id}')">✏️</button>
                                    <button class="btn btn-sm btn-danger" onclick="deleteInventaireItem('${item.id}')">×</button>
                                </div>
                            </div>
                            ${isAlerte ? `<div class="inventaire-alerte-text">Stock bas! Seuil: ${item.seuilAlerte} ${item.unite}</div>` : ''}
                          `;
                      }).join('')}
                </div>
            </div>
        </div>
    `;
    
    document.getElementById('content').innerHTML = html;
};

// Toggle equipement section
const toggleEquipementSection = () => {
    const content = document.getElementById('equipementContent');
    const toggle = document.getElementById('equipementToggle');
    content.classList.toggle('open');
    toggle.textContent = content.classList.contains('open') ? '▼' : '▶';
};

// Show inventaire modal
const showInventaireModal = (categorie, id = null) => {
    const items = DB.get('inventaire') || [];
    const item = id ? items.find(i => i.id === id) : null;
    
    const unités = ['pcs', 'kg', 'L', 'mL', 'g', 'm', 'caisse(s)'];
    
    modal.show(id ? 'Modifier item' : 'Nouvel item', `
        <form id="inventaireForm">
            <input type="hidden" name="categorie" value="${categorie}">
            <div class="form-group">
                <label>Nom</label>
                <input type="text" name="nom" value="${item?.nom || ''}" required>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Quantité</label>
                    <input type="number" name="quantite" value="${item?.quantite || 0}" min="0" required>
                </div>
                <div class="form-group">
                    <label>Unité</label>
                    <select name="unite" required>
                        ${unités.map(u => `<option value="${u}" ${item?.unite === u ? 'selected' : ''}>${u}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label>Seuil d'alerte (stock bas)</label>
                <input type="number" name="seuilAlerte" value="${item?.seuilAlerte || 0}" min="0">
                <small class="text-muted">Alerte quand la quantité est en dessous de ce seuil</small>
            </div>
        </form>
    `, `
        <button class="btn btn-secondary" onclick="modal.hide()">Annuler</button>
        <button class="btn btn-primary" onclick="saveInventaireItem('${id || ''}')">Enregistrer</button>
    `);
};

// Save inventaire item
const saveInventaireItem = (id) => {
    const form = document.getElementById('inventaireForm');
    const formData = new FormData(form);
    
    const item = {
        id: id || generateId(),
        categorie: formData.get('categorie'),
        nom: formData.get('nom'),
        quantite: parseInt(formData.get('quantite')) || 0,
        unite: formData.get('unite'),
        seuilAlerte: parseInt(formData.get('seuilAlerte')) || 0
    };
    
    const items = DB.get('inventaire');
    if (id) {
        const index = items.findIndex(i => i.id === id);
        items[index] = item;
    } else {
        items.push(item);
    }
    DB.set('inventaire', items);
    
    modal.hide();
    showToast('Item enregistré');
    renderInventaire();
};

// Update inventaire quantity
const updateInventaireQty = (id, delta) => {
    const items = DB.get('inventaire');
    const item = items.find(i => i.id === id);
    if (item) {
        item.quantite = Math.max(0, (item.quantite || 0) + delta);
        DB.set('inventaire', items);
        renderInventaire();
    }
};

// Delete inventaire item
const deleteInventaireItem = (id) => {
    if (confirm('Supprimer cet item ?')) {
        const items = DB.get('inventaire').filter(i => i.id !== id);
        DB.set('inventaire', items);
        showToast('Item supprimé');
        renderInventaire();
    }
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
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <button class="btn btn-sm btn-secondary" onclick="exportClientsCSV()">Exporter CSV</button>
                        <button class="btn btn-sm btn-secondary" onclick="exportClientsExcel()">Exporter Excel</button>
                        <button class="btn btn-sm btn-secondary" onclick="document.getElementById('importClientsFile').click()">Importer Excel</button>
                        <input type="file" id="importClientsFile" accept=".xlsx,.xls" style="display:none" onchange="importClientsExcel(event)">
                        <button class="btn btn-sm btn-primary" onclick="showClientModal()">+ Ajouter</button>
                        <button class="btn btn-sm btn-danger" onclick="resetClients()">Effacer tout</button>
                    </div>
                </div>
                <ul class="settings-list">
                    ${clients.length === 0 ? '<li class="settings-item text-muted">Aucun client</li>' : 
                      clients.map(c => `
                        <li class="settings-item">
                            <div class="settings-item-info">
                                <div><strong>${c.societe || ''}</strong> ${c.nom || ''}</div>
                                <div class="text-muted" style="font-size:12px;">${c.adresse || ''} ${c.npa || ''}</div>
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
            
            <div class="settings-card" style="grid-column: 1 / -1;">
                <div class="settings-card-header">
                    <h3>Sauvegarde & Restauration</h3>
                </div>
                <div style="display: flex; gap: 12px; flex-wrap: wrap; padding: 12px;">
                    <button class="btn btn-primary" onclick="exportAllData()">💾 Sauvegarder tout (JSON)</button>
                    <button class="btn btn-secondary" onclick="document.getElementById('importDataFile').click()">📂 Restaurer depuis JSON</button>
                    <input type="file" id="importDataFile" accept=".json" style="display:none" onchange="importAllData(event)">
                </div>
                <p class="text-muted" style="font-size: 12px; padding: 0 12px 12px;">
                    La sauvegarde inclut: employés, aromes, formats, recettes, clients, lots, commandes et pointages.
                </p>
            </div>
            
            <div class="settings-card" style="grid-column: 1 / -1; border: 2px solid var(--danger);">
                <div class="settings-card-header">
                    <h3>Réinitialisation</h3>
                </div>
                <div style="padding: 12px;">
                    <button class="btn btn-danger" onclick="resetCounters()">Réinitialiser les compteurs</button>
                    <p style="margin-top: 8px; font-size: 12px; color: var(--text-light);">
                        Remet les numéros de lots et de commandes à 1. Cette action est irréversible.
                    </p>
                </div>
            </div>
        </div>
    `;
    
    document.getElementById('content').innerHTML = html;
};

// Settings - Counters
const resetCounters = () => {
    if (confirm('Réinitialiser les compteurs de lots et de commandes? Cette action est irréversible.')) {
        localStorage.removeItem('thecol_lot_counter');
        localStorage.removeItem('thecol_compteur_commandes');
        showToast('Compteurs réinitialisés - les prochain lot sera #000001 et la prochaine commande sera 00001');
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
            <div class="form-row">
                <div class="form-group">
                    <label>Société</label>
                    <input type="text" name="societe" value="${client?.societe || ''}">
                </div>
                <div class="form-group">
                    <label>Prénom & Nom</label>
                    <input type="text" name="nom" value="${client?.nom || ''}">
                </div>
            </div>
            <div class="form-group">
                <label>Adresse</label>
                <input type="text" name="adresse" value="${client?.adresse || ''}">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>NPA & Localité</label>
                    <input type="text" name="npa" value="${client?.npa || ''}">
                </div>
                <div class="form-group">
                    <label>Tarifs</label>
                    <input type="text" name="tarifs" value="${client?.tarifs || ''}">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Prix 25cl</label>
                    <input type="text" name="prix25cl" value="${client?.prix25cl || ''}">
                </div>
                <div class="form-group">
                    <label>Prix 50cl</label>
                    <input type="text" name="prix50cl" value="${client?.prix50cl || ''}">
                </div>
                <div class="form-group">
                    <label>Prix 100cl</label>
                    <input type="text" name="prix100cl" value="${client?.prix100cl || ''}">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Mode facturation</label>
                    <input type="text" name="modeFact" value="${client?.modeFact || ''}">
                </div>
                <div class="form-group">
                    <label>Coordonnées</label>
                    <input type="text" name="coord" value="${client?.coord || ''}">
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

const exportClientsCSV = () => {
    const clients = DB.get('clients') || [];
    
    let csv = 'Société,Prénom & Nom,Adresse,NPA & Localité,Tarifs,25cl,50cl,100cl,Mode facturation,Coordonnées,Actif\n';
    
    clients.forEach(c => {
        const escape = (s) => String(s || '').replace(/"/g, '""');
        csv += `"${escape(c.societe)}","${escape(c.nom)}","${escape(c.adresse)}","${escape(c.npa)}","${escape(c.tarifs)}","${escape(c.prix25cl)}","${escape(c.prix50cl)}","${escape(c.prix100cl)}","${escape(c.modeFact)}","${escape(c.coord)}","${c.actif ? 'Oui' : 'Non'}"\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `clients_${getLocalDateISOString()}.csv`;
    link.click();
    
    showToast('Clients exportés');
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

// Reset clients data if corrupted
const resetClients = () => {
    if (confirm('Voulez-vous effacer tous les clients et recommencer ?')) {
        DB.set('clients', []);
        showToast('Clients effacés');
        renderParametres();
    }
};

// Export all data to JSON
const exportAllData = () => {
    const tables = ['employees', 'aromes', 'formats', 'recettes', 'clients', 'lots', 'commandes', 'pointages', 'inventaire'];
    const data = {};
    tables.forEach(table => {
        data[table] = DB.get(table) || [];
    });
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().split('T')[0];
    a.href = url;
    a.download = `sauvegarde_${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Sauvegarde créée');
};

// Import all data from JSON
const importAllData = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            const tables = ['employees', 'aromes', 'formats', 'recettes', 'clients', 'lots', 'commandes', 'pointages', 'inventaire'];
            let count = 0;
            tables.forEach(table => {
                if (data[table] && Array.isArray(data[table])) {
                    DB.set(table, data[table]);
                    count++;
                }
            });
            showToast(`${count} tables restaurées`);
            router();
        } catch(err) {
            showToast('Erreur: fichier invalide', 'error');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
};

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    DB.init();
    // Wait for Firebase to be ready, then sync
    const waitForFirebase = () => new Promise(resolve => {
        const check = () => {
            if (window.firebaseReady) return resolve();
            setTimeout(check, 100);
        };
        check();
    });
    await waitForFirebase();
    await DB.loadFromFirebase(false);
    router();
});
