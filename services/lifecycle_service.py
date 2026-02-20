import json
import logging
from datetime import datetime
from database import DatabasePool
from services.audit_service import audit_service
from services.monitor_service import monitor_service

logger = logging.getLogger(__name__)

class LifecycleService:
    # --- Changes ---
    @staticmethod
    def get_project_changes(project_id):
        with DatabasePool.get_connection() as conn:
            changes = conn.execute('SELECT * FROM project_changes WHERE project_id = ? ORDER BY created_at DESC', 
                                  (project_id,)).fetchall()
            return [dict(c) for c in changes]

    @staticmethod
    def add_project_change(project_id, data):
        with DatabasePool.get_connection() as conn:
            conn.execute('''
                INSERT INTO project_changes (project_id, change_type, change_title, change_desc, 
                    impact_analysis, requested_by, requested_date, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (project_id, data['change_type'], data['change_title'], data.get('change_desc'),
                  data.get('impact_analysis'), data.get('requested_by'), 
                  data.get('requested_date', datetime.now().strftime('%Y-%m-%d')), 
                  data.get('status', '待审批')))
            
            project = conn.execute('SELECT project_name FROM projects WHERE id = ?', (project_id,)).fetchone()
            conn.commit()
            
            monitor_service.send_notification_async(
                f"📝 新变更申请: {data['change_title']}",
                f"项目: {project['project_name']}\n类型: {data['change_type']}\n申请人: {data.get('requested_by', '未知')}",
                'info'
            )
            return True

    @staticmethod
    def update_change(change_id, data):
        with DatabasePool.get_connection() as conn:
            approved_date = datetime.now().strftime('%Y-%m-%d') if data.get('status') in ['已批准', '已驳回'] else None
            conn.execute('''
                UPDATE project_changes SET change_type=?, change_title=?, change_desc=?, impact_analysis=?,
                    requested_by=?, requested_date=?, approved_by=?, approved_date=?, status=? WHERE id=?
            ''', (data.get('change_type'), data.get('change_title'), data.get('change_desc'),
                  data.get('impact_analysis'), data.get('requested_by'), data.get('requested_date'),
                  data.get('approved_by'), approved_date, data.get('status'), change_id))
            conn.commit()
            return True

    @staticmethod
    def delete_change(change_id):
        with DatabasePool.get_connection() as conn:
            conn.execute('DELETE FROM project_changes WHERE id = ?', (change_id,))
            conn.commit()
            return True

    # --- Acceptances ---
    @staticmethod
    def get_project_acceptances(project_id):
        with DatabasePool.get_connection() as conn:
            acceptances = conn.execute('SELECT * FROM project_acceptances WHERE project_id = ? ORDER BY created_at DESC', 
                                      (project_id,)).fetchall()
            return [dict(a) for a in acceptances]

    @staticmethod
    def add_project_acceptance(project_id, data):
        with DatabasePool.get_connection() as conn:
            conn.execute('''
                INSERT INTO project_acceptances (project_id, acceptance_type, stage_name, acceptance_date,
                    acceptance_items, pass_rate, issues_found, customer_sign, our_sign, status, remark)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (project_id, data['acceptance_type'], data.get('stage_name'), data.get('acceptance_date'),
                  json.dumps(data.get('acceptance_items', []), ensure_ascii=False), data.get('pass_rate'),
                  data.get('issues_found'), data.get('customer_sign'), data.get('our_sign'),
                  data.get('status', '待验收'), data.get('remark')))
            conn.commit()
            return True

    @staticmethod
    def update_acceptance(acceptance_id, data):
        with DatabasePool.get_connection() as conn:
            conn.execute('''
                UPDATE project_acceptances SET acceptance_type=?, stage_name=?, acceptance_date=?,
                    acceptance_items=?, pass_rate=?, issues_found=?, customer_sign=?, our_sign=?, 
                    status=?, remark=? WHERE id=?
            ''', (data.get('acceptance_type'), data.get('stage_name'), data.get('acceptance_date'),
                  json.dumps(data.get('acceptance_items', []), ensure_ascii=False), data.get('pass_rate'),
                  data.get('issues_found'), data.get('customer_sign'), data.get('our_sign'),
                  data.get('status'), data.get('remark'), acceptance_id))
            
            if data.get('acceptance_type') == '最终验收' and data.get('status') == '已通过':
                acceptance = conn.execute('SELECT project_id FROM project_acceptances WHERE id = ?', 
                                         (acceptance_id,)).fetchone()
                conn.execute('UPDATE projects SET status = ?, actual_end_date = ? WHERE id = ?',
                            ('已验收', datetime.now().strftime('%Y-%m-%d'), acceptance['project_id']))
            conn.commit()
            return True

    @staticmethod
    def delete_acceptance(acceptance_id):
        with DatabasePool.get_connection() as conn:
            conn.execute('DELETE FROM project_acceptances WHERE id = ?', (acceptance_id,))
            conn.commit()
            return True

    # --- Satisfaction ---
    @staticmethod
    def get_customer_satisfaction(project_id):
        with DatabasePool.get_connection() as conn:
            records = conn.execute('SELECT * FROM customer_satisfaction WHERE project_id = ? ORDER BY survey_date DESC', 
                                  (project_id,)).fetchall()
            return [dict(r) for r in records]

    @staticmethod
    def add_customer_satisfaction(project_id, data):
        with DatabasePool.get_connection() as conn:
            conn.execute('''
                INSERT INTO customer_satisfaction (project_id, survey_date, survey_type, score_quality, 
                    score_service, score_response, score_professional, score_overall, feedback, surveyor)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (project_id, data.get('survey_date', datetime.now().strftime('%Y-%m-%d')),
                  data.get('survey_type', '定期回访'), data.get('score_quality'), data.get('score_service'),
                  data.get('score_response'), data.get('score_professional'), data.get('score_overall'),
                  data.get('feedback'), data.get('surveyor')))
            conn.commit()
            return True

    @staticmethod
    def get_satisfaction_stats(project_id):
        with DatabasePool.get_connection() as conn:
            stats = conn.execute('''
                SELECT 
                    AVG(score_quality) as avg_quality,
                    AVG(score_service) as avg_service,
                    AVG(score_response) as avg_response,
                    AVG(score_professional) as avg_professional,
                    AVG(score_overall) as avg_overall,
                    COUNT(*) as count
                FROM customer_satisfaction WHERE project_id = ?
            ''', (project_id,)).fetchone()
            return dict(stats)

    @staticmethod
    def delete_satisfaction(satisfaction_id):
        with DatabasePool.get_connection() as conn:
            conn.execute('DELETE FROM customer_satisfaction WHERE id = ?', (satisfaction_id,))
            conn.commit()
            return True

    # --- Follow-ups ---
    @staticmethod
    def get_follow_ups(project_id):
        with DatabasePool.get_connection() as conn:
            records = conn.execute('SELECT * FROM follow_up_records WHERE project_id = ? ORDER BY follow_up_date DESC', 
                                  (project_id,)).fetchall()
            return [dict(r) for r in records]

    @staticmethod
    def add_follow_up(project_id, data):
        with DatabasePool.get_connection() as conn:
            conn.execute('''
                INSERT INTO follow_up_records (project_id, follow_up_date, follow_up_type, contact_person,
                    content, issues_found, follow_up_by, next_follow_up_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (project_id, data.get('follow_up_date', datetime.now().strftime('%Y-%m-%d')),
                  data.get('follow_up_type', '电话回访'), data.get('contact_person'),
                  data.get('content'), data.get('issues_found'), data.get('follow_up_by'),
                  data.get('next_follow_up_date')))
            conn.commit()
            return True

    @staticmethod
    def delete_follow_up(followup_id):
        with DatabasePool.get_connection() as conn:
            conn.execute('DELETE FROM follow_up_records WHERE id = ?', (followup_id,))
            conn.commit()
            return True

lifecycle_service = LifecycleService()
