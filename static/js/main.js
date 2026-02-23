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

async function showWarningCenter() {
    openModal('warningModal');
    await loadWarnings();
}

async function loadWarnings() {
    const container = document.getElementById('warningList');
    if (!container) return;

    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--gray-500);">加载中...</div>';

    try {
        const data = await api.get('/warnings');
        renderWarnings(data);
    } catch (e) {
        container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--danger);">加载失败: ${e.message}</div>`;
    }
}

function renderWarnings(data) {
    const container = document.getElementById('warningList');
    if (!container) return;

    const { summary, warnings } = data;

    if (warnings.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--success);font-size:16px;">✅ 暂无预警，所有项目运行正常</div>';
        return;
    }

    let html = `
        <div class="warning-summary" style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
            <div style="flex:1;min-width:80px;padding:12px;background:var(--gray-50);border-radius:8px;text-align:center;">
                <div style="font-size:24px;font-weight:700;">${summary.total}</div>
                <div style="font-size:11px;color:var(--gray-500);">总预警</div>
            </div>
            <div style="flex:1;min-width:80px;padding:12px;background:#fef2f2;border-radius:8px;text-align:center;">
                <div style="font-size:24px;font-weight:700;color:#ef4444;">🔴 ${summary.high}</div>
                <div style="font-size:11px;color:var(--gray-500);">高危</div>
            </div>
            <div style="flex:1;min-width:80px;padding:12px;background:#fffbeb;border-radius:8px;text-align:center;">
                <div style="font-size:24px;font-weight:700;color:#f59e0b;">🟡 ${summary.medium}</div>
                <div style="font-size:11px;color:var(--gray-500);">中危</div>
            </div>
        </div>
        <div class="warning-list">
    `;

    for (const w of warnings) {
        const severityColor = w.severity === 'high' ? '#ef4444' : w.severity === 'medium' ? '#f59e0b' : '#10b981';
        const severityIcon = w.severity === 'high' ? '🔴' : w.severity === 'medium' ? '🟡' : '🟢';
        const typeIcon = w.type.includes('milestone') ? '🎯' : w.type.includes('task') ? '📋' : '🔗';

        html += `
            <div class="warning-item" style="padding:12px;margin-bottom:8px;background:white;border-radius:8px;border-left:4px solid ${severityColor};cursor:pointer;" onclick="loadProjectDetail(${w.project_id});closeModal('warningModal');">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                    <span style="font-weight:600;font-size:13px;">${typeIcon} ${w.message}</span>
                    <span style="font-size:12px;">${severityIcon}</span>
                </div>
                <div style="font-size:12px;color:var(--gray-500);">${w.project_name}</div>
            </div>
        `;
    }

    html += '</div>';
    container.innerHTML = html;
}

// ========== 项目模板功能 ==========
async function saveAsTemplate(projectId) {
    const name = prompt('请输入模板名称:');
    if (!name) return;
    try {
        await api.post(`/projects/${projectId}/save-as-template`, { name });
        alert('✅ 模板保存成功！');
    } catch (e) {
        alert('保存失败: ' + e.message);
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
            contentEl.innerHTML = `<div style="padding:20px;"><h2 style="margin-bottom:16px;">📊 AI项目复盘报告</h2><div class="markdown-content">${marked.parse(res.report)}</div></div>`;
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
            contentEl.innerHTML = `<div style="padding:20px;"><h2 style="margin-bottom:16px;">🎯 AI任务分配建议 (文本模式)</h2><div style="white-space: pre-wrap; line-height: 1.6; color: #374151;">${marked.parse(res.raw_response)}</div></div>`;
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
                alert('✅ 分享已开启！\n\n分享链接: ' + url + '\n\n您可以将此链接发送给甲方查看项目进度。');
            } else {
                alert('🔒 已关闭公开分享。');
            }

        }
    } catch (e) {
        alert('操作失败: ' + e.message);
    }
}

function copyShareLink(token) {
    const url = `${window.location.origin}/share/${token}`;

    // 优先使用 navigator.clipboard
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(url).then(() => {
            alert('链接已复制到剪贴板！\n' + url);
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
            alert('链接已复制到剪贴板！(兼容模式)\n' + text);
        } else {
            alert('复制失败，请手动复制: ' + text);
        }
    } catch (err) {
        alert('无法复制，请手动选择复制: ' + text);
    }
    document.body.removeChild(textArea);
}


// ========== 项目模板功能 ==========
async function saveAsTemplate(projectId) {
    const name = prompt('请输入模板名称:');
    if (!name) return;

    try {
        const res = await api.post(`/projects/${projectId}/save-as-template`, { name });
        alert('✅ 模板保存成功！');
    } catch (e) {
        alert('保存失败: ' + e.message);
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
        alert('✅ 沟通记录已添加');
    } catch (e) {
        alert('添加失败: ' + e.message);
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
    if (!currentProjectId) { alert('请先选择一个项目'); return; }

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
    if (!currentProjectId) { alert('请先选择一个项目'); return; }

    const file = input.files[0];
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
        alert('文件过大，请上传小于 10MB 的文件');
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
        htmlContent = marked.parse(markdown || '');
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

async function loadProjectDetail(projectId, preserveTab = false) {
    const previousTab = currentActiveTab;
    currentProjectId = projectId;
    renderProjectList();

    hideAllViews();
    document.getElementById('projectDetailView').style.display = 'block';

    currentProject = await api.get(`/projects/${projectId}`);
    renderProjectDetail(currentProject);

    if (currentProject.stages && currentProject.stages.length > 0) {
        // 找到第一个未完成的阶段，或者当前活跃的阶段
        const activeStage = currentProject.stages.find(s => s.status === '进行中') || currentProject.stages.find(s => s.status === '待开始');
        if (activeStage && typeof loadContextualRecommendations === 'function') {
            loadContextualRecommendations(activeStage.stage_name);
        }
    }

    // AI 特性加载
    refreshAiDecisionCenter(projectId);
    loadProjectPrediction(projectId);
    loadProjectSlaCountdown(projectId);
    loadSimilarProjects(projectId);

    // 检查里程碑庆祝
    checkMilestoneCelebrations(projectId);

    // 加载基准工期库
    loadStageBaselines();


    if (preserveTab && previousTab !== 'gantt') {
        setTimeout(() => {
            const tabMap = {
                'gantt': 0, 'pulse': 1, 'stages': 2, 'milestones': 3, 'team': 4,
                'interfaces': 5, 'flow': 6, 'devices': 7, 'issues': 8, 'communications': 9,
                'departures': 10, 'worklogs': 11, 'documents': 12, 'expenses': 13, 'changes': 14,
                'acceptance': 15, 'satisfaction': 16, 'dependencies': 17, 'standup': 18, 'deviation': 19,
                'interfaceSpec': 20, 'financials': 21
            };
            const tabs = document.querySelectorAll('.tabs .tab');
            const tabIndex = tabMap[previousTab];
            if (tabIndex !== undefined && tabs[tabIndex]) {
                tabs[tabIndex].click();
            }
        }, 50);
    }
}

function renderProjectDetail(project) {
    const container = document.getElementById('projectDetailView');
    const bedInfo = [];
    if (project.icu_beds) bedInfo.push(`ICU ${project.icu_beds}床`);
    if (project.operating_rooms) bedInfo.push(`手术间 ${project.operating_rooms}间`);
    if (project.pacu_beds) bedInfo.push(`复苏室 ${project.pacu_beds}床`);

    const pendingIssues = project.issues ? project.issues.filter(i => i.status !== '已解决').length : 0;
    const completedInterfaces = project.interfaces ? project.interfaces.filter(i => i.status === '已完成').length : 0;
    const totalInterfaces = project.interfaces ? project.interfaces.length : 0;
    const onSiteMembers = project.members ? project.members.filter(m => m.is_onsite && m.status === '在岗').length : 0;

    container.innerHTML = `
                <div class="detail-header">
                    <div>
                        <div style="display:flex; align-items:center; gap:12px; margin-bottom:4px;">
                            <h1 class="detail-title">${project.project_name}</h1>
                            ${project.risk_score !== undefined ? `
                                <div class="risk-info-panel-premium" onclick="refreshProjectRisk(${project.id})" style="cursor:pointer;">
                                    <div class="risk-badge" style="background:${getRiskColor(project.risk_score)};">
                                        <span class="risk-score-value">${project.risk_score}</span>
                                        <span class="risk-score-label">RISK</span>
                                    </div>
                                    <div class="risk-analysis-preview">
                                        <div class="risk-level-tag" style="color:${getRiskColor(project.risk_score)};">
                                            ${project.risk_score < 30 ? '🟢 低风险' : project.risk_score < 60 ? '🟡 中等风险' : '🔴 高风险'}
                                        </div>
                                        <div class="risk-text-summary">
                                            ${(() => {
                if (!project.risk_analysis) return '暂无风险分析，点击刷新评估';
                try {
                    const analysis = typeof project.risk_analysis === 'string' ? JSON.parse(project.risk_analysis) : project.risk_analysis;
                    if (Array.isArray(analysis)) {
                        return analysis.map(r => r.content || r.keyword).join('；');
                    }
                    return project.risk_analysis;
                } catch (e) {
                    return project.risk_analysis;
                }
            })()}
                                        </div>
                                    </div>
                                    <div class="risk-action-hint">🔄</div>
                                </div>
                            ` : ''}
                        </div>
                        <div class="detail-meta">
                            <span class="meta-item">🏥 ${project.hospital_name}</span>
                            <span class="meta-item">👤 ${project.project_manager || '未指定'}</span>
                            <span class="meta-item">📅 ${project.plan_start_date || '?'} ~ ${project.plan_end_date || '?'}</span>
                            ${bedInfo.length ? `<span class="meta-item">🛏️ ${bedInfo.join(' / ')}</span>` : ''}
                            <span class="meta-item project-status project-detail-status status-${project.status}" style="cursor:pointer;" onclick="showStatusModal()">${project.status}</span>
                        </div>
                    </div>
                </div>

                <style>
                    .risk-info-panel-premium {
                        display: inline-flex;
                        align-items: center;
                        gap: 12px;
                        background: rgba(255, 255, 255, 0.8);
                        backdrop-filter: blur(10px);
                        border: 1px solid rgba(0, 0, 0, 0.05);
                        padding: 6px 16px 6px 8px;
                        border-radius: 40px;
                        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
                        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                        max-width: 500px;
                    }
                    .risk-info-panel-premium:hover {
                        transform: translateY(-2px);
                        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.08);
                        border-color: rgba(0, 0, 0, 0.1);
                    }
                    .risk-badge {
                        width: 44px;
                        height: 44px;
                        border-radius: 50%;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        color: white;
                        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.15);
                    }
                    .risk-score-value {
                        font-size: 16px;
                        font-weight: 800;
                        line-height: 1;
                    }
                    .risk-score-label {
                        font-size: 8px;
                        font-weight: 700;
                        opacity: 0.9;
                        letter-spacing: 0.5px;
                    }
                    .risk-analysis-preview {
                        flex: 1;
                        min-width: 0;
                    }
                    .risk-level-tag {
                        font-size: 11px;
                        font-weight: 700;
                        margin-bottom: 2px;
                    }
                    .risk-text-summary {
                        font-size: 12px;
                        color: #64748b;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }
                    .risk-action-hint {
                        font-size: 14px;
                        opacity: 0.3;
                        transition: opacity 0.2s;
                    }
                    .risk-info-panel-premium:hover .risk-action-hint {
                        opacity: 0.8;
                        animation: spin 2s linear infinite;
                    }
                    @keyframes spin {
                        from { transform: rotate(0deg); }
                        to { transform: rotate(360deg); }
                    }

                    .action-area {
                        display: flex;
                        flex-direction: column;
                        align-items: flex-start;
                        gap: 8px;
                        padding: 12px 0; /* Removing horizontal padding to align with header if needed, or keep 16px */
                        width: 100%;
                    }
                    
                    /* ===== 第一行：主按钮 ===== */
                    .primary-buttons {
                        display: flex;
                        gap: 12px;
                    }
                    .primary-buttons button {
                        background-color: #6B4EE6;
                        color: #FFFFFF;
                        height: 36px;
                        padding: 0 16px;
                        border-radius: 8px;
                        border: none;
                        font-size: 14px;
                        font-weight: 500;
                        cursor: pointer;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                    }
                    .primary-buttons button:hover {
                        background-color: #5A3ED5;
                    }

                    /* ===== 第二行：次级按钮 + 更多 ===== */
                    .secondary-buttons {
                        display: flex;
                        align-items: center;
                        gap: 4px;
                        flex-wrap: wrap;
                    }
                    .secondary-buttons button {
                        background: transparent;
                        border: none;
                        color: #37352F;
                        font-size: 13px;
                        padding: 6px 10px;
                        border-radius: 6px;
                        cursor: pointer;
                        display: inline-flex;
                        align-items: center;
                    }
                    .secondary-buttons button:hover {
                        background: #F1F1F0;
                    }
                    .dot-separator {
                        color: #C0C0C0;
                        font-size: 13px;
                        user-select: none;
                        margin: 0 2px;
                    }

                    /* ===== 分隔线 ===== */
                    .action-divider {
                        width: 100%;
                        height: 1px;
                        background: #E8E8E8;
                        margin: 16px 0;
                    }

                    /* ===== 更多菜单 ===== */
                    .more-wrapper {
                        position: relative;
                        display: inline-block;
                        margin-left: 8px;
                    }
                    .more-dropdown {
                        display: none;
                        position: absolute;
                        top: 100%;
                        left: 0;
                        z-index: 999;
                        width: 220px;
                        background: #FFFFFF;
                        border: 1px solid #E8E8E8;
                        border-radius: 8px;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.08);
                        padding: 8px 0;
                    }
                    .more-wrapper.open .more-dropdown {
                        display: block;
                    }
                    .menu-group-title {
                        font-size: 12px;
                        color: #9B9A97;
                        padding: 8px 16px 4px 16px;
                        font-weight: 500;
                    }
                    .menu-divider {
                        height: 1px;
                        background: #E8E8E8;
                        margin: 4px 0;
                    }
                    .menu-item {
                        display: block;
                        width: 100%;
                        text-align: left;
                        background: transparent;
                        border: none;
                        font-size: 14px;
                        color: #37352F;
                        padding: 8px 16px;
                        cursor: pointer;
                    }
                    .menu-item:hover {
                        background: #F1F1F0;
                    }
                    .menu-item.danger {
                        color: #EB5757;
                    }
                    </style>

                    <!-- ===== HTML 结构 ===== -->
                    <div class="action-area">
                        <!-- 第一行：主按钮 -->
                        <div class="primary-buttons">
                            <button onclick="showAskAiModal()">🔮 Ask AI</button>
                            <button onclick="refreshProjectRisk(${project.id})">🚩 AI风险评估</button>
                        </div>

                        <!-- 第二行：次级按钮 -->
                        <div class="secondary-buttons">
                            <button onclick="callAiAnalysis(${project.id})">🔍 AI诊断轮廓</button>
                            <span class="dot-separator">·</span>
                            <button onclick="showRiskTrend(${project.id})">📊 风险趋势</button>
                            <span class="dot-separator">·</span>
                            <button onclick="generateDailyReport(${project.id})">📋 AI日报</button>
                            <span class="dot-separator">·</span>
                            <button onclick="showAiTaskSuggestions(${project.id})">🤖 AI任务分配</button>
                            
                            <!-- 更多按钮 -->
                            <div class="more-wrapper" onclick="this.classList.toggle('open'); event.stopPropagation();">
                                <button>··· 更多</button>
                                <div class="more-dropdown" onclick="event.stopPropagation()">
                                    <div class="menu-group-title">常用工具</div>
                                    <div class="menu-divider"></div>
                                    <button class="menu-item" onclick="showDemandAnalysisModal()">📋 变更影响评估</button>
                                    <button class="menu-item" onclick="showProjectSnapshot(${project.id})">👤 新人快照</button>
                                    <button class="menu-item" onclick="toggleShare(${project.id}, ${!project.share_enabled})">
                                        ${project.share_enabled ? '🔗 关闭分享' : '🔗 开启分享'}
                                    </button>
                                    ${project.share_enabled ? `
                                        <button class="menu-item" style="color:var(--primary); font-weight:600;" onclick="copyShareLink('${project.share_token}')">
                                            📋 复制分享链接
                                        </button>
                                    ` : ''}
                                    
                                    <div class="menu-group-title">移动端功能</div>
                                    <div class="menu-divider"></div>
                                    <button class="menu-item" onclick="window.open('/m/briefing/${project.id}', '_blank')">📱 移动端速查卡</button>
                                    <button class="menu-item" onclick="window.open('/m/acceptance/${project.id}', '_blank')">✅ 移动端验收</button>
                                    
                                    <div class="menu-group-title">数据导出</div>
                                    <div class="menu-divider"></div>
                                    <button class="menu-item" onclick="exportProjectReport(${project.id})">📄 导出为 Json</button>
                                    <button class="menu-item" onclick="exportProjectPDF(${project.id})">📄 导出为 PDF</button>
                                    <button class="menu-item" onclick="showBurndownChart(${project.id})">📈 燃尽图趋势</button>
                                    
                                    <div class="menu-group-title">项目管理</div>
                                    <div class="menu-divider"></div>
                                    ${['进行中', '试运行', '暂停'].includes(project.status) ? `<button class="menu-item" onclick="showDepartureModal()">🏗 申请离场</button>` : ''}
                                    <button class="menu-item" onclick="saveAsTemplate(${project.id})">📁 保存为模板</button>
                                    
                                    <div class="menu-divider"></div>
                                    <button class="menu-item danger" onclick="deleteProject(${project.id})">🔴 删除项目</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 分隔线 -->
                    <div class="action-divider"></div>
                    
                    <script>
                        // Auto-close menu when clicking outside (Injected via innerHTML, might not run, so we rely on global main.js listener below)
                        // Actually, scripts in innerHTML don't run. We need to add this to main.js global scope.
                    </script>

                <div class="overview-grid">
                    <div class="overview-card">
                        <div class="overview-card-title">总体进度</div>
                        <div class="overview-card-value progress-text">${project.progress !== undefined ? project.progress : 0}%</div>
                    </div>
                    <div class="overview-card">
                        <div class="overview-card-title">待解决问题</div>
                        <div class="overview-card-value" style="color:${pendingIssues > 0 ? 'var(--danger)' : 'var(--success)'}">${pendingIssues}</div>
                    </div>


                    <div class="overview-card">
                        <div class="overview-card-title">驻场人员</div>
                        <div class="overview-card-value">${onSiteMembers}人</div>
                    </div>
                    <div class="overview-card">
                        <div class="overview-card-title">离场记录</div>
                        <div class="overview-card-value">${project.departures ? project.departures.length : 0}次</div>
                    </div>
                    <div class="overview-card" id="predictionCard" style="background:#f0f9ff; border:1px solid #bae6fd; cursor:pointer;" onclick="showPredictionDetail()">
                        <div class="overview-card-title" style="color:#0369a1;">🔮 预计交付</div>
                        <div class="overview-card-value" id="predictedEndDate" style="font-size:16px; color:#0c4a6e;">计算中...</div>
                    </div>
                    </div>
                </div>

                <div class="panel" id="aiDecisionCenterPanel" style="margin-bottom:20px; border:1px solid #e0e7ff; background:#ffffff; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
                    <div class="panel-header" style="background:linear-gradient(90deg, #f0f4ff, #ffffff); border-bottom:1px solid #e0e7ff; padding:12px 20px; display:flex; justify-content:space-between; align-items:center;">
                        <div class="panel-title" style="color:#4f46e5; font-size:15px; font-weight:700; display:flex; align-items:center; gap:8px;">
                            <span>🤖 AI 决策中心</span>
                            <span style="font-size:11px; font-weight:normal; color:#6b7280; background:#f3f4f6; padding:2px 8px; border-radius:10px;">Decision Center</span>
                        </div>
                        <button class="btn btn-xs btn-outline" onclick="refreshAiDecisionCenter(${project.id})" style="border-radius:6px; font-size:11px;">🔄 刷新决策</button>
                    </div>
                    <div class="panel-body" style="padding:0;">
                        <!-- 1. AI 战略研判 (以前的 aiInsightPanel) -->
                        <div id="aiInsightSection" style="padding:15px 20px; border-bottom:1px solid #f1f5f9;">
                             <div id="aiInsightContent">
                                <div class="loading-spinner" style="font-size:13px; color:#6b7280;">AI 正在分析执行现状...</div>
                             </div>
                        </div>
                        
                        <!-- 2. 战术行动建议 (以前的 recommendedActionsPanel) -->
                        <div id="recommendedActionsSection" style="padding:15px 20px; background:#f8faff;">
                            <div style="font-size:12px; font-weight:600; color:#64748b; margin-bottom:10px; display:flex; align-items:center; gap:4px;">
                                <span style="width:4px; height:12px; background:#4f46e5; border-radius:2px;"></span>
                                战术行动指令 (DirectActions)
                            </div>
                            <div id="recommendedActionsContent">
                                <div style="color:#94a3b8; font-size:12px; text-align:center; padding:10px;">暂无紧急行动建议</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="panel" id="similarProjectsPanel" style="margin-bottom:20px; border:1px solid #e2e8f0; background:#f8fafc;">
                    <div class="panel-header" style="background:linear-gradient(90deg, #f1f5f9, #ffffff); border-bottom:1px solid #e2e8f0; padding:10px 20px;">
                        <div class="panel-title" style="color:#475569; font-size:14px;">📡 相似项目雷达 (AI Discovery)</div>
                    </div>
                    <div class="panel-body" id="similarProjectsContent" style="padding:15px 20px;">
                        <div class="loading-spinner"></div>
                    </div>
                </div>

                <div class="tabs">
                    <div class="tab active" onclick="switchTab(this, 'gantt')">📊 甘特图</div>
                    <div class="tab" onclick="switchTab(this, 'pulse')">📈 脉动</div>
                    <div class="tab" onclick="switchTab(this, 'stages')">📋 阶段</div>
                    <div class="tab" onclick="switchTab(this, 'milestones')">🎯 里程碑</div>
                    <div class="tab" onclick="switchTab(this, 'team')">👥 团队</div>

                    <div class="tab" onclick="switchTab(this, 'flow')">🎨 流设计器</div>
                    <div class="tab" onclick="switchTab(this, 'devices')">📡 设备</div>
                    <div class="tab" onclick="switchTab(this, 'issues')">⚠️ 问题</div>
                    <div class="tab" onclick="switchTab(this, 'communications'); loadCommunications(${project.id})">💬 沟通</div>
                    <div class="tab" onclick="switchTab(this, 'departures')">🚪 离场</div>
                    <div class="tab" onclick="switchTab(this, 'worklogs')">📝 日志</div>
                    <div class="tab" onclick="switchTab(this, 'documents')">📄 文档</div>
                    <div class="tab" onclick="switchTab(this, 'expenses')">💰 费用</div>
                    <div class="tab" onclick="switchTab(this, 'changes')">📝 变更</div>
                    <div class="tab" onclick="switchTab(this, 'acceptance')">✅ 验收</div>
                    <div class="tab" onclick="switchTab(this, 'satisfaction')">⭐ 满意度</div>
                    <div class="tab" onclick="switchTab(this, 'dependencies'); loadDependencies(${project.id})">🔗 依赖</div>
                    <div class="tab" onclick="switchTab(this, 'standup'); loadStandupData(${project.id})">📋 站会</div>
                    <div class="tab" onclick="switchTab(this, 'deviation'); loadDeviationAnalysis(${project.id})">📊 偏差</div>
                    <div class="tab" onclick="switchTab(this, 'interfaceSpec'); InterfaceSpec.renderTab(currentProjectId)" style="position:relative;">📑 智能对照 <span style="position:absolute; top:-6px; right:-6px; background:#ef4444; color:white; font-size:10px; padding:1px 4px; border-radius:4px; transform:scale(0.8);">NEW</span></div>
                    <div class="tab" onclick="switchTab(this, 'financials'); loadProjectFinancials(${project.id})">💰 财务看板</div>
                </div>

                <!-- Tab内容 -->
                <div class="tab-content" id="tab-interfaceSpec">
                    <div id="tabInterfaceSpec"></div>
                </div>

                <div class="tab-content" id="tab-financials">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">💰 项目财务概览 (Cost & Profit)</div>
                            <div class="btn-group">
                                <button class="btn btn-xs btn-outline" onclick="loadProjectFinancials(${project.id})">🔄 刷新数据</button>
                                <button class="btn btn-xs btn-primary" onclick="showRevenueModal(${project.id})">+ 录入收入</button>
                            </div>
                        </div>
                        <div class="panel-body" id="financialsContent">
                            <div class="loading-spinner"></div>
                        </div>
                    </div>
                </div>

                <div class="tab-content active" id="tab-gantt">
                    <div class="panel">
                        <div class="panel-header"><div class="panel-title">项目甘特图</div></div>
                        <div class="panel-body">
                            <div class="gantt-legend" id="projectGanttLegend"></div>
                            <div class="gantt-chart-container" id="projectGanttChart" style="height:350px;"></div>
                        </div>
                    </div>
                </div>

                <div class="tab-content" id="tab-pulse">
                    <div class="panel">
                        <div class="panel-header"><div class="panel-title">📈 任务燃尽趋势</div></div>
                        <div class="panel-body">
                            <div id="pulseBurndownChartInDetail" style="width: 100%; height: 300px;"></div>
                        </div>
                    </div>
                    <div class="panel" style="margin-top: 16px;">
                        <div class="panel-header">
                            <div class="panel-title">📂 报告归档</div>
                            <div style="display:flex;gap:8px;align-items:center;">
                                <select id="archiveTypeFilter" onchange="loadReportArchive(currentProjectId)" style="padding:4px 8px;border-radius:6px;border:1px solid var(--gray-300);font-size:13px;">
                                    <option value="">全部</option>
                                    <option value="daily">日报</option>
                                    <option value="weekly">周报</option>
                                </select>
                                <button class="btn btn-sm btn-outline" onclick="manualGenerateArchive('daily')">📝 生成今日日报</button>
                                <button class="btn btn-sm btn-outline" onclick="manualGenerateArchive('weekly')">📋 生成本周周报</button>
                                <button class="btn btn-sm btn-ai" onclick="showBusinessReportModal(${project.id})">🏢 业务运行月/季报</button>
                            </div>
                        </div>
                        <div class="panel-body" id="reportArchiveList" style="max-height:400px;overflow-y:auto;">
                            <div style="text-align:center;color:var(--gray-400);padding:20px;">加载中...</div>
                        </div>
                    </div>
                </div>

                <div class="tab-content" id="tab-stages">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">📋 项目阶段 <span id="baselineHint" style="font-weight:normal; font-size:12px; color:var(--gray-500); margin-left:12px;"></span></div>
                            <button class="btn btn-primary btn-sm" onclick="showAddStageModal()">+ 添加阶段</button>
                        </div>
                        <div class="panel-body">${renderStages(project.stages)}</div>
                    </div>
                </div>

                <div class="tab-content" id="tab-milestones">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">项目里程碑</div>
                            <button class="btn btn-primary btn-sm" onclick="showModal('milestoneModal')">+ 添加</button>
                        </div>
                        <div class="panel-body">${renderMilestones(project.milestones)}</div>
                    </div>
                </div>

                <div class="tab-content" id="tab-team">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">👥 项目团队</div>
                            <div class="btn-group">
                                <button class="btn btn-ai btn-sm" onclick="showMeetingAssistant()">🎙️ 会议助手</button>
                                <button class="btn btn-primary btn-sm" onclick="showModal('memberModal')">+ 添加成员</button>
                            </div>
                        </div>
                        <div class="panel-body">${renderMembers(project.members)}</div>
                    </div>
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">📞 甲方联系人</div>
                            <button class="btn btn-primary btn-sm" onclick="showModal('contactModal')">+ 添加</button>
                        </div>
                        <div class="panel-body">${renderContacts(project.contacts)}</div>
                    </div>
                </div>

                    </div>
                </div>

                <div class="tab-content" id="tab-interfaces">
                    <div class="panel">
                        <div class="panel-header">
                        
                            <div class="panel-title">接口对接状态 <small id="interfaceCategoryHint" style="font-weight:normal;color:#6b7280;margin-left:10px;"></small></div>
                            <div class="btn-group">
                                <button class="btn btn-outline btn-sm" onclick="batchAddRecommendedInterfaces()" title="根据项目类型批量添加推荐接口">📋 批量导入</button>
                                <button class="btn btn-primary btn-sm" onclick="showInterfaceModal()">+ 新增</button>
                            </div>
                        </div>
                        <div class="panel-body">${renderInterfaces(project.interfaces)}</div>
                    </div>
                </div>

                <div class="tab-content" id="tab-flow">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">🎨 接口流设计器 (Flow Designer)</div>
                            <div class="btn-group">
                                <button class="btn btn-outline btn-sm" onclick="renderInterfaceFlow()">🔄 刷新拓扑</button>
                            </div>
                        </div>
                        <div class="panel-body">
                            <div id="interfaceFlowChart" style="width: 100%; height: 500px; background: #f8fafc; border-radius: 8px;"></div>
                        </div>
                    </div>
                </div>


                <div class="tab-content" id="tab-devices">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">医疗设备管理</div>
                            <button class="btn btn-primary btn-sm" onclick="showModal('deviceModal')">+ 录入</button>
                        </div>
                        <div class="panel-body" id="devicesContainer"><div class="loading-spinner"><div class="spinner"></div></div></div>
                    </div>
                </div>

                <div class="tab-content" id="tab-issues">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">问题跟踪</div>
                            <div class="btn-group">
                                <button class="btn btn-warning btn-sm" onclick="showAiChaserModal()">🔔 AI 智能催单</button>
                                <button class="btn btn-primary btn-sm" onclick="showModal('issueModal')">+ 新增</button>
                            </div>
                        </div>
                        <div class="panel-body">${renderIssues(project.issues)}</div>
                    </div>
                </div>

                <div class="tab-content" id="tab-departures">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">🚪 离场记录</div>
                            ${['进行中', '试运行', '暂停'].includes(project.status) ?
            `<button class="btn btn-pink btn-sm" onclick="showDepartureModal()">+ 申请离场</button>` : ''}
                        </div>
                        <div class="panel-body">${renderDepartures(project.departures)}</div>
                    </div>
                </div>

                <div class="tab-content" id="tab-worklogs">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">📝 工作日志</div>
                            <div class="btn-group">
                                <button class="btn btn-outline btn-sm" onclick="loadWorklogStats()">📊 统计</button>
                                <button class="btn btn-primary btn-sm" onclick="showWorklogModal()">+ 填写日志</button>
                                <button class="btn btn-ai btn-sm" onclick="showAiWorklogModal()">✨ AI 智能填报</button>
                                <button class="btn btn-outline btn-sm" style="border-color:var(--primary); color:var(--primary);" onclick="showMultiLogImportModal()">📝 批量导入</button>
                            </div>
                        </div>
                        <div class="panel-body" id="worklogsContainer"><div class="loading-spinner"><div class="spinner"></div></div></div>
                    </div>
                </div>

                <div class="tab-content" id="tab-documents">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">📄 项目文档</div>
                            <button class="btn btn-primary btn-sm" onclick="showModal('documentModal')">+ 上传</button>
                        </div>
                        <div class="panel-body" id="documentsContainer"><div class="loading-spinner"><div class="spinner"></div></div></div>
                    </div>
                </div>

                <div class="tab-content" id="tab-expenses">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">💰 费用管理</div>
                            <div class="btn-group">
                                <button class="btn btn-outline btn-sm" onclick="loadExpenseStats()">📊 统计</button>
                                <button class="btn btn-primary btn-sm" onclick="showModal('expenseModal')">+ 录入</button>
                            </div>
                        </div>
                        <div class="panel-body" id="expensesContainer"><div class="loading-spinner"><div class="spinner"></div></div></div>
                    </div>
                </div>

                <div class="tab-content" id="tab-changes">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">📝 变更记录</div>
                            <div class="btn-group">
                                <button class="btn btn-ai btn-sm" onclick="showDemandAnalysisModal()">🧬 变更影响评估</button>
                                <button class="btn btn-primary btn-sm" onclick="showModal('changeModal')">+ 变更申请</button>
                            </div>
                        </div>
                        <div class="panel-body" id="changesContainer"><div class="loading-spinner"><div class="spinner"></div></div></div>
                    </div>
                </div>

                <div class="tab-content" id="tab-acceptance">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">✅ 验收管理</div>
                            <button class="btn btn-primary btn-sm" onclick="showAcceptanceModal()">+ 验收申请</button>
                        </div>
                        <div class="panel-body" id="acceptancesContainer"><div class="loading-spinner"><div class="spinner"></div></div></div>
                    </div>
                </div>

                <div class="tab-content" id="tab-satisfaction">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">⭐ 客户满意度</div>
                            <div class="btn-group">
                                <button class="btn btn-outline btn-sm" onclick="showModal('followupModal')">📞 回访</button>
                                <button class="btn btn-primary btn-sm" onclick="showModal('satisfactionModal')">+ 调查</button>
                            </div>
                        </div>
                        <div class="panel-body" id="satisfactionContainer"><div class="loading-spinner"><div class="spinner"></div></div></div>
                    </div>
                </div>

                <div class="tab-content" id="tab-communications">
                    <div class="panel">
                        <div class="panel-header" style="flex-wrap:wrap;gap:8px;">
                            <div class="panel-title">💬 客户沟通记录</div>
                            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                                <button class="btn btn-sm" style="background:linear-gradient(135deg,#8b5cf6,#6366f1);color:white;border:none;" onclick="analyzeCommunications()" title="AI从项目管理/需求分析角度分析所有沟通记录">🤖 AI 智能分析</button>
                                <button class="btn btn-sm" style="background:linear-gradient(135deg,#0ea5e9,#2563eb);color:white;border:none;" onclick="document.getElementById('commFileInput').click()" title="上传文件(Word/PDF/Excel/TXT)进行AI分析">📎 上传文件分析</button>
                                <button class="btn btn-primary btn-sm" onclick="showAddCommunicationModal()">+ 新增记录</button>
                            </div>
                        </div>
                        <div class="panel-body">
                            <div id="communicationsList">
                                <div class="loading-spinner"><div class="spinner"></div></div>
                            </div>
                        </div>
                    </div>
                    <div id="communicationAiAnalysis" style="display:none;margin-top:16px;"></div>
                    <input type="file" id="commFileInput" style="display:none;" accept=".docx,.pdf,.xlsx,.xls,.txt,.csv,.md" onchange="analyzeUploadedFile(this)">
                </div>

                <!-- 任务依赖关系 Tab -->
                <div class="tab-content" id="tab-dependencies">
                    <div class="panel">
                        <div class="panel-header">
                            <div class="panel-title">🔗 任务依赖关系</div>
                            <div class="btn-group">
                                <button class="btn btn-outline btn-sm" onclick="showCriticalPath(${project.id})">🎯 关键路径</button>
                                <button class="btn btn-primary btn-sm" onclick="showAddDependencyModal()">+ 添加依赖</button>
                            </div>
                        </div>
                        <div class="panel-body" id="dependenciesContainer"><div class="loading-spinner"><div class="spinner"></div></div></div>
                    </div>
                    <div id="criticalPathPanel" style="display:none;margin-top:16px;"></div>
                </div>

                <!-- 每日站会助手 Tab -->
                <div class="tab-content" id="tab-standup">
                    <div class="panel">
                        <div class="panel-header" style="flex-wrap:wrap;gap:8px;">
                            <div class="panel-title">📋 每日站会助手</div>
                            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                                <input type="date" id="standupDatePicker" value="${new Date().toISOString().slice(0, 10)}" onchange="loadStandupData(${project.id}, this.value)" style="padding:4px 8px;border-radius:6px;border:1px solid var(--gray-300);font-size:13px;">
                                <button class="btn btn-sm" style="background:linear-gradient(135deg,#8b5cf6,#6366f1);color:white;border:none;" onclick="generateAiStandup(${project.id})">🤖 AI生成纪要</button>
                                <button class="btn btn-outline btn-sm" onclick="loadStandupHistory(${project.id})">📜 历史纪要</button>
                            </div>
                        </div>
                        <div class="panel-body" id="standupContainer"><div class="loading-spinner"><div class="spinner"></div></div></div>
                    </div>
                    <div id="standupAiResult" style="display:none;margin-top:16px;"></div>
                    <div id="standupHistoryPanel" style="display:none;margin-top:16px;"></div>
                </div>

                <!-- 进度偏差分析 Tab -->
                <div class="tab-content" id="tab-deviation">
                    <div class="panel">
                        <div class="panel-header" style="flex-wrap:wrap;gap:8px;">
                            <div class="panel-title">📊 进度偏差分析</div>
                            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                                <button class="btn btn-outline btn-sm" onclick="captureSnapshot(${project.id})">📸 拍摄快照</button>
                                <button class="btn btn-sm" style="background:linear-gradient(135deg,#8b5cf6,#6366f1);color:white;border:none;" onclick="generateDeviationReport(${project.id})">🤖 AI偏差诊断</button>
                            </div>
                        </div>
                        <div class="panel-body" id="deviationContainer"><div class="loading-spinner"><div class="spinner"></div></div></div>
                    </div>
                    <div id="deviationAiReport" style="display:none;margin-top:16px;"></div>
                </div>
            `;

    setTimeout(() => {
        renderGanttLegend('projectGanttLegend');
        renderProjectGantt(project);
    }, 100);

    loadDevices(project.id);
    loadWorklogs(project.id);
    loadDocuments(project.id);
    loadExpenses(project.id);
    loadChanges(project.id);
    loadAcceptances(project.id);
    loadSatisfaction(project.id);
    loadDependencies(project.id);
    enableTabDragging();
}

async function refreshAiDecisionCenter(projectId, isRefresh = false) {
    loadAiDailyInsight(projectId, isRefresh);
    loadRecommendedActions(projectId, isRefresh);
}

async function loadAiDailyInsight(projectId, isRefresh = false) {
    const contentEl = document.getElementById('aiInsightContent');
    if (!contentEl) return;

    contentEl.innerHTML = '<div class="loading-spinner" style="font-size:13px; color:#6b7280;">AI 正在进行战略研判...</div>';
    try {
        const url = `/ai/daily-insight/${projectId}` + (isRefresh ? '?refresh=1' : '');
        const advice = await api.get(url);
        // 确保 marked.js 已加载
        const adviceHtml = typeof marked !== 'undefined' ? marked.parse(advice || '') : (advice || '').replace(/\n/g, '<br>');
        contentEl.innerHTML = `<div class="report-content" style="font-size:14px; color:#334155; line-height:1.7;">${adviceHtml}</div>`;
    } catch (e) {
        contentEl.innerHTML = `<div style="color:var(--danger); font-size:12px;">⚠️ 战略研判暂时离线</div>`;
    }
}


// ========== 依赖管理功能 ==========
async function loadDependencies(pid) {
    const deps = await api.get(`/projects/${pid}/dependencies`);
    const container = document.getElementById('dependenciesContainer');
    if (!container) return;
    renderDependencies(deps, pid);
}

function renderDependencies(deps, pid) {
    const container = document.getElementById('dependenciesContainer');
    if (!container) return;
    if (!deps || deps.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>暂无任务依赖关系</p>
                <button class="btn btn-primary btn-sm" onclick="showAddDependencyModal()">添加依赖</button>
            </div>`;
        return;
    }
    container.innerHTML = `
        <div style="margin-bottom:12px; display:flex; justify-content:flex-end;">
            <button class="btn btn-primary btn-sm" onclick="showAddDependencyModal()">添加依赖关系</button>
        </div>
        <div class="table-container">
            <table class="table">
                <thead><tr><th>任务</th><th>依赖于</th><th>类型</th><th>操作</th></tr></thead>
                <tbody>
                    ${deps.map(d => `
                        <tr>
                            <td style="font-weight:600;">${d.task_name}</td>
                            <td><span style="color:var(--gray-500);">→</span> ${d.depends_on_task_name}</td>
                            <td><span class="badge badge-info">${d.dependency_type === 'finish_to_start' ? '完成-开始' : d.dependency_type}</span></td>
                            <td><button class="btn btn-danger btn-xs" onclick="deleteDependency(${d.id}, ${pid})">删除</button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function showAddDependencyModal() {
    const taskSelect = document.getElementById('depTaskId');
    const dependSelect = document.getElementById('depDependsOnId');
    if (!taskSelect || !dependSelect) return;

    // 清空并填充下拉框
    taskSelect.innerHTML = '<option value="">选择任务...</option>';
    dependSelect.innerHTML = '<option value="">选择被依赖任务...</option>';

    if (currentProject && currentProject.stages) {
        currentProject.stages.forEach(s => {
            if (s.tasks) {
                s.tasks.forEach(t => {
                    const opt = `<option value="${t.id}">${s.stage_name}: ${t.task_name}</option>`;
                    taskSelect.innerHTML += opt;
                    dependSelect.innerHTML += opt;
                });
            }
        });
    }
    openModal('dependencyModal');
}

async function saveDependency() {
    const data = {
        task_id: document.getElementById('depTaskId').value,
        depends_on_task_id: document.getElementById('depDependsOnId').value,
        dependency_type: document.getElementById('depType').value
    };
    if (!data.task_id || !data.depends_on_task_id) { alert('请完整选择任务'); return; }
    if (data.task_id === data.depends_on_task_id) { alert('任务不能依赖于自身'); return; }

    await api.post(`/projects/${currentProjectId}/dependencies`, data);
    closeModal('dependencyModal');
    loadDependencies(currentProjectId);
    showToast('依赖关系已添加');
}

async function deleteDependency(id, pid) {
    if (!confirm('确定删除此依赖关系吗？')) return;
    await api.delete(`/projects/dependencies/${id}`);
    loadDependencies(pid);
    showToast('依赖关系已删除');
}

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

// ========== 渲染函数 ==========
function renderStages(stages) {
    if (!stages || stages.length === 0) return '<div class="empty-state"><p>暂无阶段数据</p></div>';

    function formatDate(dateStr) {
        if (!dateStr || !dateStr.trim()) return '';
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return '';
            return `${d.getMonth() + 1}/${d.getDate()}`;
        } catch { return ''; }
    }

    function getDateInfo(startStr, endStr, stageObj) {
        if (!startStr && !endStr) return { html: '<span style="color:var(--gray-400);font-size:11px;">未设置日期</span>', badge: '' };

        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const startFmt = startStr ? startStr.substring(5).replace('-', '/') : '';
        const endFmt = endStr ? endStr.substring(5).replace('-', '/') : '';

        let dateText = '';
        if (startFmt && endFmt) {
            dateText = `${startFmt} → ${endFmt}`;
        } else if (startFmt) {
            dateText = `${startFmt} 起`;
        } else {
            dateText = `截止 ${endFmt}`;
        }

        // Calculate duration and status
        let badge = '';
        try {
            const end = endStr ? new Date(endStr) : null;
            const start = startStr ? new Date(startStr) : null;
            if (end) {
                end.setHours(0, 0, 0, 0);
                const daysLeft = Math.ceil((end - now) / 86400000);
                if (daysLeft < 0) {
                    badge = `<span style="background:#fef2f2;color:#dc2626;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;">逾期${-daysLeft}天</span>`;
                } else if (daysLeft <= 3) {
                    badge = `<span style="background:#fff7ed;color:#ea580c;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;">剩${daysLeft}天</span>`;
                } else if (daysLeft <= 7) {
                    badge = `<span style="background:#fefce8;color:#ca8a04;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;">剩${daysLeft}天</span>`;
                }
            }
            if (start && end) {
                const totalDays = Math.ceil((end - start) / 86400000);
                if (totalDays > 0) dateText += ` · ${totalDays}天`;
            }
        } catch { }

        // Actual dates display
        let actualDatesHtml = '';
        if (stageObj && stageObj.actual_start_date) {
            actualDatesHtml = `<span style="color:var(--success);font-size:11px;margin-left:12px;">已开工: ${stageObj.actual_start_date.substring(5)}${stageObj.actual_end_date ? ' ~ ' + stageObj.actual_end_date.substring(5) : ' (进行中)'}</span>`;
        }

        return {
            html: `<span style="color:var(--gray-500);font-size:11px;">计划: ${dateText}</span>${actualDatesHtml}`,
            badge
        };
    }

    return stages.map((s, idx) => {
        try {
            const color = STAGE_COLORS[s.stage_name] || '#5B8FF9';
            const isExpandedClass = expandedStages.has(Number(s.id)) ? 'expanded' : '';
            const progress = s.progress || 0;
            const totalTasks = s.tasks ? s.tasks.length : 0;
            const doneTasks = s.tasks ? s.tasks.filter(t => t.is_completed).length : 0;
            const dateInfo = getDateInfo(s.plan_start_date, s.plan_end_date, s);

            let statusBadge = '';
            if (progress === 100) {
                statusBadge = '<span class="stage-status-badge" style="background:#ecfdf5;color:#059669;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;">✅ 已完成</span>';
            } else if (progress > 0) {
                statusBadge = '<span class="stage-status-badge" style="background:#eff6ff;color:#2563eb;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;">⏳ 进行中</span>';
            } else {
                statusBadge = '<span class="stage-status-badge" style="background:#f9fafb;color:#6b7280;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;">⚪ 待开始</span>';
            }

            return `
                <div class="stage-item ${isExpandedClass}" id="stage-${s.id}">
                    <div class="stage-header" onclick="toggleStage(${s.id})">
                        <div class="stage-info">
                            <span class="stage-arrow">▶</span>
                            <div class="stage-color-dot" style="background:${color}"></div>
                            <div style="display:flex;flex-direction:column;gap:4px;">
                                <div style="display:flex;align-items:center;gap:8px;">
                                    <span class="stage-name" style="font-weight:600;">${s.stage_name}</span>
                                    ${statusBadge}
                                    ${dateInfo.badge}
                                </div>
                                <div style="display:flex;align-items:center;gap:12px;">
                                    ${dateInfo.html}
                                    <span style="color:var(--gray-400);font-size:11px;">📋 ${doneTasks}/${totalTasks} 任务</span>
                                </div>
                            </div>
                        </div>
                        <div style="display:flex;align-items:center;gap:12px;">
                            <div class="stage-progress-mini">
                                <div class="stage-progress-mini-bar" style="width:${progress}%;background:${color}"></div>
                            </div>
                            <span style="font-size:12px;font-weight:600;color:${color};min-width:36px;text-align:right;">${progress}%</span>
                            <button class="btn btn-xs" style="margin-left:8px;" onclick="showScaleModal(${s.id}, '${s.stage_name}', event)" title="调整工作量">⚙️</button>
                        </div>
                    </div>
                    <div class="stage-body">
                        <div style="display:flex; flex-direction:column; gap:8px;">
                            ${s.tasks && s.tasks.length > 0 ? s.tasks.map(t => `
                                <div class="task-item" style="margin-bottom:0; display:flex; align-items:center; width:100%;">
                                    <div class="task-checkbox ${t.is_completed ? 'checked' : ''}" onclick="toggleTask(${t.id}, event)"></div>
                                    <span class="task-name ${t.is_completed ? 'completed' : ''}" style="flex:1;">${t.task_name}</span>
                                    ${!t.is_completed ? `<button class="btn btn-xs btn-outline" style="font-size:10px; padding:2px 4px; border-color:#e2e8f0; color:#64748b;" onclick="showRiskSimulationModal(${t.id}, '${t.task_name}', event)" title="模拟延迟波及项目">🦋 仿真</button>` : ''}
                                </div>
                            `).join('') : '<p style="color:var(--gray-400);font-size:13px;text-align:center;padding:10px;">暂无任务</p>'}
                        </div>
                    </div>
                </div>
            `;
        } catch (err) {
            console.error('Error rendering stage:', s, err);
            return `<div style="color:red;padding:10px;">渲染阶段出错: ${s.stage_name || '未知'}</div>`;
        }
    }).join('');
}

function renderMilestones(milestones) {
    if (!milestones || milestones.length === 0) return '<div class="empty-state"><p>暂无里程碑</p></div>';
    return milestones.map(m => `
                <div class="milestone-item">
                    <div class="milestone-diamond ${m.is_completed ? 'completed' : ''}" onclick="toggleMilestone(${m.id})"></div>
                    <div class="milestone-info">
                        <div class="milestone-name" style="${m.is_completed ? 'text-decoration:line-through;color:var(--gray-400);' : ''}">${m.name}</div>
                        <div class="milestone-date">目标: ${m.target_date} ${m.completed_date ? '| 完成: ' + m.completed_date : ''}</div>
                    </div>
                    <button class="btn btn-danger btn-xs" onclick="deleteMilestone(${m.id})">删除</button>
                </div>
            `).join('');
}

function renderMembers(members) {
    if (!members || members.length === 0) return '<div class="empty-state"><p>暂无团队成员</p></div>';
    return members.map(m => `
                <div class="member-card">
                    <div class="member-avatar">${m.name ? m.name.charAt(0) : '?'}</div>
                    <div class="member-info">
                        <div class="member-name">${m.name} ${m.is_onsite ? '<span class="badge badge-info" style="font-size:10px;">驻场</span>' : ''}</div>
                        <div class="member-role">${m.role || '成员'}</div>
                        <div class="member-contact">${m.phone || ''} ${m.email ? '| ' + m.email : ''}</div>
                    </div>
                    <div class="member-status">
                        <span class="badge ${m.status === '在岗' ? 'badge-success' : 'badge-gray'}">${m.status}</span>
                    </div>
                    <button class="btn btn-danger btn-xs" onclick="deleteMember(${m.id})">删除</button>
                </div>
            `).join('');
}

function renderContacts(contacts) {
    if (!contacts || contacts.length === 0) return '<div class="empty-state"><p>暂无联系人</p></div>';
    return contacts.map(c => `
                <div class="member-card">
                    <div class="member-avatar" style="background:linear-gradient(135deg, var(--success), #34d399);">${c.name ? c.name.charAt(0) : '?'}</div>
                    <div class="member-info">
                        <div class="member-name">${c.name} ${c.is_primary ? '<span class="badge badge-warning" style="font-size:10px;">主要</span>' : ''}</div>
                        <div class="member-role">${c.department || ''} ${c.position ? '- ' + c.position : ''}</div>
                        <div class="member-contact">${c.phone || ''} ${c.email ? '| ' + c.email : ''}</div>
                    </div>
                    <button class="btn btn-danger btn-xs" onclick="deleteContact(${c.id})">删除</button>
                </div>
            `).join('');
}

function renderInterfaces(interfaces) {
    if (!interfaces || interfaces.length === 0) return '<div class="empty-state"><p>暂无接口数据</p></div>';
    const statusMap = { '待开发': 'badge-gray', '开发中': 'badge-info', '联调中': 'badge-warning', '已完成': 'badge-success' };
    return `
                <div style="background:#f0f9ff; border:1px solid #bae6fd; color:#0369a1; padding:8px 16px; border-radius:8px; margin-bottom:12px; font-size:13px; display:flex; align-items:center; gap:8px;">
                    <i class="fas fa-info-circle"></i> 此处仅用于手工记录接口开发状态，详细文档对照请前往 <b>📑 智能对照</b> 模块（右侧 V2.0 版）。
                </div>
                <div class="table-container">
                    <table class="table">
                        <thead><tr><th>系统</th><th>接口名称</th><th>状态</th><th>操作</th></tr></thead>
                        <tbody>
                            ${interfaces.map(i => `
                                <tr>
                                    <td>${i.system_name}</td>
                                    <td>${i.interface_name || '-'}</td>
                                    <td>
                                        <select class="badge ${statusMap[i.status] || 'badge-gray'}" style="border:none;cursor:pointer;" onchange="updateInterfaceStatus(${i.id}, this.value)">
                                            <option value="待开发" ${i.status === '待开发' ? 'selected' : ''}>待开发</option>
                                            <option value="开发中" ${i.status === '开发中' ? 'selected' : ''}>开发中</option>
                                            <option value="联调中" ${i.status === '联调中' ? 'selected' : ''}>联调中</option>
                                            <option value="已完成" ${i.status === '已完成' ? 'selected' : ''}>已完成</option>
                                        </select>
                                    </td>
                                    <td><button class="btn btn-danger btn-xs" onclick="deleteInterface(${i.id})">删除</button></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
}

function renderIssues(issues) {
    if (!issues || issues.length === 0) return '<div class="empty-state"><p>暂无问题记录</p></div>';
    const severityMap = { '高': 'badge-danger', '中': 'badge-warning', '低': 'badge-info' };
    const statusMap = { '待处理': 'badge-danger', '处理中': 'badge-warning', '已解决': 'badge-success' };
    return `
                <div class="table-container">
                    <table class="table">
                        <thead><tr><th>类型</th><th>描述</th><th>严重度</th><th>状态</th><th>操作</th></tr></thead>
                        <tbody>
                            ${issues.map(i => `
                                <tr>
                                    <td>${i.issue_type}</td>
                                    <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;">${i.description}</td>
                                    <td><span class="badge ${severityMap[i.severity]}">${i.severity}</span></td>
                                    <td>
                                        <select class="badge ${statusMap[i.status]}" style="border:none;cursor:pointer;" onchange="updateIssueStatus(${i.id}, this.value)">
                                            <option value="待处理" ${i.status === '待处理' ? 'selected' : ''}>待处理</option>
                                            <option value="处理中" ${i.status === '处理中' ? 'selected' : ''}>处理中</option>
                                            <option value="已解决" ${i.status === '已解决' ? 'selected' : ''}>已解决</option>
                                        </select>
                                    </td>
                                    <td>
                                        <div style="display:flex;gap:4px;">
                                            ${i.status === '已解决' ? `<button class="btn btn-ai btn-xs" onclick="extractToKb(${i.id}, this)" title="提取为知识库条目">🧠 提炼</button>` : ''}
                                            <button class="btn btn-danger btn-xs" onclick="deleteIssue(${i.id})">删除</button>
                                        </div>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
}

function renderDepartures(departures) {
    if (!departures || departures.length === 0) return '<div class="empty-state"><p>暂无离场记录</p></div>';
    return departures.map(d => `
                <div class="departure-card type-${d.departure_type}">
                    <div class="departure-header">
                        <span class="departure-type">${d.departure_type}</span>
                        <div class="btn-group">
                            ${d.status === '已离场' && !d.actual_return_date ?
            `<button class="btn btn-success btn-xs" onclick="recordReturn(${d.id})">记录返场</button>` : ''}
                            <span class="badge ${d.status === '已返场' ? 'badge-success' : d.status === '已离场' ? 'badge-pink' : 'badge-warning'}">${d.status}</span>
                        </div>
                    </div>
                    <div class="departure-info">
                        <div class="departure-info-item">离场日期: <span>${d.departure_date}</span></div>
                        <div class="departure-info-item">预计返场: <span>${d.expected_return_date || '待定'}</span></div>
                        <div class="departure-info-item">实际返场: <span>${d.actual_return_date || '-'}</span></div>
                        <div class="departure-info-item">交接人: <span>${d.handover_person || '-'}</span></div>
                        <div class="departure-info-item">离场人员: <span>${d.our_persons || '-'}</span></div>
                        <div class="departure-info-item">原因: <span>${d.reason || '-'}</span></div>
                    </div>
                    <div class="handover-checklist">
                        <span class="handover-item ${d.doc_handover ? 'done' : 'pending'}">${d.doc_handover ? '✓' : '○'} 文档</span>
                        <span class="handover-item ${d.account_handover ? 'done' : 'pending'}">${d.account_handover ? '✓' : '○'} 账号</span>
                        <span class="handover-item ${d.training_handover ? 'done' : 'pending'}">${d.training_handover ? '✓' : '○'} 培训</span>
                        <span class="handover-item ${d.issue_handover ? 'done' : 'pending'}">${d.issue_handover ? '✓' : '○'} 问题</span>
                        <span class="handover-item ${d.contact_handover ? 'done' : 'pending'}">${d.contact_handover ? '✓' : '○'} 联系方式</span>
                    </div>
                </div>
            `).join('');
}

// ========== 数据加载函数 ==========
// ========== 数据加载函数 ==========
async function loadDevices(pid) {
    const devices = await api.get(`/projects/${pid}/devices`);
    const container = document.getElementById('devicesContainer');
    if (!container) return;
    if (!devices || !devices.length) {
        container.innerHTML = '<div class="empty-state"><p>暂无设备数据</p></div>';
        return;
    }

    // Status color mapping for the select border/color
    const getStatusColor = (status) => {
        if (status === '已入库' || status === '已物理连接') return '#10b981'; // Green
        if (status === '解析中') return '#f59e0b'; // Yellow
        if (status === '未连接' || status === '异常') return '#ef4444'; // Red
        return '#6b7280'; // Gray
    };

    container.innerHTML = `
                <div class="table-container">
                    <table class="table">
                        <thead><tr><th>类型</th><th>型号</th><th>协议</th><th>IP</th><th>状态</th><th>操作</th></tr></thead>
                        <tbody>
                            ${devices.map(d => `
                                <tr>
                                    <td>${d.device_type}</td>
                                    <td>${d.brand_model || '-'}</td>
                                    <td>${d.protocol_type || '-'}</td>
                                    <td>${d.ip_address || '-'}</td>
                                    <td>
                                        <select 
                                            class="status-select" 
                                            onchange="changeDeviceStatus(${d.id}, this.value)"
                                            style="border: 1px solid ${getStatusColor(d.status)}; color: ${getStatusColor(d.status)}; padding: 2px 8px; border-radius: 12px; font-size: 12px; background: white; cursor: pointer;"
                                        >
                                            <option value="未连接" ${d.status === '未连接' ? 'selected' : ''}>🔴 未连接</option>
                                            <option value="已物理连接" ${d.status === '已物理连接' ? 'selected' : ''}>🟢 已物理连接</option>
                                            <option value="解析中" ${d.status === '解析中' ? 'selected' : ''}>🟡 解析中</option>
                                            <option value="已入库" ${d.status === '已入库' ? 'selected' : ''}>✅ 已入库</option>
                                            <option value="异常" ${d.status === '异常' ? 'selected' : ''}>❌ 异常</option>
                                        </select>
                                    </td>
                                    <td><button class="btn btn-danger btn-xs" onclick="deleteDevice(${d.id})">删除</button></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
}

async function changeDeviceStatus(deviceId, newStatus) {
    try {
        await api.put(`/devices/${deviceId}`, { status: newStatus });
        showToast('设备状态已更新');
        // Optionally refresh list or just update color locally to avoid flickering
        // loadDevices(currentProjectId); 
        // Update local style
        const select = document.querySelector(`select[onchange="changeDeviceStatus(${deviceId}, this.value)"]`);
        if (select) {
            const color = (newStatus === '已入库' || newStatus === '已物理连接') ? '#10b981' :
                (newStatus === '解析中') ? '#f59e0b' :
                    (newStatus === '未连接' || newStatus === '异常') ? '#ef4444' : '#6b7280';
            select.style.borderColor = color;
            select.style.color = color;
        }
    } catch (e) {
        alert('更新失败: ' + e.message);
    }
}

async function loadWorklogs(pid) {
    const logs = await api.get(`/projects/${pid}/worklogs`);
    const container = document.getElementById('worklogsContainer');
    if (!container) return;
    if (!logs || !logs.length) {
        container.innerHTML = '<div class="empty-state"><p>暂无工作日志</p></div>';
        return;
    }
    container.innerHTML = logs.slice(0, 20).map(l => `
                <div class="worklog-item">
                    <div class="worklog-header">
                        <span class="worklog-date">${l.log_date}</span>
                        <span class="worklog-meta">${l.member_name || '未知'} | ${l.work_type} | ${l.work_hours}h</span>
                    </div>
                    <div class="worklog-content">${l.work_content || '无内容'}</div>
                    ${l.issues_encountered ? `<div style="margin-top:8px;color:var(--danger);font-size:12px;">问题: ${l.issues_encountered}</div>` : ''}
                </div>
            `).join('');
}

async function loadDocuments(pid) {
    const docs = await api.get(`/projects/${pid}/documents`);
    const container = document.getElementById('documentsContainer');
    if (!container) return;
    if (!docs || !docs.length) {
        container.innerHTML = '<div class="empty-state"><p>暂无文档</p></div>';
        return;
    }
    container.innerHTML = `
                <div class="table-container">
                    <table class="table">
                        <thead><tr><th>文档名称</th><th>类型</th><th>分类</th><th>版本</th><th>上传人</th><th>操作</th></tr></thead>
                        <tbody>
                            ${docs.map(d => `
                                <tr>
                                    <td>${d.doc_name}</td>
                                    <td><span class="badge badge-info">${d.doc_type || '-'}</span></td>
                                    <td>${d.doc_category || '-'}</td>
                                    <td>${d.version || '-'}</td>
                                    <td>${d.upload_by || '-'}</td>
                                    <td>
                                        ${d.file_path ? `<button class="btn btn-outline btn-xs" onclick="downloadDocument(${d.id})">下载</button>` : ''}
                                        <button class="btn btn-danger btn-xs" onclick="deleteDocument(${d.id})">删除</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
}

async function loadExpenses(pid) {
    const expenses = await api.get(`/projects/${pid}/expenses`);
    const container = document.getElementById('expensesContainer');
    if (!container) return;
    if (!expenses || !expenses.length) {
        container.innerHTML = '<div class="empty-state"><p>暂无费用记录</p></div>';
        return;
    }
    const icons = { '差旅': '✈️', '住宿': '🏨', '餐饮': '🍽️', '交通': '🚗', '采购': '🛒', '其他': '📦' };
    const total = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    container.innerHTML = `
                <div style="margin-bottom:16px;padding:12px;background:var(--gray-50);border-radius:8px;">
                    <span style="font-size:14px;color:var(--gray-600);">费用合计: </span>
                    <span style="font-size:20px;font-weight:700;color:var(--primary);">¥${total.toFixed(2)}</span>
                </div>
                ${expenses.map(e => `
                    <div class="expense-item">
                        <div class="expense-icon ${e.expense_type}">${icons[e.expense_type] || '📦'}</div>
                        <div class="expense-info">
                            <div class="expense-desc">${e.description || e.expense_type}</div>
                            <div class="expense-meta">${e.expense_date} | ${e.applicant || '未知'} | <span class="badge ${e.status === '已报销' ? 'badge-success' : 'badge-warning'}">${e.status}</span></div>
                        </div>
                        <div class="expense-amount">¥${(e.amount || 0).toFixed(2)}</div>
                        <button class="btn btn-danger btn-xs" onclick="deleteExpense(${e.id})">删除</button>
                    </div>
                `).join('')}
            `;
}

async function loadChanges(pid) {
    const changes = await api.get(`/projects/${pid}/changes`);
    const container = document.getElementById('changesContainer');
    if (!container) return;
    if (!changes || !changes.length) {
        container.innerHTML = '<div class="empty-state"><p>暂无变更记录</p></div>';
        return;
    }
    const statusMap = { '待审批': 'badge-warning', '已批准': 'badge-success', '已驳回': 'badge-danger', '已执行': 'badge-info' };
    container.innerHTML = `
                <div class="table-container">
                    <table class="table">
                        <thead><tr><th>类型</th><th>标题</th><th>申请人</th><th>申请日期</th><th>状态</th><th>操作</th></tr></thead>
                        <tbody>
                            ${changes.map(c => `
                                <tr>
                                    <td><span class="badge badge-purple">${c.change_type}</span></td>
                                    <td>${c.change_title}</td>
                                    <td>${c.requested_by || '-'}</td>
                                    <td>${c.requested_date || '-'}</td>
                                    <td><span class="badge ${statusMap[c.status]}">${c.status}</span></td>
                                    <td><button class="btn btn-danger btn-xs" onclick="deleteChange(${c.id})">删除</button></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
}

async function loadAcceptances(pid) {
    const acceptances = await api.get(`/projects/${pid}/acceptances`);
    const container = document.getElementById('acceptancesContainer');
    if (!container) return;
    if (!acceptances || !acceptances.length) {
        container.innerHTML = '<div class="empty-state"><p>暂无验收记录</p></div>';
        return;
    }
    const statusMap = { '待验收': 'badge-warning', '验收中': 'badge-info', '已通过': 'badge-success', '未通过': 'badge-danger' };
    container.innerHTML = `
                <div class="table-container">
                    <table class="table">
                        <thead><tr><th>类型</th><th>关联阶段</th><th>验收日期</th><th>通过率</th><th>状态</th><th>操作</th></tr></thead>
                        <tbody>
                            ${acceptances.map(a => `
                                <tr>
                                    <td><span class="badge badge-info">${a.acceptance_type}</span></td>
                                    <td>${a.stage_name || '-'}</td>
                                    <td>${a.acceptance_date || '-'}</td>
                                    <td>${a.pass_rate ? a.pass_rate + '%' : '-'}</td>
                                    <td>
                                        <select class="badge ${statusMap[a.status]}" style="border:none;cursor:pointer;" onchange="updateAcceptanceStatus(${a.id}, this.value)">
                                            <option value="待验收" ${a.status === '待验收' ? 'selected' : ''}>待验收</option>
                                            <option value="验收中" ${a.status === '验收中' ? 'selected' : ''}>验收中</option>
                                            <option value="已通过" ${a.status === '已通过' ? 'selected' : ''}>已通过</option>
                                            <option value="未通过" ${a.status === '未通过' ? 'selected' : ''}>未通过</option>
                                        </select>
                                    </td>
                                    <td><button class="btn btn-danger btn-xs" onclick="deleteAcceptance(${a.id})">删除</button></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
}

async function loadSatisfaction(pid) {
    const res = await fetch(`/api/projects/${pid}/satisfaction`);
    const records = await res.json();
    const container = document.getElementById('satisfactionContainer');

    // 获取统计
    const statsRes = await fetch(`/api/projects/${pid}/satisfaction/stats`);
    const stats = await statsRes.json();

    let html = '';
    if (stats.count > 0) {
        html += `
                    <div style="margin-bottom:20px;padding:16px;background:var(--gray-50);border-radius:10px;">
                        <div style="font-size:14px;font-weight:600;margin-bottom:12px;">满意度统计 (${stats.count}次调查)</div>
                        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;text-align:center;">
                            <div><div style="font-size:20px;font-weight:700;color:var(--primary);">${(stats.avg_quality || 0).toFixed(1)}</div><div style="font-size:11px;color:var(--gray-500);">系统质量</div></div>
                            <div><div style="font-size:20px;font-weight:700;color:var(--primary);">${(stats.avg_service || 0).toFixed(1)}</div><div style="font-size:11px;color:var(--gray-500);">服务态度</div></div>
                            <div><div style="font-size:20px;font-weight:700;color:var(--primary);">${(stats.avg_response || 0).toFixed(1)}</div><div style="font-size:11px;color:var(--gray-500);">响应速度</div></div>
                            <div><div style="font-size:20px;font-weight:700;color:var(--primary);">${(stats.avg_professional || 0).toFixed(1)}</div><div style="font-size:11px;color:var(--gray-500);">专业能力</div></div>
                            <div><div style="font-size:20px;font-weight:700;color:var(--success);">${(stats.avg_overall || 0).toFixed(1)}</div><div style="font-size:11px;color:var(--gray-500);">总体满意度</div></div>
                        </div>
                    </div>
                `;
    }

    if (!records.length) {
        html += '<div class="empty-state"><p>暂无满意度记录</p></div>';
    } else {
        html += records.map(r => `
                    <div style="border:1px solid var(--gray-200);border-radius:10px;padding:14px;margin-bottom:10px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                            <span style="font-weight:600;">${r.survey_date} - ${r.survey_type}</span>
                            <span style="font-size:12px;color:var(--gray-500);">调查人: ${r.surveyor || '-'}</span>
                        </div>
                        <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px;">
                            <span>质量: ${'★'.repeat(r.score_quality || 0)}${'☆'.repeat(5 - (r.score_quality || 0))}</span>
                            <span>服务: ${'★'.repeat(r.score_service || 0)}${'☆'.repeat(5 - (r.score_service || 0))}</span>
                            <span>响应: ${'★'.repeat(r.score_response || 0)}${'☆'.repeat(5 - (r.score_response || 0))}</span>
                            <span>专业: ${'★'.repeat(r.score_professional || 0)}${'☆'.repeat(5 - (r.score_professional || 0))}</span>
                            <span style="font-weight:600;">总体: ${'★'.repeat(r.score_overall || 0)}${'☆'.repeat(5 - (r.score_overall || 0))}</span>
                        </div>
                        ${r.feedback ? `<div style="margin-top:10px;padding:10px;background:var(--gray-50);border-radius:6px;font-size:13px;">${r.feedback}</div>` : ''}
                    </div>
                `).join('');
    }

    container.innerHTML = html;
}

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
function showStatusModal() {
    if (!currentProject) return;
    const statuses = ['待启动', '进行中', '试运行', '暂停', '离场待返', '已完成', '已验收', '质保期', '已终止'];
    const statusColors = {
        '待启动': '#94a3b8', '进行中': '#3b82f6', '试运行': '#f59e0b',
        '暂停': '#ef4444', '离场待返': '#8b5cf6', '已完成': '#22c55e',
        '已验收': '#06b6d4', '质保期': '#14b8a6', '已终止': '#6b7280'
    };
    const currentStatus = currentProject.status;
    const html = `
        <div class="modal show" id="statusModal" style="z-index:10001;">
            <div class="modal-content" style="max-width:420px;">
                <div class="modal-header">
                    <h3>变更项目状态</h3>
                    <button class="modal-close" onclick="document.getElementById('statusModal').remove()">&times;</button>
                </div>
                <div style="padding:20px;">
                    <p style="margin-bottom:12px;color:#64748b;">当前状态：<strong style="color:${statusColors[currentStatus]}">${currentStatus}</strong></p>
                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
                        ${statuses.map(s => `
                            <button onclick="changeProjectStatus('${s}')" 
                                style="padding:10px 8px;border-radius:8px;border:2px solid ${s === currentStatus ? statusColors[s] : '#e2e8f0'};
                                background:${s === currentStatus ? statusColors[s] + '20' : '#fff'};cursor:pointer;font-size:13px;font-weight:${s === currentStatus ? '700' : '500'};
                                color:${statusColors[s] || '#334155'};transition:all .2s;"
                                onmouseover="this.style.borderColor='${statusColors[s]}';this.style.background='${statusColors[s]}15'"
                                onmouseout="this.style.borderColor='${s === currentStatus ? statusColors[s] : '#e2e8f0'}';this.style.background='${s === currentStatus ? statusColors[s] + '20' : '#fff'}'"
                                ${s === currentStatus ? 'disabled' : ''}>
                                ${s}
                            </button>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
}

async function changeProjectStatus(newStatus) {
    if (!currentProject) return;
    try {
        await api.put(`/projects/${currentProject.id}/status`, { status: newStatus });
        const modal = document.getElementById('statusModal');
        if (modal) modal.remove();
        await loadProjectDetail(currentProject.id);
    } catch (e) {
        alert('状态变更失败: ' + e.message);
    }
}

// ========== 添加阶段 ==========
function showAddStageModal() {
    if (!currentProject) return;
    const today = new Date().toISOString().split('T')[0];
    const html = `
        <div class="modal show" id="addStageModal" style="z-index:10001;">
            <div class="modal-content" style="max-width:480px;">
                <div class="modal-header">
                    <h3>添加阶段</h3>
                    <button class="modal-close" onclick="document.getElementById('addStageModal').remove()">&times;</button>
                </div>
                <div style="padding:20px;">
                    <div class="form-group" style="margin-bottom:14px;">
                        <label style="font-weight:600;margin-bottom:4px;display:block;">阶段名称 *</label>
                        <select id="newStageName" style="width:100%;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;background:#fff;" onchange="if(this.value==='__custom__'){document.getElementById('customStageNameDiv').style.display='block'}else{document.getElementById('customStageNameDiv').style.display='none'}">
                            ${STAGE_NAMES.map(n => '<option value="' + n + '">' + n + '</option>').join('')}
                            <option value="__custom__">✏️ 自定义名称...</option>
                        </select>
                        <div id="customStageNameDiv" style="display:none;margin-top:8px;">
                            <input type="text" id="customStageName" placeholder="输入自定义阶段名称" style="width:100%;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;"/>
                        </div>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
                        <div class="form-group">
                            <label style="font-weight:600;margin-bottom:4px;display:block;">计划开始日期</label>
                            <input type="date" id="newStageStartDate" value="${today}" style="width:100%;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;"/>
                        </div>
                        <div class="form-group">
                            <label style="font-weight:600;margin-bottom:4px;display:block;">计划结束日期</label>
                            <input type="date" id="newStageEndDate" style="width:100%;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;"/>
                        </div>
                    </div>
                    <div class="form-group" style="margin-bottom:14px;">
                        <label style="font-weight:600;margin-bottom:4px;display:block;">任务项（每行一个）</label>
                        <textarea id="newStageTasks" rows="4" placeholder="任务1&#10;任务2&#10;任务3" style="width:100%;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;resize:vertical;"></textarea>
                    </div>
                    <button class="btn btn-primary" onclick="addNewStage()" style="width:100%;">确认添加</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
}

async function addNewStage() {
    let name = document.getElementById('newStageName').value;
    if (name === '__custom__') {
        name = document.getElementById('customStageName').value.trim();
    }
    if (!name) { alert('请输入阶段名称'); return; }
    const startDate = document.getElementById('newStageStartDate').value;
    const endDate = document.getElementById('newStageEndDate').value;
    const tasksText = document.getElementById('newStageTasks').value;
    const tasks = tasksText ? tasksText.split('\n').map(t => t.trim()).filter(t => t) : [];

    try {
        await api.post(`/projects/${currentProject.id}/stages`, {
            stage_name: name,
            plan_start_date: startDate,
            plan_end_date: endDate,
            tasks: tasks
        });
        document.getElementById('addStageModal').remove();
        await loadProjectDetail(currentProject.id, true);
    } catch (e) {
        alert('添加阶段失败: ' + e.message);
    }
}

// ========== 阶段和任务操作 ==========
function toggleStage(stageId) {
    const el = document.getElementById(`stage-${stageId}`);
    if (!el) return;

    // 统一转为数字存储，避免类型不一致导致 has() 失败
    const id = Number(stageId);

    if (el.classList.contains('expanded')) {
        el.classList.remove('expanded');
        expandedStages.delete(id);
    } else {
        el.classList.add('expanded');
        expandedStages.add(id);
    }
}

async function toggleTask(taskId, event) {
    event.stopPropagation();
    const checkbox = event.target;
    const taskItem = checkbox.closest('.task-item');
    const taskName = taskItem.querySelector('.task-name');

    checkbox.classList.toggle('checked');
    taskName.classList.toggle('completed');

    await fetch(`/api/tasks/${taskId}/toggle`, { method: 'POST' });

    const stageItem = checkbox.closest('.stage-item');
    if (stageItem) {
        const allTasks = stageItem.querySelectorAll('.task-checkbox');
        const completedTasks = stageItem.querySelectorAll('.task-checkbox.checked');
        const progress = allTasks.length > 0 ? Math.round(completedTasks.length / allTasks.length * 100) : 0;
        const progressBar = stageItem.querySelector('.stage-progress-mini-bar');
        const progressText = stageItem.querySelector('.stage-info > span:last-of-type');
        if (progressBar) progressBar.style.width = `${progress}%`;
        if (progressText && progressText.textContent.includes('%')) progressText.textContent = `${progress}%`;

        // 更新阶段状态标签
        const statusBadge = stageItem.querySelector('.stage-status-badge');
        if (statusBadge) {
            if (progress === 100) {
                statusBadge.outerHTML = '<span class="stage-status-badge" style="background:#ecfdf5;color:#059669;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;">✅ 已完成</span>';
            } else if (progress > 0) {
                statusBadge.outerHTML = '<span class="stage-status-badge" style="background:#eff6ff;color:#2563eb;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;">⏳ 进行中</span>';
            } else {
                statusBadge.outerHTML = '<span class="stage-status-badge" style="background:#f8fafc;color:#94a3b8;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;">⏸ 待开始</span>';
            }
        }
    }
    updateOverallProgress();
}

async function toggleMilestone(mid) {
    await fetch(`/api/milestones/${mid}/toggle`, { method: 'POST' });
    loadProjectDetail(currentProjectId, true);
}

async function updateOverallProgress() {
    if (!currentProjectId) return;
    try {
        const project = await api.get(`/projects/${currentProjectId}`);
        const progressCard = document.querySelector('.overview-card-value.progress-text');
        if (progressCard) progressCard.textContent = `${project.progress || 0}%`;
        currentProject = project;

        // 更新详情页状态标签
        const statusDetail = document.querySelector('.project-detail-status');
        if (statusDetail) {
            const statusColor = STATUS_COLORS[project.status] || '#9ca3af';
            statusDetail.style.backgroundColor = `${statusColor}20`; // Not ideal as it might not be a hex, but STATUS_COLORS are hex
            statusDetail.style.color = statusColor;
            statusDetail.textContent = project.status;
            statusDetail.className = `meta-item project-status project-detail-status status-${project.status}`;
        }

        const activeCard = document.querySelector('.project-card.active');
        if (activeCard) {
            const progressBar = activeCard.querySelector('.project-progress-bar');
            if (!progressBar) { // Some layouts use progress-mini-bar
                const miniBar = activeCard.querySelector('.progress-mini-bar');
                if (miniBar) miniBar.style.width = `${project.progress || 0}%`;
            } else {
                progressBar.style.width = `${project.progress || 0}%`;
            }
            const progressText = activeCard.querySelector('.project-progress-text span:first-child') || activeCard.querySelector('.project-card-footer span');
            if (progressText) {
                if (progressText.textContent.includes('进度')) {
                    progressText.textContent = `进度 ${project.progress || 0}%`;
                } else {
                    progressText.textContent = `${project.progress || 0}%`;
                }
            }

            // 更新列表项状态标签
            const statusList = activeCard.querySelector('.project-list-status');
            if (statusList) {
                const statusColor = STATUS_COLORS[project.status] || '#9ca3af';
                statusList.style.backgroundColor = `${statusColor}20`;
                statusList.style.color = statusColor;
                statusList.textContent = project.status;
            }
        }
    } catch (e) { console.error('更新进度失败', e); }
}

// ========== 视图切换工具 ==========
function hideAllViews() {
    const views = ['dashboardView', 'projectDetailView', 'mapView', 'analyticsView', 'approvalView', 'kbView', 'assetView', 'formGeneratorView', 'emptyState'];
    views.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
}

// ========== 仪表盘 ==========
async function showDashboard() {
    currentProjectId = null;
    renderProjectList();
    hideAllViews();
    document.getElementById('dashboardView').style.display = 'block';

    // 自动触发提醒检查
    // 自动触发提醒检查
    api.post('/check-and-create-reminders').catch(console.error);

    const [statsData, briefingData] = await Promise.all([
        api.get('/dashboard/stats'),
        api.get('/dashboard/global-briefing')
    ]);

    document.getElementById('dashboardView').innerHTML = `
                <div class="panel" style="background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%); color: white; border: none; margin-bottom: 20px;">
                    <div class="panel-body">
                        <div style="display: flex; align-items: center; gap: 15px;">
                            <div style="font-size: 32px;">🤖</div>
                            <div>
                                <h3 style="margin-bottom: 5px; font-size: 16px;">AI 交付决策简报</h3>
                                <p style="font-size: 14px; opacity: 0.9; line-height: 1.5; white-space: pre-line;">${briefingData.brief}</p>
                            </div>
                        </div>
                    </div>
                </div>
                <h2 style="margin-bottom:20px;font-size:22px;">📊 项目仪表盘</h2>

                <div class="dashboard-grid">
                    <div class="stat-card">
                        <div class="stat-icon blue">📊</div>
                        <div class="stat-value">${statsData.stats.total_projects}</div>
                        <div class="stat-label">项目总数</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon red">⏰</div>
                        <div class="stat-value">${statsData.stats.overdue_milestones || 0}</div>
                        <div class="stat-label">逾期里程碑</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon yellow">⚠️</div>
                        <div class="stat-value">${statsData.stats.delayed}</div>
                        <div class="stat-label">项目延期</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon pink">🚪</div>
                        <div class="stat-value">${statsData.stats.on_departure}</div>
                        <div class="stat-label">暂停/离场</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon red">🔥</div>
                        <div class="stat-value">${statsData.stats.critical_issues}</div>
                        <div class="stat-label">高危问题</div>
                    </div>
                </div>

                <div class="panel">
                    <div class="panel-header">
                        <div class="panel-title">📈 项目进度概览</div>
                        <button class="btn btn-outline btn-sm" onclick="checkReminders()">🔄 检查提醒</button>
                    </div>
                    <div class="panel-body" style="padding:0;">
                        ${statsData.projects_progress.length > 0 ? statsData.projects_progress.map(p => {
        const progressClass = p.progress < 30 ? 'low' : (p.progress < 70 ? 'medium' : 'high');
        const riskLevel = p.risk_score >= 50 ? 'high' : (p.risk_score >= 20 ? 'medium' : 'low');
        const riskText = p.risk_score >= 50 ? '高风险' : (p.risk_score >= 20 ? '中风险' : '稳健');
        const overdueText = p.overdue_count > 0 ? `<span class="badge badge-danger" style="margin-left:5px;">逾期 ${p.overdue_count}</span>` : '';

        return `
                                <div class="project-progress-row" onclick="loadProjectDetail(${p.id})">
                                    <div class="progress-project-name">${p.project_name} ${overdueText}</div>
                                    <div class="progress-hospital">${p.hospital_name} <span class="badge risk-${riskLevel}">${riskText}</span></div>
                                    <div class="progress-bar-container">
                                        <div class="progress-bar-track">
                                            <div class="progress-bar-fill ${progressClass}" style="width:${p.progress}%"></div>
                                        </div>
                                    </div>
                                    <div class="progress-percent">${p.progress}%</div>
                                    <div class="progress-status">
                                        <span class="badge ${p.phase === '延期' ? 'badge-danger' : p.phase === '离场' ? 'badge-pink' : 'badge-info'}">${p.phase}</span>
                                    </div>
                                </div>
                            `;

    }).join('') : '<div class="empty-state"><p>暂无进行中的项目</p></div>'}
                    </div>
                </div>
                <div class="panel">
                    <div class="panel-header">
                        <div class="panel-title">🔔 待处理提醒</div>
                    </div>
                    <div class="panel-body">
                        ${statsData.upcoming_reminders.length > 0 ? statsData.upcoming_reminders.map(r => `
                            <div class="reminder-item ${r.type}">
                                <div class="reminder-content">
                                    <div class="reminder-title">${r.title}</div>
                                    <div class="reminder-desc">${r.content || ''}</div>
                                    <div class="reminder-time">${r.project_name || '全局'} | ${r.due_date || '无截止'}</div>
                                </div>
                                <button class="btn btn-sm btn-outline" onclick="markNotificationRead(${r.id})">已读</button>
                            </div>
                        `).join('') : '<div class="empty-state"><p>暂无待处理提醒</p></div>'}
                    </div>
                </div>
            `;
}


// ========== 燃尽图 ==========
async function showBurndownChart(pid) {
    if (typeof openModal === 'function') {
        openModal('burndownModal');
    } else {
        const modal = document.getElementById('burndownModal');
        if (modal) {
            modal.classList.add('show');
            modal.style.display = 'flex';
        }
    }

    const chartDom = document.getElementById('burndownChart');
    // Clear previous instance
    try {
        if (echarts.getInstanceByDom(chartDom)) {
            echarts.dispose(chartDom);
        }
    } catch (e) { }

    try {
        const res = await fetch(`/api/projects/${pid}/burndown`);
        const result = await res.json();

        let chartData = result;
        if (result.success && result.data) {
            chartData = result.data;
        } else if (result.data) {
            chartData = result.data;
        }

        if (!chartData || (!chartData.ideal_line && !chartData.actual_line)) {
            chartDom.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100%;color:#666;">暂无数据</div>';
            return;
        }

        // Merge all dates from both lines into a unified sorted axis
        const idealDates = (chartData.ideal_line || []).map(d => d.date);
        const actualDates = (chartData.actual_line || []).map(d => d.date);
        const allDatesSet = new Set([...idealDates, ...actualDates]);
        const allDates = Array.from(allDatesSet).sort();

        // Build lookup maps
        const idealMap = {};
        (chartData.ideal_line || []).forEach(d => { idealMap[d.date] = d.value; });
        const actualMap = {};
        (chartData.actual_line || []).forEach(d => { actualMap[d.date] = d.value; });

        // Map each series to the unified axis
        const idealValues = allDates.map(d => idealMap[d] !== undefined ? idealMap[d] : null);
        const actualValues = allDates.map(d => actualMap[d] !== undefined ? actualMap[d] : null);

        const myChart = echarts.init(chartDom);
        const option = {
            tooltip: { trigger: 'axis' },
            legend: { data: ['理想进度', '实际进度'], bottom: 0 },
            grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
            xAxis: {
                type: 'category',
                boundaryGap: false,
                data: allDates
            },
            yAxis: { type: 'value', name: '剩余任务数' },
            series: [
                {
                    name: '理想进度',
                    type: 'line',
                    data: idealValues,
                    connectNulls: true,
                    lineStyle: { color: '#3b82f6', type: 'dashed' },
                    itemStyle: { color: '#3b82f6' }
                },
                {
                    name: '实际进度',
                    type: 'line',
                    data: actualValues,
                    connectNulls: true,
                    lineStyle: { color: '#10b981', width: 2 },
                    itemStyle: { color: '#10b981' },
                    areaStyle: { color: 'rgba(16, 185, 129, 0.1)' }
                }
            ]
        };
        myChart.setOption(option);

        // Resize handler
        const resizeHandler = () => myChart.resize();
        window.addEventListener('resize', resizeHandler);
        // Store handler to remove later if needed? For now it's fine.

    } catch (e) {
        console.error('Burndown Chart Error:', e);
        chartDom.innerHTML = `<div style="display:flex;justify-content:center;align-items:center;height:100%;color:red;">加载失败: ${e.message}</div>`;
    }
}

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

async function loadSatisfaction(pid) {
    const records = await api.get(`/projects/${pid}/satisfaction`);
    const container = document.getElementById('satisfactionContainer');
    if (!container) return;
    if (!records || !records.length) {
        container.innerHTML = '<div class="empty-state"><p>暂无评价记录</p></div>';
        return;
    }
    container.innerHTML = records.map(r => `
        <div class="satisfaction-item">
            <div class="satisfaction-score">满意度: ${r.score} / 5</div>
            <div class="satisfaction-comment">${r.comment || '无评论'}</div>
            <div class="satisfaction-meta">
                <span>${r.evaluator_name || '匿名'}</span>
                <span>${r.evaluated_at}</span>
            </div>
        </div>
    `).join('');
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
    //     alert(`已创建 ${data.created.length} 条提醒`);
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

async function generateWeeklyReport(pid, forceRefresh = false) {
    console.log('[DEBUG] generateWeeklyReport called for PID:', pid);
    currentReportProjectId = pid;
    openModal('reportModal');

    const loadingEl = document.getElementById('reportLoading');
    const contentEl = document.getElementById('reportContent');
    if (loadingEl) loadingEl.style.display = 'block';
    if (contentEl) contentEl.style.display = 'none';

    try {
        const endpoint = `/projects/${pid}/weekly-report${forceRefresh ? '?force=1' : ''}`;
        console.log('[DEBUG] Sending report API request');
        const data = await api.post(endpoint);
        console.log('[DEBUG] Report API received');

        if (data.task_id) {
            pollTask(data.task_id, 'reportLoading', 'reportContent', 'weekly', (result) => {
                if (contentEl) contentEl.innerHTML = renderBeautifulReport(result, 'weekly');
                if (loadingEl) loadingEl.style.display = 'none';
                if (contentEl) contentEl.style.display = 'block';
            });
        } else {
            let cacheHint = data.cached ? `<div class="cache-hint"><span class="icon">💾</span><span>此周报为缓存版本 (${data.cached_at})。</span></div>` : '';
            if (contentEl) contentEl.innerHTML = cacheHint + renderBeautifulReport(data.report, 'weekly');
            if (loadingEl) loadingEl.style.display = 'none';
            if (contentEl) contentEl.style.display = 'block';
        }
    } catch (e) {
        console.error('[DEBUG] Report Generation Failed:', e);
        if (contentEl) contentEl.innerHTML = `<p style="color:red;">请求失败: ${e.message}</p>`;
        if (loadingEl) loadingEl.style.display = 'none';
        if (contentEl) contentEl.style.display = 'block';
    }
}

function refreshWeeklyReport() {
    if (currentReportProjectId) generateWeeklyReport(currentReportProjectId, true);
    else generateAllReport(true);
}

async function generateAiWeeklySummary() {
    if (!currentReportProjectId) {
        alert('无法获取项目 ID');
        return;
    }

    const btn = document.querySelector('.btn-ai');
    const originalText = btn.innerHTML;
    // 使用 Loading Spinner
    btn.innerHTML = '<span class="loading-spinner-sm"></span> 正在深度思考中...';
    btn.disabled = true;

    // 显示全局提示
    if (window.showToast) showToast('AI 正在分析项目数据，请稍候...', 'info', 5000);

    try {
        const res = await api.post('/ai/summarize-weekly', { project_id: currentReportProjectId });
        const summary = res.summary;

        // 将总结插入到报告内容的开头或作为一部分
        const reportContent = document.getElementById('reportContent');
        const summaryHtml = `
            <div class="ai-summary-box" style="margin-bottom:20px; padding:15px; background:#f0f7ff; border-left:4px solid #3b82f6; border-radius:4px; animation: fadeIn 0.5s;">
                <div style="font-weight:600; color:#1d4ed8; margin-bottom:8px; display:flex; align-items:center; gap:8px;">
                    <span style="font-size:1.2em">🤖</span>
                    <span>AI 核心总结</span>
                    <span class="badge badge-info" style="font-size:0.8em; margin-left:auto;">DeepSeek-V3</span>
                </div>
                <div style="font-size:14px; line-height:1.6; color:#1e40af;">${marked.parse(summary)}</div>
            </div>
        `;

        // 如果已经存在 AI 总结，则替换它，否则在前部插入
        const existingSummary = reportContent.querySelector('.ai-summary-box');
        if (existingSummary) {
            existingSummary.outerHTML = summaryHtml;
        } else {
            reportContent.innerHTML = summaryHtml + reportContent.innerHTML;
        }

        if (window.showToast) showToast('AI 总结生成完成', 'success');

    } catch (e) {
        console.error(e);
        let errorMsg = e.message;
        if (errorMsg === 'Failed to fetch') errorMsg = '网络连接失败或服务器正在重启，请稍后重试';
        alert('AI 总结生成失败: ' + errorMsg);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function generateAllReport(forceRefresh = false) {
    currentReportProjectId = null;
    showModal('reportModal');
    document.getElementById('reportLoading').style.display = 'block';
    document.getElementById('reportContent').style.display = 'none';
    try {
        const endpoint = `/weekly-report/all${forceRefresh ? '?force=1' : ''}`;
        const data = await api.post(endpoint);

        if (data.task_id) {
            pollTask(data.task_id, 'reportLoading', 'reportContent', 'weekly', (result) => {
                document.getElementById('reportContent').innerHTML = renderBeautifulReport(result, 'weekly');
                document.getElementById('reportLoading').style.display = 'none';
                document.getElementById('reportContent').style.display = 'block';
            });
        } else {
            let cacheHint = data.cached ? `<div class="cache-hint"><span class="icon">💾</span><span>此周报为缓存版本 (${data.cached_at})。</span></div>` : '';
            document.getElementById('reportContent').innerHTML = cacheHint + renderBeautifulReport(data.report, 'weekly');
            document.getElementById('reportLoading').style.display = 'none';
            document.getElementById('reportContent').style.display = 'block';
        }
    } catch (e) {
        document.getElementById('reportContent').innerHTML = `<p style="color:red;">请求失败: ${e.message}</p>`;
        document.getElementById('reportLoading').style.display = 'none';
        document.getElementById('reportContent').style.display = 'block';
    }
}

function renderBeautifulReport(markdown, type) {
    if (!markdown) return '<div class="error-msg">无报告内容</div>';
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
            const parsedContent = marked.parse(trimmedSection);
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
                    ${marked.parse(sectionContent)}
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
    let cleanedMarkdown = markdown;

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

// ========== 脉动标签辅助函数 ==========
async function renderBurndownInDetail(pid) {
    const burndownTabEl = document.getElementById('pulseBurndownChartInDetail');
    if (!burndownTabEl) return;

    try {
        const res = await fetch(`/api/projects/${pid}/burndown`);
        let data = await res.json();

        // Handle wrapped response format
        if (data.success && data.data) data = data.data;
        else if (data.data) data = data.data;

        if (!data || (!data.ideal_line && !data.actual_line)) {
            burndownTabEl.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100%;color:#999;">暂无燃尽图数据</div>';
            return;
        }

        // Merge all dates from both lines into a unified sorted axis
        const idealDates = (data.ideal_line || []).map(d => d.date);
        const actualDates = (data.actual_line || []).map(d => d.date);
        const allDatesSet = new Set([...idealDates, ...actualDates]);
        const allDates = Array.from(allDatesSet).sort();

        // Build lookup maps for quick access
        const idealMap = {};
        (data.ideal_line || []).forEach(d => { idealMap[d.date] = d.value; });
        const actualMap = {};
        (data.actual_line || []).forEach(d => { actualMap[d.date] = d.value; });

        // Map each series to the unified axis, using null for missing dates
        const idealValues = allDates.map(d => idealMap[d] !== undefined ? idealMap[d] : null);
        const actualValues = allDates.map(d => actualMap[d] !== undefined ? actualMap[d] : null);

        const myChart = echarts.init(burndownTabEl);
        const option = {
            tooltip: { trigger: 'axis' },
            legend: { data: ['理想进度', '实际进度'], bottom: 0 },
            grid: { left: '3%', right: '4%', top: '10%', bottom: '15%', containLabel: true },
            xAxis: { type: 'category', boundaryGap: false, data: allDates },
            yAxis: { type: 'value', name: '剩余任务' },
            series: [
                { name: '理想进度', type: 'line', data: idealValues, connectNulls: true, lineStyle: { color: '#3b82f6', type: 'dashed' }, itemStyle: { color: '#3b82f6' } },
                { name: '实际进度', type: 'line', data: actualValues, connectNulls: true, lineStyle: { color: '#10b981', width: 2 }, itemStyle: { color: '#10b981' }, areaStyle: { color: 'rgba(16, 185, 129, 0.1)' } }
            ]
        };
        myChart.setOption(option);
        window.addEventListener('resize', () => myChart.resize());
    } catch (e) {
        console.error('Burndown in detail error:', e);
        burndownTabEl.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100%;color:red;">加载失败</div>';
    }
}

function copyReportContent(elementId) {
    const content = document.getElementById(elementId).innerText;
    navigator.clipboard.writeText(content).then(() => alert('内容已复制'));
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

async function showInterfaceModal() {
    document.getElementById('interfaceForm').reset();
    // 填充智能模板选择器
    await populateInterfaceTemplateSelect();
    showModal('interfaceModal');
}

function showDepartureModal() {
    document.getElementById('departureForm').reset();
    document.getElementById('departureDate').value = new Date().toISOString().split('T')[0];
    showModal('departureModal');
}

function showWorklogModal() {
    document.getElementById('worklogForm').reset();
    document.getElementById('logDate').value = new Date().toISOString().split('T')[0];
    showModal('worklogModal');
}

function showAcceptanceModal() {
    document.getElementById('acceptanceForm').reset();
    document.getElementById('acceptanceDate').value = new Date().toISOString().split('T')[0];
    // 填充阶段选项
    const stageSelect = document.getElementById('acceptanceStageName');
    stageSelect.innerHTML = '<option value="">-- 请选择 --</option>';
    if (currentProject && currentProject.stages) {
        currentProject.stages.forEach(s => {
            stageSelect.innerHTML += `<option value="${s.stage_name}">${s.stage_name}</option>`;
        });
    }
    showModal('acceptanceModal');
}

function showStatusModal() {
    if (!currentProject) return;
    document.getElementById('currentStatusText').textContent = currentProject.status;
    const container = document.getElementById('availableStatusList');
    const nextStatuses = {
        '待启动': ['进行中'],
        '进行中': ['试运行', '暂停', '离场待返'],
        '试运行': ['验收中', '进行中'],
        '验收中': ['已验收', '试运行'],
        '已验收': ['质保期'],
        '质保期': ['已完成'],
        '暂停': ['进行中', '离场待返', '已终止'],
        '离场待返': ['进行中', '已终止'],
        '已终止': [],
        '已完成': []
    };
    const available = nextStatuses[currentProject.status] || [];
    if (available.length === 0) {
        container.innerHTML = '<p style="color:var(--gray-500);">当前状态无法变更</p>';
    } else {
        container.innerHTML = available.map(s => `
                    <button class="btn btn-outline" style="justify-content:flex-start;border-left:4px solid ${STATUS_COLORS[s]};" onclick="changeProjectStatus('${s}')">${s}</button>
                `).join('');
    }
    showModal('statusModal');
}

// ========== 保存函数 ==========
async function saveProject() {
    const data = {
        project_name: document.getElementById('projectName').value,
        hospital_name: document.getElementById('hospitalName').value,
        contract_no: document.getElementById('contractNo').value,
        project_manager: document.getElementById('projectManager').value,
        priority: document.getElementById('projectPriority').value,
        plan_start_date: document.getElementById('planStartDate').value,
        plan_end_date: document.getElementById('planEndDate').value,
        contact_person: document.getElementById('contactPerson').value,
        contact_phone: document.getElementById('contactPhone').value,
        icu_beds: document.getElementById('icuBeds').value || 0,
        operating_rooms: document.getElementById('operatingRooms').value || 0,
        pacu_beds: document.getElementById('pacuBeds').value || 0
    };
    if (!data.project_name || !data.hospital_name) { alert('请填写项目名称和医院名称'); return; }
    await api.post('/projects', data);
    closeModal('projectModal');
    loadProjects();
}

async function saveDeparture() {
    const data = {
        departure_type: document.getElementById('departureType').value,
        departure_date: document.getElementById('departureDate').value,
        expected_return_date: document.getElementById('expectedReturnDate').value,
        handover_person: document.getElementById('handoverPerson').value,
        our_persons: document.getElementById('ourPersons').value,
        reason: document.getElementById('departureReason').value,
        doc_handover: document.getElementById('docHandover').checked,
        account_handover: document.getElementById('accountHandover').checked,
        training_handover: document.getElementById('trainingHandover').checked,
        issue_handover: document.getElementById('issueHandover').checked,
        contact_handover: document.getElementById('contactHandover').checked,
        pending_issues: document.getElementById('pendingIssues').value,
        remote_support_info: document.getElementById('remoteSupportInfo').value,
        remark: document.getElementById('departureRemark').value
    };
    if (!data.departure_date) { alert('请填写离场日期'); return; }
    await api.post(`/projects/${currentProjectId}/departures`, data);
    closeModal('departureModal');
    loadProjects();
    loadProjectDetail(currentProjectId, true);
}

async function recordReturn(departureId) {
    if (!confirm('确认记录返场？项目状态将变更为"进行中"')) return;
    await api.post(`/departures/${departureId}/return`, { return_date: new Date().toISOString().split('T')[0] });
    loadProjects();
    loadProjectDetail(currentProjectId, true);
}

async function saveMember() {
    const data = {
        name: document.getElementById('memberName').value,
        role: document.getElementById('memberRole').value,
        phone: document.getElementById('memberPhone').value,
        email: document.getElementById('memberEmail').value,
        join_date: document.getElementById('memberJoinDate').value,
        current_city: document.getElementById('memberCity').value,
        is_onsite: document.getElementById('memberOnsite').value === '1'
    };
    if (!data.name) { alert('请填写姓名'); return; }
    await api.post(`/projects/${currentProjectId}/members`, data);
    closeModal('memberModal');
    loadProjectDetail(currentProjectId, true);
}

async function saveContact() {
    const data = {
        name: document.getElementById('contactName').value,
        department: document.getElementById('contactDepartment').value,
        position: document.getElementById('contactPosition').value,
        phone: document.getElementById('contactPhoneInput').value,
        email: document.getElementById('contactEmail').value,
        is_primary: document.getElementById('contactPrimary').value === '1'
    };
    if (!data.name) { alert('请填写姓名'); return; }
    await api.post(`/projects/${currentProjectId}/contacts`, data);
    closeModal('contactModal');
    loadProjectDetail(currentProjectId, true);
}

async function saveWorklog() {
    const data = {
        log_date: document.getElementById('logDate').value,
        work_hours: document.getElementById('workHours').value || 8,
        work_type: document.getElementById('workType').value,
        member_name: document.getElementById('logMemberName').value,
        work_content: document.getElementById('workContent').value,
        issues_encountered: document.getElementById('issuesEncountered').value,
        tomorrow_plan: document.getElementById('tomorrowPlan').value
    };
    if (!data.work_content) { alert('请填写工作内容'); return; }
    await api.post(`/projects/${currentProjectId}/worklogs`, data);
    closeModal('worklogModal');
    loadWorklogs(currentProjectId);
}

async function saveExpense() {
    const data = {
        expense_date: document.getElementById('expenseDate').value,
        expense_type: document.getElementById('expenseType').value,
        amount: parseFloat(document.getElementById('expenseAmount').value) || 0,
        description: document.getElementById('expenseDesc').value,
        applicant: document.getElementById('expenseApplicant').value
    };
    if (!data.amount) { alert('请填写金额'); return; }
    await api.post(`/projects/${currentProjectId}/expenses`, data);
    closeModal('expenseModal');
    loadExpenses(currentProjectId);
}

async function saveChange() {
    const data = {
        change_type: document.getElementById('changeType').value,
        change_title: document.getElementById('changeTitle').value,
        change_desc: document.getElementById('changeDesc').value,
        impact_analysis: document.getElementById('changeImpact').value,
        requested_by: document.getElementById('changeRequestedBy').value
    };
    if (!data.change_title) { alert('请填写变更标题'); return; }
    await api.post(`/projects/${currentProjectId}/changes`, data);
    closeModal('changeModal');
    loadChanges(currentProjectId);
}

async function saveAcceptance() {
    const data = {
        acceptance_type: document.getElementById('acceptanceType').value,
        stage_name: document.getElementById('acceptanceStageName').value,
        acceptance_date: document.getElementById('acceptanceDate').value,
        pass_rate: document.getElementById('acceptancePassRate').value,
        customer_sign: document.getElementById('acceptanceCustomerSign').value,
        our_sign: document.getElementById('acceptanceOurSign').value,
        issues_found: document.getElementById('acceptanceIssues').value,
        remark: document.getElementById('acceptanceRemark').value
    };
    await api.post(`/projects/${currentProjectId}/acceptances`, data);
    closeModal('acceptanceModal');
    loadAcceptances(currentProjectId);
}

async function saveSatisfaction() {
    const data = {
        survey_type: document.getElementById('surveyType').value,
        surveyor: document.getElementById('surveyor').value,
        score_quality: parseInt(document.getElementById('ratingQuality').dataset.score) || 0,
        score_service: parseInt(document.getElementById('ratingService').dataset.score) || 0,
        score_response: parseInt(document.getElementById('ratingResponse').dataset.score) || 0,
        score_professional: parseInt(document.getElementById('ratingProfessional').dataset.score) || 0,
        score_overall: parseInt(document.getElementById('ratingOverall').dataset.score) || 0,
        feedback: document.getElementById('satisfactionFeedback').value
    };
    await api.post(`/projects/${currentProjectId}/satisfaction`, data);
    closeModal('satisfactionModal');
    initStarRatings();
    loadSatisfaction(currentProjectId);
}

// ========== 接口模板智能推荐 ==========
let interfaceTemplatesCache = null;

function getProjectCategory() {
    // 根据当前项目的 ICU 床位和手术室数量判断项目类型
    if (!currentProject) return 'common';
    const hasICU = (currentProject.icu_beds || 0) > 0;
    const hasOR = (currentProject.operating_rooms || 0) > 0;

    if (hasICU && hasOR) return 'both';      // 重症+手麻
    if (hasICU) return 'icu';                 // 纯重症
    if (hasOR) return 'anesthesia';           // 纯手麻
    return 'common';                          // 默认通用
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
    // 根据项目类型过滤模板
    if (category === 'both') {
        // 重症+手麻：返回所有模板
        return templates;
    } else if (category === 'icu') {
        // 纯重症：返回 ICU + 通用模板
        return templates.filter(t => t.category === 'icu' || t.category === 'common');
    } else if (category === 'anesthesia') {
        // 纯手麻：返回手麻 + 通用模板
        return templates.filter(t => t.category === 'anesthesia' || t.category === 'common');
    }
    // 默认返回通用模板
    return templates.filter(t => t.category === 'common');
}

async function populateInterfaceTemplateSelect() {
    const select = document.getElementById('interfaceTemplateSelect');
    if (!select) return;

    const templates = await loadInterfaceTemplates();
    const category = getProjectCategory();
    const filtered = getFilteredTemplates(templates, category);

    // 按类型分组
    const groups = {
        'icu': { label: '🏥 重症(ICU)接口', items: [] },
        'anesthesia': { label: '💉 手麻接口', items: [] },
        'common': { label: '🔗 通用接口', items: [] }
    };

    filtered.forEach(t => {
        if (groups[t.category]) {
            groups[t.category].items.push(t);
        }
    });

    let html = '<option value="">-- 选择接口模板 --</option>';

    for (const [key, group] of Object.entries(groups)) {
        if (group.items.length > 0) {
            html += `<optgroup label="${group.label}">`;
            group.items.forEach(t => {
                const importantMark = t.important ? '⭐ ' : '';
                const viewMark = t.view_name ? ` [${t.view_name}]` : '';
                html += `<option value="${t.id}">${importantMark}${t.interface_name}${viewMark}</option>`;
            });
            html += '</optgroup>';
        }
    }

    select.innerHTML = html;

    // 显示项目类型提示
    const categoryHint = document.getElementById('interfaceCategoryHint');
    if (categoryHint) {
        const categoryNames = {
            'both': '重症+手麻',
            'icu': '重症(ICU)',
            'anesthesia': '手术麻醉',
            'common': '通用'
        };
        categoryHint.textContent = `当前项目类型: ${categoryNames[category] || '未知'}`;
    }
}

async function applyInterfaceTemplate(templateId) {
    if (!templateId) return;
    try {
        const templates = await loadInterfaceTemplates();
        const template = templates.find(t => t.id === templateId);
        if (template) {
            document.getElementById('systemName').value = template.system_name;
            document.getElementById('interfaceName').value = template.interface_name;
            let remark = template.remark;
            if (template.view_name) remark = `视图: ${template.view_name}\n${remark}`;
            if (template.protocol) remark += `\n建议协议: ${template.protocol}`;
            document.getElementById('interfaceRemark').value = remark;
        }
    } catch (e) {
        console.error('更新阶段失败', e);
    }
}


async function batchAddRecommendedInterfaces() {
    if (!currentProjectId) {
        alert('请先选择项目');
        return;
    }

    const templates = await loadInterfaceTemplates();
    const category = getProjectCategory();
    const filtered = getFilteredTemplates(templates, category);

    // 只添加"重要"标记的接口，或者让用户选择
    const importantOnly = confirm('是否只添加标记为"重要"的核心接口？\n\n点击"确定"添加核心接口\n点击"取消"添加全部推荐接口');

    const toAdd = importantOnly ? filtered.filter(t => t.important) : filtered;

    if (toAdd.length === 0) {
        alert('没有可添加的接口');
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

    alert(`成功添加 ${successCount}/${toAdd.length} 个接口`);
    loadProjectDetail(currentProjectId, true);
}

async function saveFollowup() {
    const data = {
        follow_up_date: document.getElementById('followupDate').value,
        follow_up_type: document.getElementById('followupType').value,
        contact_person: document.getElementById('followupContactPerson').value,
        follow_up_by: document.getElementById('followupBy').value,
        content: document.getElementById('followupContent').value,
        issues_found: document.getElementById('followupIssues').value,
        next_follow_up_date: document.getElementById('nextFollowupDate').value
    };
    await api.post(`/projects/${currentProjectId}/followups`, data);
    closeModal('followupModal');
    loadSatisfaction(currentProjectId);
}

async function saveInterface() {
    const data = {
        system_name: document.getElementById('systemName').value,
        interface_name: document.getElementById('interfaceName').value,
        status: document.getElementById('interfaceStatus').value,
        remark: document.getElementById('interfaceRemark').value
    };
    await api.post(`/projects/${currentProjectId}/interfaces`, data);
    closeModal('interfaceModal');
    loadProjectDetail(currentProjectId, true);
}

async function saveIssue() {
    const data = {
        issue_type: document.getElementById('issueType').value,
        severity: document.getElementById('issueSeverity').value,
        description: document.getElementById('issueDesc').value
    };
    if (!data.description) { alert('请填写问题描述'); return; }
    await api.post(`/projects/${currentProjectId}/issues`, data);
    closeModal('issueModal');
    loadProjectDetail(currentProjectId, true);
}

async function saveDevice() {
    const data = {
        device_type: document.getElementById('deviceType').value,
        brand_model: document.getElementById('deviceModel').value,
        protocol_type: document.getElementById('deviceProtocol').value,
        ip_address: document.getElementById('deviceIp').value,
        status: document.getElementById('deviceStatus').value
    };
    await api.post(`/projects/${currentProjectId}/devices`, data);
    closeModal('deviceModal');
    loadDevices(currentProjectId);
}

async function saveMilestone() {
    const data = {
        name: document.getElementById('milestoneName').value,
        target_date: document.getElementById('milestoneDate').value
    };
    if (!data.name || !data.target_date) { alert('请填写完整'); return; }
    await api.post(`/projects/${currentProjectId}/milestones`, data);
    closeModal('milestoneModal');
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

    await fetch(`/api/projects/${currentProjectId}/documents`, { method: 'POST', body: formData });
    closeModal('documentModal');
    loadDocuments(currentProjectId);
}

// ========== 删除函数 ==========
async function deleteProject(pid) {
    if (!confirm('确定删除此项目？所有数据将被清除！')) return;
    await api.delete(`/projects/${pid}`);
    currentProjectId = null;
    currentProject = null;
    document.getElementById('projectDetailView').style.display = 'none';
    document.getElementById('emptyState').style.display = 'block';
    loadProjects();
}

async function deleteMember(mid) {
    if (!confirm('确定删除？')) return;
    await api.delete(`/members/${mid}`);
    loadProjectDetail(currentProjectId, true);
}

async function deleteContact(cid) {
    if (!confirm('确定删除？')) return;
    await api.delete(`/contacts/${cid}`);
    loadProjectDetail(currentProjectId, true);
}

async function deleteInterface(iid) {
    if (!confirm('确定删除？')) return;
    await api.delete(`/projects/interfaces/${iid}`);
    loadProjectDetail(currentProjectId, true);
}

async function deleteIssue(iid) {
    if (!confirm('确定删除？')) return;
    await api.delete(`/issues/${iid}`);
    loadProjectDetail(currentProjectId, true);
}

async function deleteDevice(did) {
    if (!confirm('确定删除？')) return;
    await api.delete(`/devices/${did}`);
    loadDevices(currentProjectId);
}

async function deleteMilestone(mid) {
    if (!confirm('确定删除？')) return;
    await api.delete(`/milestones/${mid}`);
    loadProjectDetail(currentProjectId, true);
}

async function deleteDocument(did) {
    if (!confirm('确定删除？')) return;
    await api.delete(`/documents/${did}`);
    loadDocuments(currentProjectId);
}

async function deleteExpense(eid) {
    if (!confirm('确定删除？')) return;
    await api.delete(`/expenses/${eid}`);
    loadExpenses(currentProjectId);
}

async function deleteChange(cid) {
    if (!confirm('确定删除？')) return;
    await api.delete(`/changes/${cid}`);
    loadChanges(currentProjectId);
}

async function deleteAcceptance(aid) {
    if (!confirm('确定删除？')) return;
    await api.delete(`/acceptances/${aid}`);
    loadAcceptances(currentProjectId);
}

function downloadDocument(did) {
    window.open(`/api/documents/${did}/download`, '_blank');
}

// ========== 更新函数 ==========
async function updateIssueStatus(issueId, newStatus) {
    await api.put(`/issues/${issueId}`, { status: newStatus });
    loadProjectDetail(currentProjectId, true);
}

async function updateInterfaceStatus(interfaceId, newStatus) {
    await api.put(`/projects/interfaces/${interfaceId}`, { status: newStatus });
    loadProjectDetail(currentProjectId, true);
}

async function updateAcceptanceStatus(acceptanceId, newStatus) {
    await api.put(`/acceptances/${acceptanceId}`, { status: newStatus });
    loadAcceptances(currentProjectId);
    if (newStatus === '已通过') {
        loadProjects();
        loadProjectDetail(currentProjectId, true);
    }
}

async function changeProjectStatus(newStatus) {
    if (!confirm(`确定将项目状态变更为"${newStatus}"？`)) return;
    await api.put(`/projects/${currentProjectId}/status`, { status: newStatus });
    closeModal('statusModal');
    loadProjects();
    loadProjectDetail(currentProjectId);
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal.show').forEach(m => m.classList.remove('show'));
    }
});

async function showApprovalCenter() {
    currentProjectId = null;
    hideAllViews();
    document.getElementById('approvalView').style.display = 'block';


    const res = await api.get('/approvals/pending');
    const container = document.getElementById('approvalListContainer');

    if (!res.changes.length && !res.departures.length) {
        container.innerHTML = '<div class="empty-state"><p>✅ 暂无待审批事项</p></div>';
        return;
    }

    container.innerHTML = `
        <div class="table-container">
            <table class="table">
                <thead>
                    <tr>
                        <th>类型</th>
                        <th>项目/医院</th>
                        <th>内容/标题</th>
                        <th>申请人</th>
                        <th>操作</th>
                    </tr>
                </thead>
                <tbody>
                    ${res.changes.map(c => `
                        <tr>
                            <td><span class="badge badge-purple">变更申请</span></td>
                            <td>
                                <div style="font-weight:600;">${c.project_name}</div>
                                <div style="font-size:11px;color:var(--gray-500);">${c.hospital_name}</div>
                            </td>
                            <td>
                                <div style="font-weight:500;">${c.change_title}</div>
                                <div style="font-size:12px;color:var(--gray-600);">${c.change_type}</div>
                            </td>
                            <td>${c.requested_by || '-'}</td>
                            <td>
                                <div class="btn-group">
                                    <button class="btn btn-success btn-sm" onclick="handleApproval('change', ${c.id}, '已批准')">批准</button>
                                    <button class="btn btn-danger btn-sm" onclick="handleApproval('change', ${c.id}, '已驳回')">驳回</button>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

async function handleApproval(type, id, status) {
    if (!confirm(`确认要将此项标记为 ${status} 吗？`)) return;

    try {
        if (type === 'change') {
            await api.put(`/changes/${id}`, { status: status });
        }
        showApprovalCenter();
        showToast('操作成功');
    } catch (e) {
        showToast('操作失败: ' + e.message, 'danger');
    }
}


function hideAllViews() {
    const views = ['dashboardView', 'projectDetailView', 'mapView', 'analyticsView', 'approvalView', 'kbView', 'assetView', 'formGeneratorView', 'emptyState'];
    views.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
}

async function showDashboard() {
    currentProjectId = null;
    hideAllViews();
    document.getElementById('dashboardView').style.display = 'block';
    renderProjectList();

    api.post('/check-and-create-reminders').catch(console.error);

    const data = await api.get('/dashboard/stats');

    document.getElementById('dashboardView').innerHTML = `
                <h2 style="margin-bottom:20px;font-size:22px;">📊 项目仪表盘</h2>
                <div class="dashboard-grid">
                    <div class="stat-card">
                        <div class="stat-icon blue">📊</div>
                        <div class="stat-value">${data.stats.total_projects}</div>
                        <div class="stat-label">项目总数</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon red">⏰</div>
                        <div class="stat-value">${data.stats.overdue_milestones || 0}</div>
                        <div class="stat-label">逾期里程碑</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon yellow">⚠️</div>
                        <div class="stat-value">${data.stats.delayed}</div>
                        <div class="stat-label">项目延期</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon pink">🚪</div>
                        <div class="stat-value">${data.stats.on_departure}</div>
                        <div class="stat-label">暂停/离场</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon red">🔥</div>
                        <div class="stat-value">${data.stats.critical_issues}</div>
                        <div class="stat-label">高危问题</div>
                    </div>
                </div>
                <div class="panel">
                    <div class="panel-header">
                        <div class="panel-title">📈 项目进度概览</div>
                        <button class="btn btn-outline btn-sm" onclick="checkReminders()">🔄 检查提醒</button>
                    </div>
                    <div class="panel-body" style="padding:0;">
                        ${data.projects_progress.length > 0 ? data.projects_progress.map(p => {
        const progressClass = p.progress < 30 ? 'low' : (p.progress < 70 ? 'medium' : 'high');
        const riskLevel = p.risk_score >= 50 ? 'high' : (p.risk_score >= 20 ? 'medium' : 'low');
        const riskText = p.risk_score >= 50 ? '高风险' : (p.risk_score >= 20 ? '中风险' : '稳健');
        const overdueText = p.overdue_count > 0 ? `<span class="badge badge-danger" style="margin-left:5px;">逾期 ${p.overdue_count}</span>` : '';

        return `
                                <div class="project-progress-row" onclick="loadProjectDetail(${p.id})">
                                    <div class="progress-project-name">${p.project_name} ${overdueText}</div>
                                    <div class="progress-hospital">${p.hospital_name} <span class="badge risk-${riskLevel}">${riskText}</span></div>
                                    <div class="progress-bar-container">
                                        <div class="progress-bar-track">
                                            <div class="progress-bar-fill ${progressClass}" style="width:${p.progress}%"></div>
                                        </div>
                                    </div>
                                    <div class="progress-percent">${p.progress}%</div>
                                    <div class="progress-status">
                                        <span class="badge ${p.phase === '延期' ? 'badge-danger' : p.phase === '离场' ? 'badge-pink' : 'badge-info'}">${p.phase}</span>
                                    </div>
                                </div>
                            `;
    }).join('') : '<div class="empty-state"><p>暂无进行中的项目</p></div>'}
                    </div>
                </div>
                <div class="panel">
                    <div class="panel-header">
                        <div class="panel-title">🔔 待处理提醒</div>
                    </div>
                    <div class="panel-body">
                        ${data.upcoming_reminders.length > 0 ? data.upcoming_reminders.map(r => `
                            <div class="reminder-item ${r.type}">
                                <div class="reminder-content">
                                    <div class="reminder-title">${r.title}</div>
                                    <div class="reminder-desc">${r.content || ''}</div>
                                    <div class="reminder-time">${r.project_name || '全局'} | ${r.due_date || '无截止'}</div>
                                </div>
                                <button class="btn btn-sm btn-outline" onclick="markNotificationRead(${r.id})">已读</button>
                            </div>
                        `).join('') : '<div class="empty-state"><p>暂无待处理提醒</p></div>'}
                    </div>
                </div>
            `;
}

function showDeliveryMap() {
    currentProjectId = null;
    hideAllViews();
    document.getElementById('mapView').style.display = 'block';
    if (typeof initDeliveryMap === 'function') {
        initDeliveryMap();
    } else {
        document.getElementById('mapView').innerHTML = '<div class="loading-spinner">加载地图模块中...</div>';
        // 动态加载地图脚本
        const script = document.createElement('script');
        script.src = '/api/force_static/js/map.js?v=' + Date.now();
        script.onload = () => initDeliveryMap();
        document.body.appendChild(script);
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

function showApprovalCenter() {
    currentProjectId = null;
    hideAllViews();
    document.getElementById('approvalView').style.display = 'block';
    loadApprovalList();
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

function renderInterfaceFlow() {
    const chartDom = document.getElementById('interfaceFlowChart');
    if (!chartDom) return;
    const myChart = echarts.init(chartDom);

    // 构造拓扑数据
    const interfaces = currentProject.interfaces || [];
    const hospitalNode = { name: currentProject.hospital_name, category: 0, draggable: true };
    const nodes = [hospitalNode];
    const links = [];

    interfaces.forEach(i => {
        const sysNode = { name: i.system_name, category: 1, draggable: true };
        if (!nodes.find(n => n.name === sysNode.name)) {
            nodes.push(sysNode);
            links.push({ source: currentProject.hospital_name, target: i.system_name });
        }

        const intNode = { name: i.interface_name, category: 2, draggable: true };
        nodes.push(intNode);
        links.push({ source: i.system_name, target: i.interface_name });
    });

    const option = {
        title: { text: '接口数据流向拓扑' },
        tooltip: {},
        legend: [{ data: ['核心系统', '第三方系统', '接口明细'] }],
        series: [{
            type: 'graph',
            layout: 'force',
            data: nodes,
            links: links,
            categories: [{ name: '核心系统' }, { name: '第三方系统' }, { name: '接口明细' }],
            roam: true,
            label: { show: true, position: 'right' },
            force: { repulsion: 200, edgeLength: 100 },
            lineStyle: { color: 'source', curveness: 0.3 }
        }]
    };

    myChart.setOption(option);
    window.addEventListener('resize', () => myChart.resize());
}

async function exportProjectReport(pid) {
    try {
        const project = await api.get(`/projects/${pid}`);
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(project, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", `项目报告_${project.project_name}.json`);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
        alert('报告已生成并开始下载（JSON 格式包含全量项目明细）。');
    } catch (e) {
        console.error('导出失败', e);
        alert('导出失败，请重试');
    }
}

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
        alert('加载统计数据失败');
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
        alert('加载统计数据失败');
    }
}

// ========== 登录/注册功能 ==========
let currentUser = null;

async function checkAuth() {
    const mainContainer = document.querySelector('.main-container');
    const header = document.querySelector('.header');

    try {
        // 使用 silent 模式避免弹出 alert
        const response = await fetch('/api/auth/me');
        const res = await response.json();
        if (res.success && res.data) {
            currentUser = res.data;
            // 显示主界面
            if (mainContainer) mainContainer.style.display = 'flex';
            if (header) header.style.display = 'flex';
            updateUserUI();
            // 加载项目列表
            loadProjects();
        } else {
            // 未登录，隐藏主界面，显示登录弹窗
            currentUser = null;
            if (mainContainer) mainContainer.style.display = 'none';
            showFullPageLogin();
        }
    } catch (e) {
        currentUser = null;
        if (mainContainer) mainContainer.style.display = 'none';
        showFullPageLogin();
    }
}

function showFullPageLogin() {
    // 显示全屏登录遮罩
    let loginOverlay = document.getElementById('loginOverlay');
    if (!loginOverlay) {
        loginOverlay = document.createElement('div');
        loginOverlay.id = 'loginOverlay';
        loginOverlay.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            display: flex; align-items: center; justify-content: center;
            z-index: 9999;
        `;
        loginOverlay.innerHTML = `
            <div style="background: white; border-radius: 16px; padding: 40px; width: 400px; max-width: 90%; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="font-size: 48px; margin-bottom: 16px;">🏥</div>
                    <h2 style="font-size: 24px; color: var(--gray-800); margin-bottom: 8px;">重症手麻项目管理系统</h2>
                    <p style="color: var(--gray-500); font-size: 14px;">请登录以继续</p>
                </div>
                <div id="overlayLoginForm">
                    <div class="form-group">
                        <label>用户名</label>
                        <input type="text" id="overlayLoginUsername" placeholder="请输入用户名" style="padding: 12px;">
                    </div>
                    <div class="form-group">
                        <label>密码</label>
                        <input type="password" id="overlayLoginPassword" placeholder="请输入密码" style="padding: 12px;" onkeypress="if(event.key==='Enter')doOverlayLogin()">
                    </div>
                </div>
                <div id="overlayLoginError" style="color: var(--danger); margin-bottom: 12px; display: none;"></div>
                <button class="btn btn-primary btn-full" onclick="doOverlayLogin()" style="padding: 14px; font-size: 16px;">登 录</button>
                
                <!-- 企业微信登录入口 -->
                <div style="margin-top: 20px; text-align: center; border-top: 1px solid var(--gray-200); padding-top: 20px;">
                    <div style="color: var(--gray-400); font-size: 13px; margin-bottom: 12px;">
                        ── 或使用企业微信登录 ──
                    </div>
                    <button type="button" onclick="showWecomLogin('overlayWecomContainer', 'overlayLoginForm')" style="width:100%; padding:12px; background:#07C160; color:white; 
                        border:none; border-radius:8px; cursor:pointer; font-size:15px; display: flex; align-items: center; justify-content: center; gap: 8px;">
                        📱 企业微信扫码登录
                    </button>
                    <div id="overlayWecomContainer" style="display:none; margin-top:15px; background: #f9fafb; border-radius: 8px; padding: 10px;"></div>
                </div>

                <p style="text-align: center; margin-top: 16px; color: var(--gray-500); font-size: 13px;">
                    没有账户？<a href="javascript:void(0)" onclick="showRegisterFromOverlay()" style="color: var(--primary);">立即注册</a>
                </p>
            </div>
        `;
        document.body.appendChild(loginOverlay);
    }
    loginOverlay.style.display = 'flex';
}

async function doOverlayLogin() {
    const username = document.getElementById('overlayLoginUsername').value;
    const password = document.getElementById('overlayLoginPassword').value;
    const errorDiv = document.getElementById('overlayLoginError');

    if (!username || !password) {
        errorDiv.textContent = '请输入用户名和密码';
        errorDiv.style.display = 'block';
        return;
    }

    try {
        const userData = await api.post('/auth/login', { username, password }, { silent: true });
        currentUser = userData;
        // 隐藏登录遮罩，显示主界面
        const loginOverlay = document.getElementById('loginOverlay');
        if (loginOverlay) loginOverlay.style.display = 'none';
        const mainContainer = document.querySelector('.main-container');
        const header = document.querySelector('.header');
        if (mainContainer) mainContainer.style.display = 'flex';
        if (header) header.style.display = 'flex';
        updateUserUI();
        loadProjects();
    } catch (e) {
        errorDiv.textContent = e.message || '登录失败';
        errorDiv.style.display = 'block';
    }
}

function showRegisterFromOverlay() {
    const overlay = document.getElementById('loginOverlay');
    if (overlay) overlay.style.display = 'none';
    showLoginModal();
    showRegisterForm();
}

function updateUserUI() {
    const loginBtnText = document.getElementById('loginBtnText');
    const userPanel = document.getElementById('userInfoPanel');
    const adminSettingsBtn = document.getElementById('adminSettingsBtn');

    if (currentUser) {
        if (loginBtnText) loginBtnText.textContent = currentUser.display_name || currentUser.username;
        document.getElementById('userDisplayName').textContent = currentUser.display_name || currentUser.username;
        document.getElementById('userRole').textContent = currentUser.role;
        document.getElementById('userAvatar').textContent = (currentUser.display_name || currentUser.username).charAt(0).toUpperCase();

        // 管理员专属功能入口
        if (adminSettingsBtn) {
            adminSettingsBtn.style.display = currentUser.role === 'admin' ? 'block' : 'none';
        }
    } else {
        if (loginBtnText) loginBtnText.textContent = '登录';
        if (adminSettingsBtn) adminSettingsBtn.style.display = 'none';
    }
}

function toggleUserPanel() {
    if (currentUser) {
        // 已登录，显示/隐藏用户面板
        const panel = document.getElementById('userInfoPanel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    } else {
        // 未登录，显示登录弹窗
        showLoginModal();
    }
}

function showLoginModal() {
    openModal('loginModal');
    showLoginForm();
}

function showLoginForm() {
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
}

function showRegisterForm() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
}

async function doLogin() {
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    const errorDiv = document.getElementById('loginError');

    if (!username || !password) {
        errorDiv.textContent = '请输入用户名和密码';
        errorDiv.style.display = 'block';
        return;
    }

    try {
        // api.post 成功时直接返回 data，失败时抛出异常
        const userData = await api.post('/auth/login', { username, password }, { silent: true });
        currentUser = userData;
        updateUserUI();
        closeModal('loginModal');
        // 不弹 alert，直接刷新页面更新状态
        window.location.reload();
    } catch (e) {
        errorDiv.textContent = e.message || '登录失败';
        errorDiv.style.display = 'block';
    }
}

async function doRegister() {
    const username = document.getElementById('regUsername').value;
    const password = document.getElementById('regPassword').value;
    const confirmPwd = document.getElementById('regPasswordConfirm').value;
    const displayName = document.getElementById('regDisplayName').value;
    const errorDiv = document.getElementById('regError');

    if (!username || !password) {
        errorDiv.textContent = '请填写用户名和密码';
        errorDiv.style.display = 'block';
        return;
    }
    if (password !== confirmPwd) {
        errorDiv.textContent = '两次密码不一致';
        errorDiv.style.display = 'block';
        return;
    }

    try {
        await api.post('/auth/register', { username, password, display_name: displayName }, { silent: true });
        alert('注册成功，请登录');
        showLoginForm();
    } catch (e) {
        errorDiv.textContent = e.message || '注册失败';
        errorDiv.style.display = 'block';
    }
}

async function doLogout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) { }
    currentUser = null;
    // 刷新页面以更新状态
    window.location.reload();
}

// ========== 提醒中心功能 ==========
let reminderData = null;

async function showReminderCenter() {
    openModal('reminderModal');
    await loadReminderDigest();
    await switchReminderTab('overdue');
}

async function loadReminderDigest() {
    const container = document.getElementById('reminderDigest');
    try {
        const d = await api.get('/reminders/digest');
        if (d) {
            const scoreClass = d.health_score >= 80 ? 'score-high' : d.health_score >= 60 ? 'score-medium' : 'score-low';
            container.innerHTML = `
                <div class="score-card ${scoreClass}">
                    <div class="score-circle">
                        <div class="score-value">${d.health_score || 0}</div>
                        <div class="score-label">健康度</div>
                    </div>
                    <div class="score-info">
                        <div class="score-title">📊 每日摘要</div>
                        <div style="display: flex; gap: 20px; flex-wrap: wrap; font-size: 13px;">
                            <span>📁 活跃项目: <strong>${d.active_projects || 0}</strong></span>
                            <span>🚨 逾期: <strong style="color:#ef4444;">${d.overdue_count || 0}</strong></span>
                            <span>⏰ 即将到期: <strong style="color:#f59e0b;">${d.upcoming_count || 0}</strong></span>
                            <span>💤 待处理: <strong>${d.stale_issues_count || 0}</strong></span>
                        </div>
                    </div>
                </div>
            `;
            // 更新侧边栏徽章
            const badge = document.getElementById('reminderBadge');
            const total = (d.overdue_count || 0) + (d.upcoming_count || 0);
            if (total > 0) {
                badge.textContent = total;
                badge.style.display = 'inline';
            } else {
                badge.style.display = 'none';
            }
        }
    } catch (e) {
        container.innerHTML = '<div style="color:#ef4444;">加载失败</div>';
    }
}

async function switchReminderTab(type) {
    document.querySelectorAll('#reminderTabs .tab').forEach(t => t.classList.remove('active'));
    // Fix: Handle direct call or event call
    const target = event ? event.target : document.querySelector(`#reminderTabs .tab[onclick*="'${type}'"]`);
    if (target) target.classList.add('active');

    const container = document.getElementById('reminderListContainer');
    container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

    try {
        let items = [];
        if (type === 'overdue') {
            const res = await api.get('/reminders/overdue');
            items = res?.overdue_milestones || [];
        } else if (type === 'upcoming') {
            const res = await api.get('/reminders/upcoming?days=7');
            items = res?.upcoming_deadlines || [];
        } else if (type === 'stale') {
            const res = await api.get('/reminders');
            items = res?.stale_issues || [];
        } else if (type === 'idle') {
            const res = await api.get('/reminders');
            items = res?.idle_projects || [];
        }

        if (items.length === 0) {
            container.innerHTML = '<div style="text-align:center; color:#6b7280; padding:40px;">🎉 暂无待处理项</div>';
            return;
        }

        container.innerHTML = items.map(item => {
            const daysOverdue = item.days_overdue || item.days_pending;
            const daysUntil = item.days_until || item.days_remaining;
            const title = item.name || item.project_name || item.description || '未命名项目';

            return `
                <div class="reminder-item ${type === 'overdue' ? 'danger' : type === 'upcoming' ? 'warning' : 'info'}">
                    <div class="reminder-content">
                        <div class="reminder-title">${title}</div>
                        <div class="reminder-desc">
                            ${item.project_name && item.project_name !== title ? `项目: ${item.project_name} | ` : ''} 
                            ${daysOverdue ? `超期 ${daysOverdue} 天` : ''} 
                            ${daysUntil !== undefined ? `${daysUntil} 天后到期` : ''}
                            ${item.severity ? `<span class="badge ${item.severity === '高' ? 'badge-danger' : 'badge-warning'}">${item.severity}</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

    } catch (e) {
        container.innerHTML = '<div style="color:#ef4444; text-align:center;">加载失败</div>';
    }
}

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
            alert('最多选择5个项目');
            event.target.checked = false;
            return;
        }
        selectedCompareProjects.add(id);
    }
}

async function runProjectComparison() {
    if (selectedCompareProjects.size < 2) {
        alert('请至少选择2个项目进行对比');
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
        alert('对比分析失败');
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
        alert('请选择用户');
        return;
    }

    try {
        await api.post(`/projects/${currentProjectId}/access`, { user_id: parseInt(userId), role }, { silent: true });
        loadProjectAccess(currentProjectId);
        alert('授权成功');
    } catch (e) {
        alert('操作异常: ' + e.message);
    }
}

async function removeProjectAccess(userId) {
    if (!confirm('确定要移除该用户的访问权限吗？')) return;

    try {
        await api.delete(`/projects/${currentProjectId}/access/${userId}`);
        loadProjectAccess(currentProjectId);
        alert('移除成功');
    } catch (e) {
        alert('操作异常: ' + e.message);
    }
}

// ========== 全局用户管理 (Admin) ==========
let userToReset = null;

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
                    ${u.is_active ?
                `<span class="badge" style="background:#dcfce7; color:#166534;">正常</span>` :
                `<span class="badge" style="background:#fee2e2; color:#991b1b;">已禁用</span>`
            }
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
        alert('操作失败: ' + e.message);
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
        alert('请输入新密码');
        return;
    }

    try {
        await api.post(`/users/${userToReset}/password`, { password: newPassword });
        alert('密码重置成功');
        closeModal('passwordResetModal');
        userToReset = null;
    } catch (e) {
        alert('重置失败: ' + e.message);
    }
}

// ========== AI 配置管理 (仅管理员) ==========
let currentEditingAIConfig = null;

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
        document.getElementById('aiConfigKey').value = '';  // 不显示密钥，留空表示不修改
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
        alert('名称和 URL 为必填项');
        return;
    }

    if (!currentEditingAIConfig && !api_key) {
        alert('新增配置时 API 密钥为必填项');
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
        alert('配置已保存');
    } catch (e) {
        alert('保存失败: ' + e.message);
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
        alert('加载配置失败: ' + e.message);
    }
}

async function deleteAIConfig(configId) {
    if (!confirm('确定要删除这个 AI 配置吗？')) return;

    try {
        await api.delete(`/admin/ai-configs/${configId}`);
        await loadAIConfigs();
    } catch (e) {
        alert('删除失败: ' + e.message);
    }
}

async function testAIConfig(configId) {
    const btn = event.target;
    const originalText = btn.textContent;
    btn.textContent = '⏳';
    btn.disabled = true;

    try {
        const result = await api.post(`/admin/ai-configs/${configId}/test`, {});
        if (result.success) {
            alert(`✅ ${result.message}`);
        } else {
            alert(`❌ ${result.message}\n${result.details || ''}`);
        }
    } catch (e) {
        alert('测试失败: ' + e.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

async function migrateEnvConfigs() {
    try {
        const result = await api.post('/admin/ai-configs/migrate', {});
        alert(result.message || '操作完成');
        await loadAIConfigs();
    } catch (e) {
        alert('导入失败: ' + e.message);
    }
}

// ========== 报告归档 ==========

async function loadReportArchive(projectId) {
    const container = document.getElementById('reportArchiveList');
    if (!container) return;

    const typeFilter = document.getElementById('archiveTypeFilter');
    const type = typeFilter ? typeFilter.value : '';
    const url = `/api/projects/${projectId}/report-archive${type ? '?type=' + type : ''}`;

    try {
        const res = await fetch(url);
        const archives = await res.json();

        if (!archives || archives.length === 0) {
            container.innerHTML = `<div style="text-align:center;color:var(--gray-400);padding:30px;">
                <div style="font-size:40px;margin-bottom:10px;">📭</div>
                <div>暂无归档报告</div>
                <div style="font-size:12px;margin-top:5px;">系统将在每天 22:00 自动生成日报，每周五 22:30 自动生成周报</div>
                <div style="font-size:12px;">也可点击上方按钮手动生成</div>
            </div>`;
            return;
        }

        container.innerHTML = archives.map(a => {
            const typeLabel = a.report_type === 'daily' ? '📝 日报' : '📋 周报';
            const typeBadge = a.report_type === 'daily'
                ? '<span style="background:#e0f2fe;color:#0369a1;padding:2px 8px;border-radius:10px;font-size:11px;">日报</span>'
                : '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px;font-size:11px;">周报</span>';
            const genBadge = a.generated_by === 'auto'
                ? '<span style="background:#f0fdf4;color:#166534;padding:2px 6px;border-radius:10px;font-size:10px;">自动</span>'
                : '<span style="background:#faf5ff;color:#6b21a8;padding:2px 6px;border-radius:10px;font-size:10px;">手动</span>';

            return `<div class="archive-item" onclick="viewArchiveDetail(${a.id})"
                style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--gray-100);cursor:pointer;transition:background 0.15s;"
                onmouseover="this.style.background='var(--gray-50)'" onmouseout="this.style.background=''">
                <div style="display:flex;align-items:center;gap:10px;">
                    ${typeBadge}
                    <span style="font-weight:500;">${a.report_date}</span>
                    ${genBadge}
                </div>
                <span style="color:var(--gray-400);font-size:12px;">点击查看 →</span>
            </div>`;
        }).join('');
    } catch (e) {
        container.innerHTML = `<div style="text-align:center;color:var(--danger);padding:20px;">加载失败: ${e.message}</div>`;
    }
}

async function viewArchiveDetail(archiveId) {
    try {
        const res = await fetch(`/api/report-archive/${archiveId}`);
        const data = await res.json();
        if (data.error) { alert(data.error); return; }

        const typeLabel = data.report_type === 'daily' ? '日报' : '周报';

        // 使用 marked 渲染 Markdown（如果可用）
        let htmlContent;
        if (typeof marked !== 'undefined') {
            htmlContent = marked.parse(data.content || '');
        } else {
            htmlContent = `<pre style="white-space:pre-wrap;font-size:14px;line-height:1.7;">${data.content || ''}</pre>`;
        }

        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);';
        modal.innerHTML = `
            <div style="background:white;border-radius:12px;width:90%;max-width:800px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
                <div style="padding:20px 24px;border-bottom:1px solid var(--gray-200);display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <h3 style="margin:0;font-size:18px;">📂 ${typeLabel} - ${data.report_date}</h3>
                        <div style="font-size:12px;color:var(--gray-400);margin-top:4px;">
                            生成方式: ${data.generated_by === 'auto' ? '自动' : '手动'} | ${data.created_at || ''}
                        </div>
                    </div>
                    <button onclick="this.closest('.modal').remove()" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--gray-400);">✕</button>
                </div>
                <div style="padding:24px;overflow-y:auto;flex:1;line-height:1.8;font-size:14px;" class="report-detail-content">
                    ${htmlContent}
                </div>
            </div>
        `;
        modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
        document.body.appendChild(modal);
    } catch (e) {
        alert('加载报告失败: ' + e.message);
    }
}

async function manualGenerateArchive(reportType) {
    if (!currentProjectId) { alert('请先选择一个项目'); return; }

    const typeLabel = reportType === 'daily' ? '日报' : '周报';
    if (!confirm(`确定要为当前项目生成今日${typeLabel}吗？\n（如果AI服务不可用，将生成数据摘要版本）`)) return;

    try {
        const res = await fetch(`/api/projects/${currentProjectId}/report-archive/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ report_type: reportType, force: false })
        });
        const data = await res.json();

        if (data.exists) {
            if (confirm(`今日${typeLabel}已存在，是否覆盖重新生成？`)) {
                const res2 = await fetch(`/api/projects/${currentProjectId}/report-archive/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ report_type: reportType, force: true })
                });
                const data2 = await res2.json();
                if (data2.success) {
                    alert(`${typeLabel}已重新生成并归档！`);
                    loadReportArchive(currentProjectId);
                } else {
                    alert(`生成失败: ${data2.error || '未知错误'}`);
                }
            }
        } else if (data.success) {
            alert(`${typeLabel}已生成并归档！`);
            loadReportArchive(currentProjectId);
        } else if (data.error) {
            alert(`生成失败: ${data.error}`);
        }
    } catch (e) {
        alert('请求失败: ' + e.message);
    }
}
/**
 * 显示全局气泡通知 (Toast)
 * @param {string} message 消息内容
 * @param {number} duration 显示时长 (ms)
 */
function showToast(message, duration = 3000) {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
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
async function showRiskTrend(projectId) {
    let modal = document.getElementById('riskTrendModal');
    if (!modal) {
        const html = `
            <div class="modal" id="riskTrendModal" style="z-index:10002;">
                <div class="modal-content" style="max-width:900px;">
                    <div class="modal-header">
                        <h3>📈 项目风险与效能趋势</h3>
                        <button class="modal-close" onclick="closeModal('riskTrendModal')">&times;</button>
                    </div>
                    <div class="modal-body" style="padding:20px;">
                        <div id="riskTrendChart" style="width:100%;height:400px;"></div>
                        <div style="margin-top:20px;display:flex;justify-content:space-between;color:var(--gray-500);font-size:12px;">
                            <span>* 风险评分：0-100，越高风险越大</span>
                            <span>* Velocity：过去4周每周完成任务数</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);
        modal = document.getElementById('riskTrendModal');
    }

    currentProjectId = projectId;
    openModal('riskTrendModal');
    const chartDom = document.getElementById('riskTrendChart');

    if (!projectId || projectId === 'undefined' || projectId === 'null') {
        chartDom.innerHTML = `<div class="empty-state"><p class="text-danger">❌ 无效的项目 ID，无法加载趋势分析</p></div>`;
        return;
    }

    chartDom.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>正在分析趋势数据...</p></div>';

    try {
        const res = await api.get(`/projects/${projectId}/risk-trends`);
        // Fix: Ensure we access the correct data property
        const chartData = res.data || res;

        if (res.error) {
            chartDom.innerHTML = `<div class="empty-state"><p>无法获取趋势数据: ${res.error}</p></div>`;
            return;
        }

        if (!chartData || (!chartData.dates && !chartData.velocity)) {
            chartDom.innerHTML = `<div class="empty-state"><p>暂无趋势数据</p></div>`;
            return;
        }

        renderRiskTrendChart('riskTrendChart', chartData);
    } catch (e) {
        chartDom.innerHTML = `<div class="empty-state"><p>加载失败: ${e.message}</p></div>`;
    }
}

// Version: 2.1.3-STABLE (2026-02-20)
function renderRiskTrendChart(containerId, data) {
    const chartDom = document.getElementById(containerId);
    if (!chartDom) return;

    // 使用 setTimeout 延迟渲染，确保 DOM 已完全可见且尺寸正确
    setTimeout(() => {
        // [IMPORTANT] 彻底销毁旧实例并清空容器
        echarts.dispose(chartDom);
        chartDom.innerHTML = '';

        // 检查容器尺寸，如果为 0 则尝试重新 resize 或报错
        if (chartDom.clientWidth === 0 || chartDom.clientHeight === 0) {
            console.warn('Chart container has no dimensions, skipping render');
            chartDom.innerHTML = '<div class="empty-state"><p>图表尺寸异常，请刷新重试</p></div>';
            return;
        }

        const myChart = echarts.init(chartDom);

        const option = {
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross' }
            },
            legend: {
                data: ['风险评分', '情感评分 (负向)', '交付速度 (Velocity)', '活跃问题']
            },
            grid: {
                left: '3%', right: '4%', bottom: '3%', containLabel: true
            },
            xAxis: [
                {
                    type: 'category',
                    data: (data.dates && data.dates.length > 0) ? data.dates : ((data.velocity && Array.isArray(data.velocity)) ? data.velocity.map(v => v.week_start) : []),
                    axisPointer: { type: 'shadow' }
                }
            ],
            yAxis: [
                {
                    type: 'value',
                    name: '评分',
                    min: 0, max: 100,
                    position: 'left',
                    axisLine: { show: true, lineStyle: { color: '#ef4444' } },
                    axisLabel: { formatter: '{value}' }
                },
                {
                    type: 'value',
                    name: '计数',
                    min: 0,
                    position: 'right',
                    axisLine: { show: true, lineStyle: { color: '#3b82f6' } },
                    axisLabel: { formatter: '{value}' }
                }
            ],
            series: [
                {
                    name: '风险评分',
                    type: 'line',
                    data: data.risk_scores || [],
                    smooth: true,
                    itemStyle: { color: '#ef4444' },
                    lineStyle: { width: 3 }
                },
                {
                    name: '交付速度 (Velocity)',
                    type: 'bar',
                    yAxisIndex: 1,
                    data: (data.velocity && Array.isArray(data.velocity)) ? data.velocity.map(v => v.count) : [],
                    itemStyle: { color: '#3b82f6', opacity: 0.6 },
                    barMaxWidth: 30
                },
                {
                    name: '活跃问题',
                    type: 'bar',
                    yAxisIndex: 1,
                    data: (data.issue_trend && Array.isArray(data.issue_trend)) ? data.issue_trend.map(i => (i.created || 0) - (i.resolved || 0)) : [], // 简化的活跃数增量
                    itemStyle: { color: '#f59e0b', opacity: 0.6 },
                    barMaxWidth: 30
                }
            ]
        };

        myChart.setOption(option);
        window.addEventListener('resize', () => myChart.resize());

        // 触发情感分析
        loadSentimentAnalysis(currentProjectId || (data && data.project_id));
    }, 200);
}

async function loadSentimentAnalysis(projectId) {
    const container = document.getElementById('riskTrendModal')?.querySelector('.modal-body');
    if (!container) return;

    if (!document.getElementById('sentimentSection')) {
        const sectionHtml = `
    <div id="sentimentSection" style="margin-top: 30px; border-top: 1px solid #eef2f6; padding-top: 25px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h4 style="margin: 0; display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 20px;">📡</span> AI 情感雷达 (Sentiment Radar)
            </h4>
            <button class="btn btn-sm btn-outline" onclick="fetchSentiment(${projectId})">🔄 重新分析</button>
        </div>
        
        <div id="sentimentLoading" style="display:none; text-align: center; padding: 40px; color: #64748b;">
            <div class="loading-spinner" style="margin: 0 auto 10px;"></div>
            正在深度扫描项目日志与风险记录...
        </div>
        
        <div id="sentimentResult" class="sentiment-container" style="display: none;">
            <div class="sentiment-chart-box">
                <div id="sentimentRadarChart" style="width: 100%; height: 320px;"></div>
            </div>
            <div id="sentimentInsights" class="sentiment-info-box">
                <!-- Insights will be injected here -->
            </div>
        </div>
    </div>
`;
        container.insertAdjacentHTML('beforeend', sectionHtml);
    }

    // 自动加载一次
    fetchSentiment(projectId);
}

async function fetchSentiment(projectId) {
    const loadingEl = document.getElementById('sentimentLoading');
    const resultEl = document.getElementById('sentimentResult');
    const insightsEl = document.getElementById('sentimentInsights');

    if (loadingEl) loadingEl.style.display = 'block';
    if (insightsEl) insightsEl.innerHTML = '';

    try {
        const res = await api.post(`/projects/${projectId}/sentiment-analysis`);
        if (loadingEl) loadingEl.style.display = 'none';
        if (resultEl) {
            resultEl.style.display = 'flex';
            if (res && res.scores) {
                renderSentimentRadar(res);
                renderSentimentInsights(res);
            } else {
                resultEl.innerHTML = '<p class="text-danger">分析失败</p>';
            }
        }
    } catch (e) {
        if (loadingEl) loadingEl.style.display = 'none';
        if (resultEl) {
            resultEl.style.display = 'flex';
            resultEl.innerHTML = `<p class="text-danger">Error: ${e.message}</p>`;
        }
    }
}

function renderSentimentRadar(data) {
    const chartDom = document.getElementById('sentimentRadarChart');
    if (!chartDom) return;

    // 销毁旧实例防止冲突
    const existing = echarts.getInstanceByDom(chartDom);
    if (existing) existing.dispose();

    const myChart = echarts.init(chartDom);

    const scores = data.scores || data;

    const option = {
        radar: {
            indicator: [
                { name: '客户满意度', max: 10 },
                { name: '团队士气', max: 10 },
                { name: '技术稳定性', max: 10 },
                { name: '进度信心', max: 10 }
            ],
            splitArea: { areaStyle: { color: ['#f8fafc', '#fff'] } },
            axisLine: { lineStyle: { color: '#e2e8f0' } },
            splitLine: { lineStyle: { color: '#e2e8f0' } }
        },
        series: [{
            name: 'Sentiment Score',
            type: 'radar',
            data: [{
                value: [scores.client || 0, scores.team || 0, scores.tech || 0, scores.progress || 0],
                name: '当前状态',
                areaStyle: {
                    color: new echarts.graphic.RadialGradient(0.5, 0.5, 1, [
                        { color: 'rgba(99, 102, 241, 0.1)', offset: 0 },
                        { color: 'rgba(99, 102, 241, 0.4)', offset: 1 }
                    ])
                },
                lineStyle: { color: '#6366f1', width: 2 },
                symbol: 'circle',
                symbolSize: 6,
                itemStyle: { color: '#6366f1' }
            }]
        }]
    };
    myChart.setOption(option);
}

function renderSentimentInsights(data) {
    const container = document.getElementById('sentimentInsights');
    if (!container) return;
    const signals = data.signals || [];
    const severity = data.severity || 'Medium';
    const summary = data.summary || '暂无分析总结';

    const sevClass = `severity-${severity.toLowerCase()}`;
    const sevLabel = {
        'Critical': '🔴 极高风险', 'High': '🟠 高风险', 'Medium': '🟡 中等风险', 'Low': '🟢 低风险'
    }[severity] || severity;

    let signalsHtml = signals.length > 0
        ? `<div class="sentiment-signals-grid">${signals.map(s => `<div class="sentiment-signal-card"><span class="icon">⚠️</span><span>${s}</span></div>`).join('')}</div>`
        : `<div class="sentiment-empty">✅ 未检测到明显负面信号</div>`;

    container.innerHTML = `
        <div class="sentiment-severity-row">
            <span class="severity-badge ${sevClass}">${sevLabel}</span>
            <span style="font-size: 13px; color: #64748b;">综合评价</span>
        </div>
        <div class="sentiment-summary-box">${summary}</div>
        <div style="margin-top: 10px;">
            <p style="font-size: 13px; font-weight: 600; color: #475569; margin-bottom: 10px;">重点风险信号：</p>
            ${signalsHtml}
        </div>
    `;
}

// ========== 进度偏差分析逻辑 ==========
async function loadDeviationAnalysis(projectId) {
    const container = document.getElementById('deviationContainer');
    if (!container) return;

    if (!projectId || projectId === 'undefined' || projectId === 'null') {
        container.innerHTML = '<div class="text-danger">❌ 无效项目 ID</div>';
        return;
    }

    container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div>正在分析历史进度快照...</div>';

    try {
        const res = await api.get(`/projects/${projectId}/deviation`);
        if (renderDeviationCharts && typeof renderDeviationCharts === 'function') {
            renderDeviationCharts(container, res);
        } else {
            // Simple fallback rendering if helper is missing
            container.innerHTML = `<div style="padding:20px;">
                <p>已获取到 ${res.snapshots?.length || 0} 个历史快照。</p>
                <p>预测结论: ${res.prediction || '待多周数据对比'}</p>
            </div>`;
        }
    } catch (e) {
        container.innerHTML = `<div class="text-danger">偏差分析加载失败: ${e.message}</div>`;
    }
}

async function captureSnapshot(projectId) {
    if (!confirm('确定要拍摄当前的进度快照吗？这将被记录为手动快照。')) return;

    try {
        if (window.showToast) showToast('正在拍摄快照...', 2000);
        await api.post(`/projects/${projectId}/snapshots`);
        if (window.showToast) showToast('✅ 快照拍摄成功', 3000);
        loadDeviationAnalysis(projectId);
    } catch (e) {
        alert('拍摄失败: ' + e.message);
    }
}

async function generateDeviationReport(projectId) {
    const reportEl = document.getElementById('deviationAiReport');
    if (!reportEl) return;

    reportEl.style.display = 'block';
    reportEl.innerHTML = '<div class="ai-message assistant"><div class="typing-indicator"><span></span><span></span><span></span></div> AI 正在深度扫描历史快照数据并生成偏差诊断报告...</div>';

    try {
        const res = await api.post(`/projects/${projectId}/deviation/ai-report`);
        const reportHtml = typeof marked !== 'undefined' ? marked.parse(res.ai_report || '无内容') : (res.ai_report || '');
        reportEl.innerHTML = `
            <div class="panel" style="background:#f8fafc; border-left:4px solid var(--primary);">
                <div class="panel-body markdown-content">${reportHtml}</div>
            </div>
        `;
    } catch (e) {
        reportEl.innerHTML = `<div class="ai-message assistant text-danger">⚠️ 诊断报告生成失败: ${e.message}</div>`;
    }
}

function renderDeviationCharts(container, res) {
    if (!res || !res.has_data) {
        container.innerHTML = `<div class="p-4 text-center text-muted">目前数据不足，请持续拍摄几周快照以获取趋势分析</div>`;
        return;
    }

    const { snapshots, weekly_deltas, stage_deviations, stagnant_stages, prediction } = res;

    let html = `
        <div class="deviation-report-card">
            <div class="report-header">
                <span class="trend-icon">${res.avg_daily_rate > 0 ? '📈' : '⚠️'}</span>
                <div>
                    <h4>进度偏差实时分析</h4>
                    <p>日均进度增长: <b style="color:var(--primary)">${res.avg_daily_rate}%</b> | 当前总进度: <b>${res.current_progress}%</b></p>
                </div>
            </div>
            
            <div class="prediction-banner">
                <span class="icon">🔮</span>
                <span>${prediction}</span>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-top:20px;">
                <div class="deviation-sub-panel">
                    <h5>🚨 停滞阶段 (${stagnant_stages.length})</h5>
                    ${stagnant_stages.length > 0 ? `<div class="stagnant-list">${stagnant_stages.map(s => `<span>${s.stage_name}</span>`).join('')}</div>` : '<p class="text-success" style="font-size:12px;">✅ 所有活跃阶段均有进展</p>'}
                </div>
                <div class="deviation-sub-panel">
                    <h5>📊 本周关键变化</h5>
                    <div class="dev-item-grid">
                        ${stage_deviations.slice(0, 4).map(s => `
                            <div class="dev-item">
                                <span class="label">${s.stage_name}</span>
                                <span class="value ${s.delta > 0 ? 'text-success' : (s.delta < 0 ? 'text-danger' : '')}">${s.trend} ${s.delta}%</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
            
            <div id="deviationTrendLineChart" style="height:200px; margin-top:20px;"></div>
        </div>
    `;
    container.innerHTML = html;

    // Render trend chart
    const chartDom = document.getElementById('deviationTrendLineChart');
    if (chartDom) {
        // 销毁旧实例防止冲突
        const existing = echarts.getInstanceByDom(chartDom);
        if (existing) existing.dispose();

        const myChart = echarts.init(chartDom);
        const dates = snapshots.map(s => s.date);
        const progresses = snapshots.map(s => s.overall_progress);

        myChart.setOption({
            grid: { top: 30, right: 30, bottom: 30, left: 40 },
            xAxis: { type: 'category', data: dates, axisLine: { lineStyle: { color: '#e2e8f0' } } },
            yAxis: { type: 'value', max: 100, splitLine: { lineStyle: { type: 'dashed' } } },
            series: [{
                data: progresses,
                type: 'line',
                smooth: true,
                areaStyle: { color: 'rgba(99, 102, 241, 0.1)' },
                lineStyle: { color: '#6366f1', width: 3 },
                symbol: 'circle',
                symbolSize: 8,
                itemStyle: { color: '#6366f1' }
            }],
            tooltip: { trigger: 'axis' }
        });
    }
}

// ========== AI 智能填报功能 ==========
function showAiWorklogModal() {
    document.getElementById('aiWorklogInput').value = '';
    document.getElementById('aiWorklogError').style.display = 'none';
    const btn = document.getElementById('btnAiParse');
    btn.innerHTML = '🚀 智能识别并填报';
    btn.disabled = false;
    showModal('aiWorklogModal');
}

async function saveWorklogAI() {
    const rawText = document.getElementById('aiWorklogInput').value;
    if (!rawText) return alert('请输入工作内容');

    const btn = document.querySelector('#aiWorklogModal .btn-primary');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'AI 正在分析...';

    try {
        console.log("Sending AI parse request with text:", rawText);
        const res = await api.post('/ai/parse-log', { raw_text: rawText });
        console.log("AI parse response:", res);

        if (res) {
            // Fill the normal worklog modal
            document.getElementById('logDate').value = new Date().toISOString().split('T')[0];
            document.getElementById('workContent').value = res.work_content || rawText;
            document.getElementById('workHours').value = res.work_hours || 8;
            document.getElementById('issuesEncountered').value = res.issues_encountered || '';
            document.getElementById('tomorrowPlan').value = res.tomorrow_plan || '';

            closeModal('aiWorklogModal');
            showModal('worklogModal');
        } else {
            alert('AI 解析未能返回有效数据');
        }
    } catch (e) {
        console.error("AI Parse Error:", e);
        alert('AI 解析服务暂时不可用: ' + e.message);
        // Fallback: just open the modal with raw text
        closeModal('aiWorklogModal');
        showModal('worklogModal');
        document.getElementById('workContent').value = rawText;
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

async function parseAiWorklog() {
    const rawText = document.getElementById('aiWorklogInput').value.trim();
    if (!rawText) {
        alert('请输入工作内容描述');
        return;
    }

    const btn = document.getElementById('btnAiParse');
    btn.innerHTML = '<span class="loading-spinner-sm"></span> AI 正在分析...';
    btn.disabled = true;

    try {
        const res = await api.post('/ai/parse-log', { raw_text: rawText });
        if (res.success) {
            closeModal('aiWorklogModal');
            fillWorklogForm(res.data);
            showModal('worklogModal');
            if (window.showToast) showToast('AI 识别成功，请确认后保存', 'success');
        } else {
            document.getElementById('aiWorklogError').textContent = '识别失败: ' + (res.message || '未知错误');
            document.getElementById('aiWorklogError').style.display = 'block';
        }
    } catch (e) {
        console.error(e);
        document.getElementById('aiWorklogError').textContent = '请求失败: ' + e.message;
        document.getElementById('aiWorklogError').style.display = 'block';
    } finally {
        btn.innerHTML = '🚀 智能识别并填报';
        btn.disabled = false;
    }
}

function fillWorklogForm(data) {
    if (!data) return;

    // 自动清理 markdown 标记
    const cleanDetail = (data.work_content || '').replace(/\*\*/g, '').replace(/###/g, '');

    document.getElementById('workContent').value = cleanDetail;
    document.getElementById('issuesEncountered').value = data.issues_encountered || '';
    document.getElementById('workHours').value = data.work_hours || 8;
    document.getElementById('tomorrowPlan').value = data.tomorrow_plan || '';

    // 尝试自动设置日期
    document.getElementById('logDate').value = new Date().toISOString().split('T')[0];

    // 智能推断工作类型
    const content = (data.work_content || '') + (data.issues_encountered || '');
    if (content.includes('现场') || content.includes('医院') || content.includes('科室')) {
        document.getElementById('workType').value = '现场';
    } else if (content.includes('出差')) {
        document.getElementById('workType').value = '出差';
    } else {
        document.getElementById('workType').value = '远程';
    }
}

// ========== 决策建议引擎 ==========
async function refreshAiDecisionCenter(projectId) {
    const btn = event ? event.target : null;
    const originalText = btn ? btn.innerHTML : '🔄 刷新决策';
    if (btn) {
        btn.innerHTML = '⌛ 分析中...';
        btn.disabled = true;
    }

    try {
        // 同时触发战略研判和战术行动的刷新
        await Promise.all([
            loadAiInsight(projectId, true),
            loadRecommendedActions(projectId, true)
        ]);
        if (window.showToast) showToast('AI 决策已更新', 'success');
    } catch (e) {
        console.error('Refresh AI Decision Center failed', e);
    } finally {
        if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }
}

async function loadAiInsight(projectId, isRefresh = false) {
    const container = document.getElementById('aiInsightContent');
    if (!container) return;

    if (isRefresh) {
        container.innerHTML = '<div class="loading-spinner" style="font-size:13px; color:#6b7280;">AI 正在重新进行深度穿透分析...</div>';
    }

    try {
        const url = `/ai/daily-insight/${projectId}` + (isRefresh ? '?refresh=1' : '');
        const res = await api.get(url);

        if (res) {
            container.innerHTML = `
                <div class="ai-insight-text" style="line-height:1.7; color:#374151; font-size:13.5px;">
                    ${typeof marked !== 'undefined' ? marked.parse(res) : res.replace(/\n/g, '<br>')}
                </div>
            `;
        } else {
            container.innerHTML = '<div style="color:#94a3b8; font-size:13px;">暂无 AI 深度研判建议</div>';
        }
    } catch (e) {
        console.error('Load AI Insight failed', e);
        container.innerHTML = '<div style="color:var(--danger); font-size:12px;">⚠️ 研判载入异常</div>';
    }
}

async function loadRecommendedActions(projectId, isRefresh = false) {
    const container = document.getElementById('recommendedActionsContent');
    const panel = document.getElementById('aiDecisionCenterPanel');
    if (!container || !panel) return;

    try {
        const url = `/projects/${projectId}/recommended-actions` + (isRefresh ? '?refresh=1' : '');
        const res = await api.get(url);
        if (res && res.length > 0) {
            container.innerHTML = res.map(action => {
                const isAiCommand = action.type === 'ai_command';
                const bgColor = isAiCommand ? '#f5f3ff' : 'white';
                const borderColor = isAiCommand ? '#8b5cf6' : getPriorityColor(action.priority);
                const titleColor = isAiCommand ? '#6d28d9' : '#374151';

                return `
                <div class="action-card" style="background:${bgColor}; padding:14px; border-radius:10px; margin-bottom:10px; border-left:4px solid ${borderColor}; border-top:1px solid #f1f5f9; border-right:1px solid #f1f5f9; border-bottom:1px solid #f1f5f9; box-shadow:0 1px 2px rgba(0,0,0,0.03);">
                    <div style="display:flex; justify-content:space-between; align-items:start;">
                        <div style="flex:1;">
                            <div style="font-weight:700; color:${titleColor}; font-size:13.5px; display:flex; align-items:center;">
                                ${!isAiCommand ? `<span style="background:${getPriorityColor(action.priority)}20; color:${getPriorityColor(action.priority)}; font-size:10px; padding:1px 6px; border-radius:4px; margin-right:8px; font-weight:800;">${action.priority.toUpperCase()}</span>` : ''}
                                ${action.title}
                            </div>
                            <div style="font-size:13px; color:#4b5563; margin-top:6px; font-weight:500;">${action.description}</div>
                            ${action.suggestion ? `<div style="font-size:11.5px; color:#6b7280; margin-top:6px; background:rgba(0,0,0,0.02); padding:6px 10px; border-radius:6px; border:1px dashed #e2e8f0;">${isAiCommand ? '🎯' : '💡'} ${action.suggestion}</div>` : ''}
                        </div>
                        <button class="btn btn-xs ${isAiCommand ? 'btn-ai' : 'btn-outline'}" onclick="handleActionClick('${action.action_tab}', '${action.action_label}')" style="font-size:11px; white-space:nowrap; margin-left:12px; border-radius:6px; height:28px;">${action.action_label} →</button>
                    </div>
                </div>
            `}).join('');
        } else {
            container.innerHTML = '<div style="color:#94a3b8; font-size:12px; text-align:center; padding:10px;">暂无紧急行动建议</div>';
        }
    } catch (e) {
        console.error('Load actions failed', e);
        container.innerHTML = '<div style="color:var(--danger); font-size:12px; text-align:center; padding:10px;">⚠️ 指令加载失败</div>';
    }
}

function getPriorityColor(p) {
    if (p === 'High') return '#ef4444';
    if (p === 'Medium') return '#f59e0b';
    return '#3b82f6';
}

function handleActionClick(tab, label) {
    if (tab === 'dashboard') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }

    // Find tab by onclick attribute
    const tabEl = document.querySelector(`.tabs .tab[onclick*="'${tab}'"]`);
    if (tabEl) {
        tabEl.click();
        tabEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Special handling for "AI 催单"
    if (label === 'AI 催单') {
        setTimeout(showAiChaserModal, 500);
    }
}

// ========== AI 智能催单功能 ==========
let currentStaleItems = [];
let lastGeneratedChaser = null;

async function showAiChaserModal() {
    showModal('aiChaserModal');
    loadStaleItems();
    document.getElementById('chaserResult').innerHTML = '<div style="color: #9ca3af; text-align: center; margin-top: 100px;">请从左侧选择一个事项进行生成</div>';
}

async function loadStaleItems() {
    const container = document.getElementById('staleItemsList');
    container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

    try {
        const res = await api.get(`/projects/${currentProjectId}/stale-items`);
        if (res.success && res.data && res.data.length > 0) {
            currentStaleItems = res.data;
            renderStaleItems(res.data);
        } else {
            container.innerHTML = '<div class="empty-state">暂无滞后项</div>';
            currentStaleItems = [];
        }
    } catch (e) {
        container.innerHTML = `<div class="error-state">加载失败: ${e.message}</div>`;
    }
}

function renderStaleItems(items) {
    const container = document.getElementById('staleItemsList');
    const typeMap = { 'issue': '问题', 'interface': '接口', 'milestone': '里程碑' };
    const iconMap = { 'issue': '⚠️', 'interface': '🔗', 'milestone': '🎯' };

    container.innerHTML = items.map((item, index) => `
        <div class="stale-item-card" onclick="generateChaser(${index})" style="padding: 10px; border: 1px solid #eee; border-radius: 6px; margin-bottom: 8px; cursor: pointer; transition: all 0.2s;">
            <div style="font-weight: 600; font-size: 14px; color: #374151;">${iconMap[item.type]} ${item.title}</div>
            <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">${item.reason}</div>
            <div style="font-size: 12px; color: #9ca3af; margin-top: 4px; text-align: right;">${typeMap[item.type]}</div>
        </div>
    `).join('');
}

async function generateChaser(index) {
    const item = currentStaleItems[index];
    const container = document.getElementById('chaserResult');

    // Highlight selected item
    const staleItemsList = document.getElementById('staleItemsList');
    if (staleItemsList) {
        Array.from(staleItemsList.children).forEach((c, idx) => {
            if (idx === index) {
                c.style.borderColor = '#4f46e5';
                c.style.backgroundColor = '#f5f3ff';
            } else {
                c.style.borderColor = '#eee';
                c.style.backgroundColor = 'transparent';
            }
        });
    }

    container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div> 正在生成多维话术 (GPT-4)...</div>';

    try {
        const res = await api.post('/ai/chaser/generate', item);
        if (res.professional) {
            lastGeneratedChaser = res;
            renderChaserStyles('professional');
        } else {
            container.innerHTML = `<div class="error-text">生成格式异常</div>`;
        }
    } catch (e) {
        container.innerHTML = `<div class="error-text">请求异常: ${e.message}</div>`;
    }
}

function renderChaserStyles(activeStyle) {
    const container = document.getElementById('chaserResult');
    if (!lastGeneratedChaser) return;

    const data = lastGeneratedChaser[activeStyle];
    const styles = [
        { id: 'professional', label: '👔 专业', color: '#4f46e5' },
        { id: 'soft', label: '🍃 委婉', color: '#10b981' },
        { id: 'direct', label: '⚡ 果敢', color: '#f59e0b' }
    ];

    container.innerHTML = `
        <div style="display:flex; gap:8px; margin-bottom:16px; border-bottom:1px solid #f1f5f9; padding-bottom:12px;">
            ${styles.map(s => `
                <button onclick="switchChaserStyle('${s.id}')" 
                    style="flex:1; padding:6px 10px; border-radius:12px; border:2px solid ${activeStyle === s.id ? s.color : '#e2e8f0'}; 
                    background:${activeStyle === s.id ? s.color + '10' : 'white'}; color:${activeStyle === s.id ? s.color : '#64748b'};
                    font-size:12px; font-weight:700; cursor:pointer; transition:all 0.2s;">
                    ${s.label}
                </button>
            `).join('')}
        </div>
        <div id="chaserContentArea" style="animation: fadeIn 0.3s ease;">
            <div style="margin-bottom: 12px; font-weight: 800; color: #1e293b; font-size: 14px; background: #f8fafc; padding: 10px; border-radius: 8px; border-left: 4px solid #cbd5e1;">
                主题: ${data.subject}
            </div>
            <div style="white-space: pre-wrap; line-height: 1.8; color: #334155; font-size: 14px; padding: 10px;">${data.content}</div>
        </div>
    `;
}

function switchChaserStyle(style) {
    renderChaserStyles(style);
}

function copyChaserContent() {
    const content = document.getElementById('chaserResult').innerText;
    if (!content || content.includes('请从左侧选择')) return;

    navigator.clipboard.writeText(content).then(() => {
        if (window.showToast) showToast('已复制到剪贴板', 'success');
        else alert('已复制');
    });
}

function sendMockChaser() {
    const content = document.getElementById('chaserResult').innerText;
    if (!content || content.includes('请从左侧选择')) return;
    if (confirm('确定要发送这条提醒吗？(模拟发送)')) {
        if (window.showToast) showToast('✅ 已发送提醒消息', 'success');
        else alert('已发送');
        closeModal('aiChaserModal');
    }
}

async function extractToKb(issueId, btn) {
    if (!confirm('确定要让AI分析此问题并提取知识库条目吗？')) return;

    const originalText = btn.innerHTML;
    btn.innerHTML = '⏳...';
    btn.disabled = true;

    try {
        const res = await api.post('/ai/knowledge/extract', { issue_id: issueId });
        if (res.success) {
            alert(`✅ 提取成功！\n标题: ${res.data.data.title}\n已存入知识库。`);
        } else {
            alert('提取失败: ' + res.message);
        }
    } catch (e) {
        alert('请求异常: ' + e.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// ========== AI 问答 (NLQ) 功能 ==========
function showAskAiModal() {
    showModal('askAiModal');
    document.getElementById('aiQuestionInput').focus();
    // Reset state
    document.getElementById('aiQueryResult').style.display = 'none';
    document.getElementById('aiQueryLoading').style.display = 'none';
    document.getElementById('aiQuestionInput').value = '';
}

async function submitAiQuestion() {
    const question = document.getElementById('aiQuestionInput').value.trim();
    if (!question) return;

    // Validation
    if (!currentProjectId) {
        alert("项目ID未找到，请刷新页面重试");
        console.error("Missing currentProjectId");
        return;
    }

    const loading = document.getElementById('aiQueryLoading');
    const resultDiv = document.getElementById('aiQueryResult');
    const sqlSpan = document.getElementById('aiQuerySql');
    const table = document.getElementById('aiResultTable');
    const countDiv = document.getElementById('aiResultCount');

    loading.style.display = 'block';
    resultDiv.style.display = 'none';

    console.log(`Submitting AI Question: "${question}" for Project ID: ${currentProjectId}`);

    try {
        // Explicitly ensuring URL is correct
        const data = await api.post(`/projects/${currentProjectId}/ask`, { question });

        if (data) {
            sqlSpan.textContent = data.sql || 'No SQL generated';

            // Build Table
            let tableHtml = '<thead><tr>';
            if (data.columns) {
                data.columns.forEach(col => {
                    tableHtml += `<th>${col}</th>`;
                });
            }
            tableHtml += '</tr></thead><tbody>';

            if (!data.rows || data.rows.length === 0) {
                tableHtml += `<tr><td colspan="${(data.columns || []).length || 1}" style="text-align:center; color:#94a3b8; padding:40px;">No results found for this query.</td></tr>`;
            } else {
                data.rows.forEach(row => {
                    tableHtml += '<tr>';
                    data.columns.forEach(col => {
                        tableHtml += `<td>${row[col] !== null ? row[col] : '-'}</td>`;
                    });
                    tableHtml += '</tr>';
                });
            }
            tableHtml += '</tbody>';

            table.innerHTML = tableHtml;
            countDiv.textContent = `找到 ${data.rows ? data.rows.length : 0} 条记录`;

            resultDiv.style.display = 'block';
        }
    } catch (e) {
        console.error("AI Ask Error:", e);
        // api.js handles alerts, but we can show inline error too
        alert(`请求失败: ${e.message}`);
    } finally {
        loading.style.display = 'none';
        document.getElementById('aiInputContainer').style.boxShadow = '0 4px 12px -2px rgba(0,0,0,0.05)';
        document.getElementById('aiInputContainer').style.borderColor = '#e2e8f0';
    }
}

function setAiQuestion(text) {
    const input = document.getElementById('aiQuestionInput');
    if (input) {
        input.value = text;
        input.focus();
    }
}

function toggleAiSql() {
    const container = document.getElementById('aiSqlContainer');
    const btn = document.getElementById('btnToggleSql');
    const icon = btn.querySelector('i');

    if (container.style.display === 'none') {
        container.style.display = 'block';
        icon.style.transform = 'rotate(-135deg)';
    } else {
        container.style.display = 'none';
        icon.style.transform = 'rotate(45deg)';
    }
}

// ========== 相似项目雷达 ==========
async function loadSimilarProjects(projectId) {
    const container = document.getElementById('similarProjectsContent');
    if (!container) return;

    try {
        const data = await api.get(`/projects/${projectId}/similar`);
        renderSimilarProjects(data, container);
    } catch (e) {
        container.innerHTML = `<div class="error-state">加载失败: ${e.message}</div>`;
    }
}

function renderSimilarProjects(projects, container) {
    if (!projects || projects.length === 0) {
        container.innerHTML = '<div style="text-align:center; color:#94a3b8; font-size:13px; padding:10px;">暂无相似项目</div>';
        return;
    }

    let html = '<div style="display:flex; flex-direction:column; gap:8px;">';
    projects.forEach(p => {
        html += `
            <div style="display:flex; align-items:flex-start; gap:12px; padding:12px; background:#ffffff; border:1px solid #f1f5f9; border-radius:8px;">
                <div style="font-size:20px; opacity:0.7;">🔗</div>
                <div style="flex:1;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                        <span style="font-weight:600; color:#334155; font-size:14px;">${p.project_name}</span>
                        <span class="badge ${p.status === '已完成' ? 'badge-success' : 'badge-gray'}">${p.status}</span>
                    </div>
                    <div style="font-size:12px; color:#64748b; margin-bottom:6px;">${p.hospital_name}</div>
                    <div style="font-size:12px; color:#475569; background:#f8fafc; padding:6px 10px; border-radius:6px; line-height:1.4;">
                        💡 <strong>相似原因:</strong> ${p.similarity_reason || 'AI认为该项目具有高度参考价值'}
                    </div>
                </div>
                <button class="btn btn-outline btn-xs" onclick="loadProjectDetail(${p.id})">查看</button>
            </div>
        `;
    });
    html += '</div>';
    container.innerHTML = html;
}

// ========== 预测性风险分析 ==========
async function loadProjectPrediction(projectId) {
    const dateEl = document.getElementById('predictedEndDate'); // This element name suggests it's still for prediction
    if (!dateEl) return;

    try {
        const data = await api.get(`/projects/${projectId}/predict`); // This API endpoint is for prediction
        if (data) {
            window.currentPrediction = data; // Store for modal

            dateEl.textContent = data.predicted_end_date || '未知';

            if (data.is_delay_predicted) {
                dateEl.style.color = '#ef4444';
                const card = document.getElementById('predictionCard');
                if (card) {
                    card.style.background = '#fff1f2';
                    card.style.borderColor = '#fecdd3';
                }
                dateEl.innerHTML = `${data.predicted_end_date} <span style="font-size:12px; display:block; color:#ef4444;">⚠️ 预计延期 ${data.delay_days} 天</span>`;
            }
        } else {
            dateEl.textContent = '无法预测';
        }
    } catch (e) {
        dateEl.textContent = '无法预测';
    }
}

function showPredictionDetail() {
    const data = window.currentPrediction;
    if (!data) return;

    const content = `
        <div style="padding:10px;">
            <div style="display:flex; gap:20px; margin-bottom:20px;">
                <div style="flex:1; padding:15px; background:#f8fafc; border-radius:8px; text-align:center;">
                    <div style="color:#64748b; font-size:12px;">当前进度</div>
                    <div style="font-size:24px; font-weight:bold; color:#0f172a;">${data.current_progress}%</div>
                </div>
                <div style="flex:1; padding:15px; background:#f0f9ff; border-radius:8px; text-align:center;">
                    <div style="color:#0369a1; font-size:12px;">交付速度 (Velocity)</div>
                    <div style="font-size:24px; font-weight:bold; color:#0c4a6e;">${data.avg_velocity}%<span style="font-size:12px;">/日</span></div>
                </div>
            </div>
            
            <div style="margin-bottom:15px; padding:15px; border-radius:8px; background:#ffffff; border:1px solid #e2e8f0; border-left:4px solid ${data.is_delay_predicted ? '#ef4444' : '#10b981'};">
                <div style="font-weight:600; font-size:16px;">📅 交付模拟预测</div>
                <div style="margin-top:10px; display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                    <div>计划结项: <span style="font-weight:500;">${data.plan_end_date || '未设置'}</span></div>
                    <div>预计结项: <span style="font-weight:500; color:${data.is_delay_predicted ? '#ef4444' : '#10b981'}">${data.predicted_end_date}</span></div>
                </div>
                ${data.is_delay_predicted ? `<div style="margin-top:10px; color:#ef4444; background:#fef2f2; padding:8px; border-radius:4px; font-size:13px;">
                    🚩 <strong>预警:</strong> 按照当前交付速度，项目将晚于计划日期 <strong>${data.delay_days}</strong> 天交付。
                </div>` : '<div style="margin-top:10px; color:#10b981; font-size:13px;">✅ <b>安全:</b> 目前进度符合预期，能按时交付。</div>'}
            </div>
            
            <div style="padding:15px; border-radius:8px; background:#ffffff; border:1px solid #e2e8f0; border-left:4px solid ${data.is_sentiment_dropping ? '#f59e0b' : '#3b82f6'};">
                <div style="font-weight:600; font-size:16px;">🎭 情绪与稳定性分析</div>
                <div style="margin-top:10px;">
                    平均情绪评分: <span style="font-weight:bold;">${data.sentiment_score}</span> / 100
                    ${data.is_sentiment_dropping ? '<div style="color:#b45309; font-size:13px; margin-top:5px;">⚠️ <strong>趋势预警:</strong> 近期工作日志情绪出现下滑倾向，可能存在团队疲劳或甲方协同卡点。</div>' : ''}
                </div>
            </div>
        </div>
    `;

    showGenericModal('🔮 AI 交付预测与风险预判', content);
}

function showGenericModal(title, contentHtml) {
    const modal = document.getElementById('askAiModal');
    if (!modal) { alert(title + "\n" + contentHtml); return; }

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
            alert('收入录入成功');
            closeModal('revenueModal');
            if (typeof loadProjectFinancials === 'function') {
                loadProjectFinancials(projectId); // 刷新财务看板
            }
        } else {
            alert('录入失败: ' + res.message);
        }
    } catch (e) {
        console.error(e);
        alert('系统错误');
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
        const summary = data.summary || '暂无摘要';
        container.innerHTML = `
            <div class="report-container" style="box-shadow: none; border: none; padding: 24px; font-size: 14px;">
                ${typeof marked !== 'undefined' ? marked.parse(summary) : summary.replace(/\n/g, '<br>')}
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
    const qInput = document.getElementById('reportQuarter');
    if (qInput) qInput.value = '';

    modal.classList.add('show');
    refreshReportPreview();
}

async function refreshReportPreview() {
    const projectId = window.currentReportProjectId;
    const year = document.getElementById('reportYear').value;
    const month = document.getElementById('reportMonth').value;
    const quarter = document.getElementById('reportQuarter').value;

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

        const res = await api.get(url);
        if (res) {
            document.getElementById('paperProjectName').textContent = res.project.project_name;
            const periodStr = month ? `${year}年${month}月` : `${year}年第${quarter}季度`;
            document.getElementById('paperReportPeriod').textContent = `${periodStr} 运行报表`;

            // AI 摘要
            aiBox.innerHTML = marked.parse(res.ai_summary || "暂无分析摘要");

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
        alert("导出失败: " + err.message);
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
            narration.innerHTML = marked.parse(res.narration || "分析完成");
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
            content.innerHTML = marked.parse(res || "生成失败");
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
    if (!transcript) return alert('请输入会议内容');

    const resultBox = document.getElementById('meetingResult');
    resultBox.style.display = 'block';
    resultBox.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>正在提炼任务清单...</p></div>';

    try {
        const res = await api.post('/collab/meeting-actions', { transcript });
        if (res) {
            resultBox.innerHTML = marked.parse(res || "分析结果为空");
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
    if (!rawText) return alert('请输入文本内容');

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
        alert(`成功导入 ${window.extractedLogs.length} 条日志`);
        closeModal('multiLogImportModal');
        loadWorkLogs(currentProjectId);
    } catch (e) {
        alert('导入过程中出错: ' + e.message);
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
    if (!desc) return alert('请输入变更描述');

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
            content.innerHTML = marked.parse(contentStr || "分析失败");
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

async function showWecomLogin(containerId = 'wecom_login_container', formId = 'loginForm') {
    const container = document.getElementById(containerId);
    const loginForm = document.getElementById(formId);

    if (container.style.display === 'block') {
        container.style.display = 'none';
        loginForm.style.display = 'block';
        return;
    }

    try {
        // 获取配置
        const config = await api.get('/wecom/config');

        container.style.display = 'block';
        loginForm.style.display = 'none';
        container.innerHTML = '正在加载二维码...'; // 清空并显示加载中

        // 初始化扫码
        window.wwLogin = new WwLogin({
            "id": containerId,
            "appid": config.corp_id,
            "agentid": config.agent_id,
            "redirect_uri": encodeURIComponent(config.redirect_uri),
            "state": "wecom_login_" + Date.now(),
            "href": "", // 可以自定义样式
            "lang": "zh",
        });
    } catch (e) {
        console.error('获取企业微信配置失败', e);
        alert('无法启动企业微信登录，请联系管理员');
    }
}

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
        alert('企业微信登录失败: ' + loginError);
        window.history.replaceState({}, document.title, '/');
    }
})();
