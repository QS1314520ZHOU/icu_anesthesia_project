from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(rel_path):
    return (ROOT / rel_path).read_text(encoding='utf-8')


def require(text, needle, label):
    if needle not in text:
        raise AssertionError(f'missing {label}: {needle}')


def main():
    business = read('static/js/business_hub.js')
    financial = read('static/js/financial_hub.js')
    map_js = read('static/js/map.js')
    interface_spec = read('static/js/modules/interface-spec.js')
    dashboard = read('static/js/dashboard_hub.js')
    index = read('templates/index.html')

    require(business, '经营口径：按月度产值', 'business terminology boundary')
    require(business, '财务数据快照（只读联动）', 'business uses financial as readonly snapshot')
    require(business, '这里仅做差异提醒，不混用指标', 'business financial validation copy')
    require(financial, '财务口径：合同额、回款、未回款、报销、人力成本和毛利', 'financial terminology boundary')
    require(financial, '经营净利润请到经营看板查看', 'financial points to business net profit')
    require(map_js, '暂无项目地理数据', 'map empty project state')
    require(map_js, '请在项目中维护 hospital_name / 城市 / 地址', 'map actionable project empty hint')
    require(map_js, '暂无人员地理数据', 'map empty member state')
    require(interface_spec, 'exportFieldMappings()', 'interface mapping export entry')
    require(interface_spec, '字段差异已导出', 'interface mapping export feedback')
    require(dashboard, 'showActionInbox()', 'dashboard action inbox card')
    require(index, '配置中心', 'config center visible menu')

    print('product_clarity_smoke: ok')


if __name__ == '__main__':
    main()
