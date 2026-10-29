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
Built for the ASMIS accident export (45 columns, same order and headers). Choose the .xlsx or .csv export with **Load ASMIS export**; it is read in the browser only and never uploaded. The loader cleans header spelling (asterisks, spacing, case, common variants), shows `Tech` as **MSC**, reads `DD-Mon-YY` text dates, Excel dates and ISO dates, `$1,234.00` currency, and Y/N fields, then shows a load report (rows loaded, columns matched/missing/extra, rows with unreadable dates). You can load several exports at once (for example one tracker per fiscal year plus a roll-up) by choosing or dragging in multiple files, or use **Add more files**; rows are combined and duplicates are removed across and within files (match on Accident #, then CCIR #, then ASMIS # with normalized IDs, or a date + UIC + battalion + subtype fingerprint for rows without IDs; the most complete record is kept: Final over In Review NGB over Investigation Ongoing, then later completion date, then more filled-in fields, then the newest file). The load report lists each file and every duplicate removed. Visuals whose columns are missing are hidden. Blank and formula-only rows are ignored; `-`, `$ -`, `(blank)` and `N/A` in number cells are read as zero/blank, and only genuinely unreadable cells are reported (with examples). Accident Class supports A-D, E (Ground) (`E - grnd`), R (NG) (`R - NG`) and Unclassified (blank). Optional trailing columns `SUB DATE REPORTED`, `Documentation`, `Comments` and `Assigned To` are used when present. After loading, the panel collapses to a one-line status bar (state remembered in the browser); **Presentation mode** hides loading and help panels (Esc exits).

Views: filters (fiscal year/date range, MSC, battalion, UIC, class, status, duty status, on duty, accident and cause subtype); KPIs (total and Class A-D, total/injury cost, material ECOD, days lost, open and overdue investigations, days since last Class A/B, accidents per 1,000 when a `Strength` sheet is present); an investigation tracker sorted by days overdue with red/amber/green status, status pipeline, aging buckets and CSV export; monthly accidents by class; fiscal-year cumulative comparison; subtype, cause, MSC, battalion, duty status, on/off duty and day-of-week charts; a day x time-of-day heat map; HFACS category > failure > subfailure drill-down; cost composition by FY; aggregated demographics with groups under 3 suppressed; a detail drawer with the full record and summary; and an auto-written summary with no personal details.

Blank templates: [`asmis_template.xlsx`](dashboards/safety/asmis_template.xlsx), [`asmis_template.csv`](dashboards/safety/asmis_template.csv). Fictional sample in the same layout: [`data/asmis_sample.xlsx`](dashboards/safety/data/asmis_sample.xlsx).

### Status of Funds Dashboard
FY26 (Oct 2025 to Sep 2026) and FY27 to date by appropriation (NGPA, OMNG, MCNG, State) and fictional program codes: Annual Funding Program, allotments, commitments, obligations, disbursements, unobligated balance, obligation rate vs spend plan, burn rate, projected end-of-year execution, a program variance table with conditional formatting and use-or-lose flags, TDY spend, unfunded requirements, and a resource manager summary. A "How the numbers work" section explains each term.

### Power BI Starter Kit
Two schema-validated report themes, a DAX measures library (readiness; ASMIS overdue investigations, days since last Class A/B, cost totals and accidents per 1,000; obligation and burn rates, EOY projection, variance, ranking, dynamic titles), Power Query (M) scripts (parameter, loader, an ASMIS export query that cleans headers, renames Tech to MSC and parses DD-Mon-YY dates and currency, folder load, date table, dims, facts, unpivots), a star-schema diagram, a page-by-page report layout, step-by-step build instructions, and the fictional CSVs. A `.pbix` is not included because it can only be built in Power BI Desktop; the kit rebuilds it in about 30-60 minutes. Download: [`powerbi-kit/powerbi-starter-kit.zip`](powerbi-kit/powerbi-starter-kit.zip).

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
dashboards/safety/               Safety & Mishaps Dashboard (ASMIS loader, templates, data/)
dashboards/finance/              Status of Funds Dashboard (+ template CSV, data/)
powerbi-kit/                     Power BI Starter Kit page, files/, and the kit ZIP
data-generation/                 seeded Python scripts that build all demo data and the kit
tools/                           build-standalone.py (offline copies in downloads/)
downloads/                       offline single-file dashboards and ZIPs
```

## Offline copies (download and run at work)

`python3 tools/build-standalone.py` builds, from the same source:

- [`downloads/safety-dashboard.html`](downloads/safety-dashboard.html): one self-contained HTML file (CSS, JS, Chart.js, SheetJS, fictional demo data and templates inlined). Double-click to run; no network requests.
- [`downloads/safety-dashboard.zip`](downloads/safety-dashboard.zip): the single file, a folder version, blank templates, `COLUMN-GUIDE.csv`, and `README - How to use at work.txt`.
- The same for [`readiness-dashboard`](downloads/readiness-dashboard.html) and [`finance-dashboard`](downloads/finance-dashboard.html).

Re-run it after changing any dashboard file.

## Regenerate the demo data

```bash
python3 data-generation/generate_readiness_data.py
python3 data-generation/generate_asmis_data.py        # needs openpyxl (pip install openpyxl) for the .xlsx sample/template
python3 data-generation/generate_finance_data.py
python3 data-generation/generate_asmis_fy_trackers.py # fictional FY22-FY26 trackers + roll-up for multi-file/de-dup testing
python3 data-generation/build_powerbi_kit.py      # refreshes the kit CSVs, snippets and ZIP
python3 tools/build-standalone.py                  # rebuilds downloads/ (offline copies)
```

Standard-library Python except `generate_asmis_data.py`, which uses openpyxl to write the Excel sample and template. Each script takes `--seed`; the same seed always produces the same data, and all of them read the shared roster in `data/units.json` (built by `units_roster.py`).

## Edit your bio

Open `index.html` and replace the placeholder text in the **About me** section.
