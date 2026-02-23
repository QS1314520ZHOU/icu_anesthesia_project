# services/wecom_push_service.py
"""
企业微信高级推送服务
- 模板卡片消息（日报/周报/预警）
- 定向推送（按项目经理、按角色）
- 里程碑庆祝通报
- 闲置催办升级
"""

import logging
from datetime import datetime
from database import DatabasePool
from services.wecom_service import wecom_service
from app_config import WECOM_CONFIG

logger = logging.getLogger(__name__)


class WeComPushService:
    """企业微信高级推送"""
    
    def _get_wecom_userid(self, member_name: str) -> str:
        """通过成员姓名查找企业微信 userid"""
        with DatabasePool.get_connection() as conn:
            row = conn.execute(
                'SELECT wecom_userid FROM users WHERE display_name = ? AND wecom_userid IS NOT NULL',
                (member_name,)
            ).fetchone()
            return row['wecom_userid'] if row else None
    
    def _get_project_manager_userid(self, project_id: int) -> str:
        """获取项目经理的企业微信 userid"""
        with DatabasePool.get_connection() as conn:
            project = conn.execute(
                'SELECT project_manager FROM projects WHERE id = ?', (project_id,)
            ).fetchone()
            if project and project['project_manager']:
                return self._get_wecom_userid(project['project_manager'])
        return None
    
    # ===== 预警定向推送 =====
    
    def push_warning_to_manager(self, project_id: int, title: str, content: str, severity: str = "high"):
        """将预警推送给项目经理个人"""
        if not wecom_service.is_enabled:
            return
        
        userid = self._get_project_manager_userid(project_id)
        if not userid:
            logger.warning("项目 %d 的经理未绑定企业微信，跳过定向推送", project_id)
            return
        
        emoji = {"high": "🚨", "medium": "⚠️", "low": "ℹ️"}.get(severity, "ℹ️")
        md_content = f"{emoji} **{title}**\n\n{content}\n\n> 点击查看详情"
        wecom_service.send_markdown(userid, md_content)
    
    def push_daily_report_card(self, project_id: int, report_content: str, report_date: str):
        """以模板卡片形式推送日报"""
        if not wecom_service.is_enabled:
            return
        
        userid = self._get_project_manager_userid(project_id)
        if not userid:
            return
        
        with DatabasePool.get_connection() as conn:
            project = conn.execute('SELECT project_name, progress FROM projects WHERE id = ?', 
                                  (project_id,)).fetchone()
        
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
        
        wecom_service.send_template_card(userid, card)
    
    def push_weekly_report_card(self, project_id: int, report_content: str, report_date: str):
        """以模板卡片形式推送周报"""
        if not wecom_service.is_enabled:
            return
        
        userid = self._get_project_manager_userid(project_id)
        if not userid:
            return
        
        with DatabasePool.get_connection() as conn:
            project = conn.execute('SELECT project_name, hospital_name, progress FROM projects WHERE id = ?', 
                                  (project_id,)).fetchone()
        
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
        
        wecom_service.send_template_card(userid, card)
    
    # ===== 里程碑庆祝通报 =====
    
    def push_milestone_celebration(self, project_id: int, milestone_name: str):
        """里程碑完成时发群通报"""
        if not wecom_service.is_enabled:
            return
        
        with DatabasePool.get_connection() as conn:
            project = conn.execute('SELECT project_name, hospital_name FROM projects WHERE id = ?',
                                  (project_id,)).fetchone()
        
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
                admins = conn.execute(
                    "SELECT wecom_userid FROM users WHERE role = 'admin' AND wecom_userid IS NOT NULL"
                ).fetchall()
            
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
            contacts = conn.execute(
                'SELECT name, email FROM customer_contacts WHERE project_id = ? AND is_primary = 1',
                (project_id,)
            ).fetchall()
        
        # 外部联系人推送需要额外的 external_userid 映射
        # 这里先记录日志，后续根据实际对接情况完善
        for contact in contacts:
            logger.info("周报已准备推送给甲方联系人: %s (%s)", contact['name'], contact['email'])
        
        # TODO: 如果甲方人员也在企业微信（通过外部联系人），可以用 send_text 推送


# 全局单例
wecom_push_service = WeComPushService()
