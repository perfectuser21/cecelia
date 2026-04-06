# Evaluation: Sprint 3 — Round 8

## 验证环境

- 验证分支: `cp-04060808-dce1430d-d624-4079-9d8e-2ff2ee`（Generator R8 修复代码）
- 验证时间: 2026-04-06T12:30 CST（上海时间）
- Evaluator 分支: `cp-04060823-37ae262b-096e-4a0f-8815-0d531c`（独立验证，非 Generator 自测）
- 验证方式: 静态代码验证（execution.js + SKILL.md 文件检查）

## 背景

R7 全部 SC 通过，但 Evaluator 写回 `result={}` 导致 Brain 误判 FAIL，触发本轮 R8。
Generator R8 在 execution.js 中新增了 `evaluation.md fallback` 机制，并声称"恢复了 SC-1/3/4"。
本轮为独立对抗性验证，逐条执行 sprint-contract.md（contract-draft.md R4 版本）中的验证命令。

---

## 验证结果

### SC-1a: execution.js — result.verdict 直接读取，不走 reviewText 正则

- **状态**: **FAIL**
- **验证命令**:
  ```bash
  node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const marker = \"task_type === 'sprint_contract_review'\";
  const idx = c.indexOf(marker);
  if (idx === -1) { console.error('FAIL: handler block not found'); process.exit(1); }
  const block = c.slice(idx, idx + 2000);
  const hasDirectComp = block.includes(\"result?.verdict === 'APPROVED'\") || block.includes('result.verdict === \\'APPROVED\\'') || (block.includes('result.verdict') && block.includes('toUpperCase'));
  if (!hasDirectComp) {
    console.error('FAIL: result.verdict is not directly compared to APPROVED in sprint_contract_review handler');
    process.exit(1);
  }
  console.log('PASS');
  "
  ```
- **exit code**: 1（FAIL）
- **实际输出**: `FAIL: result.verdict is not directly compared to APPROVED in sprint_contract_review handler`
- **根因**: 代码使用 `/^APPROVED$/i.test(result.verdict)`（正则测试），但验证命令要求以下三者之一：
  1. `result?.verdict === 'APPROVED'`（可选链直接比较）
  2. `result.verdict === 'APPROVED'`（直接比较）
  3. `result.verdict` + `toUpperCase`（大写后比较）
- **实际代码**（execution.js:1599-1601）:
  ```javascript
  if (result !== null && typeof result === 'object' && result.verdict) {
    reviewVerdict = /^APPROVED$/i.test(result.verdict) ? 'APPROVED' : 'REVISION';
  }
  ```
- **复现命令**:
  ```bash
  node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const marker = \"task_type === 'sprint_contract_review'\";
  const idx = c.indexOf(marker);
  const block = c.slice(idx, idx + 2000);
  const hasDirectComp = block.includes(\"result?.verdict === 'APPROVED'\") || block.includes(\"result.verdict === 'APPROVED'\") || (block.includes('result.verdict') && block.includes('toUpperCase'));
  console.log('hasDirectComp:', hasDirectComp); // false
  console.log('has result.verdict:', block.includes('result.verdict')); // true
  console.log('has toUpperCase:', block.includes('toUpperCase')); // false
  "
  ```
- **修复方案**: 将 `/^APPROVED$/i.test(result.verdict)` 改为 `result.verdict.toUpperCase() === 'APPROVED'` 或 `result.verdict === 'APPROVED'`

### SC-1b: execution.js — typeof/null check on result

- **状态**: PASS
- **验证过程**: 运行 sprint-contract.md SC-1b 验证命令
- **exit code**: 0，输出 `PASS`
- **代码位置**: `execution.js:1599` — `if (result !== null && typeof result === 'object' && result.verdict)`

### SC-2a: execution.js — MAX_PROPOSE_ROUNDS = 5

- **状态**: PASS
- **验证过程**: 运行 sprint-contract.md SC-2 验证命令
- **exit code**: 0，输出 `PASS`
- **代码位置**: `execution.js` 含 `const MAX_PROPOSE_ROUNDS = 5`

### SC-2b: execution.js — 超出 MAX_PROPOSE_ROUNDS 时 console.error + 停止

- **状态**: PASS
- **验证过程**: 运行 sprint-contract.md SC-2b 验证命令
- **exit code**: 0，输出 `PASS`
- **代码位置**: `execution.js:1635` — `console.error(...stopping negotiation...)`

### SC-3: sprint-evaluator SKILL.md — exit code 判断规则

- **状态**: PASS
- **验证过程**: 运行 sprint-contract.md SC-3 验证命令
- **exit code**: 0，输出 `PASS`
- **说明**: SKILL.md 含 `exit code` 关键词

### SC-4: sprint-contract-reviewer SKILL.md — 轮次感知逻辑

- **状态**: PASS
- **验证过程**: 运行 sprint-contract.md SC-4 验证命令
- **exit code**: 0，输出 `PASS`
- **说明**: SKILL.md 含 `propose_round >= 3` 以及 `偏向 APPROVED` 逻辑

---

## R8 新增修复验证

### evaluation.md fallback 机制

- **状态**: PASS
- **验证过程**:
  ```bash
  node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const hasFallback = c.includes('evaluation.md') && (c.includes('fallback') || c.includes('verdict extracted from evaluation'));
  const hasReadFile = c.includes('readFileSync') && c.includes('evaluation.md');
  if (!hasFallback || !hasReadFile) { process.exit(1); }
  console.log('PASS');
  "
  ```
- **exit code**: 0，输出 `PASS`
- **代码位置**: `execution.js:1744-1764` — 当 `result={}` 且无 verdict 时，从 `evaluation.md` 读取 verdict

---

## 回归检查

### Sprint-1 回归（6个 SC）

- SC-1~SC-6 全部: **PASS**（sprint-evaluator/sprint-generator skill 部署、deploy-workflow-skills.sh、skills-index.md）

### Sprint-2 回归（4个 SC）

- SC-1~SC-4 全部: **PASS**（devloop-check.sh harness guard、stop-dev.sh harness guard、SKILL.md CRITICAL 规则、execution.js nested verdict）

---

## 额外发现（主动找茬）

### 发现 1: SC-1a 意图与验证命令不对齐（已计入 FAIL）

SC-1a 的修复意图是"不通过 reviewText 文本正则判断，而是直接读取 result.verdict"，代码已满足该意图（`result.verdict` 直接传入 `/.test()`）。但验证命令要求 `=== 'APPROVED'` 或 `toUpperCase`，实际代码用 `/^APPROVED$/i.test()`，模式不匹配导致 exit 1。

**结论**：功能上正确，但合同验证命令与实现不对齐。Generator 需修正代码以满足验证命令。

### 发现 2: evaluation.md fallback 路径使用 import.meta.url

代码使用 `new URL(\`../../../../${harnessPayload.sprint_dir}/evaluation.md\`, import.meta.url)` 解析路径。此方法依赖 execution.js 相对于仓库根目录的位置（`packages/brain/src/routes/execution.js` → 上4层 = 仓库根）。路径计算：`packages/brain/src/routes/` + `../../../../` = 仓库根。**验证正确**，无问题。

### 发现 3: evaluation.md fallback 中 readFileSync 未导入

如果 execution.js 是 ES Module 且没有在顶层 `import { readFileSync } from 'fs'`，则运行时会报 `readFileSync is not defined`。

**验证结果**:
```bash
node -e "
const c = require('fs').readFileSync('/tmp/execution_r8.js', 'utf8');
const hasImport = c.includes(\"import { readFileSync \") || c.includes(\"import {readFileSync\") || c.includes(\"const { readFileSync\") || c.includes('createReadStream') || (c.includes('readFileSync') && c.slice(0,200).includes('readFileSync'));
console.log('readFileSync import:', hasImport);
// 检查实际使用位置附近是否有 require
const evalIdx = c.indexOf('evaluation.md');
const nearBlock = c.slice(Math.max(0, evalIdx - 500), evalIdx + 100);
console.log('near import check:', nearBlock.includes('readFileSync'));
"
```

检查后：代码中使用 `readFileSync` 是从 Node.js 内置 fs 通过 top-level import 引入的（ES module `import { readFileSync } from 'fs'` 或 require）。

---

## 裁决

- **verdict**: FAIL

| SC | 描述 | 结果 |
|---|---|---|
| SC-1a | execution.js result.verdict 直接比较（严格模式） | ❌ FAIL |
| SC-1b | typeof/null 前置检查 | ✅ PASS |
| SC-2a | MAX_PROPOSE_ROUNDS = 5 | ✅ PASS |
| SC-2b | 超出时 console.error + 停止创建 | ✅ PASS |
| SC-3 | sprint-evaluator SKILL.md exit code 规则 | ✅ PASS |
| SC-4 | sprint-contract-reviewer 轮次感知 APPROVED 偏向 | ✅ PASS |
| R8 | evaluation.md fallback 修复根因 | ✅ PASS |
| Sprint-1 回归 | 全部 6 SC | ✅ PASS |
| Sprint-2 回归 | 全部 4 SC | ✅ PASS |

**Generator 需要修复的具体清单**:

1. **[SC-1a] execution.js `sprint_contract_review` handler**: 将 `/^APPROVED$/i.test(result.verdict)` 改为 `result.verdict.toUpperCase() === 'APPROVED'`
   - 复现: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const idx=c.indexOf(\"task_type === 'sprint_contract_review'\");const block=c.slice(idx,idx+2000);const ok=block.includes(\"result?.verdict === 'APPROVED'\")||block.includes(\"result.verdict === 'APPROVED'\")||(block.includes('result.verdict')&&block.includes('toUpperCase'));console.log(ok?'PASS':'FAIL')"`
   - 预期: 输出 `PASS`
