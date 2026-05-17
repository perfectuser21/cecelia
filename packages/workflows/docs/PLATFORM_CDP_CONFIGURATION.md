---
id: platform-cdp-configuration
version: 1.0.0
created: 2026-01-27
updated: 2026-01-27
changelog:
  - 1.0.0: 9平台CDP配置完整文档
---

# 9平台 CDP 端口映射与配置

## 📊 完整平台列表

| 端口 | 平台 | Platform Key | 账号说明 | 状态 |
|------|------|--------------|---------|------|
| 19222 | 抖音 | `douyin` | 主账号 | ✅ 已配置 |
| 19223 | 快手 | `kuaishou` | 主账号 | ✅ 已配置 |
| 19224 | 小红书 | `xiaohongshu` | 主账号 | ✅ 已配置 |
| 19225 | 今日头条 | `toutiao` | **大号** | ✅ 已配置 |
| 19226 | 今日头条 | `toutiao_minor` | **小号** | ⚠️ 需要添加 |
| 19227 | 微博 | `weibo` | 主账号 | ⚠️ 需要修复导入 |
| 19228 | 视频号 | `channels` | 主账号 | ✅ 已配置 |
| 19229 | 知乎 | `zhihu` | 主账号 | ❌ 需要创建 scraper |
| 19230 | 公众号 | `wechat_official` | 主账号 | ❌ 需要创建 scraper |

## 🔧 需要的更新

### 1. 更新 platform-scraper-v8-raw.js

**文件位置**: `/home/xx/platform-scraper-v8-raw.js`

**需要添加的平台配置**:

```javascript
const PLATFORM_CONFIG = {
  // ... 现有的 6 个平台 ...

  // 新增: 今日头条小号
  'toutiao_minor': {
    host: NODE_PC_HOST,
    port: 19226,
    name: '今日头条',
    accountId: 'minor',
    accountName: '小号',
    url: 'https://mp.toutiao.com/profile_v4/graphic/articles',
    waitTime: 5000
  },

  // 新增: 知乎
  'zhihu': {
    host: NODE_PC_HOST,
    port: 19229,
    name: '知乎',
    url: 'https://www.zhihu.com/creator/featured-question/knowledge-plan/manage',
    waitTime: 5000
  },

  // 新增: 公众号
  'wechat_official': {
    host: NODE_PC_HOST,
    port: 19230,
    name: '公众号',
    url: 'https://mp.weixin.qq.com/',
    waitTime: 5000
  }
};
```

**需要更新的现有平台配置**:

```javascript
// 今日头条大号 - 添加账号标识
'toutiao': {
  host: NODE_PC_HOST,
  port: 19225,
  name: '今日头条',
  accountId: 'main',      // 新增
  accountName: '大号',     // 新增
  url: 'https://mp.toutiao.com/profile_v4/graphic/articles',
  waitTime: 5000
},
```

**需要更新的 metadata 保存逻辑** (line 186-189):

```javascript
metadata: JSON.stringify({
  browser_port: config.port,
  text_length: rawText.length,
  account_id: config.accountId || null,      // 新增
  account_name: config.accountName || null   // 新增
})
```

### 2. 数据库更新

**需要添加 account_id 和 account_name 字段**:

```sql
-- 在 content_master 表添加账号字段
ALTER TABLE content_master
ADD COLUMN IF NOT EXISTS account_id VARCHAR(50),
ADD COLUMN IF NOT EXISTS account_name VARCHAR(50);

-- 更新唯一约束，包含 account_id
ALTER TABLE content_master
DROP CONSTRAINT IF EXISTS uk_content_master;

ALTER TABLE content_master
ADD CONSTRAINT uk_content_master
UNIQUE(platform, title, publish_time, COALESCE(account_id, ''));

-- 为今日头条现有数据设置默认账号
UPDATE content_master
SET account_id = 'main', account_name = '大号'
WHERE platform = 'toutiao' AND account_id IS NULL;
```

### 3. 更新 process-raw-data-v2.js

**文件位置**: `/home/xx/process-raw-data-v2.js`

**需要更新的部分** (line 299-313):

```javascript
// 从 metadata 中提取 account_id
const metadata = JSON.parse(rawData.metadata || '{}');
const accountId = metadata.account_id || null;
const accountName = metadata.account_name || null;

// 插入或获取 content_master (更新字段列表)
const masterResult = await dbClient.query(`
  INSERT INTO content_master (
    platform, title, publish_time, content_type_normalized,
    account_id, account_name, first_seen_at
  ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
  ON CONFLICT (platform, title, publish_time, COALESCE(account_id, '')) DO UPDATE SET
    content_type_normalized = COALESCE(content_master.content_type_normalized, EXCLUDED.content_type_normalized),
    updated_at = NOW()
  RETURNING id, tracking_status
`, [
  rawData.platform,
  item.title,
  publishTime,
  item.contentType,
  accountId,      // 新增
  accountName     // 新增
]);
```

### 4. 创建知乎 Scraper

**需要创建**: `/home/xx/platform-scraper-zhihu.js`

**特殊逻辑**:
- 知乎创作者中心的内容管理页面结构
- 可能需要处理文章、想法、回答等多种内容类型
- 数据指标可能包括：阅读、点赞、评论、收藏

**建议**: 先用 Chrome DevTools 手动访问 port 19229，查看页面结构后再编写 scraper

### 5. 创建公众号 Scraper

**需要创建**: `/home/xx/platform-scraper-wechat-official.js`

**特殊逻辑**:
- 微信公众号后台的数据统计接口
- 可能需要处理图文、视频等内容类型
- 数据指标可能包括：阅读、在看、点赞、留言

**建议**: 先用 Chrome DevTools 手动访问 port 19230，查看页面结构后再编写 scraper

### 6. 修复微博导入问题

**问题**: weibo_2026-01-27_09-17-32.json 有 65 条数据，但只导入了 1 条

**可能原因**:
1. 分隔符识别错误 - delimiter 可能不是 "数据详情"
2. 标题提取逻辑不匹配微博的文本格式
3. 指标提取失败导致跳过

**排查步骤**:
```bash
# 1. 查看 JSON 文件结构
cat ~/.platform-data/weibo_2026-01-27_*.json | jq '.items[] | {title, latest_views, latest_likes}' | head -20

# 2. 查看原始数据中微博的文本格式
psql -U n8n_user -d n8n_social_metrics -c "
  SELECT substring(raw_text, 1, 500)
  FROM raw_scraping_data
  WHERE platform = 'weibo'
  ORDER BY id DESC LIMIT 1;
"

# 3. 测试分隔符
node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.argv[1]));
let text = '';
data.items.forEach(item => {
  text += '\\n数据详情\\n' + item.title + '\\n' + item.publish_time + '\\n';
});
const sections = text.split('数据详情');
console.log('Sections:', sections.length);
" ~/.platform-data/weibo_2026-01-27_*.json
```

**可能的修复** (在 process-raw-data-v2.js):

```javascript
// 为微博添加特殊的分隔符逻辑
const delimiterMap = {
  'douyin': '编辑作品',
  'kuaishou': '已发布',
  'xiaohongshu': '观看',
  'toutiao': '编辑',
  'weibo': '\\n\\n',  // 微博可能需要用双换行符
  'channels': '数据详情'
};
```

## 📝 执行检查清单

### 立即执行 (High Priority)
- [ ] 更新 platform-scraper-v8-raw.js 添加 3 个新平台
- [ ] 执行数据库 migration 添加 account_id 字段
- [ ] 更新 process-raw-data-v2.js 支持 account_id
- [ ] 修复微博导入逻辑

### 短期执行 (Medium Priority)
- [ ] 测试 port 19226 (今日头条小号) 连接状态
- [ ] 为今日头条大号/小号创建不同的数据采集策略
- [ ] 验证微博 65 条数据能否全部导入

### 长期执行 (Low Priority)
- [ ] 访问 port 19229 查看知乎页面结构
- [ ] 创建知乎 scraper
- [ ] 访问 port 19230 查看公众号页面结构
- [ ] 创建公众号 scraper

## 🔍 验证命令

### 检查所有平台数据量

```bash
psql -U n8n_user -d n8n_social_metrics << 'SQL'
SELECT
  cm.platform,
  cm.account_name,
  COUNT(*) as content_count,
  COUNT(*) FILTER (WHERE tracking_status = 'active') as active_count
FROM content_master cm
GROUP BY cm.platform, cm.account_name
ORDER BY cm.platform, cm.account_name;
SQL
```

### 运行完整采集 (9个平台)

```bash
# 采集所有 9 个平台
for platform in douyin kuaishou xiaohongshu toutiao toutiao_minor weibo channels zhihu wechat_official; do
  echo "采集 $platform..."
  node /home/xx/platform-scraper-v8-raw.js $platform
done

# 处理原始数据
node /home/xx/process-raw-data-v2.js

# 生成报表
bash /home/xx/generate-daily-report.sh
```

### 验证今日头条双账号

```bash
psql -U n8n_user -d n8n_social_metrics << 'SQL'
SELECT
  account_id,
  account_name,
  COUNT(*) as count,
  MAX(publish_time) as latest_publish
FROM content_master
WHERE platform = 'toutiao'
GROUP BY account_id, account_name;
SQL
```

## 📚 相关文档

- [30天跟踪系统架构] → migration-v3-tracking-system.sql
- [数据处理器 V2] → process-raw-data-v2.js
- [每日报表] → generate-daily-report.sh
- [CDP 端口映射历史] → /home/xx/PLATFORM_CDP_MAPPING.md

## 🎯 预期结果

完成所有更新后，系统应该：

1. ✅ 支持 9 个平台的数据采集
2. ✅ 区分今日头条大号和小号
3. ✅ 微博能够导入完整 65 条数据
4. ✅ 每个平台每天自动生成快照
5. ✅ 所有作品跟踪 30 天
6. ✅ 每日报表显示 9 个平台的数据

**预期数据量** (基于用户反馈):
- 今日头条: 最多 (大号 + 小号合计)
- 微博: 约等于今日头条 (65+ 条)
- 其他平台: 各自实际发布量
