import requests
import json
from datetime import datetime, timedelta
from ai_config import ai_manager, TaskType
from database import DatabasePool
from rag_service import rag_service

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
        errors = []
        
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
                    payload = {
                        "model": model,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_content}
                        ],
                        "temperature": temperature,
                        "max_tokens": 4096
                    }
                    
                    response = requests.post(
                        endpoint.base_url, 
                        headers=headers, 
                        json=payload, 
                        timeout=ai_manager.timeout
                    )
                    
                    if response.status_code == 200:
                        result = response.json()
                        content = result['choices'][0]['message']['content']
                        ai_manager.mark_endpoint_success(endpoint)
                        return content
                    else:
                        ai_manager.mark_endpoint_error(endpoint)
                        # ... error handling logic ...
                except Exception as e:
                    ai_manager.mark_endpoint_error(endpoint)
                    # ... more error handling ...
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
                        kb_items = conn.execute('SELECT title, content, category, tags, embedding FROM kb_items').fetchall()
                        kb_items = [dict(item) for item in kb_items]
                        
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
            print(f"Project Risk Analysis Failed: {e}")
            return [], 0

ai_service = AIService()
