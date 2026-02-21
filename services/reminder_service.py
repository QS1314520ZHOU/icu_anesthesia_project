# services/reminder_service.py
"""
智能提醒服务
提供逾期检测、长时间未处理问题检测、项目健康度评估等功能
"""

import sqlite3
from datetime import datetime, timedelta
from typing import List, Dict, Any
from database import get_db

class ReminderService:
    """智能提醒服务"""
    
    # 阈值配置
    OVERDUE_WARNING_DAYS = 3      # 即将逾期提醒天数
    STALE_ISSUE_DAYS = 7          # 问题多久未处理算过期
    IDLE_PROJECT_DAYS = 14        # 项目多久无更新算闲置
    
    def get_all_reminders(self) -> Dict[str, List[Dict]]:
        """获取所有类型的提醒"""
        return {
            "overdue_milestones": self.check_overdue_milestones(),
            "upcoming_deadlines": self.check_upcoming_deadlines(),
            "stale_issues": self.check_stale_issues(),
            "idle_projects": self.check_idle_projects(),
            "unread_notifications": self.get_unread_count(),
            "summary": self.get_daily_digest()
        }
    
    def check_overdue_milestones(self) -> List[Dict]:
        """检查已逾期的里程碑"""
        conn = get_db()
        today = datetime.now().strftime('%Y-%m-%d')
        
        milestones = conn.execute('''
            SELECT m.id, m.name, m.target_date, p.id as project_id, 
                   p.project_name, p.hospital_name
            FROM milestones m
            JOIN projects p ON m.project_id = p.id
            WHERE m.is_completed = 0 
              AND m.target_date < ?
              AND p.status NOT IN ('已完成', '已终止')
            ORDER BY m.target_date ASC
        ''', (today,)).fetchall()
        
        result = []
        for m in milestones:
            try:
                if not m['target_date'] or not str(m['target_date']).strip():
                    continue
                target_date_str = str(m['target_date']).strip().split(' ')[0]
                days_overdue = (datetime.now() - datetime.strptime(target_date_str, '%Y-%m-%d')).days

            except (ValueError, AttributeError):
                continue
            result.append({
                "id": m['id'],
                "name": m['name'],
                "target_date": m['target_date'],
                "project_id": m['project_id'],
                "project_name": m['project_name'],
                "hospital": m['hospital_name'],
                "days_overdue": days_overdue,
                "type": "overdue_milestone",
                "severity": "high"
            })
        return result
    
    def check_upcoming_deadlines(self, days: int = None) -> List[Dict]:
        """检查即将到期的里程碑和阶段"""
        if days is None:
            days = self.OVERDUE_WARNING_DAYS
            
        conn = get_db()
        today = datetime.now().strftime('%Y-%m-%d')
        deadline = (datetime.now() + timedelta(days=days)).strftime('%Y-%m-%d')
        
        # 即将到期的里程碑
        milestones = conn.execute('''
            SELECT m.id, m.name, m.target_date, p.id as project_id, 
                   p.project_name, p.hospital_name
            FROM milestones m
            JOIN projects p ON m.project_id = p.id
            WHERE m.is_completed = 0 
              AND m.target_date >= ? AND m.target_date <= ?
              AND p.status NOT IN ('已完成', '已终止')
            ORDER BY m.target_date ASC
        ''', (today, deadline)).fetchall()
        
        # 即将到期的阶段
        stages = conn.execute('''
            SELECT s.id, s.stage_name, s.plan_end_date, p.id as project_id,
                   p.project_name, p.hospital_name
            FROM project_stages s
            JOIN projects p ON s.project_id = p.id
            WHERE s.status != '已完成'
              AND s.plan_end_date >= ? AND s.plan_end_date <= ?
              AND p.status NOT IN ('已完成', '已终止')
            ORDER BY s.plan_end_date ASC
        ''', (today, deadline)).fetchall()
        
        result = []
        for m in milestones:
            try:
                if not m['target_date'] or not str(m['target_date']).strip():
                    continue
                target_date_str = str(m['target_date']).strip().split(' ')[0]
                days_remaining = (datetime.strptime(target_date_str, '%Y-%m-%d') - datetime.now()).days

            except (ValueError, AttributeError):
                continue
            result.append({
                "id": m['id'],
                "name": m['name'],
                "deadline": m['target_date'],
                "project_id": m['project_id'],
                "project_name": m['project_name'],
                "hospital": m['hospital_name'],
                "days_remaining": days_remaining,
                "type": "upcoming_milestone",
                "severity": "medium"
            })
        
        for s in stages:
            try:
                if not s['plan_end_date'] or not str(s['plan_end_date']).strip():
                    continue
                plan_end_date_str = str(s['plan_end_date']).strip().split(' ')[0]
                days_remaining = (datetime.strptime(plan_end_date_str, '%Y-%m-%d') - datetime.now()).days

            except (ValueError, AttributeError):
                continue
            result.append({
                "id": s['id'],
                "name": s['stage_name'],
                "deadline": s['plan_end_date'],
                "project_id": s['project_id'],
                "project_name": s['project_name'],
                "hospital": s['hospital_name'],
                "days_remaining": days_remaining,
                "type": "upcoming_stage",
                "severity": "medium"
            })
        
        return sorted(result, key=lambda x: x['deadline'])
    
    def check_stale_issues(self, days: int = None) -> List[Dict]:
        """检查长时间未处理的问题"""
        if days is None:
            days = self.STALE_ISSUE_DAYS
            
        conn = get_db()
        cutoff = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d %H:%M:%S')
        
        issues = conn.execute('''
            SELECT i.id, i.issue_type, i.description, i.severity, i.status,
                   i.created_at, p.id as project_id, p.project_name, p.hospital_name
            FROM issues i
            JOIN projects p ON i.project_id = p.id
            WHERE i.status != '已解决'
              AND i.created_at < ?
              AND p.status NOT IN ('已完成', '已终止')
            ORDER BY i.severity DESC, i.created_at ASC
        ''', (cutoff,)).fetchall()
        
        return [{
            "id": i['id'],
            "issue_type": i['issue_type'],
            "description": i['description'][:100] + ('...' if len(i['description']) > 100 else ''),
            "severity": i['severity'],
            "status": i['status'],
            "created_at": i['created_at'],
            "project_id": i['project_id'],
            "project_name": i['project_name'],
            "hospital": i['hospital_name'],
            "days_pending": (datetime.now() - datetime.strptime(str(i['created_at']).split(' ')[0], '%Y-%m-%d')).days,

            "type": "stale_issue",
            "priority": "high" if i['severity'] == '高' else "medium"
        } for i in issues]
    
    def check_idle_projects(self, days: int = None) -> List[Dict]:
        """检查长时间无更新的项目"""
        if days is None:
            days = self.IDLE_PROJECT_DAYS
            
        conn = get_db()
        cutoff = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
        
        # 查找最近没有工作日志的活跃项目
        projects = conn.execute('''
            SELECT p.id, p.project_name, p.hospital_name, p.status, p.progress,
                   p.project_manager, p.updated_at,
                   (SELECT MAX(log_date) FROM work_logs WHERE project_id = p.id) as last_log_date
            FROM projects p
            WHERE p.status IN ('进行中', '试运行')
            ORDER BY last_log_date ASC NULLS FIRST
        ''').fetchall()
        
        idle_projects = []
        for p in projects:
            last_activity = p['last_log_date'] or p['updated_at'][:10] if p['updated_at'] else None
            if last_activity and last_activity < cutoff:
                days_idle = (datetime.now() - datetime.strptime(str(last_activity).split(' ')[0], '%Y-%m-%d')).days

                idle_projects.append({
                    "id": p['id'],
                    "project_name": p['project_name'],
                    "hospital": p['hospital_name'],
                    "status": p['status'],
                    "progress": p['progress'],
                    "manager": p['project_manager'],
                    "last_activity": last_activity,
                    "days_idle": days_idle,
                    "type": "idle_project",
                    "severity": "high" if days_idle > 30 else "medium"
                })
        
        return idle_projects
    
    def get_unread_count(self) -> int:
        """获取未读通知数量"""
        conn = get_db()
        result = conn.execute('SELECT COUNT(*) as count FROM notifications WHERE is_read = 0').fetchone()
        return result['count'] if result else 0
    
    def get_daily_digest(self) -> Dict[str, Any]:
        """生成每日摘要"""
        overdue = self.check_overdue_milestones()
        upcoming = self.check_upcoming_deadlines()
        stale = self.check_stale_issues()
        idle = self.check_idle_projects()
        
        # 统计今日完成的任务
        conn = get_db()
        today = datetime.now().strftime('%Y-%m-%d')
        completed_today = conn.execute('''
            SELECT COUNT(*) as count FROM tasks 
            WHERE is_completed = 1 AND completed_date = ?
        ''', (today,)).fetchone()['count']
        
        # 活跃项目数
        active_projects = conn.execute('''
            SELECT COUNT(*) as count FROM projects 
            WHERE status IN ('进行中', '试运行')
        ''').fetchone()['count']
        
        return {
            "date": today,
            "active_projects": active_projects,
            "overdue_count": len(overdue),
            "upcoming_count": len(upcoming),
            "stale_issues_count": len(stale),
            "idle_projects_count": len(idle),
            "completed_today": completed_today,
            "health_score": self._calculate_overall_health(overdue, stale, idle),
            "top_priorities": self._get_top_priorities(overdue, upcoming, stale)
        }
    
    def _calculate_overall_health(self, overdue: List, stale: List, idle: List) -> int:
        """计算整体健康度分数 (0-100)"""
        score = 100
        
        # 逾期里程碑扣分
        score -= len(overdue) * 10
        
        # 未处理问题扣分
        high_severity_issues = len([i for i in stale if i.get('severity') == '高'])
        score -= high_severity_issues * 8
        score -= (len(stale) - high_severity_issues) * 3
        
        # 闲置项目扣分
        score -= len(idle) * 5
        
        return max(0, min(100, score))
    
    def _get_top_priorities(self, overdue: List, upcoming: List, stale: List, limit: int = 5) -> List[Dict]:
        """获取最重要的待处理事项"""
        priorities = []
        
        # 逾期最优先
        for item in overdue[:2]:
            priorities.append({
                "title": f"[逾期] {item['name']}",
                "project": item['project_name'],
                "days": f"逾期 {item['days_overdue']} 天",
                "action": "urgent"
            })
        
        # 高严重度问题
        high_issues = [i for i in stale if i.get('severity') == '高'][:2]
        for item in high_issues:
            priorities.append({
                "title": f"[问题] {item['issue_type']}",
                "project": item['project_name'],
                "days": f"待处理 {item['days_pending']} 天",
                "action": "high"
            })
        
        # 即将到期
        for item in upcoming[:2]:
            if len(priorities) < limit:
                priorities.append({
                    "title": f"[即将到期] {item['name']}",
                    "project": item['project_name'],
                    "days": f"剩余 {item['days_remaining']} 天",
                    "action": "medium"
                })
        
        return priorities[:limit]


# 全局实例
reminder_service = ReminderService()
