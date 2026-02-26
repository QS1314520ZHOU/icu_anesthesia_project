# services/auth_service.py
"""
用户认证服务
提供登录、注册、权限验证等功能
"""

import sqlite3
import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from functools import wraps
from flask import request, jsonify
from database import get_db

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

class AuthService:
    """用户认证服务"""
    
    TOKEN_EXPIRY_HOURS = 24
    # 在 auth_service.py 的 AuthService 类中新增以下方法

    def login_via_wecom(self, wecom_user: dict) -> dict:
        """通过企业微信 OAuth2 登录/自动注册"""
        wecom_userid = wecom_user.get('userid')
        if not wecom_userid:
            return {"success": False, "message": "无效的企业微信用户"}
        
        conn = get_db()
        
        # 1. 查找已绑定的用户
        existing = conn.execute(
            'SELECT id, username, display_name, role, is_active FROM users WHERE wecom_userid = ?',
            (wecom_userid,)
        ).fetchone()
        
        if existing:
            if not existing['is_active']:
                return {"success": False, "message": "账号已被禁用"}
            
            # 生成 Token 并登录
            token = secrets.token_urlsafe(32)
            expires_at = (datetime.now() + timedelta(hours=self.TOKEN_EXPIRY_HOURS)).strftime('%Y-%m-%d %H:%M:%S')
            conn.execute('INSERT INTO user_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
                        (existing['id'], token, expires_at))
            conn.execute('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', (existing['id'],))
            conn.commit()
            
            return {
                "success": True,
                "token": token,
                "user": {
                    "id": existing['id'],
                    "username": existing['username'],
                    "display_name": existing['display_name'],
                    "role": existing['role'],
                    "wecom_userid": wecom_userid
                }
            }
        
        # 2. 尝试按姓名匹配已有用户并绑定
        display_name = wecom_user.get('name', wecom_userid)
        name_match = conn.execute(
            'SELECT id, username, display_name, role FROM users WHERE display_name = ? AND wecom_userid IS NULL',
            (display_name,)
        ).fetchone()
        
        if name_match:
            conn.execute('UPDATE users SET wecom_userid = ? WHERE id = ?', (wecom_userid, name_match['id']))
            conn.commit()
            # 递归调用自己，走已绑定流程
            return self.login_via_wecom(wecom_user)
        
        # 3. 自动注册新用户
        username = f"wx_{wecom_userid}"
        password_hash = self._hash_password(secrets.token_urlsafe(16))  # 随机密码
        
        try:
            conn.execute('''
                INSERT INTO users (username, password_hash, email, display_name, role, wecom_userid)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (username, password_hash, wecom_user.get('email', ''), 
                  display_name, 'team_member', wecom_userid))
            conn.commit()
            
            # 注册后登录
            return self.login_via_wecom(wecom_user)
        except Exception as e:
            return {"success": False, "message": f"自动注册失败: {str(e)}"}

    def bind_wecom(self, user_id: int, wecom_userid: str) -> dict:
        """为现有用户绑定企微ID"""
        conn = get_db()
        # 1. 检查该企微ID是否已被其他用户占用
        existing = conn.execute('SELECT id, display_name FROM users WHERE wecom_userid = ?', (wecom_userid,)).fetchone()
        if existing:
            if existing['id'] == user_id:
                return {"success": True, "message": "已绑定"}
            return {"success": False, "message": f"该企微账号已被用户 {existing['display_name']} 绑定"}
        
        # 2. 检查当前用户是否已经绑定了其他企微ID
        user = conn.execute('SELECT wecom_userid FROM users WHERE id = ?', (user_id,)).fetchone()
        if user and user['wecom_userid'] and user['wecom_userid'] != wecom_userid:
             return {"success": False, "message": f"您的账号已绑定了其他企微ID ({user['wecom_userid']})，请先解绑或联系管理员"}

        # 3. 执行绑定
        conn.execute('UPDATE users SET wecom_userid = ? WHERE id = ?', (wecom_userid, user_id))
        conn.commit()
        return {"success": True, "message": "绑定成功"}

    def __init__(self):
        self._ensure_tables()
    
    def _ensure_tables(self):
        """确保用户表存在"""
        conn = get_db()
        cursor = conn.cursor()
        
        # 用户表
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                email TEXT,
                display_name TEXT,
                role TEXT DEFAULT 'team_member',
                is_active BOOLEAN DEFAULT 1,
                last_login TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        try:
            cursor.execute("ALTER TABLE users ADD COLUMN wecom_userid TEXT UNIQUE")
        except:
            pass
        # Token表
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS user_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                token TEXT UNIQUE NOT NULL,
                expires_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        ''')
        
        # 项目成员表 - 关联项目和用户
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS project_user_access (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                role TEXT DEFAULT 'member',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(project_id, user_id)
            )
        ''')
        
        conn.commit()
        
        # 检查是否需要创建默认管理员
        admin = cursor.execute('SELECT id FROM users WHERE username = ?', ('admin',)).fetchone()
        if not admin:
            self.register('admin', 'admin123', 'admin@local', '系统管理员', 'admin')
    
    def _hash_password(self, password: str) -> str:
        """密码哈希"""
        return hashlib.sha256(password.encode()).hexdigest()
    
    def register(self, username: str, password: str, email: str = None, 
                 display_name: str = None, role: str = 'team_member') -> Dict[str, Any]:
        """用户注册"""
        conn = get_db()
        
        # 检查用户名是否存在
        existing = conn.execute('SELECT id FROM users WHERE username = ?', (username,)).fetchone()
        if existing:
            return {"success": False, "message": "用户名已存在"}
        
        # 验证角色
        if role not in ROLES:
            role = 'team_member'
        
        password_hash = self._hash_password(password)
        
        try:
            conn.execute('''
                INSERT INTO users (username, password_hash, email, display_name, role)
                VALUES (?, ?, ?, ?, ?)
            ''', (username, password_hash, email, display_name or username, role))
            conn.commit()
            return {"success": True, "message": "注册成功"}
        except Exception as e:
            return {"success": False, "message": str(e)}
    
    def login(self, username: str, password: str) -> Dict[str, Any]:
        """用户登录"""
        conn = get_db()
        password_hash = self._hash_password(password)
        
        user = conn.execute('''
            SELECT id, username, display_name, role, is_active, wecom_userid
            FROM users WHERE username = ? AND password_hash = ?
        ''', (username, password_hash)).fetchone()
        
        if not user:
            return {"success": False, "message": "用户名或密码错误"}
        
        if not user['is_active']:
            return {"success": False, "message": "账号已被禁用"}
        
        # 生成Token
        token = secrets.token_urlsafe(32)
        expires_at = (datetime.now() + timedelta(hours=self.TOKEN_EXPIRY_HOURS)).strftime('%Y-%m-%d %H:%M:%S')
        
        conn.execute('''
            INSERT INTO user_tokens (user_id, token, expires_at)
            VALUES (?, ?, ?)
        ''', (user['id'], token, expires_at))
        
        # 更新最后登录时间
        conn.execute('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', (user['id'],))
        conn.commit()
        
        return {
            "success": True,
            "token": token,
            "user": {
                "id": user['id'],
                "username": user['username'],
                "display_name": user['display_name'],
                "role": user['role'],
                "role_name": ROLES.get(user['role'], {}).get('name', '未知'),
                "wecom_userid": user['wecom_userid']
            }
        }
    
    def logout(self, token: str) -> Dict[str, Any]:
        """用户登出"""
        conn = get_db()
        conn.execute('DELETE FROM user_tokens WHERE token = ?', (token,))
        conn.commit()
        return {"success": True, "message": "已登出"}
    
    def validate_token(self, token: str) -> Optional[Dict]:
        """验证Token并返回用户信息"""
        if not token:
            return None
        
        conn = get_db()
        result = conn.execute('''
            SELECT u.id, u.username, u.display_name, u.role, u.wecom_userid, t.expires_at
            FROM user_tokens t
            JOIN users u ON t.user_id = u.id
            WHERE t.token = ? AND u.is_active = 1
        ''', (token,)).fetchone()
        
        if not result:
            return None
        
        # 检查是否过期
        if result['expires_at'] < datetime.now().strftime('%Y-%m-%d %H:%M:%S'):
            conn.execute('DELETE FROM user_tokens WHERE token = ?', (token,))
            conn.commit()
            return None
        
        return {
            "id": result['id'],
            "username": result['username'],
            "display_name": result['display_name'],
            "role": result['role'],
            "wecom_userid": result['wecom_userid'],
            "permissions": ROLES.get(result['role'], {}).get('permissions', [])
        }
    
    def check_permission(self, user: Dict, permission: str) -> bool:
        """检查用户是否有指定权限"""
        if not user:
            return False
        permissions = user.get('permissions', [])
        return '*' in permissions or permission in permissions
    
    def get_all_users(self) -> list:
        """获取所有用户列表（管理员用）"""
        conn = get_db()
        users = conn.execute('''
            SELECT id, username, email, display_name, role, is_active, last_login, created_at
            FROM users ORDER BY created_at DESC
        ''').fetchall()
        return [dict(u) for u in users]
    
    def update_user_role(self, user_id: int, new_role: str) -> Dict[str, Any]:
        """更新用户角色"""
        if new_role not in ROLES:
            return {"success": False, "message": "无效的角色"}
        
        conn = get_db()
        conn.execute('UPDATE users SET role = ? WHERE id = ?', (new_role, user_id))
        conn.commit()
        return {"success": True, "message": "角色已更新"}

    def update_user_status(self, user_id: int, is_active: bool) -> Dict[str, Any]:
        """更新用户状态（启用/禁用）"""
        conn = get_db()
        conn.execute('UPDATE users SET is_active = ? WHERE id = ?', (1 if is_active else 0, user_id))
        
        # 如果禁用，清除所有Token
        if not is_active:
            conn.execute('DELETE FROM user_tokens WHERE user_id = ?', (user_id,))
            
        conn.commit()
        return {"success": True, "message": "状态已更新"}
    
    def reset_user_password(self, user_id: int, new_password: str) -> Dict[str, Any]:
        """重置用户密码"""
        password_hash = self._hash_password(new_password)
        conn = get_db()
        conn.execute('UPDATE users SET password_hash = ? WHERE id = ?', (password_hash, user_id))
        # 清除所有登录态
        conn.execute('DELETE FROM user_tokens WHERE user_id = ?', (user_id,))
        conn.commit()
        return {"success": True, "message": "密码已重置"}
    
    # ========== 项目成员管理 ==========
    
    def add_project_member(self, project_id: int, user_id: int, role: str = 'member') -> Dict[str, Any]:
        """添加项目成员"""
        if role not in ['owner', 'manager', 'member', 'viewer']:
            role = 'member'
        conn = get_db()
        try:
            conn.execute('''
                INSERT OR REPLACE INTO project_user_access (project_id, user_id, role)
                VALUES (?, ?, ?)
            ''', (project_id, user_id, role))
            conn.commit()
            return {"success": True}
        except Exception as e:
            return {"success": False, "message": str(e)}
    
    def remove_project_member(self, project_id: int, user_id: int) -> Dict[str, Any]:
        """移除项目成员"""
        conn = get_db()
        conn.execute('DELETE FROM project_user_access WHERE project_id = ? AND user_id = ?', 
                     (project_id, user_id))
        conn.commit()
        return {"success": True}
    
    def get_project_members(self, project_id: int) -> list:
        """获取项目所有成员"""
        conn = get_db()
        members = conn.execute('''
            SELECT pm.*, u.username, u.display_name, u.email
            FROM project_user_access pm
            JOIN users u ON pm.user_id = u.id
            WHERE pm.project_id = ?
        ''', (project_id,)).fetchall()
        return [dict(m) for m in members]
    
    def get_user_projects(self, user_id: int) -> list:
        """获取用户可访问的项目ID列表"""
        conn = get_db()
        # 检查是否是管理员
        user = conn.execute('SELECT role FROM users WHERE id = ?', (user_id,)).fetchone()
        if user and user['role'] == 'admin':
            return None  # None 表示可以访问所有项目
        
        # 普通用户返回已分配的项目
        projects = conn.execute('''
            SELECT project_id FROM project_user_access WHERE user_id = ?
        ''', (user_id,)).fetchall()
        return [p['project_id'] for p in projects]
    
    def can_access_project(self, user_id: int, project_id: int) -> bool:
        """检查用户是否有权访问项目"""
        conn = get_db()
        # 管理员可以访问所有项目
        user = conn.execute('SELECT role FROM users WHERE id = ?', (user_id,)).fetchone()
        if user and user['role'] == 'admin':
            return True
        # 检查是否是项目成员
        member = conn.execute('''
            SELECT id FROM project_user_access WHERE project_id = ? AND user_id = ?
        ''', (project_id, user_id)).fetchone()
        return member is not None
    
    def get_project_role(self, user_id: int, project_id: int) -> Optional[str]:
        """获取用户在项目中的角色"""
        conn = get_db()
        member = conn.execute('''
            SELECT role FROM project_user_access WHERE project_id = ? AND user_id = ?
        ''', (project_id, user_id)).fetchone()
        return member['role'] if member else None
    
    def migrate_existing_projects(self):
        """将现有项目分配给管理员"""
        conn = get_db()
        admin = conn.execute('SELECT id FROM users WHERE username = ?', ('admin',)).fetchone()
        if not admin:
            return {"success": False, "message": "管理员用户不存在"}
        
        # 获取所有项目
        projects = conn.execute('SELECT id FROM projects').fetchall()
        for p in projects:
            # 检查是否已有成员
            existing = conn.execute('''
                SELECT id FROM project_user_access WHERE project_id = ?
            ''', (p['id'],)).fetchone()
            if not existing:
                conn.execute('''
                    INSERT OR IGNORE INTO project_user_access (project_id, user_id, role)
                    VALUES (?, ?, 'owner')
                ''', (p['id'], admin['id']))
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
