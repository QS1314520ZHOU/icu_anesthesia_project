
import ai_utils
import logging

# Set logging to show the process
logging.basicConfig(level=logging.INFO)

# Test call_ai directly
# This will use the notion endpoint configured in the database (since it's priority 1 and active)
print("Testing call_ai with Notion endpoint...")
try:
    result = ai_utils.call_ai("1+1=?", task_type="chat")
    print("\n--- AI Result ---")
    print(result)
    print("------------------")
except Exception as e:
    print(f"Error during call_ai: {e}")
