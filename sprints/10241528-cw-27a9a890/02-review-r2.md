---
task_id: 27a9a890-fccc-4874-9655-420030b8587b
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5"]
---
# 规格评审（第 2 轮）

## 评分
意图对齐: 8
可验证: 6
场景覆盖: 6
回归风险: 7
可执行: 7

## 上轮问题
- R-1: 关闭 —— Q-5 已明确只读取发布前 verify 当时的记录，Q-6 对发布后当前 HEAD 单独核验合法来源增量，不再对已发布 HEAD 套用 manifest 零差异。

### R-2
针对: S-4, Q-5, I-4
严重度: 阻断
场景: 开发者先提交一次对 `status.mjs` 的越界修改，再提交还原；发布前验收照 Q-5 执行时，最终 `git diff` 只显示 README，`git rev-list --parents` 只列提交和父节点，于是把这段曾经改过程序的历史判为范围合格。
依据: I-4 和 S-4 明确要求先改后还原的越界提交失败；Q-5 列出的 `git rev-list --parents` 不显示提交改动路径，而 `git diff <base> HEAD`、暂存区和工作区差异只反映最终状态。`status.mjs` 位于产品许可的 README 之外。
说明: 在 Q-5 的发布前操作中加入逐提交读取变更路径、内容及模式的具体步骤，从固定 base 到受验 HEAD 检查每个提交；发现任何越界修改，即使最终被还原也判失败，并保留对应提交证据。
