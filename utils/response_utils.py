from flask import jsonify

def api_response(success, data=None, error=None, code=200):
    """标准 API 响应格式"""
    response = {'success': success}
    if data is not None:
        response['data'] = data
    if error is not None:
        response['error'] = error
    return jsonify(response), code
