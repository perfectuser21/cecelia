# Learning: cp-05251149-fix-container-liveness

**任务**：修复 harness pipeline 里 Docker 容器死亡后 Brain 傻等 90 分钟的 bug（B2/B3）
**PR**：fix(brain): detect dead containers in await_callback to avoid 90min timeout

---

### 根本原因

`_waitForSubGraphCompletion` 只轮询 `compiled.getState(config)` 等待 `next=[]`。
当 Docker 容器崩了（exit 非 0）且没有 POST `/api/brain/harness/callback/:containerId` 时：

- **B2**：sub-graph 永久停在 `await_callback` interrupt 状态，`next` 始终是 `['await_callback']`，
  轮询没有终止条件，直到 90min `deadline` 才超时退出。
- **B3**：Brain 重启后 `startup-sync` 用 `resume_from_checkpoint=true` 重新恢复任务，
  LangGraph 从 `await_callback` 中断点恢复，对应容器早已死亡，同样傻等 90min。

两个 bug 的根因相同：轮询循环没有对容器本身的活性进行探测。

---

### 修复方案

在 `_waitForSubGraphCompletion` 的轮询循环里，每 `livenessCheckEveryN`（默认 12）次 poll 做一次活性检查：

1. 从 `state.values.containerId` 获取容器 ID
2. 调用 `docker inspect --format {{.State.Status}} <containerId>`
3. 如果状态是 `exited` / `dead`，或 docker inspect 失败（容器不存在），
   立即通过 `compiled.invoke({ resume: { status: 'failed', error: 'container_exited_without_callback' } }, config)` 唤醒 sub-graph
4. resume 后 getState 拿最新状态返回，不再等 90min

同时将 `_waitForSubGraphCompletion` 从 `async function` 改为 `export async function`，
使单元测试可以直接 import 测试（TDD 强制要求）。

### 关键决策

- 使用动态 `import('execa')` 避免在模块顶层静态 import 破坏现有 mock 模式
- `livenessCheckEveryN` 参数化（默认 12 = 每分钟一次），测试时设为 1（每次 poll 都检查）
- `pollIntervalMs` 同样参数化，测试注入 50ms 避免等待
- resume 失败时只 warn 不抛（sub-graph 可能已经到达 END）

---

### 下次预防

- [ ] 凡有 "等待外部系统回调" 的轮询循环，必须同时设计 "外部系统存活检测" 机制
- [ ] 轮询超时不应是唯一的终止条件，需要主动探活
- [ ] Brain 重启恢复路径（B3）必须测试：restart 后原容器已不存在的场景
- [ ] `_waitForSubGraphCompletion` 等内部函数如果需要单元测试，应 export（命名前缀 `_` 标示 package-private）
- [ ] TDD 铁律：先写 failing test，后写实现，两步各一个 commit

---

### 文件变更

- `packages/brain/src/workflows/harness-initiative.graph.js`：
  - `_waitForSubGraphCompletion` 改为 export + 增加 liveness check 逻辑
  - `_checkContainerLiveness` 新增内部辅助函数
  - `runSubTaskNode` 的 `_waitForSubGraphCompletion` 调用传 `opts.waitOpts`
- `packages/brain/src/__tests__/harness-container-liveness.test.js`：
  - 5 个 TDD 测试用例永久留在 CI
