# Learning: execution callback error_message 未写入 — 状态竞争根因

**分支**: cp-04080112-a4df60a9-94b4-4ca9-8cce-bf1b04

## 根本原因

当 watchdog 在 execution callback 到达前改变了任务状态（`in_progress` → `quarantined`），
主 UPDATE `WHERE id = $1 AND status = 'in_progress'` 不匹配，`error_message` 不被写入。

但分类 payload UPDATE（`WHERE id = $1` 无状态检查）仍运行，
导致：`payload.failure_class = task_error`（有值）但 `tasks.error_message = NULL`（无法诊断）。

典型案例：任务 `fedbbdc9-6b04-4d47-af7e-dad7ea862dd9`。

## 修复方案

在分类 payload UPDATE 中加 `COALESCE(error_message, $3)`（execution.js:727）：
- 若主 UPDATE 已写 error_message → COALESCE 保留已有值（幂等）
- 若主 UPDATE 因状态竞争跳过 → COALESCE 写入 error_excerpt 作为 fallback

## 下次预防

- [ ] execution callback 中所有 `WHERE id = $1`（无状态检查）的 UPDATE 都是"安全补丁位"，
      可在此 COALESCE 写入重要诊断字段，避免状态竞争导致信息丢失
- [ ] `failure_class` 在 payload 但 `error_message = NULL` 是明确 bug 信号，说明存在状态竞争
- [ ] 任务失败分析时，优先查 `payload.failure_detail.error_excerpt`（始终有值），
      `tasks.error_message` 可能因竞争为 NULL（本次修复后该情况消失）
