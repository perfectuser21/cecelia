# Sprint Contract Draft (Round 2) — generator 合同故障码保真透传 [r77]

## 锚定父路声明

覆盖父路 F1「工厂·开发闭环」第 3 步「造完真验」——本 sprint 补该步 kernel 侧「失败语义保真」子路：generator 结构化合同故障不被进程退出兜底埋没为 `provider_exit`。

## Response Schema（推导来源: N/A）

N/A — 任务无 HTTP 响应。本 sprint 改动是 runner 回执构造 + kernel 分类的**纯函数**逻辑（进程退出码 → 结构化结果保真透传），无新增/变更任何 HTTP 端点。Reviewer 第 6 维 verification_oracle_completeness 按纯函数 oracle 审查（vitest 真跑 tests/gp/f1/ + node 真 import 断言）。

## 已知约束

### 来自回归测试（Step 1.2）
- `packages/brain/src/__tests__/codex-bridge-kernel-attempt.test.js` → 现有 runner 回执行为：`close(0)+合法结构化 result` → 透传；`close(0)+非法 status` → `provider_result_invalid`；`close(23)+无结构化 result` → `status:failed`（`provider_exit_23` 兜底）。**本 sprint 改动只影响「非零退出 + 存在合法结构化 CONTRACT_* result」这一未被现有测试覆盖的分支，三条现有断言保持绿**（已逐条核验，见「禁 mock 边清单」下方兼容性说明）。
- `packages/brain/src/orchestrator/__tests__/derive.test.js` → 合同故障重开 GAN 路由已全分支覆盖：`error_code=CONTRACT_SELF_CONTRADICTION` + `status=blocked` → `arbitrate:contract_fault` → `contract_fault_appeal`；`CONTRACT_MISSING_FIXTURE` 等非核心 token → 不误路由。**kernel derive 侧已正确**，本 sprint 不改 derive，仅让保真透传后的结构化 code 能流到该已验证路径。

### 累积 FR（Step 1.3，context-manifest）
- 本 line（journey e6f803f2）现有 ability 均 status=planned，无 done/working 历史 → 无累积 FR 约束。（context-manifest: 本地无 Brain，按 PRD「本 line 暂无已验收历史」记录。）

### 铁律映射（Step 1.3 源①，INV 覆盖见 contract-dod.md）
- [vitest范围外绿态] → INV-1（验收命令实跑确认 exit code + 断言实际 collected 测试数，防 include 范围外绿态假过）
- [Red精确add] → INV-2（Red commit 只 add `*.test.ts` / `*.test.js` 精确路径）
- [source-inspection]/[generator重试身份] → 调度接线类回归用真 import 被改模块（本合同 tests 遵守；见禁 mock 边清单）
- 其余系统铁律（单 slot 串行/真环境 done/多租户/禁写死环境值/凭据安全）→ N/A：本 sprint 是纯函数分类逻辑，无并发/无租户/无凭据/无环境假设值。

## Validation identity late-binding（R2 修订）

本 sprint 是 kernel 内部纯函数改动，验收身份必须 late-bound：合同、DoD、冻结测试里出现的 `attempt_id`/`attemptId` 一律**从 Runner 注入的 `HARNESS_ATTEMPT_ID` 读取**（`process.env.HARNESS_ATTEMPT_ID ?? <合成回退>` / `process.env.HARNESS_ATTEMPT_ID || <合成回退>`），合成回退 UUID 仅用于本地无 Runner 时满足 `parseHarnessResult` 的 `UUID_PATTERN` 校验，绝不硬编码任一执行角色（Generator/Evaluator/Judge）的 attempt/capability 字面值。该约束由确定性闸 `packages/brain/src/orchestrator/validation-identity-policy.js#premature_validation_identity_binding` 校验，R2 全部产物已复跑该闸为 `ok:true`。

## Golden Path

[generator 结构化合同故障上报（非零退出）] → [runner 回执保真透传 error_code] → [kernel 分类不落 infrastructure] → [derive 走合同故障仲裁→重开 GAN，病族可见]

---

### Step 1: generator 完成合同死锁分析，以结构化 BLOCKED + CONTRACT_* error_code 写下回执，进程非零退出
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步 + 背景（r69 实证 attempt 56a09164）

**可观测行为**: provider 子进程在 `--output-last-message` 指向的 resultPath 写下一份合法 harness result（`status:'blocked'`, `error.code:'CONTRACT_SELF_CONTRADICTION'`），随后以非零退出码结束。

**验证命令**:
```bash
# 真 import runner 的纯函数,喂结构化 CONTRACT_* result + 非零退出码
node -e '
const { createRequire } = require("node:module");
const req = createRequire(process.cwd() + "/x.js");
const { resolveProviderCloseResult } = req("./packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs");
const fs=require("fs"),os=require("os"),path=require("path");
const p=path.join(fs.mkdtempSync(path.join(os.tmpdir(),"h-")),"r.json");
const AID=process.env.HARNESS_ATTEMPT_ID||"00000000-0000-4000-8000-000000000abc";
fs.writeFileSync(p,JSON.stringify({contract_version:"1.0",attempt_id:AID,status:"blocked",summary:"deadlock",artifacts:[],checks:[],decision:null,error:{code:"CONTRACT_SELF_CONTRADICTION",message:"m"},provider_metadata:{provider:"codex"}}));
const r=resolveProviderCloseResult({resultPath:p,attemptId:AID,exitCode:1});
if(r.error.code!=="CONTRACT_SELF_CONTRADICTION"||r.status!=="blocked"){console.error("FAIL",JSON.stringify(r));process.exit(1)}
console.log("OK");'
# 期望：OK（error.code 保真为 CONTRACT_SELF_CONTRADICTION，未被降级为 provider_exit_1）
```

**硬阈值**: `resolveProviderCloseResult` 返回结果 `error.code === 'CONTRACT_SELF_CONTRADICTION'` 且 `status === 'blocked'`（非零退出下不降级）。

---

### Step 2: runner/entrypoint 回执链路保真透传该 error_code（禁止进程退出兜底覆盖为 provider_exit）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步 + 要求 1；ASSUMPTION：注入点在 runner 进程退出兜底（本合同核实 = `packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs` `child.once('close')` 分支，全仓唯一 `provider_exit_${code}` 注入点）

**可观测行为**: 进程 `close(code!==0)` 时，若 resultPath 存在合法结构化 result 且 `error.code` 匹配 `CONTRACT_*` 家族（正则 `^CONTRACT_[A-Z0-9_]+$`），保真透传该结构化 result；否则回落 `provider_exit_${code}`。判定**只凭结构化 `result.error.code`**，绝不 grep stdout 文本。

**要求实现（CONTRACT IS LAW）**：
- 抽出纯函数 `resolveProviderCloseResult({ resultPath, attemptId, exitCode })` 并 `module.exports` 导出：
  - `exitCode === 0` → `parseHarnessResult(resultPath)`（原语义：抛错则由调用方兜 `provider_result_invalid`）
  - `exitCode !== 0` → 内部 `try parseHarnessResult(resultPath)`：解析失败（缺文件/非法）→ 返回 `failedHarnessResult(attemptId, 'provider_exit_${exitCode}')`；解析成功且 `error.code` 匹配 `^CONTRACT_[A-Z0-9_]+$` → 返回该结构化 result（保真）；否则 → `failedHarnessResult(attemptId, 'provider_exit_${exitCode}')`
- `child.once('close', ...)` 改为调用 `resolveProviderCloseResult(...)`，外层 `try/catch` 仍兜 `provider_result_invalid`（保 exit 0 非法 result 原语义）

**验证命令**:
```bash
# 边界:结构化但非 CONTRACT_* code + 非零退出 → 走原有 provider_exit 语义(不误保真)
node -e '
const { createRequire } = require("node:module");
const { resolveProviderCloseResult } = createRequire(process.cwd()+"/x.js")("./packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs");
const fs=require("fs"),os=require("os"),path=require("path");
const p=path.join(fs.mkdtempSync(path.join(os.tmpdir(),"h-")),"r.json");
const AID=process.env.HARNESS_ATTEMPT_ID||"00000000-0000-4000-8000-000000000abc";
fs.writeFileSync(p,JSON.stringify({contract_version:"1.0",attempt_id:AID,status:"blocked",summary:"s",artifacts:[],checks:[],decision:null,error:{code:"semantic_refusal",message:"m"},provider_metadata:{provider:"codex"}}));
const r=resolveProviderCloseResult({resultPath:p,attemptId:AID,exitCode:1});
if(r.error.code!=="provider_exit_1"){console.error("FAIL",JSON.stringify(r));process.exit(1)}
console.log("OK");'
# 期望：OK（非 CONTRACT_* 结构化 code 不保真，回落 provider_exit_1）
```

**硬阈值**: 非 `CONTRACT_*` 结构化 code（如 `semantic_refusal`）在非零退出下 → `error.code === 'provider_exit_1'`。

---

### Step 3: kernel 分类不把保真后的结构化 blocked 结果落成 infrastructure
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步 + 要求 2；ASSUMPTION 46 核实结论：`execution-contract.parseHarnessResult` 对 `status:'blocked'` 且 `failure_class!=='infrastructure_blocked'` 已分类为 `semantic_refusal`（非 infrastructure），`provider_exit` 不在 `PROVIDER_UNAVAILABLE_CODES` → 无需改 kernel 分类；本步是保真透传后的**既有正确路径确认**（真 import 断言，非改动）

**可观测行为**: 保真后的结构化 result 经 `execution-contract.parseHarnessResult(result,'generator')` 分类，`failure_class` 为 `semantic_refusal`，**不是** `infrastructure_blocked` → 不进 infrastructure 重试/failed_targets 黑名单分支。

**验证命令**:
```bash
node -e '
const { createRequire } = require("node:module");
const { resolveProviderCloseResult } = createRequire(process.cwd()+"/x.js")("./packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs");
import("./packages/brain/src/orchestrator/execution-contract.js").then(({parseHarnessResult})=>{
const fs=require("fs"),os=require("os"),path=require("path");
const p=path.join(fs.mkdtempSync(path.join(os.tmpdir(),"h-")),"r.json");
const AID=process.env.HARNESS_ATTEMPT_ID||"00000000-0000-4000-8000-000000000abc";
fs.writeFileSync(p,JSON.stringify({contract_version:"1.0",attempt_id:AID,status:"blocked",summary:"s",artifacts:[],checks:[],decision:null,error:{code:"CONTRACT_SELF_CONTRADICTION",message:"m"},provider_metadata:{provider:"codex"}}));
const runner=resolveProviderCloseResult({resultPath:p,attemptId:AID,exitCode:1});
const c=parseHarnessResult(runner,"generator");
if(c.failure_class==="infrastructure_blocked"){console.error("FAIL infra",JSON.stringify(c));process.exit(1)}
console.log("OK",c.failure_class);});'
# 期望：OK semantic_refusal（非 infrastructure_blocked）
```

**硬阈值**: `classified.failure_class !== 'infrastructure_blocked'`（实测应为 `semantic_refusal`）。

---

### Step 4: derive 走合同故障仲裁 → 重开 GAN（病族保真可见），不进黑名单/不 infra 重试
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3-4 步 + 要求 2（r40 机制 `ARBITRATE_CONTRACT_FAULT` / `contract_fault_reopen_gan`）

**可观测行为**: 把保真+分类后的 result 作为 attempt callback 喂入 `derive(observed)`（含 `spawn:generator-fix` + callback 行），路由 action 为 `arbitrate:contract_fault`、reason 为 `contract_fault_appeal`（既有 r40 仲裁前置），**不是** 任何 infrastructure/failed_targets/human_review 兜底。

**验证命令**:
```bash
# 全链复刻 r69:runner 保真 → kernel 分类 → derive 路由,vitest 真跑冻结测试
npx vitest run sprints/08270110-kernel-r77-contract-fault-code/tests/contract-fault-code-passthrough.test.ts --reporter=verbose 2>&1 | tee /tmp/r77-red.log
grep -Eq "arbitrate:contract_fault|contract_fault_appeal" /tmp/r77-red.log || true
# 期望(GREEN 阶段):该测试文件全部用例 PASS,且真实 collected 用例数 ≥6(见 DoD B-02 防范围外绿态)
```

**硬阈值**: `derive(...).action === 'arbitrate:contract_fault'` 且 `reason === 'contract_fault_appeal'`。

---

### Step 5: 负向出口 — 真实 provider 崩溃（无结构化 result）语义不变
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步 + 要求 3 + 边界

**可观测行为**: 非零退出且 resultPath 缺失/非法（真崩溃无结构化上报）→ `resolveProviderCloseResult` 返回 `status:'failed'` + `error.code:'provider_exit_${code}'`；经 kernel 分类为 `runner_failure`（非 semantic_refusal、非合同故障）。语义与现状**完全一致**。

**验证命令**:
```bash
node -e '
const { createRequire } = require("node:module");
const { resolveProviderCloseResult } = createRequire(process.cwd()+"/x.js")("./packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs");
const os=require("os"),path=require("path");
const AID=process.env.HARNESS_ATTEMPT_ID||"00000000-0000-4000-8000-000000000abc";
const missing=path.join(os.tmpdir(),"nonexistent-"+"r77","none.json");
const r=resolveProviderCloseResult({resultPath:missing,attemptId:AID,exitCode:42});
if(r.status!=="failed"||r.error.code!=="provider_exit_42"){console.error("FAIL",JSON.stringify(r));process.exit(1)}
console.log("OK");'
# 期望：OK（真崩溃仍 provider_exit_42 / failed，语义不变）
```

**硬阈值**: 无结构化 result 时 `status==='failed'` 且 `error.code==='provider_exit_42'`。

---

## 禁 mock 边清单

本单改动涉及**生命周期钩子**（provider 进程 `close` 回调）+ **跨模块数据传递**（runner 回执 → kernel 分类 → derive 路由）+ **状态机分类**（error_code → failure_class → 路由 action），命中 v9.12 禁 mock 规则，逐条列被改/被验的边：

- provider 进程 `close(exitCode)` ↔ runner 回执结果构造（`kernel-attempt-handler.cjs::resolveProviderCloseResult`）：**本单改的那条边**。测试必须真调 `resolveProviderCloseResult` + 真 `fs` 临时文件写入结构化 result，禁 `vi.mock`/stub 该函数或 `parseHarnessResult`/`failedHarnessResult`。
- runner 回执 result ↔ kernel 分类（`execution-contract.js::parseHarnessResult`）：跨模块数据传递边。测试真 import execution-contract 的 `parseHarnessResult`，喂 runner 真实输出，禁 mock。
- kernel 分类结果 ↔ derive 路由（`derive.js::derive`）：跨模块状态机边。测试真 import `derive`，用真实 decisionLog 断言路由 action/reason，禁 mock derive 内部。

允许 mock 的更外层无关依赖：无（本 sprint 纯函数链，无网络/DB/子进程 spawn 参与被测路径——测试直接调纯函数，连 child_process spawn 都不触及）。

**现有回归兼容性说明**（r73 教训核验）：`packages/brain/src/__tests__/codex-bridge-kernel-attempt.test.js` 三条相关断言在重构后仍绿——
1. `close(0)+合法 result` → `resolveProviderCloseResult(exit 0)` → `parseHarnessResult` 透传（不变）；
2. `close(0)+非法 status` → `parseHarnessResult` 抛错 → 外层 catch → `provider_result_invalid`（不变）；
3. `close(23)+无 result` → 非零分支内 `parseHarnessResult` 抛错 → `provider_exit_23`（不变）。
故该文件**默认无需改动**，仅在白名单登记为「允许更新（若 generator 需补回归断言）」。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | runner 非零退出兜底时，保真透传 generator 结构化 `CONTRACT_*` 家族 error_code，不降级为 `provider_exit`；使其能流到既有 kernel 合同故障重开 GAN 路径 |
| **NFR（做得多好）** | 非功能 | 纯函数、同输入可重放（无时钟/随机）；改动 ≤1 实现文件、外科式（只加纯函数 + 改 close 分支 + 导出） |
| **Invariant（永不违反）** | 不变量 | ①真 provider 崩溃（无结构化 result）仍 `provider_exit`/`runner_failure`，黑名单/infra 语义不变；②判定只凭结构化 `result.error.code`，禁 grep stdout；③`exit 0` 路径语义完全不变 |
| **判定点（怎么知道）** | 模糊现实判断 | 见下方登记表 |
| **保质期（何时过期）** | 失效 | 无过期；`CONTRACT_*` 家族正则随 derive `CONTRACT_FAULT_CORE_TOKENS` 演进，两处以「code 前缀 CONTRACT_」为共同锚，不硬编码具体病族枚举 |
| **死亡告警（停了谁知道）** | 告警 | 该逻辑失效 = 合同故障重新被埋没成 provider_exit → 案卷 `failed_targets`/`provider_exit_*` 再现；回归测试（tests/gp/f1/ 永久保留）红即告警 |
| **失败语义（挂了怎么办）** | 故障 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执 | 无对外动作；效果确认 = vitest 全链测试 PASS + node 真 import 断言 error.code 保真 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ 一次非零退出是「结构化合同故障」还是「真崩溃」 | A. grep stdout 是否含 CONTRACT_ 文本; B. 读结构化 `result.error.code` 是否匹配 `^CONTRACT_[A-Z0-9_]+$` | B. 结构化 `result.error.code` 正则匹配 | stdout 文本可被崩溃残留污染（PRD 边界 line 29 明确禁 grep stdout）；结构化 code 是 generator 的确定性上报载体 | 静默把合同死锁埋没成 provider_exit（进黑名单/白烧 infra 重试，失败不留病族）；或反向把真崩溃误判成合同故障错误重开 GAN |

（⚠️ 标记：误判后果为「静默丢失原因病族」，属 e035dad8 第②条升拍板级；PrepPRD 已在 thin_prd 显式拍定「凭 result.error.code 判定、禁 grep stdout」，故不再挂 judgment-pending-user。）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| resultPath 缺失/非法 JSON（真崩溃） | 非零退出 → 返回 `provider_exit_${code}` / `status:failed` | 是（纯函数，同输入同输出） | kernel 按 infrastructure/runner_failure 原语义处理（不变） |
| 结构化 result 合法但 error.code 非 CONTRACT_* | 非零退出 → 回落 `provider_exit_${code}` | 是 | 走原有 provider_exit 语义，不误路由 reopen GAN |
| `exit 0` + 非法 result | 外层 catch → `provider_result_invalid` | 是 | 原语义不变 |

### 输入对抗面

N/A — 本 sprint 是 kernel 内部纯函数分类逻辑，不对外暴露 agent 接口、无外部不可信输入（resultPath 内容来自本 fleet 的 generator 上报，经 `parseHarnessResult` schema 校验）。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `resolveProviderCloseResult` 传 `exitCode` 为字符串 `"1"` / `null` / `undefined`（SIGTERM close 传 null）——确认 `exitCode===0` 严格判等不把 null 误判为成功路径（应走非零分支 → provider_exit_null，与现状一致）
- 错输入: resultPath 指向空文件 / 截断 JSON / 合法 JSON 但缺 `error` 字段 → 应回落 provider_exit，不抛未捕获异常
- 边界值: error.code 为 `"CONTRACT_"`（仅前缀无后缀，正则 `^CONTRACT_[A-Z0-9_]+$` 需 ≥1 后缀字符不匹配）/ 超长 code（>64 字符，attempt-store 会 slice 64，确认全链一致）/ 小写 `contract_self_contradiction`（正则大小写敏感 → 不匹配，符合 generator 上报大写约定）
- 中途中断: `exit 0` 但 resultPath 同时含 CONTRACT_* code —— 确认走 parseHarnessResult 原样透传（本就保真，非本 sprint 改动点）
发现分级: P0/P1（真崩溃被误判成合同故障 / 合同故障仍被埋没）→ 阻塞 merge；P2/P3（日志措辞、边界 code 变体）→ 记 findings 不阻塞

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 无 DB/无 HTTP（runtime_resources.postgres=false），local_api 退化为「本地 vitest 真跑 tests/gp/f1/ 与 sprints/<dir>/tests/ + node 真 import 断言」。invariant [vitest范围外绿态]：脚本必须实跑并断言 **真实 collected 用例数**，不能只看 exit 0（include 范围外路径绿态也 exit 0）。冻结测试落 `sprints/**` 与 `tests/**`，两者均在根 vitest include 内。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"

FROZEN="sprints/08270110-kernel-r77-contract-fault-code/tests/contract-fault-code-passthrough.test.ts"
GP="tests/gp/f1/step3-contract-fault-code-passthrough.test.js"

# 1) 冻结合同测试 + 永久回归测试：真跑并用 JSON reporter 断言实际 collected 用例数(防范围外绿态假过)
npx vitest run "$FROZEN" "$GP" --reporter=json --outputFile=/tmp/r77-e2e.json
node -e '
const r=require("/tmp/r77-e2e.json");
const total=r.numTotalTests||0, passed=r.numPassedTests||0, failed=r.numFailedTests||0;
if(total<12){console.error("FAIL: collected 用例数 "+total+" <12(两文件各≥6),疑似 No test files found 假绿");process.exit(1);}
if(failed>0||passed!==total){console.error("FAIL: passed="+passed+" failed="+failed+" total="+total);process.exit(1);}
console.log("OK vitest total="+total+" all passed");'

# 2) runner 保真透传(node 真 import,非零退出下 CONTRACT_* 不降级)
node -e '
const { createRequire } = require("node:module");
const { resolveProviderCloseResult } = createRequire(process.cwd()+"/x.js")("./packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs");
const fs=require("fs"),os=require("os"),path=require("path");
const AID=process.env.HARNESS_ATTEMPT_ID||"00000000-0000-4000-8000-000000000abc";
const p=path.join(fs.mkdtempSync(path.join(os.tmpdir(),"h-")),"r.json");
fs.writeFileSync(p,JSON.stringify({contract_version:"1.0",attempt_id:AID,status:"blocked",summary:"s",artifacts:[],checks:[],decision:null,error:{code:"CONTRACT_SELF_CONTRADICTION",message:"m"},provider_metadata:{provider:"codex"}}));
const r=resolveProviderCloseResult({resultPath:p,attemptId:AID,exitCode:1});
if(r.error.code!=="CONTRACT_SELF_CONTRADICTION"||r.status!=="blocked"){console.error("FAIL keep",JSON.stringify(r));process.exit(1);}
console.log("OK passthrough");'

# 3) 负向:真崩溃(无结构化 result)语义不变
node -e '
const { createRequire } = require("node:module");
const { resolveProviderCloseResult } = createRequire(process.cwd()+"/x.js")("./packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs");
const os=require("os"),path=require("path");
const AID=process.env.HARNESS_ATTEMPT_ID||"00000000-0000-4000-8000-000000000abc";
const r=resolveProviderCloseResult({resultPath:path.join(os.tmpdir(),"r77-missing","none.json"),attemptId:AID,exitCode:42});
if(r.status!=="failed"||r.error.code!=="provider_exit_42"){console.error("FAIL neg",JSON.stringify(r));process.exit(1);}
console.log("OK negative");'

echo "✅ r77 Golden Path E2E 验证通过"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| runner 保真透传 + kernel 分类 + derive 路由（全链 r69 复刻） | `sprints/08270110-kernel-r77-contract-fault-code/tests/contract-fault-code-passthrough.test.ts` | `保真透传 CONTRACT_SELF_CONTRADICTION`；`全链复刻 r69`；`分类不落 infrastructure`；`负向 真崩溃 provider_exit`；`边界 非 CONTRACT_ 结构化 code`；`纯函数可重放` | 修前 `resolveProviderCloseResult` 未导出 → import/调用 TypeError → 全部 FAIL（→ 6 failures） |
| 永久回归（tests/gp/f1，与冻结测试同源，CI 常驻） | `tests/gp/f1/step3-contract-fault-code-passthrough.test.js` | 同上 6 条 | 同上（→ 6 failures） |
