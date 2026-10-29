// FactReadiness: unit x month readiness
let
    Source = fnLoadCsv("readiness_monthly.csv"),
    Typed  = Table.TransformColumnTypes(Source, {
        {"month", type text}, {"unit_id", type text}, {"authorized", Int64.Type}, {"assigned", Int64.Type},
        {"mosq_pct", type number}, {"mrc1", Int64.Type}, {"mrc2", Int64.Type}, {"mrc3", Int64.Type}, {"mrc4", Int64.Type},
        {"equip_on_hand_pct", type number}, {"equip_or_pct", type number}, {"ind_training_pct", type number},
        {"coll_training_pct", type number}, {"readiness_rating", type text}}, "en-US"),
    AddMonthStart = Table.AddColumn(Typed, "MonthStart", each Date.FromText([month] & "-01", [Format = "yyyy-MM-dd", Culture = "en-US"]), type date),
    // keep keys + measures only; unit attributes live in DimUnit
    Slim = Table.RemoveColumns(AddMonthStart, {"unit_name", "battalion", "brigade", "branch", "location", "armory", "lat", "lon"}, MissingField.Ignore)
in
    Slim
