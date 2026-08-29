# Sprint Contract Draft (Round 1) — 结构化上报保真透传，根除 provider_exit 语义埋没 [r82]

**锚定父路声明**: 覆盖父路 F1「工厂·开发闭环」第 3 步（造完真验）的失败归因分流接缝（与既有 `tests/gp/f1/step3-*.test.js` 同族守卫层）。

**journey_type**: autonomous
**target_environment**: local_api（纯 Brain 内核 orchestrator 数据流 + 回执链路纯函数重放；`runtime_resources.postgres=false`，本 sprint 无真实 DB，采用纯函数可重放 + stub pool 捕获 SQL 文本的既有仓库范式）
**contract-gate**: present (cecelia worktree, packages/brain/src/lib/contract-gate.js 存在，代码层 gate 生效)
**gp-anchor**: skipped (product-map.json not found)

---

## Response Schema（推导来源: PRD 字面 + 实现基线既有消费点，无 HTTP 端点）

N/A — 任务无 HTTP 响应。本 sprint 是 Brain 内核 orchestrator / 回执链路的**纯函数归因分流**改动，不新增/不修改任何 HTTP 端点。验收对象是被改模块导出的纯函数返回值 + 真实 SQL 文本，Reviewer 第 6 维按 [BEHAVIOR] 覆盖判定。

被改模块的**保真契约字段**（非 HTTP，供 codify 参照）：
- 结构化终态对象顶层：`status`（`completed|completed_with_concerns|needs_context|blocked|failed|cancelled`）、`error.code`（字符串，如 `CONTRACT_SELF_CONTRADICTION` / `CONTRACT_TEST_UNSATISFIABLE`）。
- **禁用退化码（保真路径上绝不能出现）**：结构化终态存在时，`error.code` 严禁被覆写为 `provider_exit` / `provider_exit_<n>` 家族。
- 负向路径（无合法结构化产出）保留字段：`status="failed"` + `error.code` 以 `provider_exit` 前缀开头（语义不变）。

---

## Golden Path

[runner/bridge 产出结构化终态] → [回执链路保真透传（不被非零退出码包装成 provider_exit）] → [kernel 归因分流：CONTRACT_* 走合同重开 GAN、不进 failed_targets] → [真崩溃仍按 provider_exit / infrastructure，语义不变]

---

### Step 1: 合同故障——generator/commander 产出结构化 BLOCKED + CONTRACT_*
**来源**: `[FROM_PRD]` — Golden Path 步骤 1（PRD「Golden Path·具体·1」直接定义）

**可观测行为**: 容器内落一份合法结构化 `.brain-result.json`：`status=blocked` + `error.code` 属 `CONTRACT_*` 家族（`CONTRACT_SELF_CONTRADICTION` / `CONTRACT_TEST_UNSATISFIABLE`）。provider CLI 因"blocked"以非零码退出。

**验证命令**:
```bash
# 真读一份结构化 BLOCKED + CONTRACT_* 临时文件喂给回执归因纯函数（真 import 被改模块）
(cd /workspace && npx vitest run sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js -t '回执保真' --reporter=basic)
```
**硬阈值**: 相关 it 全绿；返回对象 `status=blocked` 且 `error.code=CONTRACT_SELF_CONTRADICTION`。

---

### Step 2: 系统处理·保真——回执链路不被非零退出码包装成 provider_exit
**来源**: `[FROM_PRD]` — Golden Path 步骤 2（PRD 要求 1「回执链路保真透传，禁止降级/包装为 provider_exit」）

**可观测行为**: `kernel-attempt-handler.cjs` 的回执归因（`child.once('close')` 决策）在 provider 非零退出时，先尝试解析 `resultPath` 的合法结构化终态；存在即**原样透传**（保 `status` + `error.code`），仅在无合法结构化产出时才回落 `provider_exit_<code>`。抽出纯函数 `resolveProviderTerminalResult({code, resultPath, attemptId})` 承载该判定（回执归因 SSOT，供 close-handler 与守卫共用）。

**验证命令**:
```bash
# 非零退出 + 合法结构化终态 → error.code 保 CONTRACT_*，绝不出现 provider_exit
(cd /workspace && npx vitest run sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js -t '保真透传不被包装成 provider_exit' --reporter=basic)
```
**硬阈值**: it 绿；`error.code` 不匹配 `/^provider_exit/`。

**同源接缝（entrypoint.sh 保真，如需）**: fleet-worker 本地容器路径的等价埋没点在 `docker/cecelia-runner/entrypoint.sh` 的 finalize 逻辑——`provider_success` 仅当 `provider_exit -eq 0` 才为真，非零退出即走 `normalize_provider_failure` 覆写为 `provider_exit`。同 Golden Path 语义修复（非零退出但已落合法结构化 BLOCKED/completed → 保真透传，不覆写）。该接缝为 bash，见「## 接缝清单」与「## 未覆盖真实链路清单」——本轮 RED 冻结测试锚定 JS 回执链路（kernel-attempt-handler），entrypoint.sh 由既有 `docker/cecelia-runner/entrypoint-provider-contract.test.sh` 契约测试兜底，如改必同步更新。

---

### Step 3: 系统处理·分流——CONTRACT_* 不进 failed_targets 黑名单
**来源**: `[FROM_PRD]` — Golden Path 步骤 3（PRD 要求 2「CONTRACT_* 家族不进 failed_targets 黑名单、不按 infrastructure 重试」）

**可观测行为**: `attempt-store.listFailedExecutionTargets` 发往 Postgres 的 SQL 在既有"两条 worker 码排除 + 时效窗口"基础上，**新增排除 CONTRACT_* 家族**（`error_code NOT LIKE 'CONTRACT_%'` 或 NOT IN 列举）。合同故障的 target 因此不被 preflight 拉黑，避免 `all_execution_targets_exhausted` 死等。

**验证命令**:
```bash
# 真 createAttemptStore + stub pool 捕获真实 SQL 文本，断言排除 CONTRACT_* 家族
(cd /workspace && npx vitest run sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js -t 'failed_targets 采集排除 CONTRACT' --reporter=basic)
```
**硬阈值**: it 绿；SQL 含 `NOT LIKE 'CONTRACT` 家族前缀排除或 `NOT IN(...CONTRACT_SELF_CONTRADICTION...)`；且时效窗口 `created_at >= NOW() - make_interval` 谓词保留（记仇语义回归保护）。

---

### Step 4: 可观测结果·正路——保留 error_code、重开 GAN、target 不被拉黑
**来源**: `[FROM_PRD]` — Golden Path 步骤 4（PRD「可观测结果·正路」）

**可观测行为**: error_code 保真为 CONTRACT_* 后，既有 kernel 归因分流（`derive.js` 的 `CONTRACT_FAULT_CORE_TOKENS` 子集匹配 → `ARBITRATE_CONTRACT_FAULT` / `REOPEN_GAN_CONTRACT`；`attempt-store` 摄入以 `error_code` 保真落库）自动生效，无需改 derive 路由——本 sprint 只补上游"保真 + 不拉黑"缺口。

**验证命令**:
```bash
# 摄入侧 error_code 保真落库路径回归：既有 error_code slice(0,64) 消费点不回退
(cd /workspace && npx vitest run sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js --reporter=basic)
```
**硬阈值**: 整份冻结测试全绿。

---

### Step 5: 触发条件·真崩溃（负向）——provider 进程真崩溃，无结构化产出
**来源**: `[FROM_PRD]` — Golden Path 步骤 5（PRD 要求 3 + 边界「.brain-result.json 缺失/损坏 → 视同无结构化产出」）

**可观测行为**: `resultPath` 缺失或 schema 不合法（无法 `parseHarnessResult`）→ 视同无结构化产出。

---

### Step 6: 可观测结果·负路——仍归 provider_exit / infrastructure，语义不变
**来源**: `[FROM_PRD]` — Golden Path 步骤 6（PRD 要求 3「负向语义不变」+「不动 provider 真崩溃黑名单语义」）

**可观测行为**: `resolveProviderTerminalResult` 在无合法结构化产出时回落 `{status:failed, error.code:provider_exit_<code>}`；下游 `parseHarnessResult`/`listFailedExecutionTargets` 照旧把它归 runner/infrastructure、进重试/黑名单，**语义零回归**。

**验证命令**:
```bash
# 负向：文件缺失/损坏 + 非零退出 → 仍 provider_exit（不冒充 CONTRACT）
(cd /workspace && npx vitest run sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js -t '负向不回退' --reporter=basic)
```
**硬阈值**: 两条负向 it 全绿；缺失路径 `error.code` 匹配 `/^provider_exit/`；损坏路径 `error.code` 不匹配 `/^CONTRACT_/`。

---

## 已知约束（来自回归测试 + 累积 FR）

- `[回归]` `tests/gp/f1/step3-failed-target-ttl.test.js` → listFailedExecutionTargets 时效窗口豁免（`created_at >= NOW() - make_interval(hours => $3)`，默认 2h，`HARNESS_FAILED_TARGET_TTL_HOURS` 可配）——本次新增 CONTRACT_* 排除**不得**破坏该时效窗口谓词与 `[runId, role, ttlHours]` 参数序。
- `[回归]` `tests/gp/f1/step3-runner-failure-retry.test.js` → runner_failure 有界重派（≤2 次）——负向路径（provider_exit → runner/infra 分类）语义不得回退。
- `[回归]` `packages/brain/src/orchestrator/derive.js` `CONTRACT_FAULT_CORE_TOKENS` 子集匹配（SELF∧CONTRADICTION / TEST∧UNSATISFIABLE / CI∧CONFLICT）+ 仲裁制 `ARBITRATE_CONTRACT_FAULT` → `REOPEN_GAN_CONTRACT`（每 run 一次）——本 sprint 依赖其不变，只保证 error_code 保真喂到它面前。
- `[回归]` `docker/cecelia-runner/entrypoint-provider-contract.test.sh` → entrypoint provider 契约——若改 entrypoint.sh finalize，须同步该契约测试。
- `[累积FR]` context-manifest: unavailable（本地无 Brain API，`journey_id=e6f803f2` 累积 FR 端点不可达，按 PRD「本 line 暂无已验收 ability」处理）。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 系统对外承诺做什么 | 执行体产出结构化终态（success JSON / 结构化 BLOCKED + CONTRACT_*）时回执链路保真透传；kernel 的 failed_targets 采集排除 CONTRACT_* 家族 |
| **NFR（做得多好）** | 性能/可靠性阈值 | 纯函数，无 IO 阻塞；version 四处同步 bump（check-version-sync 通过）；无新增延迟/频控（PRD 未指定，标待定） |
| **Invariant（永不违反）** | 不变量 | ①归因保真：结构化终态存在时 error_code 不得被 provider_exit 埋没；②负向零回归：无结构化产出的真崩溃仍 provider_exit/infrastructure；③RED 纯净：Red commit 只 git add 精确 `*.test.js`；④结果契约：`.brain-result.json` 顶层含 exit_code+log_tail+behavior_tests[] |
| **判定点（怎么知道）** | 对模糊现实的判断 | 见「判定点登记表」 |
| **保质期（何时过期）** | 何时失效 | 无 token/数据保质期；语义规则随 CONTRACT_* 家族定义演进（以 attempt-store 既有消费点为准） |
| **死亡告警（停了谁知道）** | 停摆谁知道 | 回执归因回退时 attempt error_code 落库；kernel 归因分流失败 → derive 挂人审（既有 WAIT_HUMAN_REVIEW 路径），常驻监工值守 |
| **失败语义（挂了怎么办）** | 故障放行/拦截 | 见「失败语义声明」 |
| **效果确认（已发≠已生效）** | 回执确认 | 保真：返回对象 status+error.code 即真实生效证据；负向：provider_exit 前缀即回落证据；均由冻结测试断言 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 聊天记录 API 不稳定 | 静默丢消息 |
| ⚠️ 结构化终态是否"合法存在"（决定保真 vs 回落 provider_exit） | A. 文件存在即信; B. `parseHarnessResult` schema 校验通过才信 | B. schema 校验通过才信 | 文件存在≠合法；损坏/半写文件按 A 会冒充合同故障，掩盖真崩溃 | 误把真崩溃当合同故障 → 不拉黑坏 target、错重开 GAN（面客错误族） |
| ⚠️ error_code 是否属 CONTRACT_* 家族（决定是否排除黑名单） | A. 精确列举已知码; B. `CONTRACT_` 前缀家族匹配（NOT LIKE 'CONTRACT_%'） | B. 前缀家族匹配（列举作补充） | 家族会新增码（如 CONTRACT_CI_SCOPE_CONFLICT），精确列举会漏新码 | 漏码 → 新 CONTRACT 码 target 仍被拉黑，退回原病族 |

> `judgment-pending-user`: 两条 ⚠️ 判定点（结构化合法性判据、CONTRACT_* 家族匹配口径）在 PrepPRD/对齐会未显式拍板，proposer 按实现基线既有消费点（`parseHarnessResult` schema + `CONTRACT_` 前缀）保守取值，如主理人有更严口径可在 Reviewer 轮或人审调整。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| `parseHarnessResult` 解析抛错（文件缺失/损坏） | 回落 `{status:failed, error.code:provider_exit_<code>}` | 是（纯函数，同输入同输出） | 落负向路径，进既有重试/黑名单（语义不变） |
| provider 非零退出但结构化终态合法 | 保真透传结构化终态（status+error.code 原样） | 是（纯函数可重放） | 无降级——保真是正路 |
| provider 退出码 124（超时） | 既有 `provider_timeout` 语义保留（本 sprint 不动超时分支） | 是 | infrastructure_blocked 分类不变 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本 sprint 无对外暴露 agent。输入源是 runner 容器内自产的 `.brain-result.json`（受信任的自身产物）+ provider 退出码（整数）。`resolveProviderTerminalResult` 对损坏/半写/非法 schema 文件安全回落 `provider_exit`（不 crash、不冒充 CONTRACT），已由冻结测试的"损坏"负向条覆盖。

---

## 禁 mock 边清单

本单改动涉及**跨模块数据传递**（回执链路：runner 结构化终态 → kernel 归因）与 **DB 读路径**（failed_targets 采集查询），故：

- 回执归因边（provider 退出码 + resultPath → 终态归因）：`kernel-attempt-handler.cjs` 真 require，真读临时 `.brain-result.json` 真文件——**禁** mock `resolveProviderTerminalResult` / `parseHarnessResult` / `fs`。
- 失败目标采集边（attempt-store ↔ Postgres）：`attempt-store.js` 真 `createAttemptStore`，只允许 stub **最外层** pg pool 捕获真实 SQL 文本（决策 109dd8eb 既有范式，SQL 文本 = 真实模块行为，非源码文本自证）——**禁** mock attempt-store 自身或其查询构造。

（本单纯 Brain 内核，无真机/UI；DB 真写路径本 sprint 不触及，采集为**读**查询，postgres:false 下用 stub pool 捕获 SQL 是本仓库对该读边的既定守卫法。）

---

## 接缝清单（接缝 vs 逻辑）

| # | 接缝点 | 类型 | 真目标验证方式 | done 判定 |
|---|--------|------|----------------|-----------|
| 1 | kernel-attempt-handler 回执归因（退出码↔结构化终态） | 逻辑（纯函数，环境无关） | 冻结测试真 require + 真读临时文件 | 绿 = 真 done |
| 2 | attempt-store failed_targets 采集 SQL | 逻辑（SQL 文本，环境无关） | stub pool 捕获真实 SQL 文本断言谓词 | 绿 = 真 done |
| 3 | entrypoint.sh finalize 保真（fleet-worker 本地容器路径，如改） | 接缝（bash，容器真机路径） | `entrypoint-provider-contract.test.sh` 契约测试 | 若本轮改 entrypoint.sh，须该契约测试真跑绿；未改则标 `logic-done-pending` 见未覆盖清单 |

---

## 未覆盖真实链路清单

- **entrypoint.sh finalize 保真（fleet-worker 本地容器路径）**｜为什么：本 sprint RED 冻结测试锚定 JS 回执链路（`kernel-attempt-handler.cjs`，codex-bridge 远程路径），可纯函数重放；`docker/cecelia-runner/entrypoint.sh` 是 bash，不在 vitest 可 import 范围，无法进 `tests/gp/f1/` 纯函数冻结测试｜真验证补位计划：如生成阶段判定需同步修 entrypoint.sh finalize（`provider_success` 仅 `provider_exit -eq 0` 的埋没点），必须同步更新并跑绿既有 `docker/cecelia-runner/entrypoint-provider-contract.test.sh` 契约测试（谁：generator；何时：本 sprint 内；环境：容器 bash 契约测试）。若本轮判定 entrypoint 无需改（JS 回执链路修复已覆盖 codex-bridge 路径），显式在 PR 描述标 `entrypoint-fidelity: logic-done-pending（本轮未改，fleet-worker 本地路径由后续台账跟进）`。
- 其余链路无 mock 豁免（回执归因与 SQL 采集均真零件真验）。

---

## E2E 验收（final-e2e 跑 — target_environment=local_api，纯函数可重放）

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 无真实 DB（postgres:false）、无 HTTP 端点、无 provider 进程——E2E 为纯函数可重放：从仓库根跑 sprints/** 与 tests/** 冻结测试（vitest 工作目录死规则：sprints/**、tests/** 允许从根跑），断言 RED→GREEN + 负向不回退 + 版本四处同步。被改的 `packages/brain/src/**`、`packages/brain/scripts/**` 由冻结测试真 import 驱动，不从根直接 `vitest run packages/**`。

```bash
#!/bin/bash
set -euo pipefail
cd /workspace

# 1. 保真 + 分流 + 负向：冻结 sprint 测试（真 import 被改模块，纯函数可重放）
npx vitest run sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js --reporter=basic

# 2. F1/step3 companion 守卫（PRD 指定 tests/gp/f1/ 位置，真 import 同两条边）
npx vitest run tests/gp/f1/step3-contract-fault-fidelity-not-provider-exit.test.js --reporter=basic

# 3. 负向零回归定点复核：真崩溃仍 provider_exit（无结构化产出）
npx vitest run sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js -t '负向不回退' --reporter=basic

# 4. 版本四处同步（package.json SSOT / package-lock.json / .brain-versions / DEFINITION.md）
bash scripts/check-version-sync.sh

echo "✅ r82 Golden Path 保真透传验证通过（保真 + CONTRACT_* 不拉黑 + 负向零回归 + 版本同步）"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `resolveProviderTerminalResult` 传 `code=0` + 损坏 resultPath（成功退出但结果非法）——应回落 `provider_result_invalid`，不冒充 completed
- 重复提交: 同一 resultPath 连调两次，纯函数须同输入同输出（可重放）
- 中途中断: resultPath 指向半写文件（合法 JSON 但缺 provider_metadata）——schema 校验须判非法 → 负向
- 边界值: `error.code` 恰为 `CONTRACT`（无下划线后缀）/ 空字符串 / 超 64 字符——家族匹配与 attempt-store slice(0,64) 边界
- CONTRACT 家族新码: `CONTRACT_CI_SCOPE_CONFLICT` 是否同样被 NOT LIKE 'CONTRACT_%' 排除出黑名单（前缀家族匹配口径）
发现分级: P0/P1（真崩溃被当合同故障 / CONTRACT target 仍被拉黑 / 负向回退）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞
