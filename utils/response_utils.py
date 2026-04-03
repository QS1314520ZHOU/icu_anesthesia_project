from api_utils import api_response as unified_api_response


def api_response(success, data=None, error=None, code=200, message=None):
    """
    兼容旧接口签名，统一转发到 api_utils.api_response。

    兼容场景：
    - api_response(True, data)
    - api_response(False, error="...")
    - api_response(False, None, "...")
    - api_response(False, message="...")
    """
    final_message = message if message is not None else (error or "")
    return unified_api_response(success=success, data=data, message=final_message, code=code)
