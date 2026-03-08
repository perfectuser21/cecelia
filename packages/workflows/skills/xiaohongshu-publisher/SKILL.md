---
id: xiaohongshu-publisher
version: 1.0.0
created: 2026-03-07
updated: 2026-03-07
changelog:
  - 1.0.0: 初始版本 — CDP 直连方式发布小红书图文笔记
---

# xiaohongshu-publisher — 小红书图文发布 Skill

## 概述

通过 CDP 协议控制 Windows PC 浏览器，向小红书创作者平台发布图文笔记。
架构与微博/快手 publisher 相同（CDP 直连方式），无 SSH 中转。

## 网络拓扑

```
Mac mini (执行 Node.js 脚本)
    ↓ CDP WebSocket (Tailscale 内网直连)
Windows PC 100.97.242.124:19225 (Chrome 调试模式，小红书标签页)
    ↓ 自动化操作
小红书创作者平台 ✅
```

## 前置准备

### Windows PC 配置

1. 以调试模式启动 Chrome（绑定 19225 端口）：
   ```
   chrome.exe --remote-debugging-port=19225 --user-data-dir=C:\Users\xuxia\chrome-xiaohongshu
   ```
   或者在已有 Chrome 中针对小红书页面使用独立实例

2. 在该 Chrome 中登录小红书创作者平台：
   - 访问 https://creator.xiaohongshu.com
   - 完成账号登录（保持会话活跃）

3. 确保媒体目录存在（Mac 和 Windows 路径对应）：
   - Mac 侧：`~/.xiaohongshu-queue/{date}/image-{id}/`
   - Windows 侧：`C:\Users\xuxia\xiaohongshu-media\{date}\image-{id}\`
   - 注意：图片文件需同时存在于两侧（Windows 浏览器上传用 Windows 路径）

## 使用方法

### 单条发布

```bash
NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
  node packages/workflows/skills/xiaohongshu-publisher/scripts/publish-xiaohongshu-image.cjs \
  --content ~/.xiaohongshu-queue/2026-03-07/image-1/
```

**--content 参数**：图文目录路径（必须包含至少一张图片）

### 批量发布

```bash
bash packages/workflows/skills/xiaohongshu-publisher/scripts/batch-publish-xiaohongshu.sh 2026-03-07
```

不传日期默认今天。

## 内容目录结构

```
~/.xiaohongshu-queue/
└── {YYYY-MM-DD}/
    ├── image-1/
    │   ├── content.txt   # 笔记正文（含话题，格式：#话题名称# 文案内容）
    │   ├── title.txt     # 笔记标题（可选，不超过 20 字）
    │   └── image.jpg     # 图片（支持 1-9 张：image.jpg, image1.jpg, image2.jpg...）
    ├── image-2/
    │   └── ...
    └── ...
```

**发布后标记**：成功发布后自动创建 `done.txt`，批量发布时跳过已发布内容。

## 关键配置

| 参数 | 值 | 说明 |
|------|----|------|
| CDP 端口 | **19225** | Windows PC Chrome 小红书专用 |
| Windows IP | 100.97.242.124 | Tailscale 内网地址 |
| Windows 媒体目录 | `C:\Users\xuxia\xiaohongshu-media\` | 图片存放根目录 |
| 发布 URL | https://creator.xiaohongshu.com/publish/publish | 创作者平台发布页 |
| 截图目录 | `/tmp/xiaohongshu-publish-screenshots/` | 调试截图 |
| 批量间隔 | 10 秒 | 发布间隔（防限流） |

## 错误排查

| 错误 | 原因 | 解决方案 |
|------|------|----------|
| CDP 连接失败 | Chrome 未以 19225 调试模式启动 | 重新以 `--remote-debugging-port=19225` 启动 |
| 未找到小红书页面 | Chrome 没有打开小红书标签页 | 手动打开 creator.xiaohongshu.com |
| 未登录 | Cookie 过期 | 手动登录后重试 |
| 图片上传失败 | Windows 路径不匹配 | 确认图片在 Windows 媒体目录中存在 |

## 测试

```bash
node --test packages/workflows/skills/xiaohongshu-publisher/scripts/__tests__/publish-xiaohongshu-image.test.cjs
```
