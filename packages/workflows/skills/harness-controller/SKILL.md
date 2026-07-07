---
id: harness-controller-skill
description: |
  Harness Controller — SDD 接力模式单 session orchestrator。
  负责完整跑 planning→gan→generate→evaluate→judge→done/failed 全链路，
  每棒完成后回写 Brain API（PATCH relay-runs/:initiative_id）上报进度。
  跨 repo 可用：curl $BRAIN_URL 做 judge/回写，不依赖本地包树。
ssot: zenithjoy-skills
note: |
  本文件是 CI fallback 占位（供 loadSkillContent 搜索链路在缺少 ~/.claude/skills 时不 throw）。
  SSOT 在 zenithjoy-skills repo 的 harness-controller/SKILL.md；
  run `bash scripts/sync-skills-snapshot.sh` 从 SSOT 同步最新内容。
---

# harness-controller (CI placeholder)

此文件是 monorepo 快照占位，真实 skill 内容由 `sync-skills-snapshot.sh` 从 zenithjoy-skills 同步。
