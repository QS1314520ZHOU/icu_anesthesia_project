
import requests
import json

url = "https://notion.jylb.fun/v1/chat/completions"
api_key = "qs1134389148"
model = "opus-4.6" # Test the failing model

payload = {
    "model": model,
    "messages": [{"role": "user", "content": "1+1=?"}],
    "stream": True
}

headers = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {api_key}",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

try:
    print(f"Testing model: {model}")
    response = requests.post(url, headers=headers, json=payload, stream=True, timeout=15)
    print(f"Status Code: {response.status_code}")
    print(f"Body: {response.text[:200]}")
except Exception as e:
    print(f"Error: {e}")
