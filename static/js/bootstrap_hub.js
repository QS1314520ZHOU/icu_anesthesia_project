// Desktop bootstrap wiring extracted from main.js.

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    loadProjects();
    loadUnreadCount();
    initStarRatings();
    checkReminders();
    updateAiHealthUI();

    checkAuth();
    loadReminderBadge();
    loadWarningCount();

    setInterval(updateAiHealthUI, 60000);

    const logDate = document.getElementById('logDate');
    if (logDate) logDate.value = new Date().toISOString().split('T')[0];

    const expenseDate = document.getElementById('expenseDate');
    if (expenseDate) expenseDate.value = new Date().toISOString().split('T')[0];

    const followupDate = document.getElementById('followupDate');
    if (followupDate) followupDate.value = new Date().toISOString().split('T')[0];
});
