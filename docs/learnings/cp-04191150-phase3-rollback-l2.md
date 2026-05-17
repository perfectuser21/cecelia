# Learning: Phase 3 — 回滚 L2 自创加固 + 补 upstream 同步

**Branch**: cp-0419115057-phase3-rollback-l2
**Date**: 2026-04-19
**Task ID**: 891a6164-695f-444c-8345-54310d2d8296
**Depends on**: PR #2406 (L1), #2408 (L2), #2410 (R1), #2411 (R2)

## 做了什么

### 回滚 PR #2408 L2 evidence 系统（整体）

- `implementer-prompt.md`：170 行 → **113 行**（Superpowers 原版，删自创 TDD Deliverables Contract 57 行）
- `spec-reviewer-prompt.md`：103 行 → **61 行**（Superpowers 原版，删自创 Core Check #6 Anti-backfill 42 行）
- `02-code.md`：删除 3 处 `record-evidence.sh` 插桩（§2.2 Implementer、§2.3 Spec Reviewer、§2.6 Pre-Completion Verification）
- 删除 `packages/engine/scripts/record-evidence.sh` (383 行)
- 删除 `packages/engine/scripts/record-evidence.README.md` (98 行)
- 删除 `packages/engine/scripts/devgate/check-pipeline-evidence.cjs` (484 行)
- 删除 `packages/engine/tests/devgate/check-pipeline-evidence.test.cjs` (209 行)
- 删除 `packages/engine/tests/devgate/check-pipeline-evidence.wrapper.test.ts`
- `.github/workflows/ci.yml` 删除 Pipeline Evidence Gate step
- `packages/engine/vitest.config.ts` 删除 2 处 `check-pipeline-evidence.test.cjs` exclude
- `alignment.yaml` 删除所有 `runtime_evidence` 字段（10 skill × 6713 字节）+ 删除 `_metadata.runtime_evidence_coverage` 块 + 删除 L2 新增 invariants + next_actions 块

### 补 upstream 同步基础设施

- 新增 3 个未本地化 skill 的 SKILL.md 副本（drift 检测闭合）：
  - `packages/engine/skills/dev/prompts/executing-plans/SKILL.md` (70 行)
  - `packages/engine/skills/dev/prompts/dispatching-parallel-agents/SKILL.md` (182 行)
  - `packages/engine/skills/dev/prompts/finishing-a-development-branch/SKILL.md` (200 行)
- `alignment.yaml` 为这 3 个 skill 补 `local_prompt` 条目（含 sha256，取代原来 `local_prompt: null`）
- 新增 `packages/engine/scripts/sync-from-upstream.sh`：
  - 扫 `~/.claude-account1/plugins/cache/superpowers-marketplace/superpowers/*/skills/`
  - 对比每个本地 prompt 的 sha256 与 upstream
  - drift → 报告不一致文件列表 + 标记 upstream 新 skill + 给人工决策指引
  - 本地跑通报 `[OK] 所有本地 prompt 与 upstream 5.0.7 sha256 一致`

### 版本

Engine `14.17.8` → `14.17.9`（6 处同步）

## 根本原因

**Alex 的核心洞察**：
- Superpowers 是**活跃开源项目**（今天的 5.0.7 已迭代多版，未来还会升级）
- Engine 越自创 → 每次 upstream 升级越难同步 → 最终和 upstream 脱节
- **正确的 fork 哲学**：最小入侵，只加"人机交互替代 + 防退化基础设施 + Engine 自己的兜底"，**不改 Superpowers 原 prompt 一个字**

**PR #2408 违反这个原则**：
- 自创 L2 evidence 系统（Superpowers 没这概念）
- 魔改 Superpowers `implementer-prompt.md`（+57 行 TDD Deliverables Contract，非原意）
- 魔改 Superpowers `spec-reviewer-prompt.md`（+42 行 Core Check #6 Anti-backfill，非原意）
- 逻辑：**"不信 subagent 按 Superpowers 做事" → 加一层监督**。但 Superpowers 原 prompt 已经是完整方法论载体（`spec-reviewer-prompt.md` 原文就说 "Verify by reading code, not by trusting report"），忠实跑就抓得到问题。自加监督是多此一举。

**Alex 的原话**："superpower 里面很多东西它是要跟人机交互嘛，我们只是把这个人机交互端的这个前面的这个对话的东西，让子代理去做了。其他的后面应该是完全一致的。"

**事实验证**：L2 evidence 系统上线两天（2026-04-18 合并至 2026-04-19），**零 evidence 文件产生**（我手动 /dev 跑的 PR 从未派真三角色 subagent），等于自动化空转。

## 下次预防

- [ ] **任何"在 Superpowers prompt 上加内容"的冲动**：立刻停下。如果真的缺什么，要么：
  - (a) 去 Superpowers 项目提 PR（让 upstream 吸收）
  - (b) 只在 Engine 层加（`autonomous-research-proxy.md` / Stop Hook / Brain worker），不动 `prompts/` 副本
- [ ] **升级 Superpowers 时的流程**：
  - 下载新版 cache 到 `~/.claude-account1/plugins/cache/superpowers-marketplace/superpowers/<ver>/`
  - 跑 `bash packages/engine/scripts/sync-from-upstream.sh` → 查 drift
  - drift 每一项人工 diff upstream vs local → 决定同步 or 刻意偏离（后者在 alignment.yaml notes 里说明）
  - 更新 alignment.yaml sha256
  - 跑 `node packages/engine/scripts/devgate/check-superpowers-alignment.cjs` 验证
  - 推 PR
- [ ] **不要写"自动同步"脚本**（自动 cp upstream → local），这会掩盖人工决策。sync-from-upstream 只报告不做。
- [ ] **"Engine 独有"的增强**放 `autonomous-research-proxy.md` 里：它是 Engine 对 Superpowers 的补丁层，升级时它也保持稳定（只依赖交互点清单，不依赖 prompt 内容）

## 涉及的文件

**修改（8 个）**：
- `packages/engine/skills/dev/prompts/subagent-driven-development/implementer-prompt.md`（-57 行）
- `packages/engine/skills/dev/prompts/subagent-driven-development/spec-reviewer-prompt.md`（-42 行）
- `packages/engine/skills/dev/steps/02-code.md`（删 3 处 record-evidence）
- `packages/engine/contracts/superpowers-alignment.yaml`（删 runtime_evidence + 补 3 skill local_prompt）
- `.github/workflows/ci.yml`（删 Pipeline Evidence Gate）
- `packages/engine/vitest.config.ts`（清 exclude）
- `packages/engine/feature-registry.yml`（14.17.9 条目）
- `packages/engine/VERSION` / `package.json` / `package-lock.json` / `.hook-core-version` / `hooks/VERSION` / `SKILL.md` / `regression-contract.yaml`（bump）

**新增（5 个）**：
- `packages/engine/scripts/sync-from-upstream.sh`
- `packages/engine/skills/dev/prompts/executing-plans/SKILL.md`
- `packages/engine/skills/dev/prompts/dispatching-parallel-agents/SKILL.md`
- `packages/engine/skills/dev/prompts/finishing-a-development-branch/SKILL.md`
- `docs/learnings/cp-04191150-phase3-rollback-l2.md`（本文件）

**删除（5 个）**：
- `packages/engine/scripts/record-evidence.sh`
- `packages/engine/scripts/record-evidence.README.md`
- `packages/engine/scripts/devgate/check-pipeline-evidence.cjs`
- `packages/engine/tests/devgate/check-pipeline-evidence.test.cjs`
- `packages/engine/tests/devgate/check-pipeline-evidence.wrapper.test.ts`

## 现在 Engine ↔ Superpowers 真实状态

| 维度 | 今天（14.17.9） |
|---|---|
| **Superpowers skill 1:1 复刻** | 11 / 11 本地化 SKILL.md + 3 个 subagent prompt 副本。sha256 与 upstream 5.0.7 **完全一致** |
| **魔改量** | **0** — 所有本地 prompt 逐字对齐 upstream |
| **Engine 独有层（合理）** | `autonomous-research-proxy.md`（人机交互替代）+ DevGate（alignment + hygiene）+ `orphan-pr-worker`（兜底）+ Stop Hook + 对齐契约 |
| **升级同步机制** | `sync-from-upstream.sh` 报告 drift 或 upstream 新 skill → 人工决策 |
| **自动化空转包袱** | 0（L2 evidence 系统已清除） |

## 架构哲学（最终版）

> **Engine = Superpowers 5.0.7 自动化适配层**
>
> 只加三类东西：
> 1. **人机交互替代**（`autonomous-research-proxy.md`：Research Subagent 代替用户答问）
> 2. **防退化基础设施**（契约 yaml + DevGate + sha256 锁定）
> 3. **Engine 自己的兜底**（Stop Hook 循环 + `orphan-pr-worker` 30min 扫 + `worktree-manage.sh`）
>
> **不做**：
> - 魔改 Superpowers 原 prompt（哪怕一个字）
> - 自创"加强"层（如 L2 evidence JSONL / TDD artifact 硬强制 / Anti-backfill 额外检测）
> - 自动同步 upstream → local（必须人工决策每个 drift）
