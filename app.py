import os
import requests
import cv2
import numpy as np
import boto3
import time
import uuid
from pystac_client import Client

def handler(event, context):
    print("[*] Overwatch GEOINT Lambda Triggered.")
    
    # Target: Suez Canal
    lat, lon = 30.5852, 32.3503
    delta = 0.05
    bbox = [lon - delta, lat - delta, lon + delta, lat + delta]

    # 1. Fetch Data
    catalog = Client.open("https://planetarycomputer.microsoft.com/api/stac/v1")
    search = catalog.search(
        collections=["sentinel-2-l2a"],
        bbox=bbox,
        datetime="2024-01-01/2026-12-31",
        query={"eo:cloud_cover": {"lt": 5}}
    )
    
    items = list(search.items())
    if not items:
        return {"status": "error", "message": "No imagery found."}
    
    items.sort(key=lambda x: x.datetime, reverse=True)
    latest_item = items[0]
    visual_url = latest_item.assets["rendered_preview"].href
    
    img_path = "/tmp/target.jpg"
    response = requests.get(visual_url)
    with open(img_path, 'wb') as f:
        f.write(response.content)

    # 2. Analyze Imagery
    img = cv2.imread(img_path)
    pixel_values = np.float32(img.reshape((-1, 3)))
    
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 100, 0.2)
    _, labels, centers = cv2.kmeans(pixel_values, 2, None, criteria, 10, cv2.KMEANS_RANDOM_CENTERS)
    
    water_cluster = 0 if np.sum(centers[0]) < np.sum(centers[1]) else 1
    mask = (labels == water_cluster).astype(np.uint8).reshape(img.shape[:2]) * 255
    
    kernel = np.ones((5,5), np.uint8)
    mask = cv2.morphologyEx(cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel), cv2.MORPH_CLOSE, kernel)
    
    water_only = cv2.bitwise_and(img, img, mask=mask)
    gray_water = cv2.cvtColor(water_only, cv2.COLOR_BGR2GRAY)
    _, ship_mask = cv2.threshold(gray_water, 120, 255, cv2.THRESH_BINARY)
    
    eroded_water_mask = cv2.erode(mask, np.ones((7,7), np.uint8), iterations=1)
    ship_mask = cv2.bitwise_and(ship_mask, ship_mask, mask=eroded_water_mask)
    
    contours, _ = cv2.findContours(ship_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    ship_count = sum(1 for c in contours if 5 < cv2.contourArea(c) < 5000)
    print(f"[+] Detected {ship_count} vessels.")

    # 3. Publish Intelligence to DynamoDB
    try:
        dynamodb = boto3.resource('dynamodb', region_name='us-east-1')
        table = dynamodb.Table('cloud-resume-threats') # Using your existing table
        table.put_item(
            Item={
                'id': str(uuid.uuid4()),
                'timestamp': int(time.time()),
                'ip': 'SATELLITE-INTEL',
                'user_agent': 'OVERWATCH-GEOINT-PIPELINE',
                'payload': f"SUEZ CANAL MONITOR: {ship_count} CARGO VESSELS DETECTED."
            }
        )
        print("[+] Intelligence pushed to Sentinel Database.")
    except Exception as e:
        print(f"[-] Failed to push to DB: {e}")

    import json
    return {"statusCode": 200, "body": json.dumps({"status": "success", "vessels_detected": ship_count})}
