// FactMedical: unpivot MRC 1-4 counts into a long table (unit x month x category)
let
    Source    = Table.SelectColumns(FactReadiness, {"unit_id", "MonthStart", "mrc1", "mrc2", "mrc3", "mrc4"}),
    Unpivoted = Table.UnpivotOtherColumns(Source, {"unit_id", "MonthStart"}, "mrc_code", "soldiers"),
    AddLabel  = Table.AddColumn(Unpivoted, "MRC Category", each
        if [mrc_code] = "mrc1" then "MRC 1 Ready"
        else if [mrc_code] = "mrc2" then "MRC 2 Minor gaps"
        else if [mrc_code] = "mrc3" then "MRC 3 Temporarily not ready"
        else "MRC 4 Not ready / unknown", type text),
    Typed     = Table.TransformColumnTypes(AddLabel, {{"soldiers", Int64.Type}})
in
    Typed
