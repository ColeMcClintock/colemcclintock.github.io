# Build the report in Power BI Desktop (about 30-60 minutes)

A `.pbix` file is **not** included: it can only be produced in Power BI Desktop (Windows), and this kit was prepared without it. Everything needed to rebuild the report is here.

## 0. Prepare (2 min)
1. Unzip the kit to a short path, for example `C:\PowerBI\portfolio-kit\`.
2. The `data\` folder holds the fictional CSVs: `units.csv`, `readiness_monthly.csv`, `events.csv`, `asmis_sample.xlsx` / `asmis_sample.csv` (ASMIS export layout, 45 columns), `strength_by_battalion.csv`, `status_of_funds.csv`, `ufr.csv`.

## 1. Theme (1 min)
View > Themes > Browse for themes > `theme\portfolio-theme-dark.json` (or the light theme for briefings).

## 2. Parameter and loader function (3 min)
1. Home > Transform data to open Power Query.
2. Home > Manage Parameters > New: `DataFolder`, Text, value `C:\PowerBI\portfolio-kit\data\` (with the trailing backslash).
3. New Source > Blank Query > Advanced Editor > paste `m\01_fnLoadCsv.pq` > rename the query `fnLoadCsv`.
4. Manage Parameters > New: `ASMISFile`, Text, full path to the export (default `C:\PowerBI\portfolio-kit\data\asmis_sample.xlsx`; see `m\19_ASMISFile_parameter.pq`).

## 3. Queries (10-15 min)
For each file below: New Source > Blank Query > Advanced Editor > paste > rename to the name shown.

| File | Query name |
|---|---|
| 05_DimDate.pq | Date |
| 06_DimUnit.pq | DimUnit |
| 10_FactReadiness.pq | FactReadiness |
| 11_FactMedical_unpivot.pq | FactMedical |
| 12_FactEvents.pq | FactEvents |
| 20_FactAccident_ASMIS.pq | FactAccident |
| 21_DimBattalion_Strength.pq | DimBattalion |
| 30_FactFunds.pq | FactFunds |
| 31_FactFunds_long_unpivot.pq | FactFunds_long (optional) |
| 32_FactUFR.pq | FactUFR |
| 07_DimOrganization.pq | DimOrganization |
| 08_DimProgram.pq | DimProgram |

Then Close & Apply. `02_FolderLoad_example.pq` shows how to combine monthly extracts dropped in a folder later.

## 4. Model (5-10 min)
1. Select `Date` > Table tools > Mark as date table > `Date`. Sort `Month` by `YearMonth`.
2. Model view: create the relationships in `model\star-schema.svg` (all single direction, many-to-one):
   - FactReadiness[unit_id], FactMedical[unit_id] to DimUnit[unit_id]
   - FactReadiness[MonthStart], FactFunds[MonthStart], FactMedical[MonthStart] to Date[Date]
   - FactAccident[Accident Date] to Date[Date]
   - FactAccident[Battalion] to DimBattalion[Battalion]
   - FactFunds[program_code], FactUFR[program_code] to DimProgram[program_code]
   - FactFunds[organization], FactUFR[organization] to DimOrganization[organization]
3. Hide foreign-key columns in the facts (unit_id, MonthStart, program_code, organization).

## 5. Measures (10 min)
1. Home > Enter data > name `_Measures` > Load.
2. Paste the measures from `dax\01_common.dax` to `dax\04_finance.dax` (one New measure each), or open DAX query view, paste `dax\99_define_all.dax`, run it, and choose **Update model with changes**.
3. Set formats: % measures as Percentage (1 dp), money as Currency ($, 0 dp), counts as Whole number.

## 6. Pages and visuals (15-25 min)
Follow `docs\report-layout.md` page by page. Use View > Sync slicers so brigade/battalion/month carry across pages.

## 7. Check against the web dashboards (5 min)
Compare a few numbers with the live dashboards (same fictional data), for example statewide Strength % for Oct 2026, total accidents and overdue investigations on the Safety dashboard (note: the web demo counts to 29 Oct 2026, Power BI counts to today), and FY26 obligation rate as of Sep 2026. Differences usually mean a relationship or the date-table marking is missing.

## Using real data at work
Safety: set `ASMISFile` to the ASMIS export saved in an approved location. The query cleans header spelling, renames Tech to MSC, parses DD-Mon-YY dates and $ amounts, and drops rows with no readable Accident Date. Compare the row count with the export after refresh.

Point `DataFolder` at an approved location holding extracts with the same column names (see the CSV headers). Follow your organization's data-handling and publishing policies; keep the report in your approved workspace.
