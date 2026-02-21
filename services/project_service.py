import sqlite3
from datetime import datetime, timedelta
from database import DatabasePool
from services.monitor_service import monitor_service
from services.ai_service import ai_service

class ProjectService:
    @staticmethod
    def _update_project_auto_status(project_id, cursor):
        """根据阶段进度自动计算项目状态"""
        # 获取所有阶段及其进度
        stages = cursor.execute('SELECT stage_name, status FROM project_stages WHERE project_id = ? ORDER BY stage_order', (project_id,)).fetchall()
        if not stages:
            return

        # 计算各阶段进度
        stage_progress = {}
        for stage in stages:
            s_name = stage['stage_name']
            total = cursor.execute('SELECT COUNT(*) as c FROM tasks t JOIN project_stages ps ON t.stage_id = ps.id WHERE ps.project_id = ? AND ps.stage_name = ?', (project_id, s_name)).fetchone()['c']
            done = cursor.execute('SELECT COUNT(*) as c FROM tasks t JOIN project_stages ps ON t.stage_id = ps.id WHERE ps.project_id = ? AND ps.stage_name = ? AND t.is_completed = 1', (project_id, s_name)).fetchone()['c']
            progress = (done / total * 100) if total > 0 else 0
            stage_progress[s_name] = progress

        # 逻辑判断
        new_status = '待启动'
        has_any_progress = any(p > 0 for p in stage_progress.values())
        
        if has_any_progress:
            new_status = '进行中'
            # 记录实际开始日期
            cursor.execute('UPDATE projects SET actual_start_date = ? WHERE id = ? AND actual_start_date IS NULL', 
                         (datetime.now().strftime('%Y-%m-%d'), project_id))

        # 优先级判断：特定的关键阶段进度
        if stage_progress.get('验收上线', 0) == 100:
            new_status = '已验收'
            cursor.execute('UPDATE projects SET actual_end_date = ? WHERE id = ? AND actual_end_date IS NULL', 
                         (datetime.now().strftime('%Y-%m-%d'), project_id))
        elif 0 < stage_progress.get('验收上线', 0) < 100:
            new_status = '验收中'
        elif 0 < stage_progress.get('试运行', 0) < 100:
            new_status = '试运行'

        # 获取当前数据库中的状态，避免无谓的更新
        current_status = cursor.execute('SELECT status FROM projects WHERE id = ?', (project_id,)).fetchone()
        if current_status and current_status['status'] != new_status:
            print(f"[DEBUG] Project {project_id} status changing: {current_status['status']} -> {new_status}")
            cursor.execute('UPDATE projects SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', 
                         (new_status, project_id))

    @staticmethod
    def sync_project_milestones(project_id, cursor):

        """自动根据阶段完成情况同步里程碑"""
        # 获取项目的所有阶段及其任务完成情况
        stages = cursor.execute('SELECT id, stage_name FROM project_stages WHERE project_id = ?', (project_id,)).fetchall()
        
        for stage in stages:
            stage_id = stage['id']
            stage_name = stage['stage_name']
            
            # 检查该阶段的所有任务是否已完成
            total_tasks_row = cursor.execute('SELECT COUNT(*) as c FROM tasks WHERE stage_id = ?', (stage_id,)).fetchone()
            total_tasks = total_tasks_row['c'] if total_tasks_row else 0
            completed_tasks_row = cursor.execute('SELECT COUNT(*) as c FROM tasks WHERE stage_id = ? AND is_completed = 1', (stage_id,)).fetchone()
            completed_tasks = completed_tasks_row['c'] if completed_tasks_row else 0
            
            is_stage_done = (total_tasks > 0 and total_tasks == completed_tasks)
            milestone_name = f"{stage_name}完成"
            
            # 查找或创建对应里程碑
            milestone = cursor.execute('SELECT id, is_completed FROM milestones WHERE project_id = ? AND name = ?', (project_id, milestone_name)).fetchone()
            
            current_date = datetime.now().strftime('%Y-%m-%d')
            
            if is_stage_done:
                if not milestone:
                    # 如果里程碑不存在则创建（补齐逻辑）
                    cursor.execute('INSERT OR IGNORE INTO milestones (project_id, name, is_completed, target_date) VALUES (?, ?, 1, ?)', 
                                 (project_id, milestone_name, current_date))
                elif not milestone['is_completed']:
                    # 如果里程碑未完成，则更新为完成并记录完成时间
                    cursor.execute('UPDATE milestones SET is_completed = 1, completed_date = ? WHERE id = ?', 
                                 (current_date, milestone['id']))
            else:
                if milestone and milestone['is_completed']:
                    # 如果阶段未完成但里程碑已完成（撤销任务时），则更新为未完成
                    cursor.execute('UPDATE milestones SET is_completed = 0 WHERE id = ?', (milestone['id'],))

    @staticmethod
    def get_all_projects(user_id=None, is_admin=False):
        with DatabasePool.get_connection() as conn:
            if is_admin:
                rows = conn.execute('SELECT * FROM projects ORDER BY created_at DESC').fetchall()
            else:
                # Assuming a helper for user projects exists or is integrated
                from services.auth_service import auth_service
                user_project_ids = auth_service.get_user_projects(user_id)
                if not user_project_ids:
                    return []
                placeholders = ','.join(['?' for _ in user_project_ids])
                rows = conn.execute(f'SELECT * FROM projects WHERE id IN ({placeholders}) ORDER BY created_at DESC', user_project_ids).fetchall()
            
            projects = []
            for row in rows:
                p_dict = dict(row)
                # 性能优化：不再在列表循环中执行昂贵的 AI 风险分析
                # 风险分改为从 projects 表中读取缓存值
                # p_dict['risk_score'] = p_dict.get('risk_score', 0) 
                
                # 获取实时逾期里程碑数
                overdue_count = conn.execute('''
                    SELECT COUNT(*) as c FROM milestones 
                    WHERE project_id = ? AND is_completed = 0 AND target_date < date('now')
                ''', (p_dict['id'],)).fetchone()['c']
                p_dict['overdue_count'] = overdue_count
                
                # Compute progress from tasks
                progress_row = conn.execute('''
                    SELECT COUNT(*) as total, SUM(CASE WHEN t.is_completed = 1 THEN 1 ELSE 0 END) as done
                    FROM tasks t JOIN project_stages s ON t.stage_id = s.id
                    WHERE s.project_id = ?
                ''', (p_dict['id'],)).fetchone()
                total = progress_row['total'] if progress_row['total'] else 0
                done = progress_row['done'] if progress_row['done'] else 0
                p_dict['progress'] = round(done / total * 100) if total > 0 else 0
                
                # 获取风险分析内容 (从数据库)
                p_dict['risk_analysis'] = p_dict.get('risk_analysis', '')
                
                projects.append(p_dict)
            return projects

    @staticmethod
    def create_project(data, creator_id=None):
        with DatabasePool.get_connection() as conn:
            cursor = conn.cursor()
            project_no = f"PRJ-{datetime.now().strftime('%Y%m%d%H%M%S')}"
            
            cursor.execute('''
                INSERT INTO projects (project_no, project_name, hospital_name, contract_amount, 
                                    project_manager, contact_person, contact_phone,
                                    plan_start_date, plan_end_date, status, priority,
                                    icu_beds, operating_rooms, pacu_beds, province, city, address, contract_no)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (project_no, data['project_name'], data['hospital_name'], 
                  data.get('contract_amount', 0), data.get('project_manager', ''),
                  data.get('contact_person', ''), data.get('contact_phone', ''),
                  data.get('plan_start_date', ''), data.get('plan_end_date', ''),
                  data.get('status', '待启动'), data.get('priority', '普通'),
                  data.get('icu_beds', 0), data.get('operating_rooms', 0), data.get('pacu_beds', 0),
                  data.get('province', ''), data.get('city', ''), data.get('address', ''),
                  data.get('contract_no', '')))
            
            project_id = cursor.lastrowid
            
            # Initialize default stages and tasks with durations
            default_stages = [
                {'name': '项目启动', 'order': 1, 'days': 3, 'tasks': ['项目立项', '团队组建', '环境准备']},
                {'name': '需求调研', 'order': 2, 'days': 7, 'tasks': ['需求访谈', '流程梳理', '需求文档评审']},
                {'name': '系统部署', 'order': 3, 'days': 5, 'tasks': ['服务器部署', '数据库配置', '网络调试']},
                {'name': '表单制作', 'order': 4, 'days': 10, 'tasks': ['表单设计说明书', '表单配置', '表单测试']},
                {'name': '接口对接', 'order': 5, 'days': 15, 'tasks': ['接口文档确认', '接口开发', '接口联调']},
                {'name': '设备对接', 'order': 6, 'days': 10, 'tasks': ['设备清单确认', '通信测试', '数据解析']},
                {'name': '系统培训', 'order': 7, 'days': 5, 'tasks': ['管理员培训', '护士培训', '医生培训']},
                {'name': '试运行', 'order': 8, 'days': 14, 'tasks': ['试运行启动', '问题收集', '优化调整']},
                {'name': '验收上线', 'order': 9, 'days': 3, 'tasks': ['验收报告', '资料交接', '正式上线']},
            ]
            
            current_date = datetime.strptime(data.get('plan_start_date', datetime.now().strftime('%Y-%m-%d')), '%Y-%m-%d')
            
            for stage in default_stages:
                stage_start = current_date.strftime('%Y-%m-%d')
                current_date += timedelta(days=stage['days'])
                stage_end = current_date.strftime('%Y-%m-%d')
                
                cursor.execute('''
                    INSERT INTO project_stages (project_id, stage_name, stage_order, plan_start_date, plan_end_date, status)
                    VALUES (?, ?, ?, ?, ?, '待开始')
                ''', (project_id, stage['name'], stage['order'], stage_start, stage_end))
                stage_id = cursor.lastrowid
                
                for task_name in stage['tasks']:
                    cursor.execute('''
                        INSERT INTO tasks (stage_id, task_name, is_completed) VALUES (?, ?, 0)
                    ''', (stage_id, task_name))
            
            conn.commit()
            return project_id

    @staticmethod
    def delete_project(project_id):
        with DatabasePool.get_connection() as conn:
            # Multi-table deletion logic
            tables = [
                'tasks', 'project_stages', 'interfaces', 'issues', 'notifications',
                'medical_devices', 'milestones', 'progress_history', 'ai_report_cache',
                'project_members', 'customer_contacts', 'project_departures', 'work_logs',
                'project_documents', 'project_expenses', 'project_changes',
                'project_acceptances', 'customer_satisfaction', 'follow_up_records', 'projects'
            ]
            
            # Note: tasks table needs special handling due to stage_id FK
            stages = conn.execute('SELECT id FROM project_stages WHERE project_id = ?', (project_id,)).fetchall()
            for stage in stages:
                conn.execute('DELETE FROM tasks WHERE stage_id = ?', (stage['id'],))
            
            for table in tables:
                if table == 'tasks': continue
                conn.execute(f'DELETE FROM {table} WHERE project_id = ?' if table != 'projects' and table != 'project_stages' else f'DELETE FROM {table} WHERE id = ?' if table == 'projects' else f'DELETE FROM {table} WHERE project_id = ?', (project_id,))
            
            conn.commit()
            return True

    @staticmethod
    def get_milestones(project_id):
        with DatabasePool.get_connection() as conn:
            return [dict(m) for m in conn.execute('SELECT * FROM milestones WHERE project_id = ? ORDER BY target_date', (project_id,)).fetchall()]

    @staticmethod
    def add_milestone(project_id, data):
        with DatabasePool.get_connection() as conn:
            conn.execute('INSERT INTO milestones (project_id, name, target_date) VALUES (?, ?, ?)',
                         (project_id, data['name'], data['target_date']))
            conn.commit()
            return True

    @staticmethod
    def toggle_milestone(mid):
        with DatabasePool.get_connection() as conn:
            m = conn.execute('SELECT * FROM milestones WHERE id = ?', (mid,)).fetchone()
            if not m: return False
            new_status = 0 if m['is_completed'] else 1
            completed_date = datetime.now().strftime('%Y-%m-%d') if new_status else None
            conn.execute('UPDATE milestones SET is_completed = ?, completed_date = ? WHERE id = ?', 
                         (new_status, completed_date, mid))
            conn.commit()
            return True

    @staticmethod
    def delete_milestone(mid):
        with DatabasePool.get_connection() as conn:
            conn.execute('DELETE FROM milestones WHERE id = ?', (mid,))
            conn.commit()
            return True

    @staticmethod
    def get_interfaces(project_id):
        with DatabasePool.get_connection() as conn:
            return [dict(i) for i in conn.execute('SELECT * FROM interfaces WHERE project_id = ?', (project_id,)).fetchall()]

    @staticmethod
    def add_interface(project_id, data):
        with DatabasePool.get_connection() as conn:
            conn.execute('INSERT INTO interfaces (project_id, system_name, interface_name, status, remark) VALUES (?, ?, ?, ?, ?)',
                         (project_id, data['system_name'], data['interface_name'], data.get('status', '待开发'), data.get('remark', '')))
            conn.commit()
            return True

    @staticmethod
    def update_interface(interface_id, data):
        with DatabasePool.get_connection() as conn:
            conn.execute('UPDATE interfaces SET system_name=?, interface_name=?, status=?, remark=? WHERE id=?',
                         (data.get('system_name'), data.get('interface_name'), data.get('status'), data.get('remark'), interface_id))
            conn.commit()
            return True

    @staticmethod
    def delete_interface(interface_id):
        with DatabasePool.get_connection() as conn:
            conn.execute('DELETE FROM interfaces WHERE id = ?', (interface_id,))
            conn.commit()
            return True

    @staticmethod
    def get_issues(project_id):
        with DatabasePool.get_connection() as conn:
            return [dict(i) for i in conn.execute('SELECT * FROM issues WHERE project_id = ? ORDER BY created_at DESC', (project_id,)).fetchall()]

    @staticmethod
    def add_issue(project_id, data):
        with DatabasePool.get_connection() as conn:
            conn.execute('INSERT INTO issues (project_id, issue_type, description, severity, status) VALUES (?, ?, ?, ?, ?)',
                         (project_id, data['issue_type'], data['description'], data['severity'], data.get('status', '待处理')))
            
            if data.get('severity') == '高':
                project = conn.execute('SELECT project_name FROM projects WHERE id = ?', (project_id,)).fetchone()
                monitor_service.send_notification_async(
                    f"🚨 新增高危问题",
                    f"项目: {project['project_name']}\n类型: {data['issue_type']}\n描述: {data['description']}",
                    'danger'
                )
            conn.commit()
            return True

    @staticmethod
    def update_issue(issue_id, data):
        with DatabasePool.get_connection() as conn:
            resolved_at = datetime.now().strftime('%Y-%m-%d %H:%M:%S') if data.get('status') == '已解决' else None
            conn.execute('UPDATE issues SET issue_type=?, description=?, severity=?, status=?, resolved_at=? WHERE id=?',
                         (data.get('issue_type'), data.get('description'), data.get('severity'), data.get('status'), resolved_at, issue_id))
            conn.commit()
            return True

    @staticmethod
    def delete_issue(issue_id):
        with DatabasePool.get_connection() as conn:
            conn.execute('DELETE FROM issues WHERE id = ?', (issue_id,))
            conn.commit()
            return True

    # --- Tasks & Stages ---
    @staticmethod
    def update_stage(stage_id, data):
        with DatabasePool.get_connection() as conn:
            conn.execute('UPDATE project_stages SET plan_start_date=?, plan_end_date=?, actual_start_date=?, actual_end_date=? WHERE id=?',
                         (data.get('plan_start_date'), data.get('plan_end_date'), data.get('actual_start_date'), data.get('actual_end_date'), stage_id))
            conn.commit()
            return True

    @staticmethod
    def toggle_task(task_id):
        with DatabasePool.get_connection() as conn:
            cursor = conn.cursor()
            task = cursor.execute('''
                SELECT t.*, s.project_id, s.id as stage_id, s.actual_start_date, s.actual_end_date
                FROM tasks t 
                JOIN project_stages s ON t.stage_id = s.id 
                WHERE t.id = ?
            ''', (task_id,)).fetchone()
            
            if not task: return False
            
            project_id = task['project_id']
            stage_id = task['stage_id']
            new_status = 0 if task['is_completed'] else 1
            today = datetime.now().strftime('%Y-%m-%d')
            completed_date = today if new_status else None
            
            cursor.execute('UPDATE tasks SET is_completed = ?, completed_date = ? WHERE id = ?', (new_status, completed_date, task_id))
            
            # 更新阶段的实际开始时间
            if new_status and not task['actual_start_date']:
                cursor.execute('UPDATE project_stages SET actual_start_date = ? WHERE id = ?', (today, stage_id))
            
            # 计算阶段进度并更新实际结束时间
            tasks = cursor.execute('SELECT is_completed FROM tasks WHERE stage_id = ?', (stage_id,)).fetchall()
            total = len(tasks)
            completed = sum(1 for t in tasks if t['is_completed'])
            progress = round(completed / total * 100) if total > 0 else 0
            
            actual_end = today if progress == 100 else None
            cursor.execute('UPDATE project_stages SET progress = ?, actual_end_date = ? WHERE id = ?', 
                         (progress, actual_end, stage_id))
            
            # 自动同步里程碑和项目状态
            ProjectService.sync_project_milestones(project_id, cursor)
            ProjectService._update_project_auto_status(project_id, cursor)
            
            # 记录进度历史（用于燃尽图实际进度线）
            try:
                all_tasks = cursor.execute('''
                    SELECT COUNT(*) as total, 
                           SUM(CASE WHEN t.is_completed = 1 THEN 1 ELSE 0 END) as completed
                    FROM tasks t JOIN project_stages s ON t.stage_id = s.id 
                    WHERE s.project_id = ?
                ''', (project_id,)).fetchone()
                
                tasks_total = all_tasks['total'] or 0
                tasks_completed = all_tasks['completed'] or 0
                overall_progress = round(tasks_completed / tasks_total * 100) if tasks_total > 0 else 0
                
                # 用 REPLACE 确保每天每项目只有一条记录（取最新状态）
                cursor.execute('''
                    DELETE FROM progress_history 
                    WHERE project_id = ? AND record_date = ?
                ''', (project_id, today))
                cursor.execute('''
                    INSERT INTO progress_history (project_id, record_date, progress, tasks_total, tasks_completed) 
                    VALUES (?, ?, ?, ?, ?)
                ''', (project_id, today, overall_progress, tasks_total, tasks_completed))
            except Exception as e:
                print(f"Warning: Failed to record progress history: {e}")
            
            conn.commit()
            return True

    @staticmethod
    def update_stage_scale(stage_id, quantity):
        """根据设备数量或工作量动态调整阶段计划工期"""
        with DatabasePool.get_connection() as conn:
            cursor = conn.cursor()
            stage = cursor.execute('SELECT * FROM project_stages WHERE id = ?', (stage_id,)).fetchone()
            if not stage: return False
            
            # 预定义各个阶段的缩放倍率 (天/单位)
            SCALING_RULES = {
                '设备对接': 0.1,  # 每台设备0.1天 (100台10天)
                '表单制作': 0.5,  # 每张表单0.5天
                '系统部署': 1.0,  # 每一个节点1天
            }
            
            multiplier = SCALING_RULES.get(stage['stage_name'], 0.1)
            additional_days = int(quantity * multiplier)
            
            # 基础天数 (来自 create_project 的默认值)
            BASE_DAYS = {
                '设备对接': 10,
                '表单制作': 10,
                '接口对接': 15,
            }
            base = BASE_DAYS.get(stage['stage_name'], 7)
            total_days = base + additional_days
            
            # 更新计划结束日期
            try:
                start_dt = datetime.strptime(stage['plan_start_date'], '%Y-%m-%d')
                new_end_date = (start_dt + timedelta(days=total_days)).strftime('%Y-%m-%d')
                
                cursor.execute('''
                    UPDATE project_stages 
                    SET plan_end_date = ?, scale_quantity = ?, scale_unit = ? 
                    WHERE id = ?
                ''', (new_end_date, quantity, '台/个', stage_id))
                
                conn.commit()
                return True
            except Exception as e:
                print(f"Scaling failed: {e}")
                return False



    @staticmethod
    def add_task(stage_id, data):
        with DatabasePool.get_connection() as conn:
            conn.execute('INSERT INTO tasks (stage_id, task_name, remark) VALUES (?, ?, ?)',
                         (stage_id, data['task_name'], data.get('remark', '')))
            conn.commit()
            return True

    @staticmethod
    def delete_task(task_id):
        with DatabasePool.get_connection() as conn:
            conn.execute('DELETE FROM tasks WHERE id = ?', (task_id,))
            conn.commit()
            return True

    # --- Devices ---
    @staticmethod
    def get_devices(project_id):
        with DatabasePool.get_connection() as conn:
            devices = conn.execute('SELECT * FROM medical_devices WHERE project_id = ?', (project_id,)).fetchall()
            return [dict(d) for d in devices]

    @staticmethod
    def add_device(project_id, data):
        with DatabasePool.get_connection() as conn:
            conn.execute('''
                INSERT INTO medical_devices (project_id, device_type, brand_model, protocol_type, ip_address, status, remark)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (project_id, data['device_type'], data['brand_model'], data['protocol_type'], 
                  data.get('ip_address'), data.get('status', '未连接'), data.get('remark')))
            conn.commit()
            return True

    @staticmethod
    def update_device(device_id, data):
        with DatabasePool.get_connection() as conn:
            conn.execute('''
                UPDATE medical_devices SET device_type=?, brand_model=?, protocol_type=?, ip_address=?, status=?, remark=?
                WHERE id=?
            ''', (data.get('device_type'), data.get('brand_model'), data.get('protocol_type'),
                  data.get('ip_address'), data.get('status'), data.get('remark'), device_id))
            conn.commit()
            return True

    @staticmethod
    def delete_device(device_id):
        with DatabasePool.get_connection() as conn:
            conn.execute('DELETE FROM medical_devices WHERE id = ?', (device_id,))
            conn.commit()
            return True
    @staticmethod
    def get_project_detail(project_id, user_id=None):
        with DatabasePool.get_connection() as conn:
            project = conn.execute('SELECT * FROM projects WHERE id = ?', (project_id,)).fetchone()
            if not project:
                return None
            
            project_dict = dict(project)
            
            # Fetch stages with their tasks
            stages_rows = conn.execute('SELECT * FROM project_stages WHERE project_id = ? ORDER BY stage_order', (project_id,)).fetchall()
            stages = []
            total_tasks = 0
            completed_tasks = 0
            for s_row in stages_rows:
                s_dict = dict(s_row)
                tasks = conn.execute('SELECT * FROM tasks WHERE stage_id = ? ORDER BY id', (s_dict['id'],)).fetchall()
                s_dict['tasks'] = [dict(t) for t in tasks]
                # Compute per-stage progress
                stage_total = len(s_dict['tasks'])
                stage_done = sum(1 for t in s_dict['tasks'] if t['is_completed'])
                s_dict['progress'] = round(stage_done / stage_total * 100) if stage_total > 0 else 0
                total_tasks += stage_total
                completed_tasks += stage_done
                stages.append(s_dict)
            project_dict['stages'] = stages
            project_dict['progress'] = round(completed_tasks / total_tasks * 100) if total_tasks > 0 else 0
            
            # Fetch milestones
            milestones = conn.execute('SELECT * FROM milestones WHERE project_id = ? ORDER BY target_date', (project_id,)).fetchall()
            project_dict['milestones'] = [dict(m) for m in milestones]
            
            # Fetch interfaces
            interfaces = conn.execute('SELECT * FROM interfaces WHERE project_id = ? ORDER BY id', (project_id,)).fetchall()
            project_dict['interfaces'] = [dict(i) for i in interfaces]
            
            # Fetch issues
            issues = conn.execute('SELECT * FROM issues WHERE project_id = ? ORDER BY created_at DESC', (project_id,)).fetchall()
            project_dict['issues'] = [dict(i) for i in issues]
            
            # Fetch members
            members = conn.execute('SELECT * FROM project_members WHERE project_id = ? ORDER BY role, name', (project_id,)).fetchall()
            project_dict['members'] = [dict(m) for m in members]

            # Fetch contacts
            try:
                contacts = conn.execute('SELECT * FROM project_contacts WHERE project_id = ? ORDER BY is_primary DESC, name', (project_id,)).fetchall()
                project_dict['contacts'] = [dict(c) for c in contacts]
            except:
                project_dict['contacts'] = []

            # Fetch departures
            departures = conn.execute('SELECT * FROM project_departures WHERE project_id = ? ORDER BY created_at DESC', (project_id,)).fetchall()
            project_dict['departures'] = [dict(d) for d in departures]
            
            # Fetch devices (Fixes "disappearing" devices issue)
            devices = conn.execute('SELECT * FROM medical_devices WHERE project_id = ?', (project_id,)).fetchall()
            project_dict['devices'] = [dict(d) for d in devices]

            # Fetch dependencies
            deps = conn.execute('''
                SELECT td.id, td.task_id, td.depends_on_task_id, t1.task_name as task_name, t2.task_name as depends_on_task_name
                FROM task_dependencies td
                JOIN tasks t1 ON td.task_id = t1.id
                JOIN tasks t2 ON td.depends_on_task_id = t2.id
                JOIN project_stages s ON t1.stage_id = s.id
                WHERE s.project_id = ?
            ''', (project_id,)).fetchall()
            project_dict['dependencies'] = [dict(d) for d in deps]

            # Health score and risk analysis are already in project_dict from 'SELECT *'
            # No longer doing synchronous analysis here for performance
            
            return project_dict

    @staticmethod
    def update_project(project_id, data):
        with DatabasePool.get_connection() as conn:
            conn.execute('''
                UPDATE projects SET 
                    project_name = ?, hospital_name = ?, contract_amount = ?,
                    project_manager = ?, contact_person = ?, contact_phone = ?,
                    plan_start_date = ?, plan_end_date = ?, status = ?, priority = ?,
                    icu_beds = ?, operating_rooms = ?, pacu_beds = ?,
                    province = ?, city = ?, address = ?, contract_no = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            ''', (data.get('project_name'), data.get('hospital_name'), data.get('contract_amount'),
                  data.get('project_manager'), data.get('contact_person'), data.get('contact_phone'),
                  data.get('plan_start_date'), data.get('plan_end_date'), data.get('status'), 
                  data.get('priority'), data.get('icu_beds', 0), data.get('operating_rooms', 0),
                  data.get('pacu_beds', 0), data.get('province'), data.get('city'), 
                  data.get('address'), data.get('contract_no'), project_id))
    @staticmethod
    def update_project_status(project_id, new_status):
        with DatabasePool.get_connection() as conn:
            old_project = dict(conn.execute('SELECT * FROM projects WHERE id = ?', (project_id,)).fetchone())
            if not old_project: return False
            
            conn.execute('UPDATE projects SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', 
                         (new_status, project_id))
            conn.commit()
            return True

    @staticmethod
    def add_stage(project_id, data):
        # Default tasks for known stage names
        DEFAULT_STAGE_TASKS = {
            '项目启动': ['需求确认', '合同签署', '项目组建立', '启动会议'],
            '需求调研': ['现场调研', '需求文档编写', '需求评审确认'],
            '系统部署': ['服务器部署', '网络配置', '系统安装', '基础配置'],
            '表单制作': ['医嘱表单', '护理表单', '评估表单', '病历模板'],
            '接口对接': ['HIS接口', 'LIS接口', 'PACS接口', '医保接口'],
            '设备对接': ['监护仪对接', '呼吸机对接', '输液泵对接', '其他设备'],
            '数据采集': ['监护仪采集', '呼吸机采集', '输液泵采集', '其他设备采集'],
            '系统培训': ['管理员培训', '医生培训', '护士培训', '操作手册编写'],
            '试运行': ['试运行启动', '问题跟踪', '用户反馈收集', '系统优化'],
            '验收上线': ['验收文档准备', '甲方验收', '正式上线', '项目总结'],
        }
        
        with DatabasePool.get_connection() as conn:
            cursor = conn.cursor()
            
            # Get max order and last stage end date
            last_stage = conn.execute('''
                SELECT stage_order, plan_end_date 
                FROM project_stages 
                WHERE project_id = ? 
                ORDER BY stage_order DESC LIMIT 1
            ''', (project_id,)).fetchone()
            
            if last_stage:
                max_order = last_stage['stage_order']
                default_start = last_stage['plan_end_date']
            else:
                max_order = 0
                project = conn.execute('SELECT plan_start_date FROM projects WHERE id = ?', (project_id,)).fetchone()
                default_start = project['plan_start_date'] if project else datetime.now().strftime('%Y-%m-%d')
            
            # Calculate default dates
            start_date = data.get('plan_start_date') or default_start
            if not start_date: start_date = datetime.now().strftime('%Y-%m-%d')
            
            end_date = data.get('plan_end_date')
            if not end_date:
                try:
                    start_dt = datetime.strptime(start_date, '%Y-%m-%d')
                    end_date = (start_dt + timedelta(days=14)).strftime('%Y-%m-%d') # Default 14 days
                except:
                    end_date = ''

            cursor.execute('''
                INSERT INTO project_stages (project_id, stage_name, stage_order, plan_start_date, plan_end_date, status)
                VALUES (?, ?, ?, ?, ?, '待开始')
            ''', (project_id, data['stage_name'], max_order + 1, start_date, end_date))
            
            stage_id = cursor.lastrowid
            
            # Use provided tasks, or fall back to defaults for known stage names
            task_list = data.get('tasks', [])
            if not task_list:
                task_list = DEFAULT_STAGE_TASKS.get(data['stage_name'], [])
            
            for task_name in task_list:
                if isinstance(task_name, str) and task_name.strip():
                    cursor.execute(
                        'INSERT INTO tasks (stage_id, task_name, is_completed) VALUES (?, ?, 0)',
                        (stage_id, task_name.strip()))
            
            # 触发状态更新
            ProjectService._update_project_auto_status(project_id, cursor)
            
            conn.commit()
            return stage_id

    @staticmethod
    def get_task_dependencies(project_id):
        with DatabasePool.get_connection() as conn:
            return [dict(d) for d in conn.execute('''
                SELECT td.*, t1.task_name as task_name, t2.task_name as depends_on_task_name
                FROM task_dependencies td
                JOIN tasks t1 ON td.task_id = t1.id
                JOIN tasks t2 ON td.depends_on_task_id = t2.id
                JOIN project_stages s ON t1.stage_id = s.id
                WHERE s.project_id = ?
            ''', (project_id,)).fetchall()]

    @staticmethod
    def add_task_dependency(data):
        with DatabasePool.get_connection() as conn:
            conn.execute('INSERT INTO task_dependencies (task_id, depends_on_task_id, dependency_type) VALUES (?, ?, ?)',
                         (data['task_id'], data['depends_on_task_id'], data.get('dependency_type', 'finish_to_start')))
            conn.commit()
            return True

    @staticmethod
    def get_geo_stats():
        """获取地理分布统计数据"""
        with DatabasePool.get_connection() as conn:
            # 1. Project stats by province
            # 增加对空省份的简单推断逻辑
            all_projects = conn.execute('SELECT province, city, hospital_name, progress, project_name FROM projects WHERE status != "已终止"').fetchall()
            
            geo_map = {} # province -> {count, progress_sum, projects}
            
            province_map = {
                '云南': ['红河', '昆明', '玉溪', '大理', '丽江', '昭通', '文山', '西双版纳'],
                '四川': ['眉山', '成都', '德阳', '绵阳', '宜宾', '乐山', '南充'],
                '湖北': ['随州', '武汉', '宜昌', '襄阳', '孝感', '荆州', '黄冈'],
                '广东': ['广州', '深圳', '东莞', '佛山', '中山', '珠海', '江门'],
                '湖南': ['长沙', '株洲', '湘潭', '衡阳', '岳阳']
            }

            for p in all_projects:
                province = p['province']
                # 尝试从 hospital_name 或 city 推断省份
                if not province or province == '':
                    name_full = (p['hospital_name'] or '') + (p['city'] or '')
                    for prov_name, cities in province_map.items():
                        if prov_name in name_full or any(c in name_full for c in cities):
                            province = prov_name
                            break
                
                if not province: province = '未知'
                
                if province not in geo_map:
                    geo_map[province] = {'count': 0, 'progress_sum': 0, 'projects': []}
                
                geo_map[province]['count'] += 1
                geo_map[province]['progress_sum'] += (p['progress'] or 0)
                geo_map[province]['projects'].append(p['project_name'])

            stats = []
            for prov, gs in geo_map.items():
                if prov == '未知': continue
                stats.append({
                    'name': prov,
                    'count': gs['count'],
                    'avg_progress': round(gs['progress_sum'] / gs['count'], 1),
                    'projects': gs['projects']
                })

            # 2. Member locations with workload assessment
            members = []
            m_rows = conn.execute('''
                SELECT m.name, m.role, 
                       CASE 
                           WHEN m.current_city IS NOT NULL AND m.current_city != '' THEN m.current_city 
                           WHEN p.city IS NOT NULL AND p.city != '' THEN p.city 
                           ELSE p.hospital_name 
                       END as current_city,
                       p.project_name,
                       (SELECT COUNT(DISTINCT project_id) FROM project_members 
                        WHERE name = m.name AND status = '在岗') as project_count,
                       (SELECT COUNT(*) FROM tasks t 
                        JOIN project_stages s ON t.stage_id = s.id 
                        WHERE s.responsible_person = m.name AND t.is_completed = 0) as task_count
                FROM project_members m
                JOIN projects p ON m.project_id = p.id
                WHERE m.status = '在岗'
            ''').fetchall()
            
            for row in m_rows:
                # Calculate load score: projects * 20 + incomplete tasks * 5
                load_score = (row['project_count'] * 20) + (row['task_count'] * 5)
                members.append({
                    'name': row['name'],
                    'role': row['role'],
                    'current_city': row['current_city'],
                    'project_name': row['project_name'],
                    'project_count': row['project_count'],
                    'task_count': row['task_count'],
                    'load_score': load_score
                })

            return {'stats': stats, 'members': members}

    @staticmethod
    def get_pending_celebrations(project_id):
        with DatabasePool.get_connection() as conn:
            return conn.execute('''
                SELECT id, name, completed_date 
                FROM milestones 
                WHERE project_id = ? AND is_completed = 1 AND is_celebrated = 0
            ''', (project_id,)).fetchall()

    @staticmethod
    def mark_milestone_celebrated(mid):
        """
        标记里程碑为已庆祝，防止弹窗重复刷新。
        增加校验确认更新成功。
        """
        try:
            with DatabasePool.get_connection() as conn:
                cursor = conn.execute('UPDATE milestones SET is_celebrated = 1 WHERE id = ?', (mid,))
                conn.commit()
                print(f"[DEBUG] Milestone {mid} marked as celebrated. Rowcount: {cursor.rowcount}")
                return True
        except Exception as e:
            print(f"[ERROR] Failed to mark milestone {mid} as celebrated: {e}")
            return False

    @staticmethod
    def clear_pending_celebrations(project_id):
        """清除项目下的所有待庆祝里程碑"""
        try:
            with DatabasePool.get_connection() as conn:
                conn.execute('UPDATE milestones SET is_celebrated = 1 WHERE project_id = ? AND is_completed = 1', (project_id,))
                conn.commit()
                return True
        except Exception as e:
            print(f"[ERROR] Failed to clear celebrations for project {project_id}: {e}")
            return False

    @staticmethod
    def add_milestone_retrospective(mid, data):
        with DatabasePool.get_connection() as conn:
            conn.execute('''
                INSERT INTO milestone_retrospectives (milestone_id, project_id, content, author)
                VALUES (?, ?, ?, ?)
            ''', (mid, data.get('project_id'), data.get('content'), data.get('author')))


    @staticmethod
    def delete_task_dependency(dep_id):
        with DatabasePool.get_connection() as conn:
            conn.execute('DELETE FROM task_dependencies WHERE id = ?', (dep_id,))
            conn.commit()
            return True

project_service = ProjectService()
