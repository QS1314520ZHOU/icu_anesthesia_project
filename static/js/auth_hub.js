// Authentication and session helpers extracted from main.js

function hasPermission(permission) {
    if (!currentUser) return false;
    const permissions = currentUser.permissions || [];
    return permissions.includes('*') || permissions.includes(permission);
}

function getResolvedDesktopHomeRole() {
    if (typeof window.getDesktopHomeRole === 'function') {
        return window.getDesktopHomeRole();
    }
    const role = String(currentUser?.role || '').toLowerCase();
    if (role === 'admin') return 'admin';
    if (role === 'project_manager' || role === 'pm' || role === 'manager' || role === 'pmo') return 'pm';
    return 'delivery';
}

function setElementVisibility(id, visible) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = visible ? '' : 'none';
}

function applyRoleNavigationLayout() {
    if (!currentUser) return;
    const homeRole = getResolvedDesktopHomeRole();

    const isAdmin = homeRole === 'admin';
    const isPm = homeRole === 'pm';
    const isDelivery = homeRole === 'delivery';

    setElementVisibility('headerPmoBtn', isAdmin || isPm);
    setElementVisibility('headerReportBtn', isAdmin || isPm);
    setElementVisibility('headerBriefingBtn', isAdmin || isPm);
    setElementVisibility('headerGanttBtn', isAdmin || isPm);

    setElementVisibility('menuConfigCenterBtn', isAdmin);
    setElementVisibility('menuBusinessBtn', isAdmin);
    setElementVisibility('menuFinancialBtn', isAdmin);
    setElementVisibility('menuWecomConfigBtn', isAdmin);

    setElementVisibility('menuPerformanceBtn', isAdmin);

    setElementVisibility('menuProjectComparisonBtn', isAdmin || isPm || isDelivery);
    setElementVisibility('menuApprovalBtn', isAdmin || isPm || isDelivery);
    setElementVisibility('menuResourceBtn', true);
    setElementVisibility('menuDeliveryMapBtn', true);
    setElementVisibility('menuAlignmentBtn', true);
    setElementVisibility('menuTaskCenterBtn', true);
    setElementVisibility('menuActionInboxBtn', true);
    setElementVisibility('menuAiWorkbenchBtn', true);
    setElementVisibility('menuWarningCenterBtn', true);
    setElementVisibility('menuReminderCenterBtn', true);
    setElementVisibility('menuHealthDashboardBtn', isAdmin || isPm || isDelivery);
    setElementVisibility('menuAssetBtn', isAdmin || isPm);
    setElementVisibility('menuKbBtn', true);
    setElementVisibility('menuFormGeneratorBtn', isAdmin || isPm);

    if (isDelivery) {
        setElementVisibility('menuAssetBtn', false);
        setElementVisibility('menuFormGeneratorBtn', false);
    }

    const dashboardBtnText = document.querySelector('#headerDashboardBtn .btn-text');
    const ganttBtnText = document.querySelector('#headerGanttBtn .btn-text');
    const reportBtnText = document.querySelector('#headerReportBtn .btn-text');
    const pmoBtnText = document.querySelector('#headerPmoBtn .btn-text');
    const briefingBtnText = document.querySelector('#headerBriefingBtn .btn-text');

    if (dashboardBtnText) {
        dashboardBtnText.textContent = isAdmin ? '仪表盘' : isPm ? 'PM 首页' : '我的首页';
    }
    if (ganttBtnText) {
        ganttBtnText.textContent = isAdmin ? '总览' : isPm ? '排期总览' : '项目总览';
    }
    if (reportBtnText) {
        reportBtnText.textContent = '周报';
    }
    if (pmoBtnText) {
        pmoBtnText.textContent = 'PMO 决策舱';
    }
    if (briefingBtnText) {
        briefingBtnText.textContent = isAdmin ? '晨会简报' : '管理简报';
    }

    const sidebarTitle = document.querySelector('.sidebar-header h2');
    if (sidebarTitle) {
        sidebarTitle.textContent = isAdmin ? '项目列表' : isPm ? '我的优先项目' : '交付项目列表';
    }

    const sidebarFilter = document.querySelector('.sidebar-filter');
    if (sidebarFilter) {
        sidebarFilter.title = isAdmin
            ? '全局项目筛选'
            : isPm
                ? '默认优先展示你负责的项目'
                : '默认优先展示当前交付重点项目';
    }
}

function applyPermissionGuards() {
    const guarded = [
        { selector: '#adminSettingsBtn', permission: '*', mode: 'show' },
        { selector: 'button[onclick="showApprovalCenter()"]', permission: 'project:read', mode: 'disable' },
        { selector: 'button[onclick="window.location.href=\'/alignment\'"]', permission: 'project:read', mode: 'disable' },
        { selector: 'button[onclick="showBusinessOverview()"]', permission: 'report:read', mode: 'disable' },
        { selector: 'button[onclick="showFinancialOverview()"]', permission: 'report:read', mode: 'disable' },
        { selector: 'button[onclick="showResourceOverview()"]', permission: 'team:read', mode: 'disable' },
        { selector: 'button[onclick="showDeliveryMap()"]', permission: 'project:read', mode: 'disable' },
        { selector: 'button[onclick="showWarningCenter()"]', permission: 'project:read', mode: 'disable' },
        { selector: 'button[onclick="showReminderCenter()"]', permission: 'project:read', mode: 'disable' },
        { selector: 'button[onclick*="generateWeeklyReport"]', permission: 'report:write', mode: 'disable' },
        { selector: 'button[onclick*="callAiAnalysis"]', permission: 'ai:use', mode: 'disable' }
    ];

    guarded.forEach(item => {
        document.querySelectorAll(item.selector).forEach(el => {
            const allowed = item.permission === '*' ? currentUser?.role === 'admin' : hasPermission(item.permission);
            if (item.mode === 'show') {
                el.style.display = allowed ? '' : 'none';
            } else {
                el.disabled = !allowed;
                el.style.opacity = allowed ? '1' : '0.5';
                el.title = allowed ? '' : '当前账号无权限使用此功能';
            }
        });
    });
}

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
                    <button type="button" onclick="startWecomLogin()" style="width:100%; padding:12px; background:#07C160; color:white;
                        border:none; border-radius:8px; cursor:pointer; font-size:15px; display:flex; align-items:center; justify-content:center; gap:8px;">
                        📱 企业微信扫码登录
                    </button>
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

function initializeAuthenticatedShellAfterLogin() {
    if (typeof window.initializeAuthenticatedShell === 'function') {
        window.initializeAuthenticatedShell({ triggerReminderCheck: true, openDefaultHome: true });
    }
}

function startWecomLogin() {
    window.location.href = '/api/wecom/oauth/login';
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
        initializeAuthenticatedShellAfterLogin();
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
    const userManagementBtn = document.getElementById('userManagementBtn');

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
        if (userManagementBtn) {
            userManagementBtn.style.display = currentUser.role === 'admin' ? 'block' : 'none';
        }
        applyRoleNavigationLayout();
        applyPermissionGuards();
    } else {
        if (loginBtnText) loginBtnText.textContent = '登录';
        if (adminSettingsBtn) adminSettingsBtn.style.display = 'none';
        if (userManagementBtn) userManagementBtn.style.display = 'none';
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

function showWecomLogin() {
    startWecomLogin();
}

function startWecomBind() {
    if (!currentUser) {
        showToast('请先登录后再绑定企业微信', 'warning');
        return;
    }
    const popup = window.open('/api/wecom/oauth/login?redirect_uri=bind', '_blank', 'width=900,height=780');
    if (!popup) {
        showToast('请允许浏览器弹窗后重试企业微信绑定', 'warning');
    }
}

(function checkWecomLoginCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    if (token) {
        localStorage.setItem('token', token);
        window.history.replaceState({}, document.title, '/');
        if (typeof onLoginSuccess === 'function') {
            onLoginSuccess(token);
        } else {
            location.reload();
        }
    }

    const loginError = urlParams.get('login_error');
    if (loginError) {
        showToast('企业微信登录失败: ' + loginError, 'danger', 5000);
        window.history.replaceState({}, document.title, '/');
    }
})();
