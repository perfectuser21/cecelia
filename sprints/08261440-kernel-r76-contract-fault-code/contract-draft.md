# Sprint Contract Draft (Round 1) — generator 合同故障码保真透传（根除 provider_exit 语义埋没）[r76]

## 锚定父路声明

覆盖父路 F1「工厂 · 开发闭环」第 3 步「造完真验」——本 sprint 修 attempt 回执链路对结构化合同故障码的保真透传（generator 结构化 BLOCKED 上报 → kernel 分流），独立小路挂在既有 F1 GP step3 下。

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。本 sprint 改动落在 `packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs` 的 provider close 回执重构逻辑（纯函数），无新增/变更任何 HTTP 端点。Reviewer 第 6 维按纯内部改动处理。

## 已知约束

来自回归测试与累积 FR：

- [tests/gp/f1/step3-runner-failure-retry.test.js → derive] runner_failure = 基础设施故障，有界重派同角色（≤2 次），超限进人审——本 sprint 不得破坏该分类语义。
- [tests/gp/f1/step3-seal-reject-reopens-gan.test.js → REOPEN_GAN_CONTRACT] 合同封印被拒走重开 GAN——本 sprint 复用该既有重开路径，不新建。
- [derive.js CONTRACT_FAULT_CORE_TOKENS → 子集匹配] `SELF+CONTRADICTION` / `TEST+UNSATISFIABLE` / `CI+CONFLICT` 三条核心 token 组合子集匹配已在 main，本 sprint 不改 derive，只保证 error_code 保真送达。
- [累积FR] 本 line 暂无历史（context-manifest 无累积行）。
- [MAP_NOT_CONFIGURED] task.payload.map_scope/map_repo 未配置，无 Unified Map must_run_assertions 注入。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | provider 非零退出时，若已写盘合法结构化 BLOCKED（带 error.code），回执链路保真透传该结构化 result 及其 error_code，禁止降级为 provider_exit_N。 |
| **NFR（做得多好）** | | 纯函数、同输入可重放（PRD 未指定超时/频控）。 |
| **Invariant（永不违反）** | | ①provider 真崩溃（无合法结构化写盘）仍判 provider_exit / infrastructure，语义不变；②不动 provider 真崩溃黑名单语义；③零退出路径行为不变。 |
| **判定点（怎么知道）** | | 见判定点登记表。 |
| **保质期（何时过期）** | | 分类逻辑随 harness-result 契约版本（contract_version '1.0'）；契约升版时同步退役，责任人 kernel owner。 |
| **死亡告警（停了谁知道）** | | 冻结合同测试 + tests/gp/f1 GP 回归进 required CI「Sprint Tests」；回执降级复现即红。 |
| **失败语义（挂了怎么办）** | | 见失败语义声明。 |
| **效果确认（已发≠已生效）** | | reconcile 函数返回的 result.error.code 即回执体字段，attempt-store.js:110 落库 error_code；E2E 真 require 断言返回值。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 聊天记录 API 不稳定 | 静默丢消息 |
| ⚠️ 非零退出是「真崩溃」还是「结构化 BLOCKED 申诉」 | A. 一刀切 provider_exit（现状）; B. 先读写盘结构化 result，合法 BLOCKED（带 error.code 非空）→ 保真，否则 provider_exit | B | 现状（A）把 generator 完整合同死锁分析埋没成 provider_exit → 进黑名单空转 2h+（r69 实证）；结构化写盘存在即为可信申诉证据 | 误判后果严重（真实语义丢失、run 空转），已用 B 消除；反向误判（把真崩溃当申诉）由「必须 status=blocked 且 error.code 非空字符串」守卫收窄 |

> ⚠️ 行说明：该判定点误判后果严重（失败原因病族丢失 / run 空转），但判定方法已由 Alex 在 r69 案卷方向拍定（合同类失败保真留存），非新增待确认拍板点，故不加 judgment-pending-user。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 写盘 result 非法 JSON / 缺字段（非零退出） | 回落 provider_exit_N | 是（纯函数，同输入同输出） | 按真崩溃族进 infrastructure 有界重试（既有语义） |
| provider 真崩溃无写盘（非零退出） | 回落 provider_exit_N | 是 | 同上，语义不变 |
| 结构化 BLOCKED + CONTRACT_* error.code | 保真透传，derive 走重开 GAN | 是 | 重开 GAN ≤1 次，超限回人审（derive 既有 CAP） |

### 输入对抗面

N/A — 本 sprint 是 kernel 内部回执分类纯函数，不对外暴露 agent 输入面；写盘 result 由本机 provider 进程产出并经 parseHarnessResult 结构校验。

## Golden Path

[generator 结构化 BLOCKED 上报（写盘 harness-result + 非零退出）] → [kernel-attempt-handler close 保真透传 error_code] → [attempt-store 落库 error_code=CONTRACT_*] → [derive CONTRACT_FAULT_CORE_TOKENS 子集匹配 → ARBITRATE_CONTRACT_FAULT → REOPEN_GAN_CONTRACT] → [出口：run 走合同故障重开 GAN，attempt.error_code 保真留存为 CONTRACT_*，不进 failed_targets 黑名单]

### Step 1: generator 结构化 BLOCKED 上报被非零退出改写
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1-2 步：generator 以结构化 BLOCKED + error_code=CONTRACT_SELF_CONTRADICTION 上报，回执链路必须保真透传。

**可观测行为**: `reconcileProviderCloseResult({ code: 1, resultPath, attemptId })` 读到合法结构化 BLOCKED 写盘 result 时，返回该 result（status='blocked'，error.code='CONTRACT_SELF_CONTRADICTION'），不改写为 provider_exit。

**验证命令**:
```bash
cd "${WORKSPACE_PATH:-/workspace}"
npx vitest run sprints/08261440-kernel-r76-contract-fault-code/tests/step3-contract-fault-code-passthrough.test.js -t 'preserves CONTRACT_SELF_CONTRADICTION structured BLOCKED on non-zero provider exit' --no-color
# 期望：1 passed
```

**硬阈值**: 返回 result.status='blocked' 且 result.error.code='CONTRACT_SELF_CONTRADICTION'（保真，无 provider_exit 子串）。

---

### Step 2: kernel 分流——CONTRACT_* 走重开 GAN，不进黑名单
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步：kernel 识别 CONTRACT_* 家族 → 既有 r40 重开 GAN 路径，不进 failed_targets 黑名单。

**可观测行为**: 保真透传后的 error.code 经 tokenize（`SELF_CONTRADICTION` → {SELF,CONTRADICTION}）是 derive.js `CONTRACT_FAULT_CORE_TOKENS` 某条核心组合的超集，命中既有子集匹配 → derive 路由 ARBITRATE_CONTRACT_FAULT / REOPEN_GAN_CONTRACT（非 infrastructure_blocked 黑名单）。本 sprint 不改 derive（既有路径已存在，ASSUMPTION #2），只保证 error_code 保真送达该分类器。

**验证命令**:
```bash
cd "${WORKSPACE_PATH:-/workspace}"
# 保真透传后的 error_code 满足 derive CONTRACT_FAULT_CORE_TOKENS 子集匹配（测试内已断言 token 超集）
npx vitest run sprints/08261440-kernel-r76-contract-fault-code/tests/step3-contract-fault-code-passthrough.test.js -t 'preserves CONTRACT_CI_SCOPE_CONFLICT structured BLOCKED error_code faithfully' --no-color
# 期望：1 passed（CI+CONFLICT token 组合命中，derive 既有路径路由重开 GAN）
```

**硬阈值**: error.code='CONTRACT_CI_SCOPE_CONFLICT'，tokenize 后 {CI,CONFLICT} ⊆ tokens。

---

### Step 3: 出口——真崩溃负向语义不变（provider_exit / infrastructure）
**来源**: `[FROM_PRD]` — PRD 边界情况「负向（语义不变）」+ thin_prd 要求 #3：provider 真进程崩溃、无结构化 error_code → 仍判 provider_exit / infrastructure → 进黑名单重试。

**可观测行为**: 非零退出且无合法结构化写盘（无文件 / 非法 JSON / 非 blocked）→ `reconcileProviderCloseResult` 回落 `provider_exit_<code>`（status='failed'），既有黑名单语义不变。

**验证命令**:
```bash
cd "${WORKSPACE_PATH:-/workspace}"
npx vitest run sprints/08261440-kernel-r76-contract-fault-code/tests/step3-contract-fault-code-passthrough.test.js -t 'falls back to provider_exit on genuine crash without structured result' --no-color
# 期望：1 passed（code=137 无写盘 → provider_exit_137）
```

**硬阈值**: 无写盘时 result.error.code='provider_exit_137'（无 CONTRACT 子串）；零退出路径行为不变。

---

## 禁 mock 边清单

- `kernel-attempt-handler.cjs 的 provider close 逻辑 ↔ 已写盘 harness-result 文件（fs 读 + parseHarnessResult 结构校验）`：本单改的就是「非零退出如何 reconcile 写盘结果」这条边，测试必须真 fs 写盘临时 result 文件、真 require 被改模块、真调 parseHarnessResult，禁止 stub/mock 文件读取或 parseHarnessResult。
- 说明：本单不触及 derive/DB/调度状态机（derive 既有 CONTRACT_* 路径不改），故不涉及 Postgres 边；runtime_resources.postgres=false 与此一致。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）——RED/GREEN 测试全部真 require 被改模块 + 真 fs，无 force_*/stub/假数据。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: 写盘 result 为 `status='blocked'` 但 `error=null` 或 `error.code=''`（空 code）+ 非零退出 → 应回落 provider_exit（不是保真透传空码）
- 错输入: 写盘 result `error.code` 含 CONTRACT token 但 `status='completed'` + 非零退出 → 不应误入 blocked 透传分支
- 重复提交: 同一 resultPath 连续两次 reconcile（幂等，同输入同输出）
- 中途中断: resultPath 文件存在但被截断成半个 JSON（进程写盘中崩）→ 应回落 provider_exit（视为真崩溃）
- 边界值: code=0 但 result 缺字段（非法）→ 走既有 provider_result_invalid（零退出路径不变）
发现分级: P0/P1（合同故障码被埋没 / 真崩溃被误当申诉阻断黑名单）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"

SPRINT_TEST="sprints/08261440-kernel-r76-contract-fault-code/tests/step3-contract-fault-code-passthrough.test.js"
GP_TEST="tests/gp/f1/step3-contract-fault-code-passthrough.test.js"

# 1. 冻结合同测试 + GP 回归测试全绿（修前 RED：reconcileProviderCloseResult 未导出；修后转绿）
npx vitest run "$SPRINT_TEST" "$GP_TEST" --no-color || { echo "FAIL: 合同故障码保真透传测试未全绿"; exit 1; }

# 2. 保真透传 + 真崩溃负向 双向断言（真 require 被改模块 + 真 fs 写盘，禁 mock 被改的边）
node -e '
const fs = require("fs"), os = require("os"), path = require("path");
const h = require("./packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs");
if (typeof h.reconcileProviderCloseResult !== "function") { console.error("FAIL: reconcileProviderCloseResult 未导出"); process.exit(1); }
const id = "56a09164-1b2c-4d3e-8f90-0123456789ab";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r76-e2e-"));
const rp = path.join(dir, id + ".result.json");
const base = {contract_version:"1.0",attempt_id:id,status:"blocked",summary:"s",artifacts:[],checks:[],decision:null,error:{code:"CONTRACT_SELF_CONTRADICTION",message:"m"},provider_metadata:{}};
fs.writeFileSync(rp, JSON.stringify(base));
const pass = h.reconcileProviderCloseResult({code:1,resultPath:rp,attemptId:id});
if (pass.status!=="blocked" || pass.error.code!=="CONTRACT_SELF_CONTRADICTION") { console.error("FAIL: contract fault code downgraded", JSON.stringify(pass)); process.exit(1); }
const crash = h.reconcileProviderCloseResult({code:137,resultPath:path.join(dir,"nope.json"),attemptId:id});
if (crash.error.code!=="provider_exit_137") { console.error("FAIL: real crash negative semantics changed", JSON.stringify(crash)); process.exit(1); }
fs.rmSync(dir,{recursive:true,force:true});
console.log("OK: passthrough + real-crash-negative both honor contract");
' || { echo "FAIL: 保真透传行为断言未通过"; exit 1; }

echo "Golden Path OK: 合同故障码保真透传，provider_exit 语义不被埋没"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 合同故障码保真透传（冻结锚，seal 必需） | `sprints/08261440-kernel-r76-contract-fault-code/tests/step3-contract-fault-code-passthrough.test.js` | preserves CONTRACT_SELF_CONTRADICTION structured BLOCKED on non-zero provider exit / preserves CONTRACT_CI_SCOPE_CONFLICT structured BLOCKED error_code faithfully / falls back to provider_exit on genuine crash without structured result / falls back to provider_exit when result file is invalid on non-zero exit / does not misroute non-blocked structured result on non-zero exit to passthrough / parses structured result unchanged on zero exit | → 14 failures（`reconcileProviderCloseResult is not a function`，两文件各 7） |
| 同上（tests/gp/f1 永久回归，PRD #5，补充行） | `tests/gp/f1/step3-contract-fault-code-passthrough.test.js` | 同上（内容一致） | → 同上（并入上行 14 failures） |
