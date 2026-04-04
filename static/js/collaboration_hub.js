// Collaboration and communication helpers extracted from main.js

let currentEditingCommunicationId = null;
let latestCommunicationAiAnalysisMarkdown = '';
let latestCommunicationAnalysisContext = null;
let latestAiRetrospectiveMarkdown = '';
let latestAiTaskSuggestionsExportText = '';
let communicationFilterState = {
    keyword: '',
    method: '',
    tag: ''
};

function todayIsoDate() {
    return new Date().toISOString().slice(0, 10);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
}

function normalizeTextValue(value, fallback = '') {
    const text = String(value ?? '').trim();
    return text || fallback;
}

async function populateCommunicationIssueOptions(projectId, selectedIssueId = '') {
    const select = document.getElementById('commIssueSelect');
    if (!select) return;
    if (!projectId) {
        select.innerHTML = '<option value="">请先选择项目</option>';
        return;
    }
    select.innerHTML = '<option value="">加载中...</option>';
    try {
        const issues = await api.get(`/projects/${projectId}/issues`);
        const unresolved = (issues || []).filter(item => item.status !== '已解决');
        select.innerHTML = '<option value="">无关联问题</option>' + unresolved.map(issue => {
            return `<option value="${escapeAttr(issue.id)}" ${String(issue.id) === String(selectedIssueId) ? 'selected' : ''}>[${escapeHtml(issue.severity || '未分级')}] ${escapeHtml(issue.description || '未命名问题')}</option>`;
        }).join('');
    } catch (e) {
        select.innerHTML = '<option value="">问题加载失败</option>';
    }
}

async function populateMeetingIssueOptions(projectId, selectedIssueId = '') {
    const select = document.getElementById('meetingSaveIssueSelect');
    if (!select) return;
    if (!projectId) {
        select.innerHTML = '<option value="">请先选择项目</option>';
        return;
    }
    select.innerHTML = '<option value="">加载中...</option>';
    try {
        const issues = await api.get(`/projects/${projectId}/issues`);
        const unresolved = (issues || []).filter(item => item.status !== '已解决');
        select.innerHTML = '<option value="">不关联问题</option>' + unresolved.map(issue => {
            return `<option value="${escapeAttr(issue.id)}" ${String(issue.id) === String(selectedIssueId) ? 'selected' : ''}>[${escapeHtml(issue.severity || '未分级')}] ${escapeHtml(issue.description || '未命名问题')}</option>`;
        }).join('');
    } catch (e) {
        select.innerHTML = '<option value="">问题加载失败</option>';
    }
}

function normalizeAiTaskSuggestions(suggestions) {
    return (Array.isArray(suggestions) ? suggestions : []).map(item => {
        const memberName = item.member_name || item.suggested_member || '未指定成员';
        const taskList = Array.isArray(item.tasks)
            ? item.tasks.filter(Boolean)
            : [item.task_name || item.title || (item.task_id ? `任务 #${item.task_id}` : '')].filter(Boolean);

        return {
            memberName,
            taskId: item.task_id || item.id || '',
            taskList,
            reason: item.reason || item.summary || '',
            raw: item
        };
    });
}

function renderModalActionBar(buttons) {
    const safeButtons = (buttons || []).filter(Boolean);
    if (!safeButtons.length) return '';
    return `
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-bottom:14px;">
            ${safeButtons.join('')}
        </div>
    `;
}

function buildAiTaskSuggestionsExportText(suggestionItems, rawResponse, message) {
    if (Array.isArray(suggestionItems) && suggestionItems.length) {
        return [
            '【AI任务分配建议】',
            '',
            ...suggestionItems.flatMap((item, index) => [
                `${index + 1}. ${item.memberName}${item.taskId ? ` | 任务 #${item.taskId}` : ''}`,
                `建议任务：${item.taskList.join('、') || '未提供'}`,
                `原因：${item.reason || '未提供'}`,
                ''
            ])
        ].join('\n').trim();
    }
    return rawResponse || message || '';
}

async function showAiRetrospective(projectId) {
    showGenericModal('📊 AI 项目复盘报告', '<div class="loading-spinner"></div>');
    latestAiRetrospectiveMarkdown = '';
    try {
        const res = await api.post(`/projects/${projectId}/ai-retrospective`);
        const contentEl = document.getElementById('genericModalContent');
        if (contentEl && res.report) {
            latestAiRetrospectiveMarkdown = String(res.report || '');
            contentEl.innerHTML = `
                <div style="padding:20px;">
                    ${renderModalActionBar([
                        '<button class="btn btn-outline btn-sm" onclick="copyAiRetrospective()">📋 复制报告</button>'
                    ])}
                    <h2 style="margin-bottom:16px;">📊 AI项目复盘报告</h2>
                    <div class="markdown-content">${renderAiMarkdown(res.report)}</div>
                </div>
            `;
        } else if (contentEl) {
            contentEl.innerHTML = '<div style="padding:20px;color:var(--gray-500);">AI 暂未返回复盘报告</div>';
        }
    } catch (e) {
        latestAiRetrospectiveMarkdown = '';
        const contentEl = document.getElementById('genericModalContent');
        if (contentEl) contentEl.innerHTML = `<div style="padding:20px;color:var(--danger);">加载失败: ${escapeHtml(e.message)}</div>`;
    }
}

async function showAiTaskSuggestions(projectId) {
    showGenericModal('🎯 AI任务分配建议', '<div class="loading-spinner"></div>');
    latestAiTaskSuggestionsExportText = '';
    try {
        const res = await api.post(`/projects/${projectId}/ai-task-suggestions`);
        const contentEl = document.getElementById('genericModalContent');
        if (!contentEl) return;

        const suggestionItems = normalizeAiTaskSuggestions(res?.suggestions);
        latestAiTaskSuggestionsExportText = buildAiTaskSuggestionsExportText(suggestionItems, res?.raw_response || '', res?.message || '暂无建议');

        if (suggestionItems.length) {
            let html = '<div style="padding:20px;"><h2 style="margin-bottom:16px;">🎯 AI任务分配建议</h2>';
            html = `<div style="padding:20px;">${renderModalActionBar([
                '<button class="btn btn-outline btn-sm" onclick="copyAiTaskSuggestions()">📋 复制建议</button>'
            ])}<h2 style="margin-bottom:16px;">🎯 AI任务分配建议</h2>`;
            html += suggestionItems.map(item => `
                <div style="padding:12px 14px;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:10px;background:#fff;">
                    <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:6px;">
                        <div style="font-weight:700;color:#111827;">${escapeHtml(item.memberName)}</div>
                        ${item.taskId ? `<span style="font-size:12px;color:#6b7280;">任务 #${escapeHtml(item.taskId)}</span>` : ''}
                    </div>
                    <div style="font-size:13px;color:#374151;line-height:1.7;">${escapeHtml(item.reason || '')}</div>
                    ${item.taskList.length ? `<div style="margin-top:8px;font-size:12px;color:#6b7280;">建议任务: ${escapeHtml(item.taskList.join('、'))}</div>` : ''}
                </div>
            `).join('');
            html += '</div>';
            contentEl.innerHTML = html;
        } else if (res && res.raw_response) {
            contentEl.innerHTML = `
                <div style="padding:20px;">
                    ${renderModalActionBar([
                        '<button class="btn btn-outline btn-sm" onclick="copyAiTaskSuggestions()">📋 复制建议</button>'
                    ])}
                    <h2 style="margin-bottom:16px;">🎯 AI任务分配建议 (文本模式)</h2>
                    <div class="markdown-content" style="line-height:1.7;color:#374151;">${renderAiMarkdown(res.raw_response)}</div>
                </div>
            `;
        } else {
            contentEl.innerHTML = `
                <div style="padding:20px;">
                    ${latestAiTaskSuggestionsExportText ? renderModalActionBar([
                        '<button class="btn btn-outline btn-sm" onclick="copyAiTaskSuggestions()">📋 复制说明</button>'
                    ]) : ''}
                    <div style="color:var(--gray-500);">${escapeHtml(res?.message || '暂无建议')}</div>
                </div>
            `;
        }
    } catch (e) {
        latestAiTaskSuggestionsExportText = '';
        const contentEl = document.getElementById('genericModalContent');
        if (contentEl) contentEl.innerHTML = `<div style="padding:20px;color:var(--danger);">加载失败: ${escapeHtml(e.message)}</div>`;
    }
}

async function copyAiRetrospective() {
    if (!latestAiRetrospectiveMarkdown) {
        showToast('暂无可复制的复盘报告', 'warning');
        return;
    }
    try {
        await writeTextToClipboard(latestAiRetrospectiveMarkdown);
        showToast('AI 复盘报告已复制', 'success');
    } catch (e) {
        showToast('复制失败: ' + e.message, 'danger');
    }
}

async function copyAiTaskSuggestions() {
    if (!latestAiTaskSuggestionsExportText) {
        showToast('暂无可复制的任务建议', 'warning');
        return;
    }
    try {
        await writeTextToClipboard(latestAiTaskSuggestionsExportText);
        showToast('AI 任务建议已复制', 'success');
    } catch (e) {
        showToast('复制失败: ' + e.message, 'danger');
    }
}

async function loadCommunications(projectId) {
    const container = document.getElementById('communicationsList');
    if (container) {
        container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>正在加载沟通记录...</p></div>';
    }

    try {
        const records = await api.get(`/projects/${projectId}/communications`, { silent: true });
        renderCommunications(records, projectId);
    } catch (e) {
        if (container) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>沟通记录加载失败</p>
                    <button class="btn btn-outline btn-sm" onclick="loadCommunications(${Number(projectId)})">重试</button>
                </div>
            `;
        }
        showToast('沟通记录加载失败: ' + e.message, 'danger');
    }
}

function deriveCommTags(record) {
    const text = `${record.summary || ''} ${record.contact_method || ''}`.toLowerCase();
    const tags = [];
    if (text.includes('会议') || text.includes('现场')) tags.push('会议');
    if (text.includes('需求')) tags.push('需求');
    if (text.includes('问题') || text.includes('异常')) tags.push('问题');
    if (text.includes('确认')) tags.push('确认');
    if (text.includes('微信')) tags.push('微信');
    if (text.includes('电话')) tags.push('电话');
    return tags.length ? tags : ['沟通'];
}

function syncCommunicationFilterState() {
    communicationFilterState.keyword = (document.getElementById('commSearchInput')?.value || '').trim();
    communicationFilterState.method = document.getElementById('commMethodFilter')?.value || '';
    communicationFilterState.tag = document.getElementById('commTagFilter')?.value || '';
}

function applyCommunicationFilterState() {
    const search = document.getElementById('commSearchInput');
    const method = document.getElementById('commMethodFilter');
    const tag = document.getElementById('commTagFilter');
    if (search) search.value = communicationFilterState.keyword;
    if (method) method.value = communicationFilterState.method;
    if (tag) tag.value = communicationFilterState.tag;
}

function renderCommunications(records, projectId) {
    const container = document.getElementById('communicationsList');
    if (!container) return;
    if (!records || !records.length) {
        container.innerHTML = `
            <div class="empty-state">
                <p>暂无沟通记录</p>
                <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:12px;">
                    <button class="btn btn-primary btn-sm" onclick="showAddCommunicationModal()">+ 新增记录</button>
                    <button class="btn btn-outline btn-sm" onclick="showMeetingAssistant()">🎙️ 会议助手</button>
                </div>
            </div>
        `;
        return;
    }

    const allTags = [...new Set(records.flatMap(deriveCommTags))];
    const methodStats = records.reduce((acc, item) => {
        const key = item.contact_method || '未标记';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
    const topTags = allTags.slice(0, 6);
    const latestDate = records[0]?.contact_date || '未知';

    container.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:14px;">
            <div style="padding:12px;border-radius:12px;background:#f5f3ff;"><div style="font-size:12px;color:#6b7280;">沟通总数</div><div style="font-size:24px;font-weight:800;color:#6d28d9;">${records.length}</div></div>
            <div style="padding:12px;border-radius:12px;background:#ecfeff;"><div style="font-size:12px;color:#6b7280;">沟通方式</div><div style="font-size:13px;font-weight:700;color:#0f766e;">${Object.entries(methodStats).map(([k, v]) => `${escapeHtml(k)} ${v}`).join(' / ')}</div></div>
            <div style="padding:12px;border-radius:12px;background:#fff7ed;"><div style="font-size:12px;color:#6b7280;">高频标签</div><div style="font-size:13px;font-weight:700;color:#c2410c;">${escapeHtml(topTags.join(' / ') || '沟通')}</div></div>
            <div style="padding:12px;border-radius:12px;background:#eef2ff;"><div style="font-size:12px;color:#6b7280;">最近沟通</div><div style="font-size:13px;font-weight:700;color:#4338ca;">${escapeHtml(latestDate)}</div></div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:14px;">
            <div class="form-group" style="margin-bottom:0;flex:1;min-width:220px;">
                <label>搜索沟通</label>
                <input id="commSearchInput" type="text" placeholder="搜索联系人 / 摘要 / 方式" oninput="filterCommunicationTimeline()">
            </div>
            <div class="form-group" style="margin-bottom:0;min-width:160px;">
                <label>方式筛选</label>
                <select id="commMethodFilter" onchange="filterCommunicationTimeline()">
                    <option value="">全部方式</option>
                    ${Object.keys(methodStats).map(method => `<option value="${escapeAttr(method)}">${escapeHtml(method)}</option>`).join('')}
                </select>
            </div>
            <div class="form-group" style="margin-bottom:0;min-width:180px;">
                <label>标签筛选</label>
                <select id="commTagFilter" onchange="filterCommunicationTimeline()">
                    <option value="">全部标签</option>
                    ${allTags.map(tag => `<option value="${escapeAttr(tag)}">${escapeHtml(tag)}</option>`).join('')}
                </select>
            </div>
            <button class="btn btn-outline btn-sm" onclick="copyVisibleCommunications()">复制当前视图</button>
            <button class="btn btn-outline btn-sm" onclick="loadCommunications(${Number(projectId)})">刷新</button>
            <button class="btn btn-outline btn-sm" onclick="resetCommunicationFilters()">清空筛选</button>
        </div>
        <div style="margin-bottom:12px;font-size:13px;color:#64748b;">沟通时间线按倒序排列，可快速查看联系人、方式、标签和关键摘要。</div>
        <div id="communicationTimeline">
        ${records.map(r => {
            const tags = deriveCommTags(r);
            const searchText = `${r.contact_person || ''} ${r.contact_method || ''} ${r.summary || ''}`.toLowerCase();
            const summaryText = normalizeTextValue(r.summary, '无内容');
            const shortSummary = summaryText.length > 180 ? `${summaryText.slice(0, 180)}...` : summaryText;
            const metaText = `${r.contact_method || '未标记方式'} · ${r.contact_date || ''}`;
            return `
        <div class="comm-card" data-search="${escapeAttr(searchText)}" data-tags="${escapeAttr(tags.join(','))}" data-method="${escapeAttr(r.contact_method || '')}" data-record-id="${escapeAttr(r.id)}" data-contact-person="${escapeAttr(r.contact_person || '未填写联系人')}" data-contact-meta="${escapeAttr(metaText)}" data-summary="${escapeAttr(summaryText)}" style="padding:14px 16px;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:10px;background:#fff;position:relative;">
            <div style="position:absolute;left:-7px;top:20px;width:12px;height:12px;border-radius:50%;background:#8b5cf6;"></div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <div>
                    <div style="font-weight:700;color:#111827;">${escapeHtml(r.contact_person || '未填写联系人')}</div>
                    <div style="font-size:12px;color:#64748b;margin-top:4px;">${escapeHtml(metaText)}</div>
                </div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <button class="btn btn-outline btn-xs" onclick="copyCommunicationSummary(${r.id})">复制</button>
                    <button class="btn btn-outline btn-xs" onclick="editCommunication(${r.id}, ${projectId})">编辑</button>
                    <button class="btn btn-danger btn-xs" onclick="deleteCommunication(${r.id}, ${projectId})">删除</button>
                </div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
                ${tags.map(tag => `<span class="tag-pill">${escapeHtml(tag)}</span>`).join('')}
                ${r.related_issue_id ? `<span class="tag-pill" style="background:#fee2e2;color:#991b1b;">问题 #${escapeHtml(r.related_issue_id)}</span>` : ''}
            </div>
            <div style="font-size:13px;color:#374151;line-height:1.7;">
                ${summaryText.length > 180 ? `
                    <details>
                        <summary style="cursor:pointer;color:#475569;outline:none;">${escapeHtml(shortSummary)}</summary>
                        <div style="margin-top:8px;white-space:pre-wrap;">${escapeHtml(summaryText)}</div>
                    </details>
                ` : escapeHtml(summaryText)}
            </div>
            <div style="margin-top:8px;font-size:11px;color:#94a3b8;">创建于 ${escapeHtml(r.created_at || '-')} ${r.created_by ? `· 记录人 ${escapeHtml(r.created_by)}` : ''}</div>
        </div>
    `;
        }).join('')}
        </div>`;
    applyCommunicationFilterState();
    filterCommunicationTimeline(false);
}

async function showAddCommunicationModal() {
    if (!currentProjectId) {
        showToast('请先选择一个项目', 'warning');
        return;
    }
    currentEditingCommunicationId = null;
    document.getElementById('communicationModalTitle').textContent = '💬 添加沟通记录';
    const saveBtn = document.getElementById('saveCommunicationBtn');
    if (saveBtn) saveBtn.textContent = '保存';
    const dateEl = document.getElementById('commDate');
    const personEl = document.getElementById('commPerson');
    const methodEl = document.getElementById('commMethod');
    const summaryEl = document.getElementById('commSummary');
    if (dateEl) dateEl.value = todayIsoDate();
    if (personEl) personEl.value = '';
    if (methodEl) methodEl.value = '电话';
    if (summaryEl) summaryEl.value = '';
    showModal('communicationModal', { reset: false });
    populateCommunicationIssueOptions(currentProjectId, '');
}

async function editCommunication(recordId, projectId) {
    try {
        const record = await api.get(`/communications/${recordId}`);
        currentEditingCommunicationId = recordId;
        showModal('communicationModal', { reset: false });
        document.getElementById('communicationModalTitle').textContent = '💬 编辑沟通记录';
        const saveBtn = document.getElementById('saveCommunicationBtn');
        if (saveBtn) saveBtn.textContent = '更新';
        document.getElementById('commDate').value = record.contact_date || '';
        document.getElementById('commPerson').value = record.contact_person || '';
        document.getElementById('commMethod').value = record.contact_method || '电话';
        document.getElementById('commSummary').value = record.summary || '';
        await populateCommunicationIssueOptions(projectId, record.related_issue_id || '');
    } catch (e) {
        showToast('加载沟通记录失败: ' + e.message, 'danger');
    }
}

async function saveCommunication() {
    const data = {
        contact_date: document.getElementById('commDate').value || todayIsoDate(),
        contact_person: normalizeTextValue(document.getElementById('commPerson').value),
        contact_method: normalizeTextValue(document.getElementById('commMethod').value, '电话'),
        summary: normalizeTextValue(document.getElementById('commSummary').value),
        related_issue_id: document.getElementById('commIssueSelect')?.value || null
    };

    if (!data.summary) {
        showToast('请填写沟通内容', 'warning');
        return;
    }

    const saveBtn = document.getElementById('saveCommunicationBtn');
    const originalText = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = currentEditingCommunicationId ? '更新中...' : '保存中...';
    }

    try {
        if (currentEditingCommunicationId) {
            await api.put(`/communications/${currentEditingCommunicationId}`, data);
        } else {
            await api.post(`/projects/${currentProjectId}/communications`, data);
        }
        closeModal('communicationModal');
        currentEditingCommunicationId = null;
        await loadCommunications(currentProjectId);
        showToast('沟通记录已保存', 'success');
    } catch (e) {
        showToast('沟通记录保存失败: ' + e.message, 'danger');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = originalText;
        }
    }
}

async function copyCommunicationSummary(recordId) {
    try {
        const record = await api.get(`/communications/${recordId}`);
        await writeTextToClipboard(record.summary || '');
        showToast('沟通摘要已复制', 'success');
    } catch (e) {
        showToast('复制失败: ' + e.message, 'danger');
    }
}

async function deleteCommunication(recordId, projectId) {
    if (!confirm('确定删除这条沟通记录吗？')) return;
    try {
        await api.delete(`/communications/${recordId}`);
        await loadCommunications(projectId);
        showToast('沟通记录已删除', 'success');
    } catch (e) {
        showToast('删除沟通记录失败: ' + e.message, 'danger');
    }
}

function filterCommunicationTimeline(shouldSync = true) {
    if (shouldSync) syncCommunicationFilterState();
    const keyword = (communicationFilterState.keyword || '').trim().toLowerCase();
    const method = communicationFilterState.method || '';
    const tag = communicationFilterState.tag || '';
    const cards = document.querySelectorAll('#communicationTimeline .comm-card');
    let visible = 0;
    cards.forEach(card => {
        const search = card.dataset.search || '';
        const tags = card.dataset.tags || '';
        const cardMethod = card.dataset.method || '';
        const matchKeyword = !keyword || search.includes(keyword);
        const matchMethod = !method || cardMethod === method;
        const matchTag = !tag || tags.split(',').includes(tag);
        const ok = matchKeyword && matchMethod && matchTag;
        card.style.display = ok ? '' : 'none';
        if (ok) visible += 1;
    });
    const timeline = document.getElementById('communicationTimeline');
    const empty = document.getElementById('commTimelineEmpty');
    if (!timeline) return;
    if (!visible && !empty) {
        timeline.insertAdjacentHTML('beforeend', '<div id="commTimelineEmpty" class="empty-state"><p>未找到匹配的沟通记录</p></div>');
    } else if (visible && empty) {
        empty.remove();
    }
}

function resetCommunicationFilters() {
    communicationFilterState = {
        keyword: '',
        method: '',
        tag: ''
    };
    applyCommunicationFilterState();
    filterCommunicationTimeline(false);
}

async function copyVisibleCommunications() {
    const cards = Array.from(document.querySelectorAll('#communicationTimeline .comm-card'))
        .filter(card => card.style.display !== 'none');
    if (!cards.length) {
        showToast('当前没有可复制的沟通记录', 'warning');
        return;
    }

    const lines = ['【客户沟通记录导出】'];
    cards.forEach(card => {
        const name = card.dataset.contactPerson || '未填写联系人';
        const meta = card.dataset.contactMeta || '';
        const body = card.dataset.summary || '';
        lines.push('', `${name} | ${meta}`, body);
    });

    try {
        await writeTextToClipboard(lines.join('\n'));
        showToast('当前筛选结果已复制', 'success');
    } catch (e) {
        showToast('复制失败: ' + e.message, 'danger');
    }
}

function setCommunicationAnalysisContext(context) {
    latestCommunicationAnalysisContext = context ? { ...context } : null;
}

async function reAnalyzeCurrentCommunicationSource() {
    if (!latestCommunicationAnalysisContext) {
        showToast('暂无可重新分析的内容', 'warning');
        return;
    }

    if (latestCommunicationAnalysisContext.type === 'file' && latestCommunicationAnalysisContext.file) {
        await analyzeUploadedFile({ files: [latestCommunicationAnalysisContext.file], value: '' });
        return;
    }

    await analyzeCommunications();
}

function buildCommunicationAnalysisSummary() {
    const context = latestCommunicationAnalysisContext || {};
    const sourceLabel = context.type === 'file'
        ? `上传文件：${context.fileName || '未命名文件'}`
        : '项目沟通记录汇总';
    return [
        `【${context.type === 'file' ? '沟通文件 AI 分析报告' : '沟通记录 AI 分析报告'}】`,
        `来源：${sourceLabel}`,
        `生成时间：${new Date().toLocaleString()}`,
        '',
        latestCommunicationAiAnalysisMarkdown || ''
    ].join('\n');
}

async function saveCommunicationAiAnalysisToRecord() {
    const projectId = latestCommunicationAnalysisContext?.projectId || currentProjectId;
    if (!projectId) {
        showToast('请先选择一个项目', 'warning');
        return;
    }
    if (!latestCommunicationAiAnalysisMarkdown) {
        showToast('暂无可保存的分析内容', 'warning');
        return;
    }

    const context = latestCommunicationAnalysisContext || {};
    const contactPerson = context.type === 'file'
        ? `AI 文件分析 · ${context.fileName || '未命名文件'}`
        : 'AI 沟通分析';

    try {
        await api.post(`/projects/${projectId}/communications`, {
            contact_date: todayIsoDate(),
            contact_person: contactPerson,
            contact_method: 'AI分析',
            summary: buildCommunicationAnalysisSummary(),
            related_issue_id: null
        });
        await loadCommunications(projectId);
        showToast('AI 分析报告已保存到沟通记录', 'success');
    } catch (e) {
        showToast('保存分析报告失败: ' + e.message, 'danger');
    }
}

async function analyzeCommunications() {
    const target = document.getElementById('communicationAiAnalysis');
    latestCommunicationAiAnalysisMarkdown = '';
    if (!currentProjectId) {
        showToast('请先选择一个项目', 'warning');
        return;
    }
    if (!target) {
        showToast('分析面板未找到，请刷新页面后重试', 'danger');
        return;
    }
    target.style.display = 'block';
    target.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>AI 正在分析沟通记录...</p></div>';
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setCommunicationAnalysisContext({
        type: 'project',
        projectId: currentProjectId
    });

    try {
        const data = await api.post(`/projects/${currentProjectId}/communications/analyze`, {}, { silent: true });
        const analysis = data?.analysis || '';
        if (!analysis) {
            target.innerHTML = _renderAiError('AI 未返回有效分析结果');
            return;
        }
        target.innerHTML = _renderAiReport('沟通记录智能分析报告', '基于所有沟通记录的 AI 深度分析', analysis, '#8b5cf6', '#6366f1');
    } catch (e) {
        target.innerHTML = _renderAiError(e.message);
    }
}

async function analyzeUploadedFile(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    latestCommunicationAiAnalysisMarkdown = '';
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
                    <div style="font-size:12px;opacity:0.85;margin-top:2px;">${escapeHtml(file.name)}</div>
                </div>
                <div style="color:rgba(255,255,255,0.85);font-size:12px;">提取文本 → AI分析 → 生成报告</div>
            </div>
            <div style="padding:24px;"><div class="loading-spinner"><div class="spinner"></div><p>AI 正在解析上传文件...</p></div></div>
        </div>
    `;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('project_id', currentProjectId);
    setCommunicationAnalysisContext({
        type: 'file',
        projectId: currentProjectId,
        file,
        fileName: file.name
    });

    try {
        const data = await api.post(`/projects/${currentProjectId}/communications/analyze-file`, formData, { silent: true });
        const analysis = data?.analysis || '';
        if (!analysis) {
            target.innerHTML = _renderAiError('AI 未返回有效文件分析结果');
            return;
        }
        target.innerHTML = _renderAiReport('沟通文件智能分析报告', `基于上传文件的 AI 深度分析 · ${escapeHtml(file.name)}`, analysis, '#0ea5e9', '#2563eb');
    } catch (e) {
        target.innerHTML = _renderAiError(e.message);
    } finally {
        input.value = '';
    }
}

function _renderAiReport(title, subtitle, markdown, colorFrom, colorTo) {
    latestCommunicationAiAnalysisMarkdown = String(markdown || '');
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
                    <button onclick="reAnalyzeCurrentCommunicationSource()" style="background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.3);color:white;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12px;">🔄 重新分析</button>
                    <button onclick="saveCommunicationAiAnalysisToRecord()" style="background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.3);color:white;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12px;">📝 保存为沟通记录</button>
                    <button onclick="copyCommunicationAiAnalysis()" style="background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.3);color:white;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12px;">📋 复制</button>
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

async function copyCommunicationAiAnalysis(markdown) {
    const content = typeof markdown === 'string' ? markdown : latestCommunicationAiAnalysisMarkdown;
    if (!content) {
        showToast('暂无可复制的分析内容', 'warning');
        return;
    }
    try {
        await writeTextToClipboard(content);
        showToast('沟通分析内容已复制', 'success');
    } catch (e) {
        showToast('复制失败: ' + e.message, 'danger');
    }
}

function _renderAiError(msg) {
    latestCommunicationAiAnalysisMarkdown = '';
    return `
        <div style="background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden;">
            <div style="background:linear-gradient(135deg,#ef4444,#dc2626);padding:16px 24px;color:white;display:flex;align-items:center;gap:10px;">
                <span style="font-size:20px;">⚠️</span>
                <span style="font-weight:600;">分析失败</span>
                <button onclick="document.getElementById('communicationAiAnalysis').style.display='none'" style="margin-left:auto;background:rgba(255,255,255,0.2);border:none;color:white;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;">✕</button>
            </div>
            <div style="padding:24px;text-align:center;">
                <div style="color:#ef4444;font-size:14px;margin-bottom:12px;">${escapeHtml(msg)}</div>
                <button class="btn btn-outline btn-sm" onclick="reAnalyzeCurrentCommunicationSource()">🔄 重试</button>
            </div>
        </div>
    `;
}

function showMeetingAssistant() {
    const input = document.getElementById('meetingTranscript');
    const result = document.getElementById('meetingResult');
    const empty = document.getElementById('meetingResultEmpty');
    const actions = document.getElementById('meetingResultActions');
    const meta = document.getElementById('meetingResultMeta');
    const issueSelect = document.getElementById('meetingSaveIssueSelect');
    if (input) input.value = '';
    if (result) {
        result.style.display = 'none';
        result.innerHTML = '';
    }
    if (empty) empty.style.display = 'flex';
    if (actions) actions.style.display = 'none';
    hideMeetingSaveDraftPanel();
    if (meta) meta.style.display = 'none';
    if (issueSelect) issueSelect.value = '';
    window.latestMeetingAssistantResult = null;
    openModal('meetingAssistantModal');
}

async function extractMeetingActions() {
    const source = document.getElementById('meetingTranscript')?.value?.trim() || '';
    const result = document.getElementById('meetingResult');
    const empty = document.getElementById('meetingResultEmpty');
    const actions = document.getElementById('meetingResultActions');
    const meta = document.getElementById('meetingResultMeta');
    if (!source) {
        showToast('请先粘贴会议内容', 'warning');
        return;
    }
    if (!result) return;
    if (empty) empty.style.display = 'none';
    if (actions) actions.style.display = 'none';
    if (meta) {
        meta.textContent = '提取中...';
        meta.style.display = 'block';
        meta.style.background = '#eff6ff';
        meta.style.color = '#1d4ed8';
    }
    result.style.display = 'block';
    result.innerHTML = '<div class="loading-spinner" style="padding:40px 0;"><div class="spinner"></div><p>AI 正在提取纪要、待办与风险...</p></div>';

    try {
        const response = await api.post('/collab/meeting-actions', { transcript: source });
        const answer = typeof response === 'string' ? response : (response?.content || response?.answer || response?.result || JSON.stringify(response, null, 2));
        window.latestMeetingAssistantResult = {
            rawMarkdown: answer,
            transcript: source,
            parsed: parseMeetingAssistantMarkdown(answer)
        };
        result.innerHTML = renderMeetingAssistantResult(window.latestMeetingAssistantResult);
        if (actions) actions.style.display = 'flex';
        prefillMeetingSaveDraft();
        if (meta) {
            meta.textContent = '已生成';
            meta.style.background = '#ecfeff';
            meta.style.color = '#0f766e';
        }
    } catch (e) {
        result.innerHTML = `<div style="padding:18px;border-radius:16px;background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;">提取失败: ${escapeHtml(e.message)}</div>`;
        if (meta) {
            meta.textContent = '失败';
            meta.style.background = '#fef2f2';
            meta.style.color = '#b91c1c';
        }
    }
}

function clearMeetingAssistant() {
    const input = document.getElementById('meetingTranscript');
    if (input) input.value = '';
    showMeetingAssistant();
}

async function showMeetingSaveDraftPanel() {
    const payload = window.latestMeetingAssistantResult;
    if (!payload?.rawMarkdown) {
        showToast('请先生成会议提取结果', 'warning');
        return;
    }
    const panel = document.getElementById('meetingSaveDraftPanel');
    if (panel) panel.style.display = 'block';
    if (currentProjectId) {
        await populateMeetingIssueOptions(currentProjectId);
    }
    prefillMeetingSaveDraft();
}

function hideMeetingSaveDraftPanel() {
    const panel = document.getElementById('meetingSaveDraftPanel');
    if (panel) panel.style.display = 'none';
}

function prefillMeetingSaveDraft(forceReset = false) {
    const payload = window.latestMeetingAssistantResult;
    if (!payload?.rawMarkdown) return;

    const contactInput = document.getElementById('meetingSaveContactPerson');
    const dateInput = document.getElementById('meetingSaveDate');
    const methodInput = document.getElementById('meetingSaveMethod');
    const titleInput = document.getElementById('meetingSaveTitle');
    const summaryInput = document.getElementById('meetingSaveSummary');
    const today = todayIsoDate();

    if (contactInput && (forceReset || !contactInput.value.trim())) {
        contactInput.value = extractMeetingPrimaryOwner(payload);
    }
    if (dateInput && (forceReset || !dateInput.value)) {
        dateInput.value = today;
    }
    if (methodInput && (forceReset || !methodInput.value)) {
        methodInput.value = '会议';
    }
    if (titleInput && (forceReset || !titleInput.value.trim())) {
        titleInput.value = 'AI会议助手提取纪要';
    }
    if (summaryInput && (forceReset || !summaryInput.value.trim())) {
        summaryInput.value = buildMeetingCommunicationSummary(payload, titleInput?.value || 'AI会议助手提取纪要');
    }
}

function parseMeetingAssistantMarkdown(markdown) {
    const text = String(markdown || '').replace(/\r\n/g, '\n');
    const sections = {};
    let currentSection = '';

    text.split('\n').forEach(line => {
        const headingMatch = line.match(/^\s*#{2,6}\s*(.+?)\s*$/);
        if (headingMatch) {
            currentSection = headingMatch[1].trim();
            sections[currentSection] = sections[currentSection] || [];
            return;
        }
        if (currentSection) {
            sections[currentSection].push(line);
        }
    });

    const normalizedSections = Object.fromEntries(
        Object.entries(sections).map(([key, lines]) => [key, lines.join('\n').trim()])
    );

    const summaryKey = Object.keys(normalizedSections).find(key => key.includes('会议纪要摘要') || key.includes('纪要摘要'));
    const actionsKey = Object.keys(normalizedSections).find(key => key.includes('待办事项') || key.includes('行动项'));
    const riskKey = Object.keys(normalizedSections).find(key => key.includes('风险提醒') || key.includes('风险'));
    let summary = parseMeetingSectionItems(normalizedSections[summaryKey] || '');
    let actions = parseMeetingSectionItems(normalizedSections[actionsKey] || '');
    let risks = parseMeetingSectionItems(normalizedSections[riskKey] || '');

    if (!summary.length && !actions.length && !risks.length) {
        const fallbackItems = parseMeetingSectionItems(text);
        summary = fallbackItems.slice(0, 4);
        actions = fallbackItems.filter(line => /待办|跟进|完成|确认|安排|推进|负责|deadline|截至/i.test(line)).slice(0, 6);
        risks = fallbackItems.filter(line => /风险|问题|阻塞|延期|异常|注意|隐患/i.test(line)).slice(0, 6);
    }

    return {
        summary,
        actions,
        risks
    };
}

function parseMeetingSectionItems(content) {
    return String(content || '')
        .split('\n')
        .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, '').trim())
        .filter(Boolean);
}

function renderMeetingAssistantResult(payload) {
    const parsed = payload?.parsed || {};
    const summaryItems = parsed.summary || [];
    const actionItems = parsed.actions || [];
    const riskItems = parsed.risks || [];
    const renderedSections = [
        renderMeetingSectionCard('纪要摘要', '提炼本次会议的关键共识与结论', summaryItems, '#dbeafe', '#1d4ed8', '🧭'),
        renderMeetingSectionCard('待办事项', '建议会后立即推进或确认的任务', actionItems, '#dcfce7', '#15803d', '✅'),
        renderMeetingSectionCard('风险提醒', '可能影响交付、范围或协同效率的事项', riskItems, '#fee2e2', '#dc2626', '⚠️')
    ].join('');

    const markdownPreview = renderAiMarkdown(payload?.rawMarkdown || '');

    return `
        <div style="display:grid;gap:14px;">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;">
                <div style="padding:16px;border-radius:16px;background:linear-gradient(135deg,#eff6ff,#ffffff);border:1px solid #dbeafe;">
                    <div style="font-size:12px;color:#64748b;">摘要要点</div>
                    <div style="margin-top:6px;font-size:28px;font-weight:800;color:#1d4ed8;">${summaryItems.length}</div>
                </div>
                <div style="padding:16px;border-radius:16px;background:linear-gradient(135deg,#ecfdf5,#ffffff);border:1px solid #d1fae5;">
                    <div style="font-size:12px;color:#64748b;">待办数量</div>
                    <div style="margin-top:6px;font-size:28px;font-weight:800;color:#15803d;">${actionItems.length}</div>
                </div>
                <div style="padding:16px;border-radius:16px;background:linear-gradient(135deg,#fff7ed,#ffffff);border:1px solid #fed7aa;">
                    <div style="font-size:12px;color:#64748b;">风险提醒</div>
                    <div style="margin-top:6px;font-size:28px;font-weight:800;color:#ea580c;">${riskItems.length}</div>
                </div>
            </div>
            <div style="display:grid;gap:12px;">${renderedSections}</div>
            <details style="border:1px solid #e2e8f0;border-radius:16px;background:#fafcff;">
                <summary style="cursor:pointer;padding:14px 16px;font-weight:700;color:#334155;">查看原始 Markdown 结果</summary>
                <div style="padding:0 16px 16px 16px;" class="markdown-content">${markdownPreview}</div>
            </details>
        </div>
    `;
}

function renderMeetingSectionCard(title, subtitle, items, borderColor, accentColor, icon) {
    const content = items.length
        ? `<div style="display:grid;gap:10px;">${items.map((item, index) => `
            <div style="display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:14px;background:#ffffff;border:1px solid #e2e8f0;">
                <div style="width:24px;height:24px;flex:0 0 24px;border-radius:999px;background:${accentColor};color:white;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;">${index + 1}</div>
                <div style="font-size:14px;line-height:1.7;color:#1f2937;">${escapeHtml(item)}</div>
            </div>
        `).join('')}</div>`
        : '<div style="padding:16px;border-radius:14px;background:#ffffff;border:1px dashed #cbd5e1;color:#94a3b8;font-size:13px;">本段未提取到明确内容</div>';

    return `
        <section style="border:1px solid ${borderColor};border-radius:18px;background:linear-gradient(180deg,#ffffff 0%,#f8fafc 100%);padding:16px;">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
                <div style="width:38px;height:38px;border-radius:14px;background:${borderColor};display:flex;align-items:center;justify-content:center;font-size:18px;">${icon}</div>
                <div>
                    <div style="font-size:17px;font-weight:800;color:#0f172a;">${title}</div>
                    <div style="font-size:12px;color:#64748b;">${subtitle}</div>
                </div>
            </div>
            ${content}
        </section>
    `;
}

async function saveMeetingToCommunication() {
    const payload = window.latestMeetingAssistantResult;
    if (!currentProjectId) {
        showToast('请先选择一个项目', 'warning');
        return;
    }
    if (!payload?.rawMarkdown) {
        showToast('请先生成会议提取结果', 'warning');
        return;
    }

    const contactPerson = (document.getElementById('meetingSaveContactPerson')?.value || '').trim() || extractMeetingPrimaryOwner(payload);
    const contactDate = document.getElementById('meetingSaveDate')?.value || todayIsoDate();
    const contactMethod = document.getElementById('meetingSaveMethod')?.value || '会议';
    const title = (document.getElementById('meetingSaveTitle')?.value || '').trim() || 'AI会议助手提取纪要';
    const summaryText = (document.getElementById('meetingSaveSummary')?.value || '').trim() || buildMeetingCommunicationSummary(payload, title);
    const relatedIssueId = document.getElementById('meetingSaveIssueSelect')?.value || null;
    const saveBtn = document.getElementById('meetingSaveDraftBtn');
    const originalText = saveBtn ? saveBtn.textContent : '';

    if (!summaryText) {
        showToast('请先补充要保存的摘要内容', 'warning');
        return;
    }

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = '保存中...';
    }

    try {
        await api.post(`/projects/${currentProjectId}/communications`, {
            contact_date: contactDate,
            contact_person: contactPerson,
            contact_method: contactMethod,
            summary: summaryText,
            related_issue_id: relatedIssueId
        });
        showToast('会议纪要已保存到沟通记录', 'success');
        closeModal('meetingAssistantModal');
        focusProjectCommunicationsTab();
        if (typeof loadCommunications === 'function') {
            await loadCommunications(currentProjectId);
        }
    } catch (e) {
        showToast('保存到沟通记录失败: ' + e.message, 'danger');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = originalText;
        }
    }
}

function buildMeetingCommunicationSummary(payload, title = 'AI会议助手提取纪要') {
    const parsed = payload?.parsed || {};
    const lines = [`【${title}】`];
    if (parsed.summary?.length) {
        lines.push('纪要摘要:');
        parsed.summary.forEach(item => lines.push(`- ${item}`));
    }
    if (parsed.actions?.length) {
        lines.push('', '待办事项:');
        parsed.actions.forEach(item => lines.push(`- ${item}`));
    }
    if (parsed.risks?.length) {
        lines.push('', '风险提醒:');
        parsed.risks.forEach(item => lines.push(`- ${item}`));
    }
    return lines.join('\n');
}

function extractMeetingPrimaryOwner(payload) {
    const actionText = (payload?.parsed?.actions || []).join(' ');
    const ownerMatch = actionText.match(/(?:责任[人方]|owner|负责人)[:：]?\s*([^\s，,。；;]+)/i)
        || actionText.match(/[:：]\s*([^\s，,。；;]+)/);
    return ownerMatch?.[1] || '会议纪要';
}

async function copyMeetingAssistantResult() {
    const payload = window.latestMeetingAssistantResult;
    if (!payload?.rawMarkdown) {
        showToast('请先生成会议提取结果', 'warning');
        return;
    }
    try {
        await writeTextToClipboard(payload.rawMarkdown);
        showToast('会议结果已复制', 'success');
    } catch (e) {
        showToast('复制失败: ' + e.message, 'danger');
    }
}

function focusProjectCommunicationsTab() {
    const tabs = document.querySelectorAll('#projectDetailView .tabs .tab');
    tabs.forEach(tab => {
        const onclickStr = tab.getAttribute('onclick') || '';
        if (onclickStr.includes("'communications'")) {
            tab.click();
        }
    });
}
