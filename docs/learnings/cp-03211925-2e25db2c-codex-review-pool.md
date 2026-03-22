# Learning: Codex 独立审查加固

branch: cp-03211925-2e25db2c-79d7-449b-ad63-2af31a
date: 2026-03-21

### 根本原因

spec_review / code_review_gate 任务使用 cecelia-bridge 的 10-slot 池，与编码任务竞争槽位。当系统并发压力高时，审查任务被背压阻塞，导致 PR 合并流程停滞。

### 下次预防

- [ ] 审查类任务应与编码任务使用独立的执行池，互不干扰
- [ ] 新增执行路径时，同步更新 cecelia-run.sh 的 MAX_CONCURRENT 注释（保持总量说明清晰）
- [ ] SKILL.md 的输入描述应与实际执行方式一致（本机执行无 PR，用 git diff）
- [ ] triggerLocalCodexExec 使用 atomic mkdir 获取 slot，比 lock 文件更可靠（mkdir 是原子操作）
