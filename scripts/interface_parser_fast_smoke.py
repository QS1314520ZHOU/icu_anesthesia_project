import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.interface_parser_service import interface_parser


SAMPLE_DOC = """
1、住院病人信息接口
交易码 <transcode>VI_ICU_ZYBR</transcode>
请求消息:
<request>
  <pid>123</pid>
  <mrn>ZY0001</mrn>
  <name>张三</name>
  <gender>男</gender>
</request>

字段名        中文名       类型       必填       说明
pid          患者ID       varchar    是         患者唯一号
mrn          住院号       varchar    是         住院号
name         姓名         varchar    是         患者姓名
gender       性别         varchar    否         性别
"""


def main():
    parsed = interface_parser.parse_document_with_ai(SAMPLE_DOC, "vendor", "fast-smoke")
    print("[PARSER_FAST] local_parse")
    if not parsed:
        print("  result: FAIL")
        raise SystemExit(1)
    first = parsed[0]
    fields = first.get("fields") or []
    names = {field.get("field_name") for field in fields}
    ok = first.get("transcode") == "VI_ICU_ZYBR" and {"pid", "mrn", "name"}.issubset(names)
    print(f"  interfaces: {len(parsed)}")
    print(f"  fields: {len(fields)}")
    print(f"  transcode: {first.get('transcode')}")
    print(f"  result: {'OK' if ok else 'FAIL'}")
    if not ok:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
