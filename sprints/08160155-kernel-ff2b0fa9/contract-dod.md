---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Generator/Publisher 权限边界生产回归

**范围**: Dispatcher 为 role=generator 注入 server-owned `runtime_resources.postgres=true`（caller false 不降权）；generator/publisher 角色边界锁定；新增 RED→GREEN permanent vitest + 源结构 smoke；smoke 永久接入 ratchet。**不扩大任何凭据/权限**。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] permanent 回归单测落 `packages/brain/src/orchestrator/__tests__/generator-runtime-resource-boundary.test.js`，消费真实 `buildInputs` 组装的 generator bundle（不 mock dispatcher）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/__tests__/generator-runtime-resource-boundary.test.js','utf8');if(!c.includes('createDispatcher')||/vi\.mock\((['\"]).*dispatcher/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 权威 smoke 存在于 PRD 指定路径且可执行
  Test: node -e "const fs=require('fs');fs.accessSync('packages/brain/scripts/smoke/generator-publisher-boundary-smoke.sh',fs.constants.X_OK)"

- [ ] [ARTIFACT] 顶层委派 wrapper 存在（smoke_pool 计入）
  Test: node -e "const fs=require('fs');fs.accessSync('scripts/smoke/generator-publisher-boundary-smoke.sh',fs.constants.F_OK)"

## BEHAVIOR 条目（五行剧本，L2 服务端真验；均同步观察，等待预算 0s）

- [ ] [BEHAVIOR] [L2] B-01: generator TaskBundle 获得 server-owned runtime_resources.postgres===true
  动作: 跑 permanent vitest —— 真消费 `createDispatcher(deps)('spawn:generator',...)` 经 buildInputs 组装出的 TaskBundle
  预期观察: `bundle.inputs.runtime_resources` 深等 `{postgres:true,node_deps:true}`，该 it 通过
  等待预算: 0s
  留证: vitest stdout 末 10 行（含该 it ✓）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/generator-runtime-resource-boundary.test.js -t "server-owned runtime_resources.postgres"'

- [ ] [BEHAVIOR] [L2] B-02: caller postgres:false 不降权——server-owned postgres 仍 true
  动作: 跑 permanent vitest 的 caller-false 用例（task.payload.runtime_resources.postgres=false）
  预期观察: 组装出的 bundle `inputs.runtime_resources.postgres===true`（caller payload 不可覆盖）
  等待预算: 0s
  留证: vitest stdout 末 10 行（含该 it ✓）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/generator-runtime-resource-boundary.test.js -t "caller postgres:false 不降权"'

- [ ] [BEHAVIOR] [L2] B-03: generator 只产本地候选、不 push/建 PR，Publisher 是唯一远端发布角色
  动作: 跑 permanent vitest 的角色边界用例，断言 generator/publisher objective 文本
  预期观察: `bundle.objective` 含 committed local candidate + Do not push or create a pull request + Publisher owns remote publication
  等待预算: 0s
  留证: vitest stdout 末 10 行（含该 it ✓）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/generator-runtime-resource-boundary.test.js -t "Publisher 是唯一远端发布角色"'

- [ ] [BEHAVIOR] [L2] B-04: 源结构 smoke 三条边界全过、退出码 0、失败打印边界名
  动作: 执行权威 smoke `packages/brain/scripts/smoke/generator-publisher-boundary-smoke.sh`
  预期观察: exit 0 且 stdout 含 `PASS: B1 ... | B2 ... | B3 ...`（实现前跑同一 smoke 应见 `FAIL[B1]`）
  等待预算: 0s
  留证: smoke stdout 全文
  Test: manual:bash -c 'bash packages/brain/scripts/smoke/generator-publisher-boundary-smoke.sh | grep -q "PASS: B1"'

- [ ] [BEHAVIOR] [L2] B-05: 不扩权零回归——其他角色 runtime_resources 语义不变 + 冲突单测已更新为新期望
  动作: 跑整段 dispatcher.test.js（含 :1844 反转后断言、proposer/reviewer/evaluator 既有语义用例）
  预期观察: 全绿——generator 新增 runtime_resources；proposer/reviewer 仍 `{postgres:false,node_deps:true}`；evaluator 仍 `{postgres:true,node_deps:true}`；judge/publisher/commander 仍无该字段
  等待预算: 0s
  留证: vitest stdout 末 15 行（Test Files 1 passed）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher.test.js'

- [ ] [BEHAVIOR] [L2] B-06: smoke 永久接入 ratchet——allowlist 登记 + smoke_pool 计数与 watermark 上调 + ratchet-guard 通过
  动作: 校验 allowlist 含权威 smoke、scripts/smoke 计数 >= 上调后 watermark(>=14)、ratchet-guard 不报错
  预期观察: allowlist grep 命中；`find scripts/smoke -type f -name '*.sh'` 计数 >= watermark；ratchet-guard exit 0
  等待预算: 0s
  留证: 命令输出（allowlist 命中行 + POOL/WM 数值 + ratchet-guard 退出码）
  Test: manual:bash -c 'grep -qxF generator-publisher-boundary-smoke.sh packages/quality/smoke-allowlist.txt && WM=$(node -e "console.log(require(\"./scripts/ratchet-registry.json\").find(m=>m.name===\"smoke_pool\").watermark)") && [ "$WM" -ge 14 ] && POOL=$(find scripts/smoke -type f -name "*.sh" | wc -l | tr -d " ") && [ "$POOL" -ge "$WM" ] && node scripts/ratchet-guard.mjs >/dev/null 2>&1'

## Invariant 覆盖（铁律逐条映射）

- INV-1 [Generator 重试身份] N/A：本 sprint 不改 generator 基础设施重试逻辑（仅新增 runtime_resources 注入），既有重试身份用例不受影响
- INV-2 [Fleet Generator Brain URL 权威] N/A：本 sprint 不触达 HARNESS_BRAIN_URL / BRAIN_URL 注入与预检路径
- INV-3 [Planner 分支锁定] N/A：本 sprint 不改 Planner workspace / 分支 checkout 逻辑
- [ ] [BEHAVIOR] [L2] INV-4 [smoke 铁律 + 不扩权] 新 smoke 失败必非零退出并打印失败边界名（禁静默假绿）；generator 仍无 push/PR/merge 授权、publisher 权限不变
  动作: 跑权威 smoke 并核查 dispatcher.js 未给 generator 授予远端发布权
  预期观察: smoke `PASS: B1`；dispatcher.js 无 generator push/PR/merge 授权字样
  等待预算: 0s
  留证: smoke stdout + grep 退出码
  Test: manual:bash -c 'bash packages/brain/scripts/smoke/generator-publisher-boundary-smoke.sh | grep -q "PASS: B1" && ! grep -Eq "pushurl.*generator|generator.*(push|pull request|merge)-authorized" packages/brain/src/orchestrator/dispatcher.js'
  Test: manual:bash -c 'bash packages/brain/scripts/smoke/generator-publisher-boundary-smoke.sh | grep -q "PASS: B1" && ! grep -Eq "pushurl.*generator|generator.*(push|pull request|merge)-authorized" packages/brain/src/orchestrator/dispatcher.js'
