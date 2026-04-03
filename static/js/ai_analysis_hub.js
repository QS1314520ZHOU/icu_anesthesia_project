// AI analysis and radar helpers extracted from main.js

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
