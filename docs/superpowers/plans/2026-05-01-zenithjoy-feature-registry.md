# ZenithJoy Feature Registry Migrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 ZenithJoy feature registry 的 87 个新 feature（3 个 migration 文件）和 Notion 同步脚本扩展提交为 PR。

**Architecture:** 纯 git commit — 4 个文件已在本地就绪，无需代码生成。Migration 编号已修正（251/252/253），sync 脚本已验证运行成功。

**Tech Stack:** git, GitHub Actions CI

---

### Task 1: 提交 4 个文件并创建 PR

**Files:**
- Create: `packages/brain/migrations/251_zenithjoy_publisher_features.sql`
- Create: `packages/brain/migrations/252_zenithjoy_full_features.sql`
- Create: `packages/brain/migrations/253_zenithjoy_missing_features.sql`
- Modify: `packages/brain/scripts/sync-features-to-notion.mjs`

- [x] **Step 1: 确认文件就绪**

```bash
ls packages/brain/migrations/25{1,2,3}_*.sql
ls packages/brain/scripts/sync-features-to-notion.mjs
```

Expected: 4 个文件全部存在。

- [ ] **Step 2: 写 Learning 文件**

```bash
# 文件已在 docs/learnings/ 下，由工作流生成
```

- [ ] **Step 3: git add + commit**

```bash
git add packages/brain/migrations/251_zenithjoy_publisher_features.sql
git add packages/brain/migrations/252_zenithjoy_full_features.sql
git add packages/brain/migrations/253_zenithjoy_missing_features.sql
git add packages/brain/scripts/sync-features-to-notion.mjs
git add docs/superpowers/specs/2026-05-01-zenithjoy-feature-registry-design.md
git add docs/superpowers/plans/2026-05-01-zenithjoy-feature-registry.md

git commit -m "feat(brain): ZenithJoy feature registry — 87 features (251/252/253) + Notion sync domain 扩展"
```

- [ ] **Step 4: push + 创建 PR**

```bash
git push -u origin HEAD
gh pr create \
  --title "feat(brain): ZenithJoy feature registry — 87 features + Notion sync" \
  --body "..."
```

- [ ] **Step 5: 等待 CI 通过**

```bash
until [[ $(gh pr checks | grep -cE "pending|in_progress") == 0 ]]; do sleep 30; done
gh pr checks
```
