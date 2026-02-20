from flask import Blueprint, request, jsonify, current_app
import json
import os
from services.project_service import project_service
from utils.response_utils import api_response

project_bp = Blueprint('project', __name__, url_prefix='/api')

@project_bp.route('/templates/<template_id>', methods=['GET'])
def get_template(template_id):
    try:
        json_path = os.path.join(current_app.root_path, 'static', 'data', 'project_templates.json')
        if not os.path.exists(json_path):
            return api_response(False, None, 'Template file not found')
            
        with open(json_path, 'r', encoding='utf-8') as f:
            templates = json.load(f)
            
        template = next((t for t in templates if t['id'] == template_id), None)
        
        if template:
            return api_response(True, template)
        else:
            return api_response(False, None, 'Template not found')
    except Exception as e:
        return api_response(False, None, str(e))

@project_bp.route('/projects/geo', methods=['GET'])
def get_geo_stats():
    data = project_service.get_geo_stats()
    return api_response(True, data)

@project_bp.route('/projects', methods=['GET'])
def get_projects():
    # Placeholder for auth logic integration
    projects = project_service.get_all_projects(is_admin=True) 
    return api_response(True, projects)

@project_bp.route('/projects', methods=['POST'])
def create_project():
    data = request.json
    project_id = project_service.create_project(data)
    return api_response(True, {'project_id': project_id})

@project_bp.route('/projects/<int:project_id>', methods=['GET'])
def get_project_detail(project_id):
    project = project_service.get_project_detail(project_id)
    if not project:
        return api_response(False, error="Project not found", code=404)
    return api_response(True, project)

@project_bp.route('/projects/<int:project_id>/status', methods=['PUT'])
def update_project_status(project_id):
    data = request.json
    project_service.update_project_status(project_id, data.get('status'))
    return api_response(True)

@project_bp.route('/projects/<int:project_id>', methods=['DELETE'])
def delete_project(project_id):
    success = project_service.delete_project(project_id)
    return api_response(success)

# --- Stages ---
@project_bp.route('/projects/<int:project_id>/stages', methods=['POST'])
def add_stage(project_id):
    data = request.json
    try:
        project_service.add_stage(project_id, data)
        return api_response(True)
    except Exception as e:
        return api_response(False, error=str(e))

@project_bp.route('/projects/stages/<int:stage_id>/scale', methods=['POST'])
def update_stage_scale(stage_id):
    data = request.json
    try:
        success = project_service.update_stage_scale(stage_id, data.get('quantity', 0))
        return api_response(success)
    except Exception as e:
        return api_response(False, error=str(e))

# --- Milestones ---
@project_bp.route('/projects/<int:project_id>/milestones', methods=['GET'])
def get_milestones(project_id):
    milestones = project_service.get_milestones(project_id)
    return api_response(True, milestones)

@project_bp.route('/projects/<int:project_id>/milestones', methods=['POST'])
def add_milestone(project_id):
    data = request.json
    project_service.add_milestone(project_id, data)
    return api_response(True)

@project_bp.route('/projects/milestones/<int:mid>/toggle', methods=['POST'])
def toggle_milestone(mid):
    project_service.toggle_milestone(mid)
    return api_response(True)

@project_bp.route('/projects/milestones/<int:mid>', methods=['DELETE'])
def delete_milestone(mid):
    project_service.delete_milestone(mid)
    return api_response(True)

# --- Interfaces ---
@project_bp.route('/projects/<int:project_id>/interfaces', methods=['GET'])
def get_interfaces(project_id):
    interfaces = project_service.get_interfaces(project_id)
    return api_response(True, interfaces)

@project_bp.route('/projects/<int:project_id>/interfaces', methods=['POST'])
def add_interface(project_id):
    data = request.json
    project_service.add_interface(project_id, data)
    return api_response(True)

@project_bp.route('/projects/interfaces/<int:interface_id>', methods=['PUT'])
def update_interface(interface_id):
    data = request.json
    project_service.update_interface(interface_id, data)
    return api_response(True)

@project_bp.route('/projects/interfaces/<int:interface_id>', methods=['DELETE'])
def delete_interface(interface_id):
    project_service.delete_interface(interface_id)
    return api_response(True)

# --- Issues ---
@project_bp.route('/projects/<int:project_id>/issues', methods=['GET'])
def get_issues(project_id):
    issues = project_service.get_issues(project_id)
    return api_response(True, issues)

@project_bp.route('/projects/<int:project_id>/issues', methods=['POST'])
def add_issue(project_id):
    data = request.json
    project_service.add_issue(project_id, data)
    return api_response(True)

# --- Devices ---
@project_bp.route('/projects/<int:project_id>/devices', methods=['GET'])
def get_devices(project_id):
    devices = project_service.get_devices(project_id)
    return api_response(True, devices)

@project_bp.route('/projects/<int:project_id>/devices', methods=['POST'])
def add_device(project_id):
    data = request.json
    project_service.add_device(project_id, data)
    return api_response(True)

# --- Task Dependencies ---
@project_bp.route('/projects/<int:project_id>/dependencies', methods=['GET'])
def get_task_dependencies(project_id):
    deps = project_service.get_task_dependencies(project_id)
    return api_response(True, deps)

@project_bp.route('/projects/<int:project_id>/dependencies', methods=['POST'])
def add_task_dependency(project_id):
    data = request.json
    project_service.add_task_dependency(data)
    return api_response(True)

@project_bp.route('/projects/dependencies/<int:dep_id>', methods=['DELETE'])
def delete_task_dependency(dep_id):
    project_service.delete_task_dependency(dep_id)
    return api_response(True)

# --- Milestone Celebrations & Retrospectives ---
@project_bp.route('/projects/<int:project_id>/milestones/pending-celebrations', methods=['GET'])
def get_pending_celebrations(project_id):
    """获取待庆祝的里程碑"""
    milestones = project_service.get_pending_celebrations(project_id)
    return api_response(True, [dict(m) for m in milestones])

@project_bp.route('/projects/milestones/<int:mid>/celebrated', methods=['POST'])
def mark_celebrated(mid):
    """标记里程碑为已庆祝"""
    project_service.mark_milestone_celebrated(mid)
    return api_response(True)

@project_bp.route('/projects/<int:project_id>/milestones/clear-celebrations', methods=['POST'])
def clear_celebrations(project_id):
    """清除项目下的所有待庆祝里程碑状态"""
    project_service.clear_pending_celebrations(project_id)
    return api_response(True)

@project_bp.route('/projects/milestones/<int:mid>/retrospective', methods=['POST'])
def add_retrospective(mid):
    """添加里程碑复盘"""
    data = request.json
    project_service.add_milestone_retrospective(mid, data)
    return api_response(True)
