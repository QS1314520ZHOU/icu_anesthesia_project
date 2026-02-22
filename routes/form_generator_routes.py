from flask import Blueprint, request, jsonify
import copy
import json
import re
import logging

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
        return []
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
            return [data]
        elif isinstance(data, list):
            return data
        return []
    except Exception as e:
        logger.error(f"Failed to parse template JSON. Original text length: {len(raw_text)}. Error: {e}")
        # 返回 None 表示解析失败
        return None

@form_generator_bp.route('/generate', methods=['POST'])
def generate():
    try:
        data = request.json
        template_text = data.get('template_text')
        
        if template_text:
            elements = parse_template(template_text)
            if elements is None:
                # Try to get more info if possible? No, parse_template logs it.
                return jsonify({"success": False, "error": "模板 JSON 格式错误，请检查是否有语法问题（如多余的逗号）"}), 400
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

        return jsonify({
            "success": True,
            "data": result,
            "total_count": len(result)
        })
    except Exception as e:
        logger.error(f"Form generation failed: {e}")
        return jsonify({"success": False, "error": str(e)}), 500
