from flask import Flask, render_template, request, jsonify, send_file, make_response, send_from_directory
import logging
import re
# Force reload
# reload_trigger_1
import sqlite3
import requests
import json
import time
import smtplib
import hashlib
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta
from threading import Thread
from werkzeug.utils import secure_filename
from ai_config import AI_CONFIG, get_model_config, switch_to_backup_api
from database import get_db, close_db, DatabasePool
from api_utils import api_response, validate_json, cached
from concurrent.futures import ThreadPoolExecutor
import uuid
from storage_service import storage_service

app = Flask(__name__)
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
            logs = conn.execute('SELECT * FROM wecom_debug_logs ORDER BY id DESC LIMIT 20').fetchall()
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
from services.analytics_service import analytics_service
from services.monitor_service import monitor_service
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

# thread executor for async tasks
executor = ThreadPoolExecutor(max_workers=4)
# in-memory task result store (should use Redis in production)
task_results = {}

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

def reload_notification_config():
    """从数据库加载并同步系统通知配置"""
    try:
        from app_config import NOTIFICATION_CONFIG
        with DatabasePool.get_connection() as conn:
            # 检查表是否存在
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='system_config'")
            if not cursor.fetchone():
                return
                
            configs = conn.execute("SELECT config_key, value FROM system_config").fetchall()
            for row in configs:
                key = row['config_key']
                val = row['value']
                if key == 'wecom_webhook':
                    NOTIFICATION_CONFIG['WECOM_WEBHOOK'] = val
                elif key == 'wecom_enabled':
                    NOTIFICATION_CONFIG['ENABLE_WECOM'] = val.lower() == 'true'
            # logger.info("通知配置加载成功")
    except Exception as e:
        print(f"Error loading notification config: {e}")

def init_db():
    """初始化数据库并进行必要的升级"""
    conn = get_db()
    cursor = conn.cursor()
    
    # 0. 系统配置表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS system_config (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            config_key TEXT UNIQUE,
            value TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # 升级脚本：增加 WeCom 关联
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN wecom_userid TEXT UNIQUE")
    except:
        pass
    
    # 1. 项目主表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_no TEXT UNIQUE,
            project_name TEXT NOT NULL,
            hospital_name TEXT NOT NULL,
            contract_amount REAL,
            project_manager TEXT,
            contact_person TEXT,
            contact_phone TEXT,
            plan_start_date DATE,
            plan_end_date DATE,
            actual_start_date DATE,
            actual_end_date DATE,
            status TEXT DEFAULT '待启动',
            progress INTEGER DEFAULT 0,
            priority TEXT DEFAULT '普通',
            icu_beds INTEGER DEFAULT 0,
            operating_rooms INTEGER DEFAULT 0,
            pacu_beds INTEGER DEFAULT 0,
            province TEXT,
            city TEXT,
            address TEXT,
            contract_no TEXT,
            data_hash TEXT,
            risk_score REAL DEFAULT 0,
            risk_analysis TEXT,
            share_token TEXT UNIQUE,
            share_enabled INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # 升级脚本：添加分享字段
    try:
        cursor.execute("ALTER TABLE projects ADD COLUMN share_token TEXT UNIQUE")
    except: pass
    try:
        cursor.execute("ALTER TABLE projects ADD COLUMN share_enabled INTEGER DEFAULT 0")
    except: pass
    try:
        cursor.execute("ALTER TABLE projects ADD COLUMN risk_analysis TEXT")
    except: pass
    
    # 2. 项目阶段表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS project_stages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            stage_name TEXT NOT NULL,
            stage_order INTEGER,
            plan_start_date DATE,
            plan_end_date DATE,
            actual_start_date DATE,
            actual_end_date DATE,
            progress INTEGER DEFAULT 0,
            status TEXT DEFAULT '待开始',
            responsible_person TEXT,
            bonus_amount REAL DEFAULT 0,
            scale_quantity INTEGER DEFAULT 0,
            scale_unit TEXT,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')
    
    # 升级脚本：添加阶段缩放字段
    try:
        cursor.execute("ALTER TABLE project_stages ADD COLUMN scale_quantity INTEGER DEFAULT 0")
    except: pass
    try:
        cursor.execute("ALTER TABLE project_stages ADD COLUMN scale_unit TEXT")
    except: pass
    
    # 3. 任务表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stage_id INTEGER,
            task_name TEXT NOT NULL,
            is_completed BOOLEAN DEFAULT 0,
            completed_date DATE,
            remark TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (stage_id) REFERENCES project_stages(id)
        )
    ''')

    # 3.5. 里程碑表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS milestones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            name TEXT NOT NULL,
            target_date DATE,
            is_completed BOOLEAN DEFAULT 0,
            completed_date DATE,
            is_celebrated BOOLEAN DEFAULT 0,
            remark TEXT,
            FOREIGN KEY (project_id) REFERENCES projects(id),
            UNIQUE(project_id, name)
        )
    ''')
    
    # 4. 接口对接表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS interfaces (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            system_name TEXT,
            interface_name TEXT,
            status TEXT DEFAULT '待开发',
            plan_date DATE,
            remark TEXT,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')
    
    # 5. 问题跟踪表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS issues (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            issue_type TEXT,
            description TEXT,
            severity TEXT,
            status TEXT DEFAULT '待处理',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            resolved_at TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')
    
    # 6. 消息提醒表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            title TEXT NOT NULL,
            content TEXT,
            type TEXT DEFAULT 'info',
            is_read BOOLEAN DEFAULT 0,
            is_sent BOOLEAN DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            due_date DATE,
            remind_type TEXT DEFAULT 'once',
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')

    # 7. 医疗设备对接表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS medical_devices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            device_type TEXT,
            brand_model TEXT,
            protocol_type TEXT,
            ip_address TEXT,
            status TEXT DEFAULT '未连接',
            remark TEXT,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')

    # 8. 周报记录表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS weekly_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            report_type TEXT DEFAULT 'single',
            week_start DATE,
            week_end DATE,
            content TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')

    # 10. 进度历史记录表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS progress_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            record_date DATE,
            progress INTEGER,
            tasks_total INTEGER,
            tasks_completed INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')

    # 11. 报告缓存表 (Report Cache)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS report_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            report_type TEXT,
            data_hash TEXT,
            content TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')

    # 11a. AI 风险历史记录表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS project_risk_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            record_date DATE,
            risk_score REAL,
            sentiment_score REAL,
            trend_direction TEXT,
            key_risk_factors TEXT,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')
    
    # 11c. AI 建议与分析缓存
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS ai_report_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            report_type TEXT,
            content TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')

    # 11b. 报告归档表 (Report Archive - 永久按日期保存)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS report_archive (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            report_type TEXT,
            report_date DATE,
            content TEXT,
            generated_by TEXT DEFAULT 'auto',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')

    # ========== V2.0 新增表 ==========

    # 12. 项目成员表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS project_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            name TEXT NOT NULL,
            role TEXT,
            phone TEXT,
            email TEXT,
            join_date DATE,
            leave_date DATE,
            is_onsite BOOLEAN DEFAULT 0,
            status TEXT DEFAULT '在岗',
            current_city TEXT,
            lng REAL,
            lat REAL,
            remark TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')

    # 13. 甲方联系人表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS customer_contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            name TEXT NOT NULL,
            department TEXT,
            position TEXT,
            phone TEXT,
            email TEXT,
            is_primary BOOLEAN DEFAULT 0,
            remark TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')

    # 20. 企业微信调试日志表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS wecom_debug_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            msg_type TEXT,
            raw_xml TEXT,
            parsed_json TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS project_departures (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            departure_type TEXT,
            departure_date DATE,
            expected_return_date DATE,
            actual_return_date DATE,
            reason TEXT,
            handover_person TEXT,
            our_persons TEXT,
            doc_handover BOOLEAN DEFAULT 0,
            account_handover BOOLEAN DEFAULT 0,
            training_handover BOOLEAN DEFAULT 0,
            issue_handover BOOLEAN DEFAULT 0,
            contact_handover BOOLEAN DEFAULT 0,
            handover_doc_path TEXT,
            pending_issues TEXT,
            remote_support_info TEXT,
            status TEXT DEFAULT '待审批',
            approved_by TEXT,
            approved_at TIMESTAMP,
            remark TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')

    # 14b. 里程碑复盘表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS milestone_retrospectives (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            milestone_id INTEGER,
            project_id INTEGER,
            content TEXT,
            author TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (milestone_id) REFERENCES milestones(id),
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')
    
    # 升级 milestones 增加庆祝状态和完成日期
    try:
        cursor.execute("ALTER TABLE milestones ADD COLUMN is_celebrated BOOLEAN DEFAULT 0")
    except: pass
    try:
        cursor.execute("ALTER TABLE milestones ADD COLUMN completed_date TEXT")
    except: pass
    
    # 后置补全遗漏的完成日期
    try:
        cursor.execute("UPDATE milestones SET completed_date = target_date WHERE is_completed = 1 AND completed_date IS NULL")
    except: pass

    # 15. 工作日志表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS work_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            member_id INTEGER,
            member_name TEXT,
            log_date DATE,
            work_hours REAL DEFAULT 8,
            work_type TEXT DEFAULT '现场',
            work_content TEXT,
            issues_encountered TEXT,
            tomorrow_plan TEXT,
            stage_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id),
            FOREIGN KEY (member_id) REFERENCES project_members(id),
            FOREIGN KEY (stage_id) REFERENCES project_stages(id)
        )
    ''')

    # 16. 项目文档表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS project_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            doc_name TEXT NOT NULL,
            doc_type TEXT,
            doc_category TEXT,
            file_path TEXT,
            file_size INTEGER,
            version TEXT DEFAULT 'v1.0',
            upload_by TEXT,
            upload_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            remark TEXT,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')

    # 17. 项目费用表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS project_expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            expense_date DATE,
            expense_type TEXT,
            amount REAL,
            description TEXT,
            applicant TEXT,
            receipt_path TEXT,
            status TEXT DEFAULT '待报销',
            approved_by TEXT,
            approved_at TIMESTAMP,
            stage_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id),
            FOREIGN KEY (stage_id) REFERENCES project_stages(id)
        )
    ''')
    
    # 17.5 项目收入表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS project_revenue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            amount REAL NOT NULL,
            revenue_date DATE,
            revenue_type TEXT, -- 合同款, 阶段款, 验收款, 维保费 等
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')

    # 18. 项目变更记录表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS project_changes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            change_type TEXT,
            change_title TEXT,
            change_desc TEXT,
            impact_analysis TEXT,
            requested_by TEXT,
            requested_date DATE,
            approved_by TEXT,
            approved_date DATE,
            status TEXT DEFAULT '待审批',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')

    # 19. 验收记录表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS project_acceptances (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            acceptance_type TEXT,
            stage_name TEXT,
            acceptance_date DATE,
            acceptance_items TEXT,
            pass_rate REAL,
            issues_found TEXT,
            customer_sign TEXT,
            our_sign TEXT,
            status TEXT DEFAULT '待验收',
            remark TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')

    # 20. 客户满意度表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS customer_satisfaction (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            survey_date DATE,
            survey_type TEXT,
            score_quality INTEGER,
            score_service INTEGER,
            score_response INTEGER,
            score_professional INTEGER,
            score_overall INTEGER,
            feedback TEXT,
            surveyor TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')

    # 21. 操作日志表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS operation_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operator TEXT,
            operation_type TEXT,
            entity_type TEXT,
            entity_id INTEGER,
            entity_name TEXT,
            old_value TEXT,
            new_value TEXT,
            ip_address TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # 22. 回访记录表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS follow_up_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            follow_up_date DATE,
            follow_up_type TEXT,
            contact_person TEXT,
            content TEXT,
            issues_found TEXT,
            follow_up_by TEXT,
            next_follow_up_date DATE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')

    # 23. 知识库表 (KB)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS knowledge_base (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            tags TEXT,
            assoc_stage TEXT,
            project_id INTEGER,
            author TEXT,
            embedding BLOB,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # 升级 knowledge_base 增加 embedding
    try:
        cursor.execute("ALTER TABLE knowledge_base ADD COLUMN embedding BLOB")
    except: pass

    # 24. 硬件资产报表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS hardware_assets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            asset_name TEXT NOT NULL,
            sn TEXT UNIQUE,
            model TEXT,
            status TEXT DEFAULT '在库',
            location TEXT,
            responsible_person TEXT,
            purchase_date DATE,
            expire_date DATE,
            remark TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # 25. AI 配置表 (System Config)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS ai_configs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            api_key TEXT,
            base_url TEXT,
            models TEXT, -- JSON array
            priority INTEGER DEFAULT 10,
            is_active BOOLEAN DEFAULT 1,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')



    # 26. 项目模板表 - 存储自定义项目模板
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS project_templates_custom (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            source_project_id INTEGER,
            template_data TEXT,
            created_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # 27. 客户沟通记录表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS customer_communications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            contact_date DATE,
            contact_person TEXT,
            contact_method TEXT,
            summary TEXT,
            related_issue_id INTEGER,
            attachments TEXT,
            created_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')

    # 28. 任务依赖关系表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS task_dependencies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL,
            depends_on_task_id INTEGER NOT NULL,
            dependency_type TEXT DEFAULT 'finish_to_start',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
            FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE,
            UNIQUE(task_id, depends_on_task_id)
        )
    ''')

    # 29. 进度快照表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS progress_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            snapshot_date DATE NOT NULL,
            overall_progress INTEGER DEFAULT 0,
            snapshot_data TEXT,
            snapshot_type TEXT DEFAULT 'manual',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')

    # 30. 站会纪要表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS standup_minutes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            meeting_date DATE NOT NULL,
            content TEXT,
            ai_generated BOOLEAN DEFAULT 0,
            created_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')

    # ========== V3.0 接口文档智能对照模块 ==========
    
    # 31. 接口规范库（解析后的结构化接口定义）
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS interface_specs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            doc_id INTEGER,
            spec_source TEXT NOT NULL DEFAULT 'vendor',
            category TEXT, -- 新增：分类（如：手麻标准、重症标准）
            vendor_name TEXT,
            system_type TEXT NOT NULL DEFAULT '',
            interface_name TEXT NOT NULL DEFAULT '',
            transcode TEXT,
            protocol TEXT,
            description TEXT,
            request_sample TEXT,
            response_sample TEXT,
            endpoint_url TEXT,
            action_name TEXT,
            view_name TEXT,
            data_direction TEXT DEFAULT 'pull',
            raw_text TEXT,
            parsed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id),
            FOREIGN KEY (doc_id) REFERENCES project_documents(id)
        )
    ''')
    try:
        cursor.execute("ALTER TABLE interface_specs ADD COLUMN category TEXT")
    except:
        pass
    try:
        cursor.execute("ALTER TABLE interface_specs ADD COLUMN raw_text TEXT")
    except:
        pass

    # 32. 接口字段明细
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS interface_spec_fields (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            spec_id INTEGER NOT NULL,
            field_name TEXT NOT NULL DEFAULT '',
            field_name_cn TEXT,
            field_type TEXT,
            field_length TEXT,
            is_required INTEGER DEFAULT 0,
            is_primary_key INTEGER DEFAULT 0,
            description TEXT,
            remark TEXT,
            default_value TEXT,
            enum_values TEXT,
            sample_value TEXT,
            field_order INTEGER DEFAULT 0,
            FOREIGN KEY (spec_id) REFERENCES interface_specs(id) ON DELETE CASCADE
        )
    ''')

    # 33. 接口对照结果
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS interface_comparisons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            our_spec_id INTEGER NOT NULL,
            vendor_spec_id INTEGER,
            match_type TEXT DEFAULT 'auto',
            match_confidence REAL DEFAULT 0,
            comparison_result TEXT,
            summary TEXT,
            gap_count INTEGER DEFAULT 0,
            transform_count INTEGER DEFAULT 0,
            status TEXT DEFAULT 'pending',
            category TEXT, -- 新增：分类（如：手麻标准、重症标准）
            reviewed_by TEXT,
            reviewed_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id),
            FOREIGN KEY (our_spec_id) REFERENCES interface_specs(id),
            FOREIGN KEY (vendor_spec_id) REFERENCES interface_specs(id)
        )
    ''')
    try:
        cursor.execute("ALTER TABLE interface_comparisons ADD COLUMN category TEXT")
    except: pass

    # 34. 字段级映射关系
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS field_mappings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            comparison_id INTEGER NOT NULL,
            our_field_id INTEGER,
            vendor_field_id INTEGER,
            our_field_name TEXT,
            vendor_field_name TEXT,
            mapping_status TEXT NOT NULL DEFAULT 'pending',
            transform_rule TEXT,
            ai_suggestion TEXT,
            is_confirmed INTEGER DEFAULT 0,
            remark TEXT,
            FOREIGN KEY (comparison_id) REFERENCES interface_comparisons(id) ON DELETE CASCADE,
            FOREIGN KEY (our_field_id) REFERENCES interface_spec_fields(id),
            FOREIGN KEY (vendor_field_id) REFERENCES interface_spec_fields(id)
        )
    ''')

    # ========== 数据库升级：添加缺失的列 ==========
    columns_to_add = [
        ('priority', "TEXT DEFAULT '普通'"),
        ('icu_beds', 'INTEGER DEFAULT 0'),
        ('operating_rooms', 'INTEGER DEFAULT 0'),
        ('pacu_beds', 'INTEGER DEFAULT 0'),
        ('data_hash', 'TEXT'),
        ('province', 'TEXT'),
        ('city', 'TEXT'),
        ('address', 'TEXT'),
        ('contract_no', 'TEXT'),
        ('actual_end_date', 'DATE'),
        ('risk_score', 'REAL DEFAULT 0')
    ]
    
    # 升级：项目阶段表添加责任人和奖金
    stage_columns = [row[1] for row in cursor.execute("PRAGMA table_info(project_stages)").fetchall()]
    if 'responsible_person' not in stage_columns:
        cursor.execute("ALTER TABLE project_stages ADD COLUMN responsible_person TEXT")
    if 'bonus_amount' not in stage_columns:
        cursor.execute("ALTER TABLE project_stages ADD COLUMN bonus_amount REAL DEFAULT 0")

    # 升级：日志和费用添加阶段关联
    log_columns = [row[1] for row in cursor.execute("PRAGMA table_info(work_logs)").fetchall()]
    if 'stage_id' not in log_columns:
        cursor.execute("ALTER TABLE work_logs ADD COLUMN stage_id INTEGER")

    expense_columns = [row[1] for row in cursor.execute("PRAGMA table_info(project_expenses)").fetchall()]
    if 'stage_id' not in expense_columns:
        cursor.execute("ALTER TABLE project_expenses ADD COLUMN stage_id INTEGER")
    
    # 升级：人员表增加当前城市
    member_columns = [row[1] for row in cursor.execute("PRAGMA table_info(project_members)").fetchall()]
    if 'current_city' not in member_columns:
        cursor.execute("ALTER TABLE project_members ADD COLUMN current_city TEXT")
    
    asset_columns = [row[1] for row in cursor.execute("PRAGMA table_info(hardware_assets)").fetchall()]
    if 'current_project_id' not in asset_columns:
        cursor.execute("ALTER TABLE hardware_assets ADD COLUMN current_project_id INTEGER")
    
    # 升级：知识库增加附件和外链
    kb_columns = [row[1] for row in cursor.execute("PRAGMA table_info(knowledge_base)").fetchall()]
    if 'attachment_path' not in kb_columns:
        cursor.execute("ALTER TABLE knowledge_base ADD COLUMN attachment_path TEXT")
    if 'external_link' not in kb_columns:
        cursor.execute("ALTER TABLE knowledge_base ADD COLUMN external_link TEXT")
    if 'assoc_stage' not in kb_columns:
        cursor.execute("ALTER TABLE knowledge_base ADD COLUMN assoc_stage TEXT")
    
    existing_columns = [row[1] for row in cursor.execute("PRAGMA table_info(projects)").fetchall()]
    
    for col_name, col_def in columns_to_add:
        if col_name not in existing_columns:
            try:
                cursor.execute(f'ALTER TABLE projects ADD COLUMN {col_name} {col_def}')
                print(f"Added column {col_name} to projects table")
            except Exception as e:
                print(f"Column {col_name} might already exist: {e}")
    
    # 升级：为现有项目添加‘表单制作’阶段
    migrate_add_form_making_stage(cursor)
    
    conn.commit()
    
    # ========== 性能优化：添加常用外键索引 ==========
    indexes = [
        ("idx_tasks_stage_id", "tasks", "stage_id"),
        ("idx_project_stages_project_id", "project_stages", "project_id"),
        ("idx_milestones_project_id", "milestones", "project_id"),
        ("idx_interfaces_project_id", "interfaces", "project_id"),
        ("idx_issues_project_id", "issues", "project_id"),
        ("idx_medical_devices_project_id", "medical_devices", "project_id"),
        ("idx_notifications_project_id", "notifications", "project_id"),
        ("idx_documents_project_id", "documents", "project_id"),
        ("idx_project_members_project_id", "project_members", "project_id"),
        ("idx_worklogs_project_id", "worklogs", "project_id"),
        ("idx_task_deps_task_id", "task_dependencies", "task_id"),
        ("idx_task_deps_depends_on", "task_dependencies", "depends_on_task_id"),
        ("idx_snapshots_project_id", "progress_snapshots", "project_id"),
        ("idx_standup_project_id", "standup_minutes", "project_id"),
        ("idx_interface_specs_project", "interface_specs", "project_id"),
        ("idx_interface_specs_source", "interface_specs", "spec_source"),
        ("idx_spec_fields_spec", "interface_spec_fields", "spec_id"),
        ("idx_comparisons_project", "interface_comparisons", "project_id"),
        ("idx_field_mappings_comp", "field_mappings", "comparison_id"),
    ]
    for idx_name, table_name, column_name in indexes:
        try:
            cursor.execute(f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table_name}({column_name})")
        except Exception as e:
            pass  # 索引可能已存在或表不存在

    # 升级 project_members 增加由 GeoService 使用的经纬度和城市
    try:
        cursor.execute("ALTER TABLE project_members ADD COLUMN current_city TEXT")
    except: pass
    try:
        cursor.execute("ALTER TABLE project_members ADD COLUMN lng REAL")
    except: pass
    try:
        cursor.execute("ALTER TABLE project_members ADD COLUMN lat REAL")
    except: pass

    conn.commit()
    close_db()



# ========== 辅助函数 ==========
def migrate_add_form_making_stage(cursor):
    """为现有项目添加‘表单制作’阶段"""
    # 查找没有‘表单制作’阶段的项目
    projects = cursor.execute('''
        SELECT id FROM projects 
        WHERE id NOT IN (SELECT project_id FROM project_stages WHERE stage_name = '表单制作')
    ''').fetchall()
    
    for p in projects:
        pid = p[0] if isinstance(p, (list, tuple)) else p['id']
        # 查找‘系统部署’阶段，确定插入位置
        deployment_stage = cursor.execute('''
            SELECT stage_order, plan_end_date 
            FROM project_stages 
            WHERE project_id = ? AND stage_name = '系统部署'
        ''', (pid,)).fetchone()
        
        if deployment_stage:
            dep_order = deployment_stage[0] if isinstance(deployment_stage, (list, tuple)) else deployment_stage['stage_order']
            dep_end_date = deployment_stage[1] if isinstance(deployment_stage, (list, tuple)) else deployment_stage['plan_end_date']
            
            order = dep_order + 1
            # 后续阶段顺序+1
            cursor.execute('''
                UPDATE project_stages SET stage_order = stage_order + 1 
                WHERE project_id = ? AND stage_order >= ?
            ''', (pid, order))
            
            # 插入‘表单制作’
            cursor.execute('''
                INSERT INTO project_stages (project_id, stage_name, stage_order, plan_start_date, plan_end_date, status)
                VALUES (?, '表单制作', ?, ?, ?, '待开始')
            ''', (pid, order, dep_end_date, dep_end_date))
            
            stage_id = cursor.lastrowid
            # 添加任务
            tasks = ['表单设计说明书', '表单配置', '表单测试']
            for t in tasks:
                cursor.execute('INSERT INTO tasks (stage_id, task_name) VALUES (?, ?)', (stage_id, t))



def migrate_to_dynamic_milestones():
    """将现有项目的静态里程碑迁移为基于阶段的动态里程碑"""
    conn = get_db()
    cursor = conn.cursor()
    projects = cursor.execute('SELECT id FROM projects').fetchall()
    for p in projects:
        pid = p['id']
        # 删除旧里程碑
        cursor.execute('DELETE FROM milestones WHERE project_id = ?', (pid,))
        # 重新创建基于阶段的里程碑
        stages = cursor.execute('SELECT stage_name, plan_end_date FROM project_stages WHERE project_id = ? ORDER BY stage_order', (pid,)).fetchall()
        for s in stages:
            m_name = f"{s['stage_name']}完成"
            cursor.execute('INSERT INTO milestones (project_id, name, target_date) VALUES (?, ?, ?)',
                         (pid, m_name, s['plan_end_date']))
            # 同步一次状态
            project_service.sync_project_milestones(pid, cursor)
    conn.commit()

init_db()
migrate_to_dynamic_milestones()

def log_operation(operator, op_type, entity_type, entity_id, entity_name, old_val=None, new_val=None):
    """记录操作日志"""
    conn = get_db()
    conn.execute('''
        INSERT INTO operation_logs (operator, operation_type, entity_type, entity_id, entity_name, old_value, new_value)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', (operator or '系统', op_type, entity_type, entity_id, entity_name, 
          json.dumps(old_val, ensure_ascii=False) if old_val else None,
          json.dumps(new_val, ensure_ascii=False) if new_val else None))
    conn.commit()


# ========== Analytics and Statistics - Migrated to analytics_service


@app.route('/')
def index():
    return render_template('index.html')
@app.route('/alignment')
def alignment_page():
    return render_template('alignment.html')

# ========== 项目健康度仪表盘 API ==========
@app.route('/api/dashboard/health', methods=['GET'])
def get_project_health_dashboard():
    """获取所有项目的健康度指标"""
    conn = get_db()
    cursor = conn.cursor()
    
    # 获取所有活跃项目（排除已完成和已终止）
    cursor.execute('''
        SELECT id, project_name, hospital_name, status, progress, 
               plan_end_date, risk_score, project_manager
        FROM projects 
        WHERE status NOT IN ('已完成', '已终止')
        ORDER BY risk_score DESC, progress ASC
    ''')
    projects = [dict(zip([c[0] for c in cursor.description], r)) for r in cursor.fetchall()]
    
    health_data = []
    today = datetime.now().date()
    
    for p in projects:
        project_id = p['id']
        
        # 1. 进度偏差计算
        try:
            plan_end = datetime.strptime(p['plan_end_date'].strip(), '%Y-%m-%d').date() if p.get('plan_end_date') and p['plan_end_date'].strip() else None
        except (ValueError, AttributeError):
            plan_end = None
        if plan_end:
            total_days = (plan_end - today).days
            expected_progress = max(0, min(100, 100 - (total_days / 90 * 100))) if total_days > 0 else 100
            progress_deviation = (p.get('progress') or 0) - expected_progress
        else:
            progress_deviation = 0
        
        # 2. 问题数量
        cursor.execute("SELECT COUNT(*) FROM issues WHERE project_id = ? AND status != '已解决'", (project_id,))
        open_issues = cursor.fetchone()[0]
        
        # 3. 接口完成率
        cursor.execute("SELECT COUNT(*) FROM interfaces WHERE project_id = ?", (project_id,))
        total_interfaces = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM interfaces WHERE project_id = ? AND status = '已完成'", (project_id,))
        completed_interfaces = cursor.fetchone()[0]
        interface_rate = (completed_interfaces / total_interfaces * 100) if total_interfaces > 0 else 100
        
        # 4. 里程碑状态
        cursor.execute("""
            SELECT COUNT(*) FROM milestones 
            WHERE project_id = ? AND is_completed = 0 AND target_date < ?
        """, (project_id, today.strftime('%Y-%m-%d')))
        overdue_milestones = cursor.fetchone()[0]
        
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
    
    close_db()
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
    conn = get_db()
    templates = conn.execute('SELECT * FROM project_templates_custom ORDER BY created_at DESC').fetchall()
    close_db()
    return api_response(True, [dict(t) for t in templates])

@app.route('/api/projects/<int:project_id>/save-as-template', methods=['POST'])
def save_project_as_template(project_id):
    """将项目保存为模板"""
    import json
    data = request.json
    conn = get_db()
    cursor = conn.cursor()
    
    # 获取项目基本信息
    project = cursor.execute('SELECT * FROM projects WHERE id = ?', (project_id,)).fetchone()
    if not project:
        close_db()
        return api_response(False, message='项目不存在', code=404)
    
    # 获取阶段和任务
    stages = cursor.execute('SELECT * FROM project_stages WHERE project_id = ?', (project_id,)).fetchall()
    stages_data = []
    for stage in stages:
        tasks = cursor.execute('SELECT task_name, is_completed FROM tasks WHERE stage_id = ?', (stage['id'],)).fetchall()
        stages_data.append({
            'name': stage['stage_name'],
            'order_num': stage['stage_order'],
            'tasks': [{'name': t['task_name']} for t in tasks]
        })
    
    # 获取里程碑模板
    milestones = cursor.execute('SELECT name FROM milestones WHERE project_id = ?', (project_id,)).fetchall()
    
    # 组装模板数据
    template_data = {
        'stages': stages_data,
        'milestones': [{'name': m['name']} for m in milestones],
        'icu_beds': project['icu_beds'],
        'operating_rooms': project['operating_rooms'],
        'pacu_beds': project['pacu_beds']
    }
    
    # 保存模板
    cursor.execute('''
        INSERT INTO project_templates_custom (name, description, source_project_id, template_data, created_by)
        VALUES (?, ?, ?, ?, ?)
    ''', (
        data.get('name', f"{project['project_name']}_模板"),
        data.get('description', f"从项目「{project['project_name']}」创建"),
        project_id,
        json.dumps(template_data, ensure_ascii=False),
        session.get('username', 'system')
    ))
    conn.commit()
    template_id = cursor.lastrowid
    close_db()
    
    return api_response(True, {'id': template_id, 'message': '模板保存成功'})

@app.route('/api/templates/<int:template_id>', methods=['DELETE'])
def delete_template(template_id):
    """删除项目模板"""
    conn = get_db()
    conn.execute('DELETE FROM project_templates_custom WHERE id = ?', (template_id,))
    conn.commit()
    close_db()
    return api_response(True, message='模板已删除')

# ========== 客户沟通记录 API ==========
@app.route('/api/projects/<int:project_id>/communications', methods=['GET'])
def get_project_communications(project_id):
    """获取项目的沟通记录"""
    conn = get_db()
    records = conn.execute('''
        SELECT * FROM customer_communications 
        WHERE project_id = ? ORDER BY contact_date DESC
    ''', (project_id,)).fetchall()
    close_db()
    return api_response(True, [dict(r) for r in records])

@app.route('/api/projects/<int:project_id>/communications', methods=['POST'])
def add_project_communication(project_id):
    """添加沟通记录"""
    data = request.json
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO customer_communications 
        (project_id, contact_date, contact_person, contact_method, summary, related_issue_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', (
        project_id,
        data.get('contact_date'),
        data.get('contact_person'),
        data.get('contact_method'),
        data.get('summary'),
        data.get('related_issue_id'),
        data.get('created_by', 'system')
    ))
    conn.commit()
    record_id = cursor.lastrowid
    close_db()
    return api_response(True, {'id': record_id})

@app.route('/api/communications/<int:record_id>', methods=['DELETE'])
def delete_communication(record_id):
    """删除沟通记录"""
    conn = get_db()
    conn.execute('DELETE FROM customer_communications WHERE id = ?', (record_id,))
    conn.commit()
    close_db()
    return api_response(True, message='记录已删除')

@app.route('/api/projects/<int:project_id>/communications/analyze', methods=['POST'])
def analyze_communications(project_id):
    """AI分析客户沟通记录 - 从项目管理/需求分析师视角"""
    conn = get_db()
    
    project = conn.execute('SELECT * FROM projects WHERE id = ?', (project_id,)).fetchone()
    if not project:
        close_db()
        return jsonify({'error': '项目不存在'}), 404
    
    # 获取所有沟通记录
    records = conn.execute('''
        SELECT * FROM customer_communications 
        WHERE project_id = ? ORDER BY contact_date DESC
    ''', (project_id,)).fetchall()
    
    if not records:
        close_db()
        return jsonify({'error': '暂无沟通记录，请先添加沟通记录再进行分析'}), 400
    
    # 获取项目阶段和进度
    stages = conn.execute(
        'SELECT stage_name, progress FROM project_stages WHERE project_id = ? ORDER BY stage_order',
        (project_id,)
    ).fetchall()
    
    # 获取活跃问题
    issues = conn.execute(
        "SELECT description, severity, status FROM issues WHERE project_id = ? AND status != '已解决'",
        (project_id,)
    ).fetchall()
    
    close_db()
    
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
        return jsonify({'analysis': analysis})
    except Exception as e:
        return jsonify({'error': f'AI分析失败: {str(e)}'}), 500

@app.route('/api/extract-text', methods=['POST'])
def extract_text():
    """从上传的文件中提取文本内容（支持 PDF/Word/TXT 等）"""
    if 'file' not in request.files:
        return jsonify({'success': False, 'message': '没有选择文件'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'message': '没有选择文件'}), 400
    
    from services.file_parser import is_supported, extract_text_from_file
    if not is_supported(file.filename):
        return jsonify({'success': False, 'message': '不支持的文件格式'}), 400
        
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
            
        return jsonify({
            'success': True,
            'data': {
                'text': text,
                'filename': file.filename,
                'length': len(text)
            }
        })
    except Exception as e:
        if os.path.exists(filepath):
            os.remove(filepath)
        return jsonify({'success': False, 'message': f'文本提取失败: {str(e)}'}), 500

@app.route('/api/projects/<int:project_id>/communications/analyze-file', methods=['POST'])
def analyze_communication_file(project_id):
    """上传文件并进行AI分析 - 从项目管理/需求分析师视角"""
    if 'file' not in request.files:
        return jsonify({'error': '没有选择文件'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': '没有选择文件'}), 400

    from services.file_parser import is_supported, extract_text_from_file
    if not is_supported(file.filename):
        return jsonify({'error': f'不支持的文件格式。支持: Word(.docx), PDF, Excel(.xlsx), TXT, CSV, Markdown'}), 400

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
        return jsonify({'error': file_text}), 400

    # 截取前 8000 字符避免超出 AI token 限制
    if len(file_text) > 8000:
        file_text = file_text[:8000] + f"\n\n... [文件内容过长，已截取前 8000 字符，原文共 {len(file_text)} 字符]"

    # 获取项目上下文
    conn = get_db()
    project = conn.execute('SELECT * FROM projects WHERE id = ?', (project_id,)).fetchone()
    if not project:
        close_db()
        return jsonify({'error': '项目不存在'}), 404

    stages = conn.execute(
        'SELECT stage_name, progress FROM project_stages WHERE project_id = ? ORDER BY stage_order',
        (project_id,)
    ).fetchall()
    issues = conn.execute(
        "SELECT description, severity, status FROM issues WHERE project_id = ? AND status != '已解决'",
        (project_id,)
    ).fetchall()
    close_db()

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
        return jsonify({'analysis': analysis, 'filename': file.filename, 'text_length': len(file_text)})
    except Exception as e:
        return jsonify({'error': f'AI分析失败: {str(e)}'}), 500

# ========== AI项目复盘 API ==========
@app.route('/api/projects/<int:project_id>/ai-retrospective', methods=['POST'])
def ai_project_retrospective(project_id):
    """AI生成项目复盘报告"""
    try:
        from ai_utils import call_ai
        
        conn = get_db()
        # 获取项目信息
        project = conn.execute('SELECT * FROM projects WHERE id = ?', (project_id,)).fetchone()
        if not project:
            close_db()
            return api_response(False, message='项目不存在', code=404)
        
        # 获取项目统计
        stages = conn.execute('SELECT * FROM project_stages WHERE project_id = ?', (project_id,)).fetchall()
        tasks = conn.execute('''
            SELECT t.* FROM tasks t 
            JOIN project_stages s ON t.stage_id = s.id 
            WHERE s.project_id = ?
        ''', (project_id,)).fetchall()
        issues = conn.execute('SELECT * FROM issues WHERE project_id = ?', (project_id,)).fetchall()
        logs = conn.execute('SELECT * FROM work_logs WHERE project_id = ? ORDER BY log_date DESC LIMIT 50', (project_id,)).fetchall()
        close_db()
        
        # 构建prompt
        completed_tasks = sum(1 for t in tasks if t['status'] == '已完成')
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
        
        conn = get_db()
        # 获取项目信息
        project = conn.execute('SELECT * FROM projects WHERE id = ?', (project_id,)).fetchone()
        if not project:
            close_db()
            return api_response(False, message='项目不存在', code=404)
        
        # 获取未分配任务 (由于schema中没有assigned_to，目前认为未完成的任务即为待分配任务)
        tasks = conn.execute('''
            SELECT t.id, t.task_name, t.is_completed, s.stage_name
            FROM tasks t 
            JOIN project_stages s ON t.stage_id = s.id 
            WHERE s.project_id = ? AND t.is_completed = 0
        ''', (project_id,)).fetchall()
        
        # 获取团队成员
        members = conn.execute('''
            SELECT * FROM project_members 
            WHERE project_id = ? AND status = '在岗'
        ''', (project_id,)).fetchall()
        close_db()
        
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
            logger.warning(f"AI Task Suggestions JSON parse failed: {e}")
        
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
    data = request.json
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
    date_str = request.json.get('date') if request.json else None
    result = standup_service.generate_ai_standup(project_id, date_str)

    # 保存到数据库
    if result.get('standup'):
        conn = get_db()
        today = date_str or datetime.now().strftime('%Y-%m-%d')
        conn.execute('''
            INSERT OR REPLACE INTO standup_minutes (project_id, meeting_date, content, ai_generated, created_by)
            VALUES (?, ?, ?, 1, 'AI')
        ''', (project_id, today, result['standup']))
        conn.commit()
        close_db()

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
    conn = get_db()
    records = conn.execute('''
        SELECT * FROM standup_minutes
        WHERE project_id = ?
        ORDER BY meeting_date DESC
        LIMIT 30
    ''', (project_id,)).fetchall()
    close_db()
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
    conn = get_db()
    hospitals = conn.execute('SELECT DISTINCT hospital_name FROM projects ORDER BY hospital_name').fetchall()
    # Connection closed by teardown
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
        data = request.json
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
        return api_response(False, message=str(e), code=500)

@app.route('/api/auth/register', methods=['POST'])
def user_register():
    """用户注册"""
    try:
        from services.auth_service import auth_service
        data = request.json
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
        return api_response(False, message=str(e), code=500)

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
        from services.auth_service import auth_service
        users = auth_service.get_all_users()
        return api_response(True, users)
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
        from services.auth_service import auth_service
        # 验证权限
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            token = request.cookies.get('auth_token')
        current_user = auth_service.validate_token(token)
        
        if not current_user or current_user['role'] != 'admin':
            return api_response(False, message="仅管理员可操作", code=403)
            
        data = request.json
        is_active = data.get('is_active', True)
        
        # 防止禁用自己
        if user_id == current_user['id'] and not is_active:
             return api_response(False, message="不能禁用当前登录账号", code=400)

        result = auth_service.update_user_status(user_id, is_active)
        return api_response(result['success'], message=result.get('message'))
    except Exception as e:
        return api_response(False, message=str(e), code=500)

@app.route('/api/users/<int:user_id>/password', methods=['POST'])
def reset_user_password(user_id):
    """重置用户密码（仅管理员）"""
    try:
        from services.auth_service import auth_service
        # 验证权限
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            token = request.cookies.get('auth_token')
        current_user = auth_service.validate_token(token)
        
        if not current_user or current_user['role'] != 'admin':
            return api_response(False, message="仅管理员可操作", code=403)
            
        data = request.json
        new_password = data.get('password')
        if not new_password:
             return api_response(False, message="新密码不能为空", code=400)

        result = auth_service.reset_user_password(user_id, new_password)
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
        data = request.json
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
        data = request.json
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
        data = request.json
        query = data.get('query', '')
        if not query:
            return api_response(False, message="查询内容不能为空", code=400)
        
        # 构建查询上下文
        conn = get_db()
        projects = conn.execute('''
            SELECT id, project_name, hospital_name, status, progress, project_manager 
            FROM projects WHERE status NOT IN ('已完成', '已终止')
        ''').fetchall()
        
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
        data = request.json
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
        # 在线程中需要手动管理上下文如果用到 current_app，但这里主要是DB操作
        # DatabasePool是线程安全的，get_db()会为新线程创建连接
        
        conn = get_db()
        project = dict(conn.execute('SELECT * FROM projects WHERE id = ?', (project_id,)).fetchone())
        stages = [dict(s) for s in conn.execute('SELECT * FROM project_stages WHERE project_id = ?', (project_id,)).fetchall()]
        issues = [dict(i) for i in conn.execute('SELECT * FROM issues WHERE project_id = ? AND status != "已解决"', (project_id,)).fetchall()]
        interfaces = [dict(i) for i in conn.execute('SELECT * FROM interfaces WHERE project_id = ? AND status != "已完成"', (project_id,)).fetchall()]
        devices = [dict(d) for d in conn.execute('SELECT * FROM medical_devices WHERE project_id = ?', (project_id,)).fetchall()]
        members = [dict(m) for m in conn.execute('SELECT * FROM project_members WHERE project_id = ? AND status = "在岗"', (project_id,)).fetchall()]
        departures = [dict(d) for d in conn.execute('SELECT * FROM project_departures WHERE project_id = ? ORDER BY created_at DESC LIMIT 3', (project_id,)).fetchall()]
        # Connection closed automatically by thread exit? No, need to close manually in thread or use context manager
        # Since we are not in request context, teardown won't run automatically? 
        # Actually executor threads are long lived? DatabasePool uses thread local.
        # We should close the connection at the end of the task.
        
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
        close_db()
        
        analysis_result = call_deepseek_api(system_prompt, f"请分析以下项目数据：\n{project_data_str}", task_type="analysis")
        
        # Re-open DB to save result
        data_hash = analytics_service.calculate_project_hash(project_id)
        analytics_service.save_report_cache(project_id, 'ai_analysis', analysis_result, data_hash)
        
        task_results[task_id] = {"status": "completed", "result": analysis_result}
        
    except Exception as e:
        task_results[task_id] = {"status": "failed", "error": str(e)}
        # Ensure db is closed in case of error
        close_db(e)

@app.route('/api/tasks/<task_id>', methods=['GET'])
def get_task_result(task_id):
    result = task_results.get(task_id)
    if result is None:
        return api_response(False, message="任务不存在 (Task not found)", code=404)
    return api_response(True, result)



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
        conn = get_db()
        project = dict(conn.execute('SELECT * FROM projects WHERE id = ?', (project_id,)).fetchone())
        stages = [dict(s) for s in conn.execute('SELECT * FROM project_stages WHERE project_id = ? ORDER BY stage_order', (project_id,)).fetchall()]
        week_ago = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
        completed_tasks = conn.execute('''
            SELECT t.task_name, s.stage_name, t.completed_date 
            FROM tasks t JOIN project_stages s ON t.stage_id = s.id 
            WHERE s.project_id = ? AND t.is_completed = 1 AND t.completed_date >= ?
        ''', (project_id, week_ago)).fetchall()
        new_issues = conn.execute('SELECT * FROM issues WHERE project_id = ? AND created_at >= ?', (project_id, week_ago)).fetchall()
        pending_issues = conn.execute("SELECT * FROM issues WHERE project_id = ? AND status != '已解决'", (project_id,)).fetchall()
        interfaces = conn.execute('SELECT * FROM interfaces WHERE project_id = ?', (project_id,)).fetchall()
        work_logs = conn.execute('SELECT * FROM work_logs WHERE project_id = ? AND log_date >= ? ORDER BY log_date', (project_id, week_ago)).fetchall()
        # Close reading connection
        close_db()
        
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
            
        task_results[task_id] = {"status": "completed", "result": report}
        
    except Exception as e:
        task_results[task_id] = {"status": "failed", "error": str(e)}
        close_db(e)

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
        task_results[task_id] = {"status": "processing"}
        
        safe_submit(_run_weekly_report_task, task_id, project_id)
        
        return api_response(True, {"task_id": task_id, "status": "processing"})
    except Exception as e:
        app.logger.error(f"Generate Weekly Report Error: {e}")
        return api_response(False, message=f"服务器内部错误: {str(e)}", code=500)


    
def _run_all_report_task(task_id):
    """后台运行全局周报生成任务"""
    try:
        conn = get_db()
        projects = conn.execute("""
            SELECT * FROM projects WHERE status NOT IN ('已完成', '已终止')
            ORDER BY priority DESC, progress DESC
        """).fetchall()
        
        if not projects:
            close_db()
            task_results[task_id] = {"status": "failed", "error": "没有进行中的项目"}
            return

        week_ago = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
        all_data = []
        for p in projects:
            pid = p['id']
            stages = [dict(s) for s in conn.execute('SELECT * FROM project_stages WHERE project_id = ? ORDER BY stage_order', (pid,)).fetchall()]
            issues = [dict(i) for i in conn.execute("SELECT * FROM issues WHERE project_id = ? AND status != '已解决'", (pid,)).fetchall()]
            completed_tasks = [dict(t) for t in conn.execute('''
                SELECT t.task_name, s.stage_name, t.completed_date 
                FROM tasks t JOIN project_stages s ON t.stage_id = s.id 
                WHERE s.project_id = ? AND t.is_completed = 1 AND t.completed_date >= ?
            ''', (pid, week_ago)).fetchall()]
            new_issues = [dict(i) for i in conn.execute('SELECT * FROM issues WHERE project_id = ? AND created_at >= ?', (pid, week_ago)).fetchall()]
            interfaces = [dict(i) for i in conn.execute('SELECT * FROM interfaces WHERE project_id = ?', (pid,)).fetchall()]
            interface_completed = len([i for i in interfaces if i['status'] == '已完成'])
            work_hours = conn.execute('SELECT SUM(work_hours) as total FROM work_logs WHERE project_id = ? AND log_date >= ?', (pid, week_ago)).fetchone()['total'] or 0
            
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
        
        close_db()
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
            
        task_results[task_id] = {"status": "completed", "result": report}
    except Exception as e:
        task_results[task_id] = {"status": "failed", "error": str(e)}
        close_db(e)

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
    task_results[task_id] = {"status": "processing"}
    safe_submit(_run_all_report_task, task_id)
    return api_response(True, {"task_id": task_id, "status": "processing"})

# ========== 燃尽图数据 API ==========
@app.route('/api/projects/<int:project_id>/burndown', methods=['GET'])
def get_burndown_data(project_id):
    conn = get_db()
    project = conn.execute('SELECT * FROM projects WHERE id = ?', (project_id,)).fetchone()
    if not project:
        close_db()
        return jsonify({'error': '项目不存在'}), 404
    
    # 获取历史记录
    history = conn.execute('''
        SELECT record_date, progress, tasks_total, tasks_completed 
        FROM progress_history WHERE project_id = ? ORDER BY record_date
    ''', (project_id,)).fetchall()
    
    # 获取当前状态
    tasks_stats = conn.execute('''
        SELECT COUNT(*) as total, SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END) as completed
        FROM tasks t JOIN project_stages s ON t.stage_id = s.id WHERE s.project_id = ?
    ''', (project_id,)).fetchone()
    total_tasks = tasks_stats['total'] or 0
    completed_tasks = tasks_stats['completed'] or 0
    
    start_date_str = project['plan_start_date'] or project['created_at'][:10]
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
        if history[-1]['record_date'] != today.strftime('%Y-%m-%d'):
            actual_line.append({'date': today.strftime('%Y-%m-%d'), 'value': total_tasks - completed_tasks})
    else:
        # 兜底：如果没有历史记录，生成简单的两点线（开始日和今日）
        actual_line.append({'date': start_date.strftime('%Y-%m-%d'), 'value': total_tasks})
        if today > start_date:
            actual_line.append({'date': today.strftime('%Y-%m-%d'), 'value': total_tasks - completed_tasks})

    close_db()
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
    conn = get_db()
    total_projects = conn.execute("SELECT COUNT(*) as c FROM projects").fetchone()['c']
    in_progress = conn.execute("SELECT COUNT(*) as c FROM projects WHERE status = '进行中'").fetchone()['c']
    completed = conn.execute("SELECT COUNT(*) as c FROM projects WHERE status = '已完成'").fetchone()['c']
    delayed = conn.execute("SELECT COUNT(*) as c FROM projects WHERE plan_end_date < date('now') AND status NOT IN ('已完成', '已终止', '已验收', '质保期')").fetchone()['c']
    on_departure = conn.execute("SELECT COUNT(*) as c FROM projects WHERE status IN ('暂停', '离场待返')").fetchone()['c']
    total_issues = conn.execute("SELECT COUNT(*) as c FROM issues WHERE status != '已解决'").fetchone()['c']
    critical_issues = conn.execute("SELECT COUNT(*) as c FROM issues WHERE status != '已解决' AND severity = '高'").fetchone()['c']
    week_ago = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
    tasks_completed_this_week = conn.execute("SELECT COUNT(*) as c FROM tasks WHERE is_completed = 1 AND completed_date >= ?", (week_ago,)).fetchone()['c']
    
    # 统计逾期里程碑总数
    overdue_milestones_total = conn.execute('''
        SELECT COUNT(*) as c FROM milestones 
        WHERE is_completed = 0 AND target_date < date('now')
    ''').fetchone()['c']

    
    # 按状态分组统计
    status_stats = conn.execute('''
        SELECT status, COUNT(*) as count FROM projects GROUP BY status
    ''').fetchall()
    
    projects_progress = []
    rows = conn.execute('''
        SELECT p.id, p.project_name, p.hospital_name, p.progress, p.status, p.plan_end_date,
        (SELECT COUNT(*) FROM milestones m WHERE m.project_id = p.id AND m.is_completed = 0 AND m.target_date < date('now')) as overdue_count
        FROM projects p WHERE p.status NOT IN ('已完成', '已终止') 
        ORDER BY overdue_count DESC, progress DESC
    ''').fetchall()
    
    for row in rows:
        p_dict = dict(row)
        # 获取该项目的风险得分
        _, risk_score = scan_project_risks(p_dict['id'], conn.cursor())
        p_dict['risk_score'] = risk_score
        
        # 判定阶段
        if p_dict['status'] in ['暂停', '离场待返']: p_dict['phase'] = '离场'
        elif p_dict['plan_end_date'] and p_dict['plan_end_date'] < datetime.now().strftime('%Y-%m-%d'): p_dict['phase'] = '延期'
        elif p_dict['progress'] < 30: p_dict['phase'] = '启动期'
        elif p_dict['progress'] < 70: p_dict['phase'] = '实施中'
        else: p_dict['phase'] = '收尾期'
        
        projects_progress.append(p_dict)

    
    upcoming_reminders = conn.execute('''
        SELECT n.*, p.project_name 
        FROM notifications n 
        LEFT JOIN projects p ON n.project_id = p.id
        WHERE n.is_read = 0 AND (n.due_date IS NULL OR n.due_date >= date('now'))
        ORDER BY n.due_date ASC LIMIT 10
    ''').fetchall()
    
    # 本周工时统计
    week_hours = conn.execute('SELECT SUM(work_hours) as total FROM work_logs WHERE log_date >= ?', (week_ago,)).fetchone()['total'] or 0
    
    # Connection closed by teardown
    
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
    conn = get_db()
    entity_type = request.args.get('entity_type')
    entity_id = request.args.get('entity_id')
    
    query = 'SELECT * FROM operation_logs WHERE 1=1'
    params = []
    
    if entity_type:
        query += ' AND entity_type = ?'
        params.append(entity_type)
    if entity_id:
        query += ' AND entity_id = ?'
        params.append(entity_id)
    
    query += ' ORDER BY created_at DESC LIMIT 100'
    logs = conn.execute(query, params).fetchall()
    close_db()
    return jsonify([dict(l) for l in logs])

# ========== 数据导出 API ==========
@app.route('/api/projects/<int:project_id>/export', methods=['GET'])
def export_project_data(project_id):
    """导出项目完整数据为JSON"""
    conn = get_db()
    
    project = dict(conn.execute('SELECT * FROM projects WHERE id = ?', (project_id,)).fetchone())
    stages = [dict(s) for s in conn.execute('SELECT * FROM project_stages WHERE project_id = ?', (project_id,)).fetchall()]
    for stage in stages:
        stage['tasks'] = [dict(t) for t in conn.execute('SELECT * FROM tasks WHERE stage_id = ?', (stage['id'],)).fetchall()]
    
    data = {
        'export_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'project': project,
        'stages': stages,
        'interfaces': [dict(i) for i in conn.execute('SELECT * FROM interfaces WHERE project_id = ?', (project_id,)).fetchall()],
        'issues': [dict(i) for i in conn.execute('SELECT * FROM issues WHERE project_id = ?', (project_id,)).fetchall()],
        'milestones': [dict(m) for m in conn.execute('SELECT * FROM milestones WHERE project_id = ?', (project_id,)).fetchall()],
        'members': [dict(m) for m in conn.execute('SELECT * FROM project_members WHERE project_id = ?', (project_id,)).fetchall()],
        'contacts': [dict(c) for c in conn.execute('SELECT * FROM customer_contacts WHERE project_id = ?', (project_id,)).fetchall()],
         'departures': [dict(d) for d in conn.execute('SELECT * FROM project_departures WHERE project_id = ?', (project_id,)).fetchall()],
        'work_logs': [dict(w) for w in conn.execute('SELECT * FROM work_logs WHERE project_id = ?', (project_id,)).fetchall()],
        'documents': [dict(d) for d in conn.execute('SELECT * FROM project_documents WHERE project_id = ?', (project_id,)).fetchall()],
        'expenses': [dict(e) for e in conn.execute('SELECT * FROM project_expenses WHERE project_id = ?', (project_id,)).fetchall()],
        'changes': [dict(c) for c in conn.execute('SELECT * FROM project_changes WHERE project_id = ?', (project_id,)).fetchall()],
        'acceptances': [dict(a) for a in conn.execute('SELECT * FROM project_acceptances WHERE project_id = ?', (project_id,)).fetchall()],
        'satisfaction': [dict(s) for s in conn.execute('SELECT * FROM customer_satisfaction WHERE project_id = ?', (project_id,)).fetchall()],
        'follow_ups': [dict(f) for f in conn.execute('SELECT * FROM follow_up_records WHERE project_id = ?', (project_id,)).fetchall()],
        'devices': [dict(d) for d in conn.execute('SELECT * FROM medical_devices WHERE project_id = ?', (project_id,)).fetchall()]
    }
    
    close_db()
    return jsonify(data)


# ========== Global Analytics - Handled by analytics_bp

# ========== 审批中心 API ==========
@app.route('/api/approvals/pending', methods=['GET'])
def get_pending_approvals():
    """获取所有待审批项"""
    conn = get_db()
    
    # 待审批变更
    changes = conn.execute('''
        SELECT c.*, p.project_name, p.hospital_name 
        FROM project_changes c
        JOIN projects p ON c.project_id = p.id
        WHERE c.status = '待审批'
    ''').fetchall()
    
    # 待审批离场 (离场本身目前没有独立状态，但可以根据离场记录中的备注或特定字段判断，或者直接根据未返场且需要审核的规则)
    # 这里简单起见，目前离场申请在add_project_departure中是直接生效的，
    # 我们可以增加一个 status 字段给 project_departures，或者直接让用户审核“变更申请”中的人员/时间变更
    
    close_db()
    return jsonify({
        'changes': [dict(c) for c in changes],
        'departures': [] # 预留
    })

# ========== 知识库 (KB) API ==========
@app.route('/api/kb', methods=['GET'])
def get_kb_list():
    category = request.args.get('category')
    search = request.args.get('search')
    conn = get_db()
    query = 'SELECT * FROM knowledge_base WHERE 1=1'
    params = []
    if category:
        query += ' AND category = ?'
        params.append(category)
    if search:
        query += ' AND (title LIKE ? OR content LIKE ? OR tags LIKE ?)'
        params.extend([f'%{search}%', f'%{search}%', f'%{search}%'])
    query += ' ORDER BY created_at DESC'
    items = conn.execute(query, params).fetchall()
    close_db()
    return jsonify([dict(i) for i in items])

@app.route('/api/kb/<int:kid>', methods=['GET'])
def get_kb_item(kid):
    conn = get_db()
    item = conn.execute('SELECT * FROM knowledge_base WHERE id = ?', (kid,)).fetchone()
    close_db()
    if item:
        return jsonify(dict(item))
    return jsonify({'error': 'Item not found'}), 404

@app.route('/api/kb', methods=['POST'])
def add_kb_item():
    try:
        conn = get_db()
        
        # 支持 multipart/form-data 或 JSON
        if request.content_type and 'multipart/form-data' in request.content_type:
            data = request.form.to_dict()
            file = request.files.get('attachment')
        else:
            data = request.json
            file = None

        attachment_path = None
        if file and file.filename != '':
            try:
                # 使用百度网盘上传
                # 项目ID作为目录隔离
                # 只有当 file 对象非空且有内容时才上传
                project_id = data.get('project_id') or 'common'
                attachment_path = storage_service.upload_file(file, project_id)
            except Exception as e:
                # 打印完整堆栈以方便调试
                import traceback
                traceback.print_exc()
                return jsonify({'success': False, 'message': f'上传失败: {str(e)}'}), 500

        conn.execute('''
            INSERT INTO knowledge_base (category, title, content, tags, assoc_stage, project_id, author, attachment_path, external_link)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (data.get('category'), data.get('title'), data.get('content'), data.get('tags'), 
              data.get('assoc_stage'), data.get('project_id'), data.get('author'),
              attachment_path, data.get('external_link')))
        conn.commit()
        close_db()
        return jsonify({'success': True})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': f'服务器内部错误: {str(e)}'}), 500

@app.route('/api/kb/<int:kid>', methods=['PUT'])
def update_kb_item(kid):
    try:
        conn = get_db()
        
        # 支持 multipart/form-data 或 JSON
        if request.content_type and 'multipart/form-data' in request.content_type:
            data = request.form.to_dict()
            file = request.files.get('attachment')
        else:
            data = request.json
            file = None
            
        # 获取旧数据
        old_item = conn.execute('SELECT attachment_path FROM knowledge_base WHERE id = ?', (kid,)).fetchone()
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

        conn.execute('''
            UPDATE knowledge_base SET category=?, title=?, content=?, tags=?, assoc_stage=?, 
            attachment_path=?, external_link=?, updated_at=CURRENT_TIMESTAMP
            WHERE id=?
        ''', (data.get('category'), data.get('title'), data.get('content'), data.get('tags'), 
              data.get('assoc_stage'), attachment_path, data.get('external_link'), kid))
        conn.commit()
        close_db()
        return jsonify({'success': True})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': f'更新失败: {str(e)}'}), 500

@app.route('/api/kb/<int:kid>/download', methods=['GET'])
def download_kb_attachment(kid):
    conn = get_db()
    item = conn.execute('SELECT title, attachment_path FROM knowledge_base WHERE id = ?', (kid,)).fetchone()
    close_db()
    
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
    conn = get_db()
    # 先获取附件路径
    item = conn.execute('SELECT attachment_path FROM knowledge_base WHERE id = ?', (kid,)).fetchone()
    if item and item['attachment_path']:
        # 尝试删除网盘文件
        if not os.path.exists(item['attachment_path']): # 简单判断非本地文件
             storage_service.delete_file(item['attachment_path'])
             
    conn.execute('DELETE FROM knowledge_base WHERE id = ?', (kid,))
    conn.commit()
    close_db()
    return jsonify({'success': True})

# ========== 硬件资产管理 API ==========
@app.route('/api/assets', methods=['GET'])
def get_assets():
    status = request.args.get('status')
    conn = get_db()
    query = 'SELECT a.*, p.project_name FROM hardware_assets a LEFT JOIN projects p ON a.current_project_id = p.id'
    if status:
        query += ' WHERE a.status = ?'
        items = conn.execute(query, (status,)).fetchall()
    else:
        items = conn.execute(query).fetchall()
    close_db()
    return jsonify([dict(i) for i in items])

@app.route('/api/assets', methods=['POST'])
def add_asset():
    data = request.json
    conn = get_db()
    conn.execute('''
        INSERT INTO hardware_assets (asset_name, sn, model, status, current_project_id, location, operator)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', (data['asset_name'], data.get('sn'), data.get('model'), data.get('status', '在库'),
          data.get('current_project_id'), data.get('location'), data.get('operator')))
    conn.commit()
    close_db()
    return jsonify({'success': True})

@app.route('/api/assets/<int:aid>/status', methods=['PUT'])
def update_asset_status(aid):
    data = request.json
    conn = get_db()
    conn.execute('''
        UPDATE hardware_assets SET status=?, current_project_id=?, location=?, operator=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
    ''', (data['status'], data.get('current_project_id'), data.get('location'), data.get('operator'), aid))
    conn.commit()
    close_db()
    return jsonify({'success': True})

@app.route('/api/assets/<int:aid>', methods=['DELETE'])
def delete_asset(aid):
    conn = get_db()
    conn.execute('DELETE FROM hardware_assets WHERE id = ?', (aid,))
    conn.commit()
    close_db()
    return jsonify({'success': True})

# ========== Workload Analytics - Handled by analytics_bp



# ========== Global Briefing - Handled by analytics_bp

@app.route('/api/ai/risk-analysis', methods=['POST'])
def ai_risk_analysis():
    """
    项目风险预警分析
    """
    data = request.json
    project_id = data.get('project_id')
    if not project_id:
        return jsonify({'error': '项目ID不能为空'}), 400

    conn = get_db()
    cursor = conn.cursor()
    
    # 1. 采集项目深度数据
    # 基本信息
    row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not row:
        return jsonify({'error': '项目不存在'}), 404
        
    project = dict(row)
    
    # 最近 5 条日志
    cursor.execute("SELECT work_content, issues_encountered FROM work_logs WHERE project_id = ? ORDER BY log_date DESC LIMIT 5", (project_id,))
    logs = [f"内容: {r[0]}, 问题: {r[1]}" for r in cursor.fetchall()]
    
    # 未解决的问题
    # schema correction: issues table has description, severity, status (no title, priority)
    cursor.execute("SELECT description, severity, status FROM issues WHERE project_id = ? AND status != '已解决'", (project_id,))
    issues = [f"[{r[1]}] {r[0]} ({r[2]})" for r in cursor.fetchall()]

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
    data = request.json
    question = data.get('question', '')
    if not question:
        return jsonify({'error': '问题不能为空'}), 400

    try:
        conn = get_db()
        cursor = conn.cursor()
        
        try:
            # 第一阶段：关键词粗筛
            cursor.execute("""
                SELECT id, title, content, category, tags 
                FROM knowledge_base 
                WHERE title LIKE ? OR content LIKE ? OR tags LIKE ? 
                LIMIT 100
            """, (f'%{question}%', f'%{question}%', f'%{question}%'))
            
            candidates = cursor.fetchall()
            columns_basic = [column[0] for column in cursor.description]
            
            if len(candidates) < 5:
                # 兜底：如果关键词没中，加载一部分最新数据
                cursor.execute("SELECT id, title, content, category, tags, embedding FROM knowledge_base ORDER BY id DESC LIMIT 200")
                columns = [column[0] for column in cursor.description]
                kb_items = [dict(zip(columns, row)) for row in cursor.fetchall()]
            else:
                # 第二阶段：根据候选集拉取 embedding
                ids = [dict(zip(columns_basic, r))['id'] for r in candidates]
                placeholders = ','.join('?' * len(ids))
                cursor.execute(f"SELECT id, title, content, category, tags, embedding FROM knowledge_base WHERE id IN ({placeholders})", ids)
                columns = [column[0] for column in cursor.description]
                kb_items = [dict(zip(columns, row)) for row in cursor.fetchall()]
        except sqlite3.OperationalError:
            # 表不存在时的降级处理
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
        data = request.json
        project_id = data.get('project_id')
        conn = get_db()
        project = conn.execute('SELECT * FROM projects WHERE id = ?', (project_id,)).fetchone()
        
        if not project:
            return jsonify({'summary': 'Project not found'}), 404

        # 获取此项目的近期动态 (日志、问题、里程碑)
        logs = conn.execute('SELECT * FROM work_logs WHERE project_id = ? ORDER BY log_date DESC LIMIT 10', (project_id,)).fetchall()
        issues = conn.execute('SELECT * FROM issues WHERE project_id = ? AND status != "已解决" LIMIT 10', (project_id,)).fetchall()
        
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
    finally:
        close_db()

@app.route('/api/projects/<int:project_id>/share/toggle', methods=['POST'])
def toggle_project_share(project_id):
    """
    启用/禁用项目分享
    """
    data = request.json
    enabled = 1 if data.get('enabled') else 0
    
    conn = get_db()
    cursor = conn.cursor()
    
    if enabled:
        # 如果启用，确保有 token
        import uuid
        share_token = str(uuid.uuid4()).replace('-', '')[:16]
        cursor.execute("UPDATE projects SET share_enabled = 1, share_token = ? WHERE id = ?", (share_token, project_id))
    else:
        cursor.execute("UPDATE projects SET share_enabled = 0 WHERE id = ?", (project_id,))
        share_token = None
        
    conn.commit()
    close_db()
    return jsonify({'success': True, 'share_token': share_token})

@app.route('/share/<string:token>')
def public_share_page(token):
    """
    公共预览页面 (无需登录)
    """
    conn = get_db()
    cursor = conn.cursor()
    
    # 1. 查找开启了分享的对应项目
    cursor.execute("SELECT * FROM projects WHERE share_token = ? AND share_enabled = 1", (token,))
    row = cursor.fetchone()
    if not row:
        return "该分享链接不存在或已过期", 404
        
    columns = [column[0] for column in cursor.description]
    project = dict(zip(columns, row))
    project_id = project['id']
    
    # 2. 加载里程碑
    cursor.execute("SELECT * FROM milestones WHERE project_id = ? ORDER BY target_date ASC", (project_id,))
    project['milestones'] = [dict(zip([c[0] for c in cursor.description], r)) for r in cursor.fetchall()]
    
    # 3. 加载进度阶段（动态计算进度，与主系统一致）
    cursor.execute("SELECT * FROM project_stages WHERE project_id = ? ORDER BY stage_order ASC", (project_id,))
    stages_raw = [dict(zip([c[0] for c in cursor.description], r)) for r in cursor.fetchall()]
    
    # 性能优化：一次性获取所有阶段的任务，避免N+1查询
    stage_ids = [s['id'] for s in stages_raw]
    if stage_ids:
        placeholders = ','.join('?' * len(stage_ids))
        cursor.execute(f"SELECT * FROM tasks WHERE stage_id IN ({placeholders})", stage_ids)
        all_tasks = cursor.fetchall()
        # 按stage_id分组
        tasks_by_stage = {}
        for t in all_tasks:
            sid = t[1]  # stage_id是第2列
            if sid not in tasks_by_stage:
                tasks_by_stage[sid] = []
            tasks_by_stage[sid].append(t)
    else:
        tasks_by_stage = {}
    
    stages_list = []
    for stage in stages_raw:
        tasks = tasks_by_stage.get(stage['id'], [])
        if tasks:
            completed = sum(1 for t in tasks if t[3])  # is_completed是第4列(0-indexed: id, stage_id, task_name, is_completed)
            stage['progress'] = int(completed / len(tasks) * 100)
        stages_list.append(stage)
    
    project['stages'] = stages_list

    close_db()
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
        conn = get_db()
        project = conn.execute('SELECT * FROM projects WHERE id = ?', (project_id,)).fetchone()
        
        if not project:
            return jsonify({'error': '项目不存在'}), 404

        # 获取更多项目上下文
        issues = conn.execute('SELECT * FROM issues WHERE project_id = ?', (project_id,)).fetchall()
        tasks = conn.execute('''
            SELECT t.* FROM tasks t
            JOIN project_stages s ON t.stage_id = s.id
            WHERE s.project_id = ?
        ''', (project_id,)).fetchall()
        
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
        
        close_db()
        return jsonify({'analysis': analysis})
        
    except Exception as e:
        app.logger.error(f"AI Analysis Error: {e}")
        return jsonify({'error': str(e), 'analysis': 'AI 分析服务暂时不可用，请查看服务器日志。'}), 500

@app.route('/api/ai/generate-daily-report', methods=['POST'])
def ai_generate_daily_report():
    data = request.json
    project_id = data.get('project_id')
    report_date = data.get('date', datetime.now().strftime('%Y-%m-%d'))
    
    conn = get_db()
    project = conn.execute('SELECT * FROM projects WHERE id = ?', (project_id,)).fetchone()
    
    # 1. 今日日志
    daily_logs = conn.execute('''
        SELECT * FROM work_logs 
        WHERE project_id = ? AND log_date = ?
    ''', (project_id, report_date)).fetchall()
    
    # 2. 今日完成任务
    completed_tasks = conn.execute('''
        SELECT t.* FROM tasks t
        JOIN project_stages s ON t.stage_id = s.id
        WHERE s.project_id = ? AND t.is_completed = 1 AND t.completed_date = ?
    ''', (project_id, report_date)).fetchall()
    
    # 3. 活跃问题 (高风险或待处理)
    active_issues = conn.execute('''
        SELECT * FROM issues 
        WHERE project_id = ? AND status != '已解决'
        ORDER BY severity DESC LIMIT 5
    ''', (project_id,)).fetchall()
    
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
    
    close_db()
    return jsonify({'report': report_content})

# ========== 管理员：AI配置管理 API ==========
from services.auth_service import require_auth
import json

@app.route('/api/admin/ai-configs', methods=['GET'])
@require_auth('*')
def get_ai_configs():
    """获取所有AI配置（仅管理员）"""
    print("DEBUG: Accessing get_ai_configs...")
    conn = get_db()
    try:
        configs = conn.execute('SELECT * FROM ai_configs ORDER BY priority').fetchall()
        print(f"DEBUG: Found {len(configs)} configs.")
    except Exception as e:
        print(f"DEBUG: Error querying ai_configs: {e}")
        close_db()
        return jsonify({'success': False, 'message': str(e)}), 500
    close_db()
    
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
    data = request.json
    
    if not data.get('name') or not data.get('api_key') or not data.get('base_url'):
        return jsonify({'success': False, 'message': '名称、API密钥和URL为必填项'}), 400
    
    # models转为JSON字符串
    models = data.get('models', [])
    if isinstance(models, list):
        models_json = json.dumps(models)
    else:
        models_json = models
    
    conn = get_db()
    try:
        conn.execute('''
            INSERT INTO ai_configs (name, api_key, base_url, models, priority, is_active, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ''', (data['name'], data['api_key'], data['base_url'], models_json, 
              data.get('priority', 1), 1 if data.get('is_active', True) else 0))
        conn.commit()
        close_db()
        return jsonify({'success': True, 'message': '配置已添加'})
    except sqlite3.IntegrityError:
        close_db()
        return jsonify({'success': False, 'message': '配置名称已存在'}), 400
    except Exception as e:
        close_db()
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/admin/ai-configs/<int:config_id>', methods=['PUT'])
@require_auth('*')
def update_ai_config(config_id):
    """更新AI配置（仅管理员）"""
    data = request.json
    conn = get_db()
    
    # 检查配置是否存在
    existing = conn.execute('SELECT api_key FROM ai_configs WHERE id = ?', (config_id,)).fetchone()
    if not existing:
        close_db()
        return jsonify({'success': False, 'message': '配置不存在'}), 404
    
    # 如果没有提供新密钥，保留原密钥
    api_key = data.get('api_key') if data.get('api_key') else existing['api_key']
    
    # models转为JSON字符串
    models = data.get('models', [])
    if isinstance(models, list):
        models_json = json.dumps(models)
    else:
        models_json = models
    
    try:
        conn.execute('''
            UPDATE ai_configs SET name=?, api_key=?, base_url=?, models=?, priority=?, is_active=?, updated_at=CURRENT_TIMESTAMP
            WHERE id=?
        ''', (data.get('name'), api_key, data.get('base_url'), models_json,
              data.get('priority', 1), 1 if data.get('is_active', True) else 0, config_id))
        conn.commit()
        close_db()
        return jsonify({'success': True, 'message': '配置已更新'})
    except Exception as e:
        close_db()
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/admin/ai-configs/<int:config_id>', methods=['DELETE'])
@require_auth('*')
def delete_ai_config(config_id):
    """删除AI配置（仅管理员）"""
    conn = get_db()
    conn.execute('DELETE FROM ai_configs WHERE id = ?', (config_id,))
    conn.commit()
    close_db()
    return jsonify({'success': True, 'message': '配置已删除'})

@app.route('/api/admin/ai-configs/<int:config_id>/test', methods=['POST'])
@require_auth('*')
def test_ai_config(config_id):
    """测试AI配置连通性（仅管理员）"""
    conn = get_db()
    config = conn.execute('SELECT * FROM ai_configs WHERE id = ?', (config_id,)).fetchone()
    close_db()
    
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
    
    conn = get_db()
    migrated = []
    
    # TAPI-DeepSeek
    tapi_key = os.environ.get('TAPI_API_KEY')
    if tapi_key:
        existing = conn.execute('SELECT id FROM ai_configs WHERE name = ?', ('TAPI-DeepSeek',)).fetchone()
        if not existing:
            models = json.dumps(["deepseek-v3.2-speciale", "deepseek-v3-2-251201", "deepseek-v3-1-terminus", "deepseek-v3"])
            conn.execute('''
                INSERT INTO ai_configs (name, api_key, base_url, models, priority, is_active)
                VALUES (?, ?, ?, ?, ?, 1)
            ''', ('TAPI-DeepSeek', tapi_key, 'https://tapi.nyc.mn/v1/chat/completions', models, 1))
            migrated.append('TAPI-DeepSeek')
    
    # ChatAnywhere
    chatanywhere_key = os.environ.get('CHATANYWHERE_API_KEY')
    if chatanywhere_key:
        existing = conn.execute('SELECT id FROM ai_configs WHERE name = ?', ('ChatAnywhere',)).fetchone()
        if not existing:
            models = json.dumps(["deepseek-v3", "deepseek-chat", "gpt-4o-mini", "gpt-3.5-turbo"])
            conn.execute('''
                INSERT INTO ai_configs (name, api_key, base_url, models, priority, is_active)
                VALUES (?, ?, ?, ?, ?, 1)
            ''', ('ChatAnywhere', chatanywhere_key, 'https://api.chatanywhere.org/v1/chat/completions', models, 2))
            migrated.append('ChatAnywhere')
    
    conn.commit()
    close_db()
    
    if migrated:
        return jsonify({'success': True, 'message': f'已导入配置: {", ".join(migrated)}'})
    else:
        return jsonify({'success': True, 'message': '无新配置可导入（已存在或环境变量未设置）'})

# ========== 报告归档 API ==========
from services.scheduler_service import report_scheduler

@app.route('/api/projects/<int:project_id>/report-archive', methods=['GET'])
def get_report_archive(project_id):
    """获取项目的历史归档报告列表"""
    report_type = request.args.get('type')  # daily / weekly
    limit = request.args.get('limit', 50, type=int)
    conn = get_db()
    query = 'SELECT id, project_id, report_type, report_date, generated_by, created_at FROM report_archive WHERE project_id = ?'
    params = [project_id]
    if report_type:
        query += ' AND report_type = ?'
        params.append(report_type)
    query += ' ORDER BY report_date DESC LIMIT ?'
    params.append(limit)
    rows = conn.execute(query, params).fetchall()
    return jsonify([dict(r) for r in rows])

@app.route('/api/report-archive/<int:archive_id>', methods=['GET'])
def get_report_archive_detail(archive_id):
    """获取某份归档报告的详细内容"""
    conn = get_db()
    row = conn.execute('SELECT * FROM report_archive WHERE id = ?', (archive_id,)).fetchone()
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
        result = report_scheduler.generate_for_project(project_id, report_type, force)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ========== 管理员：企业微信配置 API ==========
from services.wecom_service import wecom_service

@app.route('/api/admin/wecom-config', methods=['GET'])
@require_auth('admin')
def get_wecom_config():
    """获取企业微信配置"""
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT config_key, value FROM system_config WHERE config_key LIKE 'wecom_%'")
        configs = cursor.fetchall()
        result = {row['config_key'].replace('wecom_', ''): row['value'] for row in configs}
        
        # 脱敏
        if result.get('secret'):
            result['secret'] = result['secret'][:4] + '****' + result['secret'][-4:] if len(result['secret']) > 8 else '****'
        if result.get('callback_aes_key'):
            result['callback_aes_key'] = '******'
            
        return jsonify({'success': True, 'message': 'Success', 'data': result})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        close_db()

@app.route('/api/admin/wecom-config', methods=['POST'])
@require_auth('admin')
def save_wecom_config():
    """保存企业微信配置"""
    data = request.json or {}
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # 预加载现有配置以处理脱敏数据字段
        cursor.execute("SELECT config_key, value FROM system_config WHERE config_key LIKE 'wecom_%'")
        configs_raw = cursor.fetchall()
        existing = {row['config_key'].replace('wecom_', ''): row['value'] for row in configs_raw}
        
        updates = []
        for key, val in data.items():
            db_key = f"wecom_{key}"
            
            # 如果是脱敏过的且没改，则保留原值
            final_val = val
            is_masked = False
            
            if key == 'secret':
                # 检查是否包含星号，且长度与脱敏后的特征匹配
                if val and '****' in val:
                    is_masked = True
            elif key == 'callback_aes_key' and val == '******':
                is_masked = True
                
            if is_masked:
                final_val = existing.get(key)
                
            updates.append((db_key, str(final_val) if final_val is not None else ""))
            
        for k, v in updates:
            cursor.execute('''
                INSERT INTO system_config (config_key, value) VALUES (?, ?)
                ON CONFLICT(config_key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
            ''', (k, v))
            
        conn.commit()
        
        # 立即重载服务配置
        wecom_service.reload_config()
        
        return jsonify({'success': True, 'message': '企业微信配置已保存'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        close_db()


# ========== 管理员：用户企微绑定 API ==========

@app.route('/api/admin/users/wecom-bindlist', methods=['GET'])
@require_auth('admin')
def get_wecom_bindlist():
    """获取所有用户及其企微绑定状态"""
    conn = get_db()
    try:
        users = conn.execute('''
            SELECT id, username, display_name, role, wecom_userid, is_active
            FROM users ORDER BY id
        ''').fetchall()
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
    finally:
        close_db()

@app.route('/api/admin/users/<int:user_id>/bind-wecom', methods=['POST'])
@require_auth('admin')
def bind_wecom_userid(user_id):
    """手动绑定/更新用户的企微 userid"""
    data = request.json or {}
    wecom_userid = data.get('wecom_userid', '').strip()
    
    conn = get_db()
    try:
        user = conn.execute('SELECT id, display_name FROM users WHERE id = ?', (user_id,)).fetchone()
        if not user:
            return jsonify({'success': False, 'message': '用户不存在'}), 404
        
        if wecom_userid:
            existing = conn.execute(
                'SELECT id, display_name FROM users WHERE wecom_userid = ? AND id != ?',
                (wecom_userid, user_id)
            ).fetchone()
            if existing:
                return jsonify({'success': False, 'message': f'该企微ID已被用户 [{existing["display_name"]}] 绑定'}), 400
            conn.execute('UPDATE users SET wecom_userid = ? WHERE id = ?', (wecom_userid, user_id))
        else:
            conn.execute('UPDATE users SET wecom_userid = NULL WHERE id = ?', (user_id,))
        
        conn.commit()
        return jsonify({'success': True, 'message': f'用户 [{user["display_name"]}] 的企微绑定已更新'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        close_db()

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
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT config_key, value FROM system_config WHERE config_key LIKE 'map_%'")
        configs = cursor.fetchall()
        result = {row['config_key'].replace('map_', ''): row['value'] for row in configs}
        
        # 脱敏
        for key in ['baidu_ak', 'amap_key', 'tianditu_key', 'google_ak']:
            if result.get(key):
                val = result[key]
                result[key] = val[:4] + '****' + val[-4:] if len(val) > 8 else '****'
            
        return jsonify({'success': True, 'data': result})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        close_db()

@app.route('/api/admin/map-config', methods=['POST'])
@require_auth('admin')
def save_map_config():
    """保存地图服务配置"""
    data = request.json or {}
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # 预加载现有配置以处理脱敏
        cursor.execute("SELECT config_key, value FROM system_config WHERE config_key LIKE 'map_%'")
        existing = {row['config_key'].replace('map_', ''): row['value'] for row in cursor.fetchall()}
        
        for key, val in data.items():
            db_key = f"map_{key}"
            final_val = val
            
            # 脱敏逻辑：如果前台传回带 * 的值，说明没改，保留原值
            if key in ['baidu_ak', 'amap_key', 'tianditu_key', 'google_ak'] and val and '****' in val:
                final_val = existing.get(key)
                
            cursor.execute('''
                INSERT INTO system_config (config_key, value) VALUES (?, ?)
                ON CONFLICT(config_key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
            ''', (db_key, str(final_val) if final_val is not None else ""))
            
        conn.commit()
        
        # 立即更新全局 GeoService 配置
        from utils.geo_service import geo_service
        geo_service.reload_config()
        
        return jsonify({'success': True, 'message': '地图服务配置已保存'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500
    finally:
        close_db()


if __name__ == '__main__':
    with app.app_context():
        init_db()
        reload_notification_config()
    # 启动报告自动归档调度器（含晨会简报、项目哨兵等定时任务）
    # 注意：debug 模式下 Flask reloader 会 fork 子进程，
    # 必须在子进程中启动调度器（或关闭 reloader），否则 Timer 线程会丢失
    if os.environ.get('WERKZEUG_RUN_MAIN') == 'true' or not app.debug:
        report_scheduler.start()
    app.run(debug=True, host='0.0.0.0', port=5000, use_reloader=False)

