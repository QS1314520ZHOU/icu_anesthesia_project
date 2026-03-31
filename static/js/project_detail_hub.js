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

let interfaceTemplatesCache = null;

function getProjectCategory() {
    if (!currentProject) return 'common';
    const hasICU = (currentProject.icu_beds || 0) > 0;
    const hasOR = (currentProject.operating_rooms || 0) > 0;

    if (hasICU && hasOR) return 'both';
    if (hasICU) return 'icu';
    if (hasOR) return 'anesthesia';
    return 'common';
}

async function loadInterfaceTemplates() {
    if (interfaceTemplatesCache) return interfaceTemplatesCache;
    try {
        const response = await fetch('/static/data/interface_templates.json');
        interfaceTemplatesCache = await response.json();
        return interfaceTemplatesCache;
    } catch (e) {
        console.error('加载接口模板失败', e);
        return [];
    }
}

function getFilteredTemplates(templates, category) {
    if (category === 'both') {
        return templates;
    }
    if (category === 'icu') {
        return templates.filter(t => t.category === 'icu' || t.category === 'common');
    }
    if (category === 'anesthesia') {
        return templates.filter(t => t.category === 'anesthesia' || t.category === 'common');
    }
    return templates.filter(t => t.category === 'common');
}

async function populateInterfaceTemplateSelect() {
    const select = document.getElementById('interfaceTemplateSelect');
    if (!select) return;

    const templates = await loadInterfaceTemplates();
    const category = getProjectCategory();
    const filtered = getFilteredTemplates(templates, category);
    const groups = {
        'icu': { label: '🏥 重症(ICU)接口', items: [] },
        'anesthesia': { label: '💉 手麻接口', items: [] },
        'common': { label: '🔗 通用接口', items: [] }
    };

    filtered.forEach(t => {
        if (groups[t.category]) {
            groups[t.category].items.push(t);
        }
    });

    let html = '<option value="">-- 选择接口模板 --</option>';
    Object.values(groups).forEach(group => {
        if (group.items.length <= 0) return;
        html += `<optgroup label="${group.label}">`;
        group.items.forEach(t => {
            const importantMark = t.important ? '⭐ ' : '';
            const viewMark = t.view_name ? ` [${t.view_name}]` : '';
            html += `<option value="${t.id}">${importantMark}${t.interface_name}${viewMark}</option>`;
        });
        html += '</optgroup>';
    });

    select.innerHTML = html;

    const categoryHint = document.getElementById('interfaceCategoryHint');
    if (categoryHint) {
        const categoryNames = {
            'both': '重症+手麻',
            'icu': '重症(ICU)',
            'anesthesia': '手术麻醉',
            'common': '通用'
        };
        categoryHint.textContent = `当前项目类型: ${categoryNames[category] || '未知'}`;
    }
}

async function showInterfaceModal() {
    document.getElementById('interfaceForm').reset();
    await populateInterfaceTemplateSelect();
    showModal('interfaceModal');
}

function showDepartureModal() {
    document.getElementById('departureForm').reset();
    document.getElementById('departureDate').value = new Date().toISOString().split('T')[0];
    showModal('departureModal');
}

function showWorklogModal() {
    currentEditingLogId = null;
    document.getElementById('worklogModalTitle').textContent = '📝 填写工作日志';
    document.getElementById('worklogForm').reset();
    document.getElementById('logDate').value = new Date().toISOString().split('T')[0];
    showModal('worklogModal');
}

function showAcceptanceModal() {
    document.getElementById('acceptanceForm').reset();
    document.getElementById('acceptanceDate').value = new Date().toISOString().split('T')[0];
    const stageSelect = document.getElementById('acceptanceStageName');
    stageSelect.innerHTML = '<option value="">-- 请选择 --</option>';
    if (currentProject && currentProject.stages) {
        currentProject.stages.forEach(s => {
            stageSelect.innerHTML += `<option value="${s.stage_name}">${s.stage_name}</option>`;
        });
    }
    showModal('acceptanceModal');
}

function showStatusModal() {
    if (!currentProject) return;

    document.getElementById('currentStatusText').textContent = currentProject.status;
    const container = document.getElementById('availableStatusList');
    const nextStatuses = {
        '待启动': ['进行中'],
        '进行中': ['试运行', '暂停', '离场待返'],
        '试运行': ['验收中', '进行中'],
        '验收中': ['已验收', '试运行'],
        '已验收': ['质保期'],
        '质保期': ['已完成'],
        '暂停': ['进行中', '离场待返', '已终止'],
        '离场待返': ['进行中', '已终止'],
        '已终止': [],
        '已完成': []
    };
    const available = nextStatuses[currentProject.status] || [];

    if (available.length === 0) {
        container.innerHTML = '<p style="color:var(--gray-500);">当前状态无法变更</p>';
    } else {
        container.innerHTML = available.map(s => `
            <button class="btn btn-outline" style="justify-content:flex-start;border-left:4px solid ${STATUS_COLORS[s]};" onclick="changeProjectStatus('${s}')">${s}</button>
        `).join('');
    }

    showModal('statusModal');
}

async function saveProject() {
    const data = {
        project_name: document.getElementById('projectName').value,
        hospital_name: document.getElementById('hospitalName').value,
        contract_no: document.getElementById('contractNo').value,
        project_manager: document.getElementById('projectManager').value,
        priority: document.getElementById('projectPriority').value,
        plan_start_date: document.getElementById('planStartDate').value,
        plan_end_date: document.getElementById('planEndDate').value,
        contact_person: document.getElementById('contactPerson').value,
        contact_phone: document.getElementById('contactPhone').value,
        icu_beds: document.getElementById('icuBeds').value || 0,
        operating_rooms: document.getElementById('operatingRooms').value || 0,
        pacu_beds: document.getElementById('pacuBeds').value || 0
    };
    if (!data.project_name || !data.hospital_name) {
        showToast('请填写项目名称和医院名称', 'warning');
        return;
    }
    await api.post('/projects', data);
    closeModal('projectModal');
    loadProjects();
    showToast('项目已创建', 'success');
}

async function saveDeparture() {
    const data = {
        departure_type: document.getElementById('departureType').value,
        departure_date: document.getElementById('departureDate').value,
        expected_return_date: document.getElementById('expectedReturnDate').value,
        handover_person: document.getElementById('handoverPerson').value,
        our_persons: document.getElementById('ourPersons').value,
        reason: document.getElementById('departureReason').value,
        doc_handover: document.getElementById('docHandover').checked,
        account_handover: document.getElementById('accountHandover').checked,
        training_handover: document.getElementById('trainingHandover').checked,
        issue_handover: document.getElementById('issueHandover').checked,
        contact_handover: document.getElementById('contactHandover').checked,
        pending_issues: document.getElementById('pendingIssues').value,
        remote_support_info: document.getElementById('remoteSupportInfo').value,
        remark: document.getElementById('departureRemark').value
    };
    if (!data.departure_date) {
        showToast('请填写离场日期', 'warning');
        return;
    }
    await api.post(`/projects/${currentProjectId}/departures`, data);
    closeModal('departureModal');
    loadProjects();
    loadProjectDetail(currentProjectId, true);
    showToast('离场申请已保存', 'success');
}

async function saveMember() {
    const data = {
        name: document.getElementById('memberName').value,
        role: document.getElementById('memberRole').value,
        phone: document.getElementById('memberPhone').value,
        email: document.getElementById('memberEmail').value,
        join_date: document.getElementById('memberJoinDate').value,
        current_city: document.getElementById('memberCity').value,
        is_onsite: document.getElementById('memberOnsite').value === '1'
    };
    if (!data.name) {
        showToast('请填写姓名', 'warning');
        return;
    }
    await api.post(`/projects/${currentProjectId}/members`, data);
    closeModal('memberModal');
    loadProjectDetail(currentProjectId, true);
    showToast('成员已保存', 'success');
}

async function saveContact() {
    const data = {
        name: document.getElementById('contactName').value,
        department: document.getElementById('contactDepartment').value,
        position: document.getElementById('contactPosition').value,
        phone: document.getElementById('contactPhoneInput').value,
        email: document.getElementById('contactEmail').value,
        is_primary: document.getElementById('contactPrimary').value === '1'
    };
    if (!data.name) {
        showToast('请填写姓名', 'warning');
        return;
    }
    await api.post(`/projects/${currentProjectId}/contacts`, data);
    closeModal('contactModal');
    loadProjectDetail(currentProjectId, true);
    showToast('联系人已保存', 'success');
}

async function saveWorklog() {
    const data = {
        log_date: document.getElementById('logDate').value,
        work_hours: document.getElementById('workHours').value || 8,
        work_type: document.getElementById('workType').value,
        member_name: document.getElementById('logMemberName').value,
        work_content: document.getElementById('workContent').value,
        issues_encountered: document.getElementById('issuesEncountered').value,
        tomorrow_plan: document.getElementById('tomorrowPlan').value
    };
    if (!data.work_content) {
        showToast('请填写工作内容', 'warning');
        return;
    }

    try {
        if (currentEditingLogId) {
            await api.put(`/worklogs/${currentEditingLogId}`, data);
            showToast('日志已更新', 'success');
        } else {
            await api.post(`/projects/${currentProjectId}/worklogs`, data);
            showToast('日志已保存', 'success');
        }
        closeModal('worklogModal');
        loadWorklogs(currentProjectId);
    } catch (e) {
        showToast('保存失败: ' + e.message, 'danger');
    }
}

async function saveExpense() {
    const data = {
        expense_date: document.getElementById('expenseDate').value,
        expense_type: document.getElementById('expenseType').value,
        amount: parseFloat(document.getElementById('expenseAmount').value) || 0,
        description: document.getElementById('expenseDesc').value,
        applicant: document.getElementById('expenseApplicant').value
    };
    if (!data.amount) {
        showToast('请填写金额', 'warning');
        return;
    }
    await api.post(`/projects/${currentProjectId}/expenses`, data);
    closeModal('expenseModal');
    loadExpenses(currentProjectId);
    showToast('费用已保存', 'success');
}

async function saveChange() {
    const data = {
        change_type: document.getElementById('changeType').value,
        change_title: document.getElementById('changeTitle').value,
        change_desc: document.getElementById('changeDesc').value,
        impact_analysis: document.getElementById('changeImpact').value,
        requested_by: document.getElementById('changeRequestedBy').value
    };
    if (!data.change_title) {
        showToast('请填写变更标题', 'warning');
        return;
    }
    await api.post(`/projects/${currentProjectId}/changes`, data);
    closeModal('changeModal');
    loadChanges(currentProjectId);
    showToast('变更已保存', 'success');
}

async function saveAcceptance() {
    const data = {
        acceptance_type: document.getElementById('acceptanceType').value,
        stage_name: document.getElementById('acceptanceStageName').value,
        acceptance_date: document.getElementById('acceptanceDate').value,
        pass_rate: document.getElementById('acceptancePassRate').value,
        customer_sign: document.getElementById('acceptanceCustomerSign').value,
        our_sign: document.getElementById('acceptanceOurSign').value,
        issues_found: document.getElementById('acceptanceIssues').value,
        remark: document.getElementById('acceptanceRemark').value
    };
    await api.post(`/projects/${currentProjectId}/acceptances`, data);
    closeModal('acceptanceModal');
    loadAcceptances(currentProjectId);
    showToast('验收记录已保存', 'success');
}

async function saveSatisfaction() {
    const data = {
        survey_type: document.getElementById('surveyType').value,
        surveyor: document.getElementById('surveyor').value,
        score_quality: parseInt(document.getElementById('ratingQuality').dataset.score) || 0,
        score_service: parseInt(document.getElementById('ratingService').dataset.score) || 0,
        score_response: parseInt(document.getElementById('ratingResponse').dataset.score) || 0,
        score_professional: parseInt(document.getElementById('ratingProfessional').dataset.score) || 0,
        score_overall: parseInt(document.getElementById('ratingOverall').dataset.score) || 0,
        feedback: document.getElementById('satisfactionFeedback').value
    };
    await api.post(`/projects/${currentProjectId}/satisfaction`, data);
    closeModal('satisfactionModal');
    initStarRatings();
    loadSatisfaction(currentProjectId);
    showToast('满意度记录已保存', 'success');
}

async function applyInterfaceTemplate(templateId) {
    if (!templateId) return;
    try {
        const templates = await loadInterfaceTemplates();
        const template = templates.find(t => t.id === templateId);
        if (!template) return;

        document.getElementById('systemName').value = template.system_name;
        document.getElementById('interfaceName').value = template.interface_name;
        let remark = template.remark;
        if (template.view_name) remark = `视图: ${template.view_name}\n${remark}`;
        if (template.protocol) remark += `\n建议协议: ${template.protocol}`;
        document.getElementById('interfaceRemark').value = remark;
    } catch (e) {
        console.error('更新阶段失败', e);
    }
}

async function batchAddRecommendedInterfaces() {
    if (!currentProjectId) {
        showToast('请先选择项目', 'warning');
        return;
    }

    const templates = await loadInterfaceTemplates();
    const category = getProjectCategory();
    const filtered = getFilteredTemplates(templates, category);
    const importantOnly = confirm('是否只添加标记为"重要"的核心接口？\n\n点击"确定"添加核心接口\n点击"取消"添加全部推荐接口');
    const toAdd = importantOnly ? filtered.filter(t => t.important) : filtered;

    if (toAdd.length === 0) {
        showToast('没有可添加的接口', 'warning');
        return;
    }
    if (!confirm(`将添加 ${toAdd.length} 个接口，确认？`)) return;

    let successCount = 0;
    for (const t of toAdd) {
        try {
            let remark = t.remark;
            if (t.view_name) remark = `视图: ${t.view_name} | ${remark}`;

            await api.post(`/projects/${currentProjectId}/interfaces`, {
                system_name: t.system_name,
                interface_name: t.interface_name,
                status: '待开发',
                remark: remark
            });
            successCount++;
        } catch (e) {
            console.error(`添加接口 ${t.interface_name} 失败`, e);
        }
    }

    showToast(`成功添加 ${successCount}/${toAdd.length} 个接口`, 'success');
    loadProjectDetail(currentProjectId, true);
}

async function saveFollowup() {
    const data = {
        follow_up_date: document.getElementById('followupDate').value,
        follow_up_type: document.getElementById('followupType').value,
        contact_person: document.getElementById('followupContactPerson').value,
        follow_up_by: document.getElementById('followupBy').value,
        content: document.getElementById('followupContent').value,
        issues_found: document.getElementById('followupIssues').value,
        next_follow_up_date: document.getElementById('nextFollowupDate').value
    };
    await api.post(`/projects/${currentProjectId}/followups`, data);
    closeModal('followupModal');
    loadSatisfaction(currentProjectId);
}

async function saveInterface() {
    const data = {
        system_name: document.getElementById('systemName').value,
        interface_name: document.getElementById('interfaceName').value,
        status: document.getElementById('interfaceStatus').value,
        remark: document.getElementById('interfaceRemark').value
    };
    await api.post(`/projects/${currentProjectId}/interfaces`, data);
    closeModal('interfaceModal');
    loadProjectDetail(currentProjectId, true);
}

async function saveDocument() {
    const fileInput = document.getElementById('docFile');
    const formData = new FormData();
    if (fileInput.files.length > 0) {
        formData.append('file', fileInput.files[0]);
    }
    formData.append('doc_name', document.getElementById('docName').value || (fileInput.files[0] ? fileInput.files[0].name : '未命名'));
    formData.append('doc_type', document.getElementById('docType').value);
    formData.append('doc_category', document.getElementById('docCategory').value);
    formData.append('version', document.getElementById('docVersion').value);
    formData.append('upload_by', document.getElementById('docUploadBy').value);

    await fetch(`/api/projects/${currentProjectId}/documents`, { method: 'POST', body: formData });
    closeModal('documentModal');
    loadDocuments(currentProjectId);
}

let isSavingIssue = false;
async function saveIssue() {
    if (isSavingIssue) return;
    const data = {
        issue_type: document.getElementById('issueType').value,
        severity: document.getElementById('issueSeverity').value,
        description: document.getElementById('issueDesc').value
    };
    if (!data.description) {
        showToast('请填写问题描述', 'warning');
        return;
    }

    isSavingIssue = true;
    try {
        await api.post(`/projects/${currentProjectId}/issues`, data);
        closeModal('issueModal');
        document.getElementById('issueDesc').value = '';
        loadProjectDetail(currentProjectId, true);
        showToast('问题已保存', 'success');
    } finally {
        isSavingIssue = false;
    }
}

async function saveDevice() {
    const data = {
        device_type: document.getElementById('deviceType').value,
        brand_model: document.getElementById('deviceModel').value,
        protocol_type: document.getElementById('deviceProtocol').value,
        ip_address: document.getElementById('deviceIp').value,
        status: document.getElementById('deviceStatus').value
    };
    await api.post(`/projects/${currentProjectId}/devices`, data);
    closeModal('deviceModal');
    loadDevices(currentProjectId);
    showToast('设备已保存', 'success');
}

async function saveMilestone() {
    const data = {
        name: document.getElementById('milestoneName').value,
        target_date: document.getElementById('milestoneDate').value
    };
    if (!data.name || !data.target_date) {
        showToast('请填写完整', 'warning');
        return;
    }
    await api.post(`/projects/${currentProjectId}/milestones`, data);
    closeModal('milestoneModal');
    loadProjectDetail(currentProjectId, true);
    showToast('里程碑已保存', 'success');
}

async function toggleTask(taskId, event) {
    event.stopPropagation();
    const checkbox = event.target;
    const taskItem = checkbox.closest('.task-item');
    const taskName = taskItem.querySelector('.task-name');

    checkbox.classList.toggle('checked');
    taskName.classList.toggle('completed');

    await fetch(`/api/tasks/${taskId}/toggle`, { method: 'POST' });

    const stageItem = checkbox.closest('.stage-item');
    if (stageItem) {
        const allTasks = stageItem.querySelectorAll('.task-checkbox');
        const completedTasks = stageItem.querySelectorAll('.task-checkbox.checked');
        const progress = allTasks.length > 0 ? Math.round(completedTasks.length / allTasks.length * 100) : 0;
        const progressBar = stageItem.querySelector('.stage-progress-mini-bar');
        const progressText = stageItem.querySelector('.stage-info > span:last-of-type');
        if (progressBar) progressBar.style.width = `${progress}%`;
        if (progressText && progressText.textContent.includes('%')) progressText.textContent = `${progress}%`;

        const statusBadge = stageItem.querySelector('.stage-status-badge');
        if (statusBadge) {
            if (progress === 100) {
                statusBadge.outerHTML = '<span class="stage-status-badge" style="background:#ecfdf5;color:#059669;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;">✅ 已完成</span>';
            } else if (progress > 0) {
                statusBadge.outerHTML = '<span class="stage-status-badge" style="background:#eff6ff;color:#2563eb;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;">⏳ 进行中</span>';
            } else {
                statusBadge.outerHTML = '<span class="stage-status-badge" style="background:#f8fafc;color:#94a3b8;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;">⏸ 待开始</span>';
            }
        }
    }
    updateOverallProgress();
}

async function toggleMilestone(mid) {
    await fetch(`/api/milestones/${mid}/toggle`, { method: 'POST' });
    loadProjectDetail(currentProjectId, true);
}

async function updateOverallProgress() {
    if (!currentProjectId) return;
    try {
        const project = await api.get(`/projects/${currentProjectId}`);
        const progressCard = document.querySelector('.overview-card-value.progress-text');
        if (progressCard) progressCard.textContent = `${project.progress || 0}%`;
        currentProject = project;

        const statusDetail = document.querySelector('.project-detail-status');
        if (statusDetail) {
            const statusColor = STATUS_COLORS[project.status] || '#9ca3af';
            statusDetail.style.backgroundColor = `${statusColor}20`;
            statusDetail.style.color = statusColor;
            statusDetail.textContent = project.status;
            statusDetail.className = `meta-item project-status project-detail-status status-${project.status}`;
        }

        const activeCard = document.querySelector('.project-card.active');
        if (activeCard) {
            const progressBar = activeCard.querySelector('.project-progress-bar');
            if (!progressBar) {
                const miniBar = activeCard.querySelector('.progress-mini-bar');
                if (miniBar) miniBar.style.width = `${project.progress || 0}%`;
            } else {
                progressBar.style.width = `${project.progress || 0}%`;
            }
            const progressText = activeCard.querySelector('.project-progress-text span:first-child') || activeCard.querySelector('.project-card-footer span');
            if (progressText) {
                if (progressText.textContent.includes('进度')) {
                    progressText.textContent = `进度 ${project.progress || 0}%`;
                } else {
                    progressText.textContent = `${project.progress || 0}%`;
                }
            }

            const statusList = activeCard.querySelector('.project-list-status');
            if (statusList) {
                const statusColor = STATUS_COLORS[project.status] || '#9ca3af';
                statusList.style.backgroundColor = `${statusColor}20`;
                statusList.style.color = statusColor;
                statusList.textContent = project.status;
            }
        }
    } catch (e) {
        console.error('更新进度失败', e);
    }
}

async function recordReturn(departureId) {
    if (!confirm('确认记录返场？项目状态将变更为"进行中"')) return;
    await api.post(`/departures/${departureId}/return`, { return_date: new Date().toISOString().split('T')[0] });
    loadProjects();
    loadProjectDetail(currentProjectId, true);
}

async function deleteProject(pid) {
    if (!confirm('确定删除此项目？所有数据将被清除！')) return;
    await api.delete(`/projects/${pid}`);
    currentProjectId = null;
    currentProject = null;
    document.getElementById('projectDetailView').style.display = 'none';
    document.getElementById('emptyState').style.display = 'block';
    loadProjects();
}

async function deleteMember(mid) {
    if (!confirm('确定删除？')) return;
    await api.delete(`/members/${mid}`);
    loadProjectDetail(currentProjectId, true);
}

async function deleteContact(cid) {
    if (!confirm('确定删除？')) return;
    await api.delete(`/contacts/${cid}`);
    loadProjectDetail(currentProjectId, true);
}

async function deleteInterface(iid) {
    if (!confirm('确定删除？')) return;
    await api.delete(`/projects/interfaces/${iid}`);
    loadProjectDetail(currentProjectId, true);
}

async function deleteIssue(iid) {
    if (!confirm('确定删除？')) return;
    await api.delete(`/issues/${iid}`);
    loadProjectDetail(currentProjectId, true);
}

async function deleteDevice(did) {
    if (!confirm('确定删除？')) return;
    await api.delete(`/devices/${did}`);
    loadDevices(currentProjectId);
}

async function deleteMilestone(mid) {
    if (!confirm('确定删除？')) return;
    await api.delete(`/milestones/${mid}`);
    loadProjectDetail(currentProjectId, true);
}

async function deleteDocument(did) {
    if (!confirm('确定删除？')) return;
    await api.delete(`/documents/${did}`);
    loadDocuments(currentProjectId);
}

async function deleteExpense(eid) {
    if (!confirm('确定删除？')) return;
    await api.delete(`/expenses/${eid}`);
    loadExpenses(currentProjectId);
}

async function deleteChange(cid) {
    if (!confirm('确定删除？')) return;
    await api.delete(`/changes/${cid}`);
    loadChanges(currentProjectId);
}

async function deleteAcceptance(aid) {
    if (!confirm('确定删除？')) return;
    await api.delete(`/acceptances/${aid}`);
    loadAcceptances(currentProjectId);
}

function downloadDocument(did) {
    window.open(`/api/documents/${did}/download`, '_blank');
}

async function updateIssueStatus(issueId, newStatus) {
    await api.put(`/issues/${issueId}`, { status: newStatus });
    loadProjectDetail(currentProjectId, true);
}

async function updateInterfaceStatus(interfaceId, newStatus) {
    await api.put(`/projects/interfaces/${interfaceId}`, { status: newStatus });
    loadProjectDetail(currentProjectId, true);
}

async function updateAcceptanceStatus(acceptanceId, newStatus) {
    await api.put(`/acceptances/${acceptanceId}`, { status: newStatus });
    loadAcceptances(currentProjectId);
    if (newStatus === '已通过') {
        loadProjects();
        loadProjectDetail(currentProjectId, true);
    }
}

async function changeProjectStatus(newStatus) {
    if (!confirm(`确定将项目状态变更为"${newStatus}"？`)) return;
    await api.put(`/projects/${currentProjectId}/status`, { status: newStatus });
    closeModal('statusModal');
    loadProjects();
    loadProjectDetail(currentProjectId);
}

async function loadWorklogs(pid) {
    const logs = await api.get(`/projects/${pid}/worklogs`);
    const container = document.getElementById('worklogsContainer');
    if (!container) return;
    if (!logs || !logs.length) {
        container.innerHTML = '<div class="empty-state"><p>暂无工作日志</p></div>';
        return;
    }
    container.innerHTML = logs.slice(0, 20).map(l => `
        <div class="worklog-item" id="worklog-${l.id}">
            <div class="worklog-header">
                <div style="display:flex; flex-direction:column; gap:2px;">
                    <span class="worklog-date">${l.log_date}</span>
                    <span class="worklog-meta">${l.member_name || '未知'} | ${l.work_type} | ${l.work_hours}h</span>
                </div>
                <div class="worklog-actions" style="display:flex; gap:8px;">
                    <button class="btn btn-outline btn-xs" onclick="editWorklog(${l.id}, ${pid})">编辑</button>
                    <button class="btn btn-danger btn-xs" onclick="deleteWorklog(${l.id}, ${pid})">删除</button>
                </div>
            </div>
            <div class="worklog-content">${l.work_content || '无内容'}</div>
            ${l.issues_encountered ? `<div style="margin-top:8px;color:var(--danger);font-size:12px;">问题: ${l.issues_encountered}</div>` : ''}
        </div>
    `).join('');
}

async function deleteWorklog(id, pid) {
    if (!confirm('确定删除此条工作日志吗？')) return;
    try {
        await api.delete(`/worklogs/${id}`);
        showToast('日志已删除', 'success');
        loadWorklogs(pid);
    } catch (e) {
        showToast('删除失败: ' + e.message, 'danger');
    }
}

async function editWorklog(id, pid) {
    currentEditingLogId = id;
    const item = document.querySelector(`#worklog-${id}`);
    if (!item) return;

    const logs = await api.get(`/projects/${pid}/worklogs`);
    const log = logs.find(l => l.id === id);
    if (!log) return;

    document.getElementById('worklogModalTitle').textContent = '📝 编辑工作日志';
    document.getElementById('logDate').value = log.log_date;
    document.getElementById('workType').value = log.work_type || '现场';
    document.getElementById('workHours').value = log.work_hours || 8;
    document.getElementById('workContent').value = log.work_content || '';
    document.getElementById('issuesEncountered').value = log.issues_encountered || '';
    document.getElementById('tomorrowPlan').value = log.tomorrow_plan || '';

    showModal('worklogModal');
}

async function loadDocuments(pid) {
    const docs = await api.get(`/projects/${pid}/documents`);
    const container = document.getElementById('documentsContainer');
    if (!container) return;
    if (!docs || !docs.length) {
        container.innerHTML = '<div class="empty-state"><p>暂无文档</p></div>';
        return;
    }
    container.innerHTML = `
        <div class="table-container">
            <table class="table">
                <thead><tr><th>文档名称</th><th>类型</th><th>分类</th><th>版本</th><th>上传人</th><th>操作</th></tr></thead>
                <tbody>
                    ${docs.map(d => `
                        <tr>
                            <td>${d.doc_name}</td>
                            <td><span class="badge badge-info">${d.doc_type || '-'}</span></td>
                            <td>${d.doc_category || '-'}</td>
                            <td>${d.version || '-'}</td>
                            <td>${d.upload_by || '-'}</td>
                            <td>
                                ${d.file_path ? `<button class="btn btn-outline btn-xs" onclick="downloadDocument(${d.id})">下载</button>` : ''}
                                <button class="btn btn-danger btn-xs" onclick="deleteDocument(${d.id})">删除</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

async function loadExpenses(pid) {
    const expenses = await api.get(`/projects/${pid}/expenses`);
    const container = document.getElementById('expensesContainer');
    if (!container) return;
    if (!expenses || !expenses.length) {
        container.innerHTML = '<div class="empty-state"><p>暂无费用记录</p></div>';
        return;
    }
    const icons = { '差旅': '✈️', '住宿': '🏨', '餐饮': '🍽️', '交通': '🚗', '采购': '🛒', '其他': '📦' };
    const total = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    container.innerHTML = `
        <div style="margin-bottom:16px;padding:12px;background:var(--gray-50);border-radius:8px;">
            <span style="font-size:14px;color:var(--gray-600);">费用合计: </span>
            <span style="font-size:20px;font-weight:700;color:var(--primary);">¥${total.toFixed(2)}</span>
        </div>
        ${expenses.map(e => `
            <div class="expense-item">
                <div class="expense-icon ${e.expense_type}">${icons[e.expense_type] || '📦'}</div>
                <div class="expense-info">
                    <div class="expense-desc">${e.description || e.expense_type}</div>
                    <div class="expense-meta">${e.expense_date} | ${e.applicant || '未知'} | <span class="badge ${e.status === '已报销' ? 'badge-success' : 'badge-warning'}">${e.status}</span></div>
                </div>
                <div class="expense-amount">¥${(e.amount || 0).toFixed(2)}</div>
                <button class="btn btn-danger btn-xs" onclick="deleteExpense(${e.id})">删除</button>
            </div>
        `).join('')}
    `;
}

async function loadChanges(pid) {
    const changes = await api.get(`/projects/${pid}/changes`);
    const container = document.getElementById('changesContainer');
    if (!container) return;
    if (!changes || !changes.length) {
        container.innerHTML = '<div class="empty-state"><p>暂无变更记录</p></div>';
        return;
    }
    const statusMap = { '待审批': 'badge-warning', '已批准': 'badge-success', '已驳回': 'badge-danger', '已执行': 'badge-info' };
    container.innerHTML = `
        <div class="table-container">
            <table class="table">
                <thead><tr><th>类型</th><th>标题</th><th>申请人</th><th>申请日期</th><th>状态</th><th>操作</th></tr></thead>
                <tbody>
                    ${changes.map(c => `
                        <tr>
                            <td><span class="badge badge-purple">${c.change_type}</span></td>
                            <td>${c.change_title}</td>
                            <td>${c.requested_by || '-'}</td>
                            <td>${c.requested_date || '-'}</td>
                            <td><span class="badge ${statusMap[c.status]}">${c.status}</span></td>
                            <td><button class="btn btn-danger btn-xs" onclick="deleteChange(${c.id})">删除</button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

async function loadAcceptances(pid) {
    const acceptances = await api.get(`/projects/${pid}/acceptances`);
    const container = document.getElementById('acceptancesContainer');
    if (!container) return;
    if (!acceptances || !acceptances.length) {
        container.innerHTML = '<div class="empty-state"><p>暂无验收记录</p></div>';
        return;
    }
    const statusMap = { '待验收': 'badge-warning', '验收中': 'badge-info', '已通过': 'badge-success', '未通过': 'badge-danger' };
    container.innerHTML = `
        <div class="table-container">
            <table class="table">
                <thead><tr><th>类型</th><th>关联阶段</th><th>验收日期</th><th>通过率</th><th>状态</th><th>操作</th></tr></thead>
                <tbody>
                    ${acceptances.map(a => `
                        <tr>
                            <td><span class="badge badge-info">${a.acceptance_type}</span></td>
                            <td>${a.stage_name || '-'}</td>
                            <td>${a.acceptance_date || '-'}</td>
                            <td>${a.pass_rate ? a.pass_rate + '%' : '-'}</td>
                            <td>
                                <select class="badge ${statusMap[a.status]}" style="border:none;cursor:pointer;" onchange="updateAcceptanceStatus(${a.id}, this.value)">
                                    <option value="待验收" ${a.status === '待验收' ? 'selected' : ''}>待验收</option>
                                    <option value="验收中" ${a.status === '验收中' ? 'selected' : ''}>验收中</option>
                                    <option value="已通过" ${a.status === '已通过' ? 'selected' : ''}>已通过</option>
                                    <option value="未通过" ${a.status === '未通过' ? 'selected' : ''}>未通过</option>
                                </select>
                            </td>
                            <td><button class="btn btn-danger btn-xs" onclick="deleteAcceptance(${a.id})">删除</button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

async function loadSatisfaction(pid) {
    const res = await fetch(`/api/projects/${pid}/satisfaction`);
    const records = await res.json();
    const container = document.getElementById('satisfactionContainer');

    const statsRes = await fetch(`/api/projects/${pid}/satisfaction/stats`);
    const stats = await statsRes.json();

    let html = '';
    if (stats.count > 0) {
        html += `
            <div style="margin-bottom:20px;padding:16px;background:var(--gray-50);border-radius:10px;">
                <div style="font-size:14px;font-weight:600;margin-bottom:12px;">满意度统计 (${stats.count}次调查)</div>
                <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;text-align:center;">
                    <div><div style="font-size:20px;font-weight:700;color:var(--primary);">${(stats.avg_quality || 0).toFixed(1)}</div><div style="font-size:11px;color:var(--gray-500);">系统质量</div></div>
                    <div><div style="font-size:20px;font-weight:700;color:var(--primary);">${(stats.avg_service || 0).toFixed(1)}</div><div style="font-size:11px;color:var(--gray-500);">服务态度</div></div>
                    <div><div style="font-size:20px;font-weight:700;color:var(--primary);">${(stats.avg_response || 0).toFixed(1)}</div><div style="font-size:11px;color:var(--gray-500);">响应速度</div></div>
                    <div><div style="font-size:20px;font-weight:700;color:var(--primary);">${(stats.avg_professional || 0).toFixed(1)}</div><div style="font-size:11px;color:var(--gray-500);">专业能力</div></div>
                    <div><div style="font-size:20px;font-weight:700;color:var(--success);">${(stats.avg_overall || 0).toFixed(1)}</div><div style="font-size:11px;color:var(--gray-500);">总体满意度</div></div>
                </div>
            </div>
        `;
    }

    if (!records.length) {
        html += '<div class="empty-state"><p>暂无满意度记录</p></div>';
    } else {
        html += records.map(r => `
            <div style="border:1px solid var(--gray-200);border-radius:10px;padding:14px;margin-bottom:10px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                    <span style="font-weight:600;">${r.survey_date} - ${r.survey_type}</span>
                    <span style="font-size:12px;color:var(--gray-500);">调查人: ${r.surveyor || '-'}</span>
                </div>
                <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px;">
                    <span>质量: ${'★'.repeat(r.score_quality || 0)}${'☆'.repeat(5 - (r.score_quality || 0))}</span>
                    <span>服务: ${'★'.repeat(r.score_service || 0)}${'☆'.repeat(5 - (r.score_service || 0))}</span>
                    <span>响应: ${'★'.repeat(r.score_response || 0)}${'☆'.repeat(5 - (r.score_response || 0))}</span>
                    <span>专业: ${'★'.repeat(r.score_professional || 0)}${'☆'.repeat(5 - (r.score_professional || 0))}</span>
                    <span style="font-weight:600;">总体: ${'★'.repeat(r.score_overall || 0)}${'☆'.repeat(5 - (r.score_overall || 0))}</span>
                </div>
                ${r.feedback ? `<div style="margin-top:10px;padding:10px;background:var(--gray-50);border-radius:6px;font-size:13px;">${r.feedback}</div>` : ''}
            </div>
        `).join('');
    }

    container.innerHTML = html;
}

function renderDependencies(deps, pid) {
    if (!deps || deps.length === 0) {
        return '<div class="empty-state"><p>暂无依赖关系</p></div>';
    }
    return `
        <div class="dependency-list">
            ${deps.map(d => `
                <div class="dependency-item">
                    <div class="dependency-main">
                        <span class="dependency-from">${d.from_task_name}</span>
                        <span class="dependency-arrow">→</span>
                        <span class="dependency-to">${d.to_task_name}</span>
                    </div>
                    <button class="btn btn-danger btn-xs" onclick="deleteDependency(${d.id}, ${pid})">删除</button>
                </div>
            `).join('')}
        </div>
    `;
}

function renderStages(stages) {
    if (!stages || stages.length === 0) {
        return '<div class="empty-state"><p>暂无阶段计划</p></div>';
    }
    return stages.map(s => `
        <div class="stage-item" id="stage-${s.id}">
            <div class="stage-header" onclick="toggleStage(${s.id})">
                <div class="stage-title-wrap">
                    <div class="stage-title">${s.stage_name}</div>
                    <span class="stage-status-badge" style="background:${s.status === '已完成' ? '#ecfdf5;color:#059669' : s.status === '进行中' ? '#eff6ff;color:#2563eb' : '#f8fafc;color:#94a3b8'};padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;">
                        ${s.status === '已完成' ? '✅ 已完成' : s.status === '进行中' ? '⏳ 进行中' : '⏸ 待开始'}
                    </span>
                </div>
                <div class="stage-info">
                    <span>${s.plan_start_date || '-'} ~ ${s.plan_end_date || '-'}</span>
                    <span>${s.progress || 0}%</span>
                    <div class="stage-progress-mini">
                        <div class="stage-progress-mini-bar" style="width:${s.progress || 0}%"></div>
                    </div>
                </div>
            </div>
            <div class="stage-body">
                ${(s.tasks || []).map(t => `
                    <div class="task-item">
                        <div class="task-checkbox ${t.is_completed ? 'checked' : ''}" onclick="toggleTask(${t.id}, event)"></div>
                        <div class="task-name ${t.is_completed ? 'completed' : ''}">${t.task_name}</div>
                        ${!t.is_completed ? `<button class="btn btn-xs btn-outline" style="font-size:10px; padding:2px 4px; border-color:#e2e8f0; color:#64748b;" onclick="showRiskSimulationModal(${t.id}, '${t.task_name}', event)" title="模拟延迟波及项目">🦋 仿真</button>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
}

function renderMilestones(milestones) {
    if (!milestones || milestones.length === 0) {
        return '<div class="empty-state"><p>暂无里程碑</p></div>';
    }
    return milestones.map(m => `
        <div class="milestone-item">
            <div class="milestone-diamond ${m.is_completed ? 'completed' : ''}" onclick="toggleMilestone(${m.id})"></div>
            <div class="milestone-content">
                <div class="milestone-name">${m.name}</div>
                <div class="milestone-date">${m.target_date || '-'}</div>
            </div>
            <button class="btn btn-danger btn-xs" onclick="deleteMilestone(${m.id})">删除</button>
        </div>
    `).join('');
}

function renderMembers(members) {
    if (!members || members.length === 0) {
        return '<div class="empty-state"><p>暂无成员</p></div>';
    }
    return members.map(m => `
        <div class="member-item">
            <div>
                <div class="member-name">${m.name}</div>
                <div class="member-meta">${m.role || '-'} | ${m.current_city || '-'} ${m.is_onsite ? '| 驻场' : ''}</div>
            </div>
            <button class="btn btn-danger btn-xs" onclick="deleteMember(${m.id})">删除</button>
        </div>
    `).join('');
}

function renderContacts(contacts) {
    if (!contacts || contacts.length === 0) {
        return '<div class="empty-state"><p>暂无联系人</p></div>';
    }
    return contacts.map(c => `
        <div class="contact-item">
            <div>
                <div class="contact-name">${c.name}</div>
                <div class="contact-meta">${c.department || '-'} ${c.position || ''} | ${c.phone || '-'}</div>
            </div>
            <button class="btn btn-danger btn-xs" onclick="deleteContact(${c.id})">删除</button>
        </div>
    `).join('');
}

function renderInterfaces(interfaces) {
    if (!interfaces || interfaces.length === 0) return '<div class="empty-state"><p>暂无接口数据</p></div>';
    const statusMap = { '待开发': 'badge-gray', '开发中': 'badge-info', '联调中': 'badge-warning', '已完成': 'badge-success' };
    return `
        <div style="background:#f0f9ff; border:1px solid #bae6fd; color:#0369a1; padding:8px 16px; border-radius:8px; margin-bottom:12px; font-size:13px; display:flex; align-items:center; gap:8px;">
            <i class="fas fa-info-circle"></i> 此处仅用于手工记录接口开发状态，详细文档对照请前往 <b>📑 智能对照</b> 模块（右侧 V2.0 版）。
        </div>
        <div class="table-container">
            <table class="table">
                <thead><tr><th>系统</th><th>接口名称</th><th>状态</th><th>操作</th></tr></thead>
                <tbody>
                    ${interfaces.map(i => `
                        <tr>
                            <td>${i.system_name}</td>
                            <td>${i.interface_name || '-'}</td>
                            <td>
                                <select class="badge ${statusMap[i.status] || 'badge-gray'}" style="border:none;cursor:pointer;" onchange="updateInterfaceStatus(${i.id}, this.value)">
                                    <option value="待开发" ${i.status === '待开发' ? 'selected' : ''}>待开发</option>
                                    <option value="开发中" ${i.status === '开发中' ? 'selected' : ''}>开发中</option>
                                    <option value="联调中" ${i.status === '联调中' ? 'selected' : ''}>联调中</option>
                                    <option value="已完成" ${i.status === '已完成' ? 'selected' : ''}>已完成</option>
                                </select>
                            </td>
                            <td><button class="btn btn-danger btn-xs" onclick="deleteInterface(${i.id})">删除</button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderIssues(issues) {
    if (!issues || issues.length === 0) return '<div class="empty-state"><p>暂无问题记录</p></div>';
    const severityMap = { '高': 'badge-danger', '中': 'badge-warning', '低': 'badge-info' };
    const statusMap = { '待处理': 'badge-danger', '处理中': 'badge-warning', '已解决': 'badge-success' };
    return `
        <div class="table-container">
            <table class="table">
                <thead><tr><th>类型</th><th>描述</th><th>严重度</th><th>状态</th><th>操作</th></tr></thead>
                <tbody>
                    ${issues.map(i => `
                        <tr>
                            <td>${i.issue_type}</td>
                            <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;">${i.description}</td>
                            <td><span class="badge ${severityMap[i.severity]}">${i.severity}</span></td>
                            <td>
                                <select class="badge ${statusMap[i.status]}" style="border:none;cursor:pointer;" onchange="updateIssueStatus(${i.id}, this.value)">
                                    <option value="待处理" ${i.status === '待处理' ? 'selected' : ''}>待处理</option>
                                    <option value="处理中" ${i.status === '处理中' ? 'selected' : ''}>处理中</option>
                                    <option value="已解决" ${i.status === '已解决' ? 'selected' : ''}>已解决</option>
                                </select>
                            </td>
                            <td>
                                <div style="display:flex;gap:4px;">
                                    ${i.status === '已解决' ? `<button class="btn btn-ai btn-xs" onclick="extractToKb(${i.id}, this)" title="提取为知识库条目">🧠 提炼</button>` : ''}
                                    <button class="btn btn-danger btn-xs" onclick="deleteIssue(${i.id})">删除</button>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderDepartures(departures) {
    if (!departures || departures.length === 0) return '<div class="empty-state"><p>暂无离场记录</p></div>';
    return departures.map(d => `
        <div class="departure-card type-${d.departure_type}">
            <div class="departure-header">
                <span class="departure-type">${d.departure_type}</span>
                <div class="btn-group">
                    ${d.status === '已离场' && !d.actual_return_date ? `<button class="btn btn-success btn-xs" onclick="recordReturn(${d.id})">记录返场</button>` : ''}
                    <span class="badge ${d.status === '已返场' ? 'badge-success' : d.status === '已离场' ? 'badge-pink' : 'badge-warning'}">${d.status}</span>
                </div>
            </div>
            <div class="departure-info">
                <div class="departure-info-item">离场日期: <span>${d.departure_date}</span></div>
                <div class="departure-info-item">预计返场: <span>${d.expected_return_date || '待定'}</span></div>
                <div class="departure-info-item">实际返场: <span>${d.actual_return_date || '-'}</span></div>
                <div class="departure-info-item">交接人: <span>${d.handover_person || '-'}</span></div>
                <div class="departure-info-item">离场人员: <span>${d.our_persons || '-'}</span></div>
                <div class="departure-info-item">原因: <span>${d.reason || '-'}</span></div>
            </div>
            <div class="handover-checklist">
                <span class="handover-item ${d.doc_handover ? 'done' : 'pending'}">${d.doc_handover ? '✓' : '○'} 文档</span>
                <span class="handover-item ${d.account_handover ? 'done' : 'pending'}">${d.account_handover ? '✓' : '○'} 账号</span>
                <span class="handover-item ${d.training_handover ? 'done' : 'pending'}">${d.training_handover ? '✓' : '○'} 培训</span>
                <span class="handover-item ${d.issue_handover ? 'done' : 'pending'}">${d.issue_handover ? '✓' : '○'} 问题</span>
                <span class="handover-item ${d.contact_handover ? 'done' : 'pending'}">${d.contact_handover ? '✓' : '○'} 联系方式</span>
            </div>
        </div>
    `).join('');
}

async function loadDevices(pid) {
    const devices = await api.get(`/projects/${pid}/devices`);
    const container = document.getElementById('devicesContainer');
    if (!container) return;
    if (!devices || !devices.length) {
        container.innerHTML = '<div class="empty-state"><p>暂无设备数据</p></div>';
        return;
    }

    const getStatusColor = (status) => {
        if (status === '已入库' || status === '已物理连接') return '#10b981';
        if (status === '解析中') return '#f59e0b';
        if (status === '未连接' || status === '异常') return '#ef4444';
        return '#6b7280';
    };

    container.innerHTML = `
        <div class="table-container">
            <table class="table">
                <thead><tr><th>类型</th><th>型号</th><th>协议</th><th>IP</th><th>状态</th><th>操作</th></tr></thead>
                <tbody>
                    ${devices.map(d => `
                        <tr>
                            <td>${d.device_type}</td>
                            <td>${d.brand_model || '-'}</td>
                            <td>${d.protocol_type || '-'}</td>
                            <td>${d.ip_address || '-'}</td>
                            <td>
                                <select class="status-select" onchange="changeDeviceStatus(${d.id}, this.value)" style="border: 1px solid ${getStatusColor(d.status)}; color: ${getStatusColor(d.status)}; padding: 2px 8px; border-radius: 12px; font-size: 12px; background: white; cursor: pointer;">
                                    <option value="未连接" ${d.status === '未连接' ? 'selected' : ''}>🔴 未连接</option>
                                    <option value="已物理连接" ${d.status === '已物理连接' ? 'selected' : ''}>🟢 已物理连接</option>
                                    <option value="解析中" ${d.status === '解析中' ? 'selected' : ''}>🟡 解析中</option>
                                    <option value="已入库" ${d.status === '已入库' ? 'selected' : ''}>✅ 已入库</option>
                                    <option value="异常" ${d.status === '异常' ? 'selected' : ''}>❌ 异常</option>
                                </select>
                            </td>
                            <td><button class="btn btn-danger btn-xs" onclick="deleteDevice(${d.id})">删除</button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

async function changeDeviceStatus(deviceId, newStatus) {
    try {
        await api.put(`/devices/${deviceId}`, { status: newStatus });
        showToast('设备状态已更新');
        const select = document.querySelector(`select[onchange="changeDeviceStatus(${deviceId}, this.value)"]`);
        if (select) {
            const color = (newStatus === '已入库' || newStatus === '已物理连接') ? '#10b981'
                : (newStatus === '解析中') ? '#f59e0b'
                : (newStatus === '未连接' || newStatus === '异常') ? '#ef4444' : '#6b7280';
            select.style.borderColor = color;
            select.style.color = color;
        }
    } catch (e) {
        showToast('更新失败: ' + e.message, 'danger');
    }
}

async function loadDependencies(pid) {
    const deps = await api.get(`/projects/${pid}/dependencies`);
    const container = document.getElementById('dependenciesContainer');
    if (!container) return;
    renderDependencies(deps, pid);
}

function showAddDependencyModal() {
    const taskSelect = document.getElementById('depTaskId');
    const dependSelect = document.getElementById('depDependsOnId');
    if (!taskSelect || !dependSelect) return;

    taskSelect.innerHTML = '<option value="">选择任务...</option>';
    dependSelect.innerHTML = '<option value="">选择被依赖任务...</option>';

    if (currentProject && currentProject.stages) {
        currentProject.stages.forEach(s => {
            if (s.tasks) {
                s.tasks.forEach(t => {
                    const opt = `<option value="${t.id}">${s.stage_name}: ${t.task_name}</option>`;
                    taskSelect.innerHTML += opt;
                    dependSelect.innerHTML += opt;
                });
            }
        });
    }
    openModal('dependencyModal');
}

async function saveDependency() {
    const data = {
        task_id: document.getElementById('depTaskId').value,
        depends_on_task_id: document.getElementById('depDependsOnId').value,
        dependency_type: document.getElementById('depType').value
    };
    if (!data.task_id || !data.depends_on_task_id) {
        showToast('请完整选择任务', 'warning');
        return;
    }
    if (data.task_id === data.depends_on_task_id) {
        showToast('任务不能依赖于自身', 'warning');
        return;
    }

    await api.post(`/projects/${currentProjectId}/dependencies`, data);
    closeModal('dependencyModal');
    loadDependencies(currentProjectId);
    showToast('依赖关系已添加');
}

async function deleteDependency(id, pid) {
    if (!confirm('确定删除此依赖关系吗？')) return;
    await api.delete(`/projects/dependencies/${id}`);
    loadDependencies(pid);
    showToast('依赖关系已删除');
}

async function renderBurndownInDetail(pid) {
    const burndownTabEl = document.getElementById('pulseBurndownChartInDetail');
    if (!burndownTabEl) return;

    try {
        const res = await fetch(`/api/projects/${pid}/burndown`);
        let data = await res.json();
        if (data.success && data.data) data = data.data;
        else if (data.data) data = data.data;

        if (!data || (!data.ideal_line && !data.actual_line)) {
            burndownTabEl.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100%;color:#999;">暂无燃尽图数据</div>';
            return;
        }

        const idealDates = (data.ideal_line || []).map(d => d.date);
        const actualDates = (data.actual_line || []).map(d => d.date);
        const allDates = Array.from(new Set([...idealDates, ...actualDates])).sort();

        const idealMap = {};
        (data.ideal_line || []).forEach(d => { idealMap[d.date] = d.value; });
        const actualMap = {};
        (data.actual_line || []).forEach(d => { actualMap[d.date] = d.value; });

        const idealValues = allDates.map(d => idealMap[d] !== undefined ? idealMap[d] : null);
        const actualValues = allDates.map(d => actualMap[d] !== undefined ? actualMap[d] : null);

        const myChart = echarts.init(burndownTabEl);
        myChart.setOption({
            tooltip: { trigger: 'axis' },
            legend: { data: ['理想进度', '实际进度'], bottom: 0 },
            grid: { left: '3%', right: '4%', top: '10%', bottom: '15%', containLabel: true },
            xAxis: { type: 'category', boundaryGap: false, data: allDates },
            yAxis: { type: 'value', name: '剩余任务' },
            series: [
                { name: '理想进度', type: 'line', data: idealValues, connectNulls: true, lineStyle: { color: '#3b82f6', type: 'dashed' }, itemStyle: { color: '#3b82f6' } },
                { name: '实际进度', type: 'line', data: actualValues, connectNulls: true, lineStyle: { color: '#10b981', width: 2 }, itemStyle: { color: '#10b981' }, areaStyle: { color: 'rgba(16, 185, 129, 0.1)' } }
            ]
        });
        window.addEventListener('resize', () => myChart.resize());
    } catch (e) {
        console.error('Burndown in detail error:', e);
        burndownTabEl.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100%;color:red;">加载失败</div>';
    }
}

function renderInterfaceFlow() {
    const chartDom = document.getElementById('interfaceFlowChart');
    if (!chartDom) return;
    const myChart = echarts.init(chartDom);

    const interfaces = currentProject.interfaces || [];
    const hospitalNode = { name: currentProject.hospital_name, category: 0, draggable: true };
    const nodes = [hospitalNode];
    const links = [];

    interfaces.forEach(i => {
        const sysNode = { name: i.system_name, category: 1, draggable: true };
        if (!nodes.find(n => n.name === sysNode.name)) {
            nodes.push(sysNode);
            links.push({ source: currentProject.hospital_name, target: i.system_name });
        }

        const intNode = { name: i.interface_name, category: 2, draggable: true };
        nodes.push(intNode);
        links.push({ source: i.system_name, target: i.interface_name });
    });

    myChart.setOption({
        title: { text: '接口数据流向拓扑' },
        tooltip: {},
        legend: [{ data: ['核心系统', '第三方系统', '接口明细'] }],
        series: [{
            type: 'graph',
            layout: 'force',
            data: nodes,
            links: links,
            categories: [{ name: '核心系统' }, { name: '第三方系统' }, { name: '接口明细' }],
            roam: true,
            label: { show: true, position: 'right' },
            force: { repulsion: 200, edgeLength: 100 },
            lineStyle: { color: 'source', curveness: 0.3 }
        }]
    });

    window.addEventListener('resize', () => myChart.resize());
}

async function showBurndownChart(pid) {
    if (typeof openModal === 'function') {
        openModal('burndownModal');
    } else {
        const modal = document.getElementById('burndownModal');
        if (modal) {
            modal.classList.add('show');
            modal.style.display = 'flex';
        }
    }

    const chartDom = document.getElementById('burndownChart');
    try {
        if (echarts.getInstanceByDom(chartDom)) {
            echarts.dispose(chartDom);
        }
    } catch (e) { }

    try {
        const res = await fetch(`/api/projects/${pid}/burndown`);
        const result = await res.json();

        let chartData = result;
        if (result.success && result.data) chartData = result.data;
        else if (result.data) chartData = result.data;

        if (!chartData || (!chartData.ideal_line && !chartData.actual_line)) {
            chartDom.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100%;color:#666;">暂无数据</div>';
            return;
        }

        const idealDates = (chartData.ideal_line || []).map(d => d.date);
        const actualDates = (chartData.actual_line || []).map(d => d.date);
        const allDates = Array.from(new Set([...idealDates, ...actualDates])).sort();

        const idealMap = {};
        (chartData.ideal_line || []).forEach(d => { idealMap[d.date] = d.value; });
        const actualMap = {};
        (chartData.actual_line || []).forEach(d => { actualMap[d.date] = d.value; });

        const idealValues = allDates.map(d => idealMap[d] !== undefined ? idealMap[d] : null);
        const actualValues = allDates.map(d => actualMap[d] !== undefined ? actualMap[d] : null);

        const myChart = echarts.init(chartDom);
        myChart.setOption({
            tooltip: { trigger: 'axis' },
            legend: { data: ['理想进度', '实际进度'], bottom: 0 },
            grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
            xAxis: { type: 'category', boundaryGap: false, data: allDates },
            yAxis: { type: 'value', name: '剩余任务数' },
            series: [
                { name: '理想进度', type: 'line', data: idealValues, connectNulls: true, lineStyle: { color: '#3b82f6', type: 'dashed' }, itemStyle: { color: '#3b82f6' } },
                { name: '实际进度', type: 'line', data: actualValues, connectNulls: true, lineStyle: { color: '#10b981', width: 2 }, itemStyle: { color: '#10b981' }, areaStyle: { color: 'rgba(16, 185, 129, 0.1)' } }
            ]
        });

        window.addEventListener('resize', () => myChart.resize());
    } catch (e) {
        console.error('Burndown Chart Error:', e);
        chartDom.innerHTML = `<div style="display:flex;justify-content:center;align-items:center;height:100%;color:red;">加载失败: ${e.message}</div>`;
    }
}

function renderProjectDetail(project) {
    const container = document.getElementById('projectDetailView');
    const bedInfo = [];
    if (project.icu_beds) bedInfo.push(`ICU ${project.icu_beds}床`);
    if (project.operating_rooms) bedInfo.push(`手术间 ${project.operating_rooms}间`);
    if (project.pacu_beds) bedInfo.push(`复苏室 ${project.pacu_beds}床`);

    const pendingIssues = project.issues ? project.issues.filter(i => i.status !== '已解决').length : 0;
    const completedInterfaces = project.interfaces ? project.interfaces.filter(i => i.status === '已完成').length : 0;
    const totalInterfaces = project.interfaces ? project.interfaces.length : 0;
    const onSiteMembers = project.members ? project.members.filter(m => m.is_onsite && m.status === '在岗').length : 0;

    container.innerHTML = `
                <div class="detail-header">
                    <div>
                        <div style="display:flex; align-items:center; gap:12px; margin-bottom:4px;">
                            <h1 class="detail-title">${project.project_name}</h1>
                            ${project.risk_score !== undefined ? `
                                <div class="risk-info-panel-premium" onclick="refreshProjectRisk(${project.id})" style="cursor:pointer;">
                                    <div class="risk-badge" style="background:${getRiskColor(project.risk_score)};">
                                        <span class="risk-score-value">${project.risk_score}</span>
                                        <span class="risk-score-label">RISK</span>
                                    </div>
                                    <div class="risk-analysis-preview">
                                        <div class="risk-level-tag" style="color:${getRiskColor(project.risk_score)};">
                                            ${project.risk_score < 30 ? '🟢 低风险' : project.risk_score < 60 ? '🟡 中等风险' : '🔴 高风险'}
                                        </div>
                                        <div class="risk-text-summary">
                                            ${(() => {
                if (!project.risk_analysis) return '暂无风险分析，点击刷新评估';
                try {
                    const analysis = typeof project.risk_analysis === 'string' ? JSON.parse(project.risk_analysis) : project.risk_analysis;
                    if (Array.isArray(analysis)) {
                        return analysis.map(r => r.content || r.keyword).join('；');
                    }
                    return project.risk_analysis;
                } catch (e) {
                    return project.risk_analysis;
                }
            })()}
                                        </div>
                                    </div>
                                    <div class="risk-action-hint">🔄</div>
                                </div>
                            ` : ''}
                        </div>
                        <div class="detail-meta">
                            <span class="meta-item">🏥 ${project.hospital_name}</span>
                            <span class="meta-item">👤 ${project.project_manager || '未指定'}</span>
                            <span class="meta-item">📅 ${project.plan_start_date || '?'} ~ ${project.plan_end_date || '?'}</span>
                            ${bedInfo.length ? `<span class="meta-item">🛏️ ${bedInfo.join(' / ')}</span>` : ''}
                            <span class="meta-item project-status project-detail-status status-${project.status}" style="cursor:pointer;" onclick="showStatusModal()">${project.status}</span>
                        </div>
                    </div>
                </div>

                <style>
                    .risk-info-panel-premium {
                        display: inline-flex;
                        align-items: center;
                        gap: 12px;
                        background: rgba(255, 255, 255, 0.8);
                        backdrop-filter: blur(10px);
                        border: 1px solid rgba(0, 0, 0, 0.05);
                        padding: 6px 16px 6px 8px;
                        border-radius: 40px;
                        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
                        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                        max-width: 500px;
                    }
                    .risk-info-panel-premium:hover {
                        transform: translateY(-2px);
                        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.08);
                        border-color: rgba(0, 0, 0, 0.1);
                    }
                    .risk-badge {
                        width: 44px;
                        height: 44px;
                        border-radius: 50%;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        color: white;
                        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.15);
                    }
                    .risk-score-value {
                        font-size: 16px;
                        font-weight: 800;
                        line-height: 1;
                    }
                    .risk-score-label {
                        font-size: 8px;
                        font-weight: 700;
                        opacity: 0.9;
                        letter-spacing: 0.5px;
                    }
                    .risk-analysis-preview {
                        flex: 1;
                        min-width: 0;
                    }
                    .risk-level-tag {
                        font-size: 11px;
                        font-weight: 700;
                        margin-bottom: 2px;
                    }
                    .risk-text-summary {
                        font-size: 12px;
                        color: #64748b;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }
                    .risk-action-hint {
                        font-size: 14px;
                        opacity: 0.3;
                        transition: opacity 0.2s;
                    }
                    .risk-info-panel-premium:hover .risk-action-hint {
                        opacity: 0.8;
                        animation: spin 2s linear infinite;
                    }
                    @keyframes spin {
                        from { transform: rotate(0deg); }
                        to { transform: rotate(360deg); }
                    }

                    .action-area {
                        display: flex;
                        flex-direction: column;
                        align-items: flex-start;
                        gap: 8px;
                        padding: 12px 0; /* Removing horizontal padding to align with header if needed, or keep 16px */
                        width: 100%;
                    }
                    
                    /* ===== 第一行：主按钮 ===== */
                    .primary-buttons {
                        display: flex;
                        gap: 12px;
                    }
                    .primary-buttons button {
                        background-color: #6B4EE6;
                        color: #FFFFFF;
                        height: 36px;
                        padding: 0 16px;
                        border-radius: 8px;
                        border: none;
                        font-size: 14px;
                        font-weight: 500;
                        cursor: pointer;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                    }
                    .primary-buttons button:hover {
                        background-color: #5A3ED5;
                    }

                    /* ===== 第二行：次级按钮 + 更多 ===== */
                    .secondary-buttons {
                        display: flex;
                        align-items: center;
                        gap: 4px;
                        flex-wrap: wrap;
                    }
                    .secondary-buttons button {
                        background: transparent;
                        border: none;
                        color: #37352F;
                        font-size: 13px;
                        padding: 6px 10px;
                        border-radius: 6px;
                        cursor: pointer;
                        display: inline-flex;
                        align-items: center;
                    }
                    .secondary-buttons button:hover {
                        background: #F1F1F0;
                    }
                    .dot-separator {
                        color: #C0C0C0;
                        font-size: 13px;
                        user-select: none;
                        margin: 0 2px;
                    }

                    /* ===== 分隔线 ===== */
                    .action-divider {
                        width: 100%;
                        height: 1px;
                        background: #E8E8E8;
                        margin: 16px 0;
                    }

                    /* ===== 更多菜单 ===== */
                    .more-wrapper {
                        position: relative;
                        display: inline-block;
                        margin-left: 8px;
                    }
                    .more-dropdown {
                        display: none;
                        position: absolute;
                        top: 100%;
                        left: 0;
                        z-index: 999;
                        width: 220px;
                        background: #FFFFFF;
                        border: 1px solid #E8E8E8;
                        border-radius: 8px;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.08);
                        padding: 8px 0;
                    }
                    .more-wrapper.open .more-dropdown {
                        display: block;
                    }
                    .menu-group-title {
                        font-size: 12px;
                        color: #9B9A97;
                        padding: 8px 16px 4px 16px;
                        font-weight: 500;
                    }
                    .menu-divider {
                        height: 1px;
                        background: #E8E8E8;
                        margin: 4px 0;
                    }
                    .menu-item {
                        display: block;
                        width: 100%;
                        text-align: left;
                        background: transparent;
                        border: none;
                        font-size: 14px;
                        color: #37352F;
                        padding: 8px 16px;
                        cursor: pointer;
                    }
                    .menu-item:hover {
                        background: #F1F1F0;
                    }
                    .menu-item.danger {
                        color: #EB5757;
                    }
                    </style>

                    <!-- ===== HTML 结构 ===== -->
                    <div class="action-area">
                        <!-- 第一行：主按钮 -->
                        <div class="primary-buttons">
                            <button onclick="showAskAiModal()">🔮 Ask AI</button>
                            <button onclick="refreshProjectRisk(${project.id})">🚩 AI风险评估</button>
                        </div>

                        <!-- 第二行：次级按钮 -->
                        <div class="secondary-buttons">
                            <button onclick="callAiAnalysis(${project.id})">🔍 AI诊断轮廓</button>
                            <span class="dot-separator">·</span>
                            <button onclick="showRiskTrend(${project.id})">📊 风险趋势</button>
                            <span class="dot-separator">·</span>
                            <button onclick="generateDailyReport(${project.id})">📋 AI日报</button>
                            <span class="dot-separator">·</span>
                            <button onclick="generateWeeklyReport(${project.id})">📋 AI周报</button>
                            <span class="dot-separator">·</span>
                            <button onclick="showAiTaskSuggestions(${project.id})">🤖 AI任务分配</button>
                            
                            <!-- 更多按钮 -->
                            <div class="more-wrapper" onclick="this.classList.toggle('open'); event.stopPropagation();">
                                <button>··· 更多</button>
                                <div class="more-dropdown" onclick="event.stopPropagation()">
                                    <div class="menu-group-title">常用工具</div>
                                    <div class="menu-divider"></div>
                                    <button class="menu-item" onclick="showDemandAnalysisModal()">📋 变更影响评估</button>
                                    <button class="menu-item" onclick="showProjectSnapshot(${project.id})">👤 新人快照</button>
                                    <button class="menu-item" onclick="window.open('/tasks-center?project_id=${project.id}', '_blank')">🗂️ 项目任务中心</button>
                                    <button class="menu-item" onclick="toggleShare(${project.id}, ${!project.share_enabled})">
                                        ${project.share_enabled ? '🔗 关闭分享' : '🔗 开启分享'}
                                    </button>
                                    ${project.share_enabled ? `
                                        <button class="menu-item" style="color:var(--primary); font-weight:600;" onclick="copyShareLink('${project.share_token}')">
                                            📋 复制分享链接
                                        </button>
                                    ` : ''}
                                    
                                    <div class="menu-group-title">移动端功能</div>
                                    <div class="menu-divider"></div>
                                    <button class="menu-item" onclick="window.open('/m/briefing/${project.id}', '_blank')">📱 移动端速查卡</button>
                                    <button class="menu-item" onclick="window.open('/m/acceptance/${project.id}', '_blank')">✅ 移动端验收</button>
                                    
                                    <div class="menu-group-title">数据导出</div>
                                    <div class="menu-divider"></div>
                                    <button class="menu-item" onclick="exportProjectReport(${project.id})">📄 导出为 Json</button>
                                    <button class="menu-item" onclick="exportProjectPDF(${project.id})">📄 导出为 PDF</button>
                                    <button class="menu-item" onclick="showBurndownChart(${project.id})">📈 燃尽图趋势</button>
                                    
                                    <div class="menu-group-title">项目管理</div>
                                    <div class="menu-divider"></div>
                                    ${['进行中', '试运行', '暂停'].includes(project.status) ? `<button class="menu-item" onclick="showDepartureModal()">🏗 申请离场</button>` : ''}
                                    <button class="menu-item" onclick="saveAsTemplate(${project.id})">📁 保存为模板</button>
                                    
                                    <div class="menu-divider"></div>
                                    <button class="menu-item danger" onclick="deleteProject(${project.id})">🔴 删除项目</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 分隔线 -->
                    <div class="action-divider"></div>
                    
                    <script>
                        // Auto-close menu when clicking outside (Injected via innerHTML, might not run, so we rely on global main.js listener below)
                        // Actually, scripts in innerHTML don't run. We need to add this to main.js global scope.
                    </script>

                <div class="overview-grid">
                    <div class="overview-card">
                        <div class="overview-card-title">总体进度</div>
                        <div class="overview-card-value progress-text">${project.progress !== undefined ? project.progress : 0}%</div>
                    </div>
                    <div class="overview-card">
                        <div class="overview-card-title">待解决问题</div>
                        <div class="overview-card-value" style="color:${pendingIssues > 0 ? 'var(--danger)' : 'var(--success)'}">${pendingIssues}</div>
                    </div>


                    <div class="overview-card">
                        <div class="overview-card-title">驻场人员</div>
                        <div class="overview-card-value">${onSiteMembers}人</div>
                    </div>
                    <div class="overview-card">
                        <div class="overview-card-title">离场记录</div>
                        <div class="overview-card-value">${project.departures ? project.departures.length : 0}次</div>
                    </div>
                    <div class="overview-card" id="predictionCard" style="background:#f0f9ff; border:1px solid #bae6fd; cursor:pointer;" onclick="showPredictionDetail()">
                        <div class="overview-card-title" style="color:#0369a1;">🔮 预计交付</div>
                        <div class="overview-card-value" id="predictedEndDate" style="font-size:16px; color:#0c4a6e;">计算中...</div>
                    </div>
                    </div>
                </div>

                <div class="panel" id="aiDecisionCenterPanel" style="margin-bottom:20px; border:1px solid #e0e7ff; background:#ffffff; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
                    <div class="panel-header" style="background:linear-gradient(90deg, #f0f4ff, #ffffff); border-bottom:1px solid #e0e7ff; padding:12px 20px; display:flex; justify-content:space-between; align-items:center;">
                        <div class="panel-title" style="color:#4f46e5; font-size:15px; font-weight:700; display:flex; align-items:center; gap:8px;">
                            <span>🤖 AI 决策中心</span>
                            <span style="font-size:11px; font-weight:normal; color:#6b7280; background:#f3f4f6; padding:2px 8px; border-radius:10px;">Decision Center</span>
                        </div>
                        <button class="btn btn-xs btn-outline" onclick="refreshAiDecisionCenter(${project.id})" style="border-radius:6px; font-size:11px;">🔄 刷新决策</button>
                    </div>
                    <div class="panel-body" style="padding:0;">
                        <!-- 1. AI 战略研判 (以前的 aiInsightPanel) -->
                        <div id="aiInsightSection" style="padding:15px 20px; border-bottom:1px solid #f1f5f9;">
                             <div id="aiInsightContent">
                                <div class="loading-spinner" style="font-size:13px; color:#6b7280;">AI 正在分析执行现状...</div>
                             </div>
                        </div>
                        
                        <!-- 2. 战术行动建议 (以前的 recommendedActionsPanel) -->
                        <div id="recommendedActionsSection" style="padding:15px 20px; background:#f8faff;">
                            <div style="font-size:12px; font-weight:600; color:#64748b; margin-bottom:10px; display:flex; align-items:center; gap:4px;">
                                <span style="width:4px; height:12px; background:#4f46e5; border-radius:2px;"></span>
                                战术行动指令 (DirectActions)
                            </div>
                            <div id="recommendedActionsContent">
                                <div style="color:#94a3b8; font-size:12px; text-align:center; padding:10px;">暂无紧急行动建议</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="panel" id="similarProjectsPanel" style="margin-bottom:20px; border:1px solid #e2e8f0; background:#f8fafc;">
                    <div class="panel-header" style="background:linear-gradient(90deg, #f1f5f9, #ffffff); border-bottom:1px solid #e2e8f0; padding:10px 20px;">
                        <div class="panel-title" style="color:#475569; font-size:14px;">📡 相似项目雷达 (AI Discovery)</div>
                    </div>
                    <div class="panel-body" id="similarProjectsContent" style="padding:15px 20px;">
                        <div class="loading-spinner"></div>
                    </div>
                </div>

                <div class="tabs">
                    <div class="tab active" onclick="switchTab(this, 'gantt')">📊 甘特图</div>
                    <div class="tab" onclick="switchTab(this, 'pulse')">📈 脉动</div>
                    <div class="tab" onclick="switchTab(this, 'stages')">📋 阶段</div>
                    <div class="tab" onclick="switchTab(this, 'milestones')">🎯 里程碑</div>
                    <div class="tab" onclick="switchTab(this, 'team')">👥 团队</div>

                    <div class="tab" onclick="switchTab(this, 'flow')">🎨 流设计器</div>
                    <div class="tab" onclick="switchTab(this, 'devices')">📡 设备</div>
                    <div class="tab" onclick="switchTab(this, 'issues')">⚠️ 问题</div>
                    <div class="tab" onclick="switchTab(this, 'communications'); loadCommunications(${project.id})">💬 沟通</div>
                    <div class="tab" onclick="switchTab(this, 'departures')">🚪 离场</div>
                    <div class="tab" onclick="switchTab(this, 'worklogs')">📝 日志</div>
                    <div class="tab" onclick="switchTab(this, 'documents')">📄 文档</div>
                    <div class="tab" onclick="switchTab(this, 'expenses')">💰 费用</div>
                    <div class="tab" onclick="switchTab(this, 'changes')">📝 变更</div>
                    <div class="tab" onclick="switchTab(this, 'acceptance')">✅ 验收</div>
                    <div class="tab" onclick="switchTab(this, 'satisfaction')">⭐ 满意度</div>
                    <div class="tab" onclick="switchTab(this, 'dependencies'); loadDependencies(${project.id})">🔗 依赖</div>
                    <div class="tab" onclick="switchTab(this, 'standup'); loadStandupData(${project.id})">📋 站会</div>
                    <div class="tab" onclick="switchTab(this, 'deviation'); loadDeviationAnalysis(${project.id})">📊 偏差</div>
                    <div class="tab" onclick="switchTab(this, 'interfaceSpec'); InterfaceSpec.renderTab(currentProjectId)" style="position:relative;">📑 智能对照 <span style="position:absolute; top:-6px; right:-6px; background:#ef4444; color:white; font-size:10px; padding:1px 4px; border-radius:4px; transform:scale(0.8);">NEW</span></div>
                    <div class="tab" onclick="switchTab(this, 'financials'); loadProjectFinancials(${project.id})">💰 财务看板</div>
                </div>

                <!-- Tab内容 -->
                <div class="tab-content" id="tab-interfaceSpec">
                    <div id="tabInterfaceSpec"></div>
                </div>

                <div class="tab-content" id="tab-financials">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">💰 项目财务概览 (Cost & Profit)</div>
                            <div class="btn-group">
                                <button class="btn btn-xs btn-outline" onclick="loadProjectFinancials(${project.id})">🔄 刷新数据</button>
                                <button class="btn btn-xs btn-primary" onclick="showRevenueModal(${project.id})">+ 录入收入</button>
                            </div>
                        </div>
                        <div class="panel-body" id="financialsContent">
                            <div class="loading-spinner"></div>
                        </div>
                    </div>
                </div>

                <div class="tab-content active" id="tab-gantt">
                    <div class="panel">
                        <div class="panel-header"><div class="panel-title">项目甘特图</div></div>
                        <div class="panel-body">
                            <div class="gantt-legend" id="projectGanttLegend"></div>
                            <div class="gantt-chart-container" id="projectGanttChart" style="height:350px;"></div>
                        </div>
                    </div>
                </div>

                <div class="tab-content" id="tab-pulse">
                    <div class="panel">
                        <div class="panel-header"><div class="panel-title">📈 任务燃尽趋势</div></div>
                        <div class="panel-body">
                            <div id="pulseBurndownChartInDetail" style="width: 100%; height: 300px;"></div>
                        </div>
                    </div>
                    <div class="panel" style="margin-top: 16px;">
                        <div class="panel-header">
                            <div class="panel-title">📂 报告归档</div>
                            <div style="display:flex;gap:8px;align-items:center;">
                                <select id="archiveTypeFilter" onchange="loadReportArchive(currentProjectId)" style="padding:4px 8px;border-radius:6px;border:1px solid var(--gray-300);font-size:13px;">
                                    <option value="">全部</option>
                                    <option value="daily">日报</option>
                                    <option value="weekly">周报</option>
                                </select>
                                <button class="btn btn-sm btn-outline" onclick="manualGenerateArchive('daily')">📝 生成今日日报</button>
                                <button class="btn btn-sm btn-outline" onclick="manualGenerateArchive('weekly')">📋 生成本周周报</button>
                                <button class="btn btn-sm btn-ai" onclick="showBusinessReportModal(${project.id})">🏢 业务运行月/季报</button>
                            </div>
                        </div>
                        <div class="panel-body" id="reportArchiveList" style="max-height:400px;overflow-y:auto;">
                            <div style="text-align:center;color:var(--gray-400);padding:20px;">加载中...</div>
                        </div>
                    </div>
                </div>

                <div class="tab-content" id="tab-stages">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">📋 项目阶段 <span id="baselineHint" style="font-weight:normal; font-size:12px; color:var(--gray-500); margin-left:12px;"></span></div>
                            <button class="btn btn-primary btn-sm" onclick="showAddStageModal()">+ 添加阶段</button>
                        </div>
                        <div class="panel-body">${renderStages(project.stages)}</div>
                    </div>
                </div>

                <div class="tab-content" id="tab-milestones">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">项目里程碑</div>
                            <button class="btn btn-primary btn-sm" onclick="showModal('milestoneModal')">+ 添加</button>
                        </div>
                        <div class="panel-body">${renderMilestones(project.milestones)}</div>
                    </div>
                </div>

                <div class="tab-content" id="tab-team">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">👥 项目团队</div>
                            <div class="btn-group">
                                <button class="btn btn-ai btn-sm" onclick="showMeetingAssistant()">🎙️ 会议助手</button>
                                <button class="btn btn-primary btn-sm" onclick="showModal('memberModal')">+ 添加成员</button>
                            </div>
                        </div>
                        <div class="panel-body">${renderMembers(project.members)}</div>
                    </div>
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">📞 甲方联系人</div>
                            <button class="btn btn-primary btn-sm" onclick="showModal('contactModal')">+ 添加</button>
                        </div>
                        <div class="panel-body">${renderContacts(project.contacts)}</div>
                    </div>
                </div>

                    </div>
                </div>

                <div class="tab-content" id="tab-interfaces">
                    <div class="panel">
                        <div class="panel-header">
                        
                            <div class="panel-title">接口对接状态 <small id="interfaceCategoryHint" style="font-weight:normal;color:#6b7280;margin-left:10px;"></small></div>
                            <div class="btn-group">
                                <button class="btn btn-outline btn-sm" onclick="batchAddRecommendedInterfaces()" title="根据项目类型批量添加推荐接口">📋 批量导入</button>
                                <button class="btn btn-primary btn-sm" onclick="showInterfaceModal()">+ 新增</button>
                            </div>
                        </div>
                        <div class="panel-body">${renderInterfaces(project.interfaces)}</div>
                    </div>
                </div>

                <div class="tab-content" id="tab-flow">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">🎨 接口流设计器 (Flow Designer)</div>
                            <div class="btn-group">
                                <button class="btn btn-outline btn-sm" onclick="renderInterfaceFlow()">🔄 刷新拓扑</button>
                            </div>
                        </div>
                        <div class="panel-body">
                            <div id="interfaceFlowChart" style="width: 100%; height: 500px; background: #f8fafc; border-radius: 8px;"></div>
                        </div>
                    </div>
                </div>


                <div class="tab-content" id="tab-devices">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">医疗设备管理</div>
                            <button class="btn btn-primary btn-sm" onclick="showModal('deviceModal')">+ 录入</button>
                        </div>
                        <div class="panel-body" id="devicesContainer"><div class="loading-spinner"><div class="spinner"></div></div></div>
                    </div>
                </div>

                <div class="tab-content" id="tab-issues">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">问题跟踪</div>
                            <div class="btn-group">
                                <button class="btn btn-warning btn-sm" onclick="showAiChaserModal()">🔔 AI 智能催单</button>
                                <button class="btn btn-primary btn-sm" onclick="showModal('issueModal')">+ 新增</button>
                            </div>
                        </div>
                        <div class="panel-body">${renderIssues(project.issues)}</div>
                    </div>
                </div>

                <div class="tab-content" id="tab-departures">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">🚪 离场记录</div>
                            ${['进行中', '试运行', '暂停'].includes(project.status) ?
            `<button class="btn btn-pink btn-sm" onclick="showDepartureModal()">+ 申请离场</button>` : ''}
                        </div>
                        <div class="panel-body">${renderDepartures(project.departures)}</div>
                    </div>
                </div>

                <div class="tab-content" id="tab-worklogs">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">📝 工作日志</div>
                            <div class="btn-group">
                                <button class="btn btn-outline btn-sm" onclick="loadWorklogStats()">📊 统计</button>
                                <button class="btn btn-primary btn-sm" onclick="showWorklogModal()">+ 填写日志</button>
                                <button class="btn btn-ai btn-sm" onclick="showAiWorklogModal()">✨ AI 智能填报</button>
                                <button class="btn btn-outline btn-sm" style="border-color:var(--primary); color:var(--primary);" onclick="showMultiLogImportModal()">📝 批量导入</button>
                            </div>
                        </div>
                        <div class="panel-body" id="worklogsContainer"><div class="loading-spinner"><div class="spinner"></div></div></div>
                    </div>
                </div>

                <div class="tab-content" id="tab-documents">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">📄 项目文档</div>
                            <button class="btn btn-primary btn-sm" onclick="showModal('documentModal')">+ 上传</button>
                        </div>
                        <div class="panel-body" id="documentsContainer"><div class="loading-spinner"><div class="spinner"></div></div></div>
                    </div>
                </div>

                <div class="tab-content" id="tab-expenses">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">💰 费用管理</div>
                            <div class="btn-group">
                                <button class="btn btn-outline btn-sm" onclick="loadExpenseStats()">📊 统计</button>
                                <button class="btn btn-primary btn-sm" onclick="showModal('expenseModal')">+ 录入</button>
                            </div>
                        </div>
                        <div class="panel-body" id="expensesContainer"><div class="loading-spinner"><div class="spinner"></div></div></div>
                    </div>
                </div>

                <div class="tab-content" id="tab-changes">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">📝 变更记录</div>
                            <div class="btn-group">
                                <button class="btn btn-ai btn-sm" onclick="showDemandAnalysisModal()">🧬 变更影响评估</button>
                                <button class="btn btn-primary btn-sm" onclick="showModal('changeModal')">+ 变更申请</button>
                            </div>
                        </div>
                        <div class="panel-body" id="changesContainer"><div class="loading-spinner"><div class="spinner"></div></div></div>
                    </div>
                </div>

                <div class="tab-content" id="tab-acceptance">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">✅ 验收管理</div>
                            <button class="btn btn-primary btn-sm" onclick="showAcceptanceModal()">+ 验收申请</button>
                        </div>
                        <div class="panel-body" id="acceptancesContainer"><div class="loading-spinner"><div class="spinner"></div></div></div>
                    </div>
                </div>

                <div class="tab-content" id="tab-satisfaction">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">⭐ 客户满意度</div>
                            <div class="btn-group">
                                <button class="btn btn-outline btn-sm" onclick="showModal('followupModal')">📞 回访</button>
                                <button class="btn btn-primary btn-sm" onclick="showModal('satisfactionModal')">+ 调查</button>
                            </div>
                        </div>
                        <div class="panel-body" id="satisfactionContainer"><div class="loading-spinner"><div class="spinner"></div></div></div>
                    </div>
                </div>

                <div class="tab-content" id="tab-communications">
                    <div class="panel">
                        <div class="panel-header" style="flex-wrap:wrap;gap:8px;">
                            <div class="panel-title">💬 客户沟通记录</div>
                            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                                <button class="btn btn-sm" style="background:linear-gradient(135deg,#8b5cf6,#6366f1);color:white;border:none;" onclick="analyzeCommunications()" title="AI从项目管理/需求分析角度分析所有沟通记录">🤖 AI 智能分析</button>
                                <button class="btn btn-sm" style="background:linear-gradient(135deg,#0ea5e9,#2563eb);color:white;border:none;" onclick="document.getElementById('commFileInput').click()" title="上传文件(Word/PDF/Excel/TXT)进行AI分析">📎 上传文件分析</button>
                                <button class="btn btn-primary btn-sm" onclick="showAddCommunicationModal()">+ 新增记录</button>
                            </div>
                        </div>
                        <div class="panel-body">
                            <div id="communicationsList">
                                <div class="loading-spinner"><div class="spinner"></div></div>
                            </div>
                        </div>
                    </div>
                    <div id="communicationAiAnalysis" style="display:none;margin-top:16px;"></div>
                    <input type="file" id="commFileInput" style="display:none;" accept=".docx,.pdf,.xlsx,.xls,.txt,.csv,.md" onchange="analyzeUploadedFile(this)">
                </div>

                <!-- 任务依赖关系 Tab -->
                <div class="tab-content" id="tab-dependencies">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">🔗 任务依赖关系</div>
                            <div class="btn-group">
                                <button class="btn btn-outline btn-sm" onclick="showCriticalPath(${project.id})">🎯 关键路径</button>
                                <button class="btn btn-primary btn-sm" onclick="showAddDependencyModal()">+ 添加依赖</button>
                            </div>
                        </div>
                        <div class="panel-body" id="dependenciesContainer"><div class="loading-spinner"><div class="spinner"></div></div></div>
                    </div>
                    <div id="criticalPathPanel" style="display:none;margin-top:16px;"></div>
                </div>

                <!-- 每日站会助手 Tab -->
                <div class="tab-content" id="tab-standup">
                    <div class="panel">
                        <div class="panel-header" style="flex-wrap:wrap;gap:8px;">
                            <div class="panel-title">📋 每日站会助手</div>
                            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                                <input type="date" id="standupDatePicker" value="${new Date().toISOString().slice(0, 10)}" onchange="loadStandupData(${project.id}, this.value)" style="padding:4px 8px;border-radius:6px;border:1px solid var(--gray-300);font-size:13px;">
                                <button class="btn btn-sm" style="background:linear-gradient(135deg,#8b5cf6,#6366f1);color:white;border:none;" onclick="generateAiStandup(${project.id})">🤖 AI生成纪要</button>
                                <button class="btn btn-outline btn-sm" onclick="loadStandupHistory(${project.id})">📜 历史纪要</button>
                            </div>
                        </div>
                        <div class="panel-body" id="standupContainer"><div class="loading-spinner"><div class="spinner"></div></div></div>
                    </div>
                    <div id="standupAiResult" style="display:none;margin-top:16px;"></div>
                    <div id="standupHistoryPanel" style="display:none;margin-top:16px;"></div>
                </div>

                <!-- 进度偏差分析 Tab -->
                <div class="tab-content" id="tab-deviation">
                    <div class="panel">
                        <div class="panel-header" style="flex-wrap:wrap;gap:8px;">
                            <div class="panel-title">📊 进度偏差分析</div>
                            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                                <button class="btn btn-outline btn-sm" onclick="captureSnapshot(${project.id})">📸 拍摄快照</button>
                                <button class="btn btn-sm" style="background:linear-gradient(135deg,#8b5cf6,#6366f1);color:white;border:none;" onclick="generateDeviationReport(${project.id})">🤖 AI偏差诊断</button>
                            </div>
                        </div>
                        <div class="panel-body" id="deviationContainer"><div class="loading-spinner"><div class="spinner"></div></div></div>
                    </div>
                    <div id="deviationAiReport" style="display:none;margin-top:16px;"></div>
                </div>
            `;

    setTimeout(() => {
        renderGanttLegend('projectGanttLegend');
        renderProjectGantt(project);
    }, 100);

    loadDevices(project.id);
    loadWorklogs(project.id);
    loadDocuments(project.id);
    loadExpenses(project.id);
    loadChanges(project.id);
    loadAcceptances(project.id);
    loadSatisfaction(project.id);
    loadDependencies(project.id);
    enableTabDragging();
}

async function refreshAiDecisionCenter(projectId, isRefresh = false) {
    loadAiDailyInsight(projectId, isRefresh);
    loadRecommendedActions(projectId, isRefresh);
}
