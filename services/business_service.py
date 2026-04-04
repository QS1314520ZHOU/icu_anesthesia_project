from database import DatabasePool


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
                    COALESCE(SUM(collected_amount), 0) as collected_total,
                    COALESCE(SUM(direct_cost), 0) as direct_cost_total,
                    COALESCE(SUM(labor_cost), 0) as labor_cost_total,
                    COALESCE(SUM(tax_amount), 0) as tax_total,
                    COALESCE(SUM(management_cost), 0) as management_cost_total
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

            trend_sql = DatabasePool.format_sql(f'''
                SELECT
                    metric_month,
                    COALESCE(SUM(output_value), 0) as output_value,
                    COALESCE(SUM(collected_amount), 0) as collected_amount,
                    COALESCE(SUM(direct_cost), 0) as direct_cost,
                    COALESCE(SUM(labor_cost), 0) as labor_cost,
                    COALESCE(SUM(tax_amount), 0) as tax_amount,
                    COALESCE(SUM(management_cost), 0) as management_cost
                FROM business_monthly_metrics
                {where_sql}
                GROUP BY metric_month
                ORDER BY metric_month
            ''')
            trend_rows = [dict(row) for row in conn.execute(trend_sql, params).fetchall()]
            for row in trend_rows:
                row['net_profit'] = round(
                    self._to_float(row.get('output_value'))
                    - self._to_float(row.get('direct_cost'))
                    - self._to_float(row.get('labor_cost'))
                    - self._to_float(row.get('tax_amount'))
                    - self._to_float(row.get('management_cost')),
                    2,
                )

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
                row['net_profit'] = round(
                    self._to_float(row.get('output_value'))
                    - self._to_float(row.get('direct_cost'))
                    - self._to_float(row.get('labor_cost'))
                    - self._to_float(row.get('tax_amount'))
                    - self._to_float(row.get('management_cost')),
                    2,
                )
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
                    COALESCE(SUM(m.collected_amount), 0) as collected_total,
                    COALESCE(SUM(m.direct_cost), 0) as direct_cost_total,
                    COALESCE(SUM(m.labor_cost), 0) as labor_cost_total,
                    COALESCE(SUM(m.tax_amount), 0) as tax_total,
                    COALESCE(SUM(m.management_cost), 0) as management_cost_total
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
                row['net_profit'] = round(
                    self._to_float(row.get('output_value'))
                    - self._to_float(row.get('direct_cost'))
                    - self._to_float(row.get('labor_cost'))
                    - self._to_float(row.get('tax_amount'))
                    - self._to_float(row.get('management_cost')),
                    2,
                )
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
            self._to_float(data.get('collected_amount')),
            self._to_float(data.get('direct_cost')),
            self._to_float(data.get('labor_cost')),
            self._to_float(data.get('tax_amount')),
            self._to_float(data.get('management_cost')),
            data.get('notes', ''),
        )

        with DatabasePool.get_connection() as conn:
            sql = '''
                INSERT INTO business_monthly_metrics (
                    project_id, metric_month, output_value, collected_amount,
                    direct_cost, labor_cost, tax_amount, management_cost, notes
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (project_id, metric_month) DO UPDATE SET
                    output_value = EXCLUDED.output_value,
                    collected_amount = EXCLUDED.collected_amount,
                    direct_cost = EXCLUDED.direct_cost,
                    labor_cost = EXCLUDED.labor_cost,
                    tax_amount = EXCLUDED.tax_amount,
                    management_cost = EXCLUDED.management_cost,
                    notes = EXCLUDED.notes,
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


business_service = BusinessService()
