// Optional: long version of FactFunds for a single "execution stage" axis (funnel / waterfall visuals)
let
    Source    = Table.SelectColumns(FactFunds, {"MonthStart", "program_code", "organization", "allotment", "commitments", "obligations", "disbursements"}),
    Unpivoted = Table.UnpivotOtherColumns(Source, {"MonthStart", "program_code", "organization"}, "stage", "amount"),
    AddOrder  = Table.AddColumn(Unpivoted, "Stage Order", each
        if [stage] = "allotment" then 1 else if [stage] = "commitments" then 2 else if [stage] = "obligations" then 3 else 4, Int64.Type),
    Typed     = Table.TransformColumnTypes(AddOrder, {{"amount", Currency.Type}})
in
    Typed
