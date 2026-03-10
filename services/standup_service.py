# services/standup_service.py
"""
每日站会助手服务
- 自动聚合昨日完成、今日计划、阻塞问题
- AI生成站会纪要
- 企业微信推送每日简报
"""

import logging
from datetime import datetime, timedelta
from database import DatabasePool

logger = logging.getLogger(__name__)


class StandupService:

    @staticmethod
    def get_standup_data(project_id, date_str=None):
        """聚合站会数据：昨日完成 + 今日计划 + 阻塞问题"""
        today = datetime.strptime(date_str, '%Y-%m-%d').date() if date_str else datetime.now().date()
        yesterday = today - timedelta(days=1)

        with DatabasePool.get_connection() as conn:
            sql_p = DatabasePool.format_sql('SELECT id, project_name, hospital_name, status, progress, project_manager FROM projects WHERE id = ?')
            project = conn.execute(sql_p, (project_id,)).fetchone()

            if not project:
                return None

            # 1. 昨日完成的任务
            sql_comp = DatabasePool.format_sql('''
                SELECT t.task_name, s.stage_name, t.completed_date
                FROM tasks t
                JOIN project_stages s ON t.stage_id = s.id
                WHERE s.project_id = ? AND t.is_completed = ? AND t.completed_date = ?
                ORDER BY s.stage_order
            ''')
            yesterday_completed = conn.execute(sql_comp, (project_id, True, yesterday.isoformat())).fetchall()

            # 2. 昨日工作日志
            sql_logs = DatabasePool.format_sql('''
                SELECT member_name, work_content, issues_encountered, tomorrow_plan, work_hours
                FROM work_logs
                WHERE project_id = ? AND log_date = ?
                ORDER BY member_name
            ''')
            yesterday_logs = conn.execute(sql_logs, (project_id, yesterday.isoformat())).fetchall()

            # 3. 今日计划 (从昨日日志的tomorrow_plan + 当前未完成任务)
            today_plans = []
            for log in yesterday_logs:
                if log['tomorrow_plan']:
                    today_plans.append({
                        'member': log['member_name'],
                        'plan': log['tomorrow_plan']
                    })

            # 4. 阻塞问题（未解决的高/中级别问题）
            sql_issues = DatabasePool.format_sql('''
                SELECT id, description, severity, status, created_at
                FROM issues
                WHERE project_id = ? AND status NOT IN ('已解决', '已关闭')
                ORDER BY CASE severity WHEN '高' THEN 1 WHEN '中' THEN 2 ELSE 3 END
            ''')
            blocking_issues = conn.execute(sql_issues, (project_id,)).fetchall()

            # 5. 即将到期的里程碑（7天内）
            sql_mstones = DatabasePool.format_sql('''
                SELECT name, target_date, is_completed
                FROM milestones
                WHERE project_id = ? AND is_completed = ?
                AND target_date BETWEEN ? AND ?
                ORDER BY target_date
            ''')
            upcoming_milestones = conn.execute(sql_mstones, (project_id, False, today.isoformat(), (today + timedelta(days=7)).isoformat())).fetchall()

            # 6. 今日整体进度
            sql_stages = DatabasePool.format_sql('''
                SELECT stage_name, progress, status
                FROM project_stages
                WHERE project_id = ?
                ORDER BY stage_order
            ''')
            stages = conn.execute(sql_stages, (project_id,)).fetchall()

            # 7. 当前在岗人员
            sql_mems = DatabasePool.format_sql('''
                SELECT name, role
                FROM project_members
                WHERE project_id = ? AND status = '在岗' AND is_onsite = ?
            ''')
            members_onsite = conn.execute(sql_mems, (project_id, True)).fetchall()

        return {
            'project': dict(project),
            'date': today.isoformat(),
            'yesterday': yesterday.isoformat(),
            'yesterday_completed': [dict(t) for t in yesterday_completed],
            'yesterday_logs': [dict(l) for l in yesterday_logs],
            'today_plans': today_plans,
            'blocking_issues': [dict(i) for i in blocking_issues],
            'upcoming_milestones': [dict(m) for m in upcoming_milestones],
            'stages': [dict(s) for s in stages],
            'members_onsite': [dict(m) for m in members_onsite],
            'stats': {
                'tasks_completed_yesterday': len(yesterday_completed),
                'logs_yesterday': len(yesterday_logs),
                'blocking_count': len(blocking_issues),
                'upcoming_milestone_count': len(upcoming_milestones),
                'onsite_count': len(members_onsite)
            }
        }

    @staticmethod
    def generate_ai_standup(project_id, date_str=None):
        """AI生成站会纪要"""
        data = StandupService.get_standup_data(project_id, date_str)
        if not data:
            return {'error': '项目不存在'}

        # 构建 prompt
        project = data['project']

        completed_text = "\n".join([
            f"  - [{t['stage_name']}] {t['task_name']}" for t in data['yesterday_completed']
        ]) or "  无"

        logs_text = "\n".join([
            f"  - {l['member_name']}: {l['work_content']}" +
            (f" (遇到问题: {l['issues_encountered']})" if l['issues_encountered'] else "")
            for l in data['yesterday_logs']
        ]) or "  无日志记录"

        plans_text = "\n".join([
            f"  - {p['member']}: {p['plan']}" for p in data['today_plans']
        ]) or "  暂无计划"

        issues_text = "\n".join([
            f"  - [{i['severity']}] {i['description']} ({i['status']})"
            for i in data['blocking_issues']
        ]) or "  无阻塞问题"

        milestone_text = "\n".join([
            f"  - {m['name']} → {m['target_date']}" for m in data['upcoming_milestones']
        ]) or "  无"

        prompt = f"""你是一位经验丰富的ICU/麻醉系统实施项目经理。请基于以下信息生成一份简洁有力的每日站会纪要。

## 项目信息
- 项目: {project['project_name']} ({project['hospital_name']})
- 状态: {project['status']} | 进度: {project['progress']}%
- 日期: {data['date']}

## 昨日完成
{completed_text}

## 昨日工作日志
{logs_text}

## 今日计划
{plans_text}

## 阻塞问题
{issues_text}

## 近7天里程碑
{milestone_text}

---

请按以下格式生成站会纪要（Markdown格式）：

### ✅ 昨日成果
简要总结昨日完成的工作和亮点。

### 📋 今日计划
列出今日重点工作安排（按优先级排列）。

### ⚠️ 风险与阻塞
当前存在的阻塞问题和风险，以及建议的解决方案。

### 🎯 里程碑提醒
即将到来的里程碑和注意事项。

### 💡 项目经理建议
基于当前项目状态给出的简短建议（1-2条）。

要求：简洁务实、重点突出，每个部分控制在3-5条以内。"""

        try:
            from ai_utils import call_ai
            result = call_ai(prompt, task_type='summary')
            return {'standup': result, 'data': data}
        except Exception as e:
            logger.error(f"AI生成站会纪要失败: {e}")
            return {'standup': None, 'data': data, 'error': str(e)}

    @staticmethod
    def generate_daily_briefing():
        """生成全局每日简报（所有活跃项目）"""
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('''
                SELECT id, project_name, hospital_name, status, progress, project_manager
                FROM projects
                WHERE status NOT IN ('已完成', '已终止')
                ORDER BY progress ASC
            ''')
            projects = conn.execute(sql).fetchall()

        if not projects:
            return {'briefing': '当前无活跃项目', 'projects': []}

        briefing_parts = []
        all_data = []

        for p in projects:
            data = StandupService.get_standup_data(p['id'])
            if data:
                all_data.append(data)

        # 构建简报
        total_blocking = sum(d['stats']['blocking_count'] for d in all_data)
        total_milestones = sum(d['stats']['upcoming_milestone_count'] for d in all_data)

        prompt = f"""你是项目管理总监，请基于以下{len(projects)}个活跃项目的状态信息，生成一份每日晨会简报。

## 项目概况
"""
        for d in all_data:
            p = d['project']
            prompt += f"\n### {p['project_name']} ({p['hospital_name']})\n"
            prompt += f"- 状态: {p['status']} | 进度: {p['progress']}% | 负责人: {p.get('project_manager', '未指定')}\n"
            prompt += f"- 昨日完成任务: {d['stats']['tasks_completed_yesterday']} | 阻塞问题: {d['stats']['blocking_count']} | 近期里程碑: {d['stats']['upcoming_milestone_count']}\n"

            if d['blocking_issues']:
                prompt += f"- 阻塞详情: " + "; ".join([i['description'][:50] for i in d['blocking_issues'][:3]]) + "\n"

        prompt += f"""
## 汇总
- 活跃项目: {len(projects)}
- 总阻塞问题: {total_blocking}
- 近7天里程碑: {total_milestones}

---

请生成简报（Markdown格式），包含：
### 📊 今日重点关注
需要重点关注的项目和事项（最多3个）。

### ⚠️ 风险项目
列出进度落后或有阻塞问题的项目。

### 🎯 今日里程碑
即将到期的里程碑汇总。

### 💡 管理建议
1-2条可执行的管理建议。

简洁有力，适合发送到企业微信群。"""

        try:
            from ai_utils import call_ai
            result = call_ai(prompt, task_type='summary')
            return {
                'briefing': result,
                'stats': {
                    'active_projects': len(projects),
                    'total_blocking': total_blocking,
                    'total_milestones': total_milestones
                },
                'projects': [d['project'] for d in all_data]
            }
        except Exception as e:
            logger.error(f"AI生成每日简报失败: {e}")
            # 纯数据兜底
            lines = [f"📊 每日简报 ({datetime.now().strftime('%Y-%m-%d')})", ""]
            lines.append(f"活跃项目: {len(projects)} | 阻塞问题: {total_blocking} | 近期里程碑: {total_milestones}")
            lines.append("")
            for d in all_data:
                p = d['project']
                status_icon = "🔴" if d['stats']['blocking_count'] > 0 else ("🟡" if p['progress'] < 30 else "🟢")
                lines.append(f"{status_icon} {p['project_name']} - {p['progress']}% ({p['status']})")
                if d['blocking_issues']:
                    lines.append(f"   ⚠️ 阻塞: {d['blocking_issues'][0]['description'][:40]}")

            return {
                'briefing': "\n".join(lines),
                'stats': {
                    'active_projects': len(projects),
                    'total_blocking': total_blocking,
                    'total_milestones': total_milestones
                },
                'projects': [d['project'] for d in all_data],
                'error': str(e)
            }

    @staticmethod
    def push_briefing_to_wecom():
        """推送每日简报到企业微信"""
        try:
            from services.monitor_service import monitor_service
            result = StandupService.generate_daily_briefing()
            if result.get('briefing'):
                success, msg = monitor_service.send_wecom_message(
                    '📊 每日项目简报',
                    result['briefing'],
                    msg_type='markdown'
                )
                return {'success': success, 'message': msg if not success else '简报已推送'}
            return {'success': False, 'message': '生成简报失败'}
        except Exception as e:
            logger.error(f"WeChat Push Service Error: {e}")
            return {'success': False, 'message': str(e)}


standup_service = StandupService()
