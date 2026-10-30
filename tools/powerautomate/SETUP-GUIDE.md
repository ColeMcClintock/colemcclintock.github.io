# Power Automate setup guide: Safety Mishap Dashboard auto-refresh

A scheduled cloud flow reads every Excel tracker in your restricted SharePoint library, puts the rows into a copy of the dashboard template, and saves the result as `SAFETY-REAL-DATA.html` in the same library. Your home page button opens that file, so nobody has to load Excel files.

The dashboard handles the rest just like a manual upload. It cleans every column, works out the fiscal year from Accident Date (1 Oct starts the new FY), and removes duplicates across the trackers and the roll-up. It also shows the red real-data banner with "Data refreshed <time> (automatic)".

It uses standard connectors only: **Schedule (Recurrence)**, **Variables**, **SharePoint**, **Excel Online (Business)**, and **Data Operations**. There are no premium connectors, no HTTP connector, and no gateway.

---

## What the finished library looks like

| File | What it is |
| --- | --- |
| `FY25 Tracker.xlsx`, `FY26 Tracker.xlsx`, ... | Your trackers. Each one has a Table named `MishapTracker`. |
| `FY26 Roll-up.xlsx` | The roll-up. It also has a Table named `MishapTracker`. |
| `dashboard-template.html` | The template from this kit. The flow reads it and never changes it. |
| `SAFETY-REAL-DATA.html` | The output. The flow overwrites it on every run, and the home page button points here. |

The flow reads **every `.xlsx` file** in the folder. To add a new FY tracker later, drop it in with a `MishapTracker` table and the next run picks it up. You don't have to edit the flow.

---

## Part 1. Prerequisites (one time)

1. **Get the right portal.** Open Power Automate from the Office app launcher (the 9-dot waffle), or go there directly:
   - **DoD (Army DoD365):** `make.powerautomate.appsplatform.us` (classic: `flow.appsplatform.us`)
   - **GCC High:** `make.high.powerautomate.us` (classic: `high.flow.microsoft.us`)
   - If neither portal opens, use the launcher. It always sends you to your tenant's portal.
2. **Use the restricted library.** All files go in the restricted library (unique permissions, access requests on). The flow runs with the permissions of whoever creates it. That person needs at least **Edit** on the library.
3. **Turn on versioning (recommended).** Go to Library settings, then Versioning settings, and keep about 50 major versions. If a bad run ever writes a bad file, you can restore yesterday's from Version history.
4. **Use .xlsx files only.** If a tracker is `.xls`, `.xlsm` or `.csv`, open it in Excel and use **File > Save As > Excel Workbook (*.xlsx)**.
5. **Format each tracker's data as a Table named `MishapTracker`.** Do this in every tracker and in the roll-up:
   1. Open the file in Excel (desktop or web).
   2. Click any cell in the data, press **Ctrl+T**, make sure **My table has headers** is checked, and click **OK**.
   3. On the **Table Design** tab (top left), set **Table Name** to `MishapTracker` and press Enter.
   4. Make sure the table covers **all** rows and **all 45 columns** (plus any optional ones). New rows typed directly under the table extend it automatically.
   5. Keep the header row exactly as exported (`Accident #`, `CCIR #`, `ASMIS #`, `Accident Date`, ...). Header names must be unique. The dashboard matches headers the same way as a manual upload, so column order doesn't matter.
   6. Save and close.
   - A blank, ready-made `MishapTracker` table is included as `templates/asmis_tracker_table.xlsx`.
   - Excel only lets a table name exist once *per workbook*. Every file can still use `MishapTracker`.
6. **Upload the template.** Upload `dashboard-template.html` from this kit to the library.
7. **Create the output file once.** Upload a second copy of `dashboard-template.html` and rename it in SharePoint to `SAFETY-REAL-DATA.html`. Until the first run, it shows the fictional demo data. After that, the flow overwrites it.

> **Data rules.** `SAFETY-REAL-DATA.html` contains the real records in readable form. Keep it only in the restricted library. Never email it, post it, or put it in a code repository or a public site. `dashboard-template.html` contains only fictional demo data.

---

## Part 2. Build the flow

Keep the default action names shown below. The expressions refer to them by name (spaces become underscores). If you rename an action, change its name in every expression that uses it.

### Step 1. Create a scheduled cloud flow

1. Go to **+ Create**, then **Scheduled cloud flow**.
2. Set **Flow name** to `Safety dashboard refresh`.
3. Set **Starting** to today at 06:00, **Repeat every** to `1` **Day**, and click **Create**.
4. Click the **Recurrence** trigger and set:
   - **Interval:** `1`, **Frequency:** `Day`
   - **Time zone:** `(UTC-06:00) Central Time (US & Canada)`. This follows daylight saving time automatically.
   - **At these hours:** `6` and `12`. Add more if you want, for example `6`, `12`, `16`.
   - **At these minutes:** `0`
   - The preview line should read "Runs at 6:00, 12:00 every day".

### Step 2. Initialize variable

1. Click **+ New step** and add **Variables > Initialize variable**.
2. Fill it in:
   - **Name:** `payload`
   - **Type:** `Array`
   - **Value:** `[]`
3. This action has to sit at the top level, directly under Recurrence. Variables can't be initialized inside a loop.

### Step 3. Get files (properties only)

1. Add **SharePoint > Get files (properties only)**.
2. Fill it in:
   - **Site Address:** pick your site.
   - **Library Name:** pick the restricted library.
   - Open **advanced parameters** (Show all).
   - **Limit Entries to Folder:** pick the folder that holds the trackers. Leave it blank if they're at the library root.
   - **Include Nested Items:** `No`
   - **Filter Query:** leave blank. The next step filters to `.xlsx`.
3. Open **Settings** and turn **Pagination** on with **Threshold** `5000`. This only matters if the library has more than 100 files.

### Step 4. Filter array (keep only .xlsx workbooks)

1. Add **Data Operations > Filter array**.
2. Set **From** with an expression (click in the box, choose **fx** / Expression, paste, and click **Add**/**OK**):

   ```
   body('Get_files_(properties_only)')?['value']
   ```

3. Click **Edit in advanced mode** and paste:

   ```
   @and(endsWith(toLower(item()?['{FilenameWithExtension}']), '.xlsx'), not(startsWith(item()?['{FilenameWithExtension}'], '~$')), equals(item()?['{IsFolder}'], false))
   ```

   This keeps `.xlsx` files and skips folders and Excel's temporary `~$` lock files. `dashboard-template.html` and `SAFETY-REAL-DATA.html` are skipped automatically.

### Step 5. Apply to each (one pass per workbook)

1. Add **Control > Apply to each**. In the new designer it may be called **For each**, and either one works.
2. Set **Select an output from previous steps** to this expression:

   ```
   body('Filter_array')
   ```

3. Open **Settings**. Leave **Concurrency Control** **off** so files run one at a time, in order.

Add the next two actions **inside** the loop.

#### Step 5a. List rows present in a table (inside the loop)

1. Add **Excel Online (Business) > List rows present in a table**.
2. Fill it in:
   - **Location:** your SharePoint site (pick from the list).
   - **Document Library:** the restricted library.
   - **File:** use this expression:

     ```
     item()?['{Identifier}']
     ```

   - **Table:** click the box, choose **Enter custom value**, and type `MishapTracker`.
   - Open **advanced parameters**:
     - **DateTime Format:** `ISO 8601`. The dashboard also reads Excel serial numbers and "15-Oct-25" text, but ISO 8601 is the cleanest.
     - Leave Filter Query, Order By, Top Count, and Skip Count blank.
3. Open **Settings**:
   - Turn **Pagination** **On** and set **Threshold** to `5000`. Without this, Excel Online returns only the first **256** rows.
   - **Retry Policy:** `Exponential interval`, Count `4`, Interval `PT1M`. This rides out a file that's briefly locked while someone saves it.

> **Fallback if a file's table isn't named `MishapTracker`:** add **Excel Online (Business) > Get tables** above this step, with the same Location, Library and File. Then set **Table** to the expression `first(body('Get_tables')?['value'])?['id']`. That reads the workbook's first table, whatever it's named. Use one fixed name if you can, because a stray second table can get picked by mistake.

#### Step 5b. Append to array variable (inside the loop)

1. Add **Variables > Append to array variable**.
2. Fill it in:
   - **Name:** `payload`
   - **Value:** use this expression, as one line:

     ```
     addProperty(addProperty(addProperty(json('{}'), 'file', item()?['{FilenameWithExtension}']), 'modified', item()?['Modified']), 'rows', body('List_rows_present_in_a_table')?['value'])
     ```

   Each file becomes `{"file": "FY26 Tracker.xlsx", "modified": "2026-10-29T14:02:11Z", "rows": [ ... ]}`. The dashboard keeps the files separate, so per-file load reports, "Show duplicates removed", and the newest-file-wins tie-breaker all work exactly as they do when you load the files by hand.

Close the loop. The remaining steps go **below** it, outside the loop.

### Step 6. Get file content (the template)

1. Add **SharePoint > Get file content**.
2. Fill it in:
   - **Site Address:** your site.
   - **File Identifier:** click the folder icon and browse to `dashboard-template.html`.
   - **Infer Content Type** (advanced parameter): `No`. The content then always comes back as `{"$content-type": ..., "$content": "<base64>"}`, so the expression in Step 7 decodes it the same way every time.

### Step 7. Compose (build the dashboard file)

1. Add **Data Operations > Compose**.
2. Set **Inputs** to this expression, as one line:

   ```
   replace(replace(base64ToString(body('Get_file_content')?['$content']), '__PA_REFRESHED__', convertFromUtc(utcNow(), 'Central Standard Time', 'dd-MMM-yy HHmm')), '__PA_DATA__', replace(string(variables('payload')), '</', '<\/'))
   ```

   Working from the inside out:
   - `base64ToString(body('Get_file_content')?['$content'])` returns the template's text.
   - `string(variables('payload'))` turns all the rows into JSON.
   - `replace(..., '</', '<\/')` makes sure a Summary that contains text like `</script>` can't break the page. `<\/` is still a valid JSON escape, so the data is unchanged. In the expression editor you type it exactly as shown: one backslash, no doubling.
   - `convertFromUtc(utcNow(), 'Central Standard Time', 'dd-MMM-yy HHmm')` produces something like `30-Oct-26 1200`. `Central Standard Time` is the Windows zone ID for US Central and switches to daylight time automatically. The inner `replace` stamps it into `__PA_REFRESHED__`, and the banner then reads "Data refreshed 30-Oct-26 1200 (automatic)".
   - The outer `replace` puts the JSON where the template says `__PA_DATA__`. That placeholder appears exactly once in the template. The timestamp goes in first, so text inside your data is never touched.
   - **If Compose fails with an error about `base64ToString`**, your tenant returned plain text even with Infer Content Type set to No. Replace `base64ToString(body('Get_file_content')?['$content'])` with `string(body('Get_file_content'))` and leave everything else the same.

### Step 8. Update file (overwrite SAFETY-REAL-DATA.html)

1. Add **SharePoint > Update file**.
2. Fill it in:
   - **Site Address:** your site.
   - **File Identifier:** click the folder icon and browse to `SAFETY-REAL-DATA.html` (the copy you uploaded in Part 1, step 7).
   - **File Content:** the expression `outputs('Compose')`, or pick **Outputs** of Compose from Dynamic content.
3. Update file replaces the content and keeps the same file, link, and permissions, so the home page button never breaks. If versioning is on, every run is also a restorable version.

> **Alternative:** use **SharePoint > Create file** (Folder Path = the library, File Name = `SAFETY-REAL-DATA.html`, File Content = `outputs('Compose')`). By default, Create file **fails** if the file already exists. It only overwrites if you turn **Allow chunking** **off** in its Settings, and Microsoft doesn't document that behavior. Update file is the reliable option.

### Step 9. Save

Click **Save**. Your flow should look like this, top to bottom:

```
Recurrence (6, 12 Central)
Initialize variable            payload = []
Get files (properties only)    library / folder
Filter array                   .xlsx only
Apply to each  (body('Filter_array'))
    List rows present in a table   File = item()?['{Identifier}'], Table = MishapTracker, ISO 8601, pagination 5000
    Append to array variable       {file, modified, rows}
Get file content               dashboard-template.html, Infer Content Type = No
Compose                        replace(...)
Update file                    SAFETY-REAL-DATA.html = outputs('Compose')
```

---

## Part 3. Test it

1. Click **Test**, choose **Manually**, then **Test** and **Run flow**. Open the run when it finishes.
2. Every step should have a green check. Then check these outputs:
   - **Filter array:** the body lists only your `.xlsx` files.
   - **List rows present in a table**, in each loop iteration (use the `<` and `>` arrows on the loop): the output `value` holds that file's rows. The count should match the rows in the Excel table.
   - **Compose:** the output is a long HTML document. It should **not** contain `__PA_DATA__`, and near the end you should see your data starting with `[{"file":`.
3. In the library, download `SAFETY-REAL-DATA.html` and open it in Edge. You should see:
   - The red banner: "Contains real data..." and "Data refreshed 30-Oct-26 1200 (automatic) · N records from 2 source files: ..."
   - The footer: "Showing data loaded from your files on this device. Nothing is uploaded."
   - **Show details** lists each Excel file with its row count and column matches, plus "Combined: N accidents" and any duplicates removed.
4. **Cross-check once:** open `dashboard-template.html` on your computer and load the same Excel files by hand. The accident count, duplicates removed, and FY totals should match the automatic file exactly.
5. **Save with data**, **Add more files** and **Clear** all still work in the automatic file. **Clear** goes back to the automatic data.

---

## Part 4. Point the home page button at it

1. In the library, click **⋯** next to `SAFETY-REAL-DATA.html` and choose **Copy link**.
2. Click the link settings (the gear, or "People you choose...") and choose **People with existing access**, then **Apply** and **Copy**.
3. On the home page, click **Edit**, select your **Quick links** web part (or add one), and click **+ Add link**. Paste the link, then set the title to `Safety Mishap Dashboard`, pick a thumbnail, and click **Republish**.
4. Users with access click the tile and open the file. SharePoint usually downloads `.html` files instead of opening them in the browser, so they open it from Downloads (or the Edge download bar). Users without access get the "Request access" page.

---

## Part 5. Keep it running

- **Ownership.** A flow stops when its owner's account is disabled. Open the flow and go to **Share** (or Edit, under Owners), then add a **co-owner**, such as a teammate or the safety office's shared or service account if your tenant allows one. Co-owners can fix it, and their connections can take over. Also write down who owns it in your continuity book.
- **Connections.** The SharePoint and Excel connections run as the person who created them. If that person loses access to the library, the flow fails. A co-owner can switch the connections to their own account under Edit > each action > ⋯ > My connections.
- **Failure emails.** Power Automate emails the owners when a flow keeps failing. Check **My flows > Safety dashboard refresh > Run history** after any change.
- **Safe failure.** If any step fails, Update file doesn't run, and `SAFETY-REAL-DATA.html` keeps the last good data. The banner time tells users how fresh it is.
- **Adding next year's tracker.** Drop `FY27 Tracker.xlsx` (with a `MishapTracker` table) into the same folder. No flow edits are needed.
- **Updating the dashboard.** When you get a new `dashboard-template.html`, upload it over the old one, keeping the same name. The next run uses it.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| **"No table was found with the name 'MishapTracker'"** (or a 404 error) on List rows | That workbook has no table with that exact name. Open it, click in the data, and on Table Design set Table Name = `MishapTracker`. Check for typos and spaces. Files that aren't trackers belong in a different folder. Or use the **Get tables** fallback in Step 5a. |
| Only 256 rows per file | Pagination is off on **List rows present in a table**. Turn it on in Settings, threshold `5000`. |
| A file has more than 5,000 rows | Raise the pagination threshold (your license allows up to 100,000). Or split old years into their own FY files, which is cleaner anyway. |
| **"The file is locked for shared use"** or a 423/409 error | Someone had the workbook open in desktop Excel while saving, or it was checked out. The retry policy usually handles this. If not, the run fails and the old dashboard stays in place until the next run. Ask editors to use Excel for the web, or to close the file when they're done. If the library requires check-out, check the trackers back in. |
| Wrong or missing dates | Set **DateTime Format = ISO 8601** on List rows. The dashboard also reads serial numbers like `46310` and text like `15-Oct-25`. Rows whose Accident Date is blank or unreadable are listed under Show details. |
| Banner says "Automatic refresh data could not be read" | The Compose output didn't contain valid JSON. Check that the Compose expression is exactly as shown, that `payload` is an **Array** variable, and that Append to array variable uses the `addProperty(...)` expression, not plain text. |
| The page shows **fictional demo data** and no red banner | The placeholder wasn't replaced. Look at the Compose output for `__PA_DATA__`. The usual causes are a different template file, or a typo in `'__PA_DATA__'` (two underscores on each side). |
| `base64ToString` error in Compose | Set Infer Content Type = No on Get file content, or use `string(body('Get_file_content'))`. See Step 7. |
| `InvalidTemplate` / "unable to process template language expressions" | An action was renamed, or quotes were changed into curly quotes when pasting. Retype the straight quotes `'`, and match the action names in `body('...')`. |
| The file **downloads** instead of opening | That's SharePoint's normal behavior for `.html` in DoD365. Users open it from Downloads. A SharePoint admin can sometimes allow in-browser HTML for one library, but don't count on it. |
| Edge says "File not found" when opening the download | OneDrive or security software moved it. Open Edge, press Ctrl+O, and pick the file, or save it to a local folder. |
| Flow is disabled or "connection expired" | The owner left or their password or access changed. A co-owner fixes the connections (see Part 5). |
| Where to see what happened | **My flows > Safety dashboard refresh > 28-day run history**. Click a run, then a step, and **Show raw inputs/outputs**. |

---

## Quick copy sheet

| Where | Paste |
| --- | --- |
| Filter array, From | `body('Get_files_(properties_only)')?['value']` |
| Filter array, advanced mode | `@and(endsWith(toLower(item()?['{FilenameWithExtension}']), '.xlsx'), not(startsWith(item()?['{FilenameWithExtension}'], '~$')), equals(item()?['{IsFolder}'], false))` |
| Apply to each, output | `body('Filter_array')` |
| List rows, File | `item()?['{Identifier}']` |
| List rows, Table | `MishapTracker` (custom value) |
| Get tables fallback, Table | `first(body('Get_tables')?['value'])?['id']` |
| Append to array, Value | `addProperty(addProperty(addProperty(json('{}'), 'file', item()?['{FilenameWithExtension}']), 'modified', item()?['Modified']), 'rows', body('List_rows_present_in_a_table')?['value'])` |
| Compose, Inputs | `replace(replace(base64ToString(body('Get_file_content')?['$content']), '__PA_REFRESHED__', convertFromUtc(utcNow(), 'Central Standard Time', 'dd-MMM-yy HHmm')), '__PA_DATA__', replace(string(variables('payload')), '</', '<\/'))` |
| Compose, plain-text fallback | `replace(replace(string(body('Get_file_content')), '__PA_REFRESHED__', convertFromUtc(utcNow(), 'Central Standard Time', 'dd-MMM-yy HHmm')), '__PA_DATA__', replace(string(variables('payload')), '</', '<\/'))` |
| Update file, File Content | `outputs('Compose')` |

## Payload format (for reference)

The template accepts any of these shapes:

- `[{"file": "FY26 Tracker.xlsx", "modified": "2026-10-29T14:02:11Z", "rows": [{"Accident #": "2600001", "Accident Date": "2025-10-15T00:00:00.000Z", ...}]}, ...]`. This is the recommended shape, and it's what the flow above builds.
- A flat array of row objects, `[{"Accident #": ..., ...}, ...]`. It's treated as one source.
- Excel Online's raw body, `{"value": [ ... ]}`.

Keys are the column headers. The `@odata.etag` and `ItemInternalId` keys that Excel Online adds are ignored. Values may be text or numbers. Dates may be ISO 8601, Excel serial numbers, or `dd-MMM-yy` text. Files are processed oldest `modified` first, so when duplicate records tie, the most recently modified file wins, the same as a manual upload.
