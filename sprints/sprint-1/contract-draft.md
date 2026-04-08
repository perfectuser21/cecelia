# 合同草案（第 1 轮）

**Generator**: sprint-contract-proposer  
**日期**: 2026-04-08  
**Sprint 目标**: Harness v3.0 对标官方设计重构 — Sprint 1

---

## 本次实现的功能

- Feature 1: sprint-planner SKILL.md 重构 — 每个 SC 必须包含可执行验证命令
- Feature 2: sprint-evaluator SKILL.md 重构 — 从独立验证者改为机械执行器（执行 spec 里的命令，看 exit code）
- Feature 3: execution.js 修改 — sprint_planner 完成后直接创建 sprint_generate，跳过 contract_propose/review 阶段

---

## 验收标准（DoD）

### Feature 1: sprint-planner SKILL.md 重构

**行为描述**：
- 当 Planner 运行后，写入 sprint-prd.md 的每个 SC（Success Criteria）条目必须包含 `验证命令:` 字段
- 当 SC 涉及 API 行为时，验证命令必须是实际可执行的 `curl` 命令（含完整 URL + 预期输出）
- 当 SC 涉及文件/代码存在时，验证命令必须是 `node -e "require('fs').accessSync(...)"` 形式
- 当 SC 涉及 DB 状态时，验证命令必须是 `psql` 或 `node -e "..."` 查询形式
- 当验证命令执行成功（exit 0）时，代表该 SC 已通过；exit 非 0 代表失败
- 当 Planner 输出的 spec 中含有模糊词（"合理"、"正确"、"适当"）时，应在可量化标准部分替换为具体数值或可判断的状态

**硬阈值**：
- `sprint-prd.md` 中每个 SC 条目必须含 `验证命令:` 字段（缺失为 FAIL）
- 验证命令必须以白名单命令开头：`curl`、`node`、`psql`、`npm`、`bash` 之一
- 禁止出现 `grep`、`ls`、`cat`、`echo` 作为验证命令（弱测试）
- sprint-planner SKILL.md 版本号必须升级（如 3.0.0 → 4.0.0）

**验证命令**：
```bash
node -e "
const fs = require('fs');
const c = fs.readFileSync('packages/workflows/skills/sprint-planner/SKILL.md', 'utf8');
// 版本必须 >= 4.0
const vMatch = c.match(/version:\s*([\d]+)\./);
if (!vMatch || parseInt(vMatch[1]) < 4) { console.error('FAIL: version not bumped to v4.x'); process.exit(1); }
// 必须包含验证命令相关指引
if (!c.includes('验证命令') && !c.includes('verify') && !c.includes('executable')) { 
  console.error('FAIL: no verify command guidance'); process.exit(1); 
}
console.log('PASS');
"
```

**验收判断**：Evaluator 执行上方命令检查 exit code，并手动检查 sprint-planner SKILL.md 中 SC 格式规范

---

### Feature 2: sprint-evaluator SKILL.md 重构

**行为描述**：
- 当 Evaluator 运行时，从 sprint-prd.md 中提取每个 SC 的 `验证命令:` 字段
- 当执行每条验证命令后，检查 exit code：0 = PASS，非 0 = FAIL
- 当所有命令均 exit 0 时，Evaluator 输出 `{"verdict": "PASS"}`
- 当任意命令 exit 非 0 时，记录失败命令和输出，输出 `{"verdict": "FAIL", "failures": [...]}`
- 当验证命令不在白名单时（非 curl/node/psql/npm/bash），Evaluator 应跳过并记录警告
- 禁止 Evaluator 自主设计验证方案（不再是独立验证者，是机械执行器）
- 当 sprint-prd.md 不存在时，Evaluator 应失败并报告错误（不崩溃）

**硬阈值**：
- sprint-evaluator SKILL.md 中不得出现"自主设计测试"、"独立验证者"等旧版描述（必须移除）
- 必须包含"从 sprint-prd.md 提取验证命令"的明确指引
- 版本号必须升级（当前 4.0.0 → 5.0.0）
- SKILL.md 中必须包含 `exit code` 判断逻辑说明

**验证命令**：
```bash
node -e "
const c = require('fs').readFileSync('packages/workflows/skills/sprint-evaluator/SKILL.md', 'utf8');
// 版本必须 >= 5
const vMatch = c.match(/version:\s*([\d]+)\./);
if (!vMatch || parseInt(vMatch[1]) < 5) { console.error('FAIL: version not bumped to v5.x'); process.exit(1); }
// 必须包含机械执行相关关键词
if (!c.includes('exit code') && !c.includes('exit_code')) { 
  console.error('FAIL: no exit code checking guidance'); process.exit(1); 
}
// 禁止还有独立验证者描述
if (c.includes('独立广谱验证者') || c.includes('自主设计')) { 
  console.error('FAIL: old independent-verifier description still present'); process.exit(1); 
}
// 必须包含从 sprint-prd.md 读命令的逻辑
if (!c.includes('sprint-prd.md') && !c.includes('验证命令')) { 
  console.error('FAIL: no sprint-prd.md read instruction'); process.exit(1); 
}
console.log('PASS');
"
```

**验收判断**：Evaluator 执行上方命令检查 exit code

---

### Feature 3: execution.js — sprint_planner 完成后直接创建 sprint_generate

**行为描述**：
- 当 sprint_planner 任务完成回调时，execution.js 不再创建 `sprint_contract_propose`，而是直接创建 `sprint_generate`
- 当 sprint_generate 创建时，payload 中传入 `sprint_dir`、`planner_task_id`、`harness_mode: true`
- 当 sprint_contract_propose 或 sprint_contract_review 类型任务完成时，execution.js 不崩溃（兼容旧任务，打 warning log 即可）
- 当执行旧的 contract GAN 流程时（已有未完成的 sprint_contract_propose 任务），继续允许它们跑完（不中断进行中的流程）

**硬阈值**：
- `execution.js` 中 sprint_planner 完成分支：下一个任务类型必须是 `sprint_generate`（不是 `sprint_contract_propose`）
- `execution.js` 第 1689-1718 行区域（sprint_planner → contract_propose）必须被修改或注释掉
- 新增的 sprint_planner → sprint_generate 分支必须传递 `sprint_dir` 和 `planner_task_id` 到 payload

**验证命令**：
```bash
node -e "
const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
// sprint_planner 完成后不应创建 sprint_contract_propose
const plannerBlock = c.match(/harnessType === 'sprint_planner'[\s\S]{0,1500}/);
if (!plannerBlock) { console.error('FAIL: sprint_planner block not found'); process.exit(1); }
const block = plannerBlock[0].substring(0, 1500);
if (block.includes('sprint_contract_propose')) { 
  console.error('FAIL: sprint_planner still routes to sprint_contract_propose'); process.exit(1); 
}
if (!block.includes('sprint_generate')) { 
  console.error('FAIL: sprint_planner does not route to sprint_generate'); process.exit(1); 
}
console.log('PASS');
"
```

**验收判断**：Evaluator 执行上方命令检查 exit code

---

## 技术实现方向（高层）

- 修改 `packages/workflows/skills/sprint-planner/SKILL.md`：在 Phase 2 的 sprint-prd.md 格式中，每个 SC 必须含 `验证命令:` 字段，并给出示例（curl/node/psql 格式）
- 修改 `packages/workflows/skills/sprint-evaluator/SKILL.md`：重写为机械执行器，核心逻辑是读 sprint-prd.md → 提取每个 SC 的验证命令 → 执行 → 检查 exit code → 汇总 PASS/FAIL
- 修改 `packages/brain/src/routes/execution.js`：sprint_planner 分支改为直接创建 sprint_generate（移除 contract_propose 创建逻辑）
- 注意 `sprint-planner` 和 `sprint-evaluator` 改动需 Engine 版本 bump（5 个文件）
- Brain execution.js 改动需 Brain 版本 bump

---

## 不在本次范围内

- 删除 sprint_contract_propose/review 任务类型（保留枚举，避免 DB 约束失败）
- 修改 sprint-generator skill（下一 Sprint）
- 修改 task-router.js 中的路由映射
- 更新 harness 测试文件（`harness-sprint-loop-v3.test.js`）— Sprint 2 完成
- sprint_report 格式变更
