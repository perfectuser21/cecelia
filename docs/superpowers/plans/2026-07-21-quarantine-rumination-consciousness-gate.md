# quarantine.js rumination调用接入consciousness.enabled门禁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `packages/brain/src/quarantine.js` 里任务满 `FAILURE_THRESHOLD` 次失败触发隔离时内嵌的 `callLLM('rumination', ...)` 失败归因调用，接入 `isConsciousnessEnabled()` 门禁——禁用时跳过该调用，不影响隔离主流程。

**Architecture:** 复用仓库已有的 SSOT `packages/brain/src/consciousness-guard.js` 导出的 `isConsciousnessEnabled()` 同步函数（`consciousness-loop.js` 已用同样写法），在 `quarantine.js` 的 `callLLM('rumination', ...)` 调用外包一层 if/else 判断。测试用 vitest + `vi.hoisted` mock `pool`/`emit`/`upsertLearning`/`callLLM`/`isConsciousnessEnabled`，直接调用已导出的 `quarantineTask()`。

**Tech Stack:** Node.js (ESM), vitest

---

### Task 1: 新增 failing test 覆盖 consciousness 门禁行为

**Files:**
- Create: `packages/brain/src/__tests__/quarantine-consciousness-gate.test.js`

- [ ] **Step 1: 写 failing test**

```javascript
/**
 * quarantine-consciousness-gate 单元测试
 * 验证 quarantineTask 的失败归因 LLM 调用（rumination）受 isConsciousnessEnabled() 门禁
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// ── mock 区（顺序与 quarantine-block.test.js 保持一致的写法）──────

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));

const mockEmit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../event-bus.js', () => ({ emit: mockEmit }));

const mockUpsertLearning = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../learning.js', () => ({ upsertLearning: mockUpsertLearning }));

const mockCallLLM = vi.hoisted(() => vi.fn().mockResolvedValue({ text: 'mock分析结果' }));
vi.mock('../llm-caller.js', () => ({ callLLM: mockCallLLM }));

const mockIsConsciousnessEnabled = vi.hoisted(() => vi.fn());
vi.mock('../consciousness-guard.js', () => ({
  isConsciousnessEnabled: mockIsConsciousnessEnabled,
}));

// ── 导入被测模块 ──────────────────────────────────────────
let quarantineTask, QUARANTINE_REASONS;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../quarantine.js');
  quarantineTask = mod.quarantineTask;
  QUARANTINE_REASONS = mod.QUARANTINE_REASONS;
});

// ── 辅助函数 ────────────────────────────────────────────

function mockTaskRow(taskId, failureCount) {
  return {
    id: taskId,
    title: '测试任务',
    status: 'in_progress',
    task_type: 'dev',
    description: '测试描述',
    payload: { failure_count: failureCount },
  };
}

describe('quarantineTask 的 rumination 归因调用受 consciousness.enabled 门禁', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
    mockEmit.mockClear();
    mockUpsertLearning.mockClear();
    mockCallLLM.mockClear();
    mockIsConsciousnessEnabled.mockReset();
  });

  it('consciousness disabled 时不应调用 callLLM 或 upsertLearning，但隔离主流程仍成功', async () => {
    mockIsConsciousnessEnabled.mockReturnValue(false);

    const taskId = 'task-disabled-001';
    mockPool.query
      .mockResolvedValueOnce({ rows: [mockTaskRow(taskId, 3)] }) // SELECT task
      .mockResolvedValueOnce({ rows: [] }); // UPDATE tasks SET status='quarantined'

    const result = await quarantineTask(taskId, QUARANTINE_REASONS.REPEATED_FAILURE, {});

    expect(result.success).toBe(true);
    expect(mockEmit).toHaveBeenCalledWith('task_quarantined', 'quarantine', expect.objectContaining({ task_id: taskId }));
    expect(mockCallLLM).not.toHaveBeenCalled();
    expect(mockUpsertLearning).not.toHaveBeenCalled();
  });

  it('consciousness enabled 时应正常调用 callLLM 做失败归因分析', async () => {
    mockIsConsciousnessEnabled.mockReturnValue(true);

    const taskId = 'task-enabled-001';
    mockPool.query
      .mockResolvedValueOnce({ rows: [mockTaskRow(taskId, 3)] }) // SELECT task
      .mockResolvedValueOnce({ rows: [] }); // UPDATE tasks SET status='quarantined'

    const result = await quarantineTask(taskId, QUARANTINE_REASONS.REPEATED_FAILURE, {});

    expect(result.success).toBe(true);
    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    expect(mockCallLLM).toHaveBeenCalledWith('rumination', expect.stringContaining('测试任务'), expect.objectContaining({ maxTokens: 150 }));
    expect(mockUpsertLearning).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/quarantine-consciousness-gate.test.js`
Expected: 第一个用例（disabled 不应调用）FAIL——因为此时 `quarantine.js` 还没有加门禁判断，`callLLM` 实际会被调用，`expect(mockCallLLM).not.toHaveBeenCalled()` 断言失败。第二个用例应该 PASS（因为现状本来就会调用 callLLM）。

- [ ] **Step 3: Commit（红）**

```bash
git add packages/brain/src/__tests__/quarantine-consciousness-gate.test.js
git commit -m "test(brain): quarantineTask的rumination归因调用应受consciousness.enabled门禁(failing)"
```

---

### Task 2: 实现修复，让测试变绿

**Files:**
- Modify: `packages/brain/src/quarantine.js:19-26`（顶部 import 区）
- Modify: `packages/brain/src/quarantine.js:259-286`（callLLM 调用处）

- [ ] **Step 1: 加 import**

在 `packages/brain/src/quarantine.js` 第 26 行（`import { getBackoffMs, getMaxRetries } from './lib/retry-policy.js';` 之后）新增一行：

```javascript
import { isConsciousnessEnabled } from './consciousness-guard.js';
```

- [ ] **Step 2: 包一层门禁判断**

把现有第 259-286 行的这一段：

```javascript
    // 失败学习：当任务因重复失败进隔离区时，自动分析根因
    if (reason === QUARANTINE_REASONS.REPEATED_FAILURE && quarantineInfo.failure_count >= FAILURE_THRESHOLD) {
      try {
        // 动态导入 callLLM 避免循环依赖
        const { callLLM } = await import('./llm-caller.js');

        // 构建分析提示词
        const quarantinePrompt = `任务「${task.title}」连续${quarantineInfo.failure_count}次失败。类型：${task.task_type || '未知'}。描述：${(task.description || '').slice(0, 300)}。请用1-2句分析失败根因，第一人称（我）。`;

        // 调用 LLM 分析（限制 150 tokens）
        const analysisResult = await callLLM('rumination', quarantinePrompt, { maxTokens: 150 });

        if (analysisResult && analysisResult.text) {
          // 写入 learnings 表（upsertLearning 去重，同 title 只保留一行并递增 frequency_count）
          await upsertLearning({
            title: `隔离分析：${task.title}`,
            content: analysisResult.text.trim(),
            category: 'quarantine_pattern',
            triggerEvent: 'quarantine',
            task_id: taskId || null,
          });

          console.log(`[quarantine] LLM analysis completed for task ${taskId}`);
        }
      } catch (analysisErr) {
        // 分析失败不影响隔离主流程
        console.warn(`[quarantine] LLM analysis failed for task ${taskId}:`, analysisErr.message);
      }
    }
```

替换成：

```javascript
    // 失败学习：当任务因重复失败进隔离区时，自动分析根因
    // consciousness.enabled=false 时跳过（rumination 属 GUARDED_MODULES，2026-07-21 补齐门禁）
    if (reason === QUARANTINE_REASONS.REPEATED_FAILURE && quarantineInfo.failure_count >= FAILURE_THRESHOLD) {
      if (!isConsciousnessEnabled()) {
        console.log(`[quarantine] consciousness disabled, skip LLM analysis for task ${taskId}`);
      } else {
        try {
          // 动态导入 callLLM 避免循环依赖
          const { callLLM } = await import('./llm-caller.js');

          // 构建分析提示词
          const quarantinePrompt = `任务「${task.title}」连续${quarantineInfo.failure_count}次失败。类型：${task.task_type || '未知'}。描述：${(task.description || '').slice(0, 300)}。请用1-2句分析失败根因，第一人称（我）。`;

          // 调用 LLM 分析（限制 150 tokens）
          const analysisResult = await callLLM('rumination', quarantinePrompt, { maxTokens: 150 });

          if (analysisResult && analysisResult.text) {
            // 写入 learnings 表（upsertLearning 去重，同 title 只保留一行并递增 frequency_count）
            await upsertLearning({
              title: `隔离分析：${task.title}`,
              content: analysisResult.text.trim(),
              category: 'quarantine_pattern',
              triggerEvent: 'quarantine',
              task_id: taskId || null,
            });

            console.log(`[quarantine] LLM analysis completed for task ${taskId}`);
          }
        } catch (analysisErr) {
          // 分析失败不影响隔离主流程
          console.warn(`[quarantine] LLM analysis failed for task ${taskId}:`, analysisErr.message);
        }
      }
    }
```

- [ ] **Step 3: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/quarantine-consciousness-gate.test.js`
Expected: 两个用例都 PASS

- [ ] **Step 4: 跑整个 quarantine 相关测试套件确认没改坏其他行为**

Run: `cd packages/brain && npx vitest run src/__tests__/quarantine*.test.js src/__tests__/rumination-quarantine.test.js`
Expected: 全部 PASS（尤其 `quarantine-learning-integration.test.js`、`quarantine-block.test.js`、`quarantine-release.test.js` 等既有用例不受影响）

- [ ] **Step 5: Commit（绿）**

```bash
git add packages/brain/src/quarantine.js
git commit -m "fix(brain): quarantine.js的rumination归因调用接入consciousness.enabled门禁

quarantine.js:268的失败归因LLM调用(2026-02-27引入,PR #52)早于
consciousness-guard体系(2026-04-20引入,PR #2447),从未接入
isConsciousnessEnabled()检查。consciousness-guard.js的GUARDED_MODULES
已将rumination列为应受门禁模块,这是遗漏未接入,不是设计如此。

2026-07-20主理人拍板封存意识流(决策76194f29)后这条线依然持续触发,
07-21因arch_review任务反复隔离叠加Anthropic API余额不足fallback到
本机claude -p CLI,是系统资源风暴(负载峰值80+/约110个子进程堆积)并
消耗用户Claude Code订阅额度的根因之一。"
```

---

### Task 3: 跑全量 Brain 测试套件 + 类型/lint 检查

- [ ] **Step 1: 跑 brain 包完整测试**

Run: `cd packages/brain && npx vitest run`
Expected: 全部 PASS，无新增失败

- [ ] **Step 2: 如仓库配置了 lint，跑一下**

Run: `cd packages/brain && npm run lint 2>&1 | tail -30` (若脚本不存在则跳过)
Expected: 无新增 lint 错误

- [ ] **Step 3: 确认 git diff 范围精确，无夹带其他改动**

Run: `git diff main --stat`
Expected: 只包含 `packages/brain/src/quarantine.js`、`packages/brain/src/__tests__/quarantine-consciousness-gate.test.js`、`docs/superpowers/specs/2026-07-21-...`、`docs/superpowers/plans/2026-07-21-...` 四个文件
