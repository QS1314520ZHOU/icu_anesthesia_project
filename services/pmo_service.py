
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
                regional_stats = conn.execute(DatabasePool.format_sql('''
                    SELECT hospital_name as region, COUNT(*) as count, AVG(progress) as avg_progress
                    FROM projects
                    WHERE status NOT IN ('已完成', '已终止', '已验收', '质保期')
                    GROUP BY hospital_name
                ''')).fetchall()

                # 2. PM 负荷
                pm_workload = conn.execute(DatabasePool.format_sql('''
                    SELECT project_manager, COUNT(*) as count, SUM(progress)/COUNT(*) as avg_progress
                    FROM projects
                    WHERE status NOT IN ('已完成', '已终止', '已验收', '质保期')
                    GROUP BY project_manager
                    ORDER BY count DESC
                ''')).fetchall()

                # 3. 风险分布
                risk_distribution = conn.execute(DatabasePool.format_sql('''
                    SELECT severity as risk_level, COUNT(*) as count
                    FROM issues
                    WHERE status != '已解决' AND status != '已关闭'
                    GROUP BY severity
                ''')).fetchall()

                return {
                    "regional": [dict(r) for r in regional_stats],
                    "pm_workload": [dict(w) for w in pm_workload],
                    "risks": [dict(rk) for rk in risk_distribution],
                    "total_active": sum(r['count'] for r in regional_stats),
                    "portfolio_actions": PMOService.get_portfolio_actions(pm_workload, regional_stats)
                }
        except Exception as e:
            logger.error(f"Error getting PMO overview: {e}")
            return {"error": str(e)}

    @staticmethod
    def get_portfolio_actions(pm_workload, regional_stats):
        """识别组合层面的风险与建议"""
        actions = []
        
        # 1. PM 负荷预警
        for pm in pm_workload:
            if pm['count'] > 3:
                actions.append({
                    "type": "resource",
                    "priority": "High",
                    "title": f"PM 负荷超限: {pm['project_manager']}",
                    "description": f"该 PM 当前负责 {pm['count']} 个活跃项目，平均进度仅 {int(pm['avg_progress'])}%。",
                    "suggestion": "建议协调助理 PM 分担基础文档工作，或暂缓分配新项目。"
                })
        
        # 2. 区域强度预警
        for reg in regional_stats:
            if reg['count'] > 5:
                actions.append({
                    "type": "region",
                    "priority": "Medium",
                    "title": f"区域交付高压: {reg['region']}",
                    "description": f"该区域当前有 {reg['count']} 个并行项目，资源密集度极高。",
                    "suggestion": "建议在该区域建立临时交付中心，或从低负载区域调拨巡检人员。"
                })

        # 3. 总体进度滞后
        avg_total_progress = sum(r['avg_progress'] for r in regional_stats) / len(regional_stats) if regional_stats else 0
        if avg_total_progress < 30:
            actions.append({
                "type": "strategy",
                "priority": "High",
                "title": "全局进度预警",
                "description": f"全线项目平均进度仅为 {int(avg_total_progress)}%，远低于季度基准。",
                "suggestion": "建议召开全线项目冲刺动员会，并启动交付资源绿色通道。"
            })

        return actions

    @staticmethod
    def generate_pmo_summary():
        """生成 AI 管理层一页纸报告"""
        try:
            overview = PMOService.get_pmo_overview()
            
            # 基础指标
            total_projects = overview.get('total_active', 0)
            high_risks = next((r['count'] for r in overview.get('risks', []) if r['risk_level'] in ['高', '极高', '严重', '紧急']), 0)
            
            # 数据清洗：避免 AI 在报告中直接输出 None 或 '' 等技术字符串
            cleaned_regional = []
            for r in overview.get('regional', []):
                cleaned_regional.append(f"区域: {r['region'] or '未知'}, 数量: {r['count']}, 平均进度: {int(r['avg_progress'])}%")
                
            cleaned_pm = []
            for w in overview.get('pm_workload', []):
                pm_name = w['project_manager']
                if not pm_name or pm_name.lower() == 'none' or pm_name.strip() == '':
                    pm_name = "未分配负责人"
                cleaned_pm.append(f"PM: {pm_name}, 项目数: {w['count']}, 平均进度: {int(w['avg_progress'])}%")

            system_prompt = """你是一名世界顶级、极其严谨的 PMO 执行总监 (Senior Global PMO Executive)。
请根据提供的项目组合数据，生成一份极其精美、极具商业洞察的“管理层一页纸”月度执行摘要。

**格式与结构要求 (绝对禁止项)**：
1. **必须使用标准 Markdown 表格**：凡是涉及多维度对比的数据（如区域分布、PM 负荷等），必须使用 Markdown 表格格式 ( | Header | ) 输出。禁止使用简单的加粗列表代替表格。
2. **严禁使用任何形式的自定义语法**：严禁出现 `::: callout` 或类似的第三方自定义语法标签。
3. **语言风格**：严禁出现 Python 代码样式的字符串（如 project_manager = ''）。必须转换成自然的中文描述。
4. **视觉层级**：使用 H3 (###) 作为主标题，H4 (####) 作为副标题。使用 > (Blockquote) 来突出重要的洞察点。
5. **麦肯锡风格金字塔表达**：结论先行，数据支撑。
6. **Emoji 点缀**：在标题和关键段落前使用恰当的 Emoji。

**报告结构参考**：
- 🎯 **全局交付健康度** (核心 KPI 表格与总结)
- 🚨 **风险与资源瓶颈** (重点剖析高负荷区域或人员)
- 💡 **战略决策建议** (针对性的三条高管行动建议)
"""
            
            user_content = f"""
            当前系统实时拉取的数据概览如下：
            - 在研项目总数：{total_projects} 个
            - 待处理高风险项：{high_risks} 项
            - 各区域交付强度分布：{"; ".join(cleaned_regional)}
            - 各项目经理 (PM) 负荷情况：{"; ".join(cleaned_pm)}
            
            请输出精美的管理层级洞察报告（注意：绝对不要使用 ::: callout 语法）：
            """
            
            summary = ai_service.call_ai_api(system_prompt, user_content)
            
            # 后验过滤：强力剔除 AI 执意生成的 callout 标签
            if summary:
                import re
                summary = re.sub(r':::.*?(\n|$)', '', summary) # 移除 ::: callout...
                summary = re.sub(r':::(\n|$)', '', summary)    # 移除结束用的 :::
                summary = summary.strip()

            return {"summary": summary}
        except Exception as e:
            logger.error(f"Error generating PMO summary: {e}")
            return {"summary": "暂时无法生成 AI 摘要，请检查服务连接。"}

pmo_service = PMOService()
