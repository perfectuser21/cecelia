---
name: kuaishou-publisher
description: 快手自动发布工具 - 图文发布（新 API 方案：CDP Cookie + HTTP 直接调用，生产就绪）
trigger: 发布快手、kuaishou、快手发布、kuaishou-publisher
version: 1.3.0
created: 2026-03-10
updated: 2026-03-10
changelog:
  - 1.0.0: 初始版本 - 图文发布，CDP 直连方式
  - 1.1.0: OAuth 会话检查脚本 + 批量发布前置防护
  - 1.2.0: 新增 API 方案（publish-kuaishou-api.cjs）— CDP 提取 Cookie + HTTP 直接调用
  - 1.3.0: 批量发布脚本切换为新 API 方案，旧方案保留作备用
---

# Kuaishou Publisher

快手自动发布工具 - 支持两种发布方案

## 实现状态（2026-03-10）

| 类型 | 方案 | 状态 | 说明 |
|------|------|------|------|
| 图文（新 API） | publish-kuaishou-api.cjs | 推荐 | CDP Cookie + HTTP API，稳定快速 |
| 图文（CDP 旧方案） | publish-kuaishou-image.cjs | 备用 | 浏览器 UI 自动化 |
| 会话检查 | check-kuaishou-session.cjs | 已实现 | 发布前 OAuth 验证 |
| 批量发布 | batch-publish-kuaishou.sh | 已实现 | 默认用新 API 方案 |

## 架构

Mac mini (100.86.57.69 / localhost)
  CDP WebSocket (Tailscale 内网直连)
Windows PC (100.97.242.124:19223)
  提取 Cookie（新方案）/ 浏览器 UI 自动化（旧方案）
快手 CP API (cp.kuaishou.com) -> 快手发布成功

CDP 端口：19223（快手专用）

## 核心脚本

packages/workflows/skills/kuaishou-publisher/scripts/
- publish-kuaishou-api.cjs     # 新 API 方案（推荐）
- publish-kuaishou-image.cjs   # 旧 CDP 方案（备用）
- check-kuaishou-session.cjs   # OAuth 会话检查
- batch-publish-kuaishou.sh    # 批量发布
- __tests__/publish-kuaishou-api.test.cjs  # 单元测试

## 使用方式

### 会话检查（发布前先运行）

NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
  node packages/workflows/skills/kuaishou-publisher/scripts/check-kuaishou-session.cjs

输出：
- [SESSION_OK] — 可以发布（exit 0）
- [SESSION_EXPIRED] — 需要在 Windows Chrome 重新登录快手 CP（exit 2）
- [CDP_ERROR] — Windows PC 未连接（exit 1）

### 单条发布（新 API 方案）

NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
  node packages/workflows/skills/kuaishou-publisher/scripts/publish-kuaishou-api.cjs \
  --content ~/.kuaishou-queue/2026-03-10/image-1/

### 批量发布

bash packages/workflows/skills/kuaishou-publisher/scripts/batch-publish-kuaishou.sh 2026-03-10

## 内容目录格式

~/.kuaishou-queue/{date}/
- image-1/
  - content.txt     （可选，文案）
  - image.jpg       （图片，支持 image1.jpg, image2.jpg...）
  - done.txt        （发布完成后自动创建）

## 配置

| 参数 | 值 |
|------|-----|
| Windows PC IP | 100.97.242.124 |
| CDP 端口 | 19223 |
| 会话 Cookie | kuaishou.web.cp.api_st / kuaishou.web.cp.api_ph |
| NODE_PATH | /Users/administrator/perfect21/cecelia/node_modules |

## 故障排查

CDP 连接失败: curl http://100.97.242.124:19223/json
API 端点 404: 在 Windows Chrome DevTools Network 面板抓包重新发布，更新 publish-kuaishou-api.cjs 端点
找不到 ws 模块: export NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules
