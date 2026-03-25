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

There are no tests, no linter, and no CI/CD pipeline.

## Architecture

The entire app lives in three files at the root:

| File | Role |
|------|------|
| `index.html` | Page shell, modal/toast containers, Firebase SDK init |
| `app.js` (~2900 lines) | All application logic: routing, views, data, modals, CRUD |
| `styles.css` (~1450 lines) | All styling, CSS variables, responsive breakpoints |

### Routing

Hash-based SPA routing (`#dashboard`, `#stock`, `#pointage`, `#commandes`, `#production`, `#inventaire`, `#parametres`). The `navigateTo(page)` function renders the corresponding view.

### Data Layer

The `DB` object wraps localStorage with `get(key)` / `set(key, value)` methods. All keys are prefixed `thecol_` (e.g., `thecol_lots`, `thecol_commandes`, `thecol_employees`, `thecol_aromes`, `thecol_formats`, `thecol_recettes`, `thecol_clients`, `thecol_pointages`, `thecol_inventaire`). Firebase sync is manual via a sync button.

### View Pattern

Each page has a `render<Page>()` function (e.g., `renderStock()`, `renderCommandes()`) that builds HTML and writes it to the main content area. Modal dialogs use `modal.show()` / `modal.hide()`. Toast notifications use `showToast()`.

### Data Schemas

Defined in `SPEC.md`. Key entities: employees, aromes, formats, recettes (recipes with ingredients-per-litre), clients, lots (stock batches with DLV/DLC dates), commandes (orders with line items), pointages (timesheets).

## Key Conventions

- IDs are generated with `generateId()` (UUID-style)
- Dates formatted with Swiss French locale (`fr-CH`)
- Production planner aggregates orders by date range, calculates litres per arome, then applies recipes to compute required ingredients
- Stock statuses are auto-computed from DLC dates: OK, < 1 mois, Expiré
- The Inventaire tab tracks consumables (consommables) and equipment (équipement) with stock alert thresholds
