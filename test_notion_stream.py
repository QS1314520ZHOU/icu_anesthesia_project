
import requests
import json

url = "https://notion.jylb.fun/v1/chat/completions"
api_key = "qs1134389148"
model = "gemini-3.1-pro"

payload = {
    "model": model,
    "messages": [{"role": "user", "content": "1+1=?"}],
    "stream": True
}

headers = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {api_key}",
    "User-Agent": "curl/7.81.0"
}

try:
    print("Sending POST request with stream=True...")
    response = requests.post(url, headers=headers, json=payload, stream=True, timeout=15)
    print(f"Status Code: {response.status_code}")
    
    if response.status_code == 200:
        print("Success! Reading first few chunks...")
        for line in response.iter_lines():
            if line:
                print(f"Chunk: {line.decode('utf-8')[:100]}")
                break # Only need to see if it works
    else:
        print(f"Failed with Body: {response.text}")
except Exception as e:
    print(f"Error: {e}")
