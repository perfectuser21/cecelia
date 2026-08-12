---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Unified Work Router

**范围**: Recovery Addendum + Knife 0-5，不缩减原批准设计。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] Recovery、路由核心、receipt migration、全入口 inventory、Map preflight、动作闸、runner trust boundary、scratch smoke 与 Brain 版本/DEFINITION 均落在 PRD 允许文件中。
  Test: node -e "for(const p of ['packages/brain/src/work-router.js','packages/brain/src/work-routing-store.js','packages/brain/migrations/411_work_routing_receipts.sql','packages/brain/src/task-creation-inventory.js','packages/brain/src/orchestrator/preflight/map-impact-contract.js','packages/brain/scripts/smoke/unified-work-router-smoke.sh'])require('fs').accessSync(p)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: credential-bearing origin 不得误判 orphan且日志脱敏 [接缝×2]
  动作: 在真实临时 Git repo 依次使用带 userinfo 与无 userinfo 的等价 origin 调用 ensureHarnessWorktree
  预期观察: 工作区被复用，活跃 cwd 未删除，日志不存在 credential
  等待预算: 30s
  留证: Vitest verbose 输出与脱敏日志
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/harness-worktree*.test.js src/__tests__/startup-recovery-active-container-protect.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-02: 四种 change_kind 只正向映射到 Kernel profile
  动作: 对四个合法 change_kind 与 gear/stage 反推输入执行路由合同测试
  预期观察: 四个合法 profile 精确匹配，反向推导与降档全部拒绝
  等待预算: 30s
  留证: change-kind profiles 测试输出
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/work-router.test.js src/orchestrator/__tests__/change-kind-profiles.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-03: coding mutation 必须原子创建不可变 receipt [接缝×2]
  动作: 在 attempt 隔离 DB 中创建 coding task，并注入 receipt 写入失败、重复请求和 UPDATE/DELETE
  预期观察: task/receipt 同生同灭，重复请求幂等，历史 receipt 不可改写
  等待预算: 60s
  留证: integration 测试输出与本轮 DB 查询
  Test: manual:bash -c ': "${DB_URL:?}"; cd packages/brain && DATABASE_URL="$DB_URL" npx vitest run src/__tests__/migration-411-work-routing.test.js src/__tests__/integration/work-routing-store.integration.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-04: 所有可执行 coding 创建入口收敛到 Work Router
  动作: 扫描冻结 inventory 并执行 API/Intent/Capture/Planner/Proposal 入口合同
  预期观察: 每个入口有逐项合同，coding 统一为 harness_initiative，三项既有 schema 缺陷不复发
  等待预算: 60s
  留证: inventory 与 entrypoint 测试输出
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/task-creation-inventory.test.js src/__tests__/work-router-entrypoints.test.js src/routes/__tests__/capture-atoms-routing.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-05: Map/Impact Contract 启动门禁失败关闭 [接缝×2]
  动作: 用真实临时 repo 与测试 DB 依次构造 fresh、stale、missing、revision mismatch、scanner invalid 和 cross-repo
  预期观察: 仅 fresh 且与 receipt repo/baseline 一致的请求进入 Structure Gate，其他不创建 Provider attempt
  等待预算: 90s
  留证: preflight 测试输出与稳定 reason_code
  Test: manual:bash -c ': "${DB_URL:?}"; cd packages/brain && DATABASE_URL="$DB_URL" npx vitest run src/orchestrator/preflight/map-impact-contract.test.js src/orchestrator/__tests__/map-recovery-contract.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-06: 有头与无头 mutation 在动作前验证同一 receipt [接缝×2]
  动作: 在真实 worktree 运行 hook 非法矩阵，并让 Dispatcher claim 合法/非法任务
  预期观察: 非法 mutation exit 2 或拒绝 executor且写 route_violation；只读与合法 receipt 通过
  等待预算: 90s
  留证: shell test、Dispatcher Vitest 与 DB route_violation 查询
  Test: manual:bash -c 'bash packages/engine/tests/integration/dev-mode-routing-receipt-guard.test.sh && cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-routing-receipt.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-07: frozen baseline 是 lineage 祖先而不是完成态 HEAD
  动作: 检查最终 HEAD 与冻结 baseline 的祖先关系和 RED/GREEN commit 血统
  预期观察: merge-base 祖先检查通过且最终 HEAD 不等于 baseline；receipt/Map/Impact source_revision 仍等于 baseline
  等待预算: 10s
  留证: git SHA 与 scratch DB 查询输出
  Test: manual:bash -c 'BASELINE_SHA=22a62578f0aab77c58e1e0be25a6c321a78b35ad; git merge-base --is-ancestor "$BASELINE_SHA" HEAD && test "$(git rev-parse HEAD)" != "$BASELINE_SHA"'

- [ ] [BEHAVIOR] [L2] B-08: Generator trust boundary 在真实 runner 命令链生效 [接缝×2]
  动作: 启动 runner 合同测试，尝试 Provider push、读取 callback/lease 环境并检查 UID/capabilities/hook 路径
  预期观察: Provider push 失败、敏感环境不可见、非特权执行，受信 transport 仅 Judge 后发布
  等待预算: 120s
  留证: runner shell test 输出
  Test: manual:bash -c 'bash docker/cecelia-runner/__tests__/entrypoint-generator-trust-boundary.test.sh'

- [ ] [BEHAVIOR] [L2] B-09: scratch 多入口真实 Golden Path 完成 [接缝×2]
  动作: 在隔离 scratch DB 运行 API/Intent/Capture coding 与 content/research/review 对照，并制造 stale/resume
  预期观察: coding 3/3 有 receipt/Harness/Map/Impact；对照不误入；stale 阻断且刷新后保留审计恢复
  等待预算: 300s
  留证: smoke stdout 与带本轮时间窗的 DB 查询
  Test: manual:bash -c ': "${DB_URL:?}"; DATABASE_URL="$DB_URL" bash packages/brain/scripts/smoke/unified-work-router-smoke.sh'

- [ ] [BEHAVIOR] [L2] B-10: 必需 DevGate 与版本门禁全部通过
  动作: 依次运行 facts-check、version-sync、DoD mapping
  预期观察: 三条命令均 exit 0，Brain 版本与 DEFINITION 同步
  等待预算: 180s
  留证: 三条门禁完整输出
  Test: manual:bash -c 'node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs'

## Invariant 映射

- INV-1：禁止 main 直接提交/push；分支与 CI/merge fence 执行。
- INV-2：Brain 改动前后三项 DevGate 必须通过，见 B-10。
- INV-3：每项 bug/功能按计划保留 RED 后 GREEN commit，见 B-01 至 B-09 与 B-07 lineage。
- INV-4：凭据不得进入 Git 或日志，见 B-01/B-08。
- INV-5：真实 DB/真实 Git/真实 runner 接缝不得 mock，见禁 mock 边清单与 B-03/B-05/B-06/B-08/B-09。

