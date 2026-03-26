# Scraper work_id 关联现状分析与改造方案

> 分析日期：2026-03-26
> 分析对象：`zenithjoy/workflows/platform-data/workflows/scraper/scripts/` 下8个平台采集脚本
> 关联表：`cecelia` DB → `zenithjoy.publish_logs`

---

## 一、背景

发布系统通过 `zenithjoy.publish_logs` 记录每次内容发布：

```
works(id, title, ...) → publish_logs(work_id, platform, platform_post_id, metrics)
```

- `work_id`：内容作品唯一 ID（作者维度，跨平台）
- `platform_post_id`：各平台发布后返回的帖子原生 ID
- `metrics`：采集到的流量数据（由 scraper 回填）

**目标**：scraper 采集到各平台数据后，通过 `platform_post_id` 在 `publish_logs` 中反查 `work_id`，并将当日流量数据写入 `metrics` 字段。

---

## 二、8平台现状对比表

| 平台 | 脚本 | 采集方式 | 原生 ID 字段 | DB 表 | work_id 关联 | metrics 回填 | 备注 |
|------|------|----------|-------------|-------|:---:|:---:|------|
| 快手 | scraper-kuaishou-v3.js | CDP API 拦截 | `item.workId \|\| item.publishId \|\| item.photoId` | `content_master` + `content_snapshots` | ✅ | ✅ | 参考实现 |
| 抖音 | scraper-douyin-v3.js | CDP API 拦截 | `item.aweme_id` | `douyin.daily_snapshots` | ✅ | ✅ | `aweme_id` 同时作 `content_id` |
| 微博 | scraper-weibo-v3.js | CDP API 拦截 | `post.mid \|\| post.id` | `content_master` + `content_snapshots` | ✅ | ✅ | 已实现 |
| 视频号 | scraper-channels-v3.js | CDP API 拦截 | ❌ 未提取 | `content_master` only | ❌ | ❌ | `channels` 不在 publish_logs platform 枚举中 |
| 今日头条 | scraper-toutiao-v3.js | CDP DOM 抓取 | ❌ 无 ID（纯文本解析）| `content_master` + `content_snapshots` | ❌ | ❌ | DOM 方式难提取 ID |
| 微信公众号 | scraper-wechat-v3.js | CDP DOM 抓取 | ❌ 用 MD5(title+time) 替代 | `wechat.daily_snapshots` | ❌ | ❌ | 专用 schema，无原生 ID |
| 小红书 | scraper-xiaohongshu-v3.js | CDP DOM 抓取（翻页）| ❌ 未提取 | `content_master` + `content_snapshots` | ❌ | ❌ | DOM 无 ID 暴露 |
| 知乎 | scraper-zhihu-v8-api.js | CDP 注入 fetch | `item.id`（API 有）| ❌ 不写 DB，只存 JSON | ❌ | ❌ | 完全无 DB 写入 |

---

## 三、已实现平台深度分析（快手参考实现）

快手是 work_id 关联的**参考实现**，其他平台应对照实现。

### 3.1 快手实现模式

```javascript
// 1. 第二个 DB 连接（cecelia 数据库）
const zenithjoyClient = new Client({ database: 'cecelia', user: 'cecelia', ... });

// 2. linkWorkId 函数
async function linkWorkId(platformPostId, metrics) {
  const result = await zenithjoyClient.query(
    `SELECT id, work_id FROM zenithjoy.publish_logs
     WHERE platform_post_id = $1 AND platform = 'kuaishou' LIMIT 1`,
    [platformPostId]
  );
  if (result.rows.length === 0) return null;
  const { id, work_id } = result.rows[0];
  await zenithjoyClient.query(
    `UPDATE zenithjoy.publish_logs SET metrics = $1 WHERE id = $2`,
    [JSON.stringify(metrics), id]
  );
  return work_id;
}

// 3. 采集循环中调用
if (zenithjoyConnected && item.workId) {
  const workId = await linkWorkId(item.workId, metrics);
  if (workId) { item.work_id = workId; workIdLinked++; }
}
```

### 3.2 抖音实现差异

- `platform_post_id` 使用 `aweme_id`（同时作 `douyin.daily_snapshots.content_id`）
- 采集完成 DB 写入后再单独做 work_id 关联循环（不在单条记录内联）

### 3.3 微博实现差异

- `platform_post_id` 使用 `post.mid || post.id`（微博数字 ID）

---

## 四、未实现平台改造方案

### 4.1 视频号（channels）— 难度：中高

**问题**：
1. `channels` 不在 `publish_logs.platform_check` 枚举中（CHECK 约束），无法写入
2. 代码中未提取 `item.id` 或 `objectId`（API 响应中应有）
3. 仅写 `content_master`，无 `content_snapshots`

**改造步骤**：
```sql
-- Step 1: 修改 platform_check 约束，添加 channels
ALTER TABLE zenithjoy.publish_logs DROP CONSTRAINT publish_logs_platform_check;
ALTER TABLE zenithjoy.publish_logs ADD CONSTRAINT publish_logs_platform_check
  CHECK (platform IN ('wechat','douyin','xiaohongshu','zhihu','toutiao','kuaishou','weibo','channels'));
```
```javascript
// Step 2: 采集代码添加 ID 提取
allItems.push({
  ...
  channelId: item.id || item.objectId || item.export_id || '',  // 需验证 API 字段名
});

// Step 3: 添加 zenithjoyClient + linkWorkId（参考快手实现）
```

**阻塞点**：视频号 API 的原生 ID 字段名需要实际抓包确认（`item.id`/`objectId` 待验证）

---

### 4.2 今日头条（toutiao）— 难度：高

**问题**：
- 采集方式是 DOM 文本解析（页面截图提取），无法获取原生 ID
- 头条创作者后台没有开放可拦截的 REST API

**改造路径（两选一）**：

**方案 A（推荐）**：改为 API 拦截方式
```
今日头条创作者后台 → DevTools Network 抓包找帖子列表 API
→ 类似 /api/article/list? 的接口 → 拦截获取 ID
```

**方案 B（临时）**：从 URL 或 DOM data 属性提取
```javascript
// 尝试从 article URL 提取 ID（如果页面有链接）
const idMatch = articleUrl.match(/article\/(\d+)/);
```

**注**：头条 DOM 结构复杂，API 拦截方案需要实际验证。

---

### 4.3 微信公众号（wechat）— 难度：高

**问题**：
- 使用 MD5(title+time) 作为 content_id（非平台原生 ID）
- 公众号 DOM 中无法直接提取文章的原生 msg_id/biz_id
- `wechat.daily_snapshots` 是专用 schema，结构与 publish_logs 对接方式不同

**改造路径**：

微信公众号发布时 API 响应中含 `media_id`，需在**发布器**（publisher）写入 publish_logs 时存储 `platform_post_id`。

然后 scraper 端：
```javascript
// 用 MD5 content_id 作为 platform_post_id 查询
// （需在发布时也用相同算法生成 content_id 写入 publish_logs）
const content_id = crypto.createHash('md5')
  .update(`${item.title}|${item.publishTime}`).digest('hex');
const workId = await linkWorkId(content_id, metrics);
```

**前提**：发布器写入 publish_logs 时 platform_post_id 字段也必须用相同 MD5 格式，否则无法匹配。

---

### 4.4 小红书（xiaohongshu）— 难度：中

**问题**：
- 采集方式是 DOM 表格抓取，无 ID 字段
- 小红书创作者中心 data-analysis 页面表格行无暴露 ID

**改造路径（两选一）**：

**方案 A**：API 拦截方式
```
小红书创作者中心 → 抓包找笔记列表 API（如 /api/note/list）
→ 拦截获取 note_id
```

**方案 B**：DOM 中提取 note URL
```javascript
// 检查表格行是否有链接到笔记详情
const noteLink = row.querySelector('a[href*="explore"]');
const noteId = noteLink?.href.match(/\/([a-z0-9]+)$/)?.[1];
```

---

### 4.5 知乎（zhihu）— 难度：中

**问题**：
- API 方式采集，`item.id` 字段直接可用
- 但完全没有 DB 写入（只存 JSON），需先加 DB 基础设施

**改造步骤**（最完整，需从头建）：
```javascript
// Step 1: 添加 social_media_raw DB 连接
// Step 2: 按 item.type 写入对应表（文章/视频/想法）
// Step 3: 添加 zenithjoyClient 连接
// Step 4: 实现 linkWorkId，使用 item.id（文章/视频）或 item.id（想法）

// 知乎 platform_post_id 字段：
// - 文章: item.id (article_id)
// - 视频: item.id (zvideo_id)
// - 想法: item.id (pin_id)
```

---

## 五、改造优先级建议

| 平台 | 优先级 | 难度 | 主要阻塞点 | 预计工作量 |
|------|--------|------|-----------|-----------|
| 知乎 | P1 | 中 | 需先加 DB 写入基础设施 | 1天 |
| 小红书 | P1 | 中 | 需找 API 或 DOM 中的 note_id | 0.5天 |
| 视频号 | P2 | 中高 | 需验证 API item ID 字段名 + DB 约束修改 | 1天 |
| 微信公众号 | P2 | 高 | 需发布器和 scraper 约定统一的 ID 方案 | 1.5天 |
| 今日头条 | P3 | 高 | 需调研是否有可拦截 API | 1-2天 |

---

## 六、通用改造模板

所有未实现平台均可参照以下模板：

```javascript
// 在 scraper 顶部添加第二 DB 连接
const zenithjoyClient = new Client({
  host: 'localhost', port: 5432,
  user: 'cecelia', password: 'CeceliaUS2026', database: 'cecelia'
});

// 通用 linkWorkId 函数（只需改 platform 参数）
async function linkWorkId(platformPostId, metrics) {
  try {
    const result = await zenithjoyClient.query(
      `SELECT id, work_id FROM zenithjoy.publish_logs
       WHERE platform_post_id = $1 AND platform = '${PLATFORM_CODE}' LIMIT 1`,
      [platformPostId]
    );
    if (result.rows.length === 0) return null;
    const { id, work_id } = result.rows[0];
    await zenithjoyClient.query(
      `UPDATE zenithjoy.publish_logs SET metrics = $1 WHERE id = $2`,
      [JSON.stringify(metrics), id]
    );
    return work_id;
  } catch (e) {
    console.error(`[${PLATFORM_NAME}] publish_logs 关联失败（非致命）: ` + e.message);
    return null;
  }
}
```

---

## 七、当前数据状态

- `zenithjoy.works`：0 行（作品表为空，尚无发布记录）
- `zenithjoy.publish_logs`：0 行（发布日志表为空）
- 即使快手/抖音/微博已实现 linkWorkId，当前也无可关联数据
- **关键前提**：work_id 关联生效的前提是 publisher 在发布成功后写入了 `platform_post_id`

---

## 八、数据库枚举缺口

`publish_logs` 的 platform_check 约束当前仅支持7个平台（不含视频号）：

```sql
-- 当前约束
CHECK (platform IN ('wechat','douyin','xiaohongshu','zhihu','toutiao','kuaishou','weibo'))

-- 视频号改造时需添加 'channels'
```

