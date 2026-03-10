import sys
import os
from datetime import datetime, date
import json
import decimal

# Mock Flask for response_utils
sys.modules['flask'] = type('MockFlask', (), {'jsonify': lambda x: x})

try:
    from database import DatabasePool
    from services.project_service import project_service
    from services.analytics_service import analytics_service
    from services.log_service import log_service
    from utils.response_utils import api_response
    
    print("Testing PostgreSQL Compatibility...")
    
    # 1. Test format_sql Phase 1 + Phase 2
    test_queries = [
        ("SELECT strftime('%Y-%m', created_at) as month, julianday('now') - julianday(created_at) as diff FROM projects WHERE is_completed = 1 AND date('now', '-1 day') > plan_start_date", 
         ['to_char', '::date', 'TRUE', 'INTERVAL']),
        ("SELECT * FROM projects WHERE project_name LIKE '%test%'", 
         ['ILIKE']),
        ("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'", 
         ['information_schema.tables', 'table_name']),
        ("SELECT group_concat(name) FROM project_members", 
         ['string_agg'])
    ]
    
    for sql, expected_keywords in test_queries:
        formatted = DatabasePool.format_sql(sql)
        print(f"Original SQL: {sql}")
        print(f"Formatted SQL: {formatted}")
        missing = [kw for kw in expected_keywords if kw.lower() not in formatted.lower()]
        if not missing:
            print(f"SUCCESS: Conversion contains expected keywords: {expected_keywords}")
        else:
            print(f"WARNING: Conversion missing keywords: {missing}")

    # 2. Test data serialization
    test_data = {
        'count': 10,
        'average': decimal.Decimal('15.5'),
        'today': date.today(),
        'now': datetime.now(),
        'active': True
    }
    resp, code = api_response(True, data=test_data)
    print(f"Serialized Data: {resp}")
    if isinstance(resp['data']['average'], float) and isinstance(resp['data']['today'], str):
         print("SUCCESS: Data serialization (Decimal/Date) looks correct.")
    else:
        print("WARNING: Data serialization failed.")

    # 3. Test Actual DB Interaction (if reachable)
    try:
        with DatabasePool.get_connection() as conn:
            print("Database connection successful.")
            # Test a project detail call
            # Find a real project ID first
            p = conn.execute('SELECT id FROM projects LIMIT 1').fetchone()
            if p:
                pid = p['id']
                print(f"Testing detail for project {pid}...")
                detail = project_service.get_project_detail(pid)
                print(f"Successfully fetched detail for project {pid}")
                
                # Test analytics
                print("Testing stage baselines...")
                baselines = analytics_service.get_stage_baselines()
                print(f"Successfully fetched {len(baselines)} baselines")
            else:
                print("No projects found in database to test detail fetching.")
    except Exception as e:
        print(f"Database interaction test failed: {e}")
        # Not necessarily a failure of my code if DB is down or empty, 
        # but useful for verification in this environment.

except Exception as e:
    print(f"Verification Test Error: {e}")
    import traceback
    traceback.print_exc()

print("Verification Completed.")
