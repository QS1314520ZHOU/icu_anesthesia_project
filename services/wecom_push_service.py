# services/wecom_push_service.py
"""
企业微信高级推送服务
- 模板卡片消息（日报/周报/预警）
- 定向推送（按项目经理、按角色）
- 里程碑庆祝通报
- 闲置催办升级
"""

import json
import logging
from datetime import datetime
from database import DatabasePool
from services.wecom_service import wecom_service
from app_config import WECOM_CONFIG

logger = logging.getLogger(__name__)


class WeComPushService:
    """企业微信高级推送"""

    RND_ROLE_HINTS = ('研发', '开发', '后端', '前端', '测试', '产品', '架构', '算法', '平台', '接口研发')
    ONSITE_ROLE_HINTS = ('现场', '驻场', '实施', '交付', '项目经理', '工程')
    
    def _get_wecom_userid(self, member_name: str) -> str:
        """通过成员姓名查找企业微信 userid"""
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('SELECT wecom_userid FROM users WHERE display_name = ? AND wecom_userid IS NOT NULL')
            row = conn.execute(sql, (member_name,)).fetchone()
            return row['wecom_userid'] if row else None

    def _is_rnd_role(self, role: str) -> bool:
        role_text = str(role or '')
        return any(keyword in role_text for keyword in self.RND_ROLE_HINTS)

    def _is_onsite_role(self, role: str, is_onsite=False) -> bool:
        role_text = str(role or '')
        return bool(is_onsite) or (any(keyword in role_text for keyword in self.ONSITE_ROLE_HINTS) and not self._is_rnd_role(role_text))

    def _get_issue_push_context(self, issue_id: int) -> dict:
        with DatabasePool.get_connection() as conn:
            issue = conn.execute(DatabasePool.format_sql('''
                SELECT i.*, p.project_name, p.hospital_name
                FROM issues i
                LEFT JOIN projects p ON p.id = i.project_id
                WHERE i.id = ?
            '''), (issue_id,)).fetchone()
            if not issue:
                return {}
            issue = dict(issue)
            owner = None
            if issue.get('owner_member_id'):
                owner_row = conn.execute(DatabasePool.format_sql('''
                    SELECT id, name, role, is_onsite
                    FROM project_members
                    WHERE id = ?
                '''), (issue['owner_member_id'],)).fetchone()
                owner = dict(owner_row) if owner_row else None
            members = conn.execute(DatabasePool.format_sql('''
                SELECT id, name, role, is_onsite
                FROM project_members
                WHERE project_id = ?
                  AND status = '在岗'
                ORDER BY role, name
            '''), (issue['project_id'],)).fetchall()
            members = [dict(row) for row in members]
        return {
            'issue': issue,
            'owner': owner,
            'members': members,
        }

    def push_issue_to_rnd_and_onsite(self, issue_id: int, trigger='manual') -> dict:
        """将需求/问题定向推送给研发负责人和本项目实施侧/驻场成员。"""
        context = self._get_issue_push_context(issue_id)
        if not context:
            return {'success': False, 'message': '问题/需求不存在', 'sent_count': 0, 'missing_members': []}

        issue = context['issue']
        owner = context.get('owner')
        onsite_members = [
            member for member in context.get('members', [])
            if self._is_onsite_role(member.get('role'), member.get('is_onsite'))
        ]

        target_members = []
        if owner:
            target_members.append(owner)
        target_members.extend(onsite_members)

        seen_names = set()
        userids = []
        sent_members = []
        missing_members = []
        for member in target_members:
            name = str(member.get('name') or '').strip()
            if not name or name in seen_names:
                continue
            seen_names.add(name)
            userid = self._get_wecom_userid(name)
            if userid:
                userids.append(userid)
                sent_members.append(name)
            else:
                missing_members.append(name)

        if not userids:
            return {
                'success': False,
                'message': '未找到已绑定企业微信的研发负责人或实施侧成员',
                'sent_count': 0,
                'missing_members': missing_members
            }

        severity_icon = {'高': '🚨', '中': '⚠️', '低': 'ℹ️'}.get(issue.get('severity'), '📌')
        issue_type = issue.get('issue_type') or '问题'
        owner_name = owner.get('name') if owner else '未指定'
        project_name = issue.get('project_name') or f"项目#{issue.get('project_id')}"
        title = f"{severity_icon} {issue_type}推送：{project_name}"
        lines = [
            f"**{title}**",
            "",
            f"> 项目：{project_name}",
            f"> 医院：{issue.get('hospital_name') or '-'}",
            f"> 研发负责人：{owner_name}",
            f"> 严重程度：{issue.get('severity') or '-'}",
            f"> 状态：{issue.get('status') or '-'}",
            "",
            f"**内容**：{issue.get('description') or '-'}",
        ]
        if issue.get('root_cause_type'):
            lines.append(f"\n根因分类：{issue.get('root_cause_type')}")
        if issue.get('is_external_blocker'):
            lines.append("\n外部阻塞：是，请实施侧同步协同推进。")
        lines.append("\n请相关研发与现场实施在项目系统中同步处理进展。")

        content = "\n".join(lines)
        touser = "|".join(sorted(set(userids)))

        if not wecom_service.is_enabled:
            self._save_issue_push_result(issue_id, {
                'success': False,
                'sent_members': sent_members,
                'missing_members': missing_members,
                'trigger': trigger,
                'message': '企业微信自建应用未启用，无法定向推送'
            })
            return {
                'success': False,
                'message': '企业微信自建应用未启用，无法定向推送',
                'sent_count': 0,
                'missing_members': missing_members,
                'sent_members': sent_members
            }

        result = wecom_service.send_markdown(touser, content)
        success = result.get('errcode') == 0
        payload = {
            'success': success,
            'message': '已推送给研发负责人和实施侧成员' if success else result.get('errmsg', '企业微信推送失败'),
            'sent_count': len(set(userids)) if success else 0,
            'sent_members': sent_members if success else [],
            'missing_members': missing_members,
            'trigger': trigger
        }
        self._save_issue_push_result(issue_id, payload)
        return payload

    def _save_issue_push_result(self, issue_id: int, payload: dict):
        summary_parts = []
        if payload.get('sent_members'):
            summary_parts.append(f"已推送：{'、'.join(payload['sent_members'])}")
        if payload.get('missing_members'):
            summary_parts.append(f"未绑定企微：{'、'.join(payload['missing_members'])}")
        if not summary_parts:
            summary_parts.append(payload.get('message') or '未执行推送')
        summary_text = '；'.join(summary_parts)

        with DatabasePool.get_connection() as conn:
            conn.execute(DatabasePool.format_sql('''
                UPDATE issues
                SET last_wecom_push_at = CURRENT_TIMESTAMP,
                    last_wecom_push_summary = ?
                WHERE id = ?
            '''), (summary_text, issue_id))
            conn.execute(DatabasePool.format_sql('''
                INSERT INTO issue_push_receipts (
                    issue_id, push_channel, trigger_type, success, sent_count,
                    sent_members_json, missing_members_json, result_message, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            '''), (
                issue_id,
                'wecom',
                payload.get('trigger') or 'manual',
                bool(payload.get('success')),
                int(payload.get('sent_count') or 0),
                json.dumps(payload.get('sent_members') or [], ensure_ascii=False),
                json.dumps(payload.get('missing_members') or [], ensure_ascii=False),
                payload.get('message') or ''
            ))
            conn.commit()

    def get_issue_push_receipts(self, issue_id: int, limit: int = 10) -> list:
        with DatabasePool.get_connection() as conn:
            rows = conn.execute(DatabasePool.format_sql('''
                SELECT *
                FROM issue_push_receipts
                WHERE issue_id = ?
                ORDER BY created_at DESC, id DESC
                LIMIT ?
            '''), (issue_id, max(1, min(int(limit or 10), 50)))).fetchall()
        receipts = []
        for row in rows:
            item = dict(row)
            try:
                item['sent_members'] = json.loads(item.get('sent_members_json') or '[]')
            except Exception:
                item['sent_members'] = []
            try:
                item['missing_members'] = json.loads(item.get('missing_members_json') or '[]')
            except Exception:
                item['missing_members'] = []
            receipts.append(item)
        return receipts
    
    def _get_project_manager_userid(self, project_id: int) -> str:
        """获取项目经理的企业微信 userid"""
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('SELECT project_manager FROM projects WHERE id = ?')
            project = conn.execute(sql, (project_id,)).fetchone()
            if project and project['project_manager']:
                return self._get_wecom_userid(project['project_manager'])
        return None

    def _get_project_member_userids(self, project_id: int) -> str:
        """获取项目经理及所有在岗成员的企业微信 userid 列表（用|分隔）"""
        userids = set()
        
        # 1. 获取项目经理
        pm_id = self._get_project_manager_userid(project_id)
        if pm_id:
            userids.add(pm_id)
            
        # 2. 获取其他所有在岗成员
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql("SELECT name FROM project_members WHERE project_id = ? AND status = '在岗'")
            members = conn.execute(sql, (project_id,)).fetchall()
            
            for m in members:
                uid = self._get_wecom_userid(m['name'])
                if uid:
                    userids.add(uid)
                    
        if userids:
            return "|".join(userids)
        return None
    
    # ===== 预警定向推送 =====
    
    def push_warning_to_manager(self, project_id: int, title: str, content: str, severity: str = "high"):
        """将预警推送给项目经理个人（兜底推群）"""
        emoji = {"high": "🚨", "medium": "⚠️", "low": "ℹ️"}.get(severity, "ℹ️")
        
        # 尝试通过自建应用定向推送给项目经理
        if wecom_service.is_enabled:
            userid = self._get_project_manager_userid(project_id)
            if userid:
                md_content = f"{emoji} **{title}**\n\n{content}\n\n> 点击查看详情"
                result = wecom_service.send_markdown(userid, md_content)
                if result.get('errcode') == 0:
                    return True, "已定向推送给项目经理"
                logger.warning("项目 %d 经理定向推送失败: %s，尝试 Webhook 兜底", project_id, result)
            else:
                logger.warning("项目 %d 的经理未绑定企业微信，尝试 Webhook 兜底", project_id)
        
        # 兜底：仅对高危预警推送到企微群，避免普通消息刷屏
        if severity == "high":
            from services.monitor_service import monitor_service
            success, msg = monitor_service.send_wecom_message(f"{emoji} {title}", content, 'markdown')
            if success:
                return True, "经理未绑定，已通过 Webhook 兜底推送到群"
            return False, f"所有推送渠道均失败: {msg}"
        
        return False, "项目经理未绑定企微，且非高危预警已跳过群兜底"
    
    def push_daily_report_card(self, project_id: int, report_content: str, report_date: str):
        """以模板卡片形式推送日报给项目成员"""
        if not wecom_service.is_enabled:
            return
        
        userids = self._get_project_member_userids(project_id)
        if not userids:
            return
        
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('SELECT project_name, progress FROM projects WHERE id = ?')
            project = conn.execute(sql, (project_id,)).fetchone()
        
        if not project:
            return
        
        # 截取摘要（前100字）
        summary = report_content[:100].replace('\n', ' ') + "..."
        
        card = {
            "card_type": "text_notice",
            "source": {
                "icon_url": "",
                "desc": "ICU-PM 项目管理",
                "desc_color": 0
            },
            "main_title": {
                "title": f"📋 {project['project_name']} 日报",
                "desc": report_date
            },
            "sub_title_text": summary,
            "horizontal_content_list": [
                {"keyname": "项目进度", "value": f"{project['progress']}%"},
                {"keyname": "报告日期", "value": report_date}
            ],
            "card_action": {
                "type": 1,
                "url": f"{WECOM_CONFIG['APP_HOME_URL']}/m/briefing/{project_id}"
            }
        }
        
        wecom_service.send_template_card(userids, card)
    
    def push_weekly_report_card(self, project_id: int, report_content: str, report_date: str):
        """以模板卡片形式推送周报给项目成员"""
        if not wecom_service.is_enabled:
            return
        
        userids = self._get_project_member_userids(project_id)
        if not userids:
            return
        
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('SELECT project_name, hospital_name, progress FROM projects WHERE id = ?')
            project = conn.execute(sql, (project_id,)).fetchone()
        
        if not project:
            return
        
        summary = report_content[:120].replace('\n', ' ') + "..."
        
        card = {
            "card_type": "text_notice",
            "source": {
                "desc": "ICU-PM 周报",
                "desc_color": 1
            },
            "main_title": {
                "title": f"📊 {project['project_name']} 周报",
                "desc": f"{project['hospital_name']} | {report_date}"
            },
            "sub_title_text": summary,
            "horizontal_content_list": [
                {"keyname": "当前进度", "value": f"{project['progress']}%"},
            ],
            "card_action": {
                "type": 1,
                "url": f"{WECOM_CONFIG['APP_HOME_URL']}/m/briefing/{project_id}"
            }
        }
        
        wecom_service.send_template_card(userids, card)
    
    # ===== 里程碑庆祝通报 =====
    
    def push_milestone_celebration(self, project_id: int, milestone_name: str):
        """里程碑完成时发群通报"""
        if not wecom_service.is_enabled:
            return
        
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('SELECT project_name, hospital_name FROM projects WHERE id = ?')
            project = conn.execute(sql, (project_id,)).fetchone()
        
        if not project:
            return
        
        content = (
            f"🎉🎉🎉 **里程碑达成！**\n\n"
            f"项目：**{project['project_name']}**\n"
            f"医院：{project['hospital_name']}\n"
            f"里程碑：**{milestone_name}**\n"
            f"完成时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}\n\n"
            f"恭喜项目组全体成员！🏆\n\n"
            f"> [📱 进入移动版控制台]({WECOM_CONFIG['APP_HOME_URL']}/m/)"
        )
        
        wecom_service.send_markdown_to_all(content)

    # ===== 项目系统预警推送 =====

    def push_project_alert(self, project_id: int, title: str, content: str, notification_type: str = 'info'):
        """向项目所有相关成员推送告警消息（逾期、高危问题等）"""
        type_emoji = {'danger': '🚨', 'warning': '⚠️', 'info': 'ℹ️'}.get(notification_type, 'ℹ️')
        
        # 尝试通过自建应用定向推送
        if wecom_service.is_enabled:
            userids = self._get_project_member_userids(project_id)
            if userids:
                md_content = f"{type_emoji} **{title}**\n\n{content}\n\n> <font color='comment'>系统自动预警</font> | [查看控制台]({WECOM_CONFIG['APP_HOME_URL']}/m/)"
                result = wecom_service.send_markdown(userids, md_content)
                if result.get('errcode') == 0:
                    return True, "项目定向推送成功"
                logger.warning("项目 %d 自建应用定向推送失败: %s，尝试 Webhook 兜底", project_id, result)
            else:
                logger.warning("项目 %d 没找到关联的企微成员，尝试 Webhook 兜底", project_id)
        
        # 兜底：仅对 'danger' 级别的告警推送到企微群
        if notification_type == 'danger':
            from services.monitor_service import monitor_service
            success, msg = monitor_service.send_wecom_message(f"{type_emoji} {title}", content, 'markdown')
            if success:
                return True, "已通过 Webhook 兜底推送到群"
            return False, f"Webhook 推送失败: {msg}"
            
        return False, "未找到关联企微成员，且非紧急告警已跳过群兜底"
    
    # ===== 闲置催办升级 =====
    
    def push_idle_escalation(self, project_id: int, project_name: str, 
                              manager_name: str, idle_days: int):
        """闲置项目催办，超过阈值升级通知 PMO"""
        if not wecom_service.is_enabled:
            return
        
        # 先通知项目经理
        manager_userid = self._get_wecom_userid(manager_name)
        if manager_userid:
            wecom_service.send_markdown(manager_userid,
                f"⚠️ **项目闲置提醒**\n\n"
                f"项目 **{project_name}** 已 **{idle_days}** 天无工作日志更新。\n"
                f"请尽快更新进展或提交日志。\n\n"
                f"> [📱 进入移动版操作台]({WECOM_CONFIG['APP_HOME_URL']}/m/)"
            )
        
        # 超过21天，升级通知 admin/PMO
        if idle_days > 21:
            with DatabasePool.get_connection() as conn:
                sql = DatabasePool.format_sql("SELECT wecom_userid FROM users WHERE role = 'admin' AND wecom_userid IS NOT NULL")
                admins = conn.execute(sql).fetchall()
            
            for admin in admins:
                wecom_service.send_markdown(admin['wecom_userid'],
                    f"🚨 **闲置升级通知**\n\n"
                    f"项目 **{project_name}** 已 **{idle_days}** 天无任何更新！\n"
                    f"负责人：{manager_name}\n"
                    f"请关注并协调处理。\n\n"
                    f"> [📱 进入移动版操作台]({WECOM_CONFIG['APP_HOME_URL']}/m/)"
                )
    
    # ===== 周报推送给甲方外部联系人 =====
    
    def push_weekly_to_customer(self, project_id: int, report_content: str):
        """将周报推送给甲方联系人（如果已关联企业微信外部联系人）"""
        if not wecom_service.is_enabled:
            return
        
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('SELECT name, email FROM customer_contacts WHERE project_id = ? AND is_primary = TRUE')
            contacts = conn.execute(sql, (project_id,)).fetchall()
        
        # 外部联系人推送需要额外的 external_userid 映射
        # 这里先记录日志，后续根据实际对接情况完善
        for contact in contacts:
            logger.info("周报已准备推送给甲方联系人: %s (%s)", contact['name'], contact['email'])
        
        # TODO: 如果甲方人员也在企业微信（通过外部联系人），可以用 send_text 推送


# 全局单例
wecom_push_service = WeComPushService()
