// FactAccident from a FOLDER of ASMIS trackers (one per fiscal year, plus an optional roll-up). Query name: FactAccident
// Use this INSTEAD of 20_FactAccident_ASMIS.pq. Requires fnCleanASMIS (18_fnCleanASMIS.pq).
// Parameter ASMISFolder (Text), e.g. C:\Safety\ASMIS trackers\   (keep the trailing backslash)
// Same cleanup as the web dashboard, then de-duplication across AND within files:
//   match on Accident #, then CCIR #, then ASMIS # (IDs normalized: trim, upper case, no spaces, leading zeros);
//   rows with no IDs match on Accident Date + Unit UIC + Battalion + Accident Subtype + Cause Subtype.
//   Keep: Final > In Review NGB > Investigation Ongoing, then later Compl. Date, then more filled-in fields,
//   then the most recently modified file / later row.
let
    Files    = Folder.Files(ASMISFolder),
    Wanted   = Table.SelectRows(Files, each List.Contains({".xlsx", ".xlsm", ".csv"}, Text.Lower([Extension]))
                                    and not Text.StartsWith([Name], "~$")),          // skip Excel lock files
    Loaded   = Table.AddColumn(Wanted, "Data", each fnCleanASMIS([Content], Text.Lower([Extension]) = ".csv")),
    Tagged   = Table.AddColumn(Loaded, "Tagged", (f) =>
                   Table.AddIndexColumn(
                       Table.AddColumn(Table.AddColumn(f[Data], "Source File", each f[Name], type text),
                                       "Source Modified", each f[Date modified], type datetime),
                       "Source Row", 1, 1, Int64.Type)),
    Combined = Table.Combine(Tagged[Tagged]),                                         // matches columns by name, any order

    // ---- de-duplication keys ----
    NormId = (v) as nullable text =>
        let t0 = if v = null then "" else Text.Upper(Text.Remove(Text.From(v), {" ", "#(00A0)"})),
            t1 = if Text.EndsWith(t0, ".0") then Text.Start(t0, Text.Length(t0) - 2) else t0,
            parts = Text.Split(t1, "-"),
            trimmed = List.Transform(parts, (p) => if p <> "" and Text.Remove(p, {"0".."9"}) = "" then Text.From(Number.From(p)) else p)
        in if t1 = "" or t1 = "-" then null else Text.Combine(trimmed, "-"),
    Col = (r as record, c as text) => if Record.HasFields(r, c) then Record.Field(r, c) else null,
    WithKeys = Table.AddColumn(Combined, "Dedup Key", (r) =>
        let a = NormId(Col(r, "Accident #")), c = NormId(Col(r, "CCIR #")), s = NormId(Col(r, "ASMIS #"))
        in if a <> null then "A:" & a else if c <> null then "C:" & c else if s <> null then "S:" & s
           else "F:" & Text.Combine(List.Transform({Date.ToText(Col(r, "Accident Date"), "yyyy-MM-dd"), Col(r, "Unit UIC"), Col(r, "Battalion"),
                                                   Col(r, "Accident Subtype"), Col(r, "Cause Subtype")}, (x) => Text.Upper(Text.From(x ?? ""))), "|"), type text),
    WithRank = Table.AddColumn(WithKeys, "Status Rank", (r) =>
        let st = Col(r, "Status") in if st = "Final" then 3 else if st = "In Review NGB" then 2 else if st = "Investigation Ongoing" then 1 else 0, Int64.Type),
    WithFill = Table.AddColumn(WithRank, "Filled Fields", (r) => List.Count(List.Select(Record.FieldValues(r), (v) => v <> null and v <> "")), Int64.Type),
    Sorted   = Table.Buffer(Table.Sort(WithFill, {{"Dedup Key", Order.Ascending}, {"Status Rank", Order.Descending}, {"Compl. Date", Order.Descending},
                                                  {"Filled Fields", Order.Descending}, {"Source Modified", Order.Descending}, {"Source Row", Order.Descending}})),
    Deduped  = Table.Distinct(Sorted, {"Dedup Key"}),                                 // keeps the first (best) row per key
    Result   = Table.RemoveColumns(Deduped, {"Status Rank", "Filled Fields"})
in
    Result
// Notes
// - Records are matched on the FIRST available ID (Accident #, else CCIR #, else ASMIS #). If one file has Accident #
//   and another only CCIR # for the same accident, they are not merged here (the web dashboard also checks CCIR/ASMIS).
// - "Compl. Date" must exist in at least one file; if no file has it, delete that sort item.
// - Duplicates removed = Table.RowCount(Combined) - Table.RowCount(Result). Add a query for it to check refreshes.
