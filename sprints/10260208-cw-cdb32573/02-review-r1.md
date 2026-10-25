---
task_id: cdb32573-9ece-405a-823e-c6c327765564
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4"]
---
# 规格评审（第 1 轮）

## 评分
意图对齐: 8
可验证: 5
场景覆盖: 6
回归风险: 7
可执行: 7

### R-1
针对: S-3, S-4, Q-4, I-4
严重度: 阻断
场景: QA 按 Q-4 在正常的隔离会话中运行 `git diff --raw`，看到已提交的 03/04 被控制器暂时移走而产生的两条删除记录，遂按“当前脏现场不能 PASS”把合法候选误判为失败。
依据: `lib/qa-isolation.mjs` 的 `startQaIsolation` 对 03/04 执行 `fs.unlinkSync(source)`；`activities/evaluate.mjs` 在启动 QA 命令前调用 `beginEvaluateIsolation()`，只在会话结束后恢复。此时 Q-4 要枚举工作树差异并拒绝当前脏现场，而 I-3 已明确 03/04 在本轮 QA 中暂隐藏。
说明: Q-4 须把可信控制器投影所绑定、且仅限本轮 03/04 的预期暂时删除作为隔离状态核对；其它当前 index/worktree/untracked 差异仍逐项验归属，未匹配的差异失败关闭。恢复是否完成仍交会话后控制器及终态门核，不让 QA 回读 03/04 或保护根。
