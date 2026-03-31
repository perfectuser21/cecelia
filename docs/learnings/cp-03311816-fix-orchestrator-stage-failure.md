---
branch: cp-03311816-fix-orchestrator-stage-failure
date: 2026-03-31
type: bug-fix
area: brain/content-pipeline
---

# Learning: content pipeline 非审核阶段失败传播修复

## 问题描述

`STAGE_HANDLER_MAP` 中4个非审核阶段（research/copywriting/generate/export）的 handler 函数忽略了 `taskStatus` 参数（用 `_s` 占位），导致即使阶段执行失败（`{success:false}`）也会推进到下一阶段，pipeline 最终显示 `completed` 但无有效内容产出。

## 根本原因

审核阶段（copy-review/image-review）有自己的重试逻辑，需要读取 `taskStatus`，设计时正确传入了 `status` 参数。但非审核阶段在设计时假设"任务完成即成功"，未考虑 executor 返回 `{success:false}` 的失败场景。

## 修复方案

新增 `_markPipelineFailedOnStageError()` 辅助函数，在 `STAGE_HANDLER_MAP` 中对4个非审核阶段加入 `taskStatus === 'failed'` 前置检查：

```js
'content-research': (ctx, s, _f, db) => s === 'failed' 
  ? _markPipelineFailedOnStageError(ctx, 'content-research', db) 
  : _handleResearchComplete(ctx, db),
```

## 经验

- **设计对称性**：pipeline 的每个阶段 handler 都应该处理 `taskStatus`，即使"通常不会失败"
- **显式优于隐式**：用 `_s` 占位符忽略参数是危险信号，非审核阶段应明确检查失败状态
- **fail-fast**：阶段失败时应立即终止整个 pipeline，避免用空数据继续执行后续阶段
