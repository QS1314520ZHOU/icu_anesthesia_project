/**
 * 绩效分析模块
 */

async function initPerformanceAnalytics() {
    const container = document.getElementById('analyticsView');
    container.innerHTML = `
        <div class="panel">
            <div class="panel-header">
                <div class="panel-title">🏅 团队交付绩效看板</div>
                <div class="btn-group">
                    <button class="btn btn-outline btn-sm" onclick="initPerformanceAnalytics()">🔄 刷新</button>
                </div>
            </div>
            <div class="panel-body">
                <div id="performanceChart" style="width: 100%; height: 400px; margin-bottom: 30px;"></div>
                
                <div class="table-container">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>人员</th>
                                <th>完工阶段数</th>
                                <th>阶段奖金 (总)</th>
                                <th>出差成本 (总)</th>
                                <th>净绩效</th>
                                <th>绩效等级</th>
                            </tr>
                        </thead>
                        <tbody id="performanceTableBody">
                            <tr><td colspan="6" style="text-align:center;">正在加载数据...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <div class="panel" style="margin-top:20px;">
            <div class="panel-header">
                <div class="panel-title">👥 人员负载与风险分布</div>
            </div>
            <div class="panel-body" style="display:flex; gap:20px; flex-wrap:wrap;">
                <div id="workloadChart" style="flex:1; min-width:300px; height:350px;"></div>
                <div id="riskDistChart" style="flex:1; min-width:300px; height:350px;"></div>
            </div>
        </div>

    `;

    try {
        const [perfRes, workloadRes] = await Promise.all([
            api.get('/analytics/performance'),
            api.get('/analytics/workload')
        ]);

        const data = perfRes;

        if (data.length === 0) {
            document.getElementById('performanceTableBody').innerHTML = '<tr><td colspan="6" style="text-align:center;">暂无已完成阶段的绩效数据</td></tr>';
        } else {
            // 渲染图表
            renderPerformanceChart(data);

            // 渲染表格
            const tbody = document.getElementById('performanceTableBody');
            tbody.innerHTML = data.map(item => {
                let badgeClass = 'badge-gray';
                let rank = 'C';
                if (item.net_performance > 10000) { rank = 'S'; badgeClass = 'badge-success'; }
                else if (item.net_performance > 5000) { rank = 'A'; badgeClass = 'badge-info'; }
                else if (item.net_performance > 0) { rank = 'B'; badgeClass = 'badge-warning'; }

                return `
                    <tr>
                        <td><b>${item.name}</b></td>
                        <td>${item.stage_count}</td>
                        <td><span style="color:var(--success)">+￥${item.total_bonus.toLocaleString()}</span></td>
                        <td><span style="color:var(--danger)">-￥${item.total_expense.toLocaleString()}</span></td>
                        <td><b style="color:var(--primary)">￥${item.net_performance.toLocaleString()}</b></td>
                        <td><span class="badge ${badgeClass}">${rank} 级</span></td>
                    </tr>
                `;
            }).join('');
        }

        renderWorkloadCharts(workloadRes);

    } catch (e) {
        console.error('分析数据加载失败', e);
    }
}

function renderWorkloadCharts(data) {
    // 渲染人员负载图
    const workloadDom = document.getElementById('workloadChart');
    const workloadChart = echarts.init(workloadDom);
    workloadChart.setOption({
        title: { text: '人员负载 (活跃项目数)', left: 'center' },
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: data.workload.map(w => w.name) },
        yAxis: { type: 'value' },
        series: [{
            data: data.workload.map(w => w.active_projects),
            type: 'bar',
            itemStyle: { color: '#6366f1' }
        }]
    });

    // 渲染风险分布图
    const riskDom = document.getElementById('riskDistChart');
    const riskChart = echarts.init(riskDom);
    riskChart.setOption({
        title: { text: '全量项目风险分布', left: 'center' },
        tooltip: { trigger: 'item' },
        series: [{
            type: 'pie',
            radius: '50%',
            data: data.risk_distribution.map(r => ({ value: r.count, name: r.risk_level })),
            emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.5)' } },
            color: ['#10b981', '#f59e0b', '#ef4444']
        }]
    });

    window.addEventListener('resize', () => {
        workloadChart.resize();
        riskChart.resize();
    });
}


function renderPerformanceChart(data) {
    const chartDom = document.getElementById('performanceChart');
    const myChart = echarts.init(chartDom);

    const names = data.map(d => d.name);
    const bonuses = data.map(d => d.total_bonus);
    const expenses = data.map(d => d.total_expense);
    const net = data.map(d => d.net_performance);

    const option = {
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' }
        },
        legend: {
            data: ['阶段奖金', '出差成本', '净绩效']
        },
        grid: {
            left: '3%',
            right: '4%',
            bottom: '3%',
            containLabel: true
        },
        xAxis: { type: 'value' },
        yAxis: { type: 'category', data: names },
        series: [
            {
                name: '阶段奖金',
                type: 'bar',
                stack: 'total',
                label: { show: false },
                emphasis: { focus: 'series' },
                data: bonuses,
                itemStyle: { color: '#10b981' }
            },
            {
                name: '出差成本',
                type: 'bar',
                stack: 'total',
                label: { show: false },
                emphasis: { focus: 'series' },
                data: expenses.map(v => -v),
                itemStyle: { color: '#ef4444' }
            },
            {
                name: '净绩效',
                type: 'line',
                data: net,
                itemStyle: { color: '#4f46e5' },
                lineStyle: { width: 3 }
            }
        ]
    };

    myChart.setOption(option);
    window.addEventListener('resize', () => myChart.resize());
}
