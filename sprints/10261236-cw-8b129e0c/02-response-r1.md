---
task_id: 8b129e0c-96bc-492a-9d8d-ce04260caa6c
step: spec_response
upstream: ["02-review-r1.md#R-1", "02-review-r1.md#R-2"]
---

### R-1
处理: 采纳
说明: S-2、S-4 和 Q-2 已区分现行合并门的改绑尝试与最终 HEAD 的真实准入。 `runner/lib/merge-gate.mjs` 的 `changedSinceApproval` 会排除 main 提交并尝试 `verifyMergeSource`，但它不执行新 HEAD 的 QA、judge 或 preview；`runner/lib/source-merge-proof.mjs` 的 `qa_before_sync` 会拒绝 QA 后 main 同步沿用旧 QA 轮次。因此评审所述“同步后直接改绑并合并”在该来源门通过时不能成立，但规格原文没有说明这层拒绝和后续责任，需修正。同步后由控制器对新 HEAD 实际取得 QA、judge、CI、preview 和新轮次批准，终态门核同一最终 HEAD；缺证不能以来源证明、required checks 或旧结果放行。当前 Q-2 只核实现有拒绝逻辑和新节责任叙述，未来执行结果留给实际发生后的门核。

### R-2
处理: 采纳
说明: S-3、Q-3 已按 `runner/lib/merge-gate.mjs` 的 `recordMerged` 修正：Brain PATCH 返回 `ok` 即清 `receipt_pending=false`；PATCH 前 `syncTask` 的 GET 和 `runner/lib/brain.mjs` 的 PATCH 响应都不能证明 PATCH 后独立读回。当前 QA 用内存反例拒绝把 false 当读回证据；合并后的终态门实际 GET 核精确 Brain 回执。Learning ID 与全文哈希读回要求保留。
