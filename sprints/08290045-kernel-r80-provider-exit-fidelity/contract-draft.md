# Sprint Contract Draft (Round 1) — 结构化上报保真透传，根除 provider_exit 语义埋没 [r80]

> journey_type: autonomous ｜ target_environment: local_api（纯函数可重放，无 DB/无浏览器）
> gp-anchor: skipped (product-map.json not found)
> contract-gate: cecelia worktree（packages/brain/src/lib/contract-gate.js 存在，代码层 gate 生效）
> map: [MAP_NOT_CONFIGURED]（task.payload 无 map_scope/map_repo，不回退领域硬编码）

## 锚定父路声明

独立小路（无父路）—— journey e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29 的 golden-paths 返回空（PRD 累积 FR「本 line 暂无历史」）。本 sprint 修 kernel/runner 内部回执分类保真，不推进任何已登记业务 GP。

---

## Response Schema（推导来源：PRD 字面 + 现有 harness-result 契约；本 sprint 只做分类透传，不新增码值）

本任务无 HTTP 端点。契约对象是**回执分类**的纯函数 I/O 与 **runner 回执 JSON** 的 error.code 保真。

### 1) runner 回执（`normalize_provider_failure` 写出 / `docker/cecelia-runner/entrypoint.sh`）

结构化 BLOCKED（r69）保真透传后：
```json
{"contract_version":"1.0","status":"blocked","error":{"code":"CONTRACT_SELF_CONTRADICTION"}}
```
- `status`（string）：结构化终态存在时保真为 `"blocked"`（BLOCKED）或 `"completed"`（success）；**禁止**在有结构化终态时降级为 `"failed"`。
- `error.code`（string）：结构化 BLOCKED 时**字面保真**为执行体上报的真因码（CONTRACT_* 家族），**禁用**值 `"provider_exit"`（仅无结构化产出的真崩溃才可用）。

真崩溃 / 超时（负向，语义不变）：
```json
{"status":"failed","error":{"code":"provider_exit"}}   // 无结构化产出的真崩溃
{"status":"failed","error":{"code":"provider_timeout"}} // exit 124 超时
```

### 2) kernel 病族分类纯函数（`packages/brain/src/orchestrator/ground-truth.js`）

- `isInfrastructureErrorCode(code:string) → boolean`：`provider_exit`/`provider_timeout` ⇒ `true`；CONTRACT_* 家族 ⇒ `false`。
- `isContractFaultCode(code:string) → boolean`：CONTRACT_* 家族（含词序/多词漂移，token 子集匹配）⇒ `true`；基础设施码与无关码 ⇒ `false`。

### 3) kernel 派发过滤纯函数（`packages/brain/src/orchestrator/dispatcher.js` `__test__`）

- `filterBlacklistableTargets(targets:Array<{provider,account,machine,error_code,failure_class}>) → Array`：滤掉 `isContractFaultCode(error_code)` 为真的行，保留真基础设施故障行（含 `error_code=null` 的历史行）。

**禁用字段名/值**：回执 error.code 在「有结构化终态」路径下禁止出现 `provider_exit`；分类纯函数禁止把 CONTRACT_* 判进基础设施病族。

---

## Golden Path

[执行体产出结构化终态] → [runner/entrypoint 保真透传] → [kernel 病族分类] → [kernel 派发不拉黑] → [真因原样可见]

### Step 1: 执行体（generator/commander）产出结构化终态
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步「执行体产出结构化终态——success 结果 JSON，或结构化 BLOCKED 携 CONTRACT_* 家族错误码」。

**可观测行为**: 执行体在 CLI 退出码可能非零的同时，stdout 内含结构化终态（`.structured_output`/`.result` 里的 `{status:"blocked",error:{code:"CONTRACT_*"}}` 或 `{status:"completed",...}` / commander-directive/v1）。

**验证命令**:
```bash
cd "${WORKSPACE_PATH:-/workspace}"
npx vitest run tests/gp/f1/step3-provider-exit-fidelity-r80.test.js -t "detect_structured_terminal" --reporter=basic
# 期望：A1-A6 全过 —— 结构化 BLOCKED→真因码、success→__structured_success__、真崩溃→空
```
**硬阈值**: detect_structured_terminal 对 6 类输入分类正确，exit 0。

---

### Step 2: runner/entrypoint 保真透传（不降级为 provider_exit）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步 + 要求 1；病根 r69/r77 实证。

**可观测行为**: `normalize_provider_failure` 检测到结构化 BLOCKED 时，回执 `status="blocked"`、`error.code` 字面保真为真因码，**不**写 `provider_exit`；结构化 success 被识别为 `__structured_success__`（供成功路径认领），不当失败包装。

**验证命令**:
```bash
cd "${WORKSPACE_PATH:-/workspace}"
npx vitest run tests/gp/f1/step3-provider-exit-fidelity-r80.test.js -t "B1" --reporter=basic
# 期望：结构化 BLOCKED + CONTRACT_* + CLI exit 1 → receipt.error.code=CONTRACT_SELF_CONTRADICTION 且 status=blocked
```
**硬阈值**: receipt.error.code == "CONTRACT_SELF_CONTRADICTION" 且 receipt.status == "blocked"，exit 0。

---

### Step 3: kernel 病族分类（CONTRACT_* 不入基础设施病族）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步 + 要求 2；对齐 ground-truth.js `GENERATOR_RUNTIME_ERROR_CODES`。

**可观测行为**: `isInfrastructureErrorCode` 对 provider_exit/provider_timeout 为真、对 CONTRACT_* 家族恒假；`isContractFaultCode` 用 token 子集匹配命中 CONTRACT_* 家族（含 SCOPE 漂移/APPROVED_ 前缀），不误判无关码。

**验证命令**:
```bash
cd "${WORKSPACE_PATH:-/workspace}"
npx vitest run sprints/08290045-kernel-r80-provider-exit-fidelity/tests/provider-exit-fidelity.test.js -t "病族边界" --reporter=basic
# 期望：A1-A5 全过 —— provider_exit/timeout∈病族；CONTRACT_* 家族∉病族
```
**硬阈值**: 病族边界 5 条断言全过，exit 0。

---

### Step 4: kernel 派发（CONTRACT_* 不进 failed_targets、不按 infrastructure 重试）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步 + 要求 2；对齐 dispatcher.js failed_targets 构造 + attempt-store listFailedExecutionTargets。

**可观测行为**: 传给 preflightGate 的 `failed_targets` 列表滤掉 CONTRACT_* 故障 target；真 provider_exit/provider_timeout 崩溃 target 仍拉黑（infrastructure 重试语义不变）。

**验证命令**:
```bash
cd "${WORKSPACE_PATH:-/workspace}"
npx vitest run sprints/08290045-kernel-r80-provider-exit-fidelity/tests/provider-exit-fidelity.test.js -t "failed_targets" --reporter=basic
# 期望：B1-B5 全过 —— CONTRACT_* 被滤、provider_exit/timeout 保留、入参不 mutate
```
**硬阈值**: failed_targets 过滤 5 条断言全过，exit 0。

---

### Step 5: 负向 —— 真 provider 崩溃语义不变（可观测出口）
**来源**: `[FROM_PRD]` — PRD 边界情况「负向（语义不变）」+ 要求 3；范围「不动 provider 真崩溃的黑名单语义」。

**可观测行为**: 无任何结构化产出、纯退出码非零的真崩溃仍 `error.code=provider_exit`/`status=failed`；exit 124 仍 `provider_timeout`。真因（success 结果 / CONTRACT_* 码）在有结构化终态时原样可见、不被埋没。

**验证命令**:
```bash
cd "${WORKSPACE_PATH:-/workspace}"
npx vitest run tests/gp/f1/step3-provider-exit-fidelity-r80.test.js -t "负向语义不变" --reporter=basic
# 期望：raw 崩溃→provider_exit/failed；exit 124→provider_timeout/failed；结构化 failed 不误透传
```
**硬阈值**: 负向 3 条断言全过（provider_exit / provider_timeout 保持），exit 0。

---

## 已知约束（来自回归测试 + 累积 FR）

- [packages/brain/src/orchestrator/__tests__/derive.test.js] → derive(observed) 已正确路由：generator blocked/failed-semantic_refusal + CONTRACT_*（含 CONTRACT_SCOPE_CI_CONFLICT / APPROVED_CONTRACT_CI_CONFLICT 漂移）→ `arbitrate:contract_fault`；无关码 `CONTRACT_MISSING_FIXTURE` → `wait:human_review`（不误判）。**本 sprint 不得回退此路由**：本 sprint 的 `isContractFaultCode` 必须与 derive 的 token 子集匹配语义一致（同命中集合、同不误判集合）。
- [packages/brain/src/orchestrator/attempt-store.js listFailedExecutionTargets] → 现 SQL 选 `status IN ('failed','cancelled') OR (status='blocked' AND failure_class='infrastructure_blocked')`，排除 worker_attempt_* 码。本 sprint 让其返回 error_code 供上层过滤，**不得**改动现有 TTL 窗口与 worker 码排除语义（回归：tests/gp/f1/step3-failed-target-ttl.test.js）。
- [tests/gp/f1/step3-red-purity-import-contract.test.js] → entrypoint.sh 顶层函数以列首 `}` 收尾的约定；新增 `detect_structured_terminal()` 必须遵守（函数体内禁列首裸 `}`）。
- [累积FR] （本 line 暂无历史；context-manifest 未接入本 kernel 主题）。

## 禁 mock 边清单

本单改动涉及**状态机（终态分类：blocked/completed/failed）+ 跨模块数据传递（执行体 stdout → runner 回执 error.code → kernel 病族分类 → dispatcher failed_targets）+ 生命周期钩子（provider 退出归一）**，故 failing test 不 mock 被改的边：

- 执行体 stdout ↔ `entrypoint.sh normalize_provider_failure`/`detect_structured_terminal`（本单改回执分类）：测试真 bash 跑 entrypoint.sh 原文提取的函数，不 stub jq、不 mock 回执写出。
- 回执 error.code ↔ `ground-truth.js` 病族分类（本单改病族边界）：测试真 import `isInfrastructureErrorCode`/`isContractFaultCode`，零 vi.mock。
- 病族分类 ↔ `dispatcher.js` failed_targets 构造（本单改拉黑过滤）：测试真 import `dispatcher.__test__.filterBlacklistableTargets`，零 stub。

仅允许 mock 的更外层无关依赖：无（本单不触第三方 / 通知渠道）。

## 真实调用方请求 shape

N/A —— 本单是 runner→kernel 内部回执分类链路，无「设备/agent 调服务端」外部调用方（provider 进程 stdout 是被 runner 归一的内部产物，非跨信任边界的请求）。

## 未覆盖真实链路清单

- **attempt-store `listFailedExecutionTargets` SQL 层 CONTRACT_* 排除**：本 attempt `runtime_resources.postgres=false`，无真 Postgres，无法端到端跑该 SQL。覆盖方式：纯函数 `filterBlacklistableTargets`（真 import，L2）+ dispatcher 消费点接线（[ARTIFACT] 源码断言）。真验证补位：Brain integration job（brain-integration，真 Postgres）在合入后跑 dispatcher 全链（谁：CI；何时：合入 PR；环境：真库）。
- **结构化 success（r77）完整回执落地**：本 sprint 在 `detect_structured_terminal` 层断言 success 识别（`__structured_success__`）+ 成功路径消费接线（[ARTIFACT]），未在单测内跑完整 `run_provider_contract` 成功回执（需真 provider 进程/CLI，L3，非本 attempt 资源）。真验证补位：runner 镜像重建后在真 fleet 上由 commander success 回执验证（谁：fleet；何时：runner repin 后；环境：真机）。

---

## E2E 验收（final-e2e 跑 — target_environment=local_api，纯函数可重放）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
# r80 纯函数可重放验收：无 DB（runtime_resources.postgres=false）、无浏览器、无远端第三方。
# 真 import/真 bash 被改模块：packages/brain/src/orchestrator/{ground-truth,dispatcher}.js
#   与 docker/cecelia-runner/entrypoint.sh（原文提取函数真 bash 跑）。
# 断言：①结构化终态保真透传（不 provider_exit）②CONTRACT_* 不入基础设施病族/黑名单
#      ③无结构化真崩溃负向语义不变（provider_exit/provider_timeout 保持）。
cd "${WORKSPACE_PATH:-/workspace}"

# 冻结合同主线（kernel 纯函数）+ 补充线（entrypoint 真 bash）。两文件均落 sprints/**、tests/**
# 两个根 vitest include 覆盖，从仓库根直接跑（非 packages/<pkg>/src，无需子 shell 切目录）。
npx vitest run \
  sprints/08290045-kernel-r80-provider-exit-fidelity/tests/provider-exit-fidelity.test.js \
  tests/gp/f1/step3-provider-exit-fidelity-r80.test.js \
  --reporter=verbose

echo "✅ r80 结构化上报保真透传 Golden Path 验证通过（provider_exit 语义埋没根除）"
```

**通过标准**: 脚本 exit 0（两测试文件全绿：kernel 10 条 + entrypoint 9 条）。
**失败标准**: 任一断言失败 → vitest 非 0 exit → 脚本 exit ≠ 0。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `detect_structured_terminal` 喂畸形 JSON（截断 `{"status":"bl`）、空文件、超大 stdout、`.result` 为非 JSON 字符串 → 必须回传空落回 provider_exit，不得崩溃或误判成功。
- 边界码: `isContractFaultCode` 喂 `CONTRACT`（单词）、`SELF_CONTRADICTION`（缺 CONTRACT 语境）、小写 `contract_self_contradiction`、超长码 → 校验子集匹配不过度放宽也不漏词序漂移。
- 重复提交: 同一 target 多次出现在 failed_targets 列表 → `filterBlacklistableTargets` 幂等、不重复、不 mutate 入参。
- 中途中断: normalize_provider_failure 的 stdout_file 不存在/不可读 → 回退 provider_exit（fail-safe），不得抛未捕获。
发现分级: P0/P1（真因埋没复发 / 真崩溃被误当合同故障放行）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| kernel 病族边界 + failed_targets 过滤（冻结主线） | `sprints/08290045-kernel-r80-provider-exit-fidelity/tests/provider-exit-fidelity.test.js` | 病族边界；failed_targets | → 10 failures（isInfrastructureErrorCode/isContractFaultCode 未导出、filterBlacklistableTargets 未定义） |
| runner/entrypoint 结构化终态保真透传（补充线） | `tests/gp/f1/step3-provider-exit-fidelity-r80.test.js` | detect_structured_terminal；B1；负向语义不变 | → 9 failures（detect_structured_terminal 未定义、normalize_provider_failure 现写 provider_exit） |

> 冻结主线 `sprints/<sprint_dir>/tests/provider-exit-fidelity.test.js` 已落盘并将随本轮 commit 冻结（封印闸 HEAD 树校验）；`tests/gp/f1/...` 为补充回归行（真 bash 跑 entrypoint 原文，避让 main 已有 46 个同族文件，无同名）。
