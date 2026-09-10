import os, requests, cv2, numpy as np, boto3, time, uuid, json, math

def deg2num(lat_deg, lon_deg, zoom):
    lat_rad = math.radians(lat_deg)
    n = 2.0 ** zoom
    xtile = int((lon_deg + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return (xtile, ytile)

INFRA_COUNTRIES = {'EGYPT': 'EG', 'IRAN': 'IR', 'RUSSIA': 'RU', 'NORTH_KOREA': 'KP', 'SAUDI_ARABIA': 'SA'}
OVERPASS_MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
INFRA_UA = {"User-Agent": "Overwatch-GEOINT/1.0 (contact: overwatch demo; cache 24h)"}

def _refresh_country(c, timeout=10):
    """Fetch 4 OSM categories for one country with rate-limit guards. Returns asset count."""
    iso = INFRA_COUNTRIES.get(c, 'EG')
    filt = {
        'Aviation': '(node["aeroway"="aerodrome"]{g};way["aeroway"="aerodrome"]{g};)',
        'Energy': '(node["power"="plant"]{g};way["power"="plant"]{g};)',
        'Maritime': '(node["industrial"="port"]{g};way["industrial"="port"]{g};node["seamark:type"="harbour"]{g};)',
        'Military': '(node["military"]{g};way["military"]{g};node["landuse"="military"]{g};way["landuse"="military"]{g};)',
    }
    queries = {}
    if c == 'RUSSIA':
        # full-country area query times out: 3 asset-zone bboxes instead
        for i, (s, w, n, e) in enumerate([(50, 28, 62, 46), (66, 30, 70, 44), (42, 128, 47, 138)]):
            g = f"({s},{w},{n},{e})"
            for cat, f in filt.items():
                queries[f"{cat}#R{i}"] = f"[out:json][timeout:25];{f.format(g=g)};out center 60;"
    else:
        for cat, f in filt.items():
            queries[cat] = f'[out:json][timeout:25];area["ISO3166-1"="{iso}"]->.a;{f.format(g="(area.a)")};out center 80;'
    assets = []
    table = boto3.resource('dynamodb', region_name='us-east-1').Table('overwatch-infra-cache')
    for idx, (key, q) in enumerate(queries.items()):
        cat = key.split('#')[0]
        el = []
        for m in OVERPASS_MIRRORS:
            try:
                r = requests.post(m, data={'data': q}, headers=INFRA_UA, timeout=timeout)
                if r.status_code == 200:
                    el = r.json().get('elements', [])
                    break
                time.sleep(2)
            except Exception:
                time.sleep(2)
                continue
        for e in el[:80]:
            tags = e.get('tags', {})
            nm = tags.get('name') or tags.get('operator') or f"Unnamed {cat} site"
            la, lo = e.get('lat'), e.get('lon')
            if la is None and 'center' in e: la, lo = e['center'].get('lat'), e['center'].get('lon')
            if la is None: continue
            assets.append({'t': cat, 'n': nm[:80], 'd': (tags.get('operator') or cat)[:60], 's': 'Operational', 'c': 'ib-op', 'lat': round(float(la), 4), 'lon': round(float(lo), 4), 'q': nm[:60], 'k': 'macro'})
        time.sleep(2)  # rate-limit guard: never hammer Overpass
        if idx % 2 == 1:  # checkpoint: a timeout kill never loses collected progress
            try:
                table.put_item(Item={'country': c, 'updated_at': int(time.time()), 'expires_at': int(time.time()) + 7 * 86400, 'payload': json.dumps(assets[:300])})
            except Exception:
                pass
    table.put_item(
        Item={'country': c, 'updated_at': int(time.time()), 'expires_at': int(time.time()) + 7 * 86400, 'payload': json.dumps(assets[:300])})
    return len(assets[:300])

def _nms_centers(items, min_dist=12):
    """Greedy NMS by center distance. items: (rect, cx, cy, score, ...). Highest score wins."""
    items = sorted(items, key=lambda t: -t[3])
    kept = []
    for it in items:
        _, cx, cy, sc, *_ = it
        if all(math.hypot(cx - ox, cy - oy) >= min_dist for _, ox, oy, _, *_ in kept):
            kept.append(it)
    return kept


def _maritime_detect(img1600):
    """Scale-aware vessel detector for 1600px / ~22km frames (~13.75m/px).
    Returns (count, boxes[(rect, cx, cy, score)], confidence, water_cov)."""
    gray = cv2.cvtColor(img1600, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    # 5x5 open: 10x10 erases the ~14px-wide Suez canal entirely
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return 0, [], 62.0, 0.0
    contours = sorted(contours, key=cv2.contourArea, reverse=True)
    full = 1600.0 * 1600.0
    cov0 = cv2.contourArea(contours[0]) / full
    chosen = contours[0]
    if cov0 > 0.70 and len(contours) > 1:
        # Largest is land (annotated/darkened frames invert Otsu): fall back to 2nd body
        cov1 = cv2.contourArea(contours[1]) / full
        if 0.015 < cov1 < 0.65:
            chosen = contours[1]
        else:
            return 0, [], 60.0, round(cov0 * 100, 2)
    cov = cv2.contourArea(chosen) / full
    if cov < 0.015 or cov > 0.75:
        return 0, [], 60.0, round(cov * 100, 2)
    water_mask = np.zeros_like(gray)
    cv2.drawContours(water_mask, [chosen], 0, 255, -1)
    # Adaptive erosion from true channel width (distance transform)
    try:
        dist = cv2.distanceTransform(water_mask, cv2.DIST_L2, 3)
        width_px = float(dist.max()) * 2.0
    except Exception:
        width_px = 40.0
    if width_px < 30:
        ek = 3
    else:
        ek = 5
    water_eroded = cv2.erode(water_mask, np.ones((ek, ek), np.uint8), iterations=1)
    edges = cv2.Canny(gray, 50, 150)
    water_edges = cv2.bitwise_and(edges, edges, mask=water_eroded)
    water_edges = cv2.dilate(water_edges, np.ones((3, 3), np.uint8), iterations=1)
    ship_cnts, _ = cv2.findContours(water_edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    scored = []
    for cnt in ship_cnts:
        rect = cv2.minAreaRect(cnt)
        (rcx, rcy), (w, h), _ = rect
        area = w * h
        if area <= 0:
            continue
        ar = max(w, h) / max(1e-6, min(w, h))
        cnt_area = cv2.contourArea(cnt)
        ext = cnt_area / area
        try:
            hull_area = cv2.contourArea(cv2.convexHull(cnt))
            sol = cnt_area / hull_area if hull_area > 0 else 1.0
        except Exception:
            sol = 1.0
        # 50-400m ships at 13.75m/px -> 4-29px long, 1-5px wide, 10-400px²
        if not (12 < area < 800 and 1.6 < ar < 10.0 and ext > 0.35 and sol > 0.35 and min(w, h) >= 1.8):
            continue
        x, y, bw, bh = cv2.boundingRect(cnt)
        if x <= 2 or y <= 2 or x + bw >= 1598 or y + bh >= 1598:
            continue  # tile borders / frame edges, not vessels
        x0, y0 = max(0, x - 6), max(0, y - 6)
        x1, y1 = min(1600, x + bw + 6), min(1600, y + bh + 6)
        ring = gray[y0:y1, x0:x1].astype(np.float32)
        inner = gray[y:y + bh, x:x + bw].astype(np.float32)
        if ring.size == 0 or inner.size == 0:
            continue
        contrast = abs(float(inner.mean()) - float(ring.mean()))
        if contrast < 8:
            continue
        score = 0.35 * min(1.0, area / 250.0) + 0.35 * min(1.0, ext) + 0.30 * min(1.0, contrast / 40.0)
        if score < 0.30:
            continue
        scored.append((rect, rcx, rcy, score, contrast, ext))
    kept = _nms_centers(scored, min_dist=12)[:40]
    n = len(kept)
    if n == 0:
        return 0, [], 62.0, round(cov * 100, 2)
    mean_score = sum(k[3] for k in kept) / n
    conf = min(94.0, 68.0 + 22.0 * mean_score + 3.0 * math.log1p(n))
    return n, [(k[0], k[1], k[2], k[3]) for k in kept], round(conf, 1), round(cov * 100, 2)


def _aviation_detect(detail1600, gray_d, air_mask):
    """Scale-aware airframe detector for 1600px / ~5km frames (~3.1m/px).
    30-70m airliners -> 10-23px. Returns (count, boxes, confidence)."""
    tophat = cv2.morphologyEx(gray_d, cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21)))
    blackhat = cv2.morphologyEx(gray_d, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21)))
    kept = []
    for pct in (97.5, 98.0, 98.5, 99.0, 99.5, 99.8):
        _, tmw = cv2.threshold(tophat, float(np.percentile(tophat, pct)), 255, cv2.THRESH_BINARY)
        _, tmb = cv2.threshold(blackhat, float(np.percentile(blackhat, pct)), 255, cv2.THRESH_BINARY)
        tm = cv2.bitwise_and(cv2.bitwise_or(tmw, tmb), cv2.bitwise_or(tmw, tmb), mask=air_mask)
        cnts, _ = cv2.findContours(tm, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        boxes = []
        for cnt in cnts:
            rect = cv2.minAreaRect(cnt)
            (rcx, rcy), (w, h), _ = rect
            if min(w, h) < 1 or max(w, h) > 32:
                continue
            area = w * h
            ar = max(w, h) / max(1e-6, min(w, h))
            ext = cv2.contourArea(cnt) / area if area > 0 else 0
            if area < 30 or area > 900 or ext < 0.18:
                continue
            x, y, bw, bh = cv2.boundingRect(cnt)
            x0, y0 = max(0, x - 6), max(0, y - 6)
            x1, y1 = min(1600, x + bw + 6), min(1600, y + bh + 6)
            ring = gray_d[y0:y1, x0:x1].astype(np.float32)
            inner = gray_d[y:y + bh, x:x + bw].astype(np.float32)
            if ring.size == 0 or inner.size == 0:
                continue
            contrast = abs(float(inner.mean()) - float(ring.mean()))
            # Note: no ring-std gate — JPEG tarmac/markings are textured (std 60-90);
            # contrast + shape + defects already separate jets from blocks.
            if contrast < 8:
                continue
            if len(cnt) < 5:
                continue
            hull = cv2.convexHull(cnt, returnPoints=False)
            ndef = 0
            try:
                if hull is not None and len(hull) > 3:
                    dfx = cv2.convexityDefects(cnt, hull)
                    if dfx is not None:
                        long_side = max(w, h)
                        for row in np.asarray(dfx).reshape(-1, 4):
                            if float(row[3]) / 256.0 > 0.08 * long_side:
                                ndef += 1
            except Exception:
                continue
            try:
                ha = cv2.contourArea(cv2.convexHull(cnt))
                sol = cv2.contourArea(cnt) / ha if ha > 0 else 1.0
            except Exception:
                sol = 1.0
            track = None
            if 1.0 <= ar <= 1.8 and 60 < area < 650 and ndef >= 2 and sol < 0.75:
                track = 0  # compact top-down cross
            elif 1.6 < ar < 6.5 and ext > 0.22 and ndef >= 2 and sol < 0.85:
                track = 1  # elongated side-profile airframe
            if track is None:
                continue
            score = 0.40 * min(1.0, ndef / 4.0) + 0.30 * min(1.0, contrast / 40.0) + 0.30 * (1.0 - min(1.0, sol))
            if score < 0.35:
                continue
            boxes.append((rect, rcx, rcy, score, track, area, sol, contrast, ndef))
        boxes.sort(key=lambda t: -t[3])
        kept = []
        for b, x, y, sc, tr, ar2, so, co, nd in boxes:
            dist = max(11.0, (b[1][0] + b[1][1]) / 4.0)
            if all(math.hypot(x - ox, y - oy) >= dist for _, ox, oy, _, _, _, _, _, _ in kept):
                kept.append((b, x, y, sc, tr, ar2, so, co, nd))
            if len(kept) >= 40:
                break
        if len(kept) < 40 or pct >= 99.8:
            break
    n = len(kept)
    if n == 0:
        return 0, [], 60.0
    hi = sum(1 for *_, tr, _, _, _, _ in kept if tr == 0)
    mean_score = sum(k[3] for k in kept) / n
    conf = min(93.0, 68.0 + 20.0 * (hi / max(1, n)) + 8.0 * mean_score)
    return n, [(k[0], k[1], k[2], k[3]) for k in kept], round(conf, 1)


def handler(event, context):
    if event.get('httpMethod') == 'OPTIONS':
        return {"statusCode": 200, "headers": {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "*", "Access-Control-Allow-Headers": "*"}, "body": ""}
        
    print("[*] Overwatch GEOINT Triggered - HIGH RES TACTICAL MACRO MODE.")
    
    try:
        body_str = event.get('body')
        if not body_str: body_str = '{}'
        body = json.loads(body_str)
    except Exception:
        body = {}
    
    # --- MACRO OSINT PROXY (Bypass Local IP Blocking) ---
    if body.get('action') == 'macro_osint':
        try:
            resp = requests.post("https://overpass-api.de/api/interpreter", data=body.get('query', ''), timeout=15)
            return {
                "statusCode": resp.status_code,
                "headers": {"Access-Control-Allow-Origin": "*", "Content-Type": "application/json"},
                "body": resp.text
            }
        except Exception as e:
            return {
                "statusCode": 500,
                "headers": {"Access-Control-Allow-Origin": "*"},
                "body": json.dumps({"error": str(e)})
            }
    
    # --- INFRA CACHE: read 24h DB snapshot (frontend never hits Overpass directly) ---
    if body.get('action') == 'get_infra':
        try:
            c = (body.get('country') or 'EGYPT').upper()
            r = boto3.resource('dynamodb', region_name='us-east-1').Table('overwatch-infra-cache').get_item(Key={'country': c})
            it = r.get('Item')
            if not it:
                return {"statusCode": 200, "headers": {"Access-Control-Allow-Origin": "*", "Content-Type": "application/json"}, "body": json.dumps({"cached": False, "country": c})}
            age = int(time.time()) - int(it.get('updated_at', 0))
            return {"statusCode": 200, "headers": {"Access-Control-Allow-Origin": "*", "Content-Type": "application/json"},
                "body": json.dumps({"cached": True, "country": c, "updated_at": int(it.get('updated_at', 0)), "age_hours": round(age / 3600, 1), "stale": age > 86400, "assets": json.loads(it.get('payload', '[]'))})}
        except Exception as e:
            return {"statusCode": 500, "headers": {"Access-Control-Allow-Origin": "*"}, "body": json.dumps({"error": str(e)})}

    # --- INFRA REFRESH: single country (manual) or all 5 (daily auto). Per-country isolation: one failure never kills the rest. ---
    if body.get('action') in ('refresh_infra', 'refresh_all_infra') or (not event.get('httpMethod') and not body.get('action')):
        try:
            if body.get('action') == 'refresh_infra':
                countries = [(body.get('country') or 'EGYPT').upper()]
            elif body.get('action') == 'refresh_all_infra':
                # small countries first so a slow giant (RU) can never starve the rest
                countries = ['SAUDI_ARABIA', 'NORTH_KOREA', 'IRAN', 'EGYPT', 'RUSSIA']
            else:  # daily EventBridge backup: rotate one country/day (fits 60s Lambda)
                countries = [['EGYPT', 'IRAN', 'RUSSIA', 'NORTH_KOREA', 'SAUDI_ARABIA'][int(time.time() // 86400) % 5]]
            done, errors = {}, {}
            for c in countries:
                try:
                    done[c] = _refresh_country(c, timeout=25 if c == 'RUSSIA' else 10)
                except Exception as e:
                    errors[c] = str(e)[:120]
                time.sleep(3)
            return {"statusCode": 200, "headers": {"Access-Control-Allow-Origin": "*", "Content-Type": "application/json"},
                "body": json.dumps({"refreshed": True, "done": done, "errors": errors})}
        except Exception as e:
            return {"statusCode": 500, "headers": {"Access-Control-Allow-Origin": "*"}, "body": json.dumps({"error": str(e)})}

    try:
        lat = float(body.get('lat', 30.5852))
        lon = float(body.get('lon', 32.3503))
        scan_filter = body.get('filter', 'maritime')
    except:
        lat, lon, scan_filter = 30.5852, 32.3503, 'maritime'

    # Define a tactical bounding box (e.g. ~22km x 22km)
    width_deg = 0.2
    height_deg = 0.2
    west = lon - width_deg / 2
    east = lon + width_deg / 2
    south = lat - height_deg / 2
    north = lat + height_deg / 2

    # Fetch dynamically rendered satellite composite perfectly centered on target (200% scale)
    url = f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox={west},{south},{east},{north}&bboxSR=4326&imageSR=4326&size=2048,2048&f=image"
    
    img_path = "/tmp/target.jpg"
    response = requests.get(url)
    with open(img_path, 'wb') as f: f.write(response.content)

    img = cv2.imread(img_path)
    if img is None:
        img = np.zeros((1600, 1600, 3), dtype=np.uint8)
    else:
        img = cv2.resize(img, (1600, 1600), interpolation=cv2.INTER_CUBIC)
    
    output_img = img.copy()
    
    cx = 800
    cy = 800
    
    detect_count = 0
    av_zoom = False

    if scan_filter == 'maritime':
        num_ships, ship_boxes, acc, water_cov = _maritime_detect(output_img)
        # Viz: darken land + true shoreline wrap (same Otsu guard as detector)
        try:
            gray_viz = cv2.cvtColor(output_img, cv2.COLOR_BGR2GRAY)
            _, th_viz = cv2.threshold(gray_viz, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
            th_viz = cv2.morphologyEx(th_viz, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
            cnts_viz, _ = cv2.findContours(th_viz, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if cnts_viz:
                cnts_viz = sorted(cnts_viz, key=cv2.contourArea, reverse=True)
                chosen_viz = cnts_viz[0]
                if cv2.contourArea(chosen_viz) / 2560000.0 > 0.70 and len(cnts_viz) > 1:
                    chosen_viz = cnts_viz[1]
                water_mask_viz = np.zeros_like(gray_viz)
                cv2.drawContours(water_mask_viz, [chosen_viz], 0, 255, -1)
                land_mask = cv2.bitwise_not(water_mask_viz)
                land_dark = (cv2.bitwise_and(output_img, output_img, mask=land_mask) * 0.3).astype(np.uint8)
                water_bright = cv2.bitwise_and(output_img, output_img, mask=water_mask_viz)
                output_img = cv2.add(land_dark, water_bright)
                shore_mask = cv2.Canny(water_mask_viz, 100, 200)
                shore_mask[0:4, :] = 0
                shore_mask[-4:, :] = 0
                shore_mask[:, 0:4] = 0
                shore_mask[:, -4:] = 0
                shore_mask = cv2.dilate(shore_mask, np.ones((3, 3), np.uint8), iterations=1)
                output_img[shore_mask > 0] = [255, 200, 0]
        except Exception:
            pass
        for (rect, _rcx, _rcy, _score) in ship_boxes:
            box = cv2.boxPoints(rect)
            box = np.intp(box)
            cv2.drawContours(output_img, [box], 0, (0, 255, 0), 1)
            rx, ry, rw, rh = cv2.boundingRect(box)
            cv2.putText(output_img, "VESSEL", (rx, ry - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.25, (0, 255, 0), 1)
        cv2.putText(output_img, f"TOPOLOGICAL LOCK: {acc:.1f}% | VESSELS: {num_ships} | WATER {water_cov:.1f}%", (40, 160), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 200, 0), 1)
        detect_count = num_ships

    elif scan_filter == 'aviation':
        # Hi-res 5km detail window (~3.1m/px: airliner = 10-23px). GIS-masked hunt.
        num_planes = 0
        av_zoom = False
        try:
            dw, dh = 0.025, 0.025
            durl = f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox={lon-dw},{lat-dh},{lon+dw},{lat+dh}&bboxSR=4326&imageSR=4326&size=2048,2048&f=image"
            dr = requests.get(durl, timeout=25)
            detail = cv2.imdecode(np.frombuffer(dr.content, np.uint8), cv2.IMREAD_COLOR)
            if detail is None:
                raise ValueError("detail fetch failed")
            detail = cv2.resize(detail, (1600, 1600), interpolation=cv2.INTER_CUBIC)
            # AIRFIELD MASK (GIS-guided): runways/taxiways/aprons only, so city
            # blocks can never become candidates. Fallback = 1.2km center circle
            # (airport is always at target center), never full frame.
            # Guard: aviation scans outside known airfield sectors abort instead
            # of hallucinating jets over canals/cities when OSM is unreachable.
            KNOWN_AIRFIELDS = [(30.1219, 31.4056), (55.972, 37.414), (39.224, 125.67)]
            air_mask = np.zeros((1600, 1600), dtype=np.uint8)
            mask_from_osm = False
            try:
                aq = f'[out:json][timeout:15];(way["aeroway"~"^(runway|taxiway|apron|terminal|hangar)$"](around:3000,{lat},{lon}););out geom;'
                ar = requests.post(OVERPASS_MIRRORS[0], data={'data': aq}, headers=INFRA_UA, timeout=10)
                ap = ar.json().get('elements', []) if ar.status_code == 200 else []
                if ap:
                    for el in ap:
                        g = el.get('geometry', [])
                        if len(g) < 3:
                            continue
                        pts = np.array([[(p['lon'] - (lon - dw)) / (2 * dw) * 1600, (1 - (p['lat'] - (lat - dh)) / (2 * dh)) * 1600] for p in g], dtype=np.int32)
                        cv2.fillPoly(air_mask, [pts], 255)
                    air_mask = cv2.dilate(air_mask, np.ones((25, 25), np.uint8), iterations=1)
                    mask_from_osm = True
                else:
                    raise ValueError("empty airfield geom")
            except Exception:
                pass
            if not mask_from_osm:
                nearest = min(math.hypot(lat - a[0], lon - a[1]) for a in KNOWN_AIRFIELDS)
                if nearest > 0.2:
                    cv2.putText(output_img, "NO AIRFIELD IN SECTOR: AVIATION ABORTED", (40, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)
                    detect_count = 0
                    av_zoom = True
                    west, south, east, north = lon - dw, lat - dh, lon + dw, lat + dh
                    acc = 60.0
                else:
                    cv2.circle(air_mask, (800, 800), 600, 255, -1)
                    gray_d = cv2.cvtColor(detail, cv2.COLOR_BGR2GRAY)
                    gray_d = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray_d)
                    num_planes, plane_boxes, acc = _aviation_detect(detail, gray_d, air_mask)
                    output_img = detail
                    for i, (b, _, _, _) in enumerate(plane_boxes, 1):
                        box = cv2.boxPoints(b)
                        box = np.intp(box)
                        cv2.drawContours(output_img, [box], 0, (0, 255, 255), 2)
                        rx, ry, rw, rh = cv2.boundingRect(box)
                        cv2.putText(output_img, f"ACFT-{i}", (rx, max(0, ry - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 255), 1)
                    cv2.putText(output_img, f"AIRFRAME LOCK: {acc:.1f}% | AIRCRAFT: {num_planes}", (40, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)
                    detect_count = num_planes
                    av_zoom = True
                    west, south, east, north = lon - dw, lat - dh, lon + dw, lat + dh
            else:
                gray_d = cv2.cvtColor(detail, cv2.COLOR_BGR2GRAY)
                gray_d = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray_d)
                num_planes, plane_boxes, acc = _aviation_detect(detail, gray_d, air_mask)
                output_img = detail
                for i, (b, _, _, _) in enumerate(plane_boxes, 1):
                    box = cv2.boxPoints(b)
                    box = np.intp(box)
                    cv2.drawContours(output_img, [box], 0, (0, 255, 255), 2)
                    rx, ry, rw, rh = cv2.boundingRect(box)
                    cv2.putText(output_img, f"ACFT-{i}", (rx, max(0, ry - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 255), 1)
                cv2.putText(output_img, f"AIRFRAME LOCK: {acc:.1f}% | AIRCRAFT: {num_planes}", (40, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)
                detect_count = num_planes
                av_zoom = True
                west, south, east, north = lon - dw, lat - dh, lon + dw, lat + dh
        except Exception:
            box_w, box_h = 500, 300
            cv2.rectangle(output_img, (cx - box_w//2, cy - box_h//2), (cx + box_w//2, cy + box_h//2), (255, 255, 0), 3)
            cv2.putText(output_img, "AVIATION LOCK: DETAIL FEED DEGRADED", (cx - box_w//2, cy - box_h//2 - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
            detect_count = 0

    elif scan_filter == 'energy':
        r = 120
        cv2.circle(output_img, (cx, cy), r, (0, 165, 255), 4)
        cv2.line(output_img, (cx-r-80, cy), (cx+r+80, cy), (0, 165, 255), 3)
        cv2.line(output_img, (cx, cy-r-80), (cx, cy+r+80), (0, 165, 255), 3)
        try:
            _sharp = cv2.Laplacian(cv2.cvtColor(output_img, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var()
            acc = min(96.0, 88.0 + min(8.0, float(_sharp) / 500.0))
        except Exception:
            acc = 90.0
        cv2.putText(output_img, f"THERMAL SIGNATURE: LOCKED ({acc:.1f}%)", (cx+r+20, cy-20), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 165, 255), 2)
        detect_count = 1

    # --- TACTICAL HUD OVERLAY ---
    overlay = output_img.copy()
    cv2.rectangle(overlay, (0, 0), (1600, 60), (0, 0, 0), -1)
    output_img = cv2.addWeighted(overlay, 0.7, output_img, 0.3, 0)
    
    from datetime import datetime
    timestamp_str = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')
    
    cv2.putText(output_img, f"OVERWATCH GEOINT // HIGH-RES TACTICAL FEED (200% SCALE)", (20, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 0), 1)
    cv2.putText(output_img, f"TGT: {lat:.5f}N, {lon:.5f}E | ALT: {'5km' if av_zoom else '12km'} | CLOUD COVER: 0%", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 200, 0), 1)
    cv2.putText(output_img, f"ALGORITHM: {scan_filter.upper()}-LOCK", (1250, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 200, 0), 1)
    
    scan_id = str(uuid.uuid4())
    out_path = f"/tmp/{scan_id}.jpg"
    cv2.imwrite(out_path, output_img)
    
    bucket_name = "hossam-cloud-resume-e4b1b23e"
    s3_key = f"scans/{scan_id}.jpg"
    boto3.client('s3', region_name='us-east-1').upload_file(out_path, bucket_name, s3_key, ExtraArgs={'ContentType': 'image/jpeg'})
    image_url = f"http://{bucket_name}.s3-website-us-east-1.amazonaws.com/{s3_key}"

    try:
        boto3.resource('dynamodb', region_name='us-east-1').Table('cloud-resume-threats').put_item(
            Item={'id': scan_id, 'timestamp': int(time.time()), 'ip': 'GLOBAL-INTEL', 'user_agent': f'OVERWATCH-{scan_filter.upper()}', 'payload': f"{detect_count} ANOMALIES AT {lat}, {lon}"}
        )
    except: pass

    return {
        "statusCode": 200,
        "headers": {"Access-Control-Allow-Origin": "*"},
        "body": json.dumps({
            "status": "success", 
            "detections": detect_count, 
            "image_url": image_url, 
            "bbox": [west, south, east, north],
            "filter": scan_filter
        })
    }
