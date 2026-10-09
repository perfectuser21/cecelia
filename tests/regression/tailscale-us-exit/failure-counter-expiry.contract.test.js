// 回归：2026-09-07 xian-m4 断网事故。故障刚发生时 enforcer 打出的第一条错误日志
// 就是 consecutive_failures=51 —— 计数来自更早的一次事故，从未被清掉，
// 于是"容错 10 次再拉闸"的保护在新事故里等于不存在，第一秒就 fail-closed。
// 计数器必须带时间戳：超过 COUNTER_EXPIRY（默认 300s = 5 倍 StartInterval）
// 即视为上一次事故的残留，从 0 重计。
import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const ENFORCER = join(REPO_ROOT, 'scripts/ops/tailscale-us-exit-enforcer.py');
const tempDirs = [];

const PRIMARY = {
  ID: 'node-primary-us',
  HostName: 'perfect21',
  DNSName: 'mac-mini-m4-us.tailce7a8b.ts.net.',
  TailscaleIPs: ['100.71.151.105'],
  ExitNodeOption: true,
  Online: true,
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// mode='daemon_absent'：CLI 一律报 socket 连不上（错误串命中 daemon_absent 分类）。
// mode='healthy'：正常应答，走到 healthy 分支（成功 tick 必须双清零）。
function makeFixture({ mode = 'daemon_absent', failureCount = null, daemonAbsentCount = null }) {
  const dir = mkdtempSync(join(tmpdir(), 'ts-us-exit-counter-'));
  tempDirs.push(dir);
  const statusFile = join(dir, 'status.json');
  const runtimeFile = join(dir, 'runtime.json');
  const pfRulesFile = join(dir, 'pf-rules.txt');
  const failureCountFile = join(dir, 'failure-count.json');
  const daemonAbsentCountFile = join(dir, 'daemon-absent-count.json');
  const fakeTailscale = join(dir, 'tailscale');
  const fakePfctl = join(dir, 'pfctl');

  writeFileSync(statusFile, JSON.stringify({
    Self: { ID: 'xian-m4', HostName: 'mac-mini-m4', TailscaleIPs: ['100.86.57.69'], Online: true },
    Peer: { [PRIMARY.ID]: PRIMARY },
  }));
  writeFileSync(runtimeFile, JSON.stringify({ selected: PRIMARY.ID, allowLan: true, acceptDns: true }));
  if (failureCount !== null) writeFileSync(failureCountFile, failureCount);
  if (daemonAbsentCount !== null) writeFileSync(daemonAbsentCountFile, daemonAbsentCount);

  writeFileSync(fakeTailscale, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (process.env.FAKE_MODE === 'daemon_absent') {
  process.stderr.write('dial unix /var/run/tailscaled.socket: connect: connection refused');
  process.exit(1);
}
const runtime = JSON.parse(fs.readFileSync(process.env.FAKE_RUNTIME_FILE, 'utf8'));
if (args[0] === 'status' && args[1] === '--json') {
  process.stdout.write(fs.readFileSync(process.env.FAKE_STATUS_FILE, 'utf8'));
  process.exit(0);
}
if (args[0] === 'debug' && args[1] === 'prefs') {
  process.stdout.write(JSON.stringify({
    ExitNodeID: runtime.selected,
    ExitNodeIP: '',
    ExitNodeAllowLANAccess: runtime.allowLan,
    CorpDNS: runtime.acceptDns,
    WantRunning: true,
  }));
  process.exit(0);
}
process.stderr.write('unexpected fake tailscale args: ' + args.join(' '));
process.exit(9);
`);
  chmodSync(fakeTailscale, 0o755);

  writeFileSync(fakePfctl, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '-s' && args[1] === 'info') {
  process.stdout.write('Status: Enabled for 1 days\\n');
  process.exit(0);
}
if (args[0] === '-F' && args[1] === 'states') process.exit(0);
if (args.includes('-f') && args.at(-1) === '-') {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    fs.writeFileSync(process.env.FAKE_PF_RULES_FILE, input);
    process.exit(0);
  });
  return;
}
if (args.at(-1) === '-sr') {
  try { process.stdout.write(fs.readFileSync(process.env.FAKE_PF_RULES_FILE, 'utf8')); }
  catch { process.stdout.write(''); }
  process.exit(0);
}
process.stderr.write('unexpected fake pfctl args: ' + args.join(' '));
process.exit(9);
`);
  chmodSync(fakePfctl, 0o755);

  const env = {
    ...process.env,
    TAILSCALE_BIN: fakeTailscale,
    CECELIA_US_EXIT_PFCTL_BIN: fakePfctl,
    CECELIA_US_EXIT_TUN_INTERFACE: 'utun99',
    CECELIA_US_EXIT_TARGET_UID: '501',
    CECELIA_US_EXIT_ALLOW_UNPRIVILEGED_FIREWALL: 'true',
    CECELIA_US_EXIT_ALLOWED_SELF_IPS: '100.86.57.69',
    CECELIA_US_EXIT_PRIMARY_DNS: 'mac-mini-m4-us.tailce7a8b.ts.net',
    CECELIA_US_EXIT_SECONDARY_DNS: 'vps-us.tailce7a8b.ts.net',
    CECELIA_US_EXIT_PRIMARY_ID: 'node-primary-us',
    CECELIA_US_EXIT_SECONDARY_ID: 'node-secondary-us',
    CECELIA_US_EXIT_STATE_FILE: join(dir, 'state.json'),
    CECELIA_US_EXIT_LOCK_FILE: join(dir, 'lock'),
    CECELIA_US_EXIT_FAILURE_COUNT_FILE: failureCountFile,
    CECELIA_US_EXIT_DAEMON_ABSENT_COUNT_FILE: daemonAbsentCountFile,
    FAKE_MODE: mode,
    FAKE_STATUS_FILE: statusFile,
    FAKE_RUNTIME_FILE: runtimeFile,
    FAKE_PF_RULES_FILE: pfRulesFile,
  };

  return {
    run: (extraEnv = {}) => {
      const result = spawnSync('python3', [ENFORCER, '--once'], {
        env: { ...env, ...extraEnv },
        encoding: 'utf8',
      });
      return {
        ...result,
        emitted: (result.stdout || '').trim().split('\n').filter(Boolean).map((line) => {
          try { return JSON.parse(line); } catch { return { raw: line }; }
        }),
      };
    },
    failureCountFile,
    daemonAbsentCountFile,
    readCount: (file) => JSON.parse(readFileSync(file, 'utf8')),
    dir,
  };
}

const now = () => Math.floor(Date.now() / 1000);

describe('enforcer 失败计数器过期语义', () => {
  it('上一次事故残留的计数超过过期窗口时归零重计（回归：9-07 首条日志 consecutive_failures=51）', () => {
    const fixture = makeFixture({
      daemonAbsentCount: JSON.stringify({ count: 50, last_failure_ts: now() - 3600 }),
    });

    const result = fixture.run();

    const error = result.emitted.find((e) => e.status === 'error');
    expect(error, result.stderr).toBeDefined();
    expect(error.error_class).toBe('daemon_absent');
    expect(error.consecutive_failures).toBe(1);
    expect(error.fail_closed_applied).toBe(false);
  });

  it('过期窗口内的计数正常递增（容错阈值仍然生效）', () => {
    const fixture = makeFixture({
      daemonAbsentCount: JSON.stringify({ count: 2, last_failure_ts: now() - 60 }),
    });

    const result = fixture.run();

    const error = result.emitted.find((e) => e.status === 'error');
    expect(error, result.stderr).toBeDefined();
    expect(error.consecutive_failures).toBe(3);
  });

  it('旧的裸整数计数文件按过期处理，不把历史计数带进新事故', () => {
    const fixture = makeFixture({ daemonAbsentCount: '50\n' });

    const result = fixture.run();

    const error = result.emitted.find((e) => e.status === 'error');
    expect(error, result.stderr).toBeDefined();
    expect(error.consecutive_failures).toBe(1);
  });

  it('写回的计数文件是带时间戳的 JSON，供下一轮判定过期', () => {
    const fixture = makeFixture({ daemonAbsentCount: '50\n' });

    fixture.run();

    const payload = fixture.readCount(fixture.daemonAbsentCountFile);
    expect(payload.count).toBe(1);
    expect(payload.last_failure_ts).toBeGreaterThan(now() - 120);
  });

  it('普通违规计数同样带过期语义（daemon 有响应但配置违规那一类）', () => {
    const fixture = makeFixture({
      mode: 'healthy',
      failureCount: JSON.stringify({ count: 40, last_failure_ts: now() - 3600 }),
    });

    // 自身 IP 不在白名单 → unapproved_client，不属于 daemon_absent 分类。
    const result = fixture.run({ CECELIA_US_EXIT_ALLOWED_SELF_IPS: '100.88.166.55' });

    const error = result.emitted.find((e) => e.status === 'error');
    expect(error, result.stderr).toBeDefined();
    expect(error.error_class).toBeUndefined();
    expect(error.consecutive_failures).toBe(1);
  });

  it('成功一次 tick 后两个计数文件都归零，且仍是 JSON 格式', () => {
    const fixture = makeFixture({
      mode: 'healthy',
      failureCount: JSON.stringify({ count: 7, last_failure_ts: now() - 30 }),
      daemonAbsentCount: JSON.stringify({ count: 9, last_failure_ts: now() - 30 }),
    });

    const result = fixture.run();

    expect(result.status, result.stderr).toBe(0);
    expect(result.emitted.some((e) => e.status === 'healthy')).toBe(true);
    expect(existsSync(fixture.failureCountFile)).toBe(true);
    expect(fixture.readCount(fixture.failureCountFile).count).toBe(0);
    expect(fixture.readCount(fixture.daemonAbsentCountFile).count).toBe(0);
  });

  it('过期窗口可经环境变量覆盖，便于按 StartInterval 调参', () => {
    const fixture = makeFixture({
      daemonAbsentCount: JSON.stringify({ count: 4, last_failure_ts: now() - 30 }),
    });

    const result = fixture.run({ CECELIA_US_EXIT_COUNTER_EXPIRY: '10' });

    const error = result.emitted.find((e) => e.status === 'error');
    expect(error, result.stderr).toBeDefined();
    expect(error.consecutive_failures).toBe(1);
  });
});
