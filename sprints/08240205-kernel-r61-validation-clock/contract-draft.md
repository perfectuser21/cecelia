# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD字面）

N/A — 任务无 HTTP 响应；输出是 `resolveValidationClock` 返回的 `{pipeline_started_at, deadline_at}` 纯函数值，字段沿用现有模块。

## 已知约束（来自回归测试与 PRD）

- `packages/brain/src/orchestrator/__tests__/validation-clock.test.js` → 首次 Generator 建立共享窗口、下游角色复用、畸形持久化 clock fail-closed、authoring role 返回 null。
- `tests/gp/f1/step3-seal-repo-row-behavior.test.js` → Test Contract 的 repo 测试路径及 BEHAVIOR 名必须可解析。
- `[累积FR]` 本 line 暂无历史；`[MAP_NOT_CONFIGURED]` task payload 未提供 map_scope/map_repo，因此 affected nodes 与 must_run_assertions 均为空。
- Unified Map freshness/fact_revisions：未配置，无可声明地图证据；不得回退为领域猜测。

## Golden Path

覆盖父路 F1「工厂 · 开发闭环」第 3-3 步。

`spawn:generator` 建钟 → 成功 `spawn:generator-fix` 依 hop 顺序重置原点（最多 6 次）→ evaluator/judge 读取同一纯函数结果 → 第 7 次及以后不续命。

### Step 1: 无 fix 时保持初始 Generator clock
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 点与「边界情况」。

**可观测行为**: 仅有 `spawn:generator` 时，返回其时间加 5400 秒的 deadline。

**验证命令**:
```bash
npx vitest run --no-cache tests/gp/f1/validation-clock-fix-extension.test.js -t 'no fix preserves the initial generator clock'
```
**硬阈值**: 原点逐字等于初始行 `created_at`，deadline 差值恰为 5400 秒；以上命令 exit 0。

### Step 2: r50 长跑按最新有效 fix 顺延
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2、3 点。

**可观测行为**: 1–6 次 `spawn:generator-fix` 中按 hop 排序后的最新事件成为新原点，使旧窗口已过而新窗口尚存活。

**验证命令**:
```bash
npx vitest run --no-cache tests/gp/f1/validation-clock-fix-extension.test.js -t 'r50 long run extends from latest eligible generator-fix and remains alive'
```
**硬阈值**: 第 6 次 fix 原点为 `2026-08-20T06:00:00.000Z`，deadline 为 `07:30:00.000Z`；命令 exit 0。

### Step 3: 第 7 次及以后停止顺延
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 点及「顺延有界：上限 6 次」。

**可观测行为**: 含第 7 次 fix 的日志仍选择第 6 次 fix 为最后有效原点，到期照常判死。

**验证命令**:
```bash
npx vitest run --no-cache tests/gp/f1/validation-clock-fix-extension.test.js -t 'seventh generator-fix does not extend beyond the sixth fix'
```
**硬阈值**: 第 7 次 created_at 不进入返回值，原点仍为第 6 次 fix；命令 exit 0。

### Step 4: 相同 hop 时序可重放
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5 点。

**可观测行为**: 相同日志重复调用产生深相等结果，不读取隐藏计数或可变状态。

**验证命令**:
```bash
npx vitest run --no-cache tests/gp/f1/validation-clock-fix-extension.test.js -t 'same decision-log replay returns an identical clock'
```
**硬阈值**: 两次返回深相等且原点为 hop 最大的有效 fix；命令 exit 0。

## 禁 mock 边清单

- `orchestrator_decision_log` 行序列 ↔ `resolveValidationClock` 原点选择：冻结测试必须真实 import `packages/brain/src/orchestrator/validation-clock.js`，不得 mock 模块、日志排序或 clock 计算。
- `loop.js` ↔ 真 PostgreSQL decision log 未纳入本 sprint；按 PRD 登记为未覆盖接缝，不把纯函数测试冒充真库集成。

## 真实调用方请求 shape

N/A — 本单不新增设备、agent、HTTP 或 webhook 调用；真实调用方仍由 `loop.js` 传入 `{action, decisionLog, intentAt, timeoutSeconds, allowEvaluatorOrigin}`，其中 `decisionLog` 为已有决策日志行数组。

## 未覆盖真实链路清单

- `loop.js` 真 PostgreSQL 查询结果 → `resolveValidationClock` → append detail｜PRD 明确排除真库集成｜后续独立 integration sprint 在 attempt 级 Postgres 验证；本 sprint 仅可标 pure-logic done，不宣称该接缝已验。
- 本合同无 force/stub/假数据豁免；固定时间输入用于纯函数确定性回归，不替代外部依赖。

## 接缝清单

- 真库 decision log 进入 `loop.js` 的接缝：未真验，状态为 `logic-done-pending`；验收真相仅限真实模块导入后的纯函数输出。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 前 6 次成功 generator-fix 各自重置 pipeline deadline 原点，第 7 次起不再重置。 |
| NFR（做得多好） | timeout 保持 5400 秒；纯函数由 hop 行序确定且可重放。 |
| Invariant（永不违反） | 默认 fail-closed、人审 deadline、现有无-fix/evaluator-origin 语义均不变。 |
| 判定点（怎么知道） | 日志中存在的 `spawn:generator-fix` 行即成功派发事实；按 hop 升序解释。 |
| 保质期（何时过期） | 与 decision-log action/hop schema 同寿命；schema 改动时必须重审。 |
| 死亡告警（停了谁知道） | required Sprint Tests/CI 在回归失败当次阻塞 PR。 |
| 失败语义（挂了怎么办） | clock 缺失/畸形继续 fail-closed；不以异常输入放行。 |
| 效果确认（已发≠已生效） | 真实导入模块并断言精确 ISO 原点与 deadline，而非只查测试文件存在。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| 成功 fix 派发的日志事实 | A. action 行存在；B. callback 猜测 | A. `action=spawn:generator-fix` 行存在 | PRD 假设与 intent-log-before-dispatch 现有模型 | 错误续命或健康 run 被误杀 |
| 有效顺延上界 | A. 前 6 行；B. 滑动最近 6 行 | A. 初始后的前 6 次 fix | PRD 明确第 1–6 次有效、第 7 次起无效 | 无界续命 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 无 Generator clock 的下游角色 | 抛 `validation_clock_required` | 是 | 无降级，fail-closed |
| clock 时间或 timeout 非法 | 抛既有 validation clock error | 是 | 无降级，fail-closed |
| 超过 6 次 fix | 忽略第 7 次以后对原点的影响 | 是 | 按第 6 次 deadline 判死 |

### 输入对抗面

N/A — 纯内部函数，不对外暴露 agent 输入；异常时间与缺 clock 继续由既有 fail-closed 测试覆盖。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 重复 hop、非数字 hop、畸形 persisted detail 应继续 fail-closed。
- 重复提交: 相同 decisionLog 连续调用不应积累隐藏顺延次数。
- 中途中断: decisionLog 截断到任一 fix 轮时应只由现存行决定。
- 边界值: 0、1、6、7、8 次 fix 与乱序输入。
发现分级: P0/P1（错误续命或误杀）阻塞 merge；P2/P3 记录 findings。

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api（本 sprint 无数据库资源，验收真相为 Node/Vitest 纯函数执行）

```bash
set -euo pipefail
test -f tests/gp/f1/validation-clock-fix-extension.test.js
test -f sprints/08240205-kernel-r61-validation-clock/tests/validation-clock-fix-extension.test.js
npx vitest run --no-cache tests/gp/f1/validation-clock-fix-extension.test.js
npx vitest run --no-cache sprints/08240205-kernel-r61-validation-clock/tests/validation-clock-fix-extension.test.js
git ls-files --error-unmatch tests/gp/f1/validation-clock-fix-extension.test.js
git ls-files --error-unmatch sprints/08240205-kernel-r61-validation-clock/tests/validation-clock-fix-extension.test.js
```

通过标准：两份冻结测试均真实启动 Vitest 且 exit 0，Test Contract 两条路径均已进入 git；当前 RED 阶段必须在旧实现上非零退出。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Sprint 冻结回归 | `sprints/08240205-kernel-r61-validation-clock/tests/validation-clock-fix-extension.test.js` | `extends from latest eligible generator-fix and remains alive`; `第 7 次 fix does not extend beyond the sixth fix`; `无 fix 轮 preserves the initial generator clock`; `replay returns an identical clock` | 旧实现 3 个顺延断言失败 |
| F1 永久回归 | `tests/gp/f1/validation-clock-fix-extension.test.js` | `extends from latest eligible generator-fix and remains alive`; `seventh generator-fix does not extend beyond the sixth fix`; `no fix preserves the initial generator clock`; `replay returns an identical clock` | 旧实现 3 个顺延断言失败 |

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists).
- 实现基线固定为 `d4f4d4c29b524fee34c8855de2f434fd04a4b9f6`；本角色 checkout SHA 仅用于起草，不替换实现基线。
- GAN authoring identity 不固化到验收；未来 Evaluator/Judge 身份仅从 Runner 注入的 `HARNESS_*` 与 `CAPABILITY_SNAPSHOT_ID` late-bind。
