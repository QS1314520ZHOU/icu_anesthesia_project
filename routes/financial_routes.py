
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

@financial_bp.route('/projects/<int:project_id>/revenue', methods=['POST'])
def add_revenue(project_id):
    """录入项目收入"""
    from flask import request
    data = request.json
    amount = data.get('amount')
    revenue_date = data.get('revenue_date')
    revenue_type = data.get('revenue_type', '合同款')
    description = data.get('description', '')
    
    if not amount:
        return api_response(success=False, message="金额不能为空")
    
    result = financial_service.add_revenue(project_id, amount, revenue_date, revenue_type, description)
    if 'error' in result:
        return api_response(success=False, message=result['error'])
    return api_response(success=True, message="收入录入成功")
