// Gantt and timeline helpers extracted from main.js

function renderGanttLegend(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = STAGE_NAMES.map(name => `
        <div class="gantt-legend-item">
            <div class="gantt-legend-color" style="background:${STAGE_COLORS[name]}"></div>
            <span>${name}</span>
        </div>
    `).join('');
}

async function renderProjectGantt(project) {
    const chartDom = document.getElementById('projectGanttChart');
    if (!chartDom) return;

    const existingInstance = echarts.getInstanceByDom(chartDom);
    if (existingInstance) {
        echarts.dispose(existingInstance);
    }

    chartDom.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>正在生成任务时间轴...</p></div>';

    try {
        const ganttTasks = await api.get(`/projects/${project.id}/gantt-data`, { silent: true });
        if (!ganttTasks || ganttTasks.length === 0) {
            chartDom.innerHTML = '<div class="empty-state"><p>暂无详细任务时间数据</p></div>';
            return;
        }

        if (!document.getElementById('projectGanttChart')) return;
        chartDom.innerHTML = '';

        const myChart = echarts.init(chartDom);
        const categories = ganttTasks.map(t => t.name);
        const seriesData = [];
        const milestoneData = [];
        let minDate = null, maxDate = null;

        ganttTasks.forEach((t, idx) => {
            const start = new Date(t.start);
            const end = new Date(t.end);
            if (!minDate || start < minDate) minDate = start;
            if (!maxDate || end > maxDate) maxDate = end;

            const color = STAGE_COLORS[project.stages[0]?.stage_name] || '#5B8FF9';
            seriesData.push({
                name: t.name,
                value: [idx, start.getTime(), end.getTime(), t.progress, t.id],
                itemStyle: { color, borderRadius: 4 }
            });
        });

        if (project.milestones) {
            project.milestones.forEach(m => {
                const date = new Date(m.target_date);
                if (!minDate || date < minDate) minDate = date;
                if (!maxDate || date > maxDate) maxDate = date;
                milestoneData.push({
                    name: m.name,
                    value: [date.getTime(), 0],
                    itemStyle: { color: m.is_completed ? '#10b981' : '#f59e0b' }
                });
            });
        }

        const today = new Date().getTime();
        myChart.setOption({
            tooltip: {
                formatter: params => {
                    if (params.seriesType === 'custom') {
                        const start = new Date(params.value[1]).toLocaleDateString('zh-CN');
                        const end = new Date(params.value[2]).toLocaleDateString('zh-CN');
                        return `<div style="padding:8px;"><div style="font-weight:600;margin-bottom:8px;">${params.name}</div><div style="color:#666;font-size:12px;">工期: ${start} ~ ${end}</div><div style="color:#666;font-size:12px;">完成进度: ${params.value[3]}%</div></div>`;
                    }
                    if (params.seriesType === 'scatter') {
                        return `<div style="padding:8px;"><div style="font-weight:600;color:#f59e0b;">🎯 里程碑: ${params.name}</div><div style="color:#666;font-size:12px;">截止日期: ${new Date(params.value[0]).toLocaleDateString('zh-CN')}</div></div>`;
                    }
                }
            },
            grid: { left: '160', right: '40', top: '40', bottom: '40' },
            xAxis: {
                type: 'time',
                min: minDate ? minDate.getTime() - 86400000 * 3 : undefined,
                max: maxDate ? maxDate.getTime() + 86400000 * 3 : undefined,
                axisLabel: { formatter: value => { const d = new Date(value); return `${d.getMonth() + 1}-${d.getDate()}`; } },
                splitLine: { show: true, lineStyle: { color: 'rgba(0,0,0,0.05)' } }
            },
            yAxis: {
                type: 'category',
                data: categories,
                inverse: true,
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: { fontSize: 11, color: '#333', width: 140, overflow: 'truncate' }
            },
            series: [
                {
                    type: 'custom',
                    renderItem: (params, apiRef) => {
                        const categoryIndex = apiRef.value(0);
                        const start = apiRef.coord([apiRef.value(1), categoryIndex]);
                        const end = apiRef.coord([apiRef.value(2), categoryIndex]);
                        const height = 18;
                        const progress = apiRef.value(3);
                        const rectShape = echarts.graphic.clipRectByRect({
                            x: start[0],
                            y: start[1] - height / 2,
                            width: Math.max(end[0] - start[0], 2),
                            height
                        }, {
                            x: params.coordSys.x,
                            y: params.coordSys.y,
                            width: params.coordSys.width,
                            height: params.coordSys.height
                        });
                        return rectShape && {
                            type: 'group',
                            children: [
                                { type: 'rect', shape: rectShape, style: { fill: apiRef.visual('color'), opacity: 0.15 } },
                                { type: 'rect', shape: { x: rectShape.x, y: rectShape.y, width: rectShape.width * progress / 100, height: rectShape.height }, style: { fill: apiRef.visual('color') } }
                            ]
                        };
                    },
                    encode: { x: [1, 2], y: 0 },
                    data: seriesData
                },
                {
                    type: 'scatter',
                    symbol: 'diamond',
                    symbolSize: 12,
                    data: milestoneData,
                    zlevel: 5,
                    label: { show: true, position: 'right', formatter: '{b}', fontSize: 10, color: '#666' }
                },
                {
                    type: 'line',
                    markLine: {
                        silent: true,
                        symbol: 'none',
                        lineStyle: { color: '#ff4d4f', type: 'dashed', width: 1.5 },
                        data: [{ xAxis: today }],
                        label: { formatter: '今天', position: 'start', color: '#ff4d4f', fontSize: 10 }
                    }
                }
            ]
        });

        myChart.on('click', function (params) {
            if (params.seriesType === 'custom') {
                const stageId = params.value[4];
                const tabs = document.querySelectorAll('.tabs .tab');
                const stagesTab = Array.from(tabs).find(t => t.innerText.includes('阶段'));
                if (stagesTab) {
                    stagesTab.click();
                    setTimeout(() => {
                        const stageEl = document.getElementById(`stage-${stageId}`);
                        if (stageEl) {
                            stageEl.scrollIntoView({ behavior: 'smooth' });
                            if (!stageEl.classList.contains('expanded')) {
                                toggleStage(stageId);
                            }
                        }
                    }, 200);
                }
            }
        });

        window.addEventListener('resize', () => myChart.resize());
    } catch (e) {
        console.error('Render Gantt Error:', e);
        chartDom.innerHTML = `<div class="empty-state"><p>生成甘特图失败: ${e.message || '网络或数据错误'}</p></div>`;
    }
}

async function showGlobalGanttModal() {
    document.getElementById('globalGanttModal').classList.add('show');
    const res = await fetch('/api/analytics/gantt');
    const data = await res.json();
    renderGanttLegend('globalGanttLegend');
    const chartDom = document.getElementById('globalGanttChart');
    if (data.length === 0) {
        chartDom.innerHTML = '<div class="empty-state"><p>暂无项目数据</p></div>';
        return;
    }

    const myChart = echarts.init(chartDom);
    const categories = data.map(item => item.project.hospital_name || item.project.project_name);
    const seriesData = [];
    const milestoneData = [];
    let minDate = null, maxDate = null;

    data.forEach((item, projectIdx) => {
        item.stages.forEach(s => {
            if (!s.plan_start_date || !s.plan_end_date) return;
            const start = new Date(s.plan_start_date);
            const end = new Date(s.plan_end_date);
            if (!minDate || start < minDate) minDate = start;
            if (!maxDate || end > maxDate) maxDate = end;
            const color = STAGE_COLORS[s.stage_name] || '#5B8FF9';
            seriesData.push({
                name: s.stage_name,
                value: [projectIdx, start.getTime(), end.getTime(), s.progress, item.project.project_name, item.project.id],
                itemStyle: { color, borderRadius: 3 }
            });
        });

        if (item.milestones) {
            item.milestones.forEach(m => {
                const date = new Date(m.target_date);
                if (!minDate || date < minDate) minDate = date;
                if (!maxDate || date > maxDate) maxDate = date;
                milestoneData.push({
                    name: m.name,
                    value: [date.getTime(), projectIdx],
                    itemStyle: { color: m.is_completed ? '#10b981' : '#f59e0b' }
                });
            });
        }
    });

    const today = new Date().getTime();
    myChart.setOption({
        tooltip: {
            formatter: params => {
                if (params.seriesType === 'custom') {
                    return `<div style="padding:8px;"><div style="font-weight:600;margin-bottom:4px;">${params.value[4]}</div><div style="color:#8b5cf6;margin-bottom:8px;">${params.name}</div><div style="color:#666;font-size:12px;">时间: ${new Date(params.value[1]).toLocaleDateString('zh-CN')} ~ ${new Date(params.value[2]).toLocaleDateString('zh-CN')}</div><div style="color:#666;font-size:12px;">进度: ${params.value[3]}%</div><div style="margin-top:4px;color:var(--primary);font-size:11px;">(点击跳转项目详情)</div></div>`;
                }
                if (params.seriesType === 'scatter') {
                    return `<div style="padding:8px;"><div style="font-weight:600;color:#f59e0b;">🎯 里程碑: ${params.name}</div><div style="color:#666;font-size:12px;">日期: ${new Date(params.value[0]).toLocaleDateString('zh-CN')}</div></div>`;
                }
            }
        },
        grid: { left: '140', right: '40', top: '20', bottom: '40' },
        xAxis: {
            type: 'time',
            min: minDate ? minDate.getTime() - 86400000 * 3 : undefined,
            max: maxDate ? maxDate.getTime() + 86400000 * 3 : undefined,
            axisLabel: { formatter: value => { const d = new Date(value); return `${d.getMonth() + 1}-${d.getDate()}`; } },
            splitLine: { show: true, lineStyle: { color: 'rgba(0,0,0,0.05)' } }
        },
        yAxis: {
            type: 'category',
            data: categories,
            inverse: true,
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { fontSize: 12, color: '#333', width: 120, overflow: 'truncate' }
        },
        series: [
            {
                type: 'custom',
                renderItem: (params, apiRef) => {
                    const categoryIndex = apiRef.value(0);
                    const start = apiRef.coord([apiRef.value(1), categoryIndex]);
                    const end = apiRef.coord([apiRef.value(2), categoryIndex]);
                    const height = 18;
                    const progress = apiRef.value(3);
                    const rectShape = echarts.graphic.clipRectByRect({
                        x: start[0],
                        y: start[1] - height / 2,
                        width: Math.max(end[0] - start[0], 2),
                        height
                    }, {
                        x: params.coordSys.x,
                        y: params.coordSys.y,
                        width: params.coordSys.width,
                        height: params.coordSys.height
                    });
                    return rectShape && {
                        type: 'group',
                        children: [
                            { type: 'rect', shape: rectShape, style: { fill: apiRef.visual('color'), opacity: 0.2 } },
                            { type: 'rect', shape: { x: rectShape.x, y: rectShape.y, width: rectShape.width * progress / 100, height: rectShape.height }, style: { fill: apiRef.visual('color') } }
                        ]
                    };
                },
                encode: { x: [1, 2], y: 0 },
                data: seriesData
            },
            {
                type: 'scatter',
                symbol: 'diamond',
                symbolSize: 12,
                data: milestoneData,
                zlevel: 5,
                label: { show: false }
            },
            {
                type: 'line',
                markLine: {
                    silent: true,
                    symbol: 'none',
                    lineStyle: { color: '#ff4d4f', type: 'dashed', width: 2 },
                    data: [{ xAxis: today }],
                    label: { formatter: '今天', position: 'start', color: '#ff4d4f', fontSize: 11 }
                }
            }
        ]
    });

    myChart.on('click', function (params) {
        if (params.seriesType === 'custom') {
            const projectId = params.value[5];
            closeModal('globalGanttModal');
            loadProjectDetail(projectId);
        }
    });

    window.addEventListener('resize', () => myChart.resize());
}
