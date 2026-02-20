import os
import json
import logging
from datetime import datetime
from database import DatabasePool
from services.audit_service import audit_service


logger = logging.getLogger(__name__)

class DocService:
    # --- Documents ---
    @staticmethod
    def get_project_documents(project_id):
        with DatabasePool.get_connection() as conn:
            docs = conn.execute('SELECT * FROM project_documents WHERE project_id = ? ORDER BY upload_at DESC', 
                               (project_id,)).fetchall()
            return [dict(d) for d in docs]

    @staticmethod
    def add_project_document(project_id, data, file_info=None):
        with DatabasePool.get_connection() as conn:
            if file_info:
                conn.execute('''
                    INSERT INTO project_documents (project_id, doc_name, doc_type, doc_category, file_path, file_size, version, upload_by, remark)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (project_id, data.get('doc_name', file_info['filename']), data.get('doc_type'), data.get('doc_category'),
                      file_info['path'], file_info['size'], data.get('version', 'v1.0'), data.get('upload_by'), data.get('remark')))
            else:
                conn.execute('''
                    INSERT INTO project_documents (project_id, doc_name, doc_type, doc_category, version, upload_by, remark)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (project_id, data.get('doc_name'), data.get('doc_type'), data.get('doc_category'),
                      data.get('version', 'v1.0'), data.get('upload_by'), data.get('remark')))
            conn.commit()
            return True

    @staticmethod
    def delete_document(doc_id):
        with DatabasePool.get_connection() as conn:
            doc = conn.execute('SELECT file_path FROM project_documents WHERE id = ?', (doc_id,)).fetchone()
            if doc and doc['file_path']:
                try:
                    # Remove from Baidu Netdisk
                    from storage_service import storage_service
                    storage_service.delete_file(doc['file_path'])
                except Exception as e:
                    logger.error(f"Failed to delete file {doc['file_path']}: {e}")
            
            conn.execute('DELETE FROM project_documents WHERE id = ?', (doc_id,))
            conn.commit()
            return True

    @staticmethod
    def get_document_info(doc_id):
        with DatabasePool.get_connection() as conn:
            doc = conn.execute('SELECT * FROM project_documents WHERE id = ?', (doc_id,)).fetchone()
            return dict(doc) if doc else None

    # --- Expenses ---
    @staticmethod
    def get_project_expenses(project_id):
        with DatabasePool.get_connection() as conn:
            expenses = conn.execute('SELECT * FROM project_expenses WHERE project_id = ? ORDER BY expense_date DESC', 
                                   (project_id,)).fetchall()
            return [dict(e) for e in expenses]

    @staticmethod
    def add_project_expense(project_id, data):
        with DatabasePool.get_connection() as conn:
            conn.execute('''
                INSERT INTO project_expenses (project_id, expense_date, expense_type, amount, description, applicant, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (project_id, data['expense_date'], data['expense_type'], data['amount'],
                  data.get('description'), data.get('applicant'), data.get('status', '待报销')))
            conn.commit()
            return True

    @staticmethod
    def update_expense(expense_id, data):
        with DatabasePool.get_connection() as conn:
            approved_at = datetime.now().strftime('%Y-%m-%d %H:%M:%S') if data.get('status') == '已报销' else None
            conn.execute('''
                UPDATE project_expenses SET expense_date=?, expense_type=?, amount=?, description=?, 
                    applicant=?, status=?, approved_by=?, approved_at=? WHERE id=?
            ''', (data.get('expense_date'), data.get('expense_type'), data.get('amount'),
                  data.get('description'), data.get('applicant'), data.get('status'),
                  data.get('approved_by'), approved_at, expense_id))
            conn.commit()
            return True

    @staticmethod
    def delete_expense(expense_id):
        with DatabasePool.get_connection() as conn:
            conn.execute('DELETE FROM project_expenses WHERE id = ?', (expense_id,))
            conn.commit()
            return True

    @staticmethod
    def get_expense_stats(project_id):
        with DatabasePool.get_connection() as conn:
            total = conn.execute('SELECT SUM(amount) as total FROM project_expenses WHERE project_id = ?', 
                                (project_id,)).fetchone()['total'] or 0
            
            by_type = conn.execute('''
                SELECT expense_type, SUM(amount) as amount FROM project_expenses 
                WHERE project_id = ? GROUP BY expense_type
            ''', (project_id,)).fetchall()
            
            by_status = conn.execute('''
                SELECT status, SUM(amount) as amount FROM project_expenses 
                WHERE project_id = ? GROUP BY status
            ''', (project_id,)).fetchall()
            
            by_month = conn.execute('''
                SELECT strftime('%Y-%m', expense_date) as month, SUM(amount) as amount
                FROM project_expenses WHERE project_id = ? GROUP BY month ORDER BY month
            ''', (project_id,)).fetchall()
            
            return {
                'total': round(total, 2),
                'by_type': [dict(t) for t in by_type],
                'by_status': [dict(s) for s in by_status],
                'by_month': [dict(m) for m in by_month]
            }

doc_service = DocService()
