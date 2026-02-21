from flask import Blueprint, jsonify
from services.ai_insight_service import ai_insight_service
from api_utils import api_response

ai_insight_bp = Blueprint('ai_insight', __name__)

@ai_insight_bp.route('/api/ai/daily-insight/<int:project_id>', methods=['GET'])
def get_daily_insight(project_id):
    """获取项目的AI每日建议"""
    from flask import request
    force_refresh = request.args.get('refresh') == '1'
    advice = ai_insight_service.generate_daily_advice(project_id, force_refresh=force_refresh)
    return api_response(success=True, data=advice)
@ai_insight_bp.route('/api/projects/<int:project_id>/risk-trends', methods=['GET'])
def get_risk_trends(project_id):
    """获取项目风险趋势分析数据"""
    data = ai_insight_service.analyze_trends(project_id)
    if 'error' in data:
        return api_response(success=False, message=data['error'])
    return api_response(success=True, data=data)

@ai_insight_bp.route('/api/projects/<int:project_id>/sentiment-analysis', methods=['POST'])
def analyze_sentiment(project_id):
    """(按需) 触发项目情感分析"""
    result = ai_insight_service.analyze_sentiment(project_id)
    if 'error' in result:
        return api_response(success=False, message=result['error'])
    return api_response(success=True, data=result)

@ai_insight_bp.route('/api/ai/parse-log', methods=['POST'])
def parse_work_log():
    """解析自然语言日报"""
    from flask import request
    data = request.json
    raw_text = data.get('raw_text', '')
    if not raw_text:
        return api_response(success=False, message="缺少输入文本")
    
    parsed = ai_insight_service.parse_work_log(raw_text)
    return api_response(success=True, data=parsed)

@ai_insight_bp.route('/api/projects/<int:project_id>/stale-items', methods=['GET'])
def get_stale_items(project_id):
    """获取项目中的滞后项"""
    items = ai_insight_service.get_stale_items(project_id)
    return api_response(success=True, data=items)

@ai_insight_bp.route('/api/ai/chaser/generate', methods=['POST'])
def generate_chaser():
    """生成催单/提醒文案"""
    from flask import request
    data = request.json
    if not data:
        return api_response(success=False, message="缺少参数")
    
    result = ai_insight_service.generate_chaser_message(data)
    return api_response(success=True, data=result)

@ai_insight_bp.route('/api/projects/<int:project_id>/recommended-actions', methods=['GET'])
def get_recommended_actions(project_id):
    """获取项目决策建议"""
    from flask import request
    force_refresh = request.args.get('refresh') == '1'
    actions = ai_insight_service.get_recommended_actions(project_id, force_refresh=force_refresh)
    return api_response(success=True, data=actions)

@ai_insight_bp.route('/api/ai/knowledge/extract', methods=['POST'])
def auto_extract_knowledge():
    """手动触发知识提取"""
    from flask import request
    data = request.json
    issue_id = data.get('issue_id')
    if not issue_id:
        return api_response(success=False, message="缺少 issue_id 参数")
    
    result = ai_insight_service.auto_extract_knowledge(issue_id)
    if not result['success']:
        return api_response(success=False, message=result['message'])
    return api_response(success=True, data=result)

@ai_insight_bp.route('/api/projects/<int:project_id>/similar', methods=['GET'])
def get_similar_projects(project_id):
    """获取相似项目"""
    projects = ai_insight_service.find_similar_projects(project_id)
    return api_response(success=True, data=projects)

@ai_insight_bp.route('/api/projects/<int:project_id>/predict', methods=['GET'])
def predict_project_risks(project_id):
    """获取预测性风险分析"""
    prediction = ai_insight_service.predict_future_risks(project_id)
    return api_response(success=True, data=prediction)

@ai_insight_bp.route('/api/ai/cruise', methods=['GET'])
def run_daily_cruise():
    """执行 AI 巡航 (全量项目体检)"""
    from services.cruise_service import cruise_service
    results = cruise_service.run_daily_cruise()
    return api_response(success=True, data=results)


