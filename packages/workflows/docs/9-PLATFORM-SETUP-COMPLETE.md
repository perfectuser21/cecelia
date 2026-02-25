---
id: 9-platform-setup-complete
version: 1.0.0
created: 2026-01-27
updated: 2026-01-27
changelog:
  - 1.0.0: 9平台配置完成
---

# 9平台数据采集系统 - 配置完成

**配置时间**: 2026-01-27 17:40
**状态**: ✅ 配置完成，待CDP连接恢复后可运行

## ✅ 已完成的配置

### 1. 数据库架构 (完成)

**表结构更新**:
```sql
-- content_master 表
- ✅ 添加 account_id VARCHAR(50)
- ✅ 添加 account_name VARCHAR(50)
- ✅ 唯一约束: (platform, title, publish_time, COALESCE(account_id, ''))
- ✅ 索引: idx_content_master_platform_account

-- 今日头条数据迁移
- ✅ 205条数据标记为 account_id='main', account_name='大号'
```

**30天跟踪系统**:
- ✅ content_master (作品主表)
- ✅ content_snapshots (每日快照)
- ✅ 自动过期标记
- ✅ Delta计算触发器

### 2. Scraper配置 (完成)

**文件**: `/home/xx/platform-scraper-v8-raw.js`

**9个平台配置**:
```javascript
const PLATFORM_CONFIG = {
  'douyin': {
    port: 19222,
    name: '抖音'
  },
  'kuaishou': {
    port: 19223,
    name: '快手'
  },
  'xiaohongshu': {
    port: 19224,
    name: '小红书'
  },
  'toutiao': {
    port: 19225,
    name: '今日头条',
    accountId: 'main',
    accountName: '大号'
  },
  'toutiao_minor': {                    // ⭐ 新增
    port: 19226,
    name: '今日头条',
    accountId: 'minor',
    accountName: '小号'
  },
  'weibo': {
    port: 19227,
    name: '微博'
  },
  'channels': {
    port: 19228,
    name: '视频号'
  },
  'zhihu': {                            // ⭐ 新增
    port: 19229,
    name: '知乎',
    url: 'https://www.zhihu.com/creator'
  },
  'wechat_official': {                  // ⭐ 新增
    port: 19230,
    name: '公众号',
    url: 'https://mp.weixin.qq.com/'
  }
};
```

**Metadata增强**:
```javascript
metadata: JSON.stringify({
  browser_port: config.port,
  text_length: rawText.length,
  account_id: config.accountId || null,    // ⭐ 新增
  account_name: config.accountName || null  // ⭐ 新增
})
```

### 3. 数据处理器 (完成)

**文件**: `/home/xx/process-raw-data-v2.js`

**Account支持**:
```javascript
// 提取 account_id
const metadata = typeof rawData.metadata === 'string'
  ? JSON.parse(rawData.metadata)
  : (rawData.metadata || {});
const accountId = metadata.account_id || null;
const accountName = metadata.account_name || null;

// 插入时包含账号信息
INSERT INTO content_master (
  platform, title, publish_time, content_type_normalized,
  account_id, account_name, first_seen_at        // ⭐ 新增
) VALUES ($1, $2, $3, $4, $5, $6, NOW())
```

**唯一性约束**:
```javascript
ON CONFLICT (platform, title, publish_time, COALESCE(account_id, ''))
```

### 4. 采集脚本 (完成)

**文件**: `/home/xx/scrape-all-9-platforms.sh`

```bash
#!/bin/bash
# 采集所有9个平台

PLATFORMS=(
  douyin
  kuaishou
  xiaohongshu
  toutiao
  toutiao_minor     # ⭐ 新增
  weibo
  channels
  zhihu             # ⭐ 新增
  wechat_official   # ⭐ 新增
)

for platform in "${PLATFORMS[@]}"; do
  node /home/xx/platform-scraper-v8-raw.js "$platform"
done

# 处理原始数据
node /home/xx/process-raw-data-v2.js
```

## 📊 当前数据库状态

### 平台统计

| 平台 | 总内容 | 活跃跟踪(30天) | 账号 | 最新发布 |
|------|--------|---------------|------|----------|
| 抖音 | 80 | 15 | - | 2026-01-27 |
| 快手 | 123 | 24 | - | 2026-01-26 |
| 小红书 | 112 | 8 | - | 2026-01-26 |
| **今日头条** | **205** | **4** | **大号** | 2025-12-31 |
| 微博 | 111 | 0 | - | 2025-12-25 |
| 视频号 | 60 | 0 | - | 2025-12-17 |

**总计**: 691条内容，51条活跃跟踪

### 缺失平台 (配置已完成，等待首次采集)

- ❌ 今日头条小号 (Port 19226)
- ❌ 知乎 (Port 19229)
- ❌ 公众号 (Port 19230)

## 🔧 CDP端口映射

| 端口 | 平台 | 账号 | 状态 | URL |
|------|------|------|------|-----|
| 19222 | 抖音 | 主账号 | ✅ 开放 | creator.douyin.com |
| 19223 | 快手 | 主账号 | ✅ 开放 | cp.kuaishou.com |
| 19224 | 小红书 | 主账号 | ✅ 开放 | creator.xiaohongshu.com |
| 19225 | 今日头条 | 大号 | ✅ 开放 | mp.toutiao.com |
| 19226 | 今日头条 | 小号 | ✅ 开放 | mp.toutiao.com |
| 19227 | 微博 | 主账号 | ✅ 开放 | weibo.com |
| 19228 | 视频号 | 主账号 | ✅ 开放 | channels.weixin.qq.com |
| 19229 | 知乎 | 主账号 | ✅ 开放 | www.zhihu.com/creator |
| 19230 | 公众号 | 主账号 | ✅ 开放 | mp.weixin.qq.com |

**所有端口都已开放** (nc测试通过)

## 🚀 使用方式

### 采集所有9个平台

```bash
# 一键采集
bash /home/xx/scrape-all-9-platforms.sh

# 或手动采集单个平台
node /home/xx/platform-scraper-v8-raw.js douyin
node /home/xx/platform-scraper-v8-raw.js toutiao
node /home/xx/platform-scraper-v8-raw.js toutiao_minor
node /home/xx/platform-scraper-v8-raw.js zhihu
node /home/xx/platform-scraper-v8-raw.js wechat_official
# ... 其他平台
```

### 处理原始数据

```bash
# 处理采集的原始数据，生成快照
node /home/xx/process-raw-data-v2.js
```

### 生成每日报表

```bash
# 查看30天跟踪统计
bash /home/xx/generate-daily-report.sh
```

### 从JSON导入历史数据

```bash
# 从 ~/.platform-data/*.json 导入
node /home/xx/import-json-to-raw.js
node /home/xx/process-raw-data-v2.js
```

## 📝 数据查询

### 查看所有平台状态

```sql
SELECT
  platform,
  COALESCE(account_name, '-') as account,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE tracking_status = 'active') as active_30d,
  MAX(publish_time)::date as latest
FROM content_master
GROUP BY platform, account_name
ORDER BY platform;
```

### 查看今日头条双账号

```sql
SELECT
  account_id,
  account_name,
  COUNT(*) as count,
  MAX(publish_time)::date as latest,
  COUNT(*) FILTER (WHERE tracking_status = 'active') as active
FROM content_master
WHERE platform = 'toutiao'
GROUP BY account_id, account_name;
```

### 查看今日快照

```sql
SELECT
  cm.platform,
  cm.account_name,
  COUNT(cs.id) as snapshots,
  SUM(cs.views) as total_views
FROM content_snapshots cs
JOIN content_master cm ON cs.content_master_id = cm.id
WHERE cs.snapshot_date = CURRENT_DATE
GROUP BY cm.platform, cm.account_name;
```

## ⚠️ 当前问题

### CDP连接超时

**现象**: Node.js CDP库连接超时
- 所有端口nc测试通过 ✅
- HTTP API可访问 ✅
- WebSocket连接超时 ❌
- 网络延迟: ~200ms，丢包率: 33%

**可能原因**:
1. Node PC (100.97.242.124) 网络波动
2. CDP WebSocket连接需要更长超时
3. 需要从特定环境运行

**临时方案**:
- 使用已有的JSON文件导入: `node /home/xx/import-json-to-raw.js`
- 等待网络恢复后再次尝试

## ✅ 配置验证

### 文件检查

```bash
# ✅ Scraper包含9个平台
grep -c "'.*':" /home/xx/platform-scraper-v8-raw.js  # 应该>=9

# ✅ Processor支持account_id
grep -c "account_id" /home/xx/process-raw-data-v2.js  # 应该>=3

# ✅ 数据库字段存在
docker exec social-metrics-postgres psql -U n8n_user -d n8n_social_metrics -c "\d content_master" | grep account
```

### 数据库验证

```bash
# ✅ 今日头条大号已标记
docker exec social-metrics-postgres psql -U n8n_user -d n8n_social_metrics -c "
  SELECT account_id, account_name, COUNT(*)
  FROM content_master
  WHERE platform = 'toutiao'
  GROUP BY 1,2;
"
# 应该显示: main | 大号 | 205
```

## 📚 相关文档

- [9平台CDP配置详情](./PLATFORM_CDP_CONFIGURATION.md)
- [状态报告](./PLATFORM_STATUS_REPORT.md)
- [数据库Migration](./migration-add-account-id.sql)
- [30天跟踪系统](../../../migration-v3-tracking-system.sql)

## 🎯 下一步工作

### 立即可做 (配置完成)

- ✅ 9个平台配置完成
- ✅ 数据库支持多账号
- ✅ 采集脚本准备就绪

### 等待条件 (CDP连接恢复)

一旦CDP连接恢复，立即运行：

```bash
# 1. 采集所有9个平台
bash /home/xx/scrape-all-9-platforms.sh

# 2. 验证新平台数据
docker exec social-metrics-postgres psql -U n8n_user -d n8n_social_metrics -c "
  SELECT DISTINCT platform FROM content_master ORDER BY platform;
"
# 应该显示9个平台（包括 toutiao, zhihu, wechat_official）
```

### 长期优化

1. 调查为什么今日头条只采集到2条旧数据
2. 为知乎和公众号创建专用scraper（优化采集逻辑）
3. 设置定时任务每日自动采集
4. 集成到N8N workflow自动化

## 📞 技术支持

如果遇到问题：

1. **检查CDP连接**: `nc -zv 100.97.242.124 19225`
2. **查看Chrome实例**: `curl http://100.97.242.124:19225/json/version`
3. **测试网络**: `ping -c 5 100.97.242.124`
4. **查看日志**: 采集时的stderr输出

---

**配置完成时间**: 2026-01-27 17:40
**配置人员**: Claude Code
**系统状态**: ✅ 就绪，等待CDP连接恢复
