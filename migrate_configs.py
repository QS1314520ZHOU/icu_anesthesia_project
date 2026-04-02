import sqlite3
import psycopg2
from psycopg2.extras import RealDictCursor
import os
from dotenv import load_dotenv

# 加载配置
load_dotenv('D:/icu_anesthesia_project/.env')

def migrate():
    sqlite_db = 'D:/icu_anesthesia_project/database.db'
    if not os.path.exists(sqlite_db):
        print(f"Error: {sqlite_db} not found")
        return

    # 連接 SQLite
    sl_conn = sqlite3.connect(sqlite_db)
    sl_conn.row_factory = sqlite3.Row
    sl_cursor = sl_conn.cursor()

    # 連接 PostgreSQL
    try:
        pg_conn = psycopg2.connect(
            host=os.getenv('DB_HOST', 'localhost'),
            port=os.getenv('DB_PORT', '5432'),
            database=os.getenv('DB_NAME', 'icu_pm'),
            user=os.getenv('DB_USER', 'postgres'),
            password=os.getenv('DB_PASSWORD', '123456')
        )
        pg_cursor = pg_conn.cursor()
    except Exception as e:
        print(f"Error connecting to PostgreSQL: {e}")
        return

    print("--- Migrating system_config ---")
    try:
        sl_cursor.execute("SELECT config_key, value FROM system_config")
        rows = sl_cursor.fetchall()
        for row in rows:
            print(f"Syncing system_config: {row['config_key']}")
            pg_cursor.execute("""
                INSERT INTO system_config (config_key, value)
                VALUES (%s, %s)
                ON CONFLICT (config_key) DO UPDATE SET value = EXCLUDED.value
            """, (row['config_key'], row['value']))
        pg_conn.commit()
    except Exception as e:
        print(f"Error migrating system_config: {e}")

    print("\n--- Migrating ai_configs ---")
    try:
        # 檢查 SQLite 中的 ai_configs 列
        sl_cursor.execute("PRAGMA table_info(ai_configs)")
        cols = [r[1] for r in sl_cursor.fetchall()]
        
        select_cols = ['name', 'api_key', 'base_url']
        if 'models' in cols: select_cols.append('models')
        if 'priority' in cols: select_cols.append('priority')
        if 'is_active' in cols: select_cols.append('is_active')

        sql = f"SELECT {', '.join(select_cols)} FROM ai_configs"
        sl_cursor.execute(sql)
        rows = sl_cursor.fetchall()
        
        for row in rows:
            print(f"Syncing ai_config: {row['name']}")
            # 構建 PG 插入
            pg_cols = ['name', 'api_key', 'base_url']
            vals = [row['name'], row['api_key'], row['base_url']]
            
            if 'models' in select_cols:
                pg_cols.append('models')
                vals.append(row['models'])
            
            if 'priority' in select_cols:
                pg_cols.append('priority')
                vals.append(row['priority'])
            
            if 'is_active' in select_cols:
                pg_cols.append('is_active')
                # 轉布爾
                is_active = row['is_active']
                if isinstance(is_active, str):
                    is_active = is_active.lower() == 'true' or is_active == '1'
                else:
                    is_active = bool(is_active)
                vals.append(is_active)

            placeholders = ', '.join(['%s'] * len(vals))
            update_set = ', '.join([f"{c} = EXCLUDED.{c}" for c in pg_cols if c != 'name'])
            
            insert_sql = f"""
                INSERT INTO ai_configs ({', '.join(pg_cols)})
                VALUES ({placeholders})
                ON CONFLICT (name) DO UPDATE SET {update_set}
            """
            pg_cursor.execute(insert_sql, vals)
        pg_conn.commit()
    except Exception as e:
        print(f"Error migrating ai_configs: {e}")

    # 關閉連線
    sl_conn.close()
    pg_conn.close()
    print("\n--- Migration finished ---")

if __name__ == "__main__":
    migrate()
