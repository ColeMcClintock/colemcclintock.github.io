// DimOrganization: battalion-level fund holders used by the finance facts
let
    Units   = Table.SelectColumns(DimUnit, {"battalion", "brigade"}),
    FromBn  = Table.RenameColumns(Table.Distinct(Units), {{"battalion", "organization"}}),
    FromSOF = Table.Distinct(Table.SelectColumns(FactFunds, {"organization", "brigade"})),
    Combined = Table.Distinct(Table.Combine({FromBn, FromSOF}), {"organization"})
in
    Combined
