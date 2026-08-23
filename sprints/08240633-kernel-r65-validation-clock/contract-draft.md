# Sprint Contract Draft (Round 2)

## 实现基线与证据来源

- authoritative implementation baseline: `cad63f5b961328fbef1f66271a5c44586b4ea5d1`（冻结；role checkout SHA 不替换它）
- PRD: 本 sprint `sprint-prd.md` 与 bundle `thin_prd`
- Unified Map: `[MAP_NOT_CONFIGURED]`（task 有 `map_scope=["F1"]`，但无 `map_repo`，不得领域硬编码回退）
- fact revisions / freshness / must-run assertions: map 未配置，均无可消费条目
- context-manifest: PRD 已声明本 line 暂无累积 FR
- contract-gate: `packages/brain/src/lib/contract-gate.js` 存在，适用 Cecelia Contract Gate
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: PRD字面）

N/A — 本任务只修改内部纯函数，无 HTTP 响应或 DB schema。

## 已知约束（来自回归测试）

- `packages/brain/src/orchestrator/__tests__/validation-clock.test.js` → 已持久化时钟必须保持精确、非法时钟 fail-closed、无 origin 时抛 `validation_clock_required`
- `packages/brain/src/orchestrator/__tests__/loop.test.js` → loop 将 `pipeline_started_at` 与 `deadline_at` 写入决策日志并重放
- `[累积FR]` 本 line 暂无历史能力

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 每个有匹配 `effect:attempt_launched` 回执的 `spawn:generator-fix` 至多六次重置 pipeline validation clock 原点 |
| NFR（做得多好） | 保持 5400 秒默认值；仅按 hop 排序；同一日志输入可重放 |
| Invariant（永不违反） | 第七次及以后不续期；无 fix 行保持原语义；fail-closed 不变 |
| 判定点（怎么知道） | fix intent 仅在存在 `detail.dispatch_hop=intent.hop` 且 `detail.dispatch_action=spawn:generator-fix` 的后续 `effect:attempt_launched` 时代表成功派发 |
| 保质期（何时过期） | 能力随日志 schema 有效；若成功派发记账 schema 变更，需同步修订 |
| 死亡告警（停了谁知道） | 冻结回归测试与 Sprint Tests 在 PR CI 当轮失败并阻塞合并 |
| 失败语义（挂了怎么办） | 时钟字段残缺或非法继续抛错；不得放行或读取进程内补偿状态 |
| 效果确认（已发≠已生效） | 以函数返回的原点/deadline 精确值及当前时间相对 deadline 的判定确认 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| 成功 fix 派发的日志识别 | A. intent action 即算成功；B. intent 与后续 launch effect 按 dispatch_hop/dispatch_action 匹配 | B. 匹配 `effect:attempt_launched` | `loop.js` 在 dispatch 前写 intent，launch effect 才是成功回执 | 失败派发错误续期或健康 run 被误杀 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 时钟字段非法或残缺 | 抛 `validation_clock_invalid`，不生成 deadline | 是，同日志重放同结果 | 无降级，fail-closed |
| fix intent 无匹配 launch effect | 不顺延，继续使用此前有效原点 | 是 | 不把 intent 当成功；等待后续真实回执 |
| fix 次数超过六次 | 忽略第七及以后原点，使用第六次有效原点 | 是 | 到 deadline 照常判死 |

### 输入对抗面

N/A — 不对外暴露 agent 输入接口；输入为内部决策日志行。

## Golden Path

覆盖父路 F1 kernel validation 第 1-5 步

[首次 generator 计时] → [成功 fix 顺延] → [六次封顶] → [可重放判定]

### Step 1: 首次 generator 建立原始验证时钟
**来源**: `[FROM_PRD]` — Golden Path 第 1 步与“无 fix 轮语义不变”。

**可观测行为**: 无 fix 行时返回首次 generator 的原点与同一 timeout 计算出的 deadline。

**验证命令**: `npx vitest run --no-cache tests/gp/f1/validation-clock-fix-extension.test.js -t '无 fix 轮仍使用首次 generator 原点'`

**硬阈值**: 原点 `00:00:00Z`，deadline 精确为 `01:30:00Z`；命令 exit 0。

### Step 2: 仅匹配成功回执的 fix 才顺延
**来源**: `[FROM_PRD]` — Golden Path 第 2 步与 RED r50 场景。

**可观测行为**: 旧 deadline 已过但 fix intent 有后续匹配的 `effect:attempt_launched` 时，返回该 intent 的持久化原点与新 deadline；无回执或回执 `dispatch_hop` 不匹配时保持此前原点。

**验证命令**: `npx vitest run --no-cache tests/gp/f1/validation-clock-fix-extension.test.js -t 'r50 型场景旧 deadline 已过但最新成功 fix 窗口仍存活|无匹配 attempt_launched 回执的 fix intent 不顺延'`

**硬阈值**: 匹配回执时 deadline 精确为 `2026-08-24T04:00:00.000Z`；无匹配回执时精确为 `2026-08-24T01:30:00.000Z`；命令 exit 0。

### Step 3: 六次顺延封顶
**来源**: `[FROM_PRD]` — Golden Path 第 3 步与边界情况。

**可观测行为**: 按 hop 关联并只计有匹配 launch effect 的 fix；第六次成功 fix 可续期，第七次成功 fix 及以后不改变有效原点。

**验证命令**: `npx vitest run --no-cache sprints/08240633-kernel-r65-validation-clock/tests/validation-clock-fix-extension.test.ts -t '第六次成功 fix|第七次成功 fix'`

**硬阈值**: 六次与七次输入均返回第六次原点 `06:00:00Z` 和 deadline `07:30:00Z`；命令 exit 0。

### Step 4: hop 时序可重放
**来源**: `[FROM_PRD]` — Golden Path 第 4 步。

**可观测行为**: decisionLog 数组输入倒序时仍按 hop 选择同一个前六次有效 fix 原点。

**验证命令**: `npx vitest run --no-cache sprints/08240633-kernel-r65-validation-clock/tests/validation-clock-fix-extension.test.ts -t '第七次成功 fix 超限'`

**硬阈值**: 倒序输入仍返回 `06:00:00Z` / `07:30:00Z`；命令 exit 0。

## 禁 mock 边清单

- `spawn:generator-fix` intent ↔ 关联 `effect:attempt_launched`（本单修改成功派发识别，必须按 `dispatch_hop` 与 `dispatch_action` 真关联，禁止 mock 或把 intent 当回执）
- 决策日志行序列 ↔ `resolveValidationClock`（本单改调度时钟输入选择，冻结测试必须真实 import 目标模块且不得 mock）
- `resolveValidationClock` ↔ `persistedClock/exactClock`（必须真实校验持久化原点与 timeout 计算）

## 真实调用方请求 shape

N/A — 无设备、agent 或 webhook 请求；调用方是 `loop.js`，以 `{action, decisionLog, intentAt, timeoutSeconds, allowEvaluatorOrigin}` 调用纯函数。成功回执 shape 为 `{action:"effect:attempt_launched", detail:{dispatch_hop:<fix intent hop>, dispatch_action:"spawn:generator-fix", attempt_id:<runtime id>}}`，不得用 authoring attempt 字面值。

## 未覆盖真实链路清单

| 未覆盖点 | 原因 | 真验证补位计划 |
|---|---|---|
| `loop.js` 从真 Postgres 装载 `orchestrator_decision_log` 并把顺延时钟写回下一 hop | 本 attempt `postgres=false`，合同冻结测试只覆盖真实模块纯函数边 | Generator PR 的 `brain-integration` job 在带 Postgres 环境运行 loop 集成回归；未通过前状态为 `logic-done-pending` |

## 接缝清单

- `loop.js ↔ orchestrator_decision_log` 真 Postgres 读写：由 `brain-integration` 真库 job 验证；当前 `logic-done-pending`，不得宣称 done。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: fix 行缺一半持久化时钟字段，应继续 fail-closed
- 重复提交: 相同 hop 重放不得改变结果
- 中途中断: 日志截断在第六/第七次 fix 边界分别验证
- 边界值: hop 乱序、同 hop、timeoutSeconds 非正整数
发现分级: P0/P1 → 阻塞 merge；P2/P3 → 记 findings 不阻塞

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
START=$(date +%s)
npx vitest run --no-cache sprints/08240633-kernel-r65-validation-clock/tests/validation-clock-fix-extension.test.ts tests/gp/f1/validation-clock-fix-extension.test.js --reporter=verbose
ELAPSED=$(( $(date +%s) - START ))
[ "$ELAPSED" -lt 30 ] || { echo "FAIL: pure replay suite exceeded 30s"; exit 1; }
echo "OK: validation clock bounded replay contract passed in ${ELAPSED}s"
```

通过标准：9 个断言全部通过、exit 0、总耗时小于 30 秒。该纯函数无 DB、登录或 HTTP 资源需求。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 冻结合同测试 | `sprints/08240633-kernel-r65-validation-clock/tests/validation-clock-fix-extension.test.ts` | `r50 型场景以最新成功 fix 原点重算后保持存活`; `第六次成功 fix`; `第七次成功 fix 超限`; `无匹配 attempt_launched 回执的 fix intent 不顺延`; `无 fix 轮保持首次 generator 原点语义` | 当前实现 5 项中 3 项失败 |
| F1 Golden Path 回归 | `tests/gp/f1/validation-clock-fix-extension.test.js` | `r50 型场景旧 deadline 已过但最新成功 fix 窗口仍存活`; `第七次 fix 不得突破六次顺延上限`; `无匹配 attempt_launched 回执的 fix intent 不顺延`; `无 fix 轮仍使用首次 generator 原点` | 当前实现 4 项中 2 项失败 |

## Notes

- 不修改 timeout 默认值、人审 deadline 或其他 deadline。
- 不固化 authoring attempt/capability；未来验证身份仅从 Runner 的 `HARNESS_*` 与 `CAPABILITY_SNAPSHOT_ID` late-bind。
