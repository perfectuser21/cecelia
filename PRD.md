# PRD — 同步 harness skill 快照至 SSOT 最新版

## 背景

所有 skill 的唯一 SSOT 是 zenithjoy-skills repo。`packages/workflows/skills/` 是给 monorepo CI / Brain harness graph（loadSkillContent）读的「快照拷贝」。SSOT 已更新到 cc8e65f（#50 链路审计修复 7 个 skill 层问题），monorepo 快照落后，Brain 跑的还是旧 SKILL.md。

## 范围

用上一 PR 新增的 `scripts/sync-skills-snapshot.sh` 把 6 个 harness skill 的 SKILL.md 从 SSOT 同步到快照。纯快照刷新，无代码逻辑改动。

## 成功标准

- 6 个 harness skill 快照（planner/contract-proposer/contract-reviewer/generator/evaluator/report）SKILL.md 与 SSOT cc8e65f 一致。
- 版本号刷新到：evaluator 1.15.0 / proposer 9.1.0 / reviewer 9.1.0 / generator 7.4.0 / planner 8.10.0 / report 6.2.0。
