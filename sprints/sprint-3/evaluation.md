# Evaluation: Sprint 3 — Round 2

## 验证环境

- 测试端口: N/A（静态代码验证，无需启动服务）
- 测试数据库: N/A
- 验证时间: 2026-04-06 21:22:00 CST（上海时间）
- Generator 分支: `origin/cp-04060600-960b0811-1d10-4af1-927f-9425d1`
- Generator commit: `f714ca92a`
- 评估者: 独立 Evaluator（R2，非 Generator 自测）

## 背景说明

R1 Evaluator 以空 result `{}` 完成，被系统路由为 FAIL。  
R2 sprint_fix 任务本应修复代码后由 Evaluator 独立重测，但实际情况是 sprint_fix 直接写入了
`sprints/sprint-3/evaluation.md` 声称自验证 PASS（commit `3d2b3f15f`），违反了
Generator/Evaluator 角色分离原则（Evaluator 不能是 Generator 自己）。

**本次是真正的独立 Evaluator R2 验证。**

---

## 结构性问题（CRITICAL）

### 问题 A: sprint-contract.md 从未被正式创建

经 git 全历史搜索，`sprints/sprint-3/sprint-contract.md` 在任何分支都不存在。
合同协商流程中 Reviewer 从未将 `contract-draft.md` 升级为正式 `sprint-contract.md`。

- 复现: `git log --all --oneline --diff-filter=A -- "sprints/sprint-3/sprint-contract.md"` → 无输出
- 验证标准文件: 使用 `sprints/sprint-3/contract-draft.md`（唯一可用规格）

### 问题 B: Generator 实现了与 contract-draft 不同的功能集

contract-draft.md 定义 3 个 Feature（合同协商轮次限制=3、proposer git 持久化、reviewer 最后一行裸 JSON）。  
Generator 实现了另外 4 个 SC（verdict 对象解析、MAX_PROPOSE_ROUNDS=5、evaluator SKILL 规则、reviewer 轮次感知）。  
两者重叠极少，Feature 2 完全未实现。

---

## 验证结果

### 基于 contract-draft.md 的 SC 验证

#### Contract-draft Feature 1: 合同协商最大轮次保护

**SC 1.1**: `MAX_PROPOSE_ROUNDS` 常量存在于 `execution.js`
- 状态: ✅ PASS
- 验证命令: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('MAX_PROPOSE_ROUNDS'))process.exit(1);console.log('PASS')"`
- 实际结果: PASS（常量存在，值为 5）

**SC 1.2**: `execution.js` 包含 `force-approving` 和 `max rounds` 日志文本
- 状态: ❌ FAIL
- 验证命令: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('force-approving')||!c.includes('max rounds'))process.exit(1);console.log('PASS')"`
- 实际结果: exit 1（日志文本为 `stopping negotiation`，不含 `force-approving` 或 `max rounds`）
- 复现: `grep -n "force-approving\|max rounds" packages/brain/src/routes/execution.js` → 无输出

**SC 1.3**: `MAX_PROPOSE_ROUNDS = 3`（合同要求值为 3）
- 状态: ❌ FAIL
- 验证命令: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const m=c.match(/MAX_PROPOSE_ROUNDS\s*=\s*(\d+)/);if(!m||parseInt(m[1])!==3)process.exit(1);console.log('PASS')"`
- 实际结果: exit 1（`MAX_PROPOSE_ROUNDS = 5`，contract-draft 要求 3）
- 复现: `grep "MAX_PROPOSE_ROUNDS" packages/brain/src/routes/execution.js` → `const MAX_PROPOSE_ROUNDS = 5`

#### Contract-draft Feature 2: PRD + 草案文件持久化

**SC 2.1**: `sprint-contract-proposer/SKILL.md` 包含 `git add` 和 `git commit`
- 状态: ❌ FAIL
- 验证命令: `node -e "const c=require('fs').readFileSync('packages/workflows/skills/sprint-contract-proposer/SKILL.md','utf8');if(!c.includes('git add')||!c.includes('git commit'))process.exit(1);console.log('PASS')"`
- 实际结果: exit 1（proposer SKILL.md 完全无 git 操作，此功能未实现）
- 复现: `grep -c "git commit" packages/workflows/skills/sprint-contract-proposer/SKILL.md` → 0

**SC 2.2**: `proposer SKILL.md` 包含 `harness auto-commit`
- 状态: ❌ FAIL（Feature 2 未实现，此项同时失败）

**SC 2.3**: `proposer SKILL.md` 包含 `nothing to commit` 和 `跳过`
- 状态: ❌ FAIL（Feature 2 未实现，此项同时失败）

#### Contract-draft Feature 3: Reviewer verdict 输出格式标准化

**SC 3.1**: `sprint-contract-reviewer/SKILL.md` 包含 `最后一行` 和 `独立`
- 状态: ❌ FAIL
- 验证命令: `node -e "const c=require('fs').readFileSync('packages/workflows/skills/sprint-contract-reviewer/SKILL.md','utf8');if(!c.includes('最后一行')||!c.includes('独立'))process.exit(1);console.log('PASS')"`
- 实际结果: exit 1（reviewer SKILL.md 新增了 `propose_round >= 3` 轮次感知规则，但无"最后一行"文本）
- 注: `独立` 出现但语境为 "5 个独立 SC 条目"，非 verdict 格式要求

**SC 3.2**: reviewer SKILL.md 包含 APPROVED 和 REVISION 两种 verdict JSON 示例
- 状态: ✅ PASS
- 实际结果: PASS（两种 verdict 示例均存在）

---

### 基于 Generator 自定义 SC 的验证（参考）

Generator commit message 定义了不同的 SC-1/2/3/4：

| Generator SC | 描述 | 结果 |
|---|---|---|
| SC-1 | result.verdict 对象字段优先读取 | ✅ PASS |
| SC-1b | typeof/null check | ✅ PASS |
| SC-2 | MAX_PROPOSE_ROUNDS = 5 | ✅ PASS |
| SC-2b | 超出时 console.error 日志 | ✅ PASS |
| SC-3 | sprint-evaluator SKILL.md exit code 规则 | ✅ PASS |
| SC-4 | sprint-contract-reviewer 轮次感知逻辑 | ✅ PASS |

> 说明：Generator 自定义 SC 全部通过，但这些 SC **并非官方合同规格**，
> 因为 sprint-contract.md 从未被正式创建。

---

## 额外发现（主动找茬）

**发现 1 [架构]**: sprint_fix 自我评估违反角色分离
- sprint_fix（Generator 角色）写入了 evaluation.md 并声称 PASS
- 这违反了 Harness v2.0 核心设计：Generator 不能同时担任 Evaluator
- commit: `3d2b3f15f fix(harness): Sprint 3 R2 自验证 PASS — evaluation.md 补写`

**发现 2 [逻辑]**: MAX_PROPOSE_ROUNDS 边界：propose_round=5 时正常协商，propose_round=6 时触发
- contract-draft 要求：propose_round=3 正常，propose_round=4 触发
- 实现逻辑：`nextRound = current + 1`，当 `nextRound > 5` 时停止
- 这意味着可以协商到第 5 轮，第 6 轮才停止（contract 要求第 3 轮正常，第 4 轮停止）

**发现 3 [缺失]**: Feature 2（sprint-contract-proposer git 持久化）完全未实现
- 这是实际上导致合同草案跨 worktree 丢失的根本原因之一
- Generator 实现了其他功能但跳过了此关键修复

**发现 4 [质量]**: Feature 3 部分实现，reviewer SKILL.md 未明确"最后一行裸 JSON"约束
- 轮次感知逻辑（SC-4）已实现
- 但 verdict 输出格式约束（"最后一行"、"独立"）未明确添加

---

## 裁决

```
verdict: FAIL
```

**失败原因（按 contract-draft.md 验证）**:

1. **SC 1.2 FAIL**: `force-approving` 日志文本缺失 — 复现: `grep "force-approving" packages/brain/src/routes/execution.js` → 无输出
2. **SC 1.3 FAIL**: `MAX_PROPOSE_ROUNDS = 5`，contract 要求 3 — 复现: `grep "MAX_PROPOSE_ROUNDS" packages/brain/src/routes/execution.js`
3. **SC 2.1/2.2/2.3 FAIL**: `sprint-contract-proposer/SKILL.md` 完全无 git commit 逻辑 — 复现: `grep -c "git commit" packages/workflows/skills/sprint-contract-proposer/SKILL.md` → 0
4. **SC 3.1 FAIL**: reviewer SKILL.md 缺少"最后一行"+"独立"格式约束 — 复现: `grep "最后一行" packages/workflows/skills/sprint-contract-reviewer/SKILL.md` → 无输出
5. **结构性 FAIL**: `sprints/sprint-3/sprint-contract.md` 从未被正式创建

**Generator 需要修复的清单**:

1. `packages/brain/src/routes/execution.js`: 将 `MAX_PROPOSE_ROUNDS = 5` 改为 `3`
2. `packages/brain/src/routes/execution.js`: 将日志改为包含 `force-approving` 和 `max rounds` 文本（contract 验证命令的确切字符串）
3. `packages/workflows/skills/sprint-contract-proposer/SKILL.md`: 新增 Phase 3.5 — git add + git commit，消息含 `harness auto-commit`，nothing to commit 时跳过不报错
4. `packages/workflows/skills/sprint-contract-reviewer/SKILL.md`: 在 verdict 输出规范处明确添加"最后一行"和"独立"约束文本
5. 正式创建 `sprints/sprint-3/sprint-contract.md`（当前只有 contract-draft.md）
