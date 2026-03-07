---
id: kuaishou-publisher-requirements
version: 1.0.0
created: 2026-03-07
updated: 2026-03-07
changelog:
  - 1.0.0: 初始版本
---

# 快手发布器 - 字段规范

**版本**: 1.0.0
**日期**: 2026-03-07

---

## 图文 (image)

```
content.txt     → 文案（可选）
image.jpg       → 图片（必需，至少 1 张）
```

**目录结构**:
```
image-1/
├── content.txt   （可选）
└── image.jpg     （可以有多张：image1.jpg, image2.jpg, ...）
```

---

## 对比总结

| 字段 | 图文 | 说明 |
|------|:----:|------|
| content | ○ | 文案，可选 |
| image(s) | ✓ | 至少 1 张 |

**图例**: ✓ 必需 | ○ 可选

---

## 队列目录

```
~/.kuaishou-queue/
└── {date}/                    # 日期目录，格式：YYYY-MM-DD
    ├── image-1/               # 第一条图文
    │   ├── content.txt        # 文案（可选）
    │   ├── image.jpg          # 图片
    │   └── done.txt           # 发布完成后自动创建
    └── image-2/               # 第二条图文
        └── image.jpg
```

---

## 快速参考

```bash
# 图文（至少 1 张图）
content.txt (可选) + image.jpg

# 批量发布
bash scripts/batch-publish-kuaishou.sh YYYY-MM-DD

# 单条发布
NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
  node scripts/publish-kuaishou-image.cjs --content ~/.kuaishou-queue/2026-03-07/image-1/
```
