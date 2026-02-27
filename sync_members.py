
import sqlite3
import os
from datetime import datetime

DATABASE = 'database.db'

def sync_personnel_to_map():
    if not os.path.exists(DATABASE):
        print(f"Error: {DATABASE} not found.")
        return

    try:
        conn = sqlite3.connect(DATABASE)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        print("--- Starting Personnel Synchronization ---")

        # 1. Get all project-user assignments
        # We join with users to get display_name and email
        # We join with projects to get city/hospital as fallback location
        assignments = cursor.execute('''
            SELECT 
                pua.project_id, 
                u.display_name as name, 
                u.role, 
                u.email,
                p.city,
                p.hospital_name,
                p.project_name
            FROM project_user_access pua
            JOIN users u ON pua.user_id = u.id
            JOIN projects p ON pua.project_id = p.id
            WHERE u.is_active = 1
        ''').fetchall()

        print(f"Found {len(assignments)} assignments to sync.")

        sync_count = 0
        for ass in assignments:
            # Determine current_city for the map
            # Fallback priority: Project City -> Hospital Name
            loc = ass['city'] if ass['city'] else ass['hospital_name']
            
            # Check if this member record already exists in project_members for this project
            existing = cursor.execute('''
                SELECT id FROM project_members 
                WHERE project_id = ? AND name = ?
            ''', (ass['project_id'], ass['name'])).fetchone()

            if existing:
                # Update status and location
                cursor.execute('''
                    UPDATE project_members 
                    SET status = '在岗', current_city = ?, is_onsite = 1
                    WHERE id = ?
                ''', (loc, existing['id']))
            else:
                # Insert new record
                # Role mapping: 'admin'/'project_manager' -> '项目经理', others -> '实施工程师'
                role_label = '项目经理' if ass['role'] in ['admin', 'project_manager'] else '实施工程师'
                
                cursor.execute('''
                    INSERT INTO project_members 
                    (project_id, name, role, email, status, current_city, is_onsite, join_date)
                    VALUES (?, ?, ?, ?, '在岗', ?, 1, ?)
                ''', (
                    ass['project_id'], 
                    ass['name'], 
                    role_label, 
                    ass['email'], 
                    loc, 
                    datetime.now().strftime('%Y-%m-%d')
                ))
            sync_count += 1
            print(f"Synced: {ass['name']} @ {ass['project_name']} ({loc})")

        conn.commit()
        print(f"--- Synchronization Complete: {sync_count} records processed ---")
        
        # Verify result count
        count = cursor.execute('SELECT COUNT(*) FROM project_members WHERE status = "在岗"').fetchone()[0]
        print(f"Total active members in database: {count}")

        conn.close()
    except Exception as e:
        print(f"Error during sync: {e}")

if __name__ == "__main__":
    sync_personnel_to_map()
