
from flask import Blueprint, request, jsonify
from services.report_generation_service import report_gen_service
from utils.response_utils import api_response

report_bp = Blueprint('report', __name__, url_prefix='/api/reports')

@report_bp.route('/preview', methods=['GET'])
def get_report_preview():
    project_id = request.args.get('project_id', type=int)
    year = request.args.get('year', type=int)
    month = request.args.get('month', type=int)
    quarter = request.args.get('quarter', type=int)
    week = request.args.get('week', type=int)
    
    if not project_id or not year:
        return api_response(False, error="Missing required parameters")
    
    data = report_gen_service.get_period_report_data(project_id, year, month, quarter, week)
    if not data:
        return api_response(False, error="No data found for the given criteria")
    
    # 生成 AI 摘要
    summary = report_gen_service.generate_ai_business_summary(data)
    data['ai_summary'] = summary
    
    return api_response(True, data)

@report_bp.route('/export', methods=['GET'])
def export_report():
    project_id = request.args.get('project_id', type=int)
    report_type = request.args.get('type', 'project_status')
    
    if not project_id:
        return api_response(False, error="Missing project_id")
    
    file_path = report_gen_service.generate_formal_report(project_id, report_type)
    if not file_path:
        return api_response(False, error="Failed to generate report")
    
    # 在实际场景中，可以返回文件下载，这里返回路径供参考
    return api_response(True, {'file_path': file_path, 'file_name': file_path.split('\\')[-1]})
