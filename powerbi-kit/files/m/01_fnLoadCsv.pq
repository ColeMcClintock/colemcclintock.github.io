// Function: fnLoadCsv  (Blank Query > Advanced Editor > paste > name it fnLoadCsv)
// Loads one CSV from DataFolder, UTF-8, promotes headers, trims text.
(fileName as text) as table =>
let
    Source   = Csv.Document(File.Contents(DataFolder & fileName), [Delimiter = ",", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Trimmed  = Table.TransformColumns(Promoted, List.Transform(Table.ColumnNames(Promoted), each {_, Text.Trim, type text}))
in
    Trimmed
