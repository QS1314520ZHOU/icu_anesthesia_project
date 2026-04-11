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
                
                return {
                    "project_id": project_id,
                    "current_progress": project['progress'],
                    "predicted_end_date": "2026-12-31", # 模拟预判
                    "risk_level": "Normal"
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

ai_insight_service = AIInsightService()
