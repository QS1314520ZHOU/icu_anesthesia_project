# services/analytics_service.py
"""
数据分析服务
提供项目对比分析、趋势数据、导出功能等
"""

from database import DatabasePool
from services.ai_service import ai_service
import json
import hashlib
import os
import re
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Union

class AnalyticsService:
    """数据分析服务"""
    
    def compare_projects(self, project_ids: List[int]) -> Dict[str, Any]:
        """对比多个项目的数据"""
        if not project_ids:
            return {"error": "未选择项目"}
        
        with DatabasePool.get_connection() as conn:
            projects_data = []
            
            for pid in project_ids:
                sql_p = DatabasePool.format_sql('SELECT * FROM projects WHERE id = ?')
                project = conn.execute(sql_p, (pid,)).fetchone()
                if not project:
                    continue
                
                # 获取阶段和任务统计
                sql_st = DatabasePool.format_sql('SELECT * FROM project_stages WHERE project_id = ?')
                stages = conn.execute(sql_st, (pid,)).fetchall()
                total_tasks = 0
                completed_tasks = 0
                for stage in stages:
                    sql_t = DatabasePool.format_sql('SELECT * FROM tasks WHERE stage_id = ?')
                    tasks = conn.execute(sql_t, (stage['id'],)).fetchall()
                    total_tasks += len(tasks)
                    completed_tasks += len([t for t in tasks if t['is_completed']])
                
                # 获取问题统计
                sql_is = DatabasePool.format_sql('SELECT * FROM issues WHERE project_id = ?')
                issues = conn.execute(sql_is, (pid,)).fetchall()
                pending_issues = len([i for i in issues if i['status'] != '已解决'])
                
                # 获取工时统计
                sql_h = DatabasePool.format_sql('SELECT SUM(work_hours) as total_hours FROM work_logs WHERE project_id = ?')
                worklogs = conn.execute(sql_h, (pid,)).fetchone()
                
                # 获取费用统计
                sql_e = DatabasePool.format_sql('SELECT SUM(amount) as total_amount FROM project_expenses WHERE project_id = ?')
                expenses = conn.execute(sql_e, (pid,)).fetchone()
                
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
        with DatabasePool.get_connection() as conn:
            cutoff = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
            
            if project_id:
                # 单项目趋势
                sql_p = DatabasePool.format_sql('''
                    SELECT record_date, progress, tasks_total, tasks_completed 
                    FROM progress_history 
                    WHERE project_id = ? AND record_date >= ?
                    ORDER BY record_date
                ''')
                progress_history = conn.execute(sql_p, (project_id, cutoff)).fetchall()
                
                sql_w = DatabasePool.format_sql('''
                    SELECT log_date, SUM(work_hours) as hours
                    FROM work_logs 
                    WHERE project_id = ? AND log_date >= ?
                    GROUP BY log_date
                    ORDER BY log_date
                ''')
                worklogs = conn.execute(sql_w, (project_id, cutoff)).fetchall()
            else:
                # 全局趋势
                sql_p = DatabasePool.format_sql('''
                    SELECT record_date, AVG(progress) as progress, 
                           SUM(tasks_total) as tasks_total, SUM(tasks_completed) as tasks_completed
                    FROM progress_history 
                    WHERE record_date >= ?
                    GROUP BY record_date
                    ORDER BY record_date
                ''')
                progress_history = conn.execute(sql_p, (cutoff,)).fetchall()
                
                sql_w = DatabasePool.format_sql('''
                    SELECT log_date, SUM(work_hours) as hours
                    FROM work_logs 
                    WHERE log_date >= ?
                    GROUP BY log_date
                    ORDER BY log_date
                ''')
                worklogs = conn.execute(sql_w, (cutoff,)).fetchall()
        
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
        with DatabasePool.get_connection() as conn:
            total_projects = conn.execute(DatabasePool.format_sql("SELECT COUNT(*) as c FROM projects")).fetchone()['c']
            in_progress = conn.execute(DatabasePool.format_sql("SELECT COUNT(*) as c FROM projects WHERE status = '进行中'")).fetchone()['c']
            completed = conn.execute(DatabasePool.format_sql("SELECT COUNT(*) as c FROM projects WHERE status = '已完成'")).fetchone()['c']
            
            overdue_sql = DatabasePool.format_sql("SELECT COUNT(*) as c FROM projects WHERE plan_end_date < CURRENT_DATE AND status NOT IN ('已完成', '已终止', '已验收', '质保期')")
            delayed = conn.execute(overdue_sql).fetchone()['c']
            
            on_departure = conn.execute(DatabasePool.format_sql("SELECT COUNT(*) as c FROM projects WHERE status IN ('暂停', '离场待返')")).fetchone()['c']
            total_issues = conn.execute(DatabasePool.format_sql("SELECT COUNT(*) as c FROM issues WHERE status != '已解决'")).fetchone()['c']
            critical_issues = conn.execute(DatabasePool.format_sql("SELECT COUNT(*) as c FROM issues WHERE status != '已解决' AND severity = '高'")).fetchone()['c']
            
            week_ago = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
            sql_tasks = DatabasePool.format_sql("SELECT COUNT(*) as c FROM tasks WHERE is_completed = ? AND completed_date >= ?")
            tasks_this_week = conn.execute(sql_tasks, (True, week_ago)).fetchone()['c']
            
            sql_hours = DatabasePool.format_sql("SELECT SUM(work_hours) as total FROM work_logs WHERE log_date >= ?")
            hours_this_week = conn.execute(sql_hours, (week_ago,)).fetchone()['total'] or 0
            
            milestone_overdue_sql = DatabasePool.format_sql("SELECT COUNT(*) as c FROM milestones WHERE is_completed = ? AND target_date < CURRENT_DATE")
            overdue_milestones = conn.execute(milestone_overdue_sql, (False,)).fetchone()['c']
            
            status_stats = conn.execute(DatabasePool.format_sql('''
                SELECT status, COUNT(*) as count FROM projects GROUP BY status
            ''')).fetchall()
            
            # 获取进行中项目的进度及风险
            projects_progress = []
            rows = conn.execute(DatabasePool.format_sql('''
                SELECT id, project_name, hospital_name, progress, status, plan_end_date, risk_score
                FROM projects WHERE status NOT IN ('已完成', '已终止', '已验收', '质保期') 
                ORDER BY risk_score DESC, progress DESC
            ''')).fetchall()
            today_str = datetime.now().strftime('%Y-%m-%d')
            
            for row in rows:
                p_dict = dict(row)
                # 判定阶段
                if p_dict['status'] in ['暂停', '离场待返']: p_dict['phase'] = '离场'
                elif p_dict['plan_end_date'] and str(p_dict['plan_end_date']) < today_str: p_dict['phase'] = '延期'
                elif p_dict['progress'] < 30: p_dict['phase'] = '启动期'
                elif p_dict['progress'] < 70: p_dict['phase'] = '实施中'
                else: p_dict['phase'] = '收尾期'
                projects_progress.append(p_dict)

            reminder_sql = DatabasePool.format_sql('''
                SELECT n.*, p.project_name 
                FROM notifications n 
                LEFT JOIN projects p ON n.project_id = p.id
                WHERE n.is_read = ? AND (n.due_date IS NULL OR n.due_date >= CURRENT_DATE)
                ORDER BY n.due_date ASC LIMIT 10
            ''')
            upcoming_reminders = conn.execute(reminder_sql, (False,)).fetchall()

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
        with DatabasePool.get_connection() as conn:
            # 项目基本统计
            project_stats = conn.execute(DatabasePool.format_sql('''
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = '进行中' THEN 1 ELSE 0 END) as in_progress,
                    SUM(CASE WHEN status = '已完成' THEN 1 ELSE 0 END) as completed,
                    SUM(CASE WHEN status IN ('暂停', '离场待返') THEN 1 ELSE 0 END) as on_hold,
                    SUM(CASE WHEN plan_end_date < CURRENT_DATE AND status NOT IN ('已完成', '已终止', '已验收', '质保期') THEN 1 ELSE 0 END) as overdue,
                    AVG(progress) as avg_progress
                FROM projects
            ''')).fetchone()
            
            # 问题统计
            issue_stats = conn.execute(DatabasePool.format_sql('''
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = '待处理' THEN 1 ELSE 0 END) as pending,
                    SUM(CASE WHEN severity = '高' AND status != '已解决' THEN 1 ELSE 0 END) as critical
                FROM issues
            ''')).fetchone()
            
            # 本月工时与费用
            month_start = datetime.now().replace(day=1).strftime('%Y-%m-%d')
            month_hours = conn.execute(DatabasePool.format_sql('SELECT SUM(work_hours) as total FROM work_logs WHERE log_date >= ?'), (month_start,)).fetchone()['total'] or 0
            month_expenses = conn.execute(DatabasePool.format_sql('SELECT SUM(amount) as total FROM project_expenses WHERE expense_date >= ?'), (month_start,)).fetchone()['total'] or 0
            
            # 按省份分布
            by_province = conn.execute(DatabasePool.format_sql('''
                SELECT province, COUNT(*) as count FROM projects 
                WHERE province IS NOT NULL AND province != '' 
                GROUP BY province ORDER BY count DESC
            ''')).fetchall()
            
            # 任务完成趋势 (最近30天)
            thirty_days_ago = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
            task_trend = conn.execute(DatabasePool.format_sql('''
                SELECT completed_date as date, COUNT(*) as count FROM tasks 
                WHERE is_completed = ? AND completed_date >= ?
                GROUP BY completed_date ORDER BY date
            '''), (True, thirty_days_ago,)).fetchall()
        
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
        with DatabasePool.get_connection() as conn:
            provinces = conn.execute(DatabasePool.format_sql('''
                SELECT province, COUNT(*) as count, AVG(progress) as avg_progress 
                FROM projects 
                WHERE status != '已删除'
                GROUP BY province
            ''')).fetchall()
            
            geo_stats = []
            for p in provinces:
                pname = p['province'] or '其他'
                sql_p = DatabasePool.format_sql('SELECT id, project_name, hospital_name, progress, status, risk_score FROM projects WHERE province = ?')
                projects = conn.execute(sql_p, (p['province'],)).fetchall()
                geo_stats.append({
                    'name': pname,
                    'count': p['count'],
                    'avg_progress': round(p['avg_progress'] or 0, 1),
                    'projects': [dict(proj) for proj in projects]
                })

            members = conn.execute(DatabasePool.format_sql('''
                SELECT m.id, m.name, m.role, m.current_city, m.is_onsite, p.project_name, p.id as project_id
                FROM project_members m
                JOIN projects p ON m.project_id = p.id
                WHERE m.current_city IS NOT NULL AND m.current_city != ''
                AND m.status = '在岗'
            ''')).fetchall()
        
        return {
            'stats': geo_stats,
            'members': [dict(m) for m in members]
        }

    def get_workload_stats(self) -> Dict[str, Any]:
        """获取成员负载统计"""
        with DatabasePool.get_connection() as conn:
            workload = conn.execute(DatabasePool.format_sql('''
                SELECT project_manager as name, COUNT(*) as active_projects, 
                       AVG(progress) as avg_progress
                FROM projects 
                WHERE status NOT IN ('已完成', '已验收', '质保期')
                      AND project_manager IS NOT NULL
                GROUP BY project_manager
            ''')).fetchall()
            
            risk_distribution = conn.execute(DatabasePool.format_sql('''
                SELECT COUNT(*) as count, 
                       CASE 
                         WHEN risk_score >= 50 THEN '高风险'
                         WHEN risk_score >= 20 THEN '中风险'
                         ELSE '稳健'
                       END as risk_level
                FROM projects
                GROUP BY risk_level
            ''')).fetchall()
        
        return {
            'workload': [dict(w) for w in workload],
            'risk_distribution': [dict(s) for s in risk_distribution]
        }

    def get_global_briefing(self) -> Dict[str, str]:
        """获取高层总结简报"""
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('''
                SELECT COUNT(*) as total,
                       SUM(CASE WHEN risk_score >= 50 THEN 1 ELSE 0 END) as high_risk,
                       SUM(CASE WHEN plan_end_date < CURRENT_DATE AND status NOT IN ('已完成', '已验收', '质保期') THEN 1 ELSE 0 END) as overdue
                FROM projects
            ''')
            stats = conn.execute(sql).fetchone()
            
            brief = [f"当前在管项目共 {stats['total']} 个，整体运行平稳。"]
            if (stats['high_risk'] or 0) > 0:
                brief.append(f"注意！{stats['high_risk']} 个项目目前处于高风险状态。")
            if (stats['overdue'] or 0) > 0:
                brief.append(f"现有 {stats['overdue']} 个项目已过计划交付期。")
            
            return {'brief': "\n".join(brief)}

    def get_project_health_score(self, project_id: int) -> Dict[str, Any]:
        """获取项目健康度评分"""
        with DatabasePool.get_connection() as conn:
            sql_p = DatabasePool.format_sql('''
                SELECT id, project_name, hospital_name, status, progress,
                       plan_end_date, risk_score, project_manager
                FROM projects
                WHERE id = ?
            ''')
            proj = conn.execute(sql_p, (project_id,)).fetchone()
            if not proj:
                return {"score": 0, "factors": [], "error": "Project not found"}

            p = dict(proj)

            today = datetime.now().date()

            # 1. 进度偏差
            try:
                plan_end_str = str(p['plan_end_date']).strip()[:10] if p.get('plan_end_date') else ""
                plan_end = datetime.strptime(plan_end_str, '%Y-%m-%d').date() if plan_end_str else None
            except (ValueError, AttributeError):
                plan_end = None

            if plan_end:
                total_days = (plan_end - today).days
                expected_progress = max(0, min(100, 100 - (total_days / 90 * 100))) if total_days > 0 else 100
                progress_deviation = (p.get('progress') or 0) - expected_progress
            else:
                expected_progress = None
                progress_deviation = 0

            # 2. 未解决问题数
            sql_issues = DatabasePool.format_sql(
                "SELECT COUNT(*) as c FROM issues WHERE project_id = ? AND status != '已解决'"
            )
            open_issues = int(conn.execute(sql_issues, (project_id,)).fetchone()['c'])

            # 3. 接口完成率
            sql_total = DatabasePool.format_sql("SELECT COUNT(*) as c FROM interfaces WHERE project_id = ?")
            total_interfaces = int(conn.execute(sql_total, (project_id,)).fetchone()['c'])
            sql_comp = DatabasePool.format_sql(
                "SELECT COUNT(*) as c FROM interfaces WHERE project_id = ? AND status = '已完成'"
            )
            completed_interfaces = int(conn.execute(sql_comp, (project_id,)).fetchone()['c'])
            interface_rate = (completed_interfaces / total_interfaces * 100) if total_interfaces > 0 else 100

            # 4. 逾期里程碑
            sql_ms = DatabasePool.format_sql('''
                SELECT COUNT(*) as c
                FROM milestones
                WHERE project_id = ? AND is_completed = ? AND target_date < ?
            ''')
            overdue_ms = int(conn.execute(sql_ms, (project_id, False, today.strftime('%Y-%m-%d'))).fetchone()['c'])

            # 5. 健康分
            score = 100.0
            issue_deduction = float(open_issues * 5)
            milestone_deduction = float(overdue_ms * 10)
            interface_deduction = 15.0 if interface_rate < 50 else 0.0
            progress_deduction = 20.0 if progress_deviation < -20 else 0.0
            risk_deduction = float(min(15, p.get('risk_score') or 0))

            score -= issue_deduction
            score -= milestone_deduction
            score -= interface_deduction
            score -= progress_deduction
            score -= risk_deduction
            score = max(0.0, score)

            factors = []
            if open_issues > 0:
                factors.append({'type': 'issue', 'desc': f'{open_issues} 个未解决问题', 'deduction': issue_deduction})
            if overdue_ms > 0:
                factors.append({'type': 'milestone', 'desc': f'{overdue_ms} 个逾期里程碑', 'deduction': milestone_deduction})
            if interface_rate < 50:
                factors.append({'type': 'interface', 'desc': f'接口完成率仅 {round(interface_rate)}%', 'deduction': interface_deduction})
            if progress_deviation < -20:
                factors.append({'type': 'progress', 'desc': f'进度落后 {round(abs(progress_deviation))}%', 'deduction': progress_deduction})
            if (p.get('risk_score') or 0) > 0:
                factors.append({'type': 'risk', 'desc': f"风险评分 {round(p.get('risk_score') or 0, 1)}", 'deduction': risk_deduction})

            if score >= 70:
                health_status = 'green'
                health_label = '健康'
            elif score >= 40:
                health_status = 'yellow'
                health_label = '需关注'
            else:
                health_status = 'red'
                health_label = '风险'

            return {
                "score": int(round(score)),
                "health_status": health_status,
                "health_label": health_label,
                "factors": factors,
                "details": {
                    "project_id": project_id,
                    "project_name": p.get('project_name'),
                    "hospital_name": p.get('hospital_name'),
                    "status": p.get('status'),
                    "progress": p.get('progress') or 0,
                    "open_issues": open_issues,
                    "overdue_ms": overdue_ms,
                    "interface_rate": round(interface_rate),
                    "completed_interfaces": completed_interfaces,
                    "total_interfaces": total_interfaces,
                    "expected_progress": round(expected_progress) if expected_progress is not None else None,
                    "progress_deviation": round(progress_deviation),
                    "risk_score": float(p.get('risk_score') or 0)
                }
            }

    def get_burndown_data(self, project_id: int) -> Dict[str, Any]:
        """获取项目燃尽图数据"""
        with DatabasePool.get_connection() as conn:
            sql_p = DatabasePool.format_sql('SELECT project_name, plan_start_date, plan_end_date, created_at FROM projects WHERE id = ?')
            project = conn.execute(sql_p, (project_id,)).fetchone()
            if not project: return {"error": "项目不存在"}
            
            sql_h = DatabasePool.format_sql('SELECT record_date, progress, tasks_total, tasks_completed FROM progress_history WHERE project_id = ? ORDER BY record_date')
            history = conn.execute(sql_h, (project_id,)).fetchall()
            
            # 理想进度线 (Ideal Line)
            ideal_line = []
            try:
                start_date_str = str(project['plan_start_date'])[:10] if project['plan_start_date'] else str(project['created_at'])[:10]
                start_date = datetime.strptime(start_date_str, '%Y-%m-%d')
                end_date_str = str(project['plan_end_date'])[:10] if project['plan_end_date'] else (datetime.now() + timedelta(days=30)).strftime('%Y-%m-%d')
                end_date = datetime.strptime(end_date_str, '%Y-%m-%d')
                
                # Use current task stats for total if no history
                if not history:
                    sql_ts = DatabasePool.format_sql('SELECT COUNT(*) as total FROM tasks t JOIN project_stages s ON t.stage_id = s.id WHERE s.project_id = ?')
                    tasks_stats = conn.execute(sql_ts, (project_id,)).fetchone()
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
                    actual_line.append({"date": str(h['record_date'])[:10], "value": remaining})
            else:
                 # Fallback: Start point -> Today/Current Status
                 sql_fall = DatabasePool.format_sql('SELECT COUNT(*) as total, SUM(CASE WHEN is_completed = ? THEN 1 ELSE 0 END) as completed FROM tasks t JOIN project_stages s ON t.stage_id = s.id WHERE s.project_id = ?')
                 tasks_stats = conn.execute(sql_fall, (True, project_id)).fetchone()
                 total = tasks_stats['total'] or 0
                 completed = tasks_stats['completed'] or 0
                 remaining = total - completed
                 
                 # Point 1: Start (Assumed 0 progress)
                 actual_line.append({"date": str(project['plan_start_date'])[:10] if project['plan_start_date'] else str(project['created_at'])[:10], "value": total})
                 
                 # Point 2: Now (Current progress)
                 today_str = datetime.now().strftime('%Y-%m-%d')
                 if today_str != actual_line[0]['date']:
                     actual_line.append({"date": today_str, "value": remaining})
                 elif len(actual_line) == 1:
                      actual_line[0]['value'] = remaining

        return {
            'project_name': project['project_name'],
            'ideal_line': ideal_line,
            'actual_line': actual_line
        }

    def get_all_gantt_data(self) -> List[Dict[str, Any]]:
        """获取全项目甘特图数据"""
        with DatabasePool.get_connection() as conn:
            projects = conn.execute(DatabasePool.format_sql("SELECT * FROM projects WHERE status NOT IN ('已完成', '已终止', '已验收', '质保期') ORDER BY plan_start_date")).fetchall()
            result = []
            for p in projects:
                pid = p['id']
                sql_st = DatabasePool.format_sql('SELECT * FROM project_stages WHERE project_id = ? ORDER BY stage_order')
                stages = conn.execute(sql_st, (pid,)).fetchall()
                sql_mil = DatabasePool.format_sql('SELECT * FROM milestones WHERE project_id = ?')
                milestones = conn.execute(sql_mil, (pid,)).fetchall()
                result.append({
                    'project': dict(p),
                    'stages': [dict(s) for s in stages],
                    'milestones': [dict(m) for m in milestones]
                })
            return result

    def get_performance_analytics(self) -> List[Dict[str, Any]]:
        """按人员统计绩效"""
        with DatabasePool.get_connection() as conn:
            # 奖金统计
            stage_bonuses = conn.execute(DatabasePool.format_sql('''
                SELECT responsible_person, SUM(bonus_amount) as total_bonus, COUNT(*) as stage_count
                FROM project_stages 
                WHERE responsible_person IS NOT NULL AND status = '已完成'
                GROUP BY responsible_person
            ''')).fetchall()
            
            # 报销统计
            expenses = conn.execute(DatabasePool.format_sql('''
                SELECT applicant, SUM(amount) as total_expense
                FROM project_expenses WHERE status = '已报销'
                GROUP BY applicant
            ''')).fetchall()
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

    def get_global_anomaly_briefing(self, use_ai: bool = True) -> Dict[str, Any]:
        """全局异常巡航简报：聚合预警、沉默人员、高风险项目。"""
        from services.warning_service import warning_service
        from services.member_service import member_service

        warning_data = warning_service.get_warning_summary()
        warnings = warning_data.get('warnings', []) or []
        high_warnings = [w for w in warnings if w.get('severity') == 'high']

        people_board = member_service.get_people_project_board(current_user=None, silent_days=3)
        silent_people = [p for p in people_board if p.get('is_silent')]

        with DatabasePool.get_connection() as conn:
            high_risk_projects = conn.execute(DatabasePool.format_sql('''
                SELECT id, project_name, hospital_name, progress, risk_score, project_manager
                FROM projects
                WHERE status NOT IN ('已完成', '已终止', '已验收', '质保期')
                ORDER BY risk_score DESC, progress ASC
                LIMIT 5
            ''')).fetchall()
            high_risk_projects = [dict(r) for r in high_risk_projects if float(r.get('risk_score') or 0) >= 50]

        fallback_lines = [
            f"今日全局巡航：高优预警 {len(high_warnings)} 条，沉默人员 {len(silent_people)} 人，高风险项目 {len(high_risk_projects)} 个。"
        ]
        if silent_people:
            names = "、".join(p.get('member_name') for p in silent_people[:5] if p.get('member_name'))
            fallback_lines.append(f"重点关注沉默人员：{names}")
        if high_risk_projects:
            proj_names = "、".join(p.get('project_name') for p in high_risk_projects[:5] if p.get('project_name'))
            fallback_lines.append(f"高风险项目：{proj_names}")
        fallback_lines.append("建议：先处理高优预警，再逐一确认沉默人员阻塞点。")
        fallback_brief = "\n".join(fallback_lines)

        brief_text = fallback_brief
        if use_ai:
            try:
                system_prompt = "你是经营管理驾驶舱的异常巡航官，请输出简短、可执行的管理提醒。"
                user_content = f"""
请根据以下结构化数据生成“今日经营异常巡航摘要”（120字以内，2-4句）。
要求：直接给管理动作，不要寒暄。

高优预警数：{len(high_warnings)}
沉默人员数：{len(silent_people)}
沉默人员：{[p.get('member_name') for p in silent_people[:5]]}
高风险项目：{[p.get('project_name') for p in high_risk_projects[:5]]}
"""
                ai_text = ai_service.call_ai_api(system_prompt, user_content, task_type="analysis")
                if ai_text and 'AI服务暂时不可用' not in ai_text:
                    brief_text = ai_text.strip()
            except Exception:
                pass

        return {
            'briefing': brief_text,
            'stats': {
                'high_warning_count': len(high_warnings),
                'silent_people_count': len(silent_people),
                'high_risk_project_count': len(high_risk_projects),
            },
            'silent_people': silent_people[:10],
            'high_risk_projects': high_risk_projects[:10],
        }

    def get_weekly_log_semantic_digest(self, days: int = 7, use_ai: bool = False) -> Dict[str, Any]:
        """每周日报语义分析：识别阻塞、协同、疲态等隐性信号。"""
        days = max(1, min(int(days or 7), 30))
        cutoff = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')

        with DatabasePool.get_connection() as conn:
            logs = conn.execute(DatabasePool.format_sql('''
                SELECT project_id, member_name, log_date, work_content, issues_encountered, tomorrow_plan
                FROM work_logs
                WHERE log_date >= ?
                ORDER BY member_name ASC, log_date ASC
            '''), (cutoff,)).fetchall()

            project_map_rows = conn.execute(DatabasePool.format_sql('''
                SELECT id, project_name FROM projects
            ''')).fetchall()
            project_map = {row['id']: row['project_name'] for row in project_map_rows}

        grouped = {}
        for row in logs:
            item = dict(row)
            member = (item.get('member_name') or '未知成员').strip()
            grouped.setdefault(member, []).append(item)

        block_keywords = ['等待', '协调', '未确认', '卡住', '阻塞', '延期', '风险', '问题', '待定']
        collaboration_keywords = ['协调', '沟通', '确认', '对接', '同步', '联调', '支持']

        member_reports = []
        for member, rows in grouped.items():
            text_blob = "\n".join(
                f"{r.get('work_content') or ''} {r.get('issues_encountered') or ''} {r.get('tomorrow_plan') or ''}"
                for r in rows
            )
            cleaned_lines = [line.strip() for line in text_blob.splitlines() if line.strip()]
            avg_len = round(sum(len(line) for line in cleaned_lines) / len(cleaned_lines), 2) if cleaned_lines else 0
            block_hits = sum(text_blob.count(k) for k in block_keywords)
            collab_hits = sum(text_blob.count(k) for k in collaboration_keywords)
            short_log_ratio = round(
                (sum(1 for line in cleaned_lines if len(line) <= 15) / len(cleaned_lines)) * 100, 2
            ) if cleaned_lines else 0

            projects = sorted({project_map.get(r.get('project_id')) for r in rows if r.get('project_id') in project_map})
            risk_signals = []
            if block_hits >= 3:
                risk_signals.append('连续阻塞信号偏高')
            if short_log_ratio >= 60:
                risk_signals.append('日志信息量偏低')
            if collab_hits >= 3:
                risk_signals.append('跨方协同事项较多')
            if not risk_signals:
                risk_signals.append('整体节奏平稳')

            summary_text = f"{member}近{days}天日志{len(rows)}条，阻塞词{block_hits}次，协同词{collab_hits}次。"
            if use_ai:
                try:
                    system_prompt = "你是项目经营分析助手，请将日志语义信号浓缩为一句管理建议。"
                    user_prompt = f"成员：{member}\n项目：{projects}\n信号：{risk_signals}\n统计：{summary_text}\n请输出1句话。"
                    ai_line = ai_service.call_ai_api(system_prompt, user_prompt, task_type='analysis')
                    if ai_line and 'AI服务暂时不可用' not in ai_line:
                        summary_text = ai_line.strip()
                except Exception:
                    pass

            member_reports.append({
                'member_name': member,
                'projects': projects,
                'log_count': len(rows),
                'avg_log_length': avg_len,
                'short_log_ratio': short_log_ratio,
                'block_signal_count': block_hits,
                'collaboration_signal_count': collab_hits,
                'risk_signals': risk_signals,
                'summary': summary_text
            })

        member_reports.sort(key=lambda x: (-(x.get('block_signal_count') or 0), -(x.get('short_log_ratio') or 0), x.get('member_name') or ''))

        high_risk_members = [
            r for r in member_reports
            if (r.get('block_signal_count') or 0) >= 3 or (r.get('short_log_ratio') or 0) >= 60
        ]
        overview = {
            'member_count': len(member_reports),
            'high_risk_member_count': len(high_risk_members),
            'period_days': days,
            'generated_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        }
        return {
            'overview': overview,
            'high_risk_members': high_risk_members[:10],
            'member_reports': member_reports
        }

    def get_acceptance_readiness(self, project_id: int) -> Dict[str, Any]:
        """验收准备度评估（项目维度，融合床位与设备对接状态）。"""
        with DatabasePool.get_connection() as conn:
            project = conn.execute(
                DatabasePool.format_sql('SELECT id, project_name, hospital_name FROM projects WHERE id = ?'),
                (project_id,)
            ).fetchone()
            if not project:
                return {'error': '项目不存在'}
            project = dict(project)

            # 1) 任务完成度
            total_tasks = conn.execute(DatabasePool.format_sql('''
                SELECT COUNT(*) as c
                FROM tasks t
                JOIN project_stages s ON s.id = t.stage_id
                WHERE s.project_id = ?
            '''), (project_id,)).fetchone()['c'] or 0
            done_tasks = conn.execute(DatabasePool.format_sql('''
                SELECT COUNT(*) as c
                FROM tasks t
                JOIN project_stages s ON s.id = t.stage_id
                WHERE s.project_id = ? AND t.is_completed = ?
            '''), (project_id, True)).fetchone()['c'] or 0

            # 2) 接口完成度
            iface_total = conn.execute(
                DatabasePool.format_sql('SELECT COUNT(*) as c FROM interfaces WHERE project_id = ?'),
                (project_id,)
            ).fetchone()['c'] or 0
            iface_done = conn.execute(
                DatabasePool.format_sql("SELECT COUNT(*) as c FROM interfaces WHERE project_id = ? AND status = '已完成'"),
                (project_id,)
            ).fetchone()['c'] or 0

            # 3) 问题状态
            open_issues = conn.execute(
                DatabasePool.format_sql("SELECT severity FROM issues WHERE project_id = ? AND status != '已解决'"),
                (project_id,)
            ).fetchall()
            open_issue_count = len(open_issues)
            high_issue_count = sum(1 for i in open_issues if i.get('severity') == '高')

            # 4) 培训与文档
            training_logs = conn.execute(DatabasePool.format_sql('''
                SELECT COUNT(*) as c
                FROM work_logs
                WHERE project_id = ?
                  AND (work_content LIKE '%培训%' OR work_content LIKE '%training%')
            '''), (project_id,)).fetchone()['c'] or 0
            doc_count = conn.execute(
                DatabasePool.format_sql('SELECT COUNT(*) as c FROM project_documents WHERE project_id = ?'),
                (project_id,)
            ).fetchone()['c'] or 0

            # 5) 床位/手术间完成度
            bed_total = conn.execute(
                DatabasePool.format_sql('SELECT COUNT(*) as c FROM bed_units WHERE project_id = ?'),
                (project_id,)
            ).fetchone()['c'] or 0
            bed_done = conn.execute(
                DatabasePool.format_sql("SELECT COUNT(*) as c FROM bed_units WHERE project_id = ? AND status = '已验收'"),
                (project_id,)
            ).fetchone()['c'] or 0

            # 6) 设备采集异常
            abnormal_device_count = conn.execute(DatabasePool.format_sql('''
                SELECT COUNT(*) as c
                FROM bed_unit_devices d
                JOIN bed_units b ON b.id = d.bed_unit_id
                WHERE b.project_id = ?
                  AND d.data_status IN ('未对接', '已对接待验证', '数据异常')
            '''), (project_id,)).fetchone()['c'] or 0

        checklist = []
        score = 0

        task_rate = round((done_tasks / total_tasks) * 100, 2) if total_tasks > 0 else 0
        checklist.append({
            'item': '任务完成率',
            'status': '✅' if task_rate >= 95 else ('⚠️' if task_rate >= 80 else '❌'),
            'detail': f'{done_tasks}/{total_tasks} ({task_rate:.0f}%)'
        })
        score += 20 if task_rate >= 95 else (12 if task_rate >= 80 else 0)

        iface_rate = round((iface_done / iface_total) * 100, 2) if iface_total > 0 else 100
        checklist.append({
            'item': '接口对接完成率',
            'status': '✅' if iface_rate >= 95 else ('⚠️' if iface_rate >= 80 else '❌'),
            'detail': f'{iface_done}/{iface_total} ({iface_rate:.0f}%)'
        })
        score += 20 if iface_rate >= 95 else (12 if iface_rate >= 80 else 0)

        checklist.append({
            'item': '问题清零',
            'status': '✅' if open_issue_count == 0 else ('⚠️' if high_issue_count == 0 else '❌'),
            'detail': f'未解决 {open_issue_count} 个（高危 {high_issue_count} 个）'
        })
        score += 20 if open_issue_count == 0 else (8 if high_issue_count == 0 else 0)

        bed_rate = round((bed_done / bed_total) * 100, 2) if bed_total > 0 else 0
        checklist.append({
            'item': '床位/手术间验收率',
            'status': '✅' if bed_rate >= 95 else ('⚠️' if bed_rate >= 80 else '❌'),
            'detail': f'{bed_done}/{bed_total} ({bed_rate:.0f}%)'
        })
        score += 20 if bed_rate >= 95 else (12 if bed_rate >= 80 else 0)

        checklist.append({
            'item': '设备采集健康度',
            'status': '✅' if abnormal_device_count == 0 else ('⚠️' if abnormal_device_count <= 3 else '❌'),
            'detail': f'异常/未稳定采集设备 {abnormal_device_count} 台'
        })
        score += 10 if abnormal_device_count == 0 else (5 if abnormal_device_count <= 3 else 0)

        checklist.append({
            'item': '培训与文档',
            'status': '✅' if (training_logs >= 2 and doc_count >= 3) else ('⚠️' if (training_logs >= 1 and doc_count >= 1) else '❌'),
            'detail': f'培训 {training_logs} 次，文档 {doc_count} 份'
        })
        score += 10 if (training_logs >= 2 and doc_count >= 3) else (5 if (training_logs >= 1 and doc_count >= 1) else 0)

        readiness = min(max(int(round(score)), 0), 100)
        return {
            'project': project,
            'readiness_score': readiness,
            'can_accept': readiness >= 80,
            'summary': f"验收准备度 {readiness}%"
                       + ("，建议进入验收流程" if readiness >= 80 else "，仍有关键阻塞项"),
            'metrics': {
                'task_rate': task_rate,
                'interface_rate': iface_rate,
                'open_issue_count': open_issue_count,
                'high_issue_count': high_issue_count,
                'bed_acceptance_rate': bed_rate,
                'abnormal_device_count': abnormal_device_count,
                'training_logs': training_logs,
                'doc_count': doc_count
            },
            'checklist': checklist
        }

    def get_issue_pattern_clusters(self, days: int = 30, min_count: int = 2) -> Dict[str, Any]:
        """跨项目问题模式识别：对近N天未解决问题做轻量聚类。"""
        days = max(1, min(int(days or 30), 180))
        min_count = max(1, min(int(min_count or 2), 20))
        cutoff = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')

        with DatabasePool.get_connection() as conn:
            rows = conn.execute(DatabasePool.format_sql('''
                SELECT i.id, i.project_id, i.description, i.severity, i.status, i.created_at, p.project_name
                FROM issues i
                JOIN projects p ON p.id = i.project_id
                WHERE i.created_at >= ?
                  AND i.status != '已解决'
                ORDER BY i.created_at DESC
            '''), (cutoff,)).fetchall()

        stop_words = {'问题', '异常', '失败', '系统', '接口', '项目', '出现', '无法', '进行', '需要', '已经', '相关', '以及'}
        clusters = {}
        for row in rows:
            issue = dict(row)
            text = str(issue.get('description') or '')
            tokens = re.findall(r'[\u4e00-\u9fa5A-Za-z0-9]{2,}', text)
            tokens = [t for t in tokens if t not in stop_words]
            if not tokens:
                key = '其他'
            else:
                # 使用最长词作为简易主题键
                key = sorted(tokens, key=lambda x: len(x), reverse=True)[0][:20]
            cluster = clusters.setdefault(key, {
                'pattern': key,
                'count': 0,
                'high_severity_count': 0,
                'projects': set(),
                'samples': []
            })
            cluster['count'] += 1
            if issue.get('severity') == '高':
                cluster['high_severity_count'] += 1
            cluster['projects'].add(issue.get('project_name'))
            if len(cluster['samples']) < 3:
                cluster['samples'].append({
                    'issue_id': issue.get('id'),
                    'project_name': issue.get('project_name'),
                    'description': text[:120]
                })

        cluster_list = []
        for _, cluster in clusters.items():
            if cluster['count'] < min_count:
                continue
            cluster_list.append({
                'pattern': cluster['pattern'],
                'count': cluster['count'],
                'high_severity_count': cluster['high_severity_count'],
                'project_count': len(cluster['projects']),
                'projects': sorted(list(cluster['projects']))[:10],
                'samples': cluster['samples']
            })
        cluster_list.sort(key=lambda x: (-(x.get('count') or 0), -(x.get('high_severity_count') or 0), x.get('pattern') or ''))

        return {
            'period_days': days,
            'total_open_issues': len(rows),
            'cluster_count': len(cluster_list),
            'clusters': cluster_list[:20]
        }

    def get_device_failure_patterns(self, days: int = 30) -> Dict[str, Any]:
        """设备对接模式识别：统计品牌/型号与设备类型的异常率。"""
        days = max(1, min(int(days or 30), 180))
        cutoff = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')

        with DatabasePool.get_connection() as conn:
            rows = conn.execute(DatabasePool.format_sql('''
                SELECT
                    d.id,
                    d.device_type,
                    d.brand_model,
                    d.data_status,
                    d.last_data_at,
                    b.project_id,
                    p.project_name
                FROM bed_unit_devices d
                JOIN bed_units b ON b.id = d.bed_unit_id
                JOIN projects p ON p.id = b.project_id
                WHERE d.created_at >= ?
            '''), (cutoff,)).fetchall()

        abnormal_status = {'未对接', '已对接待验证', '数据异常'}
        by_brand = {}
        by_type = {}

        for row in rows:
            item = dict(row)
            brand = (item.get('brand_model') or '未知型号').strip()
            dtype = (item.get('device_type') or '未知设备').strip()
            is_abnormal = (item.get('data_status') in abnormal_status)

            b = by_brand.setdefault(brand, {'brand_model': brand, 'total': 0, 'abnormal': 0, 'projects': set()})
            b['total'] += 1
            b['abnormal'] += 1 if is_abnormal else 0
            b['projects'].add(item.get('project_name'))

            t = by_type.setdefault(dtype, {'device_type': dtype, 'total': 0, 'abnormal': 0})
            t['total'] += 1
            t['abnormal'] += 1 if is_abnormal else 0

        brand_list = []
        for _, v in by_brand.items():
            total = v['total'] or 0
            abnormal = v['abnormal'] or 0
            rate = round((abnormal / total) * 100, 2) if total > 0 else 0
            brand_list.append({
                'brand_model': v['brand_model'],
                'total': total,
                'abnormal': abnormal,
                'abnormal_rate': rate,
                'project_count': len(v['projects']),
                'projects': sorted(list(v['projects']))[:10]
            })
        brand_list.sort(key=lambda x: (-(x.get('abnormal_rate') or 0), -(x.get('abnormal') or 0), x.get('brand_model') or ''))

        type_list = []
        for _, v in by_type.items():
            total = v['total'] or 0
            abnormal = v['abnormal'] or 0
            rate = round((abnormal / total) * 100, 2) if total > 0 else 0
            type_list.append({
                'device_type': v['device_type'],
                'total': total,
                'abnormal': abnormal,
                'abnormal_rate': rate
            })
        type_list.sort(key=lambda x: (-(x.get('abnormal_rate') or 0), -(x.get('abnormal') or 0), x.get('device_type') or ''))

        return {
            'period_days': days,
            'total_devices': len(rows),
            'brand_patterns': brand_list[:20],
            'type_patterns': type_list[:20]
        }

    def get_schedule_advice(self, project_id: int) -> Dict[str, Any]:
        """智能排期建议：基于床位交付速度估算剩余工期。"""
        with DatabasePool.get_connection() as conn:
            project = conn.execute(DatabasePool.format_sql('''
                SELECT id, project_name, hospital_name, plan_start_date, plan_end_date, actual_start_date, status
                FROM projects
                WHERE id = ?
            '''), (project_id,)).fetchone()
            if not project:
                return {'error': '项目不存在'}
            project = dict(project)

            units = conn.execute(DatabasePool.format_sql('''
                SELECT id, unit_type, status, acceptance_date, created_at
                FROM bed_units
                WHERE project_id = ?
                ORDER BY id ASC
            '''), (project_id,)).fetchall()
            units = [dict(r) for r in units]

            # 全局历史基线（已验收的床位/手术间）
            global_units = conn.execute(DatabasePool.format_sql('''
                SELECT unit_type, acceptance_date, created_at
                FROM bed_units
                WHERE status = '已验收' AND acceptance_date IS NOT NULL
            ''')).fetchall()
            global_units = [dict(r) for r in global_units]

        from datetime import datetime, timedelta

        def parse_date(v):
            s = str(v or '')[:10]
            if not s:
                return None
            try:
                return datetime.strptime(s, '%Y-%m-%d').date()
            except Exception:
                return None

        total_units = len(units)
        accepted_units = sum(1 for u in units if u.get('status') == '已验收')
        remaining_units = max(total_units - accepted_units, 0)

        # 项目内日均交付速度（从实际/计划开始日期到今天）
        today = datetime.now().date()
        start_date = parse_date(project.get('actual_start_date')) or parse_date(project.get('plan_start_date')) or today
        elapsed_days = max((today - start_date).days, 1)
        current_velocity = accepted_units / elapsed_days

        # 全局平均每单元耗时（created_at -> acceptance_date）
        baseline_by_type = {}
        for item in global_units:
            unit_type = item.get('unit_type') or '未知类型'
            created = parse_date(item.get('created_at'))
            accepted = parse_date(item.get('acceptance_date'))
            if not created or not accepted:
                continue
            days = max((accepted - created).days, 1)
            baseline_by_type.setdefault(unit_type, []).append(days)

        type_avg_days = {
            k: round(sum(v) / len(v), 2) for k, v in baseline_by_type.items() if v
        }
        global_avg_days = round(sum(type_avg_days.values()) / len(type_avg_days), 2) if type_avg_days else 1.5

        # 按类型计算剩余工期
        remaining_by_type = {}
        for u in units:
            if u.get('status') == '已验收':
                continue
            t = u.get('unit_type') or '未知类型'
            remaining_by_type[t] = remaining_by_type.get(t, 0) + 1

        estimated_days_by_baseline = 0.0
        for t, cnt in remaining_by_type.items():
            avg_days = type_avg_days.get(t, global_avg_days)
            # 历史单元耗时折算为团队并行效率，乘0.6系数
            estimated_days_by_baseline += cnt * avg_days * 0.6

        # 当前速度模型
        estimated_days_by_velocity = (remaining_units / current_velocity) if current_velocity > 0 else (remaining_units * global_avg_days * 0.6)

        # 综合建议（偏保守取较大值）
        estimated_days = int(round(max(estimated_days_by_baseline, estimated_days_by_velocity)))
        estimated_days = max(estimated_days, 0)
        expected_finish = today + timedelta(days=estimated_days)

        plan_end = parse_date(project.get('plan_end_date'))
        will_delay = bool(plan_end and expected_finish > plan_end)
        delay_days = (expected_finish - plan_end).days if will_delay and plan_end else 0

        suggestions = []
        if will_delay:
            suggestions.append(f"预计将晚于计划 {delay_days} 天，建议立即增派资源或拆分并行联调。")
        if current_velocity < 0.3 and remaining_units > 0:
            suggestions.append("当前交付速度偏慢（<0.3 单元/天），建议按病区/手术间批次并行推进。")
        if not suggestions:
            suggestions.append("当前节奏可控，建议保持每日验收节拍并优先清理设备异常单元。")

        return {
            'project_id': project_id,
            'project_name': project.get('project_name'),
            'hospital_name': project.get('hospital_name'),
            'total_units': total_units,
            'accepted_units': accepted_units,
            'remaining_units': remaining_units,
            'current_velocity_units_per_day': round(current_velocity, 3),
            'estimated_days_remaining': estimated_days,
            'expected_finish_date': expected_finish.strftime('%Y-%m-%d'),
            'plan_end_date': project.get('plan_end_date'),
            'will_delay': will_delay,
            'delay_days': delay_days,
            'remaining_by_type': remaining_by_type,
            'baseline_avg_days_by_type': type_avg_days,
            'suggestions': suggestions
        }

    def get_weekly_exec_digest(self, days: int = 7) -> Dict[str, Any]:
        """周经营摘要：项目进展、预警、沉默人员、预计回款。"""
        days = max(1, min(int(days or 7), 30))
        cutoff = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
        today = datetime.now().strftime('%Y-%m-%d')
        week_end = (datetime.now() + timedelta(days=7)).strftime('%Y-%m-%d')

        from services.warning_service import warning_service
        from services.member_service import member_service

        with DatabasePool.get_connection() as conn:
            # 本周有任务完成的项目 => 视为有进展
            progressed_rows = conn.execute(DatabasePool.format_sql('''
                SELECT p.id as project_id, p.project_name, COUNT(t.id) as completed_count
                FROM tasks t
                JOIN project_stages s ON s.id = t.stage_id
                JOIN projects p ON p.id = s.project_id
                WHERE t.is_completed = ?
                  AND t.completed_date >= ?
                GROUP BY p.id, p.project_name
                ORDER BY completed_count DESC, p.project_name ASC
            '''), (True, cutoff)).fetchall()
            progressed_projects = [dict(r) for r in progressed_rows]

            # 本周预计回款（已经待收款且计划日在未来7天内）
            receivable_rows = conn.execute(DatabasePool.format_sql('''
                SELECT cpm.id, cpm.project_id, p.project_name, cpm.milestone_name, cpm.plan_amount, cpm.actual_amount, cpm.plan_date
                FROM contract_payment_milestones cpm
                JOIN projects p ON p.id = cpm.project_id
                WHERE cpm.status = '待收款'
                  AND cpm.plan_date >= ?
                  AND cpm.plan_date <= ?
                ORDER BY cpm.plan_date ASC
            '''), (today, week_end)).fetchall()
            receivables = []
            for r in receivable_rows:
                item = dict(r)
                plan_amount = float(item.get('plan_amount') or 0)
                actual_amount = float(item.get('actual_amount') or 0)
                item['unreceived_amount'] = round(max(plan_amount - actual_amount, 0), 2)
                receivables.append(item)

        warning_data = warning_service.get_warning_summary()
        warnings = warning_data.get('warnings', []) or []
        high_warnings = [w for w in warnings if w.get('severity') == 'high']

        people_board = member_service.get_people_project_board(current_user=None, silent_days=3)
        silent_people = [p for p in people_board if p.get('is_silent')]

        summary = {
            'progressed_project_count': len(progressed_projects),
            'high_warning_count': len(high_warnings),
            'silent_people_count': len(silent_people),
            'expected_receivable_count': len(receivables),
            'expected_receivable_amount': round(sum(float(x.get('unreceived_amount') or 0) for x in receivables), 2),
            'period_days': days
        }

        brief_lines = [
            f"上周有进展项目 {summary['progressed_project_count']} 个",
            f"高优预警 {summary['high_warning_count']} 条",
            f"超过3天未更新人员 {summary['silent_people_count']} 人",
            f"未来7天预计回款 {summary['expected_receivable_amount']} 元（{summary['expected_receivable_count']} 个节点）"
        ]

        return {
            'summary': summary,
            'briefing': "；".join(brief_lines) + "。",
            'progressed_projects': progressed_projects[:20],
            'high_warnings': high_warnings[:20],
            'silent_people': silent_people[:20],
            'expected_receivables': receivables[:20]
        }


    def calculate_project_hash(self, project_id: int) -> str:
        """计算单个项目数据的哈希值"""
        with DatabasePool.get_connection() as conn:
            data = []
            # 项目基本信息
            sql_p = DatabasePool.format_sql('SELECT * FROM projects WHERE id = ?')
            p = conn.execute(sql_p, (project_id,)).fetchone()
            if p: data.append(str(dict(p)))
            # 阶段信息
            sql_st = DatabasePool.format_sql('SELECT * FROM project_stages WHERE project_id = ?')
            stages = conn.execute(sql_st, (project_id,)).fetchall()
            data.append(str([dict(s) for s in stages]))
            # 任务信息
            sql_ts = DatabasePool.format_sql('SELECT * FROM tasks t JOIN project_stages s ON t.stage_id = s.id WHERE s.project_id = ?')
            tasks = conn.execute(sql_ts, (project_id,)).fetchall()
            data.append(str([dict(t) for t in tasks]))
            
            return hashlib.md5("".join(data).encode('utf-8')).hexdigest()

    def calculate_all_projects_hash(self) -> str:
        """计算所有活跃项目的数据哈希值"""
        with DatabasePool.get_connection() as conn:
            projects = conn.execute(DatabasePool.format_sql("SELECT id FROM projects WHERE status NOT IN ('已完成', '已终止', '已验收', '质保期')")).fetchall()
            combined_hash = "".join([self.calculate_project_hash(p['id']) for p in projects])
            return hashlib.md5(combined_hash.encode('utf-8')).hexdigest()

    def get_cached_report(self, project_id: int, report_type: str) -> str:
        """获取缓存的报告"""
        with DatabasePool.get_connection() as conn:
            current_hash = self.calculate_project_hash(project_id) if project_id else self.calculate_all_projects_hash()
            
            sql = DatabasePool.format_sql('SELECT content, created_at FROM report_cache WHERE project_id = ? AND report_type = ? AND data_hash = ? ORDER BY created_at DESC LIMIT 1')
            row = conn.execute(sql, (project_id or 0, report_type, current_hash)).fetchone()
            
            return dict(row) if row else None

    def save_report_cache(self, project_id: int, report_type: str, content: str, data_hash: str):
        """保存报告缓存"""
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('''
                INSERT INTO report_cache (project_id, report_type, content, data_hash, created_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT (project_id, report_type) DO UPDATE SET
                    content = EXCLUDED.content,
                    data_hash = EXCLUDED.data_hash,
                    created_at = EXCLUDED.created_at
            ''')
            conn.execute(sql, (project_id, report_type, content, data_hash))
            conn.commit()

    def get_stage_baselines(self):
        """
        统计全系统各阶段的平均耗时 (基准工期库)
        """
        with DatabasePool.get_connection() as conn:
            if DatabasePool.is_postgres():
                sql = '''
                    SELECT stage_name, 
                           AVG(actual_end_date - actual_start_date) as avg_days,
                           COUNT(*) as sample_count
                    FROM project_stages
                    WHERE actual_start_date IS NOT NULL AND actual_end_date IS NOT NULL
                    GROUP BY stage_name
                    HAVING COUNT(*) >= 1
                    ORDER BY avg_days ASC
                '''
                return [dict(row) for row in conn.execute(DatabasePool.format_sql(sql)).fetchall()]
            else:
                rows = conn.execute(DatabasePool.format_sql('''
                    SELECT stage_name, actual_start_date, actual_end_date
                    FROM project_stages
                    WHERE actual_start_date IS NOT NULL AND actual_end_date IS NOT NULL
                    ORDER BY stage_name
                ''')).fetchall()
                grouped = {}
                for row in rows:
                    record = dict(row)
                    start_dt = datetime.strptime(str(record['actual_start_date'])[:10], '%Y-%m-%d')
                    end_dt = datetime.strptime(str(record['actual_end_date'])[:10], '%Y-%m-%d')
                    grouped.setdefault(record['stage_name'], []).append((end_dt - start_dt).days)

                result = []
                for stage_name, durations in grouped.items():
                    if not durations:
                        continue
                    result.append({
                        'stage_name': stage_name,
                        'avg_days': sum(durations) / len(durations),
                        'sample_count': len(durations),
                    })
                result.sort(key=lambda item: item['avg_days'])
                return result

# 全局实例
analytics_service = AnalyticsService()
