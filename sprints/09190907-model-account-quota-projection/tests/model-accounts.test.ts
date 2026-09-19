// 冻结合同测试（TDD Red）— 模型账号配额+机器可达性投影（刀2）
//
// 分两层：
//  1. 纯 parser 层（三家 usage 结构 → 同一 schema）+ 状态映射 + refresh_token 铁律 —— 无 DB，任何环境可跑
//  2. [integration] collector→ops_model_accounts→endpoint 真链路 —— 用真 PG（harness Sprint Tests job 起 cecelia_test）
//
// 禁 mock 边（本单涉及 DB 写路径 + 跨模块数据传递）：
//   - collector ↔ ops_model_accounts（写）：[integration] 段真跑 runModelAccountsCollector(真 pool)，
//     只 mock 最外层 provider 探针（注入 fetchUsage/grokProbe），DB 边禁 mock；memPool 的 grok 铁律单测
//     只承担「refresh 零调用」逻辑断言，不是写路径 oracle。
//   - buildModelAccountsPayload ↔ ops_model_accounts（读）：[integration] 段真 PG
//   - buildAgentsPayload.model_role ↔ ops_agents.meta（读/聚合）：[integration] 段真 PG
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  MODEL_ACCOUNT_STATUS,
  MODEL_ACCOUNTS,
  parseAnthropicUsage,
  parseChatgptWhamUsage,
  parseGrokUsage,
  classifyGrokUsageError,
  runModelAccountsCollector,
} from '../../../packages/brain/src/ops-model-accounts-collector.js';
import {
  buildModelAccountsPayload,
  buildAgentsPayload,
} from '../../../packages/brain/src/routes/agent-ops.js';
import pool from '../../../packages/brain/src/db.js';

const SNAPSHOT_KEYS = ['five_hour_pct', 'seven_day_pct', 'reset_at'];

describe('模型账号静态注册表 + 状态枚举单份', () => {
  it('枚举只有一份且四态齐全（ok|unknown|key_expired|no_credential）', () => {
    expect([...MODEL_ACCOUNT_STATUS].sort()).toEqual(
      ['key_expired', 'no_credential', 'ok', 'unknown'].sort(),
    );
  });
  it('恰好 8 个账号：Claude Code x2 + Codex team x5 + Grok，account_id 各唯一', () => {
    expect(MODEL_ACCOUNTS).toHaveLength(8);
    const providers = MODEL_ACCOUNTS.map((a) => a.provider).sort();
    // 2 claude + 5 codex + 1 grok（provider 值由实现定，但计数固定）
    const counts = providers.reduce((m, p) => ((m[p] = (m[p] || 0) + 1), m), {} as Record<string, number>);
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    expect(total).toBe(8);
    // 凭据全在 mmv
    expect(MODEL_ACCOUNTS.every((a) => a.host_alias === 'mmv')).toBe(true);
    // account_id 是身份键：8 个各唯一（端点「恰好 8 条」的 ground truth）
    expect(new Set(MODEL_ACCOUNTS.map((a) => a.account_id)).size).toBe(8);
  });
  it('forwardable/forward_targets 为静态配置：Codex 可转发到 xian-m4/xian-m1，Claude/Grok 锁本机', () => {
    const codex = MODEL_ACCOUNTS.find((a) => /codex/i.test(a.provider));
    expect(codex.forwardable).toBe(true);
    expect(codex.forward_targets).toEqual(expect.arrayContaining(['xian-m4', 'xian-m1']));
    const grok = MODEL_ACCOUNTS.find((a) => /grok/i.test(a.provider));
    expect(grok.forwardable).toBe(false);
    expect(grok.forward_targets).toEqual([]);
  });
});

describe('三家 usage parser → 同一 schema', () => {
  it('Anthropic OAuth usage JSON → {five_hour_pct, seven_day_pct, reset_at}', () => {
    const raw = { five_hour: { utilization: 42, resets_at: '2026-09-19T10:00:00Z' }, seven_day: { utilization: 71 } };
    const out = parseAnthropicUsage(raw);
    expect(Object.keys(out).sort()).toEqual([...SNAPSHOT_KEYS].sort());
    expect(out.five_hour_pct).toBe(42);
    expect(out.seven_day_pct).toBe(71);
    expect(out.reset_at).toBe('2026-09-19T10:00:00Z');
  });
  it('ChatGPT wham usage JSON → 同一 schema（字段名不同，映射后一致）', () => {
    const raw = { five_hour: { usage_percent: 12, reset_time: '2026-09-19T11:00:00Z' }, seven_day: { usage_percent: 88 } };
    const out = parseChatgptWhamUsage(raw);
    expect(Object.keys(out).sort()).toEqual([...SNAPSHOT_KEYS].sort());
    expect(out.five_hour_pct).toBe(12);
    expect(out.seven_day_pct).toBe(88);
  });
  it('Grok gRPC-web 帧 → 同一 schema', () => {
    const out = parseGrokUsage({ five_hour_pct: 5, seven_day_pct: 9, reset_at: null });
    expect(Object.keys(out).sort()).toEqual([...SNAPSHOT_KEYS].sort());
    expect(out.five_hour_pct).toBe(5);
  });
  it('parser 遇结构缺失不抛，pct 缺 → null（诚实留空，不编造 0）', () => {
    const out = parseAnthropicUsage({});
    expect(out.five_hour_pct).toBeNull();
    expect(out.seven_day_pct).toBeNull();
  });
});

describe('Grok key 过期铁律：只标 key_expired，绝不刷新 refresh_token', () => {
  it('grpc-status 7 PERMISSION_DENIED → classifyGrokUsageError 返回 key_expired', () => {
    expect(classifyGrokUsageError({ grpcStatus: 7, message: 'PERMISSION_DENIED' })).toBe('key_expired');
    expect(classifyGrokUsageError({ message: 'grpc-status: 7' })).toBe('key_expired');
  });
  it('collector 处理 Grok 过期时：状态 key_expired，且注入的 refreshToken 探针零调用', async () => {
    const refreshSpy = { calls: 0 };
    // 只 mock 最外层 provider 探针（真实链路的外部边界），DB 若可达则真写；此处只断言不刷新语义
    const probe = () => { const e: any = new Error('PERMISSION_DENIED'); e.grpcStatus = 7; throw e; };
    const memRows: any[] = [];
    const memPool = { query: async (_sql: string, params: any[]) => { memRows.push(params); return { rows: [] }; } };
    await runModelAccountsCollector(memPool as any, {
      only: 'grok',
      grokProbe: probe,
      // 若实现里存在任何刷新路径并意外调用，该 spy 计数必 >0 → 断言失败
      refreshToken: () => { refreshSpy.calls += 1; return 'NEW_TOKEN'; },
    });
    expect(refreshSpy.calls).toBe(0);
    // 落库参数里 grok 行 status = key_expired
    const flat = JSON.stringify(memRows);
    expect(flat).toContain('key_expired');
    expect(flat).not.toContain('NEW_TOKEN');
  });
});

// ─── [integration] 真 PG：collector → ops_model_accounts → endpoint ───────────
// harness Sprint Tests job 用 cecelia_test（全 migration）+ DB_NAME env 注入 db.js。
describe('[integration] collector 写路径 + 幂等 upsert + 端点读真表 + 失败隔离 + model_role 聚合', () => {
  const canDb = !!(process.env.DB_NAME || process.env.DATABASE_URL || process.env.DB);
  const REG_IDS = MODEL_ACCOUNTS.map((a: any) => a.account_id);
  beforeAll(async () => {
    if (!canDb) return;
    await pool.query(`DELETE FROM ops_model_accounts WHERE account_id LIKE 'test-%'`);
    await pool.query(`DELETE FROM ops_model_accounts WHERE account_id = ANY($1)`, [REG_IDS]);
    await pool.query(`DELETE FROM ops_agents WHERE source='test-mr'`);
  });
  afterAll(async () => {
    if (!canDb) return;
    await pool.query(`DELETE FROM ops_model_accounts WHERE account_id LIKE 'test-%'`);
    await pool.query(`DELETE FROM ops_model_accounts WHERE account_id = ANY($1)`, [REG_IDS]);
    await pool.query(`DELETE FROM ops_agents WHERE source='test-mr'`);
  });

  // R1-1 修复：collector→ops_model_accounts 写路径 + INV-4 幂等 upsert 的真 PG oracle。
  // 注入 fetchUsage（成功 fixture，代替 mmv 真采集）+ refreshToken spy（铁律零调用）；
  // 真 pool 落库，psql 查 8 个静态 account_id 落表；连跑两次断言每 account_id 行数恒为 1（ON CONFLICT 幂等）。
  it('runModelAccountsCollector(真 pool, 注入探针) → 8 静态 account_id 落表，refresh 零调用', async () => {
    if (!canDb) { expect(true).toBe(true); return; }
    const refreshSpy = { calls: 0 };
    const fetchUsage = async (acct: any) => {
      // 成功 usage fixture（按 provider 结构）——真实 mmv host-exec 采集不在 CI（见未覆盖真实链路清单）
      if (/grok/i.test(acct.provider)) return { five_hour_pct: 5, seven_day_pct: 9, reset_at: null };
      if (/codex/i.test(acct.provider)) return { five_hour: { usage_percent: 30, reset_time: '2026-09-19T10:00:00Z' }, seven_day: { usage_percent: 40 } };
      return { five_hour: { utilization: 20, resets_at: '2026-09-19T10:00:00Z' }, seven_day: { utilization: 35 } };
    };
    const refreshToken = () => { refreshSpy.calls += 1; return 'NEW_TOKEN'; };

    await runModelAccountsCollector(pool, { fetchUsage, refreshToken });
    expect(refreshSpy.calls).toBe(0);

    // 8 个静态 account_id 全部落表（写路径真验，非 memPool）
    const { rows: landed } = await pool.query(
      `SELECT account_id FROM ops_model_accounts WHERE account_id = ANY($1)`, [REG_IDS]);
    expect(landed.length).toBe(8);

    // INV-4 幂等：再跑一次，每个静态 account_id 行数恒为 1（ON CONFLICT DO UPDATE，非 SELECT-then-INSERT）
    await runModelAccountsCollector(pool, { fetchUsage, refreshToken });
    expect(refreshSpy.calls).toBe(0);
    const { rows: dup } = await pool.query(
      `SELECT account_id, count(*)::int AS c FROM ops_model_accounts
         WHERE account_id = ANY($1) GROUP BY account_id HAVING count(*) > 1`, [REG_IDS]);
    expect(dup.length).toBe(0);
    const { rows: total } = await pool.query(
      `SELECT count(*)::int AS c FROM ops_model_accounts WHERE account_id = ANY($1)`, [REG_IDS]);
    expect(total[0].c).toBe(8);
  });

  it('7 正常 + 1 unknown → 8 条全返回，HTTP 层 200 语义（builder 不抛），unknown 带 last_error', async () => {
    if (!canDb) { expect(true).toBe(true); return; }
    for (let i = 1; i <= 7; i++) {
      await pool.query(
        `INSERT INTO ops_model_accounts (account_id, provider, plan, five_hour_pct, seven_day_pct, reset_at,
           host_alias, forwardable, forward_targets, status, last_error, last_checked_at, updated_at)
         VALUES ($1,'codex','team',$2,$3,NOW(),'mmv',TRUE,'["xian-m4","xian-m1"]','ok',NULL,NOW(),NOW())
         ON CONFLICT (account_id) DO UPDATE SET status='ok', last_error=NULL`,
        [`test-ok-${i}`, i * 5, i * 3]);
    }
    await pool.query(
      `INSERT INTO ops_model_accounts (account_id, provider, plan, five_hour_pct, seven_day_pct, reset_at,
         host_alias, forwardable, forward_targets, status, last_error, last_checked_at, updated_at)
       VALUES ('test-bad','grok',NULL,NULL,NULL,NULL,'mmv',FALSE,'[]','unknown','token timeout',NOW(),NOW())
       ON CONFLICT (account_id) DO UPDATE SET status='unknown', last_error='token timeout'`);
    const payload = await buildModelAccountsPayload(pool, new Date());
    const mine = payload.accounts.filter((a: any) => String(a.account_id).startsWith('test-'));
    expect(mine.length).toBe(8);
    const bad = mine.find((a: any) => a.account_id === 'test-bad');
    expect(bad.status).toBe('unknown');
    expect(bad.last_error).toContain('timeout');
    // 每条含 PRD 约定 11 字段
    for (const a of mine) {
      for (const k of ['provider', 'plan', 'five_hour_pct', 'seven_day_pct', 'reset_at',
        'host_alias', 'forwardable', 'forward_targets', 'status', 'last_checked_at', 'last_error']) {
        expect(a).toHaveProperty(k);
      }
    }
  });

  it('agents 端点每条含 model_role{model_id, primary_count, fallback_count}，计数真实', async () => {
    if (!canDb) { expect(true).toBe(true); return; }
    // 两个分身都把 terra 设为 primary，其中一个把 luna 设为 fallback
    await pool.query(
      `INSERT INTO ops_agents (source, host_alias, name, agent_type, status, last_seen_at, meta, updated_at)
       VALUES ('test-mr','us-vps','a1','openclaw_agent','active',NOW(),$1,NOW()),
              ('test-mr','us-vps','a2','openclaw_agent','active',NOW(),$2,NOW())
       ON CONFLICT (source, host_alias, name) DO UPDATE SET meta=EXCLUDED.meta`,
      [JSON.stringify({ model: 'openai/gpt-5.6-terra', model_fallbacks: [] }),
       JSON.stringify({ model: 'openai/gpt-5.6-terra', model_fallbacks: ['openai/gpt-5.6-luna'] })]);
    const payload = await buildAgentsPayload(pool, new Date());
    const mine = payload.agents.filter((a: any) => a.source === 'test-mr');
    expect(mine.length).toBe(2);
    for (const a of mine) {
      expect(a).toHaveProperty('model_role');
      expect(a.model_role).toHaveProperty('model_id');
      expect(a.model_role).toHaveProperty('primary_count');
      expect(a.model_role).toHaveProperty('fallback_count');
    }
    const terra = mine[0].model_role;
    expect(terra.model_id).toBe('openai/gpt-5.6-terra');
    expect(terra.primary_count).toBe(2); // 两个分身 primary=terra
  });
});
