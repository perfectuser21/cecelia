import { describe, it, expect } from 'vitest';
import {
  parseLaunchctlList, parsePlistDump, computeNextRunUTC,
  extractOpenclawAgents, parseGhaCron,
} from '../ops-collector.js';

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
  it('dict 形 entries + 白名单字段（绝不带凭据）', () => {
    const cfg = { agents: { entries: { main: { model: 'x', apiKey: 'SECRET', workspace: '/w' } } }, auth: { k: 'SECRET' } };
    const rows = extractOpenclawAgents(cfg);
    expect(rows).toEqual([{ name: 'main', agent_type: 'openclaw_agent', meta: { model: 'x', workspace: '/w' } }]);
    expect(JSON.stringify(rows)).not.toContain('SECRET');
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
