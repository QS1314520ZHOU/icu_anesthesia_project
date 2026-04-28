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
                <div style="font-size:12px;color:#64748b;margin-top:6px;">风险、延期、接口滞后等需要关注的异常</div>
            </button>
            <button class="btn btn-outline" style="padding:18px;text-align:left;border-radius:16px;" onclick="closeGenericModal();showReminderCenter();">
                <div style="font-size:24px;margin-bottom:8px;">🔔</div>
                <div style="font-weight:800;">提醒</div>
                <div style="font-size:12px;color:#64748b;margin-top:6px;">里程碑、待跟进、即将到期事项</div>
            </button>
            <button class="btn btn-outline" style="padding:18px;text-align:left;border-radius:16px;" onclick="closeGenericModal();showApprovalCenter();">
                <div style="font-size:24px;margin-bottom:8px;">📋</div>
                <div style="font-weight:800;">审批</div>
                <div style="font-size:12px;color:#64748b;margin-top:6px;">变更、离场、费用等待处理审批</div>
            </button>
        </div>
        <div style="margin-top:14px;padding:12px;border-radius:14px;background:#f8fafc;color:#64748b;font-size:13px;line-height:1.7;">
            这里先作为统一行动收件箱入口，保留现有成熟列表和操作能力，后续可进一步合并成同一张待办表。
        </div>
    `;
    showGenericModal('行动收件箱', html);
}

function showAiWorkbench() {
    const html = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;">
            <button class="btn btn-outline" style="padding:16px;text-align:left;border-radius:16px;" onclick="closeGenericModal();showAskAiModal();">🔮 项目数据问答<br><span style="font-size:12px;color:#64748b;">查项目、问题、接口、日志</span></button>
            <button class="btn btn-outline" style="padding:16px;text-align:left;border-radius:16px;" onclick="closeGenericModal();openDashboardBriefingModal();">📋 AI 决策简报<br><span style="font-size:12px;color:#64748b;">看今日重点和管理建议</span></button>
            <button class="btn btn-outline" style="padding:16px;text-align:left;border-radius:16px;" onclick="closeGenericModal();showActionInbox();">🧭 行动建议<br><span style="font-size:12px;color:#64748b;">从预警/提醒/审批进入</span></button>
            <button class="btn btn-outline" style="padding:16px;text-align:left;border-radius:16px;" onclick="closeGenericModal();window.location.href='/alignment';">🧩 接口 AI 助手<br><span style="font-size:12px;color:#64748b;">问接口、生成报文、对齐字段</span></button>
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

window.initializeAuthenticatedShell = function (options = {}) {
    if (!currentUser) return;

    loadUnreadCount();
    loadReminderBadge();
    loadWarningCount();
    ensureAiHealthPolling();

    if (options.triggerReminderCheck) {
        checkReminders({ silent: true });
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
            container.innerHTML = '<div class="empty-state"><p>暂无相似项目</p><div class="empty-state-hint">当项目特征和交付规模更完整时，系统会推荐更多相似案例。</div></div>';
            return;
        }
        container.innerHTML = projects.map(item => `
            <div style="padding:12px 14px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;margin-bottom:10px;cursor:pointer;" onclick="loadProjectDetail(${item.id})">
                <div style="font-weight:700;color:#111827;">${item.project_name || '未命名项目'}</div>
                <div style="font-size:12px;color:#64748b;margin-top:4px;">${item.hospital_name || '-'}</div>
                <div style="font-size:12px;color:#475569;margin-top:8px;">相似度参考项目，可用于复用经验和风险预判。</div>
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

function renderProjectList() {
    const list = document.getElementById('projectList');
    if (!list) return;
    const statusFilter = document.getElementById('statusFilter')?.value || '';
    const projects = (allProjects || []).filter(project => !statusFilter || project.status === statusFilter);

    if (!projects.length) {
        list.innerHTML = '<div class="empty-state"><p>暂无项目</p><div class="empty-state-hint">可点击“新建”创建项目，或调整左侧状态筛选。</div></div>';
        return;
    }

    list.innerHTML = projects.map(project => {
        const active = Number(currentProjectId) === Number(project.id);
        const progress = Number(project.progress || 0);
        const progressColor = progress >= 100 ? '#10b981' : progress >= 70 ? '#3b82f6' : progress >= 30 ? '#f59e0b' : '#94a3b8';
        return `
            <div class="project-card ${active ? 'active' : ''} status-${project.status || ''}" onclick="loadProjectDetail(${project.id})">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                    <div>
                        <div style="font-weight:700;color:var(--gray-800);margin-bottom:4px;">${project.project_name || '未命名项目'}</div>
                        <div style="font-size:12px;color:var(--gray-500);">${project.hospital_name || '-'}</div>
                    </div>
                    <span class="badge" style="background:${STATUS_COLORS[project.status] || '#e5e7eb'}20;color:${STATUS_COLORS[project.status] || '#64748b'};">${project.status || '未知'}</span>
                </div>
                <div style="margin-top:10px;font-size:12px;color:var(--gray-500);display:flex;justify-content:space-between;">
                    <span>经理：${project.project_manager || '未指定'}</span>
                    <span style="color:${progressColor};font-weight:700;">${progress}%</span>
                </div>
                <div class="progress-mini" style="margin-top:8px;background:#eef2f7;border-radius:999px;height:6px;overflow:hidden;">
                    <div class="progress-mini-bar" style="width:${progress}%;height:100%;background:${progressColor};"></div>
                </div>
            </div>
        `;
    }).join('');
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
        window.initializeAuthenticatedShell({ triggerReminderCheck: true });
    } else {
        ensureAiHealthPolling();
    }
});
