from flask import jsonify, request
from functools import wraps
from datetime import datetime
import time

def api_response(success=True, data=None, message="", code=200):
    """
    统一API响应格式
    """
    return jsonify({
        "success": success,
        "code": code,
        "message": message,
        "data": data,
        "timestamp": datetime.now().isoformat()
    }), code

def validate_json(*required_fields):
    """
    JSON请求参数验证装饰器
    """
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            if not request.is_json:
                return api_response(False, message="请求必须是JSON格式", code=400)
            data = request.json
            missing = [field for field in required_fields if field not in data]
            if missing:
                return api_response(False, message=f"缺少必填字段: {', '.join(missing)}", code=400)
            return f(*args, **kwargs)
        return wrapper
    return decorator

# 简单内存缓存
_cache_store = {}

def cached(ttl=300):
    """
    简单内存缓存装饰器
    """
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            # 构建缓存键：函数名 + 参数
            key = f"{f.__name__}:{str(args)}:{str(kwargs)}"
            
            if key in _cache_store:
                value, timestamp = _cache_store[key]
                if time.time() - timestamp < ttl:
                    return value
            
            result = f(*args, **kwargs)
            _cache_store[key] = (result, time.time())
            return result
        return wrapper
    return decorator

def clear_cache(pattern=None):
    """清除缓存"""
    global _cache_store
    if pattern:
        keys_to_delete = [k for k in _cache_store if pattern in k]
        for k in keys_to_delete:
            del _cache_store[k]
    else:
        _cache_store = {}
