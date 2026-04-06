# Evaluation: Sprint 3 — Round 4

## 验证环境

- 测试端口: N/A（静态代码验证，从 Generator 分支 git show 提取文件验证）
- 测试数据库: N/A
- 验证时间: 2026-04-06 23:35:00 CST（上海时间）
- Generator 代码分支: `origin/cp-04060600-960b0811-1d10-4af1-927f-9425d1`
- Fix R4 分支: `origin/cp-04060657-090c1f06-31c0-4779-aca4-3f7b3a`
- Fix R4 主提交: `8b2e1fb1f fix(brain): 修复 H2 Haiku 调度测试 flaky — 确定性 sevenDayDeficit 排序`
- 评估轮次: R4（独立 Evaluator，对抗性验证）
- 背景: 本轮任务因 title overflow bug 重建（restored_from: title_overflow_bug），R3 PASS verdict 未被 Brain 处理

---

## 验证结果

### SC-1: execution.js — sprint_contract_review verdict 严格解析

**验证命令（合同原文 SC-1a）**:
```bash
node -e "
const c = require('fs').readFileSync('/tmp/sprint3-eval/execution.js', 'utf8');
const block = c.slice(c.indexOf('sprint_contract_review'), c.indexOf('sprint_contract_review') + 3000);
if (!block.includes('result?.verdict') && !block.includes('result.verdict')) {
  console.error('FAIL: no direct result.verdict access in sprint_contract_review block');
  process.exit(1);
}
console.log('PASS');
"
```

- **状态**: PASS（exit code 0，输出含 PASS）
- **验证过程**: 从 Generator fix 分支（fd11085dc）提取 execution.js 到 /tmp，运行合同验证命令
- **实际结果**: `sprint_contract_review` 块（1596-1660 行）中存在：
  ```js
  if (result !== null && typeof result === 'object' && result.verdict) {
    reviewVerdict = /^APPROVED$/i.test(result.verdict) ? 'APPROVED' : 'REVISION';
  } else {
    // 降级：文本正则（兼容旧格式）
    ...
  }
  ```

**验证命令（合同原文 SC-1b）**:

- **状态**: PASS（exit code 0，输出含 PASS）
- **实际结果**: 包含 `result !== null` 和 `typeof result` 双重检查

**深度对抗验证**:
- if/else 结构：对象路径在前，文本正则在 else（互斥，不重叠） ✅
- 空对象 `{}` 边界：`result.verdict = undefined`（falsy），条件整体为 false，安全降级到 else ✅
- `result = null` 边界：`result !== null` guard 阻止后续 `typeof null === 'object'` 的误判 ✅

---

### SC-2: execution.js — sprint_contract_propose 轮次安全阀

**验证命令（合同原文 SC-2a）**:

- **状态**: PASS（exit code 0，输出含 PASS）
- **实际结果**: `MAX_PROPOSE_ROUNDS = 5` 存在，正则 match[1] === '5'

**验证命令（合同原文 SC-2b）**:

- **状态**: PASS（exit code 0，输出含 PASS）
- **实际结果**:
  ```js
  const MAX_PROPOSE_ROUNDS = 5;
  const nextRound = (harnessPayload.propose_round || 1) + 1;
  if (nextRound > MAX_PROPOSE_ROUNDS) {
    console.error(`[execution-callback] harness: sprint_contract_review REVISION but MAX_PROPOSE_ROUNDS (${MAX_PROPOSE_ROUNDS}) exceeded at round ${nextRound - 1}, stopping negotiation`);
  } else {
    // 创建新 contract_propose 任务
  }
  ```

**深度对抗验证**:
- MAX_PROPOSE_ROUNDS 在 APPROVED 分支之后（revisionIdx=78206 > approvedIdx=77809） ✅
- guard 存在：`nextRound > MAX_PROPOSE_ROUNDS` ✅
- 超出时 if 分支内只有 console.error，没有 createHarnessTask（正确停止） ✅

---

### SC-3: sprint-evaluator SKILL.md — SC 验证命令 exit code 判断规则

**验证命令（合同原文）**:

- **状态**: PASS（exit code 0，输出含 PASS）
- **实际结果**: SKILL.md 第 223-227 行有明确三条规则：
  ```
  - exit code 非 0 → 该 SC **FAIL**（无论输出内容）
  - 输出不包含 "PASS" → 该 SC **FAIL**
  - exit code 为 0 且输出包含 "PASS" → 该 SC **PASS**
  不允许人工解读命令输出来绕过 exit code 和 PASS 检查。
  ```

**深度验证**: 规则明确、无歧义、位于可被 Evaluator 读到的 SKILL.md 中 ✅

---

### SC-4: sprint-contract-reviewer SKILL.md — 轮次感知逻辑

**验证命令（合同原文）**:

- **状态**: PASS（exit code 0，输出含 PASS）
- **实际结果**: 第 55-57 行有明确规则：
  ```
  **轮次感知规则（CRITICAL）**:
  当 `propose_round >= 3` 时，应优先接受（APPROVED）合同，除非存在以下情况之一：
  ```
  包含 `propose_round`、`>= 3`、`APPROVED`、`优先` 等关键词 ✅

---

## 额外发现（主动找茬）

### 发现 1: Fix R4 H2 Haiku 测试修复有效（✅ 无问题）

`8b2e1fb1f` 修复了 H2 测试的不确定性：
- **根因**: account1/account2/account3 使用相同 resetsInMin=120，sevenDayDeficit 几乎相等（≈91.67%），JavaScript sort 不稳定
- **修复**: account2 改用 `resetsInMin=60`（elapsed 更大 → deficit=95.83%），确保 H2 test 确定性排第一
- **验证**: 代码中 `makeRow('account2', 10, 60)` 明确使用 60 分钟重置周期，与修复说明一致

### 发现 2: R4 是 R3 PASS 的重建（⚠️ 信息性，非阻断）

R3 evaluation（branch `cp-04060650-7b9b7a9b`）已经判定 PASS，但由于 title overflow bug 导致 Brain 未处理该 verdict，触发了 sprint_fix R4（修复 H2 flaky test）和本次 R4 重测。这是系统行为，不是代码缺陷。

### 发现 3: sprint_evaluate verdict 解析健壮性（✅ Sprint 2 回归通过）

execution.js 的 sprint_evaluate 块支持嵌套 verdict（`result.result.verdict`），Sprint 2 功能完好。

### 发现 4: devloop-check.sh Sprint 2 回归通过（✅）

`packages/engine/lib/devloop-check.sh` 中 harness_mode guard 仍在 cleanup_done 之前，Sprint 2 SC-1 验收条件未被破坏。

---

## 裁决

- **verdict: PASS**
- SC-1/SC-2/SC-3/SC-4 全部通过合同规定的验证命令（exit code 0，输出含 PASS）
- 深度对抗性验证无阻断性问题
- Sprint 2 回归检查通过
- Fix R4（H2 Haiku 测试）修复合理有效
- 额外发现均为信息性，无阻断缺陷
