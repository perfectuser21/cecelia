# Harness v2 Phase Advancer（PR-3/4）

**日期**：2026-04-20
**分支**：cp-0420181142-harness-v2-phase-advancer
**Brain Task**：c577696e-d8ca-43e5-8a70-efcb44fb5cf4
**依赖**：PR-1 (#2469) / PR-2 (#2476) 已合并

## 背景

`initiative_runs.phase` 有 A_contract / B_task_loop / C_final_e2e / done / failed 五态，但**目前没有任何代码推进**：
- 合同 approved 后不会自动进 B
- 子 Task 全部 completed 后不会自动调 `runPhaseCIfReady`
- runner 只是入口一次性动作；推进器空缺

结果：真实 E2E 跑到 Initiative Planner 后就卡死（观察到 `b94cde3b`）。

## 目标

在 `tick.js` 的主循环里加 `advanceHarnessInitiatives(pool)` 钩子，负责：
- A_contract + 合同 approved → 晋级 B_task_loop
- B_task_loop：按 DAG 拓扑序派下一个 Task；全部完成 → 调 `runPhaseCIfReady`
- C_final_e2e 由 `runPhaseCIfReady` 内部处理（已有逻辑）

## 非目标

- PR-4：Phase A GAN Proposer/Reviewer 循环（本 PR 不生成合同内容，只推进 phase）

## 架构

```
tick.executeTick()
  ├─ [现有：警觉/认知/决策评估]
  ├─ await advanceHarnessInitiatives(pool)      ← NEW hook
  │    for each run WHERE phase IN (A_contract, B_task_loop, C_final_e2e):
  │      ├─ A_contract + contract.status='approved' → UPDATE phase='B_task_loop'
  │      ├─ B_task_loop：推进 current_task_id 或调 runPhaseCIfReady
  │      └─ C_final_e2e：runPhaseCIfReady 内部已处理
  └─ dispatchNextTask loop    ← 现有派发路径不变
```

## 组件

### 新增 `packages/brain/src/harness-phase-advancer.js`（约 110 行）

```
advanceHarnessInitiatives(pool, { client?, runPhaseCIfReady?, nextRunnableTask?, checkAllTasksCompleted? })
  -> Promise<{ advanced: number, errors: Array<{runId, error}> }>

  1. 查 active runs：
     SELECT id, initiative_id, phase, current_task_id, contract_id
     FROM initiative_runs
     WHERE phase IN ('A_contract','B_task_loop','C_final_e2e')
       AND (updated_at IS NULL OR updated_at < NOW() - INTERVAL '5 seconds')
     LIMIT 50

  2. 对每个 run 独立 try/catch：
     ─ A_contract：
        SELECT status FROM initiative_contracts WHERE id=contract_id
        if status='approved' → UPDATE initiative_runs SET phase='B_task_loop', updated_at=NOW()
        else：skip

     ─ B_task_loop：
        a. 若 current_task_id 非空 → SELECT status FROM tasks
             status IN ('queued','running','in_progress') → skip
             status='completed' / 'canceled' / 'failed' / 'paused' → 视作已结算，继续
        b. next = nextRunnableTask(initiative_id, { client })
           if next：
             UPDATE initiative_runs SET current_task_id=next.id, updated_at=NOW()
             UPDATE tasks SET status='queued', updated_at=NOW() WHERE id=next.id AND status!='queued'
           else：
             stat = checkAllTasksCompleted(initiative_id, client)
             if stat.all → await runPhaseCIfReady(initiative_id, { pool })

     ─ C_final_e2e：跳过，由 runPhaseCIfReady 内部管理

  3. 返回统计
```

依赖（默认值，测试可替换）：
- `nextRunnableTask` from `./harness-dag.js`
- `checkAllTasksCompleted`, `runPhaseCIfReady` from `./harness-initiative-runner.js`

### 修改 `tick.js`（≤10 行）

在 `executeTick()` 里 `dispatchNextTask` 循环之前，插入：

```js
try {
  const { advanceHarnessInitiatives } = await import('./harness-phase-advancer.js');
  await advanceHarnessInitiatives(pool);
} catch (err) {
  console.error('[harness-advance] tick error:', err.message);
}
```

Dynamic import 避免启动时模块加载失败影响 tick 主路径。错误只日志，不阻 tick。

## 数据流

```
合同从 draft→approved（PR-4 时 GAN 循环结束后）
  └─ 下一 tick: advance A_contract→B_task_loop

tick dispatcher 看到 harness_task status=queued
  └─ executor → triggerHarnessTaskDispatch (PR-2) → 容器跑 Generator → PR merged → tasks.status=completed

下一 tick: advance B_task_loop
  ├─ current_task_id.status=completed → 取下一 runnable task → mark queued
  └─ 没有 next 且全部完成 → runPhaseCIfReady → Final E2E → phase=done / failed
```

## 错误处理

| 场景 | 行为 |
|------|------|
| 单 run 查合同/task 失败 | 日志+continue，不影响其他 run |
| `nextRunnableTask` 返回 null 且非全完成 | 跳过；可能 current 还在跑或有 paused/failed（watchdog 处理） |
| `runPhaseCIfReady` 抛错 | 日志，下 tick 重试 |
| tick 重叠 | `updated_at` 窗口过滤（晋级后 5s 内不再进入） |
| 0 个 active run | 快速返回 `{advanced:0, errors:[]}` |

## 测试

`packages/brain/src/__tests__/harness-phase-advancer.test.js`（7 个场景）：

1. A_contract + contract.status='approved' → UPDATE phase='B_task_loop'
2. A_contract + contract.status='draft' → 不动
3. B_task_loop + current_task.status='completed' → 调 nextRunnableTask 拿下一个 → UPDATE current_task_id
4. B_task_loop + current_task.status='running' → 跳过
5. B_task_loop + nextRunnableTask=null + checkAllTasksCompleted.all=true → 调 runPhaseCIfReady
6. B_task_loop + nextRunnableTask=null + all=false → 不动
7. 异常隔离：run[0] 查合同抛 → run[1] 仍正常推进

## 成功标准

- [ ] [BEHAVIOR] A_contract + 合同 approved → 晋级 B_task_loop。Test: packages/brain/src/__tests__/harness-phase-advancer.test.js
- [ ] [BEHAVIOR] B_task_loop 按 DAG 序更新 current_task_id。Test: 同上
- [ ] [BEHAVIOR] 所有子 Task completed → 调 runPhaseCIfReady。Test: 同上
- [ ] [BEHAVIOR] tick.js 在 executeTick 里调 advanceHarnessInitiatives。Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/tick.js','utf8');process.exit(c.includes('advanceHarnessInitiatives')?0:1)"
- [ ] [ARTIFACT] 新文件 `packages/brain/src/harness-phase-advancer.js` 存在

## 回滚

- revert 这个 PR → tick 不再推进，回到 Initiative 卡在 Planner 完成的状态
- PR-1/PR-2 成果不受影响
- 线上 v4 流水线（harness-graph.js）无任何牵连
