# tailscale-login-watchdog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用一个真正检测 tailscaled **认证状态** 的 watchdog，替换只会 `pgrep` GUI App 的坏 watchdog，使 node key 过期 / 被踢 / 守护进程崩溃后能自动恢复 tailnet 连接。

**Architecture:** 单个 Python 脚本 `scripts/ops/tailscale-login-watchdog.py`，由 launchd 每 60 秒调用一次。核心是纯函数 `decide_action()`——输入 status/prefs/state，输出动作，无副作用，因此可被 CI 完整覆盖。执行层复用 `tailscale-us-exit-enforcer.py` 已验证的模式（二进制多候选探测、fcntl 锁、原子状态写、结构化 JSON 日志）。

**Tech Stack:** Python 3（stdlib only：fcntl / subprocess / json / tempfile）；测试用 vitest + `spawnSync` 跑真实脚本，fake `tailscale` 二进制经 `TAILSCALE_BIN` 注入。

**判定支点：以 `BackendState` 为准，绝不看 IP。** 2026-09-06 故障期间 `utun4` 上的 `100.71.151.105` 始终残留，看 IP 必然误判为健康。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `scripts/ops/tailscale-login-watchdog.py` | 全部逻辑：决策纯函数 + 执行 + 锁/状态 |
| `tests/regression/tailscale-login-watchdog/watchdog.contract.test.js` | 契约测试，跑真实脚本 |
| `scripts/ops/install-tailscale-login-watchdog.sh` | 安装 plist、卸载旧 watchdog |
| `.github/workflows/ci.yml`（修改） | 新增轻量 job，**确保测试真在 CI 跑** |

> ⚠️ CI 现状（本次调研发现）：根 `vitest.config.js` 虽 include `tests/regression/**`，但 CI 中所有 `npx vitest run` 都带 `cd packages/xxx` 用各自 config，根 config 从未整目录执行。**现有 `tests/regression/tailscale-us-exit/` 的测试因此是假绿。** 本计划新增独立 job 显式跑新测试，避免重蹈覆辙。enforcer 假绿另立，不在本次范围。

## 约定：环境变量（测试注入用）

| 变量 | 用途 | 默认 |
|---|---|---|
| `TAILSCALE_BIN` | tailscale 二进制路径 | 多候选探测 |
| `CECELIA_TS_WATCHDOG_STATE_FILE` | 状态文件 | `/var/db/cecelia/tailscale-login-watchdog/state.json` |
| `CECELIA_TS_WATCHDOG_LOCK_FILE` | 锁文件 | 同目录 `watchdog.lock` |
| `CECELIA_TS_WATCHDOG_DISABLED_FILE` | 安全闸 | 同目录 `DISABLED` |
| `TAILSCALE_AUTHKEY` | authkey 直接注入（最高优先级） | 无 |
| `TAILSCALE_AUTHKEY_EXPIRES` | authkey 到期日 `YYYY-MM-DD`（可选） | 无 → 跳过临期检查 |
| `CECELIA_TS_WATCHDOG_HOSTNAME` | 传给 `tailscale up --hostname` | `perfect21` |

退避表：`[60, 300, 900, 1800]` 秒，按 `consecutive_failures` 索引，超出取末位。

---

### Task 1: 决策纯函数——复现本次 bug 的红测试

**Files:**
- Create: `tests/regression/tailscale-login-watchdog/watchdog.contract.test.js`
- Create: `scripts/ops/tailscale-login-watchdog.py`

- [ ] **Step 1: 写失败测试**

创建 `tests/regression/tailscale-login-watchdog/watchdog.contract.test.js`：

```javascript
import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const WATCHDOG = join(REPO_ROOT, 'scripts/ops/tailscale-login-watchdog.py');
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// 造一个 fake tailscale 二进制：按 fixture 返回 status/prefs，并把每次调用追加进 calls.log
function makeFixture({ backendState, wantRunning = true, selfIps = ['100.71.151.105'], upFails = false, state = null }) {
  const dir = mkdtempSync(join(tmpdir(), 'ts-login-watchdog-'));
  tempDirs.push(dir);
  const statusFile = join(dir, 'status.json');
  const prefsFile = join(dir, 'prefs.json');
  const callsFile = join(dir, 'calls.log');
  const stateFile = join(dir, 'state.json');
  const fakeTailscale = join(dir, 'tailscale');

  writeFileSync(statusFile, JSON.stringify({
    BackendState: backendState,
    Self: { HostName: 'perfect21', TailscaleIPs: selfIps, Online: backendState === 'Running' },
    Peer: {},
  }));
  writeFileSync(prefsFile, JSON.stringify({ WantRunning: wantRunning, ExitNodeID: '', CorpDNS: true }));
  writeFileSync(callsFile, '');
  if (state) writeFileSync(stateFile, JSON.stringify(state));

  writeFileSync(fakeTailscale, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_CALLS_FILE, args.join(' ') + '\\n');
if (process.env.FAKE_STATUS_FAILS === 'true' && args[0] === 'status') {
  process.stderr.write('failed to connect to local tailscaled');
  process.exit(1);
}
if (args[0] === 'status' && args[1] === '--json') {
  process.stdout.write(fs.readFileSync(process.env.FAKE_STATUS_FILE, 'utf8'));
  process.exit(0);
}
if (args[0] === 'debug' && args[1] === 'prefs') {
  process.stdout.write(fs.readFileSync(process.env.FAKE_PREFS_FILE, 'utf8'));
  process.exit(0);
}
if (args[0] === 'up') {
  if (process.env.FAKE_UP_FAILS === 'true') {
    process.stderr.write('authkey expired');
    process.exit(1);
  }
  const s = JSON.parse(fs.readFileSync(process.env.FAKE_STATUS_FILE, 'utf8'));
  s.BackendState = 'Running';
  s.Self.Online = true;
  fs.writeFileSync(process.env.FAKE_STATUS_FILE, JSON.stringify(s));
  process.exit(0);
}
process.stderr.write('unexpected fake tailscale args: ' + args.join(' '));
process.exit(9);
`);
  chmodSync(fakeTailscale, 0o755);

  return { dir, statusFile, prefsFile, callsFile, stateFile, fakeTailscale };
}

function runWatchdog(fixture, env = {}) {
  const result = spawnSync('python3', [WATCHDOG, '--once'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TAILSCALE_BIN: fixture.fakeTailscale,
      FAKE_STATUS_FILE: fixture.statusFile,
      FAKE_PREFS_FILE: fixture.prefsFile,
      FAKE_CALLS_FILE: fixture.callsFile,
      CECELIA_TS_WATCHDOG_STATE_FILE: fixture.stateFile,
      CECELIA_TS_WATCHDOG_LOCK_FILE: join(fixture.dir, 'watchdog.lock'),
      CECELIA_TS_WATCHDOG_DISABLED_FILE: join(fixture.dir, 'DISABLED'),
      TAILSCALE_AUTHKEY: 'tskey-auth-FAKEKEYFORTESTS',
      ...env,
    },
  });
  return {
    ...result,
    calls: readFileSync(fixture.callsFile, 'utf8').trim().split('\n').filter(Boolean),
    emitted: result.stdout.trim().split('\n').filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return { raw: line }; }
    }),
  };
}

describe('tailscale-login-watchdog', () => {
  // 这条复现 2026-09-06 真实故障：node key 过期，BackendState=NeedsLogin，
  // 但 utun4 上的 100.71.151.105 仍然残留。旧 watchdog（pgrep GUI App）在此完全无反应。
  it('NeedsLogin 且 IP 仍残留时必须重认证（回归：2026-09-06 slot1-10 全断）', () => {
    const fixture = makeFixture({ backendState: 'NeedsLogin', selfIps: ['100.71.151.105'] });
    const result = runWatchdog(fixture);

    expect(result.calls.some((c) => c.startsWith('up '))).toBe(true);
    expect(result.emitted.some((e) => e.action === 'reauth')).toBe(true);
    expect(result.status).toBe(0);
  });

  it('Running 时不得调用 up', () => {
    const fixture = makeFixture({ backendState: 'Running' });
    const result = runWatchdog(fixture);

    expect(result.calls.some((c) => c.startsWith('up'))).toBe(false);
    expect(result.emitted.some((e) => e.action === 'ok')).toBe(true);
    expect(result.status).toBe(0);
  });

  it('重认证时不得带会重置 exit-node/routes 的 flag', () => {
    const fixture = makeFixture({ backendState: 'NeedsLogin' });
    const result = runWatchdog(fixture);

    const upCall = result.calls.find((c) => c.startsWith('up '));
    expect(upCall).toBeDefined();
    expect(upCall).not.toContain('--reset');
    expect(upCall).not.toContain('--exit-node');
    expect(upCall).not.toContain('--advertise-routes');
    expect(upCall).toContain('--hostname=');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/regression/tailscale-login-watchdog/ --reporter=verbose`
Expected: FAIL —— `scripts/ops/tailscale-login-watchdog.py` 不存在，python3 报 `can't open file`。

- [ ] **Step 3: 提交红测试（commit-1，TDD 铁律）**

```bash
git add tests/regression/tailscale-login-watchdog/watchdog.contract.test.js
git commit -m "test(ops): tailscale-login-watchdog 回归测试（红）"
```

---

### Task 2: 补齐三条错误路径的红测试

**Files:**
- Modify: `tests/regression/tailscale-login-watchdog/watchdog.contract.test.js`

- [ ] **Step 1: 追加三个用例到同一个 describe 块内**

```javascript
  it('status 命令失败时判为守护进程故障，不得当成重认证', () => {
    const fixture = makeFixture({ backendState: 'Running' });
    const result = runWatchdog(fixture, { FAKE_STATUS_FAILS: 'true' });

    expect(result.calls.some((c) => c.startsWith('up'))).toBe(false);
    expect(result.emitted.some((e) => e.action === 'restart_daemon')).toBe(true);
  });

  it('冷却期内不得重试（防重认证风暴）', () => {
    const now = Math.floor(Date.now() / 1000);
    const fixture = makeFixture({
      backendState: 'NeedsLogin',
      state: { consecutive_failures: 2, last_attempt_ts: now - 10, last_ip: '100.71.151.105' },
    });
    const result = runWatchdog(fixture);

    expect(result.calls.some((c) => c.startsWith('up'))).toBe(false);
    expect(result.emitted.some((e) => e.action === 'backoff')).toBe(true);
  });

  it('安全闸存在时只告警不重认证', () => {
    const fixture = makeFixture({ backendState: 'NeedsLogin' });
    writeFileSync(join(fixture.dir, 'DISABLED'), 'incident-2026-09-06\n');
    const result = runWatchdog(fixture);

    expect(result.calls.some((c) => c.startsWith('up'))).toBe(false);
    expect(result.emitted.some((e) => e.action === 'disabled')).toBe(true);
  });

  it('Stopped 且 WantRunning=false 视为人主动 down，尊重意图不重认证', () => {
    const fixture = makeFixture({ backendState: 'Stopped', wantRunning: false });
    const result = runWatchdog(fixture);

    expect(result.calls.some((c) => c.startsWith('up'))).toBe(false);
    expect(result.emitted.some((e) => e.action === 'ok')).toBe(true);
  });

  it('重认证失败时记录失败次数供退避使用', () => {
    const fixture = makeFixture({ backendState: 'NeedsLogin' });
    const result = runWatchdog(fixture, { FAKE_UP_FAILS: 'true' });

    expect(result.status).not.toBe(0);
    const state = JSON.parse(readFileSync(fixture.stateFile, 'utf8'));
    expect(state.consecutive_failures).toBe(1);
  });
```

- [ ] **Step 2: 运行确认全部失败**

Run: `npx vitest run tests/regression/tailscale-login-watchdog/ --reporter=verbose`
Expected: 全部 FAIL（脚本仍不存在）

- [ ] **Step 3: 提交**

```bash
git add tests/regression/tailscale-login-watchdog/watchdog.contract.test.js
git commit -m "test(ops): 补齐 watchdog 错误路径红测试（守护进程故障/退避/安全闸/主动down）"
```

---

### Task 3: 实现脚本（让测试变绿）

**Files:**
- Create: `scripts/ops/tailscale-login-watchdog.py`

- [ ] **Step 1: 写实现**

完整脚本见下（决策纯函数 + 执行层）。关键点：

1. `tailscale_binary()`：**逐字复用** `scripts/ops/tailscale-us-exit-enforcer.py:114-127` 的多候选探测（`TAILSCALE_BIN` → `shutil.which` → `/opt/homebrew/bin` → `/usr/local/bin` → App）。这正是坏 watchdog 硬编码 GUI App 踩的坑。
2. `decide_action()`：纯函数，签名 `(status, prefs, now, state, disabled) -> {"action", "reason", "warnings"}`。`status=None` 表示 status 命令失败。
3. `reauth()`：`tailscale up --authkey=<key> --hostname=<host> --accept-dns=true`，**不带** `--reset` / `--exit-node` / `--advertise-routes`。
4. 状态原子写：复用 enforcer `persist_state()` 模式（tempfile + fchmod 0600 + fsync + os.replace）。
5. fcntl 锁：复用 enforcer `main()` 模式（`LOCK_EX | LOCK_NB`，占用则 emit `already_running` 退 0）。
6. authkey 解析顺序：`TAILSCALE_AUTHKEY` env → `~/.credentials/tailscale.env` → 1Password（`op item get "Tailscale" --vault CS`，正则提取 `TAILSCALE_ONBOARD_AUTHKEY=(\S+)`），取到后回写 `~/.credentials/tailscale.env`（0600）。
7. 返回码：`0` 健康或已处理 / `2` 降级（安全闸生效、需人工）/ `3` 错误。
8. **绝不把 authkey 打进日志**：`emit()` 前对所有字符串做 `tskey-[a-z]+-\S+` → `tskey-***` 脱敏。

- [ ] **Step 2: 运行测试确认全绿**

Run: `npx vitest run tests/regression/tailscale-login-watchdog/ --reporter=verbose`
Expected: 8 passed

- [ ] **Step 3: 提交（commit-2）**

```bash
git add scripts/ops/tailscale-login-watchdog.py
git commit -m "fix(ops): tailscale-login-watchdog 按认证状态自愈，替代失效的 GUI App 探测"
```

---

### Task 4: 接进 CI（否则守卫是假绿）

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: 在 `registry-lint` job 之后插入新 job**

```yaml
  # ─── Ops: Tailscale Watchdog 回归（始终运行，无外部依赖）──────
  # 根 vitest.config.js 虽 include tests/regression/**，但 CI 里所有 vitest 调用
  # 都 cd 进 packages/* 用各自 config，根 config 从未被整目录执行。
  # 本 job 显式点名跑，确保守卫真在 CI 生效（不是写了没进 CI 的假绿）。
  ops-tailscale-watchdog:
    name: Ops Tailscale Watchdog Regression
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - name: Install vitest
        run: npm ci
      - name: Watchdog 回归测试
        run: npx vitest run tests/regression/tailscale-login-watchdog/ --reporter=verbose
```

- [ ] **Step 2: 本地验证 job 语法**

Run: `python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/ci.yml')); assert 'ops-tailscale-watchdog' in d['jobs']; print('job 已注册:', d['jobs']['ops-tailscale-watchdog']['name'])"`
Expected: `job 已注册: Ops Tailscale Watchdog Regression`

- [ ] **Step 3: 提交**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(ops): 显式跑 tailscale watchdog 回归，避免 tests/regression 假绿"
```

---

### Task 5: 安装脚本 + 卸载坏 watchdog

**Files:**
- Create: `scripts/ops/install-tailscale-login-watchdog.sh`

- [ ] **Step 1: 写安装脚本**

职责（幂等）：
1. `launchctl bootout gui/$(id -u)/com.cecelia.tailscale-watchdog` 卸载旧的（忽略 not found）
2. 备份并删除 `~/Library/LaunchAgents/com.cecelia.tailscale-watchdog.plist`
3. 写 `~/Library/LaunchAgents/com.cecelia.tailscale-login-watchdog.plist`：
   `ProgramArguments = [/usr/bin/python3, <repo>/scripts/ops/tailscale-login-watchdog.py, --once]`，
   `StartInterval = 60`，`RunAtLoad = true`，日志到 `/tmp/tailscale-login-watchdog.log`
4. `mkdir -p /var/db/cecelia/tailscale-login-watchdog`（0700）
5. `launchctl bootstrap gui/$(id -u) <plist>` 并 `launchctl kickstart` 跑一次
6. 打印 `launchctl list | grep tailscale` 供人工确认状态码为 0

- [ ] **Step 2: 本地执行安装**

Run: `bash scripts/ops/install-tailscale-login-watchdog.sh`
Expected: 输出 `com.cecelia.tailscale-login-watchdog` 且状态码 `0`（不是 1）

- [ ] **Step 3: 提交**

```bash
git add scripts/ops/install-tailscale-login-watchdog.sh
git commit -m "feat(ops): tailscale-login-watchdog 安装器，卸载失效的旧 watchdog"
```

---

### Task 6: Proven-to-fire（守卫必须亲眼见其生效）

> CI 跑在干净假环境，测不到真实 tailnet。未亲眼见其救活过一次的守卫不算守卫。

- [ ] **Step 1: 记录当前状态**

Run: `tailscale status --json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['BackendState'], d['Self']['TailscaleIPs'])"`
Expected: `Running ['100.71.151.105', ...]`

- [ ] **Step 2: 故意制造故障**

Run: `sudo tailscale logout`
Expected: 随后 `tailscale status` 显示 `Logged out.` / `NeedsLogin`

- [ ] **Step 3: 等待 watchdog 自动恢复（最多 90 秒）**

Run: `for i in $(seq 1 18); do sleep 5; s=$(tailscale status --json 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin).get('BackendState','?'))" 2>/dev/null || echo down); echo "$i: $s"; [ "$s" = "Running" ] && break; done`
Expected: 90 秒内出现 `Running`

- [ ] **Step 4: 确认 IP 未漂移（漂移会导致 mosh-server 全部失效）**

Run: `tailscale status --json | python3 -c "import sys,json; print(json.load(sys.stdin)['Self']['TailscaleIPs'])"`
Expected: 仍含 `100.71.151.105`

- [ ] **Step 5: 留存日志证据**

Run: `tail -20 /tmp/tailscale-login-watchdog.log`
Expected: 含 `"action": "reauth"` 记录，且 **不含任何 `tskey-` 明文**

- [ ] **Step 6: 把证据写进 sprint 目录并提交**

```bash
cp /tmp/tailscale-login-watchdog.log sprints/09062109-tailscale-login-watchdog/proven-to-fire.log
git add sprints/09062109-tailscale-login-watchdog/proven-to-fire.log
git commit -m "test(ops): proven-to-fire 证据——真实 logout 后 watchdog 自动恢复"
```

---

## Self-Review

**Spec 覆盖检查：**

| Spec 要求 | 对应任务 |
|---|---|
| BackendState 判定（不看 IP） | Task 1 首条测试 |
| Stopped + WantRunning 区分 | Task 2 第 4 条 |
| 守护进程故障 → restart_daemon | Task 2 第 1 条 |
| 退避 | Task 2 第 2 条 |
| 安全闸 | Task 2 第 3 条 |
| up 不带破坏性 flag | Task 1 第 3 条 |
| 凭据三级回退 + 回写 | Task 3 Step 1 第 6 点 |
| authkey 临期告警 | Task 3（`TAILSCALE_AUTHKEY_EXPIRES`），无配置则跳过 |
| IP 漂移告警 | Task 3 decide_action warnings + Task 6 Step 4 |
| fcntl 锁 / 原子状态写 | Task 3 Step 1 第 4-5 点 |
| CI 真跑 | Task 4 |
| proven-to-fire | Task 6 |

**无占位符：** 全部步骤含可执行命令与预期输出；测试代码完整给出；实现层复用点标注了 enforcer 的确切行号。

**类型一致性：** `decide_action` 返回的 `action` 取值在测试断言与实现描述中统一为 `ok` / `reauth` / `restart_daemon` / `backoff` / `disabled`；状态字段统一为 `consecutive_failures` / `last_attempt_ts` / `last_ip`。
