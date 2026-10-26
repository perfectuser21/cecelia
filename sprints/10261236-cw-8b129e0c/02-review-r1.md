---
task_id: 8b129e0c-96bc-492a-9d8d-ce04260caa6c
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4"]
---
# 规格评审（第 1 轮）

## 评分
意图对齐: 7
可验证: 7
场景覆盖: 7
回归风险: 6
可执行: 7

### R-1
针对: S-2, S-4, Q-2, I-2, I-4
严重度: 阻断
场景: QA 批准后，控制器把 main 合入 PR 生成新 HEAD；下一轮合并门核来源和 required checks 后把 `approved.head` 改绑并合并，用户看到该新 HEAD 没有重新经过 QA、judge 和 preview，却在新节读到“必须重新真实 QA、judge、CI、preview”。
依据: `runner/lib/merge-gate.mjs` 的 `changedSinceApproval` 用 `git log --no-merges ... ^origin/main` 排除同步提交；`gate` 在剩余文件均为记录时调用 `verifyMergeSource` 后直接改写 `s.approved.head`，随后仅核 `requiredState` 并进入合并流程，没有重新调用 QA、judge 或 preview。`runner/lib/source-provenance.mjs` 的 `verifyMergeSource` 核来源及既有 QA 轮次，不执行新 HEAD 验收。01-intent.md 的 I-2、I-4 和 `stage_responsibility.outer` 要求新 HEAD 的真实门禁证据；本任务又限定只追加 README。
说明: 规格须区分现有 runner 的实际改绑行为与本任务要求的终态准入条件；写明可信 main 同步产生新 HEAD 时由哪个后续真实门拒绝旧 QA/judge/preview 信用、如何取得新 HEAD 的真实结果，不能把 `verifyMergeSource` 写成这些结果已通过，也不能用本轮静态断言替代。

### R-2
针对: S-3, Q-3, I-3
严重度: 重要
场景: 合并后 Brain PATCH 返回成功，runner 立即把 `receipt_pending` 清为 false；用户按新节所写以为合并回执已独立读回，实际此时没有发生 PATCH 后的 Brain GET。
依据: `runner/lib/merge-gate.mjs` 的 `recordMerged` 在 `ctx.brain.patch` 返回 `ok` 后直接调用 `updateSync(ctx, pr, { receipt_pending: false })`；此前的 `syncTask` 是 PATCH 前读取。`runner/lib/brain.mjs` 的 `patch` 只返回 PATCH 响应，不执行独立 GET。S-3 却要求文档写“`receipt_pending`/`learning_pending` 保留至独立读回”，Q-3 只做文案断言。
说明: 将 Brain 回执的现行清待办时点如实写明，把合并后独立 Brain 读回列为后续终态门的实际核验责任；Q-3 的静态检查应拒绝把 `receipt_pending=false` 当作读回证据。Learning 的 ID 与全文哈希读回仍按原要求保留。
