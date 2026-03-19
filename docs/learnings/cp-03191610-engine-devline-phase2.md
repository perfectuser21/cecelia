# Learning: Engine Dev 线 Phase 2

## 任务概要
审查任务从西安 Codex 迁移到本机 Codex，devloop-check.sh PR 创建时序修正，集成 /simplify skill，清理 3 个死 skill。

### 根本原因
西安 Codex 审查需要 Tailscale 通讯 + Brain bridge 中转，链条长、故障点多。本机 Codex 代码在本地、不需要网络中转，更安全。PR 时序问题是 devloop-check.sh 先检查 PR 再检查审查，导致审查 FAIL 时 PR 上积累修复 commit。死 skill（audit/qa/assurance）是 1 月份的旧代码，功能已迁移到 packages/quality/ 和 workflows/review/，但 engine 里的拷贝没清理。

### 下次预防
- [ ] 新增 Codex 审查任务时，优先考虑本机执行（省去跨机器通讯开销），只有本机资源不够时才路由到西安
- [ ] devloop-check.sh 条件顺序应遵循"先审查后创建 PR"原则——审查是 push 后的事，PR 是审查通过后的事
- [ ] Engine skills 目录定期审计：如果 CI/hooks/devloop-check 都不引用某个 skill，它就是死代码，应该归档
- [ ] slot-allocator 的 MAX_CODEX_CONCURRENT 限制只查 codex_qa/codex_dev/codex_playwright，新增的审查任务走 task_pool 通道不受此限制——这是正确的设计但要记住
