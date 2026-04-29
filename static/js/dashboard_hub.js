(function () {
    window.todayFocusScope = window.todayFocusScope || 'global';
    window.approvalTrackingStatusFilter = window.approvalTrackingStatusFilter || '';
    window.approvalTrackingSearch = window.approvalTrackingSearch || '';
    window.healthDashboardVisible = window.healthDashboardVisible || false;
    window.dashboardBriefingVisible = window.dashboardBriefingVisible !== false;

    function hydrateDashboardFiltersFromUrl() {
        const params = new URLSearchParams(window.location.search);
        window.todayFocusScope = params.get('today_focus_scope') || window.todayFocusScope || 'global';
        const healthVisible = localStorage.getItem('health_dashboard_visible');
        if (healthVisible !== null) {
            window.healthDashboardVisible = healthVisible === 'true';
        }
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

    function normalizeDashboardBriefing(payload) {
        if (!payload) {
            return {
                brief: '暂无简报',
                stats: {}
            };
        }

        if (typeof payload === 'string') {
            return {
                brief: payload,
                stats: {}
            };
        }

        return {
            brief: payload.brief || payload.briefing || payload.content || '暂无简报',
            stats: payload.stats || {}
        };
    }

    function getDashboardCacheKey() {
        return `dashboard_cache_v1_${window.todayFocusScope || 'global'}`;
    }

    function readDashboardCache() {
        try {
            const raw = sessionStorage.getItem(getDashboardCacheKey());
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.payload) return null;
            return parsed;
        } catch (e) {
            return null;
        }
    }

    function writeDashboardCache(payload) {
        try {
            sessionStorage.setItem(getDashboardCacheKey(), JSON.stringify({
                savedAt: Date.now(),
                payload
            }));
        } catch (e) {
            // ignore cache failures
        }
    }

    function renderDashboardSkeleton() {
        const view = document.getElementById('dashboardView');
        if (!view) return;
        view.innerHTML = `
            <div class="panel" style="background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%); color: white; border: none; margin-bottom: 20px;">
                <div class="panel-body">
                    <div style="height:68px;border-radius:18px;background:rgba(255,255,255,0.12);"></div>
                </div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:14px;margin-bottom:20px;">
                ${Array.from({ length: 5 }).map(() => '<div class="stat-card" style="height:124px;background:#fff;border:1px solid #e2e8f0;border-radius:18px;"></div>').join('')}
            </div>
            <div class="panel" style="margin-bottom:20px;"><div class="panel-body"><div class="loading-spinner"><div class="spinner"></div><p>正在加载仪表盘...</p></div></div></div>
        `;
    }

    function escapeWorkbenchHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function truncateWorkbenchText(value, max = 180) {
        const text = String(value || '').trim();
        return text.length > max ? `${text.slice(0, max)}...` : text;
    }

    function hoursBetweenWorkbench(dateText) {
        if (!dateText) return null;
        const value = new Date(dateText);
        if (Number.isNaN(value.getTime())) return null;
        return Math.floor((Date.now() - value.getTime()) / (1000 * 60 * 60));
    }

    function getDesktopHomeRole() {
        const rawRole = String(currentUser?.role || '').trim();
        const normalizedRole = rawRole.toLowerCase();
        const permissions = Array.isArray(currentUser?.permissions) ? currentUser.permissions : [];

        if (normalizedRole === 'admin' || permissions.includes('*') || /管理员/.test(rawRole)) {
            return 'admin';
        }

        if (
            ['project_manager', 'pm', 'manager', 'pmo'].includes(normalizedRole)
            || /项目经理|PMO/i.test(rawRole)
        ) {
            return 'pm';
        }

        if (
            ['team_member', 'member', 'delivery_member', 'delivery', 'engineer', 'implementation'].includes(normalizedRole)
            || /交付|实施|驻场|工程/.test(rawRole)
        ) {
            return 'delivery';
        }

        return 'delivery';
    }

    function getDesktopHomeMeta(homeRole) {
        if (homeRole === 'admin') {
            return {
                title: '管理员总览首页',
                icon: '🛠️',
                accent: 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)',
                desc: '聚合全局交付、经营、资源与配置入口，适合系统运营和跨模块统筹。'
            };
        }
        if (homeRole === 'pm') {
            return {
                title: '项目经理首页',
                icon: '🧭',
                accent: 'linear-gradient(135deg, #0f766e 0%, #0f172a 100%)',
                desc: '优先呈现项目推进、审批、风险和 PMO 干预入口，减少从全局经营视角绕行。'
            };
        }
        return {
            title: '交付成员首页',
            icon: '🚚',
            accent: 'linear-gradient(135deg, #0f766e 0%, #155e75 100%)',
            desc: '以执行、待办、资源协同和现场交付入口为主，弱化不常用的经营与后台管理信息。'
        };
    }

    window.getDesktopHomeRole = getDesktopHomeRole;

    function removeWorkbenchCardsByTitles(titles) {
        const titleSet = new Set(titles || []);
        const grid = document.getElementById('dashboardWorkbenchGrid');
        if (!grid || !titleSet.size) return;
        Array.from(grid.children).forEach(card => {
            const cardTitle = card.querySelector('div[style*="font-weight:800"]')?.textContent?.trim();
            if (cardTitle && titleSet.has(cardTitle)) {
                card.remove();
            }
        });
    }

    function prependWorkbenchCards(cards) {
        const grid = document.getElementById('dashboardWorkbenchGrid');
        if (!grid || !Array.isArray(cards) || !cards.length) return;
        const html = cards.join('');
        grid.insertAdjacentHTML('afterbegin', html);
    }

    function updateSummaryCardLabels(homeRole) {
        const labels = Array.from(document.querySelectorAll('#dashboardSummaryGrid .stat-label'));
        const values = Array.from(document.querySelectorAll('#dashboardSummaryGrid .stat-value'));
        if (labels.length < 5 || values.length < 5) return;

        if (homeRole === 'pm') {
            labels[0].textContent = '活跃项目';
            labels[1].textContent = '逾期里程碑';
            labels[2].textContent = '待协调延期';
            labels[3].textContent = '暂停/离场';
            labels[4].textContent = '高危问题';
            return;
        }

        if (homeRole === 'delivery') {
            labels[0].textContent = '参与项目';
            labels[1].textContent = '里程碑风险';
            labels[2].textContent = '现场延期';
            labels[3].textContent = '暂停/离场';
            labels[4].textContent = '现场高危问题';
        }
    }

    function updateSummaryCardMetrics(homeRole, statsData, todayFocusData, resource) {
        const cards = Array.from(document.querySelectorAll('#dashboardSummaryGrid .stat-card'));
        const values = Array.from(document.querySelectorAll('#dashboardSummaryGrid .stat-value'));
        if (cards.length < 5 || values.length < 5) return;

        if (homeRole === 'pm') {
            values[0].textContent = String(todayFocusData.summary.active_projects || 0);
            values[1].textContent = String(statsData.stats.overdue_milestones || 0);
            values[2].textContent = String(statsData.stats.delayed || 0);
            values[3].textContent = String(statsData.stats.on_departure || 0);
            values[4].textContent = String(todayFocusData.summary.warning_total || 0);

            if (cards[0]) cards[0].setAttribute('onclick', 'showProjectComparison()');
            if (cards[1]) cards[1].setAttribute('onclick', 'showProjectComparison()');
            if (cards[2]) cards[2].setAttribute('onclick', 'toggleHealthDashboard()');
            if (cards[3]) cards[3].setAttribute('onclick', 'showProjectComparison()');
            if (cards[4]) cards[4].setAttribute('onclick', 'showWarningCenter()');
            return;
        }

        if (homeRole === 'delivery') {
            values[0].textContent = String(todayFocusData.summary.active_projects || 0);
            values[1].textContent = String(statsData.stats.overdue_milestones || 0);
            values[2].textContent = String(statsData.stats.delayed || 0);
            values[3].textContent = String(resource.summary?.available_members || 0);
            values[4].textContent = String(todayFocusData.summary.warning_total || 0);

            if (cards[0]) cards[0].setAttribute('onclick', 'showProjectComparison()');
            if (cards[1]) cards[1].setAttribute('onclick', 'showReminderCenter()');
            if (cards[2]) cards[2].setAttribute('onclick', 'toggleHealthDashboard()');
            if (cards[3]) cards[3].setAttribute('onclick', 'showResourceOverview()');
            if (cards[4]) cards[4].setAttribute('onclick', 'showWarningCenter()');
        }
    }

    function updateTodayFocusCards(homeRole, todayFocusData, resource) {
        const card1 = document.getElementById('todayFocusCard1');
        const card2 = document.getElementById('todayFocusCard2');
        const card3 = document.getElementById('todayFocusCard3');
        const card4 = document.getElementById('todayFocusCard4');
        const card5 = document.getElementById('todayFocusCard5');
        const card6 = document.getElementById('todayFocusCard6');
        const cards = [card1, card2, card3, card4, card5, card6].filter(Boolean);
        if (cards.length < 6) return;

        const setCard = (card, value, label, onclick) => {
            const valueEl = card.querySelector('.today-focus-value');
            const labelEl = card.querySelector('.today-focus-label');
            if (valueEl) valueEl.textContent = String(value ?? 0);
            if (labelEl) labelEl.textContent = label;
            if (onclick) {
                card.style.cursor = 'pointer';
                card.setAttribute('onclick', onclick);
            } else {
                card.style.cursor = 'default';
                card.removeAttribute('onclick');
            }
        };

        if (homeRole === 'pm') {
            setCard(card1, todayFocusData.summary.active_projects || 0, '我负责项目', 'showProjectComparison()');
            setCard(card2, todayFocusData.summary.pending_approvals || 0, '优先审批', 'showApprovalCenter()');
            setCard(card3, todayFocusData.summary.warning_total || 0, '重点风险', 'showWarningCenter()');
            setCard(card4, resource.summary?.busy_members || 0, '高负载成员', 'showResourceOverview()');
            setCard(card5, todayFocusData.summary.processing_tasks || 0, '后台任务', "window.open('/tasks-center?status=processing', '_blank')");
            setCard(card6, todayFocusData.summary.health_score || 0, '项目健康度', 'toggleHealthDashboard()');
            return;
        }

        if (homeRole === 'delivery') {
            setCard(card1, todayFocusData.summary.active_projects || 0, '参与项目', 'showProjectComparison()');
            setCard(card2, todayFocusData.summary.completed_today || 0, '今日完成', "window.location.href='/tasks-center'");
            setCard(card3, todayFocusData.summary.warning_total || 0, '现场风险', 'showWarningCenter()');
            setCard(card4, resource.summary?.available_members || 0, '可协同资源', 'showResourceOverview()');
            setCard(card5, todayFocusData.summary.processing_tasks || 0, '后台任务', "window.open('/tasks-center?status=processing', '_blank')");
            setCard(card6, todayFocusData.summary.health_score || 0, '交付健康度', 'toggleHealthDashboard()');
        }
    }

    function applyRoleHomeLayout(homeRole) {
        const homeMeta = getDesktopHomeMeta(homeRole);
        const heroPanel = document.getElementById('dashboardHeroPanel');
        const heroIcon = document.getElementById('dashboardHeroIcon');
        const heroTitle = document.getElementById('dashboardHeroTitle');
        const heroDesc = document.getElementById('dashboardHeroDesc');
        const mainTitle = document.getElementById('dashboardMainTitle');
        const todayFocusTitle = document.getElementById('dashboardTodayFocusTitle');
        const globalBtn = document.getElementById('dashboardTodayFocusGlobalBtn');
        const mineBtn = document.getElementById('dashboardTodayFocusMineBtn');
        const businessPanel = document.getElementById('dashboardBusinessPanel');
        const resourceTitle = document.getElementById('dashboardResourceTitle');

        if (heroPanel) heroPanel.style.background = homeMeta.accent;
        if (heroIcon) heroIcon.textContent = homeMeta.icon;
        if (heroTitle) heroTitle.textContent = homeMeta.title;
        if (heroDesc) heroDesc.textContent = homeMeta.desc;

        if (homeRole === 'admin') {
            if (mainTitle) mainTitle.textContent = '📊 全局仪表盘';
            if (todayFocusTitle) todayFocusTitle.textContent = '🎯 今日待办驾驶舱';
            if (globalBtn) globalBtn.textContent = '全局';
            if (mineBtn) mineBtn.textContent = '我负责的';
            if (resourceTitle) resourceTitle.textContent = '👥 资源快照';
            updateSummaryCardLabels(homeRole);
            return;
        }

        if (homeRole === 'pm') {
            if (mainTitle) mainTitle.textContent = '📊 项目经理首页';
            if (todayFocusTitle) todayFocusTitle.textContent = '🎯 项目经理待办驾驶舱';
            if (globalBtn) globalBtn.textContent = '全局协同';
            if (mineBtn) mineBtn.textContent = '我的项目';
            if (resourceTitle) resourceTitle.textContent = '👥 协同资源快照';
            if (businessPanel) businessPanel.style.display = 'none';
            removeWorkbenchCardsByTitles(['经营看板视图', '财务总览视图', '配置中心']);
            prependWorkbenchCards([
                `<div onclick="openPmoDashboard()" style="cursor:pointer;padding:16px;border-radius:16px;background:linear-gradient(135deg,#ecfdf5,#d1fae5);border:1px solid #a7f3d0;">
                    <div style="font-size:28px;margin-bottom:10px;">🧭</div>
                    <div style="font-weight:800;color:#065f46;margin-bottom:6px;">PMO 决策舱</div>
                    <div style="font-size:13px;color:#475569;">查看组合风险、干预动作和 PM 负荷</div>
                </div>`
            ]);
            updateSummaryCardLabels(homeRole);
            return;
        }

        if (mainTitle) mainTitle.textContent = '📊 交付成员首页';
        if (todayFocusTitle) todayFocusTitle.textContent = '🎯 交付执行待办';
        if (globalBtn) globalBtn.textContent = '全局协同';
        if (mineBtn) mineBtn.textContent = '我的任务';
        if (resourceTitle) resourceTitle.textContent = '👥 交付协同资源';
        if (businessPanel) businessPanel.style.display = 'none';
        removeWorkbenchCardsByTitles(['经营看板视图', '财务总览视图', '配置中心']);
        prependWorkbenchCards([
            `<div onclick="showResourceOverview()" style="cursor:pointer;padding:16px;border-radius:16px;background:linear-gradient(135deg,#ecfeff,#cffafe);border:1px solid #a5f3fc;">
                <div style="font-size:28px;margin-bottom:10px;">👥</div>
                <div style="font-weight:800;color:#155e75;margin-bottom:6px;">我的交付资源</div>
                <div style="font-size:13px;color:#475569;">直接进入成员负载、城市分布和调配建议</div>
            </div>`
        ]);
        updateSummaryCardLabels(homeRole);
    }

    function buildPriorityPanel(homeRole, statsData, todayFocusData, resource) {
        if (homeRole === 'admin') return '';

        if (homeRole === 'pm') {
            return `
                <div id="dashboardPriorityPanel" class="panel" style="margin-bottom:20px;border:1px solid #bfdbfe;background:linear-gradient(135deg,#f8fbff,#eef6ff);">
                    <div class="panel-header">
                        <div class="panel-title">🧭 我的优先事项</div>
                        <div style="font-size:12px;color:#64748b;">项目经理视角</div>
                    </div>
                    <div class="panel-body">
                        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;">
                            <div style="padding:16px;border-radius:16px;background:white;border:1px solid #dbeafe;">
                                <div style="font-size:12px;color:#64748b;">优先处理</div>
                                <div style="font-size:26px;font-weight:800;color:#1d4ed8;margin-top:6px;">${todayFocusData.summary.pending_approvals || 0}</div>
                                <div style="font-size:13px;color:#475569;margin-top:6px;">待审批事项</div>
                                <button class="btn btn-outline btn-sm" style="margin-top:12px;" onclick="showApprovalCenter()">进入审批中心</button>
                            </div>
                            <div style="padding:16px;border-radius:16px;background:white;border:1px solid #fecaca;">
                                <div style="font-size:12px;color:#64748b;">重点风险</div>
                                <div style="font-size:26px;font-weight:800;color:#dc2626;margin-top:6px;">${todayFocusData.summary.warning_total || 0}</div>
                                <div style="font-size:13px;color:#475569;margin-top:6px;">待关注预警/风险</div>
                                <button class="btn btn-outline btn-sm" style="margin-top:12px;" onclick="showWarningCenter()">查看风险</button>
                            </div>
                            <div style="padding:16px;border-radius:16px;background:white;border:1px solid #a7f3d0;">
                                <div style="font-size:12px;color:#64748b;">资源协调</div>
                                <div style="font-size:26px;font-weight:800;color:#047857;margin-top:6px;">${((resource.summary || {}).busy_members || 0)}</div>
                                <div style="font-size:13px;color:#475569;margin-top:6px;">高负载成员待协调</div>
                                <button class="btn btn-outline btn-sm" style="margin-top:12px;" onclick="showResourceOverview()">查看资源</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        return `
            <div id="dashboardPriorityPanel" class="panel" style="margin-bottom:20px;border:1px solid #a5f3fc;background:linear-gradient(135deg,#f2feff,#ecfeff);">
                <div class="panel-header">
                    <div class="panel-title">🚚 我的优先事项</div>
                    <div style="font-size:12px;color:#64748b;">交付执行视角</div>
                </div>
                <div class="panel-body">
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;">
                        <div style="padding:16px;border-radius:16px;background:white;border:1px solid #dbeafe;">
                            <div style="font-size:12px;color:#64748b;">今日任务</div>
                            <div style="font-size:26px;font-weight:800;color:#1d4ed8;margin-top:6px;">${todayFocusData.summary.completed_today || 0}</div>
                            <div style="font-size:13px;color:#475569;margin-top:6px;">今日已完成事项</div>
                            <button class="btn btn-outline btn-sm" style="margin-top:12px;" onclick="window.location.href='/tasks-center'">打开任务中心</button>
                        </div>
                        <div style="padding:16px;border-radius:16px;background:white;border:1px solid #fecaca;">
                            <div style="font-size:12px;color:#64748b;">现场风险</div>
                            <div style="font-size:26px;font-weight:800;color:#dc2626;margin-top:6px;">${todayFocusData.summary.warning_total || 0}</div>
                            <div style="font-size:13px;color:#475569;margin-top:6px;">需要跟进的风险/预警</div>
                            <button class="btn btn-outline btn-sm" style="margin-top:12px;" onclick="showWarningCenter()">查看预警</button>
                        </div>
                        <div style="padding:16px;border-radius:16px;background:white;border:1px solid #a7f3d0;">
                            <div style="font-size:12px;color:#64748b;">协同资源</div>
                            <div style="font-size:26px;font-weight:800;color:#047857;margin-top:6px;">${((resource.summary || {}).available_members || 0)}</div>
                            <div style="font-size:13px;color:#475569;margin-top:6px;">可调配协同资源</div>
                            <button class="btn btn-outline btn-sm" style="margin-top:12px;" onclick="showResourceOverview()">查看资源</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function getWorkbenchProjectSnapshot() {
        const projects = Array.isArray(allProjects) ? allProjects : [];
        const activeProject = projects.find(project => Number(project.id) === Number(currentProjectId));
        return {
            hasProject: !!activeProject,
            project: activeProject || null,
            projectName: activeProject?.project_name || '未选择当前项目'
        };
    }

    function readImplementationProjectContextFromMemory() {
        if (!currentProjectId) return null;
        const project = (currentProject && Number(currentProject.id) === Number(currentProjectId))
            ? currentProject
            : ((Array.isArray(allProjects) ? allProjects : []).find(item => Number(item.id) === Number(currentProjectId)) || null);

        if (!project) return null;

        const worklogs = Array.isArray(project.worklogs) ? [...project.worklogs] : [];
        const issues = Array.isArray(project.issues) ? [...project.issues] : [];

        return {
            project,
            recentWorklogs: worklogs
                .sort((a, b) => String(b.log_date || '').localeCompare(String(a.log_date || '')))
                .slice(0, 2),
            openIssues: issues.filter(item => item.status !== '已解决').slice(0, 3),
            communications: [],
            archives: []
        };
    }

    async function loadImplementationProjectContext() {
        if (!currentProjectId) return null;

        const memoryContext = readImplementationProjectContextFromMemory();
        let project = memoryContext?.project || null;
        let worklogs = memoryContext?.recentWorklogs || [];
        let issues = memoryContext?.openIssues || [];
        let communications = memoryContext?.communications || [];
        let archives = memoryContext?.archives || [];

        try {
            const projectData = await api.get(`/projects/${currentProjectId}`, { silent: true });
            if (projectData) {
                project = projectData;
                worklogs = Array.isArray(projectData.worklogs) ? projectData.worklogs : worklogs;
                issues = Array.isArray(projectData.issues) ? projectData.issues : issues;
                communications = Array.isArray(projectData.communications) ? projectData.communications : communications;
            }
        } catch (e) {
            // fall back to memory context; do not block dashboard rendering
        }

        try {
            const archiveData = await fetch(`/api/projects/${currentProjectId}/report-archive`).then(res => res.json());
            archives = Array.isArray(archiveData) ? archiveData : archives;
        } catch (e) {
            // ignore archive fetch failures on dashboard
        }

        if (project) {
            currentProject = project;
        }

        return {
            project,
            recentWorklogs: [...worklogs]
                .sort((a, b) => String(b.log_date || '').localeCompare(String(a.log_date || '')))
                .slice(0, 2),
            openIssues: issues.filter(item => item.status !== '已解决').slice(0, 3),
            communications: [...communications].sort((a, b) => String(b.contact_date || '').localeCompare(String(a.contact_date || ''))),
            archives: [...archives].sort((a, b) => String(b.report_date || '').localeCompare(String(a.report_date || '')))
        };
    }

    function buildImplementationProjectPulsePanel(homeRole, projectContext) {
        if (homeRole !== 'delivery' || !projectContext?.project) return '';

        const project = projectContext.project;
        const recentWorklogs = Array.isArray(projectContext.recentWorklogs) ? projectContext.recentWorklogs : [];
        const openIssues = Array.isArray(projectContext.openIssues) ? projectContext.openIssues : [];
        const communications = Array.isArray(projectContext.communications) ? projectContext.communications : [];
        const archives = Array.isArray(projectContext.archives) ? projectContext.archives : [];
        const statusColor = project.status === '进行中'
            ? '#0f766e'
            : (project.status === '暂停' || project.status === '离场待返' ? '#c2410c' : '#1d4ed8');
        const today = new Date().toISOString().slice(0, 10);
        const todayWorklogCount = recentWorklogs.filter(item => String(item.log_date || '') === today).length;
        const todayCommunicationCount = communications.filter(item => String(item.contact_date || '') === today).length;
        const hasTodayDailyArchive = archives.some(item => item.report_type === 'daily' && String(item.report_date || '') === today);

        const evidenceGaps = [];
        if (todayWorklogCount <= 0) {
            evidenceGaps.push({
                tone: 'warning',
                title: '今天还没有工作日志',
                desc: '现场推进没有日志，晚上的日报和后续复盘都会缺证据。',
                action: 'openImplementationWorkbenchAction(\'worklog\')',
                actionLabel: '去写日志'
            });
        }
        if (todayCommunicationCount <= 0) {
            evidenceGaps.push({
                tone: 'info',
                title: '今天还没有沟通沉淀',
                desc: '如果今天开过会、打过电话或群里确认过事项，建议至少沉淀一条沟通记录或会议纪要。',
                action: 'openImplementationWorkbenchAction(\'meeting\')',
                actionLabel: '记会议纪要'
            });
        }
        if (!hasTodayDailyArchive) {
            evidenceGaps.push({
                tone: 'muted',
                title: '今日日报还没归档',
                desc: '日志有了不代表日报已经成文，建议收尾前生成一次 AI 日报。',
                action: 'openImplementationWorkbenchAction(\'dailyReport\')',
                actionLabel: '生成日报',
                extraAction: 'manualGenerateDailyArchiveFromWorkbench()',
                extraLabel: '直接归档日报'
            });
        }
        if (openIssues.length > 0) {
            evidenceGaps.push({
                tone: 'danger',
                title: '仍有问题未闭环',
                desc: `当前还有 ${openIssues.length} 个问题未解决，建议同步进展或继续推动责任人。`,
                action: 'openImplementationWorkbenchAction(\'issue\')',
                actionLabel: '继续推动'
            });
        }

        const meetingFollowups = communications
            .filter(item => {
                const summary = String(item.summary || '');
                return /待办|跟进|确认|安排|推进|会议|纪要|风险|问题/i.test(summary);
            })
            .slice(0, 3);
        const issueBuckets = {
            noResponse: [],
            pushedPending: [],
            verifyClose: [],
            other: []
        };
        openIssues.forEach(issue => {
            const ageHours = hoursBetweenWorkbench(issue.created_at);
            const lastPushHours = hoursBetweenWorkbench(issue.last_push_at || issue.updated_at || issue.created_at);
            const hasResponse = !!issue.first_response_at;
            const hasPush = !!issue.last_wecom_push_summary;
            if (!hasResponse && (ageHours === null || ageHours >= 4)) {
                issueBuckets.noResponse.push(issue);
                return;
            }
            if (hasPush && issue.status === '处理中' && (lastPushHours === null || lastPushHours >= 12)) {
                issueBuckets.pushedPending.push(issue);
                return;
            }
            if (issue.status === '处理中' && hasResponse) {
                issueBuckets.verifyClose.push(issue);
                return;
            }
            issueBuckets.other.push(issue);
        });
        const issueBucketCards = [
            {
                key: 'noResponse',
                title: '超时未响应',
                color: '#b91c1c',
                bg: '#fef2f2',
                border: '#fecaca',
                desc: '建了问题但没人接，先催这个'
            },
            {
                key: 'pushedPending',
                title: '已推送未处理',
                color: '#c2410c',
                bg: '#fff7ed',
                border: '#fed7aa',
                desc: '催过了，但还没实质推进'
            },
            {
                key: 'verifyClose',
                title: '待验证关闭',
                color: '#1d4ed8',
                bg: '#eff6ff',
                border: '#bfdbfe',
                desc: '对方说在处理，实施要追结果'
            }
        ];
        const closureSteps = [
            {
                done: todayWorklogCount > 0,
                title: '写日志',
                desc: todayWorklogCount > 0 ? `今天已沉淀 ${todayWorklogCount} 条日志` : '先把今天推进、问题和明天计划写下来',
                action: 'openImplementationWorkbenchAction(\'worklog\')',
                actionLabel: todayWorklogCount > 0 ? '继续补充' : '去填写'
            },
            {
                done: todayCommunicationCount > 0,
                title: '留沟通纪要',
                desc: todayCommunicationCount > 0 ? `今天已沉淀 ${todayCommunicationCount} 条沟通` : '把会议、电话、群里确认过的事项沉淀到系统',
                action: 'openImplementationWorkbenchAction(\'meeting\')',
                actionLabel: todayCommunicationCount > 0 ? '继续补充' : '去沉淀'
            },
            {
                done: openIssues.length === 0,
                title: '清问题状态',
                desc: openIssues.length === 0 ? '当前没有未闭环问题' : `还有 ${openIssues.length} 个问题需要同步状态或继续催办`,
                action: 'showImplementationIssueBoard()',
                actionLabel: openIssues.length === 0 ? '查看问题板' : '去推进'
            },
            {
                done: hasTodayDailyArchive,
                title: '归档日报',
                desc: hasTodayDailyArchive ? '今日日报已归档，可直接查看最后版本' : '收尾前生成并归档日报，避免明天继续靠回忆',
                action: hasTodayDailyArchive ? 'openLatestDailyArchiveFromWorkbench()' : 'manualGenerateDailyArchiveFromWorkbench()',
                actionLabel: hasTodayDailyArchive ? '查看日报' : '立即归档'
            }
        ];

        const toneMap = {
            warning: { bg: '#fff7ed', border: '#fed7aa', text: '#9a3412' },
            info: { bg: '#eff6ff', border: '#bfdbfe', text: '#1d4ed8' },
            muted: { bg: '#f8fafc', border: '#e2e8f0', text: '#475569' },
            danger: { bg: '#fef2f2', border: '#fecaca', text: '#991b1b' }
        };

        return `
            <div id="implementationProjectPulsePanel" class="panel" style="margin-bottom:20px;border:1px solid #dbeafe;background:linear-gradient(180deg,#ffffff 0%,#f8fbff 100%);">
                <div class="panel-header" style="flex-wrap:wrap;gap:10px;">
                    <div>
                        <div class="panel-title">📌 当前项目现场快照</div>
                        <div style="font-size:12px;color:#64748b;margin-top:4px;">不用进项目详情，也能先看到今天接着干什么</div>
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <button class="btn btn-outline btn-sm" onclick="loadProjectDetail(${project.id})">打开项目详情</button>
                        <button class="btn btn-outline btn-sm" onclick="refreshImplementationWorkbenchSnapshot()">刷新快照</button>
                    </div>
                </div>
                <div class="panel-body">
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px;">
                        <div style="padding:14px;border-radius:14px;background:#eff6ff;">
                            <div style="font-size:12px;color:#64748b;">当前项目</div>
                            <div style="font-size:18px;font-weight:800;color:#0f172a;margin-top:6px;">${project.project_name || '未命名项目'}</div>
                            <div style="font-size:12px;color:#64748b;margin-top:6px;">${project.hospital_name || '-'}</div>
                        </div>
                        <div style="padding:14px;border-radius:14px;background:#f8fafc;">
                            <div style="font-size:12px;color:#64748b;">项目状态</div>
                            <div style="font-size:24px;font-weight:800;color:${statusColor};margin-top:6px;">${project.status || '-'}</div>
                            <div style="font-size:12px;color:#64748b;margin-top:6px;">进度 ${Number(project.progress || 0)}%</div>
                        </div>
                        <div style="padding:14px;border-radius:14px;background:#fef2f2;">
                            <div style="font-size:12px;color:#64748b;">未闭环问题</div>
                            <div style="font-size:24px;font-weight:800;color:#b91c1c;margin-top:6px;">${openIssues.length}</div>
                            <div style="font-size:12px;color:#64748b;margin-top:6px;">阻塞项要留痕，不靠群消息</div>
                        </div>
                        <div style="padding:14px;border-radius:14px;background:#ecfdf5;">
                            <div style="font-size:12px;color:#64748b;">最近日志</div>
                            <div style="font-size:24px;font-weight:800;color:#047857;margin-top:6px;">${recentWorklogs.length}</div>
                            <div style="font-size:12px;color:#64748b;margin-top:6px;">有记录，日报和复盘才有依据</div>
                        </div>
                    </div>
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin-bottom:14px;">
                        <div style="padding:16px;border-radius:16px;background:#ffffff;border:1px solid #e2e8f0;">
                            <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px;">
                                <div style="font-weight:800;color:#0f172a;">📎 今日证据缺口</div>
                                <div style="font-size:12px;color:#64748b;">${today}</div>
                            </div>
                            ${evidenceGaps.length ? evidenceGaps.map(item => {
                                const tone = toneMap[item.tone] || toneMap.muted;
                                return `
                                    <div style="padding:12px 14px;border-radius:14px;background:${tone.bg};border:1px solid ${tone.border};margin-bottom:10px;">
                                        <div style="font-size:13px;font-weight:800;color:${tone.text};">${item.title}</div>
                                        <div style="font-size:13px;color:#475569;line-height:1.7;margin-top:6px;">${item.desc}</div>
                                        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
                                            <button class="btn btn-outline btn-sm" onclick="${item.action}">${item.actionLabel}</button>
                                            ${item.extraAction ? `<button class="btn btn-outline btn-sm" onclick="${item.extraAction}">${item.extraLabel}</button>` : ''}
                                            ${item.title.includes('日报') ? `<button class="btn btn-outline btn-sm" onclick="openLatestDailyArchiveFromWorkbench()">查看最后日报</button>` : ''}
                                        </div>
                                    </div>
                                `;
                            }).join('') : `
                                <div style="padding:16px;border-radius:14px;background:#ecfdf5;border:1px dashed #bbf7d0;color:#166534;font-size:13px;line-height:1.7;">
                                    今天的关键证据已经比较完整：有日志、有沟通沉淀、日报也已归档，可以继续做闭环推进。
                                </div>
                            `}
                        </div>
                        <div style="padding:16px;border-radius:16px;background:#ffffff;border:1px solid #ddd6fe;">
                            <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px;">
                                <div style="font-weight:800;color:#6d28d9;">🗒️ 沟通待跟进</div>
                                <button class="btn btn-outline btn-sm" onclick="openImplementationWorkbenchAction('meeting')">继续沉淀</button>
                            </div>
                            ${meetingFollowups.length ? meetingFollowups.map(item => {
                                const summary = String(item.summary || '').trim();
                                const shortSummary = truncateWorkbenchText(summary, 180);
                                return `
                                    <div style="padding:12px 14px;border-radius:14px;background:#faf5ff;border:1px solid #ddd6fe;margin-bottom:10px;">
                                        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
                                            <div style="font-size:13px;font-weight:700;color:#0f172a;">${escapeWorkbenchHtml(item.contact_person || item.contact_method || '沟通记录')}</div>
                                            <div style="font-size:12px;color:#64748b;">${escapeWorkbenchHtml(item.contact_date || '-')}</div>
                                        </div>
                                        <div style="font-size:13px;color:#334155;line-height:1.7;margin-top:8px;white-space:pre-wrap;">${escapeWorkbenchHtml(shortSummary)}</div>
                                        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
                                            <button class="btn btn-outline btn-sm" onclick="seedIssueFromCommunication(${JSON.stringify(summary).replace(/"/g, '&quot;')})">转阻塞</button>
                                            <button class="btn btn-outline btn-sm" onclick="seedWorklogFromCommunication(${JSON.stringify(summary).replace(/"/g, '&quot;')})">补到日志</button>
                                        </div>
                                    </div>
                                `;
                            }).join('') : `
                                <div style="padding:16px;border-radius:14px;background:#f8fafc;border:1px dashed #cbd5e1;color:#64748b;font-size:13px;line-height:1.7;">
                                    最近沟通里还没有明显的待跟进纪要。如果今天刚沟通过，建议尽快沉淀到系统里。
                                </div>
                            `}
                        </div>
                    </div>
                    <div style="padding:16px;border-radius:16px;background:#ffffff;border:1px solid #dbeafe;margin-bottom:14px;">
                        <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px;flex-wrap:wrap;">
                            <div style="font-weight:800;color:#1d4ed8;">✅ 收尾闭环链路</div>
                            <div style="font-size:12px;color:#64748b;">按照这个顺序收尾，第二天最省事</div>
                        </div>
                        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;">
                            ${closureSteps.map((step, index) => `
                                <div style="padding:14px;border-radius:14px;background:${step.done ? '#ecfdf5' : '#f8fafc'};border:1px solid ${step.done ? '#bbf7d0' : '#dbeafe'};">
                                    <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
                                        <div style="font-size:13px;font-weight:800;color:${step.done ? '#166534' : '#0f172a'};">${index + 1}. ${step.title}</div>
                                        <div style="font-size:12px;color:${step.done ? '#166534' : '#64748b'};font-weight:700;">${step.done ? '已完成' : '待处理'}</div>
                                    </div>
                                    <div style="font-size:13px;color:#475569;line-height:1.7;margin-top:8px;min-height:42px;">${step.desc}</div>
                                    <button class="btn btn-outline btn-sm" style="margin-top:10px;" onclick="${step.action}">${step.actionLabel}</button>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;">
                        <div style="padding:16px;border-radius:16px;background:#ffffff;border:1px solid #dbeafe;">
                            <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px;">
                                <div style="font-weight:800;color:#1d4ed8;">📝 最近日志</div>
                                <button class="btn btn-outline btn-sm" onclick="openImplementationWorkbenchAction('worklog')">补一条</button>
                            </div>
                            ${recentWorklogs.length ? recentWorklogs.map(log => `
                                <div style="padding:12px 14px;border-radius:14px;background:#f8fbff;border:1px solid #dbeafe;margin-bottom:10px;">
                                    <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
                                        <div style="font-size:13px;font-weight:700;color:#0f172a;">${log.member_name || '未填写成员'}</div>
                                        <div style="font-size:12px;color:#64748b;">${log.log_date || '-'}</div>
                                    </div>
                                    <div style="font-size:13px;color:#334155;line-height:1.7;margin-top:8px;">${log.work_content || '无内容'}</div>
                                </div>
                            `).join('') : `
                                <div style="padding:16px;border-radius:14px;background:#f8fafc;border:1px dashed #cbd5e1;color:#64748b;font-size:13px;line-height:1.7;">
                                    这个项目还没有最近日志。建议现场每天至少留一条，哪怕只有一句话归档。
                                </div>
                            `}
                        </div>
                        <div style="padding:16px;border-radius:16px;background:#ffffff;border:1px solid #fecaca;">
                            <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px;">
                                <div style="font-weight:800;color:#b91c1c;">🚨 问题闭环链路</div>
                                <button class="btn btn-outline btn-sm" onclick="showImplementationIssueBoard()">打开问题板</button>
                            </div>
                            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px;">
                                ${issueBucketCards.map(bucket => `
                                    <div style="padding:12px;border-radius:12px;background:${bucket.bg};border:1px solid ${bucket.border};">
                                        <div style="font-size:12px;color:#64748b;">${bucket.title}</div>
                                        <div style="font-size:24px;font-weight:800;color:${bucket.color};margin-top:6px;">${issueBuckets[bucket.key].length}</div>
                                        <div style="font-size:12px;color:#475569;margin-top:6px;">${bucket.desc}</div>
                                    </div>
                                `).join('')}
                            </div>
                            ${openIssues.length ? openIssues.map(issue => `
                                <div style="padding:12px 14px;border-radius:14px;background:#fffafa;border:1px solid #fecaca;margin-bottom:10px;">
                                    <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
                                        <div style="font-size:13px;font-weight:700;color:#0f172a;">${issue.issue_type || '问题'}</div>
                                        <div style="font-size:12px;color:${issue.severity === '高' ? '#b91c1c' : (issue.severity === '中' ? '#c2410c' : '#2563eb')};font-weight:700;">${issue.severity || '未分级'} / ${issue.status || '待处理'}</div>
                                    </div>
                                    <div style="font-size:13px;color:#334155;line-height:1.7;margin-top:8px;">${issue.description || '无描述'}</div>
                                    <div style="font-size:12px;color:#64748b;margin-top:8px;">
                                        ${!issue.first_response_at ? '尚未响应' : `已响应：${escapeWorkbenchHtml(String(issue.first_response_at).replace('T', ' ').slice(0, 16))}`}
                                        ${issue.last_wecom_push_summary ? ` · 企微：${escapeWorkbenchHtml(issue.last_wecom_push_summary)}` : ''}
                                    </div>
                                    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
                                        <button class="btn btn-outline btn-sm" onclick="pushImplementationIssueToWecom(${issue.id})">催办推送</button>
                                        <button class="btn btn-outline btn-sm" onclick="advanceImplementationIssueStatus(${issue.id}, '${issue.status || '待处理'}')">推进状态</button>
                                    </div>
                                </div>
                            `).join('') : `
                                <div style="padding:16px;border-radius:14px;background:#f0fdf4;border:1px dashed #bbf7d0;color:#166534;font-size:13px;line-height:1.7;">
                                    当前没有未闭环问题。风险要么被解决了，要么还没有进入系统，建议确认不是漏记。
                                </div>
                            `}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function buildImplementationWorkbenchPanel(homeRole, todayFocusData) {
        if (homeRole !== 'delivery') return '';

        const projectSnapshot = getWorkbenchProjectSnapshot();
        const pendingApprovals = Number(todayFocusData.summary.pending_approvals || 0);
        const warningTotal = Number(todayFocusData.summary.warning_total || 0);

        return `
            <div id="implementationWorkbenchPanel" class="panel" style="margin-bottom:20px;border:1px solid #99f6e4;background:linear-gradient(135deg,#f0fdfa,#ecfeff);">
                <div class="panel-header">
                    <div class="panel-title">🛠️ 实施工作台</div>
                    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                        <div style="padding:6px 10px;border-radius:999px;background:${projectSnapshot.hasProject ? '#ccfbf1' : '#fff7ed'};color:${projectSnapshot.hasProject ? '#0f766e' : '#c2410c'};font-size:12px;font-weight:700;max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                            当前项目：${projectSnapshot.projectName}
                        </div>
                        <button class="btn btn-outline btn-sm" onclick="chooseImplementationWorkbenchProject()">切换项目</button>
                    </div>
                </div>
                <div class="panel-body">
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;">
                        <div onclick="openImplementationWorkbenchAction('worklog')" style="cursor:pointer;padding:16px;border-radius:16px;background:#ffffff;border:1px solid #bfdbfe;">
                            <div style="font-size:28px;margin-bottom:10px;">📝</div>
                            <div style="font-weight:800;color:#1d4ed8;margin-bottom:6px;">填写日志</div>
                            <div style="font-size:13px;color:#475569;">现场做了什么、遇到什么、明天怎么干，直接落日志</div>
                        </div>
                        <div onclick="openImplementationWorkbenchAction('quickReport')" style="cursor:pointer;padding:16px;border-radius:16px;background:#ffffff;border:1px solid #a7f3d0;">
                            <div style="font-size:28px;margin-bottom:10px;">⚡</div>
                            <div style="font-weight:800;color:#047857;margin-bottom:6px;">一句话归档</div>
                            <div style="font-size:13px;color:#475569;">临走前用一句话补齐进展、问题和下一步</div>
                        </div>
                        <div onclick="openImplementationWorkbenchAction('issue')" style="cursor:pointer;padding:16px;border-radius:16px;background:#ffffff;border:1px solid #fecaca;">
                            <div style="font-size:28px;margin-bottom:10px;">🚨</div>
                            <div style="font-weight:800;color:#b91c1c;margin-bottom:6px;">上报阻塞</div>
                            <div style="font-size:13px;color:#475569;">接口、环境、协调卡点，现场立即登记并推动</div>
                        </div>
                        <div onclick="openImplementationWorkbenchAction('meeting')" style="cursor:pointer;padding:16px;border-radius:16px;background:#ffffff;border:1px solid #ddd6fe;">
                            <div style="font-size:28px;margin-bottom:10px;">🗒️</div>
                            <div style="font-weight:800;color:#6d28d9;margin-bottom:6px;">会议纪要</div>
                            <div style="font-size:13px;color:#475569;">把群聊、会议、电话记录直接转成纪要和待办</div>
                        </div>
                        <div onclick="openImplementationWorkbenchAction('dailyReport')" style="cursor:pointer;padding:16px;border-radius:16px;background:#ffffff;border:1px solid #fdba74;">
                            <div style="font-size:28px;margin-bottom:10px;">📋</div>
                            <div style="font-weight:800;color:#c2410c;margin-bottom:6px;">AI 日报</div>
                            <div style="font-size:13px;color:#475569;">基于今天日志和任务生成日报，方便对内对外同步</div>
                        </div>
                        <div onclick="showActionInbox()" style="cursor:pointer;padding:16px;border-radius:16px;background:#ffffff;border:1px solid #cbd5e1;">
                            <div style="font-size:28px;margin-bottom:10px;">📥</div>
                            <div style="font-weight:800;color:#334155;margin-bottom:6px;">待处理入口</div>
                            <div style="font-size:13px;color:#475569;">审批 ${pendingApprovals} 项，风险 ${warningTotal} 项，统一处理</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function buildImplementationClosurePanel(homeRole, todayFocusData) {
        if (homeRole !== 'delivery') return '';

        const projectSnapshot = getWorkbenchProjectSnapshot();
        const closureItems = [];

        if (!projectSnapshot.hasProject) {
            closureItems.push({
                tone: 'warning',
                badge: '先处理',
                title: '先锁定今天的实施项目',
                desc: '没有当前项目时，日志、问题、日报都会失去归属。',
                action: 'chooseImplementationWorkbenchProject()',
                actionLabel: '选择项目'
            });
        } else {
            closureItems.push({
                tone: 'ready',
                badge: '已就绪',
                title: '当前项目上下文已准备',
                desc: `已选中「${projectSnapshot.projectName}」，可以直接沉淀日志、问题和纪要。`,
                action: 'openImplementationWorkbenchAction(\'worklog\')',
                actionLabel: '去写日志'
            });
        }

        if (Number(todayFocusData.summary.warning_total || 0) > 0) {
            closureItems.push({
                tone: 'danger',
                badge: `${todayFocusData.summary.warning_total || 0} 项`,
                title: '风险和预警还没清掉',
                desc: '现场阻塞如果不先登记和跟踪，项目推进很容易靠口头传递失真。',
                action: 'showWarningCenter()',
                actionLabel: '查看风险'
            });
        }

        if (Number(todayFocusData.summary.pending_approvals || 0) > 0) {
            closureItems.push({
                tone: 'warning',
                badge: `${todayFocusData.summary.pending_approvals || 0} 项`,
                title: '还有待跟进的审批流',
                desc: '变更、费用、离场等事项不追审批状态，实施侧就无法闭环。',
                action: 'showApprovalCenter()',
                actionLabel: '进入审批'
            });
        }

        if (Number(todayFocusData.summary.processing_tasks || 0) > 0) {
            closureItems.push({
                tone: 'info',
                badge: `${todayFocusData.summary.processing_tasks || 0} 项`,
                title: '后台任务仍在处理中',
                desc: '报告、导出、AI 任务还没结束，建议收尾前确认结果是否可用。',
                action: "window.open('/tasks-center?status=processing', '_blank')",
                actionLabel: '查看任务'
            });
        }

        if (Number(todayFocusData.summary.completed_today || 0) <= 0) {
            closureItems.push({
                tone: 'muted',
                badge: '建议',
                title: '今天的完成记录还没沉淀',
                desc: '哪怕进展不多，也建议补一条日志或一句话归档，避免第二天继续靠回忆。',
                action: 'openImplementationWorkbenchAction(\'quickReport\')',
                actionLabel: '快速归档'
            });
        }

        const toneMap = {
            ready: { bg: '#ecfdf5', border: '#bbf7d0', text: '#166534', badgeBg: '#dcfce7' },
            warning: { bg: '#fff7ed', border: '#fed7aa', text: '#9a3412', badgeBg: '#ffedd5' },
            danger: { bg: '#fef2f2', border: '#fecaca', text: '#991b1b', badgeBg: '#fee2e2' },
            info: { bg: '#eff6ff', border: '#bfdbfe', text: '#1d4ed8', badgeBg: '#dbeafe' },
            muted: { bg: '#f8fafc', border: '#e2e8f0', text: '#475569', badgeBg: '#e2e8f0' }
        };

        return `
            <div id="implementationClosurePanel" class="panel" style="margin-bottom:20px;">
                <div class="panel-header">
                    <div class="panel-title">✅ 下班前闭环检查</div>
                    <div style="font-size:12px;color:#64748b;">让实施每天都把项目证据留在系统里</div>
                </div>
                <div class="panel-body">
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;">
                        ${closureItems.map(item => {
                            const tone = toneMap[item.tone] || toneMap.muted;
                            return `
                                <div style="padding:16px;border-radius:16px;background:${tone.bg};border:1px solid ${tone.border};">
                                    <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:10px;">
                                        <div style="font-weight:800;color:${tone.text};">${item.title}</div>
                                        <div style="padding:4px 8px;border-radius:999px;background:${tone.badgeBg};color:${tone.text};font-size:11px;font-weight:700;white-space:nowrap;">${item.badge}</div>
                                    </div>
                                    <div style="font-size:13px;color:#475569;line-height:1.7;min-height:44px;">${item.desc}</div>
                                    <button class="btn btn-outline btn-sm" style="margin-top:12px;" onclick="${item.action}">${item.actionLabel}</button>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    function renderDashboardFromData(statsData, briefingData, todayFocusData, financial, resource, options = {}) {
        const homeRole = getDesktopHomeRole();
        const cacheHint = options.cachedAt
            ? `<div style="margin-bottom:12px;font-size:12px;color:#64748b;">当前先展示缓存视图，后台正在刷新。缓存时间：${new Date(options.cachedAt).toLocaleTimeString('zh-CN', { hour12: false })}</div>`
            : '';
        const priorityPanel = buildPriorityPanel(homeRole, statsData, todayFocusData, resource);
        const implementationWorkbenchPanel = buildImplementationWorkbenchPanel(homeRole, todayFocusData);
        const implementationClosurePanel = buildImplementationClosurePanel(homeRole, todayFocusData);
        const implementationProjectPulsePanel = buildImplementationProjectPulsePanel(homeRole, options.projectContext);
        window.dashboardBriefingSnapshot = normalizeDashboardBriefing(briefingData);

        document.getElementById('dashboardView').innerHTML = `
            <div id="dashboardHeroPanel" class="panel" style="background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%); color: white; border: none; margin-bottom: 20px; position: relative;">
                <div class="panel-body">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:16px; flex-wrap:wrap;">
                        <div style="display: flex; align-items: center; gap: 15px; min-width:0; flex:1;">
                        <div id="dashboardHeroIcon" style="font-size: 32px;">🤖</div>
                        <div style="min-width:0;">
                            <h3 id="dashboardHeroTitle" style="margin-bottom: 5px; font-size: 16px;">AI 交付决策简报</h3>
                        </div>
                        </div>
                        <div style="display:flex; gap:8px; flex-wrap:wrap;">
                            <button class="btn btn-outline btn-sm" onclick="openDashboardBriefingModal()" style="width:auto; background:rgba(255,255,255,0.16); color:white; border:1px solid rgba(255,255,255,0.18); box-shadow:none;">📋 查看简报</button>
                        </div>
                    </div>
                </div>
            </div>
            ${cacheHint}
            ${priorityPanel}
            ${implementationWorkbenchPanel}
            ${implementationClosurePanel}
            ${implementationProjectPulsePanel}
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:20px;">
                <h2 id="dashboardMainTitle" style="font-size:22px;">📊 项目仪表盘</h2>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="btn btn-outline btn-sm" onclick="copyCurrentViewLink()">复制当前视图链接</button>
                    <button class="btn btn-outline btn-sm" onclick="renderAdvancedDashboard()">刷新首页</button>
                </div>
            </div>

            <div id="dashboardSummaryGrid" class="dashboard-grid">
                <div class="stat-card" onclick="showProjectComparison()" style="cursor:pointer;">
                    <div class="stat-icon blue">📊</div>
                    <div class="stat-value">${statsData.stats.total_projects}</div>
                    <div class="stat-label">项目总数</div>
                </div>
                <div class="stat-card" onclick="showProjectComparison()" style="cursor:pointer;">
                    <div class="stat-icon red">⏰</div>
                    <div class="stat-value">${statsData.stats.overdue_milestones || 0}</div>
                    <div class="stat-label">逾期里程碑</div>
                </div>
                <div class="stat-card" onclick="toggleHealthDashboard()" style="cursor:pointer;">
                    <div class="stat-icon yellow">⚠️</div>
                    <div class="stat-value">${statsData.stats.delayed}</div>
                    <div class="stat-label">项目延期</div>
                </div>
                <div class="stat-card" onclick="showProjectComparison()" style="cursor:pointer;">
                    <div class="stat-icon pink">🚪</div>
                    <div class="stat-value">${statsData.stats.on_departure}</div>
                    <div class="stat-label">暂停/离场</div>
                </div>
                <div class="stat-card" onclick="showWarningCenter()" style="cursor:pointer;">
                    <div class="stat-icon red">🔥</div>
                    <div class="stat-value">${statsData.stats.critical_issues}</div>
                    <div class="stat-label">高危问题</div>
                </div>
            </div>

            <div id="dashboardWorkbenchPanel" class="panel" style="margin-bottom:20px;">
                <div class="panel-header">
                    <div class="panel-title">🧭 驾驶舱入口</div>
                </div>
                <div class="panel-body">
                    <div id="dashboardWorkbenchGrid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;">
                            <div onclick="showActionInbox()" style="cursor:pointer;padding:16px;border-radius:16px;background:linear-gradient(135deg,#fff7ed,#ffedd5);border:1px solid #fed7aa;">
                                <div style="font-size:28px;margin-bottom:10px;">📥</div>
                                <div style="font-weight:800;color:#9a3412;">行动收件箱</div>
                            </div>
                            <div onclick="showAiWorkbench()" style="cursor:pointer;padding:16px;border-radius:16px;background:linear-gradient(135deg,#f5f3ff,#ede9fe);border:1px solid #ddd6fe;">
                                <div style="font-size:28px;margin-bottom:10px;">🤖</div>
                                <div style="font-weight:800;color:#5b21b6;">AI 工作台</div>
                            </div>
                            <div onclick="showApprovalCenter()" style="cursor:pointer;padding:16px;border-radius:16px;background:linear-gradient(135deg,#eff6ff,#dbeafe);border:1px solid #bfdbfe;">
                                <div style="font-size:28px;margin-bottom:10px;">📋</div>
                                <div style="font-weight:800;color:#1e3a8a;">审批中心</div>
                            </div>
                        <div onclick="window.location.href='/tasks-center'" style="cursor:pointer;padding:16px;border-radius:16px;background:linear-gradient(135deg,#f5f3ff,#ede9fe);border:1px solid #ddd6fe;">
                            <div style="font-size:28px;margin-bottom:10px;">🗂️</div>
                            <div style="font-weight:800;color:#5b21b6;">任务中心</div>
                        </div>
                            <div onclick="window.location.href='/alignment'" style="cursor:pointer;padding:16px;border-radius:16px;background:linear-gradient(135deg,#eef2ff,#e0e7ff);border:1px solid #c7d2fe;">
                                <div style="font-size:28px;margin-bottom:10px;">🧩</div>
                                <div style="font-weight:800;color:#4338ca;">对齐中心</div>
                            </div>
                            <div onclick="showResourceOverview()" style="cursor:pointer;padding:16px;border-radius:16px;background:linear-gradient(135deg,#ecfeff,#cffafe);border:1px solid #a5f3fc;">
                                <div style="font-size:28px;margin-bottom:10px;">👥</div>
                                <div style="font-weight:800;color:#155e75;">资源排班视图</div>
                            </div>
                            <div onclick="showBusinessOverview()" style="cursor:pointer;padding:16px;border-radius:16px;background:linear-gradient(135deg,#fff7ed,#fed7aa);border:1px solid #fdba74;">
                                <div style="font-size:28px;margin-bottom:10px;">💰</div>
                                <div style="font-weight:800;color:#9a3412;margin-bottom:6px;">经营看板视图</div>
                                <div style="font-size:13px;color:#475569;">查看合同、回款、报销、人力成本与毛利</div>
                            </div>
                            <div onclick="showFinancialOverview()" style="cursor:pointer;padding:16px;border-radius:16px;background:linear-gradient(135deg,#eff6ff,#dbeafe);border:1px solid #bfdbfe;">
                                <div style="font-size:28px;margin-bottom:10px;">📉</div>
                                <div style="font-weight:800;color:#1e3a8a;margin-bottom:6px;">财务总览视图</div>
                                <div style="font-size:13px;color:#475569;">查看财务预测、异常提示与项目财务明细</div>
                            </div>
                        <div onclick="showDeliveryMap()" style="cursor:pointer;padding:16px;border-radius:16px;background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1px solid #bbf7d0;">
                            <div style="font-size:28px;margin-bottom:10px;">🗺️</div>
                            <div style="font-weight:800;color:#166534;margin-bottom:6px;">交付地图</div>
                            <div style="font-size:13px;color:#475569;">查看全国项目与交付人员空间分布</div>
                        </div>
                    </div>
                </div>
            </div>

            <div id="dashboardTodayFocusPanel" class="panel" style="margin-bottom:20px;">
                <div class="panel-header">
                    <div id="dashboardTodayFocusTitle" class="panel-title">🎯 今日待办驾驶舱</div>
                    <div style="display:flex;gap:8px;align-items:center;">
                        <button id="dashboardTodayFocusGlobalBtn" class="btn btn-outline btn-sm" onclick="switchTodayFocusScope('global')" style="${window.todayFocusScope === 'global' ? 'background:#eef2ff;border-color:#6366f1;color:#4338ca;' : ''}">全局</button>
                        <button id="dashboardTodayFocusMineBtn" class="btn btn-outline btn-sm" onclick="switchTodayFocusScope('mine')" style="${window.todayFocusScope === 'mine' ? 'background:#ecfeff;border-color:#0891b2;color:#0f766e;' : ''}">我负责的</button>
                        <button class="btn btn-outline btn-sm" onclick="renderAdvancedDashboard()">刷新</button>
                        <button class="btn btn-outline btn-sm" onclick="window.location.href='/tasks-center'">🗂️ 打开任务中心</button>
                    </div>
                </div>
                <div class="panel-body">
                    <div id="dashboardTodayFocusMetricGrid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:16px;">
                        <div id="todayFocusCard1" style="padding:14px;border-radius:12px;background:#eff6ff;cursor:pointer;" onclick="showProjectComparison()"><div class="today-focus-value" style="font-size:24px;font-weight:800;color:#2563eb;">${todayFocusData.summary.active_projects || 0}</div><div class="today-focus-label" style="font-size:12px;color:#64748b;">活跃项目</div></div>
                        <div id="todayFocusCard2" style="padding:14px;border-radius:12px;background:#ecfdf5;"><div class="today-focus-value" style="font-size:24px;font-weight:800;color:#059669;">${todayFocusData.summary.completed_today || 0}</div><div class="today-focus-label" style="font-size:12px;color:#64748b;">今日完成</div></div>
                        <div id="todayFocusCard3" style="padding:14px;border-radius:12px;background:#fff7ed;cursor:pointer;" onclick="showApprovalCenter()"><div class="today-focus-value" style="font-size:24px;font-weight:800;color:#ea580c;">${todayFocusData.summary.pending_approvals || 0}</div><div class="today-focus-label" style="font-size:12px;color:#64748b;">待审批</div></div>
                        <div id="todayFocusCard4" style="padding:14px;border-radius:12px;background:#fef2f2;cursor:pointer;" onclick="showWarningCenter()"><div class="today-focus-value" style="font-size:24px;font-weight:800;color:#dc2626;">${todayFocusData.summary.warning_total || 0}</div><div class="today-focus-label" style="font-size:12px;color:#64748b;">预警总数</div></div>
                        <div id="todayFocusCard5" style="padding:14px;border-radius:12px;background:#faf5ff;cursor:pointer;" onclick="window.open('/tasks-center?status=processing', '_blank')"><div class="today-focus-value" style="font-size:24px;font-weight:800;color:#7c3aed;">${todayFocusData.summary.processing_tasks || 0}</div><div class="today-focus-label" style="font-size:12px;color:#64748b;">后台任务</div></div>
                        <div id="todayFocusCard6" style="padding:14px;border-radius:12px;background:#f0fdf4;cursor:pointer;" onclick="toggleHealthDashboard()"><div class="today-focus-value" style="font-size:24px;font-weight:800;color:#15803d;">${todayFocusData.summary.health_score || 0}</div><div class="today-focus-label" style="font-size:12px;color:#64748b;">整体健康度</div></div>
                    </div>
                    ${(todayFocusData.focus_items || []).length > 0 ? todayFocusData.focus_items.map(item => {
                        const color = item.severity === 'urgent' || item.severity === 'high' ? '#dc2626' : item.severity === 'medium' ? '#d97706' : '#2563eb';
                        return `<div style="padding:12px 14px;border-radius:12px;border-left:4px solid ${color};background:white;margin-bottom:10px;box-shadow:0 4px 16px rgba(15,23,42,0.04);cursor:pointer;" onclick='openTodayFocusItem(${JSON.stringify(item).replace(/'/g, "&apos;")})'><div style="font-weight:700;color:#111827;margin-bottom:4px;">${item.title || '-'}</div><div style="font-size:13px;color:#475569;">${item.project || '全局'} ${item.desc ? ' | ' + item.desc : ''}</div></div>`;
                    }).join('') : '<div class="empty-state"><p>今天暂无重点待办</p></div>'}
                </div>
            </div>

            <div id="dashboardBusinessPanel" class="panel" style="margin-bottom:20px;">
                <div class="panel-header">
                    <div class="panel-title">💰 经营快照</div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <button class="btn btn-outline btn-sm" onclick="showBusinessOverview()">打开经营看板</button>
                        <button class="btn btn-outline btn-sm" onclick="showFinancialOverview()">财务总览</button>
                    </div>
                </div>
                <div class="panel-body">
                    <div class="dashboard-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">
                        <div class="stat-card"><div class="stat-icon blue">📄</div><div class="stat-value">¥${(((financial.summary || {}).contract_total || 0) / 10000).toFixed(1)}w</div><div class="stat-label">合同总额</div></div>
                        <div class="stat-card"><div class="stat-icon green">💵</div><div class="stat-value">¥${(((financial.summary || {}).collected_total || 0) / 10000).toFixed(1)}w</div><div class="stat-label">已回款</div></div>
                        <div class="stat-card" onclick="openBusinessFocus('uncollected')" style="cursor:pointer;"><div class="stat-icon yellow">⏳</div><div class="stat-value">¥${(((financial.summary || {}).uncollected_total || 0) / 10000).toFixed(1)}w</div><div class="stat-label">未回款</div></div>
                        <div class="stat-card"><div class="stat-icon pink">📈</div><div class="stat-value">¥${(((financial.summary || {}).gross_profit_total || 0) / 10000).toFixed(1)}w</div><div class="stat-label">总毛利</div></div>
                        <div class="stat-card"><div class="stat-icon info">🏷️</div><div class="stat-value">${((financial.summary || {}).gross_margin || 0)}%</div><div class="stat-label">综合毛利率</div></div>
                        <div class="stat-card" onclick="openBusinessFocus('loss')" style="cursor:pointer;"><div class="stat-icon red">⚠️</div><div class="stat-value">${((financial.summary || {}).loss_projects || 0)}</div><div class="stat-label">亏损项目</div></div>
                    </div>
                </div>
            </div>

            <div id="dashboardResourcePanel" class="panel" style="margin-bottom:20px;">
                <div class="panel-header">
                    <div id="dashboardResourceTitle" class="panel-title">👥 资源快照</div>
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

            <div id="dashboardProgressPanel" class="panel">
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
            <div id="dashboardReminderPanel" class="panel">
                <div class="panel-header"><div class="panel-title">🔔 待处理提醒</div></div>
                <div class="panel-body">
                    ${statsData.upcoming_reminders.length > 0 ? statsData.upcoming_reminders.map(r => `<div class="reminder-item ${r.type}"><div class="reminder-content"><div class="reminder-title">${r.title}</div><div class="reminder-desc">${r.content || ''}</div><div class="reminder-time">${r.project_name || '全局'} | ${r.due_date || '无截止'}</div></div><button class="btn btn-sm btn-outline" onclick="markNotificationRead(${r.id})">已读</button></div>`).join('') : '<div class="empty-state"><p>暂无待处理提醒</p></div>'}
                </div>
            </div>
        `;

        applyRoleHomeLayout(homeRole);
        updateSummaryCardMetrics(homeRole, statsData, todayFocusData, resource);
        updateTodayFocusCards(homeRole, todayFocusData, resource);
        if (typeof applyPermissionGuards === 'function') {
            applyPermissionGuards();
        }
    }

    window.renderAdvancedDashboard = async function (options = {}) {
        syncDashboardFiltersToUrl();
        if (!options.preserveProjectContext) {
            currentProjectId = null;
            renderProjectList();
        }
        hideAllViews();
        document.getElementById('dashboardView').style.display = 'block';

        const cached = readDashboardCache();
        if (cached?.payload && !options.forceRefresh) {
            renderDashboardFromData(
                cached.payload.statsData,
                cached.payload.briefingData,
                cached.payload.todayFocusData,
                cached.payload.financial,
                cached.payload.resource,
                { cachedAt: cached.savedAt }
            );
        } else {
            renderDashboardSkeleton();
        }

        api.post('/check-and-create-reminders', {}, { silent: true }).catch(console.error);

        try {
            const [statsData, briefingData, todayFocusData, financial, resource] = await Promise.all([
                api.get('/dashboard/stats', { silent: true }),
                api.get('/dashboard/global-briefing', { silent: true }),
                api.get(`/dashboard/today-focus?scope=${window.todayFocusScope}`, { silent: true }),
                api.get('/financial/overview', { silent: true }),
                api.get('/resources/overview', { silent: true })
            ]);
            const projectContext = await loadImplementationProjectContext().catch(() => null);

            const payload = { statsData, briefingData, todayFocusData, financial, resource, projectContext };
            writeDashboardCache(payload);
            renderDashboardFromData(statsData, briefingData, todayFocusData, financial, resource, { projectContext });
        } catch (e) {
            if (!cached?.payload) {
                document.getElementById('dashboardView').innerHTML = `<div class="panel"><div class="panel-body" style="text-align:center;color:var(--danger);padding:32px;">仪表盘加载失败：${e.message}</div></div>`;
            } else {
                showToast('仪表盘刷新失败，已保留缓存视图', 'warning');
            }
        }
    };

    window.showGlobalDashboardHome = async function () {
        await window.renderAdvancedDashboard();
        if (window.healthDashboardVisible) {
            const container = document.getElementById('healthDashboard');
            if (container) {
                container.style.display = 'block';
                await window.loadHealthDashboard();
            }
        }
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

    window.chooseImplementationWorkbenchProject = function () {
        const projects = rankProjectsForRole(Array.isArray(allProjects) ? allProjects : []).slice(0, 12);
        if (!projects.length) {
            showToast('暂无可选择项目', 'warning');
            return;
        }

        const html = `
            <div style="font-size:13px;color:#64748b;line-height:1.7;margin-bottom:14px;">
                先选中今天正在推进的项目，后续日志、问题、日报和会议纪要都会默认挂到这个项目下。
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;">
                ${projects.map(project => {
                    const active = Number(project.id) === Number(currentProjectId);
                    const risk = Number(project.risk_score || 0);
                    const borderColor = active ? '#14b8a6' : '#e2e8f0';
                    const bg = active ? '#f0fdfa' : '#ffffff';
                    return `
                        <button class="btn btn-outline" style="padding:16px;text-align:left;border-radius:16px;border-color:${borderColor};background:${bg};" onclick="setImplementationWorkbenchProject(${project.id});closeGenericModal();">
                            <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
                                <div style="font-weight:800;color:#0f172a;">${project.project_name || '未命名项目'}</div>
                                <div style="font-size:11px;color:${active ? '#0f766e' : '#64748b'};">${active ? '当前项目' : (project.status || '未设状态')}</div>
                            </div>
                            <div style="font-size:12px;color:#64748b;margin-top:6px;">${project.hospital_name || '-'}${project.project_manager ? ` · PM ${project.project_manager}` : ''}</div>
                            <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:12px;color:#475569;margin-top:10px;">
                                <span>进度 ${Number(project.progress || 0)}%</span>
                                <span>风险 ${risk}</span>
                                <span>逾期 ${Number(project.overdue_count || 0)}</span>
                            </div>
                        </button>
                    `;
                }).join('')}
            </div>
        `;
        showGenericModal('选择当前实施项目', html);
    };

    window.setImplementationWorkbenchProject = function (projectId) {
        currentProjectId = Number(projectId);
        renderProjectList();
        showToast('当前实施项目已切换', 'success');
        if (document.getElementById('dashboardView')?.style.display !== 'none') {
            window.renderAdvancedDashboard({ preserveProjectContext: true });
        }
    };

    window.refreshImplementationWorkbenchSnapshot = async function () {
        if (document.getElementById('dashboardView')?.style.display === 'none') return;
        await window.renderAdvancedDashboard({ preserveProjectContext: true });
    };

    window.refreshImplementationWorkbenchAfterSave = async function () {
        if (document.getElementById('dashboardView')?.style.display === 'none') return;
        await window.renderAdvancedDashboard({ preserveProjectContext: true, forceRefresh: true });
    };

    window.seedIssueFromCommunication = function (summary) {
        window.issueModalDefaults = {
            externalBlocker: true,
            severity: '高',
            issueType: '协调',
            description: truncateWorkbenchText(summary || '', 240)
        };
        window.openImplementationWorkbenchAction('issue');
    };

    window.seedWorklogFromCommunication = function (summary) {
        const workContent = truncateWorkbenchText(summary || '', 300);
        window.openImplementationWorkbenchAction('worklog').then(() => {
            const workContentEl = document.getElementById('workContent');
            const issuesEl = document.getElementById('issuesEncountered');
            if (workContentEl && !workContentEl.value.trim()) {
                workContentEl.value = workContent;
            }
            if (issuesEl && !issuesEl.value.trim() && /问题|风险|阻塞|延期|异常/i.test(workContent)) {
                issuesEl.value = workContent;
            }
        }).catch(() => {});
    };

    window.openLatestDailyArchiveFromWorkbench = function () {
        const payload = readDashboardCache()?.payload;
        const archives = Array.isArray(payload?.projectContext?.archives) ? payload.projectContext.archives : [];
        const latestDaily = archives.find(item => item.report_type === 'daily') || archives[0];
        if (!latestDaily) {
            showToast('当前项目还没有日报归档', 'warning');
            return;
        }
        if (typeof viewArchiveDetail === 'function') {
            viewArchiveDetail(latestDaily.id);
        }
    };

    window.manualGenerateDailyArchiveFromWorkbench = async function () {
        if (typeof manualGenerateArchive === 'function') {
            await manualGenerateArchive('daily');
            if (typeof window.refreshImplementationWorkbenchAfterSave === 'function') {
                await window.refreshImplementationWorkbenchAfterSave();
            }
        }
    };

    window.showImplementationIssueBoard = function () {
        const payload = readDashboardCache()?.payload;
        const issues = Array.isArray(payload?.projectContext?.openIssues) ? payload.projectContext.openIssues : [];
        if (!issues.length) {
            showToast('当前项目没有未闭环问题', 'success');
            return;
        }
        const groups = [
            {
                title: '超时未响应',
                items: issues.filter(issue => !issue.first_response_at && (hoursBetweenWorkbench(issue.created_at) === null || hoursBetweenWorkbench(issue.created_at) >= 4)),
                tone: '#b91c1c',
                bg: '#fef2f2',
                border: '#fecaca'
            },
            {
                title: '已推送未处理',
                items: issues.filter(issue => !!issue.last_wecom_push_summary && issue.status === '处理中'),
                tone: '#c2410c',
                bg: '#fff7ed',
                border: '#fed7aa'
            },
            {
                title: '待验证关闭',
                items: issues.filter(issue => issue.status === '处理中' && !!issue.first_response_at && !issue.last_wecom_push_summary),
                tone: '#1d4ed8',
                bg: '#eff6ff',
                border: '#bfdbfe'
            }
        ];
        const renderedGroups = groups.filter(group => group.items.length).map(group => `
            <div style="margin-bottom:16px;">
                <div style="font-size:14px;font-weight:800;color:${group.tone};margin-bottom:10px;">${group.title} · ${group.items.length}</div>
                ${group.items.map(issue => `
                    <div style="padding:14px;border-radius:14px;border:1px solid ${group.border};background:${group.bg};margin-bottom:12px;">
                        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
                            <div style="font-size:14px;font-weight:800;color:#0f172a;">${escapeWorkbenchHtml(issue.issue_type || '问题')}</div>
                            <div style="font-size:12px;color:${issue.severity === '高' ? '#b91c1c' : (issue.severity === '中' ? '#c2410c' : '#2563eb')};font-weight:700;">${escapeWorkbenchHtml(issue.severity || '未分级')} / ${escapeWorkbenchHtml(issue.status || '待处理')}</div>
                        </div>
                        <div style="font-size:13px;color:#334155;line-height:1.7;margin-top:8px;">${escapeWorkbenchHtml(issue.description || '无描述')}</div>
                        <div style="font-size:12px;color:#64748b;margin-top:8px;">${issue.first_response_at ? `已响应：${escapeWorkbenchHtml(String(issue.first_response_at).replace('T', ' ').slice(0, 16))}` : '尚未响应'}${issue.last_wecom_push_summary ? ` · 企微：${escapeWorkbenchHtml(issue.last_wecom_push_summary)}` : ''}</div>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
                            <button class="btn btn-outline btn-sm" onclick="pushImplementationIssueToWecom(${issue.id});closeGenericModal();">催办推送</button>
                            <button class="btn btn-outline btn-sm" onclick="advanceImplementationIssueStatus(${issue.id}, '${issue.status || '待处理'}');closeGenericModal();">推进状态</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `).join('');
        const fallbackIssues = issues.filter(issue => {
            return !groups.some(group => group.items.some(item => Number(item.id) === Number(issue.id)));
        });
        const fallbackHtml = fallbackIssues.length ? `
            <div style="margin-bottom:16px;">
                <div style="font-size:14px;font-weight:800;color:#475569;margin-bottom:10px;">其他待跟进 · ${fallbackIssues.length}</div>
                ${fallbackIssues.map(issue => `
                    <div style="padding:14px;border-radius:14px;border:1px solid #e2e8f0;background:#f8fafc;margin-bottom:12px;">
                        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
                            <div style="font-size:14px;font-weight:800;color:#0f172a;">${escapeWorkbenchHtml(issue.issue_type || '问题')}</div>
                            <div style="font-size:12px;color:${issue.severity === '高' ? '#b91c1c' : (issue.severity === '中' ? '#c2410c' : '#2563eb')};font-weight:700;">${escapeWorkbenchHtml(issue.severity || '未分级')} / ${escapeWorkbenchHtml(issue.status || '待处理')}</div>
                        </div>
                        <div style="font-size:13px;color:#334155;line-height:1.7;margin-top:8px;">${escapeWorkbenchHtml(issue.description || '无描述')}</div>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
                            <button class="btn btn-outline btn-sm" onclick="pushImplementationIssueToWecom(${issue.id});closeGenericModal();">催办推送</button>
                            <button class="btn btn-outline btn-sm" onclick="advanceImplementationIssueStatus(${issue.id}, '${issue.status || '待处理'}');closeGenericModal();">推进状态</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        ` : '';
        const html = renderedGroups + fallbackHtml;
        showGenericModal('问题闭环链路', html);
    };

    window.pushImplementationIssueToWecom = async function (issueId) {
        if (typeof pushIssueToWecom === 'function') {
            await pushIssueToWecom(issueId);
            if (typeof window.refreshImplementationWorkbenchAfterSave === 'function') {
                await window.refreshImplementationWorkbenchAfterSave();
            }
        }
    };

    window.advanceImplementationIssueStatus = async function (issueId, currentStatus) {
        const nextStatus = currentStatus === '待处理'
            ? '处理中'
            : (currentStatus === '处理中' ? '已解决' : '处理中');
        if (typeof updateIssueStatus === 'function') {
            await updateIssueStatus(issueId, nextStatus);
            showToast(`问题状态已推进到 ${nextStatus}`, 'success');
            if (typeof window.refreshImplementationWorkbenchAfterSave === 'function') {
                await window.refreshImplementationWorkbenchAfterSave();
            }
        }
    };

    window.openImplementationWorkbenchAction = async function (action) {
        const actionsWithoutProject = new Set(['meeting']);
        if (!actionsWithoutProject.has(action) && !currentProjectId) {
            window.chooseImplementationWorkbenchProject();
            return;
        }

        if (currentProjectId && (!currentProject || Number(currentProject.id) !== Number(currentProjectId))) {
            try {
                currentProject = await api.get(`/projects/${currentProjectId}`, { silent: true });
            } catch (e) {
                showToast('加载当前项目失败: ' + e.message, 'danger');
                return;
            }
        }

        if (action === 'worklog') {
            if (typeof showWorklogModal === 'function') showWorklogModal();
            return;
        }

        if (action === 'quickReport') {
            if (typeof showQuickReportModal === 'function') showQuickReportModal();
            return;
        }

        if (action === 'issue') {
            window.issueModalDefaults = {
                externalBlocker: true,
                severity: '高',
                issueType: '协调'
            };
            if (typeof showIssueModal === 'function') showIssueModal();
            return;
        }

        if (action === 'meeting') {
            if (typeof showMeetingAssistant === 'function') showMeetingAssistant();
            return;
        }

        if (action === 'dailyReport' && typeof generateDailyReport === 'function') {
            await generateDailyReport(currentProjectId);
        }
    };

    window.openBusinessFocus = function (focus) {
        const params = new URLSearchParams(window.location.search);
        if (focus) params.set('business_focus', focus);
        else params.delete('business_focus');
        const query = params.toString();
        window.history.replaceState({}, '', `${window.location.pathname}${query ? '?' + query : ''}`);
        showBusinessOverview();
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
        if (typeof window.openRoleHome === 'function') {
            await window.openRoleHome();
            return;
        }
        await window.showGlobalDashboardHome();
    };

    window.dashboardBriefingSnapshot = null;

    window.openDashboardBriefingModal = function () {
        const briefing = normalizeDashboardBriefing(window.dashboardBriefingSnapshot);
        const html = `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="btn btn-outline btn-sm" onclick="refreshDashboardBriefing()">🔄 刷新简报</button>
                    <button class="btn btn-outline btn-sm" onclick="copyDashboardBriefing()">📋 复制内容</button>
                </div>
            </div>
            <div class="markdown-content" style="line-height:1.8;color:#334155;">${renderAiMarkdown(briefing.brief || '')}</div>
        `;
        showGenericModal('📋 AI 交付决策简报', html);
    };

    window.refreshDashboardBriefing = async function () {
        try {
            const data = await api.get('/dashboard/global-briefing', { silent: true });
            window.dashboardBriefingSnapshot = normalizeDashboardBriefing(data);
            window.openDashboardBriefingModal();
            showToast('简报已刷新', 'success');
        } catch (e) {
            showToast('刷新简报失败: ' + e.message, 'danger');
        }
    };

    window.copyDashboardBriefing = async function () {
        const briefing = normalizeDashboardBriefing(window.dashboardBriefingSnapshot);
        const text = briefing.brief || '';
        if (!text.trim()) {
            showToast('当前没有可复制的简报内容', 'warning');
            return;
        }
        try {
            await navigator.clipboard.writeText(text);
            showToast('简报内容已复制', 'success');
        } catch (e) {
            showToast('复制失败: ' + e.message, 'danger');
        }
    };

    window.toggleHealthDashboard = async function () {
        const container = document.getElementById('healthDashboard');
        if (!container) return;
        window.healthDashboardVisible = !window.healthDashboardVisible;
        localStorage.setItem('health_dashboard_visible', String(window.healthDashboardVisible));
        if (window.healthDashboardVisible) {
            container.style.display = 'block';
            await window.loadHealthDashboard();
        } else {
            container.style.display = 'none';
        }
    };

    window.loadHealthDashboard = async function () {
        const container = document.getElementById('healthDashboard');
        if (!container) return;
        container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray-500);">加载中...</div>';
        try {
            const data = await api.get('/dashboard/health');
            window.renderHealthDashboard(data);
        } catch (e) {
            container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--danger);">加载失败: ${e.message}</div>`;
        }
    };

    window.renderHealthDashboard = function (data) {
        const container = document.getElementById('healthDashboard');
        if (!container) return;

        const { projects, summary } = data;
        let html = `
            <div class="health-dashboard">
                <div class="health-summary">
                    <div class="health-stat"><div class="health-stat-value">${summary.total}</div><div class="health-stat-label">活跃项目</div></div>
                    <div class="health-stat health-green"><div class="health-stat-value">🟢 ${summary.green}</div><div class="health-stat-label">健康</div></div>
                    <div class="health-stat health-yellow"><div class="health-stat-value">🟡 ${summary.yellow}</div><div class="health-stat-label">需关注</div></div>
                    <div class="health-stat health-red"><div class="health-stat-value">🔴 ${summary.red}</div><div class="health-stat-label">风险</div></div>
                </div>
                <div class="health-cards">
        `;

        for (const p of projects) {
            const statusColor = p.health_status === 'green' ? '#10b981' : p.health_status === 'yellow' ? '#f59e0b' : '#ef4444';
            const statusIcon = p.health_status === 'green' ? '🟢' : p.health_status === 'yellow' ? '🟡' : '🔴';
            html += `
                <div class="health-card" onclick="loadProjectDetail(${p.id})" style="border-left: 4px solid ${statusColor};">
                    <div class="health-card-header">
                        <span class="health-card-title">${p.project_name}</span>
                        <span class="health-score" style="color:${statusColor}">${statusIcon} ${p.health_score}分</span>
                    </div>
                    <div class="health-card-meta">${p.hospital_name} · ${p.project_manager || '未分配'}</div>
                    <div class="health-metrics">
                        <span title="进度">📊 ${p.progress || 0}%</span>
                        <span title="未解决问题">⚠️ ${p.metrics.open_issues}</span>
                        <span title="逾期里程碑">🎯 ${p.metrics.overdue_milestones}</span>
                        <span title="接口完成率">🔗 ${p.metrics.interface_rate}%</span>
                    </div>
                </div>
            `;
        }

        html += `</div></div>`;
        container.innerHTML = html;
    };
})();
