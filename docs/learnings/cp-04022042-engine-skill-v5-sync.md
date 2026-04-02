# Learning: 引擎内嵌 skill 同步到 v5.0.0

**日期**: 2026-04-02

## 背景
用户目录 ~/.claude-account1/skills/dev/ 是 symlink 指向 packages/engine/skills/dev/。
之前在用户目录做的清理（删脚本、改文件）被 git pull 恢复了，因为实际改的是 git 跟踪的文件。

### 根本原因
1. skill 目录通过 symlink 共享，导致"非 git 文件"实际上是 git 文件
2. slim-engine-heartbeat 重构只改了 hooks/lib/devgate，没同步更新 skills/dev/ 内容
3. 18 个旧脚本、Planner/Generator/Evaluator/Sprint Contract 引用在 skill 文件中残留

### 下次预防
- [ ] 改 skill 文件前先检查是否是 symlink（ls -la 确认）
- [ ] 重构删功能时，同时 grep 搜索 skills/ 目录中的引用并清理
