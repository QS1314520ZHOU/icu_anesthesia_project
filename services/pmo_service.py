
from database import DatabasePool
import logging
from services.ai_service import ai_service

logger = logging.getLogger(__name__)

class PMOService:
    @staticmethod
    def get_pmo_overview():
        """获取 PMO 全局看板概报数据"""
        try:
            with DatabasePool.get_connection() as conn:
                # 1. 区域分布 (基于医院名称前缀或行政区划，这里简单按医院名分组)
                regional_stats = conn.execute('''
                    SELECT hospital_name as region, COUNT(*) as count, AVG(progress) as avg_progress
                    FROM projects
                    WHERE status != "已结项"
                    GROUP BY hospital_name
                ''').fetchall()

                # 2. PM 负荷
                pm_workload = conn.execute('''
                    SELECT project_manager, COUNT(*) as count, SUM(progress)/COUNT(*) as avg_progress
                    FROM projects
                    WHERE status != "已结项"
                    GROUP BY project_manager
                    ORDER BY count DESC
                ''').fetchall()

                # 3. 风险分布
                risk_distribution = conn.execute('''
                    SELECT severity as risk_level, COUNT(*) as count
                    FROM issues
                    WHERE status != "已解决" AND status != "已关闭"
                    GROUP BY severity
                ''').fetchall()

                return {
                    "regional": [dict(r) for r in regional_stats],
                    "pm_workload": [dict(w) for w in pm_workload],
                    "risks": [dict(rk) for rk in risk_distribution],
                    "total_active": sum(r['count'] for r in regional_stats)
                }
        except Exception as e:
            logger.error(f"Error getting PMO overview: {e}")
            return {"error": str(e)}

    @staticmethod
    def generate_pmo_summary():
        """生成 AI 管理层一页纸报告"""
        try:
            overview = PMOService.get_pmo_overview()
            
            # 基础指标
            total_projects = overview.get('total_active', 0)
            high_risks = next((r['count'] for r in overview.get('risks', []) if r['risk_level'] in ['高', '极高', '严重', '紧急']), 0)
            
            system_prompt = """你是一名世界顶级的 PMO 执行总监 (Senior Global PMO Executive)。
请根据提供的项目组合数据，生成一份极其精美、极具商业洞察的“管理层一页纸”月度执行摘要。

**格式与审美要求 (CRITICAL)**：
1. **排版精美**：充分利用 Markdown 的视觉层级。使用 H3 (###) 作为主标题，H4 (####) 作为副标题。
2. **麦肯锡风格金字塔表达**：结论先行，数据支撑。
3. **视觉高亮**：对[高风险数值]、[关键瓶颈项目]等核心数据使用 **加粗** 或 `高亮`。
4. **Emoji 点缀**：在标题和关键段落前使用恰当的 Emoji (如 🎯, 🚨, 💡, 📊) 提升阅读体验。
5. **摒弃枯燥的平铺直叙**：不要仅仅罗列原始数据字典，必须将其转化为“业务洞察”和“高管建议”。

**报告结构参考**：
- 🎯 **全局交付健康度** (核心结论与 KPI 总结)
- 🚨 **高风险与资源瓶颈** (剖析区域或人员负荷超载情况)
- 💡 **PMO 战略破局建议** (针对性的三条高管行动建议，需落地且专业)
"""
            
            user_content = f"""
            当前系统实时拉取的数据概览如下：
            - 在研项目总数：{total_projects} 个
            - 待处理高风险项：{high_risks} 项
            - 各区域交付强度分布 (Region / Count / Avg Progress)：{overview.get('regional')}
            - 各项目经理 (PM) 负荷情况：{overview.get('pm_workload')}
            
            请输出精美的管理层级洞察报告：
            """
            
            summary = ai_service.call_ai_api(system_prompt, user_content)
            return {"summary": summary}
        except Exception as e:
            logger.error(f"Error generating PMO summary: {e}")
            return {"summary": "暂时无法生成 AI 摘要，请检查服务连接。"}

pmo_service = PMOService()
