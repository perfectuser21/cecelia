# Learning: Learning 内容实质性检查 + devloop-check PR 合并目标验证

**Branch**: cp-03232152-fix-learning-pr-target
**Date**: 2026-03-23

### 根本原因

check-learning.sh 只用 grep 检查标题行存在，没有提取标题下方的内容行进行计数。
devloop-check.sh 使用 `gh pr list --state merged` 检查 PR 是否合并，但 `--state merged` 不区分合并到哪个分支，导致误合并到非 main 分支也被认为完成。

两个问题都是"只检查表面形式，不检查实质内容"的模式。

### 下次预防

- [ ] 写任何格式检查脚本时，明确区分"标题存在"和"内容存在"两个维度
- [ ] 检查 PR 状态时，明确验证目标分支（baseRefName）而不只是状态（merged）
- [ ] Code review 时特别关注 shell 脚本里的 grep 检查是否只检查了表面

