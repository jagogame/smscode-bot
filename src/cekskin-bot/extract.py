import browser_cookie3
import json

try:
    # Ambil cookie khusus domain cekskin
    cj = browser_cookie3.chrome(domain_name='cekskin.com')
    cookies = []
    for c in cj:
        cookies.append({
            "name": c.name,
            "value": c.value,
            "domain": c.domain,
            "path": c.path,
            "expires": -1,
            "httpOnly": c.has_nonstandard_attr('HttpOnly') or False,
            "secure": c.secure or False,
            "sameSite": "Lax"
        })
    
    state = {
        "cookies": cookies,
        "origins": []
    }
    
    with open('state.json', 'w') as f:
        json.dump(state, f)
        
    print(f"SUCCESS: Extracted {len(cookies)} cookies!")
except Exception as e:
    print(f"ERROR: {e}")
