from flask import Blueprint, request
from services.project_service import project_service
from utils.response_utils import api_response

task_bp = Blueprint('task', __name__, url_prefix='/api')

@task_bp.route('/stages/<int:stage_id>', methods=['PUT'])
def update_stage(stage_id):
    data = request.json
    project_service.update_stage(stage_id, data)
    return api_response(True)

@task_bp.route('/tasks/<int:task_id>/toggle', methods=['POST'])
def toggle_task(task_id):
    project_service.toggle_task(task_id)
    return api_response(True)

@task_bp.route('/stages/<int:stage_id>/tasks', methods=['POST'])
def add_task(stage_id):
    data = request.json
    project_service.add_task(stage_id, data)
    return api_response(True)

@task_bp.route('/tasks/<int:task_id>', methods=['DELETE'])
def delete_task(task_id):
    project_service.delete_task(task_id)
    return api_response(True)

@task_bp.route('/issues/<int:issue_id>', methods=['PUT', 'DELETE'])
def update_issue(issue_id):
    if request.method == 'DELETE':
        project_service.delete_issue(issue_id)
        return api_response(True)
    data = request.json
    project_service.update_issue(issue_id, data)
    return api_response(True)

@task_bp.route('/devices/<int:device_id>', methods=['PUT', 'DELETE'])
def update_device(device_id):
    if request.method == 'DELETE':
        project_service.delete_device(device_id)
        return api_response(True)
    data = request.json
    project_service.update_device(device_id, data)
    return api_response(True)
