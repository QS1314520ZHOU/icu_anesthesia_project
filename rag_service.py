import re
from typing import List, Dict
from utils.vector_utils import vector_utils
from database import DatabasePool

class RAGService:
    """
    增强型 RAG 引擎
    支持：
    1. 语义向量搜索 (Vector Semantic Search)
    2. 关键词相关性排序 (Keyword Search)
    3. 混合搜索策略
    """
    
    @staticmethod
    def calculate_keyword_score(query: str, text: str) -> float:
        """关键词匹配评分 (原有逻辑 - 增强版)"""
        query = query.lower()
        text = text.lower()
        
        # 基础分：整体包含直接给高分
        if query in text:
            return len(query) * 5.0
            
        # 提取关键词：中文环境下如果没有空格，尝试按常见关键词切分或简单按长度切分
        keywords = [k for k in re.split(r'[ ,.，。！？!?;；\n]', query) if len(k) > 1]
        
        # 增强：如果切分后只有一个词（说明没有空格），尝试一些常见的中文字符/词组匹配
        if len(keywords) <= 1:
            # 简单策略：提取 2-4 个字的片段
            for i in range(len(query) - 1):
                chunk = query[i:i+2]
                if len(chunk) >= 2 and chunk in text:
                    keywords.append(chunk)
        
        if not keywords: return 0.0
        
        score = 0.0
        unique_keywords = set(keywords)
        for kw in unique_keywords:
            if kw in text:
                # 权重：长词权重更高
                score += (len(kw) * 2.0)
                score += text.count(kw) * 0.5
        return score

    def retrieve_context(self, query: str, kb_items: List[Dict], top_k: int = 3, query_vector: List[float] = None) -> str:
        """
        混合检索：结合向量和关键词
        """
        if not kb_items: return ""
            
        scored_items = []
        for item in kb_items:
            # 搜索范围
            search_blob = f"{item['title']} {item['content']} {item.get('tags', '')} {item['category']}"
            
            # 计算关键词分数
            kw_score = self.calculate_keyword_score(query, search_blob)
            
            # 计算向量分数 (如果有)
            vec_score = 0.0
            if query_vector and item.get('embedding'):
                item_vector = vector_utils.decode_vector(item['embedding'])
                vec_score = vector_utils.cosine_similarity(query_vector, item_vector)
            
            # 混合加权分数 (调整权重以平衡两类搜索)
            # 向量分数通常在 0-1 之间，关键词分数可能很大，需要归一化或按权重叠加
            final_score = (vec_score * 50) + kw_score
            
            if final_score > 0:
                scored_items.append((final_score, item))
        
        # 排序并取 Top K
        scored_items.sort(key=lambda x: x[0], reverse=True)
        
        context_blocks = []
        for _, item in scored_items[:top_k]:
            block = f"--- 知识案例: {item['title']} ({item['category']}) ---\n"
            block += f"内容: {item['content']}\n"
            if item.get('tags'):
                block += f"标签: {item['tags']}\n"
            context_blocks.append(block)
            
        return "\n".join(context_blocks)

    def sync_embeddings(self, ai_service):
        """同步缺失的向量嵌入"""
        with DatabasePool.get_connection() as conn:
            rows = conn.execute('SELECT id, title, content, category, tags FROM knowledge_base WHERE embedding IS NULL').fetchall()
            if not rows: return 0
            
            count = 0
            for row in rows:
                item = dict(row)
                text = f"{item['title']} {item['content']} {item['category']} {item.get('tags', '')}"
                vector = ai_service.get_embeddings(text)
                if vector:
                    blob = vector_utils.encode_vector(vector)
                    conn.execute('UPDATE knowledge_base SET embedding = ? WHERE id = ?', (blob, item['id']))
                    count += 1
            conn.commit()
            return count

rag_service = RAGService()
