# Learning — 同步 harness-generator 快照至 SSOT 7.5.0

分支：cp-06111338-sync-generator-skill
日期：2026-06-11

## 背景

zenithjoy-skills（唯一 SSOT）的 harness-generator 升到 7.5.0（PR #51：删除 generator 的
`gh pr merge --auto` 自合并），monorepo 快照 `packages/workflows/skills/harness-generator/SKILL.md`
仍停在 7.4.0。Brain harness graph 用 loadSkillContent 读快照里的 SKILL.md 注入给 agent ——
快照不刷 = generator 仍带自合并指令，绕过 evaluator pre-merge gate。skill-drift 巡检已对此告警。

### 根本原因

SSOT 与 monorepo 快照是两份物理拷贝，SSOT 侧 merge 不会自动传播到快照。两份之间没有
自动同步管道，靠 sync-skills-snapshot.sh 手动刷，SSOT 一升级快照就漂移。本次跑脚本把
harness-generator 一项刷到 7.5.0（其余 5 个已一致，无 diff）。

### 下次预防

- SSOT 侧任一 harness skill 版本变更并 merge 后，必须同步刷 monorepo 快照（跑
  sync-skills-snapshot.sh），否则 Brain 跑的是旧 skill，行为与 SSOT 不一致难定位。
- 快照刷新 PR 用一条「全部版本号同时校验」的 BEHAVIOR 命令兜底，防止漏同步个别 skill。
- 自合并这类红线类改动尤其要及时同步：快照落后 = 红线在 Brain 实际执行路径上未生效。

## checklist

- [ ] SSOT harness skill 版本变更 merge 后，同步刷 monorepo 快照
- [ ] 快照刷新 PR 校验全部 skill 版本号到位（而非只抽查一个）
- [ ] 红线类（禁自合并等）改动确认已落到 Brain 实际读取的快照
