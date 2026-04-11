from flask import Flask, render_template, request, jsonify, send_file, make_response, send_from_directory, session
import logging
import traceback
import re
# Force reload
# reload_trigger_1
import requests
import json
import time
import smtplib
import hashlib
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta
from threading import Thread, Lock
from werkzeug.utils import secure_filename
from werkzeug.exceptions import HTTPException
from ai_config import AI_CONFIG, get_model_config, switch_to_backup_api
from database import DatabasePool, close_db, DB_INTEGRITY_ERRORS, DB_OPERATIONAL_ERRORS
from db_init import init_db, reload_notification_config, migrate_to_dynamic_milestones, allowed_file
from api_utils import api_response, validate_json, cached, SafeJSONEncoder
from concurrent.futures import ThreadPoolExecutor
import uuid
from storage_service import storage_service
from services.kb_service import kb_service

app = Flask(__name__)
app.json_encoder = SafeJSONEncoder
app.config['PROPAGATE_EXCEPTIONS'] = False
app.teardown_appcontext(close_db)

# 注册蓝图
@app.route('/debug/routes')
def list_routes():
    import urllib
    output = []
    for rule in app.url_map.iter_rules():
        methods = ','.join(rule.methods)
        line = urllib.parse.unquote("{:50s} {:20s} {}".format(rule.endpoint, methods, rule))
        output.append(line)
    return "<pre>" + "\n".join(output) + "</pre>"

@app.route('/debug/wecom-logs')
def debug_wecom_logs():
    try:
        with DatabasePool.get_connection() as conn:
            logs = conn.execute(DatabasePool.format_sql('SELECT * FROM wecom_debug_logs ORDER BY id DESC LIMIT 20')).fetchall()
            return jsonify([dict(l) for l in logs])
    except Exception as e:
        return str(e), 500

@app.route('/debug/static-info')
def debug_static_info():
    import os
    static_dir = os.path.join(app.root_path, 'static')
    js_dir = os.path.join(static_dir, 'js')
    
    info = {
        'root_path': app.root_path,
        'static_exists': os.path.exists(static_dir),
        'js_exists': os.path.exists(js_dir),
        'js_files': os.listdir(js_dir) if os.path.exists(js_dir) else []
    }
    return jsonify(info)

@app.route('/api/force_static/<path:filename>')
def force_static(filename):
    static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static')
    return send_from_directory(static_dir, filename)
@app.route('/WW_verify_qbEX7XXnUe5licTo.txt')
def wecom_verify_file():
    return send_from_directory('.', 'WW_verify_qbEX7XXnUe5licTo.txt')

from routes.alignment_routes import alignment_bp
from routes.project_routes import project_bp
from routes.member_routes import member_bp
from routes.log_routes import log_bp
from routes.doc_routes import doc_bp
from routes.lifecycle_routes import lifecycle_bp
from routes.task_routes import task_bp
from routes.analytics_routes import analytics_bp
from routes.monitor_routes import monitor_bp
from routes.standup_routes import standup_bp
from routes.gantt_routes import gantt_bp
from routes.ai_insight_routes import ai_insight_bp
from services.project_service import project_service
from services.ai_service import ai_service
from routes.nl_query_routes import nl_query_bp
from routes.financial_routes import financial_bp
from routes.pmo_routes import pmo_bp
from routes.report_routes import report_bp
from routes.risk_simulation_routes import risk_bp
from routes.collaboration_routes import collab_bp
from routes.operational_routes import operational_bp
from routes.interface_spec_routes import spec_bp
from routes.wecom_routes import wecom_bp
from routes.form_generator_routes import form_generator_bp
from routes.mobile_routes import mobile_bp
from routes.hardware_routes import hardware_bp
from routes.communication_routes import communication_bp
from routes.business_routes import business_bp
from services.analytics_service import analytics_service
from services.monitor_service import monitor_service
from services.auth_service import auth_service
from ai_utils import call_ai
from app_config import NOTIFICATION_CONFIG, PROJECT_STATUS, PROJECT_TEMPLATES
app.register_blueprint(alignment_bp)
app.register_blueprint(project_bp)
app.register_blueprint(member_bp)
app.register_blueprint(log_bp)
app.register_blueprint(doc_bp)
app.register_blueprint(lifecycle_bp)
app.register_blueprint(task_bp)
app.register_blueprint(analytics_bp)
app.register_blueprint(monitor_bp)
app.register_blueprint(standup_bp)
app.register_blueprint(gantt_bp)
app.register_blueprint(ai_insight_bp)
app.register_blueprint(nl_query_bp)
app.register_blueprint(financial_bp)
app.register_blueprint(pmo_bp)
app.register_blueprint(report_bp)
app.register_blueprint(risk_bp)
app.register_blueprint(collab_bp)
app.register_blueprint(operational_bp)
app.register_blueprint(spec_bp)
app.register_blueprint(wecom_bp)
app.register_blueprint(form_generator_bp, url_prefix='/api/form-generator')
app.register_blueprint(mobile_bp)
app.register_blueprint(hardware_bp)
app.register_blueprint(communication_bp)
app.register_blueprint(business_bp)
from services.scheduler_service import report_scheduler


@app.before_request
def require_global_auth():
    path = request.path or '/'
    whitelist_prefixes = [
        '/static/',
        '/api/force_static/',
        '/api/auth/login',
        '/api/auth/register',
        '/api/auth/me',
        '/api/auth/logout',
        '/health',
        '/m',
        '/alignment',
        '/api/alignment',
        '/api/wecom/',
    ]
    whitelist_exact = {
        '/',
        '/api/force_static',
        '/favicon.ico',
        '/WW_verify_qbEX7XXnUe5licTo.txt',
    }

    if path in whitelist_exact or any(path.startswith(prefix) for prefix in whitelist_prefixes):
        return None

    if request.method == 'OPTIONS':
        return None

    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        token = request.cookies.get('auth_token')

    silent_401_prefixes = [
        '/api/notifications/unread-count',
        '/api/reminders/digest',
        '/api/warnings/count',
        '/api/check-and-create-reminders',
        '/api/ai/health',
    ]

    user = auth_service.validate_token(token)
    if not user:
        is_silent = any(path.startswith(p) for p in silent_401_prefixes)
        msg = "Unauthorized" if is_silent else "请先登录"
        return jsonify({"success": False, "message": msg, "code": 401, "silent": is_silent}), 401

    request.current_user = user
    return None


_scheduler_lock = Lock()
_scheduler_started = False


def ensure_scheduler_started():
    """确保调度器在当前进程只启动一次（兼容 gunicorn/flask 运行方式）。"""
    global _scheduler_started
    if _scheduler_started:
        return
    with _scheduler_lock:
        if _scheduler_started:
            return
        report_scheduler.start()
        _scheduler_started = True


@app.before_request
def ensure_background_scheduler():
    if app.testing:
        return None
    # Flask debug reloader 的父进程不启动
    if app.debug and os.environ.get('WERKZEUG_RUN_MAIN') != 'true':
        return None
    ensure_scheduler_started()
    return None

# thread executor for async tasks
executor = ThreadPoolExecutor(max_workers=4)
# in-memory task result store (should use Redis in production)
task_results = {}
task_registry = {}

# DATABASE constant moved to database.py
UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS = {'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'png', 'jpg', 'jpeg', 'zip', 'rar'}

# 确保上传目录存在
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB

# ========== AI 配置 (DeepSeek) ==========
# AI_CONFIG 已移至 ai_config.py 统一管理

# NOTIFICATION_CONFIG, PROJECT_STATUS, PROJECT_TEMPLATES 已移至 app_config.py 统一管理

# get_db is now imported from database.py

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# reload_notification_config is now imported from db_init.py

# init_db is now imported from db_init.py


# Helper functions migrated to db_init.py or services

def _now_iso():
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')

def persist_task_record(task_data):
    """将任务记录同步到数据库，便于任务中心持久化。"""
    try:
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('''
                INSERT INTO background_tasks (task_id, task_type, title, project_id, payload_summary, source_endpoint, retried_from_task_id, status, result, error, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (task_id) DO UPDATE SET
                    task_type = EXCLUDED.task_type,
                    title = EXCLUDED.title,
                    project_id = EXCLUDED.project_id,
                    payload_summary = EXCLUDED.payload_summary,
                    source_endpoint = EXCLUDED.source_endpoint,
                    retried_from_task_id = EXCLUDED.retried_from_task_id,
                    status = EXCLUDED.status,
                    result = EXCLUDED.result,
                    error = EXCLUDED.error,
                    updated_at = EXCLUDED.updated_at
            ''')
            conn.execute(sql, (
                task_data.get('task_id'),
                task_data.get('task_type', 'generic'),
                task_data.get('title', '未命名任务'),
                task_data.get('project_id'),
                task_data.get('payload_summary'),
                task_data.get('source_endpoint'),
                task_data.get('retried_from_task_id'),
                task_data.get('status', 'processing'),
                task_data.get('result'),
                task_data.get('error'),
                task_data.get('created_at', _now_iso()),
                task_data.get('updated_at', _now_iso()),
            ))
            conn.commit()
    except Exception as e:
        logging.warning("Persist task record failed: %s", e)

def fetch_task_record(task_id):
    """从数据库读取任务记录。"""
    try:
        with DatabasePool.get_connection() as conn:
            row = conn.execute(
                DatabasePool.format_sql('SELECT * FROM background_tasks WHERE task_id = ?'),
                (task_id,),
            ).fetchone()
            return dict(row) if row else None
    except Exception as e:
        logging.warning("Fetch task record failed: %s", e)
        return None

def fetch_task_records(status=None, task_type=None, project_id=None, limit=50):
    """从数据库读取任务列表。"""
    try:
        with DatabasePool.get_connection() as conn:
            clauses = []
            params = []
            if status:
                clauses.append('status = ?')
                params.append(status)
            if task_type:
                clauses.append('task_type = ?')
                params.append(task_type)
            if project_id:
                clauses.append('project_id = ?')
                params.append(project_id)
            where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ''
            sql = DatabasePool.format_sql(f'''
                SELECT * FROM background_tasks
                {where_sql}
                ORDER BY updated_at DESC, created_at DESC
                LIMIT ?
            ''')
            params.append(limit)
            rows = conn.execute(sql, params).fetchall()
            return [dict(row) for row in rows]
    except Exception as e:
        logging.warning("Fetch task records failed: %s", e)
        return []

def delete_completed_task_records(project_id=None):
    """清理已完成任务记录。"""
    try:
        with DatabasePool.get_connection() as conn:
            clauses = ['status = ?']
            params = ['completed']
            if project_id:
                clauses.append('project_id = ?')
                params.append(project_id)
            sql = DatabasePool.format_sql(f'''
                DELETE FROM background_tasks
                WHERE {' AND '.join(clauses)}
            ''')
            conn.execute(sql, params)
            conn.commit()
    except Exception as e:
        logging.warning("Delete completed task records failed: %s", e)
        raise

def enrich_task_rows(rows):
    """给任务记录补充项目展示信息，避免前端只能看到内部ID。"""
    if not rows:
        return []

    enriched = [dict(row) for row in rows]
    project_ids = sorted({row.get('project_id') for row in enriched if row.get('project_id')})
    if not project_ids:
        return enriched

    try:
        with DatabasePool.get_connection() as conn:
            placeholders = ','.join('?' for _ in project_ids)
            sql = DatabasePool.format_sql(f'''
                SELECT id, project_name, hospital_name
                FROM projects
                WHERE id IN ({placeholders})
            ''')
            projects = conn.execute(sql, project_ids).fetchall()
            project_map = {row['id']: dict(row) for row in projects}
    except Exception as e:
        logging.warning("Enrich task rows failed: %s", e)
        return enriched

    for row in enriched:
        project_id = row.get('project_id')
        project = project_map.get(project_id)
        if not project:
            continue
        row['project_name'] = project.get('project_name')
        row['hospital_name'] = project.get('hospital_name')
    return enriched

def register_task(task_id, task_type, title, runner, *runner_args, **runner_kwargs):
    """统一登记后台任务，便于任务中心查看与重试。"""
    now = _now_iso()
    project_id = runner_kwargs.get('project_id')
    if project_id is None and runner_args and isinstance(runner_args[0], int):
        project_id = runner_args[0]
    payload_summary = runner_kwargs.get('payload_summary')
    if payload_summary is None and runner_args:
        payload_summary = ', '.join(str(arg) for arg in runner_args[:3])
    source_endpoint = runner_kwargs.get('source_endpoint')
    retried_from_task_id = runner_kwargs.get('retried_from_task_id')
    task_results[task_id] = {
        "task_id": task_id,
        "task_type": task_type,
        "title": title,
        "project_id": project_id,
        "payload_summary": payload_summary,
        "source_endpoint": source_endpoint,
        "retried_from_task_id": retried_from_task_id,
        "status": "processing",
        "created_at": now,
        "updated_at": now,
        "result": None,
        "error": None,
    }
    persist_task_record(task_results[task_id])
    task_registry[task_id] = {
        "task_type": task_type,
        "title": title,
        "runner": runner,
        "args": runner_args,
        "kwargs": runner_kwargs,
    }

def update_task_status(task_id, status, result=None, error=None):
    """更新后台任务状态。"""
    current = task_results.get(task_id, {"task_id": task_id})
    if current.get("status") == "cancelled" and status != "cancelled":
        return
    current.update({
        "status": status,
        "updated_at": _now_iso(),
    })
    if result is not None:
        current["result"] = result
    if error is not None or status == "failed":
        current["error"] = error
    elif status == "completed":
        current["error"] = None
    task_results[task_id] = current
    persist_task_record(current)

def launch_registered_task(task_id):
    """按注册信息启动任务。"""
    task_meta = task_registry.get(task_id)
    if not task_meta:
        raise KeyError(f"Task {task_id} is not registered")
    update_task_status(task_id, "processing", result=None, error=None)
    safe_submit(task_meta["runner"], task_id, *task_meta["args"], **task_meta["kwargs"])

def warm_task_cache(limit=100):
    """启动时预热最近任务缓存。"""
    for row in fetch_task_records(limit=limit):
        task_results[row['task_id']] = row

def log_operation(operator, op_type, entity_type, entity_id, entity_name, old_val=None, new_val=None):
    """记录操作日志"""
    with DatabasePool.get_connection() as conn:
        sql = DatabasePool.format_sql('''
            INSERT INTO operation_logs (operator, operation_type, entity_type, entity_id, entity_name, old_value, new_value)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''')
        conn.execute(sql, (operator or '系统', op_type, entity_type, entity_id, entity_name, 
              json.dumps(old_val, ensure_ascii=False) if old_val else None,
              json.dumps(new_val, ensure_ascii=False) if new_val else None))
        conn.commit()


@app.after_request
def audit_write_operations(response):
    """自动审计写操作请求，减少蓝图手工埋点遗漏。"""
    try:
        if request.method not in ('POST', 'PUT', 'DELETE'):
            return response
        if not request.path.startswith('/api/'):
            return response
        # 避免把日志相关查询写成噪音
        if request.path.startswith('/api/operation-logs'):
            return response
        if response.status_code >= 400:
            return response

        user = getattr(request, 'current_user', None) or {}
        operator = user.get('display_name') or user.get('username') or '系统'
        path_parts = [p for p in (request.path or '').split('/') if p]
        entity_type = path_parts[1] if len(path_parts) > 1 else 'unknown'
        entity_id = path_parts[-1] if path_parts and path_parts[-1].isdigit() else None
        payload = request.get_json(silent=True) or {}
        log_operation(
            operator=operator,
            op_type=request.method,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id else None,
            entity_name=payload.get('name') or payload.get('project_name') or request.path,
            new_val=payload
        )
    except Exception as ex:
        logging.warning("Audit middleware failed: %s", ex)
    return response


# ========== Analytics and Statistics - Migrated to analytics_service


@app.route('/')
def index():
    return render_template('index.html')
@app.route('/alignment')
def alignment_page():
    return render_template('alignment.html')

# ========== 项目健康度仪表盘 API ==========

def _should_return_json_error():
    path = request.path or ''
    if path.startswith('/api/'):
        return True
    best = request.accept_mimetypes.best
    return best == 'application/json' and request.accept_mimetypes[best] > request.accept_mimetypes['text/html']


def _log_server_error(e, tb):
    logging.error(f"500 Internal Server Error: {str(e)}\n{tb}")
    with open('error_traceback.log', 'a', encoding='utf-8') as f:
        f.write(f"[{datetime.now().isoformat()}] 500 Error: {str(e)}\n{tb}\n{'-'*50}\n")


def _api_error_response(code, message, tb=None):
    payload = {
        "success": False,
        "code": code,
        "message": message,
    }
    if tb and (app.debug or app.testing):
        payload["traceback"] = tb
    return jsonify(payload), code


@app.errorhandler(HTTPException)
def handle_http_error(e):
    if not _should_return_json_error():
        return e
    return _api_error_response(e.code or 500, e.description)


@app.errorhandler(Exception)
def handle_unexpected_error(e):
    """API 统一异常兜底，避免返回 HTML 调试页。"""
    tb = traceback.format_exc()
    _log_server_error(e, tb)

    if _should_return_json_error():
        return _api_error_response(500, f"Internal Server Error: {str(e)}", tb)

    return "Internal Server Error", 500

@app.route('/api/dashboard/health', methods=['GET'])
def get_project_health_dashboard():
    """获取所有项目的健康度指标"""
    with DatabasePool.get_connection() as conn:
        sql = DatabasePool.format_sql('''
            SELECT id, project_name, hospital_name, status, progress, 
                   plan_end_date, risk_score, project_manager
            FROM projects 
            WHERE status NOT IN ('已完成', '已终止', '已验收', '质保期')
            ORDER BY risk_score DESC, progress ASC
        ''')
        projects = [dict(row) for row in conn.execute(sql).fetchall()]
        
        health_data = []
        today = datetime.now().date()
        
        for p in projects:
            project_id = p['id']
            
            # 1. 进度偏差计算
            try:
                plan_end_str = str(p['plan_end_date']).strip()[:10] if p.get('plan_end_date') else ""
                plan_end = datetime.strptime(plan_end_str, '%Y-%m-%d').date() if plan_end_str else None
            except (ValueError, AttributeError):
                plan_end = None
            if plan_end:
                total_days = (plan_end - today).days
                expected_progress = max(0, min(100, 100 - (total_days / 90 * 100))) if total_days > 0 else 100
                progress_deviation = (p.get('progress') or 0) - expected_progress
            else:
                progress_deviation = 0
            
            # 2. 问题数量
            sql = DatabasePool.format_sql("SELECT COUNT(*) as c FROM issues WHERE project_id = ? AND status != '已解决'")
            open_issues = conn.execute(sql, (project_id,)).fetchone()['c']
            
            # 3. 接口完成率
            sql_total = DatabasePool.format_sql("SELECT COUNT(*) as c FROM interfaces WHERE project_id = ?")
            total_interfaces = conn.execute(sql_total, (project_id,)).fetchone()['c']
            sql_comp = DatabasePool.format_sql("SELECT COUNT(*) as c FROM interfaces WHERE project_id = ? AND status = '已完成'")
            completed_interfaces = conn.execute(sql_comp, (project_id,)).fetchone()['c']
            interface_rate = (completed_interfaces / total_interfaces * 100) if total_interfaces > 0 else 100
            
            # 4. 里程碑状态
            sql_ms = DatabasePool.format_sql("""
                SELECT COUNT(*) as c FROM milestones 
                WHERE project_id = ? AND is_completed = ? AND target_date < ?
            """)
            overdue_milestones = conn.execute(sql_ms, (project_id, False, today.strftime('%Y-%m-%d'))).fetchone()['c']
            
            # 5. 计算健康度评分 (0-100)
            health_score = 100
            health_score -= min(30, open_issues * 5)  # 每个未解决问题扣5分，最多扣30分
            health_score -= min(20, overdue_milestones * 10)  # 每个逾期里程碑扣10分，最多扣20分
            health_score -= min(20, max(0, -progress_deviation) * 0.5)  # 进度落后扣分
            health_score -= min(15, (100 - interface_rate) * 0.3)  # 接口未完成扣分
            health_score -= min(15, (p['risk_score'] or 0) * 0.3)  # 风险评分扣分
            health_score = max(0, health_score)
            
            # 6. 确定健康状态
            if health_score >= 70:
                health_status = 'green'
                health_label = '健康'
            elif health_score >= 40:
                health_status = 'yellow'
                health_label = '需关注'
            else:
                health_status = 'red'
                health_label = '风险'
            
            health_data.append({
                'id': project_id,
                'project_name': p['project_name'],
                'hospital_name': p['hospital_name'],
                'status': p['status'],
                'progress': p['progress'] or 0,
                'project_manager': p['project_manager'],
                'health_score': round(health_score),
                'health_status': health_status,
                'health_label': health_label,
                'metrics': {
                    'open_issues': open_issues,
                    'overdue_milestones': overdue_milestones,
                    'interface_rate': round(interface_rate),
                    'risk_score': p['risk_score'] or 0,
                    'progress_deviation': round(progress_deviation)
                }
            })
        
        # 汇总统计
        summary = {
            'total': len(health_data),
            'green': sum(1 for h in health_data if h['health_status'] == 'green'),
            'yellow': sum(1 for h in health_data if h['health_status'] == 'yellow'),
            'red': sum(1 for h in health_data if h['health_status'] == 'red')
        }
        
    return api_response(True, {'projects': health_data, 'summary': summary})

# ========== 智能预警 API ==========
@app.route('/api/warnings', methods=['GET'])
def get_project_warnings():
    """获取所有项目的预警信息"""
    try:
        from services.warning_service import warning_service
        data = warning_service.get_warning_summary()
        return api_response(True, data)
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@app.route('/api/warnings/count', methods=['GET'])
def get_warning_count():
    """获取预警数量（用于角标显示）"""
    try:
        from services.warning_service import warning_service
        warnings = warning_service.get_all_warnings()
        high_count = sum(1 for w in warnings if w['severity'] == 'high')
        return api_response(True, {'total': len(warnings), 'high': high_count})
    except Exception as e:
        return api_response(True, {'total': 0, 'high': 0})

# ========== 项目模板 API ==========
@app.route('/api/templates', methods=['GET'])
def get_project_templates():
    """获取所有自定义项目模板"""
    with DatabasePool.get_connection() as conn:
        templates = conn.execute(DatabasePool.format_sql('SELECT * FROM project_templates_custom ORDER BY created_at DESC')).fetchall()
        return api_response(True, [dict(t) for t in templates])

@app.route('/api/projects/<int:project_id>/save-as-template', methods=['POST'])
def save_project_as_template(project_id):
    """将项目保存为模板"""
    import json
    data = request.json or {}
    with DatabasePool.get_connection() as conn:
        sql_pj = DatabasePool.format_sql('SELECT * FROM projects WHERE id = ?')
        project = conn.execute(sql_pj, (project_id,)).fetchone()
        if not project:
            return api_response(False, message='项目不存在', code=404)
        
        sql_stage = DatabasePool.format_sql('SELECT * FROM project_stages WHERE project_id = ?')
        stages = conn.execute(sql_stage, (project_id,)).fetchall()
        stages_data = []
        for stage in stages:
            sql_task = DatabasePool.format_sql('SELECT task_name, is_completed FROM tasks WHERE stage_id = ?')
            tasks = conn.execute(sql_task, (stage['id'],)).fetchall()
            stages_data.append({
                'name': stage['stage_name'],
                'order_num': stage['stage_order'],
                'tasks': [{'name': t['task_name']} for t in tasks]
            })
        
        sql_ms = DatabasePool.format_sql('SELECT name FROM milestones WHERE project_id = ?')
        milestones = conn.execute(sql_ms, (project_id,)).fetchall()
        
        # 组装模板数据
        template_data = {
            'stages': stages_data,
            'milestones': [{'name': m['name']} for m in milestones],
            'icu_beds': project['icu_beds'],
            'operating_rooms': project['operating_rooms'],
            'pacu_beds': project['pacu_beds']
        }
        
        # 保存模板
        sql_ins = DatabasePool.format_sql('''
            INSERT INTO project_templates_custom (name, description, source_project_id, template_data, created_by)
            VALUES (?, ?, ?, ?, ?)
        ''')
        if DatabasePool.is_postgres():
            sql_ins += ' RETURNING id'
        insert_cursor = conn.execute(sql_ins, (
            data.get('name', f"{project['project_name']}_模板"),
            data.get('description', f"从项目「{project['project_name']}」创建"),
            project_id,
            json.dumps(template_data, ensure_ascii=False),
            session.get('username', 'system')
        ))
        template_id = DatabasePool.get_inserted_id(insert_cursor)
        conn.commit()
        
        return api_response(True, {'id': template_id, 'message': '模板保存成功'})

@app.route('/api/templates/<int:template_id>', methods=['DELETE'])
def delete_template(template_id):
    """删除项目模板"""
    with DatabasePool.get_connection() as conn:
        sql = DatabasePool.format_sql('DELETE FROM project_templates_custom WHERE id = ?')
        conn.execute(sql, (template_id,))
        conn.commit()
        return api_response(True, message='模板已删除')

@app.route('/api/projects/<int:project_id>/communications/analyze', methods=['POST'])
def analyze_communications(project_id):
    """AI分析客户沟通记录 - 从项目管理/需求分析师视角"""
    with DatabasePool.get_connection() as conn:
        sql_pj = DatabasePool.format_sql('SELECT * FROM projects WHERE id = ?')
        project = conn.execute(sql_pj, (project_id,)).fetchone()
        if not project:
            return api_response(False, message='项目不存在', code=404)
        
        # 获取所有沟通记录
        sql_comm = DatabasePool.format_sql('''
            SELECT * FROM customer_communications 
            WHERE project_id = ? ORDER BY contact_date DESC
        ''')
        records = conn.execute(sql_comm, (project_id,)).fetchall()
        
        if not records:
            return api_response(False, message='暂无沟通记录，请先添加沟通记录再进行分析', code=400)
        
        # 获取项目阶段和进度
        sql_stage = DatabasePool.format_sql(
            'SELECT stage_name, progress FROM project_stages WHERE project_id = ? ORDER BY stage_order'
        )
        stages = conn.execute(sql_stage, (project_id,)).fetchall()
        
        # 获取活跃问题
        sql_issue = DatabasePool.format_sql(
            "SELECT description, severity, status FROM issues WHERE project_id = ? AND status != '已解决'"
        )
        issues = conn.execute(sql_issue, (project_id,)).fetchall()
    
    # 构建沟通记录汇总
    comm_summary = "\n".join([
        f"- [{r['contact_date']}] 对接人:{r['contact_person']} | 方式:{r['contact_method']} | 内容:{r['summary']}"
        for r in records
    ])
    
    stage_info = "\n".join([f"- {s['stage_name']}: {s['progress']}%" for s in stages]) if stages else "无阶段数据"
    issue_info = "\n".join([f"- [{i['severity']}] {i['description']} ({i['status']})" for i in issues]) if issues else "无待解决问题"
    
    prompt = f"""你是一位资深的**医疗信息化项目需求分析师兼项目经理**，拥有丰富的ICU/手术室信息系统实施经验。

请从专业角度，对以下项目的客户沟通记录进行深度分析和提炼。

## 项目背景
- 项目名称: {project['project_name']}
- 医院: {project['hospital_name']}
- 当前状态: {project['status']}
- 整体进度: {project['progress']}%

## 当前阶段进度
{stage_info}

## 待解决问题
{issue_info}

## 客户沟通记录（按时间倒序）
{comm_summary}

---

请按以下结构输出分析报告（Markdown格式）:

## 📊 沟通要点提炼
提炼出客户核心诉求和关键信息点。

## 🔍 需求合理性分析
逐一分析客户提出的需求是否合理（技术可行性、范围是否超出、实施难度），标注【合理】【需讨论】【不合理】。

## ⚠️ 风险与隐患
从沟通记录中发现的潜在风险和需要关注的问题。

## 📋 下一步行动计划
具体的、可执行的下一步工作建议，包括：
- 需要回复客户的事项
- 需要内部协调的事项
- 需要技术验证的事项

## 💡 专业建议
从项目管理最佳实践角度给出的建议，帮助项目团队更好地推进。

注意：分析要切中要点、有洞察力，给出有实际指导价值的建议，而不是空泛的概述。
"""
    
    try:
        from ai_utils import call_ai
        analysis = call_ai(prompt, task_type='analysis')
        return api_response(True, data={'analysis': analysis})
    except Exception as e:
        return api_response(False, message=f'AI分析失败: {str(e)}', code=500)

@app.route('/api/extract-text', methods=['POST'])
def extract_text():
    """从上传的文件中提取文本内容（支持 PDF/Word/TXT 等）"""
    if 'file' not in request.files:
        return api_response(False, message='没有选择文件', code=400)
    
    file = request.files['file']
    if file.filename == '':
        return api_response(False, message='没有选择文件', code=400)
    
    from services.file_parser import is_supported, extract_text_from_file
    if not is_supported(file.filename):
        return api_response(False, message='不支持的文件格式', code=400)
        
    # 保存到临时目录
    temp_dir = os.path.join(app.root_path, 'uploads', 'temp_extract')
    os.makedirs(temp_dir, exist_ok=True)
    
    filepath = os.path.join(temp_dir, f"{int(time.time())}_{secure_filename(file.filename)}")
    try:
        file.save(filepath)
        text = extract_text_from_file(filepath)
        
        # 提取完删除临时文件
        if os.path.exists(filepath):
            os.remove(filepath)
            
        return api_response(True, data={
            'text': text,
            'filename': file.filename,
            'length': len(text)
        })
    except Exception as e:
        if os.path.exists(filepath):
            os.remove(filepath)
        return api_response(False, message=f'文本提取失败: {str(e)}', code=500)

@app.route('/api/projects/<int:project_id>/communications/analyze-file', methods=['POST'])
def analyze_communication_file(project_id):
    """上传文件并进行AI分析 - 从项目管理/需求分析师视角"""
    if 'file' not in request.files:
        return api_response(False, message='没有选择文件', code=400)

    file = request.files['file']
    if file.filename == '':
        return api_response(False, message='没有选择文件', code=400)

    from services.file_parser import is_supported, extract_text_from_file
    if not is_supported(file.filename):
        return api_response(False, message='不支持的文件格式。支持: Word(.docx), PDF, Excel(.xlsx), TXT, CSV, Markdown', code=400)

    # 保存文件
    import os
    upload_dir = os.path.join(os.path.dirname(__file__), 'uploads', 'comm_files')
    os.makedirs(upload_dir, exist_ok=True)

    import time
    # 保留原始扩展名（secure_filename 会去掉中文导致丢失扩展名）
    ext = os.path.splitext(file.filename)[1].lower()
    safe_name = f"{int(time.time())}_upload{ext}"
    filepath = os.path.join(upload_dir, safe_name)
    file.save(filepath)

    # 提取文本
    file_text = extract_text_from_file(filepath)
    if file_text.startswith('[') and file_text.endswith(']'):
        return api_response(False, message=file_text, code=400)

    # 截取前 8000 字符避免超出 AI token 限制
    if len(file_text) > 8000:
        file_text = file_text[:8000] + f"\n\n... [文件内容过长，已截取前 8000 字符，原文共 {len(file_text)} 字符]"

    # 获取项目上下文
    with DatabasePool.get_connection() as conn:
        sql_pj = DatabasePool.format_sql('SELECT * FROM projects WHERE id = ?')
        project = conn.execute(sql_pj, (project_id,)).fetchone()
        if not project:
            return api_response(False, message='项目不存在', code=404)
    
        sql_stage = DatabasePool.format_sql(
            'SELECT stage_name, progress FROM project_stages WHERE project_id = ? ORDER BY stage_order'
        )
        stages = conn.execute(sql_stage, (project_id,)).fetchall()
        sql_issue = DatabasePool.format_sql(
            "SELECT description, severity, status FROM issues WHERE project_id = ? AND status != '已解决'"
        )
        issues = conn.execute(sql_issue, (project_id,)).fetchall()

    stage_info = "\n".join([f"- {s['stage_name']}: {s['progress']}%" for s in stages]) if stages else "无阶段数据"
    issue_info = "\n".join([f"- [{i['severity']}] {i['description']} ({i['status']})" for i in issues]) if issues else "无待解决问题"

    prompt = f"""你是一位资深的**医疗信息化项目需求分析师兼项目经理**，拥有丰富的ICU/手术室信息系统实施经验。

请对上传的客户沟通文件进行深度分析。文件名: {file.filename}

## 项目背景
- 项目名称: {project['project_name']}
- 医院: {project['hospital_name']}
- 当前状态: {project['status']}
- 整体进度: {project['progress']}%

## 当前阶段进度
{stage_info}

## 待解决问题
{issue_info}

## 上传文件内容
{file_text}

---

请按以下结构输出分析报告（Markdown格式）:

### 📄 文件概要
概括文件主要内容和类型（会议纪要/邮件/需求确认单等）。

### 📊 关键信息提取
从文件中提取出所有重要的决策、承诺、需求点和时间节点。

### 🔍 需求合理性评估
逐一分析文件中提出的需求/要求是否合理，标注【合理】【需讨论】【不合理】。

### ⚠️ 风险识别
从该文件内容中发现的潜在风险。

### 📋 行动项（To-Do）
从文件中提取出具体的可执行待办事项，标注责任方（我方/甲方）和建议完成时间。

### 💡 策略建议
从项目管理角度给出应对策略和建议。

注意：分析要切中要点、具体到位，不要空泛地复述文件内容。
"""

    try:
        from ai_utils import call_ai
        analysis = call_ai(prompt, task_type='analysis')
        return api_response(True, data={'analysis': analysis, 'filename': file.filename, 'text_length': len(file_text)})
    except Exception as e:
        return api_response(False, message=f'AI分析失败: {str(e)}', code=500)

# ========== AI项目复盘 API ==========
@app.route('/api/projects/<int:project_id>/ai-retrospective', methods=['POST'])
def ai_project_retrospective(project_id):
    """AI生成项目复盘报告"""
    try:
        from ai_utils import call_ai
        
        with DatabasePool.get_connection() as conn:
            sql_pj = DatabasePool.format_sql('SELECT * FROM projects WHERE id = ?')
            project = conn.execute(sql_pj, (project_id,)).fetchone()
            if not project:
                return api_response(False, message='项目不存在', code=404)
            
            # 获取项目统计
            sql_stage = DatabasePool.format_sql('SELECT * FROM project_stages WHERE project_id = ?')
            stages = conn.execute(sql_stage, (project_id,)).fetchall()
            sql_task = DatabasePool.format_sql('''
                SELECT t.* FROM tasks t 
                JOIN project_stages s ON t.stage_id = s.id 
                WHERE s.project_id = ?
            ''')
            tasks = conn.execute(sql_task, (project_id,)).fetchall()
            sql_issue = DatabasePool.format_sql('SELECT * FROM issues WHERE project_id = ?')
            issues = conn.execute(sql_issue, (project_id,)).fetchall()
            sql_log = DatabasePool.format_sql('SELECT * FROM work_logs WHERE project_id = ? ORDER BY log_date DESC LIMIT 50')
            logs = conn.execute(sql_log, (project_id,)).fetchall()
        
        # 构建prompt
        completed_tasks = sum(1 for t in tasks if t.get('is_completed'))
        open_issues = sum(1 for i in issues if i['status'] not in ['已解决', '已关闭'])
        
        prompt = f"""作为项目管理专家，请对以下已完成的ICU/麻醉系统实施项目进行复盘分析，生成一份简洁的复盘报告。

## 项目信息
- 项目名称：{project['project_name']}
- 医院：{project['hospital_name']}
- 项目经理：{project['project_manager']}
- 状态：{project['status']}
- 进度：{project['progress']}%
- 计划周期：{project['plan_start_date']} ~ {project['plan_end_date']}
- 实际完成：{project.get('actual_end_date', '未记录')}

## 项目统计
- 阶段数：{len(stages)}
- 任务完成率：{completed_tasks}/{len(tasks)}
- 遗留问题：{open_issues}
- 工作日志：{len(logs)}条

请按以下格式输出复盘报告（使用Markdown）：
## 🎯 项目总结
一句话总结项目整体表现

## ✅ 做得好的地方
- 列出3个亮点

## ⚠️ 需要改进的地方
- 列出3个改进点

## 📚 经验教训
- 列出3条关键经验

## 💡 建议
给未来类似项目的建议
"""
        
        result = call_ai(prompt, task_type='summary')
        return api_response(True, {'report': result})
    except Exception as e:
        return api_response(False, message=str(e), code=500)

# ========== AI任务分配建议 API ==========
@app.route('/api/projects/<int:project_id>/ai-task-suggestions', methods=['POST'])
def ai_task_suggestions(project_id):
    """AI生成任务分配建议"""
    try:
        from ai_utils import call_ai
        
        with DatabasePool.get_connection() as conn:
            sql_pj = DatabasePool.format_sql('SELECT * FROM projects WHERE id = ?')
            project = conn.execute(sql_pj, (project_id,)).fetchone()
            if not project:
                return api_response(False, message='项目不存在', code=404)
            
            # 获取未分配任务 (由于schema中没有assigned_to，目前认为未完成的任务即为待分配任务)
            sql_task = DatabasePool.format_sql('''
                SELECT t.id, t.task_name, t.is_completed, s.stage_name
                FROM tasks t 
                JOIN project_stages s ON t.stage_id = s.id 
                WHERE s.project_id = ? AND t.is_completed = ?
            ''')
            tasks = conn.execute(sql_task, (project_id, False)).fetchall()
            
            # 获取团队成员
            sql_member = DatabasePool.format_sql('''
                SELECT * FROM project_members 
                WHERE project_id = ? AND status = '在岗'
            ''')
            members = conn.execute(sql_member, (project_id,)).fetchall()
        
        if not tasks:
            return api_response(True, {'suggestions': [], 'message': '暂无未分配任务'})
        
        if not members:
            return api_response(True, {'suggestions': [], 'message': '暂无团队成员'})
        
        # 构建prompt
        tasks_info = "\n".join([f"- [{t['id']}] {t['stage_name']}: {t['task_name']}" for t in tasks[:15]])
        members_info = "\n".join([f"- {m['name']} ({m['role']})" for m in members])
        
        prompt = f"""作为项目管理专家，请根据以下信息给出任务分配建议。

## 未分配任务
{tasks_info}

## 团队成员
{members_info}

请按JSON格式返回分配建议：
[
  {{"task_id": 任务ID, "task_name": "任务名", "suggested_member": "建议分配人姓名", "reason": "分配原因"}}
]

注意事项：
1. "suggested_member" 必须精准匹配上述团队成员列表中的姓名。
2. 只要返回一个合法的 JSON 数组，严禁附带任何 Markdown 代码块标签(如 ```json)或额外的解释文字。
3. 如果没有任何建议，返回空数组 []。
"""
        
        result = call_ai(prompt, task_type='analysis')
        
        # 尝试解析JSON (增强型解析，提取第一个 [ 和 最后一个 ])
        import json
        import re
        try:
            # 查找 JSON 数组部分
            match = re.search(r'\[.*\]', result, re.DOTALL)
            if match:
                json_str = match.group()
                suggestions = json.loads(json_str)
                return api_response(True, {'suggestions': suggestions})
        except Exception as e:
            logging.warning("AI Task Suggestions JSON parse failed: %s", e)
        
        return api_response(True, {'suggestions': [], 'raw_response': result})
    except Exception as e:
        return api_response(False, message=str(e), code=500)

# ========== 任务依赖关系 API ==========
@app.route('/api/projects/<int:project_id>/dependencies', methods=['GET'])
def get_project_dependencies(project_id):
    """获取项目所有任务依赖关系"""
    from services.dependency_service import dependency_service
    deps = dependency_service.get_dependencies(project_id)
    return api_response(True, deps)

@app.route('/api/dependencies', methods=['POST'])
def add_task_dependency():
    """添加任务依赖"""
    from services.dependency_service import dependency_service
    data = request.json or {}
    result = dependency_service.add_dependency(
        data['task_id'], data['depends_on_task_id'],
        data.get('dependency_type', 'finish_to_start')
    )
    if result['success']:
        return api_response(True, message=result['message'])
    return api_response(False, message=result['message'], code=400)

@app.route('/api/dependencies/<int:dep_id>', methods=['DELETE'])
def delete_task_dependency(dep_id):
    """删除任务依赖"""
    from services.dependency_service import dependency_service
    dependency_service.remove_dependency(dep_id)
    return api_response(True, message='依赖关系已删除')

@app.route('/api/projects/<int:project_id>/critical-path', methods=['GET'])
def get_critical_path(project_id):
    """获取项目关键路径"""
    from services.dependency_service import dependency_service
    result = dependency_service.get_critical_path(project_id)
    return api_response(True, result)

@app.route('/api/tasks/<int:task_id>/impact', methods=['GET'])
def get_task_impact(task_id):
    """获取任务延迟影响分析"""
    from services.dependency_service import dependency_service
    result = dependency_service.get_impact_analysis(task_id)
    return api_response(True, result)

@app.route('/api/tasks/<int:task_id>/available-dependencies', methods=['GET'])
def get_available_deps(task_id):
    """获取可用的依赖任务列表"""
    from services.dependency_service import dependency_service
    result = dependency_service.get_available_dependencies(task_id)
    return api_response(True, result)

# ========== 每日站会助手 API ==========
@app.route('/api/projects/<int:project_id>/standup', methods=['GET'])
def get_standup_data(project_id):
    """获取站会聚合数据"""
    from services.standup_service import standup_service
    date_str = request.args.get('date')
    data = standup_service.get_standup_data(project_id, date_str)
    if data:
        return api_response(True, data)
    return api_response(False, message='项目不存在', code=404)

@app.route('/api/projects/<int:project_id>/standup/generate', methods=['POST'])
def generate_standup(project_id):
    """AI生成站会纪要"""
    from services.standup_service import standup_service
    data = request.json or {}
    date_str = data.get('date')
    result = standup_service.generate_ai_standup(project_id, date_str)

    # 保存到数据库
    if result.get('standup'):
        with DatabasePool.get_connection() as conn:
            today = date_str or datetime.now().strftime('%Y-%m-%d')
            sql = DatabasePool.format_sql('''
                INSERT INTO standup_minutes (project_id, meeting_date, content, ai_generated, created_by, created_at)
                VALUES (?, ?, ?, TRUE, 'AI', CURRENT_TIMESTAMP)
                ON CONFLICT (project_id, meeting_date) DO UPDATE SET
                    content = EXCLUDED.content,
                    created_at = EXCLUDED.created_at
            ''')
            conn.execute(sql, (project_id, today, result['standup']))
            conn.commit()
    
    return api_response(True, result)

@app.route('/api/standup/briefing', methods=['GET'])
def get_daily_briefing():
    """获取全局每日简报"""
    from services.standup_service import standup_service
    result = standup_service.generate_daily_briefing()
    return api_response(True, result)

@app.route('/api/standup/push-wecom', methods=['POST'])
def push_briefing_wecom():
    """推送每日简报到企业微信"""
    from services.standup_service import standup_service
    result = standup_service.push_briefing_to_wecom()
    return api_response(result['success'], message=result['message'])

@app.route('/api/projects/<int:project_id>/standup/history', methods=['GET'])
def get_standup_history(project_id):
    """获取站会纪要历史"""
    with DatabasePool.get_connection() as conn:
        sql = DatabasePool.format_sql('''
            SELECT * FROM standup_minutes
            WHERE project_id = ?
            ORDER BY meeting_date DESC
            LIMIT 30
        ''')
        records = conn.execute(sql, (project_id,)).fetchall()
        return api_response(True, [dict(r) for r in records])

# ========== 进度快照与偏差分析 API ==========
@app.route('/api/projects/<int:project_id>/snapshots', methods=['GET'])
def get_project_snapshots(project_id):
    """获取项目进度快照列表"""
    from services.snapshot_service import snapshot_service
    weeks = request.args.get('weeks', 8, type=int)
    snapshots = snapshot_service.get_snapshots(project_id, weeks)
    return api_response(True, snapshots)

@app.route('/api/projects/<int:project_id>/snapshots', methods=['POST'])
def capture_project_snapshot(project_id):
    """手动拍摄进度快照"""
    from services.snapshot_service import snapshot_service
    result = snapshot_service.capture_snapshot(project_id, 'manual')
    if result:
        return api_response(True, result, message='快照已保存')
    return api_response(False, message='项目不存在', code=404)

@app.route('/api/snapshots/capture-all', methods=['POST'])
def capture_all_snapshots():
    """为所有活跃项目拍摄快照"""
    from services.snapshot_service import snapshot_service
    results = snapshot_service.capture_all_snapshots()
    return api_response(True, results, message=f'已为 {len(results)} 个项目拍摄快照')

@app.route('/api/projects/<int:project_id>/deviation', methods=['GET'])
def get_deviation_analysis(project_id):
    """获取进度偏差分析"""
    from services.snapshot_service import snapshot_service
    result = snapshot_service.get_deviation_analysis(project_id)
    return api_response(True, result)

@app.route('/api/projects/<int:project_id>/deviation/ai-report', methods=['POST'])
def generate_deviation_report(project_id):
    """AI生成偏差分析报告"""
    from services.snapshot_service import snapshot_service
    result = snapshot_service.generate_ai_deviation_report(project_id)
    return api_response(True, result)

# ========== 医院名称列表 API ==========
@app.route('/api/hospitals', methods=['GET'])
def get_hospitals():
    with DatabasePool.get_connection() as conn:
        sql = DatabasePool.format_sql('SELECT DISTINCT hospital_name FROM projects ORDER BY hospital_name')
        hospitals = conn.execute(sql).fetchall()
        return api_response(True, [h['hospital_name'] for h in hospitals])

# ========== 智能提醒 API ==========
@app.route('/api/reminders', methods=['GET'])
def get_reminders():
    """获取所有类型的提醒"""
    try:
        from services.reminder_service import reminder_service
        reminders = reminder_service.get_all_reminders()
        return api_response(True, reminders)
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@app.route('/api/reminders/digest', methods=['GET'])
def get_reminder_digest():
    """获取每日摘要"""
    try:
        from services.reminder_service import reminder_service
        digest = reminder_service.get_daily_digest()
        return api_response(True, digest)
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@app.route('/api/reminders/overdue', methods=['GET'])
def get_overdue_reminders():
    """获取逾期项"""
    try:
        from services.reminder_service import reminder_service
        overdue = reminder_service.check_overdue_milestones()
        return api_response(True, {'overdue_milestones': overdue})
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@app.route('/api/reminders/upcoming', methods=['GET'])
def get_upcoming_reminders():
    """获取即将到期项"""
    try:
        from services.reminder_service import reminder_service
        days = request.args.get('days', 7, type=int)
        upcoming = reminder_service.check_upcoming_deadlines(days)
        return api_response(True, {'upcoming_deadlines': upcoming})
    except Exception as e:
        return api_response(False, message=str(e), code=500)

# Legacy template API removed in favor of database-backed implementation


# ========== 用户认证 API ==========
@app.route('/api/auth/login', methods=['POST'])
def user_login():
    """用户登录"""
    try:
        from services.auth_service import auth_service
        data = request.json or {}
        username = data.get('username')
        password = data.get('password')
        if not username or not password:
            return api_response(False, message="用户名和密码不能为空", code=400)
        result = auth_service.login(username, password)
        if result['success']:
            # 设置 Cookie
            user_data = result.get('user', {})
            user_data['token'] = result.get('token')
            response = make_response(api_response(True, data=user_data, message="登录成功"))
            response.set_cookie('auth_token', result['token'], httponly=True, max_age=86400)
            return response
        return api_response(False, message=result.get('message', '登录失败'))
    except Exception as e:
        import traceback
        traceback.print_exc()
        return api_response(False, message=str(e) + "\n" + traceback.format_exc(), code=500)

@app.route('/api/auth/register', methods=['POST'])
def user_register():
    """用户注册"""
    try:
        from services.auth_service import auth_service
        data = request.json or {}
        result = auth_service.register(
            username=data.get('username'),
            password=data.get('password'),
            email=data.get('email'),
            display_name=data.get('display_name'),
            role=data.get('role', 'team_member')
        )
        return api_response(result['success'], message=result['message'])
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@app.route('/api/auth/me', methods=['GET'])
def get_current_user():
    """获取当前用户信息"""
    try:
        from services.auth_service import auth_service
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            token = request.cookies.get('auth_token')
        user = auth_service.validate_token(token)
        if user:
            return api_response(True, user)
        return api_response(False, message="未登录", code=401)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return api_response(False, message=str(e) + "\n" + traceback.format_exc(), code=500)

@app.route('/api/auth/logout', methods=['POST'])
def user_logout():
    """用户登出"""
    try:
        from services.auth_service import auth_service
        # 从 Cookie 或 Header 获取 token
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            token = request.cookies.get('auth_token')
        if token:
            auth_service.logout(token)
        # 清除 Cookie
        response = make_response(api_response(True, message="已登出"))
        response.delete_cookie('auth_token')
        return response
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@app.route('/api/users', methods=['GET'])
def get_users():
    """获取用户列表（管理员）"""
    try:
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            token = request.cookies.get('auth_token')
        current_user = auth_service.validate_token(token)

        if not current_user or current_user['role'] != 'admin':
            return api_response(False, message="仅管理员可操作", code=403)

        users = auth_service.get_all_users()
        return api_response(True, users)
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@app.route('/api/admin/roles', methods=['GET'])
def get_admin_roles():
    """获取系统角色与权限矩阵（管理员）"""
    try:
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            token = request.cookies.get('auth_token')
        current_user = auth_service.validate_token(token)

        if not current_user or current_user['role'] != 'admin':
            return api_response(False, message="仅管理员可操作", code=403)

        role_matrix = auth_service.list_role_definitions(force_reload=True)
        return api_response(True, role_matrix)
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@app.route('/api/admin/roles', methods=['POST'])
def save_admin_roles():
    """保存系统角色与权限矩阵（管理员）"""
    try:
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            token = request.cookies.get('auth_token')
        current_user = auth_service.validate_token(token)

        if not current_user or current_user['role'] != 'admin':
            return api_response(False, message="仅管理员可操作", code=403)

        payload = request.json or {}
        roles = payload.get('roles', payload)
        old_roles = auth_service.list_role_definitions(force_reload=True)
        result = auth_service.save_role_definitions(roles)
        log_operation(
            current_user.get('display_name') or current_user.get('username') or '系统',
            '保存角色权限矩阵',
            'auth',
            0,
            '角色权限矩阵',
            old_roles,
            result.get('roles', [])
        )
        return api_response(result.get('success', True), result.get('roles', []), message='角色权限矩阵已保存')
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@app.route('/api/auth/migrate', methods=['POST'])
def migrate_auth_data():
    """数据迁移：将现有项目分配给管理员"""
    try:
        from services.auth_service import auth_service
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            token = request.cookies.get('auth_token')
        current_user = auth_service.validate_token(token)
        
        if not current_user or current_user['role'] != 'admin':
            return api_response(False, message="仅管理员可操作", code=403)
            
        result = auth_service.migrate_existing_projects()
        return api_response(result['success'], message=result['message'])
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@app.route('/api/users/<int:user_id>/status', methods=['POST'])
def update_user_status(user_id):
    """更新用户状态（仅管理员）"""
    try:
        # 验证权限
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            token = request.cookies.get('auth_token')
        current_user = auth_service.validate_token(token)
        
        if not current_user or current_user['role'] != 'admin':
            return api_response(False, message="仅管理员可操作", code=403)

        target_user = auth_service.get_user_by_id(user_id)
        if not target_user:
            return api_response(False, message="用户不存在", code=404)

        data = request.json or {}
        is_active = data.get('is_active', True)
        
        # 防止禁用自己
        if user_id == current_user['id'] and not is_active:
             return api_response(False, message="不能禁用当前登录账号", code=400)

        result = auth_service.update_user_status(user_id, is_active)
        updated_user = auth_service.get_user_by_id(user_id)
        log_operation(
            current_user.get('display_name') or current_user.get('username') or '系统',
            '更新用户状态',
            'auth',
            user_id,
            target_user.get('display_name') or target_user.get('username') or f'用户#{user_id}',
            {
                'role': target_user.get('role'),
                'is_active': bool(target_user.get('is_active'))
            },
            {
                'role': updated_user.get('role') if updated_user else target_user.get('role'),
                'is_active': bool(updated_user.get('is_active')) if updated_user else bool(is_active)
            }
        )
        return api_response(result['success'], message=result.get('message'))
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@app.route('/api/users/<int:user_id>/password', methods=['POST'])
def reset_user_password(user_id):
    """重置用户密码（仅管理员）"""
    try:
        # 验证权限
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            token = request.cookies.get('auth_token')
        current_user = auth_service.validate_token(token)
        
        if not current_user or current_user['role'] != 'admin':
            return api_response(False, message="仅管理员可操作", code=403)

        target_user = auth_service.get_user_by_id(user_id)
        if not target_user:
             return api_response(False, message="用户不存在", code=404)

        data = request.json or {}
        new_password = data.get('password')
        if not new_password:
             return api_response(False, message="新密码不能为空", code=400)

        result = auth_service.reset_user_password(user_id, new_password)
        log_operation(
            current_user.get('display_name') or current_user.get('username') or '系统',
            '重置用户密码',
            'auth',
            user_id,
            target_user.get('display_name') or target_user.get('username') or f'用户#{user_id}',
            None,
            {'password_reset': True}
        )
        return api_response(result['success'], message=result.get('message'))
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@app.route('/api/projects/<int:project_id>/access', methods=['GET'])
def get_project_access(project_id):
    """获取有权访问该项目的用户列表"""
    try:
        from services.auth_service import auth_service
        members = auth_service.get_project_members(project_id)
        return api_response(True, members)
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@app.route('/api/projects/<int:project_id>/access', methods=['POST'])
def add_project_access(project_id):
    """授权用户访问项目"""
    try:
        from services.auth_service import auth_service
        data = request.json or {}
        user_id = data.get('user_id')
        role = data.get('role', 'member')
        if not user_id:
            return api_response(False, message="缺少用户ID", code=400)
            
        result = auth_service.add_project_member(project_id, user_id, role)
        return api_response(result['success'], message=result.get('message'))
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@app.route('/api/projects/<int:project_id>/access/<int:user_id>', methods=['DELETE'])
def remove_project_access(project_id, user_id):
    """移除用户对项目的访问权限"""
    try:
        from services.auth_service import auth_service
        result = auth_service.remove_project_member(project_id, user_id)
        return api_response(result['success'], message=result.get('message'))
    except Exception as e:
        return api_response(False, message=str(e), code=500)

# ========== 数据分析 API ==========
@app.route('/api/analytics/compare', methods=['POST'])
def compare_projects():
    """项目对比分析"""
    try:
        from services.analytics_service import analytics_service
        data = request.json or {}
        project_ids = data.get('project_ids', [])
        result = analytics_service.compare_projects(project_ids)
        return api_response(True, result)
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@app.route('/api/analytics/trends', methods=['GET'])
def get_trend_analysis():
    """获取趋势分析"""
    try:
        from services.analytics_service import analytics_service
        project_id = request.args.get('project_id', type=int)
        days = request.args.get('days', 30, type=int)
        result = analytics_service.get_trend_data(project_id, days)
        return api_response(True, result)
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@app.route('/api/analytics/health/<int:project_id>', methods=['GET'])
def get_project_health(project_id):
    """获取项目健康度评分"""
    try:
        from services.analytics_service import analytics_service
        result = analytics_service.get_project_health_score(project_id)
        return api_response(True, result)
    except Exception as e:
        return api_response(False, message=str(e), code=500)

# ========== AI 增强 API ==========
@app.route('/api/ai/query', methods=['POST'])
def ai_natural_query():
    """AI 自然语言查询"""
    try:
        data = request.json or {}
        query = data.get('query', '')
        if not query:
            return api_response(False, message="查询内容不能为空", code=400)
        
        # 构建查询上下文
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('''
                SELECT id, project_name, hospital_name, status, progress, project_manager 
                FROM projects WHERE status NOT IN ('已完成', '已终止', '已验收', '质保期')
            ''')
            projects = conn.execute(sql).fetchall()
            
            context = "当前活跃项目列表:\n"
            for p in projects:
                context += f"- {p['project_name']} ({p['hospital_name']}): 状态={p['status']}, 进度={p['progress']}%, 负责人={p['project_manager'] or '未指定'}\n"
        
        system_prompt = """你是一个项目管理助手。用户会用自然语言询问项目相关问题。
请根据提供的项目数据，用简洁中文回答用户问题。
如果用户要求筛选或统计，请给出结果列表。
如果信息不足，请说明需要哪些信息。"""
        
        user_prompt = f"项目数据:\n{context}\n\n用户问题: {query}"
        
        response = call_deepseek_api(system_prompt, user_prompt, task_type="chat")
        return api_response(True, {"query": query, "answer": response})
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@app.route('/api/ai/classify-issue', methods=['POST'])
def ai_classify_issue():
    """AI 问题自动分类"""
    try:
        data = request.json or {}
        description = data.get('description', '')
        if not description:
            return api_response(False, message="问题描述不能为空", code=400)
        
        system_prompt = """你是一个ICU信息化项目的问题分类助手。
请根据问题描述，判断：
1. 问题类型 (技术问题/需求变更/接口问题/设备问题/培训问题/协调问题/其他)
2. 建议的严重程度 (高/中/低)
3. 处理优先级建议

请用JSON格式返回：{"type": "类型", "severity": "严重程度", "priority": "优先级说明", "suggestion": "处理建议"}"""
        
        response = call_deepseek_api(system_prompt, description, task_type="analysis")
        
        # 尝试解析JSON
        try:
            import re
            json_match = re.search(r'\{.*\}', response, re.DOTALL)
            if json_match:
                result = json.loads(json_match.group())
            else:
                result = {"raw_response": response}
        except:
            result = {"raw_response": response}
        
        return api_response(True, result)
    except Exception as e:
        return api_response(False, message=str(e), code=500)


# ========== 项目状态配置 API ==========
@app.route('/api/project-status-config', methods=['GET'])
def get_project_status_config():
    return jsonify(PROJECT_STATUS)


# ========== Notifications - Migrated to monitor_service ==========

# ========== AI 核心逻辑 ==========
def call_deepseek_api(system_prompt, user_content, task_type="analysis"):
    """
    代理函数，映射到更稳健的 call_ai 实现
    """
    return call_ai(user_content, task_type=task_type, system_prompt=system_prompt)


# ========== AI 核心逻辑 (部分已迁移) ==========


def _run_analysis_task(task_id, project_id):
    """后台运行AI分析任务"""
    try:
        with DatabasePool.get_connection() as conn:
            sql_pj = DatabasePool.format_sql('SELECT * FROM projects WHERE id = ?')
            project = dict(conn.execute(sql_pj, (project_id,)).fetchone())
            
            sql_stage = DatabasePool.format_sql('SELECT * FROM project_stages WHERE project_id = ?')
            stages = [dict(s) for s in conn.execute(sql_stage, (project_id,)).fetchall()]
            
            sql_issue = DatabasePool.format_sql('SELECT * FROM issues WHERE project_id = ? AND status != ?')
            issues = [dict(i) for i in conn.execute(sql_issue, (project_id, '已解决')).fetchall()]
            
            sql_iface = DatabasePool.format_sql('SELECT * FROM interfaces WHERE project_id = ? AND status != ?')
            interfaces = [dict(i) for i in conn.execute(sql_iface, (project_id, '已完成')).fetchall()]
            
            sql_dev = DatabasePool.format_sql('SELECT * FROM medical_devices WHERE project_id = ?')
            devices = [dict(d) for d in conn.execute(sql_dev, (project_id,)).fetchall()]
            
            sql_mem = DatabasePool.format_sql('SELECT * FROM project_members WHERE project_id = ? AND status = ?')
            members = [dict(m) for m in conn.execute(sql_mem, (project_id, '在岗')).fetchall()]
            
            sql_dep = DatabasePool.format_sql('SELECT * FROM project_departures WHERE project_id = ? ORDER BY created_at DESC LIMIT 3')
            departures = [dict(d) for d in conn.execute(sql_dep, (project_id,)).fetchall()]
        
        # 扫描潜在风险点
        detected_risks, risk_score = ai_service.analyze_project_risks(project_id)
        
        system_prompt = """你是一位资深的医疗信息化项目总监(PMO)，擅长ICU/手麻系统实施。
        请根据提供的项目数据（包含基础信息、进度、问题及工作日志风险扫描结果），进行严厉但建设性的诊断。
        输出 Markdown 格式，且必须包含以下固定结构：
        
        1. **整体健康度评分** (0-100分) 及简短评语。
        2. **风险雷达数据**：请在输出的最后，使用唯一的JSON代码块返回以下5个维度的评分(0-10分，分数越高表示越稳健/风险越低)：
           - 进度 (Progress): 计划与实际匹配度
           - 技术 (Technical): 接口、性能、Bug状况
           - 交付 (Delivery): 硬件、上线、验收进度
           - 协调 (Coordination): 甲方配合、内部沟通
           - 预算 (Budget): 成本控制、工时消耗
           代码块格式必须为: ```json {"radar": {"进度": 8, "技术": 6, ...}} ```
        3. **核心痛点诊断**：深度分析为什么会出现这些风险点。
        4. **追赶建议与预案**：给出具体的应对预案。
        5. **下周重点** (基于当前状态推荐的优先事项)
        """.format(risk_score=risk_score)
        
        project_data_str = json.dumps({
            "project_info": project, 
            "stages_status": stages, 
            "pending_issues": issues,
            "pending_interfaces": interfaces, 
            "devices": devices, 
            "team_members": members,
            "departure_history": departures,
            "log_detected_risks": detected_risks,
            "calculated_risk_score": risk_score
        }, ensure_ascii=False)
        
        # Close DB reading connection before long API call
        # (Context manager handled it above)
        
        analysis_result = call_deepseek_api(system_prompt, f"请分析以下项目数据：\n{project_data_str}", task_type="analysis")
        
        # Re-open DB to save result
        data_hash = analytics_service.calculate_project_hash(project_id)
        analytics_service.save_report_cache(project_id, 'ai_analysis', analysis_result, data_hash)
        
        update_task_status(task_id, "completed", result=analysis_result)
        
    except Exception as e:
        update_task_status(task_id, "failed", error=str(e))

@app.route('/api/projects/<int:project_id>/ai-analysis', methods=['POST'])
def generate_ai_analysis(project_id):
    """异步生成项目 AI 分析，纳入任务中心。"""
    try:
        with DatabasePool.get_connection() as conn:
            project = conn.execute(
                DatabasePool.format_sql('SELECT id, project_name FROM projects WHERE id = ?'),
                (project_id,),
            ).fetchone()
            if not project:
                return api_response(False, message='项目不存在', code=404)

        task_id = str(uuid.uuid4())
        register_task(task_id, 'ai_analysis', f"项目AI分析 #{project_id} {project['project_name']}", _run_analysis_task, project_id, source_endpoint=f'/api/projects/{project_id}/ai-analysis')
        launch_registered_task(task_id)
        return api_response(True, {"task_id": task_id, "status": "processing"})
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@app.route('/api/users/<int:user_id>/role', methods=['POST'])
def update_user_role(user_id):
    """更新用户角色（仅管理员）"""
    try:
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            token = request.cookies.get('auth_token')
        current_user = auth_service.validate_token(token)

        if not current_user or current_user['role'] != 'admin':
            return api_response(False, message="仅管理员可操作", code=403)

        target_user = auth_service.get_user_by_id(user_id)
        if not target_user:
            return api_response(False, message="用户不存在", code=404)

        data = request.json or {}
        new_role = data.get('role')
        if not new_role:
            return api_response(False, message="缺少角色参数", code=400)

        result = auth_service.update_user_role(user_id, new_role)
        updated_user = auth_service.get_user_by_id(user_id)
        log_operation(
            current_user.get('display_name') or current_user.get('username') or '系统',
            '更新用户角色',
            'auth',
            user_id,
            target_user.get('display_name') or target_user.get('username') or f'用户#{user_id}',
            {'role': target_user.get('role')},
            {'role': updated_user.get('role') if updated_user else new_role}
        )
        return api_response(result['success'], message=result.get('message'))
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@app.route('/api/dashboard/today-focus', methods=['GET'])
def get_today_focus_dashboard():
    """今日待办驾驶舱：聚合提醒、预警、审批与进行中后台任务。"""
    try:
        from services.reminder_service import reminder_service
        from services.warning_service import warning_service
        from services.auth_service import auth_service

        scope = (request.args.get('scope') or 'global').strip().lower()
        current_user = None
        if scope == 'mine':
            token = request.headers.get('Authorization', '').replace('Bearer ', '')
            if not token:
                token = request.cookies.get('auth_token')
            current_user = auth_service.validate_token(token)
            if not current_user:
                return api_response(False, message="未登录", code=401)

        digest = reminder_service.get_daily_digest()
        warning_data = warning_service.get_warning_summary()
        warnings = warning_data.get('warnings', [])

        if scope == 'mine' and current_user:
            user_project_ids = auth_service.get_user_projects(current_user['id'])
            if user_project_ids is None:
                allowed_project_ids = None
                allowed_project_names = None
            else:
                allowed_project_ids = set(user_project_ids)
                with DatabasePool.get_connection() as conn:
                    managed = conn.execute(
                        DatabasePool.format_sql("SELECT id, project_name FROM projects WHERE project_manager = ?"),
                        (current_user.get('display_name') or current_user.get('username'),),
                    ).fetchall()
                    allowed_project_ids.update(row['id'] for row in managed)
                    allowed_project_names = {row['project_name'] for row in managed if row.get('project_name')}
                    if allowed_project_ids:
                        placeholders = ','.join('?' for _ in allowed_project_ids)
                        rows = conn.execute(
                            DatabasePool.format_sql(f"SELECT project_name FROM projects WHERE id IN ({placeholders})"),
                            list(allowed_project_ids),
                        ).fetchall()
                        allowed_project_names.update(row['project_name'] for row in rows if row.get('project_name'))

            if allowed_project_ids is not None:
                warnings = [w for w in warnings if w.get('project_id') in allowed_project_ids]
                top_priorities = [
                    item for item in digest.get('top_priorities', [])
                    if not item.get('project') or item.get('project') in allowed_project_names
                ]
            else:
                top_priorities = digest.get('top_priorities', [])
        else:
            allowed_project_ids = None
            top_priorities = digest.get('top_priorities', [])

        with DatabasePool.get_connection() as conn:
            pending_changes = conn.execute(DatabasePool.format_sql('''
                SELECT c.id, c.change_type, c.change_desc, c.project_id, p.project_name
                FROM project_changes c
                JOIN projects p ON c.project_id = p.id
                WHERE c.status = ?
                ORDER BY c.created_at DESC
                LIMIT 5
            '''), ('待审批',)).fetchall()

            pending_departures = conn.execute(DatabasePool.format_sql('''
                SELECT d.id, d.departure_type, d.reason, d.project_id, p.project_name
                FROM project_departures d
                JOIN projects p ON d.project_id = p.id
                WHERE d.status = ?
                ORDER BY d.created_at DESC
                LIMIT 5
            '''), ('待审批',)).fetchall()

            pending_expenses = conn.execute(DatabasePool.format_sql('''
                SELECT e.id, e.expense_type, e.description, e.project_id, p.project_name
                FROM project_expenses e
                JOIN projects p ON e.project_id = p.id
                WHERE e.status = ?
                ORDER BY e.created_at DESC
                LIMIT 5
            '''), ('待报销',)).fetchall()

            if allowed_project_ids is not None:
                pending_changes = [row for row in pending_changes if row['project_id'] in allowed_project_ids]
                pending_departures = [row for row in pending_departures if row['project_id'] in allowed_project_ids]
                pending_expenses = [row for row in pending_expenses if row['project_id'] in allowed_project_ids]

        processing_tasks = fetch_task_records(status='processing', limit=10)
        if allowed_project_ids is not None:
            processing_tasks = [row for row in processing_tasks if row.get('project_id') in allowed_project_ids]

        focus_items = []
        for item in top_priorities[:4]:
            focus_items.append({
                'category': 'priority',
                'severity': item.get('action', 'medium'),
                'title': item.get('title'),
                'project': item.get('project'),
                'desc': item.get('days'),
                'target_kind': 'project',
                'project_name': item.get('project'),
            })

        for item in warnings[:4]:
            focus_items.append({
                'category': 'warning',
                'severity': item.get('severity', 'medium'),
                'title': item.get('message'),
                'project': item.get('project_name'),
                'desc': item.get('type'),
                'target_kind': 'project',
                'project_id': item.get('project_id'),
                'project_name': item.get('project_name'),
            })

        for item in pending_changes:
            focus_items.append({
                'category': 'approval',
                'severity': 'high',
                'title': f"[待审批] {item['change_type'] or '变更'}",
                'project': item['project_name'],
                'desc': (item['change_desc'] or '')[:60],
                'target_kind': 'approval',
                'project_id': item.get('project_id'),
                'project_name': item.get('project_name'),
            })

        for item in pending_departures:
            focus_items.append({
                'category': 'approval',
                'severity': 'medium',
                'title': f"[待审批] {item['departure_type'] or '离场申请'}",
                'project': item['project_name'],
                'desc': (item['reason'] or '')[:60],
                'target_kind': 'approval',
                'project_id': item.get('project_id'),
                'project_name': item.get('project_name'),
            })

        for item in pending_expenses:
            focus_items.append({
                'category': 'approval',
                'severity': 'low',
                'title': f"[待审批] {item['expense_type'] or '费用报销'}",
                'project': item['project_name'],
                'desc': (item['description'] or '')[:60],
                'target_kind': 'approval',
                'project_id': item.get('project_id'),
                'project_name': item.get('project_name'),
            })

        for item in processing_tasks[:4]:
            focus_items.append({
                'category': 'task',
                'severity': 'low',
                'title': item.get('title'),
                'project': item.get('project_id'),
                'desc': f"后台任务处理中: {item.get('task_type')}",
                'target_kind': 'task',
                'task_id': item.get('task_id'),
                'project_id': item.get('project_id'),
            })

        severity_order = {'urgent': 0, 'high': 1, 'medium': 2, 'low': 3}
        focus_items.sort(key=lambda x: severity_order.get(x.get('severity'), 9))

        return api_response(True, {
            'date': digest.get('date'),
            'scope': scope,
            'summary': {
                'active_projects': digest.get('active_projects', 0) if scope == 'global' else len(allowed_project_ids or []),
                'completed_today': digest.get('completed_today', 0),
                'overdue_count': len([w for w in warnings if w.get('type') == 'milestone_overdue']),
                'warning_total': len(warnings),
                'pending_approvals': len(pending_changes) + len(pending_departures) + len(pending_expenses),
                'processing_tasks': len(processing_tasks),
                'health_score': digest.get('health_score', 0),
            },
            'focus_items': focus_items[:10],
        })
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@app.route('/api/tasks', methods=['GET'])
def list_tasks():
    status = request.args.get('status', '').strip()
    task_type = request.args.get('task_type', '').strip()
    project_id = request.args.get('project_id', type=int)
    keyword = request.args.get('q', '').strip().lower()
    limit = request.args.get('limit', 50, type=int)
    limit = max(1, min(limit or 50, 200))

    db_rows = fetch_task_records(status=status or None, task_type=task_type or None, project_id=project_id, limit=limit)
    memory_rows = list(task_results.values())
    rows_by_id = {row['task_id']: dict(row) for row in db_rows if row.get('task_id')}
    for row in memory_rows:
        if status and row.get('status') != status:
            continue
        if task_type and row.get('task_type') != task_type:
            continue
        if project_id and row.get('project_id') != project_id:
            continue
        rows_by_id[row['task_id']] = dict(row)

    rows = enrich_task_rows(list(rows_by_id.values()))
    if keyword:
        rows = [
            row for row in rows
            if keyword in str(row.get('task_id', '')).lower()
            or keyword in str(row.get('title', '')).lower()
            or keyword in str(row.get('task_type', '')).lower()
            or keyword in str(row.get('status', '')).lower()
            or keyword in str(row.get('project_name', '')).lower()
            or keyword in str(row.get('hospital_name', '')).lower()
            or keyword in str(row.get('payload_summary', '')).lower()
        ]
    rows.sort(key=lambda x: (x.get('updated_at') or '', x.get('created_at') or ''), reverse=True)

    items = []
    for row in rows[:limit]:
        item = dict(row)
        result = item.get('result')
        if isinstance(result, str) and len(result) > 300:
            item['result_preview'] = result[:300] + '...'
            item['result'] = None
        items.append(item)

    summary = {
        'processing': sum(1 for row in rows if row.get('status') == 'processing'),
        'completed': sum(1 for row in rows if row.get('status') == 'completed'),
        'failed': sum(1 for row in rows if row.get('status') == 'failed'),
        'cancelled': sum(1 for row in rows if row.get('status') == 'cancelled'),
        'total': len(rows),
    }
    return api_response(True, {'items': items, 'summary': summary})

@app.route('/tasks-center')
def task_center_page():
    return render_template('task_center.html')

@app.route('/api/tasks/<task_id>', methods=['GET'])
def get_task_result(task_id):
    result = task_results.get(task_id) or fetch_task_record(task_id)
    if result is None:
        return api_response(False, message="任务不存在 (Task not found)", code=404)
    enriched = enrich_task_rows([result])[0]
    return api_response(True, enriched)

@app.route('/api/tasks/<task_id>/download', methods=['GET'])
def download_task_result(task_id):
    task = task_results.get(task_id) or fetch_task_record(task_id)
    if task is None:
        return api_response(False, message="任务不存在 (Task not found)", code=404)

    content = task.get('result') or task.get('error')
    if not content:
        return api_response(False, message="任务暂无可下载内容", code=400)

    fmt = (request.args.get('format') or 'txt').strip().lower()
    if fmt not in ('txt', 'md'):
        fmt = 'txt'

    title = re.sub(r'[\\\\/:*?"<>|]+', '_', task.get('title') or 'task_result').strip('_') or 'task_result'
    filename = f"{title}_{task_id[:8]}.{fmt}"

    response = make_response(content)
    response.headers['Content-Type'] = 'text/markdown; charset=utf-8' if fmt == 'md' else 'text/plain; charset=utf-8'
    response.headers['Content-Disposition'] = f'attachment; filename=\"{filename}\"; filename*=UTF-8\'\'{filename}'
    return response

@app.route('/api/tasks/<task_id>/retry', methods=['POST'])
def retry_task(task_id):
    task_meta = task_registry.get(task_id)
    if task_meta is None:
        return api_response(False, message="任务不存在或不支持重试", code=404)
    if task_results.get(task_id, {}).get('status') == 'processing':
        return api_response(False, message="任务仍在处理中，无法重试", code=400)

    new_task_id = str(uuid.uuid4())
    retry_kwargs = dict(task_meta['kwargs'])
    retry_kwargs['retried_from_task_id'] = task_id
    register_task(new_task_id, task_meta['task_type'], task_meta['title'], task_meta['runner'], *task_meta['args'], **retry_kwargs)
    launch_registered_task(new_task_id)
    return api_response(True, {"task_id": new_task_id, "status": "processing"})

@app.route('/api/tasks/<task_id>/cancel', methods=['POST'])
def cancel_task(task_id):
    task = task_results.get(task_id) or fetch_task_record(task_id)
    if task is None:
        return api_response(False, message="任务不存在", code=404)
    if task.get('status') != 'processing':
        return api_response(False, message="仅处理中任务可取消", code=400)

    update_task_status(task_id, "cancelled", error="任务已手动取消")
    task_registry.pop(task_id, None)
    return api_response(True, {"task_id": task_id, "status": "cancelled"}, message="任务已取消")

@app.route('/api/tasks/cleanup-completed', methods=['POST'])
def cleanup_completed_tasks():
    project_id = request.args.get('project_id', type=int)
    try:
        delete_completed_task_records(project_id=project_id)
        for task_id, row in list(task_results.items()):
            if row.get('status') != 'completed':
                continue
            if project_id and row.get('project_id') != project_id:
                continue
            task_results.pop(task_id, None)
            task_registry.pop(task_id, None)
        return api_response(True, {"message": "已完成任务已清理"})
    except Exception as e:
        return api_response(False, message=str(e), code=500)



# ========== 周报生成 API ==========
# --- Removed buggy partial definition of generate_weekly_report ---
    
# ========== Background Task Helpers ==========
def safe_submit(fn, *args, **kwargs):
    """
    更加健壮的任务提交包装器，旨在解决 ThreadPoolExecutor 在解释器关闭时可能抛出的 RuntimeError
    """
    global executor
    try:
        return executor.submit(fn, *args, **kwargs)
    except RuntimeError:
        # 如果 executor 已被意外关闭，尝试重新创建
        from concurrent.futures import ThreadPoolExecutor
        executor = ThreadPoolExecutor(max_workers=4)
        return executor.submit(fn, *args, **kwargs)

def _run_weekly_report_task(task_id, project_id):
    """后台运行周报生成任务"""
    try:
        with DatabasePool.get_connection() as conn:
            sql_pj = DatabasePool.format_sql('SELECT * FROM projects WHERE id = ?')
            project = dict(conn.execute(sql_pj, (project_id,)).fetchone())
            
            sql_stage = DatabasePool.format_sql('SELECT * FROM project_stages WHERE project_id = ? ORDER BY stage_order')
            stages = [dict(s) for s in conn.execute(sql_stage, (project_id,)).fetchall()]
            
            week_ago = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
            sql_comp = DatabasePool.format_sql('''
                SELECT t.task_name, s.stage_name, t.completed_date 
                FROM tasks t JOIN project_stages s ON t.stage_id = s.id 
                WHERE s.project_id = ? AND t.is_completed = ? AND t.completed_date >= ?
            ''')
            completed_tasks = conn.execute(sql_comp, (project_id, True, week_ago)).fetchall()
            
            sql_new_issue = DatabasePool.format_sql('SELECT * FROM issues WHERE project_id = ? AND created_at >= ?')
            new_issues = conn.execute(sql_new_issue, (project_id, week_ago)).fetchall()
            
            sql_pen_issue = DatabasePool.format_sql("SELECT * FROM issues WHERE project_id = ? AND status != ?")
            pending_issues = conn.execute(sql_pen_issue, (project_id, '已解决')).fetchall()
            
            sql_iface = DatabasePool.format_sql('SELECT * FROM interfaces WHERE project_id = ?')
            interfaces = conn.execute(sql_iface, (project_id,)).fetchall()
            
            sql_log = DatabasePool.format_sql('SELECT * FROM work_logs WHERE project_id = ? AND log_date >= ? ORDER BY log_date')
            work_logs = conn.execute(sql_log, (project_id, week_ago)).fetchall()
        
        system_prompt = """你是一位专业的医疗信息化项目经理，请生成一份正式周报。Markdown格式：
        # 📋 [项目名称] 周报
        **报告周期**: YYYY-MM-DD ~ YYYY-MM-DD
        **项目经理**: XXX | **当前进度**: XX%
        ## 一、本周工作完成情况
        ## 二、当前项目阶段状态 (表格)
        ## 三、问题与风险
        ## 四、下周工作计划
        ## 五、需要协调事项
        
        重要要求：
        1. 表格的表头以及表格内容中严禁使用 `**` (加粗星号)。
        2. 严禁使用任何形式的自定义语法，绝对不能出现 `::: callout` 或类似的提示框语法。
        """
        
        project_data = {
            "project": project, "stages": stages,
            "completed_tasks_this_week": [dict(t) for t in completed_tasks],
            "new_issues_this_week": [dict(i) for i in new_issues],
            "pending_issues": [dict(i) for i in pending_issues],
            "interfaces": [dict(i) for i in interfaces],
            "work_logs_this_week": [dict(w) for w in work_logs],
            "report_date": datetime.now().strftime('%Y-%m-%d')
        }
        
        # Update call with task_type='report'
        report = call_deepseek_api(system_prompt, f"请为以下项目生成周报：\n{json.dumps(project_data, ensure_ascii=False)}", task_type="report")
        
        # 移除前端不支持的标记和意外的加粗星号（尤其是表格中的）
        import re
        report = re.sub(r':::\s*callout[^\n]*', '', report)
        report = report.replace(':::', '')
        
        lines = report.split('\n')
        in_html_table = False
        for i, line in enumerate(lines):
            if '<table' in line:
                in_html_table = True
            
            if in_html_table or '|' in line or '<td' in line or '<th' in line or '<tr' in line:
                lines[i] = line.replace('**', '')
                
            if '</table' in line:
                in_html_table = False
        report = '\n'.join(lines)
        
        if "AI 服务当前不可用" in report or "AI服务暂时不可用" in report:
            raise Exception(report)
            
        data_hash = analytics_service.calculate_project_hash(project_id)
        analytics_service.save_report_cache(project_id, 'weekly_report', report, data_hash)
            
        update_task_status(task_id, "completed", result=report)
        
    except Exception as e:
        update_task_status(task_id, "failed", error=str(e))

@app.route('/api/projects/<int:project_id>/weekly-report', methods=['POST'])
def generate_weekly_report(project_id):
    try:
        force_refresh = request.args.get('force', '0') == '1'
        if not force_refresh:
            cached_data = analytics_service.get_cached_report(project_id, 'weekly_report')
            if cached_data:
                return api_response(True, {
                    'report': cached_data['content'], 
                    'cached': True,
                    'cached_at': cached_data['created_at']
                })
        
        # Generate Task ID
        task_id = str(uuid.uuid4())
        register_task(task_id, 'weekly_report', f'项目周报生成 #{project_id}', _run_weekly_report_task, project_id, source_endpoint=f'/api/projects/{project_id}/weekly-report')
        launch_registered_task(task_id)
        
        return api_response(True, {"task_id": task_id, "status": "processing"})
    except Exception as e:
        app.logger.error(f"Generate Weekly Report Error: {e}")
        return api_response(False, message=f"服务器内部错误: {str(e)}", code=500)


    
def _run_all_report_task(task_id):
    """后台运行全局周报生成任务"""
    try:
        with DatabasePool.get_connection() as conn:
            sql_pj = DatabasePool.format_sql("""
                SELECT * FROM projects WHERE status NOT IN ('已完成', '已终止', '已验收', '质保期')
                ORDER BY priority DESC, progress DESC
            """)
            projects = conn.execute(sql_pj).fetchall()
        
            if not projects:
                update_task_status(task_id, "failed", error="没有进行中的项目")
                return
    
            week_ago = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
            all_data = []
            for p in projects:
                pid = p['id']
                sql_stage = DatabasePool.format_sql('SELECT * FROM project_stages WHERE project_id = ? ORDER BY stage_order')
                stages = [dict(s) for s in conn.execute(sql_stage, (pid,)).fetchall()]
                sql_issue = DatabasePool.format_sql("SELECT * FROM issues WHERE project_id = ? AND status != ?")
                issues = [dict(i) for i in conn.execute(sql_issue, (pid, '已解决')).fetchall()]
                sql_comp = DatabasePool.format_sql('''
                    SELECT t.task_name, s.stage_name, t.completed_date 
                    FROM tasks t JOIN project_stages s ON t.stage_id = s.id 
                    WHERE s.project_id = ? AND t.is_completed = ? AND t.completed_date >= ?
                ''')
                completed_tasks = [dict(t) for t in conn.execute(sql_comp, (pid, True, week_ago)).fetchall()]
                sql_new_issue = DatabasePool.format_sql('SELECT * FROM issues WHERE project_id = ? AND created_at >= ?')
                new_issues = [dict(i) for i in conn.execute(sql_new_issue, (pid, week_ago)).fetchall()]
                sql_iface = DatabasePool.format_sql('SELECT * FROM interfaces WHERE project_id = ?')
                interfaces = [dict(i) for i in conn.execute(sql_iface, (pid,)).fetchall()]
                interface_completed = len([i for i in interfaces if i['status'] == '已完成'])
                sql_log = DatabasePool.format_sql('SELECT SUM(work_hours) as total FROM work_logs WHERE project_id = ? AND log_date >= ?')
                work_hours = conn.execute(sql_log, (pid, week_ago)).fetchone()['total'] or 0
                
                # 数据清洗与摘要 (Summarize to save tokens)
                current_stage = next((s['stage_name'] for s in stages if s.get('status') == '进行中'), "未定")
                
                all_data.append({
                    "项目名称": p['hospital_name'],
                    "项目经理": p['project_manager'] or "未分配",
                    "当前阶段": current_stage,
                    "总体进度": f"{p['progress']}%",
                    "异常风险项": len(issues),
                    "本周完工任务数": len(completed_tasks),
                    "接口状态": f"{interface_completed}/{len(interfaces)}",
                    "本周投入工时": work_hours
                })
        
        system_prompt = """你是一位资深的高级项目总监，负责监督多个医疗信息化实施项目。请生成一份全局项目群分析周报。
        
        报告必须包含以下结构：
        1. ## 一、项目群总体概况 (必须包含一个Markdown表格，列出所有项目的名称、医院、进度、经理和当前状态)
        2. ## 二、重点关注项目
        3. ## 三、共性问题与风险
        4. ## 四、下一步统筹计划
        5. ## 五、需要资源支持
        
        重要要求：
        1. 表格的表头以及表格内容中严禁使用 `**` (加粗星号)。
        2. 严禁使用任何形式的自定义语法，绝对不能出现 `::: callout` 或类似的提示框语法。
        """
        report = call_deepseek_api(system_prompt, f"请基于以下项目数据生成管理周报：\n{json.dumps(all_data, ensure_ascii=False)}", task_type="report")
        
        # 移除前端不支持的标记和意外的加粗星号
        import re
        report = re.sub(r':::\s*callout[^\n]*', '', report)
        report = report.replace(':::', '')
        
        lines = report.split('\n')
        in_html_table = False
        for i, line in enumerate(lines):
            if '<table' in line:
                in_html_table = True
            
            if in_html_table or '|' in line or '<td' in line or '<th' in line or '<tr' in line:
                lines[i] = line.replace('**', '')
                
            if '</table' in line:
                in_html_table = False
        report = '\n'.join(lines)
        
        if "AI 服务当前不可用" in report or "AI服务暂时不可用" in report:
            raise Exception(report)
            
        data_hash = analytics_service.calculate_all_projects_hash()
        analytics_service.save_report_cache(0, 'all_weekly_report', report, data_hash)
            
        update_task_status(task_id, "completed", result=report)
    except Exception as e:
        update_task_status(task_id, "failed", error=str(e))

def _run_knowledge_extract_task(task_id, issue_id):
    """后台运行知识提炼任务。"""
    try:
        from services.ai_insight_service import ai_insight_service
        result = ai_insight_service.auto_extract_knowledge(issue_id)
        if not result.get('success'):
            raise Exception(result.get('message', '知识提炼失败'))
        update_task_status(task_id, "completed", result=json.dumps(result, ensure_ascii=False))
    except Exception as e:
        update_task_status(task_id, "failed", error=str(e))

def _run_report_archive_task(task_id, project_id, report_type, force=False):
    """后台运行报告归档生成任务。"""
    try:
        result = report_scheduler.generate_for_project(project_id, report_type, force)
        if not result.get('success', True):
            raise Exception(result.get('message', '报告归档生成失败'))
        update_task_status(task_id, "completed", result=json.dumps(result, ensure_ascii=False))
    except Exception as e:
        update_task_status(task_id, "failed", error=str(e))

def _run_global_briefing_task(task_id):
    """后台运行全局晨会简报生成任务。"""
    try:
        from services.standup_service import standup_service
        result = standup_service.generate_daily_briefing()
        briefing = result.get('briefing') if isinstance(result, dict) else None
        if not briefing:
            raise Exception(result.get('message', '晨会简报生成失败') if isinstance(result, dict) else '晨会简报生成失败')
        update_task_status(task_id, "completed", result=briefing)
    except Exception as e:
        update_task_status(task_id, "failed", error=str(e))

def _run_ai_cruise_task(task_id):
    """后台运行 AI 巡航体检任务。"""
    try:
        from services.cruise_service import cruise_service
        result = cruise_service.run_daily_cruise()
        update_task_status(task_id, "completed", result=json.dumps(result, ensure_ascii=False))
    except Exception as e:
        update_task_status(task_id, "failed", error=str(e))

@app.route('/api/weekly-report/all', methods=['POST'])
def generate_all_projects_report():
    force_refresh = request.args.get('force', '0') == '1'
    if not force_refresh:
        cached_data = analytics_service.get_cached_report(0, 'all_weekly_report')
        if cached_data:
            return api_response(True, {
                'report': cached_data['content'], 
                'cached': True,
                'cached_at': cached_data['created_at']
            })
    task_id = str(uuid.uuid4())
    register_task(task_id, 'all_weekly_report', '全局周报生成', _run_all_report_task, source_endpoint='/api/weekly-report/all')
    launch_registered_task(task_id)
    return api_response(True, {"task_id": task_id, "status": "processing"})

@app.route('/api/ai/knowledge/extract/async', methods=['POST'])
def auto_extract_knowledge_async():
    """异步触发知识提炼，纳入任务中心。"""
    data = request.json or {}
    issue_id = data.get('issue_id')
    if not issue_id:
        return api_response(False, message="缺少 issue_id 参数", code=400)

    try:
        with DatabasePool.get_connection() as conn:
            issue = conn.execute(
                DatabasePool.format_sql('SELECT id, description, project_id FROM issues WHERE id = ?'),
                (issue_id,),
            ).fetchone()
            if not issue:
                return api_response(False, message='问题不存在', code=404)

        task_id = str(uuid.uuid4())
        summary = str(issue['description'])[:60]
        register_task(
            task_id,
            'knowledge_extract',
            f"知识提炼 #{issue_id} {summary}",
            _run_knowledge_extract_task,
            issue_id,
            project_id=issue.get('project_id'),
            payload_summary=summary,
            source_endpoint='/api/ai/knowledge/extract/async',
        )
        launch_registered_task(task_id)
        return api_response(True, {"task_id": task_id, "status": "processing"})
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@app.route('/api/standup/briefing/async', methods=['POST'])
def generate_daily_briefing_async():
    """异步生成全局晨会简报，纳入任务中心。"""
    try:
        task_id = str(uuid.uuid4())
        register_task(task_id, 'global_briefing', '全局晨会简报', _run_global_briefing_task, source_endpoint='/api/standup/briefing/async')
        launch_registered_task(task_id)
        return api_response(True, {"task_id": task_id, "status": "processing"})
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@app.route('/api/ai/cruise/async', methods=['POST'])
def run_daily_cruise_async():
    """异步执行 AI 巡航体检，纳入任务中心。"""
    try:
        task_id = str(uuid.uuid4())
        register_task(task_id, 'ai_cruise', 'AI巡航体检', _run_ai_cruise_task, source_endpoint='/api/ai/cruise/async')
        launch_registered_task(task_id)
        return api_response(True, {"task_id": task_id, "status": "processing"})
    except Exception as e:
        return api_response(False, message=str(e), code=500)

# ========== 燃尽图数据 API ==========
@app.route('/api/projects/<int:project_id>/burndown', methods=['GET'])
def get_burndown_data(project_id):
    with DatabasePool.get_connection() as conn:
        sql_pj = DatabasePool.format_sql('SELECT * FROM projects WHERE id = ?')
        project = conn.execute(sql_pj, (project_id,)).fetchone()
        if not project:
            return jsonify({'error': '项目不存在'}), 404
        
        # 获取历史记录
        sql_history = DatabasePool.format_sql('''
            SELECT record_date, progress, tasks_total, tasks_completed 
            FROM progress_history WHERE project_id = ? ORDER BY record_date
        ''')
        history = conn.execute(sql_history, (project_id,)).fetchall()
        
        # 获取当前状态
        sql_tasks = DatabasePool.format_sql('''
            SELECT COUNT(*) as total, SUM(CASE WHEN is_completed = ? THEN 1 ELSE 0 END) as completed
            FROM tasks t JOIN project_stages s ON t.stage_id = s.id WHERE s.project_id = ?
        ''')
        tasks_stats = conn.execute(sql_tasks, (True, project_id,)).fetchone()
        total_tasks = tasks_stats['total'] or 0
        completed_tasks = tasks_stats['completed'] or 0
        
        start_date_str = project['plan_start_date'] or str(project['created_at'])[:10]
        end_date_str = project['plan_end_date'] or (datetime.now() + timedelta(days=30)).strftime('%Y-%m-%d')
        
        try:
            start_date = datetime.strptime(start_date_str, '%Y-%m-%d')
            end_date = datetime.strptime(end_date_str, '%Y-%m-%d')
        except:
            start_date = datetime.now() - timedelta(days=30)
            end_date = datetime.now() + timedelta(days=30)
        
        total_days = (end_date - start_date).days or 1
        today = datetime.now()
        
        ideal_line = []
        for i in range(total_days + 1):
            curr = start_date + timedelta(days=i)
            ideal_rem = total_tasks - (total_tasks * i / total_days)
            ideal_line.append({'date': curr.strftime('%Y-%m-%d'), 'value': round(max(0, ideal_rem), 1)})
        
        actual_line = []
        if history:
            for row in history:
                actual_line.append({'date': row['record_date'], 'value': row['tasks_total'] - row['tasks_completed']})
            
            # 如果最后一条记录不是今天，添加今天的实时数据
            if str(history[-1]['record_date'])[:10] != today.strftime('%Y-%m-%d'):
                actual_line.append({'date': today.strftime('%Y-%m-%d'), 'value': total_tasks - completed_tasks})
        else:
            # 兜底：如果没有历史记录，生成简单的两点线（开始日和今日）
            actual_line.append({'date': start_date.strftime('%Y-%m-%d'), 'value': total_tasks})
            if today > start_date:
                actual_line.append({'date': today.strftime('%Y-%m-%d'), 'value': total_tasks - completed_tasks})

        return jsonify({
            'project_name': project['project_name'],
            'total_tasks': total_tasks,
            'completed_tasks': completed_tasks,
            'ideal_line': ideal_line,
            'actual_line': actual_line
        })

# ========== 仪表盘统计 API ==========
@app.route('/api/dashboard/stats', methods=['GET'])
@cached(ttl=60)
def get_dashboard_stats():
    with DatabasePool.get_connection() as conn:
        total_projects = conn.execute(DatabasePool.format_sql("SELECT COUNT(*) as c FROM projects")).fetchone()['c']
        in_progress = conn.execute(DatabasePool.format_sql("SELECT COUNT(*) as c FROM projects WHERE status = ?"), ('进行中',)).fetchone()['c']
        completed = conn.execute(DatabasePool.format_sql("SELECT COUNT(*) as c FROM projects WHERE status = ?"), ('已完成',)).fetchone()['c']
        
        today_str = datetime.now().strftime('%Y-%m-%d')
        sql_delayed = DatabasePool.format_sql("SELECT COUNT(*) as c FROM projects WHERE plan_end_date < ? AND status NOT IN ('已完成', '已终止', '已验收', '质保期')")
        delayed = conn.execute(sql_delayed, (today_str,)).fetchone()['c']
        
        on_departure = conn.execute(DatabasePool.format_sql("SELECT COUNT(*) as c FROM projects WHERE status IN ('暂停', '离场待返')")).fetchone()['c']
        total_issues = conn.execute(DatabasePool.format_sql("SELECT COUNT(*) as c FROM issues WHERE status != ?"), ('已解决',)).fetchone()['c']
        critical_issues = conn.execute(DatabasePool.format_sql("SELECT COUNT(*) as c FROM issues WHERE status != ? AND severity = ?"), ('已解决', '高')).fetchone()['c']
        
        week_ago = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
        sql_task_comp = DatabasePool.format_sql("SELECT COUNT(*) as c FROM tasks WHERE is_completed = ? AND completed_date >= ?")
        tasks_completed_this_week = conn.execute(sql_task_comp, (True, week_ago,)).fetchone()['c']
        
        # 统计逾期里程碑总数
        sql_overdue_m = DatabasePool.format_sql('''
            SELECT COUNT(*) as c FROM milestones 
            WHERE is_completed = ? AND target_date < ?
        ''')
        overdue_milestones_total = conn.execute(sql_overdue_m, (False, today_str)).fetchone()['c']

    
        # 按状态分组统计
        status_stats = conn.execute(DatabasePool.format_sql('''
            SELECT status, COUNT(*) as count FROM projects GROUP BY status
        ''')).fetchall()
        
        projects_progress = []
        sql_proj_prog = DatabasePool.format_sql('''
            SELECT p.id, p.project_name, p.hospital_name, p.progress, p.status, p.plan_end_date,
            (SELECT COUNT(*) FROM milestones m_ov WHERE m_ov.project_id = p.id AND m_ov.is_completed = ? AND m_ov.target_date < ?) as overdue_count
            FROM projects p WHERE p.status NOT IN ('已完成', '已终止', '已验收', '质保期') 
            ORDER BY overdue_count DESC, progress DESC
        ''')
        rows = conn.execute(sql_proj_prog, (False, today_str)).fetchall()
        
        for row in rows:
            p_dict = dict(row)
            # 判定阶段
            if p_dict['status'] in ['暂停', '离场待返']: p_dict['phase'] = '离场'
            elif p_dict['plan_end_date'] and str(p_dict['plan_end_date']) < today_str: p_dict['phase'] = '延期'
            elif p_dict['progress'] < 30: p_dict['phase'] = '启动期'
            elif p_dict['progress'] < 70: p_dict['phase'] = '实施中'
            else: p_dict['phase'] = '收尾期'
            
            projects_progress.append(p_dict)

    
        sql_notif = DatabasePool.format_sql('''
            SELECT n.*, p.project_name 
            FROM notifications n 
            LEFT JOIN projects p ON n.project_id = p.id
            WHERE n.is_read = ? AND (n.due_date IS NULL OR n.due_date >= ?)
            ORDER BY n.due_date ASC LIMIT 10
        ''')
        upcoming_reminders = conn.execute(sql_notif, (False, today_str)).fetchall()
        
        # 本周工时统计
        sql_hours = DatabasePool.format_sql('SELECT SUM(work_hours) as total FROM work_logs WHERE log_date >= ?')
        week_hours = conn.execute(sql_hours, (week_ago,)).fetchone()['total'] or 0
    
    return api_response(True, {
        'stats': {
            'total_projects': total_projects, 'in_progress': in_progress,
            'completed': completed, 'delayed': delayed, 'on_departure': on_departure,
            'total_issues': total_issues, 'critical_issues': critical_issues,
            'tasks_completed_this_week': tasks_completed_this_week,
            'week_hours': round(week_hours, 1),
            'overdue_milestones': overdue_milestones_total
        },
        'status_stats': [dict(s) for s in status_stats],
        'projects_progress': [dict(p) for p in projects_progress],
        'upcoming_reminders': [dict(r) for r in upcoming_reminders]
    })


# ========== Analytics and Performance - Handled by analytics_bp



# ========== Notifications API - Migrated to monitor_routes ==========


# ========== 项目里程碑管理 (已迁移至 Blueprint) ==========


# ========== 项目基础 CRUD (已迁移至 Blueprint) ==========


# ========== 项目基础 CRUD (已迁移至 Blueprint) ==========

# ========== 阶段/任务 API (Migrated to task_routes) ==========

# ========== 接口管理 API ==========

# ========== 接口管理 API (已迁移至 Blueprint) ==========

# ========== 问题管理 API (已迁移至 project_routes.py) ==========


# ========== Gantt Chart Data - Handled by analytics_bp

# ==================== V2.0 新增 API ====================

# ========== 角色管理 API (Placeholder) ==========

# ========== 工作日志 API (Migrated to log_routes) ==========

# ========== 文档管理 API (Migrated to doc_routes) ==========

# ========== 变更管理 API (Migrated to lifecycle_routes) ==========

# ========== 验收管理 API (Migrated to lifecycle_routes) ==========

# ========== 客户满意度 API (Migrated to lifecycle_routes) ==========

# ========== 回访记录 API (Migrated to lifecycle_routes) ==========

# ========== 操作日志 API ==========
@app.route('/api/operation-logs', methods=['GET'])
def get_operation_logs():
    with DatabasePool.get_connection() as conn:
        entity_type = request.args.get('entity_type')
        entity_id = request.args.get('entity_id')
        
        query_text = 'SELECT * FROM operation_logs WHERE 1=1'
        params = []
        
        if entity_type:
            query_text += ' AND entity_type = ?'
            params.append(entity_type)
        if entity_id:
            query_text += ' AND entity_id = ?'
            params.append(entity_id)
        
        query_text += ' ORDER BY created_at DESC LIMIT 100'
        logs = conn.execute(DatabasePool.format_sql(query_text), params).fetchall()
        return jsonify([dict(l) for l in logs])

# ========== 数据导出 API ==========
@app.route('/api/projects/<int:project_id>/export', methods=['GET'])
def export_project_data(project_id):
    """导出项目完整数据为JSON"""
    with DatabasePool.get_connection() as conn:
        sql_p = DatabasePool.format_sql('SELECT * FROM projects WHERE id = ?')
        project = dict(conn.execute(sql_p, (project_id,)).fetchone())
        
        sql_s = DatabasePool.format_sql('SELECT * FROM project_stages WHERE project_id = ?')
        stages = [dict(s) for s in conn.execute(sql_s, (project_id,)).fetchall()]
        
        for stage in stages:
            sql_t = DatabasePool.format_sql('SELECT * FROM tasks WHERE stage_id = ?')
            stage['tasks'] = [dict(t) for t in conn.execute(sql_t, (stage['id'],)).fetchall()]
        
        data = {
            'export_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'project': project,
            'stages': stages,
            'interfaces': [dict(i) for i in conn.execute(DatabasePool.format_sql('SELECT * FROM interfaces WHERE project_id = ?'), (project_id,)).fetchall()],
            'issues': [dict(i) for i in conn.execute(DatabasePool.format_sql('SELECT * FROM issues WHERE project_id = ?'), (project_id,)).fetchall()],
            'milestones': [dict(m) for m in conn.execute(DatabasePool.format_sql('SELECT * FROM milestones WHERE project_id = ?'), (project_id,)).fetchall()],
            'members': [dict(m) for m in conn.execute(DatabasePool.format_sql('SELECT * FROM project_members WHERE project_id = ?'), (project_id,)).fetchall()],
            'contacts': [dict(c) for c in conn.execute(DatabasePool.format_sql('SELECT * FROM customer_contacts WHERE project_id = ?'), (project_id,)).fetchall()],
            'departures': [dict(d) for d in conn.execute(DatabasePool.format_sql('SELECT * FROM project_departures WHERE project_id = ?'), (project_id,)).fetchall()],
            'work_logs': [dict(w) for w in conn.execute(DatabasePool.format_sql('SELECT * FROM work_logs WHERE project_id = ?'), (project_id,)).fetchall()],
            'documents': [dict(d) for d in conn.execute(DatabasePool.format_sql('SELECT * FROM project_documents WHERE project_id = ?'), (project_id,)).fetchall()],
            'expenses': [dict(e) for e in conn.execute(DatabasePool.format_sql('SELECT * FROM project_expenses WHERE project_id = ?'), (project_id,)).fetchall()],
            'changes': [dict(c) for c in conn.execute(DatabasePool.format_sql('SELECT * FROM project_changes WHERE project_id = ?'), (project_id,)).fetchall()],
            'acceptances': [dict(a) for a in conn.execute(DatabasePool.format_sql('SELECT * FROM project_acceptances WHERE project_id = ?'), (project_id,)).fetchall()],
            'satisfaction': [dict(s) for s in conn.execute(DatabasePool.format_sql('SELECT * FROM customer_satisfaction WHERE project_id = ?'), (project_id,)).fetchall()],
            'follow_ups': [dict(f) for f in conn.execute(DatabasePool.format_sql('SELECT * FROM follow_up_records WHERE project_id = ?'), (project_id,)).fetchall()],
            'devices': [dict(d) for d in conn.execute(DatabasePool.format_sql('SELECT * FROM medical_devices WHERE project_id = ?'), (project_id,)).fetchall()]
        }
        
    return jsonify(data)


# ========== Global Analytics - Handled by analytics_bp

# ========== 审批中心 API ==========
@app.route('/api/approvals/pending', methods=['GET'])
def get_pending_approvals():
    """获取所有待审批项"""
    with DatabasePool.get_connection() as conn:
        sql_changes = DatabasePool.format_sql('''
            SELECT c.*, p.project_name, p.hospital_name 
            FROM project_changes c
            JOIN projects p ON c.project_id = p.id
            WHERE c.status = ?
        ''')
        changes = conn.execute(sql_changes, ('待审批',)).fetchall()

        sql_departures = DatabasePool.format_sql('''
            SELECT d.*, p.project_name, p.hospital_name
            FROM project_departures d
            JOIN projects p ON d.project_id = p.id
            WHERE d.status = ?
        ''')
        departures = conn.execute(sql_departures, ('待审批',)).fetchall()

        sql_expenses = DatabasePool.format_sql('''
            SELECT e.*, p.project_name, p.hospital_name
            FROM project_expenses e
            JOIN projects p ON e.project_id = p.id
            WHERE e.status = ?
        ''')
        expenses = conn.execute(sql_expenses, ('待报销',)).fetchall()
        
        return jsonify({
            'changes': [dict(c) for c in changes],
            'departures': [dict(d) for d in departures],
            'expenses': [dict(e) for e in expenses]
        })

@app.route('/api/approvals/tracking', methods=['GET'])
def get_approval_tracking():
    """获取审批追踪列表，统一展示离场 / 变更 / 费用审批。"""
    limit = request.args.get('limit', 50, type=int)
    limit = max(1, min(limit or 50, 200))

    with DatabasePool.get_connection() as conn:
        rows = []

        change_rows = conn.execute(DatabasePool.format_sql('''
            SELECT
                'change' as biz_type,
                c.id as biz_id,
                c.project_id,
                p.project_name,
                p.hospital_name,
                c.change_title as title,
                c.change_type as sub_type,
                c.status,
                c.requested_by as applicant,
                c.approval_sp_no,
                c.approved_date as approved_at,
                c.created_at
            FROM project_changes c
            JOIN projects p ON c.project_id = p.id
            WHERE c.approval_sp_no IS NOT NULL AND c.approval_sp_no != ''
            ORDER BY c.created_at DESC
        ''')).fetchall()
        rows.extend(dict(r) for r in change_rows)

        expense_rows = conn.execute(DatabasePool.format_sql('''
            SELECT
                'expense' as biz_type,
                e.id as biz_id,
                e.project_id,
                p.project_name,
                p.hospital_name,
                e.description as title,
                e.expense_type as sub_type,
                e.status,
                e.applicant,
                e.approval_sp_no,
                e.approved_at,
                e.created_at
            FROM project_expenses e
            JOIN projects p ON e.project_id = p.id
            WHERE e.approval_sp_no IS NOT NULL AND e.approval_sp_no != ''
            ORDER BY e.created_at DESC
        ''')).fetchall()
        rows.extend(dict(r) for r in expense_rows)

        departure_rows = conn.execute(DatabasePool.format_sql('''
            SELECT
                'departure' as biz_type,
                d.id as biz_id,
                d.project_id,
                p.project_name,
                p.hospital_name,
                d.reason as title,
                d.departure_type as sub_type,
                d.status,
                d.handover_person as applicant,
                d.approval_sp_no,
                d.approved_at,
                d.created_at
            FROM project_departures d
            JOIN projects p ON d.project_id = p.id
            WHERE d.approval_sp_no IS NOT NULL AND d.approval_sp_no != ''
            ORDER BY d.created_at DESC
        ''')).fetchall()
        rows.extend(dict(r) for r in departure_rows)

    rows.sort(key=lambda x: str(x.get('created_at') or ''), reverse=True)
    return api_response(True, rows[:limit])

@app.route('/api/approvals/remind', methods=['POST'])
def remind_pending_approvals():
    """批量催办待审批事项，生成系统通知"""
    data = request.json or {}
    items = data.get('items', [])
    if not items:
        return api_response(False, message='缺少待催办审批项', code=400)

    from services.monitor_service import monitor_service

    reminded = 0
    with DatabasePool.get_connection() as conn:
        for item in items:
            biz_type = item.get('biz_type')
            biz_id = item.get('biz_id')
            if not biz_type or not biz_id:
                continue

            if biz_type == 'change':
                sql_text = '''
                    SELECT c.project_id, p.project_name, c.change_title as title
                    FROM project_changes c
                    JOIN projects p ON c.project_id = p.id
                    WHERE c.id = ?
                '''
            elif biz_type == 'expense':
                sql_text = '''
                    SELECT e.project_id, p.project_name, e.description as title
                    FROM project_expenses e
                    JOIN projects p ON e.project_id = p.id
                    WHERE e.id = ?
                '''
            elif biz_type == 'departure':
                sql_text = '''
                    SELECT d.project_id, p.project_name, d.reason as title
                    FROM project_departures d
                    JOIN projects p ON d.project_id = p.id
                    WHERE d.id = ?
                '''
            else:
                continue

            row = conn.execute(DatabasePool.format_sql(sql_text), (biz_id,)).fetchone()
            if not row:
                continue

            monitor_service.create_notification({
                'project_id': row['project_id'],
                'title': f"⏰ 审批催办：{biz_type}",
                'content': f"项目【{row['project_name']}】的审批事项待跟进：{row['title'] or '未命名事项'}",
                'type': 'warning'
            })
            reminded += 1

    return api_response(True, {'reminded': reminded}, message=f'已催办 {reminded} 条审批')

@app.route('/api/approvals/<biz_type>/<int:biz_id>', methods=['GET'])
def get_approval_detail(biz_type, biz_id):
    """获取审批详情与时间线"""
    type_mapping = {
        'change': {
            'table': 'project_changes',
            'title_field': 'change_title',
            'sub_type_field': 'change_type',
            'applicant_field': 'requested_by',
            'content_field': 'change_desc',
            'approved_field': 'approved_date',
        },
        'expense': {
            'table': 'project_expenses',
            'title_field': 'description',
            'sub_type_field': 'expense_type',
            'applicant_field': 'applicant',
            'content_field': 'description',
            'approved_field': 'approved_at',
        },
        'departure': {
            'table': 'project_departures',
            'title_field': 'reason',
            'sub_type_field': 'departure_type',
            'applicant_field': 'handover_person',
            'content_field': 'reason',
            'approved_field': 'approved_at',
        },
    }
    config = type_mapping.get(biz_type)
    if not config:
        return api_response(False, message='不支持的审批类型', code=400)

    with DatabasePool.get_connection() as conn:
        sql_detail = DatabasePool.format_sql(f'''
            SELECT
                t.*,
                p.project_name,
                p.hospital_name
            FROM {config["table"]} t
            JOIN projects p ON t.project_id = p.id
            WHERE t.id = ?
        ''')
        row = conn.execute(sql_detail, (biz_id,)).fetchone()
        if not row:
            return api_response(False, message='审批记录不存在', code=404)

        detail = dict(row)
        approval_detail = {}
        approval_nodes = []
        approval_error = None
        approval_sp_no = detail.get('approval_sp_no')

        if approval_sp_no:
            try:
                from services.wecom_service import wecom_service
                approval_detail = wecom_service.get_approval_detail(approval_sp_no) or {}
                if approval_detail.get('errcode') == 0:
                    approve_nodes = (((approval_detail.get('info') or {}).get('apply_data') or {}).get('contents') or [])
                    approval_nodes = approve_nodes
                elif approval_detail.get('errmsg'):
                    approval_error = approval_detail.get('errmsg')
            except Exception as e:
                approval_error = str(e)

        timeline = []
        created_at = detail.get('created_at')
        if created_at:
            timeline.append({'label': '提交申请', 'time': str(created_at), 'status': 'done'})
        if detail.get('approval_sp_no'):
            timeline.append({'label': '已发起审批', 'time': str(detail.get('created_at') or ''), 'status': 'done', 'extra': detail.get('approval_sp_no')})
        if detail.get('status') == '审批中':
            timeline.append({'label': '审批中', 'time': '', 'status': 'processing'})
        if detail.get(config['approved_field']):
            timeline.append({'label': detail.get('status') or '审批完成', 'time': str(detail.get(config['approved_field'])), 'status': 'done'})
        elif detail.get('status') in ('已驳回', '已撤销'):
            timeline.append({'label': detail.get('status'), 'time': str(detail.get(config['approved_field']) or ''), 'status': 'failed'})

        result = {
            'biz_type': biz_type,
            'biz_id': biz_id,
            'project_id': detail.get('project_id'),
            'project_name': detail.get('project_name'),
            'hospital_name': detail.get('hospital_name'),
            'title': detail.get(config['title_field']) or f'{biz_type} 审批',
            'sub_type': detail.get(config['sub_type_field']),
            'applicant': detail.get(config['applicant_field']),
            'status': detail.get('status'),
            'approval_sp_no': detail.get('approval_sp_no'),
            'content': detail.get(config['content_field']) or '',
            'detail': detail,
            'timeline': timeline,
            'wecom_detail': approval_detail,
            'wecom_nodes': approval_nodes,
            'wecom_error': approval_error,
        }
        return api_response(True, data=result)

@app.route('/api/resources/overview', methods=['GET'])
def get_resource_overview():
    """资源排班总览：成员、城市、项目占用、待办任务、负载评分。"""
    try:
        data = project_service.get_geo_stats()
        raw_members = data.get('members', [])

        member_map = {}
        for member in raw_members:
            name = member.get('name') or '未知成员'
            entry = member_map.setdefault(name, {
                'name': name,
                'role': member.get('role'),
                'lng': member.get('lng'),
                'lat': member.get('lat'),
                'current_city': member.get('current_city'),
                'project_name': member.get('project_name'),
                'project_count': member.get('project_count', 0),
                'task_count': member.get('task_count', 0),
                'load_score': member.get('load_score', 0),
                'project_names': set(),
            })
            if member.get('project_name'):
                entry['project_names'].add(member['project_name'])
                if not entry.get('project_name'):
                    entry['project_name'] = member['project_name']
            entry['project_count'] = max(entry.get('project_count', 0), member.get('project_count', 0) or 0)
            entry['task_count'] = max(entry.get('task_count', 0), member.get('task_count', 0) or 0)
            entry['load_score'] = max(entry.get('load_score', 0), member.get('load_score', 0) or 0)
            if not entry.get('current_city') and member.get('current_city'):
                entry['current_city'] = member.get('current_city')
            if not entry.get('role') and member.get('role'):
                entry['role'] = member.get('role')

        members = []
        for entry in member_map.values():
            projects = sorted(entry.pop('project_names'))
            entry['project_name'] = entry.get('project_name') or (projects[0] if projects else '')
            entry['project_names'] = projects
            entry['project_summary'] = ' / '.join(projects[:3]) + (' 等' if len(projects) > 3 else '')
            members.append(entry)

        city_summary = {}
        for member in members:
            city = member.get('current_city') or '未定位'
            city_summary.setdefault(city, {
                'city': city,
                'member_count': 0,
                'onsite_count': 0,
                'total_tasks': 0,
                'avg_load_score': 0,
            })
            city_summary[city]['member_count'] += 1
            if member.get('role') and member.get('project_name'):
                pass
            if member.get('load_score') is not None:
                city_summary[city]['avg_load_score'] += member.get('load_score', 0)
            if member.get('task_count'):
                city_summary[city]['total_tasks'] += member.get('task_count', 0)

        with DatabasePool.get_connection() as conn:
            onsite_rows = conn.execute(DatabasePool.format_sql('''
                SELECT current_city, COUNT(*) as c
                FROM project_members
                WHERE status = '在岗' AND is_onsite = ?
                GROUP BY current_city
            '''), (True,)).fetchall()
            onsite_map = {row['current_city'] or '未定位': row['c'] for row in onsite_rows}

        for city, item in city_summary.items():
            item['onsite_count'] = onsite_map.get(city, 0)
            item['avg_load_score'] = round(item['avg_load_score'] / max(item['member_count'], 1), 1)

        cities = sorted(city_summary.values(), key=lambda x: (-x['member_count'], x['city']))
        members.sort(key=lambda x: (-x.get('load_score', 0), x.get('name', '')))

        high_load = [m for m in members if (m.get('load_score') or 0) >= 70][:5]
        low_load = [m for m in members if (m.get('load_score') or 0) < 40][:5]
        suggestions = []
        for busy in high_load:
            candidate = next((m for m in low_load if m.get('name') != busy.get('name')), None)
            if not candidate:
                continue
            suggestions.append({
                'from_member': busy.get('name'),
                'from_city': busy.get('current_city'),
                'from_project': busy.get('project_name'),
                'to_member': candidate.get('name'),
                'to_city': candidate.get('current_city'),
                'to_project': candidate.get('project_name'),
                'reason': f"{busy.get('name')} 当前负载 {busy.get('load_score', 0)}，可考虑让 {candidate.get('name')} 分担非核心任务。",
            })

        return api_response(True, {
            'summary': {
                'total_members': len(members),
                'onsite_members': sum(item['onsite_count'] for item in cities),
                'busy_members': sum(1 for m in members if (m.get('load_score') or 0) >= 70),
                'available_members': sum(1 for m in members if (m.get('load_score') or 0) < 40),
                'covered_cities': len(cities),
            },
            'cities': cities,
            'members': members,
            'suggestions': suggestions,
        })
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@app.route('/api/resources/member-detail', methods=['GET'])
def get_resource_member_detail():
    """资源成员详情：关联项目与未完成任务。"""
    name = (request.args.get('name') or '').strip()
    if not name:
        return api_response(False, message='缺少成员姓名', code=400)

    try:
        with DatabasePool.get_connection() as conn:
            projects = conn.execute(DatabasePool.format_sql('''
                SELECT DISTINCT p.id, p.project_name, p.hospital_name, p.status, pm.role, pm.current_city, pm.is_onsite
                FROM project_members pm
                JOIN projects p ON pm.project_id = p.id
                WHERE pm.name = ? AND pm.status = '在岗'
                ORDER BY p.updated_at DESC
            '''), (name,)).fetchall()

            tasks = conn.execute(DatabasePool.format_sql('''
                SELECT t.id, t.task_name, s.stage_name, p.id as project_id, p.project_name
                FROM tasks t
                JOIN project_stages s ON t.stage_id = s.id
                JOIN projects p ON s.project_id = p.id
                WHERE s.responsible_person = ? AND t.is_completed = ?
                ORDER BY p.project_name, s.stage_order
            '''), (name, False)).fetchall()

            logs = conn.execute(DatabasePool.format_sql('''
                SELECT project_id, log_date, work_content, issues_encountered, tomorrow_plan
                FROM work_logs
                WHERE member_name = ?
                ORDER BY log_date DESC
                LIMIT 8
            '''), (name,)).fetchall()

        return api_response(True, {
            'name': name,
            'projects': [dict(row) for row in projects],
            'tasks': [dict(row) for row in tasks],
            'logs': [dict(row) for row in logs],
        })
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@app.route('/api/financial/overview', methods=['GET'])
def get_financial_overview():
    """经营看板：合同、回款、报销、人力成本、毛利。"""
    try:
        with DatabasePool.get_connection() as conn:
            summary = conn.execute(DatabasePool.format_sql('''
                SELECT
                    COALESCE(SUM(contract_amount), 0) as contract_total,
                    COUNT(*) as project_count
                FROM projects
            ''')).fetchone()

            revenue = conn.execute(DatabasePool.format_sql('''
                SELECT COALESCE(SUM(amount), 0) as total
                FROM project_revenue
            ''')).fetchone()['total'] or 0

            expenses = conn.execute(DatabasePool.format_sql('''
                SELECT COALESCE(SUM(amount), 0) as total
                FROM project_expenses
                WHERE status = '已报销'
            ''')).fetchone()['total'] or 0

            labor = conn.execute(DatabasePool.format_sql('''
                SELECT COALESCE(SUM(wl.work_hours / 8.0 * pm.daily_rate), 0) as total
                FROM work_logs wl
                JOIN project_members pm ON wl.member_id = pm.id
            ''')).fetchone()['total'] or 0

            project_rows = conn.execute(DatabasePool.format_sql('''
                SELECT
                    p.id,
                    p.project_name,
                    p.hospital_name,
                    p.contract_amount,
                    COALESCE((SELECT SUM(r.amount) FROM project_revenue r WHERE r.project_id = p.id), 0) as collected_amount,
                    COALESCE((SELECT SUM(e.amount) FROM project_expenses e WHERE e.project_id = p.id AND e.status = '已报销'), 0) as reimbursed_amount,
                    COALESCE((
                        SELECT SUM(wl.work_hours / 8.0 * pm.daily_rate)
                        FROM work_logs wl
                        JOIN project_members pm ON wl.member_id = pm.id
                        WHERE wl.project_id = p.id
                    ), 0) as labor_cost
                FROM projects p
                ORDER BY collected_amount DESC, contract_amount DESC
            ''')).fetchall()

            revenue_rows = conn.execute(DatabasePool.format_sql('''
                SELECT SUBSTR(CAST(revenue_date AS TEXT), 1, 7) as month, COALESCE(SUM(amount), 0) as total
                FROM project_revenue
                WHERE revenue_date IS NOT NULL
                GROUP BY SUBSTR(CAST(revenue_date AS TEXT), 1, 7)
                ORDER BY month DESC
                LIMIT 12
            ''')).fetchall()

            expense_rows = conn.execute(DatabasePool.format_sql('''
                SELECT SUBSTR(CAST(expense_date AS TEXT), 1, 7) as month, COALESCE(SUM(amount), 0) as total
                FROM project_expenses
                WHERE expense_date IS NOT NULL AND status = '已报销'
                GROUP BY SUBSTR(CAST(expense_date AS TEXT), 1, 7)
                ORDER BY month DESC
                LIMIT 12
            ''')).fetchall()

            labor_rows = conn.execute(DatabasePool.format_sql('''
                SELECT SUBSTR(CAST(wl.log_date AS TEXT), 1, 7) as month,
                       COALESCE(SUM(wl.work_hours / 8.0 * pm.daily_rate), 0) as total
                FROM work_logs wl
                JOIN project_members pm ON wl.member_id = pm.id
                WHERE wl.log_date IS NOT NULL
                GROUP BY SUBSTR(CAST(wl.log_date AS TEXT), 1, 7)
                ORDER BY month DESC
                LIMIT 12
            ''')).fetchall()

        projects = []
        loss_projects = 0
        anomaly_projects = []
        for row in project_rows:
            item = dict(row)
            gross_profit = (item.get('collected_amount') or 0) - (item.get('reimbursed_amount') or 0) - (item.get('labor_cost') or 0)
            item['gross_profit'] = round(gross_profit, 2)
            item['margin'] = round((gross_profit / item['collected_amount'] * 100), 2) if item.get('collected_amount') else 0
            item['uncollected_amount'] = round((item.get('contract_amount') or 0) - (item.get('collected_amount') or 0), 2)
            if gross_profit < 0:
                loss_projects += 1
                anomaly_projects.append({
                    'project_id': item.get('id'),
                    'project_name': item.get('project_name'),
                    'type': 'loss',
                    'message': f"项目毛利为负：{round(gross_profit, 2)} 元"
                })
            elif item['margin'] < 10 and item.get('collected_amount'):
                anomaly_projects.append({
                    'project_id': item.get('id'),
                    'project_name': item.get('project_name'),
                    'type': 'low_margin',
                    'message': f"项目毛利率偏低：{item['margin']}%"
                })
            if item['uncollected_amount'] > 0:
                anomaly_projects.append({
                    'project_id': item.get('id'),
                    'project_name': item.get('project_name'),
                    'type': 'uncollected',
                    'message': f"仍有未回款：{item['uncollected_amount']} 元"
                })
            projects.append(item)

        revenue_map = {row['month']: float(row['total'] or 0) for row in revenue_rows if row.get('month')}
        expense_map = {row['month']: float(row['total'] or 0) for row in expense_rows if row.get('month')}
        labor_map = {row['month']: float(row['total'] or 0) for row in labor_rows if row.get('month')}
        months = sorted(set(revenue_map) | set(expense_map) | set(labor_map))
        months = months[-6:]
        monthly_trend = []
        for month in months:
            collected = revenue_map.get(month, 0)
            reimbursed = expense_map.get(month, 0)
            labor_cost = labor_map.get(month, 0)
            monthly_trend.append({
                'month': month,
                'collected': round(collected, 2),
                'reimbursed': round(reimbursed, 2),
                'labor_cost': round(labor_cost, 2),
                'gross_profit': round(collected - reimbursed - labor_cost, 2),
            })

        forecast = {
            'next_month_revenue': 0,
            'next_month_gross_profit': 0,
        }
        if monthly_trend:
            recent = monthly_trend[-3:]
            forecast['next_month_revenue'] = round(sum(item['collected'] for item in recent) / len(recent), 2)
            forecast['next_month_gross_profit'] = round(sum(item['gross_profit'] for item in recent) / len(recent), 2)

        gross_profit_total = revenue - expenses - labor
        return api_response(True, {
            'summary': {
                'project_count': summary['project_count'] or 0,
                'contract_total': round(summary['contract_total'] or 0, 2),
                'collected_total': round(revenue, 2),
                'uncollected_total': round((summary['contract_total'] or 0) - revenue, 2),
                'reimbursed_total': round(expenses, 2),
                'labor_total': round(labor, 2),
                'gross_profit_total': round(gross_profit_total, 2),
                'gross_margin': round((gross_profit_total / revenue * 100), 2) if revenue else 0,
                'loss_projects': loss_projects,
            },
            'projects': projects,
            'monthly_trend': monthly_trend,
            'forecast': forecast,
            'anomalies': anomaly_projects[:10],
        })
    except Exception as e:
        return api_response(False, message=str(e), code=500)

# ========== 知识库 (KB) API ==========
@app.route('/api/kb', methods=['GET'])
def get_kb_list():
    category = request.args.get('category')
    search = request.args.get('search')
    with DatabasePool.get_connection() as conn:
        query_text = 'SELECT * FROM knowledge_base WHERE 1=1'
        params = []
        if category:
            query_text += ' AND category = ?'
            params.append(category)
        if search:
            query_text += ' AND (title LIKE ? OR content LIKE ? OR tags LIKE ?)'
            params.extend([f'%{search}%', f'%{search}%', f'%{search}%'])
        query_text += ' ORDER BY created_at DESC'
        items = conn.execute(DatabasePool.format_sql(query_text), params).fetchall()
        return jsonify([dict(i) for i in items])

@app.route('/api/kb/<int:kid>', methods=['GET'])
def get_kb_item(kid):
    with DatabasePool.get_connection() as conn:
        item = conn.execute(DatabasePool.format_sql('SELECT * FROM knowledge_base WHERE id = ?'), (kid,)).fetchone()
        if item:
            return jsonify(dict(item))
        return jsonify({'error': 'Item not found'}), 404

@app.route('/api/kb', methods=['POST'])
def add_kb_item():
    try:
        with DatabasePool.get_connection() as conn:
            # 支持 multipart/form-data 或 JSON
            if request.content_type and 'multipart/form-data' in request.content_type:
                data = request.form.to_dict()
                file = request.files.get('attachment')
            else:
                data = request.json or {}
                file = None
    
            attachment_path = None
            if file and file.filename != '':
                try:
                    # 使用百度网盘上传
                    project_id = data.get('project_id') or 'common'
                    attachment_path = storage_service.upload_file(file, project_id)
                except Exception as e:
                    import traceback
                    traceback.print_exc()
                    return jsonify({'success': False, 'message': f'上传失败: {str(e)}'}), 500
    
            cursor = conn.execute(DatabasePool.format_sql('''
                INSERT INTO knowledge_base (category, title, content, tags, assoc_stage, project_id, author, attachment_path, external_link)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            '''), (data.get('category'), data.get('title'), data.get('content'), data.get('tags'), 
                  data.get('assoc_stage'), data.get('project_id'), data.get('author'),
                  attachment_path, data.get('external_link')))
            kb_id = DatabasePool.get_inserted_id(cursor)
            if kb_id:
                kb_service.sync_kb_chunks(kb_id)
            conn.commit()
            return jsonify({'success': True})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': f'服务器内部错误: {str(e)}'}), 500

@app.route('/api/kb/<int:kid>', methods=['PUT'])
def update_kb_item(kid):
    try:
        with DatabasePool.get_connection() as conn:
            # 支持 multipart/form-data 或 JSON
            if request.content_type and 'multipart/form-data' in request.content_type:
                data = request.form.to_dict()
                file = request.files.get('attachment')
            else:
                data = request.json or {}
                file = None
                
            # 获取旧数据
            sql_old = DatabasePool.format_sql('SELECT attachment_path FROM knowledge_base WHERE id = ?')
            old_item = conn.execute(sql_old, (kid,)).fetchone()
            attachment_path = old_item['attachment_path'] if old_item else None
    
            if file and file.filename != '':
                try:
                    # 1. 上传新文件
                    project_id = data.get('project_id') or 'common'
                    new_path = storage_service.upload_file(file, project_id)
                    
                    # 2. 如果成功，尝试删除旧文件 (如果存在且不是同一个文件)
                    if attachment_path and attachment_path != new_path:
                        try:
                            if not os.path.exists(attachment_path): # 只有当它不是本地文件时才调用网盘删除
                                 storage_service.delete_file(attachment_path)
                        except:
                            pass # 删除旧文件失败不影响更新
                    
                    attachment_path = new_path
                except Exception as e:
                    import traceback
                    traceback.print_exc()
                    return jsonify({'success': False, 'message': f'上传文件更新失败: {str(e)}'}), 500
    
            sql_update = DatabasePool.format_sql('''
                UPDATE knowledge_base SET category=?, title=?, content=?, tags=?, assoc_stage=?, 
                attachment_path=?, external_link=?, updated_at=CURRENT_TIMESTAMP
                WHERE id=?
            ''')
            existing = conn.execute(
                DatabasePool.format_sql('SELECT * FROM knowledge_base WHERE id = ?'),
                (kid,)
            ).fetchone()
            if not existing:
                return jsonify({'success': False, 'message': '知识库条目不存在'}), 404
            existing = dict(existing)
            conn.execute(sql_update, (
                data.get('category', existing.get('category')),
                data.get('title', existing.get('title')),
                data.get('content', existing.get('content')),
                data.get('tags', existing.get('tags')),
                data.get('assoc_stage', existing.get('assoc_stage')),
                attachment_path,
                data.get('external_link', existing.get('external_link')),
                kid
            ))
            kb_service.sync_kb_chunks(kid)
            conn.commit()
            return jsonify({'success': True})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': f'更新失败: {str(e)}'}), 500

@app.route('/api/kb/<int:kid>/download', methods=['GET'])
def download_kb_attachment(kid):
    with DatabasePool.get_connection() as conn:
        item = conn.execute(
            DatabasePool.format_sql('SELECT title, attachment_path FROM knowledge_base WHERE id = ?'),
            (kid,),
        ).fetchone()
    
    if item and item['attachment_path']:
        try:
            # 检查是否是本地路径 (旧数据)
            if os.path.exists(item['attachment_path']):
                 return send_file(item['attachment_path'], as_attachment=True, download_name=os.path.basename(item['attachment_path']))
            
            # 尝试从网盘下载
            local_path = storage_service.download_file(item['attachment_path'])
            
            # 发送文件后删除临时文件? send_file 不会自动删除
            # 可以使用 after_request 或者专门的 cleanup
            # 这里简单起见，不立即删除，依靠系统定期清理 temp_downloads 或下次重启清理
            
            # 使用 KB 标题 + 原始扩展名 作为下载文件名
            params_name = os.path.basename(item['attachment_path']) # fallback
            try:
                ext = os.path.splitext(item['attachment_path'])[1]
                if not ext:
                    ext = ""
                # 简单清理 title 中的非法字符
                safe_title = "".join([c for c in item['title'] if c.isalnum() or c in (' ', '-', '_', '.', '(', ')', '【', '】', '（', '）')]).strip()
                if not safe_title:
                   safe_title = "download"
                filename = f"{safe_title}{ext}"
            except:
                filename = params_name
            
            # encode for header? flask send_file handles unicode usually, but safe_title helps
            return send_file(local_path, as_attachment=True, download_name=filename)
        except Exception as e:
            return jsonify({'error': f'下载失败: {str(e)}'}), 500
            
    return jsonify({'error': '文件不存在'}), 404

@app.route('/api/kb/<int:kid>', methods=['DELETE'])
def delete_kb_item(kid):
    with DatabasePool.get_connection() as conn:
        item = conn.execute(
            DatabasePool.format_sql('SELECT attachment_path FROM knowledge_base WHERE id = ?'),
            (kid,),
        ).fetchone()
        if item and item['attachment_path']:
            if not os.path.exists(item['attachment_path']):
                storage_service.delete_file(item['attachment_path'])
        conn.execute(DatabasePool.format_sql('DELETE FROM knowledge_base WHERE id = ?'), (kid,))
        kb_service.delete_kb_chunks(kid)
        conn.commit()
    return jsonify({'success': True})

@app.route('/api/kb-items/search', methods=['GET'])
def search_kb_items():
    query = request.args.get('q', '').strip()
    project_id = request.args.get('project_id', type=int)
    limit = request.args.get('limit', 5, type=int)
    if not query:
        return jsonify({'success': True, 'data': []})
    data = kb_service.search_kb_items(query, project_id=project_id, limit=limit)
    return jsonify({'success': True, 'data': data})

@app.route('/api/kb-items/rebuild', methods=['POST'])
def rebuild_kb_items():
    data = request.json or {}
    limit = data.get('limit')
    result = kb_service.rebuild_all_chunks(limit=limit)
    return jsonify({'success': True, 'data': result})

# ========== Workload Analytics - Handled by analytics_bp



# ========== Global Briefing - Handled by analytics_bp

@app.route('/api/ai/risk-analysis', methods=['POST'])
def ai_risk_analysis():
    """
    项目风险预警分析
    """
    data = request.json or {}
    project_id = data.get('project_id')
    if not project_id:
        return jsonify({'error': '项目ID不能为空'}), 400

    with DatabasePool.get_connection() as conn:
        row = conn.execute(DatabasePool.format_sql("SELECT * FROM projects WHERE id = ?"), (project_id,)).fetchone()
        if not row:
            return jsonify({'error': '项目不存在'}), 404
            
        project = dict(row)
        logs_raw = conn.execute(
            DatabasePool.format_sql("SELECT work_content, issues_encountered FROM work_logs WHERE project_id = ? ORDER BY log_date DESC LIMIT 5"),
            (project_id,),
        ).fetchall()
        logs = [f"内容: {r['work_content']}, 问题: {r['issues_encountered']}" for r in logs_raw]
        issues_raw = conn.execute(
            DatabasePool.format_sql("SELECT description, severity, status FROM issues WHERE project_id = ? AND status != '已解决'"),
            (project_id,),
        ).fetchall()
        issues = [f"[{r['severity']}] {r['description']} ({r['status']})" for r in issues_raw]

    # 2. 构建 Prompt
    prompt = f"""
你是一位资深的医疗信息化交付专家。请分析以下项目的【交付风险】。

【项目信息】:
名称: {project['project_name']}
当前状态: {project['status']}
进度: {project['progress']}%
床位数/手术室: {project.get('icu_beds',0)}/{project.get('operating_rooms',0)}

【近期日志摘要】:
{chr(10).join(logs) if logs else "无近期日志"}

【存疑问题】:
{chr(10).join(issues) if issues else "无未解决问题"}

请根据以上信息计算一个【风险分数】 (0-100，0为安全，100为极高危)，并给出 1-2 句简洁的分析建议。
必须严格按以下 JSON 格式回复:
{{"risk_score": 45, "analysis": "主要风险在于接口联调滞后..."}}
"""

    from ai_utils import call_ai
    from ai_config import TaskType
    res_text = call_ai(prompt, TaskType.ANALYSIS)
    
    # 解析 JSON
    try:
        # 尝试提取 JSON 部分
        import json
        json_match = re.search(r'\{.*\}', res_text, re.DOTALL)
        if json_match:
            res_data = json.loads(json_match.group())
        else:
            res_data = {"risk_score": 0, "analysis": "分析失败"}
    except:
        res_data = {"risk_score": 0, "analysis": "解析异常"}
        
    return jsonify(res_data)

@app.route('/api/ai/ask-kb', methods=['POST'])
def ai_ask_kb():
    """
    知识库 AI 问答 (RAG)
    """
    data = request.json or {}
    question = data.get('question', '')
    if not question:
        return jsonify({'error': '问题不能为空'}), 400

    try:
        with DatabasePool.get_connection() as conn:
            try:
                candidates = conn.execute(DatabasePool.format_sql("""
                    SELECT id, title, content, category, tags 
                    FROM knowledge_base 
                    WHERE title LIKE ? OR content LIKE ? OR tags LIKE ? 
                    LIMIT 100
                """), (f'%{question}%', f'%{question}%', f'%{question}%')).fetchall()
                
                if len(candidates) < 5:
                    kb_items = [
                        dict(row) for row in conn.execute(
                            DatabasePool.format_sql("SELECT id, title, content, category, tags, embedding FROM knowledge_base ORDER BY id DESC LIMIT 200")
                        ).fetchall()
                    ]
                else:
                    ids = [dict(r)['id'] for r in candidates]
                    placeholders = ','.join('?' * len(ids))
                    kb_items = [
                        dict(row) for row in conn.execute(
                            DatabasePool.format_sql(f"SELECT id, title, content, category, tags, embedding FROM knowledge_base WHERE id IN ({placeholders})"),
                            ids,
                        ).fetchall()
                    ]
            except DB_OPERATIONAL_ERRORS:
                kb_items = []
        
        # 2. 检索相关上下文
        from rag_service import rag_service
        context = rag_service.retrieve_context(question, kb_items, top_k=3)
        
        if not context:
            prompt = f"用户问了关于知识库的问题: '{question}'。目前知识库中没有直接匹配的条目。请基于你的专业知识给出解答。"
        else:
            prompt = f"""
    你是一位重症手麻医疗信息化交付专家。请根据以下【知识库参考】回答用户的【问题】。
    
    【知识库参考】:
    {context}
    
    【问题】:
    {question}
    
    请用专业简洁的语言回答。
    """

        # 3. 调用 AI
        from ai_utils import call_ai
        from ai_config import TaskType
        answer = call_ai(prompt, TaskType.SUMMARY)
        
        return jsonify({
            'answer': answer,
            'has_context': bool(context)
        })
    except Exception as e:
        print(f"AI/KB Error: {e}")
        return jsonify({'error': str(e), 'answer': '抱歉，AI 暂时无法回答（系统错误）。'}), 500

@app.route('/api/ai/summarize-weekly', methods=['POST'])
def ai_summarize_weekly():
    try:
        data = request.json or {}
        project_id = data.get('project_id')
        with DatabasePool.get_connection() as conn:
            project = conn.execute(DatabasePool.format_sql('SELECT * FROM projects WHERE id = ?'), (project_id,)).fetchone()
            
            if not project:
                return jsonify({'summary': 'Project not found'}), 404

            logs = conn.execute(
                DatabasePool.format_sql('SELECT * FROM work_logs WHERE project_id = ? ORDER BY log_date DESC LIMIT 10'),
                (project_id,),
            ).fetchall()
            issues = conn.execute(
                DatabasePool.format_sql("SELECT * FROM issues WHERE project_id = ? AND status != '已解决' LIMIT 10"),
                (project_id,),
            ).fetchall()
        
        context = f"""
        【项目信息】
        名称: {project['project_name']}
        进度: {project['progress']}%
        状态: {project['status']}
        
        【近期日志】
        {chr(10).join([f"- {l['log_date']} {l['member_name']}: {l['work_content']}" for l in logs])}
        
        【待解决问题】
        {chr(10).join([f"- {i['issue_type']} ({i['severity']}): {i['description']}" for i in issues])}
        """
        
        prompt = f"""
        请为项目生成周报总结 (Markdown格式)。
        重点关注：本周主要进展、当前风险与下周计划。
        
        {context}
        """
        
        from ai_utils import call_ai
        # 使用 'summary' 任务类型
        summary = call_ai(prompt, task_type='summary')
        
        return jsonify({'summary': summary})
    except Exception as e:
        print(f"Weekly Report Error: {e}")
        return jsonify({'summary': f"生成周报失败: {str(e)}"}), 500

@app.route('/api/projects/<int:project_id>/share/toggle', methods=['POST'])
def toggle_project_share(project_id):
    """
    启用/禁用项目分享
    """
    data = request.json or {}
    enabled = 1 if data.get('enabled') else 0
    
    with DatabasePool.get_connection() as conn:
        if enabled:
            import uuid
            share_token = str(uuid.uuid4()).replace('-', '')[:16]
            conn.execute(
                DatabasePool.format_sql("UPDATE projects SET share_enabled = 1, share_token = ? WHERE id = ?"),
                (share_token, project_id),
            )
        else:
            conn.execute(DatabasePool.format_sql("UPDATE projects SET share_enabled = 0 WHERE id = ?"), (project_id,))
            share_token = None
        conn.commit()
    return jsonify({'success': True, 'share_token': share_token})

@app.route('/share/<string:token>')
def public_share_page(token):
    """
    公共预览页面 (无需登录)
    """
    with DatabasePool.get_connection() as conn:
        row = conn.execute(
            DatabasePool.format_sql("SELECT * FROM projects WHERE share_token = ? AND share_enabled = 1"),
            (token,),
        ).fetchone()
        if not row:
            return "该分享链接不存在或已过期", 404
        
        project = dict(row)
        project_id = project['id']
        project['milestones'] = [
            dict(r) for r in conn.execute(
                DatabasePool.format_sql("SELECT * FROM milestones WHERE project_id = ? ORDER BY target_date ASC"),
                (project_id,),
            ).fetchall()
        ]
        stages_raw = [
            dict(r) for r in conn.execute(
                DatabasePool.format_sql("SELECT * FROM project_stages WHERE project_id = ? ORDER BY stage_order ASC"),
                (project_id,),
            ).fetchall()
        ]
        
        stage_ids = [s['id'] for s in stages_raw]
        tasks_by_stage = {}
        if stage_ids:
            placeholders = ','.join('?' * len(stage_ids))
            all_tasks = conn.execute(
                DatabasePool.format_sql(f"SELECT * FROM tasks WHERE stage_id IN ({placeholders})"),
                stage_ids,
            ).fetchall()
            for t in all_tasks:
                task = dict(t)
                tasks_by_stage.setdefault(task['stage_id'], []).append(task)
        
        stages_list = []
        for stage in stages_raw:
            tasks = tasks_by_stage.get(stage['id'], [])
            if tasks:
                completed = sum(1 for t in tasks if t['is_completed'])
                stage['progress'] = int(completed / len(tasks) * 100)
            stages_list.append(stage)
        
        project['stages'] = stages_list

    return render_template('share_project.html', project=project)

@app.route('/api/ai/health', methods=['GET'])
def get_ai_health():
    from ai_config import ai_manager
    nodes = []
    for ep in ai_manager.endpoints:
        nodes.append({
            "name": ep.name,
            "status": "OK" if ep.is_available else "OFFLINE",
            "priority": ep.priority,
            "error_count": ep.error_count,
            "last_error_time": time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(ep.last_error_time)) if ep.last_error_time > 0 else "从未出错"
        })
    return jsonify({"nodes": nodes})

@app.route('/api/ai/health/trigger', methods=['POST'])
def trigger_ai_health_check():
    from ai_config import ai_manager
    ai_manager.check_all_endpoints_health()
    return jsonify({"success": True, "message": "已手动触发全局 AI 节点检测"})

@app.route('/api/projects/<int:project_id>/ai-analyze', methods=['POST'])
def ai_analyze_project(project_id):
    try:
        with DatabasePool.get_connection() as conn:
            project = conn.execute(DatabasePool.format_sql('SELECT * FROM projects WHERE id = ?'), (project_id,)).fetchone()
            
            if not project:
                return jsonify({'error': '项目不存在'}), 404

            issues = conn.execute(DatabasePool.format_sql('SELECT * FROM issues WHERE project_id = ?'), (project_id,)).fetchall()
            tasks = conn.execute(DatabasePool.format_sql('''
                SELECT t.* FROM tasks t
                JOIN project_stages s ON t.stage_id = s.id
                WHERE s.project_id = ?
            '''), (project_id,)).fetchall()
        
        # 安全处理可能不存在的字段
        risk_score = project['risk_score'] if 'risk_score' in project.keys() else 0
        
        context = f"""
        项目: {project['project_name']}
        当前阶段: {project['status']}
        进度: {project['progress']}%
        逾期风险: {risk_score}
        
        进行中问题数: {len([i for i in issues if i['status'] != '已解决'])}
        严重问题数: {len([i for i in issues if i['severity'] == '高' and i['status'] != '已解决'])}
        未完成任务数: {len([t for t in tasks if not t['is_completed']])}
        """
        
        prompt = f"""
        请作为一位资深PMO专家，对该项目进行深度诊断。
        
        【输出要求】
        1. 生成一份Markdown格式的诊断报告。
        2. 包含：【进度分析】、【风险预警】、【优化建议】。
        3. 语气要专业、犀利、直击痛点。
        4. **重要**：在报告最后，必须输出一段JSON格式的雷达图数据，包含5个维度（进度、质量、风险、资源、沟通），每个维度1-10分。
        5. JSON格式如下，必须包含在 ```json ``` 代码块中：
        ```json
        {{
            "radar": {{
                "进度": 8,
                "质量": 7,
                "风险": 6,
                "资源": 9,
                "沟通": 8
            }}
        }}
        ```
        
        【项目数据】
        {context}
        """
        
        from ai_utils import call_ai
        analysis = call_ai(prompt, task_type='analysis')
        
        return jsonify({'analysis': analysis})
        
    except Exception as e:
        app.logger.error(f"AI Analysis Error: {e}")
        return jsonify({'error': str(e), 'analysis': 'AI 分析服务暂时不可用，请查看服务器日志。'}), 500

@app.route('/api/ai/generate-daily-report', methods=['POST'])
def ai_generate_daily_report():
    data = request.json or {}
    project_id = data.get('project_id')
    report_date = data.get('date', datetime.now().strftime('%Y-%m-%d'))
    with DatabasePool.get_connection() as conn:
        project = conn.execute(DatabasePool.format_sql('SELECT * FROM projects WHERE id = ?'), (project_id,)).fetchone()
        daily_logs = conn.execute(DatabasePool.format_sql('''
            SELECT * FROM work_logs 
            WHERE project_id = ? AND log_date = ?
        '''), (project_id, report_date)).fetchall()
        completed_tasks = conn.execute(DatabasePool.format_sql('''
            SELECT t.* FROM tasks t
            JOIN project_stages s ON t.stage_id = s.id
            WHERE s.project_id = ? AND t.is_completed = ? AND t.completed_date = ?
        '''), (project_id, True, report_date)).fetchall()
        active_issues = conn.execute(DatabasePool.format_sql('''
            SELECT * FROM issues 
            WHERE project_id = ? AND status != '已解决'
            ORDER BY severity DESC LIMIT 5
        '''), (project_id,)).fetchall()
    
    # 4. 明日计划 (从今日日志提取)
    tmr_plans = [l['tomorrow_plan'] for l in daily_logs if l['tomorrow_plan']]

    # 构建上下文
    context = f"""
    【项目基础信息】
    项目名称: {project['project_name']}
    当前阶段: {project['status']}
    整体进度: {project['progress']}%
    日期: {report_date}

    【今日工作内容 (来自团队日志)】
    {chr(10).join([f"- {l['member_name']} ({l['work_type']}): {l['work_content']}" for l in daily_logs]) if daily_logs else "无今日日志记录"}

    【今日完成任务】
    {chr(10).join([f"- {t['task_name']}" for t in completed_tasks]) if completed_tasks else "无主要任务完成"}

    【当前重点关注问题/风险】
    {chr(10).join([f"- [{i['severity']}] {i['description']} (状态:{i['status']})" for i in active_issues]) if active_issues else "暂无重大风险"}

    【明日计划】
    {chr(10).join([f"- {plan}" for plan in tmr_plans]) if tmr_plans else "按计划推进"}
    """

    prompt = f"""
    你是一名专业的高级项目经理，正在向【医院信息科（甲方技术部门）】汇报工作。
    请根据以下数据，写一份《项目实施日报》。

    【要求】
    1. **语气专业**：客观、干练，体现我们的专业素养，避免过于口语化。
    2. **结构清晰**：包含【今日进展】、【风险与问题】、【明日计划】三个板块。
    3. **突出价值**：重点描述解决了什么技术难题、完成了哪些关键节点，让信息科觉得我们工作扎实。
    4. **数据驱动**：适当引用进度百分比或具体任务数。
    5. **长度适中**：300-500字左右，适合发送到微信群或邮件。

    【项目数据】
    {context}
    """
    
    from ai_utils import call_ai
    report_content = call_ai(prompt, task_type='report')
    return jsonify({'report': report_content})

# ========== 管理员：AI配置管理 API ==========
from services.auth_service import require_auth
import json

@app.route('/api/admin/ai-configs', methods=['GET'])
@require_auth('*')
def get_ai_configs():
    """获取所有AI配置（仅管理员）"""
    print("DEBUG: Accessing get_ai_configs...")
    try:
        with DatabasePool.get_connection() as conn:
            configs = conn.execute(DatabasePool.format_sql('SELECT * FROM ai_configs ORDER BY priority')).fetchall()
            print(f"DEBUG: Found {len(configs)} configs.")
    except Exception as e:
        print(f"DEBUG: Error querying ai_configs: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500
    
    result = []
    for c in configs:
        config = dict(c)
        # 脱敏API密钥，只显示前4位和后4位
        if config['api_key'] and len(config['api_key']) > 8:
            config['api_key_masked'] = config['api_key'][:4] + '****' + config['api_key'][-4:]
        else:
            config['api_key_masked'] = '****'
        # 不返回完整密钥
        del config['api_key']
        # 解析models JSON
        if config.get('models'):
            try:
                config['models'] = json.loads(config['models'])
            except:
                config['models'] = []
        else:
            config['models'] = []
        result.append(config)
    
    return jsonify({'success': True, 'data': result})

@app.route('/api/admin/ai-configs', methods=['POST'])
@require_auth('*')
def add_ai_config():
    """新增AI配置（仅管理员）"""
    data = request.json or {}
    
    if not data.get('name') or not data.get('api_key') or not data.get('base_url'):
        return jsonify({'success': False, 'message': '名称、API密钥和URL为必填项'}), 400
    
    # models转为JSON字符串
    models = data.get('models', [])
    if isinstance(models, list):
        models_json = json.dumps(models)
    else:
        models_json = models
    
    try:
        with DatabasePool.get_connection() as conn:
            is_active_value = bool(data.get('is_active', True)) if DatabasePool.is_postgres() else (1 if data.get('is_active', True) else 0)
            conn.execute(DatabasePool.format_sql('''
                INSERT INTO ai_configs (name, api_key, base_url, models, priority, is_active, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            '''), (data['name'], data['api_key'], data['base_url'], models_json, 
                  data.get('priority', 1), is_active_value))
            conn.commit()
        return jsonify({'success': True, 'message': '配置已添加'})
    except DB_INTEGRITY_ERRORS:
        return jsonify({'success': False, 'message': '配置名称已存在'}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/admin/ai-configs/<int:config_id>', methods=['PUT'])
@require_auth('*')
def update_ai_config(config_id):
    """更新AI配置（仅管理员）"""
    data = request.json or {}
    try:
        with DatabasePool.get_connection() as conn:
            existing = conn.execute(
                DatabasePool.format_sql('SELECT api_key FROM ai_configs WHERE id = ?'),
                (config_id,),
            ).fetchone()
            if not existing:
                return jsonify({'success': False, 'message': '配置不存在'}), 404

            api_key = data.get('api_key') if data.get('api_key') else existing['api_key']
            models = data.get('models', [])
            if isinstance(models, list):
                models_json = json.dumps(models)
            else:
                models_json = models
            is_active_value = bool(data.get('is_active', True)) if DatabasePool.is_postgres() else (1 if data.get('is_active', True) else 0)

            conn.execute(DatabasePool.format_sql('''
                UPDATE ai_configs SET name=?, api_key=?, base_url=?, models=?, priority=?, is_active=?, updated_at=CURRENT_TIMESTAMP
                WHERE id=?
            '''), (data.get('name'), api_key, data.get('base_url'), models_json,
                  data.get('priority', 1), is_active_value, config_id))
            conn.commit()
        return jsonify({'success': True, 'message': '配置已更新'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/admin/ai-configs/<int:config_id>', methods=['DELETE'])
@require_auth('*')
def delete_ai_config(config_id):
    """删除AI配置（仅管理员）"""
    with DatabasePool.get_connection() as conn:
        conn.execute(DatabasePool.format_sql('DELETE FROM ai_configs WHERE id = ?'), (config_id,))
        conn.commit()
    return jsonify({'success': True, 'message': '配置已删除'})

@app.route('/api/admin/ai-configs/<int:config_id>/test', methods=['POST'])
@require_auth('*')
def test_ai_config(config_id):
    """测试AI配置连通性（仅管理员）"""
    with DatabasePool.get_connection() as conn:
        config = conn.execute(DatabasePool.format_sql('SELECT * FROM ai_configs WHERE id = ?'), (config_id,)).fetchone()
    
    if not config:
        return jsonify({'success': False, 'message': '配置不存在'}), 404
    
    try:
        # 解析models
        models = []
        if config['models']:
            try:
                models = json.loads(config['models'])
            except:
                models = [config['models']]
        
        # 使用第一个模型进行测试
        test_model = models[0] if models else 'gpt-3.5-turbo'
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {config['api_key']}",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json, text/event-stream"
        }
        payload = {
            "model": test_model,
            "messages": [{"role": "user", "content": "hi"}],
            "max_tokens": 5,
            "stream": True
        }
        
        start_time = time.time()
        response = requests.post(
            config['base_url'],
            headers=headers,
            data=json.dumps(payload),
            timeout=15,
            stream=True
        )
        duration = time.time() - start_time
        
        if response.status_code == 200:
            return jsonify({
                'success': True, 
                'message': f'连接成功！响应时间: {duration:.2f}s',
                'duration': round(duration, 2)
            })
        elif response.status_code == 401:
             return jsonify({
                'success': True, 
                'message': f'连接存活，但 API Key 错误 (HTTP 401)。\n提示: 请检查该节点的 API 密钥是否有效。',
                'duration': round(duration, 2)
            })
        elif response.status_code == 405:
            return jsonify({
                'success': True, 
                'message': f'连接存活，但接口路径不对 (HTTP 405)。\n提示: 请检查项目的 Base URL。某些服务需要在 URL 后补全 /chat/completions',
                'duration': round(duration, 2)
            })
        else:
            return jsonify({
                'success': False, 
                'message': f'API返回错误: HTTP {response.status_code}',
                'details': response.text[:200]
            })
    except requests.Timeout:
        return jsonify({'success': False, 'message': '连接超时'})
    except Exception as e:
        return jsonify({'success': False, 'message': f'连接失败: {str(e)}'})

@app.route('/api/admin/ai-configs/migrate', methods=['POST'])
@require_auth('*')
def migrate_ai_configs():
    """将环境变量中的配置迁移到数据库（仅管理员）"""
    import os
    
    migrated = []
    with DatabasePool.get_connection() as conn:
        tapi_key = os.environ.get('TAPI_API_KEY')
        if tapi_key:
            existing = conn.execute(DatabasePool.format_sql('SELECT id FROM ai_configs WHERE name = ?'), ('TAPI-DeepSeek',)).fetchone()
            if not existing:
                models = json.dumps(["deepseek-v3.2-speciale", "deepseek-v3-2-251201", "deepseek-v3-1-terminus", "deepseek-v3"])
                conn.execute(DatabasePool.format_sql('''
                    INSERT INTO ai_configs (name, api_key, base_url, models, priority, is_active)
                    VALUES (?, ?, ?, ?, ?, 1)
                '''), ('TAPI-DeepSeek', tapi_key, 'https://tapi.nyc.mn/v1/chat/completions', models, 1))
                migrated.append('TAPI-DeepSeek')

        chatanywhere_key = os.environ.get('CHATANYWHERE_API_KEY')
        if chatanywhere_key:
            existing = conn.execute(DatabasePool.format_sql('SELECT id FROM ai_configs WHERE name = ?'), ('ChatAnywhere',)).fetchone()
            if not existing:
                models = json.dumps(["deepseek-v3", "deepseek-chat", "gpt-4o-mini", "gpt-3.5-turbo"])
                conn.execute(DatabasePool.format_sql('''
                    INSERT INTO ai_configs (name, api_key, base_url, models, priority, is_active)
                    VALUES (?, ?, ?, ?, ?, 1)
                '''), ('ChatAnywhere', chatanywhere_key, 'https://api.chatanywhere.org/v1/chat/completions', models, 2))
                migrated.append('ChatAnywhere')
        conn.commit()
    
    if migrated:
        return jsonify({'success': True, 'message': f'已导入配置: {", ".join(migrated)}'})
    else:
        return jsonify({'success': True, 'message': '无新配置可导入（已存在或环境变量未设置）'})

# ========== 报告归档 API ==========

@app.route('/api/projects/<int:project_id>/report-archive', methods=['GET'])
def get_report_archive(project_id):
    """获取项目的历史归档报告列表"""
    report_type = request.args.get('type')  # daily / weekly
    limit = request.args.get('limit', 50, type=int)
    with DatabasePool.get_connection() as conn:
        query = 'SELECT id, project_id, report_type, report_date, generated_by, created_at FROM report_archive WHERE project_id = ?'
        params = [project_id]
        if report_type:
            query += ' AND report_type = ?'
            params.append(report_type)
        query += ' ORDER BY report_date DESC LIMIT ?'
        params.append(limit)
        rows = conn.execute(DatabasePool.format_sql(query), params).fetchall()
    return jsonify([dict(r) for r in rows])

@app.route('/api/report-archive/<int:archive_id>', methods=['GET'])
def get_report_archive_detail(archive_id):
    """获取某份归档报告的详细内容"""
    with DatabasePool.get_connection() as conn:
        row = conn.execute(DatabasePool.format_sql('SELECT * FROM report_archive WHERE id = ?'), (archive_id,)).fetchone()
    if not row:
        return jsonify({'error': '报告不存在'}), 404
    return jsonify(dict(row))

@app.route('/api/projects/<int:project_id>/report-archive/generate', methods=['POST'])
def generate_report_archive(project_id):
    """手动触发为指定项目生成当日报告"""
    data = request.json or {}
    report_type = data.get('report_type', 'daily')
    force = data.get('force', False)
    try:
        with DatabasePool.get_connection() as conn:
            project = conn.execute(
                DatabasePool.format_sql('SELECT id, project_name FROM projects WHERE id = ?'),
                (project_id,),
            ).fetchone()
            if not project:
                return jsonify({'success': False, 'message': '项目不存在'}), 404

        task_id = str(uuid.uuid4())
        register_task(
            task_id,
            'report_archive',
            f"报告归档 #{project_id} {report_type}",
            _run_report_archive_task,
            project_id,
            report_type,
            force,
            project_id=project_id,
            payload_summary=f"type={report_type}, force={int(bool(force))}",
            source_endpoint=f'/api/projects/{project_id}/report-archive/generate',
        )
        launch_registered_task(task_id)
        return jsonify({'success': True, 'task_id': task_id, 'status': 'processing'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ========== 管理员：企业微信配置 API ==========
from services.wecom_service import wecom_service

@app.route('/api/admin/wecom-config', methods=['GET'])
@require_auth('admin')
def get_wecom_config():
    """获取企业微信配置"""
    try:
        with DatabasePool.get_connection() as conn:
            configs = conn.execute(
                DatabasePool.format_sql("SELECT config_key, value FROM system_config WHERE config_key LIKE 'wecom_%'")
            ).fetchall()
            result = {row['config_key'].replace('wecom_', ''): row['value'] for row in configs}
        
        # 脱敏
        if result.get('secret'):
            result['secret'] = result['secret'][:4] + '****' + result['secret'][-4:] if len(result['secret']) > 8 else '****'
        if result.get('callback_aes_key'):
            result['callback_aes_key'] = '******'
            
        return jsonify({'success': True, 'message': 'Success', 'data': result})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/admin/wecom-config', methods=['POST'])
@require_auth('admin')
def save_wecom_config():
    """保存企业微信配置"""
    data = request.json or {}
    try:
        with DatabasePool.get_connection() as conn:
            configs_raw = conn.execute(
                DatabasePool.format_sql("SELECT config_key, value FROM system_config WHERE config_key LIKE 'wecom_%'")
            ).fetchall()
            existing = {row['config_key'].replace('wecom_', ''): row['value'] for row in configs_raw}
            
            updates = []
            for key, val in data.items():
                db_key = f"wecom_{key}"
                final_val = val
                is_masked = False
                
                if key == 'secret':
                    if val and '****' in val:
                        is_masked = True
                elif key == 'callback_aes_key' and val == '******':
                    is_masked = True
                    
                if is_masked:
                    final_val = existing.get(key)
                    
                updates.append((db_key, str(final_val) if final_val is not None else ""))
                
            for k, v in updates:
                conn.execute(DatabasePool.format_sql('''
                    INSERT INTO system_config (config_key, value) VALUES (?, ?)
                    ON CONFLICT(config_key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
                '''), (k, v))
                
            conn.commit()
        
        # 立即重载服务配置
        wecom_service.reload_config()
        
        return jsonify({'success': True, 'message': '企业微信配置已保存'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


# ========== 管理员：用户企微绑定 API ==========

@app.route('/api/admin/users/wecom-bindlist', methods=['GET'])
@require_auth('admin')
def get_wecom_bindlist():
    """获取所有用户及其企微绑定状态"""
    try:
        with DatabasePool.get_connection() as conn:
            users = conn.execute(DatabasePool.format_sql('''
                SELECT id, username, display_name, role, wecom_userid, is_active
                FROM users ORDER BY id
            ''')).fetchall()
        result = []
        for u in users:
            result.append({
                'id': u['id'],
                'username': u['username'],
                'display_name': u['display_name'],
                'role': u['role'],
                'wecom_userid': u['wecom_userid'] or '',
                'is_bound': bool(u['wecom_userid']),
                'is_active': bool(u['is_active'])
            })
        return jsonify({'success': True, 'data': result})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/admin/users/<int:user_id>/bind-wecom', methods=['POST'])
@require_auth('admin')
def bind_wecom_userid(user_id):
    """手动绑定/更新用户的企微 userid"""
    data = request.json or {}
    wecom_userid = data.get('wecom_userid', '').strip()
    try:
        with DatabasePool.get_connection() as conn:
            user = conn.execute(DatabasePool.format_sql('SELECT id, display_name FROM users WHERE id = ?'), (user_id,)).fetchone()
            if not user:
                return jsonify({'success': False, 'message': '用户不存在'}), 404
            
            if wecom_userid:
                existing = conn.execute(
                    DatabasePool.format_sql('SELECT id, display_name FROM users WHERE wecom_userid = ? AND id != ?'),
                    (wecom_userid, user_id)
                ).fetchone()
                if existing:
                    return jsonify({'success': False, 'message': f'该企微ID已被用户 [{existing["display_name"]}] 绑定'}), 400
                conn.execute(DatabasePool.format_sql('UPDATE users SET wecom_userid = ? WHERE id = ?'), (wecom_userid, user_id))
            else:
                conn.execute(DatabasePool.format_sql('UPDATE users SET wecom_userid = NULL WHERE id = ?'), (user_id,))
            
            conn.commit()
        return jsonify({'success': True, 'message': f'用户 [{user["display_name"]}] 的企微绑定已更新'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

# ========== 存储配置 API (Baidu Netdisk) ==========
from storage_service import storage_service

@app.route('/api/admin/storage/auth-url', methods=['GET'])
@require_auth('*')
def get_storage_auth_url():
    url = storage_service.get_auth_url()
    return jsonify({'url': url})

@app.route('/api/admin/storage/callback', methods=['POST'])
@require_auth('*')
def storage_auth_callback():
    data = request.json or {}
    code = data.get('code')
    if not code:
        return jsonify({'success': False, 'message': 'Missing auth code'}), 400
    
    try:
        success, message = storage_service.authenticate(code)
        if success:
             return jsonify({'success': True, 'message': message})
        else:
             return jsonify({'success': False, 'message': f'Authorization failed: {message}'}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/admin/storage/status', methods=['GET'])
@require_auth('*')
def get_storage_status():
    is_auth = storage_service.is_authorized()
    return jsonify({
        'is_authorized': is_auth
    })

@app.route('/api/admin/storage/config', methods=['GET'])
@require_auth('admin')
def get_storage_config():
    try:
        config = storage_service.get_config()
        # Hide secret keys in response
        safe_config = config.copy()
        if 'r2' in safe_config:
            r2_conf = safe_config['r2'].copy()
            if r2_conf.get('secret_key'):
                r2_conf['secret_key'] = '******'
            safe_config['r2'] = r2_conf
        return jsonify(safe_config)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/storage/config', methods=['POST'])
@require_auth('admin')
def update_storage_config():
    try:
        data = request.get_json()
        current_config = storage_service.get_config()
        
        # Handle password masking
        if data.get('type') == 'r2' and 'r2' in data:
            new_r2 = data['r2']
            if new_r2.get('secret_key') == '******':
                old_r2 = current_config.get('r2', {})
                new_r2['secret_key'] = old_r2.get('secret_key')
        
        if storage_service.update_config(data):
            return jsonify({'success': True, 'message': 'Storage configuration saved'})
        else:
            return jsonify({'success': False, 'message': 'Failed to save configuration'}), 500
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/admin/storage/test-r2', methods=['POST'])
@require_auth('admin')
def test_r2_connection():
    try:
        data = request.get_json()
        # Handle masked password
        secret_key = data.get('secret_key')
        if secret_key == '******':
             current_config = storage_service.get_config()
             old_r2 = current_config.get('r2', {})
             secret_key = old_r2.get('secret_key')

        from storage_service import R2Storage
        r2 = R2Storage(
            endpoint_url=data.get('endpoint'),
            access_key=data.get('access_key'),
            secret_key=secret_key,
            bucket_name=data.get('bucket_name')
        )
        if r2.is_authorized():
            return jsonify({'success': True, 'message': 'Connection successful'})
        else:
            return jsonify({'success': False, 'message': 'Connection failed (Check logs)'}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


# ========== 管理员：地图服务配置 API ==========
@app.route('/api/admin/map-config', methods=['GET'])
@require_auth('admin')
def get_map_config():
    """获取地图服务配置"""
    try:
        with DatabasePool.get_connection() as conn:
            configs = conn.execute(
                DatabasePool.format_sql("SELECT config_key, value FROM system_config WHERE config_key LIKE 'map_%'")
            ).fetchall()
            result = {row['config_key'].replace('map_', ''): row['value'] for row in configs}
        
        # 脱敏
        for key in ['baidu_ak', 'amap_key', 'tianditu_key', 'google_ak']:
            if result.get(key):
                val = result[key]
                result[key] = val[:4] + '****' + val[-4:] if len(val) > 8 else '****'
            
        return jsonify({'success': True, 'data': result})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/admin/map-config', methods=['POST'])
@require_auth('admin')
def save_map_config():
    """保存地图服务配置"""
    data = request.json or {}
    with DatabasePool.get_connection() as conn:
        try:
            # 预加载现有配置以处理脱敏
            sql_load = DatabasePool.format_sql("SELECT config_key, value FROM system_config WHERE config_key LIKE 'map_%'")
            existing = {row['config_key'].replace('map_', ''): row['value'] for row in conn.execute(sql_load).fetchall()}
            
            for key, val in data.items():
                db_key = f"map_{key}"
                final_val = val
                
                # 脱敏逻辑：如果前台传回带 * 的值，说明没改，保留原值
                if key in ['baidu_ak', 'amap_key', 'tianditu_key', 'google_ak'] and val and '****' in val:
                    final_val = existing.get(key)
                    
                sql_ins = DatabasePool.format_sql('''
                    INSERT INTO system_config (config_key, value) VALUES (?, ?)
                    ON CONFLICT(config_key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
                ''')
                conn.execute(sql_ins, (db_key, str(final_val) if final_val is not None else ""))
                
            conn.commit()
            
            # 立即更新全局 GeoService 配置
            from utils.geo_service import geo_service
            geo_service.reload_config()
            
            return jsonify({'success': True, 'message': '地图服务配置已保存'})
        except Exception as e:
            return jsonify({'success': False, 'message': str(e)}), 500


if __name__ == '__main__':
    with app.app_context():
        from app_config import NOTIFICATION_CONFIG
        init_db()
        reload_notification_config(NOTIFICATION_CONFIG)
        warm_task_cache()
    # 调度器由 ensure_background_scheduler 统一启动，避免多入口重复启动。
    debug_mode = os.environ.get('FLASK_DEBUG', '').lower() in ('1', 'true', 'yes', 'on')
    app.run(debug=debug_mode, host='0.0.0.0', port=5000, use_reloader=False)

