# Harness Schema Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Reviewer 和 Evaluator 节点加 Zod schema 验证，LLM 输出格式不合格时节点内自动重试，直到 budget 耗尽为止。

**Architecture:** 在 `harness-shared.js` 导出两个 Zod schema（ReviewerOutputSchema / EvaluatorOutputSchema）和 `readAndValidateBrainResult`。Reviewer 节点在现有 GAN 循环内加 schema 验证 + 不合格则 `continue` 重新 spawn。Evaluator 节点的 Protocol v2.5 分支加 Zod 验证，不合格 throw `schema_mismatch`（已在 PERMANENT_ERROR_RE 白名单外，触发 LangGraph retry）。

**Tech Stack:** Node.js ESM, Zod (root node_modules), LangGraph, vitest

---

## 文件清单

| 操作 | 文件 |
|---|---|
| Modify | `packages/brain/src/harness-shared.js` |
| Modify | `packages/brain/src/workflows/harness-gan.graph.js` |
| Modify | `packages/brain/src/workflows/harness-task.graph.js` |
| Modify | `packages/brain/src/workflows/retry-policies.js` |
| Modify | `packages/brain/package.json` |
| Create | `packages/brain/src/__tests__/harness-schema-validation.test.js` |

---

## Task 1: 安装 zod 依赖 + 添加 schemas 到 harness-shared.js

**Files:**
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/src/harness-shared.js`
- Create: `packages/brain/src/__tests__/harness-schema-validation.test.js`

- [ ] **Step 1: 写失败测试**

创建 `packages/brain/src/__tests__/harness-schema-validation.test.js`：

```javascript
import { describe, it, expect } from 'vitest';
import { ReviewerOutputSchema, EvaluatorOutputSchema, readAndValidateBrainResult } from '../harness-shared.js';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

describe('ReviewerOutputSchema', () => {
  it('接受完整合法输出', () => {
    const valid = {
      verdict: 'APPROVED',
      rubric_scores: {
        dod_machineability: 8,
        scope_match_prd: 7,
        test_is_red: 9,
        internal_consistency: 8,
        risk_registered: 7,
      },
      feedback: '合同质量良好',
    };
    expect(ReviewerOutputSchema.safeParse(valid).success).toBe(true);
  });

  it('拒绝缺少 rubric 维度', () => {
    const missing = {
      verdict: 'APPROVED',
      rubric_scores: {
        dod_machineability: 8,
        scope_match_prd: 7,
        // test_is_red 缺失
        internal_consistency: 8,
        risk_registered: 7,
      },
      feedback: '...',
    };
    expect(ReviewerOutputSchema.safeParse(missing).success).toBe(false);
  });

  it('拒绝分数超出 1-10 范围', () => {
    const outOfRange = {
      verdict: 'REVISION',
      rubric_scores: {
        dod_machineability: 11,  // 超出范围
        scope_match_prd: 7,
        test_is_red: 9,
        internal_consistency: 8,
        risk_registered: 7,
      },
      feedback: '...',
    };
    expect(ReviewerOutputSchema.safeParse(outOfRange).success).toBe(false);
  });

  it('拒绝非法 verdict', () => {
    const badVerdict = {
      verdict: 'PASS',  // 应为 APPROVED|REVISION
      rubric_scores: {
        dod_machineability: 8, scope_match_prd: 7, test_is_red: 9,
        internal_consistency: 8, risk_registered: 7,
      },
      feedback: '...',
    };
    expect(ReviewerOutputSchema.safeParse(badVerdict).success).toBe(false);
  });
});

describe('EvaluatorOutputSchema', () => {
  it('接受 PASS verdict', () => {
    expect(EvaluatorOutputSchema.safeParse({ verdict: 'PASS', feedback: 'ok' }).success).toBe(true);
  });

  it('接受 FIXED verdict', () => {
    expect(EvaluatorOutputSchema.safeParse({ verdict: 'FIXED', feedback: 'ok' }).success).toBe(true);
  });

  it('拒绝非法 verdict', () => {
    expect(EvaluatorOutputSchema.safeParse({ verdict: 'APPROVED', feedback: 'ok' }).success).toBe(false);
  });

  it('task_id 可选', () => {
    expect(EvaluatorOutputSchema.safeParse({ verdict: 'PASS', feedback: 'ok' }).success).toBe(true);
    expect(EvaluatorOutputSchema.safeParse({ verdict: 'PASS', task_id: 'abc', feedback: 'ok' }).success).toBe(true);
  });
});

describe('readAndValidateBrainResult', () => {
  function makeTmpDir(content) {
    const dir = mkdtempSync(path.join(tmpdir(), 'brain-result-'));
    writeFileSync(path.join(dir, '.brain-result.json'), JSON.stringify(content));
    return dir;
  }

  it('合法数据正常返回', async () => {
    const dir = makeTmpDir({
      verdict: 'APPROVED',
      rubric_scores: {
        dod_machineability: 8, scope_match_prd: 7, test_is_red: 9,
        internal_consistency: 8, risk_registered: 7,
      },
      feedback: 'good',
    });
    const result = await readAndValidateBrainResult(dir, ReviewerOutputSchema);
    expect(result.verdict).toBe('APPROVED');
    expect(result.rubric_scores.test_is_red).toBe(9);
  });

  it('缺维度时 throw schema_mismatch', async () => {
    const dir = makeTmpDir({
      verdict: 'APPROVED',
      rubric_scores: { dod_machineability: 8 },  // 缺 4 个维度
      feedback: 'ok',
    });
    await expect(readAndValidateBrainResult(dir, ReviewerOutputSchema))
      .rejects.toMatchObject({ code: 'schema_mismatch' });
  });

  it('文件不存在时 throw（来自 readBrainResult）', async () => {
    await expect(readAndValidateBrainResult('/nonexistent/path', ReviewerOutputSchema))
      .rejects.toThrow('missing_result_file');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/administrator/worktrees/cecelia/harness-schema-validation
npx vitest run packages/brain/src/__tests__/harness-schema-validation.test.js 2>&1 | tail -20
```

期望：`ReviewerOutputSchema is not exported` 或类似导入错误

- [ ] **Step 3: 安装 zod 依赖**

```bash
cd /Users/administrator/worktrees/cecelia/harness-schema-validation
npm install zod --workspace=packages/brain
```

- [ ] **Step 4: 在 harness-shared.js 加 import + schemas + readAndValidateBrainResult**

在 `packages/brain/src/harness-shared.js` 的 `import { readFileSync, existsSync }` 行后面加：

```javascript
import { z } from 'zod';
```

在文件末尾（`readBrainResult` 函数之后）追加：

```javascript
// ─── Zod Output Schemas（自研 Structured Output 验证层）───────────────────────
//
// 替代 Anthropic Agent SDK structured outputs —— 不需要 API Key，保持 Docker 架构。
// 节点读 .brain-result.json 后用 schema.safeParse() 验证，不合格 throw schema_mismatch，
// 调用方选择：节点内 continue 重试（Reviewer）或 LangGraph retry（Evaluator）。

export const ReviewerOutputSchema = z.object({
  verdict: z.enum(['APPROVED', 'REVISION']),
  rubric_scores: z.object({
    dod_machineability:   z.number().min(1).max(10),
    scope_match_prd:      z.number().min(1).max(10),
    test_is_red:          z.number().min(1).max(10),
    internal_consistency: z.number().min(1).max(10),
    risk_registered:      z.number().min(1).max(10),
  }),
  feedback: z.string(),
});

export const EvaluatorOutputSchema = z.object({
  verdict:  z.enum(['PASS', 'FAIL', 'FIXED']),
  task_id:  z.string().optional(),
  feedback: z.string(),
});

/**
 * readBrainResult + Zod schema 深度验证。
 * 失败时 throw Error with code='schema_mismatch'（PERMANENT_ERROR_RE 白名单内，不走 LLM_RETRY）。
 */
export async function readAndValidateBrainResult(worktreePath, schema) {
  const data = await readBrainResult(worktreePath);
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    const err = new Error(`ContractViolation: schema_mismatch — ${issues}`);
    err.code = 'schema_mismatch';
    throw err;
  }
  return result.data;
}
```

- [ ] **Step 5: 跑测试确认全绿**

```bash
cd /Users/administrator/worktrees/cecelia/harness-schema-validation
npx vitest run packages/brain/src/__tests__/harness-schema-validation.test.js 2>&1 | tail -20
```

期望：`✓ 9 tests passed`

- [ ] **Step 6: commit**

```bash
cd /Users/administrator/worktrees/cecelia/harness-schema-validation
git add packages/brain/package.json packages/brain/package-lock.json \
        packages/brain/src/harness-shared.js \
        packages/brain/src/__tests__/harness-schema-validation.test.js
git commit -m "feat: add ReviewerOutputSchema + EvaluatorOutputSchema + readAndValidateBrainResult to harness-shared"
```

---

## Task 2: retry-policies.js — schema_mismatch 加入 PERMANENT_ERROR_RE

**Files:**
- Modify: `packages/brain/src/workflows/retry-policies.js`

- [ ] **Step 1: 写失败测试**

在 `packages/brain/src/__tests__/harness-schema-validation.test.js` 追加：

```javascript
import { LLM_RETRY } from '../workflows/retry-policies.js';

describe('retry-policies schema_mismatch', () => {
  it('schema_mismatch 错误不被 LLM_RETRY 重试', () => {
    const err = new Error('ContractViolation: schema_mismatch — rubric_scores.test_is_red: Required');
    err.code = 'schema_mismatch';
    // retryOn 返回 false 表示不重试
    expect(LLM_RETRY.retryOn(err)).toBe(false);
  });

  it('普通 LLM 错误仍被重试', () => {
    const err = new Error('503 Service Unavailable');
    expect(LLM_RETRY.retryOn(err)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/administrator/worktrees/cecelia/harness-schema-validation
npx vitest run packages/brain/src/__tests__/harness-schema-validation.test.js --reporter=verbose 2>&1 | grep -A3 "schema_mismatch 错误"
```

期望：`AssertionError: expected true to be false`

- [ ] **Step 3: 修改 PERMANENT_ERROR_RE**

在 `packages/brain/src/workflows/retry-policies.js` 找到：

```javascript
const PERMANENT_ERROR_RE = /\b(401|403|invalid api key|invalid_api_key|schema|parse error|parse failed|validation failed|GraphInterrupt|AbortError)\b/i;
```

改为：

```javascript
const PERMANENT_ERROR_RE = /\b(401|403|invalid api key|invalid_api_key|schema|schema_mismatch|parse error|parse failed|validation failed|GraphInterrupt|AbortError)\b/i;
```

- [ ] **Step 4: 跑测试确认全绿**

```bash
cd /Users/administrator/worktrees/cecelia/harness-schema-validation
npx vitest run packages/brain/src/__tests__/harness-schema-validation.test.js 2>&1 | tail -10
```

期望：所有测试通过

- [ ] **Step 5: commit**

```bash
cd /Users/administrator/worktrees/cecelia/harness-schema-validation
git add packages/brain/src/workflows/retry-policies.js \
        packages/brain/src/__tests__/harness-schema-validation.test.js
git commit -m "feat: add schema_mismatch to PERMANENT_ERROR_RE in retry-policies"
```

---

## Task 3: harness-gan.graph.js — Reviewer 节点加 schema 验证循环

**Files:**
- Modify: `packages/brain/src/workflows/harness-gan.graph.js`
- Modify: `packages/brain/src/__tests__/harness-schema-validation.test.js`

- [ ] **Step 1: 写失败测试**

在测试文件追加（测试 reviewer 节点 schema 循环逻辑）：

```javascript
import { ReviewerOutputSchema } from '../harness-shared.js';

describe('reviewer schema retry 逻辑', () => {
  it('前两次 schema 不合格第三次合格 — 返回合格数据', async () => {
    const validData = {
      verdict: 'APPROVED',
      rubric_scores: {
        dod_machineability: 8, scope_match_prd: 7, test_is_red: 9,
        internal_consistency: 8, risk_registered: 7,
      },
      feedback: 'good',
    };
    const invalidData = { verdict: 'APPROVED', rubric_scores: { dod_machineability: 8 }, feedback: 'bad' };

    let callCount = 0;
    // 模拟：前2次返回不合格数据，第3次返回合格数据
    const mockSpawn = async () => {
      callCount++;
      return callCount < 3 ? invalidData : validData;
    };

    // 执行 schema 验证循环（提取为可测试的纯函数）
    const result = await runReviewerSchemaLoop(mockSpawn, ReviewerOutputSchema, 100);
    expect(result.verdict).toBe('APPROVED');
    expect(callCount).toBe(3);
  });

  it('budget 耗尽时 throw budget_exceeded', async () => {
    const mockSpawn = async () => ({
      verdict: 'APPROVED',
      rubric_scores: { dod_machineability: 8 },  // 永远缺维度
      feedback: 'bad',
      cost_usd: 60,  // 每次消耗 60，超过 100 cap
    });

    await expect(runReviewerSchemaLoop(mockSpawn, ReviewerOutputSchema, 100))
      .rejects.toThrow('gan_budget_exceeded');
  });
});
```

注意：`runReviewerSchemaLoop` 是从 `harness-gan.graph.js` 导出的辅助函数（下一步创建）。

- [ ] **Step 2: 在 harness-gan.graph.js 抽取 runReviewerSchemaLoop 并加 schema 验证**

在 `packages/brain/src/workflows/harness-gan.graph.js`：

**加 import**（在现有 import 行末尾追加）：

```javascript
import { ReviewerOutputSchema, readBrainResult } from '../harness-shared.js';
```

（注意：原来已有 `import { loadSkillContent, readBrainResult } from '../harness-shared.js'`，改为同时导入 `ReviewerOutputSchema`）

**在文件中导出新函数 `runReviewerSchemaLoop`**（加在 `computeVerdictFromRubric` 函数之后）：

```javascript
/**
 * reviewer spawn 后的 schema 验证循环。
 * spawnFn: async () => rawData（含 rubric_scores + verdict + feedback + cost_usd）
 * schema: Zod schema
 * budgetCap: number (USD)
 *
 * 不合格 → warn + 继续循环；budget 超 → throw gan_budget_exceeded。
 * 导出供测试使用。
 */
export async function runReviewerSchemaLoop(spawnFn, schema, budgetCap, accumulatedCost = 0) {
  while (true) {
    const raw = await spawnFn();
    accumulatedCost += Number(raw?.cost_usd || 0);

    if (accumulatedCost > budgetCap) {
      throw new Error(`gan_budget_exceeded: spent=${accumulatedCost.toFixed(3)} cap=${budgetCap}`);
    }

    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      console.warn(`[harness-gan] schema_mismatch, retrying: ${issues}`);
      continue;
    }

    return { ...parsed.data, cost_usd: raw?.cost_usd, _raw: raw };
  }
}
```

**在 reviewer 节点中使用**，找到（约 427 行）：

```javascript
const resultData = result._reconnected ? result : await readBrainResult(worktreePath, ['verdict', 'rubric_scores']);
```

改为：

```javascript
const resultData = result._reconnected
  ? result
  : await (async () => {
      const raw = await readBrainResult(worktreePath);
      const parsed = ReviewerOutputSchema.safeParse(raw);
      if (!parsed.success) {
        const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
        console.warn(`[harness-gan] reviewer schema_mismatch round=${currentRound}, retrying node: ${issues}`);
        throw new Error(`ContractViolation: schema_mismatch — ${issues}`);
      }
      return parsed.data;
    })();
```

同样找到另一处（约 412 行 readOutput 里）：

```javascript
const data = await readBrainResult(wt, ['verdict', 'rubric_scores', 'feedback']);
```

改为：

```javascript
const raw = await readBrainResult(wt);
const parsed = ReviewerOutputSchema.safeParse(raw);
if (!parsed.success) return null;
const data = parsed.data;
```

- [ ] **Step 3: 跑测试**

```bash
cd /Users/administrator/worktrees/cecelia/harness-schema-validation
npx vitest run packages/brain/src/__tests__/harness-schema-validation.test.js 2>&1 | tail -15
```

期望：所有测试通过

- [ ] **Step 4: 跑既有 GAN 测试确认不回归**

```bash
cd /Users/administrator/worktrees/cecelia/harness-schema-validation
npx vitest run packages/brain/src/workflows/__tests__/harness-gan.graph.test.js 2>&1 | tail -15
```

期望：全绿

- [ ] **Step 5: commit**

```bash
cd /Users/administrator/worktrees/cecelia/harness-schema-validation
git add packages/brain/src/workflows/harness-gan.graph.js \
        packages/brain/src/__tests__/harness-schema-validation.test.js
git commit -m "feat: reviewer node schema validation — retry until budget exhausted"
```

---

## Task 4: harness-task.graph.js — Evaluator Protocol v2.5 加 schema 验证

**Files:**
- Modify: `packages/brain/src/workflows/harness-task.graph.js`
- Modify: `packages/brain/src/__tests__/harness-schema-validation.test.js`

- [ ] **Step 1: 写失败测试**

在测试文件追加：

```javascript
import { EvaluatorOutputSchema } from '../harness-shared.js';

describe('EvaluatorOutputSchema 验证', () => {
  it('缺 feedback 字段时 throw schema_mismatch', async () => {
    const dir = makeTmpDir({ verdict: 'PASS' });  // 缺 feedback
    await expect(readAndValidateBrainResult(dir, EvaluatorOutputSchema))
      .rejects.toMatchObject({ code: 'schema_mismatch' });
  });

  it('完整 evaluator 输出正常返回', async () => {
    const dir = makeTmpDir({ verdict: 'PASS', feedback: 'all checks passed', task_id: 'ws1' });
    const result = await readAndValidateBrainResult(dir, EvaluatorOutputSchema);
    expect(result.verdict).toBe('PASS');
  });
});
```

- [ ] **Step 2: 跑测试确认结果**

```bash
cd /Users/administrator/worktrees/cecelia/harness-schema-validation
npx vitest run packages/brain/src/__tests__/harness-schema-validation.test.js 2>&1 | tail -10
```

期望：EvaluatorOutputSchema 测试通过（schema 已在 Task 1 定义）

- [ ] **Step 3: 修改 evaluateContractNode Protocol v2.5 分支**

在 `packages/brain/src/workflows/harness-task.graph.js`：

**加 import**，找到：

```javascript
import { parseDockerOutput, extractField, readPrFromGitState, readVerdictFile, readBrainResult } from '../harness-shared.js';
```

改为：

```javascript
import { parseDockerOutput, extractField, readPrFromGitState, readVerdictFile, readBrainResult, EvaluatorOutputSchema } from '../harness-shared.js';
```

**在 Protocol v2.5 分支**（约 608-622 行），找到：

```javascript
  if (state.worktreePath) {
    try {
      const brainResult = await readBrainResult(state.worktreePath, ['verdict']);
      const normV = normalizeVerdict(brainResult.verdict);
      const feedback = brainResult.log_excerpt || brainResult.failed_step || null;
      return {
        evaluate_verdict: normV,
        evaluate_error: normV === 'FAIL' ? (feedback || 'evaluator returned FAIL') : null,
      };
    } catch {
      // .brain-result.json 不存在或字段缺失，继续 Protocol v1 fallback
    }
  }
```

改为：

```javascript
  if (state.worktreePath) {
    try {
      const brainResult = await readBrainResult(state.worktreePath, ['verdict']);
      // Zod schema 验证：不合格 throw schema_mismatch（PERMANENT_ERROR_RE 拦截，不走 LLM_RETRY）
      // 让 LangGraph 重跑整个 evaluate_contract 节点直到格式合格
      const parsed = EvaluatorOutputSchema.safeParse(brainResult);
      if (!parsed.success) {
        const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
        console.warn(`[evaluator] schema_mismatch, LangGraph will retry node: ${issues}`);
        const err = new Error(`ContractViolation: schema_mismatch — ${issues}`);
        err.code = 'schema_mismatch';
        throw err;
      }
      const normV = normalizeVerdict(parsed.data.verdict);
      const feedback = parsed.data.feedback || brainResult.log_excerpt || brainResult.failed_step || null;
      return {
        evaluate_verdict: normV,
        evaluate_error: normV === 'FAIL' ? (feedback || 'evaluator returned FAIL') : null,
      };
    } catch (e) {
      if (e.code === 'schema_mismatch') throw e;  // 重新抛出让 LangGraph 捕获
      // .brain-result.json 不存在或字段缺失，继续 Protocol v1 fallback
    }
  }
```

- [ ] **Step 4: 跑既有 evaluator 测试确认不回归**

```bash
cd /Users/administrator/worktrees/cecelia/harness-schema-validation
npx vitest run packages/brain/src/workflows/__tests__/harness-task-evaluator-verdict.test.js 2>&1 | tail -15
```

期望：全绿

- [ ] **Step 5: 跑所有 harness 相关测试**

```bash
cd /Users/administrator/worktrees/cecelia/harness-schema-validation
npx vitest run packages/brain/src/__tests__/harness-schema-validation.test.js \
  packages/brain/src/workflows/__tests__/harness-task.graph.test.js \
  packages/brain/src/workflows/__tests__/harness-gan.graph.test.js 2>&1 | tail -20
```

期望：全绿

- [ ] **Step 6: commit**

```bash
cd /Users/administrator/worktrees/cecelia/harness-schema-validation
git add packages/brain/src/workflows/harness-task.graph.js \
        packages/brain/src/__tests__/harness-schema-validation.test.js
git commit -m "feat: evaluator node schema validation via EvaluatorOutputSchema"
```

---

## Task 5: 全量 CI 验证

- [ ] **Step 1: 跑全量 brain 测试**

```bash
cd /Users/administrator/worktrees/cecelia/harness-schema-validation
npx vitest run packages/brain/src/ 2>&1 | tail -30
```

期望：全绿，无回归

- [ ] **Step 2: 检查 package-lock.json 是否需要更新**

```bash
cd /Users/administrator/worktrees/cecelia/harness-schema-validation
git status packages/brain/package-lock.json
```

若有改动，一并 stage。

- [ ] **Step 3: 最终 commit（如有遗漏文件）**

```bash
cd /Users/administrator/worktrees/cecelia/harness-schema-validation
git status
# 确认无未 stage 文件
```

