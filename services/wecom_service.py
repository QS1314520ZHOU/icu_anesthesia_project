# services/wecom_service.py
"""
企业微信自建应用核心服务
- Access Token 管理（带缓存和自动续期）
- 应用消息推送（文本、Markdown、模板卡片）
- 用户身份查询（OAuth2 code 换 userid）
- 通讯录查询
"""

import time
import json
import logging
import requests
import threading
from app_config import WECOM_CONFIG, NOTIFICATION_CONFIG
from utils.wecom_crypto import WeComCrypto

logger = logging.getLogger(__name__)


class WeComService:
    """企业微信核心服务"""
    
    BASE_URL = "https://qyapi.weixin.qq.com/cgi-bin"
    
    def __init__(self):
        self._access_token = None
        self._token_expires_at = 0
        self._token_lock = threading.Lock()
        self._crypto = None
        
        # 初始加载配置
        self.reload_config()

    def reload_config(self):
        """从数据库重新加载配置"""
        try:
            from database import DatabasePool
            with DatabasePool.get_connection() as conn:
                # 检查表是否存在
                cursor = conn.cursor()
                cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='system_config'")
                if not cursor.fetchone():
                    return

                configs = conn.execute("SELECT config_key, value FROM system_config WHERE config_key LIKE 'wecom_%'").fetchall()
                for row in configs:
                    key = row['config_key'].upper()
                    val = row['value']
                    
                    if key == 'WECOM_ENABLED':
                        WECOM_CONFIG['ENABLED'] = val.lower() == 'true'
                    elif key == 'WECOM_CORP_ID':
                        WECOM_CONFIG['CORP_ID'] = val
                    elif key == 'WECOM_AGENT_ID':
                        try:
                            WECOM_CONFIG['AGENT_ID'] = int(val)
                        except:
                            pass
                    elif key == 'WECOM_SECRET':
                        WECOM_CONFIG['SECRET'] = val
                    elif key == 'WECOM_CALLBACK_TOKEN':
                        WECOM_CONFIG['CALLBACK_TOKEN'] = val
                    elif key == 'WECOM_CALLBACK_AES_KEY':
                        WECOM_CONFIG['CALLBACK_AES_KEY'] = val
                    elif key == 'WECOM_APP_HOME_URL':
                        WECOM_CONFIG['APP_HOME_URL'] = val
                    elif key == 'WECOM_WEBHOOK':
                        # 同时更新 Webhook 兜底配置
                        NOTIFICATION_CONFIG['WECOM_WEBHOOK'] = val

            if WECOM_CONFIG.get("ENABLED"):
                self._init_crypto()
                logger.info("企业微信自建应用服务已重载 (CorpID: %s, AgentID: %s)", 
                           WECOM_CONFIG.get("CORP_ID", "")[:6] + "***", WECOM_CONFIG.get("AGENT_ID"))
            else:
                self._crypto = None
                logger.info("企业微信自建应用服务已禁用")
                
        except Exception as e:
            logger.error("重载企业微信配置失败: %s", e)
    
    def _init_crypto(self):
        """初始化加解密模块"""
        if WECOM_CONFIG.get("CALLBACK_TOKEN") and WECOM_CONFIG.get("CALLBACK_AES_KEY"):
            self._crypto = WeComCrypto(
                token=WECOM_CONFIG["CALLBACK_TOKEN"],
                encoding_aes_key=WECOM_CONFIG["CALLBACK_AES_KEY"],
                corp_id=WECOM_CONFIG["CORP_ID"]
            )
    
    @property
    def crypto(self) -> WeComCrypto:
        return self._crypto
    
    @property
    def is_enabled(self) -> bool:
        return bool(WECOM_CONFIG.get("ENABLED") and WECOM_CONFIG.get("CORP_ID") and WECOM_CONFIG.get("SECRET"))
    
    # ===== Access Token 管理 =====
    
    def get_access_token(self) -> str:
        """获取 access_token（带缓存，线程安全）"""
        if self._access_token and time.time() < self._token_expires_at - 300:
            return self._access_token
        
        with self._token_lock:
            # Double-check
            if self._access_token and time.time() < self._token_expires_at - 300:
                return self._access_token
            
            return self._refresh_token()
    
    def _refresh_token(self) -> str:
        """刷新 access_token"""
        try:
            url = f"{self.BASE_URL}/gettoken"
            resp = requests.get(url, params={
                "corpid": WECOM_CONFIG["CORP_ID"],
                "corpsecret": WECOM_CONFIG["SECRET"]
            }, timeout=10)
            data = resp.json()
            
            if data.get("errcode") == 0:
                self._access_token = data["access_token"]
                self._token_expires_at = time.time() + data.get("expires_in", 7200)
                logger.info("企业微信 access_token 刷新成功，有效期 %ds", data.get("expires_in", 7200))
                return self._access_token
            else:
                logger.error("获取 access_token 失败: %s", data)
                return None
        except Exception as e:
            logger.error("获取 access_token 异常: %s", e)
            return None
    
    # ===== 消息推送 =====
    
    def send_text(self, userid: str, content: str) -> dict:
        """发送文本消息给指定用户"""
        return self._send_message({
            "touser": userid,
            "msgtype": "text",
            "agentid": WECOM_CONFIG["AGENT_ID"],
            "text": {"content": content}
        })
    
    def send_markdown(self, userid: str, content: str) -> dict:
        """发送 Markdown 消息给指定用户"""
        return self._send_message({
            "touser": userid,
            "msgtype": "markdown",
            "agentid": WECOM_CONFIG["AGENT_ID"],
            "markdown": {"content": content}
        })
    
    def send_text_to_all(self, content: str) -> dict:
        """发送文本消息给应用所有可见用户"""
        return self._send_message({
            "touser": "@all",
            "msgtype": "text",
            "agentid": WECOM_CONFIG["AGENT_ID"],
            "text": {"content": content}
        })
    
    def send_markdown_to_all(self, content: str) -> dict:
        """发送 Markdown 给所有人"""
        return self._send_message({
            "touser": "@all",
            "msgtype": "markdown",
            "agentid": WECOM_CONFIG["AGENT_ID"],
            "markdown": {"content": content}
        })
    
    def send_template_card(self, userid: str, card_data: dict) -> dict:
        """发送模板卡片消息"""
        return self._send_message({
            "touser": userid,
            "msgtype": "template_card",
            "agentid": WECOM_CONFIG["AGENT_ID"],
            "template_card": card_data
        })
    
    def _send_message(self, payload: dict) -> dict:
        """发送应用消息（内部通用方法）"""
        token = self.get_access_token()
        if not token:
            return {"errcode": -1, "errmsg": "access_token 获取失败"}
        
        try:
            url = f"{self.BASE_URL}/message/send?access_token={token}"
            resp = requests.post(url, json=payload, timeout=10)
            result = resp.json()
            
            if result.get("errcode") == 0:
                logger.info("消息发送成功 → %s", payload.get("touser", "unknown"))
            else:
                logger.warning("消息发送失败: %s", result)
            
            return result
        except Exception as e:
            logger.error("消息发送异常: %s", e)
            return {"errcode": -1, "errmsg": str(e)}
    
    # ===== OAuth2 身份验证 =====
    
    def get_oauth_url(self, redirect_uri: str, state: str = "wecom_login") -> str:
        """生成 OAuth2 授权链接（用于 Web 扫码登录）"""
        return (
            f"https://open.weixin.qq.com/connect/oauth2/authorize"
            f"?appid={WECOM_CONFIG['CORP_ID']}"
            f"&redirect_uri={requests.utils.quote(redirect_uri)}"
            f"&response_type=code"
            f"&scope=snsapi_privateinfo"
            f"&state={state}"
            f"&agentid={WECOM_CONFIG['AGENT_ID']}"
            f"#wechat_redirect"
        )
    
    def get_user_by_code(self, code: str) -> dict:
        """通过 OAuth2 code 获取用户身份"""
        token = self.get_access_token()
        if not token:
            return None
        
        try:
            url = f"{self.BASE_URL}/auth/getuserinfo"
            resp = requests.get(url, params={
                "access_token": token,
                "code": code
            }, timeout=10)
            data = resp.json()
            
            if data.get("errcode") == 0 and data.get("userid"):
                # 获取到了 userid，进一步拉取用户详情
                user_detail = self.get_user_detail(data["userid"])
                return {
                    "userid": data["userid"],
                    "name": user_detail.get("name", data["userid"]),
                    "email": user_detail.get("email", ""),
                    "mobile": user_detail.get("mobile", ""),
                    "avatar": user_detail.get("avatar", ""),
                    "department": user_detail.get("department", []),
                    "position": user_detail.get("position", "")
                }
            else:
                logger.warning("OAuth2 获取用户身份失败: %s", data)
                return None
        except Exception as e:
            logger.error("OAuth2 异常: %s", e)
            return None
    
    def get_user_detail(self, userid: str) -> dict:
        """查询通讯录中用户的详细信息"""
        token = self.get_access_token()
        if not token:
            return {}
        
        try:
            url = f"{self.BASE_URL}/user/get"
            resp = requests.get(url, params={
                "access_token": token,
                "userid": userid
            }, timeout=10)
            data = resp.json()
            return data if data.get("errcode") == 0 else {}
        except Exception as e:
            logger.error("查询用户详情异常: %s", e)
            return {}
    
    # ===== 媒体文件 =====
    
    def get_media(self, media_id: str, save_path: str) -> str:
        """下载临时素材（用于接收用户发送的图片等）"""
        token = self.get_access_token()
        if not token:
            return None
        
        try:
            url = f"{self.BASE_URL}/media/get"
            resp = requests.get(url, params={
                "access_token": token,
                "media_id": media_id
            }, timeout=30, stream=True)
            
            if resp.status_code == 200 and 'application/json' not in resp.headers.get('Content-Type', ''):
                with open(save_path, 'wb') as f:
                    for chunk in resp.iter_content(chunk_size=8192):
                        f.write(chunk)
                return save_path
            else:
                logger.warning("下载媒体文件失败: %s", resp.text[:200])
                return None
        except Exception as e:
            logger.error("下载媒体文件异常: %s", e)
            return None
    
    # ===== 审批 =====
    
    def create_approval(self, template_id: str, apply_data: dict, 
                        applicant_userid: str, approver_userids: list,
                        summary: list = None) -> dict:
        """提交审批申请"""
        token = self.get_access_token()
        if not token:
            return {"errcode": -1, "errmsg": "token获取失败"}
        
        payload = {
            "creator_userid": applicant_userid,
            "template_id": template_id,
            "use_template_approver": 0,
            "approver": [
                {"attr": 2, "userid": approver_userids}
            ],
            "apply_data": apply_data
        }
        
        if summary:
            payload["summary_list"] = [{"summary_info": [{"text": s} for s in summary]}]
        
        try:
            url = f"{self.BASE_URL}/oa/applyevent?access_token={token}"
            resp = requests.post(url, json=payload, timeout=10)
            return resp.json()
        except Exception as e:
            return {"errcode": -1, "errmsg": str(e)}
    
    def get_approval_detail(self, sp_no: str) -> dict:
        """查询审批详情"""
        token = self.get_access_token()
        if not token:
            return {}
        
        try:
            url = f"{self.BASE_URL}/oa/getapprovaldetail?access_token={token}"
            resp = requests.post(url, json={"sp_no": sp_no}, timeout=10)
            return resp.json()
        except Exception as e:
            return {"errcode": -1, "errmsg": str(e)}


# 全局单例
wecom_service = WeComService()
