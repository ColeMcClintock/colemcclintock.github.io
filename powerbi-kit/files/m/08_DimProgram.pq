// DimProgram: program codes and appropriation
let
    Source  = Table.Distinct(Table.SelectColumns(FactFunds, {"program_code", "program_name", "appropriation"}), {"program_code"}),
    AddName = Table.AddColumn(Source, "Appropriation Name", each
        if [appropriation] = "NGPA" then "NGPA - Pay & Allowances"
        else if [appropriation] = "OMNG" then "OMNG - Operation & Maintenance"
        else if [appropriation] = "MCNG" then "MCNG - Military Construction"
        else if [appropriation] = "STATE" then "State Funds" else [appropriation], type text),
    AddLife = Table.AddColumn(AddName, "Funds Life", each if [appropriation] = "MCNG" then "Multi-year" else "One-year", type text)
in
    AddLife
