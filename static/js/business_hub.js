(function () {
    let currentBusinessReportData = null;
    let currentEditingBusinessMetric = null;

    function fmtMoney(value) {
        return `¥${Number(value || 0).toLocaleString()}`;
    }

    function fmtWan(value) {
        return `¥${(Number(value || 0) / 10000).toFixed(1)}w`;
    }

    function currentMonth() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    function escapeJsText(value) {
        return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }

    function buildBusinessQuery() {
        const params = new URLSearchParams();
        const monthFrom = document.getElementById('businessMonthFrom')?.value || '';
        const monthTo = document.getElementById('businessMonthTo')?.value || '';
        if (monthFrom) params.set('month_from', monthFrom);
        if (monthTo) params.set('month_to', monthTo);
        return params.toString();
    }

    function hydrateBusinessFiltersFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const keyword = params.get('business_search') || '';
        const margin = params.get('business_margin') || '';
        const focus = params.get('business_focus') || '';
        const input = document.getElementById('businessSearch');
        const marginSel = document.getElementById('businessMarginFilter');
        const focusSel = document.getElementById('businessFocusFilter');
        if (input) input.value = keyword;
        if (marginSel) marginSel.value = margin;
        if (focusSel) focusSel.value = focus;
    }

    function syncBusinessFiltersToUrl() {
        const params = new URLSearchParams(window.location.search);
        ['business_search', 'business_margin', 'business_focus'].forEach(key => params.delete(key));
        const keyword = document.getElementById('businessSearch')?.value.trim() || '';
        const margin = document.getElementById('businessMarginFilter')?.value || '';
        const focus = document.getElementById('businessFocusFilter')?.value || '';
        if (keyword) params.set('business_search', keyword);
        if (margin) params.set('business_margin', margin);
        if (focus) params.set('business_focus', focus);
        const query = params.toString();
        window.history.replaceState({}, '', `${window.location.pathname}${query ? '?' + query : ''}`);
    }

    function renderRankingList(rows, key, emptyText) {
        if (!rows || !rows.length) {
            return `<div style="color:#94a3b8;">${emptyText}</div>`;
        }
        return rows.map((row, index) => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #e2e8f0;">
                <div>
                    <div style="font-weight:700;color:#0f172a;">${index + 1}. ${row.project_name}</div>
                    <div style="font-size:12px;color:#64748b;">${row.hospital_name || '-'}</div>
                </div>
                <div style="font-weight:700;color:${key === 'net_profit_total' && Number(row[key] || 0) < 0 ? '#dc2626' : '#0f766e'};">${fmtMoney(row[key])}</div>
            </div>
        `).join('');
    }

    function getFilteredMetrics(rows) {
        const year = document.getElementById('reportYear')?.value || '';
        const month = document.getElementById('reportMonth')?.value || '';
        const quarter = document.getElementById('reportQuarter')?.value || '';
        return (rows || []).filter(row => {
            const metricMonth = String(row.metric_month || '');
            const rowYear = metricMonth.slice(0, 4);
            const rowMonth = metricMonth.slice(5, 7);
            const rowQuarter = rowMonth ? String(Math.floor((Number(rowMonth) - 1) / 3) + 1) : '';
            if (year && rowYear !== year) return false;
            if (month && rowMonth !== String(month).padStart(2, '0')) return false;
            if (quarter && rowQuarter !== quarter) return false;
            return true;
        });
    }

    function renderBusinessReport(data) {
        const project = data.project || {};
        const summary = data.summary || {};
        const allRows = data.monthly_metrics || [];
        const rows = getFilteredMetrics(allRows);

        const title = document.getElementById('paperProjectName');
        const period = document.getElementById('paperReportPeriod');
        const aiSummary = document.getElementById('aiBusinessSummary');
        const milestones = document.getElementById('periodMilestones');
        const tasks = document.getElementById('periodTasks');
        const financials = document.getElementById('periodFinancials');
        const issues = document.getElementById('periodIssues');
        const printDate = document.getElementById('reportPrintDate');
        const year = document.getElementById('reportYear')?.value || '';
        const month = document.getElementById('reportMonth')?.value || '';
        const quarter = document.getElementById('reportQuarter')?.value || '';
        const week = document.getElementById('reportWeek')?.value || '';

        title.textContent = `${project.project_name || '项目'} 经营详情`;
        if (month) {
            period.textContent = `${year || ''}年${month}月 经营报表`;
        } else if (quarter) {
            period.textContent = `${year || ''}年 Q${quarter} 经营报表`;
        } else if (week) {
            period.textContent = `${year || ''}年 第${week}周 经营报表`;
        } else {
            period.textContent = `${project.hospital_name || ''} · 经营汇总报表`;
        }

        const negativeMonths = rows.filter(row => Number(row.net_profit || 0) < 0);
        const lowMarginMonths = rows.filter(row => Number(row.output_value || 0) > 0 && (Number(row.net_profit || 0) / Number(row.output_value || 1) * 100) < 10);

        aiSummary.innerHTML = `
            <p>项目状态：<strong>${project.status || '-'}</strong>，整体进度 <strong>${project.progress || 0}%</strong>。</p>
            <p>累计产值 <strong>${fmtMoney(summary.output_value_total)}</strong>，累计净利润 <strong>${fmtMoney(summary.net_profit_total)}</strong>，净利率 <strong>${summary.net_margin || 0}%</strong>。</p>
            <p>当前筛选区间内共有 <strong>${rows.length}</strong> 条经营记录，其中亏损月份 <strong>${negativeMonths.length}</strong> 个，低净利月份 <strong>${lowMarginMonths.length}</strong> 个。</p>
        `;

        milestones.innerHTML = rows.length ? rows.map(row => `
            <div style="padding:10px 0;border-bottom:1px solid #e2e8f0;">
                <div style="font-weight:700;">${row.metric_month}</div>
                <div style="font-size:13px;color:#475569;">产值 ${fmtMoney(row.output_value)} / 回款 ${fmtMoney(row.collected_amount)} / 净利润 ${fmtMoney(row.net_profit)}</div>
            </div>
        `).join('') : '<div style="color:#94a3b8;">暂无经营月报</div>';

        tasks.innerHTML = rows.length
            ? `当前筛选下，共记录 ${rows.length} 个经营月份；建议优先复盘亏损月份、低净利月份，以及回款低于产值的月份。`
            : '当前筛选范围暂无经营月报数据。';

        financials.innerHTML = `
            <div style="background:white;border-radius:10px;padding:14px;border:1px solid #e2e8f0;"><div style="font-size:12px;color:#64748b;">累计产值</div><div style="font-size:22px;font-weight:800;color:#0f766e;">${fmtMoney(summary.output_value_total)}</div></div>
            <div style="background:white;border-radius:10px;padding:14px;border:1px solid #e2e8f0;"><div style="font-size:12px;color:#64748b;">累计净利润</div><div style="font-size:22px;font-weight:800;color:${Number(summary.net_profit_total || 0) >= 0 ? '#2563eb' : '#dc2626'};">${fmtMoney(summary.net_profit_total)}</div></div>
            <div style="background:white;border-radius:10px;padding:14px;border:1px solid #e2e8f0;"><div style="font-size:12px;color:#64748b;">净利率</div><div style="font-size:22px;font-weight:800;color:${Number(summary.net_margin || 0) >= 10 ? '#059669' : '#d97706'};">${summary.net_margin || 0}%</div></div>
            <div style="background:white;border-radius:10px;padding:14px;border:1px solid #e2e8f0;"><div style="font-size:12px;color:#64748b;">直接成本</div><div style="font-size:18px;font-weight:700;">${fmtMoney(summary.direct_cost_total)}</div></div>
            <div style="background:white;border-radius:10px;padding:14px;border:1px solid #e2e8f0;"><div style="font-size:12px;color:#64748b;">人力成本</div><div style="font-size:18px;font-weight:700;">${fmtMoney(summary.labor_cost_total)}</div></div>
            <div style="background:white;border-radius:10px;padding:14px;border:1px solid #e2e8f0;"><div style="font-size:12px;color:#64748b;">税费+管理成本</div><div style="font-size:18px;font-weight:700;">${fmtMoney(Number(summary.tax_total || 0) + Number(summary.management_cost_total || 0))}</div></div>
        `;

        if (!rows.length) {
            issues.innerHTML = '<div style="color:#94a3b8;">当前筛选范围内暂无经营风险数据。</div>';
        } else if (negativeMonths.length) {
            issues.innerHTML = `<div style="color:#dc2626;">发现 ${negativeMonths.length} 个亏损月份，请重点复盘成本结构、税费和回款节奏。</div>`;
        } else if (lowMarginMonths.length) {
            issues.innerHTML = `<div style="color:#d97706;">存在 ${lowMarginMonths.length} 个低净利月份，建议优化直接成本和管理成本分摊。</div>`;
        } else {
            issues.innerHTML = '<div style="color:#059669;">当前未发现明显经营风险，经营状态总体健康。</div>';
        }

        if (printDate) {
            printDate.textContent = new Date().toLocaleString('zh-CN');
        }
    }

    function initBusinessReportSelectors(rows) {
        const reportYear = document.getElementById('reportYear');
        const reportMonth = document.getElementById('reportMonth');
        const reportQuarter = document.getElementById('reportQuarter');
        const reportWeek = document.getElementById('reportWeek');
        if (!reportYear || !reportMonth || !reportQuarter || !reportWeek) return;

        const years = [...new Set((rows || []).map(row => String(row.metric_month || '').slice(0, 4)).filter(Boolean))].sort();
        reportYear.innerHTML = `<option value="">年份</option>${years.map(year => `<option value="${year}">${year}</option>`).join('')}`;
        reportWeek.innerHTML = '<option value="">周度</option><option value="1">W1</option><option value="2">W2</option><option value="3">W3</option><option value="4">W4</option>';
    }

    function fillBusinessMetricForm(projectId, projectName, row) {
        document.getElementById('businessMetricProjectId').value = projectId;
        document.getElementById('businessMetricProjectName').value = projectName || '';
        document.getElementById('businessMetricMonth').value = row?.metric_month || currentMonth();
        document.getElementById('businessOutputValue').value = row?.output_value || '';
        document.getElementById('businessCollectedAmount').value = row?.collected_amount || '';
        document.getElementById('businessDirectCost').value = row?.direct_cost || '';
        document.getElementById('businessLaborCost').value = row?.labor_cost || '';
        document.getElementById('businessTaxAmount').value = row?.tax_amount || '';
        document.getElementById('businessManagementCost').value = row?.management_cost || '';
        document.getElementById('businessMetricNotes').value = row?.notes || '';
    }

    function setBusinessMetricModalMeta(isEditing, metricMonth = '') {
        const titleEl = document.querySelector('#businessMetricModal .modal-header h3');
        const submitBtn = document.querySelector('#businessMetricModal .btn-success');
        if (titleEl) {
            titleEl.textContent = isEditing
                ? `✏️ 编辑经营月报${metricMonth ? ` · ${metricMonth}` : ''}`
                : '📈 填写经营月报';
        }
        if (submitBtn) {
            submitBtn.textContent = isEditing ? '保存修改' : '保存月报';
        }
    }

    async function loadBusinessMetricHistory(projectId, projectName) {
        const container = document.getElementById('businessMetricHistory');
        if (!container) return;
        container.innerHTML = '加载中...';
        try {
            const rows = await api.get(`/business/projects/${projectId}/metrics`);
            if (!rows || !rows.length) {
                container.innerHTML = '<div style="color:#94a3b8;">暂无经营月报</div>';
                return;
            }
            container.innerHTML = rows.map(row => `
                <div style="padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px;background:#fff;">
                    <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;">
                        <div>
                            <div style="font-weight:700;color:#0f172a;">${row.metric_month}</div>
                            <div style="font-size:12px;color:#64748b;margin-top:4px;">
                                产值 ${fmtMoney(row.output_value)} / 净利润 ${fmtMoney(row.net_profit)}
                            </div>
                        </div>
                        <div style="display:flex;gap:6px;">
                            <button class="btn btn-outline btn-xs" onclick='editBusinessMetric(${projectId}, "${escapeJsText(projectName)}", ${JSON.stringify(row)})'>编辑</button>
                            <button class="btn btn-outline btn-xs" onclick="deleteBusinessMetric(${row.id}, ${projectId}, '${escapeJsText(projectName)}')">删除</button>
                        </div>
                    </div>
                </div>
            `).join('');
        } catch (e) {
            container.innerHTML = `<div style="color:#dc2626;">加载失败: ${e.message}</div>`;
        }
    }

    window.openBusinessMetricModal = async function (projectId, projectName) {
        currentEditingBusinessMetric = null;
        fillBusinessMetricForm(projectId, projectName || '', null);
        setBusinessMetricModalMeta(false);
        openModal('businessMetricModal', { reset: false });
        await loadBusinessMetricHistory(projectId, projectName || '');
    };

    window.editBusinessMetric = async function (projectId, projectName, row) {
        currentEditingBusinessMetric = row ? { id: row.id, metric_month: row.metric_month } : null;
        fillBusinessMetricForm(projectId, projectName || '', row || null);
        setBusinessMetricModalMeta(true, row?.metric_month || '');
        openModal('businessMetricModal', { reset: false });
        await loadBusinessMetricHistory(projectId, projectName || '');
        showToast(`已载入 ${row.metric_month} 月报，可直接修改后保存`, 'info');
    };

    window.submitBusinessMetric = async function (event) {
        if (event) event.preventDefault();
        const projectId = document.getElementById('businessMetricProjectId').value;
        const projectName = document.getElementById('businessMetricProjectName').value || '';
        const nextMetricMonth = document.getElementById('businessMetricMonth').value;
        const payload = {
            metric_month: nextMetricMonth,
            output_value: Number(document.getElementById('businessOutputValue').value || 0),
            collected_amount: Number(document.getElementById('businessCollectedAmount').value || 0),
            direct_cost: Number(document.getElementById('businessDirectCost').value || 0),
            labor_cost: Number(document.getElementById('businessLaborCost').value || 0),
            tax_amount: Number(document.getElementById('businessTaxAmount').value || 0),
            management_cost: Number(document.getElementById('businessManagementCost').value || 0),
            notes: document.getElementById('businessMetricNotes').value || ''
        };

        if (!payload.metric_month) {
            showToast('请选择统计月份', 'danger');
            return;
        }

        try {
            const movingMonth = currentEditingBusinessMetric
                && currentEditingBusinessMetric.metric_month
                && currentEditingBusinessMetric.metric_month !== nextMetricMonth;
            if (movingMonth) {
                const confirmed = confirm(`统计月份将从 ${currentEditingBusinessMetric.metric_month} 调整为 ${nextMetricMonth}，系统会迁移这条月报记录。是否继续？`);
                if (!confirmed) return;
            }

            await api.post(`/business/projects/${projectId}/metrics`, payload);
            if (movingMonth && currentEditingBusinessMetric?.id) {
                await api.delete(`/business/metrics/${currentEditingBusinessMetric.id}`);
            }
            currentEditingBusinessMetric = null;
            setBusinessMetricModalMeta(false);
            fillBusinessMetricForm(projectId, projectName || '', null);
            showToast('经营月报已保存', 'success');
            await loadBusinessMetricHistory(projectId, projectName);
            await window.showBusinessOverview();
        } catch (e) {
            showToast(`保存失败: ${e.message}`, 'danger');
        }
    };

    window.deleteBusinessMetric = async function (metricId, projectId, projectName) {
        if (!confirm('确定删除这条经营月报吗？')) return;
        try {
            await api.delete(`/business/metrics/${metricId}`);
            if (currentEditingBusinessMetric?.id === metricId) {
                currentEditingBusinessMetric = null;
                setBusinessMetricModalMeta(false);
                fillBusinessMetricForm(projectId, projectName || '', null);
            }
            showToast('经营月报已删除', 'success');
            await loadBusinessMetricHistory(projectId, projectName || '');
            await window.showBusinessOverview();
        } catch (e) {
            showToast(`删除失败: ${e.message}`, 'danger');
        }
    };

    window.resetBusinessMonthFilters = function () {
        const from = document.getElementById('businessMonthFrom');
        const to = document.getElementById('businessMonthTo');
        if (from) from.value = '';
        if (to) to.value = '';
        window.showBusinessOverview();
    };

    window.filterBusinessRows = function () {
        const keyword = (document.getElementById('businessSearch')?.value || '').toLowerCase();
        const marginFilter = document.getElementById('businessMarginFilter')?.value || '';
        const focusFilter = document.getElementById('businessFocusFilter')?.value || '';
        let visibleCount = 0;
        document.querySelectorAll('#businessBody .business-row').forEach(row => {
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
        const tbody = document.getElementById('businessBody');
        const emptyRow = document.getElementById('businessEmpty');
        const resultCount = document.getElementById('businessResultCount');
        if (tbody) {
            if (!visibleCount && !emptyRow) {
                const summary = [keyword, marginFilter, focusFilter].filter(Boolean).join(' / ');
                tbody.insertAdjacentHTML('beforeend', `<tr id="businessEmpty"><td colspan="9" class="empty-state">未找到匹配的经营项目${summary ? `（当前筛选：${summary}）` : ''}</td></tr>`);
            } else if (visibleCount && emptyRow) {
                emptyRow.remove();
            }
        }
        if (resultCount) {
            resultCount.textContent = `当前结果：${visibleCount} 条`;
        }
        syncBusinessFiltersToUrl();
    };

    window.resetBusinessFilters = function () {
        const input = document.getElementById('businessSearch');
        const margin = document.getElementById('businessMarginFilter');
        const focus = document.getElementById('businessFocusFilter');
        if (input) input.value = '';
        if (margin) margin.value = '';
        if (focus) focus.value = '';
        window.filterBusinessRows();
    };

    window.showBusinessReportModal = async function (projectId) {
        try {
            const data = await api.get(`/business/projects/${projectId}/summary`);
            currentBusinessReportData = data;
            initBusinessReportSelectors(data.monthly_metrics || []);
            renderBusinessReport(data);
            openModal('businessReportModal');
        } catch (e) {
            showToast(`加载经营详情失败: ${e.message}`, 'danger');
        }
    };

    window.refreshReportPreview = function () {
        if (!currentBusinessReportData) {
            showToast('请先打开一个经营详情报表', 'warning');
            return;
        }
        renderBusinessReport(currentBusinessReportData);
        showToast('经营报表预览已刷新', 'success');
    };

    window.exportReportToPdf = function () {
        const target = document.getElementById('reportPaper');
        if (!target || typeof html2pdf === 'undefined') {
            showToast('PDF 导出能力不可用', 'danger');
            return;
        }
        const projectName = document.getElementById('paperProjectName')?.textContent || '经营报表';
        html2pdf().set({
            margin: 10,
            filename: `${projectName.replace(/\s+/g, '_')}.pdf`,
            image: { type: 'jpeg', quality: 0.95 },
            html2canvas: { scale: 2, useCORS: true },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        }).from(target).save();
    };

    window.showBusinessOverview = async function () {
        currentProjectId = null;
        hideAllViews();
        document.getElementById('businessView').style.display = 'block';
        const container = document.getElementById('businessView');
        const prevFrom = document.getElementById('businessMonthFrom')?.value || '';
        const prevTo = document.getElementById('businessMonthTo')?.value || '';
        container.innerHTML = '<div class="loading-spinner">加载经营看板中...</div>';

        try {
            const query = buildBusinessQuery();
            const [financialData, businessData] = await Promise.all([
                api.get('/financial/overview'),
                api.get(`/business/overview${query ? `?${query}` : ''}`)
            ]);

            const s = financialData.summary || {};
            const bs = businessData.summary || {};
            const rankings = businessData.rankings || {};
            const riskSummary = businessData.risk_summary || {};
            const definitions = businessData.definitions || {};
            const validation = businessData.validation || {};
            const params = new URLSearchParams(window.location.search);
            const businessSummary = [params.get('business_search'), params.get('business_margin'), params.get('business_focus')].filter(Boolean).join(' / ');

            container.innerHTML = `
                <div class="detail-header" style="margin-bottom:20px;">
                    <div>
                        <h2 class="detail-title">💰 经营看板</h2>
                        <p class="detail-meta">经营口径：按月度产值、直接成本、人力成本、税费、管理成本计算净利润和净利率</p>
                        ${businessSummary ? `<div style="margin-top:6px;font-size:12px;color:#64748b;">当前筛选：${businessSummary}</div>` : ''}
                    </div>
                    <div class="btn-group">
                        <button class="btn btn-outline" onclick="showFinancialOverview()">📉 财务总览</button>
                        <button class="btn btn-outline" onclick="copyCurrentViewLink()">复制当前视图链接</button>
                        <button class="btn btn-outline" onclick="showBusinessOverview()">刷新</button>
                        <button class="btn btn-outline" onclick="showDashboard()">← 返回仪表盘</button>
                    </div>
                </div>

                <div class="panel" style="margin-bottom:20px;">
                    <div class="panel-header"><div class="panel-title">经营月份筛选</div></div>
                    <div class="panel-body">
                        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;">
                            <div class="form-group" style="margin-bottom:0;min-width:180px;">
                                <label>开始月份</label>
                                <input type="month" id="businessMonthFrom" value="${prevFrom}" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;">
                            </div>
                            <div class="form-group" style="margin-bottom:0;min-width:180px;">
                                <label>结束月份</label>
                                <input type="month" id="businessMonthTo" value="${prevTo}" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;">
                            </div>
                            <button class="btn btn-primary btn-sm" onclick="showBusinessOverview()">应用筛选</button>
                            <button class="btn btn-outline btn-sm" onclick="resetBusinessMonthFilters()">清空月份</button>
                        </div>
                    </div>
                </div>

                <div class="panel" style="margin-bottom:20px;">
                    <div class="panel-header"><div class="panel-title">财务数据快照（只读联动）</div></div>
                    <div class="panel-body">
                        <div class="dashboard-grid">
                            <div class="stat-card"><div class="stat-icon blue">📄</div><div class="stat-value">${fmtWan(s.contract_total)}</div><div class="stat-label">合同总额</div></div>
                            <div class="stat-card"><div class="stat-icon green">💵</div><div class="stat-value">${fmtWan(s.collected_total)}</div><div class="stat-label">已回款</div></div>
                            <div class="stat-card"><div class="stat-icon warning">⏳</div><div class="stat-value">${fmtWan(s.uncollected_total)}</div><div class="stat-label">未回款</div></div>
                            <div class="stat-card"><div class="stat-icon yellow">🧾</div><div class="stat-value">${fmtWan(s.reimbursed_total)}</div><div class="stat-label">已报销</div></div>
                            <div class="stat-card"><div class="stat-icon pink">👷</div><div class="stat-value">${fmtWan(s.labor_total)}</div><div class="stat-label">人力成本</div></div>
                            <div class="stat-card"><div class="stat-icon ${(s.gross_profit_total || 0) >= 0 ? 'green' : 'red'}">📈</div><div class="stat-value">${fmtWan(s.gross_profit_total)}</div><div class="stat-label">总毛利</div></div>
                            <div class="stat-card"><div class="stat-icon info">🏷️</div><div class="stat-value">${s.gross_margin || 0}%</div><div class="stat-label">综合毛利率</div></div>
                            <div class="stat-card"><div class="stat-icon ${(s.loss_projects || 0) > 0 ? 'red' : 'green'}">⚠️</div><div class="stat-value">${s.loss_projects || 0}</div><div class="stat-label">亏损项目</div></div>
                        </div>
                    </div>
                </div>

                <div class="panel" style="margin-bottom:20px;">
                    <div class="panel-header"><div class="panel-title">经营月报总览</div></div>
                    <div class="panel-body">
                        <div class="dashboard-grid">
                            <div class="stat-card"><div class="stat-icon cyan">🏭</div><div class="stat-value">${fmtWan(bs.output_value_total)}</div><div class="stat-label">累计产值</div></div>
                            <div class="stat-card"><div class="stat-icon green">💸</div><div class="stat-value">${fmtWan(bs.collected_total)}</div><div class="stat-label">累计回款</div></div>
                            <div class="stat-card"><div class="stat-icon warning">📦</div><div class="stat-value">${fmtWan(bs.direct_cost_total)}</div><div class="stat-label">直接成本</div></div>
                            <div class="stat-card"><div class="stat-icon pink">👥</div><div class="stat-value">${fmtWan(bs.labor_cost_total)}</div><div class="stat-label">人力成本</div></div>
                            <div class="stat-card"><div class="stat-icon yellow">🧮</div><div class="stat-value">${fmtWan(bs.tax_total)}</div><div class="stat-label">税费</div></div>
                            <div class="stat-card"><div class="stat-icon purple">🏢</div><div class="stat-value">${fmtWan(bs.management_cost_total)}</div><div class="stat-label">管理成本</div></div>
                            <div class="stat-card"><div class="stat-icon ${(bs.net_profit_total || 0) >= 0 ? 'green' : 'red'}">📊</div><div class="stat-value">${fmtWan(bs.net_profit_total)}</div><div class="stat-label">净利润</div></div>
                            <div class="stat-card"><div class="stat-icon info">📐</div><div class="stat-value">${bs.net_margin || 0}%</div><div class="stat-label">净利率</div></div>
                        </div>
                        <div style="margin-top:14px;padding:12px 14px;border-radius:10px;background:${(riskSummary.loss_project_count || 0) > 0 ? 'rgba(254,242,242,0.9)' : 'rgba(240,253,244,0.9)'};border:1px solid ${(riskSummary.loss_project_count || 0) > 0 ? '#fecaca' : '#bbf7d0'};font-size:13px;color:#334155;">
                            <strong>经营风险摘要：</strong>
                            亏损项目 ${(riskSummary.loss_project_count || 0)} 个，低净利项目 ${(riskSummary.low_margin_project_count || 0)} 个。
                            ${riskSummary.top_risk_hint ? `<span style="margin-left:6px;">${riskSummary.top_risk_hint}</span>` : ''}
                        </div>
                    </div>
                </div>

                <div class="panel" style="margin-bottom:20px;">
                    <div class="panel-header"><div class="panel-title">经营口径说明与数据校验</div></div>
                    <div class="panel-body">
                        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;">
                            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">
                                <div style="font-weight:700;margin-bottom:8px;color:#0f172a;">📘 指标口径说明</div>
                                ${Object.entries(definitions).map(([key, text]) => `
                                    <div style="padding:8px 0;border-bottom:1px solid #f1f5f9;">
                                        <div style="font-size:12px;font-weight:700;color:#334155;">${key}</div>
                                        <div style="font-size:12px;color:#64748b;line-height:1.6;">${text}</div>
                                    </div>
                                `).join('')}
                            </div>
                            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">
                                    <div style="font-weight:700;margin-bottom:8px;color:#0f172a;">🔎 财务联动校验</div>
                                    <div style="font-size:12px;color:#64748b;line-height:1.7;margin-bottom:8px;">财务口径来自合同、回款、报销和人力成本；经营口径来自项目月报。这里仅做差异提醒，不混用指标。</div>
                                <div style="font-size:12px;color:#64748b;line-height:1.8;">
                                    <div>经营累计回款：<strong>${fmtMoney(validation.business_collected_total)}</strong></div>
                                    <div>财务收入累计：<strong>${fmtMoney(validation.financial_revenue_total)}</strong></div>
                                    <div>经营直接成本：<strong>${fmtMoney(validation.business_direct_cost_total)}</strong></div>
                                    <div>财务已报销：<strong>${fmtMoney(validation.financial_reimbursed_total)}</strong></div>
                                    <div>经营人力成本：<strong>${fmtMoney(validation.business_labor_cost_total)}</strong></div>
                                    <div>财务人力成本：<strong>${fmtMoney(validation.financial_labor_total)}</strong></div>
                                </div>
                                <div style="margin-top:12px;padding:12px;border-radius:10px;background:${validation.status === 'warning' ? 'rgba(255,247,237,0.95)' : 'rgba(240,253,244,0.95)'};border:1px solid ${validation.status === 'warning' ? '#fed7aa' : '#bbf7d0'};">
                                    ${(validation.warnings || []).length
                                        ? validation.warnings.map(item => `<div style="font-size:12px;color:#9a3412;line-height:1.7;">${item}</div>`).join('')
                                        : '<div style="font-size:12px;color:#166534;">经营月报与财务汇总当前未发现明显口径冲突。</div>'}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="panel" style="margin-bottom:20px;">
                    <div class="panel-header"><div class="panel-title">经营排行榜</div></div>
                    <div class="panel-body">
                        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;">
                            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">
                                <div style="font-weight:700;margin-bottom:8px;color:#0f172a;">🏭 产值 Top 5</div>
                                ${renderRankingList(rankings.top_output_projects, 'output_value_total', '暂无产值排行数据')}
                            </div>
                            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">
                                <div style="font-weight:700;margin-bottom:8px;color:#0f172a;">📈 净利润 Top 5</div>
                                ${renderRankingList(rankings.top_profit_projects, 'net_profit_total', '暂无净利润排行数据')}
                            </div>
                            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">
                                <div style="font-weight:700;margin-bottom:8px;color:#0f172a;">⚠️ 亏损项目 Top 5</div>
                                ${renderRankingList(rankings.loss_projects, 'net_profit_total', '暂无亏损项目')}
                            </div>
                        </div>
                    </div>
                </div>

                <div class="panel" style="margin-bottom:20px;">
                    <div class="panel-header"><div class="panel-title">财务快照与经营月报趋势</div></div>
                    <div class="panel-body">
                        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;">
                            <div id="businessFinanceTrendChart" style="height:320px;"></div>
                            <div id="businessFinanceProfitChart" style="height:320px;"></div>
                            <div id="businessTrendChart" style="height:320px;"></div>
                        </div>
                    </div>
                </div>

                <div class="panel">
                    <div class="panel-header"><div class="panel-title">项目经营明细</div></div>
                    <div class="panel-body">
                        <div style="margin-bottom:12px;font-size:13px;color:#64748b;">可按项目、医院、毛利率和经营风险筛选，并直接补录经营月报。</div>
                        <div id="businessResultCount" style="margin-bottom:12px;font-size:12px;color:#64748b;">当前结果：${(financialData.projects || []).length} 条</div>
                        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
                            <input id="businessSearch" type="text" placeholder="搜索项目 / 医院" oninput="filterBusinessRows()" style="flex:1;min-width:240px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;">
                            <select id="businessMarginFilter" onchange="filterBusinessRows()" style="width:180px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;">
                                <option value="">全部毛利率</option>
                                <option value="high">高毛利 (>=20%)</option>
                                <option value="mid">中毛利 (0-20%)</option>
                                <option value="low">负毛利 (&lt;0%)</option>
                            </select>
                            <select id="businessFocusFilter" onchange="filterBusinessRows()" style="width:180px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;">
                                <option value="">全部项目</option>
                                <option value="uncollected">只看未回款</option>
                                <option value="loss">只看亏损项目</option>
                            </select>
                            <button class="btn btn-outline btn-sm" onclick="resetBusinessFilters()">清空筛选</button>
                        </div>
                        <div class="table-container">
                            <table class="table" id="businessTable">
                                <thead><tr><th>项目</th><th>医院</th><th>合同额</th><th>已回款</th><th>报销</th><th>人力成本</th><th>毛利</th><th>毛利率</th><th>经营月报</th></tr></thead>
                                <tbody id="businessBody">
                                    ${(financialData.projects || []).map(p => {
                                        const uncollected = Number(p.contract_amount || 0) - Number(p.collected_amount || 0);
                                        const rowBg = (p.margin || 0) < 0 ? 'background:rgba(254,242,242,0.85);'
                                            : uncollected > 0 ? 'background:rgba(255,247,237,0.85);'
                                            : (p.margin || 0) >= 20 ? 'background:rgba(240,253,244,0.85);' : '';
                                        return `<tr class="business-row" data-name="${(p.project_name || '').toLowerCase()}" data-hospital="${(p.hospital_name || '').toLowerCase()}" data-margin="${p.margin || 0}" data-uncollected="${uncollected}" data-loss="${(p.gross_profit || 0) < 0 ? 1 : 0}" style="${rowBg}">
                                            <td style="cursor:pointer;" onclick="loadProjectDetail(${p.id})">${p.project_name}</td>
                                            <td style="cursor:pointer;" onclick="loadProjectDetail(${p.id})">${p.hospital_name || '-'}</td>
                                            <td>¥${Number(p.contract_amount || 0).toLocaleString()}</td>
                                            <td>¥${Number(p.collected_amount || 0).toLocaleString()}</td>
                                            <td>¥${Number(p.reimbursed_amount || 0).toLocaleString()}</td>
                                            <td>¥${Number(p.labor_cost || 0).toLocaleString()}</td>
                                            <td style="color:${(p.gross_profit || 0) >= 0 ? '#059669' : '#dc2626'};font-weight:700;">¥${Number(p.gross_profit || 0).toLocaleString()}</td>
                                            <td><span class="badge ${(p.margin || 0) >= 20 ? 'badge-success' : (p.margin || 0) >= 0 ? 'badge-warning' : 'badge-danger'}">${p.margin || 0}%</span></td>
                                            <td style="display:flex;gap:6px;flex-wrap:wrap;">
                                                <button class="btn btn-outline btn-xs" onclick="openBusinessMetricModal(${p.id}, '${escapeJsText(p.project_name)}')">维护月报</button>
                                                <button class="btn btn-outline btn-xs" onclick="showBusinessReportModal(${p.id})">经营详情</button>
                                            </td>
                                        </tr>`;
                                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            `;

            hydrateBusinessFiltersFromUrl();
            window.filterBusinessRows();

            setTimeout(() => {
                const fTrend = financialData.monthly_trend || [];
                const fMonths = fTrend.map(i => i.month);
                const collected = fTrend.map(i => i.collected);
                const reimbursed = fTrend.map(i => i.reimbursed);
                const labor = fTrend.map(i => i.labor_cost);
                const profit = fTrend.map(i => i.gross_profit);

                const bTrend = businessData.monthly_trend || [];
                const bMonths = bTrend.map(i => i.metric_month);
                const outputValue = bTrend.map(i => i.output_value);
                const directCost = bTrend.map(i => i.direct_cost);
                const netProfit = bTrend.map(i => i.net_profit);

                const trendChart = echarts.init(document.getElementById('businessFinanceTrendChart'));
                trendChart.setOption({
                    tooltip: { trigger: 'axis' },
                    legend: { data: ['回款', '报销', '人力成本'], bottom: 0 },
                    grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
                    xAxis: { type: 'category', data: fMonths },
                    yAxis: { type: 'value', axisLabel: { formatter: (v) => `¥${(v / 10000).toFixed(1)}w` } },
                    series: [
                        { name: '回款', type: 'line', smooth: true, data: collected, itemStyle: { color: '#16a34a' } },
                        { name: '报销', type: 'line', smooth: true, data: reimbursed, itemStyle: { color: '#f59e0b' } },
                        { name: '人力成本', type: 'line', smooth: true, data: labor, itemStyle: { color: '#ec4899' } }
                    ],
                    graphic: !fMonths.length ? [{ type: 'text', left: 'center', top: 'middle', style: { text: '暂无财务趋势数据', fill: '#94a3b8', fontSize: 16 } }] : []
                });

                const profitChart = echarts.init(document.getElementById('businessFinanceProfitChart'));
                profitChart.setOption({
                    tooltip: { trigger: 'axis' },
                    grid: { left: '3%', right: '4%', bottom: '10%', containLabel: true },
                    xAxis: { type: 'category', data: fMonths },
                    yAxis: { type: 'value', axisLabel: { formatter: (v) => `¥${(v / 10000).toFixed(1)}w` } },
                    series: [{
                        name: '月度毛利',
                        type: 'bar',
                        data: profit,
                        itemStyle: { color: params => params.value >= 0 ? '#3b82f6' : '#ef4444' }
                    }],
                    graphic: !fMonths.length ? [{ type: 'text', left: 'center', top: 'middle', style: { text: '暂无月度毛利数据', fill: '#94a3b8', fontSize: 16 } }] : []
                });

                const businessChart = echarts.init(document.getElementById('businessTrendChart'));
                businessChart.setOption({
                    tooltip: { trigger: 'axis' },
                    legend: { data: ['产值', '直接成本', '净利润'], bottom: 0 },
                    grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
                    xAxis: { type: 'category', data: bMonths },
                    yAxis: { type: 'value', axisLabel: { formatter: (v) => `¥${(v / 10000).toFixed(1)}w` } },
                    series: [
                        { name: '产值', type: 'bar', data: outputValue, itemStyle: { color: '#0ea5a4' } },
                        { name: '直接成本', type: 'bar', data: directCost, itemStyle: { color: '#f97316' } },
                        { name: '净利润', type: 'line', smooth: true, data: netProfit, itemStyle: { color: '#7c3aed' } }
                    ],
                    graphic: !bMonths.length ? [{ type: 'text', left: 'center', top: 'middle', style: { text: '暂无经营月报数据', fill: '#94a3b8', fontSize: 16 } }] : []
                });

                window.addEventListener('resize', () => {
                    trendChart.resize();
                    profitChart.resize();
                    businessChart.resize();
                });
            }, 100);
        } catch (e) {
            container.innerHTML = `
                <div class="detail-header" style="margin-bottom:20px;">
                    <div>
                        <h2 class="detail-title">💰 经营看板</h2>
                        <p class="detail-meta">经营口径：按月度产值、直接成本、人力成本、税费、管理成本计算净利润和净利率</p>
                    </div>
                    <div class="btn-group">
                        <button class="btn btn-outline" onclick="showFinancialOverview()">📉 财务总览</button>
                        <button class="btn btn-outline" onclick="copyCurrentViewLink()">复制当前视图链接</button>
                        <button class="btn btn-outline" onclick="showBusinessOverview()">刷新</button>
                        <button class="btn btn-outline" onclick="showDashboard()">← 返回仪表盘</button>
                    </div>
                </div>
                <div class="empty-state"><p>加载经营看板失败: ${e.message}</p></div>
            `;
        }
    };
})();
