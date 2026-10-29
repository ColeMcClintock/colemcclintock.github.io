// FactFunds: program x organization x month status of funds
let
    Source = fnLoadCsv("status_of_funds.csv"),
    Typed  = Table.TransformColumnTypes(Source, {
        {"fy", type text}, {"month", type text}, {"appropriation", type text}, {"program_code", type text}, {"program_name", type text},
        {"brigade", type text}, {"organization", type text}, {"afp", Currency.Type}, {"allotment", Currency.Type},
        {"plan_obligations", Currency.Type}, {"commitments", Currency.Type}, {"obligations", Currency.Type},
        {"disbursements", Currency.Type}, {"tdy_obligations", Currency.Type}}, "en-US"),
    AddMonthStart = Table.AddColumn(Typed, "MonthStart", each Date.FromText([month] & "-01", [Format = "yyyy-MM-dd", Culture = "en-US"]), type date)
in
    AddMonthStart
