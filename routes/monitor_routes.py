# routes/monitor_routes.py
import logging
from flask import Blueprint, request
from api_utils import api_response
from services.monitor_service import monitor_service
from services.warning_service import warning_service
from database import DatabasePool

monitor_bp = Blueprint('monitor', __name__)
logger = logging.getLogger(__name__)

@monitor_bp.route('/api/notifications', methods=['GET'])
def get_notifications():
    """获取通知列表"""
    limit = request.args.get('limit', 50, type=int)
    notification_type = request.args.get('type')
    read_status = request.args.get('read_status')
    keyword = request.args.get('keyword')
    current_user = getattr(request, 'current_user', None) or {}
    user_id = current_user.get('id')
    return api_response(True, data=monitor_service.get_notification_inbox(limit, notification_type, read_status, keyword, user_id=user_id))

@monitor_bp.route('/api/notifications', methods=['POST'])
def create_notification():
    """人工创建通知"""
    data = request.json or {}
    monitor_service.create_notification(data)
    return api_response(True, message='通知已创建')

@monitor_bp.route('/api/notifications/<int:nid>/read', methods=['POST'])
def mark_notification_read(nid):
    """标记单条已读"""
    current_user = getattr(request, 'current_user', None) or {}
    monitor_service.mark_as_read(nid, user_id=current_user.get('id'))
    return api_response(True, message='通知已标记为已读')

@monitor_bp.route('/api/notifications/read-all', methods=['POST'])
def mark_all_notifications_read():
    """标记全部已读"""
    current_user = getattr(request, 'current_user', None) or {}
    monitor_service.mark_as_read(user_id=current_user.get('id'))
    return api_response(True, message='全部通知已标记为已读')

@monitor_bp.route('/api/notifications/unread-count', methods=['GET'])
def get_unread_count():
    """获取未读数"""
    current_user = getattr(request, 'current_user', None) or {}
    return api_response(True, data={'count': monitor_service.get_unread_count(user_id=current_user.get('id'))})

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

@monitor_bp.route('/api/warnings', methods=['GET'])
def get_warnings():
    """获取预警汇总（自动过滤已关闭项）"""
    return api_response(True, data=warning_service.get_warning_summary())

@monitor_bp.route('/api/warnings/dismiss', methods=['POST'])
def dismiss_warning():
    """关闭/确认某条预警，避免重复提醒"""
    data = request.json or {}
    warning_key = (data.get('warning_key') or '').strip()
    if not warning_key:
        return api_response(False, message='warning_key 不能为空', code=400)
    current_user = getattr(request, 'current_user', None) or {}
    with DatabasePool.get_connection() as conn:
        sql = DatabasePool.format_sql('''
            INSERT INTO warning_dismissals (warning_key, project_id, dismissed_by, note)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (warning_key) DO UPDATE SET
                dismissed_by = EXCLUDED.dismissed_by,
                dismissed_at = CURRENT_TIMESTAMP,
                note = EXCLUDED.note
        ''')
        conn.execute(sql, (
            warning_key,
            data.get('project_id'),
            current_user.get('display_name') or current_user.get('username') or '系统',
            data.get('note', '')
        ))
        conn.commit()
    return api_response(True, message='预警已关闭')

@monitor_bp.route('/api/warnings/dismiss', methods=['DELETE'])
def restore_warning():
    """恢复已关闭预警，使其重新参与扫描显示。"""
    data = request.json or {}
    warning_key = (data.get('warning_key') or '').strip()
    if not warning_key:
        return api_response(False, message='warning_key 不能为空', code=400)
    with DatabasePool.get_connection() as conn:
        conn.execute(
            DatabasePool.format_sql('DELETE FROM warning_dismissals WHERE warning_key = ?'),
            (warning_key,)
        )
        conn.commit()
    return api_response(True, message='预警已恢复')

@monitor_bp.route('/api/notifications/routing-config', methods=['GET'])
def get_notification_routing_config():
    """获取通知分发规则配置。"""
    with DatabasePool.get_connection() as conn:
        rows = conn.execute(DatabasePool.format_sql('''
            SELECT config_key, value
            FROM system_config
            WHERE config_key IN ('notification_route_danger', 'notification_route_warning', 'notification_route_info')
        ''')).fetchall()
    data = {
        'danger': 'project_manager,admin',
        'warning': 'project_manager',
        'info': 'project_manager'
    }
    for row in rows:
        key = row['config_key'].replace('notification_route_', '')
        data[key] = row['value']
    return api_response(True, data=data)

@monitor_bp.route('/api/notifications/routing-config', methods=['POST'])
def save_notification_routing_config():
    """保存通知分发规则配置。"""
    payload = request.json or {}
    allowed_keys = ('danger', 'warning', 'info')
    with DatabasePool.get_connection() as conn:
        for key in allowed_keys:
            if key not in payload:
                continue
            value = str(payload.get(key) or '').strip() or 'project_manager'
            conn.execute(DatabasePool.format_sql('''
                INSERT INTO system_config (config_key, value, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(config_key) DO UPDATE SET
                    value = EXCLUDED.value,
                    updated_at = CURRENT_TIMESTAMP
            '''), (f'notification_route_{key}', value))
        conn.commit()
    return api_response(True, message='通知分发规则已保存')
