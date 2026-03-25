# Learning: Memory Fusion — Claude Code auto-memory ↔ Cecelia 文档系统

## 分支
`cp-03250925-memory-fusion`

## 完成内容

- 新建 `packages/brain/src/memory-sync.js`：扫描 auto-memory 目录，将 project/reference 类型同步到 design_docs，feedback 类型同步到 decisions，每 30 分钟增量运行。
- 新建 `packages/brain/src/scripts/backfill-decisions.js`：解析全局和项目 CLAUDE.md，提取规则条目批量写入 decisions 表。
- 修改 `packages/brain/src/tick.js`：在 10.20 节调用 `memorySyncIfNeeded(pool)`，接入 Brain 调度循环。

## 根本原因

### 两套系统的断层

Claude Code auto-memory 系统和 Cecelia 文档系统（design_docs / decisions）是完全独立的两条轨道。前者是 AI 运行时的记忆文件，后者是 DB 表和 Dashboard 页面。没有任何桥接机制，导致：
- 36 个记忆文件只有 AI 能读，用户在 Dashboard 上看不到
- DecisionRegistry 页面显示空白（10466 条 decisions 均无 category，前端不展示）
- DesignVault 只有 1 条日记

解决方案是构建一个 **memory-sync 桥接层**：定期扫描文件系统，按 frontmatter type 路由到不同 DB 表，保持幂等（title 去重）。

### 幂等设计的必要性

Brain tick 每 2 分钟运行一次，但 memory-sync 应该 30 分钟运行一次，且需要幂等（不重复写入）。采用两层保护：
1. 时间戳节流（`_lastSyncTime`，30 分钟间隔）
2. 数据库 title 查重（`SELECT id WHERE title = $1` 先查再插）

## 下次预防

- [ ] memory-sync 类型映射要随着 memory 文件 frontmatter type 扩展而维护
- [ ] 如果 decisions 表加了 unique constraint on topic，改为 ON CONFLICT DO NOTHING 更优雅
- [ ] backfill-decisions.js 的 CLAUDE.md 解析逻辑是 regex-based，对格式变化敏感，需要维护
