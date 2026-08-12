---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Sprint: Unified Work Router

**范围**: Recovery 前置修复 + 批准设计 Knife 0-5；不重写 Harness 状态机，不新增第五形式。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] Recovery 与 Knife 0-5 每项都有永久 RED commit 先于对应 GREEN commit，且完成 HEAD 为 `310ab9e704d4e3f866e6ce7beb25b79dd0f9d524` 后代。
  Test: git merge-base --is-ancestor 310ab9e704d4e3f866e6ce7beb25b79dd0f9d524 HEAD
- [ ] [ARTIFACT] migration、Work Router/store/API、inventory、Map preflight、动作闸、runner trust boundary、scratch smoke、版本与 DEFINITION 产物齐备。
  Test: node -e "const fs=require('fs');['packages/brain/src/work-router.js','packages/brain/src/work-routing-store.js','packages/brain/src/routes/work-routing.js','packages/brain/migrations/411_work_routing_receipts.sql','packages/brain/src/task-creation-inventory.js','packages/brain/src/orchestrator/preflight/map-impact-contract.js','packages/brain/scripts/smoke/unified-work-router-smoke.sh'].forEach(p=>fs.accessSync(p))"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: Recovery origin 归一化、脱敏与 active cwd 保护 [接缝×2]
  动作: 在真实临时 Git repo 中用带 userinfo 和无 userinfo 的同一 origin，关联 active detached Kernel run 后执行 worktree recovery。
  预期观察: 两个 origin 识别为同一 repo，日志无 credential，active cwd 两轮均未删除。
  等待预算: 30s
  留证: Vitest verbose 输出与临时 repo recovery 日志（脱敏后）。
  Test: manual:bash -c 'npx vitest run packages/brain/src/orchestrator/__tests__/harness-worktree-recovery.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-02: 四种 change_kind 只做正向默认映射
  动作: 执行四形式、显式升档、降档及 gear/stage/task_type 反向推导合同测试。
  预期观察: 四个合法形式命中唯一 profile；第五值、降档和反向推导全部被拒绝。
  等待预算: 30s
  留证: change-kind-profiles Vitest 输出。
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/change-kind-profiles.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-03: task 与不可变 Routing Receipt 原子创建 [接缝×2]
  动作: 对 attempt-scoped scratch PostgreSQL 执行成功、故障回滚、并发幂等、UPDATE/DELETE 拒绝集成测试。
  预期观察: task/receipt 同生同灭，receipt append-only，同幂等键只有一个有效结果，跨租户/跨 repo 不串线。
  等待预算: 60s
  留证: integration Vitest 输出与本轮 DB 查询结果。
  Test: manual:bash -c 'test -n "$DB_URL" && cd packages/brain && DATABASE_URL="$DB_URL" npx vitest run src/__tests__/integration/work-routing-store.integration.test.js src/__tests__/migration-411-work-routing.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-04: 所有可执行入口收敛到唯一路由边界
  动作: 运行 inventory 与 API/Intent/Capture/Planner/Proposal 三陷阱入口合同。
  预期观察: inventory 逐项覆盖；coding 统一成为 harness_initiative；content/research/read-only 不误路由；三个旧缺陷保持修复。
  等待预算: 60s
  留证: entrypoint 测试输出与 inventory 扫描结果。
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/task-creation-inventory.test.js src/__tests__/work-router-entrypoints.test.js src/routes/__tests__/capture-atoms-routing.test.js src/__tests__/work-routing-entry.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-05: fresh Map 与 required Impact Contract 在 Provider 前失败关闭
  动作: 用真实临时 repo/测试 DB 运行 fresh、missing、stale、revision mismatch、scanner invalid、cross-repo、diff 越界与 map_recovery 合同。
  预期观察: 只有 fresh 同 repo 基线进入 Structure Gate；其余稳定 reason_code 阻断且不创建 Provider；合法 recovery 单次消费并全量重扫。
  等待预算: 90s
  留证: preflight 测试输出及 Map/Impact Contract 查询证据。
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/preflight/map-impact-contract.test.js src/orchestrator/__tests__/map-recovery-contract.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-06: 有头与无头 mutation 动作前校验同一 receipt [接缝×2]
  动作: 真实临时 worktree 分别执行合法 receipt、缺 lock、过期/superseded、API 不可达、repo/branch/base mismatch 与无头伪造 payload。
  预期观察: 合法 mutation 执行；非法有头 case exit 2、无头拒派并记录 route_violation；只读诊断不受影响。
  等待预算: 90s
  留证: Engine shell test 与 Dispatcher Vitest 输出。
  Test: manual:bash -c 'bash packages/engine/tests/integration/dev-mode-routing-receipt-guard.test.sh && cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-routing-receipt.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L3] B-07: Generator 容器 frozen baseline 与 trust boundary 生效
  动作: 启动真实 runner 容器命令链，检查 hook 路径、UID/capabilities/env 与 pushurl，并尝试 Provider push/callback。
  预期观察: HEAD 为冻结基线后代；Provider 非特权且无 callback/lease 凭据；push 失败；trusted transport 仅在 Judge 后发布。
  等待预算: 180s
  留证: runner test 输出、容器身份/env 摘要和 push exit code（不含凭据）。
  Test: manual:bash -c 'bash docker/cecelia-runner/__tests__/entrypoint-generator-trust-boundary.test.sh'

- [ ] [BEHAVIOR] [L2] B-08: scratch 三 coding 入口与对照 Pipeline 真实验收 [接缝×2]
  动作: 在 attempt-scoped scratch DB 从 API、Intent、Capture 创建 coding，并创建 content/research/read-only/review-fix 对照，制造 stale Map 后刷新 resume。
  预期观察: coding 三项均有 receipt/Harness/正确 Map/active Impact Contract；对照不误入；review fix 进入 Harness；stale 阻断且恢复保留失败审计。
  等待预算: 300s
  留证: smoke stdout、带 5 分钟时间窗的 scratch DB 查询及 stale→refresh 审计链。
  Test: manual:bash -c 'test -n "$DB_URL" && DATABASE_URL="$DB_URL" bash packages/brain/scripts/smoke/unified-work-router-smoke.sh'

- [ ] [BEHAVIOR] [L2] B-09: 权威实现基线是祖先且四条发货门禁全绿
  动作: 对完成态 HEAD 验证 merge-base 祖先关系并依次执行 facts、version、DoD mapping 与 smoke。
  预期观察: HEAD 位于权威基线之后，四条命令均 exit 0；receipt/Map/Impact Contract 基线字段仍为权威基线。
  等待预算: 600s
  留证: 每条命令 exit code 与末尾输出。
  Test: manual:bash -c 'BASELINE_SHA=310ab9e704d4e3f866e6ce7beb25b79dd0f9d524; git merge-base --is-ancestor "$BASELINE_SHA" HEAD && node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs && DATABASE_URL="$DB_URL" bash packages/brain/scripts/smoke/unified-work-router-smoke.sh'

## Invariant 映射

- [ ] [BEHAVIOR] [L2] INV-1: 凭据安全与日志脱敏
  动作: 执行 Recovery 回归并扫描其真实输出。
  预期观察: origin userinfo/token 不出现在日志。
  等待预算: 30s
  留证: Recovery 测试输出。
  Test: manual:bash -c 'npx vitest run packages/brain/src/orchestrator/__tests__/harness-worktree-recovery.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] INV-2: receipt 验证端点鉴权
  动作: 运行有头 receipt guard 的未认证与合法认证用例。
  预期观察: 未认证请求失败关闭，合法认证才返回 validation result。
  等待预算: 60s
  留证: Engine guard 集成输出。
  Test: manual:bash -c 'bash packages/engine/tests/integration/dev-mode-routing-receipt-guard.test.sh'

- [ ] [BEHAVIOR] [L2] INV-3: 租户与 repo 隔离
  动作: 在 scratch DB 对两个主体及两个 repo 执行原子 receipt 集成测试。
  预期观察: 查询和写入均不跨主体或跨 repo。
  等待预算: 60s
  留证: integration Vitest 输出。
  Test: manual:bash -c 'test -n "$DB_URL" && cd packages/brain && DATABASE_URL="$DB_URL" npx vitest run src/__tests__/integration/work-routing-store.integration.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L3] INV-4: 真实接缝未验不得 done
  动作: 执行真实 runner trust-boundary 与 scratch smoke。
  预期观察: 容器和 scratch 均成功后才形成完成证据。
  等待预算: 300s
  留证: 两个命令的 exit code 与输出摘要。
  Test: manual:bash -c 'bash docker/cecelia-runner/__tests__/entrypoint-generator-trust-boundary.test.sh && DATABASE_URL="$DB_URL" bash packages/brain/scripts/smoke/unified-work-router-smoke.sh'

- [ ] [BEHAVIOR] [L2] INV-5: 环境值与 validation identity 运行时注入
  动作: 以 Runner 提供的 DB_URL、HARNESS_ATTEMPT_ID 与 CAPABILITY_SNAPSHOT_ID 执行 smoke。
  预期观察: 合同不依赖固定业务凭据或角色 UUID。
  等待预算: 300s
  留证: 当前角色身份摘要与 smoke 输出，不记录 token。
  Test: manual:bash -c 'test -n "$DB_URL" && test -n "$HARNESS_ATTEMPT_ID" && test -n "$CAPABILITY_SNAPSHOT_ID" && DATABASE_URL="$DB_URL" bash packages/brain/scripts/smoke/unified-work-router-smoke.sh'

- [ ] [BEHAVIOR] [L2] INV-6: 单写手任务计划
  动作: 解析 task-plan 并核对唯一 ws1 与空依赖。
  预期观察: tasks 长度为 1 且 task_id=ws1。
  等待预算: 0s
  留证: jq 输出。
  Test: manual:bash -c 'jq -e ".tasks|length==1 and .[0].task_id==\"ws1\" and (.[0].depends_on|length==0)" sprints/08121555-unified-work-router/task-plan.json'

- [ ] [BEHAVIOR] [L2] INV-7: 发货验证命令 exit code 真实传播
  动作: 顺序执行 facts、version、DoD mapping 与 scratch smoke。
  预期观察: 任一失败即整条命令非 0，无吞错兜底。
  等待预算: 600s
  留证: 每条命令输出与最终 exit code。
  Test: manual:bash -c 'node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs && DATABASE_URL="$DB_URL" bash packages/brain/scripts/smoke/unified-work-router-smoke.sh'

- [ ] [BEHAVIOR] [L2] INV-8: RED→GREEN 证据可供 Judge 消费
  动作: 从实现基线之后的提交历史核查测试提交先于实现提交。
  预期观察: Recovery 与每个 Knife 均可定位 RED 后 GREEN，提交顺序无倒置。
  等待预算: 10s
  留证: 基线后 git log 摘要。
  Test: manual:bash -c 'git merge-base --is-ancestor 310ab9e704d4e3f866e6ce7beb25b79dd0f9d524 HEAD && git log --format="%s" 310ab9e704d4e3f866e6ce7beb25b79dd0f9d524..HEAD | grep -Eq "^(test|feat|fix|refactor)\("'

- [ ] [BEHAVIOR] [L3] INV-9: Generator Provider 隔离
  动作: 在真实 runner 命令链尝试读取 callback/lease、获得特权和 push。
  预期观察: 环境变量不可见、capabilities 清空、push 失败。
  等待预算: 180s
  留证: 容器测试输出与失败的 push exit code。
  Test: manual:bash -c 'bash docker/cecelia-runner/__tests__/entrypoint-generator-trust-boundary.test.sh'

- [ ] [BEHAVIOR] [L2] INV-10: frozen baseline 只定义祖先血统
  动作: 对完成态 HEAD 执行 merge-base 祖先验证。
  预期观察: baseline 是 HEAD 祖先；不要求二者相等。
  等待预算: 0s
  留证: merge-base exit code 与 HEAD SHA。
  Test: manual:bash -c 'git merge-base --is-ancestor 310ab9e704d4e3f866e6ce7beb25b79dd0f9d524 HEAD && git rev-parse HEAD'
