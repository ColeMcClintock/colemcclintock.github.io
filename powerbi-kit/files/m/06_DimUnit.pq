// DimUnit: one row per company-level unit (from units.csv)
let
    Source = fnLoadCsv("units.csv"),
    Typed  = Table.TransformColumnTypes(Source, {
        {"unit_id", type text}, {"unit_name", type text}, {"battalion", type text}, {"battalion_short", type text},
        {"brigade", type text}, {"branch", type text}, {"location", type text}, {"armory", type text},
        {"lat", type number}, {"lon", type number}, {"authorized", Int64.Type}}, "en-US"),
    Dedup  = Table.Distinct(Typed, {"unit_id"})
in
    Dedup
// Data category: lat = Latitude, lon = Longitude, location = City (Column tools).
