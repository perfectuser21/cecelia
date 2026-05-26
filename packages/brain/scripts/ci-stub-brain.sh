#!/usr/bin/env bash
# Minimal stub Brain for CI sprint-test environments where real Brain is unavailable.
# Responds HTTP 200 to all GET requests on the specified port (default 5221).
# Usage: bash ci-stub-brain.sh [port]
# Example: bash ci-stub-brain.sh 5221 &

PORT="${1:-5221}"

python3 - "$PORT" <<'PYEOF'
import http.server, json, sys

port = int(sys.argv[1]) if len(sys.argv) > 1 else 5221

class StubHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({'status': 'ok', 'stub': True, 'port': port}).encode())
    def log_message(self, *args):
        pass

http.server.HTTPServer(('', port), StubHandler).serve_forever()
PYEOF
