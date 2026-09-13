import os
import boto3
import requests
import json

ssm = boto3.client('ssm', region_name='us-east-1')

def get_secret(name):
    try:
        response = ssm.get_parameter(Name=name, WithDecryption=True)
        return response['Parameter']['Value']
    except Exception as e:
        print(f"Error fetching {name}: {e}")
        return None

def enrich_ip_shodan(ip):
    shodan_key = get_secret('/osint/shodan_key')
    if not shodan_key: return None
    print(f"[*] Querying Shodan for {ip}...")
    res = requests.get(f"https://api.shodan.io/shodan/host/{ip}?key={shodan_key}")
    if res.status_code == 200:
        data = res.json()
        return {
            "org": data.get("org", "Unknown"),
            "os": data.get("os", "Unknown"),
            "ports": data.get("ports", [])
        }
    return None

def enrich_ip_censys(ip):
    censys_key = get_secret('/osint/censys_key')
    if not censys_key: return None
    # Censys API typically requires ID and Secret, but assuming single key for demo
    print(f"[*] Querying Censys for {ip}...")
    headers = {"Authorization": f"Bearer {censys_key}"}
    res = requests.get(f"https://search.censys.io/api/v2/hosts/{ip}", headers=headers)
    if res.status_code == 200:
        data = res.json().get("result", {})
        return {
            "services": len(data.get("services", [])),
            "location": data.get("location", {}).get("country", "Unknown")
        }
    return None

if __name__ == "__main__":
    test_ip = "8.8.8.8"
    print(f"--- OSINT Enrichment Report for {test_ip} ---")
    print("Shodan:", json.dumps(enrich_ip_shodan(test_ip), indent=2))
    print("Censys:", json.dumps(enrich_ip_censys(test_ip), indent=2))
