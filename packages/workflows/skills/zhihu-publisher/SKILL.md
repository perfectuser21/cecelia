---
name: zhihu-publisher
description: 知乎文章自动发布工具 - 图文文章（生产就绪）
trigger: 发布知乎、知乎发布、zhihu、知乎文章、知乎写作
version: 1.0.0
created: 2026-03-08
updated: 2026-03-08
changelog:
  - 1.0.0: 初始版本 - 文章发布，CDP 直连方式
---

# Zhihu Publisher

知乎文章自动发布工具 - Mac mini 直连 CDP 方式（对标 xiaohongshu-publisher）

## 架构

```
Mac mini (100.86.57.69 / localhost)
    ↓ CDP WebSocket (Tailscale 内网直连)
Windows PC (100.97.242.124:19229)
    ↓ 浏览器自动化（Chrome 已登录知乎）
知乎发布成功
```

## 核心脚本

```
packages/workflows/skills/zhihu-publisher/
├── SKILL.md
└── scripts/
    ├── publish-zhihu-article.cjs   # 主发布脚本（Node.js CDP）
    ├── batch-publish-zhihu.sh      # 批量发布
    └── __tests__/                  # 单元测试
```

## 使用方式

### 单条发布

```bash
NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
  node packages/workflows/skills/zhihu-publisher/scripts/publish-zhihu-article.cjs \
  --content ~/.zhihu-queue/2026-03-08/article-1/
```

### --dry-run 验证（不实际发布）

```bash
node ... --content /path/to/article/ --dry-run
```

### 批量发布

```bash
bash packages/workflows/skills/zhihu-publisher/scripts/batch-publish-zhihu.sh 2026-03-08
```

### 内容目录结构

```
~/.zhihu-queue/{date}/
├── article-{id}/
│   ├── title.txt       → 标题（必需）
│   ├── content.txt     → 正文内容（必需）
│   └── cover.jpg       → 封面图（可选）
```

## 配置

| 参数 | 值 |
|------|-----|
| Windows PC IP | `100.97.242.124` |
| CDP 端口 | `19229`（知乎专用） |
| 发布页面 | `https://zhuanlan.zhihu.com/write` |
| Windows 内容目录 | `C:\Users\xuxia\zhihu-media\` |

## Windows PC Chrome 启动命令

```batch
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=19229 ^
  --user-data-dir="C:\Users\xuxia\chrome-profiles\zhihu" ^
  https://zhuanlan.zhihu.com
```

## 故障排查

```bash
# 测试 CDP 连接
curl http://100.97.242.124:19229/json

# Dry-run 验证
node ... --content /path/ --dry-run

# 查看截图
ls -la /tmp/zhihu-publish-screenshots/
```
