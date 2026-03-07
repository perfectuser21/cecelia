---
name: kuaishou-publisher
description: 快手自动发布工具 - 图文发布（CDP 直连方式）
trigger: 发布快手、kuaishou、快手发布
version: 1.0.0
created: 2026-03-07
updated: 2026-03-07
changelog:
  - 1.0.0: 初始版本 - 图文发布，CDP 直连方式
---

# Kuaishou Publisher

快手自动发布工具 - 图文内容，Mac mini 直连 CDP 方式

## 架构

```
Mac mini (100.86.57.69 / localhost)
    ↓ CDP WebSocket (Tailscale 内网直连)
Windows PC (100.97.242.124:19223)
    ↓ 浏览器自动化
快手发布成功
```

**关键区别（与头条/抖音不同）**：
- 不需要 SSH 到 Windows PC
- 直接从 Mac mini 通过 CDP 控制浏览器
- CDP 端口：19223（快手专用）

## 支持类型

| 类型 | 脚本 | 状态 |
|------|------|------|
| 图文 | `scripts/publish-kuaishou-image.cjs` | ✅ |

## 使用方式

### 单条发布

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
| Windows 图片目录 | `C:\Users\xuxia\kuaishou-media\{date}\images\` |
| 截图目录（调试） | `/tmp/kuaishou-publish-screenshots/` |
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

---

**版本**: 1.0.0
**状态**: ✅ 图文发布已实现
**架构**: Mac mini → CDP → Windows PC 浏览器 → 快手
