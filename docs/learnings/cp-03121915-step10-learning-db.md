---
branch: cp-03121915-step10-learning-db
pr: "#898"
date: 2026-03-12
task: 006e7c15-d3c1-447e-bdfc-461c518187ef
---

# Learning: learnings-received 来源追踪 + Haiku 分类

## 本次工作概述

为 Brain `POST /api/brain/learnings-received` 端点新增来源追踪字段（source_branch、source_pr、repo），并接入 Haiku 异步 learning_type 分类。同步更新 `fire-learnings-event.sh` 添加 `--repo` 参数。

---

### 陷阱1：Engine Coverage Gate 1 拦截 feat: 提交（2026-03-12）

#### 根本原因

`check-changed-coverage.cjs` 门禁 1：feat PR 必须有**新增**（ADDED）测试文件。我们修改了已有的 `learnings-received.test.js`（MODIFIED），但没有新建测试文件，导致门禁误判为"feat PR 无测试"而失败。

#### 下次预防

- [ ] 改进已有测试文件时，优先使用 `fix:` 前缀而非 `feat:`，避免触发 Coverage Gate 1
- [ ] 若确实是新 feature，需同时新建一个独立测试文件（ADDED，不是仅 MODIFIED 已有文件）

---

### 陷阱2：修改 packages/engine/skills/ 必须完整走三要素（2026-03-12）

#### 根本原因

修改 `fire-learnings-event.sh`（在 `packages/engine/skills/`）触发了 Engine Config Audit + L2 版本检查。PR title 没有 `[CONFIG]` 且 engine 版本未 bump，L1 和 L2 均失败。三要素：PR title [CONFIG]、版本 bump 6 个文件、feature-registry.yml 新条目。

#### 下次预防

- [ ] 改 `packages/engine/skills/` 任何文件时，立即确认三要素 checklist：PR title [CONFIG]、版本 bump 6 个文件、feature-registry.yml 新条目 + generate-path-views.sh
- [ ] 尽量将 engine 脚本改动和 Brain 改动分两个 PR，避免混合触发多套 CI 规则
- [ ] CI L2 yq install 需要 `--clobber` 防止 runner 缓存冲突（已修复 ci-l2-consistency.yml）
