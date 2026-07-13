# T8: decisions 表 consciousness_loop 去重 + 历史垃圾行清理 — 设计

任务：a980d2ee-b737-47f2-89b7-9fedcbf4cfe9（nine-elements-integrity plan_seq=8）
架构依据：docs/architecture/2026-07-10-nine-elements-integrity/addendum-01-execution-telemetry-and-inbox.md（方案 B 已拍板）

## 问题（生产 DB 取证，2026-07-10）

decisions 表共 96,785 行，其中 96,322 行 topic/decision 均为空：
- trigger='tick' 93,702 行（末次写入 2026-05-04，旧 executeTick 遗留，已停写）
- trigger='consciousness_loop' 2,618 行（仍在活跃灌水，约每 20 分钟一条）
- trigger IS NULL 2 行

根因：`packages/brain/src/decision.js` 的 `generateDecision()` 每次调用无条件 INSERT，
不比对内容。失败任务状态不变时，写入的 actions 完全重复。三个调用方
（tick-runner.js:956 / consciousness.graph.js:60 / routes/execution.js:3249）全走此函数，
因此修在 generateDecision 内部一处即覆盖所有 trigger。

## 修法一：写入去重（generateDecision 内）

INSERT 前查同 trigger 最近一条记录，用 PG jsonb 语义相等比较（避免 JS 侧
JSON.stringify 键序不一致导致去重永不命中）：

```sql
SELECT id, (actions = $2::jsonb AND context = $3::jsonb) AS same
FROM decisions WHERE trigger = $1
ORDER BY created_at DESC LIMIT 1
```

- same=true → 跳过 INSERT，返回上一条 decision_id + `deduped: true`，
  actions/confidence/requires_approval 照常返回（调用方 setGuidance 刷新逻辑不受影响）
- same=false 或无前置记录 → 照常 INSERT
- 并发竞态（两次同时调用各插一条）：量级无害，不加锁

## 修法二：一次性历史清理（migration 330_decisions_blank_cleanup.sql）

```sql
DELETE FROM decisions
WHERE (topic IS NULL OR topic = '')
  AND (decision IS NULL OR decision = '')
  AND (trigger IN ('tick', 'consciousness_loop') OR trigger IS NULL);
```

- trigger 白名单比设计文档原案（只按 topic/decision 空判定）更收紧，与审计到的
  三类来源精确对齐，防止误删未来其他来源的空 topic 行
- 架构文档已审计：topic IS NULL 的行未被任何查询用 topic 做筛选条件，删除安全
- migration 随部署自动执行（约 9.6 万行 DELETE，秒级）

## 强制复核门（主理人 2026-07-10 补充要求，写入 handoff）

migration 写完后、push/merge 前，必须派一个**独立 subagent**（非本 session 主线程）
复核 DELETE 的 WHERE 条件：
1. 用完全相同的 WHERE 跑 SELECT，抽样 ≥10 条待删行，逐条确认是垃圾（无业务内容）
2. 边界检查：topic 空但 decision 非空 / decision 空但 topic 非空 / category 或
   made_by='user' 的行是否会被误删；strategic-decisions API 写的行是否绝对不命中
3. 漏删检查：条件外是否还有同类垃圾残留
复核 PASS 才允许 push（migration 合并即会在部署时执行）。复核结论写入 handoff。

## 测试策略

- **unit（regression test，永久留 CI）**：`packages/brain/src/__tests__/decision-dedup.test.js`
  （vitest，mock pool，仿 decision.test.js 模式）：
  1. 上一条同 trigger 记录 actions+context 相同 → 不执行 INSERT，返回 prev id + deduped
  2. 内容不同 → 照常 INSERT
  3. 无前置记录 → 照常 INSERT
  TDD：commit-1 failing test / commit-2 实现。只跑目标测试文件（brain 全量 vitest 有 OOM 前科）
- **migration**：node 侧读文件断言 SQL 含三重条件（CI 兼容 manual: 格式）
- **部署后手工验证**：清理后垃圾行计数为 0；观察 consciousness_loop 不再每 20 分钟增行

## 不包含

- consciousness_loop 停写 decisions / 改专用表（方案 A 已被否，禁建平行表原则）
- T9 learnings 治理、T10 统一收件箱（独立任务）
- tick-runner.js:956 调用方本身的存废（属 Wave 2 遗留话题，不在本 sprint）
