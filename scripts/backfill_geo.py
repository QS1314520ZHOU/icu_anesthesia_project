
import sqlite3
import sys
import os

# Add parent directory to path to import utils
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.geo_service import geo_service
from database import get_db

def backfill():
    conn = get_db()
    cursor = conn.cursor()
    
    # Get members with missing coordinates
    members = cursor.execute('SELECT id, name, current_city FROM project_members WHERE lng IS NULL OR lat IS NULL').fetchall()
    print(f"Found {len(members)} members without coordinates.")
    
    updated_count = 0
    for m in members:
        loc = m['current_city']
        if not loc:
            continue
            
        print(f"Resolving {loc} for {m['name']}...")
        coords = geo_service.resolve_coords(loc)
        
        if coords:
            cursor.execute('UPDATE project_members SET lng = ?, lat = ? WHERE id = ?', (coords[0], coords[1], m['id']))
            updated_count += 1
            print(f"  -> OK: {coords}")
        else:
            print(f"  -> Failed to resolve {loc}")
            
    conn.commit()
    print(f"Successfully updated {updated_count} records.")

if __name__ == "__main__":
    backfill()
