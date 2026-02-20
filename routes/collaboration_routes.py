
from flask import Blueprint, request, jsonify
from services.onboarding_service import onboarding_service
from services.ai_insight_service import ai_insight_service
from utils.response_utils import api_response

collab_bp = Blueprint('collaboration', __name__, url_prefix='/api/collab')

@collab_bp.route('/snapshot/<int:project_id>', methods=['GET'])
def get_project_snapshot(project_id):
    content = onboarding_service.generate_project_snapshot(project_id)
    if content:
        return api_response(True, content)
    return api_response(False, error="Failed to generate snapshot")

@collab_bp.route('/parse-multi-logs', methods=['POST'])
def parse_multi_logs():
    data = request.json
    raw_text = data.get('raw_text')
    if not raw_text:
        return api_response(False, error="Missing raw_text")
    
    logs = ai_insight_service.parse_multi_logs(raw_text)
    return api_response(True, logs)

@collab_bp.route('/meeting-actions', methods=['POST'])
def extract_meeting_actions():
    data = request.json
    transcript = data.get('transcript')
    if not transcript:
        return api_response(False, error="Missing transcript")
    
    content = ai_insight_service.extract_meeting_minutes(transcript)
    return api_response(True, content)
