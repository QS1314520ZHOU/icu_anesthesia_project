# services/analytics_service.py
"""
数据分析服务
提供项目对比分析、趋势数据、导出功能等
"""

import sqlite3
from datetime import datetime, timedelta
from typing import List, Dict, Any
from database import get_db
from services.ai_service import ai_service
import json
import hashlib
import os

class AnalyticsService:
    """数据分析服务"""
    
    def compare_projects(self, project_ids: List[int]) -> Dict[str, Any]:
        """对比多个项目的数据"""
        if not project_ids:
            return {"error": "未选择项目"}
        
        conn = get_db()
        projects_data = []
        
        for pid in project_ids:
            project = conn.execute('SELECT * FROM projects WHERE id = ?', (pid,)).fetchone()
            if not project:
                continue
            
            # 获取阶段和任务统计
            stages = conn.execute('SELECT * FROM project_stages WHERE project_id = ?', (pid,)).fetchall()
            total_tasks = 0
            completed_tasks = 0
            for stage in stages:
                tasks = conn.execute('SELECT * FROM tasks WHERE stage_id = ?', (stage['id'],)).fetchall()
                total_tasks += len(tasks)
                completed_tasks += len([t for t in tasks if t['is_completed']])
            
            # 获取问题统计
            issues = conn.execute('SELECT * FROM issues WHERE project_id = ?', (pid,)).fetchall()
            pending_issues = len([i for i in issues if i['status'] != '已解决'])
            
            # 获取工时统计
            worklogs = conn.execute('''
                SELECT SUM(work_hours) as total_hours FROM work_logs WHERE project_id = ?
            ''', (pid,)).fetchone()
            
            # 获取费用统计
            expenses = conn.execute('''
                SELECT SUM(amount) as total_amount FROM project_expenses WHERE project_id = ?
            ''', (pid,)).fetchone()
            
            projects_data.append({
                "id": project['id'],
                "name": project['project_name'],
                "hospital": project['hospital_name'],
                "status": project['status'],
                "progress": project['progress'],
                "manager": project['project_manager'],
                "plan_start": project['plan_start_date'],
                "plan_end": project['plan_end_date'],
                "stages_count": len(stages),
                "total_tasks": total_tasks,
                "completed_tasks": completed_tasks,
                "task_completion_rate": round(completed_tasks / total_tasks * 100, 1) if total_tasks > 0 else 0,
                "total_issues": len(issues),
                "pending_issues": pending_issues,
                "total_hours": worklogs['total_hours'] or 0 if worklogs else 0,
                "total_expenses": expenses['total_amount'] or 0 if expenses else 0,
                "risk_score": project['risk_score'] or 0
            })
        
        # 计算平均值和对比
        if len(projects_data) > 1:
            avg_progress = sum(p['progress'] for p in projects_data) / len(projects_data)
            avg_completion = sum(p['task_completion_rate'] for p in projects_data) / len(projects_data)
            avg_issues = sum(p['pending_issues'] for p in projects_data) / len(projects_data)
        else:
            avg_progress = avg_completion = avg_issues = 0
        
        return {
            "projects": projects_data,
            "comparison": {
                "average_progress": round(avg_progress, 1),
                "average_task_completion": round(avg_completion, 1),
                "average_pending_issues": round(avg_issues, 1),
                "total_projects": len(projects_data)
            }
        }
    
    def get_trend_data(self, project_id: int = None, days: int = 30) -> Dict[str, Any]:
        """获取趋势数据"""
        conn = get_db()
        cutoff = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
        
        if project_id:
            # 单项目趋势
            progress_history = conn.execute('''
                SELECT record_date, progress, tasks_total, tasks_completed 
                FROM progress_history 
                WHERE project_id = ? AND record_date >= ?
                ORDER BY record_date
            ''', (project_id, cutoff)).fetchall()
            
            worklogs = conn.execute('''
                SELECT log_date, SUM(work_hours) as hours
                FROM work_logs 
                WHERE project_id = ? AND log_date >= ?
                GROUP BY log_date
                ORDER BY log_date
            ''', (project_id, cutoff)).fetchall()
        else:
            # 全局趋势
            progress_history = conn.execute('''
                SELECT record_date, AVG(progress) as progress, 
                       SUM(tasks_total) as tasks_total, SUM(tasks_completed) as tasks_completed
                FROM progress_history 
                WHERE record_date >= ?
                GROUP BY record_date
                ORDER BY record_date
            ''', (cutoff,)).fetchall()
            
            worklogs = conn.execute('''
                SELECT log_date, SUM(work_hours) as hours
                FROM work_logs 
                WHERE log_date >= ?
                GROUP BY log_date
                ORDER BY log_date
            ''', (cutoff,)).fetchall()
        
        return {
            "progress_trend": [
                {"date": r['record_date'], "progress": r['progress'], 
                 "total": r['tasks_total'], "completed": r['tasks_completed']}
                for r in progress_history
            ],
            "workload_trend": [
                {"date": w['log_date'], "hours": w['hours']}
                for w in worklogs
            ]
        }
    
    def get_dashboard_stats(self) -> Dict[str, Any]:
        """获取仪表盘统计数据"""
        conn = get_db()
        total_projects = conn.execute("SELECT COUNT(*) as c FROM projects").fetchone()['c']
        in_progress = conn.execute("SELECT COUNT(*) as c FROM projects WHERE status = '进行中'").fetchone()['c']
        completed = conn.execute("SELECT COUNT(*) as c FROM projects WHERE status = '已完成'").fetchone()['c']
        delayed = conn.execute("SELECT COUNT(*) as c FROM projects WHERE plan_end_date < date('now') AND status NOT IN ('已完成', '已终止', '已验收', '质保期')").fetchone()['c']
        on_departure = conn.execute("SELECT COUNT(*) as c FROM projects WHERE status IN ('暂停', '离场待返')").fetchone()['c']
        total_issues = conn.execute("SELECT COUNT(*) as c FROM issues WHERE status != '已解决'").fetchone()['c']
        critical_issues = conn.execute("SELECT COUNT(*) as c FROM issues WHERE status != '已解决' AND severity = '高'").fetchone()['c']
        
        week_ago = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
        tasks_this_week = conn.execute("SELECT COUNT(*) as c FROM tasks WHERE is_completed = 1 AND completed_date >= ?", (week_ago,)).fetchone()['c']
        hours_this_week = conn.execute("SELECT SUM(work_hours) as total FROM work_logs WHERE log_date >= ?", (week_ago,)).fetchone()['total'] or 0
        
        overdue_milestones = conn.execute('''
            SELECT COUNT(*) as c FROM milestones 
            WHERE is_completed = 0 AND target_date < date('now')
        ''').fetchone()['c']
        
        status_stats = conn.execute('''
            SELECT status, COUNT(*) as count FROM projects GROUP BY status
        ''').fetchall()
        
        # 获取进行中项目的进度及风险
        projects_progress = []
        rows = conn.execute('''
            SELECT id, project_name, hospital_name, progress, status, plan_end_date, risk_score
            FROM projects WHERE status NOT IN ('已完成', '已终止') 
            ORDER BY risk_score DESC, progress DESC
        ''').fetchall()
        
        for row in rows:
            p_dict = dict(row)
            # Use cached risk score instead of recalculating in real-time
            # p_dict['risk_score'] already exists from the SELECT query
            
            # 判定阶段
            if p_dict['status'] in ['暂停', '离场待返']: p_dict['phase'] = '离场'
            elif p_dict['plan_end_date'] and p_dict['plan_end_date'] < datetime.now().strftime('%Y-%m-%d'): p_dict['phase'] = '延期'
            elif p_dict['progress'] < 30: p_dict['phase'] = '启动期'
            elif p_dict['progress'] < 70: p_dict['phase'] = '实施中'
            else: p_dict['phase'] = '收尾期'
            projects_progress.append(p_dict)

        upcoming_reminders = conn.execute('''
            SELECT n.*, p.project_name 
            FROM notifications n 
            LEFT JOIN projects p ON n.project_id = p.id
            WHERE n.is_read = 0 AND (n.due_date IS NULL OR n.due_date >= date('now'))
            ORDER BY n.due_date ASC LIMIT 10
        ''').fetchall()

        return {
            'stats': {
                'total_projects': total_projects, 'in_progress': in_progress,
                'completed': completed, 'delayed': delayed, 'on_departure': on_departure,
                'total_issues': total_issues, 'critical_issues': critical_issues,
                'tasks_completed_this_week': tasks_this_week,
                'week_hours': round(hours_this_week, 1),
                'overdue_milestones': overdue_milestones
            },
            'status_stats': [dict(s) for s in status_stats],
            'projects_progress': projects_progress,
            'upcoming_reminders': [dict(r) for r in upcoming_reminders]
        }

    def get_analytics_overview(self) -> Dict[str, Any]:
        """获取全局统计分析概览"""
        conn = get_db()
        
        # 项目基本统计
        project_stats = conn.execute('''
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = '进行中' THEN 1 ELSE 0 END) as in_progress,
                SUM(CASE WHEN status = '已完成' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status IN ('暂停', '离场待返') THEN 1 ELSE 0 END) as on_hold,
                SUM(CASE WHEN plan_end_date < date('now') AND status NOT IN ('已完成', '已终止', '已验收', '质保期') THEN 1 ELSE 0 END) as overdue,
                AVG(progress) as avg_progress
            FROM projects
        ''').fetchone()
        
        # 问题统计
        issue_stats = conn.execute('''
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = '待处理' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN severity = '高' AND status != '已解决' THEN 1 ELSE 0 END) as critical
            FROM issues
        ''').fetchone()
        
        # 本月工时与费用
        month_start = datetime.now().replace(day=1).strftime('%Y-%m-%d')
        month_hours = conn.execute('SELECT SUM(work_hours) as total FROM work_logs WHERE log_date >= ?', (month_start,)).fetchone()['total'] or 0
        month_expenses = conn.execute('SELECT SUM(amount) as total FROM project_expenses WHERE expense_date >= ?', (month_start,)).fetchone()['total'] or 0
        
        # 按省份分布
        by_province = conn.execute('''
            SELECT province, COUNT(*) as count FROM projects 
            WHERE province IS NOT NULL AND province != '' 
            GROUP BY province ORDER BY count DESC
        ''').fetchall()
        
        # 任务完成趋势 (最近30天)
        thirty_days_ago = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
        task_trend = conn.execute('''
            SELECT completed_date as date, COUNT(*) as count FROM tasks 
            WHERE is_completed = 1 AND completed_date >= ?
            GROUP BY completed_date ORDER BY date
        ''', (thirty_days_ago,)).fetchall()
        
        return {
            'project_stats': dict(project_stats),
            'issue_stats': dict(issue_stats),
            'month_hours': round(month_hours, 1),
            'month_expenses': round(month_expenses, 2),
            'by_province': [dict(p) for p in by_province],
            'task_trend': [dict(t) for t in task_trend]
        }

    def get_geo_stats(self) -> Dict[str, Any]:
        """获取地理分布统计"""
        conn = get_db()
        provinces = conn.execute('''
            SELECT province, COUNT(*) as count, AVG(progress) as avg_progress 
            FROM projects 
            WHERE status != '已删除'
            GROUP BY province
        ''').fetchall()
        
        geo_stats = []
        for p in provinces:
            pname = p['province'] or '其他'
            projects = conn.execute('SELECT id, project_name, hospital_name, progress, status, risk_score FROM projects WHERE province = ?', (p['province'],)).fetchall()
            geo_stats.append({
                'name': pname,
                'count': p['count'],
                'avg_progress': round(p['avg_progress'] or 0, 1),
                'projects': [dict(proj) for proj in projects]
            })

        members = conn.execute('''
            SELECT m.id, m.name, m.role, m.current_city, m.is_onsite, p.project_name, p.id as project_id
            FROM project_members m
            JOIN projects p ON m.project_id = p.id
            WHERE m.current_city IS NOT NULL AND m.current_city != ''
            AND m.status = '在岗'
        ''').fetchall()
        
        return {
            'stats': geo_stats,
            'members': [dict(m) for m in members]
        }

    def get_workload_stats(self) -> Dict[str, Any]:
        """获取成员负载统计"""
        conn = get_db()
        workload = conn.execute('''
            SELECT project_manager as name, COUNT(*) as active_projects, 
                   AVG(progress) as avg_progress
            FROM projects 
            WHERE status NOT IN ('已完成', '已验收', '质保期')
                  AND project_manager IS NOT NULL
            GROUP BY project_manager
        ''').fetchall()
        
        risk_distribution = conn.execute('''
            SELECT COUNT(*) as count, 
                   CASE 
                     WHEN risk_score >= 50 THEN '高风险'
                     WHEN risk_score >= 20 THEN '中风险'
                     ELSE '稳健'
                   END as risk_level
            FROM projects
            GROUP BY risk_level
        ''').fetchall()
        
        return {
            'workload': [dict(w) for w in workload],
            'risk_distribution': [dict(s) for s in risk_distribution]
        }

    def get_global_briefing(self) -> Dict[str, str]:
        """获取高层总结简报"""
        conn = get_db()
        stats = conn.execute('''
            SELECT COUNT(*) as total,
                   SUM(CASE WHEN risk_score >= 50 THEN 1 ELSE 0 END) as high_risk,
                   SUM(CASE WHEN plan_end_date < date('now') AND status NOT IN ('已完成', '已验收', '质保期') THEN 1 ELSE 0 END) as overdue
            FROM projects
        ''').fetchone()
        
        brief = [f"当前在管项目共 {stats['total']} 个，整体运行平稳。"]
        if (stats['high_risk'] or 0) > 0:
            brief.append(f"注意！{stats['high_risk']} 个项目目前处于高风险状态。")
        if (stats['overdue'] or 0) > 0:
            brief.append(f"现有 {stats['overdue']} 个项目已过计划交付期。")
        
        return {'brief': "\n".join(brief)}

    def get_burndown_data(self, project_id: int) -> Dict[str, Any]:
        """获取项目燃尽图数据"""
        conn = get_db()
        project = conn.execute('SELECT project_name, plan_start_date, plan_end_date, created_at FROM projects WHERE id = ?', (project_id,)).fetchone()
        if not project: return {"error": "项目不存在"}
        
        history = conn.execute('''
            SELECT record_date, progress, tasks_total, tasks_completed 
            FROM progress_history WHERE project_id = ? ORDER BY record_date
        ''', (project_id,)).fetchall()
        
        # 理想进度线 (Ideal Line)
        ideal_line = []
        try:
            start_date = datetime.strptime(project['plan_start_date'] or project['created_at'][:10], '%Y-%m-%d')
            end_date_str = project['plan_end_date'] or (datetime.now() + timedelta(days=30)).strftime('%Y-%m-%d')
            end_date = datetime.strptime(end_date_str, '%Y-%m-%d')
            
            # Use current task stats for total if no history
            if not history:
                tasks_stats = conn.execute('''
                    SELECT COUNT(*) as total FROM tasks t JOIN project_stages s ON t.stage_id = s.id WHERE s.project_id = ?
                ''', (project_id,)).fetchone()
                initial_tasks = tasks_stats['total'] or 0
            else:
                initial_tasks = history[0]['tasks_total']

            total_days = (end_date - start_date).days
            if total_days > 0 and initial_tasks > 0:
                daily_burn = initial_tasks / total_days
                for i in range(total_days + 1):
                    current_date = start_date + timedelta(days=i)
                    remaining = max(0, initial_tasks - (daily_burn * i))
                    ideal_line.append({"date": current_date.strftime('%Y-%m-%d'), "value": round(remaining, 1)})
            elif total_days == 0:
                 ideal_line.append({"date": start_date.strftime('%Y-%m-%d'), "value": initial_tasks})
        except Exception as e:
            print(f"Error generating ideal line: {e}")

        # 实际进度线 (Actual Line)
        actual_line = []
        if history:
            for h in history:
                remaining = h['tasks_total'] - h['tasks_completed']
                actual_line.append({"date": h['record_date'], "value": remaining})
        else:
             # Fallback: Start point -> Today/Current Status
             tasks_stats = conn.execute('''
                SELECT COUNT(*) as total, SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END) as completed
                FROM tasks t JOIN project_stages s ON t.stage_id = s.id WHERE s.project_id = ?
            ''', (project_id,)).fetchone()
             total = tasks_stats['total'] or 0
             completed = tasks_stats['completed'] or 0
             remaining = total - completed
             
             # Point 1: Start (Assumed 0 progress)
             actual_line.append({"date": project['plan_start_date'] or project['created_at'][:10], "value": total})
             
             # Point 2: Now (Current progress)
             # Only add if today is different from start date to avoid single-point line if just created
             today_str = datetime.now().strftime('%Y-%m-%d')
             if today_str != actual_line[0]['date']:
                 actual_line.append({"date": today_str, "value": remaining})
             elif len(actual_line) == 1:
                  # If created today, just update the single point to reflect current remaining
                  actual_line[0]['value'] = remaining

        return {
            'project_name': project['project_name'],
            'ideal_line': ideal_line,
            'actual_line': actual_line
        }

    def get_all_gantt_data(self) -> List[Dict[str, Any]]:
        """获取全项目甘特图数据"""
        conn = get_db()
        projects = conn.execute("SELECT * FROM projects WHERE status NOT IN ('已完成', '已终止') ORDER BY plan_start_date").fetchall()
        result = []
        for p in projects:
            pid = p['id']
            stages = conn.execute('SELECT * FROM project_stages WHERE project_id = ? ORDER BY stage_order', (pid,)).fetchall()
            milestones = conn.execute('SELECT * FROM milestones WHERE project_id = ?', (pid,)).fetchall()
            result.append({
                'project': dict(p),
                'stages': [dict(s) for s in stages],
                'milestones': [dict(m) for m in milestones]
            })
        return result

    def get_performance_analytics(self) -> List[Dict[str, Any]]:
        """按人员统计绩效"""
        conn = get_db()
        # 奖金统计
        stage_bonuses = conn.execute('''
            SELECT responsible_person, SUM(bonus_amount) as total_bonus, COUNT(*) as stage_count
            FROM project_stages 
            WHERE responsible_person IS NOT NULL AND status = '已完成'
            GROUP BY responsible_person
        ''').fetchall()
        
        # 报销统计
        expenses = conn.execute('''
            SELECT applicant, SUM(amount) as total_expense
            FROM project_expenses WHERE status = '已报销'
            GROUP BY applicant
        ''').fetchall()
        expense_map = {e['applicant']: e['total_expense'] for e in expenses}
        
        performance = []
        for sb in stage_bonuses:
            name = sb['responsible_person']
            bonus = sb['total_bonus'] or 0
            expense = expense_map.get(name, 0)
            performance.append({
                'name': name,
                'total_bonus': round(bonus, 2),
                'total_expense': round(expense, 2),
                'net_performance': round(bonus - expense, 2),
                'stage_count': sb['stage_count']
            })
        
        performance.sort(key=lambda x: x['net_performance'], reverse=True)
        return performance

    def _generate_recommendations(self, factors: List[Dict]) -> List[str]:
        """基于健康因素生成建议"""
        recommendations = []
        for f in factors:
            if "进度" in f['factor']:
                recommendations.append("建议增加资源投入或调整项目计划")
            if "问题" in f['factor']:
                recommendations.append("建议优先处理高严重度问题")
            if "里程碑" in f['factor']:
                recommendations.append("建议检查逾期原因并更新里程碑计划")
            if "更新" in f['factor']:
                recommendations.append("建议团队及时填写工作日志")
        return list(set(recommendations))[:3]  # 最多3条建议


    def calculate_project_hash(self, project_id: int) -> str:
        """计算单个项目数据的哈希值"""
        conn = get_db()
        data = []
        # 项目基本信息
        p = conn.execute('SELECT * FROM projects WHERE id = ?', (project_id,)).fetchone()
        if p: data.append(str(dict(p)))
        # 阶段信息
        stages = conn.execute('SELECT * FROM project_stages WHERE project_id = ?', (project_id,)).fetchall()
        data.append(str([dict(s) for s in stages]))
        # 任务信息
        tasks = conn.execute('SELECT * FROM tasks t JOIN project_stages s ON t.stage_id = s.id WHERE s.project_id = ?', (project_id,)).fetchall()
        data.append(str([dict(t) for t in tasks]))
        
        return hashlib.md5("".join(data).encode('utf-8')).hexdigest()

    def calculate_all_projects_hash(self) -> str:
        """计算所有活跃项目的数据哈希值"""
        conn = get_db()
        projects = conn.execute("SELECT id FROM projects WHERE status NOT IN ('已完成', '已终止')").fetchall()
        combined_hash = "".join([self.calculate_project_hash(p['id']) for p in projects])
        return hashlib.md5(combined_hash.encode('utf-8')).hexdigest()

    def get_cached_report(self, project_id: int, report_type: str) -> str:
        """获取缓存的报告"""
        conn = get_db()
        current_hash = self.calculate_project_hash(project_id) if project_id else self.calculate_all_projects_hash()
        
        row = conn.execute('''
            SELECT content FROM report_cache 
            WHERE project_id = ? AND report_type = ? AND data_hash = ?
        ''', (project_id or 0, report_type, current_hash)).fetchone()
        
        return row['content'] if row else None

    def save_report_cache(self, project_id: int, report_type: str, content: str, data_hash: str):
        """保存报告缓存"""
        with get_db() as conn:
            conn.execute('''
                INSERT OR REPLACE INTO report_cache (project_id, report_type, content, data_hash, update_time)
                VALUES (?, ?, ?, ?, ?)
            ''', (project_id, report_type, content, data_hash, datetime.now().strftime('%Y-%m-%d %H:%M:%S')))
            conn.commit()

    def get_stage_baselines(self):
        """
        统计全系统各阶段的平均耗时 (基准工期库)
        """
        with get_db() as conn:
            # 统计已完成阶段的实际周期
            # 计算规则：actual_end_date - actual_start_date
            return [dict(row) for row in conn.execute('''
                SELECT stage_name, 
                       AVG(julianday(actual_end_date) - julianday(actual_start_date)) as avg_days,
                       COUNT(*) as sample_count
                FROM project_stages
                WHERE actual_start_date IS NOT NULL AND actual_end_date IS NOT NULL
                GROUP BY stage_name
                HAVING sample_count >= 1
                ORDER BY avg_days ASC
            ''').fetchall()]

# 全局实例
analytics_service = AnalyticsService()
