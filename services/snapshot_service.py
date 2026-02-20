# services/snapshot_service.py
"""
进度快照 + 偏差分析服务
- 每周自动快照项目进度数据
- 多周对比视图
- AI进度偏差分析与趋势预测
"""

import logging
import json
from datetime import datetime, timedelta
from database import get_db, close_db

logger = logging.getLogger(__name__)


class SnapshotService:

    @staticmethod
    def capture_snapshot(project_id, snapshot_type='manual'):
        """为项目拍摄进度快照"""
        conn = get_db()

        project = conn.execute(
            'SELECT id, project_name, status, progress FROM projects WHERE id = ?',
            (project_id,)
        ).fetchone()

        if not project:
            close_db()
            return None

        # 获取每个阶段的进度
        stages = conn.execute('''
            SELECT id, stage_name, stage_order, progress, status
            FROM project_stages
            WHERE project_id = ?
            ORDER BY stage_order
        ''', (project_id,)).fetchall()

        # 获取任务统计
        task_stats = conn.execute('''
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN t.is_completed = 1 THEN 1 ELSE 0 END) as completed
            FROM tasks t
            JOIN project_stages s ON t.stage_id = s.id
            WHERE s.project_id = ?
        ''', (project_id,)).fetchall()[0]

        # 获取问题统计
        issue_stats = conn.execute('''
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status NOT IN ('已解决', '已关闭') THEN 1 ELSE 0 END) as open_count
            FROM issues
            WHERE project_id = ?
        ''', (project_id,)).fetchall()[0]

        # 获取接口统计
        interface_stats = conn.execute('''
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = '已完成' THEN 1 ELSE 0 END) as completed
            FROM interfaces
            WHERE project_id = ?
        ''', (project_id,)).fetchall()[0]

        # 构建快照数据
        snapshot_data = {
            'overall_progress': project['progress'],
            'status': project['status'],
            'stages': [{
                'stage_name': s['stage_name'],
                'stage_order': s['stage_order'],
                'progress': s['progress'],
                'status': s['status']
            } for s in stages],
            'tasks': {
                'total': task_stats['total'] or 0,
                'completed': task_stats['completed'] or 0
            },
            'issues': {
                'total': issue_stats['total'] or 0,
                'open': issue_stats['open_count'] or 0
            },
            'interfaces': {
                'total': interface_stats['total'] or 0,
                'completed': interface_stats['completed'] or 0
            }
        }

        today = datetime.now().strftime('%Y-%m-%d')

        # 检查今天是否已有快照，有则更新
        existing = conn.execute(
            'SELECT id FROM progress_snapshots WHERE project_id = ? AND snapshot_date = ?',
            (project_id, today)
        ).fetchone()

        if existing:
            conn.execute('''
                UPDATE progress_snapshots
                SET snapshot_data = ?, overall_progress = ?, snapshot_type = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            ''', (json.dumps(snapshot_data, ensure_ascii=False), project['progress'], snapshot_type, existing['id']))
        else:
            conn.execute('''
                INSERT INTO progress_snapshots (project_id, snapshot_date, overall_progress, snapshot_data, snapshot_type)
                VALUES (?, ?, ?, ?, ?)
            ''', (project_id, today, project['progress'], json.dumps(snapshot_data, ensure_ascii=False), snapshot_type))

        conn.commit()
        close_db()
        return snapshot_data

    @staticmethod
    def capture_all_snapshots():
        """为所有活跃项目拍摄快照"""
        conn = get_db()
        projects = conn.execute('''
            SELECT id FROM projects WHERE status NOT IN ('已完成', '已终止')
        ''').fetchall()
        close_db()

        results = []
        for p in projects:
            try:
                SnapshotService.capture_snapshot(p['id'], 'auto')
                results.append({'project_id': p['id'], 'success': True})
            except Exception as e:
                results.append({'project_id': p['id'], 'success': False, 'error': str(e)})

        return results

    @staticmethod
    def get_snapshots(project_id, weeks=8):
        """获取项目最近N周的快照数据"""
        conn = get_db()

        snapshots = conn.execute('''
            SELECT id, snapshot_date, overall_progress, snapshot_data, snapshot_type, created_at
            FROM progress_snapshots
            WHERE project_id = ?
            ORDER BY snapshot_date DESC
            LIMIT ?
        ''', (project_id, weeks * 7)).fetchall()

        close_db()

        result = []
        for s in snapshots:
            data = json.loads(s['snapshot_data']) if s['snapshot_data'] else {}
            result.append({
                'id': s['id'],
                'date': s['snapshot_date'],
                'overall_progress': s['overall_progress'],
                'data': data,
                'type': s['snapshot_type']
            })

        return result

    @staticmethod
    def get_deviation_analysis(project_id):
        """进度偏差分析：对比最近几周快照"""
        snapshots = SnapshotService.get_snapshots(project_id, weeks=8)

        if len(snapshots) < 2:
            # 不够快照做对比，先拍一个
            SnapshotService.capture_snapshot(project_id, 'auto')
            snapshots = SnapshotService.get_snapshots(project_id, weeks=8)

        if len(snapshots) < 2:
            return {
                'has_data': False,
                'message': '快照数据不足，至少需要2个快照才能进行偏差分析',
                'snapshots': snapshots
            }

        # 按日期正序
        snapshots.reverse()

        # 计算每周进度增量
        weekly_deltas = []
        for i in range(1, len(snapshots)):
            prev = snapshots[i - 1]
            curr = snapshots[i]
            delta = curr['overall_progress'] - prev['overall_progress']
            days_diff = (datetime.strptime(curr['date'], '%Y-%m-%d') -
                         datetime.strptime(prev['date'], '%Y-%m-%d')).days
            weekly_deltas.append({
                'from_date': prev['date'],
                'to_date': curr['date'],
                'days': days_diff,
                'progress_from': prev['overall_progress'],
                'progress_to': curr['overall_progress'],
                'delta': delta,
                'daily_rate': round(delta / max(days_diff, 1), 2)
            })

        # 计算阶段级别偏差
        latest = snapshots[-1]
        previous = snapshots[-2] if len(snapshots) >= 2 else None
        stage_deviations = []

        if latest.get('data', {}).get('stages') and previous and previous.get('data', {}).get('stages'):
            latest_stages = {s['stage_name']: s for s in latest['data']['stages']}
            prev_stages = {s['stage_name']: s for s in previous['data']['stages']}

            for stage_name in latest_stages:
                curr_progress = latest_stages[stage_name]['progress']
                prev_progress = prev_stages.get(stage_name, {}).get('progress', 0)
                delta = curr_progress - prev_progress
                stage_deviations.append({
                    'stage_name': stage_name,
                    'current_progress': curr_progress,
                    'previous_progress': prev_progress,
                    'delta': delta,
                    'trend': '📈' if delta > 0 else ('📉' if delta < 0 else '➡️')
                })

        # 趋势预测
        avg_daily_rate = sum(d['daily_rate'] for d in weekly_deltas) / len(weekly_deltas) if weekly_deltas else 0
        current_progress = snapshots[-1]['overall_progress']
        remaining = 100 - current_progress

        if avg_daily_rate > 0:
            estimated_days = int(remaining / avg_daily_rate)
            estimated_completion = datetime.now() + timedelta(days=estimated_days)
            prediction = f"按当前速度（日均 {avg_daily_rate:.1f}%），预计还需 {estimated_days} 天完成，约 {estimated_completion.strftime('%Y-%m-%d')}"
        elif current_progress >= 100:
            prediction = "项目已完成"
            estimated_days = 0
        else:
            prediction = "近期进度无增长，无法预测完成时间"
            estimated_days = -1

        # 识别停滞阶段
        stagnant_stages = [s for s in stage_deviations if s['delta'] == 0 and s['current_progress'] < 100]

        return {
            'has_data': True,
            'snapshots': snapshots,
            'weekly_deltas': weekly_deltas,
            'stage_deviations': stage_deviations,
            'stagnant_stages': stagnant_stages,
            'avg_daily_rate': round(avg_daily_rate, 2),
            'current_progress': current_progress,
            'prediction': prediction,
            'estimated_days': estimated_days,
            'summary': {
                'total_snapshots': len(snapshots),
                'trend': '上升' if avg_daily_rate > 0 else ('停滞' if avg_daily_rate == 0 else '下降'),
                'stagnant_count': len(stagnant_stages)
            }
        }

    @staticmethod
    def generate_ai_deviation_report(project_id):
        """AI生成偏差分析报告"""
        analysis = SnapshotService.get_deviation_analysis(project_id)

        if not analysis['has_data']:
            return analysis

        conn = get_db()
        project = conn.execute(
            'SELECT project_name, hospital_name, status, progress, plan_start_date, plan_end_date FROM projects WHERE id = ?',
            (project_id,)
        ).fetchone()
        close_db()

        if not project:
            return {'error': '项目不存在'}

        # 构建 prompt
        deltas_text = "\n".join([
            f"  {d['from_date']} → {d['to_date']}: +{d['delta']}% (日均 {d['daily_rate']}%)"
            for d in analysis['weekly_deltas'][-6:]
        ])

        stage_text = "\n".join([
            f"  {s['trend']} {s['stage_name']}: {s['previous_progress']}% → {s['current_progress']}% (变化: {s['delta']:+d}%)"
            for s in analysis['stage_deviations']
        ]) or "  无阶段数据"

        stagnant_text = ", ".join([s['stage_name'] for s in analysis['stagnant_stages']]) or "无"

        prompt = f"""作为项目管理专家，请分析以下项目的进度偏差数据，给出诊断和建议。

## 项目信息
- 项目: {project['project_name']} ({project['hospital_name']})
- 状态: {project['status']} | 当前进度: {project['progress']}%
- 计划周期: {project['plan_start_date']} ~ {project['plan_end_date']}

## 进度趋势（近期快照对比）
{deltas_text}

## 阶段进度变化（本周 vs 上周）
{stage_text}

## 停滞阶段
{stagnant_text}

## 趋势预测
{analysis['prediction']}

---

请按以下格式输出偏差分析报告（Markdown）：

### 📊 进度偏差诊断
分析当前进度是否正常，与计划的偏差程度。

### ⚠️ 风险识别
基于进度趋势识别的主要风险（最多3条）。

### 🔍 停滞原因分析
分析停滞阶段的可能原因（如果有停滞的话）。

### 💡 加速建议
提出具体的、可执行的加速建议（最多3条）。

### 📈 预测与下一步
基于当前趋势的完成时间预测和下一步重点工作。

要求简洁务实，给出可落地的建议。"""

        try:
            from ai_utils import call_ai
            report = call_ai(prompt, task_type='analysis')
            analysis['ai_report'] = report
            return analysis
        except Exception as e:
            analysis['ai_report'] = None
            analysis['ai_error'] = str(e)
            return analysis


snapshot_service = SnapshotService()
