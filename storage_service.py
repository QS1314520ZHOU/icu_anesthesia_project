
import os
import shutil
import time
import bypy.const
import json
import logging
# 修复: 强制将 AppPcsPath 设置为应用的专属目录
# 必须在实例化 ByPy 之前设置
bypy.const.AppPcsPath = '/apps/MyProjectManager'

from bypy import ByPy
import uuid
from werkzeug.utils import secure_filename

logger = logging.getLogger(__name__)

class NonInteractiveByPy(ByPy):
    def __init__(self, *args, **kwargs):
        # 强制设置超时时间 (秒)，避免网络请求无限挂起
        if 'timeout' not in kwargs:
            kwargs['timeout'] = 30 
        super().__init__(*args, **kwargs)

    def _auth(self):
        # Override to disable interactive authentication on startup
        # We try to load the token, but if it fails, we simply return failure
        # instead of asking for user input.
        # This allows the backend to start without hanging.
        try:
            self._load_local_json()
            if self._access_token:
                return 1 # Success
            return 0 # Fail silently
        except Exception:
            return 0

class BaiduStorage:
    def __init__(self, root_path='icu_projects', client_id=None, client_secret=None):
        self.client_id = client_id
        self.client_secret = client_secret
        
        # 如果没有提供 Key，尝试从 ai_config 获取
        if not self.client_id:
             try:
                 from ai_config import BAIDU_APP_KEY, BAIDU_SECRET_KEY
                 self.client_id = BAIDU_APP_KEY
                 self.client_secret = BAIDU_SECRET_KEY
                 logger.info("Loaded Baidu keys from ai_config")
             except ImportError as e:
                 logger.warning(f"Failed to load Baidu keys from ai_config: {e}")
                 pass
             except Exception as e:
                 logger.warning(f"Error loading Baidu keys from ai_config: {e}")
                 pass
        
        # Use our non-interactive subclass
        if self.client_id and self.client_secret:
            logger.info(f"Using custom Baidu AppKey: {self.client_id[:4]}***")
            self.bp = NonInteractiveByPy(apikey=self.client_id, secretkey=self.client_secret)
        else:
            logger.info("Using default ByPy keys (fallback)")
            self.bp = NonInteractiveByPy()
            
        self.root_path = root_path
        self.type = 'baidu'

    def get_auth_url(self):
        if self.client_id:
            return f"https://openapi.baidu.com/oauth/2.0/authorize?scope=basic+netdisk&redirect_uri=oob&response_type=code&client_id={self.client_id}"
        else:
            default_client_id = bypy.const.ApiKey 
            return f"https://openapi.baidu.com/oauth/2.0/authorize?scope=basic+netdisk&redirect_uri=oob&response_type=code&client_id={default_client_id}"

    def authenticate(self, code):
        """Exchange authorization code for access token using direct requests."""
        import requests
        
        logger.info(f"Starting DIRECT Baidu authentication with requests")
        
        bp = self.bp
        try:
            token_url = "https://openapi.baidu.com/oauth/2.0/token"
            client_id = bp._apikey
            client_secret = bp._secretkey
            
            params = {
                'grant_type': 'authorization_code',
                'code': code,
                'client_id': client_id,
                'client_secret': client_secret,
                'redirect_uri': 'oob'
            }
            
            # DNS resolution
            try:
                import socket
                hostname = "openapi.baidu.com"
                ip_address = socket.gethostbyname(hostname)
                logger.info(f"Resolved {hostname} to {ip_address}")
            except Exception as e:
                logger.warning(f"DNS resolution failed for {hostname}: {e}")

            logger.info(f"Sending POST to {token_url} with timeout=30s and NO PROXY")
            
            response = requests.post(
                token_url, 
                data=params, 
                timeout=30,
                proxies={"http": None, "https": None}
            )
            
            logger.info(f"Response status: {response.status_code}")
            
            if response.status_code != 200:
                logger.error(f"Auth failed with HTTP {response.status_code}: {response.text}")
                return False, f"HTTP Error {response.status_code}: {response.text}"
                
            token_data = response.json()
            
            if 'error' in token_data:
                err_msg = token_data.get('error_description', token_data.get('error'))
                logger.error(f"Auth failed with API error: {err_msg}")
                return False, f"API Error: {err_msg}"
                
            logger.info("Auth successful! Saving token for ByPy...")
            bp._save_local_json(token_data)
            bp._load_local_json()
            
            if bp._access_token:
                logger.info("Token verified and loaded in ByPy instance.")
                return True, "Authorization successful"
            else:
                logger.error("Token saved but failed to load back.")
                return False, "Token saved but failed to verify"
            
        except requests.exceptions.Timeout:
            logger.error("Authentication request timed out (30s)")
            return False, "Request timed out (30s) - Check Server Network/Firewall"
        except requests.exceptions.RequestException as e:
            logger.error(f"Authentication request failed: {e}")
            return False, f"Network failed: {str(e)}"
        except Exception as e:
            logger.exception(f"Unexpected error during authentication: {e}")
            return False, f"System error: {str(e)}"

    def save_manual_token(self, token_json_str):
        """Manually save token from JSON string"""
        try:
            token_data = json.loads(token_json_str)
            if not isinstance(token_data, dict):
                return False, "Invalid JSON: must be an object"
                
            if 'access_token' not in token_data and 'refresh_token' not in token_data:
                return False, "Invalid Token JSON: missing access_token/refresh_token"
                
            logger.info("Saving manual token data...")
            self.bp._save_local_json(token_data)
            self.bp._load_local_json()
            
            if self.bp._access_token:
                logger.info("Manual token loaded successfully.")
                return True, "Token saved and verified"
            else:
                return False, "Token saved but failed to verify"
                
        except json.JSONDecodeError:
            return False, "Invalid JSON format"
        except Exception as e:
            logger.exception(f"Error saving manual token: {e}")
            return False, str(e)

    def is_authorized(self):
        """Check if we have a valid token"""
        self.bp._load_local_json()
        if self.bp._access_token:
            return True
        return False

    def upload_file(self, file_obj, project_id, filename=None):
        if not filename:
            ext = os.path.splitext(file_obj.filename)[1]
            filename = f"{int(time.time())}_{str(uuid.uuid4())[:8]}{ext}"
        
        temp_dir = os.path.join('temp_uploads', str(project_id))
        if not os.path.exists(temp_dir):
            os.makedirs(temp_dir)
        temp_path = os.path.join(temp_dir, filename)
        file_obj.save(temp_path)
        
        remote_dir = f"{self.root_path}/{project_id}"
        remote_path = f"{remote_dir}/{filename}"
        
        try:
            try:
                ret = self.bp.upload(temp_path, remote_path, ondup='overwrite')
            except SystemExit as e:
                ret = e.code if isinstance(e.code, int) else -1
            except Exception as e:
                raise Exception(f"Bypy error: {e}")

            if ret == 0: 
                return remote_path
            else:
                try:
                    self.bp.makedir(remote_dir)
                except:
                    pass
                try:
                    ret = self.bp.upload(temp_path, remote_path, ondup='overwrite')
                except SystemExit as e:
                     ret = e.code
                
                if ret == 0:
                    return remote_path
                raise Exception(f"Bypy upload failed with code {ret}")
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    def download_file(self, remote_path):
        filename = os.path.basename(remote_path)
        temp_dir = os.path.join('temp_downloads', str(int(time.time())))
        if not os.path.exists(temp_dir):
            os.makedirs(temp_dir)
        local_path = os.path.join(temp_dir, filename)
        
        try:
            self.bp.downfile(remote_path, local_path)
            if os.path.exists(local_path):
                return local_path
            else:
                raise Exception("Download failed, file not found locally")
        except Exception as e:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)
            raise e

    def delete_file(self, remote_path):
        try:
            self.bp.delete(remote_path)
        except Exception as e:
            print(f"Delete failed: {e}")

    def list_files(self, project_id):
        return f"{self.root_path}/{project_id}/"


class R2Storage:
    def __init__(self, endpoint_url, access_key, secret_key, bucket_name, public_domain=None):
        import boto3
        from botocore.config import Config
        
        self.endpoint_url = endpoint_url
        self.access_key = access_key
        self.secret_key = secret_key
        self.bucket_name = bucket_name
        self.public_domain = public_domain
        self.type = 'r2'
        
        self.s3_client = boto3.client(
            's3',
            endpoint_url=self.endpoint_url,
            aws_access_key_id=self.access_key,
            aws_secret_access_key=self.secret_key,
            config=Config(signature_version='s3v4'),
            region_name='auto'
        )

    def is_authorized(self):
        """Check connection by listing buckets"""
        try:
            self.s3_client.list_buckets()
            return True
        except Exception as e:
            logger.error(f"R2 connection check failed: {e}")
            return False

    def upload_file(self, file_obj, project_id, filename=None):
        if not filename:
            ext = os.path.splitext(file_obj.filename)[1]
            filename = f"{int(time.time())}_{str(uuid.uuid4())[:8]}{ext}"
            
        key = f"{project_id}/{filename}"
        
        # S3 upload_fileobj requires a defined seek position, ensuring 0
        file_obj.seek(0)
        
        try:
            self.s3_client.upload_fileobj(file_obj, self.bucket_name, key)
            return key
        except Exception as e:
            logger.error(f"R2 upload failed: {e}")
            raise e

    def download_file(self, remote_path):
        """remote_path is the S3 key"""
        filename = os.path.basename(remote_path)
        temp_dir = os.path.join('temp_downloads', str(int(time.time())))
        if not os.path.exists(temp_dir):
            os.makedirs(temp_dir)
        local_path = os.path.join(temp_dir, filename)
        
        try:
            self.s3_client.download_file(self.bucket_name, remote_path, local_path)
            return local_path
        except Exception as e:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)
            logger.error(f"R2 download failed: {e}")
            raise e

    def delete_file(self, remote_path):
        try:
            self.s3_client.delete_object(Bucket=self.bucket_name, Key=remote_path)
        except Exception as e:
            logger.error(f"R2 delete failed: {e}")

    def list_files(self, project_id):
        # Allow listing via API if needed, for now return prefix
        return f"{project_id}/"


class StorageService:
    CONFIG_FILE = 'storage_config.json'
    
    def __init__(self):
        self.active_backend = None
        self.config = self._load_config()
        self._init_backend()

    def _load_config(self):
        if os.path.exists(self.CONFIG_FILE):
            try:
                with open(self.CONFIG_FILE, 'r', encoding='utf-8') as f:
                     return json.load(f)
            except Exception as e:
                logger.error(f"Failed to load storage config: {e}")
        return {'type': 'baidu'} # Default to Baidu

    def _save_config(self, config):
        try:
            with open(self.CONFIG_FILE, 'w', encoding='utf-8') as f:
                json.dump(config, f, indent=4)
            self.config = config
            self._init_backend() # Re-init on save
            return True
        except Exception as e:
            logger.error(f"Failed to save config: {e}")
            return False

    def _init_backend(self):
        type = self.config.get('type', 'baidu')
        try:
            if type == 'r2':
                r2_conf = self.config.get('r2', {})
                self.active_backend = R2Storage(
                    endpoint_url=r2_conf.get('endpoint'),
                    access_key=r2_conf.get('access_key'),
                    secret_key=r2_conf.get('secret_key'),
                    bucket_name=r2_conf.get('bucket_name'),
                    public_domain=r2_conf.get('public_domain')
                )
                logger.info("Initialized R2 Storage Backend")
            else:
                self.active_backend = BaiduStorage()
                logger.info("Initialized Baidu Storage Backend")
        except Exception as e:
            logger.error(f"Failed to initialize backend {type}: {e}")
            # Fallback to Baidu if R2 fails hard
            if type != 'baidu':
                logger.warning("Falling back to Baidu Storage")
                self.active_backend = BaiduStorage()

    # --- Config Management ---
    
    def get_config(self):
        return self.config

    def update_config(self, new_config):
        # Merge or replace
        # If type changes, validation might be needed
        return self._save_config(new_config)

    # --- Proxy Methods ---

    def get_active_type(self):
        return getattr(self.active_backend, 'type', 'unknown')

    def is_authorized(self):
        if self.active_backend:
            return self.active_backend.is_authorized()
        return False

    def upload_file(self, *args, **kwargs):
        return self.active_backend.upload_file(*args, **kwargs)

    def download_file(self, *args, **kwargs):
        return self.active_backend.download_file(*args, **kwargs)

    def delete_file(self, *args, **kwargs):
        return self.active_backend.delete_file(*args, **kwargs)

    def list_files(self, *args, **kwargs):
        return self.active_backend.list_files(*args, **kwargs)

    # Baidu specific
    def get_auth_url(self):
        if isinstance(self.active_backend, BaiduStorage):
            return self.active_backend.get_auth_url()
        return None

    def authenticate(self, code):
        if isinstance(self.active_backend, BaiduStorage):
            return self.active_backend.authenticate(code)
        return False, "Current storage is not Baidu"
        
    def save_manual_token(self, token):
        if isinstance(self.active_backend, BaiduStorage):
            return self.active_backend.save_manual_token(token)
        return False, "Current storage is not Baidu"

storage_service = StorageService()
