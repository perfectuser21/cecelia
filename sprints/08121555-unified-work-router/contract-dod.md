---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Unified Work Router

**范围**: Recovery 前置 + Knife 0-5，不缩减原批准设计。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] Work Router、原子 store、receipt API、migration 413、Map preflight、scratch smoke 与对应永久回归测试存在且接线。
  Test: manual:node -e "for(const p of ['packages/brain/src/work-router.js','packages/brain/src/work-routing-store.js','packages/brain/src/routes/work-routing.js','packages/brain/migrations/413_work_routing_receipts.sql','packages/brain/src/orchestrator/preflight/map-impact-contract.js','packages/brain/scripts/smoke/unified-work-router-smoke.sh'])require('fs').accessSync(p)"
- [ ] [ARTIFACT] Brain 版本、DEFINITION、package-lock 与 `.brain-versions` 同步。
  Test: manual:bash scripts/check-version-sync.sh
- [ ] [ARTIFACT] 每个实现切片均永久保留先 RED 后 GREEN 的 Conventional Commit，baseline 仅为祖先。
  Test: manual:bash -c 'R=310ab9e704d4e3f866e6ce7beb25b79dd0f9d524; B=7b6d3585522b9cacf70f39322abf69d54716927d; git merge-base --is-ancestor "$R" "$B" && git merge-base --is-ancestor "$B" HEAD && node packages/brain/scripts/verify-unified-work-router-tdd-history.mjs "$R" "$B"'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: credential-bearing origin 被规范化且日志脱敏，active Kernel workspace 不删除 [接缝×2]
  动作: 测试用 git init/remote add 建真临时仓，直接调用 ensureHarnessWorktree，捕获 logFn 并记录 rmFn 调用；对带凭据 origin 和 detached active workspace 重复两次
  预期观察: 两次都复用工作区，日志无 credential，rmFn 未触发
  等待预算: 30s
  留证: vitest verbose 输出写入 evidence/vitest.log
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/harness-worktree-recovery.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-02: 四档 change_kind 只正向映射且 task+receipt 原子不可变
  动作: 在 attempt 空库分别创建四档 coding request，并尝试降档、UPDATE receipt 与事务中断
  预期观察: 四档均成为 harness_initiative；降档/反推拒绝；task+receipt 同生同灭；UPDATE/DELETE 失败
  等待预算: 30s
  留证: integration test 输出与 DB 查询结果
  Test: manual:bash -c 'cd packages/brain && DB_URL="$DB_URL" npx vitest run src/__tests__/work-router.test.js src/__tests__/integration/work-routing-store.integration.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-03: 33 处入口逐项委托唯一创建边界且三陷阱回归
  动作: 执行动态 inventory 与 API/Intent/Capture/Planner/Proposal/Actions 入口合同
  预期观察: inventory 每项有合同，无新增业务裸 INSERT；Planner task_type、Proposal skill、Capture decisions schema 均正确
  等待预算: 45s
  留证: vitest verbose 输出
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/task-creation-inventory.test.js src/__tests__/work-router-entrypoints.test.js src/routes/__tests__/capture-atoms-routing.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-04: Map/Impact Contract 对所有 coding run fail-closed [接缝×2]
  动作: 用真 PostgreSQL和真临时 Git repo依次执行 fresh、stale、missing、revision mismatch、scanner invalid、cross-repo 与 map_recovery
  预期观察: 仅 fresh 与合法单次 recovery 进入后续阶段；其余不创建 Provider attempt；policy 恒 required
  等待预算: 60s
  留证: integration 输出、DB contract 行与 Git revision
  Test: manual:bash -c 'cd packages/brain && DB_URL="$DB_URL" BASELINE_SHA=7b6d3585522b9cacf70f39322abf69d54716927d npx vitest run src/orchestrator/preflight/map-impact-contract.test.js src/orchestrator/__tests__/map-recovery-contract.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-05: validation API schema 字段、keys 与禁用字段严格成立
  动作: 由集成测试创建合法 receipt 后调用真实 validation route
  预期观察: 成功只返回 valid/routing_receipt_id/expires_at；不以 ok 替代 valid；坏 receipt 返回稳定 reason_code
  等待预算: 30s
  留证: route integration 响应 JSON
  Test: manual:bash -c 'cd packages/brain && DB_URL="$DB_URL" npx vitest run src/__tests__/work-routing-validation-route.integration.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-06: 有头与无头 coding 在动作前共用 receipt 安全闸
  动作: 在真临时 worktree 执行合法/缺失/过期/superseded/mismatch receipt 的 mutation tool，并派发等价无头任务
  预期观察: 非法有头动作 exit 2、非法无头拒派并记 route_violation；只读诊断和合法 coding 通过
  等待预算: 60s
  留证: hook 与 dispatcher 输出
  Test: manual:bash -c 'bash packages/engine/tests/integration/dev-mode-routing-receipt-guard.test.sh && cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-routing-receipt.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-07: Generator frozen baseline 与 trust boundary 在真实命令链生效
  动作: 启动 runner 合同测试，检查容器 hook、setpriv、capability、pushurl 与敏感环境
  预期观察: baseline 后追加 commit 合法且 imported lineage 拒绝；Provider push 失败；callback/lease 凭据不可见；trusted transport 才可发布
  等待预算: 120s
  留证: runner shell test stdout
  Test: manual:bash -c 'bash docker/cecelia-runner/__tests__/entrypoint-generator-trust-boundary.test.sh && bash docker/cecelia-runner/__tests__/entrypoint-frozen-baseline-guard.test.sh'
  gate-allow: env-missing `docker/` 是仓库内脚本路径；该断言不调用 Docker daemon，运行资源由脚本自身声明

- [ ] [BEHAVIOR] [L2] B-08: scratch 多入口 Golden Path 真实产出全闭环 [接缝×2]
  动作: 在 attempt 空库从 API/Intent/Capture 创建 coding 与 content/research/review 对照，制造 stale 后刷新并 resume
  预期观察: coding 三项均有 receipt/Harness/正确 Map/active contract，且 receipt.base_sha、Map source_revision、Impact Contract source_revision 精确等于冻结实现基线；对照不误路由；失败审计保留
  等待预算: 180s
  留证: smoke stdout 与带 5 分钟窗口的 DB 查询输出
  Test: manual:bash -c 'DB_URL="$DB_URL" BASELINE_SHA=7b6d3585522b9cacf70f39322abf69d54716927d bash packages/brain/scripts/smoke/unified-work-router-smoke.sh'

- [ ] [BEHAVIOR] [L2] B-09: implementation baseline 是最终 HEAD 祖先且治理门禁全绿
  动作: 对候选 HEAD 做 ancestry，并由 TDD 历史验证器在临时 worktree 逐对 checkout 7 个 RED/GREEN SHA 复跑对应测试，再执行三项 DevGate
  预期观察: 历史根与冻结实现基线均为 HEAD 祖先；7/7 RED 失败且其 GREEN 后继通过；事实、版本与 DoD 映射一致
  等待预算: 120s
  留证: git log 与 DevGate 输出
  Test: manual:bash -c 'R=310ab9e704d4e3f866e6ce7beb25b79dd0f9d524; B=7b6d3585522b9cacf70f39322abf69d54716927d; git merge-base --is-ancestor "$R" "$B" && git merge-base --is-ancestor "$B" HEAD && node packages/brain/scripts/verify-unified-work-router-tdd-history.mjs "$R" "$B" && node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs'

## Invariant 映射

- INV-1 禁止 push main：N/A — 发布由 Judge/merge fence 后 trusted transport 处理；本合同不授权 main push。
- INV-2 Brain 代码变更前 DevGate：对应 B-09，三项命令均为 required evidence。
- INV-3 bug 先 RED 后 GREEN并永久保留：对应 ARTIFACT-3 与 B-01/B-09。
- INV-4 数据写入真实验收：对应 B-02/B-04/B-08 的真 PostgreSQL 与 5 分钟时间窗。
- INV-5 凭据不入 git/日志：对应 B-01/B-07。
