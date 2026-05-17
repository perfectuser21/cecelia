---
id: wechat-publisher-requirements
version: 1.0.0
created: 2026-03-10
updated: 2026-03-10
changelog:
  - 1.0.0: 初始版本
---

# 微信公众号发布器 - 字段规范

**版本**: 1.0.0
**日期**: 2026-03-10

---

## 图文 (article)

```
title.txt      → 文章标题（必需）
content.html   → HTML 正文（优先，与 content.txt 二选一）
content.txt    → 纯文本正文（如无 content.html，自动转 HTML）
digest.txt     → 摘要（可选，最多 54 字，默认取标题前 54 字）
author.txt     → 作者（可选）
cover.jpg      → 封面图（可选，建议 900×383px，< 1MB）
```

**目录结构**:
```
article-1/
├── title.txt       （必需）
├── content.html    （必需，与 content.txt 二选一）
├── content.txt     （必需，与 content.html 二选一）
├── digest.txt      （可选）
├── author.txt      （可选）
└── cover.jpg       （可选，支持 .jpg/.jpeg/.png/.gif/.webp）
```

---

## 对比总结

| 字段 | 类型 | 要求 | 说明 |
|------|------|------|------|
| title | 文本 | ✓ 必需 | 文章标题 |
| content | HTML/文本 | ✓ 必需 | 正文（HTML 优先） |
| digest | 文本 | ○ 可选 | 摘要，最多 54 字 |
| author | 文本 | ○ 可选 | 作者名 |
| cover | 图片 | ○ 可选 | 封面图 |

**图例**: ✓ 必需 | ○ 可选

---

## 队列目录

```
~/.wechat-queue/
└── {date}/                    # 日期目录，格式：YYYY-MM-DD
    ├── article-1/             # 第一篇文章
    │   ├── title.txt          # 标题
    │   ├── content.html       # 正文
    │   ├── cover.jpg          # 封面（可选）
    │   └── done.txt           # 发布完成后自动创建
    └── article-2/             # 第二篇文章
        ├── title.txt
        └── content.txt        # 纯文本（自动转 HTML）
```

---

## 快速参考

```bash
# Token 检查
node check-wechat-token.cjs

# 内容目录发布
NODE_PATH=/Users/administrator/perfect21/zenithjoy/services/creator/scripts/publishers/node_modules \
  node publish-wechat-article.cjs --content-dir ~/.wechat-queue/2026-03-10/article-1/

# 直接参数发布
NODE_PATH=/Users/administrator/perfect21/zenithjoy/services/creator/scripts/publishers/node_modules \
  node publish-wechat-article.cjs \
  --title "今日分享" \
  --content "<p>内容</p>" \
  --author "作者" \
  --digest "摘要"
```
