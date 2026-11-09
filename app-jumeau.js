// =============================================================================
// Jumeau numérique 3D (v12.0) — TWIN-3D
// L'atelier ThéCol reconstruit en 3D à partir des données synchronisées :
// cuves (besoins de production), entrepôt (lots par arôme × format), quai
// d'expédition (commandes actives), magasin (consommables) et équipe
// (pointages du jour). Three.js est embarqué dans vendor/three/ et chargé à la
// demande via import() : aucun coût pour les autres pages, fonctionne hors ligne.
// =============================================================================

const TWIN_ZONES = [
    { id: 'production', label: 'Production', key: '1', bounds: [-11.6, -7.6, -2.0, -1.3], token: '--primary' },
    { id: 'stock', label: 'Entrepôt', key: '2', bounds: [2.0, -7.6, 11.6, -1.3], token: '--info' },
    { id: 'expedition', label: 'Expédition', key: '3', bounds: [2.0, 1.7, 11.6, 7.6], token: '--warning' },
    { id: 'magasin', label: 'Consommables', key: '4', bounds: [-11.6, 1.7, -2.0, 7.6], token: '--warning-dark' },
    { id: 'equipe', label: 'Équipe', key: '5', bounds: [-1.5, 1.7, 1.5, 7.6], token: '--success' }
];
const TWIN_VIEW_OVERVIEW = { target: [0.2, -0.6, 0.2], pos: [2.6, 23.5, 19.5] };
const TWIN_STAFF_COLORS = ['#5D7B3E', '#2E72B8', '#B9770E', '#8E44AD', '#C0392B', '#16A085', '#D35400', '#34495E'];

const twinClamp = (v, min, max) => Math.min(max, Math.max(min, v));
const twinFmtInt = (n) => Math.round(Number(n) || 0).toLocaleString('fr-CH');
const twinFmtLitres = (l) => `${(Math.round((Number(l) || 0) * 10) / 10).toLocaleString('fr-CH')} L`;
const twinFmtDuration = (minutes) => {
    const m = Math.max(0, Math.round(Number(minutes) || 0));
    return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
};
const twinDaysUntil = (dateStr) => {
    if (!dateStr || !isValidDateOnly(dateStr)) return null;
    return Math.round((dateOnly(dateStr).getTime() - dateOnly(new Date()).getTime()) / 86400000);
};
const twinRelativeDay = (days) => {
    if (days === null) return 'sans date';
    if (days === 0) return "aujourd'hui";
    if (days === 1) return 'demain';
    if (days === -1) return 'hier';
    return days > 0 ? `dans ${days} j` : `en retard de ${-days} j`;
};
// Caisse IFCO 60 × 40 cm : 50 bouteilles de 25 cl, 40 de 50 cl ou 16 de 1 L
const twinCrateSize = (contenanceCl) => (contenanceCl <= 30 ? 50 : contenanceCl <= 60 ? 40 : 16);

// --- Modèle : projection des tables métier vers les objets de l'atelier ---
const buildTwinModel = () => {
    const now = new Date();
    const todayKey = getLocalDateISOString();
    const lots = DB.get('lots') || [];
    const commandes = DB.get('commandes') || [];
    const aromes = DB.get('aromes') || [];
    const formats = DB.get('formats') || [];
    const clients = DB.get('clients') || [];
    const inventaire = DB.get('inventaire') || [];
    const employees = DB.get('employees') || [];
    const pointages = DB.get('pointages') || [];

    const findArome = (nom) => aromes.find(a => normalizeName(a.nom) === normalizeName(nom));
    const aromeColor = (nom) => safeColor(findArome(nom)?.couleur || DEFAULT_COULEURS[String(nom || '').toLowerCase()]);
    const aromeNames = new Map();
    const formatNames = new Map();
    const addName = (map, nom) => {
        const k = normalizeName(nom);
        if (k && !map.has(k)) map.set(k, nom);
    };
    aromes.filter(a => a.actif !== false).forEach(a => addName(aromeNames, a.nom));
    [...formats]
        .sort((a, b) => (Number(a.contenanceCl) || 0) - (Number(b.contenanceCl) || 0))
        .forEach(f => addName(formatNames, f.nom));

    const activeCommandes = commandes.filter(c => c.statut !== 'annulee' && c.statut !== 'livrée');
    const demand = new Map();
    // Demande des commandes actives : la règle d'attribution commune (commandes
    // « produites » d'abord, puis par date de livraison, durée de vie client),
    // comme la page Stock et le plan de production
    const attribution = planAttributionCommandes(now);
    attribution.plan.forEach(({ lignes }) => lignes.forEach(l => {
        const key = `${normalizeName(l.arome.nom)}|${normalizeName(l.format.nom)}`;
        demand.set(key, (demand.get(key) || 0) + l.demande);
    }));

    const groups = new Map();
    lots.forEach(lot => {
        if ((Number(lot.quantite) || 0) <= 0) return;
        addName(aromeNames, lot.arome);
        addName(formatNames, lot.format);
        const key = `${normalizeName(lot.arome)}|${normalizeName(lot.format)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(lot);
    });

    // L'entrepôt ne montre que ce qui est en stock : ce qui manque pour les commandes se lit en Production
    const slotKeys = new Set(groups.keys());
    const slotList = [...slotKeys];
    const rowKeys = [...aromeNames.keys()].filter(ak => slotList.some(k => k.startsWith(`${ak}|`)));
    const colKeys = [...formatNames.keys()].filter(fk => slotList.some(k => k.endsWith(`|${fk}`)));

    const stacks = [];
    rowKeys.forEach((ak, row) => colKeys.forEach((fk, col) => {
        const key = `${ak}|${fk}`;
        if (!slotKeys.has(key)) return;
        const arome = aromeNames.get(ak);
        const format = formatNames.get(fk);
        const contenanceCl = resolveFormatContenance(format, formats);
        const lotsInfo = (groups.get(key) || [])
            .slice()
            .sort((a, b) => String(a.dlv || a.dlc || '').localeCompare(String(b.dlv || b.dlc || '')))
            .map(lot => ({
                id: lot.id,
                numero: getLotNumero(lot),
                quantite: Number(lot.quantite) || 0,
                dlv: lot.dlv || '',
                dlc: lot.dlc || '',
                dateProduction: lot.dateProduction || '',
                status: getLotStatus(lot, now),
                bloque: !!lot.bloque,
                sellable: isLotSellable(lot, now)
            }));
        const total = lotsInfo.reduce((s, l) => s + l.quantite, 0);
        const sellable = lotsInfo.filter(l => l.sellable).reduce((s, l) => s + l.quantite, 0);
        const expired = lotsInfo.filter(l => l.status === 'expired').length;
        const invendable = lotsInfo.filter(l => l.status === 'invendable').length;
        const warning = lotsInfo.filter(l => l.status === 'warning').length;
        const demande = demand.get(key) || 0;
        stacks.push({
            id: `stack:${key}`, zone: 'stock', kind: 'stack', row, col,
            arome, format, couleur: aromeColor(arome), contenanceCl, crateSize: twinCrateSize(contenanceCl),
            total, sellable, demande, expired, invendable, warning, lots: lotsInfo,
            status: expired ? 'expired' : invendable ? 'invendable' : warning ? 'warning' : 'ok',
            label: `${arome} · ${format}`,
            sub: `${twinFmtInt(sellable)} bt vendables`
        });
    }));

    // Plan de production commun (page Production) : brassins par échéance,
    // récipients placés sur les postes de l'atelier fournée après fournée ; la
    // 1re fournée occupe l'atelier, les suivantes sont « en attente »
    const plan = buildProductionPlan({ referenceDate: now, attribution });
    const productionAromes = plan.brassins.map(b => {
        const couleur = aromeColor(b.aromeNom);
        return {
            arome: b.aromeNom, couleur, litres: Math.round(b.litres * 10) / 10, hasRecette: !!b.recette,
            besoins: b.besoins.map(x => ({ format: x.formatNom, bouteilles: x.aProduire, litres: x.aProduire * x.contenanceCl / 100 })),
            bouteilles: b.bouteilles,
            urgency: b.echeance ?? 9999,
            recipients: b.recipients.map(r => ({
                ...r, arome: b.aromeNom, couleur, hasRecette: !!b.recette,
                poste: r.fournee === 1 ? r.poste : null
            }))
        };
    });
    const enAttente = productionAromes.flatMap(p => p.recipients.filter(r => r.fournee > 1));
    const premiere = plan.fournees[0] || atelierPostesVides();
    const twinRecipient = (r) => r && productionAromes.flatMap(p => p.recipients)
        .find(x => x.fournee === 1 && x.posteKind === r.posteKind && x.posteNumero === r.posteNumero);
    const equipementItem = (kind, numero, capacite, r) => ({
        id: `equip:${kind}-${numero}`, zone: 'production', kind, numero, capacite,
        arome: r?.arome || '', couleur: r?.couleur || '', litres: r?.litres || 0,
        fill: r ? twinClamp(r.litres / capacite, 0, 1) : 0,
        ingredients: r?.ingredients || [], hasRecette: r ? r.hasRecette : true,
        status: r ? 'planned' : 'idle',
        label: kind === 'cuve' ? `Cuve ${numero} · ${capacite} L` : `Casserole ${capacite} L · plaque ${numero}`,
        sub: r ? `${r.arome} · ${twinFmtLitres(r.litres)}` : (kind === 'cuve' ? 'Libre' : 'Plaque éteinte')
    });
    const equipement = [
        ...premiere.cuves.map(p => equipementItem('cuve', p.numero, p.capacite, twinRecipient(p.recipient))),
        ...premiere.casseroles.map(p => equipementItem('casserole', p.numero, p.capacite, twinRecipient(p.recipient)))
    ];
    const production = {
        aromes: productionAromes,
        enAttente,
        litres: Math.round(productionAromes.reduce((sum, p) => sum + p.litres, 0) * 10) / 10,
        bouteilles: productionAromes.reduce((sum, p) => sum + p.bouteilles, 0),
        postesOccupes: equipement.filter(e => e.status === 'planned').length
    };

    const orders = activeCommandes
        .filter(c => c.statut === 'en_attente' || c.statut === 'produite')
        .map(cmd => {
            const client = clients.find(c => c.id === cmd.clientId);
            const days = twinDaysUntil(cmd.dateLivraison);
            const items = getItems(cmd).map(item => {
                const arome = aromes.find(a => a.id === item.aromeId);
                const format = resolveCommandeFormat(item, formats)?.format;
                return {
                    arome: arome?.nom || '—',
                    format: format?.nom || '—',
                    contenanceCl: format ? (Number(format.contenanceCl) || resolveFormatContenance(format.nom, formats) || 50) : 50,
                    quantite: Number(item.quantite) || 0,
                    couleur: safeColor(arome?.couleur)
                };
            });
            const totalBt = items.reduce((s, i) => s + i.quantite, 0);
            const late = days !== null && days < 0;
            const urgent = !late && cmd.statut === 'en_attente' && days !== null && days <= 3;
            let montant = null;
            try { montant = getCommandeMontant(cmd, clients, formats); } catch (_) { montant = null; }
            const numero = getCommandeNumero(cmd);
            return {
                id: `order:${cmd.id}`, zone: 'expedition', kind: 'order', commandeId: cmd.id,
                numero, client: getClientLabel(client), statut: cmd.statut,
                dateLivraison: cmd.dateLivraison || '', days, late, urgent, totalBt, items, montant,
                status: late ? 'late' : urgent ? 'urgent' : cmd.statut === 'produite' ? 'ready' : 'waiting',
                label: `#${numero} · ${getClientLabel(client)}`,
                sub: `${twinFmtInt(totalBt)} bt · livraison ${twinRelativeDay(days)}`
            };
        })
        .sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999));

    const bins = inventaire
        .filter(i => i.categorie === 'consommable')
        .sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr'))
        .map(i => {
            const quantite = Number(i.quantite) || 0;
            const seuil = Number(i.seuilAlerte) || 0;
            const state = seuil > 0
                ? (quantite <= seuil ? 'critical' : quantite <= seuil * 2 ? 'low' : 'ok')
                : (quantite <= 0 ? 'empty' : 'unknown');
            return {
                id: `bin:${i.id}`, zone: 'magasin', kind: 'bin', itemId: i.id,
                nom: i.nom || 'Article', quantite, unite: i.unite, seuil, state, bouteilleCl: Number(i.bouteilleCl) || 0,
                level: seuil > 0 ? twinClamp(quantite / (seuil * 4), 0.06, 1) : (quantite > 0 ? 0.55 : 0),
                label: i.nom || 'Article',
                sub: `${quantite} ${displayUnit(i.unite)}${seuil > 0 ? ` · seuil ${seuil}` : ''}`
            };
        });

    const staff = employees.filter(e => e.actif).map((emp, index) => {
        const todays = pointages.filter(p => p.employeId === emp.id && p.date === todayKey);
        const open = findPointageEnCours(pointages, emp.id, todayKey);
        const minutes = todays.reduce((s, p) => s + pointageDuree(p, now), 0);
        const nom = `${emp.prenom || ''} ${emp.nom || ''}`.trim() || 'Employé';
        return {
            id: `staff:${emp.id}`, zone: 'equipe', kind: 'staff', employeId: emp.id, nom,
            initiales: nom.split(/\s+/).map(p => p[0] || '').join('').slice(0, 2).toUpperCase(),
            present: !!open, since: open?.heureDebut || '', minutes,
            couleur: TWIN_STAFF_COLORS[index % TWIN_STAFF_COLORS.length],
            status: open ? 'present' : 'absent',
            label: nom,
            sub: open ? `Présent depuis ${open.heureDebut}` : (minutes > 0 ? `Parti · ${twinFmtDuration(minutes)} aujourd'hui` : 'Absent')
        };
    });

    const alerts = [];
    orders.forEach(o => {
        if (o.late) alerts.push({ level: 'danger', id: o.id, title: `Commande #${o.numero} en retard`, text: `${o.client} · prévue le ${formatDate(o.dateLivraison)}` });
        else if (o.urgent) alerts.push({ level: 'warning', id: o.id, title: `Livraison ${twinRelativeDay(o.days)} · #${o.numero}`, text: `${o.client} · encore à produire` });
    });
    stacks.forEach(s => {
        if (s.expired) alerts.push({ level: 'danger', id: s.id, title: `${s.label} : ${s.expired} lot${s.expired > 1 ? 's' : ''} expiré${s.expired > 1 ? 's' : ''}`, text: 'À retirer ou corriger dans le stock' });
        else if (s.invendable) alerts.push({ level: 'danger', id: s.id, title: `${s.label} : ${s.invendable} lot${s.invendable > 1 ? 's' : ''} invendable${s.invendable > 1 ? 's' : ''}`, text: 'DLV dépassée : sortie (échantillon, casse, destruction) uniquement' });
        else if (s.warning) alerts.push({ level: 'info', id: s.id, title: `${s.label} : DLV proche`, text: `${s.warning} lot${s.warning > 1 ? 's' : ''} à écouler en priorité` });
    });
    productionAromes.forEach(p => {
        const poste = equipement.find(e => e.arome === p.arome) || equipement[0];
        if (!poste) return;
        alerts.push({ level: 'warning', id: poste.id, title: `${p.arome} : ${twinFmtLitres(p.litres)} à produire`, text: `${twinFmtInt(p.bouteilles)} bt manquantes · ${p.recipients.map(r => r.poste || `fournée ${r.fournee}`).join(', ')}` });
    });
    if (enAttente.length && equipement[0]) {
        alerts.push({ level: 'info', id: equipement[0].id, title: `${enAttente.length} contenant${enAttente.length > 1 ? 's' : ''} en attente`, text: `Capacité de l'atelier atteinte : ${plan.fournees.length} fournées prévues` });
    }
    bins.forEach(b => {
        if (b.state === 'critical') alerts.push({ level: 'danger', id: b.id, title: `${b.nom} sous le seuil`, text: `${b.quantite} ${displayUnit(b.unite)} (seuil ${b.seuil})` });
        else if (b.state === 'low') alerts.push({ level: 'warning', id: b.id, title: `${b.nom} bientôt épuisé`, text: `${b.quantite} ${displayUnit(b.unite)} (seuil ${b.seuil})` });
    });
    const levelOrder = { danger: 0, warning: 1, info: 2 };
    alerts.sort((a, b) => levelOrder[a.level] - levelOrder[b.level]);

    const kpis = {
        aProduireL: production.litres,
        aProduireBt: production.bouteilles,
        postesOccupes: production.postesOccupes,
        postesTotal: equipement.length,
        enAttente: enAttente.length,
        stockVendable: stacks.reduce((s, x) => s + x.sellable, 0),
        lotsExpires: stacks.reduce((s, x) => s + x.expired, 0),
        lotsInvendables: stacks.reduce((s, x) => s + x.invendable, 0),
        lotsWarning: stacks.reduce((s, x) => s + x.warning, 0),
        commandes: orders.length,
        urgentes: orders.filter(o => o.urgent).length,
        enRetard: orders.filter(o => o.late).length,
        pretes: orders.filter(o => o.statut === 'produite').length,
        consoCritiques: bins.filter(b => b.state === 'critical').length,
        consoBas: bins.filter(b => b.state === 'low').length,
        consoTotal: bins.length,
        presents: staff.filter(s => s.present).length,
        effectif: staff.length
    };

    const items = [...equipement, ...stacks, ...orders, ...bins, ...staff];
    return {
        builtAt: now, equipement, production, stacks, orders, bins, staff, alerts, kpis, items,
        byId: new Map(items.map(i => [i.id, i])),
        grid: { rows: rowKeys.map(k => aromeNames.get(k)), cols: colKeys.map(k => formatNames.get(k)) }
    };
};

// --- Moteur 3D ---
const Twin = {
    lib: null,
    loading: null,
    supported: null,
    gpu: '',
    renderer: null,
    scene: null,
    camera: null,
    controls: null,
    composer: null,
    aoPass: null,
    envTarget: null,
    raycaster: null,
    ndc: null,
    dynamic: null,
    markers: null,
    container: null,
    labelsEl: null,
    tooltipEl: null,
    model: null,
    objects: new Map(),
    pickables: [],
    labels: [],
    signatures: new Map(),
    prevFill: new Map(),
    fills: [],
    flashes: [],
    steam: [],
    cutaways: [],
    pulseMats: [],
    selectedId: null,
    hoveredId: null,
    focusZone: 'overview',
    tween: null,
    raf: 0,
    warming: false,
    needsRender: true,
    pointer: null,
    pointerDirty: false,
    downAt: null,
    resizeObserver: null,
    viewInitialized: false,
    size: null,
    viewOffset: { x: 0, y: 0 },
    viewOffsetTarget: { x: 0, y: 0 },
    quality: null,
    autoQuality: null,
    dprCap: 0,
    perf: { last: 0, smooth: false, time: 0, frames: 0, slow: 0 },
    labelsKey: '',
    geo: {},
    mats: {},
    variants: new Map(),
    textures: [],
    texSets: {},
    palette: null,
    tmp: null
};

const _twinMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
const twinReducedMotion = () => !!_twinMotionQuery?.matches;

// Three.js r185 exige WebGL 2 ; on relève au passage le GPU pour choisir la qualité
const twinIsSupported = () => {
    if (Twin.supported !== null) return Twin.supported;
    try {
        const gl = document.createElement('canvas').getContext('webgl2');
        Twin.supported = !!gl;
        if (gl) {
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            Twin.gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
        }
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch (_) {
        Twin.supported = false;
    }
    return Twin.supported;
};

const twinLoadLibrary = () => {
    if (Twin.lib) return Promise.resolve(Twin.lib);
    if (!Twin.loading) {
        Twin.loading = Promise.all([
            import('./vendor/three/three.module.min.js'),
            import('./vendor/three/OrbitControls.js'),
            import('./vendor/three/EffectComposer.js'),
            import('./vendor/three/RenderPass.js'),
            import('./vendor/three/GTAOPass.js'),
            import('./vendor/three/OutputPass.js')
        ]).then(([THREE, controls, composer, render, gtao, output]) => {
            Twin.lib = {
                THREE,
                OrbitControls: controls.OrbitControls,
                EffectComposer: composer.EffectComposer,
                RenderPass: render.RenderPass,
                GTAOPass: gtao.GTAOPass,
                OutputPass: output.OutputPass
            };
            return Twin.lib;
        }).catch(err => {
            Twin.loading = null;
            throw err;
        });
    }
    return Twin.loading;
};

const twinCssColor = (name, fallback) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return /^#[0-9a-f]{3,8}$/i.test(v) ? v : fallback;
};

// --- Qualité du rendu : choisie selon l'appareil (Auto) ou imposée depuis le jumeau ---
// ambient : cadence max. (i/s) des animations d'ambiance (pulsations, vapeur) ; 0 = figées, la scène
// n'est redessinée que lorsqu'elle change (caméra, données)
const TWIN_QUALITY_LEVELS = {
    low: { label: 'Économie', dpr: 1.25, shadow: 1536, ao: 0, tex: 256, segments: 12, steam: 8, ambient: 0 },
    medium: { label: 'Standard', dpr: 1.6, shadow: 3072, ao: 0.5, tex: 512, segments: 20, steam: 14, ambient: 15 },
    high: { label: 'Haute', dpr: 2, shadow: 4096, ao: 1, tex: 1024, segments: 28, steam: 20, ambient: 30 }
};
const TWIN_QUALITY_ORDER = ['low', 'medium', 'high'];

const twinQualitySetting = () => {
    const v = DB.getFilter('twin_quality');
    return TWIN_QUALITY_LEVELS[v] ? v : 'auto';
};

const twinDetectQuality = () => {
    const mq = (q) => !!window.matchMedia?.(q).matches;
    const handheld = (mq('(pointer: coarse)') && !mq('(pointer: fine)')) || mq('(max-width: 768px)');
    const gpu = Twin.gpu || '';
    // Téléphones et tablettes, même récents : l'occlusion ambiante et le rendu continu les saturent
    if (handheld || /swiftshader|llvmpipe|software|basic render/i.test(gpu)) return 'low';
    if (/intel|uhd|iris|mali|adreno|powervr/i.test(gpu) && !/\barc\b/i.test(gpu)) return 'medium';
    return 'high';
};

const twinResolveQuality = () => {
    const setting = twinQualitySetting();
    if (setting !== 'auto') return setting;
    if (!Twin.autoQuality) Twin.autoQuality = twinDetectQuality();
    return Twin.autoQuality;
};

// Définition du rendu : plafonnée par la qualité, puis à 1 si l'Économie reste saccadée (Auto uniquement)
const twinPixelRatio = () => Math.min(window.devicePixelRatio || 1, Twin.quality.dpr, (Twin.quality.setting === 'auto' && Twin.dprCap) || Infinity);

const twinRefreshPixelRatio = () => {
    if (!Twin.renderer || Twin.renderer.getPixelRatio() === twinPixelRatio()) return;
    Twin.renderer.setPixelRatio(twinPixelRatio());
    twinResize();
};

// Économie : pas de flou d'arrière-plan sur le HUD (recalculé à chaque image du canvas, très coûteux sur mobile)
const twinSyncLiteClass = () => Twin.container?.classList.toggle('twin--lite', Twin.quality?.level === 'low');

// --- Géométries et matériaux partagés (mis en cache, libérés à chaque reconstruction du monde) ---
const twinGeo = (key, factory) => Twin.geo[key] || (Twin.geo[key] = factory());
const twinMat = (key, factory) => Twin.mats[key] || (Twin.mats[key] = factory());
const twinStd = (key, color, opts = {}) => twinMat(`std:${key}:${color}`, () =>
    new Twin.lib.THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, ...opts }));
const twinBasic = (key, color, opts = {}) => twinMat(`basic:${key}:${color}`, () =>
    new Twin.lib.THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6, ...opts }));
const twinLathe = (points, segments, phiStart = 0) => new Twin.lib.THREE.LatheGeometry(
    points.map(([x, y]) => new Twin.lib.THREE.Vector2(x, y)), segments, phiStart);

// Shaders : UV en coordonnées monde (une texture garde son échelle sur une boîte étirée)
// et arêtes adoucies des boîtes unitaires (normales arrondies sur quelques millimètres).
const TWIN_GLSL_VERT_DECL = `
uniform float twinWorldUv;
varying vec3 vTwinP;
varying vec3 vTwinH;
varying vec3 vTwinX;
varying vec3 vTwinY;
varying vec3 vTwinZ;`;
const TWIN_GLSL_VERT = `
mat4 twinM = modelMatrix;
#ifdef USE_INSTANCING
	twinM = modelMatrix * instanceMatrix;
#endif
vec3 twinS = vec3( length( twinM[ 0 ].xyz ), length( twinM[ 1 ].xyz ), length( twinM[ 2 ].xyz ) );
vTwinH = 0.5 * twinS;
vTwinP = position * twinS;
vTwinX = normalize( ( viewMatrix * vec4( twinM[ 0 ].xyz, 0.0 ) ).xyz );
vTwinY = normalize( ( viewMatrix * vec4( twinM[ 1 ].xyz, 0.0 ) ).xyz );
vTwinZ = normalize( ( viewMatrix * vec4( twinM[ 2 ].xyz, 0.0 ) ).xyz );
if ( twinWorldUv > 0.0 ) {
	vec3 twinW = ( twinM * vec4( position, 1.0 ) ).xyz;
	vec3 twinN = abs( normalize( mat3( twinM ) * normal ) );
	vec2 twinUv = ( twinN.y > 0.5 ? twinW.xz : ( twinN.x > 0.5 ? twinW.zy : twinW.xy ) ) * twinWorldUv;
	#ifdef USE_MAP
		vMapUv = twinUv;
	#endif
	#ifdef USE_NORMALMAP
		vNormalMapUv = twinUv;
	#endif
	#ifdef USE_ROUGHNESSMAP
		vRoughnessMapUv = twinUv;
	#endif
}`;
const TWIN_GLSL_FRAG_DECL = `
uniform float twinBevel;
varying vec3 vTwinP;
varying vec3 vTwinH;
varying vec3 vTwinX;
varying vec3 vTwinY;
varying vec3 vTwinZ;`;
const TWIN_GLSL_FRAG = `
if ( twinBevel > 0.0 ) {
	float twinR = min( twinBevel, 0.7 * min( vTwinH.x, min( vTwinH.y, vTwinH.z ) ) );
	vec3 twinQ = max( abs( vTwinP ) - ( vTwinH - twinR ), 0.0 ) * sign( vTwinP );
	float twinL = dot( twinQ, twinQ );
	if ( twinL > 1e-12 ) {
		twinQ *= inversesqrt( twinL );
		vec3 twinB = normalize( twinQ.x * vTwinX + twinQ.y * vTwinY + twinQ.z * vTwinZ );
		normal = normalize( normal + twinB - nonPerturbedNormal );
	}
}`;

const twinPatchMaterial = (mat, { worldUv = 0, bevel = 0 } = {}) => {
    if (!worldUv && !bevel) return mat;
    mat.onBeforeCompile = (shader) => {
        shader.uniforms.twinWorldUv = { value: worldUv };
        shader.uniforms.twinBevel = { value: bevel };
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>${TWIN_GLSL_VERT_DECL}`)
            .replace('#include <uv_vertex>', `#include <uv_vertex>${TWIN_GLSL_VERT}`);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>${TWIN_GLSL_FRAG_DECL}`)
            .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>${TWIN_GLSL_FRAG}`);
    };
    mat.customProgramCacheKey = () => 'twin-patch';
    return mat;
};

// Matériau texturé en coordonnées monde (sols, murs, plans de travail)
const twinSurf = (key, opts, worldUv, bevel = 0.008) => twinMat(`surf:${key}`, () => {
    const mat = new Twin.lib.THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, ...opts });
    mat.userData.worldUv = worldUv;
    mat.userData.bevel = bevel;
    return twinPatchMaterial(mat, { worldUv });
});

// Variante à arêtes adoucies, appliquée automatiquement aux boîtes (Économie : sans)
const twinBevelMat = (mat) => {
    if (Twin.quality?.level === 'low' || mat.side === Twin.lib.THREE.DoubleSide || mat.userData.bevel === 0) return mat;
    let variant = Twin.variants.get(mat);
    if (!variant) {
        variant = mat.clone();
        twinPatchMaterial(variant, { worldUv: mat.userData.worldUv || 0, bevel: mat.userData.bevel ?? 0.004 });
        Twin.variants.set(mat, variant);
    }
    return variant;
};

const twinMesh = (geometry, material, { cast = true, receive = false } = {}) => {
    const mesh = new Twin.lib.THREE.Mesh(geometry, material);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    return mesh;
};

// --- Textures procédurales : dessinées une fois au premier affichage (aucun fichier image) ---
const twinRandom = (seed) => {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

// Bruit de valeur fractal périodique (texture répétable sans couture) en [0, 1].
// stretch > 1 allonge le motif horizontalement (inox brossé), < 1 verticalement (fil du bois).
const twinNoise = (size, { cells = 8, octaves = 4, seed = 1, stretch = 1 } = {}) => {
    const out = new Float32Array(size * size);
    let amp = 1;
    let total = 0;
    for (let o = 0; o < octaves; o++) {
        const base = cells * (1 << o);
        const ny = Math.max(1, Math.min(size, Math.round(stretch >= 1 ? base : base * stretch)));
        const nx = Math.max(1, Math.min(size, Math.round(stretch >= 1 ? base / stretch : base)));
        const rnd = twinRandom(seed * 7919 + o * 104729);
        const grid = Float32Array.from({ length: nx * ny }, rnd);
        for (let y = 0; y < size; y++) {
            const gy = y / size * ny;
            const y0 = Math.floor(gy);
            const ty = gy - y0;
            const sy = ty * ty * (3 - 2 * ty);
            const r0 = y0 * nx;
            const r1 = ((y0 + 1) % ny) * nx;
            for (let x = 0; x < size; x++) {
                const gx = x / size * nx;
                const x0 = Math.floor(gx);
                const tx = gx - x0;
                const sx = tx * tx * (3 - 2 * tx);
                const x1 = (x0 + 1) % nx;
                const a = grid[r0 + x0] + (grid[r0 + x1] - grid[r0 + x0]) * sx;
                const b = grid[r1 + x0] + (grid[r1 + x1] - grid[r1 + x0]) * sx;
                out[y * size + x] += (a + (b - a) * sy) * amp;
            }
        }
        total += amp;
        amp *= 0.5;
    }
    for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
};

const twinRgb = (hex) => {
    let h = safeColor(hex).slice(1);
    if (h.length < 6) h = h.slice(0, 3).split('').map(c => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const twinCanvas = (w, h = w) => Object.assign(document.createElement('canvas'), { width: w, height: h });

// Remplit un canvas pixel par pixel : fn(x, y, i, px) écrit [r, g, b, a] dans px
const twinPaint = (size, fn) => {
    const canvas = twinCanvas(size);
    const g = canvas.getContext('2d');
    const img = g.createImageData(size, size);
    const d = img.data;
    const px = [0, 0, 0, 255];
    for (let y = 0, i = 0; y < size; y++) {
        for (let x = 0; x < size; x++, i++) {
            px[3] = 255;
            fn(x, y, i, px);
            d[i * 4] = px[0];
            d[i * 4 + 1] = px[1];
            d[i * 4 + 2] = px[2];
            d[i * 4 + 3] = px[3];
        }
    }
    g.putImageData(img, 0, 0);
    return canvas;
};

const twinTex = (source, { srgb = true, repeat = null } = {}) => {
    const { THREE } = Twin.lib;
    const tex = new THREE.CanvasTexture(source);
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    if (repeat) tex.repeat.set(repeat[0], repeat[1]);
    tex.anisotropy = Math.min(8, Twin.renderer.capabilities.getMaxAnisotropy());
    Twin.textures.push(tex);
    return tex;
};

const twinTexSet = (key, build) => Twin.texSets[key] || (Twin.texSets[key] = build());

const twinNormalTex = (h, size, strength) => twinTex(twinPaint(size, (x, y, i, px) => {
    const l = h[y * size + (x + size - 1) % size];
    const r = h[y * size + (x + 1) % size];
    const u = h[((y + size - 1) % size) * size + x];
    const d = h[((y + 1) % size) * size + x];
    const nx = (l - r) * strength;
    const ny = (d - u) * strength;
    const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
    px[0] = (nx * inv * 0.5 + 0.5) * 255;
    px[1] = (ny * inv * 0.5 + 0.5) * 255;
    px[2] = (inv * 0.5 + 0.5) * 255;
}), { srgb: false });

const twinGrayTex = (values, size, lo, hi) => twinTex(twinPaint(size, (x, y, i, px) => {
    px[0] = px[1] = px[2] = (lo + (hi - lo) * values[i]) * 255;
}), { srgb: false });

// Linoléum (labo, stock, couloir) : marbrure fine et joint soudé tous les 2 m
const twinLinoSet = (key, base, seed) => twinTexSet(`lino:${key}`, () => {
    const S = Twin.quality.tex;
    const n = twinNoise(S, { cells: 8, octaves: 5, seed });
    const streak = twinNoise(S, { cells: 32, octaves: 2, seed: seed + 3, stretch: 8 });
    const [r, g, b] = twinRgb(base);
    const seam = Math.max(1, Math.round(S / 700));
    return {
        map: twinTex(twinPaint(S, (x, y, i, px) => {
            let k = 0.94 + n[i] * 0.09 + (streak[i] - 0.5) * 0.05;
            if (x < seam) k *= 0.82;
            px[0] = r * k;
            px[1] = g * k;
            px[2] = b * k;
        })),
        normalMap: twinNormalTex(n, S, 1.4)
    };
});

// Mosaïque 2,5 cm de la réserve et de la laverie (la texture couvre 0,5 × 0,5 m)
const twinMosaicSet = () => twinTexSet('mosaic', () => {
    const S = Twin.quality.tex;
    const tiles = 20;
    const cell = S / tiles;
    const grout = Math.max(1, cell * 0.1);
    const rnd = twinRandom(41);
    const tint = Float32Array.from({ length: tiles * tiles }, () => 0.9 + rnd() * 0.14);
    const dirt = twinNoise(S, { cells: 4, octaves: 4, seed: 12 });
    const height = new Float32Array(S * S);
    const rough = new Float32Array(S * S);
    const map = twinTex(twinPaint(S, (x, y, i, px) => {
        const tx = Math.floor(x / cell);
        const ty = Math.floor(y / cell);
        const joint = x - tx * cell < grout || y - ty * cell < grout;
        height[i] = joint ? 0 : 1;
        rough[i] = joint ? 1 : 0;
        const k = joint ? 0.78 + dirt[i] * 0.22 : tint[ty * tiles + tx] * (0.96 + dirt[i] * 0.06);
        px[0] = (joint ? 128 : 197) * k;
        px[1] = (joint ? 118 : 187) * k;
        px[2] = (joint ? 104 : 171) * k;
    }));
    return { map, normalMap: twinNormalTex(height, S, 2.2), roughnessMap: twinGrayTex(rough, S, 0.32, 0.9) };
});

// Faïence 10 × 20 cm posée droite, joints foncés (la texture couvre 0,6 × 0,6 m)
const twinFaienceSet = () => twinTexSet('faience', () => {
    const S = Math.min(512, Twin.quality.tex);
    const cw = S / 6;
    const ch = S / 3;
    const grout = Math.max(1, S / 0.6 * 0.003);
    const rnd = twinRandom(7);
    const tint = Float32Array.from({ length: 18 }, () => 0.97 + rnd() * 0.04);
    const height = new Float32Array(S * S);
    const rough = new Float32Array(S * S);
    const map = twinTex(twinPaint(S, (x, y, i, px) => {
        const tx = Math.floor(x / cw);
        const ty = Math.floor(y / ch);
        const joint = x - tx * cw < grout || y - ty * ch < grout;
        height[i] = joint ? 0 : 1;
        rough[i] = joint ? 1 : 0;
        const k = joint ? 1 : tint[ty * 6 + tx];
        px[0] = (joint ? 112 : 243) * k;
        px[1] = (joint ? 106 : 241) * k;
        px[2] = (joint ? 98 : 234) * k;
    }));
    return { map, normalMap: twinNormalTex(height, S, 1.6), roughnessMap: twinGrayTex(rough, S, 0.16, 0.85) };
});

// Cloisons de labo : panneaux blancs à joints aluminium tous les 1,2 m
const twinPanelSet = () => twinTexSet('panel', () => {
    const S = 256;
    const n = twinNoise(S, { cells: 4, octaves: 3, seed: 5 });
    return {
        map: twinTex(twinPaint(S, (x, y, i, px) => {
            const k = x < 2 ? 0.74 : 0.985 + n[i] * 0.02;
            px[0] = 237 * k;
            px[1] = 234 * k;
            px[2] = 228 * k;
        }))
    };
});

// Crépi de la chambre froide
const twinPlasterSet = () => twinTexSet('plaster', () => {
    const S = Math.min(512, Twin.quality.tex);
    return { normalMap: twinNormalTex(twinNoise(S, { cells: 24, octaves: 4, seed: 9 }), S, 3.5) };
});

// Inox brossé : rugosité et micro-relief striés
const twinBrushedSet = () => twinTexSet('brushed', () => {
    const S = Math.min(512, Twin.quality.tex);
    const n = twinNoise(S, { cells: 96, octaves: 3, seed: 17, stretch: 32 });
    return { roughnessMap: twinGrayTex(n, S, 0.2, 0.44), normalMap: twinNormalTex(n, S, 0.8) };
});

// Placage chêne doré (portes et habillage bois) : fil vertical
const twinWoodSet = () => twinTexSet('wood', () => {
    const S = Math.min(512, Twin.quality.tex);
    const grain = twinNoise(S, { cells: 2, octaves: 4, seed: 23, stretch: 1 / 40 });
    const figure = twinNoise(S, { cells: 3, octaves: 3, seed: 29 });
    return {
        map: twinTex(twinPaint(S, (x, y, i, px) => {
            const t = twinClamp(grain[i] * 0.75 + figure[i] * 0.45 - 0.1, 0, 1);
            const line = grain[i] > 0.63 ? 0.9 : 1;
            px[0] = (186 - 30 * t) * line;
            px[1] = (136 - 32 * t) * line;
            px[2] = (78 - 22 * t) * line;
        })),
        normalMap: twinNormalTex(grain, S, 0.6)
    };
});

// Plan de travail de labo en résine vert sauge
const twinCounterSet = () => twinTexSet('counter', () => {
    const S = 256;
    const n = twinNoise(S, { cells: 32, octaves: 3, seed: 37 });
    const [r, g, b] = twinRgb('#8B9A90');
    return {
        map: twinTex(twinPaint(S, (x, y, i, px) => {
            const k = 0.96 + n[i] * 0.07;
            px[0] = r * k;
            px[1] = g * k;
            px[2] = b * k;
        }))
    };
});

// Pelouse d'automne avec feuilles mortes (la texture couvre 4 × 4 m)
const twinGrassSet = () => twinTexSet('grass', () => {
    const S = Twin.quality.tex;
    const n = twinNoise(S, { cells: 16, octaves: 5, seed: 51 });
    const m = twinNoise(S, { cells: 5, octaves: 3, seed: 52 });
    const leaves = twinNoise(S, { cells: 160, octaves: 1, seed: 53 });
    return {
        map: twinTex(twinPaint(S, (x, y, i, px) => {
            const k = 0.82 + n[i] * 0.3;
            let r = (112 + 38 * m[i]) * k;
            let g = (122 + 16 * m[i]) * k;
            let b = (70 + 6 * m[i]) * k;
            // Feuilles mortes éparses (petites taches ocre et rouille)
            if (leaves[i] > 0.82) {
                const t = Math.min(1, (leaves[i] - 0.82) * 9) * 0.75;
                const red = (x * 7 + y * 13) % 5 === 0;
                r += ((red ? 172 : 196) - r) * t;
                g += ((red ? 92 : 148) - g) * t;
                b += ((red ? 46 : 64) - b) * t;
            }
            px[0] = r;
            px[1] = g;
            px[2] = b;
        })),
        normalMap: twinNormalTex(n, S, 2.4)
    };
});

// Pavés autour du bâtiment (0,30 × 0,15 m à joints décalés ; la texture couvre 1,2 m)
const twinPaverSet = () => twinTexSet('pavers', () => {
    const S = Math.min(512, Twin.quality.tex);
    const cols = 4;
    const rows = 8;
    const cw = S / cols;
    const ch = S / rows;
    const joint = Math.max(1, S / 1.2 * 0.006);
    const rnd = twinRandom(61);
    const tint = Float32Array.from({ length: cols * rows }, () => 0.86 + rnd() * 0.18);
    const n = twinNoise(S, { cells: 24, octaves: 3, seed: 62 });
    const height = new Float32Array(S * S);
    const map = twinTex(twinPaint(S, (x, y, i, px) => {
        const ty = Math.floor(y / ch);
        const xx = (x + (ty % 2) * cw / 2) % S;
        const tx = Math.floor(xx / cw);
        const j = xx - tx * cw < joint || y - ty * ch < joint;
        height[i] = j ? 0 : 0.8 + n[i] * 0.2;
        const k = j ? 0.62 : tint[ty * cols + tx] * (0.92 + n[i] * 0.12);
        px[0] = 184 * k;
        px[1] = 176 * k;
        px[2] = 164 * k;
    }));
    return { map, normalMap: twinNormalTex(height, S, 1.8) };
});

// Béton clair de la façade
const twinFacadeSet = () => twinTexSet('facade', () => {
    const S = Math.min(512, Twin.quality.tex);
    const n = twinNoise(S, { cells: 12, octaves: 5, seed: 71 });
    return {
        map: twinTex(twinPaint(S, (x, y, i, px) => {
            const k = 0.93 + n[i] * 0.1;
            px[0] = 218 * k;
            px[1] = 213 * k;
            px[2] = 204 * k;
        })),
        normalMap: twinNormalTex(n, S, 1.2)
    };
});

// Feuillage : relief de feuilles sur les houppiers
const twinLeafSet = () => twinTexSet('leaves', () => {
    const S = Math.min(512, Twin.quality.tex);
    const n = twinNoise(S, { cells: 20, octaves: 3, seed: 81 });
    return { normalMap: twinNormalTex(n, S, 5) };
});

// Parois ajourées des caisses vertes (canal d'opacité : noir = trou)
const twinLatticeSet = () => twinTexSet('lattice', () => {
    const canvas = twinCanvas(256, 128);
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#000000';
    for (let col = 0; col < 11; col++) {
        for (let row = 0; row < 3; row++) g.fillRect(16 + col * 21.4, 18 + row * 32, 13, 22);
    }
    return { alphaMap: twinTex(canvas, { srgb: false }) };
});

// Contenu des boîtes de la réserve, vu du dessus (fruits séchés, herbes, pétales, thé…)
const TWIN_CONTENT_PALETTES = {
    fruit: { bg: '#6B4A2E', items: ['#C9A06A', '#B8864F', '#D8B47E', '#9C6B3C'] },
    herbs: { bg: '#3F4F2A', items: ['#6E8B3D', '#8FA357', '#55702F', '#A3B86A'] },
    petals: { bg: '#4A1418', items: ['#8E1F2B', '#B0303A', '#6E1622', '#C2484E'] },
    flowers: { bg: '#6E5A2A', items: ['#E2C55A', '#F0DA82', '#C9A63A', '#FFF1B0'] },
    tea: { bg: '#2B1E14', items: ['#4A3322', '#5E4129', '#3A2818', '#6B4C30'] },
    caps: { bg: '#141414', items: ['#2E2E2E', '#232323', '#3A3A3A'] },
    generic: { bg: '#8C7A62', items: ['#A8957A', '#BCA98C', '#7D6B55'] }
};

const twinContentSet = (kind) => twinTexSet(`content:${kind}`, () => {
    const S = 256;
    const canvas = twinCanvas(S);
    const g = canvas.getContext('2d');
    const pal = TWIN_CONTENT_PALETTES[kind] || TWIN_CONTENT_PALETTES.generic;
    const rnd = twinRandom(kind.length * 97 + kind.charCodeAt(0));
    g.fillStyle = pal.bg;
    g.fillRect(0, 0, S, S);
    const count = kind === 'fruit' ? 260 : kind === 'caps' ? 90 : 900;
    for (let k = 0; k < count; k++) {
        const x = rnd() * S;
        const y = rnd() * S;
        g.fillStyle = pal.items[Math.floor(rnd() * pal.items.length)];
        g.beginPath();
        if (kind === 'fruit') {
            const r = 9 + rnd() * 10;
            g.ellipse(x, y, r, r * (0.55 + rnd() * 0.45), rnd() * Math.PI, 0, Math.PI * 2);
            g.fill();
            g.strokeStyle = 'rgba(86, 54, 26, 0.65)';
            g.lineWidth = 1.6;
            g.stroke();
            g.fillStyle = 'rgba(96, 62, 30, 0.45)';
            g.beginPath();
            g.arc(x, y, r * 0.2, 0, Math.PI * 2);
        } else if (kind === 'caps') {
            g.arc(x, y, 9 + rnd() * 2, 0, Math.PI * 2);
            g.fill();
            g.strokeStyle = 'rgba(255, 255, 255, 0.12)';
            g.lineWidth = 2;
            g.stroke();
            continue;
        } else {
            g.ellipse(x, y, 2 + rnd() * 5, 1.2 + rnd() * 3, rnd() * Math.PI, 0, Math.PI * 2);
        }
        g.fill();
    }
    return { map: twinTex(canvas) };
});

// Halo d'état posé au sol (anneau doux, remplace les anneaux pleins)
const twinHaloSet = () => twinTexSet('halo', () => {
    const S = 256;
    return {
        map: twinTex(twinPaint(S, (x, y, i, px) => {
            const r = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2) / (S / 2);
            const fill = 0.22 * (1 - twinClamp(r / 0.95, 0, 1));
            const ring = 0.85 * Math.exp(-(((r - 0.8) / 0.1) ** 2));
            px[0] = px[1] = px[2] = 255;
            px[3] = r >= 1 ? 0 : twinClamp(fill + ring, 0, 1) * 255;
        }))
    };
});

// Volute de vapeur (sprite doux)
const twinSteamSet = () => twinTexSet('steam', () => {
    const S = 64;
    const n = twinNoise(S, { cells: 4, octaves: 3, seed: 91 });
    return {
        map: twinTex(twinPaint(S, (x, y, i, px) => {
            const r = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2) / (S / 2);
            px[0] = px[1] = px[2] = 255;
            px[3] = twinClamp((1 - r) * 1.4, 0, 1) ** 1.6 * (0.55 + n[i] * 0.45) * 255;
        }))
    };
});

// Ciel (équirectangulaire : dégradé zénith → horizon → sol lointain)
const TWIN_SKY = { zenith: '#7FA9D8', mid: '#B9D0E6', horizon: '#E4EAEE', ground: '#CFD1CB' };
const twinSkyTexture = () => {
    const { THREE } = Twin.lib;
    const canvas = twinCanvas(4, 256);
    const g = canvas.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, TWIN_SKY.zenith);
    grad.addColorStop(0.36, TWIN_SKY.mid);
    grad.addColorStop(0.495, TWIN_SKY.horizon);
    grad.addColorStop(0.52, TWIN_SKY.ground);
    grad.addColorStop(1, '#BFC2BB');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    const tex = twinTex(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    return tex;
};

// --- Textures dessinées (plaques, enseignes, étiquettes) ---
const twinCanvasMaterial = (key, w, h, draw, opts = {}) => twinMat(`tex:${key}`, () => {
    const { THREE } = Twin.lib;
    const canvas = twinCanvas(w, h);
    draw(canvas.getContext('2d'), w, h);
    const map = twinTex(canvas, { repeat: opts.repeat });
    map.wrapS = map.wrapT = opts.repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    return new THREE.MeshStandardMaterial({ map, roughness: opts.roughness ?? 0.6, metalness: 0, ...opts.extra });
});

const twinPlateMaterial = (key, title, sub, accent) => twinCanvasMaterial(`plate:${key}`, 256, 128, (g, w, h) => {
    g.fillStyle = '#F6F5F0';
    g.fillRect(0, 0, w, h);
    g.fillStyle = accent;
    g.fillRect(0, 0, w, 16);
    g.fillStyle = '#2A2A2A';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '700 46px Outfit, sans-serif';
    g.fillText(title, w / 2, sub ? 56 : 70);
    if (sub) {
        g.fillStyle = '#6B6B6B';
        g.font = '500 30px Outfit, sans-serif';
        g.fillText(sub, w / 2, 100);
    }
});

const twinSignMaterial = (key, bg, fg, title, sub) => twinCanvasMaterial(`sign:${key}`, 1024, 256, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '700 132px Outfit, sans-serif';
    g.fillText(title, w / 2, sub ? 104 : 128);
    if (sub) {
        g.font = '500 46px Outfit, sans-serif';
        g.fillText(sub, w / 2, 200);
    }
});

// Étiquette de bouteille ThéCol (bandeau à la couleur de l'arôme), face avant au centre de la texture
const twinBottleLabelMaterial = (arome, color) => twinCanvasMaterial(`bottle:${normalizeName(arome)}:${color}`, 512, 128, (g, w, h) => {
    g.fillStyle = '#F3EEE2';
    g.fillRect(0, 0, w, h);
    g.fillStyle = color;
    g.fillRect(0, 0, w, 20);
    g.fillRect(0, h - 20, w, 20);
    g.fillStyle = '#2B2B2B';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '700 42px Outfit, sans-serif';
    g.fillText('ThéCol', w / 2, 56);
    g.font = '500 22px Outfit, sans-serif';
    g.fillText(String(arome).slice(0, 22), w / 2, 88);
}, { roughness: 0.55 });

// Fiche de casier (arôme · format) et bon de livraison posé sur les caisses
const twinTagMaterial = (key, title, sub, color) => twinCanvasMaterial(`tag:${key}`, 256, 160, (g, w, h) => {
    g.fillStyle = '#FBFAF6';
    g.fillRect(0, 0, w, h);
    g.fillStyle = color;
    g.fillRect(0, 0, 22, h);
    g.fillStyle = '#262626';
    g.textBaseline = 'middle';
    g.font = '700 34px Outfit, sans-serif';
    g.fillText(String(title).slice(0, 13), 36, 52);
    g.fillStyle = '#5E5E5E';
    g.font = '500 28px Outfit, sans-serif';
    g.fillText(String(sub).slice(0, 15), 36, 108);
}, { roughness: 0.7 });

const twinSheetMaterial = (key, numero, client, stripe) => twinCanvasMaterial(`sheet:${key}`, 256, 362, (g, w, h) => {
    g.fillStyle = '#FDFDFB';
    g.fillRect(0, 0, w, h);
    g.fillStyle = stripe;
    g.fillRect(0, 0, w, 14);
    g.fillStyle = '#5D7B3E';
    g.font = '700 26px Outfit, sans-serif';
    g.textBaseline = 'top';
    g.fillText('ThéCol', 18, 26);
    g.fillStyle = '#262626';
    g.font = '700 21px Outfit, sans-serif';
    g.fillText('BON DE LIVRAISON', 18, 66);
    g.font = '700 30px Outfit, sans-serif';
    g.fillText(`#${numero}`, 18, 98);
    g.font = '500 20px Outfit, sans-serif';
    g.fillStyle = '#4A4A4A';
    g.fillText(String(client).slice(0, 20), 18, 140);
    g.fillStyle = '#C9C6BE';
    for (let k = 0; k < 7; k++) g.fillRect(18, 186 + k * 22, w - 36 - (k % 3) * 30, 6);
    g.strokeStyle = '#B5B1A8';
    g.lineWidth = 2;
    g.strokeRect(18, 344 - 26, 90, 18);
}, { roughness: 0.85 });

// Échelle réelle : 1 unité = 1 mètre. Plan de l'étage (intérieur des façades) : labo, laverie et stock
// côté fenêtres, couloir central, réserve avec chambre froide, vestiaire-bureau et expédition.
const TWIN_PLAN = {
    x0: -12, x1: 12, z0: -8, z1: 8,
    wall: 0.25, part: 0.12,
    height: 2.9, cut: 1.1, head: 2.45,
    north: -1.06, south: 1.46, west: -1.76, east: 1.76, cold: -8.0,
    plinth: 3.6
};
// Postes du labo : cuves 25 L puis plaques à induction sur le plan de travail sous les fenêtres
const TWIN_LAB = {
    benchZ: -7.65, benchH: 0.92,
    cuve: (i) => [-11.35 + i * 0.6, -7.62],
    plate: (i) => [-11.35 + Math.min(6, CONSTANTS.ATELIER_CUVES) * 0.6 + 0.2 + i * 0.62, -7.66],
    island: [-7.0, -4.3]
};
// Cuve 25 L (cuiseur électrique inox à robinet, Ø 38 cm), casseroles 9 L / 4 L
const TWIN_CUVE = { R: 0.19 };
const TWIN_POTS = { 9: { r: 0.14, h: 0.22 }, 4: { r: 0.11, h: 0.15 } };
// Bouteilles (hauteur, diamètre) selon la contenance ; caisse IFCO = 60 × 40 cm
const twinBottleSpec = (cl) => (cl <= 30 ? { h: 0.2, d: 0.056 } : cl <= 60 ? { h: 0.25, d: 0.068 } : { h: 0.31, d: 0.085 });
// Profil de la bouteille (rayon 1 = corps, hauteur 1) : épaule longue et col large, comme les bouteilles de l'atelier
const TWIN_BOTTLE_PROFILE = [[0, 0], [0.84, 0], [0.96, 0.012], [1, 0.045], [1, 0.52], [0.985, 0.585], [0.94, 0.645], [0.86, 0.705], [0.76, 0.76], [0.67, 0.81], [0.61, 0.855], [0.585, 0.895], [0.585, 0.93], [0.63, 0.935], [0.63, 0.975], [0.6, 0.985], [0, 0.985]];
const TWIN_LIQUID_PROFILE = [[0, 0.02], [0.9, 0.02], [0.935, 0.05], [0.935, 0.52], [0.92, 0.585], [0.875, 0.645], [0.8, 0.705], [0.7, 0.76], [0.6, 0.81], [0.53, 0.85], [0, 0.85]];

// Postes de travail occupés par les employés présents (ordre de remplissage)
const TWIN_STATIONS = [
    { x: -10.45, z: -6.85, ry: Math.PI },
    { x: -8.45, z: -6.85, ry: Math.PI },
    { x: -7.6, z: -3.1, ry: Math.PI },
    { x: 3.0, z: -4.2, ry: Math.PI / 2 },
    { x: 6.55, z: 1.95, ry: 0 },
    { x: -5.4, z: 2.65, ry: Math.PI }
];

const twinGeometries = () => {
    const { THREE } = Twin.lib;
    const seg = Twin.quality.segments;
    return {
        box: twinGeo('box', () => new THREE.BoxGeometry(1, 1, 1)),
        cyl: twinGeo('cyl', () => new THREE.CylinderGeometry(1, 1, 1, seg + 4)),
        cylLow: twinGeo('cylLow', () => new THREE.CylinderGeometry(1, 1, 1, 10)),
        band: twinGeo('band', () => new THREE.CylinderGeometry(1, 1, 1, seg, 1, true, Math.PI, Math.PI * 2)),
        trunk: twinGeo('trunk', () => new THREE.CylinderGeometry(0.55, 1, 1, 9)),
        sphere: twinGeo('sphere', () => new THREE.SphereGeometry(1, seg, Math.round(seg * 0.6))),
        dome: twinGeo('dome', () => new THREE.SphereGeometry(1, seg, Math.round(seg * 0.35), 0, Math.PI * 2, 0, Math.PI / 2)),
        cone: twinGeo('cone', () => new THREE.ConeGeometry(1, 1, 24)),
        ring: twinGeo('ring', () => new THREE.RingGeometry(0.86, 1, 56)),
        plane: twinGeo('plane', () => new THREE.PlaneGeometry(1, 1)),
        capsule: twinGeo('capsule', () => new THREE.CapsuleGeometry(0.5, 1, 6, Math.max(10, seg - 4))),
        torus: twinGeo('torus', () => new THREE.TorusGeometry(1, 0.06, 8, 48)),
        crown: twinGeo('crown', () => new THREE.IcosahedronGeometry(1, Twin.quality.level === 'high' ? 2 : 1)),
        bowl: twinGeo('bowl', () => twinLathe([[0, 0], [0.42, 0.015], [0.72, 0.1], [0.9, 0.28], [0.98, 0.5], [1.02, 0.56]], seg)),
        funnel: twinGeo('funnel', () => twinLathe([[0.07, 0], [0.07, 0.3], [0.16, 0.42], [1, 0.95], [1.03, 1]], seg)),
        bottle: twinGeo('bottle', () => twinLathe(TWIN_BOTTLE_PROFILE, Math.max(10, seg - 4))),
        liquid: twinGeo('liquid', () => twinLathe(TWIN_LIQUID_PROFILE, Math.max(10, seg - 4))),
        // Cuve 25 L : paroi extérieure, rebord roulé, paroi intérieure et fond (visibles couvercle ouvert)
        cuve: twinGeo('cuve', () => twinLathe([[0, 0.03], [0.17, 0.03], [0.181, 0.04], [0.188, 0.06], [0.19, 0.09], [0.19, 0.4], [0.196, 0.404], [0.2, 0.413], [0.197, 0.421], [0.188, 0.423], [0.183, 0.41], [0.183, 0.1], [0, 0.1]], seg + 8)),
        cuveLid: twinGeo('cuveLid', () => twinLathe([[0, 0.064], [0.05, 0.06], [0.11, 0.048], [0.165, 0.026], [0.199, 0.01], [0.201, 0], [0.19, 0.004], [0, 0.004]], seg + 8)),
        pot: twinGeo('pot', () => twinLathe([[0, 0], [0.96, 0], [1, 0.04], [1, 0.97], [1.05, 1], [1.05, 1.03], [0.97, 1.03], [0.97, 0.06], [0, 0.06]], seg + 4)),
        // Blouse de labo (buste, épaules, basques) ; aplatie en profondeur à l'usage
        coat: twinGeo('coat', () => twinLathe([[0, 0.7], [0.205, 0.7], [0.2, 0.84], [0.188, 0.97], [0.174, 1.06], [0.182, 1.18], [0.194, 1.3], [0.192, 1.38], [0.17, 1.445], [0.12, 1.49], [0.072, 1.515], [0, 1.515]], Math.max(12, seg)))
    };
};

const twinMaterials = () => {
    const p = Twin.palette;
    const { THREE } = Twin.lib;
    const lino = twinLinoSet('light', '#C2BAAD', 3);
    const linoGrey = twinLinoSet('grey', '#9C968F', 4);
    const mosaic = twinMosaicSet();
    const faience = twinFaienceSet();
    const brushed = twinBrushedSet();
    const halo = twinHaloSet();
    const env = { envMap: Twin.envTarget?.texture || null };
    const glassy = { transparent: true, depthWrite: false, roughness: 0.04, metalness: 0, ...env };
    return {
        // Sols et extérieur (textures plaquées en coordonnées monde)
        floorLab: twinSurf('floorLab', { ...lino, roughness: 0.55 }, 0.5),
        floorGrey: twinSurf('floorGrey', { ...linoGrey, roughness: 0.6 }, 0.5),
        floorMosaic: twinSurf('floorMosaic', { ...mosaic, roughness: 1 }, 2),
        grass: twinSurf('grass', { ...twinGrassSet(), roughness: 0.95 }, 0.25),
        pavers: twinSurf('pavers', { ...twinPaverSet(), roughness: 0.85 }, 1 / 1.2),
        facade: twinSurf('facade', { ...twinFacadeSet(), roughness: 0.9 }, 0.5, 0.012),
        slab: twinStd('slab', '#ECE9E3', { roughness: 0.7 }),
        // Murs et menuiseries
        panel: twinSurf('panel', { ...twinPanelSet(), roughness: 0.78 }, 1 / 1.2),
        faience: twinSurf('faience', { ...faience, roughness: 1 }, 1 / 0.6),
        plaster: twinSurf('plaster', { color: '#EFE9DF', ...twinPlasterSet(), roughness: 0.95 }, 1),
        coldPanel: twinStd('coldPanel', '#F0F0EC', { roughness: 0.4 }),
        cap: twinStd('cap', '#35312D', { roughness: 0.92 }),
        skirting: twinStd('skirting', '#6A665F', { roughness: 0.55 }),
        sill: twinStd('sill', '#E7E4DD', { roughness: 0.45 }),
        frame: twinStd('frame', '#E9E8E3', { roughness: 0.5, metalness: 0.1 }),
        bronze: twinStd('bronze', '#4E3B2B', { roughness: 0.36, metalness: 0.65, ...env }),
        windowGlass: twinStd('windowGlass', '#D3E2EA', { ...glassy, opacity: 0.16, envMapIntensity: 1.6 }),
        darkGlass: twinStd('darkGlass', '#2F3A42', { roughness: 0.08, metalness: 0.3, envMapIntensity: 1.2, ...env }),
        wood: twinSurf('wood', { ...twinWoodSet(), roughness: 0.5 }, 0.8, 0.005),
        doorGrey: twinStd('doorGrey', '#7A7E82', { roughness: 0.45, metalness: 0.15 }),
        // Mobilier de labo (meubles blancs, lisses vert-de-gris, clips rouges, plans en résine sauge)
        labWhite: twinStd('labWhite', '#E8E5DE', { roughness: 0.42 }),
        labRail: twinStd('labRail', '#7B8B83', { roughness: 0.38, metalness: 0.25 }),
        labRed: twinStd('labRed', '#C0362E', { roughness: 0.45 }),
        labPlinth: twinStd('labPlinth', '#56625C', { roughness: 0.7 }),
        counter: twinSurf('counter', { ...twinCounterSet(), roughness: 0.3 }, 1, 0.006),
        sinkInner: twinStd('sinkInner', '#66756C', { roughness: 0.35 }),
        faucet: twinStd('faucet', '#E6E3DD', { roughness: 0.25 }),
        faucetGreen: twinStd('faucetGreen', '#3E8A58', { roughness: 0.35 }),
        kitchenWhite: twinStd('kitchenWhite', '#F1F0EC', { roughness: 0.35 }),
        // Métaux
        steel: twinStd('steel', '#D3D8DB', { metalness: 0.9, roughness: 1, envMapIntensity: 1.1, ...env, ...brushed }),
        steelShell: twinMat('steelShell', () => new THREE.MeshStandardMaterial({ color: '#D6DBDE', metalness: 0.92, roughness: 1, envMapIntensity: 1.1, ...env, ...brushed, side: THREE.DoubleSide })),
        steelDark: twinStd('steelDark', '#6E7880', { metalness: 0.6, roughness: 0.42, envMapIntensity: 1.1, ...env }),
        chrome: twinStd('chrome', '#EDF1F3', { metalness: 1, roughness: 0.08, envMapIntensity: 1.3, ...env }),
        alu: twinStd('alu', '#C2C7CB', { metalness: 0.8, roughness: 0.3, envMapIntensity: 1.15, ...env }),
        mesh: twinStd('mesh', '#A2A9AE', { metalness: 0.85, roughness: 0.5, envMapIntensity: 1.1, ...env }),
        // Plastiques, caoutchouc
        rubber: twinStd('rubber', '#202427', { roughness: 0.92 }),
        plastic: twinStd('plastic', '#25292D', { roughness: 0.45 }),
        plasticLight: twinStd('plasticLight', '#3A3F45', { roughness: 0.4 }),
        whitePlastic: twinStd('whitePlastic', '#ECEBE6', { roughness: 0.4 }),
        crateBlack: twinStd('crateBlack', '#1E2022', { roughness: 0.62 }),
        crateGreen: twinMat('crateGreen', () => new THREE.MeshStandardMaterial({ color: '#2F9A4B', roughness: 0.55, alphaMap: twinLatticeSet().alphaMap, alphaTest: 0.5, side: THREE.DoubleSide })),
        crateGreenSolid: twinStd('crateGreenSolid', '#2F9A4B', { roughness: 0.55 }),
        dolly: twinStd('dolly', '#2357A8', { roughness: 0.5 }),
        boxPlastic: twinStd('boxPlastic', '#F4F8F8', { ...glassy, opacity: 0.24, roughness: 0.12, envMapIntensity: 1.3 }),
        boxLid: twinStd('boxLid', '#8DA2B5', { roughness: 0.4 }),
        boxClip: twinStd('boxClip', '#5E7891', { roughness: 0.4 }),
        film: twinStd('film', '#F2F6F7', { ...glassy, opacity: 0.2, roughness: 0.2, envMapIntensity: 1.2 }),
        // Verre et thé
        bottleGlass: twinStd('bottleGlass', '#EEF5F3', { ...glassy, opacity: 0.22, envMapIntensity: 2 }),
        liquid: twinStd('liquid', '#FFFFFF', { roughness: 0.1, ...env }),
        capBlack: twinStd('capBlack', '#171717', { roughness: 0.35, metalness: 0.5, ...env }),
        jarGlass: twinStd('jarGlass', '#EAF4F2', { ...glassy, opacity: 0.25 }),
        // Papier, carton
        kraft: twinStd('kraft', '#C4A27A', { roughness: 0.9 }),
        kraftTape: twinStd('kraftTape', '#A9844F', { roughness: 0.6 }),
        sackPaper: twinMat('sackPaper', () => Object.assign(new THREE.MeshStandardMaterial({ color: '#C9A77C', roughness: 0.95 }), { userData: { bevel: 0.05 } })),
        board: twinStd('board', '#7B5A3D', { roughness: 0.8 }),
        pallet: twinStd('pallet', '#C8A97E', { roughness: 0.88 }),
        palletCore: twinStd('palletCore', '#A3B4B2', { roughness: 0.3 }),
        waterPlastic: twinStd('waterPlastic', '#D3E4F0', { roughness: 0.3 }),
        label: twinStd('label', '#F6F5F0', { roughness: 0.7 }),
        tint: twinStd('tint', '#FFFFFF', { roughness: 0.72 }),
        // Personnes (mannequins en tenue d'hygiène)
        skin: twinStd('skin', '#D9C2AA', { roughness: 0.72 }),
        coat: twinStd('coat', '#F4F3EF', { roughness: 0.85 }),
        trousers: twinStd('trousers', '#E4E4DF', { roughness: 0.85 }),
        shoes: twinStd('shoes', '#262626', { roughness: 0.6 }),
        gloves: twinStd('gloves', '#5277D3', { roughness: 0.5 }),
        hairnet: twinStd('hairnet', '#F8F8F6', { roughness: 0.95 }),
        fabric: twinStd('fabric', '#FFFFFF', { roughness: 0.8 }),
        // Végétation
        bark: twinStd('bark', '#5A4636', { roughness: 0.95 }),
        leaves: twinStd('leaves', '#FFFFFF', { roughness: 0.85, ...twinLeafSet() }),
        // Divers
        dark: twinStd('dark', '#2F3438', { roughness: 0.7 }),
        glassTop: twinStd('glassTop', '#0F1113', { roughness: 0.06, metalness: 0.35 }),
        inductionOff: twinStd('inductionOff', '#4A4F55', { roughness: 0.3 }),
        inductionOn: twinStd('inductionOn', '#FF7A1A', { emissive: '#FF5A00', emissiveIntensity: 0.9, roughness: 0.3 }),
        ledOn: twinStd('ledOn', '#5CE07A', { emissive: '#5CE07A', emissiveIntensity: 1.2 }),
        ledOrange: twinStd('ledOrange', '#FFB347', { emissive: '#FF9A1F', emissiveIntensity: 1.1 }),
        ledOff: twinStd('ledOff', '#555B60', { roughness: 0.5 }),
        valveRed: twinStd('valveRed', '#C7342B', { roughness: 0.5 }),
        cee: twinStd('cee', '#D23B2E', { roughness: 0.45 }),
        ceeBlue: twinStd('ceeBlue', '#2D5FB0', { roughness: 0.45 }),
        white: twinStd('white', '#F7F7F2', { roughness: 0.6 }),
        whiteDark: twinStd('whiteDark', '#E3E4DE', { roughness: 0.65 }),
        brand: twinStd('brand', p.primary, { roughness: 0.55 }),
        screen: twinStd('screen', p.primaryLight, { emissive: p.primaryLight, emissiveIntensity: 0.9 }),
        extinguisher: twinStd('extinguisher', '#C7342B', { roughness: 0.4, metalness: 0.2 }),
        hoseBeige: twinStd('hoseBeige', '#E2D6BF', { roughness: 0.7 }),
        mat: twinStd('mat', '#1C1D1F', { roughness: 0.95 }),
        hazard: twinStd('hazard', '#E9B825', { roughness: 0.6 }),
        // Indicateurs intégrés au décor : halos au sol, gyrophares, emplacement vide hachuré
        ringDanger: twinBasic('haloDanger', p.danger, { map: halo.map, opacity: 0.9 }),
        ringWarning: twinBasic('haloWarning', p.warning, { map: halo.map, opacity: 0.9 }),
        ringWarningSoft: twinBasic('haloWarningSoft', p.warning, { map: halo.map, opacity: 0.5 }),
        ringSuccess: twinBasic('haloSuccess', p.success, { map: halo.map, opacity: 0.6 }),
        ringPlanned: twinBasic('haloPlanned', p.info, { map: halo.map, opacity: 0.6 }),
        beaconDanger: twinStd('beaconDanger', p.danger, { emissive: p.danger, emissiveIntensity: 0.8, transparent: true, opacity: 0.88, roughness: 0.2 }),
        beaconWarning: twinStd('beaconWarning', p.warning, { emissive: p.warning, emissiveIntensity: 0.8, transparent: true, opacity: 0.88, roughness: 0.2 }),
        proxy: twinMat('proxy', () => new THREE.MeshBasicMaterial())
    };
};

// Teinte des liquides : couleur de l'arôme fondue dans un ambré de thé infusé
const twinTeaColor = (hex) => {
    const [r, g, b] = twinRgb(hex);
    const mix = (c, t) => Math.round(c * 0.58 + t * 0.42);
    return `#${[mix(r, 196), mix(g, 112), mix(b, 38)].map(v => Math.min(255, v).toString(16).padStart(2, '0')).join('')}`;
};

const twinColorMats = (color) => ({
    liquid: twinStd('liquidTea', twinShade(twinTeaColor(color), 0.72), { roughness: 0.06, envMap: Twin.envTarget?.texture || null, envMapIntensity: 1.2 })
});

const TWIN_STATE_COLORS = { critical: '#D9776C', empty: '#D9776C', low: '#E3B85A', ok: '#8DB86A', unknown: '#B9BDB5' };

const twinShade = (hex, factor) => {
    let h = safeColor(hex).slice(1);
    if (h.length < 6) h = h.slice(0, 3).split('').map(c => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    const ch = (shift) => {
        const v = (n >> shift) & 255;
        const out = factor <= 1 ? v * factor : v + (255 - v) * (factor - 1);
        return Math.round(Math.min(255, out)).toString(16).padStart(2, '0');
    };
    return `#${ch(16)}${ch(8)}${ch(0)}`;
};

// --- Assemblage instancié : un InstancedMesh par couple géométrie × matériau ---
const twinBatch = () => new Map();

const twinBatchFlush = (batch, parent) => {
    const { THREE } = Twin.lib;
    const color = new THREE.Color();
    batch.forEach(e => {
        const mesh = new THREE.InstancedMesh(e.geo, e.mat, e.matrices.length);
        e.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
        if (e.colors.some(Boolean)) e.colors.forEach((c, i) => mesh.setColorAt(i, color.set(c || '#ffffff')));
        mesh.castShadow = e.cast;
        mesh.receiveShadow = e.receive;
        // Verre, films et halos n'entrent pas dans l'occlusion ambiante (sinon voile sombre sur les vitres)
        if (e.mat.transparent) mesh.userData.twinNoAO = true;
        // Halos au sol dessinés avant les autres transparents (sinon ils repassent par-dessus le verre et les films)
        if (e.mat.polygonOffset) mesh.renderOrder = -1;
        mesh.computeBoundingSphere();
        parent.add(mesh);
    });
    batch.clear();
};

// Repère local (position + rotation Y) : part() alimente le lot instancié,
// mesh() crée un objet individuel (animé), point() convertit en coordonnées monde.
// Les boîtes reçoivent automatiquement la variante « arêtes adoucies » de leur matériau.
const twinBuilder = (batch, parent, x, z, rotY = 0, y = 0) => {
    const { THREE } = Twin.lib;
    const origin = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z);
    const dummy = Twin.dummy;
    const boxed = (geo, mat) => (geo === Twin.geo.box ? twinBevelMat(mat) : mat);
    const matrix = (p, s, o = {}) => {
        dummy.position.set(p[0], p[1], p[2]);
        dummy.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
        dummy.scale.set(s[0], s[1], s[2]);
        dummy.updateMatrix();
        return new THREE.Matrix4().multiplyMatrices(origin, dummy.matrix);
    };
    return {
        matrix,
        part(geo, mat, p, s, o = {}) {
            const m = boxed(geo, mat);
            const key = `${geo.uuid}|${m.uuid}`;
            let e = batch.get(key);
            if (!e) {
                e = { geo, mat: m, matrices: [], colors: [], cast: o.cast !== false && !mat.transparent, receive: o.receive !== false && !mat.transparent };
                batch.set(key, e);
            }
            e.matrices.push(matrix(p, s, o));
            e.colors.push(o.color || null);
        },
        mesh(geo, mat, p, s, o = {}) {
            const mesh = twinMesh(geo, boxed(geo, mat), { cast: o.cast !== false && !mat.transparent, receive: !!o.receive });
            matrix(p, s, o).decompose(mesh.position, mesh.quaternion, mesh.scale);
            if (o.renderOrder) mesh.renderOrder = o.renderOrder;
            if (mat.transparent) mesh.userData.twinNoAO = true;
            parent.add(mesh);
            return mesh;
        },
        point(p) {
            return new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(origin);
        }
    };
};

const twinFlat = (b, geo, mat, x, y, z, w, d, o = {}) =>
    b.part(geo, mat, [x, y, z], [w, d, 1], { rx: -Math.PI / 2, cast: false, receive: false, ...o });

// --- Monde : ciel, reflets, lumière, post-traitement (reconstruit à chaque changement de qualité) ---
// Carte d'environnement « atelier » : pièce claire, réglettes LED au plafond, baies vitrées
const twinEnvironmentMap = () => {
    const { THREE } = Twin.lib;
    const scene = new THREE.Scene();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mats = [];
    const add = (color, intensity, p, s, side = THREE.FrontSide) => {
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side });
        mats.push(mat);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(p[0], p[1], p[2]);
        mesh.scale.set(s[0], s[1], s[2]);
        scene.add(mesh);
    };
    add('#CFCBC3', 1, [0, 1.4, 0], [26, 5.8, 18], THREE.BackSide);
    add('#7E7973', 1, [0, -1.48, 0], [26, 0.04, 18]);
    add('#5F5B56', 1, [0, -1.05, 0], [25.6, 0.85, 17.6], THREE.BackSide);
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 3; j++) add('#FFFFFF', 9, [-9 + i * 6, 4.25, -5 + j * 5], [3.4, 0.05, 0.32]);
    }
    add('#E6F0F9', 5, [0, 0.9, -8.95], [20, 1.6, 0.05]);
    add('#FFF2DE', 3, [-12.95, 0.9, 1], [0.05, 1.6, 9]);
    add('#E9EEF2', 2.5, [0, 0.9, 8.95], [16, 1.4, 0.05]);
    add('#4A4744', 1, [12.95, 0.4, 0], [0.05, 2.6, 10]);
    const pmrem = new THREE.PMREMGenerator(Twin.renderer);
    const target = pmrem.fromScene(scene, 0.035);
    pmrem.dispose();
    geo.dispose();
    mats.forEach(m => m.dispose());
    return target;
};

// Cadre l'ombre portée du soleil sur le bâtiment (projection orthographique ajustée)
const twinFitShadow = (light, boxes, penumbra) => {
    const { THREE } = Twin.lib;
    const cam = light.shadow.camera;
    cam.position.copy(light.position);
    cam.lookAt(light.target.position);
    cam.updateMatrixWorld();
    const v = new THREE.Vector3();
    const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
    const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    boxes.forEach(([min, max]) => {
        for (let i = 0; i < 8; i++) {
            v.set(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]).applyMatrix4(cam.matrixWorldInverse);
            lo.min(v);
            hi.max(v);
        }
    });
    Object.assign(cam, { left: lo.x - 0.4, right: hi.x + 0.4, bottom: lo.y - 0.4, top: hi.y + 0.4, near: Math.max(0.5, -hi.z - 1), far: -lo.z + 1 });
    cam.updateProjectionMatrix();
    light.shadow.radius = twinClamp(penumbra / ((hi.x - lo.x + 0.8) / light.shadow.mapSize.x), 1, 5);
};

// Lumière « jour + plafonniers » : zénithale douce depuis l'avant-gauche, appoint froid côté fenêtres
const twinLights = (scene) => {
    const { THREE } = Twin.lib;
    const q = Twin.quality;
    const hemi = new THREE.HemisphereLight(0xf2f5fb, 0xb9ad9b, 0.8);
    const key = new THREE.DirectionalLight(0xfff3e4, 2.75);
    key.position.set(-9, 19, 11);
    key.target.position.set(0, 0, -0.5);
    key.castShadow = true;
    key.shadow.mapSize.set(q.shadow, q.shadow);
    key.shadow.bias = -0.0003;
    key.shadow.normalBias = 0.02;
    // Le cadre englobe le bâtiment et chaque arbre avec son ombre au sol : un arbre à cheval sur le bord
    // du cadre projetait une ombre tranchée net, visible dès qu'on recule
    const ground = -TWIN_PLAN.plinth;
    const drop = key.position.y - key.target.position.y;
    const trees = TWIN_TREES.flatMap(([x, z, s]) => {
        const r = 3.2 * s;
        const top = ground + 9.4 * s;
        const dx = (key.target.position.x - key.position.x) * (top - ground) / drop;
        const dz = (key.target.position.z - key.position.z) * (top - ground) / drop;
        return [[[x - r, ground, z - r], [x + r, top, z + r]], [[x - r + dx, ground, z - r + dz], [x + r + dx, ground, z + r + dz]]];
    });
    twinFitShadow(key, [[[-15.5, -3.7, -10.8], [15.5, 3.1, 10.8]], ...trees], 0.022);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.45);
    fill.position.set(14, 9, -12);
    scene.add(hemi, key, key.target, fill);
};

const twinShadowsDirty = () => {
    if (Twin.renderer) Twin.renderer.shadowMap.needsUpdate = true;
};

// Post-traitement : occlusion ambiante (GTAO) puis sortie (tonemapping, sRGB). Économie : rendu direct.
let TwinAOPass = null;
const twinSetupComposer = () => {
    const { THREE, EffectComposer, RenderPass, GTAOPass, OutputPass } = Twin.lib;
    const q = Twin.quality;
    if (!q.ao) return;
    if (!TwinAOPass) {
        TwinAOPass = class extends GTAOPass {
            setSize(width, height) {
                const k = this.twinScale || 1;
                super.setSize(Math.max(1, Math.round(width * k)), Math.max(1, Math.round(height * k)));
            }

            // Verre, halos, marqueurs et vapeur n'entrent pas dans le calcul d'occlusion
            _overrideVisibility() {
                super._overrideVisibility();
                const cache = this._visibilityCache;
                this.scene.traverse(o => {
                    if (o.visible && o.userData.twinNoAO) {
                        o.visible = false;
                        cache.push(o);
                    }
                });
            }
        };
    }
    const size = Twin.renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(Twin.renderer, target);
    composer.addPass(new RenderPass(Twin.scene, Twin.camera));
    const ao = new TwinAOPass(Twin.scene, Twin.camera, size.x, size.y);
    ao.twinScale = q.ao;
    ao.output = GTAOPass.OUTPUT.Default;
    ao.blendIntensity = 1;
    ao.updateGtaoMaterial({ radius: 0.36, distanceExponent: 1.2, thickness: 0.6, scale: 1.7, samples: q.level === 'high' ? 16 : 12, distanceFallOff: 1, screenSpaceRadius: false });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, radiusExponent: 1.4, rings: 2, samples: 16 });
    composer.addPass(ao);
    const output = new OutputPass();
    composer.addPass(output);
    Object.assign(Twin, { composer, aoPass: ao, outputPass: output });
};

const twinRender = () => {
    if (Twin.composer) Twin.composer.render();
    else Twin.renderer.render(Twin.scene, Twin.camera);
};

const twinBuildWorld = () => {
    const { THREE } = Twin.lib;
    const level = twinResolveQuality();
    Twin.quality = { setting: twinQualitySetting(), level, ...TWIN_QUALITY_LEVELS[level] };
    Twin.renderer.setPixelRatio(twinPixelRatio());
    const scene = new THREE.Scene();
    Twin.scene = scene;
    scene.background = twinSkyTexture();
    scene.fog = new THREE.Fog(TWIN_SKY.horizon, 60, 170);
    Twin.envTarget = twinEnvironmentMap();
    scene.environment = Twin.envTarget.texture;
    scene.environmentIntensity = 0.62;
    twinLights(scene);
    Twin.dynamic = new THREE.Group();
    Twin.markers = new THREE.Group();
    Twin.markers.userData.twinNoAO = true;
    scene.add(Twin.dynamic, Twin.markers);
    Twin.cutaways = [];
    twinBuildEnvironment();
    twinBuildMarkers();
    twinSetupComposer();
    twinShadowsDirty();
};

const twinDisposeWorld = () => {
    if (!Twin.scene) return;
    Twin.scene.traverse(o => {
        if (o.isInstancedMesh) o.dispose();
        if (o.isLight && o.shadow?.map) o.shadow.dispose();
        if (o.isMesh || o.isPoints || o.isLine) {
            o.geometry?.dispose();
            (Array.isArray(o.material) ? o.material : [o.material]).forEach(mat => mat?.dispose());
        }
    });
    Object.values(Twin.geo).forEach(g => g.dispose());
    Object.values(Twin.mats).forEach(mat => mat.dispose());
    Twin.variants.forEach(mat => mat.dispose());
    Twin.textures.forEach(t => t.dispose());
    Twin.envTarget?.dispose();
    Twin.composer?.dispose();
    Twin.aoPass?.dispose();
    Twin.outputPass?.dispose();
    Twin.proxies?.clear();
    Object.assign(Twin, {
        scene: null, dynamic: null, markers: null, composer: null, aoPass: null, outputPass: null, envTarget: null,
        geo: {}, mats: {}, variants: new Map(), textures: [], texSets: {},
        steam: [], cutaways: [], flashes: [], fills: [], pulseMats: []
    });
};

// Changement de qualité : on garde le moteur (contexte WebGL, caméra, commandes) et on reconstruit le monde
const twinApplyQuality = () => {
    if (!Twin.renderer || !Twin.lib) return;
    const pos = Twin.camera.position.clone();
    const target = Twin.controls.target.clone();
    twinDisposeWorld();
    twinBuildWorld();
    twinSyncLiteClass();
    Object.assign(Twin.perf, { smooth: false, time: 0, frames: 0, slow: 0 });
    twinResize();
    if (Twin.model && Twin.container) {
        twinBuildDynamic(Twin.model);
        twinBuildLabels(Twin.model);
        twinPositionMarkers();
    }
    Twin.camera.position.copy(pos);
    Twin.controls.target.copy(target);
    Twin.controls.update();
    twinRenderQualityMenu();
    twinWarmUp();
};

const twinInitEngine = () => {
    const { THREE, OrbitControls } = Twin.lib;
    Twin.palette = {
        primary: twinCssColor('--primary', '#5D7B3E'),
        primaryLight: twinCssColor('--primary-light', '#8BA66B'),
        danger: twinCssColor('--danger', '#C0392B'),
        warning: twinCssColor('--warning', '#C8960A'),
        success: twinCssColor('--success', '#5C8A3C'),
        info: twinCssColor('--info', '#2E72B8'),
        bg: twinCssColor('--bg', '#F5F5F0'),
        zones: Object.fromEntries(TWIN_ZONES.map(z => [z.id, twinCssColor(z.token, '#5D7B3E')]))
    };
    const compact = window.matchMedia?.('(max-width: 768px)').matches;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // Ombres statiques : recalculées seulement quand la scène change (pas à chaque mouvement de caméra)
    renderer.shadowMap.autoUpdate = false;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.domElement.className = 'twin-gl';
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', "Vue 3D de l'atelier ThéCol. Utilisez la liste des objets pour une navigation au clavier.");

    const camera = new THREE.PerspectiveCamera(36, 1.6, 0.1, 400);
    camera.position.set(...TWIN_VIEW_OVERVIEW.pos);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.8;
    controls.maxDistance = compact ? 58 : 50;
    controls.maxPolarAngle = Math.PI * 0.46;
    controls.screenSpacePanning = false;
    controls.autoRotateSpeed = 0.5;
    controls.target.set(...TWIN_VIEW_OVERVIEW.target);
    controls.addEventListener('change', () => {
        twinClampTarget();
        twinWake();
    });
    controls.addEventListener('start', () => { Twin.tween = null; });
    controls.update();

    Object.assign(Twin, {
        renderer, camera, controls,
        raycaster: new THREE.Raycaster(),
        ndc: new THREE.Vector2(),
        tmp: new THREE.Vector3(),
        dummy: new THREE.Object3D(),
        proxies: new THREE.Group()
    });
    twinBuildWorld();

    const canvas = renderer.domElement;
    canvas.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch') return;
        Twin.pointer = { x: e.clientX, y: e.clientY };
        Twin.pointerDirty = true;
        twinWake();
    });
    canvas.addEventListener('pointerleave', () => {
        Twin.pointer = null;
        Twin.pointerDirty = true;
        twinWake();
    });
    canvas.addEventListener('pointerdown', (e) => {
        Twin.downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
        Twin.tween = null;
    });
    canvas.addEventListener('pointerup', (e) => {
        const down = Twin.downAt;
        Twin.downAt = null;
        if (!down || e.button > 0) return;
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || performance.now() - down.t > 600) return;
        const id = twinPick(e.clientX, e.clientY);
        twinSelect(id, { fly: false });
    });
    canvas.addEventListener('dblclick', (e) => {
        const id = twinPick(e.clientX, e.clientY);
        if (id) twinSelect(id, { fly: true });
    });
};

// --- Bâtiment : terrain arboré, rez-de-chaussée, dalle de l'étage, façades, cloisons coupées (maquette) ---
const TWIN_TREES = [
    [-16.8, -15.2, 1.1, 0], [-10.2, -16.4, 1.25, 1], [-3.6, -15.6, 1.0, 2], [3.1, -16.8, 1.2, 3], [9.4, -15.4, 1.05, 0],
    [15.8, -16.2, 1.25, 1], [-19.6, -6.4, 1.15, 2], [-20.2, 3.2, 1.0, 3], [19.8, -7.0, 1.1, 1], [20.4, 2.6, 1.2, 0],
    [-17.6, 13.8, 0.95, 1], [17.0, 14.2, 1.0, 2]
];
// Feuillages d'automne (orangé, jaune, vert, rouille), nuances tirées au hasard par bouquet
const TWIN_TREE_COLORS = [
    ['#B8733A', '#C98744', '#A6612F', '#8E5A2E'],
    ['#C7A548', '#B8963E', '#D2B45C', '#9C8236'],
    ['#748A44', '#86984F', '#647A3A', '#5A6B35'],
    ['#A4513A', '#B4623F', '#8F4532', '#7C4A33']
];

const TWIN_ROOMS = [
    { id: 'labo', x: [-12, -1.76], z: [-8, -1.06], floor: 'floorLab' },
    { id: 'laverie', x: [-1.76, 1.76], z: [-8, -1.06], floor: 'floorMosaic' },
    { id: 'stock', x: [1.76, 12], z: [-8, -1.06], floor: 'floorLab' },
    { id: 'couloir', x: [-12, 12], z: [-1.06, 1.46], floor: 'floorGrey' },
    { id: 'reserve', x: [-12, -1.76], z: [1.46, 8], floor: 'floorMosaic' },
    { id: 'vestiaire', x: [-1.76, 1.76], z: [1.46, 8], floor: 'floorGrey' },
    { id: 'expedition', x: [1.76, 12], z: [1.46, 8], floor: 'floorGrey' }
];

// Façades : [centre, largeur] des fenêtres et portes le long du mur ; finitions intérieures par tronçon
const TWIN_FACADES = [
    { id: 'back', axis: 'x', at: -8.125, out: -1, from: -12.25, to: 12.25,
        windows: [[-9.4, 2.6], [-5.0, 2.6], [0, 1.4], [4.9, 2.6], [9.3, 2.6]], doors: [],
        finish: [[-12.25, -1.76, 'panel'], [-1.76, 1.76, 'faience'], [1.76, 12.25, 'panel']] },
    { id: 'front', axis: 'x', at: 8.125, out: 1, from: -12.25, to: 12.25,
        windows: [[-5.0, 2.0], [0, 1.4], [5.2, 2.4], [9.2, 2.4]], doors: [],
        finish: [[-12.25, -8.0, 'plaster'], [-8.0, -1.76, 'faience'], [-1.76, 12.25, 'panel']] },
    { id: 'west', axis: 'z', at: -12.125, out: -1, from: -8, to: 8,
        windows: [], doors: [[0.2, 1.0]], finish: [[-8, 1.46, 'panel'], [1.46, 8, 'plaster']] },
    { id: 'east', axis: 'z', at: 12.125, out: 1, from: -8, to: 8,
        windows: [[-4.5, 2.4]], doors: [[4.3, 1.8]], finish: [[-8, 8, 'panel']] }
];

// Cloisons intérieures (coupées) : côté A = x ou z négatif, côté B = positif
const TWIN_PARTITIONS = [
    { axis: 'x', at: -1.06, from: -12, to: 12, doors: [[-4.0, 1.0], [0, 0.9], [2.85, 1.0]],
        finA: [[-12, -1.76, 'panel'], [-1.76, 1.76, 'faience'], [1.76, 12, 'panel']], finB: [[-12, 12, 'panel']] },
    { axis: 'x', at: 1.46, from: -12, to: 12, doors: [[-4.0, 1.0], [0, 0.9], [4.0, 1.6]],
        finA: [[-12, 12, 'panel']], finB: [[-12, -8.0, 'plaster'], [-8.0, -1.76, 'faience'], [-1.76, 12, 'panel']] },
    { axis: 'z', at: -1.76, from: -8, to: -1.12, doors: [[-2.7, 0.9]], finA: [[-8, -1.12, 'panel']], finB: [[-8, -1.12, 'faience']] },
    { axis: 'z', at: 1.76, from: -8, to: -1.12, doors: [], finA: [[-8, -1.12, 'faience']], finB: [[-8, -1.12, 'panel']] },
    { axis: 'z', at: -1.76, from: 1.52, to: 8, doors: [], finA: [[1.52, 8, 'faience']], finB: [[1.52, 8, 'panel']] },
    { axis: 'z', at: 1.76, from: 1.52, to: 8, doors: [], finA: [[1.52, 8, 'panel']], finB: [[1.52, 8, 'panel']] },
    { axis: 'z', at: -8.0, from: 1.52, to: 8, doors: [[3.0, 0.9]], finA: [[1.52, 8, 'plaster']], finB: [[1.52, 8, 'coldPanel']] }
];

const twinTree = (b, x, z, s, k) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const ground = -TWIN_PLAN.plinth;
    const rnd = twinRandom(Math.round((x + 40) * 131 + (z + 40) * 17));
    const trunk = 5.2 * s;
    b.part(g.trunk, m.bark, [x, ground + trunk / 2, z], [0.19 * s, trunk, 0.19 * s]);
    [0.9, 2.6, 4.3].forEach((a, i) => {
        const t = a + k;
        b.part(g.trunk, m.bark, [x + Math.cos(t) * 0.45 * s, ground + trunk * (0.6 + i * 0.09), z + Math.sin(t) * 0.45 * s],
            [0.06 * s, 1.5 * s, 0.06 * s], { rx: Math.sin(t) * 0.7, rz: -Math.cos(t) * 0.7 });
    });
    // Houppier : bouquets de feuillage répartis dans un ellipsoïde (plus denses vers l'extérieur)
    const pal = TWIN_TREE_COLORS[k % TWIN_TREE_COLORS.length];
    const cy = ground + trunk * 0.9 + 1.4 * s;
    const [rx, ry, rz] = [2.1 * s, 2.3 * s, 2.1 * s];
    for (let i = 0; i < 22; i++) {
        const a = rnd() * Math.PI * 2;
        const u = rnd() * 1.6 - 0.6;
        const f = 0.55 + rnd() * 0.45;
        const c = Math.sqrt(1 - Math.min(1, u * u));
        const size = (0.6 + rnd() * 0.4) * s;
        b.part(g.crown, m.leaves, [x + Math.cos(a) * c * rx * f, cy + u * ry * f, z + Math.sin(a) * c * rz * f],
            [size, size * 0.85, size], { color: pal[Math.floor(rnd() * pal.length)] });
    }
    b.part(g.crown, m.leaves, [x, cy, z], [1.6 * s, 1.7 * s, 1.6 * s], { color: pal[3] });
};

// Terrain (pelouse d'automne, pavés), rez-de-chaussée vitré, entrée sous auvent, dalle de l'étage
const twinBuildSite = (b) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const P = TWIN_PLAN;
    const ground = -P.plinth;
    const W = P.x1 - P.x0 + 2 * P.wall;
    const D = P.z1 - P.z0 + 2 * P.wall;
    const h = P.plinth - 0.32;
    b.part(g.plane, m.grass, [0, ground, 0], [280, 280, 1], { rx: -Math.PI / 2, cast: false });
    b.part(g.box, m.pavers, [0, ground + 0.02, 0], [W + 4.6, 0.04, D + 4.6], { cast: false });
    b.part(g.box, m.pavers, [4.2, ground + 0.02, D / 2 + 6.3], [3.2, 0.04, 8], { cast: false });
    b.part(g.box, m.facade, [0, ground + h / 2, 0], [W, h, D]);
    const gy = ground + 1.85;
    [[W, D / 2], [W, -D / 2]].forEach(([len, z]) => {
        const s = Math.sign(z);
        b.part(g.box, m.darkGlass, [0, gy, z + s * 0.012], [len - 1.4, 1.5, 0.03], { cast: false });
        [-0.77, 0.77].forEach(dy => b.part(g.box, m.bronze, [0, gy + dy, z + s * 0.03], [len - 1.3, 0.06, 0.05]));
        for (let x = -len / 2 + 0.7; x <= len / 2 - 0.69; x += 1.6) b.part(g.box, m.bronze, [x, gy, z + s * 0.03], [0.06, 1.56, 0.05]);
    });
    [[D, W / 2], [D, -W / 2]].forEach(([len, x]) => {
        const s = Math.sign(x);
        b.part(g.box, m.darkGlass, [x + s * 0.012, gy, 0], [0.03, 1.5, len - 1.4], { cast: false });
        [-0.77, 0.77].forEach(dy => b.part(g.box, m.bronze, [x + s * 0.03, gy + dy, 0], [0.05, 0.06, len - 1.3]));
        for (let z = -len / 2 + 0.7; z <= len / 2 - 0.69; z += 1.6) b.part(g.box, m.bronze, [x + s * 0.03, gy, z], [0.05, 1.56, 0.06]);
    });
    // Entrée de l'immeuble : portes vitrées, auvent, paillasson
    b.part(g.box, m.bronze, [4.2, ground + 1.2, D / 2 + 0.05], [2.3, 2.4, 0.06]);
    b.part(g.box, m.darkGlass, [4.2, ground + 1.15, D / 2 + 0.085], [2.1, 2.2, 0.02], { cast: false });
    b.part(g.box, m.slab, [4.2, ground + 2.7, D / 2 + 0.9], [3.6, 0.14, 1.8]);
    b.part(g.box, m.mat, [4.2, ground + 0.045, D / 2 + 0.9], [1.6, 0.01, 0.9], { cast: false });
    // Dalle de l'étage (nez de dalle blanc) : seulement le pourtour sous les façades, les sols des pièces
    // couvrent le reste (une dalle pleine à 2 mm sous les sols scintillait vue de loin)
    [-1, 1].forEach(s => {
        b.part(g.box, m.slab, [0, -0.16, s * (P.z1 + (D + 0.2) / 2) / 2], [W + 0.2, 0.32, (D + 0.2) / 2 - P.z1]);
        b.part(g.box, m.slab, [s * (P.x1 + (W + 0.2) / 2) / 2, -0.16, 0], [(W + 0.2) / 2 - P.x1, 0.32, P.z1 - P.z0]);
    });
    TWIN_TREES.forEach(t => twinTree(b, ...t));
};

// Découpe [from, to] aux bords des ouvertures ([centre, largeur]) et aux changements de finition
const twinSpans = (from, to, holes, splits = []) => {
    const pts = [...new Set([from, to, ...splits, ...holes.flatMap(([c, w]) => [c - w / 2, c + w / 2])])]
        .filter(v => v >= from - 1e-6 && v <= to + 1e-6)
        .sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const c = pts[i + 1];
        if (c - a < 0.004) continue;
        const mid = (a + c) / 2;
        out.push({ a, b: c, mid, hole: holes.find(([hc, hw]) => Math.abs(mid - hc) < hw / 2) || null });
    }
    return out;
};

const twinFinishAt = (list, v) => (list.find(([a, b]) => v >= a - 1e-6 && v <= b + 1e-6) || list[0])[2];

// Boîte de mur le long de x (axis 'x', z = at) ou de z (axis 'z', x = at) ; off décale dans l'épaisseur
const twinWallBox = (b, mat, axis, at, a, c, y0, y1, thick, off = 0, o = {}) => {
    const g = twinGeometries();
    const len = c - a;
    const mid = (a + c) / 2;
    if (axis === 'x') b.part(g.box, mat, [mid, (y0 + y1) / 2, at + off], [len, y1 - y0, thick], o);
    else b.part(g.box, mat, [at + off, (y0 + y1) / 2, mid], [thick, y1 - y0, len], o);
};

// Cloison coupée à hauteur d'appui : parement de chaque pièce, chapeau sombre (coupe), plinthes, huisseries
const twinPartition = (b, w) => {
    const m = twinMaterials();
    const P = TWIN_PLAN;
    const thick = P.part;
    const splits = [...w.finA, ...w.finB].flatMap(f => [f[0], f[1]]);
    twinSpans(w.from, w.to, w.doors, splits).forEach(s => {
        if (s.hole) return;
        [[w.finA, -1], [w.finB, 1]].forEach(([fin, side]) => {
            const key = twinFinishAt(fin, s.mid);
            twinWallBox(b, m[key], w.axis, w.at, s.a, s.b, 0, P.cut, thick / 2, side * thick / 4);
            if (key === 'panel') twinWallBox(b, m.skirting, w.axis, w.at, s.a, s.b, 0, 0.07, 0.012, side * (thick / 2 + 0.006));
        });
        twinWallBox(b, m.cap, w.axis, w.at, s.a, s.b, P.cut, P.cut + 0.012, thick + 0.004);
    });
    w.doors.forEach(([c, dw]) => {
        twinWallBox(b, m.frame, w.axis, w.at, c - dw / 2, c - dw / 2 + 0.05, 0, P.cut + 0.012, thick + 0.03);
        twinWallBox(b, m.frame, w.axis, w.at, c + dw / 2 - 0.05, c + dw / 2, 0, P.cut + 0.012, thick + 0.03);
        twinWallBox(b, m.alu, w.axis, w.at, c - dw / 2 + 0.05, c + dw / 2 - 0.05, 0, 0.006, thick, 0, { cast: false });
    });
};

// Fenêtre à deux vantaux (cadre bronze anodisé), vitrage, appui intérieur et bavette alu
const twinWindow = (up, f, c, w) => {
    const m = twinMaterials();
    const P = TWIN_PLAN;
    const y0 = P.cut;
    const y1 = P.head;
    const fr = 0.06;
    const box = (mat, a, cc, ya, yb, thick, off = 0, o = {}) => twinWallBox(up, mat, f.axis, f.at, a, cc, ya, yb, thick, off, o);
    box(m.bronze, c - w / 2, c - w / 2 + fr, y0, y1, 0.09);
    box(m.bronze, c + w / 2 - fr, c + w / 2, y0, y1, 0.09);
    box(m.bronze, c - w / 2 + fr, c + w / 2 - fr, y1 - fr, y1, 0.09);
    box(m.bronze, c - w / 2 + fr, c + w / 2 - fr, y0, y0 + fr, 0.09);
    box(m.bronze, c - 0.03, c + 0.03, y0 + fr, y1 - fr, 0.08);
    box(m.windowGlass, c - w / 2 + fr, c + w / 2 - fr, y0 + fr, y1 - fr, 0.012);
    box(m.sill, c - w / 2 - 0.04, c + w / 2 + 0.04, y0 - 0.004, y0 + 0.022, 0.2, -f.out * 0.1);
    box(m.alu, c - w / 2 - 0.02, c + w / 2 + 0.02, y0 - 0.03, y0 + 0.004, 0.08, f.out * (P.wall / 2 + 0.03));
    [c - 0.08, c + 0.08].forEach(hx => box(m.bronze, hx - 0.012, hx + 0.012, (y0 + y1) / 2 - 0.06, (y0 + y1) / 2 + 0.06, 0.03, -f.out * 0.06));
};

// Façade : partie basse toujours visible (coupée, chapeau sombre) ; partie haute fenêtrée rangée dans un
// groupe masqué quand la caméra est du côté extérieur de ce mur (on voit l'intérieur sans perdre le fond).
const twinFacade = (b, up, f) => {
    const m = twinMaterials();
    const P = TWIN_PLAN;
    const T = P.wall;
    const extOff = f.out * (T / 2 - 0.085);
    const intOff = -f.out * (T / 2 - 0.04);
    const splits = f.finish.flatMap(x => [x[0], x[1]]);
    twinSpans(f.from, f.to, f.doors, splits).forEach(s => {
        if (s.hole) return;
        const fin = twinFinishAt(f.finish, s.mid);
        twinWallBox(b, m.facade, f.axis, f.at, s.a, s.b, 0, P.cut, 0.17, extOff);
        twinWallBox(b, m[fin], f.axis, f.at, s.a, s.b, 0, P.cut, 0.08, intOff);
        if (fin === 'panel') twinWallBox(b, m.skirting, f.axis, f.at, s.a, s.b, 0, 0.07, 0.012, -f.out * (T / 2 + 0.006));
        twinWallBox(b, m.cap, f.axis, f.at, s.a, s.b, P.cut, P.cut + 0.012, T + 0.004);
    });
    twinSpans(f.from, f.to, [...f.windows, ...f.doors], splits).forEach(s => {
        const fin = twinFinishAt(f.finish, s.mid);
        const y0 = !s.hole ? P.cut : f.doors.includes(s.hole) ? 2.1 : P.head;
        twinWallBox(up, m.facade, f.axis, f.at, s.a, s.b, y0, P.height, 0.17, extOff);
        twinWallBox(up, m[fin], f.axis, f.at, s.a, s.b, y0, P.height, 0.08, intOff);
        twinWallBox(up, m.slab, f.axis, f.at, s.a, s.b, P.height, P.height + 0.03, T + 0.02);
    });
    f.windows.forEach(([c, w]) => twinWindow(up, f, c, w));
};

const twinBuildShell = (b, uppers) => {
    const m = twinMaterials();
    const g = twinGeometries();
    TWIN_ROOMS.forEach(r => {
        const w = r.x[1] - r.x[0];
        const d = r.z[1] - r.z[0];
        b.part(g.plane, m[r.floor], [(r.x[0] + r.x[1]) / 2, 0.002, (r.z[0] + r.z[1]) / 2], [w, d, 1], { rx: -Math.PI / 2, cast: false });
    });
    TWIN_FACADES.forEach(f => twinFacade(b, uppers[f.id].b, f));
    TWIN_PARTITIONS.forEach(w => twinPartition(b, w));
};

// --- Mobilier ---
// Meuble bas de labo : caissons blancs, portes, lisse vert-de-gris à clips rouges, socle en retrait, plan sauge.
// Repère local : longueur sur x, façade vers +z (les deux faces si doubleSided).
const twinLabCabinets = (s, w, d, { doubleSided = false } = {}) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const h = TWIN_LAB.benchH;
    const top = h - 0.03;
    s.part(g.box, m.labPlinth, [0, 0.05, 0], [w - 0.04, 0.1, d - (doubleSided ? 0.16 : 0.12)]);
    s.part(g.box, m.labWhite, [0, 0.1 + (top - 0.1) / 2, 0], [w, top - 0.1, d - 0.04]);
    const n = Math.max(1, Math.round(w / 0.6));
    const dw = w / n;
    (doubleSided ? [1, -1] : [1]).forEach(side => {
        const fz = side * (d / 2 - 0.02);
        for (let i = 0; i < n; i++) {
            const cx = -w / 2 + dw * (i + 0.5);
            s.part(g.box, m.labWhite, [cx, 0.1 + (top - 0.16) / 2, fz + side * 0.009], [dw - 0.008, top - 0.18, 0.018]);
            s.part(g.box, m.labRed, [cx + (i % 2 ? 1 : -1) * (dw / 2 - 0.04), top - 0.035, fz + side * 0.037], [0.024, 0.044, 0.012]);
        }
        s.part(g.box, m.labRail, [0, top - 0.035, fz + side * 0.02], [w, 0.034, 0.03]);
    });
    s.part(g.box, m.counter, [0, h - 0.015, 0], [w + 0.02, 0.03, d + 0.02]);
};

// Évier encastré dans le plan sauge + robinetterie de labo émaillée blanche à manettes vertes
const twinLabSink = (s, x, z, w = 0.52, d = 0.38) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const h = TWIN_LAB.benchH;
    s.part(g.box, m.sinkInner, [x, h + 0.0015, z], [w, 0.003, d], { cast: false });
    s.part(g.box, m.counter, [x, h + 0.004, z - d / 2 - 0.012], [w + 0.04, 0.008, 0.024], { cast: false });
    s.part(g.cylLow, m.steelDark, [x + w * 0.3, h + 0.004, z + d * 0.22], [0.022, 0.004, 0.022], { cast: false });
    const fz = z - d / 2 - 0.09;
    s.part(g.cylLow, m.faucet, [x, h + 0.17, fz], [0.016, 0.34, 0.016]);
    s.part(g.cylLow, m.faucet, [x, h + 0.335, fz + 0.09], [0.013, 0.19, 0.013], { rx: Math.PI / 2 });
    s.part(g.cylLow, m.faucet, [x, h + 0.29, fz + 0.18], [0.011, 0.1, 0.011]);
    [-1, 1].forEach(sd => {
        s.part(g.cylLow, m.faucet, [x + sd * 0.055, h + 0.12, fz], [0.012, 0.09, 0.012], { rz: Math.PI / 2 });
        s.part(g.cyl, m.faucetGreen, [x + sd * 0.105, h + 0.12, fz], [0.022, 0.03, 0.022], { rz: Math.PI / 2 });
    });
};

// Armoire haute de labo (2,2 m) ; repère local : façade vers +z
const twinTallCabinet = (s, w, d, h = 2.2) => {
    const m = twinMaterials();
    const g = twinGeometries();
    s.part(g.box, m.labPlinth, [0, 0.05, 0], [w - 0.04, 0.1, d - 0.1]);
    s.part(g.box, m.labWhite, [0, 0.1 + (h - 0.1) / 2, 0], [w, h - 0.1, d - 0.03]);
    const n = Math.max(1, Math.round(w / 0.6));
    const dw = w / n;
    for (let i = 0; i < n; i++) {
        const cx = -w / 2 + dw * (i + 0.5);
        s.part(g.box, m.labWhite, [cx, 0.1 + (h - 0.12) / 2, d / 2 - 0.006], [dw - 0.008, h - 0.14, 0.018]);
        if (i % 2 === 0) s.part(g.cyl, m.alu, [cx + dw / 2 - 0.05, 1.05, d / 2 + 0.012], [0.019, 0.022, 0.019], { rx: Math.PI / 2 });
    }
    s.part(g.box, m.labRail, [0, h - 0.07, d / 2 + 0.008], [w, 0.03, 0.025]);
};

// Cartons « Einkochautomat » rangés sur les armoires
const twinWeckBoxMaterial = () => twinCanvasMaterial('weckBox', 256, 256, (g, w) => {
    g.fillStyle = '#F2F1EC';
    g.fillRect(0, 0, w, w);
    g.strokeStyle = '#D23B33';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(74, 96);
    g.lineTo(74, 196);
    g.quadraticCurveTo(128, 212, 182, 196);
    g.lineTo(182, 96);
    g.stroke();
    g.beginPath();
    g.ellipse(128, 96, 54, 11, 0, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(128, 74, 9, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#D23B33';
    g.fillRect(182, 172, 24, 8);
    g.font = '700 30px Outfit, sans-serif';
    g.textAlign = 'center';
    g.fillText('Einkochautomat', 128, 46);
}, { roughness: 0.85 });

// Caisse IFCO noire 60 × 40 cm (bouteilles) ; repère : centre du fond
const twinCrate = (b, x, y, z, h, mat) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const c = mat || m.crateBlack;
    b.part(g.box, c, [x, y + 0.006, z], [0.59, 0.012, 0.39]);
    [0.195, -0.195].forEach(dz => b.part(g.box, c, [x, y + h / 2, z + dz], [0.6, h, 0.01]));
    [0.295, -0.295].forEach(dx => b.part(g.box, c, [x + dx, y + h / 2, z], [0.01, h, 0.38]));
    [0.201, -0.201].forEach(dz => b.part(g.box, m.dark, [x, y + h * 0.78, z + dz], [0.14, 0.028, 0.004], { cast: false }));
};

// Bouteilles debout dans une caisse 60 × 40 (pleines : thé, étiquette, bouchon noir ; vides : verre seul)
const twinCrateBottles = (b, x, y, z, count, crateSize, contenanceCl, opts = {}) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const [cols, rows] = crateSize >= 50 ? [10, 5] : crateSize >= 40 ? [8, 5] : [4, 4];
    const spec = twinBottleSpec(contenanceCl);
    const dx = 0.57 / cols;
    const dz = 0.37 / rows;
    const r = Math.min(spec.d / 2, Math.min(dx, dz) / 2 - 0.003);
    for (let i = 0; i < Math.min(count, cols * rows); i++) {
        const bx = x - 0.285 + dx * (i % cols + 0.5);
        const bz = z - 0.185 + dz * (Math.floor(i / cols) + 0.5);
        twinBottle(b, bx, y, bz, r, spec.h, opts);
    }
};

const twinBottle = (b, x, y, z, r, h, { color = null, labelMat = null, upsideDown = false } = {}) => {
    const m = twinMaterials();
    const g = twinGeometries();
    if (upsideDown) {
        b.part(g.bottle, m.bottleGlass, [x, y + h, z], [r, h, r], { rx: Math.PI });
        return;
    }
    if (color) {
        b.part(g.liquid, m.liquid, [x, y, z], [r, h, r], { color: twinTeaColor(color) });
        b.part(g.cylLow, m.capBlack, [x, y + h * 0.985, z], [r * 0.66, h * 0.07, r * 0.66]);
        // Économie : bouteille pleine réduite au thé et au bouchon (vue d'en haut, le verre et l'étiquette se voient peu)
        if (Twin.quality.level === 'low') return;
        if (labelMat) b.part(g.band, labelMat, [x, y + h * 0.3, z], [r * 1.012, h * 0.26, r * 1.012], { cast: false });
    }
    b.part(g.bottle, m.bottleGlass, [x, y, z], [r, h, r]);
};

// Chariot rouleur bleu pour caisses 60 × 40 (repère : centre au sol)
const twinDolly = (b, x, z, ry = 0) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const o = { ry };
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    const at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    b.part(g.box, m.dolly, [x, 0.11, z], [0.62, 0.04, 0.42], o);
    [[0.27, 0.17], [-0.27, 0.17], [0.27, -0.17], [-0.27, -0.17]].forEach(([lx, lz]) => {
        const [px, pz] = at(lx, lz);
        b.part(g.box, m.steelDark, [px, 0.075, pz], [0.05, 0.03, 0.05], o);
        b.part(g.cyl, m.rubber, [px, 0.04, pz], [0.038, 0.03, 0.038], { rx: Math.PI / 2, ry });
    });
};

// Caisse verte ajourée 60 × 40 × 24 cm (commandes)
const twinGreenCrate = (b, x, y, z, ry = 0) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const H = 0.24;
    const s = twinBuilderAt(b, x, y, z, ry);
    s(g.box, m.crateGreenSolid, [0, 0.008, 0], [0.59, 0.016, 0.39]);
    [[0, 0.196, 0.6, 0.012], [0, -0.196, 0.6, 0.012]].forEach(([lx, lz, w, t]) => {
        s(g.box, m.crateGreen, [lx, H / 2, lz], [w, H - 0.05, t]);
        s(g.box, m.crateGreenSolid, [lx, H - 0.012, lz], [w, 0.024, t + 0.006]);
        s(g.box, m.crateGreenSolid, [lx, 0.02, lz], [w, 0.024, t + 0.004]);
    });
    [0.295, -0.295].forEach(lx => {
        s(g.box, m.crateGreen, [lx, H / 2, 0], [0.012, H - 0.05, 0.38]);
        s(g.box, m.crateGreenSolid, [lx, H - 0.012, 0], [0.018, 0.024, 0.38]);
        s(g.box, m.crateGreenSolid, [lx, 0.02, 0], [0.016, 0.024, 0.38]);
    });
};

// Petit adaptateur : pose une pièce dans un repère (x, y, z, ry) à l'intérieur d'un builder
const twinBuilderAt = (b, x, y, z, ry) => {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    return (geo, mat, p, sc, o = {}) => b.part(geo, mat, [x + p[0] * c + p[2] * s, y + p[1], z - p[0] * s + p[2] * c], sc, { ...o, ry: (o.ry || 0) + ry });
};

// --- Pièces ---
// Laboratoire de production : paillasse sous les fenêtres (cuves, plaques, évier), îlot d'embouteillage,
// armoires hautes, réfrigérateur, coffret électrique, étagère des infuseurs
const twinBuildLab = (batch, env, up) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const h = TWIN_LAB.benchH;
    const bench = twinBuilder(batch, env, -6.98, TWIN_LAB.benchZ);
    twinLabCabinets(bench, 9.92, 0.7);
    twinLabSink(bench, 0.1, 0.06);
    // Balance, bocaux d'ingrédients, cul-de-poule, infuseurs à mailles
    bench.part(g.box, m.white, [0.95, h + 0.025, 0.05], [0.26, 0.05, 0.26]);
    bench.part(g.box, m.steel, [0.95, h + 0.054, 0.03], [0.23, 0.008, 0.19]);
    bench.part(g.box, m.screen, [0.95, h + 0.03, 0.181], [0.1, 0.025, 0.003], { cast: false });
    ['#C0392B', '#6C3483', '#E2C55A', '#4E8B3A'].forEach((c, i) => {
        const jx = 1.45 + i * 0.15;
        bench.part(g.cyl, m.tint, [jx, h + 0.065, -0.18], [0.048, 0.12, 0.048], { color: twinShade(c, 0.8) });
        bench.part(g.cylLow, m.jarGlass, [jx, h + 0.09, -0.18], [0.056, 0.18, 0.056]);
        bench.part(g.cyl, m.steel, [jx, h + 0.19, -0.18], [0.059, 0.02, 0.059]);
    });
    bench.part(g.bowl, m.steelShell, [2.3, h, 0.02], [0.15, 0.2, 0.15]);
    [2.85, 3.2].forEach(ix => {
        bench.part(g.cyl, m.mesh, [ix, h + 0.1, -0.05], [0.1, 0.2, 0.1]);
        bench.part(g.torus, m.steel, [ix, h + 0.2, -0.05], [0.1, 0.1, 0.5], { rx: Math.PI / 2 });
    });
    // Îlot d'embouteillage à double face
    const [ix, iz] = TWIN_LAB.island;
    const isl = twinBuilder(batch, env, ix, iz);
    twinLabCabinets(isl, 4.6, 1.2, { doubleSided: true });
    // Remplisseuse : cuve de tête sur potence, tuyaux vers 4 becs au-dessus d'un casier
    const fx = -0.6;
    isl.part(g.box, m.steel, [fx, h + 0.006, -0.2], [0.36, 0.012, 0.28]);
    isl.part(g.cylLow, m.steel, [fx, h + 0.4, -0.3], [0.014, 0.8, 0.014]);
    isl.part(g.cyl, m.steel, [fx, h + 0.66, -0.3], [0.15, 0.26, 0.15]);
    isl.part(g.cyl, m.steel, [fx, h + 0.795, -0.3], [0.155, 0.012, 0.155]);
    isl.part(g.cylLow, m.steelDark, [fx, h + 0.51, -0.3], [0.03, 0.05, 0.03]);
    isl.part(g.box, m.steel, [fx, h + 0.45, -0.12], [0.5, 0.025, 0.025]);
    for (let k = 0; k < 4; k++) {
        const nx = fx - 0.18 + k * 0.12;
        isl.part(g.cylLow, m.jarGlass, [nx, h + 0.48, -0.21], [0.008, 0.2, 0.008], { rx: 0.55 });
        isl.part(g.cylLow, m.chrome, [nx, h + 0.4, -0.12], [0.008, 0.08, 0.008]);
    }
    twinCrate(isl, fx, h, -0.12 + 0.07, 0.18);
    for (let k = 0; k < 4; k++) twinBottle(isl, fx - 0.105 + k * 0.07, h + 0.012, -0.04, 0.032, 0.25, {});
    twinCrate(isl, 0.1, h, 0.15, 0.18);
    twinCrateBottles(isl, 0.1, h + 0.012, 0.15, 40, 40, 50, { color: '#C57A2A', labelMat: twinBottleLabelMaterial('Thé froid', '#C57A2A') });
    twinCrate(isl, -1.5, h, 0.12, 0.18);
    twinCrateBottles(isl, -1.5, h + 0.012, 0.12, 40, 40, 50, {});
    isl.part(g.cyl, m.label, [0.95, h + 0.05, -0.25], [0.08, 0.1, 0.08], { rx: Math.PI / 2 });
    isl.part(g.cylLow, m.dark, [0.95, h + 0.05, -0.25], [0.03, 0.102, 0.03], { rx: Math.PI / 2 });
    isl.part(g.box, m.label, [1.5, h + 0.004, 0.2], [0.21, 0.004, 0.3], { ry: 0.2, cast: false });
    isl.part(g.funnel, m.steelShell, [1.95, h, -0.15], [0.09, 0.17, 0.09]);
    // Armoires hautes contre la façade ouest, cartons d'Einkochautomat posés dessus
    const tall = twinBuilder(batch, env, -11.7, -5.4, Math.PI / 2);
    twinTallCabinet(tall, 3.6, 0.6);
    const weck = twinWeckBoxMaterial();
    [-1.3, -0.45, 0.4, 1.25].forEach((lx, i) => tall.part(g.box, weck, [lx, 2.2 + 0.21, 0.02], [0.42, 0.42, 0.42], { ry: (i % 2 ? 0.04 : -0.03) }));
    // Réfrigérateur de labo (relevé de températures sur la porte)
    const fr = twinBuilder(batch, env, -11.66, -2.35, Math.PI / 2);
    fr.part(g.box, m.whitePlastic, [0, 0.64, 0], [0.6, 1.28, 0.62]);
    fr.part(g.box, m.whitePlastic, [0, 0.66, 0.318], [0.58, 1.2, 0.02]);
    fr.part(g.box, m.alu, [0.24, 0.85, 0.335], [0.025, 0.32, 0.02]);
    fr.part(g.box, m.label, [-0.06, 0.85, 0.329], [0.21, 0.28, 0.002], { cast: false });
    // Murs (partie haute) : étagère des infuseurs entre les fenêtres, coffret de prises industrielles CEE
    const wz = TWIN_PLAN.z0;
    up.back.b.part(g.box, m.white, [-7.2, 1.62, wz + 0.16], [1.3, 0.025, 0.3]);
    [-7.75, -6.65].forEach(bx => up.back.b.part(g.box, m.alu, [bx, 1.56, wz + 0.1], [0.02, 0.1, 0.2]));
    [-7.6, -7.25, -6.9].forEach(ix2 => up.back.b.part(g.cyl, m.mesh, [ix2, 1.72, wz + 0.16], [0.11, 0.19, 0.11]));
    up.back.b.part(g.box, m.whiteDark, [-2.55, 1.55, wz + 0.07], [0.32, 0.44, 0.12]);
    [[-2.64, 1.62, m.cee], [-2.46, 1.62, m.cee], [-2.64, 1.46, m.cee], [-2.46, 1.46, m.ceeBlue]].forEach(([cx, cy, mat]) =>
        up.back.b.part(g.cyl, mat, [cx, cy, wz + 0.15], [0.045, 0.06, 0.045], { rx: Math.PI / 2 }));
    up.back.b.part(g.cylLow, m.dark, [-2.46, 1.38, wz + 0.17], [0.012, 0.18, 0.012]);
};

// Laverie : plonge inox double bac, égouttoir à bouteilles retournées, casiers de bouteilles vides, siphon
const twinBuildLaverie = (batch, env) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const s = twinBuilder(batch, env, 0, -7.66);
    s.part(g.box, m.steel, [0, 0.9, 0], [3.1, 0.04, 0.66], { receive: true });
    s.part(g.box, m.steel, [0, 1.0, -0.32], [3.1, 0.2, 0.02]);
    [-1.5, -0.5, 0.5, 1.5].forEach(lx => [-1, 1].forEach(sd => s.part(g.box, m.steel, [lx, 0.44, sd * 0.28], [0.04, 0.88, 0.04])));
    s.part(g.box, m.steel, [0, 0.16, 0], [3.0, 0.02, 0.58], { receive: true });
    [-0.75, 0.05].forEach(bx => {
        s.part(g.box, m.steelDark, [bx, 0.921, 0.02], [0.62, 0.002, 0.46], { cast: false });
        s.part(g.cylLow, m.dark, [bx, 0.923, 0.02], [0.03, 0.002, 0.03], { cast: false });
    });
    s.part(g.cylLow, m.chrome, [-0.35, 1.25, -0.24], [0.015, 0.7, 0.015]);
    s.part(g.torus, m.chrome, [-0.35, 1.45, -0.24], [0.05, 0.05, 2.5]);
    s.part(g.cylLow, m.chrome, [-0.35, 1.6, -0.14], [0.012, 0.22, 0.012], { rx: Math.PI / 2 });
    s.part(g.cylLow, m.dark, [-0.35, 1.22, -0.08], [0.018, 0.1, 0.018]);
    // Égouttoir inox : bouteilles retournées sur trois niveaux
    const r = twinBuilder(batch, env, 1.3, -4.3, -Math.PI / 2);
    [-0.6, 0.6].forEach(lx => [-0.2, 0.2].forEach(lz => r.part(g.box, m.steel, [lx, 0.8, lz], [0.025, 1.6, 0.025])));
    [0.35, 0.85, 1.35].forEach(y => {
        r.part(g.box, m.steel, [0, y, 0], [1.22, 0.015, 0.42], { receive: true });
        for (let k = 0; k < 7; k++) {
            [-0.09, 0.09].forEach(lz => twinBottle(r, -0.51 + k * 0.17, y + 0.008, lz, 0.033, 0.25, { upsideDown: true }));
        }
    });
    // Casiers de bouteilles propres le long de la cloison
    const c = twinBuilder(batch, env, -1.42, -5.4, Math.PI / 2);
    [0, 0.64].forEach(lx => [0, 1, 2].forEach(k => {
        twinCrate(c, lx, k * 0.26, 0, 0.26);
        if (k === 2) twinCrateBottles(c, lx, k * 0.26 + 0.012, 0, 40, 40, 50, {});
    }));
    s.part(g.box, m.steelDark, [0, 0.004, 3.1], [0.26, 0.004, 0.26], { cast: false });
};

// Stock de produits finis (les piles de casiers sont dynamiques) : chariots garés, casiers vides, horloge
const twinBuildStockRoom = (batch, env, up) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const b = twinBuilder(batch, env, 0, 0);
    twinDolly(b, 2.35, -2.0, 0.1);
    twinDolly(b, 2.4, -2.55, -0.05);
    const c = twinBuilder(batch, env, 2.2, -7.5, Math.PI / 2);
    [0, 1, 2, 3].forEach(k => twinCrate(c, 0, k * 0.26, 0, 0.26));
    const wz = TWIN_PLAN.z0;
    up.back.b.part(g.cyl, m.white, [7.1, 2.2, wz + 0.03], [0.16, 0.03, 0.16], { rx: Math.PI / 2 });
    up.back.b.part(g.torus, m.dark, [7.1, 2.2, wz + 0.045], [0.16, 0.16, 0.6]);
    up.back.b.part(g.box, m.dark, [7.1, 2.24, wz + 0.05], [0.01, 0.09, 0.004], { cast: false });
    up.back.b.part(g.box, m.dark, [7.13, 2.2, wz + 0.052], [0.07, 0.008, 0.004], { rz: 0.4, cast: false });
};

// Couloir : extincteurs, porte de secours, balais, caisses vertes empilées, enseigne ThéCol
const twinBuildCorridor = (batch, env, up) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const b = twinBuilder(batch, env, 0, 0);
    [[-5.1, -0.9], [6.2, 1.3]].forEach(([x, z]) => {
        b.part(g.cyl, m.extinguisher, [x, 0.42, z], [0.08, 0.5, 0.08]);
        b.part(g.cylLow, m.dark, [x, 0.71, z], [0.035, 0.08, 0.035]);
        b.part(g.box, m.dark, [x + 0.04, 0.74, z], [0.1, 0.02, 0.02]);
    });
    // Porte de secours (bout ouest) : battant bois, barre anti-panique, signalétique
    const dx = TWIN_PLAN.x0 - 0.05;
    b.part(g.box, m.wood, [dx, TWIN_PLAN.cut / 2, 0.2], [0.05, TWIN_PLAN.cut, 0.96]);
    b.part(g.box, m.chrome, [dx + 0.065, 1.0, 0.2], [0.03, 0.04, 0.8]);
    up.west.b.part(g.box, m.wood, [dx, (TWIN_PLAN.cut + 2.1) / 2, 0.2], [0.05, 2.1 - TWIN_PLAN.cut, 0.96]);
    up.west.b.part(g.box, twinSignMaterial('sortie', '#1E8E4E', '#FFFFFF', 'SORTIE'), [TWIN_PLAN.x0 + 0.02, 2.3, 0.2], [0.5, 0.16, 0.02], { cast: false, ry: Math.PI / 2 });
    // Range-balais (photo du couloir) près du vestiaire
    const w = TWIN_PLAN.south - 0.08;
    b.part(g.box, m.alu, [1.25, 1.02, w], [0.42, 0.04, 0.03]);
    [1.08, 1.22, 1.36].forEach((x, i) => {
        b.part(g.cylLow, i === 1 ? m.ceeBlue : m.dark, [x, 0.72, w - 0.04], [0.013, 1.32, 0.013]);
        b.part(g.box, m.dark, [x, 0.07, w - 0.05], [0.26, 0.05, 0.06]);
    });
    b.part(g.box, m.extinguisher, [1.55, 0.3, w - 0.06], [0.22, 0.03, 0.26], { rx: -1.2 });
    // Caisses vertes empilées et caisses noires pliées
    [0, 1, 2].forEach(k => twinGreenCrate(b, 7.35, k * 0.24, 1.12, 0));
    [0, 1].forEach(k => b.part(g.box, m.crateBlack, [8.15, 0.03 + k * 0.05, 1.12], [0.6, 0.05, 0.4]));
    // Enseigne ThéCol au bout du couloir (façade est)
    up.east.b.part(g.box, twinSignMaterial('thecol', Twin.palette.primary, '#FFFFFF', 'ThéCol', 'Thé froid artisanal'),
        [TWIN_PLAN.x1 - 0.02, 1.95, 0.2], [1.68, 0.42, 0.02], { cast: false, ry: -Math.PI / 2 });
};

// Réserve : chambre froide (évaporateur, climatiseur, porte isotherme) et préparation carrelée (plans blancs)
const twinBuildReserve = (batch, env, up) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const b = twinBuilder(batch, env, 0, 0);
    const wx = TWIN_PLAN.x0;
    // Évaporateur au mur (partie haute de la façade ouest)
    up.west.b.part(g.box, m.whitePlastic, [wx + 0.26, 2.45, 4.8], [0.44, 0.38, 0.86]);
    up.west.b.part(g.cyl, m.dark, [wx + 0.485, 2.45, 4.6], [0.15, 0.012, 0.15], { rz: Math.PI / 2 });
    up.west.b.part(g.cyl, m.dark, [wx + 0.485, 2.45, 5.0], [0.15, 0.012, 0.15], { rz: Math.PI / 2 });
    up.west.b.part(g.box, m.hazard, [wx + 0.482, 2.55, 5.18], [0.004, 0.08, 0.06], { cast: false });
    up.west.b.part(g.cylLow, m.dark, [wx + 0.1, 2.18, 4.55], [0.03, 0.18, 0.03]);
    up.west.b.part(g.cylLow, m.chrome, [wx + 0.16, 2.2, 4.75], [0.012, 0.14, 0.012]);
    // Climatiseur mobile et sa gaine
    b.part(g.box, m.whitePlastic, [wx + 0.3, 0.38, 7.55], [0.34, 0.76, 0.32]);
    b.part(g.box, m.dark, [wx + 0.3, 0.68, 7.392], [0.2, 0.05, 0.004], { cast: false });
    b.part(g.cyl, m.hoseBeige, [wx + 0.12, 0.93, 7.55], [0.07, 0.34, 0.07]);
    up.west.b.part(g.cyl, m.hoseBeige, [wx + 0.12, 1.75, 7.55], [0.07, 1.3, 0.07]);
    b.part(g.box, m.mat, [-7.55, 0.006, 3.0], [0.6, 0.012, 0.9], { cast: false });
    // Porte isotherme grise ouverte (gonds et poignée chromés)
    const door = twinBuilder(batch, env, -7.94, 3.45, Math.PI / 2 + 0.12);
    door.part(g.box, m.doorGrey, [0, 0.98, 0.45], [0.08, 1.95, 0.9]);
    door.part(g.box, m.alu, [0, 0.98, 0.45], [0.084, 1.9, 0.86]);
    door.part(g.box, m.doorGrey, [0, 0.98, 0.45], [0.088, 1.82, 0.78]);
    [0.35, 1.6].forEach(y => door.part(g.box, m.chrome, [0.05, y, 0.12], [0.02, 0.06, 0.28]));
    door.part(g.box, m.chrome, [0.06, 1.0, 0.72], [0.025, 0.04, 0.24]);
    // Plans de préparation blancs (façade sud), balance, cul-de-poule, rouleaux de papier, boîtes de fruits séchés
    const k = twinBuilder(batch, env, -4.92, 7.66, Math.PI);
    const kw = 5.7;
    k.part(g.box, m.labPlinth, [0, 0.05, 0], [kw - 0.04, 0.1, 0.56]);
    k.part(g.box, m.kitchenWhite, [0, 0.49, 0], [kw, 0.78, 0.62]);
    const n = Math.round(kw / 0.6);
    for (let i = 0; i < n; i++) {
        const cx = -kw / 2 + kw / n * (i + 0.5);
        k.part(g.box, m.kitchenWhite, [cx, 0.48, 0.32], [kw / n - 0.01, 0.74, 0.018]);
        k.part(g.box, m.whiteDark, [cx, 0.8, 0.338], [0.16, 0.02, 0.02]);
    }
    k.part(g.box, m.kitchenWhite, [0, 0.9, 0.01], [kw + 0.02, 0.03, 0.66]);
    k.part(g.cyl, m.steel, [-1.8, 0.94, 0.05], [0.12, 0.02, 0.12]);
    k.part(g.bowl, m.steelShell, [-1.2, 0.915, 0.0], [0.17, 0.22, 0.17]);
    for (let i = 0; i < 8; i++) k.part(g.cyl, m.white, [0.2 + (i % 4) * 0.12, 0.98, -0.1 + Math.floor(i / 4) * 0.12], [0.055, 0.13, 0.055]);
    k.part(g.box, m.film, [0.38, 0.99, -0.04], [0.5, 0.15, 0.26]);
    k.part(g.box, m.valveRed, [0.38, 0.99, 0.092], [0.5, 0.03, 0.004], { cast: false });
    const fruit = twinContentMaterial('fruit');
    [0, 1, 2].forEach(i => {
        const y = 0.915 + i * 0.27;
        k.part(g.box, fruit, [1.95, y + 0.11, 0], [0.37, 0.21, 0.27]);
        k.part(g.box, m.boxPlastic, [1.95, y + 0.13, 0], [0.4, 0.26, 0.3]);
        k.part(g.box, m.boxLid, [1.95, y + 0.265, 0], [0.41, 0.014, 0.31]);
    });
    // Chariot inox à trois plateaux (préparation)
    const t = twinBuilder(batch, env, -6.4, 6.55, 0.12);
    [0.16, 0.5, 0.86].forEach(y => t.part(g.box, m.steel, [0, y, 0], [0.8, 0.02, 0.5]));
    [-1, 1].forEach(sx => [-1, 1].forEach(sz => {
        t.part(g.cylLow, m.steel, [sx * 0.39, 0.5, sz * 0.24], [0.012, 0.8, 0.012]);
        t.part(g.cyl, m.rubber, [sx * 0.39, 0.04, sz * 0.24], [0.04, 0.03, 0.04], { rx: Math.PI / 2 });
    }));
    t.part(g.bowl, m.steelShell, [-0.2, 0.87, 0], [0.14, 0.18, 0.14]);
    t.part(g.box, fruit, [0.17, 0.96, 0], [0.27, 0.17, 0.2]);
    t.part(g.box, m.boxPlastic, [0.17, 0.995, 0], [0.3, 0.25, 0.23]);
    t.part(g.box, m.boxLid, [0.17, 1.125, 0], [0.31, 0.014, 0.24]);
    [0, 1].forEach(i => t.part(g.box, m.kraft, [0.05 + i * 0.3, 0.6, 0.02], [0.26, 0.18, 0.34]));
};

// Vestiaire et bureau : portant à blouses (employés absents), banc, pointeuse, bureau avec écran et imprimante
const twinBuildVestiaire = (batch, env) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const b = twinBuilder(batch, env, 0, 0);
    // Portant à blouses le long de la cloison ouest
    const rx = -1.32;
    [2.1, 5.7].forEach(z => {
        b.part(g.box, m.alu, [rx, 0.9, z], [0.035, 1.8, 0.035]);
        b.part(g.box, m.alu, [rx, 0.02, z], [0.45, 0.04, 0.04]);
    });
    b.part(g.cylLow, m.chrome, [rx, 1.78, 3.9], [0.014, 3.6, 0.014], { rx: Math.PI / 2 });
    // Banc
    b.part(g.box, m.wood, [-0.72, 0.45, 3.9], [0.36, 0.04, 2.4]);
    [3.0, 4.8].forEach(z => b.part(g.box, m.steelDark, [-0.72, 0.22, z], [0.3, 0.44, 0.04]));
    // Pointeuse sur pied, face au couloir
    b.part(g.box, m.steelDark, [1.3, 0.58, 2.0], [0.07, 1.16, 0.07]);
    b.part(g.box, m.dark, [1.3, 1.3, 1.97], [0.24, 0.32, 0.12]);
    b.part(g.box, m.screen, [1.3, 1.36, 1.909], [0.15, 0.1, 0.004], { cast: false });
    b.part(g.box, m.steel, [1.3, 1.21, 1.909], [0.11, 0.05, 0.004], { cast: false });
    // Bureau (imprimante, écran affichant le jumeau, classeurs verts, chaise)
    const d = twinBuilder(batch, env, 0, 7.6);
    d.part(g.box, m.white, [0, 0.74, 0], [3.0, 0.03, 0.7], { receive: true });
    [-1.42, 1.42].forEach(x => [-0.3, 0.3].forEach(z => d.part(g.box, m.alu, [x, 0.36, z], [0.04, 0.72, 0.04])));
    d.part(g.box, m.dark, [0, 0.765, 0.14], [0.22, 0.015, 0.16]);
    d.part(g.box, m.dark, [0, 0.9, 0.18], [0.05, 0.27, 0.03]);
    d.part(g.box, m.dark, [0, 1.07, 0.15], [0.6, 0.36, 0.03]);
    d.part(g.box, twinMonitorMaterial(), [0, 1.07, 0.134], [0.56, 0.32, 0.002], { cast: false, ry: Math.PI });
    d.part(g.box, m.plasticLight, [0, 0.762, -0.12], [0.44, 0.015, 0.14]);
    d.part(g.box, m.dark, [-0.95, 0.85, 0.05], [0.45, 0.2, 0.34]);
    d.part(g.box, m.plasticLight, [-0.95, 0.955, 0.05], [0.4, 0.01, 0.28]);
    [0.85, 0.95, 1.05].forEach(x => d.part(g.box, m.crateGreenSolid, [x, 0.9, 0.18], [0.07, 0.3, 0.26]));
    d.part(g.cyl, m.dark, [1.25, 0.81, -0.05], [0.04, 0.12, 0.04]);
    const ch = twinBuilder(batch, env, 0.2, 6.95, 0.15);
    ch.part(g.box, m.plastic, [0, 0.47, 0], [0.46, 0.07, 0.44]);
    ch.part(g.box, m.plastic, [0, 0.82, -0.2], [0.42, 0.55, 0.06], { rx: -0.08 });
    ch.part(g.cylLow, m.steelDark, [0, 0.25, 0], [0.03, 0.4, 0.03]);
    [0, 1, 2, 3, 4].forEach(i => {
        const a = i * Math.PI * 2 / 5;
        ch.part(g.box, m.dark, [Math.cos(a) * 0.15, 0.05, Math.sin(a) * 0.15], [0.3, 0.025, 0.04], { ry: -a });
    });
};

// Écran du bureau : l'application ThéCol Gestion ouverte
const twinMonitorMaterial = () => twinCanvasMaterial('monitor', 256, 160, (g, w, h) => {
    g.fillStyle = '#F5F5F0';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#5D7B3E';
    g.fillRect(0, 0, 46, h);
    g.fillStyle = '#FFFFFF';
    for (let i = 0; i < 4; i++) g.fillRect(56 + i * 50, 14, 42, 30);
    g.fillStyle = '#DCE6D2';
    g.fillRect(56, 54, 192, 92);
    g.fillStyle = '#8BA66B';
    for (let i = 0; i < 6; i++) g.fillRect(66 + i * 30, 130 - i * 11, 18, 10 + i * 11);
}, { roughness: 0.3, extra: { emissive: '#FFFFFF', emissiveIntensity: 0.55 } });

// Expédition : monte-charge inox, chariots garés, caisses vertes vides
const twinBuildExpedition = (batch, env, up) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const b = twinBuilder(batch, env, 0, 0);
    const ex = TWIN_PLAN.x1;
    const zc = 4.3;
    const cut = TWIN_PLAN.cut;
    [[b, 0, cut], [up.east.b, cut, 2.1]].forEach(([s, y0, y1]) => {
        [-0.45, 0.45].forEach(dz => s.part(g.box, m.steel, [ex + 0.05, (y0 + y1) / 2, zc + dz], [0.04, y1 - y0, 0.88]));
        [-0.92, 0.92].forEach(dz => s.part(g.box, m.steelDark, [ex - 0.02, (y0 + y1) / 2, zc + dz], [0.08, y1 - y0, 0.06]));
    });
    b.part(g.box, m.steelDark, [ex - 0.02, 0.005, zc], [0.3, 0.01, 1.8], { cast: false });
    up.east.b.part(g.box, m.steelDark, [ex - 0.02, 2.13, zc], [0.08, 0.06, 1.9]);
    up.east.b.part(g.box, m.dark, [ex - 0.03, 2.3, zc], [0.03, 0.12, 0.22]);
    up.east.b.part(g.box, m.ledOrange, [ex - 0.046, 2.3, zc], [0.004, 0.06, 0.08], { cast: false });
    b.part(g.box, m.steel, [ex - 0.03, 1.0, zc + 1.12], [0.03, 0.22, 0.1]);
    b.part(g.cylLow, m.ledOrange, [ex - 0.05, 1.04, zc + 1.12], [0.02, 0.01, 0.02], { rz: Math.PI / 2, cast: false });
    b.part(g.cylLow, m.dark, [ex - 0.05, 0.96, zc + 1.12], [0.02, 0.01, 0.02], { rz: Math.PI / 2, cast: false });
    twinDolly(b, 11.25, 7.42, 0);
    twinDolly(b, 11.3, 6.9, 0.08);
    [0, 1, 2, 3, 4].forEach(k => twinGreenCrate(b, 10.5, k * 0.24, 7.55, 0));
};

// --- Assemblage du décor statique (les parties hautes des façades forment des groupes à coupe automatique) ---
const twinBuildEnvironment = () => {
    const { THREE } = Twin.lib;
    const env = new THREE.Group();
    const batch = twinBatch();
    const b = twinBuilder(batch, env, 0, 0);
    const uppers = {};
    TWIN_FACADES.forEach(f => {
        const group = new THREE.Group();
        const ub = twinBatch();
        uppers[f.id] = { group, batch: ub, b: twinBuilder(ub, group, 0, 0) };
        Twin.cutaways.push({
            group,
            nx: f.axis === 'z' ? f.out : 0,
            nz: f.axis === 'x' ? f.out : 0,
            px: f.axis === 'z' ? f.at : 0,
            pz: f.axis === 'x' ? f.at : 0
        });
    });
    twinBuildSite(b);
    twinBuildShell(b, uppers);
    twinBuildLab(batch, env, uppers);
    twinBuildLaverie(batch, env);
    twinBuildStockRoom(batch, env, uppers);
    twinBuildCorridor(batch, env, uppers);
    twinBuildReserve(batch, env, uppers);
    twinBuildVestiaire(batch, env);
    twinBuildExpedition(batch, env, uppers);
    twinBatchFlush(batch, env);
    Object.values(uppers).forEach(u => {
        twinBatchFlush(u.batch, u.group);
        env.add(u.group);
    });
    Twin.scene.add(env);
};

// Façades côté caméra : seule la partie basse (coupée) reste visible, comme sur une maquette
const twinUpdateCutaways = () => {
    const cam = Twin.camera.position;
    let changed = false;
    Twin.cutaways.forEach(c => {
        const show = (cam.x - c.px) * c.nx + (cam.z - c.pz) * c.nz < 0;
        if (c.group.visible !== show) {
            c.group.visible = show;
            changed = true;
        }
    });
    if (changed) twinShadowsDirty();
};

const twinBuildMarkers = () => {
    const { THREE } = Twin.lib;
    const p = Twin.palette;
    const hover = twinMesh(twinGeometries().ring, new THREE.MeshBasicMaterial({ color: p.primary, transparent: true, opacity: 0.45, depthWrite: false }), { cast: false });
    hover.rotation.x = -Math.PI / 2;
    hover.visible = false;
    const select = twinMesh(twinGeometries().ring, new THREE.MeshBasicMaterial({ color: p.primary, transparent: true, opacity: 0.95, depthWrite: false }), { cast: false });
    select.rotation.x = -Math.PI / 2;
    select.visible = false;
    const pin = new THREE.Group();
    const pinMat = new THREE.MeshStandardMaterial({ color: p.primary, emissive: p.primary, emissiveIntensity: 0.5 });
    const stem = twinMesh(twinGeometries().cyl, pinMat, { cast: false });
    stem.scale.set(0.03, 0.9, 0.03);
    stem.position.y = 0.75;
    const tip = twinMesh(twinGeometries().cone, pinMat, { cast: false });
    tip.scale.set(0.2, 0.36, 0.2);
    tip.rotation.x = Math.PI;
    tip.position.y = 0.18;
    pin.add(stem, tip);
    pin.visible = false;
    Twin.markers.add(hover, select, pin);
    Object.assign(Twin, { hoverRing: hover, selectRing: select, pin });
};

// Volume de sélection invisible (hors scène) + ancrages des marqueurs et labels
const twinRegister = (item, b, { hit, top, radius, base = [0, 0, 0] }) => {
    const { THREE } = Twin.lib;
    const proxy = new THREE.Mesh(twinGeometries().box, twinMaterials().proxy);
    b.matrix(hit.p, hit.s).decompose(proxy.position, proxy.quaternion, proxy.scale);
    proxy.userData.twinId = item.id;
    Twin.proxies.add(proxy);
    Twin.objects.set(item.id, {
        id: item.id, zone: item.zone, radius,
        base: b.point(base),
        top: b.point([base[0], top, base[2]])
    });
};

const twinSetLiquid = (mesh, base, radius, h) => {
    mesh.scale.set(radius, h, radius);
    mesh.position.y = base + h / 2;
};

const twinAddFill = (id, targets, fill) => {
    const from = Twin.prevFill.has(id) ? Twin.prevFill.get(id) : fill;
    // Niveau inchangé (re-rendu sans modification) : aucune animation, donc aucun rendu continu
    const animate = from !== fill && !twinReducedMotion();
    const start = performance.now();
    targets.forEach(t => {
        if (animate) Twin.fills.push({ ...t, from, to: fill, start });
        twinSetLiquid(t.mesh, t.base, t.radius, Math.max(0.002, (animate ? from : fill) * t.maxH));
    });
    Twin.prevFill.set(id, fill);
};

// --- Équipement de production : cuve 25 L (cuiseur inox à robinet) posée sur la paillasse ---
const twinBuildCuve = (batch, e, x, z) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const b = twinBuilder(batch, Twin.dynamic, x, z, 0, TWIN_LAB.benchH);
    const { R } = TWIN_CUVE;
    const planned = e.status === 'planned';
    b.part(g.cyl, m.plastic, [0, 0.016, 0], [R * 0.97, 0.032, R * 0.97]);
    b.part(g.cuve, m.steelShell, [0, 0, 0], [1, 1, 1]);
    // Thermostat, voyant de chauffe, robinet de soutirage, poignées
    b.part(g.cyl, m.plastic, [-0.07, 0.07, R + 0.01], [0.026, 0.02, 0.026], { rx: Math.PI / 2 });
    b.part(g.box, m.white, [-0.07, 0.083, R + 0.021], [0.004, 0.014, 0.003], { cast: false });
    b.part(g.cyl, planned ? m.ledOrange : m.ledOff, [-0.015, 0.07, R + 0.003], [0.008, 0.01, 0.008], { rx: Math.PI / 2, cast: false });
    b.part(g.cylLow, m.chrome, [0.07, 0.06, R + 0.03], [0.012, 0.06, 0.012], { rx: Math.PI / 2 });
    b.part(g.cylLow, m.chrome, [0.07, 0.042, R + 0.055], [0.01, 0.035, 0.01]);
    b.part(g.box, m.plastic, [0.07, 0.085, R + 0.05], [0.014, 0.05, 0.012], { rx: -0.4 });
    [-1, 1].forEach(s => b.part(g.box, m.plastic, [s * (R + 0.02), 0.37, 0], [0.03, 0.025, 0.11]));
    b.mesh(g.box, twinPlateMaterial(`cuve${e.numero}`, `CUVE ${e.numero}`, `${e.capacite} L`, Twin.palette.primary),
        [0, 0.24, R + 0.004], [0.12, 0.06, 0.003], { cast: false });
    // Couvercle posé si la cuve est libre ; relevé contre l'arrière quand une production est planifiée
    if (planned) {
        b.part(g.cuveLid, m.steelShell, [0, 0.608, -0.108], [1, 1, 1], { rx: -1.15 });
        b.part(g.sphere, m.plastic, [0, 0.64, -0.178], [0.025, 0.018, 0.025]);
        twinFlat(b, g.plane, m.ringPlanned, 0, 0.004, 0, 0.66, 0.66);
    } else {
        b.part(g.cuveLid, m.steelShell, [0, 0.423, 0], [1, 1, 1]);
        b.part(g.sphere, m.plastic, [0, 0.497, 0], [0.025, 0.018, 0.025]);
    }
    if (planned && e.couleur) {
        const liquid = b.mesh(g.cyl, twinColorMats(e.couleur).liquid, [0, 0, 0], [1, 1, 1], { cast: false });
        twinAddFill(e.id, [{ mesh: liquid, base: TWIN_LAB.benchH + 0.1, radius: 0.18, maxH: 0.29 }], e.fill);
    } else {
        Twin.prevFill.set(e.id, 0);
    }
    twinRegister(e, b, { hit: { p: [0, 0.27, 0], s: [0.46, 0.56, 0.46] }, top: 0.85, radius: 0.3 });
};

// --- Plaque à induction sur la paillasse + casserole (vapeur quand elle chauffe) ---
const twinBuildInduction = (batch, e, x, z) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const Ht = TWIN_LAB.benchH;
    const b = twinBuilder(batch, Twin.dynamic, x, z, 0, Ht);
    const on = e.status === 'planned';
    b.part(g.box, m.plastic, [0, 0.028, 0], [0.29, 0.056, 0.36]);
    b.part(g.box, m.glassTop, [0, 0.059, -0.03], [0.28, 0.006, 0.28]);
    b.part(g.torus, on ? m.inductionOn : m.inductionOff, [0, 0.063, -0.03], [0.1, 0.1, 0.25], { rx: Math.PI / 2, cast: false });
    b.part(g.box, m.plasticLight, [0, 0.058, 0.145], [0.27, 0.006, 0.05]);
    [-0.07, -0.03, 0.01].forEach(bx => b.part(g.cylLow, m.dark, [bx, 0.063, 0.145], [0.009, 0.004, 0.009], { cast: false }));
    b.part(g.box, on ? m.ledOn : m.ledOff, [0.08, 0.062, 0.145], [0.03, 0.003, 0.008], { cast: false });
    const { r, h } = TWIN_POTS[e.capacite] || TWIN_POTS[9];
    const py = 0.062;
    b.part(g.pot, m.steelShell, [0, py, -0.03], [r, h, r]);
    [-1, 1].forEach(s => {
        b.part(g.box, m.dark, [s * (r + 0.055), py + h - 0.03, -0.03], [0.08, 0.016, 0.026]);
        b.part(g.box, m.steel, [s * (r + 0.012), py + h - 0.03, -0.03], [0.024, 0.02, 0.03]);
    });
    if (on) {
        b.part(g.cyl, m.steel, [0.05, py + h + 0.05, -0.07], [r * 1.04, 0.006, r * 1.04], { rz: 0.45 });
        b.part(g.sphere, m.dark, [0.04, py + h + 0.07, -0.07], [0.016, 0.012, 0.016]);
    } else {
        b.part(g.cyl, m.steel, [0, py + h * 1.03 + 0.004, -0.03], [r * 1.05, 0.006, r * 1.05]);
        b.part(g.sphere, m.dark, [0, py + h * 1.03 + 0.016, -0.03], [0.016, 0.012, 0.016]);
    }
    if (on && e.couleur) {
        const liquid = b.mesh(g.cyl, twinColorMats(e.couleur).liquid, [0, 0, -0.03], [1, 1, 1], { cast: false });
        twinAddFill(e.id, [{ mesh: liquid, base: Ht + py + h * 0.065, radius: r * 0.95, maxH: h * 0.88 }], e.fill);
        twinAddSteam(b.point([0, py + h + 0.01, -0.03]), r * 0.85);
    } else {
        Twin.prevFill.set(e.id, 0);
    }
    // Étiquette sur le chant avant du plan de travail
    const front = TWIN_LAB.benchZ + 0.36 - z;
    b.mesh(g.box, twinPlateMaterial(`plaque${e.numero}`, `PLAQUE ${e.numero}`, `Casserole ${e.capacite} L`, '#2A2A2A'),
        [0, -0.075, front], [0.16, 0.07, 0.003], { cast: false });
    twinRegister(e, b, { hit: { p: [0, (py + h) / 2 + 0.01, -0.01], s: [0.36, py + h + 0.06, 0.4] }, top: py + h + 0.4, radius: 0.24 });
};

// Vapeur : particules douces au-dessus des casseroles qui chauffent (exclues de l'occlusion ambiante)
const twinSteamMaterial = () => twinMat('steam', () => new Twin.lib.THREE.ShaderMaterial({
    uniforms: { map: { value: twinSteamSet().map }, uScale: { value: Twin.steamScale || 700 } },
    vertexShader: `attribute float aSize;
attribute float aAlpha;
uniform float uScale;
varying float vAlpha;
void main() {
	vec4 mv = modelViewMatrix * vec4( position, 1.0 );
	gl_Position = projectionMatrix * mv;
	gl_PointSize = aSize * uScale / -mv.z;
	vAlpha = aAlpha;
}`,
    fragmentShader: `uniform sampler2D map;
varying float vAlpha;
void main() {
	float a = texture2D( map, gl_PointCoord ).a * vAlpha;
	if ( a < 0.004 ) discard;
	gl_FragColor = vec4( vec3( 0.96 ), a );
}`,
    transparent: true,
    depthWrite: false
}));

const twinAddSteam = (origin, radius) => {
    const { THREE } = Twin.lib;
    const n = Twin.quality.steam;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(n), 1));
    const points = new THREE.Points(geo, twinSteamMaterial());
    points.frustumCulled = false;
    points.renderOrder = 2;
    points.userData.twinNoAO = true;
    Twin.dynamic.add(points);
    const rnd = twinRandom(Math.round(Math.abs(origin.x) * 1000 + Math.abs(origin.z) * 37));
    const steam = { points, origin, radius, seeds: Array.from({ length: n }, () => [rnd(), rnd(), rnd() * Math.PI * 2, 0.6 + rnd() * 0.6]) };
    Twin.steam.push(steam);
    twinUpdateSteam(steam, performance.now());
};

const twinUpdateSteam = (s, now) => {
    const attrs = s.points.geometry.attributes;
    const t0 = now / 1000;
    s.seeds.forEach(([phase, off, ang, speed], i) => {
        const t = (t0 * 0.3 * speed + phase) % 1;
        const r = s.radius * (0.25 + off * 0.75) * (1 - t * 0.4);
        const sway = Math.sin(t0 * 1.3 + ang * 3) * 0.035 * t;
        attrs.position.setXYZ(i, s.origin.x + Math.cos(ang) * r + sway + t * 0.05, s.origin.y + t * 0.55, s.origin.z + Math.sin(ang) * r - t * 0.03);
        attrs.aSize.setX(i, 0.07 + t * 0.26);
        attrs.aAlpha.setX(i, Math.pow(Math.sin(Math.PI * t), 1.4) * 0.3);
    });
    attrs.position.needsUpdate = true;
    attrs.aSize.needsUpdate = true;
    attrs.aAlpha.needsUpdate = true;
};

// --- Stock : piles de caisses IFCO noires (4 par couche, ~1,9 m maximum), bouteilles visibles sur le dessus ---
const TWIN_ORDER_SLOTS = 16;
const TWIN_SLOTS_4 = [[-0.3, 0.2], [0.3, 0.2], [-0.3, -0.2], [0.3, -0.2]];

const twinBuildStack = (batch, s, x, z) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const b = twinBuilder(batch, Twin.dynamic, x, z);
    const spec = twinBottleSpec(s.contenanceCl);
    const crateH = Math.round((spec.h + 0.014) * 1000) / 1000;
    const maxLayers = Math.max(3, Math.floor(1.9 / crateH));
    const crates = Math.max(1, Math.min(4 * maxLayers, Math.ceil(s.total / s.crateSize)));
    const layers = Math.ceil(crates / 4);
    const labelMat = twinBottleLabelMaterial(s.arome, s.couleur);
    for (let l = 0; l < layers; l++) {
        const inLayer = l < layers - 1 ? 4 : crates - (layers - 1) * 4;
        const y = l * crateH;
        for (let c = 0; c < inLayer; c++) {
            const [cx, cz] = TWIN_SLOTS_4[c];
            twinCrate(b, cx, y, cz, crateH);
            if (l === layers - 1) {
                const count = c === inLayer - 1 ? s.total - (crates - 1) * s.crateSize : s.crateSize;
                twinCrateBottles(b, cx, y + 0.012, cz, twinClamp(count, 0, s.crateSize), s.crateSize, s.contenanceCl, { color: s.couleur, labelMat });
            }
        }
    }
    const top = (layers - 1) * crateH + 0.012 + spec.h;
    const [lx, lz] = TWIN_SLOTS_4[0];
    b.part(g.box, twinTagMaterial(`stack:${s.id}`, s.arome, s.format, s.couleur), [lx, crateH * 0.45, lz + 0.204], [0.17, 0.106, 0.003], { cast: false });
    const halo = { expired: m.ringDanger, invendable: m.ringDanger, warning: m.ringWarningSoft }[s.status];
    if (halo) twinFlat(b, g.plane, halo, 0, 0.004, 0, 1.75, 1.25);
    twinRegister(s, b, { hit: { p: [0, top / 2, 0], s: [1.2, top, 0.8] }, top: top + 0.3, radius: 0.78 });
};

// --- Expédition : caisses vertes sur chariots (bouteilles visibles si la commande est produite), bon de livraison ---
const TWIN_ORDER_COLUMNS = [[-0.32, 0.22], [0.32, 0.22], [-0.32, -0.22], [0.32, -0.22]];

const twinBuildOrder = (batch, o, x, z) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const b = twinBuilder(batch, Twin.dynamic, x, z);
    const ready = o.statut === 'produite';
    const crates = twinClamp(o.items.reduce((sum, it) => sum + Math.ceil(it.quantite / twinCrateSize(it.contenanceCl || 50)), 0), 1, 20);
    const columns = Math.ceil(crates / 5);
    const heights = [];
    for (let c = 0; c < columns; c++) {
        const [cx, cz] = TWIN_ORDER_COLUMNS[c];
        twinDolly(b, cx, cz, 0);
        const inCol = Math.min(5, crates - c * 5);
        heights.push(0.13 + inCol * 0.24);
        for (let k = 0; k < inCol; k++) {
            const y = 0.13 + k * 0.24;
            twinGreenCrate(b, cx, y, cz, 0);
            const item = o.items[(c * 5 + k) % Math.max(1, o.items.length)];
            if (ready && k === inCol - 1 && item) {
                const cl = item.contenanceCl || 50;
                const size = twinCrateSize(cl);
                const labelMat = twinBottleLabelMaterial(item.arome, item.couleur);
                twinCrateBottles(b, cx, y + 0.016, cz, size, size, cl, { color: item.couleur, labelMat });
            }
        }
    }
    const top = Math.max(...heights);
    const stripe = o.late ? '#C0392B' : o.urgent ? '#C8960A' : ready ? '#5C8A3C' : '#2E72B8';
    const [sx, sz] = TWIN_ORDER_COLUMNS[0];
    b.part(g.box, twinSheetMaterial(`order:${o.commandeId}`, o.numero, o.client, stripe), [sx + 0.02, heights[0] + 0.004, sz], [0.21, 0.004, 0.297], { ry: 0.12, cast: false });
    if (o.late || o.urgent) {
        const k = Math.min(columns - 1, 1);
        const [bx, bz] = TWIN_ORDER_COLUMNS[k];
        b.part(g.cyl, m.plastic, [bx + 0.18, heights[k] + 0.025, bz + 0.1], [0.05, 0.05, 0.05]);
        b.part(g.dome, o.late ? m.beaconDanger : m.beaconWarning, [bx + 0.18, heights[k] + 0.05, bz + 0.1], [0.045, 0.09, 0.045], { cast: false });
        twinFlat(b, g.plane, o.late ? m.ringDanger : m.ringWarning, 0, 0.004, 0, 1.85, 1.4);
    } else if (ready) {
        twinFlat(b, g.plane, m.ringSuccess, 0, 0.004, 0, 1.85, 1.4);
    }
    twinRegister(o, b, { hit: { p: [0, top / 2, 0], s: [1.26, top, 0.86] }, top: top + 0.55, radius: 0.8 });
};

// --- Réserve : étagères inox à clayettes (chambre froide) et rayonnages noirs à tablettes (préparation) ---
const TWIN_SHELF_LEVELS = [0.1, 0.56, 1.02, 1.48];
// Chambre froide : toutes les étagères sont en place (murs ouest, sud, nord, cloison est, îlot central) ;
// préparation : rayonnages montés au fur et à mesure des emballages à ranger
const TWIN_RACKS = {
    cold: [
        { x: -11.72, z: 2.6, ry: Math.PI / 2, type: 'inox' },
        { x: -11.72, z: 4.65, ry: Math.PI / 2, type: 'inox' },
        { x: -10.0, z: 7.72, ry: Math.PI, type: 'inox' },
        { x: -9.95, z: 1.8, ry: 0, type: 'rack' },
        { x: -8.34, z: 4.75, ry: -Math.PI / 2, type: 'inox' },
        { x: -8.34, z: 6.5, ry: -Math.PI / 2, type: 'inox' },
        { x: -10.03, z: 4.7, ry: Math.PI / 2, type: 'inox' }
    ],
    dry: [
        { x: -6.4, z: 1.8, ry: 0, type: 'rack' },
        { x: -2.1, z: 3.0, ry: -Math.PI / 2, type: 'rack' },
        { x: -2.1, z: 5.05, ry: -Math.PI / 2, type: 'rack' },
        { x: -7.67, z: 4.6, ry: Math.PI / 2, type: 'rack' }
    ]
};

const twinBuildRack = (batch, r) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const b = twinBuilder(batch, Twin.dynamic, r.x, r.z, r.ry);
    const L = 1.9;
    const D = 0.5;
    const H = 1.86;
    const inox = r.type === 'inox';
    [-1, 1].forEach(sx => [-1, 1].forEach(sz => {
        b.part(g.box, inox ? m.steel : m.plastic, [sx * (L / 2 - 0.02), H / 2, sz * (D / 2 - 0.02)], [inox ? 0.03 : 0.035, H, inox ? 0.03 : 0.035]);
        b.part(g.box, inox ? m.steelDark : m.rubber, [sx * (L / 2 - 0.02), 0.008, sz * (D / 2 - 0.02)], [0.045, 0.016, 0.045]);
    }));
    TWIN_SHELF_LEVELS.forEach(y => {
        [-1, 1].forEach(sz => b.part(g.box, inox ? m.steel : m.plastic, [0, y - 0.018, sz * (D / 2 - 0.02)], [L, inox ? 0.03 : 0.04, 0.026]));
        if (inox) {
            for (let k = 0; k < 11; k++) b.part(g.box, m.steel, [0, y, -D / 2 + 0.04 + k * ((D - 0.08) / 10)], [L - 0.06, 0.012, 0.014]);
        } else {
            b.part(g.box, m.board, [0, y, 0], [L - 0.02, 0.012, D - 0.02]);
        }
    });
    const c = Math.cos(r.ry);
    const s = Math.sin(r.ry);
    return TWIN_SHELF_LEVELS.flatMap(y => [-0.62, 0, 0.62].map(lx => ({ x: r.x + lx * c, y: y + 0.006, z: r.z - lx * s, ry: r.ry })));
};

// Forme du consommable d'après son nom et son unité (photos de la réserve)
const twinBinKind = (item) => {
    if (item.bouteilleCl) return 'bottles';
    const n = normalizeName(item.nom);
    const family = getUnitFamily(item.unite);
    if (/bouchon|capsule|couvercle/.test(n)) return 'caps';
    if (/etiquette/.test(n)) return 'labels';
    if (/bouteille|flacon/.test(n)) return 'bottles';
    if (family === 'volume') return /^eau/.test(n) ? 'water' : 'jerrycan';
    if (family === 'mass') return /sucre|farine|^sel/.test(n) ? 'sack' : 'container';
    return 'box';
};

const twinContentKind = (nom) => {
    const n = normalizeName(nom);
    if (/hibiscus|rose|petale|coquelicot|mauve|cassis/.test(n)) return 'petals';
    if (/menthe|verveine|herbe|melisse|sauge|thym|romarin|ortie|basilic|citronnelle|alpes/.test(n)) return 'herbs';
    if (/sureau|camomille|fleur|lavande|tilleul|calendula/.test(n)) return 'flowers';
    if (/^the|rooibos|mate|matcha|sencha/.test(n)) return 'tea';
    return 'fruit';
};

const twinContentMaterial = (kind) => twinMat(`content:${kind}`, () =>
    new Twin.lib.THREE.MeshStandardMaterial({ map: twinContentSet(kind).map, roughness: 0.92 }));

// Taille d'une bouteille vide (25 cl, 50 cl ou 1 L) : celle saisie sur l'article, sinon déduite de son nom
const twinEmptyBottleCl = (item) => {
    if (item.bouteilleCl) return item.bouteilleCl <= 30 ? 25 : item.bouteilleCl <= 60 ? 50 : 100;
    const n = normalizeName(item.nom);
    if (/25|33/.test(n)) return 25;
    if (/1 ?l(?![a-z])|100|litre/.test(n)) return 100;
    return 50;
};

const twinBuildBin = (batch, item, slot) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const b = twinBuilder(batch, Twin.dynamic, slot.x, slot.z, slot.ry, slot.y);
    const kind = twinBinKind(item);
    const level = item.quantite > 0 ? item.level : 0;
    const stateColor = TWIN_STATE_COLORS[item.state] || TWIN_STATE_COLORS.unknown;
    if (kind === 'container') {
        // Boîte hermétique transparente à couvercle clipsé : le niveau du contenu suit le stock
        const W = 0.4;
        const D = 0.3;
        const H = 0.26;
        if (level > 0) {
            const fill = Math.max(0.025, 0.225 * level);
            b.part(g.box, twinContentMaterial(twinContentKind(item.nom)), [0, 0.008 + fill / 2, 0], [W - 0.03, fill, D - 0.03]);
        }
        b.part(g.box, m.boxPlastic, [0, H / 2, 0], [W, H, D]);
        b.part(g.box, m.boxLid, [0, H + 0.007, 0], [W + 0.014, 0.014, D + 0.014]);
        b.part(g.box, m.boxPlastic, [0, H + 0.019, 0], [W - 0.02, 0.01, D - 0.02]);
        [-1, 1].forEach(sx => [-1, 1].forEach(sz => b.part(g.box, m.boxClip, [sx * W * 0.27, H - 0.006, sz * (D / 2 + 0.008)], [0.05, 0.034, 0.008])));
        b.part(g.box, m.label, [0, H * 0.6, D / 2 + 0.002], [0.13, 0.05, 0.002], { cast: false });
    } else if (kind === 'sack') {
        const n = level > 0.5 ? 2 : level > 0 ? 1 : 0;
        for (let k = 0; k < n; k++) b.part(g.box, m.sackPaper, [0.02 * k, 0.065 + k * 0.12, 0], [0.5, 0.13, 0.34], { ry: k * 0.06 });
    } else if (kind === 'caps') {
        if (level > 0) b.part(g.box, twinContentMaterial('caps'), [0, 0.012 + 0.07 * level, 0], [0.3, 0.14 * level, 0.22]);
        b.part(g.box, m.kraft, [0, 0.004, 0], [0.32, 0.008, 0.24]);
        [[0, 0.115, 0.32, 0.008], [0, -0.115, 0.32, 0.008]].forEach(([lx, lz, w, t]) => b.part(g.box, m.kraft, [lx, 0.08, lz], [w, 0.16, t]));
        [0.156, -0.156].forEach(lx => b.part(g.box, m.kraft, [lx, 0.08, 0], [0.008, 0.16, 0.23]));
        b.part(g.box, m.kraft, [0, 0.16, 0.16], [0.32, 0.008, 0.1], { rx: 0.6 });
    } else if (kind === 'labels') {
        const n = Math.ceil(level * 4);
        for (let k = 0; k < n; k++) {
            const lx = -0.19 + k * 0.125;
            b.part(g.cyl, m.label, [lx, 0.05, 0], [0.058, 0.1, 0.058]);
            b.part(g.cylLow, m.dark, [lx, 0.051, 0], [0.022, 0.101, 0.022]);
            b.part(g.cyl, m.brand, [lx, 0.0985, 0], [0.059, 0.004, 0.059], { cast: false });
        }
    } else if (kind === 'jerrycan' || kind === 'water') {
        const n = level > 0.5 ? 2 : level > 0 ? 1 : 0;
        for (let k = 0; k < n; k++) {
            const lx = (k - (n - 1) / 2) * 0.24;
            b.part(g.box, kind === 'water' ? m.waterPlastic : m.whitePlastic, [lx, 0.16, 0], [0.2, 0.32, 0.14]);
            b.part(g.box, kind === 'water' ? m.waterPlastic : m.whitePlastic, [lx - 0.03, 0.345, 0], [0.1, 0.04, 0.03]);
            b.part(g.cyl, kind === 'water' ? m.ceeBlue : m.valveRed, [lx + 0.06, 0.34, 0], [0.025, 0.03, 0.025]);
        }
    } else {
        const h = 0.12 + 0.18 * level;
        if (level > 0) b.part(g.box, m.kraft, [0, h / 2, 0], [0.42, h, 0.3]);
        if (level > 0) b.part(g.box, m.kraftTape, [0, h + 0.001, 0], [0.05, 0.003, 0.31], { cast: false });
    }
    // Étiquette de rayon à bande d'état, voyant clignotant si le stock est bas ou critique
    b.part(g.box, m.label, [0, -0.03, 0.262], [0.16, 0.04, 0.003], { cast: false });
    b.part(g.box, m.tint, [0, -0.016, 0.264], [0.16, 0.012, 0.003], { color: stateColor, cast: false });
    if (item.state === 'critical' || item.state === 'low') {
        b.part(g.sphere, item.state === 'critical' ? m.beaconDanger : m.beaconWarning, [0.1, -0.03, 0.266], [0.012, 0.012, 0.012], { cast: false });
    }
    twinRegister(item, b, { hit: { p: [0, 0.2, 0], s: [0.6, 0.42, 0.46] }, top: 0.6, radius: 0.36 });
};

// --- Bouteilles vides : trois palettes au sol de la préparation, une par taille ---
const TWIN_PALLETS = [
    { cl: 25, label: '25 cl', x: -5.95, z: 4.8 },
    { cl: 50, label: '50 cl', x: -4.9, z: 4.8 },
    { cl: 100, label: '1 L', x: -3.85, z: 4.8 }
];

// Flanc d'une couche de bouteilles vides vue à travers le film (une silhouette par bouteille du rang)
const twinBottleRowMaterial = (count) => twinCanvasMaterial(`bottleRow:${count}`, count * 48, 128, (g, w, h) => {
    g.fillStyle = '#A3B4B2';
    g.fillRect(0, 0, w, h);
    const cw = w / count;
    for (let i = 0; i < count; i++) {
        const cx = (i + 0.5) * cw;
        const glass = g.createLinearGradient(cx - cw / 2, 0, cx + cw / 2, 0);
        glass.addColorStop(0, '#8FA3A2');
        glass.addColorStop(0.28, '#F2F7F6');
        glass.addColorStop(0.62, '#D3E0DE');
        glass.addColorStop(1, '#889C9B');
        g.fillStyle = glass;
        g.beginPath();
        TWIN_BOTTLE_PROFILE.forEach(([r, y], k) => g[k ? 'lineTo' : 'moveTo'](cx + r * cw * 0.47, h - y * h));
        [...TWIN_BOTTLE_PROFILE].reverse().forEach(([r, y]) => g.lineTo(cx - r * cw * 0.47, h - y * h));
        g.closePath();
        g.fill();
    }
}, { roughness: 0.3 });

// Dessus de la couche du haut (goulots vus d'en haut)
const twinBottleTopMaterial = (cols, rows) => twinCanvasMaterial(`bottleTop:${cols}x${rows}`, cols * 32, rows * 32, (g) => {
    g.fillStyle = '#A3B4B2';
    g.fillRect(0, 0, cols * 32, rows * 32);
    for (let i = 0; i < cols * rows; i++) {
        const cx = (i % cols + 0.5) * 32;
        const cy = (Math.floor(i / cols) + 0.5) * 32;
        g.fillStyle = '#DCE7E5';
        g.beginPath();
        g.arc(cx, cy, 14.5, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#7F9392';
        g.lineWidth = 2.5;
        g.beginPath();
        g.arc(cx, cy, 8.5, 0, Math.PI * 2);
        g.stroke();
    }
}, { roughness: 0.3 });

// Palette EUR 80 × 120 : couches de bouteilles sous film séparées par des intercalaires carton. Article compté
// en pièces : autant de bouteilles que le stock (couche du haut entamée rang par rang, palette pleine au-delà
// de ~1,8 m) ; autre unité : hauteur selon le niveau par rapport au seuil. Les bouteilles sont dessinées sur les faces des couches (des centaines de bouteilles en verre
// modélisées donnaient un voile blanc) ; plusieurs articles de la même taille se partagent la largeur.
const twinBuildPallet = (batch, pallet, items) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const b = twinBuilder(batch, Twin.dynamic, pallet.x, pallet.z);
    const W = 0.8;
    const L = 1.2;
    const H = 0.144;
    [-0.3275, -0.165, 0, 0.165, 0.3275].forEach((dx, i) => b.part(g.box, m.pallet, [dx, H - 0.011, 0], [i % 2 ? 0.1 : 0.145, 0.022, L]));
    [-0.5275, 0, 0.5275].forEach(dz => {
        b.part(g.box, m.pallet, [0, H - 0.033, dz], [W, 0.022, 0.145]);
        [-0.35, 0, 0.35].forEach(dx => b.part(g.box, m.pallet, [dx, 0.061, dz], [0.1, 0.078, 0.145]));
    });
    [-0.35, 0, 0.35].forEach(dx => b.part(g.box, m.pallet, [dx, 0.011, 0], [0.1, 0.022, L]));
    b.part(g.box, twinTagMaterial(`pallet:${pallet.cl}`, pallet.label, 'Bouteilles vides', '#8DA2B5'), [0, 0.07, L / 2 + 0.002], [0.2, 0.125, 0.003], { cast: false });

    const bs = twinBottleSpec(pallet.cl);
    const pitch = bs.h + 0.006;
    const maxLayers = Math.floor(1.8 / pitch);
    const slice = W / Math.max(1, items.length);
    items.forEach((item, i) => {
        const cx = -W / 2 + slice * (i + 0.5);
        const cols = Math.max(1, Math.floor((slice - 0.02) / bs.d));
        const rows = Math.floor((L - 0.04) / bs.d);
        const bw = cols * bs.d;
        const bl = rows * bs.d;
        const counted = normalizeUnit(item.unite) === 'pcs';
        const pieces = Math.min(Math.round(item.quantite), maxLayers * cols * rows);
        const layers = item.quantite <= 0 ? 0 : counted ? Math.max(1, Math.ceil(pieces / (cols * rows))) : Math.max(1, Math.ceil(item.level * maxLayers));
        for (let k = 0; k < layers; k++) {
            const last = k === layers - 1;
            // Couche du haut entamée : seuls les rangs encore pleins restent, du côté du fond
            const kr = last && counted ? twinClamp(Math.ceil((pieces - k * cols * rows) / cols), 1, rows) : rows;
            const kl = kr * bs.d;
            const kz = -bl / 2 + kl / 2;
            const y = H + k * pitch + 0.005;
            const mid = y + bs.h / 2;
            b.part(g.box, m.kraft, [cx, y - 0.0025, 0], [bw + 0.02, 0.004, bl + 0.02]);
            // Noyau opaque en retrait (ombre portée), habillé des faces dessinées
            b.part(g.box, m.palletCore, [cx, mid - 0.01, kz], [bw - 0.04, bs.h - 0.02, kl - 0.04]);
            [[cols, 0, kl / 2, 0], [cols, 0, -kl / 2, Math.PI], [kr, bw / 2, 0, Math.PI / 2], [kr, -bw / 2, 0, -Math.PI / 2]].forEach(([count, px, pz, ry]) =>
                b.part(g.plane, twinBottleRowMaterial(count), [cx + px, mid, kz + pz], [count * bs.d, bs.h, 1], { ry, cast: false }));
            if (last) b.part(g.plane, twinBottleTopMaterial(cols, kr), [cx, y + bs.h, kz], [bw, kl, 1], { rx: -Math.PI / 2, cast: false });
            b.part(g.box, m.film, [cx, mid, kz], [bw + 0.012, bs.h, kl + 0.012]);
        }
        const top = Math.max(0.3, H + layers * pitch);
        twinRegister(item, b, { hit: { p: [cx, top / 2, 0], s: [slice, top, L] }, top: top + 0.3, radius: 0.75, base: [cx, 0, 0] });
    });
    const state = ['critical', 'empty', 'low'].find(st => items.some(item => item.state === st));
    if (state) twinFlat(b, g.plane, state === 'low' ? m.ringWarningSoft : m.ringDanger, 0, 0.004, 0, 1.5, 1.9);
};

// --- Équipe : mannequins en tenue d'hygiène (1,75 m) à leur poste, tablier à la couleur de l'employé ---
const twinFigureParts = (emit, apron) => {
    const m = twinMaterials();
    const g = twinGeometries();
    [-1, 1].forEach(sx => {
        emit(g.box, m.shoes, [sx * 0.1, 0.045, 0.03], [0.11, 0.09, 0.27]);
        emit(g.capsule, m.trousers, [sx * 0.1, 0.47, 0], [0.15, 0.43, 0.15]);
        emit(g.capsule, m.coat, [sx * 0.21, 1.26, 0.06], [0.095, 0.15, 0.095], { rx: -0.4, rz: sx * 0.08 });
        emit(g.capsule, m.coat, [sx * 0.19, 1.07, 0.27], [0.085, 0.16, 0.085], { rx: -1.25, rz: sx * -0.12 });
        emit(g.sphere, m.gloves, [sx * 0.155, 1.0, 0.44], [0.045, 0.032, 0.062]);
    });
    emit(g.coat, m.coat, [0, 0, 0], [1, 1, 0.62]);
    emit(g.box, m.fabric, [0, 1.04, 0.13], [0.33, 0.56, 0.012], { color: apron });
    emit(g.box, m.fabric, [0, 1.385, 0.108], [0.08, 0.16, 0.01], { color: apron, rx: 0.25 });
    emit(g.cyl, m.skin, [0, 1.535, 0], [0.048, 0.07, 0.048]);
    emit(g.sphere, m.skin, [0, 1.645, 0.008], [0.093, 0.115, 0.104]);
    emit(g.sphere, m.hairnet, [0, 1.672, -0.014], [0.106, 0.09, 0.118]);
};

const twinBuildFigure = (batch, s, x, z, ry) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const b = twinBuilder(batch, Twin.dynamic, x, z, ry);
    twinFigureParts((geo, mat, p, sc, o) => b.part(geo, mat, p, sc, o), s.couleur);
    twinFlat(b, g.plane, m.ringSuccess, 0, 0.004, 0, 0.95, 0.95);
    twinRegister(s, b, { hit: { p: [0, 0.88, 0], s: [0.6, 1.76, 0.5] }, top: 2.0, radius: 0.4 });
};

// Employé absent : sa blouse et son tablier pendent au portant du vestiaire
const TWIN_COAT_HOOKS = 8;
const twinBuildCoat = (batch, s, k) => {
    const m = twinMaterials();
    const g = twinGeometries();
    const b = twinBuilder(batch, Twin.dynamic, -1.32, 2.5 + k * 0.42, Math.PI / 2);
    b.part(g.box, m.chrome, [0, 1.735, 0], [0.4, 0.012, 0.012]);
    b.part(g.cylLow, m.chrome, [0, 1.76, 0], [0.006, 0.04, 0.006]);
    b.part(g.coat, m.coat, [0, 0.19, 0], [0.95, 1, 0.42]);
    [-1, 1].forEach(sx => b.part(g.capsule, m.coat, [sx * 0.205, 1.4, 0], [0.075, 0.2, 0.065], { rz: sx * 0.07 }));
    b.part(g.box, m.fabric, [0, 1.24, 0.09], [0.3, 0.52, 0.01], { color: s.couleur });
    b.part(g.box, m.fabric, [0.1, 1.64, 0.088], [0.07, 0.035, 0.004], { color: s.couleur, cast: false });
    twinRegister(s, b, { hit: { p: [0, 1.25, 0], s: [0.45, 0.95, 0.3] }, top: 1.95, radius: 0.28 });
};

const twinSignature = (item) => {
    switch (item.kind) {
        case 'cuve':
        case 'casserole': return `${item.arome}|${item.litres}`;
        case 'stack': return `${item.total}|${item.sellable}|${item.status}`;
        case 'order': return `${item.statut}|${item.totalBt}|${item.status}`;
        case 'bin': return `${item.quantite}|${item.state}`;
        case 'staff': return `${item.present}`;
        default: return '';
    }
};

const twinClearDynamic = () => {
    Twin.dynamic.traverse(o => {
        if (o.isInstancedMesh) o.dispose();
        if (o.isPoints) o.geometry.dispose();
    });
    Twin.dynamic.clear();
    Twin.proxies.clear();
    Twin.objects.clear();
    Twin.pickables = [];
    Twin.fills = [];
    Twin.steam = [];
};

const twinBuildDynamic = (model) => {
    twinClearDynamic();
    const batch = twinBatch();
    const zone = (id) => TWIN_ZONES.find(z => z.id === id).bounds;

    let cuveIndex = 0;
    let plateIndex = 0;
    model.equipement.forEach(e => {
        if (e.kind === 'cuve' && cuveIndex < 6) twinBuildCuve(batch, e, ...TWIN_LAB.cuve(cuveIndex++));
        else if (e.kind === 'casserole' && plateIndex < 3) twinBuildInduction(batch, e, ...TWIN_LAB.plate(plateIndex++));
    });

    const [sx0, sz0, sx1, sz1] = zone('stock');
    const cols = Math.max(1, model.grid.cols.length);
    const rows = Math.max(1, model.grid.rows.length);
    const stepX = Math.min(1.8, (sx1 - sx0 - 2.0) / cols);
    const stepZ = Math.min(1.25, (sz1 - sz0 - 0.6) / rows);
    const gridX0 = sx0 + 1.8 + stepX / 2;
    const gridZ0 = sz0 + 0.5 + stepZ / 2;
    Twin.stockLayout = { gridX0, gridZ0, stepX, stepZ, rows, cols };
    model.stacks.forEach(s => twinBuildStack(batch, s, gridX0 + s.col * stepX, gridZ0 + s.row * stepZ));

    model.orders.slice(0, TWIN_ORDER_SLOTS).forEach((o, i) => twinBuildOrder(batch, o, 9.4 - (i % 4) * 1.9, 2.65 + Math.floor(i / 4) * 1.4));

    // Réserve : ingrédients en chambre froide, emballages sur les rayonnages de la préparation, bouteilles vides sur palettes
    const ingredient = (bin) => ['mass', 'volume'].includes(getUnitFamily(bin.unite));
    const emptyBottles = model.bins.filter(bin => twinBinKind(bin) === 'bottles');
    const shelved = model.bins.filter(bin => !emptyBottles.includes(bin));
    const coldSlots = TWIN_RACKS.cold.flatMap(rack => twinBuildRack(batch, rack));
    const dryRacks = [...TWIN_RACKS.dry];
    let drySlots = [];
    const drySlot = () => {
        if (!drySlots.length && dryRacks.length) drySlots = twinBuildRack(batch, dryRacks.shift());
        return drySlots.shift();
    };
    shelved.filter(ingredient).forEach(bin => {
        const slot = coldSlots.shift() || drySlot();
        if (slot) twinBuildBin(batch, bin, slot);
    });
    shelved.filter(bin => !ingredient(bin)).forEach(bin => {
        const slot = drySlot() || coldSlots.shift();
        if (slot) twinBuildBin(batch, bin, slot);
    });
    // Bouteilles vides : une palette par taille
    TWIN_PALLETS.forEach(pallet => twinBuildPallet(batch, pallet, emptyBottles.filter(bin => twinEmptyBottleCl(bin) === pallet.cl)));

    // Équipe : présents à leur poste (puis dans le couloir), absents représentés par leur blouse au vestiaire
    let station = 0;
    let overflow = 0;
    let hook = 0;
    model.staff.forEach(s => {
        if (s.present && station < TWIN_STATIONS.length) {
            const st = TWIN_STATIONS[station++];
            twinBuildFigure(batch, s, st.x, st.z, st.ry);
        } else if (s.present && overflow < 6) {
            twinBuildFigure(batch, s, -0.9 + (overflow % 3) * 0.9, -0.25 + Math.floor(overflow / 3) * 0.85, 0);
            overflow++;
        } else if (!s.present && hook < TWIN_COAT_HOOKS) {
            twinBuildCoat(batch, s, hook++);
        }
    });

    twinBatchFlush(batch, Twin.dynamic);
    Twin.proxies.updateMatrixWorld(true);
    Twin.pickables = Twin.proxies.children;

    const nextSignatures = new Map(model.items.map(i => [i.id, twinSignature(i)]));
    if (Twin.signatures.size) {
        nextSignatures.forEach((sig, id) => {
            if (Twin.signatures.get(id) !== sig) twinFlash(id);
        });
    }
    Twin.signatures = nextSignatures;
    const mats = twinMaterials();
    Twin.pulseMats = [mats.ringDanger, mats.ringWarning, mats.beaconDanger, mats.beaconWarning];
    Twin.pulsing = model.items.some(i => ['expired', 'invendable', 'late', 'urgent'].includes(i.status) || i.state === 'critical');
    Twin.glowing = model.equipement.some(e => e.kind === 'casserole' && e.status === 'planned');
    twinShadowsDirty();
};

const twinFlash = (id) => {
    const obj = Twin.objects.get(id);
    if (!obj || twinReducedMotion()) return;
    const { THREE } = Twin.lib;
    const mesh = twinMesh(twinGeometries().ring, new THREE.MeshBasicMaterial({
        color: Twin.palette.info, transparent: true, opacity: 0.9, depthWrite: false
    }), { cast: false });
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(obj.base);
    mesh.position.y += 0.02;
    Twin.markers.add(mesh);
    Twin.flashes.push({ mesh, radius: obj.radius, start: performance.now() });
};

// --- Labels HTML projetés sur la scène ---
const twinAddLabel = (pos, html, cls, { id = null, far = 999, near = 0 } = {}) => {
    const el = document.createElement(id ? 'button' : 'div');
    el.className = `twin-label ${cls}`;
    el.innerHTML = html;
    if (id) {
        el.type = 'button';
        el.tabIndex = -1;
        el.setAttribute('data-click', 'twin-select');
        el.setAttribute('data-id', id);
    }
    Twin.labelsEl.appendChild(el);
    Twin.labels.push({ el, pos, far, near });
};

const twinBuildLabels = (model) => {
    if (!Twin.labelsEl) return;
    const { THREE } = Twin.lib;
    Twin.labelsEl.innerHTML = '';
    Twin.labels = [];
    Twin.labelsKey = '';
    const k = model.kpis;
    const zoneSub = {
        production: k.aProduireL > 0 ? `${twinFmtLitres(k.aProduireL)} · ${k.postesOccupes}/${k.postesTotal} postes${k.enAttente ? ` · +${k.enAttente}` : ''}` : 'Rien à produire',
        stock: `${twinFmtInt(k.stockVendable)} bt vendables`,
        expedition: `${k.commandes} commande${k.commandes > 1 ? 's' : ''}${model.orders.length > TWIN_ORDER_SLOTS ? ` (+${model.orders.length - TWIN_ORDER_SLOTS})` : ''}`,
        magasin: `${k.consoTotal} articles${k.consoCritiques ? ` · ${k.consoCritiques} sous seuil` : ''}`,
        equipe: `${k.presents}/${k.effectif} présents`
    };
    TWIN_ZONES.forEach(zone => {
        const [x0, , , z1] = zone.bounds;
        twinAddLabel(new THREE.Vector3(x0 + 0.2, 0.03, z1 + 0.22),
            `<strong>${escapeHtml(zone.label)}</strong><span>${escapeHtml(zoneSub[zone.id])}</span>`,
            `twin-label--zone twin-label--${zone.id}`, { near: 8 });
    });
    const sl = Twin.stockLayout;
    if (sl) {
        model.grid.rows.forEach((nom, row) => twinAddLabel(
            new THREE.Vector3(sl.gridX0 - sl.stepX / 2 - 0.15, 0.03, sl.gridZ0 + row * sl.stepZ),
            escapeHtml(nom), 'twin-label--tag twin-label--right', { far: 30 }));
        model.grid.cols.forEach((nom, col) => twinAddLabel(
            new THREE.Vector3(sl.gridX0 + col * sl.stepX, 0.03, sl.gridZ0 + (sl.rows - 0.5) * sl.stepZ + 0.2),
            escapeHtml(nom), 'twin-label--tag', { far: 30 }));
    }
    model.items.forEach(item => {
        const obj = Twin.objects.get(item.id);
        if (!obj) return;
        let badge = null;
        if ((item.kind === 'cuve' || item.kind === 'casserole') && item.status === 'planned') badge = [`${twinFmtLitres(item.litres)}`, 'info'];
        else if (item.status === 'expired') badge = ['Expiré', 'danger'];
        else if (item.status === 'invendable') badge = ['Invendable', 'danger'];
        else if (item.status === 'late') badge = ['Retard', 'danger'];
        else if (item.status === 'urgent') badge = [item.days === 0 ? "Auj." : `J-${item.days}`, 'warning'];
        else if (item.kind === 'bin' && item.state === 'critical') badge = ['Seuil', 'danger'];
        else if (item.kind === 'staff') badge = [item.initiales, item.present ? 'success' : 'muted'];
        if (badge) twinAddLabel(obj.top.clone(), escapeHtml(badge[0]), `twin-label--badge twin-badge--${badge[1]}`, { id: item.id, far: item.kind === 'staff' ? 30 : 60 });
    });
    Twin.needsRender = true;
};

const twinUpdateLabels = () => {
    if (!Twin.labelsEl || !Twin.labels.length) return;
    // Caméra et cadre inchangés (animations d'ambiance seules) : aucune écriture dans le DOM
    const key = `${Twin.size?.w}x${Twin.size?.h}|${Twin.camera.matrixWorld.elements}|${Twin.camera.projectionMatrix.elements}|${Twin.controls.target.toArray()}`;
    if (key === Twin.labelsKey) return;
    Twin.labelsKey = key;
    const w = Twin.labelsEl.clientWidth;
    const h = Twin.labelsEl.clientHeight;
    const v = Twin.tmp;
    const camPos = Twin.camera.position;
    const zoom = camPos.distanceTo(Twin.controls.target);
    // En vue rapprochée, masquer les étiquettes lointaines (les labels HTML ne sont pas occultés par la 3D)
    const reach = zoom < 10 ? zoom * 1.8 + 2 : Infinity;
    Twin.labels.forEach(label => {
        v.copy(label.pos).project(Twin.camera);
        const dist = camPos.distanceTo(label.pos);
        const visible = v.z < 1 && v.x > -1.15 && v.x < 1.15 && v.y > -1.15 && v.y < 1.15
            && dist < Math.min(label.far, reach) && zoom >= label.near;
        if (!visible) {
            if (label.el.style.display !== 'none') label.el.style.display = 'none';
            return;
        }
        if (label.el.style.display === 'none') label.el.style.display = '';
        const x = (v.x * 0.5 + 0.5) * w;
        const y = (-v.y * 0.5 + 0.5) * h;
        label.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    });
};

// --- Interaction : sélection, survol, caméra ---
const twinPick = (clientX, clientY) => {
    if (!Twin.renderer || !Twin.pickables.length) return null;
    const rect = Twin.renderer.domElement.getBoundingClientRect();
    Twin.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    Twin.raycaster.setFromCamera(Twin.ndc, Twin.camera);
    const hit = Twin.raycaster.intersectObjects(Twin.pickables, false)[0];
    return hit ? hit.object.userData.twinId : null;
};

const twinUpdateHover = () => {
    Twin.pointerDirty = false;
    const id = Twin.pointer && !Twin.downAt ? twinPick(Twin.pointer.x, Twin.pointer.y) : null;
    const tooltip = Twin.tooltipEl;
    if (id !== Twin.hoveredId) {
        Twin.hoveredId = id;
        Twin.renderer.domElement.style.cursor = id ? 'pointer' : '';
        twinPositionMarkers();
        Twin.needsRender = true;
    }
    if (!tooltip) return;
    const item = id ? Twin.model?.byId.get(id) : null;
    if (!item || !Twin.pointer) {
        tooltip.hidden = true;
        return;
    }
    const html = `<strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.sub)}</span>`;
    if (tooltip.innerHTML !== html) tooltip.innerHTML = html;
    tooltip.hidden = false;
    const rect = Twin.container.getBoundingClientRect();
    tooltip.style.transform = `translate3d(${Math.round(Twin.pointer.x - rect.left + 14)}px, ${Math.round(Twin.pointer.y - rect.top + 16)}px, 0)`;
};

const twinPositionMarkers = () => {
    if (!Twin.selectRing) return;
    const sel = Twin.selectedId ? Twin.objects.get(Twin.selectedId) : null;
    Twin.selectRing.visible = !!sel;
    Twin.pin.visible = !!sel;
    if (sel) {
        Twin.selectRing.position.set(sel.base.x, sel.base.y + 0.02, sel.base.z);
        Twin.selectRing.scale.set(sel.radius * 1.12, sel.radius * 1.12, 1);
        Twin.pin.position.set(sel.top.x, sel.top.y, sel.top.z);
        Twin.pin.scale.setScalar(twinClamp(sel.radius * 1.4, 0.35, 1));
    }
    const hov = Twin.hoveredId && Twin.hoveredId !== Twin.selectedId ? Twin.objects.get(Twin.hoveredId) : null;
    Twin.hoverRing.visible = !!hov;
    if (hov) {
        Twin.hoverRing.position.set(hov.base.x, hov.base.y + 0.02, hov.base.z);
        Twin.hoverRing.scale.set(hov.radius * 1.12, hov.radius * 1.12, 1);
    }
};

const twinClampTarget = () => {
    const t = Twin.controls?.target;
    if (!t) return;
    t.x = twinClamp(t.x, -13, 13);
    t.z = twinClamp(t.z, -9, 9);
    t.y = twinClamp(t.y, 0, 2.5);
};

const twinAspectView = ({ target, pos }) => {
    const aspect = Twin.camera?.aspect || 1.6;
    const k = aspect < 1.5 ? Math.pow(1.5 / aspect, 0.8) : 1;
    return {
        target,
        pos: pos.map((v, i) => target[i] + (v - target[i]) * k)
    };
};

const twinViewForZone = (zoneId) => {
    const zone = TWIN_ZONES.find(z => z.id === zoneId);
    if (!zone) return twinAspectView(TWIN_VIEW_OVERVIEW);
    const [x0, z0, x1, z1] = zone.bounds;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const d = Math.max(x1 - x0, (z1 - z0) * 1.3) * 0.95 + 1.5;
    return twinAspectView({ target: [cx, 0.5, cz], pos: [cx + d * 0.15, d * 0.8, cz + d * 0.92] });
};

const twinViewForObject = (id) => {
    const obj = Twin.objects.get(id);
    if (!obj) return null;
    const s = twinClamp(obj.radius * 1.1, 0.35, 1.0);
    const target = [obj.base.x, (obj.base.y + obj.top.y) / 2 - 0.1, obj.base.z];
    return twinAspectView({ target, pos: [target[0] + 2.2 * s, target[1] + 8 * s, target[2] + 5.6 * s] });
};

const twinFlyTo = (view, duration = 850) => {
    if (!view || !Twin.camera) return;
    const { THREE } = Twin.lib;
    const toPos = new THREE.Vector3(...view.pos);
    const toTarget = new THREE.Vector3(...view.target);
    if (twinReducedMotion() || duration <= 0) {
        Twin.tween = null;
        Twin.camera.position.copy(toPos);
        Twin.controls.target.copy(toTarget);
        Twin.controls.update();
        twinWake();
        return;
    }
    Twin.tween = {
        fromPos: Twin.camera.position.clone(),
        fromTarget: Twin.controls.target.clone(),
        toPos, toTarget,
        start: performance.now(),
        duration
    };
    twinWake();
};

const twinSetActiveZone = (zoneId) => {
    Twin.focusZone = TWIN_ZONES.some(z => z.id === zoneId) ? zoneId : 'overview';
    DB.setFilter('twin_zone', Twin.focusZone);
    document.querySelectorAll('.twin-zone-btn').forEach(btn => {
        const active = btn.getAttribute('data-zone') === Twin.focusZone;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', String(active));
    });
};

const twinFocusZone = (zoneId, { instant = false } = {}) => {
    twinSetActiveZone(zoneId);
    if (Twin.camera) twinFlyTo(twinViewForZone(Twin.focusZone), instant ? 0 : 850);
};

const twinSelect = (id, { fly = false, focusInspector = false } = {}) => {
    const next = id && Twin.model?.byId.has(id) ? id : null;
    Twin.selectedId = next;
    twinPositionMarkers();
    if (next && fly) twinSetActiveZone(Twin.model.byId.get(next).zone);
    if (next && fly && Twin.camera) twinFlyTo(twinViewForObject(next));
    twinRenderInspector({ focus: focusInspector });
    twinRenderPanel();
    twinWake();
};

const twinCycle = (dir) => {
    const model = Twin.model;
    if (!model) return;
    const current = Twin.selectedId ? model.byId.get(Twin.selectedId) : null;
    const zone = current?.zone || (Twin.focusZone !== 'overview' ? Twin.focusZone : 'production');
    const list = model.items.filter(i => i.zone === zone);
    if (!list.length) return;
    const idx = current ? list.findIndex(i => i.id === current.id) : -1;
    const next = list[(idx + dir + list.length) % list.length];
    twinSelect(next.id, { fly: true });
};

// --- Boucle de rendu (à la demande : s'arrête quand rien ne bouge) ---
const twinWake = () => {
    Twin.needsRender = true;
    if (!Twin.raf && !Twin.warming && Twin.container?.isConnected && Twin.renderer) {
        Twin.raf = requestAnimationFrame(twinFrame);
    }
};

// Shaders compilés en arrière-plan (KHR_parallel_shader_compile) avant la première image : sans cela, le
// premier rendu bloque l'interface le temps de toutes les compilations (plusieurs secondes sur téléphone).
// Se résout une fois la première image dessinée ; délai de garde de 5 s.
const twinWarmUp = () => new Promise(resolve => {
    const r = Twin.renderer;
    const pending = r.compile(Twin.scene, Twin.camera);
    const deadline = performance.now() + 5000;
    const poll = () => {
        pending.forEach(mat => {
            const program = r.properties.get(mat).currentProgram;
            if (!program || program.isReady()) pending.delete(mat);
        });
        if (pending.size && performance.now() < deadline) {
            Twin.warming = true;
            setTimeout(poll, 16);
            return;
        }
        Twin.warming = false;
        twinWake();
        requestAnimationFrame(() => resolve());
    };
    poll();
});

const twinEase = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

// Animations d'ambiance (pulsations, lueur des plaques, vapeur, repère de sélection) : figées en Économie
const twinAmbientActive = () => !!Twin.quality?.ambient && !twinReducedMotion()
    && (Twin.pulsing || Twin.glowing || Twin.steam.length > 0 || !!Twin.pin?.visible);

const twinAnimate = (now) => {
    let active = false;
    if (Twin.tween) {
        const tw = Twin.tween;
        const k = Math.min(1, (now - tw.start) / tw.duration);
        const e = twinEase(k);
        Twin.camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
        Twin.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
        Twin.camera.lookAt(Twin.controls.target);
        if (k >= 1) Twin.tween = null;
        active = true;
    }
    if (Twin.fills.length) {
        Twin.fills = Twin.fills.filter(f => {
            const k = Math.min(1, (now - f.start) / 1100);
            twinSetLiquid(f.mesh, f.base, f.radius, Math.max(0.01, (f.from + (f.to - f.from) * twinEase(k)) * f.maxH));
            return k < 1;
        });
        active = true;
    }
    if (Twin.flashes.length) {
        Twin.flashes = Twin.flashes.filter(f => {
            const k = Math.min(1, (now - f.start) / 1400);
            const s = f.radius * (1 + k * 1.6);
            f.mesh.scale.set(s, s, 1);
            f.mesh.material.opacity = 0.9 * (1 - k);
            if (k >= 1) {
                Twin.markers.remove(f.mesh);
                f.mesh.material.dispose();
                return false;
            }
            return true;
        });
        active = true;
    }
    if (twinViewOffsetPending()) {
        const vo = Twin.viewOffset;
        const vt = Twin.viewOffsetTarget;
        const k = twinReducedMotion() ? 1 : 0.2;
        vo.x += (vt.x - vo.x) * k;
        vo.y += (vt.y - vo.y) * k;
        twinApplyViewOffset();
        active = true;
    }
    if (!twinAmbientActive()) return active;
    if (Twin.pulsing) {
        const k = (Math.sin(now / 320) + 1) / 2;
        Twin.pulseMats.forEach(mat => {
            if (mat.emissiveIntensity !== undefined && mat.emissive) mat.emissiveIntensity = 0.3 + 1.1 * k;
            else mat.opacity = 0.35 + 0.6 * k;
        });
        active = true;
    }
    if (Twin.glowing) {
        twinMaterials().inductionOn.emissiveIntensity = 0.75 + 0.35 * Math.sin(now / 700);
        active = true;
    }
    if (Twin.steam.length) {
        Twin.steam.forEach(s => twinUpdateSteam(s, now));
        active = true;
    }
    if (Twin.pin?.visible) {
        Twin.pin.position.y = (Twin.objects.get(Twin.selectedId)?.top.y || 0) + Math.sin(now / 380) * 0.08 * Twin.pin.scale.y;
        active = true;
    }
    return active;
};

// Plan proche proportionnel au recul de la caméra : la précision du tampon de profondeur suit la distance
// (à 0,1 m fixe, les surfaces proches l'une de l'autre scintillaient en vue éloignée)
const twinFitDepth = () => {
    const near = twinClamp(Twin.camera.position.distanceTo(Twin.controls.target) * 0.04, 0.1, 2);
    if (Math.abs(near - Twin.camera.near) < Twin.camera.near * 0.05) return;
    Twin.camera.near = near;
    Twin.camera.updateProjectionMatrix();
};

const twinFrame = (now) => {
    Twin.raf = 0;
    if (!Twin.container || !Twin.container.isConnected) {
        twinSuspend();
        return;
    }
    // Compilation en cours : twinWarmUp relancera la boucle
    if (Twin.warming) return;
    const moved = Twin.tween ? false : Twin.controls.update();
    const smooth = moved || twinViewOffsetPending() || !!(Twin.tween || Twin.fills.length || Twin.flashes.length || Twin.controls.autoRotate);
    twinMonitorPerf(now, smooth);
    // Image inchangée hors animations d'ambiance : celles-ci sont cadencées par la qualité, sinon la boucle s'arrête
    if (!smooth && !Twin.needsRender && !Twin.pointerDirty) {
        if (!twinAmbientActive()) return;
        if (now - (Twin.lastFrame || 0) < 1000 / Twin.quality.ambient) {
            if (!Twin.raf) Twin.raf = requestAnimationFrame(twinFrame);
            return;
        }
    }
    const active = twinAnimate(now) || smooth;
    if (Twin.pointerDirty) twinUpdateHover();
    Twin.lastFrame = now;
    twinUpdateCutaways();
    twinFitDepth();
    twinRender();
    twinUpdateLabels();
    Twin.needsRender = false;
    // controls.update() a pu déjà replanifier l'image suivante (événement « change » → twinWake) :
    // en demander une seconde doublerait les rendus à chaque image tant que la caméra glisse
    if (active && !Twin.raf) Twin.raf = requestAnimationFrame(twinFrame);
};

// Qualité Auto : si les mouvements de caméra restent saccadés (plus de 60 % des images sous ~24 i/s sur 1,5 s
// de mouvement, cumulées d'un geste à l'autre), on descend d'un niveau, puis on réduit la définition en Économie.
// Les à-coups isolés (compilation des shaders, ombres recalculées) ne suffisent pas à déclencher la baisse.
const twinMonitorPerf = (now, smooth) => {
    const perf = Twin.perf;
    const dt = now - perf.last;
    const chained = smooth && perf.smooth;
    perf.last = now;
    perf.smooth = smooth;
    if (!chained || dt > 1000 || Twin.quality?.setting !== 'auto') return;
    perf.time += dt;
    perf.frames++;
    if (dt > 42) perf.slow++;
    if (perf.time < 1500 || perf.frames < 8) return;
    const choppy = perf.slow / perf.frames > 0.6;
    Object.assign(perf, { time: 0, frames: 0, slow: 0 });
    if (choppy) twinStepDown();
};

const twinStepDown = () => {
    const lower = TWIN_QUALITY_ORDER[TWIN_QUALITY_ORDER.indexOf(Twin.quality.level) - 1];
    if (lower) {
        Twin.autoQuality = lower;
        showToast(`Qualité 3D réduite (${TWIN_QUALITY_LEVELS[lower].label}) pour rester fluide`, 'warning');
        setTimeout(twinApplyQuality, 0);
    } else if (Twin.renderer.getPixelRatio() > 1) {
        Twin.dprCap = 1;
        twinRefreshPixelRatio();
        showToast('Définition 3D réduite pour rester fluide', 'warning');
    }
};

const twinSuspend = () => {
    if (Twin.raf) cancelAnimationFrame(Twin.raf);
    Twin.raf = 0;
    Twin.perf.smooth = false;
    Twin.resizeObserver?.disconnect();
    Twin.container = null;
    Twin.labelsEl = null;
    Twin.tooltipEl = null;
    Twin.hoveredId = null;
    Twin.tween = null;
    if (Twin.controls) Twin.controls.autoRotate = false;
};

const twinResize = () => {
    const stage = Twin.container?.querySelector('.twin-stage');
    if (!stage || !Twin.renderer) return;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    Twin.size = { w, h };
    Twin.renderer.setSize(w, h, false);
    if (Twin.composer) {
        Twin.composer.setPixelRatio(Twin.renderer.getPixelRatio());
        Twin.composer.setSize(w, h);
    }
    Twin.camera.aspect = w / h;
    // Taille apparente des particules de vapeur : pixels du tampon de rendu par mètre, à 1 m
    Twin.steamScale = h * Twin.renderer.getPixelRatio() / (2 * Math.tan(Twin.camera.fov * Math.PI / 360));
    if (Twin.mats.steam) Twin.mats.steam.uniforms.uScale.value = Twin.steamScale;
    twinRefreshViewOffset({ instant: true });
    twinWake();
};

// Recentre la projection sur la zone libre (entre panneau, inspecteur et indicateurs)
const twinViewOffsetPending = () => Math.abs(Twin.viewOffset.x - Twin.viewOffsetTarget.x) > 0.5
    || Math.abs(Twin.viewOffset.y - Twin.viewOffsetTarget.y) > 0.5;

const twinApplyViewOffset = () => {
    const { w, h } = Twin.size || {};
    if (!w || !h || !Twin.camera) return;
    Twin.camera.setViewOffset(w, h, Twin.viewOffset.x, Twin.viewOffset.y, w, h);
};

const twinRefreshViewOffset = ({ instant = false } = {}) => {
    const root = Twin.container;
    if (!root || !Twin.camera) return;
    const box = root.getBoundingClientRect();
    const mobile = !!window.matchMedia?.('(max-width: 768px)').matches;
    const panel = root.querySelector('.twin-panel');
    const insp = root.querySelector('.twin-inspector');
    const kpis = root.querySelector('.twin-kpis');
    const toolbar = root.querySelector('.twin-toolbar');
    let left = 0;
    let right = 0;
    let top = toolbar ? toolbar.getBoundingClientRect().bottom - box.top : 0;
    let bottom = kpis ? box.bottom - kpis.getBoundingClientRect().top : 0;
    if (!mobile && panel && panel.offsetParent !== null) left = panel.getBoundingClientRect().right - box.left;
    if (insp && !insp.hidden) {
        if (mobile) bottom = Math.max(bottom, box.bottom - insp.getBoundingClientRect().top);
        else right = box.right - insp.getBoundingClientRect().left;
    }
    top = Math.max(0, top);
    Twin.viewOffsetTarget = { x: Math.round((right - left) / 2), y: Math.round((bottom - top) / 2) };
    if (instant) {
        Twin.viewOffset = { ...Twin.viewOffsetTarget };
        twinApplyViewOffset();
    }
    twinWake();
};

const twinMount = (root) => {
    if (!Twin.renderer) twinInitEngine();
    Twin.container = root;
    twinSyncLiteClass();
    Twin.labelsEl = root.querySelector('.twin-labels');
    Twin.tooltipEl = root.querySelector('.twin-tooltip');
    root.querySelector('.twin-stage').appendChild(Twin.renderer.domElement);
    Twin.resizeObserver = Twin.resizeObserver || new ResizeObserver(() => twinResize());
    Twin.resizeObserver.observe(root.querySelector('.twin-stage'));
    Twin.controls.autoRotate = false;
    twinResize();
    if (!Twin.viewInitialized) {
        Twin.viewInitialized = true;
        twinFocusZone(DB.getFilter('twin_zone') || 'overview', { instant: true });
    } else {
        twinFocusZone(Twin.focusZone, { instant: true });
    }
    twinWake();
};

const twinApplyModel = (model) => {
    Twin.model = model;
    if (!Twin.renderer || !Twin.container) return;
    twinBuildDynamic(model);
    twinBuildLabels(model);
    if (Twin.selectedId && !model.byId.has(Twin.selectedId)) Twin.selectedId = null;
    if (Twin.hoveredId && !model.byId.has(Twin.hoveredId)) Twin.hoveredId = null;
    twinPositionMarkers();
    twinWake();
};

// --- Interface (HUD) ---
const TWIN_ICONS = {
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/></svg>',
    rotate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>',
    full: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',
    reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 3 3 9 9 9"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>',
    target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><line x1="12" y1="1" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="23"/><line x1="1" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="23" y2="12"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    quality: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M10 3.5l1.7 4.3 4.3 1.7-4.3 1.7L10 15.5l-1.7-4.3L4 9.5l4.3-1.7z"/><path d="M18 14l.9 2.1 2.1.9-2.1.9L18 20l-.9-2.1-2.1-.9 2.1-.9z"/></svg>'
};

const twinLiveStatus = () => {
    if (!navigator.onLine) return { cls: 'offline', label: 'Hors ligne' };
    if (V11._isReady && Object.keys(V11._listeners || {}).length > 0) return { cls: 'live', label: 'En direct' };
    return { cls: 'local', label: 'Local' };
};

const twinShellHtml = () => {
    const fullscreen = !!document.fullscreenEnabled;
    const panelClosed = DB.getFilter('twin_panel') === 'closed';
    const panelExpanded = !twinCompactLayout() && !panelClosed;
    return `
        <section class="twin ${panelClosed ? 'is-panel-closed' : ''}" id="twinRoot" aria-label="Atelier en 3D">
            <div class="twin-stage" id="twinStage">
                <div class="twin-loading" id="twinLoading"><span class="spinner" aria-hidden="true"></span>Construction de l'atelier 3D…</div>
            </div>
            <div class="twin-labels" aria-hidden="true"></div>
            <div class="twin-tooltip" role="tooltip" hidden></div>
            <div class="twin-toolbar">
                <div class="twin-zones" role="toolbar" aria-label="Zones de l'atelier">
                    <button type="button" class="twin-zone-btn" data-click="twin-zone" data-zone="overview" aria-pressed="false"><kbd>0</kbd>Vue d'ensemble</button>
                    ${TWIN_ZONES.map(z => `<button type="button" class="twin-zone-btn" data-click="twin-zone" data-zone="${z.id}" aria-pressed="false"><span class="twin-zone-dot twin-zone-dot--${z.id}"></span><kbd>${z.key}</kbd>${escapeHtml(z.label)}</button>`).join('')}
                </div>
                <div class="twin-tools">
                    <span class="twin-live" id="twinLive"></span>
                    <button type="button" class="twin-icon-btn twin-panel-toggle" data-click="twin-toggle-panel" aria-controls="twinPanel" aria-expanded="${panelExpanded}" title="Liste et alertes">${TWIN_ICONS.list}</button>
                    <button type="button" class="twin-icon-btn" data-click="twin-zone" data-zone="overview" title="Réinitialiser la vue (R)">${TWIN_ICONS.reset}</button>
                    <button type="button" class="twin-icon-btn" data-click="twin-autorotate" aria-pressed="false" title="Rotation automatique">${TWIN_ICONS.rotate}</button>
                    <div class="twin-quality">
                        <button type="button" class="twin-icon-btn" data-click="twin-quality-menu" aria-haspopup="menu" aria-expanded="false" aria-controls="twinQualityMenu" title="Qualité du rendu 3D">${TWIN_ICONS.quality}</button>
                        <div class="twin-quality-menu" id="twinQualityMenu" role="menu" aria-label="Qualité du rendu 3D" hidden></div>
                    </div>
                    ${fullscreen ? `<button type="button" class="twin-icon-btn" data-click="twin-fullscreen" title="Plein écran (F)">${TWIN_ICONS.full}</button>` : ''}
                </div>
            </div>
            <aside class="twin-panel" id="twinPanel" aria-label="Alertes et objets de l'atelier"></aside>
            <aside class="twin-inspector" id="twinInspector" aria-label="Détails de l'objet sélectionné" hidden></aside>
            <div class="twin-kpis" id="twinKpis"></div>
        </section>`;
};

const twinRenderKpis = (model) => {
    const el = document.getElementById('twinKpis');
    if (!el) return;
    const k = model.kpis;
    const cards = [
        { zone: 'production', label: 'À produire', value: twinFmtLitres(k.aProduireL), sub: k.aProduireBt ? `${twinFmtInt(k.aProduireBt)} bt · ${k.postesOccupes}/${k.postesTotal} postes${k.enAttente ? ` · ${k.enAttente} en attente` : ''}` : 'Stock suffisant', state: k.aProduireL > 0 ? 'warning' : 'ok' },
        { zone: 'stock', label: 'Stock vendable', value: `${twinFmtInt(k.stockVendable)} bt`, sub: k.lotsExpires ? `${k.lotsExpires} lot${k.lotsExpires > 1 ? 's' : ''} expiré${k.lotsExpires > 1 ? 's' : ''}` : k.lotsInvendables ? `${k.lotsInvendables} invendable${k.lotsInvendables > 1 ? 's' : ''} (DLV)` : k.lotsWarning ? `${k.lotsWarning} DLV proche${k.lotsWarning > 1 ? 's' : ''}` : 'DLV/DLC en ordre', state: (k.lotsExpires || k.lotsInvendables) ? 'danger' : k.lotsWarning ? 'warning' : 'ok' },
        { zone: 'expedition', label: 'Commandes', value: twinFmtInt(k.commandes), sub: k.enRetard ? `${k.enRetard} en retard` : k.urgentes ? `${k.urgentes} urgente${k.urgentes > 1 ? 's' : ''}` : `${k.pretes} prête${k.pretes > 1 ? 's' : ''} à livrer`, state: k.enRetard ? 'danger' : k.urgentes ? 'warning' : 'ok' },
        { zone: 'magasin', label: 'Consommables', value: k.consoCritiques ? `${k.consoCritiques} sous seuil` : 'OK', sub: k.consoBas ? `${k.consoBas} bientôt épuisé${k.consoBas > 1 ? 's' : ''}` : `${k.consoTotal} articles suivis`, state: k.consoCritiques ? 'danger' : k.consoBas ? 'warning' : 'ok' },
        { zone: 'equipe', label: 'Équipe', value: `${k.presents}/${k.effectif}`, sub: 'présents aujourd\'hui', state: 'neutral' }
    ];
    el.innerHTML = cards.map(c => `
        <button type="button" class="twin-kpi twin-kpi--${c.state}" data-click="twin-zone" data-zone="${c.zone}">
            <span class="twin-kpi-label"><span class="twin-zone-dot twin-zone-dot--${c.zone}"></span>${escapeHtml(c.label)}</span>
            <span class="twin-kpi-value">${escapeHtml(c.value)}</span>
            <span class="twin-kpi-sub">${escapeHtml(c.sub)}</span>
        </button>`).join('');
};

const twinRenderLive = (model) => {
    const el = document.getElementById('twinLive');
    if (!el) return;
    const status = twinLiveStatus();
    el.className = `twin-live twin-live--${status.cls}`;
    el.textContent = `${status.label} · ${model.builtAt.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
};

const twinRenderPanel = () => {
    const el = document.getElementById('twinPanel');
    const model = Twin.model;
    if (!el || !model) return;
    const tab = DB.getFilter('twin_tab') || 'alertes';
    const scroll = el.querySelector('.twin-panel-body')?.scrollTop || 0;
    const alertsHtml = model.alerts.length === 0
        ? '<p class="twin-empty">Aucune alerte — l\'atelier est en ordre ✓</p>'
        : model.alerts.map(a => `
            <button type="button" class="twin-alert twin-alert--${a.level} ${a.id === Twin.selectedId ? 'is-selected' : ''}" data-click="twin-select" data-id="${escapeHtml(a.id)}" data-fly="1">
                <span class="twin-alert-dot" aria-hidden="true"></span>
                <span class="twin-alert-text"><strong>${escapeHtml(a.title)}</strong><small>${escapeHtml(a.text)}</small></span>
            </button>`).join('');
    const objectsHtml = TWIN_ZONES.map(zone => {
        const list = model.items.filter(i => i.zone === zone.id);
        return `
            <div class="twin-group">
                <h4 class="twin-group-title"><span class="twin-zone-dot twin-zone-dot--${zone.id}"></span>${escapeHtml(zone.label)}<small>${list.length}</small></h4>
                ${list.length === 0 ? '<p class="twin-empty twin-empty--sm">Vide</p>' : list.map(i => `
                    <button type="button" class="twin-item twin-item--${escapeHtml(i.status || i.state || '')} ${i.id === Twin.selectedId ? 'is-selected' : ''}" data-click="twin-select" data-id="${escapeHtml(i.id)}" data-fly="1" aria-current="${i.id === Twin.selectedId}">
                        <span class="twin-item-swatch" style="background:${safeColor(i.couleur || '')}"></span>
                        <span class="twin-item-label">${escapeHtml(i.label)}</span>
                        <span class="twin-item-meta">${escapeHtml(i.sub)}</span>
                    </button>`).join('')}
            </div>`;
    }).join('');
    el.innerHTML = `
        <div class="twin-tabs" role="tablist" aria-label="Contenu du panneau">
            <button type="button" role="tab" class="twin-tab" aria-selected="${tab === 'alertes'}" data-click="twin-tab" data-tab="alertes">Alertes${model.alerts.length ? ` <span class="twin-count">${model.alerts.length}</span>` : ''}</button>
            <button type="button" role="tab" class="twin-tab" aria-selected="${tab === 'objets'}" data-click="twin-tab" data-tab="objets">Objets <span class="twin-count twin-count--muted">${model.items.length}</span></button>
        </div>
        <div class="twin-panel-body" role="tabpanel">${tab === 'objets' ? objectsHtml : alertsHtml}</div>`;
    const body = el.querySelector('.twin-panel-body');
    if (body) body.scrollTop = scroll;
};

const twinStatusChip = (item) => {
    const map = {
        expired: ['Lots expirés', 'danger'], invendable: ['Lots invendables (DLV)', 'danger'], warning: ['DLV proche', 'warning'], ok: ['En ordre', 'success'],
        late: ['En retard', 'danger'], urgent: ['Urgente', 'warning'], ready: ['Prête à livrer', 'success'], waiting: ['En attente', 'info'],
        planned: ['Planifiée', 'info'], idle: ['Libre', 'default'],
        critical: ['Sous le seuil', 'danger'], low: ['Bientôt épuisé', 'warning'], unknown: ['Sans seuil', 'default'], empty: ['Épuisé', 'danger'],
        present: ['Présent', 'success'], absent: ['Absent', 'default']
    };
    const [label, cls] = map[item.status || item.state] || ['—', 'default'];
    return `<span class="badge badge-${cls}">${escapeHtml(label)}</span>`;
};

const twinInspectorBody = (item) => {
    if (item.kind === 'cuve' || item.kind === 'casserole') {
        const prod = Twin.model?.production;
        const pa = prod?.aromes.find(p => p.arome === item.arome);
        const planned = item.status === 'planned';
        return `
            <div class="twin-insp-hero">
                <div class="twin-gauge" aria-hidden="true"><div class="twin-gauge-fill" style="height:${Math.round(item.fill * 100)}%; background:${safeColor(item.couleur)}"></div></div>
                <div>
                    <div class="twin-insp-big">${planned ? `${escapeHtml(twinFmtLitres(item.litres))} <small>/ ${item.capacite} L</small>` : 'Libre'}</div>
                    <div class="twin-insp-sub">${planned ? `${escapeHtml(item.arome)} · ${Math.round(item.fill * 100)} % de la capacité` : (item.kind === 'cuve' ? 'Cuve vide, couvercle fermé' : 'Plaque à induction éteinte')}</div>
                </div>
            </div>
            ${planned && item.ingredients.length ? `<h4 class="twin-insp-h">Ingrédients pour ce contenant</h4>
                <ul class="twin-rows twin-rows--compact">${item.ingredients.map(i => `<li><span>${escapeHtml(i.nom)}</span><strong>${escapeHtml(String(i.quantite))} ${escapeHtml(displayUnit(i.unite))}</strong></li>`).join('')}</ul>` : ''}
            ${planned && !item.hasRecette ? '<p class="twin-note">Aucune recette définie pour cet arôme (Paramètres › Recettes).</p>' : ''}
            ${pa ? `<h4 class="twin-insp-h">${escapeHtml(pa.arome)} · ${escapeHtml(twinFmtLitres(pa.litres))} au total</h4>
                <ul class="twin-rows">${pa.besoins.map(b => `<li><span>${escapeHtml(b.format)}</span><strong>${twinFmtInt(b.bouteilles)} bt</strong></li>`).join('')}</ul>
                <h4 class="twin-insp-h">Répartition</h4>
                <ul class="twin-rows twin-rows--compact">${pa.recipients.map(r => `<li><span>${escapeHtml(r.poste || `Fournée ${r.fournee}`)}</span><strong>${escapeHtml(twinFmtLitres(r.litres))} / ${r.capacite} L</strong></li>`).join('')}</ul>` : ''}
            ${prod?.enAttente.length ? `<h4 class="twin-insp-h">Prochaine fournée (${prod.enAttente.length})</h4>
                <ul class="twin-rows twin-rows--compact">${prod.enAttente.map(r => `<li><span><span class="twin-item-swatch" style="background:${safeColor(r.couleur)}"></span>${escapeHtml(r.arome)} · F${r.fournee} ${r.type === 'cuve' ? 'cuve' : 'casserole'} ${r.capacite} L</span><strong>${escapeHtml(twinFmtLitres(r.litres))}</strong></li>`).join('')}</ul>` : ''}
            ${!planned && !prod?.aromes.length ? '<p class="twin-empty">Aucune production requise : le stock couvre les commandes actives.</p>' : ''}
            <div class="twin-insp-actions">
                <a href="#production" class="btn btn-primary btn-sm">Planifier la production</a>
                ${item.arome ? `<button type="button" class="btn btn-secondary btn-sm" data-click="twin-goto-stock" data-arome="${escapeHtml(item.arome)}">Voir le stock</button>` : ''}
            </div>`;
    }
    if (item.kind === 'stack') {
        return `
            <div class="twin-insp-stats">
                <div><span class="twin-stat-val">${twinFmtInt(item.sellable)}</span><span class="twin-stat-lbl">vendables</span></div>
                <div><span class="twin-stat-val">${twinFmtInt(item.total)}</span><span class="twin-stat-lbl">en stock</span></div>
                <div><span class="twin-stat-val">${twinFmtInt(item.demande)}</span><span class="twin-stat-lbl">commandées</span></div>
            </div>
            <h4 class="twin-insp-h">Lots (${item.lots.length})</h4>
            ${item.lots.length === 0 ? '<p class="twin-empty">Aucun lot en stock.</p>' : `
            <ul class="twin-lots">${item.lots.map(l => `
                <li class="twin-lot">
                    <div class="twin-lot-main">
                        <strong>Lot ${escapeHtml(l.numero)}</strong>
                        <span>${twinFmtInt(l.quantite)} bt${l.dlv ? ` · DLV ${escapeHtml(formatDate(l.dlv))}` : ''} · DLC ${l.dlc ? escapeHtml(formatDate(l.dlc)) : '—'}</span>
                    </div>
                    ${l.bloque ? '<span class="badge badge-danger">Bloqué</span>' : ''}
                    <span class="badge badge-${l.status === 'expired' || l.status === 'invendable' ? 'danger' : l.status === 'warning' ? 'warning' : 'success'}">${escapeHtml(getLotStatusLabel(l.status, l))}</span>
                    ${lotShelfLifeHtml(l)}
                    <div class="twin-lot-actions">
                        <button type="button" class="btn btn-sm btn-primary" data-click="sell-lot" data-id="${escapeHtml(l.id)}" title="Vente directe, dégustation, casse ou destruction">Sortie</button>
                        <button type="button" class="btn btn-sm btn-secondary" data-click="edit-lot" data-id="${escapeHtml(l.id)}">Modifier</button>
                        <button type="button" class="btn btn-sm btn-secondary" data-click="show-lot-trace" data-id="${escapeHtml(l.id)}">Traçabilité</button>
                    </div>
                </li>`).join('')}
            </ul>`}
            <div class="twin-insp-actions">
                <button type="button" class="btn btn-secondary btn-sm" data-click="twin-goto-stock" data-arome="${escapeHtml(item.arome)}" data-format="${escapeHtml(item.format)}">Ouvrir dans Stock</button>
            </div>`;
    }
    if (item.kind === 'order') {
        return `
            <div class="twin-insp-meta">${escapeHtml(item.client)}</div>
            <div class="twin-insp-stats">
                <div><span class="twin-stat-val">${item.dateLivraison ? escapeHtml(formatDate(item.dateLivraison)) : '—'}</span><span class="twin-stat-lbl">${escapeHtml(twinRelativeDay(item.days))}</span></div>
                <div><span class="twin-stat-val">${twinFmtInt(item.totalBt)}</span><span class="twin-stat-lbl">bouteilles</span></div>
                ${item.montant !== null ? `<div><span class="twin-stat-val">${escapeHtml(formatChf(item.montant))}</span><span class="twin-stat-lbl">montant</span></div>` : ''}
            </div>
            ${renderStepTracker(item.statut)}
            <h4 class="twin-insp-h">Articles</h4>
            <ul class="twin-rows">${item.items.map(i => `<li><span><span class="twin-item-swatch" style="background:${safeColor(i.couleur)}"></span>${escapeHtml(i.arome)} · ${escapeHtml(i.format)}</span><strong>${twinFmtInt(i.quantite)}</strong></li>`).join('')}</ul>
            <div class="twin-insp-actions">
                ${item.statut === 'en_attente' ? `<button type="button" class="btn btn-primary btn-sm" data-click="marquer-commande-produite" data-id="${escapeHtml(item.commandeId)}">Marquer produite</button>` : ''}
                ${item.statut === 'produite' ? `<button type="button" class="btn btn-primary btn-sm" data-click="livrer-commande" data-id="${escapeHtml(item.commandeId)}">Livrer</button>` : ''}
                <button type="button" class="btn btn-secondary btn-sm" data-click="show-commande-details" data-id="${escapeHtml(item.commandeId)}">Détails</button>
                <button type="button" class="btn btn-secondary btn-sm" data-click="edit-commande" data-id="${escapeHtml(item.commandeId)}">Modifier</button>
            </div>`;
    }
    if (item.kind === 'bin') {
        const unit = escapeHtml(displayUnit(item.unite));
        return `
            <div class="twin-insp-hero">
                <div class="twin-gauge" aria-hidden="true"><div class="twin-gauge-fill twin-gauge-fill--${escapeHtml(item.state)}" style="height:${Math.round(item.level * 100)}%"></div></div>
                <div>
                    <div class="twin-insp-big">${escapeHtml(String(item.quantite))} <small>${unit}</small></div>
                    <div class="twin-insp-sub">${item.seuil > 0 ? `Seuil d'alerte : ${escapeHtml(String(item.seuil))} ${unit}` : 'Aucun seuil défini'}</div>
                </div>
            </div>
            <div class="twin-stepper" role="group" aria-label="Ajuster la quantité">
                ${[-10, -1, 1, 10].map(d => `<button type="button" class="btn btn-secondary btn-sm" data-click="update-inventaire-qty" data-id="${escapeHtml(item.itemId)}" data-delta="${d}" aria-label="${d > 0 ? 'Ajouter' : 'Retirer'} ${Math.abs(d)}">${d > 0 ? '+' : '−'}${Math.abs(d)}</button>`).join('')}
            </div>
            <div class="twin-insp-actions">
                <button type="button" class="btn btn-secondary btn-sm" data-click="show-inventaire-modal" data-type="consommable" data-id="${escapeHtml(item.itemId)}">Modifier l'article</button>
                <a href="#inventaire" class="btn btn-secondary btn-sm">Inventaire complet</a>
            </div>`;
    }
    if (item.kind === 'staff') {
        return `
            <div class="twin-insp-hero">
                <div class="twin-avatar" style="background:${item.present ? safeColor(item.couleur) : 'var(--text-lighter)'}">${escapeHtml(item.initiales)}</div>
                <div>
                    <div class="twin-insp-big">${item.present ? 'Présent' : 'Absent'}</div>
                    <div class="twin-insp-sub">${item.present ? `Arrivé à ${escapeHtml(item.since)} · ` : ''}${escapeHtml(twinFmtDuration(item.minutes))} aujourd'hui</div>
                </div>
            </div>
            <div class="twin-insp-actions">
                ${item.present
                    ? `<button type="button" class="btn btn-depart btn-sm" data-click="twin-clock-out" data-id="${escapeHtml(item.employeId)}">Pointer le départ</button>`
                    : `<button type="button" class="btn btn-arrivee btn-sm" data-click="twin-clock-in" data-id="${escapeHtml(item.employeId)}">Pointer l'arrivée</button>`}
                <a href="#pointage" class="btn btn-secondary btn-sm">Ouvrir le pointage</a>
            </div>`;
    }
    return '';
};

const twinRenderInspector = ({ focus = false } = {}) => {
    const el = document.getElementById('twinInspector');
    const root = document.getElementById('twinRoot');
    if (!el || !root) return;
    const model = Twin.model;
    const item = Twin.selectedId && model ? model.byId.get(Twin.selectedId) : null;
    if (!item) {
        el.hidden = true;
        el.innerHTML = '';
        root.classList.remove('has-inspector');
        twinRefreshViewOffset();
        return;
    }
    const zone = TWIN_ZONES.find(z => z.id === item.zone);
    const siblings = model.items.filter(i => i.zone === item.zone);
    const pos = siblings.findIndex(i => i.id === item.id) + 1;
    const active = el.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = active ? ['data-click', 'data-id', 'data-delta', 'data-dir']
        .map(a => active.hasAttribute(a) ? `[${a}="${CSS.escape(active.getAttribute(a))}"]` : '').join('') : '';
    const sameItem = el.dataset.itemId === item.id;
    const scroll = sameItem ? el.scrollTop : 0;
    el.dataset.itemId = item.id;
    el.hidden = false;
    root.classList.add('has-inspector');
    el.innerHTML = `
        <div class="twin-insp-head">
            <div class="twin-insp-kicker"><span class="twin-zone-dot twin-zone-dot--${zone.id}"></span>${escapeHtml(zone.label)} · ${pos}/${siblings.length}</div>
            <div class="twin-insp-nav">
                <button type="button" class="twin-icon-btn" data-click="twin-cycle" data-dir="-1" aria-label="Objet précédent" title="Précédent (←)">${TWIN_ICONS.prev}</button>
                <button type="button" class="twin-icon-btn" data-click="twin-cycle" data-dir="1" aria-label="Objet suivant" title="Suivant (→)">${TWIN_ICONS.next}</button>
                <button type="button" class="twin-icon-btn" data-click="twin-center" aria-label="Centrer la vue sur l'objet" title="Centrer">${TWIN_ICONS.target}</button>
                <button type="button" class="twin-icon-btn" data-click="twin-close-inspector" aria-label="Fermer le panneau" title="Fermer (Échap)">${TWIN_ICONS.close}</button>
            </div>
            <h3 class="twin-insp-title" tabindex="-1">${escapeHtml(item.label)}</h3>
            ${twinStatusChip(item)}
        </div>
        <div class="twin-insp-body">${twinInspectorBody(item)}</div>`;
    el.scrollTop = scroll;
    if (focus) el.querySelector('.twin-insp-title')?.focus({ preventScroll: true });
    else if (focusKey) el.querySelector(focusKey)?.focus({ preventScroll: true });
    twinRefreshViewOffset();
};

const twinShowFallback = (root, reason) => {
    root.classList.add('twin--fallback', 'is-panel-open');
    root.classList.remove('is-panel-closed', 'is-loading');
    const stage = root.querySelector('.twin-stage');
    if (stage) {
        stage.innerHTML = `<div class="twin-fallback">
            <strong>${reason === 'webgl' ? 'Affichage 3D indisponible sur cet appareil' : "Le moteur 3D n'a pas pu être chargé"}</strong>
            <span>Toutes les données de l'atelier restent accessibles dans la liste ci-contre.</span>
        </div>`;
    }
    if (!DB.getFilter('twin_tab')) DB.setFilter('twin_tab', 'objets');
    twinRenderPanel();
};

const renderJumeau = () => {
    const model = buildTwinModel();
    const existing = document.getElementById('twinRoot');
    if (existing && existing.isConnected) {
        Twin.model = model;
        twinRenderKpis(model);
        twinRenderLive(model);
        if (Twin.container === existing) twinApplyModel(model);
        twinRenderPanel();
        twinRenderInspector();
        return;
    }
    safeRender(twinShellHtml());
    const root = document.getElementById('twinRoot');
    Twin.model = model;
    if (Twin.selectedId && !model.byId.has(Twin.selectedId)) Twin.selectedId = null;
    twinRenderKpis(model);
    twinRenderLive(model);
    twinRenderPanel();
    twinRenderInspector();
    if (!twinIsSupported()) {
        twinShowFallback(root, 'webgl');
        return;
    }
    root.classList.add('is-loading');
    twinLoadLibrary().then(() => {
        if (!root.isConnected) return null;
        twinMount(root);
        twinApplyModel(Twin.model);
        if (Twin.selectedId) twinFlyTo(twinViewForObject(Twin.selectedId), 0);
        twinRenderInspector();
        // Le chargement reste affiché jusqu'à la première image
        return twinWarmUp();
    }).then(() => {
        if (!root.isConnected) return;
        root.classList.remove('is-loading');
        document.getElementById('twinLoading')?.remove();
    }).catch(err => {
        console.error('Jumeau 3D : chargement impossible', err);
        if (root.isConnected) twinShowFallback(root, 'load');
    });
};

const twinToggleFullscreen = () => {
    const root = document.getElementById('twinRoot');
    if (!root || !document.fullscreenEnabled) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else root.requestFullscreen?.().catch(() => showToast('Plein écran indisponible', 'error'));
};

CLICK_HANDLERS['twin-zone'] = (el) => twinFocusZone(el.getAttribute('data-zone'));
CLICK_HANDLERS['twin-select'] = (el) => {
    const id = el.getAttribute('data-id');
    const fromList = el.hasAttribute('data-fly');
    twinSelect(id, { fly: true, focusInspector: fromList });
    if (fromList && window.matchMedia?.('(max-width: 768px)').matches) {
        document.getElementById('twinRoot')?.classList.remove('is-panel-open');
    }
};
CLICK_HANDLERS['twin-close-inspector'] = () => twinSelect(null);
CLICK_HANDLERS['twin-cycle'] = (el) => twinCycle(Number(el.getAttribute('data-dir')) || 1);
CLICK_HANDLERS['twin-center'] = () => { if (Twin.selectedId) twinFlyTo(twinViewForObject(Twin.selectedId)); };
CLICK_HANDLERS['twin-tab'] = (el) => {
    DB.setFilter('twin_tab', el.getAttribute('data-tab') || 'alertes');
    twinRenderPanel();
};
const twinCompactLayout = () => !!window.matchMedia?.('(max-width: 1024px)').matches;
CLICK_HANDLERS['twin-toggle-panel'] = (el) => {
    const root = document.getElementById('twinRoot');
    if (!root) return;
    if (twinCompactLayout()) {
        el.setAttribute('aria-expanded', String(root.classList.toggle('is-panel-open')));
    } else {
        const closed = root.classList.toggle('is-panel-closed');
        DB.setFilter('twin_panel', closed ? 'closed' : '');
        el.setAttribute('aria-expanded', String(!closed));
    }
    twinRefreshViewOffset();
};
CLICK_HANDLERS['twin-autorotate'] = (el) => {
    if (!Twin.controls) return;
    Twin.controls.autoRotate = !Twin.controls.autoRotate;
    el.setAttribute('aria-pressed', String(Twin.controls.autoRotate));
    twinWake();
};
CLICK_HANDLERS['twin-fullscreen'] = () => twinToggleFullscreen();

// Menu « Qualité du rendu » (Auto / Haute / Standard / Économie), mémorisé par appareil
const twinRenderQualityMenu = () => {
    const el = document.getElementById('twinQualityMenu');
    if (!el) return;
    const setting = twinQualitySetting();
    const auto = Twin.autoQuality || (twinIsSupported() ? twinDetectQuality() : 'medium');
    const options = [
        ['auto', `Auto (${TWIN_QUALITY_LEVELS[auto].label})`],
        ...[...TWIN_QUALITY_ORDER].reverse().map(k => [k, TWIN_QUALITY_LEVELS[k].label])
    ];
    el.innerHTML = `<p class="twin-quality-title">Qualité du rendu 3D</p>${options.map(([value, label]) => `
        <button type="button" role="menuitemradio" class="twin-quality-opt" aria-checked="${setting === value}" data-click="twin-quality" data-quality="${value}">
            <span class="twin-quality-label">${escapeHtml(label)}</span>
        </button>`).join('')}`;
};

const twinCloseQualityMenu = () => {
    const menu = document.getElementById('twinQualityMenu');
    if (!menu || menu.hidden) return false;
    const btn = document.querySelector('[data-click="twin-quality-menu"]');
    const hadFocus = menu.contains(document.activeElement);
    menu.hidden = true;
    btn?.setAttribute('aria-expanded', 'false');
    if (hadFocus) btn?.focus();
    return true;
};

CLICK_HANDLERS['twin-quality-menu'] = (el) => {
    const menu = document.getElementById('twinQualityMenu');
    if (!menu) return;
    if (twinCloseQualityMenu()) return;
    twinRenderQualityMenu();
    menu.hidden = false;
    el.setAttribute('aria-expanded', 'true');
    menu.querySelector('[aria-checked="true"]')?.focus();
};
CLICK_HANDLERS['twin-quality'] = (el) => {
    const value = el.getAttribute('data-quality');
    DB.setFilter('twin_quality', value === 'auto' ? '' : value);
    twinCloseQualityMenu();
    if (Twin.renderer && Twin.quality && Twin.quality.level !== twinResolveQuality()) twinApplyQuality();
    else if (Twin.quality) {
        Twin.quality.setting = twinQualitySetting();
        twinRefreshPixelRatio();
    }
    showToast(`Qualité 3D : ${value === 'auto' ? `Auto (${TWIN_QUALITY_LEVELS[twinResolveQuality()].label})` : TWIN_QUALITY_LEVELS[value].label}`);
};
document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest?.('.twin-quality')) twinCloseQualityMenu();
});
CLICK_HANDLERS['twin-goto-stock'] = (el) => {
    DB.setFilter('stockQuery', '');
    DB.setFilter('stockCell', stockCellKey(el.getAttribute('data-arome'), el.getAttribute('data-format')));
    DB.setFilter('stockStatut', '');
    window.location.hash = '#stock';
};
CLICK_HANDLERS['twin-clock-in'] = (el) => { if (clockInEmployee(el.getAttribute('data-id'))) renderCurrentView(); };
CLICK_HANDLERS['twin-clock-out'] = (el) => { if (clockOutEmployee(el.getAttribute('data-id'))) renderCurrentView(); };

window.addEventListener('online', () => { if (document.getElementById('twinRoot') && Twin.model) twinRenderLive(Twin.model); });
window.addEventListener('offline', () => { if (document.getElementById('twinRoot') && Twin.model) twinRenderLive(Twin.model); });
