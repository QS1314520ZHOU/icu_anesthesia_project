
from flask import Blueprint, request, jsonify
import re
from database import DatabasePool
from services.onboarding_service import onboarding_service
from services.ai_insight_service import ai_insight_service
from services.project_service import project_service
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
    transcript = str(transcript)
    # 避免超长会议全文直接塞进 prompt 导致 token 爆炸
    max_chars = 12000
    if len(transcript) > max_chars:
        head = transcript[:8000]
        tail = transcript[-3500:]
        transcript = f"{head}\n\n...[内容过长，已截断中间部分]...\n\n{tail}"

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


@collab_bp.route('/projects/<int:project_id>/meeting-actions/materialize', methods=['POST'])
def materialize_meeting_actions(project_id):
    data = request.json or {}
    actions = [str(item).strip() for item in data.get('actions', []) if str(item).strip()]
    risks = [str(item).strip() for item in data.get('risks', []) if str(item).strip()]
    create_tasks = data.get('create_tasks', True)
    create_issues = data.get('create_issues', True)

    try:
        stage_id = _get_default_stage_id(project_id)
        task_count = 0
        issue_ids = []

        if create_tasks and stage_id:
            for item in actions[:20]:
                project_service.add_task(stage_id, {
                    'task_name': _clean_meeting_item(item)[:120],
                    'remark': f'由会议助手生成：{item}',
                    'assigned_to': _guess_owner(item),
                    'estimated_duration': 1,
                })
                task_count += 1

        if create_issues:
            for item in risks[:20]:
                result = project_service.add_issue(project_id, {
                    'issue_type': '会议风险',
                    'description': _clean_meeting_item(item)[:1000],
                    'severity': _guess_severity(item),
                    'status': '待处理',
                    'push_to_wecom': False,
                    'is_external_blocker': any(key in item for key in ['甲方', '厂家', '第三方', '外部']),
                })
                if isinstance(result, dict) and result.get('issue_id'):
                    issue_ids.append(result['issue_id'])

        return api_response(True, {
            'created_tasks': task_count,
            'created_issues': len(issue_ids),
            'issue_ids': issue_ids,
            'stage_id': stage_id,
        }, message='会议待办和风险已落地')
    except Exception as e:
        return api_response(False, error=f"会议事项落地失败: {str(e)}", code=500)


def _get_default_stage_id(project_id):
    with DatabasePool.get_connection() as conn:
        row = conn.execute(DatabasePool.format_sql('''
            SELECT id FROM project_stages
            WHERE project_id = ?
            ORDER BY CASE WHEN status = '进行中' THEN 0 ELSE 1 END, stage_order, id
            LIMIT 1
        '''), (project_id,)).fetchone()
        return row['id'] if row else None


def _clean_meeting_item(text):
    return str(text or '').replace('**', '').replace('`', '').strip(' -•\t\r\n')


def _guess_owner(text):
    match = re.search(r'(?:责任[人方]|负责人|owner)[:：]?\s*([^\s，,。；;]+)', text, re.I)
    return match.group(1) if match else ''


def _guess_severity(text):
    if any(key in text for key in ['严重', '紧急', '阻塞', '无法', '停机', '宕机', '高风险']):
        return '高'
    if any(key in text for key in ['风险', '延期', '异常', '待确认', '影响']):
        return '中'
    return '低'
