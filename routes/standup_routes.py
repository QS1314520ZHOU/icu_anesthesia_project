# routes/standup_routes.py
"""
每日站会助手 + AI简报推送 路由
"""

import os
from flask import Blueprint, request, jsonify, send_file
from services.standup_service import standup_service
from services.report_generation_service import report_gen_service
from datetime import datetime

standup_bp = Blueprint('standup', __name__)


@standup_bp.route('/api/standup/<int:project_id>/data', methods=['GET'])
def get_standup_data(project_id):
    """获取指定项目的站会数据"""
    date_str = request.args.get('date')
    try:
        data = standup_service.get_standup_data(project_id, date_str)
        if data is None:
            return jsonify({'error': '项目不存在'}), 404
        return jsonify(data)
    except Exception as e:
        print(f"Standup Data Error: {e}")
        return jsonify({'error': str(e)}), 500


@standup_bp.route('/api/standup/<int:project_id>/ai-generate', methods=['POST'])
def generate_ai_standup(project_id):
    """AI 生成站会纪要"""
    data = request.json or {}
    date_str = data.get('date')
    try:
        result = standup_service.generate_ai_standup(project_id, date_str)
        if result.get('error') and not result.get('data'):
            return jsonify(result), 404
        return jsonify(result)
    except Exception as e:
        print(f"AI Standup Error: {e}")
        return jsonify({'error': str(e)}), 500


@standup_bp.route('/api/standup/daily-briefing', methods=['GET'])
def get_daily_briefing():
    """获取全局每日简报（汇总所有活跃项目）"""
    try:
        result = standup_service.generate_daily_briefing()
        return jsonify(result)
    except Exception as e:
        print(f"Daily Briefing Error: {e}")
        return jsonify({'error': str(e), 'briefing': '生成简报失败'}), 500


@standup_bp.route('/api/standup/push-wecom', methods=['POST'])
def push_briefing_to_wecom():
    """推送每日简报到企业微信"""
    try:
        result = standup_service.push_briefing_to_wecom()
        return jsonify(result)
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"WeChat Push Error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500


@standup_bp.route('/api/standup/<int:project_id>/push-wecom', methods=['POST'])
def push_project_standup_to_wecom(project_id):
    """推送单个项目的站会纪要到企业微信"""
    data = request.json or {}
    date_str = data.get('date')
    try:
        result = standup_service.generate_ai_standup(project_id, date_str)
        standup_text = result.get('standup')
        
        if not standup_text:
            return jsonify({'success': False, 'message': 'AI生成纪要失败，无法推送'})
        
        from services.monitor_service import monitor_service
        project_name = result.get('data', {}).get('project', {}).get('project_name', '未知项目')
        title = f"📋 站会纪要 - {project_name}"
        ok, msg = monitor_service.send_wecom_message(title, standup_text, msg_type='markdown')
        
        return jsonify({
            'success': ok,
            'message': '已推送到企业微信' if ok else f'推送失败: {msg}',
            'standup': standup_text
        })
    except Exception as e:
        print(f"Project WeChat Push Error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500


@standup_bp.route('/api/standup/history', methods=['GET'])
def get_standup_history():
    """获取站会纪要的归档历史（从 report_archive 表读取）"""
    project_id = request.args.get('project_id', type=int)
    limit = request.args.get('limit', 20, type=int)
    
    try:
        from database import DatabasePool
        with DatabasePool.get_connection() as conn:
            # 从 report_archive 查找站会纪要类型的归档
            query = '''
                SELECT id, project_id, report_type, report_date, content, generated_by, created_at
                FROM report_archive
                WHERE report_type = 'standup'
            '''
            params = []
            
            if project_id:
                query += ' AND project_id = ?'
                params.append(project_id)
            
            query += ' ORDER BY report_date DESC LIMIT ?'
            params.append(limit)
            
            sql = DatabasePool.format_sql(query)
            rows = conn.execute(sql, params).fetchall()
            
            return jsonify([dict(r) for r in rows])
    except Exception as e:
        print(f"Standup History Error: {e}")
        return jsonify([])


@standup_bp.route('/api/standup/<int:project_id>/save', methods=['POST'])
def save_standup_archive(project_id):
    """保存站会纪要到归档"""
    data = request.json or {}
    content = data.get('content', '')
    date_str = data.get('date', datetime.now().strftime('%Y-%m-%d'))
    
    if not content:
        return jsonify({'success': False, 'message': '纪要内容不能为空'}), 400
    
    try:
        from database import DatabasePool
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('''
                INSERT INTO report_archive (project_id, report_type, report_date, content, generated_by, created_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT (project_id, report_type, report_date) DO UPDATE SET
                    content = EXCLUDED.content,
                    created_at = EXCLUDED.created_at
            ''')
            conn.execute(sql, (project_id, 'standup', date_str, content, 'ai'))
            conn.commit()
        
        return jsonify({'success': True, 'message': '纪要已保存'})
    except Exception as e:
        print(f"Save Standup Error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500


@standup_bp.route('/api/standup/wecom-config', methods=['GET'])
def get_wecom_config():
    """获取企业微信配置状态"""
    from database import DatabasePool
    webhook = ""
    enabled = False
    
    with DatabasePool.get_connection() as conn:
        # 尝试从数据库获取
        row = conn.execute(DatabasePool.format_sql("SELECT value FROM system_config WHERE config_key = 'wecom_webhook'")).fetchone()
        if row:
            webhook = row['value']
        
        row = conn.execute(DatabasePool.format_sql("SELECT value FROM system_config WHERE config_key = 'wecom_enabled'")).fetchone()
        if row:
            enabled = row['value'] == 'true'
            
    # 如果数据库没由，尝试读环境变量（首次初始化）
    if not webhook:
        from app_config import NOTIFICATION_CONFIG
        import os
        webhook = NOTIFICATION_CONFIG.get('WECOM_WEBHOOK') or os.environ.get('WECOM_WEBHOOK', '')
        enabled = NOTIFICATION_CONFIG.get('ENABLE_WECOM', False)
    
    return jsonify({
        'configured': bool(webhook),
        'enabled': enabled,
        'webhook_preview': webhook[:24] + '...' if len(webhook) > 24 else webhook if webhook else ''
    })


@standup_bp.route('/api/standup/wecom-config', methods=['POST'])
def update_wecom_config():
    """更新企业微信配置"""
    data = request.json or {}
    webhook = data.get('webhook', '').strip()
    enabled = data.get('enabled', False)
    
    from app_config import NOTIFICATION_CONFIG
    from database import DatabasePool
    
    with DatabasePool.get_connection() as conn:
        # 如果提交的是带有省略号的预览值，则不更新数据库中的真实 Webhook
        if '...' in webhook:
            sql_get = DatabasePool.format_sql("SELECT value FROM system_config WHERE config_key = ?")
            row = conn.execute(sql_get, ('wecom_webhook',)).fetchone()
            if row:
                webhook = row['value'] # 恢复为数据库中的全量值
        
        # 写入数据库 system_config
        sql_webhook = DatabasePool.format_sql('''
            INSERT INTO system_config (config_key, value, updated_at) 
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT (config_key) DO UPDATE SET 
                value = EXCLUDED.value, 
                updated_at = EXCLUDED.updated_at
        ''')
        conn.execute(sql_webhook, ('wecom_webhook', webhook))
        
        sql_enabled = DatabasePool.format_sql('''
            INSERT INTO system_config (config_key, value, updated_at) 
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT (config_key) DO UPDATE SET 
                value = EXCLUDED.value, 
                updated_at = EXCLUDED.updated_at
        ''')
        conn.execute(sql_enabled, ('wecom_enabled', 'true' if enabled else 'false'))
        conn.commit()
    
    # 同步更新内存配置
    NOTIFICATION_CONFIG['WECOM_WEBHOOK'] = webhook
    NOTIFICATION_CONFIG['ENABLE_WECOM'] = bool(enabled)
    
    return jsonify({
        'success': True,
        'message': '企业微信配置已更新并持久化' + ('（已启用）' if enabled else '（已禁用）')
    })

@standup_bp.route('/api/projects/<int:project_id>/export-formal-report', methods=['GET'])
def export_formal_report(project_id):
    """导出 AI 正式项目报告 (Word)"""
    # report_type = request.args.get('type', 'project_status')
    try:
        file_path = report_gen_service.generate_formal_report(project_id)
        if not file_path:
            return jsonify({'error': '生成报告失败'}), 500
            
        file_name = os.path.basename(file_path)
        return send_file(file_path, as_attachment=True, download_name=file_name)
    except Exception as e:
        print(f"Export Formal Report Error: {e}")
        return jsonify({'error': str(e)}), 500
