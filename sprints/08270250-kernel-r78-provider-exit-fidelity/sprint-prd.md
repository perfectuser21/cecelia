# Sprint PRD — 结构化上报保真透传，根除 provider_exit 语义埋没 [r78]

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness 内核把结构化终态误埋为 provider_exit 的假失败，减少无效重派/黑名单）

## 背景

第三次点火本主题。前两轮死因均已修上产：r76 三死因（Brain 1.273.140/141），r77 双死因（1.273.142，commander runner_failure 重派 + 早期无锚人审落地）。病根三实证：
- ① r69：generator 合同死锁分析被包装成 provider_exit（attempt 56a09164）
- ② r76：generator 死局同类
- ③ r77：commander 的 claude 实际返回成功结果 JSON（`{"type":"result","subtype":"success",...}`）却被 runner 判 provider_exit failed（attempt e022a331）——连成功结果都能被吞

根因：执行体产出了**结构化终态**（success 结果 JSON 或结构化 BLOCKED + CONTRACT_* 家族错误码），但回执链路在 `provider_exit != 0` 时无条件降级包装为 `provider_exit`，导致内核按 infrastructure 重试或进 failed_targets 黑名单，原因病族丢失。

## Golden Path（核心场景）

系统从 [执行体产出结构化终态] → 经过 [runner 回执保真透传 + kernel 按合同故障重开] → 到达 [失败留原因病族，走 GAN 重开，不误判 infrastructure]

具体：
1. **触发条件**：runner/entrypoint 拿到执行体 stdout，其中含结构化终态：要么是 claude 成功结果 JSON（`type=result, subtype=success`，虽 provider 进程 exit≠0），要么是结构化 BLOCKED 且 error.code 属 CONTRACT_* 家族。
2. **系统处理（runner 侧）**：回执归一化时**先识别结构化终态并保真透传**，禁止降级/包装成 `provider_exit`；success 结果原样上报为对应成功/BLOCKED 终态，CONTRACT_* 错误码原样保留在 error.code。
3. **系统处理（kernel 侧）**：收到 CONTRACT_* 家族故障码，走既有**合同故障重开 GAN** 路径；**不**进 failed_targets 黑名单、**不**按 infrastructure 重试。
4. **可观测结果**：r69/r77 场景重放——结构化产出不再被吞为 provider_exit；成功结果被判成功，合同死锁被路由到 GAN 重开并保留原因病族；真实 provider 崩溃仍判 provider_exit。

## 边界情况

- **负向铁律**：真实 provider 进程崩溃（无任何结构化产出，如超时 exit 124 / 纯 stderr 崩溃）**仍**按 provider_exit / infrastructure 处理，语义不变，仍可进黑名单/重试。
- 结构化 BLOCKED 但 error.code 非 CONTRACT_* 家族：不走合同重开，维持既有分类。
- exit code 与结构化终态矛盾时（exit≠0 但 stdout 为 success 结果），以**已验证的结构化终态**为准（须通过既有 terminal receipt 校验）。

## 范围限定

**在范围内**：
- runner/entrypoint 回执归一化：结构化终态识别 + 保真透传（禁降级为 provider_exit）
- kernel：CONTRACT_* 家族故障码路由到合同故障重开 GAN，绕开 failed_targets 黑名单与 infrastructure 重试
- RED 先行复刻 r69/r77 场景

**不在范围内**：
- 不改合同重开后主链路由缺陷（WORKSPACE_RESOLUTION_FAILED，台账另修）
- 不动 provider 真崩溃的黑名单语义（负向保持）

## 假设

- [ASSUMPTION: 结构化终态识别复用已有的 `validate_claude_terminal_receipt` / 结构化 result schema，本 sprint 只补 provider_exit 降级前的透传判定，不新造校验协议]
- [ASSUMPTION: CONTRACT_* 家族已在 kernel 有合同故障重开路径（sprint-result-contract.js / golden-path-contracts.js），本 sprint 只补分类前置，不新造 GAN 节点]
- [ASSUMPTION: 新测试放 tests/gp/f1/，真 import 被改模块，禁 mock 被改的边；文件名避让 main 已有 step3-*runner-failure* 同族文件]

## 预期受影响文件

- `docker/cecelia-runner/entrypoint.sh`: `normalize_provider_failure` 及结构化 result 提取——provider_exit 降级前先识别并透传结构化终态
- `packages/brain/src/orchestrator/ground-truth.js`: provider_exit 与 CONTRACT_* 家族的终态分类
- `packages/brain/src/orchestrator/dispatcher.js`: failed_targets 黑名单 / infrastructure 重试路由，对 CONTRACT_* 放行到合同重开
- `packages/brain/package.json` 等版本四处: version bump（DevGate check-version-sync）
- `tests/gp/f1/<新测试>.test.js`: RED 复刻 r69/r77，真 import 被改模块
- `sprints/08270250-kernel-r78-provider-exit-fidelity/**`: 合同四件套 + DoD.md
- 若行为变更与既有回归测试冲突（如 ground-truth / attempt-callback 测试）须一并 claim 更新

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step+feature 双源均为空），PrepPRD 显式值优先 -->
- 纯函数可重放: 结构化终态识别与分类须为纯函数，测试可无副作用重放（thin_prd 明确要求）
- 超时/延迟: 待定（PrepPRD 未指定）
- 版本要求: 无
- 可观测: 失败必须留原因病族（error.code / failure_class 保真），不得被 provider_exit 抹平

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/journey_feature 源为空）；注入与本 kernel/harness sprint 直接相关的铁律 -->
- [重试身份] generator infrastructure 重试须保持 identity 一致，重试不得漂移身份（来源: area / generator_infrastructure_retry_identity）
- [never_started 兜底] watchdog 对未启动进程走 never_started 分类，不得覆盖已有 error_message/failure_reason（来源: area）
- [语义字段判成功] 成功判定必须看语义字段（sent/accepted/subtype=success），只 grep `ok:true` 会把失败误判送达（来源: area）
- [状态枚举全审] status 枚举硬编码断言遇 GAN 新增状态值须做全仓库审计，防局部分叉（来源: area）
- [失败契约显式 else] 调用「失败返回 null/false」契约的函数写完成功分支必须显式写 else 处理失败（来源: area）
- [Red 精确 add] Red commit 只 git add 精确路径（`*.test.js`），禁 `git add .` / `.harness`（来源: area）
- [测试合同四列] Test Contract 表格固定 4 列，testFile 用 backtick 包裹，checker 从第 3 列解析路径（来源: area）
- [接线用源码检视] 回归测试用 source-code inspection 验证调度接线，比 mock 覆盖更直接（来源: area）
- [真环境验收] 真环境验证才算 done，不得凭「测试通过」空泛断言收尾（来源: area / [系统]）
- [禁写死环境] 禁止写死环境假设值（端口/路径/账号），须从变量/payload 解析（来源: area / [系统]）
- [单 slot 串行] 单 slot 串行任务，并行只许跨 slot（来源: area / [系统]）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；本 journey 现有 ability 均为 planned，无 done/working -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl localhost:5221 + psql + node 纯函数重放）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
# 1) RED 复刻：喂入「exit≠0 但 stdout 为 claude success 结果 JSON」→ 修前回执被判 provider_exit failed / 进黑名单（RED 红）
# 2) RED 复刻：喂入「结构化 BLOCKED + CONTRACT_* 错误码」→ 修前被包装 provider_exit（RED 红）
# 3) 修后正向：同两输入 → success 判成功、CONTRACT_* 路由到合同故障重开 GAN，不进 failed_targets、不按 infrastructure 重试，error.code 病族保真
# 4) 负向保持：喂入「无结构化产出的真实崩溃（exit 124 / 纯 stderr）」→ 仍判 provider_exit / infrastructure，仍可进黑名单（GREEN 保持）
```

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain 内核路由与 docker/cecelia-runner 回执归一化，纯后端/kernel，无 UI 无远端 agent 协议交互
## target_environment: local_api
## target_environment_reason: payload 显式 target_environment=local_api；本地 evaluator 用 curl localhost:5221 + psql + node 纯函数重放
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
