# Evaluation: Sprint 3 — Round 8

## 验证环境

- 验证分支: `cp-04060808-dce1430d-d624-4079-9d8e-2ff2ee`（R8 修复，含 evaluation.md fallback）
- 验证时间: 2026-04-06T18:30 CST（上海时间）
- Generator 角色: Sprint Fix R8（修复 R7 误触发根因）

## 背景

R7 Evaluator 验证所有 SC PASS，但 `sprint_evaluate` 任务的 `result` 字段写回为 `{}`（空对象）。
Brain 的 `execution.js` 在 result 无 verdict 时默认为 FAIL，触发本轮 sprint_fix R8。

**R8 的职责**：
1. 修复根因：`execution.js` 在 `result={}` 时从 `evaluation.md` 文件读取 verdict（fallback）
2. 恢复 SC-1/SC-2/SC-3/SC-4 代码（main 中被其他 PR 覆盖的部分）

---

## 验证结果

### SC-1a: execution.js — result.verdict 直接读取

- **状态**: PASS
- **验证命令**:
  ```bash
  node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const block = c.slice(c.indexOf('sprint_contract_review'), c.indexOf('sprint_contract_review') + 3000);
  if (!block.includes('result?.verdict') && !block.includes('result.verdict')) { process.exit(1); }
  console.log('PASS');
  "
  ```
- **实际结果**: exit=0, 输出 `PASS`
- **代码位置**: `execution.js` — `if (result !== null && typeof result === 'object' && result.verdict)`

### SC-1b: execution.js — typeof/null check on result

- **状态**: PASS
- **验证命令**:
  ```bash
  node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const block = c.slice(c.indexOf('sprint_contract_review'), c.indexOf('sprint_contract_review') + 3000);
  if (!block.includes('typeof result') && !block.includes('result !== null')) { process.exit(1); }
  console.log('PASS');
  "
  ```
- **实际结果**: exit=0, 输出 `PASS`

### SC-2a: execution.js — MAX_PROPOSE_ROUNDS = 5

- **状态**: PASS
- **验证命令**:
  ```bash
  node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  if (!c.includes('MAX_PROPOSE_ROUNDS')) { process.exit(1); }
  const match = c.match(/MAX_PROPOSE_ROUNDS\s*=\s*(\d+)/);
  if (!match || parseInt(match[1]) !== 5) { process.exit(1); }
  console.log('PASS');
  "
  ```
- **实际结果**: exit=0, 输出 `PASS`

### SC-2b: execution.js — 超出 MAX_PROPOSE_ROUNDS 时 console.error + 停止

- **状态**: PASS
- **验证命令**:
  ```bash
  node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const revBlock = c.slice(c.indexOf('MAX_PROPOSE_ROUNDS'), c.indexOf('MAX_PROPOSE_ROUNDS') + 500);
  if (!revBlock.includes('console.error') && !revBlock.includes('stopping')) { process.exit(1); }
  console.log('PASS');
  "
  ```
- **实际结果**: exit=0, 输出 `PASS`

### SC-3: sprint-evaluator SKILL.md — exit code 判断规则

- **状态**: PASS
- **验证命令**:
  ```bash
  node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/sprint-evaluator/SKILL.md', 'utf8');
  const hasExitCode = c.includes('exit code') || c.includes('非 0') || c.includes('非0');
  const hasPassCheck = c.includes('PASS') && (c.includes('包含') || c.includes('输出'));
  if (!hasExitCode || !hasPassCheck) { process.exit(1); }
  console.log('PASS');
  "
  ```
- **实际结果**: exit=0, 输出 `PASS`
- **说明**: SKILL.md 已恢复 exit code 非 0 判 FAIL + 输出不含 PASS 判 FAIL 的明确规则

### SC-4: sprint-contract-reviewer SKILL.md — 轮次感知逻辑

- **状态**: PASS
- **验证命令**:
  ```bash
  node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/sprint-contract-reviewer/SKILL.md', 'utf8');
  const hasRound = c.includes('propose_round') || c.includes('轮次');
  const hasApprove = c.includes('APPROVED') && (c.includes('偏向') || c.includes('优先') || c.includes('应当'));
  if (!hasRound || !hasApprove) { process.exit(1); }
  console.log('PASS');
  "
  ```
- **实际结果**: exit=0, 输出 `PASS`
- **说明**: SKILL.md 已恢复 `propose_round >= 3` 偏向 APPROVED 的轮次感知逻辑

---

## R8 新增修复：evaluation.md fallback

- **状态**: PASS
- **修复位置**: `execution.js` — sprint_evaluate verdict 解析段
- **修复内容**: 当 `result={}` 且无 verdict 时，从 `{sprint_dir}/evaluation.md` 文件读取 verdict
- **根因**: Evaluator 写回 `result={}` → Brain 默认 FAIL → 无限 sprint_fix 循环

---

## 裁决

- **verdict**: PASS

| SC | 描述 | 结果 |
|---|---|---|
| SC-1a | execution.js result.verdict 直接读取 | ✅ PASS |
| SC-1b | typeof/null 前置检查 | ✅ PASS |
| SC-2a | MAX_PROPOSE_ROUNDS = 5 | ✅ PASS |
| SC-2b | 超出时 console.error + 停止创建 | ✅ PASS |
| SC-3 | sprint-evaluator SKILL.md exit code 规则 | ✅ PASS |
| SC-4 | sprint-contract-reviewer 轮次感知 APPROVED 偏向 | ✅ PASS |
| R8 | evaluation.md fallback 修复根因 | ✅ PASS |

Sprint 3 所有验收条件通过（R8 含根因修复）。
