---
id: current-ci-pipeline
version: 1.1.0
created: 2026-03-10
updated: 2026-03-10
authority: CURRENT_STATE
changelog:
  - 1.0.0: 初始版本（审计来源有误，基于非 main 分支旧结构）
  - 1.1.0: 修正为四层 gate 架构（基于 main 分支 worktree 实际审计）
---

# CI 流水线（当前事实版）

> **Authority: CURRENT_STATE**
> 基于当前 main 分支 `.github/workflows/` 实际文件（在 worktree 中审计）。
> 审计时间：2026-03-10。

---

## 1. 当前 Workflow 列表

```
.github/workflows/
├── ci-l1-process.yml      L1 Process Gate    — PR only，快速（2-5min）
├── ci-l2-consistency.yml  L2 Consistency Gate — push + PR
├── ci-l3-code.yml         L3 Code Gate        — push + PR，Brain 变动时
├── ci-l4-runtime.yml      L4 Runtime Gate     — push + PR，Brain 变动时
├── deploy.yml             部署 workflow（内容未完整审计）
└── auto-version.yml       自动版本管理
```

---

## 2. 四层 Gate 架构

```
PR 提交
  │
  ├──► L1 Process Gate    [PR only]      分支合规 / PRD-DoD 格式 / Learning 格式 / 元测试
  ├──► L2 Consistency Gate [push+PR]     CI Evolution Check
  ├──► L3 Code Gate        [push+PR]     Brain Unit Tests（ubuntu，无 DB）
  └──► L4 Runtime Gate     [push+PR]     Brain Integration（macOS + PostgreSQL + GoldenPath）
```

---

## 3. L1 Process Gate（ci-l1-process.yml）

**触发**：pull_request → main（仅 PR）

| Job | 职责 |
|-----|------|
| `changes` | 检测 engine 是否有变更 |
| `verify-dev-workflow` | 分支名必须符合 `cp-XXXXXXXX-task-name` |
| `dod-check` | DoD 文件格式校验 |
| `cleanup-check` | Cleanup 产物检查 |
| `check-prd` | PRD 文件检查（禁止 .prd/.dod 进 main） |
| `check-learning` | Learning 格式（`### 根本原因` + `### 下次预防` + `- [ ]` checklist） |
| `quality-meta-tests` | 质量元测试 |
| `ci-config-audit` | CI 配置审计（engine 有变更时运行） |

---

## 4. L2 Consistency Gate（ci-l2-consistency.yml）

**触发**：push → main ｜ pull_request → main ｜ workflow_dispatch

| Job | 职责 |
|-----|------|
| `changes` | 路径检测 |
| `evolution-check` | `node scripts/ci-evolution-check.mjs`：检测未注册子系统和测试分类 |
| `l2-passed` | 汇总 gate（always 运行） |

---

## 5. L3 Code Gate（ci-l3-code.yml）

**触发**：push → main ｜ pull_request → main ｜ workflow_dispatch
**条件**：仅 brain 有变更时运行

| Job | 职责 | Runner |
|-----|------|--------|
| `changes` | 检测 brain 变更 | ubuntu |
| `brain-unit` | Brain 单元测试（无 DB，vi.mock db.js，不带 --coverage） | ubuntu |

---

## 6. L4 Runtime Gate（ci-l4-runtime.yml）

**触发**：push → main ｜ pull_request → main ｜ workflow_dispatch
**条件**：仅 brain 有变更时运行

| Job | 职责 | Runner |
|-----|------|--------|
| `changes` | 检测 brain 变更 | ubuntu |
| `brain-integration` | 完整集成测试 + Coverage 门禁 + GoldenPath E2E | macOS |

**brain-integration 配置**：
- Homebrew postgresql@17 + pgvector，缓存 key `v2`（含 share/postgresql@17）
- 初始化 `/tmp/pgdata`，pg_isready 前置检查（防静默失败）
- 运行全部迁移文件 → `npx vitest run --coverage`
- Coverage threshold 硬门禁（不可绕过）
- OOM 容错：vitest 非 0 退出但所有测试通过 → exit 0
- `bash scripts/goldenpath-check.sh`

---

## 7. auto-version.yml

**触发**：push → main，根据 commit 前缀自动 bump 版本（5 个文件同步）

| 前缀 | bump |
|------|------|
| `fix:` | patch |
| `feat:` | minor |
| `feat!:` / `BREAKING:` | major |
| `docs:`, `test:`, `chore:` | 不 bump |

---

## 8. 约束汇总

| 约束 | Gate | 时机 |
|------|------|------|
| 分支名 `cp-XXXXXXXX-task-name` | L1 / verify-dev-workflow | 所有 PR |
| Learning 格式（3 个必要元素） | L1 / check-learning | 所有 PR |
| PRD/DoD 不进 main | L1 / check-prd | 所有 PR |
| DoD 格式 | L1 / dod-check | 所有 PR |
| CI Evolution（未注册子系统） | L2 / evolution-check | 所有 push + PR |
| Brain 单元测试（无 DB） | L3 / brain-unit | brain 变更 |
| Brain 集成 + Coverage | L4 / brain-integration | brain 变更 |
| GoldenPath E2E | L4 / brain-integration | brain 变更 |
