// Report and archive operations extracted from main.js

async function generateWeeklyReport(pid, forceRefresh = false) {
    currentReportProjectId = pid;
    openModal('reportModal');

    const loadingEl = document.getElementById('reportLoading');
    const contentEl = document.getElementById('reportContent');
    if (loadingEl) loadingEl.style.display = 'block';
    if (contentEl) contentEl.style.display = 'none';

    try {
        const endpoint = `/projects/${pid}/weekly-report${forceRefresh ? '?force=1' : ''}`;
        const data = await api.post(endpoint);

        if (data.task_id) {
            pollTask(data.task_id, 'reportLoading', 'reportContent', 'weekly', (result) => {
                if (contentEl) contentEl.innerHTML = renderBeautifulReport(result, 'weekly');
                if (loadingEl) loadingEl.style.display = 'none';
                if (contentEl) contentEl.style.display = 'block';
            });
        } else {
            const cacheHint = data.cached ? `<div class="cache-hint"><span class="icon">💾</span><span>此周报为缓存版本 (${data.cached_at})。</span></div>` : '';
            if (contentEl) contentEl.innerHTML = cacheHint + renderBeautifulReport(data.report, 'weekly');
            if (loadingEl) loadingEl.style.display = 'none';
            if (contentEl) contentEl.style.display = 'block';
        }
    } catch (e) {
        console.error('[DEBUG] Report Generation Failed:', e);
        if (contentEl) contentEl.innerHTML = `<p style="color:red;">请求失败: ${e.message}</p>`;
        if (loadingEl) loadingEl.style.display = 'none';
        if (contentEl) contentEl.style.display = 'block';
    }
}

function refreshWeeklyReport() {
    if (currentReportProjectId) generateWeeklyReport(currentReportProjectId, true);
    else generateAllReport(true);
}

async function generateAiWeeklySummary() {
    if (!currentReportProjectId) {
        showToast('无法获取项目 ID', 'danger');
        return;
    }

    const btn = document.querySelector('.btn-ai');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="loading-spinner-sm"></span> 正在深度思考中...';
    btn.disabled = true;
    showToast('AI 正在分析项目数据，请稍候...', 'info', 5000);

    try {
        const res = await api.post('/ai/summarize-weekly', { project_id: currentReportProjectId });
        const summary = cleanAiMarkdown((res.summary || '').replace(/\*/g, ''));

        const reportContent = document.getElementById('reportContent');
        const summaryHtml = `
            <div class="ai-summary-box" style="margin-bottom:20px; padding:15px; background:#f0f7ff; border-left:4px solid #3b82f6; border-radius:4px; animation: fadeIn 0.5s;">
                <div style="font-weight:600; color:#1d4ed8; margin-bottom:8px; display:flex; align-items:center; gap:8px;">
                    <span style="font-size:1.2em">🤖</span>
                    <span>AI 核心总结</span>
                    <span class="badge badge-info" style="font-size:0.8em; margin-left:auto;">DeepSeek-V3</span>
                </div>
                <div style="font-size:14px; line-height:1.6; color:#1e40af;">${renderAiMarkdown(summary)}</div>
            </div>
        `;

        const existingSummary = reportContent.querySelector('.ai-summary-box');
        if (existingSummary) {
            existingSummary.outerHTML = summaryHtml;
        } else {
            reportContent.innerHTML = summaryHtml + reportContent.innerHTML;
        }

        showToast('AI 总结生成完成', 'success');
    } catch (e) {
        console.error(e);
        let errorMsg = e.message;
        if (errorMsg === 'Failed to fetch') errorMsg = '网络连接失败或服务器正在重启，请稍后重试';
        showToast('AI 总结生成失败: ' + errorMsg, 'danger');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function generateAllReport(forceRefresh = false) {
    currentReportProjectId = null;
    showModal('reportModal');
    document.getElementById('reportLoading').style.display = 'block';
    document.getElementById('reportContent').style.display = 'none';

    try {
        const endpoint = `/weekly-report/all${forceRefresh ? '?force=1' : ''}`;
        const data = await api.post(endpoint);

        if (data.task_id) {
            pollTask(data.task_id, 'reportLoading', 'reportContent', 'weekly', (result) => {
                document.getElementById('reportContent').innerHTML = renderBeautifulReport(result, 'weekly');
                document.getElementById('reportLoading').style.display = 'none';
                document.getElementById('reportContent').style.display = 'block';
            });
        } else {
            const cacheHint = data.cached ? `<div class="cache-hint"><span class="icon">💾</span><span>此周报为缓存版本 (${data.cached_at})。</span></div>` : '';
            document.getElementById('reportContent').innerHTML = cacheHint + renderBeautifulReport(data.report, 'weekly');
            document.getElementById('reportLoading').style.display = 'none';
            document.getElementById('reportContent').style.display = 'block';
        }
    } catch (e) {
        document.getElementById('reportContent').innerHTML = `<p style="color:red;">请求失败: ${e.message}</p>`;
        document.getElementById('reportLoading').style.display = 'none';
        document.getElementById('reportContent').style.display = 'block';
    }
}

async function exportProjectReport(pid) {
    try {
        const project = await api.get(`/projects/${pid}`);
        const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(project, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute('href', dataStr);
        downloadAnchorNode.setAttribute('download', `项目报告_${project.project_name}.json`);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
        showToast('报告已生成并开始下载（JSON 格式包含全量项目明细）。', 'success');
    } catch (e) {
        console.error('导出失败', e);
        showToast('导出失败，请重试', 'danger');
    }
}

async function loadReportArchive(projectId) {
    const container = document.getElementById('reportArchiveList');
    if (!container) return;

    const typeFilter = document.getElementById('archiveTypeFilter');
    const type = typeFilter ? typeFilter.value : '';
    const url = `/api/projects/${projectId}/report-archive${type ? '?type=' + type : ''}`;

    try {
        const res = await fetch(url);
        const archives = await res.json();

        if (!archives || archives.length === 0) {
            container.innerHTML = `<div style="text-align:center;color:var(--gray-400);padding:30px;">
                <div style="font-size:40px;margin-bottom:10px;">📭</div>
                <div>暂无归档报告</div>
                <div style="font-size:12px;margin-top:5px;">系统将在每天 22:00 自动生成日报，每周五 22:30 自动生成周报</div>
                <div style="font-size:12px;">也可点击上方按钮手动生成</div>
            </div>`;
            return;
        }

        container.innerHTML = archives.map(a => {
            const typeBadge = a.report_type === 'daily'
                ? '<span style="background:#e0f2fe;color:#0369a1;padding:2px 8px;border-radius:10px;font-size:11px;">日报</span>'
                : '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px;font-size:11px;">周报</span>';
            const genBadge = a.generated_by === 'auto'
                ? '<span style="background:#f0fdf4;color:#166534;padding:2px 6px;border-radius:10px;font-size:10px;">自动</span>'
                : '<span style="background:#faf5ff;color:#6b21a8;padding:2px 6px;border-radius:10px;font-size:10px;">手动</span>';

            return `<div class="archive-item" onclick="viewArchiveDetail(${a.id})"
                style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--gray-100);cursor:pointer;transition:background 0.15s;"
                onmouseover="this.style.background='var(--gray-50)'" onmouseout="this.style.background=''">
                <div style="display:flex;align-items:center;gap:10px;">
                    ${typeBadge}
                    <span style="font-weight:500;">${a.report_date}</span>
                    ${genBadge}
                </div>
                <span style="color:var(--gray-400);font-size:12px;">点击查看 →</span>
            </div>`;
        }).join('');
    } catch (e) {
        container.innerHTML = `<div style="text-align:center;color:var(--danger);padding:20px;">加载失败: ${e.message}</div>`;
    }
}

async function viewArchiveDetail(archiveId) {
    try {
        const res = await fetch(`/api/report-archive/${archiveId}`);
        const data = await res.json();
        if (data.error) {
            showToast(data.error, 'danger');
            return;
        }

        const typeLabel = data.report_type === 'daily' ? '日报' : '周报';
        const htmlContent = renderAiMarkdown(data.content || '');

        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);';
        modal.innerHTML = `
            <div style="background:white;border-radius:12px;width:90%;max-width:800px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
                <div style="padding:20px 24px;border-bottom:1px solid var(--gray-200);display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <h3 style="margin:0;font-size:18px;">📂 ${typeLabel} - ${data.report_date}</h3>
                        <div style="font-size:12px;color:var(--gray-400);margin-top:4px;">
                            生成方式: ${data.generated_by === 'auto' ? '自动' : '手动'} | ${data.created_at || ''}
                        </div>
                    </div>
                    <button onclick="this.closest('.modal').remove()" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--gray-400);">✕</button>
                </div>
                <div style="padding:24px;overflow-y:auto;flex:1;line-height:1.8;font-size:14px;" class="report-detail-content">
                    ${htmlContent}
                </div>
            </div>
        `;
        modal.addEventListener('click', e => {
            if (e.target === modal) modal.remove();
        });
        document.body.appendChild(modal);
    } catch (e) {
        showToast('加载报告失败: ' + e.message, 'danger');
    }
}

async function manualGenerateArchive(reportType) {
    if (!currentProjectId) {
        showToast('请先选择一个项目', 'warning');
        return;
    }

    const typeLabel = reportType === 'daily' ? '日报' : '周报';
    if (!confirm(`确定要为当前项目生成今日${typeLabel}吗？\n（如果AI服务不可用，将生成数据摘要版本）`)) return;

    try {
        const res = await fetch(`/api/projects/${currentProjectId}/report-archive/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ report_type: reportType, force: false })
        });
        const data = await res.json();

        if (data.exists) {
            if (confirm(`今日${typeLabel}已存在，是否覆盖重新生成？`)) {
                const res2 = await fetch(`/api/projects/${currentProjectId}/report-archive/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ report_type: reportType, force: true })
                });
                const data2 = await res2.json();
                if (data2.success) {
                    showToast(`${typeLabel}已重新生成并归档！`, 'success');
                    loadReportArchive(currentProjectId);
                } else {
                    showToast(`生成失败: ${data2.error || '未知错误'}`, 'danger');
                }
            }
        } else if (data.success) {
            showToast(`${typeLabel}已生成并归档！`, 'success');
            loadReportArchive(currentProjectId);
        } else if (data.error) {
            showToast(`生成失败: ${data.error}`, 'danger');
        }
    } catch (e) {
        showToast('请求失败: ' + e.message, 'danger');
    }
}
