from flask import jsonify
import decimal
from datetime import datetime, date

def api_response(success, data=None, error=None, code=200):
    """标准 API 响应格式，自动处理 Decimal 和 日期对象"""
    def serialize(obj):
        if isinstance(obj, list):
            return [serialize(i) for i in obj]
        if isinstance(obj, dict):
            return {k: serialize(v) for k, v in obj.items()}
        if isinstance(obj, decimal.Decimal):
            return float(obj)
        if isinstance(obj, (datetime, date)):
            return obj.isoformat()
        return obj

    response = {'success': success}
    if data is not None:
        response['data'] = serialize(data)
    if error is not None:
        response['error'] = error
    if not success and error:
        response['message'] = error
        
    return jsonify(response), code
