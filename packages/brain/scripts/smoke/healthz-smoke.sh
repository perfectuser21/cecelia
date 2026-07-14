#!/usr/bin/env bash
# Smoke: Brain GET /api/brain/healthz 端点健康检查
#
# 验证 healthz 端点返回正确 schema：{status, db, tick, last_tick_at, checked_at}。
# 失败条件：
#   - HTTP code != 200 且 HTTP code != 503（任意状态均应有 JSON 响应）
#   - 缺少 status / db / tick 字段
#   - status 不是 ok/degraded/critical
set -euo pipefail

# 容器内无 jq（deploy-webhook 在 brain 容器跑 pre-swap smoke，2026-07-14 实证 4 连假红）
# → node 兜底本脚本用到的 jq 子集：. / -r .k / -e '.k|type=="t"' / -e '.k==v' / -e 'keys==[...]'
if ! command -v jq >/dev/null 2>&1; then
  jq() {
    local eflag=0 rflag=0
    while [ "${1:-}" = "-e" ] || [ "${1:-}" = "-r" ]; do
      [ "$1" = "-e" ] && eflag=1
      [ "$1" = "-r" ] && rflag=1
      shift
    done
    JQ_EXPR="${1:-.}" JQ_FILE="${2:-}" JQ_E="$eflag" JQ_R="$rflag" node -e '
      const fs=require("fs");
      const expr=process.env.JQ_EXPR, file=process.env.JQ_FILE;
      const eflag=process.env.JQ_E==="1";
      const txt=file?fs.readFileSync(file,"utf8"):fs.readFileSync(0,"utf8");
      let d; try{d=JSON.parse(txt)}catch(_){process.exit(2)}
      let m, pass=true, out=null;
      if(expr==="."){ out=JSON.stringify(d,null,2); }
      else if((m=expr.match(/^\.([A-Za-z_]\w*)\s*\|\s*type == "(\w+)"$/))){ pass=typeof d[m[1]]===m[2]; }
      else if((m=expr.match(/^\.([A-Za-z_]\w*) == (true|false)$/))){ pass=d[m[1]]===(m[2]==="true"); }
      else if((m=expr.match(/^\.([A-Za-z_]\w*) == "([^"]*)"$/))){ pass=d[m[1]]===m[2]; }
      else if((m=expr.match(/^keys == (\[.*\])$/))){ pass=JSON.stringify(Object.keys(d).sort())===JSON.stringify(JSON.parse(m[1]).sort()); }
      else if((m=expr.match(/^\.([A-Za-z_]\w*)$/))){ const v=d[m[1]]; out=(typeof v==="string")?v:JSON.stringify(v); }
      else { process.exit(3); }
      if(out!==null) console.log(out);
      if(eflag) process.exit(pass?0:1);
    '
  }
fi

URL="${BRAIN_URL:-http://localhost:5221}/api/brain/healthz"
OUT=/tmp/smoke-healthz.json

printf '%s\n' "▶️  smoke: healthz-smoke.sh"
printf '%s\n' "   target: $URL"

HTTP_CODE=$(curl -sS -o "$OUT" -w "%{http_code}" "$URL")

if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "503" ]; then
  printf '%s\n' "❌ HTTP $HTTP_CODE (expected 200 or 503)"
  cat "$OUT" 2>/dev/null || true
  exit 1
fi

jq -e '.status | type == "string"' "$OUT" > /dev/null || {
  printf '%s\n' "❌ Missing or non-string 'status' field"
  jq . "$OUT"
  exit 1
}

jq -e '.db | type == "string"' "$OUT" > /dev/null || {
  printf '%s\n' "❌ Missing or non-string 'db' field"
  jq . "$OUT"
  exit 1
}

jq -e '.tick | type == "string"' "$OUT" > /dev/null || {
  printf '%s\n' "❌ Missing or non-string 'tick' field"
  jq . "$OUT"
  exit 1
}

STATUS=$(jq -r '.status' "$OUT")
if [[ "$STATUS" != "ok" && "$STATUS" != "degraded" && "$STATUS" != "critical" ]]; then
  printf '%s\n' "❌ status must be ok/degraded/critical, got: $STATUS"
  jq . "$OUT"
  exit 1
fi

jq -e '.checked_at | type == "string"' "$OUT" > /dev/null || {
  printf '%s\n' "❌ Missing 'checked_at' field"
  jq . "$OUT"
  exit 1
}

printf '%s\n' "✅ smoke pass: $URL → HTTP $HTTP_CODE, status=$STATUS"
jq . "$OUT"
