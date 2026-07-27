# Sprint PRD — Kernel Preview CI target-aware authority recovery

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：84%

## 背景

2026-07-27 的恢复链路中，前序 task `226fda26-8134-4504-9361-96dcbd53539c` / run `fd97e875-1024-44a1-b624-607bd37f31a2` 因 hop5 未收到 formal reviewer feedback 被 controlled pivot。当前 sprint 只保留 proposer commit `7420493b05a50aff098934256dc4915b893533f3` 与 reviewer attempt `32203830-90f0-4170-86de-9fff910735a6` 作为证据，不继承任何批准状态。本次要把 Preview CI、本地 required context、外部基础设施与人工批准统一为 server-owned、current-SHA、可机检的 Kernel 门禁，避免 caller 自喂 authority、假绿 CI 和过期批准继续放行。

## Golden Path（核心场景）

Kernel Harness 从读取当前 run/task/PR/CI 的服务器事实 → 对 Preview CI、required contexts、ground truth 与 human approval 做 current-SHA 门禁判定 → 到达“只有三类真实 authority 同时成立才允许离开 Draft，否则给出唯一稳定 blocker reason 和证据”的出口。

具体：
1. 系统读取 server-owned 的 task、run、PR head SHA、base_repo、target_environment、required contexts 与实际 CI/DB 记录，不接受 caller 提供的 expected_repo、expected_run、scenario、record 或 expected triple 作为 authority。
2. 系统对每个负例单独执行一条可运行测试，分别验证 stale check SHA、wrong repo、wrong run/task、missing required context、preview-required failure、local required-context failure、missing context mapping、external infrastructure failure 及其必要组合；每条只允许一个稳定 blocker reason，且要证明 counterfactual/mutation。
3. 系统真实调用 workflow 路由，逐字段匹配真实 route schema，记录 HTTP status 与 body，并把服务端响应持久化为证据；禁止用 `curl -sf` 吞掉状态码或响应体。
4. 系统从真实 CI/GitHub/数据库/`orchestrator_decision_log` 派生 preview evidence、ground truth、postmerge staging、production promotion 与 final report；任何 synthetic scenario/helper/self-fed expected 值都不得充当 authority。
5. 当 evaluator PASS、judge PASS、human approval 三类 authority 都锚定在当前 PR head SHA 上且 PR 仍是当前 Draft 语义时，系统才允许进入可合并态；任一新 commit 必须让三类 authority 全部失效并要求重验。

## 边界情况

- Preview CI required context 缺失时，必须返回缺失映射或缺失上下文的明确 blocker，不能被其他失败掩盖。
- 外部基础设施失败与业务规则失败必须分流；Red 失败只能因为业务行为缺失，不能因为 vitest/config/依赖未装而误红。
- legacy 语义保留必须通过真实 legacy adapter 调用验明，不接受字符串包含或 helper 存在性断言。
- local_api 环境只允许读取本地 Brain/DB/route 真实记录；若当前 PR head SHA 已变化，旧 approval、旧 evaluator、旧 judge 必须全部作废。

## 范围限定

**在范围内**：Kernel target-aware CI authority 判定、Preview/required-context/blocker 语义、真实 workflow 集成、ground-truth/decision-log 证据链、Draft 保持逻辑、legacy adapter 真调用、独立负例测试矩阵。
**不在范围内**：merge 执行、人工批准代签、caller 自建 scenario 工具、synthetic authority helper、无关 UI/前端改版、生产数据库写入放宽。

## 假设

- [ASSUMPTION: `base_repo` 来源为 task payload 中的 `https://github.com/perfectuser21/cecelia.git`，按 Cecelia monorepo 规则锚定到 `packages/brain/` 后端实现。]
- [ASSUMPTION: `target_environment` 已由 server-owned task payload 明确给出 `local_api`，本 sprint 不需要 planner 额外猜测环境。]
- [ASSUMPTION: 当前 journey step 已由 payload.anchor.step_id 锚定，无需再从 PrepPRD 回填。]

## 预期受影响文件

- `packages/brain/src/orchestrator/derive.js`: current-SHA / authority / blocker 归因规则。
- `packages/brain/src/orchestrator/ground-truth.js`: route→DB→ground-truth→decision 的真实派生链。
- `packages/brain/src/routes/harness-callback.js`: workflow 实际回调请求与证据持久化。
- `packages/brain/src/routes/harness-kernel-approvals.js`: human approval current-SHA authority 与 Draft 守卫。
- `packages/brain/src/harness-relay-watchdog.js`: review/approval evidence 读取与失效处理。
- `packages/brain/src/orchestrator/__tests__/` 与 `packages/brain/src/routes/__tests__/`: 每个 blocker 单测、workflow integration、legacy adapter、approval invalidation、real-record 集成回归。
- `packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js`: run/task/decision-log/approval 的真实链路回归。
- `packages/brain/DEFINITION.md`、`VERSION`、`.brain-versions`: Brain 行为变更的版本同步。

## NFR 约束

<!-- 来源: task 描述硬门禁 + decisions 表 category=nfr（本任务未返回额外 nfr） -->
- 超时/延迟: workflow 集成必须保留 HTTP status 与 body，失败要 fail-closed，不允许用 `curl -sf` 隐去状态。
- 频控: 每个负例单独建可执行测试，禁止 OR 合并断言，防止一个失败掩盖另一个失败。
- 版本要求: current authority 必须绑定实际 PR 当前 head SHA；新 commit 立即使 evaluator/judge/human approval 全部失效。
- 可观测: preview evidence、ground truth、postmerge staging、production promotion、final report 都要落真实服务端/数据库证据，且可回放到 `orchestrator_decision_log`。
- 测试约束: Red 在依赖安装完成后必须因为缺业务行为而失败，禁止 helper-existence、source-string、自喂 expected 值和 synthetic scenario 充当验收。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [禁写死环境假设] target_environment、repo、run、SHA、required context 只能从服务器事实推导，禁止写死或 caller 自喂（来源: area）
- [真环境验证] 依赖真实 CI、GitHub、DB、legacy adapter 的接缝断言必须真跑才算 done（来源: area）
- [判变基准] authority 与 verdict 的有效性必须对账当前 PR head SHA，不能沿用旧 sha 结果（来源: area）
- [失败显式化] 失败路径禁止 warning 降级；缺 context、外部 infra 失败、authority 失效都必须给出显式 blocker（来源: area）
- [语义字段判定] 通知/写库/回调成功判定要看真实语义字段和响应体，不能只看 ok:true 或 helper 返回值（来源: area）
- [DB 真相优先] route、ground truth、decision 的链路判断必须读取真实存储记录与 `orchestrator_decision_log`，不靠 synthetic scenario（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点：真实 workflow 请求逐字段匹配 route schema，记录 HTTP status + body，并把服务端响应持久化。
# 期望验收点：stale SHA、wrong repo、wrong run/task、missing required context、preview-required failure、local required-context failure、missing context mapping、external infrastructure failure 各有独立测试与唯一 blocker。
# 期望验收点：preview evidence、ground truth、postmerge staging、production promotion、final report 都读取独立真实记录，route→DB→ground-truth→decision 链可回放。
# 期望验收点：PR 在 evaluator PASS、judge PASS、human approval 三类 current-SHA authority 齐备前保持 Draft；新 commit 使三类 authority 全部失效。
# 期望验收点：legacy 语义通过真实 adapter 调用保留；Red 在依赖装好后因业务行为缺失而失败，而非因测试基础设施缺失误红。
```

## journey_type: autonomous
## journey_type_reason: 本 sprint 聚焦 Kernel/Brain 后端 authority、route、decision-log 与 CI 门禁，不涉及前端交互流。
## target_environment: local_api
## target_environment_reason: task payload 已给出 server-owned `target_environment=local_api`，验收依赖 localhost Brain 路由、PostgreSQL 记录与本地内核测试环境。
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: 0cdadc1a-e3a0-46a1-8333-ebbc102883f7
