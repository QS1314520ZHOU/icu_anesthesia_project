from services.interface_parser_service import interface_parser
import json

# Mock data
doc_text = "test document"
parsed = [
    {
        "interface_name": "Test Interface",
        "system_type": "HIS",
        "transcode": "TEST_001",
        "fields": [
            {"field_name": "f1", "field_name_cn": "字段1"}
        ]
    }
]

try:
    ids = interface_parser.save_parsed_specs(None, None, parsed, 'our_standard', category='测试', raw_text=doc_text)
    print(f"Success! IDs: {ids}")
except Exception as e:
    import traceback
    traceback.print_exc()
