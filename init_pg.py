import sys
import os

# 将当前目录添加到 PYTHONPATH
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from db_init import init_db

if __name__ == "__main__":
    print("正在初始化 PostgreSQL 数据库...")
    try:
        init_db()
        print("数据库初始化完成。")
    except Exception as e:
        print(f"初始化失败: {e}")
        import traceback
        traceback.print_exc()
