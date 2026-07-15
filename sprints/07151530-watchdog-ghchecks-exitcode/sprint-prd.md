# Sprint PRD：watchdog gh pr checks 退出码误判修复（07151530）

**Task ID**: b5162377-4012-424a-ba2f-0b33003eb602
**Sprint Dir**: sprints/07151530-watchdog-ghchecks-exitcode
**Target**: local_api
**Date**: 2026-07-15

---

## 背景与症状

task 5e9c0496 的 PR #3971 处于 BEHIND+容器消亡的死局——正是 #3940 要救的场景。Brain 日志记录：

> `[relay-watchdog] CI 状态查询失败，initiative=5e9c0496… 保守跳过: Command failed: gh pr checks "…/pull/3971" --json state`

问题根因：#3940 实现的 `execTolerant` 虽已写入 `harness-relay-watchdog.js`，但**现有测试中 `makeDeps` 的 `execFn` mock 对 `gh pr checks` 始终返回正常字符串**（`return JSON.stringify(ciChecks)`），从未模拟 `gh pr checks` 抛出 `err.stdout` 兜底场景。

现实中 `gh pr checks` 在以下情况会以**非零退出码**结束：
- 有 checks pending/running → exit 8
- 有 checks failure → exit 1

execSync 遇到非零退出会 `throw`，而 `execTolerant` 设计上已能通过 `err.stdout` 兜底，但**没有覆盖该路径的测试**，导致当 `gh` 版本或环境稍有差异时，execFn 的抛出行为与 mock 不匹配，catch 分支的真实行为无法保证。

本次任务：补齐 failing tests → 验证 execTolerant 路径已正确实现 → 确保三种语义分支（CI 红/等待/查询真失败）在非零退出场景下行为正确。

---

## 根因分析

`ground-truth.js` 第 30 行已有 `execTolerant` 先例（`err.stdout` 兜底解析），`harness-relay-watchdog.js` 第 30 行已做等价实现，但：

1. 测试 `makeDeps.execFn` 对 `gh pr checks` 永远 **正常返回**（不抛），未覆盖 `gh pr checks` 非零退出场景
2. 三种 Golden Path（GP-A/B/C）均通过 `ciChecks=undefined/[...]` 走正常路径，非零退出路径无测试覆盖
3. 如果 execFn 实现中 `gh pr checks` 抛出但 `err.stdout` 有数据，当前测试集无法证明 execTolerant 起到兜底作用

---

## Golden Path（3 条新增 + 1 条回归）

### GP-A：gh pr checks 非零退出 + stdout 含 FAILURE → CI 红 → 重点火

**条件**：
- 容器消失
- `gh pr view` 返回 `state=OPEN, mergeStateStatus=CLEAN`
- `gh pr checks` 抛出带 `err.stdout = JSON.stringify([{ state: 'FAILURE' }])` 的错误（模拟 exit 1）

**期望**：
- `execTolerant` 捕获错误并用 `err.stdout` 兜底
- `ciStatus` 映射为 `'fail'`
- `spawnFn` 被调用一次（`out.resumed === 1`）
- 日志含 `resume_ci_red`

### GP-B：gh pr checks 非零退出 + stdout 全 pending → 等待 → 不重点火

**条件**：
- 容器消失
- `gh pr view` 返回 `state=OPEN, mergeStateStatus=CLEAN`
- `gh pr checks` 抛出带 `err.stdout = JSON.stringify([{ state: 'IN_PROGRESS' }])` 的错误（模拟 exit 8）

**期望**：
- `execTolerant` 捕获错误并用 `err.stdout` 兜底
- `ciStatus` 映射为 `'pending'`
- `spawnFn` 不被调用（`out.resumed === 0`）
- 日志含 `wait_ci_running`

### GP-C：gh pr checks 非零退出 + 无 stdout（真实查询失败）→ 保守跳过

**条件**：
- 容器消失
- `gh pr view` 返回 `state=OPEN, mergeStateStatus=CLEAN`
- `gh pr checks` 抛出无 `err.stdout`（或空字符串）的错误（模拟网络/auth 失败）

**期望**：
- `execTolerant` 捕获后再次 throw（没有兜底数据）
- 外层 `catch (ciErr)` 触发保守跳过
- `spawnFn` 不被调用（`out.resumed === 0`）
- 日志含 `[relay-watchdog] CI 状态查询失败`

### GP-R（回归）：既有 GP-1 ~ GP-4 测试不回归

既有正常路径（`execFn` 正常返回）的 4 条 GP 全部继续通过。

---

## 验收标准

### 测试验收
- [ ] GP-A、GP-B、GP-C 三条 failing test 先 commit（红→绿流程），验证 `execTolerant` 行为
- [ ] 既有 `harness-relay-watchdog.test.js` 中所有用例继续通过（`GP-1 ~ GP-4` + 所有 describe 块）
- [ ] 测试 commit 进 repo 作为 regression guard，CI 常驻
- [ ] 日志三种决策语义明确：`resume_ci_red` / `wait_ci_running` / `[relay-watchdog] CI 状态查询失败`

### 实现约束（铁律）
- `execTolerant` 已在 `harness-relay-watchdog.js` 第 30 行实现；**不重复造轮子**，测试直接覆盖现有实现
- 如现有实现有缺陷（如 err.stdout 判断有误），修复复用 `execTolerant` 模式，不另起新函数
- **只修 CI 状态查询的容错**，不动重点火条件/attempt cap/其他分支
- 不改 `MAX_RELAY_ATTEMPTS` / `MAX_CODEX_RELAY_ATTEMPTS` 数值
- 不动 MERGED / CLOSED 分支逻辑
- 不碰 headed 分支（`_handleHeadedRun`）
- 不碰 `foreground` orchestrator_host 护栏

---

## 变更文件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `packages/brain/src/__tests__/harness-relay-watchdog.test.js` | 新增测试 | GP-A / GP-B / GP-C 三条用例（非零退出 + err.stdout 兜底场景） |
| `packages/brain/src/harness-relay-watchdog.js` | 按需修复 | 若 execTolerant 实现有缺陷则修复；若已正确则仅需测试覆盖证明 |

---

## 实现要点

### makeDeps 中如何 mock gh pr checks 非零退出

```js
// GP-A：模拟 gh pr checks exit 1（有 FAILURE）
const execFn = vi.fn().mockImplementation((cmd) => {
  if (/gh pr checks/.test(cmd)) {
    const err = new Error('Command failed: gh pr checks ...');
    err.stdout = JSON.stringify([{ state: 'FAILURE' }]);
    throw err;
  }
  // 其他命令正常返回...
});

// GP-C：模拟真实查询失败（无 stdout）
const execFn = vi.fn().mockImplementation((cmd) => {
  if (/gh pr checks/.test(cmd)) {
    throw new Error('gh: authentication token not found');
    // 无 err.stdout 属性
  }
});
```

### execTolerant 现有实现（第 30-37 行）

```js
function execTolerant(execFn, cmd) {
  try {
    return execFn(cmd);
  } catch (err) {
    if (typeof err.stdout === 'string' && err.stdout.length > 0) return err.stdout;
    throw err;
  }
}
```

此实现已满足三种场景的设计意图，测试需验证此路径在真实 throw 时的行为。

---

## 不在范围内

- 不改 `ground-truth.js`（`execTolerant` 在那里已有独立测试）
- 不新增 CI workflow 文件
- 不动 migrations / dashboard / api layer
- 不修改重点火触发条件（isBehind / ciStatus === 'fail' 逻辑不变）
- 不在 `makeDeps` 工具函数中增加新的默认参数（只在具体 test case 内定制 execFn）

---

## 不变式（Invariants）

| # | 断言 |
|---|------|
| I-1 | execTolerant 遇到 err.stdout 有内容时，必须返回 err.stdout 而不是 throw |
| I-2 | execTolerant 遇到 err.stdout 为空/不存在时，必须 rethrow 原错误 |
| I-3 | ciErr catch 分支保守跳过：spawnFn 不得在 CI 查询失败时被调用 |
| I-4 | 非零退出但 stdout 含 FAILURE → ciStatus === 'fail' → spawnFn 必须被调用 |
| I-5 | 非零退出但 stdout 全 pending → ciStatus === 'pending' → spawnFn 不得被调用 |
| I-6 | 既有 GP-1 ~ GP-4 正常路径：行为不回归 |

---

## 依赖假设

- `[ASSUMPTION: harness-relay-watchdog.js 的 execTolerant 实现（第 30-37 行）语义已正确，仅缺测试覆盖；若测试发现实现有误则就地修复]`
- `[ASSUMPTION: makeDeps 内 execFn 可以在单个 test 中局部覆盖，无需修改公共工厂函数签名]`
- `[ASSUMPTION: 现有 Brain CI（brain-ci.yml）会自动运行 harness-relay-watchdog.test.js]`

---

## NFR

- 性能：无影响（仅测试补齐，不改线上路径）
- 安全：无影响

---

## 累积 FR

| # | 描述 |
|---|------|
| FR-1 | GP-A：gh pr checks 非零退出+stdout含FAILURE → resume_ci_red → spawnFn 调用 |
| FR-2 | GP-B：gh pr checks 非零退出+stdout全pending → wait_ci_running → spawnFn 不调用 |
| FR-3 | GP-C：gh pr checks 非零退出+无stdout（真失败）→ 保守跳过 → spawnFn 不调用 |
| FR-4 | GP-R：既有正常路径测试全过（回归） |

---

journey_type: bugfix
target_environment: local_api
