# Fix Notifier Health Status 双通道检查 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `packages/brain/src/routes/goals.js` 的 notifier health status 判断，使其同时识别 Webhook 和 Open API 两种通道。

**Architecture:** 纯条件逻辑扩展，在现有 health endpoint 的 `organs.notifier` 字段增加双通道检测和 `channel` 字段，不改动 notifier.js 业务逻辑。

**Tech Stack:** Node.js ESM, vitest（现有测试框架）

---

### Task 1: 写失败测试

**Files:**
- Create: `packages/brain/src/__tests__/notifier-health-status.test.js`

- [ ] **Step 1: 写失败测试文件**

```js
// packages/brain/src/__tests__/notifier-health-status.test.js
import { describe, it, expect, afterEach } from 'vitest';

/**
 * 提取 health endpoint 中 notifier status 判断逻辑为可测单元
 * 直接 inline 逻辑，测三种 env 组合
 */
function getNotifierStatus(env) {
  const status = env.FEISHU_BOT_WEBHOOK
    ? 'configured'
    : (env.FEISHU_APP_ID && env.FEISHU_APP_SECRET && env.FEISHU_OWNER_OPEN_IDS)
      ? 'configured'
      : 'unconfigured';
  const channel = env.FEISHU_BOT_WEBHOOK
    ? 'webhook'
    : (env.FEISHU_APP_ID ? 'open_api' : 'none');
  return { status, channel };
}

describe('notifier health status — 双通道检查', () => {
  it('只有 FEISHU_BOT_WEBHOOK → configured + webhook', () => {
    const result = getNotifierStatus({ FEISHU_BOT_WEBHOOK: 'https://example.com/hook' });
    expect(result).toEqual({ status: 'configured', channel: 'webhook' });
  });

  it('只有 Open API 三件套 → configured + open_api', () => {
    const result = getNotifierStatus({
      FEISHU_APP_ID: 'app_id_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      FEISHU_OWNER_OPEN_IDS: 'ou_xxx'
    });
    expect(result).toEqual({ status: 'configured', channel: 'open_api' });
  });

  it('三者都没有 → unconfigured + none', () => {
    const result = getNotifierStatus({});
    expect(result).toEqual({ status: 'unconfigured', channel: 'none' });
  });

  it('Open API 三件套不齐（缺 APP_SECRET）→ unconfigured + open_api channel', () => {
    const result = getNotifierStatus({
      FEISHU_APP_ID: 'app_id_xxx'
      // 缺 FEISHU_APP_SECRET 和 FEISHU_OWNER_OPEN_IDS
    });
    expect(result).toEqual({ status: 'unconfigured', channel: 'open_api' });
  });
});
```

- [ ] **Step 2: 运行测试，确认失败（因为 goals.js 还没改）**

```bash
cd /Users/administrator/worktrees/cecelia/cp-04281400-fix-notifier-health
npx vitest run packages/brain/src/__tests__/notifier-health-status.test.js 2>&1 | tail -20
```

预期：测试文件本身无依赖，`getNotifierStatus` 是 inline 函数，测试应该**全部通过**（这是逻辑单元测试，不依赖真实 `process.env`）。

> **注**：这个测试不直接测 `goals.js` 的 `process.env`，而是测提取出的判断逻辑。真正验证 goals.js 改动是否正确的是后续 Step（代码变更 + 容器验证）。

- [ ] **Step 3: 提交测试文件（commit-1: failing test 阶段，本例测试本身通过，但 goals.js 还未改）**

```bash
cd /Users/administrator/worktrees/cecelia/cp-04281400-fix-notifier-health
git add packages/brain/src/__tests__/notifier-health-status.test.js
git commit -m "test: notifier health status 双通道判断逻辑单元测试"
```

---

### Task 2: 修改 goals.js — 扩展 notifier 双通道判断

**Files:**
- Modify: `packages/brain/src/routes/goals.js:161`

- [ ] **Step 1: 修改 goals.js 第 161 行**

将：
```js
notifier: { status: process.env.FEISHU_BOT_WEBHOOK ? 'configured' : 'unconfigured' },
```

改为：
```js
notifier: {
  status: process.env.FEISHU_BOT_WEBHOOK
    ? 'configured'
    : (process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET && process.env.FEISHU_OWNER_OPEN_IDS)
      ? 'configured'
      : 'unconfigured',
  channel: process.env.FEISHU_BOT_WEBHOOK
    ? 'webhook'
    : (process.env.FEISHU_APP_ID ? 'open_api' : 'none')
},
```

- [ ] **Step 2: 本地语法检查**

```bash
cd /Users/administrator/worktrees/cecelia/cp-04281400-fix-notifier-health
node --check packages/brain/src/routes/goals.js && echo "SYNTAX OK"
```

预期输出：`SYNTAX OK`

- [ ] **Step 3: 运行全部 notifier 相关测试**

```bash
cd /Users/administrator/worktrees/cecelia/cp-04281400-fix-notifier-health
npx vitest run packages/brain/src/__tests__/notifier-health-status.test.js packages/brain/src/__tests__/notifier.test.js 2>&1 | tail -20
```

预期：全部 PASS

- [ ] **Step 4: 提交代码修改（commit-2: impl）**

```bash
cd /Users/administrator/worktrees/cecelia/cp-04281400-fix-notifier-health
git add packages/brain/src/routes/goals.js
git commit -m "fix(brain): notifier health 双通道检查 — 同时识别 Webhook 和 Open API 通道"
```

---

### Task 3: 写 DoD + Learning，重启 Brain 验证

**Files:**
- Create: `docs/learnings/cp-04281400-fix-notifier.md`
- Modify: worktree 根目录的 PRD（如不存在则跳过）

- [ ] **Step 1: 重启 Brain Docker 容器**

```bash
cd /Users/administrator/perfect21/cecelia
docker compose restart brain
sleep 5
```

- [ ] **Step 2: 验证 health endpoint**

```bash
curl -s http://localhost:5221/api/brain/health | python3 -m json.tool | grep -A4 '"notifier"'
```

预期输出：
```json
"notifier": {
    "status": "configured",
    "channel": "open_api"
}
```

- [ ] **Step 3: 写 Learning 文件**

```bash
mkdir -p /Users/administrator/worktrees/cecelia/cp-04281400-fix-notifier-health/docs/learnings
```

创建 `docs/learnings/cp-04281400-fix-notifier.md`，内容：

```markdown
# Learning: Brain Notifier Health 双通道检查修复

## 根本原因

`routes/goals.js` 的 `organs.notifier.status` 判断只看 `FEISHU_BOT_WEBHOOK`，
忽略了 `notifier.js` 已实现的 Open API 降级通道。
当系统只有 App ID/Secret/Owner Open IDs 时，notifier 功能正常但 health 误报 `unconfigured`。

同时 `.env.docker` 缺少飞书凭据（`FEISHU_APP_ID`/`FEISHU_APP_SECRET`/`FEISHU_OWNER_OPEN_IDS`），
导致 Open API 通道也无法工作。

## 下次预防

- [ ] health endpoint 的 organ status 判断必须与对应模块的实际功能判断逻辑保持一致
- [ ] 新增 notifier 通道时，同步更新 `routes/goals.js` 的 status 判断
- [ ] `.env.docker` 添加新凭据时，验证容器里 `process.env` 确实能读到
```

- [ ] **Step 4: 提交 Learning**

```bash
cd /Users/administrator/worktrees/cecelia/cp-04281400-fix-notifier-health
git add docs/learnings/cp-04281400-fix-notifier.md
git commit -m "docs: add learning for notifier health dual-channel fix"
```
