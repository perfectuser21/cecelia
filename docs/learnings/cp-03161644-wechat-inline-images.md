# Learning: 公众号图文混排 - HTML 内嵌图片自动上传

**分支**: `cp-03161644-wechat-inline-images`
**日期**: 2026-03-16
**类型**: feat

---

## 关键学习

### 1. 微信公众号 API 的两套图片接口

微信有两个图片上传接口，用途完全不同：

| 接口 | 用途 | 返回值 |
|------|------|--------|
| `media/uploadimg` | 正文内嵌图片 | `url`（微信 CDN URL） |
| `material/add_material?type=image` | 封面/永久素材 | `media_id` + `url` |

**坑**：`draft/add` 的 `thumb_media_id` 字段必须是 `material/add_material` 返回的永久 `media_id`，不能用 `media/uploadimg` 返回的 URL，也不能省略（否则报 `errcode=40007`）。

### 2. 无封面时的降级策略

如果用户未提供封面图，不应报错退出，而应：
1. 调用 `material/batchget_material?type=image` 从素材库取第一张已有图
2. 用其 `media_id` 作为默认 `thumb_media_id`
3. 若素材库也为空，则不传该字段（部分账号可能仍能发布）

### 3. HTML 内嵌图片替换的正则策略

处理 `<img src="...">` 时：
- 用 `/gi` 标志全局匹配所有 `<img>` 标签
- 先收集所有需要上传的图片，再逐一上传，避免正则执行中途修改字符串导致偏移错位
- 上传失败时 `console.warn` 而非 `throw`，保证单张失败不影响整体发布

### 4. 相对路径解析

`--content-dir` 模式下，HTML 中的相对路径应相对于内容目录解析（`path.resolve(contentDir, src)`），而非当前工作目录。为此 `parseArgs()` 需要将 `contentDir` 透传给主流程。

---

## 结果

- 端到端验证通过：图片上传 ✅，草稿创建 ✅，发布成功 ✅（`publish_id: 2247484200`）
- 公众号自动发布流水线正式支持图文混排
