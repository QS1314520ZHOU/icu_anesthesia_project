import numpy as np
import json
import base64

class VectorUtils:
    @staticmethod
    def cosine_similarity(v1, v2):
        """计算余弦相似度"""
        if v1 is None or v2 is None: return 0.0
        v1 = np.array(v1)
        v2 = np.array(v2)
        dot_product = np.dot(v1, v2)
        norm_v1 = np.linalg.norm(v1)
        norm_v2 = np.linalg.norm(v2)
        if norm_v1 == 0 or norm_v2 == 0: return 0.0
        return dot_product / (norm_v1 * norm_v2)

    @staticmethod
    def encode_vector(vector):
        """将向量编码为 BLOB 存储"""
        if vector is None: return None
        return np.array(vector, dtype=np.float32).tobytes()

    @staticmethod
    def decode_vector(blob):
        """从 BLOB 解码向量"""
        if blob is None: return None
        return np.frombuffer(blob, dtype=np.float32).tolist()

vector_utils = VectorUtils()
