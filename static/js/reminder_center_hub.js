(function () {
    window.reminderData = window.reminderData || null;
    window.reminderSearch = window.reminderSearch || '';

    function syncReminderTabToUrl(type) {
        const params = new URLSearchParams(window.location.search);
        if (type) params.set('reminder_tab', type);
        else params.delete('reminder_tab');
        const query = params.toString();
        window.history.replaceState({}, '', `${window.location.pathname}${query ? '?' + query : ''}`);
    }

    function getReminderTabFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get('reminder_tab') || 'overdue';
    }

    function syncReminderSearchToUrl() {
        const params = new URLSearchParams(window.location.search);
        if (window.reminderSearch) params.set('reminder_search', window.reminderSearch);
        else params.delete('reminder_search');
        const query = params.toString();
        window.history.replaceState({}, '', `${window.location.pathname}${query ? '?' + query : ''}`);
    }

    function hydrateReminderSearchFromUrl() {
        const params = new URLSearchParams(window.location.search);
        window.reminderSearch = params.get('reminder_search') || '';
    }

    window.showReminderCenter = async function () {
        openModal('reminderModal');
        hydrateReminderSearchFromUrl();
        await window.loadReminderDigest();
        await window.switchReminderTab(getReminderTabFromUrl());
    };

    window.loadReminderDigest = async function () {
        const container = document.getElementById('reminderDigest');
        try {
            const d = await api.get('/reminders/digest');
            if (d) {
                const scoreClass = d.health_score >= 80 ? 'score-high' : d.health_score >= 60 ? 'score-medium' : 'score-low';
                container.innerHTML = `
                    <div class="score-card ${scoreClass}">
                        <div class="score-circle">
                            <div class="score-value">${d.health_score || 0}</div>
                            <div class="score-label">健康度</div>
                        </div>
                        <div class="score-info">
                            <div class="score-title">📊 每日摘要</div>
                            <div style="display: flex; gap: 20px; flex-wrap: wrap; font-size: 13px;">
                                <span>📁 活跃项目: <strong>${d.active_projects || 0}</strong></span>
                                <span>🚨 逾期: <strong style="color:#ef4444;">${d.overdue_count || 0}</strong></span>
                                <span>⏰ 即将到期: <strong style="color:#f59e0b;">${d.upcoming_count || 0}</strong></span>
                                <span>💤 待处理: <strong>${d.stale_issues_count || 0}</strong></span>
                            </div>
                        </div>
                    </div>
                `;
                const badge = document.getElementById('reminderBadge');
                const total = (d.overdue_count || 0) + (d.upcoming_count || 0);
                if (total > 0) {
                    badge.textContent = total;
                    badge.style.display = 'inline';
                } else {
                    badge.style.display = 'none';
                }
                updateReminderTabLabels(d);
            }
        } catch (e) {
            container.innerHTML = '<div style="color:#ef4444;">加载失败</div>';
        }
    };

    function updateReminderTabLabels(digest) {
        const tabs = document.querySelectorAll('#reminderTabs .tab');
        if (!tabs.length) return;
        const labels = [
            `🚨 逾期项 (${digest?.overdue_count || 0})`,
            `⏰ 即将到期 (${digest?.upcoming_count || 0})`,
            `💤 待处理问题 (${digest?.stale_issues_count || 0})`,
            `😴 闲置项目 (${digest?.idle_projects_count || 0})`
        ];
        tabs.forEach((tab, idx) => {
            if (labels[idx]) tab.textContent = labels[idx];
        });
    }

    window.switchReminderTab = async function (type) {
        syncReminderTabToUrl(type);
        syncReminderSearchToUrl();
        document.querySelectorAll('#reminderTabs .tab').forEach(t => t.classList.remove('active'));
        const target = event ? event.target : document.querySelector(`#reminderTabs .tab[onclick*="'${type}'"]`);
        if (target) target.classList.add('active');

        const container = document.getElementById('reminderListContainer');
        container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

        try {
            let items = [];
            if (type === 'overdue') {
                const res = await api.get('/reminders/overdue');
                items = res?.overdue_milestones || [];
            } else if (type === 'upcoming') {
                const res = await api.get('/reminders/upcoming?days=7');
                items = res?.upcoming_deadlines || [];
            } else if (type === 'stale') {
                const res = await api.get('/reminders');
                items = res?.stale_issues || [];
            } else if (type === 'idle') {
                const res = await api.get('/reminders');
                items = res?.idle_projects || [];
            }

            if (items.length === 0) {
                container.innerHTML = '<div style="text-align:center; color:#6b7280; padding:40px;">🎉 暂无待处理项</div>';
                return;
            }

            const q = window.reminderSearch.toLowerCase();
            if (q) {
                items = items.filter(item => {
                    const title = item.name || item.project_name || item.description || '';
                    const desc = item.description || item.issue_type || '';
                    const project = item.project_name || '';
                    return `${title} ${desc} ${project}`.toLowerCase().includes(q);
                });
            }

            const searchSummary = [type, window.reminderSearch].filter(Boolean).join(' / ');
            const searchHtml = `
                ${searchSummary ? `<div style="margin-bottom:12px;font-size:12px;color:#64748b;">当前筛选：${searchSummary}</div>` : ''}
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
                    <input type="text" value="${window.reminderSearch}" placeholder="搜索项目 / 标题 / 描述" oninput="searchReminders(this.value)"
                        style="flex:1;min-width:220px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;">
                    <button class="btn btn-outline btn-sm" onclick="resetReminderSearch()">清空筛选</button>
                </div>
            `;

            if (!items.length) {
                container.innerHTML = searchHtml + '<div style="text-align:center; color:#6b7280; padding:30px;">未找到匹配的提醒项</div>';
                return;
            }

            container.innerHTML = searchHtml + items.map(item => {
                const daysOverdue = item.days_overdue || item.days_pending;
                const daysUntil = item.days_until || item.days_remaining;
                const title = item.name || item.project_name || item.description || '未命名项目';
                const canJump = !!item.project_id;
                const clickAction = canJump ? `onclick="loadProjectDetail(${item.project_id}); closeModal('reminderModal')"` : '';

                return `
                    <div class="reminder-item ${type === 'overdue' ? 'danger' : type === 'upcoming' ? 'warning' : 'info'}" ${clickAction} style="${canJump ? 'cursor:pointer;' : ''}">
                        <div class="reminder-content">
                            <div class="reminder-title">${title}</div>
                            <div class="reminder-desc">
                                ${item.project_name && item.project_name !== title ? `项目: ${item.project_name} | ` : ''} 
                                ${daysOverdue ? `超期 ${daysOverdue} 天` : ''} 
                                ${daysUntil !== undefined ? `${daysUntil} 天后到期` : ''}
                                ${item.severity ? `<span class="badge ${item.severity === '高' ? 'badge-danger' : 'badge-warning'}">${item.severity}</span>` : ''}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

        } catch (e) {
            container.innerHTML = '<div style="color:#ef4444; text-align:center;">加载失败</div>';
        }
    };

    window.searchReminders = function (keyword) {
        window.reminderSearch = keyword || '';
        syncReminderSearchToUrl();
        window.switchReminderTab(getReminderTabFromUrl());
    };

    window.resetReminderSearch = function () {
        window.reminderSearch = '';
        syncReminderSearchToUrl();
        window.switchReminderTab(getReminderTabFromUrl());
    };
})();
