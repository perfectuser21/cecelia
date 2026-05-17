# Learning: 内容流水线竞态 + 误重置三 Bug 根因

## 根本原因

### 竞态（Race Condition）
PR #1888 修复 `content-export` 竞态时，只在 `selectNextDispatchableTask` 里加了
`AND t.task_type != 'content-export'`，但遗漏了其余 5 种阶段：
`content-research / content-copywriting / content-copy-review / content-generate / content-image-review`。
这导致 tick dispatch 和本地 `executeQueuedContentTasks` 同时处理同一子任务，
一路成功一路失败，Pipeline 进入不一致状态。

### 误重置（Ghost Reset）
`restartStuckExecutors`（healing.js）扫描 `status='in_progress' AND updated_at < 30min`
的任务，凡无 PID 记录者直接重置为 `queued`。
`content-pipeline` 父任务由内部编排（无 OS 进程），`updated_at` 在子任务执行期间不更新，
触发误重置 → `orchestrateContentPipelines` 重新编排 → 死循环。

### 时间戳缺失
`_markPipelineFailed` 的 UPDATE 只写 `status / completed_at / error_message`，
不写 `updated_at`，导致 pipeline 任务 `completed_at > updated_at`，
且下次 healing 扫描时仍可能被误判。

## 下次预防

- [ ] 凡新增 pipeline stage 类型，必须同步更新 `selectNextDispatchableTask` 的 NOT IN 列表
- [ ] `restartStuckExecutors` 对内部编排任务（无 PID 设计）应加 task_type 排除，而不是依赖 PID 判断
- [ ] `_markPipelineFailed` / 所有 pipeline 终态写入都应包含 `updated_at = NOW()`
