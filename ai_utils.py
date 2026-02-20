
import requests
import json
import logging
import time
from ai_config import ai_manager, TaskType

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def call_ai(prompt: str, task_type: str = 'analysis') -> str:
    """
    调用AI接口，支持自动回退和负载均衡
    :param prompt: 提示词
    :param task_type: 任务类型 (analysis, report, chat, code, summary)
    :return: AI返回的内容
    """
    # 转换任务类型字符串为枚举
    try:
        task_enum = TaskType(task_type)
    except ValueError:
        task_enum = TaskType.ANALYSIS

    # 获取调用序列
    call_sequence = ai_manager.get_call_sequence(task_enum)
    
    if not call_sequence:
        logger.error("没有可用的AI配置")
        return "系统配置错误：未找到可用的AI模型配置。"

    last_error = None

    for attempt in call_sequence:
        endpoint = attempt['endpoint']
        models = attempt['models']
        temperature = attempt['temperature']
        
        # 尝试该端点的每一个模型
        for model in models:
            logger.info(f"正在尝试调用 API: {endpoint.name} | 模型: {model}")
            
            try:
                headers = {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {endpoint.api_key}"
                }
                
                payload = {
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": temperature,
                    "max_tokens": 2000
                }

                # 发起请求
                response = requests.post(
                    endpoint.base_url,
                    headers=headers,
                    data=json.dumps(payload),
                    timeout=ai_manager.timeout
                )

                if response.status_code == 200:
                    result = response.json()
                    content = result['choices'][0]['message']['content']
                    
                    # 标记成功
                    ai_manager.mark_endpoint_success(endpoint)
                    return content
                else:
                    error_msg = f"API返回错误 {response.status_code}: {response.text}"
                    logger.warning(error_msg)
                    last_error = error_msg
                    
                    # 严重错误直接熔断该端点，不再尝试该端点的其他模型
                    # 特别是 401/403 (Auth/Quota) 应该直接换供应商
                    if response.status_code in [401, 403, 429, 503, 500, 502, 504]:
                        # 特殊处理 OneHub/NewAPI 的 503/404 错误，如果是模型不可用（one_hub_error），则只跳过该模型，不熔断端点
                        is_model_error = False
                        try:
                            error_json = response.json()
                            if "one_hub_error" in str(error_json) or "no available channel" in str(error_json).lower():
                                is_model_error = True
                        except:
                            pass
                            
                        if is_model_error:
                            logger.warning(f"模型 {model} 暂时不可用，尝试下一个模型...")
                            continue # 跳过当前模型，尝试该端点的下一个模型

                        logger.warning(f"检测到关键错误 {response.status_code}，触发端点熔断并尝试下一个供应商")
                        ai_manager.mark_endpoint_error(endpoint)
                        break # 跳出当前端点的模型循环，进入下一个 attempt (即下一个 endpoint)
                
            # 如果是网络问题也触发熔断
            except (requests.exceptions.RequestException, Exception) as e:
                error_msg = f"连接异常: {str(e)}"
                logger.warning(error_msg)
                last_error = error_msg
                ai_manager.mark_endpoint_error(endpoint)
                break # 跳出当前端点
        
        # 如果该端点所有模型都失败（或者被上方 break 跳出），且错误次数没达到熔断阈值(理论上上方已处理，这里作为兜底)
        # 注意：如果上方 break 了，说明 endpoint 已经被 mark_endpoint_error 了, is_available=False
        if not endpoint.is_available or endpoint.error_count > 0:
             continue # 尝试下一个 Endpoint

        # 如果只是普通失败（非熔断），循环结束后也会标记一次错误
        ai_manager.mark_endpoint_error(endpoint)

    # 所有尝试都失败
    logger.error("所有AI API调用均失败")
    return f"AI服务暂时不可用，请稍后再试。\n最后错误: {last_error}"
