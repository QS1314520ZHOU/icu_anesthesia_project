from database import DatabasePool


class CommunicationService:
    def list_by_project(self, project_id):
        with DatabasePool.get_connection() as conn:
            sql = '''
                SELECT *
                FROM customer_communications
                WHERE project_id = ?
                ORDER BY contact_date DESC, created_at DESC, id DESC
            '''
            rows = conn.execute(DatabasePool.format_sql(sql), (project_id,)).fetchall()
            return [dict(row) for row in rows]

    def get_communication(self, record_id):
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('SELECT * FROM customer_communications WHERE id = ?')
            row = conn.execute(sql, (record_id,)).fetchone()
            return dict(row) if row else None

    def create_communication(self, project_id, data):
        with DatabasePool.get_connection() as conn:
            sql = '''
                INSERT INTO customer_communications (
                    project_id, contact_date, contact_person, contact_method,
                    summary, related_issue_id, attachments, created_by
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            '''
            if DatabasePool.is_postgres():
                sql += ' RETURNING id'
            cursor = conn.execute(DatabasePool.format_sql(sql), (
                project_id,
                data.get('contact_date'),
                data.get('contact_person'),
                data.get('contact_method'),
                data.get('summary'),
                data.get('related_issue_id'),
                data.get('attachments'),
                data.get('created_by', 'system'),
            ))
            record_id = DatabasePool.get_inserted_id(cursor)
            conn.commit()
            return self.get_communication(record_id)

    def update_communication(self, record_id, data):
        existing = self.get_communication(record_id)
        if not existing:
            return None

        with DatabasePool.get_connection() as conn:
            sql = '''
                UPDATE customer_communications
                SET contact_date = ?, contact_person = ?, contact_method = ?,
                    summary = ?, related_issue_id = ?, attachments = ?, created_by = ?
                WHERE id = ?
            '''
            conn.execute(DatabasePool.format_sql(sql), (
                data.get('contact_date', existing.get('contact_date')),
                data.get('contact_person', existing.get('contact_person')),
                data.get('contact_method', existing.get('contact_method')),
                data.get('summary', existing.get('summary')),
                data.get('related_issue_id', existing.get('related_issue_id')),
                data.get('attachments', existing.get('attachments')),
                data.get('created_by', existing.get('created_by')),
                record_id,
            ))
            conn.commit()
        return self.get_communication(record_id)

    def delete_communication(self, record_id):
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('DELETE FROM customer_communications WHERE id = ?')
            cursor = conn.execute(sql, (record_id,))
            conn.commit()
            return (cursor.rowcount or 0) > 0


communication_service = CommunicationService()
