# Learning: content-pipeline-orchestrator 圈复杂度重构

## 任务背景
Brain 自动调度任务，重构 content-pipeline-orchestrator.js 中圈复杂度超标的函数。

## 关键发现

### 根本原因
1. **扫描器 `?:` 正则贪婪匹配陷阱**：ComplexityScanner 用 `/\?[^:]+:/g` 检测三元运算符，但该正则也会贪婪匹配 optional chaining（`?.keyword`）直到下一个 `:` 出现，将 `pipeline.payload?.keyword` 等模式误计为三元运算符，显著高估复杂度。
   - `_.keyword || pipeline.title` 中的 `?.keyword` 会延伸到数行外的第一个 `:` 才终止
   - 解决：将含 `?.` 的参数提取到独立辅助函数 `_parsePipelineParams()`，使主函数体不含 `?.` 访问

2. **stash 在 worktree 中的危险行为**：在 worktree 目录（但 `.git` 文件缺失时）执行 `git stash pop`，stash 被应用到主仓库工作目录，导致大量文件被删除，破坏整个 worktree 状态。
   - **永远不要** 在 worktree 中使用 `git stash`（尤其是跨分支验证目的）
   - 如需对比 main 分支状态，用 `git show HEAD:path/to/file` 代替 stash

3. **worktree `.git` 文件缺失的恢复方法**：
   - 创建 `.git/worktrees/<name>/HEAD`、`gitdir`、`commondir` 三文件
   - 在 worktree 目录创建 `.git` 文件指向上述目录
   - `git reset --hard HEAD && git clean -fd` 还原工作目录

### 下次预防
- [ ] 复杂度重构任务：先运行扫描器检查哪些函数真正超标（可能已被前次 PR 修复）
- [ ] 检测 `?.` optional chaining 的函数时，将其提取到独立函数中，避免被误计分支
- [ ] 禁止在 worktree 中使用 `git stash`；需要跨分支比较时用 `git show` 替代
- [ ] worktree 检测：每次操作前确认 `git rev-parse --git-dir` 包含 `worktrees` 路径
