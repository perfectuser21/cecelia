/**
 * OpenClaw 运行记录采集——纯函数单测（SQL / 命令 / 行映射）
 * 决策 c7ff6e02 / 9ec7a010；判定点 b7be0e26（结果按 status）/ 6d4b7ed5（任务名回退 job_id 前 8 位）
 * 不碰数据库、不执行 ssh。
 */
import { describe, it, expect } from 'vitest';
import {
  buildIngestSql,
  buildMmvCmd,
  parseSqliteJson,
  mapOpenclawRow,
  OUTCOME_BY_STATUS,
} from '../openclaw-run-ingest.js';

const NOW = 1791400000000;
const DAY30 = 30 * 86400_000;

function baseRow(over = {}) {
  return {
    task_id: '5449a287-907f-4be8-bbb1-eb7b3792e50c',
    source_id: 'a9654769-fedb-4a84-a408-a9421bea74ea',
    agent_id: 'main',
    status: 'succeeded',
    created_at: 1791384725528,
    started_at: 1791384725528,
    ended_at: 1791384740472,
    terminal_summary: '{ "ok": true }',
    error: null,
    name: '悦升云端企业资料同步',
    payload_kind: 'command',
    ...over,
  };
}

describe('buildIngestSql', () => {
  it('sinceMs 为 null 时取 nowMs - 30 天', () => {
    const sql = buildIngestSql({ sinceMs: null, nowMs: NOW });
    expect(sql).toContain(`>= ${NOW - DAY30}`);
  });

  it('sinceMs 给定时用 sinceMs', () => {
    const sql = buildIngestSql({ sinceMs: 1791000000000, nowMs: NOW });
    expect(sql).toContain('>= 1791000000000');
    expect(sql).not.toContain(`>= ${NOW - DAY30}`);
  });

  it('含 cron 过滤、进行中兜底、LEFT JOIN、排序与默认 LIMIT 2000', () => {
    const sql = buildIngestSql({ sinceMs: null, nowMs: NOW });
    expect(sql).toContain("t.runtime='cron'");
    expect(sql).toContain("status IN ('running','queued')");
    expect(sql).toContain('coalesce(t.last_event_at,t.ended_at,t.created_at)');
    expect(sql).toContain('LEFT JOIN cron_jobs j ON j.job_id=t.source_id');
    expect(sql).toContain('ORDER BY t.created_at');
    expect(sql).toContain('LIMIT 2000');
    for (const col of [
      't.task_id', 't.source_id', 't.agent_id', 't.status', 't.created_at', 't.started_at',
      't.ended_at', 't.terminal_summary', 't.error', 'j.name', 'j.payload_kind',
    ]) {
      expect(sql).toContain(col);
    }
  });

  it('limit 可覆盖', () => {
    expect(buildIngestSql({ sinceMs: null, nowMs: NOW, limit: 50 })).toContain('LIMIT 50');
  });

  it('非整数入参抛错（防注入）', () => {
    expect(() => buildIngestSql({ sinceMs: '1;drop', nowMs: NOW })).toThrow();
    expect(() => buildIngestSql({ sinceMs: null, nowMs: 'x' })).toThrow();
    expect(() => buildIngestSql({ sinceMs: null, nowMs: NOW, limit: '1;drop' })).toThrow();
    expect(() => buildIngestSql({ sinceMs: 1.5, nowMs: NOW })).toThrow();
    expect(() => buildIngestSql({ sinceMs: NaN, nowMs: NOW })).toThrow();
  });
});

describe('buildMmvCmd', () => {
  it('SQL 经 base64 传输，命令里不含明文且可解码还原', () => {
    const cmd = buildMmvCmd('select 1');
    expect(cmd).not.toContain('select');
    expect(cmd).toContain('base64 -d | sqlite3 -readonly -json');
    expect(cmd.startsWith('ssh -o BatchMode=yes -o ConnectTimeout=20 mmv ')).toBe(true);
    expect(cmd).toContain('~/.openclaw/state/openclaw.sqlite');
    const m = cmd.match(/echo ([A-Za-z0-9+/=]+) \| base64 -d/);
    expect(m).not.toBeNull();
    expect(Buffer.from(m[1], 'base64').toString('utf8')).toBe('select 1');
  });

  it('中文与引号的 SQL 也能无损往返', () => {
    const sql = "select '悦升''x' as a";
    const cmd = buildMmvCmd(sql);
    const m = cmd.match(/echo ([A-Za-z0-9+/=]+) \| base64 -d/);
    expect(Buffer.from(m[1], 'base64').toString('utf8')).toBe(sql);
  });
});

describe('parseSqliteJson', () => {
  it('空串/空白 → []', () => {
    expect(parseSqliteJson('')).toEqual([]);
    expect(parseSqliteJson('  \n ')).toEqual([]);
  });

  it('数组 JSON 正常解析', () => {
    expect(parseSqliteJson('[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it('非数组 JSON 与非法 JSON 抛 parse_error', () => {
    expect(() => parseSqliteJson('{}')).toThrow(/parse_error/);
    expect(() => parseSqliteJson('oops')).toThrow(/parse_error/);
  });
});

describe('OUTCOME_BY_STATUS', () => {
  it('五种 status 映射', () => {
    expect(OUTCOME_BY_STATUS).toEqual({
      succeeded: 'pass', failed: 'fail', timed_out: 'timeout', running: 'running', queued: 'running',
    });
  });
});

describe('mapOpenclawRow', () => {
  it('完整行映射为 RunRow', () => {
    const r = mapOpenclawRow(baseRow());
    expect(r).toEqual({
      run_id: 'openclaw:5449a287-907f-4be8-bbb1-eb7b3792e50c',
      trigger_ref: '悦升云端企业资料同步',
      executor_kind: 'code',
      executor_id: 'openclaw:main',
      started_at: new Date(1791384725528),
      ended_at: new Date(1791384740472),
      outcome: 'pass',
      error: null,
      detail: {
        source: 'openclaw',
        job_id: 'a9654769-fedb-4a84-a408-a9421bea74ea',
        task_id: '5449a287-907f-4be8-bbb1-eb7b3792e50c',
        summary: '{ "ok": true }',
        status: 'succeeded',
      },
    });
  });

  it.each([
    ['succeeded', 'pass'], ['failed', 'fail'], ['timed_out', 'timeout'],
    ['running', 'running'], ['queued', 'running'], ['cancelled', 'unknown'], [null, 'unknown'],
  ])('status %s → outcome %s', (status, outcome) => {
    expect(mapOpenclawRow(baseRow({ status })).outcome).toBe(outcome);
  });

  it('name 为空时 trigger_ref 回退 openclaw-job:<job_id 前 8 位>', () => {
    expect(mapOpenclawRow(baseRow({ name: null })).trigger_ref).toBe('openclaw-job:a9654769');
    expect(mapOpenclawRow(baseRow({ name: '' })).trigger_ref).toBe('openclaw-job:a9654769');
  });

  it('payload_kind=command → code，其余 → agent', () => {
    expect(mapOpenclawRow(baseRow({ payload_kind: 'command' })).executor_kind).toBe('code');
    expect(mapOpenclawRow(baseRow({ payload_kind: 'agentTurn' })).executor_kind).toBe('agent');
    expect(mapOpenclawRow(baseRow({ payload_kind: null })).executor_kind).toBe('agent');
  });

  it('executor_id：有 agent_id → openclaw:<id>，空 → openclaw', () => {
    expect(mapOpenclawRow(baseRow({ agent_id: 'media' })).executor_id).toBe('openclaw:media');
    expect(mapOpenclawRow(baseRow({ agent_id: '' })).executor_id).toBe('openclaw');
    expect(mapOpenclawRow(baseRow({ agent_id: null })).executor_id).toBe('openclaw');
  });

  it('ended_at 早于 started_at 时置为 started_at', () => {
    const r = mapOpenclawRow(baseRow({ started_at: 2000, created_at: 2000, ended_at: 1000 }));
    expect(r.ended_at).toEqual(new Date(2000));
  });

  it('running 行 ended_at 为 null', () => {
    const r = mapOpenclawRow(baseRow({ status: 'running', ended_at: null }));
    expect(r.ended_at).toBeNull();
    const q = mapOpenclawRow(baseRow({ status: 'queued', ended_at: null }));
    expect(q.ended_at).toBeNull();
  });

  it('error 截 2000，summary 截 4000', () => {
    const r = mapOpenclawRow(baseRow({
      status: 'failed', error: 'e'.repeat(3000), terminal_summary: 's'.repeat(5000),
    }));
    expect(r.error).toHaveLength(2000);
    expect(r.detail.summary).toHaveLength(4000);
  });

  it('started_at 缺失时用 created_at', () => {
    const r = mapOpenclawRow(baseRow({ started_at: null, created_at: 1791384000000 }));
    expect(r.started_at).toEqual(new Date(1791384000000));
  });

  it('task_id 缺失 → null', () => {
    expect(mapOpenclawRow(baseRow({ task_id: null }))).toBeNull();
    expect(mapOpenclawRow(baseRow({ task_id: '' }))).toBeNull();
    expect(mapOpenclawRow(null)).toBeNull();
  });

  it('started_at 与 created_at 都非法 → null', () => {
    expect(mapOpenclawRow(baseRow({ started_at: null, created_at: null }))).toBeNull();
    expect(mapOpenclawRow(baseRow({ started_at: 'abc', created_at: 'xyz' }))).toBeNull();
  });
});
