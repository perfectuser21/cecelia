# Phase 6 e2e proof marker — Design

## 背景

Phase 5 + Phase 6 合并后，需要一次 trivial 的端到端验证，证明 /dev 9 棒接力链（engine-worktree → brainstorming → writing-plans → subagent-driven-development → verification → finishing → engine-ship → Stop Hook）跑通。选最小产出排除 scope 争议。

## 目标

在 `docs/proofs/phase6-e2e/MARKER.md` 新建一个 Markdown 文件，完成一次 cp-* 分支 → PR → 自动合并的完整闭环。

## 架构

单文件新增，无架构变动。

- 文件：`docs/proofs/phase6-e2e/MARKER.md`（新建目录 + 新文件，当前 main 无 `docs/proofs/` 目录）
- 内容：两行
  - `# Phase 6 e2e proof`
  - 一行含 ISO 日期（YYYY-MM-DD）的说明文字："Phase 6 e2e chain verified on 2026-04-19."
- 可附加 PR 链接占位（合并后人可补，但不是成功标准）

## PR & 合并

- 分支：`cp-0419194759-phase6-e2e-proof`（已创）
- 标题：`docs: add phase6 e2e proof marker`（**无 `[CONFIG]` 前缀**，不触发 Engine CI；非 `feat:` 不触发 L3 test-required；非 code 不触发 DevGate）
- 合并路径：Stop Hook 走 `gh pr merge --squash`（Learning 经验：`--auto` 依赖仓库开关，历史死循环根因）

## DoD 匹配 PRD 成功标准

1. `docs/proofs/phase6-e2e/MARKER.md` 存在于 main — PR 合并后生效
2. 文件含 `# Phase 6 e2e proof` + 一行 ISO 日期正文
3. PR title `docs: add phase6 e2e proof marker`
4. CI 自动合并（Stop Hook 介入）
5. `.dev-mode.<branch>` 被删（cleanup）

## 不做（边界）

- 不碰 `packages/`、`apps/`、`scripts/`
- 不改 feature-registry / regression-contract / VERSION
- 不改 CI workflow
- 不写单元测试（非 `feat:`，不触发 L3）
- 不改 changelog

## 风险

- `docs-only` 路径如果 CI 中有 required check 需要所有 PR 都过（而 docs 改动无 job 跑），可能卡 pending — **已验证不存在**（Phase 5/6 PR 同样 docs 相关改动已合并）
- Stop Hook 若因为 `harness_mode` 误判 exit 0 —— 本任务不是 Brain 派的 harness task，`harness_mode=false`，Stop Hook 会阻塞等 CI 合并后再 exit

## 交付步骤

1. 写 `docs/proofs/phase6-e2e/MARKER.md`
2. commit（`docs: add phase6 e2e proof marker`）
3. finishing skill → push + 创 PR
4. engine-ship → Learning + fire-learnings-event + step_4_ship=done
5. Stop Hook → 等 CI → `gh pr merge --squash` → cleanup
