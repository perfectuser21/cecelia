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
5. 手工 /dev 的 cp-* PR：Brain 求证返回「不属于任何 harness run」→ 脚本输出 `MERGE`，且该 PR 不被施加 harness-judge 阻断（该 check 不适用或直接 success）→ 照旧被通用 auto-merge 合并（不回归）。

出口：harness-owned PR 在 judge PASS 前物理不可合并，PASS 后可合并；非 harness 的 /dev PR 合并路径不受任何影响。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导（新 Brain 归属端点的字段/类型），Planner 不定义技术规范。 -->

## 边界情况

- Brain 不可达 / 超时 / 5xx / 非法 JSON：一律 fail-closed 按 harness-owned 处理（脚本输出 SKIP，且 harness-judge check 保持非 success）。任一情形输出 MERGE 即为缺陷。
- 通道 3 engine-pr-watchdog 源在 zenithjoy-skills（不在本 workspace，**本 PR 不改**）：在 required check 兜底下，即使它误启 `--auto` 也只会等待 harness-judge，不会强合；另需产出改造说明。
- 历史事故分支复现：`cp-08101107-04e4690d`(#4755)、`cp-08101246-643b5302`(#4759) 在新机制下均须判为 harness-owned / SKIP。

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

## 假设

- [ASSUMPTION: `harness-judge` 作为 required check 生效需在 GitHub 分支保护中登记；实现方式（分支保护配置 vs 每 PR commit status）由 proposer 依据 GitHub 原生机制敲定。]
- [ASSUMPTION: Brain 归属端点接受 PR URL 或分支名之一即可求证，返回布尔归属 + run 引用。]
- [ASSUMPTION: 归属求证超时阈值未在证据中指定，取有限值并 fail-closed（见 NFR）。]

## 预期受影响文件

- `packages/brain/src/routes/harness.js`：新增 PR 归属求证端点（读 `initiative_runs.pr_url`）。
- `packages/brain/src/orchestrator/kernel-handlers.js`：`merge_pr` 前，mergeGate 通过后将 `harness-judge` check 置 success（走版本无关 REST）。
- `.github/workflows/scripts/should-auto-merge.sh`：标题判据换 Brain 求证 + fail-closed。
- `.github/workflows/scripts/__tests__/should-auto-merge.test.sh`：补 fail-closed / 归属 / 历史分支回归单测。
- `.github/workflows/ci.yml`：harness-judge required check 的登记 / auto-merge job 说明（如需）。
- `sprints/08112000-merge-authority-single-gate/engine-pr-watchdog-改造说明.md`：通道 3 改造说明 + Brain 端点契约（产出物）。

## NFR 约束

<!-- 来源: 本 sprint thin_prd 显式约束（Brain decisions 表离线未取，PrepPRD 显式值优先） -->
- 超时/延迟：Brain 归属求证须设有限超时（具体值待定，thin_prd 未指定）；超时即 fail-closed=SKIP。
- 频控：无。
- 版本要求：置 check / 合并操作走版本无关 GitHub REST（对齐 kernel `update-branch` gh 2.45 教训）。
- 可观测：归属判定与 auto-merge 失败必须可追溯（脚本输出 `SKIP:<原因>`；auto-merge 排队失败回写 Brain task）。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: 本 sprint thin_prd 红线；Brain 历史 invariant（step/journey_feature/area 三源）因 fleet-worker 离线未取，降级见 concerns -->
- [裁决唯一闸] harness-owned PR 在 judge PASS 前物理上不可合并（来源: 本 sprint 红线）
- [fail-closed] Brain 不可达/超时/5xx/非法 JSON 一律按 harness-owned 处理，绝不输出 MERGE（来源: 本 sprint 红线）
- [不回归/dev] Brain 明确「非 harness run」的 cp-* PR 必照旧被通用 auto-merge 合并，禁止误拦（来源: 本 sprint 红线）
- [归属凭 Brain 非标题] 归属判定只凭 `initiative_runs.pr_url`，禁用 PR 标题 / 分支名作依据（来源: 本 sprint 红线）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；fleet-worker 离线未取 Brain 历史 -->
- （本 line 暂无历史 / Brain 离线未取）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment 产出。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl localhost:5221 + psql + bash 脚本单测；
#       核心红线整合项需一个 harness-owned PR 夹具 + gh required-check 验证，由 proposer 翻译成命令）。
# 期望验收点（自然语言）：
#  1) 核心红线：构造 harness-owned PR 且其 run 无 judge PASS → harness-judge check 非 success，
#     `gh pr merge --auto` 后 PR 不被合并；kernel 置 judge PASS 后 check 转 success、PR 方可合并。
#     未置 PASS 却被合并 = 本项失败。
#  2) 单测：Brain 返回「属于 harness run」→ should-auto-merge.sh 输出 SKIP。
#  3) 单测：Brain 返回「不属于任何 harness run」+ cp-* → 输出 MERGE（/dev 不回归）。
#  4) 单测(fail-closed)：Brain 超时 / 5xx / 非法 JSON 三种 → 三者均输出 SKIP；任一 MERGE 即失败。
#  5) 回归：以 cp-08101107-04e4690d(#4755) 与 cp-08101246-643b5302(#4759) 求证 → 均判 harness-owned/SKIP。
#  6) 新 Brain 端点：补端点单测 + 一条 smoke。
```

## journey_type: autonomous
## journey_type_reason: 主体改动落在 packages/brain（新归属端点 + kernel 置 check）与 CI 脚本，属纯后端/自治管线，无 UI 无远端 agent 协议。
## target_environment: local_api
## target_environment_reason: 验收主面为 curl localhost:5221（Brain 归属端点 + kernel）与本地 bash 脚本单测；红线整合项由本地 evaluator 配合 GitHub PR 夹具执行。
## journey_id: e6f803f2
## step_id: 36121154
