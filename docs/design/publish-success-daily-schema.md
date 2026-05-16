# publish_success_daily 历史趋势表设计文档

> **调研日期**: 2026-05-16
> **Migration 编号**: 276
> **状态**: 已实现（migration 276 已合并到 main）

---

## 背景

Brain tick（每 5 分钟执行一次）通过 `publish-monitor.js` 的 `monitorPublishQueue()` 监控发布队列。该函数：

1. 自动重试失败任务（带退避、failure_type 分类）
2. 统计今日发布状态，写入 `working_memory` key=`daily_publish_stats`（实时缓存）
3. 按平台 upsert `publish_success_daily`（历史趋势持久化）

---

## working_memory.daily_publish_stats 结构

**表定义**（`000_base_schema.sql`）：

```sql
CREATE TABLE IF NOT EXISTS working_memory (
    key        text    NOT NULL PRIMARY KEY,
    value_json jsonb,
    updated_at timestamp without time zone DEFAULT now()
);
```

**写入方式**：每 tick 通过 `ON CONFLICT (key) DO UPDATE` 幂等 upsert。

**key = 'daily_publish_stats' 的 value_json 结构**：

```json
{
  "queued":       4,
  "in_progress":  2,
  "completed":   18,
  "failed":       1,
  "total":       25,
  "success_rate": 94,
  "coverage":     3,
  "platforms": {
    "wechat":    { "queued": 1, "in_progress": 0, "completed": 8, "failed": 0 },
    "xiaohongshu": { "queued": 2, "in_progress": 1, "completed": 6, "failed": 1 },
    "douyin":    { "queued": 1, "in_progress": 1, "completed": 4, "failed": 0 }
  },
  "date": "2026-05-16"
}
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `queued` | number | 待发布任务数 |
| `in_progress` | number | 发布中任务数 |
| `completed` | number | 今日成功完成数 |
| `failed` | number | 今日失败数（已达最大重试） |
| `total` | number | 今日全部任务数（四种状态之和） |
| `success_rate` | number \| null | completed / (completed+failed) × 100，无任务时为 null |
| `coverage` | number | 至少有 1 个 completed 的平台数 |
| `platforms` | object | 按平台细分的四种状态计数 |
| `date` | string | ISO 日期字符串（YYYY-MM-DD） |

**来源**（`fetchTodayStats`，`publish-monitor.js:203`）：

```sql
SELECT
  status,
  payload->>'platform' AS platform,
  COUNT(*) AS cnt
FROM tasks
WHERE task_type = 'content_publish'
  AND DATE(created_at AT TIME ZONE 'UTC') = CURRENT_DATE
GROUP BY status, payload->>'platform'
```

---

## publish_success_daily 表 Schema

**Migration 编号**: `276`
**文件**: `packages/brain/migrations/276_publish_success_daily.sql`

```sql
CREATE TABLE IF NOT EXISTS publish_success_daily (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  platform     VARCHAR(64) NOT NULL,
  date         DATE        NOT NULL,
  total        INT         NOT NULL DEFAULT 0,
  completed    INT         NOT NULL DEFAULT 0,
  failed       INT         NOT NULL DEFAULT 0,
  success_rate NUMERIC(5,2),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_publish_success_daily_platform_date UNIQUE (platform, date)
);

-- 按日期降序查趋势（主查询路径）
CREATE INDEX IF NOT EXISTS idx_publish_success_daily_date
  ON publish_success_daily(date DESC);

-- 按平台过滤
CREATE INDEX IF NOT EXISTS idx_publish_success_daily_platform
  ON publish_success_daily(platform, date DESC);
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键，自动生成 |
| `platform` | VARCHAR(64) | 平台名称（wechat / douyin / xiaohongshu 等） |
| `date` | DATE | 统计日期（UTC），精度到天 |
| `total` | INT | 当天该平台全部任务数（不含 queued/in_progress 末日快照以外） |
| `completed` | INT | 当天成功完成数 |
| `failed` | INT | 当天最终失败数 |
| `success_rate` | NUMERIC(5,2) | completed/(completed+failed)×100，精度 0.01%，值域 [0, 100] |
| `created_at` | TIMESTAMPTZ | 行首次创建时间（upsert 时不更新） |

### 设计决策

1. **`(platform, date)` UNIQUE** — 每平台每天一行，幂等 upsert，避免重复。
2. **`success_rate NUMERIC(5,2)`** — 精度到 0.01%，值域 [0, 100.00]，NULL 表示当天无任何已结束任务。
3. **`total` 的含义** — writeStats 中 total = queued + in_progress + completed + failed，是当天所有状态的瞬时快照，tick 每次覆写。
4. **不存 `queued`/`in_progress`** — 趋势表关注最终结果，过程状态意义不大；需要实时数据读 working_memory 即可。

---

## 写入时机分析

### 当前实现：tick 每次写入（选择原因）

`writeStats` 由 `monitorPublishQueue` 每 tick（约每 5 分钟）调用一次：

```
Brain tick (5min) → monitorPublishQueue() → fetchTodayStats() → writeStats()
                                                                    ↓
                                         working_memory (upsert) + publish_success_daily (upsert)
```

**优点**：
- 数据实时性高，同一天的趋势图可以看到进度变化
- 无需额外定时器，逻辑简单
- upsert 保证幂等，tick 失败不丢数据

**缺点（已接受）**：
- 当天的 `total` / `success_rate` 在任务还在进行中时是中间状态，不是"最终日结"值
- 若当天 23:59 还有任务在 in_progress，次日 0:01 的数字会突变（任务归属到新的一天）

### 备选方案：每日收尾写入（未采用）

可在每天 23:55 用 cron 触发一次 `writeStats`，确保当天所有任务结束后再落快照。

**问题**：
- 需要额外 cron 逻辑，增加复杂度
- Brain 若在深夜宕机，会丢失当天数据
- 对于长任务（跨天），归属日期仍有歧义

**结论**：tick 每次写入是正确选择，趋势图展示时应标注"实时快照"而非"最终日结"。

---

## 趋势查询示例

### 最近 7 天全局成功率

```sql
SELECT
  date,
  SUM(completed)    AS total_completed,
  SUM(failed)       AS total_failed,
  SUM(total)        AS total_tasks,
  ROUND(
    SUM(completed)::numeric /
    NULLIF(SUM(completed) + SUM(failed), 0) * 100,
    2
  )                 AS overall_success_rate
FROM publish_success_daily
WHERE date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY date
ORDER BY date DESC;
```

### 按平台最近 30 天成功率趋势

```sql
SELECT
  platform,
  date,
  completed,
  failed,
  success_rate
FROM publish_success_daily
WHERE date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY platform, date DESC;
```

### 单平台历史最低成功率（定位异常日期）

```sql
SELECT date, success_rate, total, completed, failed
FROM publish_success_daily
WHERE platform = 'wechat'
  AND success_rate IS NOT NULL
ORDER BY success_rate ASC
LIMIT 10;
```

---

## 关键代码位置

| 作用 | 文件 | 行号 |
|------|------|------|
| 表定义 | `packages/brain/migrations/276_publish_success_daily.sql` | — |
| working_memory 表定义 | `packages/brain/migrations/000_base_schema.sql` | 145-150 |
| fetchTodayStats（数据来源） | `packages/brain/src/publish-monitor.js` | 203-238 |
| writeStats（写入逻辑） | `packages/brain/src/publish-monitor.js` | 246-282 |
| 主调度入口 | `packages/brain/src/tick-runner.js` | ≈1621 |
| 读取 API | `packages/brain/src/routes/publish-jobs.js` | ≈130 |
