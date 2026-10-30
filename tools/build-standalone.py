#!/usr/bin/env python3
"""
Build offline copies of the dashboards from source.

For each dashboard this writes:
  downloads/<name>.html  one self-contained HTML file (CSS, JS, Chart.js, SheetJS, fictional demo data and
                         template files inlined). Double-click to run; makes no network requests.
  downloads/<name>.zip   folder version (index.html + assets) + the single file + templates + README
  downloads/safety-dashboard-template.html   Power Automate template (placeholders the flow fills with Excel rows)
  downloads/finance-dashboard-template.html  same for the Status of Funds dashboard
  downloads/safety-powerautomate-kit.zip     template + setup guide (md + printable html) + MishapTracker table template
  downloads/safety-powerautomate-guide.html  the setup guide on its own

Run from the repo root:  python3 tools/build-standalone.py
Standard-library Python only.
"""
import base64, csv, io, os, re, sys, zipfile
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "powerautomate"))
import mdlite

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "downloads")
MIME = {".csv": "text/csv;charset=utf-8", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".svg": "image/svg+xml", ".png": "image/png"}

PAGES = {
    "safety-dashboard": dict(dir="dashboards/safety", title="Safety & Mishaps Dashboard",
                             templates=["asmis_template.xlsx", "asmis_template.csv"], guide=True, save_prefix="SAFETY"),
    "readiness-dashboard": dict(dir="dashboards/readiness", title="Readiness Command Dashboard", templates=["readiness_template.csv"]),
    "finance-dashboard": dict(dir="dashboards/finance", title="Status of Funds Dashboard",
                              templates=["funds_template.xlsx", "funds_template.csv"], save_prefix="FUNDS", pa_template=True),
}

def read(p, mode="r"):
    with open(p, mode, **({} if "b" in mode else {"encoding": "utf-8"})) as f: return f.read()

def data_uri(path):
    ext = os.path.splitext(path)[1].lower()
    return "data:" + MIME.get(ext, "application/octet-stream") + ";base64," + base64.b64encode(read(path, "rb")).decode()

def common_rewrites(html):
    html = re.sub(r'<html lang="en">', '<html lang="en" data-standalone>', html, count=1)
    html = re.sub(r'<a [^>]*href="\.\./\.\./index\.html[^"]*"[^>]*>.*?</a>', "", html)   # no links back to the hosting site
    html = re.sub(r'href="\.\./\.\./downloads/[^"]+"', 'href="#"', html)
    return html

def build_single(page_dir, html):
    def css(m):
        return "<style>\n" + read(os.path.normpath(os.path.join(page_dir, m.group(1)))) + "\n</style>"
    def js(m):
        src = read(os.path.normpath(os.path.join(page_dir, m.group(1))))
        return "<script>\n" + src.replace("</script", "<\\/script") + "\n</script>"
    def icon(m):
        return '<link rel="icon" href="' + data_uri(os.path.normpath(os.path.join(page_dir, m.group(1)))) + '"'
    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', css, html)
    html = re.sub(r'<link rel="icon" href="([^"]+)"', icon, html)
    html = re.sub(r'<script src="([^"]+)"></script>', js, html)
    # local template downloads -> embedded data URIs
    def tmpl(m):
        p, rest = os.path.join(page_dir, m.group(1)), m.group(2) or ""
        if not os.path.exists(p): return m.group(0)
        name = os.path.basename(p)
        if re.search(r"\bdownload=", rest): dl = ""
        elif re.search(r"\bdownload\b", rest): rest, dl = re.sub(r"\bdownload\b", f'download="{name}"', rest, count=1), ""
        else: dl = f' download="{name}"'
        return f'href="{data_uri(p)}"{dl}{rest}'
    html = re.sub(r'href="([\w\-]+\.(?:csv|xlsx))"([^>]*)', tmpl, html)
    html = common_rewrites(html)
    assert not re.search(r'<(script|link)[^>]+(src|href)="(?!data:|#)', html), "unresolved local reference"
    assert not re.search(r'https?://', re.sub(r'<script>.*?</script>|<style>.*?</style>', '', html, flags=re.S)), "external URL in offline build"
    for sid in ("safety", "finance"):
        assert ('<script id="' + sid + 'Saved"') not in html, "embedded data found in a public build"
    return "<!-- Offline copy of the dashboard. Runs entirely in the browser; makes no network requests. -->\n" + html

def folder_files(page_dir, html):
    """Returns (index_html, {zip_path: source_path}) for the folder version."""
    files = {}
    def rel(m):
        attr, path = m.group(1), m.group(2)
        if path.startswith(("http", "#", "data:", "mailto:")) or path.startswith("../../downloads"):
            return m.group(0)
        src = os.path.normpath(os.path.join(page_dir, path))
        if not os.path.isfile(src): return m.group(0)
        z = path[len("../../"):] if path.startswith("../../") else path
        files[z] = src
        return f'{attr}="{z}"'
    html = re.sub(r'(src|href)="([^"]+)"', rel, html)
    return common_rewrites(html), files

def column_guide(page_dir):
    js = read(os.path.join(page_dir, "asmis-loader.js"))
    rows = re.findall(r'^\s*\["(\w+)", "([^"]+)", "(\w+)", \[[^\]]*\], "([^"]+)"(, true)?\]', js, re.M)
    buf = io.StringIO(); w = csv.writer(buf)
    w.writerow(["#", "Column (export header)", "Required", "Type", "Used for"])
    for i, (key, head, typ, used, opt) in enumerate(rows, 1):
        w.writerow([i, head, "Optional" if opt else "Yes", typ, used + (" (shown as MSC)" if key == "msc" else "")])
    return buf.getvalue()

README = """HOW TO USE AT WORK - {title} (offline copy)
Data shown at startup is fictional for demonstration. Not an official Iowa National Guard product.
When you load your own files, the footer switches to: "Showing data loaded from your files on this device. Nothing is uploaded."

WHAT'S HERE
  {name}.html          Single self-contained file. Double-click to open in Edge or Chrome.
  folder-version/index.html   Same dashboard as a folder of files (use if a single large file is blocked).
  templates/           Blank templates with the exact column headers.
{guide_line}
OPEN IT
  1. Unzip to your desktop or a SharePoint/OneDrive-synced folder on your computer.
  2. Double-click {name}.html. It runs entirely in the browser; it makes no network requests
     and needs no install. (Opening it inside the SharePoint web viewer will not run it; use the synced copy.)

LOAD YOUR DATA
  - Click "Load files" (or drag files onto the bar) and pick one or more Excel/CSV exports.
{multi_line}  - Files are read by this browser tab only. Nothing is uploaded or sent. Close the tab to clear it.
  - The load report ("Show details") lists rows loaded, columns matched, and anything that could not be read.

{save_block}PRESENTING / PRINTING
  - "Presentation mode" hides the loading and help panels (Esc exits). "Print / PDF" prints the dashboard.

DATA HANDLING
  Follow your organization's policies for the source data. Do not save real exports into a shared copy of this
  folder. The only thing the page remembers is whether the details panel was open (browser storage).
"""

SAVE_BLOCK = """SAVE A COPY WITH YOUR DATA BUILT IN (so others can open it without loading files)
  1. Open {name}.html and load your files. Check the load report.
  2. Click "Save with data". The browser downloads {prefix}-REAL-DATA-<date>.html (for example
     {prefix}-REAL-DATA-29Oct26.html) with the loaded records inside it. Nothing is uploaded.
  3. Put that file ONLY in the restricted SharePoint folder (unique permissions, access requests on).
     It contains real data: do not email it, post it, or put it in any code repository, website, or shared/public location.
  4. To update it: open the saved file, click "Load files" (or "Add more files") with the newer exports,
     then "Save with data" again and replace the old file in the restricted folder.
  The saved file shows a red "Contains real data" banner with the save date/time and source file names.
  "Clear" in a saved file goes back to its built-in data; "Restore demo data" shows the fictional data.

"""

NAME_RE = re.compile(r"mcclintock|\bcole\b|github", re.I)

def check_clean(label, text):
    # vendored library license comments (e.g. Chart.js color helper URL) are allowed
    scrub = re.sub(r"/\*!?[^*]*\*+(?:[^/*][^*]*\*+)*/", "", text)
    m = NAME_RE.search(scrub)
    assert not m, f"{label}: personal/portfolio reference found: {scrub[max(0, m.start()-40):m.end()+40]!r}"
    return text

ZIP_DATE = (2026, 1, 1, 0, 0, 0)   # fixed so rebuilding without changes gives identical zips
class Zip(zipfile.ZipFile):
    def writestr(self, name, data, *a, **k):
        if isinstance(name, str): name = zipfile.ZipInfo(name, ZIP_DATE); name.compress_type = zipfile.ZIP_DEFLATED; name.external_attr = 0o644 << 16
        return super().writestr(name, data, *a, **k)
    def write(self, src, arc=None, *a, **k):
        return self.writestr(arc or os.path.basename(src), read(src, "rb"))

def asciify(html):
    """Template is pure ASCII so the flow's base64ToString / string round-trip can never mangle characters.
    Non-ASCII inside <script> becomes \\uXXXX, inside <style> a CSS escape, elsewhere an HTML character reference."""
    def js(t): return "".join(c if ord(c) < 128 else "".join("\\u%04x" % u for u in _utf16(c)) for c in t)
    def css(t): return "".join(c if ord(c) < 128 else "\\%x " % ord(c) for c in t)
    def txt(t): return "".join(c if ord(c) < 128 else "&#x%x;" % ord(c) for c in t)
    out, pos = [], 0
    for m in re.finditer(r"(<script\b[^>]*>)(.*?)(</script>)|(<style\b[^>]*>)(.*?)(</style>)", html, re.S):
        out.append(txt(html[pos:m.start()]))
        out.append(m.group(1) + js(m.group(2)) + m.group(3) if m.group(1) else m.group(4) + css(m.group(5)) + m.group(6))
        pos = m.end()
    out.append(txt(html[pos:]))
    return "".join(out)
def _utf16(c):
    o = ord(c)
    if o < 0x10000: return [o]
    o -= 0x10000; return [0xD800 + (o >> 10), 0xDC00 + (o & 0x3FF)]

PA_DATA, PA_TS = "__PA_" + "DATA__", "__PA_" + "REFRESHED__"
PA_COMMENTS = {
    "safety": "<!-- Safety dashboard: Power Automate template. A scheduled flow replaces the two placeholders (refresh time in the head, "
              "Excel rows at the very end) and saves the result as SAFETY-REAL-DATA.html. Untouched, it shows fictional demo data. "
              "Runs entirely in the browser; makes no network requests. -->",
    "finance": "<!-- Status of Funds dashboard: Power Automate template. A scheduled flow replaces the two placeholders (refresh time in the head, "
               "Excel rows at the very end) and saves the result over the dashboard file in the restricted library. Untouched, it shows "
               "fictional demo data. Runs entirely in the browser; makes no network requests. -->",
}
def build_pa_template(single, kind="safety"):
    """Power Automate template: the single-file Safety dashboard plus two placeholders the flow replaces.
    Data goes in a raw-text <plaintext> element at the very end of the file: nothing after it is ever parsed as markup,
    so even unescaped '</script>' inside the JSON cannot break the page or run code."""
    t = asciify(single)
    t = t.replace("<!-- Offline copy of the dashboard. Runs entirely in the browser; makes no network requests. -->", PA_COMMENTS[kind], 1)
    t = t.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="pa-refreshed" content="' + PA_TS + '">', 1)
    i = t.rfind("</body>"); assert i > 0
    t = t[:i].rstrip() + '\n<plaintext id="embedded' + '-data" hidden>' + PA_DATA + "\n"
    assert t.count(PA_DATA) == 1 and t.count(PA_TS) == 1, "each placeholder must appear exactly once"
    assert all(ord(c) < 128 for c in t), "template must be ASCII"
    assert t.endswith(PA_DATA + "\n")
    return t

PA_README = """SAFETY DASHBOARD - POWER AUTOMATE AUTO-REFRESH KIT
Everything here is fictional demo data until your flow fills it in. No personal or external links.

WHAT'S HERE
  dashboard-template.html            Upload to the restricted SharePoint library (the flow reads it; never edit it there).
  POWER-AUTOMATE-SETUP-GUIDE.html    Step-by-step build guide (open in Edge; Print / PDF button at the top).
  POWER-AUTOMATE-SETUP-GUIDE.md      Same guide as plain text.
  EXPRESSIONS.txt                    Every expression to copy and paste into the flow.
  templates/asmis_tracker_table.xlsx Blank tracker already formatted as a Table named MishapTracker.

IN SHORT
  1. In every tracker and the roll-up: Ctrl+T, Table Name = MishapTracker, save as .xlsx.
  2. Upload dashboard-template.html, plus a copy renamed SAFETY-REAL-DATA.html, to the restricted library.
  3. Build the scheduled flow in the guide (Recurrence 0600/1200 Central -> list .xlsx files -> List rows (MishapTracker)
     -> append {file, rows} -> Get file content (template) -> Compose replace -> Update file SAFETY-REAL-DATA.html).
  4. Point the home page Quick links button at SAFETY-REAL-DATA.html (Copy link > People with existing access).

SAFETY-REAL-DATA.html contains real records: keep it only in the restricted library. Never email or post it.
"""

def expressions_txt(md):
    rows = re.findall(r"^\| ([^|]+?) \| `(.+)` \|$", md.split("## Quick copy sheet", 1)[1].split("## Payload", 1)[0], re.M)
    return "POWER AUTOMATE EXPRESSIONS - copy each into the Expression (fx) box of the named field\n\n" + "\n\n".join(f"{k}:\n  {v}" for k, v in rows) + "\n"

def build_pa_kit(single_safety):
    tmpl = check_clean("pa template", build_pa_template(single_safety))
    md = read(os.path.join(ROOT, "tools", "powerautomate", "SETUP-GUIDE.md"))
    guide = check_clean("pa guide", mdlite.render(md, "Power Automate setup guide - Safety dashboard auto-refresh"))
    for label, txt in (("pa guide md", md), ("pa guide html", guide)):
        check_clean(label, txt); assert not re.search(r"https?://", txt), label + ": external URL"
    exprs = expressions_txt(md); assert exprs.count("\n\n") >= 8, "expression sheet parse"
    with open(os.path.join(OUT, "safety-dashboard-template.html"), "w", encoding="ascii", newline="\n") as f: f.write(tmpl)
    with open(os.path.join(OUT, "safety-powerautomate-guide.html"), "w", encoding="utf-8") as f: f.write(guide)
    zpath = os.path.join(OUT, "safety-powerautomate-kit.zip"); d = "safety-powerautomate-kit/"
    with Zip(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(d + "dashboard-template.html", tmpl)
        z.writestr(d + "POWER-AUTOMATE-SETUP-GUIDE.html", guide)
        z.writestr(d + "POWER-AUTOMATE-SETUP-GUIDE.md", md)
        z.writestr(d + "EXPRESSIONS.txt", exprs)
        z.writestr(d + "README.txt", PA_README)
        z.write(os.path.join(ROOT, "dashboards", "safety", "asmis_tracker_table.xlsx"), d + "templates/asmis_tracker_table.xlsx")
    print(f"safety PA kit: template {len(tmpl)//1024} KB, zip {os.path.getsize(zpath)//1024} KB")

def main():
    os.makedirs(OUT, exist_ok=True)
    for name, cfg in PAGES.items():
        page_dir = os.path.join(ROOT, cfg["dir"])
        html = read(os.path.join(page_dir, "index.html"))
        single = check_clean(name, build_single(page_dir, html))
        with open(os.path.join(OUT, name + ".html"), "w", encoding="utf-8") as f: f.write(single)
        idx, files = folder_files(page_dir, html); check_clean(name + " folder", idx)
        zpath = os.path.join(OUT, name + ".zip")
        is_safety = cfg.get("guide")
        with Zip(zpath, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr(f"{name}/{name}.html", single)
            z.writestr(f"{name}/folder-version/index.html", idx)
            for zp, src in sorted(files.items()):
                if zp.endswith((".csv", ".xlsx")) and os.path.basename(zp) in cfg["templates"]: continue
                z.write(src, f"{name}/folder-version/{zp}")
            for t in cfg["templates"]:
                z.write(os.path.join(page_dir, t), f"{name}/templates/{t}")
                z.write(os.path.join(page_dir, t), f"{name}/folder-version/{t}")   # keeps the in-page template links working
            if is_safety:
                z.writestr(f"{name}/COLUMN-GUIDE.csv", column_guide(page_dir))
            z.writestr(f"{name}/README - How to use at work.txt", README.replace("{save_block}", SAVE_BLOCK.replace("{name}", name).replace("{prefix}", cfg["save_prefix"]) if cfg.get("save_prefix") else "").format(
                title=cfg["title"], name=name,
                guide_line="  COLUMN-GUIDE.csv     Every column, whether it is required, and what it drives.\n" if is_safety else "",
                multi_line="  - You can load several files at once (e.g. one tracker per fiscal year plus a roll-up).\n    Rows are combined and duplicate accidents are removed; \"Show duplicates removed\" lists them.\n" if is_safety else ""))
        print(f"{name}: html {len(single)//1024} KB, zip {os.path.getsize(zpath)//1024} KB, {len(files)} folder files")
        if is_safety: build_pa_kit(single)
        if cfg.get("pa_template"):
            tmpl = check_clean(name + " pa template", build_pa_template(single, "finance"))
            with open(os.path.join(OUT, name + "-template.html"), "w", encoding="ascii", newline="\n") as f: f.write(tmpl)
            print(f"{name} PA template: {len(tmpl)//1024} KB")

if __name__ == "__main__":
    main()
