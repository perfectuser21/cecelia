import { describe, it, expect } from 'vitest';
import {
  parseLaunchctlList, parsePlistDump, computeNextRunUTC,
  extractOpenclawAgents, parseGhaCron,
  parseOpenclawCrons, OPENCLAW_CRON_CMD, OPENCLAW_CONFIG_CMD,
} from '../ops-collector.js';

// ── OpenClaw cron 台账化（0921，task 8fc40bfb）─────────────────────────
// 背景：ops_schedule_entries 21 条里 0 条是 OpenClaw —— 41 条 OpenClaw cron
// （含 18 条业务）从来没进过台账，Notion 上零留痕。主理人要「团队能调用
// OpenClaw 的全部任务」，前提是先看得见。
//
// 同时修一个两度复发的 bug：采集命令写死 `docker exec openclaw-gateway`。
// 它在 hk-vps→us-vps 迁移时坏过一次（源码注释里记着「迁移后必然
// No such container，腿常年 unreachable」），0920 us-vps→MMV 迁移后又坏一次。
// 改走 mmv 别名，迁移只需改别名不必改代码。
describe('OpenClaw cron → 排程台账', () => {
  const RAW = JSON.stringify({
    jobs: [
      {
        id: 'a1', name: 'OPC 下钻式晨报', enabled: true,
        schedule: { kind: 'cron', expr: '25 6 * * 1-5', tz: 'Asia/Shanghai' },
        lastRunStatus: 'error',
        state: { nextRunAtMs: 1789999999000, consecutiveErrors: 1 },
      },
      {
        id: 'a2', name: '悦升云端企业资料同步', enabled: true,
        schedule: { kind: 'every', everyMs: 1800000 },
        lastRunStatus: 'ok', state: { nextRunAtMs: null },
      },
      {
        id: 'a3', name: '已禁用的活', enabled: false,
        schedule: { kind: 'cron', expr: '0 0 * * *', tz: 'UTC' }, state: {},
      },
    ],
  });

  it('cron 型解析出表达式与时区', () => {
    const e = parseOpenclawCrons(RAW).find((x) => x.label === 'OPC 下钻式晨报');
    expect(e.kind).toBe('openclaw_cron');
    expect(e.schedule_desc).toContain('25 6 * * 1-5');
    expect(e.schedule_desc).toContain('Asia/Shanghai');
    expect(e.last_state).toBe('error');
    expect(e.next_run_utc).toBe(new Date(1789999999000).toISOString());
  });

  it('every 型换算成秒，且不伪造 next_run', () => {
    const e = parseOpenclawCrons(RAW).find((x) => x.label === '悦升云端企业资料同步');
    expect(e.kind).toBe('openclaw_every');
    expect(e.schedule_desc).toContain('1800');
    expect(e.next_run_utc).toBeNull();
  });

  it('禁用的活也收进台账并标 disabled（看得见才管得住）', () => {
    const e = parseOpenclawCrons(RAW).find((x) => x.label === '已禁用的活');
    expect(e).toBeTruthy();
    expect(e.last_state).toBe('disabled');
  });

  it('jobs 为 0 条视为可疑，抛错而不是当真空把台账清空', () => {
    expect(() => parseOpenclawCrons(JSON.stringify({ jobs: [] }))).toThrow(/0 条/);
  });

  it('非法 JSON 抛 parse_error，交上层归类', () => {
    expect(() => parseOpenclawCrons('not json')).toThrow(/parse_error/);
  });

  it('采集命令指向 MMV，不再是本机容器（两度复发的迁移 bug）', () => {
    expect(OPENCLAW_CRON_CMD).toMatch(/\bmmv\b/);
    expect(OPENCLAW_CRON_CMD).toContain('cron list --all --json');
    expect(OPENCLAW_CONFIG_CMD).toMatch(/\bmmv\b/);
    expect(OPENCLAW_CONFIG_CMD).not.toContain('docker exec openclaw-gateway');
  });
});

describe('parseLaunchctlList', () => {
  const OUT = `PID\tStatus\tLabel
1234\t0\tcom.cecelia.bridge
-\t78\tcom.zenithjoy.pipeline-worker
-\t0\tcom.apple.Finder
bad line without tabs`;
  it('只留自家 label，解析 pid/exit', () => {
    const rows = parseLaunchctlList(OUT);
    expect(rows).toEqual([
      { label: 'com.cecelia.bridge', pid: 1234, lastExitCode: 0 },
      { label: 'com.zenithjoy.pipeline-worker', pid: null, lastExitCode: 78 },
    ]);
  });
  it('坏行跳过不抛', () => expect(() => parseLaunchctlList('garbage\n???')).not.toThrow());
});

describe('parsePlistDump', () => {
  const OUT = `== /Library/LaunchDaemons/a.plist
{"Label":"com.cecelia.backup-db","StartCalendarInterval":{"Hour":3,"Minute":30}}
== /Library/LaunchDaemons/bad.plist
not-json
== /Library/LaunchDaemons/b.plist
{"Label":"com.cecelia.tick","StartInterval":300}`;
  it('按文件切块解析，坏块计入 badFiles', () => {
    const { plists, badFiles } = parsePlistDump(OUT);
    expect(plists.get('com.cecelia.backup-db').StartCalendarInterval).toEqual({ Hour: 3, Minute: 30 });
    expect(plists.get('com.cecelia.tick').StartInterval).toBe(300);
    expect(badFiles).toEqual(['/Library/LaunchDaemons/bad.plist']);
  });
});

describe('computeNextRunUTC（DST 正确，America/Los_Angeles）', () => {
  const TZ = 'America/Los_Angeles';
  it('每日 03:30 → 次日触发换算成 UTC（PDT=UTC-7）', () => {
    const from = new Date('2026-09-05T20:00:00Z'); // LA 13:00 PDT
    expect(computeNextRunUTC({ Hour: 3, Minute: 30 }, from, TZ))
      .toBe('2026-09-06T10:30:00.000Z');
  });
  it('跨 DST fall-back（2026-11-01 LA 回拨）后用 PST=UTC-8', () => {
    const from = new Date('2026-11-01T20:00:00Z'); // 回拨已发生
    expect(computeNextRunUTC({ Hour: 3, Minute: 30 }, from, TZ))
      .toBe('2026-11-02T11:30:00.000Z');
  });
  it('缺省字段=通配：只给 Minute=0 是每小时', () => {
    const from = new Date('2026-09-05T20:10:00Z');
    expect(computeNextRunUTC({ Minute: 0 }, from, TZ)).toBe('2026-09-05T21:00:00.000Z');
  });
  it('Weekday 7 与 0 都是周日', () => {
    const from = new Date('2026-09-05T20:00:00Z'); // 周六
    const a = computeNextRunUTC({ Weekday: 7, Hour: 1, Minute: 0 }, from, TZ);
    const b = computeNextRunUTC({ Weekday: 0, Hour: 1, Minute: 0 }, from, TZ);
    expect(a).toBe(b);
    expect(a).toBe('2026-09-06T08:00:00.000Z');
  });
  it('dict 数组=多触发点取最近', () => {
    const from = new Date('2026-09-05T20:00:00Z'); // LA 13:00
    expect(computeNextRunUTC([{ Hour: 23, Minute: 0 }, { Hour: 14, Minute: 0 }], from, TZ))
      .toBe('2026-09-05T21:00:00.000Z'); // LA 14:00 更近
  });
  it('视野内无触发返回 null（诚实留空）', () => {
    expect(computeNextRunUTC({ Month: 12, Day: 25 }, new Date('2026-09-05T00:00:00Z'), TZ, 8)).toBeNull();
  });
});

describe('extractOpenclawAgents', () => {
  it('dict 形 entries + 白名单字段（绝不带凭据）+ 编排关系', () => {
    const cfg = { agents: { entries: { main: { model: 'x', apiKey: 'SECRET', workspace: '/w' } } }, auth: { k: 'SECRET' } };
    const rows = extractOpenclawAgents(cfg);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'main', agent_type: 'openclaw_agent',
      meta: { model: 'x', workspace: '/w', orchestrates: [], delegation_mode: null },
    });
    expect(JSON.stringify(rows)).not.toContain('SECRET'); // 凭据白名单铁律
  });
  it('采 subagents.allowAgents 编排关系 + delegationMode', () => {
    const cfg = { agents: { entries: {
      main: { subagents: { allowAgents: ['dev', 'infra'], delegationMode: 'prefer', requireAgentId: true } },
    } } };
    const r = extractOpenclawAgents(cfg)[0];
    expect(r.meta.orchestrates).toEqual(['dev', 'infra']);
    expect(r.meta.delegation_mode).toBe('prefer');
  });
  it('无 subagents 的单 agent → orchestrates 空数组', () => {
    const r = extractOpenclawAgents({ agents: { entries: { curator: { model: 'y' } } } })[0];
    expect(r.meta.orchestrates).toEqual([]);
    expect(r.meta.delegation_mode).toBeNull();
  });
  it('array 形 entries 也认', () => {
    expect(extractOpenclawAgents({ agents: { entries: [{ id: 'dev' }] } })[0].name).toBe('dev');
  });
  it('entries 缺失抛 schema_drift', () => {
    expect(() => extractOpenclawAgents({})).toThrow(/schema_drift/);
  });
});

describe('parseGhaCron', () => {
  it('grep -Rno 输出 → 条目', () => {
    const OUT = `/Users/administrator/perfect21/cecelia/.github/workflows/nightly.yml:12:    - cron: '0 19 * * *'`;
    expect(parseGhaCron(OUT)).toEqual([
      { label: 'cecelia/nightly.yml', schedule_desc: "cron(UTC): 0 19 * * *", kind: 'gha_cron' },
    ]);
  });
});
