# services/monitor_service.py
import requests
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta
from threading import Thread
from database import DatabasePool
from app_config import NOTIFICATION_CONFIG

class MonitorService:
    """监控与通知服务"""

    DEFAULT_ROUTING = {
        'danger': 'project_manager,admin',
        'warning': 'project_manager',
        'info': 'project_manager'
    }

    def _resolve_project_manager_user_id(self, conn, project_id):
        """根据项目经理姓名反查用户ID，用于通知定向。"""
        if not project_id:
            return None
        project = conn.execute(
            DatabasePool.format_sql('SELECT project_manager FROM projects WHERE id = ?'),
            (project_id,)
        ).fetchone()
        if not project:
            return None
        project = dict(project)
        manager = (project.get('project_manager') or '').strip()
        if not manager:
            return None
        user = conn.execute(DatabasePool.format_sql('''
            SELECT id FROM users
            WHERE display_name = ? OR username = ?
            ORDER BY id ASC
            LIMIT 1
        '''), (manager, manager)).fetchone()
        return user['id'] if user else None

    def _get_routing_rule(self, conn, notification_type):
        ntype = (notification_type or 'info').strip().lower()
        key = f'notification_route_{ntype}'
        row = conn.execute(
            DatabasePool.format_sql('SELECT value FROM system_config WHERE config_key = ?'),
            (key,)
        ).fetchone()
        if row and row.get('value'):
            return str(row['value'])
        return self.DEFAULT_ROUTING.get(ntype, 'project_manager')

    def _resolve_admin_user_ids(self, conn):
        rows = conn.execute(DatabasePool.format_sql('''
            SELECT id FROM users
            WHERE role = 'admin'
            ORDER BY id ASC
        ''')).fetchall()
        return [r['id'] for r in rows]

    def _resolve_target_user_ids(self, conn, project_id, notification_type, explicit_target_user_id=None):
        # 显式指定时优先
        if explicit_target_user_id is not None:
            if isinstance(explicit_target_user_id, list):
                ids = [int(x) for x in explicit_target_user_id if str(x).strip()]
                return ids or [None]
            try:
                return [int(explicit_target_user_id)]
            except Exception:
                return [None]

        rule = self._get_routing_rule(conn, notification_type)
        tokens = [t.strip().lower() for t in str(rule or '').split(',') if t.strip()]
        if not tokens:
            tokens = ['project_manager']

        target_ids = []
        if 'project_manager' in tokens:
            pm_uid = self._resolve_project_manager_user_id(conn, project_id)
            if pm_uid:
                target_ids.append(pm_uid)
        if 'admin' in tokens:
            target_ids.extend(self._resolve_admin_user_ids(conn))
        if 'broadcast' in tokens or 'all' in tokens:
            return [None]

        # 去重
        uniq = []
        for uid in target_ids:
            if uid not in uniq:
                uniq.append(uid)
        return uniq or [None]


    def send_wecom_message(self, title, content, msg_type='text', allow_fallback=True):
        """发送企业微信通知（优先自建应用，降级到Webhook）"""
        from services.wecom_service import wecom_service
        
        # 优先使用自建应用推送（支持定向、卡片等能力）
        if wecom_service.is_enabled:
            try:
                full_content = f"**{title}**\n\n{content}" if msg_type == 'markdown' else f"【{title}】\n{content}"
                result = wecom_service.send_markdown_to_all(full_content)
                if result.get('errcode') == 0:
                    return True, "通过自建应用推送成功"
            except Exception as e:
                import logging
                logger = logging.getLogger(__name__)
                logger.warning("自建应用推送失败，降级到Webhook: %s", e)
        
        # 降级：Webhook（原有逻辑）
        if not allow_fallback:
            return False, "自建应用推送失败，且禁用了 Webhook 兜底"

        if not NOTIFICATION_CONFIG.get('ENABLE_WECOM') or not NOTIFICATION_CONFIG.get('WECOM_WEBHOOK'):
            return False, "企业微信通知未启用或未配置"
        try:
            webhook_url = NOTIFICATION_CONFIG['WECOM_WEBHOOK']
            if msg_type == 'markdown':
                payload = {"msgtype": "markdown", "markdown": {"content": f"## {title}\n\n{content}"}}
            else:
                payload = {"msgtype": "text", "text": {"content": f"【{title}】\n{content}"}}
            
            for attempt in range(3):
                try:
                    response = requests.post(webhook_url, json=payload, timeout=30)
                    result = response.json()
                    if result.get('errcode') == 0:
                        return True, result.get('errmsg', 'ok')
                    else:
                        return False, f"WeChat API Error: {result.get('errmsg')}"
                except requests.exceptions.Timeout:
                    if attempt == 2:
                        return False, "WeChat API Timeout (3 attempts)"
                    continue
                except Exception as e:
                    return False, str(e)
            
            return False, "Unknown error after retries"
        except Exception as e:
            return False, str(e)

    def send_email(self, subject, html_content, to_emails=None):
        """发送邮件通知"""
        if not NOTIFICATION_CONFIG.get('ENABLE_EMAIL'):
            return False, "邮件通知未启用"
        if not NOTIFICATION_CONFIG.get('SMTP_USER') or not NOTIFICATION_CONFIG.get('SMTP_PASSWORD'):
            return False, "邮件配置不完整"
        try:
            receivers = to_emails or NOTIFICATION_CONFIG.get('EMAIL_RECEIVERS', [])
            if not receivers:
                return False, "没有配置接收者邮箱"
            
            msg = MIMEMultipart('alternative')
            msg['Subject'] = f"【项目管理系统】{subject}"
            msg['From'] = NOTIFICATION_CONFIG['SMTP_USER']
            msg['To'] = ', '.join(receivers)
            
            html_body = f"""
            <html><head><style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                .header {{ background: linear-gradient(135deg, #4f46e5, #3730a3); color: white; padding: 20px; border-radius: 8px 8px 0 0; }}
                .content {{ background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }}
                .footer {{ background: #f3f4f6; padding: 15px; text-align: center; font-size: 12px; color: #6b7280; border-radius: 0 0 8px 8px; }}
            </style></head><body>
                <div class="container">
                    <div class="header"><h2 style="margin:0;">🏥 重症手麻项目管理系统</h2></div>
                    <div class="content">{html_content}</div>
                    <div class="footer">此邮件由系统自动发送 | {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</div>
                </div>
            </body></html>
            """
            msg.attach(MIMEText(html_body, 'html', 'utf-8'))
            
            with smtplib.SMTP_SSL(NOTIFICATION_CONFIG['SMTP_SERVER'], NOTIFICATION_CONFIG['SMTP_PORT']) as server:
                server.login(NOTIFICATION_CONFIG['SMTP_USER'], NOTIFICATION_CONFIG['SMTP_PASSWORD'])
                server.sendmail(NOTIFICATION_CONFIG['SMTP_USER'], receivers, msg.as_string())
            return True, "发送成功"
        except Exception as e:
            return False, str(e)

    def send_notification_async(self, title, content, notification_type='info', project_id=None):
        """异步发送通知（WeCom + Email）"""
        def _send():
            if NOTIFICATION_CONFIG.get('ENABLE_WECOM'):
                # 如果是项目相关通知，定向推送给项目经理个人
                if project_id:
                    from services.wecom_push_service import wecom_push_service
                    severity_map = {'danger': 'high', 'warning': 'medium', 'info': 'low'}
                    severity = severity_map.get(notification_type, 'low')
                    wecom_push_service.push_warning_to_manager(project_id, title, content, severity)
                else:
                    # 非项目通知 → 推送到群
                    type_emoji = {'danger': '🚨', 'warning': '⚠️', 'info': 'ℹ️'}.get(notification_type, 'ℹ️')
                    self.send_wecom_message(f"{type_emoji} {title}", content, 'markdown')
            if NOTIFICATION_CONFIG.get('ENABLE_EMAIL'):
                html = f"<h3>{title}</h3><p>{content.replace(chr(10), '<br>')}</p>"
                self.send_email(title, html)
        
        thread = Thread(target=_send)
        thread.start()

    def get_notifications(self, limit=50, user_id=None):
        """获取通知列表"""
        return self.get_notification_inbox(limit=limit, user_id=user_id)

    def get_notification_inbox(self, limit=50, notification_type=None, read_status=None, keyword=None, user_id=None):
        """获取通知收件箱，支持分类、已读状态与关键词筛选"""
        with DatabasePool.get_connection() as conn:
            clauses = ['1=1']
            params = []
            if user_id:
                clauses.append('(n.target_user_id IS NULL OR n.target_user_id = ?)')
                params.append(user_id)

            if notification_type:
                clauses.append('n.type = ?')
                params.append(notification_type)

            if read_status in ('read', 'unread'):
                clauses.append('n.is_read = ?')
                params.append(read_status == 'read')

            if keyword:
                clauses.append('(n.title LIKE ? OR n.content LIKE ? OR p.project_name LIKE ?)')
                pattern = f'%{keyword}%'
                params.extend([pattern, pattern, pattern])

            where_sql = ' AND '.join(clauses)
            sql = DatabasePool.format_sql(f'''
                SELECT n.*, p.project_name 
                FROM notifications n 
                LEFT JOIN projects p ON n.project_id = p.id
                WHERE {where_sql}
                ORDER BY n.created_at DESC LIMIT ?
            ''')
            params.append(limit)
            notifications = [dict(n) for n in conn.execute(sql, params).fetchall()]

            summary_sql = DatabasePool.format_sql(f'''
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN is_read = ? THEN 1 ELSE 0 END) as unread_count,
                    SUM(CASE WHEN type = 'danger' THEN 1 ELSE 0 END) as danger_count,
                    SUM(CASE WHEN type = 'warning' THEN 1 ELSE 0 END) as warning_count,
                    SUM(CASE WHEN type = 'info' THEN 1 ELSE 0 END) as info_count
                FROM notifications
                {"WHERE (target_user_id IS NULL OR target_user_id = ?)" if user_id else ""}
            ''')
            summary_params = [False]
            if user_id:
                summary_params.append(user_id)
            summary_row = dict(conn.execute(summary_sql, tuple(summary_params)).fetchone())

        return {
            'items': notifications,
            'summary': {
                'total': summary_row.get('total') or 0,
                'unread_count': summary_row.get('unread_count') or 0,
                'danger_count': summary_row.get('danger_count') or 0,
                'warning_count': summary_row.get('warning_count') or 0,
                'info_count': summary_row.get('info_count') or 0,
            }
        }

    def create_notification(self, data):
        """创建通知"""
        with DatabasePool.get_connection() as conn:
            targets = self._resolve_target_user_ids(
                conn,
                data.get('project_id'),
                data.get('type', 'info'),
                explicit_target_user_id=data.get('target_user_id')
            )
            sql = DatabasePool.format_sql('''
                INSERT INTO notifications (project_id, target_user_id, title, content, type, due_date, remind_type)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''')
            for uid in targets:
                conn.execute(sql, (
                    data.get('project_id'),
                    uid,
                    data['title'],
                    data.get('content', ''),
                    data.get('type', 'info'),
                    data.get('due_date'),
                    data.get('remind_type', 'once')
                ))
            conn.commit()
        self.send_notification_async(data['title'], data.get('content', ''), data.get('type', 'info'), data.get('project_id'))
        return True

    def mark_as_read(self, nid=None, user_id=None):
        """标记已读"""
        with DatabasePool.get_connection() as conn:
            if nid:
                if user_id:
                    sql = DatabasePool.format_sql('UPDATE notifications SET is_read = ? WHERE id = ? AND (target_user_id IS NULL OR target_user_id = ?)')
                    conn.execute(sql, (True, nid, user_id))
                else:
                    sql = DatabasePool.format_sql('UPDATE notifications SET is_read = ? WHERE id = ?')
                    conn.execute(sql, (True, nid))
            else:
                if user_id:
                    sql = DatabasePool.format_sql('UPDATE notifications SET is_read = ? WHERE is_read = ? AND (target_user_id IS NULL OR target_user_id = ?)')
                    conn.execute(sql, (True, False, user_id))
                else:
                    sql = DatabasePool.format_sql('UPDATE notifications SET is_read = ? WHERE is_read = ?')
                    conn.execute(sql, (True, False))
            conn.commit()
        return True

    def delete_notifications(self, nid=None):
        """删除通知"""
        with DatabasePool.get_connection() as conn:
            if nid:
                sql = DatabasePool.format_sql('DELETE FROM notifications WHERE id = ?')
                conn.execute(sql, (nid,))
            else:
                sql = DatabasePool.format_sql('DELETE FROM notifications')
                conn.execute(sql)
            conn.commit()
        return True

    def get_unread_count(self, user_id=None):
        """获取未读数"""
        with DatabasePool.get_connection() as conn:
            if user_id:
                sql = DatabasePool.format_sql('SELECT COUNT(*) as count FROM notifications WHERE is_read = ? AND (target_user_id IS NULL OR target_user_id = ?)')
                count = conn.execute(sql, (False, user_id)).fetchone()['count']
            else:
                sql = DatabasePool.format_sql('SELECT COUNT(*) as count FROM notifications WHERE is_read = ?')
                count = conn.execute(sql, (False,)).fetchone()['count']
        return count

    def check_and_create_reminders(self):
        """核心逻辑：扫描业务状态并生成预警提醒"""
        with DatabasePool.get_connection() as conn:
            today = datetime.now().strftime('%Y-%m-%d')
            three_days_later = (datetime.now() + timedelta(days=3)).strftime('%Y-%m-%d')
            one_day_ago = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
            two_days_ago = (datetime.now() - timedelta(days=2)).strftime('%Y-%m-%d')
            three_days_ago = (datetime.now() - timedelta(days=3)).strftime('%Y-%m-%d')
            created_reminders = []
            
            # 1. 检查即将逾期的阶段
            sql_upcoming = DatabasePool.format_sql('''
                SELECT s.*, p.project_name FROM project_stages s
                JOIN projects p ON s.project_id = p.id
                WHERE s.plan_end_date BETWEEN ? AND ? AND s.progress < 100
                AND p.status NOT IN ('暂停', '离场待返', '已终止', '已完成')
            ''')
            upcoming_stages = conn.execute(sql_upcoming, (today, three_days_later)).fetchall()
            
            for stage in upcoming_stages:
                sql_check = DatabasePool.format_sql('''
                    SELECT id FROM notifications 
                    WHERE project_id = ? AND title LIKE ? AND created_at > ?
                ''')
                existing = conn.execute(sql_check, (stage['project_id'], f"%{stage['stage_name']}%", one_day_ago)).fetchone()
                if not existing:
                    title = f"⚠️ 阶段即将到期: {stage['stage_name']}"
                    content = f"项目【{stage['project_name']}】的【{stage['stage_name']}】阶段将于 {stage['plan_end_date']} 到期，当前进度 {stage['progress']}%"
                    self.create_notification({
                        'project_id': stage['project_id'],
                        'title': title,
                        'content': content,
                        'type': 'warning',
                        'due_date': stage['plan_end_date']
                    })
                    created_reminders.append(f"{stage['project_name']} - {stage['stage_name']}")
            
            # 2. 检查已逾期的项目
            sql_overdue = DatabasePool.format_sql('''
                SELECT * FROM projects WHERE plan_end_date < ? 
                AND status NOT IN ('已完成', '已终止', '已验收', '质保期', '暂停', '离场待返')
            ''')
            overdue_projects = conn.execute(sql_overdue, (today,)).fetchall()
            
            for p in overdue_projects:
                sql_check = DatabasePool.format_sql('''
                    SELECT id FROM notifications 
                    WHERE project_id = ? AND type = 'danger' AND created_at > ?
                ''')
                existing = conn.execute(sql_check, (p['id'], three_days_ago)).fetchone()
                if not existing:
                    title = f"🚨 项目已逾期: {p['project_name']}"
                    content = f"项目原计划于 {p['plan_end_date']} 完成，当前进度 {p['progress']}%，请尽快处理！"
                    self.create_notification({
                        'project_id': p['id'],
                        'title': title,
                        'content': content,
                        'type': 'danger'
                    })
                    created_reminders.append(f"逾期: {p['project_name']}")
            
            # 3. 检查高危问题
            sql_issues = DatabasePool.format_sql('''
                SELECT i.*, p.project_name FROM issues i
                JOIN projects p ON i.project_id = p.id
                WHERE i.severity = '高' AND i.status = '待处理' 
                AND i.created_at < ?
            ''')
            critical_issues = conn.execute(sql_issues, (two_days_ago,)).fetchall()
            
            for issue in critical_issues:
                sql_check = DatabasePool.format_sql('''
                    SELECT id FROM notifications 
                    WHERE project_id = ? AND content LIKE ? AND created_at > ?
                ''')
                existing = conn.execute(sql_check, (issue['project_id'], f"%{issue['description'][:20]}%", two_days_ago)).fetchone()
                if not existing:
                    title = f"⚠️ 高危问题未处理"
                    content = f"项目【{issue['project_name']}】存在高危问题超过2天未处理：{issue['description'][:50]}..."
                    self.create_notification({
                        'project_id': issue['project_id'],
                        'title': title,
                        'content': content,
                        'type': 'warning'
                    })
                    created_reminders.append(f"高危问题: {issue['project_name']}")
    
        return created_reminders

# 全局实例
monitor_service = MonitorService()
