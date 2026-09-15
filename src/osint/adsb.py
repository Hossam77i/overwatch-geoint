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

            opensky_states = []
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
                    elif h.startswith("38") or h.startswith("39") or h.startswith("3A"):
                        c = "France"
                    elif h.startswith("3C") or h.startswith("3D") or h.startswith("3E") or h.startswith("3F"):
                        c = "Germany"
                    elif h.startswith("14") or h.startswith("15"):
                        c = "Russia"
                    elif h.startswith("78") or h.startswith("79") or h.startswith("7A") or h.startswith("7B"):
                        c = "China"
                    elif h.startswith("010"):
                        c = "Egypt"
                    elif h.startswith("7C"):
                        c = "Australia"
                    elif h.startswith("80"):
                        c = "India"
                    elif h.startswith("4B"):
                        c = "Turkey"
                    elif h.startswith("06A"):
                        c = "Greece"
                    elif h.startswith("48"):
                        c = "Poland"
                    elif h.startswith("44") or h.startswith("45"):
                        c = "Europe (EU)"

                    origin = f"{c} [{reg}]" if reg else c

                    opensky_states.append(
                        [
                            h, ac.get("flight", "").strip(), origin, None, None,
                            lon_val, lat_val, alt_m, False, vel_ms, ac.get("track", 0),
                            0, None, None, None, False, 0,
                        ]
                    )

            return {"states": opensky_states}
    except Exception as e:
        raise e
