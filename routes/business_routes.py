from flask import Blueprint, request, Response
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

@business_bp.route('/export', methods=['GET'])
def export_business_data():
    month_from = request.args.get('month_from')
    month_to = request.args.get('month_to')
    csv_text = business_service.export_csv(month_from=month_from, month_to=month_to)
    filename = f"business_export_{month_from or 'all'}_{month_to or 'latest'}.csv"
    return Response(
        csv_text,
        mimetype='text/csv; charset=utf-8',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'}
    )

@business_bp.route('/receivables', methods=['GET'])
def get_receivable_watchlist():
    return api_response(True, data=business_service.get_receivable_watchlist())

@business_bp.route('/payment-milestones/<int:milestone_id>/collect-message', methods=['POST'])
def generate_collect_message(milestone_id):
    payload = request.json or {}
    style = payload.get('style', 'professional')
    result = business_service.generate_collection_message(milestone_id, style=style)
    if result.get('error'):
        return api_response(False, message=result['error'], code=404)
    return api_response(True, data=result)

@business_bp.route('/onsite-analytics', methods=['GET'])
def get_onsite_analytics():
    date_from = request.args.get('date_from')
    date_to = request.args.get('date_to')
    return api_response(True, data=business_service.get_onsite_analytics(date_from=date_from, date_to=date_to))

@business_bp.route('/release-forecast', methods=['GET'])
def get_release_forecast():
    months = request.args.get('months', 3, type=int)
    return api_response(True, data=business_service.get_release_forecast(months=months))

@business_bp.route('/profit-forecast', methods=['GET'])
def get_profit_forecast():
    project_id = request.args.get('project_id', type=int)
    return api_response(True, data=business_service.get_profit_forecast(project_id=project_id))

@business_bp.route('/opportunities', methods=['GET'])
def list_opportunities():
    stage = request.args.get('stage')
    status = request.args.get('status')
    return api_response(True, data=business_service.list_opportunities(stage=stage, status=status))

@business_bp.route('/opportunities', methods=['POST'])
def create_opportunity():
    opp_id = business_service.create_opportunity(request.json or {})
    return api_response(True, data={'id': opp_id})

@business_bp.route('/opportunities/<int:opp_id>', methods=['PUT'])
def update_opportunity(opp_id):
    ok = business_service.update_opportunity(opp_id, request.json or {})
    if not ok:
        return api_response(False, message='商机不存在', code=404)
    return api_response(True)

@business_bp.route('/opportunities/<int:opp_id>', methods=['DELETE'])
def delete_opportunity(opp_id):
    ok = business_service.delete_opportunity(opp_id)
    if not ok:
        return api_response(False, message='商机不存在', code=404)
    return api_response(True)

@business_bp.route('/customer-profiles', methods=['GET'])
def get_customer_profiles():
    return api_response(True, data=business_service.get_customer_profiles())

@business_bp.route('/pipeline-summary', methods=['GET'])
def get_pipeline_summary():
    return api_response(True, data=business_service.get_pipeline_summary())
