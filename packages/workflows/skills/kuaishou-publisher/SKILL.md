---
name: kuaishou-publisher
description: 快手自动发布工具 - 图文发布（CDP 直连方式 + Open Platform API 方式）
trigger: 发布快手、kuaishou、快手发布
version: 2.0.0
created: 2026-03-07
updated: 2026-03-10
changelog:
  - 1.0.0: 初始版本 - 图文发布，CDP 直连方式
  - 1.1.0: OAuth 会话检查脚本 + 批量发布前置防护
  - 2.0.0: 新增 Kuaishou Open Platform API 方案（OAuth 2.0）
---

# Kuaishou Publisher

快手自动发布工具 - 图文内容。提供两套方案：
1. **CDP 方案（v1.x）**：Mac mini → Windows PC 浏览器自动化（已有账号登录）
2. **API 方案（v2.x）**：Mac mini → Kuaishou Open Platform API（需要 OAuth 授权）

---

## 方案一：CDP 方案（v1.x）

```
Mac mini (100.86.57.69 / localhost)
    ↓ CDP WebSocket (Tailscale 内网直连)
Windows PC (100.97.242.124:19223)
    ↓ 浏览器自动化
快手发布成功
```

**适用场景**：Windows PC 在线、浏览器已登录快手

### 使用方式

```bash
# 会话状态检查
NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
  node packages/workflows/skills/kuaishou-publisher/scripts/check-kuaishou-session.cjs

# 单条发布
NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
  node packages/workflows/skills/kuaishou-publisher/scripts/publish-kuaishou-image.cjs \
  --content ~/.kuaishou-queue/2026-03-07/image-1/

# 批量发布
bash packages/workflows/skills/kuaishou-publisher/scripts/batch-publish-kuaishou.sh 2026-03-07
```

| 参数 | 值 |
|------|-----|
| Windows PC IP | `100.97.242.124` |
| CDP 端口 | `19223` |
| 截图目录 | `/tmp/kuaishou-publish-screenshots/` |

---

## 方案二：API 方案（v2.x，新）

```
Mac mini
    ↓ HTTPS API 调用
Kuaishou Open Platform (open.kuaishou.com)
    ↓ 图片上传 + 图文发布
快手发布成功
```

**适用场景**：不依赖 Windows PC，需要一次性 OAuth 授权

### 首次授权（一次性）

```bash
SCRIPTS=packages/workflows/skills/kuaishou-publisher/scripts
NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules

# 1. 配置 AppKey/AppSecret（先在 ~/.credentials/kuaishou.env 写入）
cp packages/workflows/skills/kuaishou-publisher/kuaishou.env.example ~/.credentials/kuaishou.env
# 填写 KUAISHOU_APP_KEY 和 KUAISHOU_APP_SECRET

# 2. 生成授权 URL
node $SCRIPTS/kuaishou-oauth-client.cjs gen-auth-url

# 3. 浏览器打开 URL，授权，获得 code

# 4. 换取 Token
node $SCRIPTS/kuaishou-oauth-client.cjs exchange-code <authorization_code>

# 5. 验证
node $SCRIPTS/kuaishou-oauth-client.cjs check
```

### 发布

```bash
NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
  node packages/workflows/skills/kuaishou-publisher/scripts/kuaishou-api-publisher.cjs \
  --content ~/.kuaishou-queue/2026-03-10/image-1/
```

### Token 管理

```bash
node $SCRIPTS/kuaishou-oauth-client.cjs check        # 查看 token 状态
node $SCRIPTS/kuaishou-oauth-client.cjs get-token    # 获取有效 token（自动刷新）
```

**输出示例**：
- `[SESSION_CHECK] APP_KEY: 已配置 ✅` — 凭据正常
- `[KUAISHOU_MISSING_CREDENTIALS]` — 需要配置凭据
- `[KUAISHOU_REAUTH_REQUIRED]` — 需要重新授权

| 参数 | 值 |
|------|-----|
| 凭据文件 | `~/.credentials/kuaishou.env` |
| API 端点 | `open.kuaishou.com` |
| 图片上传 | `/openapi/photo/image/upload` |
| 图文发布 | `/openapi/photo/publish` |

---

## 脚本清单

| 脚本 | 方案 | 状态 |
|------|------|------|
| `scripts/publish-kuaishou-image.cjs` | CDP v1.x | ✅ |
| `scripts/check-kuaishou-session.cjs` | CDP v1.x | ✅ |
| `scripts/batch-publish-kuaishou.sh` | CDP v1.x | ✅ |
| `scripts/kuaishou-oauth-client.cjs` | API v2.x | ✅ |
| `scripts/kuaishou-api-publisher.cjs` | API v2.x | ✅ |

## 内容目录结构

```
~/.kuaishou-queue/{date}/
├── image-{id}/
│   ├── content.txt     → 文案内容（可选）
│   └── image.jpg       → 图片（可多张：image1.jpg, image2.jpg...）
```

---

**版本**: 2.0.0
**状态**: ✅ CDP 方案（v1.x）+ API OAuth 方案（v2.x）
**架构**: Mac mini → CDP → Windows PC 浏览器 → 快手（方案一）
         Mac mini → Kuaishou Open Platform API → 快手（方案二）
