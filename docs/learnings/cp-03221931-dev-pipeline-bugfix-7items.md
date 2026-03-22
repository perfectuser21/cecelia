# Learning: /dev pipeline 7项BUG修复 + PR#1366覆盖还原

## 任务回顾

修复 /dev 4-Stage pipeline skill 文件中7个已确认 bug，并在过程中发现并还原了 PR#1366 意外覆盖 PR#1367 的内容。

### 根本原因

1. **Bug 本身**：7个 skill 文件问题（路径错误、缺模板、无 exit 1、过时注释、分数错误、变量不一致）是设计缺陷，逐步积累未被发现。

2. **PR#1366 覆盖 PR#1367**：PR#1366（fetch-task-prd.sh intent-expand）的 squash merge commit 包含了一个 02-code.md 的旧版本（基于 PR#1367 合并前的状态），导致 Step 2.0/2.1.5/2.3.6 exit 1 三个重要改动被静默回退。这是典型的**并行 PR squash merge 冲突**，没有触发 CI 失败（文件变更是有效的，只是方向错了）。

### 下次预防

- [ ] 并行 PR 合并时，需检查"是否有其他 PR 最近修改了同一文件" — 特别是 squash merge 模式下
- [ ] 关键文件（如 02-code.md）修改后，CI 应有内容完整性检查（不仅检查格式）
- [ ] worktree 创建后若发现缺少最新 commit，要先 rebase 再开始工作（本次就遇到了）
- [ ] [PRESERVE] 机制正在帮助我们：以后对 02-code.md 的修改，[PRESERVE] 会强制记录 Step 2.0/2.1.5 的存在性，防止再次被覆盖
