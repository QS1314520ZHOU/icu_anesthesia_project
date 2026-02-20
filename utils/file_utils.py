import os
from werkzeug.utils import secure_filename

ALLOWED_EXTENSIONS = {'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'png', 'jpg', 'jpeg', 'zip', 'rar'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def get_upload_path(folder, project_id, filename):
    import datetime
    timestamp = datetime.datetime.now().strftime('%Y%m%d%H%M%S')
    # Use secure_filename to prevent directory traversal
    safe_name = secure_filename(filename)
    new_filename = f"{project_id}_{timestamp}_{safe_name}"
    return os.path.join(folder, new_filename), new_filename
