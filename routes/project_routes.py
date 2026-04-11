from flask import Blueprint, request, jsonify, current_app
import json
import os
from services.project_service import project_service
from utils.response_utils import api_response

project_bp = Blueprint('project', __name__, url_prefix='/api')

@project_bp.route('/templates/<template_id>', methods=['GET'])
def get_template(template_id):
    try:
        json_path = os.path.join(current_app.root_path, 'static', 'data', 'project_templates.json')
        if not os.path.exists(json_path):
            return api_response(False, None, 'Template file not found')
            
        with open(json_path, 'r', encoding='utf-8') as f:
            templates = json.load(f)
            
        template = next((t for t in templates if t['id'] == template_id), None)
        
        if template:
            return api_response(True, template)
        else:
            return api_response(False, None, 'Template not found')
    except Exception as e:
        return api_response(False, None, str(e))

@project_bp.route('/projects/geo', methods=['GET'])
def get_geo_stats():
    data = project_service.get_geo_stats()
    return api_response(True, data)

@project_bp.route('/projects', methods=['GET'])
def get_projects():
    try:
        keyword = request.args.get('keyword')
        status = request.args.get('status')
        page = request.args.get('page', 1, type=int)
        page_size = request.args.get('page_size', 20, type=int)
        sort_by = request.args.get('sort_by', 'created_at')
        sort_order = request.args.get('sort_order', 'desc')
        projects = project_service.get_all_projects(
            is_admin=True,
            keyword=keyword,
            status=status,
            page=page,
            page_size=page_size,
            sort_by=sort_by,
            sort_order=sort_order
        )
        return api_response(True, projects)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return api_response(False, error=str(e) + "\n" + traceback.format_exc(), code=500)

@project_bp.route('/projects', methods=['POST'])
def create_project():
    data = request.json or {}
    project_id = project_service.create_project(data)
    return api_response(True, {'project_id': project_id})

@project_bp.route('/projects/createfromtemplate/<int:template_id>', methods=['POST'])
@project_bp.route('/projects/create-from-template/<int:template_id>', methods=['POST'])
def create_project_from_template(template_id):
    payload = request.json or {}
    result = project_service.create_project_from_template(template_id, overrides=payload)
    if result.get('error'):
        return api_response(False, message=result['error'], code=404)
    return api_response(True, result)

@project_bp.route('/projects/<int:project_id>', methods=['GET'])
def get_project_detail(project_id):
    project = project_service.get_project_detail(project_id)
    if not project:
        return api_response(False, error="Project not found", code=404)
    return api_response(True, project)

@project_bp.route('/projects/<int:project_id>', methods=['PUT'])
def update_project(project_id):
    data = request.json or {}
    success = project_service.update_project(project_id, data)
    return api_response(bool(success))

@project_bp.route('/projects/<int:project_id>/status', methods=['PUT'])
def update_project_status(project_id):
    data = request.json or {}
    project_service.update_project_status(project_id, data.get('status'))
    return api_response(True)


@project_bp.route('/projects/<int:project_id>/ai-risk-score', methods=['POST'])
def get_project_ai_risk_score(project_id):
    """
    项目风险预警分析 (对接前端 dashboard)
    """
    from database import DatabasePool
    from ai_utils import call_ai
    from ai_config import TaskType
    import re

    with DatabasePool.get_connection() as conn:
        row = conn.execute(DatabasePool.format_sql("SELECT * FROM projects WHERE id = ?"), (project_id,)).fetchone()
        if not row:
            return jsonify({'error': '项目不存在'}), 404
            
        project = dict(row)
        logs_raw = conn.execute(
            DatabasePool.format_sql("SELECT work_content, issues_encountered FROM work_logs WHERE project_id = ? ORDER BY log_date DESC LIMIT 5"),
            (project_id,),
        ).fetchall()
        logs = [f"内容: {r['work_content']}, 问题: {r['issues_encountered']}" for r in logs_raw]
        issues_raw = conn.execute(
            DatabasePool.format_sql("SELECT description, severity, status FROM issues WHERE project_id = ? AND status != '已解决'"),
            (project_id,),
        ).fetchall()
        issues = [f"[{r['severity']}] {r['description']} ({r['status']})" for r in issues_raw]

    # 构建 Prompt
    prompt = f"""
你是一位资深的医疗信息化交付专家。请分析以下项目的【交付风险】。

【项目信息】:
名称: {project['project_name']}
当前状态: {project['status']}
进度: {project['progress']}%
床位数/手术室: {project.get('icu_beds',0)}/{project.get('operating_rooms',0)}

【近期日志摘要】:
{chr(10).join(logs) if logs else "无近期日志"}

【存疑问题】:
{chr(10).join(issues) if issues else "无未解决问题"}

请根据以上信息计算一个【风险分数】 (0-100，0为安全，100为极高危)，并给出 1-2 句简洁的分析建议。
必须严格按以下 JSON 格式回复:
{{"risk_score": 45, "analysis": "主要风险在于接口联调滞后..."}}
"""
    res_text = call_ai(prompt, TaskType.ANALYSIS)
    
    # 解析 JSON
    try:
        json_match = re.search(r'\{.*\}', res_text, re.DOTALL)
        if json_match:
            res_data = json.loads(json_match.group())
        else:
            res_data = {"risk_score": 0, "analysis": "分析失败: 未能从 AI 回复中提取 JSON"}
    except Exception as e:
        res_data = {"risk_score": 0, "analysis": f"解析异常: {str(e)}"}
        
    return jsonify(res_data)


# --- Stages ---
@project_bp.route('/projects/<int:project_id>/stages', methods=['POST'])
def add_stage(project_id):
    data = request.json or {}
    try:
        project_service.add_stage(project_id, data)
        return api_response(True)
    except Exception as e:
        return api_response(False, error=str(e))

@project_bp.route('/projects/stages/<int:stage_id>/scale', methods=['POST'])
def update_stage_scale(stage_id):
    data = request.json or {}
    try:
        success = project_service.update_stage_scale(stage_id, data.get('quantity', 0))
        return api_response(success)
    except Exception as e:
        return api_response(False, error=str(e))

# --- Milestones ---
@project_bp.route('/projects/<int:project_id>/milestones', methods=['GET'])
def get_milestones(project_id):
    milestones = project_service.get_milestones(project_id)
    return api_response(True, milestones)

@project_bp.route('/projects/<int:project_id>/milestones', methods=['POST'])
def add_milestone(project_id):
    data = request.json or {}
    project_service.add_milestone(project_id, data)
    return api_response(True)

@project_bp.route('/projects/milestones/<int:mid>/toggle', methods=['POST'])
def toggle_milestone(mid):
    project_service.toggle_milestone(mid)
    return api_response(True)

@project_bp.route('/projects/milestones/<int:mid>', methods=['DELETE'])
def delete_milestone(mid):
    project_service.delete_milestone(mid)
    return api_response(True)

# --- Interfaces ---
@project_bp.route('/projects/<int:project_id>/interfaces', methods=['GET'])
def get_interfaces(project_id):
    interfaces = project_service.get_interfaces(project_id)
    return api_response(True, interfaces)

@project_bp.route('/projects/<int:project_id>/interfaces', methods=['POST'])
def add_interface(project_id):
    data = request.json or {}
    project_service.add_interface(project_id, data)
    return api_response(True)

@project_bp.route('/projects/interfaces/<int:interface_id>', methods=['PUT'])
def update_interface(interface_id):
    data = request.json or {}
    project_service.update_interface(interface_id, data)
    return api_response(True)

@project_bp.route('/projects/interfaces/<int:interface_id>', methods=['DELETE'])
def delete_interface(interface_id):
    project_service.delete_interface(interface_id)
    return api_response(True)

# --- Issues ---
@project_bp.route('/projects/<int:project_id>/issues', methods=['GET'])
def get_issues(project_id):
    issues = project_service.get_issues(project_id)
    return api_response(True, issues)

@project_bp.route('/projects/<int:project_id>/issues', methods=['POST'])
def add_issue(project_id):
    data = request.json or {}
    result = project_service.add_issue(project_id, data)
    return api_response(True, result)

# --- Devices ---
@project_bp.route('/projects/<int:project_id>/devices', methods=['GET'])
def get_devices(project_id):
    devices = project_service.get_devices(project_id)
    return api_response(True, devices)

@project_bp.route('/projects/<int:project_id>/devices', methods=['POST'])
def add_device(project_id):
    data = request.json or {}
    project_service.add_device(project_id, data)
    return api_response(True)

# --- Bed Units ---
@project_bp.route('/projects/<int:project_id>/bed-units', methods=['GET'])
def list_bed_units(project_id):
    return api_response(True, project_service.list_bed_units(project_id))

@project_bp.route('/projects/<int:project_id>/bed-units', methods=['POST'])
def create_bed_unit(project_id):
    bed_unit_id = project_service.create_bed_unit(project_id, request.json or {})
    return api_response(True, {'bed_unit_id': bed_unit_id})

@project_bp.route('/bed-units/<int:bed_unit_id>', methods=['PUT'])
def update_bed_unit(bed_unit_id):
    ok = project_service.update_bed_unit(bed_unit_id, request.json or {})
    return api_response(bool(ok))

@project_bp.route('/bed-units/<int:bed_unit_id>', methods=['DELETE'])
def delete_bed_unit(bed_unit_id):
    project_service.delete_bed_unit(bed_unit_id)
    return api_response(True)

@project_bp.route('/bed-units/<int:bed_unit_id>/devices', methods=['GET'])
def list_bed_unit_devices(bed_unit_id):
    return api_response(True, project_service.list_bed_unit_devices(bed_unit_id))

@project_bp.route('/bed-units/<int:bed_unit_id>/devices', methods=['POST'])
def create_bed_unit_device(bed_unit_id):
    device_id = project_service.create_bed_unit_device(bed_unit_id, request.json or {})
    return api_response(True, {'device_id': device_id})

@project_bp.route('/bed-unit-devices/<int:device_id>', methods=['PUT'])
def update_bed_unit_device(device_id):
    ok = project_service.update_bed_unit_device(device_id, request.json or {})
    return api_response(bool(ok))

@project_bp.route('/bed-unit-devices/<int:device_id>', methods=['DELETE'])
def delete_bed_unit_device(device_id):
    project_service.delete_bed_unit_device(device_id)
    return api_response(True)

@project_bp.route('/bed-units/summary', methods=['GET'])
def get_bed_unit_progress_summary():
    return api_response(True, project_service.get_bed_unit_progress_summary())

# --- Contract Payment Milestones ---
@project_bp.route('/projects/<int:project_id>/payment-milestones', methods=['GET'])
def list_contract_payment_milestones(project_id):
    return api_response(True, project_service.list_contract_payment_milestones(project_id))

@project_bp.route('/projects/<int:project_id>/payment-milestones', methods=['POST'])
def create_contract_payment_milestone(project_id):
    milestone_id = project_service.create_contract_payment_milestone(project_id, request.json or {})
    return api_response(True, {'milestone_id': milestone_id})

@project_bp.route('/payment-milestones/<int:milestone_id>', methods=['PUT'])
def update_contract_payment_milestone(milestone_id):
    success = project_service.update_contract_payment_milestone(milestone_id, request.json or {})
    return api_response(bool(success))

@project_bp.route('/payment-milestones/<int:milestone_id>', methods=['DELETE'])
def delete_contract_payment_milestone(milestone_id):
    project_service.delete_contract_payment_milestone(milestone_id)
    return api_response(True)

# --- Task Dependencies ---
@project_bp.route('/projects/<int:project_id>/dependencies', methods=['GET'])
def get_task_dependencies(project_id):
    deps = project_service.get_task_dependencies(project_id)
    return api_response(True, deps)

@project_bp.route('/projects/<int:project_id>/dependencies', methods=['POST'])
def add_task_dependency(project_id):
    data = request.json or {}
    project_service.add_task_dependency(data)
    return api_response(True)

@project_bp.route('/projects/dependencies/<int:dep_id>', methods=['DELETE'])
def delete_task_dependency(dep_id):
    project_service.delete_task_dependency(dep_id)
    return api_response(True)

# --- Milestone Celebrations & Retrospectives ---
@project_bp.route('/projects/<int:project_id>/milestones/pending-celebrations', methods=['GET'])
def get_pending_celebrations(project_id):
    """获取待庆祝的里程碑"""
    milestones = project_service.get_pending_celebrations(project_id)
    return api_response(True, [dict(m) for m in milestones])

@project_bp.route('/projects/milestones/<int:mid>/celebrated', methods=['POST'])
def mark_celebrated(mid):
    """标记里程碑为已庆祝"""
    project_service.mark_milestone_celebrated(mid)
    return api_response(True)

@project_bp.route('/projects/<int:project_id>/milestones/clear-celebrations', methods=['POST'])
def clear_celebrations(project_id):
    """清除项目下的所有待庆祝里程碑状态"""
    project_service.clear_pending_celebrations(project_id)
    return api_response(True)

@project_bp.route('/projects/milestones/<int:mid>/retrospective', methods=['POST'])
def add_retrospective(mid):
    """添加里程碑复盘"""
    data = request.json or {}
    project_service.add_milestone_retrospective(mid, data)
    return api_response(True)
