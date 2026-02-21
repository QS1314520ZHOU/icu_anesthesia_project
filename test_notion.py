
import requests
import json
import time

url = "https://notion.jylb.fun/v1/chat/completions"
api_key = "qs1134389148"
model = "gemini-3.1-pro"

payload = {
    "model": model,
    "messages": [{"role": "user", "content": "1+1=?"}],
    "stream": False  # System default is False
}

def test_config(name, headers_extra={}, use_json_param=False):
    print(f"\n--- Testing: {name} ---")
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    headers.update(headers_extra)
    
    try:
        start = time.time()
        if use_json_param:
            response = requests.post(url, headers=headers, json=payload, timeout=10)
        else:
            response = requests.post(url, headers=headers, data=json.dumps(payload), timeout=10)
        
        duration = time.time() - start
        print(f"Status Code: {response.status_code}")
        print(f"Time: {duration:.2f}s")
        print(f"Response: {response.text[:200]}")
    except Exception as e:
        print(f"Error: {e}")

# 1. Base test (simulating my current code)
test_config("Default (Current Code)")

# 2. With User-Agent (simulating curl)
test_config("With User-Agent", {"User-Agent": "curl/7.81.0"})

# 3. With Stream: True
print("\n--- Testing: Stream=True ---")
payload["stream"] = True
test_config("Stream=True + User-Agent", {"User-Agent": "curl/7.81.0"})

# 4. Check if trailing slash matters
print("\n--- Testing: Trailing Slash ---")
url_slash = url + "/"
try:
    res = requests.post(url_slash, headers={"Authorization": f"Bearer {api_key}"}, json=payload, timeout=10)
    print(f"Slash Result: {res.status_code}")
except Exception as e:
    print(f"Slash Error: {e}")
