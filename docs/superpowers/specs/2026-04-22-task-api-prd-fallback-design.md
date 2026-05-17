# POST /api/brain/tasks 接受 prd 字段 + 清 pre-flight 存量

日期：2026-04-22
分支：cp-0422004540-task-api-prd-fallback（实际由 worktree-manage 生成）
Brain Task：fc6930db-6980-4763-b628-a3aed754d181

## 问题

Brain 持续每分钟 1-2 条飞书推送 `P0 pre_flight_burst: 24h 内 21 个任务被 pre-flight 拒绝`。根因：

1. `POST /api/brain/tasks` 的 handler（`packages/brain/src/routes/task-tasks.js:50-56`）只有 2 层 fallback：`description` + `payload.prd_summary`，**缺 `prd` 字段**
2. 上游（手工 curl / Agent / 脚本）传 `{title, prd}` → `prd` 被 destructure 丢弃 → description=null → pre-flight 拒 → `metadata.pre_flight_failed=true`
3. 24h 累积 ≥ 3 次 → P0 告警（阈值见 `pre-flight-check.js:187`）
4. Brain 重启 `_p0RateLimit` in-memory Map 清零 → 每次重启立刻再发一条

存量数据（实测）：
- 累计 151 条 `metadata->>'pre_flight_failed' = 'true'`
- 24h 内 21 条（当前触发 P0 的那 21 个）
- task_type 分布：dev 10 / arch_review 6 / platform_scraper 4 / research 1

## 方案

### 1. task-tasks.js 加 prd 字段 fallback

`packages/brain/src/routes/task-tasks.js`：

- destructure 加 `prd` 字段
- C2 normalize 段（L50-56）fallback 链从 2 层扩成 3 层：
  ```
  description || payload?.prd_summary || prd
  ```

代码样板（按实际文件结构调整）：

```js
// destructure
const { title, description, prd, priority, task_type, payload, metadata, ... } = req.body;

// C2 段
let effectiveDescription = description;
if (!effectiveDescription && payload?.prd_summary) {
  effectiveDescription = payload.prd_summary;
}
if (!effectiveDescription && prd) {
  effectiveDescription = prd;
}
// 后续 INSERT 用 effectiveDescription 替代 description
```

**优先级明确**：`description` > `payload.prd_summary` > `prd`。如果 caller 显式传 description，就尊重它；只在 description 缺失时才 fallback。

### 2. Migration 243 清存量

新建 `packages/brain/migrations/243_clear_pre_flight_rejected_backlog.sql`：

```sql
-- 清理 pre_flight_failed 标记，让 alertOnPreFlightFail 的 24h COUNT 降到 0
-- 只移除 metadata 标记，保留 task 原状态 + title + description（审计痕迹保留）
UPDATE tasks
SET metadata = metadata - 'pre_flight_failed' - 'failed_at'
WHERE metadata->>'pre_flight_failed' = 'true';
```

幂等：已经没 pre_flight_failed 的 task 不受影响（WHERE 过滤）。不改 status / title / description——这些字段留着审计。

### 3. 单测

`packages/brain/src/__tests__/task-api-prd-fallback.test.js` 新建：

3 场景：

| # | Request body | 期望 DB 里 description |
|---|---|---|
| 1 | `{title, prd: "长≥20字符的 PRD"}` | = prd 内容 |
| 2 | `{title, description: "X", prd: "Y"}` | = "X"（description 优先） |
| 3 | `{title, payload: {prd_summary: "Z"}}` | = "Z"（原 fallback 无回归） |

mock pool 捕获 INSERT 的 $2 参数（description 位置）。

## 变更清单

| 文件 | 动作 |
|---|---|
| `packages/brain/src/routes/task-tasks.js` | Modify（destructure + fallback 链，~5 行） |
| `packages/brain/migrations/243_clear_pre_flight_rejected_backlog.sql` | Create（幂等清 metadata 标记） |
| `packages/brain/src/__tests__/task-api-prd-fallback.test.js` | Create（3 场景）|
| `.dod` + Learning | Create |

## 不做

- 不改 `pre-flight-check.js`（校验规则保留，让它继续挡 description 空的任务）
- 不改 `alerting.js` 的 P0 in-memory 限流（另一个独立 PR，现在用 BRAIN_MUTED 挡住够用）
- 不改 arch-review 源头（PR #2509 已堵 payload.prd_summary）
- 不改已合并 task 的 status / title / description（只清 metadata 标记）
- 不动 Brain task 的任何其他 handler

## 成功标准

- [ARTIFACT] task-tasks.js POST handler 含 prd 字段 fallback
- [ARTIFACT] migration 243 新文件
- [BEHAVIOR] 3 单测全绿
- [BEHAVIOR] 跑 migration 243 后 `SELECT COUNT(*) FROM tasks WHERE metadata->>'pre_flight_failed' = 'true'` = 0
- [BEHAVIOR] 现有 task-tasks 相关单测（若存在）无回归

## 验证

本地手工：
```bash
# 1. 跑测试
npx vitest run packages/brain/src/__tests__/task-api-prd-fallback.test.js

# 2. 跑 migration
psql cecelia -f packages/brain/migrations/243_clear_pre_flight_rejected_backlog.sql

# 3. 确认 COUNT=0
psql cecelia -c "SELECT COUNT(*) FROM tasks WHERE metadata->>'pre_flight_failed' = 'true';"

# 4. smoke：curl POST 带 prd 字段
curl -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" \
  -d '{"title":"smoke-test","task_type":"dev","priority":"P2","prd":"这是测试 prd 字段 fallback 是否生效的验证任务。"}'
# → 响应 201 + 查 DB 该 task description 不为空
```
