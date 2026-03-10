---
name: kuaishou-publisher
description: 快手自动发布工具 - 图文发布（支持 API 方案和 CDP 浏览器方案）
trigger: 发布快手、kuaishou、快手发布
version: 1.2.0
created: 2026-03-07
updated: 2026-03-10
changelog:
  - 1.0.0: 初始版本 - 图文发布，CDP 直连方式
  - 1.1.0: OAuth 会话检查脚本 + 批量发布前置防护
  - 1.2.0: 新增 API 方案（publish-kuaishou-api.cjs）— CDP 提取 Cookie + HTTP 直接调用
---

# Kuaishou Publisher

快手自动发布工具 - 图文内容，支持两种发布方案

## 方案对比

| 方案 | 脚本 | 原理 | 优势 | 劣势 |
|------|------|------|------|------|
| CDP 自动化（旧） | `publish-kuaishou-image.cjs` | CDP 控制浏览器 UI | 不需了解 API | 受页面改版影响、需要 Windows 路径 |
| 新 API 方案 | `publish-kuaishou-api.cjs` | CDP 提取 Cookie → HTTP 直接调用 | 稳定、快速 | 依赖内部 API 格式不变 |

**推荐使用新 API 方案**（publish-kuaishou-api.cjs）。

## 架构

```
Mac mini (100.86.57.69 / localhost)
    ↓ CDP WebSocket (Tailscale 内网直连)
Windows PC (100.97.242.124:19223)
    ↓ 提取 Cookie（新方案）/ 浏览器 UI 自动化（旧方案）
快手发布成功
```

**关键区别（与头条/抖音不同）**：
- 不需要 SSH 到 Windows PC
- 直接从 Mac mini 通过 CDP 控制浏览器
- CDP 端口：19223（快手专用）

## 支持类型

| 类型 | 脚本 | 状态 | 说明 |
|------|------|------|------|
| 图文（新 API） | `scripts/publish-kuaishou-api.cjs` | ✅ 推荐 | Cookie + HTTP API，不依赖页面结构 |
| 图文（CDP 旧方案） | `scripts/publish-kuaishou-image.cjs` | ✅ 备用 | 浏览器 UI 自动化 |
| 会话检查 | `scripts/check-kuaishou-session.cjs` | ✅ | 发布前检查 |

## 使用方式

### 会话状态检查（推荐发布前先运行）

```bash
NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
  node packages/workflows/skills/kuaishou-publisher/scripts/check-kuaishou-session.cjs
```

**输出示例**：
- `[SESSION_OK]` — 会话有效，可以发布（exit 0）
- `[SESSION_EXPIRED]` — 需要重新登录（exit 2）
- `[CDP_ERROR]` — Windows PC 未连接（exit 1）

### 新 API 方案（推荐）

```bash
NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
  node packages/workflows/skills/kuaishou-publisher/scripts/publish-kuaishou-api.cjs \
  --content ~/.kuaishou-queue/2026-03-07/image-1/
```

### 旧 CDP 方案（备用）

```bash
NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
  node packages/workflows/skills/kuaishou-publisher/scripts/publish-kuaishou-image.cjs \
  --content ~/.kuaishou-queue/2026-03-07/image-1/
```

### 批量发布

```bash
bash packages/workflows/skills/kuaishou-publisher/scripts/batch-publish-kuaishou.sh 2026-03-07
```

### 内容目录结构

```
~/.kuaishou-queue/{date}/
├── image-{id}/
│   ├── type.txt        → "image"
│   ├── content.txt     → 文案内容
│   └── image.jpg       → 图片（可多张：image1.jpg, image2.jpg...）
```

## 配置

| 参数 | 值 |
|------|-----|
| Windows PC IP | `100.97.242.124` |
| CDP 端口 | `19223` |
| 发布页面 | `https://cp.kuaishou.com/article/publish/photo-video` |
| 上传 Token API | `https://cp.kuaishou.com/rest/cp/works/upload/photo/token` |
| 发布 API | `https://cp.kuaishou.com/rest/cp/works/photo/new` |
| 会话 Cookie | `kuaishou.web.cp.api_st` / `kuaishou.web.cp.api_ph` |
| NODE_PATH | `/Users/administrator/perfect21/cecelia/node_modules` |

## 故障排查

### CDP 连接失败

```bash
curl http://100.97.242.124:19223/json
```

### 找不到 ws 模块

```bash
export NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules
```

### API 端点返回 404

新 API 方案的端点可能随快手 CP 版本更新而变更。排查方法：
1. 在 Windows Chrome 打开快手 CP（cp.kuaishou.com）
2. 打开 DevTools → Network 面板，过滤 XHR/Fetch
3. 手动发布一次图文，记录上传和发布相关的请求 URL
4. 更新 `publish-kuaishou-api.cjs` 中的 `KUAISHOU_UPLOAD_TOKEN_URL` 和 `KUAISHOU_PUBLISH_URL`

---

**版本**: 1.2.0
**状态**: ✅ 图文发布（新 API 方案 + CDP 旧方案）+ OAuth 会话检查
**架构**: Mac mini → CDP → Windows PC 浏览器 Cookie → 快手 API
