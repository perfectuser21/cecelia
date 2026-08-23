# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: N/A）

N/A — 本任务为纯函数内部改动，无 HTTP 响应。

## 已知约束

- [packages/brain/src/orchestrator/__tests__/validation-clock.test.js] → 首次 Generator 建立共享窗口、下游缺 clock fail-closed、verified-existing-PR Evaluator 原点保持有效。
- [累积FR] 本 line 暂无历史。
- Unified Map: `[MAP_NOT_CONFIGURED]`（payload 缺 map_repo）；must_run_assertions 为空。
- context-manifest: PRD 已声明本 line 暂无历史 FR。

## Golden Path

覆盖父路 F1「工厂 · 开发闭环」第 3-3 步。

`spawn:generator` 建立原点 → 成功记录的 `spawn:generator-fix` 最多 6 次成为新原点 → 后续 Evaluator/Judge 使用有界新 deadline 判定存活。

### Step 1: 保持原始 validation clock
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 点与「边界情况」无 fix 语义不变。

**可观测行为**: 无 fix 日志时，clock 仍取首个 `spawn:generator` 行；默认 timeout 仍为 5400 秒。

**验证命令**:
```bash
npx vitest run --no-cache sprints/08240732-kernel-r66-validation-clock/tests/validation-clock-fix-extension.test.ts -t '无 generator-fix 时保持首个 generator 原点语义'
```
**硬阈值**: 原点字面等于 generator `created_at`，deadline 精确增加 5400 秒；上命令 exit 0。

### Step 2: 前 6 次 fix 有界顺延
**来源**: `[FROM_PRD]` — PRD「要求」1-3 与 r50 场景。

**可观测行为**: 按 hop 排序的日志中，前 6 个 `spawn:generator-fix` 可逐次取代原点；相同输入重放结果一致。

**验证命令**:
```bash
npx vitest run --no-cache sprints/08240732-kernel-r66-validation-clock/tests/validation-clock-fix-extension.test.ts -t 'r50 场景|相同乱序日志'
```
**硬阈值**: r50 新 deadline 晚于判定时刻；日志顺序变化但 hop 不变时结果深相等；上命令 exit 0。

### Step 3: 第 7 次起拒绝继续顺延
**来源**: `[FROM_PRD]` — PRD「要求」2 与「边界情况」顺延最多 6 次。

**可观测行为**: 第 7 个及后续 fix 不再改变第 6 个 fix 建立的原点，超过该 deadline 后沿用现有判死语义。

**验证命令**:
```bash
npx vitest run --no-cache sprints/08240732-kernel-r66-validation-clock/tests/validation-clock-fix-extension.test.ts -t '第 7 次 generator-fix 不再顺延'
```
**硬阈值**: `pipeline_started_at` 精确等于第 6 次 fix 的 `created_at`；上命令 exit 0。

### Step 4: 防止验证绕开真实模块
**来源**: `[AI_ADDED]` — 用冻结测试真 import 被改模块，防止替身或文本检查制造假绿。

**可观测行为**: Sprint 冻结测试与 F1 回归测试均直接执行 `resolveValidationClock`，不 mock validation-clock 与 decision-log 输入边。

**验证命令**:
```bash
npx vitest run --no-cache sprints/08240732-kernel-r66-validation-clock/tests/validation-clock-fix-extension.test.ts tests/gp/f1/validation-clock-fix-extension.test.ts
```
**硬阈值**: 两个真实测试文件全部通过且 exit 0。

## 禁 mock 边清单

- `orchestrator_decision_log` 行序列 ↔ `resolveValidationClock` 原点选择（本单修改跨模块数据传递语义；测试必须传真实 shape 的日志行并真调用导出函数，禁止 mock 该函数或该输入边）。

## 真实调用方请求 shape

N/A — 本任务无设备、agent 或 HTTP 调用方；真实调用方是 `loop.js`，以 `{ action, decisionLog, intentAt, timeoutSeconds, allowEvaluatorOrigin }` 调用 `resolveValidationClock`。

## 未覆盖真实链路清单

- `loop.js` ↔ 真 PostgreSQL `orchestrator_decision_log`：本合同以纯函数日志行重放覆盖 PRD 核心，但不宣称真库 loop 集成已覆盖；Generator 实现后由既有 Brain 集成 CI 承担接线回归，本 Sprint 不扩展至真库测试。

## 接缝清单

- `loop.js` 从真库读取日志并传给纯函数：当前为 `logic-done-pending`，本合同只验纯函数重放；不以该接缝作为 Sprint done 的虚假证据。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 前 6 次 fix 重置 validation clock，第 7 次起不再重置 |
| NFR（做得多好） | 纯函数、按 hop 确定性重放；默认 5400 秒不变 |
| Invariant（永不违反） | fail-closed、verified existing PR、人审 deadline 与无 fix 语义不变 |
| 判定点（怎么知道） | 以日志 action 与 hop 识别前 6 次 fix |
| 保质期（何时过期） | 随日志 action schema 变化复核；当前无独立 TTL |
| 死亡告警（停了谁知道） | required CI 的 F1 与 Sprint Tests 立即报红 |
| 失败语义（挂了怎么办） | malformed clock 继续抛错 fail-closed，不扩大 deadline |
| 效果确认（已发≠已生效） | 直接比较返回原点/deadline，并由调用方按 deadline 判活死 |

### 判定点登记表

（本任务无真机/外部现实状态判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| clock 缺失或非法 | 保持既有异常与 fail-closed | 是，纯函数重放 | 不放宽 timeout |
| fix 超过 6 次 | 固定使用第 6 次 fix 原点 | 是 | 到 deadline 照常判死 |

### 输入对抗面

N/A — 不对外暴露 agent 或用户输入接口。

gp-anchor: skipped (product-map.json not found)

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 缺失/非法 `created_at` 与不完整 persisted clock 应保持 fail-closed。
- 重复提交: 重复 hop 或重复 fix 行不得造成第 7 次后的无界延长。
- 中途中断: decisionLog 截断到任意 hop 后重放应只由保留行决定。
- 边界值: 0、6、7 个 fix；乱序输入；相同 hop。
发现分级: P0/P1 → 阻塞 merge；P2/P3 → 记录 findings。

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
: "${HARNESS_ATTEMPT_ID:?Runner must inject current validation identity}"
: "${CAPABILITY_SNAPSHOT_ID:?Runner must inject current capability snapshot}"
npx vitest run --no-cache sprints/08240732-kernel-r66-validation-clock/tests/validation-clock-fix-extension.test.ts tests/gp/f1/validation-clock-fix-extension.test.ts
(cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/validation-clock.test.js)
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Sprint 冻结测试 | `sprints/08240732-kernel-r66-validation-clock/tests/validation-clock-fix-extension.test.ts` | `r50 场景在成功 generator-fix 后以 fix 行为新原点存活`; `第 7 次 generator-fix 不再顺延且仍以第 6 次 fix 为原点`; `无 generator-fix 时保持首个 generator 原点语义`; `相同乱序日志按 hop 重放得到相同 clock` | 当前实现固定首个 generator，至少 3 项 FAIL |
| F1 回归测试 | `tests/gp/f1/validation-clock-fix-extension.test.ts` | `r50 场景在成功 generator-fix 后以 fix 行为新原点存活`; `第 7 次 generator-fix 不再顺延且无 fix 语义不变` | 当前实现固定首个 generator，2 项 FAIL |

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- authoritative implementation baseline: `cad63f5b961328fbef1f66271a5c44586b4ea5d1`；本角色 checkout SHA 不替换该基线。
