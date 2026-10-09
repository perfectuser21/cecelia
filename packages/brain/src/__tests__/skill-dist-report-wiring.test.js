/**
 * skill 分发漂移接线（链 bf5088a3 棒8，任务 1141f101）：
 * 检测结果落在 working_memory[skill_manifest_drift] 后，晨报 Bark 出一行、日报出板块「skill 分发漂移」，
 * 且 scheduler 注册了 skill-dist-drift job。全部注入，不发 ssh。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

vi.mock('../db.js', () => ({ default: {} }));
vi.mock('../notifier.js', () => ({
  sendBark: vi.fn().mockResolvedValue(true),
  sendFeishu: vi.fn().mockResolvedValue(true),
}));
vi.mock('../triage-officer-rank.js', () => ({ LEADERBOARD_KEY: 'triage_officer_leaderboard' }));

import { runMorningCockpitBark } from '../morning-cockpit-bark.js';
import { buildReportText } from '../daily-report-generator.js';
import { sendBark } from '../notifier.js';
import { SKILL_DIST_KEY } from '../lib/skill-dist-report.js';
import { EXECUTOR_SKILL_MAP } from '../lib/task-type-registry.js';

const here = dirname(fileURLToPath(import.meta.url));

const driftState = () => ({
  checked_at: new Date().toISOString(),
  truth: { status: 'ok', count: 105, tree_hash: 'a'.repeat(64), broken: [], broken_total: 0 },
  machines: [{ id: 'xian-m1', dirs: [{ label: 'claude', status: 'drift', missing: ['a'], missing_total: 1, extra: [], extra_total: 0, changed: [], changed_total: 0, broken: [], broken_total: 0 }] }],
  summary: { drifted: ['xian-m1'], unverified: [], ok: [] },
});

const consistentSkillRows = () => Object.entries(EXECUTOR_SKILL_MAP).filter(([, c]) => c)
  .map(([t, c]) => ({ name: `n-${t}`, status: 'active', task_types: [t], dispatch_command: c }));

function pool(state) {
  return {
    query: vi.fn(async (sql, params = []) => {
      const text = String(sql);
      if (/FROM skill_registry/.test(text)) return { rows: consistentSkillRows() };
      if (/FROM working_memory/.test(text) && params[0] === SKILL_DIST_KEY) {
        return state ? { rows: [{ value_json: state }] } : { rows: [] };
      }
      return { rows: [] };
    }),
  };
}

describe('晨报 Bark：skill 分发漂移一行', () => {
  beforeEach(() => {
    sendBark.mockClear();
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 30, 0))); // 北京 08:30 窗口内
  });
  afterEach(() => { vi.useRealTimers(); });

  it('结果里 M1 缺一个 skill → 晨报正文出现 🟡 AMBER skill 分发漂移 并点名 xian-m1', async () => {
    const result = await runMorningCockpitBark(pool(driftState()));
    expect(result).toMatchObject({ sent: true });
    const body = sendBark.mock.calls[0][1];
    expect(body).toMatch(/🟡\s*AMBER skill 分发漂移/);
    expect(body).toContain('xian-m1');
  });

  it('无数据 / 读取失败 → 晨报不出该行也不拖垮', async () => {
    await runMorningCockpitBark(pool(null));
    expect(sendBark.mock.calls[0][1]).not.toMatch(/skill 分发/);
    sendBark.mockClear();
    const broken = { query: vi.fn(async (sql, params = []) => { if (params[0] === SKILL_DIST_KEY) throw new Error('wm down'); return { rows: [] }; }) };
    expect(await runMorningCockpitBark(broken)).toMatchObject({ sent: true });
    expect(sendBark.mock.calls[0][1]).not.toMatch(/skill 分发/);
  });

  it('一致（无漂移）→ 不出该行', async () => {
    const ok = driftState();
    ok.machines[0].dirs[0] = { label: 'claude', status: 'ok' };
    await runMorningCockpitBark(pool(ok));
    expect(sendBark.mock.calls[0][1]).not.toMatch(/skill 分发/);
  });
});

describe('日报：skill 分发漂移板块', () => {
  const base = ['2026-09-25', '2026-09-24', { count: 0, keywords: [] }, [], [], 0];

  it('传入漂移结果 → 日报含板块与 🟡 AMBER，点名机器与 skill', () => {
    const text = buildReportText(...base, null, null, driftState());
    expect(text).toContain('== skill 分发漂移 ==');
    expect(text).toMatch(/🟡 AMBER xian-m1\/claude/);
  });

  it('无数据（null / 省略）→ 不出板块，原板块不受影响', () => {
    expect(buildReportText(...base, null, null, null)).not.toContain('skill 分发漂移');
    expect(buildReportText(...base)).not.toContain('skill 分发漂移');
    expect(buildReportText(...base)).toContain('== 异常告警 ==');
  });

  it('generateDailyReport 读 working_memory 的检测结果进入日报正文；读取失败不拖垮日报', async () => {
    const { generateDailyReport } = await import('../daily-report-generator.js');
    const run = async (state, failRead = false) => {
      const saved = [];
      const p = {
        query: vi.fn(async (sql, params = []) => {
          const text = String(sql);
          if (/FROM skill_registry/.test(text)) return { rows: consistentSkillRows() };
          if (/FROM working_memory/.test(text) && params[0] === SKILL_DIST_KEY) {
            if (failRead) throw new Error('wm down');
            return state ? { rows: [{ value_json: state }] } : { rows: [] };
          }
          if (/INSERT INTO working_memory/.test(text)) saved.push(params);
          return { rows: [] };
        }),
      };
      const out = await generateDailyReport(p, new Date('2026-09-25T01:01:00Z'));
      return { out, report: saved.map((x) => String(x[1])).find((v) => v.includes('ZenithJoy')) ?? '' };
    };
    const a = await run(driftState());
    expect(a.out.generated).toBe(true);
    expect(a.report).toContain('skill 分发漂移');
    const b = await run(null, true);
    expect(b.out.generated).toBe(true);
    expect(b.report).not.toContain('skill 分发漂移');
  });
});

describe('scheduler 注册', () => {
  it('JOBS 含 skill-dist-drift：needsPool、显式 timeout、在 scheduler-liveness 之前', () => {
    const src = readFileSync(resolve(here, '../scheduler-jobs.js'), 'utf8');
    expect(src).toContain("import { runSkillDistDrift } from './skill-dist-drift.js'");
    const iJob = src.indexOf("name: 'skill-dist-drift'");
    const iLiveness = src.indexOf("name: 'scheduler-liveness'");
    expect(iJob).toBeGreaterThan(0);
    expect(iJob).toBeLessThan(iLiveness);
    const line = src.slice(iJob, src.indexOf('\n', iJob));
    expect(line).toMatch(/needsPool: true/);
    expect(line).toMatch(/timeoutMs: 120_000/);
    expect(line).toMatch(/runSkillDistDrift\(pool\)/);
  });
});
