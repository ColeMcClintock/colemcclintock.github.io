# OWI Dashboard

Open `index.html` for an explicitly fictional preview. The public standalone at
`../../downloads/owi-dashboard.html` opens **empty**; it contains no soldier identities.
Upload workbooks locally in Edge/Chrome, including from `file://` or a SharePoint-synced
folder. SharePoint's HTML preview may not execute scripts: open the local synced copy.

## Privacy

No analytics, APIs, remote fonts, uploads, fetch calls, localStorage or IndexedDB.
Chart.js and SheetJS are vendored under `assets/vendor`. State is private to this document.
The only identifier read is the supplied soldier name. SSN cells are never read. DOB is
read only if Age is blank, converted to age, and discarded. Unmapped columns are ignored.
**Save with data contains the uploaded names/incidents and strength settings. Keep saved
copies only in approved restricted storage. Never publish or commit them.** The public
repo ignores `OWI-Dashboard-*.html`; the pre-commit guard rejects those filenames and
embedded `owiSaved` data blocks, even after renaming. No automatic storage or sharing occurs.

## Inputs / calculation choices

* Headers are matched case-insensitively in the first 30 rows, ignoring spaces/punctuation.
* One row is one incident, not a unique person or a conviction. Repeat rows remain and are
  noted in the drawer. New incident uploads replace the incident set; new Strength Keys
  replace the strength set. Keys can be loaded in the same selection or separately.
* Incident Date is standard. Date / OWI Date are aliases. Missing dates leave timing panels
  empty. DY means training year (Oct–Sep); year numbers never become Excel serial dates.
  Legacy full-date DY is used only when Incident Date is blank; its TY is then derived.
  Explicit DY wins on a date/TY conflict, which is noted. Current TY is selected when present.
* Age as entered takes priority. Optional DOB fallback and PEBD/PEBP years of service use
  the incident date, or the upload date if undated. Computed values survive Save with data.
* HOR input combines Home of Record/HOR/HOR Address, Address, City/Town, State, ZIP /
  ZIP Code / Postal and County columns. Whole addresses and ZIP-only cells are supported.
  ZIP+4 is reduced to five digits. The static GeoNames table covers all 1,055 Iowa entries
  in its public US postal extract. Recognized ZIP wins over city text; explicit non-Iowa
  state or a ZIP outside the Iowa range stays off the map. Unlisted ZIPs inside 50001–52809
  are recognized as Iowa but need a city match to obtain a point—no invented coordinates.
* City matching expands St/Saint, Mt/Mount, Ft/Fort, N/S/E/W, punctuation and hyphens.
  Exact city/suffix matches come first, then bounded Damerau–Levenshtein distance ≤2
  (one for very short names); tied best candidates remain Unmatched. County can disambiguate.
  The drawer reports ZIP / city / fuzzy / out-of-state / unmatched counts, raw failed HORs,
  and raw-to-resolved fuzzy matches for review. Source street addresses appear only in the
  local drawer/snapshot, never map tooltips or the soldier table.
* Date cells use SheetJS cellDates with UTC calendar fields normalized to LOCAL NOON.
  Strings support US M/D (D/M only if first part >12), ISO and compact YYYYMMDD, military
  DDMMMYYYY, named months and date-times. Written calendar dates are not shifted by timezone.
  Two-digit years <50 mean 20xx; ≥50 mean 19xx. Incident, PEBD and optional DOB share this
  parser. Unparsed Incident Date / PEBD values are listed by file/row in the drawer and
  saved diagnostics; DOB values remain discarded even on failure (only its row is noted).
* Rank abbreviations map to Army pay grades. Demographic cells show counts and incident
  shares—not population risk, because no age-by-grade assigned roster is supplied.
* The collapsed Strength section auto-lists MSCs and their battalions. A blank Battalion
  in a Strength Key is an MSC total. MSC totals override battalion sums; absent MSC totals
  require complete battalion strengths. No double counting or partial denominators. No
  rates for multiple/unknown TYs or Duty Status filters (no duty-specific denominator).
  Battalion/MSC filters narrow the denominator appropriately. Strength can include units
  with zero incident records. Strength values should be reviewed for the selected TY.
* All four filters apply to all analytical panels. Table search affects only the table.
* Mode-based composite profiles and rule-based prevention suggestions are descriptive,
  not individual predictions, causal findings, or a disciplinary decision tool.

## Peer benchmark / limitation

A validated public age-specific Iowa OWI numerator was not obtained. We therefore do
**not** claim an age-adjusted rate. Incident-only age distributions also are not the
assigned unit's age roster. The disclosed fallback is the 2024 statewide administrative
proxy: **13,786 OWI revocations / 2,402,129 licensed drivers × 1,000 = 5.7391**.

Official Iowa DOT PDFs (total rows; accessed November 10, 2026):
* Revocations by county/year: https://iowadot.gov/media/7249/download?inline=
* Licensed drivers by age/sex: https://iowadot.gov/media/7246/download?inline=
* Catalog: https://iowadot.gov/dmv-statistics-research
* Iowa DPS interactive arrest report researched, not used as a validated extract:
  https://icrime.dps.state.ia.us/CrimeInIowa/Report/ArrestDrillDown

Revocations are not arrests, convictions or unique people. Grant-funded GTSB activity
and State Patrol-only arrest counts were not substituted for statewide totals. Calendar
2024 is not a matched TY or an annualized current-year rate. The proxy expectation is
strength × statewide annual proxy / 1,000, strictly context—not an adjusted prediction
or a statistical significance test. Both the KPI and unit tables disclose these limits.

## Real geography, not inferred incident sites

942 incorporated Iowa cities: official 2020 Census POP100, internal point coordinates:
https://tigerweb.geo.census.gov/tigerwebmain/Files/bas26/tigerweb_bas26_incplace_2020_tab20_ia.html

86 Census-designated places, also 2020 POP100:
https://tigerweb.geo.census.gov/tigerwebmain/Files/bas26/tigerweb_bas26_cdp_2020_tab20_ia.html

1,055 Iowa ZIPs to postal city, county and lat/lon; plus 33 postal localities not matched
to a Census city/CDP. Complete Iowa subset downloaded from the public GeoNames US extract:
https://download.geonames.org/export/zip/US.zip
GeoNames (https://www.geonames.org), CC BY 4.0:
https://creativecommons.org/licenses/by/4.0/
Coordinates are approximate postal centers, not street geocoding. Postal city names are
matched to Census populations where possible; the other 33 remain Unknown size. No ZCTA
population is mislabeled as city population. The upstream extract may miss new/retired
ZIP assignments; unmatched in-range ZIPs remain explicitly unmatched unless a city resolves.

99 counties: public-domain Census 2023 cartographic 1:20m boundaries:
https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_county_20m.zip

Small <10,000; Medium 10,000–49,999; Large ≥50,000. This is **home-of-record concentration**,
not incident location. County shading uses the postal county on ZIP matches and the place
center's county on city matches; a ZIP/city spanning counties is not proportionally apportioned. One place center outside the simplified
county outline remains a town bubble without county shading. Explicit non-Iowa states
always exclude the town, even if Iowa has the same name. Unincorporated places from GeoNames plot with Unknown size if no Census population exists.
Other unknown HORs remain Unmatched and are listed in the drawer; no geocoding or requests.

## Regenerate / test

`/workspace/.venv/bin/python data-generation/generate_owi_data.py` regenerates only
fictional fixture data and blank templates. For the geographic build, download the two
public sources above to `places.html`, `cdp.html`, `US.zip` and `county.zip` in a scratch directory, then run
`data-generation/build_owi_reference.py <directory>` (beautifulsoup4, pyshp).

Run `tools/build-standalone.py`, then `tools/test-owi.py` with `/workspace/.venv/bin/python`.
`SHOTS=/workspace` generates OWI screenshots using fictional demo data only. The builder
also generates `save_shell.js`: an EMPTY self-contained shell loaded as a static script
by the hosted/folder page, so Save never fetches anything at runtime. The single-file
version captures its own source, with exactly one escaped saved-data block on each save.
Sibling `test-command.py`, `test-finance.py`, and `test-g1.py` must continue passing.

## Fictional messy-sample regression (November 10, 2026)

36 invented records: 10 ZIP matches + 19 city matches + 2 fuzzy = 31 mapped (31/31
resolvable Iowa examples), 3 correctly excluded non-Iowa, and 2 deliberately unresolved.
35/36 Incident Dates parse; the sole intentional malformed value is reported rather than
invented. All 35 valid dates preserve January 5, 2025 in America/Chicago, Los Angeles and
Tokyo, including actual Excel date/time cells. Save/reopen preserves results and reports.
No real workbook or soldier data was used or committed.
