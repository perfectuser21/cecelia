contract_branch: cp-07151300-headed-smoke-049
sprint_dir: sprints/07151245-relay-049ebf93

---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Sprint: headed relay 派发链路自测（claude-headed, task 049ebf93）

**范围**: 新增锚定 task_id=049ebf93-fa61-4777-b619-5a44fcce296a 的 `sprints/07151245-relay-049ebf93/e2e-verify.sh`；复用（不重实现）`packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh`；只读校验 Brain task 记录与 `initiative_runs` 记录状态；不新增业务功能、dashboard/UI、migration，不改 `claude-headed-dispatch-smoke.sh` 本体，不改 `ci.yml`（4bb31ef5 已落地），不重复登记 allowlist。
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] contract draft 含 Golden Path 与 E2E 验收
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07151245-relay-049ebf93/contract-draft.md','utf8');if(!c.includes('## Golden Path')||!c.includes('## E2E 验收'))process.exit(1)"

- [x] [ARTIFACT] generator 补 sprint-local e2e wrapper，锚定当前 task_id
  Test: node -e "const fs=require('fs');const p='sprints/07151245-relay-049ebf93/e2e-verify.sh';const c=fs.readFileSync(p,'utf8');if(!c.includes('claude-headed-dispatch-smoke.sh')||!c.includes('049ebf93-fa61-4777-b619-5a44fcce296a'))process.exit(1)"

- [x] [ARTIFACT] 复用的 claude headed smoke 已在 allowlist 登记（不重复登记，只校验存在）
  Test: grep -Fxq "claude-headed-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt

- [x] [ARTIFACT] Invariant 端点鉴权 auth：N/A，本 sprint 不新增或修改 API 端点
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07151245-relay-049ebf93/contract-dod.md','utf8');if(!c.includes('端点鉴权 auth：N/A')||!c.includes('不新增或修改 API 端点'))process.exit(1)"

- [x] [ARTIFACT] Invariant 租户隔离 tenant：N/A，本 sprint 不查询或修改租户作用域数据
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07151245-relay-049ebf93/contract-dod.md','utf8');if(!c.includes('租户隔离 tenant：N/A')||!c.includes('不查询或修改租户作用域数据'))process.exit(1)"

## Invariant 覆盖条目（PRD 铁律 1:1 映射，来源: area）

- [x] [BEHAVIOR] INV-1 单slot串行：wrapper 只做当前 sprint/task 只读验证，不并发写同一工作区
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07151245-relay-049ebf93/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; grep -F "TASK_ID=\"\${TASK_ID:-049ebf93-fa61-4777-b619-5a44fcce296a}\"" "$SCRIPT" >/dev/null || { echo "FAIL: wrapper 未绑定当前 task 默认值"; exit 1; }; grep -F "SPRINT_DIR=\"\${SPRINT_DIR:-sprints/07151245-relay-049ebf93}\"" "$SCRIPT" >/dev/null || { echo "FAIL: wrapper 未绑定当前 sprint 默认值"; exit 1; }; ! grep -E "tmux[[:space:]]+new-session|tmux[[:space:]]+kill|killall|pkill" "$SCRIPT" >/dev/null || { echo "FAIL: wrapper 不得 spawn/kill 并发会话"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] INV-2 禁写死环境假设：端口、路径、DB、Brain URL 优先来自 env 或当前 workspace
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07151245-relay-049ebf93/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; grep -F "BRAIN_URL=\"\${BRAIN_URL:-http://localhost:5221}\"" "$SCRIPT" >/dev/null || { echo "FAIL: BRAIN_URL 未走 env 默认"; exit 1; }; grep -F "DB=\"\${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}\"" "$SCRIPT" >/dev/null || { echo "FAIL: DATABASE_URL 未走 env 默认"; exit 1; }; ! grep -E "ssh[[:space:]]+|38\\.23\\.47\\.81|/Users/administrator|/root/\\.ssh|ghp_[A-Za-z0-9_]+" "$SCRIPT" >/dev/null || { echo "FAIL: wrapper 含写死环境假设或真实凭据痕迹"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] INV-3 真环境验证才算done：必须打真实 Brain API + 真实 PostgreSQL + 真实 headed smoke，不允许 mock/stub/吞错
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07151245-relay-049ebf93/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; grep -F "claude-headed-dispatch-smoke.sh" "$SCRIPT" >/dev/null || { echo "FAIL: 未调用真实 headed smoke"; exit 1; }; grep -F "curl -sf \"$BRAIN_URL/api/brain/tasks/$TASK_ID\"" "$SCRIPT" >/dev/null || { echo "FAIL: 未 curl 真实 Brain task API"; exit 1; }; grep -F "psql \"$DB\"" "$SCRIPT" >/dev/null || { echo "FAIL: 未查询真实 PostgreSQL"; exit 1; }; ! grep -E "MOCK_|mock|stub|\\|\\|[[:space:]]*true|exit[[:space:]]+0[[:space:]]*(#.*)?$" "$SCRIPT" >/dev/null || { echo "FAIL: wrapper 含 mock/stub/吞错/无条件 exit 0"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] INV-4/INV-5 凭据安全 + 日志脱敏：payload 必须拒绝 token/github_token/anthropic_token/thin_prd 明文字段
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07151245-relay-049ebf93/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; grep -F "has(\"token\") | not" "$SCRIPT" >/dev/null || { echo "FAIL: payload 未拒绝 token 字段"; exit 1; }; grep -F "has(\"github_token\") | not" "$SCRIPT" >/dev/null || { echo "FAIL: payload 未拒绝 github_token 字段"; exit 1; }; grep -F "has(\"anthropic_token\") | not" "$SCRIPT" >/dev/null || { echo "FAIL: payload 未拒绝 anthropic_token 字段"; exit 1; }; grep -F "has(\"thin_prd\") | not" "$SCRIPT" >/dev/null || { echo "FAIL: payload 未拒绝 thin_prd 字段"; exit 1; }; echo OK'
  期望: OK

## BEHAVIOR 条目（内嵌可执行 manual: 命令，local_api 本机执行）

- [x] [BEHAVIOR] e2e-verify.sh 调用 claude-headed-dispatch-smoke.sh 并校验 allowlist 登记
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07151245-relay-049ebf93/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; grep -F "packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh" "$SCRIPT" >/dev/null || { echo "FAIL: wrapper 未调用 headed smoke"; exit 1; }; grep -F "packages/quality/smoke-allowlist.txt" "$SCRIPT" >/dev/null || { echo "FAIL: wrapper 未校验 allowlist"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] task payload 三元组齐全且不含敏感字段（真实 curl 当前 task）
  Test: manual:bash -c 'set -euo pipefail; TASK_ID="${TASK_ID:-049ebf93-fa61-4777-b619-5a44fcce296a}"; BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"; RESP=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID"); echo "$RESP" | jq -e ".id == env.TASK_ID"; echo "$RESP" | jq -e ".payload.mode == \"headed\" and .payload.executor == \"claude\" and .payload.orchestrator == \"skill-relay\""; echo "$RESP" | jq -e "(.payload | has(\"token\") | not) and (.payload | has(\"github_token\") | not) and (.payload | has(\"anthropic_token\") | not) and (.payload | has(\"thin_prd\") | not)"; echo OK'
  期望: OK

- [x] [BEHAVIOR] initiative_runs 含 skill-relay-claude-headed 且 phase 拒绝 failed/unknown（真实 psql 定点查当前 task）
  Test: manual:bash -c 'set -euo pipefail; TASK_ID="${TASK_ID:-049ebf93-fa61-4777-b619-5a44fcce296a}"; DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"; ROW=$(psql "$DB" -XAt -F "|" -c "SELECT orchestrator_host, phase, started_at FROM initiative_runs WHERE initiative_id = \$\$${TASK_ID}\$\$ ORDER BY started_at DESC LIMIT 1"); [ -n "$ROW" ] || { echo "FAIL: initiative_runs 无当前 task run"; exit 1; }; HOST=$(printf "%s" "$ROW" | cut -d"|" -f1); PHASE=$(printf "%s" "$ROW" | cut -d"|" -f2); STARTED_AT=$(printf "%s" "$ROW" | cut -d"|" -f3); case "$HOST" in *skill-relay-claude-headed*) ;; *) echo "FAIL: host=$HOST"; exit 1 ;; esac; if [ "$PHASE" = "failed" ]; then echo "FAIL: phase=failed"; exit 1; fi; case "$PHASE" in A_planning|planning|gan|generate|evaluate|done) ;; *) echo "FAIL: phase=$PHASE"; exit 1 ;; esac; [ -n "$STARTED_AT" ] || { echo "FAIL: started_at 为空"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] local_api E2E wrapper 锚定当前 task_id 完整验证 smoke/task/run 外部真相
  Test: manual:bash -c 'TASK_ID="${TASK_ID:-049ebf93-fa61-4777-b619-5a44fcce296a}" BRAIN_URL="${BRAIN_URL:-http://localhost:5221}" DATABASE_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}" bash sprints/07151245-relay-049ebf93/e2e-verify.sh'
  期望: OK
