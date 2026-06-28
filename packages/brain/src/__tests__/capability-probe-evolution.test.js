/**
 * probeEvolution 行为测试
 *
 * 验证三条路径：
 *   1. component_evolutions 有 7 天内记录 → ok=true
 *   2. 无记录 + 扫描器空闲态（2 天内正常扫描但无 PR 合并）→ ok=true
 *   3. 无记录 + 扫描器真实故障（从未扫/报错/过期）→ ok=false
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── vi.hoisted：工厂内引用的变量必须先 hoist ─────────────────

const mockQuery = vi.hoisted(() => vi.fn());

// ── 顶层 mock：所有 capability-probe.js 依赖 ────────────────

vi.mock('../db.js', () => ({ default: { query: mockQuery } }));
vi.mock('../auto-fix.js', () => ({ shouldAutoFix: vi.fn(() => false), dispatchToDevSkill: vi.fn() }));
vi.mock('../executor.js', () => ({ getActiveProcessCount: vi.fn(() => 0), MAX_SEATS: 10 }));
vi.mock('../alerting.js', () => ({ raise: vi.fn(), sendAlert: vi.fn() }));
vi.mock('../cortex.js', () => ({ performRCA: vi.fn() }));
vi.mock('../monitor-loop.js', () => ({
  getMonitorStatus: vi.fn(() => ({ running: true, interval_ms: 30000, cycle_count: 1, last_cycle_at: Date.now() })),
  startMonitorLoop: vi.fn(),
}));
vi.mock('../consciousness-guard.js', () => ({
  isConsciousnessEnabled: vi.fn(() => true),
  getConsciousnessStatus: vi.fn(() => ({ enabled: true, env_override: false })),
  setConsciousnessEnabled: vi.fn(),
  initConsciousnessGuard: vi.fn(),
  logStartupDeclaration: vi.fn(),
  _resetCacheForTest: vi.fn(),
  _resetDeprecationWarn: vi.fn(),
  GUARDED_MODULES: [],
}));

// ── 辅助：组装 pool.query mock 序列 ───────────────────────────

/**
 * 构建 probeEvolution 的 pool.query mock：
 *   call 1 — component_evolutions 计数查询
 *   call 2 — working_memory 扫描门控读取（可选，cnt>0 时不调用）
 */
function makeEvolutionPool({ cnt = 0, lastDate = null, workingMemory = undefined } = {}) {
  const pool = { query: vi.fn() };

  // call 1：component_evolutions COUNT
  pool.query.mockResolvedValueOnce({
    rows: [{ cnt: String(cnt), last_date: lastDate }],
    rowCount: cnt > 0 ? cnt : 0,
  });

  if (cnt === 0) {
    // call 2：working_memory
    if (workingMemory === 'throw') {
      pool.query.mockRejectedValueOnce(new Error('DB error'));
    } else {
      pool.query.mockResolvedValueOnce({
        rows: workingMemory !== undefined ? [{ value_json: workingMemory }] : [],
        rowCount: workingMemory !== undefined ? 1 : 0,
      });
    }
  }

  return pool;
}

// ── 导入被测模块（在 mock 之后）───────────────────────────────

// runProbes 会跑所有探针，我们只关心 evolution
// 直接拿 PROBES 列表，提取 evolution 探针 fn 并注入 mock pool
import { PROBES } from '../capability-probe.js';

async function runEvolutionProbe(poolMock) {
  const probe = PROBES.find(p => p.name === 'evolution');
  if (!probe) throw new Error('evolution probe not found');
  // pool 从 db.js 单例取，通过 mockQuery 注入
  mockQuery.mockImplementation(poolMock.query);
  return probe.fn();
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════
// 路径 1：7 天内有记录 → ok=true
// ══════════════════════════════════════════════════════════

describe('probeEvolution — 7 天内有 evolution 记录', () => {
  it('cnt > 0 时返回 ok=true，detail 含 7d_pr_evolutions', async () => {
    const pool = makeEvolutionPool({ cnt: 5, lastDate: '2026-06-27' });
    const result = await runEvolutionProbe(pool);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('7d_pr_evolutions=5');
    expect(result.detail).toContain('last_date=2026-06-27');
  });

  it('cnt=1 时也返回 ok=true（最小正常值）', async () => {
    const pool = makeEvolutionPool({ cnt: 1, lastDate: '2026-06-28' });
    const result = await runEvolutionProbe(pool);
    expect(result.ok).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// 路径 2：无记录 + 空闲态（扫描器 2 天内正常运行）
// ══════════════════════════════════════════════════════════

describe('probeEvolution — 无记录但扫描器空闲（idle）', () => {
  it('今日扫描 + 无错 → ok=true，detail 含 idle 标记', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const pool = makeEvolutionPool({
      cnt: 0,
      workingMemory: { date: today, inserted: 0, skipped: 0, checked: 3 },
    });
    const result = await runEvolutionProbe(pool);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('idle');
    expect(result.detail).toContain(`last_scan=${today}`);
  });

  it('昨日扫描（daysSinceScan=1）→ 仍为 ok=true', async () => {
    const yesterday = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const pool = makeEvolutionPool({
      cnt: 0,
      workingMemory: { date: yesterday, inserted: 0, skipped: 0, checked: 0 },
    });
    const result = await runEvolutionProbe(pool);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('idle');
  });

  it('空闲态 detail 包含 checked 数量', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const pool = makeEvolutionPool({
      cnt: 0,
      workingMemory: { date: today, inserted: 0, skipped: 2, checked: 2 },
    });
    const result = await runEvolutionProbe(pool);
    expect(result.detail).toContain('checked=2');
  });
});

// ══════════════════════════════════════════════════════════
// 路径 3：无记录 + 真实故障
// ══════════════════════════════════════════════════════════

describe('probeEvolution — 无记录且扫描器真实故障', () => {
  it('working_memory 无记录（从未扫描）→ ok=false + scan=never', async () => {
    const pool = makeEvolutionPool({ cnt: 0, workingMemory: undefined });
    const result = await runEvolutionProbe(pool);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('scan=never');
  });

  it('扫描器有 error 字段 → ok=false + scan_error', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const pool = makeEvolutionPool({
      cnt: 0,
      workingMemory: { date: today, error: 'GitHub API 403 Forbidden', inserted: 0 },
    });
    const result = await runEvolutionProbe(pool);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('scan_error');
    expect(result.detail).toContain('403');
  });

  it('扫描器超过 2 天未运行（daysSinceScan=3）→ ok=false + scanner_stale', async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const pool = makeEvolutionPool({
      cnt: 0,
      workingMemory: { date: threeDaysAgo, inserted: 0, skipped: 0, checked: 0 },
    });
    const result = await runEvolutionProbe(pool);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('scanner_stale');
  });

  it('扫描器恰好 7 天前运行 → ok=false（stale）', async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const pool = makeEvolutionPool({
      cnt: 0,
      workingMemory: { date: sevenDaysAgo, inserted: 1, checked: 5 },
    });
    const result = await runEvolutionProbe(pool);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('scanner_stale');
  });

  it('working_memory 查询抛异常 → ok=false + scan_diag_unavailable', async () => {
    const pool = makeEvolutionPool({ cnt: 0, workingMemory: 'throw' });
    const result = await runEvolutionProbe(pool);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('scan_diag_unavailable');
  });
});

// ══════════════════════════════════════════════════════════
// 静态代码约束验证
// ══════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';

const probeCode = fs.readFileSync(
  path.resolve('src/capability-probe.js'),
  'utf8'
);
const evFnMatch = probeCode.match(/async function probeEvolution\(\)[^]*?(?=\nasync function |\nexport )/);
const evFn = evFnMatch ? evFnMatch[0] : '';

describe('probeEvolution — 静态代码约束', () => {
  it('包含 idle 标记字符串（空闲态判断）', () => {
    expect(evFn).toContain('idle');
  });

  it('包含 scanner_stale 标记（过期扫描器检测）', () => {
    expect(evFn).toContain('scanner_stale');
  });

  it('包含 scan=never 标记（从未扫描检测）', () => {
    expect(evFn).toContain('scan=never');
  });

  it('包含 daysSinceScan 变量（时间差计算）', () => {
    expect(evFn).toContain('daysSinceScan');
  });

  it('从 working_memory 读取 evolution_last_scan_date', () => {
    expect(evFn).toContain('evolution_last_scan_date');
  });
});
