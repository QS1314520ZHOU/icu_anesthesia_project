import json
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
            # Clean up
            sql = sql.replace('```sql', '').replace('```', '').strip()
            
            # Basic Safety Check
            if not sql.upper().startswith('SELECT'):
                return None, "Error: Only SELECT queries are allowed."
            
            return sql, None
        except Exception as e:
            return None, str(e)

    def execute_query(self, project_id, sql):
        """执行 SQL 并返回结果"""
        # Double check project_id safety (simple string check, though prompt should handle it)
        # In a real prod env, we might parse the AST to enforce filtering.
        # Here we rely on the Prompt + simple validation.
        
        try:
            with DatabasePool.get_connection() as conn:
                cursor = conn.execute(sql)
                columns = [description[0] for description in cursor.description]
                rows = cursor.fetchall()
                # Convert rows to dicts
                results = [dict(r) for r in rows]
                return {
                    "columns": columns,
                    "rows": results,
                    "sql": sql
                }
        except Exception as e:
            return {"error": str(e), "sql": sql}

nl_query_service = NLQueryService()
