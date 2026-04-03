from database import DatabasePool


class HardwareService:
    def list_assets(self, status=None):
        with DatabasePool.get_connection() as conn:
            sql = '''
                SELECT a.*, p.project_name
                FROM hardware_assets a
                LEFT JOIN projects p ON a.current_project_id = p.id
            '''
            params = []
            if status:
                sql += ' WHERE a.status = ?'
                params.append(status)
            sql += ' ORDER BY a.updated_at DESC, a.created_at DESC, a.id DESC'
            rows = conn.execute(DatabasePool.format_sql(sql), params).fetchall()
            return [dict(row) for row in rows]

    def get_asset(self, asset_id):
        with DatabasePool.get_connection() as conn:
            sql = '''
                SELECT a.*, p.project_name
                FROM hardware_assets a
                LEFT JOIN projects p ON a.current_project_id = p.id
                WHERE a.id = ?
            '''
            row = conn.execute(DatabasePool.format_sql(sql), (asset_id,)).fetchone()
            return dict(row) if row else None

    def create_asset(self, data):
        with DatabasePool.get_connection() as conn:
            sql = '''
                INSERT INTO hardware_assets (
                    asset_name, sn, model, status, current_project_id, location,
                    operator, responsible_person, purchase_date, expire_date, remark
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            '''
            if DatabasePool.is_postgres():
                sql += ' RETURNING id'
            cursor = conn.execute(DatabasePool.format_sql(sql), (
                data.get('asset_name'),
                data.get('sn'),
                data.get('model'),
                data.get('status', '在库'),
                data.get('current_project_id'),
                data.get('location'),
                data.get('operator'),
                data.get('responsible_person'),
                data.get('purchase_date'),
                data.get('expire_date'),
                data.get('remark'),
            ))
            asset_id = DatabasePool.get_inserted_id(cursor)
            conn.commit()
            return self.get_asset(asset_id)

    def update_asset(self, asset_id, data):
        existing = self.get_asset(asset_id)
        if not existing:
            return None

        with DatabasePool.get_connection() as conn:
            sql = '''
                UPDATE hardware_assets
                SET asset_name = ?, sn = ?, model = ?, status = ?, current_project_id = ?,
                    location = ?, operator = ?, responsible_person = ?, purchase_date = ?,
                    expire_date = ?, remark = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            '''
            conn.execute(DatabasePool.format_sql(sql), (
                data.get('asset_name', existing.get('asset_name')),
                data.get('sn', existing.get('sn')),
                data.get('model', existing.get('model')),
                data.get('status', existing.get('status')),
                data.get('current_project_id', existing.get('current_project_id')),
                data.get('location', existing.get('location')),
                data.get('operator', existing.get('operator')),
                data.get('responsible_person', existing.get('responsible_person')),
                data.get('purchase_date', existing.get('purchase_date')),
                data.get('expire_date', existing.get('expire_date')),
                data.get('remark', existing.get('remark')),
                asset_id,
            ))
            conn.commit()
        return self.get_asset(asset_id)

    def delete_asset(self, asset_id):
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('DELETE FROM hardware_assets WHERE id = ?')
            cursor = conn.execute(sql, (asset_id,))
            conn.commit()
            return (cursor.rowcount or 0) > 0


hardware_service = HardwareService()
