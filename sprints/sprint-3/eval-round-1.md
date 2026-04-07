# Sprint 3 — Evaluator 评估报告（第 1 轮）

> 评估时间：2026-04-07
> Evaluator task_id: db76bc6b-282b-4c4a-84f4-05c22fe82aeb
> 评估结论：**FAIL** — 2 项 SC 未实现

---

## 验证结果汇总

| SC | 描述 | 结果 |
|----|------|------|
| SC-1 | execution.js — sprint_contract_review verdict 严格解析 | ✅ PASS |
| SC-2 | execution.js — sprint_contract_propose 轮次安全阀（MAX_PROPOSE_ROUNDS = 5） | ❌ FAIL |
| SC-3 | sprint-evaluator SKILL.md — SC 验证命令 exit code 判断规则 | ✅ PASS |
| SC-4 | sprint-contract-reviewer SKILL.md — 轮次感知逻辑（round >= 3 偏向 APPROVED） | ❌ FAIL |

---

## 失败项详情

### SC-2 FAIL：MAX_PROPOSE_ROUNDS 未实现

**问题**：`packages/brain/src/routes/execution.js` 的 `sprint_contract_review REVISION` 分支（约第 1658 行）注释写"无轮次上限"，但合同要求添加 `MAX_PROPOSE_ROUNDS = 5` 安全阀。

**修复要求**：
1. 在 execution.js 中定义常量 `MAX_PROPOSE_ROUNDS = 5`
2. 在 REVISION 分支判断：若 `nextRound > MAX_PROPOSE_ROUNDS`，记录 `console.error` 并停止（不再创建新的 `sprint_contract_propose` 任务）

**验证命令**：
```bash
node -e "
const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
if (!c.includes('MAX_PROPOSE_ROUNDS')) { console.error('FAIL'); process.exit(1); }
const match = c.match(/MAX_PROPOSE_ROUNDS\s*=\s*(\d+)/);
if (!match || parseInt(match[1]) !== 5) { console.error('FAIL value'); process.exit(1); }
console.log('PASS');
"
```

---

### SC-4 FAIL：sprint-contract-reviewer SKILL.md 无轮次感知逻辑

**问题**：`packages/workflows/skills/sprint-contract-reviewer/SKILL.md` 的 Phase 3 判断逻辑未包含轮次感知规则——当 `propose_round >= 3` 时应偏向 APPROVED（除非有不可验证的 SC 或范围超 5 个）。

**修复要求**：
在 Phase 3 的 APPROVED 条件前加入轮次感知规则：
- 当 `propose_round >= 3` 时，只要没有不可验证的 SC 且总 SC 数 ≤ 5，应偏向 APPROVED

**验证命令**：
```bash
node -e "
const c = require('fs').readFileSync('packages/workflows/skills/sprint-contract-reviewer/SKILL.md', 'utf8');
const hasRound = c.includes('propose_round') || c.includes('round >= 3') || c.includes('轮次');
const hasApprove = c.includes('APPROVED') && (c.includes('偏向') || c.includes('优先') || c.includes('应当'));
if (!hasRound || !hasApprove) { console.error('FAIL'); process.exit(1); }
console.log('PASS');
"
```

---

## 修复指令

Generator 需在本轮（R1）修复以上 2 个 FAIL 项，再次提交 PR，触发 Evaluator R2 复验。
