# thalamus bridge launchd + codex trust-check 修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修两个独立的、已用真实命令验证过根因的 bug：`codex exec` 缺 `--skip-git-repo-check` 导致 fallback #1 必失败；`bridge-keepalive-check.sh` 用错 launchctl domain 导致自愈机制永远救不活 `com.cecelia.bridge` LaunchDaemon。

**Architecture:** 两处改动互相独立，不共享状态，各自一个 TDD 任务：先写失败测试证明当前代码有问题，再改一行代码/一处字符串让测试变绿。

**Tech Stack:** Node.js（vitest + child_process mock）、bash（grep 断言）。

---

### Task 1: `callCodexHeadless` 加 `--skip-git-repo-check`

**Files:**
- Modify: `packages/brain/src/llm-caller.js:637-641`（`callCodexHeadless` 内的 `spawn(...)` 调用）
- Test: `packages/brain/src/__tests__/llm-caller-codex-trust-check.test.js`（新建）

- [ ] **Step 1: 写失败测试**

创建 `packages/brain/src/__tests__/llm-caller-codex-trust-check.test.js`：

```javascript
/**
 * 回归测试：codex exec 缺 --skip-git-repo-check 导致 fallback #1 必失败
 *
 * 背景：brain 容器内进程 cwd 不是 git 仓库，codex CLI 默认要求"trusted directory"
 * （git 仓库或已显式信任的目录），缺这个 flag 时 codex exec 直接 exit 1
 * （"Not inside a trusted directory and --skip-git-repo-check was not specified"）。
 * 该错误文本被 300 字符截断规则挡在前面无害的 PATH 只读 WARNING 之后，
 * 曾被误读成"Read-only file system"导致排查方向跑偏。
 *
 * 实测验证（2026-07-11，容器 cecelia-node-brain 内）：
 *   缺 flag → exit 1, stderr含 "Not inside a trusted directory"
 *   加 flag → exit 0, stdout = 真实模型响应
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';

const SRC = readFileSync(new URL('../llm-caller.js', import.meta.url), 'utf8');

describe('callCodexHeadless — --skip-git-repo-check（codex 信任检查修复）', () => {
  it('源码含 --skip-git-repo-check', () => {
    expect(SRC).toContain('--skip-git-repo-check');
  });
});

describe('callCodexHeadless — spawn 参数行为验证', () => {
  let capturedArgs = null;
  let closeHandler = null;

  vi.mock('child_process', () => ({
    spawn: (...args) => {
      capturedArgs = args;
      return {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: (event, handler) => { if (event === 'close') closeHandler = handler; },
      };
    },
  }));

  vi.mock('../model-profile.js', () => ({
    getActiveProfile: vi.fn(() => ({
      config: {
        rumination: { provider: 'codex', model: 'codex/gpt-5.4-mini' },
      },
    })),
  }));

  vi.mock('../account-usage.js', () => ({
    selectBestAccount: vi.fn(async () => ({ accountId: 'account1', model: 'haiku' })),
    markAuthFailure: vi.fn(),
  }));

  vi.mock('../langfuse-reporter.js', () => ({
    reportCall: vi.fn(async () => {}),
  }));

  vi.mock('fs', () => ({
    readFileSync: vi.fn(() => { throw new Error('no team home in test'); }),
  }));

  beforeEach(() => {
    capturedArgs = null;
    closeHandler = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('callLLM(codex provider) 调用 spawn 时参数含 --skip-git-repo-check', async () => {
    const { callLLM } = await import('../llm-caller.js');

    const callPromise = callLLM('rumination', '测试 prompt').catch(() => {});

    // 等待 spawn 被调用（microtask 队列）
    await new Promise((r) => setTimeout(r, 10));

    expect(capturedArgs).not.toBeNull();
    const [, spawnArgs] = capturedArgs;
    expect(spawnArgs).toContain('--skip-git-repo-check');

    // 让 promise 收尾，避免未处理的 rejection 影响其它测试
    if (closeHandler) closeHandler(1);
    await callPromise;
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/llm-caller-codex-trust-check.test.js`
Expected: 第一个 `describe` 的测试 FAIL（源码尚不含 `--skip-git-repo-check`）；第二个 `describe` 的行为测试也 FAIL（`spawnArgs` 不含该字符串）。

- [ ] **Step 3: 实现修复**

打开 `packages/brain/src/llm-caller.js`，找到 `callCodexHeadless` 函数里的 spawn 调用（约 637 行）：

```javascript
  return new Promise((resolve, reject) => {
    const child = spawn('codex', ['exec', '-m', actualModel, prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
```

改为：

```javascript
  return new Promise((resolve, reject) => {
    // --skip-git-repo-check: brain 进程 cwd 不是 git 仓库（容器内 /app），
    // 缺这个 flag 时 codex exec 立即 exit 1（"Not inside a trusted directory"），
    // 该错误文本被截断后常被误读成前面无害的 PATH 只读警告。
    const child = spawn('codex', ['exec', '--skip-git-repo-check', '-m', actualModel, prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/llm-caller-codex-trust-check.test.js`
Expected: 全部 PASS

- [ ] **Step 5: 跑既有 codex fallback 回归测试确认无破坏**

Run: `cd packages/brain && npx vitest run src/__tests__/llm-caller-codex-fallback.test.js src/__tests__/codex-oauth-team-rotation.test.js`
Expected: 全部 PASS（没有破坏既有行为）

- [ ] **Step 6: Commit**

```bash
git add packages/brain/src/llm-caller.js packages/brain/src/__tests__/llm-caller-codex-trust-check.test.js
git commit -m "fix(brain): codex exec 加 --skip-git-repo-check 修复 fallback #1 必失败"
```

---

### Task 2: `bridge-keepalive-check.sh` 修正 launchctl domain

**Files:**
- Modify: `scripts/ops/bridge-keepalive-check.sh:44-45`
- Test: `packages/brain/src/__tests__/bridge-keepalive-domain.test.js`（新建）

- [ ] **Step 1: 写失败测试**

创建 `packages/brain/src/__tests__/bridge-keepalive-domain.test.js`：

```javascript
/**
 * 回归测试：bridge-keepalive-check.sh 用 gui domain kickstart 一个 LaunchDaemon
 *
 * 背景：com.cecelia.bridge 定义在 /Library/LaunchDaemons/com.cecelia.bridge.plist
 * （LaunchDaemon，跑在 system domain，UserName=administrator 只是运行身份，
 * 不改变它所属的 launchd domain）。keepalive 脚本却用
 * `launchctl kickstart gui/${USER_ID}/com.cecelia.bridge` 去救它——gui domain
 * 里根本找不到这个服务，kickstart 必然失败，自愈机制名存实亡。
 *
 * 实测（2026-07-11，宿主机）：
 *   launchctl print system/com.cecelia.bridge → 存在，state=disabled
 *   launchctl print gui/501/com.cecelia.bridge → "Could not find service"
 *   sudo launchctl enable system/com.cecelia.bridge + bootstrap → 恢复运行
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, '../../../../scripts/ops/bridge-keepalive-check.sh');
const SRC = readFileSync(SCRIPT_PATH, 'utf8');

describe('bridge-keepalive-check.sh — launchctl domain 修复', () => {
  it('kickstart 目标用 system domain（LaunchDaemon 归属）', () => {
    expect(SRC).toContain('system/${BRIDGE_PLIST_LABEL}');
  });

  it('不再用 gui/${USER_ID} domain 去 kickstart LaunchDaemon', () => {
    expect(SRC).not.toContain('gui/${USER_ID}/${BRIDGE_PLIST_LABEL}');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/bridge-keepalive-domain.test.js`
Expected: 第二个断言 FAIL（脚本当前仍含 `gui/${USER_ID}/${BRIDGE_PLIST_LABEL}`）

- [ ] **Step 3: 实现修复**

打开 `scripts/ops/bridge-keepalive-check.sh`，找到：

```bash
attempt_restart() {
  # 优先尝试 launchctl kickstart（利用已有 plist）
  echo "$LOG_PREFIX Trying launchctl kickstart gui/${USER_ID}/${BRIDGE_PLIST_LABEL}..."
  if launchctl kickstart "gui/${USER_ID}/${BRIDGE_PLIST_LABEL}" 2>/dev/null; then
```

改为：

```bash
attempt_restart() {
  # com.cecelia.bridge 是 /Library/LaunchDaemons 下的 LaunchDaemon，跑在 system domain，
  # 不是 gui domain（UserName=administrator 只是运行身份，不改变 domain 归属）。
  # 优先尝试 launchctl kickstart（利用已有 plist）
  echo "$LOG_PREFIX Trying launchctl kickstart system/${BRIDGE_PLIST_LABEL}..."
  if launchctl kickstart "system/${BRIDGE_PLIST_LABEL}" 2>/dev/null; then
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/bridge-keepalive-domain.test.js`
Expected: 全部 PASS

- [ ] **Step 5: shellcheck 语法检查（若环境有 shellcheck）**

Run: `command -v shellcheck >/dev/null && shellcheck scripts/ops/bridge-keepalive-check.sh || bash -n scripts/ops/bridge-keepalive-check.sh`
Expected: 无语法错误

- [ ] **Step 6: Commit**

```bash
git add scripts/ops/bridge-keepalive-check.sh packages/brain/src/__tests__/bridge-keepalive-domain.test.js
git commit -m "fix(engine): bridge-keepalive launchctl kickstart 改用 system domain（LaunchDaemon 自愈失效修复）"
```

---

### Task 3: 全量回归 + PR 说明素材

**Files:**
- 无新文件，仅验证

- [ ] **Step 1: 跑 llm-caller 全套测试**

Run: `cd packages/brain && npx vitest run src/__tests__/llm-caller*.test.js src/__tests__/codex-oauth-team-rotation.test.js src/__tests__/model-profile-dispatch.test.js`
Expected: 全部 PASS

- [ ] **Step 2: 确认没有引入未使用的 import 或死代码**

Run: `cd packages/brain && npx eslint src/llm-caller.js`
Expected: 无新增 lint 错误

- [ ] **Step 3: 记录 PR body 用的验证证据（供 finishing 阶段引用，不建独立文件）**

- codex 修复：容器内 `codex exec --skip-git-repo-check -m gpt-5.4-mini "回复一个单词：苹果"` 实测 exit 0，stdout=`苹果`（真实响应，非模板）。
- bridge 修复：`sudo launchctl enable system/com.cecelia.bridge && sudo launchctl bootstrap system /Library/LaunchDaemons/com.cecelia.bridge.plist` 后 `curl :3457/llm-call` 返回真实响应；`launchctl print system/com.cecelia.bridge` state=running。
- thalamus primary provider 未改动：DB 确认自 2026-05-03 起已是 `anthropic(bridge)` 优先。
