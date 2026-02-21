
import sqlite3

def search():
    conn = sqlite3.connect('database.db')
    cursor = conn.cursor()
    
    query = """
    SELECT id, vendor_name, category, interface_name, raw_text 
    FROM interface_specs 
    WHERE raw_text LIKE ? OR raw_text LIKE ? 
       OR interface_name LIKE ? OR vendor_name LIKE ?
    """
    params = ('%中联%', '%复合%', '%中联%', '%中联%')
    
    cursor.execute(query, params)
    rows = cursor.fetchall()
    
    if not rows:
        print("No matches found in interface_specs.")
    else:
        for row in rows:
            print(f"ID: {row[0]}")
            print(f"Vendor: {row[1]}")
            print(f"Category: {row[2]}")
            print(f"Interface: {row[3]}")
            print(f"Raw Text snippet: {row[4][:200] if row[4] else 'None'}")
            print("-" * 20)
    
    conn.close()

if __name__ == "__main__":
    search()
