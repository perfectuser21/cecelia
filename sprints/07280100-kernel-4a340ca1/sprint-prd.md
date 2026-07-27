# Sprint PRD — Kernel Test Environment Controller Recovery 4 权威实 PG 合同

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：84%

## 背景

Recovery 4 是 Kernel Test Environment Controller 的权威 P0 合同路径；R1-R3 仅作失败证据，不得复写进本轮合同。当前缺口集中在 authority、attempt-scoped PostgreSQL provisioning、signed receipt、exactly-once cleanup、真实 import/runtime consumer 接线与 host evaluator gate 的阶段顺序，导致合同阶段容易把非权威来源、伪 schema 或 host Green 前置成错误真相。

## Golden Path（核心场景）

系统从持久化后的 Kernel Harness attempt 进入 `Server-owned attempt-scoped real PostgreSQL capability with frozen-contract authority, signed non-replayable receipt, real runtime injection, V5 purity, counterfactual oracles, and eight-path cleanup; host Green only after Generator on exact Draft PR head.` → 经过权威合同、真实 PG 能力开通、签名回执校验、八路径收口与 Draft PR 后 host evaluator gate → 到达“仅凭 production `initiative_contracts`/`initiative_runs` 真相放权，且所有 capability/receipt/cleanup 都可被真实 PostgreSQL 与真实 runtime 证明”的出口。

具体：
1. server/controller 只从 production `initiative_contracts` 与 `initiative_runs` 冻结合同链路派生 `database_backed`、environment policy、contract_id、contract_sha、run_id、attempt_id 与 PR head；task payload、bundle、caller env、workspace 文件、provider 输出都不能授予或放大 DB authority。
2. attempt 持久化后，controller 在 operator fixture 上创建 attempt-scoped PostgreSQL database 与 least-privilege role，network allow-list/CIDR 必须来自运行时发现；`DB_NAME`/`DB_URL` 只经 trusted local launcher 或 CredentialEnvelope remote path 注入，secret 不得进入 payload、bundle、git、日志、callback 或结构化模型输入。
3. receipt 采用非自引用 `signed_payload` + outer envelope，至少绑定 `signature`、`key_id`、`algorithm`、`payload_digest`、`nonce`、`issued_at`、`expires_at`、task/run/attempt/contract/SHA/DB；server 持久化 issuance/consumption 状态，并按显式 canonical bytes 与验证顺序拒绝 replay、forge、错误 key/digest、跨 attempt 复用、时间戳异常、陈旧或被 override 的 DB 注入。
4. cleanup 对 completed、completed_with_concerns、failed callback、cancelled、timeout、lease expiry、process/worker death、callback auth/validation rejection 至少八条终态路径执行 revoke/disconnect/drop 并持久化生命周期；任一路径重复触发都保持 exactly-once，可 repair/retry，但不能留下 login、DB、ACL、envelope、secret file 或可重放 capability。
5. Generator 只在合同 GAN 通过后创建 Draft PR；CI 在不 merge 的前提下通过；随后 Evaluator 才在 host/operator Docker 环境对“精确 Draft PR head SHA”跑真实 fixture `postgresql://postgres@host.docker.internal:55439/harness_controller_bootstrap`，Judge 消费同一 receipt；即使 evaluator/judge 通过，首次 P0 安全行为仍必须 `review_required=true` 且经 owner 明确审核后才可 merge。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- origin/main 当前不存在 `kernel-harness-f1-baseline` 模块；若真实 import/runtime consumer 不存在，Generator 必须创建并接线，禁止凭 R3 或 PR 4372 声称已有三处 import site。
- host/operator Docker Green 只能发生在 Generator 之后、且必须锚定 Draft PR head SHA；合同阶段 machineable Red 正常结束，不得报告 host gate pending。
- counterfactual oracle 必须逐个独立篡改 authority 字段或 cryptographic binding，并证明失败原因为预期拒绝，而不是 test crash、early return、undefined `attemptId` 或虚构 schema。
- Red/DoD 不得 mock dispatcher authority resolution、attemptStore persistence、launcher/remote bridge/fleet worker/attempt runner transport、controller provisioning、receipt verification、judge/evaluator consumption 或 cleanup 主链路；外部 GitHub/模型调用仅允许在最外边界替身。
- production schema 与 V5 boot purity 不可破坏；migration/import 必须 additive，且不新增假 `initiative_runs` 列/表冒充权威路径。

## 范围限定

**在范围内**：frozen-contract authority 解析；attempt-scoped PostgreSQL provisioning；CredentialEnvelope/launcher 注入链；signed receipt 结构与 server-side issuance/consumption 状态；八终态 cleanup 生命周期；真实 import/runtime consumer 接线；exact Draft PR head host evaluator gate；real PG Red/Green 与 counterfactual oracle 测试。

**不在范围内**：复制 R1-R3 合同文字；host Green 前置到 planner/proposer 阶段；伪造 `initiative_runs` schema；生产环境直接变更真实业务数据；普通 PR 自动 merge；以静态 readFile/regex/202 loopback 代替验收。

## 假设

- [ASSUMPTION: `task.payload.thin_prd` 为本轮唯一 scope 法律，主题必须保持 “attempt-scoped real PostgreSQL capability / frozen-contract authority / signed non-replayable receipt / eight-path cleanup / host Green only after Generator” 这些字面，不退化为泛泛“controller 修复”。]
- [ASSUMPTION: `ability_id` 缺失，因此 journey_feature/step 级历史决策为空；本轮仅注入 area invariant 与空累积 FR。]
- [ASSUMPTION: 首次 P0 安全行为的人工 owner review 是强制门；即使 `change_kind=fix`，本任务仍按 `review_required=true` 保持 Draft PR。]

## 预期受影响文件

- `packages/brain/src/orchestrator/contract-store.js`、`packages/brain/src/orchestrator/ground-truth.js`: 以 `initiative_contracts`/`initiative_runs` 真实链路解析 frozen-contract authority。
- `packages/brain/src/orchestrator/attempt-store.js`、`packages/brain/src/orchestrator/kernel-handlers.js`: attempt 持久化后绑定 authority、ownership、lifecycle 与 cleanup 真相。
- `packages/brain/src/orchestrator/credential-broker.js`、`packages/brain/scripts/fleet-worker/credential-envelope.cjs`、`packages/brain/scripts/fleet-worker/attempt-runner.cjs`: trusted local launcher / CredentialEnvelope 注入链与 remote path 消费。
- `packages/brain/src/receipt-collector.js`、`packages/brain/src/routes/harness-callback.js`、`packages/brain/src/harness-judge.js`: receipt canonicalization、issuance/consumption 状态、judge/evaluator 同 receipt 验证。
- `packages/brain/src/harness-session-bridge.js`、`packages/brain/src/orchestrator/remote-bridge-transport.js`: launcher/remote bridge/fleet worker transport 真链路。
- `packages/brain/src/cleanup-worker.js`、`packages/brain/src/cleanup-worker-plugin.js`: revoke/disconnect/drop exactly-once cleanup 与 repair/retry。
- `packages/brain/src/__tests__/integration/kernel-fleet-execution-receipts.integration.test.js`、`packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js`、`packages/brain/src/orchestrator/__tests__/kernel-callback-flow.integration.test.js`、`packages/brain/src/routes/__tests__/harness-attempt-verdict-pg.integration.test.js`: real PG、receipt、callback、judge/evaluator、host gate 接缝回归。
- `packages/brain/scripts/smoke/fleet-credential-envelope-smoke.sh`、`packages/brain/scripts/smoke/kernel-fleet-receipts-smoke.sh`、`packages/brain/scripts/smoke/harness-evaluator-gate-smoke.sh`: 真实注入、receipt、阶段门 smoke。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: provisioning、receipt 校验与 cleanup 必须有明确 lease/expiry/timeout 边界；超时后走结构化终态，不允许悬空 capability。
- 频控: retry/repair 只允许围绕幂等 cleanup 与授权恢复，禁止重复创建 DB/role/ACL 或重复消费同一 receipt。
- 版本要求: 保持 V5 migration/import purity 与既有 boot 行为；所有 schema 变更必须兼容真实 production schema。
- 可观测: receipt、cleanup、host gate、DB audit、secret-leak scan、exact SHA 绑定都必须有结构化 server-side 证据，不能只靠日志文本。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [环境假设] 屏幕外坐标/UIA气泡阈值/假设调用方传X/假设.env有Y 等环境假设值禁止写死，要么从环境推导要么真机校准——这类值是接缝，必真验。（来源: area）
- [真境完成] 依赖真机/生产env/真实调用方的接缝断言必须在真目标上验证过才算 done；未真验只能标 logic-done-pending。（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户；跨租户数据绝不混读/混写。（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志。（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志。（来源: area）
- [失败分支] 调用返回 `null` / `false` 表示失败的契约时必须显式处理失败分支，不能只依赖外层 try/catch。（来源: area）
- [多轮扫描] 测试不能只覆盖冷启动；涉及周期性扫描、lease expiry 与回收必须至少有一条真实多轮、状态不重置场景。（来源: area）
- [失败恢复] watchdog_overdue 误标 failed 后的恢复路径必须用 orphan requeue + 外部真相核查 + 从头重跑或结构化收口证明安全。（来源: area）
- [时间关系] 跨模块时间常数若存在大小依赖，必须显式声明并在测试中覆盖 lease、expiry、cleanup 判定关系。（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## E2E 验收

```bash
cd packages/brain
npx vitest run src/__tests__/integration/kernel-wiring.pg.integration.test.js src/__tests__/integration/kernel-fleet-execution-receipts.integration.test.js src/orchestrator/__tests__/kernel-callback-flow.integration.test.js src/routes/__tests__/harness-attempt-verdict-pg.integration.test.js
npx vitest run src/orchestrator/__tests__/attempt-store.test.js src/__tests__/cleanup-worker.test.js src/__tests__/credential-recovery.test.js src/__tests__/harness-kernel-resume-secret.test.js
bash scripts/smoke/fleet-credential-envelope-smoke.sh
bash scripts/smoke/kernel-fleet-receipts-smoke.sh
bash scripts/smoke/harness-evaluator-gate-smoke.sh
```

验收出口：真实 PostgreSQL fixture 上能看到 attempt 持久化后才创建 DB/role/ACL，且 authority 仅来自 frozen contract 真相链；CredentialEnvelope/launcher 注入不会泄露 secret；signed receipt 的 canonical bytes、digest、nonce、issued/expires、task/run/attempt/contract/SHA/DB 绑定被正向验证且逐项篡改必失败；八条终态路径 cleanup 完成后无残留 login、DB、ACL、envelope、secret file 或 replayable capability；host/operator Docker Green 只在 Generator 之后、且锚定精确 Draft PR head SHA；Judge 消费同一 receipt，owner review 前 PR 保持 Draft 不 merge。

## journey_type: autonomous
## journey_type_reason: 任务仅涉及 packages/brain 后端 Kernel controller、receipt、cleanup、PG fixture 与 orchestration 链路，不含前端或远端 UI。
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端与本地/host.docker.internal PostgreSQL fixture 接缝验收由本地 evaluator 执行，目标是真实 PG + localhost Brain runtime。
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: 1a738e05-99a7-421c-a52d-c2bb80bf19be
