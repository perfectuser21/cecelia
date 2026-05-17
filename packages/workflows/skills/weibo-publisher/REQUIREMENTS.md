---
id: weibo-publisher-requirements
version: 1.0.0
created: 2026-03-07
updated: 2026-03-07
changelog:
  - 1.0.0: 初始版本
---

# 微博发布器 - 字段规范

**版本**: 1.0.0
**日期**: 2026-03-07

---

## 图文 (image)

```
content.txt     → 文案（可选，支持话题 #xxx#）
image.jpg       → 图片（必需，至少 1 张）
```

**目录结构**:
```
image-1/
├── content.txt   （可选，支持 #话题# 格式）
└── image.jpg     （可以有多张：image1.jpg, image2.jpg, ...）
```

---

## 对比总结

| 字段 | 图文 | 说明 |
|------|:----:|------|
| content | ○ | 文案，可选，支持话题 |
| image(s) | ✓ | 至少 1 张 |

**图例**: ✓ 必需 | ○ 可选

---

## 队列目录

```
~/.weibo-queue/
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
bash scripts/batch-publish-weibo.sh YYYY-MM-DD

# 单条发布
NODE_PATH=/Users/administrator/perfect21/zenithjoy/services/creator/scripts/publishers/node_modules \
  node scripts/publish-weibo-image.cjs --content ~/.weibo-queue/2026-03-07/image-1/
```

---

## 验证码说明

微博在自动化操作时可能触发天鉴（GeeTest）滑块验证码。本工具内置自动处理：
- 检测验证码容器（多个选择器覆盖不同版本）
- 模拟人手拖动滑块（缓动曲线 + 轻微抖动）
- 截图保存到 `/tmp/weibo-publish-screenshots/` 用于调试

如果验证码持续失败，请在 Windows PC (19227) 上手动通过一次验证码，恢复账号信任。
