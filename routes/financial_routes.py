
from flask import Blueprint, jsonify
from services.financial_service import financial_service
from api_utils import api_response

financial_bp = Blueprint('financial', __name__, url_prefix='/api')

@financial_bp.route('/projects/<int:project_id>/financials', methods=['GET'])
def get_project_financials(project_id):
    """获取项目财务汇总数据"""
    data = financial_service.get_project_financials(project_id)
    if 'error' in data:
        return api_response(success=False, message=data['error'])
    return api_response(success=True, data=data)

@financial_bp.route('/projects/<int:project_id>/financial-costs', methods=['GET'])
def get_member_costs(project_id):
    """获取项目成员成本分布"""
    data = financial_service.get_member_costs(project_id)
    return api_response(success=True, data=data)
