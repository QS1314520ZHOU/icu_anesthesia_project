from datetime import datetime, timedelta
from database import DatabasePool
from services.monitor_service import monitor_service
from services.ai_service import ai_service
from utils.geo_service import geo_service

class ProjectService:
    @staticmethod
    def _update_project_auto_status(project_id, cursor):
        """根据阶段进度自动计算项目状态和总体进度"""
        # 1. 获取所有阶段
        sql = DatabasePool.format_sql('SELECT id, stage_name, status, actual_start_date FROM project_stages WHERE project_id = ? ORDER BY stage_order')
        stages = cursor.execute(sql, (project_id,)).fetchall()
        if not stages:
            return

        today = datetime.now().strftime('%Y-%m-%d')
        total_tasks_all = 0
        completed_tasks_all = 0
        stage_progress_map = {}

        # 2. 依次更新每个阶段的进度
        for stage in stages:
            sid = stage['id']
            sname = stage['stage_name']
            
            # 获取该阶段的任务统计
            sql = DatabasePool.format_sql('''
                SELECT COUNT(*) as total, 
                       SUM(CASE WHEN is_completed = ? THEN 1 ELSE 0 END) as done 
                FROM tasks WHERE stage_id = ?
            ''')
            counts = cursor.execute(sql, (True, sid)).fetchone()
            
            total = counts['total'] or 0
            done = counts['done'] or 0
            progress = round(done / total * 100) if total > 0 else 0
            
            stage_progress_map[sname] = progress
            total_tasks_all += total
            completed_tasks_all += done

            # 更新阶段表中的进度和自动日期
            actual_start = stage['actual_start_date']
            if done > 0 and not actual_start:
                actual_start = today
            
            actual_end = today if (total > 0 and done == total) else None
            
            sql = DatabasePool.format_sql('''
                UPDATE project_stages 
                SET progress = ?, actual_start_date = ?, actual_end_date = ? 
                WHERE id = ?
            ''')
            cursor.execute(sql, (progress, actual_start, actual_end, sid))

        # 3. 计算项目总体进度
        overall_progress = round(completed_tasks_all / total_tasks_all * 100) if total_tasks_all > 0 else 0
        
        # 4. 逻辑判断项目状态
        new_status = '待启动'
        if completed_tasks_all > 0:
            new_status = '进行中'
            # 记录项目实际开始日期
            sql = DatabasePool.format_sql('UPDATE projects SET actual_start_date = ? WHERE id = ? AND actual_start_date IS NULL')
            cursor.execute(sql, (today, project_id))

        # 特殊阶段状态推断 (按优先级降序)
        if overall_progress == 100:
            new_status = '已完成'
            sql = DatabasePool.format_sql('UPDATE projects SET actual_end_date = ? WHERE id = ? AND actual_end_date IS NULL')
            cursor.execute(sql, (today, project_id))
        elif stage_progress_map.get('验收上线', 0) == 100:
            new_status = '已验收'
            sql = DatabasePool.format_sql('UPDATE projects SET actual_end_date = ? WHERE id = ? AND actual_end_date IS NULL')
            cursor.execute(sql, (today, project_id))
        elif 0 < stage_progress_map.get('验收上线', 0) < 100:
            new_status = '验收中'
        elif 0 < stage_progress_map.get('试运行', 0) < 100:
            new_status = '试运行'

        # 5. 更新项目表
        sql = DatabasePool.format_sql('SELECT status, progress FROM projects WHERE id = ?')
        current = cursor.execute(sql, (project_id,)).fetchone()
        if current:
            # 只有当状态或进度发生变化时才更新，避免触发多余的 updated_at 变更
            if current['status'] != new_status or current['progress'] != overall_progress:
                sql = DatabasePool.format_sql('''
                    UPDATE projects 
                    SET status = ?, progress = ?, updated_at = CURRENT_TIMESTAMP 
                    WHERE id = ?
                ''')
                cursor.execute(sql, (new_status, overall_progress, project_id))
                print(f"[DEBUG] Project {project_id} auto-sync: status({current['status']}->{new_status}), progress({current['progress']}->{overall_progress})")

        # 6. 记录历史趋势 (用于燃尽图)
        sql_del = DatabasePool.format_sql('DELETE FROM progress_history WHERE project_id = ? AND record_date = ?')
        cursor.execute(sql_del, (project_id, today))
        sql_ins = DatabasePool.format_sql('''
            INSERT INTO progress_history (project_id, record_date, progress, tasks_total, tasks_completed) 
            VALUES (?, ?, ?, ?, ?)
        ''')
        cursor.execute(sql_ins, (project_id, today, overall_progress, total_tasks_all, completed_tasks_all))

    @staticmethod
    def sync_project_milestones(project_id, cursor):

        """自动根据阶段完成情况同步里程碑"""
        # 获取项目的所有阶段及其任务完成情况
        sql_st = DatabasePool.format_sql('SELECT id, stage_name FROM project_stages WHERE project_id = ?')
        stages = cursor.execute(sql_st, (project_id,)).fetchall()
        
        for stage in stages:
            stage_id = stage['id']
            stage_name = stage['stage_name']
            
            # 检查该阶段的所有任务是否已完成
            sql_tt = DatabasePool.format_sql('SELECT COUNT(*) as c FROM tasks WHERE stage_id = ?')
            total_tasks_row = cursor.execute(sql_tt, (stage_id,)).fetchone()
            total_tasks = total_tasks_row['c'] if total_tasks_row else 0
            
            sql_ct = DatabasePool.format_sql('SELECT COUNT(*) as c FROM tasks WHERE stage_id = ? AND is_completed = ?')
            completed_tasks_row = cursor.execute(sql_ct, (stage_id, True)).fetchone()
            completed_tasks = completed_tasks_row['c'] if completed_tasks_row else 0
            
            is_stage_done = (total_tasks > 0 and total_tasks == completed_tasks)
            milestone_name = f"{stage_name}完成"
            
            # 查找或创建对应里程碑
            sql_m = DatabasePool.format_sql('SELECT id, is_completed FROM milestones WHERE project_id = ? AND name = ?')
            milestone = cursor.execute(sql_m, (project_id, milestone_name)).fetchone()
            
            current_date = datetime.now().strftime('%Y-%m-%d')
            
            if is_stage_done:
                if not milestone:
                    cursor.execute(DatabasePool.format_sql('''
                        INSERT INTO milestones (project_id, name, is_completed, target_date)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT (project_id, name) DO NOTHING
                    '''), (project_id, milestone_name, True, current_date))
                    milestone = cursor.execute(sql_m, (project_id, milestone_name)).fetchone()
                if milestone and not milestone['is_completed']:
                    # 如果里程碑未完成，则更新为完成并记录完成时间
                    sql = DatabasePool.format_sql('UPDATE milestones SET is_completed = ?, completed_date = ? WHERE id = ?')
                    cursor.execute(sql, (True, current_date, milestone['id']))
                    
                    # 触发企业微信庆祝通报
                    try:
                        from services.wecom_push_service import wecom_push_service
                        wecom_push_service.push_milestone_celebration(project_id, milestone_name)
                    except Exception as e:
                        print(f"Milestone celebration push failed: {e}")
            else:
                if milestone and milestone['is_completed']:
                    # 如果阶段未完成但里程碑已完成（撤销任务时），则更新为未完成
                    sql_up = DatabasePool.format_sql('UPDATE milestones SET is_completed = ? WHERE id = ?')
                    cursor.execute(sql_up, (False, milestone['id'],))

    @staticmethod
    def get_all_projects(user_id=None, is_admin=False):
        with DatabasePool.get_connection() as conn:
            if is_admin:
                rows = conn.execute(DatabasePool.format_sql('SELECT * FROM projects ORDER BY created_at DESC')).fetchall()
            else:
                # Assuming a helper for user projects exists or is integrated
                from services.auth_service import auth_service
                user_project_ids = auth_service.get_user_projects(user_id)
                if not user_project_ids:
                    return []
                placeholders = ','.join(['?' for _ in user_project_ids])
                sql_in = DatabasePool.format_sql(f'SELECT * FROM projects WHERE id IN ({placeholders}) ORDER BY created_at DESC')
                rows = conn.execute(sql_in, user_project_ids).fetchall()
            
            projects = []
            for row in rows:
                p_dict = dict(row)
                # 性能优化：不再在列表循环中执行昂贵的 AI 风险分析
                # 风险分改为从 projects 表中读取缓存值
                # p_dict['risk_score'] = p_dict.get('risk_score', 0) 
                
                # 获取实时逾期里程碑数
                sql_oc = DatabasePool.format_sql('''
                    SELECT COUNT(*) as c FROM milestones 
                    WHERE project_id = ? AND is_completed = ? AND target_date < ?
                ''')
                overdue_count = conn.execute(sql_oc, (p_dict['id'], False, datetime.now().strftime('%Y-%m-%d'))).fetchone()['c']
                p_dict['overdue_count'] = overdue_count
                
                # Compute progress from tasks
                sql_pr = DatabasePool.format_sql('''
                    SELECT COUNT(*) as total, SUM(CASE WHEN t.is_completed = ? THEN 1 ELSE 0 END) as done
                    FROM tasks t JOIN project_stages s ON t.stage_id = s.id
                    WHERE s.project_id = ?
                ''')
                progress_row = conn.execute(sql_pr, (True, p_dict['id'])).fetchone()
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
            project_no = f"PRJ-{datetime.now().strftime('%Y%m%d%H%M%S')}"
            is_postgres = DatabasePool.is_postgres()
            
            insert_sql = '''
                INSERT INTO projects (project_no, project_name, hospital_name, contract_amount, 
                                    project_manager, contact_person, contact_phone,
                                    plan_start_date, plan_end_date, status, priority,
                                    icu_beds, operating_rooms, pacu_beds, province, city, address, contract_no)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            '''
            if is_postgres:
                insert_sql += ' RETURNING id'
            
            sql = DatabasePool.format_sql(insert_sql)
            insert_cursor = conn.execute(sql, (project_no, data['project_name'], data['hospital_name'], 
                  data.get('contract_amount', 0), data.get('project_manager', ''),
                  data.get('contact_person', ''), data.get('contact_phone', ''),
                  data.get('plan_start_date', ''), data.get('plan_end_date', ''),
                  data.get('status', '待启动'), data.get('priority', '普通'),
                  data.get('icu_beds', 0), data.get('operating_rooms', 0), data.get('pacu_beds', 0),
                  data.get('province', ''), data.get('city', ''), data.get('address', ''),
                  data.get('contract_no', '')))
            
            project_id = DatabasePool.get_inserted_id(insert_cursor)
            
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
                
                insert_stage_sql = '''
                    INSERT INTO project_stages (project_id, stage_name, stage_order, plan_start_date, plan_end_date, status)
                    VALUES (?, ?, ?, ?, ?, '待开始')
                '''
                if is_postgres:
                    insert_stage_sql += ' RETURNING id'
                
                sql_st = DatabasePool.format_sql(insert_stage_sql)
                stage_cursor = conn.execute(sql_st, (project_id, stage['name'], stage['order'], stage_start, stage_end))
                
                stage_id = DatabasePool.get_inserted_id(stage_cursor)
                
                for task_name in stage['tasks']:
                    sql_tk = DatabasePool.format_sql('INSERT INTO tasks (stage_id, task_name, is_completed) VALUES (?, ?, ?)')
                    conn.execute(sql_tk, (stage_id, task_name, False))
            
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
            sql_stag = DatabasePool.format_sql('SELECT id FROM project_stages WHERE project_id = ?')
            stages = conn.execute(sql_stag, (project_id,)).fetchall()
            for stage in stages:
                sql_dtk = DatabasePool.format_sql('DELETE FROM tasks WHERE stage_id = ?')
                conn.execute(sql_dtk, (stage['id'],))
            
            for table in tables:
                if table == 'tasks': continue
                condition = 'project_id = ?' if table not in ('projects', 'project_stages') else 'id = ?' if table == 'projects' else 'project_id = ?'
                sql_del = DatabasePool.format_sql(f'DELETE FROM {table} WHERE {condition}')
                conn.execute(sql_del, (project_id,))
            
            conn.commit()
            return True

    @staticmethod
    def get_milestones(project_id):
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('SELECT * FROM milestones WHERE project_id = ? ORDER BY target_date')
            return [dict(m) for m in conn.execute(sql, (project_id,)).fetchall()]

    @staticmethod
    def add_milestone(project_id, data):
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('INSERT INTO milestones (project_id, name, target_date) VALUES (?, ?, ?)')
            conn.execute(sql, (project_id, data['name'], data['target_date']))
            conn.commit()
            return True

    @staticmethod
    def toggle_milestone(mid):
        with DatabasePool.get_connection() as conn:
            sql_sel = DatabasePool.format_sql('SELECT * FROM milestones WHERE id = ?')
            m = conn.execute(sql_sel, (mid,)).fetchone()
            if not m: return False
            new_status = 0 if m['is_completed'] else 1
            completed_date = datetime.now().strftime('%Y-%m-%d') if new_status else None
            sql_upd = DatabasePool.format_sql('UPDATE milestones SET is_completed = ?, completed_date = ? WHERE id = ?')
            conn.execute(sql_upd, (new_status, completed_date, mid))
            conn.commit()
            return True

    @staticmethod
    def delete_milestone(mid):
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('DELETE FROM milestones WHERE id = ?')
            conn.execute(sql, (mid,))
            conn.commit()
            return True

    @staticmethod
    def get_interfaces(project_id):
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('SELECT * FROM interfaces WHERE project_id = ?')
            return [dict(i) for i in conn.execute(sql, (project_id,)).fetchall()]

    @staticmethod
    def add_interface(project_id, data):
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('INSERT INTO interfaces (project_id, system_name, interface_name, status, remark) VALUES (?, ?, ?, ?, ?)')
            conn.execute(sql, (project_id, data['system_name'], data['interface_name'], data.get('status', '待开发'), data.get('remark', '')))
            conn.commit()
            return True

    @staticmethod
    def update_interface(interface_id, data):
        with DatabasePool.get_connection() as conn:
            existing = conn.execute(
                DatabasePool.format_sql('SELECT * FROM interfaces WHERE id = ?'),
                (interface_id,)
            ).fetchone()
            if not existing:
                return False
            existing = dict(existing)
            sql = DatabasePool.format_sql('UPDATE interfaces SET system_name=?, interface_name=?, status=?, remark=? WHERE id=?')
            conn.execute(sql, (
                data.get('system_name', existing.get('system_name')),
                data.get('interface_name', existing.get('interface_name')),
                data.get('status', existing.get('status')),
                data.get('remark', existing.get('remark')),
                interface_id
            ))
            conn.commit()
            return True

    @staticmethod
    def delete_interface(interface_id):
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('DELETE FROM interfaces WHERE id = ?')
            conn.execute(sql, (interface_id,))
            conn.commit()
            return True

    @staticmethod
    def get_issues(project_id):
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('SELECT * FROM issues WHERE project_id = ? ORDER BY created_at DESC')
            return [dict(i) for i in conn.execute(sql, (project_id,)).fetchall()]

    @staticmethod
    def add_issue(project_id, data):
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('INSERT INTO issues (project_id, issue_type, description, severity, status) VALUES (?, ?, ?, ?, ?)')
            conn.execute(sql, (project_id, data['issue_type'], data['description'], data['severity'], data.get('status', '待处理')))
            
            if data.get('severity') == '高':
                sql_p = DatabasePool.format_sql('SELECT project_name FROM projects WHERE id = ?')
                project = conn.execute(sql_p, (project_id,)).fetchone()
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
            # Dynamically build SET clause to only update provided fields
            set_parts = []
            params = []
            
            updatable_fields = ['issue_type', 'description', 'severity', 'status']
            for field in updatable_fields:
                if field in data:
                    set_parts.append(f'{field}=?')
                    params.append(data[field])
            
            # Handle resolved_at timestamp
            if data.get('status') == '已解决':
                set_parts.append('resolved_at=?')
                params.append(datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
            elif 'status' in data and data['status'] != '已解决':
                set_parts.append('resolved_at=?')
                params.append(None)
            
            if not set_parts:
                return True
            
            params.append(issue_id)
            # Wrap dynamic SQL with format_sql
            sql = DatabasePool.format_sql(f'UPDATE issues SET {", ".join(set_parts)} WHERE id=?')
            conn.execute(sql, tuple(params))
            conn.commit()
            return True

    @staticmethod
    def delete_issue(issue_id):
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('DELETE FROM issues WHERE id = ?')
            conn.execute(sql, (issue_id,))
            conn.commit()
            return True

    # --- Tasks & Stages ---
    @staticmethod
    def update_stage(stage_id, data):
        with DatabasePool.get_connection() as conn:
            existing = conn.execute(
                DatabasePool.format_sql('SELECT * FROM project_stages WHERE id = ?'),
                (stage_id,)
            ).fetchone()
            if not existing:
                return False
            existing = dict(existing)
            sql = DatabasePool.format_sql('UPDATE project_stages SET plan_start_date=?, plan_end_date=?, actual_start_date=?, actual_end_date=? WHERE id=?')
            conn.execute(sql, (
                data.get('plan_start_date', existing.get('plan_start_date')),
                data.get('plan_end_date', existing.get('plan_end_date')),
                data.get('actual_start_date', existing.get('actual_start_date')),
                data.get('actual_end_date', existing.get('actual_end_date')),
                stage_id
            ))
            conn.commit()
            return True

    @staticmethod
    def toggle_task(task_id):
        with DatabasePool.get_connection() as conn:
            sql_task = DatabasePool.format_sql('''
                SELECT t.*, s.project_id, s.id as stage_id, s.actual_start_date, s.actual_end_date
                FROM tasks t 
                JOIN project_stages s ON t.stage_id = s.id 
                WHERE t.id = ?
            ''')
            task = conn.execute(sql_task, (task_id,)).fetchone()
            
            if not task: return False
            
            project_id = task['project_id']
            stage_id = task['stage_id']
            new_status = 0 if task['is_completed'] else 1
            today = datetime.now().strftime('%Y-%m-%d')
            completed_date = today if new_status else None
            
            sql_upd = DatabasePool.format_sql('UPDATE tasks SET is_completed = ?, completed_date = ? WHERE id = ?')
            conn.execute(sql_upd, (new_status, completed_date, task_id))
            
            # 更新阶段的实际开始时间
            if new_status and not task['actual_start_date']:
                sql_st_up = DatabasePool.format_sql('UPDATE project_stages SET actual_start_date = ? WHERE id = ?')
                conn.execute(sql_st_up, (today, stage_id))
            
            # 计算阶段进度并更新实际结束时间
            sql_tasks = DatabasePool.format_sql('SELECT is_completed FROM tasks WHERE stage_id = ?')
            tasks = conn.execute(sql_tasks, (stage_id,)).fetchall()
            total = len(tasks)
            completed = sum(1 for t in tasks if t['is_completed'])
            progress = round(completed / total * 100) if total > 0 else 0
            
            actual_end = today if progress == 100 else None
            sql_st_up2 = DatabasePool.format_sql('UPDATE project_stages SET progress = ?, actual_end_date = ? WHERE id = ?')
            conn.execute(sql_st_up2, (progress, actual_end, stage_id))
            # 自动同步里程碑和项目状态
            ProjectService.sync_project_milestones(project_id, conn)
            ProjectService._update_project_auto_status(project_id, conn)
            conn.commit()
        return True

    @staticmethod
    def update_stage_scale(stage_id, quantity):
        """根据设备数量或工作量动态调整阶段计划工期"""
        with DatabasePool.get_connection() as conn:
            sql_st_get = DatabasePool.format_sql('SELECT * FROM project_stages WHERE id = ?')
            stage = conn.execute(sql_st_get, (stage_id,)).fetchone()
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
                start_dt = datetime.strptime(str(stage['plan_start_date'])[:10], '%Y-%m-%d')
                new_end_date = (start_dt + timedelta(days=total_days)).strftime('%Y-%m-%d')
                
                sql_scale = DatabasePool.format_sql('''
                    UPDATE project_stages 
                    SET plan_end_date = ?, scale_quantity = ?, scale_unit = ? 
                    WHERE id = ?
                ''')
                conn.execute(sql_scale, (new_end_date, quantity, '台/个', stage_id))
                
                conn.commit()
                return True
            except Exception as e:
                print(f"Scaling failed: {e}")
                return False



    @staticmethod
    def add_task(stage_id, data):
        with DatabasePool.get_connection() as conn:
            sql_ins_t = DatabasePool.format_sql('INSERT INTO tasks (stage_id, task_name, remark) VALUES (?, ?, ?)')
            conn.execute(sql_ins_t, (stage_id, data['task_name'], data.get('remark', '')))
            
            # 联动更新状态
            stage = conn.execute(DatabasePool.format_sql('SELECT project_id FROM project_stages WHERE id = ?'), (stage_id,)).fetchone()
            if stage:
                ProjectService._update_project_auto_status(stage['project_id'], conn)
            
            conn.commit()
            return True

    @staticmethod
    def delete_task(task_id):
        with DatabasePool.get_connection() as conn:
            sql_tsk = DatabasePool.format_sql('SELECT stage_id FROM tasks WHERE id = ?')
            task = conn.execute(sql_tsk, (task_id,)).fetchone()
            if not task: return False
            
            stage_id = task['stage_id']
            sql_dt = DatabasePool.format_sql('DELETE FROM tasks WHERE id = ?')
            conn.execute(sql_dt, (task_id,))
            
            # 联动更新状态
            sql_stage = DatabasePool.format_sql('SELECT project_id FROM project_stages WHERE id = ?')
            stage = conn.execute(sql_stage, (stage_id,)).fetchone()
            if stage:
                ProjectService._update_project_auto_status(stage['project_id'], conn)
                ProjectService.sync_project_milestones(stage['project_id'], conn)

            conn.commit()
            return True

    # --- Devices ---
    @staticmethod
    def get_devices(project_id):
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('SELECT * FROM medical_devices WHERE project_id = ?')
            devices = conn.execute(sql, (project_id,)).fetchall()
            return [dict(d) for d in devices]

    @staticmethod
    def add_device(project_id, data):
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('''
                INSERT INTO medical_devices (project_id, device_type, brand_model, protocol_type, ip_address, status, remark)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''')
            conn.execute(sql, (project_id, data['device_type'], data['brand_model'], data['protocol_type'], 
                  data.get('ip_address'), data.get('status', '未连接'), data.get('remark')))
            conn.commit()
            return True

    @staticmethod
    def update_device(device_id, data):
        with DatabasePool.get_connection() as conn:
            existing = conn.execute(
                DatabasePool.format_sql('SELECT * FROM medical_devices WHERE id = ?'),
                (device_id,)
            ).fetchone()
            if not existing:
                return False
            existing = dict(existing)
            sql = DatabasePool.format_sql('''
                UPDATE medical_devices SET device_type=?, brand_model=?, protocol_type=?, ip_address=?, status=?, remark=?
                WHERE id=?
            ''')
            conn.execute(sql, (
                data.get('device_type', existing.get('device_type')),
                data.get('brand_model', existing.get('brand_model')),
                data.get('protocol_type', existing.get('protocol_type')),
                data.get('ip_address', existing.get('ip_address')),
                data.get('status', existing.get('status')),
                data.get('remark', existing.get('remark')),
                device_id
            ))
            conn.commit()
            return True

    @staticmethod
    def delete_device(device_id):
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('DELETE FROM medical_devices WHERE id = ?')
            conn.execute(sql, (device_id,))
            conn.commit()
            return True
    @staticmethod
    def get_project_detail(project_id, user_id=None):
        with DatabasePool.get_connection() as conn:
            sql_p = DatabasePool.format_sql('SELECT * FROM projects WHERE id = ?')
            project = conn.execute(sql_p, (project_id,)).fetchone()
            if not project:
                return None
            
            project_dict = dict(project)
            
            # Fetch stages with their tasks
            sql_s = DatabasePool.format_sql('SELECT * FROM project_stages WHERE project_id = ? ORDER BY stage_order')
            stages_rows = conn.execute(sql_s, (project_id,)).fetchall()
            stages = []
            total_tasks = 0
            completed_tasks = 0
            for s_row in stages_rows:
                s_dict = dict(s_row)
                sql_t = DatabasePool.format_sql('SELECT * FROM tasks WHERE stage_id = ? ORDER BY id')
                tasks = conn.execute(sql_t, (s_dict['id'],)).fetchall()
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
            sql_m = DatabasePool.format_sql('SELECT * FROM milestones WHERE project_id = ? ORDER BY target_date')
            milestones = conn.execute(sql_m, (project_id,)).fetchall()
            project_dict['milestones'] = [dict(m) for m in milestones]
            
            # Fetch interfaces
            sql_i = DatabasePool.format_sql('SELECT * FROM interfaces WHERE project_id = ? ORDER BY id')
            interfaces = conn.execute(sql_i, (project_id,)).fetchall()
            project_dict['interfaces'] = [dict(i) for i in interfaces]
            
            # Fetch issues
            sql_iss = DatabasePool.format_sql('SELECT * FROM issues WHERE project_id = ? ORDER BY created_at DESC')
            issues = conn.execute(sql_iss, (project_id,)).fetchall()
            project_dict['issues'] = [dict(i) for i in issues]
            
            # Fetch members
            sql_mem = DatabasePool.format_sql('SELECT * FROM project_members WHERE project_id = ? ORDER BY role, name')
            members = conn.execute(sql_mem, (project_id,)).fetchall()
            project_dict['members'] = [dict(m) for m in members]
            # Fetch contacts - Using separate context to avoid poisoning main transaction
            project_dict['contacts'] = []
            try:
                with DatabasePool.get_connection() as conn_sub:
                    sql_con = DatabasePool.format_sql('SELECT * FROM customer_contacts WHERE project_id = ? ORDER BY is_primary DESC, name')
                    contacts = conn_sub.execute(sql_con, (project_id,)).fetchall()
                    project_dict['contacts'] = [dict(c) for c in contacts]
            except Exception:
                pass

            # Fetch departures - Using separate context to avoid poisoning main transaction
            project_dict['departures'] = []
            try:
                with DatabasePool.get_connection() as conn_sub:
                    sql_dep = DatabasePool.format_sql('SELECT * FROM project_departures WHERE project_id = ? ORDER BY created_at DESC')
                    departures = conn_sub.execute(sql_dep, (project_id,)).fetchall()
                    project_dict['departures'] = [dict(d) for d in departures]
            except Exception:
                pass
            
            # Fetch devices (Fixes "disappearing" devices issue)
            try:
                sql_dev = DatabasePool.format_sql('SELECT * FROM medical_devices WHERE project_id = ?')
                devices = conn.execute(sql_dev, (project_id,)).fetchall()
                project_dict['devices'] = [dict(d) for d in devices]
            except Exception:
                project_dict['devices'] = []

            # Fetch dependencies
            try:
                sql_deps = DatabasePool.format_sql('''
                    SELECT td.id, td.task_id, td.depends_on_task_id, t1.task_name as task_name, t2.task_name as depends_on_task_name
                    FROM task_dependencies td
                    JOIN tasks t1 ON td.task_id = t1.id
                    JOIN tasks t2 ON td.depends_on_task_id = t2.id
                    JOIN project_stages s ON t1.stage_id = s.id
                    WHERE s.project_id = ?
                ''')
                deps = conn.execute(sql_deps, (project_id,)).fetchall()
                project_dict['dependencies'] = [dict(d) for d in deps]
            except Exception:
                project_dict['dependencies'] = []

            # Health score and risk analysis are already in project_dict from 'SELECT *'
            # No longer doing synchronous analysis here for performance
            
            return project_dict

    @staticmethod
    def update_project(project_id, data):
        with DatabasePool.get_connection() as conn:
            existing = conn.execute(
                DatabasePool.format_sql('SELECT * FROM projects WHERE id = ?'),
                (project_id,)
            ).fetchone()
            if not existing:
                return False
            existing = dict(existing)
            sql = DatabasePool.format_sql('''
                UPDATE projects SET 
                    project_name = ?, hospital_name = ?, contract_amount = ?,
                    project_manager = ?, contact_person = ?, contact_phone = ?,
                    plan_start_date = ?, plan_end_date = ?, status = ?, priority = ?,
                    icu_beds = ?, operating_rooms = ?, pacu_beds = ?,
                    province = ?, city = ?, address = ?, contract_no = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            ''')
            conn.execute(sql, (
                data.get('project_name', existing.get('project_name')),
                data.get('hospital_name', existing.get('hospital_name')),
                data.get('contract_amount', existing.get('contract_amount')),
                data.get('project_manager', existing.get('project_manager')),
                data.get('contact_person', existing.get('contact_person')),
                data.get('contact_phone', existing.get('contact_phone')),
                data.get('plan_start_date', existing.get('plan_start_date')),
                data.get('plan_end_date', existing.get('plan_end_date')),
                data.get('status', existing.get('status')),
                data.get('priority', existing.get('priority')),
                data.get('icu_beds', existing.get('icu_beds', 0)),
                data.get('operating_rooms', existing.get('operating_rooms', 0)),
                data.get('pacu_beds', existing.get('pacu_beds', 0)),
                data.get('province', existing.get('province')),
                data.get('city', existing.get('city')),
                data.get('address', existing.get('address')),
                data.get('contract_no', existing.get('contract_no')),
                project_id
            ))
            conn.commit()
            return True
    @staticmethod
    def update_project_status(project_id, new_status):
        with DatabasePool.get_connection() as conn:
            sql_sel = DatabasePool.format_sql('SELECT * FROM projects WHERE id = ?')
            old_project_row = conn.execute(sql_sel, (project_id,)).fetchone()
            if not old_project_row: return False
            old_project = dict(old_project_row)
            
            sql_upd = DatabasePool.format_sql('UPDATE projects SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            conn.execute(sql_upd, (new_status, project_id))
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
            # Get max order and last stage end date
            sql_lst = DatabasePool.format_sql('''
                SELECT stage_order, plan_end_date 
                FROM project_stages 
                WHERE project_id = ? 
                ORDER BY stage_order DESC LIMIT 1
            ''')
            last_stage = conn.execute(sql_lst, (project_id,)).fetchone()
            
            if last_stage:
                max_order = last_stage['stage_order']
                default_start = last_stage['plan_end_date']
            else:
                max_order = 0
                sql_p = DatabasePool.format_sql('SELECT plan_start_date FROM projects WHERE id = ?')
                project = conn.execute(sql_p, (project_id,)).fetchone()
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

            is_postgres = DatabasePool.is_postgres()
            
            insert_st_sql = '''
                INSERT INTO project_stages (project_id, stage_name, stage_order, plan_start_date, plan_end_date, status)
                VALUES (?, ?, ?, ?, ?, '待开始')
            '''
            if is_postgres:
                insert_st_sql += ' RETURNING id'
                
            sql_ins = DatabasePool.format_sql(insert_st_sql)
            stage_cursor = conn.execute(sql_ins, (project_id, data['stage_name'], max_order + 1, start_date, end_date))
            
            stage_id = DatabasePool.get_inserted_id(stage_cursor)
            
            # Use provided tasks, or fall back to defaults for known stage names
            task_list = data.get('tasks', [])
            if not task_list:
                task_list = DEFAULT_STAGE_TASKS.get(data['stage_name'], [])
            
            for task_name in task_list:
                if isinstance(task_name, str) and task_name.strip():
                    sql_tk = DatabasePool.format_sql('INSERT INTO tasks (stage_id, task_name, is_completed) VALUES (?, ?, 0)')
                    conn.execute(sql_tk, (stage_id, task_name.strip()))
            
            # 触发状态更新
            ProjectService._update_project_auto_status(project_id, conn)
            
            conn.commit()
            return stage_id

    @staticmethod
    def get_task_dependencies(project_id):
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('''
                SELECT td.*, t1.task_name as task_name, t2.task_name as depends_on_task_name
                FROM task_dependencies td
                JOIN tasks t1 ON td.task_id = t1.id
                JOIN tasks t2 ON td.depends_on_task_id = t2.id
                JOIN project_stages s ON t1.stage_id = s.id
                WHERE s.project_id = ?
            ''')
            return [dict(d) for d in conn.execute(sql, (project_id,)).fetchall()]

    @staticmethod
    def add_task_dependency(data):
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('INSERT INTO task_dependencies (task_id, depends_on_task_id, dependency_type) VALUES (?, ?, ?)')
            conn.execute(sql, (data['task_id'], data['depends_on_task_id'], data.get('dependency_type', 'finish_to_start')))
            conn.commit()
            return True

    @staticmethod
    def get_geo_stats():
        """获取地理分布统计数据 - 采用动态 API 推断"""
        with DatabasePool.get_connection() as conn:
            # 1. Project stats by province
            sql = DatabasePool.format_sql("SELECT id, province, city, hospital_name, progress, project_name FROM projects WHERE status != '已终止'")
            all_projects = conn.execute(sql).fetchall()
            
            geo_map = {} # province -> {count, progress_sum, projects}
            
            for p in all_projects:
                province = p['province']
                city = p['city']
                
                # 如果省份或城市缺失，尝试动态解析
                if not province or not city:
                    # 组合详细名称以供解析
                    full_name = (p['hospital_name'] or p['project_name'] or "").strip()
                    geo_details = geo_service.resolve_address_details(full_name)
                    
                    if geo_details:
                        province = province or geo_details.get('province')
                        city = city or geo_details.get('city')
                        
                        # 只有在解析成功且原先缺失时才写回数据库，提升后续性能
                        try:
                            sql_up_p = DatabasePool.format_sql('UPDATE projects SET province = ?, city = ? WHERE id = ?')
                            conn.execute(sql_up_p, (province, city, p['id']))
                        except: pass
                
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
            sql_mems = DatabasePool.format_sql('''
                SELECT m.name, m.role, m.lng, m.lat,
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
                        WHERE s.responsible_person = m.name AND t.is_completed = ?) as task_count
                FROM project_members m
                JOIN projects p ON m.project_id = p.id
                WHERE m.status = '在岗'
            ''')
            m_rows = conn.execute(sql_mems, (False,)).fetchall()
            
            for row in m_rows:
                # Calculate load score: projects * 20 + incomplete tasks * 5
                load_score = (row['project_count'] * 20) + (row['task_count'] * 5)
                
                lng, lat = row['lng'], row['lat']
                city = row['current_city']
                
                # On-the-fly resolution if missing
                if (lng is None or lat is None) and city:
                    city = city.strip()
                    coords = geo_service.resolve_coords(city)
                    if coords:
                        lng, lat = coords[0], coords[1]
                        # Optional: Lazy update back to DB for performance
                        try:
                            sql_up_m = DatabasePool.format_sql('UPDATE project_members SET lng = ?, lat = ?, current_city = ? WHERE name = ?')
                            conn.execute(sql_up_m, (lng, lat, city, row['name']))
                        except: pass

                members.append({
                    'name': row['name'],
                    'role': row['role'],
                    'lng': lng,
                    'lat': lat,
                    'current_city': city,
                    'project_name': row['project_name'],
                    'project_count': row['project_count'],
                    'task_count': row['task_count'],
                    'load_score': load_score
                })

            return {'stats': stats, 'members': members}

    @staticmethod
    def get_pending_celebrations(project_id):
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('''
                SELECT id, name, completed_date 
                FROM milestones 
                WHERE project_id = ? AND is_completed = ? AND is_celebrated = ?
            ''')
            return conn.execute(sql, (project_id, True, False)).fetchall()

    @staticmethod
    def mark_milestone_celebrated(mid):
        """
        标记里程碑为已庆祝，防止弹窗重复刷新。
        增加校验确认更新成功。
        """
        try:
            with DatabasePool.get_connection() as conn:
                sql = DatabasePool.format_sql('UPDATE milestones SET is_celebrated = ? WHERE id = ?')
                cursor = conn.execute(sql, (True, mid))
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
                sql = DatabasePool.format_sql('UPDATE milestones SET is_celebrated = ? WHERE project_id = ? AND is_completed = ?')
                conn.execute(sql, (True, project_id, True))
                conn.commit()
                return True
        except Exception as e:
            print(f"[ERROR] Failed to clear celebrations for project {project_id}: {e}")
            return False

    @staticmethod
    def add_milestone_retrospective(mid, data):
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('''
                INSERT INTO milestone_retrospectives (milestone_id, project_id, content, author)
                VALUES (?, ?, ?, ?)
            ''')
            conn.execute(sql, (mid, data.get('project_id'), data.get('content'), data.get('author')))
            conn.commit()


    @staticmethod
    def delete_task_dependency(dep_id):
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('DELETE FROM task_dependencies WHERE id = ?')
            conn.execute(sql, (dep_id,))
            conn.commit()
            return True

project_service = ProjectService()
