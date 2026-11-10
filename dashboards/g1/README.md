# G1 Dashboard

Open `index.html` for the fictional hosted demo. `downloads/g1-dashboard.html` is the offline,
single-file copy: it opens empty and accepts multiple Excel workbooks at once. All parsing,
charts and Save with data run locally in the document. No network requests or external libs.

## Isolation from Aviation

G1 copies the Aviation core, SOF, spend-plan and PR implementation rather than modifying Aviation.
Its global is `window.G1`, demos are `G1_DEMO` / `G1_FUNDS_DEMO`, saved block is `g1Saved`,
and filename is `G1-Dashboard-DDMonYY.html`. Aviation's `commandSaved` block is never read.
There is no localStorage, sessionStorage or IndexedDB persistence in either dashboard; document
state is completely separate, even when both pages are open. G1 keys and funding templates are
separate files under this directory and the `downloads/g1-*` prefix. The stateless vendor/parser
source files under assets and finance are loaded into each document separately, not shared data.

## Uploads

- SOF export, funding, Account Key and Commitment Item Key: same schemas and calculations as
  Aviation. Total Expenditure = sign-flipped commitment_amt_cum; Obligation = TE − Disbursement.
- Spend plan: Account, October through September. Fiscal year defaults to the current FY.
  Month names, abbreviations and Excel-date headers work; Month 1–12 remains accepted.
- L1–L4 PR files: same schemas/grouping as Aviation. Cardholder Key has Cardholder and optional
  Display Name only. Any Type column is ignored and no Type split is rendered or saved.
- Stipends: Retiree, Date of service, Cage code, Status. Status text is preserved.
- MFH Duty: Name, Date performed, UIC, Status. Known statuses match case-insensitively.
- DTS: Approved date, Last name, First name, TANUM, Departure Date, Location/Destination,
  Total Obligation ($). Every other column is ignored, without reading its row values.
  The first 60 rows are scanned for the full header; the sample has nine junk rows above it.

Header routing requires all program-report headers to avoid collisions. A new program upload
replaces the report of that kind, leaving other reports in place. Dates accept Excel serials,
ISO, US slash dates and textual month dates. Invalid dates/amounts are blank and counted in the
drawer. Duplicate TANUMs are retained and noted only in the drawer. DTS monthly obligation is
by **Approved date**; undated rows stay in the table and total but not in any month.

## Account selection

`PROGRAM_ACCOUNT_MATCH` in `programs.js` is the single place to change each program's rule:
case-insensitive substring `Funeral Honors` or `ESGR` on Account Key-mapped account names.
Monthly actuals count each SOF line's TE once in its fiscal month, exactly as Aviation; cumulative
is the running total. Funding-only accounts also appear, with zero TE. SOF, Spend Plans and
program pages default to current fiscal year when present.

## Fictional data / tests

Run `data-generation/generate_g1_data.py` to regenerate fictional demos and G1-only templates.
Names, UICs, CAGE codes, document IDs and TANUMs are invented (`FAKE-*`). Templates are blank;
the DTS sample is deliberately filled with fictional rows and junk lines.

Run `tools/build-standalone.py`, then `/workspace/.venv/bin/python tools/test-g1.py`.
Set `SHOTS=/workspace` to refresh the six G1 screenshots. Also run `test-command.py` and
`test-finance.py` to guard the existing dashboards. Never commit saved-with-data HTML copies.
