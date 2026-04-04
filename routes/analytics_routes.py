import logging
from flask import Blueprint, request
from api_utils import api_response
from services.analytics_service import analytics_service

analytics_bp = Blueprint('analytics', __name__)
logger = logging.getLogger(__name__)


@analytics_bp.route('/api/dashboard/stats', methods=['GET'])
def get_dashboard_stats():
    """获取仪表盘统计数据"""
    try:
        return api_response(True, data=analytics_service.get_dashboard_stats())
    except Exception as e:
        logger.exception("Dashboard Stats Error")
        return api_response(False, message=str(e), code=500)


@analytics_bp.route('/api/analytics/overview', methods=['GET'])
def get_analytics_overview():
    try:
        return api_response(True, data=analytics_service.get_analytics_overview())
    except Exception as e:
        logger.exception("Analytics Overview Error")
        return api_response(False, message=str(e), code=500)


@analytics_bp.route('/api/analytics/compare', methods=['POST'])
def compare_projects():
    try:
        data = request.json or {}
        project_ids = data.get('project_ids', [])
        return api_response(True, data=analytics_service.compare_projects(project_ids))
    except Exception as e:
        logger.exception("Compare Projects Error")
        return api_response(False, message=str(e), code=500)


@analytics_bp.route('/api/analytics/trend', methods=['GET'])
def get_trend_analysis():
    try:
        project_id = request.args.get('project_id', type=int)
        days = request.args.get('days', 30, type=int)
        return api_response(True, data=analytics_service.get_trend_data(project_id, days))
    except Exception as e:
        logger.exception("Trend Analysis Error")
        return api_response(False, message=str(e), code=500)


@analytics_bp.route('/api/projects/<int:project_id>/health', methods=['GET'])
def get_project_health(project_id):
    try:
        return api_response(True, data=analytics_service.get_project_health_score(project_id))
    except Exception as e:
        logger.exception("Project Health Error")
        return api_response(False, message=str(e), code=500)


@analytics_bp.route('/api/analytics/geo', methods=['GET'])
def get_projects_geo():
    try:
        return api_response(True, data=analytics_service.get_geo_stats())
    except Exception as e:
        logger.exception("Geo Stats Error")
        return api_response(False, message=str(e), code=500)


@analytics_bp.route('/api/analytics/workload', methods=['GET'])
def get_workload_analytics():
    try:
        return api_response(True, data=analytics_service.get_workload_stats())
    except Exception as e:
        logger.exception("Workload Analytics Error")
        return api_response(False, message=str(e), code=500)


@analytics_bp.route('/api/dashboard/global-briefing', methods=['GET'])
def get_global_briefing():
    try:
        from services.standup_service import standup_service
        result = standup_service.generate_daily_briefing()
        return api_response(True, data={'brief': result['briefing'], 'stats': result.get('stats')})
    except Exception as e:
        logger.exception("Global Briefing Error")
        return api_response(False, message=str(e), code=500)


@analytics_bp.route('/api/projects/<int:project_id>/burndown', methods=['GET'])
def get_burndown_data(project_id):
    try:
        return api_response(True, data=analytics_service.get_burndown_data(project_id))
    except Exception as e:
        logger.exception("Burndown Data Error")
        return api_response(False, message=str(e), code=500)


@analytics_bp.route('/api/analytics/gantt', methods=['GET'])
def get_all_gantt_data():
    try:
        return api_response(True, data=analytics_service.get_all_gantt_data())
    except Exception as e:
        logger.exception("Gantt Data Error")
        return api_response(False, message=str(e), code=500)


@analytics_bp.route('/api/analytics/performance', methods=['GET'])
def get_performance_analytics():
    try:
        return api_response(True, data=analytics_service.get_performance_analytics())
    except Exception as e:
        logger.exception("Performance Analytics Error")
        return api_response(False, message=str(e), code=500)
