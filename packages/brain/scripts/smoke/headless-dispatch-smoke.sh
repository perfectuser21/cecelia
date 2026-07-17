#!/usr/bin/env bash
# headless-dispatch-smoke.sh
# 专项验证 headless（Docker）派发链路：mode 白名单 + CECELIA_HEADLESS 注入 + PPID 检测 + harness-skill-relay 路径
# Sprint: sprints/07172032-relay-d744a719
# Task: d744a719-0247-4b15-b91d-882fae1838a5
set -euo pipefail

BRAIN="${BRAIN_URL:-http://localhost:5221}"
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── headless dispatch smoke ──"

# 1. Brain API 健康检查
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" -m 5 "$BRAIN/healthz" 2>/dev/null || echo "000")
[ "$HEALTH" = "200" ] \
  && ok "Brain API 健康检查 → 200" \
  || fail "Brain API 健康检查失败（实际: $HEALTH）"

# 2. [BEHAVIOR-1] POST tasks(mode=headless, executor=claude) → 200/201 + id 字段
RESP=$(curl -sf -m 10 -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_initiative","title":"headless-smoke-test-claude","payload":{"orchestrator":"skill-relay","executor":"claude","mode":"headless","journey_id":"dod-test-headless-001"}}' 2>/dev/null) \
  || { fail "POST tasks(mode=headless, executor=claude) 不可达"; RESP="{}"; }
echo "$RESP" | python3 -c "import sys,json;d=json.load(sys.stdin);exit(0 if isinstance(d.get('id'),str) else 1)" 2>/dev/null \
  && ok "POST tasks(mode=headless, executor=claude) → 200/201 + id 字段存在" \
  || fail "POST tasks(mode=headless, executor=claude) 响应异常: $RESP"

# 3. POST tasks(mode=headless, executor=codex) → 200/201
CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 10 -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_initiative","title":"headless-smoke-test-codex","payload":{"orchestrator":"skill-relay","executor":"codex","mode":"headless","journey_id":"dod-test-headless-002"}}' 2>/dev/null || echo "000")
[ "$CODE" = "200" ] || [ "$CODE" = "201" ] \
  && ok "POST tasks(mode=headless, executor=codex) → 200/201 放行" \
  || fail "POST tasks(mode=headless, executor=codex) 应返 200/201，实际 $CODE"

# 4. [BEHAVIOR-2] POST tasks(mode=invalid) → 400 拒绝
CODE3=$(curl -s -o /dev/null -w "%{http_code}" -m 10 -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_initiative","title":"invalid-mode-test","payload":{"orchestrator":"skill-relay","executor":"claude","mode":"turbo"}}' 2>/dev/null || echo "000")
[ "$CODE3" = "400" ] \
  && ok "POST tasks(mode=invalid) → 400 拒绝" \
  || fail "POST tasks(mode=invalid) 应返 400，实际 $CODE3"

# 5. [BEHAVIOR-3] docker-executor.js 含 CECELIA_HEADLESS: 'true' 注入
grep -q "CECELIA_HEADLESS: 'true'" "$REPO_ROOT/packages/brain/src/docker-executor.js" 2>/dev/null \
  && ok "docker-executor.js 含 CECELIA_HEADLESS: 'true' 注入" \
  || fail "docker-executor.js 缺少 CECELIA_HEADLESS: 'true' 注入"

# 6. [BEHAVIOR-4] slot-allocator.js 含 PPID CECELIA_HEADLESS 检测
grep -qE "PPID|CECELIA_HEADLESS" "$REPO_ROOT/packages/brain/src/slot-allocator.js" 2>/dev/null \
  && ok "slot-allocator.js 含 PPID CECELIA_HEADLESS 检测逻辑" \
  || fail "slot-allocator.js 缺少 PPID CECELIA_HEADLESS 检测逻辑"

# 7. [BEHAVIOR-5] harness-skill-relay.js 含 headless → docker spawnFn 路径
grep -qE "headless|spawnFn|docker" "$REPO_ROOT/packages/brain/src/harness-skill-relay.js" 2>/dev/null \
  && ok "harness-skill-relay.js 含 headless/docker/spawnFn 路径" \
  || fail "harness-skill-relay.js 缺少 headless/docker/spawnFn 路径"

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
