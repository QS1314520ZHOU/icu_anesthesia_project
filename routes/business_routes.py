from flask import Blueprint, request
from api_utils import api_response
from services.business_service import business_service


business_bp = Blueprint('business', __name__, url_prefix='/api/business')


@business_bp.route('/overview', methods=['GET'])
def get_business_overview():
    month_from = request.args.get('month_from')
    month_to = request.args.get('month_to')
    return api_response(True, data=business_service.get_overview(month_from=month_from, month_to=month_to))


@business_bp.route('/projects/<int:project_id>/metrics', methods=['GET'])
def list_project_metrics(project_id):
    return api_response(True, data=business_service.list_project_metrics(project_id))


@business_bp.route('/projects/<int:project_id>/summary', methods=['GET'])
def get_project_business_summary(project_id):
    result = business_service.get_project_summary(project_id)
    if not result:
        return api_response(False, message='项目不存在', code=404)
    return api_response(True, data=result)


@business_bp.route('/projects/<int:project_id>/metrics', methods=['POST'])
def save_project_metric(project_id):
    result = business_service.save_metric(project_id, request.json or {})
    if result.get('error'):
        return api_response(False, message=result['error'], code=400)
    return api_response(True, message='经营月报已保存')


@business_bp.route('/metrics/<int:metric_id>', methods=['DELETE'])
def delete_metric(metric_id):
    result = business_service.delete_metric(metric_id)
    if not result.get('success'):
        return api_response(False, message='经营月报不存在', code=404)
    return api_response(True, message='经营月报已删除')
