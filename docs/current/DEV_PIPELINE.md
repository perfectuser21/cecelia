---
id: current-dev-pipeline
version: 1.0.0
created: 2026-03-10
updated: 2026-03-10
authority: CURRENT_STATE
changelog:
  - 1.0.0: 初始版本，基于 packages/engine/skills/dev/SKILL.md v3.4.1 审计
---

# /dev 开发流水线（当前事实版）

> **Authority: CURRENT_STATE**
> 基于 `packages/engine/skills/dev/SKILL.md`（v3.4.1）和 `packages/engine/hooks/` 实际代码。
> 只记录当前真实生效的流程，不包含计划中的改动。

---

## 核心原则

- `/dev` 是所有代码变更的唯一入口，无例外
- `branch-protect.sh` hook 强制拦截不经 `/dev` 的写文件操作
- **顺序铁律**：Learning（Step 10）必须在合并 PR **之前**完成

---

## 两种启动方式

```bash
/dev                    # 手动提供 PRD
/dev --task-id <id>     # Brain 自动派发，从 PostgreSQL 读取 Task
```

---

## 12 步流程

### Step 00 — Worktree 检测

定义：`packages/engine/skills/dev/steps/00-worktree-auto.md`

- 确认在独立 worktree 中（防止污染 main）
- 不在 worktree → 自动创建
- **Step 00 完成前禁止任何其他操作**

### Step 01 — PRD 文档

定义：`packages/engine/skills/dev/steps/01-prd.md`

- 手动模式：对话确认需求 → 生成 `.prd-{branch}.md`
- `--task-id` 模式：`fetch-task-prd.sh` 从 Brain API 读取 → 自动生成 PRD + DoD 文件
- PRD 放在**离被编辑文件最近的祖先目录**（hook 向上搜索）
- Hook 校验：PRD 至少 3 行，包含关键字段

### Step 02 — 变更检测

定义：`packages/engine/skills/dev/steps/02-detect.md`

- 分析影响范围（哪个子系统）
- 查询是否有重复实现（检查已合并 PR 和 open PR）
- 若已有同等实现 → 直接合并，不重复开发

### Step 03 — 分支管理

定义：`packages/engine/skills/dev/steps/03-branch.md`

- 命名：`cp-MMDDHHNN-{task-name}`
- 从 main 创建
- 确认在正确 worktree + 分支上

### Step 04 — 架构探索

定义：`packages/engine/skills/dev/steps/04-explore.md`

- 阅读相关源文件，理解现有架构
- 确认修改边界（brain / engine / workspace 不越界）
- 识别需要同步更新的配置文件

### Step 05 — DoD 定稿

定义：`packages/engine/skills/dev/steps/05-dod.md`

- 生成 `.dod-{branch}.md`
- 验收标准（测试用例、行为断言）
- P0/P1 条目必须有对应 RCI 条目

### Step 06 — 写代码

定义：`packages/engine/skills/dev/steps/06-code.md`

**branch-protect hook 三项校验**：
1. 当前分支不是 main
2. PRD 文件存在且有效（≥3 行，含关键字段）
3. `.dev-mode` 文件存在

**Brain 改动的额外要求**（改 `packages/brain/` 时手动执行）：
```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/brain/scripts/generate-manifest.mjs --check
```

**Engine Skills 改动的额外要求**：
- PR title 含 `[CONFIG]` 或 `[INFRA]`
- 更新 `packages/engine/features/feature-registry.yml`

### Step 07 — 本地验证

定义：`packages/engine/skills/dev/steps/07-verify.md`

```bash
npm test        # 对应子包
npm run build   # 如有
```

**⚠️ 重要**：当前 main 分支中**不存在** `scripts/local-precheck.sh`。
Brain 改动的预检需手动逐条运行（见 Step 06）。

规则：CI 失败 → 本地复现 → 修复 → 本地全绿 → 才 push。

### Step 08 — 创建 PR

定义：`packages/engine/skills/dev/steps/08-pr.md`

- 目标分支：动态检测（有 develop 用 develop，否则 main）
- PR title 遵循 conventional commits

### Step 09 — CI 监控

定义：`packages/engine/skills/dev/steps/09-ci.md`

```bash
sleep 30
gh run list --repo <owner>/<repo> --branch <branch> --limit 1 \
  --json status,conclusion,databaseId
# 失败时
gh run view <id> --log-failed
```

禁止 push 后立即继续下一任务。

### Step 10 — 写 LEARNINGS（合并前必须完成）

定义：`packages/engine/skills/dev/steps/10-learning.md`

**格式要求**（CI DevGate Learning Format Gate 检查）：
- `### 根本原因` 章节
- `### 下次预防` 章节
- `- [ ]` checklist（至少一条）

顺序：写 Learning → push 到功能分支 → 合并 PR。

### Step 11 — 清理

定义：`packages/engine/skills/dev/steps/11-cleanup.md`

- 删除功能分支
- 移除 worktree
- PRD/DoD/dev-mode 文件不进 main

---

## Hook 系统

| 文件 | 触发时机 | 职责 |
|------|---------|------|
| `branch-protect.sh` | 写文件前 | 分支/PRD/DoD/dev-mode 校验 |
| `stop-dev.sh` | claude 停止时 | /dev 工作流续跑逻辑 |
| `stop.sh` | claude 停止时 | 通用停止处理 |
| `bash-guard.sh` | 写 .sh 前 | Bash 语法检查 |
| `credential-guard.sh` | 写文件前 | 凭据泄露防护 |

**Bootstrap 顺序（防止鸡蛋问题）**：

创建 PRD/DoD 本身会被 hook 检查，需用 `Bash` 工具（不走 hook）：
1. `Bash` 创建 `.dev-mode` + `.dev-lock.*`
2. `Bash` 创建 PRD/DoD（放在最近祖先目录）
3. 之后用 `Write/Edit` 正常改代码

---

## Brain 改动专属约束

**版本 bump 同步 4 个文件**：
```
packages/brain/package.json  ← SSOT
packages/brain/package-lock.json
DEFINITION.md 第 9 行
.brain-versions
```

**并发 PR 处理（Brain 24/7 派发场景）**：
1. CI 通过 → 立查 `gh pr view --json mergeStateStatus`
2. CLEAN → 立刻 merge
3. BEHIND/DIRTY → `git merge origin/main --no-edit` → bump 版本（max+1）→ push → 等 CI

---

## 约束汇总

| 约束 | 执行者 |
|------|--------|
| 不走 /dev 禁止改代码 | branch-protect.sh |
| 禁止直推 main | GitHub Branch Protection |
| Learning 先于合并 | DevGate Learning Format Gate（CI） |
| 版本必须同步 | facts-check.mjs + check-version-sync.sh（CI） |
| DoD→Test 必须映射 | check-dod-mapping.cjs（CI DevGate） |
| P0/P1 必须有 RCI | require-rci-update-if-p0p1.sh（CI DevGate） |
