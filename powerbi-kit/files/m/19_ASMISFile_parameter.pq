// Parameter: ASMISFile  (full path to the ASMIS accident export, .xlsx or .csv)
// Home > Manage Parameters > New Parameter
//   Name: ASMISFile   Type: Text   Current value: C:\PowerBI\portfolio-kit\data\asmis_sample.xlsx
// At work, point it at the export saved in an approved location. Or paste this into a Blank Query named ASMISFile:
"C:\PowerBI\portfolio-kit\data\asmis_sample.xlsx" meta [IsParameterQuery = true, Type = "Text", IsParameterQueryRequired = true]

// For a folder of FY trackers, create a second parameter instead:
//   Name: ASMISFolder   Type: Text   Current value: C:\PowerBI\portfolio-kit\data\fy-trackers\   (trailing backslash)
