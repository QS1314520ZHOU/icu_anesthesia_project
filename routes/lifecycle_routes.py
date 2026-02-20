from flask import Blueprint, request
from services.lifecycle_service import lifecycle_service
from utils.response_utils import api_response

lifecycle_bp = Blueprint('lifecycle', __name__, url_prefix='/api')

# --- Changes ---
@lifecycle_bp.route('/projects/<int:project_id>/changes', methods=['GET'])
def get_project_changes(project_id):
    changes = lifecycle_service.get_project_changes(project_id)
    return api_response(True, changes)

@lifecycle_bp.route('/projects/<int:project_id>/changes', methods=['POST'])
def add_project_change(project_id):
    data = request.json
    lifecycle_service.add_project_change(project_id, data)
    return api_response(True)

@lifecycle_bp.route('/changes/<int:change_id>', methods=['PUT'])
def update_change(change_id):
    data = request.json
    lifecycle_service.update_change(change_id, data)
    return api_response(True)

@lifecycle_bp.route('/changes/<int:change_id>', methods=['DELETE'])
def delete_change(change_id):
    lifecycle_service.delete_change(change_id)
    return api_response(True)

# --- Acceptances ---
@lifecycle_bp.route('/projects/<int:project_id>/acceptances', methods=['GET'])
def get_project_acceptances(project_id):
    acceptances = lifecycle_service.get_project_acceptances(project_id)
    return api_response(True, acceptances)

@lifecycle_bp.route('/projects/<int:project_id>/acceptances', methods=['POST'])
def add_project_acceptance(project_id):
    data = request.json
    lifecycle_service.add_project_acceptance(project_id, data)
    return api_response(True)

@lifecycle_bp.route('/acceptances/<int:acceptance_id>', methods=['PUT'])
def update_acceptance(acceptance_id):
    data = request.json
    lifecycle_service.update_acceptance(acceptance_id, data)
    return api_response(True)

@lifecycle_bp.route('/acceptances/<int:acceptance_id>', methods=['DELETE'])
def delete_acceptance(acceptance_id):
    lifecycle_service.delete_acceptance(acceptance_id)
    return api_response(True)

# --- Satisfaction ---
@lifecycle_bp.route('/projects/<int:project_id>/satisfaction', methods=['GET'])
def get_customer_satisfaction(project_id):
    records = lifecycle_service.get_customer_satisfaction(project_id)
    return api_response(True, records)

@lifecycle_bp.route('/projects/<int:project_id>/satisfaction', methods=['POST'])
def add_customer_satisfaction(project_id):
    data = request.json
    lifecycle_service.add_customer_satisfaction(project_id, data)
    return api_response(True)

@lifecycle_bp.route('/satisfaction/<int:satisfaction_id>', methods=['DELETE'])
def delete_satisfaction(satisfaction_id):
    lifecycle_service.delete_satisfaction(satisfaction_id)
    return api_response(True)

@lifecycle_bp.route('/projects/<int:project_id>/satisfaction/stats', methods=['GET'])
def get_satisfaction_stats(project_id):
    stats = lifecycle_service.get_satisfaction_stats(project_id)
    return api_response(True, stats)

# --- Follow-ups ---
@lifecycle_bp.route('/projects/<int:project_id>/followups', methods=['GET'])
def get_follow_ups(project_id):
    records = lifecycle_service.get_follow_ups(project_id)
    return api_response(True, records)

@lifecycle_bp.route('/projects/<int:project_id>/followups', methods=['POST'])
def add_follow_up(project_id):
    data = request.json
    lifecycle_service.add_follow_up(project_id, data)
    return api_response(True)

@lifecycle_bp.route('/followups/<int:followup_id>', methods=['DELETE'])
def delete_follow_up(followup_id):
    lifecycle_service.delete_follow_up(followup_id)
    return api_response(True)
