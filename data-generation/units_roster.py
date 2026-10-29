#!/usr/bin/env python3
"""
Shared fictional unit roster -> data/units.json (used by every dashboard generator).

Unit numbers are invented and were checked against public lists of current Iowa Army
National Guard units so none of them match a real Iowa designation. Real Iowa city names
are used only as locations. Data shown is fictional for demonstration.
"""
import json, os, random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "units.json")

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

# (brigade, [(battalion, short, branch, [(company, city), ...]), ...])
ROSTER = [
    ("58th Infantry Brigade Combat Team", [
        ("2-512th Infantry Bn", "2-512th IN", "INF", [("HHC", "Des Moines"), ("A Co", "Boone"), ("B Co", "Ames"), ("C Co", "Marshalltown"), ("D Co (Wpns)", "Carroll")]),
        ("445th Cavalry Squadron", "445th CAV", "CAV", [("HHT", "Sioux City"), ("A Trp", "Storm Lake"), ("B Trp", "Spencer"), ("C Trp", "Fort Dodge")]),
        ("1-627th Field Artillery Bn", "1-627th FA", "FA", [("HHB", "Council Bluffs"), ("A Btry", "Red Oak"), ("B Btry", "Creston"), ("G FSC", "Council Bluffs")]),
        ("371st Brigade Support Bn", "371st BSB", "BSB", [("HHC", "Des Moines"), ("A Co (Dist)", "Ottumwa"), ("B Co (Maint)", "Oskaloosa"), ("C Co (Med)", "Iowa City")]),
    ]),
    ("219th Sustainment Brigade", [
        ("829th Engineer Bn", "829th EN", "EN", [("HSC", "Cedar Rapids"), ("A Co (Sapper)", "Waterloo"), ("B Co (Vert)", "Decorah"), ("C Co (Horiz)", "Mason City")]),
        ("572nd Transportation Bn", "572nd TC", "TC", [("HHD", "Davenport"), ("A Co (Truck)", "Muscatine"), ("B Co (Truck)", "Clinton"), ("C Co (HET)", "Burlington")]),
    ]),
    ("96th Troop Command", [
        ("2-473rd Aviation Bn", "2-473rd AV", "AV", [("HHC", "Des Moines"), ("A Co (Lift)", "Waterloo"), ("B Co (AVIM)", "Des Moines")]),
        ("857th Signal Bn", "857th SC", "SC", [("HHD", "Dubuque"), ("A Co", "Iowa City"), ("B Co", "Cedar Rapids")]),
    ]),
]

def main(seed=2026):
    rng = random.Random(seed)
    units = []
    for bde, bns in ROSTER:
        for bn, short, branch, cos in bns:
            for co, city in cos:
                lat, lon = CITIES[city]
                hq = co.startswith("HH") or co.startswith("HS")
                units.append(dict(
                    unit_id=(short.split(" ")[0] + "-" + co.split(" ")[0]).replace(" ", ""),
                    unit_name=f"{co}, {short}", battalion=bn, battalion_short=short, brigade=bde, branch=branch,
                    location=city, armory=f"{city} Readiness Center",
                    lat=round(lat + rng.uniform(-0.04, 0.04), 3), lon=round(lon + rng.uniform(-0.04, 0.04), 3),
                    authorized=rng.choice([140, 155, 170, 185]) if hq else rng.choice([95, 110, 120, 128, 135, 140, 150, 165]),
                ))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump({"note": "Fictional unit roster shared by all dashboards. Data shown is fictional for demonstration.", "units": units}, f, indent=1)
    return units

if __name__ == "__main__":
    print(len(main()), "units ->", OUT)
