# ai_config.py
"""
AI模型配置文件 - 增强版
支持多API、智能回退、负载均衡
"""

import os
import time
import random
import logging
from dataclasses import dataclass
from typing import List, Dict, Optional
from enum import Enum

# 加载环境变量
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv 未安装时跳过

logger = logging.getLogger(__name__)


class TaskType(Enum):
    """任务类型枚举"""
    ANALYSIS = "analysis"      # 项目分析
    REPORT = "report"          # 周报生成
    CHAT = "chat"              # 简单对话
    CODE = "code"              # 代码相关
    SUMMARY = "summary"        # 摘要总结


@dataclass
class APIEndpoint:
    """API端点配置"""
    name: str
    api_key: str
    base_url: str
    models: List[str]
    free_limit: int = 200      # 每日免费额度
    priority: int = 1          # 优先级，数字越小越优先
    is_available: bool = True  # 是否可用
    last_error_time: float = 0 # 最后错误时间
    error_count: int = 0       # 连续错误次数


class AIConfigManager:
    """AI配置管理器 - 支持多API智能切换"""
    
    def __init__(self):
        self.endpoints: List[APIEndpoint] = []
        self.timeout = int(os.environ.get('AI_TIMEOUT', 180))
        self.max_retries = 3
        self.error_cooldown = 60  # 错误后冷却时间(秒) - 缩短为1分钟，允许快速重试
        self._init_endpoints()
        
        # 启动后台健康检查
        import threading
        self.health_thread = threading.Thread(target=self._health_check_loop, daemon=True)
        self.health_thread.start()

    def _health_check_loop(self):
        """定期后台检测 API 健康度"""
        time.sleep(5) # 启动后先等5秒
        while True:
            # logger.info("正在执行后台 AI API 健康度自检...") # Reduce log noise
            self.check_all_endpoints_health()
            # 动态调整检测间隔：有端点不健康时缩短间隔
            healthy_count = sum(1 for ep in self.endpoints if ep.is_available)
            interval = 300 if healthy_count < len(self.endpoints) else 1800  # 5分钟 vs 30分钟
            time.sleep(interval)

    def check_all_endpoints_health(self):
        """主动检测所有端点是否可用"""
        import requests
        import json
        
        for ep in self.endpoints:
            # 只检测不可用的端点，或定期检测所有？
            # 策略：如果端点已标记为不可用，或者距离上次检测超过一定时间，则检测
            
            try:
                # 使用一个极其廉价的模型和最简单的 Prompt 进行探测
                # 如果模型列表里有 gpt-4o-mini 或 gpt-3.5-turbo 优先用它们探测
                probe_model = ep.models[0]
                for m in ["gpt-4o-mini", "gpt-3.5-turbo", "deepseek-chat"]:
                    if m in ep.models:
                        probe_model = m
                        break
                
                headers = {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {ep.api_key}"
                }
                payload = {
                    "model": probe_model,
                    "messages": [{"role": "user", "content": "hi"}],
                    "max_tokens": 5,
                    "stream": True # 使用流式探测
                }
                
                start_time = time.time()
                response = requests.post(
                    ep.base_url,
                    headers=headers,
                    data=json.dumps(payload),
                    timeout=10, # 探测超时设短一点
                    stream=True
                )
                duration = time.time() - start_time

                # 判断自检是否通过：
                # 1. 200 OK 是标配成功
                # 2. 401 Unauthorized 虽然报错但证明鉴权逻辑已通，服务器存活
                # 3. 405 Method Not Allowed 如果是 POST 探测返回 405，说明 URL 路径配置错误（比如多了或少了 /v1/chat/completions）
                if response.status_code in [200, 401]:
                    # logger.info(f"端点 {ep.name} 自检通过 (HTTP {response.status_code})")
                    self.mark_endpoint_success(ep)
                elif response.status_code == 405:
                    logger.warning(f"端点 {ep.name} 配置异常 (HTTP 405): 接口路径可能不正确。请检查 Base URL 是否正确包含了 /v1/chat/completions 或其他必要后缀。")
                    self.mark_endpoint_error(ep)
                else:
                    error_body = response.text[:200]
                    logger.warning(f"端点 {ep.name} 自检失败 (HTTP {response.status_code}): {error_body}")
                    self.mark_endpoint_error(ep)

            except Exception as e:
                logger.warning(f"端点 {ep.name} 连接自检异常: {str(e)}")
                ep.last_error_time = time.time()
    
    def _init_endpoints(self):
        """初始化API端点 - 优先从数据库加载，环境变量作为fallback"""
        
        # 1. 尝试从数据库加载配置
        db_configs = self._load_from_database()
        if db_configs:
            for cfg in db_configs:
                models = cfg.get('models', [])
                if isinstance(models, str):
                    try:
                        import json
                        models = json.loads(models)
                    except:
                        models = [models] if models else []
                
                self.endpoints.append(APIEndpoint(
                    name=cfg['name'],
                    api_key=cfg['api_key'],
                    base_url=cfg['base_url'],
                    models=models,
                    priority=cfg.get('priority', 1),
                    is_available=bool(cfg.get('is_active', 1))
                ))
            logger.info(f"从数据库加载了 {len(self.endpoints)} 个 AI API 配置")
        else:
            logger.warning("数据库中未找到任何 AI 配置！请在管理界面中添加配置。")
        
        # 检查是否有可用端点
        if not self.endpoints:
            logger.error("没有配置任何 AI API 端点！请检查环境变量配置或在管理界面添加配置。")
    
    def _load_from_database(self):
        """从数据库加载AI配置"""
        try:
            import sqlite3
            conn = sqlite3.connect('database.db', check_same_thread=False)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            # 检查表是否存在
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_configs'")
            if not cursor.fetchone():
                conn.close()
                return []
            
            configs = cursor.execute('SELECT * FROM ai_configs WHERE is_active = 1 ORDER BY priority').fetchall()
            conn.close()
            return [dict(c) for c in configs]
        except Exception as e:
            logger.warning(f"从数据库加载配置失败: {e}")
            return []
    
    def reload_from_database(self):
        """重新从数据库加载配置（用于管理界面修改后刷新）"""
        self.endpoints.clear()
        self._init_endpoints()
    
    def get_available_endpoints(self) -> List[APIEndpoint]:
        """获取可用的API端点，按优先级排序"""
        now = time.time()
        available = []
        
        for ep in self.endpoints:
            # 检查是否在冷却期
            # STRICT MODE: 只要有1次错误，就根据冷却时间判断
            if ep.error_count >= 3: # Changed from 1 to 3
                if now - ep.last_error_time < self.error_cooldown:
                    continue
                else:
                    # 冷却期结束，重置错误计数
                    ep.error_count = 0
                    ep.is_available = True
            
            if ep.is_available:
                available.append(ep)
        
        return sorted(available, key=lambda x: x.priority)
    
    def mark_endpoint_error(self, endpoint: APIEndpoint):
        """标记端点错误"""
        endpoint.error_count += 1
        endpoint.last_error_time = time.time()
        # Strict Mode: 3次失败才禁用
        if endpoint.error_count >= 3:
            endpoint.is_available = False
            logger.warning(f"API端点 {endpoint.name} 调用失败，已熔断 (Three-Strike Policy)")
    
    def mark_endpoint_success(self, endpoint: APIEndpoint):
        """标记端点成功"""
        endpoint.error_count = 0
        endpoint.is_available = True
    
    def get_model_for_task(self, task_type: TaskType) -> Dict:
        """根据任务类型获取推荐模型"""
        
        recommendations = {
            TaskType.ANALYSIS: {
                "preferred": ["DeepSeek-V3.1", "DeepSeek-V3.2", "deepseek-v3", "deepseek-r1"],
                "temperature": 0.3
            },
            TaskType.REPORT: {
                "preferred": ["DeepSeek-V3.1", "deepseek-v3", "gpt-4o-mini"],
                "temperature": 0.4
            },
            TaskType.CHAT: {
                "preferred": ["DeepSeek-V3.1", "gpt-4o-mini", "deepseek-chat"],
                "temperature": 0.7
            },
            TaskType.CODE: {
                "preferred": ["DeepSeek-V3.2", "deepseek-v3", "gpt-4o"],
                "temperature": 0.2
            },
            TaskType.SUMMARY: {
                "preferred": ["DeepSeek-V3.1", "gpt-4o-mini", "deepseek-chat"],
                "temperature": 0.3
            }
        }
        
        return recommendations.get(task_type, recommendations[TaskType.ANALYSIS])
    
    def get_call_sequence(self, task_type: TaskType = TaskType.ANALYSIS) -> List[Dict]:
        """
        获取API调用序列
        返回一个按优先级排序的调用配置列表
        """
        sequence = []
        task_config = self.get_model_for_task(task_type)
        preferred_models = task_config["preferred"]
        
        for endpoint in self.get_available_endpoints():
            # 直接使用端点配置的模型顺序，严格遵循用户配置
            # 不再根据任务类型进行重排序
            if endpoint.models:
                sequence.append({
                    "endpoint": endpoint,
                    "models": endpoint.models,
                    "temperature": task_config["temperature"]
                })
        
        return sequence


# 全局配置管理器实例
ai_manager = AIConfigManager()


# ========== 兼容旧代码的配置 ==========
# 使用第一个可用端点作为默认配置
_default_endpoint = ai_manager.endpoints[0] if ai_manager.endpoints else None
AI_CONFIG = {
    "API_KEY": _default_endpoint.api_key if _default_endpoint else "",
    "BASE_URL": _default_endpoint.base_url if _default_endpoint else "",
    "MODEL": _default_endpoint.models[0] if _default_endpoint and _default_endpoint.models else "deepseek-v3",
    "FALLBACK_MODELS": _default_endpoint.models[1:] if _default_endpoint and len(_default_endpoint.models) > 1 else ["deepseek-chat", "gpt-4o-mini"],
    "TIMEOUT": ai_manager.timeout
}


def get_model_config(task_type="analysis"):
    """兼容函数：获取模型配置"""
    # 查找任务类型
    task_enum = TaskType.ANALYSIS
    for t in TaskType:
        if t.value == task_type:
            task_enum = t
            break
            
    config = ai_manager.get_model_for_task(task_enum)
    return {
        "model": config["preferred"][0],
        "fallback_models": config["preferred"][1:],
        "temperature": config["temperature"]
    }


def switch_to_backup_api():
    """获取备用API配置"""
    # 优先找 TAPI 作为备用，因为以前的主配置是这个
    target_name = "TAPI-DeepSeek"
    endpoint = None
    for ep in ai_manager.endpoints:
        if ep.name == target_name:
            endpoint = ep
            break
            
    if not endpoint and len(ai_manager.endpoints) > 1:
        # 如果找不到指定名称，使用第二个作为备用
        endpoint = ai_manager.endpoints[-1]
        
    if endpoint:
        return {
            "API_KEY": endpoint.api_key,
            "BASE_URL": endpoint.base_url,
            "MODEL": endpoint.models[0] if endpoint.models else "deepseek-chat",
            "FALLBACK_MODELS": endpoint.models[1:] if len(endpoint.models) > 1 else []
        }
    
    # 默认空配置
    return {
        "API_KEY": "",
        "BASE_URL": "",
        "MODEL": "",
        "FALLBACK_MODELS": []
    }

# ========== 百度网盘配置 (Baidu Netdisk) ==========
# 请前往 https://pan.baidu.com/union/console/app/list 创建应用获取
BAIDU_APP_KEY = "MgWB6yw9ZxkZwdUT6Au8YGYBF0mYSoSW"  # 填写 AppKey / Client ID
BAIDU_SECRET_KEY = "U59kcfpu3KCLbenNVRaENOmwSFmurodi"  # 填写 SecretKey / Client Secret
