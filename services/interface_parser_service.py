"""
接口文档结构化解析服务
将 PDF/Word 接口文档通过 AI 解析为结构化的接口元数据，存入 interface_specs + interface_spec_fields。
"""
import re
import json
import logging
import hashlib
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from database import DatabasePool
from services.ai_service import ai_service

logger = logging.getLogger(__name__)


class InterfaceParserService:
    CHUNK_TIMEOUT_SECONDS = 90
    MAX_WORKERS = 2
    CACHE_VERSION = "vendor-fast-v1"

    # ===== 我方已知的标准 transcode（用于辅助识别和校验）=====
    OUR_KNOWN_TRANSCODES = {
        # 重症系统
        'VI_ICU_ZYBR', 'VI_ICU_PATOPER', 'VI_ICU_ZYYZ', 'VI_ICU_HSZ_YZZXJL',
        'VI_ICU_YPXX', 'VI_ICU_YWYF', 'VI_ICU_YYPC', 'VI_ICU_KSXX', 'VI_ICU_ZGXX',
        'vi_icu_hydxx', 'vi_icu_hydjg', 'vi_icu_report', 'MET_COM_ICD10',
        # 手麻系统
        'VI_ANES_DRUG_DICTIONARY', 'VI_ANES_STAFFINFO', 'VI_ANES_DEPTINFO',
        'VI_ANES_OPERAPPLYINFO', 'VI_ANES_PATIENTINFO', 'VI_ANES_EXAMITEM',
        'VI_ANES_EXAMITEM_DETAIL', 'VI_ANES_REPORT', 'VI_ANES_SSBM',
        'VI_ANES_YWYF', 'V_SSMZ_MZFS',
    }

    def parse_document_with_ai(self, doc_text: str, spec_source: str,
                                vendor_name: str = None) -> list:
        """
        用 AI 将文档全文解析为结构化接口定义列表。
        使用线程池并行处理分段，显著提升大文档解析速度。
        """
        local_parsed = self._parse_document_locally(doc_text, spec_source, vendor_name)
        if local_parsed:
            logger.info("本地快速解析命中，共提取 %s 个接口定义", len(local_parsed))
            return local_parsed

        chunks = self._split_by_interface_section(doc_text)
        all_interfaces = []

        if not chunks:
            return []

        logger.info(f"开始并行解析文档，共 {len(chunks)} 个分段")
        
        # 接口解析是重 AI 调用，限制并发避免端点失败时形成长时间重试风暴。
        with ThreadPoolExecutor(max_workers=self.MAX_WORKERS) as executor:
            # 提交任务
            future_to_chunk = {
                executor.submit(self._parse_single_chunk, chunk, spec_source, vendor_name): i 
                for i, chunk in enumerate(chunks)
            }
            
            # 收集结果
            results = [None] * len(chunks)
            import concurrent.futures
            for future in concurrent.futures.as_completed(future_to_chunk):
                chunk_index = future_to_chunk[future]
                try:
                    parsed_result = future.result(timeout=self.CHUNK_TIMEOUT_SECONDS)
                    if parsed_result:
                        results[chunk_index] = parsed_result
                except TimeoutError:
                    logger.error("分段 %s 解析超时", chunk_index)
                except Exception as e:
                    logger.error(f"分段 {chunk_index} 解析异常: {e}")

            # 合并结果
            for res in results:
                if res:
                    all_interfaces.extend(res)

        if not all_interfaces:
            logger.warning("文档解析完成，但未提取到接口定义。可能是 AI 端点不可用或文档格式未识别。")
        else:
            logger.info(f"文档解析完成，共提取 {len(all_interfaces)} 个接口定义")
        return all_interfaces

    def get_cached_parse(self, project_id, doc_text: str, spec_source: str, vendor_name: str = None, category: str = None):
        """Return existing parsed specs for the same document fingerprint."""
        fingerprint = self.document_fingerprint(doc_text, spec_source, vendor_name, category)
        with DatabasePool.get_connection() as conn:
            rows = conn.execute(DatabasePool.format_sql('''
                SELECT id, interface_name, transcode, system_type
                FROM interface_specs
                WHERE project_id = ?
                  AND spec_source = ?
                  AND COALESCE(category, '') = COALESCE(?, '')
                  AND raw_text = ?
                ORDER BY id
            '''), (project_id, spec_source, category, fingerprint)).fetchall()
        return [dict(row) for row in rows]

    def document_fingerprint(self, doc_text: str, spec_source: str, vendor_name: str = None, category: str = None) -> str:
        normalized = re.sub(r'\s+', ' ', doc_text or '').strip()
        digest = hashlib.sha1(normalized.encode('utf-8')).hexdigest()
        return f"parse-cache:{self.CACHE_VERSION}:{spec_source}:{category or ''}:{vendor_name or ''}:{digest}"

    def _parse_document_locally(self, doc_text: str, spec_source: str, vendor_name: str = None) -> list:
        """Fast deterministic parser for obvious XML/JSON/interface-table documents."""
        text = (doc_text or '').strip()
        if not text:
            return []

        interfaces = []
        for chunk in self._split_by_interface_section(text):
            parsed = self._parse_chunk_locally(chunk, spec_source, vendor_name)
            if parsed:
                interfaces.append(parsed)

        # Only trust the fast path when it found meaningful fields.
        return [item for item in interfaces if item.get('fields')]

    def _parse_chunk_locally(self, chunk: str, spec_source: str, vendor_name: str = None):
        title = self._guess_interface_title(chunk)
        transcode = self._guess_transcode(chunk)
        fields = self._extract_fields_locally(chunk)
        if not fields:
            return None
        request_sample = self._extract_sample(chunk, ('请求', '入参', 'request', 'Request'))
        response_sample = self._extract_sample(chunk, ('返回', '响应', '出参', 'response', 'Response'))
        return {
            'interface_name': title or transcode or '接口定义',
            'transcode': transcode or '',
            'system_type': '第三方' if spec_source == 'vendor' else '手麻/重症',
            'protocol': self._guess_protocol(chunk),
            'description': title or '',
            'endpoint_url': self._guess_endpoint(chunk),
            'action_name': '',
            'view_name': self._guess_view_name(chunk),
            'data_direction': 'pull',
            'request_sample': request_sample,
            'response_sample': response_sample,
            'fields': fields,
        }

    def _guess_interface_title(self, chunk: str) -> str:
        for line in chunk.splitlines()[:8]:
            clean = line.strip().strip('#').strip()
            clean = re.sub(r'^\d+([\.、]\d+)*[\.、]?\s*', '', clean)
            if 2 <= len(clean) <= 40 and re.search(r'接口|信息|字典|医嘱|病人|患者|报告|申请|结果', clean):
                return clean
        return ''

    def _guess_transcode(self, chunk: str) -> str:
        patterns = [
            r'<transcode>\s*([A-Za-z0-9_./-]+)\s*</transcode>',
            r'\b(VI_[A-Z0-9_]+)\b',
            r'\b([A-Z][A-Z0-9_]{4,})\b',
        ]
        for pattern in patterns:
            match = re.search(pattern, chunk, flags=re.IGNORECASE)
            if match:
                return match.group(1).strip()
        return ''

    def _guess_protocol(self, chunk: str) -> str:
        lower = chunk.lower()
        if '<soap' in lower or 'webservice' in lower or 'web service' in lower:
            return 'WebService'
        if 'hl7' in lower or 'msh|' in lower:
            return 'HL7'
        if 'http://' in lower or 'https://' in lower or 'rest' in lower:
            return 'RESTful'
        if re.search(r'\b(v_|view)\w+', chunk, flags=re.IGNORECASE):
            return 'View'
        if '<' in chunk and '>' in chunk:
            return 'XML'
        if '{' in chunk and '}' in chunk:
            return 'JSON'
        return ''

    def _guess_endpoint(self, chunk: str) -> str:
        match = re.search(r'https?://[^\s\'"<>]+', chunk)
        return match.group(0) if match else ''

    def _guess_view_name(self, chunk: str) -> str:
        match = re.search(r'\b(V_[A-Za-z0-9_]+)\b', chunk)
        return match.group(1) if match else ''

    def _extract_sample(self, chunk: str, labels) -> str:
        lines = chunk.splitlines()
        for idx, line in enumerate(lines):
            if any(label.lower() in line.lower() for label in labels):
                sample = '\n'.join(lines[idx:idx + 40]).strip()
                return sample[:2000]
        return ''

    def _extract_fields_locally(self, chunk: str) -> list:
        fields = []
        seen = set()

        for name in re.findall(r'<([A-Za-z_][A-Za-z0-9_]*)>(?:[^<]{0,80})</\1>', chunk):
            if name.lower() in {'xml', 'body', 'request', 'response', 'data', 'rows', 'row'}:
                continue
            self._append_local_field(fields, seen, name, '', '', '', '')

        table_like = re.split(r'\n+', chunk)
        for line in table_like:
            parts = [p.strip() for p in re.split(r'\t+|\s{2,}|\|', line.strip()) if p.strip()]
            if len(parts) < 2:
                continue
            name = parts[0]
            if not re.match(r'^[A-Za-z_][A-Za-z0-9_]{1,40}$', name):
                continue
            cn = parts[1] if len(parts) > 1 and re.search(r'[\u4e00-\u9fff]', parts[1]) else ''
            field_type = next((p for p in parts[1:4] if re.search(r'varchar|char|int|date|time|number|float|decimal|C|N|D', p, re.I)), '')
            desc = parts[-1] if len(parts) > 2 else ''
            required = any('必填' in p or '非空' in p or '是' == p for p in parts)
            self._append_local_field(fields, seen, name, cn, field_type, desc, '', required)

        return fields[:300]

    def _append_local_field(self, fields, seen, name, cn='', field_type='', desc='', sample='', required=False):
        key = name.lower()
        if key in seen:
            return
        seen.add(key)
        fields.append({
            'field_name': name,
            'field_name_cn': cn,
            'field_type': field_type or 'varchar',
            'field_length': '',
            'is_required': bool(required),
            'is_primary_key': key in {'id', 'pid', 'patient_id', 'mrn', 'zyh'},
            'description': desc or cn,
            'remark': '',
            'sample_value': sample,
        })

    def _split_by_interface_section(self, text: str) -> list:
        """
        按接口段落智能切分文档。
        识别方式：找标题行（如 "1、病人信息表" 或 "4.1.1 药物字典"）做切分点。
        """
        # 常见的接口段落标题模式
        patterns = [
            r'(?=\d+[、\.]\s*[\u4e00-\u9fff])',  # "1、病人信息" 或 "1.病人信息"
            r'(?=\d+\.\d+\.\d+\s)',                # "4.1.1 药物字典"
            r'(?=#{1,3}\s*\d)',                     # Markdown 标题
        ]
        
        # 尝试各种模式切分
        for pattern in patterns:
            sections = re.split(pattern, text)
            sections = [s.strip() for s in sections if len(s.strip()) > 100]
            if len(sections) >= 2:
                # 如果单个 section 还是太长，进一步按 12000 字符切
                result = []
                for sec in sections:
                    if len(sec) > 14000:
                        for i in range(0, len(sec), 12000):
                            result.append(sec[i:i+12000])
                    else:
                        result.append(sec)
                return result

        # 兜底：按固定长度切
        return [text[i:i+12000] for i in range(0, len(text), 12000)]

    def _parse_single_chunk(self, chunk: str, spec_source: str,
                             vendor_name: str = None) -> list:
        """用 AI 解析单段文档"""
        source_label = '我方标准' if spec_source == 'our_standard' else f'对方厂商({vendor_name or "未知"})'

        system_prompt = """你是一名资深医疗信息化系统集成工程师，专精于 HIS/LIS/PACS/ICU/手术麻醉 系统接口对接（支持 WebService, HL7, RESTful, 数据库视图, 存储过程等）。

任务：从接口文档片段中精确提取每个接口的结构化定义。无论文档描述的是 JSON、XML、HL7 还是其他私有协议，请统一提取其业务字段并转换为以下格式。

严格按以下 JSON 格式输出，不要添加多余文字，直接输出 JSON 数组：

```json
[
  {
    "interface_name": "接口中文名称",
    "transcode": "核心标识（如交易码、Action名、HL7消息类型、视图名等）",
    "system_type": "HIS/LIS/PACS/EMR/手麻/第三方",
    "protocol": "WebService/HL7/RESTful/View/存储过程",
    "description": "接口描述",
    "endpoint_url": "访问地址（如有）",
    "action_name": "服务名/方法名（如有）",
    "view_name": "数据库视图/表名（如有）",
    "data_direction": "pull/push/writeback",
    "request_sample": "入参样例（如有，前2000字符）",
    "response_sample": "出参样例（如有，前2000字符）",
    "fields": [
      {
        "field_name": "英文字段名（若文档只有中文则使用拼音或英文翻译）",
        "field_name_cn": "中文字段名",
        "field_type": "数据类型（varchar/int/dateTime/float/C/N/D等）",
        "field_length": "长度（如有）",
        "is_required": true或false,
        "is_primary_key": true或false,
        "description": "说明",
        "remark": "备注（含枚举值、日期格式如yyyy-MM-dd等）",
        "sample_value": "示例值"
      }
    ]
  }
]
```

要求：
1. 精确提取：识别所有接口段落，不要遗漏。
2. 跨协议识别：即使是 XML 或 HL7 节点，也请映射到 `field_name` 和 `field_name_cn`。
3. 必填项判定：关键字“必填”、“非空”、“强制”或加粗/红色标注。
4. **特别要求**：如果接口包含 XML 或 JSON 样例（request_sample/response_sample），请务必对样例内容进行转义（如换行符使用 \\n，引号使用 \\"），确保整个返回结果是一个合法的 JSON 字符串。
5. 若文档片段无接口定义，返回空数组 []。"""

        user_content = f"""文档来源: {source_label}
---文档内容--- {chunk} ---文档结束---

请提取所有接口定义，输出 JSON 数组。"""

        result = ai_service.call_ai_api(system_prompt, user_content, task_type="code")

        if not result:
            raise RuntimeError("AI 服务暂时不可用：所有已配置模型均未返回有效内容，请检查 AI 配置或稍后重试。")

        if result:
            if result.strip().startswith('AI服务暂时不可用'):
                raise RuntimeError(result.strip())
            # 1. 提取最外层的 JSON 数组
            json_match = re.search(r'\[[\s\S]*\]', result)
            if json_match:
                json_str = json_match.group()
                
                # 尝试解析
                try:
                    return json.loads(json_str)
                except json.JSONDecodeError:
                    logger.warning("首轮解析失败，开始深度修复...")
                    
                # 2. 深度修复：处理 AI 常见的未转义换行符和引号问题
                # 处理样例字段中的未转义换行
                def fix_unescaped_newlines(match):
                    key = match.group(1)
                    val = match.group(2)
                    # 将值中的字面换行替换为 \n
                    fixed_val = val.replace('\n', '\\n').replace('\r', '\\r')
                    return f'"{key}": "{fixed_val}"'

                # 针对常见的样例字段进行正则修复
                sample_keys = ['request_sample', 'response_sample', 'description', 'remark']
                pattern = rf'"({"|".join(sample_keys)})"\s*:\s*"([\s\S]*?)"(?=\s*[,}}])'
                
                fixed_json = re.sub(pattern, fix_unescaped_newlines, json_str)
                
                # 3. 补齐截断的 JSON
                if fixed_json.count('[') > fixed_json.count(']'):
                    last_obj_end = fixed_json.rfind('}')
                    if last_obj_end != -1:
                        fixed_json = fixed_json[:last_obj_end+1] + ']'
                
                # 4. 移除尾随逗号
                fixed_json = re.sub(r',\s*\]', ']', fixed_json)
                fixed_json = re.sub(r',\s*}', '}', fixed_json)

                try:
                    parsed = json.loads(fixed_json)
                    if isinstance(parsed, list):
                        return parsed
                except Exception as e:
                    logger.error(f"深度修复依然失败: {e}\n原始内容片段: {result[:500]}...")
        return []

    def save_parsed_specs(self, project_id, doc_id, parsed_interfaces: list,
                               spec_source: str, vendor_name: str = None, category: str = None, raw_text: str = None) -> list:
        """
        持久化解析结果到数据库，返回创建的 spec_id 列表。
        使用单一连接和事务，大幅提升大量数据保存性能。
        """
        created_ids = []
        
        with DatabasePool.get_connection() as conn:
            if project_id and raw_text and not doc_id:
                # 自动存入项目文档库
                doc_title = f"{category or '接口文档'}_{vendor_name or '解析内容'}"
                doc_sql = '''
                    INSERT INTO project_documents (project_id, doc_name, doc_type, doc_category, remark)
                    VALUES (?, ?, 'txt', '接口对接', ?)
                '''
                if DatabasePool.is_postgres():
                    doc_sql += ' RETURNING id'
                cursor = conn.execute(DatabasePool.format_sql(doc_sql), (project_id, doc_title, f"AI解析自: {vendor_name or '未知'}"))
                doc_id = DatabasePool.get_inserted_id(cursor)

            for iface in parsed_interfaces:
                spec_sql = '''
                    INSERT INTO interface_specs
                    (project_id, doc_id, spec_source, category, vendor_name, system_type,
                     interface_name, transcode, protocol, description,
                     request_sample, response_sample, endpoint_url,
                     action_name, view_name, data_direction, raw_text)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                '''
                if DatabasePool.is_postgres():
                    spec_sql += ' RETURNING id'
                cursor = conn.execute(DatabasePool.format_sql(spec_sql), (
                    project_id, doc_id, spec_source, category, vendor_name,
                    iface.get('system_type', ''),
                    iface.get('interface_name', ''),
                    iface.get('transcode', ''),
                    iface.get('protocol', ''),
                    iface.get('description', ''),
                    (iface.get('request_sample') or '')[:2000],
                    (iface.get('response_sample') or '')[:2000],
                    iface.get('endpoint_url', ''),
                    iface.get('action_name', ''),
                    iface.get('view_name', ''),
                    iface.get('data_direction', 'pull'),
                    raw_text
                ))
                spec_id = DatabasePool.get_inserted_id(cursor)
                created_ids.append(spec_id)

                for idx, field in enumerate(iface.get('fields', [])):
                    conn.execute(DatabasePool.format_sql('''
                        INSERT INTO interface_spec_fields
                        (spec_id, field_name, field_name_cn, field_type, field_length,
                         is_required, is_primary_key, description, remark,
                         sample_value, field_order)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    '''), (
                        spec_id,
                        field.get('field_name', ''),
                        field.get('field_name_cn', ''),
                        field.get('field_type', 'varchar'),
                        str(field.get('field_length', '')),
                        1 if field.get('is_required') else 0,
                        1 if field.get('is_primary_key') else 0,
                        field.get('description', ''),
                        field.get('remark', ''),
                        field.get('sample_value', ''),
                        idx
                    ))
            conn.commit()
            
        logger.info(f"已保存 {len(created_ids)} 个接口规范到数据库")
        return created_ids

    def get_specs_by_project(self, project_id, spec_source=None, category=None):
        """获取项目的接口规范（含字段）"""
        with DatabasePool.get_connection() as conn:
            query = '''SELECT * FROM interface_specs 
                       WHERE (project_id = ? OR project_id IS NULL)'''
            params = [project_id]
            if spec_source:
                if spec_source == 'our_standard':
                    query += " AND spec_source IN ('our_standard', 'our', 'standard')"
                else:
                    query += ' AND spec_source = ?'
                    params.append(spec_source)
            if category:
                query += ' AND category = ?'
                params.append(category)
            query += ' ORDER BY system_type, interface_name'

            specs = conn.execute(DatabasePool.format_sql(query), params).fetchall()
            result = []
            for s in specs:
                spec = dict(s)
                fields = conn.execute(
                    DatabasePool.format_sql('SELECT * FROM interface_spec_fields WHERE spec_id = ? ORDER BY field_order'),
                    (spec['id'],)
                ).fetchall()
                spec['fields'] = [dict(f) for f in fields]
                spec['field_count'] = len(spec['fields'])
                result.append(spec)
        return result

    def delete_spec(self, spec_id):
        """删除一个接口规范及其所有字段"""
        with DatabasePool.get_connection() as conn:
            conn.execute(DatabasePool.format_sql('DELETE FROM interface_spec_fields WHERE spec_id = ?'), (spec_id,))
            conn.execute(DatabasePool.format_sql('DELETE FROM interface_specs WHERE id = ?'), (spec_id,))
            conn.commit()

interface_parser = InterfaceParserService()
