# Contract DoD — 刀A6：judge 证据截断误判修复

**Task ID**: ea20ba86-9ce4-4fbf-84cd-987a8b3f5ba6
**Sprint Dir**: sprints/07151610-judge-evidence-truncation

---

## [BEHAVIOR] 条目

### [BEHAVIOR-1] 截断复现（failing test）

**描述**：在修复前，当 behavior_tests[0].log_tail 超过 1500 字符时，behavior_tests[1].log_tail 中的 KEYMARK 不出现在 buildJudgePrompt 输出中。

**前置条件**：
- brainResult = `{ behavior_tests: [{ command: 'test1', exit_code: 0, log_tail: 'A'.repeat(1500) }, { command: 'test2', exit_code: 0, log_tail: 'PREFIX_KEYMARK_SUFFIX' }] }`
- 使用修复前的序列化逻辑（JSON.stringify(brainResult).slice(0, 2000)）

**断言**：`buildJudgePrompt({...}, brainResult).includes('KEYMARK') === false`

**manual:bash**：
```bash
cd /workspace && node -e "
const { buildJudgePrompt } = require('./packages/brain/src/harness-judge.js');
// 此命令仅在 failing test commit 后、修复 commit 前有效
// 验证方式：运行测试文件中的 BEHAVIOR-1 用例
" 2>&1 || true
cd /workspace && npx vitest run packages/brain/src/__tests__/harness-judge-evidence-compress.test.js --reporter=verbose 2>&1 | grep -E "(BEHAVIOR-1|截断复现|KEYMARK|✓|✗|PASS|FAIL)"
```

---

### [BEHAVIOR-2] 修复后 KEYMARK 可见（核心回归测试）

**描述**：修复后，behavior_tests[1].log_tail 中的 KEYMARK 必须出现在 buildJudgePrompt 输出中，每条 behavior_tests 条目均有可见代表。

**前置条件**：
- 同 BEHAVIOR-1 的 brainResult 构造
- 已实现 compressBrainResult 并替换第 233 行

**断言**：
- `buildJudgePrompt({...}, brainResult).includes('KEYMARK') === true`
- prompt 中包含 behavior_tests[0] 的 command 字段
- prompt 中包含 behavior_tests[1] 的 command 字段

**manual:bash**：
```bash
cd /workspace && npx vitest run packages/brain/src/__tests__/harness-judge-evidence-compress.test.js --reporter=verbose 2>&1 | grep -E "(BEHAVIOR-2|修复后|KEYMARK|✓|✗)"
```

---

### [BEHAVIOR-3] 条目上限：10 条输入只展开前 8 条

**描述**：当 behavior_tests 有 10 条时，compressBrainResult 输出只展开前 8 条，并追加「另有 2 条已省略」。

**前置条件**：
- brainResult.behavior_tests = Array(10).fill(null).map((_, i) => ({ command: `cmd-${i}`, exit_code: 0, log_tail: 'short' }))

**断言**：
- `compressBrainResult(brainResult).includes('cmd-0') === true`
- `compressBrainResult(brainResult).includes('cmd-7') === true`
- `compressBrainResult(brainResult).includes('cmd-8') === false`（第 9 条不展开）
- `compressBrainResult(brainResult).includes('另有 2 条已省略') === true`

**manual:bash**：
```bash
cd /workspace && npx vitest run packages/brain/src/__tests__/harness-judge-evidence-compress.test.js --reporter=verbose 2>&1 | grep -E "(BEHAVIOR-3|条目上限|另有.*条已省略|✓|✗)"
```

---

### [BEHAVIOR-4] 单条超长 log_tail 截断标记

**描述**：单条 behavior_tests 的 log_tail 超过 600 字符时，compressBrainResult 将其截至 600 字符并追加「…（已截断）」标记。

**前置条件**：
- brainResult.behavior_tests = [{ command: 'test', exit_code: 0, log_tail: 'X'.repeat(800) }]

**断言**：
- 输出中该条目 log_tail 部分长度不超过 600 字符（不计截断标记本身）
- `compressBrainResult(brainResult).includes('…（已截断）') === true`

**manual:bash**：
```bash
cd /workspace && npx vitest run packages/brain/src/__tests__/harness-judge-evidence-compress.test.js --reporter=verbose 2>&1 | grep -E "(BEHAVIOR-4|超长|截断标记|已截断|✓|✗)"
```

---

### [BEHAVIOR-5] 总长度预算 ≤ 6000 字符

**描述**：任意合理输入下，compressBrainResult 输出总长度不超过 6000 字符。

**前置条件**：
- brainResult.behavior_tests = Array(8).fill(null).map((_, i) => ({ command: 'C'.repeat(300), exit_code: 1, log_tail: 'L'.repeat(800) }))
- 顶层 log_tail = 'T'.repeat(600)

**断言**：`compressBrainResult(brainResult).length <= 6000`

**manual:bash**：
```bash
cd /workspace && node -e "
const { compressBrainResult } = require('./packages/brain/src/harness-judge.js');
const brainResult = {
  verdict: 'FAIL', exit_code: 1,
  log_tail: 'T'.repeat(600),
  behavior_tests: Array(8).fill(null).map((_, i) => ({ command: 'C'.repeat(300), exit_code: 1, log_tail: 'L'.repeat(800) }))
};
const out = compressBrainResult(brainResult);
console.log('length:', out.length, out.length <= 6000 ? 'OK' : 'FAIL: 超出 6000 字符');
"
```

---

### [BEHAVIOR-6] 既有测试 0 回归

**描述**：harness-judge.test.js / harness-judge-mechanical-gate.test.js / harness-judge-api.test.js 所有既有测试全部通过，无任何回归。

**前置条件**：修复已完成，compressBrainResult 已替换第 233 行

**断言**：所有既有测试文件 vitest 结果 0 failures

**manual:bash**：
```bash
cd /workspace && npx vitest run \
  packages/brain/src/__tests__/harness-judge.test.js \
  packages/brain/src/__tests__/harness-judge-mechanical-gate.test.js \
  packages/brain/src/__tests__/harness-judge-api.test.js \
  2>&1 | tail -20
```

---

### [BEHAVIOR-7] compressBrainResult 命名导出可用

**描述**：compressBrainResult 作为命名导出存在于 harness-judge.js，可被独立 import。

**断言**：`typeof compressBrainResult === 'function'`

**manual:bash**：
```bash
cd /workspace && node -e "
const mod = require('./packages/brain/src/harness-judge.js');
console.log('compressBrainResult:', typeof mod.compressBrainResult === 'function' ? 'OK（命名导出存在）' : 'FAIL（未导出）');
"
```

---

### [BEHAVIOR-8] 旧截断写法已从源码移除

**描述**：harness-judge.js 第 233 行（或附近）不再含 `JSON.stringify(brainResult).slice`，已替换为 compressBrainResult 调用。

**断言**：grep 搜索旧写法返回空

**manual:bash**：
```bash
grep -n "JSON.stringify(brainResult).slice" /workspace/packages/brain/src/harness-judge.js \
  && echo "FAIL: 旧截断写法仍存在" \
  || echo "OK: 旧截断已移除"

grep -n "compressBrainResult(brainResult)" /workspace/packages/brain/src/harness-judge.js \
  && echo "OK: compressBrainResult 调用已注入" \
  || echo "FAIL: compressBrainResult 调用未找到"
```

---

## 铁律检查清单

| 铁律 | 验证方式 | manual:bash |
|------|----------|-------------|
| 只动证据序列化，不动裁决逻辑 | grep validateCoverage 无改动 | `git diff main -- packages/brain/src/harness-judge.js \| grep -A5 -B5 validateCoverage` |
| failing test 先 commit | git log 顺序检查 | `git log --oneline -- packages/brain/src/__tests__/harness-judge-evidence-compress.test.js` |
| regression test 永久留存 | 测试文件存在且被 CI 引用 | `ls -la /workspace/packages/brain/src/__tests__/harness-judge-evidence-compress.test.js` |
| buildJudgePrompt 签名不变 | grep 函数签名 | `grep -n "function buildJudgePrompt\|export.*buildJudgePrompt" /workspace/packages/brain/src/harness-judge.js` |

---

## 全量验收命令（一键执行）

```bash
cd /workspace && npx vitest run \
  packages/brain/src/__tests__/harness-judge-evidence-compress.test.js \
  packages/brain/src/__tests__/harness-judge.test.js \
  packages/brain/src/__tests__/harness-judge-mechanical-gate.test.js \
  packages/brain/src/__tests__/harness-judge-api.test.js \
  2>&1 | tail -30

grep -n "JSON.stringify(brainResult).slice" /workspace/packages/brain/src/harness-judge.js \
  && echo "FAIL: 旧截断仍存在" || echo "OK"

node -e "const {compressBrainResult}=require('./packages/brain/src/harness-judge.js');console.log(typeof compressBrainResult==='function'?'compressBrainResult: OK':'FAIL')"
```
