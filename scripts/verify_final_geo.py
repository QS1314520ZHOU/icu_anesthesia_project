
import requests
import json

base_url = "http://localhost:5000/api"

def verify_geo_api():
    try:
        r = requests.get(f"{base_url}/projects/geo")
        if r.status_code == 200:
            data = r.json()
            if data.get('success'):
                members = data.get('data', {}).get('members', [])
                print(f"Success: Found {len(members)} members in geo stats.")
                for m in members:
                    print(f"- {m['name']}: {m['current_city']} -> [{m.get('lng')}, {m.get('lat')}]")
                    if m.get('lng') and m.get('lat'):
                        print("  Status: OK")
                    else:
                        print("  Status: Coordinates Missing!")
            else:
                print(f"Error: API returned failure - {data.get('message')}")
        else:
            print(f"Error: HTTP {r.status_code}")
    except Exception as e:
        print(f"Error connecting to API: {e}")

if __name__ == "__main__":
    verify_geo_api()
