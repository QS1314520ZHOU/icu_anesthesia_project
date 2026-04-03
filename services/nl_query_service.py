import json
import re
from services.ai_service import ai_service
from database import DatabasePool


class NLQueryService:
    def __init__(self):
        self.schema_summary = """
Table: projects
Columns: id, project_no, project_name, hospital_name, status, progress, risk_score, created_at, plan_start_date, plan_end_date
Table: issues
Columns: id, project_id, issue_type, description, severity (高/中/低), status (待处理/处理中/已解决), created_at, resolved_at
Table: tasks
# Note: tasks are linked to projects via project_stages; tasks do not have project_id directly.
# Best approach: JOIN project_stages ON project_stages.id = tasks.stage_id WHERE project_stages.project_id = V_PROJECT_ID
Columns: id, stage_id, task_name, is_completed, completed_date, remark
Table: project_stages
Columns: id, project_id, stage_name, stage_order, plan_start_date, plan_end_date, actual_start_date, actual_end_date, progress, status, responsible_person
Table: milestones
Columns: id, project_id, name, target_date, is_completed, completed_date
Table: work_logs
Columns: id, project_id, member_id, member_name, log_date, work_hours, work_type, work_content, issues_encountered, tomorrow_plan, created_at
Table: project_risk_history
Columns: id, project_id, risk_score, sentiment_score, record_date
"""

    def validate_generated_sql(self, sql):
        """校验 AI 生成 SQL 的安全性，仅允许单条只读查询"""
        if not sql or not sql.strip():
            return False, "未生成有效 SQL。"

        normalized_sql = sql.strip()
        upper_sql = normalized_sql.upper()

        if not upper_sql.startswith('SELECT'):
            return False, "仅允许执行 SELECT 查询。"

        forbidden_patterns = [
            (r"\bDROP\b", "SQL 包含危险操作 DROP"),
            (r"\bDELETE\b", "SQL 包含危险操作 DELETE"),
            (r"\bUPDATE\b", "SQL 包含危险操作 UPDATE"),
            (r"\bINSERT\b", "SQL 包含危险操作 INSERT"),
            (r"\bALTER\b", "SQL 包含危险操作 ALTER"),
            (r"\bCREATE\b", "SQL 包含危险操作 CREATE"),
            (r"\bTRUNCATE\b", "SQL 包含危险操作 TRUNCATE"),
            (r"\bEXEC\b", "SQL 包含危险操作 EXEC"),
            (r"--", "SQL 包含注释语法，已拒绝执行"),
            (r"\bINTO\s+OUTFILE\b", "SQL 包含敏感导出语法 INTO OUTFILE"),
            (r"\bLOAD_FILE\s*\(", "SQL 包含敏感文件读取函数 LOAD_FILE"),
            (r"\bINFORMATION_SCHEMA\b", "SQL 访问 INFORMATION_SCHEMA，已拒绝执行"),
        ]
        for pattern, message in forbidden_patterns:
            if re.search(pattern, normalized_sql, flags=re.IGNORECASE):
                return False, message

        semicolon_index = normalized_sql.find(';')
        if semicolon_index != -1:
            if normalized_sql[semicolon_index + 1:].strip():
                return False, "仅允许执行单条 SQL 语句。"
            normalized_sql = normalized_sql[:semicolon_index].rstrip()

        return True, normalized_sql

    def ensure_limit(self, sql):
        """如果查询未显式限制返回数量，则自动追加 LIMIT 100"""
        if re.search(r"\bLIMIT\b", sql, flags=re.IGNORECASE):
            return sql
        return f"{sql.rstrip()} LIMIT 100"

    def convert_to_sql(self, project_id, question):
        """将自然语言转换为 SQL"""
        db_flavor = "PostgreSQL" if DatabasePool.is_postgres() else "SQLite"

        system_prompt = f"""You are a {db_flavor} expert. Your task is to convert the user's question into a READ-ONLY SQL query based on the following schema:
{self.schema_summary}

Rules:
1. ONLY return the SQL query. Do not include markdown formatting (like ```sql).
2. The query must start with 'SELECT'.
3. Filter logic: For `projects`, `issues`, `milestones`, `work_logs` tables, use `project_id = {project_id}`.
4. For `tasks` table, you MUST JOIN `project_stages` like this: `FROM tasks JOIN project_stages ON tasks.stage_id = project_stages.id WHERE project_stages.project_id = {project_id}`.
5. If the question is about "high priority" or "severe", check `severity`='高'.
6. If the question is about "open" or "unresolved", check `status` != '已解决' or `is_completed` = 0.
7. Do not use JOINs unless querying the `tasks` table.
8. Limit results to 20 rows if not specified.
9. Important: generate valid {db_flavor} syntax.
"""
        try:
            sql = ai_service.call_ai_api(system_prompt, question, task_type="code")
            sql = sql.replace('```sql', '').replace('```', '').strip()

            is_valid, validated_sql = self.validate_generated_sql(sql)
            if not is_valid:
                return None, validated_sql

            return validated_sql, None
        except Exception as e:
            return None, f"SQL 生成失败: {e}"

    def execute_query(self, project_id, sql):
        """执行 SQL 并返回结果"""
        is_valid, validated_sql = self.validate_generated_sql(sql)
        if not is_valid:
            return {"error": validated_sql, "sql": sql}

        safe_sql = self.ensure_limit(validated_sql)
        formatted_sql = DatabasePool.format_sql(safe_sql)

        try:
            with DatabasePool.get_connection() as conn:
                cursor = conn.execute(formatted_sql)
                columns = [description[0] for description in cursor.description]
                rows = cursor.fetchall()
                results = [dict(r) for r in rows]
                return {
                    "columns": columns,
                    "rows": results,
                    "sql": formatted_sql
                }
        except Exception:
            return {
                "error": "查询执行失败，请检查查询条件或换一种问法。",
                "sql": formatted_sql
            }


nl_query_service = NLQueryService()
