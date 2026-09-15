import json
import urllib.request

def get_radar_data(lat, lon, dist_nm=100):
    try:
        # Convert degrees to nautical miles (approx), clamped to 250nm max to prevent timeouts
        dist_nm = max(10, min(250, dist_nm))
        url = f"https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{int(dist_nm)}"

        req = urllib.request.Request(
            url, headers={"User-Agent": "Overwatch-GeoINT-Serverless"}
        )
        with urllib.request.urlopen(req, timeout=8.0) as res:  # nosec B310
            data = json.loads(res.read().decode())

            features = []
            for ac in data.get("ac", []):
                lon_val = ac.get("lon")
                lat_val = ac.get("lat")
                if lon_val is not None and lat_val is not None:
                    # Safely parse Ground Speed
                    gs_val = ac.get("gs")
                    try:
                        vel_ms = float(gs_val) * 0.514444 if gs_val is not None else 0
                    except (ValueError, TypeError):
                        vel_ms = 0

                    # Safely parse Altitude
                    alt_ft = ac.get("alt_baro")
                    try:
                        alt_m = (float(alt_ft) * 0.3048) if alt_ft is not None else 0
                    except (ValueError, TypeError):
                        alt_m = 0

                    # Decrypt National Registry from ICAO Hex Block
                    h = str(ac.get("hex") or "").upper()
                    reg = str(ac.get("r") or "")
                    c = "Unknown"
                    if h.startswith("A"):
                        c = "United States"
                    elif h.startswith("C0") or h.startswith("C1") or h.startswith("C2") or h.startswith("C3"):
                        c = "Canada"
                    elif h.startswith("40") or h.startswith("41") or h.startswith("42") or h.startswith("43"):
                        c = "United Kingdom"
                    elif h.startswith("14") or h.startswith("15"):
                        c = "Russia"
                    elif h.startswith("78") or h.startswith("79") or h.startswith("7A") or h.startswith("7B"):
                        c = "China"
                    elif h.startswith("44") or h.startswith("45"):
                        c = "Europe (EU)"

                    origin = f"{c} [{reg}]" if reg else c

                    features.append({
                        "type": "Feature",
                        "geometry": {
                            "type": "Point",
                            "coordinates": [lon_val, lat_val, alt_m]
                        },
                        "properties": {
                            "icao": h,
                            "flight": ac.get("flight", "").strip(),
                            "origin": origin,
                            "velocity": vel_ms,
                            "heading": ac.get("track", 0),
                            "type": "aircraft"
                        }
                    })

            return {
                "type": "FeatureCollection",
                "features": features
            }
    except Exception as e:
        raise e
