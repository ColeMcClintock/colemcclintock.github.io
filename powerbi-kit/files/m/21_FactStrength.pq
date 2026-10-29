// FactStrength: unit x month assigned strength (denominator for mishap rates)
let
    Source = fnLoadCsv("strength.csv"),
    Typed  = Table.TransformColumnTypes(Source, {{"month", type text}, {"unit_id", type text}, {"assigned", Int64.Type}}, "en-US"),
    AddMonthStart = Table.AddColumn(Typed, "MonthStart", each Date.FromText([month] & "-01", [Format = "yyyy-MM-dd", Culture = "en-US"]), type date)
in
    AddMonthStart
