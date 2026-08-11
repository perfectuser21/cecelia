# Sprint Contract Draft (Round 1) — kernel 账号选择接入用量数据：429 周限触发 target 轮换而非 run 终态

覆盖父路 e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29（autonomous kernel orchestrator）— 独立小路（无父路 golden_path 锚点；journey step_id=none）

> journey_type=autonomous，target_environment=local_api。根因与修复全在 `packages/brain/` 纯后端 orchestrator（纯函数/纯状态机），无 UI/agent 协议/engine 介入。
> 验收 oracle 为 vitest（DB/日志证据替代 UI 证据，符合本 sprint Invariant「local_api/无 UI smoke」条款 + 「vitest 范围」条款）。

---

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应（纯内部 orchestrator 逻辑改动：failure_class 分类 + derive 路由 + target 选择）。Reviewer 第 6 维按 N/A 处理。

本 sprint 契约以三个纯函数/纯状态机的返回契约锚定（非 HTTP schema）：

### `parseHarnessResult(result, role)` — `packages/brain/src/orchestrator/execution-contract.js`
- 新增 `failure_class` 枚举值 `account_exhausted`（加入 `harnessResultSchema` 的 `failure_class` enum）。
- 分类规则（`status==='failed'|'cancelled'` 且无显式 `failure_class` 时）：错误对象命中「配额语义」→ `account_exhausted`；否则维持既有 `runner_failure`/`infrastructure_blocked` 语义。
- 「配额语义」判定（二者其一即命中）：
  - `error.message` 匹配 `/weekly limit|hit your weekly|spending cap|credit balance is too low/i`（强配额信号，账号周限/额度耗尽）；
  - `error.code` 或 `error.message` 含 `429`（`http_429` / `api_error_status:429`）**且** `error.message` 匹配 `/rate.?limit/i`。
- 边界：裸 429（`code:'http_429', message:'Too Many Requests'` 等无配额关键词）**不**命中 → 仍 `runner_failure`（PRD 边界：偶发限流不误判为账号耗尽）。

### `derive(observed)` — `packages/brain/src/orchestrator/derive.js`（`attemptCallbackRoute`）
- attempt callback `status==='failed'` 且 `failure_class==='account_exhausted'` → 走「账号耗尽·非终态重试」分支（复用 `INFRA_RETRY_ACTION_BY_ROLE[role]`），返回 `{ phase, action, reason:'callback_account_exhausted' }`，**不**返回 `phase:'failed'/action:'mark_failed'`。
- 边界：`failure_class==='runner_failure'` 维持既有 `{ phase:'failed', action:'mark_failed', reason:'callback_runner_failure' }` 终态（回归保护，非配额语义不误轮换）。

### `resolveExecutionTarget(input)` — `packages/brain/src/orchestrator/preflight/execution-targets.js`
- 新增可选入参 `is_account_capped: (target)=>boolean`，默认 `()=>false`（由调用方从 account-usage 单一事实源注入 CAPPED 活数据）。
- 选目标时：CAPPED 的 target 视为不可用（与 exhausted 同等跳过）——preferred 短路命中额外要求 `!capped`；候选 `.find` 额外要求 `!capped`。
- 边界：候选全部 CAPPED/exhausted → `status:'blocked', fallback_reason:'all_execution_targets_exhausted'`（不静默假死）。
- 边界：`is_account_capped` 抛错或未注入 → 降级为静态白名单顺序，不 crash（account-usage 数据不可达时不阻断选目标）。
**禁用字段名**: 无（不涉及 HTTP schema）。

---

## 已知约束（来自回归测试）

- [execution-targets.test.js] → 只放行 18 个已验证 provider/account/machine 组合（新增 CAPPED 逻辑不得改变白名单基数 18）
- [execution-targets.test.js] → expandUnresolvedAccountTargets：account 为空的候选按 provider+machine 展开为白名单具体账号（不得回退）
- [execution-contract.test.js] → parseHarnessResult：`http_503/provider_timeout`→infrastructure_blocked，`runner_exit`→runner_failure（既有分类不得回退）
- [derive.test.js] → attemptCallbackRoute：needs_context→pause_run、semantic_refusal→wait_human_review、合同故障码仲裁重开 GAN（既有路由不得回退）
- [累积FR] context-manifest: 本 line 暂无历史累积 FR（PRD 声明）

---

## Golden Path

[claude/account1 命中 429 周限] → [识别为 account_exhausted·非终态] → [derive 同 run 重派角色] → [选目标跳过 CAPPED 账号轮换到 account2] → [run 保持 running 不以 callback_runner_failure 终态收尾]

### Step 1: runner 回调携带 429 weekly limit → 识别为账号耗尽类
**来源**: `[FROM_PRD]` — Golden Path 第 1-2 步（PRD「触发条件」「系统处理」段）直接定义。

**可观测行为**: `parseHarnessResult` 对 `status:'failed'` + `error:{code:'http_429', message:"You've hit your weekly limit"}` 的结果返回 `failure_class:'account_exhausted'`（区别于普通 `runner_failure`）。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/orchestrator/__tests__/quota-exhaustion-classify.test.js -t "429 weekly limit 的 failed 结果归类为 account_exhausted" --reporter=dot
# 期望：exit 0（该 it 通过）
```
**硬阈值**: 该测试通过（exit 0）；对应可执行命令见上。

---

### Step 2: 偶发 429 无配额语义 → 不误判（边界）
**来源**: `[FROM_PRD]` — PRD「边界情况」第 2 条（429 但非配额语义保持 runner_failure）。

**可观测行为**: `error:{code:'http_429', message:'Too Many Requests'}` → 仍 `runner_failure`。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/orchestrator/__tests__/quota-exhaustion-classify.test.js -t "偶发 429 无配额语义关键词" --reporter=dot
# 期望：exit 0
```
**硬阈值**: 该测试通过（exit 0）。

---

### Step 3: account_exhausted 不判 run 终态 → 同 run 重派
**来源**: `[FROM_PRD]` — Golden Path 第 2、4 步 + PRD「假设」第 3 条（run 不进终态 = attempt 层失败但 run 保持 running 派新 attempt）。

**可观测行为**: `derive(observed)` 对 attempt callback `{status:'failed', failure_class:'account_exhausted', role:'generator'}` 返回 `{phase:'generate', action:'spawn:generator-fix', reason:'callback_account_exhausted'}`，`phase` 不为 `failed`/`terminal`。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/orchestrator/__tests__/derive-account-exhausted.test.js -t "account_exhausted 的 attempt callback" --reporter=dot
# 期望：exit 0
```
**硬阈值**: 该测试通过（exit 0）；phase != failed。

---

### Step 4: runner_failure 仍判终态（边界·回归保护）
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：防止「account_exhausted 非终态」改动误伤普通 runner_failure 的既有终态语义（回归护栏，PRD 边界「不过度轮换」的镜像断言）。

**可观测行为**: `derive` 对 `{status:'failed', failure_class:'runner_failure'}` 仍返回 `{phase:'failed', action:'mark_failed', reason:'callback_runner_failure'}`。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/orchestrator/__tests__/derive-account-exhausted.test.js -t "普通 runner_failure 仍判 run 终态" --reporter=dot
# 期望：exit 0
```
**硬阈值**: 该测试通过（exit 0）。

---

### Step 5: 选目标消费 account-usage CAPPED → 跳过 account1 轮换到 account2
**来源**: `[FROM_PRD]` — Golden Path 第 3 步（resolveExecutionTarget 消费 account-usage 活数据，CAPPED 账号跳过/排最后）。

**可观测行为**: `resolveExecutionTarget({preferred_target:account1, candidates:[account1,account2], is_account_capped:t=>t.account==='account1'})` → `status:'ok', target=account2`。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/orchestrator/preflight/execution-targets-capped.test.js -t "CAPPED 的 preferred 账号被跳过" --reporter=dot
# 期望：exit 0
```
**硬阈值**: 该测试通过（exit 0）；target.account==account2。

---

### Step 6: 全部 CAPPED → blocked（边界，不静默假死）
**来源**: `[FROM_PRD]` — PRD「边界情况」第 1 条（两账号均 CAPPED → blocked `all_execution_targets_exhausted`，此时才允许 run 走终态）。

**可观测行为**: 两账号均 CAPPED → `status:'blocked', fallback_reason:'all_execution_targets_exhausted'`。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/orchestrator/preflight/execution-targets-capped.test.js -t "两账号均 CAPPED" --reporter=dot
# 期望：exit 0
```
**硬阈值**: 该测试通过（exit 0）。

---

### Step 7: account-usage 不可达 → 降级静态顺序不 crash（边界）
**来源**: `[FROM_PRD]` — PRD「边界情况」第 3 条（account-usage 数据不可达/为空降级静态白名单，不因取数失败 crash）。

**可观测行为**: `is_account_capped` 抛错 → `resolveExecutionTarget` 仍返回 `status:'ok', target=account1`（静态顺序）。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/orchestrator/preflight/execution-targets-capped.test.js -t "抛错时降级为静态白名单顺序" --reporter=dot
# 期望：exit 0
```
**硬阈值**: 该测试通过（exit 0）。

---

## 禁 mock 边清单

本单改动涉及**状态机**（derive attemptCallbackRoute 路由）+ **失败分类跨模块数据传递**（parseHarnessResult → 落库 detail.failure_class → derive 消费）+ **target 选择逻辑**。下列边禁 mock：

- `parseHarnessResult` ↔ 输入 `error` 对象（本单改分类逻辑，测试必须用真实 error shape 直接跑 `parseHarnessResult`，禁止 mock/stub 该函数或其内部分类分支）
- `derive` ↔ `observed.decisionLog`（本单改路由，测试必须真调 `derive` 并断言真实返回的 `{phase,action,reason}`，禁止 stub derive 或替换 attemptCallbackRoute）
- `resolveExecutionTarget` ↔ 候选/exhausted/capped 选择逻辑（本单改选目标，测试必须真调该函数并断言真实 target，禁止 mock 该函数）

**允许注入（外层无关边界，非被改的边）**: `is_account_capped` 判定谓词——它代表 account-usage 模块（另一模块，顶层 import db.js 会把 Postgres 依赖拖进纯函数测试）的读取结果。注入它 = mock 更外层的独立依赖边界，符合规则；被测的 `resolveExecutionTarget` 选择逻辑本身不被 mock。这与「禁 mock 被改的边」不冲突：被改的边是选择逻辑，account-usage 是其消费的外部事实源。

> 本单不触 DB 写路径（parseHarnessResult/derive/resolveExecutionTarget 均纯函数，无 INSERT/UPDATE），故无「代码↔DB 表」禁 mock 边；测试全部 DB-free（postgres=false 下可跑）。

---

## 真实调用方请求 shape

本单分类的「调用方」是 runner 回调的 harness result（failed 态携带 429）。真实 error shape（源自 cap-marking 中间件已识别的生产 429 特征 `packages/brain/src/spawn/middleware/cap-marking.js:CAP_PATTERNS` + issue 7c9f427e 实证消息）：

```jsonc
// status:'failed' 的 harness result 中的 error 对象（生产 429 周限）
{ "code": "http_429", "message": "You've hit your weekly limit ... rate_limit / api_error_status:429" }
```

- 强配额信号消息片段（生产实证）：`You've hit your weekly limit`、`api_error_status:429`、`"type":"rate_limit_error"`、`credit balance is too low`。
- 分类断言构造的 error 对象与此 shape 逐字段一致（`error.code` + `error.message`），不引入生产不存在的字段。

---

## 未覆盖真实链路清单

| 真实链路点被替代处 | 为什么 | 真验证补位计划（谁/何时/什么环境） |
|---|---|---|
| 真实 Anthropic 429 周限（未真调第三方触发一次真 429） | 单元层无法也不应真把某账号打到周限（成本/不可控/污染生产用量）；用与生产逐字段一致的 error shape 断言分类 | 主理人/运维在下次 account1 真实 CAPPED 窗口，用 DB 复查 harness_attempts.failure_class 是否记为 account_exhausted 且同 run 出现 account2 新 attempt（logic-done-pending 接缝） |
| resolveExecutionTarget 的 `is_account_capped` 由谁在生产 dispatch 注入 | 本 sprint 范围（PRD 明列 3 个源文件）只交付函数消费 account-usage 判定的能力；`resolveExecutionTarget` 目前无生产调用方（仅 smoke 脚本引用），把 account-usage→选目标的 wiring 接线属另一改动 | 后续 wiring sprint：dispatch 侧从 `account-usage.isSpendingCapped` 注入 `is_account_capped`；本 sprint 在接缝清单标 logic-done-pending |

---

## 接缝清单（接缝 vs 逻辑）

| # | 接缝点 | 碰真实世界在哪 | 真目标验证方式 | 状态 |
|---|---|---|---|---|
| 1 | 真实 429 周限 → account_exhausted 分类 → 同 run 轮换 account2 | 生产 runner 回调真 429 + 真 harness_attempts DB 记录 | DB 复查：同 run_id 下先 account1 failed(account_exhausted) 后 account2 新 attempt，run 未 callback_runner_failure 终态 | logic-done-pending（单测覆盖逻辑；真 429 端到端待真实 CAPPED 窗口复查） |
| 2 | account-usage CAPPED 活数据 → resolveExecutionTarget 注入 | 生产 dispatch 从 account-usage 单一事实源读 CAPPED | wiring sprint 落地后，dispatch 调用 resolveExecutionTarget 传入真 is_account_capped | logic-done-pending（函数已消费能力就绪；生产 wiring 属范围外后续单） |

**逻辑断言（环境无关，CI/单测绿=真 done）**: parseHarnessResult 分类、derive 路由、resolveExecutionTarget 选择——三者纯函数，vitest 绿即 done。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | 配额类失败(429 weekly/rate limit)识别为 account_exhausted；derive 不判 run 终态而同 run 轮换；resolveExecutionTarget 消费 account-usage CAPPED 判定跳过已 CAPPED 账号 |
| **NFR（做得多好）** | 性能/可靠性 | is_account_capped 同步谓词，不阻塞/不引 DB 依赖进纯函数；不改 approvalRateLimit 等生产安全参数 |
| **Invariant（永不违反）** | 不变量 | 白名单基数恒 18；既有分类/路由不回退；CAPPED 数据不可达时降级静态顺序不 crash；两账号全 CAPPED 才允许 blocked 终态（不静默假死） |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 失效/退役 | account_exhausted 语义随 account-usage 单一事实源存续；is_account_capped 谓词由 CAPPED reset 时间（markSpendingCap resetTime）自动过期 |
| **死亡告警（停了谁知道）** | 告警手段 | 两账号全 CAPPED → blocked 落 run 终态可在 DB/日志复查（PRD NFR：禁静默假死）；既有 P0/P1 告警链不变 |
| **失败语义（挂了怎么办）** | 放行还是拦截 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执确认 | 逻辑效果由 vitest exit code 确认；真轮换效果由 DB harness_attempts（同 run 出现 account2 新 attempt + run 非终态）复查（接缝清单 #1） |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 记录 API 不稳 | 静默丢消息 |
| ⚠️ 某 failed 结果是否为「账号配额耗尽」 | A. 仅看 code=http_429; B. code=429 且 message 含配额关键词; C. message 含强配额语义(weekly limit/spending cap) | B∪C（429+rate limit 关键词 或 强配额语义消息之一命中） | 仅看 429 会把偶发限流误判为账号耗尽→过度轮换（PRD 边界禁止）；强配额语义(weekly limit)是账号耗尽的确定信号 | 误判为耗尽→无谓轮换耗尽好账号；漏判→run 撞 429 假死（回到本 bug） |
| 某 claude 账号当前是否 CAPPED | A. resolveExecutionTarget 自查 account-usage(引 DB 进纯函数); B. 调用方注入 is_account_capped 谓词(account-usage 单一事实源) | B | 保持 resolveExecutionTarget 纯函数/DB-free；与 account-usage 单一事实源对齐消除双系统裂脑 | 误判 CAPPED→跳过可用账号致 blocked；漏判→选中 CAPPED 账号撞 429 |

> ⚠️ 行「某 failed 结果是否为账号配额耗尽」误判后果较重（过度轮换/假死），判定方法(B∪C)已在 PRD 边界情况明确拍板（429 非配额语义不误判），非新增待确认判定点，故不加 judgment-pending-user。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| account-usage 判定不可达（is_account_capped 抛错/未注入） | 不 crash，降级静态白名单顺序 | 是（纯函数无副作用） | 静态顺序选目标 |
| 两账号均 CAPPED/exhausted | resolveExecutionTarget 返回 blocked（all_execution_targets_exhausted），允许 run 走终态 | 是 | 显式 blocked，禁静默假死 |
| 同 run 内重复 429 | 已 exhausted 的 account1 不再被选（isExhausted 跳过），避免轮换死循环 | 是 | 轮换到未 exhausted 且未 CAPPED 的下一账号 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本单为内部 orchestrator 纯逻辑，不新增对外暴露 agent/接口，无外部可写入输入面。

---

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

---

## E2E 验收（final-e2e 跑 — target_environment=local_api，vitest 单测 oracle）

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 修复对象为 packages/brain 纯函数/纯状态机，无 HTTP 端点、无 DB 写、无 UI。按本 sprint Invariant「local_api/无 UI smoke 以 DB/日志证据替代 UI 证据」+「vitest 范围：新增 test 必须落在 CI include 范围内」——三个新增回归测试均置于 `packages/brain/src/**`（vitest.config.js include `src/**/*.test.js` 命中，且不在 exclude 列），exit code 真实反映真回归。E2E 脚本真跑 vitest（真执行被改的三个函数，禁 mock 被改的边），并复跑既有 orchestrator 测试确认零回归。

```bash
#!/bin/bash
set -euo pipefail
cd packages/brain

# rollup native optional-dep 兜底（npm optional-deps 已知 bug；缺平台二进制则装，不改 lockfile）
node -e "require('rollup')" 2>/dev/null || \
  npm install --no-save --no-package-lock \
  "@rollup/rollup-linux-$(node -e 'process.stdout.write(process.arch==="arm64"?"arm64-gnu":"x64-gnu")')" >/dev/null 2>&1 || true

# 1. 本 sprint 三个死锁点新增回归测试全绿（真跑被改的三个函数）
npx vitest run \
  src/orchestrator/preflight/execution-targets-capped.test.js \
  src/orchestrator/__tests__/quota-exhaustion-classify.test.js \
  src/orchestrator/__tests__/derive-account-exhausted.test.js \
  --reporter=dot

# 2. 既有 orchestrator 测试不回归（分类/路由/白名单基数 18）
npx vitest run \
  src/orchestrator/__tests__/execution-contract.test.js \
  src/orchestrator/__tests__/derive.test.js \
  src/orchestrator/preflight/execution-targets.test.js \
  --reporter=dot

echo "OK: 配额轮换 3 死锁点全绿 + 既有 orchestrator 测试零回归"
```

（set -e + vitest 真实 exit code：任一测试失败即非 0 退出，脚本 FAIL；vitest 默认 passWithNoTests=false，路径写错=报错非静默假绿。）

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: parseHarnessResult 传 `error:null` / `error` 为字符串 / `error.message` 缺失 时不得 crash，仍回落 runner_failure
- 错输入: resolveExecutionTarget 传 `candidates:[]` + is_account_capped 全 true → blocked，不抛异常
- 重复提交: 同 run 连续两次 account_exhausted（account1 已 exhausted）→ derive 不应无限重派同一 account1（isExhausted 跳过）
- 边界值: is_account_capped 返回非布尔（如 truthy 字符串/undefined）→ 按 `!capped` 语义安全处理不误选
- 中途中断: account_exhausted 与 infrastructure_blocked 同 run 混合出现时路由互不串扰
发现分级: P0/P1（run 假死/误判终态/选中 CAPPED 账号）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## notes

- contract-gate: cecelia 仓存在 packages/brain/src/lib/contract-gate.js 时按原逻辑过代码层门；本合同 BEHAVIOR/E2E 均为 `bash -c` 包裹的 vitest 真执行断言（exit-code 驱动），符合 Contract Gate 惯用法。
- Kernel validation identity: 本合同不写任何 attempt_id/capability_snapshot_id UUID 字面值；E2E 无需注入 HARNESS_* 身份（纯 vitest 单测，不产生跨角色证据链）。
- 接缝 #1/#2 标 logic-done-pending：逻辑层单测全绿即交付；真 429 端到端 + dispatch wiring 属范围外后续，已入未覆盖真实链路清单，controller 呈现进 PR 描述。
