#!/usr/bin/env python3
"""
Synthetic status-of-funds data for the Finance / Status of Funds Dashboard.
Data shown is fictional for demonstration. Not an official Iowa National Guard product.

FY26 (Oct 2025 - Sep 2026) plus FY27 to date (Oct 2026). Appropriation names are the
standard public ARNG categories (NGPA, OMNG, MCNG) plus a separate State line; program
codes and all amounts are invented. Organizations come from the shared roster (data/units.json)
plus a state-level headquarters line.

Usage: python3 data-generation/generate_finance_data.py [--seed 2026]
Outputs dashboards/finance/data/{status_of_funds.csv, ufr.csv, data.js}
"""
import argparse, csv, json, os, random, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from units_roster import main as build_roster

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "dashboards", "finance", "data")
HQ = ("State Headquarters", "Joint Force HQ (state level)")

APPN = {"NGPA": "NGPA - Pay & Allowances", "OMNG": "OMNG - Operation & Maintenance", "MCNG": "MCNG - Military Construction", "STATE": "State Funds"}
# code, name, appropriation, scope ("bn" = every battalion, "hq" = state level, "av" = aviation bn), base AFP per org ($), plan profile name, TDY share
PROGRAMS = [
    ("PA01", "Inactive Duty Training (drill) pay", "NGPA", "bn", 1_650_000, "flat", 0.0),
    ("PA02", "Annual Training pay", "NGPA", "bn", 1_250_000, "at", 0.0),
    ("PA03", "Schools & special training", "NGPA", "bn", 420_000, "flat", 0.30),
    ("PA04", "Bonuses & incentives", "NGPA", "hq", 2_900_000, "flat", 0.0),
    ("OM10", "Unit training operations", "OMNG", "bn", 610_000, "omtrn", 0.22),
    ("OM11", "Ground equipment maintenance", "OMNG", "bn", 480_000, "flat", 0.04),
    ("OM12", "Facilities sustainment (SRM)", "OMNG", "hq", 6_800_000, "q4", 0.0),
    ("OM13", "Information technology", "OMNG", "hq", 2_300_000, "q4", 0.03),
    ("OM14", "Medical readiness", "OMNG", "bn", 160_000, "flat", 0.08),
    ("OM15", "Recruiting & retention", "OMNG", "hq", 1_900_000, "flat", 0.18),
    ("OM16", "Aviation operations", "OMNG", "av", 3_400_000, "omtrn", 0.12),
    ("OM17", "Safety & occupational health", "OMNG", "hq", 420_000, "flat", 0.10),
    ("MC20", "Readiness center construction (Project 26-A)", "MCNG", "hq", 14_500_000, "award", 0.0),
    ("MC21", "Planning & design", "MCNG", "hq", 1_100_000, "flat", 0.02),
    ("ST30", "State armory operations & utilities", "STATE", "hq", 4_200_000, "flat", 0.0),
    ("ST31", "State active duty", "STATE", "hq", 650_000, "sad", 0.0),
]
IMPACT = {"OM10": "Readiness (training)", "OM11": "Readiness (equipment)", "OM12": "Facilities", "OM13": "Mission command / IT", "OM14": "Readiness (medical)",
          "OM15": "Personnel strength", "OM16": "Readiness (aviation)", "OM17": "Safety", "PA03": "Readiness (training)", "ST30": "Facilities"}
FY26 = [f"2025-{m:02d}" for m in (10, 11, 12)] + [f"2026-{m:02d}" for m in range(1, 10)]
FY27 = ["2026-10"]

def profile(kind):
    # monthly weights Oct..Sep
    w = {
        "flat":  [1] * 12,
        "at":    [0.3, 0.3, 0.2, 0.2, 0.3, 0.5, 0.8, 1.2, 3.5, 3.2, 1.0, 0.5],
        "omtrn": [0.6, 0.7, 0.6, 0.7, 0.9, 1.0, 1.1, 1.4, 1.8, 1.5, 1.1, 1.4],
        "q4":    [0.5, 0.6, 0.6, 0.8, 0.9, 1.0, 1.0, 1.1, 1.2, 1.3, 1.5, 2.5],
        "award": [0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 9.0, 0.03, 0.03, 0.03, 0.03, 0.03],
        "sad":   [0.4, 0.3, 1.6, 1.2, 0.6, 1.0, 1.4, 1.8, 1.3, 0.8, 0.6, 1.0],
    }[kind]
    s = sum(w); return [x / s for x in w]

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--seed", type=int, default=2026); a = ap.parse_args()
    rng = random.Random(a.seed)
    units = build_roster()
    bns = {}
    for u in units:
        bns.setdefault(u["battalion"], dict(brigade=u["brigade"], branch=u["branch"], strength=0))
        bns[u["battalion"]]["strength"] += u["authorized"]
    rows = []
    for code, name, appn, scope, base, prof, tdy in PROGRAMS:
        if scope == "hq": orgs = [HQ]
        elif scope == "av": orgs = [(v["brigade"], k) for k, v in bns.items() if v["branch"] == "AV"]
        else: orgs = [(v["brigade"], k) for k, v in bns.items()]
        for bde, org in orgs:
            scale = (bns[org]["strength"] / 560) if org in bns and scope == "bn" else 1.0
            for fy, months in (("FY26", FY26), ("FY27", FY27)):
                afp = round(base * scale * rng.uniform(0.9, 1.1) * (1.03 if fy == "FY27" else 1.0), -3)
                plan = profile(prof)
                # execution behaviour: final rate and timing lag
                if appn == "NGPA": final, lag = rng.uniform(0.985, 1.0), rng.uniform(-0.05, 0.08)
                elif appn == "MCNG": final, lag = (rng.uniform(0.96, 0.99), 0.0) if prof == "award" else (rng.uniform(0.85, 0.97), rng.uniform(0.0, 0.25))
                elif appn == "STATE": final, lag = rng.uniform(0.93, 0.99), rng.uniform(0.0, 0.15)
                else: final, lag = (rng.uniform(0.86, 0.95) if rng.random() < 0.25 else rng.uniform(0.96, 1.0)), rng.uniform(0.0, 0.3)
                # continuing resolution slows Q1 obligations for non-pay accounts
                act = []
                for i, p in enumerate(plan):
                    f = p * (1 - lag if i < 6 else 1 + lag * 0.9) * rng.uniform(0.8, 1.2)
                    if appn in ("OMNG", "STATE") and i < 3: f *= 0.75
                    if appn == "OMNG" and i == 11: f *= 1.0 + lag * 2  # year-end push
                    act.append(f)
                if prof == "award":  # contract award slips one month sometimes
                    if rng.random() < 0.5: act[6], act[7] = act[6] * 0.05, act[6] * 0.95
                s = sum(act); obl = [afp * final * x / s for x in act]
                # allotments released quarterly (CR rate in Q1)
                rel = [0.22, 0, 0, 0.26, 0, 0, 0.28, 0, 0, 0.24, 0, 0]
                allot = [afp * r for r in rel]
                # ensure cumulative allotment covers cumulative obligations (+ small cushion)
                ca = co = 0
                for i in range(12):
                    ca += allot[i]; co += obl[i]
                    if co > ca * 0.995:
                        bump = co / 0.995 - ca; allot[i] += bump; ca += bump
                over = sum(allot) - afp
                if over > 0:  # take overage back out of the final release
                    for i in range(11, -1, -1):
                        t = min(over, allot[i] - 0); allot[i] -= t; over -= t
                        if over <= 0: break
                # commitments lead obligations; disbursements lag
                com = [obl[i] + (obl[i + 1] * 0.35 if i < 11 else 0) - (obl[i] * 0.35 if i > 0 else 0) for i in range(12)]
                com[0] += 0  # cumulative commitments >= cumulative obligations by construction
                lagd = {"NGPA": [0.93, 0.07], "OMNG": [0.35, 0.35, 0.18, 0.08], "MCNG": [0.04, 0.06, 0.08, 0.08, 0.08, 0.08], "STATE": [0.6, 0.3, 0.08]}[appn]
                dis = [0.0] * 12
                for i in range(12):
                    for j, f in enumerate(lagd):
                        if i + j < 12: dis[i + j] += obl[i] * f
                for i, mo in enumerate(months):
                    rows.append(dict(fy=fy, month=mo, appropriation=appn, program_code=code, program_name=name, brigade=bde, organization=org,
                                     afp=int(afp) if i == 0 else 0, allotment=int(round(allot[i])), plan_obligations=int(round(afp * plan[i])),
                                     commitments=int(round(com[i])), obligations=int(round(obl[i])), disbursements=int(round(dis[i])),
                                     tdy_obligations=int(round(obl[i] * tdy * rng.uniform(0.7, 1.3)))))
    ufr_titles = [("Night vision maintenance surge", "OM11"), ("Readiness center roof repair", "OM12"), ("Simulator lease extension", "OM10"),
                  ("Additional medical/dental readiness day", "OM14"), ("Cyber training seats", "PA03"), ("Generator replacement (two armories)", "OM12"),
                  ("Recruiting event support", "OM15"), ("Network switch refresh", "OM13"), ("Range target system repairs", "OM10"),
                  ("Additional AT transportation (buses)", "OM10"), ("Hearing conservation equipment", "OM17"), ("Aviation tool kit replacement", "OM16"),
                  ("Armory HVAC controls", "ST30"), ("Leadership course seats", "PA03"), ("Tactical vehicle tire replacement", "OM11"), ("Winter driving trainer", "OM17")]
    orgs_all = list(bns.keys()) + [HQ[1]]
    ufr = []
    for i, (t, code) in enumerate(ufr_titles, 1):
        org = HQ[1] if code in ("OM12", "OM13", "OM15", "OM17", "ST30") else rng.choice(list(bns.keys()))
        status = rng.choices(["Unfunded", "Validated", "Funded", "Submitted"], [0.35, 0.3, 0.2, 0.15])[0]
        ufr.append(dict(fy="FY26" if i <= 11 else "FY27", ufr_id=f"UFR-{('26' if i <= 11 else '27')}-{i:03d}", title=t, program_code=code,
                        organization=org, brigade=bns[org]["brigade"] if org in bns else HQ[0], amount=int(round(rng.uniform(25_000, 1_200_000), -3)),
                        priority=rng.choice([1, 1, 2, 2, 3]), status=status,
                        impact=IMPACT[code]))
    os.makedirs(OUT, exist_ok=True)
    for fn, data in (("status_of_funds.csv", rows), ("ufr.csv", ufr)):
        with open(os.path.join(OUT, fn), "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(data[0].keys())); w.writeheader(); w.writerows(data)
    payload = dict(meta=dict(seed=a.seed, generated_by="data-generation/generate_finance_data.py", note="Data shown is fictional for demonstration.",
                             appropriations=APPN, programs={p[0]: p[1] for p in PROGRAMS}), records=rows, ufr=ufr)
    with open(os.path.join(OUT, "data.js"), "w") as f:
        f.write("// AUTO-GENERATED by data-generation/generate_finance_data.py - fictional data\nwindow.FINANCE_DATA = " + json.dumps(payload, separators=(",", ":")) + ";\n")
    tot = sum(r["afp"] for r in rows if r["fy"] == "FY26"); ob = sum(r["obligations"] for r in rows if r["fy"] == "FY26")
    print(len(rows), "rows,", len(ufr), "UFRs; FY26 AFP $%.1fM, obligated %.1f%%" % (tot / 1e6, 100 * ob / tot))

if __name__ == "__main__":
    main()
