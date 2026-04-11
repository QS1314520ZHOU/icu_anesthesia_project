import argparse
import logging
import os
import sqlite3
from typing import Dict, List

import psycopg2
from psycopg2 import sql

from app_config import DB_CONFIG


logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

SQLITE_DB = 'database.db'
PG_CONFIG = DB_CONFIG['POSTGRES']


def get_pg_conn():
    return psycopg2.connect(
        host=PG_CONFIG['HOST'],
        port=PG_CONFIG['PORT'],
        database=PG_CONFIG['NAME'],
        user=PG_CONFIG['USER'],
        password=PG_CONFIG['PASSWORD'],
    )


def get_sqlite_conn():
    conn = sqlite3.connect(SQLITE_DB)
    conn.row_factory = sqlite3.Row
    return conn


def list_sqlite_tables(lite_cur) -> List[str]:
    lite_cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    return [row['name'] for row in lite_cur.fetchall()]


def quote_sqlite_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def get_pg_table_names(pg_cur) -> set:
    pg_cur.execute(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        """
    )
    return {row[0] for row in pg_cur.fetchall()}


def check_pg_tables_exist(pg_cur, tables: List[str]) -> List[str]:
    existing_tables = get_pg_table_names(pg_cur)
    return [table for table in tables if table not in existing_tables]


def get_existing_row_counts(pg_cur, tables: List[str]) -> Dict[str, int]:
    counts = {}
    for table in tables:
        query = sql.SQL("SELECT COUNT(*) FROM {}").format(sql.Identifier(table))
        pg_cur.execute(query)
        counts[table] = pg_cur.fetchone()[0]
    return counts


def get_pg_column_types(pg_cur, table: str) -> Dict[str, str]:
    pg_cur.execute(
        """
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        """,
        (table,),
    )
    return {row[0]: row[1] for row in pg_cur.fetchall()}


# PostgreSQL DATE / TIMESTAMP 类型，空字符串必须转为 None
_PG_DATE_TYPES = {'date', 'timestamp without time zone', 'timestamp with time zone'}


def convert_row_for_pg(row, columns: List[str], column_types: Dict[str, str]) -> List:
    converted = []
    for column in columns:
        value = row[column]
        col_type = column_types.get(column, '')
        if col_type == 'boolean' and value in (0, 1):
            value = bool(value)
        elif col_type in _PG_DATE_TYPES and value == '':
            value = None
        converted.append(value)
    return converted


def migrate_table(lite_cur, pg_conn, table: str) -> Dict[str, int]:
    logger.info("迁移表: %s", table)

    lite_cur.execute(f"SELECT * FROM {quote_sqlite_identifier(table)}")
    rows = lite_cur.fetchall()
    total_rows = len(rows)
    if total_rows == 0:
        logger.info("  表为空，跳过。")
        return {"total": 0, "inserted": 0, "skipped": 0}

    sqlite_columns = list(rows[0].keys())

    with pg_conn.cursor() as pg_cur:
        column_types = get_pg_column_types(pg_cur, table)

        # 只保留 PG 表中实际存在的列，跳过 SQLite 独有的列
        pg_column_set = set(column_types.keys())
        columns = [col for col in sqlite_columns if col in pg_column_set]
        dropped = set(sqlite_columns) - pg_column_set
        if dropped:
            logger.warning("  跳过 PG 中不存在的列: %s", ', '.join(sorted(dropped)))

        insert_query = sql.SQL(
            "INSERT INTO {table} ({columns}) VALUES ({values}) ON CONFLICT DO NOTHING RETURNING 1"
        ).format(
            table=sql.Identifier(table),
            columns=sql.SQL(', ').join(sql.Identifier(col) for col in columns),
            values=sql.SQL(', ').join(sql.Placeholder() for _ in columns),
        )

        inserted = 0
        skipped = 0

        try:
            for row in rows:
                data = convert_row_for_pg(row, columns, column_types)
                pg_cur.execute(insert_query, data)
                result = pg_cur.fetchone()
                if result:
                    inserted += 1
                else:
                    skipped += 1

            pg_conn.commit()
        except Exception as exc:
            pg_conn.rollback()
            raise RuntimeError(f"迁移表 {table} 失败: {exc}") from exc

    if skipped > 0:
        logger.warning("  表 %s 存在冲突跳过: %s 行", table, skipped)

    logger.info("  完成: 总计 %s, 成功 %s, 跳过 %s", total_rows, inserted, skipped)
    return {"total": total_rows, "inserted": inserted, "skipped": skipped}


def reset_table_sequence(pg_conn, table: str):
    with pg_conn.cursor() as pg_cur:
        try:
            pg_cur.execute("SELECT pg_get_serial_sequence(%s, 'id')", (table,))
            sequence_name = pg_cur.fetchone()[0]
            if not sequence_name:
                pg_conn.rollback()
                logger.info("  表 %s 未检测到 id 序列，跳过重置。", table)
                return

            reset_query = sql.SQL(
                """
                SELECT setval(
                    %s,
                    COALESCE((SELECT MAX(id) FROM {}), 1),
                    (SELECT COUNT(*) > 0 FROM {})
                )
                """
            ).format(sql.Identifier(table), sql.Identifier(table))
            pg_cur.execute(reset_query, (sequence_name,))
            pg_conn.commit()
            logger.info("  表 %s 序列已重置。", table)
        except Exception as exc:
            pg_conn.rollback()
            logger.warning("  表 %s 序列重置失败: %s", table, exc)


def set_replication_role(pg_conn, role: str):
    original_autocommit = pg_conn.autocommit
    try:
        # 必须先结束当前事务，才能切换 autocommit
        if not pg_conn.autocommit:
            pg_conn.commit()
        pg_conn.autocommit = True
        with pg_conn.cursor() as pg_cur:
            pg_cur.execute(f"SET session_replication_role = '{role}'")
    finally:
        try:
            pg_conn.autocommit = original_autocommit
        except psycopg2.ProgrammingError:
            # 如果仍在事务中，先提交再恢复
            pg_conn.commit()
            pg_conn.autocommit = original_autocommit


def confirm_continue_if_needed(existing_counts: Dict[str, int], force: bool):
    tables_with_data = {table: count for table, count in existing_counts.items() if count > 0}
    if not tables_with_data:
        return

    logger.warning("PostgreSQL 目标表中已存在数据:")
    for table, count in sorted(tables_with_data.items()):
        logger.warning("  %s: %s 行", table, count)

    if force:
        logger.warning("已使用 --force，继续迁移。")
        return

    answer = input("目标 PostgreSQL 表中已有数据，是否继续迁移？输入 yes 继续: ").strip().lower()
    if answer != 'yes':
        raise SystemExit("迁移已取消。")


def parse_args():
    parser = argparse.ArgumentParser(description='Migrate SQLite data to PostgreSQL safely.')
    parser.add_argument('--force', action='store_true', help='Skip confirmation when PostgreSQL tables already contain data.')
    return parser.parse_args()


def migrate(force: bool = False):
    if not os.path.exists(SQLITE_DB):
        raise SystemExit(f"SQLite database not found at {SQLITE_DB}")

    lite_conn = get_sqlite_conn()
    pg_conn = get_pg_conn()
    pg_conn.autocommit = False

    report = {
        "tables": {},
        "failed_tables": [],
        "total_rows": 0,
        "inserted_rows": 0,
        "skipped_rows": 0,
    }

    try:
        lite_cur = lite_conn.cursor()
        with pg_conn.cursor() as pg_cur:
            tables = list_sqlite_tables(lite_cur)
            logger.info("发现 %s 张 SQLite 表: %s", len(tables), ', '.join(tables))

            missing_tables = check_pg_tables_exist(pg_cur, tables)
            if missing_tables:
                raise SystemExit(
                    "PostgreSQL 缺少目标表，请先运行 init_pg.py。\n缺失表: " + ', '.join(missing_tables)
                )

            existing_counts = get_existing_row_counts(pg_cur, tables)
            confirm_continue_if_needed(existing_counts, force)

        set_replication_role(pg_conn, 'replica')

        for table in tables:
            try:
                table_stats = migrate_table(lite_cur, pg_conn, table)
                report["tables"][table] = table_stats
                report["total_rows"] += table_stats["total"]
                report["inserted_rows"] += table_stats["inserted"]
                report["skipped_rows"] += table_stats["skipped"]

                if table_stats["inserted"] > 0:
                    reset_table_sequence(pg_conn, table)
            except Exception as exc:
                pg_conn.rollback()
                logger.error("%s", exc)
                report["failed_tables"].append(table)
                report["tables"][table] = {"total": 0, "inserted": 0, "skipped": 0, "error": str(exc)}
                continue
    finally:
        try:
            set_replication_role(pg_conn, 'origin')
        except Exception as exc:
            logger.warning("恢复 session_replication_role 失败: %s", exc)

        lite_conn.close()
        pg_conn.close()

    logger.info("迁移汇总报告:")
    for table, stats in report["tables"].items():
        if "error" in stats:
            logger.error("  %s: FAILED - %s", table, stats["error"])
        else:
            logger.info(
                "  %s: 总计 %s, 成功 %s, 跳过 %s",
                table,
                stats["total"],
                stats["inserted"],
                stats["skipped"],
            )

    if report["skipped_rows"] > 0:
        logger.warning("迁移过程中共有 %s 行因冲突被跳过。", report["skipped_rows"])

    if report["failed_tables"]:
        logger.error("失败表: %s", ', '.join(report["failed_tables"]))
    else:
        logger.info("所有表迁移完成。")

    logger.info(
        "总计: %s 行, 成功插入 %s 行, 跳过 %s 行",
        report["total_rows"],
        report["inserted_rows"],
        report["skipped_rows"],
    )


if __name__ == '__main__':
    args = parse_args()
    migrate(force=args.force)
