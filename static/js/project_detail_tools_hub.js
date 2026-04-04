// Project-detail tools extracted from project_detail_hub.js

let interfaceTemplatesCache = null;
window.interfaceTemplateFeedback = window.interfaceTemplateFeedback || JSON.parse(localStorage.getItem('interface_template_feedback') || '{}');

function getProjectCategory() {
    if (!currentProject) return 'common';
    const hasICU = (currentProject.icu_beds || 0) > 0;
    const hasOR = (currentProject.operating_rooms || 0) > 0;

    if (hasICU && hasOR) return 'both';
    if (hasICU) return 'icu';
    if (hasOR) return 'anesthesia';
    return 'common';
}

async function loadInterfaceTemplates() {
    if (interfaceTemplatesCache) return interfaceTemplatesCache;
    try {
        const response = await fetch('/static/data/interface_templates.json');
        interfaceTemplatesCache = await response.json();
        return interfaceTemplatesCache;
    } catch (e) {
        console.error('加载接口模板失败', e);
        return [];
    }
}

function getFilteredTemplates(templates, category) {
    if (category === 'both') return templates;
    if (category === 'icu') return templates.filter(t => t.category === 'icu' || t.category === 'common');
    if (category === 'anesthesia') return templates.filter(t => t.category === 'anesthesia' || t.category === 'common');
    return templates.filter(t => t.category === 'common');
}

async function populateInterfaceTemplateSelect() {
    const select = document.getElementById('interfaceTemplateSelect');
    if (!select) return;

    const templates = await loadInterfaceTemplates();
    const category = getProjectCategory();
    const filtered = getFilteredTemplates(templates, category);
    const groups = {
        icu: { label: '🏥 重症(ICU)接口', items: [] },
        anesthesia: { label: '💉 手麻接口', items: [] },
        common: { label: '🔗 通用接口', items: [] }
    };

    filtered.forEach(t => {
        if (groups[t.category]) groups[t.category].items.push(t);
    });

    let html = '<option value="">-- 选择接口模板 --</option>';
    Object.values(groups).forEach(group => {
        if (group.items.length <= 0) return;
        html += `<optgroup label="${group.label}">`;
        group.items.forEach(t => {
            const importantMark = t.important ? '⭐ ' : '';
            const viewMark = t.view_name ? ` [${t.view_name}]` : '';
            html += `<option value="${t.id}">${importantMark}${t.interface_name}${viewMark}</option>`;
        });
        html += '</optgroup>';
    });

    select.innerHTML = html;

    const categoryHint = document.getElementById('interfaceCategoryHint');
    if (categoryHint) {
        const categoryNames = {
            both: '重症+手麻',
            icu: '重症(ICU)',
            anesthesia: '手术麻醉',
            common: '通用'
        };
        categoryHint.textContent = `当前项目类型: ${categoryNames[category] || '未知'}`;
    }
}

async function showInterfaceModal() {
    document.getElementById('interfaceForm').reset();
    await populateInterfaceTemplateSelect();
    showModal('interfaceModal');
}

async function applyInterfaceTemplate(templateId) {
    if (!templateId) return;
    try {
        const templates = await loadInterfaceTemplates();
        const template = templates.find(t => t.id === templateId);
        if (!template) return;

        document.getElementById('systemName').value = template.system_name;
        document.getElementById('interfaceName').value = template.interface_name;
        let remark = template.remark;
        if (template.view_name) remark = `视图: ${template.view_name}\n${remark}`;
        if (template.protocol) remark += `\n建议协议: ${template.protocol}`;
        document.getElementById('interfaceRemark').value = remark;
    } catch (e) {
        console.error('更新接口模板失败', e);
    }
}

function saveTemplateFeedback(templateId, useful) {
    window.interfaceTemplateFeedback[String(templateId)] = {
        useful: !!useful,
        updated_at: new Date().toISOString()
    };
    localStorage.setItem('interface_template_feedback', JSON.stringify(window.interfaceTemplateFeedback));
    showToast(useful ? '已记录为有效模板' : '已记录为待优化模板', 'success');
}

function markCurrentTemplateFeedback(useful) {
    const select = document.getElementById('interfaceTemplateSelect');
    const templateId = select ? select.value : '';
    if (!templateId) {
        showToast('请先选择一个接口模板', 'warning');
        return;
    }
    saveTemplateFeedback(templateId, useful);
}

async function batchAddRecommendedInterfaces() {
    if (!currentProjectId) {
        showToast('请先选择项目', 'warning');
        return;
    }

    const templates = await loadInterfaceTemplates();
    const category = getProjectCategory();
    const filtered = getFilteredTemplates(templates, category);
    const importantOnly = confirm('是否只添加标记为"重要"的核心接口？\n\n点击"确定"添加核心接口\n点击"取消"添加全部推荐接口');
    const toAdd = importantOnly ? filtered.filter(t => t.important) : filtered;

    if (toAdd.length === 0) {
        showToast('没有可添加的接口', 'warning');
        return;
    }
    if (!confirm(`将添加 ${toAdd.length} 个接口，确认？`)) return;

    let successCount = 0;
    for (const t of toAdd) {
        try {
            let remark = t.remark;
            if (t.view_name) remark = `视图: ${t.view_name} | ${remark}`;

            await api.post(`/projects/${currentProjectId}/interfaces`, {
                system_name: t.system_name,
                interface_name: t.interface_name,
                status: '待开发',
                remark: remark
            });
            successCount++;
        } catch (e) {
            console.error(`添加接口 ${t.interface_name} 失败`, e);
        }
    }

    showToast(`成功添加 ${successCount}/${toAdd.length} 个接口`, 'success');
    loadProjectDetail(currentProjectId, true);
}

async function saveDocument() {
    const fileInput = document.getElementById('docFile');
    const formData = new FormData();
    if (fileInput.files.length > 0) {
        formData.append('file', fileInput.files[0]);
    }
    formData.append('doc_name', document.getElementById('docName').value || (fileInput.files[0] ? fileInput.files[0].name : '未命名'));
    formData.append('doc_type', document.getElementById('docType').value);
    formData.append('doc_category', document.getElementById('docCategory').value);
    formData.append('version', document.getElementById('docVersion').value);
    formData.append('upload_by', document.getElementById('docUploadBy').value);

    const uploadBtn = Array.from(document.querySelectorAll('#documentModal .btn')).find(btn => btn.textContent.includes('上传'));
    const originalText = uploadBtn ? uploadBtn.textContent : '';
    if (uploadBtn) {
        uploadBtn.disabled = true;
        uploadBtn.textContent = '上传中...';
    }
    try {
        const response = await fetch(`/api/projects/${currentProjectId}/documents`, { method: 'POST', body: formData });
        const data = await response.json();
        if (!data.success) {
            throw new Error(data.message || data.error || '上传失败');
        }
        closeModal('documentModal');
        await loadDocuments(currentProjectId);
        showToast(`文档上传成功：${document.getElementById('docName').value || (fileInput.files[0] ? fileInput.files[0].name : '未命名')}`, 'success');
    } catch (e) {
        showToast(`文档上传失败: ${e.message}`, 'danger');
    } finally {
        if (uploadBtn) {
            uploadBtn.disabled = false;
            uploadBtn.textContent = originalText;
        }
    }
}
