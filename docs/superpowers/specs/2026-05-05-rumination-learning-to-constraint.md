# Spec: rumination/cortex insight → dispatch_constraint 同步转化

## 背景与动机

Cortex Insight 6a569a1e 教训：**rumination learnings 必须在同次 session 中转化为 CI 门禁或 dispatch 约束，否则认知成本沉没，learning 记录本身变成噪声**。

现状（调研结果）：

- `learnings.dispatch_constraint` JSONB 列已就位（migration 263）
- `pre-flight-check.js` 会加载并求值激活态约束
- **但** cortex.js `recordLearnings` 写入 cortex_insight 时**dispatch_constraint=NULL**
- migration 264 是手工 SQL 物化的单条规则，覆盖率仅 1/数百

→ 缺一道"learning 入库时同步抽取 constraint"的**自动通道**。

## 目标

在 cortex 写入 learning 的同次 session 中，**每条 cortex_insight learning 都被尝试转换为 dispatch_constraint DSL**。提取成功则写回 `learnings.dispatch_constraint`；不能提取也要在 metadata 留下"已尝试"标记，让 CI lint 可以核查覆盖率。

## 范围

### 实现
1. 新模块 `packages/brain/src/insight-to-constraint.js`
2. 集成至 `packages/brain/src/cortex.js` `recordLearnings`
3. CI lint job：核查 cortex.js 已集成 insight-to-constraint 调用
4. 真环境 smoke：`packages/brain/scripts/smoke/learning-to-constraint-smoke.sh`

### 非范围
- LLM-based 提取（v2 留作后续）
- rumination.js 内综合洞察的额外提取通道
- markdown learnings 与 DB 同步
- 历史 learnings 回填（手工跑脚本即可）

## 接口

```js
// 启发式提取 — 无 LLM 依赖，从 insight 文本识别 actionable pattern
export function extractConstraintHeuristic(insightContent: string): object | null;

// 写回 learnings.dispatch_constraint + metadata.constraint_extraction
// 已存在 dispatch_constraint 时不覆写
export async function persistConstraint(
  learningId: string,
  constraint: object | null,
  dbPool?: Pool,
  meta?: { source: string }
): Promise<{ written: boolean; markedAttempted: boolean }>;

// 端到端入口（cortex.js 调用点）：抽取 + 写回 + 即使无匹配也标记 attempted
export async function autoExtractAndPersist(
  learningId: string,
  insightContent: string,
  dbPool?: Pool
): Promise<{ extracted: boolean; written: boolean; constraint?: object }>;
```

## 启发式 v1 pattern

仅识别高置信度模式（宁可 miss 不可错抓）：

| Pattern | 触发文本 | 输出 DSL |
|---|---|---|
| deny_keyword on title | `task title 中(?:禁止\|不应\|应避免\|不能含)\s*[''"]([^''"]+)[''"]` | `{rule:'deny_keyword',field:'title',patterns:[X],reason,severity:'block'}` |
| deny_keyword on description | 同上但匹配 `description \| 描述` | 同上但 field='description' |
| require_payload | `(?:必须\|应当)(?:含\|包含\|有)\s*payload\.([a-zA-Z_][\w.]*)` | `{rule:'require_payload',key:X,reason,severity:'block'}` |
| require_field min_length | `(title\|description)\s*(?:至少\|不能少于\|>=)\s*(\d+)` | `{rule:'require_field',field:X,min_length:N,reason,severity:'warn'}` |

无匹配 → 返回 null（不强造规则）。reason 字段从 insight 文本截取前 100 字。

## 写回行为

- 已有 dispatch_constraint 非 NULL → 跳过覆写（保护人工/历史规则）
- constraint 为 null → 不写 dispatch_constraint，但**仍** UPDATE metadata 追加 `constraint_extraction.status='no_match'`
- 任何 DB 错误 → catch 后 warn，**不阻塞** cortex 主流程

## 集成点

`cortex.js` `recordLearnings`，紧跟 INSERT learning 之后、`maybeCreateInsightTask` 之前：

```js
const learningId = insertResult.rows[0].id;
await autoExtractAndPersist(learningId, content).catch(err =>
  console.warn('[cortex] insight-to-constraint failed:', err.message)
);
await maybeCreateInsightTask(learningId, content, event).catch(...);
```

## CI 门禁

新增 `.github/workflows/scripts/lint-learning-constraint-coverage.sh`：

```bash
#!/usr/bin/env bash
# 强制 cortex.js 集成 insight-to-constraint，防止 learning 写入跳过约束抽取
set -e
SRC=packages/brain/src/cortex.js
grep -q "from './insight-to-constraint" "$SRC" || { echo "FAIL: cortex.js 未 import insight-to-constraint"; exit 1; }
grep -q "autoExtractAndPersist" "$SRC" || { echo "FAIL: cortex.js 未调用 autoExtractAndPersist"; exit 1; }
echo "OK: cortex.js 已集成 insight-to-constraint"
```

接入 `.github/workflows/ci.yml` 作为新 lint job `lint-learning-constraint-coverage`。

## 测试策略

按 /dev SKILL.md 测试金字塔分类：

- **unit test** — `packages/brain/src/__tests__/insight-to-constraint.test.js`
  - `extractConstraintHeuristic` 在 4 种 pattern 下输出正确 DSL（且通过 `isValidConstraint` 校验）
  - 无匹配文本返回 null
  - `persistConstraint` 在 mock pool 下写 dispatch_constraint + metadata
  - 已有 dispatch_constraint 时不覆写
  - constraint=null 时仍写 metadata.constraint_extraction.status='no_match'
  - `autoExtractAndPersist` 综合行为

- **integration test** — 复用 cortex.js 既有路径，新增对 `recordLearnings` 调用 `autoExtractAndPersist` 的契约测试（spy 验证）

- **smoke test (real-env)** — `packages/brain/scripts/smoke/learning-to-constraint-smoke.sh`
  - 验证模块文件存在并 export 三函数
  - 验证 cortex.js 已 import + 调用集成点
  - 验证 lint 脚本可执行通过

- **CI lint** — `lint-learning-constraint-coverage.sh` 提供机器化门禁，每个 PR 强制检查

## DoD（验证命令）

```bash
# 1. unit + integration 全绿
cd packages/brain && npm test -- insight-to-constraint

# 2. smoke 真环境通过
bash packages/brain/scripts/smoke/learning-to-constraint-smoke.sh

# 3. CI lint 通过
bash .github/workflows/scripts/lint-learning-constraint-coverage.sh
```

## TDD commit 顺序

- **commit 1**：`packages/brain/src/__tests__/insight-to-constraint.test.js`（fail，模块尚未实现）+ `packages/brain/scripts/smoke/learning-to-constraint-smoke.sh` 骨架（exit 1）+ `lint-learning-constraint-coverage.sh` 骨架
- **commit 2**：实现 `insight-to-constraint.js` + 集成 cortex.js + smoke/lint 填实，所有 fail 变 green
