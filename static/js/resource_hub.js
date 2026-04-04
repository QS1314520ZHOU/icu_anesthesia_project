(function () {
    function hydrateResourceFiltersFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const keyword = params.get('resource_search') || '';
        const role = params.get('resource_role') || '';
        const load = params.get('resource_load') || '';
        const sort = params.get('resource_sort') || '';
        const input = document.getElementById('resourceMemberSearch');
        const roleSel = document.getElementById('resourceRoleFilter');
        const loadSel = document.getElementById('resourceLoadFilter');
        const sortSel = document.getElementById('resourceSortFilter');
        if (input) input.value = keyword;
        if (roleSel) roleSel.value = role;
        if (loadSel) loadSel.value = load;
        if (sortSel) sortSel.value = sort;
    }

    function syncResourceFiltersToUrl() {
        const params = new URLSearchParams(window.location.search);
        ['resource_search', 'resource_role', 'resource_load', 'resource_sort'].forEach(key => params.delete(key));
        const keyword = document.getElementById('resourceMemberSearch')?.value.trim() || '';
        const role = document.getElementById('resourceRoleFilter')?.value || '';
        const load = document.getElementById('resourceLoadFilter')?.value || '';
        const sort = document.getElementById('resourceSortFilter')?.value || '';
        if (keyword) params.set('resource_search', keyword); else params.delete('resource_search');
        if (role) params.set('resource_role', role); else params.delete('resource_role');
        if (load) params.set('resource_load', load); else params.delete('resource_load');
        if (sort) params.set('resource_sort', sort); else params.delete('resource_sort');
        const query = params.toString();
        window.history.replaceState({}, '', `${window.location.pathname}${query ? '?' + query : ''}`);
    }

    window.showResourceOverview = async function () {
        currentProjectId = null;
        hideAllViews();
        document.getElementById('resourceView').style.display = 'block';
        const container = document.getElementById('resourceView');
        container.innerHTML = '<div class="loading-spinner">加载资源排班视图中...</div>';

        try {
            const data = await api.get('/resources/overview');
            const params = new URLSearchParams(window.location.search);
            const resourceSummary = [params.get('resource_search'), params.get('resource_role'), params.get('resource_load'), params.get('resource_sort')].filter(Boolean).join(' / ');
            container.innerHTML = `
                <div class="detail-header" style="margin-bottom:20px;">
                    <div>
                        <h2 class="detail-title">👥 资源排班视图</h2>
                        <p class="detail-meta">总览成员分布、驻场情况、待办任务与负载压力</p>
                        ${resourceSummary ? `<div style="margin-top:6px;font-size:12px;color:#64748b;">当前筛选：${resourceSummary}</div>` : ''}
                    </div>
                    <div class="btn-group">
                        <button class="btn btn-outline" onclick="copyCurrentViewLink()">复制当前视图链接</button>
                        <button class="btn btn-outline" onclick="showResourceOverview()">刷新</button>
                        <button class="btn btn-outline" onclick="showDashboard()">← 返回仪表盘</button>
                    </div>
                </div>
                <div class="dashboard-grid" style="margin-bottom:20px;">
                    <div class="stat-card"><div class="stat-icon blue">👤</div><div class="stat-value">${data.summary.total_members}</div><div class="stat-label">成员总数</div></div>
                    <div class="stat-card"><div class="stat-icon green">🏥</div><div class="stat-value">${data.summary.onsite_members}</div><div class="stat-label">驻场成员</div></div>
                    <div class="stat-card"><div class="stat-icon red">🔥</div><div class="stat-value">${data.summary.busy_members}</div><div class="stat-label">高负载成员</div></div>
                    <div class="stat-card"><div class="stat-icon yellow">🧩</div><div class="stat-value">${data.summary.available_members}</div><div class="stat-label">可调配成员</div></div>
                    <div class="stat-card"><div class="stat-icon info">🗺️</div><div class="stat-value">${data.summary.covered_cities}</div><div class="stat-label">覆盖城市</div></div>
                </div>
                <div class="panel" style="margin-bottom:20px;">
                    <div class="panel-header"><div class="panel-title">城市资源概览</div></div>
                    <div class="panel-body">
                        <div style="margin-bottom:12px;font-size:13px;color:#64748b;">点击城市可快速过滤下方成员列表，定位某一区域的交付压力。</div>
                        <div class="table-container">
                            <table class="table">
                                <thead><tr><th>城市</th><th>成员数</th><th>驻场数</th><th>待办任务</th><th>平均负载</th></tr></thead>
                                <tbody>
                                    ${data.cities.map(c => `<tr style="cursor:pointer;" onclick="filterResourceByCity('${c.city}')"><td><span style="color:#2563eb;font-weight:600;">${c.city}</span></td><td>${c.member_count}</td><td>${c.onsite_count}</td><td>${c.total_tasks}</td><td><span class="badge ${c.avg_load_score >= 70 ? 'badge-danger' : c.avg_load_score >= 40 ? 'badge-warning' : 'badge-success'}">${c.avg_load_score}</span></td></tr>`).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
                <div class="panel" style="margin-bottom:20px;">
                    <div class="panel-header"><div class="panel-title">建议调配</div></div>
                    <div class="panel-body">
                        <div style="margin-bottom:12px;font-size:13px;color:#64748b;">根据当前负载高低自动给出人员调配建议，便于快速平衡资源。</div>
                        ${(data.suggestions || []).length ? data.suggestions.map(s => `<div style="padding:12px 14px;border-radius:12px;border-left:4px solid #f59e0b;background:#fff;margin-bottom:10px;box-shadow:0 4px 16px rgba(15,23,42,0.04);"><div style="font-weight:700;color:#111827;margin-bottom:6px;">${s.from_member} → ${s.to_member}</div><div style="font-size:13px;color:#475569;margin-bottom:4px;">${s.from_city || '未定位'} / ${s.from_project || '未分配项目'} → ${s.to_city || '未定位'} / ${s.to_project || '未分配项目'}</div><div style="font-size:13px;color:#92400e;">${s.reason}</div></div>`).join('') : '<div class="empty-state"><p>当前暂无明显调配建议</p></div>'}
                    </div>
                </div>
                <div class="panel">
                    <div class="panel-header"><div class="panel-title">成员负载明细</div></div>
                    <div class="panel-body">
                        <div id="resourceResultCount" style="margin-bottom:12px;font-size:12px;color:#64748b;">当前结果：${data.members.length} 条</div>
                        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
                            <input id="resourceMemberSearch" type="text" placeholder="搜索成员 / 城市 / 项目" oninput="filterResourceMembers()" style="flex:1;min-width:240px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;">
                            <select id="resourceRoleFilter" onchange="filterResourceMembers()" style="width:180px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;">
                                <option value="">全部角色</option>
                                ${[...new Set(data.members.map(m => m.role).filter(Boolean))].map(role => `<option value="${role}">${role}</option>`).join('')}
                            </select>
                            <select id="resourceLoadFilter" onchange="filterResourceMembers()" style="width:180px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;">
                                <option value="">全部负载</option>
                                <option value="high">高负载</option>
                                <option value="medium">中负载</option>
                                <option value="low">低负载</option>
                            </select>
                            <select id="resourceSortFilter" onchange="sortResourceMembers()" style="width:180px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;">
                                <option value="">默认排序</option>
                                <option value="load_desc">按负载从高到低</option>
                                <option value="load_asc">按负载从低到高</option>
                                <option value="task_desc">按待办任务从高到低</option>
                                <option value="project_desc">按项目数从高到低</option>
                            </select>
                            <button class="btn btn-outline btn-sm" onclick="resetResourceFilters()">清空筛选</button>
                        </div>
                        <div class="table-container">
                            <table class="table" id="resourceMembersTable">
                                <thead><tr><th>成员</th><th>角色</th><th>城市</th><th>当前项目</th><th>负责项目数</th><th>待办任务</th><th>负载评分</th></tr></thead>
                                <tbody id="resourceMembersBody">
                                    ${data.members.map(m => `<tr class="resource-member-row" data-name="${m.name || ''}" data-role="${m.role || ''}" data-city="${m.current_city || ''}" data-project="${m.project_summary || m.project_name || ''}" data-load="${m.load_score || 0}" style="${(m.load_score || 0) >= 70 ? 'background:rgba(254,242,242,0.8);' : ''}"><td><button class="btn btn-link" style="padding:0;color:#2563eb;background:none;border:none;" onclick="showResourceMemberDetail('${m.name}')">${m.name}</button></td><td>${m.role || '-'}</td><td>${m.current_city || '-'}</td><td>${m.project_summary || m.project_name || '-'}</td><td>${m.project_count || 0}</td><td>${m.task_count || 0}</td><td><span class="badge ${m.load_score >= 70 ? 'badge-danger' : m.load_score >= 40 ? 'badge-warning' : 'badge-success'}">${m.load_score || 0}</span></td></tr>`).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
                <div id="resourceMemberDetail" class="panel" style="margin-top:20px;display:none;"></div>
            `;
            hydrateResourceFiltersFromUrl();
            window.sortResourceMembers();
            window.filterResourceMembers();
        } catch (e) {
            container.innerHTML = `
                <div class="detail-header" style="margin-bottom:20px;">
                    <div>
                        <h2 class="detail-title">👥 资源排班视图</h2>
                        <p class="detail-meta">总览成员分布、驻场情况、待办任务与负载压力</p>
                    </div>
                    <div class="btn-group">
                        <button class="btn btn-outline" onclick="copyCurrentViewLink()">复制当前视图链接</button>
                        <button class="btn btn-outline" onclick="showResourceOverview()">刷新</button>
                        <button class="btn btn-outline" onclick="showDashboard()">← 返回仪表盘</button>
                    </div>
                </div>
                <div class="empty-state"><p>加载资源排班视图失败: ${e.message}</p></div>
            `;
        }
    };

    window.filterResourceMembers = function () {
        const keyword = (document.getElementById('resourceMemberSearch')?.value || '').toLowerCase();
        const role = document.getElementById('resourceRoleFilter')?.value || '';
        const load = document.getElementById('resourceLoadFilter')?.value || '';
        let visibleCount = 0;
        document.querySelectorAll('#resourceMembersBody .resource-member-row').forEach(row => {
            const text = [row.dataset.name, row.dataset.role, row.dataset.city, row.dataset.project].join(' ').toLowerCase();
            const score = Number(row.dataset.load || 0);
            const matchKeyword = !keyword || text.includes(keyword);
            const matchRole = !role || row.dataset.role === role;
            const matchLoad = !load ||
                (load === 'high' && score >= 70) ||
                (load === 'medium' && score >= 40 && score < 70) ||
                (load === 'low' && score < 40);
            const visible = matchKeyword && matchRole && matchLoad;
            row.style.display = visible ? '' : 'none';
            if (visible) visibleCount += 1;
        });
        const tbody = document.getElementById('resourceMembersBody');
        const emptyRow = document.getElementById('resourceMembersEmpty');
        const resultCount = document.getElementById('resourceResultCount');
        if (tbody) {
            if (!visibleCount && !emptyRow) {
                const summary = [keyword, role, load].filter(Boolean).join(' / ');
                tbody.insertAdjacentHTML('beforeend', `<tr id="resourceMembersEmpty"><td colspan="7" class="empty-state">未找到匹配的成员${summary ? `（当前筛选：${summary}）` : ''}</td></tr>`);
            } else if (visibleCount && emptyRow) {
                emptyRow.remove();
            }
        }
        if (resultCount) {
            resultCount.textContent = `当前结果：${visibleCount} 条`;
        }
        syncResourceFiltersToUrl();
    };

    window.sortResourceMembers = function () {
        const tbody = document.getElementById('resourceMembersBody');
        if (!tbody) return;
        const sort = document.getElementById('resourceSortFilter')?.value || '';
        const rows = Array.from(tbody.querySelectorAll('.resource-member-row'));
        rows.sort((a, b) => {
            const loadA = Number(a.dataset.load || 0);
            const loadB = Number(b.dataset.load || 0);
            const taskA = Number(a.children[5]?.textContent || 0);
            const taskB = Number(b.children[5]?.textContent || 0);
            const projectA = Number(a.children[4]?.textContent || 0);
            const projectB = Number(b.children[4]?.textContent || 0);
            if (sort === 'load_desc') return loadB - loadA;
            if (sort === 'load_asc') return loadA - loadB;
            if (sort === 'task_desc') return taskB - taskA;
            if (sort === 'project_desc') return projectB - projectA;
            return loadB - loadA;
        });
        rows.forEach(row => tbody.appendChild(row));
        syncResourceFiltersToUrl();
    };

    window.filterResourceByCity = function (city) {
        const input = document.getElementById('resourceMemberSearch');
        if (input) {
            input.value = city || '';
            window.filterResourceMembers();
        }
    };

    window.resetResourceFilters = function () {
        const input = document.getElementById('resourceMemberSearch');
        const role = document.getElementById('resourceRoleFilter');
        const load = document.getElementById('resourceLoadFilter');
        const sort = document.getElementById('resourceSortFilter');
        if (input) input.value = '';
        if (role) role.value = '';
        if (load) load.value = '';
        if (sort) sort.value = '';
        window.sortResourceMembers();
        window.filterResourceMembers();
    };

    window.showResourceMemberDetail = async function (name) {
        const panel = document.getElementById('resourceMemberDetail');
        if (!panel) return;
        panel.style.display = 'block';
        panel.innerHTML = '<div class="panel-body"><div class="loading-spinner">加载成员详情中...</div></div>';
        try {
            const data = await api.get(`/resources/member-detail?name=${encodeURIComponent(name)}`);
            panel.innerHTML = `
                <div class="panel-header"><div class="panel-title">成员详情 · ${data.name}</div></div>
                <div class="panel-body">
                    <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:18px;">
                        <div style="padding:12px;border-radius:10px;background:#eff6ff;"><div style="font-size:12px;color:#64748b;">项目数</div><div style="font-size:22px;font-weight:800;color:#2563eb;">${(data.projects || []).length}</div></div>
                        <div style="padding:12px;border-radius:10px;background:#fff7ed;"><div style="font-size:12px;color:#64748b;">待办任务</div><div style="font-size:22px;font-weight:800;color:#d97706;">${(data.tasks || []).length}</div></div>
                        <div style="padding:12px;border-radius:10px;background:#f0fdf4;"><div style="font-size:12px;color:#64748b;">近期日志</div><div style="font-size:22px;font-weight:800;color:#059669;">${(data.logs || []).length}</div></div>
                        <div style="padding:12px;border-radius:10px;background:#fdf2f8;"><div style="font-size:12px;color:#64748b;">高负载提示</div><div style="font-size:22px;font-weight:800;color:#db2777;">${(data.tasks || []).length > 5 ? '是' : '否'}</div></div>
                    </div>
                    <div style="margin-bottom:16px;font-weight:700;color:#334155;">关联项目</div>
                    <div class="table-container" style="margin-bottom:20px;">
                        <table class="table">
                            <thead><tr><th>项目</th><th>医院</th><th>状态</th><th>角色</th><th>城市</th></tr></thead>
                            <tbody>
                                ${(data.projects || []).map(p => `<tr style="cursor:pointer;" onclick="loadProjectDetail(${p.id})"><td>${p.project_name}</td><td>${p.hospital_name || '-'}</td><td>${p.status || '-'}</td><td>${p.role || '-'}</td><td>${p.current_city || '-'}</td></tr>`).join('') || '<tr><td colspan="5" class="empty-state">暂无关联项目</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                    <div style="margin-bottom:16px;font-weight:700;color:#334155;">待办任务</div>
                    <div class="table-container">
                        <table class="table">
                            <thead><tr><th>项目</th><th>阶段</th><th>任务</th></tr></thead>
                            <tbody>
                                ${(data.tasks || []).map(t => `<tr style="cursor:pointer;" onclick="loadProjectDetail(${t.project_id})"><td>${t.project_name}</td><td>${t.stage_name || '-'}</td><td>${t.task_name || '-'}</td></tr>`).join('') || '<tr><td colspan="3" class="empty-state">暂无待办任务</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                    <div style="margin:20px 0 16px;font-weight:700;color:#334155;">最近工作日志</div>
                    <div class="table-container">
                        <table class="table">
                            <thead><tr><th>日期</th><th>工作内容</th><th>问题</th><th>明日计划</th></tr></thead>
                            <tbody>
                                ${(data.logs || []).map(log => `<tr><td>${log.log_date || '-'}</td><td>${log.work_content || '-'}</td><td>${log.issues_encountered || '-'}</td><td>${log.tomorrow_plan || '-'}</td></tr>`).join('') || '<tr><td colspan="4" class="empty-state">暂无近期工作日志</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        } catch (e) {
            panel.innerHTML = `<div class="panel-body"><div class="empty-state"><p>加载成员详情失败: ${e.message}</p></div></div>`;
        }
    };
})();
