# routes/wecom_routes.py
"""
企业微信路由
- /api/wecom/callback   → 消息回调（GET验证 + POST接收）
- /api/wecom/oauth      → OAuth2 登录
- /api/wecom/approval/* → 审批接口
"""

import logging
import xml.etree.ElementTree as ET
from flask import Blueprint, request, jsonify, redirect, render_template_string
from api_utils import api_response
from app_config import WECOM_CONFIG

logger = logging.getLogger(__name__)

wecom_bp = Blueprint('wecom', __name__, url_prefix='/api/wecom')


# ===== 消息回调 =====

@wecom_bp.route('/callback', methods=['GET'])
def verify_callback():
    """企业微信回调URL验证（GET请求）"""
    from services.wecom_service import wecom_service
    
    if not wecom_service.crypto:
        return "callback not configured", 403
    
    msg_signature = request.args.get('msg_signature', '')
    timestamp = request.args.get('timestamp', '')
    nonce = request.args.get('nonce', '')
    echostr = request.args.get('echostr', '')
    
    try:
        if wecom_service.crypto.verify_signature(msg_signature, timestamp, nonce, echostr):
            # 解密 echostr 返回明文
            plain = wecom_service.crypto.decrypt(echostr)
            return plain
        else:
            logger.warning("回调验证签名失败")
            return "signature error", 403
    except Exception as e:
        logger.error("回调验证异常: %s", e)
        return "error", 500


@wecom_bp.route('/callback', methods=['POST'])
def receive_callback():
    """接收企业微信回调消息（POST请求）"""
    from services.wecom_service import wecom_service
    from services.wecom_msg_handler import wecom_msg_handler
    
    if not wecom_service.crypto:
        return "callback not configured", 403
    # 获取加密参数
    msg_signature = request.args.get('msg_signature', '')
    timestamp = request.args.get('timestamp', '')
    nonce = request.args.get('nonce', '')
    post_data = request.data.decode('utf-8')
    
    # 甚至在解密前就开始记录（紧急调试）
    try:
        from database import DatabasePool
        import json
        with DatabasePool.get_connection() as conn:
            conn.execute(DatabasePool.format_sql('INSERT INTO wecom_debug_logs (msg_type, raw_xml) VALUES (?, ?)'), 
                         ('RAW_POST', f"Signature: {msg_signature}, Data: {post_data[:200]}..."))
            conn.commit()
    except Exception as e:
        logger.error("Failed to save raw wecom debug log: %s", e)

    try:
        # 解密
        plain_xml = wecom_service.crypto.decrypt_callback(
            msg_signature, timestamp, nonce, post_data
        )
        # 加这一行，打印原始解密后的 XML 供调试
        logger.debug("WeCom Decrypted XML: %s", plain_xml)
        
        msg = wecom_service.crypto.parse_msg_xml(plain_xml)
        
        # 将原始消息记录到数据库供调试
        try:
            from database import DatabasePool
            import json
            with DatabasePool.get_connection() as conn:
                conn.execute(DatabasePool.format_sql('''
                    INSERT INTO wecom_debug_logs (msg_type, raw_xml, parsed_json)
                    VALUES (?, ?, ?)
                '''), (msg.get('MsgType'), plain_xml, json.dumps(msg, ensure_ascii=False)))
                conn.commit()
        except Exception as db_err:
            logger.error("Failed to save wecom debug log: %s", db_err)
        
        logger.info("收到企业微信回调: MsgType=%s, From=%s", 
                    msg.get('MsgType'), msg.get('FromUserName'))
        
        msg_type = msg.get('MsgType', '')
        from_user = msg.get('FromUserName', '')
        reply_content = ""
        
        if msg_type == 'text':
            content = msg.get('Content', '')
            reply_content = wecom_msg_handler.handle_text_message(from_user, content)
            
        elif msg_type == 'image':
            media_id = msg.get('MediaId', '')
            reply_content = wecom_msg_handler.handle_image_message(from_user, media_id)
            
        elif msg_type == 'voice':
            # 优先尝试从消息中获取 Recognition 字段（企业微信某些版本或配置下可能包含）
            recognition = msg.get('Recognition') or msg.get('recognition') or ''
            
            if not recognition:
                # 如果没有自带识别结果，则手动下载并调用 AI 转录
                media_id = msg.get('MediaId', '')
                if media_id:
                    logger.info("语音消息识别结果为空，尝试手动转录 MediaID: %s", media_id)
                    import os
                    # 临时保存路径
                    save_path = os.path.join('temp', f"voice_{media_id}.amr")
                    os.makedirs('temp', exist_ok=True)
                    
                    try:
                        downloaded_path = wecom_service.get_media(media_id, save_path)
                        if downloaded_path:
                            from services.ai_service import ai_service
                            recognition = ai_service.transcribe_audio(downloaded_path)
                            # 删除临时文件
                            if os.path.exists(downloaded_path):
                                os.remove(downloaded_path)
                    except Exception as e:
                        logger.error("手动转录语音失败: %s", e)

            if recognition:
                logger.info("识别到语音内容: %s", recognition)
                # 把识别出的文字当作普通文本消息处理
                reply_content = wecom_msg_handler.handle_text_message(from_user, recognition)
            else:
                logger.warning("语音消息无法转录或未包含有效内容")
                reply_content = "抱歉，由于企业微信限制，目前无法直接识别该语音内容。建议您在我的“移动端控制台”中使用语音输入，或者发送文字消息。"
            
        elif msg_type == 'event':
            event_type = msg.get('Event', '')
            if event_type == 'click':
                # 菜单点击事件
                event_key = msg.get('EventKey', '')
                reply_content = _handle_menu_click(from_user, event_key)
            elif event_type == 'sys_approval_change':
                # 审批状态变更事件
                from services.wecom_approval_service import wecom_approval_service
                approval_info = msg.get('ApprovalInfo', {})
                wecom_approval_service.handle_approval_callback(approval_info)
                return "success"
            elif event_type == 'enter_agent':
                # 用户进入应用
                reply_content = "👋 欢迎使用 ICU-PM 项目管理助手！\n发送「帮助」查看可用命令。"
        
        # 被动回复消息（5秒内必须响应）
        if reply_content:
            # 由于被动回复有长度和格式限制，对于长内容改用主动推送
            if len(reply_content) > 500:
                # 先被动回复一个简短提示
                short_reply = "正在处理，请稍候..."
                # 异步主动推送完整内容
                import threading
                threading.Thread(
                    target=wecom_service.send_markdown,
                    args=(from_user, reply_content)
                ).start()
                reply_content = short_reply
            
            reply_xml = _build_text_reply(from_user, msg.get('ToUserName', ''), reply_content)
            encrypted_reply = wecom_service.crypto.encrypt_reply(reply_xml, nonce, timestamp)
            return encrypted_reply
        
        return "success"
        
    except Exception as e:
        logger.error("处理回调消息异常: %s", e, exc_info=True)
        return "success"  # 即使出错也返回 success，避免企业微信重试


def _build_text_reply(to_user: str, from_user: str, content: str) -> str:
    """构建被动回复的XML"""
    import time
    return (
        f"<xml>"
        f"<ToUserName><![CDATA[{to_user}]]></ToUserName>"
        f"<FromUserName><![CDATA[{from_user}]]></FromUserName>"
        f"<CreateTime>{int(time.time())}</CreateTime>"
        f"<MsgType><![CDATA[text]]></MsgType>"
        f"<Content><![CDATA[{content}]]></Content>"
        f"</xml>"
    )


def _handle_menu_click(userid: str, event_key: str) -> str:
    """处理自定义菜单点击"""
    from services.wecom_msg_handler import wecom_msg_handler
    
    handlers = {
        "menu_status": lambda: wecom_msg_handler._handle_status(userid),
        "menu_help": lambda: wecom_msg_handler._get_help_text(),
    }
    handler = handlers.get(event_key)
    return handler() if handler else f"未知的菜单操作: {event_key}"

# ===== OAuth2 登录 =====

@wecom_bp.route('/config', methods=['GET'])
def get_wecom_config():
    """获取企业微信配置（用于前端 JS SDK）"""
    return api_response(True, data={
        "corp_id": WECOM_CONFIG.get('CORP_ID'),
        "agent_id": WECOM_CONFIG.get('AGENT_ID'),
        "redirect_uri": f"{WECOM_CONFIG['APP_HOME_URL']}/api/wecom/sso/callback"
    })

@wecom_bp.route('/jssdk/config', methods=['POST'])
def generate_jssdk_config():
    """获取前端 JS-SDK 的鉴权配置"""
    from services.wecom_service import wecom_service
    
    data = request.json or {}
    url = data.get('url')
    if not url:
        return api_response(False, message="缺少页面 URL 参数")
        
    config = wecom_service.get_jssdk_config(url)
    if config:
        return api_response(True, data=config)
    return api_response(False, message="获取 JS-SDK 配置失败")

@wecom_bp.route('/oauth/login', methods=['GET'])
def oauth_login():
    """发起 OAuth2 登录"""
    from services.wecom_service import wecom_service
    
    home_url = WECOM_CONFIG.get('APP_HOME_URL', 'https://your-domain.com')
    if 'your-domain.com' in home_url:
        home_url = request.url_root.rstrip('/')
        
    redirect_uri = request.args.get('redirect_uri', home_url)
    callback_url = f"{home_url}/api/wecom/oauth/callback"
    oauth_url = wecom_service.get_qr_login_url(callback_url)
    return redirect(oauth_url)


@wecom_bp.route('/oauth/callback', methods=['GET'])
def oauth_callback():
    """OAuth2 回调"""
    from services.wecom_service import wecom_service
    from services.auth_service import auth_service
    
    code = request.args.get('code', '')
    if not code:
        return api_response(False, message="缺少授权码", code=400)
    
    # 用 code 换取用户身份
    wecom_user = wecom_service.get_user_by_code(code)
    if not wecom_user:
        return api_response(False, message="获取用户身份失败", code=401)
    
    wecom_userid = wecom_user.get('userid')
    state = request.args.get('state', 'login')
    
    # 获取首页 URL
    home_url = WECOM_CONFIG.get('APP_HOME_URL', 'https://your-domain.com')
    if 'your-domain.com' in home_url:
        home_url = request.url_root.rstrip('/')
    if not home_url.endswith('/'):
        home_url += '/'

    # Case 1: 绑定模式 (state='bind')
    if state == 'bind':
        # 验证当前是否有登录态
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            token = request.cookies.get('auth_token')
        
        user = auth_service.validate_token(token)
        if not user:
            # 可能是扫码后重定向到了这里但 Token 丢了（比如跨域或Cookie问题）
            # 对于 QR 扫码，通常是新的页面，所以需要用户已经有 Cookie
            return render_template_string("""
                <script>
                    alert('绑定失败：请先登录系统再进行绑定');
                    if (window.opener) { window.close(); }
                    else if (window.parent && window.parent !== window) { 
                        // If in iframe, maybe redirect parent to login
                        window.parent.location.reload(); 
                    }
                </script>
            """)
        
        bind_result = auth_service.bind_wecom(user['id'], wecom_userid)
        if bind_result.get('success'):
            return render_template_string("""
                <script>
                    alert('企业微信绑定成功！');
                    const target = window.opener || (window.parent !== window ? window.parent : null);
                    if (target) {
                        try {
                            target.location.reload();
                        } catch(e) {
                            window.location.href = "{{ home_url }}";
                        }
                        if (window.opener) window.close();
                    } else {
                        window.location.href = "{{ home_url }}";
                    }
                </script>
            """, home_url=home_url)
        else:
            return render_template_string("""
                <script>
                    alert('绑定失败：{{ message }}');
                    if (window.opener) window.close();
                </script>
            """, message=bind_result.get('message', '未知错误'))

    # Case 2: 登录模式 (默认)
    # 查找或创建本地用户
    result = auth_service.login_via_wecom(wecom_user)
    
    if result.get('success'):
        # 重定向到前端，带上 token
        token = result['token']
        from flask import make_response
        response = make_response(redirect(f"{home_url}?token={token}"))
        response.set_cookie('auth_token', token, httponly=True, max_age=86400)
        return response
    else:
        return api_response(False, message=result.get('message', '登录失败'), code=401)


# ===== 审批 API =====

@wecom_bp.route('/approval/departure/<int:departure_id>', methods=['POST'])
def submit_departure(departure_id):
    """提交离场审批"""
    from services.wecom_approval_service import wecom_approval_service
    
    data = request.json or {}
    userid = data.get('wecom_userid', '')
    
    if not userid:
        # 尝试从当前登录用户获取
        user = getattr(request, 'current_user', None)
        if user:
            from database import DatabasePool
            with DatabasePool.get_connection() as conn:
                u = conn.execute(DatabasePool.format_sql('SELECT wecom_userid FROM users WHERE id = ?'), (user['id'],)).fetchone()
                userid = u['wecom_userid'] if u else ''
    
    if not userid:
        return api_response(False, message="未提供企业微信用户ID", code=400)
    
    result = wecom_approval_service.submit_departure_approval(departure_id, userid)
    return api_response(result.get('success', False), data=result, 
                       message=result.get('message', ''))


@wecom_bp.route('/approval/change/<int:change_id>', methods=['POST'])
def submit_change(change_id):
    """提交变更审批"""
    from services.wecom_approval_service import wecom_approval_service
    
    data = request.json or {}
    userid = data.get('wecom_userid', '')
    if not userid:
        user = getattr(request, 'current_user', None)
        if user:
            from database import DatabasePool
            with DatabasePool.get_connection() as conn:
                u = conn.execute(DatabasePool.format_sql('SELECT wecom_userid FROM users WHERE id = ?'), (user['id'],)).fetchone()
                userid = u['wecom_userid'] if u else ''
    if not userid:
        return api_response(False, message="未提供企业微信用户ID", code=400)
    result = wecom_approval_service.submit_change_approval(change_id, userid)
    return api_response(result.get('success', False), data=result,
                       message=result.get('message', ''))


@wecom_bp.route('/approval/expense/<int:expense_id>', methods=['POST'])
def submit_expense(expense_id):
    """提交费用审批"""
    from services.wecom_approval_service import wecom_approval_service
    
    data = request.json or {}
    userid = data.get('wecom_userid', '')
    if not userid:
        user = getattr(request, 'current_user', None)
        if user:
            from database import DatabasePool
            with DatabasePool.get_connection() as conn:
                u = conn.execute(DatabasePool.format_sql('SELECT wecom_userid FROM users WHERE id = ?'), (user['id'],)).fetchone()
                userid = u['wecom_userid'] if u else ''
    if not userid:
        return api_response(False, message="未提供企业微信用户ID", code=400)
    result = wecom_approval_service.submit_expense_approval(expense_id, userid)
    return api_response(result.get('success', False), data=result,
                       message=result.get('message', ''))
@wecom_bp.route('/sso/callback', methods=['GET'])
def sso_callback():
    """企业微信扫码登录回调"""
    from services.wecom_service import wecom_service
    from services.auth_service import auth_service
    
    code = request.args.get('code', '')
    if not code:
        return redirect('/?login_error=no_code')
    
    # 用 code 换取用户身份
    wecom_user = wecom_service.get_user_by_code(code)
    if not wecom_user:
        return redirect('/?login_error=auth_failed')
    
    # 登录或自动注册
    result = auth_service.login_via_wecom(wecom_user)
    
    if result.get('success'):
        token = result['token']
        from flask import make_response
        response = make_response(redirect(f'/?token={token}'))
        response.set_cookie('auth_token', token, httponly=True, max_age=86400)
        return response
    else:
        return redirect('/?login_error=bindFailed')
