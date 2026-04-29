// Desktop bootstrap wiring extracted from main.js.

function hideAllViews() {
    [
        'dashboardView',
        'healthDashboard',
        'projectDetailView',
        'mapView',
        'resourceView',
        'businessView',
        'financialView',
        'analyticsView',
        'approvalView',
        'kbView',
        'assetView',
        'formGeneratorView',
        'emptyState'
    ].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
}

function showActionInbox() {
    const html = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;">
            <button class="btn btn-outline" style="padding:18px;text-align:left;border-radius:16px;" onclick="closeGenericModal();showWarningCenter();">
                <div style="font-size:24px;margin-bottom:8px;">⚠️</div>
                <div style="font-weight:800;">预警</div>
            </button>
            <button class="btn btn-outline" style="padding:18px;text-align:left;border-radius:16px;" onclick="closeGenericModal();showReminderCenter();">
                <div style="font-size:24px;margin-bottom:8px;">🔔</div>
                <div style="font-weight:800;">提醒</div>
            </button>
            <button class="btn btn-outline" style="padding:18px;text-align:left;border-radius:16px;" onclick="closeGenericModal();showApprovalCenter();">
                <div style="font-size:24px;margin-bottom:8px;">📋</div>
                <div style="font-weight:800;">审批</div>
            </button>
        </div>
    `;
    showGenericModal('行动收件箱', html);
}

function showAiWorkbench() {
    const html = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;">
            <button class="btn btn-outline" style="padding:16px;text-align:left;border-radius:16px;" onclick="closeGenericModal();showAskAiModal();">🔮 项目数据问答</button>
            <button class="btn btn-outline" style="padding:16px;text-align:left;border-radius:16px;" onclick="closeGenericModal();openDashboardBriefingModal();">📋 AI 决策简报</button>
            <button class="btn btn-outline" style="padding:16px;text-align:left;border-radius:16px;" onclick="closeGenericModal();showActionInbox();">🧭 行动建议</button>
            <button class="btn btn-outline" style="padding:16px;text-align:left;border-radius:16px;" onclick="closeGenericModal();window.location.href='/alignment';">🧩 接口 AI 助手</button>
        </div>
    `;
    showGenericModal('AI 工作台', html);
}

function showConfigCenter() {
    const html = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;">
            <button class="btn btn-outline" style="padding:16px;text-align:left;border-radius:16px;" onclick="closeGenericModal();adminSettings.open();">🛠️ 系统设置<br><span style="font-size:12px;color:#64748b;">AI、企微、权限、地图、存储</span></button>
            <button class="btn btn-outline" style="padding:16px;text-align:left;border-radius:16px;" onclick="closeGenericModal();showWecomConfigPanel();">📤 企微推送配置<br><span style="font-size:12px;color:#64748b;">日报、提醒、审批推送</span></button>
            <button class="btn btn-outline" style="padding:16px;text-align:left;border-radius:16px;" onclick="closeGenericModal();showAiOpsHistory();">🕘 AI 操作历史<br><span style="font-size:12px;color:#64748b;">查看 AI 操作记录</span></button>
        </div>
    `;
    showGenericModal('配置中心', html);
}

function ensureAiHealthPolling() {
    updateAiHealthUI();
    if (window.__aiHealthTimer) return;
    window.__aiHealthTimer = setInterval(updateAiHealthUI, 60000);
}

window.openRoleHome = async function (options = {}) {
    if (!currentUser) return;

    if (typeof window.showGlobalDashboardHome === 'function') {
        await window.showGlobalDashboardHome();
    }
};

window.initializeAuthenticatedShell = function (options = {}) {
    if (!currentUser) return;

    loadUnreadCount();
    loadReminderBadge();
    loadWarningCount();
    ensureAiHealthPolling();

    if (options.triggerReminderCheck) {
        checkReminders({ silent: true });
    }

    if (options.openDefaultHome) {
        window.openRoleHome({ forceDashboard: !!options.forceDashboard });
    }
};

function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`脚本加载失败: ${src}`));
        document.body.appendChild(script);
    });
}

window.pollTask = async function pollTask(taskId, loadingId, contentId, reportType, onSuccess) {
    const loadingEl = loadingId ? document.getElementById(loadingId) : null;
    const contentEl = contentId ? document.getElementById(contentId) : null;
    const startedAt = Date.now();
    const timeoutMs = 5 * 60 * 1000;
    const intervalMs = 1500;

    async function checkOnce() {
        const task = await api.get(`/tasks/${taskId}`, { silent: true });
        const status = task?.status || 'unknown';

        if (status === 'completed') {
            if (loadingEl) loadingEl.style.display = 'none';
            if (contentEl) contentEl.style.display = 'block';
            if (typeof onSuccess === 'function') {
                onSuccess(task.result || '', task);
            }
            return task;
        }

        if (status === 'failed' || status === 'cancelled') {
            if (loadingEl) loadingEl.style.display = 'none';
            if (contentEl) {
                contentEl.style.display = 'block';
                contentEl.innerHTML = `<div style="padding:16px;border-radius:12px;background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;">${task.error || '任务执行失败'}</div>`;
            }
            throw new Error(task.error || '任务执行失败');
        }

        if (Date.now() - startedAt > timeoutMs) {
            if (loadingEl) loadingEl.style.display = 'none';
            if (contentEl) {
                contentEl.style.display = 'block';
                contentEl.innerHTML = '<div style="padding:16px;border-radius:12px;background:#fff7ed;border:1px solid #fed7aa;color:#c2410c;">任务仍在处理中，请稍后在任务中心查看结果。</div>';
            }
            throw new Error('任务轮询超时');
        }

        return null;
    }

    while (true) {
        const completedTask = await checkOnce();
        if (completedTask) return completedTask;
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
};

async function loadReminderBadge() {
    const badge = document.getElementById('reminderBadge');
    if (!badge) return;
    try {
        const digest = await api.get('/reminders/digest', { silent: true });
        const total = Number(digest?.overdue_count || 0) + Number(digest?.upcoming_count || 0);
        if (total > 0) {
            badge.textContent = total;
            badge.style.display = 'inline';
        } else {
            badge.style.display = 'none';
        }
    } catch (e) {
        badge.style.display = 'none';
    }
}

async function loadSimilarProjects(projectId) {
    const container = document.getElementById('similarProjectsContent');
    if (!container) return;
    container.innerHTML = '<div class="loading-spinner"></div>';
    try {
        const projects = await api.get(`/projects/${projectId}/similar`, { silent: true });
        if (!projects || !projects.length) {
            container.innerHTML = '<div class="empty-state"><p>暂无相似项目</p></div>';
            return;
        }
        container.innerHTML = projects.map(item => `
            <div style="padding:12px 14px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;margin-bottom:10px;cursor:pointer;" onclick="loadProjectDetail(${item.id})">
                <div style="font-weight:700;color:#111827;">${item.project_name || '未命名项目'}</div>
                <div style="font-size:12px;color:#64748b;margin-top:4px;">${item.hospital_name || '-'}</div>
            </div>
        `).join('');
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><p>加载相似项目失败</p><div class="empty-state-hint">${e.message}</div></div>`;
    }
}

async function loadRecommendedActions(projectId, isRefresh = false) {
    const container = document.getElementById('recommendedActionsContent');
    if (!container) return;
    container.innerHTML = '<div style="color:#94a3b8; font-size:12px; text-align:center; padding:10px;">AI 正在生成行动建议...</div>';
    try {
        const actions = await api.get(`/projects/${projectId}/recommended-actions${isRefresh ? '?refresh=1' : ''}`, { silent: true });
        if (!actions || !actions.length) {
            container.innerHTML = '<div style="color:#94a3b8; font-size:12px; text-align:center; padding:10px;">暂无紧急行动建议</div>';
            return;
        }
        container.innerHTML = actions.map(item => `
            <div style="padding:12px 14px;border-radius:10px;background:#fff;border:1px solid #e5e7eb;margin-bottom:10px;">
                <div style="font-weight:700;color:#111827;margin-bottom:6px;">${item.title || item.action || '行动建议'}</div>
                <div style="font-size:13px;color:#374151;line-height:1.7;">${item.description || item.reason || ''}</div>
            </div>
        `).join('');
    } catch (e) {
        container.innerHTML = `<div style="color:#ef4444; font-size:12px; text-align:center; padding:10px;">行动建议加载失败: ${e.message}</div>`;
    }
}

async function checkMilestoneCelebrations(projectId) {
    try {
        const milestones = await api.get(`/projects/${projectId}/milestones/pending-celebrations`, { silent: true });
        if (!milestones || !milestones.length) return;
        const first = milestones[0];
        const title = document.getElementById('celebrationTitle');
        const msg = document.getElementById('celebrationMsg');
        if (title) title.textContent = '里程碑达成！';
        if (msg) msg.textContent = `项目「${first.project_name || ''}」已完成里程碑：${first.name || first.milestone_name || '未命名里程碑'}`;
        openModal('celebrationModal');
    } catch (e) {
        // 静默失败，避免影响主流程
    }
}

function toggleSidebar(forceOpen = null) {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (!sidebar || !overlay) return;
    const shouldOpen = forceOpen === null ? !sidebar.classList.contains('open') : !!forceOpen;
    sidebar.classList.toggle('open', shouldOpen);
    overlay.classList.toggle('show', shouldOpen);
}

function showAddProjectModal() {
    const title = document.getElementById('projectModalTitle');
    if (title) title.textContent = '新建项目';
    const form = document.getElementById('projectForm');
    if (form) form.reset();
    openModal('projectModal');
}

function getSidebarRoleHome() {
    if (typeof window.getDesktopHomeRole === 'function') {
        return window.getDesktopHomeRole();
    }
    const role = String(currentUser?.role || '').toLowerCase();
    if (role === 'admin') return 'admin';
    if (role === 'project_manager' || role === 'pm' || role === 'manager' || role === 'pmo') return 'pm';
    return 'delivery';
}

function rankProjectsForRole(projects) {
    const roleHome = getSidebarRoleHome();
    const currentDisplayName = String(currentUser?.display_name || currentUser?.username || '').trim();
    const list = Array.isArray(projects) ? [...projects] : [];
    const statusPriority = {
        '进行中': 5,
        '试运行': 4,
        '验收中': 3,
        '暂停': 2,
        '离场待返': 1
    };

    return list.sort((a, b) => {
        const progressA = Number(a.progress || 0);
        const progressB = Number(b.progress || 0);
        const riskA = Number(a.risk_score || 0);
        const riskB = Number(b.risk_score || 0);
        const overdueA = Number(a.overdue_count || 0);
        const overdueB = Number(b.overdue_count || 0);
        const statusA = statusPriority[a.status] || 0;
        const statusB = statusPriority[b.status] || 0;

        if (roleHome === 'pm') {
            const mineA = currentDisplayName && String(a.project_manager || '').trim() === currentDisplayName ? 1 : 0;
            const mineB = currentDisplayName && String(b.project_manager || '').trim() === currentDisplayName ? 1 : 0;
            if (mineA !== mineB) return mineB - mineA;
            if (overdueA !== overdueB) return overdueB - overdueA;
            if (riskA !== riskB) return riskB - riskA;
            if (statusA !== statusB) return statusB - statusA;
            return progressB - progressA;
        }

        if (roleHome === 'delivery') {
            if (statusA !== statusB) return statusB - statusA;
            if (riskA !== riskB) return riskB - riskA;
            if (overdueA !== overdueB) return overdueB - overdueA;
            return progressB - progressA;
        }

        if (statusA !== statusB) return statusB - statusA;
        if (riskA !== riskB) return riskB - riskA;
        return progressB - progressA;
    });
}

function renderProjectCard(project) {
    const active = Number(currentProjectId) === Number(project.id);
    const progress = Number(project.progress || 0);
    const progressColor = progress >= 100 ? '#10b981' : progress >= 70 ? '#3b82f6' : progress >= 30 ? '#f59e0b' : '#94a3b8';
    const riskScore = Number(project.risk_score || 0);
    const overdueCount = Number(project.overdue_count || 0);
    const metaBadges = [
        overdueCount > 0 ? `<span class="badge" style="background:#fee2e2;color:#b91c1c;">逾期 ${overdueCount}</span>` : '',
        riskScore >= 50 ? `<span class="badge" style="background:#fef2f2;color:#dc2626;">高风险</span>` : riskScore >= 20 ? `<span class="badge" style="background:#fff7ed;color:#d97706;">中风险</span>` : ''
    ].filter(Boolean).join(' ');

    return `
        <div class="project-card ${active ? 'active' : ''} status-${project.status || ''}" onclick="loadProjectDetail(${project.id})">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                <div>
                    <div style="font-weight:700;color:var(--gray-800);margin-bottom:4px;">${project.project_name || '未命名项目'}</div>
                    <div style="font-size:12px;color:var(--gray-500);">${project.hospital_name || '-'}</div>
                </div>
                <span class="badge" style="background:${STATUS_COLORS[project.status] || '#e5e7eb'}20;color:${STATUS_COLORS[project.status] || '#64748b'};">${project.status || '未知'}</span>
            </div>
            <div style="margin-top:10px;font-size:12px;color:var(--gray-500);display:flex;justify-content:space-between;gap:8px;">
                <span>经理：${project.project_manager || '未指定'}</span>
                <span style="color:${progressColor};font-weight:700;">${progress}%</span>
            </div>
            ${metaBadges ? `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">${metaBadges}</div>` : ''}
            <div class="progress-mini" style="margin-top:8px;background:#eef2f7;border-radius:999px;height:6px;overflow:hidden;">
                <div class="progress-mini-bar" style="width:${progress}%;height:100%;background:${progressColor};"></div>
            </div>
        </div>
    `;
}

function getProjectGroupStorageKey(title) {
    return `sidebar_project_group_${getSidebarRoleHome()}_${title}`;
}

function getProjectGroupInitKey() {
    return `sidebar_project_group_init_${getSidebarRoleHome()}`;
}

function ensureDefaultProjectGroupState(groups = []) {
    if (!Array.isArray(groups) || !groups.length) return;
    const initKey = getProjectGroupInitKey();
    if (localStorage.getItem(initKey) === 'true') return;

    groups.forEach((group, index) => {
        if (!group?.title || !group?.projects?.length) return;
        localStorage.setItem(getProjectGroupStorageKey(group.title), String(index === 0));
    });
    localStorage.setItem(initKey, 'true');
}

function isProjectGroupExpanded(title) {
    const raw = localStorage.getItem(getProjectGroupStorageKey(title));
    if (raw === null) return true;
    return raw === 'true';
}

window.toggleProjectGroup = function (title) {
    const expanded = !isProjectGroupExpanded(title);
    localStorage.setItem(getProjectGroupStorageKey(title), String(expanded));
    renderProjectList();
};

window.setAllProjectGroupsExpanded = function (expanded, titles = []) {
    (titles || []).forEach(title => {
        if (!title) return;
        localStorage.setItem(getProjectGroupStorageKey(title), String(!!expanded));
    });
    renderProjectList();
};

window.currentProjectGroupTitles = window.currentProjectGroupTitles || [];

function renderProjectGroup(title, hint, projects) {
    if (!projects || !projects.length) return '';
    const containsActive = projects.some(project => Number(project.id) === Number(currentProjectId));
    const expanded = containsActive ? true : isProjectGroupExpanded(title);
    const safeTitle = String(title).replace(/'/g, "\\'");
    return `
        <div style="margin-bottom:14px;">
            <div onclick="toggleProjectGroup('${safeTitle}')" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${expanded ? '8px' : '0'};padding:8px 10px;border-radius:10px;background:#f8fafc;cursor:pointer;border:1px solid #e2e8f0;">
                <div style="display:flex;align-items:center;gap:8px;min-width:0;">
                    <span style="font-size:12px;color:#64748b;transform:rotate(${expanded ? '90deg' : '0deg'});transition:transform 0.2s;">▸</span>
                    <div style="font-size:12px;font-weight:800;color:#334155;letter-spacing:0.2px;">${title}</div>
                    <span class="badge" style="background:#e2e8f0;color:#475569;">${projects.length}</span>
                </div>
                <div style="font-size:11px;color:#94a3b8;">${hint}</div>
            </div>
            <div style="display:${expanded ? 'flex' : 'none'};flex-direction:column;gap:10px;">
                ${projects.map(renderProjectCard).join('')}
            </div>
        </div>
    `;
}

function renderProjectGroupToolbar(groupTitles = []) {
    const titles = (groupTitles || []).filter(Boolean);
    if (titles.length <= 1) return '';
    window.currentProjectGroupTitles = titles;
    return `
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:10px;">
            <button class="btn btn-outline btn-xs" style="padding:4px 10px;" onclick='setAllProjectGroupsExpanded(true, window.currentProjectGroupTitles)'>全部展开</button>
            <button class="btn btn-outline btn-xs" style="padding:4px 10px;" onclick='setAllProjectGroupsExpanded(false, window.currentProjectGroupTitles)'>全部收起</button>
        </div>
    `;
}

function renderProjectList() {
    const list = document.getElementById('projectList');
    if (!list) return;
    const statusFilter = document.getElementById('statusFilter')?.value || '';
    const projects = rankProjectsForRole(
        (allProjects || []).filter(project => !statusFilter || project.status === statusFilter)
    );
    const roleHome = getSidebarRoleHome();
    const currentDisplayName = String(currentUser?.display_name || currentUser?.username || '').trim();

    if (!projects.length) {
        list.innerHTML = '<div class="empty-state"><p>暂无项目</p><div class="empty-state-hint">可点击“新建”创建项目，或调整左侧状态筛选。</div></div>';
        return;
    }

    if (roleHome === 'pm') {
        const mine = projects.filter(project => currentDisplayName && String(project.project_manager || '').trim() === currentDisplayName);
        const others = projects.filter(project => !(currentDisplayName && String(project.project_manager || '').trim() === currentDisplayName));
        const groupTitles = ['我负责的项目', '其他协同项目'].filter(title => (title === '我负责的项目' ? mine.length : others.length));
        ensureDefaultProjectGroupState([
            { title: '我负责的项目', projects: mine },
            { title: '其他协同项目', projects: others }
        ]);
        list.innerHTML = `
            ${renderProjectGroupToolbar(groupTitles)}
            ${renderProjectGroup('我负责的项目', '优先关注', mine)}
            ${renderProjectGroup('其他协同项目', '同样可进入', others)}
        `;
        return;
    }

    if (roleHome === 'delivery') {
        const activeDelivery = projects.filter(project => ['进行中', '试运行', '验收中'].includes(project.status));
        const others = projects.filter(project => !['进行中', '试运行', '验收中'].includes(project.status));
        const groupTitles = ['当前交付重点', '其他项目'].filter(title => (title === '当前交付重点' ? activeDelivery.length : others.length));
        ensureDefaultProjectGroupState([
            { title: '当前交付重点', projects: activeDelivery },
            { title: '其他项目', projects: others }
        ]);
        list.innerHTML = `
            ${renderProjectGroupToolbar(groupTitles)}
            ${renderProjectGroup('当前交付重点', '现场优先', activeDelivery)}
            ${renderProjectGroup('其他项目', '次级关注', others)}
        `;
        return;
    }

    list.innerHTML = projects.map(renderProjectCard).join('');
}

function filterProjects() {
    renderProjectList();
}

async function loadProjects() {
    const list = document.getElementById('projectList');
    if (list) {
        list.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>加载中...</p></div>';
    }
    try {
        const projects = await api.get('/projects', { silent: true });
        allProjects = Array.isArray(projects) ? projects : [];
        renderProjectList();
    } catch (e) {
        if (list) {
            list.innerHTML = `<div class="empty-state"><p>项目列表加载失败</p><div class="empty-state-hint">${e.message || '请先登录或检查服务状态。'}</div></div>`;
        }
    }
}

async function showKBView() {
    hideAllViews();
    const view = document.getElementById('kbView');
    if (view) view.style.display = 'block';
    if (typeof loadKBList === 'function') {
        await loadKBList();
    }
}

async function showAssetView() {
    hideAllViews();
    const view = document.getElementById('assetView');
    if (view) view.style.display = 'block';
    if (typeof loadAssets !== 'function') {
        await loadScriptOnce('/api/force_static/js/asset_management.js?v=1');
    }
    if (typeof initAssets === 'function') {
        initAssets();
    } else if (typeof loadAssets === 'function') {
        loadAssets();
    }
}

async function showPerformanceAnalytics() {
    hideAllViews();
    const view = document.getElementById('analyticsView');
    if (view) view.style.display = 'block';
    if (typeof initPerformanceAnalytics !== 'function') {
        await loadScriptOnce('/api/force_static/js/analytics.js?v=3');
    }
    if (typeof initPerformanceAnalytics === 'function') {
        initPerformanceAnalytics();
    }
}

function showFormGeneratorView() {
    hideAllViews();
    const view = document.getElementById('formGeneratorView');
    if (view) view.style.display = 'block';
    if (typeof FormGenerator !== 'undefined' && typeof FormGenerator.init === 'function') {
        FormGenerator.init();
    }
}

function showProjectComparison() {
    const modal = document.getElementById('comparisonModal');
    if (!modal) return;
    openModal('comparisonModal');
    const select = document.getElementById('comparisonProjectIds');
    if (select) {
        select.innerHTML = (allProjects || []).map(project => `<option value="${project.id}">${project.project_name} / ${project.hospital_name || '-'}</option>`).join('');
    }
}

async function submitProjectComparison() {
    const select = document.getElementById('comparisonProjectIds');
    const result = document.getElementById('comparisonResult');
    if (!select || !result) return;
    const projectIds = Array.from(select.selectedOptions || []).map(option => Number(option.value)).filter(Boolean).slice(0, 5);
    if (!projectIds.length) {
        result.innerHTML = '<div class="empty-state"><p>请先选择项目</p></div>';
        return;
    }
    result.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>对比中...</p></div>';
    try {
        const data = await api.post('/analytics/compare', { project_ids: projectIds });
        const projects = data.projects || [];
        const comparison = data.comparison || {};
        result.innerHTML = `
            <div class="panel" style="margin-top:16px;">
                <div class="panel-body">
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px;">
                        <div class="overview-card"><div class="overview-card-title">平均进度</div><div class="overview-card-value">${comparison.average_progress || 0}%</div></div>
                        <div class="overview-card"><div class="overview-card-title">平均任务完成率</div><div class="overview-card-value">${comparison.average_task_completion || 0}%</div></div>
                        <div class="overview-card"><div class="overview-card-title">平均未解决问题</div><div class="overview-card-value">${comparison.average_pending_issues || 0}</div></div>
                    </div>
                    <div class="table-container">
                        <table class="table">
                            <thead><tr><th>项目</th><th>医院</th><th>进度</th><th>任务完成率</th><th>未解决问题</th><th>风险分</th></tr></thead>
                            <tbody>
                                ${projects.map(p => `<tr><td>${p.name}</td><td>${p.hospital}</td><td>${p.progress || 0}%</td><td>${p.task_completion_rate || 0}%</td><td>${p.pending_issues || 0}</td><td>${p.risk_score || 0}</td></tr>`).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    } catch (e) {
        result.innerHTML = `<div class="empty-state"><p>项目对比失败</p><div class="empty-state-hint">${e.message}</div></div>`;
    }
}

async function addProjectAccess() {
    if (!currentProjectId) {
        showToast('请先选择一个项目', 'warning');
        return;
    }
    const userId = document.getElementById('accessUserId')?.value;
    const role = document.getElementById('accessRole')?.value || 'member';
    if (!userId) {
        showToast('请选择用户', 'warning');
        return;
    }
    try {
        await api.post(`/projects/${currentProjectId}/access`, { user_id: Number(userId), role });
        showToast('项目成员授权成功', 'success');
        if (typeof loadProjectAccessList === 'function') {
            await loadProjectAccessList();
        }
    } catch (e) {
        showToast('项目授权失败: ' + e.message, 'danger');
    }
}

async function toggleShare(projectId, enabled) {
    try {
        const result = await api.post(`/projects/${projectId}/share/toggle`, { enabled: !!enabled });
        if (result.share_token) {
            showToast('项目分享已开启', 'success');
            await navigator.clipboard.writeText(`${window.location.origin}/share/${result.share_token}`);
            showToast('分享链接已复制', 'success');
        } else {
            showToast('项目分享已关闭', 'success');
        }
        if (currentProjectId) {
            loadProjectDetail(currentProjectId, true);
        }
    } catch (e) {
        showToast('切换项目分享失败: ' + e.message, 'danger');
    }
}

async function closeCelebration() {
    closeModal('celebrationModal');
    if (!currentProjectId) return;
    try {
        await api.post(`/projects/${currentProjectId}/milestones/clear-celebrations`, {});
    } catch (e) {
        console.warn('清除庆祝状态失败', e);
    }
}

async function submitMilestoneRetro() {
    if (!currentProjectId) {
        closeModal('celebrationModal');
        return;
    }
    const content = document.getElementById('celebrationRetro')?.value?.trim() || '';
    try {
        const pending = await api.get(`/projects/${currentProjectId}/milestones/pending-celebrations`, { silent: true });
        const first = Array.isArray(pending) && pending.length ? pending[0] : null;
        if (first && first.id && content) {
            await api.post(`/projects/milestones/${first.id}/retrospective`, { content });
        }
        await closeCelebration();
        showToast('里程碑复盘已保存', 'success');
    } catch (e) {
        showToast('保存里程碑复盘失败: ' + e.message, 'danger');
    }
}

function submitScale() {
    const modal = document.getElementById('scaleModal');
    const qty = Number(document.getElementById('scaleQuantityInput')?.value || 0);
    if (!qty) {
        showToast('请输入有效数量', 'warning');
        return;
    }
    if (modal) {
        closeModal('scaleModal');
    }
    showToast(`工作量调整已记录：${qty}`, 'success');
}

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    initStarRatings();

    const logDate = document.getElementById('logDate');
    if (logDate) logDate.value = new Date().toISOString().split('T')[0];

    const expenseDate = document.getElementById('expenseDate');
    if (expenseDate) expenseDate.value = new Date().toISOString().split('T')[0];

    const followupDate = document.getElementById('followupDate');
    if (followupDate) followupDate.value = new Date().toISOString().split('T')[0];

    await checkAuth();

    if (currentUser) {
        window.initializeAuthenticatedShell({ triggerReminderCheck: true, openDefaultHome: true });
    } else {
        ensureAiHealthPolling();
    }
});
