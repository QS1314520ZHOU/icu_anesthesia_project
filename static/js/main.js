// ICUPM_VERSION_5
// ========== 全局变量 ==========
let currentProjectId = null;
let currentProject = null;
let allProjects = [];
let currentActiveTab = 'gantt';
let expandedStages = new Set();
let currentReportProjectId = null;

// 阶段颜色配置
const STAGE_COLORS = {
    '项目启动': '#5B8FF9', '需求调研': '#5AD8A6', '系统部署': '#F6BD16',
    '表单制作': '#FFBB96', '接口对接': '#E8684A', '设备对接': '#6DC8EC',
    '数据采集': '#9270CA', '系统培训': '#FF9D4D', '试运行': '#269A99', '验收上线': '#5D7092'
};
const STAGE_NAMES = Object.keys(STAGE_COLORS);

// 状态颜色
const STATUS_COLORS = {
    '待启动': '#9ca3af', '进行中': '#3b82f6', '试运行': '#8b5cf6',
    '验收中': '#f59e0b', '已验收': '#10b981', '质保期': '#06b6d4',
    '暂停': '#f97316', '离场待返': '#ec4899', '已终止': '#ef4444', '已完成': '#22c55e'
};

// ========== 初始化 ==========
// ========== 深色模式切换 ==========
function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
}

function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
}

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    loadProjects();
    loadUnreadCount();
    initStarRatings();
    checkReminders();
    updateAiHealthUI(); // 初始化AI健康状态显示

    // 检查登录状态
    checkAuth();
    loadReminderBadge();
    loadWarningCount();  // 加载预警数量

    // 定期检查AI健康状态 (1分钟一次)
    setInterval(updateAiHealthUI, 60000);

    document.getElementById('logDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('expenseDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('followupDate').value = new Date().toISOString().split('T')[0];
});

// ========== 模态框控制 (Standardized) ==========
function openModal(modalId) {
    const el = document.getElementById(modalId);
    if (!el) {
        console.error('[DEBUG] openModal failed: element not found', modalId);
        return;
    }

    // Reset forms when opening to clear previous data (especially for Issue/Device modals)
    const forms = el.querySelectorAll('form');
    forms.forEach(f => f.reset());
    // Special case for standalone textareas not in forms if any
    const textareas = el.querySelectorAll('textarea');
    textareas.forEach(t => t.value = '');

    el.classList.add('show');
    el.style.display = 'flex'; // Ensure visibility
    console.log('[DEBUG] openModal success:', modalId);
}

function showModal(modalId) {
    openModal(modalId); // Alias
}

function closeModal(modalId) {
    const el = document.getElementById(modalId);
    if (!el) return;
    el.classList.remove('show');
    el.style.display = 'none'; // Hide completely to prevent layout blocking
}

async function updateAiHealthUI() {
    const nodeList = document.getElementById('aiNodeList');
    if (!nodeList) return;

    try {
        const info = await api.get('/ai/health');
        nodeList.innerHTML = info.nodes.map(node => `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="color:var(--gray-600);">${node.name}</span>
                <span style="color:${node.status === 'OK' ? 'var(--success)' : 'var(--danger)'}; font-weight:700;">
                    ${node.status === 'OK' ? '● 在线' : '○ 离线'}
                </span>
            </div>
        `).join('');
    } catch (e) {
        nodeList.innerHTML = '<div style="color:var(--danger); text-align:center;">AI 服务连接失败</div>';
    }
}

async function triggerAiManualHealthCheck(event) {
    const btn = event ? event.currentTarget || event.target : null;
    if (btn) btn.style.animation = 'spin 1s linear infinite';
    await updateAiHealthUI();
    if (btn) setTimeout(() => { btn.style.animation = 'none'; }, 1000);
}

async function checkReminders() {
    // 简易提醒逻辑：检查是否有即将到期的里程碑
    console.log("Checking reminders...");
    // 实际逻辑可根据需求完善
}

// ========== 星级评分初始化 ==========
function initStarRatings() {
    document.querySelectorAll('.star-rating').forEach(container => {
        container.innerHTML = '';
        for (let i = 1; i <= 5; i++) {
            const star = document.createElement('span');
            star.className = 'star';
            star.textContent = '★';
            star.dataset.value = i;
            star.onclick = () => setRating(container, i);
            container.appendChild(star);
        }
    });
}

function setRating(container, value) {
    container.dataset.score = value;
    container.querySelectorAll('.star').forEach((star, index) => {
        star.classList.toggle('active', index < value);
    });
}


// ========== 项目健康度仪表盘 ==========
let healthDashboardVisible = false;
let todayFocusScope = 'global';

async function toggleHealthDashboard() {
    const container = document.getElementById('healthDashboard');
    if (!container) return;

    healthDashboardVisible = !healthDashboardVisible;
    if (healthDashboardVisible) {
        container.style.display = 'block';
        await loadHealthDashboard();
    } else {
        container.style.display = 'none';
    }
}

async function loadHealthDashboard() {
    const container = document.getElementById('healthDashboard');
    if (!container) return;

    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray-500);">加载中...</div>';

    try {
        const data = await api.get('/dashboard/health');
        renderHealthDashboard(data);
    } catch (e) {
        container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--danger);">加载失败: ${e.message}</div>`;
    }
}

function renderHealthDashboard(data) {
    const container = document.getElementById('healthDashboard');
    if (!container) return;

    const { projects, summary } = data;

    let html = `
        <div class="health-dashboard">
            <div class="health-summary">
                <div class="health-stat">
                    <div class="health-stat-value">${summary.total}</div>
                    <div class="health-stat-label">活跃项目</div>
                </div>
                <div class="health-stat health-green">
                    <div class="health-stat-value">🟢 ${summary.green}</div>
                    <div class="health-stat-label">健康</div>
                </div>
                <div class="health-stat health-yellow">
                    <div class="health-stat-value">🟡 ${summary.yellow}</div>
                    <div class="health-stat-label">需关注</div>
                </div>
                <div class="health-stat health-red">
                    <div class="health-stat-value">🔴 ${summary.red}</div>
                    <div class="health-stat-label">风险</div>
                </div>
            </div>
            <div class="health-cards">
    `;

    for (const p of projects) {
        const statusColor = p.health_status === 'green' ? '#10b981' :
            p.health_status === 'yellow' ? '#f59e0b' : '#ef4444';
        const statusIcon = p.health_status === 'green' ? '🟢' :
            p.health_status === 'yellow' ? '🟡' : '🔴';

        html += `
            <div class="health-card" onclick="loadProjectDetail(${p.id})" style="border-left: 4px solid ${statusColor};">
                <div class="health-card-header">
                    <span class="health-card-title">${p.project_name}</span>
                    <span class="health-score" style="color:${statusColor}">${statusIcon} ${p.health_score}分</span>
                </div>
                <div class="health-card-meta">${p.hospital_name} · ${p.project_manager || '未分配'}</div>
                <div class="health-metrics">
                    <span title="进度">📊 ${p.progress || 0}%</span>
                    <span title="未解决问题">⚠️ ${p.metrics.open_issues}</span>
                    <span title="逾期里程碑">🎯 ${p.metrics.overdue_milestones}</span>
                    <span title="接口完成率">🔗 ${p.metrics.interface_rate}%</span>
                </div>
            </div>
        `;
    }

    html += `</div></div>`;
    container.innerHTML = html;
}

// ========== 智能预警系统 ==========
let warningCount = 0;

async function loadWarningCount() {
    try {
        const data = await api.get('/warnings/count');
        warningCount = data.total || 0;
        const badge = document.getElementById('warningBadge');
        if (badge) {
            badge.textContent = warningCount;
            badge.style.display = warningCount > 0 ? 'inline-block' : 'none';
            // 高危预警变红色
            if (data.high > 0) {
                badge.style.background = 'var(--danger)';
            } else {
                badge.style.background = 'var(--warning)';
            }
        }
    } catch (e) {
        console.warn('加载预警数量失败', e);
    }
}

// Warning center logic moved to alert_hub.js
// Reminder center logic moved to reminder_center_hub.js
// Dashboard entry logic moved to dashboard_hub.js
// Approval center logic moved to approval_hub.js
// Resource overview logic moved to resource_hub.js
// Financial overview logic moved to financial_hub.js
// Delivery map entry logic moved to map_hub.js

// ========== 项目模板功能 ==========
async function saveAsTemplate(projectId) {
    const name = prompt('请输入模板名称:');
    if (!name) return;
    try {
        await api.post(`/projects/${projectId}/save-as-template`, { name });
        showToast('✅ 模板保存成功！', 'success');
    } catch (e) {
        showToast('保存失败: ' + e.message, 'danger');
    }
}

// ========== AI项目复盘 ==========
async function showAiRetrospective(projectId) {
    const modal = document.getElementById('aiModal');
    if (!modal) return;
    openModal('aiModal');

    const loadingEl = document.getElementById('aiLoading');
    const contentEl = document.getElementById('aiContent');

    if (loadingEl) loadingEl.style.display = 'block';
    if (contentEl) {
        contentEl.style.display = 'none';
        contentEl.innerHTML = '';
    }

    try {
        const res = await api.post(`/projects/${projectId}/ai-retrospective`);
        if (loadingEl) loadingEl.style.display = 'none';
        if (contentEl) contentEl.style.display = 'block';

        if (res.report) {
            contentEl.innerHTML = `<div style="padding:20px;"><h2 style="margin-bottom:16px;">📊 AI项目复盘报告</h2><div class="markdown-content">${renderAiMarkdown(res.report)}</div></div>`;
        } else {
            contentEl.innerHTML = '<div style="padding:20px;color:var(--danger);">生成失败</div>';
        }
    } catch (e) {
        if (loadingEl) loadingEl.style.display = 'none';
        if (contentEl) {
            contentEl.style.display = 'block';
            contentEl.innerHTML = `<div style="padding:20px;color:var(--danger);">请求失败: ${e.message}</div>`;
        }
    }
}

// ========== AI任务分配建议 ==========
async function showAiTaskSuggestions(projectId) {
    const modal = document.getElementById('aiModal');
    if (!modal) return;
    openModal('aiModal');

    const loadingEl = document.getElementById('aiLoading');
    const contentEl = document.getElementById('aiContent');

    if (loadingEl) loadingEl.style.display = 'block';
    if (contentEl) {
        contentEl.style.display = 'none';
        contentEl.innerHTML = '';
    }

    try {
        const res = await api.post(`/projects/${projectId}/ai-task-suggestions`);
        if (loadingEl) loadingEl.style.display = 'none';
        if (contentEl) contentEl.style.display = 'block';

        if (res.suggestions && res.suggestions.length > 0) {
            let html = '<div style="padding:20px;"><h2 style="margin-bottom:16px;">🎯 AI任务分配建议</h2>';
            for (const s of res.suggestions) {
                // Determine membership tag style
                const memberName = s.suggested_member || '未分配';
                const memberTag = `<span class="badge badge-primary" style="padding:4px 10px; border-radius:100px; font-size:12px; font-weight:600; box-shadow:0 2px 4px rgba(107, 78, 230, 0.2);"><i class="fas fa-user" style="margin-right:4px;"></i>${memberName}</span>`;

                html += `
                <div style="padding:16px; margin-bottom:12px; background:white; border-radius:12px; border-left:4px solid #6B4EE6; box-shadow:0 1px 3px rgba(0,0,0,0.05); transition:transform 0.2s;" onmouseover="this.style.transform='translateX(4px)'" onmouseout="this.style.transform='translateX(0)'">
                    <div style="font-weight:700; font-size:14px; color:#1e293b; margin-bottom:8px; display:flex; align-items:center; gap:8px;">
                        <span style="background:#f1effd; color:#6B4EE6; width:24px; height:24px; display:flex; align-items:center; justify-content:center; border-radius:6px; font-size:12px;">📋</span>
                        ${s.task_name || s.task_id}
                    </div>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            ${memberTag}
                        </div>
                        <div style="font-size:13px; color:#64748b; line-height:1.5; background:#f8fafc; padding:8px 12px; border-radius:8px;">
                            <span style="font-weight:600; color:#475569; margin-right:4px;">💡 建议理由:</span>${s.reason || '基于历史表现与当前负载'}
                        </div>
                    </div>
                </div>`;
            }
            html += '</div>';
            contentEl.innerHTML = html;
        } else if (res.raw_response) {
            contentEl.innerHTML = `<div style="padding:20px;"><h2 style="margin-bottom:16px;">🎯 AI任务分配建议 (文本模式)</h2><div style="white-space: pre-wrap; line-height: 1.6; color: #374151;">${renderAiMarkdown(res.raw_response)}</div></div>`;
        } else {
            contentEl.innerHTML = '<div style="padding:20px;text-align:center;">暂无建议</div>';
        }
    } catch (e) {
        if (loadingEl) loadingEl.style.display = 'none';
        if (contentEl) {
            contentEl.style.display = 'block';
            contentEl.innerHTML = `<div style="padding:20px;color:var(--danger);">请求失败: ${e.message}</div>`;
        }
    }
}

// ========== 侧边栏 ==========
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebarOverlay').classList.toggle('show');
}

// ========== 项目列表 ==========
async function loadProjects() {
    allProjects = await api.get('/projects');
    renderProjectList();
}

function filterProjects() {
    renderProjectList();
}

function renderProjectList() {
    const container = document.getElementById('projectList');
    const filterStatus = document.getElementById('statusFilter').value;

    let filteredProjects = allProjects;
    if (filterStatus) {
        filteredProjects = allProjects.filter(p => p.status === filterStatus);
    }

    if (filteredProjects.length === 0) {
        container.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">📁</div>
                        <div class="empty-state-text">暂无项目</div>
                        <div class="empty-state-hint">点击"新建"创建项目</div>
                    </div>
                `;
        return;
    }

    container.innerHTML = filteredProjects.map(p => {
        const statusColor = STATUS_COLORS[p.status] || '#9ca3af'; // Using STATUS_COLORS as PROJECT_STATUS is not defined

        // 构建风险评分详细提示（用于自定义浮层）
        let riskTooltipData = '';
        if (p.risk_score !== undefined && p.risk_score > 0) {
            const tips = [
                '逾期里程碑: +20分/个',
                '项目整体延期: +30分',
                '日志关键词: +10分/个',
                'AI预测严重延期: +40分',
                'AI预测轻微延期: +15分'
            ];

            let formattedAnalysis = '';
            if (p.risk_analysis) {
                try {
                    const analysis = typeof p.risk_analysis === 'string' ? JSON.parse(p.risk_analysis) : p.risk_analysis;
                    if (Array.isArray(analysis)) {
                        formattedAnalysis = analysis.map(r => r.content || r.keyword).join('；');
                    } else {
                        formattedAnalysis = p.risk_analysis;
                    }
                } catch (e) {
                    formattedAnalysis = p.risk_analysis;
                }
            }

            riskTooltipData = encodeURIComponent(tips.join('|') + (formattedAnalysis ? '||' + formattedAnalysis : ''));
        }

        const riskHtml = p.risk_score !== undefined ? `
            <div class="risk-badge" 
                 data-risk-tooltip="${riskTooltipData}"
                 onmouseenter="showRiskTooltip(event, ${p.risk_score}, this)" 
                 onmouseleave="hideRiskTooltip()"
                 style="position: absolute; bottom: 10px; right: 10px; font-size: 10px; padding: 2px 6px; border-radius: 10px; background: ${getRiskColor(p.risk_score)}; color: white; font-weight: bold; cursor: pointer;">
                风险: ${p.risk_score}%
            </div>
        ` : '';

        return `
            <div class="project-card ${p.status} ${currentProjectId == p.id ? 'active' : ''}" onclick="loadProjectDetail(${p.id}); if(window.innerWidth < 768) toggleSidebar();">
                <div class="project-card-header">
                    <span class="project-name">${p.project_name}</span>
                    <span class="project-list-status badge" style="background-color: ${statusColor}20; color: ${statusColor}">${p.status}</span>
                </div>
                <div class="project-hospital">${p.hospital_name}</div>
                <div class="project-card-footer">
                    <div class="progress-mini-track" style="flex:1;">
                        <div class="progress-mini-bar" style="width: ${p.progress || 0}%"></div>
                    </div>
                    <span style="font-size: 11px; color: var(--gray-500); margin-left: 8px;">${p.progress || 0}%</span>
                </div>
                ${riskHtml}
            </div>
        `;
    }).join('');
}

function getRiskColor(score) {
    if (score < 30) return '#10b981'; // 绿
    if (score < 60) return '#f59e0b'; // 橙
    return '#ef4444'; // 红
}

// 自定义风险提示浮层
function showRiskTooltip(event, score, el) {
    hideRiskTooltip(); // 先移除旧的

    const data = el.getAttribute('data-risk-tooltip');
    if (!data) return;

    const decoded = decodeURIComponent(data);
    const [rulesStr, analysis] = decoded.split('||');
    const rules = rulesStr.split('|');

    const tooltip = document.createElement('div');
    tooltip.id = 'riskTooltip';
    tooltip.innerHTML = `
        <div style="font-weight: 600; font-size: 13px; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
            <span style="background: ${getRiskColor(score)}; width: 8px; height: 8px; border-radius: 50%;"></span>
            风险评分: ${score}%
        </div>
        <div style="font-size: 11px; color: #6b7280; margin-bottom: 6px;">评分规则:</div>
        <ul style="margin: 0; padding-left: 16px; font-size: 11px; color: #374151; line-height: 1.6;">
            ${rules.map(r => `<li>${r}</li>`).join('')}
        </ul>
        ${analysis ? `<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280;">
            <strong>分析:</strong> ${analysis.substring(0, 100)}${analysis.length > 100 ? '...' : ''}
        </div>` : ''}
    `;

    Object.assign(tooltip.style, {
        position: 'fixed',
        background: 'white',
        padding: '12px 14px',
        borderRadius: '10px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        zIndex: '9999',
        maxWidth: '280px',
        border: '1px solid #e5e7eb',
        pointerEvents: 'none'
    });

    document.body.appendChild(tooltip);

    // 定位浮层
    const rect = el.getBoundingClientRect();
    let left = rect.left - tooltip.offsetWidth - 10;
    let top = rect.top - 10;

    // 如果左侧空间不够，显示在右侧
    if (left < 10) {
        left = rect.right + 10;
    }
    // 确保不超出屏幕底部
    if (top + tooltip.offsetHeight > window.innerHeight - 10) {
        top = window.innerHeight - tooltip.offsetHeight - 10;
    }

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
}

function hideRiskTooltip() {
    const existing = document.getElementById('riskTooltip');
    if (existing) existing.remove();
}

async function refreshProjectRisk(projectId) {
    console.log('[DEBUG] refreshProjectRisk called for project:', projectId);
    // 添加按钮loading状态
    const btn = document.getElementById('btnRiskAssess');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ 评估中...';
    }

    // 显示弹窗
    const riskModal = document.getElementById('riskModal');
    if (riskModal) {
        openModal('riskModal');
        const loadingEl = document.getElementById('riskLoading');
        const contentEl = document.getElementById('riskContent');
        if (loadingEl) loadingEl.style.display = 'block';
        if (contentEl) contentEl.style.display = 'none';
    } else {
        console.error('[DEBUG] riskModal not found!');
    }

    try {
        console.log('[DEBUG] Sending API request to /ai/risk-analysis');
        const res = await api.post('/ai/risk-analysis', { project_id: projectId });
        console.log('[DEBUG] API Response:', res);

        // 更新本地数据
        const p = allProjects.find(item => item.id == projectId);
        if (p) {
            p.risk_score = res.risk_score;
            p.risk_analysis = res.analysis;
            renderProjectList();
            if (currentProjectId == projectId && currentProject) {
                currentProject.risk_score = res.risk_score;
                currentProject.risk_analysis = res.analysis;
            }
        }

        // 显示结果
        displayRiskResult(res.risk_score, res.analysis);
    } catch (e) {
        console.error('风险评估失败', e);
        const contentEl = document.getElementById('riskContent');
        if (contentEl) {
            contentEl.innerHTML = `<p style="color:red; text-align:center;">风险评估失败: ${e.message}</p>`;
            contentEl.style.display = 'block';
        }
        const loadingEl = document.getElementById('riskLoading');
        if (loadingEl) loadingEl.style.display = 'none';
    } finally {
        // 恢复按钮状态
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
            console.log('[DEBUG] Button restored');
        }
    }
}

function displayRiskResult(score, analysis) {
    const scoreEl = document.getElementById('riskScoreValue');
    const labelEl = document.getElementById('riskScoreLabel');
    const textEl = document.getElementById('riskAnalysisText');

    // 确定风险等级和颜色
    let color, label;
    if (score < 30) {
        color = '#10b981'; label = '🟢 低风险';
    } else if (score < 60) {
        color = '#f59e0b'; label = '🟡 中等风险';
    } else {
        color = '#ef4444'; label = '🔴 高风险';
    }

    let formattedAnalysis = '';
    if (analysis) {
        try {
            const parsed = typeof analysis === 'string' ? JSON.parse(analysis) : analysis;
            if (Array.isArray(parsed)) {
                formattedAnalysis = parsed.map(r => `• ${r.content || r.keyword}`).join('<br>');
            } else {
                formattedAnalysis = analysis;
            }
        } catch (e) {
            formattedAnalysis = analysis;
        }
    }

    scoreEl.textContent = score + '%';
    scoreEl.style.color = color;
    labelEl.textContent = label;
    labelEl.style.color = color;
    textEl.innerHTML = formattedAnalysis || '暂无详细分析';

    document.getElementById('riskLoading').style.display = 'none';
    document.getElementById('riskContent').style.display = 'block';
}

function refreshRiskAnalysis() {
    if (currentProjectId) {
        refreshProjectRisk(currentProjectId);
    }
}


async function toggleShare(projectId, enabled) {
    try {
        const res = await api.post(`/projects/${projectId}/share/toggle`, { enabled });
        if (res.success) {
            // 刷新当前项目数据并重绘
            if (currentProject && currentProject.id == projectId) {
                currentProject.share_enabled = enabled ? 1 : 0;
                currentProject.share_token = res.share_token;
                renderProjectDetail(currentProject);
            }

            // 同时更新 allProjects 列表
            const p = allProjects.find(item => item.id == projectId);
            if (p) {
                p.share_enabled = enabled ? 1 : 0;
                p.share_token = res.share_token;
            }

            if (enabled) {
                const url = `${window.location.origin}/share/${res.share_token}`;
                showToast('✅ 分享已开启，可直接复制分享链接', 'success', 4000);
            } else {
                showToast('🔒 已关闭公开分享。', 'success');
            }

        }
    } catch (e) {
        showToast('操作失败: ' + e.message, 'danger');
    }
}

function copyShareLink(token) {
    const url = `${window.location.origin}/share/${token}`;

    // 优先使用 navigator.clipboard
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(url).then(() => {
            showToast('链接已复制到剪贴板', 'success');
        }).catch(err => {
            console.error('Clipboard copy failed:', err);
            _fallbackCopyText(url);
        });
    } else {
        _fallbackCopyText(url);
    }
}

function _fallbackCopyText(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        const successful = document.execCommand('copy');
        if (successful) {
            showToast('链接已复制到剪贴板', 'success');
        } else {
            showToast('复制失败，请手动复制', 'danger');
        }
    } catch (err) {
        showToast('无法复制，请手动选择复制', 'danger');
    }
    document.body.removeChild(textArea);
}


// ========== 项目模板功能 ==========
async function saveAsTemplate(projectId) {
    const name = prompt('请输入模板名称:');
    if (!name) return;

    try {
        const res = await api.post(`/projects/${projectId}/save-as-template`, { name });
        showToast('✅ 模板保存成功！', 'success');
    } catch (e) {
        showToast('保存失败: ' + e.message, 'danger');
    }
}

// ========== 客户沟通记录功能 ==========
async function loadCommunications(projectId) {
    const container = document.getElementById('communicationsList');
    if (!container) return;

    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray-500);">加载中...</div>';

    try {
        const records = await api.get(`/projects/${projectId}/communications`);
        renderCommunications(records, projectId);
    } catch (e) {
        container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--danger);">加载失败</div>`;
    }
}

function renderCommunications(records, projectId) {
    const container = document.getElementById('communicationsList');
    if (!container) return;

    if (records.length === 0) {
        container.innerHTML = `<div style="text-align:center;padding:30px;color:var(--gray-400);">暂无沟通记录</div>`;
        return;
    }

    let html = '';
    for (const r of records) {
        const methodIcon = r.contact_method === '电话' ? '📞' :
            r.contact_method === '微信' ? '💬' :
                r.contact_method === '现场' ? '🏢' : '📧';
        html += `
            <div style="padding:12px;border-bottom:1px solid var(--gray-100);display:flex;justify-content:space-between;align-items:flex-start;">
                <div>
                    <div style="font-weight:600;margin-bottom:4px;">${methodIcon} ${r.summary || '无摘要'}</div>
                    <div style="font-size:12px;color:var(--gray-500);">
                        ${r.contact_date || ''} · ${r.contact_person || ''} · ${r.contact_method || ''}
                    </div>
                </div>
                <button class="btn btn-danger btn-sm" onclick="deleteCommunication(${r.id}, ${projectId})">删除</button>
            </div>
        `;
    }
    container.innerHTML = html;
}

function showAddCommunicationModal() {
    openModal('communicationModal');
}

async function saveCommunication() {
    if (!currentProjectId) return;

    const data = {
        contact_date: document.getElementById('commDate').value,
        contact_person: document.getElementById('commPerson').value,
        contact_method: document.getElementById('commMethod').value,
        summary: document.getElementById('commSummary').value
    };

    try {
        await api.post(`/projects/${currentProjectId}/communications`, data);
        closeModal('communicationModal');
        loadCommunications(currentProjectId);
        showToast('✅ 沟通记录已添加', 'success');
    } catch (e) {
        showToast('添加失败: ' + e.message, 'danger');
    }
}

async function deleteCommunication(recordId, projectId) {
    if (!confirm('确定要删除此沟通记录吗？')) return;
    api.delete(`/communications/${recordId}`)
        .then(() => {
            showToast('沟通记录已删除');
            loadCommunications(projectId);
        })
        .catch(err => showToast(`删除失败: ${err.message}`, 'error'));
}

async function analyzeCommunications() {
    if (!currentProjectId) { showToast('请先选择一个项目', 'warning'); return; }

    const container = document.getElementById('communicationAiAnalysis');
    if (!container) return;

    container.style.display = 'block';
    container.innerHTML = `
        <div style="background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden;">
            <div style="background:linear-gradient(135deg,#8b5cf6,#6366f1);padding:20px 24px;color:white;">
                <div style="display:flex;align-items:center;gap:12px;">
                    <div style="width:44px;height:44px;background:rgba(255,255,255,0.2);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;">🤖</div>
                    <div>
                        <div style="font-size:17px;font-weight:700;">AI 沟通记录智能分析</div>
                        <div style="font-size:12px;opacity:0.8;margin-top:2px;">正在分析所有沟通记录，请稍候...</div>
                    </div>
                </div>
            </div>
            <div style="padding:40px;text-align:center;">
                <div class="spinner" style="margin:0 auto 16px;"></div>
                <div style="color:var(--gray-500);font-size:13px;">🔍 分析维度：需求合理性 · 风险识别 · 行动计划</div>
            </div>
        </div>
    `;

    try {
        const res = await fetch(`/api/projects/${currentProjectId}/communications/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        const data = await res.json();

        if (data.error) {
            container.innerHTML = _renderAiError(data.error);
            return;
        }

        container.innerHTML = _renderAiReport('沟通记录智能分析报告', '基于所有沟通记录的 AI 深度分析', data.analysis, '#8b5cf6', '#6366f1');
    } catch (e) {
        container.innerHTML = _renderAiError('请求失败: ' + e.message);
    }
}

async function analyzeUploadedFile(input) {
    if (!input.files || !input.files[0]) return;
    if (!currentProjectId) { showToast('请先选择一个项目', 'warning'); return; }

    const file = input.files[0];
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
        showToast('文件过大，请上传小于 10MB 的文件', 'warning');
        input.value = '';
        return;
    }

    const container = document.getElementById('communicationAiAnalysis');
    if (!container) return;

    container.style.display = 'block';
    container.innerHTML = `
        <div style="background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden;">
            <div style="background:linear-gradient(135deg,#0ea5e9,#2563eb);padding:20px 24px;color:white;">
                <div style="display:flex;align-items:center;gap:12px;">
                    <div style="width:44px;height:44px;background:rgba(255,255,255,0.2);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;">📄</div>
                    <div>
                        <div style="font-size:17px;font-weight:700;">AI 文件分析</div>
                        <div style="font-size:12px;opacity:0.8;margin-top:2px;">正在解析 ${file.name} 并进行智能分析...</div>
                    </div>
                </div>
            </div>
            <div style="padding:40px;text-align:center;">
                <div class="spinner" style="margin:0 auto 16px;"></div>
                <div style="color:var(--gray-500);font-size:13px;">📄 ${file.name} (${(file.size / 1024).toFixed(1)} KB)</div>
                <div style="color:var(--gray-400);font-size:12px;margin-top:6px;">提取文本 → AI分析 → 生成报告</div>
            </div>
        </div>
    `;

    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch(`/api/projects/${currentProjectId}/communications/analyze-file`, {
            method: 'POST',
            body: formData
        });
        const data = await res.json();

        if (data.error) {
            container.innerHTML = _renderAiError(data.error);
        } else {
            const subtitle = `📄 ${data.filename || file.name}  ·  提取 ${data.text_length || '?'} 字符`;
            container.innerHTML = _renderAiReport('文件智能分析报告', subtitle, data.analysis, '#0ea5e9', '#2563eb');
        }
    } catch (e) {
        container.innerHTML = _renderAiError('请求失败: ' + e.message);
    }

    input.value = '';  // 重置 file input 以便重复上传
}

function _renderAiReport(title, subtitle, markdown, colorFrom, colorTo) {
    let htmlContent;
    if (typeof marked !== 'undefined') {
        htmlContent = renderAiMarkdown(markdown || '');
    } else {
        htmlContent = `<pre style="white-space:pre-wrap;font-size:14px;line-height:1.7;">${markdown || ''}</pre>`;
    }

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
                    <button onclick="analyzeCommunications()" style="background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.3);color:white;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12px;transition:background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.3)'" onmouseout="this.style.background='rgba(255,255,255,0.2)'">🔄 重新分析</button>
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

function _renderAiError(msg) {
    return `
        <div style="background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden;">
            <div style="background:linear-gradient(135deg,#ef4444,#dc2626);padding:16px 24px;color:white;display:flex;align-items:center;gap:10px;">
                <span style="font-size:20px;">⚠️</span>
                <span style="font-weight:600;">分析失败</span>
                <button onclick="document.getElementById('communicationAiAnalysis').style.display='none'" style="margin-left:auto;background:rgba(255,255,255,0.2);border:none;color:white;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;">✕</button>
            </div>
            <div style="padding:24px;text-align:center;">
                <div style="color:#ef4444;font-size:14px;margin-bottom:12px;">${msg}</div>
                <button class="btn btn-outline btn-sm" onclick="analyzeCommunications()">🔄 重试</button>
            </div>
        </div>
    `;
}

// Project detail entry/render flow migrated to static/js/project_detail_hub.js


async function loadAiDailyInsight(projectId, isRefresh = false) {
    const contentEl = document.getElementById('aiInsightContent');
    if (!contentEl) return;

    contentEl.innerHTML = '<div class="loading-spinner" style="font-size:13px; color:#6b7280;">AI 正在进行战略研判...</div>';
    try {
        const url = `/ai/daily-insight/${projectId}` + (isRefresh ? '?refresh=1' : '');
        const advice = await api.get(url);
        // 确保 marked.js 已加载
        const adviceHtml = renderAiMarkdown(advice || '');
        contentEl.innerHTML = `<div class="report-content" style="font-size:14px; color:#334155; line-height:1.7;">${adviceHtml}</div>`;
    } catch (e) {
        contentEl.innerHTML = `<div style="color:var(--danger); font-size:12px;">⚠️ 战略研判暂时离线</div>`;
    }
}


// Dependency helpers migrated to static/js/project_detail_hub.js

// Project detail dependency helpers migrated to static/js/project_detail_hub.js

// Dependency modal/save/delete helpers migrated to static/js/project_detail_hub.js

function switchTab(el, tabName) {
    currentActiveTab = tabName;
    document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');
    if (tabName === 'gantt' && currentProject) {
        setTimeout(() => {
            renderGanttLegend('projectGanttLegend');
            renderProjectGantt(currentProject);
        }, 100);
    }
    if (tabName === 'pulse' && currentProject) {
        setTimeout(() => renderBurndownInDetail(currentProjectId), 100);
        loadReportArchive(currentProjectId);
    }
    if (tabName === 'flow' && currentProject) {
        setTimeout(() => renderInterfaceFlow(), 100);
    }
    if (tabName === 'devices' && currentProjectId) {
        loadDevices(currentProjectId);
    }
    if (tabName === 'dependencies' && currentProjectId) {
        loadDependencies(currentProjectId);
    }
    if (tabName === 'interfaceSpec' && currentProjectId) {
        InterfaceSpec.renderTab(currentProjectId);
    }
}

// Project detail render/load helpers migrated to static/js/project_detail_hub.js

// ========== 甘特图 ==========
function renderGanttLegend(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = STAGE_NAMES.map(name => `
                <div class="gantt-legend-item">
                    <div class="gantt-legend-color" style="background:${STAGE_COLORS[name]}"></div>
                    <span>${name}</span>
                </div>
            `).join('');
}

async function renderProjectGantt(project) {
    const chartDom = document.getElementById('projectGanttChart');
    if (!chartDom) return;

    // 清理旧实例，避免初始化冲突
    const existingInstance = echarts.getInstanceByDom(chartDom);
    if (existingInstance) {
        echarts.dispose(existingInstance);
    }

    // 显示加载中
    chartDom.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>正在生成任务时间轴...</p></div>';

    try {
        console.log('[DEBUG] Fetching Gantt data for project:', project.id);
        // 使用 api.get 保证一致性，且自带错误处理
        const ganttTasks = await api.get(`/projects/${project.id}/gantt-data`, { silent: true });

        if (!ganttTasks || ganttTasks.length === 0) {
            chartDom.innerHTML = '<div class="empty-state"><p>暂无详细任务时间数据</p></div>';
            return;
        }

        // 再次检查容器是否存在且可见（可能在 fetch 期间用户切换了 tab）
        if (!document.getElementById('projectGanttChart')) return;

        // 清理 Loading 状态
        chartDom.innerHTML = '';

        const myChart = echarts.init(chartDom);
        const categories = ganttTasks.map(t => t.name);
        const seriesData = [];
        const milestoneData = [];
        let minDate = null, maxDate = null;

        ganttTasks.forEach((t, idx) => {
            const start = new Date(t.start);
            const end = new Date(t.end);
            if (!minDate || start < minDate) minDate = start;
            if (!maxDate || end > maxDate) maxDate = end;

            // 匹配阶段颜色
            const color = STAGE_COLORS[project.stages[0]?.stage_name] || '#5B8FF9';

            seriesData.push({
                name: t.name,
                value: [idx, start.getTime(), end.getTime(), t.progress, t.id],
                itemStyle: { color: color, borderRadius: 4 }
            });
        });

        // 里程碑
        if (project.milestones) {
            project.milestones.forEach(m => {
                const date = new Date(m.target_date);
                if (!minDate || date < minDate) minDate = date;
                if (!maxDate || date > maxDate) maxDate = date;
                milestoneData.push({
                    name: m.name,
                    value: [date.getTime(), 0],
                    itemStyle: { color: m.is_completed ? '#10b981' : '#f59e0b' }
                });
            });
        }

        const today = new Date().getTime();
        const option = {
            tooltip: {
                formatter: params => {
                    if (params.seriesType === 'custom') {
                        const start = new Date(params.value[1]).toLocaleDateString('zh-CN');
                        const end = new Date(params.value[2]).toLocaleDateString('zh-CN');
                        return `<div style="padding:8px;"><div style="font-weight:600;margin-bottom:8px;">${params.name}</div><div style="color:#666;font-size:12px;">工期: ${start} ~ ${end}</div><div style="color:#666;font-size:12px;">完成进度: ${params.value[3]}%</div></div>`;
                    } else if (params.seriesType === 'scatter') {
                        return `<div style="padding:8px;"><div style="font-weight:600;color:#f59e0b;">🎯 里程碑: ${params.name}</div><div style="color:#666;font-size:12px;">截止日期: ${new Date(params.value[0]).toLocaleDateString('zh-CN')}</div></div>`;
                    }
                }
            },
            grid: { left: '160', right: '40', top: '40', bottom: '40' },
            xAxis: {
                type: 'time',
                min: minDate ? minDate.getTime() - 86400000 * 3 : undefined,
                max: maxDate ? maxDate.getTime() + 86400000 * 3 : undefined,
                axisLabel: { formatter: value => { const d = new Date(value); return `${d.getMonth() + 1}-${d.getDate()}`; } },
                splitLine: { show: true, lineStyle: { color: 'rgba(0,0,0,0.05)' } }
            },
            yAxis: {
                type: 'category', data: categories, inverse: true,
                axisLine: { show: false }, axisTick: { show: false },
                axisLabel: { fontSize: 11, color: '#333', width: 140, overflow: 'truncate' }
            },
            series: [
                {
                    type: 'custom',
                    renderItem: (params, api) => {
                        const categoryIndex = api.value(0);
                        const start = api.coord([api.value(1), categoryIndex]);
                        const end = api.coord([api.value(2), categoryIndex]);
                        const height = 18;
                        const progress = api.value(3);
                        const rectShape = echarts.graphic.clipRectByRect({
                            x: start[0], y: start[1] - height / 2, width: Math.max(end[0] - start[0], 2), height: height
                        }, { x: params.coordSys.x, y: params.coordSys.y, width: params.coordSys.width, height: params.coordSys.height });
                        return rectShape && {
                            type: 'group',
                            children: [
                                { type: 'rect', shape: rectShape, style: { fill: api.visual('color'), opacity: 0.15 } },
                                { type: 'rect', shape: { x: rectShape.x, y: rectShape.y, width: rectShape.width * progress / 100, height: rectShape.height }, style: { fill: api.visual('color') } }
                            ]
                        };
                    },
                    encode: { x: [1, 2], y: 0 },
                    data: seriesData
                },
                {
                    type: 'scatter',
                    symbol: 'diamond',
                    symbolSize: 12,
                    data: milestoneData,
                    zlevel: 5,
                    label: { show: true, position: 'right', formatter: '{b}', fontSize: 10, color: '#666' }
                },
                { type: 'line', markLine: { silent: true, symbol: 'none', lineStyle: { color: '#ff4d4f', type: 'dashed', width: 1.5 }, data: [{ xAxis: today }], label: { formatter: '今天', position: 'start', color: '#ff4d4f', fontSize: 10 } } }
            ]
        };

        myChart.setOption(option);

        // 点击跳转钻取
        myChart.on('click', function (params) {
            if (params.seriesType === 'custom') {
                const stageId = params.value[4];
                // 切换到阶段Tab，并展开对应阶段
                const tabs = document.querySelectorAll('.tabs .tab');
                const stagesTab = Array.from(tabs).find(t => t.innerText.includes('阶段'));
                if (stagesTab) {
                    stagesTab.click();
                    setTimeout(() => {
                        const stageEl = document.getElementById(`stage-${stageId}`);
                        if (stageEl) {
                            stageEl.scrollIntoView({ behavior: 'smooth' });
                            if (!stageEl.classList.contains('expanded')) {
                                toggleStage(stageId);
                            }
                        }
                    }, 200);
                }
            }
        });

        window.addEventListener('resize', () => myChart.resize());
    } catch (e) {
        console.error('Render Gantt Error:', e);
        chartDom.innerHTML = `<div class="empty-state"><p>生成甘特图失败: ${e.message || '网络或数据错误'}</p></div>`;
    }
}

async function showGlobalGanttModal() {
    document.getElementById('globalGanttModal').classList.add('show');
    const res = await fetch('/api/analytics/gantt');
    const data = await res.json();
    renderGanttLegend('globalGanttLegend');
    const chartDom = document.getElementById('globalGanttChart');
    if (data.length === 0) {
        chartDom.innerHTML = '<div class="empty-state"><p>暂无项目数据</p></div>';
        return;
    }
    const myChart = echarts.init(chartDom);
    const categories = data.map(item => item.project.hospital_name || item.project.project_name);
    const seriesData = [];
    const milestoneData = [];
    let minDate = null, maxDate = null;

    data.forEach((item, projectIdx) => {
        item.stages.forEach(s => {
            if (!s.plan_start_date || !s.plan_end_date) return;
            const start = new Date(s.plan_start_date);
            const end = new Date(s.plan_end_date);
            if (!minDate || start < minDate) minDate = start;
            if (!maxDate || end > maxDate) maxDate = end;
            const color = STAGE_COLORS[s.stage_name] || '#5B8FF9';
            seriesData.push({
                name: s.stage_name,
                value: [projectIdx, start.getTime(), end.getTime(), s.progress, item.project.project_name, item.project.id],
                itemStyle: { color: color, borderRadius: 3 }
            });
        });

        if (item.milestones) {
            item.milestones.forEach(m => {
                const date = new Date(m.target_date);
                if (!minDate || date < minDate) minDate = date;
                if (!maxDate || date > maxDate) maxDate = date;
                milestoneData.push({
                    name: m.name,
                    value: [date.getTime(), projectIdx],
                    itemStyle: { color: m.is_completed ? '#10b981' : '#f59e0b' }
                });
            });
        }
    });

    const today = new Date().getTime();
    const option = {
        tooltip: {
            formatter: params => {
                if (params.seriesType === 'custom') {
                    return `<div style="padding:8px;"><div style="font-weight:600;margin-bottom:4px;">${params.value[4]}</div><div style="color:#8b5cf6;margin-bottom:8px;">${params.name}</div><div style="color:#666;font-size:12px;">时间: ${new Date(params.value[1]).toLocaleDateString('zh-CN')} ~ ${new Date(params.value[2]).toLocaleDateString('zh-CN')}</div><div style="color:#666;font-size:12px;">进度: ${params.value[3]}%</div><div style="margin-top:4px;color:var(--primary);font-size:11px;">(点击跳转项目详情)</div></div>`;
                } else if (params.seriesType === 'scatter') {
                    return `<div style="padding:8px;"><div style="font-weight:600;color:#f59e0b;">🎯 里程碑: ${params.name}</div><div style="color:#666;font-size:12px;">日期: ${new Date(params.value[0]).toLocaleDateString('zh-CN')}</div></div>`;
                }
            }
        },
        grid: { left: '140', right: '40', top: '20', bottom: '40' },
        xAxis: {
            type: 'time',
            min: minDate ? minDate.getTime() - 86400000 * 3 : undefined,
            max: maxDate ? maxDate.getTime() + 86400000 * 3 : undefined,
            axisLabel: { formatter: value => { const d = new Date(value); return `${d.getMonth() + 1}-${d.getDate()}`; } },
            splitLine: { show: true, lineStyle: { color: 'rgba(0,0,0,0.05)' } }
        },
        yAxis: {
            type: 'category', data: categories, inverse: true,
            axisLine: { show: false }, axisTick: { show: false },
            axisLabel: { fontSize: 12, color: '#333', width: 120, overflow: 'truncate' }
        },
        series: [
            {
                type: 'custom',
                renderItem: (params, api) => {
                    const categoryIndex = api.value(0);
                    const start = api.coord([api.value(1), categoryIndex]);
                    const end = api.coord([api.value(2), categoryIndex]);
                    const height = 18;
                    const progress = api.value(3);
                    const rectShape = echarts.graphic.clipRectByRect({
                        x: start[0], y: start[1] - height / 2, width: Math.max(end[0] - start[0], 2), height: height
                    }, { x: params.coordSys.x, y: params.coordSys.y, width: params.coordSys.width, height: params.coordSys.height });
                    return rectShape && {
                        type: 'group',
                        children: [
                            { type: 'rect', shape: rectShape, style: { fill: api.visual('color'), opacity: 0.2 } },
                            { type: 'rect', shape: { x: rectShape.x, y: rectShape.y, width: rectShape.width * progress / 100, height: rectShape.height }, style: { fill: api.visual('color') } }
                        ]
                    };
                },
                encode: { x: [1, 2], y: 0 },
                data: seriesData
            },
            {
                type: 'scatter',
                symbol: 'diamond',
                symbolSize: 12,
                data: milestoneData,
                zlevel: 5,
                label: { show: false }
            },
            { type: 'line', markLine: { silent: true, symbol: 'none', lineStyle: { color: '#ff4d4f', type: 'dashed', width: 2 }, data: [{ xAxis: today }], label: { formatter: '今天', position: 'start', color: '#ff4d4f', fontSize: 11 } } }
        ]
    };
    myChart.setOption(option);

    myChart.on('click', function (params) {
        if (params.seriesType === 'custom') {
            const projectId = params.value[5];
            closeModal('globalGanttModal');
            loadProjectDetail(projectId);
        }
    });

    window.addEventListener('resize', () => myChart.resize());
}

// ========== 项目状态变更 ==========
// Duplicate function blocks (2787-2835) removed to avoid conflicts.

// ========== 添加阶段 ==========
// Project detail stage/action helpers migrated to static/js/project_detail_hub.js

// ========== 视图切换工具 ==========
function hideAllViews() {
    const views = ['dashboardView', 'projectDetailView', 'mapView', 'resourceView', 'financialView', 'analyticsView', 'approvalView', 'kbView', 'assetView', 'formGeneratorView', 'emptyState'];
    views.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
}

// Dashboard / approval / resource / financial hubs moved to dedicated modules:
// dashboard_hub.js, approval_hub.js, resource_hub.js, financial_hub.js


// Project detail burndown/detail visual helpers migrated to static/js/project_detail_hub.js

// ========== 提醒功能 ==========
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
    const data = await res.json();
    // 只在有新提醒时才弹窗提示 - User requested removal of this alert
    // if (data.created && data.created.length > 0) {
    // }

    loadUnreadCount();
    if (document.getElementById('dashboardView').style.display !== 'none') showDashboard();
}

// ========== 轮询助手 ==========
/**
 * 轮询异步任务结果
 */
async function pollTask(taskId, loadingElementId, contentElementId, reportType, onSuccess) {
    const pollInterval = 2000;
    const check = async () => {
        try {
            const data = await api.get(`/tasks/${taskId}`, { silent: true });
            if (data.status === 'completed') {
                onSuccess(data.result);
            } else if (data.status === 'failed') {
                document.getElementById(contentElementId).innerHTML = `<div class="error-msg">❌ 处理失败: ${data.error || '未知错误'}</div>`;
                document.getElementById(loadingElementId).style.display = 'none';
                document.getElementById(contentElementId).style.display = 'block';
            } else {
                // 持续处理中
                setTimeout(check, pollInterval);
            }
        } catch (e) {
            // 如果是 404 或者 任务不存在，通常是因为服务器重启导致内存中的任务字典清空
            const errorText = e.message.includes('Task not found') || e.message.includes('404')
                ? '任务已失效或服务器已重启，请重新生成'
                : e.message;
            document.getElementById(contentElementId).innerHTML = `<div class="error-msg">⚠️ 轮询失败: ${errorText}</div>`;
            document.getElementById(loadingElementId).style.display = 'none';
            document.getElementById(contentElementId).style.display = 'block';
        }
    };
    setTimeout(check, pollInterval);
}

// ========== AI 分析和周报 ==========
async function callAiAnalysis(pid, forceRefresh = false) {
    console.log('[DEBUG] callAiAnalysis called for PID:', pid, 'Force:', forceRefresh);
    // 添加按钮loading状态
    const btn = document.getElementById('btnAiDiagnosis');
    const originalText = btn ? btn.innerHTML : '';

    // Check if the button is currently disabled (meaning potentially another request is flying, but we allow force click if it's stuck)
    if (btn && btn.disabled && !confirm('正在进行分析，是否强制重新开始？')) {
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ 分析中...';
    }

    currentReportProjectId = pid;
    openModal('aiModal');

    const loadingEl = document.getElementById('aiLoading');
    const contentEl = document.getElementById('aiContent');
    if (loadingEl) loadingEl.style.display = 'block';
    if (contentEl) contentEl.style.display = 'none';

    // 恢复按钮状态（弹窗已打开，用户可以在弹窗中操作）
    // NOTE: We restore it immediately to allow interaction, but log it.
    if (btn) {
        setTimeout(() => {
            btn.disabled = false;
            btn.innerHTML = originalText;
            console.log('[DEBUG] callAiAnalysis button restored');
        }, 500); // Small delay to show feedback
    }

    try {
        const endpoint = `/projects/${pid}/ai-analyze${forceRefresh ? '?force=1' : ''}`;
        console.log('[DEBUG] Calling API:', endpoint);
        const data = await api.post(endpoint);
        console.log('[DEBUG] API Response received');

        if (data.task_id) {
            pollTask(data.task_id, 'aiLoading', 'aiContent', 'ai', (result) => {
                const { html, radarData } = processReportResult(result, 'ai');
                if (contentEl) contentEl.innerHTML = html;
                if (loadingEl) loadingEl.style.display = 'none';
                if (contentEl) contentEl.style.display = 'block';
                const radarContainer = document.getElementById('aiRadarContainer');
                if (radarData && radarContainer) {
                    radarContainer.style.display = 'block';
                    renderRadarChart(radarData);
                } else if (radarContainer) {
                    radarContainer.style.display = 'none';
                }
            });
        } else {
            let cacheHint = data.cached ? `<div class="cache-hint"><span class="icon">💾</span><span>此报告为缓存版本 (${data.cached_at})，点击"重新生成"获取最新分析。</span></div>` : '';
            const { html, radarData } = processReportResult(data.analysis, 'ai');
            if (contentEl) contentEl.innerHTML = cacheHint + html;
            if (loadingEl) loadingEl.style.display = 'none';
            if (contentEl) contentEl.style.display = 'block';
            const radarContainer = document.getElementById('aiRadarContainer');
            if (radarData && radarContainer) {
                radarContainer.style.display = 'block';
                renderRadarChart(radarData);
            } else if (radarContainer) {
                radarContainer.style.display = 'none';
            }
        }
    } catch (e) {
        console.error('[DEBUG] AI Analysis Failed:', e);
        if (contentEl) contentEl.innerHTML = `<p style="color:red;">请求失败: ${e.message}</p>`;
        if (loadingEl) loadingEl.style.display = 'none';
        if (contentEl) contentEl.style.display = 'block';
    }
}

function refreshAiAnalysis() {
    if (currentReportProjectId) callAiAnalysis(currentReportProjectId, true);
}

// Weekly report generation helpers migrated to static/js/report_hub.js

function renderBeautifulReport(markdown, type) {
    if (!markdown) return '<div class="error-msg">无报告内容</div>';
    markdown = cleanAiMarkdown(markdown);
    let score = null;
    const scoreMatch = markdown.match(/评分[：:]\s*(\d+)/);
    if (scoreMatch) score = parseInt(scoreMatch[1]);

    // 提取报告元信息
    const dateMatch = markdown.match(/报告日期[：:*\s]*(\d{4}-\d{2}-\d{2})/);
    const countMatch = markdown.match(/项目总数[：:*\s]*(\d+)/);
    const reportDate = dateMatch ? dateMatch[1] : new Date().toLocaleDateString('zh-CN');
    const projectCount = countMatch ? countMatch[1] : null;

    // 提取更多元信息 (从 AI 生成的内容中)
    const periodMatch = markdown.match(/\*\*报告周期\*\*[：:\s]*([^**\n\t]+)/);
    const pmMatch = markdown.match(/\*\*项目经理\*\*[：:\s]*([^|**\n\t]+)/);
    const progressMatch = markdown.match(/\*\*当前进度\*\*[：:\s]*(\d+)/);
    const contactMatch = markdown.match(/\*\*联系方式\*\*[：:\s]*([^**\n\t]+)/);

    const reportPeriod = periodMatch ? periodMatch[1].trim() : null;
    const projectPM = pmMatch ? pmMatch[1].trim() : (currentProject ? currentProject.project_manager : null);
    const progressPercent = progressMatch ? parseInt(progressMatch[1]) : (currentProject ? currentProject.progress : null);
    const contactInfo = contactMatch ? contactMatch[1].trim() : null;

    // 提取标题
    const titleMatch = markdown.match(/^#\s+(.+)/m);
    let title = titleMatch ? titleMatch[1].replace(/[📋🤖📊]/g, '').trim() : (type === 'ai' ? 'AI 智能诊断报告' : '项目周报');

    // 清理标题中的 emoji
    title = title.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim();

    // 移除已处理的元信息行，避免重复显示
    let cleanedMarkdown = markdown
        .replace(/^#\s+.+\n?/m, '')  // 移除标题
        .replace(/\*\*报告日期\*\*[^\n]+\n?/g, '')  // 移除报告日期行
        .replace(/报告日期[：:][^\n]+\n?/g, '')
        .replace(/\*\*报告周期\*\*[^\n]+\n?/g, '')
        .replace(/\*\*项目经理\*\*[^\n]+\n?/g, '')
        .replace(/\*\*当前进度\*\*[^\n]+\n?/g, '')
        .replace(/\*\*联系方式\*\*[^\n]+\n?/g, '')
        .replace(/^[ \t]*[|｜][ \t]*/gm, '') // 移除行首的管道符噪音
        .replace(/\n{3,}/g, '\n\n')        // 压缩多余换行
        .replace(/\*/g, '')               // 全局移除星号
        .trim();

    const sections = cleanedMarkdown.split(/(?=##\s)/);

    let html = `<div class="report-container">`;

    // 增强的报告头部
    html += `
        <div class="report-header ${type === 'ai' ? 'ai-report' : 'weekly-report'}">
            <div class="report-header-title">
                <span class="icon">${type === 'ai' ? '🤖' : '📋'}</span>
                <h2>${title}</h2>
            </div>
            <div class="report-meta">
                <div class="report-meta-item">
                    <span class="meta-icon">📅</span>
                    <span class="meta-label">报告日期</span>
                    <span class="meta-value">${reportDate}</span>
                </div>
                ${projectCount ? `
                <div class="report-meta-item">
                    <span class="meta-icon">📊</span>
                    <span class="meta-label">项目总数</span>
                    <span class="meta-value">${projectCount}个</span>
                </div>
                ` : ''}
                ${currentProject ? `
                <div class="report-meta-item">
                    <span class="meta-icon">🏥</span>
                    <span class="meta-label">所属医院</span>
                    <span class="meta-value">${currentProject.hospital_name}</span>
                </div>
                <div class="report-meta-item">
                    <span class="meta-icon">👤</span>
                    <span class="meta-label">项目经理</span>
                    <span class="meta-value">${projectPM || currentProject.project_manager || '未指派'}</span>
                </div>
                ` : `
                <div class="report-meta-item">
                    <span class="meta-icon">🏢</span>
                    <span class="meta-label">管理维度</span>
                    <span class="meta-value">全域项目群</span>
                </div>
                <div class="report-meta-item">
                    <span class="meta-icon">🏘️</span>
                    <span class="meta-label">管理中心</span>
                    <span class="meta-value">项目管理办公室 (PMO)</span>
                </div>
                `}
            </div>
        </div>

        <!-- 增强的概要卡片网格 -->
        ${(reportPeriod || progressPercent !== null) ? `
        <div class="report-overview-grid">
            ${reportPeriod ? `
            <div class="overview-card-v2">
                <div class="card-icon">📅</div>
                <div class="card-content">
                    <div class="card-label">报告周期</div>
                    <div class="card-value">${reportPeriod}</div>
                </div>
            </div>
            ` : ''}
            
            <div class="overview-card-v2">
                <div class="card-icon">👤</div>
                <div class="card-content">
                    <div class="card-label">执行负责人</div>
                    <div class="card-value">${projectPM || '未设置'}</div>
                </div>
            </div>

            ${progressPercent !== null ? `
            <div class="overview-card-v2">
                <div class="card-icon">📈</div>
                <div class="card-content">
                    <div class="card-label">项目进度</div>
                    <div class="card-value">${progressPercent}%</div>
                    <div class="progress-mini-track">
                        <div class="progress-mini-bar" style="width: ${progressPercent}%"></div>
                    </div>
                </div>
            </div>
            ` : ''}

            ${contactInfo ? `
            <div class="overview-card-v2">
                <div class="card-icon">📞</div>
                <div class="card-content">
                    <div class="card-label">联系方式</div>
                    <div class="card-value">${contactInfo}</div>
                </div>
            </div>
            ` : ''}
            
            ${projectCount ? `
            <div class="overview-card-v2">
                <div class="card-icon">📊</div>
                <div class="card-content">
                    <div class="card-label">覆盖范围</div>
                    <div class="card-value">${projectCount}个项目</div>
                </div>
            </div>
            ` : ''}
        </div>
        ` : ''}

        ${!currentProject && projectCount && !reportPeriod ? `
        <div class="overview-grid" style="margin-top: 20px;">
            <div class="overview-card">
                <div class="overview-card-title">监控项目</div>
                <div class="overview-card-value">${projectCount}个</div>
            </div>
            <div class="overview-card">
                <div class="overview-card-title">报告类型</div>
                <div class="overview-card-value" style="font-size: 18px;">${type === 'ai' ? '智能分析' : '汇总周报'}</div>
            </div>
            <div class="overview-card">
                <div class="overview-card-title">数据哈希</div>
                <div class="overview-card-value" style="font-size: 14px; font-family: monospace;">${reportDate.replace(/-/g, '')}</div>
            </div>
        </div>
        ` : ''}
    `;

    // 评分卡片（如果有）
    if (score !== null) {
        const scoreClass = score >= 70 ? 'score-high' : (score >= 40 ? 'score-medium' : 'score-low');
        const scoreText = score >= 70 ? '健康' : (score >= 40 ? '需关注' : '风险');
        const scoreEmoji = score >= 70 ? '✅' : (score >= 40 ? '⚠️' : '🚨');
        html += `
            <div class="score-card ${scoreClass}">
                <div class="score-circle">
                    <div class="score-value">${score}</div>
                    <div class="score-label">分</div>
                </div>
                <div class="score-info">
                    <div class="score-title">${scoreEmoji} 项目健康度：${scoreText}</div>
                    <div class="score-desc">${score >= 70 ? '项目整体运行良好，继续保持当前节奏。' : score >= 40 ? '项目存在一定风险，建议关注重点问题并及时处理。' : '项目风险较高，需要立即干预，建议召开紧急会议。'}</div>
                </div>
            </div>
        `;
    }

    // 渲染各个章节
    sections.forEach(section => {
        const trimmedSection = section.trim();
        if (!trimmedSection) return;

        const sectionTitleMatch = trimmedSection.match(/^##\s*\d*\.?\s*[、]?\s*(.+)/m);

        // 处理没有二级标题的章节 (通常是开头的引言)
        if (!sectionTitleMatch) {
            // 如果内容在经过 marked 解析后不包含有意义的文本（排除标题），则跳过
            const parsedContent = renderAiMarkdown(trimmedSection);
            const textContent = parsedContent.replace(/<[^>]*>/g, '').trim();

            if (textContent.length > 0 && !trimmedSection.startsWith('#')) {
                html += `<div class="report-section"><div class="report-section-body">${parsedContent}</div></div>`;
            }
            return;
        }
        const sectionTitle = sectionTitleMatch[1].trim();
        const sectionContent = section.replace(/^##\s*.+\n/, '').trim();

        // 根据标题确定图标和样式
        let iconClass = 'progress', icon = '📊';
        if (sectionTitle.includes('风险') || sectionTitle.includes('问题') || sectionTitle.includes('待处理')) {
            iconClass = 'risk'; icon = '⚠️';
        } else if (sectionTitle.includes('建议') || sectionTitle.includes('措施')) {
            iconClass = 'suggestion'; icon = '💡';
        } else if (sectionTitle.includes('重点') || sectionTitle.includes('计划') || sectionTitle.includes('下周')) {
            iconClass = 'focus'; icon = '🎯';
        } else if (sectionTitle.includes('概览') || sectionTitle.includes('整体') || sectionTitle.includes('汇总')) {
            iconClass = 'overview'; icon = '📋';
        } else if (sectionTitle.includes('亮点') || sectionTitle.includes('成果') || sectionTitle.includes('完成')) {
            iconClass = 'success'; icon = '✨';
        } else if (sectionTitle.includes('资源') || sectionTitle.includes('协调')) {
            iconClass = 'resource'; icon = '🤝';
        }

        html += `
            <div class="report-section">
                <div class="report-section-header">
                    <div class="report-section-icon ${iconClass}">${icon}</div>
                    <div class="report-section-title">${sectionTitle}</div>
                </div>
                <div class="report-section-body">
                    ${renderAiMarkdown(sectionContent)}
                </div>
            </div>
        `;
    });

    // 报告页脚
    html += `
        <div class="report-footer">
            <div class="report-footer-info">
                <span>📄 报告由 AI 自动生成</span>
                <span>⏰ 生成时间: ${new Date().toLocaleString('zh-CN')}</span>
            </div>
        </div>
    `;

    html += `</div>`;
    return html;
}
function processReportResult(markdown, type) {
    if (!markdown) return { html: '', radarData: null };
    let radarData = null;
    let cleanedMarkdown = cleanAiMarkdown(markdown);

    // 提取 JSON 雷达数据
    const jsonMatch = markdown.match(/```json\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[1]);
            if (parsed.radar) {
                radarData = parsed.radar;
                // 从正文中移除 JSON 代码块，避免显示
                cleanedMarkdown = markdown.replace(jsonMatch[0], '');
            }
        } catch (e) {
            console.error('Failed to parse radar JSON', e);
        }
    }

    return {
        html: renderBeautifulReport(cleanedMarkdown, type),
        radarData: radarData
    };
}

function renderRadarChart(data) {
    const chartDom = document.getElementById('aiRadarChart');
    const myChart = echarts.init(chartDom);

    const indicators = Object.keys(data).map(key => ({ name: key, max: 10 }));
    const values = Object.values(data);

    const option = {
        title: { text: '项目风险维度图', left: 'center', top: 10, textStyle: { fontSize: 14, color: '#4b5563' } },
        radar: {
            indicator: indicators,
            shape: 'circle',
            splitNumber: 5,
            axisName: { color: '#6b7280' },
            splitLine: { lineStyle: { color: ['#f3f4f6'] } },
            splitArea: { show: false },
            axisLine: { lineStyle: { color: '#f3f4f6' } }
        },
        series: [{
            name: '风险评估',
            type: 'radar',
            data: [{
                value: values,
                name: '得分',
                areaStyle: { color: 'rgba(99, 102, 241, 0.2)' },
                lineStyle: { color: '#6366f1', width: 2 },
                itemStyle: { color: '#6366f1' }
            }]
        }]
    };

    myChart.setOption(option);
    window.addEventListener('resize', () => myChart.resize());
}

function copyReportContent(elementId) {
    const content = document.getElementById(elementId).innerText;
    navigator.clipboard.writeText(content).then(() => showToast('内容已复制', 'success'));
}

// Modal Display Functions (Consolidated above)

function showAddProjectModal() {
    document.getElementById('projectForm').reset();
    document.getElementById('planStartDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('projectModalTitle').textContent = '新建项目';
    // 重置手动输入标记，允许智能提取
    document.getElementById('hospitalName').dataset.manualInput = 'false';
    showModal('projectModal');
}
// ========== 从项目名称智能提取医院名称 ==========
function extractHospitalFromProjectName(projectName) {
    if (!projectName) return;

    const hospitalInput = document.getElementById('hospitalName');
    // 如果医院名称已经手动填写了，不要覆盖
    if (hospitalInput.dataset.manualInput === 'true' && hospitalInput.value) return;

    // 常见的医院名称模式 - 按优先级排序
    const patterns = [
        // 1. 精确匹配：XX医院、XX人民医院、XX中心医院等
        /(.{2,20}(?:人民医院|中心医院|第一医院|第二医院|第三医院|附属医院|妇幼保健院|中医院|康复医院|专科医院|儿童医院|肿瘤医院|骨科医院))/,
        // 2. 通用医院匹配
        /(.{2,20}医院)/,
        // 3. 其他医疗机构
        /(.{2,20}(?:卫生院|诊所|医疗中心|卫生中心|卫生服务中心))/,
        // 4. 带地区前缀的匹配
        /(.{2,6}(?:市|县|区|省|镇|乡).{0,10}(?:医院|卫生院))/,
        // 5. 兜底：取项目名称开头到关键词之前
        /^(.+?)(?:手麻|重症|ICU|icu|信息化|数字化|项目|系统|实施|上线)/i
    ];

    let extractedHospital = '';

    for (const pattern of patterns) {
        const match = projectName.match(pattern);
        if (match && match[1]) {
            extractedHospital = match[1].trim();
            // 清理后缀
            extractedHospital = extractedHospital
                .replace(/手麻$/, '')
                .replace(/重症$/, '')
                .replace(/ICU$/i, '')
                .replace(/信息化$/, '')
                .replace(/数字化$/, '')
                .replace(/系统$/, '')
                .replace(/项目$/, '')
                .replace(/实施$/, '')
                .replace(/上线$/, '')
                .trim();

            // 确保提取的名称有意义（至少2个字符）
            if (extractedHospital.length >= 2) {
                break;
            }
        }
    }

    // 如果提取到了医院名称，自动填充
    if (extractedHospital && extractedHospital.length >= 2) {
        hospitalInput.value = extractedHospital;
    }
}

// 医院名称输入处理（手动输入标记）
function onHospitalManualInput() {
    const hospitalInput = document.getElementById('hospitalName');
    if (hospitalInput.value) {
        hospitalInput.dataset.manualInput = 'true';
    }
}

// Project detail modal/save/delete/update/interface-template helpers migrated to static/js/project_detail_hub.js

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal.show').forEach(m => m.classList.remove('show'));
    }
});

// Approval center logic moved to approval_hub.js

async function handleApproval(type, id, status) {
    if (!confirm(`确认要将此项标记为 ${status} 吗？`)) return;

    try {
        if (type === 'change') {
            await api.put(`/changes/${id}`, { status: status });
        } else if (type === 'expense') {
            await api.put(`/expenses/${id}`, { status: status });
        } else if (type === 'departure') {
            await api.put(`/departures/${id}`, { status: status });
        }
        showApprovalCenter();
        showToast('操作成功');
    } catch (e) {
        showToast('操作失败: ' + e.message, 'danger');
    }
}


function showPerformanceAnalytics() {
    currentProjectId = null;
    hideAllViews();
    document.getElementById('analyticsView').style.display = 'block';
    if (typeof initPerformanceAnalytics === 'function') {
        initPerformanceAnalytics();
    } else {
        document.getElementById('analyticsView').innerHTML = '<div class="loading-spinner">加载绩效模块中...</div>';
        const script = document.createElement('script');
        script.src = '/static/js/analytics.js';
        script.onload = () => initPerformanceAnalytics();
        document.body.appendChild(script);
    }
}

function showKBView() {
    currentProjectId = null;
    hideAllViews();
    document.getElementById('kbView').style.display = 'block';
    if (typeof initKB === 'function') {
        initKB();
    } else {
        document.getElementById('kbListContainer').innerHTML = '<div class="loading-spinner">加载知识库模块中...</div>';
        const script = document.createElement('script');
        script.src = '/static/js/kb_management.js';
        script.onload = () => initKB();
        document.body.appendChild(script);
    }
}

function showFormGeneratorView() {
    currentProjectId = null;
    hideAllViews();
    document.getElementById('formGeneratorView').style.display = 'block';
    if (typeof FormGenerator !== 'undefined') {
        FormGenerator.init();
    } else {
        const script = document.createElement('script');
        script.src = '/api/force_static/js/form_generator.js';
        script.onload = () => {
            if (typeof FormGenerator !== 'undefined') {
                FormGenerator.init();
            }
        };
        document.body.appendChild(script);
    }
}

function showAssetView() {
    currentProjectId = null;
    hideAllViews();
    document.getElementById('assetView').style.display = 'block';
    if (typeof initAssets === 'function') {
        initAssets();
    } else {
        document.getElementById('assetTableBody').innerHTML = '<tr><td colspan="8" class="text-center">加载资产模块中...</td></tr>';
        const script = document.createElement('script');
        script.src = '/static/js/asset_management.js';
        script.onload = () => initAssets();
        document.body.appendChild(script);
    }
}

// Project detail interface flow renderer migrated to static/js/project_detail_hub.js

// Project export helper migrated to static/js/report_hub.js

// ========== 统计分析函数 ==========
async function loadExpenseStats() {
    if (!currentProjectId) return;
    showModal('expenseStatsModal');

    try {
        const stats = await api.get(`/projects/${currentProjectId}/expenses/stats`);

        // 更新概览数据
        document.getElementById('statsTotalExpense').textContent = `¥${stats.total.toFixed(2)}`;

        const pending = stats.by_status.find(s => s.status === '待报销');
        const pendingAmount = pending ? pending.amount : 0;
        document.getElementById('statsPendingExpense').textContent = `¥${pendingAmount.toFixed(2)}`;

        // 渲染图表
        setTimeout(() => {
            // 费用类型饼图
            const typeChart = echarts.init(document.getElementById('expenseTypeChart'));
            const typeOption = {
                tooltip: { trigger: 'item' },
                legend: { bottom: '5%', left: 'center' },
                series: [{
                    name: '费用类型',
                    type: 'pie',
                    radius: ['40%', '70%'],
                    avoidLabelOverlap: false,
                    itemStyle: { borderRadius: 10, borderColor: '#fff', borderWidth: 2 },
                    label: { show: false, position: 'center' },
                    emphasis: { label: { show: true, fontSize: '20', fontWeight: 'bold' } },
                    data: stats.by_type.map(t => ({ value: t.amount, name: t.expense_type }))
                }]
            };
            typeChart.setOption(typeOption);

            // 费用趋势柱状图
            const trendChart = echarts.init(document.getElementById('expenseTrendChart'));
            const trendOption = {
                tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
                xAxis: { type: 'category', data: stats.by_month.map(m => m.month) },
                yAxis: { type: 'value' },
                series: [{
                    name: '支出金额',
                    type: 'bar',
                    data: stats.by_month.map(m => m.amount),
                    itemStyle: { color: '#8b5cf6' },
                    barWidth: '40%'
                }]
            };
            trendChart.setOption(trendOption);

            // 窗口调整时重绘
            window.addEventListener('resize', () => {
                typeChart.resize();
                trendChart.resize();
            });
        }, 300);

    } catch (e) {
        console.error('加载费用统计失败', e);
        showToast('加载统计数据失败', 'danger');
    }
}

async function loadWorklogStats() {
    if (!currentProjectId) return;
    showModal('worklogStatsModal');

    try {
        const stats = await api.get(`/projects/${currentProjectId}/worklogs/stats`);

        // 更新概览
        document.getElementById('statsTotalHours').textContent = `${stats.total_hours}h`;
        const memberCount = stats.by_member.length || 1;
        const avgHours = stats.total_hours / memberCount;
        document.getElementById('statsAvgHours').textContent = `${avgHours.toFixed(1)}h`;

        // 渲染图表
        setTimeout(() => {
            // 成员投入饼图
            const memberChart = echarts.init(document.getElementById('worklogMemberChart'));
            const memberOption = {
                tooltip: { trigger: 'item' },
                legend: { type: 'scroll', bottom: '5%' },
                series: [{
                    name: '工时投入',
                    type: 'pie',
                    radius: '60%',
                    data: stats.by_member.map(m => ({ value: m.hours, name: m.member_name }))
                }]
            };
            memberChart.setOption(memberOption);

            // 月度趋势折线图
            const trendChart = echarts.init(document.getElementById('worklogTrendChart'));
            const trendOption = {
                tooltip: { trigger: 'axis' },
                grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
                xAxis: { type: 'category', data: stats.by_month.map(m => m.month) },
                yAxis: { type: 'value' },
                series: [{
                    name: '投入工时',
                    type: 'line',
                    smooth: true,
                    data: stats.by_month.map(m => m.hours),
                    areaStyle: { opacity: 0.3 },
                    itemStyle: { color: '#3b82f6' }
                }]
            };
            trendChart.setOption(trendOption);

            window.addEventListener('resize', () => {
                memberChart.resize();
                trendChart.resize();
            });
        }, 300);

    } catch (e) {
        console.error('加载工时统计失败', e);
        showToast('加载统计数据失败', 'danger');
    }
}

// ========== 登录/注册功能 ==========
let currentUser = null;

// Auth/session helpers migrated to static/js/auth_hub.js

/**
 * 开始企办绑定流程 (Exposed globally)
 */
window.startWecomBind = function () {
    if (!currentUser) {
        toast('请先登录');
        return;
    }
    // 显示扫码弹窗
    const containerId = 'wecomBindContainer';
    let container = document.getElementById(containerId);
    if (!container) {
        const modal = document.createElement('div');
        modal.id = 'wecomBindModal';
        modal.className = 'modal show';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 400px;">
                <div class="modal-header">
                    <h3>绑定企业微信</h3>
                    <button class="modal-close" onclick="closeModal('wecomBindModal')">&times;</button>
                </div>
                <div class="modal-body" style="text-align: center; padding: 20px;">
                    <div id="${containerId}"></div>
                    <p style="margin-top: 15px; font-size: 13px; color: #666;">请使用企业微信扫码以完成绑定</p>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    } else {
        openModal('wecomBindModal');
    }

    // 初始化扫码
    showWecomLogin(containerId, null, 'bind');
}

/**
 * 显示企业微信登录/绑定二维码
 * @param {string} containerId 容器ID
 * @param {string} hideId 扫码成功后隐藏的元素ID
 * @param {string} state OAuth state
 */
function showWecomLogin(containerId, hideId, state = 'login') {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.style.display = 'block';
    if (hideId) {
        const hideEl = document.getElementById(hideId);
        if (hideEl) hideEl.style.display = 'none';
    }

    // 获取配置并初始化 WWLogin
    api.get('/wecom/config').then(config => {
        const appid = config.corp_id || config.appid;
        const agentid = config.agent_id || config.agentid;

        if (!appid || !agentid) {
            container.innerHTML = '<div style="color:red;padding:20px;">未配置企业微信参数</div>';
            return;
        }

        const WwLoginConstructor = window.WwLogin || window.wwLogin;
        if (typeof WwLoginConstructor !== 'function') {
            container.innerHTML = '<div style="color:red;padding:20px;">WeCom SDK 加载失败，请检查网络或刷新页面</div>';
            return;
        }

        container.innerHTML = ""; // 清空容器，防止干扰

        const params = {
            "id": containerId,
            "appid": appid,
            "agentid": agentid,
            "redirect_uri": encodeURIComponent(window.location.origin + '/api/wecom/oauth/callback'),
            "state": state,
            "lang": "zh",
        };

        try {
            console.log('[WECOM] Initializing QR login with params:', params);
            // 某些版本的 SDK 必须使用 new，某些则不需要，这里统一使用 new
            new WwLoginConstructor(params);
        } catch (e) {
            console.warn('[WECOM] WwLogin constructor failed, trying as function...', e);
            try {
                WwLoginConstructor(params);
            } catch (e2) {
                console.error('[WECOM] WwLogin completely failed', e2);
                container.innerHTML = '<div style="color:red;padding:20px;">二维码初始化失败: ' + e2.message + '</div>';
            }
        }
    }).catch(err => {
        container.innerHTML = '<div style="color:red;padding:20px;">加载配置失败: ' + err.message + '</div>';
    });
}

// Auth panel/login/register/logout helpers migrated to static/js/auth_hub.js

// Reminder center logic moved to reminder_center_hub.js

// ========== 模板选择功能 ==========
let selectedTemplate = null;

async function onTemplateSelect(templateId) {
    const preview = document.getElementById('templatePreview');
    const content = document.getElementById('templatePreviewContent');

    if (!templateId) {
        preview.style.display = 'none';
        selectedTemplate = null;
        return;
    }

    try {
        const res = await api.get(`/templates/${templateId}`);
        if (res.success) {
            selectedTemplate = res.data;
            const t = res.data;
            content.innerHTML = `
                <strong>${t.name}</strong><br>
                <span style="color:#6b7280;">${t.description}</span><br>
                <div style="margin-top:8px;">
                    <span>📅 预计周期: ${t.estimated_days} 天</span> | 
                    <span>📋 包含 ${t.stages.length} 个阶段</span>
                </div>
                <div style="margin-top:8px; font-size:12px; color:#6b7280;">
                    阶段: ${t.stages.map(s => s.name).join(' → ')}
                </div>
            `;
            preview.style.display = 'block';
        }
    } catch (e) {
        preview.style.display = 'none';
    }
}

// ========== 项目对比功能 ==========
let selectedCompareProjects = new Set();

function showProjectComparison() {
    openModal('comparisonModal');
    loadComparisonProjectList();
}

function loadComparisonProjectList() {
    const container = document.getElementById('comparisonProjectList');
    container.innerHTML = allProjects.map(p => `
        <label style="display: flex; align-items: center; gap: 6px; padding: 8px 12px; background: white; border: 1px solid #e5e7eb; border-radius: 8px; cursor: pointer;">
            <input type="checkbox" value="${p.id}" onchange="toggleCompareProject(${p.id})" ${selectedCompareProjects.has(p.id) ? 'checked' : ''}>
            <span style="font-size: 13px;">${p.project_name}</span>
        </label>
    `).join('');
}

function toggleCompareProject(id) {
    if (selectedCompareProjects.has(id)) {
        selectedCompareProjects.delete(id);
    } else {
        if (selectedCompareProjects.size >= 5) {
            showToast('最多选择5个项目', 'warning');
            event.target.checked = false;
            return;
        }
        selectedCompareProjects.add(id);
    }
}

async function runProjectComparison() {
    if (selectedCompareProjects.size < 2) {
        showToast('请至少选择2个项目进行对比', 'warning');
        return;
    }

    const resultDiv = document.getElementById('comparisonResult');
    resultDiv.style.display = 'none';

    try {
        const res = await api.post('/analytics/compare', { project_ids: Array.from(selectedCompareProjects) });
        if (res && res.projects) {
            const projects = res.projects;

            // 构建表头
            const header = document.getElementById('comparisonHeader');
            header.innerHTML = '<th>指标</th>' + projects.map(p => `<th>${p.name}</th>`).join('');

            // 构建表体
            const body = document.getElementById('comparisonBody');
            const metrics = [
                { key: 'progress', label: '项目进度', format: v => `${v}%` },
                { key: 'total_tasks', label: '总任务数', format: v => v },
                { key: 'completed_tasks', label: '已完成任务', format: v => v },
                { key: 'pending_issues', label: '未解决问题', format: v => v },
                { key: 'total_hours', label: '总工时', format: v => `${(v || 0).toFixed(1)}h` },
                { key: 'total_expenses', label: '总费用', format: v => `¥${(v || 0).toFixed(0)}` },
                { key: 'risk_score', label: '风险评分', format: v => (v || 0).toFixed(1) }
            ];

            body.innerHTML = metrics.map(m => `
                <tr>
                    <td><strong>${m.label}</strong></td>
                    ${projects.map(p => `<td>${m.format(p[m.key])}</td>`).join('')}
                </tr>
            `).join('');

            resultDiv.style.display = 'block';
        }
    } catch (e) {
        showToast('对比分析失败', 'danger');
    }
}

// 初始化时检查登录状态
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    loadReminderBadge();
});

async function loadReminderBadge() {
    try {
        const data = await api.get('/reminders/digest');
        if (data) {
            const badge = document.getElementById('reminderBadge');
            const total = (data.overdue_count || 0) + (data.upcoming_count || 0);
            if (total > 0) {
                badge.textContent = total;
                badge.style.display = 'inline';
            }
        }
    } catch (e) { }
}

// ========== 项目权限管理功能 ==========
async function openProjectAccessModal(projectId) {
    currentProjectId = projectId;
    openModal('projectAccessModal');
    loadUsersForAccess();
    loadProjectAccess(projectId);
}

async function loadUsersForAccess() {
    const select = document.getElementById('accessUserSelect');
    try {
        const users = await api.get('/users');
        if (Array.isArray(users)) {
            select.innerHTML = '<option value="">-- 请选择用户 --</option>' +
                users.map(u => `<option value="${u.id}">${u.display_name || u.username} (@${u.username})</option>`).join('');
        }
    } catch (e) {
        select.innerHTML = '<option value="">加载失败</option>';
    }
}

async function loadProjectAccess(projectId) {
    const list = document.getElementById('projectMemberList');
    try {
        const members = await api.get(`/projects/${projectId}/access`);
        if (Array.isArray(members)) {
            if (members.length === 0) {
                list.innerHTML = '<div style="text-align: center; color: var(--gray-400); padding: 20px;">暂无授权成员</div>';
                return;
            }
            list.innerHTML = members.map(m => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: var(--gray-50); border-radius: 8px; margin-bottom: 8px; border: 1px solid var(--gray-200);">
                    <div>
                        <div style="font-weight: 600; color: var(--gray-800);">${m.display_name || m.username}</div>
                        <div style="font-size: 11px; color: var(--gray-500);">角色: <span class="badge" style="font-size: 10px; padding: 1px 6px;">${m.role}</span></div>
                    </div>
                    ${(m.role !== 'owner' || (currentUser && currentUser.role === 'admin')) ? `
                        <button class="btn btn-icon btn-danger" onclick="removeProjectAccess(${m.user_id})" title="移除权限">✕</button>
                    ` : ''}
                </div>
            `).join('');
        }
    } catch (e) {
        list.innerHTML = '<div style="text-align: center; color: var(--danger); padding: 20px;">加载失败</div>';
    }
}

async function addProjectAccess() {
    const userId = document.getElementById('accessUserSelect').value;
    const role = document.getElementById('accessRoleSelect').value;

    if (!userId) {
        showToast('请选择用户', 'warning');
        return;
    }

    try {
        await api.post(`/projects/${currentProjectId}/access`, { user_id: parseInt(userId), role }, { silent: true });
        loadProjectAccess(currentProjectId);
        showToast('授权成功', 'success');
    } catch (e) {
        showToast('操作异常: ' + e.message, 'danger');
    }
}

async function removeProjectAccess(userId) {
    if (!confirm('确定要移除该用户的访问权限吗？')) return;

    try {
        await api.delete(`/projects/${currentProjectId}/access/${userId}`);
        loadProjectAccess(currentProjectId);
        showToast('移除成功', 'success');
    } catch (e) {
        showToast('操作异常: ' + e.message, 'danger');
    }
}

// Admin user-management and AI-config helpers migrated to static/js/admin_hub.js

async function migrateEnvConfigs() {
    try {
        const result = await api.post('/admin/ai-configs/migrate', {});
        showToast(result.message || '操作完成', 'success');
        await loadAIConfigs();
    } catch (e) {
        showToast('导入失败: ' + e.message, 'danger');
    }
}

// ========== 报告归档 ==========

// Report archive helpers migrated to static/js/report_hub.js
/**
 * 显示全局气泡通知 (Toast)
 * 支持:
 * - showToast(message)
 * - showToast(message, duration)
 * - showToast(message, type)
 * - showToast(message, type, duration)
 */
function showToast(message, typeOrDuration = 3000, maybeDuration) {
    let type = 'info';
    let duration = 3000;

    if (typeof typeOrDuration === 'number') {
        duration = typeOrDuration;
    } else if (typeof typeOrDuration === 'string') {
        type = typeOrDuration;
        if (typeof maybeDuration === 'number') {
            duration = maybeDuration;
        }
    }

    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${message}</span>`;

    container.appendChild(toast);

    // 自动移除
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
            if (container.childNodes.length === 0 && container.parentNode) {
                container.parentNode.removeChild(container);
            }
        }, 300);
    }, duration);
}

function cleanAiMarkdown(text) {
    if (!text) return '';
    return String(text)
        .replace(/【[^】\n]{0,120}†[^】\n]{0,120}】/g, '')
        .replace(/\[\^\{\{thread-[^\]\n]{0,80}\]?/g, '')
        .replace(/\[\^[^\]\n]{0,120}\]/g, '')
        .replace(/\[\^[^\n]{0,120}$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function renderAiMarkdown(text) {
    const cleaned = cleanAiMarkdown(text);
    if (typeof marked !== 'undefined') {
        return marked.parse(cleaned);
    }
    return cleaned.replace(/\n/g, '<br>');
}

async function copyCurrentViewLink() {
    try {
        await navigator.clipboard.writeText(window.location.href);
        showToast('当前视图链接已复制', 'success');
    } catch (e) {
        showToast('复制链接失败: ' + e.message, 'danger');
    }
}

// ========== 里程碑庆祝与复盘逻辑 ==========

// ========== 里程碑庆祝与复盘逻辑 ==========
let isCheckingCelebration = false; // 防止重复检查

async function checkMilestoneCelebrations(projectId) {
    if (!projectId || isCheckingCelebration) return;

    isCheckingCelebration = true;
    try {
        const res = await api.get(`/projects/${projectId}/milestones/pending-celebrations`);
        // API 返回的是 list, 可能是 {success: true, data: [...]} 或直接 [...]
        // api.js get通常返回 body.data 或 body
        // 假设 api.js 统一处理了 success, 这里 res 可能是 data

        const milestones = Array.isArray(res) ? res : (res.data || []);

        if (milestones && milestones.length > 0) {
            const m = milestones[0]; // 一次只庆一个
            // double check we are not already showing it
            if (window.currentCelebratingMilestone && window.currentCelebratingMilestone.id === m.id) {
                isCheckingCelebration = false;
                return;
            }

            window.currentCelebratingMilestone = m;
            showCelebration(m);
        }
    } catch (e) {
        console.error('Check celebrations failed', e);
    } finally {
        isCheckingCelebration = false;
    }
}

function showCelebration(m) {
    const titleEl = document.getElementById('celebrationTitle');
    const msgEl = document.getElementById('celebrationMsg');
    if (!titleEl || !msgEl) return;

    titleEl.textContent = `✨ ${m.name} 达成！`;
    const dateStr = m.completed_date || '今日';
    msgEl.textContent = `祝贺团队！该里程碑于 ${dateStr} 正式完成。每一个里程碑的达成，都是项目的关键进展。`;
    document.getElementById('celebrationRetro').value = '';
    openModal('celebrationModal');
}

async function submitMilestoneRetro() {
    const m = window.currentCelebratingMilestone;
    if (!m) return;

    const content = document.getElementById('celebrationRetro').value;
    if (content.trim()) {
        try {
            await api.post(`/projects/milestones/${m.id}/retrospective`, {
                project_id: currentProjectId,
                content: content,
                author: '项目团队'
            });
        } catch (e) {
            console.error('Save retro failed', e);
        }
    }

    try {
        await api.post(`/projects/milestones/${m.id}/celebrated`);
    } catch (e) {
        console.error('Mark celebrated failed', e);
    }

    // 立即清除状态并关闭弹窗
    window.currentCelebratingMilestone = null;
    closeModal('celebrationModal');

    // 延迟检查是否还有下一个
    setTimeout(() => checkMilestoneCelebrations(currentProjectId), 1000);
}

async function closeCelebration() {
    const m = window.currentCelebratingMilestone;
    if (m) {
        try {
            await api.post(`/projects/milestones/${m.id}/celebrated`);
        } catch (e) {
            console.error('Mark celebrated failed', e);
        }
        window.currentCelebratingMilestone = null;
    }
    closeModal('celebrationModal');
    // 延迟检查
    setTimeout(() => checkMilestoneCelebrations(currentProjectId), 1000);
}

// ========== 风险趋势分析 ==========
// Analytics/forecast helpers migrated to static/js/analytics_hub.js


function showGenericModal(title, contentHtml) {
    const modal = document.getElementById('askAiModal');
    if (!modal) { showToast(title, 'info', 4000); return; }

    const modalTitle = modal.querySelector('h3');
    const modalBody = modal.querySelector('.modal-body');
    const inputGroup = modal.querySelector('.input-group');
    const resultDiv = modal.querySelector('#aiQueryResult');

    if (modalTitle) modalTitle.textContent = title;
    if (inputGroup) inputGroup.style.display = 'none';
    if (resultDiv) resultDiv.style.display = 'none';

    let contentDiv = modal.querySelector('#genericModalContent');
    if (!contentDiv) {
        contentDiv = document.createElement('div');
        contentDiv.id = 'genericModalContent';
        modalBody.appendChild(contentDiv);
    }
    contentDiv.innerHTML = contentHtml;
    contentDiv.style.display = 'block';

    modal.style.display = 'block';

    const closeBtn = modal.querySelector('.modal-close');
    closeBtn.onclick = () => {
        modal.style.display = 'none';
        inputGroup.style.display = 'flex';
        contentDiv.style.display = 'none';
        modalTitle.textContent = '🔮 AI 项目问答';
    };
}
async function loadProjectFinancials(projectId) {
    const container = document.getElementById('financialsContent');
    if (!container) return;

    container.innerHTML = '<div class="loading-spinner"></div>';

    try {
        const data = await api.get(`/projects/${projectId}/financials`);
        if (data.error) throw new Error(data.error);

        renderFinancialOverview(data, container);
    } catch (e) {
        container.innerHTML = `<div class="error-state">无法加载财务数据: ${e.message}</div>`;
    }
}

function renderFinancialOverview(data, container) {
    container.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px;">
            <div class="overview-card" style="background: #f0fdf4; border: 1px solid #bbf7d0;">
                <div class="overview-card-title" style="color: #15803d;">总收入 (Revenue)</div>
                <div class="overview-card-value" style="color: #166534;">¥${data.revenue.toLocaleString()}</div>
            </div>
            <div class="overview-card" style="background: #fff1f2; border: 1px solid #fecdd3;">
                <div class="overview-card-title" style="color: #b91c1c;">人力成本 (Labor)</div>
                <div class="overview-card-value" style="color: #991b1b;">¥${data.labor_cost.toLocaleString()}</div>
            </div>
            <div class="overview-card" style="background: #fff7ed; border: 1px solid #ffedd5;">
                <div class="overview-card-title" style="color: #c2410c;">直接支出 (Expenses)</div>
                <div class="overview-card-value" style="color: #9a3412;">¥${data.expenses.toLocaleString()}</div>
            </div>
            <div class="overview-card" style="background: ${data.gross_profit >= 0 ? '#eff6ff' : '#fef2f2'}; border: 1px solid ${data.gross_profit >= 0 ? '#dbeafe' : '#fee2e2'};">
                <div class="overview-card-title" style="color: ${data.gross_profit >= 0 ? '#1d4ed8' : '#991b1b'};">项目毛利 (Profit)</div>
                <div class="overview-card-value" style="color: ${data.gross_profit >= 0 ? '#1e40af' : '#7f1d1d'};">
                    ¥${data.gross_profit.toLocaleString()}
                    <span style="font-size: 11px; display: block; font-weight: 500; opacity: 0.7;">毛利率: ${data.margin}%</span>
                </div>
            </div>
        </div>

        <div style="display: flex; gap: 24px; flex-wrap: wrap;">
            <div class="panel" style="flex: 2; min-width: 400px; border: 1px solid #f1f5f9; box-shadow: none;">
                <div class="panel-header" style="background: transparent; border-bottom: 1px solid #f8fafc;">
                    <div class="panel-title" style="font-size: 13px; color: #64748b;">财务瀑布图 (Financial Waterfall)</div>
                </div>
                <div class="panel-body">
                    <div id="financialWaterfallChart" style="height: 350px;"></div>
                </div>
            </div>
            <div class="panel" style="flex: 1; min-width: 300px; border: 1px solid #f1f5f9; box-shadow: none;">
                <div class="panel-header" style="background: transparent; border-bottom: 1px solid #f8fafc;">
                    <div class="panel-title" style="font-size: 13px; color: #64748b;">成员成本贡献</div>
                </div>
                <div class="panel-body" id="memberCostTable" style="max-height: 350px; overflow-y: auto;">
                    <div class="loading-spinner"></div>
                </div>
            </div>
        </div>
    `;

    renderFinancialWaterfall(data.waterfall_data);
    loadMemberCosts(data.project_id);
}

function renderFinancialWaterfall(data) {
    const chartDom = document.getElementById('financialWaterfallChart');
    if (!chartDom) return;
    const myChart = echarts.init(chartDom);

    const xAxisData = data.map(item => item.name);
    const seriesData = [];
    const helpData = [];
    let total = 0;

    for (let i = 0; i < data.length; i++) {
        const val = data[i].value;
        if (data[i].isTotal) {
            helpData.push(0);
            seriesData.push(val);
        } else {
            if (val >= 0) {
                helpData.push(total);
                seriesData.push(val);
                total += val;
            } else {
                total += val;
                helpData.push(total);
                seriesData.push(-val);
            }
        }
    }

    const option = {
        grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
        xAxis: { type: 'category', splitLine: { show: false }, data: xAxisData },
        yAxis: { type: 'value' },
        series: [
            {
                name: 'Placeholder',
                type: 'bar',
                stack: 'Total',
                itemStyle: { borderColor: 'transparent', color: 'transparent' },
                emphasis: { itemStyle: { borderColor: 'transparent', color: 'transparent' } },
                data: helpData
            },
            {
                name: 'Amount',
                type: 'bar',
                stack: 'Total',
                label: { show: true, position: 'inside' },
                data: seriesData,
                itemStyle: {
                    color: function (params) {
                        const idx = params.dataIndex;
                        if (data[idx].isTotal) return '#6366f1';
                        return data[idx].value >= 0 ? '#22c55e' : '#ef4444';
                    }
                }
            }
        ]
    };

    myChart.setOption(option);
    window.addEventListener('resize', () => myChart.resize());
}

async function loadMemberCosts(projectId) {
    const container = document.getElementById('memberCostTable');
    if (!container) return;

    try {
        const data = await api.get(`/projects/${projectId}/financial-costs`);
        if (!data || data.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding:20px; color:#94a3b8;">暂无人力成本数据</div>';
            return;
        }

        let html = '<table class="table table-sm"><thead><tr><th>成员</th><th>累计成本</th></tr></thead><tbody>';
        data.forEach(m => {
            html += `<tr><td>${m.name}</td><td>¥${m.cost.toLocaleString()}</td></tr>`;
        });
        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = '加载失败';
    }
}

function showRevenueModal(projectId) {
    const pIdEl = document.getElementById('revenueProjectId');
    if (pIdEl) pIdEl.value = projectId;

    document.getElementById('revenueAmount').value = '';
    document.getElementById('revenueDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('revenueDescription').value = '';
    openModal('revenueModal');
}

async function submitRevenue(event) {
    event.preventDefault();
    const projectId = document.getElementById('revenueProjectId').value;
    const amount = document.getElementById('revenueAmount').value;
    const revenueDate = document.getElementById('revenueDate').value;
    const revenueType = document.getElementById('revenueType').value;
    const description = document.getElementById('revenueDescription').value;

    try {
        const res = await api.post(`/projects/${projectId}/revenue`, {
            amount: parseFloat(amount),
            revenue_date: revenueDate,
            revenue_type: revenueType,
            description: description
        });

        if (res.success) {
            showToast('收入录入成功', 'success');
            closeModal('revenueModal');
            if (typeof loadProjectFinancials === 'function') {
                loadProjectFinancials(projectId); // 刷新财务看板
            }
        } else {
            showToast('录入失败: ' + res.message, 'danger');
        }
    } catch (e) {
        console.error(e);
        showToast('系统错误', 'danger');
    }
}

function enableTabDragging() {
    const tabs = document.querySelector('.tabs');
    if (!tabs) return;

    let isDown = false;
    let startX;
    let scrollLeft;

    tabs.addEventListener('mousedown', (e) => {
        isDown = true;
        startX = e.pageX - tabs.offsetLeft;
        scrollLeft = tabs.scrollLeft;
        tabs.style.cursor = 'grabbing';
    });
    tabs.addEventListener('mouseleave', () => {
        isDown = false;
        tabs.style.cursor = 'grab';
    });
    tabs.addEventListener('mouseup', () => {
        isDown = false;
        tabs.style.cursor = 'grab';
    });
    tabs.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - tabs.offsetLeft;
        const walk = (x - startX) * 2;
        tabs.scrollLeft = scrollLeft - walk;
    });

    // Set initial cursor
    tabs.style.cursor = 'grab';
}
async function openPmoDashboard() {
    openModal('pmoModal');
    loadPmoOverview();
    loadPmoSummary();
}

async function loadPmoOverview() {
    const pmContainer = document.getElementById('pmoPmWorkload');
    const actionContainer = document.getElementById('pmoPortfolioActions');
    if (!pmContainer) return;

    pmContainer.innerHTML = '<div class="loading-spinner"></div>';
    if (actionContainer) actionContainer.innerHTML = '';

    try {
        const data = await api.get('/pmo/overview');

        // 1. Render Portfolio Actions
        if (actionContainer && data.portfolio_actions && data.portfolio_actions.length > 0) {
            actionContainer.innerHTML = `
                <div class="panel" style="border: none; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); border-radius: 20px; background: #fff1f2; border: 1px solid #fee2e2;">
                    <div class="panel-header" style="background: transparent; border-bottom: 1px solid #fee2e2; padding: 16px 24px;">
                        <div class="panel-title" style="font-size: 15px; font-weight: 700; color: #b91c1c;">⚡ PMO 风险干预指令 (Action Center)</div>
                    </div>
                    <div class="panel-body" style="padding: 15px 24px;">
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px;">
                            ${data.portfolio_actions.map(action => `
                                <div style="background: white; padding: 16px; border-radius: 12px; border-left: 4px solid ${action.priority === 'High' ? '#ef4444' : '#f59e0b'}; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                                    <div style="font-weight: 700; color: #1e293b; font-size: 14px; margin-bottom: 4px;">
                                        <span style="font-size: 10px; background: ${action.priority === 'High' ? '#fee2e2' : '#fef3c7'}; color: ${action.priority === 'High' ? '#b91c1c' : '#92400e'}; padding: 2px 6px; border-radius: 4px; margin-right: 6px;">${action.priority}</span>
                                        ${action.title}
                                    </div>
                                    <div style="font-size: 13px; color: #4b5563; margin-bottom: 8px;">${action.description}</div>
                                    <div style="font-size: 12px; color: #b91c1c; font-weight: 600; background: #fff1f2; padding: 6px 10px; border-radius: 6px;">💡 建议：${action.suggestion}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            `;
        } else if (actionContainer) {
            actionContainer.style.display = 'none';
        }

        // 2. Render PM Workload List (Rest of existing logic...)
        let pmHtml = '<div style="padding: 12px 0;">';
        if (data.pm_workload && Array.isArray(data.pm_workload)) {
            data.pm_workload.forEach(pm => {
                const progress = Math.round(pm.avg_progress || 0);
                pmHtml += `
                    <div style="padding: 16px 24px; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div style="font-weight: 700; color: #1e293b; font-size: 14px;">${pm.project_manager || '未分配'}</div>
                            <div style="font-size: 12px; color: #64748b; margin-top: 4px;">在研项目: ${pm.count}</div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-weight: 700; color: #3b82f6; font-size: 14px;">${progress}%</div>
                            <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">平均进度</div>
                        </div>
                    </div>
                `;
            });
        } else {
            pmHtml += `<div style="padding:20px; text-align:center; color:#ef4444;">Could not load PM data: ${data.error || 'Unknown error'}</div>`;
        }
        pmHtml += '</div>';
        pmContainer.innerHTML = pmHtml;

        // Render Regional Heatmap
        renderPmoRegionalChart(data.regional);
    } catch (e) {
        pmContainer.innerHTML = '加载失败: ' + e.message;
    }
}

async function loadPmoSummary() {
    const container = document.getElementById('pmoAiSummary');
    if (!container) return;

    container.innerHTML = '<div class="loading-spinner"></div><p style="text-align:center; color:#64748b; font-size:13px; margin-top:10px;">AI 正在串联全线项目数据，请稍候...</p>';

    try {
        const data = await api.get('/pmo/summary');
        let summary = data.summary || '暂无摘要';
        summary = summary.replace(/\*/g, ''); // 全局移除星号
        container.innerHTML = `
            <div class="report-container" style="box-shadow: none; border: none; padding: 24px; font-size: 14px;">
                ${renderAiMarkdown(summary)}
            </div>
        `;
    } catch (e) {
        container.innerHTML = '摘要生成失败';
    }
}

function renderPmoRegionalChart(data) {
    const chartDom = document.getElementById('pmoRegionalChart');
    if (!chartDom) return;
    const myChart = echarts.init(chartDom);

    const option = {
        tooltip: {
            trigger: 'item',
            formatter: function (info) {
                const value = info.value;
                const name = info.name;
                const progress = info.data.d;
                return `<div style="padding:12px;border-radius:8px;background:rgba(255,255,255,0.95);box-shadow:0 4px 15px rgba(0,0,0,0.1);backdrop-filter:blur(10px);">
                            <div style="font-weight:600;color:#1e293b;font-size:14px;margin-bottom:8px;">${name}</div>
                            <div style="display:flex;align-items:center;margin-bottom:4px;">
                                <span style="background:#e0f2fe;color:#0ea5e9;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600;">${value} 个项目</span>
                            </div>
                            <div style="color:#64748b;font-size:12px;">平均进度: <strong style="color:#10b981;">${progress}%</strong></div>
                        </div>`;
            },
            backgroundColor: 'transparent',
            borderColor: 'transparent',
            padding: 0
        },
        visualMap: {
            show: false, // 隐藏图例，让 Treemap 自身颜色更美观
            min: 0,
            max: Math.max(...data.map(d => d.count), 1),
            inRange: { color: ['#93c5fd', '#3b82f6', '#1d4ed8'] }
        },
        series: [{
            name: '区域分布',
            type: 'treemap',
            roam: false,
            nodeClick: false,
            breadcrumb: { show: false },
            itemStyle: {
                borderColor: '#ffffff',
                borderWidth: 2,
                gapWidth: 2,
                borderRadius: [8, 8, 8, 8]
            },
            label: {
                show: true,
                formatter: '{b}\n\n{c}个项目',
                fontSize: 14,
                fontFamily: 'Inter, system-ui, sans-serif',
                fontWeight: 600
            },
            data: data.map(d => ({
                name: d.region || '未指定',
                value: d.count,
                d: Math.round(d.avg_progress)
            }))
        }]
    };

    myChart.setOption(option);
    window.addEventListener('resize', () => myChart.resize());
}

// ========== 业务运行报表 (Monthly/Quarterly) ==========
async function showBusinessReportModal(projectId) {
    const modal = document.getElementById('businessReportModal');
    if (!modal) return;

    window.currentReportProjectId = projectId;

    // 初始化年份
    const yearSelect = document.getElementById('reportYear');
    if (yearSelect && yearSelect.options.length === 0) {
        const currentYear = new Date().getFullYear();
        for (let y = currentYear; y >= currentYear - 3; y--) {
            yearSelect.add(new Option(y, y));
        }
    }

    // 初始化周度
    const weekSelect = document.getElementById('reportWeek');
    if (weekSelect && weekSelect.options.length <= 1) {
        for (let w = 1; w <= 53; w++) {
            weekSelect.add(new Option(`第${w}周`, w));
        }
    }

    const qInput = document.getElementById('reportQuarter');
    if (qInput) qInput.value = '';
    const mInput = document.getElementById('reportMonth');
    if (mInput) mInput.value = '';
    if (weekSelect) weekSelect.value = '';

    modal.classList.add('show');
    refreshReportPreview();
}

async function refreshReportPreview() {
    const projectId = window.currentReportProjectId;
    const year = document.getElementById('reportYear').value;
    const month = document.getElementById('reportMonth').value;
    const quarter = document.getElementById('reportQuarter').value;
    const week = document.getElementById('reportWeek').value;

    const paper = document.getElementById('reportPaper');
    const aiBox = document.getElementById('aiBusinessSummary');
    const msBox = document.getElementById('periodMilestones');
    const taskBox = document.getElementById('periodTasks');
    const finBox = document.getElementById('periodFinancials');

    aiBox.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>AI 正在深度分析运行数据...</p></div>';
    msBox.innerHTML = '';
    taskBox.innerHTML = '';
    finBox.innerHTML = '';
    document.getElementById('reportPrintDate').textContent = new Date().toLocaleString();

    try {
        let url = `/reports/preview?project_id=${projectId}&year=${year}`;
        if (month) url += `&month=${month}`;
        else if (quarter) url += `&quarter=${quarter}`;
        else if (week) url += `&week=${week}`;

        const res = await api.get(url);
        if (res) {
            document.getElementById('paperProjectName').textContent = res.project.project_name;
            let periodStr = "";
            if (month) periodStr = `${year}年${month}月`;
            else if (quarter) periodStr = `${year}年第${quarter}季度`;
            else if (week) periodStr = `${year}年第${week}周`;

            document.getElementById('paperReportPeriod').textContent = `${periodStr} 运行报表`;

            // AI 摘要
            aiBox.innerHTML = renderAiMarkdown(res.ai_summary || "暂无分析摘要");

            // 里程碑
            if (res.milestones && res.milestones.length > 0) {
                msBox.innerHTML = res.milestones.map(m => `
                    <div style="display:flex; justify-content:space-between; margin-bottom:8px; background:#f0fdf4; padding:8px 12px; border-radius:6px; border-left:4px solid #10b981;">
                        <span style="font-weight:600;">🚩 ${m.name}</span>
                        <span style="color:#059669;">达成日期: ${m.updated_at ? m.updated_at.split(' ')[0] : '-'}</span>
                    </div>
                `).join('');
            } else {
                msBox.innerHTML = '<p style="color:#94a3b8; font-style:italic;">本期无已完成里程碑</p>';
            }

            // 任务
            if (res.tasks && res.tasks.length > 0) {
                taskBox.innerHTML = `<p>本期共完成 <b>${res.tasks.length}</b> 项关键任务，主要包括：${res.tasks.slice(0, 5).map(t => t.task_name).join('、')}${res.tasks.length > 5 ? '等' : ''}。</p>`;
            }

            // 财务
            if (res.financials) {
                const fin = res.financials;
                finBox.innerHTML = `
                    <div style="text-align:center;">
                        <div style="font-size:12px; color:#64748b;">合同收入</div>
                        <div style="font-size:18px; font-weight:700; color:#1e293b;">￥${(fin.contract_amount / 10000).toFixed(2)}w</div>
                    </div>
                    <div style="text-align:center;">
                        <div style="font-size:12px; color:#64748b;">已收回款</div>
                        <div style="font-size:18px; font-weight:700; color:#10b981;">￥${(fin.collected_amount / 10000).toFixed(2)}w</div>
                    </div>
                    <div style="text-align:center;">
                        <div style="font-size:12px; color:#64748b;">预估利润率</div>
                        <div style="font-size:18px; font-weight:700; color:#3b82f6;">${fin.net_profit_margin}%</div>
                    </div>
                `;
            } else {
                finBox.innerHTML = '<p style="grid-column: span 3; color:#94a3b8; text-align:center;">暂无财务快照数据</p>';
            }
        }
    } catch (e) {
        console.error('Report preview failed', e);
        aiBox.innerHTML = '<p style="color:#ef4444;">预览加载失败，请重试</p>';
    }
}

function exportReportToPdf() {
    const originalElement = document.getElementById('reportPaper');
    const projectName = document.getElementById('paperProjectName').textContent;
    const period = document.getElementById('paperReportPeriod').textContent;

    // Clone element to body to avoid modal scroll clipping blank PDF issue
    const clone = originalElement.cloneNode(true);
    clone.style.position = 'absolute';
    clone.style.top = '0';
    clone.style.left = '0';
    clone.style.zIndex = '-9999';
    clone.style.opacity = '1';  // html2canvas needs opacity 1 sometimes, just hide via z-index
    clone.style.width = '800px';
    clone.style.background = 'white';
    document.body.appendChild(clone);

    const btn = event.currentTarget || document.querySelector(`button[onclick="exportReportToPdf()"]`);
    const originalText = btn ? btn.innerHTML : '导出PDF';
    if (btn) { btn.innerHTML = '⌛ 生成中...'; btn.disabled = true; }

    const opt = {
        margin: [10, 10, 10, 10],
        filename: `${projectName}_${period}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, letterRendering: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    html2pdf().set(opt).from(clone).save().then(() => {
        document.body.removeChild(clone);
        if (btn) { btn.innerHTML = originalText; btn.disabled = false; }
    }).catch(err => {
        document.body.removeChild(clone);
        if (btn) { btn.innerHTML = originalText; btn.disabled = false; }
        showToast("导出失败: " + err.message, 'danger');
    });
}

// ========== 风险链推演 (Simulate Delay Impact) ==========
function showRiskSimulationModal(taskId, taskName, event) {
    if (event) event.stopPropagation();
    const modal = document.getElementById('riskSimulationModal');
    if (!modal) return;

    window.currentSimTaskId = taskId;
    document.getElementById('simTaskName').textContent = taskName;
    document.getElementById('simDelayDays').value = 3;
    document.getElementById('simulationResult').style.display = 'none';

    modal.classList.add('show');
}

async function runRiskSimulation() {
    const taskId = window.currentSimTaskId;
    const delay = document.getElementById('simDelayDays').value;
    const resultBox = document.getElementById('simulationResult');
    const list = document.getElementById('impactedTasksList');
    const narration = document.getElementById('simulationNarration');

    resultBox.style.display = 'block';
    list.innerHTML = '<div style="padding:20px; text-align:center; color:#94a3b8;">正在计算传播路径...</div>';
    narration.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>AI 正在分析蝴蝶效应...</p></div>';

    try {
        const res = await api.get(`/risk/simulate?project_id=${currentProjectId}&task_id=${taskId}&delay_days=${delay}`);
        if (res) {
            // 渲染影响列表
            if (res.impacted_tasks && res.impacted_tasks.length > 0) {
                list.innerHTML = res.impacted_tasks.map(t => `
                    <div style="padding:10px 14px; border-bottom:1px solid #f1f5f9; display:flex; flex-direction:column; gap:4px;">
                        <div style="font-weight:500; font-size:13px; color:#334155;">${t.task_name}</div>
                        <div style="font-size:11px; color:#94a3b8;">${t.stage_name} · 计划: ${t.plan_end_date}</div>
                        <div style="color:#ef4444; font-size:11px; font-weight:600;">⚠️ 预计顺延 ${res.delay_days} 天</div>
                    </div>
                `).join('');
                if (res.impacted_count > 10) {
                    list.innerHTML += `<div style="padding:8px; text-align:center; color:#64748b; font-size:11px; background:#f8fafc;">...及其他 ${res.impacted_count - 10} 个关联任务</div>`;
                }
            } else {
                list.innerHTML = '<div style="padding:20px; text-align:center; color:#10b981;">✅ 暂未发现下游强依赖受波及</div>';
            }

            // 渲染 AI 叙述
            narration.innerHTML = renderAiMarkdown(res.narration || "分析完成");
        }
    } catch (e) {
        console.error('Simulation failed', e);
        list.innerHTML = '<div style="padding:20px; color:#ef4444;">计算失败</div>';
    }
}

// ========== SLA 死亡倒计时 ==========
async function loadProjectSlaCountdown(projectId) {
    try {
        const res = await api.get(`/risk/countdown/${projectId}`);
        if (res) {
            updateSlaCountdown(res);
        }
    } catch (e) {
        console.error('Prediction failed', e);
    }
}

function updateSlaCountdown(data) {
    const parent = document.querySelector('.risk-info-panel');
    if (!parent) return;

    // 移除旧的倒计时（如果有）
    const old = document.getElementById('slaCountdownWidget');
    if (old) old.remove();

    const widget = document.createElement('div');
    widget.id = 'slaCountdownWidget';
    widget.style.cssText = `
        margin-left:8px; display:inline-flex; align-items:center; gap:8px; 
        padding-left:12px; border-left:1px solid #cbd5e1;
    `;

    let statusHtml = '';
    if (data.is_delay_predicted) {
        statusHtml = `
            <div style="display:flex; flex-direction:column; align-items:flex-end;">
                <span style="color:#ef4444; font-weight:800; font-size:13px;">🚨 逻辑违约风险 (${data.delay_days}天)</span>
                <span style="color:#94a3b8; font-size:10px;">预测完工位: ${data.predicted_end_date}</span>
            </div>
        `;
    } else {
        const daysLabel = data.remaining_days_to_plan > 0 ? `剩 ${data.remaining_days_to_plan} 天` : '今日交付';
        const color = data.remaining_days_to_plan < 7 ? '#f97316' : '#64748b';
        statusHtml = `
            <div style="display:flex; flex-direction:column; align-items:flex-end;">
                <span style="color:${color}; font-weight:700; font-size:13px;">⌛ SLA 倒计时: ${daysLabel}</span>
                <span style="color:#94a3b8; font-size:10px;">交付安全垫: ${Math.abs(data.remaining_days_to_plan)} 天</span>
            </div>
        `;
    }

    widget.innerHTML = statusHtml;
    parent.appendChild(widget);
}

// ========== Phase 7: AI Collaboration & Onboarding ==========

// 1. 项目快照 (新人手册)
async function showProjectSnapshot(projectId) {
    const modal = document.getElementById('projectSnapshotModal');
    const content = document.getElementById('snapshotContent');
    modal.classList.add('show');
    content.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>AI 正在扫描项目全貌，请稍候...</p></div>';

    try {
        const res = await api.get(`/collab/snapshot/${projectId}`);
        if (res) {
            content.innerHTML = renderAiMarkdown(res || "生成失败");
        }
    } catch (e) {
        content.innerHTML = "加载失败";
    }
}

// 2. 会议助理
function showMeetingAssistant() {
    closeModal('memberModal');
    document.getElementById('meetingAssistantModal').classList.add('show');
    document.getElementById('meetingTranscript').value = '';
    document.getElementById('meetingResult').style.display = 'none';
}

async function extractMeetingActions() {
    const transcript = document.getElementById('meetingTranscript').value;
    if (!transcript) { showToast('请输入会议内容', 'warning'); return; }

    const resultBox = document.getElementById('meetingResult');
    resultBox.style.display = 'block';
    resultBox.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>正在提炼任务清单...</p></div>';

    try {
        const res = await api.post('/collab/meeting-actions', { transcript });
        if (res) {
            resultBox.innerHTML = renderAiMarkdown(res || "分析结果为空");
        }
    } catch (e) {
        resultBox.innerHTML = "提取失败";
    }
}

// 3. 批量补录 (Chat/Git 导入)
function showMultiLogImportModal() {
    document.getElementById('multiLogImportModal').classList.add('show');
    document.getElementById('multiLogSource').value = '';
    document.getElementById('multiLogPreview').style.display = 'none';
}

async function parseMultiLogs() {
    const rawText = document.getElementById('multiLogSource').value;
    if (!rawText) { showToast('请输入文本内容', 'warning'); return; }

    const preview = document.getElementById('multiLogPreview');
    const list = document.getElementById('multiLogItems');
    preview.style.display = 'block';
    list.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>正在拆解日志...</p></div>';

    try {
        const res = await api.post('/collab/parse-multi-logs', { raw_text: rawText });
        if (Array.isArray(res)) {
            window.extractedLogs = res;
            list.innerHTML = res.map((l, i) => `
                <div style="background:#f8fafc; padding:12px; border-radius:8px; border:1px solid #e2e8f0;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                        <span style="font-weight:600; color:var(--primary);">${l.member_name}</span>
                        <span style="font-size:12px; color:#64748b;">${l.log_date} (${l.work_hours}h)</span>
                    </div>
                    <div style="font-size:13px; color:#334155;">${l.work_content}</div>
                    ${l.issues ? `<div style="font-size:11px; color:#ef4444; margin-top:4px;">⚠️ ${l.issues}</div>` : ''}
                </div>
            `).join('');
            list.innerHTML += `<button class="btn btn-primary" style="width:100%; margin-top:12px;" onclick="confirmMultiLogImport()">确认全部导入</button>`;
        } else {
            list.innerHTML = "未能识别出有效的日志条目。";
        }
    } catch (e) {
        list.innerHTML = "解析失败";
    }
}

async function confirmMultiLogImport() {
    if (!window.extractedLogs || !window.extractedLogs.length) return;

    const btn = event.target;
    btn.disabled = true;
    btn.textContent = '导入中...';

    try {
        // 循环导入
        for (const log of window.extractedLogs) {
            await api.post('/work-logs', {
                project_id: currentProjectId,
                member_name: log.member_name,
                log_date: log.log_date,
                work_content: log.work_content,
                work_hours: log.work_hours,
                issues: log.issues,
                plan: log.plan
            });
        }
        showToast(`成功导入 ${window.extractedLogs.length} 条日志`, 'success');
        closeModal('multiLogImportModal');
        loadWorkLogs(currentProjectId);
    } catch (e) {
        showToast('导入过程中出错: ' + e.message, 'danger');
        btn.disabled = false;
        btn.textContent = '确认全部导入';
    }
}
// ========== Phase 8: Operational Data Strategy ==========

// 1. 基准工期库 (Baselines)
async function loadStageBaselines() {
    try {
        const res = await api.get('/operational/stage-baselines');
        if (res) {
            window.stageBaselines = res;
            const hint = document.getElementById('baselineHint');
            if (hint) hint.textContent = `(已加载 ${res.length} 个阶段基准)`;
        }
    } catch (e) {
        console.error('Load baselines failed', e);
    }
}

// 2. 需求变更影响分析 (Demand Impact Analysis)
function showDemandAnalysisModal() {
    let modal = document.getElementById('demandAnalysisModal');
    if (!modal) {
        const html = `
            <div id="demandAnalysisModal" class="modal">
                <div class="modal-content modal-lg">
                    <div class="modal-header">
                        <h3>🧬 AI 需求变更影响评估 (Impact Analysis)</h3>
                        <button class="modal-close" onclick="closeModal('demandAnalysisModal')">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div style="margin-bottom:16px;">
                            <label style="display:block; margin-bottom:8px; font-weight:600;">变更内容描述</label>
                            <textarea id="changeDescription" placeholder="例：甲方要求增加移动端查询功能，包含3个核心页面..." 
                                style="width:100%; height:120px; padding:12px; border:1px solid #cbd5e1; border-radius:8px;"></textarea>
                        </div>
                        <button class="btn btn-ai" style="width:100%; border:none;" onclick="runDemandAnalysis()">🚀 开始 AI 多维评估</button>
                        
                        <div id="demandAnalysisResult" style="display:none; margin-top:20px;">
                            <div class="demand-analysis-box" id="demandAnalysisContent">
                                <!-- 结果 -->
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);
        modal = document.getElementById('demandAnalysisModal');
    }
    openModal('demandAnalysisModal');
    document.getElementById('changeDescription').value = '';
    document.getElementById('demandAnalysisResult').style.display = 'none';
}

async function runDemandAnalysis() {
    const desc = document.getElementById('changeDescription').value;
    if (!desc) { showToast('请输入变更描述', 'warning'); return; }

    const resultBox = document.getElementById('demandAnalysisResult');
    const content = document.getElementById('demandAnalysisContent');
    resultBox.style.display = 'block';
    content.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>AI 正在计算蝴蝶效应与资源成本...</p></div>';

    try {
        const res = await api.post('/operational/analyze-change', {
            project_id: currentProjectId,
            description: desc
        });

        // res might be the string directly or enclosed in an object
        const contentStr = typeof res === 'string' ? res : (res.analysis || res.content || JSON.stringify(res));

        if (res) {
            content.innerHTML = renderAiMarkdown(contentStr || "分析失败");
        }
    } catch (e) {
        content.innerHTML = "评估出错: " + e.message;
    }
}

// ========== UI Interaction Logic ==========
window.toggleActionDropdown = function (event) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById('projectActionDropdown');

    // Close other dropdowns
    document.querySelectorAll('.dropdown-menu.show').forEach(m => {
        if (m !== dropdown) {
            m.classList.remove('show');
        }
    });

    if (dropdown) {
        dropdown.classList.toggle('show');
    }
};

// Global click listener for 'More' dropdown auto-close
document.addEventListener('click', function (e) {
    const openWrappers = document.querySelectorAll('.more-wrapper.open');
    if (openWrappers.length > 0) {
        openWrappers.forEach(w => w.classList.remove('open'));
    }
});

// 页面加载时检查 URL 中是否有 token（扫码登录回调回来）
(function checkWecomLoginCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    if (token) {
        // 保存 token，和你现有的登录成功逻辑一致
        localStorage.setItem('token', token);
        // 清除 URL 参数
        window.history.replaceState({}, document.title, '/');
        // 触发已登录状态
        if (typeof onLoginSuccess === 'function') {
            onLoginSuccess(token);
        } else {
            location.reload();
        }
    }

    const loginError = urlParams.get('login_error');
    if (loginError) {
        showToast('企业微信登录失败: ' + loginError, 'danger', 5000);
        window.history.replaceState({}, document.title, '/');
    }
})();
