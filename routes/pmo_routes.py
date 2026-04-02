
from flask import Blueprint
from services.pmo_service import pmo_service
from api_utils import api_response

pmo_bp = Blueprint('pmo', __name__, url_prefix='/api/pmo')

@pmo_bp.route('/overview', methods=['GET'])
def get_pmo_overview():
    data = pmo_service.get_pmo_overview()
    return api_response(success=True, data=data)

@pmo_bp.route('/summary', methods=['GET'])
def get_pmo_summary():
    data = pmo_service.generate_pmo_summary()
    return api_response(success=True, data=data)
