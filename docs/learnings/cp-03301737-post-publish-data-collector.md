# Learning: 发布后数据回收 — post-publish-data-collector

**分支**: cp-03301737-32d5c5f1-5c79-489b-b89e-dc1bb2
**日期**: 2026-03-30

---

### 根本原因

Brain 的 publish-monitor.js 只监控发布队列状态，不收集发布后的互动数据（阅读/点赞/播放）。

scraper 脚本虽已存在于 `/perfect21/zenithjoy/workflows/platform-data/workflows/scraper/scripts/`，支持 8 个平台，但与 pipeline 之间没有自动关联触发机制。

发布完成后，数据留在 `zenithjoy.publish_logs.metrics`，无法自动汇总回 Brain 的 `pipeline_publish_stats`，导致数据孤岛无法通过 API 统一查询。

---

### 实现关键决策

1. **Scraper 是 CDP 脚本，不能 require()** — 必须用 `spawn('node', [scraperPath])` fire-and-forget。scraper 依赖远程浏览器（100.97.242.124:19222），Brain tick 只负责触发，不等待完成。

2. **4h 检测用 SQL INTERVAL** — 查询 `completed_at <= NOW() - INTERVAL '4 hours'` 且无 pipeline_publish_stats 记录（LEFT JOIN IS NULL），幂等安全。

3. **DEFINITION.md schema_version 必须同步** — facts-check.mjs 会比对 selfcheck.js 的 EXPECTED_SCHEMA_VERSION 和 DEFINITION.md 中的记录，两者必须一致，否则 facts-check 失败。

4. **DoD GATE 条目需显式断言** — `node -e "require('fs').accessSync(...)"` 不被 check-dod-mapping 识别为断言，必须用 try/catch + process.exit(1) 结构。

5. **tests/ 目录测试从 repo 根运行** — DoD 引用 `tests/` 格式的测试文件，vitest 需从 repo 根目录（不是 packages/brain/）运行才能发现。CI L3 的"feat PR 含测试"检查也通过 `^tests/` 模式匹配。

---

### 下次预防

- [ ] Brain 新增 migration 时，同步更新：selfcheck.js EXPECTED_SCHEMA_VERSION + DEFINITION.md schema_version（facts-check 会验证两处）
- [ ] 新建 Brain 模块后，必须在 tick.js 用 fire-and-forget 模式调用（`Promise.resolve().then(...).catch(...)`）
- [ ] DoD GATE Test 字段始终用 `try{...}catch(e){process.exit(1)}` 结构，不用裸 `accessSync`
