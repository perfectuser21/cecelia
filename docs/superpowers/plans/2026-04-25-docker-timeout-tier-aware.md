# Docker Executor Timeout Tier-Aware Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Docker container 默认 timeout 提升到 90min，并按 resource tier 细粒度配置（light=30min/normal=90min/heavy=120min/pipeline-heavy=180min）。

**Architecture:** `RESOURCE_TIERS` 加 `timeoutMs` 字段；`executeInDocker` 优先级：`opts.timeoutMs > tier.timeoutMs > DEFAULT_TIMEOUT_MS(env override)`。`docker-run.js` 不变，继续从 `opts.timeoutMs` 接收。

**Tech Stack:** Node.js ESM、vitest、existing brain test infra

---

## File Structure

- Modify: `packages/brain/src/spawn/middleware/resource-tier.js` (RESOURCE_TIERS 加 timeoutMs)
- Modify: `packages/brain/src/docker-executor.js:36,330` (DEFAULT_TIMEOUT_MS=5400000、tier override 优先级)
- Modify: `packages/brain/src/spawn/middleware/__tests__/resource-tier.test.js` (toEqual 加 timeoutMs)
- Create: `packages/brain/src/__tests__/docker-executor-timeout.test.js` (新建 BEHAVIOR 测试)

---

### Task 1: Resource-tier 加 timeoutMs 字段（Red→Green）

**Files:**
- Modify: `packages/brain/src/spawn/middleware/__tests__/resource-tier.test.js`
- Modify: `packages/brain/src/spawn/middleware/resource-tier.js`

- [ ] **Step 1: 更新现有 toEqual 断言（Red）**

把 `packages/brain/src/spawn/middleware/__tests__/resource-tier.test.js` 中前 4 个 `toEqual(...)` 各加 `timeoutMs` 字段，并加 1 个 describe 块覆盖 4 个 tier 的 timeoutMs 数值：

```js
import { describe, it, expect } from 'vitest';
import { resolveResourceTier, RESOURCE_TIERS, TASK_TYPE_TIER } from '../resource-tier.js';

describe('resolveResourceTier()', () => {
  it('dev → heavy', () => {
    expect(resolveResourceTier('dev')).toEqual({ memoryMB: 1536, cpuCores: 2, timeoutMs: 7200000, tier: 'heavy' });
  });
  it('planner → light', () => {
    expect(resolveResourceTier('planner')).toEqual({ memoryMB: 512, cpuCores: 1, timeoutMs: 1800000, tier: 'light' });
  });
  it('content_research → pipeline-heavy', () => {
    expect(resolveResourceTier('content_research')).toEqual({ memoryMB: 2048, cpuCores: 1, timeoutMs: 10800000, tier: 'pipeline-heavy' });
  });
  it('unknown task_type → normal', () => {
    expect(resolveResourceTier('something_new')).toEqual({ memoryMB: 1024, cpuCores: 1, timeoutMs: 5400000, tier: 'normal' });
  });
  it('harness_planner → light (spec memory)', () => {
    expect(resolveResourceTier('harness_planner').tier).toBe('light');
  });
  it('harness_generator → heavy (spec memory)', () => {
    expect(resolveResourceTier('harness_generator').tier).toBe('heavy');
  });
});

describe('RESOURCE_TIERS / TASK_TYPE_TIER constants', () => {
  it('exports 4 tier keys', () => {
    expect(Object.keys(RESOURCE_TIERS).sort()).toEqual(['heavy', 'light', 'normal', 'pipeline-heavy']);
  });
  it('every tier has timeoutMs > 0', () => {
    for (const [name, spec] of Object.entries(RESOURCE_TIERS)) {
      expect(spec.timeoutMs, `tier ${name} must have timeoutMs`).toBeGreaterThan(0);
    }
  });
  it('timeoutMs ordering light < normal < heavy < pipeline-heavy', () => {
    const t = RESOURCE_TIERS;
    expect(t.light.timeoutMs).toBeLessThan(t.normal.timeoutMs);
    expect(t.normal.timeoutMs).toBeLessThan(t.heavy.timeoutMs);
    expect(t.heavy.timeoutMs).toBeLessThan(t['pipeline-heavy'].timeoutMs);
  });
  it('TASK_TYPE_TIER maps only to defined tiers', () => {
    for (const [_task, tier] of Object.entries(TASK_TYPE_TIER)) {
      expect(RESOURCE_TIERS[tier]).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败（Red 验证）**

Run: `cd packages/brain && npx vitest run src/spawn/middleware/__tests__/resource-tier.test.js`
Expected: 多个 toEqual + ordering + timeoutMs > 0 测试失败（RESOURCE_TIERS 还没字段）。

- [ ] **Step 3: 添加 timeoutMs 到 RESOURCE_TIERS（Green）**

修改 `packages/brain/src/spawn/middleware/resource-tier.js`：

```js
/**
 * 资源档位配置
 *   light  : 512 MB / 1 core   / 30 min  — planner / report / 短链 LLM 调用
 *   normal : 1   GB / 1 core   / 90 min  — propose / review / eval / fix
 *   heavy  : 1.5 GB / 2 cores  / 120 min — generate / dev（写代码 + git/CI）
 *   pipeline-heavy : 2 GB / 1 core / 180 min — content pipeline 峰值 1100 MB + 2× 冗余
 */
export const RESOURCE_TIERS = {
  light:            { memoryMB: 512,  cpuCores: 1, timeoutMs: 30  * 60 * 1000 },
  normal:           { memoryMB: 1024, cpuCores: 1, timeoutMs: 90  * 60 * 1000 },
  heavy:            { memoryMB: 1536, cpuCores: 2, timeoutMs: 120 * 60 * 1000 },
  'pipeline-heavy': { memoryMB: 2048, cpuCores: 1, timeoutMs: 180 * 60 * 1000 },
};
```

`resolveResourceTier` 不需要改（spread `...spec` 自动带上 timeoutMs）。

- [ ] **Step 4: 跑测试确认通过（Green 验证）**

Run: `cd packages/brain && npx vitest run src/spawn/middleware/__tests__/resource-tier.test.js`
Expected: 所有 case PASS。

- [ ] **Step 5: 提交 Task 1**

```bash
git add packages/brain/src/spawn/middleware/resource-tier.js \
        packages/brain/src/spawn/middleware/__tests__/resource-tier.test.js
git commit -m "feat(brain): RESOURCE_TIERS 加 timeoutMs 字段（per-tier docker timeout）"
```

---

### Task 2: docker-executor 默认 90min + tier override（Red→Green）

**Files:**
- Create: `packages/brain/src/__tests__/docker-executor-timeout.test.js`
- Modify: `packages/brain/src/docker-executor.js:36,330`

- [ ] **Step 1: 写新失败测试（Red）**

创建 `packages/brain/src/__tests__/docker-executor-timeout.test.js`：

```js
/**
 * docker-executor-timeout.test.js — Harness v6 P1-E
 *
 * 覆盖 timeoutMs 优先级：opts.timeoutMs > tier.timeoutMs > DEFAULT_TIMEOUT_MS。
 * mock runDocker 捕获实际传入的 opts.timeoutMs。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// hoist mocks
const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
const runDockerSpy = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../spawn/middleware/docker-run.js', () => ({ runDocker: runDockerSpy }));
vi.mock('../spawn/middleware/cost-cap.js', () => ({ checkCostCap: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../spawn/middleware/cap-marking.js', () => ({ checkCap: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../spawn/middleware/billing.js', () => ({ recordBilling: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../spawn/middleware/account-rotation.js', () => ({
  resolveAccount: vi.fn().mockResolvedValue(undefined),
  resolveAccountForOpts: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../spawn/middleware/cascade.js', () => ({ resolveCascade: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../spawn/middleware/logging.js', () => ({
  createSpawnLogger: () => ({ logStart: vi.fn(), logEnd: vi.fn() }),
}));

const { executeInDocker } = await import('../docker-executor.js');

const stubResult = {
  exit_code: 0, stdout: '', stderr: '', duration_ms: 1, container: 'c',
  container_id: null, command: 'docker run', timed_out: false,
  started_at: 't', ended_at: 't',
};

beforeEach(() => {
  mockPool.query.mockReset();
  mockPool.query.mockResolvedValue({ rowCount: 1 });
  runDockerSpy.mockReset();
  runDockerSpy.mockResolvedValue(stubResult);
  delete process.env.CECELIA_DOCKER_TIMEOUT_MS;
});

describe('executeInDocker timeoutMs 优先级', () => {
  it('tier=normal (默认 task_type=harness_propose 走 normal) → 90min', async () => {
    await executeInDocker({
      task: { id: 't-normal', task_type: 'harness_propose' },
      prompt: 'x',
    });
    const call = runDockerSpy.mock.calls[0];
    expect(call[1].timeoutMs).toBe(90 * 60 * 1000);
  });

  it('tier=pipeline-heavy (content_research) → 180min', async () => {
    await executeInDocker({
      task: { id: 't-pipe', task_type: 'content_research' },
      prompt: 'x',
    });
    const call = runDockerSpy.mock.calls[0];
    expect(call[1].timeoutMs).toBe(180 * 60 * 1000);
  });

  it('tier=heavy (dev) → 120min', async () => {
    await executeInDocker({
      task: { id: 't-heavy', task_type: 'dev' },
      prompt: 'x',
    });
    const call = runDockerSpy.mock.calls[0];
    expect(call[1].timeoutMs).toBe(120 * 60 * 1000);
  });

  it('tier=light (planner) → 30min', async () => {
    await executeInDocker({
      task: { id: 't-light', task_type: 'planner' },
      prompt: 'x',
    });
    const call = runDockerSpy.mock.calls[0];
    expect(call[1].timeoutMs).toBe(30 * 60 * 1000);
  });

  it('opts.timeoutMs 显式传入 → 覆盖 tier', async () => {
    await executeInDocker({
      task: { id: 't-explicit', task_type: 'dev' },
      prompt: 'x',
      timeoutMs: 12345,
    });
    const call = runDockerSpy.mock.calls[0];
    expect(call[1].timeoutMs).toBe(12345);
  });
});

describe('DEFAULT_TIMEOUT_MS = 90min (env override)', () => {
  it('docker-executor.js 源码含 5400000 默认值', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync(new URL('../docker-executor.js', import.meta.url), 'utf8');
    expect(src).toMatch(/CECELIA_DOCKER_TIMEOUT_MS \|\| '5400000'/);
  });
});
```

- [ ] **Step 2: 跑新测试确认失败（Red 验证）**

Run: `cd packages/brain && npx vitest run src/__tests__/docker-executor-timeout.test.js`
Expected: tier 优先级测试失败（当前 docker-executor.js 不读 tier.timeoutMs；DEFAULT_TIMEOUT_MS 还是 900000）。

- [ ] **Step 3: 修改 docker-executor.js (Green)**

修改 `packages/brain/src/docker-executor.js`，第 36 行：

```js
const DEFAULT_TIMEOUT_MS = parseInt(process.env.CECELIA_DOCKER_TIMEOUT_MS || '5400000', 10); // 90 min
```

修改 `executeInDocker` 函数（约 330 行），把 timeoutMs 计算改为：

```js
  const taskId = opts.task.id;
  const taskType = opts.task.task_type || 'dev';
  const tier = resolveResourceTier(taskType);
  const timeoutMs = opts.timeoutMs || tier.timeoutMs || DEFAULT_TIMEOUT_MS;
```

并删除函数体下方原本重复算 `tier` 的那一行（第 347 行 `const tier = resolveResourceTier(taskType);`），把 log 行也用上层 tier。完整新结构：

```js
export async function executeInDocker(opts) {
  if (!opts || !opts.task || !opts.task.id) {
    throw new Error('executeInDocker: opts.task.id is required');
  }
  if (typeof opts.prompt !== 'string' || opts.prompt.length === 0) {
    throw new Error('executeInDocker: opts.prompt is required');
  }

  const taskId = opts.task.id;
  const taskType = opts.task.task_type || 'dev';
  const tier = resolveResourceTier(taskType);
  const timeoutMs = opts.timeoutMs || tier.timeoutMs || DEFAULT_TIMEOUT_MS;

  // v2 P2.5 外层 middleware 接线：logging 入口 + cost-cap 预算守卫。
  const logger = createSpawnLogger(opts);
  logger.logStart();
  await checkCostCap(opts);

  // 写 prompt 文件（宿主侧持久化，用于 debug / audit）
  writePromptFile(taskId, opts.prompt);

  // 账号轮换 middleware
  opts.env = opts.env || {};
  await resolveCascade(opts);
  await resolveAccount(opts, { taskId });

  const { args, _envFinal, name, memoryMB, cpuCores, image, cidfile } = buildDockerArgs(opts);

  if (cidfile && existsSync(cidfile)) {
    try { unlinkSync(cidfile); } catch { /* ignore */ }
  }

  const command = `docker ${args.join(' ')}`;

  console.log(
    `[docker-executor] spawn task=${taskId} type=${taskType} tier=${tier.tier} mem=${memoryMB}m cpus=${cpuCores} timeout=${timeoutMs}ms image=${image} container=${name}`
  );
  if (String(taskType).startsWith('harness_')) {
    console.log('[docker-executor] FULL_ARGS:', JSON.stringify(args));
  }

  const result = await runDocker(args, {
    taskId,
    taskType,
    timeoutMs,
    name,
    cidfile,
    command,
  });

  try { await checkCap(result, opts); } catch (e) { console.warn(`[docker-executor] checkCap failed: ${e.message}`); }
  try { await recordBilling(result, opts); } catch (e) { console.warn(`[docker-executor] recordBilling failed: ${e.message}`); }
  logger.logEnd(result);

  return result;
}
```

- [ ] **Step 4: 跑测试确认通过（Green 验证）**

Run: `cd packages/brain && npx vitest run src/__tests__/docker-executor-timeout.test.js`
Expected: 所有 case PASS。

- [ ] **Step 5: 跑全 brain test 看回归**

Run: `cd packages/brain && npx vitest run src/__tests__/docker-executor.test.js src/__tests__/docker-executor-account-rotation.test.js src/__tests__/docker-executor-metadata.test.js src/spawn/middleware/__tests__/resource-tier.test.js`
Expected: 全部 PASS（既有 docker-executor 测试不读 tier.timeoutMs，加字段不破坏）。

- [ ] **Step 6: 提交 Task 2**

```bash
git add packages/brain/src/docker-executor.js \
        packages/brain/src/__tests__/docker-executor-timeout.test.js
git commit -m "feat(brain): docker timeout 默认 90min + tier-aware override

- DEFAULT_TIMEOUT_MS: 15min → 90min（修 Gen 大改动 SIGKILL）
- executeInDocker 优先级 opts.timeoutMs > tier.timeoutMs > DEFAULT_TIMEOUT_MS
- light=30min / normal=90min / heavy=120min / pipeline-heavy=180min

Brain task: 3f32212a-adc2-436b-b828-51820a2379e6"
```

---

### Task 3: 写 PRD/DoD + Learning + 准备 push

**Files:**
- Create: `PRD.md` (worktree 根)
- Create: `DoD.md` (worktree 根)
- Create: `docs/learnings/cp-0425185125-docker-timeout-tier-aware.md`

- [ ] **Step 1: 写 PRD.md**

Write `/Users/administrator/worktrees/cecelia/docker-timeout-tier-aware/PRD.md`:

```markdown
# PRD: Docker Executor Timeout 默认 90min + per-tier

## 背景
docker-executor.js DEFAULT_TIMEOUT_MS=900000 (15min) 太短，Generator 跑大改动正常需要 1-2h，第一次就被 SIGKILL。

## 范围
- 改 docker-executor.js DEFAULT_TIMEOUT_MS 为 5400000 (90min)
- resource-tier.js RESOURCE_TIERS 每个 tier 加 timeoutMs（light=30min/normal=90min/heavy=120min/pipeline-heavy=180min）
- executeInDocker 优先级：opts.timeoutMs > tier.timeoutMs > DEFAULT_TIMEOUT_MS

## 成功标准
- [ARTIFACT] DEFAULT_TIMEOUT_MS 默认值 5400000
- [ARTIFACT] RESOURCE_TIERS 4 个 tier 都含 timeoutMs 字段
- [BEHAVIOR] tier=normal 任务用 90min timeout（mock test 验证）
- [BEHAVIOR] tier=pipeline-heavy 任务用 180min timeout（mock test 验证）

## Brain task
3f32212a-adc2-436b-b828-51820a2379e6
```

- [ ] **Step 2: 写 DoD.md**

Write `/Users/administrator/worktrees/cecelia/docker-timeout-tier-aware/DoD.md`:

```markdown
# DoD

- [x] [ARTIFACT] docker-executor.js DEFAULT_TIMEOUT_MS=5400000
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8');if(!c.includes(\"CECELIA_DOCKER_TIMEOUT_MS || '5400000'\"))process.exit(1)"

- [x] [ARTIFACT] resource-tier.js RESOURCE_TIERS 含 timeoutMs 字段
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/spawn/middleware/resource-tier.js','utf8');if(!/timeoutMs:\s*30\s*\*\s*60\s*\*\s*1000/.test(c))process.exit(1);if(!/timeoutMs:\s*180\s*\*\s*60\s*\*\s*1000/.test(c))process.exit(1)"

- [x] [BEHAVIOR] tier=normal → 90min / pipeline-heavy → 180min（mock 验证）
  Test: tests/docker-executor-timeout.test.js

- [x] [BEHAVIOR] resource-tier 4 个 tier timeoutMs 数值精确匹配 spec
  Test: tests/resource-tier.test.js
```

- [ ] **Step 3: 写 Learning**

Write `/Users/administrator/worktrees/cecelia/docker-timeout-tier-aware/docs/learnings/cp-0425185125-docker-timeout-tier-aware.md`:

```markdown
# Learning: Docker Timeout 默认值与代码实际值脱节

## 现象
.env.docker 改了 CECELIA_DOCKER_TIMEOUT_MS 但代码 DEFAULT_TIMEOUT_MS 还是 15min，且不分 tier 导致 light 任务也等 90min、heavy 任务还是被 SIGKILL。

### 根本原因
- 默认值"硬编码 + env override"模式让代码 default 长期被忽视，导致 .env.docker 只是临时补丁
- 资源 tier 维度是 memory/cpu，缺时间维度，无法表达"重任务跑久点"的合理诉求

### 下次预防
- [ ] env override 默认值变更时同步改代码 default（grep CECELIA_DOCKER_TIMEOUT_MS）
- [ ] 资源 tier 概念扩展时把 memory/cpu/timeout 三件套放一起（避免下次新增第四个维度散落各处）
- [ ] mock runDocker 写 tier override 测试比读源码 grep 更稳（行为测试 vs 文本测试）
```

- [ ] **Step 4: 提交 Task 3**

```bash
git add PRD.md DoD.md docs/learnings/cp-0425185125-docker-timeout-tier-aware.md
git commit -m "docs: PRD/DoD/Learning for docker timeout tier-aware"
```

- [ ] **Step 5: 跑 DevGate（如适用）**

Run: `bash packages/engine/scripts/dod-mapping/check-dod-mapping.cjs DoD.md` 或等同命令
Expected: PASS

- [ ] **Step 6: 准备进入 finishing skill**

不要 push。把 push + PR 留给 finishing。
