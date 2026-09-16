import { describe, it, expect, vi } from 'vitest';
import {
  parseMemMB, memGuardDecision, checkConfigDrift, restoreConfigShape,
  doctrineSeedPlan, pickRunner, renderRouterConf, DOCTRINE_MARK,
  parseOutreachHealth, MEMLOG_PS_ARGS,
} from '../openclaw-guards.js';

// us-vps 零执行守卫收编 Brain（决策 95477a66）：宿主散装 cron → Brain scheduler job。
describe('openclaw-guards — 内存守卫', () => {
  it('内存字符串解析 GiB/MiB，超阈才判重启，cron 窗口边缘顺延', () => {
    expect(parseMemMB('1.469GiB')).toBe(1504);
    expect(parseMemMB('571.9MiB')).toBe(572);
    expect(memGuardDecision({ mb: 2100, minute: 15 })).toBe('restart');
    expect(memGuardDecision({ mb: 2100, minute: 30 })).toBe('defer'); // 判定 cron 整/半点窗口
    expect(memGuardDecision({ mb: 2100, minute: 59 })).toBe('defer');
  });

  it('阈值校正（escort 误伤案）：正常工作态 1.7G 不得触发重启，env 可调免发版', () => {
    // 2026-09-16 生产实证：网关多会话正常工作态 1.4-1.7G（夜间值守更高），
    // 旧阈值 1400 把正常体温当泄漏一天误摁 9 次、打断在跑 escort。
    expect(memGuardDecision({ mb: 1700, minute: 15 })).toBe('ok');
    expect(memGuardDecision({ mb: 1450, minute: 15 })).toBe('ok'); // 旧阈值下会误伤的点
    expect(memGuardDecision({ mb: 1600, minute: 15, limitMb: 1500 })).toBe('restart'); // 可调参
  });
});

describe('openclaw-guards — 配置漂移', () => {
  const goodCfg = {
    agents: { defaults: { model: { primary: 'openai/gpt-5.6-terra', fallbacks: ['openai/gpt-5.6-sol'] } } },
    plugins: { entries: { codex: { config: { appServer: { command: '/usr/bin/ssh', args: ['-F', '/root/.openclaw/ssh-router.conf', 'session-runner', 'app-server'] } } } } },
  };
  it('铁律形状通过；primary 回落/appServer 非池形态判漂移', () => {
    expect(checkConfigDrift(goodCfg)).toBeNull();
    const bad1 = JSON.parse(JSON.stringify(goodCfg));
    bad1.agents.defaults.model.primary = 'openai/gpt-5.6-sol';
    expect(checkConfigDrift(bad1)).toMatch(/primary/);
    const bad2 = JSON.parse(JSON.stringify(goodCfg));
    bad2.plugins.entries.codex.config.appServer = { command: '/bin/echo', args: [] };
    expect(checkConfigDrift(bad2)).toMatch(/appServer/);
  });
  it('restoreConfigShape 把漂移改回铁律形状', () => {
    const bad = JSON.parse(JSON.stringify(goodCfg));
    bad.agents.defaults.model.primary = 'openai/gpt-5.6-sol';
    bad.plugins.entries.codex.config.appServer = { command: '/bin/echo', args: [] };
    const fixed = restoreConfigShape(bad);
    expect(checkConfigDrift(fixed)).toBeNull();
  });
});

describe('openclaw-guards — 教义补种', () => {
  it('缺教义的工作区列入补种计划，已有的跳过', () => {
    const plan = doctrineSeedPlan({
      template: `x\n${DOCTRINE_MARK}\n内容`,
      workspaces: [
        { dir: '/w/clawd-a', content: `旧内容\n${DOCTRINE_MARK}\n有了` },
        { dir: '/w/clawd-b', content: '没有教义' },
        { dir: '/w/clawd-c', content: null }, // 无 AGENTS.md
      ],
    });
    expect(plan.map((p) => p.dir)).toEqual(['/w/clawd-b', '/w/clawd-c']);
    expect(plan[0].append).toContain(DOCTRINE_MARK);
  });
});

describe('openclaw-guards — 跑场路由', () => {
  it('按优先级探活选跑场；全灭返回 null', () => {
    const probe = vi.fn((host) => host.includes('100.86.57.69')); // 只有 M4 活
    expect(pickRunner(probe).name).toBe('XIAN-M4');
    expect(pickRunner(() => false)).toBeNull();
  });
  it('renderRouterConf 产出网关可读的 ssh config', () => {
    const conf = renderRouterConf({ name: 'MMV', ip: '100.71.151.105', user: 'administrator' });
    expect(conf).toContain('Host session-runner');
    expect(conf).toContain('HostName 100.71.151.105');
    expect(conf).toContain('User administrator');
    expect(conf).toContain('IdentityFile /root/.openclaw/mmv_key');
  });
});

// 2026-09-16 触达线空转案：话术全「停用」→ tick 每 30min 报 NO_SCRIPT 后静默退出，
// 连续 22 小时零触达无人知晓。活性检查补进守卫，静默失败必须上浮。
describe('openclaw-guards — 触达线活性', () => {
  const tick = (t, msg) => `[${t}] ${msg}`;
  it('连续空转（无成功发送）判 stalled 并给出原因', () => {
    const log = [
      tick('0916-09:00:00', '话术缺失: NO_SCRIPT B'),
      tick('0916-09:30:00', '话术缺失: NO_SCRIPT B'),
      tick('0916-10:02:26', '话术缺失: NO_SCRIPT B'),
    ].join('\n');
    const h = parseOutreachHealth(log);
    expect(h.verdict).toBe('stalled');
    expect(h.reason).toMatch(/NO_SCRIPT/);
    expect(h.stalledTicks).toBe(3);
  });
  it('有成功发送则判 healthy（拟人跳过不算故障）', () => {
    const log = [
      tick('0916-09:00:00', '拟人跳过本tick'),
      tick('0916-09:30:00', '话术缺失: NO_SCRIPT B'),
      tick('0916-10:00:00', '单#12: 张三(dy123) via 主号 [profile]'),
    ].join('\n');
    expect(parseOutreachHealth(log).verdict).toBe('healthy');
  });
  it('全是拟人跳过/无待触达 → idle，不误报', () => {
    const log = [
      tick('0916-09:00:00', '拟人跳过本tick'),
      tick('0916-09:30:00', '无待触达单'),
    ].join('\n');
    expect(parseOutreachHealth(log).verdict).toBe('idle');
  });
  it('空日志不崩，判 unknown', () => {
    expect(parseOutreachHealth('').verdict).toBe('unknown');
  });
});

describe('openclaw-guards — memlog 观测线', () => {
  it('docker top 参数必须含 pid（否则 daemon 报 Couldn\'t find PID field）', () => {
    // 2026-09-16 实证：-eo comm 缺 pid 字段被 docker daemon 拒绝，观测线一直空跑
    expect(MEMLOG_PS_ARGS.join(' ')).toMatch(/pid/);
  });
});
