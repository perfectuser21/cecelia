import { describe, it, expect, vi } from 'vitest';
import {
  parseMemMB, memGuardDecision, checkConfigDrift, restoreConfigShape,
  doctrineSeedPlan, pickRunner, renderRouterConf, DOCTRINE_MARK,
  parseOutreachHealth, MEMLOG_PS_ARGS, RUNNERS, parseRunnerLoad,
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

// ── codex 跑场池：M4/M1 是主力，MMV 留给 Claude/Grok（主理人 0920 拍板）──────
//
// 为什么 MMV 不能参与 codex 的常规竞争：Claude 与 Grok 的凭据只在 MMV，
// OpenClaw 用 auth.profiles 的 token 直连它们（clawdbot.json: xai:manual /
// anthropic:manual），换句话说 **MMV 是这两家唯一的执行机**。而 codex 走的是
// agentRuntime → ssh 到 session-runner 跑 CLI，哪台机都行。
//
// 0920 实测三台召唤链路完全等价：网关 key 都能 ssh、codex 0.151.0 都在、
// 网关原样命令都能起 app-server、出网 IP 同为 38.23.47.81；且 M4/M1 都有
// ~/.codex/auth.json，MMV 反而没有。所以让 codex 去 M4/M1，把 MMV 让出来。
//
// 旧逻辑是「按 RUNNERS 顺序取第一个探活成功的」——MMV 排第一且从不掉线，
// 于是 M4/M1 作为备胎一次都没被召唤过，三台机的算力只用了一台。
describe('openclaw-guards — codex 跑场池按负载选机', () => {
  const M4 = '100.86.57.69';
  const M1 = '100.88.166.55';
  const MMV = '100.71.151.105';
  const allAlive = () => true;

  it('注册表声明角色：M4/M1 是 codex 主力，MMV 仅兜底', () => {
    const byName = Object.fromEntries(RUNNERS.map((r) => [r.name, r]));
    expect(byName['XIAN-M4'].role).toBe('codex-primary');
    expect(byName['XIAN-M1'].role).toBe('codex-primary');
    expect(byName.MMV.role).toBe('fallback');
  });

  it('两台主力都活 → 选 codex 会话数更少的那台', () => {
    const load = (t) => (t.includes(M4) ? { codexSessions: 5, load1: 3.0 } : { codexSessions: 1, load1: 0.4 });
    expect(pickRunner(allAlive, { loadFn: load }).name).toBe('XIAN-M1');

    const flipped = (t) => (t.includes(M4) ? { codexSessions: 0, load1: 0.2 } : { codexSessions: 4, load1: 2.5 });
    expect(pickRunner(allAlive, { loadFn: flipped }).name).toBe('XIAN-M4');
  });

  it('会话数打平 → 用 load average 分胜负', () => {
    const load = (t) => (t.includes(M4) ? { codexSessions: 2, load1: 4.0 } : { codexSessions: 2, load1: 0.5 });
    expect(pickRunner(allAlive, { loadFn: load }).name).toBe('XIAN-M1');
  });

  it('MMV 再闲也不抢 codex 的活（它要留给 Claude/Grok）', () => {
    const load = (t) => {
      if (t.includes(MMV)) return { codexSessions: 0, load1: 0.0 }; // 全场最闲
      return { codexSessions: 9, load1: 8.0 };                       // 主力都很忙
    };
    expect(pickRunner(allAlive, { loadFn: load }).name).not.toBe('MMV');
  });

  it('只有一台主力活 → 直接选它，不管负载多高', () => {
    const onlyM1 = (t) => t.includes(M1);
    const load = () => ({ codexSessions: 99, load1: 30.0 });
    expect(pickRunner(onlyM1, { loadFn: load }).name).toBe('XIAN-M1');
  });

  it('两台主力都不可达 → 才回落 MMV（兜底仍要保住 codex 可用）', () => {
    const onlyMMV = (t) => t.includes(MMV);
    expect(pickRunner(onlyMMV, { loadFn: () => ({ codexSessions: 0, load1: 0 }) }).name).toBe('MMV');
  });

  it('三台全灭 → null（保持现状，不写坏路由）', () => {
    expect(pickRunner(() => false, { loadFn: () => null })).toBeNull();
  });

  it('负载探测失败的机器按最忙处理，不被误选', () => {
    const load = (t) => (t.includes(M4) ? null : { codexSessions: 3, load1: 1.5 });
    expect(pickRunner(allAlive, { loadFn: load }).name).toBe('XIAN-M1');
  });

  it('滞后：当前跑场仍健康且没明显更优时不切换（避免抖动）', () => {
    // M1 只比 M4 少 1 个会话，差距没到阈值 → 维持现状 M4
    const load = (t) => (t.includes(M4) ? { codexSessions: 2, load1: 1.0 } : { codexSessions: 1, load1: 0.9 });
    expect(pickRunner(allAlive, { loadFn: load, current: 'XIAN-M4' }).name).toBe('XIAN-M4');
    // 差距拉大到阈值以上 → 该切就切
    const wide = (t) => (t.includes(M4) ? { codexSessions: 6, load1: 5.0 } : { codexSessions: 1, load1: 0.5 });
    expect(pickRunner(allAlive, { loadFn: wide, current: 'XIAN-M4' }).name).toBe('XIAN-M1');
  });

  it('当前跑场已掉线 → 滞后不生效，立刻切到活着的主力', () => {
    const m4Dead = (t) => !t.includes(M4);
    const load = () => ({ codexSessions: 1, load1: 0.5 });
    expect(pickRunner(m4Dead, { loadFn: load, current: 'XIAN-M4' }).name).toBe('XIAN-M1');
  });

  it('不传 loadFn 时退化为按顺序探活（向后兼容旧调用）', () => {
    const onlyM4 = (t) => t.includes(M4);
    expect(pickRunner(onlyM4).name).toBe('XIAN-M4');
  });

  it('parseRunnerLoad 解析远端探针输出（codex 会话数 + load average）', () => {
    expect(parseRunnerLoad('3\n1.75 1.20 0.98')).toEqual({ codexSessions: 3, load1: 1.75 });
    expect(parseRunnerLoad('0\n0.05 0.10 0.20')).toEqual({ codexSessions: 0, load1: 0.05 });
    expect(parseRunnerLoad('')).toBeNull();
    expect(parseRunnerLoad('garbage')).toBeNull();
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

// 2026-09-16 漏网案：defaults.primary 已切跑场池，但 6 个 agent 有显式 sol（embedded）
// 覆盖绕过默认值，仍在 us-vps 本机跑推理——守卫只查 defaults 是盲区。
describe('openclaw-guards — agent 级模型漂移（本机 embedded 漏网）', () => {
  const base = {
    agents: {
      defaults: { model: { primary: 'openai/gpt-5.6-terra', fallbacks: ['openai/gpt-5.6-sol'] } },
      entries: {
        infra: { model: { primary: 'openai/gpt-5.6-terra' } },
        media: { model: { primary: 'openai/gpt-5.6-sol' } },
        dev: { model: 'openai/gpt-5.6-sol' },
      },
    },
    plugins: { entries: { codex: { config: { appServer: { command: '/usr/bin/ssh', args: ['-F', 'x', 'session-runner'] } } } } },
  };
  it('agent 级 sol 覆盖被判漂移（点名漏网者）', () => {
    const drift = checkConfigDrift(base);
    expect(drift).toMatch(/media/);
    expect(drift).toMatch(/dev/);
    expect(drift).not.toMatch(/infra/);
  });
  it('restoreConfigShape 把 agent 级覆盖一并拉回跑场池', () => {
    const fixed = restoreConfigShape(base);
    expect(checkConfigDrift(fixed)).toBeNull();
    expect(fixed.agents.entries.media.model.primary).toBe('openai/gpt-5.6-terra');
    expect(fixed.agents.entries.dev.model.primary ?? fixed.agents.entries.dev.model).toBe('openai/gpt-5.6-terra');
    // 不该动没问题的
    expect(fixed.agents.entries.infra.model.primary).toBe('openai/gpt-5.6-terra');
  });
  it('fallbacks 里的 sol 是断池保命兜底，不算漂移', () => {
    const ok = JSON.parse(JSON.stringify(base));
    delete ok.agents.entries.media;
    delete ok.agents.entries.dev;
    expect(checkConfigDrift(ok)).toBeNull();
  });
});
