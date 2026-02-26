import requests
import json
import logging
from datetime import datetime, timedelta
from ai_config import ai_manager, TaskType
from database import DatabasePool
from rag_service import rag_service

logger = logging.getLogger(__name__)

class AIService:
    @staticmethod
    def call_ai_api(system_prompt, user_content, task_type="analysis"):
        """调用AI API，支持多端点智能自动回退和健康监测"""
        # 转换任务类型为枚举
        task_enum = TaskType.ANALYSIS
        for t in TaskType:
            if t.value == task_type:
                task_enum = t
                break
                
        sequence = ai_manager.get_call_sequence(task_enum)
        print(f"[AI] 获取到 {len(sequence)} 个端点序列, task_type={task_type}")
        
        if not sequence:
            print("[AI] 无可用端点！所有端点可能已被熔断")
            return None
        
        for item in sequence:
            endpoint = item["endpoint"]
            models = item["models"]
            temperature = item["temperature"]
            
            headers = {
                "Authorization": f"Bearer {endpoint.api_key}",
                "Content-Type": "application/json"
            }
            
            for model in models:
                try:
                    print(f"[AI] 尝试 {endpoint.name} / {model}...")
                    payload = {
                        "model": model,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_content}
                        ],
                        "temperature": temperature,
                        "max_tokens": 4096
                    }
                    
                    # 先尝试流式（notion端点要求stream=true）
                    response = requests.post(
                        endpoint.base_url, 
                        headers=headers, 
                        json={**payload, "stream": True}, 
                        timeout=ai_manager.timeout,
                        stream=True
                    )
                    
                    print(f"[AI] {model} -> HTTP {response.status_code}")
                    
                    if response.status_code == 200:
                        full_content = ""
                        line_count = 0
                        try:
                            for line in response.iter_lines():
                                if not line:
                                    continue
                                line_count += 1
                                line_decode = line.decode('utf-8').strip()
                                # 打印前5行原始内容，用于调试流式格式
                                if line_count <= 5:
                                    print(f"[AI] {model} 原始行{line_count}: {line_decode[:200]}")
                                if line_decode.startswith('data: '):
                                    data_str = line_decode[6:].strip()
                                    if data_str == '[DONE]':
                                        break
                                    try:
                                        data = json.loads(data_str)
                                        content = data.get('choices', [{}])[0].get('delta', {}).get('content', '')
                                        if not content:
                                            content = data.get('choices', [{}])[0].get('text', '')
                                        if not content:
                                            content = data.get('choices', [{}])[0].get('message', {}).get('content', '')
                                        full_content += content
                                    except:
                                        continue
                            
                            print(f"[AI] {model} 流式完成: {line_count}行, {len(full_content)}字符")
                            if full_content:
                                ai_manager.mark_endpoint_success(endpoint)
                                return full_content
                        except Exception as e:
                            print(f"[AI] {model} 流式解析异常: {str(e)}")
                    elif response.status_code == 500 and 'stream=true' not in response.text:
                        # 端点不支持流式，尝试非流式
                        try:
                            resp2 = requests.post(
                                endpoint.base_url, headers=headers,
                                json={**payload, "stream": False},
                                timeout=ai_manager.timeout
                            )
                            if resp2.status_code == 200:
                                result = resp2.json()
                                c = result.get('choices', [{}])[0].get('message', {}).get('content', '')
                                if c:
                                    print(f"[AI] {model} 非流式成功! 返回 {len(c)} 字符")
                                    ai_manager.mark_endpoint_success(endpoint)
                                    return c
                        except:
                            pass
                        print(f"[AI] {model} 非流式也失败")
                    else:
                        err_body = response.text[:300] if response.text else "空"
                        print(f"[AI] {model} 失败 HTTP {response.status_code}: {err_body}")
                except Exception as e:
                    print(f"[AI] {model} 请求异常: {str(e)}")
            
            # 只有当该端点的所有模型都失败时，才标记一次端点错误
            ai_manager.mark_endpoint_error(endpoint)
            print(f"[AI] 端点 {endpoint.name} 所有模型失败，错误计数: {endpoint.error_count}")
        
        print("[AI] 所有端点和模型均失败，返回 None")
        return None

    @staticmethod
    def get_embeddings(text):
        """获取文本的向量表示，支持多端点回退"""
        sequence = ai_manager.get_available_endpoints()
        
        for endpoint in sequence:
            # 尝试推测 embeddings 接口地址
            embed_url = endpoint.base_url.replace('/chat/completions', '/embeddings')
            
            headers = {
                "Authorization": f"Bearer {endpoint.api_key}",
                "Content-Type": "application/json"
            }
            
            try:
                # 使用验证通过的模型
                embedding_model = "text-embedding-3-small"
                
                payload = {
                    "model": embedding_model,
                    "input": text
                }
                
                response = requests.post(embed_url, headers=headers, json=payload, timeout=10)
                
                if response.status_code == 200:
                    result = response.json()
                    embedding = result['data'][0]['embedding']
                    return embedding
            except:
                continue
        return None

    @staticmethod
    def analyze_project_risks(project_id):
        """基于项目进度、逾期情况、工作日志及语义知识库综合评估风险"""
        try:
            with DatabasePool.get_connection() as conn:
                # cursor = conn.cursor()  <-- Remove redundant cursor creation since we use conn.execute
                risk_score = 0
                detected_risks = []
                
                # 1. 结构化风险扫描 (里程碑、整体进度)
                overdue_milestones = conn.execute('''
                    SELECT name, target_date FROM milestones 
                    WHERE project_id = ? AND is_completed = 0 AND target_date < date('now')
                ''', (project_id,)).fetchall()
                
                for m in overdue_milestones:
                    risk_score += 20
                    detected_risks.append({"type": "进度逾期", "keyword": "里程碑逾期", "content": f"里程碑【{m['name']}】已逾期", "date": m['target_date']})

                project = conn.execute('SELECT * FROM projects WHERE id = ?', (project_id,)).fetchone()
                if project and project['plan_end_date'] and project['plan_end_date'] < datetime.now().strftime('%Y-%m-%d'):
                    if project['status'] not in ['已完成', '已验收', '质保期']:
                        risk_score += 30
                        detected_risks.append({"type": "进度逾期", "keyword": "项目整体延期", "content": "项目计划结束日期已过，但尚未进入验收"})

                # 2. 语义增强 RAG 扫描 (Semantic RAG)
                # 获取最近一周的日志
                week_ago = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
                try:
                    logs = conn.execute('SELECT work_content, issues_encountered FROM work_logs WHERE project_id = ? AND log_date >= ?', (project_id, week_ago)).fetchall()
                    
                    log_text = " ".join([(l['work_content'] or "") + " " + (l['issues_encountered'] or "") for l in logs])
                    
                    if log_text:
                        # 获取全库知识项用于 RAG
                        rows = conn.execute('SELECT title, content, category, tags, embedding FROM knowledge_base').fetchall()
                        kb_items = [dict(row) for row in rows]
                        
                        # 获取日志的向量表示
                        log_vector = AIService.get_embeddings(log_text[:2000]) # 限制长度
                        
                        # 使用 Hybrid Search 检索相关风险案例
                        if log_vector:
                            context = rag_service.retrieve_context(log_text, kb_items, top_k=2, query_vector=log_vector)
                            
                            if context:
                                detected_risks.append({
                                    "type": "语义风险匹配",
                                    "keyword": "知识库关联",
                                    "content": f"基于历史案例分析发现潜在关联风险：\n{context}"
                                })
                                risk_score += 15 # 给语义匹配增加一定风险分
                except Exception as e:
                    print(f"RAG Scan Failed: {e}")

                # 3. 持久化风险评估结果到数据库 (性能关键点)
                analysis_json = json.dumps(detected_risks, ensure_ascii=False)
                conn.execute('''
                    UPDATE projects 
                    SET risk_score = ?, risk_analysis = ?, updated_at = CURRENT_TIMESTAMP 
                    WHERE id = ?
                ''', (risk_score, analysis_json, project_id))
                conn.commit()

                return detected_risks, risk_score
        except Exception as e:
            print(f"Risk Analysis Failed: {e}")
            return [], 0

    @staticmethod
    def transcribe_audio(file_path: str) -> str:
        """根据音频文件进行转录"""
        try:
            # 这里的实现取决于具体的 ASR 服务。
            # 假设我们使用的是 OpenAI-compatible 接口且支持 /v1/audio/transcriptions
            sequence = ai_manager.get_available_endpoints()
            for item in sequence:
                endpoint = item["endpoint"]
                # 尝试猜测音频转录路径
                audio_url = endpoint.base_url.replace('/chat/completions', '/audio/transcriptions')
                
                headers = {
                    "Authorization": f"Bearer {endpoint.api_key}"
                }
                
                with open(file_path, 'rb') as f:
                    files = {
                        'file': (os.path.basename(file_path), f, 'audio/amr')
                    }
                    data = {
                        "model": "sensevoice-v1" # 或者是 whisper-1 等
                    }
                    
                    response = requests.post(audio_url, headers=headers, files=files, data=data, timeout=60)
                    if response.status_code == 200:
                        return response.json().get('text', '')
            return ""
        except Exception as e:
            logger.error(f"语音转录异常: {e}")
            return ""

ai_service = AIService()
