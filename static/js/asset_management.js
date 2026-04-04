/**
 * 硬件资产管理 JavaScript
 */

let currentEditingAssetId = null;
const ASSET_STATUS_OPTIONS = ['在库', '在途', '借出', '现场已安装', '返修中', '已报废'];

function escapeAssetText(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function initAssets() {
    loadAssets();
}

async function loadAssets() {
    const status = document.getElementById('assetStatusFilter').value;
    let url = '/assets';
    if (status) url += `?status=${encodeURIComponent(status)}`;

    try {
        const assets = await api.get(url);
        renderAssets(assets);
        renderAssetStats(assets);
    } catch (e) {
        console.error('加载资产失败', e);
        const tbody = document.getElementById('assetTableBody');
        const stats = document.getElementById('assetStatsGrid');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="color:var(--danger);">资产加载失败，请稍后重试</td></tr>';
        }
        if (stats) {
            stats.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><p>资产统计加载失败</p></div>';
        }
        showToast('加载资产失败: ' + e.message, 'danger');
    }
}

function renderAssetStats(assets) {
    const container = document.getElementById('assetStatsGrid');
    if (!container) return;

    const deployedStatuses = ['现场已安装', '现场运行'];
    const repairStatuses = ['返修中', '维修中'];
    const transitStatuses = ['在途', '借出'];

    // 即使过滤了，也从全量加载（偷懒做法，此处实际应从专门 API 获取）
    const stats = {
        total: assets.length,
        inStock: assets.filter(a => a.status === '在库').length,
        deployed: assets.filter(a => deployedStatuses.includes(a.status)).length,
        repair: assets.filter(a => repairStatuses.includes(a.status)).length,
        transit: assets.filter(a => transitStatuses.includes(a.status)).length
    };

    container.innerHTML = `
        <div class="asset-stat-card">
            <div class="asset-stat-icon" style="background: #dbeafe; color: #1e40af;">📦</div>
            <div class="asset-stat-info">
                <h4>总资产数</h4>
                <p>${stats.total}</p>
            </div>
        </div>
        <div class="asset-stat-card">
            <div class="asset-stat-icon" style="background: #d1fae5; color: #065f46;">🏠</div>
            <div class="asset-stat-info">
                <h4>在库数</h4>
                <p>${stats.inStock}</p>
            </div>
        </div>
        <div class="asset-stat-card">
            <div class="asset-stat-icon" style="background: #fef3c7; color: #92400e;">🏥</div>
            <div class="asset-stat-info">
                <h4>已部署</h4>
                <p>${stats.deployed}</p>
            </div>
        </div>
        <div class="asset-stat-card">
            <div class="asset-stat-icon" style="background: #e0f2fe; color: #0369a1;">🚚</div>
            <div class="asset-stat-info">
                <h4>在途/借出</h4>
                <p>${stats.transit}</p>
            </div>
        </div>
        <div class="asset-stat-card">
            <div class="asset-stat-icon" style="background: #fee2e2; color: #991b1b;">🛠️</div>
            <div class="asset-stat-info">
                <h4>返修中</h4>
                <p>${stats.repair}</p>
            </div>
        </div>
    `;
}

function renderAssets(assets) {
    const tbody = document.getElementById('assetTableBody');
    if (!assets || assets.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">暂无资产记录</td></tr>';
        return;
    }

    tbody.innerHTML = assets.map(a => {
        let statusClass = 'badge-info';
        if (a.status === '在库') statusClass = 'badge-success';
        if (['返修中', '维修中', '已报废'].includes(a.status)) statusClass = 'badge-danger';
        if (['在途', '借出'].includes(a.status)) statusClass = 'badge-warning';
        if (['现场已安装', '现场运行'].includes(a.status)) statusClass = 'badge-primary';
        const updatedAt = String(a.updated_at || '').split(' ')[0] || '-';

        return `
            <tr>
                <td><strong>${escapeAssetText(a.asset_name)}</strong></td>
                <td><code>${escapeAssetText(a.sn || '-')}</code></td>
                <td>${escapeAssetText(a.model || '-')}</td>
                <td><span class="badge ${statusClass}">${escapeAssetText(a.status)}</span></td>
                <td>${a.project_name || '<span class="text-gray">-</span>'}</td>
                <td>${escapeAssetText(a.location || '')} / ${escapeAssetText(a.operator || '')}</td>
                <td>${escapeAssetText(updatedAt)}</td>
                <td>
                    <button class="btn btn-xs btn-outline" onclick="editAsset(${a.id})">编辑</button>
                    <button class="btn btn-xs btn-outline" onclick="changeAssetStatus(${a.id})">状态流转</button>
                    <button class="btn btn-xs btn-danger" onclick="deleteAssetRecord(${a.id})">删除</button>
                </td>
            </tr>
        `;
    }).join('');
}

async function populateAssetProjectOptions(selectedProjectId = '') {
    const projectSelect = document.getElementById('assetProject');
    if (!projectSelect) return;
    projectSelect.innerHTML = '<option value="">未关联项目</option>';
    try {
        const projects = await api.get('/projects');
        projects.forEach(p => {
            projectSelect.innerHTML += `<option value="${p.id}" ${String(p.id) === String(selectedProjectId) ? 'selected' : ''}>${escapeAssetText(p.hospital_name)} - ${escapeAssetText(p.project_name)}</option>`;
        });
    } catch (e) {
        console.error('获取项目列表失败', e);
    }
}

function ensureAssetStatusOption(selectedStatus = '') {
    const statusSelect = document.getElementById('assetStatus');
    if (!statusSelect) return;

    const existingValues = Array.from(statusSelect.options).map(opt => opt.value);
    const statuses = [...ASSET_STATUS_OPTIONS];
    if (selectedStatus && !statuses.includes(selectedStatus)) {
        statuses.unshift(selectedStatus);
    }
    statusSelect.innerHTML = statuses.map(status => `
        <option value="${status}" ${String(status) === String(selectedStatus) ? 'selected' : ''}>${status}</option>
    `).join('');
}

function setAssetModalMeta(title, submitText) {
    const titleEl = document.querySelector('#assetModal .modal-header h3');
    const submitBtn = document.querySelector('#assetModal .modal-footer .btn-primary');
    if (titleEl) titleEl.textContent = title;
    if (submitBtn) submitBtn.textContent = submitText;
}

async function openAssetModal() {
    currentEditingAssetId = null;
    setAssetModalMeta('新增硬件资产', '保存资产');
    document.getElementById('assetForm').reset();
    ensureAssetStatusOption('在库');
    await populateAssetProjectOptions('');
    showModal('assetModal', { reset: false });
}

async function saveAsset() {
    const data = {
        asset_name: document.getElementById('assetName').value,
        sn: document.getElementById('assetSn').value,
        model: document.getElementById('assetModel').value,
        status: document.getElementById('assetStatus').value,
        location: document.getElementById('assetLocation').value,
        current_project_id: document.getElementById('assetProject').value || null,
        operator: document.getElementById('assetOperator').value
    };

    if (!data.asset_name) {
        showToast('请填写资产名称', 'warning');
        return;
    }

    try {
        if (currentEditingAssetId) {
            await api.put(`/assets/${currentEditingAssetId}`, data);
        } else {
            await api.post('/assets', data);
        }
        closeModal('assetModal');
        await loadAssets();
        showToast(currentEditingAssetId ? '资产已更新' : '资产登记成功', 'success');
        currentEditingAssetId = null;
    } catch (e) {
        showToast('保存失败: ' + e.message, 'danger');
    }
}

async function editAsset(id) {
    try {
        const asset = await api.get(`/assets/${id}`);
        currentEditingAssetId = id;
        setAssetModalMeta('编辑硬件资产', '保存修改');
        await populateAssetProjectOptions(asset.current_project_id || '');
        ensureAssetStatusOption(asset.status || '在库');
        document.getElementById('assetName').value = asset.asset_name || '';
        document.getElementById('assetSn').value = asset.sn || '';
        document.getElementById('assetModel').value = asset.model || '';
        document.getElementById('assetStatus').value = asset.status || '在库';
        document.getElementById('assetLocation').value = asset.location || '';
        document.getElementById('assetProject').value = asset.current_project_id || '';
        document.getElementById('assetOperator').value = asset.operator || '';
        showModal('assetModal', { reset: false });
    } catch (e) {
        showToast('加载资产详情失败: ' + e.message, 'danger');
    }
}

async function changeAssetStatus(id) {
    try {
        const asset = await api.get(`/assets/${id}`);
        const statusButtons = ASSET_STATUS_OPTIONS
            .filter(status => status !== asset.status)
            .map(status => `<button class="btn btn-outline btn-sm" onclick="updateAssetStatusQuick(${id}, '${status}')">${escapeAssetText(status)}</button>`)
            .join('');
        showGenericModal('🔁 资产状态流转', `
            <div style="padding:20px;">
                <div style="padding:14px 16px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;margin-bottom:16px;">
                    <div style="font-weight:700;color:#0f172a;">${escapeAssetText(asset.asset_name || '未命名资产')}</div>
                    <div style="font-size:13px;color:#64748b;margin-top:6px;">当前状态：${escapeAssetText(asset.status || '未设置')} ${asset.sn ? `| SN ${escapeAssetText(asset.sn)}` : ''}</div>
                </div>
                <div style="font-size:13px;color:#475569;margin-bottom:12px;">选择新的资产状态：</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    ${statusButtons || '<span style="color:#94a3b8;">暂无可切换状态</span>'}
                </div>
            </div>
        `);
    } catch (e) {
        showToast('加载资产详情失败: ' + e.message, 'danger');
    }
}

async function updateAssetStatusQuick(id, status) {
    try {
        await api.put(`/assets/${id}/status`, { status });
        await loadAssets();
        if (typeof closeGenericModal === 'function') {
            closeGenericModal();
        }
        showToast(`资产状态已更新为「${status}」`, 'success');
    } catch (e) {
        showToast('状态更新失败: ' + e.message, 'danger');
    }
}

async function deleteAssetRecord(id) {
    if (!confirm('确定删除这条资产记录吗？此操作无法撤销。')) return;
    try {
        await api.delete(`/assets/${id}`);
        await loadAssets();
        showToast('资产记录已删除', 'success');
    } catch (e) {
        showToast('删除失败: ' + e.message, 'danger');
    }
}
