# Sprint PRD — Harness Evaluator 真环境取证闭环：PG runtime 自动申请 + Judge 反馈回灌

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+2%（消除 Harness「无 PG 却自报 PASS」假绿面，取证闭环可信）

## 背景

生产实证（2026-08-13，父任务 77f19b77，run 8783807c）：PR #4860 的批准合同明确要求两条真实 PostgreSQL 集成验收，但 Evaluator attempt 44637134 与 085d4a39 的 TaskBundle 均被 Dispatcher 注入 `runtime_resources={postgres:false,node_deps:true}`，两轮都无法执行 PG 场景却自报 PASS-with-concerns；独立 Judge 8cefb335、d8a334fa 均以 evidence_insufficient 拒绝。第二轮重新取证 TaskBundle 的 inputs 没有 Judge feedback 字段，导致完全同构重跑、无进展。本 sprint 修复该取证闭环，让批准合同的 PG 必验项在 Fleet 真环境执行，缺证反馈跨轮回灌，并对无进展重跑收敛。

## Golden Path（核心场景）

系统从 [Dispatcher 派发 Evaluator] → 经过 [PG 能力机械派生 + Fleet 隔离 PG 供给 + 容器内真跑 PG] → 到达 [真取证 PASS 或 fail-closed/收敛人审]

具体：
1. Dispatcher 组装 Evaluator TaskBundle 时，从批准合同/可执行验收要求机械派生 PostgreSQL capability requirement（不依赖人工在 payload 手填）；本任务 `contract_requirements={postgres:true}`。
2. preflight/Fleet 据此为 Evaluator 供给隔离 PG；PG 不可满足时 **fail-closed**：Dispatcher 不创建会自报 PASS 的 Evaluator，返回 BLOCKED（control_status=BLOCKED），可观测到阻塞原因。
3. Evaluator 在自身容器内真跑合同要求的 PG 命令，留下 stdout/stderr/exit code 到 `.brain-result.json`（不接受仅引用 GitHub CI 作为证据）。
4. 合同必验项 unresolved/unverifiable（如 PG 未供给、命令未真跑）时，Evaluator **不得产 PASS**。
5. Judge 判 `evidence_insufficient` 后走 `judge_evidence_insufficient_recollect`：下一轮 Evaluator TaskBundle 的 inputs 必须携带 Judge 的缺证清单 + 原始反馈，供 Evaluator 定向补证（打破同构重跑）。
6. 两轮无进展（同 SHA 已重新取证一次仍 evidence_insufficient）→ 收敛到 `wait:human_review`，禁止无限同配置重跑。

## 边界情况

- payload/合同均无 PG 要求：不派生 PG requirement，走原有 node_deps 默认路径，行为不回退。
- Fleet 有 PG 但供给失败（连接/隔离建库失败）：fail-closed BLOCKED，不降级为「跳过 PG 仍 PASS」。
- Judge feedback 为空或结构缺失：recollect 仍执行，但 TaskBundle 标注 feedback 缺失，不静默丢弃。
- 并发 sprint：Evaluator 的 PG/临时脚本必须会话独享（含 session id / 隔离库名），禁止共享固定 /tmp 与固定库名互踩。

## 范围限定

**在范围内**：
- Dispatcher bundle 组装：合同 → PG capability requirement 机械派生 + `runtime_resources.postgres` 正确注入。
- preflight/Fleet resource：PG 供给与 fail-closed 闸门。
- derive.js 路由：evidence_insufficient → recollect 时把 Judge 缺证清单 + 原始反馈注入下一轮 TaskBundle；两轮无进展收敛人审。
- Evaluator 出口：合同必验项 unverifiable 时禁止 PASS。
- 永久回归测试覆盖上述四条数据流 + 两轮无进展收敛，含真实在 evaluator 容器跑 PG 的集成测试。

**不在范围内**：
- 修改 Judge 的缺证判定算法本身（证据消费窗口/字符截断规则）。
- 新增非 PG 的其它 runtime capability（如 redis、外部 API）。
- Dashboard / 前端可视化。
- 变更批准合同的产出格式（合同结构不动，只读取其可执行验收要求）。

## 假设

- [ASSUMPTION: 批准合同中「可执行验收要求」已可机械识别出 PG 依赖（如 psql / pg_* 命令或 `contract_requirements.postgres`），派生逻辑以此为唯一真相，不做领域猜测]。
- [ASSUMPTION: Fleet/local_api 执行位存在可用的隔离 PostgreSQL 供给能力（本机 psql localhost:5221 同栈），Evaluator 容器可直连]。
- [ASSUMPTION: Judge verdict 已把缺证清单以结构化字段落库，recollect 可从 decisionLog / judge verdict 读取原始反馈]。

## 预期受影响文件

- `packages/brain/src/orchestrator/dispatcher.js`: 合同 → PG capability requirement 机械派生、preflight 供给 PG、fail-closed BLOCKED、`runtime_resources.postgres` 注入。
- `packages/brain/src/orchestrator/derive.js`: evidence_insufficient recollect 时注入 Judge 缺证清单+原始反馈到下一轮 TaskBundle inputs；两轮无进展收敛护栏。
- `packages/brain/src/orchestrator/preflight/capability-gate.js` / `preflight/requirements.js`: PG capability 判定与不可满足时 fail-closed。
- `packages/brain/src/orchestrator/preflight/production-probes.js` / `fleet-node/node-admission.js`: 隔离 PG 供给探针/供给。
- `packages/brain/src/harness-judge.js`: evidence_insufficient 缺证清单结构化落库（供 recollect 消费）。
- `packages/brain/src/orchestrator/execution-contract.js`: Evaluator 出口——合同必验项 unverifiable 时禁止 PASS。
- 测试：`orchestrator/__tests__/dispatcher.test.js`、`orchestrator/__tests__/derive.test.js`、`__tests__/harness-judge.test.js`、`orchestrator/preflight/capability-gate.test.js`，以及新增 `__tests__/integration/*.pg.integration.test.js`（evaluator 容器真跑 PG）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step+feature 均空）+ area 系统铁律；PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定；沿用 evaluator 既有 timeout 5400s）
- 频控: 无进展重跑硬上限 = 同 SHA recollect 1 次，超出收敛人审（禁止无限重跑）
- 版本要求: 无
- 可观测: PG 供给失败/合同必验项 unverifiable 必须写 Brain log 与 `.brain-result.json`（顶层 exit_code + log_tail + behavior_tests[]，每条含 exit_code + log_tail）；真取证证据必须含 PG 命令 stdout/stderr/exit code，不接受仅引用 GitHub CI

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/journey_feature 两源为空）-->
- [真环境验证] 真环境验证才算 done——PG 必验项必须在 evaluator 容器真跑并留 exit code，禁止 source-only 假绿（来源: area）
- [禁写死环境] 禁止写死环境假设值——PG 库名/连接目标写入侧与校验侧必须同一变量解析，禁止两处各自默认值（来源: area）
- [多租户] 测试默认多租户；evaluator 临时脚本/隔离库必须会话独享（含 session id），禁止共享固定 /tmp 与固定库名互踩（来源: area）
- [租户隔离] 租户隔离——PG 隔离供给不得跨租户/跨 attempt 泄漏数据（来源: area）
- [先分证据缺陷] judge FAIL 先区分「证据压缩窗口截断」与「实现缺陷」：evidence_insufficient 时优先走 evaluator 补证，禁止误派 generator 改本已正确的实现（来源: area）
- [judge证据结构] Brain judge `.brain-result.json` 必须有顶层 exit_code + log_tail + behavior_tests[]，每条需含 exit_code + log_tail（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位；最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl localhost:5221 + psql）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl + psql + vitest 集成测试）
# 期望验收点（自然语言）：
# 1. 构造一个 contract_requirements/合同含 PG 必验项的 Evaluator 派发 → 断言 TaskBundle inputs.runtime_resources.postgres==true（机械派生，非人工手填）。
# 2. 模拟 Fleet 无法供给 PG → 断言 Dispatcher 返回 control_status=BLOCKED（fail-closed），未创建 attempt、未产 PASS。
# 3. evaluator 容器内真跑 PG 命令（psql 建/查隔离库）→ .brain-result.json 含该命令 stdout/stderr/exit code；合同必验项 unverifiable 时断言 verdict != PASS。
# 4. Judge 判 evidence_insufficient → 断言下一轮 Evaluator TaskBundle inputs 携带 Judge 缺证清单 + 原始反馈（非空、与上一轮不同构）。
# 5. 同 SHA 已 recollect 一次仍 evidence_insufficient → 断言路由收敛为 wait:human_review，不再重派 evaluator。
```

## journey_type: autonomous
## journey_type_reason: 改动集中在 packages/brain/ 的 Harness orchestrator（dispatcher/derive/judge/preflight），无 UI、无远端 agent 协议，属 Brain 内部自治调度闭环。
## target_environment: local_api
## target_environment_reason: 纯后端 Brain 调度逻辑，真取证依赖本机 psql + curl localhost:5221，由本地 evaluator 执行。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
