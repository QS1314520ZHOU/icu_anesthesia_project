// Project detail editing helpers extracted from main.js

function switchTab(tabEl, tabName) {
    currentActiveTab = tabName;

    const root = document.getElementById('projectDetailView');
    if (!root) return;

    root.querySelectorAll('.tabs .tab').forEach(tab => tab.classList.remove('active'));
    if (tabEl) tabEl.classList.add('active');

    root.querySelectorAll('.tab-content').forEach(panel => panel.classList.remove('active'));
    const target = document.getElementById(`tab-${tabName}`);
    if (target) target.classList.add('active');

    if (!currentProjectId) return;

    try {
        if (tabName === 'pulse' && typeof renderBurndownInDetail === 'function') {
            renderBurndownInDetail(currentProjectId);
        } else if (tabName === 'communications' && typeof loadCommunications === 'function') {
            loadCommunications(currentProjectId);
        } else if (tabName === 'flow' && typeof renderInterfaceFlow === 'function') {
            renderInterfaceFlow();
        } else if (tabName === 'standup' && typeof loadStandupData === 'function') {
            const dateStr = document.getElementById('standupDatePicker')?.value || '';
            loadStandupData(currentProjectId, dateStr);
        } else if (tabName === 'deviation' && typeof loadDeviationAnalysis === 'function') {
            loadDeviationAnalysis(currentProjectId);
        } else if (tabName === 'financials' && typeof loadProjectFinancials === 'function') {
            loadProjectFinancials(currentProjectId);
        } else if (tabName === 'dependencies' && typeof loadDependencies === 'function') {
            loadDependencies(currentProjectId);
        }
    } catch (e) {
        console.error('switchTab loader failed:', tabName, e);
    }
}

function renderProjectDetailSkeleton() {
    const container = document.getElementById('projectDetailView');
    if (!container) return;
    container.innerHTML = `
        <div class="detail-header" style="margin-bottom:20px;">
            <div>
                <div style="width:260px;height:32px;background:#e2e8f0;border-radius:10px;margin-bottom:10px;"></div>
                <div style="width:420px;height:14px;background:#f1f5f9;border-radius:8px;"></div>
            </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:14px;margin-bottom:20px;">
            ${Array.from({ length: 5 }).map(() => '<div style="height:96px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 10px 30px rgba(15,23,42,0.05);"></div>').join('')}
        </div>
        <div class="panel" style="margin-bottom:20px;"><div class="panel-body"><div class="loading-spinner">正在加载项目详情...</div></div></div>
    `;
}

async function loadProjectDetail(projectId, preserveTab = false) {
    const previousTab = currentActiveTab;
    currentProjectId = projectId;
    renderProjectList();

    hideAllViews();
    document.getElementById('projectDetailView').style.display = 'block';
    renderProjectDetailSkeleton();

    try {
        currentProject = await api.get(`/projects/${projectId}`);
        const cached = allProjects.find(project => Number(project.id) === Number(projectId));
        if (cached) {
            cached.progress = currentProject.progress;
            cached.status = currentProject.status;
        }
        renderProjectList();
        renderProjectDetail(currentProject);

        if (currentProject.stages && currentProject.stages.length > 0) {
            const activeStage = currentProject.stages.find(s => s.status === '进行中') || currentProject.stages.find(s => s.status === '待开始');
            if (activeStage && typeof loadContextualRecommendations === 'function') {
                loadContextualRecommendations(activeStage.stage_name);
            }
        }

        refreshAiDecisionCenter(projectId);
        loadProjectPrediction(projectId);
        loadProjectSlaCountdown(projectId);
        loadSimilarProjects(projectId);
        checkMilestoneCelebrations(projectId);
        loadStageBaselines();

        if (preserveTab && previousTab) {
            setTimeout(() => {
                const tabs = document.querySelectorAll('#projectDetailView .tabs .tab');
                let found = false;
                tabs.forEach(tab => {
                    const onclickStr = tab.getAttribute('onclick') || '';
                    if (onclickStr.includes(`'${previousTab}'`)) {
                        tab.click();
                        found = true;
                    }
                });

                if (!found && previousTab !== 'gantt') {
                    const tabMap = {
                        'gantt': 0, 'pulse': 1, 'stages': 2, 'milestones': 3, 'team': 4,
                        'flow': 5, 'devices': 6, 'issues': 7, 'communications': 8, 'departures': 9,
                        'worklogs': 10, 'documents': 11, 'expenses': 12, 'changes': 13, 'acceptance': 14,
                        'satisfaction': 15, 'dependencies': 16, 'standup': 17, 'deviation': 18,
                        'interfaceSpec': 19, 'financials': 20
                    };
                    const tabIndex = tabMap[previousTab];
                    if (tabIndex !== undefined && tabs[tabIndex]) {
                        tabs[tabIndex].click();
                    }
                }
            }, 100);
        }
    } catch (e) {
        const container = document.getElementById('projectDetailView');
        if (container) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">⚠️</div>
                    <div class="empty-state-text">项目详情加载失败</div>
                    <div class="empty-state-hint">${e.message || '未知错误'}</div>
                </div>
            `;
        }
        console.error('loadProjectDetail failed:', e);
    }
}

function refreshProjectDetailSections(sections = []) {
    if (!currentProject || !Array.isArray(sections) || sections.length === 0) return;

    if (sections.includes('stages')) {
        const el = document.querySelector('#tab-stages .panel-body');
        if (el) el.innerHTML = renderStages(currentProject.stages || []);
    }

    if (sections.includes('milestones')) {
        const el = document.querySelector('#tab-milestones .panel-body');
        if (el) el.innerHTML = renderMilestones(currentProject.milestones || []);
    }

    if (sections.includes('members')) {
        const el = document.querySelector('#tab-team .panel:nth-of-type(1) .panel-body');
        if (el) el.innerHTML = renderMembers(currentProject.members || []);
    }

    if (sections.includes('contacts')) {
        const el = document.querySelector('#tab-team .panel:nth-of-type(2) .panel-body');
        if (el) el.innerHTML = renderContacts(currentProject.contacts || []);
    }

    if (sections.includes('interfaces')) {
        const el = document.querySelector('#tab-interfaces .panel-body');
        if (el) el.innerHTML = renderInterfaces(currentProject.interfaces || []);
    }

    if (sections.includes('issues')) {
        const el = document.querySelector('#tab-issues .panel-body');
        if (el) el.innerHTML = renderIssues(currentProject.issues || []);
    }
}

async function syncCurrentProjectDetailState(sections = []) {
    if (!currentProjectId) return null;
    const project = await api.get(`/projects/${currentProjectId}`);
    currentProject = project;

    if (Array.isArray(allProjects)) {
        const cached = allProjects.find(item => Number(item.id) === Number(currentProjectId));
        if (cached) {
            cached.progress = project.progress;
            cached.status = project.status;
        }
        renderProjectList();
    }

    if (sections.length) {
        refreshProjectDetailSections(sections);
    }

    return project;
}

// Risk actions moved to static/js/project_detail_actions_hub.js
async function saveAsTemplate(projectId) {
    const name = prompt('请输入模板名称:');
    if (!name) return;
    try {
        await api.post(`/projects/${projectId}/save-as-template`, { name });
        showToast('✅ 模板保存成功！', 'success');
    } catch (e) {
        showToast('保存失败: ' + e.message, 'danger');
    }
}

function showAddStageModal() {
    if (!currentProject) return;
    const today = new Date().toISOString().split('T')[0];
    const html = `
        <div class="modal show" id="addStageModal" style="z-index:10001;">
            <div class="modal-content" style="max-width:480px;">
                <div class="modal-header">
                    <h3>添加阶段</h3>
                    <button class="modal-close" onclick="document.getElementById('addStageModal').remove()">&times;</button>
                </div>
                <div style="padding:20px;">
                    <div class="form-group" style="margin-bottom:14px;">
                        <label style="font-weight:600;margin-bottom:4px;display:block;">阶段名称 *</label>
                        <select id="newStageName" style="width:100%;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;background:#fff;" onchange="if(this.value==='__custom__'){document.getElementById('customStageNameDiv').style.display='block'}else{document.getElementById('customStageNameDiv').style.display='none'}">
                            ${STAGE_NAMES.map(n => '<option value="' + n + '">' + n + '</option>').join('')}
                            <option value="__custom__">✏️ 自定义名称...</option>
                        </select>
                        <div id="customStageNameDiv" style="display:none;margin-top:8px;">
                            <input type="text" id="customStageName" placeholder="输入自定义阶段名称" style="width:100%;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;"/>
                        </div>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
                        <div class="form-group">
                            <label style="font-weight:600;margin-bottom:4px;display:block;">计划开始日期</label>
                            <input type="date" id="newStageStartDate" value="${today}" style="width:100%;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;"/>
                        </div>
                        <div class="form-group">
                            <label style="font-weight:600;margin-bottom:4px;display:block;">计划结束日期</label>
                            <input type="date" id="newStageEndDate" style="width:100%;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;"/>
                        </div>
                    </div>
                    <div class="form-group" style="margin-bottom:14px;">
                        <label style="font-weight:600;margin-bottom:4px;display:block;">任务项（每行一个）</label>
                        <textarea id="newStageTasks" rows="4" placeholder="任务1&#10;任务2&#10;任务3" style="width:100%;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;resize:vertical;"></textarea>
                    </div>
                    <button class="btn btn-primary" onclick="addNewStage()" style="width:100%;">确认添加</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
}

async function addNewStage() {
    let name = document.getElementById('newStageName').value;
    if (name === '__custom__') {
        name = document.getElementById('customStageName').value.trim();
    }
    if (!name) {
        showToast('请输入阶段名称', 'warning');
        return;
    }

    const startDate = document.getElementById('newStageStartDate').value;
    const endDate = document.getElementById('newStageEndDate').value;
    const tasksText = document.getElementById('newStageTasks').value;
    const tasks = tasksText ? tasksText.split('\n').map(t => t.trim()).filter(t => t) : [];

    try {
        await api.post(`/projects/${currentProject.id}/stages`, {
            stage_name: name,
            plan_start_date: startDate,
            plan_end_date: endDate,
            tasks: tasks
        });
        document.getElementById('addStageModal').remove();
        await loadProjectDetail(currentProject.id, true);
        showToast('阶段已添加', 'success');
    } catch (e) {
        showToast('添加阶段失败: ' + e.message, 'danger');
    }
}

function toggleStage(stageId) {
    const el = document.getElementById(`stage-${stageId}`);
    if (!el) return;

    const id = Number(stageId);
    if (el.classList.contains('expanded')) {
        el.classList.remove('expanded');
        expandedStages.delete(id);
    } else {
        el.classList.add('expanded');
        expandedStages.add(id);
    }
}

// Interface-template and document-upload helpers migrated to static/js/project_detail_tools_hub.js
// Project-detail actions and tab loaders migrated to static/js/project_detail_actions_hub.js
// Project-detail renderers migrated to static/js/project_detail_render_hub.js
async function refreshAiDecisionCenter(projectId, isRefresh = false) {
    loadAiDailyInsight(projectId, isRefresh);
    loadRecommendedActions(projectId, isRefresh);
}
