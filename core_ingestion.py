import os
import requests
from pystac_client import Client

def fetch_latest_satellite_image(lat, lon, output_file="target.jpg"):
    print(f"[*] Initializing Overwatch GEOINT Pipeline...")
    print(f"[*] Target Coordinates: Lat {lat}, Lon {lon}")

    # Microsoft Planetary Computer STAC API (Free, open access)
    catalog_url = "https://planetarycomputer.microsoft.com/api/stac/v1"
    try:
        catalog = Client.open(catalog_url)
    except Exception as e:
        print(f"[-] Failed to connect to STAC Catalog: {e}")
        return

    # Define a small bounding box around the coordinates (~10km)
    delta = 0.05
    bbox = [lon - delta, lat - delta, lon + delta, lat + delta]

    print("[*] Searching Sentinel-2 Satellite Constellation...")
    # Search for images with less than 5% cloud cover in the last few years
    search = catalog.search(
        collections=["sentinel-2-l2a"],
        bbox=bbox,
        datetime="2024-01-01/2026-12-31",
        query={"eo:cloud_cover": {"lt": 5}}
    )

    items = list(search.items())
    if not items:
        print("[-] No clear satellite imagery found in this window.")
        return

    # Sort items by date descending to get the most recent pass
    items.sort(key=lambda x: x.datetime, reverse=True)
    latest_item = items[0]
    date = latest_item.datetime.strftime("%Y-%m-%d %H:%M:%S")
    cloud_cover = latest_item.properties.get("eo:cloud_cover", "Unknown")
    
    print(f"[+] Found clear satellite pass from: {date}")
    print(f"[*] Cloud Cover: {cloud_cover}%")

    # Extract the rendered visual asset (Thumbnail/Preview)
    if "rendered_preview" in latest_item.assets:
        visual_url = latest_item.assets["rendered_preview"].href
    else:
        print("[-] Rendered preview not available for this item.")
        return

    print(f"[*] Downloading satellite telemetry...")
    response = requests.get(visual_url)
    if response.status_code == 200:
        with open(output_file, 'wb') as f:
            f.write(response.content)
        print(f"[+] Satellite image successfully saved to {output_file}")
        print(f"[*] Size: {os.path.getsize(output_file) / 1024:.2f} KB")
    else:
        print(f"[-] Failed to download image. HTTP {response.status_code}")

if __name__ == "__main__":
    # Target: The Suez Canal, Egypt
    SUEZ_LAT = 30.5852
    SUEZ_LON = 32.3503
    fetch_latest_satellite_image(SUEZ_LAT, SUEZ_LON, output_file="suez_canal_latest.jpg")
