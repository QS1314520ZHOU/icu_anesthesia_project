import json
from database import DatabasePool

class AuditService:
    @staticmethod
    def log_operation(operator, op_type, entity_type, entity_id, entity_name, old_val=None, new_val=None):
        """记录操作日志"""
        with DatabasePool.get_connection() as conn:
            conn.execute('''
                INSERT INTO operation_logs (operator, operation_type, entity_type, entity_id, entity_name, old_value, new_value)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (operator or '系统', op_type, entity_type, entity_id, entity_name, 
                  json.dumps(old_val, ensure_ascii=False) if old_val else None,
                  json.dumps(new_val, ensure_ascii=False) if new_val else None))
            conn.commit()
            return True

audit_service = AuditService()
