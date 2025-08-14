from flask import Flask, request, Response
import requests

app = Flask(__name__)

FORWARD_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.5',
    # 'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Origin': 'https://www.dazn.com',
    'Connection': 'keep-alive',
    'Referer': 'https://www.dazn.com/',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'cross-site',
    'DNT': '1',
    'Sec-GPC': '1',
    # Requests doesn't support trailers
    # 'TE': 'trailers',
}

@app.route("/proxy")
def proxy():
    target_url = request.args.get("url")
    if not target_url:
        return "Missing url", 400

    print(target_url)
    r = requests.get(target_url, headers=FORWARD_HEADERS, stream=True)

    excluded_headers = [
        'content-encoding', 'content-length', 'transfer-encoding', 'connection'
    ]
    response_headers = [
        (name, value) for (name, value) in r.raw.headers.items()
        if name.lower() not in excluded_headers
    ]

    return Response(r.content, r.status_code, response_headers)

if __name__ == "__main__":
    app.run(port=9000, debug=True)
