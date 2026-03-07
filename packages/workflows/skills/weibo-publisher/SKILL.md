---
name: weibo-publisher
description: 微博自动发布工具 - 图文发布（CDP 直连方式，含验证码处理）
trigger: 发布微博、weibo、微博发布
version: 1.0.0
created: 2026-03-07
updated: 2026-03-07
changelog:
  - 1.0.0: 初始版本 - 图文发布，CDP 直连方式，含滑块验证码自动处理
---

# Weibo Publisher

微博自动发布工具 - 图文内容，Mac mini 直连 CDP 方式，含验证码自动处理

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

| 类型 | 脚本 | 状态 |
|------|------|------|
| 图文 | `scripts/publish-weibo-image.cjs` | ✅ |

## 使用方式

### 单条发布

```bash
NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
  node packages/workflows/skills/weibo-publisher/scripts/publish-weibo-image.cjs \
  --content ~/.weibo-queue/2026-03-07/image-1/
```

### 批量发布

```bash
bash packages/workflows/skills/weibo-publisher/scripts/batch-publish-weibo.sh 2026-03-07
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
| Windows 图片目录 | `C:\Users\xuxia\weibo-media\{date}\images\` |
| 截图目录（调试） | `/tmp/weibo-publish-screenshots/` |
| NODE_PATH | `/Users/administrator/perfect21/cecelia/node_modules` |

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
