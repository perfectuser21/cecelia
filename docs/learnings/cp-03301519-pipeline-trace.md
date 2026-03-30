# Learning: pipeline-trace.sh — 任意 branch 执行全景视图

Branch: cp-03301519-pipeline-trace
Date: 2026-03-30

### 根本原因

pipeline 执行过程产生多个证据文件（.dev-mode、seal files、Learning），但没有统一的聚合视图，用户无法一眼确认执行是否按设计走。

### 下次预防

- [ ] 新增类似观测工具时，先用 fixture 模拟完整数据再写测试
- [ ] CI 状态字段设计时，优先从 .dev-mode 读取（避免外部 API 依赖导致测试不稳定）
- [ ] divergence_count 字段约定顶层位置（不要嵌套），方便脚本提取

### 关键决策

- `set -euo pipefail` + 所有字段有 fallback，不崩溃
- 证据文件搜索优先 worktrees，回退主仓库
- 30 个测试，全部用 fixture（不依赖真实历史 branch 数据）
