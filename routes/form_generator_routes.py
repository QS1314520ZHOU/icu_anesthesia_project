from flask import Blueprint, request, jsonify
import copy
import json
import re
import logging
import os
import tempfile
import difflib
import base64
import mimetypes
import requests
from services.ai_service import ai_service
from services.file_parser import extract_text_from_file
from api_utils import api_response
from ai_config import ai_manager, TaskType
try:
    from pypinyin import lazy_pinyin
except Exception:  # pragma: no cover - optional dependency
    lazy_pinyin = None

logger = logging.getLogger(__name__)
form_generator_bp = Blueprint('form_generator', __name__)

_VALUE_PATTERN = re.compile(r'^([a-zA-Z]+)(\d+)$')

def next_prefix(prefix):
    chars = list(prefix)
    i = len(chars) - 1
    while i >= 0:
        if chars[i] < 'z':
            chars[i] = chr(ord(chars[i]) + 1)
            return ''.join(chars)
        else:
            chars[i] = 'a'
            i -= 1
    return 'a' + ''.join(chars)

def get_nth_prefix(start_prefix, n):
    p = start_prefix
    for _ in range(n):
        p = next_prefix(p)
    return p

def replace_value_prefix(original_value, new_prefix):
    if original_value is None or not isinstance(original_value, str):
        return original_value
    m = _VALUE_PATTERN.match(original_value)
    if m:
        return new_prefix + m.group(2)
    return original_value

def parse_template(raw_text):
    if not raw_text:
        return [], False
    text = raw_text.strip()
    text = text.lstrip('\ufeff\u200b')
    
    # 查找第一个括号/大括号，确定模式
    first_char = ''
    for ch in text:
        if ch in ('{', '['):
            first_char = ch
            break
            
    is_array = (first_char == '[')
    bracket_start = text.find('[')
    bracket_end = text.rfind(']')
    brace_start = text.find('{')
    brace_end = text.rfind('}')
    
    # 如果有[]就按数组解析
    if is_array and bracket_start != -1 and bracket_end != -1:
        text = text[bracket_start:bracket_end + 1]
    # 否则如果有{}就按单个对象解析
    elif brace_start != -1 and brace_end != -1:
        text = text[brace_start:brace_end + 1]
            
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return [data], is_array
        elif isinstance(data, list):
            return data, is_array
        return [], is_array
    except Exception as e:
        logger.error(f"Failed to parse template JSON. Original text length: {len(raw_text)}. Error: {e}")
        # 返回 None 表示解析失败
        return None, False


def _extract_json_array(text):
    if not text:
        return None
    fenced = re.search(r"```json\s*([\s\S]*?)```", text, flags=re.IGNORECASE)
    if fenced:
        text = fenced.group(1).strip()
    match = re.search(r"\[[\s\S]*\]", text)
    if not match:
        return None
    try:
        return json.loads(match.group())
    except Exception as e:
        logger.error("Failed to parse AI generated form JSON: %s", e)
        return None


def _extract_json_object(text):
    if not text:
        return None
    fenced = re.search(r"```json\s*([\s\S]*?)```", text, flags=re.IGNORECASE)
    if fenced:
        text = fenced.group(1).strip()
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        return None
    try:
        return json.loads(match.group())
    except Exception as e:
        logger.error("Failed to parse AI generated object JSON: %s", e)
        return None


def _normalize_label(text: str) -> str:
    value = str(text or '').strip()
    value = re.sub(r'\(.*?\)|（.*?）', '', value)
    value = value.replace(':', '').replace('：', '')
    value = re.sub(r'[\s_\-\\/]+', '', value)
    value = value.replace('json', '').replace('pdf', '')
    return value.lower()


def _load_reference_forms():
    forms_dir = os.path.join(os.getcwd(), '表单')
    items = []
    if not os.path.isdir(forms_dir):
        return items
    for name in os.listdir(forms_dir):
        if not name.lower().endswith('.json'):
            continue
        path = os.path.join(forms_dir, name)
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            items.append({
                'path': path,
                'filename': name,
                'stem': os.path.splitext(name)[0],
                'form_name': data.get('formName') or os.path.splitext(name)[0],
                'data': data
            })
        except Exception as e:
            logger.warning("Skip invalid form reference %s: %s", path, e)
    return items


def _find_reference_form(source_name: str = '', source_text: str = ''):
    references = _load_reference_forms()
    if not references:
        return None
    source_name_norm = _normalize_label(os.path.splitext(source_name or '')[0])
    source_text_norm = _normalize_label(source_text[:300])
    best = None
    best_score = 0
    for ref in references:
        ref_name_norm = _normalize_label(ref['stem'])
        ref_form_norm = _normalize_label(ref['form_name'])
        score = 0
        if source_name_norm:
            score = max(
                difflib.SequenceMatcher(None, source_name_norm, ref_name_norm).ratio(),
                difflib.SequenceMatcher(None, source_name_norm, ref_form_norm).ratio()
            )
        if source_text_norm:
            if ref_form_norm and ref_form_norm in source_text_norm:
                score = max(score, 0.95)
            score = max(score, difflib.SequenceMatcher(None, source_text_norm[:80], ref_form_norm[:80]).ratio())
        if score > best_score:
            best_score = score
            best = ref
    return best if best_score >= 0.32 else None


def _reference_form_text(form_data):
    try:
        components = form_data.get('pages', [{}])[0].get('components', [])
        labels = []
        for comp in components:
            if comp.get('type') == 'label' and comp.get('text'):
                text = str(comp.get('text')).strip()
                if text and text not in labels:
                    labels.append(text)
        return '\n'.join(labels[:120])
    except Exception:
        return ''


def _infer_image_text(file_path):
    try:
        from PIL import Image
        import pytesseract
        text = pytesseract.image_to_string(Image.open(file_path), lang='chi_sim+eng')
        return text.strip()
    except Exception as e:
        logger.warning("Image OCR unavailable or failed: %s", e)
        return ""


def _render_pdf_first_page_to_image(file_path):
    try:
        import fitz
        pdf = fitz.open(file_path)
        if not pdf.page_count:
            return None
        page = pdf[0]
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix='.png')
        tmp.close()
        pix.save(tmp.name)
        return tmp.name
    except Exception as e:
        logger.warning("Render PDF first page failed: %s", e)
        return None


def _call_vision_ocr(image_path, layout_analysis=None):
    try:
        with open(image_path, 'rb') as f:
            mime = mimetypes.guess_type(image_path)[0] or 'image/png'
            data_url = f"data:{mime};base64,{base64.b64encode(f.read()).decode('utf-8')}"
    except Exception as e:
        logger.warning("Read image for vision OCR failed: %s", e)
        return None

    prompt = f"""你是一名医疗表单 OCR 与结构化专家。请阅读这张表单图片，输出 JSON 对象，不要输出解释。

输出格式：
{{
  "text": "按阅读顺序拼接的全部可识别文本",
  "date_fields": ["可能是日期/时间控件的字段名"],
  "table_cells": [
    {{"row": 0, "col": 0, "text": "单元格文本", "is_date": false}}
  ]
}}

说明：
1. 如果看出是表格，请尽量把每个单元格的内容按行列给出。
2. 如果某些格子为空，可以省略。
3. 日期/时间相关字段请放入 date_fields。
4. 以下是系统预检测到的表格结构，可辅助你判断行列：
{json.dumps(layout_analysis[:3] if layout_analysis else [], ensure_ascii=False)}
"""

    preferred_models = ['gpt-4o-mini', 'gpt-4o', 'gpt-5.2']
    sequence = ai_manager.get_call_sequence(TaskType.ANALYSIS)
    for item in sequence:
        endpoint = item["endpoint"]
        headers = {
            "Authorization": f"Bearer {endpoint.api_key}",
            "Content-Type": "application/json"
        }
        models = [m for m in endpoint.models if any(pm in m for pm in preferred_models)] or endpoint.models[:1]
        for model in models:
            try:
                payload = {
                    "model": model,
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": prompt},
                                {"type": "image_url", "image_url": {"url": data_url}}
                            ]
                        }
                    ],
                    "temperature": 0.1,
                    "max_tokens": 3000
                }
                response = requests.post(endpoint.base_url, headers=headers, json=payload, timeout=90)
                if response.status_code != 200:
                    continue
                result = response.json()
                content = result.get('choices', [{}])[0].get('message', {}).get('content', '')
                parsed = _extract_json_object(content)
                if parsed and (parsed.get('text') or parsed.get('table_cells')):
                    return parsed
            except Exception as e:
                logger.warning("Vision OCR via %s/%s failed: %s", endpoint.name, model, e)
                continue
    return None


def _guess_date_fields_from_text(text: str):
    lines = [line.strip() for line in str(text or '').splitlines() if line.strip()]
    result = []
    for line in lines:
        clean = line.replace(':', '').replace('：', '').strip()
        if any(key in clean for key in ['日期', '时间', '入院', '入科', '出院', '出生']):
            if clean not in result:
                result.append(clean)
    return result[:20]


def _is_date_like_text(text: str) -> bool:
    value = str(text or '').strip()
    if not value:
        return False
    keywords = ['日期', '时间', '入院', '入科', '出院', '出生', '评估时间', '手术日期', '操作时间']
    if any(key in value for key in keywords):
        return True
    if re.search(r'\d{4}[-/年]\d{1,2}[-/月]\d{1,2}', value):
        return True
    if re.search(r'\d{1,2}:\d{2}', value):
        return True
    return False


def _normalize_vision_analysis(vision_analysis, layout_analysis=None):
    if not vision_analysis:
        return {}

    normalized = dict(vision_analysis)
    normalized.setdefault('text', '')
    normalized.setdefault('table_cells', [])
    normalized.setdefault('date_fields', [])

    if not normalized['date_fields'] and normalized['text']:
        normalized['date_fields'] = _guess_date_fields_from_text(normalized['text'])

    if not normalized['table_cells'] and normalized['text'] and layout_analysis:
        first_layout = layout_analysis[0] if layout_analysis else None
        if first_layout:
            lines = [line.strip() for line in normalized['text'].splitlines() if line.strip()]
            row_count = min(first_layout.get('row_count', 0), max(0, len(lines)))
            col_count = max(1, first_layout.get('col_count', 1))
            table_cells = []
            cursor = 0
            for r in range(row_count):
                for c in range(col_count):
                    if cursor >= len(lines):
                        break
                    table_cells.append({
                        'row': r,
                        'col': c,
                        'text': lines[cursor],
                        'is_date': any(key in lines[cursor] for key in ['日期', '时间'])
                    })
                    cursor += 1
            normalized['table_cells'] = table_cells

    return normalized


def _analyze_pdf_tables(file_path):
    try:
        import pdfplumber
    except ImportError:
        return []

    layouts = []
    try:
        with pdfplumber.open(file_path) as pdf:
            for page_index, page in enumerate(pdf.pages):
                tables = page.find_tables()
                for table_index, table in enumerate(tables):
                    xs = sorted(set([round(c[0], 2) for c in table.cells] + [round(c[2], 2) for c in table.cells]))
                    ys = sorted(set([round(c[1], 2) for c in table.cells] + [round(c[3], 2) for c in table.cells]))
                    col_widths = [round(xs[i + 1] - xs[i], 2) for i in range(len(xs) - 1)]
                    row_heights = [round(ys[i + 1] - ys[i], 2) for i in range(len(ys) - 1)]

                    spans = []
                    for c in table.cells:
                        x0, y0, x1, y1 = c
                        colspan = sum(1 for i in range(len(xs) - 1) if xs[i] >= x0 - 0.01 and xs[i + 1] <= x1 + 0.01)
                        rowspan = sum(1 for i in range(len(ys) - 1) if ys[i] >= y0 - 0.01 and ys[i + 1] <= y1 + 0.01)
                        if colspan > 1 or rowspan > 1:
                            col_index = next((i for i in range(len(xs) - 1) if abs(xs[i] - round(x0, 2)) < 0.05), 0)
                            row_index = next((i for i in range(len(ys) - 1) if abs(ys[i] - round(y0, 2)) < 0.05), 0)
                            spans.append({
                                'x0': round(x0, 2),
                                'y0': round(y0, 2),
                                'x1': round(x1, 2),
                                'y1': round(y1, 2),
                                'col_index': col_index,
                                'row_index': row_index,
                                'colspan': colspan,
                                'rowspan': rowspan
                            })

                    extracted = table.extract() or []
                    preview_rows = []
                    for row in extracted[:6]:
                        preview_rows.append([(cell or '').strip() if isinstance(cell, str) else cell for cell in row[:8]])

                    layouts.append({
                        'page': page_index + 1,
                        'table_index': table_index,
                        'bbox': [round(x, 2) for x in table.bbox],
                        'row_count': max(0, len(ys) - 1),
                        'col_count': max(0, len(xs) - 1),
                        'x_lines': xs,
                        'y_lines': ys,
                        'column_widths': col_widths,
                        'row_heights': row_heights,
                        'span_cells': spans,
                        'preview_rows': preview_rows
                    })
    except Exception as e:
        logger.warning("PDF table analysis failed: %s", e)
    return layouts


def _guess_field_type(label: str, line: str = '') -> str:
    text = f"{label} {line}".lower()
    # "口是/口否/口出院" 等通常是单选/勾选项，不应误判为日期
    if re.search(r'(^|[：:,\s])口[\u4e00-\u9fffA-Za-z0-9]', str(line or '')):
        return 'radio'
    if any(key in text for key in ['备注', '说明', '意见', '病史', '现病史', '内容']):
        return 'textarea'
    if any(key in text for key in ['日期', '时间', '出生', '入院', '出院']):
        return 'date'
    if any(key in text for key in ['性别', '婚姻', '民族', '是否', '有无']) or any(key in line for key in ['□', '☑', '■', '○', '●']):
        return 'radio'
    if any(key in text for key in ['年龄', '次数', '体重', '身高', '血压', '体温', '脉搏', '金额', '数量']):
        return 'number'
    if any(key in text for key in ['诊断', '科室', '病区', '级别', '类型']) and '□' not in line:
        return 'select'
    if any(key in text for key in ['标题', '基本信息', '一般情况', '评估', '记录表', '申请单', '知情同意']):
        return 'title'
    return 'text'


SMARTCARE_PATIENT_BINDINGS = {
    '科室': {'value': 'patient.dept', 'type': 'textField', 'readonly': True},
    '病人科室': {'value': 'patient.dept', 'type': 'textField', 'readonly': True},
    '病区': {'value': 'patient.dept', 'type': 'textField', 'readonly': True},
    '床号': {'value': 'patient.showBed', 'type': 'textField', 'readonly': True},
    'his床号': {'value': 'patient.hisBed', 'type': 'textField', 'readonly': True},
    '姓名': {'value': 'patient.name', 'type': 'textField', 'readonly': True},
    '性别': {'value': 'patient.gender', 'type': 'textField', 'readonly': True},
    '年龄': {'value': 'patient.age', 'type': 'textField', 'readonly': True},
    '儿童年龄': {'value': 'patient.age', 'type': 'textField', 'readonly': True},
    '住院号': {'value': 'patient.mrn', 'type': 'textField', 'readonly': True},
    '病历号': {'value': 'patient.hisPid', 'type': 'textField', 'readonly': True},
    '入院日期': {'value': 'patient.admissionTime', 'type': 'textField', 'readonly': True, 'dataType': {'type': 'date', 'format': 'yyyy-MM-dd'}},
    '入院时间': {'value': 'patient.admissionTime', 'type': 'textField', 'readonly': True, 'dataType': {'type': 'date', 'format': 'yyyy-MM-dd HH:mm'}},
    '入科时间': {'value': 'patient.icuAdmissionTime', 'type': 'textField', 'readonly': True, 'dataType': {'type': 'date', 'format': 'yyyy-MM-dd HH:mm'}},
    '管床医师': {'value': 'patient.bedPhysician', 'type': 'textField', 'readonly': True},
    '责任护士': {'value': 'patient.responsibleNurse', 'type': 'textField', 'readonly': True},
    '临床诊断': {'value': 'patient.clinicalDiagnosis', 'type': 'textField', 'readonly': True},
    '诊断': {'value': 'patient.clinicalDiagnosis', 'type': 'textField', 'readonly': True},
    '身高': {'value': 'patient.height', 'type': 'textField', 'readonly': True},
    '体重': {'value': 'patient.weight', 'type': 'textField', 'readonly': True}
}


_SLUG_SYMBOL_REPLACEMENTS = [
    ('<=', ' lte '),
    ('>=', ' gte '),
    ('≤', ' lte '),
    ('≥', ' gte '),
    ('＜=', ' lte '),
    ('＞=', ' gte '),
    ('<', ' lt '),
    ('>', ' gt '),
    ('＜', ' lt '),
    ('＞', ' gt '),
    ('≈', ' approx '),
    ('~', ' to '),
    ('～', ' to '),
    ('—', ' '),
    ('-', ' '),
    ('/', ' '),
    ('\\', ' '),
    ('&', ' and '),
    ('+', ' plus '),
    ('%', ' percent '),
    ('℃', ' c '),
    ('°', ' degree '),
    ('(', ' '),
    (')', ' '),
    ('（', ' '),
    ('）', ' '),
    ('[', ' '),
    (']', ' '),
    ('【', ' '),
    ('】', ' '),
    ('：', ' '),
    (':', ' '),
    ('，', ' '),
    (',', ' '),
    ('。', ' '),
    ('、', ' '),
    ('；', ' '),
    (';', ' '),
    ('=', ' ')
]


def _romanize_for_slug(value: str) -> str:
    text = str(value or '').strip()
    if not text:
        return ''

    for old, new in _SLUG_SYMBOL_REPLACEMENTS:
        text = text.replace(old, new)

    tokens = []
    ascii_buffer = []

    def flush_ascii():
        if ascii_buffer:
            token = ''.join(ascii_buffer).strip().lower()
            if token:
                tokens.append(token)
            ascii_buffer.clear()

    for ch in text:
        if re.match(r'[A-Za-z0-9]', ch):
            ascii_buffer.append(ch.lower())
            continue

        flush_ascii()

        if re.match(r'[\u4e00-\u9fff]', ch):
            if lazy_pinyin:
                tokens.extend([piece.lower() for piece in lazy_pinyin(ch, strict=False) if piece])
            continue

    flush_ascii()

    slug = '_'.join(token for token in tokens if token)
    slug = re.sub(r'_+', '_', slug).strip('_')
    return slug


def _strip_score_suffix(value: str) -> str:
    text = str(value or '').strip()
    text = re.sub(r'[（(]\s*\d+\s*分\s*[)）]\s*$', '', text)
    return text.strip()


def _slugify_field(label: str, index: int, prefix: str = 'field', max_length: int = 48) -> str:
    slug = _romanize_for_slug(label)
    if not slug:
        return f'{prefix}_{index}'
    if slug[0].isdigit():
        slug = f'{prefix}_{slug}'
    if len(slug) > max_length:
        slug = slug[:max_length].strip('_')
    return slug or f'{prefix}_{index}'


def _build_smartcare_component(component_type, **overrides):
    base = {
        "borderWidth": None,
        "category": None,
        "code": None,
        "color": "#000000",
        "customizeInput": None,
        "dashArray": None,
        "dataType": {"format": None, "type": None},
        "defaultCheck": None,
        "defaultContent": None,
        "defaultLoginAccount": False,
        "defaultSysTime": False,
        "end": [],
        "fontFamily": "宋体",
        "fontSize": 0.94,
        "fontStyle": None,
        "fontWeight": None,
        "format": None,
        "height": 1.5 if component_type in ('textField', 'modalDatePicker') else (2.8 if component_type == 'textArea' else 1),
        "horiAlign": None,
        "isFlexWrap": True,
        "isNoBorder": True if component_type == 'textField' else None,
        "justify": None,
        "lineHeight": None if component_type in ('textField', 'modalDatePicker', 'textArea', 'select') else 1,
        "modalType": None,
        "multiSelect": None,
        "numberBox": False,
        "optionSpace": 0.25,
        "optionStr": ",",
        "options": [],
        "readonly": None,
        "rotate": None,
        "rows": [],
        "score": None,
        "shape": None,
        "src": None,
        "start": [],
        "text": None,
        "textAlign": None,
        "textDecoration": None,
        "textHoriAlign": "left" if component_type in ('textField', 'textArea') else None,
        "textVertAlign": None,
        "totalAcrossPages": False,
        "type": component_type,
        "value": None,
        "vertAlign": None,
        "width": None,
        "x": 0,
        "y": 0,
        "zIndex": None,
        "id": f"auto_{component_type}_{abs(hash(str(overrides))) % 1000000}"
    }
    if component_type in ('textField', 'modalDatePicker', 'textArea', 'select', 'selectModal', 'checkBox'):
        base["isSave"] = True
    base.update(overrides)
    return base


def _create_empty_smartcare_form(source_name=''):
    return {
        "code": _slugify_field(source_name or 'smartcare_form', 0, prefix='form', max_length=54),
        "formHasTime": False,
        "formName": source_name or "智能生成表单",
        "hasData": True,
        "id": f"auto_form_{abs(hash(source_name or 'smartcare_form')) % 100000}",
        "layout": "vertical",
        "moduleId": "form-customize",
        "paddingBottom": 10,
        "paddingLeft": 15,
        "paddingRight": 15,
        "paddingTop": 10,
        "pages": [{"components": []}],
        "requiredType": None,
        "showTimeNextRow": False,
        "showUnderLine": False,
        "size": "A4",
        "valid": True,
        "_class": "com.smartcare.model.dFormPojo"
    }


def _normalize_smartcare_value(label, index, explicit_value=None):
    value = str(explicit_value or '').strip()
    if value:
        return value
    return _slugify_field(label, index, prefix='field')


def _build_choice_components(item_type, label, item, index, x_field, y):
    options = item.get('options') or []
    if not options:
        return []
    group_value = _normalize_smartcare_value(label, index, item.get('value'))
    components = []
    opt_x = x_field
    for opt_idx, opt in enumerate(options):
        if isinstance(opt, dict):
            opt_label = str(opt.get('label') or opt.get('value') or f'选项{opt_idx + 1}').strip()
            opt_code = str(opt.get('value') or opt.get('code') or _slugify_field(_strip_score_suffix(opt_label), opt_idx, prefix='opt')).strip()
        else:
            opt_label = str(opt).strip()
            opt_code = _slugify_field(_strip_score_suffix(opt_label), opt_idx, prefix='opt')
        if not opt_label:
            continue
        width = max(3, min(10, len(opt_label) * 1.4))
        components.append(_build_smartcare_component(
            'checkBox',
            text=opt_label,
            value=group_value,
            code=opt_code,
            x=round(opt_x, 2),
            y=round(y, 2),
            width=width
        ))
        opt_x += width + 1.2
    return components


def _build_smartcare_form(items, source_name=''):
    reference = _find_reference_form(source_name, '')
    if reference:
        form = copy.deepcopy(reference['data'])
        form['formName'] = form.get('formName') or reference['form_name']
    else:
        form = _create_empty_smartcare_form(source_name)

    components = []
    y = 5
    x_label = 0
    x_field = 4.2
    page_width = 42

    if not reference:
        components.append(_build_smartcare_component(
            'label',
            text=source_name or "智能生成表单",
            x=14,
            y=2.5,
            fontSize=1.25,
            fontWeight='bolder'
        ))

    for index, item in enumerate(items or []):
        item_type = item.get('type', 'text')
        label = str(item.get('label') or item.get('field_name') or f'字段{index + 1}').replace(':', '').replace('：', '').strip()
        if not label:
            continue
        norm = label

        if item_type == 'title':
            components.append(_build_smartcare_component(
                'label',
                text=label,
                x=0,
                y=y,
                fontSize=1.08,
                fontWeight='bolder'
            ))
            y += 2
            continue

        if item_type == 'label':
            content = str(item.get('content') or '').strip()
            rendered_text = label
            if content:
                rendered_text = content if content.startswith(label) else f"{label}: {content}"
            components.append(_build_smartcare_component(
                'label',
                text=rendered_text,
                x=0,
                y=y,
                width=42,
                lineHeight=1.3
            ))
            y += 1.7
            x_label = 0
            x_field = 4.2
            continue

        binding = SMARTCARE_PATIENT_BINDINGS.get(norm) or SMARTCARE_PATIENT_BINDINGS.get(norm.replace('：', '').replace(':', ''))
        resolved_type = (binding or {}).get('type') or item_type
        label_width = max(2.5, min(8, len(label) * 0.9))
        field_width = item.get('width') or (5.33 if resolved_type == 'date' else 6)
        explicit_value = item.get('value')
        explicit_readonly = item.get('readonly')
        explicit_data_type = item.get('dataType')

        if x_field + field_width > page_width:
            x_label = 0
            x_field = 4.2
            y += 2.3

        components.append(_build_smartcare_component(
            'label',
            text=f"{label}:",
            x=round(x_label, 2),
            y=round(y, 2)
        ))

        if resolved_type in ('radio', 'checkbox') and item.get('options'):
            components.extend(_build_choice_components(resolved_type, label, item, index, x_field, y))
        elif resolved_type == 'date':
            components.append(_build_smartcare_component(
                'modalDatePicker',
                value=explicit_value or (binding or {}).get('value', _normalize_smartcare_value(label, index)),
                readonly=(binding or {}).get('readonly', False) if explicit_readonly is None else explicit_readonly,
                dataType=explicit_data_type or (binding or {}).get('dataType', {"format": "yyyy-MM-dd", "type": "date"}),
                format=(explicit_data_type or (binding or {}).get('dataType', {})).get('format', 'yyyy-MM-dd') if isinstance(explicit_data_type or (binding or {}).get('dataType', {}), dict) else 'yyyy-MM-dd',
                width=field_width,
                x=round(x_field, 2),
                y=round(y - 0.3, 2)
            ))
        elif resolved_type == 'textarea':
            components.append(_build_smartcare_component(
                'textArea',
                value=explicit_value or _normalize_smartcare_value(label, index),
                readonly=(binding or {}).get('readonly', False) if explicit_readonly is None else explicit_readonly,
                dataType=explicit_data_type or {"format": None, "type": None},
                width=max(field_width, 12),
                height=2.8,
                x=round(x_field, 2),
                y=round(y - 0.3, 2)
            ))
            y += 1.6
            x_label = 0
            x_field = 4.2
            continue
        elif resolved_type == 'select':
            normalized_options = []
            for opt_idx, opt in enumerate(item.get('options') or []):
                if isinstance(opt, dict):
                    opt_label = str(opt.get('label') or opt.get('value') or f'选项{opt_idx + 1}').strip()
                    opt_value = str(opt.get('value') or opt.get('code') or _slugify_field(_strip_score_suffix(opt_label), opt_idx, prefix='opt')).strip()
                else:
                    opt_label = str(opt).strip()
                    opt_value = _slugify_field(_strip_score_suffix(opt_label), opt_idx, prefix='opt')
                if opt_label:
                    normalized_options.append({'label': opt_label, 'value': opt_value})
            components.append(_build_smartcare_component(
                'select',
                value=explicit_value or _normalize_smartcare_value(label, index),
                readonly=(binding or {}).get('readonly', False) if explicit_readonly is None else explicit_readonly,
                dataType=explicit_data_type or {"format": None, "type": None},
                width=field_width,
                height=1.8,
                x=round(x_field, 2),
                y=round(y - 0.3, 2),
                options=normalized_options
            ))
        else:
            components.append(_build_smartcare_component(
                'textField',
                value=explicit_value or (binding or {}).get('value', _normalize_smartcare_value(label, index)),
                readonly=(binding or {}).get('readonly', False) if explicit_readonly is None else explicit_readonly,
                dataType=explicit_data_type or (binding or {}).get('dataType', {"format": None, "type": "number" if resolved_type == 'number' else ("date" if resolved_type == 'date' else None)}),
                width=field_width,
                x=round(x_field, 2),
                y=round(y - 0.3, 2),
                numberBox=resolved_type == 'number',
                options=item.get('options') or []
            ))

        x_label = x_field + field_width + 1.5
        x_field = x_label + label_width
        if x_field > 34:
            x_label = 0
            x_field = 4.2
            y += 2.3

    form['pages'] = [{'components': components}]
    return form


def _build_table_component_from_layout(layout, x=0, y=5, target_width=42, recognized_cells=None, fill_placeholders=False, date_fields=None):
    col_widths = layout.get('column_widths') or []
    row_heights = layout.get('row_heights') or []
    if not col_widths or not row_heights:
        return None

    total_width = sum(col_widths) or 1
    scaled_widths = [round(w / total_width * target_width, 2) for w in col_widths]
    spans = {(item.get('row_index', 0), item.get('col_index', 0)): item for item in (layout.get('span_cells') or [])}
    covered = set()
    rows = []
    recognized_map = {}
    normalized_date_fields = {str(name).replace(':', '').replace('：', '').strip() for name in (date_fields or []) if name}
    for cell in recognized_cells or []:
        recognized_map[(cell.get('row', 0), cell.get('col', 0))] = cell

    for r in range(len(row_heights)):
        cells = []
        for c in range(len(col_widths)):
            if (r, c) in covered:
                continue
            span = spans.get((r, c))
            colspan = span.get('colspan', 1) if span else 1
            rowspan = span.get('rowspan', 1) if span else 1
            width = round(sum(scaled_widths[c:c + colspan]), 2)
            height = round(max(1.2, row_heights[r] / 12), 2)
            cell = {
                "backgroundColor": None,
                "category": None,
                "colSpan": colspan,
                "content": None,
                "height": height,
                "isEdit": None,
                "paddingLeft": None,
                "paddingRight": None,
                "rowSpan": rowspan,
                "textAlign": None,
                "value": (recognized_map.get((r, c), {}) or {}).get('text'),
                "width": width
            }
            if not cell["value"] and fill_placeholders:
                cell["value"] = f"单元格{r + 1}-{c + 1}"
            if cell["value"]:
                cell["textAlign"] = 'center'
                normalized_value = str(cell["value"]).replace(':', '').replace('：', '').strip()
                if normalized_value in normalized_date_fields or _is_date_like_text(cell["value"]):
                    cell["content"] = {"type": "date", "format": "yyyy-MM-dd"}
            cells.append(cell)
            if span:
                for rr in range(r, r + rowspan):
                    for cc in range(c, c + colspan):
                        if rr == r and cc == c:
                            continue
                        covered.add((rr, cc))
        rows.append({
            "backgroundColor": None,
            "cells": cells,
            "height": None
        })

    return _build_smartcare_component(
        'table',
        x=x,
        y=y,
        width=target_width,
        height=round(sum(max(1.2, h / 12) for h in row_heights), 2),
        rows=rows,
        fontSize=0.75
    )


def _build_smartcare_table_form(layout_analysis, source_name=''):
    form = _create_empty_smartcare_form(source_name or "表格型表单")

    components = [
        _build_smartcare_component('label', text=source_name or '扫描表格还原', x=12, y=2.5, fontSize=1.2, fontWeight='bolder')
    ]
    y = 5
    for layout in (layout_analysis or [])[:3]:
        table_comp = _build_table_component_from_layout(layout, x=0, y=y, target_width=42)
        if table_comp:
            components.append(table_comp)
            y += (table_comp.get('height') or 0) + 2
    form['pages'] = [{'components': components}]
    return form


def _build_smartcare_table_form_with_ocr(layout_analysis, source_name='', vision_analysis=None):
    form = _create_empty_smartcare_form(source_name or "表格型表单")
    components = [
        _build_smartcare_component('label', text=source_name or '扫描表格还原', x=12, y=2.5, fontSize=1.2, fontWeight='bolder')
    ]
    y = 5
    normalized_vision = _normalize_vision_analysis(vision_analysis, layout_analysis)
    all_date_fields = set(normalized_vision.get('date_fields') or [])
    recognized_cells = normalized_vision.get('table_cells') or []
    for layout in (layout_analysis or [])[:3]:
        table_comp = _build_table_component_from_layout(
            layout,
            x=0,
            y=y,
            target_width=42,
            recognized_cells=recognized_cells,
            fill_placeholders=not bool(recognized_cells),
            date_fields=all_date_fields
        )
        if table_comp:
            components.append(table_comp)
            y += (table_comp.get('height') or 0) + 2

    if all_date_fields:
        x = 0
        for name in sorted(all_date_fields):
            components.append(_build_smartcare_component('label', text=f"{name}:", x=x, y=y))
            components.append(_build_smartcare_component('modalDatePicker', value=_normalize_smartcare_value(name, x), x=x + 4, y=y - 0.3, width=8, format='yyyy-MM-dd', isSave=True))
            x += 14
            if x > 28:
                x = 0
                y += 2.4

    form['pages'] = [{'components': components}]
    return form


def _promote_date_controls_in_smartcare_form(form, detected_candidates=None, vision_analysis=None):
    if not form or not form.get('pages'):
        return form
    date_names = set()
    for item in (detected_candidates or []):
        if item.get('type') == 'date' and item.get('label'):
            date_names.add(str(item['label']).replace(':', '').replace('：', '').strip())
    for name in (vision_analysis or {}).get('date_fields') or []:
        if name:
            date_names.add(str(name).replace(':', '').replace('：', '').strip())
    if not date_names:
        return form

    comps = form['pages'][0].get('components', [])
    for idx, comp in enumerate(comps[:-1]):
        next_comp = comps[idx + 1]
        if comp.get('type') != 'label':
            continue
        label = str(comp.get('text') or '').replace(':', '').replace('：', '').strip()
        if label not in date_names:
            continue
        if next_comp.get('type') == 'textField':
            next_comp['type'] = 'modalDatePicker'
            next_comp['format'] = next_comp.get('format') or 'yyyy-MM-dd'
            next_comp['dataType'] = next_comp.get('dataType') or {}
            next_comp['dataType']['type'] = 'date'
            next_comp['dataType']['format'] = next_comp['dataType'].get('format') or 'yyyy-MM-dd'
    return form


def _extract_comparable_entries_from_smartcare(form):
    entries = []
    if not form or not form.get('pages'):
        return entries
    comps = form.get('pages', [{}])[0].get('components', [])
    i = 0
    while i < len(comps):
        current = comps[i]
        nxt = comps[i + 1] if i + 1 < len(comps) else None
        if current.get('type') == 'label':
            label = str(current.get('text') or '').replace(':', '').replace('：', '').strip()
            if nxt and nxt.get('type') in ('textField', 'modalDatePicker', 'checkBox', 'radio', 'select', 'textArea'):
                entries.append({
                    'label': label,
                    'type': nxt.get('type'),
                    'value': nxt.get('value'),
                    'binding': nxt.get('value'),
                    'width': nxt.get('width')
                })
                i += 2
                continue
            entries.append({
                'label': label,
                'type': current.get('type'),
                'value': current.get('text'),
                'binding': None,
                'width': current.get('width')
            })
        elif current.get('type') == 'table':
            for r_idx, row in enumerate(current.get('rows', [])):
                for c_idx, cell in enumerate(row.get('cells', [])):
                    entries.append({
                        'label': f'表格[{r_idx + 1},{c_idx + 1}]',
                        'type': (cell.get('content') or {}).get('type') or 'table-cell',
                        'value': cell.get('value'),
                        'binding': cell.get('bindingKey') or (cell.get('content') or {}).get('value'),
                        'width': cell.get('width')
                    })
        i += 1
    return entries


def _extract_components_from_smartcare(form):
    if not form or not form.get('pages'):
        return []
    return form.get('pages', [{}])[0].get('components', []) or []


def _merge_smartcare_with_reference(current_form, reference_form):
    merged = copy.deepcopy(current_form)
    current_components = _extract_components_from_smartcare(current_form)
    reference_components = _extract_components_from_smartcare(reference_form)

    current_entries = _extract_comparable_entries_from_smartcare(current_form)
    current_map = {}
    for entry in current_entries:
        key = _normalize_label(entry.get('label'))
        if key and key not in current_map:
            current_map[key] = entry

    current_labels = {
        _normalize_label(str(comp.get('text') or '').replace(':', '').replace('：', '').strip())
        for comp in current_components
        if comp.get('type') == 'label' and comp.get('text')
    }

    appended = []
    patched_labels = []
    i = 0
    while i < len(reference_components):
        current = reference_components[i]
        nxt = reference_components[i + 1] if i + 1 < len(reference_components) else None
        if current.get('type') == 'label':
            label = str(current.get('text') or '').replace(':', '').replace('：', '').strip()
            norm = _normalize_label(label)
            if norm and norm not in current_labels:
                appended_label = copy.deepcopy(current)
                appended_label['_autoPatched'] = True
                appended.append(appended_label)
                if nxt and nxt.get('type') in ('textField', 'modalDatePicker', 'checkBox', 'radio', 'select', 'textArea', 'ca-signature'):
                    appended_field = copy.deepcopy(nxt)
                    appended_field['_autoPatched'] = True
                    appended.append(appended_field)
                    i += 2
                    patched_labels.append(label)
                    continue
            elif norm and nxt and nxt.get('type') in ('textField', 'modalDatePicker', 'checkBox', 'radio', 'select', 'textArea', 'ca-signature'):
                # 同名字段存在时，仅同步 value/type
                for idx in range(len(current_components) - 1):
                    c = current_components[idx]
                    n = current_components[idx + 1]
                    if c.get('type') != 'label':
                        continue
                    cur_label = str(c.get('text') or '').replace(':', '').replace('：', '').strip()
                    if _normalize_label(cur_label) == norm and n.get('type') in ('textField', 'modalDatePicker', 'checkBox', 'radio', 'select', 'textArea', 'ca-signature'):
                        n['type'] = nxt.get('type')
                        n['value'] = nxt.get('value')
                        if nxt.get('dataType'):
                            n['dataType'] = nxt.get('dataType')
                        if nxt.get('format'):
                            n['format'] = nxt.get('format')
                        n['_autoPatched'] = True
                        c['_autoPatched'] = True
                        patched_labels.append(label)
                        break
        i += 1

    merged_components = current_components + appended
    if merged.get('pages'):
        merged['pages'][0]['components'] = merged_components
    return merged, len(appended), patched_labels


def _compare_entries(current_entries, reference_entries):
    reference_map = {}
    for item in reference_entries:
        key = _normalize_label(item.get('label'))
        if key and key not in reference_map:
            reference_map[key] = item

    current_map = {}
    for item in current_entries:
        key = _normalize_label(item.get('label'))
        if key and key not in current_map:
            current_map[key] = item

    missing = []
    mismatch = []
    extra = []

    for key, ref in reference_map.items():
        cur = current_map.get(key)
        if not cur:
            missing.append(ref)
            continue
        if (ref.get('type') or '') != (cur.get('type') or '') or (ref.get('binding') or '') != (cur.get('binding') or ''):
            mismatch.append({
                'label': ref.get('label'),
                'reference_type': ref.get('type'),
                'current_type': cur.get('type'),
                'reference_binding': ref.get('binding'),
                'current_binding': cur.get('binding')
            })

    for key, cur in current_map.items():
        if key not in reference_map:
            extra.append(cur)

    return {
        'missing': missing,
        'mismatch': mismatch,
        'extra': extra,
        'summary': {
            'reference_total': len(reference_entries),
            'current_total': len(current_entries),
            'missing_count': len(missing),
            'mismatch_count': len(mismatch),
            'extra_count': len(extra)
        }
    }


_SEMANTIC_TITLE_KEYWORDS = ['记录单', '评估单', '评估表', '评分表', '申请单', '知情同意', '护理单']
_SEMANTIC_FIELD_HINTS = ['日期', '时间', '护士', '审核', '签名', '诊断', '备注', '说明', '年龄', '住院号', '姓名', '床号', '科室', '病区', '部位', '措施', '情况', '类别', '评分', '分值']


def _normalize_source_lines(source_text: str):
    lines = []
    for raw in str(source_text or '').splitlines():
        text = re.sub(r'\s+', ' ', raw or '').strip()
        if not text or text.startswith('['):
            continue
        if '|' in text:
            for part in text.split('|'):
                part = re.sub(r'\s+', ' ', part).strip()
                if part:
                    lines.append(part)
        else:
            lines.append(text)
    return lines[:400]


def _clean_candidate_label(value: str):
    label = str(value or '').strip()
    label = re.sub(r'^[0-9一二三四五六七八九十]+\s*[、\.．]\s*', '', label).strip()
    label = re.sub(r'[□☑■○●]+', '', label).strip()
    label = re.sub(r'^口+', '', label).strip()
    label = re.sub(r'[\s_＿\-—:：\.。]+$', '', label).strip()
    return label


def _extract_marker_options(text: str):
    options = []
    pattern = r'(?:(?<=^)|(?<=[\s：:|，,；;]))[口□☑■○●]\s*([^\s|，,；;。:：]{1,20})'
    for match in re.finditer(pattern, str(text or '')):
        label = _clean_candidate_label(match.group(1))
        if label and label not in options:
            options.append(label)
    return options


def _is_semantic_title_line(line: str):
    text = str(line or '').strip()
    return bool(text) and len(text) <= 40 and any(key in text for key in _SEMANTIC_TITLE_KEYWORDS) and not _extract_marker_options(text)


def _is_semantic_info_line(line: str):
    text = str(line or '').strip()
    if not text or _extract_marker_options(text):
        return False
    if re.match(r'^[0-9一二三四五六七八九十]+期[:：]', text):
        return True
    if '不可分期' in text:
        return True
    return len(text) > 24 and ('。' in text or '；' in text or ':' in text or '：' in text)


def _is_probable_field_label(label: str):
    text = str(label or '').strip()
    if not text:
        return False
    if text in SMARTCARE_PATIENT_BINDINGS:
        return True
    return any(key in text for key in _SEMANTIC_FIELD_HINTS)


def _append_options_to_group(group, options, source_line):
    existing = list(group.get('options') or [])
    for option in options:
        if option and option not in existing:
            existing.append(option)
    group['options'] = existing
    group['source_line'] = f"{group.get('source_line', '')} | {source_line}".strip(' |')


def _build_semantic_option_item(line: str):
    text = str(line or '').strip()
    options = _extract_marker_options(text)
    if not options:
        return None

    marker_match = re.search(r'[口□☑■○●]', text)
    before_marker = text[:marker_match.start()].strip() if marker_match else ''
    if not before_marker:
        return None

    parts = [part.strip() for part in re.split(r'[：:]', before_marker) if part.strip()]
    label = _clean_candidate_label(parts[-1] if parts else before_marker)
    if not label:
        return None

    return {
        'label': label,
        'type': 'radio',
        'options': options,
        'is_input': True,
        'source_line': text
    }


def _build_semantic_label_item(line: str):
    text = str(line or '').strip()
    label = _clean_candidate_label(text.split('：', 1)[0].split(':', 1)[0])
    if not label:
        label = _clean_candidate_label(text)
    if not label:
        return None
    return {
        'label': label,
        'type': 'label',
        'content': text if len(text) > len(label) else '',
        'is_input': False,
        'source_line': text
    }


def _build_semantic_field_item(line: str):
    text = str(line or '').strip()
    if re.match(r'^注[:：]', text) and len(text) > 6:
        return {
            'label': '注',
            'type': 'label',
            'content': text,
            'is_input': False,
            'source_line': text
        }

    normalized = _clean_candidate_label(text)
    if not normalized:
        return None

    label = normalized
    if '：' in text:
        label = _clean_candidate_label(text.split('：', 1)[0])
    elif ':' in text:
        label = _clean_candidate_label(text.split(':', 1)[0])

    if not label:
        return None

    if not _is_probable_field_label(label) and len(text) <= 8 and '：' not in text and ':' not in text:
        return {
            'label': label,
            'type': 'label',
            'content': '',
            'is_input': False,
            'source_line': text
        }

    field_type = _guess_field_type(label, text)
    return {
        'label': label,
        'type': field_type,
        'is_input': field_type not in ('title', 'label'),
        'source_line': text
    }


def _extract_form_candidates(source_text: str):
    candidates = []
    seen = set()
    pending_group = None

    for line in _normalize_source_lines(source_text):
        if _is_semantic_title_line(line):
            pending_group = None
            label = _clean_candidate_label(line)
            if label and label not in seen:
                seen.add(label)
                candidates.append({
                    'label': label,
                    'type': 'title',
                    'is_input': False,
                    'source_line': line[:120]
                })
            continue

        option_item = _build_semantic_option_item(line)
        if option_item:
            label = option_item['label']
            if label in seen:
                existing = next((item for item in candidates if item.get('label') == label and item.get('type') in ('radio', 'checkbox')), None)
                if existing:
                    _append_options_to_group(existing, option_item.get('options') or [], line)
                    pending_group = existing
                continue
            seen.add(label)
            candidates.append(option_item)
            pending_group = candidates[-1]
            continue

        marker_options = _extract_marker_options(line)
        if marker_options and pending_group:
            _append_options_to_group(pending_group, marker_options, line)
            continue

        pending_group = None

        if _is_semantic_info_line(line):
            item = _build_semantic_label_item(line)
        else:
            item = _build_semantic_field_item(line)

        if not item:
            continue

        label = item.get('label')
        unique_key = f"{item.get('type')}::{label}"
        if not label or unique_key in seen:
            continue

        seen.add(unique_key)
        candidates.append(item)

    return candidates[:40]


def _should_use_semantic_parser_directly(items):
    input_items = [item for item in (items or []) if item.get('is_input')]
    option_groups = [item for item in input_items if item.get('options')]
    patient_fields = [item for item in input_items if item.get('label') in SMARTCARE_PATIENT_BINDINGS]
    info_blocks = [item for item in (items or []) if item.get('type') in ('title', 'label')]
    numericish_labels = [
        item for item in (items or [])
        if re.match(r'^(?:[<>]=?\s*\d+|\d+(?:\.\d+)?(?:~|-|>|<)?\d*|[一二三四五六七八九十]+分?|[一二三四五六七八九十]+级)$', str(item.get('label') or ''))
    ]
    score = len(input_items) + len(option_groups) * 2 + len(patient_fields) * 2 + min(3, len(info_blocks))
    if len(items or []) >= 20 and len(info_blocks) >= len(items or []) * 0.45 and len(numericish_labels) >= 6:
        return False
    return len(input_items) >= 4 and score >= 8


def _extract_textual_tables(source_text: str):
    tables = []
    current = []
    in_table = False
    for raw in str(source_text or '').splitlines():
        text = str(raw or '').strip()
        if not text:
            if in_table and current:
                tables.append(current)
                current = []
            in_table = False
            continue
        if text == '[表格]':
            if in_table and current:
                tables.append(current)
            current = []
            in_table = True
            continue
        if in_table and '|' in text:
            row = [cell.strip() for cell in text.split('|')]
            while row and not row[-1]:
                row.pop()
            if any(row):
                current.append(row)
            continue
        if in_table and current:
            tables.append(current)
            current = []
        in_table = False
    if in_table and current:
        tables.append(current)
    return [table for table in tables if len(table) >= 2 and max(len(row) for row in table) >= 2]


def _extract_non_table_lines(source_text: str):
    lines = []
    in_table = False
    for raw in str(source_text or '').splitlines():
        text = str(raw or '').strip()
        if not text:
            if in_table:
                in_table = False
            continue
        if text == '[表格]':
            in_table = True
            continue
        if in_table and '|' in text:
            continue
        if in_table and '|' not in text:
            in_table = False
        if not in_table:
            lines.append(text)
    return lines


def _normalize_header_cell(value: str):
    return re.sub(r'[\s:：\-_]+', '', str(value or '')).strip().lower()


def _extract_risk_level_options(text: str):
    candidates = []
    for label in re.findall(r'([高低中][危风险级]*)', str(text or '')):
        normalized = label.replace('风险', '').replace('级', '')
        if normalized.endswith('危'):
            value = normalized
        else:
            value = label
        if value and value not in candidates:
            candidates.append(value)
    return candidates


def _detect_score_table_columns(header_row):
    header = [_normalize_header_cell(cell) for cell in (header_row or [])]
    if len(header) < 3:
        return None

    def find_index(keywords):
        for idx, cell in enumerate(header):
            if any(key in cell for key in keywords):
                return idx
        return None

    score_idx = find_index(['评分', '分值', '得分'])
    option_idx = find_index(['等级', '级别', '选项', '分级', '标准'])
    field_idx = find_index(['条目', '项目', '指标'])
    section_idx = find_index(['维度', '分类', '类别', '模块'])

    if score_idx is None or option_idx is None:
        return None

    if field_idx is None:
        candidates = [idx for idx in range(len(header)) if idx not in {score_idx, option_idx, section_idx}]
        field_idx = candidates[0] if candidates else None

    if field_idx is None:
        return None

    return {
        'score': score_idx,
        'option': option_idx,
        'field': field_idx,
        'section': section_idx
    }


def _build_score_matrix_candidates(table_rows, source_text=''):
    if not table_rows:
        return None

    column_map = _detect_score_table_columns(table_rows[0])
    if not column_map:
        return None

    col_count = max(len(row) for row in table_rows)
    groups = []
    notes = []
    current_section = ''
    current_field = ''
    group_map = {}

    for row in table_rows[1:]:
        padded = row + [''] * (col_count - len(row))
        non_empty = [str(cell).strip() for cell in padded if str(cell).strip()]
        if not non_empty:
            continue
        if len(set(non_empty)) == 1 and len(non_empty[0]) > 8:
            notes.append(non_empty[0])
            continue

        section_value = _clean_candidate_label(padded[column_map['section']]) if column_map.get('section') is not None else ''
        field_value = _clean_candidate_label(padded[column_map['field']])
        option_value = str(padded[column_map['option']] or '').strip()
        score_value = str(padded[column_map['score']] or '').strip()

        if section_value:
            current_section = section_value
        if field_value:
            current_field = field_value

        if not current_field or not option_value:
            continue

        option_text = option_value
        if score_value:
            option_text = f"{option_value}（{score_value}分）"

        key = (current_section, current_field)
        if key not in group_map:
            item = {
                'label': current_field,
                'type': 'radio',
                'options': [],
                'is_input': True,
                'source_line': ' | '.join(non_empty[:4])
            }
            group_map[key] = item
            groups.append((current_section, item))

        if option_text not in group_map[key]['options']:
            group_map[key]['options'].append(option_text)

    if not groups:
        return None

    items = []
    emitted_sections = set()
    for section, group in groups:
        if section and section not in emitted_sections:
            emitted_sections.add(section)
            items.append({
                'label': section,
                'type': 'title',
                'is_input': False,
                'source_line': section
            })
        items.append(group)

    non_table_lines = _extract_non_table_lines(source_text)
    for line in non_table_lines:
        text = str(line or '').strip()
        if not text:
            continue
        if text == notes[-1] if notes else False:
            continue
        if re.match(r'^注[:：]', text) or ('分级' in text and '总分' in text):
            items.append({
                'label': _clean_candidate_label(text.split('：', 1)[0].split(':', 1)[0]) or '说明',
                'type': 'label',
                'content': text,
                'is_input': False,
                'source_line': text
            })

    for note in notes:
        if note and not any(item.get('content') == note for item in items):
            items.append({
                'label': _clean_candidate_label(note.split('：', 1)[0].split(':', 1)[0]) or '说明',
                'type': 'label',
                'content': note,
                'is_input': False,
                'source_line': note
            })

    classification_text = ' '.join(notes + [line for line in _extract_non_table_lines(source_text) if '总分' in line or '分级' in line or '风险等级' in line])
    if classification_text:
        items.append({
            'label': '总分',
            'type': 'number',
            'is_input': True,
            'source_line': classification_text[:120]
        })
        risk_options = _extract_risk_level_options(classification_text)
        if risk_options:
            items.append({
                'label': '风险等级',
                'type': 'radio',
                'options': risk_options,
                'is_input': True,
                'source_line': classification_text[:120]
            })

    return items[:80]


def _estimate_component_bottom(component):
    y = float(component.get('y') or 0)
    height = float(component.get('height') or 1.2)
    return y + max(height, 1.0)


def _estimate_components_bottom(components):
    if not components:
        return 3.5
    return max(_estimate_component_bottom(comp) for comp in components)


def _build_table_field_candidate(label_text, value_text=''):
    raw_label = str(label_text or '').strip()
    raw_value = str(value_text or '').strip()
    label = _clean_candidate_label(raw_label)
    if not label or len(label) > 24:
        return None

    option_item = _build_semantic_option_item(f"{raw_label}：{raw_value}" if raw_value else raw_label)
    if option_item:
        return option_item

    field_type = _guess_field_type(label, f"{raw_label}：{raw_value}" if raw_value else raw_label)
    if field_type == 'title':
        field_type = 'text'
    return {
        'label': label,
        'type': field_type,
        'is_input': True,
        'source_line': f"{raw_label} | {raw_value}".strip(' |')
    }


def _parse_pair_field_row(row):
    cells = [str(cell or '').strip() for cell in (row or [])]
    non_empty = [cell for cell in cells if cell]
    if not non_empty:
        return []
    if len(non_empty) >= 4 and all(cell and len(cell) <= 12 for cell in non_empty[::2]):
        padded = list(cells)
        if len(padded) % 2:
            padded.append('')
        candidates = []
        for idx in range(0, len(padded), 2):
            label_cell = padded[idx].strip()
            value_cell = padded[idx + 1].strip()
            if not label_cell:
                continue
            item = _build_table_field_candidate(label_cell, value_cell)
            if item:
                candidates.append(item)
        if len(candidates) >= 2:
            return candidates
    return []


def _row_to_note_text(row):
    non_empty = [str(cell or '').strip() for cell in (row or []) if str(cell or '').strip()]
    if not non_empty:
        return ''
    if len(non_empty) == 1 and (len(non_empty[0]) >= 6 or re.match(r'^(备注|说明|注)[:：]?', non_empty[0])):
        return non_empty[0]
    if len(set(non_empty)) == 1 and (len(non_empty[0]) >= 6 or re.match(r'^(备注|说明|注)[:：]?', non_empty[0])):
        return non_empty[0]
    if len(non_empty) <= 2:
        merged = ' '.join(non_empty).strip()
        if merged and re.match(r'^(备注|说明|注)[:：]?', merged):
            return merged
    return ''


def _extract_field_candidates_from_text_table(table_rows):
    rows = [list(row) for row in (table_rows or [])]
    field_items = []
    note_lines = []
    consumed = 0

    for row in rows[:6]:
        parsed = _parse_pair_field_row(row)
        if not parsed:
            break
        field_items.extend(parsed)
        consumed += 1

    remaining = rows[consumed:] if consumed else rows

    while remaining:
        note = _row_to_note_text(remaining[-1])
        if not note:
            break
        note_lines.insert(0, note)
        remaining = remaining[:-1]

    deduped = []
    seen = set()
    for item in field_items:
        key = (item.get('type'), item.get('label'))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)

    return deduped, remaining, note_lines


def _build_text_table_geometry(table_rows, target_width=42):
    col_count = max(len(row) for row in table_rows)
    cell_widths = [round(target_width / max(col_count, 1), 2)] * col_count
    row_heights = [1.35 if idx == 0 else 1.2 for idx in range(len(table_rows))]
    col_offsets = []
    cursor = 0.0
    for width in cell_widths:
        col_offsets.append(round(cursor, 2))
        cursor += width
    row_offsets = []
    cursor = 0.0
    for height in row_heights:
        row_offsets.append(round(cursor, 2))
        cursor += height
    return {
        'col_count': col_count,
        'cell_widths': cell_widths,
        'row_heights': row_heights,
        'col_offsets': col_offsets,
        'row_offsets': row_offsets,
        'total_height': round(sum(row_heights), 2)
    }


def _build_table_component_from_text_rows(table_rows, x=0, y=5, target_width=42):
    if not table_rows:
        return None

    geometry = _build_text_table_geometry(table_rows, target_width=target_width)
    col_count = geometry['col_count']
    if col_count <= 0:
        return None

    rows = []
    for row_index, row in enumerate(table_rows):
        padded = row + [''] * (col_count - len(row))
        cells = []
        for cell_index, cell in enumerate(padded):
            text = str(cell or '').strip()
            cells.append({
                "backgroundColor": None,
                "category": None,
                "colSpan": 1,
                "content": None,
                "height": geometry['row_heights'][row_index],
                "isEdit": None,
                "paddingLeft": None,
                "paddingRight": None,
                "rowSpan": 1,
                "textAlign": 'center',
                "value": text,
                "width": geometry['cell_widths'][cell_index]
            })
        rows.append({
            "backgroundColor": None,
            "cells": cells,
            "height": None
        })

    return _build_smartcare_component(
        'table',
        x=x,
        y=y,
        width=target_width,
        height=geometry['total_height'],
        rows=rows,
        fontSize=0.78
    )


def _looks_like_table_header_row(row):
    non_empty = [str(cell or '').strip() for cell in (row or []) if str(cell or '').strip()]
    if not non_empty:
        return False
    return len(non_empty) >= max(2, len(row) - 1)


def _make_table_overlay_control(label_text, x, y, width, height, value_key, code_key=None):
    clean_label = _clean_candidate_label(label_text)
    resolved_code = code_key or _slugify_field(clean_label, 0, prefix='cell')
    component_type = 'modalDatePicker' if _is_date_like_text(clean_label) or any(key in clean_label for key in ['日期', '时间']) else 'textField'
    if component_type == 'modalDatePicker':
        return _build_smartcare_component(
            'modalDatePicker',
            value=value_key,
            code=resolved_code,
            category='table_overlay',
            x=round(x, 2),
            y=round(y, 2),
            width=round(width, 2),
            height=round(height, 2),
            format='yyyy-MM-dd'
        )
    return _build_smartcare_component(
        'textField',
        value=value_key,
        code=resolved_code,
        category='table_overlay',
        x=round(x, 2),
        y=round(y, 2),
        width=round(width, 2),
        height=round(height, 2),
        isNoBorder=False
    )


def _build_overlay_components_for_text_table(table_rows, table_x=0, table_y=5, target_width=42):
    if not table_rows:
        return []

    geometry = _build_text_table_geometry(table_rows, target_width=target_width)
    col_count = geometry['col_count']
    header_row = table_rows[0] if table_rows and _looks_like_table_header_row(table_rows[0]) else []
    overlay_components = []
    used_keys = set()

    for row_index, row in enumerate(table_rows):
        padded = row + [''] * (col_count - len(row))
        if row_index == 0 and _looks_like_table_header_row(padded):
            continue
        if _row_to_note_text(padded):
            continue

        for cell_index, cell in enumerate(padded):
            cell_text = str(cell or '').strip()
            if cell_text:
                continue

            left_label = ''
            for lookback in range(cell_index - 1, -1, -1):
                candidate = str(padded[lookback] or '').strip()
                if candidate:
                    left_label = candidate
                    break

            header_label = ''
            if header_row and cell_index < len(header_row):
                header_label = str(header_row[cell_index] or '').strip()

            label_text = left_label or header_label
            if not label_text:
                continue

            base_slug = _slugify_field(label_text, row_index, prefix='cell', max_length=28)
            value_key = f"tbl_{base_slug}_r{row_index + 1}c{cell_index + 1}"
            code_key = f"{base_slug}_r{row_index + 1}c{cell_index + 1}"
            if value_key in used_keys:
                continue
            used_keys.add(value_key)

            overlay_components.append(_make_table_overlay_control(
                label_text=label_text,
                x=table_x + geometry['col_offsets'][cell_index] + 0.12,
                y=table_y + geometry['row_offsets'][row_index] + 0.08,
                width=max(1.6, geometry['cell_widths'][cell_index] - 0.24),
                height=max(0.95, geometry['row_heights'][row_index] - 0.14),
                value_key=value_key,
                code_key=code_key
            ))

    return overlay_components


def _build_smartcare_text_table_form(table_rows, source_name='', source_text=''):
    field_items, body_rows, table_notes = _extract_field_candidates_from_text_table(table_rows)
    if field_items:
        form = _build_smartcare_form(field_items, source_name or "表格型表单")
        components = form.get('pages', [{}])[0].get('components', [])
    else:
        form = _create_empty_smartcare_form(source_name or "表格型表单")
        components = [
            _build_smartcare_component('label', text=source_name or '表格型表单', x=12, y=2.5, fontSize=1.2, fontWeight='bolder')
        ]

    non_table_lines = _extract_non_table_lines(source_text)
    y = _estimate_components_bottom(components) + 1.3
    title_text = str(source_name or '表格型表单').strip()
    for line in non_table_lines[:3]:
        clean = str(line or '').strip()
        if clean and clean != title_text and len(clean) <= 60:
            components.append(_build_smartcare_component('label', text=str(line).strip(), x=0, y=y, width=42))
            y += 1.6

    table_comp = _build_table_component_from_text_rows(body_rows or table_rows, x=0, y=y, target_width=42)
    if table_comp:
        components.append(table_comp)
        overlay_components = _build_overlay_components_for_text_table(body_rows or table_rows, table_x=0, table_y=y, target_width=42)
        components.extend(overlay_components)
        y += (table_comp.get('height') or 0) + 1.6

    for line in table_notes + non_table_lines[3:8]:
        text = str(line or '').strip()
        if text:
            components.append(_build_smartcare_component('label', text=text, x=0, y=y, width=42))
            y += 1.5

    form['pages'] = [{'components': components}]
    return form


def _summarize_generated_controls(items):
    summary = {
        'total': len(items or []),
        'input_count': 0,
        'title_count': 0,
        'label_count': 0,
        'by_type': {}
    }
    for item in items or []:
        field_type = item.get('type', 'text')
        summary['by_type'][field_type] = summary['by_type'].get(field_type, 0) + 1
        if field_type == 'title':
            summary['title_count'] += 1
        elif field_type == 'label':
            summary['label_count'] += 1
        else:
            summary['input_count'] += 1
    return summary


@form_generator_bp.route('/extract-text', methods=['POST'])
def extract_form_source_text():
    try:
        source_text = (request.form.get('source_text') or request.json.get('source_text') if request.is_json else '') or ''
        source_text = source_text.strip()
        if source_text:
            return api_response(True, {
                "text": source_text,
                "length": len(source_text),
                "source": "manual"
            })

        if 'file' not in request.files:
            return api_response(False, message="未找到上传文件", code=400)

        file = request.files['file']
        if not file or not file.filename:
            return api_response(False, message="文件为空", code=400)

        suffix = os.path.splitext(file.filename)[1].lower()
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            file.save(tmp.name)
            temp_path = tmp.name

        try:
            layout_analysis = []
            vision_analysis = None
            if suffix in {'.png', '.jpg', '.jpeg', '.bmp', '.webp'}:
                text = _infer_image_text(temp_path)
                if not text:
                    vision_analysis = _call_vision_ocr(temp_path, [])
                    text = (vision_analysis or {}).get('text', '')
                if not text and not vision_analysis:
                    return api_response(False, message="图片识别失败。当前环境若未安装 OCR 依赖且 AI 视觉识别也不可用。", code=400)
            else:
                text = extract_text_from_file(temp_path)
                if suffix == '.pdf':
                    layout_analysis = _analyze_pdf_tables(temp_path)
                    if (not text or text.startswith('[')) and layout_analysis:
                        image_path = _render_pdf_first_page_to_image(temp_path)
                        if image_path:
                            try:
                                vision_analysis = _call_vision_ocr(image_path, layout_analysis)
                                text = (vision_analysis or {}).get('text', '') or text
                            finally:
                                try:
                                    os.remove(image_path)
                                except Exception:
                                    pass

            reference_form = _find_reference_form(file.filename, text or '')
            vision_analysis = _normalize_vision_analysis(vision_analysis, layout_analysis)
            if (not text or text.startswith('[')) and reference_form:
                text = _reference_form_text(reference_form['data']) or f"已命中本地参考表单: {reference_form['form_name']}"

            if (not text or text.startswith('[')) and not layout_analysis:
                return api_response(False, message=f"未提取到有效文本: {text or '空内容'}", code=400)

            return api_response(True, {
                "text": text or '',
                "length": len(text or ''),
                "source": file.filename,
                "layout_analysis": layout_analysis,
                "vision_analysis": vision_analysis,
                "reference_match": {
                    "filename": reference_form['filename'],
                    "form_name": reference_form['form_name']
                } if reference_form else None
            })
        finally:
            try:
                os.remove(temp_path)
            except Exception:
                pass
    except Exception as e:
        logger.error("Form source text extraction failed: %s", e, exc_info=True)
        return api_response(False, message=str(e), code=500)


@form_generator_bp.route('/generate-from-document', methods=['POST'])
def generate_from_document():
    try:
        data = request.json or {}
        source_text = (data.get('source_text') or '').strip()
        source_name = (data.get('source_name') or '').strip()
        layout_analysis = data.get('layout_analysis') or []
        vision_analysis = _normalize_vision_analysis(data.get('vision_analysis') or {}, layout_analysis)
        if source_text.startswith('[') and layout_analysis:
            source_text = ''
        if not source_text:
            if not layout_analysis:
                return api_response(False, message="缺少表单文本内容", code=400)
            source_text = '[仅检测到表格结构，无可用文本内容]'
        candidates = _extract_form_candidates(source_text)
        text_tables = _extract_textual_tables(source_text)

        reference_form = _find_reference_form(source_name, source_text)
        if reference_form:
            ref_data = _promote_date_controls_in_smartcare_form(copy.deepcopy(reference_form['data']), candidates, vision_analysis)
            formatted_text = json.dumps(ref_data, ensure_ascii=False, indent=2)
            return api_response(True, {
                "data": ref_data.get('pages', [{}])[0].get('components', []),
                "smartcare_form": ref_data,
                "formatted_text": formatted_text,
                "smartcare_formatted_text": formatted_text,
                "total_count": len(ref_data.get('pages', [{}])[0].get('components', [])),
                "detected_candidates": candidates,
                "control_summary": _summarize_generated_controls(ref_data.get('pages', [{}])[0].get('components', [])),
                "reference_match": {
                    "filename": reference_form['filename'],
                    "form_name": reference_form['form_name']
                }
            })

        if text_tables:
            score_table_items = _build_score_matrix_candidates(text_tables[0], source_text=source_text)
            if score_table_items:
                smartcare_form = _build_smartcare_form(score_table_items, source_name=source_name or '评分表单')
                smartcare_form = _promote_date_controls_in_smartcare_form(smartcare_form, score_table_items, vision_analysis)
                formatted_text = json.dumps(score_table_items, ensure_ascii=False, indent=2)
                smartcare_formatted_text = json.dumps(smartcare_form, ensure_ascii=False, indent=2)
                return api_response(True, {
                    "data": score_table_items,
                    "formatted_text": formatted_text,
                    "smartcare_form": smartcare_form,
                    "smartcare_formatted_text": smartcare_formatted_text,
                    "total_count": len(score_table_items),
                    "detected_candidates": score_table_items,
                    "control_summary": _summarize_generated_controls(score_table_items),
                    "layout_analysis": layout_analysis,
                    "vision_analysis": vision_analysis,
                    "generation_strategy": "score_table"
                })

            if not layout_analysis:
                smartcare_form = _build_smartcare_text_table_form(text_tables[0], source_name=source_name or '表格型表单', source_text=source_text)
                smartcare_formatted_text = json.dumps(smartcare_form, ensure_ascii=False, indent=2)
                components = smartcare_form.get('pages', [{}])[0].get('components', [])
                return api_response(True, {
                    "data": components,
                    "formatted_text": json.dumps(components, ensure_ascii=False, indent=2),
                    "smartcare_form": smartcare_form,
                    "smartcare_formatted_text": smartcare_formatted_text,
                    "total_count": len(components),
                    "detected_candidates": candidates,
                    "control_summary": _summarize_generated_controls(components),
                    "layout_analysis": layout_analysis,
                    "vision_analysis": vision_analysis,
                    "generation_strategy": "text_table"
                })

        if _should_use_semantic_parser_directly(candidates):
            smartcare_form = _build_smartcare_form(candidates, source_name=source_name or '智能生成表单')
            smartcare_form = _promote_date_controls_in_smartcare_form(smartcare_form, candidates, vision_analysis)
            formatted_text = json.dumps(candidates, ensure_ascii=False, indent=2)
            smartcare_formatted_text = json.dumps(smartcare_form, ensure_ascii=False, indent=2)
            return api_response(True, {
                "data": candidates,
                "formatted_text": formatted_text,
                "smartcare_form": smartcare_form,
                "smartcare_formatted_text": smartcare_formatted_text,
                "total_count": len(candidates),
                "detected_candidates": candidates,
                "control_summary": _summarize_generated_controls(candidates),
                "layout_analysis": layout_analysis,
                "vision_analysis": vision_analysis,
                "generation_strategy": "semantic"
            })

        if (not candidates or source_text.startswith('[仅检测到表格结构')) and layout_analysis:
            smartcare_form = _build_smartcare_table_form_with_ocr(layout_analysis, source_name=source_name or '表格型扫描件', vision_analysis=vision_analysis)
            smartcare_form = _promote_date_controls_in_smartcare_form(smartcare_form, candidates, vision_analysis)
            smartcare_formatted_text = json.dumps(smartcare_form, ensure_ascii=False, indent=2)
            return api_response(True, {
                "data": smartcare_form.get('pages', [{}])[0].get('components', []),
                "formatted_text": json.dumps([], ensure_ascii=False, indent=2),
                "smartcare_form": smartcare_form,
                "smartcare_formatted_text": smartcare_formatted_text,
                "total_count": len(smartcare_form.get('pages', [{}])[0].get('components', [])),
                "detected_candidates": candidates,
                "control_summary": _summarize_generated_controls(smartcare_form.get('pages', [{}])[0].get('components', [])),
                "layout_analysis": layout_analysis,
                "vision_analysis": vision_analysis,
                "structure_only": True
            })

        prompt = f"""你是一名医疗表单结构化工程师。请根据以下表单文字内容，输出一个“表单控件 JSON 数组”，用于前端表单设计器。

要求：
1. 只输出 JSON 数组，不要输出解释。
2. 每个字段对象尽量包含：
   - id: 英文唯一ID，例如 field_1
   - type: text / textarea / number / date / select / radio / checkbox / title
    - label: 中文字段名
    - placeholder: 输入提示
    - required: true/false
   - input: true/false，标题类为 false，其余输入控件为 true
   - x, y: 数值，按从上到下布局递增，首个字段可从 x=40, y=40 开始
   - width: 默认 240，textarea 可更宽
   - options: 若为 select/radio/checkbox，给出数组
    - value: 默认给空字符串；标题类可用 label 文本
3. 如果识别到“姓名、年龄、性别、日期、诊断、备注、签名”等常见字段，请优先用合理控件类型。
4. 表头、分组标题也可输出为 type=title。
5. 没有明确选项时不要臆造过多 options。
6. 下面这些是系统预识别出的疑似字段，请优先参考，但要自行修正不合理项：
{json.dumps(candidates, ensure_ascii=False)}
7. 如果提供了表格结构分析，请尽量参考 rows/cols/column_widths/row_heights/span_cells，生成更接近原表格布局的字段顺序和宽度。

表格结构分析如下：
{json.dumps(layout_analysis[:5], ensure_ascii=False)}

表单文本如下：
{source_text[:12000]}
"""

        ai_resp = ai_service.call_ai_api("你是一个只输出合法 JSON 数组的表单结构化引擎。", prompt, task_type="json")
        result = _extract_json_array(ai_resp or '')
        if not result:
            return api_response(False, message="AI 未返回合法的表单 JSON，请重试或缩短文档内容", code=500)

        smartcare_form = _build_smartcare_form(result, source_name=source_name or '智能生成表单')
        smartcare_form = _promote_date_controls_in_smartcare_form(smartcare_form, candidates, vision_analysis)
        control_summary = _summarize_generated_controls(result)
        formatted_text = json.dumps(result, ensure_ascii=False, indent=2)
        smartcare_formatted_text = json.dumps(smartcare_form, ensure_ascii=False, indent=2)
        return api_response(True, {
            "data": result,
            "formatted_text": formatted_text,
            "smartcare_form": smartcare_form,
            "smartcare_formatted_text": smartcare_formatted_text,
            "total_count": len(result),
            "detected_candidates": candidates,
            "control_summary": control_summary,
            "layout_analysis": layout_analysis,
            "vision_analysis": vision_analysis,
            "generation_strategy": "ai"
        })
    except Exception as e:
        logger.error("Generate form JSON from document failed: %s", e, exc_info=True)
        return api_response(False, message=str(e), code=500)


@form_generator_bp.route('/rebuild-smartcare', methods=['POST'])
def rebuild_smartcare():
    try:
        data = request.json or {}
        fields = data.get('fields') or []
        source_name = (data.get('source_name') or '智能生成表单').strip()
        if not isinstance(fields, list) or not fields:
            return api_response(False, message="缺少字段定义", code=400)

        smartcare_form = _build_smartcare_form(fields, source_name=source_name)
        smartcare_form = _promote_date_controls_in_smartcare_form(smartcare_form, fields, {})
        smartcare_formatted_text = json.dumps(smartcare_form, ensure_ascii=False, indent=2)
        return api_response(True, {
            "smartcare_form": smartcare_form,
            "smartcare_formatted_text": smartcare_formatted_text,
            "total_count": len(smartcare_form.get('pages', [{}])[0].get('components', []))
        })
    except Exception as e:
        logger.error("Rebuild smartcare form failed: %s", e, exc_info=True)
        return api_response(False, message=str(e), code=500)


@form_generator_bp.route('/compare-reference', methods=['POST'])
def compare_reference():
    try:
        data = request.json or {}
        current_json = data.get('current_json')
        reference_path = (data.get('reference_path') or r'C:\Users\秦胜\Desktop\入院.json').strip()
        if not current_json:
            return api_response(False, message="缺少当前结果 JSON", code=400)

        if isinstance(current_json, str):
            current_form = json.loads(current_json)
        else:
            current_form = current_json

        if not os.path.exists(reference_path):
            return api_response(False, message=f"参考文件不存在: {reference_path}", code=404)

        with open(reference_path, 'r', encoding='utf-8') as f:
            reference_form = json.load(f)

        current_entries = _extract_comparable_entries_from_smartcare(current_form)
        reference_entries = _extract_comparable_entries_from_smartcare(reference_form)
        result = _compare_entries(current_entries, reference_entries)
        result['reference_path'] = reference_path
        result['reference_form_name'] = reference_form.get('formName')
        return api_response(True, result)
    except Exception as e:
        logger.error("Compare reference form failed: %s", e, exc_info=True)
        return api_response(False, message=str(e), code=500)


@form_generator_bp.route('/apply-reference-fixes', methods=['POST'])
def apply_reference_fixes():
    try:
        data = request.json or {}
        current_json = data.get('current_json')
        reference_path = (data.get('reference_path') or r'C:\Users\秦胜\Desktop\入院.json').strip()
        if not current_json:
            return api_response(False, message="缺少当前结果 JSON", code=400)
        if isinstance(current_json, str):
            current_form = json.loads(current_json)
        else:
            current_form = current_json
        if not os.path.exists(reference_path):
            return api_response(False, message=f"参考文件不存在: {reference_path}", code=404)

        with open(reference_path, 'r', encoding='utf-8') as f:
            reference_form = json.load(f)

        merged_form, appended_count, patched_labels = _merge_smartcare_with_reference(current_form, reference_form)
        comparable = _compare_entries(
            _extract_comparable_entries_from_smartcare(merged_form),
            _extract_comparable_entries_from_smartcare(reference_form)
        )
        merged_text = json.dumps(merged_form, ensure_ascii=False, indent=2)
        return api_response(True, {
            'smartcare_form': merged_form,
            'smartcare_formatted_text': merged_text,
            'appended_count': appended_count,
            'patched_labels': patched_labels,
            'compare_result': comparable,
            'reference_form_name': reference_form.get('formName'),
            'reference_path': reference_path
        })
    except Exception as e:
        logger.error("Apply reference fixes failed: %s", e, exc_info=True)
        return api_response(False, message=str(e), code=500)

@form_generator_bp.route('/generate', methods=['POST'])
def generate():
    try:
        data = request.json or {}
        template_text = data.get('template_text')
        
        is_array = True
        if template_text:
            parsed_result = parse_template(template_text)
            if parsed_result[0] is None:
                # Try to get more info if possible? No, parse_template logs it.
                return api_response(False, message="模板 JSON 格式错误，请检查是否有语法问题（如多余的逗号）", code=400)
            elements, is_array = parsed_result
        else:
            elements = data.get('elements', [])
        mode = data.get('mode', 'y')  # 'x', 'y', 'xy'
        y_spacing = float(data.get('y_spacing', 0))
        x_spacing = float(data.get('x_spacing', 0))
        count = int(data.get('count', 0))
        rows = int(data.get('rows', 0))
        cols = int(data.get('cols', 0))
        start_prefix = data.get('start_prefix', 'a')

        result = []
        if mode == 'xy':
            seq = 0
            for r in range(rows):
                for c in range(cols):
                    current_prefix = get_nth_prefix(start_prefix, seq)
                    seq += 1
                    for tmpl in elements:
                        item = copy.deepcopy(tmpl)
                        if "y" in item and item["y"] is not None:
                            item["y"] = round(item["y"] + r * y_spacing, 4)
                        if "x" in item and item["x"] is not None:
                            item["x"] = round(item["x"] + c * x_spacing, 4)
                        item["value"] = replace_value_prefix(item.get("value"), current_prefix)
                        result.append(item)
        else:
            spacing = y_spacing if mode == 'y' else x_spacing
            for i in range(count):
                current_prefix = get_nth_prefix(start_prefix, i)
                for tmpl in elements:
                    item = copy.deepcopy(tmpl)
                    if mode == 'y':
                        if "y" in item and item["y"] is not None:
                            item["y"] = round(item["y"] + i * spacing, 4)
                    elif mode == 'x':
                        if "x" in item and item["x"] is not None:
                            item["x"] = round(item["x"] + i * spacing, 4)
                    item["value"] = replace_value_prefix(item.get("value"), current_prefix)
                    result.append(item)

        if not is_array:
            formatted_text = json.dumps(result, ensure_ascii=False, indent=2)
            # Remove brackets
            formatted_text = re.sub(r'^\[\s*', '', formatted_text)
            formatted_text = re.sub(r'\s*\]$', '', formatted_text)
        else:
            formatted_text = json.dumps(result, ensure_ascii=False, indent=2)

        return api_response(True, {
            "data": result,
            "formatted_text": formatted_text,
            "total_count": len(result),
            "is_array": is_array
        })
    except Exception as e:
        logger.error(f"Form generation failed: {e}")
        return api_response(False, message=str(e), code=500)
