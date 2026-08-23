# Sprint Contract Draft (Round 2)

## 实现基线与证据来源

- 权威实现基线：`perfectuser21/cecelia@a2cebdf64bcc60bac00fd9cb21c6fa1940a23aff`（冻结；不得被本角色 checkout SHA 替换）。
- 本角色 checkout 仅用于选择合同起草工作树；其 SHA 不构成、也不替换权威实现基线。
- PRD：`sprints/08240330-kernel-r62-validation-clock/sprint-prd.md` 与 bundle `thin_prd`。
- 代码事实：`packages/brain/src/orchestrator/validation-clock.js` 当前按 hop 取首个 Generator action 作为固定原点。
- Unified Map：`[MAP_NOT_CONFIGURED]`，payload 未提供 `map_scope/map_repo`；无 `must_run_assertions`。
- context-manifest：PRD 已声明本 line 暂无累积 FR。
- fact revisions / freshness：bundle 未提供，按上述冻结 SHA 与本轮读取结果留证。
- contract-gate：适用，`packages/brain/src/lib/contract-gate.js` 存在。

## Response Schema（推导来源: PRD字面）

N/A — 任务仅修改内部纯函数，无 HTTP 响应或 DB schema。

## 已知约束（来自回归测试）

- `packages/brain/src/orchestrator/__tests__/validation-clock.test.js` → 首次 Generator 建立共享窗口；下游无时钟 fail-closed；verified existing-PR evaluator 原点保持；畸形持久化时钟拒绝。
- `[累积FR]` 本 line 暂无历史行为。
- Brain 行为改动须同步 `packages/brain/DEFINITION.md` 版本；默认 `timeout_seconds=5400` 与人审 deadline 不变。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | `resolveValidationClock` 按 hop 识别成功落盘的 `spawn:generator-fix`，前 6 次各刷新原点，第 7 次起不再刷新。 |
| NFR（做得多好） | 纯函数、相同 decision-log 输入确定重放；默认 5400 秒不变。 |
| Invariant（永不违反） | validation clock 继续 fail-closed；无 fix 语义不变；不修改人审 deadline；不改变派发身份。 |
| 判定点（怎么知道） | 以 decision log 中 action 字面值和 hop 排序为唯一判断。 |
| 保质期（何时过期） | 随 validation clock 行为版本长期生效；未来 action schema 变化时由 Brain 维护者复核。 |
| 死亡告警（停了谁知道） | Sprint Tests/required CI 在回归失败时立即通知 PR 作者。 |
| 失败语义（挂了怎么办） | 缺失/畸形原点继续抛出既有 validation clock 错误，禁止放行。 |
| 效果确认（已发≠已生效） | 直接 import 真模块，以 deadline 与观察时刻比较，证明 r50 存活及超限判死。 |

### 判定点登记表

（本任务无真实世界接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 无 Generator validation origin | 保持 `validation_clock_required` | 是 | 无，fail-closed |
| 持久化 clock 畸形 | 保持 `validation_clock_invalid` | 是 | 无，fail-closed |
| fix 次数超过 6 | 固定使用第 6 次原点，不采纳后续 fix | 是 | deadline 已过则照常判死 |

### 输入对抗面

N/A — 不新增对外 agent 或外部用户输入接口。

gp-anchor: skipped (product-map.json not found)

## 真实调用方请求 shape

N/A — 本 sprint 无设备、agent 或 webhook 请求 shape；输入是 loop.js 已读取的 `orchestrator_decision_log` 行 `{hop, action, created_at, detail}`。

## 禁 mock 边清单

- `resolveValidationClock` ↔ `orchestrator_decision_log` 行时序：冻结测试必须直接 import 真 `packages/brain/src/orchestrator/validation-clock.js`，用真实 row shape 驱动，不得 mock 模块或排序边。
- `loop.js` ↔ 真 PostgreSQL decision log 查询/派发落盘：本 sprint 不改 loop/DB 写路径，作为未覆盖接缝登记，不得宣称已真验。

## 未覆盖真实链路清单

| 未覆盖点 | 原因 | 补位计划 |
|---|---|---|
| `loop.js` 从真 PostgreSQL 读取 decision log，再把 clock 写回派发行 | PRD 明确本 sprint 聚焦纯函数且将真库 loop.js 集成列为余留；本 attempt 也未注入 Postgres | 后续 kernel integration sprint 在 attempt 级真库运行 loop 并核对落盘 clock；本 sprint 仅可标 `logic-done-pending`，不可标接缝 done |

本合同无 force/stub/假数据豁免；测试中的 decision-log 数组是纯函数的正式输入，不替换被改模块。

## 接缝清单

- `loop.js ↔ PostgreSQL orchestrator_decision_log`：真实目标验证尚未纳入本 sprint，状态为 `logic-done-pending`；补位方式见“未覆盖真实链路清单”。

## Golden Path

覆盖父路 `factory/F1 造完真验` 的 validation clock 判定步骤。

[decision log hop 时序] → [识别前 6 次 fix] → [最近合法 fix 刷新 clock] → [存活/判死确定输出]

### Step 1: 读取并按 hop 解释 validation decision log
**来源**: `[FROM_PRD]` — “纯函数可重放：只依赖 orchestrator_decision_log 行 hop 时序”。

**可观测行为**: 相同内容即使数组顺序不同，按 hop 得到相同 clock。

**验证命令**:
```bash
npx vitest run --no-cache tests/gp/f1/validation-clock-fix-extension.test.ts -t '前 6 次成功 fix 均按 hop 选择最近一轮作为新原点'
```
**硬阈值**: exit code = 0；第 6 次 fix 的 ISO 时间为 `pipeline_started_at`。

### Step 2: r50 型健康长跑以最近 fix 重算 deadline
**来源**: `[FROM_PRD]` — “复刻 r50 场景 → 旧判死/新存活”。

**可观测行为**: 原 generator deadline 已过但最近合法 fix deadline 未过时，输出新原点且 deadline 晚于观察时刻。

**验证命令**:
```bash
npx vitest run --no-cache tests/gp/f1/validation-clock-fix-extension.test.ts -t 'r50 型长跑在最近成功 fix deadline 内保持存活'
```
**硬阈值**: exit code = 0；原点 `02:00Z`，deadline `03:30Z`，观察时刻 `02:30Z`。

### Step 3: 有界顺延止于第 6 次
**来源**: `[FROM_PRD]` — “顺延有界：上限 6 次，超限照常判死”。

**可观测行为**: 含第 7 次 fix 的日志仍固定采用第 6 次原点，过期时判死。

**验证命令**:
```bash
npx vitest run --no-cache tests/gp/f1/validation-clock-fix-extension.test.ts -t '第 7 次 fix 不再顺延并按第 6 次 deadline 判死'
```
**硬阈值**: exit code = 0；原点必须为 `06:00Z` 且 deadline ≤ `07:45Z`。

### Step 4: 零 fix 运行保持既有语义
**来源**: `[FROM_PRD]` — “负向：无 fix 轮语义不变”。

**可观测行为**: 零 fix 仍使用初始 generator 原点，重新构造等价输入可重放同一结果。

**验证命令**:
```bash
npx vitest run --no-cache tests/gp/f1/validation-clock-fix-extension.test.ts -t '无 fix 轮语义不变且相同 hop 输入可确定重放'
```
**硬阈值**: exit code = 0；原点 `00:00Z`、deadline `01:30Z`，两次结果深相等。

## 铁律映射

- INV-1 原派发身份：N/A，本 sprint 不改 dispatcher/派发 action。
- INV-2 validation clock fail-closed：既有 validation-clock 测试必须全绿。
- INV-3 local_api 验证真相：直接 import 真纯函数并断言 clock，不用 meta health/API 替代。
- INV-4 证据前置：RED 与 GREEN 命令 exit code 写入 evaluator evidence。
- INV-5 命令真跑：冻结测试命令由 proposer 已执行并取得 RED exit 1；Evaluator 必执行取得 GREEN exit 0。
- INV-6 Test Contract：固定四列且真实路径位于 Test File 列。
- INV-7 RED 精确提交：Generator 的 RED commit 仅包含冻结测试路径。
- INV-8 毕业门禁：执行 TDD commit-order 与 test-coverage required CI。
- INV-9 真实接缝：loop.js 真库接缝登记余留，未标 done。
- INV-10 环境假设：时间、hop、timeout 均来自函数输入，无运行环境硬编码。
- INV-11 凭据安全：N/A，无凭据。
- INV-12 日志脱敏：N/A，无 PII/聊天内容。
- INV-13 单会话串行：task-plan 仅 ws1。
- INV-14 Planner 分支：保留服务端签发分支，不更改 planner 分支。

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
SPRINT_TEST='tests/gp/f1/validation-clock-fix-extension.test.ts'
test -f "$SPRINT_TEST"
npx vitest run --no-cache "$SPRINT_TEST" --reporter=verbose
(cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/validation-clock.test.js --reporter=verbose)
git diff --exit-code a2cebdf64bcc60bac00fd9cb21c6fa1940a23aff -- packages/brain/src/orchestrator/loop.js
node -e "const p=require('./packages/brain/package.json');const fs=require('fs');const d=fs.readFileSync('./packages/brain/DEFINITION.md','utf8');if(!d.includes(p.version))process.exit(1)"
```

通过标准：全部命令 exit code = 0；冻结测试 4/4 通过；既有 validation-clock 回归通过；loop.js 相对权威实现基线无改动；Brain 版本与 DEFINITION 同步。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: fix 行缺失/非法 `created_at` 时保持既有 invalid 失败语义。
- 重复提交: 重复 hop 或乱序输入不得使结果依赖数组顺序。
- 中途中断: N/A，纯函数无中断态。
- 边界值: 0、1、6、7 次 fix；非连续 hop；timeoutSeconds 非法值。
发现分级: P0/P1（错误延长或误杀活跃 run）阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | BEHAVIOR 覆盖 | Test File | 预期红证据 |
|---|---|---|---|
| r50 存活 | `r50 型长跑在最近成功 fix deadline 内保持存活` | `tests/gp/f1/validation-clock-fix-extension.test.ts` | 基线返回初始原点，断言失败 |
| 6 次边界 | `前 6 次成功 fix 均按 hop 选择最近一轮作为新原点` | `tests/gp/f1/validation-clock-fix-extension.test.ts` | 基线仍返回初始原点，断言失败 |
| 第 7 次判死 | `第 7 次 fix 不再顺延并按第 6 次 deadline 判死` | `tests/gp/f1/validation-clock-fix-extension.test.ts` | 基线未采用第 6 次原点，断言失败 |
| 零 fix 重放 | `无 fix 轮语义不变且相同 hop 输入可确定重放` | `tests/gp/f1/validation-clock-fix-extension.test.ts` | 基线应继续通过，证明无回归 |
