"""
接口文档智能对照 - 路由层
所有 API 挂载在 /api 前缀下
"""
from flask import Blueprint, request
from services.interface_parser_service import interface_parser
from services.interface_comparison_service import comparison_service
from database import DatabasePool
from api_utils import api_response

spec_bp = Blueprint('interface_spec', __name__, url_prefix='/api')


# ========== 1. 文档解析 ==========

@spec_bp.route('/projects/<int:project_id>/interface-specs/parse', methods=['POST'])
def parse_interface_doc(project_id):
    """
    上传接口文档文本并 AI 解析为结构化接口。
    Body JSON: {
        "doc_text": "文档全文内容",
        "spec_source": "our_standard" 或 "vendor",
        "vendor_name": "厂商名(对方文档时填)",
        "doc_id": 可选, 关联 project_documents 表的 id
    }
    """
    data = request.json or {}
    doc_text = data.get('doc_text', '').strip()
    if not doc_text:
        return api_response(False, message='文档内容不能为空')

    spec_source = data.get('spec_source', 'vendor')
    category = data.get('category')
    vendor_name = data.get('vendor_name', '')
    doc_id = data.get('doc_id')

    # 我方标准可以不绑定项目 (project_id 传 None 存为全局)
    save_project_id = None if spec_source == 'our_standard' and data.get('as_global') else project_id

    # AI 解析
    parsed = interface_parser.parse_document_with_ai(doc_text, spec_source, vendor_name)
    if not parsed:
        return api_response(False, message='AI 解析未能提取到接口定义，请检查文档内容或格式')

    # 持久化
    created_ids = interface_parser.save_parsed_specs(save_project_id, doc_id, parsed, spec_source, vendor_name, category)

    return api_response(True, {
        'parsed_count': len(parsed),
        'spec_ids': created_ids,
        'interfaces': [{
            'name': p.get('interface_name', ''),
            'transcode': p.get('transcode', ''),
            'system_type': p.get('system_type', ''),
            'fields_count': len(p.get('fields', []))
        } for p in parsed]
    })


@spec_bp.route('/interface-specs/parse-standard', methods=['POST'])
def parse_our_standard():
    """
    上传并解析我方标准接口文档（全局标准，不绑定项目）。
    Body JSON: { "doc_text": "...", "doc_id": 可选 }
    """
    data = request.json or {}
    doc_text = data.get('doc_text', '').strip()
    if not doc_text:
        return api_response(False, message='文档内容不能为空')

    parsed = interface_parser.parse_document_with_ai(doc_text, 'our_standard')
    if not parsed:
        return api_response(False, message='解析失败')

    created_ids = interface_parser.save_parsed_specs(None, data.get('doc_id'), parsed, 'our_standard', category=data.get('category'))
    return api_response(True, {
        'parsed_count': len(parsed),
        'spec_ids': created_ids,
        'interfaces': [{
            'name': p.get('interface_name', ''),
            'transcode': p.get('transcode', ''),
            'fields_count': len(p.get('fields', []))
        } for p in parsed]
    })


# ========== 2. 接口规范查询 ==========

@spec_bp.route('/projects/<int:project_id>/interface-specs', methods=['GET'])
def get_interface_specs(project_id):
    """获取项目的所有已解析接口规范(含字段)"""
    source = request.args.get('source')  # our_standard / vendor
    category = request.args.get('category')
    specs = interface_parser.get_specs_by_project(project_id, source, category)
    return api_response(True, specs)


@spec_bp.route('/interface-specs/standard', methods=['GET'])
def get_standard_specs():
    """获取全局标准接口规范"""
    specs = interface_parser.get_specs_by_project(None, 'our_standard')
    return api_response(True, specs)


@spec_bp.route('/interface-specs/<int:spec_id>', methods=['DELETE'])
def delete_spec(spec_id):
    """删除一个接口规范及其字段"""
    interface_parser.delete_spec(spec_id)
    return api_response(True, message='已删除')


# ========== 3. 智能对照 ==========

@spec_bp.route('/projects/<int:project_id>/interface-comparison/run', methods=['POST'])
def run_comparison(project_id):
    """一键执行接口对照（我方标准 vs 该项目的对方文档）"""
    data = request.json or {}
    category = data.get('category')
    result = comparison_service.run_full_comparison(project_id, category)
    return api_response(True, result)


@spec_bp.route('/projects/<int:project_id>/interface-comparisons', methods=['GET'])
def get_comparisons(project_id):
    """获取项目所有对照结果概览"""
    with DatabasePool.get_connection() as conn:
        rows = conn.execute('''
            SELECT ic.id, ic.our_spec_id, ic.vendor_spec_id, ic.match_type,
                   ic.match_confidence, ic.gap_count, ic.transform_count,
                   ic.status, ic.summary, ic.created_at,
                   os.interface_name as our_name, os.transcode as our_transcode, os.system_type,
                   vs.interface_name as vendor_name, vs.transcode as vendor_transcode, vs.vendor_name as vendor_company
            FROM interface_comparisons ic
            LEFT JOIN interface_specs os ON ic.our_spec_id = os.id
            LEFT JOIN interface_specs vs ON ic.vendor_spec_id = vs.id
            WHERE ic.project_id = ?
            ORDER BY ic.gap_count DESC, os.system_type
        ''', (project_id,)).fetchall()
    return api_response(True, [dict(r) for r in rows])


@spec_bp.route('/interface-comparisons/<int:comp_id>/detail', methods=['GET'])
def get_comparison_detail(comp_id):
    """获取单个对照的字段级映射详情"""
    with DatabasePool.get_connection() as conn:
        comp = conn.execute('SELECT * FROM interface_comparisons WHERE id = ?', (comp_id,)).fetchone()
        if not comp:
            return api_response(False, message='对照记录不存在', code=404)
        comp = dict(comp)
        mappings = [dict(m) for m in conn.execute(
            'SELECT * FROM field_mappings WHERE comparison_id = ? ORDER BY mapping_status, our_field_name',
            (comp_id,)
        ).fetchall()]
    comp['mappings'] = mappings
    return api_response(True, comp)


# ========== 4. AI 报告 ==========

@spec_bp.route('/projects/<int:project_id>/interface-comparison/report', methods=['GET'])
def get_comparison_report(project_id):
    """AI 生成该项目的接口对照分析报告"""
    report = comparison_service.generate_ai_report(project_id)
    return api_response(True, {'report': report})


# ========== 5. 字段映射确认 ==========

@spec_bp.route('/field-mappings/<int:mapping_id>/confirm', methods=['PUT'])
def confirm_mapping(mapping_id):
    """工程师手动确认/修正字段映射"""
    data = request.json or {}
    with DatabasePool.get_connection() as conn:
        updates = []
        params = []
        if 'mapping_status' in data:
            updates.append('mapping_status = ?')
            params.append(data['mapping_status'])
        if 'transform_rule' in data:
            updates.append('transform_rule = ?')
            params.append(data['transform_rule'])
        if 'remark' in data:
            updates.append('remark = ?')
            params.append(data['remark'])
        updates.append('is_confirmed = 1')
        params.append(mapping_id)

        conn.execute(f"UPDATE field_mappings SET {', '.join(updates)} WHERE id = ?", params)
        conn.commit()
    return api_response(True, message='已确认')


@spec_bp.route('/interface-comparisons/<int:comp_id>/status', methods=['PUT'])
def update_comparison_status(comp_id):
    """更新对照结果的审核状态"""
    data = request.json or {}
    with DatabasePool.get_connection() as conn:
        conn.execute('''
            UPDATE interface_comparisons SET status = ?, reviewed_by = ?, 
            reviewed_at = CURRENT_TIMESTAMP WHERE id = ?
        ''', (data.get('status', 'reviewed'), data.get('reviewed_by', ''), comp_id))
        conn.commit()
    return api_response(True)