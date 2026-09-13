import requests
lat = 30.5852
lon = 32.3503
res = requests.get(f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,cloud_cover,wind_speed_10m", timeout=5).json()
print(res)
