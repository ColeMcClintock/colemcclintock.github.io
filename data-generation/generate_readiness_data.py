#!/usr/bin/env python3
"""
Synthetic data generator for the Iowa ARNG Readiness Command Dashboard (DEMO).

ALL DATA IS FICTIONAL. Unit names, numbers, armories and readiness values are
invented. Real Iowa city names are used only as locations. This is not an
official Iowa National Guard, Army, or DoD product.

Usage:
    python3 data-generation/generate_readiness_data.py            # default seed 2026
    python3 data-generation/generate_readiness_data.py --seed 7   # different but reproducible

Outputs (relative to repo root):
    dashboards/readiness/data/readiness_monthly.csv
    dashboards/readiness/data/readiness_monthly.json
    dashboards/readiness/data/events.csv
    dashboards/readiness/data/data.js   (same data as a JS file so index.html works from file://)
Standard library only - no installs needed.
"""
import argparse, csv, json, math, os, random
from datetime import date, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "dashboards", "readiness", "data")

# Real Iowa cities (public geography) -> approximate lat/lon. Armories are fictional.
CITIES = {
    "Des Moines": (41.59, -93.62), "Cedar Rapids": (41.98, -91.67), "Davenport": (41.52, -90.58),
    "Sioux City": (42.50, -96.40), "Iowa City": (41.66, -91.53), "Waterloo": (42.49, -92.34),
    "Ames": (42.03, -93.62), "Council Bluffs": (41.26, -95.86), "Dubuque": (42.50, -90.66),
    "Ottumwa": (41.02, -92.41), "Mason City": (43.15, -93.20), "Fort Dodge": (42.50, -94.17),
    "Burlington": (40.81, -91.11), "Marshalltown": (42.05, -92.91), "Muscatine": (41.42, -91.04),
    "Carroll": (42.07, -94.87), "Spencer": (43.14, -95.14), "Creston": (41.06, -94.36),
    "Decorah": (43.30, -91.79), "Boone": (42.06, -93.88), "Oskaloosa": (41.30, -92.64),
    "Storm Lake": (42.64, -95.21), "Red Oak": (41.01, -95.23), "Clinton": (41.84, -90.19),
}

# Fictional force structure (9xx numbering chosen to be clearly notional)
STRUCTURE = [
    ("Prairie Infantry Brigade", [
        ("1-901st Notional Infantry Bn", "INF", ["HHC", "A Co", "B Co", "C Co", "D Co (Wpns)"],
         ["Des Moines", "Boone", "Ames", "Marshalltown", "Carroll"]),
        ("2-901st Notional Infantry Bn", "INF", ["HHC", "A Co", "B Co", "C Co"],
         ["Sioux City", "Storm Lake", "Spencer", "Fort Dodge"]),
        ("902nd Notional Field Artillery Bn", "FA", ["HHB", "A Btry", "B Btry", "G FSC"],
         ["Council Bluffs", "Red Oak", "Creston", "Council Bluffs"]),
        ("903rd Notional Brigade Support Bn", "BSB", ["HHC", "A Co (Dist)", "B Co (Maint)", "C Co (Med)"],
         ["Des Moines", "Ottumwa", "Oskaloosa", "Iowa City"]),
    ]),
    ("Riverlands Sustainment Brigade", [
        ("904th Notional Engineer Bn", "EN", ["HSC", "A Co (Sapper)", "B Co (Vert)", "C Co (Horiz)"],
         ["Cedar Rapids", "Waterloo", "Decorah", "Mason City"]),
        ("905th Notional Transportation Bn", "TC", ["HHD", "A Co (Truck)", "B Co (Truck)", "C Co (HET)"],
         ["Davenport", "Muscatine", "Clinton", "Burlington"]),
    ]),
    ("Heartland Support Group", [
        ("906th Notional Aviation Bn", "AV", ["HHC", "A Co (Lift)", "B Co (AVIM)"],
         ["Des Moines", "Waterloo", "Des Moines"]),
        ("907th Notional Signal Bn", "SC", ["HHD", "A Co", "B Co"],
         ["Dubuque", "Iowa City", "Cedar Rapids"]),
    ]),
]

START = date(2025, 5, 1)
N_MONTHS = 18  # May 2025 - Oct 2026

def months():
    y, m = START.year, START.month
    for _ in range(N_MONTHS):
        yield f"{y:04d}-{m:02d}"
        m += 1
        if m > 12:
            y, m = y + 1, 1

def clamp(v, lo, hi):
    return max(lo, min(hi, v))

def c_level(strength, mosq, med, eoh, eor, itr, ctr):
    """Notional overall rating. Simplified illustration only, NOT the Army's AR 220-1 method."""
    p = min(strength, mosq, med)          # personnel
    e = min(eoh, eor)                     # equipment
    t = (itr + ctr) / 2                   # training
    def lvl(v, a, b, c):
        return 1 if v >= a else 2 if v >= b else 3 if v >= c else 4
    lv = [lvl(p, 86, 78, 68), lvl(e, 90, 82, 72), lvl(t, 86, 76, 62)]
    # average of the three areas, but never more than one level better than the weakest area
    return f"C{max(int(round(sum(lv) / 3 + 1e-9)), max(lv) - 1)}"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=2026)
    args = ap.parse_args()
    rng = random.Random(args.seed)
    os.makedirs(OUT, exist_ok=True)
    month_list = list(months())
    rows, units = [], []

    for bde, bns in STRUCTURE:
        for bn, branch, cos, locs in bns:
            bn_short = bn.split(" Notional")[0]
            for co, city in zip(cos, locs):
                uid = f"{bn_short}-{co.split(' ')[0]}".replace(" ", "")
                lat, lon = CITIES[city]
                units.append(dict(
                    unit_id=uid, unit_name=f"{co}, {bn_short}", battalion=bn, brigade=bde,
                    branch=branch, location=city, armory=f"{city} Readiness Center",
                    lat=round(lat + rng.uniform(-0.04, 0.04), 3), lon=round(lon + rng.uniform(-0.04, 0.04), 3),
                    authorized=rng.choice([95, 110, 120, 128, 135, 140, 150, 165]) if not co.startswith("HH") else rng.choice([140, 155, 170, 185]),
                    # latent unit "health" traits drive realistic persistence
                    base_q=rng.gauss(0, 1), trend=rng.gauss(0, 0.35), equip_q=rng.gauss(0, 1), train_q=rng.gauss(0, 1),
                    shock_month=rng.randrange(4, N_MONTHS) if rng.random() < 0.35 else None,
                ))

    for u in units:
        assigned = u["authorized"] * clamp(0.97 + 0.05 * u["base_q"], 0.74, 1.06)
        for i, mo in enumerate(month_list):
            mnum = int(mo[5:])
            t = i / (N_MONTHS - 1)
            shock = 0
            if u["shock_month"] is not None and i >= u["shock_month"]:
                shock = -2.2 * math.exp(-(i - u["shock_month"]) / 4)  # e.g. ETS wave / equipment turn-in
            # strength: drift + seasonal ETS losses in summer + recruiting bumps in spring
            assigned += rng.gauss(0, 1.6) + u["trend"] * 0.8 + (-1.0 if mnum in (6, 7, 8) else 0.9 if mnum in (2, 3, 4) else 0) + shock * 2.5
            assigned = clamp(assigned, u["authorized"] * 0.65, u["authorized"] * 1.08)
            a = int(round(assigned))
            q = u["base_q"] + u["trend"] * t * 2 + shock
            mosq = clamp(88 + 5 * q + rng.gauss(0, 1.8), 55, 99)
            med_ready = clamp(88 + 5 * q + (2.5 if mnum in (3, 4, 5) else 0) + rng.gauss(0, 2.0), 52, 98)  # PHA push before AT
            mrc3 = clamp(rng.uniform(0.02, 0.06) - 0.01 * q, 0.005, 0.15)
            mrc4 = clamp(1 - med_ready / 100 - mrc3, 0.01, 0.4)
            mrc1_share = rng.uniform(0.80, 0.92)
            ready = a * (1 - mrc3 - mrc4)
            mrc1 = int(round(ready * mrc1_share)); mrc2 = int(round(ready)) - mrc1
            mrc3_n = int(round(a * mrc3)); mrc4_n = a - mrc1 - mrc2 - mrc3_n
            eq = u["equip_q"] + shock * 1.3
            eoh = clamp(91 + 4 * eq + rng.gauss(0, 1.5), 60, 100)
            eor = clamp(88 + 4.5 * eq + (-3 if mnum in (7, 8) else 0) + rng.gauss(0, 2.2), 55, 99)  # post-AT maintenance dip
            tq = u["train_q"] + u["trend"] * t
            post_at = 3 if mnum in (7, 8, 9) else (-2 if mnum in (1, 2) else 0)  # tasks re-validated at AT
            itr = clamp(88 + 4 * tq + post_at + rng.gauss(0, 2.0), 40, 100)   # % of required individual tasks current
            ctr = clamp(81 + 5 * tq + post_at + rng.gauss(0, 2.5) + shock * 5, 30, 100)  # % of METL collective tasks T/P
            strength = 100 * a / u["authorized"]
            med_pct = 100 * (mrc1 + mrc2) / a
            rows.append(dict(
                month=mo, unit_id=u["unit_id"], unit_name=u["unit_name"], battalion=u["battalion"], brigade=u["brigade"],
                branch=u["branch"], location=u["location"], armory=u["armory"], lat=u["lat"], lon=u["lon"],
                authorized=u["authorized"], assigned=a, mosq_pct=round(mosq, 1),
                mrc1=mrc1, mrc2=mrc2, mrc3=mrc3_n, mrc4=mrc4_n,
                equip_on_hand_pct=round(eoh, 1), equip_or_pct=round(eor, 1),
                ind_training_pct=round(itr, 1), coll_training_pct=round(ctr, 1),
                readiness_rating=c_level(strength, mosq, med_pct, eoh, eor, itr, ctr),
            ))

    # Upcoming events (fictional schedule) from Nov 2026 forward
    events = []
    drill_start = date(2026, 11, 7)
    bns_all = [(bde, bn, locs[0]) for bde, bns in STRUCTURE for bn, _, _, locs in bns]
    for k in range(6):  # monthly battle-assembly weekends
        d = drill_start + timedelta(weeks=4 * k + (1 if k % 2 else 0))
        d = d - timedelta(days=(d.weekday() - 5) % 7)  # snap to Saturday
        for bde, bn, loc in bns_all:
            if rng.random() < 0.55:
                events.append(dict(start=d.isoformat(), end=(d + timedelta(days=1)).isoformat(), type="Battle Assembly (drill)",
                                   brigade=bde, battalion=bn, location=f"{loc} Readiness Center",
                                   notes=rng.choice(["Weapons qualification", "PHA / dental make-up", "Maintenance stand-down",
                                                     "Collective lanes", "Records review / SRP", "CBRN & first aid"])))
    for bde, bn, loc in bns_all:
        s = date(2027, rng.choice([5, 6, 6, 7]), rng.randint(1, 20))
        events.append(dict(start=s.isoformat(), end=(s + timedelta(days=14)).isoformat(), type="Annual Training",
                           brigade=bde, battalion=bn, location=rng.choice(["Northern Training Area", "Central Training Area", "Out-of-state Combat Training Center"]),
                           notes="15-day AT period"))
    for d, note in [(date(2026, 11, 14), "Statewide SRP / medical readiness event"), (date(2027, 1, 9), "Quarterly Training Brief (QTB)"),
                    (date(2027, 2, 20), "Command Supply Discipline inspection"), (date(2027, 3, 13), "Pre-AT medical push")]:
        events.append(dict(start=d.isoformat(), end=d.isoformat(), type="Statewide event", brigade="All", battalion="All",
                           location="Des Moines", notes=note))
    events.sort(key=lambda e: e["start"])

    fields = list(rows[0].keys())
    with open(os.path.join(OUT, "readiness_monthly.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(rows)
    with open(os.path.join(OUT, "events.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(events[0].keys())); w.writeheader(); w.writerows(events)
    meta = dict(generated_by="data-generation/generate_readiness_data.py", seed=args.seed,
                disclaimer="Data shown is fictional for demonstration. Not an official Iowa National Guard product.")
    payload = dict(meta=meta, records=rows, events=events)
    with open(os.path.join(OUT, "readiness_monthly.json"), "w") as f:
        json.dump(payload, f, indent=1)
    with open(os.path.join(OUT, "data.js"), "w") as f:
        f.write("// AUTO-GENERATED by data-generation/generate_readiness_data.py - FICTIONAL DATA\n")
        f.write("window.READINESS_DATA = " + json.dumps(payload, separators=(",", ":")) + ";\n")
    print(f"{len(units)} units x {N_MONTHS} months = {len(rows)} rows; {len(events)} events -> {OUT}")

if __name__ == "__main__":
    main()
