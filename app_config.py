# app_config.py

import os

# ========== 企业微信自建应用配置 ==========
WECOM_CONFIG = {
    # 企业信息
    "CORP_ID": os.environ.get("WECOM_CORP_ID", ""),
    
    # 自建应用信息（管理后台 → 应用管理 → 自建应用）
    "AGENT_ID": int(os.environ.get("WECOM_AGENT_ID", 0)),
    "SECRET": os.environ.get("WECOM_SECRET", ""),
    
    # 回调配置（管理后台 → 应用 → 接收消息 → 设置API接收）
    "CALLBACK_TOKEN": os.environ.get("WECOM_CALLBACK_TOKEN", ""),
    "CALLBACK_AES_KEY": os.environ.get("WECOM_CALLBACK_AES_KEY", ""),
    
    # 应用主页URL（用户点击应用时跳转的地址）
    "APP_HOME_URL": os.environ.get("WECOM_APP_HOME_URL", "https://dxm.jylb.fun"),
    
    # 是否启用自建应用模式（False则仅用Webhook）
    "ENABLED": os.environ.get("WECOM_ENABLED", "false").lower() == "true",
}

# ========== 通知配置（保留原有Webhook作为fallback） ==========
NOTIFICATION_CONFIG = {
    "WECOM_WEBHOOK": os.environ.get("WECOM_WEBHOOK", ""),
    "SMTP_SERVER": os.environ.get("SMTP_SERVER", "smtp.qq.com"),
    "SMTP_PORT": int(os.environ.get("SMTP_PORT", 465)),
    "SMTP_USER": os.environ.get("SMTP_USER", ""),
    "SMTP_PASSWORD": os.environ.get("SMTP_PASSWORD", ""),
    "EMAIL_RECEIVERS": [],
    "ENABLE_WECOM": os.environ.get("ENABLE_WECOM", "False").lower() == "true",
    "ENABLE_EMAIL": os.environ.get("ENABLE_EMAIL", "False").lower() == "true"
}


# ========== 项目状态定义 ==========
PROJECT_STATUS = {
    "待启动": {"next": ["进行中"], "color": "#9ca3af"},
    "进行中": {"next": ["试运行", "暂停", "离场待返"], "color": "#3b82f6"},
    "试运行": {"next": ["验收中", "进行中"], "color": "#8b5cf6"},
    "验收中": {"next": ["已验收", "试运行"], "color": "#f59e0b"},
    "已验收": {"next": ["质保期"], "color": "#10b981"},
    "质保期": {"next": ["已完成"], "color": "#06b6d4"},
    "暂停": {"next": ["进行中", "离场待返", "已终止"], "color": "#f97316"},
    "离场待返": {"next": ["进行中", "已终止"], "color": "#ec4899"},
    "已终止": {"next": [], "color": "#ef4444"},
    "已完成": {"next": [], "color": "#22c55e"}
}

# ========== 项目模板定义 ==========
PROJECT_TEMPLATES = {
    "standard_icu": {
        "name": "标准ICU项目",
        "description": "完整的ICU信息化项目，包含全部标准阶段",
        "estimated_days": 90,
        "stages": [
            {"name": "项目启动", "duration": 3, "tasks": ["项目立项", "团队组建", "环境准备"]},
            {"name": "需求调研", "duration": 7, "tasks": ["需求访谈", "流程梳理", "需求文档评审"]},
            {"name": "系统部署", "duration": 5, "tasks": ["服务器部署", "数据库配置", "网络调试"]},
            {"name": "表单制作", "duration": 10, "tasks": ["表单设计说明书", "表单配置", "表单测试"]},
            {"name": "接口对接", "duration": 15, "tasks": ["接口文档确认", "接口开发", "接口联调"]},
            {"name": "设备对接", "duration": 10, "tasks": ["设备清单确认", "通信测试", "数据解析"]},
            {"name": "系统培训", "duration": 5, "tasks": ["管理员培训", "护士培训", "医生培训"]},
            {"name": "试运行", "duration": 14, "tasks": ["试运行启动", "问题收集", "优化调整"]},
            {"name": "验收上线", "duration": 3, "tasks": ["验收报告", "资料交接", "正式上线"]}
        ]
    },
    "quick_deploy": {
        "name": "快速部署项目",
        "description": "简化流程的快速部署项目",
        "estimated_days": 30,
        "stages": [
            {"name": "需求确认", "duration": 3, "tasks": ["需求确认会议", "配置清单"]},
            {"name": "快速部署", "duration": 10, "tasks": ["系统部署", "基础配置", "接口对接"]},
            {"name": "培训验收", "duration": 7, "tasks": ["用户培训", "验收测试", "正式上线"]}
        ]
    },
    "equipment_upgrade": {
        "name": "设备升级项目",
        "description": "仅涉及设备对接升级的项目",
        "estimated_days": 21,
        "stages": [
            {"name": "设备调研", "duration": 3, "tasks": ["设备清单", "协议确认"]},
            {"name": "对接开发", "duration": 10, "tasks": ["驱动开发", "数据解析", "入库测试"]},
            {"name": "验收交付", "duration": 5, "tasks": ["现场测试", "培训交接", "验收上线"]}
        ]
    },
    "maintenance": {
        "name": "运维保障项目",
        "description": "质保期或运维服务项目",
        "estimated_days": 365,
        "stages": [
            {"name": "运维启动", "duration": 1, "tasks": ["服务协议", "对接人确认"]},
            {"name": "日常运维", "duration": 360, "tasks": ["问题响应", "系统巡检", "版本升级"]},
            {"name": "服务总结", "duration": 3, "tasks": ["服务报告", "满意度调查"]}
        ]
    }
}
