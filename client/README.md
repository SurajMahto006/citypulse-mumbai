# CityPulse Mumbai — Frontend Client (`client/`)

### *A data-driven urban safety and city intelligence platform for exploring locality-level indicators, visualizing geographic patterns, and evaluating hypothetical infrastructure-planning scenarios.*

[![Repository](https://img.shields.io/badge/Repository-citypulse--mumbai-168BFF.svg)](https://github.com/SurajMahto006/citypulse-mumbai.git)
[![Category](https://img.shields.io/badge/Category-Civic%20Tech%20%7C%20Urban%20Analytics-20B879.svg)]()
[![Status](https://img.shields.io/badge/Build-Passing%20(900ms)-10b981.svg)]()
[![Linter](https://img.shields.io/badge/Linter-0%20warnings%20(oxlint)-38bdf8.svg)]()

The interactive web application for **CityPulse Mumbai — Urban Safety & City Intelligence for Everyone**.

Built with **React 19**, **Vite 8**, **Leaflet 1.9**, and modern vanilla CSS implementing the bright white civic-tech design system (`#FFFFFF` background, light pastel cards, zero dark theme). Designed for residents, commuters, visitors, community groups, and municipal city planners.

---

## Features

- **Executive Cockpit & Interactive Map:** Leaflet map with priority-coded locality pins, 12 Mumbai Police Station emergency hubs, and interactive dossiers.
- **Dynamic Dataset Importer & Schema Mapper:** Built-in client-side CSV, JSON, and GeoJSON parser with column auto-detection, schema concept mapping, and data quality preview. Supports both Specialized Safety DSS Mode and General Spatial Profile Mode.
- **Municipal Planning Scenario Explorer (Hypothetical):** Heuristic policy trade-off simulator modeling the arithmetic effects of auxiliary chowki additions ($-1.45$ pts/outpost), LED lighting upgrades (up to $-2.2$ pts), and intensive night patrol beats ($-1.8$ pts).
- **Three Actionable Analytical Discoveries:** Transparent group comparisons with sample sizes ($N$), continuous Spearman rank correlations, and `<details>` limitation disclosures.
- **Dataset Explorer:** Tabular inspection with search filtering and direct locality dossier access.

---

## Directory Structure

```text
client/
├── public/
│   ├── _redirects                  # Single-page application routing rules for Netlify
│   ├── data/
│   │   └── citypulse_mumbai_curated.json  # 538 locality records compilation (1.1 MB)
│   ├── favicon.svg
│   └── icons.svg
├── src/
│   ├── App.jsx                     # Core application logic, active dataset state & tabs
│   ├── App.css
│   ├── index.css                   # Bright white civic-tech styling system
│   └── main.jsx                    # React 19 entry point
├── index.html                      # HTML5 template with Leaflet & font imports
├── vite.config.js                  # Vite configuration with React plugin
├── vercel.json                     # Vercel deployment configuration & SPA rewrites
├── .oxlintrc.json                  # Oxlint configuration (0 errors, 0 warnings)
└── package.json
```

---

## Development & Verification Commands

All commands can be executed from the `client/` directory:

```bash
# Install frontend dependencies
npm install

# Start local Vite development server
npm run dev

# Run static analysis and linting (0 errors, 0 warnings across 104 rules)
npm run lint

# Compile production bundle to client/dist/
npm run build

# Preview production build locally
npm run preview
```

---

## Map Tile Provider Configuration

CityPulse uses a dual-mode basemap configuration:
- **Authenticated Mode:** If `VITE_CARTO_API_KEY` is present in `.env.local`, requests authorized CARTO Positron Light tiles.
- **Open Fallback Mode:** If no key is set, automatically renders standard OpenStreetMap Light tiles (`tile.openstreetmap.org`).
- In both cases, legally required OpenStreetMap and CARTO attributions are strictly preserved and zero "API Required" watermarks appear.
