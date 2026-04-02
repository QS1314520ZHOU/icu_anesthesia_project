import sqlite3
import os
import sys

# Add parent directory to path to import utils/services
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.geo_service import geo_service
from database import get_db

def fix_map_data():
    conn = get_db()
    cursor = conn.cursor()

    print("--- Fixing Projects (Provinces/Cities) ---")
    projects = cursor.execute('SELECT id, project_name, hospital_name, province, city FROM projects').fetchall()
    proj_updated = 0
    for p in projects:
        # Clean current fields
        curr_prov = (p['province'] or "").strip()
        curr_city = (p['city'] or "").strip()
        
        # If any hidden characters, update even if resolution not needed
        if curr_prov != p['province'] or curr_city != p['city']:
            cursor.execute('UPDATE projects SET province = ?, city = ? WHERE id = ?', (curr_prov, curr_city, p['id']))
            print(f"  [Cleaned] Project {p['id']}: {repr(p['hospital_name'])}")

        # Try resolution if missing or if previous resolution was likely wrong (checking for suspicious coordinates requires lat/lng in project table which we don't have yet in stats, but let's at least fix missing)
        if not curr_prov or not curr_city:
            target = (p['hospital_name'] or p['project_name'] or "").strip()
            if target:
                print(f"  Resolving {repr(target)}...")
                res = geo_service.resolve_address_details(target)
                if res:
                    cursor.execute('UPDATE projects SET province = ?, city = ? WHERE id = ?', 
                                 (res.get('province', '').replace('省',''), res.get('city', '').replace('市',''), p['id']))
                    proj_updated += 1
                    print(f"    -> OK: {res.get('province')}/{res.get('city')}")

    print("\n--- Fixing Members (Coordinates) ---")
    members = cursor.execute("SELECT id, name, current_city, lng, lat FROM project_members WHERE status = '在岗'").fetchall()
    mem_updated = 0
    for m in members:
        city = (m['current_city'] or "").strip()
        
        # Update if city was dirty
        if city != m['current_city']:
             cursor.execute('UPDATE project_members SET current_city = ? WHERE id = ?', (city, m['id']))
             print(f"  [Cleaned] Member {m['name']}: {repr(city)}")

        # Re-resolve if coordinates look suspect (e.g. Jilin) or missing
        # 123.x / 44.x is roughly Jilin. If it's a Hubei/other location, force re-resolve.
        is_suspect = False
        if m['lng'] and m['lat']:
            # Roughly Jilin/Songyuan area where previous wrong resolution landed
            if 120 < m['lng'] < 130 and 40 < m['lat'] < 50:
                 if '保康' in city or '丘北' in city or '北京' in city or '上海' in city:
                     is_suspect = True
        
        if m['lng'] is None or is_suspect:
            if city:
                print(f"  Resolving {repr(city)} for {m['name']} (Suspect: {is_suspect})...")
                coords = geo_service.resolve_coords(city)
                if coords:
                    cursor.execute('UPDATE project_members SET lng = ?, lat = ?, current_city = ? WHERE id = ?', 
                                 (coords[0], coords[1], city, m['id']))
                    mem_updated += 1
                    print(f"    -> OK: {coords}")
                else:
                    print(f"    -> FAILED to resolve {repr(city)}")

    conn.commit()
    print(f"\nSummary: Updated {proj_updated} projects and {mem_updated} members.")

if __name__ == "__main__":
    fix_map_data()
