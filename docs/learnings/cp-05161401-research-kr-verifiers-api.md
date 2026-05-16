# 验收脚本设计文档：kr_verifiers + PATCH KR API + publish_success_daily

> 调研日期：2026-05-16
> 分支：cp-05161401-research-kr-verifiers-api
> 目标：确认 ZenithJoy KR 验收脚本的数据来源和写入路径

---

## 1. kr_verifiers 表结构

**迁移文件**：`packages/brain/migrations/170_kr_verifiers.sql`

```sql
CREATE TABLE IF NOT EXISTS kr_verifiers (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kr_id                  UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  verifier_type          VARCHAR(20) NOT NULL DEFAULT 'sql',
  query                  TEXT NOT NULL,
  metric_field           VARCHAR(100) DEFAULT 'count',
  threshold              NUMERIC NOT NULL,
  operator               VARCHAR(5) NOT NULL DEFAULT '>=',
  current_value          NUMERIC DEFAULT 0,
  last_checked           TIMESTAMP WITH TIME ZONE,
  last_error             TEXT,
  check_interval_minutes INTEGER DEFAULT 60,
  enabled                BOOLEAN DEFAULT true,
  created_at             TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at             TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### ZenithJoy KR 的 verifier 配置

来源：`packages/brain/migrations/223_kr_verifiers_active_krs.sql`

#### KR d86f67df — AI自媒体线（4条内容/天）

```sql
-- kr_id: d86f67df-04c8-47dc-922f-c0e4fd0645bb
-- KR 描述: AI自媒体线跑通 — 4条内容/天，多平台发布成功率≥90%

SELECT
  id,
  kr_id,
  query,
  threshold
FROM kr_verifiers
WHERE kr_id = 'd86f67df-04c8-47dc-922f-c0e4fd0645bb';

-- 预期结果：
-- query     = SELECT ROUND(COUNT(*)::numeric / 7) as count FROM tasks
--             WHERE task_type = 'content-pipeline' AND status = 'completed'
--             AND completed_at > NOW() - INTERVAL '7 days'
-- threshold = 4
-- operator  = >=
```

**当前验收逻辑**：计算过去 7 天内 `content-pipeline` 类型完成任务总数 ÷ 7，目标 ≥ 4 条/天。

#### KR f19118cd — AI私域线（4条私域内容/天）

```sql
-- kr_id: f19118cd-c4fe-478d-abf5-00bde5566a05
-- KR 描述: AI私域线跑通 — 4条私域内容/天，微信发布成功率≥90%

SELECT
  id,
  kr_id,
  query,
  threshold
FROM kr_verifiers
WHERE kr_id = 'f19118cd-c4fe-478d-abf5-00bde5566a05';

-- 预期结果：
-- query     = SELECT ROUND(COUNT(*)::numeric / 7) as count FROM tasks
--             WHERE task_type = 'content_publish' AND status = 'completed'
--             AND completed_at > NOW() - INTERVAL '7 days'
-- threshold = 4
-- operator  = >=
```

**当前验收逻辑**：计算过去 7 天内 `content_publish` 类型完成任务总数 ÷ 7，目标 ≥ 4 条/天。

---

## 2. PATCH /api/brain/key-results/:id

**路由文件**：`packages/brain/src/routes/okr-hierarchy.js`（第 108-138 行）

### 端点签名

```
PATCH /api/brain/key-results/:id
Content-Type: application/json
```

### 接受字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `current_value` | NUMERIC(12,2) | **KR 当前进度值（验收脚本写入目标字段）** |
| `target_value` | NUMERIC(12,2) | KR 目标值 |
| `status` | VARCHAR(50) | KR 状态 |
| `title` | TEXT | KR 标题 |
| `unit` | VARCHAR(50) | 单位 |
| `metadata` | JSONB | 元数据 |
| `objective_id` | UUID | 所属 Objective |

### curl 调用示例

```bash
# 回写 KR d86f67df 的 current_value
curl -X PATCH http://localhost:5221/api/brain/key-results/d86f67df-04c8-47dc-922f-c0e4fd0645bb \
  -H "Content-Type: application/json" \
  -d '{"current_value": 4.5}'

# 预期响应
# {"success": true, "item": {"id": "d86f67df-...", "current_value": "4.50", ...}}
```

### exit 条件

| 响应 | 含义 |
|------|------|
| `{"success": true}` | 写入成功，exit 0 |
| `{"success": false, "error": "Not found"}` | KR ID 不存在，exit 1 |
| HTTP 500 | DB 错误，exit 2 |

---

## 3. publish_success_daily 表

**迁移文件**：`packages/brain/migrations/276_publish_success_daily.sql`

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
```

**写入者**：Brain tick → `publish-monitor.js` → writeStats()（每 tick 幂等 UPSERT）

**可用性结论**：
- `publish_success_daily` 是 I2（发布线）的直接产出物
- 对于 KR d86f67df "多平台发布成功率≥90%" 的验收，应使用此表
- 对于 KR f19118cd "微信发布成功率≥90%" 的验收，使用 `WHERE platform = 'wechat'`

---

## 4. 7 日成功率计算公式

### 全平台汇总（对应 KR d86f67df）

```sql
SELECT
  ROUND(
    SUM(completed)::numeric / GREATEST(SUM(total), 1) * 100,
    2
  ) AS success_rate_7d
FROM publish_success_daily
WHERE date >= CURRENT_DATE - 6;
-- CURRENT_DATE - 6 = 过去7天（含今天）
```

### 单平台（对应 KR f19118cd — 微信）

```sql
SELECT
  ROUND(
    SUM(completed)::numeric / GREATEST(SUM(total), 1) * 100,
    2
  ) AS success_rate_7d
FROM publish_success_daily
WHERE platform = 'wechat'
  AND date >= CURRENT_DATE - 6;
```

### 等效公式验证

```
success_rate_7d = SUM(completed) / (SUM(completed) + SUM(failed)) × 100
               WHERE date >= NOW() - 7
```

> 注意：上方公式等价（因为 total = completed + failed）。
> 代码中采用 `SUM(completed) / SUM(total)` 形式，避免 total 不等于 completed+failed 时的偏差。

---

## 5. 验收脚本设计

### 结构

```bash
#!/bin/bash
# kr-verifier-acceptance.sh
# 功能：查询 publish_success_daily 7日成功率，若达标则 PATCH KR current_value

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

# --- KR d86f67df: 多平台发布成功率 ≥ 90% ---
SUCCESS_RATE=$(psql "$DATABASE_URL" -t -c "
  SELECT ROUND(SUM(completed)::numeric / GREATEST(SUM(total),1) * 100, 2)
  FROM publish_success_daily
  WHERE date >= CURRENT_DATE - 6
" | xargs)

if (( $(echo "$SUCCESS_RATE >= 90" | bc -l) )); then
  curl -s -X PATCH "${BRAIN_URL}/api/brain/key-results/d86f67df-04c8-47dc-922f-c0e4fd0645bb" \
    -H "Content-Type: application/json" \
    -d "{\"current_value\": ${SUCCESS_RATE}}" \
    | grep -q '"success":true' && echo "✅ KR d86f67df 回写成功: ${SUCCESS_RATE}%" || exit 1
else
  echo "⚠️  成功率 ${SUCCESS_RATE}% 未达阈值 90%，不回写"
  exit 0
fi

# --- KR f19118cd: 微信发布成功率 ≥ 90% ---
WECHAT_RATE=$(psql "$DATABASE_URL" -t -c "
  SELECT ROUND(SUM(completed)::numeric / GREATEST(SUM(total),1) * 100, 2)
  FROM publish_success_daily
  WHERE platform = 'wechat'
    AND date >= CURRENT_DATE - 6
" | xargs)

if (( $(echo "$WECHAT_RATE >= 90" | bc -l) )); then
  curl -s -X PATCH "${BRAIN_URL}/api/brain/key-results/f19118cd-c4fe-478d-abf5-00bde5566a05" \
    -H "Content-Type: application/json" \
    -d "{\"current_value\": ${WECHAT_RATE}}" \
    | grep -q '"success":true' && echo "✅ KR f19118cd 回写成功: ${WECHAT_RATE}%" || exit 1
else
  echo "⚠️  微信成功率 ${WECHAT_RATE}% 未达阈值 90%，不回写"
  exit 0
fi
```

### exit 条件

| 条件 | exit |
|------|------|
| 成功率 ≥ 90% 且 PATCH 成功 | 0 |
| 成功率 < 90%（未达标，正常） | 0 |
| PATCH API 返回非 success | 1 |
| DB 查询失败 | 2 |

---

## 6. 结论

| 问题 | 答案 |
|------|------|
| kr_verifiers 当前数据源 | `tasks` 表（计量内容产出量） |
| 发布成功率数据源 | `publish_success_daily` 表（Brain tick 写入） |
| PATCH API 接受 current_value？ | ✅ 是，NUMERIC(12,2) |
| 7日公式 | `SUM(completed)/SUM(total)*100 WHERE date >= CURRENT_DATE-6` |
| 需要新增 verifier？ | 建议：为"成功率≥90%"维度新增独立 kr_verifier，当前配置只验证"4条/天"数量维度 |
