# Learning: Engine 僵尸文件清理

**日期**: 2026-04-02
**分支**: cp-04021326-engine-cleanup-zombie-tests
**PR**: TBD

## 背景

slim-engine-heartbeat 重构删除了 Planner/Generator/Evaluator subagent、Sprint Contract Gate 等功能，
但对应的测试文件和 devgate 脚本未在同一批次清理，遗留了 9 个僵尸文件。

## 清理结果

**删除的僵尸测试文件（5个）**：
- `tests/verify-step-sprint-contract-seals.test.ts`
- `tests/verify-step-planner-seal.test.ts`
- `tests/skills/planner-subagent.test.ts`
- `tests/skills/sprint-contract-gate.test.ts`
- `tests/devgate/playwright-evaluator.test.ts`

**删除的废弃脚本（4个）**：
- `scripts/devgate/sprint-contract-loop.sh`（311行）
- `scripts/devgate/generate-sprint-report.sh`（438行）
- `scripts/devgate/playwright-evaluator.sh`
- `scripts/devgate/playwright-evaluator.cjs`

**补充 .gitignore（2条）**：
- `.dev-gate-*`
- `.dev-seal-*`

### 根本原因

大型重构删除功能后，测试文件和脚本的清理被分成了多个 PR 批次，
导致中间状态下存在测试已删除功能的"僵尸测试"，
以及不再被任何代码调用的"废弃脚本"。

### 下次预防

- [ ] 删除功能时，同一 PR 必须同时删除对应的测试文件和调用脚本
- [ ] .gitignore 补全是低风险任务，可随任何 PR 顺手补充
