// AI analysis and radar helpers extracted from main.js

window.aiAnalysisHistory = window.aiAnalysisHistory || JSON.parse(localStorage.getItem('ai_analysis_history') || '[]');
window.currentAiAnalysisSnapshot = window.currentAiAnalysisSnapshot || null;

function recordAiAnalysisHistory(projectId, content) {
    const item = {
        projectId,
        time: new Date().toLocaleString('zh-CN'),
        content: String(content || '').slice(0, 5000)
    };
    window.aiAnalysisHistory.unshift(item);
    window.aiAnalysisHistory = window.aiAnalysisHistory.slice(0, 20);
    localStorage.setItem('ai_analysis_history', JSON.stringify(window.aiAnalysisHistory));
}

function restoreAiAnalysisVersion(index) {
    const relevant = window.aiAnalysisHistory.filter(item => !currentReportProjectId || Number(item.projectId) === Number(currentReportProjectId));
    const target = relevant[index];
    if (!target) {
        showToast('历史版本不存在', 'danger');
        return;
    }
    openModal('aiModal');
    const loadingEl = document.getElementById('aiLoading');
    if (loadingEl) loadingEl.style.display = 'none';
    const contentEl = document.getElementById('aiContent');
    const radarContainer = document.getElementById('aiRadarContainer');
    const { html, radarData } = processReportResult(target.content, 'ai');
    if (contentEl) {
        contentEl.innerHTML = `<div class="cache-hint"><span class="icon">🕘</span><span>当前展示的是历史版本 #${relevant.length - index}：${target.time}</span></div>` + html;
        contentEl.style.display = 'block';
    }
    if (radarData && radarContainer) {
        radarContainer.style.display = 'block';
        renderRadarChart(radarData);
    } else if (radarContainer) {
        radarContainer.style.display = 'none';
    }
    showToast('已恢复历史版本到当前视图', 'success');
}

function showAiAnalysisHistory() {
    const relevant = window.aiAnalysisHistory.filter(item => !currentReportProjectId || Number(item.projectId) === Number(currentReportProjectId));
    let compareHtml = '';
    if (relevant.length >= 2) {
        const latest = relevant[0];
        const previous = relevant[1];
        const latestLen = String(latest.content || '').length;
        const previousLen = String(previous.content || '').length;
        const delta = latestLen - previousLen;
        compareHtml = `
            <div style="padding:12px 14px;border-radius:12px;background:#eef2ff;border:1px solid #c7d2fe;margin-bottom:12px;">
                <div style="font-weight:700;color:#3730a3;margin-bottom:6px;">🧭 最近两版对比摘要</div>
                <div style="font-size:12px;color:#475569;line-height:1.7;">
                    最新版本：${latest.time}<br>
                    上一版本：${previous.time}<br>
                    内容长度变化：${delta >= 0 ? '+' : ''}${delta} 字符
                </div>
            </div>
        `;
    }
    const html = relevant.length
        ? `
            <div style="display:flex;justify-content:flex-end;margin-bottom:12px;">
                <button class="btn btn-outline btn-sm" onclick="clearAiAnalysisHistory()">🗑️ 清空历史</button>
            </div>
            ${compareHtml}
            ${relevant.map((item, index) => `
            <div style="padding:14px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;margin-bottom:10px;">
                <div style="display:flex;justify-content:space-between;gap:12px;">
                    <div style="font-weight:700;color:#0f172a;">版本 ${relevant.length - index}</div>
                    <div style="font-size:12px;color:#94a3b8;">${item.time}</div>
                </div>
                <div style="margin-top:10px;font-size:13px;color:#334155;line-height:1.7;max-height:220px;overflow:auto;">${renderAiMarkdown(item.content)}</div>
                <div style="margin-top:10px;display:flex;justify-content:flex-end;gap:8px;">
                    <button class="btn btn-outline btn-sm" onclick="copyAiAnalysisVersion(${index})">📋 复制</button>
                    <button class="btn btn-outline btn-sm" onclick="restoreAiAnalysisVersion(${index})">恢复到当前视图</button>
                </div>
            </div>
        `).join('')}`
        : '<div style="color:#94a3b8;text-align:center;padding:30px;">暂无 AI 诊断历史</div>';
    showGenericModal('🕘 AI 诊断历史', html);
}

function clearAiAnalysisHistory() {
    window.aiAnalysisHistory = [];
    localStorage.removeItem('ai_analysis_history');
    showAiAnalysisHistory();
    showToast('AI 诊断历史已清空', 'success');
}

async function copyAiAnalysisVersion(index) {
    const relevant = window.aiAnalysisHistory.filter(item => !currentReportProjectId || Number(item.projectId) === Number(currentReportProjectId));
    const target = relevant[index];
    if (!target) {
        showToast('历史版本不存在', 'danger');
        return;
    }
    try {
        await navigator.clipboard.writeText(target.content || '');
        showToast('历史版本内容已复制', 'success');
    } catch (e) {
        showToast('复制失败: ' + e.message, 'danger');
    }
}

async function loadAiDailyInsight(projectId, isRefresh = false) {
    const contentEl = document.getElementById('aiInsightContent');
    if (!contentEl) return;

    contentEl.innerHTML = '<div class="loading-spinner" style="font-size:13px; color:#6b7280;">AI 正在进行战略研判...</div>';
    try {
        const url = `/ai/daily-insight/${projectId}` + (isRefresh ? '?refresh=1' : '');
        const advice = await api.get(url);
        const adviceHtml = renderAiMarkdown(advice || '');
        contentEl.innerHTML = `<div class="report-content" style="font-size:14px; color:#334155; line-height:1.7;">${adviceHtml}</div>`;
    } catch (e) {
        contentEl.innerHTML = `<div style="color:var(--danger); font-size:12px;">⚠️ 战略研判暂时离线</div>`;
    }
}

async function callAiAnalysis(pid, forceRefresh = false) {
    const btn = document.getElementById('btnAiDiagnosis');
    const originalText = btn ? btn.innerHTML : '';

    if (btn && btn.disabled && !confirm('正在进行分析，是否强制重新开始？')) {
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ 分析中...';
    }

    currentReportProjectId = pid;
    openModal('aiModal');

    const loadingEl = document.getElementById('aiLoading');
    const contentEl = document.getElementById('aiContent');
    if (loadingEl) loadingEl.style.display = 'block';
    if (contentEl) contentEl.style.display = 'none';

    if (btn) {
        setTimeout(() => {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }, 500);
    }

    try {
        const endpoint = `/projects/${pid}/ai-analyze${forceRefresh ? '?force=1' : ''}`;
        const data = await api.post(endpoint);

        if (data.task_id) {
            pollTask(data.task_id, 'aiLoading', 'aiContent', 'ai', (result) => {
                const { html, radarData } = processReportResult(result, 'ai');
                recordAiAnalysisHistory(pid, result);
                window.currentAiAnalysisSnapshot = result;
                if (contentEl) contentEl.innerHTML = html;
                if (loadingEl) loadingEl.style.display = 'none';
                if (contentEl) contentEl.style.display = 'block';
                const radarContainer = document.getElementById('aiRadarContainer');
                if (radarData && radarContainer) {
                    radarContainer.style.display = 'block';
                    renderRadarChart(radarData);
                } else if (radarContainer) {
                    radarContainer.style.display = 'none';
                }
            });
        } else {
            const cacheHint = data.cached ? `<div class="cache-hint"><span class="icon">💾</span><span>此报告为缓存版本 (${data.cached_at})，点击"重新生成"获取最新分析。</span></div>` : '';
            const { html, radarData } = processReportResult(data.analysis, 'ai');
            recordAiAnalysisHistory(pid, data.analysis);
            window.currentAiAnalysisSnapshot = data.analysis;
            if (contentEl) contentEl.innerHTML = cacheHint + html;
            if (loadingEl) loadingEl.style.display = 'none';
            if (contentEl) contentEl.style.display = 'block';
            const radarContainer = document.getElementById('aiRadarContainer');
            if (radarData && radarContainer) {
                radarContainer.style.display = 'block';
                renderRadarChart(radarData);
            } else if (radarContainer) {
                radarContainer.style.display = 'none';
            }
        }
    } catch (e) {
        console.error('[DEBUG] AI Analysis Failed:', e);
        if (contentEl) contentEl.innerHTML = `<p style="color:red;">请求失败: ${e.message}</p>`;
        if (loadingEl) loadingEl.style.display = 'none';
        if (contentEl) contentEl.style.display = 'block';
    }
}

function refreshAiAnalysis() {
    if (currentReportProjectId) callAiAnalysis(currentReportProjectId, true);
}

function processReportResult(markdown, type) {
    if (!markdown) return { html: '', radarData: null };
    let radarData = null;
    let cleanedMarkdown = cleanAiMarkdown(markdown);

    const jsonMatch = markdown.match(/```json\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[1]);
            if (parsed.radar) {
                radarData = parsed.radar;
                cleanedMarkdown = markdown.replace(jsonMatch[0], '');
            }
        } catch (e) {
            console.error('Failed to parse radar JSON', e);
        }
    }

    return {
        html: renderBeautifulReport(cleanedMarkdown, type),
        radarData
    };
}

function renderRadarChart(data) {
    const chartDom = document.getElementById('aiRadarChart');
    const myChart = echarts.init(chartDom);

    const indicators = Object.keys(data).map(key => ({ name: key, max: 10 }));
    const values = Object.values(data);

    myChart.setOption({
        title: { text: '项目风险维度图', left: 'center', top: 10, textStyle: { fontSize: 14, color: '#4b5563' } },
        radar: {
            indicator: indicators,
            shape: 'circle',
            splitNumber: 5,
            axisName: { color: '#6b7280' },
            splitLine: { lineStyle: { color: ['#f3f4f6'] } },
            splitArea: { show: false },
            axisLine: { lineStyle: { color: '#f3f4f6' } }
        },
        series: [{
            name: '风险评估',
            type: 'radar',
            data: [{
                value: values,
                name: '得分',
                areaStyle: { color: 'rgba(99, 102, 241, 0.2)' },
                lineStyle: { color: '#6366f1', width: 2 },
                itemStyle: { color: '#6366f1' }
            }]
        }]
    });

    window.addEventListener('resize', () => myChart.resize());
}
