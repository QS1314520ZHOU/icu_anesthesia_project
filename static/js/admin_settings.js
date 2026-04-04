var adminSettings = {
    modalId: 'adminSettingsModal',

    init: function () {
        this.injectStyles();
        this.renderModal();
        // Bind global function for easy access
        window.openAdminSettings = () => this.open();
    },

    injectStyles: function () {
        if (document.getElementById('admin-settings-style')) return;
        const style = document.createElement('style');
        style.id = 'admin-settings-style';
        style.innerHTML = `
            /* Admin Config Card Styles */
            .admin-config-card {
                background: #fff;
                border: 1px solid #e5e7eb;
                border-radius: 12px;
                padding: 16px;
                margin-bottom: 16px;
                transition: all 0.2s ease;
                position: relative;
            }
            .admin-config-card:hover {
                box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
                border-color: #d1d5db;
                transform: translateY(-1px);
            }
            .config-header {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                margin-bottom: 12px;
            }
            .config-title-group {
                display: flex;
                align-items: center;
                gap: 10px;
                flex-wrap: wrap;
            }
            .config-name {
                font-size: 16px;
                font-weight: 700;
                color: #111827;
            }
            .config-details {
                background: #f9fafb;
                border-radius: 8px;
                padding: 12px;
                font-size: 13px;
            }
            .config-row {
                display: flex;
                margin-bottom: 6px;
                line-height: 1.5;
            }
            .config-row:last-child {
                margin-bottom: 0;
            }
            .config-label {
                color: #6b7280;
                width: 70px;
                flex-shrink: 0;
                font-weight: 500;
            }
            .config-value {
                color: #374151;
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                word-break: break-all;
                overflow: hidden;
                text-overflow: ellipsis;
                display: -webkit-box;
                -webkit-line-clamp: 2; /* Limit to 2 lines */
                -webkit-box-orient: vertical;
            }
            .config-actions {
                display: flex;
                gap: 8px;
                margin-top: 12px;
                justify-content: flex-end;
            }
            .btn-icon {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 6px 12px;
                font-size: 12px;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.15s;
                border: 1px solid transparent;
            }
            .btn-icon:hover {
                filter: brightness(0.95);
            }
            /* Modal Stacking Fix */
            #aiConfigModal {
                z-index: 20000 !important;
                background-color: rgba(0, 0, 0, 0.5) !important; /* Dim backdrop */
            }
            /* Tabs */
            .admin-tab {
                position: relative;
                transition: color 0.2s;
            }
            .admin-tab:hover {
                color: var(--primary) !important;
            }
            .admin-tab.active {
                color: var(--primary) !important;
            }
            .admin-tab.active::after {
                content: '';
                position: absolute;
                bottom: -1px;
                left: 0;
                right: 0;
                height: 2px;
                background: var(--primary);
            }
            /* Scrollbar for modal body */
            .modal-body::-webkit-scrollbar {
                width: 6px;
            }
            .modal-body::-webkit-scrollbar-track {
                background: #f1f1f1;
            }
            .modal-body::-webkit-scrollbar-thumb {
                background: #ccc;
                border-radius: 3px;
            }
        `;
        document.head.appendChild(style);
    },

    renderModal: function () {
        if (document.getElementById(this.modalId)) return;

        const html = `
        <div class="modal" id="${this.modalId}" style="z-index: 10005;">
            <div class="modal-content" style="max-width: 800px; height: 85vh; display: flex; flex-direction: column; border-radius: 16px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);">
                <div class="modal-header" style="border-bottom: 1px solid var(--gray-200); padding: 16px 24px;">
                    <h3 style="font-size: 18px; font-weight: 700;">🛠️ 系统配置 (v2.2)</h3>
                    <button class="modal-close" style="font-size: 24px;" onclick="document.getElementById('${this.modalId}').classList.remove('show'); document.getElementById('${this.modalId}').style.display='none'">&times;</button>
                </div>
                <div class="modal-body" style="flex: 1; overflow: hidden; display: flex; flex-direction: column; padding: 0; background: #f9fafb;">
                    <div class="admin-tabs" style="padding: 0 24px; background: white; border-bottom: 1px solid var(--gray-200); display: flex; gap: 24px;">
                        <div class="admin-tab active" onclick="adminSettings.switchTab(event, 'tabAiConfig')" style="padding: 16px 4px; cursor: pointer; font-weight: 600; color: var(--gray-500);">AI 模型配置</div>
                        <div class="admin-tab" onclick="adminSettings.switchTab(event, 'tabWecomConfig')" style="padding: 16px 4px; cursor: pointer; font-weight: 600; color: var(--gray-500);">企业微信配置</div>
                        <div class="admin-tab" onclick="adminSettings.switchTab(event, 'tabWecomBind')" style="padding: 16px 4px; cursor: pointer; font-weight: 600; color: var(--gray-500);">用户企微绑定</div>
                        <div class="admin-tab" onclick="adminSettings.switchTab(event, 'tabPermissions')" style="padding: 16px 4px; cursor: pointer; font-weight: 600; color: var(--gray-500);">用户与权限</div>
                        <div class="admin-tab" onclick="adminSettings.switchTab(event, 'tabMapConfig')" style="padding: 16px 4px; cursor: pointer; font-weight: 600; color: var(--gray-500);">地图服务配置</div>
                        <div class="admin-tab" onclick="adminSettings.switchTab(event, 'tabStorageConfig')" style="padding: 16px 4px; cursor: pointer; font-weight: 600; color: var(--gray-500);">云存储配置</div>
                    </div>
                    
                    <div class="admin-tab-content" style="flex: 1; overflow-y: auto; padding: 24px;">
                        <!-- AI Config Tab -->
                        <div id="tabAiConfig" class="admin-tab-pane active" style="display: block;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                                <div>
                                    <div style="font-size: 15px; font-weight: 600; color: var(--gray-800);">AI 服务接口</div>
                                    <div style="font-size: 13px; color: var(--gray-500); margin-top: 4px;">配置用于周报生成、风险分析的 AI 模型接口</div>
                                </div>
                                <button class="btn btn-primary btn-sm" style="box-shadow: 0 4px 6px -1px rgba(79, 70, 229, 0.2);" onclick="adminSettings.showAddConfigModal()">+ 新增配置</button>
                            </div>
                            <div id="aiConfigList" class="config-list">
                                <div class="text-center" style="padding: 40px; color: var(--gray-500);">
                                    <div style="font-size: 24px; margin-bottom: 10px;">⏳</div>
                                    加载配置中...
                                </div>
                            </div>
                        </div>

                        <!-- WeCom Config Tab -->
                        <div id="tabWecomConfig" class="admin-tab-pane" style="display: none;">
                            <div class="config-section">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                                    <div>
                                        <div style="font-size: 15px; font-weight: 600; color: var(--gray-800);">企业微信自建应用</div>
                                        <div style="font-size: 13px; color: var(--gray-500); margin-top: 4px;">配置消息推送、OAuth2 登录及消息回调参数</div>
                                    </div>
                                    <div style="display: flex; align-items: center; gap: 8px;">
                                        <label class="switch-label" style="font-size: 13px; font-weight: 600; color: var(--gray-700);">启用状态</label>
                                        <input type="checkbox" id="wecomEnabled" style="width: 18px; height: 18px;">
                                    </div>
                                </div>

                                <div class="grid-form" style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; background: white; padding: 24px; border-radius: 12px; border: 1px solid var(--gray-200);">
                                    <div class="form-group">
                                        <label>企业 ID (CorpID)</label>
                                        <input type="text" id="wecomCorpId" class="form-control" placeholder="ww..." style="font-family: monospace;">
                                    </div>
                                    <div class="form-group">
                                        <label>应用 ID (AgentID)</label>
                                        <input type="number" id="wecomAgentId" class="form-control" placeholder="1000002">
                                    </div>
                                    <div class="form-group" style="grid-column: span 2;">
                                        <label>应用 Secret</label>
                                        <input type="password" id="wecomSecret" class="form-control" placeholder="填写应用密钥">
                                    </div>
                                    
                                    <div style="grid-column: span 2; margin: 10px 0; padding-top: 10px; border-top: 1px dashed var(--gray-200);">
                                        <h5 style="font-weight: 700; margin-bottom: 12px; font-size: 14px;">回调/验证参数 (用于消息接收)</h5>
                                    </div>
                                    
                                    <div class="form-group">
                                        <label>Token</label>
                                        <input type="text" id="wecomCallbackToken" class="form-control" placeholder="自定义 Token">
                                    </div>
                                    <div class="form-group">
                                        <label>EncodingAESKey</label>
                                        <input type="password" id="wecomCallbackAesKey" class="form-control" placeholder="43位字符">
                                    </div>
                                    
                                    <div class="form-group" style="grid-column: span 2;">
                                        <label>应用首页 URL</label>
                                        <input type="text" id="wecomAppHomeUrl" class="form-control" placeholder="https://your-domain.com">
                                        <div style="font-size: 12px; color: var(--gray-400); margin-top: 4px;">用于 OAuth2 登录回调后的重定向起点</div>
                                    </div>

                                    <div class="form-group" style="grid-column: span 2;">
                                        <label>Wecom Webhook (兜底)</label>
                                        <input type="text" id="wecomWebhook" class="form-control" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...">
                                        <div style="font-size: 12px; color: var(--gray-400); margin-top: 4px;">选填。当自建应用推送失败或未启用时，将尝试通过此 Webhook 推送文本消息。</div>
                                    </div>
                                    
                                    <div style="grid-column: span 2; margin-top: 10px;">
                                        <button class="btn btn-primary" style="width: 100%; height: 45px;" onclick="adminSettings.saveWecomConfig()">保存并应用配置</button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- WeCom Bind Tab -->
                        <div id="tabWecomBind" class="admin-tab-pane" style="display: none;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                                <div>
                                    <div style="font-size: 15px; font-weight: 600; color: var(--gray-800);">用户企微 UserID 绑定</div>
                                    <div style="font-size: 13px; color: var(--gray-500); margin-top: 4px;">绑定后可实现项目预警定向推送到个人企业微信</div>
                                </div>
                                <button class="btn btn-outline btn-sm" onclick="adminSettings.loadWecomBindList()">🔄 刷新</button>
                            </div>
                            <div id="wecomBindList">
                                <div class="text-center" style="padding: 40px; color: var(--gray-500);">⏳ 加载中...</div>
                            </div>
                        </div>

                        <!-- Permission Tab -->
                        <div id="tabPermissions" class="admin-tab-pane" style="display: none;">
                            <div style="display:grid;gap:20px;">
                                <div style="background:white;border:1px solid var(--gray-200);border-radius:12px;padding:20px;">
                                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px;">
                                        <div>
                                            <div style="font-size:15px;font-weight:600;color:var(--gray-800);">权限目录</div>
                                            <div style="font-size:13px;color:var(--gray-500);margin-top:4px;">先理解权限再修改角色，能明显降低误配置概率。下方会按能力域解释当前常用权限。</div>
                                        </div>
                                    </div>
                                    <div id="permissionCatalogSummary"></div>
                                </div>

                                <div style="background:white;border:1px solid var(--gray-200);border-radius:12px;padding:20px;">
                                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px;">
                                        <div>
                                            <div style="font-size:15px;font-weight:600;color:var(--gray-800);">角色权限矩阵</div>
                                            <div style="font-size:13px;color:var(--gray-500);margin-top:4px;">这里展示并维护当前后端实际生效的角色与权限映射。为降低风险，admin 保持只读，其余角色可直接编辑显示名和权限列表。</div>
                                        </div>
                                        <div style="display:flex;gap:8px;flex-wrap:wrap;">
                                            <button class="btn btn-primary btn-sm" onclick="adminSettings.saveRolePermissionMatrix()">💾 保存矩阵</button>
                                            <button class="btn btn-outline btn-sm" onclick="adminSettings.loadRolePermissionMatrix()">🔄 重新加载</button>
                                        </div>
                                    </div>
                                    <div id="rolePermissionMatrix">
                                        <div class="text-center" style="padding: 32px; color: var(--gray-500);">⏳ 加载中...</div>
                                    </div>
                                </div>

                                <div style="background:white;border:1px solid var(--gray-200);border-radius:12px;padding:20px;">
                                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px;">
                                        <div>
                                            <div style="font-size:15px;font-weight:600;color:var(--gray-800);">用户角色管理</div>
                                            <div style="font-size:13px;color:var(--gray-500);margin-top:4px;">可直接调整角色、启用/禁用账号或重置密码。当前登录账号不能被自己禁用。</div>
                                        </div>
                                        <div style="display:flex;gap:8px;flex-wrap:wrap;">
                                            <button class="btn btn-outline btn-sm" onclick="adminSettings.loadUserPermissionList()">🔄 刷新用户</button>
                                            <button class="btn btn-outline btn-sm" onclick="showRoleMatrixModal()">🛡️ 弹窗查看矩阵</button>
                                        </div>
                                    </div>
                                    <div class="table-container" style="max-height:420px;overflow:auto;">
                                        <table class="table" style="width:100%;">
                                            <thead>
                                                <tr>
                                                    <th>ID</th>
                                                    <th>用户名</th>
                                                    <th>显示名</th>
                                                    <th>角色</th>
                                                    <th>状态</th>
                                                    <th>最后登录</th>
                                                    <th>操作</th>
                                                </tr>
                                            </thead>
                                            <tbody id="permissionUserList">
                                                <tr><td colspan="7" style="text-align:center;color:var(--gray-500);">加载中...</td></tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                <div style="background:white;border:1px solid var(--gray-200);border-radius:12px;padding:20px;">
                                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px;">
                                        <div>
                                            <div style="font-size:15px;font-weight:600;color:var(--gray-800);">最近权限变更</div>
                                            <div style="font-size:13px;color:var(--gray-500);margin-top:4px;">这里会显示最近的角色矩阵保存、用户角色切换、账号启停和密码重置操作。</div>
                                        </div>
                                        <button class="btn btn-outline btn-sm" onclick="adminSettings.loadPermissionAuditLogs()">🔄 刷新记录</button>
                                    </div>
                                    <div id="permissionAuditList">
                                        <div class="text-center" style="padding: 32px; color: var(--gray-500);">⏳ 加载中...</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Map Config Tab -->
                        <div id="tabMapConfig" class="admin-tab-pane" style="display: none;">
                            <div class="config-section">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                                    <div>
                                        <div style="font-size: 15px; font-weight: 600; color: var(--gray-800);">地图服务 API 配置</div>
                                        <div style="font-size: 13px; color: var(--gray-500); margin-top: 4px;">配置用于地理编码和坐标解析的地图服务商 (系统将优先使用 API 获取精确位置)</div>
                                    </div>
                                </div>

                                <div class="grid-form" style="display: grid; grid-template-columns: 1fr; gap: 20px; background: white; padding: 24px; border-radius: 12px; border: 1px solid var(--gray-200);">
                                    <div class="form-group">
                                        <label>首选地图服务商</label>
                                        <select id="mapProvider" class="form-control" style="width: 100%;">
                                            <option value="baidu">百度地图 (国内推荐，功能全)</option>
                                            <option value="amap">高德地图 (国内备用，有免费额度)</option>
                                            <option value="tianditu">天地图 (推荐，国家地理信息平台，完全免费商用)</option>
                                            <option value="osm">OpenStreetMap (国际开源，无需 Key)</option>
                                            <option value="google">Google Maps (国际，需 API Key)</option>
                                        </select>
                                    </div>
                                    
                                    <div style="margin: 10px 0; padding-top: 10px; border-top: 1px dashed var(--gray-200);">
                                        <h5 style="font-weight: 700; margin-bottom: 12px; font-size: 14px;">各平台 API Key 配置 (选填)</h5>
                                    </div>
                                    
                                    <div class="form-group">
                                        <label>百度地图 AK (Baidu Maps AK)</label>
                                        <input type="password" id="mapBaiduAk" class="form-control" placeholder="填写百度地图开放平台获取的 AK">
                                    </div>
                                    
                                    <div class="form-group">
                                        <label>高德地图 Key (Amap Web服务 Key)</label>
                                        <input type="password" id="mapAmapKey" class="form-control" placeholder="填写高德开放平台获取的 Web 服务 Key">
                                    </div>

                                    <div class="form-group">
                                        <label>天地图 Token (Tianditu Browser/Server Token)</label>
                                        <input type="password" id="mapTiandituKey" class="form-control" placeholder="填写天地图控制台获取的 Token">
                                        <div style="font-size: 11px; color: var(--gray-400); margin-top: 4px;">注：天地图是国产权威地图，无收费限制，建议开发者首选。</div>
                                    </div>
                                    
                                    <div class="form-group">
                                        <label>Google Maps API Key</label>
                                        <input type="password" id="mapGoogleAk" class="form-control" placeholder="AIzaSy...">
                                    </div>
                                    
                                    <div style="grid-column: span 1; margin-top: 10px;">
                                        <button class="btn btn-primary" style="width: 100%; height: 45px;" onclick="adminSettings.saveMapConfig()">保存地图配置</button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Storage Config Tab -->
                        <div id="tabStorageConfig" class="admin-tab-pane" style="display: none;">
                            <div class="config-section">
                                <div style="margin-bottom: 24px;">
                                    <label style="font-weight: 600; color: var(--gray-700); margin-bottom: 8px; display: block;">选择存储后端</label>
                                    <select id="storageType" class="form-control" onchange="adminSettings.toggleStorageForm()" style="width: 100%; max-width: 300px;">
                                        <option value="baidu">百度网盘 (Baidu Netdisk)</option>
                                        <option value="r2">Cloudflare R2 (S3 Compatible)</option>
                                    </select>
                                </div>

                                <!-- Baidu Form -->
                                <div id="baiduConfigForm">
                                    <h4 style="margin-bottom: 16px; font-weight: 700;">百度网盘授权</h4>
                                    <div class="alert alert-info" style="margin-bottom: 24px; border-radius: 8px;">
                                        用于备份项目文档和数据库。授权有效期通常为 30 天，过期需重新授权。
                                    </div>
                                    
                                    <div id="storageStatus" style="margin-bottom: 24px;">
                                        <div style="display: flex; align-items: center; gap: 12px;">
                                            <span style="font-weight: 500;">当前状态:</span>
                                            <span id="baiduAuthStatus" class="badge badge-gray">检测中...</span>
                                        </div>
                                    </div>

                                    <div class="step-card" style="background: white; padding: 24px; border-radius: 12px; border: 1px solid var(--gray-200); box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                                        <h5 style="margin-bottom: 16px; font-weight: 600;">重新授权步骤：</h5>
                                        <ol style="margin-left: 20px; line-height: 2; font-size: 14px; color: var(--gray-700);">
                                            <li>点击 <a href="javascript:void(0)" onclick="adminSettings.openBaiduAuth()" style="color: var(--primary); font-weight: 600; text-decoration: none; border-bottom: 1px dashed var(--primary);">获取授权码</a> (将打开百度授权页面)</li>
                                            <li>在百度页面登录并确认授权，<b>复制</b> 页面显示的 "授权码"</li>
                                            <li>将授权码粘贴到下方输入框，并点击验证</li>
                                        </ol>
                                        
                                        <div style="margin-top: 24px; display: flex; gap: 12px;">
                                            <input type="text" id="baiduAuthCode" placeholder="在此粘贴授权码" class="form-control" style="flex: 1; height: 42px;">
                                            <button class="btn btn-primary" style="height: 42px; padding: 0 24px;" onclick="adminSettings.submitAuthCode()">验证并保存</button>
                                        </div>
                                        
                                        <!-- Manual Token Fallback -->
                                        <div style="margin-top: 20px; border-top: 1px dashed var(--gray-200); padding-top: 16px;">
                                            <a href="javascript:void(0)" onclick="document.getElementById('manualTokenSection').style.display = document.getElementById('manualTokenSection').style.display === 'none' ? 'block' : 'none'" style="font-size: 13px; color: var(--gray-500); text-decoration: underline;">
                                                ⚠️ 服务器网络不通? 点击此处手动输入 Token JSON
                                            </a>
                                            <div id="manualTokenSection" style="display: none; margin-top: 12px;">
                                                <div class="alert alert-warning" style="font-size: 12px; margin-bottom: 8px;">
                                                    请在本地运行同样的脚本或使用 Postman 获取百度网盘的完整 Token JSON 响应，然后粘贴到下方。
                                                </div>
                                                <textarea id="baiduTokenJson" class="form-control" placeholder='{"access_token": "...", "refresh_token": "...", ...}' style="width: 100%; height: 100px; font-family: monospace; font-size: 12px;"></textarea>
                                                <button class="btn btn-outline" style="margin-top: 8px; width: 100%;" onclick="adminSettings.submitTokenJson()">📥 保存 Token JSON</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <!-- R2 Form -->
                                <div id="r2ConfigForm" style="display: none;">
                                    <h4 style="margin-bottom: 16px; font-weight: 700;">Cloudflare R2 配置</h4>
                                    <div class="alert alert-info" style="margin-bottom: 24px; border-radius: 8px;">
                                        使用 S3 兼容协议连接 Cloudflare R2 对象存储。
                                    </div>
                                    
                                    <div style="background: white; padding: 24px; border-radius: 12px; border: 1px solid var(--gray-200);">
                                        <div class="form-group">
                                            <label>Endpoint URL (S3 API)</label>
                                            <input type="text" id="r2Endpoint" class="form-control" placeholder="https://<accountid>.r2.cloudflarestorage.com">
                                        </div>
                                        <div class="form-group">
                                            <label>Bucket Name</label>
                                            <input type="text" id="r2Bucket" class="form-control" placeholder="my-project-files">
                                        </div>
                                        <div class="form-group">
                                            <label>Access Key ID</label>
                                            <input type="text" id="r2AccessKey" class="form-control" placeholder="">
                                        </div>
                                        <div class="form-group">
                                            <label>Secret Access Key</label>
                                            <input type="password" id="r2SecretKey" class="form-control" placeholder="">
                                        </div>
                                        <div class="form-group">
                                            <label>Public Domain (Optional)</label>
                                            <input type="text" id="r2Domain" class="form-control" placeholder="https://pub-xxxx.r2.dev">
                                            <div style="font-size:12px;color:gray;margin-top:4px;">如果配置了自定义域名或公共访问域名，可填入以生成公开链接。</div>
                                        </div>
                                        
                                        <div style="margin-top: 24px; display: flex; gap: 12px;">
                                            <button class="btn btn-primary" onclick="adminSettings.saveR2Config()">保存并启用 R2</button>
                                            <button class="btn btn-outline" onclick="adminSettings.testR2Config(this)">测试连接</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Add/Edit AI Config Modal -->
        <div class="modal" id="aiConfigModal">
            <div class="modal-content" style="max-width: 500px; border-radius: 16px;">
                <div class="modal-header" style="border-bottom: 1px solid var(--gray-100);">
                    <h3 id="aiConfigModalTitle" style="font-weight: 700;">新增 AI 配置</h3>
                    <button class="modal-close" onclick="adminSettings.closeAddConfigModal()">&times;</button>
                </div>
                <div class="modal-body" style="padding: 24px;">
                    <input type="hidden" id="editConfigId">
                    <div class="form-group">
                        <label style="font-weight: 600; color: var(--gray-700);">配置名称 <span style="color:red">*</span></label>
                        <input type="text" id="aiName" class="form-control" placeholder="例如: DeepSeek-V3" style="border-radius: 8px;">
                    </div>
                    <div class="form-group">
                        <label style="font-weight: 600; color: var(--gray-700);">API Base URL <span style="color:red">*</span></label>
                        <input type="text" id="aiBaseUrl" class="form-control" placeholder="https://api.example.com/v1" style="border-radius: 8px; font-family: monospace;">
                    </div>
                    <div class="form-group">
                        <label style="font-weight: 600; color: var(--gray-700);">API Key <span style="color:red">*</span></label>
                        <input type="password" id="aiApiKey" class="form-control" placeholder="sk-..." style="border-radius: 8px; font-family: monospace;">
                        <div style="font-size: 12px; color: var(--gray-400); margin-top: 6px;">编辑时留空表示不修改</div>
                    </div>
                    <div class="form-group">
                        <label style="font-weight: 600; color: var(--gray-700);">模型列表 <span style="color:red">*</span></label>
                        <input type="text" id="aiModels" class="form-control" placeholder='["deepseek-chat", "gpt-4"]' style="border-radius: 8px; font-family: monospace;">
                        <div style="font-size: 12px; color: var(--gray-400); margin-top: 6px;">支持 JSON 数组或逗号分隔字符串</div>
                    </div>
                    <div class="form-group">
                        <label style="font-weight: 600; color: var(--gray-700);">优先级</label>
                        <input type="number" id="aiPriority" class="form-control" value="10" style="border-radius: 8px;">
                        <div style="font-size: 12px; color: var(--gray-400); margin-top: 6px;">数字越小优先级越高 (默认 10)</div>
                    </div>
                    <div class="form-group" style="display: flex; align-items: center; gap: 8px; margin-top: 10px;">
                        <input type="checkbox" id="aiIsActive" checked style="width: 16px; height: 16px;">
                        <label for="aiIsActive" style="margin: 0; cursor: pointer; font-weight: 500;">立即启用此配置</label>
                    </div>
                </div>
                <div class="modal-footer" style="padding: 16px 24px; border-top: 1px solid var(--gray-100);">
                    <button class="btn btn-outline" onclick="adminSettings.closeAddConfigModal()" style="border-radius: 8px;">取消</button>
                    <button class="btn btn-primary" onclick="adminSettings.saveConfig()" style="border-radius: 8px;">保存配置</button>
                </div>
            </div>
        </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);
    },

    open: function () {
        this.renderModal();
        const el = document.getElementById(this.modalId);
        el.classList.add('show');
        el.style.display = 'flex';
        this.renderPermissionCatalog();
        this.loadAiConfigs();
        this.loadWecomConfig();
        this.loadStorageConfig();
        this.loadWecomBindList();
        this.loadRolePermissionMatrix();
        this.loadUserPermissionList();
        this.loadPermissionAuditLogs();
        this.loadMapConfig();
    },

    switchTab: function (event, tabId) {
        const modal = document.getElementById(this.modalId);
        modal.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
        modal.querySelectorAll('.admin-tab-pane').forEach(p => p.style.display = 'none');

        event.currentTarget.classList.add('active');
        document.getElementById(tabId).style.display = 'block';

        if (tabId === 'tabPermissions') {
            this.renderPermissionCatalog();
            this.loadRolePermissionMatrix();
            this.loadUserPermissionList();
            this.loadPermissionAuditLogs();
        }
    },

    // ========== AI Configuration Logic ==========

    loadAiConfigs: async function () {
        const container = document.getElementById('aiConfigList');
        // If coming from renderModal first call, container might be null if modal not yet in DOM (unlikely due to sync render)
        // Check if modal was rendered
        if (!container) return;

        container.innerHTML = '<div class="text-center" style="padding: 40px; color: var(--gray-500);"><div style="font-size: 24px; margin-bottom: 10px;">⏳</div>加载配置中...</div>';
        try {
            const res = await api.get('/admin/ai-configs');
            // api.js unwraps response if success=true, returning data.data directly
            if (Array.isArray(res)) {
                this.currentConfigs = res;
                this.renderAiConfigs(res);
            } else if (res && res.success && res.data) {
                // Fallback for wrapped response
                this.currentConfigs = res.data;
                this.renderAiConfigs(res.data);
            } else {
                console.error('AI Config Load Error:', res);
                container.innerHTML = '<div class="error-msg">加载失败 (格式错误)</div>';
            }
        } catch (e) {
            container.innerHTML = `<div class="error-msg">加载失败: ${e.message}</div>`;
        }
    },

    renderAiConfigs: function (configs) {
        const container = document.getElementById('aiConfigList');
        if (!container) return;

        if (configs.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="padding: 40px; text-align: center; color: var(--gray-400);">
                    <div style="font-size: 48px; margin-bottom: 20px; opacity: 0.5;">📭</div>
                    <p style="font-size: 16px;">暂无 AI 模型配置</p>
                    <button class="btn btn-primary btn-sm" style="margin-top: 16px;" onclick="adminSettings.showAddConfigModal()">立即添加</button>
                </div>
            `;
            return;
        }

        container.innerHTML = configs.map(c => `
            <div class="admin-config-card">
                <div class="config-header">
                    <div class="config-title-group">
                        <span class="config-name">${c.name}</span>
                        ${c.is_active
                ? '<span class="badge badge-success" style="font-size: 10px;">已启用</span>'
                : '<span class="badge badge-gray" style="font-size: 10px;">已禁用</span>'}
                        <span class="badge badge-info" style="font-size: 10px; background: #e0f2fe; color: #0369a1;">优先级 ${c.priority}</span>
                    </div>
                </div>
                
                <div class="config-details">
                    <div class="config-row">
                        <span class="config-label">Base URL</span>
                        <div class="config-value">${c.base_url}</div>
                    </div>
                    <div class="config-row">
                        <span class="config-label">Models</span>
                        <div class="config-value">${Array.isArray(c.models) ? c.models.map(m => `<span style="background:#e5e7eb; padding:2px 6px; border-radius:4px; font-size:11px; margin-right:4px;">${m}</span>`).join('') : c.models}</div>
                    </div>
                </div>

                <div class="config-actions">
                    <button class="btn-icon" style="color: var(--primary); background: #eef2ff;" onclick="adminSettings.testConfig(${c.id}, this)">
                        <span>🔗</span> 测试连接
                    </button>
                    <button class="btn-icon" style="color: var(--gray-700); background: white; border: 1px solid var(--gray-300);" onclick="adminSettings.editConfig(${c.id})">
                        <span>✏️</span> 编辑
                    </button>
                    <button class="btn-icon" style="color: var(--danger); background: white; border: 1px solid var(--danger);" onclick="adminSettings.deleteConfig(${c.id})">
                        <span>🗑️</span> 删除
                    </button>
                </div>
            </div>
        `).join('');
    },

    currentConfigs: [], // Store loaded configs for edit reference
    currentRoleMatrix: [],
    permissionCatalogGroups: [
        {
            title: '项目与协作',
            description: '决定是否能查看项目和推进基础协作操作。',
            permissions: [
                { code: 'project:read', desc: '查看项目、项目详情、地图、协作入口。' },
                { code: 'project:write', desc: '编辑项目基础信息和关键项目配置。' }
            ]
        },
        {
            title: '报告与经营',
            description: '控制报告查看、生成和经营/财务数据能力。',
            permissions: [
                { code: 'report:read', desc: '查看经营、财务、报表等分析结果。' },
                { code: 'report:write', desc: '生成或导出报告、周报等内容。' }
            ]
        },
        {
            title: '团队与资源',
            description: '控制资源、成员、排班等团队侧能力。',
            permissions: [
                { code: 'team:read', desc: '查看成员负荷、资源概览和团队信息。' },
                { code: 'team:write', desc: '编辑团队相关信息和资源操作。' }
            ]
        },
        {
            title: '执行记录',
            description: '控制日志、问题等交付执行动作。',
            permissions: [
                { code: 'worklog:write', desc: '填写或补录工作日志。' },
                { code: 'issue:write', desc: '登记或更新问题项。' }
            ]
        },
        {
            title: 'AI 能力',
            description: '控制 AI 分析、总结和辅助建议等入口。',
            permissions: [
                { code: 'ai:use', desc: '使用 AI 分析、AI 问答、AI 任务建议等功能。' }
            ]
        }
    ],

    // Legacy mapping if needed, but we unified loadAiConfigs


    showAddConfigModal: function () {
        document.getElementById('editConfigId').value = '';
        document.getElementById('aiConfigModalTitle').innerText = '新增 AI 配置';
        document.getElementById('aiName').value = '';
        document.getElementById('aiBaseUrl').value = '';
        document.getElementById('aiApiKey').value = '';
        document.getElementById('aiModels').value = '';
        document.getElementById('aiPriority').value = '10';
        document.getElementById('aiIsActive').checked = true;

        const el = document.getElementById('aiConfigModal');
        el.classList.add('show');
        el.style.display = 'flex';
    },

    editConfig: function (id) {
        const config = this.currentConfigs.find(c => c.id === id);
        if (!config) return;

        document.getElementById('editConfigId').value = config.id;
        document.getElementById('aiConfigModalTitle').innerText = '编辑 AI 配置';
        document.getElementById('aiName').value = config.name;
        document.getElementById('aiBaseUrl').value = config.base_url;
        document.getElementById('aiApiKey').value = ''; // Don't show existing key
        let modelsVal = config.models;
        if (Array.isArray(modelsVal)) {
            modelsVal = JSON.stringify(modelsVal);
        } else if (!modelsVal) {
            modelsVal = '[]';
        }
        document.getElementById('aiModels').value = modelsVal;
        document.getElementById('aiPriority').value = config.priority;
        document.getElementById('aiIsActive').checked = !!config.is_active;

        const el = document.getElementById('aiConfigModal');
        el.classList.add('show');
        el.style.display = 'flex';
    },

    closeAddConfigModal: function () {
        const el = document.getElementById('aiConfigModal');
        el.classList.remove('show');
        el.style.display = 'none';
    },

    saveConfig: async function () {
        const id = document.getElementById('editConfigId').value;
        const data = {
            name: document.getElementById('aiName').value,
            base_url: document.getElementById('aiBaseUrl').value,
            api_key: document.getElementById('aiApiKey').value,
            models: document.getElementById('aiModels').value,
            priority: parseInt(document.getElementById('aiPriority').value),
            is_active: document.getElementById('aiIsActive').checked
        };

        // Parse models if JSON string
        try {
            if (data.models.trim().startsWith('[')) {
                data.models = JSON.parse(data.models);
            } else {
                data.models = data.models.split(/[,，]/).map(s => s.trim()).filter(s => s);
            }
        } catch (e) {
            showToast('模型列表格式错误，请使用JSON数组或逗号分隔', 'warning');
            return;
        }

        try {
            if (id) {
                await api.put(`/admin/ai-configs/${id}`, data);
                showToast('✅ AI 配置已更新', 'success');
            } else {
                await api.post('/admin/ai-configs', data);
                showToast('✅ AI 配置已添加', 'success');
            }
            this.closeAddConfigModal();
            this.loadAiConfigs();
        } catch (e) {
            showToast('保存失败: ' + e.message, 'danger');
        }
    },

    deleteConfig: async function (id) {
        if (!confirm('确定删除此配置吗？')) return;
        try {
            await api.delete(`/admin/ai-configs/${id}`);
            this.loadAiConfigs();
        } catch (e) {
            showToast('删除失败: ' + e.message, 'danger');
        }
    },

    testConfig: async function (id, btn) {
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span>⏳</span> Testing...';

        try {
            const res = await api.post(`/admin/ai-configs/${id}/test`);
            if (res.success) {
                showToast(`✅ ${res.message}`, 'success');
            } else {
                showToast(`❌ ${res.message}`, 'danger', 5000);
            }
        } catch (e) {
            showToast(`❌ 测试失败: ${e.message}`, 'danger');
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    },

    // ========== WeCom Configuration Logic ==========

    loadWecomConfig: async function () {
        try {
            const res = await api.get('/admin/wecom-config');
            // api.get already returns data.data if success=true
            if (res) {
                const d = res; // res is the config object
                document.getElementById('wecomEnabled').checked = d.enabled === 'true';
                document.getElementById('wecomCorpId').value = d.corp_id || '';
                document.getElementById('wecomAgentId').value = d.agent_id || '';
                document.getElementById('wecomSecret').value = d.secret || '';
                document.getElementById('wecomCallbackToken').value = d.callback_token || '';
                document.getElementById('wecomCallbackAesKey').value = d.callback_aes_key || '';
                document.getElementById('wecomAppHomeUrl').value = d.app_home_url || '';
                document.getElementById('wecomWebhook').value = d.webhook || '';
            }
        } catch (e) {
            console.error('Failed to load WeCom config:', e);
        }
    },

    saveWecomConfig: async function () {
        const data = {
            enabled: document.getElementById('wecomEnabled').checked ? 'true' : 'false',
            corp_id: document.getElementById('wecomCorpId').value.trim(),
            agent_id: document.getElementById('wecomAgentId').value.trim(),
            secret: document.getElementById('wecomSecret').value.trim(),
            callback_token: document.getElementById('wecomCallbackToken').value.trim(),
            callback_aes_key: document.getElementById('wecomCallbackAesKey').value.trim(),
            app_home_url: document.getElementById('wecomAppHomeUrl').value.trim(),
            webhook: document.getElementById('wecomWebhook').value.trim()
        };

        if (data.enabled === 'true' && (!data.corp_id || !data.secret || !data.agent_id)) {
            showToast('启用企业微信时，企业ID、应用ID和Secret为必填项', 'warning');
            return;
        }

        try {
            const res = await api.post('/admin/wecom-config', data);
            if (res.success) {
                showToast('✅ 企业微信配置已保存并生效', 'success');
            } else {
                showToast('❌ 保存失败: ' + res.message, 'danger');
            }
        } catch (e) {
            showToast('❌ 请求失败: ' + e.message, 'danger');
        }
    },

    // ========== Storage Configuration Logic ==========

    toggleStorageForm: function () {
        const type = document.getElementById('storageType').value;
        const baiduForm = document.getElementById('baiduConfigForm');
        const r2Form = document.getElementById('r2ConfigForm');

        if (type === 'baidu') {
            baiduForm.style.display = 'block';
            r2Form.style.display = 'none';
        } else {
            baiduForm.style.display = 'none';
            r2Form.style.display = 'block';
        }
    },

    loadStorageConfig: async function () {
        try {
            const res = await api.get('/admin/storage/config');
            if (res) {
                // Set Selector
                document.getElementById('storageType').value = res.type || 'baidu';
                this.toggleStorageForm();

                // Set R2 values
                if (res.r2) {
                    document.getElementById('r2Endpoint').value = res.r2.endpoint || '';
                    document.getElementById('r2Bucket').value = res.r2.bucket_name || '';
                    document.getElementById('r2AccessKey').value = res.r2.access_key || '';
                    document.getElementById('r2SecretKey').value = res.r2.secret_key || ''; // Will be ****** if masked
                    document.getElementById('r2Domain').value = res.r2.public_domain || '';
                }

                // If Baidu, check status
                if (res.type === 'baidu' || !res.type) {
                    this.checkStorageStatus();
                }
            }
        } catch (e) {
            console.error('Failed to load storage config:', e);
        }
    },

    saveR2Config: async function () {
        const config = {
            type: 'r2',
            r2: {
                endpoint: document.getElementById('r2Endpoint').value.trim().replace(/\/+$/, '').split('/').slice(0, 3).join('/'),
                bucket_name: document.getElementById('r2Bucket').value.trim(),
                access_key: document.getElementById('r2AccessKey').value.trim(),
                secret_key: document.getElementById('r2SecretKey').value.trim(),
                public_domain: document.getElementById('r2Domain').value.trim()
            }
        };

        if (!config.r2.endpoint || !config.r2.bucket_name) {
            showToast('请填写 Endpoint 和 Bucket Name', 'warning');
            return;
        }

        try {
            const res = await api.post('/admin/storage/config', config);
            if (res.success) {
                showToast('✅ R2 配置保存成功，已切换为 R2 存储', 'success');
            } else {
                showToast('❌ 保存失败: ' + res.message, 'danger');
            }
        } catch (e) {
            showToast('❌ 请求失败: ' + e.message, 'danger');
        }
    },

    testR2Config: async function (btn) {
        const originalText = btn.innerText;
        btn.disabled = true;
        btn.innerText = '连接中...';

        const config = {
            endpoint: document.getElementById('r2Endpoint').value.trim().replace(/\/+$/, '').split('/').slice(0, 3).join('/'),
            bucket_name: document.getElementById('r2Bucket').value.trim(),
            access_key: document.getElementById('r2AccessKey').value.trim(),
            secret_key: document.getElementById('r2SecretKey').value.trim()
        };

        if (!config.endpoint || !config.bucket_name) {
            showToast('请填写 Endpoint 和 Bucket Name', 'warning');
            btn.disabled = false;
            btn.innerText = originalText;
            return;
        }

        try {
            const res = await api.post('/admin/storage/test-r2', config);
            if (res.success) {
                showToast('✅ 连接成功！R2 配置有效。', 'success');
            } else {
                showToast('❌ 连接失败: ' + res.message, 'danger');
            }
        } catch (e) {
            showToast('❌ 测试失败: ' + e.message, 'danger');
        } finally {
            btn.disabled = false;
            btn.innerText = originalText;
        }
    },

    submitTokenJson: async function () {
        const jsonStr = document.getElementById('baiduTokenJson').value.trim();
        if (!jsonStr) {
            showToast('请输入 JSON 内容', 'warning');
            return;
        }
        try {
            const data = JSON.parse(jsonStr);
            // Basic validation
            if (!data.access_token && !data.refresh_token) {
                if (!confirm('JSON 似乎不包含 access_token 或 refresh_token，确定要提交吗？')) return;
            }

            const res = await api.post('/admin/storage/manual-token', data);
            if (res.success) {
                showToast('✅ Token 保存成功', 'success');
                document.getElementById('baiduTokenJson').value = '';
                document.getElementById('manualTokenSection').style.display = 'none';
                this.checkStorageStatus();
            } else {
                showToast('❌ 保存失败: ' + res.message, 'danger');
            }
        } catch (e) {
            showToast('❌ JSON 格式错误或提交失败: ' + e.message, 'danger');
        }
    },

    checkStorageStatus: async function () {
        const statusEl = document.getElementById('baiduAuthStatus');
        statusEl.innerText = '检测中...';
        statusEl.className = 'badge badge-gray';

        try {
            const res = await api.get('/admin/storage/status');
            if (res.is_authorized) {
                statusEl.innerText = '✅ 已授权';
                statusEl.className = 'badge badge-success';
                statusEl.title = `有效期至: ${res.expires_at || '未知'}`;
            } else {
                statusEl.innerText = '❌ 未授权';
                statusEl.className = 'badge badge-danger';
            }
        } catch (e) {
            statusEl.innerText = '检测失败';
            console.error(e);
        }
    },

    openBaiduAuth: async function () {
        try {
            const res = await api.get('/admin/storage/auth-url');
            if (res.url) {
                window.open(res.url, '_blank', 'width=800,height=600');
            } else {
                showToast('无法获取授权URL', 'danger');
            }
        } catch (e) {
            showToast('获取授权URL失败: ' + e.message, 'danger');
        }
    },

    submitAuthCode: async function () {
        const code = document.getElementById('baiduAuthCode').value.trim();
        if (!code) {
            showToast('请输入授权码', 'warning');
            return;
        }

        const btn = document.querySelector('#tabStorageConfig button.btn-primary');
        const originalText = btn.innerText;
        btn.disabled = true;
        btn.innerText = '验证中...';

        try {
            const res = await api.post('/admin/storage/callback', { code });
            if (res.success) {
                showToast('🎉 授权成功！', 'success');
                document.getElementById('baiduAuthCode').value = '';
                this.checkStorageStatus();
            } else {
                showToast('❌ 授权失败: ' + res.message, 'danger');
            }
        } catch (e) {
            showToast('❌ 提交失败: ' + e.message, 'danger');
        } finally {
            btn.disabled = false;
            btn.innerText = originalText;
        }
    },

    // ========== WeCom User Binding Logic ==========

    loadWecomBindList: async function () {
        const container = document.getElementById('wecomBindList');
        if (!container) return;
        container.innerHTML = '<div class="text-center" style="padding: 40px; color: var(--gray-500);">⏳ 加载中...</div>';
        try {
            const res = await api.get('/admin/users/wecom-bindlist');
            const users = Array.isArray(res) ? res : (res && res.data ? res.data : []);
            if (users.length === 0) {
                container.innerHTML = '<div style="text-align:center; color:var(--gray-400); padding:30px;">暂无用户数据</div>';
                return;
            }
            container.innerHTML = `
                <div class="table-container" style="overflow-x:auto;">
                    <table class="table" style="font-size:13px; width:100%;">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>显示名称</th>
                                <th>角色</th>
                                <th>企微 UserID</th>
                                <th>状态</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${users.map(u => `
                                <tr>
                                    <td>${u.id}</td>
                                    <td><b>${u.display_name || u.username}</b></td>
                                    <td>${u.role}</td>
                                    <td>
                                        <input type="text" id="wecomBind_${u.id}" value="${u.wecom_userid || ''}" 
                                            placeholder="输入企微 userid" 
                                            style="width:160px; padding:4px 8px; border:1px solid ${u.is_bound ? 'var(--success)' : '#ddd'}; border-radius:6px; font-family:monospace; font-size:12px;">
                                    </td>
                                    <td>${u.is_bound ? '<span style="color:var(--success); font-weight:600;">✅ 已绑</span>' : '<span style="color:var(--gray-400);">未绑</span>'}</td>
                                    <td>
                                        <button class="btn-icon" style="color:var(--primary); background:#eef2ff; padding:4px 10px; font-size:12px;" 
                                            onclick="adminSettings.saveWecomBind(${u.id})">
                                            💾 保存
                                        </button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <div style="font-size:12px; color:var(--gray-400); margin-top:12px; line-height:1.6;">
                    💡 提示：企微 UserID 可在企业微信管理后台 → 通讯录 → 点击成员 → 账号字段中找到。绑定后项目预警将定向推送到该用户的企微。
                </div>
            `;
        } catch (e) {
            container.innerHTML = `<div style="color:var(--danger); padding:20px;">加载失败: ${e.message}</div>`;
        }
    },

    saveWecomBind: async function (userId) {
        const input = document.getElementById(`wecomBind_${userId}`);
        if (!input) return;
        const wecomUserid = input.value.trim();
        try {
            const res = await api.post(`/admin/users/${userId}/bind-wecom`, { wecom_userid: wecomUserid });
            if (res.success) {
                showToast('✅ ' + res.message, 'success');
                this.loadWecomBindList();
            } else {
                showToast('❌ ' + (res.message || '保存失败'), 'danger');
            }
        } catch (e) {
            showToast('❌ 请求失败: ' + e.message, 'danger');
        }
    },

    loadRolePermissionMatrix: async function () {
        const container = document.getElementById('rolePermissionMatrix');
        if (!container) return;
        container.innerHTML = '<div class="text-center" style="padding: 32px; color: var(--gray-500);">⏳ 加载中...</div>';

        try {
            const roleMatrix = typeof fetchRoleDefinitions === 'function'
                ? await fetchRoleDefinitions()
                : [];
            this.currentRoleMatrix = Array.isArray(roleMatrix) ? roleMatrix : [];
            container.innerHTML = this.renderRolePermissionEditor(this.currentRoleMatrix);
        } catch (e) {
            container.innerHTML = `<div class="error-msg">加载失败: ${e.message}</div>`;
        }
    },

    renderPermissionCatalog: function () {
        const container = document.getElementById('permissionCatalogSummary');
        if (!container) return;

        container.innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;">
                ${this.permissionCatalogGroups.map(group => `
                    <section style="border:1px solid #e5e7eb;border-radius:14px;padding:16px;background:linear-gradient(180deg,#ffffff 0%,#f8fafc 100%);">
                        <div style="font-size:15px;font-weight:700;color:#111827;">${group.title}</div>
                        <div style="margin-top:6px;font-size:12px;color:#64748b;line-height:1.7;">${group.description}</div>
                        <div style="display:grid;gap:8px;margin-top:12px;">
                            ${group.permissions.map(item => `
                                <div style="padding:10px 12px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;">
                                    <div style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;font-size:12px;font-weight:700;color:#1d4ed8;">${item.code}</div>
                                    <div style="margin-top:4px;font-size:12px;color:#475569;line-height:1.6;">${item.desc}</div>
                                </div>
                            `).join('')}
                        </div>
                    </section>
                `).join('')}
            </div>
        `;
    },

    renderRolePermissionEditor: function (roleMatrix) {
        const roles = Array.isArray(roleMatrix) ? roleMatrix : [];
        if (!roles.length) {
            return '<div class="empty-state" style="padding:24px;text-align:center;color:var(--gray-500);">暂无角色配置数据</div>';
        }

        return `
            <div class="table-container" style="overflow-x:auto;">
                <table class="table" style="width:100%;">
                    <thead>
                        <tr>
                            <th style="min-width:120px;">角色键</th>
                            <th style="min-width:140px;">显示名称</th>
                            <th>权限列表</th>
                            <th style="min-width:88px;">状态</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${roles.map((item, index) => {
                            const editable = item.editable !== false && item.role !== 'admin';
                            const nameValue = typeof escapeAdminText === 'function'
                                ? escapeAdminText(item.name || item.role || '')
                                : (item.name || item.role || '');
                            const roleValue = typeof escapeAdminText === 'function'
                                ? escapeAdminText(item.role || '')
                                : (item.role || '');
                            const permissionValue = typeof escapeAdminText === 'function'
                                ? escapeAdminText((item.permissions || []).join(', '))
                                : (item.permissions || []).join(', ');

                            return `
                                <tr>
                                    <td>
                                        <div style="font-weight:700;color:#0f172a;">${roleValue}</div>
                                        <div style="margin-top:4px;font-size:12px;color:#94a3b8;">固定角色键，不建议在现阶段变更</div>
                                    </td>
                                    <td>
                                        <input data-role-name="${index}" type="text" value="${nameValue}" ${editable ? '' : 'disabled'}
                                            style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;background:${editable ? 'white' : '#f8fafc'};">
                                    </td>
                                    <td>
                                        <textarea data-role-permissions="${index}" rows="3" ${editable ? '' : 'disabled'}
                                            style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:10px;line-height:1.6;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;background:${editable ? 'white' : '#f8fafc'};resize:vertical;">${permissionValue}</textarea>
                                        <div style="margin-top:6px;font-size:12px;color:#64748b;">使用英文逗号或换行分隔，例如：<code>project:read, report:read, ai:use</code></div>
                                        ${editable ? `
                                            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
                                                ${this.permissionCatalogGroups.flatMap(group => group.permissions.map(item => `
                                                    <button type="button"
                                                        onclick="adminSettings.appendPermission(${index}, '${item.code}')"
                                                        title="${item.desc}"
                                                        style="padding:4px 8px;border:1px solid #cbd5e1;border-radius:999px;background:#fff;color:#334155;font-size:11px;cursor:pointer;">
                                                        + ${item.code}
                                                    </button>
                                                `)).join('')}
                                            </div>
                                        ` : ''}
                                    </td>
                                    <td>
                                        <span class="badge" style="background:${editable ? '#ecfeff' : '#fef3c7'};color:${editable ? '#155e75' : '#92400e'};">
                                            ${editable ? '可编辑' : '锁定'}
                                        </span>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
                <div style="margin-top:12px;font-size:12px;color:#64748b;line-height:1.7;">
                当前权限为后端角色矩阵驱动；保存后新登录会立即拿到新权限，现有会话在重新请求 <code>/api/auth/me</code> 或重新登录后也会更新。为避免误放大权限，非 admin 角色提交的 <code>*</code> 或 <code>admin</code> 标记会被后端自动过滤。
            </div>
        `;
    },

    appendPermission: function (index, permissionCode) {
        const textarea = document.querySelector(`[data-role-permissions="${index}"]`);
        if (!textarea) return;

        const values = textarea.value
            .split(/[\n,，]+/)
            .map(value => value.trim())
            .filter(Boolean);

        if (!values.includes(permissionCode)) {
            values.push(permissionCode);
            textarea.value = values.join(', ');
        }
        textarea.focus();
    },

    collectRolePermissionPayload: function () {
        const currentMatrix = Array.isArray(this.currentRoleMatrix) ? this.currentRoleMatrix : [];
        return currentMatrix.map((item, index) => {
            const editable = item.editable !== false && item.role !== 'admin';
            if (!editable) {
                return {
                    role: item.role,
                    name: item.name,
                    permissions: item.permissions || []
                };
            }

            const nameInput = document.querySelector(`[data-role-name="${index}"]`);
            const permissionInput = document.querySelector(`[data-role-permissions="${index}"]`);
            const rawPermissions = permissionInput ? permissionInput.value : '';
            const permissions = rawPermissions
                .split(/[\n,，]+/)
                .map(value => value.trim())
                .filter(Boolean);

            return {
                role: item.role,
                name: (nameInput ? nameInput.value : item.name || item.role || '').trim() || item.role,
                permissions
            };
        });
    },

    saveRolePermissionMatrix: async function () {
        const payload = this.collectRolePermissionPayload();
        if (!payload.length) {
            showToast('暂无可保存的角色配置', 'warning');
            return;
        }

        try {
            await api.post('/admin/roles', { roles: payload });
            showToast('✅ 角色权限矩阵已保存', 'success');
            await this.loadRolePermissionMatrix();
            await this.loadUserPermissionList();
            if (typeof loadGlobalUsers === 'function' && document.getElementById('globalUserList')) {
                await loadGlobalUsers();
            }
        } catch (e) {
            showToast('❌ 保存角色权限矩阵失败: ' + e.message, 'danger');
        }
    },

    loadUserPermissionList: async function () {
        const tbody = document.getElementById('permissionUserList');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--gray-500);">加载中...</td></tr>';

        try {
            const [users, roleMatrix] = await Promise.all([
                api.get('/users'),
                typeof fetchRoleDefinitions === 'function' ? fetchRoleDefinitions() : []
            ]);
            if (typeof buildAdminUserRows !== 'function') {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:red;">用户权限渲染器未加载</td></tr>';
                return;
            }
            tbody.innerHTML = buildAdminUserRows(users, roleMatrix);
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:red;">加载失败: ${e.message}</td></tr>`;
        }
    },

    loadPermissionAuditLogs: async function () {
        const container = document.getElementById('permissionAuditList');
        if (!container) return;
        container.innerHTML = '<div class="text-center" style="padding: 32px; color: var(--gray-500);">⏳ 加载中...</div>';

        try {
            const logs = await api.get('/operation-logs?entity_type=auth', { silent: true });
            container.innerHTML = this.renderPermissionAuditLogs(Array.isArray(logs) ? logs : []);
        } catch (e) {
            container.innerHTML = `<div class="error-msg">加载失败: ${e.message}</div>`;
        }
    },

    renderPermissionAuditLogs: function (logs) {
        if (!logs.length) {
            return '<div class="empty-state" style="padding:24px;text-align:center;color:var(--gray-500);">暂无权限相关变更记录</div>';
        }

        const normalizePayload = value => {
            if (!value) return null;
            if (typeof value === 'object') return value;
            try {
                return JSON.parse(value);
            } catch (e) {
                return value;
            }
        };

        const summarize = value => {
            const payload = normalizePayload(value);
            if (!payload) return '无';
            if (typeof payload === 'string') return payload;
            if (Array.isArray(payload)) return `共 ${payload.length} 项`;
            return Object.entries(payload)
                .slice(0, 4)
                .map(([key, val]) => `${key}: ${typeof val === 'object' ? JSON.stringify(val) : val}`)
                .join(' | ');
        };

        return `
            <div style="display:grid;gap:10px;">
                ${logs.slice(0, 12).map(log => `
                    <div style="border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;background:#fff;">
                        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;">
                            <div>
                                <div style="font-size:14px;font-weight:700;color:#111827;">${log.operation_type || '未命名操作'}</div>
                                <div style="margin-top:4px;font-size:12px;color:#64748b;">${log.operator || '系统'} · ${log.entity_name || '-'} · ${log.created_at || '-'}</div>
                            </div>
                            <span class="badge" style="background:#eef2ff;color:#4338ca;">${log.entity_type || 'auth'}</span>
                        </div>
                        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:12px;">
                            <div style="padding:10px 12px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;">
                                <div style="font-size:11px;color:#94a3b8;">变更前</div>
                                <div style="margin-top:4px;font-size:12px;color:#334155;line-height:1.7;">${summarize(log.old_value)}</div>
                            </div>
                            <div style="padding:10px 12px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;">
                                <div style="font-size:11px;color:#94a3b8;">变更后</div>
                                <div style="margin-top:4px;font-size:12px;color:#334155;line-height:1.7;">${summarize(log.new_value)}</div>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    },

    // ========== Map Service Configuration Logic ==========

    loadMapConfig: async function () {
        try {
            const res = await api.get('/admin/map-config');
            const data = (res && res.data) ? res.data : (res || {});

            if (data.provider) document.getElementById('mapProvider').value = data.provider;
            if (data.baidu_ak) document.getElementById('mapBaiduAk').value = data.baidu_ak;
            if (data.amap_key) document.getElementById('mapAmapKey').value = data.amap_key;
            if (data.tianditu_key) document.getElementById('mapTiandituKey').value = data.tianditu_key;
            if (data.google_ak) document.getElementById('mapGoogleAk').value = data.google_ak;

        } catch (e) {
            console.error('Failed to load map config:', e);
        }
    },

    saveMapConfig: async function () {
        const config = {
            provider: document.getElementById('mapProvider').value,
            baidu_ak: document.getElementById('mapBaiduAk').value.trim(),
            amap_key: document.getElementById('mapAmapKey').value.trim(),
            tianditu_key: document.getElementById('mapTiandituKey').value.trim(),
            google_ak: document.getElementById('mapGoogleAk').value.trim()
        };

        try {
            const res = await api.post('/admin/map-config', config);
            if (res.success) {
                showToast('✅ 地图服务配置已保存', 'success');
                this.loadMapConfig(); // Reload to see masked values
            } else {
                showToast('❌ 保存失败: ' + res.message, 'danger');
            }
        } catch (e) {
            showToast('❌ 请求失败: ' + e.message, 'danger');
        }
    }
};

// Initialize when script loads
document.addEventListener('DOMContentLoaded', () => {
    adminSettings.init();
});
