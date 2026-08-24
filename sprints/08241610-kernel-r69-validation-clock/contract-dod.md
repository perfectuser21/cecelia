---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: kernel validation clock 按 fix 轮有界顺延 [r69]

**范围**: 仅修改纯函数 `packages/brain/src/orchestrator/validation-clock.js` 的 `resolveValidationClock` 顺延与有界逻辑 + `sprints/08241610-kernel-r69-validation-clock/tests/` 冻结回归测试。不改 `timeout_seconds` 默认值、不动人审 deadline、不做真库 loop E2E。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `validation-clock.js` 含有界顺延逻辑（`spawn:generator-fix` 顺延 + 上限常量 6）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/validation-clock.js','utf8');if(!/generator-fix/.test(c)||!/6/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 冻结测试文件存在于 sprint 目录且真 import 被改模块（禁 mock 被改的边）
  Test: node -e "const c=require('fs').readFileSync('sprints/08241610-kernel-r69-validation-clock/tests/step3-validation-clock-fix-extend.test.js','utf8');if(!c.includes('validation-clock.js'))process.exit(1);if(/vi\.mock\(/.test(c))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，journey_type=autonomous / 纯函数真 import）

- [ ] [BEHAVIOR] [L2] B-01: 冻结测试 6 用例全绿（r50 复刻存活 + 边界全覆盖）
  动作: 从仓库根真 import 真 `resolveValidationClock` 跑冻结测试 `sprints/08241610-kernel-r69-validation-clock/tests/step3-validation-clock-fix-extend.test.js`
  预期观察: vitest 输出 `6 passed`、无 `failed`；r50 复刻用例断言 deadline 前移到第 3 个 fix 而存活
  等待预算: 0s
  留证: /tmp/frozen.log（vitest 末 8 行含 6 passed）
  Test: manual:bash -c 'npx vitest run sprints/08241610-kernel-r69-validation-clock/tests/step3-validation-clock-fix-extend.test.js --no-cache 2>&1 | tee /tmp/frozen.log | grep -qE "6 passed" && ! grep -qE "[1-9][0-9]* failed" /tmp/frozen.log'

- [ ] [BEHAVIOR] [L2] B-02: 0 fix 轮语义不变（负向回归，锚首个 generator）
  动作: 传仅含首个 `spawn:generator` 的 decision-log，解析 `spawn:judge` clock
  预期观察: `pipeline_started_at=2026-08-03T12:00:00.000Z`、`deadline_at=2026-08-03T13:30:00.000Z`（5400s，与今日逐字节一致）
  等待预算: 0s
  留证: stdout `OK 0-fix`
  Test: manual:bash -c "node -e 'import(\"./packages/brain/src/orchestrator/validation-clock.js\").then(m=>{const c=m.resolveValidationClock({action:\"spawn:judge\",decisionLog:[{hop:10,action:\"spawn:generator\",created_at:\"2026-08-03T12:00:00.000Z\",detail:{pipeline_started_at:\"2026-08-03T12:00:00.000Z\",deadline_at:\"2026-08-03T13:30:00.000Z\"}}],intentAt:\"2026-08-03T13:00:00.000Z\",timeoutSeconds:5400});if(c.pipeline_started_at!==\"2026-08-03T12:00:00.000Z\"||c.deadline_at!==\"2026-08-03T13:30:00.000Z\")process.exit(1);console.log(\"OK 0-fix\")})'"

- [ ] [BEHAVIOR] [L2] B-03: r50 复刻——3 个 generator-fix 后 deadline 前移存活
  动作: 传首个 generator + 3 个 `spawn:generator-fix`（每轮相隔 1h）的 decision-log，解析 `spawn:judge` clock
  预期观察: `pipeline_started_at` 锚在第 3 个 fix（15:00），`deadline_at`（16:30）> r50 现场 now(14:00)——旧逻辑锚 12:00 死线 13:30 已判死
  等待预算: 0s
  留证: stdout `OK r50-survive`
  Test: manual:bash -c "node -e 'import(\"./packages/brain/src/orchestrator/validation-clock.js\").then(m=>{const g=(h,a)=>({hop:h,action:\"spawn:generator\",created_at:a,detail:{pipeline_started_at:a,deadline_at:new Date(new Date(a).getTime()+5400000).toISOString()}});const f=(h,a)=>({...g(h,a),action:\"spawn:generator-fix\"});const log=[g(10,\"2026-08-03T12:00:00.000Z\"),f(11,\"2026-08-03T13:00:00.000Z\"),f(12,\"2026-08-03T14:00:00.000Z\"),f(13,\"2026-08-03T15:00:00.000Z\")];const c=m.resolveValidationClock({action:\"spawn:judge\",decisionLog:log,intentAt:\"2026-08-03T15:00:00.000Z\",timeoutSeconds:5400});if(c.pipeline_started_at!==\"2026-08-03T15:00:00.000Z\")process.exit(1);if(new Date(c.deadline_at)<=new Date(\"2026-08-03T14:00:00.000Z\"))process.exit(1);console.log(\"OK r50-survive\")})'"

- [ ] [BEHAVIOR] [L2] B-04: 顺延有界 6 次——7+ fix 轮锚停第 6 个 fix（超限判死）
  动作: 传首个 generator + 7 个 `spawn:generator-fix` 的 decision-log，解析 `spawn:judge` clock
  预期观察: `pipeline_started_at` 停在第 6 个 fix（18:00），绝不前移到第 7 个（19:00）→ deadline(19:30) 定格，超界后 deadlineExceeded 照常判死
  等待预算: 0s
  留证: stdout `OK bounded6`
  Test: manual:bash -c "node -e 'import(\"./packages/brain/src/orchestrator/validation-clock.js\").then(m=>{const g=(h,a)=>({hop:h,action:\"spawn:generator\",created_at:a,detail:{pipeline_started_at:a,deadline_at:new Date(new Date(a).getTime()+5400000).toISOString()}});const f=(h,a)=>({...g(h,a),action:\"spawn:generator-fix\"});const base=new Date(\"2026-08-03T12:00:00.000Z\").getTime();const log=[g(10,\"2026-08-03T12:00:00.000Z\")];for(let n=1;n<=7;n++)log.push(f(10+n,new Date(base+n*3600000).toISOString()));const c=m.resolveValidationClock({action:\"spawn:judge\",decisionLog:log,intentAt:\"2026-08-03T19:00:00.000Z\",timeoutSeconds:5400});if(c.pipeline_started_at!==\"2026-08-03T18:00:00.000Z\")process.exit(1);if(c.pipeline_started_at===\"2026-08-03T19:00:00.000Z\")process.exit(1);console.log(\"OK bounded6\")})'"

- [ ] [BEHAVIOR] [L2] B-05 (INV-1): 既有 repo 回归 11/11 不退 + verified_existing_pr 采纳规则不破坏
  动作: 用 packages/brain 自身 vitest 配置（子 shell 切包根）跑既有 `__tests__/validation-clock.test.js`
  预期观察: `11 passed`、无 `failed`（含 verified existing-PR evaluator origin 采纳与复用两用例）
  等待预算: 0s
  留证: /tmp/repo.log（末 8 行含 11 passed）
  Test: manual:bash -c 'cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/validation-clock.test.js 2>&1 | tee /tmp/repo.log | grep -qE "11 passed" && ! grep -qE "[1-9][0-9]* failed" /tmp/repo.log'

- [ ] [BEHAVIOR] [L2] B-06: 合同外路径零写入（r68 死因守卫）
  动作: 检查本 attempt 变更文件集合，比对合同 claim 白名单
  预期观察: 无 `tests/regression/` 新增；所有变更文件 ∈ {validation-clock.js, sprints/本目录/*（含冻结测试）}
  等待预算: 0s
  留证: stdout `OK`（越权时打印 FAIL-offcontract + 文件名）
  Test: manual:bash -c 'CH=$(git diff --name-only origin/main...HEAD 2>/dev/null || git diff --name-only HEAD~1 HEAD); if echo "$CH" | grep -qE "^tests/regression/"; then echo FAIL-regression; exit 1; fi; OFF=$(echo "$CH" | grep -vE "^(packages/brain/src/orchestrator/validation-clock[.]js|sprints/08241610-kernel-r69-validation-clock/)" || true); if [ -n "$OFF" ]; then echo "FAIL-offcontract $OFF"; exit 1; fi; echo OK'

### INV 覆盖（历史约束三源）

- INV-2 [vitest include 范围]：冻结测试落 `sprints/08241610-kernel-r69-validation-clock/tests/`（根 vitest.config.js include 明列 `sprints/**`），实跑非空匹配、红态 exit≠0 — 由 B-01 覆盖（已实证改前 3 failed / 改后 6 passed，exit code 如实反映）
- INV-3 [generator 重试身份] `generator_infrastructure_retry_identity`：**N/A** — 本 sprint 纯函数 deadline 计算，不触及 attempt/retry 身份
- INV-4 [planner 分支] 使用服务端 PLANNER_BRANCH 禁自行 checkout：**N/A（proposer/generator 侧遵守）** — 本 sprint 代码路径不涉分支 checkout
