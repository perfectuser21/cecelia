## Migration 版本号冲突导致字段静默缺失（2026-03-12）

### 根本原因

两个 migration 文件争抢同一个版本号（145）时，migrate.js 以 schema_version 表为准——先写入的赢，后写入的永远被跳过。表面上该版本"已应用"，实际上字段从没建。问题不会有任何错误提示，直到代码引用该字段才爆炸：`column "quota_exhausted_at" does not exist`，导致 execution-callback 全部失败 → 任务结果全丢 → Brain degraded。

### 下次预防

- [ ] 新建 migration 前，先确认序号无冲突（`SELECT version FROM schema_version ORDER BY version::int DESC LIMIT 5`）
- [ ] facts-check.mjs 的 `selfcheck_version_sync` 可检测版本冲突，CI 报 L2 失败时优先排查 migration 序号
- [ ] 发现字段缺失时，对比 schema_version 表里该版本的 description 与文件内容——description 对不上即版本号冲突，新建更高序号的 migration 补建
