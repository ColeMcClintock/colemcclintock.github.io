// Folder load pattern: combine every monthly extract dropped into a folder
// (e.g. readiness_2026-09.csv, readiness_2026-10.csv ...). Name the query FactReadiness_Folder.
let
    Source    = Folder.Files(DataFolder & "readiness_extracts\"),
    CsvOnly   = Table.SelectRows(Source, each Text.Lower([Extension]) = ".csv" and not Text.StartsWith([Name], "~")),
    Parsed    = Table.AddColumn(CsvOnly, "Data", each Table.PromoteHeaders(Csv.Document([Content], [Delimiter = ",", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]), [PromoteAllScalars = true])),
    KeepCols  = Table.SelectColumns(Parsed, {"Name", "Data"}),
    Expanded  = Table.ExpandTableColumn(KeepCols, "Data", Table.ColumnNames(KeepCols{0}[Data])),
    Renamed   = Table.RenameColumns(Expanded, {{"Name", "source_file"}})
    // then apply the same typing steps as 10_FactReadiness.pq
in
    Renamed
