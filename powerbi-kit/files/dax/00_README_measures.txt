DAX MEASURES LIBRARY - Cole McClintock Portfolio Power BI Starter Kit
Data shown is fictional for demonstration.

How to use
1. Build the model first (see docs/build-steps.md). Table names used below:
   'Date', DimUnit, DimOrganization, DimProgram,
   FactReadiness, FactMedical, FactEvents, FactAccident (ASMIS export), DimBattalion, FactFunds, FactUFR
2. Create an empty table to hold measures: Home > Enter data > name it "_Measures" > Load.
3. For each measure below: select _Measures > New measure > paste ONE block
   (from "Measure Name =" through the end of its expression).
   Tip: in Power BI Desktop (recent versions) you can paste a whole file into
   DAX query view using DEFINE MEASURE syntax; see 99_define_all.dax.
4. Set formats as noted in each comment (Percentage, Whole number, Currency).

Files
  01_common.dax      dynamic titles, as-of labels, helper measures
  02_readiness.dax   strength, MOSQ, medical, equipment, training, C-ratings, MoM, ranking
  03_safety.dax      ASMIS accidents by class, open/overdue investigations, RAG, cost totals,
                     days since last Class A/B, FYTD vs PFYTD, accidents per 1,000, suppression
  04_finance.dax     AFP, FYTD execution, obligation rate, burn rate, EOY projection, variance, use-or-lose
  99_define_all.dax  every measure in one DEFINE block for DAX query view
