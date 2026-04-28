from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(rel_path):
    return (ROOT / rel_path).read_text(encoding='utf-8')


def require(text, needle, label):
    if needle not in text:
        raise AssertionError(f"missing {label}: {needle}")


def main():
    service = read('services/quick_report_service.py')
    log_routes = read('routes/log_routes.py')
    mobile_routes = read('routes/mobile_routes.py')
    wecom = read('services/wecom_msg_handler.py')
    mobile_index = read('templates/mobile/index.html')
    mobile_quick = read('templates/mobile/quick_log.html')
    desktop_actions = read('static/js/ai_ops_hub.js')
    desktop_render = read('static/js/project_detail_render_hub.js')

    require(service, 'class QuickReportService', 'shared quick report service')
    require(service, 'INSERT INTO work_logs', 'work log persistence')
    require(service, 'INSERT INTO issues', 'issue creation from report')
    require(log_routes, "@log_bp.route('/quick-report'", 'desktop quick report API')
    require(mobile_routes, 'quick_report_service.submit', 'mobile route uses shared service')
    require(wecom, 'quick_report_service.submit', 'WeCom route uses shared service')
    require(wecom, '默认先当成上报', 'WeCom no-prefix report-first behavior')
    require(mobile_index, '一句话上报', 'mobile home quick report entry')
    require(mobile_quick, '可以不选，系统会自动归到最近活跃项目', 'mobile optional project hint')
    require(desktop_render, 'showQuickReportModal', 'desktop worklog tab quick report button')
    require(desktop_actions, 'submitQuickReport', 'desktop quick report submit handler')

    print('quick_report_smoke: ok')


if __name__ == '__main__':
    main()
