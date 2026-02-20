# services/dependency_service.py
"""
任务依赖关系管理服务
- 依赖关系CRUD
- 关键路径计算 (Critical Path Method)
- 影响分析：当某任务延误时，自动识别下游受影响任务
"""

import logging
from datetime import datetime, timedelta
from collections import defaultdict, deque
from database import get_db, close_db

logger = logging.getLogger(__name__)


class DependencyService:

    @staticmethod
    def get_dependencies(project_id):
        """获取项目所有任务依赖关系"""
        conn = get_db()
        deps = conn.execute('''
            SELECT td.id, td.task_id, td.depends_on_task_id, td.dependency_type,
                   t1.task_name as task_name, t2.task_name as depends_on_name,
                   s1.stage_name as task_stage, s2.stage_name as depends_on_stage,
                   t1.is_completed as task_completed, t2.is_completed as dep_completed
            FROM task_dependencies td
            JOIN tasks t1 ON td.task_id = t1.id
            JOIN tasks t2 ON td.depends_on_task_id = t2.id
            JOIN project_stages s1 ON t1.stage_id = s1.id
            JOIN project_stages s2 ON t2.stage_id = s2.id
            WHERE s1.project_id = ?
            ORDER BY s1.stage_order, t1.id
        ''', (project_id,)).fetchall()
        close_db()
        return [dict(d) for d in deps]

    @staticmethod
    def add_dependency(task_id, depends_on_task_id, dependency_type='finish_to_start'):
        """添加任务依赖关系（检测循环）"""
        if task_id == depends_on_task_id:
            return {'success': False, 'message': '任务不能依赖自身'}

        conn = get_db()

        # 检查是否已存在
        existing = conn.execute(
            'SELECT id FROM task_dependencies WHERE task_id = ? AND depends_on_task_id = ?',
            (task_id, depends_on_task_id)
        ).fetchone()
        if existing:
            close_db()
            return {'success': False, 'message': '该依赖关系已存在'}

        # 检测循环依赖
        if DependencyService._would_create_cycle(conn, task_id, depends_on_task_id):
            close_db()
            return {'success': False, 'message': '添加该依赖会导致循环依赖'}

        conn.execute('''
            INSERT INTO task_dependencies (task_id, depends_on_task_id, dependency_type)
            VALUES (?, ?, ?)
        ''', (task_id, depends_on_task_id, dependency_type))
        conn.commit()
        close_db()
        return {'success': True, 'message': '依赖关系已添加'}

    @staticmethod
    def remove_dependency(dep_id):
        """删除依赖关系"""
        conn = get_db()
        conn.execute('DELETE FROM task_dependencies WHERE id = ?', (dep_id,))
        conn.commit()
        close_db()
        return {'success': True}

    @staticmethod
    def _would_create_cycle(conn, task_id, depends_on_task_id):
        """检测添加依赖后是否会形成环"""
        # 从 depends_on_task_id 出发，看能否通过已有依赖回到 task_id
        # 等价于：task_id 的下游链条中是否包含 depends_on_task_id
        visited = set()
        queue = deque([task_id])
        while queue:
            current = queue.popleft()
            if current == depends_on_task_id:
                return True
            if current in visited:
                continue
            visited.add(current)
            # 查找 current 的下游任务（谁依赖 current）
            downstream = conn.execute(
                'SELECT task_id FROM task_dependencies WHERE depends_on_task_id = ?',
                (current,)
            ).fetchall()
            for row in downstream:
                queue.append(row['task_id'])
        return False

    @staticmethod
    def get_critical_path(project_id):
        """计算项目关键路径 (CPM)"""
        conn = get_db()

        # 获取所有任务
        tasks = conn.execute('''
            SELECT t.id, t.task_name, t.is_completed, t.completed_date,
                   s.stage_name, s.stage_order, s.plan_start_date, s.plan_end_date
            FROM tasks t
            JOIN project_stages s ON t.stage_id = s.id
            WHERE s.project_id = ?
            ORDER BY s.stage_order, t.id
        ''', (project_id,)).fetchall()

        # 获取依赖关系
        deps = conn.execute('''
            SELECT td.task_id, td.depends_on_task_id
            FROM task_dependencies td
            JOIN tasks t ON td.task_id = t.id
            JOIN project_stages s ON t.stage_id = s.id
            WHERE s.project_id = ?
        ''', (project_id,)).fetchall()
        close_db()

        if not tasks:
            return {'critical_path': [], 'all_tasks': [], 'summary': '暂无任务数据'}

        # 构建邻接表
        task_map = {}
        for t in tasks:
            task_map[t['id']] = {
                'id': t['id'],
                'name': t['task_name'],
                'stage': t['stage_name'],
                'stage_order': t['stage_order'],
                'completed': bool(t['is_completed']),
                'duration': 1,  # 默认每个任务 1 个单位时间
                'predecessors': [],
                'successors': [],
                'early_start': 0,
                'early_finish': 0,
                'late_start': float('inf'),
                'late_finish': float('inf'),
                'slack': 0,
                'is_critical': False
            }

        for d in deps:
            if d['task_id'] in task_map and d['depends_on_task_id'] in task_map:
                task_map[d['task_id']]['predecessors'].append(d['depends_on_task_id'])
                task_map[d['depends_on_task_id']]['successors'].append(d['task_id'])

        # 拓扑排序
        in_degree = defaultdict(int)
        for tid in task_map:
            in_degree[tid] = len(task_map[tid]['predecessors'])

        queue = deque([tid for tid in task_map if in_degree[tid] == 0])
        topo_order = []

        while queue:
            current = queue.popleft()
            topo_order.append(current)
            for successor in task_map[current]['successors']:
                in_degree[successor] -= 1
                if in_degree[successor] == 0:
                    queue.append(successor)

        if len(topo_order) != len(task_map):
            return {'critical_path': [], 'all_tasks': list(task_map.values()),
                    'summary': '存在循环依赖，无法计算关键路径'}

        # 正向传递：计算最早开始/完成时间
        for tid in topo_order:
            task = task_map[tid]
            if task['predecessors']:
                task['early_start'] = max(
                    task_map[p]['early_finish'] for p in task['predecessors']
                )
            task['early_finish'] = task['early_start'] + task['duration']

        # 项目总工期
        project_duration = max(task_map[tid]['early_finish'] for tid in task_map) if task_map else 0

        # 逆向传递：计算最晚开始/完成时间
        for tid in reversed(topo_order):
            task = task_map[tid]
            if not task['successors']:
                task['late_finish'] = project_duration
            else:
                task['late_finish'] = min(
                    task_map[s]['late_start'] for s in task['successors']
                )
            task['late_start'] = task['late_finish'] - task['duration']
            task['slack'] = task['late_start'] - task['early_start']
            task['is_critical'] = (task['slack'] == 0)

        # 提取关键路径
        critical_path = [task_map[tid] for tid in topo_order if task_map[tid]['is_critical']]
        all_tasks_result = [task_map[tid] for tid in topo_order]

        completed_critical = sum(1 for t in critical_path if t['completed'])
        summary = f"关键路径共 {len(critical_path)} 个任务，已完成 {completed_critical} 个，项目最短工期 {project_duration} 个任务单位"

        return {
            'critical_path': critical_path,
            'all_tasks': all_tasks_result,
            'project_duration': project_duration,
            'summary': summary
        }

    @staticmethod
    def get_impact_analysis(task_id):
        """分析某任务延迟对下游的影响"""
        conn = get_db()

        task = conn.execute('''
            SELECT t.id, t.task_name, s.stage_name, s.project_id
            FROM tasks t JOIN project_stages s ON t.stage_id = s.id
            WHERE t.id = ?
        ''', (task_id,)).fetchone()

        if not task:
            close_db()
            return {'affected': [], 'message': '任务不存在'}

        # BFS 找到所有下游任务
        affected = []
        visited = set()
        queue = deque([task_id])
        depth = 0

        while queue:
            level_size = len(queue)
            depth += 1
            for _ in range(level_size):
                current = queue.popleft()
                if current in visited:
                    continue
                visited.add(current)

                downstream = conn.execute('''
                    SELECT td.task_id, t.task_name, t.is_completed, s.stage_name
                    FROM task_dependencies td
                    JOIN tasks t ON td.task_id = t.id
                    JOIN project_stages s ON t.stage_id = s.id
                    WHERE td.depends_on_task_id = ?
                ''', (current,)).fetchall()

                for d in downstream:
                    if d['task_id'] not in visited:
                        affected.append({
                            'task_id': d['task_id'],
                            'task_name': d['task_name'],
                            'stage_name': d['stage_name'],
                            'is_completed': bool(d['is_completed']),
                            'impact_depth': depth
                        })
                        queue.append(d['task_id'])

        close_db()
        return {
            'source_task': dict(task),
            'affected': affected,
            'total_affected': len(affected),
            'message': f"任务「{task['task_name']}」延迟将影响 {len(affected)} 个下游任务"
        }

    @staticmethod
    def get_available_dependencies(task_id):
        """获取可作为依赖的任务列表（同项目、非自身、非已依赖、不会成环）"""
        conn = get_db()

        # 获取当前任务所属项目
        task = conn.execute('''
            SELECT t.id, s.project_id FROM tasks t
            JOIN project_stages s ON t.stage_id = s.id WHERE t.id = ?
        ''', (task_id,)).fetchone()

        if not task:
            close_db()
            return []

        # 获取已有依赖
        existing = set(row['depends_on_task_id'] for row in conn.execute(
            'SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?', (task_id,)
        ).fetchall())

        # 获取同项目所有任务
        all_tasks = conn.execute('''
            SELECT t.id, t.task_name, s.stage_name, s.stage_order
            FROM tasks t JOIN project_stages s ON t.stage_id = s.id
            WHERE s.project_id = ? AND t.id != ?
            ORDER BY s.stage_order, t.id
        ''', (task['project_id'], task_id)).fetchall()

        result = []
        for t in all_tasks:
            if t['id'] not in existing:
                result.append({
                    'id': t['id'],
                    'task_name': t['task_name'],
                    'stage_name': t['stage_name'],
                    'already_dep': False
                })
            else:
                result.append({
                    'id': t['id'],
                    'task_name': t['task_name'],
                    'stage_name': t['stage_name'],
                    'already_dep': True
                })

        close_db()
        return result


dependency_service = DependencyService()
