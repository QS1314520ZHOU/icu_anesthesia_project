
from database import DatabasePool
import logging

logger = logging.getLogger(__name__)

class FinancialService:
    @staticmethod
    def get_project_financials(project_id):
        """获取项目财务汇总数据"""
        try:
            with DatabasePool.get_connection() as conn:
                # 1. 总收入 (Revenue)
                revenue_total = conn.execute('SELECT SUM(amount) as total FROM project_revenue WHERE project_id = ?', (project_id,)).fetchone()['total'] or 0
                
                # 2. 人力成本 (Labor Cost)
                # 计算公式: 工时 / 8 * 成员日人天成本
                labor_cost = conn.execute('''
                    SELECT SUM(wl.work_hours / 8.0 * pm.daily_rate) as total
                    FROM work_logs wl
                    JOIN project_members pm ON wl.member_id = pm.id
                    WHERE wl.project_id = ?
                ''', (project_id,)).fetchone()['total'] or 0
                
                # 3. 直接支出 (Expenses)
                expenses_total = conn.execute('SELECT SUM(amount) as total FROM project_expenses WHERE project_id = ? AND status = "已批准"', (project_id,)).fetchone()['total'] or 0
                
                # 4. 计算毛利
                gross_profit = revenue_total - labor_cost - expenses_total
                
                return {
                    "project_id": project_id,
                    "revenue": round(revenue_total, 2),
                    "labor_cost": round(labor_cost, 2),
                    "expenses": round(expenses_total, 2),
                    "gross_profit": round(gross_profit, 2),
                    "margin": round((gross_profit / revenue_total * 100), 2) if revenue_total > 0 else 0,
                    "waterfall_data": [
                        {"name": "总收入", "value": revenue_total},
                        {"name": "人力成本", "value": -labor_cost},
                        {"name": "报销支出", "value": -expenses_total},
                        {"name": "项目毛利", "value": gross_profit, "isTotal": True}
                    ]
                }
        except Exception as e:
            logger.error(f"Error calculating financials for project {project_id}: {e}")
            return {"error": str(e)}

    @staticmethod
    def get_member_costs(project_id):
        """获取项目成员成本分布"""
        try:
            with DatabasePool.get_connection() as conn:
                costs = conn.execute('''
                    SELECT pm.name, SUM(wl.work_hours / 8.0 * pm.daily_rate) as cost
                    FROM work_logs wl
                    JOIN project_members pm ON wl.member_id = pm.id
                    WHERE wl.project_id = ?
                    GROUP BY pm.id
                    ORDER BY cost DESC
                ''', (project_id,)).fetchall()
                return [dict(row) for row in costs]
        except Exception as e:
            logger.error(f"Error getting member costs for project {project_id}: {e}")
            return []

    @staticmethod
    def add_revenue(project_id, amount, revenue_date, revenue_type, description):
        """添加项目收入记录"""
        try:
            with DatabasePool.get_connection() as conn:
                conn.execute('''
                    INSERT INTO project_revenue (project_id, amount, revenue_date, revenue_type, description)
                    VALUES (?, ?, ?, ?, ?)
                ''', (project_id, amount, revenue_date, revenue_type, description))
                return {"success": True}
        except Exception as e:
            logger.error(f"Error adding revenue for project {project_id}: {e}")
            return {"error": str(e)}

financial_service = FinancialService()
