
from flask import Blueprint, request, jsonify
from services.onboarding_service import onboarding_service
from services.ai_insight_service import ai_insight_service
from utils.response_utils import api_response
from ai_utils import call_ai

collab_bp = Blueprint('collaboration', __name__, url_prefix='/api/collab')

@collab_bp.route('/snapshot/<int:project_id>', methods=['GET'])
def get_project_snapshot(project_id):
    content = onboarding_service.generate_project_snapshot(project_id)
    if content:
        return api_response(True, content)
    return api_response(False, error="Failed to generate snapshot")

@collab_bp.route('/parse-multi-logs', methods=['POST'])
def parse_multi_logs():
    data = request.json or {}
    raw_text = data.get('raw_text')
    if not raw_text:
        return api_response(False, error="Missing raw_text")
    
    logs = ai_insight_service.parse_multi_logs(raw_text)
    return api_response(True, logs)

@collab_bp.route('/meeting-actions', methods=['POST'])
def extract_meeting_actions():
    data = request.json or {}
    transcript = data.get('transcript')
    if not transcript:
        return api_response(False, error="Missing transcript")

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
    try:
        content = call_ai(prompt, task_type='summary')
        return api_response(True, content)
    except Exception as e:
        return api_response(False, error=f"会议纪要提取失败: {str(e)}", code=500)
