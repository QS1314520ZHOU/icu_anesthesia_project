import sqlite3
import threading
from contextlib import contextmanager

DATABASE = 'database.db'

class DatabasePool:
    _local = threading.local()
    
    @classmethod
    @contextmanager
    def get_connection(cls):
        """
        获取数据库连接上下文管理器
        使用线程本地存储实现简单的连接复用
        """
        if not hasattr(cls._local, 'conn') or cls._local.conn is None:
            # check_same_thread=False 允许在多线程环境中使用同一个连接
            # 但要注意 SQLite 的并发写入限制
            cls._local.conn = sqlite3.connect(DATABASE, check_same_thread=False)
            cls._local.conn.row_factory = sqlite3.Row
        
        try:
            yield cls._local.conn
            # 成功执行后提交
            cls._local.conn.commit()
        except Exception as e:
            # 发生异常时回滚
            if cls._local.conn:
                cls._local.conn.rollback()
            raise e
        # 这里不关闭连接，而是让线程复用
        # 实际生产环境可能需要定期回收或重置

    @classmethod
    def close_connection(cls, exception=None):
        """关闭当前线程的连接"""
        conn = getattr(cls._local, 'conn', None)
        if conn is not None:
            conn.close()
            cls._local.conn = None

def get_db():
    """虽然保留函数名兼容旧代码，但推荐使用 with DatabasePool.get_connection() as conn:"""
    if not hasattr(DatabasePool._local, 'conn') or DatabasePool._local.conn is None:
        DatabasePool._local.conn = sqlite3.connect(DATABASE, check_same_thread=False)
        DatabasePool._local.conn.row_factory = sqlite3.Row
    return DatabasePool._local.conn

def close_db(e=None):
    DatabasePool.close_connection(e)

def init_db_schema():
    """初始化数据库表结构"""
    pass # 具体的表结构初始化逻辑保留在 app.py 中，或者后续迁移过来
