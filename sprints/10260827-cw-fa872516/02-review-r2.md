---
task_id: fa872516-0694-46ed-b9f1-ce81763ca9b4
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4"]
---
# 规格评审（第 2 轮）

## 评分
意图对齐: 8
可验证: 7
场景覆盖: 7
回归风险: 7
可执行: 7

## 上轮问题
- R-1: 关闭 —— S-2、Q-2 已要求按新增节实际措辞构造反例，并先确认变异成功；未变异成功不再误判产品失败。

### R-2
针对: S-4, Q-3, I-4
严重度: 重要
场景: QA 检出一个以固定 base 同树内容另建根提交的 PR 分支，`cat-file -t` 显示 base 是 commit，`rev-list base..HEAD` 列出新根及后续提交；QA 按 Q-3 只对有父提交的节点运行 `diff-tree`，漏查新根带入的整棵树，最终差异仍只显示 README 新节，错误地认定固定 base 至 HEAD 的完整历史均已审计。
依据: Q-3 只运行 `git cat-file -t <base>` 和 `git rev-list --parents <base>..HEAD`，没有核 `<base>` 为 HEAD 祖先，也没有规定无父节点必须失败；`packages/brain/scripts/coding-workflow/lib/record-provenance-store.mjs` 已有 `ancestor`，用 `git merge-base --is-ancestor` 检查真实祖先关系。I-4 要求固定基线的完整 DAG 逐父范围核验。
说明: S-4、Q-3 应在逐父审计前只读验证固定 base 是当前精确 HEAD 的祖先；否则直接 FAIL/CANNOT_VERIFY，不用末端 tree 或 diff 相同替代历史归属。正常祖先关系成立后再执行现有逐父与当前现场检查。
