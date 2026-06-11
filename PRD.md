# PRD — 同步 harness-generator 快照至 SSOT 7.5.0

## 背景

所有 skill 的唯一 SSOT 是 zenithjoy-skills repo。`packages/workflows/skills/` 是给 monorepo CI / Brain harness graph（loadSkillContent）读的「快照拷贝」。SSOT 的 harness-generator 已升到 7.5.0（PR #51：删除 generator 的 `gh pr merge --auto` 自合并红线），monorepo 快照还停在 7.4.0，skill-drift 巡检已对此产生告警，Brain 跑的还是旧 SKILL.md。

## 范围

用 `scripts/sync-skills-snapshot.sh` 把 6 个 harness skill 的 SKILL.md 从 SSOT 同步到快照。本次实际只有 harness-generator 有 diff（7.4.0 → 7.5.0），其余 5 个已与 SSOT 一致。纯快照刷新，无代码逻辑改动。

## 成功标准

- harness-generator 快照 SKILL.md 与 SSOT 一致，版本号刷新到 7.5.0。
- 其余 5 个 harness skill 快照版本号保持 SSOT 最新版（planner 8.10.0 / contract-proposer 9.1.0 / contract-reviewer 9.1.0 / evaluator 1.15.0 / report 6.2.0）。
- merge 后 skill-drift 巡检 `any_drift` 为 false。
