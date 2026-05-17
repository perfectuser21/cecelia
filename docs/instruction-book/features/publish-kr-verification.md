# 发布 KR 验收操作手册

## KR 定义

| KR | 目标 | 范围 | 阈值 |
|----|------|------|------|
| KR1 | 多平台发布成功率 | 非微信所有平台（近7日） | ≥ 90% |
| KR2 | 微信发布成功率 | 微信平台（近7日） | ≥ 90% |

## 快速验收

```bash
bash scripts/verify-publish-krs.sh
```

- `exit 0` → KR1 + KR2 双达标
- `exit 1` → 至少一项未达标或无数据

## 数据来源

脚本查询 `publish_success_daily` 表，取近 7 日各平台 `success_rate` 均值：

```sql
-- KR1（非微信）
SELECT ROUND(AVG(success_rate), 2)
FROM publish_success_daily
WHERE date >= CURRENT_DATE - INTERVAL '7 days'
  AND platform != 'wechat'
  AND success_rate IS NOT NULL;

-- KR2（微信）
SELECT ROUND(AVG(success_rate), 2)
FROM publish_success_daily
WHERE date >= CURRENT_DATE - INTERVAL '7 days'
  AND platform = 'wechat'
  AND success_rate IS NOT NULL;
```

`success_rate` 由 Brain Tick 每日汇总写入，基于当日 `completed / (completed + failed)` 计算。

## 常见问题

**exit 1：数据为 NULL（⚠️ 提示）**

近7日对应平台无记录。确认 Brain Tick 是否正常运行，或手动检查：

```bash
docker exec cecelia-postgres psql -U cecelia -d cecelia \
  -c "SELECT date, platform, success_rate FROM publish_success_daily ORDER BY date DESC LIMIT 20;"
```

**exit 1：成功率低于 90%**

查看失败原因分布：

```bash
# 通过 Brain API 查询趋势
curl "localhost:5221/api/brain/publish/success-rate?days=7"
```

根据 `failure_type` 分类定位：`api_error`（平台侧）/ `timeout`（网络）/ `content_rejected`（内容审核）。

**PostgreSQL 容器未运行**

```bash
docker start cecelia-postgres
```

**自定义参数**

```bash
DB_CONTAINER=my-pg DB_USER=admin DAYS=14 bash scripts/verify-publish-krs.sh
```
