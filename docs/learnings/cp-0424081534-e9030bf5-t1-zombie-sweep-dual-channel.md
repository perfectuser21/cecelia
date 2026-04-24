# T1 zombie-sweep 双通道 safety net Learning

## 做了什么
改 `packages/brain/src/zombie-sweep.js:sweepStaleWorktrees` 加 Channel 2：从 `zombie-cleaner.js` import `findTaskIdForWorktree` + `isWorktreeActive`（已合入 #2572），Channel 1 原 branch match 保留，Channel 2 新增 `.dev-mode*` UUID + mtime 双重短路。

## 根本原因
zombie-sweep 按 `payload->>'branch'` 匹配 in_progress task，但 Brain 多数 task 不塞 branch 字段 → 30-50% orphan worktree 漏检（Phase B2 forensic 发现的第二层 safety net 缺陷）。

## 下次预防
- [ ] 双层 safety net 设计：任一层失效时另一层兜底，避免共用失效 signal
- [ ] 新加 DB 字段类 safety net 要补"字段覆盖率 SQL 监控"（`SELECT COUNT(*) FILTER (WHERE field IS NULL)`）
- [ ] 文件状态类 safety net（.dev-mode mtime）比 DB 字段类更 robust（前者由活跃 session 自动刷新，后者依赖 caller 记得写）

## 关键决策
**跨模块 import zombie-cleaner**：同级模块 import 已有惯例（db.js / event-bus.js），符合现有 pattern。避免 re-impl 避免两份逻辑漂移。
