// Collaboration and communication helpers extracted from main.js

async function showAiRetrospective(projectId) {
    showGenericModal('📊 AI 项目复盘报告', '<div class="loading-spinner"></div>');
    try {
        const res = await api.post(`/projects/${projectId}/retrospective`);
        const contentEl = document.getElementById('genericModalContent');
        if (contentEl && res.report) {
            contentEl.innerHTML = `<div style="padding:20px;"><h2 style="margin-bottom:16px;">📊 AI项目复盘报告</h2><div class="markdown-content">${renderAiMarkdown(res.report)}</div></div>`;
        }
    } catch (e) {
        const contentEl = document.getElementById('genericModalContent');
        if (contentEl) contentEl.innerHTML = `<div style="padding:20px;color:var(--danger);">加载失败: ${e.message}</div>`;
    }
}

async function showAiTaskSuggestions(projectId) {
    showGenericModal('🎯 AI任务分配建议', '<div class="loading-spinner"></div>');
    try {
        const res = await api.post(`/projects/${projectId}/task-suggestions`);
        const contentEl = document.getElementById('genericModalContent');
        if (!contentEl) return;

        if (res && res.suggestions && Array.isArray(res.suggestions)) {
            let html = '<div style="padding:20px;"><h2 style="margin-bottom:16px;">🎯 AI任务分配建议</h2>';
            html += res.suggestions.map(item => `
                <div style="padding:12px 14px;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:10px;background:#fff;">
                    <div style="font-weight:700;color:#111827;margin-bottom:6px;">${item.member_name || '未指定成员'}</div>
                    <div style="font-size:13px;color:#374151;line-height:1.7;">${item.reason || ''}</div>
                    ${item.tasks ? `<div style="margin-top:8px;font-size:12px;color:#6b7280;">建议任务: ${item.tasks.join('、')}</div>` : ''}
                </div>
            `).join('');
            html += '</div>';
            contentEl.innerHTML = html;
        } else if (res && res.raw_response) {
            contentEl.innerHTML = `<div style="padding:20px;"><h2 style="margin-bottom:16px;">🎯 AI任务分配建议 (文本模式)</h2><div style="white-space: pre-wrap; line-height: 1.6; color: #374151;">${renderAiMarkdown(res.raw_response)}</div></div>`;
        } else {
            contentEl.innerHTML = '<div style="padding:20px;color:var(--gray-500);">暂无建议</div>';
        }
    } catch (e) {
        const contentEl = document.getElementById('genericModalContent');
        if (contentEl) contentEl.innerHTML = `<div style="padding:20px;color:var(--danger);">加载失败: ${e.message}</div>`;
    }
}

async function loadCommunications(projectId) {
    const records = await api.get(`/projects/${projectId}/communications`);
    renderCommunications(records, projectId);
}

function renderCommunications(records, projectId) {
    const container = document.getElementById('communicationsList');
    if (!container) return;
    if (!records || !records.length) {
        container.innerHTML = '<div class="empty-state"><p>暂无沟通记录</p></div>';
        return;
    }

    container.innerHTML = records.map(r => `
        <div class="comm-card" style="padding:14px 16px;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:10px;background:#fff;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <div style="font-weight:700;color:#111827;">${r.contact_person || '未填写联系人'}</div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <span style="font-size:12px;color:#6b7280;">${r.comm_date || ''}</span>
                    <button class="btn btn-danger btn-xs" onclick="deleteCommunication(${r.id}, ${projectId})">删除</button>
                </div>
            </div>
            <div style="font-size:13px;color:#374151;line-height:1.7;">${r.content || '无内容'}</div>
        </div>
    `).join('');
}

function showAddCommunicationModal() {
    document.getElementById('communicationForm').reset();
    showModal('communicationModal');
}

async function saveCommunication() {
    const data = {
        comm_date: document.getElementById('commDate').value,
        contact_person: document.getElementById('commPerson').value,
        content: document.getElementById('commContent').value
    };

    if (!data.content) {
        showToast('请填写沟通内容', 'warning');
        return;
    }

    await api.post(`/projects/${currentProjectId}/communications`, data);
    closeModal('communicationModal');
    loadCommunications(currentProjectId);
    showToast('沟通记录已保存', 'success');
}

async function deleteCommunication(recordId, projectId) {
    if (!confirm('确定删除这条沟通记录吗？')) return;
    await api.delete(`/communications/${recordId}`);
    loadCommunications(projectId);
    showToast('沟通记录已删除', 'success');
}

async function analyzeCommunications() {
    const target = document.getElementById('communicationAiAnalysis');
    if (!target) return;
    target.style.display = 'block';
    target.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>AI 正在分析沟通记录...</p></div>';

    try {
        const data = await api.post(`/projects/${currentProjectId}/communications/analyze`);
        target.innerHTML = _renderAiReport('沟通记录智能分析报告', '基于所有沟通记录的 AI 深度分析', data.analysis, '#8b5cf6', '#6366f1');
    } catch (e) {
        target.innerHTML = _renderAiError(e.message);
    }
}

async function analyzeUploadedFile(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!currentProjectId) {
        showToast('请先选择一个项目', 'warning');
        input.value = '';
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        showToast('文件过大，请上传小于 10MB 的文件', 'warning');
        input.value = '';
        return;
    }

    const target = document.getElementById('communicationAiAnalysis');
    if (!target) return;
    target.style.display = 'block';
    target.innerHTML = `
        <div style="background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden;">
            <div style="background:linear-gradient(135deg,#0ea5e9,#2563eb);padding:20px 24px;color:white;display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <div style="font-size:17px;font-weight:700;">AI 文件分析</div>
                    <div style="font-size:12px;opacity:0.85;margin-top:2px;">${file.name}</div>
                </div>
                <div style="color:rgba(255,255,255,0.85);font-size:12px;">提取文本 → AI分析 → 生成报告</div>
            </div>
            <div style="padding:24px;"><div class="loading-spinner"><div class="spinner"></div><p>AI 正在解析上传文件...</p></div></div>
        </div>
    `;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('project_id', currentProjectId);

    try {
        const data = await api.post('/communications/analyze-file', formData);
        target.innerHTML = _renderAiReport('沟通文件智能分析报告', '基于上传文件的 AI 深度分析', data.analysis, '#0ea5e9', '#2563eb');
    } catch (e) {
        target.innerHTML = _renderAiError(e.message);
    } finally {
        input.value = '';
    }
}

function _renderAiReport(title, subtitle, markdown, colorFrom, colorTo) {
    const htmlContent = renderAiMarkdown(markdown || '');
    return `
        <div style="background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden;">
            <div style="background:linear-gradient(135deg,${colorFrom},${colorTo});padding:20px 24px;color:white;display:flex;justify-content:space-between;align-items:center;">
                <div style="display:flex;align-items:center;gap:12px;">
                    <div style="width:44px;height:44px;background:rgba(255,255,255,0.2);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;">🤖</div>
                    <div>
                        <div style="font-size:17px;font-weight:700;">${title}</div>
                        <div style="font-size:12px;opacity:0.85;margin-top:2px;">${subtitle}</div>
                    </div>
                </div>
                <div style="display:flex;gap:8px;">
                    <button onclick="analyzeCommunications()" style="background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.3);color:white;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12px;">🔄 重新分析</button>
                    <button onclick="document.getElementById('communicationAiAnalysis').style.display='none'" style="background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.2);color:white;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12px;">✕ 收起</button>
                </div>
            </div>
            <div style="padding:24px 28px;line-height:1.85;font-size:14px;color:#1f2937;" class="report-detail-content comm-ai-report">
                ${htmlContent}
            </div>
            <div style="padding:12px 24px;background:#f9fafb;border-top:1px solid #f3f4f6;display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:11px;color:#9ca3af;">分析时间: ${new Date().toLocaleString()}</span>
                <span style="font-size:11px;color:#9ca3af;">AI 分析仅供参考，请结合实际情况判断</span>
            </div>
        </div>
    `;
}

function _renderAiError(msg) {
    return `
        <div style="background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden;">
            <div style="background:linear-gradient(135deg,#ef4444,#dc2626);padding:16px 24px;color:white;display:flex;align-items:center;gap:10px;">
                <span style="font-size:20px;">⚠️</span>
                <span style="font-weight:600;">分析失败</span>
                <button onclick="document.getElementById('communicationAiAnalysis').style.display='none'" style="margin-left:auto;background:rgba(255,255,255,0.2);border:none;color:white;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;">✕</button>
            </div>
            <div style="padding:24px;text-align:center;">
                <div style="color:#ef4444;font-size:14px;margin-bottom:12px;">${msg}</div>
                <button class="btn btn-outline btn-sm" onclick="analyzeCommunications()">🔄 重试</button>
            </div>
        </div>
    `;
}
