/**
 * Sprint 08231107-kernel-ccd99d19 — 投影物化两阶段原子化（frozen RED→GREEN）
 *
 * PRD Golden Path:
 *   rescan 触发换代 → 新 run 以 status='materializing' 写入 → 全部节点/边物化后
 *   单事务翻转 new='active' + old='superseded' → 读取侧只见完整投影（旧全量或新全量），
 *   materializing 残行对读取侧永不可见。
 *
 * 运行方式（评估器/CI，真实 exit code）：
 *   (cd sprints/08231107-kernel-ccd99d19 && npx vitest run --root . tests/projection-two-phase.test.js)
 *   —— 仓库根 vitest.config 的 test.root=packages/brain 且 include 不含 sprints/**，
 *      从仓库根跑本文件必命中「No test files found / include 外绿态」陷阱，故用子 shell
 *      以本 sprint 目录为 --root 走 vitest 默认 include 真实执行（见 invariant [vitest exit语义]）。
 *
 * 禁 mock 边：被改的边是 projector.js ↔ map_projection_runs（status 写路径与读谓词）。
 *   本单元测试在真实 DB 驱动接缝（runProjection 的注入 client / db 模块的 pool.query）上
 *   断言代码真实发往 Postgres 的 SQL/status/顺序，不 mock 相邻业务模块；真 PG 的原子交换
 *   与崩溃残行不可见由 brain-integration 的 *.pg.integration.test.js 补位（postgres:false 本地不跑）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── 读取侧：status-aware 假 pool（按 SQL 真实 status 谓词过滤，改谓词即触发红）─────────
const fakeState = { runs: [] };
vi.mock('../../../packages/brain/src/db.js', () => {
  function allowedStatuses(sql) {
    if (/status\s*=\s*'active'/.test(sql)) return new Set(['active']);
    const m = sql.match(/status\s+IN\s*\(([^)]*)\)/i);
    if (m) return new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
    return null;
  }
  const pool = {
    query: async (sql, params) => {
      const text = String(sql);
      if (/FROM map_projection_runs/i.test(text)) {
        const scope = params?.[0];
        const allowed = allowedStatuses(text);
        let rows = fakeState.runs.filter((r) => r.scope_key === scope);
        if (allowed) rows = rows.filter((r) => allowed.has(r.status));
        if (/fact_revisions->>/.test(text)) {
          const revValue = params?.[1];
          rows = rows.filter((r) => (r.fact_revisions || {})[scope] === revValue);
        }
        rows = rows.slice().sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        return { rows: rows.slice(0, 1) };
      }
      return { rows: [] };
    },
    connect: async () => { throw new Error('unit test must not open a real connection'); },
  };
  return { default: pool };
});

import {
  runProjection,
  getActiveProjection,
  getProjectionForRevision,
} from '../../../packages/brain/src/map/projector.js';

const BASE = 'a'.repeat(40);

function tinyManifest() {
  return {
    scope_key: 'cecelia',
    schema_version: 1,
    value_streams: [{ key: 'factory', name: '工厂', perceiver: 'p', order: 1 }],
    capabilities: [
      { key: 'F1', name: 'cap1', value_stream_key: 'factory', order: 1 },
      { key: 'F2', name: 'cap2', value_stream_key: 'factory', order: 2 },
    ],
    boundaries: [],
    crosscut_pool: [],
    shared_prerequisites: { applicable: false, items: [] },
  };
}

// 录制 client：捕获 projector 真实发往事务连接的 SQL/params（DB 驱动接缝，非 mock 相邻模块）
function recordingClient() {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      if (/INSERT INTO map_projection_runs/i.test(sql)) return { rows: [{ id: 'run-new' }] };
      return { rows: [] };
    },
  };
  return { calls, client };
}

describe('投影物化两阶段原子化 [BEHAVIOR]', () => {
  beforeEach(() => { fakeState.runs = []; });

  it('runProjection writes the new run with materializing status', async () => {
    const { calls, client } = recordingClient();
    await runProjection({
      client, manifestId: 'm1', manifestDigest: 'd1', scopeKey: 'cecelia',
      manifest: tinyManifest(), factRevisions: { cecelia: BASE },
    });
    const insertRun = calls.find((c) => /INSERT INTO map_projection_runs/i.test(c.sql));
    expect(insertRun, 'projector 必须 INSERT 一条 run 行').toBeTruthy();
    expect(insertRun.sql).toMatch(/'materializing'/);
    expect(insertRun.sql).not.toMatch(/'building'/);
  });

  it('runProjection materializes all nodes and edges before the active flip', async () => {
    const { calls, client } = recordingClient();
    await runProjection({
      client, manifestId: 'm1', manifestDigest: 'd1', scopeKey: 'cecelia',
      manifest: tinyManifest(), factRevisions: { cecelia: BASE },
    });
    let idxLastMaterialize = -1;
    calls.forEach((c, i) => {
      if (/INSERT INTO map_projection_(nodes|edges)/i.test(c.sql)) idxLastMaterialize = i;
    });
    const idxActiveFlip = calls.findIndex((c) => /UPDATE map_projection_runs SET status = 'active'/i.test(c.sql));
    expect(idxLastMaterialize, '必须真实写入节点/边').toBeGreaterThan(0);
    expect(idxActiveFlip, '必须存在 active 翻转').toBeGreaterThan(-1);
    expect(idxActiveFlip).toBeGreaterThan(idxLastMaterialize);
  });

  it('runProjection supersedes old active and activates new run in one flip', async () => {
    const { calls, client } = recordingClient();
    const { runId } = await runProjection({
      client, manifestId: 'm1', manifestDigest: 'd1', scopeKey: 'cecelia',
      manifest: tinyManifest(), factRevisions: { cecelia: BASE },
    });
    const supersede = calls.find((c) => /UPDATE map_projection_runs SET status = 'superseded'/i.test(c.sql));
    const activate = calls.find((c) => /UPDATE map_projection_runs SET status = 'active'/i.test(c.sql));
    expect(supersede, '必须把旧 active 置 superseded').toBeTruthy();
    expect(activate, '必须把新 run 置 active').toBeTruthy();
    expect(supersede.params).toContain('cecelia');
    expect(activate.params).toContain(runId);
  });

  it('getActiveProjection selects only active runs never materializing residuals', async () => {
    fakeState.runs = [
      { id: 'run-active', scope_key: 'cecelia', status: 'active', fact_revisions: { cecelia: BASE }, created_at: 1 },
      { id: 'run-materializing', scope_key: 'cecelia', status: 'materializing', fact_revisions: { cecelia: BASE }, created_at: 9 },
    ];
    const run = await getActiveProjection('cecelia');
    expect(run).toBeTruthy();
    expect(run.id).toBe('run-active');
    expect(run.status).not.toBe('materializing');
  });

  it('getProjectionForRevision never returns a materializing residual run', async () => {
    fakeState.runs = [
      { id: 'run-superseded', scope_key: 'cecelia', status: 'superseded', fact_revisions: { cecelia: BASE }, created_at: 1 },
      { id: 'run-materializing', scope_key: 'cecelia', status: 'materializing', fact_revisions: { cecelia: BASE }, created_at: 9 },
    ];
    const run = await getProjectionForRevision('cecelia', BASE);
    expect(run).toBeTruthy();
    expect(run.id).toBe('run-superseded');
    expect(run.status).not.toBe('materializing');
  });
});
