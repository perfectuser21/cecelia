---
name: wechat-publisher
description: 微信公众号自动发布工具 - 图文发布（官方 API 方案）
trigger: 发布公众号、wechat、微信公众号、公众号发布、wechat-publisher
version: 1.0.0
created: 2026-03-10
updated: 2026-03-10
changelog:
  - 1.0.0: 初始版本 - 图文发布，官方 API 方案（草稿 + 发布）
---

# WeChat Publisher

微信公众号自动发布工具 - 基于微信公众平台官方 API

## ✅ 实现状态

| 类型 | 状态 | 说明 |
|------|------|------|
| **图文（文字+HTML）** | ✅ 已实现 | 草稿 + 群发发布 |
| **封面图片上传** | ✅ 已实现 | uploadimg API，可选 |
| **Token 有效性检查** | ✅ 已实现 | 带缓存，自动刷新 |

---

## 🏗️ 架构

```
调用方（脚本/N8N）
    ↓ node publish-wechat-article.cjs
Mac mini (localhost)
    ↓ HTTPS API
微信公众平台 API (api.weixin.qq.com)
    ↓ 官方 API 认证
公众号 ✅
```

**关键路径**：
- 凭据：`~/.credentials/wechat.env`（WECHAT_APPID + WECHAT_APPSECRET）
- Token 缓存：`/tmp/wechat_token.json`（有效期 7200s，提前 5min 刷新）
- 脚本位置：`/Users/administrator/perfect21/zenithjoy/services/creator/scripts/publishers/wechat-publisher/`

---

## 📝 脚本列表

| 脚本 | 用途 | 状态 |
|------|------|------|
| `publish-wechat-article.cjs` | 发布图文文章（主脚本） | ✅ |
| `check-wechat-token.cjs` | Token 有效性检查 | ✅ |

---

## 📦 接口规范

### 直接参数模式

```bash
NODE_PATH=/Users/administrator/perfect21/zenithjoy/services/creator/scripts/publishers/node_modules \
  node /Users/administrator/perfect21/zenithjoy/services/creator/scripts/publishers/wechat-publisher/publish-wechat-article.cjs \
  --title "今日分享" \
  --content "<p>文章正文内容</p>" \
  --author "作者名" \
  --digest "文章摘要（最多54字）" \
  --cover /path/to/cover.jpg
```

### 内容目录模式

```bash
NODE_PATH=/Users/administrator/perfect21/zenithjoy/services/creator/scripts/publishers/node_modules \
  node /Users/administrator/perfect21/zenithjoy/services/creator/scripts/publishers/wechat-publisher/publish-wechat-article.cjs \
  --content-dir ~/.wechat-queue/2026-03-10/article-1/
```

**目录结构**：

```
article-1/
├── title.txt       - 文章标题（必需）
├── content.html    - HTML 正文（优先使用）
├── content.txt     - 纯文本（如无 content.html，自动转 HTML）
├── digest.txt      - 摘要（可选，默认取标题前54字）
├── author.txt      - 作者（可选）
└── cover.jpg       - 封面图（可选）
```

### Token 检查

```bash
NODE_PATH=/Users/administrator/perfect21/zenithjoy/services/creator/scripts/publishers/node_modules \
  node /Users/administrator/perfect21/zenithjoy/services/creator/scripts/publishers/wechat-publisher/check-wechat-token.cjs
```

**输出**：
- `[SESSION_OK]` — Token 有效（exit 0）
- `[TOKEN_EXPIRED]` — Token 已过期，下次 publish 时自动刷新（exit 1）
- `[TOKEN_MISSING_CREDENTIALS]` — 凭据缺失，需配置（exit 2）

---

## 🔧 技术方案

### 发布流程

1. **加载凭据** — 读取 `~/.credentials/wechat.env`（APPID + APPSECRET）
2. **获取 Access Token** — 缓存到 `/tmp/wechat_token.json`，过期自动刷新
3. **上传封面图片**（可选）— `POST /cgi-bin/media/uploadimg`
4. **创建草稿** — `POST /cgi-bin/draft/add`，返回 `media_id`
5. **提交发布** — `POST /cgi-bin/freepublish/submit`，传入 `media_id`

### 为什么用官方 API

| 方案 | 优势 | 局限 |
|------|------|------|
| **官方 API（本方案）** | 稳定、不受前端改版影响 | 需要认证服务号（个人订阅号有限制） |
| CDP 浏览器自动化 | 无需 API 权限 | 依赖登录状态，受页面改版影响 |

---

## 🔐 凭据配置

创建 `~/.credentials/wechat.env`：

```bash
# 微信公众号凭据（从公众号后台 → 基本配置 获取）
WECHAT_APPID=wx1234567890abcdef
WECHAT_APPSECRET=your_app_secret_here
```

**获取方式**：
- 登录 [微信公众平台](https://mp.weixin.qq.com)
- 进入「设置与开发」→「基本配置」
- 复制 AppID 和 AppSecret

---

## ⚠️ 注意事项

- 微信公众号每天有发布次数限制（服务号每月 4 次群发，订阅号每天 1 次）
- Token 全局唯一，多实例运行会导致 Token 互相冲突（用缓存文件统一管理）
- 封面图片建议尺寸 900×383px，大小 < 1MB
- 内容 HTML 不支持外链图片（需先上传到公众号素材库）

---

## 故障排查

### errcode=40001（Token 无效）

```bash
# 删除缓存，强制重新获取
rm /tmp/wechat_token.json
node check-wechat-token.cjs
```

### errcode=45009（每日发布超限）

当天已超过发布次数限制，明天再试。

### errcode=48001（接口权限不足）

需要服务号且已开通相应权限（订阅号有功能限制）。

---

**版本**: 1.0.0
**状态**: ✅ **图文发布已实现**
**架构**: Mac mini → 微信公众平台 API → 公众号
**凭据**: `~/.credentials/wechat.env`（WECHAT_APPID + WECHAT_APPSECRET）
