from flask import Blueprint, request
from services.member_service import member_service
from utils.response_utils import api_response

member_bp = Blueprint('member', __name__, url_prefix='/api')

# --- Project Members ---
@member_bp.route('/projects/<int:project_id>/members', methods=['GET'])
def get_project_members(project_id):
    members = member_service.get_project_members(project_id)
    return api_response(True, members)

@member_bp.route('/projects/<int:project_id>/members', methods=['POST'])
def add_project_member(project_id):
    data = request.json
    member_service.add_project_member(project_id, data)
    return api_response(True)

@member_bp.route('/members/<int:member_id>', methods=['PUT'])
def update_project_member(member_id):
    data = request.json
    member_service.update_project_member(member_id, data)
    return api_response(True)

@member_bp.route('/members/<int:member_id>', methods=['DELETE'])
def delete_project_member(member_id):
    member_service.delete_project_member(member_id)
    return api_response(True)

# --- Customer Contacts ---
@member_bp.route('/projects/<int:project_id>/contacts', methods=['GET'])
def get_customer_contacts(project_id):
    contacts = member_service.get_customer_contacts(project_id)
    return api_response(True, contacts)

@member_bp.route('/projects/<int:project_id>/contacts', methods=['POST'])
def add_customer_contact(project_id):
    data = request.json
    member_service.add_customer_contact(project_id, data)
    return api_response(True)

@member_bp.route('/contacts/<int:contact_id>', methods=['PUT'])
def update_customer_contact(contact_id):
    data = request.json
    member_service.update_customer_contact(contact_id, data)
    return api_response(True)

@member_bp.route('/contacts/<int:contact_id>', methods=['DELETE'])
def delete_customer_contact(contact_id):
    member_service.delete_customer_contact(contact_id)
    return api_response(True)
