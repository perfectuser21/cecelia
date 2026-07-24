# Codex Slot MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现可从 Mac 客户端调用的 `codex-slot start/list/resume/attach/stop`，由美国 M4 集中租用公司 Codex 账号，并在西安执行节点创建隔离、可恢复的 session。

**Architecture:** 使用 Node.js ESM 将 registry/lease 作为纯文件存储模块，将 broker、agent 和 client 分成三个独立 CLI。Broker 在美国 M4 单写 JSON registry 和 token 源；agent 在西安节点管理 worktree/tmux/CODEX_HOME；client 只通过 SSH 编排，不接触 token 内容。所有并发锁使用原子 `mkdir`，所有 JSON 更新使用临时文件后 `rename`。

**Tech Stack:** Node.js 20+ ESM、`node:test`、SSH/SCP、tmux、Git worktree、macOS `df`/APFS、Bash 安装脚本

---

## 文件边界

- `scripts/codex-slot-store.mjs`：路径校验、原子 JSON、目录锁、lease 和 session registry。
- `scripts/codex-slot-store.test.mjs`：并发租约、释放、quarantine、actor 可见性测试。
- `scripts/codex-slot-broker.mjs`：美国 M4 CLI；身份映射、acquire/release/heartbeat、token deliver、session CRUD。
- `scripts/codex-slot-broker.test.mjs`：broker 参数、身份和 token 安全测试。
- `scripts/codex-slot-agent.mjs`：西安节点 CLI；host health、prepare/launch/status/stop、legacy 扫描。
- `scripts/codex-slot-agent.test.mjs`：临时仓库、mock tmux/codex、磁盘门禁和幂等停止测试。
- `scripts/codex-slot-client.mjs`：客户端 CLI；跨 SSH 编排 `start/list/resume/attach/stop`。
- `scripts/codex-slot-client.test.mjs`：fake transport 下的跨主机流程与回滚测试。
- `scripts/codex-slot`：稳定 Bash 入口，执行相邻的 client ESM。
- `scripts/install-codex-slot.sh`：幂等安装 client/broker/agent 和配置模板。
- `scripts/__tests__/codex-slot-install.test.sh`：安装布局、权限和重复安装测试。

### Task 1: 原子 store 与唯一账号租约

**Files:**
- Create: `scripts/codex-slot-store.mjs`
- Create: `scripts/codex-slot-store.test.mjs`

- [ ] **Step 1: 写 store 红灯测试**

测试固定 API：

```js
import {
  validateSegment, acquireLease, releaseLease, heartbeatLease,
  putSession, getSession, listSessions
} from './codex-slot-store.mjs';

test('同一 team 的并发 acquire 只有一个成功', async () => {
  const req = { root, actor: 'alex', sessionId: 'alex-infra-main',
    host: 'xian-m4', accounts: ['team1'], now: '2026-07-23T00:00:00Z' };
  const [a, b] = await Promise.allSettled([
    acquireLease(req), acquireLease({ ...req, sessionId: 'alex-infra-two' })
  ]);
  assert.equal([a, b].filter(x => x.status === 'fulfilled').length, 1);
});

test('普通 actor 只看到自己的 session', async () => {
  await putSession({ root, session: alexSession });
  await putSession({ root, session: coworkerSession });
  assert.deepEqual((await listSessions({ root, actor: 'alex' })).map(x => x.actor), ['alex']);
});
```

同时覆盖非法 `../`、空 segment、release lease ID 不匹配、heartbeat 更新时间和 quarantined lease 不可再次 acquire。

- [ ] **Step 2: 运行测试确认模块缺失红灯**

Run:

```bash
node --test scripts/codex-slot-store.test.mjs
```

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现最小 store**

导出固定签名：

```js
export function validateSegment(value, label) {}
export async function withDirLock(lockPath, fn) {}
export async function atomicWriteJson(path, value) {}
export async function acquireLease({ root, actor, sessionId, host, accounts, now }) {}
export async function releaseLease({ root, team, leaseId, state = 'released', now }) {}
export async function heartbeatLease({ root, team, leaseId, now }) {}
export async function putSession({ root, session }) {}
export async function getSession({ root, sessionId }) {}
export async function listSessions({ root, actor, admin = false }) {}
```

`acquireLease` 按传入 accounts 顺序尝试 `${root}/locks/lease-${team}.lock`；持锁读取 `${root}/registry/leases/${team}.json`，只在无 active/quarantined lease 时写入新 UUID lease 并返回。锁目录必须在 `finally` 中删除。

- [ ] **Step 4: 运行 store 测试转绿**

```bash
node --test scripts/codex-slot-store.test.mjs
```

Expected: 所有 store 测试通过，0 fail。

- [ ] **Step 5: 提交 store**

```bash
git add scripts/codex-slot-store.mjs scripts/codex-slot-store.test.mjs
git commit -m "feat(codex-slot): 添加原子账号租约存储"
```

### Task 2: 美国 M4 broker

**Files:**
- Create: `scripts/codex-slot-broker.mjs`
- Create: `scripts/codex-slot-broker.test.mjs`

- [ ] **Step 1: 写 broker 红灯测试**

通过导出的 `runBroker(argv, deps)` 注入 `user`、`root`、usage 查询和 token deliver：

```js
test('actor 来自服务端 USER 映射而不是客户端参数', async () => {
  const out = await runBroker(['identity', '--actor', 'coworker'], {
    user: 'administrator', actorMap: { administrator: 'alex' }, root, write: collect
  });
  assert.equal(out.actor, 'alex');
});

test('acquire 自动选账号且不接受 --team', async () => {
  await assert.rejects(
    runBroker(['acquire', '--session', 'alex-infra-main', '--host', 'xian-m4', '--team', 'team1'], deps),
    /不允许手工选择 team/
  );
});

test('deliver 只返回元数据且目标 auth mode 为 600', async () => {
  const result = await runBroker(['deliver', '--lease', leaseId,
    '--target', 'xian-m4', '--path', '/safe/session/auth.json'], deps);
  assert.deepEqual(result, { ok: true, team: 'team1', target: 'xian-m4' });
  assert.equal(deliveredMode, 0o600);
  assert.doesNotMatch(JSON.stringify(result), /access_token|refresh_token/);
});
```

覆盖 token 源不存在、mode 不是 `600`、JWT 剩余不足 48 小时、lease actor/session 不匹配时拒绝 deliver。

- [ ] **Step 2: 运行 broker 测试确认红灯**

```bash
node --test scripts/codex-slot-broker.test.mjs
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 broker 命令**

固定命令：

```text
identity
acquire --session ID --host HOST
deliver --lease ID --target HOST --path ABSOLUTE_PATH
heartbeat --team TEAM --lease ID
release --team TEAM --lease ID [--state released|quarantined]
session-put --json BASE64URL_JSON
session-get --session ID
session-list [--admin]
```

`identity` 使用 `CODEX_SLOT_ACTOR_MAP_JSON`，默认映射 `administrator -> alex`。`acquire` 从 team1–5 中筛选 auth 存在、mode `600`、JWT 剩余至少 `CODEX_MIN_REMAINING_SECONDS` 且 usage `<90%` 的账号，再调用 store。`deliver` 只允许 host registry 中的目标和 agent slot 根目录下的绝对路径，并调用 `scp` 后远端 `chmod 600`。

- [ ] **Step 4: broker 测试转绿**

```bash
node --test scripts/codex-slot-broker.test.mjs
```

Expected: 所有 broker 测试通过。

- [ ] **Step 5: 提交 broker**

```bash
git add scripts/codex-slot-broker.mjs scripts/codex-slot-broker.test.mjs
git commit -m "feat(codex-slot): 添加公司账号租约 broker"
```

### Task 3: 西安执行 agent

**Files:**
- Create: `scripts/codex-slot-agent.mjs`
- Create: `scripts/codex-slot-agent.test.mjs`

- [ ] **Step 1: 写 agent 红灯测试**

导出 `runAgent(argv, deps)`，deps 注入 `home`、命令执行器、磁盘采样和时钟：

```js
test('磁盘低于门槛时 prepare fail closed', async () => {
  await assert.rejects(
    runAgent(['prepare', '--session', 'alex-infra-main',
      '--actor', 'alex', '--project', 'infrastructure', '--name', 'main'], {
      ...deps, sampleDisk: async () => ({ freeGiB: 13, usedPercent: 94 })
    }),
    /磁盘容量不足/
  );
  assert.equal(execCalls.length, 0);
});

test('stop 删除 auth 但保留 worktree 和 history', async () => {
  await runAgent(['stop', '--session', 'alex-infra-main'], deps);
  assert.equal(await exists(authPath), false);
  assert.equal(await exists(worktreePath), true);
  assert.equal(await exists(historyPath), true);
});

test('legacy 扫描只读', async () => {
  const result = await runAgent(['legacy-list'], depsWithSlot1To10);
  assert.equal(result.length, 10);
  assert.equal(execCalls.some(c => /kill|remove|rename/.test(c)), false);
});
```

覆盖路径格式、project allowlist、重复 prepare 幂等、launch 生成 tmux、status PID/tmux、stop 重复执行和 launcher 不含 token。

- [ ] **Step 2: 运行 agent 测试确认红灯**

```bash
node --test scripts/codex-slot-agent.test.mjs
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 agent**

固定目录：

```text
~/.codex-slots/<actor>/<session-id>/
  codex-home/
  launcher.sh
  metadata.json
  logs/
~/worktrees/<project>/<session-id>/
```

固定命令：

```text
health
prepare --session ID --actor ACTOR --project PROJECT --name NAME
launch --session ID
status --session ID
stop --session ID
legacy-list
```

`health` 输出 JSON，包括 hostname、freeGiB、usedPercent、capacity、enabled。`prepare` 要求空闲至少 `CODEX_SLOT_MIN_FREE_GIB`（默认 45）且使用率低于 `CODEX_SLOT_MAX_USED_PERCENT`（默认 80），从 `~/repos/<project>` 创建 `slot/<actor>/<session-id>` 分支 worktree。`launch` 写 mode `700` launcher，并使用 `tmux new-session -d -s codex-slot-<session-id>` 前台执行 Codex。`stop` 先停止 tmux，再删除 auth 和 lease heartbeat 文件，不删 worktree/history。

- [ ] **Step 4: agent 测试转绿**

```bash
node --test scripts/codex-slot-agent.test.mjs
```

Expected: 所有 agent 测试通过。

- [ ] **Step 5: 提交 agent**

```bash
git add scripts/codex-slot-agent.mjs scripts/codex-slot-agent.test.mjs
git commit -m "feat(codex-slot): 添加西安 session agent"
```

### Task 4: 客户端编排 CLI

**Files:**
- Create: `scripts/codex-slot-client.mjs`
- Create: `scripts/codex-slot-client.test.mjs`
- Create: `scripts/codex-slot`

- [ ] **Step 1: 写 client 红灯测试**

通过 `runClient(argv, transport)` 注入 `broker(args)`、`agent(host,args)`、`attach(host,tmux)`：

```js
test('start 自动选择健康主机和账号并按顺序编排', async () => {
  await runClient(['start', '--project', 'infrastructure', '--name', 'main'], transport);
  assert.deepEqual(calls.map(x => x.op), [
    'identity', 'session-get', 'health:xian-m4', 'health:xian-m1',
    'acquire', 'prepare:xian-m4', 'deliver', 'launch:xian-m4',
    'session-put', 'attach:xian-m4'
  ]);
});

test('start 中途失败按逆序停止并释放 lease', async () => {
  transport.agentLaunch = async () => { throw new Error('tmux failed'); };
  await assert.rejects(runClient(['start', '--project', 'infrastructure'], transport));
  assert.equal(calls.at(-2).op, 'stop:xian-m4');
  assert.equal(calls.at(-1).op, 'release');
});

test('resume 无参数选择当前 project 最近 session', async () => {
  await runClient(['resume'], { ...transport, cwd: '/repo/infrastructure' });
  assert.equal(calls.at(-1).op, 'attach:xian-m4');
});
```

覆盖不接受 `--team`、跨主机 attach、stopped resume 重新 acquire/deliver/launch、list actor 过滤和 stop 幂等。

- [ ] **Step 2: 运行 client 测试确认红灯**

```bash
node --test scripts/codex-slot-client.test.mjs
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 client 与 Bash 入口**

配置读取顺序：

```text
CODEX_SLOT_CONFIG
~/.config/codex-slot/config.json
内置默认：broker=mmv, hosts=[xian-m4,xian-m1]
```

Bash 入口固定为：

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/codex-slot-client.mjs" "$@"
```

client 的真实 transport 使用 `ssh -T broker node <broker-script>`、`ssh host node <agent-script>` 和交互式 `ssh -t host tmux attach -t <name>`。所有非交互调用要求 `BatchMode=yes` 和有限连接超时。

- [ ] **Step 4: client 测试转绿**

```bash
node --test scripts/codex-slot-client.test.mjs
```

Expected: 所有 client 测试通过。

- [ ] **Step 5: 提交 client**

```bash
git add scripts/codex-slot-client.mjs scripts/codex-slot-client.test.mjs scripts/codex-slot
git commit -m "feat(codex-slot): 添加 session 客户端命令"
```

### Task 5: 幂等安装与部署配置

**Files:**
- Create: `scripts/install-codex-slot.sh`
- Create: `scripts/__tests__/codex-slot-install.test.sh`
- Create: `config/codex-slot/hosts.example.json`

- [ ] **Step 1: 写安装红灯测试**

mock `HOME`、`ssh`、`scp` 后验证：

```bash
bash scripts/install-codex-slot.sh --client-only
test -x "$HOME/.local/bin/codex-slot"
test -f "$HOME/.local/lib/codex-slot/codex-slot-client.mjs"
bash scripts/install-codex-slot.sh --client-only
test "$(grep -c 'codex-slot/bin' "$HOME/.zshrc")" -le 1
```

远端模式验证 broker 文件只上传美国 M4、agent 文件上传执行节点，脚本 mode 分别为 `755`，registry/slot 根目录为 `700`。

- [ ] **Step 2: 运行安装测试确认红灯**

```bash
bash scripts/__tests__/codex-slot-install.test.sh
```

Expected: FAIL，安装脚本不存在。

- [ ] **Step 3: 实现安装脚本和 host 示例**

命令：

```text
install-codex-slot.sh --client-only
install-codex-slot.sh --broker-host mmv
install-codex-slot.sh --agent-host xian-m4
install-codex-slot.sh --all
```

客户端安装到 `~/.local/lib/codex-slot`，入口软链到 `~/.local/bin/codex-slot`。只有当 `~/.local/bin` 不在 PATH 时，才向 `~/.zshrc` 追加一次带固定标记的 PATH block。远端先上传 `.new`，校验 SHA256 后原子 `mv`，覆盖前备份到 `~/.codex-script-backups/<timestamp>-codex-slot/`。

- [ ] **Step 4: 安装测试转绿**

```bash
bash scripts/__tests__/codex-slot-install.test.sh
```

Expected: 全部安装测试通过。

- [ ] **Step 5: 提交安装器**

```bash
git add scripts/install-codex-slot.sh scripts/__tests__/codex-slot-install.test.sh config/codex-slot/hosts.example.json
git commit -m "feat(codex-slot): 添加幂等安装器"
```

### Task 6: 全量验证与安全部署

**Files:**
- Verify: `scripts/codex-slot-*.mjs`
- Verify: `scripts/codex-slot`
- Verify: `scripts/install-codex-slot.sh`
- Deploy: 美国 M4 broker、xian-m4 agent、Mac client

- [ ] **Step 1: 运行全部自动化测试**

```bash
node --test scripts/codex-slot-store.test.mjs
node --test scripts/codex-slot-broker.test.mjs
node --test scripts/codex-slot-agent.test.mjs
node --test scripts/codex-slot-client.test.mjs
bash scripts/__tests__/codex-slot-install.test.sh
bash scripts/__tests__/codex-request.test.sh
bash scripts/__tests__/codex-remote-launch.test.sh
node --test scripts/dispatch-worker.test.mjs
bash -n scripts/codex-slot scripts/install-codex-slot.sh
git diff main...HEAD --check
```

Expected: 所有命令 exit 0，0 failed。

- [ ] **Step 2: 修复美国 M4 token 文件权限**

只读取 mode 和 owner 后，将 `~/.codex-team1` 至 `team5` 中存在的 `auth.json` 统一设为 `600`；不打印、不复制内容。再次 `stat` 验证。

- [ ] **Step 3: 部署 broker、agent 和 client**

先备份再原子替换。部署后分别执行：

```bash
codex-slot-broker.mjs identity
codex-slot-agent.mjs health
codex-slot list
codex-slot list --legacy
```

Expected: identity 为 `alex`；xian-m4 health 真实报告磁盘高压；list 返回空或已有 registry；legacy 只读显示现存 slot。

- [ ] **Step 4: 容量门禁验收**

在当前 xian-m4 约 13 GiB、xian-m1 约 2 GiB 的状态下执行 `codex-slot start`，必须在创建 worktree、复制 token 和租用账号前拒绝，并明确报告每台主机的 freeGiB/usedPercent。

- [ ] **Step 5: 容量恢复后完成实机生命周期**

在用户另行确认安全清理目标、xian-m4 空闲恢复到至少 45 GiB 后执行：

```bash
codex-slot start --project infrastructure --name main
codex-slot list
codex-slot resume infrastructure/main
codex-slot stop infrastructure/main
```

验证 start 可交互、断线后 resume 可恢复、stop 后 auth 不存在而 worktree/history 仍存在、broker lease 已释放。

- [ ] **Step 6: 推送分支并创建 Draft PR**

```bash
git push -u origin cp-07231220-codex-slot-mvp
```

创建 Draft PR，正文包含架构边界、token 单写者、测试结果、部署状态，以及“磁盘未达 45 GiB 前 start 会 fail closed”的明确说明。

### Task 7: 西安 SSH 入口兼容

**Files:**
- Modify: `scripts/codex-slot-client.mjs`
- Modify: `scripts/codex-slot-client.test.mjs`
- Modify: `scripts/__tests__/codex-slot-install.test.sh`
- Create: `config/codex-slot/xian-m4.example.json`

- [x] **Step 1: 增加红灯测试**

覆盖 `status` 兼容命令、`localHost` 必须属于 `hosts`、本地 agent/tmux 不经
SSH，以及西安配置固定连接美国 M4 broker。

- [x] **Step 2: 验证红灯**

Run:

```bash
node --test scripts/codex-slot-client.test.mjs
bash scripts/__tests__/codex-slot-install.test.sh
```

Observed: client 3 failed；installer 219 passed, 1 failed。

- [x] **Step 3: 实现本地执行 transport 与 status**

`localHost` 的非交互 agent 使用本地 Node，attach 使用本地 tmux；远程 broker
路径保持 SSH 安全参数和超时。`status` 强制执行带运行时探测的 session list。

- [ ] **Step 4: 全量测试、部署和真实门禁验证**

运行 Task 6 全量测试；部署 broker、xian-m4 agent/client 后，验证 `status`
可运行且 `start` 在 45 GiB 门禁未满足时于租约和 token 复制前拒绝。
