# harness_initiative Executor 状态回写修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 executor.js，使 harness_initiative 任务在 LangGraph 完成后自动回写 tasks.status（completed/failed），消除永久卡 in_progress 的 Bug。

**Architecture:** 在 executor.js 的 harness_initiative 分支中，于 `compiled.invoke()` 返回后调用 `updateTaskStatus`；三条路径（无错误 → completed、final.error → failed、catch 异常 → failed）均返回 `{ success: true }`，让 dispatcher 不再回退状态。

**Tech Stack:** Node.js ESM，vitest（静态断言模式），task-updater.js（updateTaskStatus）

---

### Task 1: 写失败测试

**Files:**
- Create: `packages/brain/src/__tests__/executor-harness-initiative-status-writeback.test.js`

背景：项目测试模式是静态断言——用 `readFileSync` 读源码，用 `expect(src).toMatch(...)` 验证代码形状，不实际运行 executor。参考 `packages/brain/src/__tests__/executor-harness-initiative-default-fullgraph.test.js`。

- [ ] **Step 1: 创建测试文件（此时测试必须失败）**

```javascript
/**
 * 验证：executor.js harness_initiative 分支在 compiled.invoke() 返回后
 * 调用 updateTaskStatus 回写任务状态。静态断言代码形状。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

describe('executor.js harness_initiative 状态回写', () => {
  const SRC = fs.readFileSync(new URL('../executor.js', import.meta.url), 'utf8');

  // 提取 harness_initiative 块（从 "if (task.task_type === 'harness_initiative')" 到最近的 "}" 配对结束）
  // 用更宽泛的窗口：取第一次出现 harness_initiative 后 2000 字符内的源码片段
  const harnessStart = SRC.indexOf("task.task_type === 'harness_initiative'");
  const harnessBlock = harnessStart >= 0 ? SRC.slice(harnessStart, harnessStart + 2000) : '';

  it('harness_initiative 成功路径调用 updateTaskStatus completed', () => {
    expect(harnessBlock).toMatch(/updateTaskStatus\s*\(\s*task\.id\s*,\s*['"]completed['"]/);
  });

  it('harness_initiative final.error 路径调用 updateTaskStatus failed', () => {
    expect(harnessBlock).toMatch(/updateTaskStatus\s*\(\s*task\.id\s*,\s*['"]failed['"]/);
  });

  it('harness_initiative catch 块调用 updateTaskStatus failed', () => {
    // catch 块在 harness_initiative try-catch 内，也在 harnessBlock 窗口内
    expect(harnessBlock).toMatch(/catch[\s\S]*?updateTaskStatus[\s\S]*?failed/);
  });

  it('harness_initiative 所有路径 return { success: true }（不再是 !final.error）', () => {
    // 不应存在 success: !final.error 这种写法
    expect(harnessBlock).not.toMatch(/success\s*:\s*!final\.error/);
    // 应存在 success: true
    expect(harnessBlock).toMatch(/success\s*:\s*true/);
  });
});
```

- [ ] **Step 2: 运行测试，确认全部失败**

```bash
cd /Users/administrator/worktrees/cecelia/fix-harness-executor-complete
npx vitest run packages/brain/src/__tests__/executor-harness-initiative-status-writeback.test.js 2>&1 | tail -30
```

预期输出：4 个测试全部 FAIL（`success: !final.error` 存在，`updateTaskStatus` 调用不存在）。

- [ ] **Step 3: 提交失败测试**

```bash
cd /Users/administrator/worktrees/cecelia/fix-harness-executor-complete
git add packages/brain/src/__tests__/executor-harness-initiative-status-writeback.test.js
git commit -m "test(brain): harness_initiative 状态回写 — 失败测试（红）

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: 实现修复（让测试变绿）

**Files:**
- Modify: `packages/brain/src/executor.js:2820-2847`

当前代码（第 2820-2847 行）：

```javascript
// 2.85 Harness Full Graph (Phase A+B+C) — 一个 graph 跑到底，默认路径。
if (task.task_type === 'harness_initiative') {
  console.log(`[executor] 路由决策: task_type=${task.task_type} → Harness Full Graph (A+B+C)`);
  try {
    const { compileHarnessFullGraph } = await import('./workflows/harness-initiative.graph.js');
    const compiled = await compileHarnessFullGraph();
    const initiativeId = task.payload?.initiative_id || task.id;
    const final = await compiled.invoke(
      { task },
      { configurable: { thread_id: `harness-initiative:${initiativeId}:1` }, recursionLimit: 500 }
    );
    return {
      success: !final.error,
      taskId: task.id,
      initiative: true,
      fullGraph: true,
      finalState: {
        // 只回 summary 防 task.result 列爆炸
        initiativeId: final.initiativeId,
        sub_tasks: final.sub_tasks,
        final_e2e_verdict: final.final_e2e_verdict,
        error: final.error,
      },
    };
  } catch (err) {
    console.error(`[executor] Harness Full Graph error task=${task.id}: ${err.message}`);
    return { success: false, taskId: task.id, initiative: true, error: err.message };
  }
}
```

- [ ] **Step 1: 将修复后的代码替换到 executor.js 第 2820-2847 行**

将上面的代码块替换为：

```javascript
// 2.85 Harness Full Graph (Phase A+B+C) — 一个 graph 跑到底，默认路径。
if (task.task_type === 'harness_initiative') {
  console.log(`[executor] 路由决策: task_type=${task.task_type} → Harness Full Graph (A+B+C)`);
  try {
    const { compileHarnessFullGraph } = await import('./workflows/harness-initiative.graph.js');
    const compiled = await compileHarnessFullGraph();
    const initiativeId = task.payload?.initiative_id || task.id;
    const final = await compiled.invoke(
      { task },
      { configurable: { thread_id: `harness-initiative:${initiativeId}:1` }, recursionLimit: 500 }
    );
    // harness_initiative 是同步阻塞执行（无回调），executor 必须自行回写状态
    if (final.error) {
      await updateTaskStatus(task.id, 'failed', { error_message: String(final.error).slice(0, 500) });
    } else {
      await updateTaskStatus(task.id, 'completed');
    }
    return {
      success: true, // executor 已处理完毕，dispatcher 无需回退 queued
      taskId: task.id,
      initiative: true,
      fullGraph: true,
      finalState: {
        // 只回 summary 防 task.result 列爆炸
        initiativeId: final.initiativeId,
        sub_tasks: final.sub_tasks,
        final_e2e_verdict: final.final_e2e_verdict,
        error: final.error,
      },
    };
  } catch (err) {
    console.error(`[executor] Harness Full Graph error task=${task.id}: ${err.message}`);
    try {
      await updateTaskStatus(task.id, 'failed', { error_message: err.message.slice(0, 500) });
    } catch (updateErr) {
      console.error(`[executor] 状态回写失败 task=${task.id}: ${updateErr.message}`);
    }
    return { success: true, taskId: task.id, initiative: true, error: err.message };
  }
}
```

- [ ] **Step 2: 语法校验**

```bash
node --check /Users/administrator/worktrees/cecelia/fix-harness-executor-complete/packages/brain/src/executor.js
```

预期：无输出（语法正确）。

- [ ] **Step 3: 运行所有 executor 相关测试，确认全部通过**

```bash
cd /Users/administrator/worktrees/cecelia/fix-harness-executor-complete
npx vitest run packages/brain/src/__tests__/executor-harness-initiative-status-writeback.test.js packages/brain/src/__tests__/executor-harness-initiative-default-fullgraph.test.js packages/brain/src/__tests__/executor-harness-planner-retired.test.js 2>&1 | tail -30
```

预期：所有测试 PASS。

- [ ] **Step 4: 验证 DoD [BEHAVIOR] 条目**

```bash
cd /Users/administrator/worktrees/cecelia/fix-harness-executor-complete
node -e "const s=require('fs').readFileSync('packages/brain/src/executor.js','utf8'); if(!s.includes(\"updateTaskStatus(task.id, 'completed')\"))process.exit(1); console.log('completed PASS')"
node -e "const s=require('fs').readFileSync('packages/brain/src/executor.js','utf8'); if(!s.includes(\"updateTaskStatus(task.id, 'failed'\"))process.exit(1); console.log('failed PASS')"
```

预期：两行输出均为 PASS。

- [ ] **Step 5: 提交实现**

```bash
cd /Users/administrator/worktrees/cecelia/fix-harness-executor-complete
git add packages/brain/src/executor.js
git commit -m "fix(brain): harness_initiative executor 回写 tasks.status — completed/failed

LangGraph 同步阻塞执行无回调机制，executor 必须在 compiled.invoke()
返回后自行调 updateTaskStatus。所有路径返回 { success: true }，
防止 dispatcher 回退 queued 覆盖已写入的终态。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## 自检

**Spec 覆盖**：
- [x] final.error 为空 → completed ← Task 2 Step 1 实现
- [x] final.error 存在 → failed ← Task 2 Step 1 实现
- [x] catch 异常 → failed ← Task 2 Step 1 实现
- [x] 所有路径 success: true ← Task 2 Step 1 实现
- [x] 测试文件 ← Task 1 实现

**Placeholder 扫描**：无 TBD/TODO。

**类型一致性**：`updateTaskStatus(task.id, 'completed')` / `updateTaskStatus(task.id, 'failed', { error_message: ... })` — 与 task-updater.js 签名一致，`ALLOWED_COLUMNS` 包含 `error_message`。
