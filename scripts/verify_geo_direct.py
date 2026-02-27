
import sqlite3
import sys
import os

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.project_service import project_service
from utils.geo_service import geo_service
from database import get_db

def verify_directly():
    print("Verifying Geographical Stats Logic...")
    data = project_service.get_geo_stats()
    
    members = data.get('members', [])
    print(f"Total members found: {len(members)}")
    
    success_count = 0
    for m in members:
        lng = m.get('lng')
        lat = m.get('lat')
        city = m.get('current_city')
        name = m.get('name')
        
        coords_str = f"[{lng}, {lat}]" if lng is not None else "MISSING"
        print(f"Processing: {name} (City: {city}) -> Coords: {coords_str}")
        
        if lng is not None and lat is not None:
            success_count += 1
        else:
            print(f"  DEBUG: Why is it missing? Resolving manually to check: {geo_service.resolve_coords(city)}")
            
    print(f"\nVerification Results: {success_count}/{len(members)} members have coordinates.")
    
    if success_count == len(members) and len(members) > 0:
        print("PASS: All active members have valid coordinates.")
    elif len(members) == 0:
        print("WARNING: No active members found. Check database.")
    else:
        print("FAIL: Some members are missing coordinates.")

if __name__ == "__main__":
    verify_directly()
