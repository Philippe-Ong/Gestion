# AGENTS.md — ThéCol Gestion

Guidance for agentic coding agents working in this repository.

## Project Overview

ThéCol Gestion is a single-page business management app for a cold tea company. The entire UI is in French. It is hosted on GitHub Pages with **no build step, no bundler, and no framework**. The application logic relies entirely on vanilla JavaScript, HTML, and CSS.

## 1. Build, Lint, and Test Commands

There is **no build, lint, typecheck, or test pipeline**. The project has zero dependencies to install.

**Local Development:**
There is nothing to compile or bundle. To serve locally for manual testing:
```bash
npx http-server
# or
python -m http.server 8000
```
Open the printed URL in a browser.

**Validation & Testing Strategy:**
Because there are no automated tests:
1. **Running a Single Test:** You **cannot** run a single automated test. Instead, manually trigger functions in the browser console or add an isolated `<script>` block during development to verify data manipulation.
2. **Manual Verification:** Verify logic changes by reading adjacent functions and ensuring data structures match `SPEC.md`.
3. **Console Safety:** Wrap complex data manipulation in `try/catch` and use `console.error` to catch regressions without breaking the app flow.
4. **No Test Frameworks:** Do not attempt to run `npm test`, `jest`, or create `.test.js` files unless the user specifically requests to initialize a testing framework.

## 2. File Structure

| File | Role |
|------|------|
| `index.html` | Page shell, modal/toast containers, Firebase SDK init (inline module script). |
| `app.js` | All application logic: routing, views, data layer, modals, CRUD operations. |
| `styles.css` | All styling, CSS custom properties, responsive breakpoints. |
| `SPEC.md` | Data schemas and feature specifications. |
| `templates/` | Excel templates (e.g. `bl_template.xlsx`). |

No other files contain application logic. Do not create new JS or CSS files unless explicitly asked.

## 3. Architecture

### Routing
Hash-based SPA routing. Pages: `#dashboard`, `#stock`, `#pointage`, `#commandes`, `#livraisons`, `#production`, `#inventaire`, `#parametres`, `#archives`.
The `navigateTo(page)` function looks up the page name in a views map and calls the matching `render<Page>()` function, generating HTML and writing it to `#content` via `innerHTML`.

### View Pattern
Every page has a top-level `const render<Page> = () => { ... }` arrow function that:
1. Reads data from `DB.get(key)`.
2. Builds an HTML string with template literals.
3. Writes it to `document.getElementById('content').innerHTML`.
4. Attaches event listeners **after** rendering.

### UI Components
- **Modals:** `modal.show(title, bodyHtml, footerHtml)` / `modal.hide()`
- **Toasts:** `showToast(message, type)` where type is `'success'` | `'error'` | `'warning'`
- **Icons:** All SVG icons are inline `<svg>` elements (no icon library used).

## 4. Code Style & Guidelines

### JavaScript Formatting and Types
- **No ES Modules in `app.js`**: Loaded as a plain `<script>`. Firebase imports use dynamic `import()` or the inline `<script type="module">` in `index.html`.
- **Functions**: Use arrow functions for all declarations (`const fn = () => { }`).
- **Strings**: Use template literals (backticks) for all multi-line HTML strings. Maintain proper indentation.
- **Dates**: Format with Swiss French locale: `fr-CH` via `toLocaleDateString('fr-CH')`.
- **IDs**: Use `generateId()` — returns `'_' + Math.random().toString(36).substr(2, 9)`.
- **Comments**: Keep code clean. No comments unless the user asks for them.

### Error Handling
- Wrap JSON parsing and async operations in `try/catch` blocks.
- Log errors with `console.error('Descriptive prefix:', e)`.
- Return safe defaults on failure (e.g., `return []` for data reads).
- Show user-facing errors via `showToast('message', 'error')`.

### CSS Guidelines
- **Design Tokens:** All theme values are defined in `:root` in `styles.css:1-26`. Always use CSS variables — never hard-code colors or radii.
  - Examples: `--primary`, `--primary-dark`, `--danger`, `--bg`, `--radius`, `--shadow`.
- **Class Naming:** Use **BEM-like flat naming** (no nested BEM). Examples: `.btn`, `.btn-primary`, `.card`, `.card-header`.
- **Utility Classes:** Use provided utility classes in `styles.css` (e.g., `.flex`, `.flex-between`, `.gap-2`, `.text-center`, `.mt-4`).
- **Responsive Design:** Place responsive overrides inside existing `@media` blocks (tablet: `1024px`, mobile: `768px`) at the bottom of `styles.css`.

## 5. Data Layer

### localStorage (Main Database)
The `DB` object wraps `localStorage`. All keys are prefixed `thecol_` (e.g., `thecol_employees`, `thecol_commandes`).
- **Read:** `DB.get('lots')` — returns parsed array, defaults to `[]` on error.
- **Write:** `DB.set('lots', data)` — serializes to JSON, auto-syncs to Firebase if connected.

### Firebase (Optional Cloud Sync)
Optional cloud sync via Firestore. Config is in `index.html` inline script. Sync is manual.

## 6. Naming Conventions Summary

| Context | Convention | Example |
|---------|-----------|---------|
| JS functions | camelCase, arrow const | `const renderStock = () => {}` |
| JS variables | camelCase | `const totalBouteilles = ...` |
| CSS classes | lowercase, hyphen-separated | `.btn-primary`, `.stat-card` |
| CSS variables | `--kebab-case` | `--primary-dark`, `--bg-secondary` |
| Data keys | lowercase English | `'employees'`, `'commandes'`, `'lots'` |
| Status values | French with underscores | `'en_attente'`, `'livree'`, `'annulee'` |
| UI text | French | All labels, buttons, toasts, headings |
| Page routes | Lowercase French | `#commandes`, `#pointage`, `#parametres` |

## 7. Absolute Rules (CRITICAL)

- **All UI text MUST be in French** — labels, buttons, toasts, confirmations, headings, and error messages.
- **Zero Dependencies:** Do not introduce frameworks (React, Vue), build tools (Webpack, Vite), or npm packages.
- **Never commit secrets:** Firebase config in `index.html` is public (client-side SDK); do not add server keys.
- **Preserve the data schema:** Defined in `SPEC.md` — any new fields should be added as optional properties.
- **Stock Status Logic:** Auto-computed from DLC dates: `ok`, `warning` (< 1 month), `expired` (past).
- **Version Bump & Push:** After every functional change that affects the application, always increment the version badge in `index.html` (e.g. `v6.2` → `v6.3`) and push to the remote branch immediately. Never leave a completed feature or bugfix uncommitted or unpushed.