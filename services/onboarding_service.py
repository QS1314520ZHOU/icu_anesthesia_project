
from database import DatabasePool
from services.ai_service import AIService
from datetime import datetime
import json

class OnboardingService:
    @staticmethod
    def generate_project_snapshot(project_id):
        """
        为新入项成员生成项目极简入门手册 (Snapshot)
        """
        try:
            with DatabasePool.get_connection() as conn:
                # 1. 获取项目基本资料
                project = conn.execute('SELECT * FROM projects WHERE id = ?', (project_id,)).fetchone()
                if not project: return None
                
                # 2. 获取核心团队
                members = conn.execute('SELECT name, role FROM project_members WHERE project_id = ? AND status = "在岗"', (project_id,)).fetchall()
                
                # 3. 获取最近动态 (最近5条日志)
                logs = conn.execute('SELECT member_name, log_date, work_content FROM work_logs WHERE project_id = ? ORDER BY log_date DESC LIMIT 5', (project_id,)).fetchall()
                
                # 4. 获取未解决的问题
                issues = conn.execute('SELECT issue_type, description, severity FROM issues WHERE project_id = ? AND status != "已解决" LIMIT 5', (project_id,)).fetchall()
                
                # 5. 调用 AI 生成 Snapshot
                system_prompt = """你是一位资深的项目经理。
请为一位刚加入项目的新成员编写一份“极简入项手册 (Project Snapshot)”。
内容需包括：
1. 项目核心愿景与当前所处阶段。
2. 核心对接人 (及其角色)。
3. 当前最紧急的“救火”任务或风险点。
4. 给新人的 3 条入项建议。
要求：
- 语言精练、直击痛点。
- 使用 Markdown 格式。
- 充满欢迎感但保持专业。
- 严禁向用户提问或要求补充信息，请基于现有资料完成编写。
- 不要出现“如果你有任何问题”之类的套话，直接输出手册正文。"""


                context = f"项目名称: {project['project_name']} ({project['hospital_name']})\n"
                context += f"当前进度: {project['progress']}%\n"
                context += f"核心人员: {[m['name'] + '(' + m['role'] + ')' for m in members]}\n"
                context += f"当前未解决问题: {[i['issue_type'] + ':' + i['description'] for i in issues]}\n"
                context += f"最近工作动态: {[l['member_name'] + ':' + l['work_content'] for l in logs]}\n"
                
                content = AIService.call_ai_api(system_prompt, context, task_type="analysis")
                return content
        except Exception as e:
            print(f"Generate Snapshot Error: {e}")
            return "生成快照失败，请稍后重试。"

onboarding_service = OnboardingService()
