# Gate 5 A1: Honeycomb 接入 + Brain OpenTelemetry SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Brain（cecelia-brain）中接入 OpenTelemetry SDK，将 traces/metrics 通过 OTLP exporter 发往 Honeycomb；无 `HONEYCOMB_API_KEY` 时静默跳过，不报错、不阻塞启动。

**Architecture:** 新建 `packages/brain/src/otel.js` 负责 NodeSDK 初始化，在 `packages/brain/server.js` 最顶部导入并调用 `initOtel()`（在所有其他 import 之前）。SDK 检测 `HONEYCOMB_API_KEY` 环境变量，缺失时返回 null。

**Tech Stack:** `@opentelemetry/sdk-node`, `@opentelemetry/exporter-otlp-http`, `@opentelemetry/auto-instrumentations-node`, vitest（unit test），bash smoke。

---

## TDD 纪律（IRON LAW）

**NO PRODUCTION CODE WITHOUT FAILING TEST FIRST.**

- 每个 task commit 顺序：commit-1 = fail test，commit-2 = impl（让 test 变绿）
- 你不是写 prototype，不能跳过 TDD

---

## 文件变更清单

| 操作 | 文件 |
|------|------|
| 安装依赖 | `packages/brain/package.json` |
| 新建 | `packages/brain/src/otel.js` |
| 修改 | `packages/brain/server.js` |
| 新建 | `packages/brain/src/__tests__/otel.test.js` |
| 新建 | `packages/brain/scripts/smoke/gate5-a1-otel-smoke.sh` |
| 修改 | `.agent-knowledge/brain.md` |

---

## Task 1: 写失败测试 + 安装依赖

**Files:**
- Create: `packages/brain/src/__tests__/otel.test.js`
- Modify: `packages/brain/package.json`

- [ ] **Step 1: 创建测试文件（此时 otel.js 不存在，测试必然 FAIL）**

创建 `packages/brain/src/__tests__/otel.test.js`：

```js
/**
 * otel.js 单元测试
 * TDD: 先写失败 test，install 依赖 + 实现后变绿
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('otel - graceful skip when no API key', () => {
  const origKey = process.env.HONEYCOMB_API_KEY;

  beforeEach(() => {
    delete process.env.HONEYCOMB_API_KEY;
    vi.resetModules();
  });

  afterEach(() => {
    if (origKey !== undefined) {
      process.env.HONEYCOMB_API_KEY = origKey;
    } else {
      delete process.env.HONEYCOMB_API_KEY;
    }
  });

  it('initOtel() 在无 HONEYCOMB_API_KEY 时不抛错', async () => {
    const { initOtel } = await import('../otel.js');
    await expect(Promise.resolve(initOtel())).resolves.not.toThrow();
  });

  it('initOtel() 无 key 时返回 null（跳过模式）', async () => {
    const { initOtel } = await import('../otel.js');
    const result = await initOtel();
    expect(result).toBeNull();
  });
});

describe('otel - with HONEYCOMB_API_KEY', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.HONEYCOMB_API_KEY;
    vi.resetModules();
  });

  it('initOtel() 有 key 时返回 SDK 实例（非 null）', async () => {
    vi.doMock('@opentelemetry/sdk-node', () => ({
      NodeSDK: vi.fn().mockImplementation(() => ({
        start: vi.fn(),
        shutdown: vi.fn().mockResolvedValue(undefined),
      })),
    }));
    vi.doMock('@opentelemetry/exporter-otlp-http', () => ({
      OTLPTraceExporter: vi.fn().mockImplementation(() => ({})),
    }));
    vi.doMock('@opentelemetry/auto-instrumentations-node', () => ({
      getNodeAutoInstrumentations: vi.fn().mockReturnValue([]),
    }));

    process.env.HONEYCOMB_API_KEY = 'test-key-abc123';
    const { initOtel, _resetOtel } = await import('../otel.js');
    const sdk = await initOtel();
    expect(sdk).not.toBeNull();
    _resetOtel();
  });
});
```

- [ ] **Step 2: 运行确认测试失败**

```bash
cd /Users/administrator/worktrees/cecelia/gate5-a1-otel-honeycomb/packages/brain
npx vitest run src/__tests__/otel.test.js 2>&1 | tail -15
```

预期：FAIL — `Cannot find module '../otel.js'` 或类似错误

- [ ] **Step 3: commit-1（fail test）**

```bash
cd /Users/administrator/worktrees/cecelia/gate5-a1-otel-honeycomb
git add packages/brain/src/__tests__/otel.test.js
git commit -m "test(brain): Gate 5 A1 — otel graceful-skip + init unit tests (RED)"
```

- [ ] **Step 4: 安装 OTel 依赖**

```bash
cd /Users/administrator/worktrees/cecelia/gate5-a1-otel-honeycomb/packages/brain
npm install @opentelemetry/sdk-node @opentelemetry/exporter-otlp-http @opentelemetry/auto-instrumentations-node
```

确认 `package.json` 的 `dependencies` 中出现这 3 个包。

---

## Task 2: 实现 otel.js

**Files:**
- Create: `packages/brain/src/otel.js`

- [ ] **Step 1: 创建 `packages/brain/src/otel.js`**

```js
/**
 * otel.js — Brain OpenTelemetry SDK 初始化
 *
 * 环境变量：
 *   HONEYCOMB_API_KEY — Honeycomb API 密钥。缺失时静默跳过，不报错。
 *
 * 用法（必须在 server.js 最顶部调用）：
 *   import { initOtel } from './src/otel.js';
 *   await initOtel();
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const SERVICE_NAME = 'cecelia-brain';
const HONEYCOMB_ENDPOINT = 'https://api.honeycomb.io';

let _sdk = null;

/**
 * 初始化 OpenTelemetry SDK。
 * 无 HONEYCOMB_API_KEY 时静默返回 null，不抛错。
 * @returns {NodeSDK|null}
 */
export async function initOtel() {
  const apiKey = process.env.HONEYCOMB_API_KEY;

  if (!apiKey) {
    return null;
  }

  try {
    const traceExporter = new OTLPTraceExporter({
      url: `${HONEYCOMB_ENDPOINT}/v1/traces`,
      headers: {
        'x-honeycomb-team': apiKey,
      },
    });

    _sdk = new NodeSDK({
      serviceName: SERVICE_NAME,
      traceExporter,
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': { enabled: false },
        }),
      ],
    });

    _sdk.start();
    return _sdk;
  } catch (err) {
    console.warn('[otel] OTel SDK 初始化失败（非致命）:', err.message);
    return null;
  }
}

/** 仅供测试使用：重置 SDK 实例 */
export function _resetOtel() {
  if (_sdk) {
    try { _sdk.shutdown(); } catch (_) {}
    _sdk = null;
  }
}
```

- [ ] **Step 2: 运行测试确认全部变绿**

```bash
cd /Users/administrator/worktrees/cecelia/gate5-a1-otel-honeycomb/packages/brain
npx vitest run src/__tests__/otel.test.js 2>&1 | tail -15
```

预期：3 tests passed

- [ ] **Step 3: commit-2（impl）**

```bash
cd /Users/administrator/worktrees/cecelia/gate5-a1-otel-honeycomb
git add packages/brain/src/otel.js packages/brain/package.json packages/brain/package-lock.json
git commit -m "feat(brain): Gate 5 A1 — otel.js NodeSDK + Honeycomb OTLP exporter"
```

---

## Task 3: 接入 server.js 顶部

**Files:**
- Modify: `packages/brain/server.js`

- [ ] **Step 1: 在 server.js 最顶部插入 otel 初始化**

打开 `packages/brain/server.js`，在第一行（`import 'dotenv/config';`）**之前**插入以下 3 行：

```js
// OTel 必须在所有其他 import 之前初始化（auto-instrumentation 要求）
import { initOtel } from './src/otel.js';
await initOtel();

```

server.js 开头应变为：

```js
// OTel 必须在所有其他 import 之前初始化（auto-instrumentation 要求）
import { initOtel } from './src/otel.js';
await initOtel();

import 'dotenv/config';
import express from 'express';
// ... 后续 import 不变
```

- [ ] **Step 2: 本地语法冒烟**

```bash
cd /Users/administrator/worktrees/cecelia/gate5-a1-otel-honeycomb/packages/brain
node --check server.js 2>&1
echo "exit: $?"
```

预期：无错误输出，exit: 0

- [ ] **Step 3: commit-3（server.js 接入）**

```bash
cd /Users/administrator/worktrees/cecelia/gate5-a1-otel-honeycomb
git add packages/brain/server.js
git commit -m "feat(brain): Gate 5 A1 — server.js 顶部接入 initOtel()"
```

---

## Task 4: smoke 脚本 + brain.md 更新

**Files:**
- Smoke 脚本已创建：`packages/brain/scripts/smoke/gate5-a1-otel-smoke.sh`
- Modify: `.agent-knowledge/brain.md`

- [ ] **Step 1: 验证 smoke 脚本可以在 worktree 根目录执行**

```bash
cd /Users/administrator/worktrees/cecelia/gate5-a1-otel-honeycomb
bash packages/brain/scripts/smoke/gate5-a1-otel-smoke.sh
```

预期：PASS: 6  FAIL: 0，最后一行 `✅ Gate 5 A1 smoke PASSED`

- [ ] **Step 2: 更新 .agent-knowledge/brain.md**

在 `.agent-knowledge/brain.md` 中找到文件清单部分，在 `observe-runner.js` 或合适位置新增一行：

```
| `src/otel.js` | OpenTelemetry SDK 初始化，Honeycomb OTLP exporter，无 API key 时静默跳过 |
```

- [ ] **Step 3: commit-4（smoke + docs）**

```bash
cd /Users/administrator/worktrees/cecelia/gate5-a1-otel-honeycomb
git add packages/brain/scripts/smoke/gate5-a1-otel-smoke.sh .agent-knowledge/brain.md
git commit -m "feat(brain): Gate 5 A1 — smoke 脚本 + brain.md 更新"
```

---

## 自查清单（push 前必须全部完成）

- [ ] `git log --oneline` 确认 commit 顺序：test(RED) → feat(impl) → feat(server) → feat(smoke)
- [ ] `node --check packages/brain/server.js` 语法正确
- [ ] `bash packages/brain/scripts/smoke/gate5-a1-otel-smoke.sh` 全绿
- [ ] `packages/brain/src/__tests__/otel.test.js` 3 tests passed
