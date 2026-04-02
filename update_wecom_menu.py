import os
import sys

# Ensure the app context and environment variables are loaded
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from app_config import WECOM_CONFIG
from services.wecom_service import wecom_service

def setup_menu():
    wecom_service.reload_config()
    print("WECOM_CONFIG loaded:", WECOM_CONFIG)
    if not wecom_service.is_enabled:
        print("WeCom service is not enabled or missing configuration. enabled:", WECOM_CONFIG.get('ENABLED'))
        return

    home_url = WECOM_CONFIG.get('APP_HOME_URL', '')
    if not home_url:
        print("APP_HOME_URL is not configured.")
        return

    # Use the OAuth URL generator to ensure proper identity mapping when they click
    # The get_oauth_url already creates a link like https://open.weixin...
    mobile_index_url = wecom_service.get_oauth_url(f"{home_url}/m/")
    quick_log_url = wecom_service.get_oauth_url(f"{home_url}/m/quick-log")
    meeting_note_url = wecom_service.get_oauth_url(f"{home_url}/m/meeting-note")
    ai_chat_url = wecom_service.get_oauth_url(f"{home_url}/m/chat")

    # Define the menu structure
    menu_data = {
        "button": [
            {
                "type": "view",
                "name": "📱 移动控制台",
                "url": mobile_index_url
            },
            {
                "name": "⚡ 快捷操作",
                "sub_button": [
                    {
                        "type": "view",
                        "name": "📝 写日志",
                        "url": quick_log_url
                    },
                    {
                        "type": "view",
                        "name": "🤝 沟通速记",
                        "url": meeting_note_url
                    }
                ]
            },
            {
                "type": "view",
                "name": "🤖 AI 智询",
                "url": ai_chat_url
            }
        ]
    }

    print("Creating WeCom menu...")
    result = wecom_service.create_menu(menu_data)
    print("Result:", result)

if __name__ == "__main__":
    setup_menu()
