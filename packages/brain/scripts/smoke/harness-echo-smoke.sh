#!/usr/bin/env bash
# harness-echo-smoke.sh
# Smoke test: GET /api/brain/harness/echo 端点存在且返回正确 schema
# exit 1 if any check fails
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

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "=== harness-echo smoke ==="
echo "Brain: $BRAIN_URL"

# 健康检查
curl -sf "$BRAIN_URL/api/brain/health" > /dev/null || {
  echo "❌ Brain 未运行在 $BRAIN_URL"
  exit 1
}

# Happy path
RESP=$(curl -sf "$BRAIN_URL/api/brain/harness/echo?msg=smoke") || {
  echo "❌ GET /api/brain/harness/echo?msg=smoke 返回非 200"
  exit 1
}

echo "$RESP" | jq -e '.ok == true' > /dev/null || { echo "❌ ok 不为 true"; exit 1; }
echo "$RESP" | jq -e '.echo == "smoke"' > /dev/null || { echo "❌ echo 不等于 smoke"; exit 1; }
echo "$RESP" | jq -e 'keys == ["echo","ok"]' > /dev/null || { echo "❌ keys 不合规"; exit 1; }

# 空 msg 边界
RESP2=$(curl -sf "$BRAIN_URL/api/brain/harness/echo") || { echo "❌ 空 msg 返回非 200"; exit 1; }
echo "$RESP2" | jq -e '.ok == true' > /dev/null || { echo "❌ 空 msg ok 不为 true"; exit 1; }

echo "✅ harness-echo smoke 通过"
