# PRD — Harness callback 幂等去重（修 GAN proposer 并发重 spawn）

## 背景

真实跑 harness pipeline（task ed860936）现场抓到编排层 P0 bug：GAN proposer 节点被并发 spawn 5 个容器（08:12-08:14，间隔 20-30s，第 5 次后停止），全部 env 相同（同 PROPOSE_ROUND=1 / 同 PROPOSE_BRANCH / 同 workspace mount / 同 .cid），同时处于 Up 状态 = 5 个并发图执行实例。

## 根因（systematic-debugging 确认）

planner 容器跑完后 `docker/cecelia-runner/entrypoint.sh` 用 `curl -m 10` POST 回调到 `/api/brain/harness/callback/:containerId`，**失败重试 5 次**（backoff 3/6/9/12s）。`harness-callback.js` 在 HTTP 请求内**同步 `await compiledGraph.invoke(resume)`**，而 GAN proposer 是阻塞节点（B44，spawn 容器后 await 数分钟）→ 10s 内无响应 → curl 超时 → runner 重试 → 回调路由**无幂等** → 每次重试都对**同一 thread_id** 发起一次新的并发 resume → 每次跑 proposer 节点 spawn 一个相同 env 的容器。5 次重试 = 5 个并发容器，间隔 ~13-22s，第 5 次后停止——与现场完全吻合。callback_queue/callback-worker 路径不 resume 图，排除。

## 范围

`packages/brain/src/routes/harness-callback.js`：每个 containerId 的回调最多 resume 一次（进程内 claim，check-and-set 原子），重复回调（curl 重试 / 并发）直接 200 ack，不再 invoke。

## 成功标准

- 同一 containerId 的回调无论重试/并发多少次，`compiledGraph.invoke` 只被调用一次（= 只 spawn 一个 proposer 容器）。
- 不同 containerId 互不影响，各自正常 resume。
- lookup 失败/404 时释放 claim，后续回调可重试（不被误去重）。
- 既有 harness-callback 行为（200 成功 / 404 无 thread / 500 resume 抛错 / 400 缺 body）全部保持。
