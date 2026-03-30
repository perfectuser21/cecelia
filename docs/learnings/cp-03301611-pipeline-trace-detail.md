# Learning: pipeline-trace.sh 输出细化

**Branch**: cp-03301611-pipeline-trace-detail
**日期**: 2026-03-30

### 根本原因

pipeline-trace.sh 第一版输出过于精简，每个 Stage 只有单行摘要，无法从中判断 pipeline 是否按设计执行。seal 文件中包含丰富的详细信息（reviewer、timestamp、files_modified、build_status、RCA 摘录）但完全未被展示，导致调试时仍需手工查看多个 JSON 文件。

worktree 根目录的 `.prd.md` 文件会被 `check-dod-mapping.cjs` 在向上搜索时找到，干扰 test fixture 中的 DoD 追溯检查，导致不相关的 engine 测试失败。预防方法是 worktree 只保留 `.task-*.md` 作为任务卡，不放 `.prd.md`。

### 下次预防

- [x] pipeline-trace.sh 每个 Stage 至少 2 行：主行摘要 + 缩进细节行
- [x] worktree 初始化时不在根目录留 `.prd.md`，改用 `.task-*.md`
- [x] 增加 `INDENT` 常量统一缩进风格，避免各 Stage 格式不一致
