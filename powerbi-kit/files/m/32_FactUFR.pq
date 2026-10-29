// FactUFR: unfunded requirements
let
    Source = fnLoadCsv("ufr.csv"),
    Typed  = Table.TransformColumnTypes(Source, {{"fy", type text}, {"ufr_id", type text}, {"title", type text}, {"program_code", type text},
        {"organization", type text}, {"brigade", type text}, {"amount", Currency.Type}, {"priority", Int64.Type}, {"status", type text}, {"impact", type text}}, "en-US")
in
    Typed
