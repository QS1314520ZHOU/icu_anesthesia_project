// Admin and configuration helpers extracted from main.js

let userToReset = null;
let currentEditingAIConfig = null;

async function openUserManagementModal() {
    openModal('userManagementModal');
    await loadGlobalUsers();
}

async function loadGlobalUsers() {
    const tbody = document.getElementById('globalUserList');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">加载中...</td></tr>';

    try {
        const users = await api.get('/users');
        if (!users || users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">暂无用户</td></tr>';
            return;
        }

        tbody.innerHTML = users.map(u => `
            <tr>
                <td>${u.id}</td>
                <td>${u.username}</td>
                <td>${u.display_name || '-'}</td>
                <td><span class="badge">${u.role}</span></td>
                <td>
                    ${u.is_active
                        ? `<span class="badge" style="background:#dcfce7; color:#166534;">正常</span>`
                        : `<span class="badge" style="background:#fee2e2; color:#991b1b;">已禁用</span>`}
                </td>
                <td>${u.last_login || '-'}</td>
                <td>
                    <div class="btn-group">
                        <button class="btn btn-sm ${u.is_active ? 'btn-danger' : 'btn-primary'}"
                                onclick="toggleUserActiveStatus(${u.id}, ${!u.is_active})"
                                ${currentUser && currentUser.id === u.id ? 'disabled' : ''}>
                            ${u.is_active ? '禁用' : '启用'}
                        </button>
                        <button class="btn btn-sm btn-secondary" onclick="prepareResetPassword(${u.id}, '${u.username}')">重置密码</button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:red;">加载失败: ${e.message}</td></tr>`;
    }
}

async function toggleUserActiveStatus(userId, isActive) {
    if (!confirm(isActive ? '确定要启用该用户吗？' : '确定要禁用该用户吗？会导致用户无法登录。')) return;

    try {
        await api.post(`/users/${userId}/status`, { is_active: isActive });
        await loadGlobalUsers();
    } catch (e) {
        showToast('操作失败: ' + e.message, 'danger');
    }
}

function prepareResetPassword(userId, username) {
    userToReset = userId;
    document.getElementById('resetTargetUser').textContent = `${username} (ID: ${userId})`;
    openModal('passwordResetModal');
}

async function confirmResetPassword() {
    if (!userToReset) return;

    const newPassword = document.getElementById('newPasswordInput').value;
    if (!newPassword) {
        showToast('请输入新密码', 'warning');
        return;
    }

    try {
        await api.post(`/users/${userToReset}/password`, { password: newPassword });
        showToast('密码重置成功', 'success');
        closeModal('passwordResetModal');
        userToReset = null;
    } catch (e) {
        showToast('重置失败: ' + e.message, 'danger');
    }
}

async function loadAIConfigs() {
    const tbody = document.getElementById('aiConfigTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">加载中...</td></tr>';

    try {
        const configs = await api.get('/admin/ai-configs');
        if (!configs || configs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--gray-500);">暂无配置，请点击"新增"添加</td></tr>';
            return;
        }

        tbody.innerHTML = configs.map(c => `
            <tr>
                <td><strong>${c.name}</strong></td>
                <td style="font-family:monospace;font-size:12px;">${c.base_url}</td>
                <td><code>${c.api_key_masked}</code></td>
                <td>${(c.models || []).slice(0, 2).join(', ')}${c.models?.length > 2 ? '...' : ''}</td>
                <td>${c.priority}</td>
                <td>
                    <span class="badge ${c.is_active ? 'badge-success' : 'badge-secondary'}">${c.is_active ? '启用' : '禁用'}</span>
                </td>
                <td>
                    <button class="btn btn-outline btn-sm" onclick="testAIConfig(${c.id})" title="测试连通性">🔗</button>
                    <button class="btn btn-outline btn-sm" onclick="editAIConfig(${c.id})" title="编辑">✏️</button>
                    <button class="btn btn-outline btn-sm" onclick="deleteAIConfig(${c.id})" title="删除">🗑️</button>
                </td>
            </tr>
        `).join('');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:red;">加载失败: ${e.message}</td></tr>`;
    }
}

function showAIConfigModal(config = null) {
    currentEditingAIConfig = config;
    document.getElementById('aiConfigForm').reset();

    if (config) {
        document.getElementById('aiConfigModalTitle').textContent = '编辑 AI 配置';
        document.getElementById('aiConfigName').value = config.name || '';
        document.getElementById('aiConfigUrl').value = config.base_url || '';
        document.getElementById('aiConfigKey').value = '';
        document.getElementById('aiConfigKey').placeholder = '留空表示不修改密钥';
        document.getElementById('aiConfigModels').value = (config.models || []).join(', ');
        document.getElementById('aiConfigPriority').value = config.priority || 1;
        document.getElementById('aiConfigActive').checked = config.is_active;
    } else {
        document.getElementById('aiConfigModalTitle').textContent = '新增 AI 配置';
        document.getElementById('aiConfigKey').placeholder = '请输入 API 密钥';
        document.getElementById('aiConfigPriority').value = 1;
        document.getElementById('aiConfigActive').checked = true;
    }

    openModal('aiConfigModal');
}

async function saveAIConfig() {
    const name = document.getElementById('aiConfigName').value.trim();
    const base_url = document.getElementById('aiConfigUrl').value.trim();
    const api_key = document.getElementById('aiConfigKey').value.trim();
    const modelsStr = document.getElementById('aiConfigModels').value.trim();
    const priority = parseInt(document.getElementById('aiConfigPriority').value) || 1;
    const is_active = document.getElementById('aiConfigActive').checked;

    if (!name || !base_url) {
        showToast('名称和 URL 为必填项', 'warning');
        return;
    }
    if (!currentEditingAIConfig && !api_key) {
        showToast('新增配置时 API 密钥为必填项', 'warning');
        return;
    }

    const models = modelsStr ? modelsStr.split(',').map(s => s.trim()).filter(s => s) : [];
    const data = { name, base_url, models, priority, is_active };
    if (api_key) data.api_key = api_key;

    try {
        if (currentEditingAIConfig) {
            await api.put(`/admin/ai-configs/${currentEditingAIConfig.id}`, data);
        } else {
            await api.post('/admin/ai-configs', data);
        }
        closeModal('aiConfigModal');
        await loadAIConfigs();
        showToast('配置已保存', 'success');
    } catch (e) {
        showToast('保存失败: ' + e.message, 'danger');
    }
}

async function editAIConfig(configId) {
    try {
        const configs = await api.get('/admin/ai-configs');
        const config = configs.find(c => c.id === configId);
        if (config) {
            showAIConfigModal(config);
        }
    } catch (e) {
        showToast('加载配置失败: ' + e.message, 'danger');
    }
}

async function deleteAIConfig(configId) {
    if (!confirm('确定要删除这个 AI 配置吗？')) return;
    try {
        await api.delete(`/admin/ai-configs/${configId}`);
        await loadAIConfigs();
        showToast('配置已删除', 'success');
    } catch (e) {
        showToast('删除失败: ' + e.message, 'danger');
    }
}

async function testAIConfig(configId) {
    try {
        const res = await api.post(`/admin/ai-configs/${configId}/test`, {});
        if (res && res.message) {
            showToast(res.message, 'success');
        } else {
            showToast('测试完成', 'success');
        }
    } catch (e) {
        showToast('测试失败: ' + e.message, 'danger');
    }
}
