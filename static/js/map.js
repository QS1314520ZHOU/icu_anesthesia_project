/**
 * 交付地图模块 - 基于 ECharts
 */

async function initDeliveryMap() {
    const container = document.getElementById('mapView');
    container.innerHTML = `
        <div class="panel" style="height: 100%; display: flex; flex-direction: column; background: #0f172a; border: none; box-shadow: 0 10px 30px rgba(0,0,0,0.3); color: #fff;">
            <div class="panel-header" style="background: rgba(30, 41, 59, 0.5); border-bottom: 1px solid rgba(255,255,255,0.1); padding: 15px 20px;">
                <div class="panel-title" style="color: #60a5fa; font-size: 18px; font-weight: 700; display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 24px;">🗺️</span> 交付数字孪生仪表盘
                </div>
                <div class="btn-group" style="display: flex; gap: 10px; align-items: center;">
                    <button class="btn btn-sm" style="background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 8px; padding: 6px 12px;" onclick="initDeliveryMap()">刷新数据</button>
                </div>
            </div>
            <div class="panel-body" style="flex: 1; position: relative; min-height: 500px; padding: 0; background: radial-gradient(circle at center, #1e293b 0%, #0f172a 100%);">
                <div id="chinaMapContainer" style="width: 100%; height: 100%;"></div>
                <div id="mapLoading" class="loading-spinner" style="background: rgba(15, 23, 42, 0.8); color: #60a5fa;">正在接入地理信息系统...</div>
            </div>
        </div>
    `;

    const chartDom = document.getElementById('chinaMapContainer');
    if (!chartDom) return;
    window.myMapChart = echarts.init(chartDom); // 改为全局变量以便 toggle 使用

    // 默认视图模式 'normal' or 'heatmap'
    if (typeof window.currentMapMode === 'undefined') window.currentMapMode = 'normal';

    try {
        // 更新按钮文字
        const toggleBtn = document.getElementById('mapToggleBtn') || createMapToggleButton();
        toggleBtn.innerHTML = window.currentMapMode === 'normal' ? '🔥 切换热力图' : '🗺️ 切换分布图';

        // 获取业务数据
        const data = await api.get('/projects/geo');
        const geoStats = data.stats || [];
        const memberData = data.members || [];

        // 多源失败备选加载逻辑 (本地 -> 阿里 -> 其他)
        if (!window.chinaJsonCache) {
            const mapSources = [
                '/api/force_static/data/china_map.json',  // 1. 使用 api/force_static 确保由 Flask 处理并被 Nginx 转发
                'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json', // 2. 阿里公共源
                'https://cdn.jsdelivr.net/gh/apache/echarts-examples/public/data/asset/geo/china.json' // 3. ECharts 官方备选
            ];

            let loaded = false;
            for (const source of mapSources) {
                try {
                    const mapRes = await fetch(source);
                    if (mapRes.ok) {
                        window.chinaJsonCache = await mapRes.json();
                        echarts.registerMap('china', window.chinaJsonCache);
                        loaded = true;
                        console.log(`Map data loaded from: ${source}`);
                        break;
                    }
                } catch (e) {
                    console.warn(`Failed to load map from ${source}, trying next...`);
                }
            }
            if (!loaded) throw new Error('所有地图数据源均不可用，请联系管理员或检查网络配置');
        }

        document.getElementById('mapLoading').style.display = 'none';

        const mapData = geoStats.map(d => ({
            name: d.name.replace('省', '').replace('市', '').replace('自治区', '').replace('特别行政区', ''),
            value: d.count,
            avgProgress: d.avg_progress,
            projects: d.projects
        }));

        const scatterData = [];
        const heatmapData = []; // 热力图数据 [lng, lat, count]

        memberData.forEach(m => {
            let city = m.current_city || '';
            let coords = null;

            // 1. Priority: Use coordinates from backend (resolved by GeoService)
            if (m.lng && m.lat) {
                coords = [m.lng, m.lat];
            }
            // 2. Fallback: Local CITY_COORDS mapping
            else if (CITY_COORDS[city]) {
                coords = CITY_COORDS[city];
            }
            // 3. Fallback: Fuzzy matching in local mapping
            else if (city) {
                const cleanCity = city.replace(/[省市区县]/g, '');
                for (const cityKey in CITY_COORDS) {
                    if (cityKey.includes(cleanCity) || cleanCity.includes(cityKey) || (cleanCity.length >= 2 && cityKey.includes(cleanCity.substring(0, 2)))) {
                        coords = CITY_COORDS[cityKey];
                        break;
                    }
                }
            }

            if (coords) {
                scatterData.push({
                    name: m.name,
                    value: coords.concat(m.load_score),
                    role: m.role,
                    city: city,
                    project: m.project_name,
                    project_count: m.project_count,
                    task_count: m.task_count,
                    load_score: m.load_score
                });

                heatmapData.push(coords.concat(m.load_score / 10 || 1));
            }
        });

        // 基础配置
        const baseOption = {
            backgroundColor: 'transparent',
            title: {
                text: window.currentMapMode === 'normal' ? '全国项目覆盖与交付资源分布' : '交付团队资源投入热力',
                left: 'center',
                top: 30,
                textStyle: { color: '#f8fafc', fontSize: 20, fontWeight: 800, textShadowColor: 'rgba(0,0,0,0.5)', textShadowBlur: 10 }
            },
            tooltip: {
                trigger: 'item',
                backgroundColor: 'rgba(15, 23, 42, 0.85)',
                borderColor: 'rgba(96, 165, 250, 0.4)',
                borderWidth: 1,
                padding: 0,
                extraCssText: 'backdrop-filter: blur(8px); box-shadow: 0 10px 25px rgba(0,0,0,0.4); border-radius: 12px; overflow: hidden;'
            },
            geo: {
                map: 'china',
                roam: true,
                zoom: 1.1,
                label: {
                    show: true,
                    color: 'rgba(255,255,255,0.4)',
                    fontSize: 10
                },
                itemStyle: {
                    areaColor: '#1e293b',
                    borderColor: 'rgba(96, 165, 250, 0.3)',
                    borderWidth: 1,
                    shadowColor: 'rgba(0, 0, 0, 0.5)',
                    shadowBlur: 20,
                    shadowOffsetX: 0,
                    shadowOffsetY: 10
                },
                emphasis: {
                    label: { show: true, color: '#60a5fa', fontWeight: 'bold' },
                    itemStyle: {
                        areaColor: '#334155',
                        borderColor: '#60a5fa',
                        borderWidth: 2,
                        shadowBlur: 30
                    }
                }
            }
        };

        if (window.currentMapMode === 'normal') {
            baseOption.visualMap = [
                {
                    min: 0,
                    max: Math.max(...mapData.map(d => d.value), 5),
                    left: 30,
                    bottom: 30,
                    text: ['项目密集', ''],
                    calculable: true,
                    inRange: { color: ['#1e293b', '#3b82f6', '#60a5fa'] },
                    textStyle: { color: '#94a3b8' },
                    seriesIndex: 0
                },
                {
                    type: 'piecewise',
                    min: 0,
                    max: 200,
                    left: 30,
                    top: 'center',
                    text: ['负载均衡指数'],
                    textStyle: { color: '#94a3b8' },
                    pieces: [
                        { min: 70, label: '预警 (高负荷)', color: '#f43f5e' },
                        { min: 40, max: 70, label: '标准 (持续交付)', color: '#10b981' },
                        { lt: 40, label: '充沛 (可调配)', color: '#3b82f6' }
                    ],
                    seriesIndex: 1,
                    dimension: 2
                }
            ];

            baseOption.tooltip.formatter = function (params) {
                if (params.seriesType === 'map') {
                    if (!params.data) return `<div style="padding:10px;color:#94a3b8;">${params.name}: 暂无活跃项目</div>`;
                    return `
                        <div style="padding: 15px; border-radius: 12px;">
                            <div style="font-size:16px; font-weight:700; color:#60a5fa; margin-bottom:10px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px;">${params.name} 交付区</div>
                            <div style="color:#cbd5e1; font-size:13px; line-height:1.8;">
                                <div style="display:flex; justify-content:space-between; gap:20px;">
                                    <span>项目总数:</span> <b style="color:#f8fafc;">${params.data.value}</b>
                                </div>
                                <div style="display:flex; justify-content:space-between; gap:20px;">
                                    <span>平均进度:</span> <b style="color:#10b981;">${params.data.avgProgress}%</b>
                                </div>
                                <div style="margin-top:8px; font-size:11px; color:#94a3b8; max-width:200px;">
                                    重点关注: ${params.data.projects}
                                </div>
                            </div>
                        </div>
                    `;
                } else {
                    const color = params.data.load_score > 70 ? '#f43f5e' : (params.data.load_score >= 40 ? '#10b981' : '#3b82f6');
                    const status = params.data.load_score > 70 ? '高压运行' : (params.data.load_score >= 40 ? '稳健交付' : '资源充沛');
                    return `
                        <div style="padding: 15px; min-width:220px;">
                            <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px;">
                                <div style="width:40px; height:40px; border-radius:10px; background:${color}22; display:flex; align-items:center; justify-content:center; color:${color}; font-size:20px;">👤</div>
                                <div>
                                    <div style="font-size:16px; font-weight:700; color:#f8fafc;">${params.data.name}</div>
                                    <div style="font-size:12px; color:#94a3b8;">${params.data.role}</div>
                                </div>
                                <div style="margin-left:auto; padding:2px 8px; border-radius:6px; background:${color}; color:white; font-size:11px;">${status}</div>
                            </div>
                            <div style="background:rgba(255,255,255,0.03); border-radius:8px; padding:10px; font-size:12px; color:#cbd5e1; line-height:1.8;">
                                <div style="display:flex; justify-content:space-between;">
                                    <span>所在城市:</span> <span style="color:#f8fafc;">${params.data.city}</span>
                                </div>
                                <div style="display:flex; justify-content:space-between;">
                                    <span>主责项目:</span> <span style="color:#60a5fa;">${params.data.project}</span>
                                </div>
                                <hr style="margin:8px 0; border:0; border-top:1px solid rgba(255,255,255,0.05);"/>
                                <div style="display:flex; justify-content:space-between;">
                                    <span>负载评分:</span> <b style="color:${color};">${params.data.load_score}</b>
                                </div>
                                <div style="display:flex; justify-content:space-between;">
                                    <span>负责项目数:</span> <b style="color:#f8fafc;">${params.data.project_count}</b>
                                </div>
                                <div style="display:flex; justify-content:space-between;">
                                    <span>待办任务:</span> <b style="color:#f43f5e;">${params.data.task_count}</b>
                                </div>
                            </div>
                        </div>
                    `;
                }
            };
            baseOption.series = [
                {
                    name: '项目分布',
                    type: 'map',
                    map: 'china',
                    geoIndex: 0,
                    data: mapData
                },
                {
                    name: '交付人员',
                    type: 'effectScatter',
                    coordinateSystem: 'geo',
                    data: scatterData,
                    symbolSize: (val) => Math.max(10, val[2] / 5),
                    showEffectOn: 'render',
                    rippleEffect: { brushType: 'stroke', scale: 3, period: 4 },
                    label: { show: false },
                    itemStyle: {
                        shadowBlur: 15,
                        shadowColor: 'rgba(0,0,0,0.8)',
                        opacity: 0.9
                    },
                    zlevel: 5
                }
            ];
        } else {
            // 热力图模式
            baseOption.visualMap = {
                min: 0,
                max: 5,
                calculable: true,
                orient: 'vertical',
                left: 30,
                bottom: 30,
                inRange: { color: ['rgba(59, 130, 246, 0.1)', 'green', 'yellow', '#f43f5e'] },
                textStyle: { color: '#94a3b8' }
            };
            baseOption.series = [
                {
                    type: 'heatmap',
                    coordinateSystem: 'geo',
                    data: heatmapData,
                    pointSize: 18,
                    blurSize: 15
                }
            ];
        }

        window.myMapChart.setOption(baseOption, true); // true forces not merge, clear previous series
        window.addEventListener('resize', () => window.myMapChart.resize());

    } catch (e) {
        console.error('地图引擎负载异常', e);
        document.getElementById('chinaMapContainer').innerHTML = `
            <div class="empty-state" style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:#94a3b8; gap:20px;">
                <div style="font-size:60px;">📡</div>
                <div style="font-size:18px; color:#f43f5e; font-weight:600;">数字化底座连接中断</div>
                <div style="font-size:14px; opacity:0.8; max-width:400px; text-align:center; line-height:1.6;">
                    ${e.message}<br><br>
                    <span style="color:#60a5fa;">可能原因：</span> 区域网络波动或时空数据服务未启动。<br>
                    <span style="color:#60a5fa;">建议操作：</span> 刷新页面或联系系统管理员检视后端服务状态。
                </div>
            </div>
        `;
        document.getElementById('mapLoading').style.display = 'none';
    }
}

function createMapToggleButton() {
    const parent = document.querySelector('#mapView .btn-group');
    if (!parent) return document.createElement('button');
    const btn = document.createElement('button');
    btn.id = 'mapToggleBtn';
    // 初始样式（之后会被 initDeliveryMap 中的逻辑更新）
    btn.className = 'btn btn-sm';
    btn.style = 'background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 8px; padding: 6px 12px; margin-right: 10px;';
    btn.onclick = toggleMapMode;
    parent.insertBefore(btn, parent.firstChild);
    return btn;
}

function toggleMapMode() {
    window.currentMapMode = window.currentMapMode === 'normal' ? 'heatmap' : 'normal';
    initDeliveryMap();
}
