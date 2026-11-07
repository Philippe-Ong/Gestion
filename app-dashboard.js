const addTodo = (text) => {
    if (!text || !text.trim()) return;
    const todos = DB.get('todos') || [];
    todos.unshift({
        id: generateId(),
        text: text.trim(),
        done: false,
        dateAdded: new Date().toISOString()
    });
    DB.set('todos', todos);
    renderDashboard();
};

const toggleTodo = (id) => {
    const todos = DB.get('todos') || [];
    const todo = todos.find(t => t.id === id);
    if (todo) {
        todo.done = !todo.done;
        DB.set('todos', todos);
        renderDashboard();
    }
};

const deleteTodo = (id) => {
    const todos = (DB.get('todos') || []).filter(t => t.id !== id);
    DB.set('todos', todos);
    renderDashboard();
};

// Retire les tâches cochées. Relecture APRÈS la confirmation : un instantané
// d'un autre appareil a pu modifier la liste pendant l'attente.
const clearDoneTodos = async () => {
    const count = (DB.get('todos') || []).filter(t => t.done).length;
    if (!count) return;
    const ok = await confirmDialog(
        `Supprimer ${count} tâche${count > 1 ? 's' : ''} terminée${count > 1 ? 's' : ''} ?`,
        { danger: true, confirmLabel: 'Supprimer', title: 'Tâches terminées' }
    );
    if (!ok) return;
    DB.set('todos', (DB.get('todos') || []).filter(t => !t.done));
    renderCurrentView();
};

// =============================================================================
// Tableau de bord (v12.6) — cockpit du jour + « Chiffres & tendances »
// Lecture seule : aucune écriture pendant le rendu. Le cockpit réutilise
// buildTwinModel() pour appliquer les mêmes règles que le jumeau 3D (réserve
// de stock par DLV, plan de production sur les cuves et casseroles, urgence
// des commandes, seuils des consommables, présence de l'équipe). Les tendances
// agrègent les commandes livrées (jour de la transaction de livraison, repli
// sur la date prévue) ; le CA vient des tarifs clients (diagnoseCommandeMontant).
// =============================================================================

const DASH_ICONS = {
    critique: '<polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    attention: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    chevron: '<polyline points="9 18 15 12 9 6"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    croix: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    horloge: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    stock: '<path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>',
    commande: '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    production: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    equipe: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    ventes: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'
};
const dashIcon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${DASH_ICONS[name] || ''}</svg>`;

// Niveaux de priorité : la couleur ne porte jamais seule le sens (icône + libellé)
const DASH_LEVELS = {
    danger: { icon: 'critique', label: 'Critique' },
    warning: { icon: 'attention', label: 'Attention' },
    info: { icon: 'info', label: 'À surveiller' }
};
const DASH_LEVEL_ORDER = { danger: 0, warning: 1, info: 2 };
const DASH_PRIORITES_MAX = 6;
const DASH_LIVRAISONS_MAX = 6;

// <details> ouverts, conservés d'un re-rendu à l'autre (instantanés temps réel)
const _dashOpen = new Set();
const dashOpenAttr = (key) => (_dashOpen.has(key) ? ' open' : '');

const dashPlural = (n, singulier, pluriel = `${singulier}s`) => `${twinFmtInt(n)} ${n > 1 ? pluriel : singulier}`;
const dashCapitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const dashDayShort = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
// « lun. 26.10 » (toLocaleDateString donnerait « lun., 26.10. »)
const dashWeekdayDay = (d) => `${d.toLocaleDateString('fr-CH', { weekday: 'short' })} ${dashDayShort(d)}`;
const dashCompact = (n) => (Math.abs(n) >= 1000
    ? `${(n / 1000).toLocaleString('fr-CH', { maximumFractionDigits: 1 })} k`
    : twinFmtInt(n));
const dashInRange = (day, from, to) => day >= from && day <= to;
// Attributs data-* d'une action (valeurs échappées)
const dashAttrs = (attrs) => Object.entries(attrs || {}).map(([k, v]) => `${k}="${escapeHtml(v)}"`).join(' ');

// Jour local (minuit) d'une commande livrée : horodatage de la transaction de
// livraison (v11.12+), sinon date prévue ; null si aucune date exploitable.
const dashDeliveryDay = (cmd) => {
    for (const value of [cmd.dateLivraisonEffective, cmd.dateLivraison]) {
        if (!value) continue;
        const day = dateOnly(value);
        if (!Number.isNaN(day.getTime())) return day;
    }
    return null;
};

// Une entrée par commande livrée, CA ventilé par ligne (null = aucun tarif connu)
const dashBuildSales = (commandes, clients, formats) => commandes
    .filter(c => c.statut === 'livrée')
    .map(cmd => {
        const day = dashDeliveryDay(cmd);
        if (!day) return null;
        const report = diagnoseCommandeMontant(cmd, clients, formats);
        const client = clients.find(c => c.id === cmd.clientId);
        const snapshot = cmd.clientLivraison || {};
        const lignes = getItems(cmd).map((item, idx) => ({
            aromeId: item.aromeId,
            bt: Number(item.quantite) || 0,
            ca: report.items[idx]?.priceUsed ? report.items[idx].ligneTotal : 0
        }));
        return {
            day,
            clientKey: cmd.clientId || `livraison:${snapshot.societe || snapshot.nom || ''}`,
            clientLabel: client ? getClientLabel(client) : (snapshot.societe || snapshot.nom || 'Client supprimé'),
            bt: lignes.reduce((sum, l) => sum + l.bt, 0),
            ca: report.hasPrice ? report.total : null,
            lignes
        };
    })
    .filter(Boolean);

const dashSum = (sales) => sales.reduce((acc, s) => {
    acc.bt += s.bt;
    acc.livraisons += 1;
    if (s.ca === null) acc.sansTarif += 1;
    else {
        acc.ca += s.ca;
        acc.avecTarif += 1;
    }
    return acc;
}, { ca: 0, bt: 0, livraisons: 0, sansTarif: 0, avecTarif: 0 });

// 12 périodes se terminant par la période en cours : semaines (lundi → dimanche) ou mois
const dashBuckets = (periode, today) => {
    if (periode === 'mois') {
        return Array.from({ length: 12 }, (_, i) => {
            const start = new Date(today.getFullYear(), today.getMonth() - 11 + i, 1);
            const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
            return {
                start, end, current: i === 11,
                label: start.toLocaleDateString('fr-CH', { month: 'short' }),
                title: dashCapitalize(start.toLocaleDateString('fr-CH', { month: 'long', year: 'numeric' }))
            };
        });
    }
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
    return Array.from({ length: 12 }, (_, i) => {
        const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - (11 - i) * 7);
        const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
        return { start, end, current: i === 11, label: dashDayShort(start), title: `Semaine du ${dashDayShort(start)} au ${dashDayShort(end)}` };
    });
};

// Axe Y : pas « rond » (1, 2 ou 5 × 10ⁿ, au moins 1) et 4 intervalles au plus
const dashAxis = (max) => {
    if (!(max > 0)) return { top: 0, ticks: [0] };
    const raw = max / 4;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = Math.max(1, [1, 2, 5, 10].map(s => s * p).find(s => s >= raw));
    const n = Math.max(1, Math.ceil(max / step));
    return { top: n * step, ticks: Array.from({ length: n + 1 }, (_, i) => i * step) };
};

const buildDashboardModel = () => {
    const now = new Date();
    const today = dateOnly(now);
    const twin = buildTwinModel();
    const commandes = DB.get('commandes') || [];
    const clients = DB.get('clients') || [];
    const formats = DB.get('formats') || [];
    const pointages = DB.get('pointages') || [];
    const employees = DB.get('employees') || [];
    const history = DB.get('history') || [];

    // Priorités : alertes du jumeau (sauf besoins de production, qui ont leur carte)
    // + départs oubliés (même règle que la page Pointage)
    const priorites = [];
    twin.alerts.forEach(alert => {
        const item = twin.byId.get(alert.id);
        let attrs = null;
        if (item?.kind === 'order') attrs = { 'data-click': 'show-commande-details', 'data-id': item.commandeId };
        else if (item?.kind === 'stack') attrs = { 'data-click': 'twin-goto-stock', 'data-arome': item.arome, 'data-format': item.format };
        else if (item?.kind === 'bin') attrs = { 'data-click': 'inventaire-ajuster', 'data-id': item.itemId };
        if (attrs) priorites.push({ level: alert.level, title: alert.title, text: alert.text, attrs });
    });
    pointagesAClore(pointages, now).forEach(p => {
        const emp = employees.find(e => e.id === p.employeId);
        const nom = emp ? `${emp.prenom || ''} ${emp.nom || ''}`.trim() : 'Employé supprimé';
        priorites.push({
            level: 'warning',
            title: `Pointage resté ouvert · ${nom}`,
            text: `Arrivée le ${formatDate(p.date)}${p.heureDebut ? ` à ${p.heureDebut}` : ''} : départ à saisir`,
            attrs: { 'data-click': 'cloturer-pointage', 'data-id': p.id }
        });
    });
    priorites.sort((a, b) => DASH_LEVEL_ORDER[a.level] - DASH_LEVEL_ORDER[b.level]);

    // Commandes à livrer : en retard + 7 prochains jours (twin.orders est trié par échéance)
    const semaine = Array.from({ length: 7 }, (_, i) => {
        const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
        const orders = twin.orders.filter(o => o.days === i);
        return {
            date, offset: i, key: toLocalDayKey(date.getTime()), count: orders.length,
            bt: orders.reduce((sum, o) => sum + o.totalBt, 0),
            name: i === 0 ? 'Auj.' : i === 1 ? 'Dem.' : date.toLocaleDateString('fr-CH', { weekday: 'short' })
        };
    });
    const aLivrer = twin.orders.filter(o => o.days !== null && o.days <= 6);
    const plusTard = twin.orders.filter(o => o.days === null || o.days > 6);

    // Livré ce mois (jusqu'à aujourd'hui) contre la même période du mois précédent
    const sales = dashBuildSales(commandes, clients, formats);
    const debutMois = new Date(today.getFullYear(), today.getMonth(), 1);
    const debutPrec = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const finPrec = new Date(today.getFullYear(), today.getMonth() - 1,
        Math.min(today.getDate(), new Date(today.getFullYear(), today.getMonth(), 0).getDate()));

    const septJours = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
    const produitesSemaine = history.reduce((sum, e) => {
        if (getHistoryType(e) !== 'prod') return sum;
        const day = dateOnly(e.productionDate || e.dateAdded);
        return !Number.isNaN(day.getTime()) && dashInRange(day, septJours, today)
            ? sum + Math.abs(Number(e.quantity) || 0) : sum;
    }, 0);

    return {
        now, today, twin, priorites, semaine, aLivrer, plusTard, sales, history,
        enRetard: aLivrer.filter(o => o.late),
        mois: dashSum(sales.filter(s => dashInRange(s.day, debutMois, today))),
        moisPrec: dashSum(sales.filter(s => dashInRange(s.day, debutPrec, finPrec))),
        debutPrec, finPrec, produitesSemaine,
        aromes: DB.get('aromes') || [],
        todos: DB.get('todos') || [],
        minutesEquipe: twin.staff.reduce((sum, s) => sum + s.minutes, 0)
    };
};

// Ventes des 12 dernières périodes et classements clients / arômes de la même fenêtre
const buildDashboardTrends = (m, periode, mesure) => {
    const buckets = dashBuckets(periode, m.today).map(b => ({
        ...b, ...dashSum(m.sales.filter(s => dashInRange(s.day, b.start, b.end)))
    }));
    const from = buckets[0].start;
    const to = m.today;
    const ventes = m.sales.filter(s => dashInRange(s.day, from, to));
    const totals = dashSum(ventes);
    const hasCa = totals.avecTarif > 0;
    const metric = hasCa && mesure !== 'bt' ? 'ca' : 'bt';

    const clients = new Map();
    const aromes = new Map();
    ventes.forEach(s => {
        const c = clients.get(s.clientKey) || { label: s.clientLabel, ca: 0, bt: 0 };
        c.ca += s.ca || 0;
        c.bt += s.bt;
        clients.set(s.clientKey, c);
        s.lignes.forEach(l => {
            const arome = m.aromes.find(a => a.id === l.aromeId);
            const key = arome ? arome.id : '?';
            const label = arome?.nom || 'Arôme supprimé';
            const a = aromes.get(key) || { label, couleur: arome?.couleur || DEFAULT_COULEURS[label.toLowerCase()], ca: 0, bt: 0 };
            a.ca += l.ca;
            a.bt += l.bt;
            aromes.set(key, a);
        });
    });
    const rank = (map, limit) => {
        const rows = [...map.values()]
            .filter(r => r[metric] > 0)
            .sort((a, b) => b[metric] - a[metric] || b.bt - a.bt || a.label.localeCompare(b.label, 'fr'));
        return { rows: rows.slice(0, limit), autres: rows.slice(limit), total: rows.reduce((sum, r) => sum + r[metric], 0) };
    };

    let produites = 0;
    let ventesDirectes = 0;
    m.history.forEach(e => {
        const type = getHistoryType(e);
        if (type !== 'prod' && type !== 'vente') return;
        const day = dateOnly(type === 'prod' ? (e.productionDate || e.dateAdded) : e.dateAdded);
        if (Number.isNaN(day.getTime()) || !dashInRange(day, from, to)) return;
        if (type === 'prod') produites += Math.abs(Number(e.quantity) || 0);
        else ventesDirectes += Math.abs(Number(e.quantity) || 0);
    });

    return { periode, metric, hasCa, buckets, from, to, totals, produites, ventesDirectes, clients: rank(clients, 5), aromes: rank(aromes, 6) };
};

const dashEmptyHtml = (icon, title, text, tone = 'good') => `
    <div class="dash-empty dash-empty--${tone}">
        <span class="dash-empty-icon">${dashIcon(icon)}</span>
        <div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p></div>
    </div>`;

// `sub` est du HTML déjà échappé par l'appelant (il peut contenir une icône)
const dashTileHtml = ({ href, icon, label, value, unit = '', unitFirst = false, sub = '', tone = '' }) => {
    const unitHtml = unit ? `<small>${escapeHtml(unit)}</small>` : '';
    return `
        <a href="${href}" class="dash-tile">
            <span class="dash-tile-label">${dashIcon(icon)}${escapeHtml(label)}</span>
            <span class="dash-tile-value">${unitFirst ? unitHtml : ''}${escapeHtml(value)}${unitFirst ? '' : unitHtml}</span>
            <span class="dash-tile-sub${tone ? ` is-${tone}` : ''}">${sub}</span>
        </a>`;
};

const dashHeaderHtml = (m) => {
    const heure = m.now.getHours();
    const date = dashCapitalize(m.now.toLocaleDateString('fr-CH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
    const critiques = m.priorites.filter(p => p.level === 'danger').length;
    const litres = m.twin.kpis.aProduireL;
    const parts = [
        critiques ? `<span class="is-danger">${dashIcon('critique')}${escapeHtml(dashPlural(critiques, 'priorité critique', 'priorités critiques'))}</span>` : '',
        `<span>${dashIcon('commande')}${escapeHtml(m.aLivrer.length ? `${dashPlural(m.aLivrer.length, 'commande')} à livrer sous 7 jours` : 'Aucune livraison sous 7 jours')}</span>`,
        `<span>${dashIcon('production')}${escapeHtml(litres > 0 ? `${twinFmtLitres(litres)} à produire` : 'Rien à produire')}</span>`
    ].filter(Boolean);
    return `
        <header class="dash-head">
            <div class="dash-head-text">
                <h1>${heure >= 18 || heure < 5 ? 'Bonsoir' : 'Bonjour'}</h1>
                <p class="dash-date">${escapeHtml(date)}</p>
                <p class="dash-summary">${parts.join('')}</p>
            </div>
            <div class="dash-actions">
                <button type="button" class="btn btn-primary" data-click="dash-new-commande">${dashIcon('plus')}Commande</button>
                <button type="button" class="btn btn-secondary" data-click="dash-new-lot">${dashIcon('plus')}Lot</button>
                <a href="#pointage" class="btn btn-secondary">${dashIcon('horloge')}Pointage</a>
            </div>
        </header>`;
};

const dashKpisHtml = (m) => {
    const k = m.twin.kpis;
    const litres = Math.round((Number(k.aProduireL) || 0) * 10) / 10;
    const pretes = m.aLivrer.filter(o => o.statut === 'produite').length;
    const lotsAlerte = k.lotsExpires + k.lotsInvendables;
    const lotsSurveiller = lotsAlerte + k.lotsWarning;
    const caDispo = m.mois.avecTarif > 0 || m.moisPrec.avecTarif > 0;
    const delta = m.moisPrec.ca > 0 ? Math.round((m.mois.ca - m.moisPrec.ca) / m.moisPrec.ca * 100) : null;
    const periodePrec = `1–${m.finPrec.getDate()} ${m.debutPrec.toLocaleDateString('fr-CH', { month: 'short' })}`;
    const deltaHtml = delta === null ? '' : `<span class="dash-delta${delta > 0 ? ' is-up' : delta < 0 ? ' is-down' : ''}">${delta > 0 ? '▲' : delta < 0 ? '▼' : '='} ${Math.abs(delta)} %</span> vs ${escapeHtml(periodePrec)}`;
    return [
        dashTileHtml({
            href: '#production', icon: 'production', label: 'À produire',
            value: litres.toLocaleString('fr-CH'), unit: 'L',
            sub: litres > 0 ? escapeHtml(`${twinFmtInt(k.aProduireBt)} bt · ${k.postesOccupes}/${k.postesTotal} postes`) : `${dashIcon('check')}Stock suffisant`,
            tone: litres > 0 ? '' : 'good'
        }),
        dashTileHtml({
            href: '#commandes', icon: 'commande', label: 'Livraisons · 7 j',
            value: twinFmtInt(m.aLivrer.length),
            sub: m.enRetard.length
                ? `${dashIcon('critique')}${escapeHtml(`${twinFmtInt(m.enRetard.length)} en retard`)}`
                : escapeHtml(m.aLivrer.length ? `${twinFmtInt(pretes)} prête${pretes > 1 ? 's' : ''} sur ${twinFmtInt(m.aLivrer.length)}` : 'Rien de prévu'),
            tone: m.enRetard.length ? 'danger' : ''
        }),
        dashTileHtml({
            href: '#stock', icon: 'stock', label: 'Stock vendable',
            value: twinFmtInt(k.stockVendable), unit: 'bt',
            sub: lotsSurveiller
                ? `${dashIcon(lotsAlerte ? 'critique' : 'attention')}${escapeHtml(`${dashPlural(lotsSurveiller, 'lot')} à surveiller`)}`
                : escapeHtml(m.produitesSemaine ? `+${twinFmtInt(m.produitesSemaine)} bt produites en 7 j` : 'Aucune production en 7 j'),
            tone: lotsAlerte ? 'danger' : lotsSurveiller ? 'warning' : ''
        }),
        dashTileHtml({
            href: '#pointage', icon: 'equipe', label: 'Équipe',
            value: `${k.presents}/${k.effectif}`, unit: 'sur place',
            sub: escapeHtml(m.minutesEquipe > 0 ? `${twinFmtDuration(m.minutesEquipe)} pointées aujourd'hui` : "Personne n'a pointé aujourd'hui")
        }),
        dashTileHtml({
            href: '#archives', icon: 'ventes', label: 'Livré ce mois',
            value: caDispo ? formatChf(m.mois.ca).replace(/^CHF\s*/, '') : twinFmtInt(m.mois.bt),
            unit: caDispo ? 'CHF' : 'bt', unitFirst: caDispo,
            sub: caDispo
                ? (deltaHtml || escapeHtml(dashPlural(m.mois.livraisons, 'livraison')))
                : escapeHtml(m.mois.livraisons ? `${dashPlural(m.mois.livraisons, 'livraison')} · tarifs manquants` : 'Aucune livraison ce mois')
        })
    ].join('');
};

const dashPrioriteRowHtml = (p) => `
    <li><button type="button" class="dash-prio dash-prio--${p.level}" ${dashAttrs(p.attrs)}>
        <span class="dash-prio-icon">${dashIcon(p.icon || DASH_LEVELS[p.level].icon)}</span>
        <span class="dash-prio-body">
            <span class="dash-prio-title"><span class="dash-sr">${DASH_LEVELS[p.level].label} : </span>${escapeHtml(p.title)}</span>
            <span class="dash-prio-text">${escapeHtml(p.text)}</span>
        </span>
        <span class="dash-prio-chev">${dashIcon('chevron')}</span>
    </button></li>`;

const dashAlertesSectionHtml = (items, titleId) => items.length ? `
    <section class="stock-section" aria-labelledby="${titleId}">
        <div class="stock-section-head"><h2 class="stock-section-title" id="${titleId}">À traiter</h2></div>
        <ul class="dash-prio-list">${items.map(dashPrioriteRowHtml).join('')}</ul>
    </section>` : '';

const dashPrioritesHtml = (m) => {
    const items = m.priorites;
    const reste = items.slice(DASH_PRIORITES_MAX);
    return `
        <section class="card dash-panel" aria-labelledby="dashPrioTitle">
            <div class="card-header">
                <h3 class="card-title" id="dashPrioTitle">Priorités</h3>
                ${items.length ? `<span class="dash-count${items.some(p => p.level === 'danger') ? ' is-danger' : ''}">${twinFmtInt(items.length)}</span>` : ''}
            </div>
            <div class="dash-panel-body">
                ${items.length === 0 ? dashEmptyHtml('check', "Rien d'urgent", 'Aucune commande en retard, aucun lot ni consommable à surveiller.') : `
                    <ul class="dash-prio-list">${items.slice(0, DASH_PRIORITES_MAX).map(dashPrioriteRowHtml).join('')}</ul>
                    ${reste.length ? `
                        <details class="dash-more" data-dash-key="prio"${dashOpenAttr('prio')}>
                            <summary>Voir ${dashPlural(reste.length, 'autre priorité', 'autres priorités')}</summary>
                            <ul class="dash-prio-list">${reste.map(dashPrioriteRowHtml).join('')}</ul>
                        </details>` : ''}
                `}
            </div>
        </section>`;
};

const dashLivraisonsHtml = (m) => {
    const when = (o) => {
        if (o.late) return `En retard de ${-o.days} j`;
        if (o.days === 0) return "Aujourd'hui";
        if (o.days === 1) return 'Demain';
        return dashCapitalize(dashWeekdayDay(dateOnly(o.dateLivraison)));
    };
    const row = (o) => {
        const aromesTxt = [...new Set(o.items.map(i => i.arome))].join(', ');
        return `
            <li><button type="button" class="dash-row" data-click="show-commande-details" data-id="${escapeHtml(o.commandeId)}">
                <span class="dash-row-main">
                    <span class="dash-row-title">${escapeHtml(o.client)} <span class="dash-row-num">#${escapeHtml(o.numero)}</span></span>
                    <span class="dash-row-sub">${escapeHtml(`${twinFmtInt(o.totalBt)} bt${aromesTxt ? ` · ${aromesTxt}` : ''}`)}</span>
                </span>
                <span class="dash-row-side">
                    <span class="dash-when${o.late ? ' is-late' : o.days === 0 ? ' is-today' : ''}">${escapeHtml(when(o))}</span>
                    <span class="badge ${o.statut === 'produite' ? 'badge-produite' : 'badge-en-attente'}">${escapeHtml(getCommandeStatutLabel(o.statut))}</span>
                </span>
            </button></li>`;
    };
    const liste = m.aLivrer.slice(0, DASH_LIVRAISONS_MAX);
    const nonAffichees = m.aLivrer.length - liste.length;
    const pied = [
        nonAffichees > 0 ? `+ ${twinFmtInt(nonAffichees)} sous 7 jours` : '',
        m.plusTard.length ? `${dashPlural(m.plusTard.length, 'commande')} prévue${m.plusTard.length > 1 ? 's' : ''} plus tard` : ''
    ].filter(Boolean).join(' · ');
    return `
        <section class="card dash-panel" aria-labelledby="dashLivTitle">
            <div class="card-header">
                <h3 class="card-title" id="dashLivTitle">Livraisons · 7 jours</h3>
                ${m.aLivrer.length ? `<span class="dash-count${m.enRetard.length ? ' is-danger' : ''}">${twinFmtInt(m.aLivrer.length)}</span>` : ''}
            </div>
            <div class="dash-panel-body">
                <div class="dash-week" role="group" aria-label="Livraisons prévues sur les 7 prochains jours">
                    ${m.semaine.map(d => `
                        <button type="button" class="dash-day${d.offset === 0 ? ' is-today' : ''}${d.count ? '' : ' is-empty'}" data-click="dash-goto-day" data-date="${d.key}"
                            aria-label="${escapeHtml(`${dashCapitalize(d.date.toLocaleDateString('fr-CH', { weekday: 'long', day: 'numeric', month: 'long' }))} : ${dashPlural(d.count, 'livraison')}${d.bt ? `, ${twinFmtInt(d.bt)} bouteilles` : ''}`)}">
                            <span class="dash-day-name">${escapeHtml(d.name)}</span>
                            <span class="dash-day-date">${d.date.getDate()}</span>
                            <span class="dash-day-count">${d.count ? twinFmtInt(d.count) : '–'}</span>
                            <span class="dash-day-bt">${d.bt ? `${escapeHtml(dashCompact(d.bt))} bt` : '&nbsp;'}</span>
                        </button>`).join('')}
                </div>
                ${liste.length
                    ? `<ul class="dash-rows">${liste.map(row).join('')}</ul>`
                    : dashEmptyHtml('check', 'Aucune livraison sous 7 jours', m.plusTard.length ? 'Les prochaines commandes sont prévues plus tard.' : 'Aucune commande en cours.')}
            </div>
            <div class="dash-panel-foot">
                <span>${escapeHtml(pied)}</span>
                <a href="#commandes" class="dash-link">Toutes les commandes${dashIcon('chevron')}</a>
            </div>
        </section>`;
};

const dashProductionHtml = (m) => {
    const prod = m.twin.production;
    const postes = m.twin.equipement;
    const occupes = postes.filter(e => e.status === 'planned').length;
    const poste = (e) => {
        const nom = e.kind === 'cuve' ? `Cuve ${e.numero}` : `Cass. ${e.capacite} L`;
        const detail = e.status === 'planned' ? `${e.arome} · ${twinFmtLitres(e.litres)}` : 'libre';
        return `
            <div class="dash-poste${e.status === 'planned' ? '' : ' is-idle'}" role="listitem" aria-label="${escapeHtml(`${e.label} : ${detail}`)}">
                <span class="dash-vessel dash-vessel--${e.kind}" aria-hidden="true">
                    <span class="dash-vessel-fill" style="height:${Math.round(e.fill * 100)}%;--fill:${safeColor(e.couleur)}"></span>
                </span>
                <span class="dash-poste-name" aria-hidden="true">${escapeHtml(nom)}</span>
                <span class="dash-poste-sub" aria-hidden="true">${escapeHtml(e.status === 'planned' ? e.arome : 'Libre')}</span>
            </div>`;
    };
    // Échéance du manque (première livraison non couverte par le stock)
    const quand = (p) => {
        if (p.urgency === 9999) return 'sans date de livraison';
        if (p.urgency < 0) return 'pour une livraison en retard';
        if (p.urgency <= 1) return `pour ${twinRelativeDay(p.urgency)}`;
        return `pour le ${dashWeekdayDay(new Date(m.today.getFullYear(), m.today.getMonth(), m.today.getDate() + p.urgency))}`;
    };
    const row = (p) => `
        <li class="dash-prod">
            <div class="dash-prod-head">
                <span class="dash-prod-name"><span class="dash-dot" style="background:${safeColor(p.couleur)}" aria-hidden="true"></span>${escapeHtml(p.arome)}</span>
                <span class="dash-prod-qty">${escapeHtml(twinFmtLitres(p.litres))}<small> · ${escapeHtml(twinFmtInt(p.bouteilles))} bt</small></span>
            </div>
            <div class="dash-prod-meta">
                ${p.recipients.map(r => `<span class="dash-chip${r.poste ? '' : ' is-wait'}">${escapeHtml(`${r.poste || `Fournée ${r.fournee}`} · ${twinFmtLitres(r.litres)}`)}</span>`).join('')}
                ${p.hasRecette ? '' : '<span class="dash-chip is-warn">Recette manquante</span>'}
                <span class="dash-prod-when">${escapeHtml(quand(p))}</span>
            </div>
            <div class="dash-prod-formats">${escapeHtml(p.besoins.map(b => `${twinFmtInt(b.bouteilles)} × ${b.format}`).join(' · '))}</div>
        </li>`;
    return `
        <section class="card dash-panel" aria-labelledby="dashProdTitle">
            <div class="card-header">
                <h3 class="card-title" id="dashProdTitle">Production à lancer</h3>
                ${prod.litres > 0 ? `<span class="dash-count">${escapeHtml(twinFmtLitres(prod.litres))}</span>` : ''}
            </div>
            <div class="dash-panel-body">
                <div class="dash-postes" role="list" aria-label="Postes de l'atelier">${postes.map(poste).join('')}</div>
                ${prod.aromes.length === 0
                    ? dashEmptyHtml('check', 'Rien à produire', 'Le stock vendable couvre toutes les commandes en cours.')
                    : `<ul class="dash-prod-list">${prod.aromes.map(row).join('')}</ul>`}
            </div>
            <div class="dash-panel-foot">
                <span>${escapeHtml(prod.enAttente.length
                    ? `${dashPlural(prod.enAttente.length, 'contenant')} en attente : fournées suivantes`
                    : `${occupes}/${postes.length} postes occupés`)}</span>
                <a href="#production" class="btn btn-sm btn-primary">Planifier</a>
            </div>
        </section>`;
};

const dashEquipeHtml = (m) => {
    const staff = m.twin.staff;
    const k = m.twin.kpis;
    const etat = (s) => {
        if (s.present) return `Sur place depuis ${s.since} · ${twinFmtDuration(s.minutes)}`;
        return s.minutes > 0 ? `${twinFmtDuration(s.minutes)} pointées aujourd'hui` : "Pas de pointage aujourd'hui";
    };
    const row = (s) => `
        <li class="dash-member">
            <span class="dash-avatar${s.present ? ' is-present' : ''}" style="--avatar:${safeColor(s.couleur)}" aria-hidden="true">${escapeHtml(s.initiales)}</span>
            <span class="dash-member-main">
                <span class="dash-member-name">${escapeHtml(s.nom)}</span>
                <span class="dash-member-sub">${escapeHtml(etat(s))}</span>
            </span>
            <button type="button" class="btn btn-sm ${s.present ? 'btn-secondary' : 'btn-primary'}" data-click="${s.present ? 'twin-clock-out' : 'twin-clock-in'}" data-id="${escapeHtml(s.employeId)}"
                aria-label="${escapeHtml(`${s.present ? 'Pointer le départ' : "Pointer l'arrivée"} de ${s.nom}`)}">${s.present ? 'Départ' : 'Arrivée'}</button>
        </li>`;
    return `
        <section class="card dash-panel" aria-labelledby="dashTeamTitle">
            <div class="card-header">
                <h3 class="card-title" id="dashTeamTitle">Équipe</h3>
                ${staff.length ? `<span class="dash-count">${k.presents}/${k.effectif} sur place</span>` : ''}
            </div>
            <div class="dash-panel-body">
                ${staff.length
                    ? `<ul class="dash-team">${staff.map(row).join('')}</ul>`
                    : dashEmptyHtml('equipe', 'Aucun employé actif', 'Ajoute ton équipe dans Paramètres › Employés.', 'neutral')}
            </div>
            <div class="dash-panel-foot">
                <span>${escapeHtml(m.minutesEquipe > 0 ? `Total aujourd'hui : ${twinFmtDuration(m.minutesEquipe)}` : '')}</span>
                <a href="#pointage" class="dash-link">Pointage${dashIcon('chevron')}</a>
            </div>
        </section>`;
};

const dashTodosHtml = (m) => {
    const ouvertes = m.todos.filter(t => !t.done);
    const faites = m.todos.filter(t => t.done);
    const row = (t) => `
        <li class="dash-todo-item${t.done ? ' done' : ''}">
            <button type="button" class="dash-todo-toggle" data-click="toggle-todo" data-id="${escapeHtml(t.id)}" aria-pressed="${t.done ? 'true' : 'false'}">
                <span class="dash-todo-check">${t.done ? dashIcon('check') : ''}</span>
                <span class="dash-todo-label">${escapeHtml(t.text)}</span>
            </button>
            <button type="button" class="dash-todo-del" data-click="delete-todo" data-id="${escapeHtml(t.id)}" aria-label="${escapeHtml(`Supprimer la tâche « ${t.text} »`)}">${dashIcon('croix')}</button>
        </li>`;
    return `
        <section class="card dash-panel" aria-labelledby="dashTodoTitle">
            <div class="card-header">
                <h3 class="card-title" id="dashTodoTitle">À faire</h3>
                ${faites.length ? `<button type="button" class="dash-link" data-click="dash-clear-todos">Effacer les terminées (${twinFmtInt(faites.length)})</button>` : ''}
            </div>
            <form class="dash-todo-form" autocomplete="off">
                <input type="text" id="todoInput" placeholder="Ajouter une tâche…" aria-label="Nouvelle tâche" maxlength="200">
                <button type="submit" class="btn btn-primary" data-click="dash-add-todo" data-prevent>Ajouter</button>
            </form>
            ${m.todos.length
                ? `<ul class="dash-todo-list">${[...ouvertes, ...faites].map(row).join('')}</ul>`
                : '<p class="dash-muted">Aucune tâche. Ajoute-en une ci-dessus.</p>'}
        </section>`;
};

const barChartContentHtml = (colonnes, max, formatAxe, tipId = '') => {
    const axis = dashAxis(max);
    const pct = (v) => (axis.top > 0 ? (v / axis.top * 100).toFixed(2) : '0');
    const col = (c) => {
        const sub = c.sub || '';
        const ariaLabel = [`${c.titre} : ${c.valeur}`, sub].filter(Boolean).join(', ');
        const etiquette = c.etiquette ? `<span class="dash-bar-label">${escapeHtml(c.etiquette)}</span>` : '';
        return `
            <div class="dash-col${c.current ? ' is-current' : ''}" tabindex="${c.focus ? '0' : '-1'}" data-title="${escapeHtml(c.titre)}" data-value="${escapeHtml(c.valeur)}" data-sub="${escapeHtml(sub)}" aria-label="${escapeHtml(ariaLabel)}">
                <span class="dash-bar" style="height:${pct(c.mesure)}%">${etiquette}</span>
            </div>`;
    };
    return `
            <div class="dash-chart-plot">
                <div class="dash-chart-area">
                    ${axis.ticks.map(v => `<div class="dash-chart-line${v === 0 ? ' is-base' : ''}" style="bottom:${pct(v)}%" aria-hidden="true"><span>${escapeHtml(formatAxe(v))}</span></div>`).join('')}
                    <div class="dash-chart-cols">${colonnes.map(col).join('')}</div>
                </div>
                <div class="dash-tip"${tipId ? ` id="${tipId}"` : ''} aria-hidden="true" hidden>
                    <span class="dash-tip-value"></span><span class="dash-tip-label"></span><span class="dash-tip-sub"></span>
                </div>
            </div>
            <div class="dash-chart-x" aria-hidden="true">${colonnes.map(c => `<span${c.current ? ' class="is-current"' : ''}${c.mineur ? ' data-mineur' : ''}>${escapeHtml(c.label)}</span>`).join('')}</div>`;
};

const dashChartHtml = (t, titre) => {
    const key = t.metric;
    const fmt = key === 'ca' ? formatChf : (n) => `${twinFmtInt(n)} bt`;
    const valeurs = t.buckets.map(b => b[key]);
    const max = Math.max(0, ...valeurs);
    const iMax = valeurs.indexOf(max);
    const colonnes = t.buckets.map((b, i) => ({
        label: b.label,
        titre: b.title,
        mesure: valeurs[i],
        valeur: fmt(valeurs[i]),
        sub: [
            dashPlural(b.livraisons, 'livraison'),
            key === 'ca' && b.sansTarif ? `${twinFmtInt(b.sansTarif)} sans tarif` : '',
            b.current ? 'période en cours' : ''
        ].filter(Boolean).join(' · '),
        current: b.current,
        focus: b.current,
        etiquette: valeurs[i] > 0 && (i === iMax || b.current) ? dashCompact(valeurs[i]) : ''
    }));
    return `
        <div class="dash-chart" id="dashChart" role="group" aria-label="${escapeHtml(titre)}">${barChartContentHtml(colonnes, max, dashCompact, 'dashChartTip')}
            <details class="dash-table" data-dash-key="table"${dashOpenAttr('table')}>
                <summary>Voir les données</summary>
                <div class="dash-table-wrap">
                    <table>
                        <thead><tr><th scope="col">${t.periode === 'mois' ? 'Mois' : 'Semaine'}</th><th scope="col">Livraisons</th><th scope="col">Bouteilles</th><th scope="col">CA</th></tr></thead>
                        <tbody>${t.buckets.map(b => `<tr><th scope="row">${escapeHtml(b.title)}</th><td>${twinFmtInt(b.livraisons)}</td><td>${twinFmtInt(b.bt)}</td><td>${b.avecTarif ? escapeHtml(formatChf(b.ca)) : '—'}</td></tr>`).join('')}</tbody>
                    </table>
                </div>
            </details>
        </div>`;
};

const dashRankHtml = (titre, rank, metric, fmt, aromes = false) => {
    const max = rank.rows.length ? rank.rows[0][metric] : 0;
    const autres = rank.autres.reduce((sum, r) => sum + r[metric], 0);
    return `
        <div class="dash-rank">
            <h4 class="dash-subtitle">${escapeHtml(titre)}</h4>
            ${rank.rows.length === 0 ? '<p class="dash-muted">Aucune donnée sur la période.</p>' : `
                <ol class="dash-rank-list">
                    ${rank.rows.map(r => `
                        <li class="dash-rank-row">
                            <span class="dash-rank-label">${aromes ? `<span class="dash-dot" style="background:${safeColor(r.couleur)}" aria-hidden="true"></span>` : ''}<span class="dash-rank-name">${escapeHtml(r.label)}</span></span>
                            <span class="dash-rank-value">${escapeHtml(fmt(r[metric]))}${aromes && rank.total > 0 ? `<small> · ${Math.round(r[metric] / rank.total * 100)} %</small>` : ''}</span>
                            <span class="dash-rank-track" aria-hidden="true"><span class="dash-rank-bar" style="width:${max > 0 ? (r[metric] / max * 100).toFixed(1) : 0}%"></span></span>
                        </li>`).join('')}
                </ol>
                ${rank.autres.length ? `<p class="dash-muted dash-rank-more">${escapeHtml(`+ ${aromes ? dashPlural(rank.autres.length, 'autre arôme', 'autres arômes') : dashPlural(rank.autres.length, 'autre client', 'autres clients')} · ${fmt(autres)}`)}</p>` : ''}
            `}
        </div>`;
};

const dashStatHtml = (label, value, sub = '') => `
        <div class="dash-stat">
            <span class="dash-stat-label">${escapeHtml(label)}</span>
            <span class="dash-stat-value">${escapeHtml(value)}</span>
            ${sub ? `<span class="dash-stat-sub">${escapeHtml(sub)}</span>` : ''}
        </div>`;

const dashTendancesHtml = (t) => {
    const fmt = t.metric === 'ca' ? formatChf : (n) => `${twinFmtInt(n)} bt`;
    const seg = (name, value, label, active, disabled = false, title = '') => `
        <button type="button" class="segment${active ? ' active' : ''}" data-click="set-filter" data-name="${name}" data-value="${value}" data-render="renderDashboard" aria-pressed="${active ? 'true' : 'false'}"${disabled ? ' disabled' : ''}${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(label)}</button>`;
    const titre = `${t.metric === 'ca' ? 'CA livré (CHF)' : 'Bouteilles livrées'} par ${t.periode === 'mois' ? 'mois' : 'semaine'}`;
    const panier = t.totals.avecTarif ? t.totals.ca / t.totals.avecTarif : null;
    return `
        <section class="card dash-trends" aria-labelledby="dashTrendsTitle">
            <div class="card-header">
                <div>
                    <h3 class="card-title" id="dashTrendsTitle">Chiffres &amp; tendances</h3>
                    <p class="dash-muted">Commandes livrées du ${escapeHtml(formatDate(t.from))} au ${escapeHtml(formatDate(t.to))}</p>
                </div>
                <div class="dash-controls">
                    <div class="segmented-filter" role="group" aria-label="Période">${seg('dash_periode', 'semaines', '12 semaines', t.periode !== 'mois')}${seg('dash_periode', 'mois', '12 mois', t.periode === 'mois')}</div>
                    <div class="segmented-filter" role="group" aria-label="Mesure">${seg('dash_mesure', 'ca', 'CA', t.metric === 'ca', !t.hasCa, t.hasCa ? '' : 'Aucun tarif client connu pour ces livraisons')}${seg('dash_mesure', 'bt', 'Bouteilles', t.metric === 'bt')}</div>
                </div>
            </div>
            <div class="dash-stats">
                ${dashStatHtml('CA livré', t.hasCa ? formatChf(t.totals.ca) : '—', t.totals.sansTarif ? `${dashPlural(t.totals.sansTarif, 'livraison')} sans tarif` : '')}
                ${dashStatHtml('Bouteilles livrées', twinFmtInt(t.totals.bt), t.ventesDirectes ? `+ ${twinFmtInt(t.ventesDirectes)} en vente directe` : '')}
                ${dashStatHtml('Livraisons', twinFmtInt(t.totals.livraisons))}
                ${dashStatHtml('Panier moyen', panier === null ? '—' : formatChf(panier))}
                ${dashStatHtml('Bouteilles produites', twinFmtInt(t.produites))}
            </div>
            ${t.totals.livraisons === 0
                ? dashEmptyHtml('ventes', 'Aucune livraison sur la période', 'Les commandes livrées apparaîtront ici, avec le CA calculé depuis les tarifs clients.', 'neutral')
                : `
                <div class="dash-trends-body">
                    <div class="dash-trends-chart">
                        <h4 class="dash-subtitle">${escapeHtml(titre)}</h4>
                        ${dashChartHtml(t, titre)}
                    </div>
                    <div class="dash-trends-side">
                        ${dashRankHtml('Meilleurs clients', t.clients, t.metric, fmt)}
                        ${dashRankHtml('Ventes par arôme', t.aromes, t.metric, fmt, true)}
                    </div>
                </div>`}
        </section>`;
};

// Mémoire des <details data-dash-key> ouverts, le temps de la session (tableau de bord, pointage)
const bindDetailsMemoire = () => {
    document.querySelectorAll('#content details[data-dash-key]').forEach(d => {
        d.addEventListener('toggle', () => {
            if (d.open) _dashOpen.add(d.dataset.dashKey);
            else _dashOpen.delete(d.dataset.dashKey);
        });
    });
};

// Infobulle du graphique (survol, focus clavier, toucher) et mémoire des <details>
const dashBindInteractions = () => {
    bindDetailsMemoire();
    bindBarChart(document.getElementById('dashChart'));
};

// Infobulle d'un histogramme .dash-chart (tableau de bord, année du pointage)
const bindBarChart = (chart) => {
    const tip = chart?.querySelector('.dash-tip');
    if (!chart || !tip) return;
    const plot = chart.querySelector('.dash-chart-plot');
    let current = null;
    const hide = () => {
        current?.classList.remove('is-hover');
        current = null;
        tip.hidden = true;
    };
    const show = (col) => {
        if (!col || col === current) return;
        hide();
        current = col;
        col.classList.add('is-hover');
        tip.querySelector('.dash-tip-value').textContent = col.dataset.value || '';
        tip.querySelector('.dash-tip-label').textContent = col.dataset.title || '';
        tip.querySelector('.dash-tip-sub').textContent = col.dataset.sub || '';
        tip.hidden = false;
        const box = plot.getBoundingClientRect();
        const bar = col.querySelector('.dash-bar').getBoundingClientRect();
        const half = tip.offsetWidth / 2;
        tip.style.left = `${Math.min(Math.max(bar.left + bar.width / 2 - box.left, half), box.width - half)}px`;
        tip.style.top = `${bar.top - box.top - 8}px`;
    };
    // Un seul arrêt de tabulation, sur la barre active ; les flèches parcourent les barres
    const cols = [...chart.querySelectorAll('.dash-col')];
    chart.addEventListener('focusin', (e) => {
        const col = e.target.closest('.dash-col');
        if (!col) return;
        cols.forEach(c => { c.tabIndex = c === col ? 0 : -1; });
        show(col);
    });
    chart.addEventListener('keydown', (e) => {
        const col = e.target.closest('.dash-col');
        if (!col) return;
        const i = cols.indexOf(col);
        const next = cols[{ ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: cols.length - 1 }[e.key]];
        if (!next) return;
        e.preventDefault();
        next.focus();
    });
    chart.addEventListener('pointerover', (e) => show(e.target.closest('.dash-col')));
    chart.addEventListener('click', (e) => show(e.target.closest('.dash-col')));
    // Au toucher, l'infobulle reste affichée jusqu'au prochain geste
    chart.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') hide(); });
    chart.addEventListener('focusout', (e) => { if (!chart.contains(e.relatedTarget)) hide(); });
};

// Élément actif à re-cibler après un re-rendu (sélecteur construit sur ses data-*)
const dashFocusSelector = () => {
    const el = document.activeElement;
    if (!el || !el.closest?.('.dash') || !el.hasAttribute('data-click')) return null;
    return {
        exact: ['data-click', 'data-id', 'data-name', 'data-value', 'data-date']
            .filter(a => el.hasAttribute(a))
            .map(a => `[${a}="${CSS.escape(el.getAttribute(a))}"]`).join(''),
        byId: el.hasAttribute('data-id') ? `[data-id="${CSS.escape(el.getAttribute('data-id'))}"]` : null
    };
};

const renderDashboard = () => {
    const m = buildDashboardModel();
    const periode = DB.getFilter('dash_periode') === 'mois' ? 'mois' : 'semaines';
    const mesure = DB.getFilter('dash_mesure') === 'bt' ? 'bt' : 'ca';
    const tendances = buildDashboardTrends(m, periode, mesure);

    // Un re-rendu (instantané d'un autre appareil, pointage…) ne doit faire
    // perdre ni la tâche en cours de saisie ni le focus clavier
    const input = document.getElementById('todoInput');
    const draft = input ? { value: input.value, focused: document.activeElement === input } : null;
    const focus = dashFocusSelector();

    safeRender(`
        <div class="dash">
            ${dashHeaderHtml(m)}
            <div class="dash-kpis">${dashKpisHtml(m)}</div>
            <div class="dash-grid">
                ${dashPrioritesHtml(m)}
                ${dashLivraisonsHtml(m)}
                ${dashProductionHtml(m)}
                <div class="dash-stack">
                    ${dashEquipeHtml(m)}
                    ${dashTodosHtml(m)}
                </div>
            </div>
            ${dashTendancesHtml(tendances)}
        </div>
    `);

    const newInput = document.getElementById('todoInput');
    if (draft && newInput) {
        newInput.value = draft.value;
        if (draft.focused) newInput.focus({ preventScroll: true });
    }
    if (focus) {
        const target = document.querySelector(`.dash ${focus.exact}`) || (focus.byId && document.querySelector(`.dash ${focus.byId}`));
        target?.focus({ preventScroll: true });
    }
    dashBindInteractions();
};
