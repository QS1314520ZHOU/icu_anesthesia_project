
import sqlite3

def search_mappings():
    conn = sqlite3.connect('database.db')
    cursor = conn.cursor()
    
    keywords = ['%一对多%', '%复合%', '%组合%', '%拆分%', '%Zhonglian%', '%中联%']
    
    print("--- Searching interface_comparison_details ---")
    for kw in keywords:
        query = "SELECT id, our_field_name, vendor_field_name, transform_rule, remark FROM interface_comparison_details WHERE transform_rule LIKE ? OR remark LIKE ?"
        cursor.execute(query, (kw, kw))
        rows = cursor.fetchall()
        if rows:
            print(f"Keyword: {kw} - Matches: {len(rows)}")
            for r in rows:
                print(f"ID: {r[0]}, Field: {r[1]} -> {r[2]}, Rule: {r[3]}, Remark: {r[4]}")
    
    print("\n--- Searching interface_items ---")
    # Check if interface_items exists and what its columns are
    cursor.execute("PRAGMA table_info(interface_items)")
    cols = [c[1] for c in cursor.fetchall()]
    if cols:
        print(f"Columns in interface_items: {cols}")
        for kw in keywords:
            # Try searching in common field names
            search_cols = [c for c in cols if 'name' in c or 'desc' in c or 'rule' in c or 'comment' in c or 'type' in c]
            if not search_cols: search_cols = cols
            
            where_clause = " OR ".join([f"{col} LIKE ?" for col in search_cols])
            query = f"SELECT id, spec_id, field_name FROM interface_items WHERE {where_clause}"
            cursor.execute(query, [kw] * len(search_cols))
            rows = cursor.fetchall()
            if rows:
                print(f"Keyword: {kw} - Matches: {len(rows)}")
                for r in rows:
                    print(f"ID: {r[0]}, SpecID: {r[1]}, FieldName: {r[2]}")
    else:
        print("Table interface_items has no columns or doesn't exist.")

    conn.close()

if __name__ == "__main__":
    search_mappings()
