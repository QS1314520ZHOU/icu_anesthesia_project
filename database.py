import sqlite3
import threading
from contextlib import contextmanager
import os
import re
import logging
from app_config import DB_CONFIG

DATABASE_SQLITE = 'database.db'
logger = logging.getLogger(__name__)

# PostgreSQL imports
try:
    import psycopg2
    from psycopg2 import pool
    from psycopg2.extras import DictCursor
except ImportError:
    psycopg2 = None

if psycopg2 is not None:
    DB_INTEGRITY_ERRORS = (sqlite3.IntegrityError, psycopg2.IntegrityError)
    DB_OPERATIONAL_ERRORS = (sqlite3.OperationalError, psycopg2.OperationalError)
else:
    DB_INTEGRITY_ERRORS = (sqlite3.IntegrityError,)
    DB_OPERATIONAL_ERRORS = (sqlite3.OperationalError,)


class PGCursorWrapper:
    _id_column_cache = {}

    def __init__(self, cursor):
        self._cursor = cursor
        self._last_id = None

    @staticmethod
    def _parse_insert_table(query):
        """
        Parse target table name from INSERT statement.
        Supports forms like:
        - INSERT INTO table_name (...)
        - INSERT INTO schema.table_name (...)
        - INSERT INTO "table_name" (...)
        """
        match = re.match(r"^\s*INSERT\s+INTO\s+([^\s(]+)", query, flags=re.IGNORECASE)
        if not match:
            return None, None

        raw_name = match.group(1).strip()
        if "." in raw_name:
            schema, table = raw_name.split(".", 1)
        else:
            schema, table = "public", raw_name

        schema = schema.strip('"').strip()
        table = table.strip('"').strip()
        return schema, table

    def _table_has_id_column(self, schema, table):
        cache_key = (schema, table)
        if cache_key in PGCursorWrapper._id_column_cache:
            return PGCursorWrapper._id_column_cache[cache_key]

        has_id = False
        try:
            with self._cursor.connection.cursor() as meta_cursor:
                meta_cursor.execute(
                    """
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = %s
                      AND table_name = %s
                      AND column_name = 'id'
                    LIMIT 1
                    """,
                    (schema, table),
                )
                has_id = meta_cursor.fetchone() is not None
        except Exception:
            has_id = False

        PGCursorWrapper._id_column_cache[cache_key] = has_id
        return has_id
    
    def execute(self, query, vars=None):
        formatted_query = DatabasePool.format_sql(query)
        
        # Determine if we should append RETURNING id for lastrowid support.
        # Only apply to tables that really have an `id` column.
        is_insert = formatted_query.strip().upper().startswith('INSERT INTO')
        has_returning = 'RETURNING' in formatted_query.upper()
        
        should_append_returning = False
        if is_insert and not has_returning:
            schema, table = self._parse_insert_table(formatted_query)
            if schema and table and self._table_has_id_column(schema, table):
                # Avoid appending for multi-statement SQL.
                if ';' not in formatted_query:
                    formatted_query += ' RETURNING id'
                    should_append_returning = True

        # psycopg2 uses `%s` placeholders; literal percent signs in SQL must be escaped.
        # This avoids errors like "tuple index out of range" for patterns such as ILIKE '%text%'.
        if vars is not None:
            formatted_query = re.sub(r'(?<!%)%(?!s|%)', '%%', formatted_query)

        try:
            self._cursor.execute(formatted_query, vars)
            if should_append_returning:
                try:
                    row = self._cursor.fetchone()
                    if row:
                        self._last_id = row[0]
                except Exception:
                    self._last_id = None
        except Exception as e:
            print(f"PostgreSQL Execute Error: {e}")
            print(f"Failing SQL: {formatted_query}")
            print(f"Vars: {vars}")
            raise e
        return self

    @property
    def lastrowid(self):
        return self._last_id
    
    def __getattr__(self, name):
        return getattr(self._cursor, name)
    
    def __iter__(self):
        return iter(self._cursor)

class PGConnectionWrapper:
    def __init__(self, conn):
        self._conn = conn
    
    def cursor(self, *args, **kwargs):
        return PGCursorWrapper(self._conn.cursor(*args, **kwargs))
    
    def execute(self, query, vars=None):
        cursor = self.cursor()
        cursor.execute(query, vars)
        return cursor
    
    def commit(self):
        try:
            return self._conn.commit()
        except Exception as e:
            self._conn.rollback()
            raise e
    
    def rollback(self):
        return self._conn.rollback()
    
    def __getattr__(self, name):
        return getattr(self._conn, name)

class DatabasePool:
    _local = threading.local()
    _pg_pool = None

    @staticmethod
    def format_sql(sql):
        """将 SQLite 风格的 SQL 转换为 PostgreSQL 风格"""
        from app_config import DB_CONFIG
        if DB_CONFIG.get('TYPE') != 'postgres':
            return sql
        
        # 0. 处理 SQLite 专有语法
        if 'INSERT OR REPLACE' in sql.upper():
            logger.warning(f"INSERT OR REPLACE 不支持自动转换，请手动改写为 ON CONFLICT: {sql[:100]}")

        if re.search(r"INSERT\s+OR\s+IGNORE\s+INTO", sql, flags=re.IGNORECASE):
            sql = re.sub(r'INSERT\s+OR\s+IGNORE\s+INTO', 'INSERT INTO', sql, count=1, flags=re.IGNORECASE)
            if 'ON CONFLICT' not in sql.upper():
                returning_clause = ''
                returning_match = re.search(r"\bRETURNING\b.*$", sql, flags=re.IGNORECASE | re.DOTALL)
                if returning_match:
                    returning_clause = ' ' + returning_match.group(0).strip()
                    sql = sql[:returning_match.start()].rstrip()

                has_semicolon = sql.rstrip().endswith(';')
                sql = sql.rstrip().rstrip(';').rstrip()
                sql = f"{sql} ON CONFLICT DO NOTHING{returning_clause}"
                if has_semicolon:
                    sql += ';'

        pragma_match = re.search(r"PRAGMA\s+table_info\(\s*['\"]?(\w+)['\"]?\s*\)", sql, re.IGNORECASE)
        if pragma_match:
            table_name = pragma_match.group(1)
            sql = (
                "SELECT column_name as name, data_type as type, is_nullable, "
                f"column_default as dflt_value FROM information_schema.columns "
                f"WHERE table_name = '{table_name}' ORDER BY ordinal_position"
            )

        # 1. 替换占位符 ? 为 %s
        # PostgreSQL 使用 %s 而 sqlite3 使用 ?
        # 这里采用简单的全局替换，对于绝大多数业务 SQL 足够
        sql = sql.replace('?', '%s')

        # 2. 处理日期函数
        # SQLite: date('now'), datetime('now')
        # Postgres: CURRENT_DATE, CURRENT_TIMESTAMP
        sql = sql.replace("date('now')", "CURRENT_DATE")
        sql = sql.replace('date("now")', "CURRENT_DATE")
        sql = sql.replace("datetime('now')", "CURRENT_TIMESTAMP")
        sql = sql.replace('datetime("now")', "CURRENT_TIMESTAMP")
        
        # 处理 DATE(column) -> column::date
        sql = re.sub(r"\bDATE\s*\(\s*(?!['\"]now['\"])(.*?)\s*\)", r"(\1)::date", sql, flags=re.IGNORECASE)
        
        # 处理带偏移的情况，如 date('now', '-1 day') -> (CURRENT_DATE + INTERVAL '-1 day')
        sql = re.sub(r"date\s*\(\s*['\"]now['\"]\s*,\s*(['\"].*?['\"])\s*\)", r"(CURRENT_DATE + INTERVAL \1)", sql, flags=re.IGNORECASE)
        sql = re.sub(r"datetime\s*\(\s*['\"]now['\"]\s*,\s*(['\"].*?['\"])\s*\)", r"(CURRENT_TIMESTAMP + INTERVAL \1)", sql, flags=re.IGNORECASE)
        
        # 3. 处理 strftime -> to_char
        def replace_strftime(match):
            fmt = match.group(1)
            field = match.group(2)
            # 简单转换常见格式符
            fmt = fmt.replace('%Y', 'YYYY').replace('%m', 'MM').replace('%d', 'DD')
            fmt = fmt.replace('%H', 'HH24').replace('%M', 'MI').replace('%S', 'SS')
            return f"to_char({field}, '{fmt}')"
        
        sql = re.sub(r"strftime\s*\(\s*['\"](.*?)['\"]\s*,\s*(.*?)\s*\)", replace_strftime, sql, flags=re.IGNORECASE)

        # 3.1 处理 julianday 差值
        # SQLite: julianday(end) - julianday(start)
        # Postgres: EXTRACT(EPOCH FROM ((end)::timestamp - (start)::timestamp)) / 86400.0
        sql = re.sub(
            r"julianday\s*\(\s*(.*?)\s*\)\s*-\s*julianday\s*\(\s*(.*?)\s*\)",
            r"(EXTRACT(EPOCH FROM ((\1)::timestamp - (\2)::timestamp)) / 86400.0)",
            sql,
            flags=re.IGNORECASE,
        )

        # 3.2 处理单独的 julianday(field)
        sql = re.sub(
            r"julianday\s*\(\s*(.*?)\s*\)",
            r"(EXTRACT(EPOCH FROM ((\1)::timestamp)) / 86400.0)",
            sql,
            flags=re.IGNORECASE,
        )

        # 4. 处理 LIKE -> ILIKE (Postgres 强制区分大小写，SQLite 默认不区分)
        # 大部分业务场景下，LIKE 用于搜索，期望不区分大小写
        sql = re.sub(r"\bLIKE\b", "ILIKE", sql, flags=re.IGNORECASE)

        # 5. 处理 group_concat -> string_agg
        # SQLite: group_concat(field, ',')
        # Postgres: string_agg(field, ',')
        sql = re.sub(r"group_concat\s*\(\s*(.*?)\s*,\s*(.*?)\s*\)", r"string_agg(\1, \2)", sql, flags=re.IGNORECASE)
        sql = re.sub(r"group_concat\s*\(\s*(.*?)\s*\)", r"string_agg(\1, ',')", sql, flags=re.IGNORECASE)

        # 6. 处理 sqlite_master -> information_schema.tables
        if "sqlite_master" in sql.lower():
            # 1) 处理常用的检查表是否存在模式: SELECT name FROM sqlite_master WHERE type='table' AND name='...'
            sql = re.sub(r"SELECT\s+name\s+FROM\s+sqlite_master\s+WHERE\s+type=['\"]table['\"]\s+AND\s+name=['\"](.*?)['\"]", 
                         r"SELECT table_name as name FROM information_schema.tables WHERE table_name = '\1'", sql, flags=re.IGNORECASE)
            # 2) 处理获取所有表模式: SELECT name FROM sqlite_master WHERE type='table'
            sql = re.sub(r"SELECT\s+name\s+FROM\s+sqlite_master\s+WHERE\s+type=['\"]table['\"]", 
                         r"SELECT table_name as name FROM information_schema.tables WHERE table_schema = 'public'", sql, flags=re.IGNORECASE)
            # 3) 处理通用情况
            sql = sql.replace("sqlite_master", "information_schema.tables")
            if "information_schema.tables" in sql:
                 sql = re.sub(r"\bname\b", "table_name", sql)
                 sql = re.sub(r"\btype\b", "table_type", sql)

        # 7. 处理布尔值转换 (0/1 -> FALSE/TRUE)
        bool_fields = ['is_completed', 'is_active', 'is_sent', 'is_read', 'is_primary', 'ai_generated', 'is_onsite', 'is_celebrated', 'is_public']
        for field in bool_fields:
            # 转换显式赋值: field = 1 -> field = TRUE
            sql = re.sub(rf"\b{field}\s*=\s*1\b", f"{field} = TRUE", sql, flags=re.IGNORECASE)
            sql = re.sub(rf"\b{field}\s*=\s*0\b", f"{field} = FALSE", sql, flags=re.IGNORECASE)
            # 转换比较: field is 1 -> field IS TRUE
            sql = re.sub(rf"\b{field}\s+is\s+1\b", f"{field} IS TRUE", sql, flags=re.IGNORECASE)
            sql = re.sub(rf"\b{field}\s+is\s+0\b", f"{field} IS FALSE", sql, flags=re.IGNORECASE)

        # 8. 处理 PostgreSQL 保留字表名 users
        sql = re.sub(
            r'\b(FROM|JOIN|INTO|UPDATE|EXISTS|TABLE(?:\s+IF\s+NOT\s+EXISTS)?)\s+users\b',
            lambda m: f'{m.group(1)} "users"',
            sql,
            flags=re.IGNORECASE,
        )

        return sql

    @staticmethod
    def is_postgres():
        db_type = DB_CONFIG.get('TYPE', 'sqlite')
        return db_type == 'postgres'

    @classmethod
    def table_exists(cls, conn, table_name, schema='public'):
        if cls.is_postgres():
            row = conn.execute(
                """
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = %s AND table_name = %s
                """,
                (schema, table_name),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                (table_name,),
            ).fetchone()
        return row is not None

    @classmethod
    def get_table_columns(cls, conn, table_name, schema='public'):
        if cls.is_postgres():
            rows = conn.execute(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = %s AND table_name = %s
                """,
                (schema, table_name),
            ).fetchall()
            return {r['column_name'] for r in rows}

        rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
        return {r['name'] if not isinstance(r, tuple) else r[1] for r in rows}

    @classmethod
    def get_inserted_id(cls, cursor):
        """兼容 PostgreSQL RETURNING id 与 SQLite lastrowid。"""
        if cls.is_postgres():
            row = cursor.fetchone()
            return row[0] if row else None
        return cursor.lastrowid

    @classmethod
    def _init_pg_pool(cls):
        if cls._pg_pool is None and psycopg2 is not None:
            conf = DB_CONFIG['POSTGRES']
            try:
                cls._pg_pool = pool.ThreadedConnectionPool(
                    conf['MIN_CONN'], 
                    conf['MAX_CONN'],
                    host=conf['HOST'],
                    port=conf['PORT'],
                    database=conf['NAME'],
                    user=conf['USER'],
                    password=conf['PASSWORD']
                )
                print("PostgreSQL connection pool initialized.")
            except Exception as e:
                print(f"Failed to initialize PostgreSQL pool: {e}")
                raise e

    @classmethod
    @contextmanager
    def get_connection(cls):
        """
        获取数据库连接上下文管理器
        支持 SQLite (本地线程存储) 和 PostgreSQL (连接池)
        """
        db_type = DB_CONFIG.get('TYPE', 'sqlite')
        
        if db_type == 'postgres':
            cls._init_pg_pool()
            conn = cls._pg_pool.getconn()
            # Set direct cursor to return dict-like objects for compatibility with existing code
            conn.cursor_factory = DictCursor
            wrapped_conn = PGConnectionWrapper(conn)
            try:
                yield wrapped_conn
                conn.commit()
            except Exception as e:
                conn.rollback()
                raise e
            finally:
                cls._pg_pool.putconn(conn)
        else:
            # SQLite Implementation
            if not hasattr(cls._local, 'conn') or cls._local.conn is None:
                cls._local.conn = sqlite3.connect(DATABASE_SQLITE, check_same_thread=False)
                cls._local.conn.row_factory = sqlite3.Row
            
            try:
                yield cls._local.conn
                cls._local.conn.commit()
            except Exception as e:
                if cls._local.conn:
                    cls._local.conn.rollback()
                raise e

    @classmethod
    def close_connection(cls, exception=None):
        """关闭当前线程的连接 (主要针对 SQLite)"""
        conn = getattr(cls._local, 'conn', None)
        if conn is not None:
            conn.close()
            cls._local.conn = None

def get_db():
    """保留函数名兼容旧代码"""
    db_type = DB_CONFIG.get('TYPE', 'sqlite')
    if db_type == 'postgres':
        # NOTE: This usage is discouraged for PG because it doesn't handle the pool correctly.
        # But for minimal impact refactoring, we'll try to provide a connection.
        # It's better to use DatabasePool.get_connection()
        DatabasePool._init_pg_pool()
        if not hasattr(DatabasePool._local, 'pg_conn') or DatabasePool._local.pg_conn is None:
             conn = DatabasePool._pg_pool.getconn()
             conn.cursor_factory = DictCursor
             DatabasePool._local.pg_conn = PGConnectionWrapper(conn)
        return DatabasePool._local.pg_conn
    else:
        if not hasattr(DatabasePool._local, 'conn') or DatabasePool._local.conn is None:
            DatabasePool._local.conn = sqlite3.connect(DATABASE_SQLITE, check_same_thread=False)
            DatabasePool._local.conn.row_factory = sqlite3.Row
        return DatabasePool._local.conn

def execute_query(sql, params=None):
    """通用执行函数，自动转换 SQL 和占位符"""
    formatted_sql = DatabasePool.format_sql(sql)
    
    # NOTE: Using context manager here is actually slightly problematic if returning the cursor,
    # as for PG the connection is returned to the pool at the end of the 'with' block.
    # We'll handle this by using a persistent connection for now or just warning.
    # For now, let's just make it work as expected if possible.
    with DatabasePool.get_connection() as conn:
        return conn.execute(formatted_sql, params)

def close_db(e=None):
    db_type = DB_CONFIG.get('TYPE', 'sqlite')
    if db_type == 'postgres':
        wrapped_conn = getattr(DatabasePool._local, 'pg_conn', None)
        if wrapped_conn:
            DatabasePool._pg_pool.putconn(wrapped_conn._conn)
            DatabasePool._local.pg_conn = None
    else:
        DatabasePool.close_connection(e)

def init_db_schema():
    """初始化数据库表结构"""
    pass
