// Notification and reminder-check helpers extracted from main.js

async function loadUnreadCount() {
    const res = await fetch('/api/notifications/unread-count');
    const data = await res.json();
    const badge = document.getElementById('notifBadge');
    if (data.count > 0) {
        badge.textContent = data.count;
        badge.style.display = 'inline';
    } else {
        badge.style.display = 'none';
    }
}

async function showNotificationsModal() {
    document.getElementById('notificationsModal').classList.add('show');
    const res = await fetch('/api/notifications');
    const notifications = await res.json();
    const container = document.getElementById('notificationsList');
    if (notifications.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>暂无消息</p></div>';
        return;
    }
    container.innerHTML = notifications.map(n => `
        <div class="reminder-item ${n.type}" style="opacity:${n.is_read ? 0.6 : 1};">
            <div class="reminder-content">
                <div class="reminder-title">${n.title}</div>
                <div class="reminder-desc">${n.content || ''}</div>
                <div class="reminder-time">${n.project_name || '全局'} | ${n.created_at}</div>
            </div>
            <div class="btn-group">
                ${!n.is_read ? `<button class="btn btn-sm btn-outline" onclick="markNotificationRead(${n.id})">已读</button>` : ''}
                <button class="btn btn-sm btn-danger" onclick="deleteNotification(${n.id})">删除</button>
            </div>
        </div>
    `).join('');
}

async function markNotificationRead(nid) {
    await fetch(`/api/notifications/${nid}/read`, { method: 'POST' });
    loadUnreadCount();
    showNotificationsModal();
    if (document.getElementById('dashboardView').style.display !== 'none') showDashboard();
}

async function deleteNotification(nid) {
    await api.delete(`/notifications/${nid}`);
    loadUnreadCount();
    showNotificationsModal();
}

async function markAllNotificationsRead() {
    if (!confirm('确定将所有消息标记为已读？')) return;
    await fetch('/api/notifications/read-all', { method: 'POST' });
    loadUnreadCount();
    showNotificationsModal();
}

async function deleteAllNotifications() {
    if (!confirm('确定删除所有消息？')) return;
    await api.delete('/notifications/delete-all');
    loadUnreadCount();
    showNotificationsModal();
}

async function checkReminders() {
    const res = await fetch('/api/check-and-create-reminders', { method: 'POST' });
    await res.json();
    loadUnreadCount();
    if (document.getElementById('dashboardView').style.display !== 'none') showDashboard();
}
