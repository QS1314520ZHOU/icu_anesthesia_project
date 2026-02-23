import copy
import json
import re
import os

_VALUE_PATTERN = re.compile(r'^([a-zA-Z]+)(\d+)$')


def read_clipboard():
    try:
        import subprocess
        result = subprocess.run(
            ['powershell', '-command',
             '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Clipboard'],
            capture_output=True, timeout=5
        )
        try:
            return result.stdout.decode('utf-8')
        except UnicodeDecodeError:
            pass
        try:
            return result.stdout.decode('gbk')
        except UnicodeDecodeError:
            pass
        return result.stdout.decode('utf-8', errors='ignore')
    except Exception as e:
        print("  读取剪贴板异常: " + str(e))
        return None


def parse_input_elements(raw_text):
    text = raw_text.strip()
    text = text.lstrip('\ufeff\u200b')
    first_char = ''
    for ch in text:
        if ch in ('{', '['):
            first_char = ch
            break
    is_array = (first_char == '[')
    brace_start = text.find('{')
    brace_end = text.rfind('}')
    bracket_start = text.find('[')
    bracket_end = text.rfind(']')
    if is_array and bracket_start != -1 and bracket_end != -1:
        text = text[bracket_start:bracket_end + 1]
    elif brace_start != -1 and brace_end != -1:
        text = text[brace_start:brace_end + 1]
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        print("  JSON解析失败: " + str(e))
        return None, False
    if isinstance(data, dict):
        data = [data]
    if not isinstance(data, list):
        print("  解析结果不是数组")
        return None, False
    print("  成功解析 " + str(len(data)) + " 个控件")
    print("  输入格式: " + ("数组" if is_array else "单个对象"))
    return data, is_array


def detect_prefix(elements):
    prefixes = []
    for el in elements:
        val = el.get("value")
        if val is None or not isinstance(val, str):
            continue
        m = _VALUE_PATTERN.match(val)
        if m:
            prefixes.append(m.group(1))
    if not prefixes:
        return None
    from collections import Counter
    return Counter(prefixes).most_common(1)[0][0]


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


def generate_single_axis(elements, mode, count, spacing, start_prefix):
    result = []
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
    return result


def generate_grid(elements, rows, cols, y_spacing, x_spacing, start_prefix):
    result = []
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
    return result, seq


def format_value(v):
    if v is None:
        return 'null'
    if isinstance(v, str):
        return '"' + v + '"'
    if v is True:
        return 'true'
    if v is False:
        return 'false'
    if isinstance(v, list) and not v:
        return '[]'
    if isinstance(v, dict) and not v:
        return '{}'
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False)
    return str(v)


def format_output(data, fmt, is_array):
    if fmt == 'json':
        if is_array:
            return json.dumps(data, ensure_ascii=False, indent=2)
        else:
            pieces = []
            for item in data:
                pieces.append(json.dumps(item, ensure_ascii=False, indent=2))
            return ',\n'.join(pieces)
    lines = []
    for doc in data:
        parts = []
        for k, v in doc.items():
            parts.append(k + ': ' + format_value(v))
        lines.append('    {' + ', '.join(parts) + '}')
    result = ',\n'.join(lines)
    if is_array:
        return '[\n' + result + '\n]'
    else:
        return result


def main():
    print("=" * 50)
    print("  表单控件批量生成器")
    print("=" * 50)

    print("")
    print("【第1步】读取模板JSON")
    print("  1 = 从剪贴板读取（先复制JSON，再选这个）")
    print("  2 = 从文件读取")
    choice = input("  请选择 [默认1]: ").strip()

    raw_text = ""

    if choice == '2':
        script_dir = os.path.dirname(os.path.abspath(__file__))
        default_file = os.path.join(script_dir, "template.json")
        if os.path.exists(default_file):
            print("  发现同目录下 template.json")
            file_path = input("  输入文件路径 [直接回车用template.json]: ").strip()
            if not file_path:
                file_path = default_file
        else:
            file_path = input("  输入文件路径: ").strip()
        if not os.path.exists(file_path):
            print("  文件不存在: " + file_path)
            return
        with open(file_path, 'r', encoding='utf-8') as f:
            raw_text = f.read()
        print("  已读取文件")
    else:
        print("  正在读取剪贴板...")
        raw_text = read_clipboard()
        if not raw_text or not raw_text.strip():
            print("  剪贴板为空，请先复制JSON内容再运行")
            return
        print("  已从剪贴板读取 " + str(len(raw_text)) + " 个字符")

    elements, is_array = parse_input_elements(raw_text)
    if not elements:
        return

    detected_prefix = detect_prefix(elements)
    if detected_prefix:
        print("  检测到value前缀: " + detected_prefix)
    else:
        print("  未检测到前缀")

    print("")
    print("【第2步】选择生成方向:")
    print("  y  = 往下生成（只有Y变，生成多行）")
    print("  x  = 往右生成（只有X变，生成多列）")
    print("  xy = 表格模式（X和Y都变，像Excel一样）")
    mode = input("  请输入 y / x / xy [默认y]: ").strip().lower()
    if mode not in ('x', 'y', 'xy'):
        mode = 'y'

    y_spacing = 0.0
    x_spacing = 0.0
    count = 0
    rows = 0
    cols = 0

    if mode == 'y':
        heights = [el.get("height", 2) for el in elements if el.get("height") is not None]
        default_y = max(heights) if heights else 2
        y_input = input("  Y方向间距（行高） [默认" + str(default_y) + "]: ").strip()
        y_spacing = float(y_input) if y_input else default_y
        count_input = input("  生成多少行（含原始行） [默认16]: ").strip()
        count = int(count_input) if count_input else 16

    elif mode == 'x':
        widths = [el.get("width", 3) for el in elements if el.get("width") is not None]
        default_x = max(widths) if widths else 3
        x_input = input("  X方向间距（列宽） [默认" + str(default_x) + "]: ").strip()
        x_spacing = float(x_input) if x_input else default_x
        count_input = input("  生成多少列（含原始列） [默认16]: ").strip()
        count = int(count_input) if count_input else 16

    elif mode == 'xy':
        heights = [el.get("height", 2) for el in elements if el.get("height") is not None]
        default_y = max(heights) if heights else 2
        y_input = input("  Y方向间距（行高） [默认" + str(default_y) + "]: ").strip()
        y_spacing = float(y_input) if y_input else default_y

        widths = [el.get("width", 3) for el in elements if el.get("width") is not None]
        default_x = max(widths) if widths else 3
        x_input = input("  X方向间距（列宽） [默认" + str(default_x) + "]: ").strip()
        x_spacing = float(x_input) if x_input else default_x

        rows_input = input("  生成多少行（含原始行） [默认16]: ").strip()
        rows = int(rows_input) if rows_input else 16
        cols_input = input("  生成多少列（含原始列） [默认16]: ").strip()
        cols = int(cols_input) if cols_input else 16

    if detected_prefix:
        default_start = detected_prefix
    else:
        default_start = 'a'
    start_input = input("  起始前缀 [默认" + default_start + "]: ").strip()
    start_prefix = start_input if start_input else default_start

    print("")
    print("【第3步】选择输出格式:")
    print("  1 = 标准JSON（推荐）")
    print("  2 = MongoDB Shell格式")
    fmt_input = input("  请选择 [默认1]: ").strip()
    fmt = 'mongo' if fmt_input == '2' else 'json'

    if mode == 'xy':
        result, total_groups = generate_grid(elements, rows, cols, y_spacing, x_spacing, start_prefix)
        end_prefix = get_nth_prefix(start_prefix, total_groups - 1)
        summary_line = "  " + str(rows) + "行 x " + str(cols) + "列 = " + str(total_groups) + "组"
        summary_line += ", 每组" + str(len(elements)) + "控件, 共" + str(len(result)) + "个文档"
        spacing_info = " Y间距=" + str(y_spacing) + " X间距=" + str(x_spacing)
    else:
        result = generate_single_axis(elements, mode, count, y_spacing if mode == 'y' else x_spacing, start_prefix)
        end_prefix = get_nth_prefix(start_prefix, count - 1)
        summary_line = "  " + str(count) + "组 x " + str(len(elements)) + "控件 = " + str(len(result)) + "个文档"
        if mode == 'y':
            spacing_info = " Y间距=" + str(y_spacing)
        else:
            spacing_info = " X间距=" + str(x_spacing)

    mode_label = {"y": "仅Y轴(往下)", "x": "仅X轴(往右)", "xy": "表格模式(行+列)"}

    print("")
    print("=" * 50)
    print("  生成完成!")
    print(summary_line)
    print("  方向: " + mode_label[mode] + spacing_info)
    print("  输出格式: " + ("保持数组[]" if is_array else "逗号分隔对象"))
    print("  前缀范围: " + start_prefix + " ~ " + end_prefix)
    print("=" * 50)
    print("")

    output = format_output(result, fmt, is_array)
    print(output)

    try:
        import subprocess
        p = subprocess.Popen(['clip'], stdin=subprocess.PIPE)
        p.communicate(output.encode('utf-8'))
        print("")
        print("  -> 已自动复制到剪贴板")
    except Exception:
        pass


if __name__ == "__main__":
    main()
