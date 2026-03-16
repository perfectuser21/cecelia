# Learning: 公众号图文混排 - HTML 内嵌图片自动上传（2026-03-16）

**分支**: `cp-03161644-wechat-inline-images`
**类型**: feat

---

## 微信公众号 API 的两套图片接口不能混用

### 根本原因

`draft/add` 的 `thumb_media_id` 字段要求永久素材 `media_id`，必须用 `material/add_material` 接口上传。原脚本使用 `media/uploadimg`（只返回 URL，无 `media_id`），导致草稿创建时无法传入有效的 `thumb_media_id`，触发 `errcode=40007`。

### 下次预防

- [ ] 凡涉及微信 `draft/add` 的 `thumb_media_id` 字段，必须用 `material/add_material` 接口，不能用 `media/uploadimg`
- [ ] 正文内嵌图片用 `media/uploadimg`（返回 CDN URL），封面用 `material/add_material`（返回 media_id），两套接口职责明确，不可混用
- [ ] 无封面时降级获取默认封面：先查素材库，取第一张 `media_id`，若为空才省略字段

---

## HTML 内嵌图片替换策略

### 根本原因

正则匹配 + 逐一替换时，如果边匹配边修改字符串，偏移量会错位。需先收集所有匹配项，再批量替换原始字符串。

### 下次预防

- [ ] HTML 字符串内嵌资源替换：先收集所有 `{fullTag, newTag}` 对，再统一 `str.replace(fullTag, newTag)`
- [ ] 单张图片上传失败用 `console.warn` 而非 `throw`，保证整体发布不因单张图失败中断

---

## 结果

- [BEHAVIOR] 端到端发布成功：内嵌图片 `test-inline.png → 微信 CDN` ✅，`publish_id: 2247484200`，`errcode=0` ✅
