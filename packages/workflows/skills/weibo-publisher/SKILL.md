---
name: weibo-publisher
description: 微博自动发布工具 - 图文发布（Playwright CDP 方案）
trigger: 发布微博、weibo、微博发布、weibo-publisher
version: 1.0.0
created: 2026-02-25
updated: 2026-03-07
changelog:
  - 0.1.0: 开发中（框架初始化）
  - 1.0.0: ✅ 2026-03-07 完成 - 图文发布 CDP 方案实现
---

# Weibo Publisher

微博自动发布工具 - 基于 Chrome DevTools Protocol (CDP) 浏览器自动化

## ✅ 实现状态（2026-03-07）

| 类型 | 状态 | 说明 |
|------|------|------|
| **图文** | ✅ 已实现 | 支持文本 + 最多 9 张图片 |
| **视频** | 🔄 待实现 | 后续 feature |

---

## 🏗️ 架构

```
N8N 内容发布 Flow (Cecelia)
    ↓ POST /content-publish
Mac mini (perfect21)
    ↓ python3 publish-weibo-image.py
Windows PC CDP (100.97.242.124:19227)
    ↓ Chrome DevTools Protocol
微博 ✅ (weibo.com)
```

**关键路径**：
- N8N → SSH Mac mini → Python CDP 脚本
- Windows CDP 端口：19227（微博专用）
- 脚本位置：`~/perfect21/zenithjoy/services/creator/scripts/publish-weibo-image.py`

---

## 📝 脚本位置

| 脚本 | 位置 | 状态 |
|------|------|------|
| publish-weibo-image.py | Mac mini: `~/perfect21/zenithjoy/services/creator/scripts/` | ✅ 已实现 |
| N8N 内容发布 Flow | Cecelia: `packages/workflows/n8n/workflows/media/flow-内容发布.json` | ✅ 已更新 |

---

## 📦 接口规范

### 图文发布
```bash
# 仅文字
python3 publish-weibo-image.py '你好微博'

# 图文
python3 publish-weibo-image.py '今日分享' /path/to/img1.jpg /path/to/img2.jpg
```

### N8N 调用
```json
POST /webhook/content-publish
{
  "taskId": "task-001",
  "title": "今日分享",
  "content": "微博正文内容",
  "images": [],
  "targetPlatforms": ["weibo"]
}
```

---

## 🔧 技术方案

1. **CDP 连接** - Python websockets 连接 Windows PC 的 Chrome (port 19227)
2. **文案填写** - 使用原生 setter 绕过框架响应式系统
3. **图片上传** - Base64 编码 → DataTransfer API → file input
4. **发布检测** - 轮询检查成功提示或超时假定成功

---

## ⚠️ 注意事项

- 微博 Web 端需要已登录状态（Chrome Profile 保留登录）
- CDP 端口 19227 是微博专用端口，和其他平台不冲突
- 图片最多 9 张（微博平台限制）
- 字符限制：微博正文 ≤ 2000 字

---

## 🔐 依赖配置

- Windows PC SSH 密钥：`~/.ssh/windows_ed`
- Mac mini SSH 凭据：N8N 中配置 "Mac Mini SSH Key"
- Chrome 已登录微博账号

---

**版本**: 1.0.0
**状态**: ✅ **图文发布已实现**
**架构**: N8N → Mac mini → CDP → Windows Chrome → 微博
**使用**: `python3 publish-weibo-image.py <文案> [图片...]`
