import boto3
import os
import time

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
DYNAMODB_INFRA_CACHE = os.environ.get("DYNAMODB_INFRA_CACHE", "overwatch-infra-cache")
DYNAMODB_THREATS = os.environ.get("DYNAMODB_THREATS", "cloud-resume-threats")

def get_threats(limit=20):
    table = boto3.resource("dynamodb", region_name=AWS_REGION).Table(DYNAMODB_THREATS)
    response = table.scan(Limit=limit)
    items = response.get("Items", [])
    items.sort(key=lambda x: int(x.get("timestamp", 0)), reverse=True)

    for item in items:
        for k, v in item.items():
            if hasattr(v, "quantize"):  # is decimal
                item[k] = int(v) if v % 1 == 0 else float(v)
    return items

def log_visitor(ip, ua):
    table = boto3.resource("dynamodb", region_name=AWS_REGION).Table(DYNAMODB_THREATS)
    table.put_item(
        Item={
            "id": f"VISITOR_{int(time.time())}_{ip}",
            "timestamp": int(time.time()),
            "ip": ip,
            "user_agent": ua,
            "payload": "PAGE_LOAD",
            "expires_at": int(time.time()) + 172800,
        }
    )

def log_scan_threat(scan_id, lat, lon, filter_type, detect_count):
    try:
        table = boto3.resource("dynamodb", region_name=AWS_REGION).Table(DYNAMODB_THREATS)
        table.put_item(
            Item={
                "id": scan_id,
                "timestamp": int(time.time()),
                "ip": "GLOBAL-INTEL",
                "user_agent": f"OVERWATCH-{filter_type.upper()}",
                "payload": f"{detect_count} ANOMALIES AT {lat}, {lon}",
            }
        )
    except Exception:
        pass

def get_infra_cache(country):
    table = boto3.resource("dynamodb", region_name=AWS_REGION).Table(DYNAMODB_INFRA_CACHE)
    return table.get_item(Key={"country": country}).get("Item")
