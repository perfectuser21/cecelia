# Sprint 3 最终合同（Evaluator 审查通过 — R3）

> 审查轮次：第 3 轮 | 判决：APPROVED | 审查方：sprint-contract-reviewer

## 本 Sprint 实现的功能

Sprint 3 聚焦 **Harness v2.0 自身强化**，修复 4 个已知的系统脆弱点：

- **Feature 1**: `execution.js` — `sprint_contract_review` verdict 解析防误判（严格 JSON 字段优先）
- **Feature 2**: `execution.js` — `sprint_contract_propose` 协商轮次安全阀（MAX_PROPOSE_ROUNDS = 5）
- **Feature 3**: `sprint-evaluator/SKILL.md` — 明确 SC 验证命令的 exit-code 判断规则
- **Feature 4**: `sprint-contract-reviewer/SKILL.md` — 添加轮次感知逻辑（round >= 3 应偏向 APPROVED）

---

## 验收标准（DoD）

### SC-1: execution.js — sprint_contract_review verdict 严格解析

**背景**：当前 `/\bAPPROVED\b/` 正则在 reviewText 为 JSON 字符串时可能误判（如 reviewer 说"部分 APPROVED 但需修改"）。

修复方案：当 result 是对象且含 `verdict` 字段时，直接使用该字段，不走文本正则。

- [ ] execution.js 中 sprint_contract_review 分支的 verdict 提取代码，优先直接从 `result.verdict` 读取（当 result 是对象时）

  验证方式:
  ```bash
  node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const block = c.slice(c.indexOf('sprint_contract_review'), c.indexOf('sprint_contract_review') + 3000);
  if (!block.includes('result?.verdict') && !block.includes('result.verdict')) {
    console.error('FAIL: no direct result.verdict access in sprint_contract_review block');
    process.exit(1);
  }
  console.log('PASS');
  "
  ```

- [ ] 当 result 为对象且有 verdict 字段时，不再依赖 reviewText 的文本正则 `\bAPPROVED\b` 做决策

  验证方式:
  ```bash
  node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const block = c.slice(c.indexOf('sprint_contract_review'), c.indexOf('sprint_contract_review') + 3000);
  // 确认有对 result 类型的判断（typeof 或 !== null）
  if (!block.includes('typeof result') && !block.includes('result !== null')) {
    console.error('FAIL: no typeof/null check on result in sprint_contract_review');
    process.exit(1);
  }
  console.log('PASS');
  "
  ```

### SC-2: execution.js — sprint_contract_propose 轮次安全阀

**背景**：合同协商轮次无上限，可能因双方分歧导致无限循环。

- [ ] execution.js 的 `sprint_contract_review REVISION` 分支中，添加 `MAX_PROPOSE_ROUNDS`（值为 5）安全阀

  验证方式:
  ```bash
  node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  if (!c.includes('MAX_PROPOSE_ROUNDS')) {
    console.error('FAIL: MAX_PROPOSE_ROUNDS not found');
    process.exit(1);
  }
  // 确认值为 5
  const match = c.match(/MAX_PROPOSE_ROUNDS\s*=\s*(\d+)/);
  if (!match || parseInt(match[1]) !== 5) {
    console.error('FAIL: MAX_PROPOSE_ROUNDS value is not 5, got: ' + (match ? match[1] : 'not found'));
    process.exit(1);
  }
  console.log('PASS');
  "
  ```

- [ ] 超出 MAX_PROPOSE_ROUNDS 时，记录 `console.error` 警告并停止（不创建新的 sprint_contract_propose 任务）

  验证方式:
  ```bash
  node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const revBlock = c.slice(c.indexOf('MAX_PROPOSE_ROUNDS'), c.indexOf('MAX_PROPOSE_ROUNDS') + 500);
  if (!revBlock.includes('console.error') && !revBlock.includes('stopping')) {
    console.error('FAIL: no error log when MAX_PROPOSE_ROUNDS exceeded');
    process.exit(1);
  }
  console.log('PASS');
  "
  ```

### SC-3: sprint-evaluator SKILL.md — SC 验证命令 exit code 判断规则

**背景**：SKILL.md 目前描述了逐条验证，但未明确"当 node -e 验证命令返回 exit code != 0 或输出不含 PASS 时该 SC 标记为 FAIL"的规则。

- [ ] sprint-evaluator SKILL.md 明确说明：执行 sprint-contract.md 中的验证命令（`node -e "..."`）时，exit code 非 0 或输出不包含"PASS"，该 SC 为 FAIL

  验证方式:
  ```bash
  node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/sprint-evaluator/SKILL.md', 'utf8');
  const hasExitCode = c.includes('exit code') || c.includes('exit_code') || c.includes('非 0') || c.includes('非0');
  const hasPassCheck = c.includes('PASS') && (c.includes('包含') || c.includes('输出') || c.includes('output'));
  if (!hasExitCode || !hasPassCheck) {
    console.error('FAIL: exit code or PASS output check rule not found in sprint-evaluator SKILL.md');
    process.exit(1);
  }
  console.log('PASS');
  "
  ```

### SC-4: sprint-contract-reviewer SKILL.md — 轮次感知逻辑

**背景**：Reviewer 无轮次感知，可能在 R3/R4/R5 仍挑剔细节，导致协商无法收敛。

- [ ] sprint-contract-reviewer SKILL.md 中加入规则：当 `propose_round >= 3` 时，应优先接受（APPROVED）合同，除非存在无法验证的验收标准或范围超过 5 个 SC

  验证方式:
  ```bash
  node -e "
  const c = require('fs').readFileSync('packages/workflows/skills/sprint-contract-reviewer/SKILL.md', 'utf8');
  const hasRound = c.includes('propose_round') || c.includes('round >= 3') || c.includes('第3轮') || c.includes('轮次');
  const hasApprove = c.includes('APPROVED') && (c.includes('偏向') || c.includes('优先') || c.includes('应当'));
  if (!hasRound || !hasApprove) {
    console.error('FAIL: round-aware acceptance logic not found in sprint-contract-reviewer SKILL.md');
    process.exit(1);
  }
  console.log('PASS');
  "
  ```

---

## 技术实现方向

- **execution.js 修改**：仅修改 5c-harness 块中的 `sprint_contract_review` 分支（约 1598-1640 行），添加类型判断前置，并在 REVISION 分支加 MAX_PROPOSE_ROUNDS 守卫
- **SKILL.md 修改**：直接追加说明段落，不改变现有结构

---

## 不在本 Sprint 范围内

- `sprint_planner` 自动触发（thalamus.js）：风险高，留 Sprint 4
- `sprint_fix` 最大重试轮次调整：已有 MAX_EVAL_ROUNDS=15 保护，不动
- 合同格式变更：保持现有 SC-N 格式

---

## 是否为最后一个 Sprint

is_final: false
