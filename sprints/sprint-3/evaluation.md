# Evaluation: Sprint 3 — Round 1

## 验证环境

- 测试端口: N/A（静态代码验证，无需启动服务）
- 验证分支: `origin/cp-04060600-960b0811-1d10-4af1-927f-9425d1`（Generator 分支，PR #1962）
- 验证基准: `sprints/sprint-3/contract-draft.md`（Round 3 草案）
- 验证时间: 2026-04-06 21:09 CST
- 状态: PARTIAL — **sprint-contract.md 缺失**，基于 contract-draft.md 进行验证

---

## 关键前置问题

**P0: sprint-contract.md 不存在**

Generator 未在 `sprints/sprint-3/sprint-contract.md` 创建最终合同文件。
sprint-generator SKILL.md Step 2 明确要求 Generator 写入该文件。
Evaluator 无法按标准流程验证，改用 `contract-draft.md` 的 DoD 条目作为验收基准。

复现：
```bash
git show origin/cp-04060600-960b0811-1d10-4af1-927f-9425d1:sprints/sprint-3/sprint-contract.md
# 输出: fatal: Path 'sprints/sprint-3/sprint-contract.md' does not exist
```

---

## 验证结果

### Feature 1: 合同协商最大轮次保护

#### F1-SC-1: MAX_PROPOSE_ROUNDS 常量存在
- 状态: **PASS**
- 验证命令: `node -e "const c=require('fs').readFileSync('/tmp/execution.js','utf8');if(!c.includes('MAX_PROPOSE_ROUNDS'))process.exit(1);console.log('PASS')"`
- 实际结果: 输出 `PASS`，`MAX_PROPOSE_ROUNDS` 常量存在于 execution.js

#### F1-SC-2: 到达上限时写入特定日志
- 状态: **FAIL**
- 验证命令（来自 contract-draft.md）: 检查 `force-approving` + `max rounds`
- 实际结果: execution.js 写的是 `stopping negotiation`，**不含 `force-approving`，不含 `max rounds`**
- 复现:
  ```bash
  grep "force-approving\|max rounds" packages/brain/src/routes/execution.js
  # 无输出
  grep "stopping negotiation" packages/brain/src/routes/execution.js
  # 输出：sprint_contract_review REVISION but MAX_PROPOSE_ROUNDS exceeded... stopping negotiation
  ```
- 问题: contract-draft 要求日志包含 `force-approving` 和 `max rounds`，Generator 写的是不同的日志文本

#### F1-SC-3: MAX_PROPOSE_ROUNDS = 3，边界为 round 4 触发强制批准
- 状态: **FAIL**
- 验证命令（来自 contract-draft.md）: `const m=c.match(/MAX_PROPOSE_ROUNDS\s*=\s*(\d+)/);if(!m||parseInt(m[1])!==3)process.exit(1)`
- 实际结果: `MAX_PROPOSE_ROUNDS = 5`，**与合同不符（合同要求 3）**
- 复现:
  ```bash
  grep "MAX_PROPOSE_ROUNDS = " packages/brain/src/routes/execution.js
  # 输出: const MAX_PROPOSE_ROUNDS = 5;
  ```
- 问题: contract-draft 要求 `MAX_PROPOSE_ROUNDS = 3`（round 3 正常、round 4 触发），Generator 设为 5。且超限行为是"停止"而非"强制批准"，与合同要求的语义不一致。

---

### Feature 2: PRD + 草案文件持久化（sprint-contract-proposer SKILL.md）

#### F2-SC-1: SKILL.md 包含 git add + git commit 步骤
- 状态: **FAIL**
- 验证命令（来自 contract-draft.md）: 检查 `git add` + `git commit` 在 sprint-contract-proposer/SKILL.md 中
- 实际结果: 文件**不包含** `git add` 或 `git commit` 任何内容
- 复现:
  ```bash
  node -e "const c=require('fs').readFileSync('packages/workflows/skills/sprint-contract-proposer/SKILL.md','utf8');if(!c.includes('git add')||!c.includes('git commit'))process.exit(1);console.log('PASS')"
  # 退出码: 1（FAIL）
  ```
- 问题: Generator 完全没有实现 Feature 2。sprint-contract-proposer SKILL.md 的 Phase 4 仍然只写"写入完成后返回"，没有 git 持久化步骤。

#### F2-SC-2: commit 消息包含 "harness auto-commit"
- 状态: **FAIL**
- 实际结果: SKILL.md 不含 `harness auto-commit`
- 复现: 同 F2-SC-1

#### F2-SC-3: nothing to commit 时跳过不报错
- 状态: **FAIL**
- 实际结果: SKILL.md 不含 `nothing to commit` 或 `跳过`
- 复现: 同 F2-SC-1

---

### Feature 3: Reviewer verdict 输出格式标准化

#### F3-SC-1: SKILL.md 要求 verdict JSON 在最后一行且独立
- 状态: **FAIL**
- 验证命令（来自 contract-draft.md）: 检查 `最后一行` + `独立` 在 sprint-contract-reviewer/SKILL.md
- 实际结果: 文件**不含 `最后一行`，不含 `独立`**（这两个词）
- 复现:
  ```bash
  node -e "const c=require('fs').readFileSync('packages/workflows/skills/sprint-contract-reviewer/SKILL.md','utf8');if(!c.includes('最后一行')||!c.includes('独立'))process.exit(1);console.log('PASS')"
  # 退出码: 1（FAIL）
  ```
- 问题: Generator 为 reviewer SKILL.md 添加了"轮次感知规则"（propose_round >= 3 时优先 APPROVED），但没有按 contract-draft 的 Feature 3 要求添加"最后一行独立 JSON"格式约束。

#### F3-SC-2: SKILL.md 包含 APPROVED 和 REVISION 的裸 JSON 示例
- 状态: **PASS**
- 验证命令: 检查 `"verdict": "APPROVED"` + `"verdict": "REVISION"`
- 实际结果: 两者均存在（Phase 4a/4b 各有示例）

---

## 额外发现（主动找茬）

### 发现 1: Generator 实现的内容与 contract-draft 不一致

Generator commit message 中的 SC-1/SC-2/SC-3/SC-4 与 contract-draft.md 的 Feature 1/2/3 存在偏差：

| contract-draft Feature | Generator 实际实现 |
|---|---|
| Feature 1: MAX_PROPOSE_ROUNDS=3，round>3强制批准 | SC-2: MAX_PROPOSE_ROUNDS=5，超限仅停止（不批准）|
| Feature 2: proposer SKILL.md git 持久化 | 未实现 |
| Feature 3: reviewer verdict JSON 最后一行独立 | SC-4: reviewer 轮次感知（propose_round>=3时倾向APPROVED）|

Generator 额外实现了 contract-draft 未要求的功能（SC-1: verdict 对象字段优先解析；SC-3: evaluator 验证命令判定规则）。这些额外改进有价值，但不能替代合同要求的功能。

### 发现 2: MAX_PROPOSE_ROUNDS 超限行为语义错误

contract-draft 要求：超出上限时"将现有草案升级为 sprint-contract.md 并创建 sprint_generate 任务"（强制批准）。
Generator 实现：超出上限时 `console.error(...)` 然后什么都不做（仅停止，不创建 sprint_generate）。

这导致 pipeline 在轮次耗尽时静默死锁——没有 error，没有后续任务，只有一条 console.error 然后什么都不发生。

复现:
```bash
grep -A 3 "MAX_PROPOSE_ROUNDS.*exceeded" packages/brain/src/routes/execution.js
# 只有 console.error，没有 createHarnessTask
```

### 发现 3: sprint-contract.md 缺失导致 Evaluator 无标准可依

按 Harness v2.0 协议，Generator 完成代码后必须在 `{sprint_dir}/sprint-contract.md` 写入最终验收标准。该文件缺失意味着：
- Evaluator 无法知道 Generator 自己对"完成"的定义是什么
- 后续 sprint_fix 循环无法追踪哪些 SC 已通过

---

## 裁决

- **verdict: FAIL**

### Generator 需要修复的具体清单

1. **[CRITICAL] 创建 sprints/sprint-3/sprint-contract.md**
   - 描述: Generator 未写最终合同文件，违反 sprint-generator SKILL.md Step 2 要求
   - 复现: `git show origin/cp-04060600-960b0811-1d10-4af1-927f-9425d1:sprints/sprint-3/sprint-contract.md` → fatal: not exist
   - 修复: 在 Generator 分支的 `sprints/sprint-3/sprint-contract.md` 中写入最终验收标准

2. **[FAIL] MAX_PROPOSE_ROUNDS 值错误（5 vs 合同要求 3）**
   - 描述: `execution.js` 中 `MAX_PROPOSE_ROUNDS = 5`，合同要求 `= 3`
   - 复现: `grep "MAX_PROPOSE_ROUNDS = " packages/brain/src/routes/execution.js`
   - 修复: 改为 `const MAX_PROPOSE_ROUNDS = 3;`

3. **[FAIL] 超限行为应强制批准而非仅停止**
   - 描述: 超出 MAX_PROPOSE_ROUNDS 时，代码仅打日志并静默停止，未创建 sprint_generate 任务（pipeline 死锁）
   - 复现: 查看 `if (nextRound > MAX_PROPOSE_ROUNDS)` 块内只有 `console.error`，无 `createHarnessTask`
   - 修复: 超限时执行强制批准逻辑（将 contract-draft.md 升级为 sprint-contract.md 并创建 sprint_generate 任务）

4. **[FAIL] 日志文本不符合合同要求（缺 force-approving + max rounds）**
   - 描述: 合同要求日志包含 `force-approving` 和 `max rounds`，实际写的是 `stopping negotiation`
   - 复现: `grep "force-approving\|max rounds" packages/brain/src/routes/execution.js` → 无输出
   - 修复: 日志改为 `[harness] contract negotiation max rounds reached, force-approving`

5. **[FAIL] Feature 2 完全未实现：sprint-contract-proposer SKILL.md 无 git 持久化**
   - 描述: SKILL.md Phase 4 仍是旧版（只说"写入完成后返回"），缺少 git add + git commit 步骤
   - 复现: `node -e "const c=require('fs').readFileSync('packages/workflows/skills/sprint-contract-proposer/SKILL.md','utf8');if(!c.includes('git add'))process.exit(1);console.log('PASS')"` → exit 1
   - 修复: 在 Phase 3 后添加 Phase 3.5: git add + git commit（消息含 `harness auto-commit`）+ nothing-to-commit 容错

6. **[FAIL] Feature 3 部分未实现：reviewer SKILL.md 缺"最后一行独立 JSON"约束**
   - 描述: Generator 添加了轮次感知规则，但未添加合同要求的"最后一行裸 JSON"格式约束
   - 复现: `node -e "const c=require('fs').readFileSync('packages/workflows/skills/sprint-contract-reviewer/SKILL.md','utf8');if(!c.includes('最后一行')||!c.includes('独立'))process.exit(1);console.log('PASS')"` → exit 1
   - 修复: 在 Phase 4b 输出规范中加入"verdict JSON 必须在最后一行独立输出（无代码块包裹）"的明确约束
