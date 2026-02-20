
from database import DatabasePool
from services.ai_service import AIService
from datetime import datetime, timedelta
import json

class RiskSimulationService:
    @staticmethod
    def calculate_impact_chain(project_id, task_id, delay_days):
        """
        通过任务依赖图模拟延迟的连锁反应
        """
        try:
            with DatabasePool.get_connection() as conn:
                # 1. 获取所有任务依赖关系
                all_deps = conn.execute('''
                    SELECT td.task_id, td.depends_on_task_id, t.task_name, t.is_completed, 
                           s.stage_name, s.plan_end_date
                    FROM task_dependencies td
                    JOIN tasks t ON td.task_id = t.id
                    JOIN project_stages s ON t.stage_id = s.id
                    WHERE s.project_id = ?
                ''', (project_id,)).fetchall()
                
                # 2. 获取初始任务信息
                root_task = conn.execute('SELECT task_name FROM tasks WHERE id = ?', (task_id,)).fetchone()
                if not root_task: return None
                
                # 3. 广度优先搜索 (BFS) 构建影响链
                impacted_tasks = []
                queue = [(task_id, delay_days)]
                visited = {task_id}
                
                # 构建邻接表 (depends_on_task_id -> [task_id, ...])
                adj = {}
                for d in all_deps:
                    parent = d['depends_on_task_id']
                    child = d['task_id']
                    if parent not in adj: adj[parent] = []
                    adj[parent].append(d)
                
                while queue:
                    curr_id, curr_delay = queue.pop(0)
                    if curr_id in adj:
                        for child_info in adj[curr_id]:
                            child_id = child_info['task_id']
                            if child_id not in visited:
                                visited.add(child_id)
                                queue.append((child_id, curr_delay))
                                impacted_tasks.append(dict(child_info))
                
                # 4. 获取受影响的里程碑
                milestones = conn.execute('''
                    SELECT * FROM milestones 
                    WHERE project_id = ? AND is_completed = 0
                ''', (project_id,)).fetchall()
                
                # 5. 调用 AI 生成“蝴蝶效应”描述
                narration = RiskSimulationService._generate_ai_narration(
                    root_task['task_name'], delay_days, impacted_tasks, milestones
                )
                
                return {
                    "root_task": root_task['task_name'],
                    "delay_days": delay_days,
                    "impacted_count": len(impacted_tasks),
                    "impacted_tasks": impacted_tasks[:10], # 仅返回前10个展示
                    "narration": narration
                }
        except Exception as e:
            print(f"Impact Chain Error: {e}")
            return None

    @staticmethod
    def _generate_ai_narration(root_task, delay, impacted_tasks, milestones):
        system_prompt = """你是一位专业的项目风险分析专家。
请根据任务依赖关系和延迟数据，解释单一任务延迟如何产生“蝴蝶效应”。
要求：
1. 分析延迟对后续关键路径的逻辑冲击。
2. 预测如果不采取补救措施，最坏可能会影响哪些里程碑或最终工期。
3. 语气警示但也具建设性。
4. 使用 Markdown 格式。"""
        
        context = f"初始延迟任务: {root_task}, 延迟天数: {delay}天\\n"
        context += f"直接/间接影响的后续任务数: {len(impacted_tasks)}\\n"
        context += f"下游任务示例: {[t['task_name'] for t in impacted_tasks[:5]]}\\n"
        context += f"待达成里程碑: {[m['name'] for m in milestones]}\\n"
        
        try:
            return AIService.call_ai_api(system_prompt, context, task_type="analysis")
        except:
            return "AI 模拟分析暂时不可用。"

risk_simulation_service = RiskSimulationService()
