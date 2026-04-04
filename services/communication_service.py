from datetime import datetime

from database import DatabasePool


class CommunicationService:
    def _now_iso(self):
        return datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    def _today_iso(self):
        return datetime.now().strftime('%Y-%m-%d')

    def _normalize_payload(self, data, existing=None):
        payload = dict(existing or {})
        incoming = data or {}

        def clean_text(value):
            if value is None:
                return None
            text = str(value).strip()
            return text or None

        for key in ('contact_date', 'contact_person', 'contact_method', 'summary', 'attachments', 'created_by'):
            if key in incoming:
                payload[key] = clean_text(incoming.get(key))

        if 'related_issue_id' in incoming:
            related_issue_id = incoming.get('related_issue_id')
            payload['related_issue_id'] = related_issue_id if related_issue_id not in ('', None) else None

        payload['contact_date'] = payload.get('contact_date') or self._today_iso()
        payload['contact_method'] = payload.get('contact_method') or '电话'
        payload['summary'] = clean_text(payload.get('summary'))
        if not payload['summary']:
            raise ValueError('沟通摘要不能为空')

        payload['contact_person'] = payload.get('contact_person') or ''
        payload['attachments'] = payload.get('attachments')
        payload['created_by'] = payload.get('created_by') or 'system'
        return payload

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
        payload = self._normalize_payload(data)
        with DatabasePool.get_connection() as conn:
            sql = '''
                INSERT INTO customer_communications (
                    project_id, contact_date, contact_person, contact_method,
                    summary, related_issue_id, attachments, created_by, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            '''
            if DatabasePool.is_postgres():
                sql += ' RETURNING id'
            cursor = conn.execute(DatabasePool.format_sql(sql), (
                project_id,
                payload.get('contact_date'),
                payload.get('contact_person'),
                payload.get('contact_method'),
                payload.get('summary'),
                payload.get('related_issue_id'),
                payload.get('attachments'),
                payload.get('created_by'),
                self._now_iso(),
            ))
            record_id = DatabasePool.get_inserted_id(cursor)
            conn.commit()
            return self.get_communication(record_id)

    def update_communication(self, record_id, data):
        existing = self.get_communication(record_id)
        if not existing:
            return None
        payload = self._normalize_payload(data, existing=existing)

        with DatabasePool.get_connection() as conn:
            sql = '''
                UPDATE customer_communications
                SET contact_date = ?, contact_person = ?, contact_method = ?,
                    summary = ?, related_issue_id = ?, attachments = ?, created_by = ?
                WHERE id = ?
            '''
            conn.execute(DatabasePool.format_sql(sql), (
                payload.get('contact_date'),
                payload.get('contact_person'),
                payload.get('contact_method'),
                payload.get('summary'),
                payload.get('related_issue_id'),
                payload.get('attachments'),
                existing.get('created_by') or payload.get('created_by'),
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
