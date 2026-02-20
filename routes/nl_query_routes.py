
from flask import Blueprint, request, jsonify
from services.nl_query_service import nl_query_service
from api_utils import api_response

nl_query_bp = Blueprint('nl_query_v2', __name__, url_prefix='/api')

@nl_query_bp.route('/projects/<int:project_id>/ask', methods=['POST'])
def ask_ai(project_id):
    """自然语言查询 (Text-to-SQL)"""
    data = request.json
    question = data.get('question', '')
    
    if not question:
        return api_response(success=False, message="请输入问题")
    
    try:
        # 1. Convert to SQL
        sql, error = nl_query_service.convert_to_sql(project_id, question)
        if error:
            return api_response(success=False, message=error)
            
        # 2. Execute SQL
        result = nl_query_service.execute_query(project_id, sql)
        if 'error' in result:
             return api_response(success=False, message=result['error'], data={"sql": sql})
             
        return api_response(success=True, data=result)
        
    except Exception as e:
        return api_response(success=False, message=str(e))
