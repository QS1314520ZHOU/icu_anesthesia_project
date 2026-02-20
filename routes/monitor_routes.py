# routes/monitor_routes.py
from flask import Blueprint, request, jsonify
from services.monitor_service import monitor_service
from utils.response_utils import api_response

monitor_bp = Blueprint('monitor', __name__)

@monitor_bp.route('/api/notifications', methods=['GET'])
def get_notifications():
    """获取通知列表"""
    limit = request.args.get('limit', 50, type=int)
    return jsonify(monitor_service.get_notifications(limit))

@monitor_bp.route('/api/notifications', methods=['POST'])
def create_notification():
    """人工创建通知"""
    data = request.json
    monitor_service.create_notification(data)
    return jsonify({'success': True})

@monitor_bp.route('/api/notifications/<int:nid>/read', methods=['POST'])
def mark_notification_read(nid):
    """标记单条已读"""
    monitor_service.mark_as_read(nid)
    return jsonify({'success': True})

@monitor_bp.route('/api/notifications/read-all', methods=['POST'])
def mark_all_notifications_read():
    """标记全部已读"""
    monitor_service.mark_as_read()
    return jsonify({'success': True})

@monitor_bp.route('/api/notifications/unread-count', methods=['GET'])
def get_unread_count():
    """获取未读数"""
    return jsonify({'count': monitor_service.get_unread_count()})

@monitor_bp.route('/api/notifications/<int:nid>', methods=['DELETE'])
def delete_notification(nid):
    """删除单条通知"""
    monitor_service.delete_notifications(nid)
    return jsonify({'success': True})

@monitor_bp.route('/api/notifications/delete-all', methods=['DELETE'])
def delete_all_notifications():
    """清空通知"""
    monitor_service.delete_notifications()
    return jsonify({'success': True})

@monitor_bp.route('/api/check-and-create-reminders', methods=['POST'])
def check_and_create_reminders():
    """执行预警扫描"""
    try:
        created = monitor_service.check_and_create_reminders()
        return jsonify({'success': True, 'created': created})
    except Exception as e:
        print(f"Check-and-create-reminders Error: {e}")
        return jsonify({'success': True, 'created': [], 'error': str(e)})
