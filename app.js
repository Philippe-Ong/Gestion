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

// V11 — Online listener: s'il y a queue, bootstrap ou schéma non prêt,
// appelle v11BootFirebase() (qui sérialise via _bootPromise), sinon flush.
// Ne déclenche jamais loadFromFirebase legacy pour une queue v11 pending.
// GARDE stricte : si non authentifié, sortir immédiatement sans réinitialiser
// Firebase — le SDK est déjà chargé, c'est juste l'utilisateur qui n'est pas
// connecté. Initialiser dynamiquement UNIQUEMENT si les objets SDK n'existent pas.
if (!window.__v11OnlineListenerRegistered) {
    window.__v11OnlineListenerRegistered = true;
    window.addEventListener('online', async () => {
        // Si pas authentifié, rien à synchroniser
        if (!window.firebaseReady) {
            // SDK jamais chargé (module script a échoué) → tenter init
            // pour permettre une reconnexion ultérieure
            if (!window.firebaseDb && !window.firebaseAuth) {
                await window.initFirebase?.();
            }
            return; // Jamais de V11 sans session
        }
        const queue = v11GetQueue();
        const needsBoot = queue.length > 0 || V11._bootstrapping || V11._migrating || !V11._isReady;
        if (needsBoot) {
            console.log('[V11] Online — boot nécessaire (queue=' + queue.length + ', bootstrapping=' + V11._bootstrapping + ', isReady=' + V11._isReady + ')');
            v11BootFirebase();
        } else if (V11._isReady) {
            console.log('[V11] Online — déclenchement du flush');
            setTimeout(() => v11FlushQueue(), 100);
        }
    });
}

// =============================================================================
// Authentification — Login / Logout
// =============================================================================

// Connexion : appelée depuis le formulaire de l'écran de verrouillage.
// Lit le mot de passe saisi, appelle Firebase Auth (email technique fixe),
// affiche les erreurs en français sans révéler l'adresse email.
window.handleLogin = async () => {
    const passwordInput = document.getElementById('loginPassword');
    const errorEl = document.getElementById('loginError');
    const busyEl = document.getElementById('loginBusy');
    const btn = document.getElementById('loginBtn');

    if (!passwordInput) return;

    // Si le SDK Auth n'a jamais été chargé (module script a échoué),
    // tenter un init dynamique avant d'abandonner
    if (!window.firebaseAuth) {
        try {
            await window.initFirebase?.();
        } catch (_) {}
        if (!window.firebaseAuth) {
            // Auth toujours indisponible même après tentative
            if (errorEl) { errorEl.textContent = 'Service d\'authentification indisponible. Vérifiez votre connexion réseau.'; errorEl.style.display = 'block'; }
            return;
        }
    }

    const password = passwordInput.value;
    if (!password || !password.trim()) {
        if (errorEl) { errorEl.textContent = 'Veuillez saisir le mot de passe.'; errorEl.style.display = 'block'; }
        passwordInput.focus();
        return;
    }

    // État « en cours »
    if (errorEl) { errorEl.textContent = ''; errorEl.style.display = 'none'; }
    if (busyEl) busyEl.style.display = 'flex';
    if (btn) btn.style.display = 'none';
    passwordInput.disabled = true;

    try {
        await window.firebaseAuth.signIn(password);
        // Le callback onAuthStateChanged dans le module Firebase gère la suite
        // (masquer l'écran, lancer l'app)
    } catch (e) {
        // Restaurer le formulaire
        passwordInput.disabled = false;
        if (busyEl) busyEl.style.display = 'none';
        if (btn) btn.style.display = 'inline-flex';
        passwordInput.focus();
        passwordInput.select();

        // Traduire les erreurs Firebase en français sans révéler l'email technique
        const code = e?.code || '';
        let message = 'Erreur de connexion.';
        if (code === 'auth/wrong-password' || code === 'auth/invalid-credential' || code === 'auth/user-not-found') {
            message = 'Mot de passe incorrect.';
        } else if (code === 'auth/too-many-requests') {
            message = 'Trop de tentatives. Réessayez plus tard.';
        } else if (code === 'auth/network-request-failed' || code === 'auth/internal-error') {
            message = 'Erreur réseau. Vérifiez votre connexion.';
        } else if (code === 'auth/invalid-email') {
            message = 'Identifiant invalide.';
        } else {
            message = 'Erreur de connexion. Vérifiez votre mot de passe et votre réseau.';
        }
        if (errorEl) { errorEl.textContent = message; errorEl.style.display = 'block'; }
        console.error('[Login]', code, e?.message);
    }
};

// Déconnexion : délègue tout le nettoyage au callback onAuthStateChanged
// via resetAppSession(). SignOut() déclenche le callback user=null qui
// exécute resetAppSession (idempotent). handleLogout n'effectue aucun
// cleanup manuel — plus de duplication ni de double incrément.
window.handleLogout = async () => {
    const ok = await confirmDialog('Voulez-vous vraiment vous déconnecter ?', {
        danger: true,
        confirmLabel: 'Se déconnecter',
        cancelLabel: 'Annuler',
        title: 'Déconnexion'
    });
    if (!ok) return;

    // La déconnexion Firebase Auth déclenche onAuthStateChanged(user=null)
    // dont le callback appelle resetAppSession() qui nettoie tout
    // (firebaseReady, _appStarted, sessionGen, listeners, contenu, login).
    // Aucun cleanup manuel ici — resetAppSession est idempotent.
    if (window.firebaseAuth) {
        try {
            await window.firebaseAuth.signOut();
        } catch (e) {
            console.error('[Logout]', e);
            showToast('Erreur lors de la déconnexion. Réessayez.', 'error');
        }
    } else {
        // Pas de Firebase — réinitialisation manuelle
        resetAppSession();
    }
};

// Attacher les écouteurs de l'écran de connexion (appelé au démarrage)
const initLoginListeners = () => {
    const btn = document.getElementById('loginBtn');
    if (btn) btn.addEventListener('click', window.handleLogin);

    const passwordInput = document.getElementById('loginPassword');
    if (passwordInput) {
        passwordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                window.handleLogin();
            }
        });
    }

    // Bouton Déconnexion dans l'en-tête
    const logoutHeaderBtn = document.getElementById('logoutBtnHeader');
    if (logoutHeaderBtn) {
        logoutHeaderBtn.addEventListener('click', window.handleLogout);
    }
};

// Exposer v11StopAllListeners pour le module Firebase Auth
window.v11StopAllListeners = v11StopAllListeners;

// =============================================================================
// Verrouillage/déverrouillage du shell — zéro flash, zéro exposition aux
// lecteurs d'écran avant authentification.
// =============================================================================
const lockShell = () => {
    document.body.classList.add('body--locked');
    // Inerter le shell pour les lecteurs d'écran
    document.querySelector('.sidebar')?.setAttribute('aria-hidden', 'true');
    document.querySelector('.main-content')?.setAttribute('aria-hidden', 'true');
    document.querySelector('.bottom-nav')?.setAttribute('aria-hidden', 'true');
};
const unlockShell = () => {
    document.body.classList.remove('body--locked');
    document.querySelector('.sidebar')?.removeAttribute('aria-hidden');
    document.querySelector('.main-content')?.removeAttribute('aria-hidden');
    document.querySelector('.bottom-nav')?.removeAttribute('aria-hidden');
};
// Exposer pour le module Firebase et initFirebase dynamique
window.lockShell = lockShell;
window.unlockShell = unlockShell;

// =============================================================================
// Reset centralisé et idempotent de session — appelé par les deux callbacks
// onAuthStateChanged (module index + fallback initFirebase) quand user === null.
// Garantit : _appStarted=false, incrément unique de session, stop listeners,
// nettoyage du contenu métier, verrouillage shell/login, unhide sync.
// Le garde-fou _resetLock évite le double traitement lors d'un logout volontaire
// où signOut() et handleLogout bis se chevaucheraient.
// =============================================================================
let _resetLock = false;
const resetAppSession = () => {
    if (_resetLock) return;
    _resetLock = true;

    // 1. Flag d'état — invalide toute session
    window.firebaseReady = false;
    window._appStarted = false;
    _appSessionGen++;

    // 2. Arrêt des listeners temps réel et debounce
    v11StopAllListeners();
    if (V11._debounceTimer) { clearTimeout(V11._debounceTimer); V11._debounceTimer = null; }
    V11._pendingRender = false;

    // 3. Verrouillage du shell (aria-hidden + body--locked)
    lockShell();

    // 4. Nettoyage du contenu métier
    const content = document.getElementById('content');
    if (content) content.innerHTML = '';
    window.location.hash = '';

    // 5. Cacher le bouton Déconnexion dans l'en-tête
    const logoutBtn = document.getElementById('logoutBtnHeader');
    if (logoutBtn) logoutBtn.style.display = 'none';

    // 6. Afficher l'écran de verrouillage, réinitialiser le formulaire
    const loginScreen   = document.getElementById('loginScreen');
    const loginLoading  = document.getElementById('loginLoading');
    const loginForm     = document.getElementById('loginForm');
    const loginPassword = document.getElementById('loginPassword');
    const loginError    = document.getElementById('loginError');
    const loginBusy     = document.getElementById('loginBusy');
    const loginBtn      = document.getElementById('loginBtn');

    if (loginPassword) { loginPassword.value = ''; loginPassword.disabled = false; }
    if (loginError)    { loginError.textContent = ''; loginError.style.display = 'none'; }
    if (loginBusy)     loginBusy.style.display = 'none';
    if (loginBtn)      loginBtn.style.display = 'inline-flex';
    if (loginLoading)  loginLoading.style.display = 'none';
    if (loginForm)     loginForm.style.display = 'block';
    if (loginScreen)   loginScreen.style.display = 'flex';

    // 7. Cacher le bouton Sync
    const syncBtn = document.getElementById('syncBtn');
    if (syncBtn) syncBtn.style.display = 'none';

    // Libérer le verrou après un délai pour absorber un éventuel
    // second appel dans la même séquence (ex. module + fallback)
    setTimeout(() => { _resetLock = false; }, 500);
};
// Exposée pour le module Firebase (index.html) qui ne peut pas accéder
// aux const de app.js, et pour le fallback initFirebase en cas de signOut
// sans callback (pas de Firebase disponible).
window.resetAppSession = resetAppSession;

// =============================================================================
// Démarrage de l'application (appelé après authentification)
// =============================================================================

// Rendu « local d'abord » : on affiche l'écran immédiatement à partir des données
// locales (localStorage), SANS attendre le réseau. Sinon, quand Firebase est lent
// (réseau mobile) le premier rendu est retardé et l'app démarre sur un dashboard
// vide — il faut retoucher un onglet pour qu'il s'affiche. La synchronisation
// Firebase se fait ensuite en arrière-plan, avec un re-rendu si des données arrivent.
const bootLocal = () => {
    DB.init();
    initGlobalSearch();
    initPaletteAndShortcuts();
    // Migration silencieuse : normalise les valeurs legacy de client.tarifs
    try { migrateClientTarifs(); } catch (e) { console.warn('[migration] initiale', e); }
    // Renumérote les anciens lots « _ab12… » en numéros séquentiels (idempotent)
    try { migrateLotNumeros(); } catch (e) { console.warn('[migration] lots', e); }
    // Ancien backup pré-synchro (synchro legacy) : sa restauration repoussait des
    // valeurs périmées vers le cloud ; il n'est plus créé ni restaurable.
    localStorage.removeItem('thecol_backup_pre_sync');
    // Bottom sheet listeners (idempotent au relogin)
    if (!window._bottomSheetListenersDone) {
        window._bottomSheetListenersDone = true;
        document.getElementById('moreNavBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            toggleBottomSheet();
        });
        document.getElementById('bottomSheetOverlay')?.addEventListener('click', closeBottomSheet);
        document.querySelectorAll('.bottom-sheet-item').forEach(item => {
            item.addEventListener('click', closeBottomSheet);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeBottomSheet();
        });
    }
    initEventDelegation();
    router();
};

const bootFirebaseSync = async () => {
    // V11 flow: migration + real-time listeners
    await v11BootFirebase();
};

// Fonction idempotente appelée par le module Firebase après authentification
// restaurée (session persistante) ou réussie (login). Exécute le rendu local
// puis la synchronisation Firebase en arrière-plan.
window.startApp = () => {
    // Éviter le double démarrage
    if (window._appStarted) return;

    // Garde-fu de sécurité : démarrer l'app exige une session Firebase active.
    // Si un appelant non authentifié (console, script tiers, ordre de boot
    // précoce) tente unlockShell()+startApp(), on réinitialise la session
    // de manière sûre (flag, listeners, contenu métier, verrouillage shell)
    // et on abandonne le boot pour empêcher l'affichage des données locales.
    if (window.firebaseReady !== true) {
        if (typeof window.resetAppSession === 'function') {
            window.resetAppSession();
        }
        return;
    }

    window._appStarted = true;

    // Attacher les écouteurs de connexion/déconnexion si pas déjà fait
    if (!window._loginListenersInitialized) {
        initLoginListeners();
        window._loginListenersInitialized = true;
    }

    // Rendre visible le bouton Déconnexion dans l'en-tête
    const logoutBtn = document.getElementById('logoutBtnHeader');
    if (logoutBtn) logoutBtn.style.display = 'inline-flex';

    // Boot local d'abord (rendu immédiat depuis localStorage)
    bootLocal();

    // Boot Firebase / V11 en arrière-plan
    bootFirebaseSync();
};

// --- Amorçage initial : attacher les écouteurs de connexion ---
// On les attache dès que le DOM est prêt pour que le formulaire soit
// fonctionnel quand le module Firebase le révèle.
// Le flag _loginListenersInitialized évite les doublons si startApp
// est appelé avant DOMContentLoaded (session persistée).
if (!window._loginListenersInitialized) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            if (!window._loginListenersInitialized) {
                initLoginListeners();
                window._loginListenersInitialized = true;
            }
        }, { once: true });
    } else {
        initLoginListeners();
        window._loginListenersInitialized = true;
    }
}
