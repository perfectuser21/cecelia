# Learning: content-pipeline /run 支持重新生成已完成的 pipeline

**分支**: cp-03310932-pipeline-rerun
**PR**: #1727
**日期**: 2026-03-31

## 做了什么

修复 `POST /api/brain/pipelines/:id/run` 对 `completed` 状态的 pipeline 返回 400 的问题。

## 根因

`/run` 端点有一个硬拦截：`if (pipeline.status === 'completed') return 400`。
用户点「重新生成」时 pipeline 已完成，导致 UI 显示「触发失败」。

## 修复

移除 400 返回，改为先将 status 重置为 `queued`（清空 started_at/completed_at），再正常触发执行。

## 经验

- **重新生成 ≠ 已完成不可动**：completed 只是最终状态，重跑时应允许重置
- 前端触发失败的根因往往在后端状态机，优先查 nginx 日志确认 HTTP 状态码
