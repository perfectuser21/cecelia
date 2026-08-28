# Sprint Contract Draft (Round 1) — 结构化上报保真透传，根除 provider_exit 语义埋没 [r79]

**journey_type**: autonomous
**target_environment**: local_api
**范围**: runner 回执归一化 + kernel 失败归因分流；纯函数 + 真 bash/jq 离线重放验收（无 HTTP 端点、无 DB 写路径，postgres 非必需）

---

## Response Schema（推导来源: PRD 字面 — N/A）

N/A — 任务无 HTTP 响应。本 sprint 是 harness kernel 自驱 GAN 循环内部的 runner 回执归一化（bash）+ kernel 失败归因分类（纯函数）改动，不新增/不修改任何 HTTP 端点，无 request/response schema。验收 oracle = tests/gp/f1 + sprint 冻结测试的纯函数重放（真 import 被改模块 + 真 bash/jq 跑 entrypoint.sh 抽取函数）。

---

## Golden Path

覆盖父路 **独立小路（无父路）** —— 修复 harness kernel 自驱 GAN 循环内部的失败归因埋没病，不挂任何已验收业务 Golden Path。

[执行体产出结构化终态] → [runner 回执保真透传 + kernel 按错误码族分流] → [合同故障重开 GAN；真崩溃仍按 provider_exit 处理]

---

### Step 1: 正向 A — success 结果 JSON + provider CLI 非零退出，保真透传成功
**来源**: `[FROM_PRD]` — sprint-prd.md L21-24「触发-正向A」+ L99 r77 复刻。

**可观测行为**: 执行体（commander）已产出 `commander-directive/v1` 成功 JSON，但 provider CLI（claude）残留非零码退出（如诊断残留 exit 1）。runner 的 `validate_claude_terminal_receipt` 认可该 commander 指令成功信封（对齐 `validate_codex_terminal_receipt` 已有的 `schema == "commander-directive/v1"` 旁路），上游据此恢复 `provider_exit=0` → 走成功透传，回执 `status` 与执行体产出一致，非 `provider_exit failed`。

**验证命令**:
```bash
# 真 bash + 真 jq 抽取 validate_claude_terminal_receipt 跑 r77 输入，exit 0 = 认可成功信封
npx vitest run sprints/08280010-kernel-r79-provider-exit-fidelity/tests/provider-exit-fidelity.test.js -t "认可 commander-directive/v1"
```
**硬阈值**: 该 it 断言 `verdict === '0'`（validate 返回 exit 0）；baseline 返回 '1'（RED）。

---

### Step 2: 正向 B — 结构化 BLOCKED + CONTRACT_* 保真透传，kernel 走合同故障重开
**来源**: `[FROM_PRD]` — sprint-prd.md L25-28「触发-正向B」+ L97-98 r69 复刻。

**可观测行为**: 执行体（generator）产出结构化 BLOCKED，`error.code` 属 `CONTRACT_*` 家族（如 `CONTRACT_SELF_CONTRADICTION`），provider CLI 非零退出。runner 的 `normalize_provider_failure` 在包装 provider_exit 前，先检测传入的结构化终态提取产物（result_file），命中合法 BLOCKED 信封 + 非 provider 家族 `error.code` → 保真透传该 `status` + `error.code`，禁止改写成 `provider_exit`。kernel 的 `derive` 收到 `CONTRACT_*` 家族码 → 走既有 `arbitrate:contract_fault` 合同故障重开分支，不进 `failed_targets`、不按 infrastructure 重试。

**验证命令**:
```bash
# runner 侧：真 bash/jq 跑 normalize_provider_failure，断言 CONTRACT_* 码保真
npx vitest run sprints/08280010-kernel-r79-provider-exit-fidelity/tests/provider-exit-fidelity.test.js -t "保真透传结构化 BLOCKED"
# kernel 侧：真 import derive，断言 CONTRACT_* → arbitrate:contract_fault
npx vitest run sprints/08280010-kernel-r79-provider-exit-fidelity/tests/provider-exit-fidelity.test.js -t "合同故障重开 GAN 路径"
```
**硬阈值**: normalize 输出 `error.code == "CONTRACT_SELF_CONTRADICTION"`（非 provider_exit）；derive 返回 `action == "arbitrate:contract_fault"`。baseline normalize 输出 `provider_exit`（RED）。

---

### Step 3: 负向 — 真崩溃无结构化产出，仍按 provider_exit / infrastructure 处理（铁律不动）
**来源**: `[FROM_PRD]` — sprint-prd.md L30-32「触发-负向」+ L80 Invariant [负向不动]。

**可观测行为**: 真实 provider 进程崩溃/超时，stdout 无任何结构化终态产出。runner 仍归一为 `provider_exit`（超时 exit 124 归 `provider_timeout`）；kernel 的 `derive` 仍按 `GENERATOR_RUNTIME_ERROR_CODES` 走 infrastructure 有界重派，黑名单语义不变。归因口径：`CONTRACT_*` 家族不落 `GENERATOR_RUNTIME_ERROR_CODES`。

**验证命令**:
```bash
# runner 负向：真崩溃 stdout 无结构化 → 仍 provider_exit
npx vitest run sprints/08280010-kernel-r79-provider-exit-fidelity/tests/provider-exit-fidelity.test.js -t "无结构化产出的真崩溃仍归一 provider_exit"
# kernel 负向：provider_exit → infrastructure 有界重派，不误判合同故障
npx vitest run sprints/08280010-kernel-r79-provider-exit-fidelity/tests/provider-exit-fidelity.test.js -t "infrastructure 有界重派"
# 归因口径：CONTRACT_* 排除出 runtime error codes
npx vitest run sprints/08280010-kernel-r79-provider-exit-fidelity/tests/provider-exit-fidelity.test.js -t "排除 CONTRACT_* 家族"
```
**硬阈值**: normalize 负向输出 `error.code == "provider_exit"`；derive 负向 `reason == "callback_infrastructure_blocked"` 且 `action != "arbitrate:contract_fault"`；`GENERATOR_RUNTIME_ERROR_CODES` 含 `provider_exit`/`provider_timeout`、不含任何 `CONTRACT_*`。

---

## 已知约束（来自回归测试 + 累积 FR）

- [回归] `tests/gp/f1/step3-commander-runner-failure-and-unanchored-review.test.js` → commander runner_failure 有界重派/无锚人审语义，本 sprint 负向路径不得回退。
- [回归] `tests/gp/f1/step3-runner-failure-retry.test.js` → runner_failure = 基础设施故障有界重派，不判 run 终态；本 sprint 负向 provider_exit 同族语义一致。
- [回归] `tests/gp/f1/step3-contract-test-paths-seal.test.js` → 冻结合同 Test Contract 解析链，本 sprint Test File 路径必须真实可解析。
- [累积FR] 本 line 暂无已验收历史行为（journeys/golden-paths 仅返回 status=planned 的 ability，无 done/working 项，PRD L88）。context-manifest 端点在本地 proposer 环境不可达（postgres:false）：context-manifest: unavailable。
- [MAP] map_scope/map_repo 未在 task.payload 配置：[MAP_NOT_CONFIGURED]，不回退领域硬编码。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | ①runner 检测执行体结构化终态优先于 provider_exit 包装并保真透传；②kernel 收 CONTRACT_* 走合同故障重开，不进黑名单/不按 infra 重试；③真崩溃无结构化产出仍 provider_exit。 |
| **NFR（做得多好）** | 非功能 | 分类为纯函数，同输入同结论可离线重放（不依赖时钟/随机/外部状态）；单 session ≤ 5400s。 |
| **Invariant（永不违反）** | 不变量 | [负向不动] 真崩溃无结构化产出 → provider_exit/infrastructure，黑名单语义不变；success 透传不放宽既有 codex/claude 严判（唯一 CLI 信封证明成功且与提取结构化结果一致）。 |
| **判定点（怎么知道）** | 判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 失效 | 分类逻辑随 CONTRACT_FAULT_CORE_TOKENS / 结构化信封 schema 演进；无 token/凭据保质期。 |
| **死亡告警（停了谁知道）** | 告警 | 回归失效即 CI 红（sprint 冻结测试 + tests/gp/f1 永久回归），Sprint Tests job 拦截。 |
| **失败语义（挂了怎么办）** | 故障 | 见下方失败语义声明。 |
| **效果确认（已发≠已生效）** | 回执 | 归一化产物即回执，evaluator 真跑重放断言 `error.code`/`status`/derive 分流结果，非「测试通过」空泛断言。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | API 不稳定 | 静默丢消息 |
| ⚠️ stdout 是否含「结构化终态」 | A. result_file 是合法信封且 status∈枚举且 error.code 非空非 provider_* 家族; B. 仅看 provider CLI 退出码 | A | 退出码不可信（codex/claude 诊断残留非零；PRD 假设 L58 锚点=result 信封非退出码） | 误判 A→B：真崩溃被当结构化透传（掩盖真故障）；误判 B→A：结构化 BLOCKED 被埋没 provider_exit（本 sprint 病根） |
| ⚠️ commander success 信封是否可信透传 | A. validate_claude_terminal_receipt 唯一 CLI 信封证明 success 且 structured_output==提取结果; B. 直接信 result_file | A | 混合态严判不放宽（PRD 边界 L39，沿用既有 codex 严判），防 racey/伪造 result_file 提权成功 | 误判 B：伪造成功信封被信任透传（提权/假绿），故 success 透传只走严判 validator，不走 normalize 兜底 |

> ⚠️ 两个判定点误判后果严重（掩盖真故障 / 假绿提权），已在 PrepPRD 假设 L57-58 与边界 L39 拍定（沿用既有 CONTRACT_FAULT_CORE_TOKENS 与 codex 严判，不新增码、不放宽），无新增待用户确认项。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| provider CLI 非零退出 + 有结构化终态 | 保真透传结构化 status/error.code | 是（纯函数，同信封同结论） | 无（透传即终态语义） |
| provider 真崩溃无结构化产出 | 归一 provider_exit（超时 provider_timeout） | 是 | kernel infrastructure 有界重派（既有语义不动） |
| CONTRACT_* 家族到 kernel | derive → arbitrate:contract_fault 重开 GAN | 是 | 每 run 只重开一次，第二次同类回落人审（既有） |

### 输入对抗面

N/A — 本 sprint 无对外暴露 agent 输入面。改动对象是 harness kernel 内部 runner 回执归一化与失败归因分类，输入来自受信执行体产出的回执信封 + kernel 自身 decisionLog，非外部用户可写入接口。

---

## 禁 mock 边清单

本单涉及 **状态机（失败归因分类/合同故障重开分支）** + **跨模块数据传递（runner 回执信封 → kernel derive 分类）** + **生命周期钩子（runner 终态归一化）**，故 failing test 必须真跑被改的边：

- **runner `normalize_provider_failure` / `validate_claude_terminal_receipt` ↔ jq**（本单改这两个 bash 函数的归一化判定）：测试真 bash 抽取原文函数 + 真 jq 执行，禁止用 JS 替身模拟 bash 逻辑。
- **kernel `derive.js` ↔ 失败归因分类**（本单确认 CONTRACT_* 分流）：测试真 import `derive`，不 stub `attemptCallbackRoute`。
- **kernel `ground-truth.js` GENERATOR_RUNTIME_ERROR_CODES ↔ 归因口径**（本单导出锁定）：测试真 import 该 Set，断言 CONTRACT_* 排除。
- **runner 回执信封 shape ↔ kernel derive 输入**：测试构造的 `detail.error_code`/`status`/`role` 与 runner 实际写出的回执字段同形（真实数据契约），不伪造 kernel 独有字段。

（仅纯外层无关依赖——如 credential redaction、heartbeat、更远第三方——允许不涉及；本单测试未 mock 任何被改边。）

---

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

---

## Contract Gate

contract-gate: present (packages/brain/src/lib/contract-gate.js 存在，cecelia worktree)。本合同 [BEHAVIOR]/E2E 命令均为 exit-code 驱动的真执行断言（npx vitest / 真 bash-jq / 真 import），无 `|| true` 吞错、无裸 curl 无 jq、无弱 oracle。

---

## E2E 验收（final-e2e 跑 — target_environment=local_api，纯函数 + 真 bash/jq 离线重放）

> 本 sprint 无 HTTP 端点、无 DB 写路径（runtime_resources.postgres=false）。Golden Path 的可观测行为全部落在 runner bash 归一化产物 + kernel 纯函数分类结果，oracle = 真 import 被改模块 + 真 bash/真 jq 跑 entrypoint.sh 抽取函数的离线重放。故 E2E 不含 curl localhost:5221 / psql 硬闸（无对应真实副作用面，加了必是文本自证或假绿）。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"
SPRINT_DIR="sprints/08280010-kernel-r79-provider-exit-fidelity"

# jq 是被改 bash 函数（normalize_provider_failure / validate_claude_terminal_receipt）的真实依赖
command -v jq >/dev/null || { echo "FAIL: jq 不可用（被改 bash 函数的真实依赖）"; exit 1; }

# 1. sprint 冻结合同测试：r69 passthrough / r77 commander / 负向不动 / kernel 分流 / 归因口径
npx vitest run "$SPRINT_DIR/tests/provider-exit-fidelity.test.js" --reporter=dot

# 2. tests/gp/f1 永久回归（PRD 要求 5：修复后永久保留在 CI 作回归）
npx vitest run tests/gp/f1/step3-provider-exit-fidelity.test.js --reporter=dot

echo "OK: r79 结构化上报保真透传三场景全绿（r69 结构化BLOCKED透传 / r77 commander success / 负向真崩溃不动）"
```

**通过标准**: 脚本 exit 0（两个测试文件全绿）。**FAIL 标准**: 任一 vitest 非零退出。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: normalize_provider_failure 传入「合法 JSON 但缺 error.code」/「error.code 为空串」/「status 不在枚举」的 result_file → 必须落负向 provider_exit（不得误透传）。
- 码族边界: `CONTRACT_*` 前缀但非核心族（如 `CONTRACT_FOO_BAR`）→ 按既有 derive 分流处理，不新增旁路（PRD 边界 L40）。
- 混合态: codex exit 1 但 turn.completed 且 result 与 last agent message 一致 → 沿用既有 codex 严判逻辑透传成功，不放宽（PRD 边界 L39）。
- 重放一致性: 同一 result_file 连跑 2 次 normalize，输出字节级一致（纯函数，不依赖时钟/随机）。
发现分级: P0/P1（真崩溃被误透传掩盖故障 / 伪造成功信封提权 / 结构化 BLOCKED 仍被埋没）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 整个 Sprint（冻结） | `sprints/08280010-kernel-r79-provider-exit-fidelity/tests/provider-exit-fidelity.test.js` | 保真透传结构化 BLOCKED / 认可 commander-directive/v1 / 合同故障重开 GAN 路径 / 排除 CONTRACT_* 家族 / 无结构化产出的真崩溃仍归一 provider_exit / infrastructure 有界重派 | baseline 3 failed \| 4 passed（RED：r69 埋没 provider_exit、r77 validate 拒 commander 指令、ground-truth 未导出 Set） |
| F1 永久回归（补充） | `tests/gp/f1/step3-provider-exit-fidelity.test.js` | 保真透传 CONTRACT_* / 合同故障重开 GAN / 归因口径排除 CONTRACT_* | baseline 2 failed \| 3 passed（同族 RED 补充锁） |

> Test File 均为完整真实路径（非省略号占位），封印闸 assertTestContractResolvable 可用 CI 同一解析链解析。冻结测试在 `sprints/<本sprint目录>/tests/` 落盘并进 commit（seal + runner finalizer HEAD 树校验）；`tests/gp/f1/` 为补充永久回归行（PRD 要求 5）。

---

## notes

- contract-gate: present（cecelia worktree，已按速查表写 gate-clean 断言）。
- Kernel validation identity late-binding：本合同 E2E/测试无任何 attempt_id/capability_snapshot_id UUID 字面值，纯函数重放不需运行时身份注入（无 HARNESS_* 依赖）。
- 未覆盖真实链路清单：N/A（本合同无 mock 豁免；无第三方 API、无真机段、无 force_* 桩）。
- 版本 bump 四处：packages/brain/package.json（1.273.142→1.273.143）、packages/brain/package-lock.json、.brain-versions、DEFINITION.md「Brain 版本」行，须过 `bash scripts/check-version-sync.sh`。
- 合同边界铁律：可写白名单见 task-plan.json ws1.files；行为变更冲突的既有回归测试若出现须一并 claim 更新（当前无冲突）。
