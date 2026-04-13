import os

from flask import Blueprint, Response, request, send_file

from api_utils import api_response
from database import DatabasePool
from services.auth_service import auth_service
from services.performance_review_service import performance_review_service


performance_review_bp = Blueprint('performance_review', __name__, url_prefix='/api/performance/reviews')


def _current_user():
    return getattr(request, 'current_user', None) or {}


def _ensure_project_access(project_id: int):
    user = _current_user()
    if not user:
        raise PermissionError('未登录')
    if not project_id:
        raise PermissionError('缺少 project_id')
    if user.get('role') == 'admin':
        return
    if not auth_service.can_access_project(user.get('id'), project_id):
        raise PermissionError('当前账号无权访问该项目')


def _load_project_id_from_scorecard(scorecard_id: int) -> int:
    with DatabasePool.get_connection() as conn:
        row = conn.execute(DatabasePool.format_sql('SELECT project_id FROM performance_score_cards WHERE id = ?'), (scorecard_id,)).fetchone()
        return int(row['project_id']) if row and row.get('project_id') else 0


def _load_project_id_from_appeal(appeal_id: int) -> int:
    with DatabasePool.get_connection() as conn:
        row = conn.execute(DatabasePool.format_sql('''
            SELECT s.project_id
            FROM performance_appeals a
            JOIN performance_score_cards s ON s.id = a.scorecard_id
            WHERE a.id = ?
        '''), (appeal_id,)).fetchone()
        return int(row['project_id']) if row and row.get('project_id') else 0


@performance_review_bp.route('/overview', methods=['GET'])
def get_performance_review_overview():
    try:
        cycle_id = request.args.get('cycle_id', type=int)
        project_id = request.args.get('project_id', type=int)
        ref_date = request.args.get('date')
        _ensure_project_access(project_id)
        data = performance_review_service.get_overview(cycle_id=cycle_id, ref_date=ref_date, project_id=project_id, current_user=_current_user())
        return api_response(True, data=data)
    except PermissionError as e:
        return api_response(False, message=str(e), code=403)
    except Exception as e:
        return api_response(False, message=str(e), code=500)


@performance_review_bp.route('/cycles', methods=['GET'])
def list_performance_review_cycles():
    try:
        data = performance_review_service.list_cycles()
        return api_response(True, data=data)
    except Exception as e:
        return api_response(False, message=str(e), code=500)


@performance_review_bp.route('/cycles/ensure', methods=['POST'])
def ensure_performance_review_cycle():
    try:
        data = request.json or {}
        cycle = performance_review_service.ensure_cycle(
            ref_date=data.get('date'),
            operator=_current_user().get('display_name') or _current_user().get('username'),
        )
        performance_review_service.rebuild_cycle(cycle['id'], use_ai=True, operator=_current_user().get('display_name') or _current_user().get('username'))
        return api_response(True, data=cycle)
    except Exception as e:
        return api_response(False, message=str(e), code=500)


@performance_review_bp.route('/cycles/<int:cycle_id>/rebuild', methods=['POST'])
def rebuild_performance_review_cycle(cycle_id):
    try:
        payload = request.json or {}
        _ensure_project_access(int(payload.get('project_id') or 0))
        result = performance_review_service.rebuild_cycle(
            cycle_id,
            use_ai=payload.get('use_ai', True),
            operator=_current_user().get('display_name') or _current_user().get('username'),
            project_id=payload.get('project_id'),
        )
        return api_response(True, data=result)
    except PermissionError as e:
        return api_response(False, message=str(e), code=403)
    except Exception as e:
        return api_response(False, message=str(e), code=500)


@performance_review_bp.route('/forms', methods=['POST'])
def save_performance_review_form():
    try:
        data = request.json or {}
        cycle_id = int(data.get('cycle_id') or 0)
        target_id = int(data.get('target_id') or 0)
        if not cycle_id or not target_id:
            return api_response(False, message='缺少 cycle_id 或 target_id', code=400)
        result = performance_review_service.save_review_form(cycle_id, target_id, data, _current_user())
        return api_response(True, data=result)
    except ValueError as e:
        return api_response(False, message=str(e), code=400)
    except Exception as e:
        return api_response(False, message=str(e), code=500)


@performance_review_bp.route('/recognitions', methods=['POST'])
def add_performance_recognition():
    try:
        data = request.json or {}
        cycle_id = int(data.get('cycle_id') or 0)
        target_id = int(data.get('target_id') or 0)
        if not cycle_id or not target_id:
            return api_response(False, message='缺少 cycle_id 或 target_id', code=400)
        result = performance_review_service.add_recognition(cycle_id, target_id, data, _current_user())
        return api_response(True, data=result)
    except ValueError as e:
        return api_response(False, message=str(e), code=400)
    except Exception as e:
        return api_response(False, message=str(e), code=500)


@performance_review_bp.route('/scorecards/<int:scorecard_id>/calibrate', methods=['POST'])
def calibrate_performance_scorecard(scorecard_id):
    try:
        _ensure_project_access(_load_project_id_from_scorecard(scorecard_id))
        result = performance_review_service.calibrate_scorecard(scorecard_id, request.json or {}, _current_user())
        return api_response(True, data=result)
    except PermissionError as e:
        return api_response(False, message=str(e), code=403)
    except ValueError as e:
        return api_response(False, message=str(e), code=400)
    except Exception as e:
        return api_response(False, message=str(e), code=500)


@performance_review_bp.route('/scorecards/<int:scorecard_id>/approve', methods=['POST'])
def approve_performance_scorecard(scorecard_id):
    try:
        _ensure_project_access(_load_project_id_from_scorecard(scorecard_id))
        result = performance_review_service.approve_scorecard(scorecard_id, _current_user())
        return api_response(True, data=result)
    except PermissionError as e:
        return api_response(False, message=str(e), code=403)
    except ValueError as e:
        return api_response(False, message=str(e), code=400)
    except Exception as e:
        return api_response(False, message=str(e), code=500)


@performance_review_bp.route('/trend', methods=['GET'])
def get_performance_member_trend():
    try:
        project_id = request.args.get('project_id', type=int)
        member_name = request.args.get('member_name', '').strip()
        limit = request.args.get('limit', 12, type=int)
        if not project_id or not member_name:
            return api_response(False, message='缺少 project_id 或 member_name', code=400)
        _ensure_project_access(project_id)
        data = performance_review_service.get_member_trend(project_id, member_name, limit=limit)
        return api_response(True, data=data)
    except PermissionError as e:
        return api_response(False, message=str(e), code=403)
    except ValueError as e:
        return api_response(False, message=str(e), code=400)
    except Exception as e:
        return api_response(False, message=str(e), code=500)


@performance_review_bp.route('/scorecards/<int:scorecard_id>/appeals', methods=['POST'])
def submit_performance_appeal(scorecard_id):
    try:
        _ensure_project_access(_load_project_id_from_scorecard(scorecard_id))
        result = performance_review_service.submit_appeal(scorecard_id, request.json or {}, _current_user())
        return api_response(True, data=result)
    except PermissionError as e:
        return api_response(False, message=str(e), code=403)
    except ValueError as e:
        return api_response(False, message=str(e), code=400)
    except Exception as e:
        return api_response(False, message=str(e), code=500)


@performance_review_bp.route('/appeals/<int:appeal_id>/resolve', methods=['POST'])
def resolve_performance_appeal(appeal_id):
    try:
        _ensure_project_access(_load_project_id_from_appeal(appeal_id))
        result = performance_review_service.resolve_appeal(appeal_id, request.json or {}, _current_user())
        return api_response(True, data=result)
    except PermissionError as e:
        return api_response(False, message=str(e), code=403)
    except ValueError as e:
        return api_response(False, message=str(e), code=400)
    except Exception as e:
        return api_response(False, message=str(e), code=500)


@performance_review_bp.route('/team-trend', methods=['GET'])
def get_performance_team_trend():
    try:
        project_id = request.args.get('project_id', type=int)
        limit = request.args.get('limit', 12, type=int)
        _ensure_project_access(project_id)
        data = performance_review_service.get_team_trend(project_id=project_id, limit=limit)
        return api_response(True, data=data)
    except PermissionError as e:
        return api_response(False, message=str(e), code=403)
    except ValueError as e:
        return api_response(False, message=str(e), code=400)
    except Exception as e:
        return api_response(False, message=str(e), code=500)


@performance_review_bp.route('/profile', methods=['GET'])
def get_performance_member_profile():
    try:
        project_id = request.args.get('project_id', type=int)
        member_name = request.args.get('member_name', '').strip()
        if not project_id or not member_name:
            return api_response(False, message='缺少 project_id 或 member_name', code=400)
        _ensure_project_access(project_id)
        data = performance_review_service.get_member_profile(project_id, member_name)
        return api_response(True, data=data)
    except PermissionError as e:
        return api_response(False, message=str(e), code=403)
    except ValueError as e:
        return api_response(False, message=str(e), code=400)
    except Exception as e:
        return api_response(False, message=str(e), code=500)


@performance_review_bp.route('/cycles/<int:cycle_id>/status', methods=['POST'])
def update_performance_cycle_status(cycle_id):
    try:
        result = performance_review_service.update_cycle_status(cycle_id, (request.json or {}).get('status'), _current_user())
        return api_response(True, data=result)
    except ValueError as e:
        return api_response(False, message=str(e), code=400)
    except Exception as e:
        return api_response(False, message=str(e), code=500)


@performance_review_bp.route('/cycles/<int:cycle_id>/notify', methods=['POST'])
def send_performance_cycle_notifications(cycle_id):
    try:
        payload = request.json or {}
        project_id = int(payload.get('project_id') or 0)
        if not project_id:
            return api_response(False, message='缺少 project_id', code=400)
        _ensure_project_access(project_id)
        result = performance_review_service.send_project_review_reminders(cycle_id, project_id, _current_user())
        return api_response(True, data=result)
    except PermissionError as e:
        return api_response(False, message=str(e), code=403)
    except ValueError as e:
        return api_response(False, message=str(e), code=400)
    except Exception as e:
        return api_response(False, message=str(e), code=500)


@performance_review_bp.route('/cycles/<int:cycle_id>/export', methods=['GET'])
def export_performance_cycle(cycle_id):
    try:
        fmt = request.args.get('format', 'docx').strip().lower()
        project_id = request.args.get('project_id', type=int)
        _ensure_project_access(project_id)
        if fmt == 'md':
            result = performance_review_service.export_cycle_markdown(cycle_id, _current_user(), project_id=project_id)
            return Response(
                result['content'],
                mimetype='text/markdown; charset=utf-8',
                headers={
                    'Content-Disposition': f'attachment; filename="{result["filename"]}"'
                }
            )
        file_path = performance_review_service.export_cycle_docx(cycle_id, _current_user(), project_id=project_id)
        return send_file(file_path, as_attachment=True, download_name=os.path.basename(file_path))
    except PermissionError as e:
        return api_response(False, message=str(e), code=403)
    except ValueError as e:
        return api_response(False, message=str(e), code=400)
    except Exception as e:
        return api_response(False, message=str(e), code=500)


@performance_review_bp.route('/profile/export', methods=['GET'])
def export_performance_profile():
    try:
        project_id = request.args.get('project_id', type=int)
        member_name = request.args.get('member_name', '').strip()
        if not project_id or not member_name:
            return api_response(False, message='缺少 project_id 或 member_name', code=400)
        _ensure_project_access(project_id)
        file_path = performance_review_service.export_member_profile_docx(project_id, member_name)
        return send_file(file_path, as_attachment=True, download_name=os.path.basename(file_path))
    except PermissionError as e:
        return api_response(False, message=str(e), code=403)
    except ValueError as e:
        return api_response(False, message=str(e), code=400)
    except Exception as e:
        return api_response(False, message=str(e), code=500)
