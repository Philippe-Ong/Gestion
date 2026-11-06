// =============================================================================
// Pointage (v13.3) — heures saisies après coup, vues Semaine et Mois
// =============================================================================
// Un pointage est une plage de travail : { id, employeId, date (jour d'arrivée),
// heureDebut, heureFin ('' tant que la plage est en cours), pause (min), notes }.
// Une plage dont la fin précède le début se termine le lendemain (travail de
// nuit) et compte pour le jour d'arrivée. Les heures se saisissent après le
// travail, journée par journée (showPointageJourModal) ; Arrivée / Départ en
// direct restent possibles (clockInEmployee / clockOutEmployee).

let pointageLundiAffiche = null; // lundi (AAAA-MM-JJ) de la semaine affichée, null = semaine en cours
let pointageMoisAffiche = null;  // mois (AAAA-MM) affiché, null = mois en cours
let pointageAnneeAffiche = null; // année (nombre) affichée, null = année en cours
let pointageTicker = null;

// --- Pointage en direct réutilisable (page Pointage, tableau de bord, jumeau 3D, palette) ---
const clockInEmployee = (empId) => {
    if (!empId) {
        showToast('Sélectionne un employé', 'error');
        return false;
    }
    const today = getLocalDateISOString();
    const pointages = DB.get('pointages') || [];
    const enCours = findPointageEnCours(pointages, empId, today);
    if (enCours) {
        showToast(`Pointage déjà en cours pour cet employé (depuis le ${formatDate(enCours.date)} ${enCours.heureDebut || ''})`, 'error');
        return false;
    }
    const now = new Date();
    const heureDebut = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    // Heures déjà saisies qui couvrent ce moment (plage du jour ou de nuit de la veille)
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const couverte = pointages.find(p => {
        if (p.employeId !== empId || !p.heureFin || (p.date !== today && p.date !== pointageJourDecale(today, -1))) return false;
        const iv = pointageIntervalle(p, today, now);
        return iv && iv[0] <= nowMin && nowMin < iv[1];
    });
    if (couverte) {
        showToast(`Des heures sont déjà saisies à ce moment (${pointagePlageLabel(couverte)})`, 'error');
        return false;
    }
    pointages.push({ id: generateId(), employeId: empId, date: today, heureDebut, heureFin: '', pause: 0 });
    DB.set('pointages', pointages);
    showToast(`Arrivée pointée à ${heureDebut}`);
    return true;
};

const clockOutEmployee = (empId) => {
    if (!empId) {
        showToast('Sélectionne un employé', 'error');
        return false;
    }
    const today = getLocalDateISOString();
    const pointages = DB.get('pointages') || [];
    const enCours = findPointageEnCours(pointages, empId, today);
    if (!enCours) {
        showToast('Aucun pointage en cours pour cet employé', 'error');
        return false;
    }
    const now = new Date();
    enCours.heureFin = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    DB.set('pointages', pointages);
    showToast(`Départ pointé à ${enCours.heureFin}${enCours.date !== today ? ` (pointage du ${formatDate(enCours.date)})` : ''}`);
    return true;
};

const POINTAGE_COULEUR_INACTIF = '#8B8B85';
const POINTAGE_MEMBRE_INCONNU = { id: '', nom: 'Employé', actif: false, couleur: POINTAGE_COULEUR_INACTIF, initiales: '?' };

// Jour (AAAA-MM-JJ) décalé de n jours ; partir de midi évite les changements d'heure
const pointageJourDecale = (dayKey, n) => toLocalDayKey(new Date(`${dayKey}T12:00:00`).getTime() + n * 86400000);
const pointageJoursVoisins = (date) => [pointageJourDecale(date, -1), date, pointageJourDecale(date, 1)];
const pointageLundi = (dayKey) => pointageJourDecale(dayKey, -((new Date(`${dayKey}T12:00:00`).getDay() + 6) % 7));
const pointageMoisDecale = (mois, n) => {
    const [y, m] = mois.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const pointageJourLabel = (dayKey, options = { weekday: 'long', day: 'numeric', month: 'long' }) =>
    new Date(`${dayKey}T12:00:00`).toLocaleDateString('fr-CH', options);
const pointageJourCourt = (dayKey) => pointageJourLabel(dayKey, { weekday: 'short', day: 'numeric', month: 'short' });
const pointagePlageLabel = (p) => `${p.heureDebut || '?'} – ${p.heureFin || 'en cours'}`;
const pointageParDebut = (a, b) => (a.heureDebut || '').localeCompare(b.heureDebut || '');

// « Semaine du 26 octobre au 1er novembre 2026 »
const pointageTitreSemaine = (jours) => {
    const a = new Date(`${jours[0]}T12:00:00`);
    const b = new Date(`${jours[6]}T12:00:00`);
    const jour = (d) => (d.getDate() === 1 ? '1er' : String(d.getDate()));
    const mois = (d) => d.toLocaleDateString('fr-CH', { month: 'long' });
    const debut = a.getMonth() === b.getMonth()
        ? jour(a)
        : `${jour(a)} ${mois(a)}${a.getFullYear() !== b.getFullYear() ? ` ${a.getFullYear()}` : ''}`;
    return `Semaine du ${debut} au ${jour(b)} ${mois(b)} ${b.getFullYear()}`;
};

// Arrivée d'une plage en millisecondes (NaN si la date ou l'heure est illisible)
const pointageDebutMs = (p) => {
    const debut = parseHHMM(p.heureDebut);
    const jour = dateOnly(p.date);
    if (debut === null || Number.isNaN(jour.getTime())) return NaN;
    return new Date(jour.getFullYear(), jour.getMonth(), jour.getDate(), Math.floor(debut / 60), debut % 60).getTime();
};

// Plage ouverte depuis plus de POINTAGE_OUVERT_MAX_H heures (ou illisible) : départ oublié
const pointageOubli = (p, now = new Date()) =>
    !p.heureFin && !(now.getTime() - pointageDebutMs(p) <= CONSTANTS.POINTAGE_OUVERT_MAX_H * 3600000);

// Minutes travaillées d'une plage, pause déduite. Une plage en cours compte
// jusqu'à maintenant ; un départ oublié ne compte pas tant qu'il n'est pas saisi.
const pointageDuree = (p, now = new Date()) => {
    const debut = parseHHMM(p.heureDebut);
    if (debut === null) return 0;
    const pause = Number(p.pause) || 0;
    if (p.heureFin) return computePointageMinutes(debut, parseHHMM(p.heureFin), pause) || 0;
    if (pointageOubli(p, now)) return 0;
    return Math.max(0, Math.floor((now.getTime() - pointageDebutMs(p)) / 60000) - pause);
};

// Intervalle [début, fin[ d'une plage en minutes depuis minuit du jour `ref` :
// une plage de nuit déborde sur le lendemain, une plage en cours s'étend jusqu'à
// maintenant, un départ oublié n'occupe que sa minute d'arrivée.
const pointageIntervalle = (p, ref, now = new Date()) => {
    const debut = parseHHMM(p.heureDebut);
    if (debut === null || !isValidDateOnly(p.date)) return null;
    const decalage = Math.round((dateOnly(p.date).getTime() - dateOnly(ref).getTime()) / 86400000) * 1440;
    let duree;
    if (p.heureFin) {
        const fin = parseHHMM(p.heureFin);
        duree = fin === null ? 0 : (fin - debut + 1440) % 1440;
    } else {
        duree = pointageOubli(p, now) ? 0 : Math.floor((now.getTime() - pointageDebutMs(p)) / 60000);
    }
    return [decalage + debut, decalage + debut + Math.max(1, duree)];
};

const pointageIntervallesChevauchent = (a, b) => a[0] < b[1] && b[0] < a[1];

// Plage en cours d'un employé (arrivée aujourd'hui, ou hier pour le travail de
// nuit). Un départ oublié n'en est plus une : il est signalé « à clôturer ».
const findPointageEnCours = (pointages, empId, today) => {
    const hier = pointageJourDecale(today, -1);
    const now = new Date();
    return pointages
        .filter(p => p.employeId === empId && !p.heureFin && (p.date === today || p.date === hier) && !pointageOubli(p, now))
        .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.heureDebut || '').localeCompare(a.heureDebut || ''))[0] || null;
};

// Départs oubliés, les plus anciens d'abord (priorités du tableau de bord)
const pointagesAClore = (pointages, now = new Date()) => pointages
    .filter(p => pointageOubli(p, now))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || pointageParDebut(a, b));

// Personnes affichées : les employés actifs (ordre et couleurs du jumeau 3D),
// puis les inactifs ou supprimés qui ont des heures dans `plages`
const pointageEquipe = (plages = []) => {
    const employees = DB.get('employees') || [];
    const avecHeures = new Set(plages.map(p => p.employeId).filter(Boolean));
    const membre = (id, nom, actif, couleur) => ({
        id, nom, actif, couleur,
        initiales: nom.split(/\s+/).map(x => x[0] || '').join('').slice(0, 2).toUpperCase()
    });
    const nomDe = (e) => `${e.prenom || ''} ${e.nom || ''}`.trim() || 'Employé';
    const equipe = employees.filter(e => e.actif)
        .map((e, i) => membre(e.id, nomDe(e), true, TWIN_STAFF_COLORS[i % TWIN_STAFF_COLORS.length]));
    employees.filter(e => !e.actif && avecHeures.has(e.id))
        .forEach(e => equipe.push(membre(e.id, nomDe(e), false, POINTAGE_COULEUR_INACTIF)));
    const connus = new Set(employees.map(e => e.id));
    avecHeures.forEach(id => {
        if (!connus.has(id)) equipe.push(membre(id, 'Employé supprimé', false, POINTAGE_COULEUR_INACTIF));
    });
    return equipe;
};

const pointageAvatarHtml = (m, present = false) =>
    `<span class="dash-avatar ptg-avatar${present ? ' is-present' : ''}" style="--avatar:${safeColor(m.couleur)}" aria-hidden="true">${escapeHtml(m.initiales || '?')}</span>`;

// Semaine du lundi `lundi` : minutes par personne et par jour
const buildPointageSemaine = (lundi, now = new Date()) => {
    const jours = Array.from({ length: 7 }, (_, i) => pointageJourDecale(lundi, i));
    const plages = (DB.get('pointages') || []).filter(p => p.date >= jours[0] && p.date <= jours[6]);
    const lignes = pointageEquipe(plages).map(membre => {
        const cases = jours.map(date => {
            const duJour = plages.filter(p => p.employeId === membre.id && p.date === date);
            return {
                date,
                minutes: duJour.reduce((s, p) => s + pointageDuree(p, now), 0),
                enCours: duJour.some(p => !p.heureFin && !pointageOubli(p, now)),
                aClore: duJour.some(p => pointageOubli(p, now))
            };
        });
        return { membre, cases, total: cases.reduce((s, c) => s + c.minutes, 0) };
    });
    const totaux = jours.map((_, i) => lignes.reduce((s, l) => s + l.cases[i].minutes, 0));
    return { jours, plages, lignes, totaux, total: totaux.reduce((s, m) => s + m, 0) };
};

// Mois `mois` (AAAA-MM) : minutes par personne et par jour, journées, cumul depuis janvier
const buildPointageMois = (mois, now = new Date()) => {
    const [y, m] = mois.split('-').map(Number);
    const jours = Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => `${mois}-${String(i + 1).padStart(2, '0')}`);
    const fin = jours[jours.length - 1];
    const toutes = DB.get('pointages') || [];
    const plages = toutes.filter(p => p.date >= jours[0] && p.date <= fin);
    const depuisJanvier = toutes.filter(p => p.date >= `${y}-01-01` && p.date <= fin);
    const membres = pointageEquipe(plages).map(membre => {
        const siennes = plages.filter(p => p.employeId === membre.id);
        const parJour = jours.map(date => siennes.filter(p => p.date === date).reduce((s, p) => s + pointageDuree(p, now), 0));
        return {
            membre, parJour, plages: siennes,
            minutes: parJour.reduce((s, v) => s + v, 0),
            journees: parJour.filter(v => v > 0).length,
            annee: depuisJanvier.filter(p => p.employeId === membre.id).reduce((s, p) => s + pointageDuree(p, now), 0)
        };
    });
    return {
        mois, jours, plages, membres,
        minutes: membres.reduce((s, x) => s + x.minutes, 0),
        journees: membres.reduce((s, x) => s + x.journees, 0)
    };
};

// En-tête de période avec navigation (la période en cours est la dernière)
const pointageNavHtml = (titre, meta, estCourant, libelles) => `
    <div class="stock-section-head ptg-nav">
        <h2 class="stock-section-title" id="ptgPeriodeTitle">${escapeHtml(titre)}</h2>
        <span class="stock-section-meta">${escapeHtml(meta)}</span>
        <span class="ptg-nav-btns">
            <button type="button" class="btn btn-sm btn-secondary ptg-nav-btn ptg-nav-prev" data-click="pointage-nav" data-dir="-1" aria-label="${escapeHtml(libelles.prec)}">${dashIcon('chevron')}</button>
            ${estCourant ? '' : `<button type="button" class="btn btn-sm btn-secondary" data-click="pointage-nav" data-dir="0">${escapeHtml(libelles.retour)}</button>`}
            <button type="button" class="btn btn-sm btn-secondary ptg-nav-btn" data-click="pointage-nav" data-dir="1" aria-label="${escapeHtml(libelles.suiv)}"${estCourant ? ' disabled' : ''}>${dashIcon('chevron')}</button>
        </span>
    </div>`;

// Plages pointées en direct (Arrivée) et pas encore terminées
const pointageEnCoursHtml = (pointages, now) => {
    const today = toLocalDayKey(now.getTime());
    const enCours = pointageEquipe(pointages)
        .map(m => ({ m, p: findPointageEnCours(pointages, m.id, today) }))
        .filter(x => x.p);
    if (enCours.length === 0) return '';
    const row = ({ m, p }) => `
        <li class="ptg-row">
            ${pointageAvatarHtml(m, true)}
            <span class="ptg-row-main">
                <span class="ptg-row-name">${escapeHtml(m.nom)}</span>
                <span class="ptg-row-sub">Depuis ${p.date !== today ? 'hier ' : ''}${escapeHtml(p.heureDebut)} · <span data-ptg-depuis="${pointageDebutMs(p) + (Number(p.pause) || 0) * 60000}">${escapeHtml(twinFmtDuration(pointageDuree(p, now)))}</span></span>
            </span>
            <span class="ptg-row-actions">
                <button type="button" class="btn btn-sm btn-primary" data-click="twin-clock-out" data-id="${escapeHtml(m.id)}" aria-label="${escapeHtml(`Pointer le départ de ${m.nom}`)}">Départ</button>
                ${rowMenuHtml(m.nom, `<button type="button" data-click="cloturer-pointage" data-id="${escapeHtml(p.id)}">Corriger les heures</button>`)}
            </span>
        </li>`;
    return `
        <section class="stock-section" aria-labelledby="ptgEnCoursTitle">
            <div class="stock-section-head"><h2 class="stock-section-title" id="ptgEnCoursTitle">En cours</h2></div>
            <div class="stock-group"><ul class="ptg-list">${enCours.map(row).join('')}</ul></div>
        </section>`;
};

// Case d'une personne pour un jour : heures du jour, saisie au toucher
const pointageCaseHtml = (m, c, today) => {
    const cls = ['ptg-cell'];
    if (c.date === today) cls.push('is-today');
    if (c.date > today) return `<span class="${cls.join(' ')} is-future" aria-hidden="true"></span>`;
    if (c.minutes > 0) cls.push('has-hours');
    if (c.aClore) cls.push('is-warning');
    else if (c.enCours) cls.push('is-live');
    const etat = c.aClore ? ', départ non saisi' : c.enCours ? ', en cours' : '';
    const label = `${m.nom}, ${pointageJourLabel(c.date)} : ${c.minutes > 0 ? twinFmtDuration(c.minutes) : 'aucune heure'}${etat}. Saisir ou corriger`;
    return `<button type="button" class="${cls.join(' ')}" data-click="pointage-jour" data-emp="${escapeHtml(m.id)}" data-date="${escapeHtml(c.date)}" aria-label="${escapeHtml(label)}">
        <span class="ptg-cell-value">${c.minutes > 0 ? escapeHtml(twinFmtDuration(c.minutes)) : '+'}</span>
        ${c.aClore || c.enCours ? '<span class="ptg-cell-mark" aria-hidden="true"></span>' : ''}
    </button>`;
};

// Une plage dans le détail de la semaine
const pointagePlageRowHtml = (p, m, now) => {
    const debut = parseHHMM(p.heureDebut);
    const fin = parseHHMM(p.heureFin);
    const pause = Number(p.pause) || 0;
    const oubli = pointageOubli(p, now);
    const sub = [
        `${p.heureDebut || '?'} → ${p.heureFin || (oubli ? 'départ non saisi' : 'en cours')}${debut !== null && fin !== null && fin < debut ? ' (lendemain)' : ''}`,
        pause > 0 ? `pause ${pause} min` : ''
    ].filter(Boolean).join(' · ');
    const duree = p.heureFin ? twinFmtDuration(pointageDuree(p, now)) : (oubli ? '—' : 'en cours');
    return `
        <li class="ptg-row">
            ${pointageAvatarHtml(m, !p.heureFin && !oubli)}
            <span class="ptg-row-main">
                <span class="ptg-row-name">${escapeHtml(m.nom)}</span>
                <span class="ptg-row-sub">${escapeHtml(sub)}</span>
                ${p.notes ? `<span class="ptg-row-note">${escapeHtml(p.notes)}</span>` : ''}
            </span>
            <strong class="ptg-row-total">${escapeHtml(duree)}</strong>
            ${rowMenuHtml(`plage ${pointagePlageLabel(p)} de ${m.nom}`, `
                <button type="button" data-click="pointage-jour" data-emp="${escapeHtml(p.employeId || '')}" data-date="${escapeHtml(p.date || '')}" data-focus="${escapeHtml(p.id)}">Modifier</button>
                <button type="button" class="is-danger" data-click="delete-pointage" data-id="${escapeHtml(p.id)}">Supprimer</button>`)}
        </li>`;
};

// Plages de la semaine, jour par jour (le plus récent d'abord), dans un bloc
// repliable dont l'état est mémorisé sur l'appareil
const pointageDetailSemaineHtml = (s, now) => {
    if (s.plages.length === 0) return '';
    const membres = new Map(s.lignes.map(l => [l.membre.id, l.membre]));
    const nom = (p) => (membres.get(p.employeId) || POINTAGE_MEMBRE_INCONNU).nom;
    const jours = [...s.jours].reverse().filter(d => s.plages.some(p => p.date === d));
    const groupe = (d) => {
        const duJour = s.plages.filter(p => p.date === d).sort((a, b) => pointageParDebut(a, b) || nom(a).localeCompare(nom(b), 'fr'));
        const total = duJour.reduce((sum, p) => sum + pointageDuree(p, now), 0);
        return `
            <div class="stock-group">
                <div class="stock-group-head ptg-day-head">
                    <h3 class="stock-group-title">${escapeHtml(dashCapitalize(pointageJourLabel(d)))}</h3>
                    <span class="stock-group-meta">${total > 0 ? escapeHtml(twinFmtDuration(total)) : ''}</span>
                </div>
                <ul class="ptg-list">${duJour.map(p => pointagePlageRowHtml(p, membres.get(p.employeId) || POINTAGE_MEMBRE_INCONNU, now)).join('')}</ul>
            </div>`;
    };
    return `
        <details class="ptg-plages"${DB.getFilter('pointage_plages') === 'open' ? ' open' : ''}>
            <summary class="ptg-plages-summary">Plages de la semaine <span class="stock-section-meta">${escapeHtml(dashPlural(s.plages.length, 'plage'))}</span></summary>
            ${jours.map(groupe).join('')}
        </details>`;
};

// Vue Semaine : tableau personnes × jours, puis le détail des plages
const pointageSemaineHtml = (now) => {
    const today = toLocalDayKey(now.getTime());
    const lundiCourant = pointageLundi(today);
    const lundi = pointageLundiAffiche || lundiCourant;
    const s = buildPointageSemaine(lundi, now);
    const personnes = s.lignes.filter(l => l.total > 0).length;
    const meta = s.total > 0 ? `${twinFmtDuration(s.total)} · ${dashPlural(personnes, 'personne')}` : 'aucune heure saisie';
    const jourTete = (d) => `<span class="ptg-week-day${d === today ? ' is-today' : ''}">${escapeHtml(pointageJourLabel(d, { weekday: 'short' }))}<strong>${Number(d.slice(8))}</strong></span>`;
    const ligne = (l) => `
        <li class="ptg-week-row">
            <span class="ptg-week-who">${pointageAvatarHtml(l.membre)}<span class="ptg-week-name">${escapeHtml(l.membre.nom)}</span>${l.membre.actif ? '' : '<span class="stock-tag">inactif</span>'}</span>
            ${l.cases.map(c => pointageCaseHtml(l.membre, c, today)).join('')}
            <span class="ptg-week-total"><span class="dash-sr">${escapeHtml(`Total de ${l.membre.nom} : `)}</span>${l.total > 0 ? escapeHtml(twinFmtDuration(l.total)) : '—'}</span>
        </li>`;
    const pied = s.lignes.length > 1 ? `
        <li class="ptg-week-row ptg-week-foot">
            <span class="ptg-week-who"><span class="ptg-week-name">Équipe</span></span>
            ${s.totaux.map((t, i) => `<span class="ptg-week-sum">${t > 0 ? `<span class="dash-sr">${escapeHtml(`${pointageJourLabel(s.jours[i])} : `)}</span>${escapeHtml(twinFmtDuration(t))}` : ''}</span>`).join('')}
            <span class="ptg-week-total">${s.total > 0 ? escapeHtml(twinFmtDuration(s.total)) : '—'}</span>
        </li>` : '';
    return `
        <section class="stock-section" aria-labelledby="ptgPeriodeTitle">
            ${pointageNavHtml(pointageTitreSemaine(s.jours), meta, lundi === lundiCourant, { prec: 'Semaine précédente', suiv: 'Semaine suivante', retour: 'Cette semaine' })}
            ${s.lignes.length ? `
                <div class="stock-group ptg-week-wrap">
                    <div class="ptg-week-row ptg-week-head" aria-hidden="true">
                        <span class="ptg-week-who"></span>${s.jours.map(jourTete).join('')}<span class="ptg-week-total">Total</span>
                    </div>
                    <ul class="ptg-week">${s.lignes.map(ligne).join('')}${pied}</ul>
                </div>`
            : '<div class="commande-empty">Aucun employé actif.</div>'}
        </section>
        ${pointageDetailSemaineHtml(s, now)}`;
};

// Vue Mois : total par personne, journées, moyenne, cumul et détail des journées
const pointageMoisHtml = (now) => {
    const today = toLocalDayKey(now.getTime());
    const moisCourant = today.slice(0, 7);
    const mois = pointageMoisAffiche || moisCourant;
    const m = buildPointageMois(mois, now);
    const titre = dashCapitalize(new Date(`${mois}-01T12:00:00`).toLocaleDateString('fr-CH', { month: 'long', year: 'numeric' }));
    const meta = m.minutes > 0 ? `${twinFmtDuration(m.minutes)} · ${dashPlural(m.journees, 'journée')}` : 'aucune heure saisie';
    const max = Math.max(1, ...m.membres.flatMap(x => x.parJour));
    const row = (x) => {
        const sub = x.minutes > 0
            ? [dashPlural(x.journees, 'journée'), `moyenne ${twinFmtDuration(x.minutes / x.journees)}`, `depuis janvier ${twinFmtDuration(x.annee)}`].join(' · ')
            : `Aucune heure ce mois${x.annee > 0 ? ` · depuis janvier ${twinFmtDuration(x.annee)}` : ''}`;
        const jours = m.jours.filter((d, i) => x.parJour[i] > 0 || x.plages.some(p => p.date === d));
        const barre = (d, i) => {
            const v = x.parJour[i];
            const weekEnd = [0, 6].includes(new Date(`${d}T12:00:00`).getDay());
            return `<span class="ptg-strip-day${weekEnd ? ' is-weekend' : ''}${d === today ? ' is-today' : ''}" title="${escapeHtml(`${pointageJourCourt(d)} : ${v > 0 ? twinFmtDuration(v) : '—'}`)}"><span class="ptg-strip-bar" style="--h:${v > 0 ? Math.max(0.08, v / max).toFixed(3) : 0}"></span></span>`;
        };
        const journee = (d) => {
            const i = m.jours.indexOf(d);
            const plages = x.plages.filter(p => p.date === d).sort(pointageParDebut);
            return `<li><button type="button" class="ptg-month-day" data-click="pointage-jour" data-emp="${escapeHtml(x.membre.id)}" data-date="${escapeHtml(d)}">
                <span class="ptg-month-day-date">${escapeHtml(dashCapitalize(pointageJourCourt(d)))}</span>
                <span class="ptg-month-day-plages">${escapeHtml(plages.map(pointagePlageLabel).join(', '))}</span>
                <strong>${x.parJour[i] > 0 ? escapeHtml(twinFmtDuration(x.parJour[i])) : '—'}</strong>
            </button></li>`;
        };
        return `
            <li class="ptg-month-row">
                <div class="ptg-row">
                    ${pointageAvatarHtml(x.membre)}
                    <span class="ptg-row-main">
                        <span class="ptg-row-name">${escapeHtml(x.membre.nom)}${x.membre.actif ? '' : '<span class="stock-tag">inactif</span>'}</span>
                        <span class="ptg-row-sub">${escapeHtml(sub)}</span>
                    </span>
                    <strong class="ptg-month-total">${x.minutes > 0 ? escapeHtml(twinFmtDuration(x.minutes)) : '—'}</strong>
                </div>
                <div class="ptg-strip" style="--ptg-jours:${m.jours.length}" aria-hidden="true">${m.jours.map(barre).join('')}</div>
                ${jours.length ? `<details class="ptg-month-detail">
                    <summary>Détail des journées</summary>
                    <ul class="ptg-month-days">${jours.map(journee).join('')}</ul>
                </details>` : ''}
            </li>`;
    };
    return `
        <section class="stock-section" aria-labelledby="ptgPeriodeTitle">
            ${pointageNavHtml(titre, meta, mois === moisCourant, { prec: 'Mois précédent', suiv: 'Mois suivant', retour: 'Ce mois-ci' })}
            ${m.membres.length
                ? `<div class="stock-group"><ul class="ptg-month-list">${m.membres.map(row).join('')}</ul></div>`
                : '<div class="commande-empty">Aucun employé actif.</div>'}
        </section>`;
};

// --- Année (v13.4) : statistiques de l'année choisie ---
const POINTAGE_JOURS_SEMAINE = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const pointageMoisNom = (annee, i, month = 'long') => new Date(annee, i, 1, 12).toLocaleDateString('fr-CH', { month });
const pointageHeuresDecimal = (minutes) => Math.round(minutes / 60 * 100) / 100;

// Activités citées dans les notes (« prod, livraison + compta/facturation ») :
// nombre de plages qui citent chacune ; les pluriels sont regroupés
const pointageActivites = (mesurees) => {
    const parCle = new Map();
    mesurees.forEach(({ p }) => {
        const vues = new Set();
        String(p.notes || '').split(/[,;+/&\n]|\s+et\s+/i).forEach(brut => {
            const libelle = brut.trim().replace(/\s+/g, ' ').toLowerCase();
            const cle = ptgImportNorm(libelle).split(' ').map(w => (w.length > 3 ? w.replace(/s$/, '') : w)).join(' ');
            if (!cle || vues.has(cle)) return;
            vues.add(cle);
            const a = parCle.get(cle) || { plages: 0, libelles: new Map() };
            a.plages++;
            a.libelles.set(libelle, (a.libelles.get(libelle) || 0) + 1);
            parCle.set(cle, a);
        });
    });
    return [...parCle.values()]
        .map(a => ({ libelle: dashCapitalize([...a.libelles].sort((x, y) => y[1] - x[1])[0][0]), plages: a.plages }))
        .sort((a, b) => b.plages - a.plages || a.libelle.localeCompare(b.libelle, 'fr'));
};

// Année `annee` : totaux, personnes, mois, jours de la semaine, heures de la
// journée, activités et repères. Une plage compte pour son jour d'arrivée ;
// une plage de nuit se répartit sur les heures après minuit.
const buildPointageAnnee = (annee, now = new Date()) => {
    const today = toLocalDayKey(now.getTime());
    const anneeCourante = Number(today.slice(0, 4));
    const debut = `${annee}-01-01`;
    const fin = `${annee}-12-31`;
    const toutes = DB.get('pointages') || [];
    const plages = toutes.filter(p => p.date >= debut && p.date <= fin);
    const mesurees = plages.map(p => ({ p, minutes: pointageDuree(p, now) })).filter(x => x.minutes > 0);
    const somme = (liste) => liste.reduce((s, x) => s + x.minutes, 0);
    const moisCles = Array.from({ length: 12 }, (_, i) => `${annee}-${String(i + 1).padStart(2, '0')}`);

    const membres = pointageEquipe(plages).map(membre => {
        const siennes = mesurees.filter(x => x.p.employeId === membre.id);
        const parJour = new Map();
        siennes.forEach(x => parJour.set(x.p.date, (parJour.get(x.p.date) || 0) + x.minutes));
        let record = null;
        parJour.forEach((minutes, date) => {
            if (!record || minutes > record.minutes) record = { date, minutes };
        });
        return {
            membre, record,
            minutes: somme(siennes),
            journees: parJour.size,
            plages: siennes.length,
            parMois: moisCles.map(m => somme(siennes.filter(x => x.p.date.startsWith(m))))
        };
    });

    const parJourSemaine = POINTAGE_JOURS_SEMAINE.map(() => ({ minutes: 0, journees: new Set() }));
    const parHeure = Array(24).fill(0);
    const parSemaine = new Map();
    mesurees.forEach(({ p, minutes }) => {
        const j = parJourSemaine[(new Date(`${p.date}T12:00:00`).getDay() + 6) % 7];
        j.minutes += minutes;
        j.journees.add(`${p.employeId}|${p.date}`);
        const lundi = pointageLundi(p.date);
        parSemaine.set(lundi, (parSemaine.get(lundi) || 0) + minutes);
        // Heures de la journée : la plage est parcourue heure par heure, pause répartie
        const debutMin = parseHHMM(p.heureDebut);
        const finMin = p.heureFin ? parseHHMM(p.heureFin) : null;
        const ecoule = p.heureFin ? (finMin === null ? 0 : (finMin - debutMin + 1440) % 1440) : minutes + (Number(p.pause) || 0);
        if (debutMin === null || !(ecoule > 0)) return;
        for (let t = debutMin, reste = ecoule; reste > 0;) {
            const part = Math.min(reste, 60 - (t % 60));
            parHeure[Math.floor(t / 60) % 24] += part * minutes / ecoule;
            t += part;
            reste -= part;
        }
    });

    const parMois = moisCles.map(m => somme(mesurees.filter(x => x.p.date.startsWith(m))));
    const iMois = parMois.indexOf(Math.max(...parMois));
    const semaineMax = [...parSemaine].sort((a, b) => b[1] - a[1])[0] || null;
    const journeeMax = membres.filter(x => x.record).sort((a, b) => b.record.minutes - a.record.minutes)[0] || null;
    // Semaines écoulées : jusqu'à aujourd'hui pour l'année en cours
    const jours = Math.round((dateOnly(annee === anneeCourante ? today : fin) - dateOnly(debut)) / 86400000) + 1;
    // Année précédente, à la même date pour l'année en cours
    const precFin = annee === anneeCourante ? `${annee - 1}${today.slice(4)}` : `${annee - 1}-12-31`;
    const precedente = toutes.filter(p => p.date >= `${annee - 1}-01-01` && p.date <= precFin)
        .reduce((s, p) => s + pointageDuree(p, now), 0);

    return {
        annee, moisCles, membres, parMois, parHeure, precedente,
        enCours: annee === anneeCourante,
        moisCourant: annee === anneeCourante ? Number(today.slice(5, 7)) - 1 : -1,
        minutes: somme(mesurees),
        plages: mesurees.length,
        journees: membres.reduce((s, x) => s + x.journees, 0),
        joursActivite: new Set(mesurees.map(x => x.p.date)).size,
        semaines: Math.max(1, jours) / 7,
        parJourSemaine: parJourSemaine.map(x => ({ minutes: x.minutes, journees: x.journees.size })),
        activites: pointageActivites(mesurees),
        moisMax: parMois[iMois] > 0 ? { i: iMois, minutes: parMois[iMois] } : null,
        semaineMax: semaineMax ? { lundi: semaineMax[0], minutes: semaineMax[1] } : null,
        journeeMax: journeeMax ? { membre: journeeMax.membre, ...journeeMax.record } : null
    };
};

// Histogramme d'une série, même composant que le tableau de bord (infobulle :
// bindBarChart). colonnes : { label, titre, minutes, sub, current, mineur }
const pointageChartHtml = (id, titre, colonnes, classe = '') => {
    const valeurs = colonnes.map(c => c.minutes / 60);
    const max = Math.max(0, ...valeurs);
    const iMax = valeurs.indexOf(max);
    const iCourant = colonnes.findIndex(c => c.current);
    const arret = iCourant >= 0 ? iCourant : iMax;
    const barres = colonnes.map((c, i) => {
        const valeur = twinFmtDuration(c.minutes);
        return {
            ...c,
            mesure: valeurs[i],
            valeur,
            focus: i === arret,
            etiquette: i === iMax && max > 0 ? valeur : ''
        };
    });
    return `
        <div class="dash-chart ptg-chart${classe ? ` ${classe}` : ''}" id="${id}" role="group" aria-label="${escapeHtml(titre)}" style="--cols:${colonnes.length}">${barChartContentHtml(barres, max, (v) => `${twinFmtInt(v)} h`)}
        </div>`;
};

// Tableau « Voir les données » d'un histogramme : heures et part de l'année
const pointageTableAnneeHtml = (cle, entete, colonnes) => `
    <details class="dash-table" data-dash-key="${cle}"${dashOpenAttr(cle)}>
        <summary>Voir les données</summary>
        <div class="dash-table-wrap">
            <table>
                <thead><tr><th scope="col">${escapeHtml(entete)}</th><th scope="col">Heures</th><th scope="col">Part</th></tr></thead>
                <tbody>${colonnes.map(c => `<tr><th scope="row">${escapeHtml(c.titre)}</th><td>${c.minutes > 0 ? escapeHtml(twinFmtDuration(c.minutes)) : '—'}</td><td>${c.minutes > 0 ? escapeHtml(c.part) : '—'}</td></tr>`).join('')}</tbody>
            </table>
        </div>
    </details>`;

// Vue Année : chiffres clés, personnes, mois, jours de la semaine, heures de la journée, activités, repères
const pointageAnneeHtml = (now) => {
    const today = toLocalDayKey(now.getTime());
    const anneeCourante = Number(today.slice(0, 4));
    const annee = pointageAnneeAffiche || anneeCourante;
    const a = buildPointageAnnee(annee, now);
    const avecHeures = a.membres.filter(x => x.minutes > 0);
    const nav = pointageNavHtml(String(annee), a.minutes > 0 ? `${twinFmtDuration(a.minutes)} · ${dashPlural(avecHeures.length, 'personne')}` : 'aucune heure saisie',
        annee === anneeCourante, { prec: 'Année précédente', suiv: 'Année suivante', retour: 'Cette année' });
    if (a.minutes === 0) {
        return `
            <section class="stock-section" aria-labelledby="ptgPeriodeTitle">
                ${nav}
                <div class="commande-empty">Aucune heure saisie en ${annee}.</div>
            </section>`;
    }
    const part = (minutes, sur = a.minutes) => {
        const pct = Math.round(minutes / sur * 100);
        return pct === 0 && minutes > 0 ? '< 1 %' : `${pct} %`;
    };
    const titreSection =(id, titre) => `<div class="stock-section-head"><h2 class="stock-section-title" id="${id}">${escapeHtml(titre)}</h2></div>`;

    // Chiffres clés
    const ecart = a.precedente > 0 ? Math.round((a.minutes - a.precedente) / a.precedente * 100) : null;
    const ecartTexte = ecart === null ? ''
        : `${ecart > 0 ? '+' : ecart < 0 ? '−' : '±'}${Math.abs(ecart)} % vs ${annee - 1}${a.enCours ? ' à la même date' : ''}`;
    const stats = [
        dashStatHtml('Heures', twinFmtDuration(a.minutes), ecartTexte),
        dashStatHtml('Journées travaillées', twinFmtInt(a.journees), dashPlural(a.joursActivite, "jour d'activité", "jours d'activité")),
        dashStatHtml('Moyenne par journée', twinFmtDuration(a.minutes / a.journees)),
        dashStatHtml('Moyenne par semaine', twinFmtDuration(a.minutes / a.semaines), dashPlural(Math.round(a.semaines), 'semaine')),
        dashStatHtml('Plages', twinFmtInt(a.plages), `moyenne ${twinFmtDuration(a.minutes / a.plages)}`)
    ].join('');

    // Par personne : total, journées, moyenne, part, bande des douze mois
    const maxMois = Math.max(1, ...a.membres.flatMap(x => x.parMois));
    const personne = (x) => {
        const sub = x.minutes > 0
            ? [dashPlural(x.journees, 'journée'), `moyenne ${twinFmtDuration(x.minutes / x.journees)}`, part(x.minutes)].join(' · ')
            : 'Aucune heure cette année';
        const barre = (v, i) => `<span class="ptg-strip-day${i === a.moisCourant ? ' is-today' : ''}" title="${escapeHtml(`${dashCapitalize(pointageMoisNom(annee, i))} : ${v > 0 ? twinFmtDuration(v) : '—'}`)}"><span class="ptg-strip-bar" style="--h:${v > 0 ? Math.max(0.06, v / maxMois).toFixed(3) : 0}"></span></span>`;
        return `
            <li class="ptg-month-row">
                <div class="ptg-row">
                    ${pointageAvatarHtml(x.membre)}
                    <span class="ptg-row-main">
                        <span class="ptg-row-name">${escapeHtml(x.membre.nom)}${x.membre.actif ? '' : '<span class="stock-tag">inactif</span>'}</span>
                        <span class="ptg-row-sub">${escapeHtml(sub)}</span>
                    </span>
                    <strong class="ptg-month-total">${x.minutes > 0 ? escapeHtml(twinFmtDuration(x.minutes)) : '—'}</strong>
                </div>
                ${x.minutes > 0 ? `
                    <div class="ptg-strip" style="--ptg-jours:12" aria-hidden="true">${x.parMois.map(barre).join('')}</div>
                    <div class="ptg-year-strip-x" aria-hidden="true">${a.moisCles.map((_, i) => `<span>${escapeHtml(pointageMoisNom(annee, i, 'narrow'))}</span>`).join('')}</div>` : ''}
            </li>`;
    };

    // Par mois : histogramme de l'équipe, détail par personne dans l'infobulle et le tableau
    const qui = (i) => avecHeures.filter(x => x.parMois[i] > 0).sort((p, q) => q.parMois[i] - p.parMois[i])
        .map(x => `${x.membre.nom.split(' ')[0]} ${twinFmtDuration(x.parMois[i])}`).join(' · ');
    const colonnesMois = a.moisCles.map((m, i) => ({
        label: pointageMoisNom(annee, i, 'short').replace('.', ''),
        titre: dashCapitalize(`${pointageMoisNom(annee, i)} ${annee}`),
        minutes: a.parMois[i],
        sub: [qui(i), i === a.moisCourant ? 'mois en cours' : ''].filter(Boolean).join(' · '),
        current: i === a.moisCourant
    }));
    const moisLien = (m, i) => {
        const nom = escapeHtml(dashCapitalize(pointageMoisNom(annee, i)));
        return m <= today.slice(0, 7) ? `<button type="button" class="ptg-year-link" data-click="pointage-voir-mois" data-mois="${m}">${nom}</button>` : nom;
    };
    const duree = (minutes) => (minutes > 0 ? escapeHtml(twinFmtDuration(minutes)) : '—');
    const tableMois = `
        <details class="dash-table" data-dash-key="ptg-annee-mois"${dashOpenAttr('ptg-annee-mois')}>
            <summary>Voir les données</summary>
            <div class="dash-table-wrap">
                <table>
                    <thead><tr><th scope="col">Mois</th>${avecHeures.map(x => `<th scope="col">${escapeHtml(x.membre.nom)}</th>`).join('')}<th scope="col">Total</th></tr></thead>
                    <tbody>${a.moisCles.map((m, i) => `<tr><th scope="row">${moisLien(m, i)}</th>${avecHeures.map(x => `<td>${duree(x.parMois[i])}</td>`).join('')}<td><strong>${duree(a.parMois[i])}</strong></td></tr>`).join('')}</tbody>
                    <tfoot><tr><th scope="row">Total</th>${avecHeures.map(x => `<td>${duree(x.minutes)}</td>`).join('')}<td>${duree(a.minutes)}</td></tr></tfoot>
                </table>
            </div>
        </details>`;

    const colonnesJours = a.parJourSemaine.map((x, i) => ({
        label: POINTAGE_JOURS_SEMAINE[i].slice(0, 3).toLowerCase(),
        titre: POINTAGE_JOURS_SEMAINE[i],
        minutes: x.minutes,
        part: part(x.minutes),
        sub: x.minutes > 0 ? `${dashPlural(x.journees, 'journée')} · ${part(x.minutes)}` : ''
    }));
    const colonnesHeures = a.parHeure.map((minutes, h) => ({
        label: h % 3 === 0 ? `${h} h` : '',
        mineur: h % 6 !== 0,
        titre: `${h} h – ${h + 1} h`,
        minutes,
        part: part(minutes),
        sub: minutes > 0 ? part(minutes) : ''
    }));

    // Activités citées dans les notes, puis repères de l'année
    const top = a.activites.slice(0, 10);
    const autres = a.activites.length - top.length;
    const activitesHtml = top.length ? `
        <section class="stock-section" aria-labelledby="ptgAnneeActTitle">
            ${titreSection('ptgAnneeActTitle', 'Activités')}
            <div class="stock-group ptg-year-card">
                <ol class="dash-rank-list">${top.map(x => `
                    <li class="dash-rank-row">
                        <span class="dash-rank-label"><span class="dash-rank-name">${escapeHtml(x.libelle)}</span></span>
                        <span class="dash-rank-value">${escapeHtml(dashPlural(x.plages, 'plage'))}<small> · ${escapeHtml(part(x.plages, a.plages))}</small></span>
                        <span class="dash-rank-track" aria-hidden="true"><span class="dash-rank-bar" style="width:${(x.plages / top[0].plages * 100).toFixed(1)}%"></span></span>
                    </li>`).join('')}
                </ol>
                ${autres > 0 ? `<p class="dash-muted dash-rank-more">${escapeHtml(`+ ${dashPlural(autres, 'autre activité', 'autres activités')}`)}</p>` : ''}
            </div>
        </section>` : '';
    const jourCourt = (date) => dashDayShort(new Date(`${date}T12:00:00`));
    const reperes = [
        a.moisMax ? ['Mois le plus chargé', `${dashCapitalize(pointageMoisNom(annee, a.moisMax.i))} · ${twinFmtDuration(a.moisMax.minutes)}`] : null,
        a.semaineMax ? ['Semaine la plus chargée', `${jourCourt(a.semaineMax.lundi)} – ${jourCourt(pointageJourDecale(a.semaineMax.lundi, 6))} · ${twinFmtDuration(a.semaineMax.minutes)}`] : null,
        a.journeeMax ? ['Plus longue journée', `${a.journeeMax.membre.nom} · ${pointageJourCourt(a.journeeMax.date)} · ${twinFmtDuration(a.journeeMax.minutes)}`] : null
    ].filter(Boolean);

    return `
        <section class="stock-section" aria-labelledby="ptgPeriodeTitle">
            ${nav}
            <div class="stock-group ptg-year-card"><div class="dash-stats ptg-year-stats">${stats}</div></div>
        </section>
        <section class="stock-section" aria-labelledby="ptgAnneePersTitle">
            ${titreSection('ptgAnneePersTitle', 'Par personne')}
            <div class="stock-group"><ul class="ptg-month-list">${a.membres.map(personne).join('')}</ul></div>
        </section>
        <section class="stock-section" aria-labelledby="ptgAnneeMoisTitle">
            ${titreSection('ptgAnneeMoisTitle', 'Par mois')}
            <div class="stock-group ptg-year-card">
                ${pointageChartHtml('ptgChartMois', `Heures par mois en ${annee}`, colonnesMois, 'ptg-chart--mois')}
                ${tableMois}
            </div>
        </section>
        <div class="ptg-year-grid">
            <section class="stock-section" aria-labelledby="ptgAnneeJoursTitle">
                ${titreSection('ptgAnneeJoursTitle', 'Jours de la semaine')}
                <div class="stock-group ptg-year-card">
                    ${pointageChartHtml('ptgChartJours', `Heures par jour de la semaine en ${annee}`, colonnesJours)}
                    ${pointageTableAnneeHtml('ptg-annee-jours', 'Jour', colonnesJours)}
                </div>
            </section>
            <section class="stock-section" aria-labelledby="ptgAnneeHeuresTitle">
                ${titreSection('ptgAnneeHeuresTitle', 'Heures de la journée')}
                <div class="stock-group ptg-year-card">
                    ${pointageChartHtml('ptgChartHeures', `Heures travaillées selon l'heure de la journée en ${annee}`, colonnesHeures)}
                    ${pointageTableAnneeHtml('ptg-annee-heures', 'Heure', colonnesHeures)}
                </div>
            </section>
        </div>
        <div class="ptg-year-grid">
            ${activitesHtml}
            <section class="stock-section" aria-labelledby="ptgAnneeRepTitle">
                ${titreSection('ptgAnneeRepTitle', 'Repères')}
                <div class="stock-group ptg-year-card">
                    <dl class="ptg-year-records">${reperes.map(([dt, dd]) => `<div><dt>${escapeHtml(dt)}</dt><dd>${escapeHtml(dd)}</dd></div>`).join('')}</dl>
                </div>
            </section>
        </div>`;
};

// Mois choisi depuis la vue Année : il s'ouvre dans la vue Mois
const pointageVoirMois = (mois) => {
    if (!/^\d{4}-\d{2}$/.test(mois)) return;
    const courant = getLocalDateISOString().slice(0, 7);
    DB.setFilter('pointage_vue', 'mois');
    pointageMoisAffiche = mois >= courant ? null : mois;
    renderPointage();
    document.getElementById('ptgPeriodeTitle')?.scrollIntoView({ block: 'center' });
};

// Pointage view
const renderPointage = () => {
    const now = new Date();
    const today = toLocalDayKey(now.getTime());
    const filtre = DB.getFilter('pointage_vue');
    const vue = filtre === 'mois' || filtre === 'annee' ? filtre : 'semaine';
    const pointages = DB.get('pointages') || [];
    const actifs = (DB.get('employees') || []).filter(e => e.actif);
    const vide = actifs.length === 0 && pointages.length === 0;

    const segment = (value, label) => `<button type="button" class="segment${vue === value ? ' active' : ''}" data-click="pointage-vue" data-value="${value}" aria-pressed="${vue === value}">${label}</button>`;
    const saisir = actifs.length ? '<button type="button" class="btn btn-primary" data-click="pointage-saisir">+ Saisir des heures</button>' : '';
    const actions = vue === 'semaine'
        ? `${actifs.length ? '<button type="button" class="btn btn-secondary" data-click="pointage-maintenant-modal">Pointer maintenant</button>' : ''}${saisir}`
        : `<button type="button" class="btn btn-secondary" data-click="pointage-import">Importer Excel</button><button type="button" class="btn btn-secondary" data-click="pointage-export">Exporter Excel</button>${saisir}`;
    const contenu = {
        semaine: () => `${pointageEnCoursHtml(pointages, now)}${pointageSemaineHtml(now)}`,
        mois: () => pointageMoisHtml(now),
        annee: () => pointageAnneeHtml(now)
    }[vue];

    safeRender(`
        <div class="ptg">
            ${vide ? '' : pageToolbar(actions, `<div class="segmented-filter" role="group" aria-label="Période affichée">${segment('semaine', 'Semaine')}${segment('mois', 'Mois')}${segment('annee', 'Année')}</div>`)}
            ${vide ? `
                <div class="empty-state">
                    <p>Aucun employé pour l'instant. Ajoutez l'équipe dans Paramètres › Employés pour saisir des heures.</p>
                    <a href="#parametres" class="btn btn-primary">Paramètres</a>
                </div>` : contenu()}
        </div>
    `);
    document.querySelector('#content .ptg-plages')?.addEventListener('toggle', (e) => {
        DB.setFilter('pointage_plages', e.target.open ? 'open' : '');
    });
    if (vue === 'annee') {
        document.querySelectorAll('#content .ptg-chart').forEach(bindBarChart);
        bindDetailsMemoire();
    }
    startPointageTicker(today);
};

// Durées « en cours » mises à jour toutes les 30 s ; nouveau jour → nouveau rendu
const startPointageTicker = (jour) => {
    clearInterval(pointageTicker);
    pointageTicker = setInterval(() => {
        const root = document.querySelector('#content .ptg');
        if (!root) {
            // L'utilisateur a quitté la page
            clearInterval(pointageTicker);
            pointageTicker = null;
            return;
        }
        if (getLocalDateISOString() !== jour) {
            renderPointage();
            return;
        }
        root.querySelectorAll('[data-ptg-depuis]').forEach(el => {
            el.textContent = twinFmtDuration((Date.now() - Number(el.getAttribute('data-ptg-depuis'))) / 60000);
        });
    }, 30000);
};

const pointageNaviguer = (dir) => {
    const today = getLocalDateISOString();
    const vue = DB.getFilter('pointage_vue');
    if (vue === 'annee') {
        const courant = Number(today.slice(0, 4));
        const cible = dir ? (pointageAnneeAffiche || courant) + dir : courant;
        pointageAnneeAffiche = cible >= courant ? null : cible;
    } else if (vue === 'mois') {
        const courant = today.slice(0, 7);
        const cible = dir ? pointageMoisDecale(pointageMoisAffiche || courant, dir) : courant;
        pointageMoisAffiche = cible >= courant ? null : cible;
    } else {
        const courant = pointageLundi(today);
        const cible = dir ? pointageJourDecale(pointageLundiAffiche || courant, 7 * dir) : courant;
        pointageLundiAffiche = cible >= courant ? null : cible;
    }
    renderPointage();
};

// Après un enregistrement depuis la page Pointage, afficher la période du jour saisi
const pointageAfficherJour = (date) => {
    if (window.location.hash.slice(1).split('?')[0] !== 'pointage') return;
    const today = getLocalDateISOString();
    const lundi = pointageLundi(date);
    pointageLundiAffiche = lundi >= pointageLundi(today) ? null : lundi;
    const mois = date.slice(0, 7);
    pointageMoisAffiche = mois >= today.slice(0, 7) ? null : mois;
    const annee = Number(date.slice(0, 4));
    pointageAnneeAffiche = annee >= Number(today.slice(0, 4)) ? null : annee;
};

// --- Fenêtre « Heures de travail » : les plages d'une personne pour un jour ---
const pointagePlageHtml = (p = {}) => {
    const id = p.id || '';
    const pause = Number(p.pause) || 0;
    return `
        <div class="ptg-plage"${id ? ` data-id="${escapeHtml(id)}"` : ''}${id && !p.heureFin ? ' data-ouvert="1"' : ''}>
            <div class="ptg-plage-heures">
                <label class="ptg-field"><span>Début</span><input type="time" name="debut" value="${escapeHtml(p.heureDebut || '')}"></label>
                <label class="ptg-field"><span>Fin</span><input type="time" name="fin" value="${escapeHtml(p.heureFin || '')}"></label>
                <label class="ptg-field ptg-field--pause"><span>Pause (min)</span><input type="number" name="pause" min="0" step="1" inputmode="numeric" placeholder="0" value="${pause > 0 ? pause : ''}"></label>
                <button type="button" class="ptg-plage-del" data-click="pointage-plage-suppr" aria-label="Retirer cette plage">${dashIcon('croix')}</button>
            </div>
            <label class="ptg-field ptg-field--note"><span class="dash-sr">Note</span><input type="text" name="note" maxlength="200" placeholder="Note (facultatif)" value="${escapeHtml(p.notes || '')}"></label>
            <p class="ptg-plage-info" data-role="info"></p>
        </div>`;
};

const lirePlageJour = (row) => {
    const val = (name) => (row.querySelector(`[name="${name}"]`)?.value || '').trim();
    const debut = val('debut');
    const fin = val('fin');
    const pause = val('pause');
    const note = val('note');
    return { row, id: row.getAttribute('data-id') || '', ouvert: row.hasAttribute('data-ouvert'), debut, fin, pause, note, rempli: !!(debut || fin || pause || note) };
};

const showPointageJourModal = ({ employeId = '', date = '', focusId = '' } = {}) => {
    const employees = DB.get('employees') || [];
    const actifs = employees.filter(e => e.actif);
    const memo = DB.getFilter('pointage_employe');
    const empId = employeId || (actifs.some(e => e.id === memo) ? memo : actifs[0]?.id) || '';
    if (!empId) {
        showToast('Ajoutez d\'abord un employé dans Paramètres', 'error');
        return;
    }
    const today = getLocalDateISOString();
    const options = employees
        .filter(e => e.actif || e.id === empId)
        .map(e => ({ id: e.id, nom: `${e.prenom || ''} ${e.nom || ''}`.trim() || 'Employé' }));
    if (!employees.some(e => e.id === empId)) options.push({ id: empId, nom: 'Employé supprimé' });

    modal.show('Heures de travail', `
        <form id="pointageJourForm" class="ptg-form" novalidate>
            <div class="form-row">
                <div class="form-group">
                    <label for="ptgEmploye">Employé</label>
                    <select id="ptgEmploye" name="employeId" data-change="pointage-jour-cible">
                        ${options.map(o => `<option value="${escapeHtml(o.id)}"${o.id === empId ? ' selected' : ''}>${escapeHtml(o.nom)}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label for="ptgDate">Jour</label>
                    <input type="date" id="ptgDate" name="date" value="${escapeHtml(date || today)}" max="${today}" data-change="pointage-jour-cible">
                </div>
            </div>
            <div class="ptg-plages" id="ptgPlages"></div>
            <button type="button" class="btn btn-ghost btn-sm ptg-add" data-click="pointage-plage-ajout">+ Ajouter une plage</button>
            <p class="ptg-form-total" id="ptgTotal" aria-live="polite"></p>
        </form>
    `, `
        <button type="button" class="btn btn-secondary" data-click="close-modal">Annuler</button>
        <button type="button" class="btn btn-primary" data-click="save-pointage-jour">Enregistrer</button>
    `);
    const form = document.getElementById('pointageJourForm');
    form?.addEventListener('input', majPointageJourTotal);
    // Entrée dans un champ : enregistrer la journée
    form?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing || !e.target.matches?.('input')) return;
        e.preventDefault();
        savePointageJour();
    });
    chargerPlagesJour({ focusId, focus: true });
};

// Charge les plages enregistrées de la personne et du jour choisis ; les plages
// ajoutées et pas encore enregistrées restent dans la fenêtre
const chargerPlagesJour = ({ focusId = '', focus = false } = {}) => {
    const form = document.getElementById('pointageJourForm');
    const zone = document.getElementById('ptgPlages');
    if (!form || !zone) return;
    const empId = form.elements.employeId.value;
    const date = form.elements.date.value;
    const nouvelles = [...zone.querySelectorAll('.ptg-plage:not([data-id])')].filter(row => lirePlageJour(row).rempli);
    const existantes = (DB.get('pointages') || [])
        .filter(p => p.employeId === empId && p.date === date)
        .sort(pointageParDebut);
    form.dataset.charges = existantes.map(p => p.id).join(',');
    zone.innerHTML = existantes.map(pointagePlageHtml).join('');
    nouvelles.forEach(row => zone.appendChild(row));
    if (!zone.querySelector('.ptg-plage')) zone.insertAdjacentHTML('beforeend', pointagePlageHtml());
    majPointageJourTotal();
    if (!focus) return;
    // Focus sur la plage demandée ou restée ouverte, sinon la première à remplir.
    // La transition d'ouverture rend la fenêtre visible un peu plus tard : on réessaie après.
    const rows = [...zone.querySelectorAll('.ptg-plage')];
    const cible = focusId ? rows.find(row => row.getAttribute('data-id') === focusId) : rows.find(row => row.hasAttribute('data-ouvert'));
    const input = cible
        ? cible.querySelector(cible.querySelector('[name="fin"]').value ? '[name="debut"]' : '[name="fin"]')
        : [...zone.querySelectorAll('[name="debut"]')].find(i => !i.value);
    if (!input) return;
    setTimeout(() => {
        input.focus();
        if (document.activeElement !== input) setTimeout(() => input.focus(), 250);
    }, 0);
};

// Durée de chaque plage et total de la journée, à chaque saisie
const majPointageJourTotal = () => {
    const form = document.getElementById('pointageJourForm');
    if (!form) return;
    const date = form.elements.date.value;
    let total = 0;
    form.querySelectorAll('.ptg-plage').forEach(row => {
        const l = lirePlageJour(row);
        const debut = parseHHMM(l.debut);
        const fin = parseHHMM(l.fin);
        const pause = Number(l.pause || 0);
        let info = '';
        if (debut !== null && fin !== null && fin !== debut) {
            const minutes = computePointageMinutes(debut, fin, Number.isInteger(pause) && pause > 0 ? pause : 0);
            if (minutes === null) {
                info = 'La pause dépasse la durée de la plage';
            } else {
                total += minutes;
                info = `${twinFmtDuration(minutes)}${fin < debut ? ' · se termine le lendemain' : ''}`;
            }
        } else if (debut !== null && !l.fin && l.ouvert) {
            info = pointageOubli({ date, heureDebut: l.debut, heureFin: '' }) ? 'Départ non saisi' : 'En cours';
        }
        const el = row.querySelector('[data-role="info"]');
        if (el) el.textContent = info;
    });
    const el = document.getElementById('ptgTotal');
    if (el) el.textContent = total > 0 ? `Total de la journée : ${twinFmtDuration(total)}` : '';
};

const ajouterPlageJour = () => {
    const zone = document.getElementById('ptgPlages');
    if (!zone) return;
    zone.insertAdjacentHTML('beforeend', pointagePlageHtml());
    zone.lastElementChild?.querySelector('[name="debut"]')?.focus();
    majPointageJourTotal();
};

// Une plage enregistrée et retirée ici est supprimée à l'enregistrement
const retirerPlageJour = (btn) => {
    const zone = document.getElementById('ptgPlages');
    btn.closest('.ptg-plage')?.remove();
    if (zone && !zone.querySelector('.ptg-plage')) zone.insertAdjacentHTML('beforeend', pointagePlageHtml());
    majPointageJourTotal();
    document.querySelector('#pointageJourForm .ptg-add')?.focus();
};

const savePointageJour = () => {
    const form = document.getElementById('pointageJourForm');
    if (!form) return;
    const now = new Date();
    const today = getLocalDateISOString();
    const employeId = form.elements.employeId.value;
    const date = form.elements.date.value;
    const erreur = (message, row, champ) => {
        showToast(message, 'error');
        (row?.querySelector(`[name="${champ}"]`) || (champ === 'date' ? form.elements.date : null))?.focus();
    };
    if (!employeId) return erreur('Choisissez un employé');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isValidDateOnly(date)) return erreur('Choisissez le jour travaillé', null, 'date');
    if (date > today) return erreur('Les heures d\'un jour à venir ne peuvent pas encore être saisies', null, 'date');

    // Contrôle de chaque plage
    const plages = [];
    for (const l of [...form.querySelectorAll('.ptg-plage')].map(lirePlageJour).filter(x => x.rempli)) {
        const debut = parseHHMM(l.debut);
        const fin = l.fin ? parseHHMM(l.fin) : null;
        const pause = Number(l.pause || 0);
        if (debut === null) return erreur('Indiquez l\'heure de début de chaque plage', l.row, 'debut');
        if (!l.fin && !l.ouvert) return erreur(`Indiquez l'heure de fin de la plage commencée à ${l.debut}`, l.row, 'fin');
        if (l.fin && fin === null) return erreur('Heure de fin invalide', l.row, 'fin');
        if (fin !== null && fin === debut) return erreur(`La plage ${l.debut} – ${l.fin} est vide`, l.row, 'fin');
        if (!Number.isInteger(pause) || pause < 0) return erreur('La pause doit être un nombre entier de minutes', l.row, 'pause');
        if (fin !== null && computePointageMinutes(debut, fin, pause) === null) {
            return erreur(`La pause dépasse la durée de la plage ${l.debut} – ${l.fin}`, l.row, 'pause');
        }
        plages.push({ row: l.row, id: l.id, heureDebut: l.debut, heureFin: l.fin, pause, notes: l.note });
    }

    // Relecture au moment d'enregistrer : seules les plages chargées dans la
    // fenêtre peuvent être supprimées, celles ajoutées ailleurs entre-temps restent
    const toutes = DB.get('pointages') || [];
    const charges = new Set((form.dataset.charges || '').split(',').filter(Boolean));
    if (plages.some(pl => pl.id && !toutes.some(p => p.id === pl.id))) {
        showToast('Cette journée a été modifiée sur un autre appareil : vérifiez les plages puis enregistrez à nouveau', 'error');
        chargerPlagesJour();
        return;
    }
    if (plages.length === 0 && charges.size === 0) return erreur('Saisissez au moins une plage (début et fin)', form.querySelector('.ptg-plage'), 'debut');

    // Chevauchements avec les autres plages de la personne (veille, jour et lendemain)
    const voisins = pointageJoursVoisins(date);
    const elements = [
        ...plages.map(pl => ({ p: { ...pl, date }, saisie: true, row: pl.row })),
        ...toutes.filter(p => p.employeId === employeId && voisins.includes(p.date) && !charges.has(p.id)).map(p => ({ p, saisie: false }))
    ].map(x => ({ ...x, iv: pointageIntervalle(x.p, date, now) })).filter(x => x.iv);
    for (const a of elements.filter(x => x.saisie)) {
        const b = elements.find(x => x !== a && pointageIntervallesChevauchent(x.iv, a.iv));
        if (b) {
            const jour = b.p.date !== date ? ` du ${formatDate(b.p.date)}` : '';
            return erreur(`La plage ${pointagePlageLabel(a.p)} chevauche la plage ${pointagePlageLabel(b.p)}${jour}`, a.row, 'debut');
        }
    }

    const gardes = new Set(plages.map(pl => pl.id).filter(Boolean));
    const suivantes = toutes.filter(p => !charges.has(p.id) || gardes.has(p.id));
    plages.forEach(pl => {
        const rec = pl.id ? suivantes.find(p => p.id === pl.id) : null;
        const champs = { employeId, date, heureDebut: pl.heureDebut, heureFin: pl.heureFin, pause: pl.pause };
        if (pl.notes || rec?.notes) champs.notes = pl.notes;
        if (rec) Object.assign(rec, champs);
        else suivantes.push({ id: generateId(), ...champs });
    });
    DB.set('pointages', suivantes);

    DB.setFilter('pointage_employe', employeId);
    modal.hide();
    const minutes = plages.reduce((s, pl) => s + pointageDuree({ ...pl, date }, now), 0);
    const nom = form.elements.employeId.selectedOptions[0]?.textContent || 'Employé';
    showToast(plages.length
        ? `${nom} : ${twinFmtDuration(minutes)} le ${pointageJourLabel(date)}`
        : `Plages du ${pointageJourLabel(date)} supprimées`);
    pointageAfficherJour(date);
    renderCurrentView();
};

const cloturerPointage = (id) => {
    const p = (DB.get('pointages') || []).find(x => x.id === id);
    if (!p) {
        showToast('Pointage non trouvé', 'error');
        return;
    }
    showPointageJourModal({ employeId: p.employeId, date: p.date, focusId: p.id });
};

// Arrivée / départ à l'heure actuelle, pour chaque employé actif
const showPointerMaintenantModal = () => {
    const today = getLocalDateISOString();
    const pointages = DB.get('pointages') || [];
    const row = (m) => {
        const enCours = findPointageEnCours(pointages, m.id, today);
        return `
            <li class="dash-member">
                ${pointageAvatarHtml(m, !!enCours)}
                <span class="dash-member-main">
                    <span class="dash-member-name">${escapeHtml(m.nom)}</span>
                    <span class="dash-member-sub">${escapeHtml(enCours ? `En cours depuis ${enCours.heureDebut}` : 'Pas de plage en cours')}</span>
                </span>
                <button type="button" class="btn btn-sm ${enCours ? 'btn-secondary' : 'btn-primary'}" data-click="pointage-maintenant" data-id="${escapeHtml(m.id)}" data-sens="${enCours ? 'depart' : 'arrivee'}"
                    aria-label="${escapeHtml(`${enCours ? 'Pointer le départ' : 'Pointer l\'arrivée'} de ${m.nom}`)}">${enCours ? 'Départ' : 'Arrivée'}</button>
            </li>`;
    };
    modal.show('Pointer maintenant', `<ul class="dash-team">${pointageEquipe([]).map(row).join('')}</ul>`,
        '<button type="button" class="btn btn-secondary" data-click="close-modal">Fermer</button>');
};

// Feuille « Détail » d'un relevé : une ligne par plage, par date, employé et début
const pointageDetailRows = (plages, nom, now) => [...plages]
    .sort((a, b) => a.date.localeCompare(b.date) || nom(a).localeCompare(nom(b), 'fr') || pointageParDebut(a, b))
    .map(p => {
        const minutes = pointageDuree(p, now);
        return {
            'Date': formatDate(p.date),
            'Jour': pointageJourLabel(p.date, { weekday: 'long' }),
            'Employé': nom(p),
            'Début': p.heureDebut || '',
            'Fin': p.heureFin || (pointageOubli(p, now) ? 'non saisie' : 'en cours'),
            'Pause (min)': Number(p.pause) || 0,
            'Durée': twinFmtDuration(minutes),
            'Durée (h)': pointageHeuresDecimal(minutes),
            'Note': p.notes || ''
        };
    });

// Relevé de l'année affichée : synthèse, mois par personne, activités et détail des plages
const exportPointagesAnnee = () => {
    if (typeof XLSX === 'undefined') {
        showToast('Erreur: Bibliothèque Excel non chargée', 'error');
        return;
    }
    const now = new Date();
    const annee = pointageAnneeAffiche || Number(getLocalDateISOString().slice(0, 4));
    const a = buildPointageAnnee(annee, now);
    const heures = pointageHeuresDecimal;
    const feuille = (rows) => XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ Information: 'Aucune heure saisie' }]);
    const avecHeures = a.membres.filter(x => x.minutes > 0);
    const ligne = (nom, x) => ({
        'Employé': nom,
        'Heures': twinFmtDuration(x.minutes),
        'Heures (décimal)': heures(x.minutes),
        'Journées': x.journees,
        'Moyenne par journée': x.journees ? twinFmtDuration(x.minutes / x.journees) : '',
        'Plages': x.plages,
        'Part (%)': a.minutes ? Math.round(x.minutes / a.minutes * 1000) / 10 : 0
    });
    const synthese = avecHeures.map(x => ligne(x.membre.nom, x));
    if (avecHeures.length > 1) synthese.push(ligne('Total', a));
    const parMois = a.moisCles.map((_, i) => {
        const row = { 'Mois': dashCapitalize(pointageMoisNom(annee, i)) };
        avecHeures.forEach(x => { row[`${x.membre.nom} (h)`] = heures(x.parMois[i]); });
        row['Total (h)'] = heures(a.parMois[i]);
        return row;
    });
    const noms = new Map(a.membres.map(x => [x.membre.id, x.membre.nom]));
    const nom = (p) => noms.get(p.employeId) || POINTAGE_MEMBRE_INCONNU.nom;
    const plages = (DB.get('pointages') || []).filter(p => p.date >= `${annee}-01-01` && p.date <= `${annee}-12-31`);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, feuille(synthese), 'Synthèse');
    XLSX.utils.book_append_sheet(wb, feuille(parMois), 'Par mois');
    if (a.activites.length) XLSX.utils.book_append_sheet(wb, feuille(a.activites.map(x => ({ 'Activité': x.libelle, 'Plages': x.plages }))), 'Activités');
    XLSX.utils.book_append_sheet(wb, feuille(pointageDetailRows(plages, nom, now)), 'Détail');
    XLSX.writeFile(wb, `pointages_${annee}.xlsx`);
    showToast('Export Excel des heures réussi');
};

// Relevé du mois affiché : synthèse par personne et détail des plages
const exportPointagesMois = () => {
    if (typeof XLSX === 'undefined') {
        showToast('Erreur: Bibliothèque Excel non chargée', 'error');
        return;
    }
    const now = new Date();
    const mois = pointageMoisAffiche || getLocalDateISOString().slice(0, 7);
    const m = buildPointageMois(mois, now);
    const heures = pointageHeuresDecimal;
    const feuille = (rows) => XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ Information: 'Aucune heure saisie' }]);
    const avecHeures = m.membres.filter(x => x.minutes > 0);
    const synthese = avecHeures.map(x => ({
        'Employé': x.membre.nom,
        'Journées': x.journees,
        'Heures': twinFmtDuration(x.minutes),
        'Heures (décimal)': heures(x.minutes),
        'Depuis janvier (h)': heures(x.annee)
    }));
    if (avecHeures.length > 1) {
        synthese.push({
            'Employé': 'Total',
            'Journées': m.journees,
            'Heures': twinFmtDuration(m.minutes),
            'Heures (décimal)': heures(m.minutes),
            'Depuis janvier (h)': heures(avecHeures.reduce((s, x) => s + x.annee, 0))
        });
    }
    const noms = new Map(m.membres.map(x => [x.membre.id, x.membre.nom]));
    const nom = (p) => noms.get(p.employeId) || POINTAGE_MEMBRE_INCONNU.nom;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, feuille(synthese), 'Synthèse');
    XLSX.utils.book_append_sheet(wb, feuille(pointageDetailRows(m.plages, nom, now)), 'Détail');
    XLSX.writeFile(wb, `pointages_${mois}.xlsx`);
    showToast('Export Excel des heures réussi');
};

// --- Import Excel des heures (v13.4) ---
// Classeur tenu à la main : une ligne par plage avec la date, la personne,
// l'heure de début et l'heure de fin, plus au besoin une pause et une
// description (reprise en note). Les colonnes sont reconnues par leur en-tête,
// sur la première feuille qui a une date, un début et une fin ; le relevé
// exporté par l'application se relit de la même façon. Chaque personne du
// fichier est rattachée à un employé (par défaut celui qui porte ce nom).
// L'import ne fait qu'ajouter des plages : une plage déjà enregistrée (même
// employé, jour, début et fin) est sautée, une plage qui en chevauche une
// autre (enregistrée, ou plus haut dans le fichier) aussi ; rien n'est modifié
// ni supprimé. Un fichier complété depuis peut donc être réimporté.

const POINTAGE_IMPORT_NOUVEAU = '__nouveau__';
let pointageImport = null; // fichier analysé : { fichier, feuille, lignes, selection }

// Texte comparable : minuscules, sans accents ni ponctuation
const ptgImportNorm = (v) => String(v ?? '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const ptgImportVide = (cell) => !cell || cell.t === 'e' || cell.v === null || cell.v === undefined || String(cell.v).trim() === '';
const ptgImportTexte = (cell) => (ptgImportVide(cell) ? '' : String(typeof cell.v === 'string' ? cell.v : (cell.w ?? cell.v)).trim());

// Jour AAAA-MM-JJ : date Excel (numéro de série) ou texte « 18.05.2026 »,
// « 18/05/26 », « 2026-05-18 ». '' si la cellule est vide, null si illisible.
const ptgImportJour = (cell, date1904 = false) => {
    if (ptgImportVide(cell)) return '';
    let y; let m; let d;
    if (typeof cell.v === 'number') {
        const jour = new Date((date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)) + Math.floor(cell.v) * 86400000);
        [y, m, d] = [jour.getUTCFullYear(), jour.getUTCMonth() + 1, jour.getUTCDate()];
    } else if (cell.v instanceof Date) {
        [y, m, d] = [cell.v.getFullYear(), cell.v.getMonth() + 1, cell.v.getDate()];
    } else {
        const s = String(cell.v).trim();
        const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
        const ch = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})$/.exec(s);
        if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
        else if (ch) [y, m, d] = [Number(ch[3]) + (ch[3].length === 2 ? 2000 : 0), Number(ch[2]), Number(ch[1])];
        else return null;
    }
    const jour = new Date(y, m - 1, d, 12);
    return y >= 2000 && y <= 2100 && jour.getMonth() === m - 1 && jour.getDate() === d ? toLocalDayKey(jour.getTime()) : null;
};

// Heure HH:MM : fraction de jour Excel (1 = 24:00, gardé comme une fin à minuit,
// 00:00) ou texte « 9:10 », « 09.10 h », « 9h10 », « 9h ». '' si vide, null si illisible.
const ptgImportHeure = (cell) => {
    if (ptgImportVide(cell)) return '';
    let minutes;
    if (typeof cell.v === 'number') {
        // Au-delà d'un jour, seule une date avec heure (numéro de série) porte une heure
        if (!(cell.v >= 0) || (cell.v > 1 && cell.v < 1000)) return null;
        minutes = Math.round((cell.v - Math.floor(cell.v)) * 1440) % 1440;
    } else if (cell.v instanceof Date) {
        minutes = cell.v.getHours() * 60 + cell.v.getMinutes();
    } else {
        const m = /^(\d{1,2})\s*(?:[:.h]\s*(\d{2}))?(?:[:.]\d{2})?\s*h?$/i.exec(String(cell.v).trim());
        const total = m ? Number(m[1]) * 60 + Number(m[2] || 0) : NaN;
        if (!m || Number(m[2] || 0) > 59 || !(total <= 1440)) return null;
        minutes = total % 1440;
    }
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};

// Pause en minutes : nombre de minutes, fraction de jour (< 1) ou texte
// « 30 », « 30 min », « 0:30 ». 0 si vide, null si illisible.
const ptgImportPause = (cell) => {
    if (ptgImportVide(cell)) return 0;
    if (typeof cell.v === 'number') return cell.v >= 0 ? Math.round(cell.v < 1 ? cell.v * 1440 : cell.v) : null;
    const min = /^(\d+)\s*(?:min|mn|m)?$/i.exec(String(cell.v).trim());
    if (min) return Number(min[1]);
    const h = ptgImportHeure(cell);
    return h ? parseHHMM(h) : null;
};

// Colonnes d'une ligne d'en-tête ; null s'il y manque la date, le début ou la fin
const ptgImportColonnes = (ws, r, range) => {
    const entetes = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
        entetes.push({ c, h: ptgImportNorm(ptgImportTexte(ws[XLSX.utils.encode_cell({ r, c })])) });
    }
    const col = (re) => entetes.find(x => x.h && re.test(x.h))?.c ?? -1;
    const cols = {
        date: col(/^(date|jour)\b/),
        debut: col(/\b(debut|arrivee|entree)\b/),
        fin: col(/\b(fin|depart|sortie)\b/),
        employe: col(/\b(employe|employee|personne|collaborat\w*)\b/),
        prenom: col(/\bprenom\b/),
        nom: col(/^nom\b/),
        id: col(/^id$/),
        pause: col(/\bpause\b/),
        note: col(/\b(description|notes?|remarques?|commentaires?|taches?|activites?)\b/)
    };
    return cols.date >= 0 && cols.debut >= 0 && cols.fin >= 0 ? cols : null;
};

// Lignes sous l'en-tête ; celles sans date ni heures (vides, formules sans
// valeur, totaux) sont ignorées, les autres gardent leur numéro de ligne Excel
const ptgImportLignes = (ws, r0, range, cols, date1904) => {
    const lignes = [];
    for (let r = r0 + 1; r <= range.e.r; r++) {
        const cell = (c) => (c >= 0 ? ws[XLSX.utils.encode_cell({ r, c })] : undefined);
        const texte = (c) => ptgImportTexte(cell(c));
        if ([cols.date, cols.debut, cols.fin].every(c => ptgImportVide(cell(c)))) continue;
        const personne = texte(cols.employe) || [texte(cols.prenom), texte(cols.nom)].filter(Boolean).join(' ')
            || (texte(cols.id) ? `ID ${texte(cols.id)}` : '');
        const date = ptgImportJour(cell(cols.date), date1904);
        const heureDebut = ptgImportHeure(cell(cols.debut));
        const heureFin = ptgImportHeure(cell(cols.fin));
        const pause = ptgImportPause(cell(cols.pause));
        let erreur = '';
        if (date === '') erreur = 'date manquante';
        else if (date === null) erreur = 'date illisible';
        else if (!personne) erreur = 'personne manquante';
        else if (heureDebut === '') erreur = 'heure de début manquante';
        else if (heureDebut === null) erreur = 'heure de début illisible';
        else if (heureFin === '') erreur = 'heure de fin manquante';
        else if (heureFin === null) erreur = 'heure de fin illisible';
        else if (heureDebut === heureFin) erreur = 'plage vide';
        else if (pause === null) erreur = 'pause illisible';
        else if (computePointageMinutes(parseHHMM(heureDebut), parseHHMM(heureFin), pause) === null) erreur = 'pause plus longue que la plage';
        lignes.push({
            ligne: r + 1, personne, cle: ptgImportNorm(personne),
            date: date || '', heureDebut: heureDebut || '', heureFin: heureFin || '', pause: pause || 0,
            notes: texte(cols.note), erreur
        });
    }
    return lignes;
};

// Feuille d'heures d'un classeur : la première dont une des 20 premières lignes
// est un en-tête reconnu ; null si aucune
const analyserPointagesExcel = (wb) => {
    const date1904 = !!wb.Workbook?.WBProps?.date1904;
    for (const feuille of wb.SheetNames) {
        const ws = wb.Sheets[feuille];
        if (!ws?.['!ref']) continue;
        const range = XLSX.utils.decode_range(ws['!ref']);
        for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 19); r++) {
            const cols = ptgImportColonnes(ws, r, range);
            if (cols) return { feuille, lignes: ptgImportLignes(ws, r, range, cols, date1904) };
        }
    }
    return null;
};

// Employé d'une personne du fichier : même nom complet, sinon même prénom,
// sinon même nom de famille (actifs d'abord) ; '' si aucun
const ptgImportCorrespondance = (personne, employees) => {
    const cle = ptgImportNorm(personne);
    if (!cle) return '';
    const n = ptgImportNorm;
    const tries = [...employees.filter(e => e.actif), ...employees.filter(e => !e.actif)];
    return (tries.find(e => n(`${e.prenom || ''} ${e.nom || ''}`) === cle || n(`${e.nom || ''} ${e.prenom || ''}`) === cle)
        || tries.find(e => n(e.prenom) === cle)
        || tries.find(e => n(e.nom) === cle))?.id || '';
};

// Sort de chaque ligne, pour un choix d'employés (clé de la personne → id, ''
// pour ne pas importer) et les plages enregistrées `toutes` : nouvelles,
// déjà enregistrées, chevauchements, à corriger, ignorées
const planPointageImport = (lignes, choix, toutes, now = new Date()) => {
    const today = toLocalDayKey(now.getTime());
    const parJour = new Map();
    const ranger = (p) => {
        const k = `${p.employeId}|${p.date}`;
        if (!parJour.has(k)) parJour.set(k, []);
        parJour.get(k).push(p);
    };
    toutes.forEach(ranger);
    const plan = { nouvelles: [], presentes: [], conflits: [], incompletes: [], ecartees: [] };
    lignes.forEach(l => {
        // Personne non importée : ses lignes sont ignorées, même incomplètes
        const employeId = choix.get(l.cle) || '';
        if (l.cle && !employeId) {
            plan.ecartees.push(l);
            return;
        }
        if (l.erreur || l.date > today) {
            plan.incompletes.push({ ...l, motif: l.erreur || 'jour à venir' });
            return;
        }
        const plage = { employeId, date: l.date, heureDebut: l.heureDebut, heureFin: l.heureFin, pause: l.pause };
        if (l.notes) plage.notes = l.notes;
        const voisines = pointageJoursVoisins(l.date)
            .flatMap(d => parJour.get(`${employeId}|${d}`) || []);
        if (voisines.some(p => p.date === l.date && p.heureDebut === l.heureDebut && p.heureFin === l.heureFin)) {
            plan.presentes.push(l);
            return;
        }
        const iv = pointageIntervalle(plage, l.date, now);
        const autre = voisines.find(p => {
            const j = pointageIntervalle(p, l.date, now);
            return j && pointageIntervallesChevauchent(j, iv);
        });
        if (autre) {
            plan.conflits.push({ ...l, avec: autre });
            return;
        }
        plan.nouvelles.push({ ligne: l, plage });
        ranger({ ...plage, ligneFichier: l.ligne });
    });
    return plan;
};

// Menu de chaque personne : clé → valeur choisie ; puis employé visé (un
// nouvel employé est propre à chaque personne)
const lireSelectionImport = (form) => new Map([...form.querySelectorAll('select[data-cle]')]
    .map(s => [s.getAttribute('data-cle'), s.value]));
const choixImport = (selection) => new Map([...selection]
    .map(([cle, v]) => [cle, v === POINTAGE_IMPORT_NOUVEAU ? `${POINTAGE_IMPORT_NOUVEAU}${cle}` : v]));

// Champ de fichier commun au bouton de la page et à la palette
const ouvrirImportPointages = () => {
    let input = document.getElementById('pointageImportFile');
    if (!input) {
        input = document.createElement('input');
        input.type = 'file';
        input.id = 'pointageImportFile';
        input.accept = '.xlsx,.xlsm,.xls,.ods,.csv';
        input.hidden = true;
        input.setAttribute('data-change', 'pointage-import-fichier');
        document.body.appendChild(input);
    }
    input.click();
};

const lirePointagesExcel = async (input) => {
    const fichier = input.files?.[0];
    input.value = ''; // le même fichier, complété, pourra être choisi à nouveau
    if (!fichier) return;
    if (typeof XLSX === 'undefined') {
        showToast('Erreur: Bibliothèque Excel non chargée', 'error');
        return;
    }
    let analyse;
    try {
        analyse = analyserPointagesExcel(XLSX.read(await fichier.arrayBuffer(), { type: 'array' }));
    } catch (e) {
        console.error('Import des heures :', e);
        showToast('Fichier illisible', 'error');
        return;
    }
    if (!analyse) {
        showToast('Aucune feuille avec les colonnes Date, Heure début et Heure fin', 'error');
        return;
    }
    if (analyse.lignes.length === 0) {
        showToast('Aucune heure dans ce fichier', 'warning');
        return;
    }
    pointageImport = { fichier: fichier.name, ...analyse, selection: null };
    showPointageImportModal();
};

// Fenêtre « Importer des heures » : personnes du fichier et employé de chacune,
// puis le bilan de l'import
const showPointageImportModal = () => {
    const imp = pointageImport;
    if (!imp) return;
    const employees = DB.get('employees') || [];
    const tries = [...employees.filter(e => e.actif), ...employees.filter(e => !e.actif)];
    const nomDe = (e) => `${e.prenom || ''} ${e.nom || ''}`.trim() || 'Employé';
    const personnes = [];
    imp.lignes.forEach(l => {
        if (!l.cle) return;
        const p = personnes.find(x => x.cle === l.cle);
        if (p) p.lignes++;
        else personnes.push({ cle: l.cle, nom: l.personne, lignes: 1 });
    });
    personnes.sort((a, b) => b.lignes - a.lignes);
    const dates = imp.lignes.map(l => l.date).filter(Boolean).sort();
    const periode = dates.length ? `${formatDate(dates[0])} – ${formatDate(dates[dates.length - 1])}` : '';
    const personneHtml = (p) => {
        const defaut = ptgImportCorrespondance(p.nom, employees);
        const valeurs = new Set(['', ...employees.map(e => e.id), ...(defaut ? [] : [POINTAGE_IMPORT_NOUVEAU])]);
        const memo = imp.selection?.get(p.cle);
        const choisi = memo !== undefined && valeurs.has(memo) ? memo : defaut;
        const option = (value, label) => `<option value="${escapeHtml(value)}"${value === choisi ? ' selected' : ''}>${escapeHtml(label)}</option>`;
        return `
            <li class="ptg-row ptg-import-person">
                <span class="ptg-row-main">
                    <span class="ptg-row-name">${escapeHtml(p.nom)}</span>
                    <span class="ptg-row-sub" data-role="sub"></span>
                </span>
                <select data-cle="${escapeHtml(p.cle)}" data-change="pointage-import-personne" aria-label="${escapeHtml(`Employé pour ${p.nom}`)}">
                    ${option('', 'Ne pas importer')}
                    ${tries.map(e => option(e.id, `${nomDe(e)}${e.actif ? '' : ' (inactif)'}`)).join('')}
                    ${defaut ? '' : option(POINTAGE_IMPORT_NOUVEAU, `Nouvel employé « ${p.nom} »`)}
                </select>
            </li>`;
    };
    modal.show('Importer des heures', `
        <form id="pointageImportForm" class="ptg-import" novalidate>
            <p class="ptg-import-file">
                <strong>${escapeHtml(imp.fichier)}</strong>
                <span>${escapeHtml([imp.feuille, dashPlural(imp.lignes.length, 'ligne'), periode].filter(Boolean).join(' · '))}</span>
            </p>
            ${personnes.length ? `<ul class="ptg-list ptg-import-people">${personnes.map(personneHtml).join('')}</ul>` : ''}
            <dl class="ptg-import-bilan" id="ptgImpBilan"></dl>
            <div id="ptgImpVerifier"></div>
        </form>
    `, `
        <button type="button" class="btn btn-secondary" data-click="close-modal">Annuler</button>
        <button type="button" class="btn btn-primary ptg-import-ok" id="ptgImpOk" data-click="pointage-import-confirmer">Importer</button>
    `);
    majPointageImport();
};

// Bilan recalculé à chaque choix, sur les plages enregistrées à cet instant
const majPointageImport = () => {
    const imp = pointageImport;
    const form = document.getElementById('pointageImportForm');
    if (!imp || !form) return;
    const now = new Date();
    imp.selection = lireSelectionImport(form);
    const plan = planPointageImport(imp.lignes, choixImport(imp.selection), DB.get('pointages') || [], now);
    const duree = (liste) => twinFmtDuration(liste.reduce((s, x) => s + pointageDuree(x.plage, now), 0));
    form.querySelectorAll('select[data-cle]').forEach(sel => {
        const cle = sel.getAttribute('data-cle');
        const sub = sel.closest('.ptg-import-person')?.querySelector('[data-role="sub"]');
        if (!sub) return;
        const siennes = plan.nouvelles.filter(x => x.ligne.cle === cle);
        sub.textContent = !sel.value
            ? dashPlural(imp.lignes.filter(l => l.cle === cle).length, 'ligne')
            : siennes.length ? `${dashPlural(siennes.length, 'plage')} · ${duree(siennes)}` : 'Rien de nouveau';
    });

    const rang = (label, valeur) => `<div class="ptg-import-bilan-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(valeur)}</dd></div>`;
    const bilan = document.getElementById('ptgImpBilan');
    if (bilan) {
        bilan.innerHTML = [
            rang('À importer', plan.nouvelles.length ? `${dashPlural(plan.nouvelles.length, 'plage')} · ${duree(plan.nouvelles)}` : 'aucune plage'),
            plan.presentes.length ? rang('Déjà enregistrées', twinFmtInt(plan.presentes.length)) : '',
            plan.conflits.length ? rang('Chevauchements', twinFmtInt(plan.conflits.length)) : '',
            plan.incompletes.length ? rang('À corriger', twinFmtInt(plan.incompletes.length)) : '',
            plan.ecartees.length ? rang('Ignorées', dashPlural(plan.ecartees.length, 'ligne')) : ''
        ].join('');
    }

    // Chevauchements et lignes à corriger, dans l'ordre du fichier
    const chevauche = (l) => {
        const p = l.avec;
        const quand = p.date !== l.date ? ` du ${formatDate(p.date)}` : '';
        return p.ligneFichier
            ? `chevauche la ligne ${p.ligneFichier} (${pointagePlageLabel(p)}${quand})`
            : `chevauche la plage ${pointagePlageLabel(p)}${quand} déjà enregistrée`;
    };
    const items = [
        ...plan.conflits.map(l => ({ l, motif: chevauche(l) })),
        ...plan.incompletes.map(l => ({ l, motif: l.motif }))
    ].sort((a, b) => a.l.ligne - b.l.ligne);
    const zone = document.getElementById('ptgImpVerifier');
    if (zone) {
        const ouvert = !!zone.querySelector('details')?.open;
        zone.innerHTML = items.length ? `
            <details class="ptg-import-details"${ouvert ? ' open' : ''}>
                <summary>Lignes à vérifier <span class="stock-section-meta">${twinFmtInt(items.length)}</span></summary>
                <ul class="ptg-import-issues">${items.map(({ l, motif }) => `
                    <li>
                        <span>${escapeHtml([`Ligne ${l.ligne}`, l.personne, l.date ? formatDate(l.date) : '', l.heureDebut && l.heureFin ? `${l.heureDebut} – ${l.heureFin}` : ''].filter(Boolean).join(' · '))}</span>
                        <span class="ptg-import-issue-why">${escapeHtml(motif)}</span>
                    </li>`).join('')}
                </ul>
            </details>` : '';
    }

    const ok = document.getElementById('ptgImpOk');
    if (ok) {
        ok.disabled = plan.nouvelles.length === 0;
        ok.textContent = plan.nouvelles.length ? `Importer ${dashPlural(plan.nouvelles.length, 'plage')}` : 'Importer';
    }
};

const importerPointagesExcel = () => {
    const imp = pointageImport;
    const form = document.getElementById('pointageImportForm');
    if (!imp || !form) return;
    const now = new Date();
    const selection = lireSelectionImport(form);
    // Relecture au moment d'importer : les employés et les plages ajoutés ou
    // retirés entre-temps (ici ou sur un autre appareil) sont pris en compte
    const employees = DB.get('employees') || [];
    if ([...selection.values()].some(v => v && v !== POINTAGE_IMPORT_NOUVEAU && !employees.some(e => e.id === v))) {
        showToast('Un employé choisi a été supprimé sur un autre appareil : vérifiez les correspondances', 'error');
        imp.selection = selection;
        showPointageImportModal();
        return;
    }
    const toutes = DB.get('pointages') || [];
    const plan = planPointageImport(imp.lignes, choixImport(selection), toutes, now);
    if (plan.nouvelles.length === 0) {
        showToast('Aucune nouvelle plage à importer', 'warning');
        majPointageImport();
        return;
    }
    // Nouveaux employés : seulement ceux qui ont des plages à importer
    const crees = new Map();
    plan.nouvelles.forEach(({ ligne, plage }) => {
        if (!plage.employeId.startsWith(POINTAGE_IMPORT_NOUVEAU) || crees.has(plage.employeId)) return;
        const [prenom, ...nom] = ligne.personne.split(/\s+/);
        crees.set(plage.employeId, { id: generateId(), nom: nom.join(' '), prenom, actif: true });
    });
    if (crees.size > 0 && !DB.set('employees', [...employees, ...crees.values()])) return;
    const nouvelles = plan.nouvelles.map(({ plage }) => ({
        id: generateId(), ...plage, employeId: crees.get(plage.employeId)?.id || plage.employeId
    }));
    if (!DB.set('pointages', [...toutes, ...nouvelles])) return;

    pointageImport = null;
    modal.hide();
    showToast([
        dashPlural(nouvelles.length, 'plage importée', 'plages importées'),
        crees.size ? dashPlural(crees.size, 'employé créé', 'employés créés') : ''
    ].filter(Boolean).join(' · '));
    pointageAfficherJour(nouvelles.reduce((max, p) => (p.date > max ? p.date : max), ''));
    renderCurrentView();
};

const deletePointage = (id) => {
    const p = (DB.get('pointages') || []).find(x => x.id === id);
    if (!p) return;
    confirmDialog(`Supprimer la plage ${pointagePlageLabel(p)} du ${formatDate(p.date)} ?`, { danger: true, confirmLabel: 'Supprimer' }).then(ok => {
        if (!ok) return;
        // Relecture après la confirmation : une saisie faite entre-temps ailleurs est conservée
        DB.set('pointages', (DB.get('pointages') || []).filter(x => x.id !== id));
        showToast('Plage supprimée');
        renderCurrentView();
    });
};
