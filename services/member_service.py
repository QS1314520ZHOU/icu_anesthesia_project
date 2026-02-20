import sqlite3
from datetime import datetime
from database import DatabasePool

class MemberService:
    @staticmethod
    def get_project_members(project_id):
        with DatabasePool.get_connection() as conn:
            members = conn.execute('SELECT * FROM project_members WHERE project_id = ? ORDER BY role, name', (project_id,)).fetchall()
            return [dict(m) for m in members]

    @staticmethod
    def add_project_member(project_id, data):
        with DatabasePool.get_connection() as conn:
            conn.execute('''
                INSERT INTO project_members (project_id, name, role, phone, email, join_date, current_city, is_onsite, remark)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (project_id, data['name'], data.get('role', '实施工程师'), data.get('phone'),
                  data.get('email'), data.get('join_date', datetime.now().strftime('%Y-%m-%d')),
                  data.get('current_city'), 1 if data.get('is_onsite') else 0, data.get('remark')))
            conn.commit()
            return True

    @staticmethod
    def update_project_member(member_id, data):
        with DatabasePool.get_connection() as conn:
            conn.execute('''
                UPDATE project_members SET name=?, role=?, phone=?, email=?, join_date=?, leave_date=?, 
                current_city=?, is_onsite=?, status=?, remark=? WHERE id=?
            ''', (data.get('name'), data.get('role'), data.get('phone'), data.get('email'),
                  data.get('join_date'), data.get('leave_date'), data.get('current_city'),
                  1 if data.get('is_onsite') else 0, data.get('status', '在岗'), data.get('remark'), member_id))
            conn.commit()
            return True

    @staticmethod
    def delete_project_member(member_id):
        with DatabasePool.get_connection() as conn:
            conn.execute('DELETE FROM project_members WHERE id = ?', (member_id,))
            conn.commit()
            return True

    @staticmethod
    def get_customer_contacts(project_id):
        with DatabasePool.get_connection() as conn:
            contacts = conn.execute('SELECT * FROM customer_contacts WHERE project_id = ? ORDER BY is_primary DESC', (project_id,)).fetchall()
            return [dict(c) for c in contacts]

    @staticmethod
    def add_customer_contact(project_id, data):
        with DatabasePool.get_connection() as conn:
            if data.get('is_primary'):
                conn.execute('UPDATE customer_contacts SET is_primary = 0 WHERE project_id = ?', (project_id,))
            
            conn.execute('''
                INSERT INTO customer_contacts (project_id, name, department, position, phone, email, is_primary, remark)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (project_id, data['name'], data.get('department'), data.get('position'),
                  data.get('phone'), data.get('email'), 1 if data.get('is_primary') else 0, data.get('remark')))
            conn.commit()
            return True

    @staticmethod
    def update_customer_contact(contact_id, data):
        with DatabasePool.get_connection() as conn:
            if data.get('is_primary'):
                contact = conn.execute('SELECT project_id FROM customer_contacts WHERE id = ?', (contact_id,)).fetchone()
                if contact:
                    conn.execute('UPDATE customer_contacts SET is_primary = 0 WHERE project_id = ?', (contact['project_id'],))
            
            conn.execute('''
                UPDATE customer_contacts SET name=?, department=?, position=?, phone=?, email=?, is_primary=?, remark=?
                WHERE id=?
            ''', (data.get('name'), data.get('department'), data.get('position'),
                  data.get('phone'), data.get('email'), 1 if data.get('is_primary') else 0, data.get('remark'), contact_id))
            conn.commit()
            return True

    @staticmethod
    def delete_customer_contact(contact_id):
        with DatabasePool.get_connection() as conn:
            conn.execute('DELETE FROM customer_contacts WHERE id = ?', (contact_id,))
            conn.commit()
            return True

member_service = MemberService()
