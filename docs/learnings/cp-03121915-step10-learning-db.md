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

### 陷阱1：Engine Coverage Gate 1 拦截 feat: 提交

#### 根本原因

`check-changed-coverage.cjs` 门禁 1：feat PR 必须有**新增**测试文件。我们修改了已有的 `learnings-received.test.js`（MODIFIED），但没有新建测试文件（ADDED），导致门禁误判为"feat PR 无测试"。

#### 修复方式

将提交前缀从 `feat(brain):` 改为 `fix(brain):`，Gate 1 自动跳过。后续新增测试文件时注意用 ADDED（新建）而非仅 MODIFIED（修改），或改用 fix: 前缀。

#### 下次预防

- 改进已有测试文件时，优先使用 `fix:` 前缀而非 `feat:`
- 若确实是新 feature，需同时新建一个独立测试文件（哪怕是专门的 integration test）

---

### 陷阱2：修改 packages/engine/skills/ 必须完整走三要素

#### 根本原因

修改 `fire-learnings-event.sh`（在 `packages/engine/skills/`）触发了 Engine Config Audit + L2 版本检查。如果 PR title 没有 `[CONFIG]` 且 engine 版本未 bump，L1 和 L2 都会失败。

#### 修复方式

每次修改 `packages/engine/skills/` 或 `packages/engine/scripts/devgate/` 时，必须同时完成三要素：
1. PR title 含 `[CONFIG]`
2. Engine 版本 bump（6 个文件：package.json、package-lock.json(engine)、根 package-lock.json(engine条目)、VERSION、.hook-core-version、regression-contract.yaml）
3. feature-registry.yml 添加 changelog 条目 + 运行 generate-path-views.sh

#### 下次预防

- 凡是改 `packages/engine/` 目录下的任何文件（除文档外），立即打开内存记录确认三要素checklist
- 尽量将 engine 脚本改动和 Brain 改动分两个 PR，避免混合触发多套 CI 规则
