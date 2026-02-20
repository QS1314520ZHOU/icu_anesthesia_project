
from flask import Blueprint, request, jsonify
from services.risk_simulation_service import risk_simulation_service
from services.ai_insight_service import ai_insight_service
from utils.response_utils import api_response

risk_bp = Blueprint('risk_simulation', __name__, url_prefix='/api/risk')

@risk_bp.route('/simulate', methods=['GET'])
def simulate_risk():
    project_id = request.args.get('project_id', type=int)
    task_id = request.args.get('task_id', type=int)
    delay_days = request.args.get('delay_days', default=3, type=int)
    
    if not project_id or not task_id:
        return api_response(False, error="Missing project_id or task_id")
        
    result = risk_simulation_service.calculate_impact_chain(project_id, task_id, delay_days)
    if result:
        return api_response(True, result)
    return api_response(False, error="Simulation failed")

@risk_bp.route('/countdown/<int:project_id>', methods=['GET'])
def get_death_countdown(project_id):
    prediction = ai_insight_service.predict_future_risks(project_id)
    if not prediction:
        return api_response(False, error="Failed to get prediction data")
    
    # 构建倒计时语义
    # 假设如果延期天数 > 0, 则是违约风险
    # 距离原定交付日期的天数
    from datetime import datetime
    try:
        if prediction['plan_end_date']:
            plan_end = datetime.strptime(prediction['plan_end_date'], '%Y-%m-%d')
            remaining_days = (plan_end - datetime.now()).days
            
            prediction['remaining_days_to_plan'] = remaining_days
            prediction['countdown_status'] = "Critical" if remaining_days < 7 else "Normal"
            if prediction['is_delay_predicted']:
                prediction['countdown_status'] = "VioloationPredicted"
    except:
        pass
        
    return api_response(True, prediction)
