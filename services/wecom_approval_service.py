# services/wecom_approval_service.py
"""
企业微信审批流程服务
对接三类审批：离场审批、变更审批、费用报销审批
支持：发起审批 → 企业微信审批 → 回调写回数据库
"""

import json
import logging
from datetime import datetime
from database import DatabasePool
from services.wecom_service import wecom_service

logger = logging.getLogger(__name__)


class WeComApprovalService:
    """审批流程服务"""
    
    # 审批模板ID（需要在企业微信管理后台创建审批模板后填入）
    # 也可以存在 system_config 表中，通过管理界面配置
    TEMPLATE_IDS = {
        "departure": "",    # 离场审批模板ID
        "change": "",       # 变更审批模板ID
        "expense": "",      # 费用报销模板ID
    }
    
    def load_template_ids(self):
        """从数据库加载审批模板ID配置"""
        try:
            with DatabasePool.get_connection() as conn:
                rows = conn.execute(
                    DatabasePool.format_sql("SELECT config_key, value FROM system_config WHERE config_key LIKE 'approval_template_%'")
                ).fetchall()
                for row in rows:
                    key = row['config_key'].replace('approval_template_', '')
                    self.TEMPLATE_IDS[key] = row['value']
        except Exception as e:
            logger.warning("加载审批模板配置失败: %s", e)
    
    # ===== 离场审批 =====
    
    def submit_departure_approval(self, departure_id: int, applicant_userid: str) -> dict:
        """提交离场审批到企业微信"""
        with DatabasePool.get_connection() as conn:
            dep = conn.execute(DatabasePool.format_sql('''
                SELECT d.*, p.project_name, p.project_manager
                FROM project_departures d
                JOIN projects p ON d.project_id = p.id
                WHERE d.id = ?
            '''), (departure_id,)).fetchone()
            
            if not dep:
                return {"success": False, "message": "离场记录不存在"}
        
        # 查找审批人（项目经理）的企业微信 userid
        approver_userid = self._get_wecom_userid(dep['project_manager'] or 'admin')
        if not approver_userid:
            return {"success": False, "message": "审批人未绑定企业微信"}
        
        template_id = self.TEMPLATE_IDS.get("departure")
        if not template_id:
            # 没有审批模板时，降级为消息通知
            return self._fallback_message_approval(
                approver_userid, "离场审批",
                f"项目：{dep['project_name']}\n"
                f"离场类型：{dep['departure_type']}\n"
                f"离场日期：{dep['departure_date']}\n"
                f"原因：{dep['reason']}\n"
                f"预计返回：{dep['expected_return_date'] or '待定'}",
                "departure", departure_id
            )
        
        # 构造审批数据
        apply_data = {
            "contents": [
                {"control": "Text", "id": "project", "value": {"text": dep['project_name']}},
                {"control": "Text", "id": "type", "value": {"text": dep['departure_type'] or ''}},
                {"control": "Date", "id": "date", "value": {"s_timestamp": dep['departure_date']}},
                {"control": "Textarea", "id": "reason", "value": {"text": dep['reason'] or ''}},
            ]
        }
        
        result = wecom_service.create_approval(
            template_id=template_id,
            apply_data=apply_data,
            applicant_userid=applicant_userid,
            approver_userids=[approver_userid],
            summary=[f"{dep['project_name']} - 离场申请"]
        )
        
        if result.get("errcode") == 0:
            sp_no = result.get("sp_no")
            with DatabasePool.get_connection() as conn:
                conn.execute(
                    DatabasePool.format_sql('UPDATE project_departures SET approval_sp_no = ?, status = ? WHERE id = ?'),
                    (sp_no, '审批中', departure_id)
                )
            return {"success": True, "sp_no": sp_no}
        
        return {"success": False, "message": result.get("errmsg", "未知错误")}
    
    # ===== 变更审批 =====
    
    def submit_change_approval(self, change_id: int, applicant_userid: str) -> dict:
        """提交变更审批到企业微信"""
        with DatabasePool.get_connection() as conn:
            change = conn.execute(DatabasePool.format_sql('''
                SELECT c.*, p.project_name, p.project_manager
                FROM project_changes c
                JOIN projects p ON c.project_id = p.id
                WHERE c.id = ?
            '''), (change_id,)).fetchone()
            
            if not change:
                return {"success": False, "message": "变更记录不存在"}
        
        approver_userid = self._get_wecom_userid(change['project_manager'] or 'admin')
        if not approver_userid:
            return {"success": False, "message": "审批人未绑定企业微信"}
        
        template_id = self.TEMPLATE_IDS.get("change")
        if not template_id:
            return self._fallback_message_approval(
                approver_userid, "变更审批",
                f"项目：{change['project_name']}\n"
                f"变更类型：{change['change_type']}\n"
                f"标题：{change['change_title']}\n"
                f"描述：{change['change_desc'] or ''}\n"
                f"影响分析：{change['impact_analysis'] or '待评估'}",
                "change", change_id
            )
        
        apply_data = {
            "contents": [
                {"control": "Text", "id": "project", "value": {"text": change['project_name']}},
                {"control": "Text", "id": "type", "value": {"text": change['change_type'] or ''}},
                {"control": "Text", "id": "title", "value": {"text": change['change_title']}},
                {"control": "Textarea", "id": "desc", "value": {"text": change['change_desc'] or ''}},
                {"control": "Textarea", "id": "impact", "value": {"text": change['impact_analysis'] or ''}},
            ]
        }
        
        result = wecom_service.create_approval(
            template_id=template_id,
            apply_data=apply_data,
            applicant_userid=applicant_userid,
            approver_userids=[approver_userid],
            summary=[f"{change['project_name']} - {change['change_title']}"]
        )
        
        if result.get("errcode") == 0:
            sp_no = result.get("sp_no")
            with DatabasePool.get_connection() as conn:
                conn.execute(
                    DatabasePool.format_sql('UPDATE project_changes SET approval_sp_no = ?, status = ? WHERE id = ?'),
                    (sp_no, '审批中', change_id)
                )
            return {"success": True, "sp_no": sp_no}
        return {"success": False, "message": result.get("errmsg", "未知错误")}
    
    # ===== 费用审批 =====
    
    def submit_expense_approval(self, expense_id: int, applicant_userid: str) -> dict:
        """提交费用报销审批"""
        with DatabasePool.get_connection() as conn:
            expense = conn.execute(DatabasePool.format_sql('''
                SELECT e.*, p.project_name, p.project_manager
                FROM project_expenses e
                JOIN projects p ON e.project_id = p.id
                WHERE e.id = ?
            '''), (expense_id,)).fetchone()
            
            if not expense:
                return {"success": False, "message": "费用记录不存在"}
        
        approver_userid = self._get_wecom_userid(expense['project_manager'] or 'admin')
        if not approver_userid:
            return {"success": False, "message": "审批人未绑定企业微信"}
        
        template_id = self.TEMPLATE_IDS.get("expense")
        if not template_id:
            return self._fallback_message_approval(
                approver_userid, "费用报销审批",
                f"项目：{expense['project_name']}\n"
                f"类型：{expense['expense_type']}\n"
                f"金额：¥{expense['amount']}\n"
                f"日期：{expense['expense_date']}\n"
                f"说明：{expense['description'] or ''}",
                "expense", expense_id
            )
        
        apply_data = {
            "contents": [
                {"control": "Text", "id": "project", "value": {"text": expense['project_name']}},
                {"control": "Text", "id": "type", "value": {"text": expense['expense_type'] or ''}},
                {"control": "Money", "id": "amount", "value": {"new_money": str(expense['amount'])}},
                {"control": "Textarea", "id": "desc", "value": {"text": expense['description'] or ''}},
            ]
        }
        
        result = wecom_service.create_approval(
            template_id=template_id,
            apply_data=apply_data,
            applicant_userid=applicant_userid,
            approver_userids=[approver_userid],
            summary=[f"¥{expense['amount']} - {expense['expense_type']}"]
        )
        
        if result.get("errcode") == 0:
            sp_no = result.get("sp_no")
            with DatabasePool.get_connection() as conn:
                conn.execute(
                    DatabasePool.format_sql('UPDATE project_expenses SET approval_sp_no = ?, status = ? WHERE id = ?'),
                    (sp_no, '审批中', expense_id)
                )
            return {"success": True, "sp_no": sp_no}
        return {"success": False, "message": result.get("errmsg", "未知错误")}
    
    # ===== 审批回调处理 =====
    
    def handle_approval_callback(self, approval_info: dict):
        """处理企业微信审批状态变更回调"""
        sp_no = approval_info.get("SpNo")
        sp_status = approval_info.get("SpStatus")  # 1-审批中 2-已通过 3-已驳回 4-已撤销
        
        status_map = {1: "审批中", 2: "已批准", 3: "已驳回", 4: "已撤销"}
        new_status = status_map.get(sp_status, "未知")
        
        logger.info("审批回调: sp_no=%s, status=%s", sp_no, new_status)
        
        # 通过 sp_no 在各业务表中查找并更新
        with DatabasePool.get_connection() as conn:
            now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            
            # 查找离场审批
            dep = conn.execute(
                DatabasePool.format_sql("SELECT id FROM project_departures WHERE approval_sp_no = ?"),
                (sp_no,)
            ).fetchone()
            if dep:
                conn.execute(
                    DatabasePool.format_sql('UPDATE project_departures SET status = ?, approved_at = ? WHERE id = ?'),
                    (new_status, now, dep['id'])
                )
                logger.info("离场审批 %d 状态更新为: %s", dep['id'], new_status)
                return
            
            # 查找变更审批 (需要扩展 project_changes 表增加 sp_no 字段)
            # 这里用类似的逻辑匹配
            change = conn.execute(
                DatabasePool.format_sql("SELECT id FROM project_changes WHERE approval_sp_no = ?"),
                (sp_no,)
            ).fetchone()
            if change:
                if sp_status in [2, 3]:
                    conn.execute(
                        DatabasePool.format_sql('UPDATE project_changes SET status = ?, approved_date = ? WHERE id = ?'),
                        (new_status, now[:10], change['id'])
                    )
                return
            
            # 查找费用审批
            expense = conn.execute(
                DatabasePool.format_sql("SELECT id, status FROM project_expenses WHERE approval_sp_no = ?"),
                (sp_no,)
            ).fetchone()
            if expense:
                expense_status = "已报销" if sp_status == 2 else "已驳回" if sp_status == 3 else expense.get('status', '待报销')
                conn.execute(
                    DatabasePool.format_sql('UPDATE project_expenses SET status = ?, approved_at = ? WHERE id = ?'),
                    (expense_status, now, expense['id'])
                )
    
    # ===== 降级方案：无审批模板时用消息通知 =====
    
    def _fallback_message_approval(self, approver_userid: str, title: str, 
                                    content: str, biz_type: str, biz_id: int) -> dict:
        """降级方案：发送消息通知代替正式审批流"""
        from app_config import WECOM_CONFIG
        
        md_content = (
            f"📋 **{title}**\n\n"
            f"{content}\n\n"
            f"> 请在系统中处理：[点击审批]({WECOM_CONFIG['APP_HOME_URL']}/#/{biz_type}/{biz_id})"
        )
        
        wecom_service.send_markdown(approver_userid, md_content)
        return {"success": True, "message": "已通过消息通知审批人（未配置审批模板）", "fallback": True}
    
    def _get_wecom_userid(self, name: str) -> str:
        with DatabasePool.get_connection() as conn:
            row = conn.execute(
                DatabasePool.format_sql('SELECT wecom_userid FROM users WHERE display_name = ? AND wecom_userid IS NOT NULL'),
                (name,)
            ).fetchone()
            return row['wecom_userid'] if row else None


# 全局单例
wecom_approval_service = WeComApprovalService()
