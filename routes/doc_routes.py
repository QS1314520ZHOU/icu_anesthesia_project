import os
import flask
from flask import Blueprint, request, current_app, send_file
from services.doc_service import doc_service
from utils.response_utils import api_response
from utils.file_utils import allowed_file, get_upload_path

doc_bp = Blueprint('doc', __name__, url_prefix='/api')

# --- Documents ---
@doc_bp.route('/projects/<int:project_id>/documents', methods=['GET'])
def get_project_documents(project_id):
    docs = doc_service.get_project_documents(project_id)
    return api_response(True, docs)

@doc_bp.route('/projects/<int:project_id>/documents', methods=['POST'])
def add_project_document(project_id):
    if 'file' not in request.files:
        data = request.form.to_dict() if request.form else request.json
        doc_service.add_project_document(project_id, data)
        return api_response(True)
    
    file = request.files['file']
    if file.filename == '':
        return api_response(False, message="未选择文件", code=400)
    
    if file and allowed_file(file.filename):
        try:
            from storage_service import storage_service
            # Upload to Baidu Netdisk
            remote_path = storage_service.upload_file(file, project_id)
            
            data = request.form.to_dict() if request.form else {}
            # File size is not easily available after stream upload unless we seek/tell or read it
            # storage_service.upload_file saves to temp first, so maybe we can get size there?
            # For now let's set size to 0 or try to get it from request content_length if possible
            # But wait, storage_service uploads from a temp file.
            # Let's fix storage_service to return size or just accept 0 for now.
            # Actually, `file` (FileStorage) has `content_length` acting as size in some WSGI containers, 
            # or `seek(0, os.SEEK_END)` -> `tell()` -> `seek(0)`
            # Simple approach: request.content_length (approx) or 0
            file_size = request.content_length or 0

            file_info = {
                'path': remote_path,
                'size': file_size,
                'filename': file.filename
            }
            doc_service.add_project_document(project_id, data, file_info)
            return api_response(True, data={'file_path': remote_path})
        except Exception as e:
            return api_response(False, message=f"上传失败: {str(e)}", code=500)
    
    return api_response(False, message="不支持的文件类型", code=400)

@doc_bp.route('/documents/<int:doc_id>', methods=['DELETE'])
def delete_document(doc_id):
    doc_service.delete_document(doc_id)
    return api_response(True)

@doc_bp.route('/documents/<int:doc_id>/download', methods=['GET'])
def download_document(doc_id):
    doc = doc_service.get_document_info(doc_id)
    if not doc or not doc['file_path']:
        return api_response(False, message="文件记录不存在", code=404)
        
    try:
        from storage_service import storage_service
        # Check if it's a local file (legacy) or remote
        if os.path.exists(doc['file_path']):
             return send_file(doc['file_path'], as_attachment=True, download_name=doc['doc_name'])
        
        # Assume it's a remote path
        local_temp_path = storage_service.download_file(doc['file_path'])
        
        # Use after_this_request to clean up
        @flask.after_this_request
        def remove_file(response):
            try:
                if os.path.exists(local_temp_path):
                    os.remove(local_temp_path)
                    # Try to remove the temp dir if empty
                    os.rmdir(os.path.dirname(local_temp_path))
            except Exception as e:
                current_app.logger.error(f"Error removing temp file: {e}")
            return response
            
        return send_file(local_temp_path, as_attachment=True, download_name=doc['doc_name'])
    except Exception as e:
         return api_response(False, message=f"下载失败: {str(e)}", code=500)

# --- Expenses ---
@doc_bp.route('/projects/<int:project_id>/expenses', methods=['GET'])
def get_project_expenses(project_id):
    expenses = doc_service.get_project_expenses(project_id)
    return api_response(True, expenses)

@doc_bp.route('/projects/<int:project_id>/expenses', methods=['POST'])
def add_project_expense(project_id):
    data = request.json
    doc_service.add_project_expense(project_id, data)
    return api_response(True)

@doc_bp.route('/expenses/<int:expense_id>', methods=['PUT'])
def update_expense(expense_id):
    data = request.json
    doc_service.update_expense(expense_id, data)
    return api_response(True)

@doc_bp.route('/expenses/<int:expense_id>', methods=['DELETE'])
def delete_expense(expense_id):
    doc_service.delete_expense(expense_id)
    return api_response(True)

@doc_bp.route('/projects/<int:project_id>/expenses/stats', methods=['GET'])
def get_expense_stats(project_id):
    stats = doc_service.get_expense_stats(project_id)
    return api_response(True, stats)
