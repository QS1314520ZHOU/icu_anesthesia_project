from flask import Blueprint, request
from services.member_service import member_service
from utils.response_utils import api_response

member_bp = Blueprint('member', __name__, url_prefix='/api')

@member_bp.route('/my/dashboard', methods=['GET'])
def get_my_dashboard():
    current_user = getattr(request, 'current_user', None)
    if not current_user:
        return api_response(False, message='未登录', code=401)
    return api_response(True, member_service.get_my_dashboard(current_user))

@member_bp.route('/ops/people-board', methods=['GET'])
def get_people_project_board():
    current_user = getattr(request, 'current_user', None)
    if not current_user:
        return api_response(False, message='未登录', code=401)
    silent_days = request.args.get('silent_days', 3, type=int)
    return api_response(True, member_service.get_people_project_board(current_user=current_user, silent_days=silent_days))

# --- Project Members ---
@member_bp.route('/projects/<int:project_id>/members', methods=['GET'])
def get_project_members(project_id):
    members = member_service.get_project_members(project_id)
    return api_response(True, members)

@member_bp.route('/projects/<int:project_id>/members', methods=['POST'])
def add_project_member(project_id):
    try:
        data = request.json or {}
        member_service.add_project_member(project_id, data)
        return api_response(True)
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@member_bp.route('/members/<int:member_id>', methods=['PUT'])
def update_project_member(member_id):
    try:
        data = request.json or {}
        member_service.update_project_member(member_id, data)
        return api_response(True)
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@member_bp.route('/members/<int:member_id>', methods=['DELETE'])
def delete_project_member(member_id):
    try:
        member_service.delete_project_member(member_id)
        return api_response(True)
    except Exception as e:
        return api_response(False, message=str(e), code=500)

# --- Customer Contacts ---
@member_bp.route('/projects/<int:project_id>/contacts', methods=['GET'])
def get_customer_contacts(project_id):
    contacts = member_service.get_customer_contacts(project_id)
    return api_response(True, contacts)

@member_bp.route('/projects/<int:project_id>/contacts', methods=['POST'])
def add_customer_contact(project_id):
    try:
        data = request.json or {}
        member_service.add_customer_contact(project_id, data)
        return api_response(True)
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@member_bp.route('/contacts/<int:contact_id>', methods=['PUT'])
def update_customer_contact(contact_id):
    try:
        data = request.json or {}
        member_service.update_customer_contact(contact_id, data)
        return api_response(True)
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@member_bp.route('/contacts/<int:contact_id>', methods=['DELETE'])
def delete_customer_contact(contact_id):
    try:
        member_service.delete_customer_contact(contact_id)
        return api_response(True)
    except Exception as e:
        return api_response(False, message=str(e), code=500)
