// Project detail editing helpers extracted from main.js

async function loadProjectDetail(projectId, preserveTab = false) {
    const previousTab = currentActiveTab;
    currentProjectId = projectId;
    renderProjectList();

    hideAllViews();
    document.getElementById('projectDetailView').style.display = 'block';

    currentProject = await api.get(`/projects/${projectId}`);
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
