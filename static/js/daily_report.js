
async function generateDailyReport(projectId) {
    // 1. 打开模态框，显示加载状态
    showModal('dailyReportModal');
    const contentDiv = document.getElementById('dailyReportContent');
    contentDiv.innerHTML = `
        <div style="text-align: center; padding: 40px;">
            <div class="loading-spinner"></div>
            <div style="margin-top: 20px; color: var(--gray-600);">
                正在调用 AI 生成今日日报...<br>
                <small>分析今日日志 • 汇总完成任务 • 识别风险问题</small>
            </div>
        </div>
    `;

    try {
        // 2. 调用后端 API
        const res = await api.post('/ai/generate-daily-report', {
            project_id: projectId,
            date: new Date().toISOString().split('T')[0] // 默认今天
        });

        // 3. 渲染结果
        if (res.report) {
            // 将 Markdown 转换为 HTML (依赖 marked.js)
            const htmlContent = marked.parse(res.report);
            contentDiv.innerHTML = `
                <div class="report-container" style="line-height: 1.6; color: #333;">
                    ${htmlContent}
                </div>
            `;
        } else {
            contentDiv.innerHTML = `<div class="alert alert-warning">AI 未返回有效内容，请稍后重试。</div>`;
        }

    } catch (e) {
        console.error(e);
        contentDiv.innerHTML = `<div class="alert alert-danger">生成失败: ${e.message}</div>`;
    }
}

function copyDailyReport() {
    const content = document.getElementById('dailyReportContent').innerText;
    navigator.clipboard.writeText(content).then(() => {
        alert('日报内容已复制到剪贴板');
    }).catch(err => {
        console.error('Copy failed', err);
        alert('复制失败，请手动复制');
    });
}
