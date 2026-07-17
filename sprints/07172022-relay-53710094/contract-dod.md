---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: codex-headed-smoke

**范围**: 仅为当前 task `53710094-898c-452c-8cc3-a56149e8b0ac` 的 codex headed skill-relay smoke 生成可复跑验收 wrapper 与 red tests；不新增业务功能，不改 dashboard/UI，不改 migrations，不扩大到 claude/headless。
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] `scripts/smoke/e2e/relay-53710094.sh` 存在且 bash 语法正确，脚本内锚定当前 task id 与 `executor=codex`
  Test: node -e "const fs=require('fs');const p='scripts/smoke/e2e/relay-53710094.sh';const c=fs.readFileSync(p,'utf8');if(!c.includes('53710094-898c-452c-8cc3-a56149e8b0ac')||!c.includes('executor')||!c.includes('codex'))process.exit(1)"

- [x] [ARTIFACT] red test 文件存在，覆盖名与 DoD BEHAVIOR 名字保持字面子串关系
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('tests/regression/relay-53710094/contract-red.test.sh','utf8');for(const s of ['e2e-verify.sh 校验 task API payload shape','e2e-verify.sh 校验 DB tasks 认领状态','e2e-verify.sh 对 initiative_runs 采用可选 run 或 foreground path','e2e-verify.sh 拒绝 failed 状态并不记录敏感字段']){if(!c.includes(s)){console.error('missing '+s);process.exit(1)}}"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [x] [BEHAVIOR] e2e-verify.sh 校验 task API payload shape
  Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07172022-relay-53710094}"; VERIFY="${VERIFY:-scripts/smoke/e2e/relay-53710094.sh}"; TASK_ID="${TASK_ID:-53710094-898c-452c-8cc3-a56149e8b0ac}"; BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"; bash "$VERIFY" --assert task-payload-shape'
  期望: exit 0，且真实 curl Brain task API 后校验 mode/executor/orchestrator/journey_id

- [x] [BEHAVIOR] e2e-verify.sh 校验 DB tasks 认领状态
  Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07172022-relay-53710094}"; VERIFY="${VERIFY:-scripts/smoke/e2e/relay-53710094.sh}"; TASK_ID="${TASK_ID:-53710094-898c-452c-8cc3-a56149e8b0ac}"; DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"; bash "$VERIFY" --assert db-tasks-claimed'
  期望: exit 0，且真实 psql 定点读取 `tasks.id=TASK_ID`

- [x] [BEHAVIOR] e2e-verify.sh 对 initiative_runs 采用可选 run 或 foreground path
  Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07172022-relay-53710094}"; VERIFY="${VERIFY:-scripts/smoke/e2e/relay-53710094.sh}"; TASK_ID="${TASK_ID:-53710094-898c-452c-8cc3-a56149e8b0ac}"; DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"; bash "$VERIFY" --assert run-or-foreground-path'
  期望: exit 0；存在 run 时校验 host/phase，不存在 run 时必须以前台接管证据放行并输出 concern

- [x] [BEHAVIOR] e2e-verify.sh 拒绝 failed 状态并不记录敏感字段
  Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07172022-relay-53710094}"; VERIFY="${VERIFY:-scripts/smoke/e2e/relay-53710094.sh}"; TASK_ID="${TASK_ID:-53710094-898c-452c-8cc3-a56149e8b0ac}"; BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"; DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"; bash "$VERIFY" --assert failed-and-secrets-rejected'
  期望: exit 0；task.status 不得是 failed，payload 不含 token/github_token/anthropic_token/openai_api_key，run 若存在不得 phase=failed

## Invariant 覆盖登记

- N/A: [Lint异步] 本 sprint 不新增 lint 读源码逻辑。
- [x] [BEHAVIOR] INV-表格契约 Test Contract 表格固定 4 列，Test File 使用 backtick，第三列为测试路径可解析
  Test: manual:bash -c 'set -euo pipefail; node -e "const fs=require(\"fs\");const c=fs.readFileSync(\"sprints/07172022-relay-53710094/contract-draft.md\",\"utf8\");const m=c.match(/## Test Contract[\\s\\S]*$/);if(!m)process.exit(1);const rows=m[0].split(/\\n/).filter(l=>l.startsWith(\"|\"));if(!rows.length)process.exit(1);for(const r of rows){const cells=r.split(\"|\").length-2;if(cells!==4){console.error(\"bad cells\",cells,r);process.exit(1)}}const needle=String.fromCharCode(96)+\"../../tests/regression/relay-53710094/contract-red.test.sh\"+String.fromCharCode(96);if(!m[0].includes(needle))process.exit(1);"'
- N/A: [Red提交] 当前 proposer commit 精确 add 合同路径，不执行 generator red commit。
- [x] [BEHAVIOR] INV-回归验证 使用真实 Brain API 与 DB 接缝，不以 mock 覆盖替代
  Test: manual:bash -c 'set -euo pipefail; grep -q "Brain task API" sprints/07172022-relay-53710094/contract-draft.md; grep -q "tasks" sprints/07172022-relay-53710094/contract-draft.md; grep -q "Headed relay" sprints/07172022-relay-53710094/contract-draft.md; grep -q "initiative_runs" sprints/07172022-relay-53710094/contract-draft.md'
- N/A: [Cron入口] 本 sprint 不新增 cron。
- N/A: [禁止自合] 本 sprint 不创建或合并 PR。
- [x] [BEHAVIOR] INV-Headed环境 e2e wrapper 显式接受 harness 上下文变量
  Test: manual:bash -c 'set -euo pipefail; node -e "const fs=require(\"fs\");const c=fs.readFileSync(\"sprints/07172022-relay-53710094/contract-draft.md\",\"utf8\");for(const s of [\"TASK_ID\",\"BRAIN_URL\",\"SPRINT_DIR\",\"DATABASE_URL\"]){if(!c.includes(s)){console.error(\"missing \"+s);process.exit(1)}}"; echo OK'
- [x] [BEHAVIOR] INV-模板复用 已核对本次任务真实派发/执行历史而非复用历史 task id
  Test: manual:bash -c 'set -euo pipefail; curl -sf "${BRAIN_URL:-http://localhost:5221}/api/brain/tasks/${TASK_ID:-53710094-898c-452c-8cc3-a56149e8b0ac}" | jq -e ".id == \"${TASK_ID:-53710094-898c-452c-8cc3-a56149e8b0ac}\" and .payload.executor == \"codex\""'
- N/A: [共享CI] 本 sprint 不修改共享 CI。
- N/A: [SHA核验] 本 sprint 不创建 PR 或 merge verdict。
- N/A: [Smoke铁律] 本 sprint 以 smoke wrapper 验当前 task，不修改 smoke allowlist。
- N/A: [BrainSmoke] 本 sprint 不改 `packages/brain/src`。
- N/A: [新task接线] 本 sprint 不新增 task_type。
- N/A: [服务判活] 本 sprint 不新增常驻服务。
- N/A: [LaunchAgents] 本 sprint 不新增 LaunchAgent。
- N/A: [常驻服务] 本 sprint 不新增宿主服务。
- N/A: [单slot串行] 本 sprint 仅输出合同产物，不并发写同一工作区。
- [x] [BEHAVIOR] INV-禁写死假设 运行环境通过变量传入并带本地默认值
  Test: manual:bash -c 'set -euo pipefail; grep -q "BRAIN_URL.*localhost:5221" sprints/07172022-relay-53710094/contract-draft.md; grep -q "DATABASE_URL" sprints/07172022-relay-53710094/contract-draft.md'
- [x] [BEHAVIOR] INV-真验才done 接缝断言必须真目标验证
  Test: manual:bash -c 'set -euo pipefail; grep -q "禁 mock 边清单" sprints/07172022-relay-53710094/contract-draft.md; grep -q "未覆盖真实链路清单" sprints/07172022-relay-53710094/contract-draft.md'
- N/A: [多租户测试] 本 smoke 不触及租户数据。
- [x] [BEHAVIOR] INV-凭据安全 payload 不含常见 secret 字段
  Test: manual:bash -c 'set -euo pipefail; curl -sf "${BRAIN_URL:-http://localhost:5221}/api/brain/tasks/${TASK_ID:-53710094-898c-452c-8cc3-a56149e8b0ac}" | jq -e "(.payload | has(\"token\") | not) and (.payload | has(\"github_token\") | not) and (.payload | has(\"anthropic_token\") | not) and (.payload | has(\"openai_api_key\") | not)"'
- [x] [BEHAVIOR] INV-日志脱敏 合同不要求输出 token 或完整敏感 prompt
  Test: manual:bash -c 'set -euo pipefail; ! grep -RniE "ghp_[A-Za-z0-9]|sk-[A-Za-z0-9]{20,}" sprints/07172022-relay-53710094/contract-draft.md sprints/07172022-relay-53710094/contract-dod.md'
- N/A: [端点鉴权] 本 sprint 不新增 API 端点。
- N/A: [租户隔离] 本 sprint 不读写租户数据。
