# routes/mobile_routes.py

from flask import Blueprint, render_template, request
from api_utils import api_response
from database import DatabasePool
from services.ai_service import ai_service
from rag_service import rag_service
import json

mobile_bp = Blueprint('mobile', __name__, url_prefix='/m')

# ====== 页面路由 ======
@mobile_bp.route('/')
def index():
    return render_template('mobile/index.html')

@mobile_bp.route('/knowledge')
def knowledge_page():
    return render_template('mobile/knowledge.html')

@mobile_bp.route('/chat')
def chat_page():
    return render_template('mobile/ai_chat.html')


# ====== 移动端API ======

@mobile_bp.route('/api/auth', methods=['POST'])
def mobile_auth():
    """
    企业微信 H5 网页授权
    用户从企业微信打开时，通过 JS-SDK 拿到 code
    后端用 code 换 userid（复用现有 wecom_service）
    """
    code = request.json.get('code', '')
    from services.wecom_service import wecom_service
    user_info = wecom_service.get_user_by_code(code)
    
    if user_info:
        # 直接拿到 wecom_userid，和你现有用户体系打通
        return api_response(True, data=user_info)
    return api_response(False, message='认证失败')


@mobile_bp.route('/api/kb/search', methods=['POST'])
def kb_search():
    """知识库 RAG 智能搜索 —— 完全复用现有引擎"""
    query = request.json.get('query', '')
    if not query:
        return api_response(False, message='请输入搜索内容')
    
    with DatabasePool.get_connection() as conn:
        rows = conn.execute(
            'SELECT id, title, content, category, tags, embedding '
            'FROM knowledge_base'
        ).fetchall()
        kb_items = [dict(r) for r in rows]
    
    # 向量 + 关键词混合检索
    query_vector = ai_service.get_embeddings(query)
    
    # 评分排序
    scored = []
    for item in kb_items:
        search_blob = f"{item['title']} {item['content']} {item.get('tags','')} {item['category']}"
        kw_score = rag_service.calculate_keyword_score(query, search_blob)
        
        vec_score = 0.0
        if query_vector and item.get('embedding'):
            from utils.vector_utils import vector_utils
            item_vec = vector_utils.decode_vector(item['embedding'])
            vec_score = vector_utils.cosine_similarity(query_vector, item_vec)
        
        final_score = (vec_score * 50) + kw_score
        if final_score > 0:
            scored.append({
                'id': item['id'],
                'title': item['title'],
                'category': item['category'],
                'tags': item.get('tags', ''),
                'summary': item['content'][:150] + '...',
                'score': round(final_score, 2)
            })
    
    scored.sort(key=lambda x: x['score'], reverse=True)
    return api_response(True, data=scored[:10])


@mobile_bp.route('/api/ai/chat', methods=['POST'])
def ai_chat():
    """AI 对话 —— RAG 增强，复用现有 ai_service"""
    message = request.json.get('message', '')
    use_rag = request.json.get('use_rag', True)
    history = request.json.get('history', [])  # 前端传来的对话历史
    
    if not message:
        return api_response(False, message='请输入问题')
    
    # 1. RAG 检索知识库上下文
    context = ""
    references = []
    if use_rag:
        with DatabasePool.get_connection() as conn:
            rows = conn.execute(
                'SELECT id, title, content, category, tags, embedding '
                'FROM knowledge_base'
            ).fetchall()
            kb_items = [dict(r) for r in rows]
        
        query_vector = ai_service.get_embeddings(message)
        context = rag_service.retrieve_context(
            message, kb_items, top_k=3, query_vector=query_vector
        )
    
    # 2. 构建 System Prompt
    system_prompt = (
        "你是一位精干的 ICU 医疗信息化项目总监 (Executive Project Director)。\n"
        "你的职责是为现场经理提供极具战略高度和行动导向的建议。你的语气应专业、权威且简洁。\n"
    )
    if context:
        system_prompt += f"\n【决策支持知识库上下文】\n{context}\n"
        system_prompt += "\n请优先基于知识库回答，确保持论有据。如果现有资料不足，请结合 ICU 临床信息化交付经验给出前瞻性分析。"
    
    # 3. 拼接多轮对话历史
    user_content = message
    if history:
        # 取最近5轮
        recent = history[-10:]  
        history_text = "\n".join(
            [f"{'用户' if h['role']=='user' else '助手'}: {h['content']}" 
             for h in recent]
        )
        user_content = f"对话历史：\n{history_text}\n\n当前问题：{message}"
    
    # 4. 调用 AI（完全复用你现有的多端点回退机制）
    result = ai_service.call_ai_api(system_prompt, user_content, task_type="chat")
    
    if result:
        return api_response(True, data={
            'reply': result,
            'has_rag_context': bool(context)
        })
    else:
        return api_response(False, message='AI 服务暂时不可用，请稍后再试')
