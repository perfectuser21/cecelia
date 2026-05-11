# Learning — Harness Pipeline Pre-Merge Gate

**Branch**: cp-0511182214-harness-pre-merge-evaluator-gate
**Date**: 2026-05-11
**PR**: (TBD on push)

## 背景

5 天连续派 W19-W27 harness pipeline 任务，每次 task=failed。系统性 7 层 debug 后定位主问题：evaluator 跑在 PR merge **之后**，违反 Anthropic harness "separating doing / judging" 原则。FAIL 时 main 已污染，fix loop 在污染 main 上跑死循环。

### 根本原因

1. **架构层**：2026-04-09 决策"砍 evaluator，CI 即机械执行器"实证错误。CI（vitest mock）验代码层；evaluator（manual:bash）验行为层。两层验不同事，不可替代。multi-PR 实证（W19/W20/W26）CI 全绿但行为崩。
2. **infra 层（pipeline 跑不动）**：
   - account_usage_cache schema 缺 Opus 7-day quota 字段 → brain 选满额 account → 401
   - harness_planner docker mem=512m → Opus prompt > 1M token cache → OOM 137
   - cecelia-run circuit breaker HALF_OPEN failures 无 cap → 305 累积无法自愈
3. **smoke 验证层**：docker-executor.js 不写 `--label`，容器通过 `--name cecelia-task-{id前12位}` 标识；`metadata.merge_pushed_at` 字段不存在；`evaluateContractNode` 用 `spawnDockerDetached`（直接 docker run -d），不在 tasks 表创建子记录。smoke 需基于代码路由静态断言，而非假设字段/label 存在。

## 修复

撤销 04-09 决策（新 memory `harness-pipeline-evaluator-as-pre-merge-gate.md`）。在 `harness-task.graph.js` 任务子图内插入 `evaluate_contract` 节点（poll_ci 后、merge_pr 前），verdict PASS→merge / FAIL→fix。`initiative.graph.js` 删 per-task `evaluate` 节点（下沉子图）。infra 三处一并修（omelette quota 字段、docker mem 升级、circuit breaker cap）。smoke.sh 实现三层验证：L1 静态路由断言（必须通过）/ L2 Brain 健康检查 / L3 容器 spawn + 时序断言（Brain tick 活跃时才跑）。

### 下次预防

- [ ] 任何"X 是机械执行器，砍 Y"的决策必须 grep 既有 memory 找过往实证再做，避免重复 04-09 错决策
- [ ] 新 task_type 加 resource tier 时同步在 `TASK_TYPE_TIER` map 写明（避免默认 light 时被 Opus OOM）
- [ ] circuit breaker failures 计数器要设 cap，否则长寿环境下数值飘升干扰诊断
- [ ] harness pipeline 任何"代码+CI 都绿但行为崩"的报告 → 第一动作派 evaluator container 真验
- [ ] smoke.sh 实现前先 grep 验证 docker label/字段真名；不按 plan 草稿原样照搬，以代码现状为准

## 关联

- PRD: `docs/handoffs/2026-05-11-harness-pipeline-pre-merge-gate-fix.md`
- Design: `docs/superpowers/specs/2026-05-11-harness-pre-merge-gate-design.md`
- 撤销决策: 2026-04-09 `harness-pipeline-decision-20260409.md`
- 新决策: 2026-05-11 `harness-pipeline-evaluator-as-pre-merge-gate.md`
- 工厂证书: `w19-walking-skeleton-pipeline-validated.md`（14 节点跑通历史）
