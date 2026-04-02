(function () {
    window.todayFocusScope = window.todayFocusScope || 'global';
    window.approvalTrackingStatusFilter = window.approvalTrackingStatusFilter || '';
    window.approvalTrackingSearch = window.approvalTrackingSearch || '';

    function hydrateDashboardFiltersFromUrl() {
        const params = new URLSearchParams(window.location.search);
        window.todayFocusScope = params.get('today_focus_scope') || window.todayFocusScope || 'global';
    }

    function syncDashboardFiltersToUrl() {
        const params = new URLSearchParams(window.location.search);
        params.delete('today_focus_scope');
        if (window.todayFocusScope && window.todayFocusScope !== 'global') {
            params.set('today_focus_scope', window.todayFocusScope);
        } else {
            params.delete('today_focus_scope');
        }
        const query = params.toString();
        window.history.replaceState({}, '', `${window.location.pathname}${query ? '?' + query : ''}`);
    }

    hydrateDashboardFiltersFromUrl();

    window.renderAdvancedDashboard = async function () {
        syncDashboardFiltersToUrl();
        currentProjectId = null;
        renderProjectList();
        hideAllViews();
        document.getElementById('dashboardView').style.display = 'block';

        api.post('/check-and-create-reminders').catch(console.error);

        const [statsData, briefingData, todayFocusData, financial, resource] = await Promise.all([
            api.get('/dashboard/stats'),
            api.get('/dashboard/global-briefing'),
            api.get(`/dashboard/today-focus?scope=${window.todayFocusScope}`),
            api.get('/financial/overview'),
            api.get('/resources/overview')
        ]);

        document.getElementById('dashboardView').innerHTML = `
            <div class="panel" style="background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%); color: white; border: none; margin-bottom: 20px;">
                <div class="panel-body">
                    <div style="display: flex; align-items: center; gap: 15px;">
                        <div style="font-size: 32px;">🤖</div>
                        <div>
                            <h3 style="margin-bottom: 5px; font-size: 16px;">AI 交付决策简报</h3>
                            <p style="font-size: 14px; opacity: 0.9; line-height: 1.5; white-space: pre-line;">${briefingData.brief}</p>
                        </div>
                    </div>
                </div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:20px;">
                <h2 style="font-size:22px;">📊 项目仪表盘</h2>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="btn btn-outline btn-sm" onclick="copyCurrentViewLink()">复制当前视图链接</button>
                    <button class="btn btn-outline btn-sm" onclick="renderAdvancedDashboard()">刷新首页</button>
                </div>
            </div>

            <div class="dashboard-grid">
                <div class="stat-card">
                    <div class="stat-icon blue">📊</div>
                    <div class="stat-value">${statsData.stats.total_projects}</div>
                    <div class="stat-label">项目总数</div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon red">⏰</div>
                    <div class="stat-value">${statsData.stats.overdue_milestones || 0}</div>
                    <div class="stat-label">逾期里程碑</div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon yellow">⚠️</div>
                    <div class="stat-value">${statsData.stats.delayed}</div>
                    <div class="stat-label">项目延期</div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon pink">🚪</div>
                    <div class="stat-value">${statsData.stats.on_departure}</div>
                    <div class="stat-label">暂停/离场</div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon red">🔥</div>
                    <div class="stat-value">${statsData.stats.critical_issues}</div>
                    <div class="stat-label">高危问题</div>
                </div>
            </div>

            <div class="panel" style="margin-bottom:20px;">
                <div class="panel-header">
                    <div class="panel-title">🧭 驾驶舱入口</div>
                </div>
                <div class="panel-body">
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;">
                            <div onclick="showApprovalCenter()" style="cursor:pointer;padding:16px;border-radius:16px;background:linear-gradient(135deg,#eff6ff,#dbeafe);border:1px solid #bfdbfe;">
                                <div style="font-size:28px;margin-bottom:10px;">📋</div>
                                <div style="font-weight:800;color:#1e3a8a;margin-bottom:6px;">审批中心</div>
                                <div style="font-size:13px;color:#475569;">查看待审批事项、审批单号和状态流转</div>
                            </div>
                        <div onclick="window.open('/tasks-center', '_blank')" style="cursor:pointer;padding:16px;border-radius:16px;background:linear-gradient(135deg,#f5f3ff,#ede9fe);border:1px solid #ddd6fe;">
                            <div style="font-size:28px;margin-bottom:10px;">🗂️</div>
                            <div style="font-weight:800;color:#5b21b6;margin-bottom:6px;">任务中心</div>
                            <div style="font-size:13px;color:#475569;">统一查看后台任务、重试、下载和追踪</div>
                        </div>
                            <div onclick="showResourceOverview()" style="cursor:pointer;padding:16px;border-radius:16px;background:linear-gradient(135deg,#ecfeff,#cffafe);border:1px solid #a5f3fc;">
                                <div style="font-size:28px;margin-bottom:10px;">👥</div>
                                <div style="font-weight:800;color:#155e75;margin-bottom:6px;">资源排班视图</div>
                                <div style="font-size:13px;color:#475569;">查看成员负载、城市分布和建议调配</div>
                            </div>
                            <div onclick="showFinancialOverview()" style="cursor:pointer;padding:16px;border-radius:16px;background:linear-gradient(135deg,#fff7ed,#fed7aa);border:1px solid #fdba74;">
                                <div style="font-size:28px;margin-bottom:10px;">💰</div>
                                <div style="font-weight:800;color:#9a3412;margin-bottom:6px;">经营看板视图</div>
                                <div style="font-size:13px;color:#475569;">查看合同、回款、报销、人力成本与毛利</div>
                            </div>
                        <div onclick="showDeliveryMap()" style="cursor:pointer;padding:16px;border-radius:16px;background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1px solid #bbf7d0;">
                            <div style="font-size:28px;margin-bottom:10px;">🗺️</div>
                            <div style="font-weight:800;color:#166534;margin-bottom:6px;">交付地图</div>
                            <div style="font-size:13px;color:#475569;">查看全国项目与交付人员空间分布</div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="panel" style="margin-bottom:20px;">
                <div class="panel-header">
                    <div class="panel-title">🎯 今日待办驾驶舱</div>
                    <div style="display:flex;gap:8px;align-items:center;">
                        <button class="btn btn-outline btn-sm" onclick="switchTodayFocusScope('global')" style="${window.todayFocusScope === 'global' ? 'background:#eef2ff;border-color:#6366f1;color:#4338ca;' : ''}">全局</button>
                        <button class="btn btn-outline btn-sm" onclick="switchTodayFocusScope('mine')" style="${window.todayFocusScope === 'mine' ? 'background:#ecfeff;border-color:#0891b2;color:#0f766e;' : ''}">我负责的</button>
                        <button class="btn btn-outline btn-sm" onclick="renderAdvancedDashboard()">刷新</button>
                        <button class="btn btn-outline btn-sm" onclick="window.open('/tasks-center', '_blank')">🗂️ 打开任务中心</button>
                    </div>
                </div>
                <div class="panel-body">
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:16px;">
                        <div style="padding:14px;border-radius:12px;background:#eff6ff;cursor:pointer;" onclick="showProjectComparison()"><div style="font-size:24px;font-weight:800;color:#2563eb;">${todayFocusData.summary.active_projects || 0}</div><div style="font-size:12px;color:#64748b;">活跃项目</div></div>
                        <div style="padding:14px;border-radius:12px;background:#ecfdf5;"><div style="font-size:24px;font-weight:800;color:#059669;">${todayFocusData.summary.completed_today || 0}</div><div style="font-size:12px;color:#64748b;">今日完成</div></div>
                        <div style="padding:14px;border-radius:12px;background:#fff7ed;cursor:pointer;" onclick="showApprovalCenter()"><div style="font-size:24px;font-weight:800;color:#ea580c;">${todayFocusData.summary.pending_approvals || 0}</div><div style="font-size:12px;color:#64748b;">待审批</div></div>
                        <div style="padding:14px;border-radius:12px;background:#fef2f2;cursor:pointer;" onclick="showWarningCenter()"><div style="font-size:24px;font-weight:800;color:#dc2626;">${todayFocusData.summary.warning_total || 0}</div><div style="font-size:12px;color:#64748b;">预警总数</div></div>
                        <div style="padding:14px;border-radius:12px;background:#faf5ff;cursor:pointer;" onclick="window.open('/tasks-center?status=processing', '_blank')"><div style="font-size:24px;font-weight:800;color:#7c3aed;">${todayFocusData.summary.processing_tasks || 0}</div><div style="font-size:12px;color:#64748b;">后台任务</div></div>
                        <div style="padding:14px;border-radius:12px;background:#f0fdf4;cursor:pointer;" onclick="toggleHealthDashboard()"><div style="font-size:24px;font-weight:800;color:#15803d;">${todayFocusData.summary.health_score || 0}</div><div style="font-size:12px;color:#64748b;">整体健康度</div></div>
                    </div>
                    ${(todayFocusData.focus_items || []).length > 0 ? todayFocusData.focus_items.map(item => {
                        const color = item.severity === 'urgent' || item.severity === 'high' ? '#dc2626' : item.severity === 'medium' ? '#d97706' : '#2563eb';
                        return `<div style="padding:12px 14px;border-radius:12px;border-left:4px solid ${color};background:white;margin-bottom:10px;box-shadow:0 4px 16px rgba(15,23,42,0.04);cursor:pointer;" onclick='openTodayFocusItem(${JSON.stringify(item).replace(/'/g, "&apos;")})'><div style="font-weight:700;color:#111827;margin-bottom:4px;">${item.title || '-'}</div><div style="font-size:13px;color:#475569;">${item.project || '全局'} ${item.desc ? ' | ' + item.desc : ''}</div></div>`;
                    }).join('') : '<div class="empty-state"><p>今天暂无重点待办</p></div>'}
                </div>
            </div>

            <div class="panel" style="margin-bottom:20px;">
                <div class="panel-header">
                    <div class="panel-title">💰 经营快照</div>
                    <button class="btn btn-outline btn-sm" onclick="showFinancialOverview()">打开经营看板</button>
                </div>
                <div class="panel-body">
                    <div class="dashboard-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">
                        <div class="stat-card"><div class="stat-icon blue">📄</div><div class="stat-value">¥${(((financial.summary || {}).contract_total || 0) / 10000).toFixed(1)}w</div><div class="stat-label">合同总额</div></div>
                        <div class="stat-card"><div class="stat-icon green">💵</div><div class="stat-value">¥${(((financial.summary || {}).collected_total || 0) / 10000).toFixed(1)}w</div><div class="stat-label">已回款</div></div>
                        <div class="stat-card" onclick="openFinancialFocus('uncollected')" style="cursor:pointer;"><div class="stat-icon yellow">⏳</div><div class="stat-value">¥${(((financial.summary || {}).uncollected_total || 0) / 10000).toFixed(1)}w</div><div class="stat-label">未回款</div></div>
                        <div class="stat-card"><div class="stat-icon pink">📈</div><div class="stat-value">¥${(((financial.summary || {}).gross_profit_total || 0) / 10000).toFixed(1)}w</div><div class="stat-label">总毛利</div></div>
                        <div class="stat-card"><div class="stat-icon info">🏷️</div><div class="stat-value">${((financial.summary || {}).gross_margin || 0)}%</div><div class="stat-label">综合毛利率</div></div>
                        <div class="stat-card" onclick="openFinancialFocus('loss')" style="cursor:pointer;"><div class="stat-icon red">⚠️</div><div class="stat-value">${((financial.summary || {}).loss_projects || 0)}</div><div class="stat-label">亏损项目</div></div>
                    </div>
                </div>
            </div>

            <div class="panel" style="margin-bottom:20px;">
                <div class="panel-header">
                    <div class="panel-title">👥 资源快照</div>
                    <button class="btn btn-outline btn-sm" onclick="showResourceOverview()">打开资源排班</button>
                </div>
                <div class="panel-body">
                    <div class="dashboard-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">
                        <div class="stat-card" onclick="showResourceOverview()" style="cursor:pointer;"><div class="stat-icon blue">👤</div><div class="stat-value">${((resource.summary || {}).total_members || 0)}</div><div class="stat-label">成员总数</div></div>
                        <div class="stat-card" onclick="openResourceFocus('high')" style="cursor:pointer;"><div class="stat-icon red">🔥</div><div class="stat-value">${((resource.summary || {}).busy_members || 0)}</div><div class="stat-label">高负载成员</div></div>
                        <div class="stat-card" onclick="openResourceFocus('low')" style="cursor:pointer;"><div class="stat-icon green">🧩</div><div class="stat-value">${((resource.summary || {}).available_members || 0)}</div><div class="stat-label">可调配成员</div></div>
                        <div class="stat-card" onclick="showResourceOverview()" style="cursor:pointer;"><div class="stat-icon info">🗺️</div><div class="stat-value">${((resource.summary || {}).covered_cities || 0)}</div><div class="stat-label">覆盖城市</div></div>
                    </div>
                </div>
            </div>

            <div class="panel">
                <div class="panel-header">
                    <div class="panel-title">📈 项目进度概览</div>
                    <button class="btn btn-outline btn-sm" onclick="checkReminders()">🔄 检查提醒</button>
                </div>
                <div class="panel-body" style="padding:0;">
                    ${statsData.projects_progress.length > 0 ? statsData.projects_progress.map(p => {
                        const progressClass = p.progress < 30 ? 'low' : (p.progress < 70 ? 'medium' : 'high');
                        const riskLevel = p.risk_score >= 50 ? 'high' : (p.risk_score >= 20 ? 'medium' : 'low');
                        const riskText = p.risk_score >= 50 ? '高风险' : (p.risk_score >= 20 ? '中风险' : '稳健');
                        const overdueText = p.overdue_count > 0 ? `<span class="badge badge-danger" style="margin-left:5px;">逾期 ${p.overdue_count}</span>` : '';
                        return `<div class="project-progress-row" onclick="loadProjectDetail(${p.id})"><div class="progress-project-name">${p.project_name} ${overdueText}</div><div class="progress-hospital">${p.hospital_name} <span class="badge risk-${riskLevel}">${riskText}</span></div><div class="progress-bar-container"><div class="progress-bar-track"><div class="progress-bar-fill ${progressClass}" style="width:${p.progress}%"></div></div></div><div class="progress-percent">${p.progress}%</div><div class="progress-status"><span class="badge ${p.phase === '延期' ? 'badge-danger' : p.phase === '离场' ? 'badge-pink' : 'badge-info'}">${p.phase}</span></div></div>`;
                    }).join('') : '<div class="empty-state"><p>暂无进行中的项目</p></div>'}
                </div>
            </div>
            <div class="panel">
                <div class="panel-header"><div class="panel-title">🔔 待处理提醒</div></div>
                <div class="panel-body">
                    ${statsData.upcoming_reminders.length > 0 ? statsData.upcoming_reminders.map(r => `<div class="reminder-item ${r.type}"><div class="reminder-content"><div class="reminder-title">${r.title}</div><div class="reminder-desc">${r.content || ''}</div><div class="reminder-time">${r.project_name || '全局'} | ${r.due_date || '无截止'}</div></div><button class="btn btn-sm btn-outline" onclick="markNotificationRead(${r.id})">已读</button></div>`).join('') : '<div class="empty-state"><p>暂无待处理提醒</p></div>'}
                </div>
            </div>
        `;
    };

    window.switchTodayFocusScope = async function (scope) {
        window.todayFocusScope = scope || 'global';
        await window.renderAdvancedDashboard();
    };

    window.openTodayFocusItem = function (item) {
        if (!item || !item.target_kind) return;
        if (item.target_kind === 'project' && item.project_id) return loadProjectDetail(item.project_id);
        if (item.target_kind === 'approval') {
            window.approvalPendingSearch = item.project_name || item.project || '';
            window.approvalTrackingSearch = item.project_name || item.project || '';
            return showApprovalCenter();
        }
        if (item.target_kind === 'task') {
            const projectParam = item.project_id ? `?project_id=${item.project_id}` : '';
            return window.open(`/tasks-center${projectParam}`, '_blank');
        }
        showReminderCenter();
    };

    window.openFinancialFocus = function (focus) {
        const params = new URLSearchParams(window.location.search);
        if (focus) params.set('financial_focus', focus);
        else params.delete('financial_focus');
        const query = params.toString();
        window.history.replaceState({}, '', `${window.location.pathname}${query ? '?' + query : ''}`);
        showFinancialOverview();
    };

    window.openResourceFocus = function (focus) {
        const params = new URLSearchParams(window.location.search);
        if (focus === 'high') {
            params.set('resource_load', 'high');
        } else if (focus === 'low') {
            params.set('resource_load', 'low');
        } else {
            params.delete('resource_load');
        }
        const query = params.toString();
        window.history.replaceState({}, '', `${window.location.pathname}${query ? '?' + query : ''}`);
        showResourceOverview();
    };

    window.showDashboard = async function () {
        await window.renderAdvancedDashboard();
    };
})();
