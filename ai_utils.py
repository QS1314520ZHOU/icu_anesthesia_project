
import requests
import json
import logging
import time
from ai_config import ai_manager, TaskType

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def call_ai(prompt: str, task_type: str = 'analysis', system_prompt: str = None) -> str:
    """
    调用AI接口，支持自动回退和负载均衡
    :param prompt: 用户输入内容
    :param task_type: 任务类型 (analysis, report, chat, code, summary)
    :param system_prompt: 系统提示词 (可选)
    :return: AI返回的内容
    """
    # 兼容 call_deepseek_api 的参数格式
    # 如果第一个参数看起来像系统提示词且没有提供 system_prompt，则自动映射
    if system_prompt is None and ("你是一位" in prompt or "你是一个" in prompt):
        # 这是一个启发式判断，可能不完美，但在本项目中有效
        # 或者我们直接改变参数顺序：call_ai(user_content, task_type, system_prompt)
        pass
        
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
            logger.info(f"正在尝试调用 API: {endpoint.name} | 模型: {model} | URL: {endpoint.base_url}")
            
            try:
                headers = {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {endpoint.api_key}",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Accept": "application/json, text/event-stream"
                }
                
                messages = []
                if system_prompt:
                    messages.append({"role": "system", "content": system_prompt})
                messages.append({"role": "user", "content": prompt})

                payload = {
                    "model": model,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": 2000,
                    "stream": True # 强制开启 Stream 以适配 notion 等极其挑剔的端点
                }

                # 发起请求
                response = requests.post(
                    endpoint.base_url,
                    headers=headers,
                    data=json.dumps(payload),
                    timeout=ai_manager.timeout,
                    stream=True
                )

                if response.status_code == 200:
                    # 处理流式响应并聚合成完整文本
                    full_content = ""
                    try:
                        for line in response.iter_lines():
                            if not line:
                                continue
                            line_decode = line.decode('utf-8').strip()
                            if line_decode.startswith('data: '):
                                data_str = line_decode[6:].strip()
                                if data_str == '[DONE]':
                                    break
                                try:
                                    data = json.loads(data_str)
                                    # OpenAI 格式：choices[0].delta.content
                                    content = data.get('choices', [{}])[0].get('delta', {}).get('content', '')
                                    # 某些 API 可能是 choices[0].text (如果是旧版)
                                    if not content:
                                        content = data.get('choices', [{}])[0].get('text', '')
                                    full_content += content
                                except:
                                    continue
                        
                        if full_content:
                            # 标记成功
                            ai_manager.mark_endpoint_success(endpoint)
                            return full_content
                        else:
                            # 如果流读完了但没内容，可能是不支持流或者格式不对
                            logger.warning(f"端点 {endpoint.name} 流式读取完成但未获取到内容")
                            # 尝试非流式兜底（通常不会走到这里，但作为安全措施）
                    except Exception as e:
                        logger.error(f"解析流式响应异常: {str(e)}")

                else:
                    error_msg = f"API返回错误 {response.status_code}: {response.text}"
                    logger.warning(error_msg)
                    last_error = error_msg
                    
                    # 严重错误直接熔断该端点，不再尝试该端点的其他模型
                    # 特别是 401/403 (Auth/Quota) 或 405 (Path error) 应该直接换供应商
                    if response.status_code in [401, 403, 405, 429, 503, 500, 502, 504]:
                        if response.status_code == 405:
                             logger.warning(f"端点 {endpoint.name} 返回 405 Method Not Allowed。这通常意味着 Base URL 配置错误（路径不对）。")

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
