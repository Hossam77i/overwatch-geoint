import os, requests, cv2, numpy as np, boto3, time, uuid, json
from pystac_client import Client

def handler(event, context):
    print("[*] Overwatch GEOINT Pipeline Triggered.")
    
    # 1. Parse Input
    try:
        body = json.loads(event.get('body', '{}'))
        lat = float(body.get('lat', 30.5852))
        lon = float(body.get('lon', 32.3503))
        scan_filter = body.get('filter', 'maritime')
    except:
        lat, lon, scan_filter = 30.5852, 32.3503, 'maritime'

    delta = 0.05
    bbox = [lon - delta, lat - delta, lon + delta, lat + delta]

    # 2. Fetch STAC Data
    catalog = Client.open("https://planetarycomputer.microsoft.com/api/stac/v1")
    search = catalog.search(collections=["sentinel-2-l2a"], bbox=bbox, datetime="2024-01-01/2026-12-31", query={"eo:cloud_cover": {"lt": 80}})
    items = list(search.items())
    
    if not items:
        return {"statusCode": 404, "headers": {"Access-Control-Allow-Origin": "*"}, "body": json.dumps({"error": "No clear satellite imagery found for this exact location."})}
    
    items.sort(key=lambda x: x.datetime, reverse=True)
    latest = items[0]
    
    # Get exact geographic bounds of the image for Leaflet mapping
    actual_bbox = latest.bbox # [west, south, east, north]
    
    if "rendered_preview" not in latest.assets:
        return {"statusCode": 404, "headers": {"Access-Control-Allow-Origin": "*"}, "body": json.dumps({"error": "No visual asset available."})}
        
    visual_url = latest.assets["rendered_preview"].href
    
    img_path = "/tmp/target.jpg"
    response = requests.get(visual_url)
    with open(img_path, 'wb') as f: f.write(response.content)

    # 3. Computer Vision ML
    img = cv2.imread(img_path)
    output_img = img.copy()
    detect_count = 0
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    if scan_filter == 'maritime':
        pixel_values = np.float32(img.reshape((-1, 3)))
        _, labels, centers = cv2.kmeans(pixel_values, 2, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 100, 0.2), 10, cv2.KMEANS_RANDOM_CENTERS)
        water_cluster = 0 if np.sum(centers[0]) < np.sum(centers[1]) else 1
        mask = (labels == water_cluster).astype(np.uint8).reshape(img.shape[:2]) * 255
        mask = cv2.morphologyEx(cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5,5), np.uint8)), cv2.MORPH_CLOSE, np.ones((5,5), np.uint8))
        water_only = cv2.bitwise_and(img, img, mask=mask)
        _, ship_mask = cv2.threshold(cv2.cvtColor(water_only, cv2.COLOR_BGR2GRAY), 120, 255, cv2.THRESH_BINARY)
        ship_mask = cv2.bitwise_and(ship_mask, ship_mask, mask=cv2.erode(mask, np.ones((7,7), np.uint8), iterations=1))
        contours, _ = cv2.findContours(ship_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in contours:
            if 5 < cv2.contourArea(c) < 5000:
                x, y, w, h = cv2.boundingRect(c)
                cv2.rectangle(output_img, (x, y), (x+w, y+h), (0, 0, 255), 2)
                cv2.putText(output_img, "VESSEL", (x, y-5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 255), 1)
                detect_count += 1

    elif scan_filter == 'energy':
        blurred = cv2.GaussianBlur(gray, (9, 9), 2)
        circles = cv2.HoughCircles(blurred, cv2.HOUGH_GRADIENT, 1, 20, param1=50, param2=30, minRadius=2, maxRadius=20)
        if circles is not None:
            circles = np.uint16(np.around(circles))
            for i in circles[0, :]:
                cv2.circle(output_img, (i[0], i[1]), i[2], (0, 255, 0), 2)
                cv2.putText(output_img, "TANK", (i[0]-10, i[1]-10), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 0), 1)
                detect_count += 1

    elif scan_filter == 'aviation':
        edges = cv2.Canny(gray, 50, 150, apertureSize=3)
        lines = cv2.HoughLinesP(edges, 1, np.pi/180, 100, minLineLength=100, maxLineGap=10)
        if lines is not None:
            for line in lines:
                x1, y1, x2, y2 = line[0]
                cv2.line(output_img, (x1, y1), (x2, y2), (255, 0, 0), 2)
                cv2.putText(output_img, "RUNWAY", (x1, y1-5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 0, 0), 1)
                detect_count += 1

    # 4. Upload & DB
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
            "bbox": actual_bbox,
            "filter": scan_filter
        })
    }
