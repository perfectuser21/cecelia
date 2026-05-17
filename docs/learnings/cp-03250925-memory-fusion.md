# Learning: Memory Fusion — Claude Code auto-memory ↔ Cecelia 文档系统

## 分支
`cp-03250925-memory-fusion`

## 完成内容

- 新建 `packages/brain/src/memory-sync.js`：扫描 auto-memory/*.md，project/reference→design_docs，feedback→decisions，每 30 分钟增量同步
- 新建 `packages/brain/src/scripts/backfill-decisions.js`：解析 CLAUDE.md 规则→decisions 表（category='architecture'/'process'）
- 修改 `packages/brain/src/tick.js`：在 10.20 节调用 `memorySyncIfNeeded(pool)`，打通 Claude Code memory ↔ Dashboard 可见文档系统

### 根本原因

Claude Code auto-memory 系统（36 个 memory/*.md 文件）和 Cecelia 文档系统（design_docs / decisions 表）是完全独立的两条轨道，没有任何桥接机制。前者是 AI 运行时的记忆文件，后者是 DB 表和 Dashboard 页面。

导致的直接问题：36 个记忆文件只有 AI 能读，用户在 Dashboard 上看不到；DecisionRegistry 页面显示空白（10466 条 decisions 均无 category，前端不展示）；DesignVault 只有 1 条日记。

解决方案是构建 memory-sync 桥接层：定期扫描文件系统，按 frontmatter type 路由到不同 DB 表，保持幂等（title 去重），每 30 分钟通过 Brain tick 自动运行。

### 下次预防

- [ ] memory-sync 类型映射要随 memory 文件 frontmatter type 扩展而维护
- [ ] 如果 decisions 表加了 unique constraint on topic，改为 ON CONFLICT DO NOTHING 更优雅
- [ ] backfill-decisions.js 的 CLAUDE.md 解析逻辑是 regex-based，对格式变化敏感
- [ ] feat 类 PR 需要配套测试文件，避免 Test Coverage Required 失败
