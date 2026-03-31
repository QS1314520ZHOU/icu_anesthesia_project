// Authentication and session helpers extracted from main.js

async function checkAuth() {
    const mainContainer = document.querySelector('.main-container');
    const header = document.querySelector('.header');

    try {
        const userData = await api.get('/auth/me', { silent: true });
        if (userData) {
            currentUser = userData;
            if (mainContainer) mainContainer.style.display = 'flex';
            if (header) header.style.display = 'flex';
            updateUserUI();
            loadProjects();
        } else {
            throw new Error('No user data');
        }
    } catch (e) {
        console.log('[AUTH] Not logged in or session expired');
        currentUser = null;
        if (mainContainer) mainContainer.style.display = 'none';
        showFullPageLogin();
    }
}

function showFullPageLogin() {
    let loginOverlay = document.getElementById('loginOverlay');
    if (!loginOverlay) {
        loginOverlay = document.createElement('div');
        loginOverlay.id = 'loginOverlay';
        loginOverlay.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            display: flex; align-items: center; justify-content: center;
            z-index: 9999;
        `;
        loginOverlay.innerHTML = `
            <div style="background: white; border-radius: 16px; padding: 40px; width: 400px; max-width: 90%; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="font-size: 48px; margin-bottom: 16px;">🏥</div>
                    <h2 style="font-size: 24px; color: var(--gray-800); margin-bottom: 8px;">重症手麻项目管理系统</h2>
                    <p style="color: var(--gray-500); font-size: 14px;">请登录以继续</p>
                </div>
                <div id="overlayLoginForm">
                    <div class="form-group">
                        <label>用户名</label>
                        <input type="text" id="overlayLoginUsername" placeholder="请输入用户名" style="padding: 12px;">
                    </div>
                    <div class="form-group">
                        <label>密码</label>
                        <input type="password" id="overlayLoginPassword" placeholder="请输入密码" style="padding: 12px;" onkeypress="if(event.key==='Enter')doOverlayLogin()">
                    </div>
                </div>
                <div id="overlayLoginError" style="color: var(--danger); margin-bottom: 12px; display: none;"></div>
                <button class="btn btn-primary btn-full" onclick="doOverlayLogin()" style="padding: 14px; font-size: 16px;">登 录</button>
                
                <div style="margin-top: 20px; text-align: center; border-top: 1px solid var(--gray-200); padding-top: 20px;">
                    <div style="color: var(--gray-400); font-size: 13px; margin-bottom: 12px;">
                        ── 或使用企业微信登录 ──
                    </div>
                    <button type="button" onclick="showWecomLogin('overlayWecomContainer', 'overlayLoginForm')" style="width:100%; padding:12px; background:#07C160; color:white; 
                        border:none; border-radius:8px; cursor:pointer; font-size:15px; display: flex; align-items: center; justify-content: center; gap: 8px;">
                        📱 企业微信扫码登录
                    </button>
                    <div id="overlayWecomContainer" style="display:none; margin-top:15px; background: #f9fafb; border-radius: 8px; padding: 10px;"></div>
                </div>

                <p style="text-align: center; margin-top: 16px; color: var(--gray-500); font-size: 13px;">
                    没有账户？<a href="javascript:void(0)" onclick="showRegisterFromOverlay()" style="color: var(--primary);">立即注册</a>
                </p>
            </div>
        `;
        document.body.appendChild(loginOverlay);
    }
    loginOverlay.style.display = 'flex';
}

async function doOverlayLogin() {
    const username = document.getElementById('overlayLoginUsername').value;
    const password = document.getElementById('overlayLoginPassword').value;
    const errorDiv = document.getElementById('overlayLoginError');

    if (!username || !password) {
        errorDiv.textContent = '请输入用户名和密码';
        errorDiv.style.display = 'block';
        return;
    }

    try {
        const userData = await api.post('/auth/login', { username, password }, { silent: true });
        currentUser = userData;

        if (userData && userData.token) {
            localStorage.setItem('token', userData.token);
        }

        const loginOverlay = document.getElementById('loginOverlay');
        if (loginOverlay) loginOverlay.style.display = 'none';
        const mainContainer = document.querySelector('.main-container');
        const header = document.querySelector('.header');
        if (mainContainer) mainContainer.style.display = 'flex';
        if (header) header.style.display = 'flex';
        updateUserUI();
        loadProjects();
    } catch (e) {
        errorDiv.textContent = e.message || '登录失败';
        errorDiv.style.display = 'block';
    }
}

function showRegisterFromOverlay() {
    const overlay = document.getElementById('loginOverlay');
    if (overlay) overlay.style.display = 'none';
    showLoginModal();
    showRegisterForm();
}

function updateUserUI() {
    const loginBtnText = document.getElementById('loginBtnText');
    const adminSettingsBtn = document.getElementById('adminSettingsBtn');

    if (currentUser) {
        if (loginBtnText) loginBtnText.textContent = currentUser.display_name || currentUser.username;
        document.getElementById('userDisplayName').textContent = currentUser.display_name || currentUser.username;
        document.getElementById('userRole').textContent = currentUser.role;
        document.getElementById('userAvatar').textContent = (currentUser.display_name || currentUser.username).charAt(0).toUpperCase();

        const wecomBadge = document.getElementById('wecomStatusBadge');
        const wecomBtn = document.getElementById('wecomBindBtn');
        const wecomTips = document.getElementById('wecomBindTips');

        if (currentUser.wecom_userid) {
            wecomBadge.textContent = '已绑定';
            wecomBadge.className = 'badge badge-success';
            wecomBtn.style.display = 'none';
            wecomTips.textContent = 'UserID: ' + currentUser.wecom_userid;
        } else {
            wecomBadge.textContent = '未绑定';
            wecomBadge.className = 'badge badge-gray';
            wecomBtn.style.display = 'block';
            wecomTips.textContent = '绑定后可接收实时预警';
        }

        if (adminSettingsBtn) {
            adminSettingsBtn.style.display = currentUser.role === 'admin' ? 'block' : 'none';
        }
    } else {
        if (loginBtnText) loginBtnText.textContent = '登录';
        if (adminSettingsBtn) adminSettingsBtn.style.display = 'none';
    }
}

function toggleUserPanel() {
    if (currentUser) {
        const panel = document.getElementById('userInfoPanel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    } else {
        showLoginModal();
    }
}

function showLoginModal() {
    openModal('loginModal');
    showLoginForm();
}

function showLoginForm() {
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
}

function showRegisterForm() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
}

async function doLogin() {
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    const errorDiv = document.getElementById('loginError');

    if (!username || !password) {
        errorDiv.textContent = '请输入用户名和密码';
        errorDiv.style.display = 'block';
        return;
    }

    try {
        const userData = await api.post('/auth/login', { username, password }, { silent: true });
        currentUser = userData;
        updateUserUI();
        closeModal('loginModal');
        window.location.reload();
    } catch (e) {
        errorDiv.textContent = e.message || '登录失败';
        errorDiv.style.display = 'block';
    }
}

async function doRegister() {
    const username = document.getElementById('regUsername').value;
    const password = document.getElementById('regPassword').value;
    const confirmPwd = document.getElementById('regPasswordConfirm').value;
    const displayName = document.getElementById('regDisplayName').value;
    const errorDiv = document.getElementById('regError');

    if (!username || !password) {
        errorDiv.textContent = '请填写用户名和密码';
        errorDiv.style.display = 'block';
        return;
    }
    if (password !== confirmPwd) {
        errorDiv.textContent = '两次密码不一致';
        errorDiv.style.display = 'block';
        return;
    }

    try {
        await api.post('/auth/register', { username, password, display_name: displayName }, { silent: true });
        showToast('注册成功，请登录', 'success');
        showLoginForm();
    } catch (e) {
        errorDiv.textContent = e.message || '注册失败';
        errorDiv.style.display = 'block';
    }
}

async function doLogout() {
    try {
        await api.post('/auth/logout', {}, { silent: true });
    } catch (e) { }
    currentUser = null;
    localStorage.removeItem('token');
    window.location.reload();
}
