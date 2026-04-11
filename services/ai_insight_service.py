from datetime import datetime, timedelta
from database import DatabasePool
from services.ai_service import ai_service
import json
import logging

logger = logging.getLogger(__name__)


class AIInsightService:
    @staticmethod
    def _safe_excerpt(text, length=30):
        text = str(text or '').strip()
        if len(text) <= length:
            return text
        return text[:length].rstrip() + '...'

    @staticmethod
    def generate_daily_advice(project_id, force_refresh=False):
        """聚合日报、任务和进度，生成AI每日建议（支持当日缓存）"""
        try:
            today_date = datetime.now().strftime('%Y-%m-%d')
            tomorrow_date = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')
            
            # 1. 检查缓存
            if not force_refresh:
                with DatabasePool.get_connection() as conn:
                    cache = conn.execute(DatabasePool.format_sql('''
                        SELECT content FROM ai_report_cache 
                        WHERE project_id = ? AND report_type = 'daily_advice'
                        AND created_at >= ? AND created_at < ?
                    '''), (project_id, today_date, tomorrow_date)).fetchone()
                    if cache:
                        return cache['content']

            with DatabasePool.get_connection() as conn:
                # 2. 获取项目基本信息
                project = conn.execute(DatabasePool.format_sql('SELECT id, project_name, progress, status FROM projects WHERE id = ?'), (project_id,)).fetchone()
                if not project:
                    return "项目不存在"

                # 3. 获取最近 3 天的日报
                three_days_ago = (datetime.now() - timedelta(days=3)).strftime('%Y-%m-%d')
                reports = conn.execute(DatabasePool.format_sql('''
                    SELECT log_date, work_content, issues_encountered 
                    FROM work_logs 
                    WHERE project_id = ? AND log_date >= ?
                    ORDER BY log_date DESC
                '''), (project_id, three_days_ago)).fetchall()
                
                report_text = "\n".join([
                    f"[{r['log_date']}] 工作: {r['work_content']} | 问题: {r['issues_encountered']}" 
                    for r in reports
                ]) if reports else "最近无日报记录"

                # 4. 获取近期未完成的高优先级任务
                tasks = conn.execute(DatabasePool.format_sql('''
                    SELECT t.task_name, s.stage_name 
                    FROM tasks t
                    JOIN project_stages s ON t.stage_id = s.id
                    WHERE s.project_id = ? AND t.is_completed = ?
                    LIMIT 10
                '''), (project_id, False)).fetchall()
                
                task_text = "\n".join([f"- {t['stage_name']}: {t['task_name']}" for t in tasks]) if tasks else "当前无待办任务"

                # 5. 构造 Prompt
                system_prompt = """你是一名世界顶级 ICU 医疗信息化项目总监 (Project Director)。
你的回复必须直接、专业、极简，像是一份呈送给高管的紧急简报。严禁任何客套。"""

                user_content = f"""项目名称: {project['project_name']}
当前状态: {project['status']} (进度: {project['progress']}%)

【近期日报摘要】
{report_text}

【待办任务清单】
{task_text}

请分析现状、指出最致命风险。给出3条极其具体的必办指令。"""

                # 6. 调用 AI
                advice = ai_service.call_ai_api(system_prompt, user_content, task_type="analysis")
                
                if advice:
                    # 7. 更新缓存
                    with DatabasePool.get_connection() as conn:
                        conn.execute(DatabasePool.format_sql('''
                            DELETE FROM ai_report_cache 
                            WHERE project_id = ? AND report_type = 'daily_advice'
                            AND created_at >= ? AND created_at < ?
                        '''), (project_id, today_date, tomorrow_date))
                        
                        conn.execute(DatabasePool.format_sql('''
                            INSERT INTO ai_report_cache (project_id, report_type, content, created_at)
                            VALUES (?, ?, ?, ?)
                        '''), (project_id, 'daily_advice', advice, datetime.now().strftime('%Y-%m-%d %H:%M:%S')))
                        conn.commit()
                
                return advice or "AI 暂时无法生成建议。"
        except Exception as e:
            logger.error(f"Generate Daily Advice Error: {e}")
            return f"生成错误: {str(e)}"

    @staticmethod
    def analyze_trends(project_id):
        """分析项目风险趋势、速度和问题密度"""
        try:
            with DatabasePool.get_connection() as conn:
                history = conn.execute(DatabasePool.format_sql('''
                    SELECT record_date, risk_score, sentiment_score 
                    FROM project_risk_history 
                    WHERE project_id = ? 
                    ORDER BY record_date ASC
                    LIMIT 30
                '''), (project_id,)).fetchall()
                
                dates = [h['record_date'] for h in history]
                risk_scores = [h['risk_score'] for h in history]
                sentiment_scores = [h['sentiment_score'] for h in history]

                velocity_data = []
                for i in range(4):
                    start_date = (datetime.now() - timedelta(weeks=i+1)).strftime('%Y-%m-%d')
                    end_date = (datetime.now() - timedelta(weeks=i)).strftime('%Y-%m-%d')
                    count = conn.execute(DatabasePool.format_sql('''
                        SELECT COUNT(*) as c
                        FROM tasks t
                        JOIN project_stages s ON t.stage_id = s.id
                        WHERE s.project_id = ? AND t.is_completed = ? 
                        AND t.completed_date >= ? AND t.completed_date < ?
                    '''), (project_id, True, start_date, end_date)).fetchone()['c']
                    velocity_data.append({'week_start': start_date, 'count': count})
                velocity_data.reverse()

                issue_trend = []
                for i in range(4):
                    start_date = (datetime.now() - timedelta(weeks=i+1)).strftime('%Y-%m-%d')
                    end_date = (datetime.now() - timedelta(weeks=i)).strftime('%Y-%m-%d')
                    created = conn.execute(DatabasePool.format_sql('SELECT COUNT(*) as c FROM issues WHERE project_id=? AND created_at >= ? AND created_at < ?'), (project_id, start_date, end_date)).fetchone()['c']
                    resolved = conn.execute(DatabasePool.format_sql('SELECT COUNT(*) as c FROM issues WHERE project_id=? AND resolved_at >= ? AND resolved_at < ?'), (project_id, start_date, end_date)).fetchone()['c']
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
            logger.error(f"Analyze Trends Error: {e}")
            return {'error': str(e)}

    @staticmethod
    def analyze_sentiment(project_id):
        """分析项目情感倾向"""
        try:
            with DatabasePool.get_connection() as conn:
                seven_days_ago = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
                logs = conn.execute(DatabasePool.format_sql("SELECT work_content, issues_encountered FROM work_logs WHERE project_id=? AND log_date >= ?"), (project_id, seven_days_ago)).fetchall()
                issues = conn.execute(DatabasePool.format_sql("SELECT issue_type, description, severity FROM issues WHERE project_id=? AND status != '已解决'"), (project_id,)).fetchall()
                
                text_corpus = "\n".join([f"Log: {l['work_content']} {l['issues_encountered']}" for l in logs])
                text_corpus += "\n".join([f"Issue: [{i['issue_type']}] {i['description']} (Severity: {i['severity']})" for i in issues])
                
                if not text_corpus.strip():
                    return {'scores': {'client': 8, 'team': 8, 'tech': 8, 'progress': 8}, 'signals': []}

                system_prompt = "你是一个风险分析引擎。评估项目健康度(0-10)并以JSON返回。"
                try:
                    ai_resp = ai_service.call_ai_api(system_prompt, text_corpus, task_type="analysis")
                    if '```json' in ai_resp:
                        ai_resp = ai_resp.split('```json')[1].split('```')[0].strip()
                    result = json.loads(ai_resp)
                except:
                    result = {'scores': {'client': 7, 'team': 7, 'tech': 7, 'progress': 7}, 'signals': ['AI解析失败']}
                return result
        except Exception as e:
            logger.error(f"Sentiment Analysis Error: {e}")
            return {'error': str(e)}

    @staticmethod
    def snapshot_project_risk(project_id):
        """记录风险历史"""
        try:
            sentiment = AIInsightService.analyze_sentiment(project_id)
            if 'error' in sentiment: return False

            avg_sentiment = sum(sentiment.get('scores', {}).values()) / 40.0 if sentiment.get('scores') else 0.8
            current_risk_score = 30 + (1.0 - avg_sentiment) * 40

            with DatabasePool.get_connection() as conn:
                conn.execute(DatabasePool.format_sql('''
                    INSERT INTO project_risk_history (project_id, record_date, risk_score, sentiment_score, trend_direction, key_risk_factors)
                    VALUES (?, ?, ?, ?, ?, ?)
                '''), (project_id, datetime.now().strftime('%Y-%m-%d'), current_risk_score, avg_sentiment, 'stable', ",".join(sentiment.get('signals', []))))
            return True
        except Exception as e:
            logger.error(f"Snapshot Error: {e}")
            return False

    @staticmethod
    def parse_work_log(raw_text):
        """解析非结构化日志"""
        system_prompt = "整理工作日志为JSON结构。"
        try:
            ai_resp = ai_service.call_ai_api(system_prompt, raw_text, task_type="analysis")
            if '```json' in ai_resp:
                ai_resp = ai_resp.split('```json')[1].split('```')[0].strip()
            return json.loads(ai_resp)
        except:
            return {"work_content": raw_text, "issues_encountered": "", "work_hours": 8.0, "tomorrow_plan": ""}

    @staticmethod
    def get_stale_items(project_id):
        """获取滞后项"""
        try:
            with DatabasePool.get_connection() as conn:
                stale_items = []
                now = datetime.now()
                # Issues
                issues = conn.execute(DatabasePool.format_sql("SELECT * FROM issues WHERE project_id = ? AND status != '已解决'"), (project_id,)).fetchall()
                for i in issues:
                    stale_items.append({'type': 'issue', 'severity': i['severity'], 'description': i['description'], 'title': f"问题: {i['description'][:20]}"})
                
                # Milestones
                milestones = conn.execute(DatabasePool.format_sql("SELECT * FROM milestones WHERE project_id = ? AND is_completed = ?"), (project_id, False)).fetchall()
                for m in milestones:
                    stale_items.append({'type': 'milestone', 'title': m['name'], 'reason': f"截止: {m['target_date']}"})
                return stale_items
        except Exception as e:
            logger.error(f"Get Stale Items Error: {e}")
            return []

    @staticmethod
    def detect_anomalies(project_id):
        """检测异常(静默、停滞等)"""
        anomalies = []
        try:
            with DatabasePool.get_connection() as conn:
                # 静默
                last_log = conn.execute(DatabasePool.format_sql('SELECT MAX(log_date) as last_date FROM work_logs WHERE project_id = ?'), (project_id,)).fetchone()
                if last_log and last_log['last_date']:
                    last_date = datetime.strptime(str(last_log['last_date'])[:10], '%Y-%m-%d')
                    if datetime.now() - last_date > timedelta(days=4):
                        anomalies.append({"type": "anomaly", "priority": "High", "title": "项目静默预警", "description": "已有数日未提交日报"})
                
                # 停滞 (简化)
                project = conn.execute(DatabasePool.format_sql('SELECT status, progress FROM projects WHERE id = ?'), (project_id,)).fetchone()
                if project and project['status'] == '进行中' and project['progress'] < 100:
                    pass
        except: pass
        return anomalies

    @staticmethod
    def predict_future_risks(project_id):
        """预测延期概率"""
        try:
            with DatabasePool.get_connection() as conn:
                project = conn.execute(DatabasePool.format_sql('SELECT id, project_name, progress, plan_end_date FROM projects WHERE id = ?'), (project_id,)).fetchone()
                if not project: return None

                plan_end_date = str(project['plan_end_date'])[:10] if project['plan_end_date'] else None
                predicted_end_date = plan_end_date
                is_delay_predicted = False
                delay_days = 0
                risk_level = "Normal"

                if plan_end_date:
                    try:
                        plan_end = datetime.strptime(plan_end_date, '%Y-%m-%d').date()
                        today = datetime.now().date()
                        progress = int(project['progress'] or 0)
                        overdue_days = max((today - plan_end).days, 0)

                        if overdue_days > 0 and progress < 100:
                            is_delay_predicted = True
                            delay_days = max(overdue_days, 1)
                            predicted_end_date = (today + timedelta(days=delay_days)).strftime('%Y-%m-%d')
                            risk_level = "High"
                        elif progress < 30 and (plan_end - today).days <= 7:
                            is_delay_predicted = True
                            delay_days = max(1, 7 - max((plan_end - today).days, 0))
                            predicted_end_date = (plan_end + timedelta(days=delay_days)).strftime('%Y-%m-%d')
                            risk_level = "Medium"
                    except Exception:
                        pass

                return {
                    "project_id": project_id,
                    "current_progress": project['progress'],
                    "plan_end_date": plan_end_date,
                    "predicted_end_date": predicted_end_date,
                    "is_delay_predicted": is_delay_predicted,
                    "delay_days": delay_days,
                    "risk_level": risk_level
                }
        except: return None

    @staticmethod
    def get_recommended_actions(project_id, force_refresh=False):
        """决策建议"""
        try:
            # 基础数据
            stale_items = AIInsightService.get_stale_items(project_id)
            anomalies = AIInsightService.detect_anomalies(project_id)
            
            actions = []
            actions.extend(anomalies)
            
            with DatabasePool.get_connection() as conn:
                risk_record = conn.execute(DatabasePool.format_sql('SELECT risk_score FROM project_risk_history WHERE project_id = ? ORDER BY record_date DESC LIMIT 1'), (project_id,)).fetchone()
                project = conn.execute(DatabasePool.format_sql('SELECT project_name, status, progress FROM projects WHERE id = ?'), (project_id,)).fetchone()

            # 规则逻辑
            cur_risk = risk_record['risk_score'] if risk_record else 0
            if cur_risk > 80:
                actions.append({"type": "risk", "priority": "High", "title": "紧急风险干预", "description": "风险分过高"})
            
            stale_issues = [i for i in stale_items if i['type'] == 'issue']
            if stale_issues:
                actions.append({"type": "issue", "priority": "Medium", "title": "跟进滞后问题", "description": f"有{len(stale_issues)}个滞后问题"})
                
            return actions
        except Exception as e:
            logger.error(f"Recommended Actions Error: {e}")
            return []

    @staticmethod
    def analyze_demand_change(project_id, description):
        """分析变更影响"""
        system_prompt = "你是一个变更多维评估专家。给出5个维度的Markdown评估报告。"
        try:
            return ai_service.call_ai_api(system_prompt, description, task_type="analysis")
        except: return "评估失败"

    @staticmethod
    def parse_multi_logs(raw_text):
        """解析多日志"""
        system_prompt = "将混合文本拆解为标准工作日志JSON列表。"
        try:
            ai_resp = ai_service.call_ai_api(system_prompt, raw_text, task_type="json")
            if '```json' in ai_resp: ai_resp = ai_resp.split('```json')[1].split('```')[0]
            return json.loads(ai_resp)
        except: return []

    @staticmethod
    def extract_meeting_minutes(transcript):
        """提取会议纪要"""
        transcript = str(transcript)[:10000]
        system_prompt = "你是一个ICU项目助理。提取会议核心结论、待办项和风险提示为Markdown。"
        try:
            return ai_service.call_ai_api(system_prompt, transcript, task_type="summary")
        except Exception as e:
            return f"提取失败: {str(e)}"

    @staticmethod
    def generate_chaser_message(data):
        """生成催办话术（不依赖 AI 也可工作）。"""
        item_type = str((data or {}).get('type') or '事项').strip() or '事项'
        title = str((data or {}).get('title') or '').strip()
        reason = str((data or {}).get('reason') or '').strip()
        description = str((data or {}).get('description') or '').strip()
        item_label = title or description or reason or '当前事项'

        base_subject = f"关于{AIInsightService._safe_excerpt(item_label, 20)}的跟进提醒"
        detail_line = reason or description or "请协助确认当前处理进展、阻塞点及预计完成时间。"

        return {
            "professional": {
                "subject": base_subject,
                "content": (
                    f"您好，关于【{item_label}】目前仍处于待推进状态。\n"
                    f"当前关注点：{detail_line}\n"
                    "请于今日内回复最新进展、当前阻塞原因以及明确的完成时间，以便项目侧同步安排后续工作。谢谢。"
                )
            },
            "soft": {
                "subject": f"辛苦协助确认：{AIInsightService._safe_excerpt(item_label, 18)}",
                "content": (
                    f"您好，想跟您温和确认一下【{item_label}】的最新进展。\n"
                    f"目前记录的信息是：{detail_line}\n"
                    "若方便的话，烦请告知当前推进情况以及后续计划时间，我们这边好提前协调相关资源，感谢支持。"
                )
            },
            "direct": {
                "subject": f"请尽快反馈：{AIInsightService._safe_excerpt(item_label, 18)}",
                "content": (
                    f"请尽快处理并反馈【{item_label}】。\n"
                    f"当前问题：{detail_line}\n"
                    "请直接回复当前状态、责任人及完成时间；如存在阻塞，请同步说明需要协调的事项。"
                )
            },
            "meta": {
                "type": item_type,
                "title": item_label
            }
        }

    @staticmethod
    def auto_extract_knowledge(issue_id):
        """将已解决/典型问题提炼为知识库条目。"""
        try:
            with DatabasePool.get_connection() as conn:
                row = conn.execute(DatabasePool.format_sql('''
                    SELECT i.*, p.project_name, p.hospital_name
                    FROM issues i
                    LEFT JOIN projects p ON p.id = i.project_id
                    WHERE i.id = ?
                '''), (issue_id,)).fetchone()

                if not row:
                    return {"success": False, "message": "问题不存在"}

                issue = dict(row)
                title = f"[{issue.get('severity') or '未分级'}]{issue.get('issue_type') or '问题'} - {AIInsightService._safe_excerpt(issue.get('description'), 24)}"
                tags = "问题复盘,AI提炼"
                if issue.get('issue_type'):
                    tags += f",{issue['issue_type']}"
                if issue.get('severity'):
                    tags += f",{issue['severity']}"

                existing = conn.execute(DatabasePool.format_sql('''
                    SELECT id, title, content, project_id, created_at
                    FROM knowledge_base
                    WHERE project_id = ? AND title = ?
                    ORDER BY id DESC
                    LIMIT 1
                '''), (issue.get('project_id'), title)).fetchone()
                if existing:
                    return {
                        "success": True,
                        "message": "已存在对应知识条目",
                        "data": dict(existing)
                    }

                content = (
                    f"### 问题概述\n"
                    f"- 项目：{issue.get('project_name') or '未知项目'}\n"
                    f"- 医院：{issue.get('hospital_name') or '-'}\n"
                    f"- 类型：{issue.get('issue_type') or '-'}\n"
                    f"- 严重级别：{issue.get('severity') or '-'}\n"
                    f"- 原始描述：{issue.get('description') or '-'}\n\n"
                    f"### 建议沉淀\n"
                    f"- 现象：{issue.get('description') or '-'}\n"
                    f"- 初步排查方向：先确认问题复现条件、影响范围及最近变更。\n"
                    f"- 建议动作：补充根因、解决步骤、验证结果后可进一步完善为标准知识条目。\n"
                )

                insert_sql = DatabasePool.format_sql('''
                    INSERT INTO knowledge_base (category, title, content, tags, project_id, author, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ''')
                cursor = conn.execute(insert_sql, ('问题复盘', title, content, tags, issue.get('project_id'), 'AI助手'))
                kb_id = getattr(cursor, 'lastrowid', None)
                conn.commit()

                created = {
                    "id": kb_id,
                    "category": "问题复盘",
                    "title": title,
                    "content": content,
                    "tags": tags,
                    "project_id": issue.get('project_id')
                }
                return {
                    "success": True,
                    "message": "知识条目提炼成功",
                    "data": created
                }
        except Exception as e:
            logger.error(f"Auto Extract Knowledge Error: {e}")
            return {"success": False, "message": str(e)}

    @staticmethod
    def find_similar_projects(project_id, limit=5):
        """基于地区/规模/状态的轻量相似项目推荐。"""
        try:
            limit = max(1, min(int(limit or 5), 10))
            with DatabasePool.get_connection() as conn:
                current = conn.execute(DatabasePool.format_sql('''
                    SELECT id, project_name, hospital_name, province, city, status,
                           COALESCE(icu_beds, 0) as icu_beds,
                           COALESCE(operating_rooms, 0) as operating_rooms,
                           COALESCE(pacu_beds, 0) as pacu_beds
                    FROM projects
                    WHERE id = ?
                '''), (project_id,)).fetchone()
                if not current:
                    return []

                current = dict(current)
                rows = conn.execute(DatabasePool.format_sql('''
                    SELECT id, project_name, hospital_name, province, city, status,
                           COALESCE(icu_beds, 0) as icu_beds,
                           COALESCE(operating_rooms, 0) as operating_rooms,
                           COALESCE(pacu_beds, 0) as pacu_beds,
                           progress
                    FROM projects
                    WHERE id != ?
                    ORDER BY updated_at DESC NULLS LAST, id DESC
                    LIMIT 100
                '''), (project_id,)).fetchall()

            scored = []
            for row in rows:
                item = dict(row)
                score = 0
                if (item.get('province') or '') == (current.get('province') or '') and current.get('province'):
                    score += 35
                if (item.get('city') or '') == (current.get('city') or '') and current.get('city'):
                    score += 25
                if (item.get('status') or '') == (current.get('status') or ''):
                    score += 15

                current_scale = (current.get('icu_beds') or 0) + (current.get('operating_rooms') or 0) * 5 + (current.get('pacu_beds') or 0)
                item_scale = (item.get('icu_beds') or 0) + (item.get('operating_rooms') or 0) * 5 + (item.get('pacu_beds') or 0)
                scale_gap = abs(current_scale - item_scale)
                score += max(0, 25 - min(scale_gap, 25))

                if score <= 0:
                    continue

                item['similarity_score'] = round(score, 1)
                scored.append(item)

            scored.sort(key=lambda x: (-(x.get('similarity_score') or 0), -(x.get('progress') or 0), x.get('id') or 0))
            return scored[:limit]
        except Exception as e:
            logger.error(f"Find Similar Projects Error: {e}")
            return []

ai_insight_service = AIInsightService()
