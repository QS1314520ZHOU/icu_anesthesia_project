"""
智能预警服务
检测项目中需要关注的风险点并生成预警
"""
from datetime import datetime, timedelta
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'database.db')

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def check_milestone_warnings():
    """检查里程碑逾期预警（提前3/7天）"""
    conn = get_db()
    cursor = conn.cursor()
    today = datetime.now().date()
    warnings = []
    
    # 查找未完成且即将到期的里程碑
    cursor.execute('''
        SELECT m.id, m.name, m.target_date, m.project_id, p.project_name
        FROM milestones m
        JOIN projects p ON m.project_id = p.id
        WHERE m.is_completed = 0 
          AND p.status NOT IN ('已完成', '已终止')
        ORDER BY m.target_date ASC
    ''')
    
    for row in cursor.fetchall():
        try:
            if not row['target_date'] or not row['target_date'].strip():
                continue
            target = datetime.strptime(row['target_date'].strip(), '%Y-%m-%d').date()
        except (ValueError, AttributeError):
            continue
        days_until = (target - today).days
        
        if days_until < 0:
            # 已逾期
            warnings.append({
                'type': 'milestone_overdue',
                'severity': 'high',
                'project_id': row['project_id'],
                'project_name': row['project_name'],
                'milestone_id': row['id'],
                'milestone_name': row['name'],
                'target_date': row['target_date'],
                'days_overdue': -days_until,
                'message': f"里程碑「{row['name']}」已逾期 {-days_until} 天"
            })
        elif days_until <= 3:
            # 3天内到期
            warnings.append({
                'type': 'milestone_due_soon',
                'severity': 'high',
                'project_id': row['project_id'],
                'project_name': row['project_name'],
                'milestone_id': row['id'],
                'milestone_name': row['name'],
                'target_date': row['target_date'],
                'days_until': days_until,
                'message': f"里程碑「{row['name']}」将在 {days_until} 天后到期"
            })
        elif days_until <= 7:
            # 7天内到期
            warnings.append({
                'type': 'milestone_due_soon',
                'severity': 'medium',
                'project_id': row['project_id'],
                'project_name': row['project_name'],
                'milestone_id': row['id'],
                'milestone_name': row['name'],
                'target_date': row['target_date'],
                'days_until': days_until,
                'message': f"里程碑「{row['name']}」将在 {days_until} 天后到期"
            })
    
    conn.close()
    return warnings

def check_task_stagnation():
    """检查任务停滞预警（7天无更新） - 暂时禁用，需添加updated_at字段"""
    return []

    # conn = get_db()
    # cursor = conn.cursor()
    # ... (original code commented out) ...

def check_interface_timeout():
    """检查接口对接超时预警"""
    conn = get_db()
    cursor = conn.cursor()
    today = datetime.now().date()
    warnings = []
    
    # 查找未完成且可能超时的接口
    cursor.execute('''
        SELECT i.id, i.interface_name as name, i.status, i.plan_date, i.project_id, p.project_name
        FROM interfaces i
        JOIN projects p ON i.project_id = p.id
        WHERE i.status NOT IN ('已完成', '已取消')
          AND p.status NOT IN ('已完成', '已终止')
          AND i.plan_date IS NOT NULL
    ''')
    
    for row in cursor.fetchall():
        try:
            plan_date = datetime.strptime(row['plan_date'], '%Y-%m-%d').date()
            days_overdue = (today - plan_date).days
            
            if days_overdue > 0:
                warnings.append({
                    'type': 'interface_timeout',
                    'severity': 'medium' if days_overdue < 7 else 'high',
                    'project_id': row['project_id'],
                    'project_name': row['project_name'],
                    'interface_id': row['id'],
                    'interface_name': row['name'],
                    'plan_date': row['plan_date'],
                    'days_overdue': days_overdue,
                    'message': f"接口「{row['name']}」已超期 {days_overdue} 天"
                })
        except:
            pass
    
    conn.close()
    return warnings

def get_all_warnings():
    """获取所有类型的预警"""
    all_warnings = []
    all_warnings.extend(check_milestone_warnings())
    all_warnings.extend(check_task_stagnation())
    all_warnings.extend(check_interface_timeout())
    
    # 按严重程度和项目排序
    severity_order = {'high': 0, 'medium': 1, 'low': 2}
    all_warnings.sort(key=lambda x: (severity_order.get(x['severity'], 2), x['project_name']))
    
    return all_warnings

def get_warning_summary():
    """获取预警汇总"""
    warnings = get_all_warnings()
    
    summary = {
        'total': len(warnings),
        'high': sum(1 for w in warnings if w['severity'] == 'high'),
        'medium': sum(1 for w in warnings if w['severity'] == 'medium'),
        'low': sum(1 for w in warnings if w['severity'] == 'low'),
        'by_type': {
            'milestone_overdue': sum(1 for w in warnings if w['type'] == 'milestone_overdue'),
            'milestone_due_soon': sum(1 for w in warnings if w['type'] == 'milestone_due_soon'),
            'task_stagnation': sum(1 for w in warnings if w['type'] == 'task_stagnation'),
            'interface_timeout': sum(1 for w in warnings if w['type'] == 'interface_timeout')
        }
    }
    
    return {
        'summary': summary,
        'warnings': warnings
    }

# 单例服务
warning_service = type('WarningService', (), {
    'get_all_warnings': staticmethod(get_all_warnings),
    'get_warning_summary': staticmethod(get_warning_summary),
    'check_milestone_warnings': staticmethod(check_milestone_warnings),
    'check_task_stagnation': staticmethod(check_task_stagnation),
    'check_interface_timeout': staticmethod(check_interface_timeout)
})()
