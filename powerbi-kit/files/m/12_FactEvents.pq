// FactEvents: upcoming drill / AT events
let
    Source = fnLoadCsv("events.csv"),
    Typed  = Table.TransformColumnTypes(Source, {{"start", type date}, {"end", type date}, {"type", type text},
        {"brigade", type text}, {"battalion", type text}, {"location", type text}, {"notes", type text}}, "en-US")
in
    Typed
