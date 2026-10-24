---
task_id: 934e5375-aac6-405e-8fad-57ecc9a8349d
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5"]
---
# 规格评审（第 3 轮）

## 评分
意图对齐: 8
可验证: 7
场景覆盖: 6
回归风险: 8
可执行: 7

## 换思路
当前按文件名和“是否像回执”补说明，仍会把源码没有执行的形状校验写进手册。改为先列出每类自造 JSON 的精确内容及 `status.mjs --json` 的实际输出，再据此写判读规则；Q-2 至少加入“非回执文件却含终态 status”的反例，避免只用恰好显示 `unreadable` 的样本验证概括性结论。

## 上轮问题
- R-3: 关闭 —— S-1 和 Q-1 已补入无目录读取权限仍输出空结果、由有权账号只读重查的场景；`status.mjs` 的 `readdirSync` 异常分支与之相符。
- R-4: 关闭 —— S-5 和 Q-4 已将本轮实际登记的 `qa-rN/` 非 Markdown 附件列为条件性允许，并要求核对记录清单和来源；与 `lib/qa-records.mjs` 的 `stageQaRecords` 接受范围一致。

### R-5
针对: S-2, Q-2, I-2
严重度: 重要
场景: 运维人员把一个非回执的 `qa-state.json`（内容仅为 `{"status":"completed"}`）放在回执目录，照手册预期它会显示 `unreadable`，实际 `--json` 显示 `completed` 和 `reason_code=pr_url_missing`，文本也显示 `completed`，于是误把非任务状态当成执行完成。
依据: `runner/status.mjs` 的 `parseReceipt` 只检查对象是否含 `last_event`，否则只要 `status` 属于 `completed/partial/failed` 就调用 `lib/receipt.mjs` 的 `summarizeReceipt`；它不校验任务回执的其余字段。S-2 却规定“不符合回执形状的 JSON 为 unreadable”，Q-2 只准备了恰好不含终态 status 的非回执样本。
说明: S-2 应按真实分类条件说明非回执 JSON 也可能被误显示为终态，不能凭文件名或 `completed` 行确认任务完成；Q-2 加入上述反例并核对 JSON 与文本输出。
