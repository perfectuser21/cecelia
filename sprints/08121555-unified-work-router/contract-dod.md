---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Unified Work Router

**范围**: RECOVERY ADDENDUM + Knife 0-5；不重写 Harness 状态机。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] Work Router、receipt store/API、migration、Map preflight、smoke 与永久测试存在且内容可执行
  Test: node -e "for(const p of ['packages/brain/src/work-router.js','packages/brain/src/work-routing-store.js','packages/brain/src/routes/work-routing.js','packages/brain/migrations/411_work_routing_receipts.sql','packages/brain/scripts/smoke/unified-work-router-smoke.sh'])require('fs').accessSync(p)"

- [ ] [ARTIFACT] Brain patch version、DEFINITION 与版本 SSOT 同步
  Test: bash scripts/check-version-sync.sh

## Invariant 映射

- INV-1 validation_clock_required：N/A，本 Sprint 不修改 validation clock；既有 DevGate/CI 必须保持绿。
- INV-2 `.harness/progress.md` 不进 git：由 B-08 的 `git diff --check` 与 smoke 的 tracked-file 反向断言覆盖。
- INV-3 headed worktree_path 受控：由 B-05 真临时 worktree/lock 验证覆盖。
- INV-4 单写手：N/A，task-plan 固定单 ws1，执行中不得并行实现者。
- INV-5 环境事实不写死：由 B-04/B-05 从 receipt、Map、Git HEAD 动态推导覆盖。
- INV-6 真实接缝才 done：由 B-06/B-07 真 DB、临时 Git repo 与 runner 容器覆盖。
- INV-7 secrets 不硬编码/不进 git/log：由 B-01/B-06 覆盖。
- INV-8 PII/敏感日志脱敏：由 B-01 覆盖。
- INV-9 API 鉴权：由 B-05 验证 validation API 无认证被拒、受认证请求成功。
- INV-10 租户隔离：N/A，receipt 为内部 task/repo 事实且无租户业务数据；禁止引入 tenant 旁路。

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 含凭据 origin 等价且日志脱敏、活跃 Kernel cwd 不被删除 [接缝×2]
  动作: 在临时 Git repo 建立带 URL userinfo 的 origin，登记活跃 detached Kernel workspace 后运行 worktree reconcile 两次
  预期观察: 两次均复用工作区，日志不含测试凭据，目录仍存在
  等待预算: 10s
  留证: Vitest 输出与临时目录状态
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/harness-worktree-origin-safety.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-02: 四档 change_kind 只正向映射并拒绝降档
  动作: 对四个合法 change_kind、缺失 change_kind、gear/stage/task_type 反推和降档 override 运行路由合同
  预期观察: 四个合法输入得到唯一 profile，非法输入返回稳定 reason_code
  等待预算: 5s
  留证: Vitest 每个 case 的结果
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/work-router.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-03: task 与 append-only Routing Receipt 在真实 PostgreSQL 原子创建并可追加后继 [接缝×2]
  动作: 对 attempt-scoped DB 执行 migration，再并发提交相同 source key、制造 receipt 写入失败，并对同一 task 新增 superseding receipt
  预期观察: 成功路径只有一个当前 task/receipt，失败路径无半条记录，UPDATE/DELETE 被拒；同 task 两个 receipt 构成无环历史链且 current 恰为一个
  等待预算: 30s
  留证: integration test 输出与带五分钟时间窗的 DB 查询
  Test: manual:bash -c ': "${DB_URL:?}"; cd packages/brain && DB_URL="$DB_URL" npx vitest run src/__tests__/integration/work-routing-store.integration.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-04: Map/Impact preflight 在 Provider 前 fail closed [接缝×2]
  动作: 用真实测试 DB 与临时 Git repo 依次提供 fresh、missing、stale、revision mismatch、invalid scanner、cross-repo 与 map_recovery 输入
  预期观察: 仅 fresh 或合法单次 recovery 进入后续阶段；其余均稳定 reason_code 且 Provider attempt 为零
  等待预算: 30s
  留证: 测试输出、Map revision 与 attempt 计数
  Test: manual:bash -c ': "${DB_URL:?}"; cd packages/brain && DB_URL="$DB_URL" npx vitest run src/orchestrator/preflight/map-impact-contract.test.js src/orchestrator/__tests__/map-recovery-contract.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-05: 有头与无头写动作在执行前验证同一 receipt [接缝×2]
  动作: 在真实临时 worktree 对无 session/lock、字段缺失、receipt 失效、API 不可达、repo/branch/HEAD 不匹配及合法输入运行 hook 与 Dispatcher
  预期观察: 非法 mutation 全部 exit 2/拒绝并记录 route_violation，合法输入通过，只读诊断不误伤
  等待预算: 30s
  留证: shell test 与 Dispatcher Vitest 输出
  Test: manual:bash -c 'bash packages/engine/tests/integration/dev-mode-routing-receipt-guard.test.sh && cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-routing-receipt.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-06: Generator trust boundary 在真实 runner 容器命令链生效
  动作: 启动 Generator 容器，检查非特权身份、真实 hook、blocked pushurl 与环境，再由受信任 transport 模拟 Judge 后发布
  预期观察: Provider push 失败且 callback/lease secrets 不可见，lineage assertion 生效；仅 trusted transport 发布成功
  等待预算: 120s
  留证: 容器 ID、uid/capability、push 退出码、环境键计数与 transport receipt
  Test: manual:bash -c 'bash docker/cecelia-runner/__tests__/entrypoint-generator-trust-boundary.test.sh'

- [ ] [BEHAVIOR] [L2] B-07: scratch 多入口产生完整真实审计链 [接缝×2]
  动作: 从 API/Intent/Capture 创建三项 coding 及 content/research/read-only 对照，制造 stale 后刷新并 resume
  预期观察: coding 均有 receipt/Harness/正确 repo Map/required Impact Contract；对照不误路由；stale 阻断且失败审计保留
  等待预算: 180s
  留证: smoke stdout、DB 查询与临时 repo revision
  Test: manual:bash -c ': "${DB_URL:?}"; DB_URL="$DB_URL" bash packages/brain/scripts/smoke/unified-work-router-smoke.sh | tee /tmp/unified-work-router-smoke.log; grep -q SCRATCH_ACCEPTANCE_OK /tmp/unified-work-router-smoke.log'

- [ ] [BEHAVIOR] [L2] B-08: DevGate、版本、diff 与规定 smoke 全绿
  动作: 顺序执行三项 Brain DevGate、scratch smoke 和 diff 检查
  预期观察: 所有命令 exit 0，版本定义同步且无 diff whitespace 错误
  等待预算: 300s
  留证: 五条命令退出码与输出末尾
  Test: manual:bash -c 'node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs && DB_URL="$DB_URL" bash packages/brain/scripts/smoke/unified-work-router-smoke.sh && git diff --check'

- [ ] [BEHAVIOR] [L2] B-09: 旧任务 dry-run/apply、running audit 与可观测性完整 [接缝×2]
  动作: 在 scratch DB 放入 queued/blocked/paused/running 旧 coding 与非 coding 对照，先 dry-run 再 apply，并查询事件、指标和 Dashboard API
  预期观察: dry-run 不写库；未开始 coding 保留 task id/payload 并追加 receipt；running attempt 不改执行模型只新增 audit；六类事件和核心指标可见
  等待预算: 60s
  留证: dry-run JSON、迁移前后 DB checksum、receipt 链、legacy_execution_audit、事件指标与 Dashboard 测试输出
  Test: manual:bash -c ': "${DB_URL:?}"; cd packages/brain && DB_URL="$DB_URL" npx vitest run src/__tests__/work-routing-migration-observability.integration.test.js --reporter=verbose && cd ../.. && npx vitest run apps/dashboard/src/pages/warroom/WarRoomPage.test.tsx --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-10: RECOVERY 与 Knife 0-5 均证明 RED commit 早于 GREEN commit
  动作: 读取版本化 TDD ledger，对七项逐一 checkout 对应 RED/GREEN tree 并运行同一锁定测试
  预期观察: 每个 RED SHA 是 GREEN SHA 祖先且不同，RED tree 测试非零、GREEN tree 测试为零，不接受仅凭 commit message 判定
  等待预算: 300s
  留证: 每项 red_sha/green_sha、merge-base 结果与两次测试退出码
  Test: manual:bash -c 'bash packages/brain/scripts/verify/unified-work-router-tdd-history.sh'
