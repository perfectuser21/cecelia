# Sprint PRD — Harness PR 机器身份 + AI 验收前合并硬闸

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（progress 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（恢复 F1 开发闭环「合并唯一权威」，堵死假记完成事故）

## 背景

生产事故 run a2e10f0f：PR #4870（title=`fix(harness):`，merge commit ec24f951，merged_at 2026-08-13T10:43:28Z）在 Generator callback 前被 CI 通用 auto-merge 抢合；同一时刻 run phase=generate、Generator c3931f6b running、Evaluator/Judge 记录为零；10:44:40 Kernel 把 Generator 记 cancelled、run phase=done/failure_reason=null、task completed —— 无任何 AI 验收却假记成功。

根因：`should-auto-merge.sh` 只按 `feat(harness):` 标题前缀识别 harness PR，`fix(harness):` 等其它 change_kind 全部漏网返回 MERGE；且 Kernel 在「PR 外部已合、无 Evaluator/Judge」时按已完成收尾而非 fail-closed。

## Golden Path（核心场景）

系统从 [Harness Generator 产出 PR] → 经过 [机器身份识别 + AI 验收硬闸] → 到达 [唯一合并权威只在 AI 验收通过后放行]

具体：
1. **RED-A（先红）**：构造一个 Harness-owned `fix(harness):` PR（change_kind=bugfix），跑 `should-auto-merge.sh` → 当前返回 `MERGE`（证明标题猜测漏网）。
   - 修复后：Harness 所有 change_kind/title 的 PR，均凭**不可伪造的机器身份**（PR label / check / Brain-issued marker，如 `harness` label）被通用 auto-merge 判为 `SKIP`；禁止再靠 `feat(harness):` 标题字符串猜。普通 `/dev` 的 `fix()/feat()` PR 仍走原通道正常 auto-merge。
2. **RED-B（先红）**：构造 Generator 仍 running、无 Evaluator/Judge、PR 外部已 merged 的 run → 当前 Kernel 把 Generator cancel 且 run/task 记 done、failure_reason=null。
   - 修复后：必须 **fail-closed** —— 记录 `premature_merge`，run/task **不得**标记 completed，并创建一条**可追责事件**（accountable event）。
3. **合并唯一放行条件**（本 sprint 确立的铁律）：同一 `head_sha` 上 **AI Evaluator 人类式验收 PASS/FIXED**（独立阅读 PR/合同、复现风险，不得仅复述 CI）**+ 独立 Judge PASS + Harness merge handler** 三者齐备才放行合并。
4. **顺带修正** `contract-store` 已合入的状态分流：仅 `draft` 可原子换版；`approved` 仅在同证据下幂等返回；`superseded`/未知状态一律 **fail-closed** 抛错，并新增**真实 PostgreSQL 回归**。

## 边界情况

- 普通 `/dev` 的 `fix()/feat()` PR 无机器身份标记 → 必须仍被通用 auto-merge 正常合并（误拦会卡死所有 /dev）。
- PR 外部已 merged 但 Evaluator 尚在同 head_sha 验收中 → fail-closed，不得因外部合并抹掉验收结论。
- contract-store 附着合同为 `superseded`/未知态 → 抛错，禁止静默覆盖已批准合同。

## 范围限定

**在范围内**：should-auto-merge 机器身份识别；Kernel premature_merge fail-closed + 可追责事件；合并唯一权威三闸；contract-store 状态分流 + PostgreSQL 回归；两条真实 RED 回归测试。
**不在范围内**：重构整个 GAN 状态机；改动普通 `/dev` 合并通道逻辑；Evaluator/Judge 内部提示词工程。

## 假设

- [ASSUMPTION: 机器身份采用 CI 已存在的 `harness` label（见 ci.yml:228 job-level 跳过），由 Brain 在建 PR 时下发，runner 不可自伪造。]
- [ASSUMPTION: 「可追责事件」写入 Brain 现有事件/告警通道（如 capture/incident），无需新建表。]
- [ASSUMPTION: 不把通用 internal token 交给不受信 runner —— 机器身份 marker 由 Brain 侧签发/校验，runner 只读。]

## 预期受影响文件

- `.github/workflows/scripts/should-auto-merge.sh`：改标题猜测为不可伪造机器身份判据
- `.github/workflows/scripts/__tests__/should-auto-merge.test.sh`：新增 fix(harness) 机器身份 SKIP + 普通 /dev MERGE 用例（RED-A 回归）
- `.github/workflows/ci.yml`：auto-merge job 把 label/marker 传入决策脚本
- `packages/brain/src/orchestrator/kernel-handlers.js` / `kernel-run-store.js` / `expired-attempt-reconciler.js`：外部已合且无 AI 验收时 fail-closed 记 premature_merge，禁止假记 completed（RED-B）
- `packages/brain/src/orchestrator/gates.js`：合并唯一放行条件（同 head_sha Evaluator PASS/FIXED + Judge PASS + merge handler）
- `packages/brain/src/orchestrator/contract-store.js`：draft 可换版 / approved 同证据幂等 / superseded/未知 fail-closed
- `packages/brain/src/orchestrator/__tests__/contract-store.test.js`：真实 PostgreSQL 状态分流回归

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step+feature 均空）+ PrepPRD 显式项 -->
- 安全（token）：不得把通用 internal token 交给不受信 runner；机器身份 marker 由 Brain 签发/校验，runner 只读（来源: PrepPRD）
- 验收真实性：AI Evaluator 必须独立阅读 PR/合同并复现风险，不得仅复述 CI 结论（来源: PrepPRD）
- 合并权威：合并放行必须锚定同一 head_sha，跨 sha 的验收结论不得放行（来源: PrepPRD）
- 其余延迟/频控/版本：待定（PrepPRD 未指定）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/journey_feature 源为空）。cecelia area 共 80 条，绝大多数为 capture-triage 学习条，仅列与本 sprint 合并权威直接相关者 -->
- [验收时钟 fail-closed] validation_clock_required 默认 fail-closed；仅 gear=hotfix 且 payload pr_url/pr_head_sha 与 GitHub 实时观测完全一致时首个 Evaluator intent 可建共享 validation clock，Judge 复用；缺失或不一致一律拒绝（来源: area · ddca7267）
- [抢竞态] 高频合并 repo（cecelia）update-branch 后立即挂 auto，避免竞态反复 —— 但不得越过 harness 验收 gate 抢合（来源: area · 91ee7d53）
- [CONFLICTING 不空等] PR CONFLICTING 时 GitHub 静默不触发 pull_request CI，先 merge/rebase 再判，不按 CI 卡死空等（来源: area · 70bce96e）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journey e6f803f2 golden-paths 查询返回空 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；proposer 在 GAN 阶段按 target_environment=local_api 填入真实 bash+psql 脚本。

```bash
# 占位：proposer 按 local_api 填入真实脚本（bash 自测 + curl localhost:5221 + psql 回归）
# 期望验收点（自然语言）：
# 1. RED-A：should-auto-merge.sh 对「带 harness 机器身份的 fix(harness) PR」输出 SKIP；
#    对「无身份标记的普通 /dev fix() PR」输出 MERGE。
# 2. RED-B：构造 Generator running + 无 Evaluator/Judge + PR 外部 merged 的 run，
#    psql 查得 run/task 未 completed、failure_reason=premature_merge，且存在一条可追责事件。
# 3. 合并唯一放行：仅当同 head_sha 上 AI Evaluator PASS/FIXED + Judge PASS + merge handler 齐备才放行。
# 4. contract-store：draft 换版成功 / approved 同证据幂等 / superseded/未知 fail-closed 抛错（真实 PostgreSQL）。
```

## journey_type: autonomous
## journey_type_reason: 改动集中在 packages/brain 编排层（Kernel/gates/contract-store）+ CI shell 脚本，无 UI/远端 agent/engine 路径，属纯后端自治闭环
## target_environment: local_api
## target_environment_reason: 验收=bash should-auto-merge 自测 + curl localhost:5221 + psql 真实 PostgreSQL 回归，全部本地 evaluator 可跑
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
