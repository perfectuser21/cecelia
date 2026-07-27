---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Kernel 原子失败终结器与槽位自愈

**范围**: Kernel failure terminalizer、失败出口接线、`all_execution_targets_exhausted` infra retry、窄 reconciler、slot allocator SSOT、正式 failed API `completed_at`、ghost fixture、版本账本与 current SHA 回归证据。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] failure terminalizer 模块与失败出口接线存在
  Test: node -e "const fs=require('fs');const ps=['packages/brain/src/orchestrator/failure-terminalizer.js','packages/brain/src/orchestrator/loop.js','packages/brain/src/orchestrator/run.js','packages/brain/src/harness-relay-watchdog.js'];for(const p of ps){if(!fs.existsSync(p))throw new Error('missing '+p)};const loop=fs.readFileSync('packages/brain/src/orchestrator/loop.js','utf8');if(!/failureTerminalizer/.test(loop))throw new Error('loop missing terminalizer wiring');const run=fs.readFileSync('packages/brain/src/orchestrator/run.js','utf8');if(!/failureTerminalizer/.test(run))throw new Error('run missing terminalizer wiring');const watchdog=fs.readFileSync('packages/brain/src/harness-relay-watchdog.js','utf8');if(!/failureTerminalizer/.test(watchdog))throw new Error('watchdog missing terminalizer wiring')"

- [ ] [ARTIFACT] 根版本账本与回归合同同步，且 `RCI` 缺失被显式登记
  Test: bash -c 'node -e "const fs=require(\"fs\");for(const p of [\"DEFINITION.md\",\"packages/brain/package.json\",\"packages/brain/package-lock.json\",\".brain-versions\",\"regression-contract.yaml\"]){if(!fs.existsSync(p))throw new Error(`missing ${p}`);if(!fs.readFileSync(p,\"utf8\").trim())throw new Error(`empty ${p}`)}" && bash scripts/check-version-sync.sh && test ! -e RCI'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] 统一失败出口接入 failure terminalizer
  动作: 运行 contract 回归，分别触发 hop cap、`ACTION.MARK_FAILED`、approved-but-no-contract、`blocked_same_state`、`ci_timeout`、fatal catch、launch failure、watchdog dead、watchdog deadline 路径。
  预期观察: 所有路径最终都走同一 `failureTerminalizer(runId, taskId, reason, failureClass)`，而不是各自散写 run/task SQL。
  验证命令: Test: manual:bash
    npx vitest run sprints/07272008-kernel-4a1c87b0/tests/kernel-failure-terminalizer.contract.test.js -t "统一失败出口接入 failure terminalizer"
  期望: exit 0

- [ ] [BEHAVIOR] [L2] hard failure 原子终结 run task history claim 并保持幂等
  动作: 在真 PG 上构造 latest Kernel v2 run 与其 `current_task_id`，对同一 hard failure 连续调用 terminalizer 两次。
  预期观察: 第一次在单事务内写 `initiative_runs.phase='failed'`、`failure_reason`、`completed_at`，task 写 `failed`、`completed_at`、`error/result`、claim 清空，且 `task_status_history` 只新增 1 条；第二次不重复 history、不覆盖已终态。
  验证命令: Test: manual:bash
    npx vitest run sprints/07272008-kernel-4a1c87b0/tests/kernel-failure-terminalizer.pg.contract.test.js -t "hard failure 原子终结 run task history claim 并保持幂等"
  期望: exit 0

- [ ] [BEHAVIOR] [L2] all_execution_targets_exhausted 仅前 3 次回 queued 第 4 次 hard fail
  动作: 以结构化 `failureClass==="infrastructure_blocked"` 且 `fallback_reason==="all_execution_targets_exhausted"` 连续触发 4 次 exhaustion，并分别对合同/评测/用户拒绝失败做对照。
  预期观察: 第 1/2/3 次 within 60s 将 task 清 claim、写 `retry_count/retry_after` 并回 `queued`；第 4 次 hard fail；合同/评测/用户拒绝不自动 retry。
  验证命令: Test: manual:bash
    npx vitest run sprints/07272008-kernel-4a1c87b0/tests/kernel-failure-terminalizer.contract.test.js -t "all_execution_targets_exhausted 仅前 3 次回 queued 第 4 次 hard fail"
  期望: exit 0

- [ ] [BEHAVIOR] [L2] reconciler 仅处理 latest kernel v2 terminal run 的精确幽灵态
  动作: 构造 latest terminal run、历史 terminal run、非 v2 run、以及 paused/blocked/queued/completed task 混合集。
  预期观察: 只有 latest Kernel v2 terminal run 且 `current_task_id` 精确匹配、task 仍 `in_progress` 的记录被修复；历史 stranded failed run 只 hard-fail 当前 task，不猜 infra 分类。
  验证命令: Test: manual:bash
    npx vitest run sprints/07272008-kernel-4a1c87b0/tests/kernel-failure-terminalizer.contract.test.js -t "reconciler 仅处理 latest kernel v2 terminal run 的精确幽灵态"
  期望: exit 0

- [ ] [BEHAVIOR] [L2] slot allocator 继续以 task status 为 SSOT 且 failed API 补 completed_at
  动作: 一条 task 先进入 `in_progress` 占 1 个 slot，再分别经 hard failure terminalizer、infra requeue、正式 API failed 路径结束。
  预期观察: slot used 从 1 降回 0；slot 查询不新增 `JOIN initiative_runs` 绕过；`PATCH /api/brain/tasks/:task_id` failed 更新后 `completed_at` 非空。
  验证命令: Test: manual:bash
    npx vitest run sprints/07272008-kernel-4a1c87b0/tests/kernel-failure-terminalizer.contract.test.js -t "slot allocator 继续以 task status 为 SSOT 且 failed API 补 completed_at"
  期望: exit 0

- [ ] [BEHAVIOR] [L2] ghost fixture 只读回归且 current SHA 证据已接线
  动作: 运行 ghost fixture / current SHA 合同回归，并检查版本账本同步脚本。
  预期观察: 两组生产 ghost fixture 只作为只读样本被引用，不改写生产行；回归合同存在 current SHA 绑定；版本同步脚本通过；`RCI` 缺失被显式登记。
  验证命令: Test: manual:bash
    npx vitest run sprints/07272008-kernel-4a1c87b0/tests/kernel-failure-terminalizer.contract.test.js -t "ghost fixture 只读回归且 current SHA 证据已接线" && bash scripts/check-version-sync.sh && test ! -e RCI
  期望: exit 0

- [ ] [BEHAVIOR] [L2] 真 PG 聚合验证本轮终结记录与单条 history
  动作: 跑完 PG 集成回归后，用真实 Postgres 轮询本轮新增的 failed run 与 history。
  预期观察: within 60s 至少 1 条本轮 `initiative_runs.completed_at` 与 1 条本轮 `task_status_history` 命中；历史数据不能冒充本轮结果。
  验证命令: Test: manual:bash
    DEADLINE=$((SECONDS + 60))
    until psql "${DB_URL:-postgresql://localhost/cecelia}" -Atqc "SELECT count(*) FROM initiative_runs WHERE phase='failed' AND completed_at > NOW() - interval '5 minutes';" | grep -Eq '^[1-9][0-9]*$'; do
      [ $SECONDS -lt $DEADLINE ] || { echo "FAIL: within 60s 未出现本轮 failed run completed_at"; exit 1; }
      sleep 2
    done
    psql "${DB_URL:-postgresql://localhost/cecelia}" -Atqc "SELECT count(*) FROM task_status_history WHERE created_at > NOW() - interval '5 minutes';" | grep -Eq '^[1-9][0-9]*$'
  期望: exit 0

## Invariant 覆盖映射

- [ ] [BEHAVIOR] INV-1 `all_execution_targets_exhausted` 退避窗口与 terminal run deadline 关系可执行锁定
  Test: manual:bash
    npx vitest run sprints/07272008-kernel-4a1c87b0/tests/kernel-failure-terminalizer.contract.test.js -t "all_execution_targets_exhausted 仅前 3 次回 queued 第 4 次 hard fail" && npx vitest run packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js -t "deadline"
- [ ] [BEHAVIOR] INV-2 非 `infrastructure_blocked` 失败必须显式走 hard fail，不能靠外层 try/catch 或 reason 子串兜底
  Test: manual:bash
    npx vitest run sprints/07272008-kernel-4a1c87b0/tests/kernel-failure-terminalizer.contract.test.js -t "all_execution_targets_exhausted 仅前 3 次回 queued 第 4 次 hard fail"
- [ ] [BEHAVIOR] INV-3 fatal catch / watchdog 失败不得静默吞错，必须统一进入 terminalizer
  Test: manual:bash
    npx vitest run sprints/07272008-kernel-4a1c87b0/tests/kernel-failure-terminalizer.contract.test.js -t "统一失败出口接入 failure terminalizer"
- [ ] INV-4 N/A：本 sprint 不新增独立后台落库 job。
- [ ] [BEHAVIOR] INV-5 current SHA 语义在 ghost fixture、版本账本与回归合同之间一致
  Test: manual:bash
    npx vitest run sprints/07272008-kernel-4a1c87b0/tests/kernel-failure-terminalizer.contract.test.js -t "ghost fixture 只读回归且 current SHA 证据已接线" && bash scripts/check-version-sync.sh
- [ ] INV-6 N/A：本 sprint 不改共享 CI 文件。
- [ ] INV-7 N/A：本 sprint 不触达 merge 流程。
- [ ] INV-8 N/A：实现阶段需要 DevGate/smoke 证据，但本合同不新增 allowlist 逻辑。
- [ ] [BEHAVIOR] INV-9 单 slot 串行不变量继续仅由 `task.status` 驱动
  Test: manual:bash
    npx vitest run sprints/07272008-kernel-4a1c87b0/tests/kernel-failure-terminalizer.contract.test.js -t "slot allocator 继续以 task status 为 SSOT 且 failed API 补 completed_at"
- [ ] [BEHAVIOR] INV-10 真 PG 原子性与本轮 `completed_at/history` 时间窗验证同时成立
  Test: manual:bash
    npx vitest run sprints/07272008-kernel-4a1c87b0/tests/kernel-failure-terminalizer.pg.contract.test.js -t "hard failure 原子终结 run task history claim 并保持幂等" && DEADLINE=$((SECONDS + 60)) && until psql "${DB_URL:-postgresql://localhost/cecelia}" -Atqc "SELECT count(*) FROM initiative_runs WHERE phase='failed' AND completed_at > NOW() - interval '5 minutes';" | grep -Eq '^[1-9][0-9]*$'; do [ $SECONDS -lt $DEADLINE ] || exit 1; sleep 2; done
- [ ] INV-11 N/A：本 sprint 不新增租户维度读写逻辑。
- [ ] INV-12 N/A：本 sprint 不新增 secret 落盘逻辑。
- [ ] INV-13 N/A：本 sprint 不新增 PII 日志输出。
- [ ] INV-14 N/A：本 sprint 不新增 API 端点。
- [ ] INV-15 N/A：本 sprint 不触碰租户范围查询/写入。

## E2E 验收

```bash
#!/bin/bash
set -euo pipefail

cd /workspace

SPRINT_DIR="sprints/07272008-kernel-4a1c87b0"
DB_URL="${DB_URL:-postgresql://localhost/cecelia}"

curl -fsS --max-time 10 "http://localhost:5221/api/brain/health" | jq -e '.status == "ok"' >/dev/null

npx vitest run \
  "$SPRINT_DIR/tests/kernel-failure-terminalizer.contract.test.js" \
  "$SPRINT_DIR/tests/kernel-failure-terminalizer.pg.contract.test.js" \
  packages/brain/src/orchestrator/__tests__/loop.test.js \
  packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js \
  packages/brain/src/__tests__/harness-slot-check-kernel.test.js \
  packages/brain/src/routes/__tests__/tasks-result-backfill.test.js \
  packages/brain/src/__tests__/integration/task-status-transitions.integration.test.js \
  tests/regression/relay-50170af2/kernel-wiring-persistent-blocked.integration.test.js \
  tests/regression/relay-50170af2/kernel-wiring-deadline.integration.test.js

DEADLINE=$((SECONDS + 60))
until psql "$DB_URL" -Atqc "SELECT count(*) FROM initiative_runs WHERE phase='failed' AND completed_at > NOW() - interval '5 minutes';" | grep -Eq '^[1-9][0-9]*$'; do
  [ $SECONDS -lt $DEADLINE ] || { echo "FAIL: timeout after 60s"; exit 1; }
  sleep 2
done
psql "$DB_URL" -Atqc "SELECT count(*) FROM task_status_history WHERE created_at > NOW() - interval '5 minutes';" | grep -Eq '^[1-9][0-9]*$'

bash scripts/check-version-sync.sh
node -e "const fs=require('fs');const y=fs.readFileSync('regression-contract.yaml','utf8');if(!/current sha|current_sha|head sha/i.test(y))process.exit(1)"
test ! -e RCI
```
