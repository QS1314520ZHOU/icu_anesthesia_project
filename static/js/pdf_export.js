/**
 * 导出项目 PDF 报告 (增强版)
 */
async function exportProjectPDF(projectId) {
    if (!currentProject) {
        showToast('请先加载项目详情', 'warning');
        return;
    }

    const btn = event.currentTarget || document.querySelector(`button[onclick="exportProjectPDF(${projectId})"]`);
    const originalText = btn ? btn.innerHTML : '导出PDF';
    if (btn) {
        btn.innerHTML = '⌛ 生成中...';
        btn.disabled = true;
    }

    try {
        // 1. 创建临时容器用于构建报告
        const reportContainer = document.createElement('div');
        reportContainer.id = 'pdf-report-container';
        reportContainer.style.position = 'absolute';
        reportContainer.style.top = '0';
        reportContainer.style.left = '-9999px';
        reportContainer.style.zIndex = '-1';
        reportContainer.style.opacity = '1';  // Must be visible to be captured correctly by some browsers/engines

        reportContainer.style.width = '800px'; // A4 width approx
        reportContainer.style.background = 'white';
        reportContainer.style.color = '#333';
        reportContainer.style.fontFamily = '"PingFang SC", "Microsoft YaHei", sans-serif';
        document.body.appendChild(reportContainer);

        // 2. 构建报告内容
        reportContainer.innerHTML = generateReportHTML(currentProject);

        // 3. 配置 PDF 选项
        const opt = {
            margin: [10, 10, 10, 10],
            filename: `${currentProject.project_name}_项目报告_${new Date().toISOString().split('T')[0]}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, letterRendering: true, windowWidth: 1200 },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
        };

        // 4. 等待图片加载 (如果有)
        await new Promise(resolve => setTimeout(resolve, 500));

        // 5. 生成 PDF
        await html2pdf().set(opt).from(reportContainer).save();

    } catch (err) {
        console.error('PDF Export Error:', err);
        showToast('导出失败: ' + err.message, 'danger');
    } finally {
        // 清理
        const container = document.getElementById('pdf-report-container');
        if (container) document.body.removeChild(container);

        if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }
}

function generateReportHTML(project) {
    const dateStr = new Date().toLocaleDateString();

    // 辅助函数：生成表格行
    const generateRows = (items, columns) => {
        if (!items || items.length === 0) return '<tr><td colspan="' + columns.length + '" style="text-align:center; color:#999; padding:10px;">无数据</td></tr>';
        return items.map(item => `
            <tr>
                ${columns.map(col => `<td style="border:1px solid #ddd; padding:8px;">${col(item)}</td>`).join('')}
            </tr>
        `).join('');
    };

    const getStatusColor = (status) => {
        const colors = {
            '待启动': '#9ca3af', '进行中': '#3b82f6', '试运行': '#8b5cf6',
            '验收中': '#f59e0b', '已验收': '#10b981', '质保期': '#06b6d4',
            '暂停': '#f97316', '已终止': '#ef4444', '已完成': '#22c55e'
        };
        return colors[status] || '#666';
    };

    return `
        <style>
            .report-header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #3b82f6; padding-bottom: 10px; }
            .report-section { margin-bottom: 25px; page-break-inside: avoid; }
            .section-title { font-size: 16px; font-weight: bold; border-left: 4px solid #3b82f6; padding-left: 10px; margin-bottom: 12px; background: #f1f5f9; padding: 8px; }
            .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 14px; }
            .info-item { display: flex; }
            .info-label { font-weight: bold; width: 100px; color: #64748b; }
            .info-value { flex: 1; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th { background: #f8fafc; border: 1px solid #ddd; padding: 8px; text-align: left; font-weight: bold; }
            .risk-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
        </style>

        <div class="report-header">
            <h1 style="margin:0; font-size:24px; color:#1e293b;">项目进度报告</h1>
            <p style="margin:5px 0 0; color:#64748b;">生成日期: ${dateStr}</p>
        </div>

        <!-- 1. 项目概况 -->
        <div class="report-section">
            <div class="section-title">1. 项目概况</div>
            <div class="info-grid">
                <div class="info-item"><span class="info-label">项目名称:</span><span class="info-value">${project.project_name}</span></div>
                <div class="info-item"><span class="info-label">医院名称:</span><span class="info-value">${project.hospital_name}</span></div>
                <div class="info-item"><span class="info-label">项目经理:</span><span class="info-value">${project.project_manager || '未指定'}</span></div>
                <div class="info-item"><span class="info-label">当前状态:</span><span class="info-value" style="color:${getStatusColor(project.status)}; font-weight:bold;">${project.status}</span></div>
                <div class="info-item"><span class="info-label">计划周期:</span><span class="info-value">${project.plan_start_date || '-'} 至 ${project.plan_end_date || '-'}</span></div>
                <div class="info-item"><span class="info-label">总体进度:</span><span class="info-value">${project.progress}%</span></div>
            </div>
        </div>

        <!-- 2. 风险评估 -->
        <div class="report-section">
            <div class="section-title">2. AI 风险评估</div>
            <div style="background: ${(project.risk_score || 0) > 60 ? '#fef2f2' : '#f0fdf4'}; padding: 10px; border-radius: 4px; border: 1px solid ${(project.risk_score || 0) > 60 ? '#fecaca' : '#bbf7d0'};">
                <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                    <strong>风险评分: <span style="color:${getRiskColor(project.risk_score)}; font-size:18px;">${project.risk_score || 0}</span></strong>
                </div>
                <div style="font-size:13px; line-height:1.5;">${project.risk_analysis || '暂无风险分析数据'}</div>
            </div>
        </div>

        <!-- 3. 里程碑进展 -->
        <div class="report-section">
            <div class="section-title">3. 关键里程碑</div>
            <table>
                <thead>
                    <tr><th width="40%">里程碑名称</th><th width="30%">目标日期</th><th width="30%">状态</th></tr>
                </thead>
                <tbody>
                    ${generateRows(project.milestones, [
        m => m.name,
        m => m.target_date || '-',
        m => m.is_completed ? '<span style="color:green">✅ 已完成</span>' : (new Date(m.target_date) < new Date() ? '<span style="color:red">⚠️ 已逾期</span>' : '<span style="color:gray">⏳ 进行中</span>')
    ])}
                </tbody>
            </table>
        </div>

        <!-- 4. 阶段任务概览 -->
        <div class="report-section">
            <div class="section-title">4. 阶段进度</div>
            <table>
                <thead>
                    <tr><th width="30%">阶段名称</th><th width="20%">状态</th><th width="50%">任务完成度</th></tr>
                </thead>
                <tbody>
                    ${generateRows(project.stages, [
        s => s.stage_name,
        s => `<span style="color:${getStatusColor(s.status)}">${s.status}</span>`,
        s => {
            const total = s.tasks ? s.tasks.length : 0;
            const done = s.tasks ? s.tasks.filter(t => t.is_completed).length : 0;
            return `${done} / ${total}`;
        }
    ])}
                </tbody>
            </table>
        </div>

        <!-- 5. 待解决问题 -->
        <div class="report-section">
            <div class="section-title">5. 重点关注问题</div>
            <table>
                <thead>
                    <tr><th width="15%">类型</th><th width="50%">描述</th><th width="15%">严重程度</th><th width="20%">状态</th></tr>
                </thead>
                <tbody>
                    ${generateRows((project.issues || []).filter(i => i.status !== '已解决').slice(0, 5), [
        i => i.issue_type,
        i => i.description,
        i => `<span style="color:${i.severity === '高' ? 'red' : 'orange'}">${i.severity}</span>`,
        i => i.status
    ])}
                </tbody>
            </table>
            ${(project.issues || []).filter(i => i.status !== '已解决').length === 0 ? '<div style="text-align:center; padding:10px; color:green;">🎉 当前无待解决问题</div>' : ''}
        </div>

        <div style="margin-top: 30px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 10px;">
            ICU/手麻临床信息系统项目管理平台自动生成
        </div>
    `;
}
