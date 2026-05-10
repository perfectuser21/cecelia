# PRD — fix(brain): executor.js verdict 传递修复（W20 Bug 3）

## 背景 / 问题

W20 实证：harness initiative task `b56c4e82` 的 final_evaluate 节点返 `final_e2e_verdict='FAIL'`（"现有 vitest 输出仅含 8 个 sum/health 用例，全无 multiply 测试名"），但 task.status 仍标 `completed`。

根因（audit 已查到）：
- `packages/brain/src/executor.js:2894` `runHarnessInitiativeRouter()` 返回 `ok: !final?.error`
- `final?.error` 为 undefined 当 final_e2e_verdict='FAIL' 但 graph 节点没设 error 字段时（line 1370-1379, 1422-1427 三个分支都不设 error）
- → ok=true → line 2989 `if (result.ok) await updateTaskStatus(task.id, 'completed')` → task=completed 即使 verdict=FAIL

## 成功标准

- **SC-001**: `final_e2e_verdict='FAIL'` 时 ok=false（不论 error 字段是否设置）
- **SC-002**: `final_e2e_verdict='PASS_WITH_OVERRIDE'`（operator override）时 ok=true
- **SC-003**: `final` 为 null/undefined 时 ok=false（防御）
- **SC-004**: `error` 字段非空时 ok=false（保持原行为）
- **SC-005**: error_message 在 FAIL verdict 时含 failed_scenarios names
- **SC-006**: `reportNode` 在 FAIL verdict 时打 console.error 防御日志
- **SC-007**: 18 个 unit test 全过 + executor 相邻 52 个测试不破坏

## 范围限定

**在范围内**：
- packages/brain/src/executor.js 加 2 个 helper（computeHarnessInitiativeOk + computeHarnessInitiativeError）+ 用在 runHarnessInitiativeRouter 返回值
- packages/brain/src/workflows/harness-initiative.graph.js reportNode 加 FAIL 防御日志
- 单元测试覆盖

**不在范围内**：
- 改 finalEvaluateDispatchNode 设 error 字段
- 加 verify_deployment 节点
- 改 skill prompt（PR A 已合 #2879）

## 不做

- 不改 verdict 计算逻辑
- 不改 task_loop_index / sub_task verdict 路由
- 不修 W19/W20 历史 task

## 测试策略

- **Unit**: `__tests__/executor-harness-initiative-ok.test.js` 18 case
- **Integration**: 不需要（纯函数 helper），但 watchdog integration test 已覆盖 r.error undefined 协议
- **E2E**: 派 W21 严 schema /multiply 验
- **smoke.sh**: 不需要（commit type fix:）

## 受影响文件

- `packages/brain/src/executor.js`
- `packages/brain/src/workflows/harness-initiative.graph.js`
- `packages/brain/src/__tests__/executor-harness-initiative-ok.test.js`
- `docs/learnings/cp-0510204528-brain-executor-final-evaluate-verdict-fix.md`
