import json
import logging
import re
from datetime import datetime

from database import DatabasePool

logger = logging.getLogger(__name__)


class QuickReportService:
    """One-sentence field report entry point shared by web, mobile and WeCom."""

    WORK_KEYWORDS = (
        '今天', '上午', '下午', '晚上', '完成', '处理', '调试', '部署', '培训', '联调',
        '对接', '沟通', '确认', '巡检', '测试', '安装', '配置', '上线', '验收'
    )
    ISSUE_KEYWORDS = ('问题', '报错', '异常', '失败', '超时', '不通', '卡住', '阻塞', '不行', '崩', '挂')
    PLAN_PREFIXES = ('明天', '明日', '下步', '下一步', '后续', '计划')

    def submit(self, content, project_id=None, engineer_name='', wecom_userid='', source='web'):
        content = (content or '').strip()
        if not content:
            raise ValueError('请输入一句话上报内容')

        member_name = (engineer_name or '').strip()
        if wecom_userid and not member_name:
            member_name = self.get_user_display_name(wecom_userid)
        if not member_name:
            member_name = '现场工程师'

        resolved_project_id = self.resolve_project(project_id, member_name, wecom_userid)
        if not resolved_project_id:
            raise ValueError('未找到可用项目，请先选择项目或绑定企微账号')

        parsed = self.parse_content(content)
        log_id = self.save_worklog(resolved_project_id, member_name, parsed, content)
        issue_id = self.maybe_create_issue(resolved_project_id, parsed, content)
        project = self.get_project_brief(resolved_project_id)
        daily_summary = self.build_daily_summary(parsed, project, issue_id)

        return {
            'project_id': resolved_project_id,
            'project_name': project.get('project_name') or '',
            'member_name': member_name,
            'saved_log_id': log_id,
            'created_issue_id': issue_id,
            'parsed': parsed,
            'daily_summary': daily_summary,
            'message': '已保存一句话上报，日志、问题和明日计划已自动归档',
            'source': source,
        }

    def resolve_project(self, project_id=None, member_name='', wecom_userid=''):
        if project_id:
            try:
                return int(project_id)
            except (TypeError, ValueError):
                pass

        with DatabasePool.get_connection() as conn:
            if wecom_userid:
                user = conn.execute(
                    DatabasePool.format_sql('SELECT id, display_name FROM users WHERE wecom_userid = ?'),
                    (wecom_userid,)
                ).fetchone()
                if user:
                    project = conn.execute(DatabasePool.format_sql('''
                        SELECT pa.project_id
                        FROM project_user_access pa
                        JOIN projects p ON pa.project_id = p.id
                        WHERE pa.user_id = ? AND p.status NOT IN ('已完成', '已终止', '已验收', '质保期')
                        ORDER BY COALESCE(p.updated_at, p.created_at) DESC, p.id DESC
                        LIMIT 1
                    '''), (user['id'],)).fetchone()
                    if project:
                        return project['project_id']
                    member_name = member_name or user['display_name']

            if member_name:
                project = conn.execute(DatabasePool.format_sql('''
                    SELECT id FROM projects
                    WHERE project_manager = ? AND status NOT IN ('已完成', '已终止', '已验收', '质保期')
                    ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
                    LIMIT 1
                '''), (member_name,)).fetchone()
                if project:
                    return project['id']

            project = conn.execute(DatabasePool.format_sql('''
                SELECT id FROM projects
                WHERE status NOT IN ('已完成', '已终止', '已验收', '质保期')
                ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
                LIMIT 1
            ''')).fetchone()
            return project['id'] if project else None

    def parse_content(self, content):
        parsed = self._parse_deterministic(content)
        if self._looks_good_enough(parsed):
            return parsed

        ai_parsed = self._parse_with_ai(content)
        if ai_parsed:
            parsed.update({k: v for k, v in ai_parsed.items() if v not in (None, '', [])})
        return parsed

    def _parse_deterministic(self, content):
        text = re.sub(r'\s+', ' ', content).strip()
        parts = re.split(r'[；;。.!！\n]+', text)
        work, issues, plans, coordination = [], [], [], []
        hours = 8

        hour_match = re.search(r'(\d+(?:\.\d+)?)\s*(小时|h|H)', text)
        if hour_match:
            hours = float(hour_match.group(1))

        no_progress = re.search(r'(无进展|没进展|暂无进展|今天无事|今日无事|没啥)', text)
        for raw in parts:
            sentence = raw.strip(' ，,')
            if not sentence:
                continue
            if any(prefix in sentence for prefix in self.PLAN_PREFIXES):
                plans.append(sentence)
            elif any(kw in sentence for kw in self.ISSUE_KEYWORDS):
                issues.append(sentence)
            elif any(kw in sentence for kw in ('协调', '联系', '找', '约', '催', '对方', '厂家', '甲方')):
                coordination.append(sentence)
                work.append(sentence)
            else:
                work.append(sentence)

        if no_progress and not work:
            work.append('今日暂无明显进展，已完成状态同步')
        if not work:
            work.append(text)

        action_items = plans[:]
        if coordination:
            action_items.extend(coordination)

        return {
            'work_content': '；'.join(work).strip(),
            'issues': '；'.join(issues).strip(),
            'coordination': '；'.join(coordination).strip(),
            'tomorrow_plan': '；'.join(plans).strip(),
            'action_items': action_items[:5],
            'hours': hours,
        }

    def _looks_good_enough(self, parsed):
        combined = ''.join([parsed.get('issues', ''), parsed.get('tomorrow_plan', ''), parsed.get('coordination', '')])
        return bool(combined) or len(parsed.get('work_content', '')) <= 80

    def _parse_with_ai(self, content):
        try:
            from services.ai_service import ai_service
            prompt = f'''请把现场实施的一句话上报解析成JSON，只输出JSON。
输入：{content}
字段：work_content, issues, coordination, tomorrow_plan, action_items, hours。
没有的信息用空字符串或空数组；hours 默认 8。'''
            result = ai_service.call_ai_api('你是严格JSON解析器，只输出合法JSON。', prompt, task_type='summary')
            if not result:
                return None
            cleaned = result.strip()
            if cleaned.startswith('```'):
                cleaned = cleaned.split('```')[1].strip()
                if cleaned.startswith('json'):
                    cleaned = cleaned[4:].strip()
            data = json.loads(cleaned)
            if 'work_hours' in data and 'hours' not in data:
                data['hours'] = data.get('work_hours')
            if 'issues_encountered' in data and 'issues' not in data:
                data['issues'] = data.get('issues_encountered')
            return data
        except Exception as exc:
            logger.info("Quick report AI parse skipped: %s", exc)
            return None

    def save_worklog(self, project_id, member_name, parsed, raw_content):
        with DatabasePool.get_connection() as conn:
            cursor = conn.execute(DatabasePool.format_sql('''
                INSERT INTO work_logs (
                    project_id, member_name, log_date, work_content,
                    issues_encountered, tomorrow_plan, work_type, work_hours, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            '''), (
                project_id,
                member_name,
                datetime.now().strftime('%Y-%m-%d'),
                parsed.get('work_content') or raw_content,
                parsed.get('issues') or '',
                parsed.get('tomorrow_plan') or '',
                self._infer_work_type(raw_content),
                parsed.get('hours') or 8,
                datetime.now(),
            ))
            log_id = getattr(cursor, 'lastrowid', None)
            if not log_id:
                row = conn.execute(DatabasePool.format_sql('SELECT MAX(id) AS id FROM work_logs WHERE project_id = ?'), (project_id,)).fetchone()
                log_id = row['id'] if row else None
            conn.commit()
            return log_id

    def maybe_create_issue(self, project_id, parsed, raw_content):
        issue_text = (parsed.get('issues') or '').strip()
        if not issue_text:
            return None
        if not any(kw in issue_text for kw in self.ISSUE_KEYWORDS):
            return None

        severity = self.judge_severity(issue_text or raw_content)
        with DatabasePool.get_connection() as conn:
            cursor = conn.execute(DatabasePool.format_sql('''
                INSERT INTO issues (project_id, issue_type, description, severity, status, created_at)
                VALUES (?, ?, ?, ?, '待处理', ?)
            '''), (project_id, '一句话上报', issue_text[:1000], severity, datetime.now()))
            issue_id = getattr(cursor, 'lastrowid', None)
            if not issue_id:
                row = conn.execute(DatabasePool.format_sql('SELECT MAX(id) AS id FROM issues WHERE project_id = ?'), (project_id,)).fetchone()
                issue_id = row['id'] if row else None
            conn.commit()
            return issue_id

    def get_user_display_name(self, wecom_userid):
        with DatabasePool.get_connection() as conn:
            user = conn.execute(
                DatabasePool.format_sql('SELECT display_name FROM users WHERE wecom_userid = ?'),
                (wecom_userid,)
            ).fetchone()
            return user['display_name'] if user else wecom_userid

    def get_project_brief(self, project_id):
        with DatabasePool.get_connection() as conn:
            row = conn.execute(
                DatabasePool.format_sql('SELECT project_name, hospital_name FROM projects WHERE id = ?'),
                (project_id,)
            ).fetchone()
            return dict(row) if row else {}

    def build_daily_summary(self, parsed, project, issue_id=None):
        project_name = project.get('project_name') or '当前项目'
        lines = [
            f"今日已归档到「{project_name}」",
            f"工作：{parsed.get('work_content') or '已记录现场状态'}",
        ]
        if parsed.get('issues'):
            lines.append(f"问题：{parsed.get('issues')}")
        if parsed.get('tomorrow_plan'):
            lines.append(f"明日：{parsed.get('tomorrow_plan')}")
        if issue_id:
            lines.append(f"已同步生成待处理问题 #{issue_id}")
        return '\n'.join(lines)

    def judge_severity(self, description):
        high_keywords = ('崩溃', '宕机', '数据丢失', '无法启动', '全部', '瘫痪', '停机', '紧急')
        medium_keywords = ('报错', '异常', '失败', '超时', '不稳定', '偶发', '不通')
        if any(kw in description for kw in high_keywords):
            return '高'
        if any(kw in description for kw in medium_keywords):
            return '中'
        return '低'

    def _infer_work_type(self, text):
        if '出差' in text:
            return '出差'
        if any(kw in text for kw in ('现场', '医院', '科室', '护士站', '机房')):
            return '现场'
        return '远程'


quick_report_service = QuickReportService()
