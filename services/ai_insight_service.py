from datetime import datetime, timedelta
from database import DatabasePool
from services.ai_service import ai_service
import json
import logging

logger = logging.getLogger(__name__)


class AIInsightService:
    @staticmethod
    def generate_daily_advice(project_id, force_refresh=False):
        """聚合日报、任务和进度，生成AI每日建议（支持当日缓存）"""
        try:
            today_date = datetime.now().strftime('%Y-%m-%d')
            
            # 1. 检查缓存
            if not force_refresh:
                with DatabasePool.get_connection() as conn:
                    cache = conn.execute('''
                        SELECT content FROM ai_report_cache 
                        WHERE project_id = ? AND report_type = 'daily_advice'
                        AND date(created_at) = ?
                    ''', (project_id, today_date)).fetchone()
                    if cache:
                        return cache['content']

            with DatabasePool.get_connection() as conn:
                # 2. 获取项目基本信息
                project = conn.execute('SELECT id, project_name, progress, status FROM projects WHERE id = ?', (project_id,)).fetchone()
                if not project:
                    return "项目不存在"

                # 3. 获取最近 3 天的日报
                three_days_ago = (datetime.now() - timedelta(days=3)).strftime('%Y-%m-%d')
                reports = conn.execute('''
                    SELECT log_date, work_content, issues_encountered 
                    FROM work_logs 
                    WHERE project_id = ? AND log_date >= ?
                    ORDER BY log_date DESC
                ''', (project_id, three_days_ago)).fetchall()
                
                report_text = "\n".join([
                    f"[{r['log_date']}] 工作: {r['work_content']} | 问题: {r['issues_encountered']}" 
                    for r in reports
                ]) if reports else "最近无日报记录"

                # 4. 获取近期未完成的高优先级任务
                tasks = conn.execute('''
                    SELECT t.task_name, s.stage_name 
                    FROM tasks t
                    JOIN project_stages s ON t.stage_id = s.id
                    WHERE s.project_id = ? AND t.is_completed = 0
                    LIMIT 10
                ''', (project_id,)).fetchall()
                
                task_text = "\n".join([f"- {t['stage_name']}: {t['task_name']}" for t in tasks]) if tasks else "当前无待办任务"

                # 5. 构造 Prompt
                system_prompt = """你是一名世界顶级 ICU 医疗信息化项目总监 (Project Director)。
你的任务是根据项目数据进行深度穿透分析。严禁使用“您好”、“有什么可以帮您”等任何客套话。
你的回复必须直接、专业、极简，像是一份呈送给高管的紧急简报。

格式要求 (严格执行)：
1. 🎯 **现状定性**：一句话说明项目当前的核心基调。
2. 🚩 **红线预警**：仅列出最致命的1个风险。
3. ⚡ **当日必办**：给出3条“如果不做就会导致延期”的极其具体的指令。
注意：直接输出内容，不要任何前缀或后缀。"""

                user_content = f"""你是一名世界顶级 ICU 医疗信息化项目总监。请根据以下项目数据进行深度穿透分析。
严禁使用"您好"、"有什么可以帮您"等客套话，严禁询问用户需求，直接输出分析结果。

格式要求（严格执行）：
1. 🎯 **现状定性**：一句话说明项目当前的核心基调。
2. 🚩 **红线预警**：仅列出最致命的1个风险。
3. ⚡ **当日必办**：给出3条"如果不做就会导致延期"的极其具体的指令。

项目名称: {project['project_name']}
当前状态: {project['status']} (进度: {project['progress']}%)

【近期日报摘要】
{report_text}

【待办任务清单】
{task_text}

请直接输出分析结果，不要任何前缀或后缀："""

                # 6. 调用 AI
                advice = ai_service.call_ai_api(system_prompt, user_content, task_type="analysis")
                
                if advice:
                    # 7. 更新缓存
                    with DatabasePool.get_connection() as conn:
                        # 先删除今日旧缓存
                        conn.execute('''
                            DELETE FROM ai_report_cache 
                            WHERE project_id = ? AND report_type = 'daily_advice'
                            AND date(created_at) = ?
                        ''', (project_id, today_date))
                        
                        res = conn.execute('''
                            INSERT INTO ai_report_cache (project_id, report_type, content, created_at)
                            VALUES (?, ?, ?, ?)
                        ''', (project_id, 'daily_advice', advice, datetime.now().strftime('%Y-%m-%d %H:%M:%S')))
                        conn.commit()
                        print(f"[DEBUG] Cache saved for project {project_id}, rowcount: {res.rowcount}")
                
                return advice or "AI 暂时无法生成建议，请核查网络或配置。"
        except Exception as e:
            print(f"Generate Daily Advice Error: {e}")
            return f"生成 AI 建议时发生错误: {str(e)}"


    @staticmethod
    def analyze_trends(project_id):
        """分析项目风险趋势、速度和问题密度"""
        try:
            with DatabasePool.get_connection() as conn:
                # 1. 获取近30天的风险评分历史
                history = conn.execute('''
                    SELECT record_date, risk_score, sentiment_score 
                    FROM project_risk_history 
                    WHERE project_id = ? 
                    ORDER BY record_date ASC
                    LIMIT 30
                ''', (project_id,)).fetchall()
                
                dates = [h['record_date'] for h in history]
                risk_scores = [h['risk_score'] for h in history]
                sentiment_scores = [h['sentiment_score'] for h in history]

                # 2. 计算Velocity (每周完成任务数) - 近4周
                velocity_data = []
                for i in range(4):
                    start_date = (datetime.now() - timedelta(weeks=i+1)).strftime('%Y-%m-%d')
                    end_date = (datetime.now() - timedelta(weeks=i)).strftime('%Y-%m-%d')
                    count = conn.execute('''
                        SELECT COUNT(*) as completed_count
                        FROM tasks t
                        JOIN project_stages s ON t.stage_id = s.id
                        WHERE s.project_id = ? AND t.is_completed = 1 
                        AND t.completed_date >= ? AND t.completed_date < ?
                    ''', (project_id, start_date, end_date)).fetchone()['completed_count']
                    velocity_data.append({'week_start': start_date, 'count': count})
                velocity_data.reverse() # 按时间正序

                # 3. 计算问题密度趋势 (活跃问题数) - 简单采样
                issue_trend = []
                # 注意：由于没有问题历史快照表，这里暂时只能返回当前问题状态，或者基于 issues 表的 created_at/resolved_at 倒推
                # 这里采用简化方案：按周统计“新增问题”和“解决问题”
                for i in range(4):
                    start_date = (datetime.now() - timedelta(weeks=i+1)).strftime('%Y-%m-%d')
                    end_date = (datetime.now() - timedelta(weeks=i)).strftime('%Y-%m-%d')
                    created = conn.execute('SELECT COUNT(*) as c FROM issues WHERE project_id=? AND created_at >= ? AND created_at < ?', (project_id, start_date, end_date)).fetchone()['c']
                    resolved = conn.execute('SELECT COUNT(*) as c FROM issues WHERE project_id=? AND resolved_at >= ? AND resolved_at < ?', (project_id, start_date, end_date)).fetchone()['c']
                    issue_trend.append({'week_start': start_date, 'created': created, 'resolved': resolved})
                issue_trend.reverse()

                return {
                    'dates': dates,
                    'risk_scores': risk_scores,
                    'sentiment_scores': sentiment_scores,
                    'velocity': velocity_data,
                    'issue_trend': issue_trend
                }
        except Exception as e:
            print(f"Error analyzing trends: {e}")
            return {'error': str(e)}


    @staticmethod
    def analyze_sentiment(project_id):
        """分析项目情感倾向与四维度评分"""
        try:
            with DatabasePool.get_connection() as conn:
                # 获取近7天日报与未解决的高优先级问题
                seven_days_ago = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
                logs = conn.execute("SELECT work_content, issues_encountered FROM work_logs WHERE project_id=? AND log_date >= ?", (project_id, seven_days_ago)).fetchall()
                # issues表没有 title/priority, 使用 issue_type/description/severity
                issues = conn.execute("SELECT issue_type, description, severity FROM issues WHERE project_id=? AND status != '已解决'", (project_id,)).fetchall()
                
                text_corpus = "\n".join([f"Log: {l['work_content']} {l['issues_encountered']}" for l in logs])
                text_corpus += "\n".join([f"Issue: [{i['issue_type']}] {i['description']} (Severity: {i['severity']})" for i in issues])
                
                if not text_corpus.strip():
                    return {'scores': {'client': 8, 'team': 8, 'tech': 8, 'progress': 8}, 'signals': []}

                system_prompt = """你是一个专业的项目风险分析引擎。请基于项目日志和当前问题，对项目的健康度进行多维度评估 (0-10分，10最好)。

评估维度：
1. 客户满意度 (Client Satisfaction)
2. 团队士气 (Team Morale)
3. 技术稳定性 (Technical Stability)
4. 进度信心 (Progress Confidence)

严重等级判定规则 (Severity)：
- Critical: 涉及“停止履行合同”、“主动退场”、“核心团队解散”、“项目中止”等致命风险。
- High: 存在多个高优先级 Bug，或关键路径里程碑已严重失控。
- Medium: 进度有所滞后，或存在沟通摩擦。
- Low: 风险可控，仅有琐碎问题。

请严格返回如下格式的合法 JSON：
{
    "scores": {
        "client": 8.5,
        "team": 7.0,
        "tech": 6.0,
        "progress": 5.0
    },
    "severity": "High/Critical/Medium/Low",
    "summary": "1-2句对当前局势的精炼总结",
    "signals": ["信号1", "信号2", ...] 
}"""
                # 调用AI进行分析
                import json
                try:
                    ai_resp = ai_service.call_ai_api(system_prompt, text_corpus, task_type="analysis")
                    # 尝试清理markdown标记
                    if ai_resp.startswith('```json'):
                        ai_resp = ai_resp.replace('```json', '').replace('```', '')
                    result = json.loads(ai_resp)
                except Exception as ex:
                    # Fallback if AI fails or returns bad JSON
                    print(f"[Sentiment Error] JSON loads failed: {ex} on resp: {ai_resp}")
                    result = {
                        'scores': {'client': 7, 'team': 7, 'tech': 7, 'progress': 7}, 
                        'signals': ['AI解析失败']
                    }

                return result
        except Exception as e:
            print(f"Sentiment Analysis Error: {e}")
            return {'error': str(e)}

    @staticmethod
    def snapshot_project_risk(project_id):
        """(定时任务用) 快照当前项目的风险与情感状态至历史表"""
        try:
            # 1. 计算各项指标
            sentiment = AIInsightService.analyze_sentiment(project_id)
            if 'error' in sentiment: return False

            # 计算平均情感分 (0-1归一化，用于存入 sentiment_score)
            avg_sentiment = (sentiment['client'] + sentiment['team'] + sentiment['tech'] + sentiment['progress']) / 40.0
            
            # 简易计算风险分 (这里复用 analyze_trends 里的逻辑或调用 risk_service，为简化直接模拟)
            # 实际应调用 RiskService.assess_project_risk(project_id)
            current_risk_score = 30 + (1.0 - avg_sentiment) * 40 # 情感越低风险越高

            with DatabasePool.get_connection() as conn:
                conn.execute('''
                    INSERT INTO project_risk_history (project_id, record_date, risk_score, sentiment_score, trend_direction, key_risk_factors)
                    VALUES (?, ?, ?, ?, ?, ?)
                ''', (
                    project_id, 
                    datetime.now().strftime('%Y-%m-%d'), 
                    current_risk_score, 
                    avg_sentiment, 
                    'stable', 
                    ",".join(sentiment.get('signals', []))
                ))
            return True
        except Exception as e:
            print(f"Snapshot Error: {e}")
            return False

    @staticmethod
    def parse_work_log(raw_text):
        """解析非结构化文本为结构化日报"""
        system_prompt = """你是一个专业的项目管理助手。请根据用户输入的非结构化文本，提取并整理为以下JSON结构：
{
    "work_content": "今日完成的具体工作内容",
    "issues_encountered": "遇到的问题或困难",
    "work_hours": 0.0,
    "tomorrow_plan": "明日计划"
}
规则：
1. work_hours 提取为浮点数（如 "半天"->4.0, "2小时"->2.0）。如果未提及，默认为 8.0。
2. 如果没有提到问题，issues_encountered 填 "无"。
3. 保持语气专业。"""
        
        import json
        try:
            ai_resp = ai_service.call_ai_api(system_prompt, raw_text, task_type="analysis")
            # 清理可能的markdown
            if ai_resp.startswith('```json'):
                ai_resp = ai_resp.replace('```json', '').replace('```', '')
            
            data = json.loads(ai_resp)
            return data
        except Exception as e:
            print(f"AI Parse Log Error: {e}")
            # Fallback
            return {
                "work_content": raw_text,
                "issues_encountered": "",
                "work_hours": 8.0,
                "tomorrow_plan": ""
            }

    @staticmethod
    def get_stale_items(project_id):
        """获取项目中的滞后/过期项 (问题、接口、里程碑)"""
        try:
            with DatabasePool.get_connection() as conn:
                stale_items = []
                now = datetime.now()
                seven_days_ago = now - timedelta(days=7)
                three_days_later = now + timedelta(days=3)

                # 1. 滞后问题 (未解决且创建超过7天)
                issues = conn.execute('''
                    SELECT id, description, severity, status, created_at, 'issue' as type
                    FROM issues 
                    WHERE project_id = ? AND status != '已解决'
                ''', (project_id,)).fetchall()
                
                for i in issues:
                    try:
                        # Handle potential space in TIMESTAMP or just DATE
                        created_at_str = i['created_at'].split(' ')[0] if i['created_at'] else ""
                        if not created_at_str: continue
                        created_at = datetime.strptime(created_at_str, '%Y-%m-%d')
                        if created_at < seven_days_ago:

                            item = dict(i)
                            item['title'] = f"[{i['severity']}] {i['description'][:20]}..."
                            item['reason'] = f"创建于 {i['created_at']}，已超过7天未解决"
                            stale_items.append(item)
                    except:
                        pass # Ignore parse errors

                # 2. 未完成接口 (简单逻辑：所有未完成的)
                interfaces = conn.execute('''
                    SELECT id, system_name, interface_name, status, 'interface' as type
                    FROM interfaces 
                    WHERE project_id = ? AND status != '已完成'
                ''', (project_id,)).fetchall()
                
                for i in interfaces:
                    item = dict(i)
                    item['title'] = f"{i['system_name']} - {i['interface_name']}"
                    item['reason'] = f"当前状态: {i['status']}"
                    stale_items.append(item)

                # 3. 临近或过期里程碑 (未完成且 target_date < now + 3 days)
                milestones = conn.execute('''
                    SELECT id, name, target_date, is_completed, 'milestone' as type
                    FROM milestones 
                    WHERE project_id = ? AND is_completed = 0
                ''', (project_id,)).fetchall()
                
                for m in milestones:
                    try:
                        target_date = datetime.strptime(m['target_date'], '%Y-%m-%d')
                        if target_date < three_days_later:
                            item = dict(m)
                            item['title'] = m['name']
                            days_diff = (target_date - now).days
                            if days_diff < 0:
                                item['reason'] = f"已逾期 {abs(days_diff)} 天 ({m['target_date']})"
                            else:
                                item['reason'] = f"即将到期 (还剩 {days_diff} 天)"
                            stale_items.append(item)
                    except:
                        pass

                return stale_items
        except Exception as e:
            print(f"Get Stale Items Error: {e}")
            return []

    @staticmethod
    def generate_chaser_message(item_details):
        """生成支持多风格的催单/提醒话术"""
        system_prompt = """你是一位资深的ICU医疗信息化项目沟通专家，擅长写催办提醒。
你必须只输出一个JSON对象，不要输出任何其他内容。

三种风格必须有明显差异：
- professional: 像项目经理发给甲方的正式邮件。用数据说话（逾期天数、影响范围），语气严谨克制，聚焦解决方案。不说"您好"开头。
- soft: 像同事间的微信消息。先认可对方的工作，再自然引出这个事项，语气轻松但不失分寸。可以用"～""😊"等。
- direct: 像领导的紧急通知。开门见山，指出风险后果，明确deadline，语气果断有压迫感。用"⚠️""‼️"等强调。

每条content 150-250字。subject要简洁有力，不超过25字。
直接输出JSON，不要代码块：{"professional":{"subject":"标题","content":"正文"},"soft":{"subject":"标题","content":"正文"},"direct":{"subject":"标题","content":"正文"}}"""

        import json
        title = item_details.get('title', '未知事项')
        reason = item_details.get('reason', '需要跟进')
        severity = item_details.get('severity', '中')
        item_type = item_details.get('type', 'issue')
        
        # 提取逾期天数
        delay_info = ""
        if '超过' in reason and '天' in reason:
            delay_info = reason
        
        try:
            user_content = f"""请为以下滞后事项生成三种风格的催单话术，只输出JSON。

事项名称：{title}
严重程度：{severity}
滞后情况：{reason}
事项类型：{item_type}

要求：三种风格必须语气、措辞、结构都明显不同。professional要引用具体数据，soft要有人情味，direct要有紧迫感。"""
            print(f"[DEBUG] Chaser - calling AI with 90s timeout...")
            
            # 用线程超时包裹, 防止流式请求无限阻塞
            from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(ai_service.call_ai_api, system_prompt, user_content, "analysis")
                try:
                    ai_resp = future.result(timeout=90)
                except FuturesTimeoutError:
                    print("[DEBUG] Chaser - AI call timed out after 90s")
                    raise ValueError("AI 调用超时(90s)")
            
            print(f"[DEBUG] Chaser - AI response length: {len(ai_resp) if ai_resp else 'None'}")
            print(f"[DEBUG] Chaser - AI response preview: {(ai_resp or '')[:200]}")
            
            if not ai_resp:
                raise ValueError("AI 返回为空")
            
            # 清洗并提取 JSON
            cleaned = ai_resp.strip()
            # 去掉 markdown 代码块
            if '```' in cleaned:
                parts = cleaned.split('```')
                for part in parts[1:]:
                    p = part.strip()
                    if p.startswith('json'):
                        p = p[4:].strip()
                    if p.startswith('{'):
                        cleaned = p
                        break
            
            # 提取 JSON 对象
            start = cleaned.find('{')
            end = cleaned.rfind('}')
            if start != -1 and end != -1:
                cleaned = cleaned[start:end+1]
                result = json.loads(cleaned)
                if 'professional' in result:
                    print(f"[DEBUG] Chaser - parsed OK, keys: {list(result.keys())}")
                    return result
            
            # JSON 解析失败，用 AI 的文本内容构造结构化结果
            print(f"[DEBUG] Chaser - AI 未返回JSON，用原始文本构造结果")
            return {
                "professional": {
                    "subject": f"关于「{title}」的进度同步",
                    "content": ai_resp[:150] if ai_resp else f"请关注「{title}」，{reason}。"
                },
                "soft": {
                    "subject": f"温馨提醒：{title}",
                    "content": f"辛苦了！想跟您同步一下「{title}」的最新情况。目前{reason}，方便的话帮忙看看进展如何？有任何需要支持的地方随时说～"
                },
                "direct": {
                    "subject": f"【紧急】{title} 需立即处理",
                    "content": f"「{title}」{reason}，已影响项目整体进度。请今日内反馈处理方案，如需协调资源请立即告知。"
                }
            }
        except Exception as e:
            logger.error(f"Generate Chaser Error: {e}")
            return {
                "professional": {
                    "subject": f"关于「{title}」的进度同步",
                    "content": f"您好，关于「{title}」事项，{reason}，请协调相关资源尽快推进。如有困难请及时反馈，我们共同制定解决方案。"
                },
                "soft": {
                    "subject": f"温馨提醒：{title}",
                    "content": f"辛苦了！想跟您同步一下「{title}」的最新情况。目前{reason}，方便的话帮忙看看进展如何？有任何需要支持的地方随时说～"
                },
                "direct": {
                    "subject": f"【紧急】{title} 需立即处理",
                    "content": f"「{title}」{reason}，已影响项目整体进度。请今日内反馈处理方案，如需协调资源请立即告知。"
                }
            }

    @staticmethod
    def auto_extract_knowledge(issue_id):
        """从已解决的问题中自动提取知识库条目"""
        try:
            with DatabasePool.get_connection() as conn:
                # 1. 获取问题详情
                issue = conn.execute('SELECT * FROM issues WHERE id = ?', (issue_id,)).fetchone()
                if not issue:
                    return {"success": False, "message": "Issue not found"}
                
                # 2. 获取相关的工作日志 (尝试关联)
                # 简单模糊匹配：日志内容包含问题描述的一部分? 或者暂不关联，仅凭问题描述分析
                # 为了效果更好，我们假设 AI 能从问题描述和类型中提取通用经验
                
                # 3. 调用 AI 提取
                system_prompt = """你是一个经验丰富的项目经理和知识管理专家。你的任务是从具体的项目问题中提取通用的、可复用的“填坑指南”或“最佳实践”。
请遵循以下规则：
1. 提取出的知识应当去除具体的项目特指信息（如某某医院、某某人名），使其具有普适性。
2. 格式要求返回 JSON: {"title": "知识条目标题", "content": "详细的解决方案或避坑指南", "tags": "标签1,标签2"}
3. 标题要言简意赅，例如“Oracle数据库连接超时排查指南”。
4. 内容要包含：问题现象、根本原因（推测）、解决方案/建议。
"""
                user_content = f"""
问题类型: {issue['issue_type']}
严重程度: {issue['severity']}
问题描述: {issue['description']}
创建时间: {issue['created_at']}
解决时间: {issue['resolved_at']}
"""
                ai_resp = ai_service.call_ai_api(system_prompt, user_content, task_type="json")
                
                # Clean up JSON
                if ai_resp.startswith('```json'):
                    ai_resp = ai_resp.replace('```json', '').replace('```', '')
                
                kb_data = json.loads(ai_resp)
                
                # 4. 存入 Knowledge Base
                # 检查是否已存在类似标题 (简单去重)
                existing = conn.execute('SELECT id FROM knowledge_base WHERE title = ?', (kb_data['title'],)).fetchone()
                if existing:
                    return {"success": True, "message": "Knowledge item already exists", "id": existing['id']}
                
                cursor = conn.execute('''
                    INSERT INTO knowledge_base (title, content, category, tags, created_at)
                    VALUES (?, ?, ?, ?, ?)
                ''', (
                    kb_data['title'], 
                    kb_data['content'], 
                    'AI 提炼', 
                    kb_data.get('tags', '自动提取'), 
                    datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                ))
                new_id = cursor.lastrowid
                return {"success": True, "message": "Extracted successfully", "id": new_id, "data": kb_data}
                
        except Exception as e:
            print(f"Auto Extract Knowledge Error: {e}")
            return {"success": False, "message": str(e)}

    @staticmethod
    def find_similar_projects(project_id):
        """查找相似项目 (规则初筛 + AI 排序)"""
        try:
            with DatabasePool.get_connection() as conn:
                target = conn.execute('SELECT * FROM projects WHERE id = ?', (project_id,)).fetchone()
                if not target:
                    return []
                
                # 1. 粗筛 (获取所有其他项目)
                all_projects = conn.execute('SELECT id, project_name, hospital_name, status, risk_score FROM projects WHERE id != ?', (project_id,)).fetchall()
                
                candidates = []
                common_terms = ['ICU', '重症', '麻醉', '手术', '急诊', '护理', '集成']
                
                for p in all_projects:
                    score = 0
                    
                    # 同一医院
                    if p['hospital_name'] == target['hospital_name']:
                        score += 50
                    
                    # 名称关键词匹配
                    target_name = target['project_name'] or ''
                    p_name = p['project_name'] or ''
                    for term in common_terms:
                        if term in target_name and term in p_name:
                            score += 20
                    
                    # 只要有一点相似度就纳入候选
                    if score > 0:
                        candidates.append(dict(p))
                
                # 按分数排序取前 10
                candidates.sort(key=lambda x: x.get('score', 0), reverse=True)
                top_10 = candidates[:10]
                
                if not top_10:
                    return []
                
                # 2. AI 深度分析与排序
                system_prompt = """你是一个项目组合管理专家。请根据目标项目和候选项目列表，找出最相似的 3 个项目。
关注点：业务领域（如都是ICU）、医院背景（如同一家医院）、项目阶段或风险状况。
返回 JSON 数组: [{"id": 候选项目ID, "reason": "相似原因简述 (15字以内)"}]"""

                candidate_json = json.dumps(
                    [{k: v for k, v in c.items() if k in ['id', 'project_name', 'hospital_name', 'status', 'risk_score']} for c in top_10],
                    ensure_ascii=False
                )
                user_content = f"""你是一个项目组合管理专家。请根据目标项目和候选项目列表，找出最相似的 3 个项目。
关注点：业务领域（如都是ICU）、医院背景（如同一家医院）、项目阶段或风险状况。
严禁自我介绍或客套，直接返回JSON数组。

目标项目: {target['project_name']} (医院: {target['hospital_name']}, 状态: {target['status']}, 风险分: {target['risk_score']})

候选列表:
{candidate_json}

请直接输出JSON数组（不要代码块标记）: [{{"id": 候选项目ID, "reason": "相似原因简述(15字以内)"}}]"""

                ai_resp = ai_service.call_ai_api(system_prompt, user_content, task_type="json")
                
                if not ai_resp:
                    print("[DEBUG] find_similar_projects: AI returned None")
                    return top_10[:3]  # AI 失败时直接返回粗筛前3
                
                # 清洗 JSON
                cleaned = ai_resp.strip()
                if '```' in cleaned:
                    parts = cleaned.split('```')
                    for part in parts[1:]:
                        p = part.strip()
                        if p.startswith('json'):
                            p = p[4:].strip()
                        if p.startswith('['):
                            cleaned = p
                            break
                
                start = cleaned.find('[')
                end = cleaned.rfind(']')
                if start != -1 and end != -1:
                    cleaned = cleaned[start:end+1]
                
                ranked_results = json.loads(cleaned)
                
                # 回填详细信息
                final_projects = []
                candidate_map = {c['id']: c for c in top_10}
                
                for res in ranked_results:
                    pid = res.get('id')
                    if pid in candidate_map:
                        proj = candidate_map[pid]
                        proj['similarity_reason'] = res.get('reason', '相似项目')
                        final_projects.append(proj)
                        
                return final_projects

        except Exception as e:
            print(f"Find Similar Projects Error: {e}")
            return []

    @staticmethod
    def detect_anomalies(project_id):
        """检测项目异常：静默、停滞、问题突增"""
        anomalies = []
        try:
            with DatabasePool.get_connection() as conn:
                # 1. 静默检测 (Silence): 超过3个工作日(简单按4天)无日报
                last_log = conn.execute('SELECT MAX(log_date) as last_date FROM work_logs WHERE project_id = ?', (project_id,)).fetchone()
                if not last_log['last_date']:
                    # 从未写过日志?
                    pass
                else:
                    last_date = datetime.strptime(last_log['last_date'], '%Y-%m-%d')
                    if datetime.now() - last_date > timedelta(days=4):
                        anomalies.append({
                            "type": "anomaly",
                            "priority": "High",
                            "title": "项目静默预警",
                            "description": f"已有 {(datetime.now() - last_date).days} 天未提交工作日报。",
                            "suggestion": "请确认团队是否在正常推进，或提醒补录日志。",
                            "action_label": "提醒日志",
                            "action_tab": "worklogs"
                        })

                # 2. 停滞检测 (Stagnation): 进度连续14天无变化 (且状态为进行中)
                project = conn.execute('SELECT status, progress FROM projects WHERE id = ?', (project_id,)).fetchone()
                if project and project['status'] == '进行中':
                    # 获取最近的一条进度记录
                    last_history = conn.execute('''
                        SELECT progress, record_date FROM progress_history 
                        WHERE project_id = ? 
                        ORDER BY record_date DESC LIMIT 1
                    ''', (project_id,)).fetchone()
                    
                    if last_history:
                        last_date = datetime.strptime(last_history['record_date'], '%Y-%m-%d')
                        days_diff = (datetime.now() - last_date).days
                        
                        # 如果最近一次记录超过14天，且进度与当前一致 (说明这14天没变过)
                        if days_diff > 14 and last_history['progress'] == project['progress']:
                            anomalies.append({
                                "type": "anomaly",
                                "priority": "High",
                                "title": "进度停滞预警",
                                "description": f"项目进度已连续 {days_diff} 天停留在 {project['progress']}%。",
                                "suggestion": "项目可能受阻，建议审查阻塞原因或调整计划。",
                                "action_label": "分析偏差",
                                "action_tab": "deviation"
                            })

                # 3. 问题突增 (Issue Spike): 近3天新增问题数 > 过去30天及均值 * 2
                three_days_ago = (datetime.now() - timedelta(days=3)).strftime('%Y-%m-%d')
                thirty_days_ago = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
                
                recent_count = conn.execute('SELECT COUNT(*) as c FROM issues WHERE project_id=? AND created_at >= ?', (project_id, three_days_ago)).fetchone()['c']
                past_count = conn.execute('SELECT COUNT(*) as c FROM issues WHERE project_id=? AND created_at >= ? AND created_at < ?', (project_id, thirty_days_ago, three_days_ago)).fetchone()['c']
                
                if past_count > 0:
                    avg_3days = (past_count / 27.0) * 3 # 过去27天的每3天平均
                    if recent_count > max(5, avg_3days * 2): # 阈值: 至少5个且是平均的2倍
                        anomalies.append({
                            "type": "anomaly",
                            "priority": "High",
                            "title": "问题激增预警",
                            "description": f"近3天新增 {recent_count} 个问题，远超平时水平。",
                            "suggestion": "可能处于测试爆发期或质量失控，建议介入质量评估。",
                            "action_label": "查看问题",
                            "action_tab": "issues"
                        })

                # 4. 状态倒退 (Status Reversal): 这里演示检测已解决问题被重新打开
                reopened_issues = conn.execute('''
                    SELECT COUNT(*) as c FROM issues 
                    WHERE project_id = ? AND status != '已解决' 
                    AND description LIKE '%被重新打开%' 
                ''', (project_id,)).fetchone()['c']
                
                if reopened_issues > 0:
                    anomalies.append({
                        "type": "reversal",
                        "priority": "High",
                        "title": "任务倒退预警",
                        "description": f"有 {reopened_issues} 个已解决的问题被重新打开，可能存在修复不彻底的情况。",
                        "suggestion": "请技术负责人介入，审查重开原因，避免重复返工。",
                        "action_label": "审查重开",
                        "action_tab": "issues"
                    })

        except Exception as e:
            print(f"Anomaly Detection Error: {e}")
        
        return anomalies

    @staticmethod
    def predict_future_risks(project_id):
        """预测性风险分析：预测延期概率和完成日期 (1-2周预判)"""
        try:
            with DatabasePool.get_connection() as conn:
                project = conn.execute('SELECT id, project_name, progress, plan_end_date, plan_start_date FROM projects WHERE id = ?', (project_id,)).fetchone()
                if not project: 
                    logger.warning(f"Project {project_id} not found for prediction")
                    return None
                
                # 1. 计算交付速度 (Velocity)
                # 获取过去 14 天的进度变化
                fourteen_days_ago = (datetime.now() - timedelta(days=14)).strftime('%Y-%m-%d')
                history = conn.execute('''
                    SELECT progress, record_date FROM progress_history 
                    WHERE project_id = ? AND record_date >= ? 
                    ORDER BY record_date ASC
                ''', (project_id, fourteen_days_ago)).fetchall()
                
                velocity = 0 # 每天平均增长百分比
                if len(history) >= 2:
                    start_p = history[0]['progress'] or 0
                    end_p = history[-1]['progress'] or 0
                    try:
                        days = (datetime.strptime(history[-1]['record_date'], '%Y-%m-%d') - datetime.strptime(history[0]['record_date'], '%Y-%m-%d')).days
                        if days > 0:
                            velocity = (end_p - start_p) / float(days)
                    except Exception as ex:
                        logger.error(f"Error calculating velocity days: {ex}")
                
                # 2. 获取情绪评分趋势 (Sentiment Trend)
                risk_history = conn.execute('''
                    SELECT sentiment_score FROM project_risk_history 
                    WHERE project_id = ? 
                    ORDER BY record_date DESC LIMIT 5
                ''', (project_id,)).fetchall()
                
                # 过滤 None 值
                sentiment_scores = [r['sentiment_score'] for r in risk_history if r['sentiment_score'] is not None]
                sentiment_avg = sum(sentiment_scores) / len(sentiment_scores) if sentiment_scores else 50
                
                is_sentiment_dropping = False
                if len(risk_history) >= 2:
                    current_s = risk_history[0]['sentiment_score'] or 0
                    prev_s = risk_history[-1]['sentiment_score'] or 0
                    is_sentiment_dropping = current_s < prev_s # 因为第0个是最近的

                # 3. 计算预测日期
                current_progress = project['progress'] or 0
                remaining_p = 100 - current_progress
                if velocity > 0:
                    days_needed = remaining_p / velocity
                    # 限制天数，防止溢出
                    days_needed = min(days_needed, 3650) # 最多预测10年
                    predicted_end = (datetime.now() + timedelta(days=int(days_needed))).strftime('%Y-%m-%d')
                else:
                    predicted_end = "无法计算 (进度停滞)"
                    days_needed = 999
                
                # 4. 判定延期风险
                is_delay_predicted = False
                delay_days = 0
                if project['plan_end_date'] and velocity > 0:
                    try:
                        plan_end = datetime.strptime(project['plan_end_date'], '%Y-%m-%d')
                        actual_pred = datetime.now() + timedelta(days=int(days_needed))
                        if actual_pred > plan_end:
                            is_delay_predicted = True
                            delay_days = (actual_pred - plan_end).days
                    except Exception as pe:
                        logger.error(f"Error parsing plan_end_date for project {project_id}: {pe}")

                return {
                    "project_id": project_id,
                    "current_progress": current_progress,
                    "avg_velocity": round(velocity, 2),
                    "predicted_end_date": predicted_end,
                    "plan_end_date": project['plan_end_date'],
                    "is_delay_predicted": is_delay_predicted,
                    "delay_days": delay_days,
                    "sentiment_score": round(sentiment_avg, 1),
                    "is_sentiment_dropping": is_sentiment_dropping,
                    "risk_level": "High" if (is_delay_predicted and delay_days > 7) or is_sentiment_dropping else "Normal"
                }

        except Exception as e:
            logger.error(f"Predict Future Risks Error for project {project_id}: {e}", exc_info=True)
            return None

    @staticmethod
    def get_recommended_actions(project_id, force_refresh=False):
        """基于风险、滞后项、异动和进度生成决策建议（支持缓存）"""
        try:
            today_date = datetime.now().strftime('%Y-%m-%d')
            
            # 1. 检查缓存
            if not force_refresh:
                with DatabasePool.get_connection() as conn:
                    cache = conn.execute('''
                        SELECT content FROM ai_report_cache 
                        WHERE project_id = ? AND report_type = 'recommended_actions'
                        AND date(created_at) = ?
                    ''', (project_id, today_date)).fetchone()
                    if cache:
                        return json.loads(cache['content'])

            actions = []
            # 0. 异常检测 (优先展示)
            anomalies = AIInsightService.detect_anomalies(project_id)
            actions.extend(anomalies)

            # 1. 获取基础数据
            stale_items = AIInsightService.get_stale_items(project_id)
            
            with DatabasePool.get_connection() as conn:
                # 获取最新风险评分
                risk_record = conn.execute('''
                    SELECT risk_score, sentiment_score, key_risk_factors 
                    FROM project_risk_history 
                    WHERE project_id = ? 
                    ORDER BY record_date DESC LIMIT 1
                ''', (project_id,)).fetchone()
                
                # 获取项目基本信息
                project = conn.execute('SELECT project_name, status, progress FROM projects WHERE id = ?', (project_id,)).fetchone()

            # 2. 规则引擎生成建议
            
            # (A) 风险干预
            current_risk = risk_record['risk_score'] if risk_record else 0
            if current_risk > 80:
                actions.append({
                    "type": "risk",
                    "priority": "High",
                    "title": "召开风险复盘会议",
                    "description": f"当前风险评分高达 {current_risk}，主要风险因素: {risk_record['key_risk_factors'] or '未知'}。",
                    "suggestion": "建议立即组织项目组+甲方关键干系人进行风险对齐。",
                    "action_label": "查看风险详情",
                    "action_tab": "dashboard" # 对应前端 Tab
                })
            elif current_risk > 60:
                actions.append({
                    "type": "risk",
                    "priority": "Medium",
                    "title": "关注风险趋势",
                    "description": f"项目存在一定风险 (评分 {current_risk})。",
                    "suggestion": "建议在周会中重点同步风险消减计划。",
                    "action_label": "查看趋势",
                    "action_tab": "dashboard"
                })

            # (B) 滞后项清理
            stale_issues = [i for i in stale_items if i['type'] == 'issue']
            if len(stale_issues) > 3:
                actions.append({
                    "type": "issue",
                    "priority": "High",
                    "title": "清理积压问题",
                    "description": f"发现 {len(stale_issues)} 个滞后问题（超过7天未解决）。",
                    "suggestion": "建议安排专项资源进行攻坚，或重新评估问题优先级。",
                    "action_label": "处理问题",
                    "action_tab": "issues"
                })
            elif len(stale_issues) > 0:
                 actions.append({
                    "type": "issue",
                    "priority": "Medium",
                    "title": "跟进滞后问题",
                    "description": f"存在 {len(stale_issues)} 个长期未解决的问题。",
                    "suggestion": "请确认是否阻塞项目进度，必要时使用 AI 催单功能。",
                    "action_label": "AI 催单",
                    "action_tab": "issues" # Special handling in frontend to open modal?
                })

            # (C) 里程碑保障
            stale_milestones = [i for i in stale_items if i['type'] == 'milestone']
            if stale_milestones:
                m = stale_milestones[0]
                actions.append({
                    "type": "milestone",
                    "priority": "High",
                    "title": f"保障里程碑: {m['title']}",
                    "description": m['reason'],
                    "suggestion": "里程碑延期风险较高，建议每日同步进度并向甲方通报。",
                    "action_label": "查看里程碑",
                    "action_tab": "milestones"
                })

            # (D) 进度偏差 (简单逻辑)
            if project and project['status'] == '进行中' and (project['progress'] or 0) < 50:
                # 假设应该更高? 这里只是示例规则
                pass

            # 3. (可选) AI 综合分析增强
            # 如果规则生成的建议较多，我们调用 AI 进行一次“决策压缩”
            if len(actions) > 2:
                summary_prompt = """你是一名资深 PMO 专家。请将以下多条零散的建议提炼为一条最重要的“项目经理唯一核心任务”。
直接输出内容，严禁任何解释或引导性语言。15字以内，动词开头，极具号召力。"""
                actions_summary = "\n".join([f"- {a['title']}: {a['description']}" for a in actions])
                refined_command = ai_service.call_ai_api(summary_prompt, actions_summary, task_type="analysis")
                if refined_command and len(refined_command) < 50:
                    actions.insert(0, {
                        "type": "ai_command",
                        "priority": "High",
                        "title": "⚡ AI 决策指令",
                        "description": refined_command.strip('\"'),
                        "suggestion": "这是基于多项风险因素提炼的核心指令。",
                        "action_label": "立即处理",
                        "action_tab": "dashboard"
                    })
            # 按优先级排序
            priority_map = {"High": 0, "Medium": 1, "Low": 2}
            actions.sort(key=lambda x: priority_map.get(x['priority'], 99))

            # 4. 更新缓存
            with DatabasePool.get_connection() as conn:
                conn.execute('''
                    DELETE FROM ai_report_cache 
                    WHERE project_id = ? AND report_type = 'recommended_actions'
                    AND date(created_at) = ?
                ''', (project_id, today_date))
                
                conn.execute('''
                    INSERT INTO ai_report_cache (project_id, report_type, content, created_at)
                    VALUES (?, ?, ?, ?)
                ''', (project_id, 'recommended_actions', json.dumps(actions, ensure_ascii=False), datetime.now().strftime('%Y-%m-%d %H:%M:%S')))
                conn.commit()

            return actions

        except Exception as e:
            print(f"Get Recommended Actions Error: {e}")
            return []

    @staticmethod
    def analyze_demand_change(project_id, description):
        """
        分析需求变更的影响：蝴蝶效应、延期概率、资源成本。
        """
        try:
            # 1. 获取项目基本快照
            with DatabasePool.get_connection() as conn:
                project = conn.execute('SELECT * FROM projects WHERE id = ?', (project_id,)).fetchone()
                tasks = conn.execute('''
                    SELECT t.* FROM tasks t
                    JOIN project_stages s ON t.stage_id = s.id
                    WHERE s.project_id = ? AND t.is_completed = 0
                ''', (project_id,)).fetchall()

                milestones = conn.execute('SELECT * FROM milestones WHERE project_id = ? AND is_completed = 0', (project_id,)).fetchall()

            # 2. 调用 AI 进行多维评估
            prompt = f"""
            你是一个资深的交付总监和 PMO 专家。现有项目“{project['project_name']}”面临一项需求变更。
            
            变更描述：
            {description}
            
            项目现状：
            - 当前进度：{project['progress']}%
            - 待办任务数：{len(tasks)}
            - 待达成里程碑：{len(milestones)}
            
            请从以下维度进行深度评估并给出结构化的 Markdown 报告：
            1. **核心影响 (Core Impact)**：对现有架构和交付进度的直接冲击。
            2. **蝴蝶效应 (Ripple Effect)**：该变更可能引发的其他模块风险或协同部门压力。
            3. **延期风险评估**：根据变更复杂度预测可能的工期偏差（以天为单位）。
            4. **资源/成本评估**：是否需要追加人力或硬件投入。
            5. **决策建议**：接受该变更的条件建议（如压缩非核心任务、申请延期等）。
            
            请直接输出 Markdown 内容，不需要任何开场白。
            """
            
            # Call AI with correct method
            system_prompt = "你是一个资深的交付总监和 PMO 专家。请根据用户提供的需求变更描述和项目现状，进行深度评估。"
            user_content = prompt 
            
            analysis = ai_service.call_ai_api(system_prompt, user_content, task_type="analysis")
            return analysis

        except Exception as e:
            print(f"Analyze Demand Change Error: {e}")
            return "评估生成失败，请稍后重试。"


    @staticmethod
    def parse_multi_logs(raw_text):
        """解析批量日志文本"""
        # 1. 尝试使用 AI 批量解析
        system_prompt = """你是一个日志整理助手。用户会输入一段包含多人、多条工作内容的混合文本（可能是聊天记录或周报）。
请将其拆解为标准的工作日志列表。
返回 JSON 数组: [{"member_name": "姓名", "log_date": "YYYY-MM-DD", "work_content": "内容", "work_hours": 8.0, "issues": "无", "plan": "明日计划"}]
规则：
1. 自动识别日期，默认为今天。
2. 自动识别姓名，如果未提及，标记为"未知"。
3. 提取工时，默认8小时。
"""
        import json
        try:
            ai_resp = ai_service.call_ai_api(system_prompt, raw_text, task_type="json")
            if ai_resp.startswith('```json'):
                ai_resp = ai_resp.replace('```json', '').replace('```', '')
            
            logs = json.loads(ai_resp)
            if isinstance(logs, list):
                return logs
            return []
        except Exception as e:
            print(f"Parse Multi Logs Error: {e}")
            return []

ai_insight_service = AIInsightService()
