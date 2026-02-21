
import sys
import os
import logging

# Setup paths
sys.path.append(os.getcwd())

from services.ai_service import ai_service
from ai_config import ai_manager

# Setup logging to see what's happening
logging.basicConfig(level=logging.INFO)

def test_ai_service_streaming():
    print("--- Testing AIService.call_ai_api with Notion (Force stream) ---")
    
    # We know Notion is id 5 in database. configurations are loaded on init.
    # Let's verify we have it.
    notion_ep = next((ep for ep in ai_manager.endpoints if 'notion' in ep.name.lower()), None)
    
    if not notion_ep:
        print("Error: Notion endpoint not found in ai_manager. Check database.")
        return

    print(f"Found Notion Endpoint: {notion_ep.name} | URL: {notion_ep.base_url}")
    
    # Temporarily set high priority for Notion to ensure it's picked
    original_priority = notion_ep.priority
    notion_ep.priority = 0 
    
    try:
        system_prompt = "You are a helpful assistant."
        user_content = "1+1=?"
        
        print(f"Calling AIService.call_ai_api...")
        result = ai_service.call_ai_api(system_prompt, user_content, task_type="chat")
        
        print(f"\nResult: {result}")
        if result and "2" in result:
            print("\nSUCCESS: AIService successfully handled streaming response and aggregated content!")
        else:
            print("\nFAILURE: Unexpected result or empty response.")
            
    except Exception as e:
        print(f"\nEXCEPTION: {e}")
    finally:
        # Restore priority
        notion_ep.priority = original_priority

if __name__ == "__main__":
    test_ai_service_streaming()
