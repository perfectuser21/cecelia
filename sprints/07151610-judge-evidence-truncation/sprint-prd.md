# Sprint PRD — 刀A6：judge 证据截断误判修复

## OKR 对齐

- **对应 KR**：Harness 裁判准确率 ≥ 98%（减少误判 FAIL）
- **当前进度**：已发现复现路径（task 5e9c0496 实证）
- **本次推进预期**：修复 harness-judge.js 证据注入截断问题，使多条 behavior_tests 均可被裁判可见

## 背景

task 5e9c0496 收尾时，`.brain-result.json` 含三条完整 behavior_tests（E2E-1 1427 字符 + E2E-2 2020 字符），DeepSeek 裁判连续两轮以『.brain-result.json 中无任何 _parseBaseRepo 测试执行输出』误判 FAIL；证据压缩到 866 字符后同一裁判 PASS。

根因：`packages/brain/src/harness-judge.js` 约 233 行 `JSON.stringify(brainResult).slice(0, 2000)` 对整个 brainResult 做头部截断，后排条目（behavior_tests[1]、[2]...）对裁判完全不可见。

## Golden Path（核心场景）

修复者从 [发现截断误判根因] → 经过 [编写 failing test → 实现结构化压缩函数 → 验证全部既有测试通过] → 到达 [裁判 prompt 公平呈现每条 behavior_tests 证据]

具体步骤：

1. **（GP-1）先 commit failing test**：构造 brainResult = [条目1 log_tail 1500字符, 条目2 log_tail 含 KEYMARK]，断言当前版本送往 DeepSeek 的 prompt 字符串**不含 KEYMARK**（复现截断）；该 test 以 failing 状态 commit 进 repo
2. **（GP-2）实现 compressBrainResult 函数**：独立导出，结构化压缩：
   - 顶层保留 `verdict` / `exit_code` / `log_tail`（截 500 字符）
   - `behavior_tests` 逐条保留：每条 `command`（截 200）+ `exit_code` + `log_tail`（截 600）
   - 条目数上限 8，超出注明「另有 N 条已省略」
   - 总预算 6000 字符（替换原 2000 限制）
3. **（GP-3）替换 233 行截断**：将 `JSON.stringify(brainResult).slice(0, 2000)` 替换为 `compressBrainResult(brainResult)` 调用
4. **（GP-4）验证 failing test 转为 passing**：同一测试用例，修复后 prompt 必须含 KEYMARK 且每条 behavior_tests 条目均出现
5. **（GP-5）补充边界测试**：behavior_tests 10 条 → prompt 含前 8 条 command + 「另有 2 条已省略」；单条超长 log_tail 被截到 600 字符且带截断标记
6. **（GP-6）既有 judge 测试全过**：`harness-judge.test.js` / `harness-judge-mechanical-gate.test.js` / `harness-judge-api.test.js` 等所有既有测试 0 回归

## 边界情况

- brainResult 为 null 或无 behavior_tests 字段：返回「（无）」（现有行为保持）
- behavior_tests 为空数组：保留顶层字段，behavior_tests 段显示「[]」
- 单条 log_tail 超过 600 字符：截断后追加「…（已截断）」标记
- behavior_tests 超过 8 条：第 9 条起不展开，末尾追加「另有 N 条已省略」

## 范围限定

**在范围内**：
- `packages/brain/src/harness-judge.js` 约 233 行的证据序列化逻辑
- 新增 `compressBrainResult` 函数（独立导出，可单独测试）
- `packages/brain/src/__tests__/harness-judge.test.js`（或新增测试文件）中新增 3 个测试用例

**不在范围内**：
- DeepSeek 调用协议（URL / headers / model 参数）
- `validateCoverage` 逻辑（机械闸）
- `.brain-result.json` 的写入逻辑（evaluator 侧）
- 其他 harness 组件

## 假设

- [ASSUMPTION: DeepSeek 上下文窗口远大于 6000 字符，放宽总预算不会导致超限]
- [ASSUMPTION: compressBrainResult 作为命名导出加入 harness-judge.js，与现有导出保持同文件]
- [ASSUMPTION: log_tail 截断标记格式为「…（已截断）」，不影响裁判对关键词的识别]

## 铁律（不可违反）

- **只动证据序列化**，不动裁决逻辑（verdict 判定路径）、机械闸（validateCoverage）
- **压缩必须条目级公平**：每条 behavior_tests 条目都必须在 prompt 中有可见代表，禁止再出现整体头部截断
- **failing test 先 commit**：在修复代码前，failing test 必须先以失败状态进入 repo
- **修复后 failing test 转 passing**：不得删除该测试，永久留存为 regression test

## NFR 约束

- 性能：compressBrainResult 为纯函数，无 I/O，O(n) 复杂度，不引入性能问题
- 可观测：压缩后 prompt 的 behavior_tests 段可直接人工阅读（结构化文本，非 blob）
- 兼容性：不改变 buildJudgePrompt 签名和调用方，只替换内部序列化实现

## 预期受影响文件

- `packages/brain/src/harness-judge.js`：第 233 行替换 + 新增 `compressBrainResult` 函数
- `packages/brain/src/__tests__/harness-judge.test.js`（或新文件 `harness-judge-evidence-compress.test.js`）：新增 3 个测试用例

## E2E 验收

> 本任务为纯后端逻辑修复，无 UI 交互，验收以单元测试为准（journey_type=internal_tool）。

```bash
# GP-1 + GP-4：截断复现 & 修复验证（同一测试用例，先 failing 后 passing）
# brainResult 构造：
#   behavior_tests[0].log_tail = 'A'.repeat(1500)（超长，触发截断）
#   behavior_tests[1].log_tail = '...KEYMARK...'（应在修复后可见）
# 断言：
#   - 修复前：buildJudgePrompt(...).includes('KEYMARK') === false
#   - 修复后：buildJudgePrompt(...).includes('KEYMARK') === true

# GP-5a：10 条 behavior_tests → prompt 含前 8 条 command + 「另有 2 条已省略」
# GP-5b：单条超长 log_tail → 截至 600 字符 + 截断标记

# GP-6：既有测试全过
# cd /workspace && npx vitest run packages/brain/src/__tests__/harness-judge.test.js \
#   packages/brain/src/__tests__/harness-judge-mechanical-gate.test.js \
#   packages/brain/src/__tests__/harness-judge-api.test.js
```

## journey_type: internal_tool
## journey_type_reason: 纯 Node.js 函数修复，无 UI / 浏览器交互，验收靠单元测试
## target_environment: local_node
## target_environment_reason: 所有验收测试在本机 vitest 运行，不依赖 Playwright 或 GitHub Actions runner
## task_id: ea20ba86-9ce4-4fbf-84cd-987a8b3f5ba6
## sprint_dir: sprints/07151610-judge-evidence-truncation

## Invariants（不变量）

1. **INV-1**：`compressBrainResult(brainResult)` 输出的字符串，对 `behavior_tests` 每个条目（至多前 8 条）必须至少包含该条目的 `command` 字段（截 200 字符后）。
2. **INV-2**：`compressBrainResult` 输出总长度 ≤ 6000 字符。
3. **INV-3**：`validateCoverage` 函数签名与行为不变（无任何修改）。
4. **INV-4**：`buildJudgePrompt` 对外签名不变，调用方无感知。
5. **INV-5**：behavior_tests 超出 8 条时，prompt 中必须出现「另有 N 条已省略」字样（N 为实际省略数）。

## Functional Requirements（功能需求）

| # | 需求 | 验收断言 |
|---|------|----------|
| FR-1 | 新增 `compressBrainResult(brainResult)` 纯函数，独立命名导出 | `import { compressBrainResult } from '../harness-judge.js'` 可用 |
| FR-2 | 顶层字段：`verdict`、`exit_code`、`log_tail`（截 500）保留 | 压缩结果含 verdict 字段 |
| FR-3 | behavior_tests 逐条展开：`command`（截 200）+ `exit_code` + `log_tail`（截 600） | 每条目均可见 command |
| FR-4 | 条目上限 8，超出追加「另有 N 条已省略」 | 10 条输入 → prompt 含「另有 2 条已省略」 |
| FR-5 | 总预算 6000 字符（替换原 2000） | `compressBrainResult(...).length <= 6000` |
| FR-6 | 第 233 行替换为 `compressBrainResult(brainResult)` 调用 | grep 不再出现 `JSON.stringify(brainResult).slice` |
| FR-7 | failing test 先 commit（截断复现） | git log 中截断 test commit 早于修复 commit |
| FR-8 | 修复后同 test 转 passing，永久留存 | CI 回归不删除该测试 |
