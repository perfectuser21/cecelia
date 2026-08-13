---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Unified Work Router

## ARTIFACT 条目

- [ ] [ARTIFACT] 统一真实验收执行体存在且导出 `runUnifiedRouterAcceptance`。
  Test: manual:node -e "import('./packages/brain/src/orchestrator/unified-router-acceptance.js').then(m=>{if(typeof m.runUnifiedRouterAcceptance!=='function')process.exit(1)})"
- [ ] [ARTIFACT] Brain 版本同步。
  Test: manual:bash scripts/check-version-sync.sh

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 工作区恢复安全 [接缝×2]
  动作: 以真临时 Git origin 执行 recovery tests 两次
  预期观察: credential 不泄漏且 active detached cwd 不删除
  等待预算: 60s
  留证: vitest stdout
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/harness-worktree-recovery.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-02: Router 原子创建与入口收敛
  动作: 在 attempt DB 跑 Router 与 inventory 集成测试
  预期观察: 四档正向映射，task+receipt 原子，入口零遗漏
  等待预算: 60s
  留证: vitest 与 DB 输出
  Test: manual:bash -c 'cd packages/brain && DB_URL="$DB_URL" npx vitest run src/__tests__/work-router.test.js src/__tests__/task-creation-inventory.test.js src/__tests__/work-router-entrypoints.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-03: validation schema 精确
  动作: 用真 DB receipt 调 validation route 集成测试
  预期观察: valid/routing_receipt_id/expires_at 精确存在，ok 不存在；错误带 reason_code
  等待预算: 30s
  留证: response JSON
  Test: manual:bash -c 'cd packages/brain && DB_URL="$DB_URL" npx vitest run src/__tests__/work-routing-validation-route.integration.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-04: Map/Impact fail-closed [接缝×2]
  动作: 运行 fresh/stale/mismatch/recovery 场景两次
  预期观察: 只有 fresh/合法 recovery 继续，revision 等于冻结基线
  等待预算: 90s
  留证: DB 与 vitest 输出
  Test: manual:bash -c 'cd packages/brain && DB_URL="$DB_URL" BASELINE_SHA=dd0dffac1774d92d8080ff4a4524e0ae8359d530 npx vitest run src/orchestrator/preflight/map-impact-contract.test.js src/orchestrator/__tests__/map-recovery-contract.test.js --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-05: scratch 三入口真实闭环 [接缝×2]
  动作: 真实执行 API/Intent/Capture 与三类对照任务
  预期观察: coding 全路由、对照不误路由、stale/resume 审计保留
  等待预算: 180s
  留证: smoke stdout 与 5 分钟 DB 查询
  Test: manual:bash -c 'DB_URL="$DB_URL" BASELINE_SHA=dd0dffac1774d92d8080ff4a4524e0ae8359d530 bash packages/brain/scripts/smoke/unified-work-router-smoke.sh'

- [ ] [BEHAVIOR] [L2] B-06: Router 到 Judge 机械闸字面 PASS
  动作: 用当前 Runner 身份执行统一验收入口
  预期观察: 服务端机械闸输出 PASS，证据锚定候选与冻结基线
  等待预算: 300s
  留证: 验收 stdout、Evaluator/Judge provenance 与证据 SHA-256
  Test: manual:bash -c 'OUT=$(DB_URL="$DB_URL" BASELINE_SHA=dd0dffac1774d92d8080ff4a4524e0ae8359d530 node packages/brain/src/orchestrator/unified-router-acceptance.js); printf "%s\n" "$OUT" | grep -q "MECHANICAL_GATE=PASS"; printf "%s\n" "$OUT" | grep -q "BASELINE_SHA=dd0dffac1774d92d8080ff4a4524e0ae8359d530"'

## Invariant 映射

- 80 条注入铁律按适用性归并：凭据安全→B-01；真实 DB/接缝/租户隔离→B-02/B-04/B-05；validation clock、Judge 格式与证据窗口→B-06；版本与 DevGate→ARTIFACT-2。其余宿主 UI、定时任务、发布平台、真机 RPA 铁律均 N/A（本 sprint 不触及）。
