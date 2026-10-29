#!/usr/bin/env python3
"""
Synthetic safety & mishap data for the Safety and Mishaps Dashboard.
Data shown is fictional for demonstration. Not an official Iowa National Guard product.

24 months (Nov 2024 - Oct 2026) of mishaps and near misses across the shared unit roster
(data/units.json). Seasonality is deliberate: heat injuries at summer annual training,
cold injuries and POV mishaps in winter, range and tactical vehicle events around AT.

Usage: python3 data-generation/generate_safety_data.py [--seed 2026]
Outputs dashboards/safety/data/{mishaps.csv, strength.csv, data.js}
"""
import argparse, csv, json, os, random, sys
from datetime import date, timedelta
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from units_roster import main as build_roster

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "dashboards", "safety", "data")
START, N = (2024, 11), 24

# category: (base monthly rate per 1,000 personnel, {month: multiplier}, on-duty share, class weights A,B,C,D)
CATS = {
    "POV/AOV vehicle":       (0.22, {12: 2.4, 1: 2.6, 2: 2.0, 6: 1.2, 7: 1.3, 4: 0.6, 9: 0.7}, 0.15, (0.010, 0.03, 0.30, 0.66)),
    "Tactical vehicle":      (0.10, {6: 4.0, 7: 3.6, 5: 1.6, 12: 0.3, 1: 0.3, 2: 0.4}, 1.00, (0.004, 0.04, 0.38, 0.576)),
    "Aviation ground":       (0.06, {6: 1.8, 7: 1.6}, 1.00, (0.0, 0.08, 0.45, 0.47)),
    "Training injury":       (0.18, {6: 3.6, 7: 3.4, 4: 1.3, 5: 1.5, 12: 0.4, 1: 0.4, 11: 0.6}, 1.00, (0.0, 0.01, 0.55, 0.44)),
    "Range":                 (0.07, {4: 1.8, 5: 2.2, 6: 2.0, 9: 1.4, 12: 0.2, 1: 0.2, 2: 0.3}, 1.00, (0.0, 0.03, 0.40, 0.57)),
    "Heat/cold injury":      (0.07, {6: 5.0, 7: 6.5, 8: 2.2, 12: 1.6, 1: 2.2, 2: 1.4, 10: 0.1, 11: 0.3, 3: 0.2, 4: 0.2, 9: 0.5}, 0.95, (0.0, 0.01, 0.62, 0.37)),
    "Sports/PT":             (0.14, {3: 1.4, 4: 1.4, 9: 1.3}, 0.70, (0.0, 0.0, 0.58, 0.42)),
    "Slips/falls":           (0.12, {12: 2.4, 1: 2.8, 2: 2.2, 6: 0.6, 7: 0.6, 8: 0.6, 10: 0.7}, 0.60, (0.0, 0.01, 0.55, 0.44)),
}
CAUSES = {
    "POV/AOV vehicle": ["Speed / following too close", "Fatigue", "Distraction (phone)", "Road / weather conditions", "Seat belt not worn"],
    "Tactical vehicle": ["Inadequate ground guide", "Inexperienced driver", "Risk assessment not done", "Equipment failure", "Speed for conditions"],
    "Aviation ground": ["Procedure not followed", "Inadequate supervision", "Equipment failure", "Complacency"],
    "Training injury": ["Inadequate warm-up / conditioning", "Inadequate supervision", "Uneven terrain", "Improper lifting"],
    "Range": ["Weapons handling", "Range SOP not followed", "Hearing / eye protection not worn", "Inadequate supervision"],
    "Heat/cold injury": ["Work/rest cycle not enforced", "Hydration not monitored", "Not acclimatized", "Improper clothing for conditions"],
    "Sports/PT": ["Inadequate warm-up / conditioning", "Overexertion", "Uneven surface"],
    "Slips/falls": ["Ice / snow not cleared", "Housekeeping", "Improper footwear", "Poor lighting"],
}
# Notional cost bands (illustrative): A >= $2.5M, B $600K-<$2.5M, C $60K-<$600K, D $25K-<$60K
BANDS = {"A": (2_500_000, 3_400_000), "B": (600_000, 1_400_000), "C": (60_000, 240_000), "D": (25_000, 59_000)}
DAYS = {"A": (120, 365), "B": (45, 180), "C": (1, 30), "D": (0, 2)}

def poisson(rng, lam):
    k, p, L = 0, 1.0, pow(2.718281828, -lam)
    while True:
        p *= rng.random()
        if p <= L: return k
        k += 1

def months():
    y, m = START
    for _ in range(N):
        yield y, m
        m += 1
        if m > 12: y, m = y + 1, 1

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--seed", type=int, default=2026); a = ap.parse_args()
    rng = random.Random(a.seed)
    units = build_roster()
    for u in units:
        u["risk"] = max(0.4, rng.lognormvariate(0, 0.38))  # persistent unit risk factor
        u["strength0"] = int(u["authorized"] * rng.uniform(0.84, 1.0))
    strength, recs = [], []
    seq = 0
    for i, (y, m) in enumerate(months()):
        mo = f"{y:04d}-{m:02d}"
        ndays = (date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)).day
        for u in units:
            asg = int(u["strength0"] + rng.gauss(0, 2) + (i - 12) * rng.uniform(-0.15, 0.2))
            strength.append(dict(month=mo, unit_id=u["unit_id"], assigned=asg))
            for cat, (base, seas, on_share, cw) in CATS.items():
                lam = base * seas.get(m, 1.0) * u["risk"] * asg / 1000
                if cat in ("Tactical vehicle",) and u["branch"] in ("TC", "EN", "BSB"): lam *= 1.8
                if cat == "Aviation ground" and u["branch"] != "AV": lam *= 0.05
                if cat == "Range" and u["branch"] in ("INF", "CAV", "FA"): lam *= 1.7
                k = poisson(rng, lam)
                nm_k = poisson(rng, lam * 1.1 * (0.6 + i / 24))  # near-miss reporting culture improves over time
                for kind, cnt in (("Mishap", k), ("Near miss", nm_k)):
                    for _ in range(cnt):
                        seq += 1
                        d = date(y, m, rng.randint(1, ndays))
                        duty = "On-duty" if rng.random() < on_share else "Off-duty"
                        if kind == "Mishap":
                            cls = rng.choices("ABCD", weights=cw)[0]
                            lo, hi = BANDS[cls]; cost = round(rng.uniform(lo, hi) if cls in "AB" else rng.uniform(lo, hi) * (rng.random() ** 0.6), -2)
                            dl = rng.randint(*DAYS[cls])
                        else:
                            cls, cost, dl = "NM", 0, 0
                        recs.append(dict(record_id=f"SM-{y}{m:02d}-{seq:04d}", date=d.isoformat(), month=mo, unit_id=u["unit_id"], unit_name=u["unit_name"],
                                         battalion=u["battalion"], brigade=u["brigade"], location=u["location"], event_type=kind, mishap_class=cls,
                                         category=cat, duty_status=duty, days_lost=dl, cost=int(cost), root_cause=rng.choice(CAUSES[cat])))
    # ensure exactly one Class A (off-duty POV) and a few Class B for realism
    for r in recs:
        if r["mishap_class"] == "A": r["mishap_class"] = "B"; r["cost"] = int(rng.uniform(*BANDS["B"])); r["days_lost"] = rng.randint(*DAYS["B"])
    pov = [r for r in recs if r["category"] == "POV/AOV vehicle" and r["event_type"] == "Mishap"]
    pov.sort(key=lambda r: (r["month"][5:] not in ("12", "01", "02"), r["month"] < "2025-11", r["duty_status"] != "Off-duty", r["date"]))
    if pov:
        pov[0].update(mishap_class="A", duty_status="Off-duty", cost=2_780_000, days_lost=365, root_cause="Road / weather conditions")
    recs.sort(key=lambda r: r["date"])
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "mishaps.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(recs[0].keys())); w.writeheader(); w.writerows(recs)
    with open(os.path.join(OUT, "strength.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["month", "unit_id", "assigned"]); w.writeheader(); w.writerows(strength)
    payload = dict(meta=dict(seed=a.seed, generated_by="data-generation/generate_safety_data.py", note="Data shown is fictional for demonstration."),
                   records=recs, strength=strength,
                   units=[{k: u[k] for k in ("unit_id", "unit_name", "battalion", "brigade", "location")} for u in units])
    with open(os.path.join(OUT, "data.js"), "w") as f:
        f.write("// AUTO-GENERATED by data-generation/generate_safety_data.py - fictional data\nwindow.SAFETY_DATA = " + json.dumps(payload, separators=(",", ":")) + ";\n")
    from collections import Counter
    print(len(recs), "records;", Counter((r["event_type"], r["mishap_class"]) for r in recs))
    print(Counter(r["category"] for r in recs if r["event_type"] == "Mishap"))

if __name__ == "__main__":
    main()
