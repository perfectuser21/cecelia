---
name: weibo-publisher
description: 微博自动发布工具 - 图文发布（生产就绪）
trigger: 发布微博、weibo、微博发布
version: 1.3.0
created: 2026-03-07
updated: 2026-03-10
changelog:
  - 1.3.0: 新增 API 方案（publish-weibo-api.cjs）— CDP 提取 Cookie + HTTP 直接调用，不触发验证码
  - 1.2.0: 修复 Windows 路径 Bug（移除多余的 images/ 子目录），使用 utils.cjs 工具函数
  - 1.1.0: 提取 CDPClient 为独立可测试模块，增加单元测试覆盖率
  - 1.0.0: 初始版本 - 图文发布，CDP 直连方式，含滑块验证码自动处理
---

# Weibo Publisher

微博自动发布工具 - 图文内容，支持两种发布方案

## 方案对比

| 方案 | 脚本 | 原理 | 优势 | 劣势 |
|------|------|------|------|------|
| CDP 自动化（旧） | `publish-weibo-image.cjs` | CDP 控制浏览器 UI | 不需了解 API | 触发验证码、受页面改版影响 |
| 新 API 方案 | `publish-weibo-api.cjs` | CDP 提取 Cookie → HTTP 直接调用 | 稳定、快速、不触发验证码 | 依赖内部 API 格式不变 |

**推荐使用新 API 方案**（publish-weibo-api.cjs）。

## 架构

```
Mac mini (100.86.57.69 / localhost)
    ↓ CDP WebSocket (Tailscale 内网直连)
Windows PC (100.97.242.124:19227)
    ↓ 浏览器自动化
微博发布成功
```

**关键区别（与头条/抖音不同）**：
- 不需要 SSH 到 Windows PC
- 直接从 Mac mini 通过 CDP 控制浏览器
- CDP 端口：19227（微博专用）
- **含验证码处理**：自动识别并处理微博滑块验证码

## 支持类型

| 类型 | 脚本 | 状态 | 说明 |
|------|------|------|------|
| 图文（新 API） | `scripts/publish-weibo-api.cjs` | ✅ 推荐 | Cookie + HTTP API，不触发验证码 |
| 图文（CDP 旧方案） | `scripts/publish-weibo-image.cjs` | ✅ 备用 | 浏览器 UI 自动化 |

## 使用方式

### 新 API 方案（推荐）

```bash
# 单条发布
NODE_PATH=/Users/administrator/perfect21/zenithjoy/services/creator/scripts/publishers/node_modules \
  node /Users/administrator/perfect21/zenithjoy/services/creator/scripts/publishers/weibo-publisher/publish-weibo-api.cjs \
  --content ~/.weibo-queue/2026-03-07/image-1/
```

### 旧 CDP 方案（备用）

```bash
NODE_PATH=/Users/administrator/perfect21/zenithjoy/services/creator/scripts/publishers/node_modules \
  node /Users/administrator/perfect21/zenithjoy/services/creator/scripts/publishers/weibo-publisher/publish-weibo-image.cjs \
  --content ~/.weibo-queue/2026-03-07/image-1/
```

### 批量发布

```bash
bash /Users/administrator/perfect21/zenithjoy/services/creator/scripts/publishers/weibo-publisher/batch-publish-weibo.sh 2026-03-07
```

### 内容目录结构

```
~/.weibo-queue/{date}/
├── image-{id}/
│   ├── content.txt     → 文案内容（可选，支持话题 #xxx#）
│   └── image.jpg       → 图片（可多张：image1.jpg, image2.jpg...）
```

## 配置

| 参数 | 值 |
|------|-----|
| Windows PC IP | `100.97.242.124` |
| CDP 端口 | `19227` |
| 发布页面 | `https://weibo.com/p/publish/` |
| Windows 图片目录 | `C:\Users\xuxia\weibo-media\{date}\{contentDirName}\{file}` |
| 截图目录（调试） | `/tmp/weibo-publish-screenshots/` |
| NODE_PATH | `/Users/administrator/perfect21/zenithjoy/services/creator/scripts/publishers/node_modules` |

## 验证码处理模块

微博在自动化操作时会显示滑块验证码（天鉴验证）。本工具内置验证码自动处理：

1. **检测**：识别页面中的验证码遮罩层（`[class*="geetest"]`、`[class*="tc-9bad"]` 等）
2. **截图**：保存验证码截图用于调试
3. **滑动**：使用 CDP `Input.dispatchMouseEvent` 模拟自然人手拖动轨迹（含加速度曲线）
4. **验证**：等待验证码消失确认成功，超时后报错

### 验证码故障排查

```bash
# 查看验证码截图
ls -la /tmp/weibo-publish-screenshots/

# 检查 CDP 连接
curl http://100.97.242.124:19227/json

# 手动重置：在 Windows PC 上手动过一次验证码后重试
```

## 故障排查

### CDP 连接失败

```bash
curl http://100.97.242.124:19227/json
```

**常见原因**：
- Windows PC Chrome 未以调试模式启动（需 `--remote-debugging-port=19227`）
- Tailscale 网络断开（`tailscale status` 检查）
- Chrome 已更新且端口配置丢失

### 验证码持续失败

- 微博检测到自动化行为，可能需要在 Windows PC 上手动过一次验证码恢复信任
- 查看截图 `/tmp/weibo-publish-screenshots/captcha-*.png` 了解验证码类型

### 微博登录失效

在 Windows PC 的 Chrome（19227）上重新登录微博账号。
