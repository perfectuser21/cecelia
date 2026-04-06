# Learning: Sprint 3 R8 — evaluation.md fallback 修复根因

**Branch**: cp-04060808-dce1430d-d624-4079-9d8e-2ff2ee
**Date**: 2026-04-06

## 问题描述

Sprint 3 evaluation 反复触发 sprint_fix，即使每轮评估结果均为 PASS（R4/R5/R6/R7）。

## 根本原因

Sprint Evaluator 每次写回任务时，`result` 字段为 `{}`（空对象），未包含 `verdict` 字段。
`execution.js` 在 result 无 verdict 时默认为 `'FAIL'`，触发 sprint_fix。

- R7 评估 → verdict=PASS（写入 evaluation.md）
- R7 任务回调 result={}
- execution.js: `const verdict = resultObj.verdict || 'FAIL'` → FAIL
- 创建 sprint_fix R8

同时，main 中的 sprint_contract_review 块被其他 PR 覆盖，SC-1/SC-3/SC-4 规则丢失。

## 修复内容

### 1. execution.js — evaluation.md fallback（新增）

当 `sprint_evaluate` result 无 verdict 且有 sprint_dir 时，从 evaluation.md 文件读取 verdict：
```js
if (!resultObj.verdict && harnessPayload.sprint_dir) {
  const evalPath = new URL(`../../../../${harnessPayload.sprint_dir}/evaluation.md`, import.meta.url);
  const evalContent = readFileSync(evalPath, 'utf8');
  const evalVerdictMatch = evalContent.match(/\*\*verdict\*\*:\s*(PASS|FAIL)/i) || ...;
  // extract and use verdict
}
```

### 2. execution.js — sprint_contract_review SC-1 恢复

恢复 `result !== null && typeof result === 'object' && result.verdict` 的直接读取方式。

### 3. sprint-evaluator SKILL.md — SC-3 规则恢复

恢复 exit code 非 0 判 FAIL + 输出不含 PASS 判 FAIL 的明确规则。

### 4. sprint-contract-reviewer SKILL.md — SC-4 规则恢复

恢复 `propose_round >= 3` 偏向 APPROVED 的轮次感知逻辑。

## 下次预防

- [ ] Evaluator 完成验证后，`result` 必须包含 `{verdict: "PASS"|"FAIL"}`，参考 SKILL.md Step 6
- [ ] PR 合并时检查 `sprint_contract_review` 块是否仍有 SC-1 代码（result.verdict 直接读取）
- [ ] execution.js 的 `const verdict = resultObj.verdict || 'FAIL'` 之前现在有多级 fallback，最终 fallback 是读 evaluation.md 文件
