# Cole McClintock: Data Analytics Portfolio

Live site: **https://colemcclintock.github.io/**

Data analytics and automation portfolio: interactive dashboards and tools that run in the browser and work offline.

> **Data shown is fictional for demonstration. Not an official Iowa National Guard product.**
> All unit names, armories, people, and readiness values are invented by a seeded script (`data-generation/`). Real Iowa city names are used only as locations. No CUI, no real readiness data, no official seals or insignia.

## Projects

| Project | Status | Link |
|---|---|---|
| Readiness Command Dashboard | Live | [`dashboards/readiness/`](dashboards/readiness/index.html) |
| Safety & Mishaps Dashboard | Live | [`dashboards/safety/`](dashboards/safety/index.html) |
| Status of Funds Dashboard | Live | [`dashboards/finance/`](dashboards/finance/index.html) |
| Power BI Starter Kit | Live | [`powerbi-kit/`](powerbi-kit/index.html) |
| Automated Report Generator | Coming soon | |
| Data Quality & Reconciliation Tool | Coming soon | |
| AI/SI Pilot Portfolio Tracker | Coming soon | |

All dashboards share one fictional unit roster (`data/units.json`): 31 company-level units in 8 battalions under three commands (58th Infantry Brigade Combat Team, 219th Sustainment Brigade, 96th Troop Command). Unit numbers were checked against public lists of current Iowa Army National Guard units so none match a real designation. Each dashboard has filters, an auto-written plain-English summary, CSV export, a print/PDF layout, a phone layout, and **Load your own data** (CSV/XLSX read in the browser only, with a downloadable template).

### Readiness Command Dashboard
Assigned strength, MOS qualification, medical readiness (MRC 1-4), equipment on-hand and operational readiness, individual and collective training, and C1-C4 ratings for May 2025 to Oct 2026. KPI cards with month-over-month change, trends, an SVG map of Iowa, a ranked "units needing attention" table with drivers, upcoming drill/AT events, and a commander's summary. The C1-C4 rating is a simplified illustrative method, not the Army's official method.

### Safety & Mishaps Dashboard
Nov 2024 to Oct 2026 mishaps and near misses: mishap rate per 1,000 personnel (12-month window vs prior year), Class A-D counts with illustrative cost bands, lost workdays, cost, days since the last Class A/B, category and root-cause breakdowns, a month x category heat map with seasonal callouts, a unit ranking normalized by strength, a composite hotspot table, and a safety officer summary.

### Status of Funds Dashboard
FY26 (Oct 2025 to Sep 2026) and FY27 to date by appropriation (NGPA, OMNG, MCNG, State) and fictional program codes: Annual Funding Program, allotments, commitments, obligations, disbursements, unobligated balance, obligation rate vs spend plan, burn rate, projected end-of-year execution, a program variance table with conditional formatting and use-or-lose flags, TDY spend, unfunded requirements, and a resource manager summary. A "How the numbers work" section explains each term.

### Power BI Starter Kit
Two schema-validated report themes, a DAX measures library (readiness, rolling 12-month mishap rate per 1,000, obligation and burn rates, EOY projection, variance, ranking, dynamic titles), Power Query (M) scripts (parameter, loader, folder load, date table, dims, facts, unpivots), a star-schema diagram, a page-by-page report layout, step-by-step build instructions, and the fictional CSVs. A `.pbix` is not included because it can only be built in Power BI Desktop; the kit rebuilds it in about 30-60 minutes. Download: [`powerbi-kit/powerbi-starter-kit.zip`](powerbi-kit/powerbi-starter-kit.zip).

## Run it locally

No install, no internet, no server needed:

1. Open `index.html` in any modern browser (Edge, Chrome, Firefox).

Optional, if you prefer a local web server:

```bash
python3 -m http.server 8000
# then browse to http://localhost:8000
```

## Move to a work computer

1. On GitHub, click **Code > Download ZIP** (or use the release ZIP you were given).
2. Unzip it anywhere, for example your Documents folder.
3. Double-click `index.html`. That's it: every library (Chart.js, SheetJS) is bundled in `assets/vendor/`, and the site makes no network requests.
4. To use your own data, open a dashboard, click **Load your own data**, download the template CSV, fill it in (or export from your source system with the same column names), and choose the file. The data is processed only in that browser tab and is gone when you close it.

Follow your organization's policies before loading any official or sensitive data.

## Repository layout

```
index.html                       portfolio home page
assets/css/                      site.css (shared), dash.css (dashboards)
assets/js/dashkit.js             shared dashboard helpers (filters, CSV export, file loading, print)
assets/img/                      favicon, project thumbnails
assets/vendor/                   Chart.js 4.4.4 (MIT), SheetJS CE 0.20.3 (Apache-2.0), bundled for offline use
data/units.json                  shared fictional unit roster
dashboards/readiness/            Readiness Command Dashboard (+ template CSV, data/)
dashboards/safety/               Safety & Mishaps Dashboard (+ template CSV, data/)
dashboards/finance/              Status of Funds Dashboard (+ template CSV, data/)
powerbi-kit/                     Power BI Starter Kit page, files/, and the kit ZIP
data-generation/                 seeded Python scripts that build all demo data and the kit
```

## Regenerate the demo data

```bash
python3 data-generation/generate_readiness_data.py
python3 data-generation/generate_safety_data.py
python3 data-generation/generate_finance_data.py
python3 data-generation/build_powerbi_kit.py      # refreshes the kit CSVs, snippets and ZIP
```

Standard-library Python only. Each script takes `--seed`; the same seed always produces the same data, and all of them read the shared roster in `data/units.json` (built by `units_roster.py`).

## Edit your bio

Open `index.html` and replace the placeholder text in the **About me** section.
