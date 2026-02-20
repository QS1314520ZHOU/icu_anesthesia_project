"""
接口文档结构化解析服务
将 PDF/Word 接口文档通过 AI 解析为结构化的接口元数据，存入 interface_specs + interface_spec_fields。
"""
import re
import json
import logging
from database import DatabasePool
from services.ai_service import ai_service

logger = logging.getLogger(__name__)


class InterfaceParserService:

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
        对于大文档，会自动分段解析后合并。
        """
        # 大文档分段（每段约 12000 字符，留余量给 prompt）
        chunks = self._split_by_interface_section(doc_text)
        all_interfaces = []

        for chunk in chunks:
            parsed = self._parse_single_chunk(chunk, spec_source, vendor_name)
            if parsed:
                all_interfaces.extend(parsed)

        logger.info(f"文档解析完成，共提取 {len(all_interfaces)} 个接口定义")
        return all_interfaces

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

        system_prompt = """你是一名资深医疗信息化系统集成工程师，专精于 HIS/LIS/PACS/ICU/手术麻醉 系统接口对接。

任务：从接口文档片段中精确提取每个接口的结构化定义。

严格按以下 JSON 格式输出，不要添加多余文字，直接输出 JSON 数组：

```json
[
  {
    "interface_name": "接口中文名称",
    "transcode": "交易码或action名（如 VI_ICU_ZYBR）",
    "system_type": "HIS/LIS/PACS/EMR/手麻",
    "protocol": "WebService/HL7/RESTful/View/存储过程",
    "description": "接口功能一句话描述",
    "endpoint_url": "WebService地址（如有）",
    "action_name": "action服务名（如有）",
    "view_name": "数据库视图名（如有，如 SSMZ.V_SSMZ_YPZD）",
    "data_direction": "pull/push/writeback",
    "request_sample": "入参XML样例前200字符（如有）",
    "response_sample": "出参XML样例前200字符（如有）",
    "fields": [
      {
        "field_name": "英文字段名",
        "field_name_cn": "中文字段名",
        "field_type": "varchar/dateTime/int/float/C/N/D",
        "field_length": "长度（如20、100）",
        "is_required": true或false,
        "is_primary_key": true或false,
        "description": "字段说明",
        "remark": "备注（包括枚举值、格式要求等）",
        "sample_value": "示例值（如有）"
      }
    ]
  }
]
```

要求：
1. 每个独立接口提取为一个对象，不要遗漏
2. 必填性要准确：标注"必填"、"非空"、红色字体的字段 is_required=true
3. 主键字段标注 is_primary_key=true
4. 日期格式说明保留在 remark 中（如 yyyy-MM-dd HH:mm:ss）
5. 字段的枚举值/状态码放在 remark 中
6. 如果文档片段中没有完整的接口定义，返回空数组 []"""

        user_content = f"""文档来源: {source_label}
---文档内容--- {chunk} ---文档结束---

请提取所有接口定义，输出 JSON 数组。"""

        result = ai_service.call_ai_api(system_prompt, user_content, task_type="code")

        if result:
            # 从 AI 响应中提取 JSON
            json_match = re.search(r'\[[\s\S]*\]', result)
            if json_match:
                try:
                    parsed = json.loads(json_match.group())
                    if isinstance(parsed, list):
                        return parsed
                except json.JSONDecodeError as e:
                    logger.warning(f"JSON解析失败: {e}")
        return []

    def save_parsed_specs(self, project_id, doc_id, parsed_interfaces: list,
                           spec_source: str, vendor_name: str = None, category: str = None) -> list:
        """
        持久化解析结果到数据库，返回创建的 spec_id 列表。
        project_id 为 None 时表示全局标准模板。
        """
        created_ids = []
        with DatabasePool.get_connection() as conn:
            for iface in parsed_interfaces:
                cursor = conn.execute('''
                    INSERT INTO interface_specs
                    (project_id, doc_id, spec_source, category, vendor_name, system_type,
                     interface_name, transcode, protocol, description,
                     request_sample, response_sample, endpoint_url,
                     action_name, view_name, data_direction)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
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
                    iface.get('data_direction', 'pull')
                ))
                spec_id = cursor.lastrowid
                created_ids.append(spec_id)

                for idx, field in enumerate(iface.get('fields', [])):
                    conn.execute('''
                        INSERT INTO interface_spec_fields
                        (spec_id, field_name, field_name_cn, field_type, field_length,
                         is_required, is_primary_key, description, remark,
                         sample_value, field_order)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ''', (
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
                query += ' AND spec_source = ?'
                params.append(spec_source)
            if category:
                query += ' AND category = ?'
                params.append(category)
            query += ' ORDER BY system_type, interface_name'

            specs = conn.execute(query, params).fetchall()
            result = []
            for s in specs:
                spec = dict(s)
                fields = conn.execute(
                    'SELECT * FROM interface_spec_fields WHERE spec_id = ? ORDER BY field_order',
                    (spec['id'],)
                ).fetchall()
                spec['fields'] = [dict(f) for f in fields]
                spec['field_count'] = len(spec['fields'])
                result.append(spec)
        return result

    def delete_spec(self, spec_id):
        """删除一个接口规范及其所有字段"""
        with DatabasePool.get_connection() as conn:
            conn.execute('DELETE FROM interface_spec_fields WHERE spec_id = ?', (spec_id,))
            conn.execute('DELETE FROM interface_specs WHERE id = ?', (spec_id,))
            conn.commit()

interface_parser = InterfaceParserService()