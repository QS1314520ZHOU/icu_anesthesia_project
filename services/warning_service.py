"""
智能预警服务
检测项目中需要关注的风险点并生成预警
"""
from datetime import datetime, timedelta
from database import DatabasePool

def _load_dismissed_keys():
    with DatabasePool.get_connection() as conn:
        rows = conn.execute(
            DatabasePool.format_sql("SELECT warning_key FROM warning_dismissals")
        ).fetchall()
    return set(row['warning_key'] for row in rows if row.get('warning_key'))

def check_milestone_warnings():
    """检查里程碑逾期预警（提前3/7天）"""
    today = datetime.now().date()
    warnings = []
    dismissed_keys = _load_dismissed_keys()
    
    with DatabasePool.get_connection() as conn:
        rows = conn.execute(DatabasePool.format_sql('''
            SELECT m.id, m.name, m.target_date, m.project_id, p.project_name
            FROM milestones m
            JOIN projects p ON m.project_id = p.id
            WHERE m.is_completed = ? 
              AND p.status NOT IN ('已完成', '已终止', '已验收', '质保期')
            ORDER BY m.target_date ASC
        '''), (False,))

    for row in rows.fetchall():
        try:
            target_str = str(row['target_date']).strip()[:10] if row.get('target_date') else ""
            if not target_str:
                continue
            target = datetime.strptime(target_str, '%Y-%m-%d').date()
        except (ValueError, AttributeError):
            continue
        days_until = (target - today).days
        
        if days_until < 0:
            # 已逾期
            warning_key = f"milestone_overdue:{row['id']}"
            if warning_key in dismissed_keys:
                continue
            warnings.append({
                'type': 'milestone_overdue',
                'warning_key': warning_key,
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
            warning_key = f"milestone_due_soon:{row['id']}"
            if warning_key in dismissed_keys:
                continue
            warnings.append({
                'type': 'milestone_due_soon',
                'warning_key': warning_key,
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
            warning_key = f"milestone_due_soon:{row['id']}"
            if warning_key in dismissed_keys:
                continue
            warnings.append({
                'type': 'milestone_due_soon',
                'warning_key': warning_key,
                'severity': 'medium',
                'project_id': row['project_id'],
                'project_name': row['project_name'],
                'milestone_id': row['id'],
                'milestone_name': row['name'],
                'target_date': row['target_date'],
                'days_until': days_until,
                'message': f"里程碑「{row['name']}」将在 {days_until} 天后到期"
            })
    
    return warnings

def check_task_stagnation():
    """检查任务停滞预警（7天无更新）"""
    today = datetime.now().date()
    warnings = []
    cutoff = (today - timedelta(days=7)).strftime('%Y-%m-%d')
    with DatabasePool.get_connection() as conn:
        rows = conn.execute(DatabasePool.format_sql('''
            SELECT t.id, t.task_name, t.updated_at, t.assigned_to, s.stage_name, s.project_id, p.project_name
            FROM tasks t
            JOIN project_stages s ON t.stage_id = s.id
            JOIN projects p ON s.project_id = p.id
            WHERE t.is_completed = ?
              AND t.updated_at IS NOT NULL
              AND DATE(t.updated_at) < ?
              AND p.status NOT IN ('已完成', '已终止', '已验收', '质保期')
            ORDER BY t.updated_at ASC
        '''), (False, cutoff)).fetchall()
        dismissed_keys = _load_dismissed_keys()

    for row in rows:
        warning_key = f"task_stagnation:{row['id']}"
        if warning_key in dismissed_keys:
            continue
        updated_str = str(row['updated_at'])[:10] if row.get('updated_at') else ''
        try:
            updated_date = datetime.strptime(updated_str, '%Y-%m-%d').date()
            days_stagnant = (today - updated_date).days
        except Exception:
            days_stagnant = 8
        warnings.append({
            'type': 'task_stagnation',
            'severity': 'high' if days_stagnant >= 14 else 'medium',
            'warning_key': warning_key,
            'project_id': row['project_id'],
            'project_name': row['project_name'],
            'task_id': row['id'],
            'task_name': row['task_name'],
            'stage_name': row['stage_name'],
            'assigned_to': row.get('assigned_to') or '',
            'days_stagnant': days_stagnant,
            'message': f"任务「{row['task_name']}」已 {days_stagnant} 天无更新"
        })
    return warnings

def check_interface_timeout():
    """检查接口对接超时预警"""
    today = datetime.now().date()
    warnings = []
    dismissed_keys = _load_dismissed_keys()
    
    with DatabasePool.get_connection() as conn:
        rows = conn.execute(DatabasePool.format_sql('''
            SELECT i.id, i.interface_name as name, i.status, i.plan_date, i.project_id, p.project_name
            FROM interfaces i
            JOIN projects p ON i.project_id = p.id
            WHERE i.status NOT IN ('已完成', '已取消')
              AND p.status NOT IN ('已完成', '已终止', '已验收', '质保期')
              AND i.plan_date IS NOT NULL
        '''))

    for row in rows.fetchall():
        try:
            plan_date = datetime.strptime(str(row['plan_date'])[:10], '%Y-%m-%d').date()
            days_overdue = (today - plan_date).days
            
            if days_overdue > 0:
                warning_key = f"interface_timeout:{row['id']}"
                if warning_key in dismissed_keys:
                    continue
                warnings.append({
                    'type': 'interface_timeout',
                    'warning_key': warning_key,
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
