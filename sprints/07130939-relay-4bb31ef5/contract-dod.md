---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Sprint: claude-headed-smoke 回归链路固化

**范围**: 仅固化 `executor=claude + mode=headed + orchestrator=skill-relay` 的本机回归验收，并补齐 CI DoD 动态 seed 步骤的 claude-headed 分支；不新增业务功能、dashboard/UI、migration 或改动 codex-headed 既有 smoke/wrapper 语义。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] contract draft 含 Golden Path 与 E2E 验收
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07130939-relay-4bb31ef5/contract-draft.md','utf8');if(!c.includes('## Golden Path')||!c.includes('## E2E 验收'))process.exit(1)"

- [ ] [ARTIFACT] generator 补 sprint-local e2e wrapper
  Test: node -e "const fs=require('fs');const p='sprints/07130939-relay-4bb31ef5/e2e-verify.sh';const c=fs.readFileSync(p,'utf8');if(!c.includes('claude-headed-dispatch-smoke.sh')||!c.includes('4bb31ef5-e140-41f4-9daf-9ca4a9e51216'))process.exit(1)"

- [ ] [ARTIFACT] 新增 claude headed smoke 并登记 allowlist
  Test: grep -Fxq "claude-headed-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt

- [ ] [ARTIFACT] 既有 codex headed smoke 仍在 allowlist（不回归）
  Test: grep -Fxq "codex-headed-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt

- [ ] [ARTIFACT] DoD.md 已记录本 sprint 的 claude-headed relay DoD
  Test: manual:bash -c 'grep -E "skill-relay-claude-headed|07130939-relay-4bb31ef5" DoD.md >/dev/null || { echo "FAIL: DoD.md 未记录本 sprint claude-headed relay DoD"; exit 1; }; echo OK'
  期望: OK

## Invariant 覆盖条目

- [ ] [BEHAVIOR] Invariant 单slot 串行：wrapper 只做当前 sprint/task 只读验证，不并发写同一工作区
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07130939-relay-4bb31ef5/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; grep -F "TASK_ID=\"\${TASK_ID:-4bb31ef5-e140-41f4-9daf-9ca4a9e51216}\"" "$SCRIPT" >/dev/null || { echo "FAIL: wrapper 未绑定当前 task 默认值"; exit 1; }; grep -F "SPRINT_DIR=\"\${SPRINT_DIR:-sprints/07130939-relay-4bb31ef5}\"" "$SCRIPT" >/dev/null || { echo "FAIL: wrapper 未绑定当前 sprint 默认值"; exit 1; }; ! grep -E "tmux[[:space:]]+new-session|tmux[[:space:]]+kill|killall|pkill" "$SCRIPT" >/dev/null || { echo "FAIL: wrapper 不得 spawn/kill 并发会话"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] Invariant 禁写死环境假设：端口、路径、DB、Brain URL、凭据位置优先来自 env 或当前 workspace
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07130939-relay-4bb31ef5/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; grep -F "BRAIN_URL=\"\${BRAIN_URL:-http://localhost:5221}\"" "$SCRIPT" >/dev/null || { echo "FAIL: BRAIN_URL 未走 env 默认"; exit 1; }; grep -F "DB=\"\${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}\"" "$SCRIPT" >/dev/null || { echo "FAIL: DATABASE_URL 未走 env 默认"; exit 1; }; grep -F "SPRINT_DIR=\"\${SPRINT_DIR:-sprints/07130939-relay-4bb31ef5}\"" "$SCRIPT" >/dev/null || { echo "FAIL: SPRINT_DIR 未走 env 默认"; exit 1; }; ! grep -E "ssh[[:space:]]+|38\\.23\\.47\\.81|/Users/administrator|/root/\\.ssh|/home/[^[:space:]]+/\\.ssh|ghp_[A-Za-z0-9_]+" "$SCRIPT" >/dev/null || { echo "FAIL: wrapper 含写死环境假设或真实凭据痕迹"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] Invariant 真环境验证才 done：必须打真实 Brain API、PostgreSQL、headed smoke、真实 ci.yml 文本，不允许 mock/stub/吞错
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07130939-relay-4bb31ef5/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; grep -F "claude-headed-dispatch-smoke.sh" "$SCRIPT" >/dev/null || { echo "FAIL: 未调用真实 headed smoke"; exit 1; }; grep -F "curl -sf \"$BRAIN_URL/api/brain/tasks/$TASK_ID\"" "$SCRIPT" >/dev/null || { echo "FAIL: 未 curl 真实 Brain task API"; exit 1; }; grep -F "psql \"$DB\"" "$SCRIPT" >/dev/null || { echo "FAIL: 未查询真实 PostgreSQL"; exit 1; }; grep -F ".github/workflows/ci.yml" "$SCRIPT" >/dev/null || { echo "FAIL: 未静态验证真实 ci.yml"; exit 1; }; ! grep -E "MOCK_|mock|stub|\\|\\|[[:space:]]*true|exit[[:space:]]+0[[:space:]]*(#.*)?$" "$SCRIPT" >/dev/null || { echo "FAIL: wrapper 含 mock/stub/吞错/无条件 exit 0"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] Invariant 凭据安全 + 日志脱敏：payload 不得含禁用字段，tui.log 不得含 token，日志缺失不得伪造
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07130939-relay-4bb31ef5/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; grep -F "has(\"token\") | not" "$SCRIPT" >/dev/null || { echo "FAIL: payload 未拒绝 token 字段"; exit 1; }; grep -F "has(\"github_token\") | not" "$SCRIPT" >/dev/null || { echo "FAIL: payload 未拒绝 github_token 字段"; exit 1; }; grep -F "has(\"anthropic_token\") | not" "$SCRIPT" >/dev/null || { echo "FAIL: payload 未拒绝 anthropic_token 字段"; exit 1; }; grep -F "has(\"thin_prd\") | not" "$SCRIPT" >/dev/null || { echo "FAIL: payload 未拒绝 thin_prd 字段"; exit 1; }; grep -F "ghp_" "$SCRIPT" >/dev/null || { echo "FAIL: tui.log 未检查 ghp_ token 模式"; exit 1; }; grep -F "WARN:" "$SCRIPT" >/dev/null || { echo "FAIL: 缺日志时未输出 WARN/evidence"; exit 1; }; ! grep -E "touch[[:space:]]+\\\"?\\$LOG_PATH|>>[[:space:]]*\\\"?\\$LOG_PATH|appendFileSync\\([^)]*LOG_PATH" "$SCRIPT" >/dev/null || { echo "FAIL: wrapper 不得创建/伪造 tui.log"; exit 1; }; echo OK'
  期望: OK

- [ ] [ARTIFACT] Invariant 端点鉴权 auth：N/A，本 sprint 不新增或修改 API 端点
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07130939-relay-4bb31ef5/contract-dod.md','utf8');if(!c.includes('端点鉴权 auth：N/A')||!c.includes('不新增或修改 API 端点'))process.exit(1)"

- [ ] [ARTIFACT] Invariant 租户隔离 tenant：N/A，本 sprint 不查询或修改租户作用域数据
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07130939-relay-4bb31ef5/contract-dod.md','utf8');if(!c.includes('租户隔离 tenant：N/A')||!c.includes('不查询或修改租户作用域数据'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，local_api 本机执行）

- [ ] [BEHAVIOR] e2e wrapper 调用 claude-headed-dispatch-smoke.sh
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07130939-relay-4bb31ef5/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; grep -F "packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh" "$SCRIPT" >/dev/null || { echo "FAIL: wrapper 未调用新 headed smoke"; exit 1; }; grep -F "packages/quality/smoke-allowlist.txt" "$SCRIPT" >/dev/null || { echo "FAIL: wrapper 未验证 allowlist"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] payload 包含 mode=headed、executor=claude、orchestrator=skill-relay 且禁用 token/github_token/anthropic_token/thin_prd
  Test: manual:bash -c 'set -euo pipefail; TASK_ID="${TASK_ID:-4bb31ef5-e140-41f4-9daf-9ca4a9e51216}"; BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"; RESP=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID"); echo "$RESP" | jq -e ".id == env.TASK_ID"; echo "$RESP" | jq -e ".task_type == \"harness_initiative\""; echo "$RESP" | jq -e ".payload.mode == \"headed\" and .payload.executor == \"claude\" and .payload.orchestrator == \"skill-relay\""; echo "$RESP" | jq -e "(.payload | has(\"token\") | not) and (.payload | has(\"github_token\") | not) and (.payload | has(\"anthropic_token\") | not) and (.payload | has(\"thin_prd\") | not)"; echo OK'
  期望: OK

- [ ] [BEHAVIOR] initiative_runs 含 skill-relay-claude-headed 且 phase 拒绝 failed/unknown
  Test: manual:bash -c 'set -euo pipefail; TASK_ID="${TASK_ID:-4bb31ef5-e140-41f4-9daf-9ca4a9e51216}"; DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"; ROW=$(psql "$DB" -XAt -F "|" -c "SELECT orchestrator_host, phase, started_at, COALESCE(completed_at::text, chr(32)) FROM initiative_runs WHERE initiative_id = \$\$${TASK_ID}\$\$ ORDER BY started_at DESC LIMIT 1"); [ -n "$ROW" ] || { echo "FAIL: initiative_runs 无当前 task run"; exit 1; }; HOST=$(printf "%s" "$ROW" | cut -d"|" -f1); PHASE=$(printf "%s" "$ROW" | cut -d"|" -f2); STARTED_AT=$(printf "%s" "$ROW" | cut -d"|" -f3); [ "$HOST" = "skill-relay-claude-headed" ] || { echo "FAIL: host=$HOST"; exit 1; }; if [ "$PHASE" = "failed" ]; then echo "FAIL: phase=failed"; exit 1; fi; case "$PHASE" in A_planning|planning|gan|generate|evaluate|done) ;; *) echo "FAIL: phase=$PHASE"; exit 1 ;; esac; [ -n "$STARTED_AT" ] || { echo "FAIL: started_at 为空"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] ci.yml DoD 动态 seed 步骤补齐 claude-headed 分支，且 codex-headed 既有分支不回归（顺序性静态断言，Plan A）
  Test: manual:bash -c 'set -euo pipefail; CI_YML=".github/workflows/ci.yml"; [ -f "$CI_YML" ] || { echo "FAIL: missing $CI_YML"; exit 1; }; grep -F "skill-relay-claude-headed" "$CI_YML" >/dev/null || { echo "FAIL: ci.yml 缺 claude-headed 分支标记"; exit 1; }; grep -F "skill-relay-codex-headed" "$CI_YML" >/dev/null || { echo "FAIL: ci.yml 回归破坏 codex-headed 分支"; exit 1; }; grep -F "\"executor\":\"claude\"" "$CI_YML" >/dev/null || { echo "FAIL: ci.yml claude-headed 分支未 seed executor=claude"; exit 1; }; grep -F "\"executor\":\"codex\"" "$CI_YML" >/dev/null || { echo "FAIL: ci.yml codex-headed 分支 executor=codex 被移除"; exit 1; }; CLAUDE_LINE=$(grep -n "skill-relay-claude-headed" "$CI_YML" | head -1 | cut -d: -f1); CODEX_SEED_LINE=$(grep -n "\"executor\":\"codex\"" "$CI_YML" | head -1 | cut -d: -f1); [ -n "$CLAUDE_LINE" ] && [ -n "$CODEX_SEED_LINE" ] || { echo "FAIL: 缺 claude/codex 行号，无法判定优先级"; exit 1; }; [ "$CLAUDE_LINE" -lt "$CODEX_SEED_LINE" ] || { echo "FAIL: claude-headed 精确判定(行$CLAUDE_LINE)未先于 codex 通用/兜底 seed(行$CODEX_SEED_LINE)，claude-headed 任务可能被误 seed 成 codex 身份"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] tui.log 存在则验真，缺失则验留痕机制且不伪造
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07130939-relay-4bb31ef5/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; grep -F "tui.log" "$SCRIPT" >/dev/null || { echo "FAIL: wrapper 未验证 tui.log"; exit 1; }; grep -F "WARN:" "$SCRIPT" >/dev/null || { echo "FAIL: 缺日志时必须输出 WARN/evidence"; exit 1; }; grep -F "packages/brain/src/harness-skill-relay.js" "$SCRIPT" >/dev/null || { echo "FAIL: 缺日志时必须验证 relay 源码"; exit 1; }; grep -F "appendFileSync" "$SCRIPT" >/dev/null || { echo "FAIL: 缺日志分支未验证 appendFileSync"; exit 1; }; grep -F "headed spawn" "$SCRIPT" >/dev/null || { echo "FAIL: 缺日志分支未验证 headed spawn"; exit 1; }; ! grep -E "touch[[:space:]]+\\\"?\\$LOG_PATH|>>[[:space:]]*\\\"?\\$LOG_PATH|appendFileSync\\([^)]*LOG_PATH" "$SCRIPT" >/dev/null || { echo "FAIL: wrapper 不得 touch/append tui.log"; exit 1; }; grep -E "FAIL: tui\\.log 缺失|tui\\.log 缺失或为空" "$SCRIPT" >/dev/null && { echo "FAIL: 缺日志不得硬失败"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] local_api E2E wrapper 完整验证当前 task/run/log/ci-seed 外部真相
  Test: manual:bash -c 'set -euo pipefail; TASK_ID="${TASK_ID:-4bb31ef5-e140-41f4-9daf-9ca4a9e51216}" BRAIN_URL="${BRAIN_URL:-http://localhost:5221}" DATABASE_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}" bash sprints/07130939-relay-4bb31ef5/e2e-verify.sh'
  期望: OK
