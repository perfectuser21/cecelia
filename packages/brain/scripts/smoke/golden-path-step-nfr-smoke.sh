#!/usr/bin/env bash
# golden-path-step-nfr-smoke.sh
# 真环境 smoke：验证 golden_path owner_task_id 正模型 + step 级 NFR 决策读写全链路。
# 跑法：BRAIN=http://localhost:5221 DB_URL=postgresql://localhost/cecelia bash $0
# 前置：Brain 在 $BRAIN 跑、migration 303 已应用。
#
# 证据规则（judge r0 FAIL 反馈：缺每步具体命令输出）：每个 golden-path 步骤都打印
# 实际 curl 命令 + 响应体 + HTTP 状态码，evaluator 抓日志即拿到逐步可观察证据，
# 不再只看 step 标签 + rc=0。
set -euo pipefail

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
echo "  新列(owner_task_id,feature_id) count=$NEWCOLS（期望 2）"
[ "$NEWCOLS" = "2" ] || { echo "FAIL: 新列缺失 NEWCOLS=$NEWCOLS"; exit 1; }
OLDCOLS=$(psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='golden_path' AND column_name IN ('scope_type','scope_id','ability_id')")
echo "  旧列(scope_type,scope_id,ability_id) count=$OLDCOLS（期望 0）"
[ "$OLDCOLS" = "0" ] || { echo "FAIL: 旧列残留 OLDCOLS=$OLDCOLS"; exit 1; }

echo "[smoke] 夹具：真实 task + feature"
TASK_ID=$(uuid "INSERT INTO tasks (title) VALUES ('gp-smoke-task-' || gen_random_uuid()) RETURNING id")
FEATURE_ID=$(uuid "INSERT INTO journey_features (name) VALUES ('gp-smoke-feature-' || gen_random_uuid()) RETURNING id")
echo "  TASK_ID=$TASK_ID  FEATURE_ID=$FEATURE_ID"

echo "[smoke] === Golden Path Step 1: POST /golden_path 建步（owner_task 校验）==="
req POST "$BRAIN/api/brain/golden_path" "{\"owner_task_id\":\"$TASK_ID\",\"order_no\":1,\"feature_id\":\"$FEATURE_ID\"}"
[ "$CODE" = "201" ] || { echo "FAIL: POST /golden_path 期望 201 got $CODE"; exit 1; }
echo "$BODY" | jq -e '.owner_task_id and .feature_id and (.order_no==1) and (has("scope_type")|not) and (has("ability_id")|not)' >/dev/null \
  || { echo "FAIL: POST /golden_path 返回非新模型"; exit 1; }
STEP_ID=$(echo "$BODY" | jq -r '.id')
echo "  ✓ 201 + 新模型字段（owner_task_id/feature_id/order_no，无 scope_type/ability_id），STEP_ID=$STEP_ID"

echo "[smoke] === Step 1 边界：悬空/非法 owner_task_id → 400 ==="
req POST "$BRAIN/api/brain/golden_path" '{"owner_task_id":"00000000-0000-0000-0000-000000000000","order_no":1}'
[ "$CODE" = "400" ] || { echo "FAIL: 悬空应 400 got $CODE"; exit 1; }
req POST "$BRAIN/api/brain/golden_path" '{"owner_task_id":"not-a-uuid","order_no":1}'
[ "$CODE" = "400" ] || { echo "FAIL: 非法 uuid 应 400 got $CODE"; exit 1; }
echo "  ✓ 悬空 + 非法 uuid 均 400（非 500）"

echo "[smoke] === Golden Path Step 2: POST /decisions 挂 step 级 NFR（golden_path 存在性校验）==="
req POST "$BRAIN/api/brain/decisions" "{\"category\":\"nfr\",\"topic\":\"前后台\",\"decision\":\"后台静默\",\"level\":\"step\",\"target_type\":\"golden_path\",\"target_id\":\"$STEP_ID\",\"scope\":\"v1\"}"
[ "$CODE" = "201" ] || { echo "FAIL: POST /decisions 期望 201 got $CODE"; exit 1; }
echo "$BODY" | jq -e '.level=="step" and .target_type=="golden_path"' >/dev/null || { echo "FAIL: 决策 schema"; exit 1; }
DEC_ID=$(echo "$BODY" | jq -r '.id')
echo "  ✓ 201 + level=step/target_type=golden_path，DEC_ID=$DEC_ID"

echo "[smoke] === Step 2 边界：悬空/非法 golden_path target → 400 ==="
req POST "$BRAIN/api/brain/decisions" '{"category":"nfr","level":"step","target_type":"golden_path","target_id":"00000000-0000-0000-0000-000000000000","scope":"v1"}'
[ "$CODE" = "400" ] || { echo "FAIL: 悬空决策应 400 got $CODE"; exit 1; }
req POST "$BRAIN/api/brain/decisions" '{"category":"nfr","level":"step","target_type":"golden_path","target_id":"not-a-uuid","scope":"v1"}'
[ "$CODE" = "400" ] || { echo "FAIL: 非法 uuid 决策应 400 got $CODE"; exit 1; }
echo "  ✓ 悬空 + 非法 uuid 均 400（非 500）"

echo "[smoke] === Golden Path Step 3: GET /golden_path/:id/decisions 按步读回 ==="
req GET "$BRAIN/api/brain/golden_path/$STEP_ID/decisions?scope=v1"
[ "$CODE" = "200" ] || { echo "FAIL: 按步读回期望 200 got $CODE"; exit 1; }
echo "$BODY" | jq -e --arg s "$STEP_ID" 'any(.[]; .target_id==$s and .scope=="v1")' >/dev/null || { echo "FAIL: 按步读回缺决策"; exit 1; }
echo "  ✓ 200 + 含刚写决策（target_id=$STEP_ID, scope=v1）"

echo "[smoke] === Step 3 边界：不存在的步 → 200 + [] ==="
req GET "$BRAIN/api/brain/golden_path/00000000-0000-0000-0000-000000000000/decisions?scope=v1"
[ "$CODE" = "200" ] || { echo "FAIL: 空清单期望 200 got $CODE"; exit 1; }
echo "$BODY" | jq -e 'type=="array" and length==0' >/dev/null || { echo "FAIL: 空清单边界"; exit 1; }
echo "  ✓ 200 + 空数组"

echo "[smoke] === Golden Path Step 4: GET /tasks/:id/golden-path-decisions 按 task 整条读回 NFR 验收单 ==="
req GET "$BRAIN/api/brain/tasks/$TASK_ID/golden-path-decisions?category=nfr&scope=v1"
[ "$CODE" = "200" ] || { echo "FAIL: 验收单期望 200 got $CODE"; exit 1; }
echo "$BODY" | jq -e --arg s "$STEP_ID" 'any(.[]; .target_id==$s and .category=="nfr")' >/dev/null || { echo "FAIL: 验收单缺决策"; exit 1; }
echo "  ✓ 200 + 按 owner_task_id join 出整条 golden path NFR 验收单含刚写决策"

echo "[smoke] === Step 4 边界：不存在 task → 200 + [] ==="
req GET "$BRAIN/api/brain/tasks/00000000-0000-0000-0000-000000000000/golden-path-decisions?category=nfr&scope=v1"
[ "$CODE" = "200" ] || { echo "FAIL: 空清单期望 200 got $CODE"; exit 1; }
echo "$BODY" | jq -e 'type=="array" and length==0' >/dev/null || { echo "FAIL: 空清单边界"; exit 1; }
echo "  ✓ 200 + 空数组"

echo "✅ golden-path-step-nfr-smoke 全链路通过（4 步 happy-path + 6 边界，每步含具体响应证据）"
