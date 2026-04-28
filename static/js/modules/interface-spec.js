/**
 * 接口文档智能对照 - 前端模块 V2.2 (完整修复版)
 * 修复: 移除冗余的旧版方法定义，解决 Modal DOM 元素 ID 冲突导致的报错
 */
const InterfaceSpec = {
    _ourSpecs: [],
    _vendorSpecs: [],
    _comparisons: [],
    _currentProjectId: null,
    _uploadSource: null,
    _currentCategory: '手麻标准',
    _chatHistory: [],
    _builtinStandardDocs: {
        '手麻标准': '3_2.手术麻醉信息系统对外接口标准文档Ver1.4(1)(1).pdf',
        '重症标准': '深医重症信息系统接口说明V2.6.docx'
    },

    // ==================== 入口 ====================
    async renderTab(projectId) {
        this._currentProjectId = projectId;
        const container = document.getElementById('tabInterfaceSpec');
        if (!container) return;
        this._loadChatHistory();
        await this.loadAll();
    },

    async loadAll(forceMainUI = false) {
        this._isLoading = true;
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

        // Always render Main UI to maintain consistency across projects
        this.renderMainUI(container);
    },

    // ==================== Dashboard ====================
    renderSetupDashboard(container) {
        const builtinFile = this._builtinStandardDocs[this._currentCategory] || '未配置';
        const ourReady = this._ourSpecs.length > 0;
        const vendorReady = this._vendorSpecs.length > 0;
        container.innerHTML = `
            <div style="padding:20px;animation:fadeIn 0.4s ease-out;">
                <div style="text-align:center;margin-bottom:40px;">
                    <h2 style="font-size:28px;font-weight:800;background:linear-gradient(135deg,var(--primary),var(--secondary));-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:12px;">
                        智能接口文档对齐中心
                    </h2>
                    <p style="color:var(--gray-500);font-size:15px;max-width:600px;margin:0 auto;">
                        通过 AI 智能解析，自动识别标准与私有接口差异，为您节省 90% 的文档整理时间。
                    </p>
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:24px;margin-bottom:40px;">
                    <div style="background:white;border-radius:16px;border:1px solid var(--gray-200);padding:24px;box-shadow:0 10px 15px -3px rgba(0,0,0,0.05);position:relative;overflow:hidden;">
                        <div style="position:absolute;top:0;left:0;right:0;height:4px;background:var(--primary);"></div>
                        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">
                            <div>
                                <h3 style="font-size:18px;font-weight:700;color:var(--gray-800);margin-bottom:4px;">我方标准规范</h3>
                                <p style="font-size:13px;color:var(--gray-500);">选择手麻或重症标准</p>
                            </div>
                            <span style="font-size:24px;">📘</span>
                        </div>
                        <div style="margin-bottom:20px;">
                            <select id="dashOurCategory" class="form-control" onchange="InterfaceSpec.loadAll()" style="width:100%;border-radius:8px;padding:8px 12px;border:1px solid var(--gray-200);">
                                <option value="手麻标准" ${this._currentCategory === '手麻标准' ? 'selected' : ''}>手麻标准</option>
                                <option value="重症标准" ${this._currentCategory === '重症标准' ? 'selected' : ''}>重症标准</option>
                            </select>
                        </div>
                        <div style="margin-bottom:14px;padding:12px 14px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;font-size:12px;color:#475569;line-height:1.7;">
                            <div style="font-weight:700;color:#0f172a;margin-bottom:4px;">已检测到内置标准文档</div>
                            <div>${builtinFile}</div>
                        </div>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
                            <button class="btn btn-outline btn-sm" onclick="InterfaceSpec.loadBuiltinStandardDoc()" style="flex:1;">⚡ 一键加载内置标准</button>
                            <button class="btn btn-outline btn-sm" onclick="InterfaceSpec.showUploadModal('our_standard')" style="flex:1;">📤 手动上传标准</button>
                        </div>
                        <div style="border:2px dashed var(--gray-200);border-radius:12px;padding:30px;text-align:center;cursor:pointer;" onclick="InterfaceSpec.openQuickUpload('our_standard')">
                            <div style="font-size:32px;margin-bottom:12px;">📄</div>
                            <div style="font-weight:600;font-size:14px;color:var(--gray-700);">粘贴文档或点击上传</div>
                            <div style="font-size:12px;color:var(--gray-400);margin-top:4px;">支持 PDF / Word / TXT / XML / JSON</div>
                        </div>
                        <div id="dashOurStatus" style="margin-top:16px;font-size:13px;display:block;">
                            <span style="color:${ourReady ? 'var(--success)' : 'var(--warning)'};font-weight:600;">${ourReady ? '✓ 标准文档已就绪' : '⏳ 标准文档待加载'} ${ourReady ? `(${this._ourSpecs.length} 个接口)` : ''}</span>
                        </div>
                    </div>
                    <div style="background:white;border-radius:16px;border:1px solid var(--gray-200);padding:24px;box-shadow:0 10px 15px -3px rgba(0,0,0,0.05);position:relative;overflow:hidden;">
                        <div style="position:absolute;top:0;left:0;right:0;height:4px;background:var(--info);"></div>
                        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">
                            <div>
                                <h3 style="font-size:18px;font-weight:700;color:var(--gray-800);margin-bottom:4px;">第三方接口文档</h3>
                                <p style="font-size:13px;color:var(--gray-500);">上传医院或厂家接口说明</p>
                            </div>
                            <span style="font-size:24px;">🏥</span>
                        </div>
                        <div style="margin-bottom:20px;">
                            <input type="text" id="dashVendorName" class="form-control" placeholder="输入厂家/系统名称 (可选)" style="width:100%;border-radius:8px;padding:8px 12px;border:1px solid var(--gray-200);">
                        </div>
                        <div style="border:2px dashed var(--gray-200);border-radius:12px;padding:30px;text-align:center;cursor:pointer;" onclick="InterfaceSpec.openQuickUpload('vendor')">
                            <div style="font-size:32px;margin-bottom:12px;">🔗</div>
                            <div style="font-weight:600;font-size:14px;color:var(--gray-700);">粘贴文档或点击上传</div>
                            <div style="font-size:12px;color:var(--gray-400);margin-top:4px;">支持 XML / JSON / HL7 / PDF / Word</div>
                        </div>
                        <div id="dashVendorStatus" style="margin-top:16px;font-size:13px;display:block;">
                            <span style="color:${vendorReady ? 'var(--success)' : 'var(--warning)'};font-weight:600;">${vendorReady ? '✓ 接口文档已就绪' : '⏳ 对方文档待加载'} ${vendorReady ? `(${this._vendorSpecs.length} 个接口)` : ''}</span>
                        </div>
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-bottom:28px;">
                    <div style="padding:16px;border-radius:16px;background:${ourReady ? 'linear-gradient(135deg,#ecfdf5,#ffffff)' : 'linear-gradient(135deg,#fff7ed,#ffffff)'};border:1px solid ${ourReady ? '#bbf7d0' : '#fed7aa'};">
                        <div style="font-size:12px;color:#64748b;">步骤 1</div>
                        <div style="margin-top:6px;font-size:17px;font-weight:800;color:#0f172a;">加载我方标准</div>
                        <div style="margin-top:6px;font-size:12px;color:#64748b;">优先使用你放在项目目录的两份 PDF</div>
                    </div>
                    <div style="padding:16px;border-radius:16px;background:${vendorReady ? 'linear-gradient(135deg,#ecfdf5,#ffffff)' : 'linear-gradient(135deg,#eff6ff,#ffffff)'};border:1px solid ${vendorReady ? '#bbf7d0' : '#bfdbfe'};">
                        <div style="font-size:12px;color:#64748b;">步骤 2</div>
                        <div style="margin-top:6px;font-size:17px;font-weight:800;color:#0f172a;">上传对方接口</div>
                        <div style="margin-top:6px;font-size:12px;color:#64748b;">医院/HIS/厂商文档上传后即可对照</div>
                    </div>
                    <div style="padding:16px;border-radius:16px;background:linear-gradient(135deg,#f5f3ff,#ffffff);border:1px solid #ddd6fe;">
                        <div style="font-size:12px;color:#64748b;">步骤 3</div>
                        <div style="margin-top:6px;font-size:17px;font-weight:800;color:#0f172a;">生成差异报告</div>
                        <div style="margin-top:6px;font-size:12px;color:#64748b;">查看字段缺口、转换规则和对接建议</div>
                    </div>
                </div>
                <div style="text-align:center;">
                    <button class="btn btn-ai" onclick="InterfaceSpec.runComparisonFromDash()" style="padding:16px 48px;border-radius:30px;font-size:18px;font-weight:700;box-shadow:0 10px 25px -5px rgba(99,102,241,0.4);">
                        🔍 一键智能比对 (AI Sync)
                    </button>
                    <div style="margin-top:16px;font-size:13px;color:var(--gray-400);">AI 将自动分析两份文档，提取字段对应关系并标注差异点</div>
                </div>
            </div>`;
    },

    // ==================== 主 UI ====================
    renderMainUI(container) {
        const builtinFile = this._builtinStandardDocs[this._currentCategory] || '';
        container.innerHTML = `
            <div class="interface-spec-module">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:20px;">
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <button class="btn btn-outline btn-sm" onclick="InterfaceSpec.loadBuiltinStandardDoc()">⚡ 加载内置标准</button>
                        <button class="btn btn-primary btn-sm" onclick="InterfaceSpec.showUploadModal('our_standard')">📤 上传我方标准</button>
                        <button class="btn btn-info btn-sm" onclick="InterfaceSpec.showUploadModal('vendor')">📥 上传对方接口</button>
                        <select id="compareCategory" class="form-control" onchange="InterfaceSpec.loadAll()" style="width:130px;height:32px;padding:0 8px;font-size:12px;border-radius:6px;">
                            <option value="手麻标准" ${this._currentCategory === '手麻标准' ? 'selected' : ''}>手麻标准</option>
                            <option value="重症标准" ${this._currentCategory === '重症标准' ? 'selected' : ''}>重症标准</option>
                            <option value="接口文档" ${this._currentCategory === '接口文档' ? 'selected' : ''}>接口文档</option>
                        </select>
                        <button class="btn btn-ai btn-sm" onclick="InterfaceSpec.runComparison()" id="btnRunComparison">🔍 一键智能对照</button>
                        <button class="btn btn-outline btn-sm" onclick="InterfaceSpec.generateReport()">📊 对照报告</button>
                        <button class="btn btn-outline btn-sm" onclick="InterfaceSpec.resetDashboard()" style="color:var(--danger);">🔄 重新对齐</button>
                    </div>
                    <div style="padding:8px 12px;border-radius:999px;background:#f8fafc;border:1px solid #e2e8f0;font-size:12px;color:#475569;">内置标准: ${builtinFile || '未配置'}</div>
                </div>
                <div id="specOverview" style="margin-bottom:20px;"></div>
                <div style="display:flex;gap:4px;background:var(--gray-100);padding:4px;border-radius:10px;margin-bottom:16px;">
                    <div class="spec-sub-tab active" onclick="InterfaceSpec.switchSubTab('comparison')" data-subtab="comparison" style="flex:1;text-align:center;padding:10px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;">🔍 对照结果</div>
                    <div class="spec-sub-tab" onclick="InterfaceSpec.switchSubTab('our')" data-subtab="our" style="flex:1;text-align:center;padding:10px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;">📋 我方标准</div>
                    <div class="spec-sub-tab" onclick="InterfaceSpec.switchSubTab('vendor')" data-subtab="vendor" style="flex:1;text-align:center;padding:10px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;">🏥 对方接口</div>
                    <div class="spec-sub-tab" onclick="InterfaceSpec.openChatModal()" style="flex:1;text-align:center;padding:10px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700;color:var(--primary);background:rgba(99,102,241,0.05);">🤖 接口 AI 助手</div>
                </div>
                <div id="specSubContent">
                    <div id="specComparisonView"></div>
                    <div id="specOurView" style="display:none;"></div>
                    <div id="specVendorView" style="display:none;"></div>
                </div>
            </div>`;
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
        document.querySelectorAll('.spec-sub-tab').forEach(t => {
            const isActive = t.dataset.subtab === name;
            t.classList.toggle('active', isActive);
            t.style.background = isActive ? 'white' : 'transparent';
            t.style.color = isActive ? 'var(--primary)' : 'var(--gray-600)';
            t.style.boxShadow = isActive ? '0 1px 3px rgba(0,0,0,0.1)' : 'none';
        });
        const ids = { comparison: 'specComparisonView', our: 'specOurView', vendor: 'specVendorView' };
        Object.entries(ids).forEach(([k, id]) => {
            const el = document.getElementById(id);
            if (el) el.style.display = (k === name) ? 'block' : 'none';
        });
        if (name === 'our') this.renderSpecList(this._ourSpecs, 'specOurView', 'our_standard');
        if (name === 'vendor') this.renderSpecList(this._vendorSpecs, 'specVendorView', 'vendor');
    },

    // ==================== 数据加载 ====================
    async loadOurSpecs() {
        try {
            const cat = this._currentCategory;
            let url = `/projects/${this._currentProjectId}/interface-specs?source=our_standard`;
            if (cat) url += `&category=${encodeURIComponent(cat)}`;
            let specs = await api.get(url, { silent: true });
            if (specs.length === 0) {
                let gUrl = `/interface-specs/standard`;
                if (cat) gUrl += `?category=${encodeURIComponent(cat)}`;
                specs = await api.get(gUrl, { silent: true });
            }
            this._ourSpecs = specs;
        } catch (e) { this._ourSpecs = []; }
    },

    async loadVendorSpecs() {
        try {
            const cat = this._currentCategory;
            let url = `/projects/${this._currentProjectId}/interface-specs?source=vendor`;
            if (cat) url += `&category=${encodeURIComponent(cat)}`;
            let specs = await api.get(url, { silent: true });

            // 💡 改进：如果特定分类（如“重症标准”）下没数据，尝试加载通用分类“接口文档”中的数据
            if (specs.length === 0 && cat && cat !== '接口文档') {
                let fallbackUrl = `/projects/${this._currentProjectId}/interface-specs?source=vendor&category=${encodeURIComponent('接口文档')}`;
                const fallbackSpecs = await api.get(fallbackUrl, { silent: true });
                if (fallbackSpecs.length > 0) {
                    specs = fallbackSpecs;
                }
            }

            this._vendorSpecs = specs;
        } catch (e) { this._vendorSpecs = []; }
    },

    async loadComparisons() {
        try {
            const cat = this._currentCategory;
            let url = `/projects/${this._currentProjectId}/interface-comparisons`;
            if (cat) url += `?category=${encodeURIComponent(cat)}`;
            this._comparisons = await api.get(url, { silent: true });
        } catch (e) { this._comparisons = []; }
    },

    // ==================== 概览 ====================
    renderOverview() {
        const el = document.getElementById('specOverview');
        if (!el) return;
        const total = this._comparisons.length;
        const matched = this._comparisons.filter(c => (c.gap_count || 0) === 0 && (c.transform_count || 0) === 0).length;
        const gaps = this._comparisons.reduce((s, c) => s + (c.gap_count || 0), 0);
        const transforms = this._comparisons.reduce((s, c) => s + (c.transform_count || 0), 0);
        const readiness = this._ourSpecs.length > 0 && this._vendorSpecs.length > 0;

        el.innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;">
                <div style="background:white;border-radius:10px;padding:16px;border:1px solid var(--gray-200);text-align:center;">
                    <div style="font-size:24px;font-weight:700;color:var(--primary);">${this._ourSpecs.length}</div>
                    <div style="font-size:12px;color:var(--gray-500);margin-top:4px;">我方标准</div>
                </div>
                <div style="background:white;border-radius:10px;padding:16px;border:1px solid var(--gray-200);text-align:center;">
                    <div style="font-size:24px;font-weight:700;color:var(--info);">${this._vendorSpecs.length}</div>
                    <div style="font-size:12px;color:var(--gray-500);margin-top:4px;">对方接口</div>
                </div>
                <div style="background:white;border-radius:10px;padding:16px;border:1px solid var(--gray-200);text-align:center;">
                    <div style="font-size:24px;font-weight:700;color:var(--success);">${matched}</div>
                    <div style="font-size:12px;color:var(--gray-500);margin-top:4px;">完全匹配</div>
                </div>
                <div style="background:white;border-radius:10px;padding:16px;border:1px solid var(--gray-200);text-align:center;">
                    <div style="font-size:24px;font-weight:700;color:var(--warning);">${gaps}</div>
                    <div style="font-size:12px;color:var(--gray-500);margin-top:4px;">字段差异</div>
                </div>
                <div style="background:white;border-radius:10px;padding:16px;border:1px solid var(--gray-200);text-align:center;">
                    <div style="font-size:24px;font-weight:700;color:var(--secondary);">${transforms}</div>
                    <div style="font-size:12px;color:var(--gray-500);margin-top:4px;">需转换</div>
                </div>
            </div>
            <div style="margin-top:14px;padding:14px 16px;border-radius:14px;background:${readiness ? 'linear-gradient(135deg,#ecfdf5,#ffffff)' : 'linear-gradient(135deg,#fff7ed,#ffffff)'};border:1px solid ${readiness ? '#bbf7d0' : '#fed7aa'};font-size:13px;color:#475569;">
                <span style="font-weight:700;color:${readiness ? '#15803d' : '#c2410c'};">${readiness ? '✓ 已满足对照条件' : '⏳ 还差一步就能开始对照'}</span>
                <span style="margin-left:8px;">${readiness ? '当前标准文档和对方文档都已就绪，可以直接运行智能对照。' : this._ourSpecs.length === 0 ? '请先加载我方标准文档。' : '请先上传对方接口文档。'}</span>
            </div>`;
    },

    // ==================== 对照结果视图 ====================
    renderComparisonView() {
        const el = document.getElementById('specComparisonView');
        if (!el) return;
        if (this._comparisons.length === 0) {
            el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔍</div><div class="empty-state-text">暂无对照数据</div><div class="empty-state-hint">请先上传文档并执行智能对照</div></div>';
            return;
        }

        // 💡 1. 按我方接口 ID 分组
        const groups = {};
        this._comparisons.forEach(c => {
            const id = c.our_spec_id || 'unmatched';
            if (!groups[id]) groups[id] = [];
            groups[id].push(c);
        });

        const sortedGroupIds = Object.keys(groups).sort((a, b) => {
            if (a === 'unmatched') return 1;
            if (b === 'unmatched') return -1;
            return 0;
        });

        let html = '<div class="table-container"><table class="table"><thead><tr>' +
            '<th style="width:25%">我方标准接口</th>' +
            '<th style="width:25%">对应厂商实现</th>' +
            '<th>匹配方式</th>' +
            '<th>差异</th>' +
            '<th>转换</th>' +
            '<th>状态</th>' +
            '<th>操作</th></tr></thead><tbody>';

        sortedGroupIds.forEach(gid => {
            const items = groups[gid];
            items.forEach((c, idx) => {
                const statusColor = (c.gap_count || 0) === 0 && (c.transform_count || 0) === 0 ? 'var(--success)' : (c.gap_count || 0) > 0 ? 'var(--danger)' : 'var(--warning)';
                const statusText = (c.gap_count || 0) === 0 && (c.transform_count || 0) === 0 ? '✅ 匹配' : (c.gap_count || 0) > 0 ? '⚠️ 有差异' : '🔧 需转换';

                // 复合映射标识
                const isComposite = items.length > 1;
                const compositeBadge = isComposite ? `<span class="badge badge-purple" style="font-size:10px;margin-left:5px;">复合</span>` : '';

                html += `<tr>`;

                // 第一个单元格（我方接口）：如果一个标准对应多个厂商，只显示一次或在此显示合并逻辑
                if (idx === 0) {
                    html += `<td rowspan="${items.length}" style="vertical-align:top; border-right: 1px solid var(--gray-100); background: var(--gray-50);">
                        <div style="font-weight:600; color:var(--gray-900);">${c.our_name || '-'}</div>
                        <div style="font-size:11px; color:var(--gray-500); margin-top:4px;">${c.our_transcode || ''}</div>
                        ${compositeBadge}
                        ${items.length > 1 ? `<div style="font-size:10px; color:var(--primary); margin-top:8px;">需 ${items.length} 个接口协同实现</div>` : ''}
                    </td>`;
                }

                html += `
                    <td>
                        <div style="font-weight:500;">${c.vendor_name || (c.vendor_spec_id ? '未命名接口' : '<span style="color:var(--danger);">❌ 对方无对应</span>')}</div>
                        <div style="font-size:11px; color:var(--gray-500);">${c.vendor_transcode || ''}</div>
                    </td>
                    <td><span class="badge badge-info">${c.match_type || 'auto'}</span></td>
                    <td style="color:${(c.gap_count || 0) > 0 ? 'var(--danger)' : 'var(--gray-400)'};">${c.gap_count || 0}</td>
                    <td style="color:${(c.transform_count || 0) > 0 ? 'var(--warning)' : 'var(--gray-400)'};">${c.transform_count || 0}</td>
                    <td style="color:${statusColor};font-weight:500;font-size:12px;">${statusText}</td>
                    <td><button class="btn btn-outline btn-xs" onclick="InterfaceSpec.showFieldDetail(${c.id})">查看详情</button></td>
                </tr>`;
            });
        });

        html += '</tbody></table></div>';
        el.innerHTML = html;
    },

    // ==================== 规范列表视图 ====================
    renderSpecList(specs, containerId, source) {
        const el = document.getElementById(containerId);
        if (!el) return;
        if (specs.length === 0) {
            el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">${source === 'our_standard' ? '📋' : '🏥'}</div><div class="empty-state-text">暂无${source === 'our_standard' ? '标准' : '对方'}接口</div></div>`;
            return;
        }
        let html = '<div class="table-container"><table class="table"><thead><tr><th>系统类型</th><th>接口名称</th><th>协议</th><th>方向</th><th>操作</th></tr></thead><tbody>';
        specs.forEach(s => {
            html += `<tr>
                <td><span class="badge badge-info">${s.system_type || '-'}</span></td>
                <td style="font-weight:600;">${s.interface_name || '-'}</td>
                <td>${s.protocol || '-'}</td>
                <td>${s.data_direction || '-'}</td>
                <td><button class="btn btn-danger btn-xs" onclick="InterfaceSpec.deleteSpec(${s.id})">删除</button></td>
            </tr>`;
        });
        html += '</tbody></table></div>';
        el.innerHTML = html;
    },

    // ==================== 上传弹窗 ====================
    _ensureUploadModal() {
        if (document.getElementById('specUploadModal')) return;
        const m = document.createElement('div');
        m.id = 'specUploadModal';
        m.className = 'modal';
        m.innerHTML = `
            <div class="modal-content modal-large" style="max-width:680px;">
                <div class="modal-header">
                    <h3 id="specUploadTitle">📤 上传接口文档</h3>
                    <button class="modal-close" onclick="closeModal('specUploadModal')">×</button>
                </div>
                <div class="modal-body" style="padding:20px;">
                    <div class="form-group">
                        <label>文档来源</label>
                        <select id="uploadSpecSource" class="form-control" onchange="InterfaceSpec._onSourceChange()">
                            <option value="our_standard">我方标准</option>
                            <option value="vendor">对方/厂商接口</option>
                        </select>
                    </div>
                    <div class="form-group" id="uploadVendorNameGroup" style="display:none;">
                        <label>厂商/系统名称</label>
                        <input type="text" id="uploadVendorName" class="form-control" placeholder="如：东华HIS、金仕达LIS">
                    </div>
                    <div class="form-group">
                        <label>分类</label>
                        <select id="uploadCategory" class="form-control">
                            <option value="手麻标准">手麻标准</option>
                            <option value="重症标准">重症标准</option>
                            <option value="接口文档">接口文档</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>方式一：上传文件</label>
                        <input type="file" id="specFileInput" class="form-control" accept=".pdf,.doc,.docx,.txt,.xml,.json,.wsdl" onchange="InterfaceSpec._handleFileSelect()">
                        <div style="font-size:11px;color:var(--gray-400);margin-top:4px;">支持 PDF / Word(.docx) / TXT / XML / JSON</div>
                    </div>
                    <div class="form-group">
                        <label>方式二：粘贴文档内容</label>
                        <textarea id="specDocText" class="form-control" rows="10" placeholder="将接口文档内容粘贴到此处..." style="font-size:13px;line-height:1.6;font-family:monospace;"></textarea>
                    </div>
                    <div id="uploadFileStatus" style="display:none;padding:10px;border-radius:8px;background:var(--gray-50);font-size:13px;margin-bottom:12px;"></div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-outline" onclick="closeModal('specUploadModal')">取消</button>
                    <button class="btn btn-ai" id="btnSubmitParse" onclick="InterfaceSpec._submitParse()">🤖 AI 解析</button>
                </div>
            </div>`;
        document.body.appendChild(m);
    },

    showUploadModal(source) {
        this._uploadSource = source;
        this._ensureUploadModal();
        openModal('specUploadModal');
        requestAnimationFrame(() => {
            const titleEl = document.getElementById('specUploadTitle');
            const srcSelect = document.getElementById('uploadSpecSource');
            const catSelect = document.getElementById('uploadCategory');
            const fileInput = document.getElementById('specFileInput');
            const textArea = document.getElementById('specDocText');
            const statusDiv = document.getElementById('uploadFileStatus');
            if (titleEl) titleEl.textContent = source === 'our_standard' ? '📤 上传我方标准文档' : '📥 上传对方接口文档';
            if (srcSelect) srcSelect.value = source;
            if (catSelect) catSelect.value = this._currentCategory || '手麻标准';
            if (fileInput) fileInput.value = '';
            if (textArea) textArea.value = '';
            if (statusDiv) statusDiv.style.display = 'none';
            this._onSourceChange();
        });
    },

    openQuickUpload(source) {
        const dashVendorName = document.getElementById('dashVendorName')?.value || '';
        const dashCat = document.getElementById('dashOurCategory')?.value || this._currentCategory;
        this._uploadSource = source;
        this._ensureUploadModal();
        openModal('specUploadModal');
        requestAnimationFrame(() => {
            const titleEl = document.getElementById('specUploadTitle');
            const srcSelect = document.getElementById('uploadSpecSource');
            const catSelect = document.getElementById('uploadCategory');
            const vendorInput = document.getElementById('uploadVendorName');
            const fileInput = document.getElementById('specFileInput');
            const textArea = document.getElementById('specDocText');
            const statusDiv = document.getElementById('uploadFileStatus');
            if (titleEl) titleEl.textContent = source === 'our_standard' ? '📤 上传我方标准文档' : '📥 上传对方接口文档';
            if (srcSelect) srcSelect.value = source;
            if (catSelect) catSelect.value = dashCat;
            if (vendorInput && source === 'vendor') vendorInput.value = dashVendorName;
            if (fileInput) fileInput.value = '';
            if (textArea) textArea.value = '';
            if (statusDiv) statusDiv.style.display = 'none';
            this._onSourceChange();
        });
    },

    _onSourceChange() {
        const source = document.getElementById('uploadSpecSource')?.value;
        const group = document.getElementById('uploadVendorNameGroup');
        if (group) group.style.display = (source === 'vendor') ? 'block' : 'none';
    },

    // ==================== 文件提取 ====================
    async _handleFileSelect() {
        const fileInput = document.getElementById('specFileInput');
        const statusDiv = document.getElementById('uploadFileStatus');
        const textArea = document.getElementById('specDocText');
        if (!fileInput || !fileInput.files.length) return;
        const file = fileInput.files[0];
        const ext = file.name.split('.').pop().toLowerCase();

        if (['txt', 'xml', 'json', 'wsdl'].includes(ext)) {
            if (statusDiv) { statusDiv.style.display = 'block'; statusDiv.innerHTML = '⏳ 读取中...'; }
            try {
                const text = await file.text();
                if (textArea) textArea.value = text;
                if (statusDiv) { statusDiv.innerHTML = `✅ 已读取 <b>${file.name}</b> (${(text.length / 1024).toFixed(1)} KB)`; statusDiv.style.background = '#f0fdf4'; }
            } catch (e) {
                if (statusDiv) { statusDiv.innerHTML = `❌ 读取失败: ${e.message}`; statusDiv.style.background = '#fef2f2'; }
            }
            return;
        }
        if (['pdf', 'doc', 'docx'].includes(ext)) {
            if (statusDiv) { statusDiv.style.display = 'block'; statusDiv.innerHTML = '⏳ 上传并提取文本中...'; statusDiv.style.background = '#eff6ff'; }
            const fd = new FormData();
            fd.append('file', file);
            try {
                const resp = await fetch('/api/extract-text', { method: 'POST', body: fd });
                const json = await resp.json();
                if (json.success && json.data?.text) {
                    if (textArea) textArea.value = json.data.text;
                    if (statusDiv) { statusDiv.innerHTML = `✅ 已提取 <b>${json.data.filename}</b> (${(json.data.length / 1024).toFixed(1)} KB)`; statusDiv.style.background = '#f0fdf4'; }
                } else {
                    if (statusDiv) { statusDiv.innerHTML = `❌ 提取失败: ${json.message || '未知错误'}`; statusDiv.style.background = '#fef2f2'; }
                }
            } catch (e) {
                if (statusDiv) { statusDiv.innerHTML = `❌ 上传失败: ${e.message}`; statusDiv.style.background = '#fef2f2'; }
            }
            return;
        }
        if (statusDiv) { statusDiv.style.display = 'block'; statusDiv.innerHTML = `⚠️ 不支持的格式: .${ext}`; statusDiv.style.background = '#fffbeb'; }
    },

    // ==================== AI 解析 ====================
    async _submitParse() {
        const source = document.getElementById('uploadSpecSource')?.value || this._uploadSource || 'vendor';
        const vendorName = document.getElementById('uploadVendorName')?.value || '';
        const category = document.getElementById('uploadCategory')?.value || this._currentCategory;
        const docText = document.getElementById('specDocText')?.value?.trim();
        const btn = document.getElementById('btnSubmitParse');
        if (!docText) { showToast('请先粘贴文档内容或上传文件'); return; }
        if (docText.length < 50) { showToast('文档内容过短，请粘贴完整的接口文档'); return; }
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin:0 6px 0 0;display:inline-block;vertical-align:middle;"></span> AI 解析中...'; }
        try {
            const url = (source === 'our_standard' && !this._currentProjectId)
                ? '/interface-specs/parse-standard'
                : `/projects/${this._currentProjectId}/interface-specs/parse`;
            const res = await api.post(url, { doc_text: docText, spec_source: source, vendor_name: vendorName, category: category });
            showToast(`✅ ${res.cache_hit ? '缓存命中' : '解析完成'}，提取了 ${res.parsed_count || 0} 个接口定义`);
            closeModal('specUploadModal');
            await this.loadAll(true);
        } catch (e) {
            showToast(`❌ 解析失败: ${e.message || '请检查文档内容'}`);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '🤖 AI 解析'; }
        }
    },

    // ==================== 对照 ====================
    async runComparisonFromDash() {
        if (this._ourSpecs.length === 0 && this._vendorSpecs.length === 0) { showToast('请先上传我方标准和对方接口文档'); return; }
        if (this._ourSpecs.length === 0) { showToast('请先上传我方标准文档'); return; }
        if (this._vendorSpecs.length === 0) { showToast('请先上传对方接口文档'); return; }
        await this.runComparison();
    },

    async runComparison() {
        const btn = document.getElementById('btnRunComparison');
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin:0 4px 0 0;display:inline-block;vertical-align:middle;"></span> 对照中...'; }
        try {
            const cat = document.getElementById('compareCategory')?.value || this._currentCategory;
            const res = await api.post(`/projects/${this._currentProjectId}/interface-comparison/run`, { category: cat, use_ai_match: false });
            const s = res.summary || {};
            showToast(`✅ 快速对照完成：${res.comparison_count || 0} 对接口，差异 ${s.gap || 0}，需转换 ${s.transform || 0}`);
            await this.loadAll(true);
        } catch (e) {
            showToast(`❌ 对照失败: ${e.message || '请稍后重试'}`);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '🔍 一键智能对照'; }
        }
    },

    // ==================== 报告 ====================
    async generateReport() {
        if (this._comparisons.length === 0) { showToast('暂无对照数据，请先执行对照'); return; }
        this._ensureReportModal();
        openModal('specReportModal');
        const body = document.getElementById('specReportBody');
        if (body) body.innerHTML = '<div style="text-align:center;padding:60px;"><div class="spinner" style="margin:0 auto 16px;"></div><div style="color:var(--gray-500);">AI 正在生成报告...</div></div>';
        try {
            const res = await api.get(`/projects/${this._currentProjectId}/interface-comparison/report`);
            if (body) body.innerHTML = `<div class="report-content" style="padding:10px;">${typeof renderAiMarkdown === 'function' ? renderAiMarkdown(res.report || '报告为空') : marked.parse(res.report || '报告为空')}</div>`;
        } catch (e) {
            if (body) body.innerHTML = `<div style="text-align:center;padding:40px;color:var(--danger);">报告生成失败: ${e.message}</div>`;
        }
    },

    _ensureReportModal() {
        if (document.getElementById('specReportModal')) return;
        const m = document.createElement('div');
        m.id = 'specReportModal'; m.className = 'modal';
        m.innerHTML = `<div class="modal-content modal-xl" style="height:85vh;display:flex;flex-direction:column;">
            <div class="modal-header"><h3>📊 接口对照分析报告</h3><button class="modal-close" onclick="closeModal('specReportModal')">×</button></div>
            <div id="specReportBody" class="modal-body" style="flex:1;overflow-y:auto;"></div>
            <div class="modal-footer"><button class="btn btn-outline" onclick="closeModal('specReportModal')">关闭</button></div>
        </div>`;
        document.body.appendChild(m);
    },

    // ==================== 删除 ====================
    async deleteSpec(specId) {
        if (!confirm('确认删除此接口规范？不可恢复。')) return;
        try { await api.delete(`/interface-specs/${specId}`); showToast('已删除'); await this.loadAll(true); }
        catch (e) { showToast(`删除失败: ${e.message}`); }
    },

    // ==================== 字段详情弹窗 ====================
    _ensureFieldDetailModal() {
        if (document.getElementById('fieldDetailModal')) return;
        const m = document.createElement('div');
        m.id = 'fieldDetailModal'; m.className = 'modal';
        m.innerHTML = `<div class="modal-content modal-xl" style="height:85vh;display:flex;flex-direction:column;">
            <div class="modal-header"><h3>🔍 字段映射详情</h3><button class="modal-close" onclick="closeModal('fieldDetailModal')">×</button></div>
            <div id="fieldDetailBody" class="modal-body" style="flex:1;overflow-y:auto;padding:16px;"></div>
            <div class="modal-footer"><button class="btn btn-outline" onclick="closeModal('fieldDetailModal')">关闭</button></div>
        </div>`;
        document.body.appendChild(m);
    },

    async showFieldDetail(comparisonId) {
        this._ensureFieldDetailModal();
        openModal('fieldDetailModal');
        const body = document.getElementById('fieldDetailBody');
        if (body) body.innerHTML = '<div style="text-align:center;padding:40px;"><div class="spinner" style="margin:0 auto 12px;"></div>加载字段对照...</div>';
        try {
            const data = await api.get(`/interface-comparisons/${comparisonId}/detail`);
            this._renderFieldDetail(data);
        } catch (e) {
            if (body) body.innerHTML = `<div style="text-align:center;padding:40px;color:var(--danger);">加载失败: ${e.message}</div>`;
        }
    },

    _renderFieldDetail(data) {
        const body = document.getElementById('fieldDetailBody');
        if (!body) return;
        const mappings = data.mappings || [];
        const statusMap = {
            'matched': { label: '✅ 完全匹配', color: '#10b981', bg: '#f0fdf4' },
            'name_different': { label: '🔄 名称不同', color: '#f59e0b', bg: '#fffbeb' },
            'type_mismatch': { label: '⚠️ 类型不匹配', color: '#ef4444', bg: '#fef2f2' },
            'needs_transform': { label: '🔧 需转换', color: '#8b5cf6', bg: '#f5f3ff' },
            'missing_in_vendor': { label: '❌ 对方缺失', color: '#ef4444', bg: '#fef2f2' },
            'extra_in_vendor': { label: '➕ 对方多余', color: '#6366f1', bg: '#eef2ff' }
        };
        let matched = 0, diff = 0, missing = 0;
        mappings.forEach(function (m) {
            if (m.match_status === 'matched') matched++;
            else if (m.match_status === 'missing_in_vendor') missing++;
            else diff++;
        });
        let html = '<div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">' +
            '<div style="background:#f0fdf4;padding:8px 16px;border-radius:8px;font-size:13px;">✅ 匹配 <b>' + matched + '</b></div>' +
            '<div style="background:#fffbeb;padding:8px 16px;border-radius:8px;font-size:13px;">🔄 差异 <b>' + diff + '</b></div>' +
            '<div style="background:#fef2f2;padding:8px 16px;border-radius:8px;font-size:13px;">❌ 缺失 <b>' + missing + '</b></div></div>';
        html += '<div class="table-container"><table class="table" style="font-size:12px;"><thead><tr><th>我方字段</th><th>对方字段</th><th>类型</th><th>状态</th><th>转换规则</th><th>操作</th></tr></thead><tbody>';
        for (var i = 0; i < mappings.length; i++) {
            var m = mappings[i];
            var st = statusMap[m.match_status] || { label: m.match_status, color: '#6b7280', bg: '#f9fafb' };
            html += '<tr style="background:' + st.bg + ';">' +
                '<td style="font-weight:600;font-family:monospace;">' + (m.our_field_name || '-') + '<div style="font-size:10px;color:var(--gray-400);">' + (m.our_field_name_cn || '') + '</div></td>' +
                '<td style="font-family:monospace;">' + (m.vendor_field_name || '<span style="color:var(--danger);">—</span>') + '<div style="font-size:10px;color:var(--gray-400);">' + (m.vendor_field_name_cn || '') + '</div></td>' +
                '<td><span class="badge badge-gray">' + (m.our_field_type || '-') + '</span></td>' +
                '<td><span style="color:' + st.color + ';font-weight:600;font-size:11px;">' + st.label + '</span></td>' +
                '<td style="font-size:11px;max-width:200px;">' + (m.transform_rule || '-') + '</td>' +
                '<td>' + (!m.is_confirmed ? '<button class="btn btn-success btn-xs" onclick="InterfaceSpec.confirmMapping(' + m.id + ')">确认</button>' : '<span style="color:var(--success);font-size:11px;">✓ 已确认</span>') + '</td></tr>';
        }
        html += '</tbody></table></div><div style="margin-top:12px;display:flex;justify-content:flex-end;"><button class="btn btn-outline btn-sm" onclick="InterfaceSpec.exportFieldMappings()">导出差异 CSV</button></div>';
        body.innerHTML = html;
    },

    async loadBuiltinStandardDoc() {
        const category = (document.getElementById('compareCategory')?.value || document.getElementById('dashOurCategory')?.value || this._currentCategory || '手麻标准');
        this._currentCategory = category;
        const btn = Array.from(document.querySelectorAll('button')).find(item => item.textContent && item.textContent.includes('加载内置标准'));
        const originalText = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '⏳ 加载中...';
        }
        try {
            const res = await api.post('/interface-specs/load-builtin-standard', {
                category,
                overwrite: true
            });
            const modeText = res.db_reused ? '直接复用已入库标准' : (res.cache_hit ? '使用预解析缓存完成加载' : '首次 AI 解析完成');
            showToast(`✅ 已加载 ${res.filename}，${modeText}，共 ${res.parsed_count || 0} 个接口`);
            await this.loadAll(true);
        } catch (e) {
            showToast(`❌ 加载内置标准失败: ${e.message || '请检查 PDF 或解析依赖'}`);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
        }
    },

    async confirmMapping(mappingId) {
        try {
            await api.put(`/field-mappings/${mappingId}/confirm`, {});
            showToast('已确认');
        } catch (e) {
            showToast(`确认失败: ${e.message}`, 'error');
        }
    },

    exportFieldMappings() {
        const rows = Array.from(document.querySelectorAll('#fieldDetailBody tbody tr'));
        if (!rows.length) {
            showToast('暂无可导出的字段差异', 'warning');
            return;
        }
        const csv = ['我方字段,对方字段,类型,状态,转换规则'].concat(
            rows.map(row => Array.from(row.children).slice(0, 5).map(td => `"${String(td.textContent || '').replace(/"/g, '""').trim()}"`).join(','))
        ).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'interface_field_mappings.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('字段差异已导出');
    },


    _escapeHtml: function (str) {
        var div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    },

    _loadChatHistory: function () {
        try {
            var key = 'spec_chat_' + this._currentProjectId;
            var saved = localStorage.getItem(key);
            this._chatHistory = saved ? JSON.parse(saved) : [];
        } catch (e) { this._chatHistory = []; }
    },

    _saveChatHistory: function () {
        try {
            var key = 'spec_chat_' + this._currentProjectId;
            localStorage.setItem(key, JSON.stringify(this._chatHistory.slice(-40)));
        } catch (e) { }
    },

    _renderChatHistory: function () {
        var mc = document.getElementById('modalChatMessages');
        if (!mc || this._chatHistory.length === 0) return;
        mc.innerHTML = '';
        for (var i = 0; i < this._chatHistory.length; i++) {
            var msg = this._chatHistory[i];
            if (msg.role === 'user') {
                mc.innerHTML += '<div style="display:flex;justify-content:flex-end;"><div style="background:var(--primary);color:white;padding:10px 16px;border-radius:16px 16px 4px 16px;max-width:75%;font-size:14px;">' + this._escapeHtml(msg.content) + '</div></div>';
            } else {
                mc.innerHTML += '<div style="display:flex;justify-content:flex-start;"><div style="background:var(--gray-50);border:1px solid var(--gray-200);padding:12px 16px;border-radius:16px 16px 16px 4px;max-width:85%;font-size:14px;"><div class="report-content">' + (typeof renderAiMarkdown === 'function' ? renderAiMarkdown(msg.content) : marked.parse(msg.content)) + '</div></div></div>';
            }
        }
        mc.scrollTop = mc.scrollHeight;
    },

    clearChatHistory: function () {
        this._chatHistory = [];
        this._saveChatHistory();
        var mc = document.getElementById('modalChatMessages');
        if (mc) mc.innerHTML = '<div style="text-align:center;padding:30px;color:var(--gray-400);"><div style="font-size:40px;margin-bottom:12px;">🤖</div><div style="font-size:14px;">接口 AI 助手</div></div>';
        showToast('已清空');
    },

    copyCodeBlock: function (blockId) {
        var el = document.getElementById(blockId);
        if (!el) return;
        var text = el.textContent;
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(function () { showToast('已复制'); });
        } else {
            var ta = document.createElement('textarea'); ta.value = text;
            document.body.appendChild(ta); ta.select(); document.execCommand('copy');
            document.body.removeChild(ta); showToast('已复制');
        }
    },

    _ensureChatModal: function () {
        if (document.getElementById('interfaceChatModal')) return;
        var m = document.createElement('div');
        m.id = 'interfaceChatModal'; m.className = 'modal';
        m.innerHTML = '<div class="modal-content modal-large" style="height:80vh;display:flex;flex-direction:column;">' +
            '<div class="modal-header" style="flex-shrink:0;"><h3>🤖 接口 AI 助手</h3><button class="modal-close" onclick="closeModal(\'interfaceChatModal\')">×</button></div>' +
            '<div style="padding:8px 16px;border-bottom:1px solid var(--gray-100);display:flex;gap:6px;flex-wrap:wrap;flex-shrink:0;">' +
            '<button class="btn btn-outline btn-xs" onclick="InterfaceSpec.quickChat(\'帮我生成请求住院病人信息接口的XML报文\')">📝 生成请求</button>' +
            '<button class="btn btn-outline btn-xs" onclick="InterfaceSpec.quickChat(\'列出所有接口的字段映射关系表\')">📋 字段映射</button>' +
            '<button class="btn btn-outline btn-xs" onclick="InterfaceSpec.quickChat(\'给出接口对接方案和建议步骤\')">📊 对接方案</button>' +
            '<button class="btn btn-outline btn-xs" onclick="InterfaceSpec.clearChatHistory()" style="margin-left:auto;color:var(--gray-400);">🗑️ 清空</button></div>' +
            '<div id="modalChatMessages" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;"><div style="text-align:center;padding:30px;color:var(--gray-400);"><div style="font-size:40px;margin-bottom:12px;">🤖</div><div style="font-size:14px;">接口 AI 助手</div><div style="font-size:12px;margin-top:6px;">可帮您生成报文、查询映射、排查问题</div></div></div>' +
            '<div style="padding:12px 16px;border-top:1px solid var(--gray-100);display:flex;gap:8px;flex-shrink:0;">' +
            '<input id="modalChatInput" type="text" class="form-control" placeholder="输入问题..." style="flex:1;border-radius:20px;padding:10px 16px;" onkeydown="if(event.key===\'Enter\')InterfaceSpec.sendChatMessage()">' +
            '<button class="btn btn-primary" onclick="InterfaceSpec.sendChatMessage()" style="border-radius:20px;padding:10px 20px;">发送</button></div></div>';
        document.body.appendChild(m);
    },

    openChatModal: function () {
        this._ensureChatModal();
        var modal = document.getElementById('interfaceChatModal');
        if (modal) modal.style.zIndex = '9999';
        openModal('interfaceChatModal');
        this._renderChatHistory();
        setTimeout(function () { var el = document.getElementById('modalChatInput'); if (el) el.focus(); }, 300);
    },

    quickChat: function (text) {
        var input = document.getElementById('modalChatInput');
        if (input) input.value = text;
        this.sendChatMessage();
    },

    sendChatMessage: async function () {
        var input = document.getElementById('modalChatInput');
        var mc = document.getElementById('modalChatMessages');
        if (!input || !input.value.trim() || !mc) return;
        var text = input.value.trim(); input.value = '';
        var welcome = mc.querySelector('[style*="text-align:center"]');
        if (welcome && mc.children.length === 1) mc.innerHTML = '';
        mc.innerHTML += '<div style="display:flex;justify-content:flex-end;"><div style="background:var(--primary);color:white;padding:10px 16px;border-radius:16px 16px 4px 16px;max-width:75%;font-size:14px;">' + this._escapeHtml(text) + '</div></div>';
        var lid = 'ai-' + Date.now();
        mc.innerHTML += '<div id="' + lid + '" style="display:flex;justify-content:flex-start;"><div style="background:var(--gray-50);border:1px solid var(--gray-200);padding:12px 16px;border-radius:16px;font-size:14px;"><span class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px;"></span>思考中...</div></div>';
        mc.scrollTop = mc.scrollHeight;
        try {
            var cat = (document.getElementById('compareCategory') || {}).value || this._currentCategory;
            var res = await api.post('/projects/' + this._currentProjectId + '/interface-specs/chat', { message: text, category: cat });
            var answer = res.answer || JSON.stringify(res);
            var el = document.getElementById(lid);
            if (el) el.outerHTML = '<div style="display:flex;justify-content:flex-start;"><div style="background:var(--gray-50);border:1px solid var(--gray-200);padding:12px 16px;border-radius:16px 16px 16px 4px;max-width:85%;font-size:14px;line-height:1.7;"><div class="report-content">' + (typeof renderAiMarkdown === 'function' ? renderAiMarkdown(answer) : marked.parse(answer)) + '</div></div></div>';
            this._chatHistory.push({ role: 'user', content: text });
            this._chatHistory.push({ role: 'assistant', content: answer });
            this._saveChatHistory();
        } catch (e) {
            var el2 = document.getElementById(lid);
            if (el2) el2.outerHTML = '<div style="display:flex;justify-content:flex-start;"><div style="background:#fef2f2;border:1px solid #fecaca;padding:10px 16px;border-radius:16px;color:var(--danger);font-size:13px;">请求失败: ' + (e.message || '') + '</div></div>';
        }
        mc.scrollTop = mc.scrollHeight;
    },
    // ==================== 兼容别名（桥接 HTML 中不带下划线的调用）====================
    handleFileSelect: function () { return this._handleFileSelect(); },
    submitParse: function () { return this._submitParse(); },
    onSourceChange: function () { return this._onSourceChange(); },
    ensureUploadModal: function () { return this._ensureUploadModal(); },
    loadChatHistory: function () { return this._loadChatHistory(); },
    saveChatHistory: function () { return this._saveChatHistory(); },
    renderChatHistory: function () { return this._renderChatHistory(); },
    ensureChatModal: function () { return this._ensureChatModal(); },
    escapeHtml: function (str) { return this._escapeHtml(str); }


};
