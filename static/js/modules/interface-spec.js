/**
 * 接口文档智能对照 - 前端模块
 * 依赖：全局 api (ApiClient), openModal, closeModal, showToast, marked
 */

const InterfaceSpec = {
    // 缓存数据
    _ourSpecs: [],
    _vendorSpecs: [],
    _comparisons: [],
    _currentProjectId: null,
    _uploadSource: null,
    _currentCategory: '手麻标准',
    _lastCategories: {
        'our_standard': '手麻标准',
        'vendor': '接口文档'
    },

    // ========== 入口：渲染整个 Tab 内容 ==========
    async renderTab(projectId) {
        this._currentProjectId = projectId;
        const container = document.getElementById('tabInterfaceSpec');
        if (!container) return;

        // 加载数据
        await this.loadAll();
    },

    async loadAll(forceMainUI = false) {
        this._isLoading = true;

        // 渲染之前先确保 category 同步
        const dashCat = document.getElementById('dashOurCategory')?.value;
        const mainCat = document.getElementById('compareCategory')?.value;
        if (dashCat) this._currentCategory = dashCat;
        else if (mainCat) this._currentCategory = mainCat;

        await Promise.all([
            this.loadOurSpecs(),
            this.loadVendorSpecs(),
            this.loadComparisons()
        ]);
        this._isLoading = false;

        const container = document.getElementById('tabInterfaceSpec');
        if (!container) return;

        // 如果两边都没数据，且没有强制进入 MainUI，显示 Dashboard 模式
        if (!forceMainUI && this._ourSpecs.length === 0 && this._vendorSpecs.length === 0) {
            this.renderSetupDashboard(container);
        } else {
            this.renderMainUI(container);
        }
    },

    // ========== 极简 Dashboard 模式 (Setup Portal) ==========
    renderSetupDashboard(container) {
        container.innerHTML = `
            <div class="interface-spec-dashboard" style="padding:20px; animation: fadeIn 0.4s ease-out;">
                <div style="text-align:center; margin-bottom:40px;">
                    <h2 style="font-size:28px; font-weight:800; background:linear-gradient(135deg, var(--primary), var(--secondary)); -webkit-background-clip:text; -webkit-text-fill-color:transparent; margin-bottom:12px;">
                        智能接口文档对齐中心
                    </h2>
                    <p style="color:var(--gray-500); font-size:15px; max-width:600px; margin:0 auto;">
                        通过 AI 智能解析，自动识别标准与私有接口差异，为您节省 90% 的文档整理时间。
                    </p>
                </div>

                <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap:24px; margin-bottom:40px;">
                    <!-- 我方标准卡片 -->
                    <div class="dashboard-card" style="background:white; border-radius:16px; border:1px solid var(--gray-200); padding:24px; box-shadow:0 10px 15px -3px rgba(0,0,0,0.05); transition:transform 0.2s; position:relative; overflow:hidden;">
                        <div style="position:absolute; top:0; left:0; right:0; height:4px; background:var(--primary);"></div>
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px;">
                            <div>
                                <h3 style="font-size:18px; font-weight:700; color:var(--gray-800); margin-bottom:4px;">我方标准规范</h3>
                                <p style="font-size:13px; color:var(--gray-500);">选择手麻或重症标准</p>
                            </div>
                            <span style="font-size:24px;">📘</span>
                        </div>
                        
                        <div style="margin-bottom:20px;">
                            <select id="dashOurCategory" class="form-control" onchange="InterfaceSpec.loadAll()" style="width:100%; border-radius:8px; padding:8px 12px; border:1px solid var(--gray-200);">
                                <option value="手麻标准" ${this._currentCategory === '手麻标准' ? 'selected' : ''}>手麻标准 (V2.0)</option>
                                <option value="重症标准" ${this._currentCategory === '重症标准' ? 'selected' : ''}>重症标准 (V1.5)</option>
                            </select>
                        </div>

                        <div id="dashOurUploadArea" class="upload-dropzone" 
                             style="border:2px dashed var(--gray-200); border-radius:12px; padding:30px; text-align:center; cursor:pointer; transition:all 0.2s;"
                             onclick="InterfaceSpec.openQuickUpload('our_standard')">
                            <div style="font-size:32px; margin-bottom:12px;">📄</div>
                            <div style="font-weight:600; font-size:14px; color:var(--gray-700);">粘贴文档或点击上传</div>
                            <div style="font-size:12px; color:var(--gray-400); margin-top:4px;">支持 PDF / Word / TXT</div>
                        </div>

                        <div id="dashOurStatus" style="margin-top:16px; font-size:13px; display:${this._ourSpecs.length > 0 ? 'block' : 'none'};">
                            <span style="color:var(--success); font-weight:600;">✓ 标准文档已就绪 (${this._ourSpecs.length} 个接口)</span>
                        </div>
                    </div>

                    <!-- 对方接口卡片 -->
                    <div class="dashboard-card" style="background:white; border-radius:16px; border:1px solid var(--gray-200); padding:24px; box-shadow:0 10px 15px -3px rgba(0,0,0,0.05); transition:transform 0.2s; position:relative; overflow:hidden;">
                        <div style="position:absolute; top:0; left:0; right:0; height:4px; background:var(--info);"></div>
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px;">
                            <div>
                                <h3 style="font-size:18px; font-weight:700; color:var(--gray-800); margin-bottom:4px;">第三方接口文档</h3>
                                <p style="font-size:13px; color:var(--gray-500);">上传医院或厂家接口说明</p>
                            </div>
                            <span style="font-size:24px;">🏥</span>
                        </div>

                        <div style="margin-bottom:20px;">
                            <input type="text" id="dashVendorName" class="form-control" placeholder="输入厂家/系统名称 (可选)" 
                                   style="width:100%; border-radius:8px; padding:8px 12px; border:1px solid var(--gray-200);">
                        </div>

                        <div id="dashVendorUploadArea" class="upload-dropzone" 
                             style="border:2px dashed var(--gray-200); border-radius:12px; padding:30px; text-align:center; cursor:pointer; transition:all 0.2s;"
                             onclick="InterfaceSpec.openQuickUpload('vendor')">
                            <div style="font-size:32px; margin-bottom:12px;">🔗</div>
                            <div style="font-weight:600; font-size:14px; color:var(--gray-700);">粘贴文档或点击上传</div>
                            <div style="font-size:12px; color:var(--gray-400); margin-top:4px;">支持多接口内容批量解析</div>
                        </div>

                        <div id="dashVendorStatus" style="margin-top:16px; font-size:13px; display:${this._vendorSpecs.length > 0 ? 'block' : 'none'};">
                            <span style="color:var(--success); font-weight:600;">✓ 接口文档已就绪 (${this._vendorSpecs.length} 个接口)</span>
                        </div>
                    </div>
                </div>

                <!-- 核心操作区 -->
                <div style="text-align:center;">
                    <button class="btn btn-ai" id="btnDashRun" onclick="InterfaceSpec.runComparisonFromDash()" 
                            style="padding:16px 48px; border-radius:30px; font-size:18px; font-weight:700; box-shadow:0 10px 25px -5px rgba(99,102,241,0.4);">
                        🔍 一键智能比对 (AI Sync)
                    </button>
                    <div style="margin-top:16px; font-size:13px; color:var(--gray-400);">
                        AI 将自动分析两份文档，提取字段对应关系并标注差异点
                    </div>
                </div>
            </div>
        `;
    },

    // ========== 主应用模式 (原有 Tab 模式) ==========
    renderMainUI(container) {
        container.innerHTML = `
            <div class="interface-spec-module">
                <!-- 顶部操作栏 -->
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:20px;">
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <button class="btn btn-primary btn-sm" onclick="InterfaceSpec.showUploadModal('our_standard')">
                            📤 上传我方标准
                        </button>
                        <button class="btn btn-info btn-sm" onclick="InterfaceSpec.showUploadModal('vendor')">
                            📥 上传对方接口
                        </button>
                        <select id="compareCategory" class="form-control" onchange="InterfaceSpec.loadAll()" style="width:130px;height:32px;padding:0 8px;font-size:12px;border-radius:6px;border-color:var(--gray-200);">
                            <option value="手麻标准" ${this._currentCategory === '手麻标准' ? 'selected' : ''}>手麻标准</option>
                            <option value="重症标准" ${this._currentCategory === '重症标准' ? 'selected' : ''}>重症标准</option>
                            <option value="接口文档" ${this._currentCategory === '接口文档' ? 'selected' : ''}>接口文档</option>
                        </select>
                        <button class="btn btn-ai btn-sm" onclick="InterfaceSpec.runComparison()" id="btnRunComparison">
                            🔍 一键智能对照
                        </button>
                        <button class="btn btn-outline btn-sm" onclick="InterfaceSpec.generateReport()">
                            📊 对照报告
                        </button>
                        <button class="btn btn-outline btn-sm" onclick="InterfaceSpec.resetDashboard()" style="color:var(--danger);">
                            🔄 重新对齐
                        </button>
                    </div>
                </div>

                <div id="specOverview" style="margin-bottom:20px;"></div>

                <div class="spec-sub-tabs" style="display:flex;gap:4px;background:var(--gray-100);padding:4px;border-radius:10px;margin-bottom:16px;">
                    <div class="spec-sub-tab active" onclick="InterfaceSpec.switchSubTab('comparison')" data-subtab="comparison"
                         style="flex:1;text-align:center;padding:10px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;transition:all 0.2s;">
                        🔍 对照结果
                    </div>
                    <div class="spec-sub-tab" onclick="InterfaceSpec.switchSubTab('our')" data-subtab="our"
                         style="flex:1;text-align:center;padding:10px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;transition:all 0.2s;">
                        📋 我方标准
                    </div>
                    <div class="spec-sub-tab" onclick="InterfaceSpec.switchSubTab('vendor')" data-subtab="vendor"
                         style="flex:1;text-align:center;padding:10px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;transition:all 0.2s;">
                        🏥 对方接口
                    </div>
                    <div class="spec-sub-tab" onclick="InterfaceSpec.openChatModal()"
                         style="flex:1;text-align:center;padding:10px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700;transition:all 0.2s;color:var(--primary);background:rgba(99,102,241,0.05);">
                        🤖 接口 AI 助手
                    </div>
                </div>
 
                <div id="specSubContent">
                    <div id="specComparisonView"></div>
                    <div id="specOurView" style="display:none;"></div>
                    <div id="specVendorView" style="display:none;"></div>
                </div>
            </div>
        `;
        this.renderOverview();
        this.renderComparisonView();
    },

    resetDashboard() {
        if (confirm('确认重置吗？这将清空当前页面的统计但不会删除已解析的记录。')) {
            this._ourSpecs = [];
            this._vendorSpecs = [];
            this.renderTab(this._currentProjectId);
        }
    },

    switchSubTab(name) {
        // 切换高亮
        document.querySelectorAll('.spec-sub-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.subtab === name);
            t.style.background = t.dataset.subtab === name ? 'white' : 'transparent';
            t.style.color = t.dataset.subtab === name ? 'var(--primary)' : 'var(--gray-600)';
            t.style.boxShadow = t.dataset.subtab === name ? '0 1px 3px rgba(0,0,0,0.1)' : 'none';
        });
        // 切换内容
        document.getElementById('specComparisonView').style.display = name === 'comparison' ? 'block' : 'none';
        document.getElementById('specOurView').style.display = name === 'our' ? 'block' : 'none';
        document.getElementById('specVendorView').style.display = name === 'vendor' ? 'block' : 'none';

        const chatView = document.getElementById('specChatView');
        if (chatView) chatView.style.display = name === 'chat' ? 'block' : 'none';

        if (name === 'chat') {
            setTimeout(() => document.getElementById('specChatInput')?.focus(), 100);
        }

        if (name === 'our') this.renderSpecList(this._ourSpecs, 'specOurView', 'our_standard');
        if (name === 'vendor') this.renderSpecList(this._vendorSpecs, 'specVendorView', 'vendor');
    },

    // ========== 数据加载 ==========
    async loadOurSpecs() {
        try {
            const cat = this._currentCategory;
            // 获取我方标准：同时获取全局标准（project_id is NULL）和本项目特定的标准
            let url = `/projects/${this._currentProjectId}/interface-specs?source=our_standard`;
            if (cat) url += `&category=${encodeURIComponent(cat)}`;

            let specs = await api.get(url, { silent: true });

            // 如果本项目下没有，尝试获取全局标准（兜底逻辑，确保标准始终可见）
            if (specs.length === 0) {
                let globalUrl = `/interface-specs/standard`;
                if (cat) globalUrl += `?category=${encodeURIComponent(cat)}`;
                specs = await api.get(globalUrl, { silent: true });
            }

            this._ourSpecs = specs;
        } catch { this._ourSpecs = []; }
    },

    async loadVendorSpecs() {
        try {
            const cat = this._currentCategory;
            let url = `/projects/${this._currentProjectId}/interface-specs?source=vendor`;
            if (cat) url += `&category=${encodeURIComponent(cat)}`;
            this._vendorSpecs = await api.get(url, { silent: true });
        } catch { this._vendorSpecs = []; }
    },

    async loadComparisons() {
        try {
            const cat = this._currentCategory;
            let url = `/projects/${this._currentProjectId}/interface-comparisons`;
            if (cat) url += `?category=${encodeURIComponent(cat)}`;
            this._comparisons = await api.get(url, { silent: true });
        } catch { this._comparisons = []; }
    },

    openChatModal() {
        const modal = document.getElementById('interfaceChatModal');
        if (modal) {
            // 确保不被父容器 overflow 限制，移动到 body 下
            if (modal.parentElement !== document.body) {
                document.body.appendChild(modal);
            }
            modal.style.zIndex = '9999';
        }
        openModal('interfaceChatModal');
        setTimeout(() => document.getElementById('modalChatInput')?.focus(), 300);
    },

    async sendChatMessage(isModal = false) {
        const inputId = isModal ? 'modalChatInput' : 'specChatInput';
        const msgContainerId = isModal ? 'modalChatMessages' : 'specChatMessages';

        const input = document.getElementById(inputId);
        const msgContainer = document.getElementById(msgContainerId);
        if (!input || !input.value.trim()) return;

        const text = input.value.trim();
        input.value = '';

        // 显示用户消息
        msgContainer.innerHTML += `<div class="ai-message user">${text}</div>`;
        msgContainer.scrollTop = msgContainer.scrollHeight;

        // 显示 Loading
        const loadingId = 'ai-loading-' + Date.now();
        msgContainer.innerHTML += `<div class="ai-message assistant" id="${loadingId}"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
        msgContainer.scrollTop = msgContainer.scrollHeight;

        try {
            const res = await api.post(`/projects/${this._currentProjectId}/interface-specs/chat`, {
                message: text,
                category: document.getElementById('compareCategory')?.value || '手麻标准'
            });

            const loadingEl = document.getElementById(loadingId);
            if (loadingEl) {
                loadingEl.innerHTML = marked.parse(res.answer || res);
            }
        } catch (e) {
            const loadingEl = document.getElementById(loadingId);
            if (loadingEl) {
                loadingEl.innerHTML = `<span style="color:var(--danger);">抱歉，助手暂时无法响应: ${e.message}</span>`;
            }
        }
        msgContainer.scrollTop = msgContainer.scrollHeight;
    },

    // ========== 统计概览 ==========
    renderOverview() {
        const el = document.getElementById('specOverview');
        if (!el) return;

        const ourCount = this._ourSpecs.length;
        const vendorCount = this._vendorSpecs.length;
        const compCount = this._comparisons.length;
        const gapCount = this._comparisons.reduce((s, c) => s + (c.gap_count || 0), 0);
        const transformCount = this._comparisons.reduce((s, c) => s + (c.transform_count || 0), 0);
        const missingCount = this._comparisons.filter(c => !c.vendor_spec_id).length;

        el.innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;">
                <div style="background:var(--gray-50);border-radius:10px;padding:14px;text-align:center;">
                    <div style="font-size:22px;font-weight:700;color:var(--primary);">${ourCount}</div>
                    <div style="font-size:11px;color:var(--gray-500);margin-top:4px;">我方标准接口</div>
                </div>
                <div style="background:var(--gray-50);border-radius:10px;padding:14px;text-align:center;">
                    <div style="font-size:22px;font-weight:700;color:var(--info);">${vendorCount}</div>
                    <div style="font-size:11px;color:var(--gray-500);margin-top:4px;">对方接口</div>
                </div>
                <div style="background:${compCount > 0 ? '#f0fdf4' : 'var(--gray-50)'};border-radius:10px;padding:14px;text-align:center;">
                    <div style="font-size:22px;font-weight:700;color:var(--success);">${compCount}</div>
                    <div style="font-size:11px;color:var(--gray-500);margin-top:4px;">已对照</div>
                </div>
                <div style="background:${gapCount > 0 ? '#fef2f2' : 'var(--gray-50)'};border-radius:10px;padding:14px;text-align:center;">
                    <div style="font-size:22px;font-weight:700;color:${gapCount > 0 ? 'var(--danger)' : 'var(--success)'};">${gapCount}</div>
                    <div style="font-size:11px;color:var(--gray-500);margin-top:4px;">字段差异</div>
                </div>
                <div style="background:${transformCount > 0 ? '#fffbeb' : 'var(--gray-50)'};border-radius:10px;padding:14px;text-align:center;">
                    <div style="font-size:22px;font-weight:700;color:${transformCount > 0 ? 'var(--warning)' : 'var(--success)'};">${transformCount}</div>
                    <div style="font-size:11px;color:var(--gray-500);margin-top:4px;">需转换</div>
                </div>
                <div style="background:${missingCount > 0 ? '#fef2f2' : 'var(--gray-50)'};border-radius:10px;padding:14px;text-align:center;">
                    <div style="font-size:22px;font-weight:700;color:${missingCount > 0 ? 'var(--danger)' : 'var(--success)'};">${missingCount}</div>
                    <div style="font-size:11px;color:var(--gray-500);margin-top:4px;">对方缺失接口</div>
                </div>
            </div>
        `;
    },

    // ========== 对照结果视图 ==========
    renderComparisonView() {
        const el = document.getElementById('specComparisonView');
        if (!el) return;

        if (this._comparisons.length === 0) {
            el.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🔍</div>
                    <div class="empty-state-text">暂无对照结果</div>
                    <div class="empty-state-hint">请先上传我方标准文档和对方接口文档，然后点击"一键智能对照"</div>
                </div>
            `;
            return;
        }

        let html = '<div class="table-container"><table class="table"><thead><tr>';
        html += '<th>系统</th><th>我方接口</th><th>对方接口</th><th>匹配度</th>';
        html += '<th>差异</th><th>需转换</th><th>状态</th><th>操作</th>';
        html += '</tr></thead><tbody>';

        for (const c of this._comparisons) {
            const isGood = (c.gap_count || 0) === 0 && (c.transform_count || 0) === 0;
            const isMissing = !c.vendor_spec_id;
            const statusBadge = isMissing
                ? '<span class="badge badge-danger">对方缺失</span>'
                : isGood
                    ? '<span class="badge badge-success">完全匹配</span>'
                    : (c.gap_count || 0) > 0
                        ? '<span class="badge badge-danger">有差异</span>'
                        : '<span class="badge badge-warning">需转换</span>';

            const confidenceBar = c.match_confidence != null
                ? `<div style="display:flex;align-items:center;gap:6px;">
                     <div style="width:60px;height:6px;background:var(--gray-200);border-radius:3px;overflow:hidden;">
                       <div style="height:100%;width:${(c.match_confidence * 100)}%;background:${c.match_confidence >= 0.8 ? 'var(--success)' : c.match_confidence >= 0.5 ? 'var(--warning)' : 'var(--danger)'};border-radius:3px;"></div>
                     </div>
                     <span style="font-size:11px;color:var(--gray-500);">${Math.round(c.match_confidence * 100)}%</span>
                   </div>`
                : '-';

            html += `<tr>
                <td><span class="badge badge-info">${c.system_type || '-'}</span></td>
                <td>
                    <div style="font-weight:600;font-size:13px;">${c.our_name || '-'}</div>
                    <div style="font-size:11px;color:var(--gray-400);">${c.our_transcode || ''}</div>
                </td>
                <td>
                    ${isMissing ? '<span style="color:var(--danger);font-size:13px;">❌ 未找到</span>'
                    : `<div style="font-weight:500;font-size:13px;">${c.vendor_name || '-'}</div>
                       <div style="font-size:11px;color:var(--gray-400);">${c.vendor_transcode || ''}</div>`}
                </td>
                <td>${confidenceBar}</td>
                <td style="font-weight:600;color:${(c.gap_count || 0) > 0 ? 'var(--danger)' : 'var(--success)'};">${c.gap_count || 0}</td>
                <td style="font-weight:600;color:${(c.transform_count || 0) > 0 ? 'var(--warning)' : 'var(--success)'};">${c.transform_count || 0}</td>
                <td>${statusBadge}</td>
                <td>
                    ${!isMissing ? `<button class="btn btn-outline btn-xs" onclick="InterfaceSpec.showFieldDetail(${c.id})">查看字段</button>` : ''}
                </td>
            </tr>`;
        }

        html += '</tbody></table></div>';
        el.innerHTML = html;
    },

    // ========== 接口规范列表 ==========
    renderSpecList(specs, containerId, source) {
        const el = document.getElementById(containerId);
        if (!el) return;

        if (specs.length === 0) {
            const label = source === 'our_standard' ? '我方标准' : '对方';
            el.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">${source === 'our_standard' ? '📋' : '🏥'}</div>
                    <div class="empty-state-text">暂未上传${label}接口文档</div>
                    <div class="empty-state-hint">请点击上方按钮上传文档，AI 将自动解析</div>
                </div>
            `;
            return;
        }

        let html = '';
        // 按 system_type 分组
        const groups = {};
        for (const s of specs) {
            const key = s.system_type || '其他';
            if (!groups[key]) groups[key] = [];
            groups[key].push(s);
        }

        for (const [sysType, items] of Object.entries(groups)) {
            html += `<div style="margin-bottom:16px;">
                <div style="font-weight:600;font-size:14px;color:var(--gray-700);margin-bottom:8px;display:flex;align-items:center;gap:8px;">
                    <span class="badge badge-info">${sysType}</span>
                    <span style="font-size:12px;color:var(--gray-400);">${items.length} 个接口</span>
                </div>`;

            for (const spec of items) {
                html += `
                <div class="stage-item" style="margin-bottom:8px;">
                    <div class="stage-header" onclick="InterfaceSpec.toggleSpecFields(this)" style="padding:10px 14px;">
                        <div class="stage-info">
                            <span class="stage-arrow">▶</span>
                            <span style="font-weight:600;font-size:13px;">${spec.interface_name}</span>
                            ${spec.category ? `<span class="badge badge-outline" style="font-size:10px;padding:1px 4px;margin-left:4px;">${spec.category}</span>` : ''}
                            <span style="font-size:11px;color:var(--gray-400);">${spec.transcode || ''}</span>
                            <span class="badge badge-gray" style="font-size:10px;">${spec.protocol || ''}</span>
                            <span style="font-size:11px;color:var(--gray-500);">${spec.field_count || 0} 字段</span>
                        </div>
                        <button class="btn btn-danger btn-xs" onclick="event.stopPropagation();InterfaceSpec.deleteSpec(${spec.id})">删除</button>
                    </div>
                    <div class="stage-body" style="padding:0;max-height:0;overflow:hidden;">
                        ${spec.description ? `<div style="font-size:12px;color:var(--gray-500);margin-bottom:10px;padding:8px 14px 0;">${spec.description}</div>` : ''}
                        ${spec.fields && spec.fields.length > 0 ? this._renderFieldsTable(spec.fields) : '<div style="padding:14px;color:var(--gray-400);font-size:12px;">无字段定义</div>'}
                    </div>
                </div>`;
            }
            html += '</div>';
        }

        el.innerHTML = html;
    },

    _renderFieldsTable(fields) {
        let html = '<div class="table-container" style="padding:0 14px 14px;"><table class="table" style="font-size:12px;min-width:500px;">';
        html += '<thead><tr><th>#</th><th>字段名</th><th>中文名</th><th>类型</th><th>必填</th><th>说明</th></tr></thead><tbody>';
        for (const f of fields) {
            html += `<tr>
                <td style="color:var(--gray-400);">${f.field_order + 1}</td>
                <td style="font-weight:600;font-family:monospace;">${f.field_name}</td>
                <td>${f.field_name_cn || '-'}</td>
                <td><span class="badge badge-gray">${f.field_type || '-'}</span></td>
                <td>${f.is_required ? '<span style="color:var(--danger);font-weight:700;">✱ 必填</span>' : f.is_primary_key ? '<span style="color:var(--primary);font-weight:700;">🔑 主键</span>' : '-'}</td>
                <td style="color:var(--gray-500);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${(f.description || '') + ' ' + (f.remark || '')}">${f.description || f.remark || '-'}</td>
            </tr>`;
        }
        html += '</tbody></table></div>';
        return html;
    },

    toggleSpecFields(headerEl) {
        const item = headerEl.parentElement;
        item.classList.toggle('expanded');
        const body = item.querySelector('.stage-body');
        if (item.classList.contains('expanded')) {
            body.style.maxHeight = body.scrollHeight + 'px';
            body.style.padding = '0';
        } else {
            body.style.maxHeight = '0';
            body.style.padding = '0';
        }
    },

    // ========== 字段对照详情弹窗 ==========
    async showFieldDetail(comparisonId) {
        openModal('fieldDetailModal');
        const body = document.getElementById('fieldDetailBody');
        body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--gray-500);"><div class="spinner" style="margin:0 auto 12px;"></div>加载字段对照...</div>';

        try {
            const data = await api.get(`/interface-comparisons/${comparisonId}/detail`);
            this._renderFieldDetail(data);
        } catch (e) {
            body.innerHTML = `<div style="text-align:center;padding:40px;color:var(--danger);">加载失败: ${e.message}</div>`;
        }
    },

    _renderFieldDetail(data) {
        const body = document.getElementById('fieldDetailBody');
        const mappings = data.mappings || [];

        // 状态颜色/标签映射
        const statusMap = {
            'matched': { label: '✅ 完全匹配', color: '#10b981', bg: '#f0fdf4' },
            'name_different': { label: '🔄 名称不同', color: '#f59e0b', bg: '#fffbeb' },
            'type_mismatch': { label: '⚠️ 类型不匹配', color: '#ef4444', bg: '#fef2f2' },
            'needs_transform': { label: '🔧 需转换', color: '#f59e0b', bg: '#fffbeb' },
            'missing_in_vendor': { label: '❌ 对方缺失', color: '#ef4444', bg: '#fef2f2' },
            'extra_in_vendor': { label: 'ℹ️ 对方额外', color: '#6b7280', bg: '#f9fafb' },
        };

        // 统计
        const stats = {};
        for (const m of mappings) {
            stats[m.mapping_status] = (stats[m.mapping_status] || 0) + 1;
        }

        let html = `
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
                ${Object.entries(stats).map(([k, v]) => {
            const s = statusMap[k] || { label: k, color: '#6b7280', bg: '#f9fafb' };
            return `<span style="background:${s.bg};color:${s.color};padding:4px 10px;border-radius:12px;font-size:12px;font-weight:500;">${s.label}: ${v}</span>`;
        }).join('')}
            </div>
            <div class="table-container">
            <table class="table" style="font-size:12px;">
                <thead><tr>
                    <th>状态</th>
                    <th>我方字段</th>
                    <th>→</th>
                    <th>对方字段</th>
                    <th>我方类型</th>
                    <th>对方类型</th>
                    <th>转换规则</th>
                    <th>确认</th>
                </tr></thead>
                <tbody>
        `;

        for (const m of mappings) {
            const s = statusMap[m.mapping_status] || { label: m.mapping_status, color: '#6b7280', bg: '#f9fafb' };
            html += `<tr style="background:${m.is_confirmed ? '#f0fdf4' : s.bg};">
                <td><span style="color:${s.color};font-size:11px;font-weight:600;">${s.label}</span></td>
                <td>
                    <div style="font-family:monospace;font-weight:600;">${m.our_field_name || '-'}</div>
                </td>
                <td style="color:var(--gray-300);">→</td>
                <td>
                    <div style="font-family:monospace;font-weight:500;">${m.vendor_field_name || '-'}</div>
                </td>
                <td><span class="badge badge-gray">${m.our_type || '-'}</span></td>
                <td><span class="badge badge-gray">${m.vendor_type || '-'}</span></td>
                <td style="font-size:11px;color:var(--gray-600);max-width:180px;overflow:hidden;text-overflow:ellipsis;" title="${m.transform_rule || ''}">${m.transform_rule || '-'}</td>
                <td>
                    ${m.is_confirmed
                    ? '<span style="color:var(--success);font-weight:600;">✓ 已确认</span>'
                    : `<button class="btn btn-success btn-xs" onclick="InterfaceSpec.confirmMapping(${m.id})">确认</button>`
                }
                </td>
            </tr>`;
        }

        html += '</tbody></table></div>';
        body.innerHTML = html;
    },

    async confirmMapping(mappingId) {
        try {
            await api.put(`/field-mappings/${mappingId}/confirm`, {});
            showToast('已确认');
            // 找到按钮所在行，更新 UI
            const btn = event.target;
            btn.outerHTML = '<span style="color:var(--success);font-weight:600;">✓ 已确认</span>';
        } catch (e) {
            showToast('确认失败: ' + e.message, 'error');
        }
    },

    // ========== 上传解析 ==========
    showUploadModal(source) {
        this._uploadSource = source;
        const title = source === 'our_standard' ? '上传我方标准接口文档' : '上传对方接口文档';
        const showVendor = source === 'vendor';

        document.getElementById('specUploadTitle').textContent = title;
        document.getElementById('specVendorNameGroup').style.display = showVendor ? 'block' : 'none';
        document.getElementById('specCategoryGroup').style.display = 'block'; // 始终显示分类，减少误操作

        document.getElementById('specDocText').value = '';
        document.getElementById('specDocText').placeholder = '将接口文档内容粘贴到此处，或通过上方文件选择器上传文件自动提取...\n\n支持格式：PDF、Word、纯文本\nAI 将自动识别并结构化提取所有接口定义、字段、类型、必填项等信息。';
        document.getElementById('specVendorName').value = '';
        document.getElementById('specFileInput').value = '';
        document.getElementById('specParseResult').innerHTML = '';
        document.getElementById('specParseResult').style.display = 'none';

        // 绑定分类变更监听，记录用户选择
        const categorySelect = document.getElementById('specCategory');
        if (categorySelect && !categorySelect._hasListener) {
            categorySelect.addEventListener('change', (e) => {
                this._lastCategories[this._uploadSource] = e.target.value;
            });
            categorySelect._hasListener = true;
        }

        // 优先使用当前模块内记录的分类
        if (categorySelect) {
            categorySelect.value = (source === 'our_standard') ? this._currentCategory : (this._lastCategories[source] || '接口文档');
        }

        openModal('specUploadModal');
    },

    async handleFileSelect() {
        const input = document.getElementById('specFileInput');
        const textarea = document.getElementById('specDocText');
        if (!input.files || !input.files[0]) return;

        const file = input.files[0];
        const ext = file.name.split('.').pop().toLowerCase();

        if (ext === 'txt') {
            const reader = new FileReader();
            reader.onload = (e) => { textarea.value = e.target.result; };
            reader.readAsText(file);
        } else {
            // PDF/Word 需要后端提取文本，先给提示
            textarea.value = '';
            textarea.placeholder = `已选择文件: ${file.name}\n正在通过后端提取文本，请稍候...`;

            // 提取过程中禁用解析按钮，防止空解析
            const parseBtn = document.getElementById('btnSpecParse');
            if (parseBtn) {
                parseBtn.disabled = true;
                parseBtn.dataset.originalText = parseBtn.textContent;
                parseBtn.textContent = '⏳ 正在提取文件文本...';
            }

            try {
                const formData = new FormData();
                formData.append('file', file);
                const res = await fetch(`/api/extract-text`, {
                    method: 'POST',
                    body: formData
                });

                if (res.status === 404) {
                    showToast('后端文本提取接口未找到，请联系管理员更新系统', 'error');
                    textarea.placeholder = '文本提取失败：接口 404，请手动粘贴文档内容';
                    return;
                }

                const data = await res.json();
                if (data.success && data.data && data.data.text) {
                    textarea.value = data.data.text;
                    showToast(`文本提取成功，${data.data.text.length} 字符`);
                } else {
                    const msg = data.message || '文本提取失败，请手动粘贴文档内容';
                    showToast(msg, 'error');
                    textarea.placeholder = msg;
                }
            } catch (e) {
                showToast('文件解析失败，请手动粘贴文档内容', 'error');
                textarea.placeholder = '文件解析失败，请检查网络或手动粘贴文档内容';
            } finally {
                if (parseBtn) {
                    parseBtn.disabled = false;
                    parseBtn.textContent = parseBtn.dataset.originalText || '🤖 开始 AI 解析';
                }
            }
        }
    },

    async submitParse() {
        const textarea = document.getElementById('specDocText');
        const docText = textarea.value.trim();

        // 安全检查：如果内容为空或者还是 placeholder 状态（可能是提取中或提取失败）
        if (!docText) {
            const placeholder = textarea.placeholder;
            if (placeholder && placeholder.includes('正在通过后端提取')) {
                showToast('文本提取尚未完成，请稍候...', 'warning');
            } else {
                showToast('请粘贴或上传文档内容', 'error');
            }
            return;
        }

        const source = this._uploadSource;
        const vendorName = document.getElementById('specVendorName').value.trim();
        const category = document.getElementById('specCategory').value;
        const resultEl = document.getElementById('specParseResult');
        const btn = document.getElementById('btnSpecParse');

        btn.disabled = true;
        btn.textContent = '⏳ AI 正在解析...';
        resultEl.style.display = 'block';
        resultEl.innerHTML = '<div style="text-align:center;padding:20px;"><div class="spinner" style="margin:0 auto 10px;"></div><div style="color:var(--gray-500);font-size:13px;">AI 正在解析接口文档，请稍候（可能需要 30-60 秒）...</div></div>';

        try {
            const endpoint = source === 'our_standard'
                ? '/interface-specs/parse-standard'
                : `/projects/${this._currentProjectId}/interface-specs/parse`;

            const body = {
                doc_text: docText,
                spec_source: source,
                category: category,
                vendor_name: vendorName,
                as_global: source === 'our_standard'
            };

            const data = await api.post(endpoint, body);

            resultEl.innerHTML = `
                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px;">
                    <div style="font-weight:700;color:#047857;margin-bottom:10px;">✅ 解析成功！共识别 ${data.parsed_count} 个接口</div>
                    ${(data.interfaces || []).map(i => `
                        <div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid #dcfce7;">
                            <span class="badge badge-info" style="font-size:10px;">${i.system_type || '?'}</span>
                            <span style="font-weight:600;font-size:13px;">${i.name}</span>
                            <span style="font-size:11px;color:var(--gray-400);font-family:monospace;">${i.transcode || ''}</span>
                            <span style="font-size:11px;color:var(--gray-500);">${i.fields_count} 字段</span>
                        </div>
                    `).join('')}
                </div>
            `;

            // 刷新数据并强制同步分类
            this._currentCategory = category;
            const dashCat = document.getElementById('dashOurCategory');
            if (dashCat) dashCat.value = category;
            const mainCat = document.getElementById('compareCategory');
            if (mainCat) mainCat.value = category;

            await this.loadAll();
            showToast(`解析完成，识别 ${data.parsed_count} 个接口`);
        } catch (e) {
            resultEl.innerHTML = `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px;color:#dc2626;">❌ 解析失败: ${e.message}</div>`;
        } finally {
            btn.disabled = false;
            btn.textContent = '🤖 开始 AI 解析';
        }
    },

    // ========== 一键对照 ==========
    async runComparison() {
        if (this._ourSpecs.length === 0) {
            showToast('请先上传我方标准接口文档', 'error');
            return;
        }
        if (this._vendorSpecs.length === 0) {
            showToast('请先上传对方接口文档', 'error');
            return;
        }

        const btn = document.getElementById('btnRunComparison');
        const category = document.getElementById('compareCategory').value;
        btn.disabled = true;
        btn.innerHTML = '⏳ 对照中...';

        try {
            const result = await api.post(`/projects/${this._currentProjectId}/interface-comparison/run`, {
                category: category
            });
            showToast(`对照完成！${result.comparison_count} 个接口已对照`);
            await this.loadAll();
        } catch (e) {
            showToast('对照失败: ' + e.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '🔍 一键智能对照';
        }
    },

    // ========== AI 报告 ==========
    async generateReport() {
        if (this._comparisons.length === 0) {
            showToast('请先执行接口对照', 'error');
            return;
        }

        const container = document.getElementById('specAiReport');
        container.style.display = 'block';
        container.innerHTML = `
            <div style="background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden;">
                <div style="background:linear-gradient(135deg,#8b5cf6,#6366f1);padding:20px 24px;color:white;">
                    <div style="display:flex;align-items:center;gap:12px;">
                        <div style="width:44px;height:44px;background:rgba(255,255,255,0.2);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;">🤖</div>
                        <div>
                            <div style="font-size:17px;font-weight:700;">AI 接口对照分析报告</div>
                            <div style="font-size:12px;opacity:0.8;">正在生成...</div>
                        </div>
                    </div>
                </div>
                <div style="padding:40px;text-align:center;">
                    <div class="spinner" style="margin:0 auto 16px;"></div>
                    <div style="color:var(--gray-500);font-size:13px;">AI 正在综合分析所有接口对照结果...</div>
                </div>
            </div>
        `;

        try {
            const data = await api.get(`/projects/${this._currentProjectId}/interface-comparison/report`);
            const htmlContent = typeof marked !== 'undefined' ? marked.parse(data.report || '') : `<pre>${data.report}</pre>`;

            container.innerHTML = `
                <div style="background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden;">
                    <div style="background:linear-gradient(135deg,#8b5cf6,#6366f1);padding:20px 24px;color:white;display:flex;justify-content:space-between;align-items:center;">
                        <div style="display:flex;align-items:center;gap:12px;">
                            <div style="width:44px;height:44px;background:rgba(255,255,255,0.2);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;">🤖</div>
                            <div>
                                <div style="font-size:17px;font-weight:700;">AI 接口对照分析报告</div>
                                <div style="font-size:12px;opacity:0.8;">生成时间: ${new Date().toLocaleString()}</div>
                            </div>
                        </div>
                        <button onclick="document.getElementById('specAiReport').style.display='none'" style="background:rgba(255,255,255,0.2);border:none;color:white;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12px;">✕ 收起</button>
                    </div>
                    <div style="padding:24px 28px;line-height:1.85;font-size:14px;" class="report-content">
                        ${htmlContent}
                    </div>
                </div>
            `;
        } catch (e) {
            container.innerHTML = `<div style="background:#fef2f2;padding:20px;border-radius:12px;text-align:center;color:var(--danger);">报告生成失败: ${e.message}</div>`;
        }
    },

    // ========== 删除接口规范 ==========
    async deleteSpec(specId) {
        if (!confirm('确定删除该接口规范？（字段数据也会一并删除）')) return;
        try {
            await api.delete(`/interface-specs/${specId}`);
            showToast('已删除');
            await this.loadAll();
            // 重新渲染当前子 tab
            const activeSubTab = document.querySelector('.spec-sub-tab.active');
            if (activeSubTab) this.switchSubTab(activeSubTab.dataset.subtab);
        } catch (e) {
            showToast('删除失败: ' + e.message, 'error');
        }
    },

    // ========== Dashboard 专用处理函数 ==========
    openQuickUpload(source) {
        this.showUploadModal(source);
    },

    async runComparisonFromDash() {
        const ourCat = document.getElementById('dashOurCategory')?.value || this._currentCategory;

        // 如果两边都还没上传数据，给予提示
        if (this._ourSpecs.length === 0 && this._vendorSpecs.length === 0) {
            showToast('请先上传至少一份文档内容', 'warning');
            this.showUploadModal('our_standard');
            return;
        }

        const btn = document.getElementById('btnDashRun');
        btn.disabled = true;
        btn.innerHTML = '⏳ 正在进行 AI 深度对齐...';

        try {
            // 设置分类并执行比对
            await api.post(`/projects/${this._currentProjectId}/interface-comparison/run`, {
                category: ourCat
            });
            showToast('比对完成，正在进入分析视图');
            this._currentCategory = ourCat;
            await this.loadAll(true); // 强制进入 MainUI
        } catch (e) {
            showToast('对齐失败: ' + e.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '🔍 一键智能比对 (AI Sync)';
        }
    }
};
