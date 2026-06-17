# Learning — Harness callback 幂等去重（修 GAN proposer 并发重 spawn）

分支：cp-06110830-harness-callback-dedupe
日期：2026-06-11

## 背景

真实跑 harness pipeline（task ed860936）现场抓到 GAN proposer 节点被并发 spawn 5 个相同 env 容器。

### 根本原因

回调链路是 at-least-once，而 resume 有不可幂等的副作用（spawn 容器），两者叠加无去重保护：
- runner（docker/cecelia-runner/entrypoint.sh）对 harness 回调用 `curl -m 10` + **5 次重试**（backoff 3/6/9/12s）。
- `harness-callback.js` 在 HTTP 请求内**同步 `await compiledGraph.invoke(resume)`**；而 GAN proposer 是阻塞节点（B44，spawn 容器后 await 数分钟）→ HTTP 10s 内无响应 → curl 超时 → runner 重试。
- 回调路由**无幂等**：每次重试都对**同一 thread_id** 发起一次新的并发 resume → 每次跑 proposer 节点 spawn 一个相同 env 的容器。5 次重试 = 5 个并发容器，间隔 ~13-22s，第 5 次后停止。

callback_queue/callback-worker（2s 轮询 + retry）只更新 tasks 表、**不 resume 图**，与本 bug 无关（排除了初始假设）。

### 下次预防

- **at-least-once 投递 + 不可幂等副作用 = 必须去重**。凡是"外部会重试的回调"触发"会 spawn/写副作用"的处理，处理侧必须按稳定键（这里 containerId）做幂等 claim，重复投递直接 ack。
- 长耗时副作用（阻塞节点 resume）不应放在会被 `curl -m 10` 同步等待的 HTTP 处理里——客户端超时必然触发重试风暴。短期用去重挡住；长期应让 resume 异步化（ack 后台跑）。
- Node 单线程下 `Map.has()`→`Map.set()` 之间无 await 即原子，可作并发 check-and-set 锁；但跨进程/重启需 DB claim。

## checklist

- [ ] 外部重试的回调 + 不可幂等副作用 → 处理侧按稳定键幂等去重
- [ ] 长耗时 resume 不放在同步 HTTP 处理里被客户端超时等待
- [ ] 并发 check-and-set 锁的 has/set 之间不得有 await
