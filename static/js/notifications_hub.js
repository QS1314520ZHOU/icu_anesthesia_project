// Notification and reminder-check helpers extracted from main.js

async function loadUnreadCount() {
    const data = await api.get('/notifications/unread-count', { silent: true }).catch(() => ({ count: 0 }));
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    if ((data.count || 0) > 0) {
        badge.textContent = data.count;
        badge.style.display = 'inline';
    } else {
        badge.style.display = 'none';
    }
}

function buildNotificationQuery() {
    const params = new URLSearchParams();
    const type = document.getElementById('notificationTypeFilter')?.value || '';
    const readStatus = document.getElementById('notificationReadFilter')?.value || '';
    const keyword = document.getElementById('notificationKeyword')?.value.trim() || '';
    if (type) params.set('type', type);
    if (readStatus) params.set('read_status', readStatus);
    if (keyword) params.set('keyword', keyword);
    params.set('limit', '100');
    return params.toString();
}

async function showNotificationsModal() {
    openModal('notificationsModal');
    const container = document.getElementById('notificationsList');
    const summary = document.getElementById('notificationSummary');
    if (container) container.innerHTML = '<div class="empty-state"><p>加载中...</p></div>';

    try {
        const data = await api.get(`/notifications?${buildNotificationQuery()}`);
        const notifications = data.items || [];
        const stat = data.summary || {};

        if (summary) {
            summary.textContent = `总计 ${stat.total || 0} 条，未读 ${stat.unread_count || 0} 条，高危 ${stat.danger_count || 0} 条，预警 ${stat.warning_count || 0} 条，信息 ${stat.info_count || 0} 条`;
        }

        if (!notifications.length) {
            container.innerHTML = '<div class="empty-state"><p>暂无匹配消息</p></div>';
            return;
        }

        container.innerHTML = notifications.map(n => `
            <div class="reminder-item ${n.type}" style="opacity:${n.is_read ? 0.65 : 1}; border-left:4px solid ${n.type === 'danger' ? '#ef4444' : n.type === 'warning' ? '#f59e0b' : '#3b82f6'};">
                <div class="reminder-content">
                    <div class="reminder-title" style="display:flex;gap:8px;align-items:center;">
                        <span>${n.title}</span>
                        ${!n.is_read ? '<span class="badge badge-info">未读</span>' : '<span class="badge badge-gray">已读</span>'}
                    </div>
                    <div class="reminder-desc">${n.content || ''}</div>
                    <div class="reminder-time">${n.project_name || '全局'} | ${n.created_at}</div>
                </div>
                <div class="btn-group">
                    ${!n.is_read ? `<button class="btn btn-sm btn-outline" onclick="markNotificationRead(${n.id})">已读</button>` : ''}
                    <button class="btn btn-sm btn-danger" onclick="deleteNotification(${n.id})">删除</button>
                </div>
            </div>
        `).join('');
    } catch (e) {
        if (summary) summary.textContent = '';
        container.innerHTML = `<div class="empty-state"><p>加载消息失败: ${e.message}</p></div>`;
    }
}

async function markNotificationRead(nid) {
    await api.post(`/notifications/${nid}/read`, {});
    await loadUnreadCount();
    await showNotificationsModal();
    if (document.getElementById('dashboardView')?.style.display !== 'none') showDashboard();
}

async function deleteNotification(nid) {
    await api.delete(`/notifications/${nid}`);
    await loadUnreadCount();
    await showNotificationsModal();
}

async function markAllNotificationsRead() {
    if (!confirm('确定将所有消息标记为已读？')) return;
    await api.post('/notifications/read-all', {});
    await loadUnreadCount();
    await showNotificationsModal();
}

async function deleteAllNotifications() {
    if (!confirm('确定删除所有消息？')) return;
    await api.delete('/notifications/delete-all');
    await loadUnreadCount();
    await showNotificationsModal();
}

async function checkReminders(options = {}) {
    const silent = !!options.silent;
    if (!currentUser) return { created: [] };

    try {
        const data = await api.post('/check-and-create-reminders', {}, { silent });
        await loadUnreadCount();
        if (document.getElementById('dashboardView')?.style.display !== 'none') showDashboard();
        const created = data.created || [];
        if (!silent) {
            showToast(created.length ? `已生成 ${created.length} 条提醒` : '本次未发现新的提醒', 'success');
        }
        return data;
    } catch (e) {
        if (silent) {
            console.warn('后台检查提醒失败', e);
            return { created: [] };
        }
        showToast(`检查提醒失败: ${e.message}`, 'danger');
        throw e;
    }
}
