/**
 * Self-Check Unit Tests (mock pool — no real DB needed)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runSelfCheck, EXPECTED_SCHEMA_VERSION } from '../selfcheck.js';


function makeMockPool(overrides = {}) {
  const defaults = {
    'SELECT 1': { rows: [{ ok: 1 }] },
    'brain_config_region': { rows: [{ value: 'us' }] },
    'information_schema': { rows: [
      { table_name: 'tasks' },
      { table_name: 'goals' },
      { table_name: 'projects' },
      { table_name: 'working_memory' },
      { table_name: 'cecelia_events' },
      { table_name: 'decision_log' },
      { table_name: 'daily_logs' },
      { table_name: 'cortex_analyses' },
      { table_name: 'suggestions' },
    ]},
    'schema_version': { rows: [{ max_ver: EXPECTED_SCHEMA_VERSION }] },
    'config_fingerprint': { rows: [] }, // first run
    'INSERT': { rows: [] },
  };

  const merged = { ...defaults, ...overrides };

  return {
    query: vi.fn(async (sql, params) => {
      if (sql.includes('SELECT 1')) return merged['SELECT 1'];
      if (sql.includes('brain_config') && sql.includes('region') && !sql.includes('fingerprint') && !sql.includes('INSERT'))
        return merged['brain_config_region'];
      if (sql.includes('information_schema')) return merged['information_schema'];
      if (sql.includes('MAX(version)')) return merged['schema_version'];
      if (sql.includes('config_fingerprint') && sql.includes('SELECT'))
        return merged['config_fingerprint'];
      if (sql.includes('INSERT') || sql.includes('UPDATE'))
        return merged['INSERT'];
      return { rows: [] };
    }),
  };
}

// 桩掉 checkComputeSshReachability 的 execFn，避免单测真实 ssh 到 Tailscale 内网 IP
// （原因见 packages/brain/src/__tests__/selfcheck-ssh-reachability.test.js 的注入点设计）
function mockSshExecFn() {
  return vi.fn().mockResolvedValue({ stdout: 'ok\n', stderr: '' });
}

describe('selfcheck', () => {
  let sshExecFn;

  beforeEach(() => {
    vi.stubEnv('ENV_REGION', 'us');
    vi.stubEnv('DB_HOST', 'localhost');
    vi.stubEnv('DB_PORT', '5432');
    vi.stubEnv('DB_NAME', 'cecelia');
    sshExecFn = mockSshExecFn();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should pass all checks with correct config', async () => {
    const pool = makeMockPool();
    const ok = await runSelfCheck(pool, { envRegion: 'us', sshReachability: { execFn: sshExecFn } });
    expect(ok).toBe(true);
  });

  it('should fail when ENV_REGION is missing', async () => {
    vi.stubEnv('ENV_REGION', '');
    const pool = makeMockPool();
    const ok = await runSelfCheck(pool, { envRegion: '', sshReachability: { execFn: sshExecFn } });
    expect(ok).toBe(false);
  });

  it('should fail when ENV_REGION is invalid', async () => {
    const pool = makeMockPool();
    const ok = await runSelfCheck(pool, { envRegion: 'eu', sshReachability: { execFn: sshExecFn } });
    expect(ok).toBe(false);
  });

  it('should fail when DB connection fails', async () => {
    const pool = makeMockPool({
      'SELECT 1': 'THROW',
    });
    pool.query = vi.fn(async (sql) => {
      if (sql.includes('SELECT 1')) throw new Error('connection refused');
      return { rows: [] };
    });

    const ok = await runSelfCheck(pool, { envRegion: 'us', sshReachability: { execFn: sshExecFn } });
    expect(ok).toBe(false);
  });

  it('should fail when DB region does not match ENV_REGION', async () => {
    const pool = makeMockPool({
      'brain_config_region': { rows: [{ value: 'hk' }] },
    });
    const ok = await runSelfCheck(pool, { envRegion: 'us', sshReachability: { execFn: sshExecFn } });
    expect(ok).toBe(false);
  });

  it('should fail when core tables are missing', async () => {
    const pool = makeMockPool({
      'information_schema': { rows: [
        { table_name: 'tasks' },
        { table_name: 'goals' },
        // missing the rest
      ]},
    });
    const ok = await runSelfCheck(pool, { envRegion: 'us', sshReachability: { execFn: sshExecFn } });
    expect(ok).toBe(false);
  });

  it('should fail when schema version is behind', async () => {
    const pool = makeMockPool({
      'schema_version': { rows: [{ max_ver: '003' }] },
    });
    const ok = await runSelfCheck(pool, { envRegion: 'us', sshReachability: { execFn: sshExecFn } });
    expect(ok).toBe(false);
  });

  it('should pass with fingerprint match', async () => {
    // Compute expected fingerprint
    const crypto = await import('crypto');
    const fp = crypto.createHash('sha256')
      .update('localhost:5432:cecelia:us')
      .digest('hex').slice(0, 16);

    const pool = makeMockPool({
      'config_fingerprint': { rows: [{ value: fp }] },
    });
    const ok = await runSelfCheck(pool, { envRegion: 'us', sshReachability: { execFn: sshExecFn } });
    expect(ok).toBe(true);
  });

  it('should pass (with warning) on fingerprint mismatch', async () => {
    const pool = makeMockPool({
      'config_fingerprint': { rows: [{ value: 'old_fingerprint' }] },
    });
    // Fingerprint mismatch is a warning, not a failure
    const ok = await runSelfCheck(pool, { envRegion: 'us', sshReachability: { execFn: sshExecFn } });
    expect(ok).toBe(true);
  });

  it('should pass when schema_version has dirty non-numeric entries (e.g. date strings)', async () => {
    // Simulate: MAX(version) WHERE version ~ '^[0-9]{1,4}$' returns correct migration number
    // even when dirty entries like '20260305' exist (filtered by regex)
    const pool = makeMockPool();
    const ok = await runSelfCheck(pool, { envRegion: 'us', sshReachability: { execFn: sshExecFn } });
    expect(ok).toBe(true);
  });

  // 314 = executor.js 的 markInitiativeTerminalFailed（harness_initiative 终态标记）
  // 强依赖 tasks.custom_props 列（migration 314）；该列此前不存在，导致 UPDATE
  // 整句在真实 Postgres 报错、被 try/catch 静默吞掉，status/failure_class 从未
  // 真正落库——由 harness-orchestrator-lockdown-smoke.sh 在 real-env-smoke 首次暴露。
  // issue 14d66027 语义：地板只在"代码依赖新 schema"时才 bump。
  // 316（design_docs type 白名单加 battle_report）被 battle-report.js INSERT 直接依赖
  // （旧约束下 type='battle_report' 会被 CHECK 拒），故随 migration 316 推进地板到 316。
  // facts-check 校验地板 <= 最高 migration（316 <= 316 通过）。
  // 317（initiative_runs.tmux_killed_at）被 harness-relay-watchdog 收窗 UPDATE 直接依赖
  // （列不存在则 UPDATE 整句报错被吞，收窗永不生效——与上述 314 事故同类），故推进地板到 317。
  // 322（issues.journey_id）被 warroom.js /line/:id/command 全景图查询直接依赖
  // （列不存在则 SELECT 整句报错被吞，open_issues 恒为空——同类接缝），故推进地板到 322。
  // 323（initiative_runs.ability_id）被 harness-skill-relay.js spawn 时的 INSERT 直接依赖
  // （列不存在则 INSERT 整句报错被吞，ability_id 落行永不生效——同类接缝）。
  // 324（advancement_items.notion_synced_at）被 notion-push-sync.js 的 pushAdvancementItems
  // 去重查询直接依赖（列不存在则 SELECT/UPDATE 整句报错被吞，去重恒不生效），故推进地板到 324。
  // 326（side_effect_dedupe 表）被 lib/dedupe.js claimDedupeKey 的 INSERT..ON CONFLICT 直接依赖
  // （表不存在则 fail-open 降级恒触发，三入口幂等全部失效——同类接缝），故推进地板到 326。
  // 331（learnings 谱系两列 + summary backfill + task_completion 清理）为 T9 学习账本
  // 可靠性依赖（parent_learning_id/verified_effective 列缺失则谱系写入整句报错被吞），故推进地板到 331。
  // 333（areas 去重 + KR1/KR2 metadata.target_abilities 挂载）为 OKR 数据卫生一次性迁移，
  // 推进地板到 333 防止未跑该迁移的旧 DB 误判 KR ability-progress 端点为已生效。
  // 334（golden_paths 表 + 状态机端点 + 保质期 delta job）为 GP1/T1 底座迁移，
  // 推进地板到 334 防止未跑该迁移的旧 DB 误判 golden-paths 路由/gp-shelf-life job 为已生效。
  // 335（golden_path_proposal 加入 tasks_task_type_check）为 GP2/T2 派发链前置，
  // 推进地板到 335 防止未跑该迁移的旧 DB 上圈选建任务被 CHECK 拒。
  // 340（idx_tasks_dedup_lookup 部分索引，供派发前标题判重查询使用）为 P1 6fc3bfe8 刀1底座，
  // 推进地板到 340。
  // 341（zenithjoy 裸表归位 schema，P0 事故修复版：删除 ALTER DATABASE 全局副作用）
  // 342（decisions.source_ref 列，决策溯源链）推进地板到 342。
  // 343（journey_features.guard_ref 列，裸奔 FR 守卫引用）推进地板到 343。
  // 344（journey_features status CHECK 拓宽）推进地板到 344。
  // 345（dev_records.is_canary 列，金丝雀演习标记）推进地板到 345。
  // 346（incidents 表，刀5a 事故归一层）推进地板到 346。
  // 347（design_docs CHECK 约束加 drill_report type，金丝雀演习修复 f97f24dc）推进地板到 347。
  // 348（承诺地图 schema thin 版：四表扩展，MJ5 刀1 容器首刀）推进地板到 348。
  // 349（MJ5 刀1 和解补齐：domain/cell_key/双 partial unique/FK SET NULL/软硬列归一）推进地板到 349。
  // 350（MJ5 刀1：智能客服+首次成功两域承诺地图 seed 数据）推进地板到 350。
  // 351（graph_edges 表，代码依赖图谱）推进地板到 351。
  // 352（features 表更名 brain_modules，澄清语义非产品功能表）推进地板到 352。
  // 353（DROP conversation_captures + conversation_log_cursors，inbox P0 清场，decisions a823206d）推进地板到 353。
  // 390（capture_atoms unique(capture_id,target_type) — F6加厚幂等修复，ed911a7c）推进地板到 390。
  // 392（验收一体两面数据层：AI 四列 + runs.detail + 7 值 status CHECK + per-run check_key unique，
  //      D1／GP 7790f728）推进地板到 392。
  // 393（GP 胶水参数化：golden_paths.base_repo + target_environment 两可空列，task d2567378）
  //      推进地板到 393。
  // 402（immutable Map Manifest versions）推进地板到 402。
  // 403（事实池 source_revision + scanner_version + repo 字段补齐）推进地板到 403。
  // 404（Universal Map projection compatibility placeholder）推进地板到 404。
  // 405（rebuildable Map Projection core）推进地板到 405。
  // 406（Harness attempt account_exhausted callback control class）推进地板到 406。
  // 407（explicit Map repo adapters；406 为 account_exhausted）推进地板到 407。
  // 408/409（Impact Contract + Gap Ledger 强制闭环）推进地板到 409。
  // 410（revision-indexed immutable graph snapshots）推进地板到 410。
  // 411（reviewer-approved SHA 下的冻结合同测试制品）推进地板到 411。
  // 412（approved Harness contract artifact manifests）推进地板到 412。
  // 413（work_routing_receipts production anchor — 补录 PR #4851）推进地板到 413。
  // 414（map_recovery_contracts production anchor — 补录 PR #4851）推进地板到 414。
  // 415（initiative_runs Session Controller ownership: controller_session_id + lease）推进地板到 415。
  it('EXPECTED_SCHEMA_VERSION should be 415', () => {
    expect(EXPECTED_SCHEMA_VERSION).toBe('415');
  });

  it('should pass when DB schema version is ahead of expected (>= check)', async () => {
    const pool = makeMockPool({
      'schema_version': { rows: [{ max_ver: '999' }] },
    });
    const ok = await runSelfCheck(pool, { envRegion: 'us', sshReachability: { execFn: sshExecFn } });
    expect(ok).toBe(true);
  });

  describe('Watchdog RSS Sanity Check', () => {
    it('should log INFO when thresholds are normal', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const pool = makeMockPool();
      await runSelfCheck(pool, {
        envRegion: 'us',
        watchdogThresholds: { total_mem_mb: 16384, rss_kill_mb: 2400 },
        sshReachability: { execFn: sshExecFn },
      });
      const infoLines = logSpy.mock.calls.flat().filter(s => typeof s === 'string' && s.includes('Watchdog RSS Sanity 通过'));
      expect(infoLines.length).toBeGreaterThan(0);
      logSpy.mockRestore();
    });

    it('should warn when total_mem_mb is below minimum', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const pool = makeMockPool();
      await runSelfCheck(pool, {
        envRegion: 'us',
        watchdogThresholds: { total_mem_mb: 256, rss_kill_mb: 89 },
        sshReachability: { execFn: sshExecFn },
      });
      const warnLines = warnSpy.mock.calls.flat().filter(s => typeof s === 'string' && s.includes('total_mem_mb=256'));
      expect(warnLines.length).toBeGreaterThan(0);
      warnSpy.mockRestore();
    });

    it('should warn when rss_kill_mb is below minimum', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const pool = makeMockPool();
      await runSelfCheck(pool, {
        envRegion: 'us',
        watchdogThresholds: { total_mem_mb: 1024, rss_kill_mb: 10 },
        sshReachability: { execFn: sshExecFn },
      });
      const warnLines = warnSpy.mock.calls.flat().filter(s => typeof s === 'string' && s.includes('rss_kill_mb=10'));
      expect(warnLines.length).toBeGreaterThan(0);
      warnSpy.mockRestore();
    });

    it('should not fail overall selfcheck when watchdog thresholds are low', async () => {
      const pool = makeMockPool();
      const ok = await runSelfCheck(pool, {
        envRegion: 'us',
        watchdogThresholds: { total_mem_mb: 128, rss_kill_mb: 5 },
        sshReachability: { execFn: sshExecFn },
      });
      // Watchdog RSS sanity is WARN-only, must not block overall selfcheck result
      expect(ok).toBe(true);
    });
  });
});
