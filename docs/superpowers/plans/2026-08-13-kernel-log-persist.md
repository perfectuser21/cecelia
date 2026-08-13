# kernel 落盘日志跨部署持久化 + 清理策略 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** kernel 子进程落盘日志默认目录从容器 tmpfs（`/tmp/cecelia-kernel-logs`，部署即清空）改到宿主机 bind-mount 持久路径，并补 TTL 清理策略防止无限堆积。

**Architecture:** 三处独立小改动——(1) `harness-skill-relay.js` 的 `launchKernelProcess` 默认 `logDir` 改为落在 `REPO_ROOT/logs/kernel/`；(2) 新增纯函数模块 `kernel-log-cleanup.js` 做 TTL 清理；(3) 挂进 `disk-guard.js` 现有 15 分钟周期清理序列。三者互不耦合，各自独立可测。

**Tech Stack:** Node.js（`node:fs`/`node:path`/`node:url` 原生模块），Vitest（测试）。

设计详情见 `docs/superpowers/specs/2026-08-13-kernel-log-persist-design.md`。

---

## Task 1: 默认落盘路径改为持久化路径

**Files:**
- Modify: `packages/brain/src/harness-skill-relay.js:134-138`
- Test: `packages/brain/src/__tests__/harness-kernel-launch.test.js`

- [ ] **Step 1: 写失败测试**

在 `packages/brain/src/__tests__/harness-kernel-launch.test.js` 的 `describe('launchKernelProcess detached spawn receipt', ...)` 块内，紧接在已有的"刀0：detached kernel 的 stdio 落盘..."测试后面，新增：

```js
  it('刀0遗留缺口修复：未设置 CECELIA_KERNEL_LOG_DIR 时，落盘目录落在 REPO_ROOT/logs/kernel/，不是 /tmp/', async () => {
    const fakeRepoRoot = mkdtempSync(join(tmpdir(), 'repo-root-'));
    const prevDir = process.env.CECELIA_KERNEL_LOG_DIR;
    const prevRoot = process.env.REPO_ROOT;
    delete process.env.CECELIA_KERNEL_LOG_DIR;
    process.env.REPO_ROOT = fakeRepoRoot;
    try {
      spawnMock.mockReturnValueOnce(okChild());
      const runId = '55555555-5555-4555-8555-555555555555';
      await launchKernelProcess({
        taskId: '66666666-6666-4666-8666-666666666666',
        runId,
        worktreePath: '/tmp',
      });
      const opts = spawnMock.mock.calls.at(-1)[2];
      const expectedLogPath = join(fakeRepoRoot, 'logs', 'kernel', `kernel-${runId}.log`);
      expect(opts.env.CECELIA_KERNEL_LOG_PATH).toBe(expectedLogPath);
      expect(existsSync(expectedLogPath)).toBe(true);
      expect(expectedLogPath.startsWith('/tmp/cecelia-kernel-logs')).toBe(false);
    } finally {
      if (prevDir === undefined) delete process.env.CECELIA_KERNEL_LOG_DIR;
      else process.env.CECELIA_KERNEL_LOG_DIR = prevDir;
      if (prevRoot === undefined) delete process.env.REPO_ROOT;
      else process.env.REPO_ROOT = prevRoot;
    }
  });
```

不需要新增 import——`mkdtempSync`、`existsSync`、`tmpdir`、`join` 在该测试文件顶部已全部导入（第 2-4 行）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-kernel-launch.test.js`
Expected: 新增的这条 FAIL（实际路径仍含 `/tmp/cecelia-kernel-logs`，不等于 `expectedLogPath`）；已有 2 条测试仍 PASS。

- [ ] **Step 3: 写最小实现**

编辑 `packages/brain/src/harness-skill-relay.js` 第 134-138 行，把：

```js
  // 刀0：detached kernel 的 stdout/stderr 落盘到宿主可见目录，替代 stdio:'ignore'。
  // 原先零遗言——kernel 卡死/崩溃时看不到任何栈（planner 停摆 debug 不能）。
  // 落 CECELIA_KERNEL_LOG_DIR（默认 /tmp/cecelia-kernel-logs，compose 已 bind-mount
  // prompt 目录同款可见），文件名带 runId 便于按 run 定位；打不开日志不阻断 spawn。
  const logDir = process.env.CECELIA_KERNEL_LOG_DIR || '/tmp/cecelia-kernel-logs';
```

改为：

```js
  // 刀0：detached kernel 的 stdout/stderr 落盘到宿主可见目录，替代 stdio:'ignore'。
  // 原先零遗言——kernel 卡死/崩溃时看不到任何栈（planner 停摆 debug 不能）。
  // 落 CECELIA_KERNEL_LOG_DIR，未设置时落 REPO_ROOT/logs/kernel/（bind-mount 持久路径，
  // 复用 ops.js:2857 deploy-webhook 同款已验证模式；原先默认 /tmp/cecelia-kernel-logs 落
  // 容器 tmpfs，Brain 每次部署重建容器即清空——诊断 planner 停摆恰好必然伴随一次部署，
  // 缺口和原问题同形状，2026-08-13 生产实测确认。相对路径层级注意：本文件比 ops.js 浅
  // 一层（无 routes/ 子目录），用 3 级 ../../.. 不是 4 级，已用 node 脚本验证过）。
  // 文件名带 runId 便于按 run 定位；打不开日志不阻断 spawn。
  const logDir = process.env.CECELIA_KERNEL_LOG_DIR
    || join(process.env.REPO_ROOT || new URL('../../..', import.meta.url).pathname, 'logs', 'kernel');
```

`join` 已在文件顶部导入（第 22 行 `import { join } from 'node:path';`），无需新增 import。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-kernel-launch.test.js`
Expected: 全部 3 条 PASS。

- [ ] **Step 5: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/kernel-log-persist
git add packages/brain/src/harness-skill-relay.js packages/brain/src/__tests__/harness-kernel-launch.test.js
git commit -m "fix(brain): kernel落盘日志默认目录改为REPO_ROOT/logs/kernel/持久路径

原/tmp/cecelia-kernel-logs落容器tmpfs，Brain每次部署即清空，诊断planner停摆
恰好必然伴随一次部署，缺口和原问题同形状(生产实测确认)。照抄ops.js:2870
已验证模式，但相对路径层级不能照抄4级——本文件比ops.js浅一层，用3级
../../..（已用node脚本验证：4级会算到repo外面/Users/administrator/perfect21/，
未挂载）。"
```

---

## Task 2: TTL 清理函数

**Files:**
- Create: `packages/brain/src/cron/kernel-log-cleanup.js`
- Test: `packages/brain/src/cron/kernel-log-cleanup.test.js`

- [ ] **Step 1: 写失败测试**

创建 `packages/brain/src/cron/kernel-log-cleanup.test.js`：

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, utimesSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { cleanOldKernelLogs, KERNEL_LOG_TTL_MS } from './kernel-log-cleanup.js'

describe('cleanOldKernelLogs', () => {
  let dir

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kernel-log-cleanup-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('[BEHAVIOR-1] 超过 TTL 的日志文件被删除，未超的保留', () => {
    const oldFile = join(dir, 'kernel-old.log')
    const freshFile = join(dir, 'kernel-fresh.log')
    writeFileSync(oldFile, 'old')
    writeFileSync(freshFile, 'fresh')

    const now = Date.now()
    const ttlMs = 7 * 24 * 60 * 60 * 1000
    const oldMtime = new Date(now - ttlMs - 60_000)
    const freshMtime = new Date(now - 60_000)
    utimesSync(oldFile, oldMtime, oldMtime)
    utimesSync(freshFile, freshMtime, freshMtime)

    const result = cleanOldKernelLogs(dir, ttlMs, now)

    expect(existsSync(oldFile)).toBe(false)
    expect(existsSync(freshFile)).toBe(true)
    expect(result).toEqual({ scanned: 2, removed: 1 })
  })

  it('[BEHAVIOR-2] 目录不存在时静默返回 {scanned:0,removed:0}，不抛异常', () => {
    const result = cleanOldKernelLogs(join(dir, 'does-not-exist'))
    expect(result).toEqual({ scanned: 0, removed: 0 })
  })

  it('[BEHAVIOR-3] 默认 TTL 是 7 天', () => {
    expect(KERNEL_LOG_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/cron/kernel-log-cleanup.test.js`
Expected: FAIL（`kernel-log-cleanup.js` 不存在，`Cannot find module`）。

- [ ] **Step 3: 写最小实现**

创建 `packages/brain/src/cron/kernel-log-cleanup.js`：

```js
import { readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

export const KERNEL_LOG_TTL_MS = parseInt(
  process.env.CECELIA_KERNEL_LOG_TTL_MS || String(7 * 24 * 60 * 60 * 1000), 10
)

export function cleanOldKernelLogs(logDir, ttlMs = KERNEL_LOG_TTL_MS, nowMs = Date.now()) {
  let entries
  try {
    entries = readdirSync(logDir)
  } catch {
    return { scanned: 0, removed: 0 }
  }

  let removed = 0
  for (const name of entries) {
    const filePath = join(logDir, name)
    let stat
    try {
      stat = statSync(filePath)
    } catch {
      continue
    }
    if (!stat.isFile()) continue
    if (nowMs - stat.mtimeMs > ttlMs) {
      try {
        unlinkSync(filePath)
        removed += 1
      } catch {
        // best-effort，跟 disk-guard 现有清理动作一致，单个文件删不掉不阻断整体清理
      }
    }
  }
  return { scanned: entries.length, removed }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/cron/kernel-log-cleanup.test.js`
Expected: 全部 3 条 PASS。

- [ ] **Step 5: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/kernel-log-persist
git add packages/brain/src/cron/kernel-log-cleanup.js packages/brain/src/cron/kernel-log-cleanup.test.js
git commit -m "feat(brain): 新增kernel日志TTL清理函数(默认7天)

纯fs操作,不依赖initiative_runs生命周期(更简单,和disk-guard现有周期扫描
模型一致)。目录不存在/删除失败均静默跳过,跟随现有清理逻辑'降级不阻断'哲学。"
```

---

## Task 3: 挂进 disk-guard.js 清理序列

**Files:**
- Modify: `packages/brain/src/cron/disk-guard.js`
- Test: `packages/brain/src/cron/disk-guard.test.js:20-74`（扩展 `[BEHAVIOR-1]`）

- [ ] **Step 1: 写失败测试（修改现有 BEHAVIOR-1）**

在 `packages/brain/src/cron/disk-guard.test.js` 中，把 `[BEHAVIOR-1]` 测试（第 20-74 行）改为：

```js
  it('[BEHAVIOR-1] df 87% 触发完整清理序列，序列按 INV-04 顺序（含kernel日志清理）', async () => {
    // INV-04 顺序：docker container prune → builder prune → worktree_reaper → npm/brew cache → kernel_log_cleanup

    const execMock = vi.fn().mockImplementation(async (cmd) => {
      if (cmd.includes('df ')) {
        const dfCalls = execMock.mock.calls.filter(c => c[0].includes('df ')).length
        if (dfCalls <= 1) {
          callOrder.push('df_initial')
          return { stdout: '87%\n', stderr: '' }
        } else {
          callOrder.push('df_retest')
          return { stdout: '70%\n', stderr: '' }
        }
      }
      if (cmd.includes('docker container prune')) {
        callOrder.push('docker_container_prune')
        return { stdout: '', stderr: '' }
      }
      if (cmd.includes('docker builder prune')) {
        callOrder.push('docker_builder_prune')
        return { stdout: '', stderr: '' }
      }
      if (cmd.includes('npm cache')) {
        callOrder.push('npm_cache')
        return { stdout: '', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })

    const worktreeReaperMock = vi.fn(async () => {
      callOrder.push('worktree_reaper')
      return { results: [] }
    })
    const cleanOldKernelLogsMock = vi.fn(async () => {
      callOrder.push('kernel_log_cleanup')
      return { scanned: 0, removed: 0 }
    })
    const raiseMock = vi.fn().mockResolvedValue(undefined)
    const barkMock = vi.fn().mockResolvedValue(undefined)

    const result = await runDiskGuard({
      execAsync: execMock,
      raise: raiseMock,
      sendBark: barkMock,
      runWorktreeReaper: worktreeReaperMock,
      cleanOldKernelLogs: cleanOldKernelLogsMock,
    })

    // [BEHAVIOR-1]: df 87% → action=clean (retest=70% → no bark)
    expect(result.used).toBe(87)
    expect(result.action).toBe('clean')

    // INV-04: 固定顺序断言（kernel_log_cleanup 追加在末尾，df_retest 之前）
    expect(callOrder).toEqual(['df_initial', 'docker_container_prune', 'docker_builder_prune', 'worktree_reaper', 'npm_cache', 'kernel_log_cleanup', 'df_retest'])

    // worktree reaper 与 kernel log cleanup 均被调用
    expect(worktreeReaperMock).toHaveBeenCalledOnce()
    expect(cleanOldKernelLogsMock).toHaveBeenCalledOnce()
    // raise 被调用（清理后通知）
    expect(raiseMock).toHaveBeenCalled()
  })
```

（其余 `[BEHAVIOR-2]` 至 `[BEHAVIOR-10]` 测试不动。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/cron/disk-guard.test.js`
Expected: `[BEHAVIOR-1]` FAIL（`callOrder` 实际序列缺 `kernel_log_cleanup`，`cleanOldKernelLogsMock` 未被调用）；`[BEHAVIOR-2]` 至 `[BEHAVIOR-10]` 仍 PASS。

- [ ] **Step 3: 写最小实现**

编辑 `packages/brain/src/cron/disk-guard.js`：

顶部 import 段（第 5-10 行）加一行：

```js
import { exec } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'node:path'
import { raise } from '../alerting.js'
import { sendBark } from '../notifier.js'
import { cleanOldKernelLogs as cleanOldKernelLogsDefault } from './kernel-log-cleanup.js'
```

`runDiskGuard` 函数内（第 50-53 行）加一行注入：

```js
  const _exec = deps.execAsync || execAsync
  const _raise = deps.raise || raise
  const _sendBark = deps.sendBark || sendBark
  const _runWorktreeReaper = deps.runWorktreeReaper || null
  const _cleanOldKernelLogs = deps.cleanOldKernelLogs || cleanOldKernelLogsDefault
```

清理序列末尾（第 77 行 `npm/brew cache clean` 那行之后，第 79 行 `// 复测` 注释之前）插入：

```js
      await _exec(buildHostCmd('npm cache clean --force 2>/dev/null; brew cleanup 2>/dev/null; true', inContainer)).catch(e => console.warn('[disk_check] npm/brew cache clean failed:', e.message))

      const kernelLogDir = join(process.env.REPO_ROOT || new URL('../../../..', import.meta.url).pathname, 'logs', 'kernel')
      await Promise.resolve(_cleanOldKernelLogs(kernelLogDir)).catch(e => console.warn('[disk_check] kernel log cleanup failed:', e.message))

      // 复测
```

（`disk-guard.js` 在 `packages/brain/src/cron/`，比 `harness-skill-relay.js` 深一层，兜底相对路径用 4 级 `../../../..`——已用 node 脚本验证与 `ops.js` 同款深度，跟 Task 1 的 3 级不是同一个数字，不要弄混。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/cron/disk-guard.test.js`
Expected: 全部 10 条 `[BEHAVIOR-*]` PASS。

- [ ] **Step 5: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/kernel-log-persist
git add packages/brain/src/cron/disk-guard.js packages/brain/src/cron/disk-guard.test.js
git commit -m "feat(brain): disk-guard清理序列挂进kernel日志TTL清理

复用现有15分钟周期扫描,不新增独立cron。依赖注入写法跟runWorktreeReaper
同款。disk-guard.js比harness-skill-relay.js深一层(cron/子目录),兜底相对
路径用4级../../..（跟ops.js同深度,已用node脚本验证,不要跟Task1的3级弄混）。"
```

---

## Task 4: 版本同步（4 处 + 根 package-lock.json 第 5 处）

**Files:**
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `.brain-versions`
- Modify: `DEFINITION.md:11`
- Modify: 根 `package-lock.json`（`packages["packages/brain"].version`）

当前版本（改动前实测）：`1.272.22`。本次改动触碰 `packages/brain/src/**`，`brain-version-bump-gate` 要求 PR 版本严格大于 base，patch bump 到 `1.272.23`。

- [ ] **Step 1: bump packages/brain 自身版本**

```bash
cd /Users/administrator/worktrees/cecelia/kernel-log-persist/packages/brain
npm version patch --no-git-tag-version
```

Expected: 输出 `v1.272.23`；`package.json` 与 `package-lock.json` 的 `version` 字段均变为 `1.272.23`。

- [ ] **Step 2: 同步 .brain-versions**

```bash
cd /Users/administrator/worktrees/cecelia/kernel-log-persist
node -e "process.stdout.write(require('./packages/brain/package.json').version)" >> .brain-versions
echo "" >> .brain-versions
tail -3 .brain-versions
```

Expected: 最后一行是 `1.272.23`。

- [ ] **Step 3: 同步 DEFINITION.md**

编辑 `DEFINITION.md` 第 11 行，把：
```
**Brain 版本**: 1.272.22
```
改为：
```
**Brain 版本**: 1.272.23
```

- [ ] **Step 4: 同步根 package-lock.json 的 workspace 条目（容易漏的第 5 处，PR #4840 踩过）**

```bash
cd /Users/administrator/worktrees/cecelia/kernel-log-persist
npm install --package-lock-only
node -e "
const d = JSON.parse(require('fs').readFileSync('package-lock.json','utf8'));
console.log('root package-lock.json packages[\"packages/brain\"].version =', d.packages['packages/brain'].version);
"
```

Expected: 打印 `1.272.23`。

- [ ] **Step 5: 跑本地 version sync 校验脚本确认全绿**

```bash
cd /Users/administrator/worktrees/cecelia/kernel-log-persist
bash scripts/check-version-sync.sh
```

Expected: `✅ All version files in sync`。

- [ ] **Step 6: 提交**

```bash
cd /Users/administrator/worktrees/cecelia/kernel-log-persist
git add packages/brain/package.json packages/brain/package-lock.json .brain-versions DEFINITION.md package-lock.json
git commit -m "chore(brain): version bump 1.272.22 → 1.272.23

kernel落盘日志持久化修复触碰packages/brain/src/**,brain-version-bump-gate
要求版本严格大于base。5处同步:package.json+package-lock.json(brain自身)
+.brain-versions+DEFINITION.md+根package-lock.json workspace条目(PR#4840
踩过的第5处,check-version-sync.sh不检查这处,靠npm install --package-lock-only
同步)。"
```

---

## Task 5: 全量回归 + 集成验收

**Files:** 无新文件，验证性任务

- [ ] **Step 1: 跑受影响模块全部单测**

```bash
cd /Users/administrator/worktrees/cecelia/kernel-log-persist/packages/brain
npx vitest run src/__tests__/harness-kernel-launch.test.js src/__tests__/harness-skill-relay.test.js src/__tests__/harness-skill-relay-spawn-event.test.js src/__tests__/harness-skill-relay-xian.test.js src/cron/disk-guard.test.js src/cron/kernel-log-cleanup.test.js
```

Expected: 全部 PASS，0 failed。

- [ ] **Step 2: 跑 brain 全量单测（防止改动波及无关模块）**

```bash
cd /Users/administrator/worktrees/cecelia/kernel-log-persist/packages/brain
npx vitest run
```

Expected: 全部 PASS（跟 main 分支基线对比，不新增 failed）。

- [ ] **Step 3: 集成验收（哨兵，环境接缝，CI 测不到，必须真实验证）**

这是本次修复唯一的存在理由——PR merge 部署后，人工执行：

```bash
# 部署后（brain-deploy.sh 跑完，容器已重建）
docker exec cecelia-node-brain node -e "console.log(process.env.REPO_ROOT)"
# 确认输出的路径下 logs/kernel/ 目录存在（如果已有 kernel run 跑过）
ls -la $(docker exec cecelia-node-brain node -e "console.log(process.env.REPO_ROOT)" | tr -d '\r')/logs/kernel/ 2>&1 || echo "尚无 kernel run，触发一次后再查"
```

若尚未有真实 kernel run，可在下一次真实 harness_initiative 任务跑起来后回来复查一次，确认容器重建（下次部署）后该目录及文件仍存在。此步骤记录在 PR description 里作为验收证据，不阻塞 PR 合并（环境接缝验证依赖真实部署时机，CI 无法覆盖）。

---

## Self-Review Notes

- **Spec 覆盖**：设计文档三处改动（落盘路径 / TTL 清理函数 / disk-guard 挂钩）分别对应 Task 1/2/3；版本同步对应 Task 4（PRD 验收标准明确要求）；集成验收对应 Task 5（PRD "唯一存在理由"）。无遗漏。
- **占位符扫描**：无 TBD/TODO，所有代码块是完整可运行代码。
- **类型一致性**：`cleanOldKernelLogs(logDir, ttlMs, nowMs)` 签名在 Task 2 定义、Task 3 disk-guard.js 调用（`_cleanOldKernelLogs(kernelLogDir)`，其余两参数走默认值）、Task 2/3 测试中的调用方式三处一致。`KERNEL_LOG_TTL_MS` 命名在导出、测试断言两处一致。
