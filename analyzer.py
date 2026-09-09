import cv2
import numpy as np
import os

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
    
    # Identify which cluster is water. Water absorbs light, so it has a lower average intensity.
    intensity_0 = np.sum(centers[0])
    intensity_1 = np.sum(centers[1])
    water_cluster = 0 if intensity_0 < intensity_1 else 1

    # Create the water mask
    mask = (labels == water_cluster).astype(np.uint8).reshape(img.shape[:2]) * 255

    # Morphological operations to clean up the mask (remove noise)
    kernel = np.ones((5,5), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

    print("[*] Segmented waterway from desert terrain.")

    # Apply the mask to the original image to only look at water
    water_only = cv2.bitwise_and(img, img, mask=mask)

    # Convert water to grayscale to find bright spots (ships)
    gray_water = cv2.cvtColor(water_only, cv2.COLOR_BGR2GRAY)
    
    # Threshold for bright spots (ships) within the water mask
    print("[*] Scanning waterway for maritime vessels (anomalies)...")
    _, ship_mask = cv2.threshold(gray_water, 120, 255, cv2.THRESH_BINARY)
    
    # Erode the water mask slightly to avoid land edges being misidentified
    eroded_water_mask = cv2.erode(mask, np.ones((7,7), np.uint8), iterations=1)
    ship_mask = cv2.bitwise_and(ship_mask, ship_mask, mask=eroded_water_mask)

    # Find contours of the ships
    contours, _ = cv2.findContours(ship_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    ship_count = 0
    output_img = img.copy()
    for contour in contours:
        area = cv2.contourArea(contour)
        if 5 < area < 5000:  # Filter out noise or massive clouds
            x, y, w, h = cv2.boundingRect(contour)
            cv2.rectangle(output_img, (x, y), (x+w, y+h), (0, 0, 255), 2)
            cv2.putText(output_img, "VESSEL", (x, y-5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 255), 1)
            ship_count += 1

    print(f"[+] Analysis Complete. Detected {ship_count} potential maritime vessels.")
    
    cv2.imwrite(output_path, output_img)
    print(f"[+] Intelligence rendering saved to: {output_path}")

if __name__ == "__main__":
    analyze_waterway("suez_canal_latest.jpg", "suez_analysis_result.jpg")
