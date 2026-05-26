## Sprint B — Brain-first walking-skeleton + 异步 Notion 推送（2026-05-22）

### 根本原因

Walking-skeleton 脚本（init-journey / add-feature / thicken / notion-create-issue）原先直接调 Notion API，导致：
1. 写入顺序不可控：Notion 写失败 → DB 没有记录，两边不一致
2. Notion 凭据耦合到 CLI 脚本，每次调用都需要 NOTION_API_KEY
3. 无离线写入能力：Notion API 不通则无法登记 Journey/Feature

根因：架构未决策"谁是 single source of truth"，导致两头都在写。

### 下次预防

- [ ] **Brain DB 优先原则**：所有写入先落 Brain DB（`notion_synced_at=NULL`），Notion 只读展示；Brain tick 异步推送，推成功后设 `notion_synced_at=NOW()`
- [ ] **DB schema 检查 direction CHECK**：`notion_sync_log.direction` 的 CHECK 约束只允许 `'from_notion'`, `'to_notion'`, `'both'`，不含 `'push'`；写 notion-push-sync.js 前必须查 schema（避免 W22 类 constraint violation）
- [ ] **tick 架构感知**：`executeTick`（tick-runner.js）已 DEPRECATED，活跃调度在 tick-scheduler.js（< 500ms 约束）；Notion 推送这类 I/O 密集型操作不能进 tick，应走 server.js `setInterval`
- [ ] **arg parser 统一**：多脚本复制 `i += 2` 简陋解析器时，漏值场景（`--flag` 后无值）会静默错误；应统一用 `parseArgs` 带 `!argv[i+1].startsWith('--')` 检查
- [ ] **vitest mock 路径**：`vi.mock('../db.js', () => ({ default: { query: mockQuery } }))` 需要 default export 包装；测试文件里 `mockResolvedValueOnce` 调用数量必须精确匹配实际的 `pool.query` 调用次数（条件跳过的查询不消耗 mock）

### 架构决策（永久存档）

Sprint B 确立了 Brain-first 写入协议：

```
写入路径：CLI → Brain API → PostgreSQL（notion_synced_at=NULL）
推送路径：server.js setInterval 5min → notion-push-sync.js → Notion API → UPDATE notion_synced_at=NOW()
```

Walking-skeleton CLI 脚本（外置于 git repo，在 ~/.claude/skills/）直接调 Brain API，不再接触 Notion。
