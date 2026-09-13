import cv2, numpy as np
def _military_detect(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    # Detect high-frequency structural edges (vehicles, tents, equipment)
    edges = cv2.Canny(blur, 100, 200)
    # Dilate to connect nearby edges of a single vehicle
    dilated = cv2.dilate(edges, np.ones((3,3), np.uint8), iterations=1)
    
    cnts, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    vehicles = []
    for c in cnts:
        area = cv2.contourArea(c)
        if 20 < area < 400: # Approximate size of a vehicle from satellite
            x, y, w, h = cv2.boundingRect(c)
            # Check aspect ratio for vehicle-like shapes
            aspect = max(w, h) / float(min(w, h))
            if 1.0 <= aspect <= 3.5:
                vehicles.append((x, y, w, h))
    
    # Sort and pick top clusters to simulate high-confidence targets
    vehicles.sort(key=lambda b: b[2]*b[3], reverse=True)
    return min(len(vehicles), 45), vehicles[:45]
