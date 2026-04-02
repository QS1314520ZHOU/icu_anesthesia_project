import os
from datetime import datetime
from database import DatabasePool
from app_config import DB_CONFIG

db_type = DB_CONFIG.get('TYPE', 'sqlite')

def sync_personnel_to_map():
    if not os.path.exists(DATABASE):
        print(f"Error: {DATABASE} not found.")
        return

    try:
        print("--- Starting Personnel Synchronization ---")

        with DatabasePool.get_connection() as conn:
            cursor = conn.cursor()
            
            # 1. Get all project-user assignments
            assignment_sql = DatabasePool.format_sql('''
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
                WHERE u.is_active = ?
            ''')
            assignments = cursor.execute(assignment_sql, (True,)).fetchall()

            print(f"Found {len(assignments)} assignments to sync.")

            sync_count = 0
            for ass in assignments:
                # Determine current_city for the map
                loc = ass['city'] if ass['city'] else ass['hospital_name']
                
                # Check if this member record already exists
                role_label = '项目经理' if ass['role'] in ['admin', 'project_manager'] else '实施工程师'
                
                if db_type == 'postgres':
                    sql = '''
                        INSERT INTO project_members 
                        (project_id, name, role, email, status, current_city, is_onsite, join_date)
                        VALUES (%s, %s, %s, %s, '在岗', %s, %s, %s)
                        ON CONFLICT (project_id, name) DO UPDATE SET
                            role = EXCLUDED.role,
                            email = EXCLUDED.email,
                            status = '在岗',
                            current_city = EXCLUDED.current_city,
                            is_onsite = %s,
                            join_date = EXCLUDED.join_date
                    '''
                    cursor.execute(sql, (ass['project_id'], ass['name'], role_label, ass['email'], loc, True, datetime.now().strftime('%Y-%m-%d'), True))
                else:
                    # SQLite fallback with existing logic
                    existing = cursor.execute('''
                        SELECT id FROM project_members 
                        WHERE project_id = ? AND name = ?
                    ''', (ass['project_id'], ass['name'])).fetchone()

                    if existing:
                        cursor.execute('''
                            UPDATE project_members 
                            SET status = '在岗', current_city = ?, is_onsite = ?
                            WHERE id = ?
                        ''', (loc, True, existing['id']))
                    else:
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
            count_sql = DatabasePool.format_sql('SELECT COUNT(*) FROM project_members WHERE status = ?')
            count = cursor.execute(count_sql, ('在岗',)).fetchone()[0]
            print(f"Total active members in database: {count}")

    except Exception as e:
        print(f"Error during sync: {e}")

if __name__ == "__main__":
    sync_personnel_to_map()
