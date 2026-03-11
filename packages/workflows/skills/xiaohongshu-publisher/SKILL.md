---
name: xiaohongshu-publisher
description: 小红书自动发布工具 - 图文发布（CDP 直连方式）
trigger: 发布小红书、xiaohongshu、xhs、小红书发布
version: 1.2.0
created: 2026-03-08
updated: 2026-03-10
changelog:
  - 1.2.0: 清理废弃旧脚本（publish-xhs-image.cjs + batch-publish-xhs.sh）
  - 1.1.0: N8N flow 完整接通 Node.js 脚本，生产就绪
  - 1.0.0: 初始版本 - 图文发布，CDP 直连方式
---

# Xiaohongshu Publisher

小红书自动发布工具 - 图文内容，N8N → SSH → Mac mini → CDP → Windows PC Chrome

## 架构

```
N8N Webhook (美国 VPS)
    ↓ platform === 'xiaohongshu'
SSH 到 Mac mini (100.108.7.63)
    ↓ publish-xiaohongshu-image.cjs --content {contentDir}
Mac mini CDP WebSocket (Tailscale 内网直连)
    ↓ CDP WebSocket
Windows PC (100.97.242.124:19225)
    ↓ 浏览器自动化
小红书发布成功 → 飞书通知
```

## 支持类型

| 类型 | 脚本 | 状态 |
|------|------|------|
| 图文 | `scripts/publish-xiaohongshu-image.cjs` | ✅ 生产就绪 |

## 使用方式

### 通过 N8N Webhook（推荐）

```bash
curl -X POST https://n8n.zenjoymedia.media/webhook/content-publish \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "task-001",
    "title": "文章标题（用于飞书通知）",
    "content": "正文摘要（用于飞书通知）",
    "contentDir": "/Users/administrator/.xiaohongshu-queue/2026-03-10/image-1",
    "targetPlatforms": ["xiaohongshu"]
  }'
```

**注意**: `contentDir` 是 Mac mini 上的内容目录路径，必须：
- 已存在且包含至少一张图片（`.jpg/.jpeg/.png/.gif/.webp`）
- 可选包含 `title.txt`（标题）和 `content.txt`（正文）

### 单条发布（直接运行）

```bash
# 在 Mac mini 上执行
NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
  node ~/perfect21/cecelia/packages/workflows/skills/xiaohongshu-publisher/scripts/publish-xiaohongshu-image.cjs \
  --content ~/.xiaohongshu-queue/2026-03-10/image-1/
```

### 批量发布

```bash
# 在 Mac mini 上执行
bash ~/perfect21/cecelia/packages/workflows/skills/xiaohongshu-publisher/scripts/batch-publish-xiaohongshu.sh 2026-03-10
```

### 内容目录结构

```
~/.xiaohongshu-queue/{date}/
├── image-{id}/
│   ├── title.txt       → 标题（可选，不超过 20 字；无则从正文前 20 字生成）
│   ├── content.txt     → 正文（可选，支持 #话题# 格式）
│   └── image.jpg       → 图片（必需，最多 9 张：image1.jpg, image2.jpg...）
└── image-{id}/done.txt → 发布成功后自动创建，批量发布时跳过
```

## 配置

| 参数 | 值 |
|------|-----|
| Mac mini IP (Tailscale) | `100.108.7.63` |
| Windows PC IP | `100.97.242.124` |
| CDP 端口 | `19225` |
| 发布页面 | `https://creator.xiaohongshu.com/publish/publish` |
| Windows 图片目录 | `C:\Users\xuxia\xiaohongshu-media\{date}\{dir}\` |
| 截图目录（调试） | `/tmp/xiaohongshu-publish-screenshots/` |
| NODE_PATH | `/Users/administrator/perfect21/cecelia/node_modules` |
| N8N SSH Credential | VPS SSH Key (ID: vvJsQOZ95sqzemla) |

## N8N Flow 节点说明

| 节点 ID | 名称 | 说明 |
|---------|------|------|
| n2 | 准备 | 解析请求，提取 contentDir，supported 包含 xiaohongshu |
| n3 | 是否跳过 | IF 判断 skip |
| n10 | 平台路由 | Switch 节点，xiaohongshu → output[1] → n9 |
| n9 | SSH-小红书 | SSH 到 Mac mini (100.108.7.63)，执行 publish-xiaohongshu-image.cjs |
| n11 | 解析-小红书 | 优先 JSON 解析，降级关键词匹配，构建飞书通知 |
| n12 | 飞书-小红书 | 发送发布结果通知 |

## 故障排查

### CDP 连接失败

```bash
# 在 Mac mini 上检查
curl http://100.97.242.124:19225/json
```

**常见原因**：
- Windows PC Chrome（19225）未以调试模式启动
- Tailscale 网络断开（`tailscale status` 检查）

### 登录失效

在 Windows PC 的 Chrome（19225）上重新登录小红书账号（creator.xiaohongshu.com）。

### 查看调试截图

```bash
ls -la /tmp/xiaohongshu-publish-screenshots/
```

### 图片未上传到 Windows PC

图片必须预置在 Windows PC 对应目录：
```
C:\Users\xuxia\xiaohongshu-media\{date}\{content-dir-name}\*.jpg
```
与 Mac mini 的 `contentDir` 结构对应，通过 Tailscale 文件共享或手动同步。
