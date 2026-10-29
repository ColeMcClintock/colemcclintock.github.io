// FactAccident: ASMIS accident export, one row per accident (query name: FactAccident)
// Reads the first non-"Strength" sheet of an .xlsx (or a .csv), finds the header row,
// cleans header names, renames Tech -> MSC, parses DD-Mon-YY dates (en-US), types currency,
// and adds Due Date / Is Open / Days Overdue (Calc) / Fiscal Year when blank or missing.
let
    Path    = ASMISFile,
    IsCsv   = Text.EndsWith(Text.Lower(Path), ".csv"),

    // ---- 1. raw table (header row = first row that contains "Accident Date") ----
    RawGrid = if IsCsv
        then Csv.Document(File.Contents(Path), [Delimiter = ",", Encoding = 65001, QuoteStyle = QuoteStyle.Csv])
        else
            let
                Book   = Excel.Workbook(File.Contents(Path), null, true),
                Sheets = Table.SelectRows(Book, each [Kind] = "Sheet" and Text.Lower(Text.Trim([Name])) <> "strength")
            in
                Sheets{0}[Data],
    RowHasHeader = List.Transform(Table.ToRows(RawGrid),
        (r) => List.AnyTrue(List.Transform(r, (v) => Text.Lower(Text.Trim(Text.From(v ?? ""))) = "accident date"))),
    HeaderPos = List.PositionOf(RowHasHeader, true),
    Promoted  = Table.PromoteHeaders(Table.Skip(RawGrid, if HeaderPos < 0 then 0 else HeaderPos), [PromoteAllScalars = true]),
    NonBlank  = Table.SelectRows(Promoted, each List.NonNullCount(List.Select(Record.FieldValues(_), (v) => v <> "")) > 0),

    // ---- 2. header cleanup: strip *, non-breaking spaces, repeated spaces ----
    CleanName = (h as text) as text =>
        Text.Combine(List.Select(Text.Split(Text.Trim(Text.Replace(Text.Replace(h, "*", ""), "#(00A0)", " ")), " "), (p) => p <> ""), " "),
    Cleaned = Table.TransformColumnNames(NonBlank, CleanName),

    // ---- 3. canonical names (case-insensitive) + known variants; Tech -> MSC ----
    Canonical = {"Accident #", "CCIR #", "ASMIS #", "ASMIS Investigation Created By", "Unit UIC", "MSC", "Battalion",
        "Accident Class", "Status", "Accident Age", "Accident Date", "Due Date", "Days Overdue", "Compl. Date", "Day of Week",
        "Time of Day", "On Duty", "Duty Status", "Gender", "Years of Service", "Rank", "Age", "Reported Via", "Injury Y/N",
        "No Lost Time Injury", "Days Away from Work", "Days Hospitalized", "Days Restricted", "Days Lost",
        "Days Away from Work Cost", "Days Hospitalized Cost", "Perm. Partial Disability Cost", "Perm. Total Disability Cost",
        "Fatality Cost", "Injury Cost", "Property Damage Y/N", "Material ECOD", "Total Accident Cost", "Accident Subtype",
        "Cause Subtype", "Mistake Type", "HFACS Category", "HFACS Failure", "HFACS Subfailure", "Summary"},
    Variants = {
        {"tech", "MSC"}, {"accident number", "Accident #"}, {"ccir", "CCIR #"}, {"ccir number", "CCIR #"},
        {"asmis", "ASMIS #"}, {"asmis number", "ASMIS #"}, {"uic", "Unit UIC"}, {"class", "Accident Class"},
        {"compl date", "Compl. Date"}, {"completion date", "Compl. Date"}, {"completed date", "Compl. Date"},
        {"injury (y/n)", "Injury Y/N"}, {"injury", "Injury Y/N"}, {"property damage", "Property Damage Y/N"},
        {"property damage (y/n)", "Property Damage Y/N"}, {"ecod", "Material ECOD"}, {"material ecod cost", "Material ECOD"},
        {"perm partial disability cost", "Perm. Partial Disability Cost"}, {"perm total disability cost", "Perm. Total Disability Cost"},
        {"hfacs sub failure", "HFACS Subfailure"}, {"hfacs sub-failure", "HFACS Subfailure"}},
    Lookup = List.Transform(Canonical, (c) => {Text.Lower(c), c}) & Variants,
    HasMSC = List.Contains(List.Transform(Table.ColumnNames(Cleaned), Text.Lower), "msc"),
    DropTech = if HasMSC then Table.RemoveColumns(Cleaned, List.Select(Table.ColumnNames(Cleaned), (c) => Text.Lower(c) = "tech")) else Cleaned,
    Renames = List.Select(
        List.Transform(Table.ColumnNames(DropTech), (c) =>
            let hit = List.First(List.Select(Lookup, (p) => p{0} = Text.Lower(c)), null)
            in if hit = null then null else {c, hit{1}}),
        (p) => p <> null and p{0} <> p{1}),
    Renamed = Table.RenameColumns(DropTech, Renames, MissingField.Ignore),

    // ---- 4. typing helpers ----
    MonthNo = [jan = 1, feb = 2, mar = 3, apr = 4, may = 5, jun = 6, jul = 7, aug = 8, sep = 9, oct = 10, nov = 11, dec = 12],
    fnDate = (v) as nullable date =>
        if v = null or v = "" then null
        else if Value.Is(v, type date) then v
        else if Value.Is(v, type datetime) then Date.From(v)
        else if Value.Is(v, type number) then Date.From(v)                       // Excel serial
        else
            let
                t = Text.Trim(Text.From(v)),
                p = Text.Split(Text.Replace(t, " ", "-"), "-"),
                ddMonYY = try (
                    let y = Number.From(p{2}),
                        yyyy = if y < 100 then (if y < 70 then 2000 + y else 1900 + y) else y
                    in #date(yyyy, Record.Field(MonthNo, Text.Lower(Text.Start(p{1}, 3))), Number.From(p{0}))) otherwise null
            in
                if ddMonYY <> null then ddMonYY
                else try Date.From(Date.FromText(t, [Culture = "en-US"])) otherwise null,
    fnMoney = (v) as nullable number =>
        if v = null or v = "" then null
        else if Value.Is(v, type number) then v
        else
            let t = Text.Trim(Text.From(v)),
                neg = Text.StartsWith(t, "(") or Text.StartsWith(t, "-"),
                n = try Number.FromText(Text.Remove(t, {"$", ",", " ", "(", ")", "-"}), "en-US") otherwise null
            in if n = null then null else (if neg then -n else n),
    fnYN = (v) as nullable text =>
        let t = Text.Upper(Text.Trim(Text.From(v ?? ""))) in
        if List.Contains({"Y", "YES", "TRUE", "1"}, t) then "Y" else if List.Contains({"N", "NO", "FALSE", "0"}, t) then "N" else null,
    fnClass = (v) as nullable text =>
        let t = Text.Trim(Text.Replace(Text.Upper(Text.From(v ?? "")), "CLASS", "")) in if t = "" then null else Text.Start(t, 1),

    Present   = (cols as list) => List.Intersect({cols, Table.ColumnNames(Renamed)}),
    DateCols  = Present({"Accident Date", "Due Date", "Compl. Date"}),
    MoneyCols = Present({"Days Away from Work Cost", "Days Hospitalized Cost", "Perm. Partial Disability Cost",
                         "Perm. Total Disability Cost", "Fatality Cost", "Injury Cost", "Material ECOD", "Total Accident Cost"}),
    IntCols   = Present({"Accident Age", "Days Overdue", "Years of Service", "Age", "Days Away from Work", "Days Hospitalized",
                         "Days Restricted", "Days Lost"}),
    YNCols    = Present({"On Duty", "Injury Y/N", "No Lost Time Injury", "Property Damage Y/N"}),
    TextCols  = Present({"Accident #", "CCIR #", "ASMIS #", "Unit UIC", "MSC", "Battalion", "Status",
                         "Duty Status", "Accident Subtype", "Cause Subtype", "HFACS Category", "HFACS Failure", "HFACS Subfailure"}),

    T1 = Table.TransformColumns(Renamed, List.Transform(DateCols,  (c) => {c, fnDate, type nullable date})),
    T2 = Table.TransformColumns(T1, List.Transform(MoneyCols, (c) => {c, fnMoney, Currency.Type})),
    T3 = Table.TransformColumns(T2, List.Transform(IntCols,   (c) => {c, (v) => let n = fnMoney(v) in if n = null then null else Number.Round(n), Int64.Type})),
    T4 = Table.TransformColumns(T3, List.Transform(YNCols,    (c) => {c, fnYN, type nullable text})),
    T5 = Table.TransformColumns(T4, List.Transform(TextCols,  (c) => {c, (v) => if v = null then null else Text.Trim(Text.From(v)), type nullable text})),
    T6 = if List.Contains(Table.ColumnNames(T5), "Accident Class") then Table.TransformColumns(T5, {{"Accident Class", fnClass, type nullable text}}) else T5,
    ValidDate = Table.SelectRows(T6, each [Accident Date] <> null),            // rows with unreadable dates are dropped

    // ---- 5. derived columns (refresh date = today) ----
    Today   = Date.From(DateTime.LocalNow()),
    AddDue  = Table.AddColumn(ValidDate, "Due Date (Calc)",
                each if Record.HasFields(_, "Due Date") and [Due Date] <> null then [Due Date] else Date.AddDays([Accident Date], 90), type date),
    AddOpen = Table.AddColumn(AddDue, "Is Open",
                each if Record.HasFields(_, "Status") then [Status] <> "Final" else not (Record.HasFields(_, "Compl. Date") and [Compl. Date] <> null), type logical),
    AddOver = Table.AddColumn(AddOpen, "Days Overdue (Calc)",
                each if not [Is Open] then 0
                     else if Record.HasFields(_, "Days Overdue") and [Days Overdue] <> null then [Days Overdue]
                     else List.Max({0, Duration.Days(Today - [#"Due Date (Calc)"])}), Int64.Type),
    AddFY   = Table.AddColumn(AddOver, "Fiscal Year",
                each "FY" & Text.End(Text.From(if Date.Month([Accident Date]) >= 10 then Date.Year([Accident Date]) + 1 else Date.Year([Accident Date])), 2), type text),
    fnHour  = (v) as nullable number =>                                          // "0715", "07:15", 715, Excel time
                if v = null or v = "" then null
                else if Value.Is(v, type time) then Time.Hour(v)
                else if Value.Is(v, type datetime) then Time.Hour(DateTime.Time(v))
                else if Value.Is(v, type number) and v < 1 then Number.RoundDown(v * 24)
                else try Number.IntegerDivide(Number.From(Text.Start(Text.PadStart(Text.Remove(Text.From(v), {":", " "}), 4, "0"), 4)), 100) otherwise null,
    AddHour = if Table.HasColumns(AddFY, "Time of Day") then Table.AddColumn(AddFY, "Hour", each fnHour([Time of Day]), Int64.Type) else AddFY
in
    AddHour
// Optional privacy step: if demographic columns are not needed, add
//   Table.RemoveColumns(AddHour, {"Gender", "Rank", "Age", "Years of Service"}, MissingField.Ignore)
// Keep the report in an approved workspace; ASMIS data is controlled.
