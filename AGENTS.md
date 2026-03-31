# AGENTS.md — ThéCol Gestion

Guidance for agentic coding agents working in this repository.

## Project Overview

ThéCol Gestion is a single-page business management app for a cold tea company. The entire UI is in French. It is hosted on GitHub Pages with no build step, no bundler, and no framework.

## Commands & Testing

There is **no build, lint, typecheck, or test pipeline**. The project has zero dependencies to install.

To serve locally for manual testing:
```bash
npx http-server
# or
python -m http.server 8000
```
Open the printed URL in a browser. There is nothing to compile or bundle.

### Validation & Testing Strategy
Because there are no automated tests:
1. **Manual Verification:** Verify logic changes by reading adjacent functions and ensuring data structures match `SPEC.md`.
2. **Console Safety:** Wrap complex data manipulation in `try/catch` and use `console.error` to catch regressions without breaking the app flow.
3. **No Test Frameworks:** Do not attempt to run `npm test`, `jest`, or create `.test.js` files unless specifically requested.

## File Structure

| File | Role |
|------|------|
| `index.html` | Page shell, modal/toast containers, Firebase SDK init (inline module script) |
| `app.js` | All application logic: routing, views, data layer, modals, CRUD operations |
| `styles.css` | All styling, CSS custom properties, responsive breakpoints |
| `SPEC.md` | Data schemas and feature specifications |
| `templates/` | Excel templates (e.g. `bl_template.xlsx`) |

No other files contain application logic. Do not create new JS or CSS files unless explicitly asked.

## Architecture

### Routing
Hash-based SPA routing. Pages: `#dashboard`, `#stock`, `#pointage`, `#commandes`, `#livraisons`, `#production`, `#inventaire`, `#parametres`, `#archives`.
The `navigateTo(page)` function looks up the page name in a views map and calls the matching `render<Page>()` function, generating HTML and writing it to `#content` via `innerHTML`.

### View Pattern
Every page has a top-level `const render<Page> = () => { ... }` arrow function that:
1. Reads data from `DB.get(key)`
2. Builds an HTML string with template literals
3. Writes it to `document.getElementById('content').innerHTML`
4. Attaches event listeners after rendering

### UI Components
- **Modals:** `modal.show(title, bodyHtml, footerHtml)` / `modal.hide()`
- **Toasts:** `showToast(message, type)` where type is `'success'` | `'error'` | `'warning'`
- **All SVG icons** are inline `<svg>` elements (no icon library)

## Code Style

### JavaScript Guidelines
- **No ES Modules in `app.js`**: Loaded as a plain `<script>`. Firebase imports use dynamic `import()` or the inline `<script type="module">` in `index.html`.
- **Functions**: Use arrow functions for all declarations (`const fn = () => { }`).
- **Naming**: Use **camelCase** for all JS identifiers (variables, functions, object properties).
- **Strings**: Use template literals (backticks) for all multi-line HTML strings. Maintain proper indentation.
- **IDs**: Use `generateId()` — returns `'_' + Math.random().toString(36).substr(2, 9)`.
- **Dates**: Format with Swiss French locale: `fr-CH` via `toLocaleDateString('fr-CH')`.
- **Comments**: Keep code clean. No comments unless the user asks for them.

### Error Handling
- Wrap JSON parsing and async operations in `try/catch`.
- Log errors with `console.error('Descriptive prefix:', e)`.
- Return safe defaults on failure (e.g., `return []` for data reads).
- Show user-facing errors via `showToast('message', 'error')`.

### CSS Guidelines

#### Design Tokens (CSS Custom Properties)
All theme values are defined in `:root` in `styles.css:1-26`. Always use these variables — never hard-code colors or radii.
- `--primary` (`#5D7B3E`), `--primary-dark` (`#4A6530`), `--primary-light` (`#8BA66B`), `--accent` (`#2C4A2E`)
- `--bg` (`#FAFBF7`), `--bg-secondary` (`#F5F7F2`)
- `--danger` (`#C0392B`), `--warning` (`#F39C12`), `--success` (`#27AE60`)
- `--radius` (`8px`), `--radius-lg` (`12px`)
- `--shadow` (`0 2px 8px rgba(0,0,0,0.08)`), `--transition` (`all 0.2s ease`)

#### Class Naming & Structure
- Use **BEM-like flat naming** (no nested BEM). Examples: `.btn`, `.btn-primary`, `.card`, `.card-header`.
- Utility classes are defined in `styles.css` (e.g., `.flex`, `.flex-between`, `.gap-2`, `.text-center`, `.mt-4`).
- Font sizes: 13px (small), 14px (standard), 15px (body), 18px (card titles), 22px (page headers), 28px (stats).
- Place responsive overrides inside existing `@media` blocks (tablet: `1024px`, mobile: `768px`) at the bottom of `styles.css`.

## Data Layer

### localStorage (Main Database)
The `DB` object wraps localStorage. All keys are prefixed `thecol_` (e.g., `thecol_employees`, `thecol_commandes`).
- **Read:** `DB.get('lots')` — returns parsed array, defaults to `[]` on error.
- **Write:** `DB.set('lots', data)` — serializes to JSON, auto-syncs to Firebase if connected.

### Firebase (Optional Cloud Sync)
Optional cloud sync via Firestore. Config is in `index.html` inline script. Sync is manual.

## Naming Conventions Summary

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

## Important Rules
- **All UI text must be in French** — labels, buttons, toasts, confirmations, headings, error messages.
- **Do not introduce frameworks, build tools, or npm packages** — this project intentionally uses vanilla HTML/CSS/JS.
- **Never commit secrets** — Firebase config in index.html is public (client-side SDK); do not add server keys.
- **Preserve the data schema** defined in `SPEC.md` — any new fields should be added as optional properties.
- **Stock status** is auto-computed from DLC dates: `ok`, `warning` (< 1 month), `expired` (past).
