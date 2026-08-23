# Sprint Contract Draft (Round 1)

**Sprint**: capability preflight failed_targets 时效窗口豁免（记仇不跨修复期）
**journey_type**: autonomous
**target_environment**: local_api（postgres:false — 本 attempt 无真库，改动为 SQL 文本 + env 解析，用 vitest mock pool 逐字锁定发往 Postgres 的 SQL 与绑定参数）
**contract-gate**: present（cecelia worktree，走代码层 Contract Gate + skill 内置规则）
**map**: `[MAP_NOT_CONFIGURED]` — payload.map_scope=["F1"] 但 map_repo 缺失，radius 无法解析，must_run_assertions 为空，不回退领域硬编码。
**gp-anchor**: skipped (product-map.json not found)

## 锚定父路声明

独立小路（无父路）—— journey e6f803f2 下 ability 均 status=planned，step_id=none（PrepPRD 未锚定），本 sprint 为 harness dispatch 基础设施单点修复。

---

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。本 sprint 改动为 `attempt-store.js` 内部 DB 读查询 `listFailedExecutionTargets(runId, role)` 的 SQL WHERE 条件与绑定参数，无对外 HTTP endpoint。Reviewer 第 6 维按下方 Test Contract / BEHAVIOR 的可执行断言完整性审查。

---

## Golden Path

[preflight 收集 failed_targets] → [listFailedExecutionTargets 按时效窗口统计最近失败] → [窗口外陈旧失败不再拉黑目标 / 窗口内新鲜失败记仇不变]

### Step 1: dispatcher 调 `listFailedExecutionTargets(runId, role)` 收集 failed_targets
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 条（dispatcher 调该查询供 preflight）。

**可观测行为**: 该函数向 `harness_attempts` 发出一条参数化 SQL，返回 `{provider, account, machine}` 目标列表。

**验证命令**:
```bash
# 冻结测试断言实际发往 pool.query 的 SQL 形态与返回映射（mock pool，repo 既有范式）
npx vitest run sprints/08230906-kernel-15338469/tests/failed-target-ttl.test.ts \
  -t "窗口内失败记录仍映射为执行目标保持记仇语义不变" 2>&1 | grep -qE "[1-9][0-9]* passed"
```
**硬阈值**: 返回行逐字映射 `{provider, account: account_id, machine: requested_machine_id}`，映射语义不变。

---

### Step 2: 查询只统计最近 N 小时（默认 2h，可 `HARNESS_FAILED_TARGET_TTL_HOURS` 配置）内失败记录
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 条 + 「范围限定/在范围内」（增加基于 `created_at` 的时效窗口过滤；读 env 默认 2）。

**可观测行为**: SQL WHERE 新增 `AND created_at >= NOW() - make_interval(hours => $3)`，第三个绑定参数为解析后的 TTL 小时数（默认 2；env 覆盖；非法值回退 2）。

**验证命令**:
```bash
# 默认 2h：SQL 含 created_at 时效窗口 + 第三参数为 2
npx vitest run sprints/08230906-kernel-15338469/tests/failed-target-ttl.test.ts \
  -t "默认 2 小时窗口经 created_at make_interval 过滤且第三参数为 2" 2>&1 | grep -qE "[1-9][0-9]* passed"
# env 覆盖：HARNESS_FAILED_TARGET_TTL_HOURS=5 → 第三参数为 5
npx vitest run sprints/08230906-kernel-15338469/tests/failed-target-ttl.test.ts \
  -t "覆盖窗口小时数进第三参数" 2>&1 | grep -qE "[1-9][0-9]* passed"
```
**硬阈值**: `pool.query` 首调 SQL 匹配 `/created_at\s*>=\s*NOW\(\)\s*-\s*make_interval\s*\(\s*hours\s*=>\s*\$3\s*\)/i`，params 默认 `[runId, role, 2]`，env=5 时 `[runId, role, 5]`。

---

### Step 3: 陈旧失败（窗口外）不再拉黑；新鲜失败（窗口内）记仇语义不变
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 条可观测结果 + 「边界情况」窗口内含语义 + 「Invariant 约束」记仇窗口内不变。

**可观测行为**:
- 窗口边界采用「窗口内含」（`>=`）语义，不写成 `>`。
- 非法 TTL env（如 `not-a-number`）回退默认 2h。
- 窗口内失败记录仍映射为目标（记仇不变），映射与既有 error_code 豁免逻辑叠加生效。

**验证命令**:
```bash
npx vitest run sprints/08230906-kernel-15338469/tests/failed-target-ttl.test.ts \
  -t "窗口内含语义使用大于等于比较" 2>&1 | grep -qE "[1-9][0-9]* passed"
npx vitest run sprints/08230906-kernel-15338469/tests/failed-target-ttl.test.ts \
  -t "回退默认 2 小时" 2>&1 | grep -qE "[1-9][0-9]* passed"
```
**硬阈值**: SQL 含 `created_at >=` 且不含 `created_at > NOW`；非法 env 第三参数回退 2；既有 `error_code NOT IN (...)` 与 `status IN ('failed','cancelled')` 分支保持不变。

---

## 已知约束（来自回归测试 + 累积 FR）

- [packages/brain/src/orchestrator/__tests__/attempt-store.test.js → `按 hop 顺序暴露同 run/role 的终态失败执行目标`] — 既有 SQL 分支（status IN failed/cancelled、blocked+infrastructure_blocked、error_code NOT IN 豁免清单）不得回退；本 sprint 仅在其上叠加 created_at 窗口 + 第三参数，故该既有断言同步更新为 `[runId, role, 2]`。
- [累积FR] （本 line 暂无已验收行为历史；context-manifest: not queried — journey ability 均 planned）
- [MAP_NOT_CONFIGURED] must_run_assertions 为空（map_repo 缺失），无额外回归约束注入。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | `listFailedExecutionTargets` 只统计最近 N 小时内 `created_at` 的失败记录；窗口外旧失败不计入 failed_targets |
| **NFR（做得多好）** | 非功能 | 配置项 `HARNESS_FAILED_TARGET_TTL_HOURS`（默认 2h）；不新增副作用；沿用现有查询性能特征（同表同索引，仅多一个 created_at 谓词） |
| **Invariant（永不违反）** | 不变量 | ①窗口内记仇语义不变（连续新鲜失败仍轮换/耗尽）②既有 error_code 豁免清单叠加生效不变 ③返回映射 `{provider,account,machine}` 不变 |
| **判定点（怎么知道）** | 模糊现实判断 | 见下方登记表 |
| **保质期（何时过期）** | 失效 | 失败记录对目标拉黑的效力保质期 = TTL 窗口（默认 2h）；窗口外自动退役，无需人工 psql 改 error_code |
| **死亡告警（停了谁知道）** | 告警 | 沿用现有 preflight `all_execution_targets_exhausted` 路径；本改动降低误触发该死等（不新增告警通道，N/A 新告警） |
| **失败语义（挂了怎么办）** | 故障 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执 | 效果由冻结测试断言实际发往 pool.query 的 SQL 文本 + 绑定参数确认；真 Postgres 运行时窗口过滤属接缝（见未覆盖真实链路清单） |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读取聊天记录 API | A | 聊天记录 API 不稳定 | 静默丢消息 |
| 失败记录是否算「陈旧」 | A. created_at 早于 NOW()-TTL; B. updated_at 早于 NOW()-TTL | A. created_at | PRD/ASSUMPTION 明确 created_at 为失败写入时刻（attempt-store.js:1086 已引用）；窗口内含用 `>=` | 若误用 updated_at 或错边界，陈旧失败仍拉黑（回归原 bug）或新鲜失败被漏统计（记仇失效） |
| 非法 TTL env 如何处置 | A. 回退默认 2h; B. 抛错阻断 preflight | A. 回退 2h | PRD ASSUMPTION：解析非法值时回退默认 2h，preflight 不因配置错误死等 | 若抛错则配置手滑即全线阻断（比原 bug 更糟） |

> 无 ⚠️ 级（本次判定点误判后果为「回归原 bug」，非不可逆/直接面客；且 created_at 语义由 PRD ASSUMPTION 拍定，无需升拍板）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| `HARNESS_FAILED_TARGET_TTL_HOURS` 非法/未设置 | 回退默认 2h，查询正常执行 | 是（纯读，无副作用） | 默认值兜底 |
| pool.query 抛错（DB 不可达） | 异常向上抛（沿用现有行为，不吞错） | 是（纯读幂等） | 由 dispatcher 既有错误处理接管，本 sprint 不改 |
| 空结果集（无失败记录） | 返回 `[]`，preflight 正常派发 | 是 | 行为不变 |

### 输入对抗面

N/A — 本改动为 Brain 内部后台查询，无对外暴露 agent 输入面（runId/role 由 dispatcher 内部传入，env 由运维配置）。

---

## 禁 mock 边清单

本单改动触及 **DB 读路径**（`harness_attempts` 表的 `listFailedExecutionTargets` 查询 SQL）。

- 代码 ↔ DB 表 `harness_attempts`（本单改写该表读查询的 WHERE 时效窗口 + 绑定参数）

**执行说明（诚实登记）**：本 attempt `runtime_resources.postgres=false`，无真库可跑集成测试；repo 既有 `attempt-store.test.js` 对本函数的既定范式即「mock pool + 断言实际 SQL 文本与绑定参数」。本 sprint 沿用该范式：冻结测试逐字锁定发往 Postgres 的 SQL（`created_at >= NOW() - make_interval(hours => $3)`）与 params（`[runId, role, ttlHours]`），使被改的边以「SQL 契约」形式被固定——generator 任何绕过（如把窗口写进 JS 侧过滤、改列名、改边界符）都会被 SQL/params 断言逐字抓到。真 Postgres 对该 SQL 的运行时行为（make_interval 语义、created_at 窗口实际筛选真实行）登记进「## 未覆盖真实链路清单」，由后续带库环境补位。

---

## 未覆盖真实链路清单

| 真实链路点 | 为什么被 mock 顶替 | 真验证补位计划（谁/何时/什么环境） |
|-----------|-------------------|-----------------------------------|
| 真 Postgres 执行 `created_at >= NOW() - make_interval(hours => $3)` 对真实 3h-前/2h-内失败行的筛选 | 本 attempt runtime_resources.postgres=false，无真库；改动本身限于 SQL 文本 + env 解析，冻结测试以 mock pool 逐字锁定 SQL 契约已能抓住所有 JS 侧偏移 | Commander/evaluator 在带 Postgres 的 brain-integration job（或本地 localhost:5221 真库）造 created_at=NOW()-3h 与 NOW()-30m 两条 status=failed 记录，实跑该查询断言仅后者返回；本 sprint 合同已把该断言以自然语言写入 E2E 期望供带库时通电 |

> 本清单存在未真验项：make_interval/created_at 窗口的**运行时**筛选标 `logic-done-pending`，逻辑层（SQL 契约 + env 解析）由冻结测试真验为 done。

---

## Invariant 覆盖映射（PRD 铁律 → 可执行断言）

- INV-1 [记仇窗口内不变]：由 BEHAVIOR B-05（窗口内失败记录仍映射为执行目标）+ B-06（既有终态失败执行目标 SQL 分支不回退）覆盖。
- INV-2 [generator 重试身份 / planner 分支 / Brain URL 权威]：N/A — 本 sprint 只改 `listFailedExecutionTargets` 单查询，不触及 generator 重试身份、planner 分支签发、Brain URL 解析模块。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认；本 sprint 为单查询低风险改动）
高风险面:
- 错输入: `HARNESS_FAILED_TARGET_TTL_HOURS` 传 `0`/`-1`/`3.5`/`"2h"`/超大值 `999999` — 断言均回退或安全取整，不产出非法 interval。
- 重复提交: 连续多次调 `listFailedExecutionTargets` — 纯读幂等，返回一致。
- 中途中断: env 在进程运行中变更 — 每次调用重新读 env（非模块加载期固化），窗口随配置生效。
- 边界值: created_at 恰好 = NOW()-TTL 边界 — 窗口内含（`>=`）语义，边界记录计入。
发现分级: P0/P1（陈旧失败仍拉黑 / 新鲜失败漏统计导致记仇失效）→ 阻塞 merge；P2/P3（日志/措辞）→ 记 findings 不阻塞

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api（postgres:false → vitest 单测；真 Postgres 窗口筛选见未覆盖真实链路清单）

> 说明：本 attempt 无真库，E2E 以 vitest 跑冻结 sprint 测试 + repo 既有 attempt-store 全套。
> vitest 工作目录死规则：sprints/** 从仓库根跑；packages/brain/src/** 用子 shell 切进包根跑（包自身 vitest 配置）。
> `-t` 过滤下断言统一用 `grep -qE "[1-9][0-9]* passed"` 宽松式（禁精确 `(N)` 尾缀）。

```bash
#!/bin/bash
set -euo pipefail

# 1. 冻结 sprint 测试（时效窗口豁免核心断言）从仓库根跑（sprints/** 命中根 vitest include）
OUT1=$(npx vitest run sprints/08230906-kernel-15338469/tests/failed-target-ttl.test.ts 2>&1) || true
echo "$OUT1" | grep -qE "[1-9][0-9]* passed" || { echo "FAIL: 冻结 sprint 测试未全绿"; echo "$OUT1" | tail -20; exit 1; }

# 2. repo 既有 attempt-store 全套（含更新后的终态失败执行目标断言 + 新增时效窗口回归）用包自身 vitest 配置
OUT2=$( (cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/attempt-store.test.js) 2>&1 ) || true
echo "$OUT2" | grep -qE "[1-9][0-9]* passed" || { echo "FAIL: repo attempt-store 测试未全绿"; echo "$OUT2" | tail -20; exit 1; }

echo "OK: 时效窗口豁免 E2E 验证通过"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 时效窗口豁免核心（冻结，强制） | `sprints/08230906-kernel-15338469/tests/failed-target-ttl.test.ts` | `默认 2 小时窗口经 created_at make_interval 过滤且第三参数为 2` / `覆盖窗口小时数进第三参数` / `回退默认 2 小时` / `窗口内含语义使用大于等于比较` / `窗口内失败记录仍映射为执行目标保持记仇语义不变` | 5 tests → 4 failed \| 1 passed（B-05 为记仇不变回归守卫，RED/GREEN 均绿；其余 4 条 RED） |
| repo 既有查询回归（补充行） | `packages/brain/src/orchestrator/__tests__/attempt-store.test.js` | `终态失败执行目标`（既有断言更新为含第三参数 2） / `覆盖进 SQL 第三参数`（新增 TTL 回归） | 2 tests → 2 failed（第三参数断言 + created_at 窗口断言均对当前无窗口代码失败） |

> Test File 列为完整真实路径（无省略号）。冻结 sprint 测试落盘并进 commit；repo 既有测试为补充行。
> BEHAVIOR 覆盖名逐词取自对应测试文件真实 `it()` 名子串，`grep -F '<覆盖名>' <test file>` 必命中。
