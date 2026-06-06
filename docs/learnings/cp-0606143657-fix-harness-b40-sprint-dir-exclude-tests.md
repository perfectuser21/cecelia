## B40 parsePrdNode 把 sprints/tests/ 误判为 sprint 目录（2026-06-06）

### 根本原因

`parsePrdNode` 的 B40 fallback（`git log origin/main..HEAD` 返回空时，用 `find` 检测 `sprints/` 子目录）没有排除非 sprint 目录。

infrastructure repo 的 `sprints/` 下只有 `tests/` 一个子目录（用于存放测试脚本）。B40 `find` 找到唯一目录 `tests/`，且没有过滤逻辑，直接设 `sprintDir = 'sprints/tests'`。后续 `verifyContractProposerOutput` 在 `sprints/tests/contract-draft.md` 找不到合同 → `proposer_repeatedly_didnt_push` → GAN 永不收敛。

### 修复

1. **B40 加 EXCLUDE 过滤**（`harness-initiative.graph.js`）：与 `detectSprintDirFromGitLog` 保持一致，过滤 `tests/test/__tests__/node_modules/fixtures`，全被排除时保持 `sprintDir = 'sprints'`。

2. **`verifyContractProposerOutput` 加 B56 fallback**（`contract-verify.js`）：当 `sprintDir` 候选路径全找不到合同时，额外检查 `sprints/contract-draft.md` / `sprints/sprint-contract.md` 根路径（与 `defaultReadContractFile` 的 B56 逻辑对称）。

### 下次预防

- [ ] B40 的 EXCLUDE 集合与 `detectSprintDirFromGitLog` 共用同一个常量（而非各自内联），避免两处不同步
- [ ] `sprints/` 下新增特殊目录时，检查 EXCLUDE 是否需要更新（B40 + detectSprintDirFromGitLog）
- [ ] `verifyContractProposerOutput` 的 B56 fallback 与 `defaultReadContractFile` 的 B56 逻辑应保持对称
