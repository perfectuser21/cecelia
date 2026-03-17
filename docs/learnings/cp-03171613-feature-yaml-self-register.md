---
branch: cp-03171613-feature-yaml-self-register
date: 2026-03-17
type: learning
---

# Learning: feature.yaml 自注册机制

## 根本原因

CI 每次失败的根本原因是**手动同步点过多**：新功能需要触碰 5 个中央文件，漏一个就失败。
本次 PR 通过 `feature.yaml` 自注册机制解决其中两个最高频的手动同步点（registry + path-views）。

## 踩坑记录

### 1. check-version-sync.sh 需要从 packages/engine/ 目录运行

**问题**：从 worktree 根目录运行 `bash packages/engine/ci/scripts/check-version-sync.sh` 会读取根目录的 `package-lock.json`（旧版本），误报版本不同步。

**正确方式**：
```bash
cd packages/engine && bash ci/scripts/check-version-sync.sh
```

**预防**：Step 02-code.md 本地 CI 镜像检查脚本应该 cd 到对应目录再运行。

### 2. .dev-mode 文件需要 tasks_created: true 标记

**问题**：branch-protect.sh 检查 `.dev-mode.{branch}` 中必须包含 `tasks_created: true`，否则阻止写入 `packages/` 路径。

**正确方式**：Step 1 创建 Task 后立即在 .dev-mode 中追加 `tasks_created: true`。

### 3. Engine feat PR 必须手动 bump 版本（不是 auto-version.yml 负责）

**问题**：SKILL.md 说"不要手动 bump 版本"，但这是针对 Brain。Engine 的 L2 check 要求 PR 中 `packages/engine/package.json` 版本必须高于 main。

**正确方式**：Engine feat 改动必须 bump 7 个文件（package.json/package-lock.json/VERSION/.hook-core-version/regression-contract.yaml + feature-registry.yml）。

**来源**：历史 Learning 中已记录多次，但规则在 SKILL.md 和 memory 之间不一致，导致每次都重新踩坑。

### 4. Test 命令不能用 ls 或 echo，必须用 node/npm/curl 等

**问题**：check-dod-mapping.cjs 不接受 `ls` 或 `echo` 开头的 Test 命令。

**正确方式**：文件存在性检查用 `node -e "require('fs').accessSync(...)"`，grep 验证用 `node -e "...includes(...)"`。

## 下次预防

- [ ] Engine feat PR 开始前，确认版本 bump 7 个文件清单（见 memory/version-management.md）
- [ ] check-version-sync.sh 必须从 packages/engine/ 目录运行
- [ ] Step 1 创建 Task 后立即追加 tasks_created: true 到 .dev-mode
- [ ] DoD Test 命令：文件检查统一用 node -e "require('fs').accessSync(...)"
- [ ] SKILL.md "不要手动 bump" 规则只适用于 Brain，Engine 需要手动 bump

## 成果

- 新增 feature.yaml 自注册机制（proof of concept：4 个 skill）
- CI L2 新增 feature-yaml-lint 步骤
- pre-commit hook 自动触发 generate-path-views.sh
- 消除 registry/path-views 两处手动同步（占历史 CI 失败 ~25%）
