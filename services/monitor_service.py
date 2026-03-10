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

    def get_notifications(self, limit=50):
        """获取通知列表"""
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('''
                SELECT n.*, p.project_name 
                FROM notifications n 
                LEFT JOIN projects p ON n.project_id = p.id
                ORDER BY n.created_at DESC LIMIT ?
            ''')
            notifications = conn.execute(sql, (limit,)).fetchall()
        return [dict(n) for n in notifications]

    def create_notification(self, data):
        """创建通知"""
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('''
                INSERT INTO notifications (project_id, title, content, type, due_date, remind_type)
                VALUES (?, ?, ?, ?, ?, ?)
            ''')
            conn.execute(sql, (data.get('project_id'), data['title'], data.get('content', ''), 
                  data.get('type', 'info'), data.get('due_date'), data.get('remind_type', 'once')))
            conn.commit()
        self.send_notification_async(data['title'], data.get('content', ''), data.get('type', 'info'), data.get('project_id'))
        return True

    def mark_as_read(self, nid=None):
        """标记已读"""
        with DatabasePool.get_connection() as conn:
            if nid:
                sql = DatabasePool.format_sql('UPDATE notifications SET is_read = ? WHERE id = ?')
                conn.execute(sql, (True, nid))
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

    def get_unread_count(self):
        """获取未读数"""
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('SELECT COUNT(*) as count FROM notifications WHERE is_read = ?')
            count = conn.execute(sql, (False,)).fetchone()['count']
        return count

    def check_and_create_reminders(self):
        """核心逻辑：扫描业务状态并生成预警提醒"""
        with DatabasePool.get_connection() as conn:
            today = datetime.now().strftime('%Y-%m-%d')
            three_days_later = (datetime.now() + timedelta(days=3)).strftime('%Y-%m-%d')
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
                    WHERE project_id = ? AND title LIKE ? AND created_at > date('now', '-1 day')
                ''')
                existing = conn.execute(sql_check, (stage['project_id'], f"%{stage['stage_name']}%")).fetchone()
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
                    WHERE project_id = ? AND type = 'danger' AND created_at > date('now', '-3 day')
                ''')
                existing = conn.execute(sql_check, (p['id'],)).fetchone()
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
                AND i.created_at < date('now', '-2 day')
            ''')
            critical_issues = conn.execute(sql_issues).fetchall()
            
            for issue in critical_issues:
                sql_check = DatabasePool.format_sql('''
                    SELECT id FROM notifications 
                    WHERE project_id = ? AND content LIKE ? AND created_at > date('now', '-2 day')
                ''')
                existing = conn.execute(sql_check, (issue['project_id'], f"%{issue['description'][:20]}%")).fetchone()
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
