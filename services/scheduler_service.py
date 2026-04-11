"""
scheduler_service.py - 自动日报/周报定时生成与归档服务

使用 threading.Timer 实现轻量级定时调度（零依赖）:
- 每日 22:00 为所有活跃项目自动生成日报
- 每周五 22:30 为所有活跃项目自动生成周报
- 每日 08:30 推送晨会简报到企微群
- 每日 09:00 运行项目哨兵扫描（逾期、高危问题检测 → 推送给项目经理）
- AI 失败时兜底保存纯数据摘要

⚠️ 部署注意事项:
  - threading.Timer 在进程被 OOM kill 或 worker 重启后不会自动恢复
  - 多 worker 部署时 (gunicorn --workers > 1) 会导致定时任务多次执行
  - 推荐: gunicorn --workers 1 --threads 4 (单 worker 多线程) 或 --preload
"""

import threading
import logging
import json
from datetime import datetime, timedelta
from database import DatabasePool

logger = logging.getLogger(__name__)


class ReportScheduler:
    """报告自动生成调度器"""

    DAILY_HOUR = 22
    DAILY_MINUTE = 0
    WEEKLY_HOUR = 22
    WEEKLY_MINUTE = 30
    WEEKLY_DAY = 4  # Friday (0=Monday)
    BRIEFING_HOUR = 8
    BRIEFING_MINUTE = 0
    MONITOR_HOUR = 8
    MONITOR_MINUTE = 5
    NIGHTLY_HOUR = 23
    NIGHTLY_MINUTE = 0
    EXEC_HOUR = 8
    EXEC_MINUTE = 15
    EXEC_WEEKDAY = 0  # Monday

    def __init__(self):
        self._daily_timer = None
        self._weekly_timer = None
        self._briefing_timer = None
        self._monitor_timer = None
        self._nightly_timer = None
        self._exec_timer = None
        self._running = False

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def start(self):
        """启动调度器"""
        if self._running:
            return
        self._running = True
        self._schedule_daily()
        self._schedule_weekly()
        self._schedule_briefing()
        self._schedule_monitor()
        self._schedule_nightly()
        self._schedule_exec()
        logger.info("📅 报告自动归档调度器已启动 (日报 %02d:%02d / 周报 周五 %02d:%02d / 晨会简报 %02d:%02d / 项目哨兵 %02d:%02d)",
                     self.DAILY_HOUR, self.DAILY_MINUTE,
                     self.WEEKLY_HOUR, self.WEEKLY_MINUTE,
                     self.BRIEFING_HOUR, self.BRIEFING_MINUTE,
                     self.MONITOR_HOUR, self.MONITOR_MINUTE)

    def stop(self):
        """停止调度器"""
        self._running = False
        if self._daily_timer:
            self._daily_timer.cancel()
        if self._weekly_timer:
            self._weekly_timer.cancel()
        if self._briefing_timer:
            self._briefing_timer.cancel()
        if self._monitor_timer:
            self._monitor_timer.cancel()
        if self._nightly_timer:
            self._nightly_timer.cancel()
        if self._exec_timer:
            self._exec_timer.cancel()
        logger.info("报告自动归档调度器已停止")

    # ------------------------------------------------------------------
    # Scheduling helpers
    # ------------------------------------------------------------------
    def _seconds_until(self, hour, minute, weekday=None):
        """计算距离下一个目标时间的秒数"""
        now = datetime.now()
        target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)

        if weekday is not None:
            days_ahead = weekday - now.weekday()
            if days_ahead < 0 or (days_ahead == 0 and now >= target):
                days_ahead += 7
            target += timedelta(days=days_ahead)
        else:
            if now >= target:
                target += timedelta(days=1)

        diff = (target - now).total_seconds()
        return max(diff, 60)  # 至少 60 秒

    def _schedule_daily(self):
        if not self._running:
            return
        delay = self._seconds_until(self.DAILY_HOUR, self.DAILY_MINUTE)
        self._daily_timer = threading.Timer(delay, self._run_daily)
        self._daily_timer.daemon = True
        self._daily_timer.start()
        next_run = datetime.now() + timedelta(seconds=delay)
        logger.info("下次日报自动生成时间: %s", next_run.strftime('%Y-%m-%d %H:%M'))

    def _schedule_weekly(self):
        if not self._running:
            return
        delay = self._seconds_until(self.WEEKLY_HOUR, self.WEEKLY_MINUTE, self.WEEKLY_DAY)
        self._weekly_timer = threading.Timer(delay, self._run_weekly)
        self._weekly_timer.daemon = True
        self._weekly_timer.start()
        next_run = datetime.now() + timedelta(seconds=delay)
        logger.info("下次周报自动生成时间: %s", next_run.strftime('%Y-%m-%d %H:%M'))

    def _schedule_briefing(self):
        if not self._running:
            return
        delay = self._seconds_until(self.BRIEFING_HOUR, self.BRIEFING_MINUTE)
        self._briefing_timer = threading.Timer(delay, self._run_briefing)
        self._briefing_timer.daemon = True
        self._briefing_timer.start()
        next_run = datetime.now() + timedelta(seconds=delay)
        logger.info("下次晨会简报推送时间: %s", next_run.strftime('%Y-%m-%d %H:%M'))

    def _schedule_monitor(self):
        if not self._running:
            return
        delay = self._seconds_until(self.MONITOR_HOUR, self.MONITOR_MINUTE)
        self._monitor_timer = threading.Timer(delay, self._run_monitor)
        self._monitor_timer.daemon = True
        self._monitor_timer.start()
        next_run = datetime.now() + timedelta(seconds=delay)
        logger.info("下次项目哨兵扫描时间: %s", next_run.strftime('%Y-%m-%d %H:%M'))

    def _schedule_nightly(self):
        if not self._running:
            return
        delay = self._seconds_until(self.NIGHTLY_HOUR, self.NIGHTLY_MINUTE)
        self._nightly_timer = threading.Timer(delay, self._run_nightly)
        self._nightly_timer.daemon = True
        self._nightly_timer.start()
        next_run = datetime.now() + timedelta(seconds=delay)
        logger.info("下次夜间快照时间: %s", next_run.strftime('%Y-%m-%d %H:%M'))

    def _schedule_exec(self):
        if not self._running:
            return
        delay = self._seconds_until(self.EXEC_HOUR, self.EXEC_MINUTE, self.EXEC_WEEKDAY)
        self._exec_timer = threading.Timer(delay, self._run_exec)
        self._exec_timer.daemon = True
        self._exec_timer.start()
        next_run = datetime.now() + timedelta(seconds=delay)
        logger.info("下次周一经营摘要推送时间: %s", next_run.strftime('%Y-%m-%d %H:%M'))

    # ------------------------------------------------------------------
    # Runners
    # ------------------------------------------------------------------
    def _run_daily(self):
        """执行每日日报生成"""
        try:
            logger.info("⏰ 开始自动生成日报...")
            self._generate_daily_reports()
            self._check_idle_projects()
        except Exception as e:
            logger.error("自动日报生成异常: %s", e, exc_info=True)
        finally:
            self._schedule_daily()

    def _run_weekly(self):
        """执行每周周报生成"""
        try:
            logger.info("⏰ 开始自动生成周报...")
            self._generate_weekly_reports()
        except Exception as e:
            logger.error("自动周报生成异常: %s", e, exc_info=True)
        finally:
            self._schedule_weekly()

    def _run_briefing(self):
        """执行每日晨会简报推送"""
        try:
            # 只在工作日推送 (周一到周五)
            if datetime.now().weekday() < 5:
                logger.info("⏰ 开始生成并推送每日晨会简报...")
                self._push_daily_briefing()
            else:
                logger.info("今天是周末，跳过晨会简报推送")
        except Exception as e:
            logger.error("晨会简报推送异常: %s", e, exc_info=True)
        finally:
            self._schedule_briefing()

    def _run_monitor(self):
        """执行每日项目哨兵扫描（逾期、高危问题检测并推送）"""
        try:
            if datetime.now().weekday() < 5:
                logger.info("⏰ 开始执行项目哨兵扫描...")
                from services.monitor_service import monitor_service
                reminders = monitor_service.check_and_create_reminders()
                logger.info("✅ 项目哨兵扫描完成，创建了 %d 条提醒: %s", len(reminders), reminders[:5])
                if reminders:
                    monitor_service.send_wecom_message(
                        "每日预警扫描结果",
                        f"今日新增预警 {len(reminders)} 条：\n" + "\n".join(f"- {item}" for item in reminders[:10]),
                        msg_type='markdown'
                    )
                self._push_global_anomaly_briefing()
            else:
                logger.info("今天是周末，跳过项目哨兵扫描")
        except Exception as e:
            logger.error("项目哨兵扫描异常: %s", e, exc_info=True)
        finally:
            self._schedule_monitor()

    def _run_nightly(self):
        """执行夜间风险快照与知识向量同步"""
        try:
            logger.info("⏰ 开始执行夜间风险快照与向量同步...")
            self._snapshot_project_risks()
            self._sync_kb_embeddings()
            self._sync_payment_milestones()
        except Exception as e:
            logger.error("夜间任务异常: %s", e, exc_info=True)
        finally:
            self._schedule_nightly()

    def _run_exec(self):
        """每周一推送经营摘要"""
        try:
            logger.info("⏰ 开始生成周一经营摘要...")
            self._push_weekly_executive_summary()
        except Exception as e:
            logger.error("周一经营摘要异常: %s", e, exc_info=True)
        finally:
            self._schedule_exec()

    def _push_daily_briefing(self):
        """生成并推送每日晨会简报到企业微信"""
        try:
            from services.standup_service import standup_service
            result = standup_service.push_briefing_to_wecom()
            if result.get('success'):
                logger.info("✅ 晨会简报已成功推送到企业微信")
            else:
                logger.warning("晨会简报推送结果: %s", result.get('message', '未知'))
        except Exception as e:
            logger.error("晨会简报推送失败: %s", e)

    def _check_idle_projects(self):
        """检查闲置项目并催办"""
        try:
            from services.reminder_service import reminder_service
            from services.wecom_push_service import wecom_push_service
            
            idle_projects = reminder_service.check_idle_projects()
            for p in idle_projects:
                wecom_push_service.push_idle_escalation(
                    p['id'], p['project_name'], 
                    p.get('manager', ''), p['days_idle']
                )
        except Exception as e:
            logger.error("闲置催办检查失败: %s", e)

    def _snapshot_project_risks(self):
        from services.ai_insight_service import ai_insight_service
        projects = self._get_active_projects()
        ok_count = 0
        for project in projects:
            try:
                if ai_insight_service.snapshot_project_risk(project['id']):
                    ok_count += 1
            except Exception as ex:
                logger.warning("项目 %s 风险快照失败: %s", project['id'], ex)
        logger.info("夜间风险快照完成: %d/%d", ok_count, len(projects))

    def _sync_kb_embeddings(self):
        try:
            from rag_service import rag_service
            from services.ai_service import ai_service
            synced = rag_service.sync_embeddings(ai_service)
            logger.info("知识向量同步完成: %d 条", synced)
        except Exception as ex:
            logger.warning("知识向量同步失败: %s", ex)

    def _push_weekly_executive_summary(self):
        from services.analytics_service import analytics_service
        from services.monitor_service import monitor_service
        digest = analytics_service.get_weekly_exec_digest(days=7)
        summary = digest.get('summary', {})
        content = (
            f"上周有进展项目: {summary.get('progressed_project_count', 0)}\n"
            f"高优预警: {summary.get('high_warning_count', 0)}\n"
            f"超3天未更新人员: {summary.get('silent_people_count', 0)}\n"
            f"未来7天预计回款: {summary.get('expected_receivable_amount', 0)} 元\n"
            f"回款节点数: {summary.get('expected_receivable_count', 0)}"
        )
        monitor_service.send_wecom_message("周一全线经营摘要", content, msg_type='markdown')

    def _sync_payment_milestones(self):
        try:
            from services.project_service import project_service
            count = project_service.reevaluate_all_payment_milestones()
            logger.info("回款节点兜底扫描完成，项目数: %d", count)
        except Exception as ex:
            logger.warning("回款节点兜底扫描失败: %s", ex)

    def _push_global_anomaly_briefing(self):
        try:
            from services.analytics_service import analytics_service
            from services.monitor_service import monitor_service
            digest = analytics_service.get_global_anomaly_briefing(use_ai=True)
            monitor_service.send_wecom_message(
                "今日全局异常巡航",
                digest.get('briefing') or '暂无异常摘要',
                msg_type='markdown'
            )
            logger.info("全局异常巡航摘要已推送")
        except Exception as ex:
            logger.warning("全局异常巡航摘要推送失败: %s", ex)

    # ------------------------------------------------------------------
    # Report generation core
    # ------------------------------------------------------------------
    def _get_active_projects(self):
        """获取所有活跃项目"""
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql("""
                SELECT * FROM projects 
                WHERE status NOT IN ('已完成', '已终止', '已验收', '质保期')
            """)
            return conn.execute(sql).fetchall()

    def _has_archive(self, project_id, report_type, report_date):
        """检查是否已有归档"""
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql("SELECT id FROM report_archive WHERE project_id = ? AND report_type = ? AND report_date = ?")
            row = conn.execute(sql, (project_id, report_type, report_date)).fetchone()
            return row is not None

    def _save_archive(self, project_id, report_type, report_date, content, generated_by='auto'):
        """保存报告归档"""
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql("""
                INSERT INTO report_archive (project_id, report_type, report_date, content, generated_by)
                VALUES (?, ?, ?, ?, ?)
            """)
            conn.execute(sql, (project_id, report_type, report_date, content, generated_by))
            conn.commit()

    # ------------------------------------------------------------------
    # Daily report
    # ------------------------------------------------------------------
    def _generate_daily_reports(self):
        """为所有活跃项目生成日报"""
        today = datetime.now().strftime('%Y-%m-%d')
        projects = self._get_active_projects()
        success_count = 0

        for project in projects:
            pid = project['id']
            try:
                if self._has_archive(pid, 'daily', today):
                    logger.info("  项目 %s 今日日报已存在，跳过", project['project_name'])
                    continue

                content = self._build_daily_report(pid, project, today)
                 # 企业微信卡片推送
                self._save_archive(pid, 'daily', today, content, 'auto')
                try:
                    from services.wecom_push_service import wecom_push_service
                    wecom_push_service.push_daily_report_card(pid, content, today)
                except Exception as e:
                    logger.warning("日报卡片推送失败: %s", e)


                success_count += 1
                logger.info("  ✅ 项目 %s 日报已归档", project['project_name'])
            except Exception as e:
                logger.error("  ❌ 项目 %s 日报生成失败: %s", project['project_name'], e)
            finally:
                pass

        logger.info("日报自动生成完成: %d/%d 个项目", success_count, len(projects))

    def _build_daily_report(self, project_id, project, report_date):
        """构建单个项目的日报内容"""
        with DatabasePool.get_connection() as conn:
            # 今日工作日志
            sql_logs = DatabasePool.format_sql("SELECT * FROM work_logs WHERE project_id = ? AND log_date = ?")
            daily_logs = conn.execute(sql_logs, (project_id, report_date)).fetchall()

            # 今日完成任务
            sql_tasks = DatabasePool.format_sql("""
                SELECT t.task_name, s.stage_name FROM tasks t
                JOIN project_stages s ON t.stage_id = s.id
                WHERE s.project_id = ? AND t.is_completed = ? AND t.completed_date = ?
            """)
            completed_tasks = conn.execute(sql_tasks, (project_id, True, report_date)).fetchall()

            # 活跃问题
            sql_issues = DatabasePool.format_sql("""
                SELECT * FROM issues 
                WHERE project_id = ? AND status != '已解决'
                ORDER BY severity DESC LIMIT 5
            """)
            active_issues = conn.execute(sql_issues, (project_id,)).fetchall()

            # 阶段概况
            sql_stages = DatabasePool.format_sql("SELECT stage_name, progress FROM project_stages WHERE project_id = ? ORDER BY stage_order")
            stages = conn.execute(sql_stages, (project_id,)).fetchall()

            sql_counts = DatabasePool.format_sql('''
                SELECT COUNT(*) as total,
                       SUM(CASE WHEN t.is_completed = ? THEN 1 ELSE 0 END) as done
                FROM tasks t
                JOIN project_stages s ON t.stage_id = s.id
                WHERE s.project_id = ?
            ''')
            task_counts = conn.execute(sql_counts, (True, project_id)).fetchone()

        total_tasks = task_counts['total'] or 0
        done_tasks = task_counts['done'] or 0
        actual_progress = round(done_tasks / total_tasks * 100) if total_tasks > 0 else (project['progress'] or 0)

        # 明日计划
        tmr_plans = [l['tomorrow_plan'] for l in daily_logs if l['tomorrow_plan']]

        # 构建数据上下文
        context_data = {
            "project_name": project['project_name'],
            "hospital_name": project['hospital_name'],
            "status": project['status'],
            "progress": actual_progress,
            "date": report_date,
            "logs": [dict(l) for l in daily_logs],
            "completed_tasks": [dict(t) for t in completed_tasks],
            "active_issues": [dict(i) for i in active_issues],
            "stages": [dict(s) for s in stages],
            "tomorrow_plans": tmr_plans
        }

        # 尝试 AI 生成
        try:
            from ai_utils import call_ai

            context = f"""
【项目基础信息】
项目名称: {project['project_name']}
医院: {project['hospital_name']}
当前阶段: {project['status']}
整体进度: {actual_progress}%
日期: {report_date}

【今日工作内容 (来自团队日志)】
{chr(10).join([f"- {l['member_name']} ({l['work_type']}): {l['work_content']}" for l in daily_logs]) if daily_logs else "无今日日志记录"}

【今日完成任务】
{chr(10).join([f"- [{t['stage_name']}] {t['task_name']}" for t in completed_tasks]) if completed_tasks else "无主要任务完成"}

【当前重点关注问题/风险】
{chr(10).join([f"- [{i['severity']}] {i['description']} (状态:{i['status']})" for i in active_issues]) if active_issues else "暂无重大风险"}

【明日计划】
{chr(10).join([f"- {plan}" for plan in tmr_plans]) if tmr_plans else "按计划推进"}
"""

            prompt = f"""你是一名专业的高级项目经理，正在向【医院信息科（甲方技术部门）】汇报工作。
请根据以下数据，写一份《项目实施日报》。

【要求】
1. 语气专业、客观、干练
2. 包含【今日进展】、【风险与问题】、【明日计划】三个板块
3. 突出技术难题解决和关键节点完成情况
4. 适当引用进度百分比或具体任务数
5. 300-500字左右

【项目数据】
{context}
"""
            report_content = call_ai(prompt, task_type='report')

            # 检查是否 AI 返回了错误信息
            if 'AI服务暂时不可用' in report_content or 'AI 服务当前不可用' in report_content:
                raise Exception("AI service unavailable")

            return report_content

        except Exception as e:
            logger.warning("AI日报生成失败 (%s), 使用纯数据摘要", e)
            return self._build_data_daily_summary(project, report_date, daily_logs, completed_tasks, active_issues, stages, tmr_plans, actual_progress)

    def _build_data_daily_summary(self, project, date, logs, tasks, issues, stages, plans, actual_progress=None):
        """AI 不可用时的纯数据日报摘要"""
        progress_value = actual_progress if actual_progress is not None else (project['progress'] or 0)
        lines = [
            f"# 📋 {project['project_name']} 项目实施日报",
            f"",
            f"**日期**: {date}",
            f"**项目**: {project['project_name']} ({project['hospital_name']})",
            f"**状态**: {project['status']} | **整体进度**: {progress_value}%",
            f"**报告类型**: 系统自动生成（数据摘要）",
            f"",
            f"## 一、今日进展",
        ]

        if tasks:
            for t in tasks:
                lines.append(f"- ✅ [{t['stage_name']}] {t['task_name']}")
        else:
            lines.append("- 无主要任务完成")

        if logs:
            lines.append("")
            lines.append("**工作日志:**")
            for l in logs:
                lines.append(f"- {l['member_name']} ({l['work_type']}): {l['work_content']}")

        lines.append("")
        lines.append("## 二、风险与问题")
        if issues:
            for i in issues:
                lines.append(f"- [{i['severity']}] {i['description']} (状态: {i['status']})")
        else:
            lines.append("- 暂无重大风险")

        lines.append("")
        lines.append("## 三、明日计划")
        if plans:
            for p in plans:
                lines.append(f"- {p}")
        else:
            lines.append("- 按计划推进")

        lines.append("")
        lines.append("## 四、阶段进度概览")
        if stages:
            lines.append("| 阶段 | 进度 |")
            lines.append("|------|------|")
            for s in stages:
                lines.append(f"| {s['stage_name']} | {s['progress']}% |")

        lines.append("")
        lines.append(f"---")
        lines.append(f"*报告自动生成于 {datetime.now().strftime('%Y-%m-%d %H:%M')}*")

        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Weekly report
    # ------------------------------------------------------------------
    def _generate_weekly_reports(self):
        """为所有活跃项目生成周报"""
        today = datetime.now().strftime('%Y-%m-%d')
        projects = self._get_active_projects()
        success_count = 0

        for project in projects:
            pid = project['id']
            try:
                if self._has_archive(pid, 'weekly', today):
                    logger.info("  项目 %s 本周周报已存在，跳过", project['project_name'])
                    continue

                content = self._build_weekly_report(pid, project, today)
                self._save_archive(pid, 'weekly', today, content, 'auto')

                # 企业微信周报卡片推送
                try:
                    from services.wecom_push_service import wecom_push_service
                    wecom_push_service.push_weekly_report_card(pid, content, today)
                except Exception as e:
                    logger.warning("周报卡片推送失败: %s", e)

                # 周报推送给甲方联系人
                try:
                    from services.wecom_push_service import wecom_push_service
                    wecom_push_service.push_weekly_to_customer(pid, content)
                except Exception as e:
                    logger.warning("甲方周报推送失败: %s", e)

                success_count += 1
                logger.info("  ✅ 项目 %s 周报已归档", project['project_name'])
            except Exception as e:
                logger.error("  ❌ 项目 %s 周报生成失败: %s", project['project_name'], e)

        logger.info("周报自动生成完成: %d/%d 个项目", success_count, len(projects))

    def _build_weekly_report(self, project_id, project, today):
        """构建单个项目的周报"""
        week_ago = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')

        with DatabasePool.get_connection() as conn:
            sql_st = DatabasePool.format_sql("SELECT * FROM project_stages WHERE project_id = ? ORDER BY stage_order")
            stages = [dict(s) for s in conn.execute(sql_st, (project_id,)).fetchall()]

            sql_tasks = DatabasePool.format_sql("""
                SELECT t.task_name, s.stage_name, t.completed_date 
                FROM tasks t JOIN project_stages s ON t.stage_id = s.id 
                WHERE s.project_id = ? AND t.is_completed = ? AND t.completed_date >= ?
            """)
            completed_tasks = [dict(t) for t in conn.execute(sql_tasks, (project_id, True, week_ago)).fetchall()]

            sql_ni = DatabasePool.format_sql("SELECT * FROM issues WHERE project_id = ? AND created_at >= ?")
            new_issues = [dict(i) for i in conn.execute(sql_ni, (project_id, week_ago)).fetchall()]

            sql_pi = DatabasePool.format_sql("SELECT * FROM issues WHERE project_id = ? AND status != '已解决'")
            pending_issues = [dict(i) for i in conn.execute(sql_pi, (project_id,)).fetchall()]

            sql_if = DatabasePool.format_sql("SELECT * FROM interfaces WHERE project_id = ?")
            interfaces = [dict(i) for i in conn.execute(sql_if, (project_id,)).fetchall()]

            sql_logs = DatabasePool.format_sql("SELECT * FROM work_logs WHERE project_id = ? AND log_date >= ? ORDER BY log_date")
            work_logs = [dict(w) for w in conn.execute(sql_logs, (project_id, week_ago)).fetchall()]

            sql_counts = DatabasePool.format_sql('''
                SELECT COUNT(*) as total,
                       SUM(CASE WHEN t.is_completed = ? THEN 1 ELSE 0 END) as done
                FROM tasks t
                JOIN project_stages s ON t.stage_id = s.id
                WHERE s.project_id = ?
            ''')
            task_counts = conn.execute(sql_counts, (True, project_id)).fetchone()

        total_tasks = task_counts['total'] or 0
        done_tasks = task_counts['done'] or 0
        actual_progress = round(done_tasks / total_tasks * 100) if total_tasks > 0 else (project['progress'] or 0)

        project_data = {
            "project": {**dict(project), "progress": actual_progress},
            "stages": stages,
            "completed_tasks_this_week": completed_tasks,
            "new_issues_this_week": new_issues,
            "pending_issues": pending_issues,
            "interfaces": interfaces,
            "work_logs_this_week": work_logs,
            "report_date": today
        }

        # 尝试 AI 生成
        try:
            from ai_utils import call_ai

            system_prompt = """你是一位专业的医疗信息化项目经理，请根据提供的项目底层数据生成一份结构化、专业的正式周报。
要求：
1. 语言严谨、客观，体现出项目经理的专业把控力。
2. 包含：本周核心进展、阶段状态更新、现存问题与风险分析、下周工作详细计划、建议协调事项。
3. 请使用 Markdown 格式排版，确保美观易读。
4. 严禁空话，必须基于真实的任务和日志数据。

Markdown格式示例：
# 📋 [项目名称] 周报
**报告周期**: YYYY-MM-DD ~ YYYY-MM-DD
**项目经理**: XXX | **当前进度**: XX%

## 一、本周工作完成情况
...
## 二、项目阶段状态
| 阶段 | 进度 | 状态 | 
|------|------|------|
...
## 三、问题与风险分析
...
## 四、下周工作计划
...
## 五、需要协调与支持
...
"""

            prompt = f"""{system_prompt}

请为以下项目生成周报：
{json.dumps(project_data, ensure_ascii=False, default=str)}
"""
            report_content = call_ai(prompt, task_type='report')

            if 'AI服务暂时不可用' in report_content or 'AI 服务当前不可用' in report_content:
                raise Exception("AI service unavailable")

            return report_content

        except Exception as e:
            logger.warning("AI周报生成失败 (%s), 使用纯数据摘要", e)
            return self._build_data_weekly_summary(
                project, today, week_ago, stages,
                completed_tasks, new_issues, pending_issues,
                interfaces, work_logs, actual_progress
            )

    def _build_data_weekly_summary(self, project, today, week_ago, stages,
                                    completed_tasks, new_issues, pending_issues,
                                    interfaces, work_logs, actual_progress=None):
        """AI 不可用时的纯数据周报摘要"""
        interface_done = len([i for i in interfaces if i['status'] == '已完成'])
        progress_value = actual_progress if actual_progress is not None else (project['progress'] or 0)

        lines = [
            f"# 📋 {project['project_name']} 项目周报",
            f"",
            f"**报告周期**: {week_ago} ~ {today}",
            f"**项目**: {project['project_name']} ({project['hospital_name']})",
            f"**项目经理**: {project['project_manager'] or '未指定'}",
            f"**当前状态**: {project['status']} | **整体进度**: {progress_value}%",
            f"**报告类型**: 系统自动生成（数据摘要）",
            f"",
            f"## 一、本周工作完成情况",
        ]

        if completed_tasks:
            for t in completed_tasks:
                lines.append(f"- ✅ [{t['stage_name']}] {t['task_name']} (完成于 {t['completed_date']})")
        else:
            lines.append("- 本周无任务完成记录")

        if work_logs:
            total_hours = sum(float(w.get('work_hours', 0) or 0) for w in work_logs)
            lines.append(f"\n**本周工作日志**: {len(work_logs)} 条, 累计工时 {total_hours:.1f}h")

        lines.append("")
        lines.append("## 二、当前项目阶段状态")
        if stages:
            lines.append("| 阶段 | 进度 | ")
            lines.append("|------|------|")
            for s in stages:
                lines.append(f"| {s['stage_name']} | {s.get('progress', 0)}% |")

        lines.append("")
        lines.append(f"**接口完成进度**: {interface_done}/{len(interfaces)}")

        lines.append("")
        lines.append("## 三、问题与风险")
        if new_issues:
            lines.append(f"**本周新增问题**: {len(new_issues)} 个")
            for i in new_issues:
                lines.append(f"- [{i['severity']}] {i['description']}")
        if pending_issues:
            lines.append(f"\n**待处理问题**: {len(pending_issues)} 个")
            for i in pending_issues[:5]:
                lines.append(f"- [{i['severity']}] {i['description']} (状态: {i['status']})")
            if len(pending_issues) > 5:
                lines.append(f"- ...及其他 {len(pending_issues) - 5} 个问题")
        if not new_issues and not pending_issues:
            lines.append("- 暂无重大风险")

        lines.append("")
        lines.append("## 四、下周工作计划")
        # 从最近日志中提取明日计划作为下周计划参考
        plans = [w['tomorrow_plan'] for w in work_logs if w.get('tomorrow_plan')]
        if plans:
            for p in plans[-5:]:
                lines.append(f"- {p}")
        else:
            lines.append("- 按计划推进各阶段工作")

        lines.append("")
        lines.append("## 五、需要协调事项")
        lines.append("- 待补充")

        lines.append("")
        lines.append(f"---")
        lines.append(f"*报告自动生成于 {datetime.now().strftime('%Y-%m-%d %H:%M')}*")

        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Manual trigger (called by API)
    # ------------------------------------------------------------------
    def generate_for_project(self, project_id, report_type='daily', force=False):
        """手动触发为指定项目生成报告"""
        today = datetime.now().strftime('%Y-%m-%d')

        if not force and self._has_archive(project_id, report_type, today):
            return {"exists": True, "message": f"今日{report_type}报告已存在"}

        with DatabasePool.get_connection() as conn:
            # 如果强制生成，先删除旧的
            if force:
                sql_del = DatabasePool.format_sql("DELETE FROM report_archive WHERE project_id = ? AND report_type = ? AND report_date = ?")
                conn.execute(sql_del, (project_id, report_type, today))
                conn.commit()

            sql_sel = DatabasePool.format_sql("SELECT * FROM projects WHERE id = ?")
            project = conn.execute(sql_sel, (project_id,)).fetchone()
            if not project:
                return {"error": "项目不存在"}

            if report_type == 'daily':
                content = self._build_daily_report(project_id, project, today)
            else:
                content = self._build_weekly_report(project_id, project, today)

            self._save_archive(project_id, report_type, today, content, 'manual')

        return {"success": True, "report_date": today, "report_type": report_type}


# 全局单例
report_scheduler = ReportScheduler()
