import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../notifier.js', () => ({ sendBark: vi.fn().mockResolvedValue(true) }));
vi.mock('../alerting.js', () => ({ raise: vi.fn().mockResolvedValue(undefined) }));

import {
  runLaunchdPatrol,
  __resetLaunchdPatrolForTest,
} from '../launchd-patrol.js';
import { sendBark } from '../notifier.js';
import { raise } from '../alerting.js';

// 健康宿主的 fake launchctl/nc 输出；overrides 注入各类坏状态
const HEALTHY_DISABLED_OUT = [
  '\tdisabled services = {',
  '\t\t"com.cecelia.frontend" => disabled',
  '\t\t"com.n8n" => disabled',
  '\t\t"com.openssh.sshd" => enabled',
  '\t}',
].join('\n');

function makeExec(overrides = {}) {
  return vi.fn((cmd) => {
    if (cmd.includes('print-disabled')) {
      if (overrides.hostUnreachable) throw new Error('ssh: connect to host timed out');
      return overrides.disabledOut ?? HEALTHY_DISABLED_OUT;
    }
    const m = cmd.match(/launchctl print system\/([\w.-]+)/);
    if (m) {
      const label = m[1];
      if (overrides.notLoaded?.includes(label)) throw new Error('Could not find service');
      if (overrides.notRunning?.includes(label)) return `system/${label} = {\n\tstate = waiting\n}`;
      return `system/${label} = {\n\tstate = running\n}`;
    }
    const p = cmd.match(/nc -z -G 3 localhost (\d+)/);
    if (p) {
      if (overrides.portDown?.includes(Number(p[1]))) throw new Error('connection refused');
      return '';
    }
    throw new Error(`unexpected cmd: ${cmd}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetLaunchdPatrolForTest();
});

describe('launchd-patrol manifest 核对', () => {
  it('全部健康 → anomalies 空且不告警（含废弃名单 frontend/n8n disabled 属预期）', async () => {
    const r = await runLaunchdPatrol({ exec: makeExec(), inContainer: false });
    expect(r.ok).toBe(true);
    expect(r.anomalies).toEqual([]);
    expect(r.checked).toBe(7); // 1 must-run + 3 must-load + 3 端口
    expect(sendBark).not.toHaveBeenCalled();
    expect(raise).not.toHaveBeenCalled();
  });

  it('必跑 daemon 被 disabled → 检出 + Bark(6h dedupe) + raise P1', async () => {
    const disabledOut = HEALTHY_DISABLED_OUT.replace(
      '"com.n8n" => disabled',
      '"com.n8n" => disabled\n\t\t"com.cecelia.bridge" => disabled',
    );
    const r = await runLaunchdPatrol({ exec: makeExec({ disabledOut }), inContainer: false });
    expect(r.anomalies).toContain('disabled:com.cecelia.bridge');
    expect(sendBark).toHaveBeenCalledWith(
      'launchd 巡检异常',
      expect.stringContaining('disabled:com.cecelia.bridge'),
      expect.objectContaining({
        dedupeKey: expect.stringContaining('launchd-patrol:'),
        dedupeTtlSec: 6 * 3600,
      }),
    );
    expect(raise).toHaveBeenCalledWith(
      'P1',
      'launchd_patrol_anomaly',
      expect.stringContaining('disabled:com.cecelia.bridge'),
    );
  });

  it('daemon 未加载（launchctl print 非零退出）→ not_loaded 检出', async () => {
    const r = await runLaunchdPatrol({
      exec: makeExec({ notLoaded: ['com.cecelia.token-refresh'] }),
      inContainer: false,
    });
    expect(r.anomalies).toEqual(['not_loaded:com.cecelia.token-refresh']);
  });

  it('必跑 daemon state 非 running → not_running 检出', async () => {
    const r = await runLaunchdPatrol({
      exec: makeExec({ notRunning: ['com.cecelia.bridge'] }),
      inContainer: false,
    });
    expect(r.anomalies).toEqual(['not_running:com.cecelia.bridge']);
  });

  it('周期型 daemon state 非 running 不算异常（只有必跑名单查 state）', async () => {
    const r = await runLaunchdPatrol({
      exec: makeExec({ notRunning: ['com.cecelia.pf-firewall'] }),
      inContainer: false,
    });
    expect(r.anomalies).toEqual([]);
  });

  it('端口不通 → port_down 检出', async () => {
    const r = await runLaunchdPatrol({
      exec: makeExec({ portDown: [5200] }),
      inContainer: false,
    });
    expect(r.anomalies).toEqual(['port_down:5200(zenithjoy-api)']);
  });

  it('staging 端口(5201)不通 → port_down 检出', async () => {
    const r = await runLaunchdPatrol({
      exec: makeExec({ portDown: [5201] }),
      inContainer: false,
    });
    expect(r.anomalies).toEqual(['port_down:5201(zenithjoy-api-staging)']);
  });

  it('宿主不可达（连通性探针失败）→ fail-open，不产生服务异常不告警', async () => {
    const r = await runLaunchdPatrol({
      exec: makeExec({ hostUnreachable: true }),
      inContainer: false,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('host_unreachable');
    expect(sendBark).not.toHaveBeenCalled();
    expect(raise).not.toHaveBeenCalled();
  });
});

describe('launchd-patrol gate 与 ssh 逃逸', () => {
  it('15min gate：间隔内二次调用 skipped', async () => {
    const exec = makeExec();
    const t0 = 1_800_000_000_000;
    const r1 = await runLaunchdPatrol({ exec, inContainer: false, now: t0 });
    expect(r1.skipped).toBeUndefined();
    const r2 = await runLaunchdPatrol({ exec, inContainer: false, now: t0 + 60_000 });
    expect(r2.skipped).toBe(true);
    const r3 = await runLaunchdPatrol({ exec, inContainer: false, now: t0 + 16 * 60_000 });
    expect(r3.skipped).toBeUndefined();
  });

  it('容器内（inContainer:true）所有命令包 ssh BatchMode 三件套', async () => {
    const exec = makeExec();
    await runLaunchdPatrol({ exec, inContainer: true, keyExistsFn: (p) => p.endsWith('id_ed25519') });
    for (const [cmd] of exec.mock.calls) {
      expect(cmd).toMatch(/^ssh -i .*id_ed25519 -o StrictHostKeyChecking=no -o UserKnownHostsFile=\/dev\/null -o BatchMode=yes -o ConnectTimeout=10 administrator@host\.docker\.internal '/);
    }
  });

  it('ssh 密钥发现式回退：无 id_ed25519 时用 id_rsa（生产实证：宿主只有 id_rsa，2026-07-12 首跑 Permission denied）', async () => {
    const exec = makeExec();
    await runLaunchdPatrol({ exec, inContainer: true, keyExistsFn: (p) => p.endsWith('id_rsa') });
    for (const [cmd] of exec.mock.calls) {
      expect(cmd).toMatch(/^ssh -i \S+\/\.ssh\/id_rsa -o /);
    }
  });

  it('ssh 密钥一个都不存在时回退 id_ed25519（保持可诊断的错误信息）', async () => {
    const exec = makeExec();
    await runLaunchdPatrol({ exec, inContainer: true, keyExistsFn: () => false });
    expect(exec.mock.calls[0][0]).toMatch(/id_ed25519/);
  });
});
