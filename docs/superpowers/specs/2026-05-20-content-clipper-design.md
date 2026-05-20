# Content Clipper — 设计文档

**日期**：2026-05-20  
**分支**：cp-0520195056-content-clipper  
**状态**：已审批，进入实现

---

## 目标

在 Cecelia 系统中建立完整的内容采集管道：接收抖音/小红书 URL → 调用 xian-m1 content-service 提取内容 → 持久化到 Brain DB → 在 Dashboard `/clips` 提供管理视图。

---

## 架构（方案 A：Brain API 直接回调）

```
[ZenithJoy n8n / iOS Shortcut / API]
        ↓ POST /api/brain/clips
[Brain clips.js 路由]
  1. INSERT clips(status=pending)
  2. 异步 POST http://38.23.47.81:7786/transcribe
        { url, callback_url: "http://localhost:5221/api/brain/clips/:id/callback" }
        ↓
[xian-m1 content-service] — 提取视频转写/图文
        ↓ POST callback
[Brain] — UPDATE clips SET status=done, transcript=..., images=...
```

**不选方案 B**（n8n 做中枢）：Brain 无法感知 pending/processing 状态，无法做主动重试监控。

---

## DB Schema（migration 010）

文件：`database/migrations/010-content-clips.sql`

```sql
CREATE TABLE clips (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url          TEXT NOT NULL,
  platform     TEXT NOT NULL CHECK (platform IN ('douyin', 'xiaohongshu')),
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  title        TEXT,
  author       TEXT,
  author_id    TEXT,
  like_count   INTEGER,
  comment_count INTEGER,
  share_count  INTEGER,
  cover_url    TEXT,
  video_url    TEXT,
  transcript   TEXT,
  images       JSONB DEFAULT '[]',
  raw_response JSONB,
  error_msg    TEXT,
  requested_by TEXT,
  retry_count  INTEGER DEFAULT 0,
  metadata     JSONB DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_clips_url ON clips(url);
CREATE INDEX idx_clips_platform_status ON clips(platform, status, created_at DESC);
CREATE INDEX idx_clips_created_at ON clips(created_at DESC);
```

同一 URL 重复提交返回 409（UNIQUE 约束）。

---

## Brain API 端点

文件：`packages/brain/src/routes/clips.js`

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/brain/clips | 提交 URL，创建 pending 记录，异步触发提取 |
| GET | /api/brain/clips | 列表，支持 platform/status/since/limit/offset |
| GET | /api/brain/clips/:id | 单条详情（含 transcript/images/raw_response） |
| POST | /api/brain/clips/:id/retry | 重置为 pending，重新触发提取 |
| POST | /api/brain/clips/:id/callback | 内部端点，content-service 回调写入结果 |
| POST | /api/brain/clips/webhook | 外部 webhook（n8n），X-Webhook-Secret 鉴权 |

**POST /api/brain/clips** 请求体：
```json
{ "url": "https://...", "requested_by": "alex" }
```
返回 201：`{ "id": "uuid", "status": "pending", "created_at": "..." }`  
重复 URL 返回 409：`{ "error": "already_exists", "id": "existing-uuid" }`

---

## clips-extractor.js

文件：`packages/brain/src/clips-extractor.js`

- `extractClip(clipId, url)`：异步调用 content-service proxy
- 成功回调：`updateClip(id, {status:'done', transcript, images, title, author, ...})`
- 失败：`updateClip(id, {status:'failed', error_msg})` 
- retry_count >= 3 时不再自动重试

---

## 前端页面

### 路由注册（system-hub/index.ts）

在 System nav children 新增：
```ts
{ path: '/clips', label: 'Content Clips', icon: 'Scissors', order: 17 }
```

新增路由：
```ts
{ path: '/clips', component: 'ContentClipsPage' },
{ path: '/clips/:id', component: 'ContentClipDetailPage' },
```

### ContentClipsPage.tsx

路径：`apps/dashboard/src/pages/clips/ContentClipsPage.tsx`

- 表格列：平台图标 | 标题（截断 40 字）| 状态 badge | 作者 | 采集时间 | 操作（查看/重试）
- 筛选栏：平台（全部/douyin/xiaohongshu）+ 状态（全部/pending/done/failed）
- 空状态：友好提示（"还没有采集记录，提交第一个链接开始"）
- 每页 20 条，分页

### ContentClipDetailPage.tsx

路径：`apps/dashboard/src/pages/clips/ContentClipDetailPage.tsx`

- 基本信息卡：平台、原始 URL（可点击）、作者、互动数据
- 转写文本区块（超过 500 字可折叠）
- 图片 gallery（小红书图文：最多 9 张）
- 状态为 failed 时显示重试按钮 + 错误信息

---

## n8n 改造

现有 "Douyin Done Handler"（sf56SB9poZbgctz5）在 Parse+Save Notion 节点**之前**插入新节点：

```
AI Summary → [新] POST Brain Webhook → Parse Notion → Notion Create
```

新节点：HTTP Request POST `http://38.23.47.81:7786` → Brain（通过 proxy 到 localhost:5221/api/brain/clips/webhook），header `X-Webhook-Secret`。

Brain webhook 收到后调同一 ingest 路径，幂等写入（重复 URL → 更新已有记录而非报错）。

---

## 测试策略

### 单元测试（vitest）

文件：`packages/brain/src/routes/__tests__/clips.test.ts`

- POST /clips 创建 pending 记录
- GET /clips 按 platform/status 筛选
- 重复 URL 返回 409
- clips-extractor 状态机：pending → processing → done/failed

### 集成测试（manual:node）

- `node -e "require('fs').accessSync('packages/brain/src/routes/clips.js')"`
- `node -e "require('fs').accessSync('database/migrations/010-content-clips.sql')"`

### E2E（Playwright mac_web）

- 访问 `localhost:5211/clips` → 响应 200，无 500
- 空状态页面正确渲染（不崩溃）

---

## 成功标准

1. POST /api/brain/clips → 201，DB 有 pending 记录（< 100ms）
2. content-service 完成后 clips 状态变 done，transcript/images 有值
3. GET /api/brain/clips 返回列表，platform/status 筛选正确
4. Dashboard /clips 页面可访问，展示列表
5. 单条详情页展示完整转写文本
6. n8n "Douyin Done Handler" 回调写入 Brain DB
7. 同 URL 重复提交返回 409

## 不做

- 视频本地下载存储
- 内容审核/过滤
- ZenithJoy 中台前端 UI（本 PR 只出 API）
- Notion 同步（现有 n8n 保留，Brain 只管自己的 DB）
- 批量导入
- 权限控制
