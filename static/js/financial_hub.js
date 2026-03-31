(function () {
    function hydrateFinancialFiltersFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const keyword = params.get('financial_search') || '';
        const margin = params.get('financial_margin') || '';
        const focus = params.get('financial_focus') || '';
        const input = document.getElementById('financialSearch');
        const marginSel = document.getElementById('financialMarginFilter');
        const focusSel = document.getElementById('financialFocusFilter');
        if (input) input.value = keyword;
        if (marginSel) marginSel.value = margin;
        if (focusSel) focusSel.value = focus;
    }

    function syncFinancialFiltersToUrl() {
        const params = new URLSearchParams(window.location.search);
        ['financial_search', 'financial_margin', 'financial_focus'].forEach(key => params.delete(key));
        const keyword = document.getElementById('financialSearch')?.value.trim() || '';
        const margin = document.getElementById('financialMarginFilter')?.value || '';
        const focus = document.getElementById('financialFocusFilter')?.value || '';
        if (keyword) params.set('financial_search', keyword); else params.delete('financial_search');
        if (margin) params.set('financial_margin', margin); else params.delete('financial_margin');
        if (focus) params.set('financial_focus', focus); else params.delete('financial_focus');
        const query = params.toString();
        window.history.replaceState({}, '', `${window.location.pathname}${query ? '?' + query : ''}`);
    }

    window.showFinancialOverview = async function () {
        currentProjectId = null;
        hideAllViews();
        document.getElementById('financialView').style.display = 'block';
        const container = document.getElementById('financialView');
        container.innerHTML = '<div class="loading-spinner">加载经营看板中...</div>';

        try {
            const data = await api.get('/financial/overview');
            const s = data.summary || {};
            const params = new URLSearchParams(window.location.search);
            const financialSummary = [params.get('financial_search'), params.get('financial_margin'), params.get('financial_focus')].filter(Boolean).join(' / ');
            container.innerHTML = `
                <div class="detail-header" style="margin-bottom:20px;">
                    <div>
                        <h2 class="detail-title">💰 经营看板</h2>
                        <p class="detail-meta">总览合同额、回款、报销、人力成本与项目毛利</p>
                        ${financialSummary ? `<div style="margin-top:6px;font-size:12px;color:#64748b;">当前筛选：${financialSummary}</div>` : ''}
                    </div>
                    <div class="btn-group">
                        <button class="btn btn-outline" onclick="copyCurrentViewLink()">复制当前视图链接</button>
                        <button class="btn btn-outline" onclick="showFinancialOverview()">刷新</button>
                        <button class="btn btn-outline" onclick="showDashboard()">← 返回仪表盘</button>
                    </div>
                </div>
                <div class="dashboard-grid" style="margin-bottom:20px;">
                    <div class="stat-card"><div class="stat-icon blue">📄</div><div class="stat-value">¥${((s.contract_total || 0) / 10000).toFixed(1)}w</div><div class="stat-label">合同总额</div></div>
                    <div class="stat-card"><div class="stat-icon green">💵</div><div class="stat-value">¥${((s.collected_total || 0) / 10000).toFixed(1)}w</div><div class="stat-label">已回款</div></div>
                    <div class="stat-card"><div class="stat-icon warning">⏳</div><div class="stat-value">¥${((s.uncollected_total || 0) / 10000).toFixed(1)}w</div><div class="stat-label">未回款</div></div>
                    <div class="stat-card"><div class="stat-icon yellow">🧾</div><div class="stat-value">¥${((s.reimbursed_total || 0) / 10000).toFixed(1)}w</div><div class="stat-label">已报销</div></div>
                    <div class="stat-card"><div class="stat-icon pink">👷</div><div class="stat-value">¥${((s.labor_total || 0) / 10000).toFixed(1)}w</div><div class="stat-label">人力成本</div></div>
                    <div class="stat-card"><div class="stat-icon ${s.gross_profit_total >= 0 ? 'green' : 'red'}">📈</div><div class="stat-value">¥${((s.gross_profit_total || 0) / 10000).toFixed(1)}w</div><div class="stat-label">总毛利</div></div>
                    <div class="stat-card"><div class="stat-icon info">🏷️</div><div class="stat-value">${s.gross_margin || 0}%</div><div class="stat-label">综合毛利率</div></div>
                    <div class="stat-card"><div class="stat-icon ${s.loss_projects > 0 ? 'red' : 'green'}">⚠️</div><div class="stat-value">${s.loss_projects || 0}</div><div class="stat-label">亏损项目</div></div>
                </div>
                <div class="panel" style="margin-bottom:20px;">
                    <div class="panel-header"><div class="panel-title">经营趋势</div></div>
                    <div class="panel-body">
                        <div style="margin-bottom:12px;font-size:13px;color:#64748b;">趋势图展示最近月份的回款、报销、人力成本和毛利变化，便于识别经营拐点。</div>
                        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;">
                            <div id="financeTrendChart" style="height:320px;"></div>
                            <div id="financeProfitChart" style="height:320px;"></div>
                        </div>
                    </div>
                </div>
                <div class="panel">
                    <div class="panel-header"><div class="panel-title">项目经营明细</div></div>
                    <div class="panel-body">
                        <div style="margin-bottom:12px;font-size:13px;color:#64748b;">可按项目、医院、毛利率和经营风险快速筛选重点项目。</div>
                        <div id="financialResultCount" style="margin-bottom:12px;font-size:12px;color:#64748b;">当前结果：${(data.projects || []).length} 条</div>
                        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
                            <input id="financialSearch" type="text" placeholder="搜索项目 / 医院" oninput="filterFinancialRows()" style="flex:1;min-width:240px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;">
                            <select id="financialMarginFilter" onchange="filterFinancialRows()" style="width:180px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;">
                                <option value="">全部毛利率</option>
                                <option value="high">高毛利 (>=20%)</option>
                                <option value="mid">中毛利 (0-20%)</option>
                                <option value="low">负毛利 (&lt;0%)</option>
                            </select>
                            <select id="financialFocusFilter" onchange="filterFinancialRows()" style="width:180px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;">
                                <option value="">全部项目</option>
                                <option value="uncollected">只看未回款</option>
                                <option value="loss">只看亏损项目</option>
                            </select>
                            <button class="btn btn-outline btn-sm" onclick="resetFinancialFilters()">清空筛选</button>
                        </div>
                        <div class="table-container">
                            <table class="table" id="financialTable">
                                <thead><tr><th>项目</th><th>医院</th><th>合同额</th><th>已回款</th><th>报销</th><th>人力成本</th><th>毛利</th><th>毛利率</th></tr></thead>
                                <tbody id="financialBody">
                                    ${(data.projects || []).map(p => {
                                        const uncollected = Number(p.contract_amount || 0) - Number(p.collected_amount || 0);
                                        const rowBg = (p.margin || 0) < 0 ? 'background:rgba(254,242,242,0.85);'
                                            : uncollected > 0 ? 'background:rgba(255,247,237,0.85);'
                                            : (p.margin || 0) >= 20 ? 'background:rgba(240,253,244,0.85);' : '';
                                        return `<tr class="financial-row" data-name="${(p.project_name || '').toLowerCase()}" data-hospital="${(p.hospital_name || '').toLowerCase()}" data-margin="${p.margin || 0}" data-uncollected="${uncollected}" data-loss="${(p.gross_profit || 0) < 0 ? 1 : 0}" style="cursor:pointer;${rowBg}" onclick="loadProjectDetail(${p.id})"><td>${p.project_name}</td><td>${p.hospital_name || '-'}</td><td>¥${Number(p.contract_amount || 0).toLocaleString()}</td><td>¥${Number(p.collected_amount || 0).toLocaleString()}</td><td>¥${Number(p.reimbursed_amount || 0).toLocaleString()}</td><td>¥${Number(p.labor_cost || 0).toLocaleString()}</td><td style="color:${(p.gross_profit || 0) >= 0 ? '#059669' : '#dc2626'};font-weight:700;">¥${Number(p.gross_profit || 0).toLocaleString()}</td><td><span class="badge ${(p.margin || 0) >= 20 ? 'badge-success' : (p.margin || 0) >= 0 ? 'badge-warning' : 'badge-danger'}">${p.margin || 0}%</span></td></tr>`;
                                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            `;
            hydrateFinancialFiltersFromUrl();
            window.filterFinancialRows();

            setTimeout(() => {
                const trend = data.monthly_trend || [];
                const months = trend.map(i => i.month);
                const collected = trend.map(i => i.collected);
                const reimbursed = trend.map(i => i.reimbursed);
                const labor = trend.map(i => i.labor_cost);
                const profit = trend.map(i => i.gross_profit);

                const trendChart = echarts.init(document.getElementById('financeTrendChart'));
                trendChart.setOption({
                    tooltip: { trigger: 'axis' },
                    legend: { data: ['回款', '报销', '人力成本'], bottom: 0 },
                    grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
                    xAxis: { type: 'category', data: months },
                    yAxis: { type: 'value', axisLabel: { formatter: (v) => `¥${(v / 10000).toFixed(1)}w` } },
                    series: [
                        { name: '回款', type: 'line', smooth: true, data: collected, itemStyle: { color: '#16a34a' } },
                        { name: '报销', type: 'line', smooth: true, data: reimbursed, itemStyle: { color: '#f59e0b' } },
                        { name: '人力成本', type: 'line', smooth: true, data: labor, itemStyle: { color: '#ec4899' } }
                    ],
                    graphic: !months.length ? [{ type: 'text', left: 'center', top: 'middle', style: { text: '暂无经营趋势数据', fill: '#94a3b8', fontSize: 16 } }] : []
                });

                const profitChart = echarts.init(document.getElementById('financeProfitChart'));
                profitChart.setOption({
                    tooltip: { trigger: 'axis' },
                    grid: { left: '3%', right: '4%', bottom: '10%', containLabel: true },
                    xAxis: { type: 'category', data: months },
                    yAxis: { type: 'value', axisLabel: { formatter: (v) => `¥${(v / 10000).toFixed(1)}w` } },
                    series: [{
                        name: '月度毛利',
                        type: 'bar',
                        data: profit,
                        itemStyle: { color: function (params) { return params.value >= 0 ? '#3b82f6' : '#ef4444'; } }
                    }],
                    graphic: !months.length ? [{ type: 'text', left: 'center', top: 'middle', style: { text: '暂无月度毛利数据', fill: '#94a3b8', fontSize: 16 } }] : []
                });

                window.addEventListener('resize', () => {
                    trendChart.resize();
                    profitChart.resize();
                });
            }, 100);
        } catch (e) {
            container.innerHTML = `
                <div class="detail-header" style="margin-bottom:20px;">
                    <div>
                        <h2 class="detail-title">💰 经营看板</h2>
                        <p class="detail-meta">总览合同额、回款、报销、人力成本与项目毛利</p>
                    </div>
                    <div class="btn-group">
                        <button class="btn btn-outline" onclick="copyCurrentViewLink()">复制当前视图链接</button>
                        <button class="btn btn-outline" onclick="showFinancialOverview()">刷新</button>
                        <button class="btn btn-outline" onclick="showDashboard()">← 返回仪表盘</button>
                    </div>
                </div>
                <div class="empty-state"><p>加载经营看板失败: ${e.message}</p></div>
            `;
        }
    };

    window.filterFinancialRows = function () {
        const keyword = (document.getElementById('financialSearch')?.value || '').toLowerCase();
        const marginFilter = document.getElementById('financialMarginFilter')?.value || '';
        const focusFilter = document.getElementById('financialFocusFilter')?.value || '';
        let visibleCount = 0;
        document.querySelectorAll('#financialBody .financial-row').forEach(row => {
            const text = `${row.dataset.name} ${row.dataset.hospital}`.toLowerCase();
            const margin = Number(row.dataset.margin || 0);
            const uncollected = Number(row.dataset.uncollected || 0);
            const isLoss = Number(row.dataset.loss || 0) === 1;
            const matchKeyword = !keyword || text.includes(keyword);
            const matchMargin = !marginFilter ||
                (marginFilter === 'high' && margin >= 20) ||
                (marginFilter === 'mid' && margin >= 0 && margin < 20) ||
                (marginFilter === 'low' && margin < 0);
            const matchFocus = !focusFilter ||
                (focusFilter === 'uncollected' && uncollected > 0) ||
                (focusFilter === 'loss' && isLoss);
            const visible = matchKeyword && matchMargin && matchFocus;
            row.style.display = visible ? '' : 'none';
            if (visible) visibleCount += 1;
        });
        const tbody = document.getElementById('financialBody');
        const emptyRow = document.getElementById('financialEmpty');
        const resultCount = document.getElementById('financialResultCount');
        if (tbody) {
            if (!visibleCount && !emptyRow) {
                const summary = [keyword, marginFilter, focusFilter].filter(Boolean).join(' / ');
                tbody.insertAdjacentHTML('beforeend', `<tr id="financialEmpty"><td colspan="8" class="empty-state">未找到匹配的经营项目${summary ? `（当前筛选：${summary}）` : ''}</td></tr>`);
            } else if (visibleCount && emptyRow) {
                emptyRow.remove();
            }
        }
        if (resultCount) {
            resultCount.textContent = `当前结果：${visibleCount} 条`;
        }
        syncFinancialFiltersToUrl();
    };

    window.resetFinancialFilters = function () {
        const input = document.getElementById('financialSearch');
        const margin = document.getElementById('financialMarginFilter');
        const focus = document.getElementById('financialFocusFilter');
        if (input) input.value = '';
        if (margin) margin.value = '';
        if (focus) focus.value = '';
        window.filterFinancialRows();
    };
})();
