// Project-detail actions extracted from project_detail_hub.js

function getRiskColor(score) {
    const value = Number(score || 0);
    if (value < 30) return '#10b981';
    if (value < 60) return '#f59e0b';
    return '#ef4444';
}

async function executeProjectAction(action, successMessage, onSuccess) {
    try {
        await action();
        if (typeof onSuccess === 'function') {
            await onSuccess();
        }
        if (successMessage) showToast(successMessage, 'success');
    } catch (e) {
        showToast('操作失败: ' + e.message, 'danger');
        throw e;
    }
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
    showModal('departureModal', { reset: false });
}

function showWorklogModal() {
    currentEditingLogId = null;
    document.getElementById('worklogModalTitle').textContent = '📝 填写工作日志';
    document.getElementById('worklogForm').reset();
    document.getElementById('logDate').value = new Date().toISOString().split('T')[0];
    showModal('worklogModal', { reset: false });
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
    showModal('acceptanceModal', { reset: false });
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

let currentEditingMemberId = null;
let memberDirectoryCache = null;
let memberDirectorySearchTimer = null;
let memberDirectoryRenderedEntries = [];

async function saveMember() {
    const isEditing = !!currentEditingMemberId;
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
    if (isEditing) {
        await api.put(`/members/${currentEditingMemberId}`, data);
    } else {
        await api.post(`/projects/${currentProjectId}/members`, data);
    }
    closeModal('memberModal');
    currentEditingMemberId = null;
    memberDirectoryCache = null;
    await syncCurrentProjectDetailState(['members']);
    showToast(isEditing ? '成员已更新' : '成员已保存', 'success');
}

function syncMemberRolePreset() {
    const role = document.getElementById('memberRole')?.value || '';
    const onsite = document.getElementById('memberOnsite');
    if (!onsite) return;
    const onsiteRoles = ['驻场实施工程师', '实施项目经理', '实施支持工程师', '交付经理'];
    const remoteRoles = ['研发经理', '后端研发工程师', '前端研发工程师', '接口研发工程师', '测试研发工程师', '运维研发工程师', '产品经理'];
    if (onsiteRoles.includes(role)) {
        onsite.value = '1';
    } else if (remoteRoles.includes(role)) {
        onsite.value = '0';
    }
}

function ensureMemberRoleOption(roleValue) {
    const role = document.getElementById('memberRole');
    if (!role || !roleValue) return;
    const exists = Array.from(role.options).some(option => option.value === roleValue);
    if (!exists) {
        role.insertAdjacentHTML('beforeend', `<option value="${roleValue}">${roleValue}</option>`);
    }
}

function showMemberModal() {
    currentEditingMemberId = null;
    document.getElementById('memberForm')?.reset();
    const title = document.getElementById('memberModalTitle');
    if (title) title.textContent = '添加项目成员（实施 / 研发）';
    const submit = document.getElementById('memberModalSubmit');
    if (submit) submit.textContent = '保存';
    const role = document.getElementById('memberRole');
    if (role) role.value = '驻场实施工程师';
    const joinDate = document.getElementById('memberJoinDate');
    if (joinDate) joinDate.value = new Date().toISOString().split('T')[0];
    hideMemberDirectorySuggestions();
    syncMemberRolePreset();
    showModal('memberModal', { reset: false });
}

function showEditMemberModal(memberId) {
    const member = Array.isArray(currentProject?.members)
        ? currentProject.members.find(item => Number(item.id) === Number(memberId))
        : null;
    if (!member) {
        showToast('未找到成员信息', 'warning');
        return;
    }
    currentEditingMemberId = member.id;
    const title = document.getElementById('memberModalTitle');
    if (title) title.textContent = `编辑成员 · ${member.name}`;
    const submit = document.getElementById('memberModalSubmit');
    if (submit) submit.textContent = '更新';
    document.getElementById('memberName').value = member.name || '';
    ensureMemberRoleOption(member.role);
    document.getElementById('memberRole').value = member.role || '驻场实施工程师';
    document.getElementById('memberPhone').value = member.phone || '';
    document.getElementById('memberEmail').value = member.email || '';
    document.getElementById('memberJoinDate').value = member.join_date ? String(member.join_date).slice(0, 10) : '';
    document.getElementById('memberCity').value = member.current_city || '';
    document.getElementById('memberOnsite').value = member.is_onsite ? '1' : '0';
    hideMemberDirectorySuggestions();
    showModal('memberModal', { reset: false });
}

async function loadMemberDirectory(keyword = '') {
    const trimmed = String(keyword || '').trim();
    if (!trimmed && Array.isArray(memberDirectoryCache)) {
        return memberDirectoryCache;
    }
    const query = new URLSearchParams({ q: trimmed, limit: '8' }).toString();
    const entries = await api.get(`/members/directory?${query}`, { silent: true });
    if (!trimmed) {
        memberDirectoryCache = Array.isArray(entries) ? entries : [];
    }
    return Array.isArray(entries) ? entries : [];
}

function renderMemberDirectorySuggestions(entries) {
    const box = document.getElementById('memberNameSuggestions');
    if (!box) return;
    if (!entries.length) {
        box.style.display = 'none';
        box.innerHTML = '';
        memberDirectoryRenderedEntries = [];
        return;
    }
    memberDirectoryRenderedEntries = entries.slice();
    box.innerHTML = entries.map((item, index) => `
        <button type="button"
            style="width:100%;text-align:left;padding:12px 14px;border:none;background:${index === 0 ? 'var(--gray-50)' : 'white'};cursor:pointer;border-bottom:${index === entries.length - 1 ? 'none' : '1px solid var(--gray-100)'};"
            onclick="selectMemberDirectoryEntryByIndex(${index})">
            <div style="font-size:14px;font-weight:700;color:var(--gray-800);">${item.name}</div>
            <div style="margin-top:4px;font-size:12px;color:var(--gray-500);">${item.role || '未设置角色'}${item.current_city ? ` | ${item.current_city}` : ''}${item.phone ? ` | ${item.phone}` : ''}</div>
        </button>
    `).join('');
    box.style.display = 'block';
}

function hideMemberDirectorySuggestions() {
    const box = document.getElementById('memberNameSuggestions');
    if (!box) return;
    box.style.display = 'none';
    box.innerHTML = '';
    memberDirectoryRenderedEntries = [];
}

function selectMemberDirectoryEntry(item) {
    document.getElementById('memberName').value = item.name || '';
    if (item.role) {
        ensureMemberRoleOption(item.role);
        document.getElementById('memberRole').value = item.role;
    }
    if (item.phone) document.getElementById('memberPhone').value = item.phone;
    if (item.email) document.getElementById('memberEmail').value = item.email;
    if (item.join_date) document.getElementById('memberJoinDate').value = item.join_date;
    if (item.current_city) document.getElementById('memberCity').value = item.current_city;
    syncMemberRolePreset();
    document.getElementById('memberOnsite').value = item.is_onsite ? '1' : '0';
    hideMemberDirectorySuggestions();
}

function selectMemberDirectoryEntryByIndex(index) {
    const item = memberDirectoryRenderedEntries[index];
    if (!item) return;
    selectMemberDirectoryEntry(item);
}

function searchMemberDirectory(keyword) {
    if (memberDirectorySearchTimer) {
        clearTimeout(memberDirectorySearchTimer);
    }
    memberDirectorySearchTimer = setTimeout(async () => {
        try {
            const entries = await loadMemberDirectory(keyword);
            renderMemberDirectorySuggestions(entries);
        } catch (e) {
            hideMemberDirectorySuggestions();
        }
    }, 120);
}

document.addEventListener('click', (event) => {
    const input = document.getElementById('memberName');
    const box = document.getElementById('memberNameSuggestions');
    if (!input || !box) return;
    if (event.target === input || box.contains(event.target)) return;
    hideMemberDirectorySuggestions();
});

function openCurrentProjectPerformanceReview() {
    if (!currentProjectId) {
        showToast('请先进入项目详情后再打开研发绩效评价', 'warning');
        return;
    }
    if (typeof showPerformanceAnalytics === 'function') {
        if (window.performanceReviewState) {
            window.performanceReviewState.selectedProjectId = Number(currentProjectId);
        }
        showPerformanceAnalytics();
        return;
    }
    showToast('研发绩效页面尚未加载，请稍后重试', 'warning');
}

function normalizeMemberRole(role, isOnsite) {
    const text = String(role || '').trim();
    if (!text) {
        return isOnsite ? '驻场实施工程师' : '后端研发工程师';
    }
    if (/后端|backend/i.test(text)) return '后端研发工程师';
    if (/前端|frontend|ui/i.test(text)) return '前端研发工程师';
    if (/接口/.test(text)) return '接口研发工程师';
    if (/测试|qa/i.test(text)) return '测试研发工程师';
    if (/运维|ops/i.test(text)) return '运维研发工程师';
    if (/产品/.test(text)) return '产品经理';
    if (/研发经理|技术经理|开发经理/.test(text)) return '研发经理';
    if (/交付/.test(text)) return '交付经理';
    if (/项目经理/.test(text) && isOnsite) return '实施项目经理';
    if (/实施支持/.test(text)) return '实施支持工程师';
    if (/实施|驻场|现场|工程/.test(text) || isOnsite) return '驻场实施工程师';
    return text;
}

async function normalizeProjectMemberRoles() {
    const members = Array.isArray(currentProject?.members) ? currentProject.members : [];
    if (!members.length) {
        showToast('当前项目暂无成员可规范', 'warning');
        return;
    }
    const updates = members
        .map(member => ({
            id: member.id,
            name: member.name,
            from: member.role || '',
            to: normalizeMemberRole(member.role, !!member.is_onsite),
            is_onsite: !!member.is_onsite
        }))
        .filter(item => item.from !== item.to);
    if (!updates.length) {
        showToast('当前项目成员角色已经比较规范', 'success');
        return;
    }
    const preview = updates.slice(0, 8).map(item => `${item.name}: ${item.from || '未设置'} -> ${item.to}`).join('\n');
    if (!confirm(`将批量规范 ${updates.length} 位成员的角色：\n\n${preview}\n\n确定继续吗？`)) {
        return;
    }
    for (const item of updates) {
        await api.put(`/members/${item.id}`, { role: item.to, is_onsite: item.is_onsite });
    }
    await syncCurrentProjectDetailState(['members']);
    showToast(`已规范 ${updates.length} 位成员角色`, 'success');
}

async function bulkSetUnknownMembersRole(targetType) {
    const members = Array.isArray(currentProject?.members) ? currentProject.members : [];
    const unknownMembers = members.filter(member => {
        const role = String(member?.role || '');
        const isRAndD = ['研发', '开发', '后端', '前端', '测试', '产品', '架构', '算法', '平台', '接口研发'].some(keyword => role.includes(keyword));
        const isImplementation = ['现场', '驻场', '实施', '交付', '项目经理', '工程'].some(keyword => role.includes(keyword)) && !isRAndD;
        return !(isRAndD || isImplementation || member?.is_onsite);
    });
    if (!unknownMembers.length) {
        showToast('当前项目没有待确认身份的成员', 'success');
        return;
    }
    const nextRole = targetType === 'implementation' ? '驻场实施工程师' : '后端研发工程师';
    const nextOnsite = targetType === 'implementation';
    const label = targetType === 'implementation' ? '实施侧评分人' : '研发侧被评分对象';
    const preview = unknownMembers.slice(0, 8).map(member => `${member.name} -> ${nextRole}`).join('\n');
    if (!confirm(`将 ${unknownMembers.length} 位待确认身份成员批量设为“${label}”：\n\n${preview}\n\n确定继续吗？`)) {
        return;
    }
    for (const member of unknownMembers) {
        await api.put(`/members/${member.id}`, { role: nextRole, is_onsite: nextOnsite });
    }
    await syncCurrentProjectDetailState(['members']);
    showToast(`已将 ${unknownMembers.length} 位成员设为${label}`, 'success');
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
    await syncCurrentProjectDetailState(['contacts']);
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

    await executeProjectAction(async () => {
        if (currentEditingLogId) {
            await api.put(`/worklogs/${currentEditingLogId}`, data);
        } else {
            await api.post(`/projects/${currentProjectId}/worklogs`, data);
        }
        closeModal('worklogModal');
    }, currentEditingLogId ? '日志已更新' : '日志已保存', async () => {
        await loadWorklogs(currentProjectId);
    });
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
    await executeProjectAction(async () => {
        await api.post(`/projects/${currentProjectId}/expenses`, data);
        closeModal('expenseModal');
    }, '费用已保存', async () => {
        await loadExpenses(currentProjectId);
    });
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
    await executeProjectAction(async () => {
        await api.post(`/projects/${currentProjectId}/changes`, data);
        closeModal('changeModal');
    }, '变更已保存', async () => {
        await loadChanges(currentProjectId);
    });
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
    await syncCurrentProjectDetailState(['interfaces']);
}

// Document upload helper migrated to static/js/project_detail_tools_hub.js

let isSavingIssue = false;

function showIssueModal() {
    document.getElementById('issueForm')?.reset();
    const ownerSelect = document.getElementById('issueOwnerMemberId');
    if (ownerSelect) {
        const members = Array.isArray(currentProject?.members) ? currentProject.members : [];
        ownerSelect.innerHTML = `<option value="">未指定</option>${members.map(member => `
            <option value="${member.id}">${member.name}${member.role ? ` (${member.role})` : ''}</option>
        `).join('')}`;
        ownerSelect.value = '';
    }
    const blocker = document.getElementById('issueExternalBlocker');
    if (blocker) blocker.checked = false;
    const pushWecom = document.getElementById('issuePushWecom');
    if (pushWecom) pushWecom.checked = true;
    const rootCause = document.getElementById('issueRootCauseType');
    if (rootCause) rootCause.value = '';
    showModal('issueModal', { reset: false });
}

async function saveIssue() {
    if (isSavingIssue) return;
    const data = {
        issue_type: document.getElementById('issueType').value,
        severity: document.getElementById('issueSeverity').value,
        description: document.getElementById('issueDesc').value,
        owner_member_id: document.getElementById('issueOwnerMemberId')?.value ? Number(document.getElementById('issueOwnerMemberId').value) : null,
        is_external_blocker: !!document.getElementById('issueExternalBlocker')?.checked,
        root_cause_type: document.getElementById('issueRootCauseType')?.value || null,
        push_to_wecom: !!document.getElementById('issuePushWecom')?.checked
    };
    if (!data.description) {
        showToast('请填写问题描述', 'warning');
        return;
    }

    isSavingIssue = true;
    try {
        await executeProjectAction(async () => {
            await api.post(`/projects/${currentProjectId}/issues`, data);
            closeModal('issueModal');
            document.getElementById('issueDesc').value = '';
        }, '问题已保存', async () => {
            await syncCurrentProjectDetailState(['issues']);
        });
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
    await executeProjectAction(async () => {
        await api.post(`/projects/${currentProjectId}/milestones`, data);
        closeModal('milestoneModal');
    }, '里程碑已保存', async () => {
        await syncCurrentProjectDetailState(['milestones']);
    });
}

async function toggleTask(taskId, event) {
    event.stopPropagation();
    const checkbox = event.target;
    const taskItem = checkbox.closest('.task-item');
    const taskName = taskItem ? taskItem.querySelector('.task-name') : null;
    if (checkbox.dataset.loading === '1') return;
    checkbox.dataset.loading = '1';

    try {
        await api.post(`/tasks/${taskId}/toggle`, {});

        const willBeChecked = !checkbox.classList.contains('checked');
        checkbox.classList.toggle('checked', willBeChecked);
        if (taskName) {
            taskName.classList.toggle('completed', willBeChecked);
        }

        const stageItem = checkbox.closest('.stage-item');
        if (stageItem) {
            const allTasks = stageItem.querySelectorAll('.task-checkbox');
            const completedTasks = stageItem.querySelectorAll('.task-checkbox.checked');
            const progress = allTasks.length > 0 ? Math.round(completedTasks.length / allTasks.length * 100) : 0;
            const progressColor = progress >= 100 ? '#10b981' : progress >= 70 ? '#2563eb' : progress >= 30 ? '#f59e0b' : '#94a3b8';
            const statusBg = progress >= 100 ? '#ecfdf5' : progress >= 30 ? '#eff6ff' : '#f8fafc';
            const statusColor = progress >= 100 ? '#059669' : progress >= 30 ? '#2563eb' : '#94a3b8';

            const progressBar = stageItem.querySelector('.stage-progress-mini-bar');
            const progressText = stageItem.querySelector('.stage-info > span:nth-child(2)');
            const statusBadge = stageItem.querySelector('.stage-status-badge');

            if (progressBar) {
                progressBar.style.width = `${progress}%`;
                progressBar.style.background = progressColor;
            }
            if (progressText) {
                progressText.textContent = `${progress}%`;
                progressText.style.color = progressColor;
                progressText.style.fontWeight = '700';
            }
            if (statusBadge) {
                statusBadge.style.background = statusBg;
                statusBadge.style.color = statusColor;
                statusBadge.textContent = progress >= 100 ? '✅ 已完成' : progress >= 30 ? '⏳ 进行中' : '⏸ 待开始';
            }

            if (currentProject && Array.isArray(currentProject.stages)) {
                const localStage = currentProject.stages.find(item => String(item.id) === stageItem.id.replace('stage-', ''));
                if (localStage) {
                    localStage.progress = progress;
                    if (Array.isArray(localStage.tasks)) {
                        const localTask = localStage.tasks.find(item => Number(item.id) === Number(taskId));
                        if (localTask) {
                            localTask.is_completed = willBeChecked;
                            localTask.completed_date = willBeChecked ? new Date().toISOString().slice(0, 10) : null;
                        }
                    }
                }
            }
        }

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
        await updateOverallProgress(project);
    } catch (e) {
        showToast('任务切换失败: ' + e.message, 'danger');
    } finally {
        checkbox.dataset.loading = '0';
    }
}

async function toggleMilestone(mid) {
    try {
        await api.post(`/projects/milestones/${mid}/toggle`, {});
        const milestone = document.querySelector(`.milestone-item .milestone-diamond[onclick="toggleMilestone(${mid})"]`);
        if (milestone) {
            milestone.classList.toggle('completed');
        }

        if (currentProject && Array.isArray(currentProject.milestones)) {
            const localMilestone = currentProject.milestones.find(item => Number(item.id) === Number(mid));
            if (localMilestone) {
                localMilestone.is_completed = !localMilestone.is_completed;
                localMilestone.completed_date = localMilestone.is_completed ? new Date().toISOString().slice(0, 10) : null;
            }
        }

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
        await updateOverallProgress(project);
    } catch (e) {
        showToast('里程碑切换失败: ' + e.message, 'danger');
    }
}

async function updateOverallProgress(projectData = null) {
    if (!currentProjectId && !projectData) return;
    try {
        const project = projectData || await api.get(`/projects/${currentProjectId}`);
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
            const progress = Number(project.progress || 0);
            const progressColor = progress >= 100 ? '#10b981' : progress >= 70 ? '#3b82f6' : progress >= 30 ? '#f59e0b' : '#94a3b8';
            const miniBar = activeCard.querySelector('.progress-mini-bar');
            if (miniBar) {
                miniBar.style.width = `${progress}%`;
                miniBar.style.background = progressColor;
            }
            const statusBadge = activeCard.querySelector('.badge');
            if (statusBadge) {
                const statusColor = STATUS_COLORS[project.status] || '#9ca3af';
                statusBadge.style.backgroundColor = `${statusColor}20`;
                statusBadge.style.color = statusColor;
                statusBadge.textContent = project.status;
            }
            const spans = activeCard.querySelectorAll('div[style*="justify-content:space-between"] span');
            if (spans.length >= 2) {
                spans[1].textContent = `${progress}%`;
                spans[1].style.color = progressColor;
                spans[1].style.fontWeight = '700';
            }
        }

        if (Array.isArray(allProjects)) {
            const cached = allProjects.find(item => Number(item.id) === Number(currentProjectId));
            if (cached) {
                cached.progress = project.progress || 0;
                cached.status = project.status || cached.status;
            }
            if (typeof renderProjectList === 'function') {
                renderProjectList();
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
    await syncCurrentProjectDetailState(['members']);
}

async function deleteContact(cid) {
    if (!confirm('确定删除？')) return;
    await api.delete(`/contacts/${cid}`);
    await syncCurrentProjectDetailState(['contacts']);
}

async function deleteInterface(iid) {
    if (!confirm('确定删除？')) return;
    await api.delete(`/projects/interfaces/${iid}`);
    await syncCurrentProjectDetailState(['interfaces']);
}

async function deleteIssue(iid) {
    if (!confirm('确定删除？')) return;
    await api.delete(`/issues/${iid}`);
    await syncCurrentProjectDetailState(['issues']);
}

async function deleteDevice(did) {
    if (!confirm('确定删除？')) return;
    await api.delete(`/devices/${did}`);
    loadDevices(currentProjectId);
}

async function deleteMilestone(mid) {
    if (!confirm('确定删除？')) return;
    await api.delete(`/milestones/${mid}`);
    await syncCurrentProjectDetailState(['milestones']);
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
    await syncCurrentProjectDetailState(['issues']);
}

async function pushIssueToWecom(issueId) {
    try {
        const res = await api.post(`/issues/${issueId}/push-wecom`, {});
        const info = [];
        if (Array.isArray(res.sent_members) && res.sent_members.length) {
            info.push(`已推送：${res.sent_members.join('、')}`);
        } else if (res.sent_count) {
            info.push(`已推送 ${res.sent_count} 人`);
        }
        if (Array.isArray(res.missing_members) && res.missing_members.length) {
            info.push(`未绑定企微：${res.missing_members.join('、')}`);
        }
        showToast(info.length ? info.join('；') : (res.message || '已执行企业微信推送'), res.sent_count ? 'success' : 'warning');
        await syncCurrentProjectDetailState(['issues']);
    } catch (e) {
        showToast(`企业微信推送失败: ${e.message}`, 'danger');
    }
}

async function showIssuePushReceipts(issueId) {
    try {
        const receipts = await api.get(`/issues/${issueId}/push-receipts`, { silent: true });
        const items = Array.isArray(receipts) ? receipts : [];
        const html = items.length ? items.map(item => `
            <div style="border:1px solid var(--gray-200);border-radius:12px;padding:12px 14px;margin-bottom:10px;background:white;">
                <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
                    <div>
                        <div style="font-size:14px;font-weight:700;color:var(--gray-800);">${item.success ? '推送成功' : '推送失败'}</div>
                        <div style="font-size:12px;color:var(--gray-500);margin-top:4px;">${String(item.created_at || '').replace('T', ' ').slice(0, 19)} · 触发方式：${item.trigger_type || 'manual'}</div>
                    </div>
                    <span class="badge ${item.success ? 'badge-success' : 'badge-warning'}">${item.sent_count || 0} 人</span>
                </div>
                <div style="margin-top:10px;font-size:13px;color:var(--gray-700);line-height:1.8;">
                    ${item.sent_members?.length ? `<div>已推送：${item.sent_members.join('、')}</div>` : ''}
                    ${item.missing_members?.length ? `<div style="color:#c2410c;">未绑定企微：${item.missing_members.join('、')}</div>` : ''}
                    <div style="margin-top:6px;color:var(--gray-500);">${item.result_message || ''}</div>
                </div>
            </div>
        `).join('') : '<div class="empty-state"><p>暂无推送回执</p><div class="empty-state-hint">执行过企业微信推送后，这里会显示推送结果。</div></div>';
        showGenericModal('企微推送回执', html);
    } catch (e) {
        showToast(`加载推送回执失败: ${e.message}`, 'danger');
    }
}

async function updateInterfaceStatus(interfaceId, newStatus) {
    await api.put(`/projects/interfaces/${interfaceId}`, { status: newStatus });
    await syncCurrentProjectDetailState(['interfaces']);
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
        container.innerHTML = '<div class="empty-state"><p>暂无工作日志</p><div class="empty-state-hint">可填写日志或使用 AI 智能填报补齐今日工作内容。</div></div>';
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

    showModal('worklogModal', { reset: false });
}

async function loadDocuments(pid) {
    const docs = await api.get(`/projects/${pid}/documents`);
    const container = document.getElementById('documentsContainer');
    if (!container) return;
    if (!docs || !docs.length) {
        container.innerHTML = '<div class="empty-state"><p>暂无文档</p><div class="empty-state-hint">可上传需求、接口、部署等文档，后续会联动知识库与对照中心。</div></div>';
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
        container.innerHTML = '<div class="empty-state"><p>暂无费用记录</p><div class="empty-state-hint">录入费用后可进入审批、财务看板和经营分析。</div></div>';
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
        container.innerHTML = '<div class="empty-state"><p>暂无变更记录</p><div class="empty-state-hint">当需求、范围、人员或时间调整时，可在此登记变更并进入审批流。</div></div>';
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
        container.innerHTML = '<div class="empty-state"><p>暂无验收记录</p><div class="empty-state-hint">建议在阶段验收和上线节点录入验收结果，便于项目收尾追踪。</div></div>';
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
    const container = document.getElementById('satisfactionContainer');
    if (!container) return;

    try {
        const [recordsRes, statsRes] = await Promise.all([
            api.get(`/projects/${pid}/satisfaction`, { silent: true }),
            api.get(`/projects/${pid}/satisfaction/stats`, { silent: true })
        ]);

        const records = Array.isArray(recordsRes) ? recordsRes : [];
        const stats = statsRes && typeof statsRes === 'object' ? statsRes : {};

        let html = '';
        if ((stats.count || 0) > 0) {
            html += `
                <div style="margin-bottom:20px;padding:16px;background:var(--gray-50);border-radius:10px;">
                    <div style="font-size:14px;font-weight:600;margin-bottom:12px;">满意度统计 (${stats.count}次调查)</div>
                    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;text-align:center;">
                        <div><div style="font-size:20px;font-weight:700;color:var(--primary);">${Number(stats.avg_quality || 0).toFixed(1)}</div><div style="font-size:11px;color:var(--gray-500);">系统质量</div></div>
                        <div><div style="font-size:20px;font-weight:700;color:var(--primary);">${Number(stats.avg_service || 0).toFixed(1)}</div><div style="font-size:11px;color:var(--gray-500);">服务态度</div></div>
                        <div><div style="font-size:20px;font-weight:700;color:var(--primary);">${Number(stats.avg_response || 0).toFixed(1)}</div><div style="font-size:11px;color:var(--gray-500);">响应速度</div></div>
                        <div><div style="font-size:20px;font-weight:700;color:var(--primary);">${Number(stats.avg_professional || 0).toFixed(1)}</div><div style="font-size:11px;color:var(--gray-500);">专业能力</div></div>
                        <div><div style="font-size:20px;font-weight:700;color:var(--success);">${Number(stats.avg_overall || 0).toFixed(1)}</div><div style="font-size:11px;color:var(--gray-500);">总体满意度</div></div>
                    </div>
                </div>
            `;
        }

        if (!records.length) {
            html += '<div class="empty-state"><p>暂无满意度记录</p><div class="empty-state-hint">可在交付、试运行和验收阶段记录客户反馈，形成长期满意度画像。</div></div>';
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
    } catch (e) {
        container.innerHTML = '<div class="empty-state"><p>满意度数据加载失败</p><div class="empty-state-hint">请稍后重试。</div></div>';
        console.error('loadSatisfaction failed:', e);
    }
}

async function loadDevices(pid) {
    const devices = await api.get(`/projects/${pid}/devices`);
    const container = document.getElementById('devicesContainer');
    if (!container) return;
    if (!devices || !devices.length) {
        container.innerHTML = '<div class="empty-state"><p>暂无设备数据</p><div class="empty-state-hint">录入设备后可持续跟踪连接状态、协议类型和现场运行情况。</div></div>';
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
    const container = document.getElementById('dependenciesContainer');
    if (!container) return;
    container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>正在加载依赖关系...</p></div>';
    try {
        const deps = await api.get(`/projects/${pid}/dependencies`);
        container.innerHTML = renderDependencies(deps, pid);
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><p>依赖关系加载失败</p><div class="empty-state-hint">${e.message}</div></div>`;
    }
}

async function showCriticalPath(projectId = currentProjectId) {
    if (!projectId) {
        showToast('请先选择一个项目', 'warning');
        return;
    }

    const panel = document.getElementById('criticalPathPanel');
    if (panel) {
        panel.style.display = 'block';
        panel.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>正在计算关键路径...</p></div>';
    }

    try {
        const result = await api.get(`/projects/${projectId}/critical-path`);
        const criticalPath = result.critical_path || [];
        const summary = result.summary || '暂无关键路径数据';
        const allTasks = result.all_tasks || [];

        const html = `
            <div class="panel" style="margin-top:16px;">
                <div class="panel-header">
                    <div class="panel-title">🎯 关键路径分析</div>
                </div>
                <div class="panel-body">
                    <div style="margin-bottom:12px;padding:12px;border-radius:10px;background:#f8fafc;color:#475569;font-size:13px;">${summary}</div>
                    ${criticalPath.length ? `
                        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
                            ${criticalPath.map((task, index) => `
                                <span style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;background:${task.completed ? '#ecfdf5' : '#eff6ff'};color:${task.completed ? '#059669' : '#2563eb'};font-size:12px;font-weight:600;">
                                    ${index + 1}. ${task.task_name}
                                </span>
                            `).join('')}
                        </div>
                    ` : '<div class="empty-state"><p>暂无关键路径任务</p></div>'}
                    ${allTasks.length ? `
                        <div class="table-container">
                            <table class="table">
                                <thead><tr><th>任务</th><th>阶段</th><th>状态</th><th>关键</th></tr></thead>
                                <tbody>
                                    ${allTasks.map(task => `
                                        <tr>
                                            <td>${task.task_name || '-'}</td>
                                            <td>${task.stage_name || '-'}</td>
                                            <td>${task.completed ? '已完成' : '进行中'}</td>
                                            <td>${task.is_critical ? '是' : '否'}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;

        if (panel) {
            panel.innerHTML = html;
        } else {
            showGenericModal('🎯 关键路径分析', html);
        }
    } catch (e) {
        const message = `关键路径加载失败: ${e.message}`;
        if (panel) {
            panel.innerHTML = `<div style="color:var(--danger);padding:16px;text-align:center;">${message}</div>`;
        } else {
            showToast(message, 'danger');
        }
    }
}

async function showProjectSnapshot(projectId = currentProjectId) {
    if (!projectId) {
        showToast('请先选择一个项目', 'warning');
        return;
    }

    try {
        const content = await api.get(`/collab/snapshot/${projectId}`);
        window.latestProjectSnapshotContent = String(content || '');
        const html = `
            <div style="padding:20px;">
                <div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
                    <button class="btn btn-outline btn-sm" onclick="copyProjectSnapshotContent()">📋 复制快照</button>
                </div>
                <div class="markdown-content">${renderAiMarkdown(content || '暂无项目快照')}</div>
            </div>
        `;
        showGenericModal('👤 新人快照', html);
    } catch (e) {
        showToast('加载新人快照失败: ' + e.message, 'danger');
    }
}

async function copyProjectSnapshotContent() {
    if (!window.latestProjectSnapshotContent) {
        showToast('暂无可复制的项目快照', 'warning');
        return;
    }
    try {
        await writeTextToClipboard(window.latestProjectSnapshotContent);
        showToast('项目快照已复制', 'success');
    } catch (e) {
        showToast('复制失败: ' + e.message, 'danger');
    }
}

async function loadWorklogStats() {
    if (!currentProjectId) {
        showToast('请先选择一个项目', 'warning');
        return;
    }

    try {
        const stats = await api.get(`/projects/${currentProjectId}/worklogs/stats`);
        document.getElementById('statsTotalHours').textContent = `${stats.total_hours || 0}h`;
        const memberCount = (stats.by_member || []).length || 0;
        const avgHours = memberCount ? ((stats.total_hours || 0) / memberCount).toFixed(1) : '0.0';
        document.getElementById('statsAvgHours').textContent = `${avgHours}h`;

        openModal('worklogStatsModal');

        const memberChartEl = document.getElementById('worklogMemberChart');
        const trendChartEl = document.getElementById('worklogTrendChart');
        if (memberChartEl) {
            const chart = echarts.getInstanceByDom(memberChartEl) || echarts.init(memberChartEl);
            chart.setOption({
                tooltip: { trigger: 'axis' },
                grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
                xAxis: { type: 'category', data: (stats.by_member || []).map(item => item.member_name || '未命名') },
                yAxis: { type: 'value', name: '工时' },
                series: [{
                    type: 'bar',
                    data: (stats.by_member || []).map(item => Number(item.hours || 0)),
                    itemStyle: { color: '#4f46e5', borderRadius: [6, 6, 0, 0] }
                }]
            });
        }
        if (trendChartEl) {
            const chart = echarts.getInstanceByDom(trendChartEl) || echarts.init(trendChartEl);
            chart.setOption({
                tooltip: { trigger: 'axis' },
                grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
                xAxis: { type: 'category', data: (stats.by_month || []).map(item => item.month || '-') },
                yAxis: { type: 'value', name: '工时' },
                series: [{
                    type: 'line',
                    smooth: true,
                    data: (stats.by_month || []).map(item => Number(item.hours || 0)),
                    lineStyle: { color: '#10b981', width: 3 },
                    areaStyle: { color: 'rgba(16, 185, 129, 0.12)' },
                    itemStyle: { color: '#10b981' }
                }]
            });
        }
    } catch (e) {
        showToast('加载日志统计失败: ' + e.message, 'danger');
    }
}

async function loadExpenseStats() {
    if (!currentProjectId) {
        showToast('请先选择一个项目', 'warning');
        return;
    }

    try {
        const stats = await api.get(`/projects/${currentProjectId}/expenses/stats`);
        document.getElementById('statsTotalExpense').textContent = `¥${Number(stats.total || 0).toFixed(2)}`;
        const pending = (stats.by_status || []).find(item => item.status === '待报销');
        document.getElementById('statsPendingExpense').textContent = `¥${Number(pending?.amount || 0).toFixed(2)}`;

        openModal('expenseStatsModal');

        const typeChartEl = document.getElementById('expenseTypeChart');
        const trendChartEl = document.getElementById('expenseTrendChart');
        if (typeChartEl) {
            const chart = echarts.getInstanceByDom(typeChartEl) || echarts.init(typeChartEl);
            chart.setOption({
                tooltip: { trigger: 'item' },
                legend: { bottom: 0 },
                series: [{
                    type: 'pie',
                    radius: ['42%', '68%'],
                    data: (stats.by_type || []).map(item => ({
                        name: item.expense_type || '未分类',
                        value: Number(item.amount || 0)
                    }))
                }]
            });
        }
        if (trendChartEl) {
            const chart = echarts.getInstanceByDom(trendChartEl) || echarts.init(trendChartEl);
            chart.setOption({
                tooltip: { trigger: 'axis' },
                grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
                xAxis: { type: 'category', data: (stats.by_month || []).map(item => item.month || '-') },
                yAxis: { type: 'value', name: '金额' },
                series: [{
                    type: 'bar',
                    data: (stats.by_month || []).map(item => Number(item.amount || 0)),
                    itemStyle: { color: '#f59e0b', borderRadius: [6, 6, 0, 0] }
                }]
            });
        }
    } catch (e) {
        showToast('加载费用统计失败: ' + e.message, 'danger');
    }
}

async function loadDeviationAnalysis(projectId = currentProjectId) {
    if (!projectId) {
        showToast('请先选择一个项目', 'warning');
        return;
    }

    const container = document.getElementById('deviationContainer');
    if (container) {
        container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>正在分析项目偏差...</p></div>';
    }

    try {
        const result = await api.get(`/projects/${projectId}/deviation`);
        if (!container) return;

        if (!result.has_data) {
            container.innerHTML = `<div class="empty-state"><p>${result.message || '暂无偏差分析数据'}</p></div>`;
            return;
        }

        const stageRows = (result.stage_deviations || []).map(item => `
            <tr>
                <td>${item.trend || ''} ${item.stage_name}</td>
                <td>${item.previous_progress}%</td>
                <td>${item.current_progress}%</td>
                <td style="color:${item.delta > 0 ? '#059669' : item.delta < 0 ? '#dc2626' : '#64748b'};">${item.delta > 0 ? '+' : ''}${item.delta}%</td>
            </tr>
        `).join('');
        const weeklyRows = (result.weekly_deltas || []).slice(-6).map(item => `
            <tr>
                <td>${item.from_date} → ${item.to_date}</td>
                <td>${item.progress_from}%</td>
                <td>${item.progress_to}%</td>
                <td>${item.delta > 0 ? '+' : ''}${item.delta}%</td>
                <td>${item.daily_rate}</td>
            </tr>
        `).join('');

        container.innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px;">
                <div class="overview-card"><div class="overview-card-label">当前进度</div><div class="overview-card-value">${result.current_progress || 0}%</div></div>
                <div class="overview-card"><div class="overview-card-label">平均日增速</div><div class="overview-card-value">${result.avg_daily_rate || 0}%</div></div>
                <div class="overview-card"><div class="overview-card-label">停滞阶段</div><div class="overview-card-value">${(result.stagnant_stages || []).length}</div></div>
            </div>
            <div style="margin-bottom:12px;padding:12px;border-radius:10px;background:#f8fafc;color:#475569;font-size:13px;">${result.prediction || '暂无预测'}</div>
            <div class="table-container" style="margin-bottom:16px;">
                <table class="table">
                    <thead><tr><th>阶段</th><th>上次</th><th>当前</th><th>变化</th></tr></thead>
                    <tbody>${stageRows || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;">暂无阶段偏差</td></tr>'}</tbody>
                </table>
            </div>
            <div class="table-container">
                <table class="table">
                    <thead><tr><th>时间段</th><th>起始</th><th>结束</th><th>变化</th><th>日均</th></tr></thead>
                    <tbody>${weeklyRows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;">暂无快照趋势</td></tr>'}</tbody>
                </table>
            </div>
        `;
    } catch (e) {
        if (container) {
            container.innerHTML = `<div style="color:var(--danger);padding:16px;text-align:center;">偏差分析加载失败: ${e.message}</div>`;
        } else {
            showToast('偏差分析加载失败: ' + e.message, 'danger');
        }
    }
}

async function captureSnapshot(projectId = currentProjectId) {
    if (!projectId) {
        showToast('请先选择一个项目', 'warning');
        return;
    }

    try {
        await api.post(`/projects/${projectId}/snapshots`, {});
        showToast('项目快照已拍摄', 'success');
        await loadDeviationAnalysis(projectId);
    } catch (e) {
        showToast('拍摄快照失败: ' + e.message, 'danger');
    }
}

async function generateDeviationReport(projectId = currentProjectId) {
    if (!projectId) {
        showToast('请先选择一个项目', 'warning');
        return;
    }

    const panel = document.getElementById('deviationAiReport');
    if (panel) {
        panel.style.display = 'block';
        panel.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>AI 正在生成偏差诊断...</p></div>';
    }

    try {
        const result = await api.post(`/projects/${projectId}/deviation/ai-report`, {});
        const content = result.ai_report || result.report || result.message || '暂无 AI 偏差分析报告';
        const html = `<div class="panel"><div class="panel-header"><div class="panel-title">🤖 AI 偏差诊断</div></div><div class="panel-body markdown-content">${renderAiMarkdown(content)}</div></div>`;
        if (panel) {
            panel.innerHTML = html;
        } else {
            showGenericModal('🤖 AI 偏差诊断', html);
        }
    } catch (e) {
        const message = `AI 偏差诊断失败: ${e.message}`;
        if (panel) {
            panel.innerHTML = `<div style="color:var(--danger);padding:16px;text-align:center;">${message}</div>`;
        } else {
            showToast(message, 'danger');
        }
    }
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
    const sidebar = document.getElementById('interfaceFlowSidebar');
    if (!chartDom || !sidebar || !currentProject) return;

    const interfaces = Array.isArray(currentProject.interfaces) ? currentProject.interfaces : [];
    const hospitalName = currentProject.hospital_name || currentProject.project_name || '当前项目';
    const systems = [...new Set(interfaces.map(item => item.system_name).filter(Boolean))];
    const completedCount = interfaces.filter(item => item.status === '已完成').length;
    const inProgressCount = interfaces.filter(item => item.status === '开发中' || item.status === '联调中').length;

    sidebar.innerHTML = `
        <div style="padding:16px;border-radius:16px;background:linear-gradient(135deg,#eff6ff,#ffffff);border:1px solid #dbeafe;">
            <div style="font-size:12px;color:#64748b;">接口总数</div>
            <div style="margin-top:6px;font-size:30px;font-weight:800;color:#1d4ed8;">${interfaces.length}</div>
        </div>
        <div style="padding:16px;border-radius:16px;background:linear-gradient(135deg,#ecfdf5,#ffffff);border:1px solid #d1fae5;">
            <div style="font-size:12px;color:#64748b;">已完成接口</div>
            <div style="margin-top:6px;font-size:30px;font-weight:800;color:#15803d;">${completedCount}</div>
        </div>
        <div style="padding:16px;border-radius:16px;background:linear-gradient(135deg,#fff7ed,#ffffff);border:1px solid #fed7aa;">
            <div style="font-size:12px;color:#64748b;">联调中 / 开发中</div>
            <div style="margin-top:6px;font-size:30px;font-weight:800;color:#ea580c;">${inProgressCount}</div>
        </div>
        <div style="padding:16px;border-radius:16px;background:#ffffff;border:1px solid #e2e8f0;">
            <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:10px;">这页现在能做什么</div>
            <div style="display:grid;gap:8px;font-size:12px;color:#64748b;line-height:1.7;">
                <div>1. 看医院到各系统、各接口的连接关系</div>
                <div>2. 快速识别是否还没录接口，避免联调前信息缺口</div>
                <div>3. 给交付、汇报、交接场景提供一张可讲清楚的图</div>
            </div>
        </div>
        <div style="padding:16px;border-radius:16px;background:#ffffff;border:1px solid #e2e8f0;">
            <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:10px;">涉及系统</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                ${systems.length ? systems.map(system => `<span style="padding:6px 10px;border-radius:999px;background:#f8fafc;border:1px solid #e2e8f0;font-size:12px;color:#475569;">${system}</span>`).join('') : '<span style="font-size:12px;color:#94a3b8;">暂无系统数据</span>'}
            </div>
        </div>
    `;

    if (!interfaces.length) {
        try {
            const prev = echarts.getInstanceByDom(chartDom);
            if (prev) echarts.dispose(chartDom);
        } catch (e) {}
        chartDom.innerHTML = `
            <div style="min-height:540px;display:flex;align-items:center;justify-content:center;padding:32px;">
                <div style="max-width:520px;text-align:center;">
                    <div style="width:88px;height:88px;border-radius:28px;margin:0 auto 18px auto;background:linear-gradient(135deg,#dbeafe,#eff6ff);display:flex;align-items:center;justify-content:center;font-size:40px;">🕸️</div>
                    <div style="font-size:24px;font-weight:800;color:#0f172a;margin-bottom:10px;">这页需要接口数据才能真正用起来</div>
                    <div style="font-size:14px;color:#64748b;line-height:1.9;margin-bottom:18px;">
                        现在还没有接口清单，所以拓扑图无法生成。建议先到“接口状态”录入接口，或者去“智能对照”上传文档做自动梳理。
                    </div>
                    <div style="display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                        <button class="btn btn-primary" onclick="batchAddRecommendedInterfaces()" style="background:linear-gradient(135deg,#2563eb,#1d4ed8);border:none;">先导入推荐接口</button>
                        <button class="btn btn-outline" onclick="switchTab(document.querySelector('#projectDetailView .tabs .tab[onclick*=&quot;\\'interfaces\\'&quot;]'), 'interfaces')">去接口状态页</button>
                        <button class="btn btn-outline" onclick="switchTab(document.querySelector('#projectDetailView .tabs .tab[onclick*=&quot;\\'interfaceSpec\\'&quot;]'), 'interfaceSpec'); if (window.InterfaceSpec) InterfaceSpec.renderTab(currentProjectId);">去智能对照</button>
                    </div>
                </div>
            </div>
        `;
        return;
    }

    chartDom.innerHTML = '';
    let myChart = echarts.getInstanceByDom(chartDom);
    if (myChart) echarts.dispose(chartDom);
    myChart = echarts.init(chartDom);

    const nodes = [{
        name: hospitalName,
        category: 0,
        draggable: true,
        symbolSize: 72,
        itemStyle: { color: '#1d4ed8' }
    }];
    const links = [];

    systems.forEach(systemName => {
        nodes.push({
            name: systemName,
            category: 1,
            draggable: true,
            symbolSize: 56,
            itemStyle: { color: '#0ea5e9' }
        });
        links.push({ source: hospitalName, target: systemName });
    });

    interfaces.forEach(item => {
        const interfaceName = item.interface_name || '未命名接口';
        nodes.push({
            name: `${interfaceName}#${item.id}`,
            value: interfaceName,
            category: 2,
            draggable: true,
            symbolSize: 42,
            itemStyle: { color: item.status === '已完成' ? '#10b981' : item.status === '联调中' ? '#f59e0b' : '#94a3b8' }
        });
        links.push({ source: item.system_name, target: `${interfaceName}#${item.id}` });
    });

    myChart.setOption({
        tooltip: {
            formatter(params) {
                if (params.dataType === 'node') {
                    return params.data.value || params.data.name;
                }
                return `${params.data.source} → ${params.data.target}`;
            }
        },
        legend: [{ bottom: 0, data: ['医院/项目', '系统', '接口'] }],
        series: [{
            type: 'graph',
            layout: 'force',
            data: nodes,
            links,
            roam: true,
            draggable: true,
            categories: [{ name: '医院/项目' }, { name: '系统' }, { name: '接口' }],
            force: { repulsion: 260, edgeLength: 120, gravity: 0.08 },
            label: {
                show: true,
                formatter(node) {
                    return node.data.value || node.data.name;
                },
                color: '#334155',
                fontSize: 12
            },
            lineStyle: {
                color: '#94a3b8',
                width: 1.4,
                curveness: 0.18,
                opacity: 0.85
            }
        }]
    });

    if (!window.__interfaceFlowResizeBound) {
        window.addEventListener('resize', () => {
            const chart = echarts.getInstanceByDom(document.getElementById('interfaceFlowChart'));
            if (chart) chart.resize();
        });
        window.__interfaceFlowResizeBound = true;
    }
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

function showMultiLogImportModal() {
    const source = document.getElementById('multiLogSource');
    const preview = document.getElementById('multiLogPreview');
    const items = document.getElementById('multiLogItems');
    const status = document.getElementById('multiLogStatus');
    if (source) source.value = '';
    if (preview) preview.style.display = 'none';
    if (items) items.innerHTML = '';
    if (status) {
        status.style.display = 'none';
        status.textContent = '';
    }
    window.latestParsedMultiLogs = [];
    openModal('multiLogImportModal');
}

function escapeMultiLogValue(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeParsedMultiLogItem(item, index) {
    const today = new Date().toISOString().slice(0, 10);
    const parsedHours = Number(item?.work_hours ?? item?.hours ?? 8);
    return {
        member_name: String(item?.member_name || currentUser?.display_name || currentUser?.username || `成员${index + 1}`).trim(),
        log_date: String(item?.log_date || item?.date || today).slice(0, 10),
        work_content: String(item?.work_content || item?.content || item?.summary || '').trim(),
        issues_encountered: String(item?.issues_encountered || item?.issues || '').trim(),
        tomorrow_plan: String(item?.tomorrow_plan || item?.plan || item?.next_plan || '').trim(),
        work_hours: Number.isFinite(parsedHours) && parsedHours > 0 ? parsedHours : 8,
        work_type: String(item?.work_type || '现场').trim() || '现场'
    };
}

function renderParsedMultiLogs(logs) {
    const items = document.getElementById('multiLogItems');
    const status = document.getElementById('multiLogStatus');
    const importBtn = document.getElementById('importParsedLogsBtn');
    if (!items) return;

    if (!Array.isArray(logs) || !logs.length) {
        items.innerHTML = '<div class="empty-state"><p>未识别到可导入的日志条目</p></div>';
        if (status) {
            status.style.display = 'block';
            status.style.color = 'var(--gray-500)';
            status.textContent = 'AI 未识别出结构化日志，请调整原文后重试。';
        }
        if (importBtn) importBtn.disabled = true;
        return;
    }

    if (status) {
        status.style.display = 'block';
        status.style.color = '#475569';
        status.textContent = `共识别 ${logs.length} 条日志，可在导入前逐条调整。`;
    }
    if (importBtn) importBtn.disabled = false;

    items.innerHTML = logs.map((log, index) => `
        <div class="multi-log-import-card" data-index="${index}" style="border:1px solid #dbeafe;border-radius:14px;background:#f8fbff;padding:14px 14px 12px 14px;">
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px;flex-wrap:wrap;">
                <label style="display:flex;align-items:center;gap:8px;font-weight:700;color:#0f172a;cursor:pointer;">
                    <input type="checkbox" class="multi-log-select" checked>
                    <span>日志 ${index + 1}</span>
                </label>
                <div style="font-size:12px;color:#64748b;">导入后会写入当前项目工作日志</div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:10px;">
                <div>
                    <label style="display:block;font-size:12px;color:#64748b;margin-bottom:4px;">成员</label>
                    <input type="text" class="multi-log-member" value="${escapeMultiLogValue(log.member_name)}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:10px;">
                </div>
                <div>
                    <label style="display:block;font-size:12px;color:#64748b;margin-bottom:4px;">日期</label>
                    <input type="date" class="multi-log-date" value="${escapeMultiLogValue(log.log_date)}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:10px;">
                </div>
                <div>
                    <label style="display:block;font-size:12px;color:#64748b;margin-bottom:4px;">工时</label>
                    <input type="number" min="0.5" step="0.5" class="multi-log-hours" value="${escapeMultiLogValue(log.work_hours)}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:10px;">
                </div>
                <div>
                    <label style="display:block;font-size:12px;color:#64748b;margin-bottom:4px;">类型</label>
                    <select class="multi-log-type" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:10px;background:white;">
                        ${['现场', '远程', '培训', '沟通', '测试', '文档', '其他'].map(type => `<option value="${type}" ${type === log.work_type ? 'selected' : ''}>${type}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div style="margin-bottom:10px;">
                <label style="display:block;font-size:12px;color:#64748b;margin-bottom:4px;">工作内容</label>
                <textarea class="multi-log-content" rows="3" style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;resize:vertical;">${escapeMultiLogValue(log.work_content)}</textarea>
            </div>
            <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
                <div>
                    <label style="display:block;font-size:12px;color:#64748b;margin-bottom:4px;">问题</label>
                    <textarea class="multi-log-issues" rows="2" style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;resize:vertical;">${escapeMultiLogValue(log.issues_encountered)}</textarea>
                </div>
                <div>
                    <label style="display:block;font-size:12px;color:#64748b;margin-bottom:4px;">明日计划</label>
                    <textarea class="multi-log-plan" rows="2" style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;resize:vertical;">${escapeMultiLogValue(log.tomorrow_plan)}</textarea>
                </div>
            </div>
        </div>
    `).join('');
}

async function parseMultiLogs() {
    const source = document.getElementById('multiLogSource')?.value?.trim() || '';
    const preview = document.getElementById('multiLogPreview');
    const items = document.getElementById('multiLogItems');
    const status = document.getElementById('multiLogStatus');
    const importBtn = document.getElementById('importParsedLogsBtn');
    if (!source) {
        showToast('请先粘贴待拆解内容', 'warning');
        return;
    }
    if (!preview || !items) return;
    preview.style.display = 'block';
    items.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>AI 正在拆解日志...</p></div>';
    if (status) {
        status.style.display = 'none';
        status.textContent = '';
    }
    if (importBtn) importBtn.disabled = true;

    try {
        const response = await api.post('/collab/parse-multi-logs', { raw_text: source });
        const parsedLogs = Array.isArray(response)
            ? response.map((item, index) => normalizeParsedMultiLogItem(item, index))
            : [];
        window.latestParsedMultiLogs = parsedLogs;
        if (parsedLogs.length) {
            renderParsedMultiLogs(parsedLogs);
        } else {
            if (importBtn) importBtn.disabled = true;
            items.innerHTML = `<div class="markdown-content" style="padding:12px;border:1px dashed #cbd5e1;border-radius:12px;background:#fff;">${renderAiMarkdown(typeof response === 'string' ? response : JSON.stringify(response, null, 2))}</div>`;
            if (status) {
                status.style.display = 'block';
                status.style.color = '#d97706';
                status.textContent = 'AI 已返回结果，但未能识别为可导入的结构化日志，请手动检查。';
            }
        }
    } catch (e) {
        window.latestParsedMultiLogs = [];
        items.innerHTML = `<div style="color:var(--danger);">拆解失败: ${escapeMultiLogValue(e.message)}</div>`;
        if (status) {
            status.style.display = 'block';
            status.style.color = 'var(--danger)';
            status.textContent = '拆解失败，请检查输入内容或稍后重试。';
        }
    }
}

function toggleAllParsedMultiLogs(checked) {
    document.querySelectorAll('#multiLogItems .multi-log-select').forEach(input => {
        input.checked = !!checked;
    });
}

async function importParsedMultiLogs() {
    if (!currentProjectId) {
        showToast('请先选择一个项目', 'warning');
        return;
    }

    const cards = Array.from(document.querySelectorAll('#multiLogItems .multi-log-import-card'));
    const selectedCards = cards.filter(card => card.querySelector('.multi-log-select')?.checked);
    const status = document.getElementById('multiLogStatus');
    const importBtn = document.getElementById('importParsedLogsBtn');

    if (!selectedCards.length) {
        showToast('请至少选择一条日志', 'warning');
        return;
    }

    const payloads = selectedCards.map(card => {
        const read = selector => card.querySelector(selector)?.value?.trim() || '';
        const hoursValue = Number(read('.multi-log-hours'));
        return {
            member_name: read('.multi-log-member') || currentUser?.display_name || currentUser?.username || '未知',
            log_date: read('.multi-log-date') || new Date().toISOString().slice(0, 10),
            work_hours: Number.isFinite(hoursValue) && hoursValue > 0 ? hoursValue : 8,
            work_type: read('.multi-log-type') || '现场',
            work_content: read('.multi-log-content'),
            issues_encountered: read('.multi-log-issues'),
            tomorrow_plan: read('.multi-log-plan')
        };
    }).filter(item => item.work_content);

    if (!payloads.length) {
        showToast('选中的日志缺少工作内容，无法导入', 'warning');
        return;
    }

    if (importBtn) {
        importBtn.disabled = true;
        importBtn.textContent = '导入中...';
    }
    if (status) {
        status.style.display = 'block';
        status.style.color = '#475569';
        status.textContent = `正在导入 ${payloads.length} 条日志...`;
    }

    let successCount = 0;
    const failures = [];
    for (const payload of payloads) {
        try {
            await api.post(`/projects/${currentProjectId}/worklogs`, payload, { silent: true });
            successCount += 1;
        } catch (e) {
            failures.push(`${payload.member_name} ${payload.log_date}: ${e.message}`);
        }
    }

    if (importBtn) {
        importBtn.disabled = false;
        importBtn.textContent = '导入选中日志';
    }

    if (successCount > 0 && typeof loadWorklogs === 'function') {
        await loadWorklogs(currentProjectId);
    }

    if (!failures.length) {
        if (status) {
            status.style.display = 'block';
            status.style.color = '#0f766e';
            status.textContent = `已成功导入 ${successCount} 条日志。`;
        }
        showToast(`已导入 ${successCount} 条日志`, 'success');
        closeModal('multiLogImportModal');
        return;
    }

    if (status) {
        status.style.display = 'block';
        status.style.color = successCount > 0 ? '#d97706' : 'var(--danger)';
        status.textContent = successCount > 0
            ? `成功导入 ${successCount} 条，失败 ${failures.length} 条。请检查后重试。`
            : `导入失败，共 ${failures.length} 条未写入。`;
    }
    showToast(successCount > 0 ? '部分日志导入失败，请查看提示' : '日志导入失败', successCount > 0 ? 'warning' : 'danger');
}
