# Report layout plan

Canvas: 1280 x 720 (16:9). Theme: `portfolio-theme-dark.json` for screen, `portfolio-theme-light.json` for briefing slides and print.
Grid: 16 px margins, 8 px gutters. Top band (0-72 px) holds the dynamic title, as-of label, and slicers on every page.

## Page 1: Readiness Overview
| Visual | Fields / measures | Position (x, y, w, h) | Notes |
|---|---|---|---|
| Text box (dynamic title) | `[Title Readiness]` via a card or button text fx | 16, 8, 900, 40 | Font 20, Segoe UI Semibold |
| Slicers (dropdown) | DimUnit[brigade], DimUnit[battalion], DimUnit[location], 'Date'[Month] (single select) | 16, 52, 1248, 40 | Sync across readiness pages |
| 8 KPI cards (new card visual) | Strength %, MOSQ %, Medically Ready %, Equipment On-Hand %, Equipment OR %, Individual Training %, Collective Training %, Units C1-C2 % | 16, 100, 1248, 110 | Reference label = matching `MoM` measure; conditional color with Status measures |
| Line chart | X: 'Date'[Month]; Y: the 7 % measures | 16, 220, 760, 250 | Show last 18 months; Y axis 70-100% |
| Stacked column | X: 'Date'[Month]; Y: Units Reporting; Legend: FactReadiness[readiness_rating] | 784, 220, 480, 250 | Colors C1 #5FBF7F, C2 #A9C16A, C3 #E3B34C, C4 #E0645C |
| Map (Azure Map or Shape map) | Lat/Long: DimUnit[lat]/[lon]; Size: Assigned; Color: Attention Score | 16, 480, 420, 224 | If maps are disabled by policy, use a bar chart by location |
| Table | DimUnit[unit_name], [Attention Score], [Unit Attention Rank], [Top Driver], Strength %, Medically Ready %, Equipment OR % | 444, 480, 820, 224 | Sort by rank; Top N = 10 filter on Unit Attention Rank |

## Page 2: Unit Drill-through
Drill-through field: DimUnit[unit_name]. Cards for all readiness measures, a 18-month line chart, the FactMedical donut (MRC Category / soldiers), and a table of upcoming FactEvents for that unit's battalion.

## Page 3: Safety Overview (ASMIS)
| Visual | Fields / measures | Position | Notes |
|---|---|---|---|
| Title | `[Title Safety]` | 16, 8, 900, 40 | |
| Slicers | DimBattalion[MSC], DimBattalion[Battalion], FactAccident[Unit UIC], [Accident Class], [Status], [Duty Status], [On Duty], [Accident Subtype], [Cause Subtype], 'Date'[Fiscal Year] | 16, 52, 1248, 40 | Between date slicer on 'Date'[Date] for custom ranges |
| 6 cards | Accidents, Class A-D (4 cards or one multi-row card), Total Accident Cost, Open Investigations, Overdue Investigations, Days Since Last Class A/B | 16, 100, 1248, 110 | Overdue card: red font when > 0 |
| Stacked column | X: 'Date'[Month]; Y: Accidents; Legend: Accident Class | 16, 220, 760, 250 | Class colors A #E0645C, B #E88A4C, C #E3B34C, D #A9C16A |
| Line | X: 'Date'[Fiscal Month]; Y: Accidents (running total in Fiscal Year); Legend: 'Date'[Fiscal Year] | 784, 220, 480, 250 | Quick measure: Running total by Fiscal Month |
| Stacked bar x2 | Y: Accident Subtype / Cause Subtype; X: Accidents; Legend: Accident Class | 16, 480, 620, 224 | |
| Matrix heat map | Rows: Day of Week; Columns: Hour (bin 4); Values: Accidents | 644, 480, 620, 224 | Conditional background, gradient #16294A to #E0645C |

## Page 4: Investigations and Cost
| Visual | Fields / measures | Position | Notes |
|---|---|---|---|
| Table (tracker) | Investigation RAG, CCIR #, ASMIS #, MSC, Battalion, Accident Class, Status, Accident Date, Due Date (Calc), Days Overdue (Calc) | 16, 52, 820, 360 | Filter: Is Open = True; sort by Days Overdue (Calc) desc; RAG icon via conditional formatting > Field value = [Investigation RAG Color] |
| Funnel | Category: Status (Investigation Ongoing, In Review NGB, Final); Values: Accidents | 844, 52, 420, 170 | Status pipeline |
| Column | X: aging bucket (group Accident Age: 0-30, 31-60, 61-90, 90+); Y: Open Investigations | 844, 230, 420, 182 | |
| Stacked bar | Y: 'Date'[Fiscal Year]; X: Days Away Cost, Days Hospitalized Cost, PPD Cost, PTD Cost, Fatality Cost, Material ECOD | 16, 420, 620, 280 | Cost composition |
| Decomposition tree | Analyze: Accidents; Explain by: HFACS Category > HFACS Failure > HFACS Subfailure | 644, 420, 620, 280 | HFACS drill-down |
| Card | `[Safety Summary]` | 16, 708, 1248, 40 | No demographics in the narrative |

Demographics (optional, restricted page): bar charts of Gender, Rank, Age bins, Years of Service bins using `[Accidents (suppressed <3)]` so any group under 3 is blank. Do not publish this page outside the safety office.

## Page 5: Status of Funds
| Visual | Fields / measures | Position | Notes |
|---|---|---|---|
| Title | `[Title Finance]` | 16, 8, 900, 40 | |
| Slicers | 'Date'[Fiscal Year], 'Date'[Month] (single), DimProgram[appropriation], DimOrganization[brigade], DimOrganization[organization] | 16, 52, 1248, 40 | |
| 6 cards | AFP, Obligation Rate (ref: Variance to Plan (pts)), Disbursements FYTD, Unobligated Balance, Projected EOY %, TDY FYTD | 16, 100, 1248, 110 | |
| Line (S-curve) | X: Month (fiscal sort); Y: Plan FYTD, Obligations FYTD, Disbursements FYTD, Allotted FYTD | 16, 220, 760, 250 | Add constant line = AFP |
| Funnel | FactFunds_long[stage] by Stage Order; Values: amount (FYTD) | 784, 220, 480, 250 | Or a waterfall: AFP to Unobligated |
| Stacked column | X: Month; Y: SUM(obligations); Legend: DimProgram[appropriation] | 16, 480, 620, 224 | |
| Column + line | X: Month; Columns: SUM(tdy_obligations); Line: TDY FYTD | 644, 480, 620, 224 | |

## Page 6: Program Variance and UFRs
Table: DimProgram[program_code], program_name, appropriation, AFP, Obligations FYTD, Obligation Rate, Plan Rate, Variance to Plan (pts), Variance to Plan ($), Projected EOY %, Projected Unobligated at EOY, Use-or-Lose Flag. Conditional formatting: font color by field value = `[Variance Color]`. Second table: FactUFR sorted by priority then amount with a status filter. Card: `[Resource Manager Summary]`.

## Tooltip page
Size 320 x 240, page type Tooltip. Shows the unit or program name, three key measures, and a sparkline. Assign it to the tables on pages 1, 4 and 6.
