
from database import DatabasePool
from services.ai_insight_service import ai_insight_service
from datetime import datetime

class CruiseService:
    @staticmethod
    def run_daily_cruise():
        """执行全量项目巡航"""
        try:
            with DatabasePool.get_connection() as conn:
                projects = conn.execute('SELECT id, project_name, hospital_name, status FROM projects WHERE status != "已完成"').fetchall()
                
                scan_results = {
                    "scan_time": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    "total_scanned": len(projects),
                    "anomalies_found": 0,
                    "summary": []
                }
                
                for p in projects:
                    res = ai_insight_service.detect_anomalies(p['id'])
                    pred = ai_insight_service.predict_future_risks(p['id'])
                    
                    if res or (pred and pred['is_delay_predicted']):
                        scan_results['anomalies_found'] += 1
                        scan_results['summary'].append({
                            "project_id": p['id'],
                            "project_name": p['project_name'],
                            "hospital_name": p['hospital_name'],
                            "anomalies": res,
                            "prediction": pred
                        })
                
                return scan_results
        except Exception as e:
            print(f"Daily Cruise Error: {e}")
            return {"error": str(e)}

cruise_service = CruiseService()
