---
id: platform-status-report
version: 1.0.0
created: 2026-01-27
updated: 2026-01-27
changelog:
  - 1.0.0: 初始状态报告
---

# 9平台数据采集系统 - 当前状态报告

**报告时间**: 2026-01-27
**数据库**: n8n_social_metrics
**目标**: 支持 9 个平台的 30 天内容跟踪

## 📊 当前数据概况

### 平台数据统计

| 平台 | 总内容数 | 活跃跟踪 | 最新数据 | CDP端口 | 状态 |
|------|---------|---------|---------|---------|------|
| 抖音 (douyin) | 80 | 15 | ✅ 今日采集 | 19222 | ✅ 正常 |
| 快手 (kuaishou) | 123 | 24 | ✅ 今日采集 | 19223 | ✅ 正常 |
| 小红书 (xiaohongshu) | 112 | 8 | ✅ 今日采集 | 19224 | ✅ 正常 |
| 今日头条-大号 (toutiao) | 205 | 4 | ✅ 今日采集 | 19225 | ⚠️ 活跃数少 |
| **今日头条-小号** | **0** | **0** | ❌ 未配置 | 19226 | ❌ 未配置 |
| 微博 (weibo) | 111 | 0 | ✅ 今日采集 | 19227 | ⚠️ 无活跃 |
| 视频号 (channels) | 60 | 0 | ✅ 今日采集 | 19228 | ⚠️ 无活跃 |
| **知乎 (zhihu)** | **0** | **0** | ❌ 未配置 | 19229 | ❌ 未配置 |
| **公众号 (wechat)** | **0** | **0** | ❌ 未配置 | 19230 | ❌ 未配置 |

**总计**: 691 条内容，51 条活跃跟踪（30天内）

### 快照数据统计

| 日期 | 快照数 | 总播放量 |
|------|--------|---------|
| 2026-01-27 | 56 | 22,386 |
| 2026-01-04 | 57 | 92,565 |
| 2025-12-25 | 24 | 0 |
| 2025-12-23 | 554 | 370,955 |

## ⚠️ 核心问题

### 1. 今日头条数据异常

**用户反馈**: "头条的数据应该最多"
**实际情况**:
- 今日头条 205 条内容（确实最多）
- 但只有 4 条活跃跟踪
- **原因**: 大部分内容发布时间超过 30 天，已标记为 completed
- **解决**: 需要持续采集最近 30 天的内容

**今日头条小号未配置**:
- 用户有大号和小号两个账号
- 当前只配置了大号 (19225)
- 小号 (19226) 完全未配置
- **已完成**: 数据库 account_id 字段已添加并设置大号标识

### 2. 微博数据无活跃跟踪

**用户反馈**: "微博应该等于头条"
**实际情况**:
- 微博 111 条内容
- 0 条活跃跟踪
- 今日有采集但所有内容都超过 30 天
- **解决**: 需要确认微博账号是否还在发布新内容

### 3. 缺少3个平台

**未配置的平台**:
1. 今日头条小号 (toutiao_minor) - Port 19226
2. 知乎 (zhihu) - Port 19229
3. 公众号 (wechat_official) - Port 19230

## ✅ 已完成的工作

### 1. 数据库架构更新

- ✅ 创建 30 天跟踪系统 (content_master + content_snapshots)
- ✅ 添加 account_id 和 account_name 字段
- ✅ 今日头条大号数据已标记 (205条 → account_id='main', account_name='大号')
- ✅ 创建唯一约束支持多账号识别
- ✅ 创建索引优化查询性能

### 2. 数据导入

- ✅ 从 JSON 文件导入历史数据 (691 条)
- ✅ 处理原始数据生成快照 (56 条今日快照)
- ✅ 6 个平台的数据采集正常运行

### 3. 文档创建

- ✅ 9平台 CDP 配置文档 (PLATFORM_CDP_CONFIGURATION.md)
- ✅ 数据库 Migration 脚本 (migration-add-account-id.sql)
- ✅ 本状态报告 (PLATFORM_STATUS_REPORT.md)

## 🔧 待执行任务

### 高优先级 (立即执行)

#### Task 1: 配置今日头条小号
```bash
# 1. 更新 scraper 配置添加 toutiao_minor
# 文件: /home/xx/platform-scraper-v8-raw.js
# 添加:
'toutiao_minor': {
  host: NODE_PC_HOST,
  port: 19226,
  name: '今日头条',
  accountId: 'minor',
  accountName: '小号',
  url: 'https://mp.toutiao.com/profile_v4/graphic/articles',
  waitTime: 5000
}

# 2. 测试连接
node /home/xx/platform-scraper-v8-raw.js toutiao_minor

# 3. 处理数据
node /home/xx/process-raw-data-v2.js
```

#### Task 2: 更新 process-raw-data-v2.js 支持 account_id
```javascript
// 在插入 content_master 之前提取 account_id
const metadata = typeof rawData.metadata === 'string'
  ? JSON.parse(rawData.metadata)
  : (rawData.metadata || {});
const accountId = metadata.account_id || null;
const accountName = metadata.account_name || null;

// 更新 INSERT 语句包含 account_id 和 account_name
// 更新 VALUES 参数列表
// 更新 ON CONFLICT 包含 account_id
```

#### Task 3: 更新 scraper metadata 保存逻辑
```javascript
// 在 platform-scraper-v8-raw.js 中更新:
metadata: JSON.stringify({
  browser_port: config.port,
  text_length: rawText.length,
  account_id: config.accountId || null,
  account_name: config.accountName || null
})
```

### 中优先级 (本周执行)

#### Task 4: 验证知乎平台可用性
```bash
# 测试 Port 19229 连接
timeout 10 node -e "
const CDP = require('chrome-remote-interface');
(async () => {
  const client = await CDP({ host: '100.97.242.124', port: 19229 });
  const { result } = await client.Runtime.evaluate({
    expression: 'JSON.stringify({ title: document.title, url: location.href })'
  });
  console.log(JSON.parse(result.value));
  await client.close();
})();
"
```

#### Task 5: 验证公众号平台可用性
```bash
# 测试 Port 19230 连接 (同上，改为 port: 19230)
```

#### Task 6: 创建知乎 Scraper
- 查看页面结构
- 编写 platform-scraper-zhihu.js
- 添加内容类型检测规则

#### Task 7: 创建公众号 Scraper
- 查看页面结构
- 编写 platform-scraper-wechat-official.js
- 添加内容类型检测规则

### 低优先级 (长期优化)

#### Task 8: 优化微博数据采集
- 调查为什么所有微博内容都超过 30 天
- 确认微博账号是否还在发布
- 调整采集策略

#### Task 9: 自动化采集调度
- 创建 N8N workflow 每日自动采集 9 个平台
- 集成到现有的"数据采集调度器"

## 📝 执行命令参考

### 采集所有 6 个已配置平台
```bash
for platform in douyin kuaishou xiaohongshu toutiao weibo channels; do
  node /home/xx/platform-scraper-v8-raw.js $platform
done
node /home/xx/process-raw-data-v2.js
```

### 查看今日数据
```bash
docker exec social-metrics-postgres psql -U n8n_user -d n8n_social_metrics -c "
SELECT platform, account_name, COUNT(*) as count
FROM content_master cm
JOIN content_snapshots cs ON cm.id = cs.content_master_id
WHERE cs.snapshot_date = CURRENT_DATE
GROUP BY platform, account_name
ORDER BY platform;
"
```

### 查看活跃跟踪状态
```bash
docker exec social-metrics-postgres psql -U n8n_user -d n8n_social_metrics -c "
SELECT
  platform,
  account_name,
  COUNT(*) as active_count,
  MAX(publish_time)::date as latest_publish,
  MIN(tracking_end_date) as nearest_expire
FROM content_master
WHERE tracking_status = 'active'
GROUP BY platform, account_name
ORDER BY platform;
"
```

## 🎯 成功指标

当以下条件全部满足时，系统达到预期目标:

- [x] 数据库支持 account_id 区分多账号
- [ ] 9 个平台全部配置完成
- [ ] 今日头条大号和小号数据分别采集
- [ ] 每天自动生成所有平台的快照
- [ ] 活跃跟踪数量合理（30天内有新内容）
- [ ] 每日报表显示 9 个平台的完整数据

## 📌 下一步行动

**立即执行** (今天):
1. 更新 platform-scraper-v8-raw.js 添加 toutiao_minor, zhihu, wechat_official
2. 更新 process-raw-data-v2.js 支持 account_id
3. 测试今日头条小号采集

**本周执行**:
1. 验证知乎和公众号 CDP 连接
2. 创建知乎和公众号 scraper
3. 全平台数据采集测试

**持续监控**:
1. 每日检查 9 个平台数据采集状态
2. 监控活跃跟踪数量变化
3. 确保 30 天跟踪机制正常运行
