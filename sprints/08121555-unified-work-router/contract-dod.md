---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Unified Work Router

**范围**: Recovery 前置 + Knife 0-5；不重写 Harness 状态机，不新增第五种 change_kind。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] Work Router、routing store/API、migration 411、入口 inventory 与 scratch smoke 存在且实现 PRD 字面合同
  Test: node -e "for(const p of ['packages/brain/src/work-router.js','packages/brain/src/work-routing-store.js','packages/brain/src/routes/work-routing.js','packages/brain/migrations/411_work_routing_receipts.sql','packages/brain/src/task-creation-inventory.js','packages/brain/scripts/smoke/unified-work-router-smoke.sh'])require('fs').accessSync(p)"
- [ ] [ARTIFACT] Brain 版本与 DEFINITION 同步更新，Recovery 与 Knife RED/GREEN commits 永久保留
  Test: bash scripts/check-version-sync.sh

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-00: credential origin 归一化、脱敏并保护活跃 Kernel cwd [接缝×2]
  动作: 在真实临时 Git repo 建立带 credential 的同仓 origin，并把 detached cwd 标为活跃 run 后调用 worktree ensure/cleanup
  预期观察: worktree 被复用、活跃 cwd 未删除，所有日志均不含 credential
  等待预算: 15s
  留证: Vitest 输出与脱敏日志
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/harness-worktree-recovery-contract.test.js'

- [ ] [BEHAVIOR] [L2] B-01: 三个真实入口原子创建 Harness task 与不可变 receipt [接缝×2]
  动作: 对 attempt 隔离 DB 运行 migration 后，从 API、Intent、Capture 各提交一个 coding mutation
  预期观察: 三个 task 均为 harness_initiative，receipt 逐项存在且 UPDATE/DELETE 被拒绝
  等待预算: 30s
  留证: 测试输出与 DB 查询结果
  Test: manual:bash -c 'cd packages/brain && DB_URL="$DB_URL" npx vitest run src/__tests__/work-routing-entry.test.js src/__tests__/integration/work-routing-store.integration.test.js src/__tests__/work-router-entrypoints.test.js'

- [ ] [BEHAVIOR] [L2] B-02: 四种 change_kind 仅正向选择默认 profile
  动作: 分别提交 new_capability、capability_change、bugfix、parameter_only，并尝试 gear/stage/task_type 反推与降档
  预期观察: 四个合法输入命中批准 profile；反推、第五种形式和降档全部稳定拒绝
  等待预算: 10s
  留证: Vitest 四档矩阵输出
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/work-router.test.js src/orchestrator/__tests__/change-kind-profiles.test.js'

- [ ] [BEHAVIOR] [L2] B-03: fresh Map 建立 required Impact Contract，stale Map fail closed [接缝×2]
  动作: 对真实临时 repo 与测试 DB 依次提供 fresh、stale、missing、错误 revision/scanner Map，再请求 coding run
  预期观察: 仅 fresh 在 Provider 前建立 active Impact Contract；其余不创建 Provider attempt 且返回稳定 reason_code
  等待预算: 30s
  留证: preflight 测试输出与 DB contract 查询
  Test: manual:bash -c 'cd packages/brain && DB_URL="$DB_URL" npx vitest run src/orchestrator/preflight/map-impact-contract.test.js src/orchestrator/__tests__/map-recovery-contract.test.js'

- [ ] [BEHAVIOR] [L2] B-04: 有头与无头动作闸拒绝无效 receipt [接缝×2]
  动作: 在真实临时 worktree 对缺失/过期/superseded/字段不匹配 receipt 发起 mutation，并让 Dispatcher claim 等价无头任务
  预期观察: 有头 exit 2；无头不调用 executor 并记录 route_violation；只读诊断 exit 0
  等待预算: 30s
  留证: hook shell 输出与 Dispatcher 测试日志
  Test: manual:bash -c 'bash packages/engine/tests/integration/dev-mode-routing-receipt-guard.test.sh && cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-routing-receipt.test.js'

- [ ] [BEHAVIOR] [L2] B-05: Generator 隔离与 frozen baseline lineage 在真实命令链生效 [接缝×2]
  动作: 启动 Generator entrypoint 合同测试，尝试 Provider push、读取 callback token，并验证候选 HEAD 血统
  预期观察: push 被熔断、凭据不可见、容器 hook 可达，冻结基线是 HEAD 祖先但 HEAD 不等于基线
  等待预算: 60s
  留证: runner shell 输出与 git merge-base 输出
  Test: manual:bash -c 'BASELINE_SHA=310ab9e704d4e3f866e6ce7beb25b79dd0f9d524; bash docker/cecelia-runner/__tests__/entrypoint-generator-trust-boundary.test.sh && git merge-base --is-ancestor "$BASELINE_SHA" HEAD && [ "$(git rev-parse HEAD)" != "$BASELINE_SHA" ]'

- [ ] [BEHAVIOR] [L2] B-06: scratch 多入口真实链路满足全部业务阈值 [接缝×2]
  动作: 在 attempt 隔离 DB 运行 scratch smoke，制造 stale 后刷新并 resume，同时建立 content/research/review 对照
  预期观察: coding 3/3 有 receipt/Harness/正确 Map/Impact Contract；对照不误路由；失败审计保留
  等待预算: 180s
  留证: smoke stdout 与带五分钟时间窗的 DB 查询结果
  Test: manual:bash -c 'DB_URL="$DB_URL" BASELINE_SHA=310ab9e704d4e3f866e6ce7beb25b79dd0f9d524 bash packages/brain/scripts/smoke/unified-work-router-smoke.sh'

- [ ] [BEHAVIOR] [L2] B-07: Required DevGate 与完整差异检查通过
  动作: 在候选 HEAD 依次运行 facts、version、DoD mapping 和 diff whitespace 检查
  预期观察: 四项均 exit 0，无事实、版本、映射或 whitespace 漂移
  等待预算: 120s
  留证: 四条命令完整输出
  Test: manual:bash -c 'node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs && git diff --check 310ab9e704d4e3f866e6ce7beb25b79dd0f9d524..HEAD'

## 历史铁律映射

- INV-1 语言：N/A（交付为代码与中文合同，不改变运行行为）。
- INV-2 分支：B-07 在 cp 分支验收，禁止 main push。
- INV-3 Brain DevGate：B-07 逐条执行三项前置门禁。
- INV-4 Bug TDD：B-00 先 RED 后 GREEN，回归测试永久保留。
- INV-5 真实产出：B-01/B-03/B-04/B-05/B-06 分别真 DB/Git/hook/container/scratch 验收。
- INV-6 凭据：B-00/B-05 断言日志脱敏与 Provider 凭据不可见。

## BEHAVIOR:E2E 条目

N/A — dev_pipeline 的 final E2E 为 contract-draft.md 的 local_api bash 脚本。
