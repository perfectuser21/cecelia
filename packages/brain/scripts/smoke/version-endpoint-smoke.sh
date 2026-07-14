#!/usr/bin/env bash
# Smoke: Brain GET /api/brain/version 端点健康检查
#
# 验证 version 端点返回正确 schema：{version, schema_version}。
# 失败条件：
#   - HTTP code != 200
#   - 缺少 version 或 schema_version 字段
#   - version 不符合 semver x.y.z 格式
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

URL="${BRAIN_URL:-http://localhost:5221}/api/brain/version"
OUT=/tmp/smoke-version-endpoint.json

printf '%s\n' "▶️  smoke: version-endpoint-smoke.sh"
printf '%s\n' "   target: $URL"

HTTP_CODE=$(curl -sS -o "$OUT" -w "%{http_code}" "$URL")

if [ "$HTTP_CODE" != "200" ]; then
  printf '%s\n' "❌ HTTP $HTTP_CODE (expected 200)"
  printf '%s\n' "   body:"
  jq . "$OUT" 2>/dev/null || true
  exit 1
fi

jq -e '.version | type == "string"' "$OUT" > /dev/null || {
  printf '%s\n' "❌ Missing or non-string 'version' field"
  jq . "$OUT"
  exit 1
}

jq -e '.schema_version | type == "string"' "$OUT" > /dev/null || {
  printf '%s\n' "❌ Missing or non-string 'schema_version' field"
  jq . "$OUT"
  exit 1
}

VER=$(jq -r '.version' "$OUT")
printf '%s' "$VER" | node -e "const v=require('fs').readFileSync('/dev/stdin','utf8').trim();if(!/^\d+\.\d+\.\d+$/.test(v)){process.stderr.write('FAIL: not semver: '+v+'\n');process.exit(1)}"

printf '%s\n' "✅ smoke pass: $URL → 200, version=$VER"
jq . "$OUT"
