// Project-detail rendering extracted from project_detail_hub.js

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
        return '<div class="empty-state"><p>暂无阶段计划</p><div class="empty-state-hint">可点击右上角“添加阶段”建立项目实施节奏。</div></div>';
    }
    return stages.map(s => `
        ${(() => {
            const progress = Number(s.progress || 0);
            const progressColor = progress >= 100 ? '#10b981' : progress >= 70 ? '#2563eb' : progress >= 30 ? '#f59e0b' : '#94a3b8';
            const statusBg = progress >= 100 ? '#ecfdf5' : progress >= 30 ? '#eff6ff' : '#f8fafc';
            const statusColor = progress >= 100 ? '#059669' : progress >= 30 ? '#2563eb' : '#94a3b8';
            return `
        <div class="stage-item" id="stage-${s.id}">
            <div class="stage-header" onclick="toggleStage(${s.id})">
                <div class="stage-title-wrap">
                    <div class="stage-title">${s.stage_name}</div>
                    <span class="stage-status-badge" style="background:${statusBg};color:${statusColor};padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;">
                        ${progress >= 100 ? '✅ 已完成' : progress >= 30 ? '⏳ 进行中' : '⏸ 待开始'}
                    </span>
                </div>
                <div class="stage-info">
                    <span>${s.plan_start_date || '-'} ~ ${s.plan_end_date || '-'}</span>
                    <span style="color:${progressColor};font-weight:700;">${progress}%</span>
                    <div class="stage-progress-mini" style="background:#eef2f7;">
                        <div class="stage-progress-mini-bar" style="width:${progress}%;background:${progressColor};"></div>
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
    `;})()}
    `).join('');
}

function renderMilestones(milestones) {
    if (!milestones || milestones.length === 0) {
        return '<div class="empty-state"><p>暂无里程碑</p><div class="empty-state-hint">建议为关键交付节点设置里程碑，便于提醒与风险预警。</div></div>';
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
        return '<div class="empty-state"><p>暂无成员</p><div class="empty-state-hint">请先补录项目成员，后续资源、工时和地图视图会联动展示。</div></div>';
    }
    const grouped = getMemberIdentitySummary(members);
    const summary = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:14px;">
            <div class="overview-card" style="background:#ecfdf5;border:1px solid #bbf7d0;box-shadow:none;">
                <div class="overview-card-title" style="color:#15803d;">实施侧评分人</div>
                <div class="overview-card-value" style="color:#166534;">${grouped.implementation.length}</div>
            </div>
            <div class="overview-card" style="background:#eff6ff;border:1px solid #bfdbfe;box-shadow:none;">
                <div class="overview-card-title" style="color:#2563eb;">研发侧对象</div>
                <div class="overview-card-value" style="color:#1d4ed8;">${grouped.rnd.length}</div>
            </div>
            <div class="overview-card" style="background:#fff7ed;border:1px solid #fed7aa;box-shadow:none;">
                <div class="overview-card-title" style="color:#c2410c;">待确认身份</div>
                <div class="overview-card-value" style="color:#9a3412;">${grouped.unknown.length}</div>
            </div>
        </div>
        <div style="margin-bottom:14px;padding:12px 14px;border-radius:12px;background:${grouped.implementation.length && grouped.rnd.length && !grouped.unknown.length ? '#ecfdf5' : '#fff7ed'};border:1px solid ${grouped.implementation.length && grouped.rnd.length && !grouped.unknown.length ? '#bbf7d0' : '#fed7aa'};color:${grouped.implementation.length && grouped.rnd.length && !grouped.unknown.length ? '#166534' : '#9a3412'};font-size:13px;line-height:1.8;">
            ${grouped.implementation.length && grouped.rnd.length && !grouped.unknown.length
                ? '当前项目成员身份已经整理完成，可以开始进入“实施评研发”的项目绩效评价。'
                : '当前项目成员身份还没完全整理好。建议先补齐实施侧评分人和研发侧对象，再进入研发绩效评价。'}
        </div>
    `;
    const renderMemberCard = (m) => `
        <div class="member-item">
            <div>
                <div class="member-name">${m.name}</div>
                <div class="member-meta">${m.role || '-'} | ${m.current_city || '-'} ${m.is_onsite ? '| 驻场' : ''}</div>
                <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">
                    ${renderMemberPerformanceIdentity(m)}
                </div>
            </div>
            <div class="btn-group">
                <button class="btn btn-outline btn-xs" onclick="showEditMemberModal(${m.id})">编辑</button>
                <button class="btn btn-danger btn-xs" onclick="deleteMember(${m.id})">删除</button>
            </div>
        </div>
    `;
    const renderGroup = (title, items, hint, tone = '') => `
        <div style="border:1px solid var(--gray-200);border-radius:14px;overflow:hidden;background:white;">
            <div style="padding:12px 14px;background:var(--gray-50);border-bottom:1px solid var(--gray-200);display:flex;justify-content:space-between;gap:10px;align-items:center;">
                <div>
                    <div style="font-size:14px;font-weight:700;color:var(--gray-800);">${title}</div>
                    <div style="font-size:12px;color:var(--gray-500);margin-top:4px;">${hint}</div>
                </div>
                <span class="badge ${tone || 'badge-gray'}">${items.length}</span>
            </div>
            <div style="padding:12px;display:grid;gap:10px;">
                ${items.length ? items.map(renderMemberCard).join('') : '<div class="empty-state-hint">暂无成员</div>'}
            </div>
        </div>
    `;
    return `
        <div style="display:grid;gap:14px;">
            ${summary}
            ${renderGroup('实施侧评分人', grouped.implementation, '这些人负责对本项目的研发协作表现进行评价。', 'badge-success')}
            ${renderGroup('研发侧被评分对象', grouped.rnd, '这些人会出现在研发绩效评价里作为被评分对象。', 'badge-info')}
            ${renderGroup('待确认身份', grouped.unknown, '建议尽快确认这些成员属于实施侧还是研发侧，避免影响开评。')}
        </div>
    `;
}

function getMemberIdentitySummary(members) {
    const implementation = [];
    const rnd = [];
    const unknown = [];
    (members || []).forEach(member => {
        const role = String(member?.role || '');
        const isRAndD = ['研发', '开发', '后端', '前端', '测试', '产品', '架构', '算法', '平台', '接口研发'].some(keyword => role.includes(keyword));
        const isImplementation = ['现场', '驻场', '实施', '交付', '项目经理', '工程'].some(keyword => role.includes(keyword)) && !isRAndD;
        if (isRAndD) rnd.push(member);
        else if (isImplementation || member?.is_onsite) implementation.push(member);
        else unknown.push(member);
    });
    return { implementation, rnd, unknown };
}

function renderMemberPerformanceIdentity(member) {
    const role = String(member?.role || '');
    const isRAndD = ['研发', '开发', '后端', '前端', '测试', '产品', '架构', '算法', '平台', '接口研发'].some(keyword => role.includes(keyword));
    const isImplementation = ['现场', '驻场', '实施', '交付', '项目经理', '工程'].some(keyword => role.includes(keyword)) && !isRAndD;
    if (isRAndD) {
        return '<span class="badge badge-info">研发侧：被评分对象</span>';
    }
    if (isImplementation || member?.is_onsite) {
        return '<span class="badge badge-success">实施侧：现场评分人</span>';
    }
    return '<span class="badge badge-gray">未归类：请确认实施/研发身份</span>';
}

function renderContacts(contacts) {
    if (!contacts || contacts.length === 0) {
        return '<div class="empty-state"><p>暂无联系人</p><div class="empty-state-hint">补充甲方联系人后，可用于沟通记录、提醒与满意度回访。</div></div>';
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
    if (!interfaces || interfaces.length === 0) return '<div class="empty-state"><p>暂无接口数据</p><div class="empty-state-hint">可手工新增接口，或使用模板/批量导入快速初始化。</div></div>';
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
    if (!issues || issues.length === 0) return '<div class="empty-state"><p>暂无问题记录</p><div class="empty-state-hint">建议及时记录现场问题，便于 AI 分析、催办和知识沉淀。</div></div>';
    const severityMap = { '高': 'badge-danger', '中': 'badge-warning', '低': 'badge-info' };
    const statusMap = { '待处理': 'badge-danger', '处理中': 'badge-warning', '已解决': 'badge-success' };
    return `
        <div class="table-container">
            <table class="table">
                <thead><tr><th>类型</th><th>描述</th><th>责任人</th><th>严重度</th><th>状态</th><th>操作</th></tr></thead>
                <tbody>
                    ${issues.map(i => `
                        <tr>
                            <td>${i.issue_type}${i.issue_type === '需求' ? '<div style="font-size:11px;color:#2563eb;margin-top:4px;">研发需求</div>' : ''}</td>
                            <td style="max-width:320px;overflow:hidden;text-overflow:ellipsis;">
                                ${i.description}
                                ${i.is_external_blocker ? '<div style="font-size:11px;color:#b45309;margin-top:4px;">外部阻塞</div>' : ''}
                                ${i.first_response_at ? `<div style="font-size:11px;color:#059669;margin-top:4px;">已响应：${String(i.first_response_at).replace('T', ' ').slice(0, 16)}</div>` : '<div style="font-size:11px;color:#94a3b8;margin-top:4px;">尚未响应</div>'}
                                ${i.last_wecom_push_summary ? `<div style="font-size:11px;color:#2563eb;margin-top:4px;">企微：${i.last_wecom_push_summary}</div>` : ''}
                            </td>
                            <td>${i.owner_member_id ? (currentProject?.members || []).find(m => Number(m.id) === Number(i.owner_member_id))?.name || '-' : '-'}</td>
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
                                    <button class="btn btn-outline btn-xs" onclick="pushIssueToWecom(${i.id})">企微推送</button>
                                    <button class="btn btn-outline btn-xs" onclick="showIssuePushReceipts(${i.id})">推送回执</button>
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
    if (!departures || departures.length === 0) return '<div class="empty-state"><p>暂无离场记录</p><div class="empty-state-hint">当项目进入暂停、返场或交接阶段时，可在此记录完整离场流程。</div></div>';
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

// Device/dependency/burndown/detail-visual action helpers moved to
// static/js/project_detail_actions_hub.js

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
                            <span class="dot-separator">·</span>
                            <button onclick="showAiRetrospective(${project.id})">📘 AI复盘</button>
                            
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
                    <div class="tab" onclick="switchTab(this, 'communications')">💬 沟通</div>
                    <div class="tab" onclick="switchTab(this, 'departures')">🚪 离场</div>
                    <div class="tab" onclick="switchTab(this, 'worklogs')">📝 日志</div>
                    <div class="tab" onclick="switchTab(this, 'documents')">📄 文档</div>
                    <div class="tab" onclick="switchTab(this, 'expenses')">💰 费用</div>
                    <div class="tab" onclick="switchTab(this, 'changes')">📝 变更</div>
                    <div class="tab" onclick="switchTab(this, 'acceptance')">✅ 验收</div>
                    <div class="tab" onclick="switchTab(this, 'satisfaction')">⭐ 满意度</div>
                    <div class="tab" onclick="switchTab(this, 'dependencies')">🔗 依赖</div>
                    <div class="tab" onclick="switchTab(this, 'standup')">📋 站会</div>
                    <div class="tab" onclick="switchTab(this, 'deviation')">📊 偏差</div>
                    <div class="tab" onclick="switchTab(this, 'interfaceSpec')" style="position:relative;">📑 智能对照 <span style="position:absolute; top:-6px; right:-6px; background:#ef4444; color:white; font-size:10px; padding:1px 4px; border-radius:4px; transform:scale(0.8);">NEW</span></div>
                    <div class="tab" onclick="switchTab(this, 'financials')">💰 财务看板</div>
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
                                <button class="btn btn-outline btn-sm" onclick="normalizeProjectMemberRoles()">🧭 批量规范角色</button>
                                <button class="btn btn-outline btn-sm" onclick="bulkSetUnknownMembersRole('implementation')">批量设为实施侧</button>
                                <button class="btn btn-outline btn-sm" onclick="bulkSetUnknownMembersRole('rnd')">批量设为研发侧</button>
                                <button class="btn btn-outline btn-sm" onclick="openCurrentProjectPerformanceReview()">🏅 进入研发绩效评价</button>
                                <button class="btn btn-primary btn-sm" onclick="showMemberModal()">+ 添加成员</button>
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
                        <div class="panel-header" style="flex-wrap:wrap;gap:8px;">
                            <div class="panel-title">🎨 接口流设计器 (Flow Designer)</div>
                            <div class="btn-group" style="flex-wrap:wrap;">
                                <button class="btn btn-outline btn-sm" onclick="batchAddRecommendedInterfaces()" title="先补齐推荐接口，再生成链路">📋 批量导入接口</button>
                                <button class="btn btn-outline btn-sm" onclick="switchTab(document.querySelector(&quot;#projectDetailView .tabs .tab[onclick*='interfaces']&quot;), 'interfaces')">🧩 去接口状态</button>
                                <button class="btn btn-outline btn-sm" onclick="switchTab(document.querySelector(&quot;#projectDetailView .tabs .tab[onclick*='interfaceSpec']&quot;), 'interfaceSpec'); if (window.InterfaceSpec) InterfaceSpec.renderTab(currentProjectId);">📑 去智能对照</button>
                                <button class="btn btn-outline btn-sm" onclick="renderInterfaceFlow()">🔄 刷新拓扑</button>
                            </div>
                        </div>
                        <div class="panel-body">
                            <div style="margin-bottom:14px;padding:14px 16px;border-radius:14px;background:linear-gradient(135deg,#eff6ff,#f8fafc);border:1px solid #dbeafe;color:#475569;font-size:13px;line-height:1.8;">
                                流设计器用于把“医院 / 系统 / 接口”串成一张拓扑图，适合做实施前梳理、联调准备和项目交接。
                                没有接口数据时会显示引导卡，不再是一块空白区。
                            </div>
                            <div style="display:grid;grid-template-columns:minmax(0,1.2fr) 300px;gap:16px;align-items:start;">
                                <div id="interfaceFlowChart" style="width:100%;min-height:540px;background:#f8fafc;border-radius:16px;border:1px solid #e2e8f0;"></div>
                                <div id="interfaceFlowSidebar" style="display:grid;gap:12px;"></div>
                            </div>
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
                                <button class="btn btn-primary btn-sm" onclick="showIssueModal()">+ 新增</button>
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
                                <button class="btn btn-sm" style="background:linear-gradient(135deg,#4f46e5,#2563eb);color:white;border:none;" onclick="showMeetingAssistant()" title="从会议转写中提取纪要、待办并沉淀到沟通记录">🎙️ 会议助手</button>
                                <button class="btn btn-sm" style="background:linear-gradient(135deg,#8b5cf6,#6366f1);color:white;border:none;" onclick="analyzeCommunications()" title="AI从项目管理/需求分析角度分析所有沟通记录">🤖 AI 智能分析</button>
                                <button class="btn btn-sm" style="background:linear-gradient(135deg,#0ea5e9,#2563eb);color:white;border:none;" onclick="document.getElementById('commFileInput').click()" title="上传文件(Word/PDF/Excel/TXT)进行AI分析">📎 上传文件分析</button>
                                <button class="btn btn-primary btn-sm" onclick="showAddCommunicationModal()">+ 新增记录</button>
                            </div>
                        </div>
                        <div class="panel-body">
                            <div style="margin-bottom:12px;font-size:13px;color:#64748b;">建议在每次客户沟通后及时录入；会议助手也已并入这里，方便从会议纪要直接生成并沉淀沟通记录。</div>
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
                        <div class="panel-body">
                            <div style="margin-bottom:12px;font-size:13px;color:#64748b;">通过依赖关系可识别关键路径和延期蝴蝶效应，建议为关键任务补全前后置关系。</div>
                            <div id="dependenciesContainer"><div class="loading-spinner"><div class="spinner"></div></div></div>
                        </div>
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
                        <div class="panel-body">
                            <div style="margin-bottom:12px;font-size:13px;color:#64748b;">站会助手会聚合当前项目日志、问题和阶段进度，帮助快速形成每日同步材料。</div>
                            <div id="standupContainer"><div class="loading-spinner"><div class="spinner"></div></div></div>
                        </div>
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
                        <div class="panel-body">
                            <div style="margin-bottom:12px;font-size:13px;color:#64748b;">可通过周期快照查看项目偏差趋势，并使用 AI 偏差诊断识别停滞阶段和异常拐点。</div>
                            <div id="deviationContainer"><div class="loading-spinner"><div class="spinner"></div></div></div>
                        </div>
                    </div>
                    <div id="deviationAiReport" style="display:none;margin-top:16px;"></div>
                </div>
            `;

    setTimeout(() => {
        renderGanttLegend('projectGanttLegend');
        renderProjectGantt(project);
    }, 100);

    enableTabDragging();
}
