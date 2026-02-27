
import sqlite3
import os
from datetime import datetime

DATABASE = 'database.db'

# Simple mapping from county/hospital indicator to map-recognized city
CITY_MAPPING = {
    '丘北': '文山',
    '保康': '襄阳',
    '随州': '随州',
    '眉山': '眉山',
    '仁寿': '眉山',
    '成都': '成都',
    '昆明': '昆明',
    '大理': '大理',
    '红河': '红河',
    '文山': '文山'
}

def sync_all_projects_to_map():
    if not os.path.exists(DATABASE):
        print(f"Error: {DATABASE} not found.")
        return

    try:
        conn = sqlite3.connect(DATABASE)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        print("--- FORCED SYNC: Projects to Map ---")

        # Get all active projects
        projects = cursor.execute('SELECT id, project_name, project_manager, hospital_name, city FROM projects').fetchall()
        print(f"Syncing {len(projects)} projects...")

        sync_count = 0
        for p in projects:
            manager_name = p['project_manager']
            if not manager_name or manager_name == '待定':
                continue
            
            # Determine best city for mapping
            target_city = p['city']
            search_str = (p['hospital_name'] or '') + (p['project_name'] or '') + (p['city'] or '')
            
            # Try to map based on keywords
            for key, city in CITY_MAPPING.items():
                if key in search_str:
                    target_city = city
                    break
            
            if not target_city:
                target_city = '昆明' # Default for this project context if unknown
            
            print(f"Project: {p['project_name']} -> Manager: {manager_name} @ {target_city}")

            # Insert into project_members
            # We use INSERT OR REPLACE to update existing ones
            cursor.execute('''
                INSERT OR REPLACE INTO project_members 
                (project_id, name, role, status, current_city, is_onsite, join_date)
                VALUES (?, ?, '项目经理', '在岗', ?, 1, ?)
            ''', (
                p['id'], 
                manager_name, 
                target_city, 
                datetime.now().strftime('%Y-%m-%d')
            ))
            sync_count += 1

        conn.commit()
        print(f"Successfully synced {sync_count} personnel records.")
        
        # Verify
        actual = cursor.execute('SELECT COUNT(*) FROM project_members').fetchone()[0]
        print(f"Total records in project_members: {actual}")
        
        conn.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    sync_all_projects_to_map()
