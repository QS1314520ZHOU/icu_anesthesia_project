# services/wecom_msg_handler.py
"""
企业微信消息接收处理器
处理用户通过企业微信自建应用发送的消息：
- 文本消息 → 自然语言查询 / 快速填日志 / 命令解析
- 图片消息 → 问题上报附图
"""

import re
import os
import json
import logging
from datetime import datetime
from database import DatabasePool
from services.wecom_service import wecom_service
from app_config import WECOM_CONFIG

logger = logging.getLogger(__name__)


class WeComMsgHandler:
    """消息处理器"""
    
    # 命令前缀
    CMD_PATTERNS = {
        "query": re.compile(r'^(查询|查|问|ask)\s+(.+)', re.IGNORECASE),
        "log": re.compile(r'^(日志|log|记录)\s+(.+)', re.IGNORECASE),
        "issue": re.compile(r'^(问题|bug|故障|上报)\s+(.+)', re.IGNORECASE),
        "status": re.compile(r'^(状态|进度|overview)$', re.IGNORECASE),
        "bind": re.compile(r'^(绑定|bind)$', re.IGNORECASE),
        "help": re.compile(r'^(帮助|help|\?)$', re.IGNORECASE),
    }
    
    def handle_text_message(self, userid: str, content: str) -> str:
        """处理文本消息，返回回复内容"""
        content = content.strip()
        
        # 1. 匹配命令
        for cmd_type, pattern in self.CMD_PATTERNS.items():
            match = pattern.match(content)
            if match:
                if cmd_type == "query":
                    return self._handle_query(userid, match.group(2))
                elif cmd_type == "log":
                    return self._handle_quick_log(userid, match.group(2))
                elif cmd_type == "issue":
                    return self._handle_quick_issue(userid, match.group(2))
                elif cmd_type == "status":
                    return self._handle_status(userid)
                elif cmd_type == "bind":
                    return self._handle_bind(userid)
                elif cmd_type == "help":
                    return self._get_help_text()
        
        # 2. 无命令前缀 → 智能判断
        return self._handle_smart_route(userid, content)
    
    def handle_image_message(self, userid: str, media_id: str) -> str:
        """处理图片消息（用于问题上报附图）"""
        # 下载图片到临时目录
        temp_dir = os.path.join('uploads', 'wecom_images')
        os.makedirs(temp_dir, exist_ok=True)
        filename = f"{userid}_{datetime.now().strftime('%Y%m%d%H%M%S')}.jpg"
        save_path = os.path.join(temp_dir, filename)
        
        downloaded = wecom_service.get_media(media_id, save_path)
        if downloaded:
            # 暂存图片路径，等待后续文字描述来关联
            self._save_pending_image(userid, save_path)
            return "📷 图片已收到！请发送文字描述来创建问题上报。\n格式：问题 <描述内容>"
        else:
            return "图片接收失败，请重试。"
    
    def _handle_query(self, userid: str, question: str) -> str:
        """自然语言查询"""
        try:
            # 找到用户关联的项目
            project_id = self._get_user_primary_project(userid)
            if not project_id:
                return "❌ 你还没有关联任何项目。请先在Web端绑定企业微信账号。"
            
            from services.nl_query_service import nl_query_service
            
            # 转 SQL
            sql, error = nl_query_service.convert_to_sql(project_id, question)
            if error:
                return f"❌ 无法理解你的问题：{error}"
            
            # 执行
            result = nl_query_service.execute_query(project_id, sql)
            if 'error' in result:
                return f"❌ 查询执行失败：{result['error']}"
            
            # 格式化结果
            rows = result.get('rows', [])
            if not rows:
                return "查询结果为空，没有找到匹配的数据。"
            
            # 简单表格化
            lines = [f"📊 **查询结果**（共 {len(rows)} 条）\n"]
            for i, row in enumerate(rows[:10]):  # 最多显示10条
                line_parts = [f"{k}: {v}" for k, v in row.items() if v is not None]
                lines.append(f"{i+1}. " + " | ".join(line_parts))
            
            if len(rows) > 10:
                lines.append(f"\n... 还有 {len(rows) - 10} 条，请到Web端查看完整结果")
            
            return "\n".join(lines)
        except Exception as e:
            logger.error("NL Query via WeChat failed: %s", e)
            return f"查询处理异常：{str(e)}"
    
    def _handle_quick_log(self, userid: str, content: str) -> str:
        """快速填写工作日志"""
        try:
            project_id = self._get_user_primary_project(userid)
            if not project_id:
                return "❌ 未关联项目，无法记录日志。"
            
            member_name = self._get_user_display_name(userid)
            
            # 用 AI 解析日志内容
            parsed = self._ai_parse_log(content)
            
            with DatabasePool.get_connection() as conn:
                conn.execute(DatabasePool.format_sql('''
                    INSERT INTO work_logs (project_id, member_name, log_date, work_content, 
                                          issues_encountered, tomorrow_plan, work_type, work_hours)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                '''), (
                    project_id,
                    member_name,
                    datetime.now().strftime('%Y-%m-%d'),
                    parsed.get('work_content', content),
                    parsed.get('issues', ''),
                    parsed.get('tomorrow_plan', ''),
                    '现场',
                    parsed.get('hours', 8)
                ))
            
            return (
                f"✅ **日志已记录**\n\n"
                f"📅 日期：{datetime.now().strftime('%Y-%m-%d')}\n"
                f"📝 内容：{parsed.get('work_content', content)[:80]}\n"
                f"⚠️ 问题：{parsed.get('issues', '无') or '无'}\n"
                f"📋 明日计划：{parsed.get('tomorrow_plan', '待补充') or '待补充'}"
            )
        except Exception as e:
            logger.error("Quick log failed: %s", e)
            return f"日志记录失败：{str(e)}"
    
    def _handle_quick_issue(self, userid: str, description: str) -> str:
        """快速上报问题"""
        try:
            project_id = self._get_user_primary_project(userid)
            if not project_id:
                return "❌ 未关联项目，无法上报问题。"
            
            # AI 判断严重级别
            severity = self._ai_judge_severity(description)
            
            # 检查是否有待关联的图片
            image_path = self._get_pending_image(userid)
            
            with DatabasePool.get_connection() as conn:
                conn.execute(DatabasePool.format_sql('''
                    INSERT INTO issues (project_id, issue_type, description, severity, status)
                    VALUES (?, ?, ?, ?, '待处理')
                '''), (project_id, '现场问题', description, severity))
                
                project = conn.execute(DatabasePool.format_sql('SELECT project_name FROM projects WHERE id = ?'), 
                                      (project_id,)).fetchone()
            
            # 如果是高危问题，额外通知项目经理
            if severity == '高':
                from services.wecom_push_service import wecom_push_service
                wecom_push_service.push_warning_to_manager(
                    project_id,
                    "新增高危问题",
                    f"上报人：{self._get_user_display_name(userid)}\n描述：{description}",
                    "high"
                )
            
            reply = (
                f"✅ **问题已上报**\n\n"
                f"📌 项目：{project['project_name'] if project else '未知'}\n"
                f"📝 描述：{description[:80]}\n"
                f"🔴 严重程度：{severity}\n"
                f"📊 状态：待处理"
            )
            if image_path:
                reply += f"\n📷 已附带截图"
            
            return reply
        except Exception as e:
            logger.error("Quick issue failed: %s", e)
            return f"问题上报失败：{str(e)}"
    
    def _handle_status(self, userid: str) -> str:
        """查看用户关联项目的状态概览"""
        try:
            with DatabasePool.get_connection() as conn:
                user = conn.execute(
                    DatabasePool.format_sql('SELECT id FROM users WHERE wecom_userid = ?'), (userid,)
                ).fetchone()
                
                if not user:
                    return "❌ 账号未绑定，请先通过Web端登录绑定企业微信。"
                
                # 获取用户的所有项目
                projects = conn.execute(DatabasePool.format_sql('''
                    SELECT p.project_name, p.hospital_name, p.status, p.progress, p.risk_score
                    FROM project_user_access pa
                    JOIN projects p ON pa.project_id = p.id
                    WHERE pa.user_id = ? AND p.status NOT IN ('已完成', '已终止', '已验收', '质保期')
                    ORDER BY p.risk_score DESC
                '''), (user['id'],)).fetchall()
                
                if not projects:
                    # fallback: 按 project_manager 匹配
                    display_name = conn.execute(DatabasePool.format_sql('SELECT display_name FROM users WHERE id = ?'), 
                                               (user['id'],)).fetchone()
                    if display_name:
                        projects = conn.execute(DatabasePool.format_sql('''
                            SELECT project_name, hospital_name, status, progress, risk_score
                            FROM projects WHERE project_manager = ? 
                            AND status NOT IN ('已完成', '已终止', '已验收', '质保期')
                        '''), (display_name['display_name'],)).fetchall()
                
                if not projects:
                    return "你目前没有进行中的项目。"
                
                lines = [f"📊 **我的项目概览**（{len(projects)} 个）\n"]
                for p in projects:
                    risk_icon = "🔴" if (p['risk_score'] or 0) >= 50 else "🟡" if (p['risk_score'] or 0) >= 20 else "🟢"
                    lines.append(
                        f"{risk_icon} **{p['project_name']}**\n"
                        f"   {p['hospital_name']} | {p['status']} | 进度 {p['progress']}%"
                    )
                
                lines.append(f"\n🔗 **[进入移动版控制台]({WECOM_CONFIG['APP_HOME_URL']}/m/)**")
                return "\n".join(lines)
        except Exception as e:
            return f"查询异常：{str(e)}"
    
    def _handle_bind(self, userid: str) -> str:
        """自定绑定/关联用户账户"""
        try:
            with DatabasePool.get_connection() as conn:
                # 1. 检查是否已绑定
                user = conn.execute(
                    DatabasePool.format_sql('SELECT id, display_name FROM users WHERE wecom_userid = ?'), (userid,)
                ).fetchone()
                
                if user:
                    return f"✅ 你已绑定到系统账户: **{user['display_name']}**\n无需重复操作。"
                
                # 2. 尝试通过姓名自动匹配 (忽略空格，支持模糊匹配或完全匹配)
                # 先从企微查真实姓名
                wecom_user = wecom_service.get_user_detail(userid)
                name = wecom_user.get('name')
                
                if name:
                    name_match = conn.execute(
                        DatabasePool.format_sql('SELECT id, display_name FROM users WHERE display_name = ? AND wecom_userid IS NULL'),
                        (name,)
                    ).fetchone()
                    
                    if name_match:
                        conn.execute(DatabasePool.format_sql('UPDATE users SET wecom_userid = ? WHERE id = ?'), (userid, name_match['id']))
                        conn.commit()
                        return f"✅ 自动绑定成功！\n系统已根据姓名识别出你的账户: **{name_match['display_name']}**。\n现在你可以接收项目预警消息了。"
                
                # 3. 无法自动匹配 -> 提供 OAuth2 绑定链接
                auth_url = wecom_service.get_oauth_url(f"{WECOM_CONFIG['APP_HOME_URL']}/api/wecom/oauth/callback", state="bind")
                return (
                    "🔍 抱歉，未能自动识别你的身份。\n\n"
                    "请点击下方链接登录你的系统账号完成绑定：\n"
                    f"🔗 [立即绑定账户]({auth_url})\n\n"
                    "💡 注意：请使用浏览器打开链接。"
                )
        except Exception as e:
            logger.error("Handle bind failed: %s", e)
            return f"绑定处理失败: {str(e)}"

    def _handle_smart_route(self, userid: str, content: str) -> str:
        """智能路由：无命令前缀时，AI 判断意图"""
        # 简单规则兜底（避免每条消息都调 AI）
        if any(kw in content for kw in ['进度', '状态', '多少', '几个', '哪些', '查一下']):
            return self._handle_query(userid, content)
        elif any(kw in content for kw in ['今天做了', '完成了', '处理了', '对接了', '调试了']):
            return self._handle_quick_log(userid, content)
        elif any(kw in content for kw in ['报错', '故障', '不行', '崩了', '挂了', '有问题']):
            return self._handle_quick_issue(userid, content)
        else:
            # 默认当做查询处理
            return self._handle_query(userid, content)
    
    def _get_help_text(self) -> str:
        """帮助信息"""
        return (
            "🤖 **ICU-PM 助手**\n\n"
            "📝 **记录日志**\n"
            "发送：`日志 今天完成了监护仪对接调试，明天处理接口问题`\n\n"
            "🔍 **查询数据**\n"
            "发送：`查询 当前有几个未解决的问题`\n"
            "或直接提问：`xx医院进度多少了`\n\n"
            "🚨 **上报问题**\n"
            "发送：`问题 GE监护仪协议解析异常，数据无法入库`\n"
            "也可以先发图片，再发文字描述\n\n"
            "📊 **项目概览**\n"
            "发送：`状态`\n\n"
            "💡 也可以不加前缀直接说话，系统会自动识别意图。\n\n"
            f"🔗 **[进入移动版控制台]({WECOM_CONFIG['APP_HOME_URL']}/m/)**"
        )
    
    # ===== 辅助方法 =====
    
    def _get_user_primary_project(self, wecom_userid: str) -> int:
        """获取用户的主项目ID（取最近活跃的）"""
        with DatabasePool.get_connection() as conn:
            user = conn.execute(
                DatabasePool.format_sql('SELECT id, display_name FROM users WHERE wecom_userid = ?'), (wecom_userid,)
            ).fetchone()
            
            if not user:
                return None
            
            # 优先从 project_user_access 找
            project = conn.execute(DatabasePool.format_sql('''
                SELECT pa.project_id FROM project_user_access pa
                JOIN projects p ON pa.project_id = p.id
                WHERE pa.user_id = ? AND p.status NOT IN ('已完成', '已终止', '已验收', '质保期')
                ORDER BY p.updated_at DESC LIMIT 1
            '''), (user['id'],)).fetchone()
            
            if project:
                return project['project_id']
            
            # fallback: 按 project_manager 匹配
            project = conn.execute(DatabasePool.format_sql('''
                SELECT id FROM projects 
                WHERE project_manager = ? AND status NOT IN ('已完成', '已终止', '已验收', '质保期')
                ORDER BY updated_at DESC LIMIT 1
            '''), (user['display_name'],)).fetchone()
            
            return project['id'] if project else None
    
    def _get_user_display_name(self, wecom_userid: str) -> str:
        with DatabasePool.get_connection() as conn:
            user = conn.execute(
                DatabasePool.format_sql('SELECT display_name FROM users WHERE wecom_userid = ?'), (wecom_userid,)
            ).fetchone()
            return user['display_name'] if user else wecom_userid
    
    def _ai_parse_log(self, text: str) -> dict:
        """用 AI 解析日志文本为结构化字段"""
        try:
            from services.ai_service import ai_service
            prompt = f"""请将以下工程师的工作日志文本解析为JSON格式。
输入文本: "{text}"

输出JSON（仅返回JSON，不要其他内容）:
{{"work_content": "今日工作内容", "issues": "遇到的问题（没有则为空字符串）", "tomorrow_plan": "明日计划（没有则为空字符串）", "hours": 8}}"""
            
            result = ai_service.call_ai_api(
                "你是一个JSON解析器，只输出合法JSON。", prompt, task_type="summary"
            )
            
            if result:
                # 尝试提取JSON
                result = result.strip()
                if result.startswith('```'):
                    result = result.split('```')[1].strip()
                    if result.startswith('json'):
                        result = result[4:].strip()
                return json.loads(result)
        except Exception as e:
            logger.warning("AI parse log failed: %s", e)
        
        # fallback：不拆分，原文作为 work_content
        return {"work_content": text, "issues": "", "tomorrow_plan": "", "hours": 8}
    
    def _ai_judge_severity(self, description: str) -> str:
        """AI 判断问题严重程度"""
        high_keywords = ['崩溃', '宕机', '数据丢失', '无法启动', '全部', '瘫痪', '停机', '紧急']
        medium_keywords = ['报错', '异常', '失败', '超时', '不稳定', '偶发']
        
        for kw in high_keywords:
            if kw in description:
                return '高'
        for kw in medium_keywords:
            if kw in description:
                return '中'
        return '低'
    
    # ===== 待关联图片暂存（简单内存缓存） =====
    _pending_images = {}
    
    def _save_pending_image(self, userid: str, path: str):
        self._pending_images[userid] = {"path": path, "time": datetime.now()}
    
    def _get_pending_image(self, userid: str) -> str:
        data = self._pending_images.pop(userid, None)
        if data and (datetime.now() - data["time"]).seconds < 300:
            return data["path"]
        return None


# 全局单例
wecom_msg_handler = WeComMsgHandler()
