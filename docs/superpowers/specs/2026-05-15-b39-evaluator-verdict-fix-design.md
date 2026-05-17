# Harness Evaluator Verdict Fix 设计文档

**目标**：修复 2026-05-15 E2E 测试中发现的三个 Bug，使 harness pipeline 能在 evaluator 返回任意合法 PASS 格式时正确合并 PR，并消除并发评估器容器爆炸问题。

**架构**：所有改动集中在 `packages/brain/src/workflows/harness-task.graph.js` 一个文件（4 处修改）。

---

## Bug 1：verdict 标准化（Protocol v1 + v2）

**根因**：evaluator 容器按 SKILL.md 规范输出 `{"verdict":"FIXED",...}`，但 Brain 只接受 `"PASS"` 或 `"FAIL"`，"FIXED" 被当作 FAIL → fix_dispatch → 无限 fix loop。

**修复**：把 "FIXED" 和 "APPROVED" 同样视为 PASS。两处都要改：

### Protocol v1（stdout 解析，第 603-605 行）

```js
// 改前
const verdict = (verdictUpper === 'PASS' || verdictUpper === 'FAIL') ? verdictUpper : 'FAIL';

// 改后
const PASS_VERDICTS = new Set(['PASS', 'FIXED', 'APPROVED']);
const verdict = PASS_VERDICTS.has(verdictUpper) ? 'PASS' : 'FAIL';
```

### Protocol v2（fileVerdict 路径，第 594-596 行）

```js
// 改前
return {
  evaluate_verdict: fileVerdict.verdict,
  evaluate_error: fileVerdict.verdict === 'FAIL' ? (fileVerdict.feedback || 'evaluator returned FAIL') : null,
};

// 改后
const rawV = String(fileVerdict.verdict || '').toUpperCase().trim();
const normV = new Set(['PASS', 'FIXED', 'APPROVED']).has(rawV) ? 'PASS' : rawV;
return {
  evaluate_verdict: normV,
  evaluate_error: normV === 'FAIL' ? (fileVerdict.feedback || 'evaluator returned FAIL') : null,
};
```

---

## Bug 2：去掉 `--auto` 合并标志（第 402 行）

**根因**：
1. `merge_pr` 节点只在 `evaluate_contract` 返回 PASS 后执行，而 `evaluate_contract` 只在 `poll_ci` 验证 CI 全绿后才能到达。进入 `merge_pr` 时 CI 已绿，`--auto` 的"等 CI"保护是多余的。
2. perfectuser21/cecelia 仓库未开启 auto-merge 功能 → `gh pr merge --auto` 永远报错 → `merge_error` → `state.status` 不设为 'merged' → initiative 永久卡在 B_task_loop 阶段。

**修复**：去掉 `--auto` 标志，立即合并（CI 已绿，合并安全）：

```js
// 改前
['pr', 'merge', prUrl, '--auto', '--squash', '--delete-branch']

// 改后
['pr', 'merge', prUrl, '--squash', '--delete-branch']
```

同时更新日志中的 `merge_command` 字段：

```js
merge_command: 'gh pr merge --squash',
```

---

## Bug 3：去掉 evaluate_contract 的 LLM_RETRY（第 627 行）

**根因**：`evaluate_contract` 节点内部调用 `spawnDockerDetached()` + `interrupt()`。当 `LLM_RETRY` 重试该节点时：
1. 节点从头执行 → spawn 新容器 → insert thread_lookup → 调 `interrupt()`
2. 前一个容器还在运行，同时又产生了新容器
3. 每轮评估最终出现 N 个并发容器（E2E 测试实测 3 个 r8 evaluator 同时运行）
4. 成本倍增，且旧容器的 callback 会因 graph 已不在那个 interrupt 而报错

`verify_generator` 节点用 LLM_RETRY 无害（不 spawn 容器），`evaluate_contract` 的 LLM_RETRY 是结构性缺陷。

**修复**：去掉 `evaluate_contract` 节点的 retryPolicy：

```js
// 改前
.addNode('evaluate_contract', evaluateContractNode, { retryPolicy: LLM_RETRY })

// 改后
.addNode('evaluate_contract', evaluateContractNode)
```

---

## 测试策略

| 测试类型 | 内容 |
|----------|------|
| **unit** | verdict 标准化函数：输入 "FIXED"→"PASS"，"APPROVED"→"PASS"，"FAIL"→"FAIL"，"GARBAGE"→"FAIL"，""→"FAIL" |
| **unit** | Protocol v2 fileVerdict 路径：fileVerdict.verdict="FIXED" → evaluate_verdict="PASS" |
| **unit** | merge 命令参数不含 `--auto` |

这是 `fix:` PR（非 `feat:`），不需要 smoke.sh（无新行为，只修正错误判断）。

---

## 文件变更清单

| 文件 | 行数变化 | 说明 |
|------|----------|------|
| `packages/brain/src/workflows/harness-task.graph.js` | ±5 行 | 4 处修改 |
| `packages/brain/src/__tests__/harness-task-verdict.test.js` | +40 行 | 新增单元测试 |
