// Project-detail actions extracted from project_detail_hub.js

function getRiskColor(score) {
    const value = Number(score || 0);
    if (value < 30) return '#10b981';
    if (value < 60) return '#f59e0b';
    return '#ef4444';
}

async function refreshProjectRisk(projectId) {
    openModal('riskModal');
    const loadingEl = document.getElementById('riskLoading');
    const contentEl = document.getElementById('riskContent');
    if (loadingEl) loadingEl.style.display = 'block';
    if (contentEl) contentEl.style.display = 'none';

    try {
        const data = await api.post(`/projects/${projectId}/ai-risk-score`, {});
        const score = data.risk_score ?? data.score ?? 0;
        const analysis = data.analysis ?? data.risk_analysis ?? data.summary ?? '暂无风险分析';

        displayRiskResult(score, analysis);

        if (currentProject && Number(currentProject.id) === Number(projectId)) {
            currentProject.risk_score = score;
            currentProject.risk_analysis = analysis;
        }

        if (loadingEl) loadingEl.style.display = 'none';
        if (contentEl) contentEl.style.display = 'block';
    } catch (e) {
        if (loadingEl) loadingEl.style.display = 'none';
        if (contentEl) {
            contentEl.style.display = 'block';
            contentEl.innerHTML = `<div style="color:var(--danger);text-align:center;">风险评估失败: ${e.message}</div>`;
        }
    }
}

function displayRiskResult(score, analysis) {
    const scoreValueEl = document.getElementById('riskScoreValue');
    const scoreLabelEl = document.getElementById('riskScoreLabel');
    const analysisEl = document.getElementById('riskAnalysisText');
    const color = getRiskColor(score);

    if (scoreValueEl) {
        scoreValueEl.textContent = score;
        scoreValueEl.style.color = color;
    }

    if (scoreLabelEl) {
        scoreLabelEl.textContent = score < 30 ? '低风险' : score < 60 ? '中等风险' : '高风险';
        scoreLabelEl.style.color = color;
    }

    if (analysisEl) {
        analysisEl.innerHTML = renderAiMarkdown(typeof analysis === 'string' ? analysis : JSON.stringify(analysis));
    }
}

function refreshRiskAnalysis() {
    if (currentProjectId) {
        refreshProjectRisk(currentProjectId);
    }
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

// Interface-template helpers migrated to static/js/project_detail_tools_hub.js

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

// Document upload helper migrated to static/js/project_detail_tools_hub.js

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
