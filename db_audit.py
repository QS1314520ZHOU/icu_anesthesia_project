
import sqlite3

def audit():
    conn = sqlite3.connect('database.db')
    cursor = conn.cursor()
    
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [r[0] for r in cursor.fetchall()]
    print(f"Tables found: {tables}")
    
    relevant_keywords = ['interface', 'item', 'map', 'spec', 'field', 'standard', 'comparison']
    
    for table in tables:
        if any(keyword in table.lower() for keyword in relevant_keywords):
            print(f"\n--- Schema for table: {table} ---")
            cursor.execute(f"PRAGMA table_info({table})")
            columns = cursor.fetchall()
            for col in columns:
                print(f"Column: {col[1]} ({col[2]})")
            
            # Count rows
            cursor.execute(f"SELECT COUNT(*) FROM {table}")
            count = cursor.fetchone()[0]
            print(f"Total Rows: {count}")
    
    conn.close()

if __name__ == "__main__":
    audit()
