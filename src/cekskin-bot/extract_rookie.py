import rookiepy
import json

try:
    cookies_list = rookiepy.chrome(["cekskin.com"])
    
    formatted_cookies = []
    for c in cookies_list:
        formatted_cookies.append({
            "name": c['name'],
            "value": c['value'],
            "domain": c['domain'],
            "path": c['path'],
            "expires": c['expires'],
            "httpOnly": c['http_only'],
            "secure": c['secure'],
            "sameSite": "Lax"
        })
    
    state = {
        "cookies": formatted_cookies,
        "origins": []
    }
    
    with open('state.json', 'w') as f:
        json.dump(state, f)
        
    print(f"SUCCESS: Extracted {len(formatted_cookies)} cookies!")
except Exception as e:
    print(f"ERROR: {e}")
