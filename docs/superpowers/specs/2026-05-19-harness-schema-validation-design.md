# Harness Schema Validation — 自研 Structured Output 模式

**日期**: 2026-05-19  
**分支**: cp-0519201018-harness-schema-validation  
**状态**: APPROVED

---

## 背景与目标

Harness pipeline 的 Reviewer/Evaluator 节点输出存在"静默降级"问题：LLM 写 `.brain-result.json` 时偶发漏掉字段（如 rubric 5 维度缺 1 个），Brain 代码只检查字段存在，不验结构，脏数据静默流入下游节点，导致：

- `computeVerdictFromRubric` 返回 null → fallback 到 LLM 文字 verdict → GAN 可能错误 APPROVED
- Evaluator verdict 格式不一致（FIXED/PASS/FAIL 混用）→ fix loop 误判

**目标**：在 Brain 代码层实现"自研 Structured Output"—— schema 不合格时节点内循环重试，唯一终止条件是 budget 耗尽（与 GAN 无轮次上限哲学一致）。

---

## 架构

### 新增组件（harness-shared.js）

```
ReviewerOutputSchema (Zod)
  verdict: enum ['APPROVED', 'REVISION']
  rubric_scores:
    dod_machineability:   number 1-10
    scope_match_prd:      number 1-10
    test_is_red:          number 1-10
    internal_consistency: number 1-10
    risk_registered:      number 1-10
  feedback: string

EvaluatorOutputSchema (Zod)
  verdict:  enum ['PASS', 'FAIL', 'FIXED']
  task_id:  string (optional)
  feedback: string

readAndValidateBrainResult(worktreePath, schema)
  → readBrainResult() 读 JSON
  → schema.safeParse(data)
  → 失败: throw Error('ContractViolation: schema_mismatch — <issues>'), code='schema_mismatch'
  → 成功: 返回 typed data
```

### Reviewer 节点改造（harness-gan.graph.js）

当前：`readBrainResult(wt, ['verdict', 'rubric_scores'])` 只检查字段存在  
改后：在现有 GAN 循环内，每轮 reviewer spawn 后用 `ReviewerOutputSchema.safeParse()` 验证，不合格则 `continue`（重新 spawn reviewer），budget 超才 throw。

```
while (GAN 未收敛) {
  spawn reviewer → await result
  cost += result.cost_usd
  if cost > budget: throw gan_budget_exceeded
  
  parsed = ReviewerOutputSchema.safeParse(result)
  if !parsed.success:
    log warn schema_mismatch
    continue  ← 重新 spawn reviewer（不进入下游逻辑）
  
  // 正常 rubric 判决逻辑...
}
```

### Evaluator 节点改造（harness-task.graph.js）

Evaluator 使用 detached 容器 + interrupt/callback 模式，不能用同步 while。  
改造在 `evaluateContractNode` 内，callback 返回后做 schema 验证：

```
await spawnEvaluator() → interrupt → callback resume
parsed = EvaluatorOutputSchema.safeParse(callbackData)
if !parsed.success:
  reset containerId
  state.eval_schema_retry++
  if cost > budget: throw budget_exceeded
  → 返回 {containerId: null} → LangGraph 重新进入 spawn 节点
// 成功：继续 normalizeVerdict
```

### retry-policies.js

`PERMANENT_ERROR_RE` 加入 `schema_mismatch`，防止 schema 验证失败意外被外层 LLM_RETRY 捕获重跑整个外层节点。

---

## 数据流变化

```
改前：
  Reviewer → .brain-result.json → readBrainResult(存在性检查) → 可能 null rubric → GAN 误判

改后：
  Reviewer → .brain-result.json → readAndValidateBrainResult(Zod) → 
    合格 → 继续
    不合格 → 重跑 reviewer（直到合格或 budget 耗尽）
```

---

## 前置条件

`packages/brain` 需安装 zod（根 node_modules 已有，但 package.json 未声明）：
```bash
npm install zod --workspace=packages/brain
```

---

## 测试策略

| 测试类型 | 内容 |
|---|---|
| **unit** | `readAndValidateBrainResult`：缺维度 throw、类型错 throw、完整 pass |
| **unit** | `ReviewerOutputSchema` / `EvaluatorOutputSchema`：正常 case、缺字段、非法枚举 |
| **unit** | reviewer 节点 schema 循环：mock 前 N 次失败第 N+1 次成功 → 验最终返回正确 |
| **unit** | budget 超限：mock cost 累积超 cap → 验抛 budget_exceeded |

单函数行为 → unit test 覆盖即可，无需 E2E（schema 验证是纯代码逻辑，不依赖真实 LLM）。

---

## 不做

- 不改 SKILL.md（Reviewer/Evaluator SKILL 已要求正确格式，是 LLM 执行可靠性问题）
- 不改 Proposer 节点（已有 verifyProposerOutput + git ls-remote 验证）
- 不引入外部 structured output API（保持 Docker 架构不变）
- 不加 maxAttempts 限制（budget 是唯一终止条件）

---

## 成功标准

- `ReviewerOutputSchema` / `EvaluatorOutputSchema` 单元测试全绿
- reviewer 节点 mock 测试：rubric 缺维度 → 重试 → 最终拿到完整 rubric
- `PERMANENT_ERROR_RE` 包含 `schema_mismatch`
- CI L1/L2/L3 全绿
