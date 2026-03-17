---
id: learning-cp-03172129-dev-tdd-redesign
branch: cp-03172129-dev-tdd-redesign
created: 2026-03-17
type: learning
---

# Learning: /dev 6步 TDD 同步到 packages/workflows

## 做了什么

1. 将 `packages/workflows/skills/dev/steps/` 从旧的 12步设计同步到新的 6步 TDD 设计（与 `packages/engine/skills/dev/` 保持一致）
2. 删除了 `packages/engine/skills/dev/steps/03-branch.md` 残留文件（上次部分更新的遗留）
3. 更新了 `packages/workflows/skills/dev/SKILL.md` 到 v3.5.0

## 根本原因

`packages/engine/skills/dev/` 已经在之前的 PR 中更新到 6步设计，但 `packages/workflows/skills/dev/` 没有同步更新，且 engine/steps/ 中留有 `03-branch.md` 残留——正是 cp-03151103 记录的"新老步骤文件并存"老问题的重现。

**两处 skill 目录的关系**：
- `packages/engine/skills/dev/` — 被 `required-dev-paths.yml` 和 `test-dev-health.sh` 引用，是 canonical 版本
- `packages/workflows/skills/dev/` — 历史遗留，无代码引用，保持同步避免混乱

## 踩的坑

1. **Task Card 版本号写错**：写了"v4.0"但实际 engine SKILL.md 是 v3.5.0，DoD Test 需要更新。原则：**先看代码实际版本，再写 DoD**，不要从脑子里编版本号。
2. **scope 识别**：最初以为只需改 workflows/，探索后发现 engine/steps/ 也有残留要清理，需要在 Task Card 实现方案中补充。

## 下次预防

- [ ] 修改步骤文件时，同步检查 `packages/engine/skills/dev/steps/` 和 `packages/workflows/skills/dev/steps/` 两处是否都需要更新
- [ ] 写 DoD Test 中的版本号前，先用 `head -5 <file>` 确认实际版本，不猜测
- [ ] 每次部分更新步骤文件后，立即 `ls packages/engine/skills/dev/steps/` 检查是否有残留文件（数量应 ≤ 6）
