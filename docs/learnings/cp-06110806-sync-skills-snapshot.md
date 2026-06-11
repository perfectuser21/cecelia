# Learning — 同步 harness skill 快照至 SSOT 最新版

分支：cp-06110806-sync-skills-snapshot
日期：2026-06-11

## 背景

zenithjoy-skills（唯一 SSOT）更新到 cc8e65f（#50 链路审计修复 7 个 skill 层问题）后，
monorepo 快照 `packages/workflows/skills/` 落后。Brain harness graph 用 loadSkillContent
读快照里的 SKILL.md 注入给 agent —— 快照不刷 = agent 跑旧 skill。

### 根本原因

SSOT 与 monorepo 快照是两份物理拷贝，SSOT 侧 merge 不会自动传播到快照。两份之间没有
自动同步管道，靠人工/脚本手动刷，容易漂移。本次用上一 PR 新增的 sync-skills-snapshot.sh
把 6 个 harness skill SKILL.md 一次性刷到 SSOT 最新版。

### 下次预防

- SSOT 侧 harness skill 有版本变更并 merge 后，必须同步刷 monorepo 快照（跑
  sync-skills-snapshot.sh），否则 Brain 跑的是旧 skill，行为与 SSOT 不一致难定位。
- 快照刷新 PR 用一条「全部版本号同时校验」的 BEHAVIOR 命令兜底，防止漏同步个别 skill。

## checklist

- [ ] SSOT harness skill 版本变更 merge 后，同步刷 monorepo 快照
- [ ] 快照刷新 PR 校验全部 skill 版本号到位（而非只抽查一个）
