# Contract Draft — 刀A6：judge 证据截断误判修复

**Task ID**: ea20ba86-9ce4-4fbf-84cd-987a8b3f5ba6
**Sprint Dir**: sprints/07151610-judge-evidence-truncation
**Journey Type**: internal_tool（纯 Node.js 函数修复，验收靠单元测试）
**Target Environment**: local_node

---

## 背景与问题陈述

`packages/brain/src/harness-judge.js` 第 233 行：

```js
brainResult ? JSON.stringify(brainResult).slice(0, 2000) : '（无）'
```

对整个 brainResult 做头部截断，导致 behavior_tests 后排条目（index ≥ 1）对裁判完全不可见，引发误判 FAIL。

task 5e9c0496 实证：3 条 behavior_tests 总计 3447 字符，压缩前裁判看不到第 2、3 条，误判"无测试执行输出"。

---

## 修复方案

新增 `compressBrainResult(brainResult)` 纯函数（同文件命名导出），结构化压缩规则：

- **顶层字段**：保留 `verdict` / `exit_code` / `log_tail`（截 500 字符）
- **behavior_tests**：逐条展开，每条保留 `command`（截 200）+ `exit_code` + `log_tail`（截 600）
- **条目上限**：8 条，超出部分追加「另有 N 条已省略」
- **总预算**：6000 字符（替换原 2000）
- **单条截断标记**：log_tail 超限时追加「…（已截断）」

第 233 行替换为 `compressBrainResult(brainResult)` 调用，`buildJudgePrompt` 对外签名不变。

---

## 铁律

1. **只动证据序列化**，不动裁决逻辑（verdict 判定路径）和机械闸（validateCoverage）
2. **failing test 先 commit**：在修改 harness-judge.js 之前，failing test 必须以失败状态进入 repo
3. **条目级公平**：每条 behavior_tests（至多前 8 条）必须在 prompt 中有可见代表，禁止整体头部截断
4. **regression test 永久留存**：failing test 转 passing 后不得删除，永久留在 CI

---

## Golden Path（逐步覆盖）

| 步骤 | 描述 |
|------|------|
| GP-1 | commit failing test：构造 behavior_tests[1].log_tail 含 KEYMARK，断言当前版本 prompt 不含 KEYMARK |
| GP-2 | 实现 compressBrainResult 函数并作为命名导出加入 harness-judge.js |
| GP-3 | 第 233 行替换：JSON.stringify(brainResult).slice(0, 2000) → compressBrainResult(brainResult) |
| GP-4 | 同一 failing test 现在 passing：prompt 包含 KEYMARK |
| GP-5a | 边界测试：10 条 behavior_tests → prompt 含前 8 条 command 且含「另有 2 条已省略」 |
| GP-5b | 边界测试：单条超长 log_tail → 截至 600 字符且含「…（已截断）」标记 |
| GP-6 | 既有测试全过（harness-judge.test.js / harness-judge-mechanical-gate.test.js / harness-judge-api.test.js 0 回归） |

---

## E2E 验收

> journey_type=internal_tool，验收以单元测试为准，无 UI / 浏览器交互。

```bash
# 全量运行验收测试（GP-1/GP-4/GP-5a/GP-5b + 既有测试 GP-6）
cd /workspace && npx vitest run \
  packages/brain/src/__tests__/harness-judge-evidence-compress.test.js \
  packages/brain/src/__tests__/harness-judge.test.js \
  packages/brain/src/__tests__/harness-judge-mechanical-gate.test.js \
  packages/brain/src/__tests__/harness-judge-api.test.js

# 验证 compressBrainResult 为命名导出
node -e "const { compressBrainResult } = require('./packages/brain/src/harness-judge.js'); console.log(typeof compressBrainResult === 'function' ? 'OK' : 'FAIL')"

# 验证第 233 行已替换（不得含旧截断写法）
grep -n "JSON.stringify(brainResult).slice" /workspace/packages/brain/src/harness-judge.js && echo "FAIL: 旧截断仍存在" || echo "OK: 旧截断已替换"

# 验证 validateCoverage 签名未被改动
grep -n "validateCoverage" /workspace/packages/brain/src/harness-judge.js | head -5

# 验证 failing test commit 早于修复 commit（TDD 顺序）
git log --oneline packages/brain/src/__tests__/harness-judge-evidence-compress.test.js | head -5
```

**验收判定标准**：
- 所有 vitest 测试 PASS，0 失败，0 回归
- `compressBrainResult` 可正常 import
- 源码不含 `JSON.stringify(brainResult).slice`
- `validateCoverage` 函数签名行为无任何改变
- git log 中截断复现 test 的 commit 早于 harness-judge.js 修复 commit

---

## 不变量（Invariants）

| # | 不变量 |
|---|--------|
| INV-1 | compressBrainResult 输出对 behavior_tests 每个条目（至多前 8 条）必须至少包含该条目的 command 字段（截 200 字符后） |
| INV-2 | compressBrainResult 输出总长度 ≤ 6000 字符 |
| INV-3 | validateCoverage 函数签名与行为不变（无任何修改） |
| INV-4 | buildJudgePrompt 对外签名不变，调用方无感知 |
| INV-5 | behavior_tests 超出 8 条时，prompt 中必须出现「另有 N 条已省略」字样（N 为实际省略数） |

---

## Test Contract

| BEHAVIOR | Test File | it() 描述 |
|----------|-----------|-----------|
| BEHAVIOR-1 截断复现 | ../../packages/brain/src/__tests__/harness-judge-evidence-compress.test.js | 旧截断逻辑：behavior_tests[1].log_tail 的 KEYMARK 被挤出 2000 字符外 |
| BEHAVIOR-2 修复后KEYMARK可见 | ../../packages/brain/src/__tests__/harness-judge-evidence-compress.test.js | compressBrainResult：behavior_tests[1].log_tail 的 KEYMARK 必须可见 |
| BEHAVIOR-2 buildJudgePrompt包含所有command | ../../packages/brain/src/__tests__/harness-judge-evidence-compress.test.js | buildJudgePrompt：prompt 中包含 behavior_tests[0] 和 [1] 的 command |
| BEHAVIOR-3 条目上限 | ../../packages/brain/src/__tests__/harness-judge-evidence-compress.test.js | 前 8 条展开，第 9/10 条不展开，含「另有 2 条已省略」 |
| BEHAVIOR-4 超长log_tail截断标记 | ../../packages/brain/src/__tests__/harness-judge-evidence-compress.test.js | log_tail 超 600 字符时，截至 600 字符并追加「…（已截断）」 |
| BEHAVIOR-5 总长度预算 | ../../packages/brain/src/__tests__/harness-judge-evidence-compress.test.js | 最大压力输入下 compressBrainResult 输出长度不超过 6000 |
| BEHAVIOR-7 命名导出 | ../../packages/brain/src/__tests__/harness-judge-evidence-compress.test.js | compressBrainResult 是从 harness-judge.js 导出的函数 |
| BEHAVIOR-7 null安全 | ../../packages/brain/src/__tests__/harness-judge-evidence-compress.test.js | null/undefined brainResult 不崩溃，返回字符串 |
