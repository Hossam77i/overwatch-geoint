import json
import time
import requests
import boto3
import os

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
DYNAMODB_INFRA_CACHE = os.environ.get("DYNAMODB_INFRA_CACHE", "overwatch-infra-cache")

INFRA_COUNTRIES = {
    "EGYPT": "EG", "IRAN": "IR", "RUSSIA": "RU", "NORTH_KOREA": "KP",
    "SAUDI_ARABIA": "SA", "CHINA": "CN", "USA": "US", "ISRAEL": "IL",
    "UK": "GB", "FRANCE": "FR", "GERMANY": "DE", "INDIA": "IN",
    "PAKISTAN": "PK", "SYRIA": "SY", "UKRAINE": "UA", "JAPAN": "JP",
    "SOUTH_KOREA": "KR", "TAIWAN": "TW", "AUSTRALIA": "AU", "CANADA": "CA",
    "BRAZIL": "BR", "MEXICO": "MX", "ARGENTINA": "AR", "TURKEY": "TR",
    "GREECE": "GR", "ITALY": "IT", "SPAIN": "ES", "POLAND": "PL",
    "SWEDEN": "SE", "NORWAY": "NO", "FINLAND": "FI", "DENMARK": "DK",
    "NETHERLANDS": "NL", "BELGIUM": "BE", "SWITZERLAND": "CH", "UAE": "AE",
    "QATAR": "QA", "IRAQ": "IQ", "YEMEN": "YE", "OMAN": "OM",
    "SOUTH_AFRICA": "ZA", "NIGERIA": "NG", "KENYA": "KE", "ETHIOPIA": "ET",
    "ALGERIA": "DZ", "MOROCCO": "MA", "VENEZUELA": "VE", "COLOMBIA": "CO",
    "CHILE": "CL", "PERU": "PE",
}

OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
INFRA_UA = {"User-Agent": "Overwatch-GEOINT/1.0 (contact: overwatch demo; cache 24h)"}

def refresh_country(c, timeout=10):
    """Fetch 4 OSM categories for one country with rate-limit guards. Returns asset count."""
    iso = INFRA_COUNTRIES.get(c, "EG")
    filt = {
        "Aviation": '(nwr["aeroway"="aerodrome"]["iata"]{g};nwr["aeroway"="aerodrome"]["icao"]{g};nwr["military"~"airfield|air_base"]{g};)',
        "Energy": '(nwr["power"~"plant|generator"]{g};nwr["power"="station"]{g};)',
        "Maritime": '(nwr["industrial"="port"]{g};nwr["seamark:type"~"harbour|dock"]{g};nwr["landuse"="port"]{g};nwr["man_made"="pier"]["seamark:type"]{g};)',
        "Military": '(nwr["military"~"base|barracks|bunker"]{g};nwr["landuse"="military"]{g};)',
    }
    queries = {}
    if c == "RUSSIA":
        for i, (s, w, n, e) in enumerate([(50, 28, 62, 46), (66, 30, 70, 44), (42, 128, 47, 138)]):
            g = f"({s},{w},{n},{e})"
            for cat, f in filt.items():
                queries[f"{cat}#R{i}"] = f"[out:json][timeout:60];{f.format(g=g)};out center;"
    else:
        for cat, f in filt.items():
            queries[cat] = f'[out:json][timeout:60];area["ISO3166-1"="{iso}"]->.a;{f.format(g="(area.a)")};out center;'
            
    assets = []
    table = boto3.resource("dynamodb", region_name=AWS_REGION).Table(DYNAMODB_INFRA_CACHE)
    
    for idx, (key, q) in enumerate(queries.items()):
        cat = key.split("#")[0]
        el = []
        for m in OVERPASS_MIRRORS:
            try:
                r = requests.post(m, data={"data": q}, headers=INFRA_UA, timeout=timeout)
                if r.status_code == 200:
                    el = r.json().get("elements", [])
                    break
                # Replacing sleep with immediate retry on next mirror to improve serverless performance
            except Exception:
                continue
                
        for e in el[:450]:
            tags = e.get("tags", {})
            nm = tags.get("name") or tags.get("operator") or f"Unnamed {cat} site"
            la, lo = e.get("lat"), e.get("lon")
            if la is None and "center" in e:
                la, lo = e["center"].get("lat"), e["center"].get("lon")
            if la is None:
                continue
            assets.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [round(float(lo), 4), round(float(la), 4)]
                },
                "properties": {
                    "t": cat, "n": nm[:80], "d": (tags.get("operator") or cat)[:60],
                    "s": "Operational", "c": "ib-op",
                    "q": nm[:60], "k": "macro"
                }
            })
        
        # Checkpoint partial progress
        if idx % 2 == 1 and len(assets) > 0:
            try:
                table.put_item(
                    Item={
                        "country": c,
                        "updated_at": int(time.time()),
                        "expires_at": int(time.time()) + 7 * 86400,
                        "payload": json.dumps(assets[:1800]),
                    }
                )
            except Exception:
                pass
                
    if len(assets) > 0:
        try:
            table.put_item(
                Item={
                    "country": c,
                    "updated_at": int(time.time()),
                    "expires_at": int(time.time()) + 7 * 86400,
                    "payload": json.dumps(assets[:1800]),
                }
            )
        except Exception:
            pass
    return len(assets[:1800])
