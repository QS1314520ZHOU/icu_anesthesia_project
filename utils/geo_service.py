
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
    '大理': [100.27, 25.61]
}

class GeoService:
    def __init__(self, db_path='database.db'):
        self.db_path = db_path
        self._init_cache_table()
        
        # Baidu Maps API config
        self.baidu_ak = os.environ.get('BAIDU_MAPS_AK', '')
        # Google Maps API config
        self.google_ak = os.environ.get('GOOGLE_MAPS_API_KEY', '')

    def _init_cache_table(self):
        try:
            conn = sqlite3.connect(self.db_path)
            conn.execute('''
                CREATE TABLE IF NOT EXISTS geo_cache (
                    location_name TEXT PRIMARY KEY,
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
        # Remove common suffixes
        return re.sub(r'(省|市|自治区|特别行政区|区|县|镇|乡)$', '', name)

    def resolve_coords(self, location_name):
        if not location_name: return None
        
        clean_name = self.normalize_name(location_name)
        
        # 1. Try local hardcoded list
        if clean_name in BASE_CITY_COORDS:
            return BASE_CITY_COORDS[clean_name]
        
        # 2. Try DB cache
        cached = self._get_from_cache(location_name)
        if cached: return cached
        
        # 3. Try fuzzy local match (if name starts with known city)
        for city, coords in BASE_CITY_COORDS.items():
            if location_name.startswith(city) or city.startswith(clean_name):
                return coords

        # 4. Try external APIs
        coords = None
        provider = None

        # Priority depends on environment (default: Baidu -> Google)
        # In international environment, you might want to swap this.
        if self.baidu_ak:
            coords = self._fetch_from_baidu(location_name)
            if coords: provider = "baidu"

        if not coords and self.google_ak:
            coords = self._fetch_from_google(location_name)
            if coords: provider = "google"

        if coords:
            self._save_to_cache(location_name, coords, provider)
            return coords
        
        return None

    def _get_from_cache(self, name):
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            res = cursor.execute('SELECT lng, lat FROM geo_cache WHERE location_name = ?', (name,)).fetchone()
            conn.close()
            if res: return [res[0], res[1]]
        except:
            pass
        return None

    def _save_to_cache(self, name, coords, provider=None):
        try:
            conn = sqlite3.connect(self.db_path)
            conn.execute('INSERT OR REPLACE INTO geo_cache (location_name, lng, lat, provider) VALUES (?, ?, ?, ?)', 
                         (name, coords[0], coords[1], provider))
            conn.commit()
            conn.close()
        except:
            pass

    def _fetch_from_baidu(self, name):
        url = f"https://api.map.baidu.com/geocoding/v3/?address={name}&output=json&ak={self.baidu_ak}"
        try:
            r = requests.get(url, timeout=5)
            data = r.json()
            if data.get('status') == 0:
                loc = data['result']['location']
                return [loc['lng'], loc['lat']]
        except Exception as e:
            logger.warning(f"Baidu Geocoding failed for {name}: {e}")
        return None

    def _fetch_from_google(self, name):
        url = f"https://maps.googleapis.com/maps/api/geocode/json?address={name}&key={self.google_ak}"
        try:
            r = requests.get(url, timeout=5)
            data = r.json()
            if data.get('status') == 'OK':
                loc = data['results'][0]['geometry']['location']
                return [loc['lng'], loc['lat']]
        except Exception as e:
            logger.warning(f"Google Geocoding failed for {name}: {e}")
        return None

geo_service = GeoService()
