# 设计：修复 Brain 部署后排空(drain)竞态导致派单停摆约 15 分钟

## 背景
Brain 任务 `30861749`。0929/0930 多次部署后观察到蓝绿切换完成、健康检查通过后，
派单仍暂停约 15 分钟，日志最终打印 `Drain expired at runtime (>15min) — auto-cancelled, resuming dispatch`
才恢复（PR #5668 加的运行期超龄自愈兜底，只是把"永久卡死"降级为"卡 15 分钟"，未修根因）。

## 根因
1. `packages/brain/server.js`：`listenWithRetry()`（约 L695）先让端口开始接受连接，
   `onBrainListening()`（L706 起）之后才异步跑一串 await（`runStartupRecovery`/`cleanupStaleClaims`/
   回调队列初始化…），`initTickLoop()`（tick-recovery.js L847 附近）在这条链的尾部才调用
   `restoreDrainState()` 把旧容器持久化在 `working_memory` 的排空状态读回内存。
2. 部署脚本 `scripts/brain-deploy.sh` 的健康检查只要 `GET /tick/status` 返回 200 即算通过——
   Express 路由在 `listen()` 之后立即可用，不需要等 `onBrainListening()` 跑完，所以健康检查
   几乎必然在 `restoreDrainState()` 执行之前就通过。
3. 健康检查通过后立即调用 `drain_cancel_with_retry()` → `POST /tick/drain-cancel`。此时新容器
   内存里 `_draining` 还是初始值 `false`，`drain.js` 的 `cancelDrain()` 命中
   `if (!_draining) return { success:true, was_draining:false }` 短路，**不清库**（`clearPersistedDrainState()`
   被跳过），HTTP 层面看是"成功"，实际是 no-op。
4. 随后 `restoreDrainState()` 才执行，读到步骤 3 没被清掉的旧持久化行（age < 15min），
   把它当"刚发生的排空"恢复进内存，`_draining=true`。此后再无主动 cancel 路径，只能等
   `isDraining()` 里的 15 分钟运行期超龄自愈（PR #5668）自己解除。

仓库里已有同类问题的先例修法：`reconcileOwnerlessKernelRuns()`（server.js L685-693，注释
"在 listener 接受任何请求前先 fail-closed 收敛"）就是把"必须在端口开放前完成的状态收敛"
挪到 `listenWithRetry()` 之前，本次沿用同一模式。

## 修法（对应下方方案 C）

1. **`packages/brain/src/drain.js`**：`cancelDrain()` 去掉 `if (!_draining) return` 短路，
   改为无条件重置内存 + 无条件 `clearPersistedDrainState()`，只在原本就是 draining 时打印
   "cancelled" 日志、返回 `was_draining` 区分。这是纵深防御：无论何时调用，`cancelDrain()`
   都保证持久化状态和内存态一致。
2. **`packages/brain/server.js`**：把 `restoreDrainState()` 的调用挪到 `listenWithRetry()`
   之前（紧邻 `reconcileOwnerlessKernelRuns()` 之后），确保端口开放前排空状态已经从 DB
   恢复完毕——部署脚本的健康检查和 drain-cancel 请求到达时，新容器的 `_draining` 已经是
   历史真实值，不会再有"新容器还没来得及恢复状态"的窗口。
3. **`packages/brain/src/tick-recovery.js`**：删除 `initTickLoop()` 里重复的
   `restoreDrainState()` 调用（现在由 server.js 统一在监听前调用一次），避免出现"启动链
   里调用两次 restore"的新竞态（例如：pre-listen 恢复完成、健康检查通过、cancel 已经清库，
   紧接着 initTickLoop 里第二次 restore 又读到一个此时已经不存在/正确为空的行——理论上无害，
   但没有必要保留两个调用点增加认知负担和潜在时序假设）。

## 测试策略
- **Unit（drain.js）**：直接调用 `drainTick()`（模拟旧容器持久化排空）→ `_resetDrainState()`
  （模拟新容器内存从零启动，但不碰 DB，模拟"restore 还没跑"）→ `cancelDrain()`（模拟部署脚本
  过早发来的 drain-cancel）→ `restoreDrainState()`（模拟随后才跑的 restore）→ 断言
  `isDraining() === false`。这是失败测试：当前代码在这个时序下最终结果为 `true`，说明 bug 复现。
- 修复 `cancelDrain()` 后该 unit test 应变绿（验证纵深防御本身就足以堵住这个具体时序）。
- server.js/tick-recovery.js 的顺序调整属于启动时序改动，没有独立可测的行为分支（现有
  `restoreDrainState` 单元测试已覆盖其自身逻辑），不新增集成测试，靠现有 selfcheck/CI
  smoke 覆盖启动不崩溃。
- 不做 E2E（无法在 CI 里真实复现"部署时序竞态"），regression test 是逻辑接缝测试，按
  CLAUDE.md 哨兵规矩归为"逻辑接缝→CI test 就够"档位。

## 验收标准
- [ ] `packages/brain/src/__tests__/drain.test.js` 新增失败测试先 commit（复现竞态）
- [ ] 三处代码修改后该测试变绿
- [ ] 已有 drain.test.js / tick 相关测试不回归
- [ ] CI 全绿，PR 合并
- [ ] 部署一次，切换完成后 ≤2 分钟内出现派单（生产复测）
