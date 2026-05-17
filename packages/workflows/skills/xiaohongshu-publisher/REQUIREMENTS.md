---
id: xhs-publisher-requirements
version: 1.1.0
created: 2026-03-08
updated: 2026-03-10
changelog:
  - 1.1.0: 修正脚本名和队列目录引用（xhs → xiaohongshu）
  - 1.0.0: 初始版本
---

# 小红书发布器 - 字段规范

**版本**: 1.1.0
**日期**: 2026-03-10

---

## 图文 (image)

```
title.txt       → 标题（必需，小红书要求填写标题）
content.txt     → 正文（可选，支持话题 #xxx#）
image.jpg       → 图片（必需，至少 1 张）
```

**目录结构**:
```
image-1/
├── title.txt     （必需，标题内容）
├── content.txt   （可选，支持 #话题# 格式）
└── image.jpg     （可以有多张：image1.jpg, image2.jpg, ...）
```

---

## 对比总结

| 字段 | 图文 | 说明 |
|------|:----:|------|
| title | ✓ | 必需，小红书强制要求标题 |
| content | ○ | 正文，可选，支持话题 |
| image(s) | ✓ | 至少 1 张 |

**图例**: ✓ 必需 | ○ 可选

---

## 队列目录

```
~/.xiaohongshu-queue/
└── {date}/                    # 日期目录，格式：YYYY-MM-DD
    ├── image-1/               # 第一条图文
    │   ├── title.txt          # 标题（必需）
    │   ├── content.txt        # 正文（可选）
    │   ├── image.jpg          # 图片
    │   └── done.txt           # 发布完成后自动创建
    └── image-2/               # 第二条图文
        ├── title.txt
        └── image.jpg
```

---

## 快速参考

```bash
# 图文（标题必需，至少 1 张图）
title.txt (必需) + content.txt (可选) + image.jpg

# 批量发布
bash scripts/batch-publish-xiaohongshu.sh YYYY-MM-DD

# 单条发布
NODE_PATH=/Users/administrator/perfect21/zenithjoy/services/creator/scripts/publishers/node_modules \
  node scripts/publish-xiaohongshu-image.cjs --content ~/.xiaohongshu-queue/2026-03-08/image-1/
```
