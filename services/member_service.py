from datetime import datetime
from database import DatabasePool

class MemberService:
    @staticmethod
    def get_project_members(project_id):
        with DatabasePool.get_connection() as conn:
            members = conn.execute(DatabasePool.format_sql('SELECT * FROM project_members WHERE project_id = ? ORDER BY role, name'), (project_id,)).fetchall()
            return [dict(m) for m in members]

    @staticmethod
    def add_project_member(project_id, data):
        with DatabasePool.get_connection() as conn:
            conn.execute(DatabasePool.format_sql('''
                INSERT INTO project_members (project_id, name, role, phone, email, daily_rate, join_date, current_city, is_onsite, remark)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            '''), (project_id, data['name'], data.get('role', '实施工程师'), data.get('phone'),
                  data.get('email'), data.get('daily_rate', 0),
                  data.get('join_date', datetime.now().strftime('%Y-%m-%d')),
                  data.get('current_city'), 1 if data.get('is_onsite') else 0, data.get('remark')))
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
                data.get('is_onsite', existing.get('is_onsite')),
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
            
            conn.execute(DatabasePool.format_sql('''
                INSERT INTO customer_contacts (project_id, name, department, position, phone, email, is_primary, remark)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            '''), (project_id, data['name'], data.get('department'), data.get('position'),
                  data.get('phone'), data.get('email'), 1 if data.get('is_primary') else 0, data.get('remark')))
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
                data.get('is_primary', existing.get('is_primary')),
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
