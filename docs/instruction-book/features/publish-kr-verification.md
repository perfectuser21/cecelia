# 功能说明：发布 KR 验收操作手册

## KR 定义

| KR | 描述 | 阈值 |
|----|------|------|
| KR1 | 非微信平台近 7 日平均发布成功率 | ≥ 90% |
| KR2 | 微信平台近 7 日平均发布成功率 | ≥ 90% |

## 快速验收命令

```bash
bash scripts/verify-publish-krs.sh
```

- exit 0 = KR1 + KR2 全部达标
- exit 1 = 至少一项未达标，终端输出具体失败原因

## 数据来源

脚本查询 `publish_success_daily` 表（migration 276）。Brain tick 通过 `publish-monitor.js` 的 `writeStats` 每日写入一行快照：

| 字段 | 说明 |
|------|------|
| `platform` | 平台名（`wechat` / `douyin` / `xiaohongshu` …） |
| `date` | 日期（每平台每天唯一） |
| `total` | 当日发布总次数 |
| `completed` | 成功次数 |
| `success_rate` | `completed / total * 100`，精度 0.01% |

KR1 取 `platform != 'wechat'` 近 7 日均值，KR2 取 `platform = 'wechat'` 近 7 日均值。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DB_CONTAINER` | `cecelia-postgres` | PostgreSQL 容器名 |
| `DB_USER` | `cecelia` | 数据库用户 |
| `DB_NAME` | `cecelia` | 数据库名 |

覆盖示例（非标准环境）：

```bash
DB_CONTAINER=my-pg DB_USER=admin bash scripts/verify-publish-krs.sh
```

## 常见问题

### exit 1：KR 未达标

1. 查看报告中哪项 FAIL（KR1 / KR2 / 两者）
2. 检查近 7 日数据是否充足：

```bash
docker exec cecelia-postgres psql -U cecelia -d cecelia -c \
  "SELECT platform, date, total, completed, success_rate
   FROM publish_success_daily
   WHERE date >= CURRENT_DATE - INTERVAL '6 days'
   ORDER BY date DESC, platform;"
```

3. 若 `total = 0`，说明近期无发布记录，不是成功率低而是无数据
4. 若 `success_rate` 低，排查对应平台发布任务的 failed 记录

### exit 1：PostgreSQL 容器未运行

```bash
docker ps | grep cecelia-postgres   # 确认容器状态
docker start cecelia-postgres        # 如未运行则启动
```

### exit 1：缺少依赖（docker / jq / awk）

```bash
which docker jq awk   # 确认三个命令都存在
```

## 核心文件

- `scripts/verify-publish-krs.sh` — 验收脚本
- `packages/brain/src/publish-monitor.js` — 数据写入逻辑
- `packages/brain/migrations/276_publish_success_daily.sql` — 数据表定义
- `packages/brain/migrations/278_kr1_kr2_success_rate_verifier.sql` — KR 验证器辅助表
