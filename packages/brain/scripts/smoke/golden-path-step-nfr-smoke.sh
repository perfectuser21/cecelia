#!/usr/bin/env bash
# golden-path-step-nfr-smoke.sh
# 真环境 smoke：验证 golden_path owner_task_id 正模型 + step 级 NFR 决策读写全链路。
# 跑法：BRAIN=http://localhost:5221 DB_URL=postgresql://localhost/cecelia bash $0
# 前置：Brain 在 $BRAIN 跑、migration 303 已应用。
set -euo pipefail

BRAIN="${BRAIN:-http://localhost:5221}"
DB_URL="${DB_URL:-postgresql://localhost/cecelia}"

# id 提取避开 psql 命令标签（INSERT 0 1 会污染 -t 输出）
uuid() { psql "$DB_URL" -t -c "$1" | grep -Eo '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1; }

echo "[smoke] schema: golden_path 新列在、旧列移除"
NEWCOLS=$(psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='golden_path' AND column_name IN ('owner_task_id','feature_id')")
[ "$NEWCOLS" = "2" ] || { echo "FAIL: 新列缺失 NEWCOLS=$NEWCOLS"; exit 1; }
OLDCOLS=$(psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='golden_path' AND column_name IN ('scope_type','scope_id','ability_id')")
[ "$OLDCOLS" = "0" ] || { echo "FAIL: 旧列残留 OLDCOLS=$OLDCOLS"; exit 1; }

echo "[smoke] 夹具：真实 task + feature"
TASK_ID=$(uuid "INSERT INTO tasks (title) VALUES ('gp-smoke-task') RETURNING id")
FEATURE_ID=$(uuid "INSERT INTO journey_features (name) VALUES ('gp-smoke-feature') RETURNING id")

echo "[smoke] POST /golden_path 建步（owner_task 校验）"
STEP=$(curl -sf -X POST "$BRAIN/api/brain/golden_path" -H 'Content-Type: application/json' \
  -d "{\"owner_task_id\":\"$TASK_ID\",\"order_no\":1,\"feature_id\":\"$FEATURE_ID\"}")
echo "$STEP" | jq -e '.owner_task_id and .feature_id and (.order_no==1) and (has("scope_type")|not) and (has("ability_id")|not)' >/dev/null \
  || { echo "FAIL: POST /golden_path 返回非新模型"; exit 1; }
STEP_ID=$(echo "$STEP" | jq -r '.id')

echo "[smoke] 悬空/非法 owner_task_id → 400"
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BRAIN/api/brain/golden_path" -H 'Content-Type: application/json' \
  -d '{"owner_task_id":"00000000-0000-0000-0000-000000000000","order_no":1}'); [ "$C" = "400" ] || { echo "FAIL: 悬空应 400 got $C"; exit 1; }
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BRAIN/api/brain/golden_path" -H 'Content-Type: application/json' \
  -d '{"owner_task_id":"not-a-uuid","order_no":1}'); [ "$C" = "400" ] || { echo "FAIL: 非法 uuid 应 400 got $C"; exit 1; }

echo "[smoke] POST /decisions 挂 step 级 NFR（golden_path 存在性校验）"
DEC=$(curl -sf -X POST "$BRAIN/api/brain/decisions" -H 'Content-Type: application/json' \
  -d "{\"category\":\"nfr\",\"topic\":\"前后台\",\"decision\":\"后台静默\",\"level\":\"step\",\"target_type\":\"golden_path\",\"target_id\":\"$STEP_ID\",\"scope\":\"v1\"}")
echo "$DEC" | jq -e '.level=="step" and .target_type=="golden_path"' >/dev/null || { echo "FAIL: 决策 schema"; exit 1; }
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BRAIN/api/brain/decisions" -H 'Content-Type: application/json' \
  -d '{"category":"nfr","level":"step","target_type":"golden_path","target_id":"00000000-0000-0000-0000-000000000000","scope":"v1"}')
[ "$C" = "400" ] || { echo "FAIL: 悬空决策应 400 got $C"; exit 1; }

echo "[smoke] GET /golden_path/:id/decisions 按步读回"
curl -sf "$BRAIN/api/brain/golden_path/$STEP_ID/decisions?scope=v1" \
  | jq -e --arg s "$STEP_ID" 'any(.[]; .target_id==$s and .scope=="v1")' >/dev/null || { echo "FAIL: 按步读回缺决策"; exit 1; }

echo "[smoke] GET /tasks/:id/golden-path-decisions 按 task 整条读回 NFR 验收单"
curl -sf "$BRAIN/api/brain/tasks/$TASK_ID/golden-path-decisions?category=nfr&scope=v1" \
  | jq -e --arg s "$STEP_ID" 'any(.[]; .target_id==$s and .category=="nfr")' >/dev/null || { echo "FAIL: 验收单缺决策"; exit 1; }

echo "[smoke] 空清单边界：不存在 task → 200 + []"
curl -sf "$BRAIN/api/brain/tasks/00000000-0000-0000-0000-000000000000/golden-path-decisions?category=nfr&scope=v1" \
  | jq -e 'type=="array" and length==0' >/dev/null || { echo "FAIL: 空清单边界"; exit 1; }

echo "✅ golden-path-step-nfr-smoke 全链路通过"
