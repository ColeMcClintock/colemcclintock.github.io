// DimBattalion: battalion list with assigned strength (denominator for accidents per 1,000). Query name: DimBattalion
// Source: strength_by_battalion.csv (MSC, Battalion, Assigned) or a "Strength" sheet in the ASMIS workbook.
// Relationship: FactAccident[Battalion] (many) -> DimBattalion[Battalion] (one), single direction.
let
    Source = fnLoadCsv("strength_by_battalion.csv"),
    // Workbook alternative:
    // Source = Table.PromoteHeaders(Excel.Workbook(File.Contents(ASMISFile), null, true){[Item = "Strength", Kind = "Sheet"]}[Data], [PromoteAllScalars = true]),
    Typed  = Table.TransformColumnTypes(Source, {{"MSC", type text}, {"Battalion", type text}, {"Assigned", Int64.Type}}, "en-US"),
    Unique = Table.Distinct(Typed, {"Battalion"})
in
    Unique
// Battalions in FactAccident that are missing here still count in totals but have no strength (rate is blank).
