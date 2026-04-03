// PMO and operational analysis helpers extracted from main.js

async function openPmoDashboard() {
    openModal('pmoModal');
    loadPmoOverview();
    loadPmoSummary();
}

async function loadPmoOverview() {
    const pmContainer = document.getElementById('pmoPmWorkload');
    const actionContainer = document.getElementById('pmoPortfolioActions');
    if (!pmContainer) return;

    pmContainer.innerHTML = '<div class="loading-spinner"></div>';
    if (actionContainer) actionContainer.innerHTML = '';

    try {
        const data = await api.get('/pmo/overview');

        if (actionContainer && data.portfolio_actions && data.portfolio_actions.length > 0) {
            actionContainer.innerHTML = `
                <div class="panel" style="border: none; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); border-radius: 20px; background: #fff1f2; border: 1px solid #fee2e2;">
                    <div class="panel-header" style="background: transparent; border-bottom: 1px solid #fee2e2; padding: 16px 24px;">
                        <div class="panel-title" style="font-size: 15px; font-weight: 700; color: #b91c1c;">⚡ PMO 风险干预指令 (Action Center)</div>
                    </div>
                    <div class="panel-body" style="padding: 15px 24px;">
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px;">
                            ${data.portfolio_actions.map(action => `
                                <div style="background: white; padding: 16px; border-radius: 12px; border-left: 4px solid ${action.priority === 'High' ? '#ef4444' : '#f59e0b'}; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                                    <div style="font-weight: 700; color: #1e293b; font-size: 14px; margin-bottom: 4px;">
                                        <span style="font-size: 10px; background: ${action.priority === 'High' ? '#fee2e2' : '#fef3c7'}; color: ${action.priority === 'High' ? '#b91c1c' : '#92400e'}; padding: 2px 6px; border-radius: 4px; margin-right: 6px;">${action.priority}</span>
                                        ${action.title}
                                    </div>
                                    <div style="font-size: 13px; color: #4b5563; margin-bottom: 8px;">${action.description}</div>
                                    <div style="font-size: 12px; color: #b91c1c; font-weight: 600; background: #fff1f2; padding: 6px 10px; border-radius: 6px;">💡 建议：${action.suggestion}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            `;
        } else if (actionContainer) {
            actionContainer.style.display = 'none';
        }

        let pmHtml = '<div style="padding: 12px 0;">';
        if (data.pm_workload && Array.isArray(data.pm_workload)) {
            data.pm_workload.forEach(pm => {
                const progress = Math.round(pm.avg_progress || 0);
                pmHtml += `
                    <div style="padding: 16px 24px; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div style="font-weight: 700; color: #1e293b; font-size: 14px;">${pm.project_manager || '未分配'}</div>
                            <div style="font-size: 12px; color: #64748b; margin-top: 4px;">在研项目: ${pm.count}</div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-weight: 700; color: #3b82f6; font-size: 14px;">${progress}%</div>
                            <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">平均进度</div>
                        </div>
                    </div>
                `;
            });
        } else {
            pmHtml += `<div style="padding:20px; text-align:center; color:#ef4444;">Could not load PM data: ${data.error || 'Unknown error'}</div>`;
        }
        pmHtml += '</div>';
        pmContainer.innerHTML = pmHtml;

        renderPmoRegionalChart(data.regional);
    } catch (e) {
        pmContainer.innerHTML = '加载失败: ' + e.message;
    }
}

async function loadPmoSummary() {
    const container = document.getElementById('pmoAiSummary');
    if (!container) return;

    container.innerHTML = '<div class="loading-spinner"></div><p style="text-align:center; color:#64748b; font-size:13px; margin-top:10px;">AI 正在串联全线项目数据，请稍候...</p>';

    try {
        const data = await api.get('/pmo/summary');
        let summary = data.summary || '暂无摘要';
        summary = summary.replace(/\*/g, '');
        container.innerHTML = `
            <div class="report-container" style="box-shadow: none; border: none; padding: 24px; font-size: 14px;">
                ${renderAiMarkdown(summary)}
            </div>
        `;
    } catch (e) {
        container.innerHTML = '摘要生成失败';
    }
}

function renderPmoRegionalChart(data) {
    const chartDom = document.getElementById('pmoRegionalChart');
    if (!chartDom) return;
    const myChart = echarts.init(chartDom);

    const option = {
        tooltip: {
            trigger: 'item',
            formatter: function (info) {
                const value = info.value;
                const name = info.name;
                const progress = info.data.d;
                return `<div style="padding:12px;border-radius:8px;background:rgba(255,255,255,0.95);box-shadow:0 4px 15px rgba(0,0,0,0.1);backdrop-filter:blur(10px);">
                            <div style="font-weight:600;color:#1e293b;font-size:14px;margin-bottom:8px;">${name}</div>
                            <div style="display:flex;align-items:center;margin-bottom:4px;">
                                <span style="background:#e0f2fe;color:#0ea5e9;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600;">${value} 个项目</span>
                            </div>
                            <div style="color:#64748b;font-size:12px;">平均进度: <strong style="color:#10b981;">${progress}%</strong></div>
                        </div>`;
            },
            backgroundColor: 'transparent',
            borderColor: 'transparent',
            padding: 0
        },
        visualMap: {
            show: false,
            min: 0,
            max: Math.max(...data.map(d => d.count), 1),
            inRange: { color: ['#93c5fd', '#3b82f6', '#1d4ed8'] }
        },
        series: [{
            name: '区域分布',
            type: 'treemap',
            roam: false,
            nodeClick: false,
            breadcrumb: { show: false },
            itemStyle: {
                borderColor: '#ffffff',
                borderWidth: 2,
                gapWidth: 2,
                borderRadius: [8, 8, 8, 8]
            },
            label: {
                show: true,
                formatter: '{b}\n\n{c}个项目',
                fontSize: 14,
                fontFamily: 'Inter, system-ui, sans-serif',
                fontWeight: 600
            },
            data: data.map(d => ({
                name: d.region || '未指定',
                value: d.count,
                d: Math.round(d.avg_progress)
            }))
        }]
    };

    myChart.setOption(option);
    window.addEventListener('resize', () => myChart.resize());
}

async function loadStageBaselines() {
    try {
        const res = await api.get('/operational/stage-baselines');
        if (res) {
            window.stageBaselines = res;
            const hint = document.getElementById('baselineHint');
            if (hint) hint.textContent = `(已加载 ${res.length} 个阶段基准)`;
        }
    } catch (e) {
        console.error('Load baselines failed', e);
    }
}

function showDemandAnalysisModal() {
    let modal = document.getElementById('demandAnalysisModal');
    if (!modal) {
        const html = `
            <div id="demandAnalysisModal" class="modal">
                <div class="modal-content modal-lg">
                    <div class="modal-header">
                        <h3>🧬 AI 需求变更影响评估 (Impact Analysis)</h3>
                        <button class="modal-close" onclick="closeModal('demandAnalysisModal')">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div style="margin-bottom:16px;">
                            <label style="display:block; margin-bottom:8px; font-weight:600;">变更内容描述</label>
                            <textarea id="changeDescription" placeholder="例：甲方要求增加移动端查询功能，包含3个核心页面..." 
                                style="width:100%; height:120px; padding:12px; border:1px solid #cbd5e1; border-radius:8px;"></textarea>
                        </div>
                        <button class="btn btn-ai" style="width:100%; border:none;" onclick="runDemandAnalysis()">🚀 开始 AI 多维评估</button>
                        
                        <div id="demandAnalysisResult" style="display:none; margin-top:20px;">
                            <div class="demand-analysis-box" id="demandAnalysisContent"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);
        modal = document.getElementById('demandAnalysisModal');
    }
    openModal('demandAnalysisModal');
    document.getElementById('changeDescription').value = '';
    document.getElementById('demandAnalysisResult').style.display = 'none';
}

async function runDemandAnalysis() {
    const desc = document.getElementById('changeDescription').value;
    if (!desc) {
        showToast('请输入变更描述', 'warning');
        return;
    }

    const resultBox = document.getElementById('demandAnalysisResult');
    const content = document.getElementById('demandAnalysisContent');
    resultBox.style.display = 'block';
    content.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>AI 正在计算蝴蝶效应与资源成本...</p></div>';

    try {
        const res = await api.post('/operational/analyze-change', {
            project_id: currentProjectId,
            description: desc
        });

        const contentStr = typeof res === 'string' ? res : (res.analysis || res.content || JSON.stringify(res));
        if (res) {
            content.innerHTML = renderAiMarkdown(contentStr || '分析失败');
        }
    } catch (e) {
        content.innerHTML = '评估出错: ' + e.message;
    }
}

function showRiskSimulationModal(taskId, taskName, event) {
    if (event) event.stopPropagation();
    const modal = document.getElementById('riskSimulationModal');
    if (!modal) return;

    window.currentSimTaskId = taskId;
    document.getElementById('simTaskName').textContent = taskName;
    document.getElementById('simDelayDays').value = 3;
    document.getElementById('simulationResult').style.display = 'none';

    modal.classList.add('show');
}

async function runRiskSimulation() {
    const taskId = window.currentSimTaskId;
    const delay = document.getElementById('simDelayDays').value;
    const resultBox = document.getElementById('simulationResult');
    const list = document.getElementById('impactedTasksList');
    const narration = document.getElementById('simulationNarration');

    resultBox.style.display = 'block';
    list.innerHTML = '<div style="padding:20px; text-align:center; color:#94a3b8;">正在计算传播路径...</div>';
    narration.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>AI 正在分析蝴蝶效应...</p></div>';

    try {
        const res = await api.get(`/risk/simulate?project_id=${currentProjectId}&task_id=${taskId}&delay_days=${delay}`);
        if (res) {
            if (res.impacted_tasks && res.impacted_tasks.length > 0) {
                list.innerHTML = res.impacted_tasks.map(t => `
                    <div style="padding:10px 14px; border-bottom:1px solid #f1f5f9; display:flex; flex-direction:column; gap:4px;">
                        <div style="font-weight:500; font-size:13px; color:#334155;">${t.task_name}</div>
                        <div style="font-size:11px; color:#94a3b8;">${t.stage_name} · 计划: ${t.plan_end_date}</div>
                        <div style="color:#ef4444; font-size:11px; font-weight:600;">⚠️ 预计顺延 ${res.delay_days} 天</div>
                    </div>
                `).join('');
                if (res.impacted_count > 10) {
                    list.innerHTML += `<div style="padding:8px; text-align:center; color:#64748b; font-size:11px; background:#f8fafc;">...及其他 ${res.impacted_count - 10} 个关联任务</div>`;
                }
            } else {
                list.innerHTML = '<div style="padding:20px; text-align:center; color:#10b981;">✅ 暂未发现下游强依赖受波及</div>';
            }

            narration.innerHTML = renderAiMarkdown(res.narration || '分析完成');
        }
    } catch (e) {
        console.error('Simulation failed', e);
        list.innerHTML = '<div style="padding:20px; color:#ef4444;">计算失败</div>';
    }
}
