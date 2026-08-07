contract_branch: cp-08061936-harness-propose-r2-94ee0ec4
sprint_dir: sprints/08071002-relay-94ee0ec4

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 修复 never_started 假杀失败模式

**范围**: packages/brain 派发/liveness/watchdog 链根因实证与修复 + 回归测试永久入 CI + headed_manual 消费语义落地 + 决策/处置留痕。不做 D1 工程本体、不重构 watchdog 大架构、不改其他失败分类逻辑。
**大小**: M

## ARTIFACT 条目

- [x] [ARTIFACT] root-cause.md 存在且 a/b/c 三条各有证实/证伪结论 + b35bfa0c 处置节
  Test: node -e "const c=require('fs').readFileSync('sprints/08071002-relay-94ee0ec4/root-cause.md','utf8');if(!(c.includes('a)')&&c.includes('b)')&&c.includes('c)')&&/证实|证伪/.test(c)&&c.includes('b35bfa0c')))process.exit(1)"

- [x] [ARTIFACT] 回归测试毕业入 CI 测试族目录（describe/it 名与 expect 断言与合同 tests/ 逐字不变，仅允许改 import 相对路径与去除 TS 类型标注）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/integration/liveness-queued-never-spawned.integration.test.js','utf8');if(!(c.includes('不被打 watchdog_kill 且不置 failed')&&c.includes('task_events 表有留痕行')&&c.includes('仍分类 never_started')&&c.includes('仍判 process_disappeared')))process.exit(1)"

- [x] [ARTIFACT] 回归测试登记进 vitest.config.js POSTGRES_INTEGRATION_TESTS（CI brain-integration job 真 Postgres 跑，永久回归）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/vitest.config.js','utf8');if(!c.includes('liveness-queued-never-spawned.integration.test.js'))process.exit(1)"

- [x] [ARTIFACT] executor/liveness 契约文档同步 headed_manual 语义与零留痕堵死规则
  Test: node -e "const c=require('fs').readFileSync('docs/architecture/2026-07-10-executor-liveness-contract/architecture.md','utf8');if(!c.includes('headed_manual'))process.exit(1)"

## BEHAVIOR 条目

> 场景类映射（本 sprint 无 HTTP Response Schema，四类标准场景按调度域对应）：
> 核心行为=条 1/2，副作用留痕=条 3/5，负向反例（error path / 防修过头）=条 4，出口门禁=条 6。

- [x] [BEHAVIOR] 事故形态重放（queued、无进程、无日志、headed_manual=true）跨两次真实 tick 后不被判 never_started、不被置 failed、无 watchdog_kill payload、不被无头派发翻 in_progress/dispatched
  Test: manual:bash -c 'bash sprints/08071002-relay-94ee0ec4/tests/replay-incident.sh'
  期望: exit 0，输出 REPLAY-PASS

- [x] [BEHAVIOR] 新增回归测试修复后 Green（headed_manual 零留痕任务不被假杀 + watchdog 处置留痕 + 两条护栏，共 4 条 it 全过，真 Postgres 零 mock）
  Test: manual:bash -c 'bash -c "cd packages/brain && npx vitest run --config vitest.integration.config.js src/__tests__/integration/liveness-queued-never-spawned.integration.test.js --reporter=verbose"'
  期望: exit 0，0 failed

- [x] [BEHAVIOR] watchdog 处置留痕：非 headed 未 spawn 任务被 watchdog 处置后 task_events 表落行（5 分钟时间窗防历史数据冒充，现状 0 行为 Red 起点）
  Test: manual:bash -c 'bash -c "cd packages/brain && npx vitest run --config vitest.integration.config.js src/__tests__/integration/liveness-queued-never-spawned.integration.test.js -t 留痕行 --reporter=verbose"'
  期望: exit 0，命中 ≥1 条测试且全过

- [x] [BEHAVIOR] 防修过头反例：既有 1dfa40f7 测试族全 Green——真实 spawn 后进程立死仍判 process_disappeared、带派发失败回执的从未启动任务仍分类 never_started、error_message/failure_class 不被覆盖（铁律 56a0ba9f）
  Test: manual:bash -c 'bash -c "cd packages/brain && npx vitest run --config vitest.integration.config.js src/__tests__/integration/liveness-never-started.integration.test.js --reporter=verbose"'
  期望: exit 0，0 failed

- [x] [BEHAVIOR] headed_manual 语义拍板写 decisions 表留痕（14 天时间窗；本条为该 psql 断言唯一文本源 SSOT，draft Step 5 与 E2E 第 3 段 SQL 逐字复制自此，改动只许改本条再同步）
  Test: manual:bash -c 'psql "${DB_URL:-postgresql://localhost/cecelia}" -t -A -c "SELECT count(*) FROM decisions WHERE (topic ILIKE '"'"'%headed_manual%'"'"' OR decision ILIKE '"'"'%headed_manual%'"'"' OR reason ILIKE '"'"'%headed_manual%'"'"') AND created_at > NOW() - interval '"'"'14 days'"'"'" | grep -qE "^[1-9][0-9]*$"'
  期望: exit 0（count ≥ 1）

- [x] [BEHAVIOR] DevGate 三件套通过（Brain 改动强制门禁）
  Test: manual:bash -c 'node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs'
  期望: exit 0

## Invariant 覆盖条目（铁律清单逐条映射 — Step 1.3）

- [x] [BEHAVIOR] INV-1 [never_started兜底 56a0ba9f] watchdog 对从未启动进程走 never_started 分类兜底且不覆盖已有 error_message/failure_class
  Test: manual:bash -c 'bash -c "cd packages/brain && npx vitest run --config vitest.integration.config.js src/__tests__/integration/liveness-never-started.integration.test.js -t 记账覆盖 --reporter=verbose"'
  期望: exit 0（既有 it「…不被 watchdog 记账覆盖」保持 Green）
- [headed点火写worktree 17722a93] N/A：本 sprint 只落地「headed_manual 不进无头派发/不被假杀」的等待语义，不实现 headed 前台点火本体；如 generator 实证根因后需实现点火路径，则该铁律自动生效并须补断言。
- [urgent建单查重 81294701] N/A：本 sprint 不触及 capture_atoms urgent 路由建单代码。
- [x] [BEHAVIOR] INV-2 [失败分支显式 e9c7752f] spawn/处置失败路径必须显式留痕，不许静默（对应 task_events 留痕断言，同 BEHAVIOR 条 3）
  Test: manual:bash -c 'bash -c "cd packages/brain && npx vitest run --config vitest.integration.config.js src/__tests__/integration/liveness-queued-never-spawned.integration.test.js -t 留痕行 --reporter=verbose"'
  期望: exit 0
- [x] [BEHAVIOR] INV-3 [headed场景核对 9f14c074] headed_manual 人工接管任务不被无头链路（自动派发/liveness 假杀）处置
  Test: manual:bash -c 'bash -c "cd packages/brain && npx vitest run --config vitest.integration.config.js src/__tests__/integration/liveness-queued-never-spawned.integration.test.js -t 不被打 --reporter=verbose"'
  期望: exit 0（it「…不被打 watchdog_kill 且不置 failed」Green）
