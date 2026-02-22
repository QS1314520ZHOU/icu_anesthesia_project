/**
 * 知识库模块 JavaScript - 增强版
 */

function initKB() {
    loadKBList();
}

async function loadKBList() {
    const search = document.getElementById('kbSearchInput').value;
    const category = document.getElementById('kbCategoryFilter').value;

    let url = '/kb';
    const params = [];
    if (search) params.push(`search=${encodeURIComponent(search)}`);
    if (category) params.push(`category=${encodeURIComponent(category)}`);
    if (params.length > 0) url += '?' + params.join('&');

    try {
        const data = await api.get(url);
        renderKBList(data);
    } catch (e) {
        console.error('加载知识库失败', e);
    }
}

// 全局变量用于跟踪当前编辑的ID
let currentEditingKBId = null;

function renderKBList(items) {
    const container = document.getElementById('kbListContainer');
    if (!items || items.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="grid-column: 1/-1;">
                <div class="empty-state-icon">📚</div>
                <div class="empty-state-text">暂无相关知识案例</div>
                <div class="empty-state-hint">点击右上角"新增案例"来沉淀经验吧</div>
            </div>
        `;
        return;
    }

    container.innerHTML = items.map(item => {
        const tags = item.tags ? item.tags.split(',').map(tag => `<span class="tag-pill">${tag.trim()}</span>`).join('') : '';

        // 处理预览内容：如果是 Markdown，尝试渲染或去掉标记，并截断
        let previewContent = item.content;
        if (typeof marked !== 'undefined') {
            // 简单处理：去掉表格和复杂标记，只保留文字
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = marked.parse(item.content);
            previewContent = tempDiv.innerText || tempDiv.textContent || item.content;
        }

        const truncatedContent = previewContent.length > 150
            ? previewContent.substring(0, 150) + '...'
            : previewContent;

        return `
            <div class="kb-card" onclick="viewKBItem(${item.id})">
                <div class="kb-card-tag">${item.category}</div>
                <h3 class="kb-card-title">${item.title}</h3>
                <div class="kb-card-content" style="white-space: pre-wrap; word-break: break-all;">${truncatedContent}</div>
                <div class="kb-card-footer">
                    <div class="kb-tags">${tags}</div>
                    <span>👤 ${item.author || '匿名'} | 📅 ${(item.created_at || '').split(' ')[0]}</span>
                </div>
                 <div class="kb-card-actions" style="margin-top: 10px; border-top: 1px solid #eee; padding-top: 8px; display: flex; justify-content: flex-end; gap: 8px;">
                    <button class="btn btn-primary btn-xs" onclick="event.stopPropagation(); editKBItem(${item.id})">编辑</button>
                    <button class="btn btn-danger btn-xs" onclick="event.stopPropagation(); deleteKBItem(${item.id})">删除</button>
                </div>
            </div>
        `;
    }).join('');
}

function searchKB() {
    loadKBList();
}

async function openKBModal() {
    currentEditingKBId = null; // 重置编辑ID
    document.querySelector('#kbModal .modal-header h3').textContent = '新增知识库案例';

    // 填充项目下拉框
    const projectSelect = document.getElementById('kbProject');
    projectSelect.innerHTML = '<option value="">无关联</option>';
    try {
        const projects = await api.get('/projects');
        projects.forEach(p => {
            projectSelect.innerHTML += `<option value="${p.id}">${p.hospital_name} - ${p.project_name}</option>`;
        });
    } catch (e) {
        console.error('获取项目列表失败', e);
    }

    document.getElementById('kbForm').reset();
    showModal('kbModal');
}

async function editKBItem(id) {
    currentEditingKBId = id;
    document.querySelector('#kbModal .modal-header h3').textContent = '编辑知识库案例';

    try {
        // 先加载项目列表
        const projectSelect = document.getElementById('kbProject');
        if (projectSelect.options.length <= 1) {
            const projects = await api.get('/projects');
            projectSelect.innerHTML = '<option value="">无关联</option>';
            projects.forEach(p => {
                projectSelect.innerHTML += `<option value="${p.id}">${p.hospital_name} - ${p.project_name}</option>`;
            });
        }

        const item = await api.get(`/kb/${id}`);
        document.getElementById('kbCategory').value = item.category;
        document.getElementById('kbTitle').value = item.title;
        document.getElementById('kbContent').value = item.content;
        document.getElementById('kbTags').value = item.tags || '';
        document.getElementById('kbAssocStage').value = item.assoc_stage || '';
        document.getElementById('kbProject').value = item.project_id || '';
        document.getElementById('kbAuthor').value = item.author || '';
        document.getElementById('kbExternalLink').value = item.external_link || '';

        showModal('kbModal');
    } catch (e) {
        alert('加载案例详情失败: ' + e.message);
    }
}

async function deleteKBItem(id) {
    if (!confirm('确定要删除这个案例吗？此操作无法撤销。')) return;
    try {
        await api.delete(`/kb/${id}`);
        loadKBList();
    } catch (e) {
        alert('删除失败: ' + e.message);
    }
}

async function saveKBItem() {
    const formData = new FormData();
    formData.append('category', document.getElementById('kbCategory').value);
    formData.append('title', document.getElementById('kbTitle').value);
    formData.append('content', document.getElementById('kbContent').value);
    formData.append('tags', document.getElementById('kbTags').value);
    formData.append('assoc_stage', document.getElementById('kbAssocStage').value || '');
    formData.append('project_id', document.getElementById('kbProject').value || '');
    formData.append('author', document.getElementById('kbAuthor').value || 'System');
    formData.append('external_link', document.getElementById('kbExternalLink').value || '');

    const fileInput = document.getElementById('kbAttachment');
    if (fileInput.files.length > 0) {
        formData.append('attachment', fileInput.files[0]);
    }

    if (!formData.get('title') || !formData.get('content')) {
        alert('请填写标题和详细内容');
        return;
    }

    try {
        if (currentEditingKBId) {
            await api.put(`/kb/${currentEditingKBId}`, formData);
            alert('案例已更新');
        } else {
            await api.post('/kb', formData);
            alert('案例已创建');
        }
        closeModal('kbModal');
        loadKBList();
    } catch (e) {
        alert('保存失败: ' + e.message);
    }
}

async function viewKBItem(id) {
    try {
        const item = await api.get(`/kb/${id}`);
        document.getElementById('kbDetailTitle').textContent = item.title;
        document.getElementById('kbDetailCategory').textContent = item.category;
        document.getElementById('kbDetailAuthor').textContent = item.author || '匿名';
        document.getElementById('kbDetailDate').textContent = item.updated_at || item.created_at;

        // 使用 marked 渲染 Markdown
        const contentHtml = typeof marked !== 'undefined' ? marked.parse(item.content) : item.content;
        document.getElementById('kbDetailContent').innerHTML = contentHtml;

        // 渲染资源区 (附件与外链)
        const resourceContainer = document.getElementById('kbDetailResources');
        const attachmentDiv = document.getElementById('kbDetailAttachment');
        const linkDiv = document.getElementById('kbDetailLink');
        let hasResource = false;

        attachmentDiv.innerHTML = '';
        linkDiv.innerHTML = '';

        if (item.attachment_path) {
            hasResource = true;
            attachmentDiv.innerHTML = `<a href="/api/kb/${item.id}/download" class="text-primary" target="_blank">⬇️ 下载附件</a>`;
        }

        if (item.external_link) {
            hasResource = true;
            linkDiv.innerHTML = `<a href="${item.external_link}" class="text-primary" target="_blank">🔗 外部链接: ${item.external_link}</a>`;
        }

        resourceContainer.style.display = hasResource ? 'block' : 'none';

        const tagsContainer = document.getElementById('kbDetailTags');
        tagsContainer.innerHTML = '';
        if (item.tags) {
            item.tags.split(',').forEach(tag => {
                const span = document.createElement('span');
                span.className = 'tag-pill';
                span.textContent = tag.trim();
                tagsContainer.appendChild(span);
            });
        }

        showModal('kbDetailModal');
    } catch (e) {
        alert('获取详情失败: ' + e.message);
    }
}

/**
 * 加载项目关联的上下文推荐
 */
async function loadContextualRecommendations(stageName) {
    const container = document.getElementById('contextualKB');
    const list = document.getElementById('contextualKBList');

    if (!container || !list) return;

    if (!stageName) {
        container.style.display = 'none';
        return;
    }

    try {
        // 后端支持查询 assoc_stage
        const items = await api.get(`/kb?category=&search=&assoc_stage=${encodeURIComponent(stageName)}`);

        if (items.length === 0) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'block';
        list.innerHTML = items.map(item => `
            <div class="kb-recommend-item" onclick="viewKBItem(${item.id})" style="padding:10px; border-bottom:1px solid #eee; cursor:pointer; hover:background:#f9f9f9;">
                <div style="font-weight:600; color:var(--primary);">${item.title}</div>
                <div style="font-size:11px; color:#999; margin-top:4px;">${item.category}</div>
            </div>
        `).join('');
    } catch (e) {
        console.error('推荐加载失败', e);
    }
}

async function askKbAi() {
    const input = document.getElementById('kbAiQuery');
    const question = input.value.trim();
    if (!question) return;

    const chatMessages = document.getElementById('kbAiChatMessages');

    // 1. 显示用户提问
    const userMsgDiv = document.createElement('div');
    userMsgDiv.style.margin = '8px 0';
    userMsgDiv.style.textAlign = 'right';
    userMsgDiv.innerHTML = `<span style="background: #fdf2f8; padding: 6px 12px; border-radius: 12px; border: 1px solid #fbcfe8; display: inline-block; max-width: 80%;">
        ${question}
    </span>`;
    chatMessages.appendChild(userMsgDiv);
    input.value = '';

    // 2. 显示加载状态
    const loadingDiv = document.createElement('div');
    loadingDiv.style.margin = '8px 0';
    loadingDiv.innerHTML = `<div style="display: flex; gap: 8px; align-items: flex-start;">
        <span style="font-size: 18px;">🧠</span>
        <span style="background: #f3f4f6; padding: 6px 12px; border-radius: 12px; color: #666;">
            正在翻阅知识库...
        </span>
    </div>`;
    chatMessages.appendChild(loadingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
        const response = await api.post('/ai/ask-kb', { question });

        // 3. 移除加载，显示 AI 回复
        loadingDiv.remove();
        const aiMsgDiv = document.createElement('div');
        aiMsgDiv.style.margin = '12px 0';

        // 使用 marked 渲染（如果可用）
        const renderedAnswer = typeof marked !== 'undefined' ? marked.parse(response.answer) : response.answer;

        aiMsgDiv.innerHTML = `<div style="display: flex; gap: 8px; align-items: flex-start;">
            <span style="font-size: 18px;">🧠</span>
            <div style="background: #f3f4f6; padding: 8px 14px; border-radius: 12px; border: 1px solid #e5e7eb; max-width: 90%;">
                <div class="markdown-content">${renderedAnswer}</div>
                ${response.has_context ? '<div style="font-size: 10px; color: #db2777; margin-top: 8px; border-top: 1px solid #e5e7eb; padding-top: 4px;">✅ 已匹配相关知识案例</div>' : ''}
            </div>
        </div>`;
        chatMessages.appendChild(aiMsgDiv);
    } catch (e) {
        loadingDiv.remove();
        alert('咨询失败: ' + e.message);
    }

    chatMessages.scrollTop = chatMessages.scrollHeight;
}
