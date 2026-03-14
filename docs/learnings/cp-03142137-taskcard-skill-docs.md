---
id: learning-cp-03142137-taskcard-skill-docs
version: 1.0.0
created: 2026-03-14
updated: 2026-03-14
changelog:
  - 1.0.0: 初始版本
---

# Learning: /dev Skill 文档重组为6步 Task Card 格式（2026-03-14）

### 根本原因

修改了 `packages/engine/skills/dev/` 下的文档文件（属于 `packages/engine/skills/` core path），触发了 CI L2 Impact Check，要求同步更新 `feature-registry.yml`。同时，Engine skills 改动必须 bump 版本（7个文件同步），但本次 PR 漏掉了版本 bump，导致 L2 Consistency Gate 失败。Learning 文件也未创建，导致 L1 Learning Format Gate 失败。

### 下次预防

- [ ] 修改 `packages/engine/skills/` 或 `packages/engine/hooks/` 前，先检查 Engine skills 改动 checklist
- [ ] 版本 bump 7个文件：package.json + package-lock.json(engine) + 根 package-lock.json(engine条目) + VERSION + ci-tools/VERSION + .hook-core-version + regression-contract.yaml
- [ ] 同步更新 `packages/engine/features/feature-registry.yml` 并运行 `bash scripts/generate-path-views.sh`
- [ ] 在第一次 push 前创建 `docs/learnings/<branch>.md`（含根本原因 + 下次预防 + checklist）
- [ ] `skills/dev/` 是 `packages/engine/skills/dev/` 的 symlink，在 git 追踪范围内，改动必须走完整流程
