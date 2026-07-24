#!/usr/bin/env bash
# preview-env-smoke.sh
# 验收：WS1 预览闸 lifecycle API（POST /start → GET /status → POST /stop）
set -uo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain/preview"
PASS=0; FAIL=0
PR_NUM=999001

ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

# 0. 清理可能残留的旧记录
curl -s -o /dev/null -X POST "$API/stop/$PR_NUM" || true

# 0.5 容量准入闸门（capacity-gate.js）接入后，POST /start 唯一调用 admitPreview()，
# 无有效 .runtime/host-disk.json 采样时会 layer1 拒绝（503 sample_missing），防静默瘫痪
# 是设计意图（见 preview-capacity-gate-and-destroyer 合同）。本 smoke 验的是 lifecycle
# API 本身，不是准入闸门逻辑（那部分由 preview-capacity-gate-and-destroyer-smoke.sh 覆盖），
# 所以在容器内 Brain 进程的 REPO_ROOT 下写一份新鲜的合法采样，让 POST /start 走到端口分配分支。
if command -v docker >/dev/null 2>&1 && [ -n "${BRAIN_CONTAINER:-}" ] && docker ps --format '{{.Names}}' 2>/dev/null | grep -qxF "$BRAIN_CONTAINER"; then
  docker exec "$BRAIN_CONTAINER" sh -c '
    mkdir -p "${REPO_ROOT:-/repo_root}/.runtime"
    cat > "${REPO_ROOT:-/repo_root}/.runtime/host-disk.json" <<EOF
{
  "sampled_at_epoch": $(date +%s),
  "data_avail_bytes": 64424509440,
  "apfs_unallocated_bytes": 66571993088,
  "effective_free_bytes": 64424509440,
  "usage_pct": 55
}
EOF
  ' 2>/dev/null || true
fi

# 1. POST /start 分配端口 + 触发（异步）启动脚本，同步返回 port/db_name
echo "── POST /start ──"
RESP=$(curl -s -X POST "$API/start" \
  -H "Content-Type: application/json" \
  -d "{\"pr_number\":$PR_NUM,\"branch_name\":\"smoke-test-branch\"}")
PORT=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('port',''))" 2>/dev/null)
DB_NAME=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('db_name',''))" 2>/dev/null)
if [[ -n "$PORT" && "$PORT" -ge 5300 && "$PORT" -le 5399 ]]; then
  ok "POST /start → 端口 $PORT 在 5300-5399 池内"
else
  fail "POST /start → 期望 5300-5399 端口，得: $RESP"
fi
[[ -n "$DB_NAME" ]] && ok "POST /start → db_name 已分配: $DB_NAME" || fail "POST /start → db_name 缺失: $RESP"

# 2. GET /status/:pr 能查到刚分配的记录
echo "── GET /status/:pr ──"
code=$(curl -s -o /tmp/preview-status.json -w "%{http_code}" "$API/status/$PR_NUM")
[[ "$code" == "200" ]] \
  && ok "GET /status/$PR_NUM → 200" \
  || fail "GET /status/$PR_NUM → 期望 200，得 $code"
grep -q "$PR_NUM" /tmp/preview-status.json 2>/dev/null \
  && ok "GET /status/:pr 返回内容含 pr_number" \
  || fail "GET /status/:pr 返回内容缺 pr_number: $(cat /tmp/preview-status.json 2>/dev/null)"

# 3. GET /（列表）能看到活跃预览
echo "── GET / (list) ──"
code=$(curl -s -o /dev/null -w "%{http_code}" "$API/")
[[ "$code" == "200" ]] \
  && ok "GET / → 200" \
  || fail "GET / → 期望 200，得 $code"

# 4. POST /stop/:pr 销毁，DB 行标记 inactive
echo "── POST /stop/:pr ──"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/stop/$PR_NUM")
[[ "$code" == "200" ]] \
  && ok "POST /stop/$PR_NUM → 200" \
  || fail "POST /stop/$PR_NUM → 期望 200，得 $code"

# 5. 停止后 GET /status/:pr 状态应变为 inactive（DB 行仍在，标记已释放）
echo "── GET /status/:pr after stop ──"
STATUS_AFTER=$(curl -s "$API/status/$PR_NUM" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
[[ "$STATUS_AFTER" == "inactive" ]] \
  && ok "GET /status/:pr（停止后）→ status=inactive（已释放）" \
  || fail "GET /status/:pr（停止后）→ 期望 status=inactive，得: $STATUS_AFTER"

# 6. GET /（列表）不应再包含该 PR（inactive 被过滤）
echo "── GET / (list) 不含已停止的 PR ──"
LIST_HAS_PR=$(curl -s "$API/" | grep -c "\"pr_number\":$PR_NUM" || true)
[[ "$LIST_HAS_PR" -eq 0 ]] \
  && ok "GET / 列表已不含 PR $PR_NUM（inactive 正确过滤）" \
  || fail "GET / 列表仍含已停止的 PR $PR_NUM"

echo ""
echo "── 结果: $PASS 通过 / $FAIL 失败 ──"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
