import random
import string
import unittest

from app import app
from db_init import init_db


class ApiSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app.testing = True
        init_db()
        cls.client = app.test_client()

        suffix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))
        cls.username = f"smoke_{suffix}"
        cls.password = "smoke123456"

        cls.client.post('/api/auth/register', json={
            'username': cls.username,
            'password': cls.password,
            'display_name': 'Smoke User',
            'role': 'team_member'
        })

        login_resp = cls.client.post('/api/auth/login', json={
            'username': cls.username,
            'password': cls.password
        })
        payload = login_resp.get_json() or {}
        data = payload.get('data') or {}
        cls.token = data.get('token')

    def _auth_headers(self):
        return {'Authorization': f'Bearer {self.token}'} if self.token else {}

    def test_dashboard_stats(self):
        resp = self.client.get('/api/dashboard/stats', headers=self._auth_headers())
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json() or {}
        self.assertTrue(body.get('success'))

    def test_business_overview(self):
        resp = self.client.get('/api/business/overview', headers=self._auth_headers())
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json() or {}
        self.assertTrue(body.get('success'))

    def test_analytics_overview(self):
        resp = self.client.get('/api/analytics/overview', headers=self._auth_headers())
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json() or {}
        self.assertTrue(body.get('success'))


    def test_business_receivables(self):
        resp = self.client.get('/api/business/receivables', headers=self._auth_headers())
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json() or {}
        self.assertTrue(body.get('success'))


    def test_my_dashboard(self):
        resp = self.client.get('/api/my/dashboard', headers=self._auth_headers())
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json() or {}
        self.assertTrue(body.get('success'))


    def test_people_project_board(self):
        resp = self.client.get('/api/ops/people-board', headers=self._auth_headers())
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json() or {}
        self.assertTrue(body.get('success'))


    def test_business_onsite_analytics(self):
        resp = self.client.get('/api/business/onsite-analytics', headers=self._auth_headers())
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json() or {}
        self.assertTrue(body.get('success'))


    def test_business_release_forecast(self):
        resp = self.client.get('/api/business/release-forecast?months=3', headers=self._auth_headers())
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json() or {}
        self.assertTrue(body.get('success'))

    def test_business_profit_forecast(self):
        resp = self.client.get('/api/business/profit-forecast', headers=self._auth_headers())
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json() or {}
        self.assertTrue(body.get('success'))


    def test_kb_items_search(self):
        # 先写入一条知识，再检索分块索引接口
        self.client.post('/api/kb', headers=self._auth_headers(), json={
            'category': '故障排查',
            'title': '监护仪断连排查',
            'content': '当监护仪采集中断时，先检查网口、串口参数、协议映射和设备IP。',
            'tags': '监护仪,断连,排查'
        })
        resp = self.client.get('/api/kb-items/search?q=监护仪', headers=self._auth_headers())
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json() or {}
        self.assertTrue(body.get('success'))


    def test_global_anomaly_briefing(self):
        resp = self.client.get('/api/ops/global-anomaly-briefing', headers=self._auth_headers())
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json() or {}
        self.assertTrue(body.get('success'))


    def test_log_semantic_weekly(self):
        resp = self.client.get('/api/ops/log-semantic-weekly?days=7&use_ai=false', headers=self._auth_headers())
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json() or {}
        self.assertTrue(body.get('success'))


    def test_project_acceptance_readiness(self):
        create_resp = self.client.post('/api/projects', headers=self._auth_headers(), json={
            'project_name': '验收测试项目',
            'hospital_name': '测试医院',
            'plan_start_date': '2026-04-01',
            'plan_end_date': '2026-06-30'
        })
        self.assertEqual(create_resp.status_code, 200)
        create_body = create_resp.get_json() or {}
        project_id = ((create_body.get('data') or {}).get('project_id'))
        self.assertTrue(project_id)

        resp = self.client.get(f'/api/projects/{project_id}/acceptance-readiness', headers=self._auth_headers())
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json() or {}
        self.assertTrue(body.get('success'))


    def test_issue_patterns(self):
        resp = self.client.get('/api/ops/issue-patterns?days=30&min_count=1', headers=self._auth_headers())
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json() or {}
        self.assertTrue(body.get('success'))

    def test_device_failure_patterns(self):
        resp = self.client.get('/api/ops/device-failure-patterns?days=30', headers=self._auth_headers())
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json() or {}
        self.assertTrue(body.get('success'))


    def test_project_schedule_advice(self):
        create_resp = self.client.post('/api/projects', headers=self._auth_headers(), json={
            'project_name': '排期建议测试项目',
            'hospital_name': '测试医院B',
            'plan_start_date': '2026-04-01',
            'plan_end_date': '2026-08-30'
        })
        self.assertEqual(create_resp.status_code, 200)
        create_body = create_resp.get_json() or {}
        project_id = ((create_body.get('data') or {}).get('project_id'))
        self.assertTrue(project_id)

        resp = self.client.get(f'/api/projects/{project_id}/schedule-advice', headers=self._auth_headers())
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json() or {}
        self.assertTrue(body.get('success'))


    def test_business_opportunities(self):
        create = self.client.post('/api/business/opportunities', headers=self._auth_headers(), json={
            'hospital_name': '测试商机医院',
            'expected_amount': 1200000,
            'stage': '方案阶段',
            'owner': '测试负责人'
        })
        self.assertEqual(create.status_code, 200)
        create_body = create.get_json() or {}
        opp_id = ((create_body.get('data') or {}).get('id'))
        self.assertTrue(opp_id)

        ls = self.client.get('/api/business/opportunities', headers=self._auth_headers())
        self.assertEqual(ls.status_code, 200)
        ls_body = ls.get_json() or {}
        self.assertTrue(ls_body.get('success'))

    def test_business_customer_profiles(self):
        resp = self.client.get('/api/business/customer-profiles', headers=self._auth_headers())
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json() or {}
        self.assertTrue(body.get('success'))


    def test_weekly_exec_digest(self):
        resp = self.client.get('/api/ops/weekly-exec-digest?days=7', headers=self._auth_headers())
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json() or {}
        self.assertTrue(body.get('success'))


    def test_business_pipeline_summary(self):
        resp = self.client.get('/api/business/pipeline-summary', headers=self._auth_headers())
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json() or {}
        self.assertTrue(body.get('success'))

    def test_project_detail_aux_endpoints(self):
        create_resp = self.client.post('/api/projects', headers=self._auth_headers(), json={
            'project_name': '详情辅助接口测试项目',
            'hospital_name': '测试医院C',
            'plan_start_date': '2026-04-01',
            'plan_end_date': '2026-07-31'
        })
        self.assertEqual(create_resp.status_code, 200)
        create_body = create_resp.get_json() or {}
        project_id = ((create_body.get('data') or {}).get('project_id'))
        self.assertTrue(project_id)

        cases = [
            ('/api/operational/stage-baselines', True),
            (f'/api/projects/{project_id}/changes', True),
            (f'/api/projects/{project_id}/gantt-data', False),
            (f'/api/risk/countdown/{project_id}', True),
            ('/api/ai/health', False),
        ]

        for url, wrapped in cases:
            with self.subTest(url=url):
                resp = self.client.get(url, headers=self._auth_headers())
                self.assertEqual(resp.status_code, 200)
                body = resp.get_json() or {}
                if wrapped:
                    self.assertTrue(body.get('success'))
                    if url.startswith('/api/risk/countdown/'):
                        data = body.get('data') or {}
                        self.assertIn('plan_end_date', data)
                        self.assertIn('predicted_end_date', data)
                        self.assertIn('is_delay_predicted', data)
                        self.assertIn('delay_days', data)
                else:
                    self.assertIsInstance(body, (dict, list))


    def test_warnings_api(self):
        resp = self.client.get('/api/warnings', headers=self._auth_headers())
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json() or {}
        self.assertTrue(body.get('success'))


    def test_kb_items_rebuild(self):
        resp = self.client.post('/api/kb-items/rebuild', headers=self._auth_headers(), json={'limit': 5})
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json() or {}
        self.assertTrue(body.get('success'))


    def test_notification_routing_config(self):
        get_resp = self.client.get('/api/notifications/routing-config', headers=self._auth_headers())
        self.assertEqual(get_resp.status_code, 200)
        get_body = get_resp.get_json() or {}
        self.assertTrue(get_body.get('success'))

        post_resp = self.client.post('/api/notifications/routing-config', headers=self._auth_headers(), json={
            'danger': 'project_manager,admin',
            'warning': 'project_manager',
            'info': 'project_manager'
        })
        self.assertEqual(post_resp.status_code, 200)
        post_body = post_resp.get_json() or {}
        self.assertTrue(post_body.get('success'))

if __name__ == '__main__':
    unittest.main()


















