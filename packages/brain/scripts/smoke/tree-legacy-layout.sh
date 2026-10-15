#!/usr/bin/env bash
set -euo pipefail
if ! node "$(dirname "$0")/../lib/smoke-production-guard.mjs" "${BRAIN_URL:-http://localhost:5221}" "${DATABASE_URL:-postgresql://localhost/cecelia}"; then
  if [[ "${TREE_LEGACY_LAYOUT_SMOKE_AUTHORIZED:-}" != "1" ]]; then
    echo 'SKIP: 旧树写入 smoke 未获授权'; exit 0
  fi
  exit 1
fi
if [[ "${TREE_LEGACY_LAYOUT_SMOKE_AUTHORIZED:-}" != "1" ]]; then
  echo 'SKIP: 旧树写入 smoke 未获授权'; exit 0
fi
: "${BRAIN_URL:?需要隔离预览服务地址}"
: "${DATABASE_URL:?需要同一隔离数据库连接}"
: "${CECELIA_INTERNAL_TOKEN:?需要预览内部令牌}"
: "${TREE_LEGACY_LAYOUT_SMOKE_BODY:?需要已准备样本的完整 JSON 请求}"
case "$(psql -X "$DATABASE_URL" -Atqc 'SELECT current_database()')" in
  cecelia_scratch|cecelia_test) ;;
  *) echo '仅允许隔离测试库' >&2; exit 1 ;;
esac
TASK_ID=$(node -e 'const x=JSON.parse(process.env.TREE_LEGACY_LAYOUT_SMOKE_BODY);process.stdout.write(x.task_id)')
RESPONSE=$(curl -q -fsS -X POST "$BRAIN_URL/api/brain/tree/legacy-layout" -H 'Content-Type: application/json' -H "Authorization: Bearer $CECELIA_INTERNAL_TOKEN" --data "$TREE_LEGACY_LAYOUT_SMOKE_BODY")
printf '%s' "$RESPONSE" | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{const x=JSON.parse(s);if(x.replayed||x.receipt?.readback_verified!==true)process.exit(1)})'
psql -X "$DATABASE_URL" -v task_id="$TASK_ID" -Atq <<'SQL' | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{if(!Number.isInteger(Number(s))||Number(s)<1)process.exit(1)})'
SELECT jsonb_array_length(result->'tree_legacy_layout_receipts') FROM tasks WHERE id=:'task_id'::uuid;
SQL
echo '旧树改挂回执与数据库读回通过'
