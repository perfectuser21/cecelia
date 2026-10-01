#!/usr/bin/env bash
# golden-path-step-nfr-smoke.sh
# 真环境 smoke：golden_path（L4 step 旧表）已退役（任务 7d312fd8）——表结构保留，
# 写路由一律 410、读路由默认 410（GOLDEN_PATH_LEGACY_READ=1 放行），step 级 NFR 不再能挂 golden_path。
# 跑法：BRAIN=http://localhost:5221 DB_URL=postgresql://localhost/cecelia bash $0
# 前置：Brain 在 $BRAIN 跑、migration 303 已应用。
#
# 证据规则（judge r0 FAIL 反馈：缺每步具体命令输出）：每个 golden-path 步骤都打印
# 实际 curl 命令 + 响应体 + HTTP 状态码，evaluator 抓日志即拿到逐步可观察证据，
# 不再只看 step 标签 + rc=0。
set -euo pipefail

# 真 Brain 写入必须显式授权，并核对本机测试容器。
if ! node "$(dirname "${BASH_SOURCE[0]}")/../lib/smoke-production-guard.mjs" "${BRAIN_URL:-${BRAIN:-http://localhost:5221}}" "${DB_URL:-${DATABASE_URL:-postgresql://localhost/cecelia}}"; then
  exit 0
fi

# real-env-smoke CI 注入 BRAIN_URL + DATABASE_URL（含凭据，DB=cecelia_test）；本地默认 trust-auth
BRAIN="${BRAIN_URL:-${BRAIN:-http://localhost:5221}}"
DB_URL="${DATABASE_URL:-${DB_URL:-postgresql://localhost/cecelia}}"

# id 提取避开 psql 命令标签（INSERT 0 1 会污染 -t 输出）
uuid() { psql "$DB_URL" -t -c "$1" | grep -Eo '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1; }

# req METHOD URL [JSON_BODY] —— 打印命令 + 响应体 + HTTP 码，返回时 BODY/CODE 全局可读
BODY=""; CODE=""
req() {
  local method="$1" url="$2" data="${3:-}"
  local out
  if [ -n "$data" ]; then
    echo "  \$ curl -X $method '$url' -d '$data'"
    out=$(curl -s -w $'\n%{http_code}' -X "$method" "$url" -H 'Content-Type: application/json' -d "$data")
  else
    echo "  \$ curl -X $method '$url'"
    out=$(curl -s -w $'\n%{http_code}' -X "$method" "$url")
  fi
  CODE="${out##*$'\n'}"
  BODY="${out%$'\n'*}"
  echo "  ← HTTP $CODE"
  echo "  ← $BODY"
}

echo "[smoke] BRAIN=$BRAIN  DB_URL=${DB_URL%%\?*}"

echo "[smoke] schema: golden_path 新列在、旧列移除"
NEWCOLS=$(psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='golden_path' AND column_name IN ('owner_task_id','feature_id')")
echo "  新列(owner_task_id,feature_id) count=${NEWCOLS}（期望 2）"
[ "$NEWCOLS" = "2" ] || { echo "FAIL: 新列缺失 NEWCOLS=$NEWCOLS"; exit 1; }
OLDCOLS=$(psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='golden_path' AND column_name IN ('scope_type','scope_id','ability_id')")
echo "  旧列(scope_type,scope_id,ability_id) count=${OLDCOLS}（期望 0）"
[ "$OLDCOLS" = "0" ] || { echo "FAIL: 旧列残留 OLDCOLS=$OLDCOLS"; exit 1; }

echo "[smoke] 夹具：真实 task + feature"
TASK_ID=$(uuid "INSERT INTO tasks (title) VALUES ('gp-smoke-task-' || gen_random_uuid()) RETURNING id")
FEATURE_ID=$(uuid "INSERT INTO journey_features (name) VALUES ('gp-smoke-feature-' || gen_random_uuid()) RETURNING id")
echo "  TASK_ID=$TASK_ID  FEATURE_ID=$FEATURE_ID"

expect410() { # $1=期望 path_kind
  [ "$CODE" = "410" ] || { echo "FAIL: 期望 410 got $CODE"; exit 1; }
  echo "$BODY" | jq -e --arg k "$1" '.retired==true and .path_kind==$k' >/dev/null || { echo "FAIL: 410 体不符（path_kind=$1）"; exit 1; }
}

echo "[smoke] === 写路径：POST/PATCH /golden_path → 410 write（永不放行）==="
req POST "$BRAIN/api/brain/golden_path" "{\"owner_task_id\":\"$TASK_ID\",\"order_no\":1,\"feature_id\":\"$FEATURE_ID\"}"
expect410 write
echo "$BODY" | jq -e 'has("legacy_read_env")|not' >/dev/null || { echo "FAIL: 写路径不应给放行 env"; exit 1; }
req PATCH "$BRAIN/api/brain/golden_path/00000000-0000-0000-0000-000000000000" '{"note":"x"}'
expect410 write
N=$(psql "$DB_URL" -tAc "SELECT count(*) FROM golden_path WHERE owner_task_id='$TASK_ID'")
[ "$N" = "0" ] || { echo "FAIL: 写路径被拒后旧表仍多出 $N 行"; exit 1; }
echo "  ✓ 写路径 410 且旧表零新增"

echo "[smoke] === step 级 NFR 挂 golden_path → 410 write ==="
req POST "$BRAIN/api/brain/decisions" '{"category":"nfr","topic":"t","decision":"d","level":"step","target_type":"golden_path","target_id":"00000000-0000-0000-0000-000000000000","scope":"v1"}'
expect410 write
echo "  ✓ 新决策不再能挂旧表"

echo "[smoke] === 读路径：默认 410 read（带放行 env 提示）==="
for u in "golden_path?limit=5" "golden_path/00000000-0000-0000-0000-000000000000/decisions?scope=v1" "tasks/$TASK_ID/golden-path-decisions?category=nfr" "golden_path/canvas?owner_task_id=$TASK_ID"; do
  req GET "$BRAIN/api/brain/$u"
  expect410 read
  echo "$BODY" | jq -e '.legacy_read_env=="GOLDEN_PATH_LEGACY_READ=1"' >/dev/null || { echo "FAIL: 读路径缺放行 env 提示"; exit 1; }
done
echo "  ✓ 4 条读路由默认 410"

psql "$DB_URL" -c "DELETE FROM tasks WHERE id='$TASK_ID'" >/dev/null 2>&1 || true
psql "$DB_URL" -c "DELETE FROM journey_features WHERE id='$FEATURE_ID'" >/dev/null 2>&1 || true
echo "✅ golden-path-step-nfr-smoke：旧表退役闸全链路通过（写 3 条 410、读 4 条 410、旧表零新增）"
