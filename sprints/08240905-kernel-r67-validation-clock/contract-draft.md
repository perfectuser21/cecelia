# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: N/A）

N/A — 本任务仅修改内部纯函数，无 HTTP 响应。

## 已知约束

- [packages/brain/src/orchestrator/__tests__/validation-clock.test.js] → 已持久化时钟必须严格匹配 timeout；无合法原点时 fail-closed。
- [tests/gp/f1/step3-generator-fix-after-publish.test.js] → generator-fix 必须保留既有修复接力语义。
- [累积FR] 本 line 暂无历史行为。
- context-manifest: unavailable
- [MAP_NOT_CONFIGURED] task payload 缺有效 map_repo；不做领域猜测，must_run_assertions 为空。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 每个成功的 `spawn:generator-fix`（最多六次）成为 validation clock 新原点。 |
| NFR（做得多好） | 默认 5400 秒不变；同一 decision log 重放结果完全一致。 |
| Invariant（永不违反） | 失败派发不顺延；第七次及以后不顺延；人审 deadline 不变；既有 fail-closed 语义不变。 |
| 判定点（怎么知道） | 以 decision log 的 action/hop 与关联 `result:dispatch` 行判定有效顺延。 |
| 保质期（何时过期） | 随 validation-clock 行为版本生效；由永久 GP 回归测试守护。 |
| 死亡告警（停了谁知道） | required CI 的 GP F1 测试失败即阻塞合并。 |
| 失败语义（挂了怎么办） | 非法持久化时钟继续抛 `validation_clock_invalid`；缺原点继续抛 `validation_clock_required`。 |
| 效果确认（已发≠已生效） | 直接比较纯函数返回的 `pipeline_started_at` 与 `deadline_at`。 |

### 判定点登记表

（本任务无真机或外部状态判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| fix 派发有 BLOCKED/FAILED 回执 | 不将该 fix 作为原点 | 是，按同一日志重放 | 回到上一个有效原点 |
| 成功 fix 超过六次 | 忽略第七次及以后原点 | 是 | 以第六次为最后原点并照常超时 |
| 时钟字段非法 | 抛既有错误 | 是 | fail-closed |

### 输入对抗面

N/A — 不对外暴露 agent 输入接口。

gp-anchor: skipped (product-map.json not found)

## Golden Path

覆盖父路 factory/F1「造完真验」第 1-4 步。

[进入验证时钟] → [按 hop 识别有效 fix] → [六次内更新原点] → [返回可重放 deadline]

### Step 1: 读取同一 run 的 decision log
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 点。

**可观测行为**: 输入相同但数组顺序不同，返回完全相同的 ISO 时钟。

**验证命令**:
```bash
npx vitest run --no-cache tests/gp/f1/step3-validation-clock-fix-extension.test.js -t "乱序输入按 hop 重放得到同一时钟"
```
**硬阈值**: 两次结果严格相等；上方命令 exit 0。

### Step 2: 成功 fix 在六次内更新原点
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 点及边界情况。

**可观测行为**: r50 类旧 deadline 已过、最新有效 fix deadline 未过时，resolver 返回最新有效 fix 的时钟；关联 BLOCKED/FAILED 派发不参与顺延。

**验证命令**:
```bash
npx vitest run --no-cache tests/gp/f1/step3-validation-clock-fix-extension.test.js -t "r50 类场景由最新成功 fix 重置时钟|失败派发不顺延"
```
**硬阈值**: `pipeline_started_at` 等于最新成功 fix 的 `created_at`，deadline 精确增加 5400 秒；命令 exit 0。

### Step 3: 第七次以后不再顺延
**来源**: `[FROM_PRD]` — PRD「边界情况」恰好六次可顺延，超过六次以第六次为最后原点。

**可观测行为**: 七个成功 fix 行输入时返回第六个 fix 的时钟。

**验证命令**:
```bash
npx vitest run --no-cache tests/gp/f1/step3-validation-clock-fix-extension.test.js -t "第七次成功 fix 不再顺延"
```
**硬阈值**: 原点等于第六次 fix，绝不等于第七次；命令 exit 0。

### Step 4: 无 fix 时保持旧语义
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 点。

**可观测行为**: 仅有 `spawn:generator` 时仍以 generator 持久化时钟为原点。

**验证命令**:
```bash
npx vitest run --no-cache tests/gp/f1/step3-validation-clock-fix-extension.test.js -t "零次 fix 保持 generator 原点语义"
```
**硬阈值**: 返回值与 generator 行持久化时钟严格相等；命令 exit 0。

## 禁 mock 边清单

- `orchestrator_decision_log` 行序列 ↔ `resolveValidationClock` 原点选择（冻结测试真 import `validation-clock.js`，不得 mock resolver 或伪造替代实现）。
- `resolveValidationClock` ↔ `loop.js` 真库装载/写回属于接缝，本 sprint 明确不覆盖，见未覆盖清单。

## 真实调用方请求 shape

N/A — 本任务无设备、agent 或 HTTP 调用方；真实调用方是 `loop.js` 直接传入 `{action, decisionLog, intentAt, timeoutSeconds, allowEvaluatorOrigin}`。

## 未覆盖真实链路清单

| 未覆盖点 | 原因 | 补位计划 |
|---|---|---|
| 真 Postgres `orchestrator_decision_log` → `loop.js` 一 hop → 时钟写回 | 本 attempt `postgres=false`，且 PRD 明确只要求纯函数冻结测试 | evaluator 在 brain-integration 的真 Postgres 环境验证；在此之前标记 `logic-done-pending`，不得宣称接缝 done |

## 接缝清单

- `loop.js` 真库读取 decision log 并将 resolver 结果写回：真目标为 brain-integration Postgres；当前 `logic-done-pending`。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: fix 行缺 `created_at` 或持久化 clock 只缺一个字段。
- 重复提交: 同 hop 重复 fix 行不得额外消耗六次额度。
- 中途中断: fix 后出现 BLOCKED/FAILED `result:dispatch` 回执。
- 边界值: 0、6、7 次成功 fix；相同 hop 与乱序数组。
发现分级: P0/P1 → 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
START=$(date +%s)
npx vitest run --no-cache tests/gp/f1/step3-validation-clock-fix-extension.test.js
npx vitest run --no-cache sprints/08240905-kernel-r67-validation-clock/tests/validation-clock-contract.test.ts
ELAPSED=$(( $(date +%s) - START ))
[ "$ELAPSED" -lt 60 ] || { echo "FAIL: validation clock 回放超过 60s"; exit 1; }
echo "OK: validation clock fix 顺延边界验证通过"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 冻结合同关键场景 | `sprints/08240905-kernel-r67-validation-clock/tests/validation-clock-contract.test.ts` | `r50 类场景由最新成功 fix 重置时钟` | 旧实现返回 generator 原点，1 failure |
| 永久 GP 回归 | `tests/gp/f1/step3-validation-clock-fix-extension.test.js` | `r50 类场景由最新成功 fix 重置时钟`; `第七次成功 fix 不再顺延`; `零次 fix 保持 generator 原点语义`; `失败派发不顺延`; `乱序输入按 hop 重放得到同一时钟` | 旧实现至少 3 failures |

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- implementation baseline: `6cc74f728b9c515cf67130a9b06b20e03d651772`（冻结，不以 role checkout SHA 替换）
- validation identity: 运行时由 Runner 注入 `HARNESS_*` 与 `CAPABILITY_SNAPSHOT_ID`，合同不固化 authoring identity。

