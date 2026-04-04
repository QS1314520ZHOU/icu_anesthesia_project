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
                <div class="modal-content modal-xl" style="max-width:1120px; border-radius:28px; overflow:hidden; background:linear-gradient(180deg,#f8fbff 0%, #ffffff 22%, #ffffff 100%); border:1px solid rgba(148,163,184,0.22); box-shadow:0 30px 80px rgba(15,23,42,0.18);">
                    <div class="modal-header" style="padding:28px 32px; border-bottom:1px solid rgba(148,163,184,0.14); background:
                        radial-gradient(circle at top left, rgba(14,165,233,0.18), transparent 32%),
                        radial-gradient(circle at top right, rgba(99,102,241,0.22), transparent 28%),
                        linear-gradient(135deg,#0f172a,#172554 62%, #312e81); color:white;">
                        <div style="display:flex; align-items:center; gap:16px;">
                            <div style="width:56px; height:56px; border-radius:18px; display:flex; align-items:center; justify-content:center; font-size:28px; background:rgba(255,255,255,0.14); box-shadow:inset 0 1px 0 rgba(255,255,255,0.18);">🧬</div>
                            <div>
                                <h3 style="margin:0; font-size:20px; font-weight:800; letter-spacing:0.2px;">AI 需求变更影响评估</h3>
                                <div style="margin-top:6px; font-size:12px; color:rgba(226,232,240,0.88);">从交付节奏、资源占用、连锁风险到决策建议，输出一份可直接讨论的评估报告</div>
                            </div>
                        </div>
                        <button class="modal-close" onclick="closeModal('demandAnalysisModal')" style="width:48px;height:48px;border-radius:16px;background:rgba(255,255,255,0.12);color:#e2e8f0;border:1px solid rgba(255,255,255,0.1);font-size:28px;line-height:1;">&times;</button>
                    </div>
                    <div class="modal-body" style="padding:28px 32px 32px;">
                        <div style="display:grid; grid-template-columns:minmax(320px, 360px) minmax(0, 1fr); gap:24px; align-items:start;">
                            <div style="background:linear-gradient(180deg,#ffffff,#f8fbff); border:1px solid rgba(148,163,184,0.18); border-radius:24px; padding:22px; box-shadow:0 12px 30px rgba(15,23,42,0.06);">
                                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
                                    <div>
                                        <div style="font-size:15px; font-weight:800; color:#0f172a;">变更输入卡</div>
                                        <div style="font-size:12px; color:#64748b; margin-top:4px;">描述变更背景、范围和约束，AI 会给出多维影响报告</div>
                                    </div>
                                    <div style="padding:6px 10px; border-radius:999px; background:#eef2ff; color:#4338ca; font-size:11px; font-weight:700;">Impact</div>
                                </div>
                                <label style="display:block; margin-bottom:8px; font-size:13px; font-weight:700; color:#334155;">变更内容描述</label>
                                <textarea id="changeDescription" placeholder="例：甲方要求增加移动端查询功能，包含3个核心页面；上线时间不变；现有接口需兼容旧流程..." 
                                    style="width:100%; min-height:220px; padding:16px 18px; border:1px solid rgba(148,163,184,0.22); border-radius:18px; background:#f8fafc; color:#0f172a; line-height:1.75; font-size:14px; resize:vertical; box-shadow:inset 0 1px 2px rgba(15,23,42,0.04);"></textarea>
                                <div style="display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin-top:14px;">
                                    <div style="padding:12px; border-radius:16px; background:#eff6ff;">
                                        <div style="font-size:11px; color:#64748b;">评估关注</div>
                                        <div style="font-size:13px; font-weight:700; color:#1d4ed8; margin-top:4px;">范围</div>
                                    </div>
                                    <div style="padding:12px; border-radius:16px; background:#f5f3ff;">
                                        <div style="font-size:11px; color:#64748b;">评估关注</div>
                                        <div style="font-size:13px; font-weight:700; color:#6d28d9; margin-top:4px;">进度</div>
                                    </div>
                                    <div style="padding:12px; border-radius:16px; background:#fff7ed;">
                                        <div style="font-size:11px; color:#64748b;">评估关注</div>
                                        <div style="font-size:13px; font-weight:700; color:#c2410c; margin-top:4px;">成本</div>
                                    </div>
                                </div>
                                <button class="btn btn-ai" style="width:100%; border:none; margin-top:18px; padding:16px 18px; border-radius:18px; background:linear-gradient(135deg,#4f46e5,#6366f1 48%, #0ea5e9); box-shadow:0 20px 32px rgba(79,70,229,0.24); font-size:16px; font-weight:800; letter-spacing:0.3px;" onclick="runDemandAnalysis()">🚀 开始 AI 多维评估</button>
                            </div>

                            <div id="demandAnalysisStage" style="min-height:560px; background:
                                radial-gradient(circle at top right, rgba(125,211,252,0.15), transparent 28%),
                                linear-gradient(180deg,#ffffff 0%, #f8fafc 100%);
                                border:1px solid rgba(148,163,184,0.16); border-radius:26px; padding:24px; box-shadow:0 18px 38px rgba(15,23,42,0.07);">
                                <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:16px;">
                                    <div>
                                        <div style="font-size:16px; font-weight:800; color:#0f172a;">评估输出面板</div>
                                        <div style="font-size:12px; color:#64748b; margin-top:4px;">AI 会将结果组织成适合讨论的简报，而不是一整页黑字堆叠</div>
                                    </div>
                                    <div style="padding:7px 12px; border-radius:999px; background:#e0f2fe; color:#0369a1; font-size:11px; font-weight:800;">AI Ready</div>
                                </div>
                                <div id="demandAnalysisResult" style="display:none; margin-top:0;">
                                    <div class="demand-analysis-box" id="demandAnalysisContent"></div>
                                </div>
                                <div id="demandAnalysisEmpty" style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:440px; text-align:center; color:#94a3b8; padding:32px;">
                                    <div style="width:88px; height:88px; border-radius:28px; display:flex; align-items:center; justify-content:center; font-size:42px; margin-bottom:18px; background:linear-gradient(135deg,#eef2ff,#e0f2fe); box-shadow:inset 0 1px 0 rgba(255,255,255,0.7);">🛰️</div>
                                    <div style="font-size:22px; font-weight:800; color:#334155;">等待开始评估</div>
                                    <div style="margin-top:10px; max-width:480px; line-height:1.8; font-size:14px;">输入变更描述后，AI 会输出核心影响、蝴蝶效应、延期风险、资源成本和决策建议。</div>
                                </div>
                            </div>
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
    const empty = document.getElementById('demandAnalysisEmpty');
    resultBox.style.display = 'block';
    if (empty) empty.style.display = 'none';
    content.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:420px; text-align:center;">
            <div class="loading-spinner"><div class="spinner"></div></div>
            <div style="margin-top:18px; font-size:18px; font-weight:800; color:#0f172a;">AI 正在计算影响链路</div>
            <div style="margin-top:8px; font-size:13px; color:#64748b;">分析交付冲击、资源占用、蝴蝶效应与决策建议，请稍候...</div>
        </div>
    `;

    try {
        const res = await api.post('/operational/analyze-change', {
            project_id: currentProjectId,
            description: desc
        });

        const contentStr = typeof res === 'string' ? res : (res.analysis || res.content || JSON.stringify(res));
        if (res) {
            const rendered = renderAiMarkdown(contentStr || '分析失败');
            content.innerHTML = `
                <div style="background:white; border:1px solid rgba(148,163,184,0.16); border-radius:22px; overflow:hidden; box-shadow:0 14px 40px rgba(15,23,42,0.08);">
                    <div style="padding:20px 24px; background:
                        radial-gradient(circle at top right, rgba(14,165,233,0.16), transparent 30%),
                        linear-gradient(135deg,#111827,#1e1b4b 58%, #312e81); color:white;">
                        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
                            <div>
                                <div style="font-size:18px; font-weight:800;">变更影响评估报告</div>
                                <div style="margin-top:6px; font-size:12px; color:rgba(226,232,240,0.88);">AI 从核心影响、连锁风险、延期与资源成本四个角度生成的分析结果</div>
                            </div>
                            <div style="padding:8px 14px; border-radius:999px; background:rgba(255,255,255,0.12); font-size:11px; font-weight:800; letter-spacing:0.4px;">Impact Brief</div>
                        </div>
                    </div>
                    <div class="report-detail-content" style="padding:28px 30px; line-height:1.9; font-size:15px; color:#1f2937;">
                        ${rendered}
                    </div>
                </div>
            `;
        }
    } catch (e) {
        content.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:360px; text-align:center; color:#ef4444;">
                <div style="width:72px; height:72px; border-radius:24px; display:flex; align-items:center; justify-content:center; font-size:34px; background:#fef2f2; margin-bottom:18px;">⚠️</div>
                <div style="font-size:20px; font-weight:800;">评估出错</div>
                <div style="margin-top:8px; max-width:420px; line-height:1.8; font-size:14px; color:#b91c1c;">${e.message}</div>
            </div>
        `;
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
