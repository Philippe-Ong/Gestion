# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ThéCol Gestion** is a business management SPA for a cold tea company (ThéCol). It manages inventory (stock/lots), production planning, timekeeping (pointage), orders (commandes), and settings. The entire UI is in French. Hosted on GitHub Pages at https://philippe-ong.github.io/Gestion/.

## Tech Stack

- Vanilla HTML5/CSS3/JavaScript (ES6+) — no frameworks, no build step, no bundler
- Data persistence: localStorage (primary), Firebase Firestore (optional cloud sync)
- External libs loaded via CDN: XLSX (Excel export), Firebase SDK, Google Fonts (Outfit)

## Running Locally

No build process. Serve the root directory with any static server:

```bash
python -m http.server 8000
# or
npx http-server
```

There is no linter and no CI/CD pipeline. The closest thing to a test suite is `stress-test.js` (~850 lines), exposed as `window.StressTest`; trigger it from **Paramètres → 🔧 Outils de développement → Lancer le stress test**.

## Architecture

The entire app lives in four files at the root:

| File | Role |
|------|------|
| `index.html` | Page shell, modal/toast containers, Firebase SDK init |
| `app.js` (~5000 lines) | All application logic: routing, views, data, modals, CRUD, helpers |
| `styles.css` (~1900 lines) | All styling, CSS variables, responsive breakpoints |
| `stress-test.js` (~850 lines) | Manual stress/regression runner, attached as `window.StressTest` |

### Routing

Hash-based SPA routing (`#dashboard`, `#stock`, `#pointage`, `#commandes`, `#production`, `#inventaire`, `#parametres`). The `navigateTo(page)` function renders the corresponding view.

### Data Layer

The `DB` object wraps localStorage with `get(key)` / `set(key, value)` methods. All keys are prefixed `thecol_` (e.g., `thecol_lots`, `thecol_commandes`, `thecol_employees`, `thecol_aromes`, `thecol_formats`, `thecol_recettes`, `thecol_clients`, `thecol_pointages`, `thecol_inventaire`). Firebase sync is manual via a sync button. UI filter persistence goes through `DB.getFilter(name)` / `DB.setFilter(name, value)` which prefix keys with `thecol_filter_`.

### View Pattern

Each page has a `render<Page>()` function (e.g., `renderStock()`, `renderCommandes()`) that builds HTML and writes it to the main content area. Modal dialogs use `modal.show()` / `modal.hide()`. The modal traps focus and closes on Escape. Toast notifications use `showToast()` (the container is `aria-live="polite"`). Use `confirmDialog(message, { danger })` for confirmations and `setBusy(btn, label)` for loading states — never the native `confirm()` or `alert()`.

### Helpers

Top-of-file utilities to prefer over ad-hoc patterns:
- `escapeHtml(str)` — always wrap user-controlled text in template literals
- `getItems(cmd)` — null-safe `cmd.items || []` accessor
- `getActive(table)` — equivalent to `DB.get(table).filter(r => r.actif)`
- `parseHHMM(str)` — parse `"HH:MM"` to minutes-since-midnight, returns `null` if invalid
- `CONSTANTS` — central object holding production buffers (`PRODUCTION_LOSS`, `CAPSULE_LOSS`), `CUVE_MAX_L`, `STOCK_WARN_DAYS`

### Data Schemas

Defined in `SPEC.md`. Key entities: employees, aromes, formats, recettes (recipes with ingredients-per-litre), clients, lots (stock batches with DLV/DLC dates), commandes (orders with line items), pointages (timesheets).

## Key Conventions

- IDs are generated with `generateId()` (uses `crypto.randomUUID()` when available, with a timestamp+random fallback)
- Dates formatted with Swiss French locale (`fr-CH`)
- Production planner aggregates orders by date range, calculates litres per arome, then applies recipes to compute required ingredients
- Stock statuses are auto-computed from DLC dates: OK, < 1 mois, Expiré
- The Inventaire tab tracks consumables (consommables) and equipment (équipement) with stock alert thresholds
