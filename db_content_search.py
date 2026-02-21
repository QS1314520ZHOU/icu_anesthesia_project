
import sqlite3

def search():
    conn = sqlite3.connect('database.db')
    cursor = conn.cursor()
    
    # Search for specific fragments seen in the screenshot
    patterns = ['%最近的手术时间%', '%diagnoseTCM%', '%中西医%']
    
    for pattern in patterns:
        print(f"Searching for pattern: {pattern}")
        query = "SELECT id, vendor_name, category, interface_name, raw_text FROM interface_specs WHERE raw_text LIKE ?"
        cursor.execute(query, (pattern,))
        rows = cursor.fetchall()
        
        if rows:
            for row in rows:
                print(f"Found Match - ID: {row[0]}, Vendor: {row[1]}, Category: {row[2]}, Interface: {row[3]}")
                print(f"Text Snippet: {row[4][:300]}...")
                print("-" * 30)
        else:
            print("No matches for this pattern.")
    
    conn.close()

if __name__ == "__main__":
    search()
