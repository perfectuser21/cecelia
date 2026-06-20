# 设计：parseTaskPlan 钉死「1 harness = 1 sprint = 1 PR」+ 清死函数 nextRunnableTask

**日期**: 2026-06-20
**分支**: cp-0620110209-harness-dag-pin-1pr
**类型**: 小改动（路径 B）
**Decision**: 145fd4d5-8982-4f8d-b6bf-a0c391190d9e
**路径**: `packages/brain/src/harness-dag.js`

---

## 背景

「1 harness = 1 sprint = 1 PR」是当前 harness pipeline 的核心架构意图（v8.0.0 移除 workstream 拆分，对齐 Anthropic 官方 v2）。真实运行也已对齐：`harness-contract-proposer` 死规则保证 `task-plan.json` 始终只含一个 `ws1`，最近 6 次真实 run 均产出恰好 1 个 PR。

**问题**：这个「只出 1 个」约束只活在 proposer 这个 LLM skill 的自觉里；`parseTaskPlan`（brain 代码层校验）当前放行 `tasks.length` 最多 8 个。一旦 proposer LLM 漂移多写 task，brain 会照单全收，真跑出 N 个 PR，违背架构意图。同时 `nextRunnableTask` 是无生产调用的死代码，且曾把架构调查带偏（误判为 N 个 PR）。

## 目标

1. 把「1 PR」从「靠 LLM 自觉」升级为「brain 代码硬保证」。
2. 清掉 `nextRunnableTask` 死代码这一认知噪音源。

## 改动

### 1. 硬约束（核心）
`parseTaskPlan`（`harness-dag.js` 当前第 74-79 行）：将 `tasks.length > 8` 的 hard cap 及其 justification 分支，替换为：

```js
if (obj.tasks.length !== 1) {
  throw new Error(
    `parseTaskPlan: tasks length ${obj.tasks.length} !== 1 — 1 harness = 1 sprint = 1 PR（workstream 拆分 v8.0.0 已废弃）`
  );
}
```

保留第 71 行的「非空数组」前置校验（给空数组更明确的报错），其后的逐 task 字段校验、depends_on 校验、detectCycle 全部保留不动（单 task 时它们平凡通过，零行为变化）。

### 2. 删死代码 nextRunnableTask
- 删 `harness-dag.js` 中 `nextRunnableTask` 函数定义 + 头部 doc 注释第 12 行对它的描述。
- 删 `dispatch-helpers.js:94,140` 两处提及它的注释引用（改写为不依赖该函数名的等价描述，或直接移除指向）。
- 删 6 个 `__tests__` 文件里的 `nextRunnableTask: vi.fn()` mock 残留（仅删该行，不动各文件的实际断言）。

## 范围红线（明确不碰）

- ❌ `pick_sub_task / run_sub_task / advance` 循环、`task_loop_index`（承载串行合并门 / 断点恢复 / 触发 report，活的）
- ❌ `ws1` / `workstream_count` 命名（skill 输出 ↔ brain 解析的约定，改名会拆穿契约）
- ❌ `detectCycle`（被 `parseTaskPlan` 第 126 行调用，活的）
- ❌ `topologicalOrder`（仍有生产调用点）

## 已知风险

`harness-dag.test.js` 等若存在「给 `parseTaskPlan` 喂多 task 且断言成功」的用例，会被新护栏打红。实现时必须审查所有 `parseTaskPlan` 调用点的测试，把这类用例改成「断言抛错」或拆成单 task。（注意：`topologicalOrder` / `detectCycle` 的多 task 测试是直接调用这两个函数、不经 `parseTaskPlan`，不受影响。）

## 测试策略：unit（vitest）

TDD 两次 commit：
- **commit-1（Red）**：新增回归测试 —— 喂 2-task plan 断言 `parseTaskPlan` throw（错误信息含 `!== 1`）；喂 1-task 合法 plan 断言通过返回。
- **commit-2（Green）**：实现护栏 + 删死代码，测试转绿，并修复风险点中被打红的旧用例。

## 验收标准

- [ ] commit-1 失败测试先落、commit-2 实现转绿
- [ ] `nextRunnableTask` 全仓零代码引用
- [ ] DevGate 通过（facts-check / check-version-sync / check-dod-mapping）
- [ ] brain-ci 全绿
