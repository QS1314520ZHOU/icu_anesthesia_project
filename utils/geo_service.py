
import sqlite3
import requests
import os
import re
import logging

logger = logging.getLogger(__name__)

# Base coordinates for major Chinese cities (extracted from city_coords.js)
BASE_CITY_COORDS = {
    '北京': [116.4074, 39.9042], '上海': [121.4737, 31.2304], '广州': [113.2644, 23.1292],
    '深圳': [114.0579, 22.5431], '杭州': [120.1551, 30.2741], '南京': [118.7968, 32.0603],
    '武汉': [114.3055, 30.5928], '成都': [104.0657, 30.5723], '西安': [108.9402, 34.3416],
    '重庆': [106.5516, 29.5630], '苏州': [120.5853, 31.2990], '天津': [117.2010, 39.0841],
    '济南': [117.0009, 36.6758], '青岛': [120.3826, 36.0671], '福州': [119.3062, 26.0753],
    '厦门': [118.1102, 24.4905], '长沙': [112.9823, 28.1941], '合肥': [117.2272, 31.8206],
    '郑州': [113.6249, 34.7472], '沈阳': [123.4290, 41.7943], '大连': [121.6147, 38.9140],
    '长春': [125.3245, 43.8868], '哈尔滨': [126.6425, 45.7561], '昆明': [102.7123, 25.0406],
    '南宁': [108.3200, 22.8240], '海口': [110.3312, 20.0319], '贵阳': [106.7135, 26.5783],
    '兰州': [103.8236, 36.0581], '西宁': [101.7782, 36.6171], '银川': [106.2781, 38.4664],
    '乌鲁木齐': [87.6177, 43.7928], '拉萨': [91.1322, 29.6604], '呼和浩特': [111.6708, 40.8183],
    '太原': [112.5492, 37.8570], '石家庄': [114.5025, 38.0455], '南昌': [115.8921, 28.6765],
    '红河': [103.37, 23.36], '蒙自': [103.37, 23.36], '眉山': [103.83, 30.05],
    '随州': [113.37, 31.70], '襄阳': [112.1224, 32.0086], '宜昌': [111.28, 30.69],
    '文山': [104.2442, 23.3695], '丘北': [104.18, 24.04], '广南': [105.05, 24.04],
    '富宁': [105.62, 23.62], '毕节': [105.29, 27.30], '遵义': [106.93, 27.70],
    '大理': [100.27, 25.61], '莆田': [119.0078, 25.4310], '垫江': [107.33, 30.33]
}

class GeoService:
    def __init__(self, db_path='database.db'):
        self.db_path = db_path
        self._init_cache_table()
        
        # Keys and Provider settings
        self.provider = 'heuristic'
        self.baidu_ak = ''
        self.amap_key = ''
        self.tianditu_key = ''
        self.google_ak = ''
        
        # Initial load from DB
        self.reload_config()

    def reload_config(self):
        """Reload configuration from system_config table."""
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            # Check table exists
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='system_config'")
            if not cursor.fetchone():
                conn.close()
                return

            rows = cursor.execute("SELECT config_key, value FROM system_config WHERE config_key LIKE 'map_%'").fetchall()
            configs = {row['config_key']: row['value'] for row in rows}
            conn.close()

            self.provider = configs.get('map_provider', 'baidu')
            self.baidu_ak = configs.get('map_baidu_ak', '')
            self.amap_key = configs.get('map_amap_key', '')
            self.tianditu_key = configs.get('map_tianditu_key', '')
            self.google_ak = configs.get('map_google_ak', '')
            
            logger.info(f"GeoService config reloaded. Provider: {self.provider}")
        except Exception as e:
            logger.error(f"Failed to reload GeoService config: {e}")

    def _init_cache_table(self):
        try:
            conn = sqlite3.connect(self.db_path)
            # Ensure columns exist
            try:
                conn.execute('ALTER TABLE geo_cache ADD COLUMN province TEXT')
                conn.execute('ALTER TABLE geo_cache ADD COLUMN city TEXT')
            except sqlite3.OperationalError:
                pass

            conn.execute('''
                CREATE TABLE IF NOT EXISTS geo_cache (
                    location_name TEXT PRIMARY KEY,
                    province TEXT,
                    city TEXT,
                    lng REAL,
                    lat REAL,
                    provider TEXT,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            conn.commit()
            conn.close()
        except Exception as e:
            logger.error(f"Failed to init geo_cache: {e}")

    def normalize_name(self, name):
        if not name: return ""
        return re.sub(r'(省|市|自治区|特别行政区|区|县|镇|乡)$', '', name)

    def resolve_coords(self, location_name):
        if not location_name: return None
        clean_name = self.normalize_name(location_name)
        
        if clean_name in BASE_CITY_COORDS:
            return BASE_CITY_COORDS[clean_name]
        
        cached = self._get_from_cache(location_name)
        if cached: return cached
        
        for city, coords in BASE_CITY_COORDS.items():
            if location_name.startswith(city) or city.startswith(clean_name):
                return coords

        # Try API based on configured provider priority
        result = self.resolve_address_details(location_name)
        if result and 'lng' in result:
            return [result['lng'], result['lat']]
            
        return None

    def resolve_address_details(self, location_name):
        """Resolves address into structured detail: province, city, lng, lat."""
        if not location_name: return None
        
        cached = self._get_details_from_cache(location_name)
        if cached: return cached
        
        result = None
        
        # 1. Try primary provider
        if self.provider == 'baidu' and self.baidu_ak:
            result = self._fetch_details_from_baidu(location_name)
        elif self.provider == 'amap' and self.amap_key:
            result = self._fetch_details_from_amap(location_name)
        elif self.provider == 'tianditu' and self.tianditu_key:
            result = self._fetch_details_from_tianditu(location_name)
        elif self.provider == 'google' and self.google_ak:
            result = self._fetch_details_from_google_full(location_name)
            
        # 2. Fallbacks if primary fails
        if not result and self.baidu_ak and self.provider != 'baidu':
            result = self._fetch_details_from_baidu(location_name)
        if not result and self.amap_key and self.provider != 'amap':
            result = self._fetch_details_from_amap(location_name)
            
        # 3. Final Heuristic Fallback
        if not result:
            coords = self._fetch_from_osm_simple(location_name)
            if not coords:
                 # Check if we have basic city match
                 clean_name = self.normalize_name(location_name)
                 for city, base_coords in BASE_CITY_COORDS.items():
                    if clean_name in city or city in clean_name:
                        coords = base_coords
                        break
            
            if coords:
                province, city = self._parse_name_heuristically(location_name)
                result = {
                    'province': province,
                    'city': city or (location_name[:5] if len(location_name) < 10 else ''),
                    'lng': coords[0],
                    'lat': coords[1],
                    'provider': 'heuristic'
                }
        
        if result:
            self._save_details_to_cache(location_name, result)
        return result

    def _parse_name_heuristically(self, location_name):
        standalone_map = {
            '莆田': '福建', '垫江': '重庆', '眉山': '四川', '襄阳': '湖北', '随州': '湖北',
            '昆明': '云南', '文山': '云南', '丘北': '云南', '红河': '云南', '广南': '云南'
        }
        for c, p in standalone_map.items():
            if c in location_name:
                return p, c
        return '', ''

    def _get_details_from_cache(self, name):
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            res = conn.execute('SELECT province, city, lng, lat FROM geo_cache WHERE location_name = ?', (name,)).fetchone()
            conn.close()
            if res and res['lng'] is not None: 
                return dict(res)
        except: pass
        return None

    def _save_details_to_cache(self, name, details):
        try:
            conn = sqlite3.connect(self.db_path)
            conn.execute('''
                INSERT OR REPLACE INTO geo_cache (location_name, province, city, lng, lat, provider)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (name, details.get('province'), details.get('city'), details.get('lng'), details.get('lat'), details.get('provider', 'api')))
            conn.commit()
            conn.close()
        except: pass

    def _fetch_details_from_baidu(self, name):
        url = f"https://api.map.baidu.com/geocoding/v3/?address={name}&output=json&ak={self.baidu_ak}"
        try:
            r = requests.get(url, timeout=5)
            data = r.json()
            if data.get('status') == 0:
                loc = data['result']['location']
                return self._reverse_geocode_baidu(loc['lng'], loc['lat'])
        except Exception as e:
            logger.warning(f"Baidu resolution failed for {name}: {e}")
        return None

    def _reverse_geocode_baidu(self, lng, lat):
        url = f"https://api.map.baidu.com/reverse_geocoding/v3/?location={lat},{lng}&output=json&ak={self.baidu_ak}"
        try:
            r = requests.get(url, timeout=5)
            data = r.json()
            if data.get('status') == 0:
                comp = data['result']['addressComponent']
                return {
                    'province': comp.get('province', '').replace('省', ''),
                    'city': comp.get('city', '').replace('市', ''),
                    'lng': lng,
                    'lat': lat,
                    'provider': 'baidu'
                }
        except: pass
        return {'lng': lng, 'lat': lat, 'province': '', 'city': '', 'provider': 'baidu'}

    def _fetch_details_from_amap(self, name):
        url = f"https://restapi.amap.com/v3/geocode/geo?address={name}&key={self.amap_key}"
        try:
            r = requests.get(url, timeout=5)
            data = r.json()
            if data.get('status') == '1' and int(data.get('count', 0)) > 0:
                geocode = data['geocodes'][0]
                lng, lat = map(float, geocode['location'].split(','))
                return {
                    'province': geocode.get('province', '').replace('省', ''),
                    'city': geocode.get('city', '').replace('市', ''),
                    'lng': lng,
                    'lat': lat,
                    'provider': 'amap'
                }
        except Exception as e:
            logger.warning(f"Amap resolution failed for {name}: {e}")
        return None

    def _fetch_details_from_tianditu(self, name):
        # Tianditu Search API
        url = f"http://api.tianditu.gov.cn/geocoder?ds={{\"keyWord\":\"{name}\"}}&tk={self.tianditu_key}"
        try:
            r = requests.get(url, timeout=5)
            data = r.json()
            if data.get('status') == '0':
                info = data.get('location', {})
                return {
                    'province': '', # Tianditu geocoder sometimes lacks structured province in basic search
                    'city': '',
                    'lng': float(info.get('lon')),
                    'lat': float(info.get('lat')),
                    'provider': 'tianditu'
                }
        except Exception as e:
            logger.warning(f"Tianditu resolution failed for {name}: {e}")
        return None

    def _fetch_from_osm_simple(self, name):
        url = f"https://nominatim.openstreetmap.org/search?q={name}&format=json&limit=1"
        try:
            headers = {'User-Agent': 'ICU-PM-System/1.0'}
            r = requests.get(url, headers=headers, timeout=5)
            data = r.json()
            if data:
                return [float(data[0]['lon']), float(data[0]['lat'])]
        except: pass
        return None

    def _fetch_details_from_google_full(self, name):
        url = f"https://maps.googleapis.com/maps/api/geocode/json?address={name}&key={self.google_ak}"
        try:
            r = requests.get(url, timeout=5)
            data = r.json()
            if data.get('status') == 'OK':
                result = data['results'][0]
                loc = result['geometry']['location']
                province = ''
                city = ''
                for comp in result['address_components']:
                    if 'administrative_area_level_1' in comp['types']:
                        province = comp['long_name']
                    if 'locality' in comp['types'] or 'administrative_area_level_2' in comp['types']:
                        city = comp['long_name']
                return {
                    'province': province,
                    'city': city,
                    'lng': loc['lng'],
                    'lat': loc['lat'],
                    'provider': 'google'
                }
        except: pass
        return None

    def _get_from_cache(self, name):
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            res = cursor.execute('SELECT lng, lat FROM geo_cache WHERE location_name = ?', (name,)).fetchone()
            conn.close()
            if res: return [res[0], res[1]]
        except: pass
        return None

    def _save_to_cache(self, name, coords, provider=None):
        try:
            conn = sqlite3.connect(self.db_path)
            conn.execute('INSERT OR REPLACE INTO geo_cache (location_name, lng, lat, provider) VALUES (?, ?, ?, ?)', 
                         (name, coords[0], coords[1], provider))
            conn.commit()
            conn.close()
        except: pass

geo_service = GeoService()
