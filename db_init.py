import json
import os
import logging
import hashlib
from datetime import datetime
from database import DatabasePool

logger = logging.getLogger(__name__)

def allowed_file(filename, allowed_extensions):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in allowed_extensions

def reload_notification_config(NOTIFICATION_CONFIG):
    """从数据库加载并同步系统通知配置"""
    try:
        with DatabasePool.get_connection() as conn:
            configs = conn.execute(
                DatabasePool.format_sql("SELECT config_key, value FROM system_config")
            ).fetchall()
            for row in configs:
                key = row['config_key']
                val = row['value']
                if key == 'wecom_webhook':
                    NOTIFICATION_CONFIG['WECOM_WEBHOOK'] = val
                elif key == 'wecom_enabled':
                    NOTIFICATION_CONFIG['ENABLE_WEBCOM'] = str(val).lower() == 'true'
    except Exception as e:
        print(f"Error loading notification config: {e}")

def init_db():
    """初始化数据库并进行必要的升级"""
    from app_config import DB_CONFIG
    db_type = DB_CONFIG.get('TYPE', 'sqlite')
    with DatabasePool.get_connection() as conn:
        cursor = conn.cursor()
    
        # 辅助变量，用于跨数据库语法兼容
        PK_AUTO = "SERIAL PRIMARY KEY" if db_type == 'postgres' else "INTEGER PRIMARY KEY AUTOINCREMENT"
        REAL_TYPE = "DOUBLE PRECISION" if db_type == 'postgres' else "REAL"
        BOOL_TYPE = "BOOLEAN" if db_type == 'postgres' else "BOOLEAN"
        TIMESTAMP_TYPE = "TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP" if db_type == 'postgres' else "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"

        # PostgreSQL 中 ALTER TABLE 失败会中止整个事务，使用 SAVEPOINT 隔离
        _sp_counter = [0]
        def _safe_alter(sql_pg, sql_lite=None):
            """安全执行 ALTER TABLE，失败不影响后续 SQL"""
            _sp_counter[0] += 1
            sp_name = f"sp_alter_{_sp_counter[0]}"
            try:
                if db_type == 'postgres':
                    cursor.execute(f"SAVEPOINT {sp_name}")
                    try:
                        cursor.execute(sql_pg)
                        cursor.execute(f"RELEASE SAVEPOINT {sp_name}")
                    except Exception:
                        cursor.execute(f"ROLLBACK TO SAVEPOINT {sp_name}")
                else:
                    cursor.execute(sql_lite or sql_pg)
            except Exception:
                pass
        
        # 0. 用户相关表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS users (
                id {PK_AUTO},
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                email TEXT,
                display_name TEXT,
                role TEXT DEFAULT 'team_member',
                wecom_userid TEXT UNIQUE,
                is_active {BOOL_TYPE} DEFAULT {'TRUE' if db_type == 'postgres' else '1'},
                last_login TIMESTAMP,
                created_at {TIMESTAMP_TYPE}
            )
        ''')

        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS user_tokens (
                id {PK_AUTO},
                user_id INTEGER,
                token TEXT UNIQUE NOT NULL,
                expires_at TIMESTAMP,
                created_at {TIMESTAMP_TYPE},
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        ''')

        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS project_user_access (
                id {PK_AUTO},
                project_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                role TEXT DEFAULT 'member',
                created_at {TIMESTAMP_TYPE},
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(project_id, user_id)
            )
        ''')

        # 0.4 系统配置表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS system_config (
                id {PK_AUTO},
                config_key TEXT UNIQUE,
                value TEXT,
                updated_at {TIMESTAMP_TYPE}
            )
        ''')
        
        # 1. 项目主表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS projects (
                id {PK_AUTO},
                project_no TEXT UNIQUE,
                project_name TEXT NOT NULL,
                hospital_name TEXT NOT NULL,
                contract_amount {REAL_TYPE},
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
                risk_score {REAL_TYPE} DEFAULT 0,
                risk_analysis TEXT,
                share_token TEXT UNIQUE,
                share_enabled INTEGER DEFAULT 0,
                created_at {TIMESTAMP_TYPE},
                updated_at {TIMESTAMP_TYPE}
            )
        ''')
        
        # 升级脚本
        _safe_alter("ALTER TABLE projects ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE", "ALTER TABLE projects ADD COLUMN share_token TEXT UNIQUE")
        _safe_alter("ALTER TABLE projects ADD COLUMN IF NOT EXISTS share_enabled INTEGER DEFAULT 0", "ALTER TABLE projects ADD COLUMN share_enabled INTEGER DEFAULT 0")
        _safe_alter("ALTER TABLE projects ADD COLUMN IF NOT EXISTS risk_analysis TEXT", "ALTER TABLE projects ADD COLUMN risk_analysis TEXT")
        _safe_alter("ALTER TABLE projects ADD COLUMN IF NOT EXISTS risk_score DOUBLE PRECISION DEFAULT 0", "ALTER TABLE projects ADD COLUMN risk_score REAL DEFAULT 0")
        
        # 2. 项目阶段表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS project_stages (
                id {PK_AUTO},
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
                bonus_amount {REAL_TYPE} DEFAULT 0,
                scale_quantity INTEGER DEFAULT 0,
                scale_unit TEXT,
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
        ''')
        
        # 升级脚本：添加阶段缩放字段
        _safe_alter("ALTER TABLE project_stages ADD COLUMN IF NOT EXISTS scale_quantity INTEGER DEFAULT 0", "ALTER TABLE project_stages ADD COLUMN scale_quantity INTEGER DEFAULT 0")
        _safe_alter("ALTER TABLE project_stages ADD COLUMN IF NOT EXISTS scale_unit TEXT", "ALTER TABLE project_stages ADD COLUMN scale_unit TEXT")
        
        # 3. 任务表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS tasks (
                id {PK_AUTO},
                stage_id INTEGER,
                task_name TEXT NOT NULL,
                is_completed {BOOL_TYPE} DEFAULT {'FALSE' if db_type == 'postgres' else '0'},
                completed_date DATE,
                remark TEXT,
                updated_at {TIMESTAMP_TYPE},
                FOREIGN KEY (stage_id) REFERENCES project_stages(id)
            )
        ''')
    
        # 3.5. 里程碑表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS milestones (
                id {PK_AUTO},
                project_id INTEGER,
                name TEXT NOT NULL,
                target_date DATE,
                is_completed {BOOL_TYPE} DEFAULT {'FALSE' if db_type == 'postgres' else '0'},
                completed_date DATE,
                is_celebrated {BOOL_TYPE} DEFAULT {'FALSE' if db_type == 'postgres' else '0'},
                remark TEXT,
                FOREIGN KEY (project_id) REFERENCES projects(id),
                UNIQUE(project_id, name)
            )
        ''')
        
        # 4. 接口对接表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS interfaces (
                id {PK_AUTO},
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
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS issues (
                id {PK_AUTO},
                project_id INTEGER,
                issue_type TEXT,
                description TEXT,
                severity TEXT,
                status TEXT DEFAULT '待处理',
                created_at {TIMESTAMP_TYPE},
                resolved_at TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
        ''')
        
        # 6. 消息提醒表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS notifications (
                id {PK_AUTO},
                project_id INTEGER,
                title TEXT NOT NULL,
                content TEXT,
                type TEXT DEFAULT 'info',
                is_read {BOOL_TYPE} DEFAULT {'FALSE' if db_type == 'postgres' else '0'},
                is_sent {BOOL_TYPE} DEFAULT {'FALSE' if db_type == 'postgres' else '0'},
                created_at {TIMESTAMP_TYPE},
                due_date DATE,
                remind_type TEXT DEFAULT 'once',
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
        ''')
    
        # 7. 医疗设备对接表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS medical_devices (
                id {PK_AUTO},
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
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS weekly_reports (
                id {PK_AUTO},
                project_id INTEGER,
                report_type TEXT DEFAULT 'single',
                week_start DATE,
                week_end DATE,
                content TEXT,
                created_at {TIMESTAMP_TYPE},
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
        ''')
    
        # 10. 进度历史记录表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS progress_history (
                id {PK_AUTO},
                project_id INTEGER,
                record_date DATE,
                progress INTEGER,
                tasks_total INTEGER,
                tasks_completed INTEGER,
                created_at {TIMESTAMP_TYPE},
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
        ''')
    
        # 11. 报告缓存表 (Report Cache)
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS report_cache (
                id {PK_AUTO},
                project_id INTEGER,
                report_type TEXT,
                data_hash TEXT,
                content TEXT,
                created_at {TIMESTAMP_TYPE},
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
        ''')
        _safe_alter("CREATE UNIQUE INDEX IF NOT EXISTS uq_report_cache_project_type ON report_cache(project_id, report_type)")
    
        # 11a. AI 风险历史记录表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS project_risk_history (
                id {PK_AUTO},
                project_id INTEGER,
                record_date DATE,
                risk_score {REAL_TYPE},
                sentiment_score {REAL_TYPE},
                trend_direction TEXT,
                key_risk_factors TEXT,
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
        ''')
        
        # 11c. AI 建议与分析缓存
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS ai_report_cache (
                id {PK_AUTO},
                project_id INTEGER,
                report_type TEXT,
                content TEXT,
                created_at {TIMESTAMP_TYPE},
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
        ''')
    
        # 11b. 报告归档表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS report_archive (
                id {PK_AUTO},
                project_id INTEGER,
                report_type TEXT,
                report_date DATE,
                content TEXT,
                generated_by TEXT DEFAULT 'auto',
                created_at {TIMESTAMP_TYPE},
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
        ''')
    
        # 12. 项目成员表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS project_members (
                id {PK_AUTO},
                project_id INTEGER,
                name TEXT NOT NULL,
                role TEXT,
                phone TEXT,
                email TEXT,
                daily_rate {REAL_TYPE} DEFAULT 0,
                join_date DATE,
                leave_date DATE,
                is_onsite {BOOL_TYPE} DEFAULT {'FALSE' if db_type == 'postgres' else '0'},
                status TEXT DEFAULT '在岗',
                current_city TEXT,
                lng {REAL_TYPE},
                lat {REAL_TYPE},
                remark TEXT,
                created_at {TIMESTAMP_TYPE},
                FOREIGN KEY (project_id) REFERENCES projects(id),
                UNIQUE(project_id, name)
            )
        ''')
    
        # 13. 甲方联系人表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS customer_contacts (
                id {PK_AUTO},
                project_id INTEGER,
                name TEXT NOT NULL,
                department TEXT,
                position TEXT,
                phone TEXT,
                email TEXT,
                is_primary {BOOL_TYPE} DEFAULT {'FALSE' if db_type == 'postgres' else '0'},
                remark TEXT,
                created_at {TIMESTAMP_TYPE},
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
        ''')
    
        # 20. 企业微信调试日志表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS wecom_debug_logs (
                id {PK_AUTO},
                msg_type TEXT,
                raw_xml TEXT,
                parsed_json TEXT,
                created_at {TIMESTAMP_TYPE}
            )
        ''')
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS project_departures (
                id {PK_AUTO},
                project_id INTEGER,
                departure_type TEXT,
                departure_date DATE,
                expected_return_date DATE,
                actual_return_date DATE,
                reason TEXT,
                handover_person TEXT,
                our_persons TEXT,
                doc_handover {BOOL_TYPE} DEFAULT {'FALSE' if db_type == 'postgres' else '0'},
                account_handover {BOOL_TYPE} DEFAULT {'FALSE' if db_type == 'postgres' else '0'},
                training_handover {BOOL_TYPE} DEFAULT {'FALSE' if db_type == 'postgres' else '0'},
                issue_handover {BOOL_TYPE} DEFAULT {'FALSE' if db_type == 'postgres' else '0'},
                contact_handover {BOOL_TYPE} DEFAULT {'FALSE' if db_type == 'postgres' else '0'},
                handover_doc_path TEXT,
                pending_issues TEXT,
                remote_support_info TEXT,
                approval_sp_no TEXT,
                status TEXT DEFAULT '待审批',
                approved_by TEXT,
                approved_at TIMESTAMP,
                remark TEXT,
                created_at {TIMESTAMP_TYPE},
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
        ''')
    
        # 14b. 里程碑复盘表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS milestone_retrospectives (
                id {PK_AUTO},
                milestone_id INTEGER,
                project_id INTEGER,
                content TEXT,
                author TEXT,
                created_at {TIMESTAMP_TYPE},
                FOREIGN KEY (milestone_id) REFERENCES milestones(id),
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
        ''')
        
        # 升级 milestones 增加庆祝状态和完成日期
        _safe_alter(f"ALTER TABLE milestones ADD COLUMN IF NOT EXISTS is_celebrated {BOOL_TYPE} DEFAULT FALSE", f"ALTER TABLE milestones ADD COLUMN is_celebrated {BOOL_TYPE} DEFAULT 0")
        _safe_alter("ALTER TABLE milestones ADD COLUMN IF NOT EXISTS completed_date DATE", "ALTER TABLE milestones ADD COLUMN completed_date DATE")
        
        # 后置补全遗漏的完成日期
        _safe_alter(f"UPDATE milestones SET completed_date = target_date WHERE is_completed = {'TRUE' if db_type == 'postgres' else '1'} AND completed_date IS NULL")
    
        # 15. 工作日志表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS work_logs (
                id {PK_AUTO},
                project_id INTEGER,
                member_id INTEGER,
                member_name TEXT,
                log_date DATE,
                work_hours {REAL_TYPE} DEFAULT 8,
                work_type TEXT DEFAULT '现场',
                work_content TEXT,
                issues_encountered TEXT,
                tomorrow_plan TEXT,
                stage_id INTEGER,
                created_at {TIMESTAMP_TYPE},
                FOREIGN KEY (project_id) REFERENCES projects(id),
                FOREIGN KEY (member_id) REFERENCES project_members(id),
                FOREIGN KEY (stage_id) REFERENCES project_stages(id)
            )
        ''')
    
        # 16. 项目文档表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS project_documents (
                id {PK_AUTO},
                project_id INTEGER,
                doc_name TEXT NOT NULL,
                doc_type TEXT,
                doc_category TEXT,
                file_path TEXT,
                file_size INTEGER,
                version TEXT DEFAULT 'v1.0',
                upload_by TEXT,
                upload_at {TIMESTAMP_TYPE},
                remark TEXT,
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
        ''')
    
        # 17. 项目费用表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS project_expenses (
                id {PK_AUTO},
                project_id INTEGER,
                expense_date DATE,
                expense_type TEXT,
                amount {REAL_TYPE},
                description TEXT,
                applicant TEXT,
                receipt_path TEXT,
                approval_sp_no TEXT,
                status TEXT DEFAULT '待报销',
                approved_by TEXT,
                approved_at TIMESTAMP,
                stage_id INTEGER,
                created_at {TIMESTAMP_TYPE},
                FOREIGN KEY (project_id) REFERENCES projects(id),
                FOREIGN KEY (stage_id) REFERENCES project_stages(id)
            )
        ''')
        
        # 17.5 项目收入表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS project_revenue (
                id {PK_AUTO},
                project_id INTEGER,
                amount {REAL_TYPE} NOT NULL,
                revenue_date DATE,
                revenue_type TEXT,
                description TEXT,
                created_at {TIMESTAMP_TYPE},
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
        ''')
    
        # 18. 项目变更记录表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS project_changes (
                id {PK_AUTO},
                project_id INTEGER,
                change_type TEXT,
                change_title TEXT,
                change_desc TEXT,
                impact_analysis TEXT,
                requested_by TEXT,
                requested_date DATE,
                approval_sp_no TEXT,
                approved_by TEXT,
                approved_date DATE,
                status TEXT DEFAULT '待审批',
                created_at {TIMESTAMP_TYPE},
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
        ''')
    
        # 19. 验收记录表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS project_acceptances (
                id {PK_AUTO},
                project_id INTEGER,
                acceptance_type TEXT,
                stage_name TEXT,
                acceptance_date DATE,
                acceptance_items TEXT,
                pass_rate {REAL_TYPE},
                issues_found TEXT,
                customer_sign TEXT,
                our_sign TEXT,
                status TEXT DEFAULT '待验收',
                remark TEXT,
                created_at {TIMESTAMP_TYPE},
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
        ''')
    
        # 20. 客户满意度表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS customer_satisfaction (
                id {PK_AUTO},
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
                created_at {TIMESTAMP_TYPE},
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
        ''')
    
        # 21. 操作日志表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS operation_logs (
                id {PK_AUTO},
                operator TEXT,
                operation_type TEXT,
                entity_type TEXT,
                entity_id INTEGER,
                entity_name TEXT,
                old_value TEXT,
                new_value TEXT,
                ip_address TEXT,
                created_at {TIMESTAMP_TYPE}
            )
        ''')
    
        # 22. 回访记录表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS follow_up_records (
                id {PK_AUTO},
                project_id INTEGER,
                follow_up_date DATE,
                follow_up_type TEXT,
                contact_person TEXT,
                content TEXT,
                issues_found TEXT,
                follow_up_by TEXT,
                next_follow_up_date DATE,
                created_at {TIMESTAMP_TYPE},
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
        ''')
    
        # 23. 知识库表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS knowledge_base (
                id {PK_AUTO},
                category TEXT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                tags TEXT,
                assoc_stage TEXT,
                project_id INTEGER,
                author TEXT,
                embedding BYTEA,
                created_at {TIMESTAMP_TYPE},
                updated_at {TIMESTAMP_TYPE}
            )
        ''')
        
        # 升级 knowledge_base 增加 embedding
        _safe_alter("ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS embedding BYTEA", "ALTER TABLE knowledge_base ADD COLUMN embedding BLOB")

        # 23a. RAG 知识条目表
        if db_type == 'postgres':
            cursor.execute(f'''
                CREATE TABLE IF NOT EXISTS kb_items (
                    id SERIAL PRIMARY KEY,
                    title TEXT NOT NULL,
                    content TEXT,
                    category TEXT DEFAULT 'general',
                    tags TEXT,
                    source_type TEXT,
                    source_id INTEGER,
                    project_id INTEGER,
                    embedding BYTEA,
                    created_at {TIMESTAMP_TYPE},
                    updated_at {TIMESTAMP_TYPE}
                )
            ''')
        else:
            cursor.execute(f'''
                CREATE TABLE IF NOT EXISTS kb_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    content TEXT,
                    category TEXT DEFAULT 'general',
                    tags TEXT,
                    source_type TEXT,
                    source_id INTEGER,
                    project_id INTEGER,
                    embedding BLOB,
                    created_at {TIMESTAMP_TYPE},
                    updated_at {TIMESTAMP_TYPE}
                )
            ''')

        # 24. 硬件资产报表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS hardware_assets (
                id {PK_AUTO},
                asset_name TEXT NOT NULL,
                sn TEXT UNIQUE,
                model TEXT,
                status TEXT DEFAULT '在库',
                current_project_id INTEGER,
                location TEXT,
                operator TEXT,
                responsible_person TEXT,
                purchase_date DATE,
                expire_date DATE,
                remark TEXT,
                created_at {TIMESTAMP_TYPE},
                updated_at {TIMESTAMP_TYPE}
            )
        ''')
    
        # 25. AI 配置表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS ai_configs (
                id {PK_AUTO},
                name TEXT UNIQUE NOT NULL,
                api_key TEXT,
                base_url TEXT,
                models TEXT,
                priority INTEGER DEFAULT 10,
                is_active {BOOL_TYPE} DEFAULT {'TRUE' if db_type == 'postgres' else '1'},
                updated_at {TIMESTAMP_TYPE}
            )
        ''')
    
        # 26. 项目模板表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS project_templates_custom (
                id {PK_AUTO},
                name TEXT NOT NULL,
                description TEXT,
                source_project_id INTEGER,
                template_data TEXT,
                created_by TEXT,
                created_at {TIMESTAMP_TYPE}
            )
        ''')
    
        # 27. 客户沟通记录表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS customer_communications (
                id {PK_AUTO},
                project_id INTEGER NOT NULL,
                contact_date DATE,
                contact_person TEXT,
                contact_method TEXT,
                summary TEXT,
                related_issue_id INTEGER,
                attachments TEXT,
                created_by TEXT,
                created_at {TIMESTAMP_TYPE},
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
        ''')
    
        # 28. 任务依赖关系表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS task_dependencies (
                id {PK_AUTO},
                task_id INTEGER NOT NULL,
                depends_on_task_id INTEGER NOT NULL,
                dependency_type TEXT DEFAULT 'finish_to_start',
                created_at {TIMESTAMP_TYPE},
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                UNIQUE(task_id, depends_on_task_id)
            )
        ''')
    
        # 29. 进度快照表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS progress_snapshots (
                id {PK_AUTO},
                project_id INTEGER NOT NULL,
                snapshot_date DATE NOT NULL,
                overall_progress INTEGER DEFAULT 0,
                snapshot_data TEXT,
                snapshot_type TEXT DEFAULT 'manual',
                created_at {TIMESTAMP_TYPE},
                updated_at {TIMESTAMP_TYPE},
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
        ''')
    
        # 29.5 地图地理编码缓存表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS geo_cache (
                location_name TEXT PRIMARY KEY,
                province TEXT,
                city TEXT,
                lng {REAL_TYPE},
                lat {REAL_TYPE},
                provider TEXT,
                updated_at {TIMESTAMP_TYPE}
            )
        ''')
    
        # 30. 站会纪要表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS standup_minutes (
                id {PK_AUTO},
                project_id INTEGER NOT NULL,
                meeting_date DATE NOT NULL,
                content TEXT,
                ai_generated {BOOL_TYPE} DEFAULT {'FALSE' if db_type == 'postgres' else '0'},
                created_by TEXT,
                created_at {TIMESTAMP_TYPE},
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
        ''')

        # 17.6 月度经营指标表
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS business_monthly_metrics (
                id {PK_AUTO},
                project_id INTEGER NOT NULL,
                metric_month TEXT NOT NULL,
                output_value {REAL_TYPE} DEFAULT 0,
                collected_amount {REAL_TYPE} DEFAULT 0,
                direct_cost {REAL_TYPE} DEFAULT 0,
                labor_cost {REAL_TYPE} DEFAULT 0,
                tax_amount {REAL_TYPE} DEFAULT 0,
                management_cost {REAL_TYPE} DEFAULT 0,
                notes TEXT,
                created_at {TIMESTAMP_TYPE},
                updated_at {TIMESTAMP_TYPE},
                FOREIGN KEY (project_id) REFERENCES projects(id),
                UNIQUE(project_id, metric_month)
            )
        ''')
        _safe_alter("CREATE UNIQUE INDEX IF NOT EXISTS uq_report_archive_project_type_date ON report_archive(project_id, report_type, report_date)")
        _safe_alter("CREATE UNIQUE INDEX IF NOT EXISTS uq_standup_project_date ON standup_minutes(project_id, meeting_date)")

        # 30.5 后台任务中心
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS background_tasks (
                id {PK_AUTO},
                task_id TEXT UNIQUE NOT NULL,
                task_type TEXT NOT NULL,
                title TEXT NOT NULL,
                project_id INTEGER,
                payload_summary TEXT,
                source_endpoint TEXT,
                retried_from_task_id TEXT,
                status TEXT DEFAULT 'processing',
                result TEXT,
                error TEXT,
                created_at {TIMESTAMP_TYPE},
                updated_at {TIMESTAMP_TYPE},
                FOREIGN KEY (project_id) REFERENCES projects(id)
            )
        ''')
        _safe_alter("CREATE INDEX IF NOT EXISTS idx_background_tasks_status ON background_tasks(status)")
        _safe_alter("CREATE INDEX IF NOT EXISTS idx_background_tasks_project_id ON background_tasks(project_id)")
        _safe_alter("CREATE INDEX IF NOT EXISTS idx_background_tasks_created_at ON background_tasks(created_at)")
        _safe_alter("ALTER TABLE background_tasks ADD COLUMN IF NOT EXISTS project_id INTEGER", "ALTER TABLE background_tasks ADD COLUMN project_id INTEGER")
        _safe_alter("ALTER TABLE background_tasks ADD COLUMN IF NOT EXISTS payload_summary TEXT", "ALTER TABLE background_tasks ADD COLUMN payload_summary TEXT")
        _safe_alter("ALTER TABLE background_tasks ADD COLUMN IF NOT EXISTS source_endpoint TEXT", "ALTER TABLE background_tasks ADD COLUMN source_endpoint TEXT")
        _safe_alter("ALTER TABLE background_tasks ADD COLUMN IF NOT EXISTS retried_from_task_id TEXT", "ALTER TABLE background_tasks ADD COLUMN retried_from_task_id TEXT")
    
        # 31. 接口规范库
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS interface_specs (
                id {PK_AUTO},
                project_id INTEGER,
                doc_id INTEGER,
                spec_source TEXT NOT NULL DEFAULT 'vendor',
                category TEXT,
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
                parsed_at {TIMESTAMP_TYPE},
                FOREIGN KEY (project_id) REFERENCES projects(id),
                FOREIGN KEY (doc_id) REFERENCES project_documents(id)
            )
        ''')
        _safe_alter("ALTER TABLE interface_specs ADD COLUMN IF NOT EXISTS category TEXT", "ALTER TABLE interface_specs ADD COLUMN category TEXT")
        _safe_alter("ALTER TABLE interface_specs ADD COLUMN IF NOT EXISTS raw_text TEXT", "ALTER TABLE interface_specs ADD COLUMN raw_text TEXT")
    
        # 32. 接口字段明细
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS interface_spec_fields (
                id {PK_AUTO},
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

        # 33. 对齐中心会话表
        if db_type == 'postgres':
            cursor.execute(f'''
                CREATE TABLE IF NOT EXISTS alignment_sessions (
                    id SERIAL PRIMARY KEY,
                    project_id INTEGER NOT NULL,
                    spec_version TEXT,
                    vendor_file_name TEXT,
                    status TEXT DEFAULT 'pending',
                    summary TEXT,
                    created_at {TIMESTAMP_TYPE},
                    updated_at {TIMESTAMP_TYPE}
                )
            ''')
        else:
            cursor.execute(f'''
                CREATE TABLE IF NOT EXISTS alignment_sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id INTEGER NOT NULL,
                    spec_version TEXT,
                    vendor_file_name TEXT,
                    status TEXT DEFAULT 'pending',
                    summary TEXT,
                    created_at {TIMESTAMP_TYPE},
                    updated_at {TIMESTAMP_TYPE}
                )
            ''')

        # 34. 对齐结果表
        if db_type == 'postgres':
            cursor.execute(f'''
                CREATE TABLE IF NOT EXISTS alignment_results (
                    id SERIAL PRIMARY KEY,
                    session_id INTEGER NOT NULL,
                    our_spec_id INTEGER,
                    vendor_spec_id INTEGER,
                    match_score DOUBLE PRECISION DEFAULT 0,
                    gap_summary TEXT,
                    status TEXT DEFAULT 'pending',
                    confirmed_by TEXT,
                    confirmed_at TIMESTAMP,
                    created_at {TIMESTAMP_TYPE},
                    FOREIGN KEY (session_id) REFERENCES alignment_sessions(id),
                    FOREIGN KEY (our_spec_id) REFERENCES interface_specs(id),
                    FOREIGN KEY (vendor_spec_id) REFERENCES interface_specs(id)
                )
            ''')
        else:
            cursor.execute(f'''
                CREATE TABLE IF NOT EXISTS alignment_results (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id INTEGER NOT NULL,
                    our_spec_id INTEGER,
                    vendor_spec_id INTEGER,
                    match_score REAL DEFAULT 0,
                    gap_summary TEXT,
                    status TEXT DEFAULT 'pending',
                    confirmed_by TEXT,
                    confirmed_at TIMESTAMP,
                    created_at {TIMESTAMP_TYPE},
                    FOREIGN KEY (session_id) REFERENCES alignment_sessions(id),
                    FOREIGN KEY (our_spec_id) REFERENCES interface_specs(id),
                    FOREIGN KEY (vendor_spec_id) REFERENCES interface_specs(id)
                )
            ''')

        # 35. 对齐字段映射表
        if db_type == 'postgres':
            cursor.execute(f'''
                CREATE TABLE IF NOT EXISTS alignment_field_maps (
                    id SERIAL PRIMARY KEY,
                    result_id INTEGER NOT NULL,
                    our_field_name TEXT,
                    vendor_field_name TEXT,
                    match_type TEXT DEFAULT 'auto',
                    confidence DOUBLE PRECISION DEFAULT 0,
                    manual_override BOOLEAN DEFAULT FALSE,
                    notes TEXT,
                    created_at {TIMESTAMP_TYPE},
                    FOREIGN KEY (result_id) REFERENCES alignment_results(id)
                )
            ''')
        else:
            cursor.execute(f'''
                CREATE TABLE IF NOT EXISTS alignment_field_maps (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    result_id INTEGER NOT NULL,
                    our_field_name TEXT,
                    vendor_field_name TEXT,
                    match_type TEXT DEFAULT 'auto',
                    confidence REAL DEFAULT 0,
                    manual_override INTEGER DEFAULT 0,
                    notes TEXT,
                    created_at {TIMESTAMP_TYPE},
                    FOREIGN KEY (result_id) REFERENCES alignment_results(id)
                )
            ''')
    
        # 36. 接口对照结果
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS interface_comparisons (
                id {PK_AUTO},
                project_id INTEGER NOT NULL,
                our_spec_id INTEGER NOT NULL,
                vendor_spec_id INTEGER,
                match_type TEXT DEFAULT 'auto',
                match_confidence {REAL_TYPE} DEFAULT 0,
                comparison_result TEXT,
                summary TEXT,
                gap_count INTEGER DEFAULT 0,
                transform_count INTEGER DEFAULT 0,
                status TEXT DEFAULT 'pending',
                category TEXT,
                reviewed_by TEXT,
                reviewed_at TIMESTAMP,
                created_at {TIMESTAMP_TYPE},
                FOREIGN KEY (project_id) REFERENCES projects(id),
                FOREIGN KEY (our_spec_id) REFERENCES interface_specs(id),
                FOREIGN KEY (vendor_spec_id) REFERENCES interface_specs(id)
            )
        ''')
        _safe_alter("ALTER TABLE interface_comparisons ADD COLUMN IF NOT EXISTS category TEXT", "ALTER TABLE interface_comparisons ADD COLUMN category TEXT")
    
        # 37. 字段级映射关系
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS field_mappings (
                id {PK_AUTO},
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
    
        # Upgrade columns
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
            ('risk_score', f"{REAL_TYPE} DEFAULT 0")
        ]
        
        if DatabasePool.is_postgres():
            cursor.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
            tables = [row[0] for row in cursor.fetchall()]
        else:
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
            tables = [row[0] for row in cursor.fetchall()]

        for table_name in ['project_stages', 'work_logs', 'project_expenses', 'project_changes', 'project_members', 'project_departures', 'hardware_assets', 'knowledge_base', 'projects']:
            if table_name in tables:
                if db_type == 'postgres':
                    cursor.execute(f"SELECT column_name FROM information_schema.columns WHERE table_name = '{table_name}'")
                    cols = [row[0] for row in cursor.fetchall()]
                else:
                    cols = [row[1] for row in cursor.execute(f"PRAGMA table_info({table_name})").fetchall()]
                
                if table_name == 'project_stages':
                    if 'responsible_person' not in cols: _safe_alter("ALTER TABLE project_stages ADD COLUMN IF NOT EXISTS responsible_person TEXT")
                    if 'bonus_amount' not in cols: _safe_alter(f"ALTER TABLE project_stages ADD COLUMN IF NOT EXISTS bonus_amount {REAL_TYPE} DEFAULT 0")
                elif table_name == 'work_logs':
                    if 'stage_id' not in cols: _safe_alter("ALTER TABLE work_logs ADD COLUMN IF NOT EXISTS stage_id INTEGER")
                elif table_name == 'project_expenses':
                    if 'stage_id' not in cols: _safe_alter("ALTER TABLE project_expenses ADD COLUMN IF NOT EXISTS stage_id INTEGER")
                    if 'approval_sp_no' not in cols: _safe_alter("ALTER TABLE project_expenses ADD COLUMN IF NOT EXISTS approval_sp_no TEXT")
                elif table_name == 'project_changes':
                    if 'approval_sp_no' not in cols: _safe_alter("ALTER TABLE project_changes ADD COLUMN IF NOT EXISTS approval_sp_no TEXT")
                elif table_name == 'project_members':
                    if 'daily_rate' not in cols: _safe_alter(f"ALTER TABLE project_members ADD COLUMN IF NOT EXISTS daily_rate {REAL_TYPE} DEFAULT 0")
                    if 'current_city' not in cols: _safe_alter("ALTER TABLE project_members ADD COLUMN IF NOT EXISTS current_city TEXT")
                    if 'lng' not in cols: _safe_alter(f"ALTER TABLE project_members ADD COLUMN IF NOT EXISTS lng {REAL_TYPE}")
                    if 'lat' not in cols: _safe_alter(f"ALTER TABLE project_members ADD COLUMN IF NOT EXISTS lat {REAL_TYPE}")
                elif table_name == 'project_departures':
                    if 'approval_sp_no' not in cols: _safe_alter("ALTER TABLE project_departures ADD COLUMN IF NOT EXISTS approval_sp_no TEXT")
                elif table_name == 'hardware_assets':
                    if 'current_project_id' not in cols: _safe_alter("ALTER TABLE hardware_assets ADD COLUMN IF NOT EXISTS current_project_id INTEGER")
                    if 'operator' not in cols: _safe_alter("ALTER TABLE hardware_assets ADD COLUMN IF NOT EXISTS operator TEXT")
                elif table_name == 'knowledge_base':
                    if 'attachment_path' not in cols: _safe_alter("ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS attachment_path TEXT")
                    if 'external_link' not in cols: _safe_alter("ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS external_link TEXT")
                    if 'assoc_stage' not in cols: _safe_alter("ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS assoc_stage TEXT")
                elif table_name == 'projects':
                    for col_name, col_def in columns_to_add:
                        if col_name not in cols:
                            _safe_alter(
                                f'ALTER TABLE projects ADD COLUMN IF NOT EXISTS {col_name} {col_def}',
                                f'ALTER TABLE projects ADD COLUMN {col_name} {col_def}'
                            )

        migrate_add_form_making_stage(cursor)
        conn.commit()

        # Indexes
        indexes = [
            ("idx_tasks_stage_id", "tasks", "stage_id"),
            ("idx_project_stages_project_id", "project_stages", "project_id"),
            ("idx_milestones_project_id", "milestones", "project_id"),
            ("idx_interfaces_project_id", "interfaces", "project_id"),
            ("idx_issues_project_id", "issues", "project_id"),
            ("idx_medical_devices_project_id", "medical_devices", "project_id"),
            ("idx_notifications_project_id", "notifications", "project_id"),
            ("idx_documents_project_id", "project_documents", "project_id"),
            ("idx_project_members_project_id", "project_members", "project_id"),
            ("idx_worklogs_project_id", "work_logs", "project_id"),
            ("idx_task_deps_task_id", "task_dependencies", "task_id"),
            ("idx_task_deps_depends_on", "task_dependencies", "depends_on_task_id"),
            ("idx_snapshots_project_id", "progress_snapshots", "project_id"),
            ("idx_standup_project_id", "standup_minutes", "project_id"),
            ("idx_business_metrics_project_id", "business_monthly_metrics", "project_id"),
            ("idx_business_metrics_month", "business_monthly_metrics", "metric_month"),
            ("idx_kb_items_project_id", "kb_items", "project_id"),
            ("idx_kb_items_category", "kb_items", "category"),
            ("idx_interface_specs_project", "interface_specs", "project_id"),
            ("idx_interface_specs_source", "interface_specs", "spec_source"),
            ("idx_spec_fields_spec", "interface_spec_fields", "spec_id"),
            ("idx_alignment_sessions_project", "alignment_sessions", "project_id"),
            ("idx_alignment_results_session", "alignment_results", "session_id"),
            ("idx_alignment_field_maps_result", "alignment_field_maps", "result_id"),
            ("idx_comparisons_project", "interface_comparisons", "project_id"),
            ("idx_field_mappings_comp", "field_mappings", "comparison_id"),
        ]
        for idx_name, table_name, column_name in indexes:
            _safe_alter(f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table_name}({column_name})")

        try:
            if db_type == 'postgres':
                cursor.execute("SAVEPOINT sp_seed_users")
            
            user_count_sql = DatabasePool.format_sql('SELECT COUNT(*) as c FROM "users"')
            user_count_row = cursor.execute(user_count_sql).fetchone()
            user_count = user_count_row[0] if isinstance(user_count_row, (list, tuple)) else user_count_row['c']
            if user_count == 0:
                admin_password = hashlib.sha256('admin123'.encode()).hexdigest()
                active_value = True if db_type == 'postgres' else 1
                seed_sql = DatabasePool.format_sql('''
                    INSERT INTO "users" (username, password_hash, display_name, role, is_active)
                    VALUES (?, ?, ?, ?, ?)
                ''')
                cursor.execute(seed_sql, ('admin', admin_password, '系统管理员', 'admin', active_value))
            
            if db_type == 'postgres':
                cursor.execute("RELEASE SAVEPOINT sp_seed_users")
        except Exception:
            if db_type == 'postgres':
                cursor.execute("ROLLBACK TO SAVEPOINT sp_seed_users")
        conn.commit()

def migrate_add_form_making_stage(cursor):
    """为现有项目添加‘表单制作’阶段"""
    projects = cursor.execute(DatabasePool.format_sql('''
        SELECT id FROM projects 
        WHERE id NOT IN (SELECT project_id FROM project_stages WHERE stage_name = '表单制作')
    ''')).fetchall()
    
    for p in projects:
        pid = p[0] if isinstance(p, (list, tuple)) else p['id']
        deployment_stage = cursor.execute(DatabasePool.format_sql('''
            SELECT stage_order, plan_end_date 
            FROM project_stages 
            WHERE project_id = ? AND stage_name = '系统部署'
        '''), (pid,)).fetchone()
        
        if deployment_stage:
            dep_order = deployment_stage[0] if isinstance(deployment_stage, (list, tuple)) else deployment_stage['stage_order']
            dep_end_date = deployment_stage[1] if isinstance(deployment_stage, (list, tuple)) else deployment_stage['plan_end_date']
            order = dep_order + 1
            cursor.execute(DatabasePool.format_sql(
                'UPDATE project_stages SET stage_order = stage_order + 1 WHERE project_id = ? AND stage_order >= ?'
            ), (pid, order))
            insert_sql = '''
                INSERT INTO project_stages (project_id, stage_name, stage_order, plan_start_date, plan_end_date, status)
                VALUES (?, '表单制作', ?, ?, ?, '待开始')
            '''
            if DatabasePool.is_postgres():
                insert_sql += ' RETURNING id'
            cursor.execute(DatabasePool.format_sql(insert_sql), (pid, order, dep_end_date, dep_end_date))
            stage_id = DatabasePool.get_inserted_id(cursor)
            tasks = ['表单设计说明书', '表单配置', '表单测试']
            for t in tasks:
                cursor.execute(DatabasePool.format_sql('INSERT INTO tasks (stage_id, task_name) VALUES (?, ?)'), (stage_id, t))

def migrate_to_dynamic_milestones():
    """将现有项目的静态里程碑迁移为基于阶段的动态里程碑"""
    from services.project_service import ProjectService

    logger.info("检查里程碑迁移状态...")
    project_service = ProjectService()
    with DatabasePool.get_connection() as conn:
        cursor = conn.cursor()
        marker_sql = DatabasePool.format_sql(
            "SELECT value FROM system_config WHERE config_key = 'milestones_migrated' LIMIT 1"
        )
        marker_row = cursor.execute(marker_sql).fetchone()
        marker_value = None
        if marker_row:
            marker_value = marker_row[0] if isinstance(marker_row, (list, tuple)) else marker_row['value']

        if str(marker_value).lower() == 'true':
            return

        projects = cursor.execute(DatabasePool.format_sql('SELECT id FROM projects')).fetchall()
        for p in projects:
            pid = p[0] if isinstance(p, (list, tuple)) else p['id']
            cursor.execute(DatabasePool.format_sql('DELETE FROM milestones WHERE project_id = ?'), (pid,))
            stages = cursor.execute(DatabasePool.format_sql(
                'SELECT stage_name, plan_end_date FROM project_stages WHERE project_id = ? ORDER BY stage_order'
            ), (pid,)).fetchall()
            for s in stages:
                m_name = f"{s[0] if isinstance(s, (list, tuple)) else s['stage_name']}完成"
                cursor.execute(DatabasePool.format_sql(
                    'INSERT INTO milestones (project_id, name, target_date) VALUES (?, ?, ?)'
                ), (pid, m_name, s[1] if isinstance(s, (list, tuple)) else s['plan_end_date']))
            project_service.sync_project_milestones(pid, cursor)

        upsert_sql = '''
            INSERT INTO system_config (config_key, value) VALUES ('milestones_migrated', 'true')
            ON CONFLICT (config_key) DO UPDATE SET value = EXCLUDED.value
        '''
        cursor.execute(DatabasePool.format_sql(upsert_sql))
        conn.commit()
