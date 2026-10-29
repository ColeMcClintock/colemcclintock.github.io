// DimDate (name the query: Date). Daily, contiguous, federal fiscal year (Oct-Sep).
// After loading: Table tools > Mark as date table > Date column = Date.
let
    StartDate = #date(2024, 10, 1),
    EndDate   = #date(2027, 9, 30),
    Dates     = List.Dates(StartDate, Duration.Days(EndDate - StartDate) + 1, #duration(1, 0, 0, 0)),
    T0        = Table.FromList(Dates, Splitter.SplitByNothing(), {"Date"}, null, ExtraValues.Error),
    Typed     = Table.TransformColumnTypes(T0, {{"Date", type date}}),
    AddMonth  = Table.AddColumn(Typed, "MonthStart", each Date.StartOfMonth([Date]), type date),
    AddYear   = Table.AddColumn(AddMonth, "Year", each Date.Year([Date]), Int64.Type),
    AddMNum   = Table.AddColumn(AddYear, "Month Number", each Date.Month([Date]), Int64.Type),
    AddMName  = Table.AddColumn(AddMNum, "Month", each Date.ToText([Date], "MMM yyyy"), type text),
    AddFY     = Table.AddColumn(AddMName, "Fiscal Year", each "FY" & Text.End(Text.From(if Date.Month([Date]) >= 10 then Date.Year([Date]) + 1 else Date.Year([Date])), 2), type text),
    AddFYM    = Table.AddColumn(AddFY, "Fiscal Month", each Number.Mod(Date.Month([Date]) + 2, 12) + 1, Int64.Type),
    AddFQ     = Table.AddColumn(AddFYM, "Fiscal Quarter", each "Q" & Text.From(Number.RoundUp([Fiscal Month] / 3)), type text),
    AddMonKey = Table.AddColumn(AddFQ, "YearMonth", each Date.Year([Date]) * 100 + Date.Month([Date]), Int64.Type)
in
    AddMonKey
// Sort "Month" by "YearMonth" (Column tools > Sort by column).
