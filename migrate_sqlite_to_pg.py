import sqlite3
import psycopg2
from psycopg2.extras import RealDictCursor
import json
import os
from datetime import datetime
from app_config import DB_CONFIG

# Configuration
SQLITE_DB = 'database.db'
PG_CONFIG = DB_CONFIG['POSTGRES']

def get_pg_conn():
    return psycopg2.connect(
        host=PG_CONFIG['HOST'],
        port=PG_CONFIG['PORT'],
        database=PG_CONFIG['NAME'],
        user=PG_CONFIG['USER'],
        password=PG_CONFIG['PASSWORD']
    )

def migrate():
    if not os.path.exists(SQLITE_DB):
        print(f"SQLite database not found at {SQLITE_DB}")
        return

    lite_conn = sqlite3.connect(SQLITE_DB)
    lite_conn.row_factory = sqlite3.Row
    lite_cur = lite_conn.cursor()

    pg_conn = get_pg_conn()
    pg_cur = pg_conn.cursor()

    # Get all tables
    lite_cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
    tables = [row['name'] for row in lite_cur.fetchall()]

    print(f"Found {len(tables)} tables to migrate: {', '.join(tables)}")

    for table in tables:
        print(f"Migrating table: {table}")
        
        # Get data from SQLite
        lite_cur.execute(f"SELECT * FROM {table}")
        rows = lite_cur.fetchall()
        
        if not rows:
            print(f"  Table {table} is empty. Skipping.")
            continue

        # Prepare PG insert
        columns = rows[0].keys()
        placeholders = ', '.join(['%s'] * len(columns))
        col_names = ', '.join(columns)
        
        # Truncate PG table first (be careful!)
        # pg_cur.execute(f"TRUNCATE TABLE {table} CASCADE")
        
        insert_query = f"INSERT INTO {table} ({col_names}) VALUES ({placeholders}) ON CONFLICT DO NOTHING"
        
        count = 0
        for row in rows:
            data = [row[col] for col in columns]
            
            # Special handling for boolean values (SQLite uses 0/1, PG uses True/False)
            # This is handled partially by psycopg2, but explicitly checking for known boolean columns helps.
            # However, for a generic script, we'll rely on psycopg2's default behavior or manual casting if needed.
            
            try:
                pg_cur.execute(insert_query, data)
                count += 1
            except Exception as e:
                print(f"  Error inserting row into {table}: {e}")
                pg_conn.rollback()
                # Try to continue?
        
        pg_conn.commit()
        print(f"  Successfully migrated {count}/{len(rows)} rows into {table}.")

        # Reset sequence for ID column if exists
        if 'id' in columns:
            try:
                pg_cur.execute(f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), (SELECT MAX(id) FROM {table}))")
                pg_conn.commit()
            except:
                pg_conn.rollback() # Likely no serial sequence

    lite_conn.close()
    pg_conn.close()
    print("Migration complete!")

if __name__ == '__main__':
    migrate()
