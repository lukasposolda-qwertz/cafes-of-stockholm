"""Build data/cafes.json from OpenStreetMap (Overpass API).

Run from the repo root:  python tools/build_data.py
Standard library only. Prints a short quality report, and exits non-zero if the
parser self-test fails or the download looks too small to be real.
"""
import json
import re
import sys
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "cafes.json"
# The city and its inner ring: municipal borders from OSM, so the scope is one sentence and needs no upkeep.
MUNICIPALITIES = ["Stockholms", "Solna", "Sundbybergs", "Nacka", "Lidingö", "Danderyds"]
ENDPOINT = "https://overpass-api.de/api/interpreter"
USER_AGENT = "cafes-of-stockholm-build/0.1"
MIN_EXPECTED = 300  # fewer than this means Overpass returned a partial result
DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
OUTDOOR_YES = {"yes", "sidewalk", "terrace", "pedestrian_zone", "garden", "veranda", "patio"}

DAY = r"(?:Mo|Tu|We|Th|Fr|Sa|Su)"
DAY_SELECTOR = rf"{DAY}(?:\s*-\s*{DAY})?(?:\s*,\s*{DAY}(?:\s*-\s*{DAY})?)*"
TIME = r"\d{1,2}:\d{2}"
# "09:00+" means open from 09:00 until late.
SPAN = rf"(?:{TIME}\s*-\s*{TIME}\+?|{TIME}\+)"
RULE = re.compile(rf"^(?:({DAY_SELECTOR})(?:\s*,\s*PH)?\s*:?\s*)?(off|closed|{SPAN}(?:\s*,\s*{SPAN})*)$", re.I)
SEASONAL = re.compile(r"^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|week|\d{4}|easter)\b", re.I)
PUBLIC_HOLIDAY = re.compile(r"^(?:PH|SH)\b", re.I)


def minutes(text):
    hour, minute = text.split(":")
    return int(hour) * 60 + int(minute)


def expand_days(selector):
    days = []
    for part in selector.split(","):
        part = part.strip()
        if "-" in part:
            start, end = [DAYS.index(p.strip()) for p in part.split("-")]
            span = range(start, end + 1) if start <= end else list(range(start, 7)) + list(range(0, end + 1))
            days += [DAYS[i] for i in span]
        else:
            days.append(part)
    return days


def parse_hours(value):
    """Return {day: [[open, close], ...]} in minutes, or None if the rule can't be trusted.

    Seasonal and public-holiday rules are skipped, so this describes a normal week.
    Days a rule doesn't mention count as closed, as in the OSM specification.
    A close at or before the open time runs past midnight and is stored above 1440.
    """
    if not value or not value.strip():
        return None
    value = value.strip()
    if value == "24/7":
        return {d: [[0, 1440]] for d in DAYS}
    # A comma after a time, before a day name, also separates rules: "Mo-Fr 07:00-18:00, Sa 09:00-15:00"
    value = re.sub(rf"(?<=[\d+]),\s*(?={DAY})", ";", value)
    schedule, used_rule = {d: [] for d in DAYS}, False
    for raw in re.split(r";|\|\|", value):
        rule = raw.strip()
        if not rule or SEASONAL.match(rule) or PUBLIC_HOLIDAY.match(rule):
            continue
        match = RULE.match(rule)
        if not match:
            return None
        used_rule = True
        days = expand_days(match.group(1)) if match.group(1) else DAYS
        body = match.group(2)
        if body.lower() in ("off", "closed"):
            for d in days:
                schedule[d] = []
            continue
        spans = []
        for span in body.split(","):
            span = span.strip()
            if "-" not in span:
                # Open end: counted as open until midnight, and flagged so the card can say "until late".
                spans.append([minutes(span.rstrip("+")), 1440, 1])
                continue
            start, end = [p.strip().rstrip("+") for p in span.split("-")]
            opens, closes = minutes(start), minutes(end)
            if closes <= opens:
                closes += 1440
            spans.append([opens, closes])
        for d in days:
            schedule[d] = spans
    return schedule if used_rule else None


def self_test():
    week = {d: [] for d in DAYS}
    cases = [
        ("Mo-Fr 07:00-18:00; Sa-Su 08:00-17:00",
         {**{d: [[420, 1080]] for d in DAYS[:5]}, "Sa": [[480, 1020]], "Su": [[480, 1020]]}),
        ("Mo-Fr 07:00-18:00", {**week, **{d: [[420, 1080]] for d in DAYS[:5]}}),
        ("Mo off;Tu-Fr 07:00-15:00", {**week, **{d: [[420, 900]] for d in DAYS[1:5]}}),
        ("Fr-Sa 07:00-06:00", {**week, "Fr": [[420, 1800]], "Sa": [[420, 1800]]}),
        ("Mo-Fr 07:00-11:00,12:00-15:00", {**week, **{d: [[420, 660], [720, 900]] for d in DAYS[:5]}}),
        ("Mo,We 08:00-16:00, Fr 09:00-12:00", {**week, "Mo": [[480, 960]], "We": [[480, 960]], "Fr": [[540, 720]]}),
        ("Mo-Su 07:00-20:00; PH off", {d: [[420, 1200]] for d in DAYS}),
        ("Sa,Su 09:30-18:00; Mo-Fr 07:00-19:00",
         {**{d: [[420, 1140]] for d in DAYS[:5]}, "Sa": [[570, 1080]], "Su": [[570, 1080]]}),
        ("Mo-Fr 07:00-18:00; Jul off", {**week, **{d: [[420, 1080]] for d in DAYS[:5]}}),
        ("24/7", {d: [[0, 1440]] for d in DAYS}),
        ("Mo,Tu 09:00-18:00; We-Sa 09:00+; Su 09:00-18:00",
         {**{d: [[540, 1080]] for d in ("Mo", "Tu", "Su")}, **{d: [[540, 1440, 1]] for d in ("We", "Th", "Fr", "Sa")}}),
        ("Mo-Fr sunrise-sunset", None),
        ('Mo-Fr "by appointment"', None),
        ("Jun-Aug Mo-Fr 08:00-16:00", None),
        ("", None),
    ]
    failures = [(given, parse_hours(given), want) for given, want in cases if parse_hours(given) != want]
    for given, got, want in failures:
        print(f"PARSER TEST FAILED: {given!r}\n  got  {got}\n  want {want}", file=sys.stderr)
    return not failures


def fetch():
    names = "|".join(MUNICIPALITIES)
    query = (f'[out:json][timeout:180];area["name"="Stockholms län"]["admin_level"="4"]->.county;'
             f'rel(area.county)["boundary"="administrative"]["admin_level"="7"]["name"~"^({names}) kommun$"];'
             f'map_to_area->.scope;'
             f'(nwr["amenity"="cafe"](area.scope);nwr["shop"="coffee"](area.scope);nwr["shop"="bakery"](area.scope););'
             f'out center meta;')
    body = urllib.parse.urlencode({"data": query}).encode()
    request = urllib.request.Request(ENDPOINT, data=body, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=240) as response:
        return json.load(response)


def text(tags, *keys):
    for key in keys:
        if tags.get(key):
            return tags[key].strip()
    return ""


def web_url(value):
    """Only ever pass on http(s) links: OSM values end up as links on the page."""
    if not value:
        return ""
    value = value.split(";")[0].strip()
    if re.match(r"^https?://", value, re.I):
        return value
    return "https://" + value if re.match(r"^[\w-]+(\.[\w-]+)+(/\S*)?$", value) else ""


def instagram_url(value):
    if not value:
        return ""
    value = value.strip()
    if re.match(r"^https?://", value, re.I):
        return value
    handle = value.lstrip("@").split("/")[-1]
    return f"https://www.instagram.com/{handle}/" if re.match(r"^[\w.]+$", handle) else ""


def build(raw):
    seen, places = set(), []
    for element in raw["elements"]:
        key = (element["type"], element["id"])
        tags = element.get("tags", {})
        lat = element.get("lat") or element.get("center", {}).get("lat")
        lon = element.get("lon") or element.get("center", {}).get("lon")
        if key in seen or lat is None:
            continue
        seen.add(key)
        is_cafe = tags.get("amenity") == "cafe" or tags.get("shop") == "coffee"
        if not is_cafe and tags.get("shop") != "bakery":
            continue
        place = {
            "id": f"{element['type']}/{element['id']}",
            "name": text(tags, "name"),
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "kind": "cafe" if is_cafe else "bakery",
            "raw_hours": text(tags, "opening_hours"),
            "hours": parse_hours(tags.get("opening_hours")),
            "specialty": tags.get("drink:coffee") in ("specialty", "speciality"),
            "outdoor": tags.get("outdoor_seating") in OUTDOOR_YES,
            "brand": text(tags, "brand"),
            "website": web_url(text(tags, "website", "contact:website")),
            "instagram": instagram_url(text(tags, "contact:instagram")),
            "wheelchair": text(tags, "wheelchair"),
            "hours_checked": text(tags, "check_date:opening_hours"),
            "edited": (element.get("timestamp") or "")[:10],
        }
        places.append(place)

    # A chain is anything with a brand tag, plus same-named places whose tag is missing.
    brand_names = {p["brand"].casefold() for p in places if p["brand"]}
    brand_names |= {p["name"].casefold() for p in places if p["brand"] and p["name"]}
    for place in places:
        place["chain"] = bool(place["brand"]) or place["name"].casefold() in brand_names
        del place["brand"]

    places.sort(key=lambda p: (p["kind"], p["name"].casefold(), p["id"]))
    return places


def report(places, built_from):
    cafes = [p for p in places if p["kind"] == "cafe"]
    print(f"OSM snapshot {built_from}")
    print(f"cafes {len(cafes)}, bakeries {len(places) - len(cafes)}")
    print("cafes with raw hours", sum(1 for p in cafes if p["raw_hours"]),
          "| usable on the slider", sum(1 for p in cafes if p["hours"]))
    print("specialty", sum(p["specialty"] for p in places),
          "| outdoor", sum(p["outdoor"] for p in cafes), "| chain", sum(p["chain"] for p in cafes),
          "| unnamed", sum(1 for p in cafes if not p["name"]))
    print("chain names:", Counter(p["name"] for p in cafes if p["chain"]).most_common(40))
    print("hours the slider can't use:")
    for place in places:
        if place["raw_hours"] and not place["hours"]:
            print(f"  {place['name'] or '(unnamed)':34} {place['raw_hours'][:80]}")


def main():
    if not self_test():
        return 1
    raw = fetch()
    places = build(raw)
    if len(places) < MIN_EXPECTED:
        print(f"Only {len(places)} places returned, keeping the existing file.", file=sys.stderr)
        return 1
    built_from = raw.get("osm3s", {}).get("timestamp_osm_base") or datetime.now(timezone.utc).isoformat()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {"osm_timestamp": built_from, "places": places}
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    report(places, built_from)
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
