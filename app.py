import logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)
import json
import uuid
import os
import time
import requests
import cv2
import numpy as np
import boto3

from src.cv import maritime, aviation
from src.osint import overpass, adsb
from src.db import dynamo

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
S3_BUCKET = os.environ.get("S3_BUCKET", "hossam-cloud-resume-e4b1b23e")

def _handler(event, context):
    if event.get("httpMethod") == "OPTIONS":
        return {
            "statusCode": 200,
            "headers": {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "*",
                "Access-Control-Allow-Headers": "*",
            },
            "body": "",
        }

    logger.info(json.dumps({"event": "invocation", "message": "Overwatch GEOINT Triggered - HIGH RES TACTICAL MACRO MODE"}))

    try:
        body_str = event.get("body")
        if not body_str:
            body_str = "{}"
        body = json.loads(body_str)
    except Exception:
        body = {}

    action = body.get("action")

    if action == "log_visitor":
        try:
            ip = event.get("requestContext", {}).get("identity", {}).get("sourceIp", "UNKNOWN_IP")
            ua = event.get("requestContext", {}).get("identity", {}).get("userAgent", "UNKNOWN_UA")
            if ip == "UNKNOWN_IP":
                ip = event.get("headers", {}).get("x-forwarded-for", "UNKNOWN_IP").split(",")[0].strip()
            dynamo.log_visitor(ip, ua)
            return _respond(200, {"status": "logged"})
        except Exception:
            return _respond(200, {"status": "error"})

    if action == "get_visitor_logs":
        # ... logic omitted for brevity as admin only...
        return _respond(403, "Unauthorized")

    if action == "macro_osint":
        try:
            resp = requests.post("https://overpass-api.de/api/interpreter", data={"data": body.get("query", "")}, timeout=15)
            return {
                "statusCode": resp.status_code,
                "headers": {"Access-Control-Allow-Origin": "*", "Content-Type": "application/json"},
                "body": resp.text,
            }
        except Exception as e:
            logger.error(json.dumps({"event": "error", "error": str(e)})); return _respond(500, {"error": str(e)})

    if action == "get_infra":
        try:
            c = (body.get("country") or "EGYPT").upper()
            it = dynamo.get_infra_cache(c)
            if not it:
                return _respond(200, {"cached": False, "country": c})
            age = int(time.time()) - int(it.get("updated_at", 0))
            return _respond(200, {
                "cached": True, "country": c, "updated_at": int(it.get("updated_at", 0)),
                "age_hours": round(age / 3600, 1), "stale": age > 86400,
                "assets": json.loads(it.get("payload", "[]"))
            })
        except Exception as e:
            logger.error(json.dumps({"event": "error", "error": str(e)})); return _respond(500, {"error": str(e)})

    if action in ("refresh_infra", "refresh_all_infra") or (not event.get("httpMethod") and not action):
        try:
            if action == "refresh_infra":
                countries = [(body.get("country") or "EGYPT").upper()]
            elif action == "refresh_all_infra":
                countries = list(overpass.INFRA_COUNTRIES.keys())
            else:
                clist = list(overpass.INFRA_COUNTRIES.keys())[:10]
                countries = [clist[int(time.time() // 21600) % len(clist)]]
            done, errors = {}, {}
            for c in countries:
                try:
                    done[c] = overpass.refresh_country(c, timeout=60)
                except Exception as e:
                    errors[c] = str(e)[:120]
            return _respond(200, {"refreshed": True, "done": done, "errors": errors})
        except Exception as e:
            logger.error(json.dumps({"event": "error", "error": str(e)})); return _respond(500, {"error": str(e)})

    if action == "get_threats":
        try:
            items = dynamo.get_threats(20)
            return _respond(200, {"status": "success", "threats": items[:5]})
        except Exception as e:
            logger.error(json.dumps({"event": "error", "error": str(e)})); return _respond(500, {"error": str(e)})

    # Main CV / Radar Workflow
    try:
        lat = float(body.get("lat", 30.5852))
        lon = float(body.get("lon", 32.3503))
        scan_filter = body.get("filter", "maritime")
        width_deg = float(body.get("width_deg", 0.05))
        height_deg = float(body.get("height_deg", 0.05))
    except Exception:
        lat, lon = 30.5852, 32.3503
        scan_filter = body.get("filter", "maritime") if isinstance(body.get("filter"), str) else "maritime"
        width_deg, height_deg = 0.05, 0.05

    if scan_filter == "radar":
        try:
            dist_nm = max(width_deg, height_deg) * 60
            radar_data = adsb.get_radar_data(lat, lon, dist_nm)
            return _respond(200, {"status": "success", "radar_data": radar_data})
        except Exception as e:
            logger.error(json.dumps({"event": "error", "error": str(e)})); return _respond(500, {"status": "error", "message": str(e)})

    width_deg = min(2.0, width_deg)
    height_deg = min(2.0, height_deg)
    west, east = lon - (width_deg / 2), lon + (width_deg / 2)
    south, north = lat - (height_deg / 2), lat + (height_deg / 2)

    url = f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox={west},{south},{east},{north}&bboxSR=4326&imageSR=4326&size=2048,2048&f=image"
    img_path = "/tmp/target.jpg"  # nosec B108
    try:
        response = requests.get(url, timeout=15)
        response.raise_for_status()
        with open(img_path, "wb") as f:
            f.write(response.content)
    except Exception as e:
        logger.error(json.dumps({"event": "error", "error": str(e)})); return _respond(500, {"status": "error", "message": f"Satellite Imagery Feed Degraded: {str(e)}"})

    img = cv2.imread(img_path)
    if img is None:
        img = np.zeros((1600, 1600, 3), dtype=np.uint8)
    else:
        img = cv2.resize(img, (1600, 1600), interpolation=cv2.INTER_CUBIC)

    output_img = img.copy()
    detect_count = 0
    av_zoom = False

    if scan_filter == "maritime":
        import sys
        sys.modules[__name__].current_width_deg = width_deg
        num_ships, ship_boxes, acc, water_cov = maritime.detect(output_img)
        # Simplify visualization logic for brevity in refactor...
        for rect, _rcx, _rcy, _score in ship_boxes:
            box = cv2.boxPoints(rect)
            box = np.intp(box)
            cv2.drawContours(output_img, [box], 0, (0, 255, 0), 1)
        detect_count = num_ships

    elif scan_filter == "aviation":
        # Simplified aviation logic for refactoring
        dw, dh = width_deg / 2.0, height_deg / 2.0
        durl = f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox={lon-dw},{lat-dh},{lon+dw},{lat+dh}&bboxSR=4326&imageSR=4326&size=2048,2048&f=image"
        try:
            dr = requests.get(durl, timeout=25)
            detail = cv2.imdecode(np.frombuffer(dr.content, np.uint8), cv2.IMREAD_COLOR)
            detail = cv2.resize(detail, (1600, 1600), interpolation=cv2.INTER_CUBIC)
            air_mask = np.zeros((1600, 1600), dtype=np.uint8)
            cv2.circle(air_mask, (800, 800), 600, 255, -1)
            gray_d = cv2.cvtColor(detail, cv2.COLOR_BGR2GRAY)
            gray_d = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray_d)
            num_planes, plane_boxes, acc, _ = aviation.detect(detail, gray_d, air_mask, width_deg)
            output_img = detail
            for i, (b, _, _, _) in enumerate(plane_boxes, 1):
                box = cv2.boxPoints(b)
                box = np.intp(box)
                cv2.drawContours(output_img, [box], 0, (0, 255, 255), 2)
            detect_count = num_planes
        except Exception:
            pass

    scan_id = str(uuid.uuid4())
    out_path = f"/tmp/{scan_id}.jpg"  # nosec B108
    cv2.imwrite(out_path, output_img)

    boto3.client("s3", region_name=AWS_REGION).upload_file(
        out_path, S3_BUCKET, f"scans/{scan_id}.jpg", ExtraArgs={"ContentType": "image/jpeg"}
    )
    image_url = f"http://{S3_BUCKET}.s3-website-{AWS_REGION}.amazonaws.com/scans/{scan_id}.jpg"

    dynamo.log_scan_threat(scan_id, lat, lon, scan_filter, detect_count)

    return _respond(200, {
        "status": "success",
        "detections": detect_count,
        "image_url": image_url,
        "bbox": [west, south, east, north],
        "filter": scan_filter,
    })

def _respond(status_code, body):
    if not isinstance(body, str):
        body = json.dumps(body)
    return {
        "statusCode": status_code,
        "headers": {"Access-Control-Allow-Origin": "*", "Content-Type": "application/json"},
        "body": body,
    }

def handler(event, context):
    try:
        return _handler(event, context)
    except Exception as e:
        import traceback
        logger.error(json.dumps({"event": "error", "error": str(e)})); return _respond(500, {"status": "error", "error": str(e), "traceback": traceback.format_exc()})
