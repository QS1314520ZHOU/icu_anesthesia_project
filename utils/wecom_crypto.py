# utils/wecom_crypto.py
"""
企业微信消息加解密工具
基于企业微信官方加解密方案：AES-256-CBC + SHA1签名
依赖：pycryptodomex
"""

import base64
import hashlib
import time
import random
import string
import struct
import socket
import xml.etree.ElementTree as ET
from Cryptodome.Cipher import AES

class WeComCrypto:
    """企业微信消息加解密"""
    
    def __init__(self, token: str, encoding_aes_key: str, corp_id: str):
        self.token = token
        self.corp_id = corp_id
        # EncodingAESKey 43位 base64 → 32字节 AES Key
        self.aes_key = base64.b64decode(encoding_aes_key + "=")
        self.iv = self.aes_key[:16]
    
    def _sha1_sign(self, *args) -> str:
        """SHA1 签名"""
        sort_list = sorted([str(a) for a in args])
        raw = "".join(sort_list).encode('utf-8')
        return hashlib.sha1(raw).hexdigest()
    
    def verify_signature(self, msg_signature: str, timestamp: str, nonce: str, echostr: str) -> bool:
        """验证签名"""
        calculated = self._sha1_sign(self.token, timestamp, nonce, echostr)
        return calculated == msg_signature
    
    def _pkcs7_pad(self, data: bytes) -> bytes:
        """PKCS#7 填充"""
        block_size = 32
        pad_len = block_size - (len(data) % block_size)
        return data + bytes([pad_len] * pad_len)
    
    def _pkcs7_unpad(self, data: bytes) -> bytes:
        """PKCS#7 去填充"""
        pad_len = data[-1]
        if pad_len < 1 or pad_len > 32:
            pad_len = 0
        return data[:-pad_len]
    
    def decrypt(self, encrypted_text: str) -> str:
        """解密消息"""
        cipher_bytes = base64.b64decode(encrypted_text)
        cipher = AES.new(self.aes_key, AES.MODE_CBC, self.iv)
        plain_bytes = self._pkcs7_unpad(cipher.decrypt(cipher_bytes))
        
        # 前16字节为随机字符串，后4字节为消息长度（网络字节序），然后是消息内容，最后是 receiveid
        msg_len = struct.unpack("!I", plain_bytes[16:20])[0]
        msg = plain_bytes[20:20 + msg_len].decode('utf-8')
        receive_id = plain_bytes[20 + msg_len:].decode('utf-8')
        
        # 校验 receive_id
        if receive_id != self.corp_id:
            raise ValueError(f"ReceiveID mismatch: {receive_id} != {self.corp_id}")
        
        return msg
    
    def encrypt(self, reply_msg: str) -> str:
        """加密消息"""
        # 16字节随机字符串
        random_str = ''.join(random.choices(string.ascii_letters + string.digits, k=16)).encode('utf-8')
        msg_bytes = reply_msg.encode('utf-8')
        msg_len = struct.pack("!I", len(msg_bytes))
        corp_id_bytes = self.corp_id.encode('utf-8')
        
        plain_bytes = random_str + msg_len + msg_bytes + corp_id_bytes
        padded = self._pkcs7_pad(plain_bytes)
        
        cipher = AES.new(self.aes_key, AES.MODE_CBC, self.iv)
        encrypted = cipher.encrypt(padded)
        return base64.b64encode(encrypted).decode('utf-8')
    
    def decrypt_callback(self, msg_signature: str, timestamp: str, nonce: str, post_data: str) -> str:
        """解密回调数据（POST body XML）"""
        root = ET.fromstring(post_data)
        encrypt_str = root.find("Encrypt").text
        
        # 验签
        if not self.verify_signature(msg_signature, timestamp, nonce, encrypt_str):
            raise ValueError("Signature verification failed")
        
        return self.decrypt(encrypt_str)
    
    def encrypt_reply(self, reply_msg: str, nonce: str = None, timestamp: str = None) -> str:
        """加密被动回复消息，返回完整 XML"""
        nonce = nonce or ''.join(random.choices(string.digits, k=10))
        timestamp = timestamp or str(int(time.time()))
        
        encrypt_str = self.encrypt(reply_msg)
        signature = self._sha1_sign(self.token, timestamp, nonce, encrypt_str)
        
        return f"""<xml>
<Encrypt><![CDATA[{encrypt_str}]]></Encrypt>
<MsgSignature><![CDATA[{signature}]]></MsgSignature>
<TimeStamp>{timestamp}</TimeStamp>
<Nonce><![CDATA[{nonce}]]></Nonce>
</xml>"""

    @staticmethod
    def parse_msg_xml(xml_str: str) -> dict:
        """解析消息XML为字典"""
        root = ET.fromstring(xml_str)
        result = {}
        for child in root:
            result[child.tag] = child.text
        return result
