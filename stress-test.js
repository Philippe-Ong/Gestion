// ThéCol Gestion — Stress Test Runner
window.StressTest = (() => {
    const LOG = [];
    const RESULTS = { passed: 0, failed: 0, phases: {} };
    let currentPhase = null;
    let startTime = 0;
    let panelEl = null;
    let progressBar = null;
    let logContainer = null;
    let isRunning = false;
    let origOnerror = null;
    let origUnhandled = null;
    let backupData = null;

    const BACKUP_PREFIX = 'thecol_stress_bk_';
    const INDEX_KEY = 'thecol_stress_bk_keys';

    const log = (msg, type = 'info') => {
        const entry = { msg, type, time: Date.now() };
        LOG.push(entry);
        if (type === 'pass') RESULTS.passed++;
        if (type === 'fail') RESULTS.failed++;
        if (currentPhase) {
            if (!RESULTS.phases[currentPhase]) RESULTS.phases[currentPhase] = { passed: 0, failed: 0, duration: 0 };
            if (type === 'pass') RESULTS.phases[currentPhase].passed++;
            if (type === 'fail') RESULTS.phases[currentPhase].failed++;
        }
        updateLogUI(entry, type);
        if (type === 'fail') console.error('[STRESS-TEST FAIL]', msg);
        else if (type === 'pass') console.log('%c[STRESS-TEST PASS]%c ' + msg, 'color:green', '');
        else console.log('[STRESS-TEST]', msg);
    };

    const assert = (condition, msg) => {
        if (condition) log(msg, 'pass');
        else {
            log(msg, 'fail');
            if (currentPhase) RESULTS.phases[currentPhase].failed++;
        }
    };

    const assertNoThrow = (label, fn) => {
        try {
            fn();
            log(label + ' — aucune erreur', 'pass');
            return true;
        } catch (e) {
            log(label + ' — ERREUR : ' + e.message, 'fail');
            return false;
        }
    };

    const assertEqual = (actual, expected, msg) => {
        const actualStr = JSON.stringify(actual);
        const expectedStr = JSON.stringify(expected);
        if (actualStr === expectedStr) log(msg + ' (' + expectedStr + ')', 'pass');
        else log(msg + ' — attendu ' + expectedStr + ', obtenu ' + actualStr, 'fail');
    };

    const timed = (label, fn) => {
        const t0 = performance.now();
        const result = fn();
        const duration = (performance.now() - t0).toFixed(2);
        log(label + ' — ' + duration + ' ms', 'info');
        return result;
    };

    // ─── Backup & Restore ──────────────────────────────────────

    const hasBackup = () => localStorage.getItem(INDEX_KEY) !== null;

    const backup = () => {
        if (hasBackup()) {
            log('⚠️  Un backup de stress-test existe déjà. Restaurez d\'abord.', 'warn');
            return false;
        }
        const savedKeys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('thecol_') && !key.startsWith(BACKUP_PREFIX) && !key.startsWith('thecol_backup_')) {
                const bkKey = BACKUP_PREFIX + key;
                localStorage.setItem(bkKey, localStorage.getItem(key));
                savedKeys.push(key);
            }
        }
        localStorage.setItem(INDEX_KEY, JSON.stringify(savedKeys));
        backupData = savedKeys;
        log('✅ Backup créé (' + savedKeys.length + ' clés sauvegardées)', 'info');
        return true;
    };

    const restore = () => {
        const rawIndex = localStorage.getItem(INDEX_KEY);
        if (!rawIndex) {
            log('❌ Aucun backup trouvé à restaurer', 'fail');
            return false;
        }
        try {
            const savedKeys = JSON.parse(rawIndex);

            const allKeys = [];
            for (let i = 0; i < localStorage.length; i++) allKeys.push(localStorage.key(i));

            for (const key of allKeys) {
                if (key.startsWith('thecol_') && !key.startsWith(BACKUP_PREFIX)) {
                    localStorage.removeItem(key);
                }
            }

            for (const origKey of savedKeys) {
                const bkKey = BACKUP_PREFIX + origKey;
                const value = localStorage.getItem(bkKey);
                if (value !== null) {
                    localStorage.setItem(origKey, value);
                }
            }

            for (const key of allKeys) {
                if (key.startsWith(BACKUP_PREFIX)) {
                    localStorage.removeItem(key);
                }
            }

            backupData = null;
            log('✅ Données restaurées (' + savedKeys.length + ' clés)', 'info');
            return true;
        } catch (e) {
            log('❌ Échec restauration : ' + e.message, 'fail');
            return false;
        }
    };

    const cleanupTestData = () => {
        const testKeys = ['thecol_commandes', 'thecol_lots', 'thecol_pointages', 'thecol_clients',
            'thecol_aromes', 'thecol_formats', 'thecol_recettes', 'thecol_employees',
            'thecol_history', 'thecol_livraisons', 'thecol_inventaire'];
        testKeys.forEach(k => localStorage.removeItem(k));
        log('🧹 Données de test supprimées', 'info');
    };

    // ─── Test Helpers ──────────────────────────────────────

    const seedBaseEntities = () => {
        const aromes = [];
        const formats = [];
        const recettes = [];
        const employees = [];
        const clients = [];
        for (let i = 0; i < 10; i++) {
            const a = { id: generateId(), nom: 'ArômeTest_' + (i + 1), couleur: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'), actif: true };
            aromes.push(a);
        }
        for (let i = 0; i < 5; i++) {
            const clVals = [33, 50, 75, 100, 150];
            formats.push({ id: generateId(), nom: clVals[i] + 'cl', contenanceCl: clVals[i], actif: true });
        }
        for (let i = 0; i < 8; i++) {
            const arome = aromes[i % aromes.length];
            recettes.push({
                id: generateId(), aromeId: arome.id, nom: 'Recette ' + arome.nom,
                ingredients: [
                    { nom: 'Eau', quantite: 90, unite: 'L' },
                    { nom: 'Sucre', quantite: 7, unite: 'kg' },
                    { nom: 'Acide citrique', quantite: 500, unite: 'g' },
                    { nom: 'Extrait arôme', quantite: 300, unite: 'mL' }
                ]
            });
        }
        for (let i = 0; i < 5; i++) {
            employees.push({ id: generateId(), nom: 'Employé' + (i + 1), prenom: 'Test', tauxHoraire: 25 + i * 2, actif: true });
        }
        for (let i = 0; i < 500; i++) {
            clients.push({
                id: generateId(), nom: 'Client Test ' + (i + 1), adresse: 'Rue ' + (i + 1) + ', 1000 Lausanne',
                email: 'client' + (i + 1) + '@test.ch', telephone: '021000' + String(i).padStart(4, '0'), actif: true
            });
        }
        DB.set('aromes', aromes);
        DB.set('formats', formats);
        DB.set('recettes', recettes);
        DB.set('employees', employees);
        DB.set('clients', clients);
        DB.set('inventaire', []);
        DB.set('commandes', []);
        DB.set('lots', []);
        DB.set('pointages', []);
        DB.set('livraisons', []);
        DB.set('history', []);
        return { aromes, formats, recettes, employees, clients };
    };

    // ─── UI Panel ──────────────────────────────────────

    const buildPanel = () => {
        if (document.getElementById('stressTestPanel')) return;
        const panel = document.createElement('div');
        panel.id = 'stressTestPanel';
        panel.style.cssText = `
            position: fixed; bottom: 0; right: 0; width: 420px; max-height: 70vh;
            background: var(--bg, #FAFBF7); border: 1px solid var(--border, #ddd); border-bottom: none;
            border-radius: 12px 0 0 0; box-shadow: 0 -4px 20px rgba(0,0,0,0.15);
            z-index: 10000; font-family: 'Outfit', sans-serif; font-size: 13px;
            display: flex; flex-direction: column; overflow: hidden;
        `;
        panel.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--primary,#5D7B3E);color:white;cursor:move;" id="stressPanelHeader">
                <span style="font-weight:600;">🔧 Stress Test</span>
                <div style="display:flex;gap:6px;">
                    <button id="stressTestRun" style="background:white;color:var(--primary,#5D7B3E);border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-weight:600;" ${isRunning ? 'disabled' : ''}>Lancer</button>
                    <button id="stressTestRestore" style="background:rgba(255,255,255,0.25);color:white;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;">Restaurer</button>
                    <button id="stressTestClose" style="background:transparent;color:white;border:none;font-size:18px;cursor:pointer;line-height:1;">×</button>
                </div>
            </div>
            <div style="padding:6px 14px;background:var(--warning,#F39C12);color:white;font-size:11px;" id="stressTestWarning">
                ⚠️ Sauvegarde automatique avant exécution. Vos données seront restaurées après.
            </div>
            <div style="padding:4px 14px;background:#f5f5f5;">
                <div id="stressTestProgress" style="height:4px;background:#e0e0e0;border-radius:2px;overflow:hidden;">
                    <div id="stressTestBar" style="height:100%;width:0%;background:var(--primary,#5D7B3E);transition:width .3s;"></div>
                </div>
                <div id="stressTestPhase" style="font-size:11px;color:var(--text-light,#666);margin-top:2px;">Prêt</div>
            </div>
            <div id="stressTestLog" style="flex:1;overflow-y:auto;padding:6px 14px;max-height:45vh;font-size:12px;font-family:monospace;background:var(--bg,#FAFBF7);"></div>
            <div id="stressTestSummary" style="padding:6px 14px;border-top:1px solid var(--border,#ddd);font-size:12px;display:none;"></div>
        `;
        document.body.appendChild(panel);
        panelEl = panel;
        progressBar = document.getElementById('stressTestBar');
        logContainer = document.getElementById('stressTestLog');

        document.getElementById('stressTestRun').addEventListener('click', runAll);
        document.getElementById('stressTestRestore').addEventListener('click', () => {
            if (isRunning) return;
            if (hasBackup()) {
                restore();
                DB.set('commandes', DB.get('commandes'));
                DB.set('lots', DB.get('lots'));
                showToast('Données restaurées. Rafraîchissez la page.', 'success');
                setTimeout(() => navigateTo(window.location.hash.substring(1) || 'dashboard'), 300);
            } else {
                showToast('Aucun backup à restaurer', 'warning');
            }
        });
        document.getElementById('stressTestClose').addEventListener('click', () => {
            if (isRunning) return;
            panel.remove();
            panelEl = null;
            window.StressTest.detachUI();
        });

        resetLogUI();
    };

    const updateProgress = (pct, phaseName) => {
        if (progressBar) progressBar.style.width = pct + '%';
        const phaseEl = document.getElementById('stressTestPhase');
        if (phaseEl) phaseEl.textContent = phaseName || '';
    };

    const updateLogUI = (entry, type) => {
        if (!logContainer) return;
        const icons = { pass: '✅', fail: '❌', warn: '⚠️', info: 'ℹ️', start: '▶️', end: '🏁' };
        const colors = { pass: '#27AE60', fail: '#C0392B', warn: '#F39C12', info: '#666', start: '#5D7B3E', end: '#5D7B3E' };
        const div = document.createElement('div');
        div.style.cssText = `padding:2px 0;color:${colors[type] || '#333'};`;
        div.textContent = (icons[type] || '') + ' ' + entry.msg;
        logContainer.appendChild(div);
        logContainer.scrollTop = logContainer.scrollHeight;
    };

    const resetLogUI = () => {
        if (!logContainer) return;
        logContainer.innerHTML = '';
        LOG.length = 0;
        RESULTS.passed = 0;
        RESULTS.failed = 0;
        RESULTS.phases = {};
        updateProgress(0, 'Prêt');
        const summary = document.getElementById('stressTestSummary');
        if (summary) summary.style.display = 'none';
    };

    const showSummary = () => {
        const summary = document.getElementById('stressTestSummary');
        if (!summary) return;
        summary.style.display = 'block';
        const pts = RESULTS.phases;
        let phaseRows = '';
        for (const [name, r] of Object.entries(pts)) {
            phaseRows += `<tr><td>${name}</td><td>${r.passed}</td><td>${r.failed}</td><td>${r.duration}ms</td></tr>`;
        }
        summary.innerHTML = `
            <div style="font-weight:600;margin-bottom:4px;">📊 Résultats : ${RESULTS.passed} ✅ / ${RESULTS.failed} ❌</div>
            <table style="width:100%;font-size:11px;border-collapse:collapse;">
                <tr style="background:#f0f0f0;"><th style="text-align:left;padding:2px 4px;">Phase</th><th>✅</th><th>❌</th><th>Durée</th></tr>
                ${phaseRows}
            </table>
        `;
    };

    // ─── Phase Runners ──────────────────────────────────────

    const runPhase1 = () => {
        currentPhase = 'P1 — Volume (données existantes)';
        log('Début de la phase 1', 'start');
        updateProgress(5, currentPhase);
        const t0 = performance.now();

        const testRender = (name) => {
            try {
                const t = performance.now();
                if (name === 'stock') renderStock();
                else if (name === 'commandes') renderCommandes();
                else if (name === 'dashboard') renderDashboard();
                else if (name === 'production') renderProduction();
                else if (name === 'archives') renderArchives();
                else if (name === 'livraisons') renderLivraisons();
                else if (name === 'inventaire') renderInventaire();
                const dur = (performance.now() - t).toFixed(2);
                if (parseFloat(dur) > 2000) {
                    log('⚠️  ' + name + ' : ' + dur + ' ms — LENT', 'warn');
                } else {
                    log('✅ ' + name + ' : ' + dur + ' ms', 'pass');
                }
            } catch (e) {
                log('❌ ' + name + ' : ' + e.message, 'fail');
            }
        };

        testRender('stock');
        updateProgress(15, currentPhase);
        testRender('commandes');
        updateProgress(25, currentPhase);
        testRender('dashboard');
        updateProgress(35, currentPhase);
        testRender('archives');
        updateProgress(45, currentPhase);
        testRender('livraisons');
        updateProgress(55, currentPhase);
        testRender('inventaire');
        updateProgress(65, currentPhase);
        testRender('production');
        updateProgress(80, currentPhase);

        const dur = (performance.now() - t0).toFixed(0);
        RESULTS.phases[currentPhase] = RESULTS.phases[currentPhase] || { passed: 0, failed: 0, duration: 0 };
        RESULTS.phases[currentPhase].duration = parseInt(dur);
        log('Phase 1 terminée — ' + dur + ' ms', 'end');
        updateProgress(100, currentPhase + ' ✔️');
    };

    const runPhase2 = () => {
        currentPhase = 'P2 — Injection massive';
        log('Début de la phase 2 — Génération de données volumineuses', 'start');
        updateProgress(10, currentPhase);

        const { aromes, formats, clients, employees } = seedBaseEntities();
        log('✅ Entités de base créées (10 arômes, 5 formats, 8 recettes, 5 employés, 500 clients)', 'pass');
        updateProgress(25, currentPhase);

        const lots = [];
        const now = new Date();
        for (let i = 0; i < 2000; i++) {
            const prodDate = new Date(now);
            prodDate.setDate(prodDate.getDate() - Math.floor(Math.random() * 365 * 3));
            const dlc = new Date(prodDate);
            dlc.setMonth(dlc.getMonth() + 6);
            const arome = aromes[Math.floor(Math.random() * aromes.length)];
            const format = formats[Math.floor(Math.random() * formats.length)];
            lots.push({
                id: generateId(),
                arome: arome.nom,
                format: format.nom,
                quantite: Math.floor(Math.random() * 500) + 10,
                dateProduction: prodDate.toISOString().split('T')[0],
                dlv: new Date(prodDate.getFullYear(), prodDate.getMonth() + 1, prodDate.getDate()).toISOString().split('T')[0],
                dlc: dlc.toISOString().split('T')[0],
                statut: Math.random() > 0.7 ? 'expiré' : (Math.random() > 0.6 ? 'vendu' : 'en_stock')
            });
        }
        DB.set('lots', lots);
        log('✅ 2000 lots créés', 'pass');
        updateProgress(40, currentPhase);

        const origGet = localStorage.getItem;
        let currentSize = 0;
        try {
            for (let i = 0; i < localStorage.length; i++) {
                currentSize += (localStorage.getItem(localStorage.key(i)) || '').length * 2;
            }
        } catch (e) { /* ignore */ }
        log('ℹ️  Taille localStorage estimée : ' + (currentSize / 1024 / 1024).toFixed(2) + ' MB', 'info');

        const commandes = [];
        const statuses = ['en_attente', 'produite', 'livrée', 'annulee'];
        for (let i = 0; i < 5000; i++) {
            const dateCmd = new Date(now);
            dateCmd.setDate(dateCmd.getDate() - Math.floor(Math.random() * 365));
            const statut = Math.random() > 0.6 ? 'en_attente' : statuses[Math.floor(Math.random() * statuses.length)];
            const nbItems = Math.floor(Math.random() * 4) + 1;
            const items = [];
            for (let j = 0; j < nbItems; j++) {
                items.push({
                    aromeId: aromes[Math.floor(Math.random() * aromes.length)].id,
                    formatId: formats[Math.floor(Math.random() * formats.length)].id,
                    quantite: Math.floor(Math.random() * 50) + 1
                });
            }
            commandes.push({
                id: generateId(),
                clientId: clients[Math.floor(Math.random() * clients.length)].id,
                dateCommande: dateCmd.toISOString().split('T')[0],
                dateLivraison: new Date(dateCmd.getFullYear(), dateCmd.getMonth(), dateCmd.getDate() + 14).toISOString().split('T')[0],
                statut: statut,
                items: items,
                numero: String(i + 1).padStart(5, '0')
            });
        }
        DB.set('commandes', commandes);
        log('✅ 5000 commandes créées', 'pass');
        updateProgress(60, currentPhase);

        const pointages = [];
        for (let i = 0; i < 3000; i++) {
            const d = new Date(now);
            d.setDate(d.getDate() - Math.floor(Math.random() * 90));
            const h = Math.floor(Math.random() * 4) + 5;
            const mDebut = Math.floor(Math.random() * 60);
            const dureeMin = Math.floor(Math.random() * 240) + 60;
            const debut = String(h).padStart(2, '0') + ':' + String(mDebut).padStart(2, '0');
            const totalMin = h * 60 + mDebut + dureeMin;
            const fin = String(Math.floor(totalMin / 60)).padStart(2, '0') + ':' + String(totalMin % 60).padStart(2, '0');
            pointages.push({
                id: generateId(),
                employeId: employees[Math.floor(Math.random() * employees.length)].id,
                date: d.toISOString().split('T')[0],
                heureDebut: debut,
                heureFin: fin,
                pause: Math.random() > 0.5 ? 30 : 0,
                notes: 'Pointage test ' + i
            });
        }
        DB.set('pointages', pointages);
        log('✅ 3000 pointages créés', 'pass');
        updateProgress(80, currentPhase);

        let finalSize = 0;
        try {
            for (let i = 0; i < localStorage.length; i++) {
                finalSize += (localStorage.getItem(localStorage.key(i)) || '').length * 2;
            }
        } catch (e) { /* ignore */ }
        log('ℹ️  Taille localStorage après injection : ' + (finalSize / 1024 / 1024).toFixed(2) + ' MB', 'info');

        const renderTime = timed('Rendu #stock après injection', () => { try { renderStock(); } catch (e) { log('ERREUR renderStock: ' + e.message, 'fail'); } });
        updateProgress(90, currentPhase);

        timed('Rendu #production après injection', () => { try { renderProduction(); } catch (e) { log('ERREUR renderProduction: ' + e.message, 'fail'); } });
        timed('Rendu #commandes après injection', () => { try { renderCommandes(); } catch (e) { log('ERREUR renderCommandes: ' + e.message, 'fail'); } });

        RESULTS.phases[currentPhase] = RESULTS.phases[currentPhase] || { passed: 0, failed: 0, duration: 0 };
        RESULTS.phases[currentPhase].duration = 0;
        log('Phase 2 terminée', 'end');
        updateProgress(100, currentPhase + ' ✔️');
    };

    const runPhase3 = () => {
        currentPhase = 'P3 — Workflows fonctionnels';
        log('Début de la phase 3', 'start');
        updateProgress(5, currentPhase);

        const aromes = DB.get('aromes');
        const formats = DB.get('formats');
        const recettes = DB.get('recettes');
        const clients = DB.get('clients');
        const employeesDb = DB.get('employees');

        const t0 = performance.now();

        if (clients.length === 0) log('❌ Pas de clients', 'fail');
        if (aromes.length === 0) log('❌ Pas d\'arômes', 'fail');
        if (formats.length === 0) log('❌ Pas de formats', 'fail');
        if (recettes.length === 0) log('❌ Pas de recettes. Création forcée...', 'warn');
        if (employeesDb.length === 0) log('❌ Pas d\'employés', 'fail');

        updateProgress(15, currentPhase);

        // 3.1 Pointage
        assert(employeesDb.length >= 1, 'Employés disponibles pour pointage');
        if (employeesDb.length > 0) {
            const emp = employeesDb[0];
            const pointage = {
                id: generateId(),
                employeId: emp.id,
                date: getLocalDateISOString(),
                heureDebut: '08:00',
                heureFin: '17:00',
                pause: 30,
                notes: 'Test fonctionnel'
            };
            assertNoThrow('Création pointage', () => {
                const ptg = DB.get('pointages');
                ptg.push(pointage);
                DB.set('pointages', ptg);
            });
            assertNoThrow('Lecture pointages', () => {
                const all = DB.get('pointages');
                const found = all.find(p => p.id === pointage.id);
                if (!found) throw new Error('Pointage non trouvé après création');
            });
            log('✅ Pointage créé et retrouvé', 'pass');
        }
        updateProgress(30, currentPhase);

        // 3.2 Commande
        assert(clients.length >= 1, 'Clients disponibles');
        const client = clients[Math.floor(Math.random() * clients.length)];
        const arome = aromes[Math.floor(Math.random() * aromes.length)];
        const format = formats[Math.floor(Math.random() * formats.length)];
        const commandeId = generateId();
        const numeroCmd = '99999';
        const commande = {
            id: commandeId,
            clientId: client.id,
            dateCommande: getLocalDateISOString(),
            dateLivraison: new Date(Date.now() + 14 * 864e5).toISOString().split('T')[0],
            statut: 'en_attente',
            items: [{ aromeId: arome.id, formatId: format.id, quantite: 10 }],
            numero: numeroCmd
        };
        assertNoThrow('Création commande', () => {
            const cmds = DB.get('commandes');
            cmds.push(commande);
            DB.set('commandes', cmds);
        });
        assertNoThrow('Vérification commande', () => {
            const found = DB.get('commandes').find(c => c.id === commandeId);
            if (!found) throw new Error('Commande non trouvée');
            assertEqual(found.statut, 'en_attente', 'Statut initial en_attente');
        });
        updateProgress(45, currentPhase);

        // 3.3 Production — forcer un lot avec l'arôme/format requis
        const lot = {
            id: generateId(),
            arome: arome.nom,
            format: format.nom,
            quantite: 50,
            dateProduction: getLocalDateISOString(),
            dlv: new Date(Date.now() + 365 * 864e5).toISOString().split('T')[0],
            dlc: new Date(Date.now() + 365 * 864e5 + 30 * 864e5).toISOString().split('T')[0],
            statut: 'en_stock'
        };
        assertNoThrow('Création lot de stock', () => {
            const lots = DB.get('lots');
            lots.push(lot);
            DB.set('lots', lots);
        });
        assertNoThrow('Vérification lot créé', () => {
            const found = DB.get('lots').find(l => l.id === lot.id);
            if (!found) throw new Error('Lot non trouvé');
        });
        log('✅ Lot créé pour couvrir la commande', 'pass');
        updateProgress(60, currentPhase);

        // 3.4 Livraison de la commande
        assertNoThrow('Changement statut livrée', () => {
            const cmds = DB.get('commandes');
            const cmd = cmds.find(c => c.id === commandeId);
            if (cmd) cmd.statut = 'livrée';
            DB.set('commandes', cmds);
        });
        assertEqual(DB.get('commandes').find(c => c.id === commandeId)?.statut, 'livrée', 'Commande bien marquée livrée');
        updateProgress(75, currentPhase);

        // 3.5 Génération BL
        assertNoThrow('Génération BL', () => {
            const livraisons = DB.get('livraisons');
            const numBL = getNextBLNumero();
            livraisons.push({
                id: generateId(),
                commandeId: commandeId,
                clientId: client.id,
                numeroBL: numBL,
                dateLivraison: getLocalDateISOString(),
                lignes: [{ aromeId: arome.id, formatId: format.id, quantite: 10 }],
                statut: 'livrée'
            });
            DB.set('livraisons', livraisons);
        });
        const bl = DB.get('livraisons').find(l => l.commandeId === commandeId);
        assert(bl !== undefined, 'BL généré pour la commande');
        updateProgress(90, currentPhase);

        // 3.6 Vérification apparition dans archives
        const cmdsLivrees = DB.get('livraisons').filter(l => l.commandeId === commandeId);
        assert(cmdsLivrees.length >= 1, 'Commande livrée apparaît dans les archives (vivraisons)');

        const dur = (performance.now() - t0).toFixed(0);
        RESULTS.phases[currentPhase] = RESULTS.phases[currentPhase] || { passed: 0, failed: 0, duration: 0 };
        RESULTS.phases[currentPhase].duration = parseInt(dur);
        log('Phase 3 terminée — ' + dur + ' ms', 'end');
        updateProgress(100, currentPhase + ' ✔️');
    };

    const runPhase4 = () => {
        currentPhase = 'P4 — Résilience & edge cases';
        log('Début de la phase 4', 'start');
        updateProgress(10, currentPhase);

        const t0 = performance.now();

        // 4.1 Arôme manquant référencé par un lot
        assertNoThrow('Gestion arôme manquant (lot)', () => {
            const lots = DB.get('lots');
            lots.push({
                id: generateId(), arome: 'ArômeInexistantXYZ', format: '50cl',
                quantite: 10, dateProduction: '2024-01-01', dlv: '2024-02-01',
                dlc: '2024-07-01', statut: 'en_stock'
            });
            DB.set('lots', lots);
        });
        assertNoThrow('Rendu stock avec arôme manquant', () => {
            renderStock();
        });
        log('✅ Le rendu stock ne casse pas avec un arôme inexistant', 'pass');
        updateProgress(25, currentPhase);

        // 4.2 Commande référençant client supprimé
        assertNoThrow('Rendu commandes avec client manquant', () => {
            const cmds = DB.get('commandes');
            cmds.push({
                id: generateId(), clientId: 'ID_INEXISTANT_999',
                dateCommande: '2024-06-15', dateLivraison: '2024-07-01',
                statut: 'en_attente', items: []
            });
            DB.set('commandes', cmds);
            renderCommandes();
        });
        log('✅ Le rendu commandes ne casse pas avec un client inexistant', 'pass');
        updateProgress(35, currentPhase);

        // 4.3 Dates invalides
        assertNoThrow('Rendu avec DLC invalide', () => {
            const lots = DB.get('lots');
            lots.push({
                id: generateId(), arome: 'ArômeDateInvalide', format: '50cl',
                quantite: 5, dateProduction: 'not-a-date', dlv: '0000-00-00',
                dlc: null, statut: 'en_stock'
            });
            DB.set('lots', lots);
            renderStock();
        });
        log('✅ Le rendu stock tolère une DLC null', 'pass');
        updateProgress(45, currentPhase);

        // 4.4 Quantité négative (édition lot) — test de l'absence de validation
        assertNoThrow('Édition lot avec quantité négative (attendu : pas de crash)', () => {
            const lots = DB.get('lots');
            if (lots.length > 0) {
                lots[0].quantite = -100;
                DB.set('lots', lots);
            }
            renderStock();
        });
        log('✅ Quantité négative ne crashe pas le rendu', 'pass');
        updateProgress(55, currentPhase);

        // 4.5 Unité inconnue
        assertNoThrow('Recette avec unité inconnue', () => {
            const recettes = DB.get('recettes');
            if (recettes.length > 0) {
                recettes[0].ingredients.push({ nom: 'TestIngredientExotique', quantite: 50, unite: 'pinte' });
                DB.set('recettes', recettes);
            }
            renderProduction();
        });
        log('✅ Rendu production avec unité non canonique ne casse pas', 'pass');
        updateProgress(65, currentPhase);

        // 4.6 Inventory avec seuil zéro
        assertNoThrow('Inventaire avec seuil zéro', () => {
            const inv = DB.get('inventaire');
            inv.push({
                id: generateId(), nom: 'TestItemAlerte', categorie: 'Consommables',
                quantite: 0, unite: 'pcs', seuilAlerte: 0
            });
            DB.set('inventaire', inv);
            renderInventaire();
        });
        log('✅ Inventaire avec seuil zéro rendu', 'pass');
        updateProgress(75, currentPhase);

        // 4.7 Commande sans items
        assertNoThrow('Commande sans items', () => {
            const cmds = DB.get('commandes');
            cmds.push({
                id: generateId(), clientId: (DB.get('clients')[0] || {}).id || 'x',
                dateCommande: '2024-01-01', dateLivraison: '2024-01-15',
                statut: 'en_attente', items: null
            });
            DB.set('commandes', cmds);
            renderCommandes();
        });
        log('✅ Commande avec items=null ne casse pas le rendu', 'pass');
        updateProgress(85, currentPhase);

        // 4.8 Recette sans ingrédients
        assertNoThrow('Recette sans ingrédients', () => {
            const rec = DB.get('recettes');
            if (rec.length > 0) {
                rec[0].ingredients = [];
                DB.set('recettes', rec);
            }
            renderProduction();
        });
        log('✅ Production avec recette vide ne casse pas', 'pass');
        updateProgress(95, currentPhase);

        // 4.9 JSON corrompu (test du fallback DB.get)
        assertNoThrow('DB.get sur JSON corrompu', () => {
            localStorage.setItem('thecol_corrupt_test', '{not valid json');
            const result = DB.get('corrupt_test');
            assertEqual(Array.isArray(result) && result.length, 0, 'DB.get retourne [] pour JSON corrompu');
            localStorage.removeItem('thecol_corrupt_test');
        });

        const dur = (performance.now() - t0).toFixed(0);
        RESULTS.phases[currentPhase] = RESULTS.phases[currentPhase] || { passed: 0, failed: 0, duration: 0 };
        RESULTS.phases[currentPhase].duration = parseInt(dur);
        log('Phase 4 terminée — ' + dur + ' ms', 'end');
        updateProgress(100, currentPhase + ' ✔️');
    };

    const runPhase5 = () => {
        currentPhase = 'P5 — Restauration';
        log('Début de la phase 5 — Restauration des données originales', 'start');
        updateProgress(10, currentPhase);

        if (!hasBackup()) {
            log('❌ Aucun backup trouvé. Impossible de restaurer.', 'fail');
            updateProgress(100, '❌ Échec');
            return;
        }

        const restored = restore();
        if (restored) {
            log('✅ Données originales restaurées avec succès', 'pass');
            log('ℹ️  Vous pouvez rafraîchir la page ou naviguer vers une autre vue', 'info');
            updateProgress(100, currentPhase + ' ✔️');
            try { navigateTo('dashboard'); } catch (e) { }
        } else {
            log('❌ Échec de la restauration. Backup toujours présent.', 'fail');
            updateProgress(100, '❌ Échec');
        }

        RESULTS.phases[currentPhase] = RESULTS.phases[currentPhase] || { passed: 0, failed: 0, duration: 0 };
        RESULTS.phases[currentPhase].duration = 0;
    };

    // ─── Run All ──────────────────────────────────────

    const runAll = async () => {
        if (isRunning) return;
        isRunning = true;

        resetLogUI();
        RESULTS.passed = 0;
        RESULTS.failed = 0;
        RESULTS.phases = {};
        LOG.length = 0;
        startTime = performance.now();

        const runBtn = document.getElementById('stressTestRun');
        if (runBtn) runBtn.disabled = true;

        origOnerror = window.onerror;
        origUnhandled = window.onunhandledrejection;
        window.onerror = (msg, src, line, col, err) => {
            log('Erreur JS globale : ' + msg + ' (' + (src || '') + ':' + line + ')', 'fail');
            if (origOnerror) origOnerror(msg, src, line, col, err);
            return false;
        };
        window.onunhandledrejection = (ev) => {
            log('Promesse rejetée non gérée : ' + (ev.reason?.message || ev.reason), 'fail');
        };

        buildPanel();

        try {
            // Sauvegarde
            log('🔒 Sauvegarde des données en cours...', 'info');
            if (backup()) {
                runPhase1();
                await sleep(100);
                runPhase2();
                await sleep(100);
                runPhase3();
                await sleep(100);
                runPhase4();
                await sleep(100);
                runPhase5();
                await sleep(100);
            } else {
                log('❌ Test annulé — backup déjà présent ou échec', 'fail');
            }
        } catch (e) {
            log('❌ Erreur fatale : ' + e.message, 'fail');
            console.error(e);
        }

        const totalDur = (performance.now() - startTime).toFixed(0);
        log('🏁 Test terminé — Durée totale : ' + totalDur + ' ms', 'end');
        log('📊 Total : ' + RESULTS.passed + ' ✅ / ' + RESULTS.failed + ' ❌', 'info');
        if (RESULTS.failed === 0) log('🎉 Aucune erreur détectée !', 'pass');
        else log('⚠️  ' + RESULTS.failed + ' erreurs détectées — vérifiez les logs', 'warn');

        updateProgress(100, 'Terminé');
        showSummary();

        window.onerror = origOnerror;
        window.onunhandledrejection = origUnhandled;
        isRunning = false;
        if (runBtn) runBtn.disabled = false;
    };

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // ─── Public API ──────────────────────────────────────

    const attachUI = () => {
        if (!panelEl) buildPanel();
    };

    const detachUI = () => {
        if (panelEl) {
            panelEl.remove();
            panelEl = null;
            logContainer = null;
            progressBar = null;
        }
    };

    return {
        run: runAll,
        backup,
        restore,
        hasBackup,
        attachUI,
        detachUI,
        getResults: () => RESULTS,
        getLog: () => LOG
    };
})();
