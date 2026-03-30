---
id: instruction-pipeline-output-page
version: 1.0.0
created: 2026-03-30
updated: 2026-03-30
authority: USER_FACING
changelog:
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

## Design

深色风格，背景色 `#07050f`，紫色渐变标题。参考 Justin Welsh 预览页设计语言。
