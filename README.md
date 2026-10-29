# Cole McClintock: Data Analytics Portfolio

Live site: **https://mcclintockdigital.github.io/portfolio/**

A portfolio of data analytics, report automation, and responsible AI/SI work built around the needs of a National Guard State Data and Analytics Officer: executive dashboards for senior leaders, automated reporting, data reconciliation against systems of record, and AI/SI pilot management.

> **Data shown is fictional for demonstration. Not an official Iowa National Guard product.**
> All unit names, armories, people, and readiness values are invented by a seeded script (`data-generation/`). Real Iowa city names are used only as locations. No CUI, no real readiness data, no official seals or insignia.

## Projects

| Project | Status | Link |
|---|---|---|
| Readiness Command Dashboard (Iowa ARNG, statewide) | Live | [`dashboards/readiness/`](dashboards/readiness/index.html) |
| Automated Report Generator | Coming soon | |
| Data Quality & Reconciliation Tool | Coming soon | |
| AI/SI Pilot Portfolio Tracker | Coming soon | |
| Power BI Starter Kit (DAX, M, theme) | Coming soon | |

### Readiness Command Dashboard
Executive view of 31 company-level units across 8 battalions and 3 brigades, monthly for 18 months (May 2025 to Oct 2026):

- KPI cards with month-over-month change: assigned strength, MOS-qualified, medical readiness (MRC 1-4), equipment on-hand and operational readiness, individual and collective training, and units rated C1-C2
- Filters for brigade, battalion, location, and month
- Trend and rating-distribution charts, battalion comparison, medical readiness breakdown
- Inline SVG map of Iowa (no map servers); click a location to filter
- Ranked "units needing attention" table with the drivers behind each score, sortable, with CSV export
- Auto-written plain-English **Commander's summary** that updates with every filter
- Upcoming drill and annual training events
- Print / PDF-friendly layout; works on laptop and phone
- **Load your own data**: read a CSV or XLSX in the browser only (nothing is uploaded) using [`readiness_template.csv`](dashboards/readiness/readiness_template.csv)

The overall C1-C4 rating is a simplified illustrative method (explained on the page), not the Army's official readiness reporting method.

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
4. To use your own data, open the dashboard, click **Load your own data**, download the template CSV, fill it in (or export from your source system with the same column names), and choose the file. The data is processed only in that browser tab and is gone when you close it.

Follow your organization's policies before loading any official or sensitive data.

## Repository layout

```
index.html                         portfolio home page
assets/css/site.css                shared styles
assets/img/                        favicon, project thumbnails
assets/vendor/                     Chart.js 4.4.4 (MIT), SheetJS CE 0.20.3 (Apache-2.0), bundled for offline use
dashboards/readiness/              Readiness Command Dashboard
  index.html, readiness.js/.css    the dashboard
  iowa.js                          simplified Iowa outline for the SVG map
  readiness_template.csv           column template for your own data
  data/                            demo data (CSV, JSON, and data.js so it works from file://)
data-generation/                   seeded Python script that builds the demo data
```

## Regenerate the demo data

```bash
python3 data-generation/generate_readiness_data.py --seed 2026
```

Standard-library Python only. The same seed always produces the same data.

## Edit your bio

Open `index.html` and replace the placeholder text in the **About me** section.
