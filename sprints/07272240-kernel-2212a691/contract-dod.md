---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Kernel provider-neutral 容量判定恢复

**范围**: active/terminal SSOT、provider/account per-target free、dedup 账本、legacy adapter 边界、双任务双 cycle 真链路、stable reasons、review_required gate。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] 合同测试文件与 task-plan 已生成
  Test: node -e "const fs=require('fs');for(const f of ['sprints/07272240-kernel-2212a691/contract-draft.md','sprints/07272240-kernel-2212a691/task-plan.json','sprints/07272240-kernel-2212a691/tests/kernel-capacity-recovery.contract.test.ts','sprints/07272240-kernel-2212a691/tests/kernel-capacity-recovery.pg.contract.test.ts'])fs.accessSync(f)"

- [ ] [ARTIFACT] 禁止引入 recovered_at 或命令式 release helper
  Test: node -e "const fs=require('fs');for(const f of ['packages/brain/src/orchestrator/attempt-store.js','packages/brain/src/slot-allocator.js','packages/brain/src/harness-skill-relay.js']){const c=fs.readFileSync(f,'utf8');if(/recovered_at|releaseHarnessCapacity|release_capacity_helper/i.test(c))throw new Error('forbidden helper in '+f)}"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] active terminal SSOT 与 execution-contract 完全一致
  动作: 读取真实 `execution-contract.js`、`attempt-store.js` 与 slot allocator contract test 中冻结的 canonical 集合，并在真 test DB 驱动一次 attempt 从 `queued -> starting -> running -> completed`。
  预期观察: active 仅 `queued|starting|running`；terminal 仅 `completed|completed_with_concerns|needs_context|blocked|failed|cancelled`；任何多字面或少字面都失败。
  验证命令: Test: manual:bash -c 'cd /workspace/packages/brain && DB_NAME="${DB_NAME:-cecelia_test}" npx vitest run ../../sprints/07272240-kernel-2212a691/tests/kernel-capacity-recovery.pg.contract.test.ts -t "active terminal SSOT 与 execution-contract 完全一致"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] active attempt 进入 terminal 后 occupancy 自然释放容量
  动作: 在真 test DB 创建同一 provider/account 的 active attempt，执行真实 terminal 转移后 within 30s 重跑 occupancy query。
  预期观察: within 30s occupancy 从 1 降到 0，`free=max(0,safe_limit-active)` 自然回升；无 `recovered_at`、无 release helper。
  验证命令: Test: manual:bash
    DEADLINE=$((SECONDS + 30))
    cd /workspace/packages/brain
    until DB_NAME="${DB_NAME:-cecelia_test}" npx vitest run ../../sprints/07272240-kernel-2212a691/tests/kernel-capacity-recovery.pg.contract.test.ts -t "active attempt 进入 terminal 后 occupancy 自然释放容量" >/tmp/kernel-capacity-release.log 2>&1; do
      [ $SECONDS -lt $DEADLINE ] || { cat /tmp/kernel-capacity-release.log; echo "FAIL: within 30s occupancy 未自然释放"; exit 1; }
      sleep 2
    done
    cat /tmp/kernel-capacity-release.log
  期望: within 30s exit 0

- [ ] [BEHAVIOR] [L2] unknown selected provider/account 只拒绝当前 pinned 任务
  动作: 以 server-owned task row 的 `payload.role_assignments` 构造一个 unknown pinned 任务，再独立构造一个健康 Codex/Grok 任务。
  预期观察: unknown 任务返回 `selected_target_unknown`；独立健康任务仍可得到 allow 结果。
  验证命令: Test: manual:bash -c 'cd /workspace/packages/brain && npx vitest run ../../sprints/07272240-kernel-2212a691/tests/kernel-capacity-recovery.contract.test.ts -t "unknown selected provider/account 只拒绝当前 pinned 任务"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] dispatcher 只能使用 role_assignments 冻结 target
  动作: 真跑 orchestrator dispatcher contract，用同一 run 设置一个真实 `role_assignments.<role>`，同时注入冲突的 synthetic candidate 字段。
  预期观察: admission 只看到 `role_assignments` 解析出的 immutable `{provider,account,machine}`；synthetic candidate 字段不生效。
  验证命令: Test: manual:bash -c 'cd /workspace/packages/brain && npx vitest run ../../sprints/07272240-kernel-2212a691/tests/kernel-capacity-recovery.contract.test.ts -t "dispatcher 只能使用 role_assignments 冻结 target"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] total=4 active=2 free=2 的 selected target 必须 allow
  动作: 以同一 selected provider/account 构造 `safe_limit=4`、`active=2` 的真账本，并让 memory/disk/quota/global hard seats 全部通过。
  预期观察: 返回 allow，且 `provider_account_free=2`；保留旧 `occupied>=min(acct_cap...)` 逻辑会失败。
  验证命令: Test: manual:bash -c 'cd /workspace/packages/brain && npx vitest run ../../sprints/07272240-kernel-2212a691/tests/kernel-capacity-recovery.contract.test.ts -t "total=4 active=2 free=2 的 selected target 必须 allow"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] harnessSlotCheck 不得 double debit 同一 dedup key
  动作: 对同一 attempt 在 relay/inflight/kernel 三本账重复出现同一 dedup key，并执行真实 harnessSlotCheck。
  预期观察: 该 key 只被扣减一次；返回体包含单一 dedup 证据。
  验证命令: Test: manual:bash -c 'cd /workspace/packages/brain && npx vitest run ../../sprints/07272240-kernel-2212a691/tests/kernel-capacity-recovery.contract.test.ts -t "harnessSlotCheck 不得 double debit 同一 dedup key"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] snapshot 缺失、stale、usage API failure、memory、disk、quota、hard seats 各返回独立 stable reason
  动作: 分别触发 selected target snapshot missing、`sampled_at + cache_ttl` stale、usage API failure，以及 memory/disk/quota/global hard seats 独立硬闸。
  预期观察: 分别返回 `provider_snapshot_missing`、`provider_snapshot_stale`、`provider_usage_unavailable`、`memory_pressure`、`disk_pressure`、`quota_critical`、`global_hard_cap_reached`；互不吞并。
  验证命令: Test: manual:bash -c 'cd /workspace/packages/brain && DB_NAME="${DB_NAME:-cecelia_test}" npx vitest run ../../sprints/07272240-kernel-2212a691/tests/kernel-capacity-recovery.pg.contract.test.ts -t "provider_snapshot_missing|provider_snapshot_stale|provider_usage_unavailable|memory_pressure|disk_pressure|quota_critical|global_hard_cap_reached"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] legacy admission adapter 在 provider-neutral snapshot 之前独立生效
  动作: 构造一个 non-Kernel/relay 任务，并同时让 Kernel snapshot 进入 missing/stale 两种失败状态。
  预期观察: legacy 任务仍走 legacy adapter 自己的 pass/fail；snapshot 异常不改变 legacy verdict。
  验证命令: Test: manual:bash -c 'cd /workspace/packages/brain && DB_NAME="${DB_NAME:-cecelia_test}" npx vitest run ../../sprints/07272240-kernel-2212a691/tests/kernel-capacity-recovery.pg.contract.test.ts -t "legacy admission adapter 在 provider-neutral snapshot 之前独立生效"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] 双任务双 cycle 真链路中 Claude 满额被拒而 Codex 或 Grok 空闲被真实 launch
  动作: 在真 test DB 创建两个 server-owned Kernel 任务并触发真实 `dispatchNextTask`/tick 周期；一个 pinned Claude 满额，一个 pinned Codex 或 Grok 空闲。
  预期观察: Claude 任务得到稳定拒绝 reason；Codex/Grok 任务继续进入真实 `launchKernelProcess` 或 unified Controller；helper path array/boolean 不算通过。
  验证命令: Test: manual:bash -c 'cd /workspace/packages/brain && DB_NAME="${DB_NAME:-cecelia_test}" npx vitest run ../../sprints/07272240-kernel-2212a691/tests/kernel-capacity-recovery.pg.contract.test.ts -t "双任务双 cycle 真链路中 Claude 满额被拒而 Codex 或 Grok 空闲被真实 launch"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] review_required=true gate 继续生效
  动作: 对本次 P0 控制器变更创建真实任务行，保持 `payload.review_required=true`，再通过 evaluator/judge/human gate 相关真链路断言。
  预期观察: current-SHA evaluator/judge/human gate 仍被执行；首次 merge/deploy 前必须等待用户批准。
  验证命令: Test: manual:bash -c 'cd /workspace/packages/brain && DB_NAME="${DB_NAME:-cecelia_test}" npx vitest run ../../sprints/07272240-kernel-2212a691/tests/kernel-capacity-recovery.pg.contract.test.ts -t "review_required=true gate 继续生效"'
  期望: exit 0

## Invariant 铁律逐条映射

- INV-01 真环境验证：BEHAVIOR 条目全部以真实 task row / PG / dispatcher / launch 链路验收，不只看 helper 返回值。
- INV-02 环境假设：provider/account、snapshot 与 role/action 均由真实任务行或环境推导，不写死。
- INV-03 租户隔离：N/A，本单不改变租户模型；如后续查询涉及 tenant 必须继续按现有作用域执行。
- INV-43 提前合并：`review_required=true` gate 继续生效，首次 merge/deploy 等待用户批准。

## 生产接缝（不由 worker 自动执行）

- [ ] [L3-PENDING] 真生产 merge/deploy 前，由主 session 确认 `review_required=true` 任务已完成 current-SHA evaluator/judge/human 审核。
- [ ] [L3-PENDING] 真生产环境不得直接写库做容量修复；如需数据修复必须单独审批。
