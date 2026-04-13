from datetime import datetime, timedelta
from database import DatabasePool

class MemberService:
    @staticmethod
    def get_people_project_board(current_user=None, silent_days=3):
        """人-项目一体化看板：以人员为中心聚合项目状态、预警、日志活跃度。"""
        from services.auth_service import auth_service
        from services.warning_service import warning_service

        user_id = (current_user or {}).get('id')
        role = (current_user or {}).get('role')
        is_admin = role == 'admin'

        allowed_project_ids = None
        if not is_admin and user_id:
            ids = auth_service.get_user_projects(user_id)
            allowed_project_ids = set(ids or [])

        with DatabasePool.get_connection() as conn:
            base_sql = '''
                SELECT
                    pm.id as member_id,
                    pm.name as member_name,
                    pm.role as member_role,
                    pm.current_city,
                    pm.join_date,
                    pm.leave_date,
                    pm.is_onsite,
                    pm.status as member_status,
                    p.id as project_id,
                    p.project_name,
                    p.status as project_status,
                    p.plan_end_date,
                    p.progress
                FROM project_members pm
                JOIN projects p ON p.id = pm.project_id
                WHERE pm.status = '在岗'
            '''
            params = []
            if allowed_project_ids is not None:
                if not allowed_project_ids:
                    return []
                placeholders = ','.join(['?' for _ in allowed_project_ids])
                base_sql += f' AND p.id IN ({placeholders})'
                params.extend(list(allowed_project_ids))
            base_sql += ' ORDER BY pm.name ASC, p.updated_at DESC'
            rows = conn.execute(DatabasePool.format_sql(base_sql), params).fetchall()

            # 预加载日志最后更新时间（按成员名）
            last_logs = conn.execute(DatabasePool.format_sql('''
                SELECT member_name, MAX(log_date) as last_log_date
                FROM work_logs
                GROUP BY member_name
            ''')).fetchall()
            last_log_map = {row['member_name']: row['last_log_date'] for row in last_logs}

            # 预加载任务数（assigned_to）
            task_rows = conn.execute(DatabasePool.format_sql('''
                SELECT assigned_to, COUNT(*) as todo_count
                FROM tasks
                WHERE is_completed = ?
                GROUP BY assigned_to
            '''), (False,)).fetchall()
            task_map = {str(row['assigned_to'] or '').strip(): int(row['todo_count'] or 0) for row in task_rows}

        warning_data = warning_service.get_warning_summary()
        warning_count_by_project = {}
        for w in warning_data.get('warnings', []):
            pid = w.get('project_id')
            if not pid:
                continue
            warning_count_by_project[pid] = warning_count_by_project.get(pid, 0) + 1

        today = datetime.now().date()
        people_map = {}
        for row in rows:
            r = dict(row)
            name = r.get('member_name') or '未知'
            item = people_map.get(name)
            if not item:
                last_log_raw = last_log_map.get(name)
                silent_value = None
                if last_log_raw:
                    try:
                        log_day = datetime.strptime(str(last_log_raw)[:10], '%Y-%m-%d').date()
                        silent_value = (today - log_day).days
                    except Exception:
                        silent_value = None

                join_raw = r.get('join_date')
                onsite_days = 0
                try:
                    if join_raw and r.get('is_onsite'):
                        onsite_days = max((today - datetime.strptime(str(join_raw)[:10], '%Y-%m-%d').date()).days, 0)
                except Exception:
                    onsite_days = 0

                item = {
                    'member_name': name,
                    'member_role': r.get('member_role'),
                    'current_city': r.get('current_city') or '',
                    'member_status': r.get('member_status') or '在岗',
                    'last_log_date': str(last_log_raw)[:10] if last_log_raw else None,
                    'silent_days': silent_value,
                    'is_silent': bool(silent_value is not None and silent_value >= int(silent_days or 3)),
                    'onsite_days': onsite_days,
                    'todo_tasks': task_map.get(name, 0),
                    'projects': [],
                    'warning_count': 0,
                    'estimated_release_date': None,
                }
                people_map[name] = item

            pid = r.get('project_id')
            p_warning = int(warning_count_by_project.get(pid, 0))
            item['warning_count'] += p_warning
            item['projects'].append({
                'project_id': pid,
                'project_name': r.get('project_name'),
                'project_status': r.get('project_status'),
                'progress': r.get('progress') or 0,
                'plan_end_date': r.get('plan_end_date'),
                'warning_count': p_warning
            })
            plan_end = r.get('plan_end_date')
            if plan_end:
                curr = item.get('estimated_release_date')
                if not curr or str(plan_end) > str(curr):
                    item['estimated_release_date'] = plan_end

        board = list(people_map.values())
        board.sort(key=lambda x: (not x.get('is_silent', False), -(x.get('warning_count') or 0), x.get('member_name') or ''))
        return board

    @staticmethod
    def get_my_dashboard(user):
        user_id = user.get('id')
        username = (user.get('username') or '').strip()
        display_name = (user.get('display_name') or '').strip()

        from services.auth_service import auth_service
        from services.warning_service import warning_service

        project_ids = auth_service.get_user_projects(user_id)
        if project_ids is None:
            # admin 走“我负责/我参与”的轻视图，避免全局噪音
            with DatabasePool.get_connection() as conn:
                managed = conn.execute(
                    DatabasePool.format_sql('SELECT id FROM projects WHERE project_manager = ?'),
                    (display_name or username,)
                ).fetchall()
                project_ids = [row['id'] for row in managed]

        project_ids = list(set(project_ids or []))
        if not project_ids:
            return {
                'projects': [],
                'todo_tasks': [],
                'unread_notifications': [],
                'weekly_log_summary': {'count': 0, 'hours': 0},
                'warnings': []
            }

        placeholders = ','.join(['?' for _ in project_ids])
        with DatabasePool.get_connection() as conn:
            projects = conn.execute(
                DatabasePool.format_sql(f'''
                    SELECT id, project_name, hospital_name, status, progress, project_manager, updated_at
                    FROM projects
                    WHERE id IN ({placeholders})
                    ORDER BY updated_at DESC
                    LIMIT 20
                '''),
                project_ids
            ).fetchall()

            # 待办：按 assigned_to 命中本人，或者阶段负责人是本人
            todo_tasks = conn.execute(
                DatabasePool.format_sql(f'''
                    SELECT
                        t.id, t.task_name, t.assigned_to, t.updated_at, t.estimated_duration,
                        s.stage_name, s.project_id, p.project_name
                    FROM tasks t
                    JOIN project_stages s ON s.id = t.stage_id
                    JOIN projects p ON p.id = s.project_id
                    WHERE s.project_id IN ({placeholders})
                      AND t.is_completed = ?
                      AND (
                            t.assigned_to = ?
                            OR t.assigned_to = ?
                            OR s.responsible_person = ?
                            OR s.responsible_person = ?
                      )
                    ORDER BY t.updated_at DESC
                    LIMIT 50
                '''),
                (*project_ids, False, display_name, username, display_name, username)
            ).fetchall()

            unread_notifications = conn.execute(
                DatabasePool.format_sql(f'''
                    SELECT n.id, n.project_id, n.title, n.content, n.type, n.created_at, p.project_name
                    FROM notifications n
                    LEFT JOIN projects p ON p.id = n.project_id
                    WHERE n.project_id IN ({placeholders})
                      AND n.is_read = ?
                      AND (n.target_user_id IS NULL OR n.target_user_id = ?)
                    ORDER BY n.created_at DESC
                    LIMIT 30
                '''),
                (*project_ids, False, user_id)
            ).fetchall()

            week_ago = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
            log_summary = conn.execute(
                DatabasePool.format_sql(f'''
                    SELECT COUNT(*) as count, COALESCE(SUM(work_hours), 0) as hours
                    FROM work_logs
                    WHERE project_id IN ({placeholders})
                      AND log_date >= ?
                      AND (member_name = ? OR member_name = ?)
                '''),
                (*project_ids, week_ago, display_name, username)
            ).fetchone()

        warning_data = warning_service.get_warning_summary()
        warnings = [
            w for w in warning_data.get('warnings', [])
            if w.get('project_id') in set(project_ids)
        ][:30]

        return {
            'projects': [dict(row) for row in projects],
            'todo_tasks': [dict(row) for row in todo_tasks],
            'unread_notifications': [dict(row) for row in unread_notifications],
            'weekly_log_summary': {
                'count': int((log_summary or {}).get('count') or 0),
                'hours': float((log_summary or {}).get('hours') or 0),
            },
            'warnings': warnings
        }

    @staticmethod
    def get_project_members(project_id):
        with DatabasePool.get_connection() as conn:
            members = conn.execute(DatabasePool.format_sql('SELECT * FROM project_members WHERE project_id = ? ORDER BY role, name'), (project_id,)).fetchall()
            return [dict(m) for m in members]

    @staticmethod
    def get_member_directory(keyword: str = '', limit: int = 8):
        with DatabasePool.get_connection() as conn:
            rows = conn.execute(DatabasePool.format_sql('''
                SELECT id, name, role, phone, email, join_date, current_city, is_onsite, created_at
                FROM project_members
                WHERE status = '在岗'
                ORDER BY created_at DESC, id DESC
            ''')).fetchall()

        keyword = str(keyword or '').strip().lower()
        deduped = []
        seen = set()
        for row in rows:
            item = dict(row)
            name = str(item.get('name') or '').strip()
            if not name or name in seen:
                continue
            haystack = ' '.join([
                name,
                str(item.get('role') or ''),
                str(item.get('phone') or ''),
                str(item.get('email') or ''),
                str(item.get('current_city') or '')
            ]).lower()
            if keyword and keyword not in haystack:
                continue
            seen.add(name)
            deduped.append({
                'name': name,
                'role': item.get('role') or '',
                'phone': item.get('phone') or '',
                'email': item.get('email') or '',
                'join_date': str(item.get('join_date') or '')[:10] if item.get('join_date') else '',
                'current_city': item.get('current_city') or '',
                'is_onsite': bool(item.get('is_onsite')),
            })
            if len(deduped) >= max(1, min(int(limit or 8), 20)):
                break
        return deduped

    @staticmethod
    def add_project_member(project_id, data):
        with DatabasePool.get_connection() as conn:
            onsite_value = bool(data.get('is_onsite')) if DatabasePool.is_postgres() else (1 if data.get('is_onsite') else 0)
            conn.execute(DatabasePool.format_sql('''
                INSERT INTO project_members (project_id, name, role, phone, email, daily_rate, join_date, current_city, is_onsite, remark)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            '''), (project_id, data['name'], data.get('role', '实施工程师'), data.get('phone'),
                  data.get('email'), data.get('daily_rate', 0),
                  data.get('join_date', datetime.now().strftime('%Y-%m-%d')),
                  data.get('current_city'), onsite_value, data.get('remark')))
            conn.commit()
            return True

    @staticmethod
    def update_project_member(member_id, data):
        with DatabasePool.get_connection() as conn:
            existing = conn.execute(
                DatabasePool.format_sql('SELECT * FROM project_members WHERE id = ?'),
                (member_id,)
            ).fetchone()
            if not existing:
                return False
            existing = dict(existing)
            onsite_value = data.get('is_onsite', existing.get('is_onsite'))
            if DatabasePool.is_postgres():
                onsite_value = bool(onsite_value)
            else:
                onsite_value = 1 if onsite_value else 0
            conn.execute(DatabasePool.format_sql('''
                UPDATE project_members SET name=?, role=?, phone=?, email=?, daily_rate=?,
                join_date=?, leave_date=?, current_city=?, is_onsite=?, 
                status=?, remark=? WHERE id=?
            '''), (
                data.get('name', existing.get('name')),
                data.get('role', existing.get('role')),
                data.get('phone', existing.get('phone')),
                data.get('email', existing.get('email')),
                data.get('daily_rate', existing.get('daily_rate', 0)),
                data.get('join_date', existing.get('join_date')),
                data.get('leave_date', existing.get('leave_date')),
                data.get('current_city', existing.get('current_city')),
                onsite_value,
                data.get('status', existing.get('status', '在岗')),
                data.get('remark', existing.get('remark')),
                member_id
            ))
            conn.commit()
            return True

    @staticmethod
    def delete_project_member(member_id):
        with DatabasePool.get_connection() as conn:
            conn.execute(DatabasePool.format_sql('DELETE FROM project_members WHERE id = ?'), (member_id,))
            conn.commit()
            return True

    @staticmethod
    def get_customer_contacts(project_id):
        with DatabasePool.get_connection() as conn:
            contacts = conn.execute(DatabasePool.format_sql('SELECT * FROM customer_contacts WHERE project_id = ? ORDER BY is_primary DESC'), (project_id,)).fetchall()
            return [dict(c) for c in contacts]

    @staticmethod
    def add_customer_contact(project_id, data):
        with DatabasePool.get_connection() as conn:
            if data.get('is_primary'):
                conn.execute(DatabasePool.format_sql('UPDATE customer_contacts SET is_primary = FALSE WHERE project_id = ?'), (project_id,))

            primary_value = bool(data.get('is_primary')) if DatabasePool.is_postgres() else (1 if data.get('is_primary') else 0)
            conn.execute(DatabasePool.format_sql('''
                INSERT INTO customer_contacts (project_id, name, department, position, phone, email, is_primary, remark)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            '''), (project_id, data['name'], data.get('department'), data.get('position'),
                  data.get('phone'), data.get('email'), primary_value, data.get('remark')))
            conn.commit()
            return True

    @staticmethod
    def update_customer_contact(contact_id, data):
        with DatabasePool.get_connection() as conn:
            existing = conn.execute(
                DatabasePool.format_sql('SELECT * FROM customer_contacts WHERE id = ?'),
                (contact_id,)
            ).fetchone()
            if not existing:
                return False
            existing = dict(existing)
            if data.get('is_primary'):
                contact = conn.execute(DatabasePool.format_sql('SELECT project_id FROM customer_contacts WHERE id = ?'), (contact_id,)).fetchone()
                if contact:
                    conn.execute(DatabasePool.format_sql('UPDATE customer_contacts SET is_primary = FALSE WHERE project_id = ?'), (contact['project_id'],))

            primary_value = data.get('is_primary', existing.get('is_primary'))
            if DatabasePool.is_postgres():
                primary_value = bool(primary_value)
            else:
                primary_value = 1 if primary_value else 0
            conn.execute(DatabasePool.format_sql('''
                UPDATE customer_contacts SET name=?, department=?, position=?, phone=?, 
                email=?, is_primary=?, remark=?
                WHERE id=?
            '''), (
                data.get('name', existing.get('name')),
                data.get('department', existing.get('department')),
                data.get('position', existing.get('position')),
                data.get('phone', existing.get('phone')),
                data.get('email', existing.get('email')),
                primary_value,
                data.get('remark', existing.get('remark')),
                contact_id
            ))
            conn.commit()
            return True

    @staticmethod
    def delete_customer_contact(contact_id):
        with DatabasePool.get_connection() as conn:
            conn.execute(DatabasePool.format_sql('DELETE FROM customer_contacts WHERE id = ?'), (contact_id,))
            conn.commit()
            return True

member_service = MemberService()
