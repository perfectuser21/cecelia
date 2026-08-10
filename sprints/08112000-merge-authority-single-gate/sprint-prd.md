# Sprint PRD — 合并权收归单一裁决闸（harness-judge required check）

## OKR 对齐

- **对应 KR**：F1 开发闭环「交付有回执」（journey e6f803f2 · 步4）—— 合并权必须由裁判裁决，不被旁路
- **当前进度**：待定（Brain 离线未取 OKR 进度）
- **本次推进预期**：堵死三条合并通道中绕过 judge 的两条，收敛到单一 required check 闸

## 背景

系统存在三条互不知晓的 PR 合并通道，其中两条绕过 harness evaluator+judge 裁决。2026-08-10 两次实证：
#4755（通道 1 靠标题判据、`evaluate_verdict`/`judge_verdict` 均 NULL 即被合并）、
#4759（通道 3 engine-pr-watchdog 用 GitHub 原生 `--auto` 强合，hop 9 judge 明确 FAIL 仍被 merge）。
仅改标题判据只覆盖通道 1；通道 3 根本不看归属标记。必须让 harness-owned PR 在裁判放行前**物理上不可合并**。

## Golden Path（核心场景）

系统从 [harness run 开出 cp-* PR] → 经过 [required check 兜底 + 归属求证] → 到达 [judge PASS 才可合并]

具体：
1. harness generator 开出 cp-* PR，kernel 已把 `initiative_runs.pr_url` 写入（非 LLM 撰写）。该 harness-owned PR 上 `harness-judge` required check 默认 pending（非 success）。
2. 无论哪条通道调用 `gh pr merge --auto`（CI 通用 auto-merge 或 engine-pr-watchdog），GitHub 因 required check 未 success 一律**排队不合并**。
3. CI 转绿后 auto-merge job 跑 `should-auto-merge.sh`：脚本以 PR/分支向 Brain 归属端点求证，返回 harness-owned → 输出 `SKIP:...`（不启用通用 auto-merge）。
4. kernel 走 `mergeGate`（evaluate PASS + judge PASS + verdict SHA == PR head + 人审如需）全部满足后，才把 `harness-judge` check 置为 success；此刻 PR 方可合并，由 kernel 合并。
5. 手工 /dev 的 cp-* PR：Brain 求证返回「不属于任何 harness run」→ 脚本输出 `MERGE`，且该 PR 不被 harness-judge 永久阻断（该 check 由 CI auto-merge job 对 not-owned PR 置 success）→ 照旧被通用 auto-merge 合并（不回归）。

出口：harness-owned PR 在 judge PASS 前物理不可合并，PASS 后可合并；非 harness 的 /dev PR 合并路径不受任何影响。

## 范围限定

**在范围内**：
- 引入 `harness-judge` 状态检查作为 harness-owned PR 的 required check（默认 pending，kernel mergeGate 全过才置 success）。
- 新增 Brain PR 归属求证端点（基于 `initiative_runs.pr_url`），fail-closed。
- 通道 1 `should-auto-merge.sh` 判据由标题换为 Brain 求证（保留脚本存在），并补 fail-closed / 归属 / 回归单测。
- 产出通道 3 engine-pr-watchdog 改造说明 + 所需 Brain 端点契约（供后续单独实施）。

**不在范围内**：
- 不改 mergeGate 判定条件、不改 evaluator/judge 流程、不改 gear 分档。
- 不修改 zenithjoy-skills 仓库（仅产出改造说明）。
- 不追溯回滚已被误合并的 #4755 / #4759。

## Invariant 约束（铁律）

- [裁决唯一闸] harness-owned PR 在 judge PASS 前物理上不可合并
- [fail-closed] Brain 不可达/超时/5xx/非法 JSON 一律按 harness-owned 处理，绝不输出 MERGE
- [不回归/dev] Brain 明确「非 harness run」的 cp-* PR 必照旧被通用 auto-merge 合并，禁止误拦
- [归属凭 Brain 非标题] 归属判定只凭 `initiative_runs.pr_url`，禁用 PR 标题 / 分支名作依据

## journey_type: autonomous
## target_environment: local_api
## journey_id: e6f803f2
## step_id: 36121154
