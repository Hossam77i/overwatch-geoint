import urllib.request, json

TRIGGER_URL = "https://yyp1jlzcjf.execute-api.us-east-1.amazonaws.com/trigger-overwatch"

def post(payload):
    req = urllib.request.Request(TRIGGER_URL, data=json.dumps(payload).encode('utf-8'), headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return res.getcode(), json.loads(res.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:
        return 0, str(e)

print("1. Testing Radar with missing params:")
print(post({"filter": "radar"}))

print("2. Testing Radar with huge bounds:")
print(post({"filter": "radar", "lat": 0, "lon": 0, "width_deg": 1000, "height_deg": 1000}))

print("3. Testing Micro Scan (Maritime) with missing coords:")
print(post({"filter": "maritime"}))

print("4. Testing Micro Scan (Aviation) over Ocean (no airfield):")
print(post({"filter": "aviation", "lat": 0.0, "lon": 0.0, "width_deg": 0.05, "height_deg": 0.05}))

print("5. Testing Infra Cache for unknown country:")
print(post({"action": "get_infra", "country": "ATLANTIS"}))

print("6. Testing Threats API:")
print(post({"action": "get_threats"}))

