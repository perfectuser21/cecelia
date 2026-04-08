# 合同审查反馈（第 3 轮）

**审查者**: Evaluator  
**审查轮次**: Round 3  
**判决**: REVISION

---

## 必须修改

### 1. [命令太弱] Feature D — 测试内容检查仅验证关键词存在，无法排除零断言测试

**问题**：

```js
if (!/propose_round|MAX_CONTRACT_PROPOSE_ROUNDS/.test(content)) { ... }
```

这只检查测试文件中出现了 `propose_round` 或 `MAX_CONTRACT_PROPOSE_ROUNDS` 字样。以下实现能完全蒙混过关，但实际上没有验证任何行为：

```js
describe('propose_round tests', () => {
  it('handles MAX_CONTRACT_PROPOSE_ROUNDS', () => {
    const propose_round = 5; // 变量名含关键词
    // 无 expect()，零断言
  })
})
```

vitest 默认不因零断言失败，`npm test` 返回 exit code 0，所有 Feature D 命令 PASS。Generator 写一个空测试框架就能通过合同，而实际控制流完全未经测试。

**修复方式**：测试内容检查加断言存在验证：

```js
if (!/propose_round|MAX_CONTRACT_PROPOSE_ROUNDS/.test(content)) { ... }
// 同时验证测试有实际断言
if (!content.includes('expect(') && !content.includes('assert(')) {
  console.error('FAIL: 测试文件无 expect()/assert() 断言'); process.exit(1);
}
// 更严格：验证针对 sprint_contract_propose 和 sprint_generate 的具体断言
if (!/sprint_contract_propose|sprint_generate/.test(content)) {
  console.error('FAIL: 测试未验证 task_type 行为'); process.exit(1);
}
```

---

### 2. [缺失边界] Feature A — PRD 声明的 propose_round 缺失默认值无任何验证命令

**问题**：

合同 Feature A 的行为描述明确写道：
> `propose_round` 缺失时默认为 1，不崩溃

但合同的两条验证命令只检查：
- 常量 `MAX_CONTRACT_PROPOSE_ROUNDS = 5` 存在
- 控制流守卫 regex 存在

一个完全没有实现 `propose_round` 默认值逻辑（即 `propose_round` 为 `undefined` 时直接报 `TypeError: Cannot compare undefined >= 5` 崩溃）的实现能通过所有验证命令。

**修复方式**：新增代码静态检查命令，验证有 null/undefined 守卫：

```bash
node -e "
  const c = require('fs').readFileSync('packages/brain/src/execution.js','utf8');
  const hasDefault = /propose_round\s*\?\?[^:]+[:]\s*1/.test(c) ||
                     /propose_round\s*\|\|\s*1/.test(c) ||
                     /propose_round\s*===?\s*undefined[^;]*[;\n][^}]*1/.test(c) ||
                     /parseInt[^)]*propose_round[^)]*\)\s*\|\|\s*1/.test(c);
  if (!hasDefault) {
    console.error('FAIL: 未找到 propose_round 缺失时默认为 1 的守卫逻辑'); process.exit(1);
  }
  console.log('PASS: propose_round 有默认值守卫');
"
```

---

### 3. [命令太弱] Feature B — Reviewer SKILL.md 仅检查 git push 存在，未验证 add→commit→push 顺序

**问题**：

Proposer 验证命令同时检查了 `git push origin HEAD` 存在**且** `lastIndexOf('git add') < lastIndexOf('git push')`（顺序正确）。

但 Reviewer 验证命令只检查：

```js
if (!c.includes('git push origin HEAD')) { ... }
```

未验证 `git add` 在 `git push` 之前。一个 Reviewer SKILL.md 里只写了 `git push` 但没有 `git add` 的实现（push 一个未暂存文件，feedback 文件丢失）能通过此命令。

**修复方式**：与 Proposer 保持对称，加顺序检查：

```js
const addIdx = c.lastIndexOf('git add');
const pushIdx = c.lastIndexOf('git push');
if (addIdx === -1 || addIdx > pushIdx) {
  console.error('FAIL: reviewer SKILL.md git add 顺序错误或缺失'); process.exit(1);
}
console.log('PASS: reviewer SKILL.md 含 git push，add→commit→push 顺序正确');
```

---

## 可选改进

- **Feature A 控制流 regex**：`/nextRound\s*[>]=?\s*MAX_CONTRACT_PROPOSE_ROUNDS/` 仍可被注释行蒙混（`// nextRound >= MAX_CONTRACT_PROPOSE_ROUNDS`）。建议加 `^[^/]*` 前缀排除注释，或改为依赖 Feature D 运行时测试而完全去掉此静态 regex 检查。由于 Feature D 已有 npm test 命令，影响有限，但与 R2 反馈同类问题值得修复。

---

## 已通过项

- Feature A：常量存在性检查（值精确匹配为 5）— 严格有效 ✅
- Feature A：控制流 regex（相比 R2 弱字符串检查有改进）— 可接受 ✅
- Feature B：Proposer add→commit→push 顺序检查 — 严格有效 ✅
- Feature C：skill 文件大小检查、task-router 正则（修复了 R2 引号风格问题）、skills-index 检查 — 三层验证广谱有效 ✅
- Feature D：`bash -c 'set -o pipefail; ...'` 修复了 R2 的 tail 掩盖 exit code 问题 ✅
- 无任何占位符，所有命令可直接执行 ✅
