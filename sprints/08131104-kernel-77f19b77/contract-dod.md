---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Harness 入口统一（Session Controller 所有权不变量 + 四档 change_kind 驱动 Profile）

**范围**: initiative_runs schema（migration 413：controller_session_id + controller_lease_expires_at）；harness-skill-relay 启动链收敛（Dispatcher→Controller→Kernel）；createKernelRun fail-closed；derive.js 按 change_kind 分派 Profile；change-kind.js 头注释同步；Controller/Kernel 生命周期守护 + 恢复；永久回归测试进 CI（POSTGRES_INTEGRATION_TESTS 登记）。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 413 存在且加 controller_session_id + controller_lease_expires_at 到 initiative_runs（幂等 ADD COLUMN IF NOT EXISTS + schema_version 写 413）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/413_initiative_run_controller_ownership.sql','utf8');if(!/ALTER TABLE\s+initiative_runs[\s\S]*controller_session_id/i.test(c)||!/controller_lease_expires_at/i.test(c)||!/schema_version[\s\S]*413/i.test(c))process.exit(1)"

- [ ] [ARTIFACT] migration 413 rollback 存在（回滚 DROP COLUMN 两列）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/rollback/413_initiative_run_controller_ownership.down.sql','utf8');if(!/DROP COLUMN[\s\S]*controller_session_id/i.test(c)||!/controller_lease_expires_at/i.test(c))process.exit(1)"

- [ ] [ARTIFACT] selfcheck EXPECTED_SCHEMA_VERSION 升到 413（DevGate facts 同步）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/selfcheck.js','utf8');if(!/EXPECTED_SCHEMA_VERSION\s*=\s*'413'/.test(c))process.exit(1)"

- [ ] [ARTIFACT] change-kind.js 头注释同步四档正向默认映射 + 决策 29ae54ae + 禁反向推导降档
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/change-kind.js','utf8');if(!/29ae54ae/.test(c)||!/禁.*反向|反向.*推导|禁反向/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 三个新回归测试文件登记进 vitest.config.js 的 POSTGRES_INTEGRATION_TESTS（两个 .pg.integration.test.js 永久进 brain-integration CI）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/vitest.config.js','utf8');if(!/kernel-controller-ownership\.pg\.integration\.test\.js/.test(c)||!/kernel-controller-lifecycle\.pg\.integration\.test\.js/.test(c))process.exit(1)"

## BEHAVIOR 条目（五行剧本 — 内嵌可执行 manual:bash -c 单行命令）

- [ ] [BEHAVIOR] [L2] B-01: 四档 change_kind 驱动 derive 执行 Profile（bugfix/parameter_only 跳 planning）
  动作: 以初始态 observed（prdExists=false、contract 未批）分别注入 change_kind=bugfix / parameter_only / new_capability / capability_change 调 derive()
  预期观察: bugfix、parameter_only 返回 phase='generate'（跳 Planner/GAN）；new_capability 返回 phase='planning'（全链）；capability_change 保留 planning/gan（轻 Planner + 合同收敛）
  等待预算: 0s（纯函数同步）
  留证: vitest basic reporter 输出末 10 行（含四档断言 pass），存 ${SPRINT_DIR}/screenshots/ 不适用（无 UI，留 stdout）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/kernel-change-kind-profile.test.js --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-02: createKernelRun 无 Controller identity → fail-closed（真 PG，拒绝创建不写半态）[接缝×2]
  动作: 真 Postgres 隔离库真跑 migrate（含 413），调 createKernelRun 传入缺失/空 controllerSessionId
  预期观察: createKernelRun 抛错（fail-closed）；initiative_runs 对该 task 无新行（count 不增长）
  等待预算: 30s（含建库/migrate）
  留证: vitest basic reporter 输出（含抛错断言 + 真 PG count=0 断言）
  Test: manual:bash -c 'cd packages/brain && npx vitest run --config vitest.integration.config.js src/__tests__/integration/kernel-controller-ownership.pg.integration.test.js -t "createKernelRun 无 controllerSessionId fail-closed" --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-03: migration 413 真跑后 initiative_runs 有 controller_session_id + controller_lease_expires_at 列（真 PG information_schema）
  动作: 真 Postgres 隔离库真跑 src/migrate.js 至 413，查 information_schema.columns
  预期观察: initiative_runs 存在 controller_session_id 与 controller_lease_expires_at 两列
  等待预算: 30s
  留证: vitest 输出（含 information_schema 列存在断言）
  Test: manual:bash -c 'cd packages/brain && npx vitest run --config vitest.integration.config.js src/__tests__/integration/kernel-controller-ownership.pg.integration.test.js -t "migration 413 加 controller ownership 列" --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-04: 启动链收敛 — harness_runtime=kernel-v1 直打经 relay 不产生无 Controller run [接缝×2]
  动作: 真 relay 启动链（真 createKernelRun 真 PG，只替身最外层 launcher），POST 形态 payload.harness_runtime=kernel-v1 走 spawn 路径
  预期观察: Controller ownership（controller_session_id）先于 Kernel run 可执行态写入；不存在 controller_session_id IS NULL 的活跃 Kernel run
  等待预算: 30s
  留证: vitest 输出（含 ownership 先于 run 的顺序断言 + 无主 run count=0）
  Test: manual:bash -c 'cd packages/brain && npx vitest run --config vitest.integration.config.js src/__tests__/integration/kernel-controller-ownership.pg.integration.test.js -t "harness_runtime=kernel-v1 直打不产生无 Controller run" --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-05: Kernel fatal 只结束 Kernel process，Controller 存活并回传结构化 failure_reason [接缝×2]
  动作: 真 PG 建 run 取 ownership 后，模拟 Kernel 受管进程 fatal（替身 launcher 返回 fatal，非 mock ownership 边）
  预期观察: Controller 记录存活；initiative_runs.failure_reason 写结构化码（非空、脱敏，无凭据泄漏）
  等待预算: 30s
  留证: vitest 输出（含 Controller 存活断言 + failure_reason 结构化断言）
  Test: manual:bash -c 'cd packages/brain && npx vitest run --config vitest.integration.config.js src/__tests__/integration/kernel-controller-lifecycle.pg.integration.test.js -t "Kernel fatal 只结束 Kernel Controller 存活" --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-06: Controller fatal（lease 过期）后 Kernel 不成为无主 run，无主历史 run fail-closed 进恢复 [接缝×2]
  动作: 真 PG 造 controller_lease_expires_at 过期且无存活 controller 的 run（含迁移前无 controller_session_id 的历史 run）
  预期观察: 无主判定成立，进入恢复流程；不存在无主 run 静默停留在 done
  等待预算: 30s
  留证: vitest 输出（含无主判定 + 恢复流程触发断言 + 无静默 done 断言）
  Test: manual:bash -c 'cd packages/brain && npx vitest run --config vitest.integration.config.js src/__tests__/integration/kernel-controller-lifecycle.pg.integration.test.js -t "Controller fatal Kernel 不无主 无主历史 fail-closed" --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-07: 四档全部保留 Generate→Evaluate→Judge 与 merge fence（回归：gear default/hotfix 逐字节不变）
  动作: 真 derive 对四档 change_kind × gear 组合逐一 walk 相位链，断言均经 evaluate + judge 相位且不越 merge fence
  预期观察: 四档 change_kind 无一跳过 evaluate/judge；现有 gear=default 首角色 planner、gear=hotfix 首角色 generator 行为不回退
  等待预算: 0s（纯函数）
  留证: vitest 输出（含四档 × G/E/J 保留断言 + gear 零回归断言）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/kernel-change-kind-profile.test.js -t "四档全部保留 Generate Evaluate Judge 与 merge fence" --reporter=basic'

## Invariant 覆盖（铁律 → INV-N 逐条映射，来源 PRD Invariant 段）

- [ ] [BEHAVIOR] [L2] INV-1 [真环境done]+[禁mock被改边]: 被改的边（createKernelRun↔initiative_runs、relay 启动链、derive 状态机）在真 PG / 真代码路径验证，测试不 mock 被改的边
  动作: 运行两个 .pg.integration 测试文件，确认其真连 PG（DB_DEFAULTS 建隔离库真 migrate），无 vi.mock 顶替被改的边
  预期观察: 两个集成测试真跑真 PG 通过；测试源码不含对 createKernelRun/pool/derive 的 mock
  等待预算: 60s
  留证: vitest 输出 + grep 源码无被改边 mock 的结果进 log_tail
  Test: manual:bash -c 'cd packages/brain && ! grep -nE "vi\.mock\(.*(kernel-run-store|derive|ground-truth)" src/__tests__/integration/kernel-controller-ownership.pg.integration.test.js src/__tests__/integration/kernel-controller-lifecycle.pg.integration.test.js && npx vitest run --config vitest.integration.config.js src/__tests__/integration/kernel-controller-ownership.pg.integration.test.js --reporter=basic'

- [ ] [BEHAVIOR] [L2] INV-2 [日志脱敏]+[凭据安全]: Kernel/Controller fatal 的 failure_reason 与 Brain log 结构化且脱敏，不落 controller_session_id 以外凭据
  动作: 触发 Kernel fatal，检查回传 failure_reason 为结构化码，不含 token/credential 明文
  预期观察: failure_reason 为结构化字符串（如 kernel_process_fatal:<code>），无凭据泄漏
  等待预算: 30s
  留证: vitest 输出（含脱敏断言）
  Test: manual:bash -c 'cd packages/brain && npx vitest run --config vitest.integration.config.js src/__tests__/integration/kernel-controller-lifecycle.pg.integration.test.js -t "failure_reason 结构化脱敏" --reporter=basic'

- [ ] [BEHAVIOR] [L2] INV-3 [evaluator时钟]: Kernel 复用既有 PR 时采纳 evaluator validation clock（Controller 守护不改 validation identity 归属，late-bound）
  动作: 真 derive 走复用既有 PR 分支，断言 validation clock 归属未因 Controller 守护改变（沿用 hasNewerEvaluatePassThanJudge 现有语义）
  预期观察: 复用 PR 时 validation clock 归 evaluator，Controller 生命周期改动不篡改
  等待预算: 0s
  留证: vitest 输出（含 validation clock 归属断言）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/kernel-change-kind-profile.test.js -t "evaluator validation clock 归属不变" --reporter=basic'

### 铁律 N/A 显式声明（本 sprint 不触及）

- [单slot串行] N/A：本 sprint 不改并发/slot 模型（dispatcher 全局 harness_initiative 并发上限按 task 数计数，与 change_kind/Controller 值无关，见 dispatcher.js:54-69），无回归风险。
- [多租户] N/A：initiative_runs 编排态无 tenant 维度，本 sprint 纯 Brain 内部编排，无租户数据面。
- [端点鉴权] N/A：本 sprint 无新增对外 HTTP 端点（Dispatcher→Controller 为内部 spawn 路径）。
- [租户隔离] N/A：同 [多租户]，无跨租户数据面。

## E2E 验收（final-e2e 跑，local_api）

见 contract-draft.md `## E2E 验收` 段的完整 bash 脚本（evaluator 模式 B 按 target_environment=local_api 提取执行）。核心：curl 现有 Brain liveness + 纯 derive 四档 Profile + 两个真 PG 集成（ownership/fail-closed/migration 413 + 生命周期隔离）。

## 未覆盖真实链路清单

（本合同无第三方 API mock 豁免；被改的边全部真 PG / 真代码路径验证，只替身最外层 launcher/进程 spawn/worktree/账号解析等与「先取 ownership 再拉 Kernel」这条被改边无关的外层依赖 —— 属禁 mock 边清单允许的外层，非真实链路缺口。真机段 N/A（无微信/Android/真机）。）
