# routes/alignment_routes.py
"""
接口文档对齐中心 - 路由层
"""

import os
from flask import Blueprint, request, current_app
from werkzeug.utils import secure_filename
from services.alignment_service import alignment_service
from utils.response_utils import api_response

alignment_bp = Blueprint('alignment', __name__, url_prefix='/api/alignment')

ALLOWED_DOC_EXT = {'pdf', 'doc', 'docx', 'txt', 'xml', 'json', 'wsdl', 'xsd', 'hl7'}


def _allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_DOC_EXT


# ============================================================
#  标准接口库 API
# ============================================================

@alignment_bp.route('/specs/versions', methods=['GET'])
def get_spec_versions():
    """获取所有标准版本列表"""
    versions = alignment_service.get_spec_versions()
    return api_response(True, versions)


@alignment_bp.route('/specs', methods=['GET'])
def get_spec_interfaces():
    """获取某版本的全部接口定义"""
    version = request.args.get('version', '')
    if not version:
        return api_response(False, error='缺少 version 参数')
    data = alignment_service.get_spec_interfaces(version)
    return api_response(True, data)


@alignment_bp.route('/specs', methods=['POST'])
def save_spec_interface():
    """新增/更新标准接口"""
    data = request.json
    if not data or not data.get('interface_name'):
        return api_response(False, error='缺少接口名称')
    spec_id = alignment_service.save_spec_interface(data)
    return api_response(True, {'id': spec_id})


@alignment_bp.route('/specs/<int:spec_id>', methods=['DELETE'])
def delete_spec_interface(spec_id):
    """删除标准接口"""
    alignment_service.delete_spec_interface(spec_id)
    return api_response(True)


@alignment_bp.route('/specs/import', methods=['POST'])
def import_spec_from_file():
    """上传文档 → AI 解析 → 自动导入标准库"""
    if 'file' not in request.files:
        return api_response(False, error='未上传文件')

    file = request.files['file']
    if not file.filename or not _allowed_file(file.filename):
        return api_response(False, error='不支持的文件格式')

    spec_version = request.form.get('spec_version', '手麻标准 V1.0')
    category = request.form.get('category', 'common')

    # 保存文件
    upload_dir = os.path.join(current_app.root_path, 'uploads', 'specs')
    os.makedirs(upload_dir, exist_ok=True)
    filename = secure_filename(file.filename)
    file_path = os.path.join(upload_dir, filename)
    file.save(file_path)

    result = alignment_service.import_spec_from_file(
        file_path, spec_version, category)
    return api_response(result['success'], result)


# ============================================================
#  对方文档解析 (独立测试用)
# ============================================================

@alignment_bp.route('/parse-vendor', methods=['POST'])
def parse_vendor_document():
    """解析对方文档，返回结构化接口列表（不做对齐）"""
    raw_text = None
    file_path = None

    if 'file' in request.files:
        file = request.files['file']
        if file.filename and _allowed_file(file.filename):
            upload_dir = os.path.join(
                current_app.root_path, 'uploads', 'vendor_docs')
            os.makedirs(upload_dir, exist_ok=True)
            filename = secure_filename(file.filename)
            file_path = os.path.join(upload_dir, filename)
            file.save(file_path)
    elif request.is_json:
        raw_text = request.json.get('raw_text', '')
    else:
        raw_text = request.form.get('raw_text', '')

    if not file_path and not raw_text:
        return api_response(False, error='未提供文档内容')

    interfaces = alignment_service.parse_vendor_document(
        file_path=file_path, raw_text=raw_text)
    return api_response(True, interfaces)


# ============================================================
#  对齐流程 API
# ============================================================

@alignment_bp.route('/run', methods=['POST'])
def run_alignment():
    """
    执行一键智能比对
    支持 multipart/form-data (有文件) 或 JSON (粘贴文本)
    """
    project_id = None
    spec_version = ''
    vendor_name = ''
    file_path = None
    raw_text = None

    if request.content_type and 'multipart' in request.content_type:
        project_id = request.form.get('project_id', type=int)
        spec_version = request.form.get('spec_version', '')
        vendor_name = request.form.get('vendor_name', '')
        raw_text = request.form.get('raw_text', '')

        if 'file' in request.files:
            file = request.files['file']
            if file.filename and _allowed_file(file.filename):
                upload_dir = os.path.join(
                    current_app.root_path, 'uploads', 'vendor_docs')
                os.makedirs(upload_dir, exist_ok=True)
                filename = secure_filename(file.filename)
                file_path = os.path.join(upload_dir, filename)
                file.save(file_path)
    else:
        data = request.json or {}
        project_id = data.get('project_id')
        spec_version = data.get('spec_version', '')
        vendor_name = data.get('vendor_name', '')
        raw_text = data.get('raw_text', '')

    if not project_id:
        return api_response(False, error='缺少 project_id')
    if not spec_version:
        return api_response(False, error='缺少 spec_version (标准版本)')
    if not file_path and not raw_text:
        return api_response(False, error='请上传文档或粘贴文本')

    result = alignment_service.run_alignment(
        project_id=project_id,
        spec_version=spec_version,
        vendor_name=vendor_name,
        file_path=file_path,
        raw_text=raw_text,
    )
    return api_response(result['success'], result)


@alignment_bp.route('/sessions', methods=['GET'])
def get_sessions():
    """获取项目的所有对齐会话"""
    project_id = request.args.get('project_id', type=int)
    if not project_id:
        return api_response(False, error='缺少 project_id')
    sessions = alignment_service.get_sessions(project_id)
    return api_response(True, sessions)


@alignment_bp.route('/sessions/<int:session_id>', methods=['GET'])
def get_session_detail(session_id):
    """获取对齐会话详情"""
    detail = alignment_service.get_session_detail(session_id)
    if not detail:
        return api_response(False, error='会话不存在')
    return api_response(True, detail)


@alignment_bp.route('/sessions/<int:session_id>', methods=['DELETE'])
def delete_session(session_id):
    """删除对齐会话"""
    alignment_service.delete_session(session_id)
    return api_response(True)


@alignment_bp.route('/results/<int:result_id>/confirm', methods=['POST'])
def confirm_result(result_id):
    """人工确认某条对齐结果"""
    data = request.json or {}
    alignment_service.confirm_result(
        result_id,
        confirmed_by=data.get('confirmed_by', 'system'),
        manual_note=data.get('manual_note', ''),
    )
    return api_response(True)


@alignment_bp.route('/field-maps/<int:map_id>', methods=['PUT'])
def update_field_map(map_id):
    """手动修正字段映射"""
    data = request.json or {}
    alignment_service.update_field_map(
        map_id,
        vendor_field_name=data.get('vendor_field_name', ''),
        transform_rule=data.get('transform_rule', ''),
    )
    return api_response(True)


# ============================================================
#  AI 请求生成器
# ============================================================

@alignment_bp.route('/ai-assistant', methods=['POST'])
def ai_assistant():
    """AI 对接助手 - 根据对齐结果回答问题/生成请求"""
    data = request.json or {}
    session_id = data.get('session_id')
    question = data.get('question', '')
    if not session_id or not question:
        return api_response(False, error='缺少 session_id 或 question')

    result = alignment_service.ai_generate_request(session_id, question)
    return api_response(True, result)
