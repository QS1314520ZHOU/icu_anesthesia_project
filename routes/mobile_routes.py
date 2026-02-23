# routes/mobile_routes.py

from flask import Blueprint, render_template, request
from api_utils import api_response
from database import DatabasePool
from services.ai_service import ai_service
from rag_service import rag_service
import json

mobile_bp = Blueprint('mobile', __name__, url_prefix='/m')

# ====== 页面路由 ======
@mobile_bp.route('/')
def index():
    return render_template('mobile/index.html')

@mobile_bp.route('/knowledge')
def knowledge_page():
    return render_template('mobile/knowledge.html')

@mobile_bp.route('/chat')
def chat_page():
    return render_template('mobile/ai_chat.html')


# ====== 移动端API ======

@mobile_bp.route('/api/auth', methods=['POST'])
def mobile_auth():
    """
    企业微信 H5 网页授权
    用户从企业微信打开时，通过 JS-SDK 拿到 code
    后端用 code 换 userid（复用现有 wecom_service）
    """
    code = request.json.get('code', '')
    from services.wecom_service import wecom_service
    user_info = wecom_service.get_user_by_code(code)
    
    if user_info:
        # 直接拿到 wecom_userid，和你现有用户体系打通
        return api_response(True, data=user_info)
    return api_response(False, message='认证失败')


@mobile_bp.route('/api/config')
def mobile_config():
    """获取移动端必要的配置（如 CorpID）"""
    from app_config import WECOM_CONFIG
    return api_response(True, data={
        'corp_id': WECOM_CONFIG.get('CORP_ID', '')
    })


@mobile_bp.route('/api/kb/search', methods=['POST'])
def kb_search():
    """知识库 RAG 智能搜索 —— 完全复用现有引擎"""
    query = request.json.get('query', '')
    if not query:
        return api_response(False, message='请输入搜索内容')
    
    with DatabasePool.get_connection() as conn:
        # 第一阶段：关键词粗筛（不加载 embedding，减小内存压力）
        keyword_candidates = conn.execute('''
            SELECT id, title, content, category, tags 
            FROM knowledge_base 
            WHERE title LIKE ? OR content LIKE ? OR tags LIKE ?
            LIMIT 100
        ''', (f'%{query}%', f'%{query}%', f'%{query}%')).fetchall()
        
        kb_items = []
        if len(keyword_candidates) < 10:
            # 如果关键词命中太少，兜底全量（但限制加载 embedding 的数量）
            all_rows = conn.execute('''
                SELECT id, title, content, category, tags, embedding 
                FROM knowledge_base LIMIT 300
            ''').fetchall()
            kb_items = [dict(r) for r in all_rows]
        else:
            # 第二阶段：只对候选集加载 embedding 做精排
            ids = [r['id'] for r in keyword_candidates]
            placeholders = ','.join('?' * len(ids))
            rows = conn.execute(
                f'SELECT id, title, content, category, tags, embedding '
                f'FROM knowledge_base WHERE id IN ({placeholders})', ids
            ).fetchall()
            kb_items = [dict(r) for r in rows]
    
    # 向量 + 关键词混合检索
    query_vector = ai_service.get_embeddings(query)
    
    # 评分排序
    scored = []
    for item in kb_items:
        search_blob = f"{item['title']} {item['content']} {item.get('tags','')} {item['category']}"
        kw_score = rag_service.calculate_keyword_score(query, search_blob)
        
        vec_score = 0.0
        if query_vector and item.get('embedding'):
            from utils.vector_utils import vector_utils
            item_vec = vector_utils.decode_vector(item['embedding'])
            vec_score = vector_utils.cosine_similarity(query_vector, item_vec)
        
        final_score = (vec_score * 50) + kw_score
        if final_score > 0:
            scored.append({
                'id': item['id'],
                'title': item['title'],
                'category': item['category'],
                'tags': item.get('tags', ''),
                'summary': item['content'][:150] + '...',
                'score': round(final_score, 2)
            })
    
    scored.sort(key=lambda x: x['score'], reverse=True)
    return api_response(True, data=scored[:10])


@mobile_bp.route('/api/ai/chat', methods=['POST'])
def ai_chat():
    """AI 对话 —— RAG 增强，复用现有 ai_service"""
    message = request.json.get('message', '')
    use_rag = request.json.get('use_rag', True)
    history = request.json.get('history', [])  # 前端传来的对话历史
    
    if not message:
        return api_response(False, message='请输入问题')
    
    # 1. RAG 检索知识库上下文
    context = ""
    references = []
    if use_rag:
        with DatabasePool.get_connection() as conn:
            # AI 对话同样采用两阶段 RAG 优化
            keyword_candidates = conn.execute('''
                SELECT id, title, content, category, tags 
                FROM knowledge_base 
                WHERE title LIKE ? OR content LIKE ? OR tags LIKE ?
                LIMIT 100
            ''', (f'%{message}%', f'%{message}%', f'%{message}%')).fetchall()
            
            kb_items = []
            if len(keyword_candidates) < 5:
                # 兜底：即使关键词没中，也加载一部分潜在大类数据
                all_rows = conn.execute(
                    'SELECT id, title, content, category, tags, embedding '
                    'FROM knowledge_base LIMIT 200'
                ).fetchall()
                kb_items = [dict(r) for r in all_rows]
            else:
                ids = [r['id'] for r in keyword_candidates]
                placeholders = ','.join('?' * len(ids))
                rows = conn.execute(
                    f'SELECT id, title, content, category, tags, embedding '
                    f'FROM knowledge_base WHERE id IN ({placeholders})', ids
                ).fetchall()
                kb_items = [dict(r) for r in rows]
        
        query_vector = ai_service.get_embeddings(message)
        context = rag_service.retrieve_context(
            message, kb_items, top_k=3, query_vector=query_vector
        )
    
    # 2. 构建 System Prompt
    system_prompt = (
        "你是一位精干的 ICU 医疗信息化项目总监 (Executive Project Director)。\n"
        "你的职责是为现场经理提供极具战略高度和行动导向的建议。你的语气应专业、权威且简洁。\n"
    )
    if context:
        system_prompt += f"\n【决策支持知识库上下文】\n{context}\n"
        system_prompt += "\n请优先基于知识库回答，确保持论有据。如果现有资料不足，请结合 ICU 临床信息化交付经验给出前瞻性分析。"
    
    # 3. 拼接多轮对话历史
    user_content = message
    if history:
        # 取最近5轮
        recent = history[-10:]  
        history_text = "\n".join(
            [f"{'用户' if h['role']=='user' else '助手'}: {h['content']}" 
             for h in recent]
        )
        user_content = f"对话历史：\n{history_text}\n\n当前问题：{message}"
    
    # 4. 调用 AI（完全复用你现有的多端点回退机制）
    result = ai_service.call_ai_api(system_prompt, user_content, task_type="chat")
    
    if result:
        return api_response(True, data={
            'reply': result,
            'has_rag_context': bool(context)
        })
    else:
        return api_response(False, message='AI 服务暂时不可用，请稍后再试')
# routes/mobile_routes.py 新增

@mobile_bp.route('/api/project/briefing/<int:project_id>', methods=['GET'])
def project_briefing(project_id):
    """AI 生成项目速查简报 —— 一页掌握全局"""
    with DatabasePool.get_connection() as conn:
        project = conn.execute('SELECT * FROM projects WHERE id = ?', (project_id,)).fetchone()
        if not project:
            return api_response(False, message='项目不存在')
        p = dict(project)
        
        # 阶段进展
        stages = conn.execute('''
            SELECT stage_name, status, progress, responsible_person 
            FROM project_stages WHERE project_id = ? ORDER BY stage_order
        ''', (project_id,)).fetchall()
        
        # 活跃问题
        issues = conn.execute('''
            SELECT description, severity, status FROM issues 
            WHERE project_id = ? AND status != '已解决' ORDER BY severity
        ''', (project_id,)).fetchall()
        
        # 甲方关键人
        contacts = conn.execute('''
            SELECT name, department, position, phone, remark 
            FROM customer_contacts WHERE project_id = ?
        ''', (project_id,)).fetchall()
        
        # 最近5条工作日志（了解前人做了什么）
        recent_logs = conn.execute('''
            SELECT member_name, log_date, work_content, issues_encountered 
            FROM work_logs WHERE project_id = ? ORDER BY log_date DESC LIMIT 5
        ''', (project_id,)).fetchall()
        
        # 接口完成情况
        interfaces = conn.execute('''
            SELECT system_name, interface_name, status 
            FROM interfaces WHERE project_id = ?
        ''', (project_id,)).fetchall()
        
        # 里程碑
        milestones = conn.execute('''
            SELECT name, target_date, is_completed 
            FROM milestones WHERE project_id = ? ORDER BY target_date
        ''', (project_id,)).fetchall()

    # 拼 AI prompt
    system_prompt = """你是 ICU 项目交付总监。请根据项目数据，生成一份**现场工程师速查卡**。
要求：
- 极度简洁，用 emoji + 短句，禁止长篇大论
- 重点突出：当前卡在哪、甲方关键人性格/偏好（如有备注）、前任留下的坑
- 最后给出"到场后前3件事该做什么"的行动建议
- 用 Markdown 格式"""

    user_content = f"""项目：{p['project_name']} | {p['hospital_name']}
规模：ICU {p.get('icu_beds',0)}床 / 手术室 {p.get('operating_rooms',0)}间 / PACU {p.get('pacu_beds',0)}床
状态：{p['status']} | 进度：{p.get('progress',0)}%
计划周期：{p.get('plan_start_date','')} ~ {p.get('plan_end_date','')}

阶段进展：
{chr(10).join([f"- {dict(s)['stage_name']}: {dict(s)['status']}({dict(s)['progress']}%)" for s in stages])}

活跃问题({len(issues)}个)：
{chr(10).join([f"- [{dict(i)['severity']}] {dict(i)['description']}" for i in issues]) or '无'}

甲方联系人：
{chr(10).join([f"- {dict(c)['name']}({dict(c)['department']}{dict(c)['position']}) {dict(c).get('remark','')}" for c in contacts]) or '未录入'}

接口状态：
{chr(10).join([f"- {dict(it)['system_name']}-{dict(it)['interface_name']}: {dict(it)['status']}" for it in interfaces]) or '无'}

最近工作记录：
{chr(10).join([f"- {dict(l)['log_date']} {dict(l)['member_name']}: {(dict(l)['work_content'] or '')[:80]}" for l in recent_logs]) or '无记录'}

下一个里程碑：
{chr(10).join([f"- {'✅' if dict(m)['is_completed'] else '⏳'} {dict(m)['name']} → {dict(m)['target_date']}" for m in milestones[:3]]) or '无'}"""

    result = ai_service.call_ai_api(system_prompt, user_content, task_type="summary")
    
    return api_response(True, data={
        'briefing': result,
        'project': p,
        'quick_stats': {
            'open_issues': len(issues),
            'interface_done': sum(1 for i in interfaces if dict(i)['status'] == '已完成'),
            'interface_total': len(interfaces),
        }
    })
@mobile_bp.route('/api/log/quick', methods=['POST'])
def quick_log():
    """快速记录工作日志 —— 支持自然语言输入，AI 自动解析"""
    raw_text = request.json.get('content', '')
    project_id = request.json.get('project_id')
    
    if not raw_text:
        return api_response(False, message='请输入日志内容')
    
    # AI 解析自然语言为结构化日志
    parse_prompt = f"""请将以下工程师的现场日志文本解析为JSON。
注意区分：今日工作内容、遇到的问题/阻塞项、需要协调的事项和人员、明日计划。
如果提到了具体的人名和事项，请在 action_items 中列出。

输入："{raw_text}"

仅输出JSON：
{{"work_content":"今日工作","issues":"遇到的问题","coordination":"需协调事项（含人名）","tomorrow_plan":"明日计划","action_items":["具体待办1","具体待办2"],"hours":8}}"""
    
    parsed_result = ai_service.call_ai_api(
        "你是JSON解析器，只输出合法JSON，不要其他任何文字。", 
        parse_prompt, task_type="summary"
    )
    
    # 解析 JSON
    import json
    try:
        if '```' in parsed_result:
            parsed_result = parsed_result.split('```')[1]
            if parsed_result.startswith('json'):
                parsed_result = parsed_result[4:]
        parsed = json.loads(parsed_result.strip())
    except:
        parsed = {"work_content": raw_text, "issues": "", "tomorrow_plan": "", "hours": 8, "action_items": []}
    
    # 写入数据库
    from datetime import datetime
    with DatabasePool.get_connection() as conn:
        conn.execute('''
            INSERT INTO work_logs (project_id, member_name, log_date, work_content, 
                                  issues_encountered, tomorrow_plan, work_type, work_hours)
            VALUES (?, ?, ?, ?, ?, ?, '现场', ?)
        ''', (
            project_id,
            request.json.get('engineer_name', ''),
            datetime.now().strftime('%Y-%m-%d'),
            parsed.get('work_content', raw_text),
            parsed.get('issues', ''),
            parsed.get('tomorrow_plan', ''),
            parsed.get('hours', 8)
        ))
        conn.commit()
    
    return api_response(True, data={
        'parsed': parsed,
        'message': '日志已保存'
    })
@mobile_bp.route('/api/meeting/quick', methods=['POST'])
def quick_meeting_note():
    """甲方沟通速记 —— AI 自动结构化"""
    raw_text = request.json.get('content', '')
    project_id = request.json.get('project_id')
    
    if not raw_text:
        return api_response(False, message='请输入沟通内容')

    parse_prompt = f"""请将以下现场工程师与甲方的沟通记录提取为结构化JSON。
重点提取：关键决定、甲方提出的新需求、承诺的时间节点、需要跟进的事项。

输入："{raw_text}"

仅输出JSON：
{{"contact_person":"沟通对象","summary":"核心结论（50字内）","decisions":["决定1","决定2"],"new_requirements":["新需求1"],"deadlines":[{{"item":"事项","date":"YYYY-MM-DD或描述"}}],"follow_ups":["待跟进事项1"]}}"""

    parsed_result = ai_service.call_ai_api(
        "你是JSON解析器，只输出合法JSON。", parse_prompt, task_type="summary"
    )
    
    import json
    from datetime import datetime
    try:
        if '```' in parsed_result:
            parsed_result = parsed_result.split('```')[1]
            if parsed_result.startswith('json'):
                parsed_result = parsed_result[4:]
        parsed = json.loads(parsed_result.strip())
    except:
        parsed = {"contact_person": "", "summary": raw_text[:50], "decisions": [], "new_requirements": [], "deadlines": [], "follow_ups": []}
    
    # 存入沟通记录表
    with DatabasePool.get_connection() as conn:
        conn.execute('''
            INSERT INTO customer_communications 
            (project_id, contact_date, contact_person, contact_method, summary, created_by)
            VALUES (?, ?, ?, '现场沟通', ?, ?)
        ''', (
            project_id,
            datetime.now().strftime('%Y-%m-%d'),
            parsed.get('contact_person', ''),
            json.dumps(parsed, ensure_ascii=False),
            request.json.get('engineer_name', '')
        ))
        
        # 自动创建提醒（如果有截止日期）
        for dl in parsed.get('deadlines', []):
            if dl.get('date') and len(dl['date']) == 10:  # YYYY-MM-DD
                conn.execute('''
                    INSERT INTO notifications (project_id, title, content, type, due_date)
                    VALUES (?, ?, ?, 'warning', ?)
                ''', (project_id, f"甲方截止日: {dl['item']}", 
                      f"来源: {parsed.get('contact_person','')}沟通记录", dl['date']))
        
        conn.commit()
    
    return api_response(True, data={
        'parsed': parsed,
        'message': '沟通记录已保存',
        'auto_reminders': len(parsed.get('deadlines', []))
    })
@mobile_bp.route('/api/kb/contribute', methods=['POST'])
def contribute_knowledge():
    """从已解决问题一键沉淀为知识库条目"""
    issue_id = request.json.get('issue_id')
    project_id = request.json.get('project_id')
    # 也支持手动输入
    manual_title = request.json.get('title', '')
    manual_content = request.json.get('content', '')
    
    if issue_id:
        # 从问题记录自动生成
        with DatabasePool.get_connection() as conn:
            issue = conn.execute('SELECT * FROM issues WHERE id = ?', (issue_id,)).fetchone()
            if not issue:
                return api_response(False, message='问题不存在')
            issue = dict(issue)
        
        gen_prompt = f"""请将以下已解决的现场问题转化为知识库条目。
要求：
1. 标题简洁明了，便于搜索
2. 内容包含：问题现象、根因分析、解决方案（分步骤）、注意事项
3. 给出 3-5 个搜索标签

问题描述：{issue['description']}
问题类型：{issue.get('issue_type','')}
严重程度：{issue.get('severity','')}

输出JSON：
{{"title":"标题","content":"知识内容（Markdown）","category":"分类","tags":"标签1,标签2,标签3"}}"""
        
        result = ai_service.call_ai_api(
            "你是知识管理专家，只输出JSON。", gen_prompt, task_type="summary"
        )
    else:
        # 手动输入模式
        result = json.dumps({
            "title": manual_title, 
            "content": manual_content, 
            "category": "现场经验", 
            "tags": ""
        })
    
    import json
    try:
        if '```' in result:
            result = result.split('```')[1]
            if result.startswith('json'):
                result = result[4:]
        kb_data = json.loads(result.strip())
    except:
        return api_response(False, message='知识生成失败，请手动编辑后提交')
    
    # 写入知识库
    with DatabasePool.get_connection() as conn:
        conn.execute('''
            INSERT INTO knowledge_base (category, title, content, tags, project_id, author)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (
            kb_data.get('category', '现场经验'),
            kb_data.get('title', ''),
            kb_data.get('content', ''),
            kb_data.get('tags', ''),
            project_id,
            request.json.get('engineer_name', '')
        ))
        conn.commit()
    
    # 异步生成 embedding（不阻塞响应）
    import threading
    def sync_embedding():
        rag_service.sync_embeddings(ai_service)
    threading.Thread(target=sync_embedding, daemon=True).start()
    
    return api_response(True, data={
        'knowledge': kb_data,
        'message': '已沉淀到知识库'
    })
@mobile_bp.route('/api/report/daily/<int:project_id>', methods=['GET'])
def generate_daily_report(project_id):
    """一键生成今日工作简报 —— 可直接转发给甲方"""
    from datetime import datetime, date
    today = date.today().strftime('%Y-%m-%d')
    
    with DatabasePool.get_connection() as conn:
        project = conn.execute('SELECT project_name, hospital_name FROM projects WHERE id = ?', 
                              (project_id,)).fetchone()
        
        # 今日所有日志
        logs = conn.execute('''
            SELECT member_name, work_content, issues_encountered, tomorrow_plan 
            FROM work_logs WHERE project_id = ? AND log_date = ?
        ''', (project_id, today)).fetchall()
        
        # 今日新增/解决的问题
        new_issues = conn.execute('''
            SELECT description, severity FROM issues 
            WHERE project_id = ? AND date(created_at) = ?
        ''', (project_id, today)).fetchall()
        
        resolved_issues = conn.execute('''
            SELECT description FROM issues 
            WHERE project_id = ? AND date(resolved_at) = ?
        ''', (project_id, today)).fetchall()
        
        # 今日沟通记录
        comms = conn.execute('''
            SELECT contact_person, summary FROM customer_communications 
            WHERE project_id = ? AND contact_date = ?
        ''', (project_id, today)).fetchall()
    
    if not logs:
        return api_response(True, data={'report': '今日暂无工作日志记录，请先提交日志。'})
    
    p = dict(project)
    system_prompt = """你是项目经理助手。根据今日工作数据生成一份**简洁专业的每日工作简报**。
要求：
- 适合直接发给甲方信息科负责人看
- 分为：今日完成、进行中、阻塞项、明日计划 四个板块
- 语气专业但不啰嗦
- Markdown 格式"""

    logs_text = "\n".join([
        f"- {dict(l)['member_name']}: {dict(l)['work_content'] or ''} | 问题: {dict(l)['issues_encountered'] or '无'} | 明日: {dict(l)['tomorrow_plan'] or ''}"
        for l in logs
    ])
    
    user_content = f"""项目：{p['project_name']} ({p['hospital_name']})
日期：{today}

今日工作记录：
{logs_text}

今日新增问题：{', '.join([dict(i)['description'] for i in new_issues]) or '无'}
今日解决问题：{', '.join([dict(i)['description'] for i in resolved_issues]) or '无'}
今日沟通：{', '.join([f"{dict(c)['contact_person']}: {dict(c)['summary'][:50]}" for c in comms]) or '无'}"""

    report = ai_service.call_ai_api(system_prompt, user_content, task_type="report")
    
    return api_response(True, data={'report': report, 'date': today})
@mobile_bp.route('/api/project/acceptance-check/<int:project_id>', methods=['GET'])
def acceptance_readiness(project_id):
    """验收准备度自动检查"""
    with DatabasePool.get_connection() as conn:
        # 任务完成率
        total_tasks = conn.execute(
            'SELECT COUNT(*) FROM tasks t JOIN project_stages s ON t.stage_id=s.id WHERE s.project_id=?', 
            (project_id,)).fetchone()[0]
        done_tasks = conn.execute(
            'SELECT COUNT(*) FROM tasks t JOIN project_stages s ON t.stage_id=s.id WHERE s.project_id=? AND t.is_completed=1', 
            (project_id,)).fetchone()[0]
        
        # 接口完成情况
        interfaces = conn.execute(
            'SELECT system_name, interface_name, status FROM interfaces WHERE project_id=?', 
            (project_id,)).fetchall()
        
        # 未解决问题
        open_issues = conn.execute(
            'SELECT description, severity FROM issues WHERE project_id=? AND status!="已解决"', 
            (project_id,)).fetchall()
        
        # 培训记录（检查是否有培训日志）
        training_logs = conn.execute('''
            SELECT COUNT(*) FROM work_logs 
            WHERE project_id=? AND (work_content LIKE '%培训%' OR work_content LIKE '%training%')
        ''', (project_id,)).fetchone()[0]
        
        # 文档
        docs = conn.execute(
            'SELECT doc_name, doc_category FROM project_documents WHERE project_id=?', 
            (project_id,)).fetchall()
    
    checklist = []
    score = 0
    
    # 1. 任务完成
    task_rate = (done_tasks / total_tasks * 100) if total_tasks > 0 else 0
    checklist.append({
        'item': '任务完成率', 
        'status': '✅' if task_rate >= 95 else '⚠️' if task_rate >= 80 else '❌',
        'detail': f'{done_tasks}/{total_tasks} ({task_rate:.0f}%)'
    })
    if task_rate >= 95: score += 25
    elif task_rate >= 80: score += 15
    
    # 2. 接口完成
    iface_done = sum(1 for i in interfaces if dict(i)['status'] == '已完成')
    iface_total = len(interfaces)
    checklist.append({
        'item': '接口对接', 
        'status': '✅' if iface_done == iface_total else '❌',
        'detail': f'{iface_done}/{iface_total}',
        'blocking': [f"{dict(i)['system_name']}-{dict(i)['interface_name']}" 
                     for i in interfaces if dict(i)['status'] != '已完成']
    })
    if iface_done == iface_total: score += 25
    
    # 3. 问题清零
    high_issues = [dict(i) for i in open_issues if dict(i)['severity'] == '高']
    checklist.append({
        'item': '问题清零', 
        'status': '✅' if not open_issues else '❌' if high_issues else '⚠️',
        'detail': f'未解决 {len(open_issues)} 个（高危 {len(high_issues)} 个）'
    })
    if not open_issues: score += 25
    elif not high_issues: score += 10
    
    # 4. 培训完成
    checklist.append({
        'item': '用户培训', 
        'status': '✅' if training_logs >= 2 else '⚠️' if training_logs >= 1 else '❌',
        'detail': f'已记录 {training_logs} 次培训'
    })
    if training_logs >= 2: score += 15
    
    # 5. 文档齐全
    checklist.append({
        'item': '交付文档', 
        'status': '✅' if len(docs) >= 3 else '⚠️',
        'detail': f'已上传 {len(docs)} 份文档'
    })
    if len(docs) >= 3: score += 10
    
    return api_response(True, data={
        'readiness_score': score,
        'checklist': checklist,
        'can_accept': score >= 80,
        'summary': f'验收准备度 {score}%' + ('，建议启动验收流程' if score >= 80 else '，仍有关键阻塞项需处理')
    })
# 页面路由补充
@mobile_bp.route('/briefing/<int:project_id>')
def briefing_page(project_id):
    return render_template('mobile/briefing.html', project_id=project_id)

@mobile_bp.route('/quick-log')
def quick_log_page():
    return render_template('mobile/quick_log.html')

@mobile_bp.route('/meeting-note')
def meeting_note_page():
    return render_template('mobile/meeting_note.html')

@mobile_bp.route('/daily-report/<int:project_id>')
def daily_report_page(project_id):
    return render_template('mobile/daily_report.html', project_id=project_id)

@mobile_bp.route('/acceptance/<int:project_id>')
def acceptance_page(project_id):
    return render_template('mobile/acceptance.html', project_id=project_id)
