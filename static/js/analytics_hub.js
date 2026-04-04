// Analytics and forecasting helpers extracted from main.js

async function showRiskTrend(projectId) {
    let modal = document.getElementById('riskTrendModal');
    if (!modal) {
        const html = `
            <div class="modal" id="riskTrendModal" style="z-index:10002;">
                <div class="modal-content" style="max-width:900px;">
                    <div class="modal-header">
                        <h3>📈 项目风险与效能趋势</h3>
                        <button class="modal-close" onclick="closeModal('riskTrendModal')">&times;</button>
                    </div>
                    <div class="modal-body" style="padding:20px;">
                        <div id="riskTrendChart" style="width:100%;height:400px;"></div>
                        <div style="margin-top:20px;display:flex;justify-content:space-between;color:var(--gray-500);font-size:12px;">
                            <span>* 风险评分：0-100，越高风险越大</span>
                            <span>* Velocity：过去4周每周完成任务数</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);
        modal = document.getElementById('riskTrendModal');
    }

    currentProjectId = projectId;
    openModal('riskTrendModal');
    const chartDom = document.getElementById('riskTrendChart');

    if (!projectId || projectId === 'undefined' || projectId === 'null') {
        chartDom.innerHTML = `<div class="empty-state"><p class="text-danger">❌ 无效的项目 ID，无法加载趋势分析</p></div>`;
        return;
    }

    chartDom.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>正在分析趋势数据...</p></div>';

    try {
        const res = await api.get(`/projects/${projectId}/risk-trends`);
        const chartData = res.data || res;

        if (res.error) {
            chartDom.innerHTML = `<div class="empty-state"><p>无法获取趋势数据: ${res.error}</p></div>`;
            return;
        }

        if (!chartData || (!chartData.dates && !chartData.velocity)) {
            chartDom.innerHTML = `<div class="empty-state"><p>暂无趋势数据</p></div>`;
            return;
        }

        renderRiskTrendChart('riskTrendChart', chartData);
    } catch (e) {
        chartDom.innerHTML = `<div class="empty-state"><p>加载失败: ${e.message}</p></div>`;
    }
}

function renderRiskTrendChart(containerId, data) {
    const chartDom = document.getElementById(containerId);
    if (!chartDom) return;

    setTimeout(() => {
        echarts.dispose(chartDom);
        chartDom.innerHTML = '';

        if (chartDom.clientWidth === 0 || chartDom.clientHeight === 0) {
            console.warn('Chart container has no dimensions, skipping render');
            chartDom.innerHTML = '<div class="empty-state"><p>图表尺寸异常，请刷新重试</p></div>';
            return;
        }

        const myChart = echarts.init(chartDom);
        const option = {
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross' }
            },
            legend: {
                data: ['风险评分', '情感评分 (负向)', '交付速度 (Velocity)', '活跃问题']
            },
            grid: {
                left: '3%', right: '4%', bottom: '3%', containLabel: true
            },
            xAxis: [{
                type: 'category',
                data: (data.dates && data.dates.length > 0) ? data.dates : ((data.velocity && Array.isArray(data.velocity)) ? data.velocity.map(v => v.week_start) : []),
                axisPointer: { type: 'shadow' }
            }],
            yAxis: [
                {
                    type: 'value',
                    name: '评分',
                    min: 0, max: 100,
                    position: 'left',
                    axisLine: { show: true, lineStyle: { color: '#ef4444' } },
                    axisLabel: { formatter: '{value}' }
                },
                {
                    type: 'value',
                    name: '计数',
                    min: 0,
                    position: 'right',
                    axisLine: { show: true, lineStyle: { color: '#3b82f6' } },
                    axisLabel: { formatter: '{value}' }
                }
            ],
            series: [
                {
                    name: '风险评分',
                    type: 'line',
                    data: data.risk_scores || [],
                    smooth: true,
                    itemStyle: { color: '#ef4444' },
                    lineStyle: { width: 3 }
                },
                {
                    name: '交付速度 (Velocity)',
                    type: 'bar',
                    yAxisIndex: 1,
                    data: (data.velocity && Array.isArray(data.velocity)) ? data.velocity.map(v => v.count) : [],
                    itemStyle: { color: '#3b82f6', opacity: 0.6 },
                    barMaxWidth: 30
                },
                {
                    name: '活跃问题',
                    type: 'bar',
                    yAxisIndex: 1,
                    data: (data.issue_trend && Array.isArray(data.issue_trend)) ? data.issue_trend.map(i => (i.created || 0) - (i.resolved || 0)) : [],
                    itemStyle: { color: '#f59e0b', opacity: 0.6 },
                    barMaxWidth: 30
                }
            ]
        };

        myChart.setOption(option);
        window.addEventListener('resize', () => myChart.resize());
        loadSentimentAnalysis(currentProjectId || (data && data.project_id));
    }, 200);
}

async function loadProjectPrediction(projectId) {
    const dateEl = document.getElementById('predictedEndDate');
    if (!dateEl) return;

    try {
        const data = await api.get(`/projects/${projectId}/predict`);
        if (data) {
            window.currentPrediction = data;
            dateEl.textContent = data.predicted_end_date || '未知';

            if (data.is_delay_predicted) {
                dateEl.style.color = '#ef4444';
                const card = document.getElementById('predictionCard');
                if (card) {
                    card.style.background = '#fff1f2';
                    card.style.borderColor = '#fecdd3';
                }
                dateEl.innerHTML = `${data.predicted_end_date} <span style="font-size:12px; display:block; color:#ef4444;">⚠️ 预计延期 ${data.delay_days} 天</span>`;
            }
        } else {
            dateEl.textContent = '无法预测';
        }
    } catch (e) {
        dateEl.textContent = '无法预测';
    }
}

function showPredictionDetail() {
    const data = window.currentPrediction;
    if (!data) return;

    const content = `
        <div style="padding:10px;">
            <div style="display:flex; gap:20px; margin-bottom:20px;">
                <div style="flex:1; padding:15px; background:#f8fafc; border-radius:8px; text-align:center;">
                    <div style="color:#64748b; font-size:12px;">当前进度</div>
                    <div style="font-size:24px; font-weight:bold; color:#0f172a;">${data.current_progress}%</div>
                </div>
                <div style="flex:1; padding:15px; background:#f0f9ff; border-radius:8px; text-align:center;">
                    <div style="color:#0369a1; font-size:12px;">交付速度 (Velocity)</div>
                    <div style="font-size:24px; font-weight:bold; color:#0c4a6e;">${data.avg_velocity}%<span style="font-size:12px;">/日</span></div>
                </div>
            </div>
            
            <div style="margin-bottom:15px; padding:15px; border-radius:8px; background:#ffffff; border:1px solid #e2e8f0; border-left:4px solid ${data.is_delay_predicted ? '#ef4444' : '#10b981'};">
                <div style="font-weight:600; font-size:16px;">📅 交付模拟预测</div>
                <div style="margin-top:10px; display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                    <div>计划结项: <span style="font-weight:500;">${data.plan_end_date || '未设置'}</span></div>
                    <div>预计结项: <span style="font-weight:500; color:${data.is_delay_predicted ? '#ef4444' : '#10b981'}">${data.predicted_end_date}</span></div>
                </div>
                ${data.is_delay_predicted ? `<div style="margin-top:10px; color:#ef4444; background:#fef2f2; padding:8px; border-radius:4px; font-size:13px;">
                    🚩 <strong>预警:</strong> 按照当前交付速度，项目将晚于计划日期 <strong>${data.delay_days}</strong> 天交付。
                </div>` : '<div style="margin-top:10px; color:#10b981; font-size:13px;">✅ <b>安全:</b> 目前进度符合预期，能按时交付。</div>'}
            </div>
            
            <div style="padding:15px; border-radius:8px; background:#ffffff; border:1px solid #e2e8f0; border-left:4px solid ${data.is_sentiment_dropping ? '#f59e0b' : '#3b82f6'};">
                <div style="font-weight:600; font-size:16px;">🎭 情绪与稳定性分析</div>
                <div style="margin-top:10px;">
                    平均情绪评分: <span style="font-weight:bold;">${data.sentiment_score}</span> / 100
                    ${data.is_sentiment_dropping ? '<div style="color:#b45309; font-size:13px; margin-top:5px;">⚠️ <strong>趋势预警:</strong> 近期工作日志情绪出现下滑倾向，可能存在团队疲劳或甲方协同卡点。</div>' : ''}
                </div>
            </div>
        </div>
    `;

    showGenericModal('🔮 AI 交付预测与风险预判', content);
}

async function loadProjectFinancials(projectId) {
    const container = document.getElementById('financialsContent');
    if (!container) return;

    container.innerHTML = '<div class="loading-spinner"></div>';

    try {
        const data = await api.get(`/projects/${projectId}/financials`);
        if (data.error) throw new Error(data.error);
        renderFinancialOverview(data, container);
    } catch (e) {
        container.innerHTML = `<div class="error-state">无法加载财务数据: ${e.message}</div>`;
    }
}

function renderFinancialOverview(data, container) {
    container.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px;">
            <div class="overview-card" style="background: #f0fdf4; border: 1px solid #bbf7d0;">
                <div class="overview-card-title" style="color: #15803d;">总收入 (Revenue)</div>
                <div class="overview-card-value" style="color: #166534;">¥${data.revenue.toLocaleString()}</div>
            </div>
            <div class="overview-card" style="background: #fff1f2; border: 1px solid #fecdd3;">
                <div class="overview-card-title" style="color: #b91c1c;">人力成本 (Labor)</div>
                <div class="overview-card-value" style="color: #991b1b;">¥${data.labor_cost.toLocaleString()}</div>
            </div>
            <div class="overview-card" style="background: #fff7ed; border: 1px solid #ffedd5;">
                <div class="overview-card-title" style="color: #c2410c;">直接支出 (Expenses)</div>
                <div class="overview-card-value" style="color: #9a3412;">¥${data.expenses.toLocaleString()}</div>
            </div>
            <div class="overview-card" style="background: ${data.gross_profit >= 0 ? '#eff6ff' : '#fef2f2'}; border: 1px solid ${data.gross_profit >= 0 ? '#dbeafe' : '#fee2e2'};">
                <div class="overview-card-title" style="color: ${data.gross_profit >= 0 ? '#1d4ed8' : '#991b1b'};">项目毛利 (Profit)</div>
                <div class="overview-card-value" style="color: ${data.gross_profit >= 0 ? '#1e40af' : '#7f1d1d'};">
                    ¥${data.gross_profit.toLocaleString()}
                    <span style="font-size: 11px; display: block; font-weight: 500; opacity: 0.7;">毛利率: ${data.margin}%</span>
                </div>
            </div>
        </div>

        <div style="display: flex; gap: 24px; flex-wrap: wrap;">
            <div class="panel" style="flex: 2; min-width: 400px; border: 1px solid #f1f5f9; box-shadow: none;">
                <div class="panel-header" style="background: transparent; border-bottom: 1px solid #f8fafc;">
                    <div class="panel-title" style="font-size: 13px; color: #64748b;">财务瀑布图 (Financial Waterfall)</div>
                </div>
                <div class="panel-body">
                    <div id="financialWaterfallChart" style="height: 350px;"></div>
                </div>
            </div>
            <div class="panel" style="flex: 1; min-width: 300px; border: 1px solid #f1f5f9; box-shadow: none;">
                <div class="panel-header" style="background: transparent; border-bottom: 1px solid #f8fafc;">
                    <div class="panel-title" style="font-size: 13px; color: #64748b;">成员成本贡献</div>
                </div>
                <div class="panel-body" id="memberCostTable" style="max-height: 350px; overflow-y: auto;">
                    <div class="loading-spinner"></div>
                </div>
            </div>
        </div>
    `;

    renderFinancialWaterfall(data.waterfall_data);
    loadMemberCosts(data.project_id);
}

function renderFinancialWaterfall(data) {
    const chartDom = document.getElementById('financialWaterfallChart');
    if (!chartDom) return;
    const myChart = echarts.init(chartDom);

    const xAxisData = data.map(item => item.name);
    const seriesData = [];
    const helpData = [];
    let total = 0;

    for (let i = 0; i < data.length; i++) {
        const val = data[i].value;
        if (data[i].isTotal) {
            helpData.push(0);
            seriesData.push(val);
        } else {
            if (val >= 0) {
                helpData.push(total);
                seriesData.push(val);
                total += val;
            } else {
                total += val;
                helpData.push(total);
                seriesData.push(-val);
            }
        }
    }

    myChart.setOption({
        grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
        xAxis: { type: 'category', splitLine: { show: false }, data: xAxisData },
        yAxis: { type: 'value' },
        series: [
            {
                name: 'Placeholder',
                type: 'bar',
                stack: 'Total',
                itemStyle: { borderColor: 'transparent', color: 'transparent' },
                emphasis: { itemStyle: { borderColor: 'transparent', color: 'transparent' } },
                data: helpData
            },
            {
                name: 'Amount',
                type: 'bar',
                stack: 'Total',
                label: { show: true, position: 'inside' },
                data: seriesData,
                itemStyle: {
                    color: function (params) {
                        const idx = params.dataIndex;
                        if (data[idx].isTotal) return '#6366f1';
                        return data[idx].value >= 0 ? '#22c55e' : '#ef4444';
                    }
                }
            }
        ]
    });

    window.addEventListener('resize', () => myChart.resize());
}

async function loadProjectSlaCountdown(projectId) {
    try {
        const res = await api.get(`/risk/countdown/${projectId}`);
        if (res) {
            updateSlaCountdown(res);
        }
    } catch (e) {
        console.error('Prediction failed', e);
    }
}

function updateSlaCountdown(data) {
    const parent = document.querySelector('.risk-info-panel');
    if (!parent) return;

    const old = document.getElementById('slaCountdownWidget');
    if (old) old.remove();

    const widget = document.createElement('div');
    widget.id = 'slaCountdownWidget';
    widget.style.cssText = `
        margin-left:8px; display:inline-flex; align-items:center; gap:8px; 
        padding-left:12px; border-left:1px solid #cbd5e1;
    `;

    let statusHtml = '';
    if (data.is_delay_predicted) {
        statusHtml = `
            <div style="display:flex; flex-direction:column; align-items:flex-end;">
                <span style="color:#ef4444; font-weight:800; font-size:13px;">🚨 逻辑违约风险 (${data.delay_days}天)</span>
                <span style="color:#94a3b8; font-size:10px;">预测完工位: ${data.predicted_end_date}</span>
            </div>
        `;
    } else {
        const daysLabel = data.remaining_days_to_plan > 0 ? `剩 ${data.remaining_days_to_plan} 天` : '今日交付';
        const color = data.remaining_days_to_plan < 7 ? '#f97316' : '#64748b';
        statusHtml = `
            <div style="display:flex; flex-direction:column; align-items:flex-end;">
                <span style="color:${color}; font-weight:700; font-size:13px;">⌛ SLA 倒计时: ${daysLabel}</span>
                <span style="color:#94a3b8; font-size:10px;">交付安全垫: ${Math.abs(data.remaining_days_to_plan)} 天</span>
            </div>
        `;
    }

    widget.innerHTML = statusHtml;
    parent.appendChild(widget);
}

async function loadMemberCosts(projectId) {
    const container = document.getElementById('memberCostTable');
    if (!container) return;

    try {
        const data = await api.get(`/projects/${projectId}/financial-costs`);
        if (!data || data.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding:20px; color:#94a3b8;">暂无人力成本数据</div>';
            return;
        }

        let html = '<table class="table table-sm"><thead><tr><th>成员</th><th>累计成本</th></tr></thead><tbody>';
        data.forEach(m => {
            html += `<tr><td>${m.name}</td><td>¥${m.cost.toLocaleString()}</td></tr>`;
        });
        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = '加载失败';
    }
}

function showRevenueModal(projectId) {
    const formEl = document.getElementById('revenueForm');
    if (formEl) formEl.reset();

    const pIdEl = document.getElementById('revenueProjectId');
    if (pIdEl) pIdEl.value = projectId;

    document.getElementById('revenueAmount').value = '';
    document.getElementById('revenueDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('revenueDescription').value = '';
    openModal('revenueModal', { reset: false });
}

async function submitRevenue(event) {
    event.preventDefault();
    const projectId = document.getElementById('revenueProjectId').value;
    const amount = document.getElementById('revenueAmount').value;
    const revenueDate = document.getElementById('revenueDate').value;
    const revenueType = document.getElementById('revenueType').value;
    const description = document.getElementById('revenueDescription').value;
    const submitBtn = event?.submitter || document.querySelector('#revenueForm button[type="submit"]');
    const originalText = submitBtn ? submitBtn.textContent : '';

    if (!projectId) {
        showToast('缺少项目信息，请重新打开收入录入窗口', 'danger');
        return;
    }
    if (!amount || Number(amount) <= 0) {
        showToast('请输入有效的收入金额', 'warning');
        return;
    }
    if (!revenueDate) {
        showToast('请选择收入日期', 'warning');
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '录入中...';
    }

    try {
        await api.post(`/projects/${projectId}/revenue`, {
            amount: parseFloat(amount),
            revenue_date: revenueDate,
            revenue_type: revenueType,
            description: description
        });
        showToast('收入录入成功', 'success');
        closeModal('revenueModal');
        if (typeof loadProjectFinancials === 'function') {
            loadProjectFinancials(projectId);
        }
    } catch (e) {
        console.error(e);
        showToast('录入失败: ' + e.message, 'danger');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    }
}
