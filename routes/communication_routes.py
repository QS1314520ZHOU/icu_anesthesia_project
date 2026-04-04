from flask import Blueprint, request
from api_utils import api_response
from services.communication_service import communication_service


communication_bp = Blueprint('communication', __name__, url_prefix='/api')


@communication_bp.route('/projects/<int:project_id>/communications', methods=['GET'])
def list_project_communications(project_id):
    try:
        return api_response(True, communication_service.list_by_project(project_id))
    except Exception as e:
        return api_response(False, message=str(e), code=500)


@communication_bp.route('/communications/<int:record_id>', methods=['GET'])
def get_communication(record_id):
    try:
        record = communication_service.get_communication(record_id)
        if not record:
            return api_response(False, message='沟通记录不存在', code=404)
        return api_response(True, record)
    except Exception as e:
        return api_response(False, message=str(e), code=500)


@communication_bp.route('/projects/<int:project_id>/communications', methods=['POST'])
def create_communication(project_id):
    try:
        data = request.json or {}
        current_user = getattr(request, 'current_user', None) or {}
        data['created_by'] = current_user.get('display_name') or current_user.get('username') or data.get('created_by')
        record = communication_service.create_communication(project_id, data)
        return api_response(True, record, message='沟通记录添加成功')
    except ValueError as e:
        return api_response(False, message=str(e), code=400)
    except Exception as e:
        return api_response(False, message=str(e), code=500)


@communication_bp.route('/communications/<int:record_id>', methods=['PUT'])
def update_communication(record_id):
    try:
        record = communication_service.update_communication(record_id, request.json or {})
        if not record:
            return api_response(False, message='沟通记录不存在', code=404)
        return api_response(True, record, message='沟通记录更新成功')
    except ValueError as e:
        return api_response(False, message=str(e), code=400)
    except Exception as e:
        return api_response(False, message=str(e), code=500)


@communication_bp.route('/communications/<int:record_id>', methods=['DELETE'])
def delete_communication(record_id):
    try:
        deleted = communication_service.delete_communication(record_id)
        if not deleted:
            return api_response(False, message='沟通记录不存在', code=404)
        return api_response(True, message='记录已删除')
    except Exception as e:
        return api_response(False, message=str(e), code=500)
