---
id: instruction-pipeline-output-page
version: 1.1.0
created: 2026-03-30
updated: 2026-03-31
authority: USER_FACING
changelog:
  - 1.1.0: 生成记录 Tab 升级 — 时间戳、错误详情、重新生成按钮；移除 Hero 区缩略图
  - 1.0.0: 初始版本 — PipelineOutputPage 四 Tab 内容作品主页
---

# Pipeline Output Page — 内容作品主页

## What it is

内容工厂每条 Pipeline 的详情页，展示内容生产全链路成果。

路由：`/content-factory/:id`

## 四 Tab 结构

| Tab | 内容 | 数据来源 |
|-----|------|---------|
| **Summary** | 总曝光/互动/平台数/互动率 | mock（待接入） |
| **生成记录** | 文章文案、卡片文案、Pipeline 执行阶段 | Brain API `/pipelines/:id/output` + `/stages` |
| **发布记录** | 8 平台发布状态 | mock（待接入） |
| **数据记录** | 各平台播放/点赞/评论/收藏 | mock（待接入） |

## How to use

在内容工厂 `/content-factory` 的 Pipeline 列表中，点击任意条目即可进入该 Pipeline 的作品主页。

## 生成记录 Tab — 执行阶段详情（v1.1.0）

### 阶段步骤展示

每个执行阶段显示：
- **started_at**：阶段开始时间（`开始: HH:MM:SS`）
- **completed_at**：阶段完成时间（`完成: HH:MM:SS`）
- **review_issues**：若存在错误，展示错误详情列表（橙色 `⚠` 前缀）

### 重新生成

- **Header 重新生成按钮**：执行阶段区域顶部，点击后对整条 Pipeline 调用 `POST /api/brain/pipelines/:id/run`
- **每步重新生成按钮**：每个阶段行右侧，点击后对整条 Pipeline 调用同一接口
- 按钮在请求进行中自动禁用，避免重复提交

### Hero 区

封面缩略图已从 Hero 区移除（右栏内容卡片已有大图展示，避免重复）。

## Design

深色风格，背景色 `#07050f`，紫色渐变标题。参考 Justin Welsh 预览页设计语言。
