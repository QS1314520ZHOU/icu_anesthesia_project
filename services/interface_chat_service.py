"""
接口 AI 对话 + 请求生成服务
核心能力：
1. 基于项目接口对照上下文的智能问答
2. 自动生成可复制的接口请求内容（XML/JSON/SQL）
3. 字段映射查询、对接指导
"""
import json
import re
import logging
from database import DatabasePool
from services.ai_service import ai_service

logger = logging.getLogger(__name__)


class InterfaceChatService:

    def chat(self, project_id: int, message: str, category: str = '手麻标准') -> dict:
        """
        接口 AI 助手主入口。
        根据用户消息 + 项目接口上下文，返回 AI 回复。
        """
        # 1. 构建项目接口上下文
        context = self._build_context(project_id, category)

        # 2. 检测意图：是否是"生成请求"类指令
        intent = self._detect_intent(message)

        # 3. 根据意图构造不同的 prompt
        if intent == 'generate_request':
            return self._handle_generate_request(message, context, project_id)
        elif intent == 'field_query':
            return self._handle_field_query(message, context)
        elif intent == 'debug_help':
            return self._handle_debug_help(message, context)
        else:
            return self._handle_free_chat(message, context)

    def generate_request(self, project_id: int, comparison_id: int,
                         req_format: str = 'auto', params: dict = None) -> dict:
        """
        根据对照记录，生成完整的接口请求内容。
        """
        # 获取对照详情
        with DatabasePool.get_connection() as conn:
            comp = conn.execute('''
                SELECT ic.*, 
                       os.interface_name as our_name, os.transcode as our_transcode,
                       os.protocol as our_protocol, os.endpoint_url, os.action_name,
                       os.view_name as our_view, os.data_direction, os.request_sample,
                       os.response_sample,
                       vs.interface_name as vendor_name, vs.transcode as vendor_transcode,
                       vs.protocol as vendor_protocol, vs.view_name as vendor_view,
                       vs.endpoint_url as vendor_endpoint, vs.action_name as vendor_action
                FROM interface_comparisons ic
                LEFT JOIN interface_specs os ON ic.our_spec_id = os.id
                LEFT JOIN interface_specs vs ON ic.vendor_spec_id = vs.id
                WHERE ic.id = ? AND ic.project_id = ?
            ''', (comparison_id, project_id)).fetchone()

            if not comp:
                return {'answer': '未找到该对照记录', 'code_blocks': []}

            comp = dict(comp)

            # 获取字段映射
            mappings = [dict(m) for m in conn.execute('''
                SELECT fm.*,
                       of.field_name_cn as our_cn, of.field_type as our_type,
                       of.is_required as our_required, of.sample_value as our_sample,
                       of.remark as our_remark,
                       vf.field_name_cn as vendor_cn, vf.field_type as vendor_type,
                       vf.sample_value as vendor_sample, vf.remark as vendor_remark
                FROM field_mappings fm
                LEFT JOIN interface_spec_fields of ON fm.our_field_id = of.id
                LEFT JOIN interface_spec_fields vf ON fm.vendor_field_id = vf.id
                WHERE fm.comparison_id = ?
                ORDER BY fm.our_field_name
            ''', (comparison_id,)).fetchall()]

        # 自动检测格式
        if req_format == 'auto':
            protocol = (comp.get('vendor_protocol') or comp.get('our_protocol') or '').lower()
            if 'soap' in protocol or 'webservice' in protocol:
                req_format = 'xml'
            elif 'rest' in protocol or 'json' in protocol:
                req_format = 'json'
            elif 'view' in protocol or '存储过程' in protocol or 'sql' in protocol:
                req_format = 'sql'
            else:
                req_format = 'xml'  # 医疗系统默认 XML

        # 构建 AI prompt
        field_lines = []
        for m in mappings:
            if m.get('our_field_name') and m.get('vendor_field_name'):
                required = '必填' if m.get('our_required') else '可选'
                sample = m.get('vendor_sample') or m.get('our_sample') or ''
                field_lines.append(
                    f"  我方: {m['our_field_name']}({m.get('our_cn','')}) → "
                    f"对方: {m['vendor_field_name']}({m.get('vendor_cn','')}) "
                    f"[{m.get('our_type','')}→{m.get('vendor_type','')}] "
                    f"({required}) 示例值: {sample} "
                    f"备注: {m.get('our_remark','') or m.get('vendor_remark','')}"
                )
            elif m.get('our_field_name'):
                field_lines.append(
                    f"  我方: {m['our_field_name']}({m.get('our_cn','')}) → 对方缺失"
                )

        field_text = '\n'.join(field_lines) if field_lines else '无字段映射'

        system_prompt = """你是医疗信息系统接口对接专家。根据接口对照信息，生成可以直接复制使用的请求内容。

要求：
1. 生成的请求内容必须完整、可直接使用
2. 字段名使用【对方】的字段名（因为是请求对方的接口）
3. 每个字段旁边用 XML 注释或 JSON 注释标注中文含义
4. 必填字段填入合理的示例值，可选字段也填示例值但标注(可选)
5. 如果有日期字段，使用当前日期格式的示例
6. 如果有枚举值字段，在注释中列出可选值"""

        user_prompt = f"""请为以下接口生成 {req_format.upper()} 格式的请求内容：

## 接口信息
- 我方接口: {comp.get('our_name','')} ({comp.get('our_transcode','')})
- 对方接口: {comp.get('vendor_name','')} ({comp.get('vendor_transcode','')})
- 协议: {comp.get('vendor_protocol','') or comp.get('our_protocol','')}
- 地址: {comp.get('vendor_endpoint','') or comp.get('endpoint_url','') or '待确认'}
- Action: {comp.get('vendor_action','') or comp.get('action_name','') or ''}
- 视图: {comp.get('vendor_view','') or comp.get('our_view','') or ''}
- 数据方向: {comp.get('data_direction','pull')}

## 字段映射（我方→对方）
{field_text}

## 对方原始入参样例（如有）
{comp.get('request_sample','无')}

## 对方原始出参样例（如有）
{comp.get('response_sample','无')}

请生成：
1. 完整的请求 {req_format.upper()} 内容（可直接复制）
2. 简要的调用说明（URL、方法、Content-Type 等）
3. 预期返回格式说明"""

        if params:
            user_prompt += f"\n\n## 用户指定的参数值\n{json.dumps(params, ensure_ascii=False, indent=2)}"

        answer = ai_service.call_ai_api(system_prompt, user_prompt, task_type="code")

        if not answer:
            answer = "请求生成失败，AI 未返回结果。请稍后重试。"

        # 提取代码块
        code_blocks = self._extract_code_blocks(answer)

        return {
            'answer': answer,
            'code_blocks': code_blocks,
            'format': req_format,
            'interface_name': comp.get('our_name', ''),
            'vendor_name': comp.get('vendor_name', '')
        }

    # ========== 内部方法 ==========

    def _build_context(self, project_id: int, category: str) -> str:
        """构建项目接口上下文摘要，作为 AI 对话的背景信息"""
        lines = []

        with DatabasePool.get_connection() as conn:
            # 项目信息
            project = conn.execute(
                'SELECT project_name, hospital_name FROM projects WHERE id = ?',
                (project_id,)
            ).fetchone()
            if project:
                lines.append(f"项目: {project['project_name']} ({project['hospital_name']})")

            # 我方标准接口摘要
            our_specs = conn.execute('''
                SELECT id, interface_name, transcode, system_type, protocol, 
                       view_name, action_name, endpoint_url, data_direction, description
                FROM interface_specs
                WHERE (project_id = ? OR project_id IS NULL) 
                  AND spec_source = 'our_standard'
                  AND (category = ? OR category IS NULL)
                ORDER BY system_type
            ''', (project_id, category)).fetchall()

            if our_specs:
                lines.append(f"\n=== 我方标准接口 ({len(our_specs)} 个) ===")
                for s in our_specs:
                    s = dict(s)
                    lines.append(
                        f"- [{s.get('system_type','')}] {s['interface_name']} "
                        f"(transcode: {s.get('transcode','')}, "
                        f"protocol: {s.get('protocol','')}, "
                        f"view: {s.get('view_name','')}, "
                        f"action: {s.get('action_name','')})"
                    )

            # 对方接口摘要
            vendor_specs = conn.execute('''
                SELECT id, interface_name, transcode, system_type, protocol,
                       view_name, action_name, endpoint_url, vendor_name, description
                FROM interface_specs
                WHERE project_id = ? AND spec_source = 'vendor'
                ORDER BY system_type
            ''', (project_id,)).fetchall()

            if vendor_specs:
                lines.append(f"\n=== 对方接口 ({len(vendor_specs)} 个) ===")
                for s in vendor_specs:
                    s = dict(s)
                    lines.append(
                        f"- [{s.get('system_type','')}] {s['interface_name']} "
                        f"(transcode: {s.get('transcode','')}, "
                        f"protocol: {s.get('protocol','')}, "
                        f"vendor: {s.get('vendor_name','')}, "
                        f"endpoint: {s.get('endpoint_url','')})"
                    )

            # 对照结果摘要
            comparisons = conn.execute('''
                SELECT ic.id, ic.gap_count, ic.transform_count, ic.match_confidence,
                       os.interface_name as our_name, os.transcode as our_transcode,
                       vs.interface_name as vendor_name, vs.transcode as vendor_transcode
                FROM interface_comparisons ic
                LEFT JOIN interface_specs os ON ic.our_spec_id = os.id
                LEFT JOIN interface_specs vs ON ic.vendor_spec_id = vs.id
                WHERE ic.project_id = ? AND (ic.category = ? OR ic.category IS NULL)
            ''', (project_id, category)).fetchall()

            if comparisons:
                lines.append(f"\n=== 对照结果 ({len(comparisons)} 对) ===")
                for c in comparisons:
                    c = dict(c)
                    status = '✅' if c['gap_count'] == 0 and c['transform_count'] == 0 else '⚠️'
                    vendor_info = c.get('vendor_name', '❌缺失')
                    lines.append(
                        f"- {status} {c.get('our_name','')}({c.get('our_transcode','')}) "
                        f"↔ {vendor_info}({c.get('vendor_transcode','')}) "
                        f"[差异:{c['gap_count']}, 转换:{c['transform_count']}, "
                        f"置信度:{c.get('match_confidence',0):.0%}]"
                    )

                    # 对有差异的接口，加载字段映射摘要
                    if c['gap_count'] > 0 or c['transform_count'] > 0:
                        field_maps = conn.execute('''
                            SELECT our_field_name, vendor_field_name, mapping_status, transform_rule
                            FROM field_mappings
                            WHERE comparison_id = ? AND mapping_status != 'matched'
                            LIMIT 10
                        ''', (c['id'],)).fetchall()
                        for fm in field_maps:
                            fm = dict(fm)
                            lines.append(
                                f"    {fm['mapping_status']}: "
                                f"{fm.get('our_field_name','?')} → {fm.get('vendor_field_name','?')} "
                                f"{fm.get('transform_rule','') or ''}"
                            )

        return '\n'.join(lines)

    def _detect_intent(self, message: str) -> str:
        """简单的意图检测"""
        msg = message.lower()

        # 生成请求
        gen_keywords = ['生成请求', '生成xml', '生成json', '生成sql', '请求内容',
                        '调用', '怎么请求', '怎么调用', '请求报文', '入参',
                        'soap', 'request', '报文', '请求体', '请求示例',
                        '复制', '直接用']
        if any(k in msg for k in gen_keywords):
            return 'generate_request'

        # 字段查询
        field_keywords = ['字段', '映射', '对应', '哪个字段', '字段名', '字段类型',
                          '必填', '主键', '对照']
        if any(k in msg for k in field_keywords):
            return 'field_query'

        # 排错
        debug_keywords = ['报错', '错误', '失败', '异常', '超时', '500', '404',
                          '返回为空', '乱码', '格式不对', '排查', '问题']
        if any(k in msg for k in debug_keywords):
            return 'debug_help'

        return 'free_chat'

    def _handle_generate_request(self, message: str, context: str, project_id: int) -> dict:
        """处理"生成请求"意图"""
        system_prompt = f"""你是医疗信息系统接口对接专家，正在协助工程师生成接口请求内容。

以下是当前项目的接口对照上下文：
{context}

用户需要生成接口请求。请根据上下文中的接口信息和字段映射：
1. 识别用户想要请求的接口
2. 确定请求格式（通常 WebService 用 SOAP XML，RESTful 用 JSON，数据库视图用 SQL）
3. 生成完整的、可直接复制使用的请求内容
4. 每个字段旁标注中文名和说明
5. 必填字段填合理的示例值
6. 如果信息不足，明确告诉用户还需要什么

输出格式：
- 先简要说明接口基本信息
- 然后输出请求代码块（用 ```xml 或 ```json 或 ```sql 包裹）
- 最后给出调用注意事项"""

        answer = ai_service.call_ai_api(system_prompt, message, task_type="code")
        if not answer:
            answer = "抱歉，请求生成失败。请确认已上传对方接口文档并完成对照。"

        code_blocks = self._extract_code_blocks(answer)

        return {
            'answer': answer,
            'code_blocks': code_blocks,
            'intent': 'generate_request'
        }

    def _handle_field_query(self, message: str, context: str) -> dict:
        """处理"字段查询"意图"""
        system_prompt = f"""你是医疗信息系统接口字段映射专家。

以下是当前项目的接口对照上下文：
{context}

用户想查询字段映射信息。请：
1. 准确找到用户询问的接口或字段
2. 列出完整的字段对应关系
3. 标注字段类型、是否必填、转换规则
4. 如有差异或缺失，明确指出

用表格形式展示字段映射，清晰易读。"""

        answer = ai_service.call_ai_api(system_prompt, message, task_type="analysis")
        if not answer:
            answer = "抱歉，字段查询失败。请确认已完成接口对照。"

        return {'answer': answer, 'intent': 'field_query'}

    def _handle_debug_help(self, message: str, context: str) -> dict:
        """处理"排错"意图"""
        system_prompt = f"""你是医疗信息系统接口调试专家，擅长排查 HIS/LIS/PACS/手麻/ICU 系统的接口对接问题。

以下是当前项目的接口对照上下文：
{context}

用户遇到了接口问题。请：
1. 分析可能的原因（字段名不匹配、类型不对、日期格式、编码问题、必填字段缺失等）
2. 给出具体的排查步骤
3. 如果能定位到具体接口/字段，给出修正建议
4. 提供常见的医疗接口对接踩坑经验"""

        answer = ai_service.call_ai_api(system_prompt, message, task_type="analysis")
        if not answer:
            answer = "抱歉，分析失败。请描述更多错误细节（如错误码、返回内容等）。"

        return {'answer': answer, 'intent': 'debug_help'}

    def _handle_free_chat(self, message: str, context: str) -> dict:
        """处理自由问答"""
        system_prompt = f"""你是医疗信息系统接口对接助手，正在帮助工程师进行 ICU/手麻系统的接口对接工作。

以下是当前项目的接口对照上下文：
{context}

请根据上下文回答用户的问题。如果用户的问题可以结合项目的实际接口数据来回答，优先使用项目数据。
回答要专业、准确、简洁。

你可以做的事情：
- 生成接口请求内容（XML/JSON/SQL）
- 查询字段映射关系
- 排查接口对接问题
- 对接方案建议
- 接口文档解读

如果用户的提问不够明确，可以引导他提供更多信息。"""

        answer = ai_service.call_ai_api(system_prompt, message, task_type="chat")
        if not answer:
            answer = "抱歉，AI 暂时无法响应。请稍后重试，或检查 AI 配置是否正常。"

        code_blocks = self._extract_code_blocks(answer)

        return {
            'answer': answer,
            'code_blocks': code_blocks if code_blocks else None,
            'intent': 'free_chat'
        }

    def _extract_code_blocks(self, text: str) -> list:
        """从 AI 回复中提取代码块"""
        if not text:
            return []

        blocks = []
        pattern = r'```(\w*)\n([\s\S]*?)```'
        for match in re.finditer(pattern, text):
            lang = match.group(1) or 'text'
            code = match.group(2).strip()
            if code:
                blocks.append({
                    'language': lang,
                    'code': code
                })
        return blocks


interface_chat_service = InterfaceChatService()
