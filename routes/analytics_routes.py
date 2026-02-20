# routes/analytics_routes.py
from flask import Blueprint, request, jsonify
from services.analytics_service import analytics_service
from utils.response_utils import api_response

analytics_bp = Blueprint('analytics', __name__)

@analytics_bp.route('/api/dashboard/stats', methods=['GET'])
def get_dashboard_stats():
    """获取仪表盘统计数据"""
    try:
        return jsonify(analytics_service.get_dashboard_stats())
    except Exception as e:
        print(f"Dashboard Stats Error: {e}")
        return jsonify({'error': str(e), 'stats': {}, 'projects_progress': [], 'upcoming_reminders': []}), 500

@analytics_bp.route('/api/analytics/overview', methods=['GET'])
def get_analytics_overview():
    try:
        return jsonify(analytics_service.get_analytics_overview())
    except Exception as e:
        print(f"Analytics Overview Error: {e}")
        return jsonify({'error': str(e), 'project_stats': {}, 'issue_stats': {}, 'by_province': [], 'task_trend': []}), 500

@analytics_bp.route('/api/analytics/compare', methods=['POST'])
def compare_projects():
    try:
        data = request.json
        project_ids = data.get('project_ids', [])
        return jsonify(analytics_service.compare_projects(project_ids))
    except Exception as e:
        print(f"Compare Projects Error: {e}")
        return jsonify({'error': str(e)}), 500

@analytics_bp.route('/api/analytics/trend', methods=['GET'])
def get_trend_analysis():
    try:
        project_id = request.args.get('project_id', type=int)
        days = request.args.get('days', 30, type=int)
        return jsonify(analytics_service.get_trend_data(project_id, days))
    except Exception as e:
        print(f"Trend Analysis Error: {e}")
        return jsonify({'error': str(e), 'progress_trend': [], 'workload_trend': []}), 500

@analytics_bp.route('/api/projects/<int:project_id>/health', methods=['GET'])
def get_project_health(project_id):
    try:
        return jsonify(analytics_service.get_project_health_score(project_id))
    except Exception as e:
        print(f"Project Health Error: {e}")
        return jsonify({'error': str(e), 'score': 0, 'factors': []}), 500

@analytics_bp.route('/api/analytics/geo', methods=['GET'])
def get_projects_geo():
    try:
        return jsonify(analytics_service.get_geo_stats())
    except Exception as e:
        print(f"Geo Stats Error: {e}")
        return jsonify({'error': str(e), 'stats': [], 'members': []}), 500

@analytics_bp.route('/api/analytics/workload', methods=['GET'])
def get_workload_analytics():
    try:
        return jsonify(analytics_service.get_workload_stats())
    except Exception as e:
        print(f"Workload Analytics Error: {e}")
        return jsonify({'error': str(e), 'workload': [], 'risk_distribution': []}), 500

@analytics_bp.route('/api/dashboard/global-briefing', methods=['GET'])
def get_global_briefing():
    try:
        from services.standup_service import standup_service
        result = standup_service.generate_daily_briefing()
        # 兼容前端 dashboard 需要的 'brief' 字段
        return jsonify({
            'brief': result['briefing'],
            'stats': result.get('stats'),
            'success': True
        })
    except Exception as e:
        print(f"Global Briefing Error: {e}")
        return jsonify({'error': str(e), 'brief': '无法加载AI简报'}), 500

@analytics_bp.route('/api/projects/<int:project_id>/burndown', methods=['GET'])
def get_burndown_data(project_id):
    try:
        return jsonify(analytics_service.get_burndown_data(project_id))
    except Exception as e:
        print(f"Burndown Data Error: {e}")
        return jsonify({'error': str(e), 'history': []}), 500

@analytics_bp.route('/api/analytics/gantt', methods=['GET'])
def get_all_gantt_data():
    try:
        return jsonify(analytics_service.get_all_gantt_data())
    except Exception as e:
        print(f"Gantt Data Error: {e}")
        return jsonify({'error': str(e)}), 500

@analytics_bp.route('/api/analytics/performance', methods=['GET'])
def get_performance_analytics():
    try:
        return jsonify(analytics_service.get_performance_analytics())
    except Exception as e:
        print(f"Performance Analytics Error: {e}")
        return jsonify({'error': str(e)}), 500
