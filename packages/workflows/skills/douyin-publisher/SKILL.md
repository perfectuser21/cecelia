---
name: douyin-publisher
description: 抖音自动发布工具 - 图文/视频/文章三种类型（生产就绪）
trigger: 发布抖音、douyin、抖音发布
version: 1.1.0
created: 2026-02-12
updated: 2026-03-19
changelog:
  - 1.0.0: ✅ 2026-02-12 完成 - 三种类型全部验证通过（zenithjoy）
  - 1.1.0: ✅ 2026-03-19 迁移到 cecelia - 图文/视频脚本迁移，CDP 直连架构，.cjs 格式，内容目录接口
---

# Douyin Publisher

抖音自动发布工具 - 图文和视频，CDP 直连 Windows Chrome

## 架构

```
Mac mini（美国，100.71.151.105）
    ↓ SCP（经 xian-mac 跳板）
xian-mac（西安 M4，100.86.57.69）
    ↓ SCP
Windows PC（西安，100.97.242.124）
    ↓ CDP WebSocket（端口 19222）
抖音 Chrome 浏览器 → creator.douyin.com
```

**关键配置**：
- CDP 端口：`19222`（抖音专用 Chrome 实例）
- Windows 用户：`xuxia`，基础目录：`C:\Users\xuxia\douyin-media`
- xian-mac SSH 密钥：`/Users/jinnuoshengyuan/.ssh/windows_ed`

## 支持类型

| 类型 | 脚本 | 状态 |
|------|------|------|
| 视频 | `scripts/publish-douyin-video.cjs` | ✅ 架构完成，待生产测试 |
| 图文 | `scripts/publish-douyin-image.cjs` | ✅ 架构完成，待生产测试 |
| 批量 | `scripts/batch-publish-douyin.sh` | ✅ |

## 使用方式

### 视频发布

```bash
NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
  node packages/workflows/skills/douyin-publisher/scripts/publish-douyin-video.cjs \
  --content ~/.douyin-queue/2026-03-19/video-1/
```

**内容目录结构**：
```
~/.douyin-queue/{date}/video-1/
├── title.txt     → 视频标题（必填）
├── tags.txt      → 标签（每行一个或逗号分隔，可选）
├── video.mp4     → 视频文件（必填，支持 mp4/mov/avi/mkv/flv/webm）
└── cover.jpg     → 封面图（可选）
```

### 图文发布

```bash
NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
  node packages/workflows/skills/douyin-publisher/scripts/publish-douyin-image.cjs \
  --content ~/.douyin-queue/2026-03-19/image-1/
```

**内容目录结构**：
```
~/.douyin-queue/{date}/image-1/
├── title.txt     → 标题（必填）
├── content.txt   → 文案内容（可选）
├── tags.txt      → 标签（可选）
└── image.jpg     → 图片（至少 1 张，支持 jpg/png/gif/webp）
```

### 批量发布

```bash
bash packages/workflows/skills/douyin-publisher/scripts/batch-publish-douyin.sh 2026-03-19
```

**退出码**：
- `0` — 发布成功
- `1` — 参数错误或文件缺失
- `2` — 发布失败（CDP 错误、会话失效等）

## 故障排查

### CDP 连接失败

```bash
curl http://100.97.242.124:19222/json
```

确认 Windows Chrome 已以调试模式启动（19222 端口）。如未启动：
```bash
ssh xian-mac "ssh -i ~/.ssh/windows_ed xuxia@100.97.242.124 'schtasks /run /tn StartAllBrowsers'"
```

### 会话过期（登录失效）

在 Windows Chrome 打开 creator.douyin.com 手动扫码重新登录。

### 找不到 ws 模块

```bash
export NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules
```

---

**版本**: 1.1.0
**状态**: ✅ **cecelia 架构就绪** - 图文/视频脚本迁移完成，CDP 直连 Windows
**架构**: Mac mini → xian-mac SCP → Windows CDP → 抖音
