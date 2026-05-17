---
name: zhihu-publisher
description: 知乎文章自动发布工具 - 图文文章（生产就绪）
trigger: 发布知乎、zhihu、知乎发布、知乎专栏
version: 1.0.0
created: 2026-03-10
updated: 2026-03-10
changelog:
  - 1.1.0: 补充 Brain content_publish 任务回调规范（platform_post_id）
  - 1.0.0: 初始版本 - CDP 自动化发布 + 批量调度脚本
---

# Zhihu Publisher

知乎专栏文章自动发布工具 - 完全自动化，通过 CDP 控制 Windows Chrome 发布

## ✅ 验证通过（2026-03-10）

| 类型 | 方案 | 状态 | 说明 |
|------|------|------|------|
| **文章** | CDP UI 自动化 | ✅ 生产可用 | 标题 + 正文 + 封面图 |

---

## 🏗️ 架构

```
美国 VPS / Mac mini
    ↓ NODE_PATH 加载
Node.js CJS 脚本
    ↓ CDP WebSocket (19229)
Windows PC Chrome (100.97.242.124)
    ↓ 自动化操作
知乎专栏发布成功 ✅
```

**关键配置**：
- Windows IP：`100.97.242.124`（Tailscale 内网）
- CDP 端口：`19229`（知乎专用）
- Windows 媒体目录：`C:\Users\xuxia\zhihu-media`

---

## 📝 脚本位置

| 脚本 | 功能 | 状态 |
|------|------|------|
| `/Users/administrator/perfect21/zenithjoy/services/creator/scripts/publishers/zhihu-publisher/publish-zhihu-article.cjs` | 单篇文章发布（CDP 自动化） | ✅ 生产可用 |
| `/Users/administrator/perfect21/zenithjoy/services/creator/scripts/publishers/zhihu-publisher/batch-publish-zhihu.sh` | 批量发布（扫描队列目录） | ✅ 生产可用 |

---

## 🚀 使用方式

### 单篇发布

```bash
NODE_PATH=/Users/administrator/perfect21/zenithjoy/services/creator/scripts/publishers/node_modules \
  node /Users/administrator/perfect21/zenithjoy/services/creator/scripts/publishers/zhihu-publisher/publish-zhihu-article.cjs --content /path/to/article-1/

# 干运行（不实际连接 CDP）
node /Users/administrator/perfect21/zenithjoy/services/creator/scripts/publishers/zhihu-publisher/publish-zhihu-article.cjs --content /path/to/article-1/ --dry-run
```

**内容目录结构**：
```
article-1/
├── title.txt     # 标题（必需，100字以内）
├── content.txt   # 正文（必需）
└── cover.jpg     # 封面图（可选，支持 .jpg/.jpeg/.png）
```

### 批量发布

```bash
# 发布指定日期的内容
bash /Users/administrator/perfect21/zenithjoy/services/creator/scripts/publishers/zhihu-publisher/batch-publish-zhihu.sh 2026-03-10

# 发布今天的内容
bash /Users/administrator/perfect21/zenithjoy/services/creator/scripts/publishers/zhihu-publisher/batch-publish-zhihu.sh
```

**队列目录结构**（`~/.zhihu-queue/YYYY-MM-DD/`）：
```
~/.zhihu-queue/
└── 2026-03-10/
    ├── article-1/
    │   ├── title.txt
    │   ├── content.txt
    │   └── cover.jpg      # 可选
    └── article-2/
        ├── title.txt
        └── content.txt
```
发布完成后自动创建 `article-1/done.txt`，下次运行跳过。

---

## 🔧 前置条件

1. **Windows Chrome 以调试模式运行**（端口 19229）：
   ```
   chrome.exe --remote-debugging-port=19229
   ```

2. **知乎已登录**：在 Chrome 中打开 `https://zhuanlan.zhihu.com/write` 并完成登录

3. **Tailscale 连通**：确认 VPS/Mac mini 能访问 `100.97.242.124:19229`

4. **Node.js 依赖**：已安装 zenithjoy publishers 依赖（`npm install` in `services/creator/scripts/publishers/`）

---

## 📋 发布流程

```
1. CDP 连接 Windows Chrome (19229)
2. 导航到 https://zhuanlan.zhihu.com/write
3. 检查登录状态
4. 填写标题（native setter + input/change 事件）
5. 填写正文（draft-js 编辑器 execCommand('insertText')）
6. 上传封面图（可选，DOM.setFileInputFiles）
7. 点击"发布"按钮
8. 等待跳转到文章页（/p/数字）
9. 返回文章链接
```

---

## ⚠️ 已知问题与排查

### 登录失效
- **症状**：导航后跳转到 zhihu.com/signin
- **排查**：在 Chrome (19229) 重新登录知乎
- **验证**：`curl http://100.97.242.124:19229/json`

### 正文编辑器未找到
- **症状**：`正文编辑器未找到: {"success":false}`
- **排查**：检查截图 `/tmp/zhihu-publish-screenshots/`，知乎页面可能改版

### 发布按钮未找到
- **症状**：`未能点击发布按钮`
- **排查**：检查截图 `06-before-publish.png`，确认内容不为空

---

## 🧪 测试

```bash
# 单元测试（纯函数，无需 CDP）
# 测试已迁移到 zenithjoy repo

# 干运行测试（验证参数，不实际发布）
node /Users/administrator/perfect21/zenithjoy/services/creator/scripts/publishers/zhihu-publisher/publish-zhihu-article.cjs --content /tmp/test-article/ --dry-run
```

---

---

## Brain 任务回调（platform_post_id）

当本 skill 作为 Brain `content_publish` 任务（`platform=zhihu`）执行时，发布成功后**必须**将 platform_post_id 写回 Brain。

### 提取规则

| 脚本 | 输出样本 | 提取正则 |
|------|---------|---------|
| `publish-zhihu-article.cjs` | `文章 URL: https://zhuanlan.zhihu.com/p/1234567890` | `/zhihu\.com\/p\/(\d+)/` |

### 任务 result 格式

发布完成后，在 execution-callback `result` 中包含：

```json
{
  "platform_post_id": "1234567890",
  "url": "https://zhuanlan.zhihu.com/p/1234567890"
}
```

Brain 的 `execution.js` 会读取此字段并写入 `zenithjoy.publish_logs.platform_post_id`，供 KR1（非微信7日成功率）统计。

---

**版本**: 1.1.0
**状态**：✅ **生产就绪**
**架构**：队列目录 → batch 脚本 → CJS 发布脚本 → Windows CDP → 知乎
