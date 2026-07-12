contract_branch: cp-harness-propose-r2-3e9f1458
sprint_dir: sprints/07130716-relay-3e9f1458

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: headless-smoke

**范围**: 仅修订 `packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh` 的 headless smoke case；不改业务 executor。  
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 合同 Red 测试存在并覆盖 smoke 脚本防调度约束
  Test: node -e "const fs=require('fs');const p='sprints/07130716-relay-3e9f1458/tests/headless-smoke-no-dispatch.test.ts';const c=fs.readFileSync(p,'utf8');if(!c.includes('valid headless smoke task 创建后必须被取消或创建为非 queued'))process.exit(1);if(!c.includes('HEADLESS_SMOKE_TASK_ID'))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] 实现 PR 只能触碰 smoke 脚本本身
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07130716-relay-3e9f1458/contract-draft.md','utf8');if(!c.includes('只允许最小 PR 修改 `packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh`'))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] 合法 headless/codex POST 校验必须保留
  Test: manual:bash -c 'set -euo pipefail; BRAIN="${BRAIN_URL:-http://localhost:5221}"; TITLE="headless-smoke-dod-legal-$(date +%s)-$$"; RESP=$(curl -sf -X POST "$BRAIN/api/brain/tasks" -H "Content-Type: application/json" -d "{\"task_type\":\"harness_initiative\",\"title\":\"${TITLE}\",\"status\":\"pending_postdeploy\",\"payload\":{\"orchestrator\":\"skill-relay\",\"executor\":\"codex\",\"mode\":\"headless\"}}"); echo "$RESP" | jq -e ".id | type == \"string\"" >/dev/null; echo "$RESP" | jq -e ".status | type == \"string\"" >/dev/null; echo "$RESP" | jq -e ".task_type == \"harness_initiative\"" >/dev/null; echo "$RESP" | TITLE="$TITLE" jq -e ".title == env.TITLE" >/dev/null; ID=$(echo "$RESP" | jq -r ".id"); curl -sf -X PATCH "$BRAIN/api/brain/tasks/$ID" -H "Content-Type: application/json" -d "{\"status\":\"cancelled\"}" >/dev/null || true; echo OK'
  期望: OK

- [ ] [BEHAVIOR] valid headless smoke task 创建后必须被取消或创建为非 queued
  Test: manual:bash -c 'set -euo pipefail; BRAIN="${BRAIN_URL:-http://localhost:5221}"; OUT=$(mktemp); BRAIN_URL="$BRAIN" bash packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh | tee "$OUT"; ID=$(sed -nE "s/.*HEADLESS_SMOKE_TASK_ID=([0-9a-fA-F-]{36}).*/\1/p" "$OUT" | tail -1); [ -n "$ID" ] || { echo "FAIL: smoke did not print HEADLESS_SMOKE_TASK_ID"; cat "$OUT"; exit 1; }; FINAL=$(curl -sf "$BRAIN/api/brain/tasks/$ID" | jq -er ".status"); [ "$FINAL" != "queued" ] || { echo "FAIL: smoke-created task left queued id=$ID"; exit 1; }; case "$FINAL" in completed|cancelled|failed|blocked) ;; *) curl -sf -X PATCH "$BRAIN/api/brain/tasks/$ID" -H "Content-Type: application/json" -d "{\"status\":\"cancelled\"}" >/dev/null || true ;; esac; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 合法 headless/codex 响应不得要求真实 relay/headed 产物字段
  Test: manual:bash -c 'set -euo pipefail; BRAIN="${BRAIN_URL:-http://localhost:5221}"; RESP=$(curl -sf -X POST "$BRAIN/api/brain/tasks" -H "Content-Type: application/json" -d "{\"task_type\":\"harness_initiative\",\"title\":\"headless-smoke-dod-schema-$(date +%s)-$$\",\"status\":\"pending_postdeploy\",\"payload\":{\"orchestrator\":\"skill-relay\",\"executor\":\"codex\",\"mode\":\"headless\",\"journey_id\":\"dod-headless\"}}"); echo "$RESP" | jq -e "has(\"relay_run_id\") | not and has(\"tmux_session\") | not and has(\"tui_log\") | not and has(\"pr_url\") | not" >/dev/null; ID=$(echo "$RESP" | jq -r ".id"); curl -sf -X PATCH "$BRAIN/api/brain/tasks/$ID" -H "Content-Type: application/json" -d "{\"status\":\"cancelled\"}" >/dev/null || true; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET/PATCH task schema 必须完整 codify
  Test: manual:bash -c 'set -euo pipefail; BRAIN="${BRAIN_URL:-http://localhost:5221}"; TITLE="headless-smoke-dod-patch-schema-$(date +%s)-$$"; RESP=$(curl -sf -X POST "$BRAIN/api/brain/tasks" -H "Content-Type: application/json" -d "{\"task_type\":\"harness_initiative\",\"title\":\"${TITLE}\",\"status\":\"pending_postdeploy\",\"payload\":{\"orchestrator\":\"skill-relay\",\"executor\":\"codex\",\"mode\":\"headless\"}}"); ID=$(echo "$RESP" | jq -er ".id"); GET_RESP=$(curl -sf "$BRAIN/api/brain/tasks/$ID"); echo "$GET_RESP" | ID="$ID" jq -e ".id == env.ID and (.status | type == \"string\")" >/dev/null; PATCH_RESP=$(curl -sf -X PATCH "$BRAIN/api/brain/tasks/$ID" -H "Content-Type: application/json" -d "{\"status\":\"cancelled\"}"); echo "$PATCH_RESP" | ID="$ID" jq -e ".id == env.ID and .status == \"cancelled\"" >/dev/null; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 非法 mode 白名单校验必须保留
  Test: manual:bash -c 'set -euo pipefail; BRAIN="${BRAIN_URL:-http://localhost:5221}"; BODY=$(mktemp); CODE=$(curl -s -o "$BODY" -w "%{http_code}" -X POST "$BRAIN/api/brain/tasks" -H "Content-Type: application/json" -d "{\"task_type\":\"harness_initiative\",\"title\":\"invalid-mode-dod\",\"payload\":{\"orchestrator\":\"skill-relay\",\"executor\":\"codex\",\"mode\":\"turbo\"}}"); [ "$CODE" = "400" ] || { echo "FAIL: expected 400 got $CODE"; cat "$BODY"; exit 1; }; jq -e ".error | type == \"string\"" "$BODY" >/dev/null; echo OK'
  期望: OK

- [ ] [BEHAVIOR] executor=codex 缺少 orchestrator=skill-relay 不得被当作本合法路径
  Test: manual:bash -c 'set -euo pipefail; BRAIN="${BRAIN_URL:-http://localhost:5221}"; BODY=$(mktemp); CODE=$(curl -s -o "$BODY" -w "%{http_code}" -X POST "$BRAIN/api/brain/tasks" -H "Content-Type: application/json" -d "{\"task_type\":\"harness_initiative\",\"title\":\"missing-orchestrator-dod\",\"payload\":{\"executor\":\"codex\",\"mode\":\"headless\"}}"); [ "$CODE" = "400" ] || { echo "FAIL: expected 400 got $CODE"; cat "$BODY"; exit 1; }; jq -e ".error | test(\"orchestrator=skill-relay\")" "$BODY" >/dev/null; echo OK'
  期望: OK

## BEHAVIOR:E2E 条目

- [ ] [BEHAVIOR:E2E] local_api final-e2e 按 `contract-draft.md` 的 `## E2E 验收` 脚本执行，确认合法 headless/codex、非法 mode、valid task 非 queued 三项同时成立
  Test: manual:bash -c 'grep -q "^## E2E 验收" sprints/07130716-relay-3e9f1458/contract-draft.md && grep -q "codex-headed-dispatch-smoke.sh" sprints/07130716-relay-3e9f1458/contract-draft.md && grep -q "HEADLESS_SMOKE_TASK_ID" sprints/07130716-relay-3e9f1458/contract-draft.md && grep -q "smoke-created task left queued" sprints/07130716-relay-3e9f1458/contract-draft.md && grep -q "invalid mode remains rejected" sprints/07130716-relay-3e9f1458/contract-draft.md'
  期望: exit 0
