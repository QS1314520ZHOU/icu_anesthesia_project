(function () {
    window.approvalTrackingStatusFilter = window.approvalTrackingStatusFilter || '';
    window.approvalTrackingSearch = window.approvalTrackingSearch || '';
    window.approvalPendingSearch = window.approvalPendingSearch || '';

    function hydrateApprovalFiltersFromUrl() {
        const params = new URLSearchParams(window.location.search);
        window.approvalPendingSearch = params.get('approval_pending') || window.approvalPendingSearch || '';
        window.approvalTrackingSearch = params.get('approval_tracking') || window.approvalTrackingSearch || '';
        window.approvalTrackingStatusFilter = params.get('approval_status') || window.approvalTrackingStatusFilter || '';
    }

    function syncApprovalFiltersToUrl() {
        const params = new URLSearchParams(window.location.search);
        ['approval_pending', 'approval_tracking', 'approval_status'].forEach(key => params.delete(key));
        if (window.approvalPendingSearch) params.set('approval_pending', window.approvalPendingSearch);
        else params.delete('approval_pending');
        if (window.approvalTrackingSearch) params.set('approval_tracking', window.approvalTrackingSearch);
        else params.delete('approval_tracking');
        if (window.approvalTrackingStatusFilter) params.set('approval_status', window.approvalTrackingStatusFilter);
        else params.delete('approval_status');
        const query = params.toString();
        const nextUrl = `${window.location.pathname}${query ? '?' + query : ''}`;
        window.history.replaceState({}, '', nextUrl);
    }

    hydrateApprovalFiltersFromUrl();

    window.loadApprovalList = async function () {
        syncApprovalFiltersToUrl();
        const [pending, tracking] = await Promise.all([
            api.get('/approvals/pending'),
            api.get('/approvals/tracking')
        ]);

        const container = document.getElementById('approvalListContainer');
        const trackingContainer = document.getElementById('approvalTrackingContainer');

        if (container) {
            const pendingChanges = pending.changes || [];
            const pendingDepartures = pending.departures || [];
            const pendingExpenses = pending.expenses || [];
            const pendingKeyword = window.approvalPendingSearch.toLowerCase();
            const matchPending = (item, fields) => {
                if (!pendingKeyword) return true;
                return fields.some(field => String(item[field] || '').toLowerCase().includes(pendingKeyword));
            };
            const filteredChanges = pendingChanges.filter(item => matchPending(item, ['project_name', 'change_title', 'requested_by', 'change_type']));
            const filteredDepartures = pendingDepartures.filter(item => matchPending(item, ['project_name', 'departure_type', 'handover_person', 'reason']));
            const filteredExpenses = pendingExpenses.filter(item => matchPending(item, ['project_name', 'expense_type', 'applicant', 'description']));

            if (!filteredChanges.length && !filteredDepartures.length && !filteredExpenses.length) {
                const noFilter = !window.approvalPendingSearch;
                const summary = window.approvalPendingSearch || '';
                container.innerHTML = noFilter
                    ? '<div class="empty-state"><p>✅ 暂无待审批事项</p></div>'
                    : `<div class="empty-state"><p>🔎 未找到匹配的待审批事项${summary ? `（当前筛选：${summary}）` : ''}</p></div>`;
            } else {
                const pendingSummary = window.approvalPendingSearch || '';
                container.innerHTML = `
                    <div class="table-container">
                        ${pendingSummary ? `<div style="margin-bottom:12px;font-size:12px;color:#64748b;">当前筛选：${pendingSummary}</div>` : ''}
                        <div style="margin-bottom:12px;font-size:12px;color:#64748b;">当前结果：${filteredChanges.length + filteredDepartures.length + filteredExpenses.length} 条</div>
                        <div style="margin-bottom:12px;font-size:13px;color:#64748b;">待审批区用于快速处理变更、离场和费用报销三类申请。</div>
                        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:0 0 16px 0;">
                            <div style="padding:12px;border-radius:10px;background:#f5f3ff;">
                                <div style="font-size:22px;font-weight:800;color:#7c3aed;">${pendingChanges.length}</div>
                                <div style="font-size:12px;color:#64748b;">变更待审批</div>
                            </div>
                            <div style="padding:12px;border-radius:10px;background:#fdf2f8;">
                                <div style="font-size:22px;font-weight:800;color:#db2777;">${pendingDepartures.length}</div>
                                <div style="font-size:12px;color:#64748b;">离场待审批</div>
                            </div>
                            <div style="padding:12px;border-radius:10px;background:#fff7ed;">
                                <div style="font-size:22px;font-weight:800;color:#d97706;">${pendingExpenses.length}</div>
                                <div style="font-size:12px;color:#64748b;">费用待审批</div>
                            </div>
                        </div>
                        <div style="display:flex;justify-content:flex-end;gap:8px;padding:0 0 12px 0;flex-wrap:wrap;">
                            <input type="text" value="${window.approvalPendingSearch}" placeholder="搜索项目 / 标题 / 申请人"
                                oninput="searchApprovalPending(this.value)"
                                style="width:320px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;">
                            <button class="btn btn-outline btn-sm" onclick="resetApprovalPendingFilters()">清空筛选</button>
                        </div>
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>类型</th>
                                    <th>项目/医院</th>
                                    <th>内容/标题</th>
                                    <th>申请人</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${filteredChanges.map(c => `
                                    <tr style="cursor:pointer;" onclick="loadProjectDetail(${c.project_id})">
                                        <td><span class="badge badge-purple">变更申请</span></td>
                                        <td>
                                            <div style="font-weight:600;">${c.project_name}</div>
                                            <div style="font-size:11px;color:var(--gray-500);">${c.hospital_name}</div>
                                        </td>
                                        <td>
                                            <div style="font-weight:500;">${c.change_title}</div>
                                            <div style="font-size:12px;color:var(--gray-600);">${c.change_type}</div>
                                        </td>
                                        <td>${c.requested_by || '-'}</td>
                                        <td>
                                            <div class="btn-group">
                                                <button class="btn btn-success btn-sm" onclick="event.stopPropagation(); handleApproval('change', ${c.id}, '已批准')">批准</button>
                                                <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); handleApproval('change', ${c.id}, '已驳回')">驳回</button>
                                            </div>
                                        </td>
                                    </tr>
                                `).join('')}
                                ${filteredDepartures.map(d => `
                                    <tr style="cursor:pointer;" onclick="loadProjectDetail(${d.project_id})">
                                        <td><span class="badge badge-pink">离场申请</span></td>
                                        <td>
                                            <div style="font-weight:600;">${d.project_name}</div>
                                            <div style="font-size:11px;color:var(--gray-500);">${d.hospital_name}</div>
                                        </td>
                                        <td>
                                            <div style="font-weight:500;">${d.departure_type || '离场申请'}</div>
                                            <div style="font-size:12px;color:var(--gray-600);">${d.reason || ''}</div>
                                        </td>
                                        <td>${d.handover_person || '-'}</td>
                                        <td>
                                            <div class="btn-group">
                                                <button class="btn btn-success btn-sm" onclick="event.stopPropagation(); handleApproval('departure', ${d.id}, '已批准')">批准</button>
                                                <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); handleApproval('departure', ${d.id}, '已驳回')">驳回</button>
                                            </div>
                                        </td>
                                    </tr>
                                `).join('')}
                                ${filteredExpenses.map(e => `
                                    <tr style="cursor:pointer;" onclick="loadProjectDetail(${e.project_id})">
                                        <td><span class="badge badge-warning">费用报销</span></td>
                                        <td>
                                            <div style="font-weight:600;">${e.project_name}</div>
                                            <div style="font-size:11px;color:var(--gray-500);">${e.hospital_name}</div>
                                        </td>
                                        <td>
                                            <div style="font-weight:500;">${e.expense_type || '报销'}</div>
                                            <div style="font-size:12px;color:var(--gray-600);">${e.description || ''}</div>
                                        </td>
                                        <td>${e.applicant || '-'}</td>
                                        <td>
                                            <div class="btn-group">
                                                <button class="btn btn-success btn-sm" onclick="event.stopPropagation(); handleApproval('expense', ${e.id}, '已报销')">批准</button>
                                                <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); handleApproval('expense', ${e.id}, '已驳回')">驳回</button>
                                            </div>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
            }
        }

        let filteredTracking = tracking;
        if (window.approvalTrackingStatusFilter) {
            filteredTracking = filteredTracking.filter(item => item.status === window.approvalTrackingStatusFilter);
        }
        if (window.approvalTrackingSearch) {
            const q = window.approvalTrackingSearch.toLowerCase();
            filteredTracking = filteredTracking.filter(item =>
                String(item.project_name || '').toLowerCase().includes(q) ||
                String(item.title || '').toLowerCase().includes(q) ||
                String(item.approval_sp_no || '').toLowerCase().includes(q) ||
                String(item.applicant || '').toLowerCase().includes(q)
            );
        }

        if (trackingContainer) {
            if (!filteredTracking.length) {
                const noFilter = !window.approvalTrackingStatusFilter && !window.approvalTrackingSearch;
                const summary = [window.approvalTrackingStatusFilter, window.approvalTrackingSearch].filter(Boolean).join(' / ');
                trackingContainer.innerHTML = noFilter
                    ? '<div class="empty-state"><p>暂无审批追踪记录</p></div>'
                    : `<div class="empty-state"><p>🔎 未找到匹配的审批追踪记录${summary ? `（当前筛选：${summary}）` : ''}</p></div>`;
            } else {
                const typeMap = {
                    change: ['变更', 'badge-purple'],
                    expense: ['费用', 'badge-warning'],
                    departure: ['离场', 'badge-pink']
                };
                const trackingSummary = [window.approvalTrackingStatusFilter, window.approvalTrackingSearch].filter(Boolean).join(' / ');
                const summary = {
                    processing: tracking.filter(item => item.status === '审批中').length,
                    approved: tracking.filter(item => item.status === '已批准' || item.status === '已报销').length,
                    rejected: tracking.filter(item => item.status === '已驳回').length,
                    cancelled: tracking.filter(item => item.status === '已撤销').length
                };
                trackingContainer.innerHTML = `
                    <div class="table-container">
                        ${trackingSummary ? `<div style="margin-bottom:12px;font-size:12px;color:#64748b;">当前筛选：${trackingSummary}</div>` : ''}
                        <div style="margin-bottom:12px;font-size:12px;color:#64748b;">当前结果：${filteredTracking.length} 条</div>
                        <div style="margin-bottom:12px;font-size:13px;color:#64748b;">审批追踪区用于按审批单号和状态统一查看企业微信审批流转结果。</div>
                        <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding:0 0 16px 0;">
                            <div style="padding:12px;border-radius:10px;background:#fff7ed;">
                                <div style="font-size:22px;font-weight:800;color:#d97706;">${summary.processing}</div>
                                <div style="font-size:12px;color:#64748b;">审批中</div>
                            </div>
                            <div style="padding:12px;border-radius:10px;background:#ecfdf5;">
                                <div style="font-size:22px;font-weight:800;color:#059669;">${summary.approved}</div>
                                <div style="font-size:12px;color:#64748b;">已通过/已报销</div>
                            </div>
                            <div style="padding:12px;border-radius:10px;background:#fef2f2;">
                                <div style="font-size:22px;font-weight:800;color:#dc2626;">${summary.rejected}</div>
                                <div style="font-size:12px;color:#64748b;">已驳回</div>
                            </div>
                            <div style="padding:12px;border-radius:10px;background:#f8fafc;">
                                <div style="font-size:22px;font-weight:800;color:#475569;">${summary.cancelled}</div>
                                <div style="font-size:12px;color:#64748b;">已撤销</div>
                            </div>
                        </div>
                        <div style="display:flex;justify-content:space-between;gap:8px;padding:0 0 12px 0;flex-wrap:wrap;">
                            <input type="text" value="${window.approvalTrackingSearch}" placeholder="搜索项目名 / 标题 / 审批单号 / 申请人"
                                oninput="searchApprovalTracking(this.value)"
                                style="flex:1;min-width:240px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;">
                            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                                <select onchange="filterApprovalTracking(this.value)" style="width:180px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;">
                                    <option value="">全部状态</option>
                                    <option value="审批中" ${window.approvalTrackingStatusFilter === '审批中' ? 'selected' : ''}>审批中</option>
                                    <option value="已批准" ${window.approvalTrackingStatusFilter === '已批准' ? 'selected' : ''}>已批准</option>
                                    <option value="已报销" ${window.approvalTrackingStatusFilter === '已报销' ? 'selected' : ''}>已报销</option>
                                    <option value="已驳回" ${window.approvalTrackingStatusFilter === '已驳回' ? 'selected' : ''}>已驳回</option>
                                    <option value="已撤销" ${window.approvalTrackingStatusFilter === '已撤销' ? 'selected' : ''}>已撤销</option>
                                </select>
                                <button class="btn btn-outline btn-sm" onclick="resetApprovalTrackingFilters()">清空筛选</button>
                            </div>
                        </div>
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>类型</th>
                                    <th>项目</th>
                                    <th>标题</th>
                                    <th>申请人</th>
                                    <th>审批单号</th>
                                    <th>状态</th>
                                    <th>创建时间</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${filteredTracking.map(item => {
                                    const typeInfo = typeMap[item.biz_type] || ['审批', 'badge-info'];
                                    const statusClass = item.status === '审批中' ? 'badge-warning'
                                        : item.status === '已批准' || item.status === '已报销' ? 'badge-success'
                                        : item.status === '已驳回' || item.status === '已撤销' ? 'badge-danger'
                                        : 'badge-info';
                                    return `
                                        <tr style="cursor:pointer;" onclick="openApprovalTrackingItem(${item.project_id || 'null'}, '${item.biz_type}', ${item.biz_id || 'null'})">
                                            <td><span class="badge ${typeInfo[1]}">${typeInfo[0]}</span></td>
                                            <td>
                                                <div style="font-weight:600;">${item.project_name || '-'}</div>
                                                <div style="font-size:11px;color:var(--gray-500);">${item.hospital_name || ''}</div>
                                            </td>
                                            <td>
                                                <div style="font-weight:500;">${item.title || '-'}</div>
                                                <div style="font-size:12px;color:var(--gray-600);">${item.sub_type || '-'}</div>
                                            </td>
                                            <td>${item.applicant || '-'}</td>
                                            <td style="font-family:monospace;font-size:12px;">
                                                ${item.approval_sp_no || '-'}
                                                ${item.approval_sp_no ? `<button class="btn btn-outline btn-xs" style="margin-left:6px;" onclick="event.stopPropagation(); copyApprovalSpNo('${item.approval_sp_no}')">复制</button>` : ''}
                                            </td>
                                            <td><span class="badge ${statusClass}">${item.status || '-'}</span></td>
                                            <td>${item.created_at || '-'}</td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
            }
        }
    };

    window.filterApprovalTracking = function (status) {
        window.approvalTrackingStatusFilter = status || '';
        syncApprovalFiltersToUrl();
        window.loadApprovalList();
    };

    window.searchApprovalPending = function (keyword) {
        window.approvalPendingSearch = keyword || '';
        syncApprovalFiltersToUrl();
        window.loadApprovalList();
    };

    window.resetApprovalPendingFilters = function () {
        window.approvalPendingSearch = '';
        syncApprovalFiltersToUrl();
        window.loadApprovalList();
    };

    window.searchApprovalTracking = function (keyword) {
        window.approvalTrackingSearch = keyword || '';
        syncApprovalFiltersToUrl();
        window.loadApprovalList();
    };

    window.resetApprovalTrackingFilters = function () {
        window.approvalTrackingStatusFilter = '';
        window.approvalTrackingSearch = '';
        syncApprovalFiltersToUrl();
        window.loadApprovalList();
    };

    window.copyApprovalSpNo = async function (spNo) {
        try {
            await navigator.clipboard.writeText(spNo);
            showToast('审批单号已复制');
        } catch (e) {
            showToast('复制失败: ' + e.message, 'danger');
        }
    };

    window.openApprovalTrackingItem = function (projectId) {
        if (projectId) return loadProjectDetail(projectId);
        showApprovalCenter();
    };

    window.showApprovalCenter = async function () {
        currentProjectId = null;
        hideAllViews();
        document.getElementById('approvalView').style.display = 'block';
        await window.loadApprovalList();
    };
})();
