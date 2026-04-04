
from flask import Blueprint, request, jsonify
from services.nl_query_service import nl_query_service
from api_utils import api_response
from services.ai_insight_service import ai_insight_service
from ai_utils import call_ai

nl_query_bp = Blueprint('nl_query_v2', __name__, url_prefix='/api')

@nl_query_bp.route('/projects/<int:project_id>/ask', methods=['POST'])
def ask_ai(project_id):
    """自然语言查询 (Text-to-SQL)"""
    data = request.json or {}
    question = data.get('question', '')
    
    if not question:
        return api_response(success=False, message="请输入问题")
    
    try:
        normalized_question = question.strip()

        # 兼容旧前端：批量智能补录曾错误复用 NL Query 接口。
        if '拆成多条项目工作日志' in normalized_question or '批量导入' in normalized_question:
            raw_text = normalized_question
            if '原始文本：' in normalized_question:
                raw_text = normalized_question.split('原始文本：', 1)[1].strip()
            logs = ai_insight_service.parse_multi_logs(raw_text)
            if not logs:
                return api_response(success=True, data={'answer': '未识别到可导入的日志条目，请调整文本格式后重试。'})

            markdown = "\n\n".join([
                f"### 日志 {idx + 1}\n"
                f"- 日期：{item.get('log_date') or item.get('date') or '未识别'}\n"
                f"- 人员：{item.get('member_name') or '未知'}\n"
                f"- 工作内容：{item.get('work_content') or item.get('content') or item.get('summary') or '-'}\n"
                f"- 问题：{item.get('issues') or item.get('issues_encountered') or '-'}\n"
                f"- 明日计划：{item.get('plan') or item.get('tomorrow_plan') or item.get('next_plan') or '-'}"
                for idx, item in enumerate(logs)
            ])
            return api_response(success=True, data={'answer': markdown, 'logs': logs})

        # 兼容旧前端：会议助手曾错误复用 NL Query 接口。
        if '会议纪要摘要' in normalized_question or '待办事项列表' in normalized_question or '风险提醒' in normalized_question:
            transcript = normalized_question
            if '会议内容：' in normalized_question:
                transcript = normalized_question.split('会议内容：', 1)[1].strip()
            prompt = f"""请将以下会议记录整理为 Markdown 格式，输出 3 个部分：

## 会议纪要摘要
- 用 2-4 条要点总结会议核心结论

## 待办事项列表
- 每条待办尽量包含：事项、责任方、时间要求（若无法判断可写“待确认”）

## 风险提醒
- 提炼会议中暴露的关键风险或需关注事项

会议记录如下：
{transcript}
"""
            answer = call_ai(prompt, task_type='summary')
            return api_response(success=True, data={'answer': answer})

        # 1. Convert to SQL
        sql, error = nl_query_service.convert_to_sql(project_id, question)
        if error:
            return api_response(success=False, message=error)
            
        # 2. Execute SQL
        result = nl_query_service.execute_query(project_id, sql)
        if 'error' in result:
             return api_response(success=False, message=result['error'], data={"sql": sql})
             
        return api_response(success=True, data=result)
        
    except Exception as e:
        return api_response(success=False, message=str(e))
