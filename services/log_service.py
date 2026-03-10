import json
import logging
from datetime import datetime, timedelta
from database import DatabasePool

from services.audit_service import audit_service
from services.monitor_service import monitor_service

logger = logging.getLogger(__name__)

class LogService:
    # --- Work Logs ---
    @staticmethod
    def get_work_logs(project_id, start_date=None, end_date=None):
        with DatabasePool.get_connection() as conn:
            from app_config import DB_CONFIG
            db_type = DB_CONFIG.get('TYPE', 'sqlite')
            placeholder = '%s' if db_type == 'postgres' else '?'
            
            query = f'SELECT * FROM work_logs WHERE project_id = {placeholder}'
            params = [project_id]
            
            if start_date:
                query += f' AND log_date >= {placeholder}'
                params.append(start_date)
            if end_date:
                query += f' AND log_date <= {placeholder}'
                params.append(end_date)
            
            query += ' ORDER BY log_date DESC, created_at DESC'
            logs = conn.execute(query, params).fetchall()
            return [dict(l) for l in logs]

    @staticmethod
    def add_work_log(project_id, data):
        with DatabasePool.get_connection() as conn:
            from app_config import DB_CONFIG
            db_type = DB_CONFIG.get('TYPE', 'sqlite')
            placeholder = '%s' if db_type == 'postgres' else '?'
            
            conn.execute(f'''
                INSERT INTO work_logs (project_id, member_id, member_name, log_date, work_hours, work_type, 
                    work_content, issues_encountered, tomorrow_plan)
                VALUES ({placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder})
            ''', (project_id, data.get('member_id'), data.get('member_name'), 
                  data.get('log_date', datetime.now().strftime('%Y-%m-%d')),
                  data.get('work_hours', 8), data.get('work_type', '现场'),
                  data.get('work_content'), data.get('issues_encountered'), data.get('tomorrow_plan')))
            conn.commit()
            return True

    @staticmethod
    def update_work_log(log_id, data):
        with DatabasePool.get_connection() as conn:
            from app_config import DB_CONFIG
            db_type = DB_CONFIG.get('TYPE', 'sqlite')
            placeholder = '%s' if db_type == 'postgres' else '?'
            
            conn.execute(f'''
                UPDATE work_logs SET member_id={placeholder}, member_name={placeholder}, log_date={placeholder}, 
                    work_hours={placeholder}, work_type={placeholder}, work_content={placeholder}, 
                    issues_encountered={placeholder}, tomorrow_plan={placeholder} WHERE id={placeholder}
            ''', (data.get('member_id'), data.get('member_name'), data.get('log_date'),
                  data.get('work_hours'), data.get('work_type'), data.get('work_content'),
                  data.get('issues_encountered'), data.get('tomorrow_plan'), log_id))
            conn.commit()
            return True

    @staticmethod
    def delete_work_log(log_id):
        with DatabasePool.get_connection() as conn:
            from app_config import DB_CONFIG
            db_type = DB_CONFIG.get('TYPE', 'sqlite')
            placeholder = '%s' if db_type == 'postgres' else '?'
            conn.execute(f'DELETE FROM work_logs WHERE id = {placeholder}', (log_id,))
            conn.commit()
            return True

    @staticmethod
    def get_work_log_stats(project_id):
        with DatabasePool.get_connection() as conn:
            from app_config import DB_CONFIG
            db_type = DB_CONFIG.get('TYPE', 'sqlite')
            placeholder = '%s' if db_type == 'postgres' else '?'
            
            total = conn.execute(f'SELECT SUM(work_hours) as total FROM work_logs WHERE project_id = {placeholder}', 
                                (project_id,)).fetchone()['total'] or 0
            
            by_member = conn.execute(f'''
                SELECT member_name, SUM(work_hours) as hours, COUNT(*) as days
                FROM work_logs WHERE project_id = {placeholder} GROUP BY member_name ORDER BY hours DESC
            ''', (project_id,)).fetchall()
            
            if db_type == 'postgres':
                by_month_sql = f'''
                    SELECT TO_CHAR(log_date, 'YYYY-MM') as month, SUM(work_hours) as hours
                    FROM work_logs WHERE project_id = {placeholder} GROUP BY month ORDER BY month
                '''
            else:
                by_month_sql = f'''
                    SELECT strftime('%Y-%m', log_date) as month, SUM(work_hours) as hours
                    FROM work_logs WHERE project_id = ? GROUP BY month ORDER BY month
                '''
            by_month = conn.execute(by_month_sql, (project_id,)).fetchall()
            
            by_type = conn.execute(f'''
                SELECT work_type, SUM(work_hours) as hours
                FROM work_logs WHERE project_id = {placeholder} GROUP BY work_type
            ''', (project_id,)).fetchall()
            
            return {
                'total_hours': round(total, 1),
                'by_member': [dict(m) for m in by_member],
                'by_month': [dict(m) for m in by_month],
                'by_type': [dict(t) for t in by_type]
            }

    # --- Departures ---
    @staticmethod
    def get_project_departures(project_id):
        with DatabasePool.get_connection() as conn:
            from app_config import DB_CONFIG
            db_type = DB_CONFIG.get('TYPE', 'sqlite')
            placeholder = '%s' if db_type == 'postgres' else '?'
            departures = conn.execute(f'SELECT * FROM project_departures WHERE project_id = {placeholder} ORDER BY created_at DESC', (project_id,)).fetchall()
            return [dict(d) for d in departures]

    @staticmethod
    def add_project_departure(project_id, data):
        with DatabasePool.get_connection() as conn:
            from app_config import DB_CONFIG
            db_type = DB_CONFIG.get('TYPE', 'sqlite')
            placeholder = '%s' if db_type == 'postgres' else '?'
            
            conn.execute(f'''
                INSERT INTO project_departures (project_id, departure_type, departure_date, expected_return_date,
                    reason, handover_person, our_persons, doc_handover, account_handover, training_handover,
                    issue_handover, contact_handover, pending_issues, remote_support_info, remark)
                VALUES ({placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder})
            ''', (project_id, data['departure_type'], data['departure_date'], data.get('expected_return_date'),
                  data.get('reason'), data.get('handover_person'), data.get('our_persons'),
                  True if data.get('doc_handover') else False, True if data.get('account_handover') else False,
                  True if data.get('training_handover') else False, True if data.get('issue_handover') else False,
                  True if data.get('contact_handover') else False, data.get('pending_issues'),
                  data.get('remote_support_info'), data.get('remark')))
            
            new_status = '离场待返'
            if data['departure_type'] == '项目暂停':
                new_status = '暂停'
            elif data['departure_type'] == '项目终止':
                new_status = '已终止'
            elif data['departure_type'] == '验收离场':
                new_status = '已验收'
            
            conn.execute(f'UPDATE projects SET status = {placeholder}, updated_at = CURRENT_TIMESTAMP WHERE id = {placeholder}', 
                         (new_status, project_id))
            conn.commit()
            
            project = conn.execute(f'SELECT project_name FROM projects WHERE id = {placeholder}', (project_id,)).fetchone()
            
            audit_service.log_operation('用户', '离场申请', 'project', project_id, project['project_name'],
                                     None, {'departure_type': data['departure_type'], 'status': new_status})
            
            monitor_service.send_notification_async(
                f"🚪 项目离场: {project['project_name']}",
                f"离场类型: {data['departure_type']}\n离场日期: {data['departure_date']}\n预计返场: {data.get('expected_return_date', '待定')}",
                'warning'
            )
            return True

    @staticmethod
    def update_project_departure(departure_id, data):
        with DatabasePool.get_connection() as conn:
            from app_config import DB_CONFIG
            db_type = DB_CONFIG.get('TYPE', 'sqlite')
            placeholder = '%s' if db_type == 'postgres' else '?'
            
            conn.execute(f'''
                UPDATE project_departures SET departure_type={placeholder}, departure_date={placeholder}, expected_return_date={placeholder},
                    reason={placeholder}, handover_person={placeholder}, our_persons={placeholder}, doc_handover={placeholder}, account_handover={placeholder}, 
                    training_handover={placeholder}, issue_handover={placeholder}, contact_handover={placeholder}, pending_issues={placeholder},
                    remote_support_info={placeholder}, status={placeholder}, remark={placeholder} WHERE id={placeholder}
            ''', (data.get('departure_type'), data.get('departure_date'), data.get('expected_return_date'),
                  data.get('reason'), data.get('handover_person'), data.get('our_persons'),
                  True if data.get('doc_handover') else False, True if data.get('account_handover') else False, 
                  True if data.get('training_handover') else False, True if data.get('issue_handover') else False, 
                  True if data.get('contact_handover') else False, data.get('pending_issues'),
                  data.get('remote_support_info'), data.get('status'), data.get('remark'), departure_id))
            conn.commit()
            return True

    @staticmethod
    def record_return(departure_id, data):
        with DatabasePool.get_connection() as conn:
            return_date = data.get('return_date', datetime.now().strftime('%Y-%m-%d'))
            from app_config import DB_CONFIG
            db_type = DB_CONFIG.get('TYPE', 'sqlite')
            placeholder = '%s' if db_type == 'postgres' else '?'
            
            conn.execute(f'''
                UPDATE project_departures SET actual_return_date = {placeholder}, status = '已返场' WHERE id = {placeholder}
            ''', (return_date, departure_id))
            
            departure = conn.execute(f'SELECT project_id FROM project_departures WHERE id = {placeholder}', (departure_id,)).fetchone()
            conn.execute(f'UPDATE projects SET status = {placeholder}, updated_at = CURRENT_TIMESTAMP WHERE id = {placeholder}', 
                         ('进行中', departure['project_id']))
            
            project = conn.execute(f'SELECT project_name FROM projects WHERE id = {placeholder}', (departure['project_id'],)).fetchone()
            conn.commit()
            
            audit_service.log_operation('用户', '返场', 'project', departure['project_id'], project['project_name'])
            
            monitor_service.send_notification_async(
                f"🔙 项目返场: {project['project_name']}",
                f"返场日期: {return_date}\n项目已恢复进行中状态",
                'info'
            )
            return True

    @staticmethod
    def delete_departure(departure_id):
        with DatabasePool.get_connection() as conn:
            from app_config import DB_CONFIG
            db_type = DB_CONFIG.get('TYPE', 'sqlite')
            placeholder = '%s' if db_type == 'postgres' else '?'
            conn.execute(f'DELETE FROM project_departures WHERE id = {placeholder}', (departure_id,))
            conn.commit()
            return True

log_service = LogService()
