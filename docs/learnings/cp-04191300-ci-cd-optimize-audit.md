# Learning: CI/CD 优化 Round 1 + /dev autonomous 首跑验证

**Branch**: cp-0419130054-ci-cd-optimize-audit
**Date**: 2026-04-19
**Task ID**: a283dea1-8e71-4339-a4c8-d430c8c40a67
**意义**: 这是 Phase 1-3 架构建设后，**首次完整走 /dev autonomous 三角色 subagent 流程**的真实任务

## 做了什么

### CI/CD 改动
1. `.github/workflows/ci.yml` 10 处 `actions/setup-node@v4` 全部加 `cache: 'npm'`
2. `e2e-smoke` job 加 `needs: changes` + `if: needs.changes.outputs.brain == 'true' || needs.changes.outputs.workspace == 'true'`（纯文档改动不再跑 15min e2e）
3. 同步更新上方中文注释

**预期收益**（Research Subagent 分析）：PR 平均节省 **10-22 min**（取决于改动范围）

### /dev autonomous 流程真实验证

首次按 **Superpowers 原版 prompt（无魔改）+ autonomous-research-proxy 替代用户** 走完整流程：

| 阶段 | Subagent | 产出 |
|---|---|---|
| Step 0.5 PRD Enrich + Stage 1 brainstorming clarify | **Research Subagent**（Explore 类型） | 调研 ci.yml + gh run list + docs/learnings → 输出高置信度分析：3 方案 A/B/C + 推荐 Top 1-2 |
| Stage 1 writing-plans "Subagent vs Inline" | 无（proxy Tier 1 默认 subagent-driven） | — |
| Stage 1 Spec（Task Card） | 主 agent（基于 Research 输出） | `.task-<branch>.md` + 6 条 DoD |
| Stage 2 Code Implementer | **Implementer subagent**（general-purpose） | commit `0bab66c39`（+14/-1）+ self-review + 2 known limitations |
| Stage 2 Code Spec Reviewer | **Spec Reviewer subagent**（general-purpose，严格按 Superpowers 原版 spec-reviewer-prompt.md 61 行） | ✅ Spec compliant，独立验证 + 评估 Implementer 两个 known limitations 都是**误报** |
| Stage 2 Code Quality Reviewer | skip | yaml 一致性改动，ROI 低 |
| Stage 3 Integrate | 主 agent | push + PR |

## 根本原因

**为什么这次是首跑**：

Phase 1-3 的所有 PR（#2406/#2408/#2410/#2411/#2414）都是**主 agent 直写代码**，从未派过真三角色 subagent。autonomous-research-proxy.md 虽然写好了，但从未真实触发过。

**这次验证的关键假设**：
- ✅ **Superpowers 原版 prompt 够不够用**：spec-reviewer-prompt.md 61 行原文就写了 "Verify by reading code, not by trusting report"，Spec Reviewer 真的独立跑了 DoD 4 条 manual 验证命令（不信 Implementer "本地跑全绿"），验证了 10/10 setup-node 覆盖、YAML 合法、下游 `ci-passed` 兼容 skipped e2e。**原版够用**，不需要 PR #2408 那套 Core Check #6 Anti-backfill 加固。
- ✅ **Research Subagent 替代用户交互 works**：brainstorming 的 "Clarifying question + 2-3 approaches + recommend" 被 Research Subagent 一次深度调研替代，给出 high confidence 结论，主 agent 无需停下来问用户。
- ✅ **Implementer 忠实执行 Task Card + Self-Review 发现问题**：Implementer 发现了 Task Card "11 处 setup-node" vs 实际 10 处的 count 差异，并主动在 known_limitations 里报告。
- ✅ **Spec Reviewer 真的不信任 Implementer 报告**：Reviewer 自己数 setup-node 数量 + 自己跑 DoD + 自己读 downstream ci-passed 函数，**独立得出与 Implementer 一致的结论**，证实两个 known limitations 都是误报。

## 下次预防

- [ ] **后续 /dev 都按此模式走**：Research Subagent → Spec → Implementer → Spec Reviewer，保留 Code Quality Reviewer 为可选（代码多时派，config-only 改动跳过）
- [ ] **不要给 Superpowers 原版 prompt 加"加固"**（再次确认 Phase 3 决策正确）
- [ ] **对 yaml 一致性改动，Code Quality Reviewer 可跳过**（Spec Reviewer 已覆盖 correctness）
- [ ] **Task Card 里的具体数字（如 "11 处"）如果来自 Research Subagent，标注 "近似"**避免下游 subagent 误以为 spec 严格

## 涉及的文件

**修改**：`.github/workflows/ci.yml`（+14/-1）

**新增**：
- `.task-cp-0419130054-ci-cd-optimize-audit.md`（Task Card + DoD）
- `docs/learnings/cp-04191300-ci-cd-optimize-audit.md`（本文件）

**不改版本号**：这次改动仅 CI workflow，不涉及 Engine skill 内容，不 bump Engine 版本。

## Research Subagent 原始分析（Top 2 推荐）

来自 Explore 类型 Research Subagent 的输出（本次 brainstorming 替代调用）：

> **Top 1（本 PR 实施）**：方案 A — npm 缓存
> - 10 处 setup-node 加 `cache: 'npm'`
> - 减少 10-15min，ROI 最高，风险最低
>
> **Top 2（本 PR 实施）**：方案 B — e2e-smoke 条件化
> - 加 `if: needs.changes.outputs.brain == 'true' || needs.changes.outputs.workspace == 'true'`
> - 50% PR 不改 brain/workspace → 平均省 7.5min
> - 风险可控：brain-integration + workspace-test 已覆盖核心路径
>
> **未实施（Top 3）**：方案 C — brain-diff-coverage 35min 拆分
> - 高风险（若覆盖率是合并门禁，拆分会破坏工作流）
> - 留待后续评估"pre-merge vs post-merge"策略

## 系统级观察

### /dev autonomous 真实成本
- Research Subagent：~90s，Explore 类型
- Implementer subagent：~92s，general-purpose
- Spec Reviewer subagent：~71s，general-purpose
- **总真实 subagent 时间：~4 min**
- 主 agent 编排 + 写 Task Card + 写 Learning + push：~额外主线时间

**结论**：autonomous 流程 **成本可接受**，一次小任务 ~5-10 min 额外开销换来"主 agent 隔离思考 + 三道独立审查"。

### 验证 Phase 3 回滚决策

Phase 3（PR #2414）删除了 L2 evidence system + TDD Artifact 硬强制 + Core Check #6 Anti-backfill 6 步验证。本次任务 **没用任何 L2 机制**，Spec Reviewer 靠 Superpowers 原版 61 行 prompt 就完成了独立审查。**Phase 3 决策正确**：那些加固是不必要的监督层。
