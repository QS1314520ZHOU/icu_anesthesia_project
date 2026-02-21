
import sqlite3
import json

def audit_data():
    conn = sqlite3.connect('database.db')
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # 1. Projects
    print("--- PROJECTS ---")
    projects = cursor.execute('SELECT id, project_name, hospital_name FROM projects').fetchall()
    for p in projects:
        print(f"ID: {p['id']}, Name: {p['project_name']}, Hospital: {p['hospital_name']}")
    
    # 2. Spec Versions
    print("\n--- INTERFACE SPEC VERSIONS ---")
    specs = cursor.execute('SELECT DISTINCT spec_version FROM interface_specs').fetchall()
    for s in specs:
        print(f"Version: {s['spec_version']}")
        
    # 3. Alignment Sessions
    print("\n--- ALIGNMENT SESSIONS ---")
    sessions = cursor.execute('''
        SELECT s.id, s.project_id, p.project_name, p.hospital_name, s.spec_version, s.created_at 
        FROM alignment_sessions s 
        LEFT JOIN projects p ON s.project_id = p.id
        ORDER BY s.created_at DESC
    ''').fetchall()
    for s in sessions:
        print(f"Session ID: {s['id']}, Project: {s['project_name']} ({s['hospital_name']}), Spec Version: {s['spec_version']}, Created: {s['created_at']}")
    
    conn.close()

if __name__ == "__main__":
    audit_data()
