# routes/monitor_routes.py
import logging
from flask import Blueprint, request
from api_utils import api_response
from services.monitor_service import monitor_service

monitor_bp = Blueprint('monitor', __name__)
logger = logging.getLogger(__name__)

@monitor_bp.route('/api/notifications', methods=['GET'])
def get_notifications():
    """获取通知列表"""
    limit = request.args.get('limit', 50, type=int)
    notification_type = request.args.get('type')
    read_status = request.args.get('read_status')
    keyword = request.args.get('keyword')
    return api_response(True, data=monitor_service.get_notification_inbox(limit, notification_type, read_status, keyword))

@monitor_bp.route('/api/notifications', methods=['POST'])
def create_notification():
    """人工创建通知"""
    data = request.json or {}
    monitor_service.create_notification(data)
    return api_response(True, message='通知已创建')

@monitor_bp.route('/api/notifications/<int:nid>/read', methods=['POST'])
def mark_notification_read(nid):
    """标记单条已读"""
    monitor_service.mark_as_read(nid)
    return api_response(True, message='通知已标记为已读')

@monitor_bp.route('/api/notifications/read-all', methods=['POST'])
def mark_all_notifications_read():
    """标记全部已读"""
    monitor_service.mark_as_read()
    return api_response(True, message='全部通知已标记为已读')

@monitor_bp.route('/api/notifications/unread-count', methods=['GET'])
def get_unread_count():
    """获取未读数"""
    return api_response(True, data={'count': monitor_service.get_unread_count()})

@monitor_bp.route('/api/notifications/<int:nid>', methods=['DELETE'])
def delete_notification(nid):
    """删除单条通知"""
    monitor_service.delete_notifications(nid)
    return api_response(True, message='通知已删除')

@monitor_bp.route('/api/notifications/delete-all', methods=['DELETE'])
def delete_all_notifications():
    """清空通知"""
    monitor_service.delete_notifications()
    return api_response(True, message='通知已清空')

@monitor_bp.route('/api/check-and-create-reminders', methods=['POST'])
def check_and_create_reminders():
    """执行预警扫描"""
    try:
        created = monitor_service.check_and_create_reminders()
        return api_response(True, data={'created': created})
    except Exception as e:
        logger.exception("Check-and-create-reminders Error")
        return api_response(False, message=str(e), code=500)
