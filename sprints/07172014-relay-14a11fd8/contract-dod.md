---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Sprint: headed relay 派发链路自测（claude-headed, task 14a11fd8）

**范围**: 新增锚定 task_id=14a11fd8-0d2f-49e2-885b-9286fc1d76f7 的 `sprints/07172014-relay-14a11fd8/e2e-verify.sh` 与 `tests/regression/relay-14a11fd8/headed-smoke-contract.test.ts`；复用（不重实现）`packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh`；只读校验 Brain task 记录、`initiative_runs` 记录状态、本 sprint 未越权改动 CI 基础设施；不新增业务功能、dashboard/UI、migration，不改 `claude-headed-dispatch-smoke.sh` 本体，不改 `.github/workflows/*.yml`/`packages/quality/smoke-allowlist.txt`，不重复登记 allowlist。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] contract draft 含 Golden Path 与 E2E 验收
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07172014-relay-14a11fd8/contract-draft.md','utf8');if(!c.includes('## Golden Path')||!c.includes('## E2E 验收'))process.exit(1)"

- [ ] [ARTIFACT] generator 补 sprint-local e2e wrapper，锚定当前 task_id
  Test: node -e "const fs=require('fs');const p='sprints/07172014-relay-14a11fd8/e2e-verify.sh';const c=fs.readFileSync(p,'utf8');if(!c.includes('claude-headed-dispatch-smoke.sh')||!c.includes('14a11fd8-0d2f-49e2-885b-9286fc1d76f7'))process.exit(1)"

- [ ] [ARTIFACT] generator 补契约测试文件，锚定当前 task_id
  Test: node -e "const fs=require('fs');const p='tests/regression/relay-14a11fd8/headed-smoke-contract.test.ts';const c=fs.readFileSync(p,'utf8');if(!c.includes('14a11fd8')||!c.includes('[BEHAVIOR]'))process.exit(1)"

- [ ] [ARTIFACT] 复用的 claude headed smoke 已在 allowlist 登记（不重复登记，只校验存在）
  Test: grep -Fxq "claude-headed-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt

## Invariant 覆盖条目（PRD 27 条铁律 1:1 映射，来源: PrepPRD/area）

- [ ] [BEHAVIOR] INV-1 [复用不重写]（来源: PrepPRD）不得重新实现 claude-headed-dispatch-smoke.sh，只能复用调用；脚本 sha256 与起草基线一致
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh"; E2E="sprints/07172014-relay-14a11fd8/e2e-verify.sh"; [ -f "$E2E" ] || { echo "FAIL: missing $E2E"; exit 1; }; grep -F "$SCRIPT" "$E2E" >/dev/null || { echo "FAIL: e2e-verify.sh 未调用 smoke 脚本"; exit 1; }; SHA=$(shasum -a 256 "$SCRIPT" | awk "{print \$1}"); [ "$SHA" = "7a3a76b32bc683942d09efe6447ea5ce66a318939d1be9908c2fc4cf5d0a69fb" ] || { echo "FAIL: smoke 脚本 sha256=$SHA 与基线不符，疑似被重写"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-2 [CI范围锁定]（来源: PrepPRD）不得修改 CI workflow，4bb31ef5 先例已锁定该范围，本次不重复扩权
  Test: manual:bash -c 'set -euo pipefail; git fetch origin main --quiet 2>/dev/null || true; DIFF=$(git diff origin/main...HEAD --name-only -- .github/workflows/ 2>/dev/null || echo ""); [ -z "$DIFF" ] || { echo "FAIL: CI workflow 越权改动: $DIFF"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-3 [禁止吞错]（来源: PrepPRD）e2e-verify.sh 不得出现 MOCK_ 或 || true 吞错模式
  Test: manual:bash -c 'set -euo pipefail; E2E="sprints/07172014-relay-14a11fd8/e2e-verify.sh"; [ -f "$E2E" ] || { echo "FAIL: missing $E2E"; exit 1; }; ! grep -E "MOCK_|\|\|[[:space:]]*true" "$E2E" >/dev/null || { echo "FAIL: e2e-verify.sh 含 MOCK_/吞错模式"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-4 [async包裹测试]（来源: area）lint-test-quality 要求 await fn() ≥ 1，读源码必须包装 async function，不能直接 readFileSync
  Test: manual:bash -c 'set -euo pipefail; T="tests/regression/relay-14a11fd8/headed-smoke-contract.test.ts"; [ -f "$T" ] || { echo "FAIL: missing $T"; exit 1; }; grep -E "async[[:space:]]*(function|\()" "$T" >/dev/null || { echo "FAIL: 测试文件缺 async 包裹"; exit 1; }; grep -E "await[[:space:]]" "$T" >/dev/null || { echo "FAIL: 测试文件缺 await 调用"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-5 [Test Contract格式]（来源: area）Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹
  Test: manual:bash -c 'set -euo pipefail; D="sprints/07172014-relay-14a11fd8/contract-draft.md"; [ -f "$D" ] || { echo "FAIL: missing $D"; exit 1; }; grep -F "| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |" "$D" >/dev/null || { echo "FAIL: Test Contract 表头非固定4列格式"; exit 1; }; grep -E "\| \`tests/regression/relay-14a11fd8" "$D" >/dev/null || { echo "FAIL: testFile 列未用 backtick 包裹"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-6 [Red commit范围]（来源: area）Red commit 必须只 git add 精确路径（*.test.ts），禁止 git add . 或 git add .harness/
  Test: manual:bash -c 'set -euo pipefail; T="tests/regression/relay-14a11fd8/headed-smoke-contract.test.ts"; COMMIT=$(git log --diff-filter=A --format=%H -- "$T" | tail -1); [ -n "$COMMIT" ] || { echo "FAIL: 未找到新增测试文件的 commit"; exit 1; }; FILES=$(git show --stat --format="" "$COMMIT" | sed -E "s/^[[:space:]]*//; s/[[:space:]]*\|.*$//"); BAD=$(printf "%s\n" "$FILES" | grep -vE "^tests/regression/relay-14a11fd8/" || true); [ -z "$BAD" ] || { echo "FAIL: Red commit 混入非测试路径: $BAD"; exit 1; }; printf "%s\n" "$FILES" | grep -q "\.harness/" && { echo "FAIL: Red commit 误 add .harness/"; exit 1; } || true; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-7 [回归验证方法]（来源: area）回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效
  Test: manual:bash -c 'set -euo pipefail; E2E="sprints/07172014-relay-14a11fd8/e2e-verify.sh"; [ -f "$E2E" ] || { echo "FAIL: missing $E2E"; exit 1; }; grep -E "curl|psql" "$E2E" >/dev/null || { echo "FAIL: e2e-verify.sh 未做真实外部调用/DB 查询"; exit 1; }; ! grep -E "jest\.mock|vi\.mock|sinon\.(stub|spy)" "$E2E" >/dev/null || { echo "FAIL: e2e-verify.sh 使用了 mock 框架"; exit 1; }; echo OK'
  期望: OK

- [ ] [ARTIFACT] INV-8 [cron排查路径] N/A：本任务不涉及新增 cron 功能，与 scheduler-jobs.js/tick-runner.js 无关
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07172014-relay-14a11fd8/contract-dod.md','utf8');if(!c.includes('INV-8 [cron排查路径] N/A'))process.exit(1)"

- [ ] [ARTIFACT] INV-9 [merge权归controller] N/A：proposer/generator 阶段不涉及 merge 动作，task-plan.json 不含 merge 指令
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07172014-relay-14a11fd8/task-plan.json','utf8');if(/merge/i.test(c))process.exit(1)"

- [ ] [ARTIFACT] INV-10 [tmux环境变量] N/A：本任务 e2e-verify.sh 不含 tmux innerCmd 子 shell 逻辑
  Test: manual:bash -c 'set -euo pipefail; E2E="sprints/07172014-relay-14a11fd8/e2e-verify.sh"; [ -f "$E2E" ] || { echo "FAIL: missing $E2E"; exit 1; }; ! grep -F "tmux" "$E2E" >/dev/null || { echo "FAIL: e2e-verify.sh 意外含 tmux 逻辑，需按铁律显式 export 环境变量"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-11 [Proposer核实历史]（来源: area）Proposer 复用历史合同模板前必须先核对本次任务真实派发/执行历史
  Test: manual:bash -c 'set -euo pipefail; D="sprints/07172014-relay-14a11fd8/contract-draft.md"; [ -f "$D" ] || { echo "FAIL: missing $D"; exit 1; }; grep -F "INV-11 实测记录" "$D" >/dev/null || { echo "FAIL: contract-draft.md 缺 Proposer 核实历史实测记录段"; exit 1; }; grep -F "orchestrator_host=skill-relay-claude-headed" "$D" >/dev/null || { echo "FAIL: 缺真实 psql 实测值佐证"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-12 [CI基础设施禁区]（来源: area）harness-generator 对共享 CI 基础设施文件默认禁区，未经合同显式授权不可修改
  Test: manual:bash -c 'set -euo pipefail; git fetch origin main --quiet 2>/dev/null || true; DIFF=$(git diff origin/main...HEAD --name-only -- .github/workflows/ packages/quality/smoke-allowlist.txt 2>/dev/null || echo ""); [ -z "$DIFF" ] || { echo "FAIL: 共享 CI 基础设施文件被越权改动: $DIFF"; exit 1; }; echo OK'
  期望: OK

- [ ] [ARTIFACT] INV-13 [PR SHA核对] N/A：proposer/GAN 阶段无 PR，不涉及提前合并场景
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07172014-relay-14a11fd8/contract-dod.md','utf8');if(!c.includes('INV-13 [PR SHA核对] N/A'))process.exit(1)"

- [ ] [BEHAVIOR] INV-14 [PR前置smoke登记]（来源: area）feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红
  Test: manual:bash -c 'set -euo pipefail; grep -Fxq "claude-headed-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt || { echo "FAIL: claude-headed-dispatch-smoke.sh 未登记，本 PR 前置未带齐"; exit 1; }; echo OK'
  期望: OK

- [ ] [ARTIFACT] INV-15 [新task_type接线清单] N/A：本任务不新增 task_type，不涉及 task-router 四表/EXECUTOR_KIND_FOR/relay loadSkill 映射
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07172014-relay-14a11fd8/contract-dod.md','utf8');if(!c.includes('INV-15 [新task_type接线清单] N/A'))process.exit(1)"

- [ ] [ARTIFACT] INV-16 [服务存活双信号] N/A：本任务不涉及常驻服务存活判定
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07172014-relay-14a11fd8/contract-dod.md','utf8');if(!c.includes('INV-16 [服务存活双信号] N/A'))process.exit(1)"

- [ ] [ARTIFACT] INV-17 [US Mac禁LaunchAgents] N/A：本任务不涉及 macOS LaunchAgents/LaunchDaemon 改动
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07172014-relay-14a11fd8/contract-dod.md','utf8');if(!c.includes('INV-17 [US Mac禁LaunchAgents] N/A'))process.exit(1)"

- [ ] [ARTIFACT] INV-18 [常驻服务登记manifest] N/A：本任务不新增常驻宿主服务，不涉及 launchd-patrol.js manifest
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07172014-relay-14a11fd8/contract-dod.md','utf8');if(!c.includes('INV-18 [常驻服务登记manifest] N/A'))process.exit(1)"

- [ ] [BEHAVIOR] INV-19 [单slot串行]（来源: area）单 slot/会话内严格串行执行任务，wrapper 不并发写同一工作区
  Test: manual:bash -c 'set -euo pipefail; E2E="sprints/07172014-relay-14a11fd8/e2e-verify.sh"; [ -f "$E2E" ] || { echo "FAIL: missing $E2E"; exit 1; }; ! grep -E "tmux[[:space:]]+new-session|tmux[[:space:]]+kill|killall|pkill|[[:space:]]&[[:space:]]*$" "$E2E" >/dev/null || { echo "FAIL: wrapper 不得 spawn/kill 并发会话"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-20 [禁止写死环境假设值]（来源: area）端口、路径、DB、Brain URL 优先来自 env 或当前 workspace
  Test: manual:bash -c 'set -euo pipefail; E2E="sprints/07172014-relay-14a11fd8/e2e-verify.sh"; [ -f "$E2E" ] || { echo "FAIL: missing $E2E"; exit 1; }; grep -F "BRAIN_URL=\"\${BRAIN_URL:-http://localhost:5221}\"" "$E2E" >/dev/null || { echo "FAIL: BRAIN_URL 未走 env 默认"; exit 1; }; grep -F "DB=\"\${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}\"" "$E2E" >/dev/null || { echo "FAIL: DATABASE_URL 未走 env 默认"; exit 1; }; ! grep -E "ssh[[:space:]]+|38\.23\.47\.81|/Users/administrator|/root/\.ssh|ghp_[A-Za-z0-9_]+" "$E2E" >/dev/null || { echo "FAIL: wrapper 含写死环境假设或真实凭据痕迹"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-21 [真环境验证才算done]（来源: area）依赖真机/生产 env 的接缝断言必须真验证过才能标 done
  Test: manual:bash -c 'set -euo pipefail; E2E="sprints/07172014-relay-14a11fd8/e2e-verify.sh"; [ -f "$E2E" ] || { echo "FAIL: missing $E2E"; exit 1; }; grep -F "claude-headed-dispatch-smoke.sh" "$E2E" >/dev/null || { echo "FAIL: 未调用真实 headed smoke"; exit 1; }; grep -F "curl -sf \"$BRAIN_URL/api/brain/tasks/$TASK_ID\"" "$E2E" >/dev/null || { echo "FAIL: 未 curl 真实 Brain task API"; exit 1; }; grep -F "psql \"$DB\"" "$E2E" >/dev/null || { echo "FAIL: 未查询真实 PostgreSQL"; exit 1; }; echo OK'
  期望: OK

- [ ] [ARTIFACT] INV-22 [测试默认多租户] N/A：本任务只读内部系统表（tasks/initiative_runs），不涉及租户 scope 数据
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07172014-relay-14a11fd8/contract-dod.md','utf8');if(!c.includes('INV-22 [测试默认多租户] N/A'))process.exit(1)"

- [ ] [BEHAVIOR] INV-23 [凭据安全]（来源: area）secrets 不硬编码、不进 git、不进日志
  Test: manual:bash -c 'set -euo pipefail; E2E="sprints/07172014-relay-14a11fd8/e2e-verify.sh"; [ -f "$E2E" ] || { echo "FAIL: missing $E2E"; exit 1; }; ! grep -E "ghp_[A-Za-z0-9_]+|sk-[A-Za-z0-9]+|AKIA[A-Z0-9]+" "$E2E" >/dev/null || { echo "FAIL: e2e-verify.sh 含疑似硬编码凭据"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-24 [日志脱敏]（来源: area）客户隐私/PII/聊天内容不得明文进日志
  Test: manual:bash -c 'set -euo pipefail; E2E="sprints/07172014-relay-14a11fd8/e2e-verify.sh"; [ -f "$E2E" ] || { echo "FAIL: missing $E2E"; exit 1; }; ! grep -E "^[[:space:]]*echo[[:space:]]+\"\\\$RESP\"[[:space:]]*$" "$E2E" >/dev/null || { echo "FAIL: e2e-verify.sh 直接原样 echo 整个 RESP，疑似日志泄漏 payload 明文"; exit 1; }; echo OK'
  期望: OK

- [ ] [ARTIFACT] INV-25 [端点鉴权] N/A：本任务不新增/修改 API 端点，仅调用既有已鉴权的 GET /api/brain/tasks/:id
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07172014-relay-14a11fd8/contract-dod.md','utf8');if(!c.includes('INV-25 [端点鉴权] N/A'))process.exit(1)"

- [ ] [ARTIFACT] INV-26 [租户隔离] N/A：initiative_runs/tasks 为系统内部表，本任务不涉及租户 scope 数据查询/写入
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07172014-relay-14a11fd8/contract-dod.md','utf8');if(!c.includes('INV-26 [租户隔离] N/A'))process.exit(1)"

- [ ] [ARTIFACT] INV-27 [smoke占位] N/A：PRD 自述"系统内部烟雾测试占位条目，非产品约束，仅存在性校验"
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07172014-relay-14a11fd8/contract-dod.md','utf8');if(!c.includes('INV-27 [smoke占位] N/A'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，local_api 本机执行）

- [ ] [BEHAVIOR] e2e-verify.sh 调用 claude-headed-dispatch-smoke.sh 并校验 allowlist 登记与脚本完整性
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07172014-relay-14a11fd8/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; grep -F "packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh" "$SCRIPT" >/dev/null || { echo "FAIL: wrapper 未调用 headed smoke"; exit 1; }; grep -F "packages/quality/smoke-allowlist.txt" "$SCRIPT" >/dev/null || { echo "FAIL: wrapper 未校验 allowlist"; exit 1; }; grep -F "BASELINE_SHA256" "$SCRIPT" >/dev/null || { echo "FAIL: wrapper 未校验脚本完整性"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] payload 三元组与 journey_id 齐全且禁用 token/github_token/anthropic_token/thin_prd（真实 curl 当前 task）
  Test: manual:bash -c 'set -euo pipefail; TASK_ID="${TASK_ID:-14a11fd8-0d2f-49e2-885b-9286fc1d76f7}"; export TASK_ID; BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"; RESP=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID"); echo "$RESP" | jq -e ".id == env.TASK_ID"; echo "$RESP" | jq -e ".payload.mode == \"headed\" and .payload.executor == \"claude\" and .payload.orchestrator == \"skill-relay\""; echo "$RESP" | jq -e ".payload.journey_id == \"bb8cc561-b3ee-4fec-b74d-2255694bd963\""; echo "$RESP" | jq -e "(.payload | has(\"token\") | not) and (.payload | has(\"github_token\") | not) and (.payload | has(\"anthropic_token\") | not) and (.payload | has(\"thin_prd\") | not)"; echo OK'
  期望: OK

- [ ] [BEHAVIOR] initiative_runs 含 skill-relay-claude-headed 且 phase 拒绝 failed/非法枚举（真实 psql 定点查当前 task）
  Test: manual:bash -c 'set -euo pipefail; TASK_ID="${TASK_ID:-14a11fd8-0d2f-49e2-885b-9286fc1d76f7}"; DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"; ROW=$(psql "$DB" -XAt -F "|" -c "SELECT orchestrator_host, phase, started_at FROM initiative_runs WHERE initiative_id='\''${TASK_ID}'\'' ORDER BY started_at DESC LIMIT 1"); [ -n "$ROW" ] || { echo "FAIL: initiative_runs 无当前 task run"; exit 1; }; HOST=$(printf "%s" "$ROW" | cut -d"|" -f1); PHASE=$(printf "%s" "$ROW" | cut -d"|" -f2); STARTED_AT=$(printf "%s" "$ROW" | cut -d"|" -f3); case "$HOST" in *skill-relay-claude-headed*) ;; *) echo "FAIL: host=$HOST"; exit 1 ;; esac; if [ "$PHASE" = "failed" ]; then echo "FAIL: phase=failed"; exit 1; fi; case "$PHASE" in A_planning|planning|gan|generate|evaluate|done) ;; *) echo "FAIL: phase=$PHASE"; exit 1 ;; esac; [ -n "$STARTED_AT" ] || { echo "FAIL: started_at 为空"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 不越权修改 CI workflow 或 smoke-allowlist（真实 git diff 对 origin/main）
  Test: manual:bash -c 'set -euo pipefail; git fetch origin main --quiet 2>/dev/null || true; DIFF=$(git diff origin/main...HEAD --name-only -- .github/workflows/ packages/quality/smoke-allowlist.txt 2>/dev/null || echo ""); [ -z "$DIFF" ] || { echo "FAIL: CI 范围越权改动: $DIFF"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] local_api E2E wrapper 完整验证当前 task 全链路无 mock 无吞错（真实执行整个 e2e-verify.sh）
  Test: manual:bash -c 'TASK_ID="${TASK_ID:-14a11fd8-0d2f-49e2-885b-9286fc1d76f7}" BRAIN_URL="${BRAIN_URL:-http://localhost:5221}" DATABASE_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}" bash sprints/07172014-relay-14a11fd8/e2e-verify.sh'
  期望: OK
