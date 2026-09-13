import json

def test_parse():
    ac = {"gs": "100", "alt_baro": None, "hex": None, "r": None}
    
    gs_val = ac.get('gs')
    vel_ms = float(gs_val) * 0.514444 if gs_val is not None else 0
    print(vel_ms)

test_parse()
