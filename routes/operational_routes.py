from flask import Blueprint, request
from services.analytics_service import analytics_service
from services.ai_insight_service import AIInsightService
from services.project_service import project_service
from utils.response_utils import api_response

operational_bp = Blueprint('operational', __name__, url_prefix='/api/operational')

@operational_bp.route('/stage-baselines', methods=['GET'])
def get_stage_baselines():
    """获取系统中各阶段的基准工期统计"""
    baselines = analytics_service.get_stage_baselines()
    return api_response(True, baselines)

@operational_bp.route('/analyze-change', methods=['POST'])
def analyze_change():
    """需求变更影响分析"""
    data = request.json
    project_id = data.get('project_id')
    description = data.get('description')
    
    if not project_id or not description:
        return api_response(False, message="缺少项目ID或变更描述")
        
    analysis = AIInsightService.analyze_demand_change(project_id, description)
    return api_response(True, analysis)

@operational_bp.route('/projects/<int:project_id>/impact-chain', methods=['GET'])
def get_impact_chain(project_id):
    """获取项目的变更波及链 (可视化配套)"""
    # 这里可以复用之前的 RiskSimulationService，但针对变更场景进行包装
    from services.risk_simulation_service import RiskSimulationService
    
    # 假设变更导致当前最晚阶段延期 5 天
    # 这里逻辑可以根据实际变更调整
    impact = RiskSimulationService.calculate_impact_chain(project_id, None, 5)
    return api_response(True, impact)
