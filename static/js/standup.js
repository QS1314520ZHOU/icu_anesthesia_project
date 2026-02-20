// ========== 每日站会助手 + AI简报推送 ==========

/**
 * 加载指定项目的站会数据
 */
async function loadStandupData(projectId, dateStr) {
    const container = document.getElementById('standupContainer');
    if (!container) return;

    container.innerHTML = `
        <div style="text-align:center;padding:40px;">
            <div class="spinner"></div>
            <div style="margin-top:16px;color:var(--gray-500);font-size:13px;">加载站会数据...</div>
        </div>
    `;

    // 隐藏 AI 结果和历史面板
    const aiResult = document.getElementById('standupAiResult');
    const historyPanel = document.getElementById('standupHistoryPanel');
    if (aiResult) aiResult.style.display = 'none';
    if (historyPanel) historyPanel.style.display = 'none';

    try {
        const params = dateStr ? `?date=${dateStr}` : '';
        const data = await api.get(`/standup/${projectId}/data${params}`);
        renderStandupData(data);
    } catch (e) {
        container.innerHTML = `
            <div style="text-align:center;padding:40px;color:var(--danger);">
                <div style="font-size:32px;margin-bottom:12px;">⚠️</div>
                加载失败: ${e.message}
            </div>
        `;
    }
}

/**
 * 渲染站会数据面板
 */
function renderStandupData(data) {
    const container = document.getElementById('standupContainer');
    if (!container || !data) return;

    const project = data.project;
    const stats = data.stats;

    let html = `
        <!-- 站会概览卡片 -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px;">
            <div class="standup-stat-card" style="background:linear-gradient(135deg,#dbeafe,#eff6ff);border-radius:12px;padding:16px;text-align:center;">
                <div style="font-size:28px;font-weight:800;color:#2563eb;">${stats.tasks_completed_yesterday}</div>
                <div style="font-size:12px;color:#6b7280;margin-top:4px;">昨日完成任务</div>
            </div>
            <div class="standup-stat-card" style="background:linear-gradient(135deg,#dcfce7,#f0fdf4);border-radius:12px;padding:16px;text-align:center;">
                <div style="font-size:28px;font-weight:800;color:#16a34a;">${stats.logs_yesterday}</div>
                <div style="font-size:12px;color:#6b7280;margin-top:4px;">工作日志</div>
            </div>
            <div class="standup-stat-card" style="background:linear-gradient(135deg,#fef3c7,#fffbeb);border-radius:12px;padding:16px;text-align:center;">
                <div style="font-size:28px;font-weight:800;color:#d97706;">${stats.blocking_count}</div>
                <div style="font-size:12px;color:#6b7280;margin-top:4px;">阻塞问题</div>
            </div>
            <div class="standup-stat-card" style="background:linear-gradient(135deg,#fce7f3,#fdf2f8);border-radius:12px;padding:16px;text-align:center;">
                <div style="font-size:28px;font-weight:800;color:#db2777;">${stats.upcoming_milestone_count}</div>
                <div style="font-size:12px;color:#6b7280;margin-top:4px;">近期里程碑</div>
            </div>
            <div class="standup-stat-card" style="background:linear-gradient(135deg,#e0e7ff,#eef2ff);border-radius:12px;padding:16px;text-align:center;">
                <div style="font-size:28px;font-weight:800;color:#4f46e5;">${stats.onsite_count}</div>
                <div style="font-size:12px;color:#6b7280;margin-top:4px;">驻场人员</div>
            </div>
        </div>

        <!-- 项目信息条 -->
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;padding:10px 16px;background:var(--gray-50);border-radius:10px;font-size:13px;">
            <span style="font-weight:600;">📍 ${project.project_name}</span>
            <span style="color:var(--gray-400);">|</span>
            <span style="color:var(--gray-500);">🏥 ${project.hospital_name}</span>
            <span style="color:var(--gray-400);">|</span>
            <span style="color:var(--gray-500);">📊 ${project.progress}%</span>
            <span style="color:var(--gray-400);">|</span>
            <span style="color:var(--gray-500);">📅 ${data.date}</span>
            <div style="flex:1;"></div>
            <button class="btn btn-sm" style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;border:none;" onclick="exportFormalReport(${project.id})">📄 AI正式报告 (.docx)</button>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
    `;

    // 左栏：昨日完成 + 阻塞问题
    html += `<div>`;

    // 昨日完成
    html += `
        <div style="margin-bottom:16px;">
            <h4 style="font-size:14px;font-weight:700;color:#16a34a;margin-bottom:8px;">✅ 昨日完成</h4>
            <div style="background:white;border:1px solid var(--gray-200);border-radius:10px;padding:12px;">
    `;
    if (data.yesterday_completed && data.yesterday_completed.length > 0) {
        for (const t of data.yesterday_completed) {
            html += `<div style="padding:6px 0;border-bottom:1px solid var(--gray-100);font-size:13px;">
                <span style="color:var(--gray-400);font-size:11px;">[${t.stage_name}]</span> ${t.task_name}
            </div>`;
        }
    } else {
        html += `<div style="color:var(--gray-400);font-size:13px;text-align:center;padding:12px;">无完成记录</div>`;
    }
    html += `</div></div>`;

    // 昨日工作日志
    html += `
        <div style="margin-bottom:16px;">
            <h4 style="font-size:14px;font-weight:700;color:#2563eb;margin-bottom:8px;">📝 工作日志</h4>
            <div style="background:white;border:1px solid var(--gray-200);border-radius:10px;padding:12px;">
    `;
    if (data.yesterday_logs && data.yesterday_logs.length > 0) {
        for (const l of data.yesterday_logs) {
            html += `<div style="padding:8px 0;border-bottom:1px solid var(--gray-100);font-size:13px;">
                <div style="font-weight:600;margin-bottom:2px;">👤 ${l.member_name} ${l.work_hours ? `<span style="color:var(--gray-400);font-weight:400;">(${l.work_hours}h)</span>` : ''}</div>
                <div style="color:var(--gray-600);">${l.work_content || '无内容'}</div>
                ${l.issues_encountered ? `<div style="color:#d97706;font-size:12px;margin-top:4px;">⚠️ ${l.issues_encountered}</div>` : ''}
            </div>`;
        }
    } else {
        html += `<div style="color:var(--gray-400);font-size:13px;text-align:center;padding:12px;">无日志</div>`;
    }
    html += `</div></div>`;

    // 阻塞问题
    html += `
        <div>
            <h4 style="font-size:14px;font-weight:700;color:#dc2626;margin-bottom:8px;">🚫 阻塞问题 (${data.blocking_issues.length})</h4>
            <div style="background:white;border:1px solid var(--gray-200);border-radius:10px;padding:12px;">
    `;
    if (data.blocking_issues && data.blocking_issues.length > 0) {
        for (const i of data.blocking_issues) {
            const severityColor = i.severity === '高' ? '#ef4444' : i.severity === '中' ? '#f59e0b' : '#6b7280';
            html += `<div style="padding:6px 0;border-bottom:1px solid var(--gray-100);font-size:13px;display:flex;align-items:center;gap:8px;">
                <span style="background:${severityColor};color:white;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:600;">${i.severity}</span>
                <span>${i.description}</span>
                <span style="margin-left:auto;color:var(--gray-400);font-size:11px;">${i.status}</span>
            </div>`;
        }
    } else {
        html += `<div style="color:#16a34a;font-size:13px;text-align:center;padding:12px;">✨ 无阻塞问题</div>`;
    }
    html += `</div></div>`;
    html += `</div>`;

    // 右栏：今日计划 + 里程碑 + 阶段进度
    html += `<div>`;

    // 今日计划
    html += `
        <div style="margin-bottom:16px;">
            <h4 style="font-size:14px;font-weight:700;color:#8b5cf6;margin-bottom:8px;">📋 今日计划</h4>
            <div style="background:white;border:1px solid var(--gray-200);border-radius:10px;padding:12px;">
    `;
    if (data.today_plans && data.today_plans.length > 0) {
        for (const p of data.today_plans) {
            html += `<div style="padding:6px 0;border-bottom:1px solid var(--gray-100);font-size:13px;">
                <span style="font-weight:600;color:#8b5cf6;">👤 ${p.member}</span>
                <div style="color:var(--gray-600);margin-top:2px;">${p.plan}</div>
            </div>`;
        }
    } else {
        html += `<div style="color:var(--gray-400);font-size:13px;text-align:center;padding:12px;">暂无明确计划</div>`;
    }
    html += `</div></div>`;

    // 里程碑
    html += `
        <div style="margin-bottom:16px;">
            <h4 style="font-size:14px;font-weight:700;color:#0ea5e9;margin-bottom:8px;">🎯 近7天里程碑</h4>
            <div style="background:white;border:1px solid var(--gray-200);border-radius:10px;padding:12px;">
    `;
    if (data.upcoming_milestones && data.upcoming_milestones.length > 0) {
        for (const m of data.upcoming_milestones) {
            html += `<div style="padding:6px 0;border-bottom:1px solid var(--gray-100);font-size:13px;display:flex;justify-content:space-between;">
                <span>${m.name}</span>
                <span style="color:var(--gray-500);font-size:12px;">📅 ${m.target_date}</span>
            </div>`;
        }
    } else {
        html += `<div style="color:var(--gray-400);font-size:13px;text-align:center;padding:12px;">近期无里程碑</div>`;
    }
    html += `</div></div>`;

    // 阶段进度
    html += `
        <div>
            <h4 style="font-size:14px;font-weight:700;color:#6366f1;margin-bottom:8px;">📊 阶段进度</h4>
            <div style="background:white;border:1px solid var(--gray-200);border-radius:10px;padding:12px;">
    `;
    if (data.stages && data.stages.length > 0) {
        for (const s of data.stages) {
            const progressPercent = s.progress || 0;
            const barColor = progressPercent >= 100 ? '#16a34a' : progressPercent > 50 ? '#2563eb' : progressPercent > 0 ? '#f59e0b' : '#e5e7eb';
            html += `<div style="padding:6px 0;border-bottom:1px solid var(--gray-100);">
                <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
                    <span>${s.stage_name}</span>
                    <span style="font-weight:600;color:${barColor};">${progressPercent}%</span>
                </div>
                <div style="background:#e5e7eb;height:4px;border-radius:2px;overflow:hidden;">
                    <div style="background:${barColor};height:100%;width:${progressPercent}%;border-radius:2px;transition:width 0.3s ease;"></div>
                </div>
            </div>`;
        }
    }
    html += `</div></div>`;
    html += `</div>`;

    // 驻场人员
    if (data.members_onsite && data.members_onsite.length > 0) {
        html += `
            <div style="grid-column:1/-1;margin-top:12px;">
                <h4 style="font-size:14px;font-weight:700;color:#059669;margin-bottom:8px;">👥 当前驻场人员</h4>
                <div style="display:flex;flex-wrap:wrap;gap:8px;">
        `;
        for (const m of data.members_onsite) {
            html += `<span style="background:#ecfdf5;color:#059669;padding:4px 12px;border-radius:16px;font-size:12px;font-weight:500;">
                👤 ${m.name} <span style="opacity:0.7;">(${m.role})</span>
            </span>`;
        }
        html += `</div></div>`;
    }

    html += `</div>`;
    container.innerHTML = html;
}


/**
 * AI 生成站会纪要
 */
async function generateAiStandup(projectId) {
    const aiResult = document.getElementById('standupAiResult');
    if (!aiResult) return;

    const dateStr = document.getElementById('standupDatePicker')?.value || '';

    aiResult.style.display = 'block';
    aiResult.innerHTML = `
        <div style="background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden;">
            <div style="background:linear-gradient(135deg,#8b5cf6,#6366f1);padding:20px 24px;color:white;">
                <div style="display:flex;align-items:center;gap:12px;">
                    <div style="width:44px;height:44px;background:rgba(255,255,255,0.2);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;">🤖</div>
                    <div>
                        <div style="font-size:17px;font-weight:700;">AI 站会纪要生成中</div>
                        <div style="font-size:12px;opacity:0.8;margin-top:2px;">分析昨日成果 · 整理今日计划 · 识别风险点</div>
                    </div>
                </div>
            </div>
            <div style="padding:40px;text-align:center;">
                <div class="spinner" style="margin:0 auto 16px;"></div>
                <div style="color:var(--gray-500);font-size:13px;">🧠 正在调用 AI 生成专业站会纪要...</div>
            </div>
        </div>
    `;

    try {
        const res = await api.post(`/standup/${projectId}/ai-generate`, { date: dateStr });

        if (res.standup) {
            const htmlContent = typeof marked !== 'undefined' ? marked.parse(res.standup) : res.standup.replace(/\n/g, '<br>');
            aiResult.innerHTML = `
                <div style="background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden;">
                    <div style="background:linear-gradient(135deg,#8b5cf6,#6366f1);padding:20px 24px;color:white;">
                        <div style="display:flex;align-items:center;justify-content:space-between;">
                            <div style="display:flex;align-items:center;gap:12px;">
                                <div style="width:44px;height:44px;background:rgba(255,255,255,0.2);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;">📋</div>
                                <div>
                                    <div style="font-size:17px;font-weight:700;">AI 站会纪要</div>
                                    <div style="font-size:12px;opacity:0.8;margin-top:2px;">${dateStr || '今日'}</div>
                                </div>
                            </div>
                            <div style="display:flex;gap:8px;">
                                <button class="btn btn-sm" style="background:rgba(255,255,255,0.2);color:white;border:1px solid rgba(255,255,255,0.3);" onclick="copyStandupContent()">📋 复制</button>
                                <button class="btn btn-sm" style="background:rgba(255,255,255,0.2);color:white;border:1px solid rgba(255,255,255,0.3);" onclick="saveStandupArchive(${projectId}, '${dateStr}')">💾 保存</button>
                                <button class="btn btn-sm" style="background:#25d366;color:white;border:none;" onclick="pushStandupToWecom(${projectId}, '${dateStr}')">📤 推送企微</button>
                            </div>
                        </div>
                    </div>
                    <div id="standupMarkdownContent" style="padding:24px;line-height:1.7;color:#374151;">
                        <div class="markdown-content">${htmlContent}</div>
                    </div>
                </div>
            `;
        } else {
            aiResult.innerHTML = `
                <div style="background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);padding:24px;text-align:center;color:var(--danger);">
                    <div style="font-size:32px;margin-bottom:8px;">⚠️</div>
                    AI 未能生成纪要${res.error ? ': ' + res.error : ''}
                </div>
            `;
        }
    } catch (e) {
        aiResult.innerHTML = `
            <div style="background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);padding:24px;text-align:center;color:var(--danger);">
                <div style="font-size:32px;margin-bottom:8px;">❌</div>
                生成失败: ${e.message}
            </div>
        `;
    }
}


/**
 * 复制站会纪要内容
 */
function copyStandupContent() {
    const el = document.getElementById('standupMarkdownContent');
    if (!el) return;
    navigator.clipboard.writeText(el.innerText).then(() => {
        showToast ? showToast('✅ 纪要内容已复制到剪贴板') : alert('已复制到剪贴板');
    }).catch(() => {
        alert('复制失败，请手动复制');
    });
}


/**
 * 保存站会纪要到归档
 */
async function saveStandupArchive(projectId, dateStr) {
    const el = document.getElementById('standupMarkdownContent');
    if (!el) return;

    try {
        await api.post(`/standup/${projectId}/save`, {
            content: el.innerText,
            date: dateStr || new Date().toISOString().slice(0, 10)
        });
        showToast ? showToast('✅ 纪要已保存到归档') : alert('已保存');
    } catch (e) {
        alert('保存失败: ' + e.message);
    }
}


/**
 * 推送站会纪要到企业微信
 */
async function pushStandupToWecom(projectId, dateStr) {
    try {
        const res = await api.post(`/standup/${projectId}/push-wecom`, { date: dateStr });
        if (res.success) {
            showToast ? showToast('✅ 已推送到企业微信！') : alert('已推送');
        } else {
            alert('推送失败: ' + (res.message || '未知错误'));
        }
    } catch (e) {
        alert('推送失败: ' + e.message);
    }
}


/**
 * 加载站会纪要历史
 */
async function loadStandupHistory(projectId) {
    const panel = document.getElementById('standupHistoryPanel');
    if (!panel) return;

    panel.style.display = 'block';
    panel.innerHTML = `
        <div style="background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden;">
            <div style="background:linear-gradient(135deg,#0ea5e9,#2563eb);padding:16px 24px;color:white;">
                <div style="font-size:16px;font-weight:700;">📜 站会纪要历史</div>
            </div>
            <div style="padding:24px;text-align:center;">
                <div class="spinner" style="margin:0 auto;"></div>
            </div>
        </div>
    `;

    try {
        const history = await api.get(`/standup/history?project_id=${projectId}&limit=20`);

        if (history.length === 0) {
            panel.innerHTML = `
                <div style="background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden;">
                    <div style="background:linear-gradient(135deg,#0ea5e9,#2563eb);padding:16px 24px;color:white;">
                        <div style="font-size:16px;font-weight:700;">📜 站会纪要历史</div>
                    </div>
                    <div style="padding:32px;text-align:center;color:var(--gray-400);">
                        暂无历史纪要
                    </div>
                </div>
            `;
            return;
        }

        let historyHtml = `
            <div style="background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden;">
                <div style="background:linear-gradient(135deg,#0ea5e9,#2563eb);padding:16px 24px;color:white;display:flex;justify-content:space-between;align-items:center;">
                    <div style="font-size:16px;font-weight:700;">📜 站会纪要历史 (${history.length}条)</div>
                    <button class="btn btn-sm" style="background:rgba(255,255,255,0.2);color:white;border:1px solid rgba(255,255,255,0.3);" onclick="document.getElementById('standupHistoryPanel').style.display='none'">✕ 关闭</button>
                </div>
                <div style="max-height:400px;overflow-y:auto;">
        `;

        for (const item of history) {
            historyHtml += `
                <div style="padding:12px 24px;border-bottom:1px solid var(--gray-100);cursor:pointer;" onclick="this.querySelector('.history-content').style.display = this.querySelector('.history-content').style.display === 'none' ? 'block' : 'none'">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <span style="font-weight:600;font-size:14px;">📅 ${item.report_date}</span>
                            <span style="color:var(--gray-400);font-size:12px;margin-left:8px;">${item.generated_by === 'ai' ? '🤖 AI生成' : '📝 手动'}</span>
                        </div>
                        <span style="color:var(--gray-400);font-size:11px;">${item.created_at || ''}</span>
                    </div>
                    <div class="history-content" style="display:none;margin-top:12px;padding:12px;background:var(--gray-50);border-radius:8px;font-size:13px;line-height:1.6;white-space:pre-wrap;max-height:300px;overflow-y:auto;">
                        ${item.content || '无内容'}
                    </div>
                </div>
            `;
        }

        historyHtml += `</div></div>`;
        panel.innerHTML = historyHtml;

    } catch (e) {
        panel.innerHTML = `
            <div style="background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);padding:24px;text-align:center;color:var(--danger);">
                加载历史失败: ${e.message}
            </div>
        `;
    }
}


// ========== 全局每日简报面板 ==========

/**
 * 在仪表盘中显示全局简报面板
 */
async function showGlobalBriefingPanel() {
    openModal('briefingModal');
    const container = document.getElementById('briefingContent');
    if (!container) return;

    container.innerHTML = `
        <div style="text-align:center;padding:40px;">
            <div class="spinner" style="margin:0 auto 16px;"></div>
            <div style="color:var(--gray-500);">正在生成 AI 每日简报...</div>
        </div>
    `;

    try {
        const result = await api.get('/standup/daily-briefing');

        if (result.briefing) {
            const htmlContent = typeof marked !== 'undefined' ? marked.parse(result.briefing) : result.briefing.replace(/\n/g, '<br>');

            container.innerHTML = `
                <div style="margin-bottom:16px;display:flex;flex-wrap:wrap;gap:12px;">
                    <div style="flex:1;min-width:100px;background:linear-gradient(135deg,#dbeafe,#eff6ff);padding:16px;border-radius:12px;text-align:center;">
                        <div style="font-size:24px;font-weight:800;color:#2563eb;">${result.stats?.active_projects || 0}</div>
                        <div style="font-size:11px;color:#6b7280;margin-top:4px;">活跃项目</div>
                    </div>
                    <div style="flex:1;min-width:100px;background:linear-gradient(135deg,#fef3c7,#fffbeb);padding:16px;border-radius:12px;text-align:center;">
                        <div style="font-size:24px;font-weight:800;color:#d97706;">${result.stats?.total_blocking || 0}</div>
                        <div style="font-size:11px;color:#6b7280;margin-top:4px;">阻塞问题</div>
                    </div>
                    <div style="flex:1;min-width:100px;background:linear-gradient(135deg,#fce7f3,#fdf2f8);padding:16px;border-radius:12px;text-align:center;">
                        <div style="font-size:24px;font-weight:800;color:#db2777;">${result.stats?.total_milestones || 0}</div>
                        <div style="font-size:11px;color:#6b7280;margin-top:4px;">近期里程碑</div>
                    </div>
                </div>
                <div style="line-height:1.7;color:#374151;" class="markdown-content">
                    ${htmlContent}
                </div>
                <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
                    <button class="btn btn-sm btn-outline" onclick="copyBriefingContent()">📋 复制</button>
                    <button class="btn btn-sm" style="background:#25d366;color:white;border:none;" onclick="pushGlobalBriefingToWecom()">📤 推送到企业微信</button>
                </div>
            `;
        }
    } catch (e) {
        container.innerHTML = `<div style="color:var(--danger);text-align:center;padding:24px;">加载失败: ${e.message}</div>`;
    }
}


/**
 * 复制简报内容
 */
function copyBriefingContent() {
    const el = document.getElementById('briefingContent');
    if (!el) return;
    navigator.clipboard.writeText(el.innerText).then(() => {
        showToast ? showToast('✅ 简报内容已复制') : alert('已复制');
    }).catch(() => alert('复制失败'));
}


/**
 * 推送全局简报到企业微信
 */
async function pushGlobalBriefingToWecom() {
    try {
        const btn = event.target;
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = '推送中...';

        const res = await api.post('/standup/push-wecom');

        if (res.success) {
            if (typeof showToast !== 'undefined') {
                showToast('✅ 简报已推送到企业微信！');
            } else {
                alert('简报已推送到企业微信！');
            }
        } else {
            console.error("Push failed:", res);
            alert('推送失败: ' + (res.message || '未知错误'));
        }

        btn.disabled = false;
        btn.textContent = originalText;
    } catch (e) {
        console.error("Push error:", e);
        alert('推送请求失败: ' + e.message + '\n请检查网络连接或后端日志。');
        if (event.target) {
            event.target.disabled = false;
            event.target.textContent = '📤 推送到企业微信';
        }
    }
}


// ========== 企业微信配置面板 ==========

/**
 * 显示企业微信配置面板
 */
async function showWecomConfigPanel() {
    openModal('wecomConfigModal');
    const container = document.getElementById('wecomConfigContent');
    if (!container) return;

    container.innerHTML = `<div style="text-align:center;padding:20px;"><div class="spinner" style="margin:0 auto;"></div></div>`;

    try {
        const config = await api.get('/standup/wecom-config');
        container.innerHTML = `
            <div style="padding:4px 0;">
                <div style="margin-bottom:16px;">
                    <label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px;">Webhook URL</label>
                    <input type="text" id="wecomWebhookInput" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." 
                        value="${config.webhook_preview || ''}"
                        style="width:100%;padding:10px 14px;border:1px solid var(--gray-300);border-radius:8px;font-size:13px;">
                    <div style="font-size:11px;color:var(--gray-400);margin-top:4px;">在企业微信群聊中添加"群机器人"，获取 Webhook 地址</div>
                </div>
                <div style="margin-bottom:16px;">
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                        <input type="checkbox" id="wecomEnabledCheckbox" ${config.enabled ? 'checked' : ''}>
                        <span style="font-size:13px;font-weight:600;">启用企业微信推送</span>
                    </label>
                </div>
                <div style="display:flex;gap:8px;justify-content:flex-end;">
                    <button class="btn btn-outline btn-sm" onclick="testWecomPush()">🔔 测试推送</button>
                    <button class="btn btn-primary btn-sm" onclick="saveWecomConfig()">💾 保存</button>
                </div>
                <div style="margin-top:16px;padding:12px;background:var(--gray-50);border-radius:8px;font-size:12px;color:var(--gray-500);line-height:1.6;">
                    <strong>📌 自动推送说明：</strong><br>
                    • 每个工作日 08:30 自动推送全局晨会简报<br>
                    • 包含所有活跃项目概况、风险预警和管理建议<br>
                    • AI 智能生成，数据不足时自动降级为纯数据摘要<br>
                    • 也可手动点击"推送到企业微信"立即发送
                </div>
            </div>
        `;
    } catch (e) {
        container.innerHTML = `<div style="color:var(--danger);text-align:center;">加载配置失败: ${e.message}</div>`;
    }
}


/**
 * 保存企业微信配置
 */
async function saveWecomConfig() {
    const webhook = document.getElementById('wecomWebhookInput')?.value || '';
    const enabled = document.getElementById('wecomEnabledCheckbox')?.checked || false;

    try {
        const res = await api.post('/standup/wecom-config', { webhook, enabled });
        if (res.success) {
            if (typeof showToast !== 'undefined') {
                showToast('✅ ' + res.message);
            } else {
                alert(res.message);
            }
            closeModal('wecomConfigModal');
        }
    } catch (e) {
        alert('保存失败: ' + e.message);
    }
}


/**
 * 测试企业微信推送
 */
async function testWecomPush() {
    try {
        // 先保存当前配置
        await saveWecomConfig();

        const res = await api.post('/standup/push-wecom');
        if (res.success) {
            if (typeof showToast !== 'undefined') {
                showToast('✅ 测试推送成功！请查看企业微信群');
            } else {
                alert('测试推送成功！');
            }
        } else {
            alert('测试推送失败: ' + (res.message || '未知错误'));
        }
    } catch (e) {
        alert('推送失败: ' + e.message);
    }
}

/**
 * 导出 AI 正式项目报告 (.docx)
 */
async function exportFormalReport(projectId) {
    if (typeof showToast !== 'undefined') {
        showToast('🔄 正在通过 AI 生成正式报告，请稍候...');
    }

    try {
        const url = `/api/projects/${projectId}/export-formal-report`;
        // 直接在新窗口打开或通过 a 标签触发下载
        const link = document.createElement('a');
        link.href = url;
        link.download = ''; // 后端会提供文件名
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (e) {
        alert('导出失败: ' + e.message);
    }
}
