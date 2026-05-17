# Learning: H13 — spawnGeneratorNode import contract artifacts

**PR**: cp-0509221411-h13-import-contract-artifacts
**Sprint**: langgraph-contract-enforcement / Stage 1 supplement-3

## 现象

W8 v14 11 nodes terminal_fail；H7+H8+H10+H11+H12 全验通过（generator 真起、stdout 真传、PR #2860 真 merged、evaluator 真见 verdict）。但 evaluate verdict=FAIL 自报：'DoD 文件 sprints/w8-langgraph-v14/contract-dod-ws1.md 在当前 generator worktree 中不存在 — 它只存在于 proposer 分支上'。

### 根本原因

H11 让 generator 用独立 worktree (task-<init8>-<logical>) fresh off main。proposer 在分支 cp-harness-propose-r3-* 产出 contract-draft.md / contract-dod-wsN.md / task-plan.json / tests/wsN/，这些都没合并进 generator worktree。Generator 容器内 SKILL 找不到合同 → 自己产 docs/learnings/ 当 skeleton → evaluator 切到 generator worktree 找不到 DoD 文件 → 恒报 FAIL。

哲学层根因：**worktree 隔离 ≠ 信息隔离**。H11 的 worktree 隔离设计只考虑了"独立 commit 历史"，没考虑"读上游节点产物"。LangGraph 节点产出（proposer 的 contract）是有方向性的依赖（proposer → generator → evaluator），下游节点的 worktree 必须显式 import 上游节点的产物。这是 contract enforcement layer (Stage 2) 应封装的：每个节点声明 reads_from / writes_to，brain 自动 sync。

### 下次预防

- [ ] 任何 sub-graph 节点的 worktree 隔离设计，必须同步审查"上游节点产物在哪、下游怎么读"
- [ ] PR review 凡涉及 worktree 创建（H11 类型），必须问"它读上游什么文件、谁负责把这些文件搬过来"
- [ ] LangGraph 节点设计应显式声明 inputs/outputs（产物路径），brain 自动验证下游节点能 access
- [ ] 长期：抽 contract-sync.js helper，把"上游 branch 产物 import 到下游 worktree" 的 git 命令封装，避免每个 spawn 节点重复实现
