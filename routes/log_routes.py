from flask import Blueprint, request
from services.log_service import log_service
from services.quick_report_service import quick_report_service
from utils.response_utils import api_response

log_bp = Blueprint('log', __name__, url_prefix='/api')


@log_bp.route('/quick-report', methods=['POST'])
def quick_report():
    data = request.json or {}
    try:
        result = quick_report_service.submit(
            content=data.get('content', ''),
            project_id=data.get('project_id'),
            engineer_name=data.get('engineer_name', ''),
            wecom_userid=data.get('wecom_userid', ''),
            source=data.get('source', 'web'),
        )
        return api_response(True, result, result.get('message', '已保存'))
    except ValueError as exc:
        return api_response(False, message=str(exc), code=400)
    except Exception as exc:
        return api_response(False, message=f'一句话上报失败：{exc}', code=500)

# --- Work Logs ---
@log_bp.route('/projects/<int:project_id>/worklogs', methods=['GET'])
def get_work_logs(project_id):
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    logs = log_service.get_work_logs(project_id, start_date, end_date)
    return api_response(True, logs)

@log_bp.route('/projects/<int:project_id>/worklogs', methods=['POST'])
def add_work_log(project_id):
    data = request.json or {}
    log_service.add_work_log(project_id, data)
    return api_response(True)

@log_bp.route('/worklogs/<int:log_id>', methods=['PUT'])
def update_work_log(log_id):
    data = request.json or {}
    log_service.update_work_log(log_id, data)
    return api_response(True)

@log_bp.route('/worklogs/<int:log_id>', methods=['DELETE'])
def delete_work_log(log_id):
    log_service.delete_work_log(log_id)
    return api_response(True)

@log_bp.route('/projects/<int:project_id>/worklogs/stats', methods=['GET'])
def get_work_log_stats(project_id):
    stats = log_service.get_work_log_stats(project_id)
    return api_response(True, stats)

# --- Departures ---
@log_bp.route('/projects/<int:project_id>/departures', methods=['GET'])
def get_project_departures(project_id):
    departures = log_service.get_project_departures(project_id)
    return api_response(True, departures)

@log_bp.route('/projects/<int:project_id>/departures', methods=['POST'])
def add_project_departure(project_id):
    data = request.json or {}
    log_service.add_project_departure(project_id, data)
    return api_response(True)

@log_bp.route('/departures/<int:departure_id>', methods=['PUT'])
def update_project_departure(departure_id):
    data = request.json or {}
    log_service.update_project_departure(departure_id, data)
    return api_response(True)

@log_bp.route('/departures/<int:departure_id>/return', methods=['POST'])
def record_return(departure_id):
    data = request.json or {}
    log_service.record_return(departure_id, data)
    return api_response(True)

@log_bp.route('/departures/<int:departure_id>', methods=['DELETE'])
def delete_departure(departure_id):
    log_service.delete_departure(departure_id)
    return api_response(True)
