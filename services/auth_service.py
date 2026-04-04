# services/auth_service.py
"""
用户认证服务
提供登录、注册、权限验证等功能
"""

from database import DatabasePool
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Union
import secrets
import hashlib
import json
import re
from functools import wraps
from flask import request, jsonify
from utils.geo_service import geo_service

# 角色权限定义
ROLES = {
    "admin": {
        "name": "管理员",
        "permissions": ["*"]  # 全部权限
    },
    "project_manager": {
        "name": "项目经理",
        "permissions": ["project:read", "project:write", "report:read", "report:write", 
                       "team:read", "team:write", "ai:use"]
    },
    "team_member": {
        "name": "团队成员",
        "permissions": ["project:read", "worklog:write", "issue:write"]
    },
    "guest": {
        "name": "访客",
        "permissions": ["project:read"]
    }
}

ROLE_MATRIX_CONFIG_KEY = 'auth_role_matrix'

class AuthService:
    """用户认证服务"""
    
    TOKEN_EXPIRY_HOURS = 24
    ROLE_CACHE_TTL_SECONDS = 60

    def _clone_default_roles(self) -> Dict[str, Dict[str, Any]]:
        return {
            role_key: {
                "name": meta.get("name", role_key),
                "permissions": list(meta.get("permissions", []))
            }
            for role_key, meta in ROLES.items()
        }

    def _sanitize_permissions(self, permissions) -> List[str]:
        if isinstance(permissions, str):
            permissions = re.split(r'[\n,，]+', permissions)
        if not isinstance(permissions, list):
            permissions = []

        cleaned = []
        for item in permissions:
            value = str(item or '').strip()
            if value and value not in cleaned:
                cleaned.append(value)
        return cleaned

    def _sanitize_role_matrix(self, raw_role_matrix) -> Dict[str, Dict[str, Any]]:
        role_matrix = self._clone_default_roles()

        if isinstance(raw_role_matrix, dict):
            items = raw_role_matrix.items()
        elif isinstance(raw_role_matrix, list):
            items = []
            for item in raw_role_matrix:
                if isinstance(item, dict) and item.get('role'):
                    items.append((item.get('role'), item))
        else:
            items = []

        for role_key, meta in items:
            if not role_key or not isinstance(meta, dict):
                continue

            existing = role_matrix.get(role_key, {"name": role_key, "permissions": []})
            role_name = str(meta.get('name') or existing.get('name') or role_key).strip() or role_key
            permissions = self._sanitize_permissions(meta.get('permissions', existing.get('permissions', [])))

            if role_key == 'admin':
                role_name = role_name or '管理员'
                permissions = ['*']
            else:
                permissions = [value for value in permissions if value not in ['*', 'admin']]

            role_matrix[role_key] = {
                "name": role_name,
                "permissions": permissions
            }

        if 'admin' not in role_matrix:
            role_matrix['admin'] = {"name": "管理员", "permissions": ['*']}
        else:
            role_matrix['admin']['permissions'] = ['*']
            role_matrix['admin']['name'] = role_matrix['admin'].get('name') or '管理员'

        return role_matrix

    def _role_sort_key(self, role_key: str):
        default_order = ['admin', 'project_manager', 'team_member', 'guest']
        if role_key in default_order:
            return (0, default_order.index(role_key), role_key)
        return (1, 999, role_key)

    def invalidate_role_cache(self):
        self._role_cache = None
        self._role_cache_loaded_at = None

    def get_role_definitions(self, force_reload: bool = False) -> Dict[str, Dict[str, Any]]:
        now = datetime.now()
        if (
            not force_reload
            and self._role_cache is not None
            and self._role_cache_loaded_at is not None
            and (now - self._role_cache_loaded_at).total_seconds() < self.ROLE_CACHE_TTL_SECONDS
        ):
            return {
                role_key: {
                    "name": meta.get("name", role_key),
                    "permissions": list(meta.get("permissions", []))
                }
                for role_key, meta in self._role_cache.items()
            }

        role_matrix = self._clone_default_roles()
        try:
            with DatabasePool.get_connection() as conn:
                if DatabasePool.table_exists(conn, 'system_config'):
                    row = conn.execute(
                        DatabasePool.format_sql('SELECT value FROM system_config WHERE config_key = ?'),
                        (ROLE_MATRIX_CONFIG_KEY,)
                    ).fetchone()
                    if row and row['value']:
                        role_matrix = self._sanitize_role_matrix(json.loads(row['value']))
        except Exception:
            role_matrix = self._clone_default_roles()

        self._role_cache = role_matrix
        self._role_cache_loaded_at = now
        return {
            role_key: {
                "name": meta.get("name", role_key),
                "permissions": list(meta.get("permissions", []))
            }
            for role_key, meta in role_matrix.items()
        }

    def list_role_definitions(self, force_reload: bool = False) -> List[Dict[str, Any]]:
        role_matrix = self.get_role_definitions(force_reload=force_reload)
        return [
            {
                "role": role_key,
                "name": meta.get("name", role_key),
                "permissions": list(meta.get("permissions", [])),
                "editable": role_key != 'admin'
            }
            for role_key, meta in sorted(role_matrix.items(), key=lambda item: self._role_sort_key(item[0]))
        ]

    def save_role_definitions(self, role_matrix_payload) -> Dict[str, Any]:
        role_matrix = self._sanitize_role_matrix(role_matrix_payload)
        serialized = json.dumps(role_matrix, ensure_ascii=False)

        with DatabasePool.get_connection() as conn:
            conn.execute(DatabasePool.format_sql('''
                INSERT INTO system_config (config_key, value, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(config_key) DO UPDATE SET
                    value = EXCLUDED.value,
                    updated_at = CURRENT_TIMESTAMP
            '''), (ROLE_MATRIX_CONFIG_KEY, serialized))
            conn.commit()

        self.invalidate_role_cache()
        return {
            "success": True,
            "roles": self.list_role_definitions(force_reload=True)
        }

    def _build_user_payload(self, user_id: int, username: str, display_name: str, role: str, wecom_userid: str = None) -> Dict[str, Any]:
        """Build a consistent user payload for login/session responses."""
        role_meta = self.get_role_definitions().get(role, {"name": "未知", "permissions": []})
        return {
            "id": user_id,
            "username": username,
            "display_name": display_name,
            "role": role,
            "role_name": role_meta.get('name', '未知'),
            "permissions": list(role_meta.get('permissions', [])),
            "wecom_userid": wecom_userid
        }

    def login_via_wecom(self, wecom_user: dict) -> dict:
        """通过企业微信 OAuth2 登录/自动注册"""
        wecom_userid = wecom_user.get('userid')
        if not wecom_userid:
            return {"success": False, "message": "无效的企业微信用户"}
        
        with DatabasePool.get_connection() as conn:
            # 1. 查找已绑定的用户
            sql_ex = DatabasePool.format_sql('SELECT id, username, display_name, role, is_active FROM users WHERE wecom_userid = ?')
            existing = conn.execute(sql_ex, (wecom_userid,)).fetchone()
            
            if existing:
                if not existing['is_active']:
                    return {"success": False, "message": "账号已被禁用"}
                
                # 生成 Token 并登录
                token = secrets.token_urlsafe(32)
                expires_at = (datetime.now() + timedelta(hours=self.TOKEN_EXPIRY_HOURS)).strftime('%Y-%m-%d %H:%M:%S')
                sql_token = DatabasePool.format_sql('INSERT INTO user_tokens (user_id, token, expires_at) VALUES (?, ?, ?)')
                conn.execute(sql_token, (existing['id'], token, expires_at))
                sql_update = DatabasePool.format_sql('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?')
                conn.execute(sql_update, (existing['id'],))
                conn.commit()
                
                return {
                    "success": True,
                    "token": token,
                    "user": self._build_user_payload(
                        existing['id'],
                        existing['username'],
                        existing['display_name'],
                        existing['role'],
                        wecom_userid
                    )
                }
            
            # 2. 尝试按姓名匹配已有用户并绑定
            display_name = wecom_user.get('name', wecom_userid)
            sql_match = DatabasePool.format_sql('SELECT id, username, display_name, role FROM users WHERE display_name = ? AND wecom_userid IS NULL')
            name_match = conn.execute(sql_match, (display_name,)).fetchone()
            
            if name_match:
                sql_bind = DatabasePool.format_sql('UPDATE users SET wecom_userid = ? WHERE id = ?')
                conn.execute(sql_bind, (wecom_userid, name_match['id']))
                conn.commit()
                # 递归调用自己，走已绑定流程
                return self.login_via_wecom(wecom_user)
            
            # 3. 自动注册新用户
            username = f"wx_{wecom_userid}"
            password_hash = self._hash_password(secrets.token_urlsafe(16))  # 随机密码
            
            try:
                sql_reg = DatabasePool.format_sql('''
                    INSERT INTO users (username, password_hash, email, display_name, role, wecom_userid)
                    VALUES (?, ?, ?, ?, ?, ?)
                ''')
                conn.execute(sql_reg, (username, password_hash, wecom_user.get('email', ''), 
                      display_name, 'team_member', wecom_userid))
                conn.commit()
                
                # 注册后登录
                return self.login_via_wecom(wecom_user)
            except Exception as e:
                return {"success": False, "message": f"自动注册失败: {str(e)}"}

    def sync_user_to_project_member(self, user_id: int, project_id: int):
        """同步用户到项目成员表以便地图显示"""
        with DatabasePool.get_connection() as conn:
            sql_u = DatabasePool.format_sql('SELECT display_name, email, role FROM users WHERE id = ?')
            user = conn.execute(sql_u, (user_id,)).fetchone()
            sql_p = DatabasePool.format_sql('SELECT city, hospital_name FROM projects WHERE id = ?')
            project = conn.execute(sql_p, (project_id,)).fetchone()
            
            if user and project:
                loc = project['city'] if project['city'] else project['hospital_name']
                role_label = '项目经理' if user['role'] in ['admin', 'project_manager'] else '实施工程师'
                
                # Resolve coordinates
                coords = geo_service.resolve_coords(loc)
                lng, lat = coords if coords else (None, None)
                
                conn.execute(DatabasePool.format_sql('''
                    INSERT INTO project_members 
                    (project_id, name, role, email, status, current_city, lng, lat, is_onsite, join_date)
                    VALUES (?, ?, ?, ?, '在岗', ?, ?, ?, ?, ?)
                    ON CONFLICT (project_id, name) DO UPDATE SET
                        role = EXCLUDED.role,
                        email = EXCLUDED.email,
                        current_city = EXCLUDED.current_city,
                        lng = EXCLUDED.lng,
                        lat = EXCLUDED.lat,
                        join_date = EXCLUDED.join_date
                '''), (
                    project_id,
                    user['display_name'],
                    role_label,
                    user['email'],
                    loc,
                    lng,
                    lat,
                    True,
                    datetime.now().strftime('%Y-%m-%d')
                ))
                conn.commit()

    def bind_wecom(self, user_id: int, wecom_userid: str) -> dict:
        """为现有用户绑定企微ID"""
        with DatabasePool.get_connection() as conn:
            # 1. 检查该企微ID是否已被其他用户占用
            sql_ex = DatabasePool.format_sql('SELECT id, display_name FROM users WHERE wecom_userid = ?')
            existing = conn.execute(sql_ex, (wecom_userid,)).fetchone()
            if existing:
                if existing['id'] == user_id:
                    return {"success": True, "message": "已绑定"}
                return {"success": False, "message": f"该企微账号已被用户 {existing['display_name']} 绑定"}
            
            # 2. 检查当前用户是否已经绑定了其他企微ID
            sql_u = DatabasePool.format_sql('SELECT wecom_userid FROM users WHERE id = ?')
            user = conn.execute(sql_u, (user_id,)).fetchone()
            if user and user['wecom_userid'] and user['wecom_userid'] != wecom_userid:
                 return {"success": False, "message": f"您的账号已绑定了其他企微ID ({user['wecom_userid']})，请先解绑或联系管理员"}

            # 3. 执行绑定
            sql_up = DatabasePool.format_sql('UPDATE users SET wecom_userid = ? WHERE id = ?')
            conn.execute(sql_up, (wecom_userid, user_id))
            conn.commit()
            
            # 绑定后，如果该用户已有项目，同步到 project_members
            sql_p = DatabasePool.format_sql('SELECT project_id FROM project_user_access WHERE user_id = ?')
            projects = conn.execute(sql_p, (user_id,)).fetchall()
            for p in projects:
                self.sync_user_to_project_member(user_id, p['project_id'])
                
            return {"success": True, "message": "绑定成功"}

    def __init__(self):
        self._role_cache = None
        self._role_cache_loaded_at = None
        self._ensure_tables()
    
    def _ensure_tables(self):
        """确保用户表存在"""
        from app_config import DB_CONFIG
        db_type = DB_CONFIG.get('TYPE', 'sqlite')
        with DatabasePool.get_connection() as conn:
            PK_AUTO = "SERIAL PRIMARY KEY" if db_type == 'postgres' else "INTEGER PRIMARY KEY AUTOINCREMENT"
            TIMESTAMP_TYPE = "TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP" if db_type == 'postgres' else "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
            
            # 用户表
            conn.execute(f'''
                CREATE TABLE IF NOT EXISTS users (
                    id {PK_AUTO},
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    email TEXT,
                    display_name TEXT,
                    role TEXT DEFAULT 'team_member',
                    is_active BOOLEAN DEFAULT {'TRUE' if db_type == 'postgres' else '1'},
                    last_login TIMESTAMP,
                    created_at {TIMESTAMP_TYPE}
                )
            ''')
            # 升级脚本：增加 WeCom 关联
            try:
                db_type = DB_CONFIG.get('TYPE', 'sqlite')
                if db_type == 'postgres':
                    conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS wecom_userid TEXT UNIQUE")
                else:
                    conn.execute("ALTER TABLE users ADD COLUMN wecom_userid TEXT UNIQUE")
            except:
                pass
            # Token表
            conn.execute(f'''
                CREATE TABLE IF NOT EXISTS user_tokens (
                    id {PK_AUTO},
                    user_id INTEGER,
                    token TEXT UNIQUE NOT NULL,
                    expires_at TIMESTAMP,
                    created_at {TIMESTAMP_TYPE},
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
            ''')
            
            # 项目成员表 - 关联项目和用户
            conn.execute(f'''
                CREATE TABLE IF NOT EXISTS project_user_access (
                    id {PK_AUTO},
                    project_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    role TEXT DEFAULT 'member',
                    created_at {TIMESTAMP_TYPE},
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    UNIQUE(project_id, user_id)
                )
            ''')
            
            conn.commit()
            
            # 检查是否需要创建默认管理员
            sql_adm = DatabasePool.format_sql('SELECT id FROM users WHERE username = ?')
            admin = conn.execute(sql_adm, ('admin',)).fetchone()
            if not admin:
                self.register('admin', 'admin123', 'admin@local', '系统管理员', 'admin')
    
    def _hash_password(self, password: str) -> str:
        """密码哈希"""
        return hashlib.sha256(password.encode()).hexdigest()
    
    def register(self, username: str, password: str, email: str = None, 
                 display_name: str = None, role: str = 'team_member') -> Dict[str, Any]:
        """用户注册"""
        with DatabasePool.get_connection() as conn:
            # 检查用户名是否存在
            sql_ex = DatabasePool.format_sql('SELECT id FROM users WHERE username = ?')
            existing = conn.execute(sql_ex, (username,)).fetchone()
            if existing:
                return {"success": False, "message": "用户名已存在"}
            
            # 验证角色
            role_definitions = self.get_role_definitions()
            if role not in role_definitions:
                role = 'team_member' if 'team_member' in role_definitions else next(iter(role_definitions.keys()), 'team_member')
            
            password_hash = self._hash_password(password)
            
            try:
                sql_reg = DatabasePool.format_sql('''
                    INSERT INTO users (username, password_hash, email, display_name, role)
                    VALUES (?, ?, ?, ?, ?)
                ''')
                conn.execute(sql_reg, (username, password_hash, email, display_name or username, role))
                conn.commit()
                return {"success": True, "message": "注册成功"}
            except Exception as e:
                return {"success": False, "message": str(e)}
    
    def login(self, username: str, password: str) -> Dict[str, Any]:
        """用户登录"""
        with DatabasePool.get_connection() as conn:
            password_hash = self._hash_password(password)
            
            sql_user = DatabasePool.format_sql('''
                SELECT id, username, display_name, role, is_active, wecom_userid
                FROM users WHERE username = ? AND password_hash = ?
            ''')
            user = conn.execute(sql_user, (username, password_hash)).fetchone()
            
            if not user:
                return {"success": False, "message": "用户名或密码错误"}
            
            if not user['is_active']:
                return {"success": False, "message": "账号已被禁用"}
            
            # 生成Token
            token = secrets.token_urlsafe(32)
            expires_at = (datetime.now() + timedelta(hours=self.TOKEN_EXPIRY_HOURS)).strftime('%Y-%m-%d %H:%M:%S')
            
            sql_token = DatabasePool.format_sql('''
                INSERT INTO user_tokens (user_id, token, expires_at)
                VALUES (?, ?, ?)
            ''')
            conn.execute(sql_token, (user['id'], token, expires_at))
            
            # 更新最后登录时间
            sql_upd = DatabasePool.format_sql('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?')
            conn.execute(sql_upd, (user['id'],))
            conn.commit()
            
            return {
                "success": True,
                "token": token,
                "user": self._build_user_payload(
                    user['id'],
                    user['username'],
                    user['display_name'],
                    user['role'],
                    user['wecom_userid']
                )
            }
    
    def logout(self, token: str) -> Dict[str, Any]:
        """用户登出"""
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('DELETE FROM user_tokens WHERE token = ?')
            conn.execute(sql, (token,))
            conn.commit()
            return {"success": True, "message": "已登出"}
    
    def validate_token(self, token: str) -> Optional[Dict]:
        """验证Token并返回用户信息"""
        if not token:
            return None
        
        with DatabasePool.get_connection() as conn:
            active_flag = True if DatabasePool.is_postgres() else 1
            sql = DatabasePool.format_sql('''
                SELECT u.id, u.username, u.display_name, u.role, u.wecom_userid, t.expires_at
                FROM user_tokens t
                JOIN users u ON t.user_id = u.id
                WHERE t.token = ? AND u.is_active = ?
            ''')
            result = conn.execute(sql, (token, active_flag)).fetchone()
            
            if not result:
                return None
            
            # 检查是否过期
            expires_str = result['expires_at'].strftime('%Y-%m-%d %H:%M:%S') if isinstance(result['expires_at'], datetime) else str(result['expires_at'])
            if expires_str < datetime.now().strftime('%Y-%m-%d %H:%M:%S'):
                sql_del = DatabasePool.format_sql('DELETE FROM user_tokens WHERE token = ?')
                conn.execute(sql_del, (token,))
                conn.commit()
                return None
            
            return {
                "id": result['id'],
                "username": result['username'],
                "display_name": result['display_name'],
                "role": result['role'],
                "wecom_userid": result['wecom_userid'],
                "permissions": self.get_role_definitions().get(result['role'], {}).get('permissions', [])
            }
    
    def check_permission(self, user: Dict, permission: str) -> bool:
        """检查用户是否有指定权限"""
        if not user:
            return False
        permissions = user.get('permissions', [])
        return '*' in permissions or permission in permissions
    
    def get_all_users(self) -> list:
        """获取所有用户列表（管理员用）"""
        with DatabasePool.get_connection() as conn:
            users = conn.execute(DatabasePool.format_sql('''
                SELECT id, username, email, display_name, role, is_active, last_login, created_at
                FROM users ORDER BY created_at DESC
            ''')).fetchall()
            return [dict(u) for u in users]

    def get_user_by_id(self, user_id: int) -> Optional[Dict[str, Any]]:
        """按 ID 获取用户详情"""
        with DatabasePool.get_connection() as conn:
            user = conn.execute(DatabasePool.format_sql('''
                SELECT id, username, email, display_name, role, is_active, last_login, created_at, wecom_userid
                FROM users WHERE id = ?
            '''), (user_id,)).fetchone()
            return dict(user) if user else None
    
    def update_user_role(self, user_id: int, new_role: str) -> Dict[str, Any]:
        """更新用户角色"""
        if new_role not in self.get_role_definitions():
            return {"success": False, "message": "无效的角色"}
        
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('UPDATE users SET role = ? WHERE id = ?')
            conn.execute(sql, (new_role, user_id))
            conn.commit()
            return {"success": True, "message": "角色已更新"}

    def update_user_status(self, user_id: int, is_active: bool) -> Dict[str, Any]:
        """更新用户状态（启用/禁用）"""
        with DatabasePool.get_connection() as conn:
            sql_up = DatabasePool.format_sql('UPDATE users SET is_active = ? WHERE id = ?')
            conn.execute(sql_up, (is_active, user_id))
            
            # 如果禁用，清除所有Token
            if not is_active:
                sql_del = DatabasePool.format_sql('DELETE FROM user_tokens WHERE user_id = ?')
                conn.execute(sql_del, (user_id,))
                
            conn.commit()
            return {"success": True, "message": "状态已更新"}
    
    def reset_user_password(self, user_id: int, new_password: str) -> Dict[str, Any]:
        """重置用户密码"""
        password_hash = self._hash_password(new_password)
        with DatabasePool.get_connection() as conn:
            sql_up = DatabasePool.format_sql('UPDATE users SET password_hash = ? WHERE id = ?')
            conn.execute(sql_up, (password_hash, user_id))
            # 清除所有登录态
            sql_del = DatabasePool.format_sql('DELETE FROM user_tokens WHERE user_id = ?')
            conn.execute(sql_del, (user_id,))
            conn.commit()
            return {"success": True, "message": "密码已重置"}
    
    # ========== 项目成员管理 ==========
    
    def add_project_member(self, project_id: int, user_id: int, role: str = 'member') -> Dict[str, Any]:
        """添加项目成员"""
        if role not in ['owner', 'manager', 'member', 'viewer']:
            role = 'member'
        with DatabasePool.get_connection() as conn:
            try:
                conn.execute(DatabasePool.format_sql('''
                    INSERT INTO project_user_access (project_id, user_id, role)
                    VALUES (?, ?, ?)
                    ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role
                '''), (project_id, user_id, role))
                conn.commit()
                
                # 同步到 project_members 表
                self.sync_user_to_project_member(user_id, project_id)
                
                return {"success": True}
            except Exception as e:
                return {"success": False, "message": str(e)}
    
    def remove_project_member(self, project_id: int, user_id: int) -> Dict[str, Any]:
        """移除项目成员"""
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('DELETE FROM project_user_access WHERE project_id = ? AND user_id = ?')
            conn.execute(sql, (project_id, user_id))
            conn.commit()
            return {"success": True}
    
    def get_project_members(self, project_id: int) -> list:
        """获取项目所有成员"""
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('''
                SELECT pm.*, u.username, u.display_name, u.email
                FROM project_user_access pm
                JOIN users u ON pm.user_id = u.id
                WHERE pm.project_id = ?
            ''')
            members = conn.execute(sql, (project_id,)).fetchall()
            return [dict(m) for m in members]
    
    def get_user_projects(self, user_id: int) -> list:
        """获取用户可访问的项目ID列表"""
        with DatabasePool.get_connection() as conn:
            # 检查是否是管理员
            sql_u = DatabasePool.format_sql('SELECT role FROM users WHERE id = ?')
            user = conn.execute(sql_u, (user_id,)).fetchone()
            if user and user['role'] == 'admin':
                return None  # None 表示可以访问所有项目
            
            # 普通用户返回已分配的项目
            sql_p = DatabasePool.format_sql('''
                SELECT project_id FROM project_user_access WHERE user_id = ?
            ''')
            projects = conn.execute(sql_p, (user_id,)).fetchall()
            return [p['project_id'] for p in projects]
    
    def can_access_project(self, user_id: int, project_id: int) -> bool:
        """检查用户是否有权访问项目"""
        with DatabasePool.get_connection() as conn:
            # 管理员可以访问所有项目
            sql_u = DatabasePool.format_sql('SELECT role FROM users WHERE id = ?')
            user = conn.execute(sql_u, (user_id,)).fetchone()
            if user and user['role'] == 'admin':
                return True
            # 检查是否是项目成员
            sql_m = DatabasePool.format_sql('''
                SELECT id FROM project_user_access WHERE project_id = ? AND user_id = ?
            ''')
            member = conn.execute(sql_m, (project_id, user_id)).fetchone()
            return member is not None
    
    def get_project_role(self, user_id: int, project_id: int) -> Optional[str]:
        """获取用户在项目中的角色"""
        with DatabasePool.get_connection() as conn:
            sql = DatabasePool.format_sql('''
                SELECT role FROM project_user_access WHERE project_id = ? AND user_id = ?
            ''')
            member = conn.execute(sql, (project_id, user_id)).fetchone()
            return member['role'] if member else None
    
    def migrate_existing_projects(self):
        """将现有项目分配给管理员"""
        with DatabasePool.get_connection() as conn:
            sql_u = DatabasePool.format_sql('SELECT id FROM users WHERE username = ?')
            admin = conn.execute(sql_u, ('admin',)).fetchone()
            if not admin:
                return {"success": False, "message": "管理员用户不存在"}
            
            # 获取所有项目
            projects = conn.execute(DatabasePool.format_sql('SELECT id FROM projects')).fetchall()
            for p in projects:
                # 检查是否已有成员
                sql_m = DatabasePool.format_sql('''
                    SELECT id FROM project_user_access WHERE project_id = ?
                ''')
                existing = conn.execute(sql_m, (p['id'],)).fetchone()
                if not existing:
                    conn.execute(DatabasePool.format_sql('''
                        INSERT INTO project_user_access (project_id, user_id, role)
                        VALUES (?, ?, 'owner')
                        ON CONFLICT (project_id, user_id) DO NOTHING
                    '''), (p['id'], admin['id']))
            conn.commit()
            return {"success": True, "message": f"已迁移 {len(projects)} 个项目"}


# 全局实例
auth_service = AuthService()


def require_auth(permission: str = None):
    """认证装饰器"""
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            token = request.headers.get('Authorization', '').replace('Bearer ', '')
            if not token:
                token = request.cookies.get('auth_token')
            
            user = auth_service.validate_token(token)
            if not user:
                return jsonify({"success": False, "message": "请先登录", "code": 401}), 401
            
            if permission and not auth_service.check_permission(user, permission):
                return jsonify({"success": False, "message": "权限不足", "code": 403}), 403
            
            # 将用户信息注入到请求上下文
            request.current_user = user
            return f(*args, **kwargs)
        return wrapper
    return decorator
