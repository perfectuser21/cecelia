# Sprint PRD — 合并权收归单一裁决闸（harness-judge required check）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（progress 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（堵死绕过 judge 的两条合并通道，恢复裁判权威）

## 背景

系统里存在三条互不知晓的 PR 合并通道，其中两条完全绕过 harness 的 evaluator+judge 裁决。
2026-08-10 两次实证：#4755 标题 `fix(orchestrator):` 绕过通道 1 标题判据被合并（其 run
`evaluate_verdict`/`judge_verdict` 均为 NULL）；#4759 被通道 3 engine-pr-watchdog 的
`gh pr merge --auto` 强合，而其 run hop 9 `verdict:judge` 明确为 FAIL——「裁判说不放行，代码还是被 merge 了」。
修标题判据只覆盖通道 1；通道 3 根本不看归属标记。必须让 harness-owned PR 在裁判放行前**物理上不可合并**。

## Golden Path（核心场景）

系统从 [一个 cp-* PR 的 CI 转绿] → 经过 [向 Brain 求证归属 + required check 卡闸] → 到达 [只有 kernel 判决放行才可合并]

具体：
1. 一个 cp-* PR 的 required CI 全部转绿，触发通道 1（`should-auto-merge.sh`）与通道 3（`gh pr merge --auto`）。
2. 通道 1 脚本以 PR 分支/号向 Brain 归属端点求证：查 `initiative_runs.pr_url`（kernel 写入，非 LLM 撰写），返回 owned / not_owned。
3. **harness-owned**：状态检查 `harness-judge` 默认为非 success（pending）。GitHub `--auto` 与通用 auto-merge 都会等待 required checks → PR 物理不可合并。通道 1 脚本输出 `SKIP`。
4. kernel 走完 `mergeGate`（evaluate PASS + judge PASS + verdict SHA == PR head + 人审如需）→ 置 `harness-judge` check = success → PR 方可合并。
5. **not_owned**（手动 /dev 的 cp-* PR，Brain 明确回答"不属于任何 harness run"）：通道 1 脚本输出 `MERGE`，照旧被通用 auto-merge 合并（**/dev 流程不回归**）。
6. **fail-closed**：Brain 超时 / 5xx / 非法 JSON → 通道 1 脚本按 harness-owned 处理，输出 `SKIP`，绝不误合。

出口（可观测）：#4755 分支 `cp-08101107-04e4690d`、#4759 分支 `cp-08101246-643b5302` 在新机制下均判定 harness-owned / `SKIP`——当天两起事故不会重演。

<!-- Response Schema（Brain 归属端点的字段名/类型）由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不定义技术规范。 -->

## 边界情况

- Brain 超时 / 5xx / 非法 JSON → fail-closed 输出 SKIP（三种都测）。
- PR 无对应 `initiative_runs.pr_url` 记录（真手动 /dev）→ 输出 MERGE，不误拦（红线）。
- 非 cp-* 分支 → 保留脚本原有 SKIP 行为，不受本次改动影响。
- `harness-judge` required check 尚未在分支保护中注册的过渡期：通道 1 的 Brain 求证判据即可独立兜住通道 1；required check 上线后同时兜住通道 3。

## 范围限定

**在范围内**：
- 通道 1 `should-auto-merge.sh` 判据从标题正则换成 Brain 归属求证（fail-closed）。
- 新增/接线 Brain 归属查询端点（依据 `initiative_runs.pr_url`）。
- kernel 在 `mergeGate` 全部条件满足后，把 `harness-judge` required status check 置为 success（不改 mergeGate 判定条件本身）。
- 产出 engine-pr-watchdog（通道 3）改造说明 + 所需 Brain 端点契约（本 PR 不改 zenithjoy-skills 源）。

**不在范围内**：
- 不改 mergeGate 判定条件、不改 evaluator/judge 流程、不改 gear 分档。
- 不修改 zenithjoy-skills 仓库（仅产出改造说明）。
- 不追溯回滚已被误合并的 #4755 / #4759。

## 假设

- [ASSUMPTION: `harness-judge` 作为 required status check 通过 GitHub 分支保护规则注册于 cp-* / harness-owned PR；required check 的机制层由该配置提供，本 PR 负责在 kernel 侧置 success + 在归属侧决定是否放行。]
- [ASSUMPTION: Brain 归属端点接受 PR 号或 head 分支名作为入参，通过 `initiative_runs.pr_url` 精确匹配；kernel 创建 PR 时已回写 pr_url。]

## 预期受影响文件

- `.github/workflows/scripts/should-auto-merge.sh`: 判据由 `feat(harness):` 标题正则改为 Brain 归属求证；带超时 + fail-closed（超时/5xx/非法 JSON → SKIP）。
- `packages/brain/src/`（归属端点，路由具体位置由 Proposer 定）: 输入 PR 号/分支 → 查 `initiative_runs.pr_url` → 返回 owned/not_owned。
- `packages/brain/src/orchestrator/`（kernel merge 流程）: mergeGate.allow 后新增"置 `harness-judge` check=success"动作；不改 `gates.js:mergeGate` 判定条件。
- `.github/workflows/*.yml`: `harness-judge` 作为 harness-owned PR required check 的注册/说明。
- `sprints/08111144-kernel-51740e13/`（交付物）: engine-pr-watchdog 改造说明 + Brain 端点契约文档。
- 对应单测/集成测试文件（Brain 端点、脚本三态 fail-closed、历史分支回归、核心红线集成）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr 为空；以下取 thin_prd 显式红线 -->
- 超时/容错: 通道 1 对 Brain 归属求证须设明确超时；超时/5xx/非法 JSON 一律 fail-closed → SKIP。
- 可靠性: 归属判定只凭 `initiative_runs.pr_url`（kernel 写入），禁止依赖 PR 标题或分支名。
- 可观测: 归属判定结果与 fail-closed 触发原因需可追溯（脚本输出含原因串）。
- 不回归红线: Brain 明确 not_owned 的手动 /dev cp-* PR 必须照旧被通用 auto-merge 合并。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: 本 sprint 红线（thin_prd「必须实现/边界」）+ area 级 decisions；step/journey_feature 级为空 -->
- [裁判前不可合并] harness-owned PR 在 kernel 置 judge PASS 前物理不可合并（来源: 本 sprint 红线）
- [fail-closed] Brain 不可达/超时/5xx/非法 JSON 一律按 harness-owned 处理，输出 SKIP（来源: 本 sprint 红线）
- [不误拦 /dev] Brain 明确"不属于任何 harness run"的 cp-* PR 必须照旧被通用 auto-merge 合并（来源: 本 sprint 红线）
- [归属只信 Brain] 归属判定只凭 initiative_runs.pr_url，禁止依赖 PR 标题/分支名（来源: 本 sprint 红线）
- [不动裁决内核] 不改 mergeGate 判定条件、evaluator/judge 流程、gear 分档（来源: 本 sprint 边界）
- [judge FAIL 先辨证据] judge FAIL 先区分"证据压缩窗口截断"与"实现缺陷"，evidence_insufficient 优先走补证轮而非改代码（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journeys/e6f803f2 golden-paths 查询为空 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（curl localhost:5221 归属端点 + psql initiative_runs + 本地跑 should-auto-merge.sh；核心红线集成验 required check 状态与 gh pr merge 行为）。

```bash
# 占位：proposer 按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
# 1. 核心红线集成：构造 harness-owned PR（其 run 无 judge PASS）→ 断言 harness-judge check 非 success，
#    且 gh pr merge --auto 后 PR 未被合并；kernel 置 judge PASS 后 check 转 success，PR 方可合并。未置 PASS 却被合并即失败。
# 2. 单测：Brain 返回 owned → should-auto-merge.sh 输出 SKIP。
# 3. 单测：Brain 返回 not_owned + cp-* → 输出 MERGE（/dev 不回归）。
# 4. 单测 fail-closed：Brain 超时 / 5xx / 非法 JSON 三种 → 三者均 SKIP；任一 MERGE 即失败。
# 5. 回归（真实历史）：以分支 cp-08101107-04e4690d 与 cp-08101246-643b5302 查询 → 两者均 harness-owned / SKIP。
# 6. 新增 Brain 端点 → 补端点单测 + 一条 smoke。
```

## journey_type: autonomous
## journey_type_reason: 改动落在 packages/brain（归属端点 + kernel merge 流程）与 CI 脚本，纯后端/调度闭环，无 UI、无远端 agent 协议。
## target_environment: local_api
## target_environment_reason: 验收主体为 curl localhost:5221 归属端点 + psql initiative_runs + 本地运行 should-auto-merge.sh，由本地 evaluator 执行。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: 36121154（F1 开发闭环·步4「交付有回执」）
