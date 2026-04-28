from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(rel_path):
    return (ROOT / rel_path).read_text(encoding='utf-8')


def require(text, needle, label):
    if needle not in text:
        raise AssertionError(f'missing {label}: {needle}')


def main():
    index = read('templates/index.html')
    bootstrap = read('static/js/bootstrap_hub.js')
    dashboard = read('static/js/dashboard_hub.js')
    mobile = read('templates/mobile/index.html')
    collab_js = read('static/js/collaboration_hub.js')
    collab_routes = read('routes/collaboration_routes.py')
    checklist = read('PROJECT_DETAIL_REGRESSION_CHECKLIST.md')

    require(index, '行动收件箱', 'desktop action inbox menu entry')
    require(index, 'AI 工作台', 'desktop AI workbench menu entry')
    require(index, '配置中心', 'desktop config center menu entry')
    require(bootstrap, 'function showActionInbox', 'action inbox aggregator')
    require(bootstrap, 'function showAiWorkbench', 'AI workbench aggregator')
    require(bootstrap, 'function showConfigCenter', 'config center aggregator')
    require(dashboard, 'showActionInbox()', 'dashboard action inbox card')
    require(dashboard, 'showAiWorkbench()', 'dashboard AI workbench card')
    require(mobile, 'field-actions', 'mobile first-screen field actions')
    require(mobile, '快速日志', 'mobile quick log still visible')
    require(index, 'materializeMeetingActions()', 'meeting materialize button')
    require(collab_js, 'async function materializeMeetingActions', 'meeting materialize frontend')
    require(collab_routes, "meeting-actions/materialize", 'meeting materialize backend')
    require(collab_routes, 'project_service.add_task', 'meeting creates tasks')
    require(collab_routes, 'project_service.add_issue', 'meeting creates issues')
    require(checklist, '加载→编辑→保存→只刷新本切片不丢上下文', 'project detail regression checklist principle')

    print('ux_closure_smoke: ok')


if __name__ == '__main__':
    main()
