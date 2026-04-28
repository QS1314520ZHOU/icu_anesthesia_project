"""
Deterministic built-in interface standards.

The surgery anesthesia and ICU standard documents are stable project assets, so
standard loading should not depend on AI parsing or repeated uploads.
"""
import os
import re
from typing import Dict, Iterable, List


BUILTIN_STANDARD_DOCS = {
    "手麻标准": "3_2.手术麻醉信息系统对外接口标准文档Ver1.4(1)(1).pdf",
    "重症标准": "深医重症信息系统接口说明V2.6.docx",
}


def load_builtin_standard_definitions(category: str, root_path: str) -> List[Dict]:
    filename = BUILTIN_STANDARD_DOCS.get(category)
    if not filename:
        raise ValueError(f"未配置该分类的内置标准文档: {category}")

    file_path = os.path.join(root_path, filename)
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"未找到内置标准文档: {filename}")

    if category == "重症标准":
        return _parse_icu_docx(file_path)
    if category == "手麻标准":
        return _parse_anesthesia_pdf(file_path)
    return []


def _field_type(raw: str) -> str:
    raw = (raw or "").strip()
    if "date" in raw.lower() or raw == "D":
        return "dateTime"
    if raw.startswith("N") or "int" in raw.lower() or "数字" in raw:
        return "number"
    return "varchar"


def _is_required(raw: str) -> bool:
    raw = raw or ""
    return any(key in raw for key in ["必填", "非空", "主键", "强制"])


def _request_sample(transcode: str) -> str:
    return (
        "<Request>\n"
        f"  <transcode>{transcode}</transcode>\n"
        "  <Messages>\n"
        "    <Message>...</Message>\n"
        "  </Messages>\n"
        "</Request>"
    )


def _docx_blocks(doc) -> Iterable:
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    body = doc.element.body
    for child in body.iterchildren():
        if child.tag.endswith("}p"):
            yield Paragraph(child, doc)
        elif child.tag.endswith("}tbl"):
            yield Table(child, doc)


def _parse_icu_docx(file_path: str) -> List[Dict]:
    from docx import Document
    from docx.table import Table

    doc = Document(file_path)
    interfaces: List[Dict] = []
    current = None

    heading_re = re.compile(r"^\s*(?:\d+、\s*)?(.+?)\s*-{2,}\s*(vi_icu_[a-z0-9_]+|VI_ICU_[A-Z0-9_]+)\s*$", re.I)

    for block in _docx_blocks(doc):
        if not isinstance(block, Table):
            text = (block.text or "").strip()
            match = heading_re.match(text)
            if match:
                current = {
                    "interface_name": match.group(1).strip(),
                    "transcode": match.group(2).upper(),
                    "system_type": "ICU",
                    "protocol": "WebService",
                    "description": "",
                    "endpoint_url": "",
                    "action_name": match.group(2).upper(),
                    "view_name": match.group(2).upper(),
                    "data_direction": "pull",
                    "request_sample": _request_sample(match.group(2).upper()),
                    "response_sample": "",
                    "fields": [],
                }
                interfaces.append(current)
            elif current and text.startswith("通过"):
                current["description"] = text
            continue

        if current is None or len(block.rows) < 2:
            continue

        header = [cell.text.strip() for cell in block.rows[0].cells]
        if not header or "字段名" not in header[0]:
            continue

        for row in block.rows[1:]:
            cells = [cell.text.strip() for cell in row.cells]
            if not cells or not cells[0] or cells[0] == "字段名":
                continue
            field_name = cells[0]
            if not re.match(r"^[A-Za-z][A-Za-z0-9_]*$", field_name):
                continue
            required_text = cells[2] if len(cells) > 2 else ""
            current["fields"].append({
                "field_name": field_name,
                "field_name_cn": cells[3] if len(cells) > 3 else "",
                "field_type": _field_type(cells[1] if len(cells) > 1 else ""),
                "field_length": "",
                "is_required": _is_required(required_text),
                "is_primary_key": "主键" in required_text,
                "description": cells[3] if len(cells) > 3 else "",
                "remark": cells[4] if len(cells) > 4 else "",
                "sample_value": "",
            })

    return _dedupe_interfaces(interfaces)


def _parse_anesthesia_pdf(file_path: str) -> List[Dict]:
    import pdfplumber

    with pdfplumber.open(file_path) as pdf:
        text = "\n".join((page.extract_text() or "") for page in pdf.pages)

    start = text.find("\n4 字典数据")
    if start > 0:
        text = text[start:]

    heading_re = re.compile(r"(?m)^((?:4|5|6)\.1\.\d+(?:\.\d+)?)\s+(.+)$")
    starts = []
    for match in heading_re.finditer(text):
        title = match.group(2).strip()
        if "......" in title:
            continue
        starts.append((match.start(), match.group(1), title))

    interfaces: List[Dict] = []
    for idx, (pos, number, title) in enumerate(starts):
        end = starts[idx + 1][0] if idx + 1 < len(starts) else len(text)
        section = text[pos:end]
        action_match = re.search(r"action服务名[：:\s]+([A-Z0-9_]+)", section)
        view_match = re.search(r"第三方提供的视图名称[：:\s]+([A-Z0-9_.]+)", section)
        action = action_match.group(1) if action_match else ""
        view_name = view_match.group(1) if view_match else action
        clean_title = re.sub(r"\.{3,}.*$", "", title).strip()
        clean_title = clean_title.replace("(重要)", "").strip()

        fields = []
        for line in section.splitlines():
            line = line.strip()
            match = re.match(r"^([A-Z][A-Z0-9_]{1,40})\s+([CND])\s+(\d+)?\s*(.*)$", line)
            if match:
                fields.append({
                    "field_name": match.group(1),
                    "field_name_cn": "",
                    "field_type": _field_type(match.group(2)),
                    "field_length": match.group(3) or "",
                    "is_required": _is_required(match.group(4)),
                    "is_primary_key": False,
                    "description": match.group(4).strip(),
                    "remark": "",
                    "sample_value": "",
                })
                continue

            match = re.match(r"^([\u4e00-\u9fffA-Za-z（）()]+)\s+([A-Z][A-Z0-9_]{1,40})\s+([CND])\s+(\d+)?\s*(.*)$", line)
            if match:
                fields.append({
                    "field_name": match.group(2),
                    "field_name_cn": match.group(1),
                    "field_type": _field_type(match.group(3)),
                    "field_length": match.group(4) or "",
                    "is_required": _is_required(match.group(5)),
                    "is_primary_key": False,
                    "description": match.group(5).strip(),
                    "remark": "",
                    "sample_value": "",
                })

        if action or view_name or fields:
            interfaces.append({
                "interface_name": clean_title,
                "transcode": action or view_name or number,
                "system_type": "手麻",
                "protocol": "WebService" if action else "View",
                "description": "",
                "endpoint_url": "",
                "action_name": action,
                "view_name": view_name,
                "data_direction": "pull",
                "request_sample": _request_sample(action) if action else "",
                "response_sample": "",
                "fields": fields,
            })

    return _dedupe_interfaces(interfaces)


def _dedupe_interfaces(interfaces: List[Dict]) -> List[Dict]:
    seen = set()
    result = []
    for item in interfaces:
        key = (item.get("transcode") or item.get("interface_name") or "").upper()
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result
