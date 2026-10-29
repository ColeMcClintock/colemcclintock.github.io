// FactAccident: ONE ASMIS export (query name: FactAccident). Requires fnCleanASMIS (18_fnCleanASMIS.pq)
// and the ASMISFile parameter (19_ASMISFile_parameter.pq). For several FY files, use 22_FactAccident_Folder.pq instead.
let
    Path   = ASMISFile,
    IsCsv  = Text.EndsWith(Text.Lower(Path), ".csv"),
    Result = fnCleanASMIS(File.Contents(Path), IsCsv),
    AddSrc = Table.AddColumn(Result, "Source File", each Path, type text)
in
    AddSrc
// Optional privacy step: Table.RemoveColumns(AddSrc, {"Gender", "Rank", "Age", "Years of Service"}, MissingField.Ignore)
// Keep the report in an approved workspace; ASMIS data is controlled.
