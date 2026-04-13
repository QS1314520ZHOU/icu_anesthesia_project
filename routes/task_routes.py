from flask import Blueprint, request
from database import DatabasePool
from services.auth_service import auth_service
from services.project_service import project_service
from services.wecom_push_service import wecom_push_service
from utils.response_utils import api_response

task_bp = Blueprint('task', __name__, url_prefix='/api')


def _current_user():
    return getattr(request, 'current_user', None) or {}


def _ensure_issue_access(issue_id: int):
    user = _current_user()
    if not user:
        raise PermissionError('未登录')
    if user.get('role') == 'admin':
        return
    with DatabasePool.get_connection() as conn:
        row = conn.execute(DatabasePool.format_sql('SELECT project_id FROM issues WHERE id = ?'), (issue_id,)).fetchone()
        project_id = row['project_id'] if row else None
    if not project_id or not auth_service.can_access_project(user.get('id'), project_id):
        raise PermissionError('当前账号无权访问该项目问题')

@task_bp.route('/stages/<int:stage_id>', methods=['PUT'])
def update_stage(stage_id):
    data = request.json or {}
    project_service.update_stage(stage_id, data)
    return api_response(True)

@task_bp.route('/tasks/<int:task_id>/toggle', methods=['POST'])
def toggle_task(task_id):
    project_service.toggle_task(task_id)
    return api_response(True)

@task_bp.route('/stages/<int:stage_id>/tasks', methods=['POST'])
def add_task(stage_id):
    data = request.json or {}
    project_service.add_task(stage_id, data)
    return api_response(True)

@task_bp.route('/tasks/<int:task_id>', methods=['DELETE'])
def delete_task(task_id):
    project_service.delete_task(task_id)
    return api_response(True)

@task_bp.route('/tasks/<int:task_id>', methods=['PUT'])
def update_task(task_id):
    data = request.json or {}
    success = project_service.update_task(task_id, data)
    return api_response(bool(success))

@task_bp.route('/issues/<int:issue_id>', methods=['PUT', 'DELETE'])
def update_issue(issue_id):
    if request.method == 'DELETE':
        project_service.delete_issue(issue_id)
        return api_response(True)
    data = request.json or {}
    project_service.update_issue(issue_id, data)
    return api_response(True)

@task_bp.route('/issues/<int:issue_id>/push-wecom', methods=['POST'])
def push_issue_wecom(issue_id):
    try:
        _ensure_issue_access(issue_id)
        result = wecom_push_service.push_issue_to_rnd_and_onsite(issue_id, trigger='manual')
        return api_response(bool(result.get('success')), data=result, message=result.get('message', ''))
    except PermissionError as e:
        return api_response(False, message=str(e), code=403)
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@task_bp.route('/issues/<int:issue_id>/push-receipts', methods=['GET'])
def get_issue_push_receipts(issue_id):
    try:
        _ensure_issue_access(issue_id)
        receipts = wecom_push_service.get_issue_push_receipts(issue_id, limit=request.args.get('limit', 10, type=int))
        return api_response(True, data=receipts)
    except PermissionError as e:
        return api_response(False, message=str(e), code=403)
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@task_bp.route('/devices/<int:device_id>', methods=['PUT', 'DELETE'])
def update_device(device_id):
    if request.method == 'DELETE':
        project_service.delete_device(device_id)
        return api_response(True)
    data = request.json or {}
    project_service.update_device(device_id, data)
    return api_response(True)
