# dispatch-worker 跨账号派工脚本 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `scripts/dispatch-worker.mjs`——controller 派工胶水：查账号余量→选账号→吊 headless worker（codex/claude/grok）→额度撞墙自动换账号→输出结构化 JSON。

**Architecture:** 单文件 ESM 脚本，纯函数全部 export 供 node --test 单测；CLI 入口只做参数解析+组装。撞墙识别只信输出文本不信 exit code（07-16 实测 codex 撞墙 exit=0）。自包含不 import brain 模块，但阈值语义（used_percent 升序、≥90 不可用）与 brain codex-account-usage.cjs 对齐。

**Tech Stack:** Node 20（CI setup-node 20），node:test + node:assert，全局 fetch，node:child_process spawn。

## Global Constraints

- TDD 铁律：NO PRODUCTION CODE WITHOUT FAILING TEST FIRST；每 task commit 顺序：commit-1 fail test / commit-2 impl
- 所有输出简体中文（代码注释也是）
- claude worker 必须用真身 `/opt/homebrew/bin/claude`（裸 claude 被 alias 劫持）
- 阈值常量：USABLE_THRESHOLD = 90
- spec: docs/superpowers/specs/2026-07-16-dispatch-worker-design.md

---

### Task 1: 纯函数层（detectQuotaWall / buildCommand / pickAccounts / dispatchWithRotation）

**Files:**
- Create: `scripts/dispatch-worker.mjs`
- Test: `scripts/dispatch-worker.test.mjs`

**Interfaces:**
- Produces（Task 2 依赖这些精确签名）:
  - `detectQuotaWall(text: string) => boolean`
  - `buildCommand(vendor: 'codex'|'claude'|'grok', account: {home:string}, brief: string, dir: string) => {cmd, args, env, cwd}`
  - `pickAccounts(usages: Array<{account:{vendor,name,home}, usable:boolean, usedPercent:number}>, {vendor:'auto'|string}) => 排序后的候选数组`
  - `dispatchWithRotation({candidates, brief, dir, maxRetries, runWorker}) => Promise<{ok, vendor?, account?, reason?, attempts, exit_code}>`（runWorker 注入：`(account, brief, dir) => Promise<{output, exitCode}>`）
  - `ACCOUNT_POOL`、`USABLE_THRESHOLD` 常量

- [ ] **Step 1: 写失败测试**

```js
// scripts/dispatch-worker.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectQuotaWall, buildCommand, pickAccounts, dispatchWithRotation,
  ACCOUNT_POOL, USABLE_THRESHOLD,
} from './dispatch-worker.mjs';

test('detectQuotaWall: 命中 07-16 实测 codex 撞墙原文', () => {
  assert.equal(detectQuotaWall('ERROR: Your workspace is out of credits. Add credits to continue.'), true);
});

test('detectQuotaWall: 命中 rate limit / usage limit / 429', () => {
  assert.equal(detectQuotaWall('You have hit your RATE LIMIT for this window'), true);
  assert.equal(detectQuotaWall('usage limit reached, resets at 07:18'), true);
  assert.equal(detectQuotaWall('HTTP error 429 from upstream'), true);
});

test('detectQuotaWall: 正常输出与空输入不误报', () => {
  assert.equal(detectQuotaWall('段2完成，node test.js 全绿'), false);
  assert.equal(detectQuotaWall(''), false);
  assert.equal(detectQuotaWall(null), false);
});

test('buildCommand: codex 用 CODEX_HOME + exec --cd --sandbox workspace-write', () => {
  const c = buildCommand('codex', { home: '/h/.codex-team1' }, '任务书', '/w');
  assert.equal(c.cmd, 'codex');
  assert.deepEqual(c.args, ['exec', '--cd', '/w', '--sandbox', 'workspace-write', '任务书']);
  assert.equal(c.env.CODEX_HOME, '/h/.codex-team1');
  assert.equal(c.cwd, '/w');
});

test('buildCommand: claude 用真身路径 + CLAUDE_CONFIG_DIR（绝不用裸 claude）', () => {
  const c = buildCommand('claude', { home: '/h/.claude-account2' }, '任务书', '/w');
  assert.equal(c.cmd, '/opt/homebrew/bin/claude');
  assert.deepEqual(c.args, ['-p', '--dangerously-skip-permissions', '任务书']);
  assert.equal(c.env.CLAUDE_CONFIG_DIR, '/h/.claude-account2');
  assert.equal(c.cwd, '/w');
});

test('buildCommand: grok 用 -p --cwd --always-approve', () => {
  const c = buildCommand('grok', { home: '/h/.grok' }, '任务书', '/w');
  assert.ok(c.cmd.endsWith('/.grok/bin/grok'));
  assert.deepEqual(c.args, ['-p', '任务书', '--cwd', '/w', '--always-approve']);
  assert.equal(c.cwd, '/w');
});

test('buildCommand: 未知 vendor 抛错', () => {
  assert.throws(() => buildCommand('gemini', { home: '/h' }, 'b', '/w'), /unknown vendor/);
});

const U = (vendor, name, usable, usedPercent) => ({ account: { vendor, name, home: `/h/${name}` }, usable, usedPercent });

test('pickAccounts: used_percent 升序，过滤不可用', () => {
  const got = pickAccounts([U('codex','team2',false,100), U('codex','team1',true,0), U('claude','account2',true,13)], { vendor: 'auto' });
  assert.deepEqual(got.map((u) => u.account.name), ['team1', 'account2']);
});

test('pickAccounts: grok 恒可用垫底（usedPercent=Infinity）', () => {
  const got = pickAccounts([U('grok','grok',true,Infinity), U('codex','team1',true,50)], { vendor: 'auto' });
  assert.deepEqual(got.map((u) => u.account.name), ['team1', 'grok']);
});

test('pickAccounts: vendor 偏好过滤', () => {
  const got = pickAccounts([U('codex','team1',true,0), U('claude','account2',true,13)], { vendor: 'claude' });
  assert.deepEqual(got.map((u) => u.account.name), ['account2']);
});

test('dispatchWithRotation: 撞墙换下家，第二家成功', async () => {
  const calls = [];
  const outputs = [
    { output: 'ERROR: Your workspace is out of credits.', exitCode: 0 },
    { output: '完成', exitCode: 0 },
  ];
  const r = await dispatchWithRotation({
    candidates: [U('codex','team2',true,80), U('codex','team1',true,0)],
    brief: 'b', dir: '/w', maxRetries: 2,
    runWorker: async (account) => { calls.push(account.name); return outputs.shift(); },
  });
  assert.deepEqual(calls, ['team2', 'team1']);
  assert.equal(r.ok, true);
  assert.equal(r.account, 'team1');
  assert.equal(r.attempts.length, 2);
  assert.equal(r.attempts[0].quota_wall, true);
});

test('dispatchWithRotation: 全池撞墙 → pool_exhausted', async () => {
  const r = await dispatchWithRotation({
    candidates: [U('codex','team1',true,0), U('codex','team2',true,80)],
    brief: 'b', dir: '/w', maxRetries: 2,
    runWorker: async () => ({ output: 'quota exceeded', exitCode: 0 }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'pool_exhausted');
  assert.equal(r.exit_code, 1);
});

test('dispatchWithRotation: 非零退出且非撞墙 → 不换账号原样返回', async () => {
  let calls = 0;
  const r = await dispatchWithRotation({
    candidates: [U('codex','team1',true,0), U('codex','team2',true,80)],
    brief: 'b', dir: '/w', maxRetries: 2,
    runWorker: async () => { calls++; return { output: '任务本身失败了', exitCode: 3 }; },
  });
  assert.equal(calls, 1);
  assert.equal(r.ok, false);
  assert.equal(r.exit_code, 3);
});

test('dispatchWithRotation: maxRetries 限制尝试次数（maxRetries+1 家）', async () => {
  let calls = 0;
  const r = await dispatchWithRotation({
    candidates: [U('codex','team1',true,0), U('codex','team2',true,10), U('grok','grok',true,Infinity)],
    brief: 'b', dir: '/w', maxRetries: 1,
    runWorker: async () => { calls++; return { output: 'out of credits', exitCode: 0 }; },
  });
  assert.equal(calls, 2);
  assert.equal(r.reason, 'pool_exhausted');
});

test('ACCOUNT_POOL: 含本机四账号，claude 只有 account2（account1 是 controller 主线）', () => {
  const names = ACCOUNT_POOL.map((a) => `${a.vendor}:${a.name}`);
  assert.deepEqual(names, ['codex:team1', 'codex:team2', 'claude:account2', 'grok:grok']);
  assert.equal(USABLE_THRESHOLD, 90);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test scripts/dispatch-worker.test.mjs`
Expected: FAIL（Cannot find module './dispatch-worker.mjs'）

- [ ] **Step 3: commit-1（failing test）**

```bash
git add scripts/dispatch-worker.test.mjs
git commit -m "test: dispatch-worker 纯函数层 failing tests (TDD commit-1)"
```

- [ ] **Step 4: 最小实现**

```js
// scripts/dispatch-worker.mjs
#!/usr/bin/env node
// 跨账号 headless worker 派工胶水：查余量→选账号→吊 worker→额度撞墙换账号重试
// 链路 2026-07-16 实测（memory: worker-pool-cross-account-verified）
// 撞墙识别只信输出文本不信 exit code（实测 codex 撞墙 exit=0）
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, createWriteStream } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// 阈值语义与 packages/brain/scripts/codex-bridge/codex-account-usage.cjs 对齐
export const USABLE_THRESHOLD = 90;

export const ACCOUNT_POOL = [
  { vendor: 'codex', name: 'team1', home: join(homedir(), '.codex-team1') },
  { vendor: 'codex', name: 'team2', home: join(homedir(), '.codex-team2') },
  // account1 是 controller 主线账号，不下场当 worker
  { vendor: 'claude', name: 'account2', home: join(homedir(), '.claude-account2') },
  { vendor: 'grok', name: 'grok', home: join(homedir(), '.grok') },
];

const QUOTA_WALL_PATTERNS = [/out of credits/i, /rate limit/i, /usage limit/i, /\b429\b/, /quota/i];

export function detectQuotaWall(text) {
  if (!text) return false;
  return QUOTA_WALL_PATTERNS.some((re) => re.test(text));
}

export function buildCommand(vendor, account, brief, dir) {
  if (vendor === 'codex') {
    return { cmd: 'codex', args: ['exec', '--cd', dir, '--sandbox', 'workspace-write', brief], env: { CODEX_HOME: account.home }, cwd: dir };
  }
  if (vendor === 'claude') {
    // 必须用真身：裸 claude 被 claude-launch.sh alias 劫持，headless 报 _claude_launch not found
    return { cmd: '/opt/homebrew/bin/claude', args: ['-p', '--dangerously-skip-permissions', brief], env: { CLAUDE_CONFIG_DIR: account.home }, cwd: dir };
  }
  if (vendor === 'grok') {
    return { cmd: join(homedir(), '.grok/bin/grok'), args: ['-p', brief, '--cwd', dir, '--always-approve'], env: {}, cwd: dir };
  }
  throw new Error(`unknown vendor: ${vendor}`);
}

export function pickAccounts(usages, { vendor = 'auto' } = {}) {
  return usages
    .filter((u) => (vendor === 'auto' ? true : u.account.vendor === vendor))
    .filter((u) => u.usable)
    .sort((a, b) => a.usedPercent - b.usedPercent);
}

export async function dispatchWithRotation({ candidates, brief, dir, maxRetries = 2, runWorker }) {
  const attempts = [];
  for (const cand of candidates.slice(0, maxRetries + 1)) {
    const { output, exitCode } = await runWorker(cand.account, brief, dir);
    const wall = detectQuotaWall(output);
    attempts.push({ vendor: cand.account.vendor, account: cand.account.name, quota_wall: wall, exit_code: exitCode });
    if (wall) continue; // 额度墙 → 换下家
    // 非撞墙的失败是任务问题不是额度问题，不换账号
    return { ok: exitCode === 0, vendor: cand.account.vendor, account: cand.account.name, attempts, exit_code: exitCode };
  }
  return { ok: false, reason: 'pool_exhausted', attempts, exit_code: 1 };
}
```

- [ ] **Step 5: 跑测试确认全绿**

Run: `node --test scripts/dispatch-worker.test.mjs`
Expected: 全部 PASS（15 tests）

- [ ] **Step 6: commit-2（实现）**

```bash
git add scripts/dispatch-worker.mjs
git commit -m "feat: dispatch-worker 纯函数层——撞墙识别/三厂商命令/选账号/轮换 (TDD commit-2)"
```

---

### Task 2: 余量查询 + CLI 入口

**Files:**
- Modify: `scripts/dispatch-worker.mjs`（追加到文件末尾）
- Test: `scripts/dispatch-worker.test.mjs`（追加）

**Interfaces:**
- Consumes: Task 1 的全部纯函数
- Produces:
  - `queryUsage(account) => Promise<{account, usable:boolean, usedPercent:number}>`
  - `parseArgs(argv: string[]) => {brief, dir, vendor, maxRetries}`（校验失败 throw）
  - CLI：`node scripts/dispatch-worker.mjs --brief <文件或字符串> --dir <workdir> [--vendor auto] [--max-retries 2]`，stdout 最后一行 JSON

- [ ] **Step 1: 写失败测试（追加）**

```js
// 追加到 scripts/dispatch-worker.test.mjs
import { parseArgs } from './dispatch-worker.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';

test('parseArgs: 完整参数解析', () => {
  const d = mkdtempSync(pjoin(tmpdir(), 'dw-'));
  const got = parseArgs(['--brief', '干活', '--dir', d, '--vendor', 'codex', '--max-retries', '3']);
  assert.equal(got.brief, '干活');
  assert.equal(got.dir, d);
  assert.equal(got.vendor, 'codex');
  assert.equal(got.maxRetries, 3);
});

test('parseArgs: brief 是存在的文件路径时读文件内容', () => {
  const d = mkdtempSync(pjoin(tmpdir(), 'dw-'));
  const f = pjoin(d, 'brief.md');
  writeFileSync(f, '任务书全文');
  const got = parseArgs(['--brief', f, '--dir', d]);
  assert.equal(got.brief, '任务书全文');
});

test('parseArgs: 默认 vendor=auto maxRetries=2', () => {
  const d = mkdtempSync(pjoin(tmpdir(), 'dw-'));
  const got = parseArgs(['--brief', 'b', '--dir', d]);
  assert.equal(got.vendor, 'auto');
  assert.equal(got.maxRetries, 2);
});

test('parseArgs: 缺 brief 或 dir 不存在 → throw', () => {
  assert.throws(() => parseArgs(['--dir', '/tmp']), /--brief/);
  assert.throws(() => parseArgs(['--brief', 'b', '--dir', '/不存在的路径xx']), /--dir/);
});
```

- [ ] **Step 2: 跑测试确认新增 4 条失败**

Run: `node --test scripts/dispatch-worker.test.mjs`
Expected: parseArgs 4 条 FAIL（parseArgs is not exported），Task 1 的 15 条仍 PASS

- [ ] **Step 3: commit-1**

```bash
git add scripts/dispatch-worker.test.mjs
git commit -m "test: dispatch-worker CLI 参数解析 failing tests (TDD commit-1)"
```

- [ ] **Step 4: 实现 queryUsage + parseArgs + CLI main（追加到 dispatch-worker.mjs 末尾）**

```js
// ---------- 余量查询 ----------
export async function queryUsage(account) {
  const fail = { account, usable: false, usedPercent: 100 };
  try {
    if (account.vendor === 'grok') {
      // grok 无额度 API：登录了就恒可用，垫底候选
      return { account, usable: existsSync(join(account.home, 'auth.json')), usedPercent: Infinity };
    }
    if (account.vendor === 'codex') {
      const a = JSON.parse(readFileSync(join(account.home, 'auth.json'), 'utf8'));
      const r = await fetch('https://chatgpt.com/backend-api/wham/usage', {
        headers: { Authorization: `Bearer ${a.tokens?.access_token}`, 'ChatGPT-Account-Id': a.tokens?.account_id },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return fail;
      const pct = (await r.json()).rate_limit?.primary_window?.used_percent ?? 100;
      return { account, usable: pct < USABLE_THRESHOLD, usedPercent: pct };
    }
    if (account.vendor === 'claude') {
      const c = JSON.parse(readFileSync(join(account.home, '.credentials.json'), 'utf8'));
      const r = await fetch('https://api.anthropic.com/api/oauth/usage', {
        headers: { Authorization: `Bearer ${c.claudeAiOauth?.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return fail;
      const pct = (await r.json()).five_hour?.utilization ?? 100;
      return { account, usable: pct < USABLE_THRESHOLD, usedPercent: pct };
    }
    return fail;
  } catch {
    return fail; // 查询失败视为不可用，降级到下家
  }
}

// ---------- CLI ----------
export function parseArgs(argv) {
  const get = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  let brief = get('--brief');
  const dir = get('--dir');
  if (!brief) throw new Error('缺少 --brief <任务书文件或字符串>');
  if (!dir || !existsSync(dir)) throw new Error('缺少 --dir 或目录不存在（--dir <workdir>）');
  if (existsSync(brief)) brief = readFileSync(brief, 'utf8');
  return { brief, dir, vendor: get('--vendor') ?? 'auto', maxRetries: Number(get('--max-retries') ?? 2) };
}

function makeRealRunWorker(logFile) {
  return (account, brief, dir) => new Promise((resolve) => {
    const { cmd, args, env, cwd } = buildCommand(account.vendor, account, brief, dir);
    const ws = createWriteStream(logFile, { flags: 'a' });
    ws.write(`\n===== worker ${account.vendor}:${account.name} @ ${new Date().toISOString()} =====\n`);
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env } });
    let output = '';
    for (const s of [child.stdout, child.stderr]) s.on('data', (c) => { output += c; ws.write(c); });
    child.on('close', (code) => { ws.end(); resolve({ output, exitCode: code ?? 1 }); });
    child.on('error', (err) => { ws.end(); resolve({ output: output + String(err), exitCode: 127 }); });
  });
}

async function main() {
  let parsed;
  try { parsed = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error(String(e.message)); process.exit(2); }
  const { brief, dir, vendor, maxRetries } = parsed;
  const usages = await Promise.all(ACCOUNT_POOL.map(queryUsage));
  const candidates = pickAccounts(usages, { vendor });
  if (candidates.length === 0) { console.log(JSON.stringify({ ok: false, reason: 'no_usable_account', attempts: [] })); process.exit(1); }
  const logFile = join(dir, `.dispatch-worker-${Date.now()}.log`);
  const result = await dispatchWithRotation({ candidates, brief, dir, maxRetries, runWorker: makeRealRunWorker(logFile) });
  console.log(JSON.stringify({ ...result, output_file: logFile }));
  process.exit(result.ok ? 0 : (result.exit_code || 1));
}

// 仅直接执行时进 main（被 import 测试时不跑）
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
```

- [ ] **Step 5: 跑测试确认全绿**

Run: `node --test scripts/dispatch-worker.test.mjs`
Expected: 全部 PASS（19 tests）

- [ ] **Step 6: commit-2**

```bash
git add scripts/dispatch-worker.mjs
git commit -m "feat: dispatch-worker 余量查询+CLI 入口——auto 选账号+日志落盘+JSON 输出 (TDD commit-2)"
```

---

### Task 3: CI 接线（防假绿，必做）

**Files:**
- Modify: `.github/workflows/ci.yml`（在现有 jobs 末尾追加一个 job；先读文件确认缩进与现有 job 风格，仿 test-pyramid-guard job 的结构）

**Interfaces:**
- Consumes: Task 1/2 的 `scripts/dispatch-worker.test.mjs`
- Produces: CI job `dispatch-worker-test`，PR 必跑

- [ ] **Step 1: 读 ci.yml 现有 job 结构，追加 job**

```yaml
  dispatch-worker-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: dispatch-worker 单测
        run: node --test scripts/dispatch-worker.test.mjs
```

（如 ci.yml 现有 job 用不同 checkout/setup-node 版本，跟现有版本保持一致。）

- [ ] **Step 2: 本地验证 yaml 语法 + 测试命令**

Run: `node --test scripts/dispatch-worker.test.mjs && node -e "require('js-yaml') " 2>/dev/null || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo YAML_OK`
Expected: 测试全绿 + YAML_OK

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: dispatch-worker 单测接线进 ci.yml（scripts 测试无 glob 收集，不接=假绿）"
```

---

### Task 4: 真实派工冒烟（手动，merge 前跑一次）

**Files:** 无新文件（验证动作）

- [ ] **Step 1: 冒烟——派一个 trivial 任务书到 auto 池**

```bash
SMOKE_DIR=$(mktemp -d)
node scripts/dispatch-worker.mjs --brief '在当前目录创建 hello.txt，内容为一行 ok。除此之外不做任何事。' --dir "$SMOKE_DIR"
cat "$SMOKE_DIR/hello.txt"
```

Expected: stdout 最后一行 JSON `ok:true` 且含 vendor/account/output_file；`hello.txt` 内容为 `ok`。

- [ ] **Step 2: 把冒烟结果（JSON 原文）贴进 PR 描述**

---

## Self-Review 结论

- Spec 覆盖：纯函数 5 件套 ✅（Task 1）、queryUsage/CLI/输出契约/错误路径 ✅（Task 2，parseArgs throw=退出码 2、no_usable_account、pool_exhausted 全在）、CI 接线 ✅（Task 3）、真实冒烟 ✅（Task 4）。
- 占位符扫描：无 TBD/TODO，所有代码步骤含完整代码。
- 类型一致性：pickAccounts 返回 usage 数组（candidates 元素含 .account），dispatchWithRotation 内 `cand.account` 取用 ✅；测试 helper `U()` 结构与之一致 ✅。
