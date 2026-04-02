
import sqlite3

def run_audit():
    conn = sqlite3.connect('database.db')
    cursor = conn.cursor()
    
    # List all tables
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [r[0] for r in cursor.fetchall()]
    print(f"Total Tables: {len(tables)}")
    print(f"Tables: {tables}")
    
    for table in tables:
        print(f"\n--- Table: {table} ---")
        cursor.execute(f"PRAGMA table_info({table})")
        cols = cursor.fetchall()
        for col in cols:
            print(f"  Field: {col[1]} ({col[2]})")
        
        try:
            cursor.execute(f"SELECT COUNT(*) FROM {table}")
            count = cursor.fetchone()[0]
            print(f"  Rows: {count}")
        except Exception as e:
            print(f"  Error getting count: {e}")
            
    conn.close()

if __name__ == "__main__":
    run_audit()
