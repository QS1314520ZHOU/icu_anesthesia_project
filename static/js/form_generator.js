const FormGenerator = {
    _lastDocumentData: null,
    _version: 'v6',
    _bindingTemplates: {
        patient: [
            'patient.dept',
            'patient.showBed',
            'patient.hisBed',
            'patient.name',
            'patient.gender',
            'patient.age',
            'patient.mrn',
            'patient.hisPid',
            'patient.admissionTime',
            'patient.icuAdmissionTime',
            'patient.bedPhysician',
            'patient.responsibleNurse',
            'patient.clinicalDiagnosis',
            'patient.height',
            'patient.weight'
        ],
        form: [
            'form.field',
            'form.date',
            'form.signature',
            'form.note'
        ]
    },
    _patientFieldSequence: [
        'patient.dept',
        'patient.showBed',
        'patient.name',
        'patient.gender',
        'patient.age',
        'patient.mrn',
        'patient.admissionTime',
        'patient.icuAdmissionTime',
        'patient.bedPhysician',
        'patient.responsibleNurse',
        'patient.clinicalDiagnosis',
        'patient.height',
        'patient.weight'
    ],
    _bindingLabelMap: {
        '科室': 'patient.dept',
        '病人科室': 'patient.dept',
        '病区': 'patient.dept',
        '床号': 'patient.showBed',
        'his床号': 'patient.hisBed',
        '姓名': 'patient.name',
        '性别': 'patient.gender',
        '年龄': 'patient.age',
        '儿童年龄': 'patient.age',
        '住院号': 'patient.mrn',
        '病历号': 'patient.hisPid',
        '入院日期': 'patient.admissionTime',
        '入院时间': 'patient.admissionTime',
        '入科时间': 'patient.icuAdmissionTime',
        '管床医师': 'patient.bedPhysician',
        '责任护士': 'patient.responsibleNurse',
        '诊断': 'patient.clinicalDiagnosis',
        '临床诊断': 'patient.clinicalDiagnosis',
        '身高': 'patient.height',
        '体重': 'patient.weight'
    },

    init: function () {
        console.log('[FormGenerator] Initialized');
        this.onModeChange();
    },

    _setSmartStatus: function (text, isError = false) {
        const el = document.getElementById('fgSmartStatus');
        if (!el) return;
        el.textContent = text || '';
        el.style.color = isError ? 'var(--danger)' : 'var(--gray-500)';
    },

    _authHeaders: function (extra = {}) {
        const headers = { ...extra };
        const token = localStorage.getItem('token');
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        return headers;
    },

    _unwrapFormApiResponse: function (json) {
        if (!json || typeof json !== 'object') {
            return json;
        }
        if (!('success' in json)) {
            return json;
        }
        if (!json.success) {
            throw new Error(json.message || json.error || '请求失败');
        }

        const wrapperKeys = ['success', 'data', 'message', 'code', 'timestamp'];
        const hasExtraPayloadKeys = Object.keys(json).some(key => !wrapperKeys.includes(key));
        if (hasExtraPayloadKeys) {
            return json;
        }
        return json.data !== undefined ? json.data : json;
    },

    _callFormApi: async function (path, payload, isFormData = false) {
        const response = await fetch(`/api${path}`, {
            method: 'POST',
            headers: isFormData ? this._authHeaders() : this._authHeaders({ 'Content-Type': 'application/json' }),
            body: isFormData ? payload : JSON.stringify(payload || {})
        });
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            const text = await response.text();
            throw new Error(text.startsWith('<') ? '接口返回了登录页/HTML 页面，请确认服务端已更新并保持登录' : `接口未返回 JSON: ${text.slice(0, 120)}`);
        }
        const json = await response.json();
        return this._unwrapFormApiResponse(json);
    },

    _renderDebugInfo: function (payload) {
        const el = document.getElementById('fgDebugInfo');
        if (!el) return;
        if (!payload) {
            el.style.display = 'none';
            el.innerHTML = '';
            return;
        }
        const form = payload.smartcare_form || {};
        const components = form.pages?.[0]?.components || [];
        let businessRows = 0;
        let specialCells = 0;
        components.forEach(comp => {
            if (comp.type === 'table') {
                (comp.rows || []).forEach(row => {
                    if (row.businessRole) businessRows += 1;
                    (row.cells || []).forEach(cell => {
                        if (cell.content && ['modalDatePicker', 'ca-signature', 'date', 'signature'].includes(cell.content.type)) {
                            specialCells += 1;
                        }
                    });
                });
            }
        });
        el.style.display = 'block';
        const outputMode = document.getElementById('fgOutputMode')?.value || 'smartcare';
        const outputLabelMap = {
            smartcare: 'SmartCare 完整 JSON',
            generic: '通用控件数组',
            patient_only: '仅病人信息组件'
        };
        el.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
                <div style="font-weight:800;color:#f8fafc;">调试信息</div>
                <div style="font-size:11px;color:#94a3b8;">Form Generator ${this._version}</div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;font-size:12px;line-height:1.8;">
                <div style="padding:10px;border-radius:10px;background:rgba(255,255,255,0.04);">生成策略：<strong style="color:#fff;">${payload.generation_strategy || 'unknown'}</strong></div>
                <div style="padding:10px;border-radius:10px;background:rgba(255,255,255,0.04);">输出模式：<strong style="color:#fff;">${outputLabelMap[outputMode] || outputMode}</strong></div>
                <div style="padding:10px;border-radius:10px;background:rgba(255,255,255,0.04);">控件数量：<strong style="color:#fff;">${payload.total_count || 0}</strong></div>
                <div style="padding:10px;border-radius:10px;background:rgba(255,255,255,0.04);">是否命中参考：<strong style="color:#fff;">${payload.reference_match ? '是' : '否'}</strong></div>
                <div style="padding:10px;border-radius:10px;background:rgba(255,255,255,0.04);">SmartCare JSON长度：<strong style="color:#fff;">${(payload.smartcare_formatted_text || '').length}</strong></div>
                <div style="padding:10px;border-radius:10px;background:rgba(255,255,255,0.04);">仅结构还原：<strong style="color:#fff;">${payload.structure_only ? '是' : '否'}</strong></div>
                <div style="padding:10px;border-radius:10px;background:rgba(255,255,255,0.04);">视觉OCR单元格：<strong style="color:#fff;">${(payload.vision_analysis?.table_cells || []).length}</strong></div>
                <div style="padding:10px;border-radius:10px;background:rgba(255,255,255,0.04);">业务行角色：<strong style="color:#fff;">${businessRows}</strong></div>
                <div style="padding:10px;border-radius:10px;background:rgba(255,255,255,0.04);">特殊控件格：<strong style="color:#fff;">${specialCells}</strong></div>
            </div>
            ${payload.reference_match ? `<div style="margin-top:10px;font-size:12px;color:#cbd5e1;">命中本地参考：<strong style="color:#fff;">${this._escapeHtml(payload.reference_match.form_name || payload.reference_match.filename || '')}</strong></div>` : ''}
            ${payload.structure_only ? `<div style="margin-top:10px;font-size:12px;color:#fcd34d;">当前结果为表格骨架占位版，单元格中的“单元格X-Y”仅用于辅助还原布局，不代表真实业务字段。</div>` : ''}
        `;
    },

    _renderFieldInsights: function (candidates, summary) {
        const el = document.getElementById('fgFieldInsights');
        if (!el) return;
        const items = Array.isArray(candidates) ? candidates : [];
        const controlSummary = summary || {};
        if (!items.length && !controlSummary.total) {
            el.style.display = 'none';
            el.innerHTML = '';
            return;
        }

        const typeLabelMap = {
            text: '输入框',
            textarea: '多行输入',
            number: '数字框',
            date: '日期框',
            select: '下拉框',
            radio: '单选项',
            checkbox: '多选项',
            title: '标题'
        };

        el.style.display = 'block';
        el.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
                <div style="font-weight:800;color:#0f172a;">识别结果预览</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:12px;">
                    <span style="padding:4px 10px;border-radius:999px;background:#eff6ff;color:#2563eb;">控件总数 ${controlSummary.total || 0}</span>
                    <span style="padding:4px 10px;border-radius:999px;background:#ecfdf5;color:#16a34a;">输入控件 ${controlSummary.input_count || 0}</span>
                    <span style="padding:4px 10px;border-radius:999px;background:#f8fafc;color:#475569;">标题 ${controlSummary.title_count || 0}</span>
                </div>
            </div>
            <div style="font-size:12px;color:#64748b;line-height:1.7;margin-bottom:10px;">下面是系统预判出的字段类型，你可以据此判断“哪些是输入框”。生成后的 JSON 也会尽量按这些类型输出。</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                ${items.map(item => `
                    <span style="padding:8px 10px;border-radius:12px;border:1px solid ${item.is_input ? '#bfdbfe' : '#e2e8f0'};background:${item.is_input ? '#eff6ff' : '#f8fafc'};font-size:12px;color:${item.is_input ? '#1d4ed8' : '#475569'};">
                        ${item.label} · ${typeLabelMap[item.type] || item.type}${item.is_input ? ' · 可输入' : ''}
                    </span>
                `).join('')}
            </div>
        `;
    },

    _renderLayoutInsights: function (layouts) {
        const el = document.getElementById('fgLayoutInsights');
        if (!el) return;
        const items = Array.isArray(layouts) ? layouts : [];
        if (!items.length) {
            el.style.display = 'none';
            el.innerHTML = '';
            return;
        }

        el.style.display = 'block';
        el.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
                <div style="font-weight:800;color:#0f172a;">PDF 表格结构分析</div>
                <div style="padding:4px 10px;border-radius:999px;background:#fff7ed;color:#c2410c;font-size:12px;">检测到 ${items.length} 张表</div>
            </div>
            <div style="font-size:12px;color:#64748b;line-height:1.7;margin-bottom:10px;">这里展示的是从 PDF 直接分析出的表格网格信息，可辅助判断行列、宽度、合并单元格和表头结构。</div>
            <div style="display:grid;gap:10px;">
                ${items.map(item => `
                    <div style="padding:12px;border-radius:12px;background:#fffaf5;border:1px solid #fed7aa;">
                        <div style="font-size:13px;font-weight:700;color:#9a3412;margin-bottom:8px;">第 ${item.page} 页 · 表格 ${item.table_index + 1}</div>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:12px;margin-bottom:8px;">
                            <span style="padding:4px 8px;border-radius:999px;background:#ffffff;border:1px solid #fdba74;">行 ${item.row_count}</span>
                            <span style="padding:4px 8px;border-radius:999px;background:#ffffff;border:1px solid #fdba74;">列 ${item.col_count}</span>
                            <span style="padding:4px 8px;border-radius:999px;background:#ffffff;border:1px solid #fdba74;">合并单元格 ${item.span_cells?.length || 0}</span>
                        </div>
                        <div style="font-size:12px;color:#7c2d12;line-height:1.7;">列宽: ${(item.column_widths || []).join(' / ') || '-'}<br>行高: ${(item.row_heights || []).slice(0, 10).join(' / ') || '-'}</div>
                    </div>
                `).join('')}
            </div>
        `;
    },

    _renderVisionInsights: function (vision) {
        const el = document.getElementById('fgVisionInsights');
        if (!el) return;
        if (!vision || (!vision.text && !(vision.table_cells || []).length && !(vision.date_fields || []).length)) {
            el.style.display = 'none';
            el.innerHTML = '';
            return;
        }
        el.style.display = 'block';
        el.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
                <div style="font-weight:800;color:#0f172a;">AI 视觉 OCR 结果</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:12px;">
                    <span style="padding:4px 10px;border-radius:999px;background:#f5f3ff;color:#7c3aed;">文本 ${(vision.text || '').length} 字</span>
                    <span style="padding:4px 10px;border-radius:999px;background:#f5f3ff;color:#7c3aed;">单元格 ${(vision.table_cells || []).length}</span>
                    <span style="padding:4px 10px;border-radius:999px;background:#f5f3ff;color:#7c3aed;">日期字段 ${(vision.date_fields || []).length}</span>
                </div>
            </div>
            <div style="font-size:12px;color:#64748b;line-height:1.7;margin-bottom:10px;">当本地 OCR 提取弱时，这里展示多模态模型补充识别出的扫描件内容。</div>
            <div style="padding:10px;border-radius:12px;background:#faf5ff;border:1px solid #ddd6fe;font-size:12px;color:#4c1d95;line-height:1.7;white-space:pre-wrap;">${this._escapeHtml((vision.text || '').slice(0, 600) || '未识别到连续文本')}</div>
        `;
    },

    _escapeHtml: function (text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    },

    _normalizeBindingLabel: function (text) {
        return String(text || '').replace(/[:：\s]/g, '').trim();
    },

    _recommendBindingFromLabel: function (text) {
        const normalized = this._normalizeBindingLabel(text);
        if (!normalized) return '';
        if (this._bindingLabelMap[normalized]) {
            return this._bindingLabelMap[normalized];
        }
        const found = Object.keys(this._bindingLabelMap).find(key => normalized.includes(key) || key.includes(normalized));
        return found ? this._bindingLabelMap[found] : '';
    },

    _humanizeFieldKey: function (value) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        return raw
            .replace(/^tbl_/, '')
            .replace(/^field_/, '')
            .replace(/^cell_/, '')
            .replace(/_r\d+c\d+$/, '')
            .replace(/_/g, ' ')
            .trim();
    },

    _looksLikeDateLabel: function (text) {
        const value = String(text || '').trim();
        if (!value) return false;
        return ['日期', '时间', '入院', '入科', '出院', '出生', '评估时间', '手术日期'].some(key => value.includes(key));
    },

    _detectTableCellRole: function (cell, rowIndex, cellIndex) {
        const text = String(cell?.value || '').trim();
        const colspan = Number(cell?.colSpan || 1);
        const rowspan = Number(cell?.rowSpan || 1);
        if (!text) {
            return 'empty';
        }
        if (rowIndex === 0 && (colspan > 1 || text.length <= 12)) {
            return 'header';
        }
        if (rowspan > 1 || colspan > 1) {
            return 'section';
        }
        if (text.length >= 18 || /评估|记录|观察|说明|注意|签名|时间/.test(text)) {
            return 'note';
        }
        if (cellIndex === 0 && text.length <= 12) {
            return 'label';
        }
        return 'value';
    },

    _detectTableRowRole: function (row, rowIndex) {
        if (row && row.role) {
            return row.role;
        }
        const rowRoles = (row?.cells || []).map((cell, cellIndex) => this._detectTableCellRole(cell, rowIndex, cellIndex));
        return rowRoles.includes('header')
            ? 'header'
            : rowRoles.includes('section')
                ? 'section'
                : rowRoles.includes('note')
                    ? 'note'
                    : rowRoles.includes('label')
                        ? 'label'
                        : 'value';
    },

    _detectBusinessRowRoleFromText: function (texts) {
        const joined = texts.join(' ').trim();
        if (!joined) return null;
        if (/签名|签字|护士签名|医生签名/.test(joined)) {
            return 'signature';
        }
        if (/日期|时间|入院|出院|入科|出生|评估时间|操作时间/.test(joined)) {
            return 'date';
        }
        if (/说明|注意|备注|提示|事项/.test(joined)) {
            return 'note';
        }
        return null;
    },

    _extractPatientOnlyFromSmartcare: function (form) {
        if (!form || !form.pages || !form.pages[0] || !Array.isArray(form.pages[0].components)) return [];
        const comps = form.pages[0].components;
        const result = [];
        for (let i = 0; i < comps.length; i++) {
            const current = comps[i];
            const next = comps[i + 1];
            if (current?.type === 'label' && next?.type === 'textField' && typeof next.value === 'string' && next.value.startsWith('patient.')) {
                result.push(current, next);
                i += 1;
            }
        }
        return result;
    },

    _buildDocumentResultText: function (data) {
        const mode = document.getElementById('fgOutputMode')?.value || 'smartcare';
        if (mode === 'generic') {
            return data.formatted_text || JSON.stringify(data.data || [], null, 2);
        }
        if (mode === 'patient_only') {
            const patientOnly = this._extractPatientOnlyFromSmartcare(data.smartcare_form);
            return JSON.stringify(patientOnly, null, 2);
        }
        return data.smartcare_formatted_text || data.formatted_text || JSON.stringify(data.data || [], null, 2);
    },

    _deriveEditableFields: function () {
        const payload = this._lastDocumentData;
        const form = payload?.smartcare_form;
        if (!form || !form.pages || !form.pages[0] || !Array.isArray(form.pages[0].components)) {
            return [];
        }
        const comps = form.pages[0].components;
        const fields = [];
        for (let i = 0; i < comps.length; i++) {
            const current = comps[i];
            const next = comps[i + 1];
            if (current?.type === 'label') {
                const labelText = String(current.text || '').replace(/[:：]\s*$/, '').trim();
                if (!labelText) continue;
                if (next && ['textField', 'modalDatePicker', 'checkBox', 'radio'].includes(next.type)) {
                    fields.push({
                        label: labelText,
                        type: next.type === 'modalDatePicker' ? 'date' : (next.type === 'checkBox' ? 'checkbox' : (next.type || 'text')),
                        value: next.value || '',
                        readonly: !!next.readonly,
                        width: next.width || '',
                        options: Array.isArray(next.options) ? next.options.map(opt => typeof opt === 'string' ? opt : (opt.label || opt.value || '')).filter(Boolean) : [],
                        required: !!next.required,
                        dataType: next.dataType || null
                    });
                    i += 1;
                    continue;
                }
                fields.push({
                    label: labelText,
                    type: current.fontSize && current.fontSize > 1 ? 'title' : 'label',
                    value: '',
                    readonly: false,
                    width: '',
                    options: [],
                    required: false,
                    dataType: null
                });
            }
            if (current?.category === 'table_overlay') {
                fields.push({
                    label: this._humanizeFieldKey(current.code || current.value || `table_cell_${i}`),
                    type: current.type === 'modalDatePicker' ? 'date' : 'text',
                    value: current.value || '',
                    readonly: !!current.readonly,
                    width: current.width || '',
                    options: [],
                    required: !!current.required,
                    dataType: current.dataType || null
                });
            }
        }
        return fields;
    },

    _deriveEditableTables: function () {
        const form = this._lastDocumentData?.smartcare_form;
        if (!form || !form.pages || !form.pages[0] || !Array.isArray(form.pages[0].components)) {
            return [];
        }
        return form.pages[0].components
            .map((comp, index) => ({ comp, index }))
            .filter(item => item.comp && item.comp.type === 'table' && Array.isArray(item.comp.rows))
            .map(item => ({
                index: item.index,
                rows: item.comp.rows || [],
                x: item.comp.x,
                y: item.comp.y,
                width: item.comp.width
            }));
    },

    _renderFieldEditor: function (fields) {
        const el = document.getElementById('fgFieldEditor');
        if (!el) return;
        if (!fields || !fields.length) {
            el.innerHTML = '<div style="color:var(--gray-400);text-align:center;padding:36px 12px;">当前结果中没有可编辑字段。</div>';
            return;
        }
        const typeOptions = ['title', 'text', 'textarea', 'number', 'date', 'select', 'radio', 'checkbox'];
        el.innerHTML = `
            <div style="display:grid;gap:12px;">
                ${fields.map((field, index) => `
                    <div data-field-row="${index}" style="padding:12px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">
                        <div style="display:grid;grid-template-columns:1.2fr 140px 1.2fr 120px 120px;gap:10px;align-items:end;">
                            <div>
                                <label style="display:block;font-size:12px;color:#64748b;margin-bottom:6px;">字段名</label>
                                <input data-key="label" value="${this._escapeHtml(field.label || '')}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:10px;">
                            </div>
                            <div>
                                <label style="display:block;font-size:12px;color:#64748b;margin-bottom:6px;">类型</label>
                                <select data-key="type" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:10px;background:white;">
                                    ${typeOptions.map(opt => `<option value="${opt}" ${field.type === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                                </select>
                            </div>
                            <div>
                                <label style="display:block;font-size:12px;color:#64748b;margin-bottom:6px;">绑定值 / value</label>
                                <input data-key="value" value="${this._escapeHtml(field.value || '')}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:10px;">
                            </div>
                            <div>
                                <label style="display:block;font-size:12px;color:#64748b;margin-bottom:6px;">宽度</label>
                                <input data-key="width" type="number" value="${this._escapeHtml(field.width || '')}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:10px;">
                            </div>
                            <div style="display:flex;align-items:center;gap:8px;height:40px;">
                                <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#475569;">
                                    <input data-key="readonly" type="checkbox" ${field.readonly ? 'checked' : ''}>
                                    只读
                                </label>
                            </div>
                        </div>
                        <div style="margin-top:10px;">
                            <label style="display:block;font-size:12px;color:#64748b;margin-bottom:6px;">选项（下拉/单选/多选，逗号分隔）</label>
                            <input data-key="options" value="${this._escapeHtml((field.options || []).join(', '))}" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:10px;">
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    },

    _renderTableEditor: function (tables) {
        const el = document.getElementById('fgTableEditor');
        if (!el) return;
        if (!tables || !tables.length) {
            el.innerHTML = '<div style="color:var(--gray-400);text-align:center;padding:36px 12px;">当前结果中没有 table 组件。</div>';
            return;
        }
        const rowRoleOptions = [
            ['header', '表头行'],
            ['section', '分组行'],
            ['note', '说明行'],
            ['date', '日期行'],
            ['signature', '签名行'],
            ['label', '字段行'],
            ['value', '内容行']
        ];

        el.innerHTML = `
            <div style="display:grid;gap:18px;">
                ${tables.map((table, tableIndex) => `
                    <div data-table-index="${table.index}" style="padding:14px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
                            <div style="font-size:14px;font-weight:800;color:#0f172a;">Table 组件 #${tableIndex + 1}</div>
                            <div style="font-size:12px;color:#64748b;">位置 (${table.x || 0}, ${table.y || 0}) · 宽度 ${table.width || '-'}</div>
                        </div>
                        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;padding:10px 12px;border-radius:12px;background:#ffffff;border:1px dashed #cbd5e1;">
                            <span style="font-size:12px;color:#64748b;">列绑定工作台</span>
                            <select data-bind-col="1" style="width:120px;padding:8px;border:1px solid #cbd5e1;border-radius:10px;background:white;">
                                ${Array.from({ length: Math.max(...(table.rows || []).map(r => (r.cells || []).length), 0) }).map((_, idx) => `<option value="${idx}">第 ${idx + 1} 列</option>`).join('')}
                            </select>
                            <select data-bind-type="1" style="width:140px;padding:8px;border:1px solid #cbd5e1;border-radius:10px;background:white;">
                                <option value="value">普通字段列</option>
                                <option value="date">日期列</option>
                                <option value="signature">签名列</option>
                                <option value="label">标签列</option>
                            </select>
                            <select data-bind-template="1" style="width:180px;padding:8px;border:1px solid #cbd5e1;border-radius:10px;background:white;" onchange="FormGenerator.applyBindingTemplate(this)">
                                <option value="">选择业务字段模板</option>
                                ${this._bindingTemplates.patient.map(v => `<option value="${v}">${v}</option>`).join('')}
                                ${this._bindingTemplates.form.map(v => `<option value="${v}">${v}</option>`).join('')}
                            </select>
                            <input data-bind-prefix="1" placeholder="绑定前缀，如 patientExt" style="width:180px;padding:8px;border:1px solid #cbd5e1;border-radius:10px;">
                            <button class="btn btn-outline btn-xs" onclick="FormGenerator.applyColumnBinding(this)">🔗 应用列绑定</button>
                        </div>
                        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;padding:10px 12px;border-radius:12px;background:#ffffff;border:1px dashed #cbd5e1;">
                            <span style="font-size:12px;color:#64748b;">列级操作</span>
                            <select data-col-target="1" style="width:140px;padding:8px;border:1px solid #cbd5e1;border-radius:10px;background:white;">
                                ${Array.from({ length: Math.max(...(table.rows || []).map(r => (r.cells || []).length), 0) }).map((_, idx) => `<option value="${idx}">第 ${idx + 1} 列</option>`).join('')}
                            </select>
                            <button class="btn btn-outline btn-xs" onclick="FormGenerator.applyColumnRole(this, 'date')">📅 设为日期列</button>
                            <button class="btn btn-outline btn-xs" onclick="FormGenerator.applyColumnRole(this, 'signature')">✍️ 设为签名列</button>
                            <button class="btn btn-outline btn-xs" onclick="FormGenerator.applyColumnRole(this, 'clear')">🧹 清除特殊控件</button>
                        </div>
                        <div style="overflow:auto;">
                            <table style="border-collapse:collapse;width:100%;min-width:720px;background:#fff;">
                                <tbody>
                                    ${table.rows.map((row, rowIndex) => `
                                        <tr>
                                            <td style="border:1px solid #cbd5e1;padding:8px;vertical-align:top;background:#f8fafc;min-width:120px;">
                                                <div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">第${rowIndex + 1}行</div>
                                                <select data-row-role="1" data-row="${rowIndex}" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:10px;background:white;">
                                                    ${rowRoleOptions.map(([value, label]) => `<option value="${value}" ${this._detectTableRowRole(row, rowIndex) === value ? 'selected' : ''}>${label}</option>`).join('')}
                                                </select>
                                            </td>
                                            ${(row.cells || []).map((cell, cellIndex) => `
                                                <td colspan="${cell.colSpan || 1}" rowspan="${cell.rowSpan || 1}" style="border:1px solid #cbd5e1;padding:8px;vertical-align:top;min-width:${Math.max(80, (cell.width || 2) * 10)}px;">
                                                    <div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">R${rowIndex + 1} C${cellIndex + 1} · colspan ${cell.colSpan || 1} · rowspan ${cell.rowSpan || 1}</div>
                                                    <textarea data-cell-editor="1" data-row="${rowIndex}" data-cell="${cellIndex}" style="width:100%;min-height:${Math.max(48, (cell.height || 1) * 18)}px;padding:8px;border:1px solid #e2e8f0;border-radius:10px;font-family:inherit;resize:vertical;">${this._escapeHtml(cell.value || '')}</textarea>
                                                    <label style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:12px;color:#475569;">
                                                        <input type="checkbox" data-cell-date="1" data-row="${rowIndex}" data-cell="${cellIndex}" ${cell.content && cell.content.type === 'date' ? 'checked' : ''}>
                                                        标记为日期控件
                                                    </label>
                                                    <div style="margin-top:6px;font-size:11px;color:#64748b;">绑定键：<span data-cell-binding="${rowIndex}-${cellIndex}">${this._escapeHtml(cell.bindingKey || '') || '未设置'}</span></div>
                                                </td>
                                            `).join('')}
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    },

    refreshFieldEditor: function () {
        this._renderFieldEditor(this._deriveEditableFields());
    },

    refreshTableEditor: function () {
        this._renderTableEditor(this._deriveEditableTables());
    },

    applyColumnRole: function (btn, role) {
        const block = btn.closest('[data-table-index]');
        if (!block) return;
        const select = block.querySelector('[data-col-target="1"]');
        const targetCol = Number(select?.value || 0);
        const inputs = Array.from(block.querySelectorAll(`[data-cell-editor="1"][data-cell="${targetCol}"]`));
        if (!inputs.length) {
            showToast('当前列没有可编辑单元格', 'warning');
            return;
        }
        inputs.forEach(input => {
            const row = input.getAttribute('data-row');
            const cell = input.getAttribute('data-cell');
            const dateToggle = block.querySelector(`[data-cell-date="1"][data-row="${row}"][data-cell="${cell}"]`);
            if (dateToggle) {
                dateToggle.checked = role === 'date';
            }
            if (role === 'signature') {
                input.dataset.signatureColumn = '1';
            } else {
                delete input.dataset.signatureColumn;
            }
            if (role === 'clear' && dateToggle) {
                dateToggle.checked = false;
            }
        });
        showToast(role === 'date' ? '已标记为日期列' : role === 'signature' ? '已标记为签名列' : '已清除此列特殊控件', 'success');
    },

    applyColumnBinding: function (btn) {
        const block = btn.closest('[data-table-index]');
        if (!block) return;
        const targetCol = Number(block.querySelector('[data-bind-col="1"]')?.value || 0);
        const bindType = block.querySelector('[data-bind-type="1"]')?.value || 'value';
        const prefix = (block.querySelector('[data-bind-prefix="1"]')?.value || 'formField').trim();
        const inputs = Array.from(block.querySelectorAll(`[data-cell-editor="1"][data-cell="${targetCol}"]`));
        if (!inputs.length) {
            showToast('当前列没有可绑定单元格', 'warning');
            return;
        }
        let changed = 0;
        inputs.forEach(input => {
            const row = Number(input.getAttribute('data-row'));
            const cell = Number(input.getAttribute('data-cell'));
            const binding = `${prefix}_${row + 1}_${cell + 1}`;
            input.dataset.bindingKey = binding;
            const bindingEl = block.querySelector(`[data-cell-binding="${row}-${cell}"]`);
            if (bindingEl) bindingEl.textContent = binding;

            const dateToggle = block.querySelector(`[data-cell-date="1"][data-row="${row}"][data-cell="${cell}"]`);
            if (bindType === 'date' && dateToggle) {
                dateToggle.checked = true;
            }
            if (bindType === 'signature') {
                input.dataset.signatureColumn = '1';
            } else if (bindType === 'clear') {
                delete input.dataset.signatureColumn;
                if (dateToggle) dateToggle.checked = false;
            }
            if (bindType === 'label') {
                const rowRole = block.querySelector(`[data-row-role="1"][data-row="${row}"]`);
                if (rowRole && rowRole.value === 'value') rowRole.value = 'label';
            }
            changed += 1;
        });
        showToast(`已为第 ${targetCol + 1} 列应用 ${changed} 个绑定`, 'success');
    },

    applyBindingTemplate: function (selectEl) {
        const block = selectEl.closest('[data-table-index]');
        if (!block) return;
        const value = selectEl.value || '';
        const prefixInput = block.querySelector('[data-bind-prefix="1"]');
        if (!prefixInput) return;
        if (!value) return;
        prefixInput.value = value;
    },

    autoRecommendBindings: function () {
        const tableBlocks = Array.from(document.querySelectorAll('#fgTableEditor [data-table-index]'));
        if (!tableBlocks.length) {
            showToast('当前没有可推荐绑定的表格', 'warning');
            return;
        }
        let count = 0;
        tableBlocks.forEach(block => {
            const firstColInputs = Array.from(block.querySelectorAll('[data-cell-editor="1"][data-cell="0"]'));
            firstColInputs.forEach(input => {
                const row = input.getAttribute('data-row');
                const rowRole = block.querySelector(`[data-row-role="1"][data-row="${row}"]`);
                const role = rowRole?.value || 'value';
                if (!['label', 'header', 'section', 'date'].includes(role)) return;
                const suggestion = this._recommendBindingFromLabel(input.value);
                if (!suggestion) return;
                const targetRow = Number(row);
                const allInputs = Array.from(block.querySelectorAll('[data-cell-editor="1"]'));
                allInputs
                    .filter(item => Number(item.getAttribute('data-row')) === targetRow)
                    .forEach(item => {
                        const cell = Number(item.getAttribute('data-cell'));
                        const binding = `${suggestion}_${cell + 1}`;
                        item.dataset.bindingKey = binding;
                        const bindingEl = block.querySelector(`[data-cell-binding="${targetRow}-${cell}"]`);
                        if (bindingEl) bindingEl.textContent = binding;
                    });
                count += 1;
            });
        });
        showToast(count ? `已自动应用 ${count} 行业务绑定推荐` : '未识别到可推荐的业务字段', count ? 'success' : 'warning');
    },

    applyPatientTemplate: function () {
        const tableBlocks = Array.from(document.querySelectorAll('#fgTableEditor [data-table-index]'));
        if (!tableBlocks.length) {
            showToast('当前没有可套用模板的表格', 'warning');
            return;
        }
        let applied = 0;
        tableBlocks.forEach(block => {
            const rows = Array.from(block.querySelectorAll('[data-row-role="1"]'));
            rows.forEach((rowSelect, idx) => {
                const row = Number(rowSelect.getAttribute('data-row'));
                const role = rowSelect.value || 'value';
                if (!['label', 'date', 'value', 'section'].includes(role)) return;
                const bindingBase = this._patientFieldSequence[idx];
                if (!bindingBase) return;
                const inputs = Array.from(block.querySelectorAll(`[data-cell-editor="1"][data-row="${row}"]`));
                inputs.forEach((input, cellIdx) => {
                    const binding = `${bindingBase}${cellIdx > 0 ? `_${cellIdx + 1}` : ''}`;
                    input.dataset.bindingKey = binding;
                    const bindingEl = block.querySelector(`[data-cell-binding="${row}-${cellIdx}"]`);
                    if (bindingEl) bindingEl.textContent = binding;
                });
                applied += 1;
            });
        });
        showToast(applied ? `已为 ${applied} 行套用病人信息模板` : '当前表格未命中可套用的病人信息行', applied ? 'success' : 'warning');
    },

    autoDetectTableRowRoles: function () {
        const rows = Array.from(document.querySelectorAll('#fgTableEditor [data-row-role="1"]'));
        if (!rows.length) {
            showToast('当前没有可分析的表格行', 'warning');
            return;
        }
        let changed = 0;
        rows.forEach(select => {
            const rowIndex = select.getAttribute('data-row');
            const textareas = Array.from(document.querySelectorAll(`#fgTableEditor [data-cell-editor="1"][data-row="${rowIndex}"]`));
            const texts = textareas.map(item => item.value.trim()).filter(Boolean);
            const predicted = this._detectBusinessRowRoleFromText(texts);
            if (predicted && select.value !== predicted) {
                select.value = predicted;
                changed += 1;
            }
        });
        showToast(changed ? `已预判 ${changed} 行业务类型` : '没有识别到明显的日期/签名/说明行', changed ? 'success' : 'warning');
    },

    autoMarkDateCells: function () {
        const checkboxes = Array.from(document.querySelectorAll('#fgTableEditor [data-cell-date="1"]'));
        if (!checkboxes.length) {
            showToast('当前没有可编辑的表格单元格', 'warning');
            return;
        }
        let marked = 0;
        checkboxes.forEach(box => {
            const row = box.getAttribute('data-row');
            const cell = box.getAttribute('data-cell');
            const textarea = document.querySelector(`#fgTableEditor [data-cell-editor="1"][data-row="${row}"][data-cell="${cell}"]`);
            if (!textarea) return;
            if (this._looksLikeDateLabel(textarea.value)) {
                box.checked = true;
                marked += 1;
            }
        });
        showToast(marked ? `已自动标记 ${marked} 个日期单元格` : '未识别到明显的日期/时间单元格', marked ? 'success' : 'warning');
    },

    autoFillTableCellsFromVision: function () {
        const payload = this._lastDocumentData || {};
        const vision = payload.vision_analysis || {};
        const tableBlocks = Array.from(document.querySelectorAll('#fgTableEditor [data-table-index]'));
        if (!tableBlocks.length) {
            showToast('当前没有可回填的表格', 'warning');
            return;
        }

        const byCoord = new Map();
        (vision.table_cells || []).forEach(cell => {
            const key = `${cell.row}-${cell.col}`;
            if (cell.text && !byCoord.has(key)) {
                byCoord.set(key, cell.text);
            }
        });

        let fallbackLines = [];
        if (!byCoord.size && vision.text) {
            fallbackLines = vision.text
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(Boolean)
                .filter(line => line.length <= 50);
        }

        let fillCount = 0;
        tableBlocks.forEach(block => {
            const textareas = Array.from(block.querySelectorAll('[data-cell-editor="1"]'));
            const sortedTextareas = textareas.sort((a, b) => {
                const rowA = Number(a.getAttribute('data-row'));
                const rowB = Number(b.getAttribute('data-row'));
                const cellA = Number(a.getAttribute('data-cell'));
                const cellB = Number(b.getAttribute('data-cell'));
                const weightA = cellA === 0 ? -1 : cellA;
                const weightB = cellB === 0 ? -1 : cellB;
                return rowA - rowB || weightA - weightB;
            });
            sortedTextareas.forEach(textarea => {
                const row = textarea.getAttribute('data-row');
                const cell = textarea.getAttribute('data-cell');
                const key = `${row}-${cell}`;
                if (byCoord.has(key)) {
                    textarea.value = byCoord.get(key);
                    fillCount += 1;
                } else if (!textarea.value.trim() && fallbackLines.length) {
                    const nextLine = fallbackLines.shift();
                    if (nextLine) {
                        textarea.value = nextLine;
                        fillCount += 1;
                    }
                }
            });
        });

        if (fillCount) {
            showToast(`已回填 ${fillCount} 个单元格`, 'success');
        } else {
            showToast('当前没有可用于回填的 OCR 文本', 'warning');
        }
    },

    autoFillHeadersFirst: function () {
        const tableBlocks = Array.from(document.querySelectorAll('#fgTableEditor [data-table-index]'));
        if (!tableBlocks.length) {
            showToast('当前没有可处理的表格', 'warning');
            return;
        }
        let touched = 0;
        tableBlocks.forEach(block => {
            const rows = Array.from(block.querySelectorAll('[data-row-role="1"]'));
            rows.forEach(select => {
                const rowIndex = Number(select.getAttribute('data-row'));
                const cells = Array.from(block.querySelectorAll(`[data-cell-editor="1"][data-row="${rowIndex}"]`));
                const firstCell = cells.find(cell => Number(cell.getAttribute('data-cell')) === 0);
                if (!firstCell) return;
                const text = (firstCell.value || '').trim();
                if (!text) return;
                if (text.length <= 12 && !/[，。,.;；]/.test(text)) {
                    if (rowIndex === 0) {
                        select.value = 'header';
                    } else {
                        select.value = 'label';
                    }
                    touched += 1;
                }
            });
        });
        showToast(touched ? `已优化 ${touched} 行的首列/表头判定` : '未识别到可优化的首列/表头内容', touched ? 'success' : 'warning');
    },

    applyFieldEdits: async function () {
        const rows = Array.from(document.querySelectorAll('#fgFieldEditor [data-field-row]'));
        if (!rows.length) {
            showToast('当前没有可编辑字段', 'warning');
            return;
        }
        const fields = rows.map(row => {
            const get = key => row.querySelector(`[data-key="${key}"]`);
            const optionsRaw = get('options')?.value || '';
            const type = get('type')?.value || 'text';
            return {
                label: get('label')?.value?.trim() || '',
                type,
                value: get('value')?.value?.trim() || '',
                width: Number(get('width')?.value || 0) || undefined,
                readonly: !!get('readonly')?.checked,
                options: ['select', 'radio', 'checkbox'].includes(type) ? optionsRaw.split(',').map(item => item.trim()).filter(Boolean) : [],
                dataType: type === 'date' ? { type: 'date', format: 'yyyy-MM-dd' } : null
            };
        }).filter(item => item.label);

        if (!fields.length) {
            showToast('请至少保留一个字段', 'warning');
            return;
        }

        const fileInput = document.getElementById('fgSourceFile');
        const sourceName = fileInput && fileInput.files && fileInput.files[0]
            ? fileInput.files[0].name
            : (this._lastDocumentData?.reference_match?.form_name || '智能生成表单');

        try {
            const rebuilt = await this._callFormApi('/form-generator/rebuild-smartcare', {
                fields,
                source_name: sourceName
            });
            this._lastDocumentData = {
                ...(this._lastDocumentData || {}),
                data: fields,
                formatted_text: JSON.stringify(fields, null, 2),
                smartcare_form: rebuilt.smartcare_form,
                smartcare_formatted_text: rebuilt.smartcare_formatted_text,
                total_count: rebuilt.total_count
            };
            document.getElementById('fgResult').value = this._buildDocumentResultText(this._lastDocumentData);
            this._renderDebugInfo(this._lastDocumentData);
            this.renderPreview();
            showToast('字段修改已应用到 SmartCare JSON', 'success');
        } catch (err) {
            console.error(err);
            showToast('重建失败: ' + err.message, 'error');
        }
    },

    applyTableEdits: function () {
        const form = this._lastDocumentData?.smartcare_form;
        if (!form || !form.pages || !form.pages[0]) {
            showToast('当前没有可编辑的表格', 'warning');
            return;
        }

        const tableBlocks = Array.from(document.querySelectorAll('#fgTableEditor [data-table-index]'));
        if (!tableBlocks.length) {
            showToast('当前没有 table 组件', 'warning');
            return;
        }

        tableBlocks.forEach(block => {
            const tableIndex = Number(block.getAttribute('data-table-index'));
            const tableComp = form.pages[0].components[tableIndex];
            if (!tableComp || !Array.isArray(tableComp.rows)) return;
            const rowRoleSelectors = Array.from(block.querySelectorAll('[data-row-role="1"]'));
            rowRoleSelectors.forEach(select => {
                const rowIndex = Number(select.getAttribute('data-row'));
                if (tableComp.rows?.[rowIndex]) {
                    tableComp.rows[rowIndex].role = select.value;
                    tableComp.rows[rowIndex].businessRole = select.value;
                }
            });
            const inputs = Array.from(block.querySelectorAll('[data-cell-editor="1"]'));
            inputs.forEach(input => {
                const rowIndex = Number(input.getAttribute('data-row'));
                const cellIndex = Number(input.getAttribute('data-cell'));
                const cell = tableComp.rows?.[rowIndex]?.cells?.[cellIndex];
                if (!cell) return;
                cell.value = input.value;
                if (input.dataset.bindingKey) {
                    cell.bindingKey = input.dataset.bindingKey;
                }
                const dateCheckbox = block.querySelector(`[data-cell-date="1"][data-row="${rowIndex}"][data-cell="${cellIndex}"]`);
                if (dateCheckbox?.checked) {
                    cell.content = {
                        type: 'modalDatePicker',
                        format: 'yyyy-MM-dd',
                        businessRole: 'date',
                        value: cell.bindingKey || cell.value || `date_${rowIndex + 1}_${cellIndex + 1}`
                    };
                } else if (cell.content && ['date', 'modalDatePicker'].includes(cell.content.type)) {
                    cell.content = null;
                }
                if (input.dataset.signatureColumn === '1') {
                    cell.content = {
                        type: 'ca-signature',
                        businessRole: 'signature',
                        value: cell.bindingKey || cell.value || `sign_${rowIndex + 1}_${cellIndex + 1}`,
                        width: cell.width || 8
                    };
                } else if (cell.content && ['signature', 'ca-signature'].includes(cell.content.type)) {
                    cell.content = null;
                }
            });

            (tableComp.rows || []).forEach((row, rowIndex) => {
                const role = row.role || 'value';
                (row.cells || []).forEach((cell, cellIndex) => {
                    const isLikelyLabel = cellIndex === 0 && !!cell.value;
                    if (role === 'date' && !isLikelyLabel) {
                        cell.content = {
                            type: 'modalDatePicker',
                            format: 'yyyy-MM-dd',
                            businessRole: 'date',
                            value: cell.bindingKey || cell.value || `date_${rowIndex + 1}_${cellIndex + 1}`
                        };
                    } else if (role === 'signature' && !isLikelyLabel) {
                        cell.content = {
                            type: 'ca-signature',
                            businessRole: 'signature',
                            value: cell.bindingKey || cell.value || `sign_${rowIndex + 1}_${cellIndex + 1}`,
                            width: cell.width || 8
                        };
                    } else if ((role === 'header' || role === 'section' || role === 'note') && cell.content && ['modalDatePicker', 'ca-signature', 'date', 'signature'].includes(cell.content.type)) {
                        cell.content = null;
                    } else if (role === 'value' && cell.content && ['signature', 'ca-signature'].includes(cell.content.type)) {
                        cell.content = null;
                    }
                });
            });
        });

        this._lastDocumentData.smartcare_formatted_text = JSON.stringify(form, null, 2);
        document.getElementById('fgResult').value = this._buildDocumentResultText(this._lastDocumentData);
        this._renderDebugInfo(this._lastDocumentData);
        this.renderPreview();
        showToast('表格单元格修改已应用', 'success');
    },

    _applyDocumentResult: function (data) {
        this._lastDocumentData = data || null;
        document.getElementById('fgResult').value = this._buildDocumentResultText(data);
        document.getElementById('fgTemplate').value = (data.data && data.data[0]) ? JSON.stringify(data.data[0], null, 2) : '';
        this._renderLayoutInsights(data.layout_analysis || []);
        this._renderVisionInsights(data.vision_analysis || null);
        this._renderFieldInsights(data.detected_candidates || [], data.control_summary || {});
        this._renderDebugInfo(data);
        this.renderPreview();
        this.refreshFieldEditor();
        this.refreshTableEditor();
    },

    onOutputModeChange: function () {
        if (!this._lastDocumentData) return;
        document.getElementById('fgResult').value = this._buildDocumentResultText(this._lastDocumentData);
        this._renderDebugInfo(this._lastDocumentData);
        this.renderPreview();
    },

    renderPreview: function () {
        const preview = document.getElementById('fgPreview');
        const raw = document.getElementById('fgResult').value.trim();
        if (!preview) return;
        if (!raw) {
            preview.innerHTML = '<div style="color:var(--gray-400);text-align:center;padding:40px 12px;">请先生成表单 JSON。</div>';
            return;
        }

        let items = [];
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                items = parsed;
            } else if (parsed && parsed.pages && parsed.pages[0] && Array.isArray(parsed.pages[0].components)) {
                const comps = parsed.pages[0].components || [];
                const normalized = [];
                for (let i = 0; i < comps.length; i++) {
                    const current = comps[i];
                    const next = comps[i + 1];
                    if (current?.type === 'label') {
                        const labelText = String(current.text || '').replace(/[:：]\s*$/, '').trim();
                        if (next && ['textField', 'checkBox', 'radio'].includes(next.type)) {
                            normalized.push({
                                ...next,
                                label: labelText
                            });
                            i += 1;
                            continue;
                        }
                        normalized.push({
                            ...current,
                            label: labelText,
                            type: current.fontSize && current.fontSize > 1 ? 'title' : 'label',
                            input: false
                        });
                        continue;
                    }
                    if (current?.category === 'table_overlay') {
                        normalized.push({
                            ...current,
                            label: this._humanizeFieldKey(current.code || current.value || ''),
                            autoGenerated: true
                        });
                        continue;
                    }
                    normalized.push(current);
                }
                items = normalized;
            } else if (parsed) {
                items = [parsed];
            }
        } catch (e) {
            preview.innerHTML = `<div style="color:var(--danger);text-align:center;padding:24px;">预览失败：结果不是合法 JSON<br><span style="font-size:12px;color:var(--gray-500);">请先修正 JSON 后再预览</span></div>`;
            return;
        }

        const sorted = items
            .filter(Boolean)
            .slice()
            .sort((a, b) => (Number(a.y || 0) - Number(b.y || 0)) || (Number(a.x || 0) - Number(b.x || 0)));
        const autoGeneratedCount = sorted.filter(item => item?.category === 'table_overlay' || item?.autoGenerated).length;

        const html = sorted.map((item, index) => {
            const type = item.type || 'text';
            const label = this._escapeHtml(item.label || item.field_name || this._humanizeFieldKey(item.value || '') || `字段${index + 1}`);
            const placeholder = this._escapeHtml(item.placeholder || '');
            const required = item.required ? '<span style="color:#dc2626;margin-left:4px;">*</span>' : '';
            const options = Array.isArray(item.options) ? item.options : [];
            const isAutoGenerated = item.category === 'table_overlay' || item.autoGenerated;
            const autoBadge = isAutoGenerated ? '<span style="margin-left:8px;padding:2px 8px;border-radius:999px;background:#ecfeff;color:#0f766e;font-size:10px;font-weight:700;">自动填写位</span>' : '';

            if (type === 'title') {
                return `<div style="margin:8px 0 16px 0;padding-bottom:8px;border-bottom:1px solid #e2e8f0;font-size:18px;font-weight:800;color:#0f172a;">${label}</div>`;
            }

            let controlHtml = '';
            if (type === 'table' && Array.isArray(item.rows)) {
                const tableRows = item.rows.map((row, rowIndex) => {
                    const dominantRole = this._detectTableRowRole(row, rowIndex);
                    const rowBadgeMap = {
                        header: '<span style="padding:3px 8px;border-radius:999px;background:#eff6ff;color:#1e3a8a;font-size:10px;font-weight:700;">表头行</span>',
                        section: '<span style="padding:3px 8px;border-radius:999px;background:#f5f3ff;color:#5b21b6;font-size:10px;font-weight:700;">分组行</span>',
                        note: '<span style="padding:3px 8px;border-radius:999px;background:#fff7ed;color:#9a3412;font-size:10px;font-weight:700;">说明行</span>',
                        date: '<span style="padding:3px 8px;border-radius:999px;background:#ecfeff;color:#0f766e;font-size:10px;font-weight:700;">日期行</span>',
                        signature: '<span style="padding:3px 8px;border-radius:999px;background:#fdf2f8;color:#be185d;font-size:10px;font-weight:700;">签名行</span>',
                        label: '<span style="padding:3px 8px;border-radius:999px;background:#f8fafc;color:#334155;font-size:10px;font-weight:700;">字段行</span>',
                        value: '<span style="padding:3px 8px;border-radius:999px;background:#ffffff;color:#64748b;font-size:10px;font-weight:700;border:1px solid #e2e8f0;">内容行</span>'
                    };
                    const cells = (row.cells || []).map((cell, cellIndex) => {
                        const role = dominantRole !== 'value' ? dominantRole : this._detectTableCellRole(cell, rowIndex, cellIndex);
                        const styleMap = {
                            header: 'background:linear-gradient(180deg,#dbeafe,#eff6ff);color:#1e3a8a;font-weight:800;',
                            section: 'background:linear-gradient(180deg,#ede9fe,#f5f3ff);color:#5b21b6;font-weight:700;',
                            note: 'background:#fff7ed;color:#9a3412;',
                            date: 'background:#ecfeff;color:#0f766e;font-weight:700;',
                            signature: 'background:#fdf2f8;color:#be185d;font-weight:700;',
                            label: 'background:#f8fafc;color:#334155;font-weight:700;',
                            value: 'background:#ffffff;color:#0f172a;',
                            empty: 'background:#ffffff;color:#cbd5e1;'
                        };
                        return `
                        <td colspan="${cell.colSpan || 1}" rowspan="${cell.rowSpan || 1}" style="border:1px solid #cbd5e1;padding:8px 10px;min-width:${Math.max(60, (cell.width || 2) * 10)}px;height:${Math.max(28, (cell.height || 1) * 18)}px;font-size:12px;vertical-align:middle;${styleMap[role]}">
                            ${cell.content && ['date', 'modalDatePicker'].includes(cell.content.type)
                                ? `<input type="date" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:8px;background:white;">`
                                : cell.content && ['signature', 'ca-signature'].includes(cell.content.type)
                                    ? `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:40px;border:1px dashed #ec4899;border-radius:10px;background:#fff1f2;color:#be185d;font-size:12px;gap:4px;"><span style="font-weight:700;">CA签名</span><span style="font-size:10px;opacity:0.8;">${this._escapeHtml(cell.content.value || 'sign')}</span></div>`
                                    : (cell.value ? this._escapeHtml(cell.value) : '')}
                            ${cell.bindingKey ? `<div style="margin-top:4px;font-size:10px;color:#64748b;">${this._escapeHtml(cell.bindingKey)}</div>` : ''}
                        </td>
                    `;}).join('');
                    return `<tr data-role="${dominantRole}" title="第${rowIndex + 1}行">${cells}</tr>`;
                }).join('');
                return `
                    <div style="margin-bottom:18px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px;">
                            <div style="font-size:13px;font-weight:700;color:#334155;">表格组件</div>
                            <div style="display:flex;gap:6px;flex-wrap:wrap;font-size:11px;">
                                <span style="padding:4px 8px;border-radius:999px;background:#eff6ff;color:#1e3a8a;">表头</span>
                                <span style="padding:4px 8px;border-radius:999px;background:#f5f3ff;color:#5b21b6;">分组</span>
                                <span style="padding:4px 8px;border-radius:999px;background:#fff7ed;color:#9a3412;">说明/日期</span>
                            </div>
                        </div>
                        <div style="overflow:auto;border:1px solid #e2e8f0;border-radius:12px;background:#fff;">
                            <table style="border-collapse:collapse;width:100%;">${tableRows}</table>
                        </div>
                        <div style="margin-top:8px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
                            <div style="font-size:11px;color:#94a3b8;">类型: table · 行 ${item.rows.length}</div>
                            <div style="display:flex;gap:6px;flex-wrap:wrap;">
                                ${Array.from(new Set(item.rows.map((row, idx) => this._detectTableRowRole(row, idx)))).map(role => rowBadgeMap[role] || '').join('')}
                            </div>
                        </div>
                    </div>
                `;
            }
            if (type === 'label') {
                return `<div style="margin-bottom:12px;font-size:13px;font-weight:700;color:#334155;">${label}</div>`;
            } else if (type === 'textField' || type === 'text' || type === 'textarea') {
                const isTextArea = type === 'textarea';
                controlHtml = isTextArea
                    ? `<textarea placeholder="${placeholder}" style="width:100%;min-height:92px;padding:10px 12px;border:1px solid #cbd5e1;border-radius:12px;font-family:inherit;resize:vertical;"></textarea>`
                    : `<input type="${item.dataType?.type === 'date' ? 'date' : (item.numberBox ? 'number' : 'text')}" placeholder="${placeholder}" value="${item.readonly && item.value ? this._escapeHtml(item.value) : ''}" style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:12px;" ${item.readonly ? 'readonly' : ''}>`;
            } else if (type === 'number') {
                controlHtml = `<input type="number" placeholder="${placeholder}" style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:12px;">`;
            } else if (type === 'date') {
                controlHtml = `<input type="date" style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:12px;">`;
            } else if (type === 'select') {
                controlHtml = `<select style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:12px;background:white;">
                    <option value="">请选择</option>
                    ${options.map(opt => `<option>${this._escapeHtml(typeof opt === 'string' ? opt : (opt.label || opt.value || '选项'))}</option>`).join('')}
                </select>`;
            } else if (type === 'radio') {
                controlHtml = `<div style="display:flex;gap:14px;flex-wrap:wrap;padding:4px 0;">
                    ${(options.length ? options : ['是', '否']).map(opt => `
                        <label style="display:flex;align-items:center;gap:6px;color:#334155;">
                            <input type="radio" name="fg_preview_${index}">
                            <span>${this._escapeHtml(typeof opt === 'string' ? opt : (opt.label || opt.value || '选项'))}</span>
                        </label>
                    `).join('')}
                </div>`;
            } else if (type === 'checkbox' || type === 'checkBox') {
                controlHtml = `<div style="display:flex;gap:14px;flex-wrap:wrap;padding:4px 0;">
                    ${(options.length ? options : [item.text || '选项']).map(opt => `
                        <label style="display:flex;align-items:center;gap:6px;color:#334155;">
                            <input type="checkbox">
                            <span>${this._escapeHtml(typeof opt === 'string' ? opt : (opt.label || opt.value || '选项'))}</span>
                        </label>
                    `).join('')}
                </div>`;
            } else {
                controlHtml = `<input type="text" placeholder="${placeholder}" style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:12px;">`;
            }

            if (type === 'checkBox' && item.text) {
                return `
                    <div style="margin-bottom:10px;">
                        <label style="display:flex;align-items:center;gap:8px;color:#334155;">
                            <input type="checkbox">
                            <span>${label}</span>
                        </label>
                        <div style="margin-top:4px;font-size:11px;color:#94a3b8;">类型: ${this._escapeHtml(type)}</div>
                    </div>
                `;
            }

            if (type === 'textarea') {
                controlHtml = `<textarea placeholder="${placeholder}" style="width:100%;min-height:92px;padding:10px 12px;border:1px solid #cbd5e1;border-radius:12px;font-family:inherit;resize:vertical;"></textarea>`;
            }

            return `
                <div style="margin-bottom:14px;${isAutoGenerated ? 'padding:10px 12px;border:1px dashed #99f6e4;border-radius:14px;background:#f0fdfa;' : ''}">
                    <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:700;color:#334155;">${label}${required}${autoBadge}</label>
                    ${controlHtml}
                    <div style="margin-top:4px;font-size:11px;color:#94a3b8;">类型: ${this._escapeHtml(type)}${item.input === false ? ' · 非输入控件' : ''}${isAutoGenerated ? ' · 来源于表格空白单元格推断' : ''}</div>
                </div>
            `;
        }).join('');

        preview.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px;">
                <div style="font-size:12px;color:#64748b;">预览用于快速验证字段类型和填写体验，不影响右侧 JSON 结果。</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <div style="padding:4px 10px;border-radius:999px;background:#eff6ff;color:#2563eb;font-size:12px;">共 ${sorted.length} 个控件</div>
                    ${autoGeneratedCount ? `<div style="padding:4px 10px;border-radius:999px;background:#ecfeff;color:#0f766e;font-size:12px;">自动填写位 ${autoGeneratedCount}</div>` : ''}
                </div>
            </div>
            <div style="padding:18px;border-radius:16px;background:linear-gradient(180deg,#ffffff 0%,#f8fafc 100%);border:1px solid #e2e8f0;">
                ${html || '<div style="color:var(--gray-400);text-align:center;padding:30px;">暂无可预览的控件</div>'}
                <div style="margin-top:18px;display:flex;justify-content:flex-end;">
                    <button type="button" class="btn btn-primary" style="width:auto;pointer-events:none;opacity:0.65;">提交预览</button>
                </div>
            </div>
        `;
    },

    extractSourceText: async function () {
        const fileInput = document.getElementById('fgSourceFile');
        const sourceText = document.getElementById('fgSourceText').value.trim();
        const extracted = document.getElementById('fgExtractedText');

        this._setSmartStatus('正在提取内容...');
        try {
            let data;
            if (fileInput && fileInput.files && fileInput.files[0]) {
                const fd = new FormData();
                fd.append('file', fileInput.files[0]);
                data = await this._callFormApi('/form-generator/extract-text', fd, true);
            } else if (sourceText) {
                data = await this._callFormApi('/form-generator/extract-text', { source_text: sourceText });
            } else {
                showToast('请先上传文件或粘贴表单内容', 'warning');
                this._setSmartStatus('请先提供表单内容', true);
                return;
            }
            if (extracted) extracted.value = data.text || '';
            if (data.reference_match) {
                this._setSmartStatus(`已命中本地参考表单：${data.reference_match.form_name}，可直接继续生成 SmartCare JSON`);
            } else {
                this._setSmartStatus(`提取完成：${data.source || '文本输入'}，共 ${data.length || 0} 字符`);
            }
            this._renderLayoutInsights(data.layout_analysis || []);
            this._renderVisionInsights(data.vision_analysis || null);
            this._renderDebugInfo(null);
            showToast('表单内容提取成功');
        } catch (err) {
            console.error(err);
            this._renderLayoutInsights([]);
            this._renderVisionInsights(null);
            this._renderDebugInfo(null);
            this._setSmartStatus('提取失败: ' + err.message, true);
            showToast('提取失败: ' + err.message, 'error');
        }
    },

    generateFromDocument: async function () {
        const extractedText = document.getElementById('fgExtractedText').value.trim() || document.getElementById('fgSourceText').value.trim();
        const statusEl = document.getElementById('fgStatus');
        const fileInput = document.getElementById('fgSourceFile');
        const sourceName = fileInput && fileInput.files && fileInput.files[0] ? fileInput.files[0].name : '';
        if (!extractedText) {
            showToast('请先提取或粘贴表单内容', 'warning');
            this._setSmartStatus('缺少可生成的表单内容', true);
            return;
        }

        this._setSmartStatus('AI 正在生成表单 JSON...');
        if (statusEl) statusEl.innerText = '智能识别生成中...';

        try {
            const data = await this._callFormApi('/form-generator/generate-from-document', { source_text: extractedText, source_name: sourceName });
            this._applyDocumentResult(data);
            if (statusEl) statusEl.innerText = `智能生成成功：共 ${data.total_count || 0} 个元素`;
            if (data.reference_match) {
                this._setSmartStatus(`已命中本地参考 JSON：${data.reference_match.form_name}，直接返回对齐后的 SmartCare 表单`);
            } else {
                this._setSmartStatus(`已生成 ${data.total_count || 0} 个字段/控件，并转换为 SmartCare 风格表单`);
            }
            showToast('智能表单 JSON 生成成功');
        } catch (err) {
            console.error(err);
            if (statusEl) statusEl.innerText = '智能生成失败';
            this._renderLayoutInsights([]);
            this._renderVisionInsights(null);
            this._renderFieldInsights([], null);
            this._renderDebugInfo(null);
            this._setSmartStatus('生成失败: ' + err.message, true);
            showToast('智能生成失败: ' + err.message, 'error');
        }
    },

    onModeChange: function () {
        const mode = document.getElementById('fgMode').value;
        const singleParams = document.getElementById('fgSingleAxisParams');
        const gridParams = document.getElementById('fgGridParams');

        if (mode === 'xy') {
            singleParams.style.display = 'none';
            gridParams.style.display = 'block';
        } else {
            singleParams.style.display = 'block';
            gridParams.style.display = 'none';
        }
    },

    generate: function () {
        const templateText = document.getElementById('fgTemplate').value.trim();
        if (!templateText) {
            showToast('请输入模板 JSON', 'error');
            return;
        }

        const mode = document.getElementById('fgMode').value;
        const prefix = document.getElementById('fgPrefix').value;
        const statusEl = document.getElementById('fgStatus');

        const payload = {
            template_text: templateText,
            mode: mode,
            start_prefix: prefix
        };

        if (mode === 'xy') {
            payload.rows = parseInt(document.getElementById('fgRows').value);
            payload.cols = parseInt(document.getElementById('fgCols').value);
            payload.y_spacing = parseFloat(document.getElementById('fgYSpacing').value);
            payload.x_spacing = parseFloat(document.getElementById('fgXSpacing').value);
        } else {
            payload.count = parseInt(document.getElementById('fgCount').value);
            const spacing = parseFloat(document.getElementById('fgSpacing').value);
            if (mode === 'y') payload.y_spacing = spacing;
            else payload.x_spacing = spacing;
        }

        statusEl.innerText = '正在生成...';

        this._callFormApi('/form-generator/generate', payload)
            .then(data => {
                let resultText = data.formatted_text;
                if (!resultText) {
                    resultText = JSON.stringify(data.data, null, 2);
                    if (data.is_array === false) {
                        resultText = resultText.replace(/^\[\s*/, '').replace(/\s*\]$/, '');
                    }
                }
                document.getElementById('fgResult').value = resultText;
                this.renderPreview();
                statusEl.innerText = `生成成功：共 ${data.total_count} 个元素`;
                showToast('生成成功');
            })
            .catch(err => {
                console.error(err);
                statusEl.innerText = '网络错误';
                showToast(err.message || '网络错误', 'error');
            });
    },

    copy: function () {
        const result = document.getElementById('fgResult');
        if (!result.value) return;

        result.select();
        document.execCommand('copy');
        showToast('结果已复制到剪贴板');
    },

    clear: function () {
        if (confirm('确定要清空所有输入吗？')) {
            document.getElementById('fgTemplate').value = '';
            document.getElementById('fgResult').value = '';
            document.getElementById('fgStatus').innerText = '';
            document.getElementById('fgSourceText').value = '';
            document.getElementById('fgExtractedText').value = '';
            const file = document.getElementById('fgSourceFile');
            if (file) file.value = '';
            this._renderLayoutInsights([]);
            this._renderVisionInsights(null);
            this._renderFieldInsights([], null);
            this._renderDebugInfo(null);
            this._setSmartStatus('');
            this._lastDocumentData = null;
            const editor = document.getElementById('fgFieldEditor');
            if (editor) editor.innerHTML = '<div style="color:var(--gray-400);text-align:center;padding:36px 12px;">生成 SmartCare JSON 后，这里会出现可编辑的字段列表。</div>';
            const tableEditor = document.getElementById('fgTableEditor');
            if (tableEditor) tableEditor.innerHTML = '<div style="color:var(--gray-400);text-align:center;padding:36px 12px;">当结果包含 table 组件时，这里会展示可编辑的单元格网格。</div>';
            const preview = document.getElementById('fgPreview');
            if (preview) preview.innerHTML = '<div style="color:var(--gray-400);text-align:center;padding:40px 12px;">生成 JSON 后，这里会渲染一个可试填的表单预览。</div>';
        }
    },

    exportCurrentResult: function () {
        const raw = document.getElementById('fgResult')?.value || '';
        if (!raw.trim()) {
            showToast('当前没有可导出的结果', 'warning');
            return;
        }
        const fileInput = document.getElementById('fgSourceFile');
        const baseName = fileInput && fileInput.files && fileInput.files[0]
            ? fileInput.files[0].name.replace(/\.[^.]+$/, '')
            : 'form_generator_result';
        const blob = new Blob([raw], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${baseName}_generated.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('当前结果已导出', 'success');
    },

    compareWithReference: async function () {
        const panel = document.getElementById('fgComparePanel');
        const raw = document.getElementById('fgResult')?.value || '';
        if (!raw.trim()) {
            showToast('当前没有可对照的结果', 'warning');
            return;
        }
        if (panel) {
            panel.style.display = 'block';
            panel.innerHTML = '<div style="color:#64748b;text-align:center;padding:20px;">正在与入院.json 对照...</div>';
        }
        try {
            const data = await this._callFormApi('/form-generator/compare-reference', {
                current_json: raw
            });
            if (!panel) return;
            panel.style.display = 'block';
            const summary = data.summary || {};
            panel.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
                    <div>
                        <div style="font-size:16px;font-weight:800;color:#0f172a;">与参考表单差异对照</div>
                        <div style="font-size:12px;color:#64748b;margin-top:4px;">参考来源：${this._escapeHtml(data.reference_form_name || data.reference_path || '')}</div>
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <span style="padding:4px 10px;border-radius:999px;background:#eff6ff;color:#2563eb;font-size:12px;">参考 ${summary.reference_total || 0}</span>
                        <span style="padding:4px 10px;border-radius:999px;background:#ecfdf5;color:#16a34a;font-size:12px;">当前 ${summary.current_total || 0}</span>
                        <span style="padding:4px 10px;border-radius:999px;background:#fef2f2;color:#dc2626;font-size:12px;">缺失 ${summary.missing_count || 0}</span>
                        <span style="padding:4px 10px;border-radius:999px;background:#fff7ed;color:#c2410c;font-size:12px;">不一致 ${summary.mismatch_count || 0}</span>
                    </div>
                </div>
                <div style="display:grid;gap:12px;">
                    <div style="padding:12px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;">
                        <div style="font-size:13px;font-weight:700;color:#334155;margin-bottom:8px;">缺失字段</div>
                        <div style="font-size:12px;color:#64748b;line-height:1.8;">${(data.missing || []).slice(0, 15).map(item => this._escapeHtml(item.label || '')).join('、') || '无'}</div>
                    </div>
                    <div style="padding:12px;border-radius:12px;background:#fffaf5;border:1px solid #fed7aa;">
                        <div style="font-size:13px;font-weight:700;color:#9a3412;margin-bottom:8px;">类型 / 绑定不一致</div>
                        <div style="display:grid;gap:6px;font-size:12px;color:#7c2d12;">
                            ${(data.mismatch || []).slice(0, 12).map(item => `
                                <div>${this._escapeHtml(item.label)}：参考 ${this._escapeHtml(item.reference_type || '-')}/${this._escapeHtml(item.reference_binding || '-')} → 当前 ${this._escapeHtml(item.current_type || '-')}/${this._escapeHtml(item.current_binding || '-')}</div>
                            `).join('') || '<div>无</div>'}
                        </div>
                    </div>
                    <div style="padding:12px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;">
                        <div style="font-size:13px;font-weight:700;color:#334155;margin-bottom:8px;">额外字段</div>
                        <div style="font-size:12px;color:#64748b;line-height:1.8;">${(data.extra || []).slice(0, 15).map(item => this._escapeHtml(item.label || '')).join('、') || '无'}</div>
                    </div>
                </div>
            `;
            showToast('参考表单对照完成', 'success');
        } catch (err) {
            console.error(err);
            if (panel) {
                panel.style.display = 'block';
                panel.innerHTML = `<div style="color:#dc2626;text-align:center;padding:20px;">对照失败: ${this._escapeHtml(err.message || '')}</div>`;
            }
            showToast('对照失败: ' + err.message, 'error');
        }
    },

    applyReferenceFixes: async function () {
        const raw = document.getElementById('fgResult')?.value || '';
        if (!raw.trim()) {
            showToast('当前没有可修正的结果', 'warning');
            return;
        }
        const panel = document.getElementById('fgComparePanel');
        try {
            const data = await this._callFormApi('/form-generator/apply-reference-fixes', {
                current_json: raw
            });
            this._lastDocumentData = {
                ...(this._lastDocumentData || {}),
                smartcare_form: data.smartcare_form,
                smartcare_formatted_text: data.smartcare_formatted_text,
                total_count: (data.compare_result?.summary?.current_total || 0),
                reference_match: {
                    form_name: data.reference_form_name,
                    filename: data.reference_path
                }
            };
            document.getElementById('fgResult').value = this._buildDocumentResultText(this._lastDocumentData);
            this._renderDebugInfo(this._lastDocumentData);
            this.renderPreview();
            this.refreshFieldEditor();
            this.refreshTableEditor();
            if (panel) {
                panel.style.display = 'block';
                const summary = data.compare_result?.summary || {};
                panel.innerHTML = `
                    <div style="padding:12px;border-radius:12px;background:#ecfdf5;border:1px solid #bbf7d0;color:#166534;">
                        已按参考表单修正。新增字段/组件 ${data.appended_count || 0} 个，当前剩余缺失 ${summary.missing_count || 0}，不一致 ${summary.mismatch_count || 0}。
                    </div>
                `;
            }
            showToast(`已按参考表单修正，新增 ${data.appended_count || 0} 项`, 'success');
        } catch (err) {
            console.error(err);
            showToast('一键修正失败: ' + err.message, 'error');
        }
    }
};
