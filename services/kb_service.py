from database import DatabasePool


class KBService:
    @staticmethod
    def _chunk_text(text, chunk_size=500, overlap=80):
        text = (text or '').strip()
        if not text:
            return []
        chunks = []
        start = 0
        n = len(text)
        while start < n:
            end = min(start + chunk_size, n)
            chunk = text[start:end].strip()
            if chunk:
                chunks.append(chunk)
            if end >= n:
                break
            start = max(end - overlap, start + 1)
        return chunks

    def sync_kb_chunks(self, source_id):
        """将 knowledge_base 单条记录同步到 kb_items 分块表。"""
        with DatabasePool.get_connection() as conn:
            row = conn.execute(
                DatabasePool.format_sql('SELECT * FROM knowledge_base WHERE id = ?'),
                (source_id,)
            ).fetchone()
            if not row:
                return 0
            item = dict(row)
            title = item.get('title') or ''
            content = item.get('content') or ''
            category = item.get('category') or 'general'
            tags = item.get('tags') or ''
            project_id = item.get('project_id')

            conn.execute(
                DatabasePool.format_sql("DELETE FROM kb_items WHERE source_type = 'knowledge_base' AND source_id = ?"),
                (source_id,)
            )

            chunks = self._chunk_text(content, chunk_size=500, overlap=80)
            if not chunks and content:
                chunks = [content]
            for idx, chunk in enumerate(chunks, start=1):
                conn.execute(DatabasePool.format_sql('''
                    INSERT INTO kb_items (title, content, category, tags, source_type, source_id, project_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                '''), (
                    f"{title}#{idx}",
                    chunk,
                    category,
                    tags,
                    'knowledge_base',
                    source_id,
                    project_id
                ))
            conn.commit()
            return len(chunks)

    def delete_kb_chunks(self, source_id):
        with DatabasePool.get_connection() as conn:
            conn.execute(
                DatabasePool.format_sql("DELETE FROM kb_items WHERE source_type = 'knowledge_base' AND source_id = ?"),
                (source_id,)
            )
            conn.commit()
            return True

    def search_kb_items(self, query, project_id=None, limit=5):
        q = (query or '').strip()
        if not q:
            return []
        with DatabasePool.get_connection() as conn:
            params = [f'%{q}%', f'%{q}%', f'%{q}%']
            project_clause = ''
            if project_id:
                project_clause = 'AND (project_id = ? OR project_id IS NULL)'
                params.append(project_id)
            params.append(max(1, min(int(limit or 5), 20)))

            rows = conn.execute(DatabasePool.format_sql(f'''
                SELECT id, title, content, category, tags, project_id, source_type, source_id
                FROM kb_items
                WHERE (title LIKE ? OR content LIKE ? OR tags LIKE ?)
                {project_clause}
                ORDER BY updated_at DESC, created_at DESC
                LIMIT ?
            '''), params).fetchall()

        result = []
        for row in rows:
            item = dict(row)
            content = item.get('content') or ''
            snippet = content[:120] + ('...' if len(content) > 120 else '')
            score = 0
            low = content.lower()
            q_low = q.lower()
            if q_low in low:
                score += 2
            score += low.count(q_low)
            result.append({
                'id': item.get('id'),
                'title': item.get('title'),
                'snippet': snippet,
                'category': item.get('category'),
                'tags': item.get('tags'),
                'project_id': item.get('project_id'),
                'source_type': item.get('source_type'),
                'source_id': item.get('source_id'),
                'score': score
            })
        result.sort(key=lambda x: x.get('score', 0), reverse=True)
        return result

    def suggest_for_issue(self, project_id, issue_description, limit=3):
        items = self.search_kb_items(issue_description, project_id=project_id, limit=limit)
        suggestions = []
        for item in items[:limit]:
            suggestions.append({
                'kb_item_id': item.get('id'),
                'title': item.get('title'),
                'snippet': item.get('snippet'),
                'category': item.get('category'),
                'score': item.get('score', 0)
            })
        return suggestions

    def rebuild_all_chunks(self, limit=None):
        """全量重建 knowledge_base -> kb_items 分块索引。"""
        with DatabasePool.get_connection() as conn:
            query = 'SELECT id FROM knowledge_base ORDER BY id DESC'
            params = []
            if limit:
                query += ' LIMIT ?'
                params.append(int(limit))
            rows = conn.execute(DatabasePool.format_sql(query), params).fetchall()
            ids = [row['id'] for row in rows]

        total_chunks = 0
        processed = 0
        for source_id in ids:
            try:
                total_chunks += self.sync_kb_chunks(source_id)
                processed += 1
            except Exception:
                continue
        return {
            'processed': processed,
            'total_chunks': total_chunks
        }


kb_service = KBService()
