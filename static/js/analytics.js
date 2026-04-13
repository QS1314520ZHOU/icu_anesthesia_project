const performanceReviewState = {
    overview: null,
    selectedCycleId: null,
    selectedProjectId: null,
    queueFilter: 'all',
    legacy: null,
    teamTrend: null
};

function escapePerformanceHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function performanceScoreColor(score) {
    const value = Number(score || 0);
    if (value >= 90) return '#15803d';
    if (value >= 80) return '#2563eb';
    if (value >= 70) return '#c2410c';
    return '#b91c1c';
}

function performanceScoreBadge(score) {
    const value = Number(score || 0);
    if (value >= 90) return '卓越';
    if (value >= 80) return '稳健';
    if (value >= 70) return '待进阶';
    return '需关注';
}

function formatPerformanceScore(score) {
    return Number(score || 0).toFixed(1);
}

function ensurePerformanceReviewStyles() {
    if (document.getElementById('performanceReviewStyles')) return;
    const style = document.createElement('style');
    style.id = 'performanceReviewStyles';
    style.textContent = `
        .perf-shell { display:grid; gap:20px; }
        .perf-hero { display:grid; gap:16px; }
        .perf-summary-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:14px; }
        .perf-summary-card { background:white; border:1px solid var(--gray-200); border-radius:12px; padding:16px; box-shadow:none; }
        .perf-pane-grid { display:grid; grid-template-columns:1.15fr 0.85fr; gap:18px; }
        .perf-panel { background:white; border:1px solid var(--gray-200); border-radius:16px; box-shadow:none; overflow:hidden; }
        .perf-panel-head { padding:16px 18px; border-bottom:1px solid var(--gray-200); display:flex; justify-content:space-between; align-items:center; gap:12px; background:var(--gray-50); }
        .perf-project { background:white; border:1px solid var(--gray-200); border-radius:16px; overflow:hidden; box-shadow:none; }
        .perf-project-body { padding:16px; display:grid; gap:14px; }
        .perf-member-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:14px; }
        .perf-member-card { border:1px solid var(--gray-200); border-radius:16px; padding:16px; background:white; display:grid; gap:14px; }
        .perf-chip-row { display:flex; flex-wrap:wrap; gap:8px; }
        .perf-chip { padding:6px 10px; border-radius:999px; font-size:12px; font-weight:600; background:var(--gray-100); color:var(--gray-700); }
        .perf-metric-row { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; }
        .perf-metric { background:var(--gray-50); border-radius:12px; padding:10px 12px; }
        .perf-soft-list { display:grid; gap:10px; }
        .perf-soft-item { border-radius:12px; padding:12px 14px; background:var(--gray-50); }
        .perf-wall-item { border-bottom:1px dashed var(--gray-200); padding:12px 0; }
        .perf-formula-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin-top:12px; }
        .perf-formula-box { background:var(--gray-50); border:1px solid var(--gray-200); border-radius:12px; padding:14px; }
        .perf-toolbar { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; padding:14px 16px; background:white; border:1px solid var(--gray-200); border-radius:12px; }
        .perf-empty { padding:34px 16px; text-align:center; color:#64748b; }
        .perf-actions { display:flex; flex-wrap:wrap; gap:8px; }
        .perf-inline-note { font-size:12px; color:#64748b; line-height:1.7; }
        .perf-range-group { display:grid; gap:6px; margin-bottom:14px; }
        .perf-range-head { display:flex; justify-content:space-between; font-size:13px; font-weight:600; color:#1e293b; }
        .perf-range-group input[type=range] { width:100%; accent-color:#2563eb; }
        @media (max-width: 1080px) {
            .perf-pane-grid { grid-template-columns:1fr; }
        }
        @media (max-width: 720px) {
            .perf-metric-row { grid-template-columns:repeat(2,minmax(0,1fr)); }
            .perf-formula-grid { grid-template-columns:1fr; }
        }
    `;
    document.head.appendChild(style);
}

function ensurePerformanceModals() {
    if (document.getElementById('performanceReviewFormModal')) return;
    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal" id="performanceReviewFormModal">
            <div class="modal-content" style="max-width:680px;">
                <div class="modal-header">
                    <h3 id="performanceReviewFormTitle">实施侧评价研发</h3>
                    <button class="modal-close" onclick="closeModal('performanceReviewFormModal')">&times;</button>
                </div>
                <div class="modal-body">
                    <input type="hidden" id="performanceReviewCycleId">
                    <input type="hidden" id="performanceReviewTargetId">
                    <div class="perf-range-group">
                        <div class="perf-range-head"><span>责任心</span><span id="reviewResponsibilityValue">85</span></div>
                        <input type="range" id="reviewResponsibility" min="0" max="100" value="85" oninput="syncPerformanceRangeValue('reviewResponsibility','reviewResponsibilityValue')">
                    </div>
                    <div class="perf-range-group">
                        <div class="perf-range-head"><span>协作度</span><span id="reviewCollaborationValue">85</span></div>
                        <input type="range" id="reviewCollaboration" min="0" max="100" value="85" oninput="syncPerformanceRangeValue('reviewCollaboration','reviewCollaborationValue')">
                    </div>
                    <div class="perf-range-group">
                        <div class="perf-range-head"><span>响应速度</span><span id="reviewResponseValue">85</span></div>
                        <input type="range" id="reviewResponse" min="0" max="100" value="85" oninput="syncPerformanceRangeValue('reviewResponse','reviewResponseValue')">
                    </div>
                    <div class="perf-range-group">
                        <div class="perf-range-head"><span>专业度</span><span id="reviewProfessionalValue">85</span></div>
                        <input type="range" id="reviewProfessional" min="0" max="100" value="85" oninput="syncPerformanceRangeValue('reviewProfessional','reviewProfessionalValue')">
                    </div>
                    <div class="form-group">
                        <label>本周亮点</label>
                        <textarea id="performanceReviewHighlight" rows="2" placeholder="写一句值得被看见的亮点"></textarea>
                    </div>
                    <div class="form-group">
                        <label>改进建议</label>
                        <textarea id="performanceReviewSuggestion" rows="2" placeholder="给一条克制、具体、可执行的建议"></textarea>
                    </div>
                    <div class="form-group">
                        <label>证据说明</label>
                        <textarea id="performanceReviewEvidence" rows="3" placeholder="例如：本周接口联调 3 次、周三夜间远程排故、日志记录完整"></textarea>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-outline" onclick="closeModal('performanceReviewFormModal')">取消</button>
                    <button class="btn btn-primary" onclick="submitPerformanceReview()">提交周评</button>
                </div>
            </div>
        </div>

        <div class="modal" id="performanceRecognitionModal">
            <div class="modal-content" style="max-width:620px;">
                <div class="modal-header">
                    <h3 id="performanceRecognitionTitle">送一句感谢</h3>
                    <button class="modal-close" onclick="closeModal('performanceRecognitionModal')">&times;</button>
                </div>
                <div class="modal-body">
                    <input type="hidden" id="performanceRecognitionCycleId">
                    <input type="hidden" id="performanceRecognitionTargetId">
                    <div class="form-group">
                        <label>感谢类型</label>
                        <select id="performanceRecognitionType">
                            <option value="gratitude">感谢协作</option>
                            <option value="support">主动支援</option>
                            <option value="mentoring">带教分享</option>
                            <option value="rescue">关键救火</option>
                            <option value="customer_praise">客户表扬</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>标题</label>
                        <input type="text" id="performanceRecognitionText" placeholder="例如：谢谢你周三晚上把接口排障顶住了">
                    </div>
                    <div class="form-group">
                        <label>具体内容</label>
                        <textarea id="performanceRecognitionContent" rows="3" placeholder="把这次值得被看见的帮助写具体一点"></textarea>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-outline" onclick="closeModal('performanceRecognitionModal')">取消</button>
                    <button class="btn btn-success" onclick="submitPerformanceRecognition()">保存正向反馈</button>
                </div>
            </div>
        </div>

        <div class="modal" id="performanceCalibrationModal">
            <div class="modal-content" style="max-width:560px;">
                <div class="modal-header">
                    <h3 id="performanceCalibrationTitle">人工校准</h3>
                    <button class="modal-close" onclick="closeModal('performanceCalibrationModal')">&times;</button>
                </div>
                <div class="modal-body">
                    <input type="hidden" id="performanceCalibrationScorecardId">
                    <div class="perf-range-group">
                        <div class="perf-range-head"><span>校准分值</span><span id="performanceCalibrationValue">0</span></div>
                        <input type="range" id="performanceCalibrationDelta" min="-5" max="5" step="0.5" value="0" oninput="syncPerformanceRangeValue('performanceCalibrationDelta','performanceCalibrationValue')">
                    </div>
                    <div class="form-group">
                        <label>校准理由</label>
                        <textarea id="performanceCalibrationReason" rows="3" placeholder="为什么需要人工在 ±5 分内微调"></textarea>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-outline" onclick="closeModal('performanceCalibrationModal')">取消</button>
                    <button class="btn btn-warning" onclick="submitPerformanceCalibration()">保存校准</button>
                </div>
            </div>
        </div>

        <div class="modal" id="performanceAppealModal">
            <div class="modal-content" style="max-width:620px;">
                <div class="modal-header">
                    <h3 id="performanceAppealTitle">提交申诉</h3>
                    <button class="modal-close" onclick="closeModal('performanceAppealModal')">&times;</button>
                </div>
                <div class="modal-body">
                    <input type="hidden" id="performanceAppealScorecardId">
                    <div class="form-group">
                        <label>申诉理由</label>
                        <textarea id="performanceAppealReason" rows="4" placeholder="说明你认为分数需要复核的原因，例如外部阻塞未被识别、证据遗漏、责任归属不准确"></textarea>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-outline" onclick="closeModal('performanceAppealModal')">取消</button>
                    <button class="btn btn-danger" onclick="submitPerformanceAppeal()">提交申诉</button>
                </div>
            </div>
        </div>

        <div class="modal" id="performanceAppealResolveModal">
            <div class="modal-content" style="max-width:620px;">
                <div class="modal-header">
                    <h3 id="performanceAppealResolveTitle">处理申诉</h3>
                    <button class="modal-close" onclick="closeModal('performanceAppealResolveModal')">&times;</button>
                </div>
                <div class="modal-body">
                    <input type="hidden" id="performanceAppealResolveId">
                    <div class="form-group">
                        <label>处理结果</label>
                        <select id="performanceAppealResolveStatus">
                            <option value="resolved">已处理</option>
                            <option value="rejected">驳回</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>复核结论</label>
                        <textarea id="performanceAppealResolveText" rows="4" placeholder="说明复核结论，例如确认保留原分，或建议先校准后重新审批"></textarea>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-outline" onclick="closeModal('performanceAppealResolveModal')">取消</button>
                    <button class="btn btn-primary" onclick="submitPerformanceAppealResolve()">提交结论</button>
                </div>
            </div>
        </div>
    `);
}

async function initPerformanceAnalytics() {
    ensurePerformanceReviewStyles();
    ensurePerformanceModals();
    const container = document.getElementById('analyticsView');
    if (!container) return;
    if (!performanceReviewState.selectedProjectId) {
        performanceReviewState.selectedProjectId = currentProjectId || (allProjects || []).find(project => project.status !== '已删除')?.id || null;
    }

    container.innerHTML = `
        <div class="perf-shell">
            <div class="perf-hero">
                <div class="detail-header" style="margin-bottom:0;">
                    <div>
                        <h2 class="detail-title">🏅 项目研发绩效评价</h2>
                        <p class="detail-meta">按项目由现场实施/驻场同事对研发协作进行周评</p>
                    </div>
                    <div class="btn-group">
                        <button class="btn btn-outline" onclick="copyCurrentViewLink()">复制当前视图链接</button>
                        <button class="btn btn-outline" onclick="showDashboard()">← 返回仪表盘</button>
                    </div>
                </div>

                <div class="perf-toolbar">
                    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
                        <span style="font-size:13px;color:var(--gray-500);font-weight:600;">项目</span>
                        <select id="performanceProjectSelect" class="btn btn-outline" style="min-width:220px;" onchange="onPerformanceProjectChange(this.value)"></select>
                        <span style="font-size:13px;color:var(--gray-500);font-weight:600;">周评周期</span>
                        <div style="display:flex;gap:10px;flex-wrap:wrap;">
                            <select id="performanceCycleSelect" class="btn btn-outline" style="min-width:180px;" onchange="onPerformanceCycleChange(this.value)"></select>
                            <button class="btn btn-outline" onclick="jumpToCurrentPerformanceCycle()">切到本周</button>
                        </div>
                    </div>
                    <div class="perf-actions">
                        <button id="performanceCycleRebuildBtn" class="btn btn-primary" onclick="refreshCurrentPerformanceCycle(true)">🤖 AI 重算本周</button>
                        <button id="performanceReviewNotifyBtn" class="btn btn-outline" onclick="sendPerformanceReviewReminder()">提醒实施侧评分</button>
                        <button class="btn btn-success" onclick="exportCurrentPerformanceCycle('docx')">导出周评 Word</button>
                        <button class="btn btn-outline" onclick="exportCurrentPerformanceCycle('md')">导出 Markdown</button>
                        <button id="performanceCycleLockBtn" class="btn btn-outline" onclick="togglePerformanceCycleLock()">锁定周期</button>
                        <button class="btn btn-outline" onclick="loadPerformanceReviewOverview(performanceReviewState.selectedCycleId)">刷新总览</button>
                    </div>
                </div>

                <div class="panel" style="margin:0;">
                    <div class="panel-header">
                        <div>
                            <div class="panel-title">评分规则</div>
                            <div style="font-size:12px;color:var(--gray-500);margin-top:4px;">现场实施对研发协作评分；公式公开、证据可追溯、AI 只给建议不黑箱拍分</div>
                        </div>
                    </div>
                    <div class="panel-body">
                        <div class="perf-formula-grid">
                            <div class="perf-formula-box">
                                <div style="font-size:12px;color:var(--gray-500);">实施侧评价</div>
                                <div style="margin-top:6px;font-size:18px;font-weight:700;color:var(--gray-800);">35%</div>
                                <div style="margin-top:6px;font-size:12px;line-height:1.7;color:var(--gray-600);">责任心 30% + 协作度 25% + 响应速度 25% + 专业度 20%</div>
                            </div>
                            <div class="perf-formula-box">
                                <div style="font-size:12px;color:var(--gray-500);">AI 证据分</div>
                                <div style="margin-top:6px;font-size:18px;font-weight:700;color:var(--gray-800);">55%</div>
                                <div style="margin-top:6px;font-size:12px;line-height:1.7;color:var(--gray-600);">交付兑现 40 + 问题闭环 30 + 过程透明 20 + 质量稳定 10</div>
                            </div>
                            <div class="perf-formula-box">
                                <div style="font-size:12px;color:var(--gray-500);">人情味分</div>
                                <div style="margin-top:6px;font-size:18px;font-weight:700;color:var(--gray-800);">10%</div>
                                <div style="margin-top:6px;font-size:12px;line-height:1.7;color:var(--gray-600);">实施正向反馈、现场亮点、客户正反馈，只加不乱扣</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div id="performanceSummaryGrid" class="perf-summary-grid"></div>
            <div id="performanceMyReviewQueuePanel" class="perf-panel"></div>
            <div id="performanceQueueFilterPanel" class="perf-panel"></div>
            <div id="performanceRoleStatusPanel" class="perf-panel"></div>
            <div id="performanceTeamTrendPanel" class="perf-panel"></div>
            <div id="performancePaneGrid" class="perf-pane-grid"></div>
            <div id="performanceProjectList" style="display:grid;gap:18px;"></div>
            <div id="performanceLegacyPanel" class="perf-panel"></div>
        </div>
    `;

    renderPerformanceProjectSelect();
    await loadPerformanceReviewOverview();
    await loadLegacyPerformanceSnapshot();
}

async function loadPerformanceReviewOverview(cycleId = null) {
    const summary = document.getElementById('performanceSummaryGrid');
    const paneGrid = document.getElementById('performancePaneGrid');
    const projectList = document.getElementById('performanceProjectList');
    if (summary) summary.innerHTML = '<div class="perf-empty">正在整理本周绩效证据...</div>';
    if (paneGrid) paneGrid.innerHTML = '';
    if (projectList) projectList.innerHTML = '';

    try {
        if (performanceReviewState.selectedProjectId && (!currentProject || Number(currentProject.id) !== Number(performanceReviewState.selectedProjectId))) {
            try {
                currentProject = await api.get(`/projects/${performanceReviewState.selectedProjectId}`, { silent: true });
            } catch (e) { }
        }
        const params = new URLSearchParams();
        if (cycleId) params.set('cycle_id', cycleId);
        if (performanceReviewState.selectedProjectId) params.set('project_id', performanceReviewState.selectedProjectId);
        const query = params.toString() ? `?${params.toString()}` : '';
        const data = await api.get(`/performance/reviews/overview${query}`);
        performanceReviewState.overview = data;
        performanceReviewState.selectedCycleId = data?.cycle?.id || cycleId || null;
        performanceReviewState.selectedProjectId = data?.project_id || performanceReviewState.selectedProjectId;
        renderPerformanceOverview(data);
    } catch (e) {
        if (summary) summary.innerHTML = `<div class="perf-empty" style="color:#b91c1c;">绩效总览加载失败：${escapePerformanceHtml(e.message)}</div>`;
    }
}

function renderPerformanceOverview(data) {
    renderPerformanceProjectSelect();
    renderPerformanceCycleSelect(data.cycles || [], data.cycle || {});
    renderPerformanceCycleGovernance(data);
    renderPerformanceSummary(data.summary || {}, data.cycle || {});
    renderMyPerformanceReviewQueue(data);
    renderPerformanceQueueFilters(data);
    renderPerformanceRoleStatus();
    loadPerformanceTeamTrend();
    renderPerformanceSidePanels(data);
    renderPerformanceProjects(data.projects || []);
}

function renderMyPerformanceReviewQueue(data) {
    const node = document.getElementById('performanceMyReviewQueuePanel');
    if (!node) return;
    const items = (data.projects || [])
        .flatMap(project => (project.members || []).map(member => ({ ...member, project_name: project.project_name, hospital_name: project.hospital_name })))
        .filter(member => member.actions?.can_review);
    if (!items.length) {
        node.innerHTML = `
            <div class="perf-panel-head">
                <div>
                    <div style="font-size:15px;font-weight:800;color:#0f172a;">待我评分的研发对象</div>
                    <div style="font-size:12px;color:#64748b;margin-top:4px;">当前账号暂无待评分对象。</div>
                </div>
            </div>
        `;
        return;
    }
    node.innerHTML = `
        <div class="perf-panel-head">
            <div>
                <div style="font-size:15px;font-weight:800;color:#0f172a;">待我评分的研发对象</div>
                <div style="font-size:12px;color:#64748b;margin-top:4px;">优先处理这些未完成实施侧评分的研发对象。</div>
            </div>
            <span class="badge badge-warning">${items.length}</span>
        </div>
        <div style="padding:14px 16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;">
            ${items.slice(0, 6).map(member => `
                <button class="perf-soft-item" style="text-align:left;border:1px solid var(--gray-200);cursor:pointer;background:white;" onclick="openPerformanceReviewModal(${member.target_id})">
                    <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
                        <div>
                            <div style="font-size:15px;font-weight:800;color:#0f172a;">${escapePerformanceHtml(member.member_name)}</div>
                            <div style="font-size:12px;color:#64748b;margin-top:4px;">${escapePerformanceHtml(member.member_role || '研发对象')}</div>
                        </div>
                        <span class="perf-chip" style="background:#fff7ed;color:#c2410c;">待评分</span>
                    </div>
                    <div style="font-size:12px;color:#64748b;margin-top:10px;">已收 ${member.review_count || 0} 份评分 / 目标至少 2 份</div>
                </button>
            `).join('')}
        </div>
    `;
}

function renderPerformanceQueueFilters(data) {
    const node = document.getElementById('performanceQueueFilterPanel');
    if (!node) return;
    const projects = data.projects || [];
    const members = projects.flatMap(project => project.members || []);
    const counts = {
        all: members.length,
        review: members.filter(member => member.actions?.can_review).length,
        appeal: (data.pending_appeals || []).length,
    };
    const buildBtn = (key, label, count) => `
        <button class="btn ${performanceReviewState.queueFilter === key ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="setPerformanceQueueFilter('${key}')">
            ${label} <span style="margin-left:6px;opacity:0.8;">${count}</span>
        </button>
    `;
    node.innerHTML = `
        <div class="perf-panel-head">
            <div>
                <div style="font-size:15px;font-weight:800;color:#0f172a;">我的处理视角</div>
                <div style="font-size:12px;color:#64748b;margin-top:4px;">快速切到待我评分或待我处理申诉，避免在整页里找。</div>
            </div>
        </div>
        <div style="padding:14px 16px;display:flex;gap:10px;flex-wrap:wrap;">
            ${buildBtn('all', '全部研发对象', counts.all)}
            ${buildBtn('review', '待我评分', counts.review)}
            ${buildBtn('appeal', '待我处理申诉', counts.appeal)}
        </div>
    `;
}

function setPerformanceQueueFilter(filterKey) {
    performanceReviewState.queueFilter = filterKey || 'all';
    if (performanceReviewState.overview) {
        renderPerformanceQueueFilters(performanceReviewState.overview);
        renderPerformanceProjects(performanceReviewState.overview.projects || []);
    }
}

function classifyPerformanceMemberRole(member) {
    const role = String(member?.role || '');
    const isRAndD = ['研发', '开发', '后端', '前端', '测试', '产品', '架构', '算法', '平台', '接口研发'].some(keyword => role.includes(keyword));
    const isImplementation = ['现场', '驻场', '实施', '交付', '项目经理', '工程'].some(keyword => role.includes(keyword)) && !isRAndD;
    if (isRAndD) return 'rnd';
    if (isImplementation || member?.is_onsite) return 'implementation';
    return 'unknown';
}

function renderPerformanceRoleStatus() {
    const node = document.getElementById('performanceRoleStatusPanel');
    if (!node) return;
    const project = (allProjects || []).find(item => Number(item.id) === Number(performanceReviewState.selectedProjectId));
    const readiness = performanceReviewState.overview?.readiness || null;
    const implementation = readiness?.implementation_reviewers || [];
    const rnd = readiness?.rnd_targets || [];
    const unknown = readiness?.unknown_members || [];
    const renderNameList = (items, emptyText, badgeStyle = '') => {
        if (!items.length) {
            return `<div class="empty-state-hint">${emptyText}</div>`;
        }
        return items.map(item => `<span class="perf-chip" style="${badgeStyle}">${escapePerformanceHtml(item.name)}${item.role ? ` · ${escapePerformanceHtml(item.role)}` : ''}</span>`).join('');
    };
    node.innerHTML = `
        <div class="perf-panel-head">
            <div>
                <div style="font-size:16px;font-weight:800;color:#0f172a;">当前项目评分准备度</div>
                <div style="font-size:12px;color:#64748b;margin-top:4px;">一眼看清这个项目有没有实施侧评分人和研发侧对象。</div>
            </div>
            <span class="perf-chip">${escapePerformanceHtml(project?.project_name || '当前项目')}</span>
        </div>
        <div style="padding:18px;display:grid;gap:16px;">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;">
                <div class="perf-summary-card"><div style="font-size:12px;color:#64748b;">实施侧评分人</div><div style="margin-top:8px;font-size:24px;font-weight:900;color:#15803d;">${implementation.length}</div></div>
                <div class="perf-summary-card"><div style="font-size:12px;color:#64748b;">研发侧对象</div><div style="margin-top:8px;font-size:24px;font-weight:900;color:#2563eb;">${rnd.length}</div></div>
                <div class="perf-summary-card"><div style="font-size:12px;color:#64748b;">待确认身份</div><div style="margin-top:8px;font-size:24px;font-weight:900;color:#c2410c;">${unknown.length}</div></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;">
                <div class="perf-soft-item">
                    <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:10px;">实施侧评分人</div>
                    <div class="perf-chip-row">${renderNameList(implementation, '当前项目还没有明确的实施侧评分人。', 'background:#ecfdf5;color:#15803d;')}</div>
                </div>
                <div class="perf-soft-item">
                    <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:10px;">研发侧对象</div>
                    <div class="perf-chip-row">${renderNameList(rnd, '当前项目还没有明确的研发侧对象。', 'background:#eff6ff;color:#1d4ed8;')}</div>
                </div>
                <div class="perf-soft-item">
                    <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:10px;">待确认身份</div>
                    <div class="perf-chip-row">${renderNameList(unknown, '当前项目没有待确认身份的成员。', 'background:#fff7ed;color:#c2410c;')}</div>
                </div>
            </div>
            ${(!implementation.length || !rnd.length || unknown.length) ? `
                <div style="padding:14px 16px;border-radius:12px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;font-size:13px;line-height:1.8;">
                    当前项目还不能算完全进入可评分状态。建议先去项目团队补齐成员身份，再开始“实施评研发”。
                    <div style="margin-top:10px;">
                        <button class="btn btn-outline btn-sm" onclick="openPerformanceProjectTeam()">去项目团队整理成员</button>
                        <button class="btn btn-outline btn-sm" onclick="normalizeProjectMemberRoles()">批量规范角色</button>
                    </div>
                </div>
            ` : `
                <div style="padding:14px 16px;border-radius:12px;background:#ecfdf5;border:1px solid #bbf7d0;color:#166534;font-size:13px;line-height:1.8;">
                    当前项目已经具备评分条件，可以开始由实施侧对研发对象进行项目内评价。
                    <div style="margin-top:10px;">
                        <button class="btn btn-success btn-sm" onclick="showFirstReviewTarget()">开始实施侧评分</button>
                        <button class="btn btn-outline btn-sm" onclick="showFirstRecognitionTarget()">补充正向反馈</button>
                    </div>
                </div>
            `}
        </div>
    `;
}

function renderPerformanceProjectSelect() {
    const select = document.getElementById('performanceProjectSelect');
    if (!select) return;
    const projects = (allProjects || []).filter(project => project.status !== '已删除');
    select.innerHTML = projects.map(project => `
        <option value="${project.id}" ${Number(project.id) === Number(performanceReviewState.selectedProjectId) ? 'selected' : ''}>
            ${escapePerformanceHtml(project.project_name)} / ${escapePerformanceHtml(project.hospital_name || '-')}
        </option>
    `).join('');
}

function renderPerformanceCycleGovernance(data) {
    const button = document.getElementById('performanceCycleLockBtn');
    const rebuildBtn = document.getElementById('performanceCycleRebuildBtn');
    const notifyBtn = document.getElementById('performanceReviewNotifyBtn');
    if (!button) return;
    const cycle = data?.cycle || {};
    const canLock = !!data?.permissions?.can_approve;
    const locked = cycle.status === 'locked';
    button.style.display = canLock ? '' : 'none';
    button.textContent = locked ? '解锁周期' : '锁定周期';
    button.className = locked ? 'btn btn-warning' : 'btn btn-outline';
    button.style.background = '';
    button.style.color = '';
    button.style.borderColor = '';
    if (rebuildBtn) {
        rebuildBtn.disabled = !!locked;
        rebuildBtn.title = locked ? '当前周期已锁定，不能再重算分数' : '';
        rebuildBtn.style.opacity = locked ? '0.55' : '1';
        rebuildBtn.style.cursor = locked ? 'not-allowed' : 'pointer';
    }
    if (notifyBtn) {
        notifyBtn.style.display = canLock ? '' : 'none';
        notifyBtn.disabled = !!locked;
        notifyBtn.title = locked ? '当前周期已锁定，不能再发送评分提醒' : '';
        notifyBtn.style.opacity = locked ? '0.55' : '1';
        notifyBtn.style.cursor = locked ? 'not-allowed' : 'pointer';
    }
}

function renderPerformanceCycleSelect(cycles, currentCycle) {
    const select = document.getElementById('performanceCycleSelect');
    if (!select) return;
    select.innerHTML = (cycles || []).map(cycle => `
        <option value="${cycle.id}" ${Number(cycle.id) === Number(currentCycle.id) ? 'selected' : ''}>
            ${escapePerformanceHtml(cycle.title || cycle.cycle_key)}
        </option>
    `).join('');
}

function renderPerformanceSummary(summary, cycle) {
    const node = document.getElementById('performanceSummaryGrid');
    if (!node) return;
    const cards = [
        ['当前周期', cycle.title || '-', '#0f766e'],
        ['参评研发', summary.member_count || 0, '#2563eb'],
        ['项目范围', summary.project_count || 0, '#7c3aed'],
        ['平均总分', formatPerformanceScore(summary.avg_final_score), '#15803d'],
        ['已完成评分', summary.reviewed_targets || 0, '#0891b2'],
        ['已审批对象', summary.approved_targets || 0, '#4f46e5'],
        ['平均现场分', formatPerformanceScore(summary.avg_onsite_score), '#c2410c'],
        ['平均 AI 分', formatPerformanceScore(summary.avg_ai_score), '#9333ea'],
        ['待补评分', summary.pending_reviews || 0, '#b91c1c'],
        ['暖心记录', summary.recognition_count || 0, '#ea580c'],
        ['待处理申诉', summary.pending_appeals || 0, '#7c2d12'],
    ];
    node.innerHTML = cards.map(([label, value, color]) => `
        <div class="perf-summary-card">
            <div style="font-size:12px;color:#64748b;">${escapePerformanceHtml(label)}</div>
            <div style="margin-top:8px;font-size:28px;font-weight:800;color:${color};">${escapePerformanceHtml(value)}</div>
        </div>
    `).join('');
}

async function loadPerformanceTeamTrend() {
    const node = document.getElementById('performanceTeamTrendPanel');
    if (!node) return;
    node.innerHTML = '<div class="perf-empty">正在加载项目研发评分趋势...</div>';
    try {
        const params = new URLSearchParams({ limit: '12' });
        if (performanceReviewState.selectedProjectId) params.set('project_id', performanceReviewState.selectedProjectId);
        const data = await api.get(`/performance/reviews/team-trend?${params.toString()}`, { silent: true });
        performanceReviewState.teamTrend = data;
        renderPerformanceTeamTrend(data);
    } catch (e) {
        node.innerHTML = `<div class="perf-empty" style="color:#b91c1c;">项目趋势加载失败：${escapePerformanceHtml(e.message)}</div>`;
    }
}

function renderPerformanceTeamTrend(data) {
    const node = document.getElementById('performanceTeamTrendPanel');
    if (!node) return;
    const trend = data.trend || [];
    node.innerHTML = `
        <div class="perf-panel-head">
            <div>
                <div style="font-size:17px;font-weight:800;color:#0f172a;">项目研发评分趋势</div>
                <div style="font-size:12px;color:#64748b;margin-top:4px;">只看当前项目下研发被评分的连续变化。</div>
            </div>
            <span class="perf-chip" style="background:#eef2ff;color:#4338ca;">${trend.length} 个周期</span>
        </div>
        <div style="padding:18px;display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:18px;align-items:stretch;">
            <div id="performanceTeamTrendChart" style="height:320px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;"></div>
            <div style="display:grid;gap:12px;">
                <div class="perf-summary-card"><div style="font-size:12px;color:#64748b;">最新平均分</div><div style="margin-top:8px;font-size:26px;font-weight:900;color:#15803d;">${formatPerformanceScore(data.summary?.latest_avg_final_score)}</div></div>
                <div class="perf-summary-card"><div style="font-size:12px;color:#64748b;">最新参评人数</div><div style="margin-top:8px;font-size:26px;font-weight:900;color:#2563eb;">${escapePerformanceHtml(data.summary?.latest_member_count || 0)}</div></div>
            </div>
        </div>
    `;
    renderPerformanceTeamTrendChart('performanceTeamTrendChart', trend);
}

function renderPerformanceTeamTrendChart(chartId, trend) {
    if (typeof echarts === 'undefined') return;
    const node = document.getElementById(chartId);
    if (!node || !trend.length) {
        if (node) node.innerHTML = '<div class="perf-empty">暂无项目趋势数据</div>';
        return;
    }
    const chart = echarts.init(node);
    chart.setOption({
        tooltip: { trigger: 'axis' },
        legend: { data: ['平均总分', '平均现场分', '平均AI分', '平均人情味分', '待处理申诉'] },
        grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
        xAxis: { type: 'category', data: trend.map(item => item.title || item.start_date || '-') },
        yAxis: [
            { type: 'value', min: 0, max: 100, name: '分数' },
            { type: 'value', min: 0, name: '数量' }
        ],
        series: [
            { name: '平均总分', type: 'line', smooth: true, data: trend.map(item => Number(item.avg_final_score || 0)), lineStyle: { width: 4, color: '#2563eb' }, itemStyle: { color: '#2563eb' } },
            { name: '平均现场分', type: 'line', smooth: true, data: trend.map(item => Number(item.avg_onsite_score || 0)), lineStyle: { width: 2, color: '#7c3aed' }, itemStyle: { color: '#7c3aed' } },
            { name: '平均AI分', type: 'line', smooth: true, data: trend.map(item => Number(item.avg_ai_score || 0)), lineStyle: { width: 2, color: '#0f766e' }, itemStyle: { color: '#0f766e' } },
            { name: '平均人情味分', type: 'line', smooth: true, data: trend.map(item => Number(item.avg_warmth_score || 0)), lineStyle: { width: 2, color: '#ea580c' }, itemStyle: { color: '#ea580c' } },
            { name: '待处理申诉', type: 'bar', yAxisIndex: 1, data: trend.map(item => Number(item.pending_appeals || 0)), itemStyle: { color: '#f97316', opacity: 0.55 }, barMaxWidth: 24 }
        ]
    });
    window.addEventListener('resize', () => chart.resize(), { once: true });
}

function renderPerformanceSidePanels(data) {
    const node = document.getElementById('performancePaneGrid');
    if (!node) return;
    const leaderboard = (data.leaderboard || []).slice(0, 8);
    const warmWall = (data.warm_wall || []).slice(0, 8);
    const pendingAppeals = (data.pending_appeals || []).slice(0, 6);
    node.innerHTML = `
        <div class="perf-panel">
            <div class="perf-panel-head">
                <div>
                    <div style="font-size:16px;font-weight:700;color:#0f172a;">本项目研发评分榜</div>
                    <div style="font-size:12px;color:#64748b;margin-top:4px;">这是实施侧对研发协作表现的项目内评分，不是全员排行。</div>
                </div>
            </div>
            <div style="padding:8px 20px 18px 20px;">
                ${(leaderboard.length ? leaderboard : []).map((member, index) => `
                    <div class="perf-wall-item" style="display:flex;justify-content:space-between;gap:12px;align-items:center;">
                        <div>
                            <div style="font-weight:700;color:#0f172a;">${index + 1}. ${escapePerformanceHtml(member.member_name)}</div>
                            <div style="font-size:12px;color:#64748b;margin-top:4px;">现场 ${formatPerformanceScore(member.scores.onsite)} / AI ${formatPerformanceScore(member.scores.ai)} / 人情味 ${formatPerformanceScore(member.scores.warmth)}</div>
                        </div>
                        <div style="font-size:26px;font-weight:800;color:${performanceScoreColor(member.scores.final)};">${formatPerformanceScore(member.scores.final)}</div>
                    </div>
                `).join('') || '<div class="perf-empty">本周期暂无榜单数据</div>'}
            </div>
        </div>
        <div class="perf-panel">
            <div class="perf-panel-head">
                <div>
                    <div style="font-size:16px;font-weight:700;color:#0f172a;">实施反馈墙</div>
                    <div style="font-size:12px;color:#64748b;margin-top:4px;">把研发对项目协作的帮助和支援留下来。</div>
                </div>
            </div>
            <div style="padding:8px 20px 18px 20px;">
                ${(warmWall.length ? warmWall : []).map(item => `
                    <div class="perf-wall-item">
                        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
                            <div style="font-weight:700;color:#0f172a;">${escapePerformanceHtml(item.member_name)}</div>
                            <span class="perf-chip" style="background:#fff7ed;color:#c2410c;">${escapePerformanceHtml(item.project_name)}</span>
                        </div>
                        <div style="margin-top:8px;font-size:13px;color:#334155;line-height:1.8;">
                            <b>${escapePerformanceHtml(item.title)}</b>${item.content ? `：${escapePerformanceHtml(item.content)}` : ''}
                        </div>
                        <div style="margin-top:8px;font-size:12px;color:#94a3b8;">${escapePerformanceHtml(item.giver_name || '匿名同事')}</div>
                    </div>
                `).join('') || `
                    <div class="perf-empty">
                        当前项目还没有正向反馈，适合先补一条真实的协作认可。
                        <div style="margin-top:12px;">
                            <button class="btn btn-success btn-sm" onclick="showFirstRecognitionTarget()">去补正向反馈</button>
                        </div>
                    </div>
                `}
                <div style="margin-top:18px;padding-top:8px;border-top:1px solid #eef2f7;">
                    <div style="font-size:15px;font-weight:700;color:#0f172a;">待处理申诉</div>
                    <div style="font-size:12px;color:#64748b;margin-top:4px;">有人觉得分数不够准，就在这里闭环。</div>
                    <div style="margin-top:10px;">
                        ${(pendingAppeals.length ? pendingAppeals : []).map(item => `
                            <div class="perf-wall-item">
                                <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
                                    <div>
                                        <div style="font-weight:700;color:#0f172a;">${escapePerformanceHtml(item.member_name)}</div>
                                        <div style="font-size:12px;color:#64748b;margin-top:4px;">${escapePerformanceHtml(item.project_name)}</div>
                                    </div>
                                    ${data.permissions?.can_resolve_appeal ? `<button class="btn btn-outline btn-xs" onclick='openPerformanceAppealResolveModal(${item.appeal_id}, ${JSON.stringify(String(item.member_name || ''))})'>处理</button>` : ''}
                                </div>
                                <div style="margin-top:8px;font-size:13px;color:#334155;line-height:1.8;">${escapePerformanceHtml(item.appeal_reason)}</div>
                                <div style="margin-top:8px;font-size:12px;color:#94a3b8;">${escapePerformanceHtml(item.appellant_name || '')}</div>
                            </div>
                        `).join('') || '<div class="perf-empty" style="padding:20px 0;">当前没有待处理申诉。研发对象如对评分有异议，可在个人卡片里点击“提交申诉”。</div>'}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderPerformanceProjects(projects) {
    const node = document.getElementById('performanceProjectList');
    if (!node) return;
    const filteredProjects = (projects || []).map(project => {
        let members = Array.isArray(project.members) ? [...project.members] : [];
        if (performanceReviewState.queueFilter === 'review') {
            members = members.filter(member => member.actions?.can_review);
        } else if (performanceReviewState.queueFilter === 'appeal') {
            members = members.filter(member => (member.appeals || []).some(item => item.status === 'pending'));
        }
        return { ...project, members };
    }).filter(project => (project.members || []).length > 0);

    if (!filteredProjects.length) {
        node.innerHTML = `
            <div class="panel">
                <div class="panel-body">
                    <div class="empty-state">
                        <p>${performanceReviewState.queueFilter === 'review' ? '当前没有待你评分的研发对象' : performanceReviewState.queueFilter === 'appeal' ? '当前没有待你处理的申诉' : '当前项目还没有可识别的研发评分对象'}</p>
                        <div class="empty-state-hint">${performanceReviewState.queueFilter === 'review'
                            ? '如果你是实施侧评分人，先确认成员身份是否已整理完毕。'
                            : performanceReviewState.queueFilter === 'appeal'
                                ? '当前项目暂无待处理申诉，或你没有复核权限。'
                                : '先去项目团队里把成员区分成“实施侧评分人”和“研发侧被评分对象”，再回来生成项目研发评分榜。'
                        }</div>
                        <div style="margin-top:14px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                            <button class="btn btn-primary" onclick="openPerformanceProjectTeam()">去项目团队补成员</button>
                            <button class="btn btn-outline" onclick="jumpToCurrentPerformanceCycle()">切到本周周期</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        return;
    }
    node.innerHTML = filteredProjects.map(project => `
        <div class="perf-project">
            <div class="perf-panel-head" style="background:linear-gradient(180deg,#f8fafc,#ffffff);">
                <div>
                    <div style="font-size:18px;font-weight:800;color:#0f172a;">${escapePerformanceHtml(project.project_name)}</div>
                    <div style="font-size:12px;color:#64748b;margin-top:4px;">${escapePerformanceHtml(project.hospital_name || '')}</div>
                </div>
                <span class="perf-chip" style="background:#ecfeff;color:#0f766e;">${project.members.length} 位研发对象</span>
            </div>
            <div class="perf-project-body">
                <div class="perf-member-grid">
                    ${project.members.map(member => renderPerformanceMemberCard(project, member)).join('')}
                </div>
            </div>
        </div>
    `).join('');
}

function showFirstRecognitionTarget() {
    const projects = performanceReviewState.overview?.projects || [];
    const firstTarget = projects.flatMap(project => project.members || []).find(member => member.actions?.can_recognize);
    if (!firstTarget) {
        showToast('当前账号没有补充正向反馈权限，通常需要现场实施/驻场成员操作', 'warning');
        return;
    }
    openPerformanceRecognitionModal(firstTarget.target_id);
}

function showFirstReviewTarget() {
    const projects = performanceReviewState.overview?.projects || [];
    const firstTarget = projects.flatMap(project => project.members || []).find(member => member.actions?.can_review);
    if (!firstTarget) {
        showToast('当前账号没有实施侧评分权限，或者当前项目还没有可评分的研发对象', 'warning');
        return;
    }
    openPerformanceReviewModal(firstTarget.target_id);
}

function renderPerformanceMemberCard(project, member) {
    const scoreColor = performanceScoreColor(member.scores.final);
    const breakdown = member.formula?.ai_formula || {};
    const deliveryTotal = Object.values(breakdown.delivery_execution_40 || {}).reduce((sum, value) => sum + Number(value || 0), 0);
    const closureTotal = Object.values(breakdown.issue_closure_30 || {}).reduce((sum, value) => sum + Number(value || 0), 0);
    const processTotal = Object.values(breakdown.process_transparency_20 || {}).reduce((sum, value) => sum + Number(value || 0), 0);
    const qualityTotal = Object.values(breakdown.quality_stability_10 || {}).reduce((sum, value) => sum + Number(value || 0), 0);
    const reviewHint = member.review_count >= 2 ? `实施侧已收 ${member.review_count} 份评分` : `实施侧评分待补，当前 ${member.review_count} 份`;
    return `
        <div class="perf-member-card">
            <div style="display:flex;justify-content:space-between;gap:14px;align-items:flex-start;">
                <div>
                    <div style="font-size:20px;font-weight:800;color:#0f172a;">${escapePerformanceHtml(member.member_name)}</div>
                    <div style="margin-top:4px;font-size:12px;color:#64748b;">${escapePerformanceHtml(member.member_role || '未标注角色')}</div>
                    <div class="perf-chip-row" style="margin-top:10px;">
                        <span class="perf-chip">${escapePerformanceHtml(performanceScoreBadge(member.scores.final))}</span>
                        <span class="perf-chip" style="background:#ecfeff;color:#0f766e;">${escapePerformanceHtml(reviewHint)}</span>
                        ${member.approved_by ? `<span class="perf-chip" style="background:#ecfccb;color:#3f6212;">已审批</span>` : ''}
                        <span class="perf-chip" style="background:#fdf4ff;color:#a21caf;">研发被评分对象</span>
                    </div>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:12px;color:#64748b;">最终分</div>
                    <div style="font-size:34px;font-weight:900;color:${scoreColor};line-height:1;">${formatPerformanceScore(member.scores.final)}</div>
                    <div style="margin-top:6px;font-size:12px;color:#64748b;">人工校准 ${member.scores.calibration_delta >= 0 ? '+' : ''}${formatPerformanceScore(member.scores.calibration_delta)}</div>
                </div>
            </div>

            <div class="perf-metric-row">
                <div class="perf-metric"><div style="font-size:11px;color:#64748b;">实施评价</div><div style="margin-top:6px;font-size:22px;font-weight:800;color:#2563eb;">${formatPerformanceScore(member.scores.onsite)}</div></div>
                <div class="perf-metric"><div style="font-size:11px;color:#64748b;">AI 证据</div><div style="margin-top:6px;font-size:22px;font-weight:800;color:#7c3aed;">${formatPerformanceScore(member.scores.ai)}</div></div>
                <div class="perf-metric"><div style="font-size:11px;color:#64748b;">人情味分</div><div style="margin-top:6px;font-size:22px;font-weight:800;color:#ea580c;">${formatPerformanceScore(member.scores.warmth)}</div></div>
                <div class="perf-metric"><div style="font-size:11px;color:#64748b;">AI 原始建议</div><div style="margin-top:6px;font-size:22px;font-weight:800;color:#0f766e;">${formatPerformanceScore(member.scores.ai_raw)}</div></div>
            </div>

            <div class="perf-chip-row">
                <span class="perf-chip" style="background:#eef2ff;color:#4338ca;">交付 ${formatPerformanceScore(deliveryTotal)}</span>
                <span class="perf-chip" style="background:#fff7ed;color:#c2410c;">闭环 ${formatPerformanceScore(closureTotal)}</span>
                <span class="perf-chip" style="background:#ecfeff;color:#0f766e;">透明 ${formatPerformanceScore(processTotal)}</span>
                <span class="perf-chip" style="background:#f0fdf4;color:#15803d;">稳定 ${formatPerformanceScore(qualityTotal)}</span>
            </div>

            <div class="perf-soft-list">
                <div class="perf-soft-item" style="border-left:4px solid #2563eb;">
                    <div style="font-size:12px;color:#64748b;">AI 亮点</div>
                    <div style="margin-top:6px;font-size:13px;color:#334155;line-height:1.8;">${escapePerformanceHtml(member.ai_highlight || member.ai_summary || '暂无亮点摘要')}</div>
                </div>
                <div class="perf-soft-item" style="border-left:4px solid #f59e0b;">
                    <div style="font-size:12px;color:#64748b;">风险提醒</div>
                    <div style="margin-top:6px;font-size:13px;color:#334155;line-height:1.8;">${escapePerformanceHtml(member.ai_risk || '本周暂无显著风险提醒')}</div>
                </div>
                <div class="perf-soft-item" style="border-left:4px solid #10b981;">
                    <div style="font-size:12px;color:#64748b;">支持建议</div>
                    <div style="margin-top:6px;font-size:13px;color:#334155;line-height:1.8;">${escapePerformanceHtml(member.ai_support || '建议继续保持节奏，并沉淀复盘内容')}</div>
                </div>
            </div>

            <div class="perf-inline-note">
                信号：日志 ${member.signals.logs} / 任务 ${member.signals.tasks} / 阶段 ${member.signals.stages} / 问题 ${member.signals.issues}
            </div>

            <div class="perf-actions">
                ${member.actions.can_review ? `<button class="btn btn-primary btn-sm" onclick="openPerformanceReviewModal(${member.target_id})">实施侧评分</button>` : ''}
                ${member.actions.can_recognize ? `<button class="btn btn-success btn-sm" onclick="openPerformanceRecognitionModal(${member.target_id})">补充正向反馈</button>` : ''}
                <button class="btn btn-outline btn-sm" onclick="showPerformanceProfile(${member.target_id})">个人画像</button>
                <button class="btn btn-outline btn-sm" onclick="showPerformanceTrend(${member.target_id})">趋势历史</button>
                <button class="btn btn-outline btn-sm" onclick="showPerformanceFormulaDetail(${member.target_id})">公式明细</button>
                ${member.actions.can_appeal ? `<button class="btn btn-danger btn-sm" onclick="openPerformanceAppealModal(${member.target_id})">提交申诉</button>` : ''}
                ${member.actions.can_calibrate && member.scorecard_id ? `<button class="btn btn-warning btn-sm" onclick="openPerformanceCalibrationModal(${member.target_id})">人工校准</button>` : ''}
                ${member.actions.can_approve && member.scorecard_id ? `<button class="btn btn-outline btn-sm" onclick="approvePerformanceScorecard(${member.scorecard_id})">审批锁定</button>` : ''}
            </div>
        </div>
    `;
}

function syncPerformanceRangeValue(inputId, displayId) {
    const input = document.getElementById(inputId);
    const display = document.getElementById(displayId);
    if (!input || !display) return;
    display.textContent = input.value;
}

function getPerformanceTarget(targetId) {
    const projects = performanceReviewState.overview?.projects || [];
    for (const project of projects) {
        const found = (project.members || []).find(item => Number(item.target_id) === Number(targetId));
        if (found) return { project, member: found };
    }
    return null;
}

function onPerformanceCycleChange(value) {
    performanceReviewState.selectedCycleId = value ? Number(value) : null;
    loadPerformanceReviewOverview(performanceReviewState.selectedCycleId);
}

function onPerformanceProjectChange(value) {
    performanceReviewState.selectedProjectId = value ? Number(value) : null;
    loadPerformanceReviewOverview(performanceReviewState.selectedCycleId);
}

async function jumpToCurrentPerformanceCycle() {
    try {
        const cycle = await api.post('/performance/reviews/cycles/ensure', {});
        performanceReviewState.selectedCycleId = cycle.id;
        await loadPerformanceReviewOverview(cycle.id);
        showToast('已切换到本周项目周评周期', 'success');
    } catch (e) {
        showToast(`切换本周失败: ${e.message}`, 'danger');
    }
}

async function refreshCurrentPerformanceCycle(useAi = true) {
    const cycleId = performanceReviewState.selectedCycleId || performanceReviewState.overview?.cycle?.id;
    if (!cycleId) return;
    if (performanceReviewState.overview?.cycle?.status === 'locked') {
        showToast('当前周期已锁定，不能再重算分数', 'warning');
        return;
    }
    try {
        await api.post(`/performance/reviews/cycles/${cycleId}/rebuild`, { use_ai: !!useAi, project_id: performanceReviewState.selectedProjectId });
        await loadPerformanceReviewOverview(cycleId);
        showToast(useAi ? '当前项目的 AI 评分已重算' : '当前项目评分已刷新', 'success');
    } catch (e) {
        showToast(`重算失败: ${e.message}`, 'danger');
    }
}

async function togglePerformanceCycleLock() {
    const cycle = performanceReviewState.overview?.cycle;
    if (!cycle?.id) return;
    const nextStatus = cycle.status === 'locked' ? 'active' : 'locked';
    const confirmText = nextStatus === 'locked'
        ? '锁定后将禁止继续提交评分、正向反馈和人工校准，确定继续吗？'
        : '解锁后将允许继续编辑本周期评分，确定继续吗？';
    if (!confirm(confirmText)) return;
    try {
        await api.post(`/performance/reviews/cycles/${cycle.id}/status`, { status: nextStatus });
        await loadPerformanceReviewOverview(cycle.id);
        showToast(nextStatus === 'locked' ? '周期已锁定' : '周期已解锁', 'success');
    } catch (e) {
        showToast(`更新周期状态失败: ${e.message}`, 'danger');
    }
}

function exportCurrentPerformanceCycle(format = 'docx') {
    const cycleId = performanceReviewState.selectedCycleId || performanceReviewState.overview?.cycle?.id;
    if (!cycleId) return;
    const params = new URLSearchParams({ format });
    if (performanceReviewState.selectedProjectId) params.set('project_id', performanceReviewState.selectedProjectId);
    window.open(`/api/performance/reviews/cycles/${cycleId}/export?${params.toString()}`, '_blank');
}

async function sendPerformanceReviewReminder() {
    const cycleId = performanceReviewState.selectedCycleId || performanceReviewState.overview?.cycle?.id;
    const projectId = performanceReviewState.selectedProjectId;
    if (!cycleId || !projectId) return;
    if (performanceReviewState.overview?.cycle?.status === 'locked') {
        showToast('当前周期已锁定，不能再发送评分提醒', 'warning');
        return;
    }
    try {
        const res = await api.post(`/performance/reviews/cycles/${cycleId}/notify`, { project_id: projectId });
        showToast(res.message || `已发送 ${res.created || 0} 条提醒`, 'success');
        if (typeof loadUnreadCount === 'function') {
            await loadUnreadCount();
        }
    } catch (e) {
        showToast(`发送提醒失败: ${e.message}`, 'danger');
    }
}

function openPerformanceProjectTeam() {
    const projectId = performanceReviewState.selectedProjectId;
    if (!projectId) {
        showToast('请先选择项目', 'warning');
        return;
    }
    loadProjectDetail(projectId);
    setTimeout(() => {
        const teamTab = document.querySelector('#projectDetailView .tab[onclick*="team"]');
        if (teamTab) {
            switchTab(teamTab, 'team');
        }
    }, 300);
}

function openPerformanceReviewModal(targetId) {
    const target = getPerformanceTarget(targetId);
    if (!target) return;
    const review = target.member.my_review || {};
    document.getElementById('performanceReviewFormTitle').textContent = `实施侧评价研发 · ${target.member.member_name}`;
    document.getElementById('performanceReviewCycleId').value = performanceReviewState.overview?.cycle?.id || '';
    document.getElementById('performanceReviewTargetId').value = target.member.target_id;
    document.getElementById('reviewResponsibility').value = review.score_responsibility || 85;
    document.getElementById('reviewCollaboration').value = review.score_collaboration || 85;
    document.getElementById('reviewResponse').value = review.score_response || 85;
    document.getElementById('reviewProfessional').value = review.score_professional || 85;
    document.getElementById('performanceReviewHighlight').value = review.highlight || '';
    document.getElementById('performanceReviewSuggestion').value = review.suggestion || '';
    document.getElementById('performanceReviewEvidence').value = review.evidence_note || '';
    syncPerformanceRangeValue('reviewResponsibility', 'reviewResponsibilityValue');
    syncPerformanceRangeValue('reviewCollaboration', 'reviewCollaborationValue');
    syncPerformanceRangeValue('reviewResponse', 'reviewResponseValue');
    syncPerformanceRangeValue('reviewProfessional', 'reviewProfessionalValue');
    openModal('performanceReviewFormModal', { reset: false });
}

async function submitPerformanceReview() {
    const cycleId = Number(document.getElementById('performanceReviewCycleId').value || 0);
    const targetId = Number(document.getElementById('performanceReviewTargetId').value || 0);
    const payload = {
        cycle_id: cycleId,
        target_id: targetId,
        score_responsibility: Number(document.getElementById('reviewResponsibility').value || 0),
        score_collaboration: Number(document.getElementById('reviewCollaboration').value || 0),
        score_response: Number(document.getElementById('reviewResponse').value || 0),
        score_professional: Number(document.getElementById('reviewProfessional').value || 0),
        highlight: document.getElementById('performanceReviewHighlight').value.trim(),
        suggestion: document.getElementById('performanceReviewSuggestion').value.trim(),
        evidence_note: document.getElementById('performanceReviewEvidence').value.trim()
    };
    try {
        await api.post('/performance/reviews/forms', payload);
        closeModal('performanceReviewFormModal');
        await loadPerformanceReviewOverview(cycleId);
        showToast('实施侧评分已保存', 'success');
    } catch (e) {
        showToast(`保存实施侧评分失败: ${e.message}`, 'danger');
    }
}

function openPerformanceRecognitionModal(targetId) {
    const target = getPerformanceTarget(targetId);
    if (!target) return;
    document.getElementById('performanceRecognitionTitle').textContent = `补充正向协作反馈 · ${target.member.member_name}`;
    document.getElementById('performanceRecognitionCycleId').value = performanceReviewState.overview?.cycle?.id || '';
    document.getElementById('performanceRecognitionTargetId').value = target.member.target_id;
    document.getElementById('performanceRecognitionType').value = 'gratitude';
    document.getElementById('performanceRecognitionText').value = '';
    document.getElementById('performanceRecognitionContent').value = '';
    openModal('performanceRecognitionModal', { reset: false });
}

async function submitPerformanceRecognition() {
    const cycleId = Number(document.getElementById('performanceRecognitionCycleId').value || 0);
    const targetId = Number(document.getElementById('performanceRecognitionTargetId').value || 0);
    const payload = {
        cycle_id: cycleId,
        target_id: targetId,
        recognition_type: document.getElementById('performanceRecognitionType').value,
        title: document.getElementById('performanceRecognitionText').value.trim(),
        content: document.getElementById('performanceRecognitionContent').value.trim()
    };
    try {
        await api.post('/performance/reviews/recognitions', payload);
        closeModal('performanceRecognitionModal');
        await loadPerformanceReviewOverview(cycleId);
        showToast('正向协作反馈已保存', 'success');
    } catch (e) {
        showToast(`保存正向反馈失败: ${e.message}`, 'danger');
    }
}

function openPerformanceCalibrationModal(targetId) {
    const target = getPerformanceTarget(targetId);
    if (!target || !target.member.scorecard_id) return;
    document.getElementById('performanceCalibrationTitle').textContent = `人工校准 · ${target.member.member_name}`;
    document.getElementById('performanceCalibrationScorecardId').value = target.member.scorecard_id;
    document.getElementById('performanceCalibrationDelta').value = target.member.scores.calibration_delta || 0;
    document.getElementById('performanceCalibrationReason').value = target.member.calibrated_reason || '';
    syncPerformanceRangeValue('performanceCalibrationDelta', 'performanceCalibrationValue');
    openModal('performanceCalibrationModal', { reset: false });
}

async function submitPerformanceCalibration() {
    const scorecardId = Number(document.getElementById('performanceCalibrationScorecardId').value || 0);
    const payload = {
        delta: Number(document.getElementById('performanceCalibrationDelta').value || 0),
        reason: document.getElementById('performanceCalibrationReason').value.trim()
    };
    try {
        await api.post(`/performance/reviews/scorecards/${scorecardId}/calibrate`, payload);
        closeModal('performanceCalibrationModal');
        await loadPerformanceReviewOverview(performanceReviewState.selectedCycleId);
        showToast('人工校准已保存', 'success');
    } catch (e) {
        showToast(`人工校准失败: ${e.message}`, 'danger');
    }
}

async function approvePerformanceScorecard(scorecardId) {
    try {
        await api.post(`/performance/reviews/scorecards/${scorecardId}/approve`, {});
        await loadPerformanceReviewOverview(performanceReviewState.selectedCycleId);
        showToast('评分卡已审批锁定', 'success');
    } catch (e) {
        showToast(`审批失败: ${e.message}`, 'danger');
    }
}

function openPerformanceAppealModal(targetId) {
    const target = getPerformanceTarget(targetId);
    if (!target || !target.member.scorecard_id) return;
    document.getElementById('performanceAppealTitle').textContent = `提交申诉 · ${target.member.member_name}`;
    document.getElementById('performanceAppealScorecardId').value = target.member.scorecard_id;
    document.getElementById('performanceAppealReason').value = '';
    openModal('performanceAppealModal', { reset: false });
}

async function submitPerformanceAppeal() {
    const scorecardId = Number(document.getElementById('performanceAppealScorecardId').value || 0);
    const payload = {
        appeal_reason: document.getElementById('performanceAppealReason').value.trim()
    };
    try {
        await api.post(`/performance/reviews/scorecards/${scorecardId}/appeals`, payload);
        closeModal('performanceAppealModal');
        await loadPerformanceReviewOverview(performanceReviewState.selectedCycleId);
        showToast('申诉已提交，等待复核', 'success');
    } catch (e) {
        showToast(`提交申诉失败: ${e.message}`, 'danger');
    }
}

function openPerformanceAppealResolveModal(appealId, memberName) {
    document.getElementById('performanceAppealResolveTitle').textContent = `处理申诉 · ${memberName || ''}`;
    document.getElementById('performanceAppealResolveId').value = appealId;
    document.getElementById('performanceAppealResolveStatus').value = 'resolved';
    document.getElementById('performanceAppealResolveText').value = '';
    openModal('performanceAppealResolveModal', { reset: false });
}

async function submitPerformanceAppealResolve() {
    const appealId = Number(document.getElementById('performanceAppealResolveId').value || 0);
    const payload = {
        status: document.getElementById('performanceAppealResolveStatus').value,
        resolution_text: document.getElementById('performanceAppealResolveText').value.trim()
    };
    try {
        await api.post(`/performance/reviews/appeals/${appealId}/resolve`, payload);
        closeModal('performanceAppealResolveModal');
        await loadPerformanceReviewOverview(performanceReviewState.selectedCycleId);
        showToast('申诉处理结果已保存', 'success');
    } catch (e) {
        showToast(`处理申诉失败: ${e.message}`, 'danger');
    }
}

async function showPerformanceTrend(targetId) {
    const target = getPerformanceTarget(targetId);
    if (!target) return;
    try {
        const data = await api.get(`/performance/reviews/trend?project_id=${encodeURIComponent(target.project.project_id)}&member_name=${encodeURIComponent(target.member.member_name)}`);
        const trend = data.trend || [];
        const chartId = `performanceTrendChart_${target.member.target_id}`;
        const rows = trend.length ? trend.map(item => `
            <tr>
                <td>${escapePerformanceHtml(item.title)}</td>
                <td>${formatPerformanceScore(item.onsite_score)}</td>
                <td>${formatPerformanceScore(item.ai_score)}</td>
                <td>${formatPerformanceScore(item.warmth_score)}</td>
                <td style="font-weight:700;color:${performanceScoreColor(item.final_score)};">${formatPerformanceScore(item.final_score)}</td>
                <td>${item.approved_by ? '已审批' : '未审批'}</td>
            </tr>
        `).join('') : '<tr><td colspan="6" style="text-align:center;">暂无历史周期数据</td></tr>';
        const html = `
            <div style="display:grid;gap:18px;">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;">
                    <div class="perf-summary-card"><div style="font-size:12px;color:#64748b;">历史周期</div><div style="margin-top:8px;font-size:24px;font-weight:800;color:#2563eb;">${escapePerformanceHtml(data.summary?.cycles || 0)}</div></div>
                    <div class="perf-summary-card"><div style="font-size:12px;color:#64748b;">平均总分</div><div style="margin-top:8px;font-size:24px;font-weight:800;color:#15803d;">${formatPerformanceScore(data.summary?.avg_final_score)}</div></div>
                    <div class="perf-summary-card"><div style="font-size:12px;color:#64748b;">最高总分</div><div style="margin-top:8px;font-size:24px;font-weight:800;color:#7c3aed;">${formatPerformanceScore(data.summary?.best_final_score)}</div></div>
                    <div class="perf-summary-card"><div style="font-size:12px;color:#64748b;">最低总分</div><div style="margin-top:8px;font-size:24px;font-weight:800;color:#c2410c;">${formatPerformanceScore(data.summary?.lowest_final_score)}</div></div>
                </div>
                <div id="${chartId}" style="height:320px;border:1px solid #e2e8f0;border-radius:16px;background:#fff;"></div>
                <div class="table-container">
                    <table class="table">
                        <thead><tr><th>周期</th><th>现场分</th><th>AI 分</th><th>人情味分</th><th>最终分</th><th>状态</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>
        `;
        showGenericModal(`趋势历史 · ${target.member.member_name}`, html);
        renderPerformanceTrendChart(chartId, trend);
    } catch (e) {
        showToast(`加载趋势失败: ${e.message}`, 'danger');
    }
}

async function showPerformanceProfile(targetId) {
    const target = getPerformanceTarget(targetId);
    if (!target) return;
    try {
        const data = await api.get(`/performance/reviews/profile?project_id=${encodeURIComponent(target.project.project_id)}&member_name=${encodeURIComponent(target.member.member_name)}`);
        const latest = data.latest_scorecard || {};
        const strengths = (data.strength_tags || []).map(item => `<span class="perf-chip" style="background:#ecfeff;color:#0f766e;">${escapePerformanceHtml(item)}</span>`).join('');
        const focus = (data.focus_points || []).map(item => `<div class="perf-soft-item" style="border-left:4px solid #f59e0b;">${escapePerformanceHtml(item)}</div>`).join('');
        const recognitions = (data.recognitions || []).slice(0, 5).map(item => `
            <div class="perf-wall-item">
                <div style="font-weight:700;color:#0f172a;">${escapePerformanceHtml(item.title || '感谢你')}</div>
                <div style="margin-top:6px;font-size:13px;color:#334155;line-height:1.8;">${escapePerformanceHtml(item.content || '')}</div>
                <div style="margin-top:6px;font-size:12px;color:#94a3b8;">${escapePerformanceHtml(item.giver_name || '')}</div>
            </div>
        `).join('') || '<div class="perf-empty" style="padding:20px 0;">暂无暖心记录</div>';
        const worklogs = (data.recent_worklogs || []).slice(0, 5).map(item => `
            <div class="perf-wall-item">
                <div style="font-weight:700;color:#0f172a;">${escapePerformanceHtml(item.log_date || '')}</div>
                <div style="margin-top:6px;font-size:13px;color:#334155;line-height:1.8;">${escapePerformanceHtml(item.work_content || '无内容')}</div>
                ${item.tomorrow_plan ? `<div style="margin-top:6px;font-size:12px;color:#64748b;">明日计划：${escapePerformanceHtml(item.tomorrow_plan)}</div>` : ''}
            </div>
        `).join('') || '<div class="perf-empty" style="padding:20px 0;">暂无近期日志</div>';
        const trendChartId = `performanceProfileTrend_${target.member.target_id}`;
        const html = `
            <div style="display:grid;gap:18px;">
                <div style="display:flex;justify-content:space-between;gap:18px;flex-wrap:wrap;align-items:flex-start;">
                    <div>
                        <div style="font-size:24px;font-weight:900;color:#0f172a;">${escapePerformanceHtml(data.member_name)}</div>
                        <div style="margin-top:4px;font-size:13px;color:#64748b;">${escapePerformanceHtml(data.member?.role || target.member.member_role || '未标注角色')}</div>
                        <div class="perf-chip-row" style="margin-top:12px;">${strengths || '<span class="perf-chip">持续成长中</span>'}</div>
                        <button class="btn btn-primary btn-sm" style="margin-top:14px;" onclick='exportPerformanceProfile(${target.project.project_id}, ${JSON.stringify(String(target.member.member_name || ''))})'>导出个人画像 Word</button>
                    </div>
                    <div style="display:grid;grid-template-columns:repeat(2,minmax(140px,1fr));gap:12px;min-width:320px;">
                        <div class="perf-summary-card"><div style="font-size:12px;color:#64748b;">当前最终分</div><div style="margin-top:8px;font-size:26px;font-weight:900;color:${performanceScoreColor(latest.final_score)};">${formatPerformanceScore(latest.final_score)}</div></div>
                        <div class="perf-summary-card"><div style="font-size:12px;color:#64748b;">平均总分</div><div style="margin-top:8px;font-size:26px;font-weight:900;color:#15803d;">${formatPerformanceScore(data.trend_summary?.avg_final_score)}</div></div>
                        <div class="perf-summary-card"><div style="font-size:12px;color:#64748b;">历史最高</div><div style="margin-top:8px;font-size:26px;font-weight:900;color:#7c3aed;">${formatPerformanceScore(data.trend_summary?.best_final_score)}</div></div>
                        <div class="perf-summary-card"><div style="font-size:12px;color:#64748b;">历史最低</div><div style="margin-top:8px;font-size:26px;font-weight:900;color:#c2410c;">${formatPerformanceScore(data.trend_summary?.lowest_final_score)}</div></div>
                    </div>
                </div>
                <div id="${trendChartId}" style="height:300px;border:1px solid #e2e8f0;border-radius:16px;background:#fff;"></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
                    <div class="perf-panel" style="box-shadow:none;">
                        <div class="perf-panel-head"><div style="font-size:15px;font-weight:700;color:#0f172a;">优势标签</div></div>
                        <div style="padding:16px;display:grid;gap:10px;">${strengths || '<div class="perf-empty" style="padding:20px 0;">暂无优势标签</div>'}</div>
                    </div>
                    <div class="perf-panel" style="box-shadow:none;">
                        <div class="perf-panel-head"><div style="font-size:15px;font-weight:700;color:#0f172a;">当前关注点</div></div>
                        <div style="padding:16px;display:grid;gap:10px;">${focus}</div>
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
                    <div class="perf-panel" style="box-shadow:none;">
                        <div class="perf-panel-head"><div style="font-size:15px;font-weight:700;color:#0f172a;">近期暖心记录</div></div>
                        <div style="padding:0 16px 16px 16px;">${recognitions}</div>
                    </div>
                    <div class="perf-panel" style="box-shadow:none;">
                        <div class="perf-panel-head"><div style="font-size:15px;font-weight:700;color:#0f172a;">近期工作日志</div></div>
                        <div style="padding:0 16px 16px 16px;">${worklogs}</div>
                    </div>
                </div>
            </div>
        `;
        showGenericModal(`个人画像 · ${target.member.member_name}`, html);
        renderPerformanceTrendChart(trendChartId, data.trend || []);
    } catch (e) {
        showToast(`加载个人画像失败: ${e.message}`, 'danger');
    }
}

function exportPerformanceProfile(projectId, memberName) {
    if (!projectId || !memberName) return;
    window.open(`/api/performance/reviews/profile/export?project_id=${encodeURIComponent(projectId)}&member_name=${encodeURIComponent(memberName)}`, '_blank');
}

function renderPerformanceTrendChart(chartId, trend) {
    if (typeof echarts === 'undefined') return;
    const node = document.getElementById(chartId);
    if (!node || !trend.length) return;
    const chart = echarts.init(node);
    chart.setOption({
        tooltip: { trigger: 'axis' },
        legend: { data: ['最终分', '现场分', 'AI分', '人情味分'] },
        grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
        xAxis: {
            type: 'category',
            data: trend.map(item => item.title || item.start_date || '-')
        },
        yAxis: {
            type: 'value',
            min: 0,
            max: 100
        },
        series: [
            {
                name: '最终分',
                type: 'line',
                smooth: true,
                data: trend.map(item => Number(item.final_score || 0)),
                lineStyle: { width: 4, color: '#2563eb' },
                itemStyle: { color: '#2563eb' }
            },
            {
                name: '现场分',
                type: 'line',
                smooth: true,
                data: trend.map(item => Number(item.onsite_score || 0)),
                lineStyle: { width: 2, color: '#7c3aed' },
                itemStyle: { color: '#7c3aed' }
            },
            {
                name: 'AI分',
                type: 'line',
                smooth: true,
                data: trend.map(item => Number(item.ai_score || 0)),
                lineStyle: { width: 2, color: '#0f766e' },
                itemStyle: { color: '#0f766e' }
            },
            {
                name: '人情味分',
                type: 'line',
                smooth: true,
                data: trend.map(item => Number(item.warmth_score || 0)),
                lineStyle: { width: 2, color: '#ea580c' },
                itemStyle: { color: '#ea580c' }
            }
        ]
    });
    window.addEventListener('resize', () => chart.resize(), { once: true });
}

function showPerformanceFormulaDetail(targetId) {
    const target = getPerformanceTarget(targetId);
    if (!target) return;
    const member = target.member;
    const formula = member.formula || {};
    const evidence = member.evidence || {};
    const ai = member.scores || {};
    const html = `
        <div style="display:grid;gap:18px;">
            <div style="padding:16px;border-radius:16px;background:#f8fafc;border:1px solid #e2e8f0;">
                <div style="font-size:18px;font-weight:800;color:#0f172a;">${escapePerformanceHtml(member.member_name)} · 公式拆解</div>
                <div style="margin-top:10px;font-size:13px;color:#475569;line-height:1.9;">
                    最终分 = ${formatPerformanceScore(ai.onsite)}×35% + ${formatPerformanceScore(ai.ai)}×55% + ${formatPerformanceScore(ai.warmth)}×10% + ${formatPerformanceScore(ai.calibration_delta)}
                </div>
                <div style="margin-top:8px;font-size:28px;font-weight:900;color:${performanceScoreColor(ai.final)};">${formatPerformanceScore(ai.final)}</div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;">
                <div style="padding:14px;border-radius:14px;background:#eef2ff;"><div style="font-size:12px;color:#64748b;">实施评价分</div><div style="margin-top:8px;font-size:22px;font-weight:800;color:#4338ca;">${formatPerformanceScore(ai.onsite)}</div><div style="margin-top:6px;font-size:12px;line-height:1.7;color:#475569;">${escapePerformanceHtml(formula.onsite_formula || '')}</div></div>
                <div style="padding:14px;border-radius:14px;background:#f5f3ff;"><div style="font-size:12px;color:#64748b;">AI 证据分</div><div style="margin-top:8px;font-size:22px;font-weight:800;color:#7c3aed;">${formatPerformanceScore(ai.ai)}</div><div style="margin-top:6px;font-size:12px;line-height:1.8;color:#475569;">AI 原始建议 ${formatPerformanceScore(ai.ai_raw)}，已按公平约束夹在证据基线附近。</div></div>
                <div style="padding:14px;border-radius:14px;background:#fff7ed;"><div style="font-size:12px;color:#64748b;">正向反馈分</div><div style="margin-top:8px;font-size:22px;font-weight:800;color:#ea580c;">${formatPerformanceScore(ai.warmth)}</div><div style="margin-top:6px;font-size:12px;line-height:1.8;color:#475569;">实施正向反馈、亮点反馈、客户正反馈，只做加分。</div></div>
            </div>
            <div style="padding:16px;border-radius:16px;background:white;border:1px solid #e2e8f0;">
                <div style="font-size:15px;font-weight:700;color:#0f172a;">AI 证据项</div>
                <pre style="margin-top:10px;white-space:pre-wrap;font-size:12px;line-height:1.8;color:#334155;background:#f8fafc;border-radius:12px;padding:14px;">${escapePerformanceHtml(JSON.stringify(formula.ai_formula || {}, null, 2))}</pre>
            </div>
            <div style="padding:16px;border-radius:16px;background:white;border:1px solid #e2e8f0;">
                <div style="font-size:15px;font-weight:700;color:#0f172a;">证据链</div>
                <pre style="margin-top:10px;white-space:pre-wrap;font-size:12px;line-height:1.8;color:#334155;background:#f8fafc;border-radius:12px;padding:14px;">${escapePerformanceHtml(JSON.stringify(evidence, null, 2))}</pre>
            </div>
        </div>
    `;
    showGenericModal(`公式明细 · ${member.member_name}`, html);
}

async function loadLegacyPerformanceSnapshot() {
    const node = document.getElementById('performanceLegacyPanel');
    if (!node) return;
    node.innerHTML = '<div class="perf-empty">正在加载历史奖金与负载参考视角...</div>';
    try {
        const [legacyPerf, workload] = await Promise.all([
            api.get('/analytics/performance', { silent: true }).catch(() => []),
            api.get('/analytics/workload', { silent: true }).catch(() => ({}))
        ]);
        performanceReviewState.legacy = { legacyPerf, workload };
        node.innerHTML = `
            <div class="perf-panel-head">
                <div>
                    <div style="font-size:16px;font-weight:700;color:#0f172a;">历史奖金与负载参考</div>
                    <div style="font-size:12px;color:#64748b;margin-top:4px;">这一栏不参与新周评公式，只作为管理侧辅助视角。</div>
                </div>
            </div>
            <div style="padding:18px;display:grid;gap:18px;">
                <div class="table-container">
                    <table class="table">
                        <thead><tr><th>人员</th><th>完工阶段</th><th>阶段奖金</th><th>出差成本</th><th>净绩效</th></tr></thead>
                        <tbody>
                            ${(legacyPerf || []).length ? legacyPerf.map(item => `
                                <tr>
                                    <td>${escapePerformanceHtml(item.name)}</td>
                                    <td>${escapePerformanceHtml(item.stage_count)}</td>
                                    <td style="color:#15803d;">+￥${Number(item.total_bonus || 0).toLocaleString()}</td>
                                    <td style="color:#b91c1c;">-￥${Number(item.total_expense || 0).toLocaleString()}</td>
                                    <td style="font-weight:700;color:#1d4ed8;">￥${Number(item.net_performance || 0).toLocaleString()}</td>
                                </tr>
                            `).join('') : '<tr><td colspan="5" style="text-align:center;">暂无历史奖金绩效数据</td></tr>'}
                        </tbody>
                    </table>
                </div>
                <div class="perf-summary-grid">
                    ${((workload.workload || []).slice(0, 6)).map(item => `
                        <div class="perf-summary-card">
                            <div style="font-size:12px;color:#64748b;">${escapePerformanceHtml(item.name)}</div>
                            <div style="margin-top:8px;font-size:24px;font-weight:800;color:#2563eb;">${escapePerformanceHtml(item.active_projects || 0)}</div>
                            <div style="margin-top:6px;font-size:12px;color:#64748b;">活跃项目数</div>
                        </div>
                    `).join('') || '<div class="perf-empty">暂无负载参考数据</div>'}
                </div>
            </div>
        `;
    } catch (e) {
        node.innerHTML = `<div class="perf-empty" style="color:#b91c1c;">历史参考加载失败：${escapePerformanceHtml(e.message)}</div>`;
    }
}
