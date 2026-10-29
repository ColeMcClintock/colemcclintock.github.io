"""Fake multi-FY ASMIS tracker files for testing multi-file load and de-duplication (fictional data).
FY22-FY26 trackers (FY22 lacks Days Lost + two optional columns; FY23 has shuffled column order; FY25 repeats 6 FY26 records)
plus a roll-up that overlaps FY26 with conflicting statuses, internal repeats, zero-padded/numeric IDs, CCIR-only and no-ID rows.
Usage: python3 data-generation/generate_asmis_fy_trackers.py [rows_per_fy] [out_dir]   (needs openpyxl)
Expected with defaults: 471 rows in, 46 duplicates removed, 425 accidents."""
import csv, random, datetime as dt, openpyxl, os, sys, time
rng = random.Random(7)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "dashboards", "safety", "data", "asmis_sample.csv")
rows = list(csv.DictReader(open(SRC))); H = list(rows[0].keys())
per_fy = int(sys.argv[1]) if len(sys.argv) > 1 else 85
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "dashboards", "safety", "data", "fy-trackers")
os.makedirs(out, exist_ok=True)
MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
def fmt(d): return f"{d.day:02d}-{MON[d.month-1]}-{str(d.year)[2:]}"
def make(fy, n):
    res = []
    for i in range(n):
        t = dict(rng.choice(rows))
        d = dt.date(fy - 1, 10, 1) + dt.timedelta(days=rng.randrange(365 if fy < 2027 else 28))
        t["Accident Date"] = fmt(d); t["Due Date"] = fmt(d + dt.timedelta(days=90))
        t["Accident #"] = f"{fy%100:02d}{i+1:05d}"; t["CCIR #"] = f"{fy%100:02d}-{1000+i}"; t["ASMIS #"] = f"{fy}{100000+i}"
        if fy <= 2025: t["Status"] = "Final"; t["Days Overdue"] = ""; t["Compl. Date"] = fmt(d + dt.timedelta(days=60))
        res.append(t)
    return res
files = {fy: make(fy, per_fy) for fy in range(2022, 2027)}
# FY25 file repeats 6 early-FY26 records (same IDs, older status) -> cross-file duplicates
for r in files[2026][:6]:
    c = dict(r); c["Status"] = "Investigation Ongoing"; c["Compl. Date"] = ""; files[2025].append(c)
def write(name, hdr, data, mtime, sheet="Accidents (Input)", numeric_ids=False):
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = sheet; ws.append(hdr)
    for r in data:
        vals = []
        for h in hdr:
            v = r.get(h, "")
            if numeric_ids and h == "Accident #" and v: v = int(v)
            vals.append(v)
        ws.append(vals)
    for _ in range(40): ws.append([""] * (len(hdr) - 3) + ["$ -", "-", ""])   # formula leftovers
    p = os.path.join(out, name); wb.save(p); os.utime(p, (mtime, mtime))
base = 1790000000  # fixed timestamps so files sort FY22..FY26, roll-up last
write("FY22 Tracker.xlsx", [h for h in H if h not in ("Days Lost", "Comments", "Assigned To")], files[2022], base + 1)  # missing required + optional cols
write("FY23 Tracker.xlsx", rng.sample(H, len(H)), files[2023], base + 2)       # shuffled column order
write("FY24 Tracker.xlsx", H, files[2024], base + 3)
write("FY25 Tracker.xlsx", H, files[2025], base + 4)
write("FY26 Tracker.xlsx", H, files[2026], base + 5)
# Roll-up: same schema, overlaps FY26 with conflicting statuses, internal repeats, numeric/zero-padded IDs, no-ID repeats
roll = []
for r in files[2026][:30]:
    c = dict(r)
    c["Status"] = rng.choice(["Final", "In Review NGB", "Investigation Ongoing"])
    if c["Status"] == "Final": c["Compl. Date"] = fmt(dt.date(2026, 10, 1))
    roll.append(c)
for c in roll[:3]: c2 = dict(c); c2["Accident #"] = "00" + c2["Accident #"]; roll.append(c2)         # leading zeros
for c in roll[3:6]: roll.append(dict(c))                                                         # internal exact repeats
for c in roll[6:8]: c2 = dict(c); c2["Accident #"] = ""; c2["CCIR #"] = " " + c2["CCIR #"].lower() + " "; roll.append(c2)  # CCIR-only match
noid = dict(files[2026][40]); noid.update({"Accident #": "", "CCIR #": "", "ASMIS #": ""}); roll += [dict(noid), dict(noid)]  # no IDs, fingerprint
write("FY26 Roll-up.xlsx", H, roll, base + 10, sheet="Roll-up", numeric_ids=True)
print("files:", sorted(os.listdir(out)), "per FY", per_fy, "rollup", len(roll))
