---
name: xiaohongshu-publisher
description: 小红书自动发布工具 - 图文发布（CDP 直连方式）
trigger: 发布小红书、xiaohongshu、xhs、小红书发布
version: 1.0.0
created: 2026-03-08
updated: 2026-03-08
changelog:
  - 1.0.0: 初始版本 - 图文发布，CDP 直连方式
---

# Xiaohongshu Publisher

小红书自动发布工具 - 图文内容，Mac mini 直连 CDP 方式

## 架构

```
Mac mini (100.86.57.69 / localhost)
    ↓ CDP WebSocket (Tailscale 内网直连)
Windows PC (100.97.242.124:19224)
    ↓ 浏览器自动化
小红书发布成功
```

**关键区别（与头条/抖音不同）**：
- 不需要 SSH 到 Windows PC
- 直接从 Mac mini 通过 CDP 控制浏览器
- CDP 端口：19224（小红书专用）

## 支持类型

| 类型 | 脚本 | 状态 |
|------|------|------|
| 图文 | `scripts/publish-xhs-image.cjs` | ✅ |

## 使用方式

### 单条发布

```bash
NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
  node packages/workflows/skills/xiaohongshu-publisher/scripts/publish-xhs-image.cjs \
  --content ~/.xhs-queue/2026-03-08/image-1/
```

### 批量发布

```bash
bash packages/workflows/skills/xiaohongshu-publisher/scripts/batch-publish-xhs.sh 2026-03-08
```

### 内容目录结构

```
~/.xhs-queue/{date}/
├── image-{id}/
│   ├── title.txt       → 标题（必需，小红书要求标题）
│   ├── content.txt     → 正文内容（可选，支持 #话题#）
│   └── image.jpg       → 图片（可多张：image1.jpg, image2.jpg...）
```

## 配置

| 参数 | 值 |
|------|-----|
| Windows PC IP | `100.97.242.124` |
| CDP 端口 | `19224` |
| 发布页面 | `https://creator.xiaohongshu.com/publish/publish` |
| Windows 图片目录 | `C:\Users\xuxia\xhs-media\{date}\{dir}\` |
| 截图目录（调试） | `/tmp/xhs-publish-screenshots/` |
| NODE_PATH | `/Users/administrator/perfect21/cecelia/node_modules` |

## 故障排查

### CDP 连接失败

```bash
curl http://100.97.242.124:19224/json
```

**常见原因**：
- Windows PC Chrome（19224）未以调试模式启动
- Tailscale 网络断开（`tailscale status` 检查）

### 登录失效

在 Windows PC 的 Chrome（19224）上重新登录小红书账号（creator.xiaohongshu.com）。

### 查看调试截图

```bash
ls -la /tmp/xhs-publish-screenshots/
```
