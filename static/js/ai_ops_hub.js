// AI helper operations extracted from main.js

window.aiOpsHistory = window.aiOpsHistory || JSON.parse(localStorage.getItem('ai_ops_history') || '[]');

function recordAiOpsHistory(entry) {
    const payload = {
        time: new Date().toLocaleString('zh-CN'),
        type: entry.type || 'unknown',
        title: entry.title || '未命名操作',
        detail: entry.detail || '',
        projectId: currentProjectId || null
    };
    window.aiOpsHistory.unshift(payload);
    window.aiOpsHistory = window.aiOpsHistory.slice(0, 30);
    localStorage.setItem('ai_ops_history', JSON.stringify(window.aiOpsHistory));
}

function showAiOpsHistory() {
    const html = window.aiOpsHistory.length
        ? window.aiOpsHistory.map(item => `
            <div style="padding:12px 14px;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:10px;background:#fff;">
                <div style="display:flex;justify-content:space-between;gap:12px;">
                    <div style="font-weight:700;color:#0f172a;">${item.title}</div>
                    <div style="font-size:12px;color:#94a3b8;">${item.time}</div>
                </div>
                <div style="font-size:12px;color:#64748b;margin-top:6px;">${item.type}${item.projectId ? ` · 项目 ${item.projectId}` : ''}</div>
                <div style="font-size:13px;color:#334155;margin-top:8px;line-height:1.7;">${item.detail || '无详情'}</div>
            </div>
        `).join('')
        : '<div style="color:#94a3b8;text-align:center;padding:30px;">暂无 AI 操作历史</div>';
    showGenericModal('🕘 AI 操作历史', html);
}

function showAiWorklogModal() {
    document.getElementById('aiWorklogInput').value = '';
    document.getElementById('aiWorklogError').style.display = 'none';
    const btn = document.getElementById('btnAiParse');
    btn.innerHTML = '🚀 智能识别并填报';
    btn.disabled = false;
    showModal('aiWorklogModal');
}

function showQuickReportModal() {
    const input = document.getElementById('quickReportInput');
    const result = document.getElementById('quickReportResult');
    const btn = document.getElementById('btnQuickReport');
    if (input) input.value = '';
    if (result) {
        result.style.display = 'none';
        result.innerText = '';
        result.style.background = '#ecfdf5';
        result.style.borderColor = '#bbf7d0';
        result.style.color = '#065f46';
    }
    if (btn) {
        btn.disabled = false;
        btn.innerText = '帮我归档';
    }
    showModal('quickReportModal');
    setTimeout(() => input && input.focus(), 80);
}

async function submitQuickReport() {
    const input = document.getElementById('quickReportInput');
    const result = document.getElementById('quickReportResult');
    const btn = document.getElementById('btnQuickReport');
    const content = (input?.value || '').trim();
    if (!content) {
        showToast('先写一句话，哪怕是“今天无进展”也行', 'warning');
        return;
    }
    if (!currentProjectId) {
        showToast('请先打开一个项目', 'warning');
        return;
    }

    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = '正在归档...';
    try {
        const res = await api.post('/quick-report', {
            project_id: currentProjectId,
            content,
            engineer_name: window.currentUser?.display_name || window.currentUser?.username || '',
            source: 'web'
        });
        recordAiOpsHistory({
            type: 'quick_report',
            title: '一句话上报',
            detail: res.daily_summary || content
        });
        if (result) {
            result.style.display = 'block';
            result.innerText = res.daily_summary || res.message || '已保存';
        }
        input.value = '';
        showToast('已归档：日志、问题和计划都处理好了', 'success');
        if (typeof loadWorklogs === 'function') {
            await loadWorklogs(currentProjectId);
        }
        if (typeof window.refreshImplementationWorkbenchAfterSave === 'function') {
            await window.refreshImplementationWorkbenchAfterSave();
        }
        setTimeout(() => closeModal('quickReportModal'), 1800);
    } catch (e) {
        if (result) {
            result.style.display = 'block';
            result.style.background = '#fef2f2';
            result.style.borderColor = '#fecaca';
            result.style.color = '#991b1b';
            result.innerText = '归档失败：' + e.message;
        }
    } finally {
        btn.disabled = false;
        btn.innerText = originalText;
    }
}

async function saveWorklogAI() {
    const rawText = document.getElementById('aiWorklogInput').value;
    if (!rawText) {
        showToast('请输入工作内容', 'warning');
        return;
    }

    const btn = document.querySelector('#aiWorklogModal .btn-primary');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'AI 正在分析...';

    try {
        const res = await api.post('/ai/parse-log', { raw_text: rawText });
        if (res) {
            recordAiOpsHistory({
                type: 'ai_parse_log',
                title: 'AI 智能填报',
                detail: `已解析工作日志，建议工时 ${res.work_hours || 8} 小时`
            });
            document.getElementById('logDate').value = new Date().toISOString().split('T')[0];
            document.getElementById('workContent').value = res.work_content || rawText;
            document.getElementById('workHours').value = res.work_hours || 8;
            document.getElementById('issuesEncountered').value = res.issues_encountered || '';
            document.getElementById('tomorrowPlan').value = res.tomorrow_plan || '';

            closeModal('aiWorklogModal');
            showModal('worklogModal', { reset: false });
        } else {
            showToast('AI 解析未能返回有效数据', 'warning');
        }
    } catch (e) {
        console.error('AI Parse Error:', e);
        showToast('AI 解析服务暂时不可用: ' + e.message, 'danger');
        closeModal('aiWorklogModal');
        showModal('worklogModal', { reset: false });
        document.getElementById('workContent').value = rawText;
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

async function parseAiWorklog() {
    const rawText = document.getElementById('aiWorklogInput').value.trim();
    if (!rawText) {
        showToast('请输入工作内容描述', 'warning');
        return;
    }

    const btn = document.getElementById('btnAiParse');
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<span class="loading-spinner-sm"></span> AI 正在分析...';
    btn.disabled = true;

    try {
        const res = await api.post('/ai/parse-log', { raw_text: rawText });
        if (res) {
            recordAiOpsHistory({
                type: 'ai_parse_log',
                title: 'AI 智能填报',
                detail: `已解析工作日志，输出内容长度 ${String(res.work_content || '').length}`
            });
            closeModal('aiWorklogModal');
            fillWorklogForm(res);
            showModal('worklogModal', { reset: false });
            showToast('AI 识别成功，请确认后保存', 'success');
        } else {
            document.getElementById('aiWorklogError').textContent = '识别失败: AI 未返回有效数据';
            document.getElementById('aiWorklogError').style.display = 'block';
        }
    } catch (e) {
        console.error(e);
        document.getElementById('aiWorklogError').textContent = '请求失败: ' + e.message;
        document.getElementById('aiWorklogError').style.display = 'block';
    } finally {
        btn.innerHTML = originalContent;
        btn.disabled = false;
    }
}

function fillWorklogForm(data) {
    if (!data) return;

    const cleanDetail = (data.work_content || '').replace(/\*\*/g, '').replace(/###/g, '');
    document.getElementById('workContent').value = cleanDetail;
    document.getElementById('issuesEncountered').value = data.issues_encountered || '';
    document.getElementById('workHours').value = data.work_hours || 8;
    document.getElementById('tomorrowPlan').value = data.tomorrow_plan || '';
    document.getElementById('logDate').value = new Date().toISOString().split('T')[0];

    const content = (data.work_content || '') + (data.issues_encountered || '');
    if (content.includes('现场') || content.includes('医院') || content.includes('科室')) {
        document.getElementById('workType').value = '现场';
    } else if (content.includes('出差')) {
        document.getElementById('workType').value = '出差';
    } else {
        document.getElementById('workType').value = '远程';
    }
}

let currentStaleItems = [];
let lastGeneratedChaser = null;

async function showAiChaserModal() {
    showModal('aiChaserModal');
    loadStaleItems();
    document.getElementById('chaserResult').innerHTML = '<div style="color: #9ca3af; text-align: center; margin-top: 100px;">请从左侧选择一个事项进行生成</div>';
}

async function loadStaleItems() {
    const container = document.getElementById('staleItemsList');
    container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

    try {
        const items = await api.get(`/projects/${currentProjectId}/stale-items`);
        if (Array.isArray(items) && items.length > 0) {
            currentStaleItems = items;
            renderStaleItems(items);
        } else {
            container.innerHTML = '<div class="empty-state">暂无滞后项</div>';
            currentStaleItems = [];
        }
    } catch (e) {
        container.innerHTML = `<div class="error-state">加载失败: ${e.message}</div>`;
    }
}

function renderStaleItems(items) {
    const container = document.getElementById('staleItemsList');
    const typeMap = { issue: '问题', interface: '接口', milestone: '里程碑' };
    const iconMap = { issue: '⚠️', interface: '🔗', milestone: '🎯' };

    container.innerHTML = items.map((item, index) => `
        <div class="stale-item-card" onclick="generateChaser(${index})" style="padding: 10px; border: 1px solid #eee; border-radius: 6px; margin-bottom: 8px; cursor: pointer; transition: all 0.2s;">
            <div style="font-weight: 600; font-size: 14px; color: #374151;">${iconMap[item.type]} ${item.title}</div>
            <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">${item.reason}</div>
            <div style="font-size: 12px; color: #9ca3af; margin-top: 4px; text-align: right;">${typeMap[item.type]}</div>
        </div>
    `).join('');
}

async function generateChaser(index) {
    const item = currentStaleItems[index];
    const container = document.getElementById('chaserResult');
    const staleItemsList = document.getElementById('staleItemsList');

    if (staleItemsList) {
        Array.from(staleItemsList.children).forEach((c, idx) => {
            if (idx === index) {
                c.style.borderColor = '#4f46e5';
                c.style.backgroundColor = '#f5f3ff';
            } else {
                c.style.borderColor = '#eee';
                c.style.backgroundColor = 'transparent';
            }
        });
    }

    container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

    try {
        const timeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('AI 生成超时(120s)，请检查AI模型配置或稍后重试')), 120000)
        );
        const res = await Promise.race([
            api.post('/ai/chaser/generate', item),
            timeout
        ]);
        if (res && res.professional) {
            lastGeneratedChaser = res;
            recordAiOpsHistory({
                type: 'ai_chaser',
                title: 'AI 智能催单',
                detail: `已为 ${item.title || item.reason || '滞后项'} 生成催办文案`
            });
            renderChaserStyles('professional');
        } else {
            container.innerHTML = `<div class="error-text" style="color:#ef4444;padding:20px;text-align:center;">生成格式异常<br><small style="color:#9ca3af;">${JSON.stringify(res).substring(0, 200)}</small></div>`;
        }
    } catch (e) {
        console.error('[DEBUG] chaser/generate error:', e);
        container.innerHTML = `<div class="error-text" style="color:#ef4444;padding:20px;text-align:center;">请求异常: ${e.message}</div>`;
    }
}

function renderChaserStyles(activeStyle) {
    const container = document.getElementById('chaserResult');
    if (!lastGeneratedChaser) return;

    const data = lastGeneratedChaser[activeStyle];
    const styles = [
        { id: 'professional', label: '👔 专业', color: '#4f46e5' },
        { id: 'soft', label: '🍃 委婉', color: '#10b981' },
        { id: 'direct', label: '⚡ 果敢', color: '#f59e0b' }
    ];

    container.innerHTML = `
        <div style="display:flex; gap:8px; margin-bottom:16px; border-bottom:1px solid #f1f5f9; padding-bottom:12px;">
            ${styles.map(s => `
                <button onclick="switchChaserStyle('${s.id}')" style="flex:1; padding:6px 10px; border-radius:12px; border:2px solid ${activeStyle === s.id ? s.color : '#e2e8f0'}; background:${activeStyle === s.id ? s.color + '10' : 'white'}; color:${activeStyle === s.id ? s.color : '#64748b'}; font-size:12px; font-weight:700; cursor:pointer; transition:all 0.2s;">
                    ${s.label}
                </button>
            `).join('')}
        </div>
        <div id="chaserContentArea" style="animation: fadeIn 0.3s ease;">
            <div style="margin-bottom: 12px; font-weight: 800; color: #1e293b; font-size: 14px; background: #f8fafc; padding: 10px; border-radius: 8px; border-left: 4px solid #cbd5e1;">
                主题: ${data.subject}
            </div>
            <div style="white-space: pre-wrap; line-height: 1.8; color: #334155; font-size: 14px; padding: 10px;">${data.content}</div>
        </div>
    `;
}

function switchChaserStyle(style) {
    renderChaserStyles(style);
}

function copyChaserContent() {
    const content = document.getElementById('chaserResult').innerText;
    if (!content || content.includes('请从左侧选择')) return;

    navigator.clipboard.writeText(content).then(() => {
        showToast('已复制到剪贴板', 'success');
    });
}

function sendMockChaser() {
    const content = document.getElementById('chaserResult').innerText;
    if (!content || content.includes('请从左侧选择')) return;
    if (confirm('确定要发送这条提醒吗？(模拟发送)')) {
        showToast('✅ 已发送提醒消息', 'success');
        closeModal('aiChaserModal');
    }
}

async function extractToKb(issueId, btn) {
    if (!confirm('确定要让AI分析此问题并提取知识库条目吗？')) return;

    const originalText = btn.innerHTML;
    btn.innerHTML = '⏳...';
    btn.disabled = true;

    try {
        const res = await api.post('/ai/knowledge/extract', { issue_id: issueId });
        if (res.success) {
            const kbTitle = res?.data?.data?.title || res?.data?.title || res?.title || '知识条目';
            recordAiOpsHistory({
                type: 'ai_knowledge_extract',
                title: '知识提炼',
                detail: `问题 ${issueId} 已提炼为知识条目`
            });
            showToast(`✅ 提取成功：${kbTitle}`, 'success');
        } else {
            showToast('提取失败: ' + res.message, 'danger');
        }
    } catch (e) {
        showToast('请求异常: ' + e.message, 'danger');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

function showAskAiModal() {
    showModal('askAiModal');
    document.getElementById('aiQuestionInput').focus();
    document.getElementById('aiQueryResult').style.display = 'none';
    document.getElementById('aiQueryLoading').style.display = 'none';
    document.getElementById('aiQuestionInput').value = '';
}

async function submitAiQuestion() {
    const question = document.getElementById('aiQuestionInput').value.trim();
    if (!question) return;

    if (!currentProjectId) {
        showToast('项目ID未找到，请刷新页面重试', 'danger');
        console.error('Missing currentProjectId');
        return;
    }

    const loading = document.getElementById('aiQueryLoading');
    const resultDiv = document.getElementById('aiQueryResult');
    const sqlSpan = document.getElementById('aiQuerySql');
    const table = document.getElementById('aiResultTable');
    const countDiv = document.getElementById('aiResultCount');
    const sqlContainer = document.getElementById('aiSqlContainer');

    loading.style.display = 'block';
    resultDiv.style.display = 'none';

    try {
        const data = await api.post(`/projects/${currentProjectId}/ask`, { question }, { silent: true });
        if (data) {
            recordAiOpsHistory({
                type: 'ai_nlq',
                title: 'AI 项目问答',
                detail: `问题：${question}`
            });
            sqlSpan.textContent = data.sql || 'No SQL generated';

            let tableHtml = '<thead><tr>';
            if (data.columns) {
                data.columns.forEach(col => {
                    tableHtml += `<th>${col}</th>`;
                });
            }
            tableHtml += '</tr></thead><tbody>';

            if (!data.rows || data.rows.length === 0) {
                tableHtml += `<tr><td colspan="${(data.columns || []).length || 1}" style="text-align:center; color:#94a3b8; padding:40px;">No results found for this query.</td></tr>`;
            } else {
                data.rows.forEach(row => {
                    tableHtml += '<tr>';
                    data.columns.forEach(col => {
                        tableHtml += `<td>${row[col] !== null ? row[col] : '-'}</td>`;
                    });
                    tableHtml += '</tr>';
                });
            }
            tableHtml += '</tbody>';

            table.innerHTML = tableHtml;
            countDiv.textContent = `找到 ${data.rows ? data.rows.length : 0} 条记录`;
            resultDiv.style.display = 'block';
            if (sqlContainer) sqlContainer.style.display = 'none';
        }
    } catch (e) {
        console.error('AI Ask Error:', e);
        if (sqlSpan) sqlSpan.textContent = '';
        if (table) {
            table.innerHTML = `<tbody><tr><td colspan="1" style="text-align:center; color:#ef4444; padding:32px;">${e.message}</td></tr></tbody>`;
        }
        if (countDiv) countDiv.textContent = '查询失败';
        if (resultDiv) resultDiv.style.display = 'block';
        if (sqlContainer) sqlContainer.style.display = 'none';
    } finally {
        loading.style.display = 'none';
        document.getElementById('aiInputContainer').style.boxShadow = '0 4px 12px -2px rgba(0,0,0,0.05)';
        document.getElementById('aiInputContainer').style.borderColor = '#e2e8f0';
    }
}

function setAiQuestion(text) {
    const input = document.getElementById('aiQuestionInput');
    if (input) {
        input.value = text;
        input.focus();
    }
}

function toggleAiSql() {
    const container = document.getElementById('aiSqlContainer');
    const btn = document.getElementById('btnToggleSql');
    const icon = btn.querySelector('i');

    if (container.style.display === 'none') {
        container.style.display = 'block';
        icon.style.transform = 'rotate(-135deg)';
    } else {
        container.style.display = 'none';
        icon.style.transform = 'rotate(45deg)';
    }
}
