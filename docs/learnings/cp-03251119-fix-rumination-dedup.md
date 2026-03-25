# Learning: P0 Rumination→Desire 死循环修复 — content_hash 去重

## 背景

rumination.js 每次反刍后把洞察写入 suggestions 表，suggestion-dispatcher 消费后触发 Desire 模块创建任务，任务执行完再次触发反刍，形成无限循环。

### 根本原因

rumination.js 写入 suggestions 表时没有任何去重机制。同一洞察文本会被无限次写入，每次写入都触发 suggestion-dispatcher → Desire → 创建新任务 → 再次反刍的循环。去重的关键点在于内容本身，而不是任务状态或时间窗口，因为即使任务完成后，同一洞察在下次反刍时仍会被重新写入，循环重启。内容哈希（SHA256）+ 时间窗口（24h）是最小侵入性的修复方案，无需引入新表，只需在现有 suggestions 表加一列。

### 下次预防

- [ ] 任何向队列/任务表写入的路径，都要先问：「这个内容 24h 内写过吗？」
- [ ] 新增 suggestions 写入点时，必须同时添加 content_hash 检查
- [ ] 自我循环（Self→emit→Self）模式在设计时需要有明确的终止条件或去重屏障

## 修复内容

1. `packages/brain/migrations/191_add_suggestions_content_hash.sql`：添加 `content_hash VARCHAR(64)` 列 + 索引
2. `packages/brain/src/rumination.js`：import crypto，写入前 SHA256 计算 + 24h dedup 查询，重复则跳过
3. `packages/brain/src/selfcheck.js`：`EXPECTED_SCHEMA_VERSION` 从 190 → 191
4. `packages/brain/src/__tests__/rumination-dedup.test.js`：3 个测试（首次写入/重复跳过/24h 外不触发）
