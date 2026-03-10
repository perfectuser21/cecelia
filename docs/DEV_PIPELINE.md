---
> ⚠️ **DEPRECATED** — 此文档为初稿，已被 `docs/current/DEV_PIPELINE.md` 取代。
> 请阅读 [docs/current/DEV_PIPELINE.md](./current/DEV_PIPELINE.md)（authority: CURRENT_STATE）。
---

---
id: dev-pipeline
version: 1.0.0
created: 2026-03-10
updated: 2026-03-10
changelog:
  - 1.0.0: 初始版本，基于 packages/engine/skills/dev/SKILL.md v3.4.1 生成
---

# /dev 开发流水线（DEV PIPELINE）

> 本文档基于 `packages/engine/skills/dev/SKILL.md`（v3.4.1）和 `packages/engine/hooks/` 实际代码生成。
> 不包含推测内容。

---

## 概述

`/dev` 是 Cecelia 仓库所有代码变更的唯一入口。任何会进 git 的文件改动，必须走 `/dev`，没有例外。

`branch-protect.sh` hook 强制拦截不经 `/dev` 的写文件操作。

**两种启动方式**：

```bash
/dev                    # 手动提供 PRD，正常流程
/dev --task-id <id>     # 从 Brain PostgreSQL 读取 Task PRD，自动流程
```

---

## 完整流程（12 步）

```
Step 00 → Step 01 → Step 02 → Step 03 → Step 04 → Step 05
  ↓                                                    ↓
Worktree  PRD 文档  变更检测   分支管理   架构探索   DoD 定稿
  检测                                                 ↓
                                                   Step 06
                                                   写代码
                                                      ↓
                                               Step 07 → Step 08 → Step 09
                                               本地验证   创建 PR    CI 监控
                                                                      ↓
                                                               Step 10 → Step 11
                                                               写 Learning  清理
```

---

## 各步骤详解

### Step 00 — Worktree 自动检测

**定义文件**：`packages/engine/skills/dev/steps/00-worktree-auto.md`

触发 `/dev` 后第一件事：确认当前是否在独立 worktree 环境中。

- 若不在 worktree → 自动创建新 worktree（隔离开发环境）
- Worktree 路径独立于主仓库，防止污染 main 分支

**关键原则**：在 Step 00 完成前，禁止任何其他操作。

---

### Step 01 — PRD 文档

**定义文件**：`packages/engine/skills/dev/steps/01-prd.md`

生成或读取需求文档（PRD）。

- 手动模式：通过对话确认需求，生成 `.prd-{branch}.md`
- `--task-id` 模式：
  - 调用 `scripts/parse-dev-args.sh` 解析参数
  - 调用 `scripts/fetch-task-prd.sh` 从 Brain API 读取 Task
  - 自动生成 `.prd-task-{id}.md` + `.dod-task-{id}.md`

PRD 文件放在**离被编辑文件最近的祖先目录**（hook 向上搜索，先找先停）。

**branch-protect hook 校验**：PRD 至少 3 行，包含关键字段。

---

### Step 02 — 变更检测（影响分析）

**定义文件**：`packages/engine/skills/dev/steps/02-detect.md`

分析本次变更的影响范围：
- 确认属于哪个子系统（brain / engine / workspace / workflows / quality）
- 查询是否有重复实现（检查已合并 PR 和 open PR）
- 若 main 已有同等实现 → 直接合并，不重复开发

---

### Step 03 — 分支管理

**定义文件**：`packages/engine/skills/dev/steps/03-branch.md`

- 分支命名规范：`cp-MMDDHHNN-{task-name}`
- 从 main 创建新分支
- 确认已在正确的 worktree + 分支上

---

### Step 04 — 架构探索

**定义文件**：`packages/engine/skills/dev/steps/04-explore.md`

在写代码之前：
- 阅读相关源文件，理解现有架构
- 确认修改边界（brain / engine / workspace 不越界）
- 识别需要同步更新的配置文件（如 task-router.js, DEFINITION.md）

---

### Step 05 — DoD 定稿

**定义文件**：`packages/engine/skills/dev/steps/05-dod.md`

生成完成度定义文件（`.dod-{branch}.md`）：
- 明确验收标准（测试用例、行为断言）
- P0/P1 条目必须有对应 RCI（回归测试条目）
- DoD 和测试的映射关系由 `scripts/devgate/check-dod-mapping.cjs` 在 CI 校验

---

### Step 06 — 写代码

**定义文件**：`packages/engine/skills/dev/steps/06-code.md`

实际代码实现阶段。

**branch-protect hook 保护**：
- 检查当前分支（禁止在 main 写代码）
- 检查 PRD/DoD 文件存在且有效
- 检查 `.dev-mode` 文件存在

**Brain 改动的额外要求**：
- 改动 `packages/brain/` 前必须先通过本地预检
- 执行 `node scripts/facts-check.mjs`
- 执行 `bash scripts/check-version-sync.sh`
- 执行 `node packages/brain/scripts/generate-manifest.mjs --check`

**Engine Skills 改动的额外要求**：
- PR title 含 `[CONFIG]` 或 `[INFRA]`
- 更新 `packages/engine/features/feature-registry.yml`
- 重新生成路径视图：`bash scripts/generate-path-views.sh`

---

### Step 07 — 本地验证

**定义文件**：`packages/engine/skills/dev/steps/07-verify.md`

push 前本地验证：
- `npm test`（对应子包）
- `npm run build`（如有）
- Brain 改动：额外运行 `node scripts/facts-check.mjs`

**规则**：CI 失败 → 本地复现 → 修复 → 本地全绿 → 才 push。不允许连续 push 试错。

---

### Step 08 — 创建 PR

**定义文件**：`packages/engine/skills/dev/steps/08-pr.md`

- 目标分支：动态检测（有 develop 用 develop，否则 main）
- PR title 格式遵循 conventional commits
- Skills 改动的 PR title 必须含 `[CONFIG]` 或 `[INFRA]`

---

### Step 09 — CI 监控

**定义文件**：`packages/engine/skills/dev/steps/09-ci.md`

push 后必须等待 CI 完成：

```bash
# 等待 CI 启动
sleep 30

# 查询状态
gh run list --repo <owner>/<repo> --branch <branch> --limit 1 \
  --json status,conclusion,databaseId

# 若失败，查看日志
gh run view <id> --log-failed
```

**禁止**：
- push 后立即继续下一任务
- 查询一次就停止
- 遇到权限错误就放弃

---

### Step 10 — 写 LEARNINGS（⚠️ 必须在合并前完成）

**定义文件**：`packages/engine/skills/dev/steps/10-learning.md`

**顺序铁律**：CI 通过后禁止立即合并，必须先写 LEARNINGS。

**格式要求**（DevGate Learning Format Gate 检查）：
- `### 根本原因` 章节
- `### 下次预防` 章节
- `- [ ]` 格式的 checklist（至少一条）

流程：写 Learning → push 到功能分支 → 再合并 PR。

---

### Step 11 — 清理

**定义文件**：`packages/engine/skills/dev/steps/11-cleanup.md`

- 删除功能分支
- 移除 worktree
- 删除临时文件（PRD/DoD/dev-mode 文件不进 main）

---

## Hook 系统

| Hook 文件 | 触发时机 | 职责 |
|---------|---------|------|
| `branch-protect.sh` | 写文件前 | 检查分支/PRD/DoD/dev-mode |
| `stop-dev.sh` | claude 停止时 | /dev 工作流续跑逻辑 |
| `stop.sh` | claude 停止时 | 通用停止处理 |
| `bash-guard.sh` | 写 .sh 文件前 | Bash 语法检查 |
| `credential-guard.sh` | 写文件前 | 凭据泄露防护 |

**bootstrap 顺序（防止鸡蛋问题）**：

由于 branch-protect hook 在写文件时触发，创建 PRD/DoD/dev-mode 本身需要绕过检查：

1. 用 `Bash` 工具（不走 hook）创建 `.dev-mode` + `.dev-lock.*`
2. 用 `Bash` 工具创建 PRD/DoD 文件（放在最近祖先目录）
3. 之后用 `Write/Edit` 工具正常改代码（此时 hook 检查已通过）

---

## Brain 改动专属规则

Brain 代码 (`packages/brain/`) 改动时，除标准 /dev 流程外，还需：

**本地预检（改代码前）**：
```bash
node scripts/facts-check.mjs          # DEFINITION.md 与代码一致性
bash scripts/check-version-sync.sh    # Brain 版本 4 文件同步
node scripts/devgate/check-dod-mapping.cjs  # DoD→Test 映射
node packages/brain/scripts/generate-manifest.mjs --check  # 清单同步
```

**版本 bump 时同步 4 个文件**：
1. `packages/brain/package.json`（SSOT）
2. `packages/brain/package-lock.json`
3. `DEFINITION.md` 第 9 行
4. `.brain-versions`

---

## 并发 PR 处理（24/7 Brain 自动派发场景）

Brain 持续派发任务，可能产生并发 PR 竞态：

1. CI 通过后立查 `gh pr view --json mergeStateStatus`
2. CLEAN → 立刻 merge
3. BEHIND/DIRTY → `git merge origin/main --no-edit` → bump 版本（取 max+1）→ push → 等 CI

---

## 强制约束总结

| 约束 | 执行者 |
|------|--------|
| 不走 /dev 禁止改代码 | branch-protect.sh hook |
| 禁止直推 main | GitHub Branch Protection |
| Learning 先于合并 | DevGate Learning Format Gate（CI） |
| 版本必须同步 | facts-check.mjs + check-version-sync.sh（CI） |
| DoD→Test 必须映射 | check-dod-mapping.cjs（CI DevGate） |
| P0/P1 必须有 RCI | require-rci-update-if-p0p1.sh（CI DevGate） |
