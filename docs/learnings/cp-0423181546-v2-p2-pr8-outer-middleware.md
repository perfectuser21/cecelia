## v2 P2 PR8 外层 spawn-pre + logging Middleware（2026-04-23）

### 根本原因

v2 P2 第 8 PR，建立外层（Koa 洋葱）两个 middleware：`spawn-pre.js` 负责 prompt 文件/cidfile 准备，`logging.js` 负责 spawn 入口/出口统一日志。

关键设计：logging 返回 `{ logStart, logEnd }` 对象（闭包 + startedAt 时间戳），避免把 "started_at" 塞到 opts 造成耦合。spawn-pre 用 fsDeps 注入支持测试不碰真磁盘。两个 middleware 都不接线 executeInDocker，等 attempt-loop 整合 PR。

### 下次预防

- [ ] **logging 要有成本字段预留**：logEnd 已经处理 `result.cost_usd` 字段，但 runDocker 当前不返回 cost_usd（是 Claude API 的责任）。未来接入 Claude callback 时要把 cost 写回 result 对象，这样 logging 能直接消费
- [ ] **spawn-pre 的 fsDeps 注入是必要的**：spawn-pre 写真磁盘，单测不能用真 fs（会泄漏 /tmp 文件）。fsDeps 让测试捕获 write/mkdir/unlink 调用成为纯数据断言
