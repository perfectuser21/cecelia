# Learning: Phase 1 模式统一 Round 1 — Orphan PR Worker + Standard 弃用通告

**Branch**: cp-0418205229-phase1-unification
**Date**: 2026-04-18
**Task ID**: 3611ea6e-87bd-43df-9df6-9d0ce16e46b6
**Depends on**: PR #2406 (L1), #2408 (L2)

## 做了什么

1. **Brain orphan-pr-worker**（`packages/brain/src/orphan-pr-worker.js`，391 行）
   - 每 30 分钟（`CECELIA_ORPHAN_PR_WORKER_INTERVAL_MS`）扫一次自己推的 `cp-*` PR
   - **孤儿定义**：open > 2h（`ORPHAN_PR_AGE_THRESHOLD_HOURS`）+ Brain 无对应 in_progress task（`tasks.result->>'pr_url' = pr.url`）
   - **处理**：CI 全绿 → `gh pr merge --squash`；CI 有 fail → 打 `needs-attention` 标签（可 `ORPHAN_PR_LABEL` 覆盖）；CI 在跑 → skip（下 tick 再查）
   - **防误 merge**：Brain DB 挂时保守跳过（当作"非孤儿"），每 PR 独立 try/catch 不阻止其他扫描
   - 集成到 `tick.js`（`_lastOrphanPrWorkerTime` + `ORPHAN_PR_WORKER_INTERVAL_MS`，与 `pipeline-watchdog` / `cleanup-worker` 同构）

2. **13 个 vitest 单元测试**（`__tests__/orphan-pr-worker.test.js`）覆盖：
   - 无 PR / <2h / 非 cp-* / Brain task 活跃 / CI 绿→merge / CI fail→label / CI pending→skip
   - 错误隔离（单 PR 挂不阻止其他） / dryRun / threshold 可配 / gh 挂 / DB 挂 / label 可覆盖

3. **SKILL.md Standard 模式弃用通告**（不删代码，只加通告）
   - frontmatter description 改为 "autonomous 是唯一推荐默认"
   - "## 流程（标准模式）" 章节加顶部 `⚠️` 弃用警示
   - changelog 14.17.7 记录

4. **版本 bump**：14.17.6 → 14.17.7（6 处同步）

## 根本原因

PR #2406 #2408 两次 Stop Hook 过早 exit：
- Stop Hook 条件 0.5 快速通道（harness_mode=true）本应由 Brain 派 evaluator 接手
- 但如果 Brain 不认识这个 task（非 harness_generate 派发）→ 快速通道放行后**无人接手**
- **根本问题**：依赖 agent 记住"手动 /dev 不要写 harness_mode=true" = 零护栏

正确做法是**系统层面的兜底**：不管任何 agent 怎么写 .dev-mode，不管 Stop Hook 怎么 exit，Brain 都有 30 分钟兜底扫孤儿 PR 并处理。

## 下次预防

- [ ] **不要再用 agent 记忆做兜底**：Memory feedback 对 LLM 是软约束，不是硬约束。系统漏洞必须代码层补
- [ ] **新的 Brain worker 写作模板**：参照 `pipeline-watchdog.js` / `cleanup-worker.js` 的 elapsed-time + MINIMAL_MODE + 非阻塞 Promise 模式
- [ ] **孤儿 PR 兜底后续优化**：
  - 观察 1-2 周，看是否有误 merge（目前保守策略应该不会误，但需验证）
  - 评估 CI pending 边缘情况（gh pr checks 对 neutral/skipped/queued 的分类）
  - 考虑 label 加作者时间戳（方便追踪谁放的）
- [ ] **Phase 1 Round 2（下个 PR）**：真正删除 Standard 模式代码（01-spec.md L253-347 + 02-code.md §3 + parse-dev-args.sh 的 --autonomous flag），不只是加通告

## 为什么只做 Round 1 不做 Full Phase 1

预制件（T1-T6）已经备齐完整方案，但本 PR 收敛 scope 为：
- **最高 ROI**：orphan-pr-worker（立即堵漏洞）
- **最小风险**：不删代码，只加通告
- **快速验证**：让兜底机制先在线上跑 1-2 周，观察有无边缘 case

下个 PR（Round 2）再把 Standard 代码真正删掉（11 个 A 类删除点）。这样分两步降低误伤现有流程的风险。

## 涉及的文件

新增：
- `packages/brain/src/orphan-pr-worker.js`（391 行）
- `packages/brain/src/__tests__/orphan-pr-worker.test.js`（474 行，13 test）
- `docs/learnings/cp-04182052-phase1-unification.md`（本文件）
- `sprints/phase1-unification/`（PRD / sprint-contract / task-card / T1-T5 诊断文档）

修改：
- `packages/brain/src/tick.js`（+16 行 orphan-pr-worker 集成）
- `packages/engine/skills/dev/SKILL.md`（frontmatter + Standard 弃用通告）
- `packages/engine/feature-registry.yml`（14.17.7 条目）
- `packages/engine/VERSION` / `package.json` / `package-lock.json` / `.hook-core-version` / `hooks/VERSION` / `regression-contract.yaml`（bump 14.17.6 → 14.17.7）

## 执行方式

延续 PR #2406 #2408 的"6 并行 agent team 备料 + /dev harness 落地"模式。本 PR 收敛 scope 后实际只应用 T5（orphan-pr-worker）+ T3 的 SKILL.md frontmatter edit；T1-T4 识别的其他删除点暂缓到下个 PR。
