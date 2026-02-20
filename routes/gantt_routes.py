from flask import Blueprint, jsonify, request
from database import DatabasePool
from datetime import datetime, timedelta

gantt_bp = Blueprint('gantt', __name__)

@gantt_bp.route('/api/projects/<int:project_id>/gantt-data', methods=['GET'])
def get_gantt_data(project_id):
    """
    获取项目的甘特图数据
    Frappe Gantt 格式: { id, name, start, end, progress, dependencies }
    """
    try:
        with DatabasePool.get_connection() as conn:
            # 1. 获取所有阶段及其日期
            stages = conn.execute('''
                SELECT id, stage_name, plan_start_date, plan_end_date, progress, stage_order
                FROM project_stages
                WHERE project_id = ?
                ORDER BY stage_order
            ''', (project_id,)).fetchall()
            
            # 2. 获取所有任务及其依赖
            tasks = conn.execute('''
                SELECT t.id, t.task_name, t.stage_id, t.is_completed, t.completed_date
                FROM tasks t
                JOIN project_stages s ON t.stage_id = s.id
                WHERE s.project_id = ?
            ''', (project_id,)).fetchall()
            
            # 3. 获取依赖关系
            deps = conn.execute('''
                SELECT td.task_id, td.depends_on_task_id
                FROM task_dependencies td
                JOIN tasks t ON td.task_id = t.id
                JOIN project_stages s ON t.stage_id = s.id
                WHERE s.project_id = ?
            ''', (project_id,)).fetchall()

        # 整理数据
        # Frappe Gantt 需要 YYYY-MM-DD
        gantt_tasks = []
        
        # 建立阶段查找表
        stage_map = {s['id']: dict(s) for s in stages}
        
        # 建立任务依赖映射
        task_deps = {}
        for d in deps:
            tid = str(d['task_id'])
            if tid not in task_deps:
                task_deps[tid] = []
            task_deps[tid].append(str(d['depends_on_task_id']))
            
        for t in tasks:
            sid = t['stage_id']
            stage = stage_map.get(sid)
            if not stage: continue
            
            # 如果阶段没有设置日期，设置默认日期（今天开始，持续3天）
            start = stage['plan_start_date'] or datetime.now().strftime('%Y-%m-%d')
            end = stage['plan_end_date'] or (datetime.now() + timedelta(days=3)).strftime('%Y-%m-%d')
            
            # 进度：已完成为 100，未完成为 0（或者使用阶段的进度，但任务粒度更细）
            progress = 100 if t['is_completed'] else 0
            
            gantt_tasks.append({
                'id': str(t['id']),
                'name': t['task_name'],
                'start': start,
                'end': end,
                'progress': progress,
                'dependencies': ",".join(task_deps.get(str(t['id']), [])),
                'custom_class': f'stage-{stage["stage_order"] % 5}' # 简单的颜色区分
            })
            
        return jsonify(gantt_tasks)
        
    except Exception as e:
        print(f"Gantt Data Error: {e}")
        return jsonify({'error': str(e)}), 500
