---
task_id: 2bc1e554-43fa-47f9-9ef4-8ab8b6c5baf3
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4"]
---
# 规格评审（第 1 轮）

## 评分
意图对齐: 7
可验证: 7
场景覆盖: 6
回归风险: 8
可执行: 8

### R-1
针对: S-2, Q-4, Q-5, I-2
严重度: 阻断
场景: 操作者在回执目录放入合法 JSON `{"status":"completed","outputs":{}}`，按手册查看状态时看到 `completed` 和 `pr_url_missing`，而按规格写成的手册却告诉他非回执结构的 JSON 只会显示 `unreadable`。
依据: `runner/status.mjs` 的 `parseReceipt` 只要对象有终态 `status` 就调用 `summarizeReceipt`，不校验任务 ID 或活动等回执字段；`runner/lib/receipt.mjs` 对无 PR URL 的 completed 对象返回 `pr_url_missing`。S-2 的“不可解析或不符合回执结构的 JSON 为 unreadable”和“合法非回执 JSON 都只标 unreadable”与此冲突；Q-5 恰好使用上述极简对象并期望 `completed`，Q-4 却未覆盖带终态 `status` 的非回执 JSON。
说明: 把手册判读规则改为源码实际使用的最小字段条件，并在 Q-4 加入这个可运行样本；提示操作者不能仅凭 `completed` 标签断定文件确为任务回执。
