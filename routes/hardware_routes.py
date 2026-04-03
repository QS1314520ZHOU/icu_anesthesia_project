from flask import Blueprint, request
from api_utils import api_response
from services.hardware_service import hardware_service


hardware_bp = Blueprint('hardware', __name__, url_prefix='/api')


@hardware_bp.route('/assets', methods=['GET'])
def list_assets():
    try:
        status = request.args.get('status')
        return api_response(True, hardware_service.list_assets(status=status))
    except Exception as e:
        return api_response(False, message=str(e), code=500)


@hardware_bp.route('/assets/<int:asset_id>', methods=['GET'])
def get_asset(asset_id):
    try:
        asset = hardware_service.get_asset(asset_id)
        if not asset:
            return api_response(False, message='资产不存在', code=404)
        return api_response(True, asset)
    except Exception as e:
        return api_response(False, message=str(e), code=500)


@hardware_bp.route('/assets', methods=['POST'])
def create_asset():
    try:
        data = request.json or {}
        if not data.get('asset_name'):
            return api_response(False, message='asset_name 不能为空', code=400)
        asset = hardware_service.create_asset(data)
        return api_response(True, asset, message='资产创建成功')
    except Exception as e:
        return api_response(False, message=str(e), code=500)


@hardware_bp.route('/assets/<int:asset_id>', methods=['PUT'])
@hardware_bp.route('/assets/<int:asset_id>/status', methods=['PUT'])
def update_asset(asset_id):
    try:
        asset = hardware_service.update_asset(asset_id, request.json or {})
        if not asset:
            return api_response(False, message='资产不存在', code=404)
        return api_response(True, asset, message='资产更新成功')
    except Exception as e:
        return api_response(False, message=str(e), code=500)


@hardware_bp.route('/assets/<int:asset_id>', methods=['DELETE'])
def delete_asset(asset_id):
    try:
        deleted = hardware_service.delete_asset(asset_id)
        if not deleted:
            return api_response(False, message='资产不存在', code=404)
        return api_response(True, message='资产已删除')
    except Exception as e:
        return api_response(False, message=str(e), code=500)
