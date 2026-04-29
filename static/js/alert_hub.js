(function () {
    window.warningSeverityFilter = window.warningSeverityFilter || '';
    window.warningSearch = window.warningSearch || '';
    window.warningCount = window.warningCount || 0;
    window.warningActionState = window.warningActionState || JSON.parse(localStorage.getItem('warning_action_state') || '{}');

    function warningKey(item) {
        return `${item.type}:${item.project_id || 0}:${item.milestone_id || item.interface_id || 0}:${item.message || ''}`;
    }

    function persistWarningState() {
        localStorage.setItem('warning_action_state', JSON.stringify(window.warningActionState || {}));
    }

    function syncWarningFiltersToUrl() {
        const params = new URLSearchParams(window.location.search);
        ['warning_severity', 'warning_search'].forEach(key => params.delete(key));
        if (window.warningSeverityFilter) params.set('warning_severity', window.warningSeverityFilter);
        if (window.warningSearch) params.set('warning_search', window.warningSearch);
        const query = params.toString();
        window.history.replaceState({}, '', `${window.location.pathname}${query ? '?' + query : ''}`);
    }

    function hydrateWarningFiltersFromUrl() {
        const params = new URLSearchParams(window.location.search);
        window.warningSeverityFilter = params.get('warning_severity') || '';
        window.warningSearch = params.get('warning_search') || '';
    }

    window.showWarningCenter = async function () {
        openModal('warningModal');
        await window.loadWarnings();
    };

    window.loadWarnings = async function () {
        const container = document.getElementById('warningList');
        if (!container) return;

        hydrateWarningFiltersFromUrl();
        syncWarningFiltersToUrl();
        container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--gray-500);">加载中...</div>';

        try {
            const data = await api.get('/warnings');
            window.renderWarnings(data);
        } catch (e) {
            container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--danger);">加载失败: ${e.message}</div>`;
        }
    };

    window.renderWarnings = function (data) {
        const container = document.getElementById('warningList');
        if (!container) return;

        const { summary, warnings } = data;
        let filtered = (warnings || []).filter(w => {
            const state = window.warningActionState[warningKey(w)];
            return !state || state.status !== 'ignored';
        });
        if (window.warningSeverityFilter) {
            filtered = filtered.filter(w => w.severity === window.warningSeverityFilter);
        }
        if (window.warningSearch) {
            const q = window.warningSearch.toLowerCase();
            filtered = filtered.filter(w =>
                String(w.message || '').toLowerCase().includes(q) ||
                String(w.project_name || '').toLowerCase().includes(q)
            );
        }

        if (filtered.length === 0) {
            const noFilter = !window.warningSeverityFilter && !window.warningSearch;
            container.innerHTML = noFilter
                ? '<div style="text-align:center;padding:40px;color:var(--success);font-size:16px;">✅ 暂无预警，所有项目运行正常</div>'
                : '<div style="text-align:center;padding:40px;color:var(--gray-500);font-size:16px;">🔎 未找到匹配的预警项</div>';
            return;
        }

        let html = `
            <div class="warning-summary" style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
                <div style="flex:1;min-width:80px;padding:12px;background:var(--gray-50);border-radius:8px;text-align:center;">
                    <div style="font-size:24px;font-weight:700;">${summary.total}</div>
                    <div style="font-size:11px;color:var(--gray-500);">总预警</div>
                </div>
                <div style="flex:1;min-width:80px;padding:12px;background:#fef2f2;border-radius:8px;text-align:center;">
                    <div style="font-size:24px;font-weight:700;color:#ef4444;">🔴 ${summary.high}</div>
                    <div style="font-size:11px;color:var(--gray-500);">高危</div>
                </div>
                <div style="flex:1;min-width:80px;padding:12px;background:#fffbeb;border-radius:8px;text-align:center;">
                    <div style="font-size:24px;font-weight:700;color:#f59e0b;">🟡 ${summary.medium}</div>
                    <div style="font-size:11px;color:var(--gray-500);">中危</div>
                </div>
            </div>
            ${[window.warningSeverityFilter, window.warningSearch].filter(Boolean).join(' / ') ? `<div style="margin-bottom:12px;font-size:12px;color:#64748b;">当前筛选：${[window.warningSeverityFilter, window.warningSearch].filter(Boolean).join(' / ')}</div>` : ''}
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;justify-content:flex-end;">
                <select onchange="filterWarnings(this.value)" style="width:180px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;">
                    <option value="">全部等级</option>
                    <option value="high" ${window.warningSeverityFilter === 'high' ? 'selected' : ''}>高危</option>
                    <option value="medium" ${window.warningSeverityFilter === 'medium' ? 'selected' : ''}>中危</option>
                    <option value="low" ${window.warningSeverityFilter === 'low' ? 'selected' : ''}>低危</option>
                </select>
                <button class="btn btn-outline btn-sm" onclick="resetWarningFilters()">清空筛选</button>
            </div>
            <div style="margin-bottom:12px;font-size:12px;color:#64748b;">当前结果：${filtered.length} 条</div>
            <div class="warning-list">
        `;

        for (const w of filtered) {
            const severityColor = w.severity === 'high' ? '#ef4444' : w.severity === 'medium' ? '#f59e0b' : '#10b981';
            const severityIcon = w.severity === 'high' ? '🔴' : w.severity === 'medium' ? '🟡' : '🟢';
            const typeIcon = w.type.includes('milestone') ? '🎯' : w.type.includes('task') ? '📋' : '🔗';
            html += `
                <div class="warning-item" style="padding:12px;margin-bottom:8px;background:white;border-radius:8px;border-left:4px solid ${severityColor};cursor:pointer;" onclick="loadProjectDetail(${w.project_id});closeModal('warningModal');">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                        <span style="font-weight:600;font-size:13px;">${typeIcon} ${w.message}</span>
                        <span style="font-size:12px;">${severityIcon}</span>
                    </div>
                    <div style="font-size:12px;color:var(--gray-500);">${w.project_name}</div>
                    <div style="margin-top:8px;display:flex;gap:8px;" onclick="event.stopPropagation();">
                        <button class="btn btn-outline btn-xs" onclick='acknowledgeWarning(${JSON.stringify(w)})'>确认</button>
                        <button class="btn btn-outline btn-xs" onclick='ignoreWarning(${JSON.stringify(w)})'>忽略</button>
                    </div>
                </div>
            `;
        }

        html += '</div>';
        container.innerHTML = html;
    };

    window.filterWarnings = function (severity) {
        window.warningSeverityFilter = severity || '';
        syncWarningFiltersToUrl();
        window.loadWarnings();
    };

    window.searchWarnings = function (keyword) {
        window.warningSearch = keyword || '';
        syncWarningFiltersToUrl();
        window.loadWarnings();
    };

    window.resetWarningFilters = function () {
        window.warningSeverityFilter = '';
        window.warningSearch = '';
        syncWarningFiltersToUrl();
        window.loadWarnings();
    };

    window.loadWarningCount = async function () {
        const badge = document.getElementById('warningBadge');
        if (!currentUser) {
            window.warningCount = 0;
            if (badge) badge.style.display = 'none';
            return;
        }

        try {
            const data = await api.get('/warnings/count', { silent: true });
            window.warningCount = data.total || 0;
            if (badge) {
                badge.textContent = window.warningCount;
                badge.style.display = window.warningCount > 0 ? 'inline-block' : 'none';
                badge.style.background = data.high > 0 ? 'var(--danger)' : 'var(--warning)';
            }
        } catch (e) {
            console.warn('加载预警数量失败', e);
        }
    };

    window.acknowledgeWarning = function (warning) {
        const key = warningKey(warning);
        window.warningActionState[key] = { status: 'acknowledged', updated_at: new Date().toISOString() };
        persistWarningState();
        showToast('预警已确认', 'success');
        window.loadWarnings();
    };

    window.ignoreWarning = function (warning) {
        const key = warningKey(warning);
        window.warningActionState[key] = { status: 'ignored', updated_at: new Date().toISOString() };
        persistWarningState();
        showToast('预警已忽略', 'success');
        window.loadWarnings();
    };
})();
