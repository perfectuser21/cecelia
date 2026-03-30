# Learning: Brain API 图片匹配修复（dan-koe vs dankoe）

**Branch**: cp-03302251-brain-image-fix
**PR**: #1717
**Date**: 2026-03-30

## 根本原因

`content-pipeline.js` 中将 keyword 转为 topic 时，空格和特殊字符被替换为连字符：
- "Dan Koe" → "dan-koe"

但图片文件由其他工具生成，使用的是无连字符命名：
- `dankoe-cover.png`, `dankoe-01-failures.png`

文件扫描 `f.startsWith('dan-koe-')` 无法匹配 `dankoe-cover.png`，导致 `image_urls` 为空。

## 修复

同时扫描两种前缀：带连字符（`dan-koe-`）和不带连字符（`dankoe-`）。

```js
const topicNoDash = topic.replace(/-/g, '');
.filter(f => (f.startsWith(`${topic}-`) || (topicNoDash !== topic && f.startsWith(`${topicNoDash}-`))) && f.endsWith('.png'))
```

## 下次预防

- [ ] 图片生成工具写入文件时统一使用 topic 格式（带连字符），消除歧义
- [ ] Brain API 在创建 pipeline 时存储 `image_prefix` 字段，避免运行时推导
- [ ] 新增单元测试：验证各种 keyword 形式（含空格/驼峰/连字符）都能正确匹配图片
