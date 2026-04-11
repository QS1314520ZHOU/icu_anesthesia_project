from database import DatabasePool
import csv
import io
from datetime import datetime


class BusinessService:
    @staticmethod
    def _normalize_month(metric_month):
        if not metric_month:
            return None
        month = str(metric_month).strip()
        return month[:7] if len(month) >= 7 else month

    @staticmethod
    def _to_float(value):
        try:
            return float(value or 0)
        except (TypeError, ValueError):
            return 0.0

    def _calc_net_profit(self, row):
        return round(
            self._to_float(row.get('output_value'))
            - self._to_float(row.get('direct_cost'))
            - self._to_float(row.get('labor_cost'))
            - self._to_float(row.get('tax_amount'))
            - self._to_float(row.get('management_cost')),
            2,
        )

    def _definitions(self):
        return {
            'output_value_total': '累计产值：按经营月报录入的月度产值累计，不等同于合同额。',
            'collected_total': '累计回款：按经营月报录入的回款金额累计，用于经营视角分析。',
            'direct_cost_total': '直接成本：项目直接发生的采购、外包、差旅等经营成本。',
            'labor_cost_total': '人力成本：项目成员投入的人力成本，可与财务人力成本口径存在差异。',
            'tax_total': '税费：经营月报中录入的税负或相关税费估算/实际值。',
            'management_cost_total': '管理成本：管理分摊、平台分摊或后台管理成本。',
            'net_profit_total': '净利润：产值 - 直接成本 - 人力成本 - 税费 - 管理成本。',
            'net_margin': '净利率：净利润 / 产值。',
        }

    def _build_validation_summary(self, conn, project_rows):
        revenue_total = self._to_float(
            (conn.execute(DatabasePool.format_sql('SELECT COALESCE(SUM(amount), 0) as total FROM project_revenue')).fetchone()['total'])
        )
        reimbursed_total = self._to_float(
            (conn.execute(DatabasePool.format_sql("SELECT COALESCE(SUM(amount), 0) as total FROM project_expenses WHERE status = '已报销'")).fetchone()['total'])
        )
        labor_total = self._to_float(
            (conn.execute(DatabasePool.format_sql('''
                SELECT COALESCE(SUM(wl.work_hours / 8.0 * pm.daily_rate), 0) as total
                FROM work_logs wl
                JOIN project_members pm ON wl.member_id = pm.id
            ''')).fetchone()['total'])
        )

        business_collected_total = round(sum(self._to_float(row.get('collected_total')) for row in project_rows), 2)
        business_direct_cost_total = round(sum(self._to_float(row.get('direct_cost_total')) for row in project_rows), 2)
        business_labor_cost_total = round(sum(self._to_float(row.get('labor_cost_total')) for row in project_rows), 2)

        warnings = []
        if abs(business_collected_total - revenue_total) > 0.01:
            warnings.append(f'经营累计回款与财务收入存在差异：经营 {business_collected_total:.2f}，财务 {revenue_total:.2f}')
        if abs(business_labor_cost_total - labor_total) > 0.01:
            warnings.append(f'经营人力成本与财务人力成本存在差异：经营 {business_labor_cost_total:.2f}，财务 {labor_total:.2f}')
        if business_direct_cost_total < reimbursed_total:
            warnings.append(f'经营直接成本低于已报销费用：经营 {business_direct_cost_total:.2f}，财务报销 {reimbursed_total:.2f}')

        return {
            'financial_revenue_total': round(revenue_total, 2),
            'financial_reimbursed_total': round(reimbursed_total, 2),
            'financial_labor_total': round(labor_total, 2),
            'business_collected_total': business_collected_total,
            'business_direct_cost_total': business_direct_cost_total,
            'business_labor_cost_total': business_labor_cost_total,
            'warnings': warnings,
            'status': 'warning' if warnings else 'ok',
        }

    def get_overview(self, month_from=None, month_to=None):
        with DatabasePool.get_connection() as conn:
            clauses = []
            params = []
            if month_from:
                clauses.append("metric_month >= ?")
                params.append(self._normalize_month(month_from))
            if month_to:
                clauses.append("metric_month <= ?")
                params.append(self._normalize_month(month_to))

            where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""

            summary_sql = DatabasePool.format_sql(f'''
                SELECT
                    COALESCE(SUM(output_value), 0) as output_value_total,
                    COALESCE(SUM(budget_output_value), 0) as budget_output_total,
                    COALESCE(SUM(collected_amount), 0) as collected_total,
                    COALESCE(SUM(direct_cost), 0) as direct_cost_total,
                    COALESCE(SUM(labor_cost), 0) as labor_cost_total,
                    COALESCE(SUM(tax_amount), 0) as tax_total,
                    COALESCE(SUM(management_cost), 0) as management_cost_total,
                    COALESCE(SUM(budget_cost), 0) as budget_cost_total
                FROM business_monthly_metrics
                {where_sql}
            ''')
            summary = dict(conn.execute(summary_sql, params).fetchone())

            summary['net_profit_total'] = round(
                self._to_float(summary.get('output_value_total'))
                - self._to_float(summary.get('direct_cost_total'))
                - self._to_float(summary.get('labor_cost_total'))
                - self._to_float(summary.get('tax_total'))
                - self._to_float(summary.get('management_cost_total')),
                2,
            )
            summary['net_margin'] = round(
                (summary['net_profit_total'] / self._to_float(summary.get('output_value_total')) * 100)
                if self._to_float(summary.get('output_value_total')) else 0,
                2,
            )
            summary['output_variance'] = round(
                self._to_float(summary.get('output_value_total')) - self._to_float(summary.get('budget_output_total')),
                2
            )
            summary['cost_variance'] = round(
                (self._to_float(summary.get('direct_cost_total'))
                 + self._to_float(summary.get('labor_cost_total'))
                 + self._to_float(summary.get('tax_total'))
                 + self._to_float(summary.get('management_cost_total')))
                - self._to_float(summary.get('budget_cost_total')),
                2
            )

            trend_sql = DatabasePool.format_sql(f'''
                SELECT
                    metric_month,
                    COALESCE(SUM(output_value), 0) as output_value,
                    COALESCE(SUM(budget_output_value), 0) as budget_output_value,
                    COALESCE(SUM(collected_amount), 0) as collected_amount,
                    COALESCE(SUM(direct_cost), 0) as direct_cost,
                    COALESCE(SUM(labor_cost), 0) as labor_cost,
                    COALESCE(SUM(tax_amount), 0) as tax_amount,
                    COALESCE(SUM(management_cost), 0) as management_cost,
                    COALESCE(SUM(budget_cost), 0) as budget_cost
                FROM business_monthly_metrics
                {where_sql}
                GROUP BY metric_month
                ORDER BY metric_month
            ''')
            trend_rows = [dict(row) for row in conn.execute(trend_sql, params).fetchall()]
            for row in trend_rows:
                row['net_profit'] = self._calc_net_profit(row)
                row['output_variance'] = round(self._to_float(row.get('output_value')) - self._to_float(row.get('budget_output_value')), 2)

            detail_sql = DatabasePool.format_sql(f'''
                SELECT
                    m.*,
                    p.project_name,
                    p.hospital_name
                FROM business_monthly_metrics m
                JOIN projects p ON m.project_id = p.id
                {where_sql}
                ORDER BY m.metric_month DESC, m.project_id DESC
            ''')
            details = [dict(row) for row in conn.execute(detail_sql, params).fetchall()]
            for row in details:
                row['net_profit'] = self._calc_net_profit(row)
                row['net_margin'] = round(
                    (row['net_profit'] / self._to_float(row.get('output_value')) * 100)
                    if self._to_float(row.get('output_value')) else 0,
                    2,
                )

            project_summary_sql = DatabasePool.format_sql(f'''
                SELECT
                    m.project_id,
                    p.project_name,
                    p.hospital_name,
                    COALESCE(SUM(m.output_value), 0) as output_value_total,
                    COALESCE(SUM(m.budget_output_value), 0) as budget_output_total,
                    COALESCE(SUM(m.collected_amount), 0) as collected_total,
                    COALESCE(SUM(m.direct_cost), 0) as direct_cost_total,
                    COALESCE(SUM(m.labor_cost), 0) as labor_cost_total,
                    COALESCE(SUM(m.tax_amount), 0) as tax_total,
                    COALESCE(SUM(m.management_cost), 0) as management_cost_total,
                    COALESCE(SUM(m.budget_cost), 0) as budget_cost_total
                FROM business_monthly_metrics m
                JOIN projects p ON m.project_id = p.id
                {where_sql}
                GROUP BY m.project_id, p.project_name, p.hospital_name
                ORDER BY output_value_total DESC, collected_total DESC
            ''')
            project_rows = [dict(row) for row in conn.execute(project_summary_sql, params).fetchall()]
            for row in project_rows:
                row['net_profit_total'] = round(
                    self._to_float(row.get('output_value_total'))
                    - self._to_float(row.get('direct_cost_total'))
                    - self._to_float(row.get('labor_cost_total'))
                    - self._to_float(row.get('tax_total'))
                    - self._to_float(row.get('management_cost_total')),
                    2,
                )
                row['net_margin'] = round(
                    (row['net_profit_total'] / self._to_float(row.get('output_value_total')) * 100)
                    if self._to_float(row.get('output_value_total')) else 0,
                    2,
                )
                row['output_variance'] = round(self._to_float(row.get('output_value_total')) - self._to_float(row.get('budget_output_total')), 2)

            rankings = {
                'top_output_projects': sorted(project_rows, key=lambda item: item.get('output_value_total', 0), reverse=True)[:5],
                'top_profit_projects': sorted(project_rows, key=lambda item: item.get('net_profit_total', 0), reverse=True)[:5],
                'loss_projects': sorted(
                    [row for row in project_rows if row.get('net_profit_total', 0) < 0],
                    key=lambda item: item.get('net_profit_total', 0)
                )[:5],
            }

            low_margin_projects = [row for row in project_rows if row.get('output_value_total', 0) > 0 and row.get('net_margin', 0) < 10]
            risk_summary = {
                'loss_project_count': len([row for row in project_rows if row.get('net_profit_total', 0) < 0]),
                'low_margin_project_count': len(low_margin_projects),
                'top_risk_hint': '',
            }
            if rankings['loss_projects']:
                risk_summary['top_risk_hint'] = f"亏损最严重项目：{rankings['loss_projects'][0]['project_name']}"
            elif low_margin_projects:
                risk_summary['top_risk_hint'] = f"低净利项目数：{len(low_margin_projects)}，建议优先检查成本分摊"
            else:
                risk_summary['top_risk_hint'] = '当前经营结构整体稳定'

            validation = self._build_validation_summary(conn, project_rows)

            return {
                'summary': summary,
                'monthly_trend': trend_rows,
                'details': details,
                'project_summaries': project_rows,
                'rankings': rankings,
                'risk_summary': risk_summary,
                'definitions': self._definitions(),
                'validation': validation,
            }

    def list_project_metrics(self, project_id):
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('''
                SELECT *
                FROM business_monthly_metrics
                WHERE project_id = ?
                ORDER BY metric_month DESC
            ''')
            rows = [dict(row) for row in conn.execute(sql, (project_id,)).fetchall()]
            for row in rows:
                row['net_profit'] = self._calc_net_profit(row)
            return rows

    def get_project_summary(self, project_id):
        with DatabasePool.get_connection() as conn:
            project_sql = DatabasePool.format_sql('''
                SELECT id, project_name, hospital_name, contract_amount, status, progress
                FROM projects
                WHERE id = ?
            ''')
            project = conn.execute(project_sql, (project_id,)).fetchone()
            if not project:
                return None

            project = dict(project)
            metrics = self.list_project_metrics(project_id)

            summary = {
                'output_value_total': 0.0,
                'collected_total': 0.0,
                'direct_cost_total': 0.0,
                'labor_cost_total': 0.0,
                'tax_total': 0.0,
                'management_cost_total': 0.0,
                'net_profit_total': 0.0,
                'net_margin': 0.0,
            }
            for row in metrics:
                summary['output_value_total'] += self._to_float(row.get('output_value'))
                summary['collected_total'] += self._to_float(row.get('collected_amount'))
                summary['direct_cost_total'] += self._to_float(row.get('direct_cost'))
                summary['labor_cost_total'] += self._to_float(row.get('labor_cost'))
                summary['tax_total'] += self._to_float(row.get('tax_amount'))
                summary['management_cost_total'] += self._to_float(row.get('management_cost'))
                summary['net_profit_total'] += self._to_float(row.get('net_profit'))

            for key, value in list(summary.items()):
                if key != 'net_margin':
                    summary[key] = round(value, 2)
            summary['net_margin'] = round(
                (summary['net_profit_total'] / summary['output_value_total'] * 100)
                if summary['output_value_total'] else 0,
                2,
            )

            revenue_total = self._to_float(
                (conn.execute(DatabasePool.format_sql('SELECT COALESCE(SUM(amount), 0) as total FROM project_revenue WHERE project_id = ?'), (project_id,)).fetchone()['total'])
            )
            reimbursed_total = self._to_float(
                (conn.execute(DatabasePool.format_sql("SELECT COALESCE(SUM(amount), 0) as total FROM project_expenses WHERE project_id = ? AND status = '已报销'"), (project_id,)).fetchone()['total'])
            )
            labor_total = self._to_float(
                (conn.execute(DatabasePool.format_sql('''
                    SELECT COALESCE(SUM(wl.work_hours / 8.0 * pm.daily_rate), 0) as total
                    FROM work_logs wl
                    JOIN project_members pm ON wl.member_id = pm.id
                    WHERE wl.project_id = ?
                '''), (project_id,)).fetchone()['total'])
            )

            warnings = []
            if abs(summary['collected_total'] - revenue_total) > 0.01:
                warnings.append(f'经营回款与财务收入不一致：经营 {summary["collected_total"]:.2f}，财务 {revenue_total:.2f}')
            if abs(summary['labor_cost_total'] - labor_total) > 0.01:
                warnings.append(f'经营人力成本与财务人力成本不一致：经营 {summary["labor_cost_total"]:.2f}，财务 {labor_total:.2f}')
            if summary['direct_cost_total'] < reimbursed_total:
                warnings.append(f'经营直接成本低于财务已报销费用：经营 {summary["direct_cost_total"]:.2f}，财务 {reimbursed_total:.2f}')

            return {
                'project': project,
                'summary': summary,
                'monthly_metrics': metrics,
                'definitions': self._definitions(),
                'validation': {
                    'financial_revenue_total': round(revenue_total, 2),
                    'financial_reimbursed_total': round(reimbursed_total, 2),
                    'financial_labor_total': round(labor_total, 2),
                    'warnings': warnings,
                    'status': 'warning' if warnings else 'ok',
                },
            }

    def save_metric(self, project_id, data):
        metric_month = self._normalize_month(data.get('metric_month'))
        if not metric_month:
            return {'error': 'metric_month 不能为空'}

        values = (
            project_id,
            metric_month,
            self._to_float(data.get('output_value')),
            self._to_float(data.get('budget_output_value')),
            self._to_float(data.get('collected_amount')),
            self._to_float(data.get('direct_cost')),
            self._to_float(data.get('labor_cost')),
            self._to_float(data.get('tax_amount')),
            self._to_float(data.get('management_cost')),
            self._to_float(data.get('budget_cost')),
            data.get('notes', ''),
        )

        with DatabasePool.get_connection() as conn:
            sql = '''
                INSERT INTO business_monthly_metrics (
                    project_id, metric_month, output_value, budget_output_value, collected_amount,
                    direct_cost, labor_cost, tax_amount, management_cost, budget_cost, notes
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (project_id, metric_month) DO UPDATE SET
                    output_value = EXCLUDED.output_value,
                    collected_amount = EXCLUDED.collected_amount,
                    direct_cost = EXCLUDED.direct_cost,
                    labor_cost = EXCLUDED.labor_cost,
                    tax_amount = EXCLUDED.tax_amount,
                    management_cost = EXCLUDED.management_cost,
                    notes = EXCLUDED.notes,
                    budget_output_value = EXCLUDED.budget_output_value,
                    budget_cost = EXCLUDED.budget_cost,
                    updated_at = CURRENT_TIMESTAMP
            '''
            conn.execute(DatabasePool.format_sql(sql), values)
            conn.commit()
        return {'success': True}

    def delete_metric(self, metric_id):
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('DELETE FROM business_monthly_metrics WHERE id = ?')
            cursor = conn.execute(sql, (metric_id,))
            conn.commit()
            return {'success': (cursor.rowcount or 0) > 0}

    def export_csv(self, month_from=None, month_to=None):
        data = self.get_overview(month_from=month_from, month_to=month_to)
        buffer = io.StringIO()
        writer = csv.writer(buffer)

        writer.writerow(['总览指标', '值'])
        summary = data.get('summary', {})
        for key in [
            'output_value_total', 'collected_total', 'direct_cost_total', 'labor_cost_total',
            'tax_total', 'management_cost_total', 'net_profit_total', 'net_margin'
        ]:
            writer.writerow([key, summary.get(key, 0)])

        writer.writerow([])
        writer.writerow(['项目明细'])
        writer.writerow([
            'project_id', 'project_name', 'hospital_name', 'metric_month',
            'output_value', 'budget_output_value', 'collected_amount',
            'direct_cost', 'labor_cost', 'tax_amount', 'management_cost',
            'budget_cost', 'net_profit', 'net_margin'
        ])
        for row in data.get('details', []):
            writer.writerow([
                row.get('project_id'), row.get('project_name'), row.get('hospital_name'), row.get('metric_month'),
                row.get('output_value'), row.get('budget_output_value', 0), row.get('collected_amount'),
                row.get('direct_cost'), row.get('labor_cost'), row.get('tax_amount'), row.get('management_cost'),
                row.get('budget_cost', 0), row.get('net_profit'), row.get('net_margin')
            ])

        writer.writerow([])
        writer.writerow(['月度趋势'])
        writer.writerow([
            'metric_month', 'output_value', 'collected_amount', 'direct_cost',
            'labor_cost', 'tax_amount', 'management_cost', 'net_profit'
        ])
        for row in data.get('monthly_trend', []):
            writer.writerow([
                row.get('metric_month'), row.get('output_value'), row.get('collected_amount'),
                row.get('direct_cost'), row.get('labor_cost'), row.get('tax_amount'),
                row.get('management_cost'), row.get('net_profit')
            ])

        return buffer.getvalue()

    def get_receivable_watchlist(self):
        """应收催收清单：已经满足条件但尚未到账的回款节点。"""
        with DatabasePool.get_connection() as conn:
            rows = conn.execute(DatabasePool.format_sql('''
                SELECT
                    cpm.*,
                    p.project_name,
                    p.hospital_name
                FROM contract_payment_milestones cpm
                JOIN projects p ON p.id = cpm.project_id
                WHERE cpm.status IN ('待收款', '待满足条件')
                ORDER BY
                    CASE cpm.status
                        WHEN '待收款' THEN 0
                        ELSE 1
                    END,
                    cpm.plan_date ASC,
                    cpm.id ASC
            ''')).fetchall()

            result = []
            for row in rows:
                item = dict(row)
                plan_amount = self._to_float(item.get('plan_amount'))
                actual_amount = self._to_float(item.get('actual_amount'))
                item['unreceived_amount'] = round(max(plan_amount - actual_amount, 0), 2)
                result.append(item)
            return result

    def generate_collection_message(self, milestone_id, style='professional'):
        """AI 生成催收话术（professional/soft/direct）。"""
        with DatabasePool.get_connection() as conn:
            row = conn.execute(DatabasePool.format_sql('''
                SELECT
                    cpm.*,
                    p.project_name,
                    p.hospital_name,
                    p.project_manager,
                    p.contract_amount
                FROM contract_payment_milestones cpm
                JOIN projects p ON p.id = cpm.project_id
                WHERE cpm.id = ?
            '''), (milestone_id,)).fetchone()
            if not row:
                return {'error': '回款节点不存在'}
            item = dict(row)

        style = (style or 'professional').strip().lower()
        if style not in ('professional', 'soft', 'direct'):
            style = 'professional'

        prompt = f"""你是医院信息化项目经营负责人，请根据回款节点生成催收沟通话术。

输出要求：
1. 只输出正文，不要解释。
2. 长度 80-180 字。
3. 明确：节点名称、应收金额、触发条件（床位验收）、建议回款时间。
4. 风格：{style}

数据：
- 项目：{item.get('project_name')}
- 医院：{item.get('hospital_name')}
- 项目经理：{item.get('project_manager') or '未指定'}
- 节点：{item.get('milestone_name')}
- 付款条件：{item.get('payment_condition') or '按合同约定'}
- 应收金额：{item.get('plan_amount', 0)}
- 已到账：{item.get('actual_amount', 0)}
- 计划日期：{item.get('plan_date') or '未设置'}
- 触发床位数：{item.get('trigger_bed_unit_count', 0)}
- 触发比例：{item.get('trigger_percentage', 0)}%
"""
        try:
            from services.ai_service import ai_service
            content = ai_service.call_ai_api(
                "你是资深项目经营经理，擅长专业且高效的回款沟通。",
                prompt,
                task_type='analysis'
            )
            if content and 'AI服务暂时不可用' not in content:
                return {
                    'milestone_id': milestone_id,
                    'style': style,
                    'message': content.strip()
                }
        except Exception:
            pass

        # AI 不可用时的兜底模板
        plan_amount = self._to_float(item.get('plan_amount'))
        actual_amount = self._to_float(item.get('actual_amount'))
        unreceived = round(max(plan_amount - actual_amount, 0), 2)
        if style == 'soft':
            fallback = (
                f"{item.get('project_name')} 这边「{item.get('milestone_name')}」条件已经满足啦，"
                f"目前应收 {unreceived} 元。方便本周内帮我们确认一下回款安排吗？我们这边可随时补充验收资料。"
            )
        elif style == 'direct':
            fallback = (
                f"【回款提醒】{item.get('project_name')} 的「{item.get('milestone_name')}」已达付款条件，"
                f"应收 {unreceived} 元，请于本周内确认到账时间，避免影响后续资源投入。"
            )
        else:
            fallback = (
                f"关于项目「{item.get('project_name')}」{item.get('milestone_name')}节点，当前已满足合同约定的付款触发条件，"
                f"应收金额 {unreceived} 元。请协助确认回款计划及预计到账日期，我们将同步提供完整验收凭证。"
            )
        return {
            'milestone_id': milestone_id,
            'style': style,
            'message': fallback
        }

    def get_onsite_analytics(self, date_from=None, date_to=None):
        """驻场天数与差旅成本统计（人-项目双维度）。"""
        today_str = __import__('datetime').datetime.now().strftime('%Y-%m-%d')
        start = (date_from or '1970-01-01')[:10]
        end = (date_to or today_str)[:10]

        with DatabasePool.get_connection() as conn:
            members = conn.execute(DatabasePool.format_sql('''
                SELECT
                    pm.id, pm.project_id, pm.name, pm.role, pm.daily_rate, pm.join_date, pm.leave_date,
                    pm.is_onsite, pm.status,
                    p.project_name, p.hospital_name, p.project_manager
                FROM project_members pm
                JOIN projects p ON p.id = pm.project_id
                WHERE pm.status = '在岗'
            ''')).fetchall()

            # 差旅费用口径：报销状态=已报销 且费用类别/描述包含差旅关键词
            travel_rows = conn.execute(DatabasePool.format_sql('''
                SELECT
                    e.project_id,
                    COALESCE(SUM(e.amount), 0) as total
                FROM project_expenses e
                WHERE e.status = '已报销'
                  AND e.expense_date >= ?
                  AND e.expense_date <= ?
                  AND (
                        e.expense_type LIKE '%差旅%'
                        OR e.expense_type LIKE '%交通%'
                        OR e.expense_type LIKE '%住宿%'
                        OR e.description LIKE '%差旅%'
                        OR e.description LIKE '%交通%'
                        OR e.description LIKE '%住宿%'
                  )
                GROUP BY e.project_id
            '''), (start, end)).fetchall()
            travel_map = {row['project_id']: self._to_float(row['total']) for row in travel_rows}

        from datetime import datetime
        people_rows = []
        project_map = {}

        for row in members:
            item = dict(row)
            is_onsite = bool(item.get('is_onsite'))
            join_date = str(item.get('join_date') or '')[:10]
            leave_date = str(item.get('leave_date') or '')[:10]
            onsite_days = 0
            if is_onsite and join_date:
                try:
                    start_day = max(datetime.strptime(join_date, '%Y-%m-%d').date(), datetime.strptime(start, '%Y-%m-%d').date())
                    end_anchor = leave_date if leave_date else end
                    end_day = min(datetime.strptime(end_anchor, '%Y-%m-%d').date(), datetime.strptime(end, '%Y-%m-%d').date())
                    onsite_days = max((end_day - start_day).days + 1, 0)
                except Exception:
                    onsite_days = 0

            labor_estimate = round(self._to_float(item.get('daily_rate')) * onsite_days, 2)
            project_id = item.get('project_id')
            project_travel = self._to_float(travel_map.get(project_id, 0))

            people_rows.append({
                'member_id': item.get('id'),
                'member_name': item.get('name'),
                'member_role': item.get('role'),
                'project_id': project_id,
                'project_name': item.get('project_name'),
                'hospital_name': item.get('hospital_name'),
                'project_manager': item.get('project_manager'),
                'onsite_days': onsite_days,
                'daily_rate': self._to_float(item.get('daily_rate')),
                'labor_estimate': labor_estimate,
                'project_travel_cost': round(project_travel, 2),
                'travel_cost_per_onsite_day': round(project_travel / onsite_days, 2) if onsite_days > 0 else 0,
            })

            agg = project_map.get(project_id)
            if not agg:
                agg = {
                    'project_id': project_id,
                    'project_name': item.get('project_name'),
                    'hospital_name': item.get('hospital_name'),
                    'project_manager': item.get('project_manager'),
                    'member_count': 0,
                    'onsite_days_total': 0,
                    'labor_estimate_total': 0.0,
                    'travel_cost_total': round(project_travel, 2),
                }
                project_map[project_id] = agg
            agg['member_count'] += 1
            agg['onsite_days_total'] += onsite_days
            agg['labor_estimate_total'] = round(agg['labor_estimate_total'] + labor_estimate, 2)

        project_rows = []
        for _, agg in project_map.items():
            onsite_days_total = agg.get('onsite_days_total') or 0
            travel_total = self._to_float(agg.get('travel_cost_total'))
            agg['avg_travel_cost_per_day'] = round(travel_total / onsite_days_total, 2) if onsite_days_total > 0 else 0
            project_rows.append(agg)

        people_rows.sort(key=lambda x: (-(x.get('onsite_days') or 0), x.get('member_name') or ''))
        project_rows.sort(key=lambda x: (-(x.get('onsite_days_total') or 0), x.get('project_name') or ''))

        total_onsite_days = sum(r.get('onsite_days_total', 0) for r in project_rows)
        total_travel = round(sum(self._to_float(r.get('travel_cost_total')) for r in project_rows), 2)
        total_labor_estimate = round(sum(self._to_float(r.get('labor_estimate_total')) for r in project_rows), 2)

        return {
            'summary': {
                'date_from': start,
                'date_to': end,
                'project_count': len(project_rows),
                'member_count': len(people_rows),
                'onsite_days_total': total_onsite_days,
                'travel_cost_total': total_travel,
                'labor_estimate_total': total_labor_estimate,
                'avg_travel_cost_per_onsite_day': round(total_travel / total_onsite_days, 2) if total_onsite_days > 0 else 0,
            },
            'projects': project_rows,
            'people': people_rows,
        }

    def get_release_forecast(self, months=3):
        """未来N个月人员释放预测（按项目计划结束日期）。"""
        months = max(1, min(int(months or 3), 12))
        today = datetime.now().date()

        with DatabasePool.get_connection() as conn:
            rows = conn.execute(DatabasePool.format_sql('''
                SELECT
                    pm.id as member_id,
                    pm.name as member_name,
                    pm.role as member_role,
                    pm.current_city,
                    pm.status as member_status,
                    p.id as project_id,
                    p.project_name,
                    p.plan_end_date
                FROM project_members pm
                JOIN projects p ON p.id = pm.project_id
                WHERE pm.status = '在岗'
                  AND p.status NOT IN ('已完成', '已终止', '已验收', '质保期')
                  AND p.plan_end_date IS NOT NULL
            ''')).fetchall()

        buckets = {}
        people = []
        for row in rows:
            item = dict(row)
            plan_end_raw = str(item.get('plan_end_date') or '')[:10]
            if not plan_end_raw:
                continue
            try:
                plan_end = datetime.strptime(plan_end_raw, '%Y-%m-%d').date()
            except Exception:
                continue
            month_delta = (plan_end.year - today.year) * 12 + (plan_end.month - today.month)
            if month_delta < 0 or month_delta >= months:
                continue
            month_key = f"{plan_end.year:04d}-{plan_end.month:02d}"
            buckets.setdefault(month_key, [])
            person_row = {
                'member_id': item.get('member_id'),
                'member_name': item.get('member_name'),
                'member_role': item.get('member_role'),
                'current_city': item.get('current_city') or '',
                'project_id': item.get('project_id'),
                'project_name': item.get('project_name'),
                'estimated_release_date': plan_end_raw
            }
            buckets[month_key].append(person_row)
            people.append(person_row)

        timeline = []
        for i in range(months):
            year = today.year + ((today.month - 1 + i) // 12)
            month = ((today.month - 1 + i) % 12) + 1
            month_key = f"{year:04d}-{month:02d}"
            items = buckets.get(month_key, [])
            timeline.append({
                'month': month_key,
                'release_count': len(items),
                'members': sorted(items, key=lambda x: (x.get('member_name') or ''))
            })

        return {
            'months': months,
            'timeline': timeline,
            'total_release_count': len(people)
        }

    def get_profit_forecast(self, project_id=None):
        """项目利润实时预估（合同额 - 已发生成本 - 预计剩余成本）。"""
        today = datetime.now().date()
        with DatabasePool.get_connection() as conn:
            clauses = ["p.status NOT IN ('已完成', '已终止', '已验收', '质保期')"]
            params = []
            if project_id:
                clauses.append('p.id = ?')
                params.append(project_id)
            rows = conn.execute(DatabasePool.format_sql(f'''
                SELECT
                    p.id, p.project_name, p.hospital_name, p.contract_amount, p.plan_start_date, p.plan_end_date, p.status
                FROM projects p
                WHERE {' AND '.join(clauses)}
                ORDER BY p.id DESC
            '''), params).fetchall()

            result = []
            for row in rows:
                p = dict(row)
                pid = p['id']
                contract_amount = self._to_float(p.get('contract_amount'))
                spent_expense = self._to_float(conn.execute(DatabasePool.format_sql(
                    "SELECT COALESCE(SUM(amount),0) as total FROM project_expenses WHERE project_id = ? AND status = '已报销'"
                ), (pid,)).fetchone()['total'])
                spent_labor = self._to_float(conn.execute(DatabasePool.format_sql('''
                    SELECT COALESCE(SUM(wl.work_hours / 8.0 * pm.daily_rate), 0) as total
                    FROM work_logs wl
                    JOIN project_members pm ON wl.member_id = pm.id
                    WHERE wl.project_id = ?
                '''), (pid,)).fetchone()['total'])
                active_daily_rate = self._to_float(conn.execute(DatabasePool.format_sql('''
                    SELECT COALESCE(SUM(daily_rate),0) as total
                    FROM project_members
                    WHERE project_id = ? AND status = '在岗'
                '''), (pid,)).fetchone()['total'])

                remaining_days = 0
                plan_end_raw = str(p.get('plan_end_date') or '')[:10]
                if plan_end_raw:
                    try:
                        remaining_days = max((datetime.strptime(plan_end_raw, '%Y-%m-%d').date() - today).days, 0)
                    except Exception:
                        remaining_days = 0

                # 估算：未来人力成本按在岗成员日成本 * 剩余天数 * 0.7 利用系数
                est_remaining_labor = round(active_daily_rate * remaining_days * 0.7, 2)

                # 估算：未来差旅/直接成本按历史已报销的日均进行外推
                elapsed_days = 0
                plan_start_raw = str(p.get('plan_start_date') or '')[:10]
                if plan_start_raw:
                    try:
                        elapsed_days = max((today - datetime.strptime(plan_start_raw, '%Y-%m-%d').date()).days, 1)
                    except Exception:
                        elapsed_days = 1
                else:
                    elapsed_days = 1
                avg_expense_daily = spent_expense / elapsed_days if elapsed_days > 0 else 0
                est_remaining_expense = round(avg_expense_daily * remaining_days, 2)

                total_cost_est = round(spent_expense + spent_labor + est_remaining_labor + est_remaining_expense, 2)
                forecast_profit = round(contract_amount - total_cost_est, 2)
                margin = round((forecast_profit / contract_amount) * 100, 2) if contract_amount > 0 else 0
                risk_level = 'high' if forecast_profit < 0 else ('medium' if margin < 10 else 'low')

                result.append({
                    'project_id': pid,
                    'project_name': p.get('project_name'),
                    'hospital_name': p.get('hospital_name'),
                    'status': p.get('status'),
                    'contract_amount': contract_amount,
                    'spent_expense': round(spent_expense, 2),
                    'spent_labor': round(spent_labor, 2),
                    'estimated_remaining_labor': est_remaining_labor,
                    'estimated_remaining_expense': est_remaining_expense,
                    'remaining_days': remaining_days,
                    'forecast_profit': forecast_profit,
                    'forecast_margin': margin,
                    'risk_level': risk_level
                })

        summary = {
            'project_count': len(result),
            'high_risk_count': sum(1 for x in result if x.get('risk_level') == 'high'),
            'negative_profit_count': sum(1 for x in result if self._to_float(x.get('forecast_profit')) < 0),
        }
        return {'summary': summary, 'items': result}

    def list_opportunities(self, stage=None, status=None):
        with DatabasePool.get_connection() as conn:
            clauses = ['1=1']
            params = []
            if stage:
                clauses.append('stage = ?')
                params.append(stage)
            if status:
                clauses.append('status = ?')
                params.append(status)
            rows = conn.execute(DatabasePool.format_sql(f'''
                SELECT *
                FROM opportunities
                WHERE {' AND '.join(clauses)}
                ORDER BY updated_at DESC, created_at DESC
            '''), params).fetchall()
            return [dict(r) for r in rows]

    def create_opportunity(self, data):
        with DatabasePool.get_connection() as conn:
            sql = '''
                INSERT INTO opportunities (
                    hospital_name, expected_amount, expected_sign_date, stage,
                    owner, contact_person, contact_phone, remark, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            '''
            if DatabasePool.is_postgres():
                sql += ' RETURNING id'
            cur = conn.execute(DatabasePool.format_sql(sql), (
                data.get('hospital_name', ''),
                self._to_float(data.get('expected_amount')),
                data.get('expected_sign_date'),
                data.get('stage', '初步接触'),
                data.get('owner', ''),
                data.get('contact_person', ''),
                data.get('contact_phone', ''),
                data.get('remark', ''),
                data.get('status', '进行中')
            ))
            opp_id = DatabasePool.get_inserted_id(cur)
            conn.commit()
            return opp_id

    def update_opportunity(self, opp_id, data):
        with DatabasePool.get_connection() as conn:
            old = conn.execute(DatabasePool.format_sql('SELECT * FROM opportunities WHERE id = ?'), (opp_id,)).fetchone()
            if not old:
                return False
            old = dict(old)
            conn.execute(DatabasePool.format_sql('''
                UPDATE opportunities
                SET hospital_name=?, expected_amount=?, expected_sign_date=?, stage=?, owner=?,
                    contact_person=?, contact_phone=?, remark=?, status=?, updated_at=CURRENT_TIMESTAMP
                WHERE id = ?
            '''), (
                data.get('hospital_name', old.get('hospital_name')),
                self._to_float(data.get('expected_amount') if data.get('expected_amount') is not None else old.get('expected_amount')),
                data.get('expected_sign_date', old.get('expected_sign_date')),
                data.get('stage', old.get('stage')),
                data.get('owner', old.get('owner')),
                data.get('contact_person', old.get('contact_person')),
                data.get('contact_phone', old.get('contact_phone')),
                data.get('remark', old.get('remark')),
                data.get('status', old.get('status')),
                opp_id
            ))
            conn.commit()
            return True

    def delete_opportunity(self, opp_id):
        with DatabasePool.get_connection() as conn:
            cursor = conn.execute(DatabasePool.format_sql('DELETE FROM opportunities WHERE id = ?'), (opp_id,))
            conn.commit()
            return (cursor.rowcount or 0) > 0

    def get_customer_profiles(self):
        """客户画像：按医院聚合项目、合同、回款、利润、满意度与沟通频次。"""
        with DatabasePool.get_connection() as conn:
            rows = conn.execute(DatabasePool.format_sql('''
                SELECT
                    p.hospital_name,
                    COUNT(DISTINCT p.id) as project_count,
                    COALESCE(SUM(p.contract_amount), 0) as contract_total,
                    COALESCE(SUM((SELECT COALESCE(SUM(r.amount),0) FROM project_revenue r WHERE r.project_id = p.id)), 0) as collected_total,
                    COALESCE(SUM((SELECT COALESCE(SUM(e.amount),0) FROM project_expenses e WHERE e.project_id = p.id AND e.status='已报销')), 0) as reimbursed_total,
                    COALESCE(AVG((SELECT COALESCE(AVG(cs.score_overall),0) FROM customer_satisfaction cs WHERE cs.project_id = p.id)), 0) as avg_satisfaction
                FROM projects p
                WHERE p.hospital_name IS NOT NULL AND p.hospital_name != ''
                GROUP BY p.hospital_name
                ORDER BY contract_total DESC
            ''')).fetchall()

            comm_map = {}
            if DatabasePool.table_exists(conn, 'communication_logs'):
                comm_rows = conn.execute(DatabasePool.format_sql('''
                    SELECT p.hospital_name, COUNT(c.id) as comm_count
                    FROM communication_logs c
                    JOIN projects p ON p.id = c.project_id
                    GROUP BY p.hospital_name
                ''')).fetchall()
                comm_map = {r['hospital_name']: int(r['comm_count'] or 0) for r in comm_rows}

        profiles = []
        for row in rows:
            item = dict(row)
            contract_total = self._to_float(item.get('contract_total'))
            collected_total = self._to_float(item.get('collected_total'))
            reimbursed_total = self._to_float(item.get('reimbursed_total'))
            est_profit = round(collected_total - reimbursed_total, 2)
            item['estimated_profit'] = est_profit
            item['communication_count'] = comm_map.get(item.get('hospital_name'), 0)
            item['customer_level'] = (
                '战略客户' if contract_total >= 5000000 else
                '重点客户' if contract_total >= 1000000 else
                '普通客户'
            )
            item['risk_flag'] = (item.get('avg_satisfaction') or 0) < 70 or est_profit < 0
            profiles.append(item)
        profiles.sort(key=lambda x: (x.get('customer_level') != '战略客户', -(self._to_float(x.get('contract_total')))))
        return profiles

    def get_pipeline_summary(self):
        """商机管道总览：在管项目/在跟商机/本季度预计新签。"""
        now = datetime.now()
        quarter = (now.month - 1) // 3 + 1
        quarter_start_month = (quarter - 1) * 3 + 1
        quarter_end_month = quarter_start_month + 2
        quarter_start = f"{now.year:04d}-{quarter_start_month:02d}-01"
        # 粗略季度末按31号处理，日期比较在ISO字符串下可用
        quarter_end = f"{now.year:04d}-{quarter_end_month:02d}-31"

        with DatabasePool.get_connection() as conn:
            active_projects = conn.execute(DatabasePool.format_sql('''
                SELECT COUNT(*) as c
                FROM projects
                WHERE status NOT IN ('已完成', '已终止', '已验收', '质保期')
            ''')).fetchone()['c'] or 0

            opp_rows = conn.execute(DatabasePool.format_sql('''
                SELECT id, stage, status, expected_amount, expected_sign_date
                FROM opportunities
                WHERE status != '已关闭'
            ''')).fetchall()
            opp_rows = [dict(r) for r in opp_rows]

        in_progress_count = sum(1 for r in opp_rows if (r.get('status') or '进行中') in ('进行中', '跟进中'))
        quarter_amount = 0.0
        stage_dist = {}
        for row in opp_rows:
            stage = row.get('stage') or '未分类'
            stage_dist[stage] = stage_dist.get(stage, 0) + 1
            sign_date = str(row.get('expected_sign_date') or '')[:10]
            if sign_date and quarter_start <= sign_date <= quarter_end:
                quarter_amount += self._to_float(row.get('expected_amount'))

        stage_list = [{'stage': k, 'count': v} for k, v in sorted(stage_dist.items(), key=lambda x: (-x[1], x[0]))]
        return {
            'active_project_count': int(active_projects),
            'active_opportunity_count': int(in_progress_count),
            'quarter_expected_sign_amount': round(quarter_amount, 2),
            'quarter': f"{now.year}Q{quarter}",
            'stage_distribution': stage_list
        }


business_service = BusinessService()
