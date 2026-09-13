import urllib.request
def test():
    try:
        url = "https://api.adsb.lol/v2/lat/23.3057/lon/26.5442/dist/150"
        req = urllib.request.Request(url, headers={'User-Agent': 'Overwatch-GeoINT-Serverless'})
        res = urllib.request.urlopen(req)
        print("Success")
    except Exception as e:
        print(f"Error: {e}")
test()
