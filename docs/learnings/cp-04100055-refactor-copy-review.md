# Learning: 重构 executeCopyReview 降低圈复杂度

**分支**: cp-04100055-ebaadbff-8397-429f-8e85-9dbd5f
**日期**: 2026-04-10

### 根本原因

`executeCopyReview` 函数将文件读取、配置校验、LLM 调用、结果解析全部内联在一个函数体中，导致圈复杂度达到 21：
- 2 个 `||` 默认值赋值
- 2 个 `try/catch`
- 6 个 `if` early return
- 2 个 lambda（`.filter`、`.map`）
- 2 个三元表达式

### 下次预防

- [ ] 单函数 >5 个 if/catch/ternary 时立即拆分子函数
- [ ] 重构模式：`_load*()`读数据、`_validate*()`校验、`_call*()`副作用、`_parse*()`解析结果，各自复杂度 ≤5
- [ ] 裸仓库（bare repo）worktree 中 `git rev-parse --show-toplevel` 会失败，需在 `config.worktree` 加 `core.worktree = <worktree路径>` 修复
