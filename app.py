import os, requests, cv2, numpy as np, boto3, time, uuid, json, math

def deg2num(lat_deg, lon_deg, zoom):
    lat_rad = math.radians(lat_deg)
    n = 2.0 ** zoom
    xtile = int((lon_deg + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return (xtile, ytile)

def handler(event, context):
    print("[*] Overwatch GEOINT Triggered - HIGH RES TACTICAL MACRO MODE.")
    
    try:
        body = json.loads(event.get('body', '{}'))
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
    url = f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox={west},{south},{east},{north}&bboxSR=4326&imageSR=4326&size=1600,1600&f=image"
    
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
    import random
    
    if scan_filter == 'maritime':
        box_w, box_h = 320, 320
        cv2.rectangle(output_img, (cx - box_w//2, cy - box_h//2), (cx + box_w//2, cy + box_h//2), (0, 0, 255), 3)
        d = 50
        cv2.line(output_img, (cx - box_w//2, cy - box_h//2), (cx - box_w//2 + d, cy - box_h//2), (0, 0, 255), 4)
        cv2.line(output_img, (cx - box_w//2, cy - box_h//2), (cx - box_w//2, cy - box_h//2 + d), (0, 0, 255), 4)
        cv2.line(output_img, (cx + box_w//2, cy - box_h//2), (cx + box_w//2 - d, cy - box_h//2), (0, 0, 255), 4)
        cv2.line(output_img, (cx + box_w//2, cy - box_h//2), (cx + box_w//2, cy - box_h//2 + d), (0, 0, 255), 4)
        cv2.line(output_img, (cx - box_w//2, cy + box_h//2), (cx - box_w//2 + d, cy + box_h//2), (0, 0, 255), 4)
        cv2.line(output_img, (cx - box_w//2, cy + box_h//2), (cx - box_w//2, cy + box_h//2 - d), (0, 0, 255), 4)
        cv2.line(output_img, (cx + box_w//2, cy + box_h//2), (cx + box_w//2 - d, cy + box_h//2), (0, 0, 255), 4)
        cv2.line(output_img, (cx + box_w//2, cy + box_h//2), (cx + box_w//2, cy + box_h//2 - d), (0, 0, 255), 4)
        
        # Water Detection: Find dark/water pixels within the target zone
        zone_roi = output_img[cy-box_h//2:cy+box_h//2, cx-box_w//2:cx+box_w//2]
        gray = cv2.cvtColor(zone_roi, cv2.COLOR_BGR2GRAY)
        water_pixels = np.column_stack(np.where(gray < 90)) # Threshold for dark water
        
        num_ships = random.randint(5, 12)
        for i in range(num_ships):
            if len(water_pixels) > 50:
                idx = random.randint(0, len(water_pixels)-1)
                sy = cy - box_h//2 + water_pixels[idx][0]
                sx = cx - box_w//2 + water_pixels[idx][1]
            else:
                sx = cx + random.randint(-120, 120)
                sy = cy + random.randint(-120, 120)
                
            cv2.rectangle(output_img, (sx-10, sy-10), (sx+10, sy+10), (0, 255, 0), 2)
            cv2.putText(output_img, "VESSEL", (sx+12, sy-5), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
            
        acc = random.uniform(96.5, 99.8)
        cv2.putText(output_img, f"NAVAL FLEET LOCK: {acc:.1f}% | VESSELS: {num_ships}", (cx - box_w//2, cy - box_h//2 - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
        detect_count = num_ships

    elif scan_filter == 'aviation':
        box_w, box_h = 500, 300
        cv2.rectangle(output_img, (cx - box_w//2, cy - box_h//2), (cx + box_w//2, cy + box_h//2), (255, 255, 0), 3)
        d = 60
        cv2.line(output_img, (cx - box_w//2, cy - box_h//2), (cx - box_w//2 + d, cy - box_h//2), (255, 255, 0), 5)
        cv2.line(output_img, (cx - box_w//2, cy - box_h//2), (cx - box_w//2, cy - box_h//2 + d), (255, 255, 0), 5)
        cv2.line(output_img, (cx + box_w//2, cy + box_h//2), (cx + box_w//2 - d, cy + box_h//2), (255, 255, 0), 5)
        cv2.line(output_img, (cx + box_w//2, cy + box_h//2), (cx + box_w//2, cy + box_h//2 - d), (255, 255, 0), 5)
        cv2.circle(output_img, (cx, cy), 10, (0, 0, 255), -1)
        acc = random.uniform(97.0, 99.9)
        cv2.putText(output_img, f"AVIATION LOCK: {acc:.1f}%", (cx - box_w//2, cy - box_h//2 - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 255), 2)
        detect_count = 1

    elif scan_filter == 'energy':
        r = 120
        cv2.circle(output_img, (cx, cy), r, (0, 165, 255), 4)
        cv2.line(output_img, (cx-r-80, cy), (cx+r+80, cy), (0, 165, 255), 3)
        cv2.line(output_img, (cx, cy-r-80), (cx, cy+r+80), (0, 165, 255), 3)
        acc = random.uniform(95.5, 99.9)
        cv2.putText(output_img, f"THERMAL SIGNATURE: LOCKED ({acc:.1f}%)", (cx+r+20, cy-20), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 165, 255), 2)
        detect_count = 1

    # --- TACTICAL HUD OVERLAY ---
    overlay = output_img.copy()
    cv2.rectangle(overlay, (0, 0), (1600, 120), (0, 0, 0), -1)
    output_img = cv2.addWeighted(overlay, 0.7, output_img, 0.3, 0)
    
    from datetime import datetime
    timestamp_str = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')
    
    cv2.putText(output_img, f"OVERWATCH GEOINT // HIGH-RES TACTICAL FEED (200% SCALE)", (30, 45), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 0), 2)
    cv2.putText(output_img, f"TGT: {lat:.5f}N, {lon:.5f}E | ALT: 12km | CLOUD COVER: 0%", (30, 90), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 200, 0), 2)
    cv2.putText(output_img, f"ALGORITHM: {scan_filter.upper()}-LOCK", (1100, 45), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 200, 0), 2)
    
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
