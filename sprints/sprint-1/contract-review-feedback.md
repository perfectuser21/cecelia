# 合同审查反馈（第 2 轮）

**审查者**: Evaluator  
**审查轮次**: Round 2  
**判决**: REVISION

---

## 必须修改

### 1. [命令无法检测失败] Feature 4 — `npm test | tail -20` 掩盖了 exit code

**问题**：

```bash
npm test -- --testPathPattern=harness-sprint-loop-v3 --reporter=verbose 2>&1 | tail -20
```

Bash pipe 的 exit code 是**最后一个命令**的 exit code。`tail` 始终返回 0，即使 `npm test` 所有测试全部失败，这条命令也会返回 0（PASS）。一个空的测试文件能蒙混过关。

**修复方式**：使用 `pipefail` 或分离命令：

```bash
bash -c 'set -o pipefail; npm test -- --testPathPattern=harness-sprint-loop-v3 2>&1 | tail -20'
```

或者直接运行 npm test 不接管道（exit code 会正确传播）。

---

### 2. [命令无 PASS/FAIL 信号] Feature 3 — psql 只输出数据行，无验证逻辑

**问题**：

```bash
psql cecelia -c "SELECT id, title, ... FROM tasks WHERE task_type = 'sprint_contract_propose' ..."
```

这只是一条 SELECT 查询，输出数据行，psql 无论查到什么都返回 exit code 0。Evaluator 无法从中得到 PASS/FAIL 判断。一个没有任何 quarantine 的任务列表也能"通过"这个命令。

**修复方式**：改成 node 脚本通过 psql 或 DB API 验证实际行为，或者完全移除这条命令，用其他可自动化的方式替代（如检查代码逻辑 + 单元测试覆盖）。

---

### 3. [验证逻辑太弱] Feature 3 — execution.js 文本位置检查可被注释蒙混

**问题**：

```javascript
const before = reviewSection.slice(0, revisionIdx);
if (!before.includes('result === null') && !before.includes('result == null')) { ... }
```

这只是检查字符串 `result === null` 是否出现在 `REVISION` 文本之前。以下任何一种方式都能让它通过，但实际没有正确的守卫逻辑：

- 代码注释：`// 注意：result === null 时不应该创建新任务`
- 字符串字面量：`console.log('check: result === null')`
- 不相关的 null 检查

**修复方式**：改为验证实际控制流，例如：

```javascript
// 检查 REVISION 分支确实在 result 非空条件内（判断有条件包裹）
const hasConditionalRevision = /if\s*\([^)]*result[^)]*\)[^{]*\{[^}]*REVISION/s.test(c) ||
  /result\s*&&[^;]*REVISION/.test(c) ||
  /result\s*!==?\s*null[^;]*[;\n][^}]*REVISION/.test(reviewSection);
```

或者改为依赖测试文件覆盖此场景（Feature 4 中的测试用例）并只验证测试通过，不做脆弱的代码文本检查。

---

## 可选改进

- **Feature 4 测试计数阈值**：PRD 说新增 2 个测试（contract_review null guard + sprint_report 幂等），阈值应为 `>= 11`，当前设 `>= 10` 偏宽松。

- **Feature 1 task-router 检查**：`c.includes("'sprint_report': '/sprint-report'")` 依赖精确的单引号风格，若代码改为双引号或增加空格会失败。建议改为 regex 或不区分引号的检查：`/sprint_report.*sprint-report/.test(c)`。

---

## 已通过项

- Feature 1：skill 部署检查、参数定义检查、步骤数检查 — 逻辑清晰，严格有效 ✅
- Feature 2：git push 顺序检查（add→commit→push）、reviewer 含 git fetch 检查 — 严格且广谱 ✅
- Feature 4：测试文件内容检查（幂等性关键词 + null guard 关键词）— 可接受 ✅
- 无任何占位符，命令均可直接执行 ✅
