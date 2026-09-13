import cv2
import numpy as np
import os
import base64
import requests
import json
import boto3
from concurrent.futures import ThreadPoolExecutor

def get_gemini_key():
    try:
        ssm = boto3.client('ssm', region_name='us-east-1')
        param = ssm.get_parameter(Name='/resume/gemini_key', WithDecryption=True)
        return param['Parameter']['Value']
    except Exception as e:
        print(f"[-] Could not retrieve Gemini key: {e}")
        return None

def verify_ship_with_gemini(crop_img, api_key):
    if api_key is None:
        return "VESSEL"
    
    # Encode crop to base64
    _, buffer = cv2.imencode('.jpg', crop_img)
    img_b64 = base64.b64encode(buffer).decode('utf-8')
    
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"
    payload = {
        "contents": [{
            "parts": [
                {"text": "Analyze this satellite crop. Is this a ship/vessel? If yes, answer 'YES' followed by a short classification (e.g., 'YES - CARGO' or 'YES - NAVAL'). If it is a cloud, land, wake, or artifact, answer 'NO'."},
                {"inline_data": {"mime_type": "image/jpeg", "data": img_b64}}
            ]
        }],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 10}
    }
    
    try:
        res = requests.post(url, headers={'Content-Type': 'application/json'}, json=payload, timeout=8)
        data = res.json()
        reply = data['candidates'][0]['content']['parts'][0]['text'].strip().upper()
        return reply
    except Exception as e:
        return "VESSEL"

def process_contour(contour, img, api_key):
    area = cv2.contourArea(contour)
    if 5 < area < 5000:
        x, y, w, h = cv2.boundingRect(contour)
        
        # Add padding to crop for better AI context
        pad = 15
        y1, y2 = max(0, y-pad), min(img.shape[0], y+h+pad)
        x1, x2 = max(0, x-pad), min(img.shape[1], x+w+pad)
        crop = img[y1:y2, x1:x2]
        
        ai_verdict = verify_ship_with_gemini(crop, api_key)
        if ai_verdict.startswith("YES"):
            label = ai_verdict.replace("YES", "").strip(" -")
            if not label: label = "VESSEL"
            return {"valid": True, "box": (x, y, w, h), "label": label}
        elif ai_verdict == "VESSEL": # fallback
            return {"valid": True, "box": (x, y, w, h), "label": "VESSEL"}
            
    return {"valid": False}

def analyze_waterway(image_path, output_path):
    print(f"[*] Loading satellite imagery: {image_path}")
    img = cv2.imread(image_path)
    if img is None:
        print("[-] Could not read image.")
        return

    # Use OpenCV's built-in KMeans to segment the image into 2 clusters: Land vs Water.
    pixel_values = img.reshape((-1, 3))
    pixel_values = np.float32(pixel_values)

    print("[*] Performing K-Means clustering for terrain segmentation (K=2)...")
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 100, 0.2)
    k = 2
    _, labels, (centers) = cv2.kmeans(pixel_values, k, None, criteria, 10, cv2.KMEANS_RANDOM_CENTERS)
    
    intensity_0 = np.sum(centers[0])
    intensity_1 = np.sum(centers[1])
    water_cluster = 0 if intensity_0 < intensity_1 else 1

    mask = (labels == water_cluster).astype(np.uint8).reshape(img.shape[:2]) * 255

    kernel = np.ones((5,5), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

    print("[*] Segmented waterway from desert terrain.")

    water_only = cv2.bitwise_and(img, img, mask=mask)
    gray_water = cv2.cvtColor(water_only, cv2.COLOR_BGR2GRAY)
    
    # Dynamic Thresholding (Otsu) on Water Pixels Only
    print("[*] Calculating Dynamic Threshold (Otsu's Method)...")
    water_pixels = gray_water[mask > 0]
    if len(water_pixels) > 0:
        otsu_val, _ = cv2.threshold(water_pixels, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    else:
        otsu_val = 120
    
    print(f"[*] Dynamic threshold calculated as: {otsu_val}")
    print("[*] Scanning waterway for maritime vessels (anomalies)...")
    _, ship_mask = cv2.threshold(gray_water, otsu_val, 255, cv2.THRESH_BINARY)
    
    eroded_water_mask = cv2.erode(mask, np.ones((7,7), np.uint8), iterations=1)
    ship_mask = cv2.bitwise_and(ship_mask, ship_mask, mask=eroded_water_mask)

    contours, _ = cv2.findContours(ship_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    print(f"[*] Extracted {len(contours)} potential anomalies. Validating with Gemini Vision AI...")
    api_key = get_gemini_key()
    output_img = img.copy()
    ship_count = 0
    
    # Parallelize AI verification calls
    with ThreadPoolExecutor(max_workers=5) as executor:
        results = executor.map(lambda c: process_contour(c, img, api_key), contours)
        
    for res in results:
        if res["valid"]:
            x, y, w, h = res["box"]
            color = (0, 0, 255)
            if "CARGO" in res["label"]: color = (255, 200, 0)
            elif "NAVAL" in res["label"]: color = (0, 0, 255)
            else: color = (0, 255, 0)
            
            cv2.rectangle(output_img, (x, y), (x+w, y+h), color, 2)
            cv2.putText(output_img, res["label"], (x, y-5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)
            ship_count += 1

    print(f"[+] Analysis Complete. Confirmed {ship_count} maritime vessels.")
    
    cv2.imwrite(output_path, output_img)
    print(f"[+] Intelligence rendering saved to: {output_path}")

if __name__ == "__main__":
    analyze_waterway("suez_canal_latest.jpg", "suez_analysis_result.jpg")
