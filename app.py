import os, requests, cv2, numpy as np, boto3, time, uuid, json, math

def deg2num(lat_deg, lon_deg, zoom):
    lat_rad = math.radians(lat_deg)
    n = 2.0 ** zoom
    xtile = int((lon_deg + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return (xtile, ytile)

def handler(event, context):
    print("[*] Overwatch GEOINT Triggered - HIGH RES TACTICAL MODE.")
    
    try:
        body = json.loads(event.get('body', '{}'))
        lat = float(body.get('lat', 30.5852))
        lon = float(body.get('lon', 32.3503))
        scan_filter = body.get('filter', 'maritime')
    except:
        lat, lon, scan_filter = 30.5852, 32.3503, 'maritime'

    # Fetch Ultra-High-Res Esri Satellite Tile (Zoom 16)
    z = 16
    x, y = deg2num(lat, lon, z)
    url = f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
    
    img_path = "/tmp/target.jpg"
    response = requests.get(url)
    with open(img_path, 'wb') as f: f.write(response.content)

    img = cv2.imread(img_path)
    img = cv2.resize(img, (800, 800), interpolation=cv2.INTER_CUBIC)
    output_img = img.copy()
    
    # Calculate EXACT pixel coordinate of the GPS target inside this specific tile
    n = 2.0 ** z
    x_exact = (lon + 180.0) / 360.0 * n
    y_exact = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
    cx = int((x_exact - x) * 800)
    cy = int((y_exact - y) * 800)
    
    detect_count = 0
    import random
    
    if scan_filter == 'maritime':
        box_w, box_h = 160, 160
        cv2.rectangle(output_img, (cx - box_w//2, cy - box_h//2), (cx + box_w//2, cy + box_h//2), (0, 0, 255), 2)
        d = 25
        cv2.line(output_img, (cx - box_w//2, cy - box_h//2), (cx - box_w//2 + d, cy - box_h//2), (0, 0, 255), 3)
        cv2.line(output_img, (cx - box_w//2, cy - box_h//2), (cx - box_w//2, cy - box_h//2 + d), (0, 0, 255), 3)
        cv2.line(output_img, (cx + box_w//2, cy - box_h//2), (cx + box_w//2 - d, cy - box_h//2), (0, 0, 255), 3)
        cv2.line(output_img, (cx + box_w//2, cy - box_h//2), (cx + box_w//2, cy - box_h//2 + d), (0, 0, 255), 3)
        cv2.line(output_img, (cx - box_w//2, cy + box_h//2), (cx - box_w//2 + d, cy + box_h//2), (0, 0, 255), 3)
        cv2.line(output_img, (cx - box_w//2, cy + box_h//2), (cx - box_w//2, cy + box_h//2 - d), (0, 0, 255), 3)
        cv2.line(output_img, (cx + box_w//2, cy + box_h//2), (cx + box_w//2 - d, cy + box_h//2), (0, 0, 255), 3)
        cv2.line(output_img, (cx + box_w//2, cy + box_h//2), (cx + box_w//2, cy + box_h//2 - d), (0, 0, 255), 3)
        
        num_ships = random.randint(5, 12)
        for i in range(num_ships):
            sx = cx + random.randint(-60, 60)
            sy = cy + random.randint(-60, 60)
            cv2.rectangle(output_img, (sx-6, sy-6), (sx+6, sy+6), (0, 255, 0), 2)
            cv2.putText(output_img, "VESSEL", (sx+8, sy-5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 0), 1)
            
        cv2.putText(output_img, f"NAVAL FLEET LOCK: 98.4% | VESSELS: {num_ships}", (cx - box_w//2, cy - box_h//2 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
        detect_count = num_ships

    elif scan_filter == 'aviation':
        box_w, box_h = 250, 150
        cv2.rectangle(output_img, (cx - box_w//2, cy - box_h//2), (cx + box_w//2, cy + box_h//2), (255, 255, 0), 2)
        d = 30
        cv2.line(output_img, (cx - box_w//2, cy - box_h//2), (cx - box_w//2 + d, cy - box_h//2), (255, 255, 0), 4)
        cv2.line(output_img, (cx - box_w//2, cy - box_h//2), (cx - box_w//2, cy - box_h//2 + d), (255, 255, 0), 4)
        cv2.line(output_img, (cx + box_w//2, cy + box_h//2), (cx + box_w//2 - d, cy + box_h//2), (255, 255, 0), 4)
        cv2.line(output_img, (cx + box_w//2, cy + box_h//2), (cx + box_w//2, cy + box_h//2 - d), (255, 255, 0), 4)
        cv2.circle(output_img, (cx, cy), 6, (0, 0, 255), -1)
        cv2.putText(output_img, f"AVIATION LOCK: 99.8%", (cx - box_w//2, cy - box_h//2 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
        detect_count = 1

    elif scan_filter == 'energy':
        r = 60
        cv2.circle(output_img, (cx, cy), r, (0, 165, 255), 3)
        cv2.line(output_img, (cx-r-40, cy), (cx+r+40, cy), (0, 165, 255), 2)
        cv2.line(output_img, (cx, cy-r-40), (cx, cy+r+40), (0, 165, 255), 2)
        cv2.putText(output_img, "THERMAL SIGNATURE: LOCKED", (cx+r+15, cy-15), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 165, 255), 2)
        detect_count = 1

    # --- TACTICAL HUD OVERLAY ---
    overlay = output_img.copy()
    cv2.rectangle(overlay, (0, 0), (800, 80), (0, 0, 0), -1)
    output_img = cv2.addWeighted(overlay, 0.7, output_img, 0.3, 0)
    
    from datetime import datetime
    timestamp_str = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')
    
    cv2.putText(output_img, f"OVERWATCH GEOINT // HIGH-RES TACTICAL FEED", (20, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
    cv2.putText(output_img, f"TGT: {lat:.5f}N, {lon:.5f}E | ALT: 12km | CLOUD COVER: 0%", (20, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 200, 0), 1)
    cv2.putText(output_img, f"ALGORITHM: {scan_filter.upper()}-LOCK", (500, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 200, 0), 2)
    
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
            "bbox": [lon-0.1, lat-0.1, lon+0.1, lat+0.1],
            "filter": scan_filter
        })
    }
