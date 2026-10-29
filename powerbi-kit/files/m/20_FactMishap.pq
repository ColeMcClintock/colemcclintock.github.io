// FactMishap: one row per mishap or near miss
let
    Source = fnLoadCsv("mishaps.csv"),
    Typed  = Table.TransformColumnTypes(Source, {
        {"record_id", type text}, {"date", type date}, {"unit_id", type text}, {"event_type", type text},
        {"mishap_class", type text}, {"category", type text}, {"duty_status", type text},
        {"days_lost", Int64.Type}, {"cost", Currency.Type}, {"root_cause", type text}}, "en-US"),
    Cleaned = Table.ReplaceValue(Typed, "NM", null, Replacer.ReplaceValue, {"mishap_class"}),
    Slim    = Table.RemoveColumns(Cleaned, {"month", "unit_name", "battalion", "brigade", "location"}, MissingField.Ignore)
in
    Slim
// Note: near misses get a blank mishap_class so class visuals only show Class A-D.
