/**
 * 硬件资产管理 JavaScript
 */

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
    }
}

function renderAssetStats(assets) {
    const container = document.getElementById('assetStatsGrid');
    if (!container) return;

    // 即使过滤了，也从全量加载（偷懒做法，此处实际应从专门 API 获取）
    const stats = {
        total: assets.length,
        inStock: assets.filter(a => a.status === '在库').length,
        deployed: assets.filter(a => a.status === '现场已安装').length,
        repair: assets.filter(a => a.status === '返修中').length
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
        if (a.status === '返修中') statusClass = 'badge-danger';
        if (a.status === '在途') statusClass = 'badge-warning';

        return `
            <tr>
                <td><strong>${a.asset_name}</strong></td>
                <td><code>${a.sn || '-'}</code></td>
                <td>${a.model || '-'}</td>
                <td><span class="badge ${statusClass}">${a.status}</span></td>
                <td>${a.project_name || '<span class="text-gray">-</span>'}</td>
                <td>${a.location || ''} / ${a.operator || ''}</td>
                <td>${a.updated_at.split(' ')[0]}</td>
                <td>
                    <button class="btn btn-xs btn-outline" onclick="editAsset(${a.id})">编辑</button>
                    <button class="btn btn-xs btn-outline" onclick="changeAssetStatus(${a.id})">状态流转</button>
                </td>
            </tr>
        `;
    }).join('');
}

async function openAssetModal() {
    // 填充项目下拉框
    const projectSelect = document.getElementById('assetProject');
    projectSelect.innerHTML = '<option value="">未关联项目</option>';
    try {
        const projects = await api.get('/projects');
        projects.forEach(p => {
            projectSelect.innerHTML += `<option value="${p.id}">${p.hospital_name} - ${p.project_name}</option>`;
        });
    } catch (e) {
        console.error('获取项目列表失败', e);
    }

    document.getElementById('assetForm').reset();
    showModal('assetModal');
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
        alert('请填写资产名称');
        return;
    }

    try {
        await api.post('/assets', data);
        closeModal('assetModal');
        loadAssets();
        alert('资产登记成功');
    } catch (e) {
        alert('保存失败: ' + e.message);
    }
}

function changeAssetStatus(id) {
    alert('状态流转功能正在完善中。ID: ' + id);
}

function editAsset(id) {
    alert('编辑功能正在完善中。ID: ' + id);
}
