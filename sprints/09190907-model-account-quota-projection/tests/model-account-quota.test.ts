// 冻结合同测试（TDD Red）— 模型账号配额+机器可达性投影（工厂·F5 指挥舱 刀2）
//
// 运行环境：本 attempt runtime postgres:false（Fleet 不注入 DB），因此本文件全部为
//   「纯函数 + capturing 假 pool」测试，沿用刀1 agent-ops.test.js / ops-collector.test.js
//   同款 idiom（poolReturning 只读投影、fakePool 捕获 SQL），从仓库根 vitest 即可跑，无需 Postgres。
// 真 PG 落库端到端 + 三家 usage API 真实字段对齐：见 contract-draft.md「未覆盖真实链路清单」
//   （logic-done-pending 接缝，由 CI + generator 首次真跑校准覆盖）。
import { describe, it, expect } from 'vitest';
import {
  parseAnthropicUsage,
  parseChatgptWhamUsage,
  parseGrokUsage,
  classifyAccountStatus,
  collectAccountSnapshots,
  writeModelAccountsSnapshot,
  MODEL_ACCOUNTS,
} from '../../../packages/brain/src/ops-model-accounts-collector.js';
import { buildModelAccountsPayload, attachModelRoles } from '../../../packages/brain/src/routes/agent-ops.js';
import { extractOpenclawAgents } from '../../../packages/brain/src/ops-collector.js';
import { buildOpsUnitNotionProperties } from '../../../packages/brain/src/notion-push-sync.js';

// 只读投影假 pool（与 agent-ops.test.js 同款）：按 SQL 子串匹配返回 rows。
function poolReturning(rowsBySql) {
  return { query: async (sql) => {
    for (const [key, rows] of Object.entries(rowsBySql)) if (sql.includes(key)) return { rows };
    return { rows: [] };
  } };
}
// 捕获式假 pool（与 ops-collector.test.js 同款）：记录每条 INSERT/UPDATE 的 SQL 与 params。
function capturingPool() {
  const queries = [];
  return { queries, query: async (sql, params) => { queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params }); return { rows: [] }; } };
}

// ─── 三家 provider parser（纯函数，输入形状为 [NEW_PATTERN] 代表性 fixture）───
describe('parseAnthropicUsage', () => {
  it('映射 5h/7d 利用率到 pct 且 reset_at 归一 ISO', () => {
    const out = parseAnthropicUsage({ five_hour: { utilization: 0.42, resets_at: '2026-09-19T10:00:00Z' }, seven_day: { utilization: 0.6 } });
    expect(out.five_hour_pct).toBe(42);
    expect(out.seven_day_pct).toBe(60);
    expect(out.reset_at).toBe('2026-09-19T10:00:00.000Z');
  });
  it('缺字段返回 null 不抛（诚实留空禁编造）', () => {
    const out = parseAnthropicUsage({});
    expect(out.five_hour_pct).toBeNull();
    expect(out.seven_day_pct).toBeNull();
    expect(out.reset_at).toBeNull();
  });
});

describe('parseChatgptWhamUsage', () => {
  it('映射 wham 用量到统一 pct schema', () => {
    const out = parseChatgptWhamUsage({ five_hour: { usage_percent: 55 }, seven_day: { usage_percent: 70 }, reset_time: '2026-09-19T12:00:00Z' });
    expect(out.five_hour_pct).toBe(55);
    expect(out.seven_day_pct).toBe(70);
    expect(out.reset_at).toBe('2026-09-19T12:00:00.000Z');
  });
  it('pct 超界 clamp 到 0-100', () => {
    const out = parseChatgptWhamUsage({ five_hour: { usage_percent: 140 }, seven_day: { usage_percent: -5 } });
    expect(out.five_hour_pct).toBe(100);
    expect(out.seven_day_pct).toBe(0);
  });
});

describe('parseGrokUsage', () => {
  it('正常帧解出 pct', () => {
    const out = parseGrokUsage({ ok: true, five_hour_pct: 33, seven_day_pct: 48, reset_at: '2026-09-19T09:00:00Z' });
    expect(out.five_hour_pct).toBe(33);
    expect(out.seven_day_pct).toBe(48);
    expect(out.status).not.toBe('key_expired');
  });
  it('PERMISSION_DENIED(grpc-status 7) → key_expired 且解析纯函数无 refresh 副作用', () => {
    const out = parseGrokUsage({ grpc_status: 7, message: 'PERMISSION_DENIED' });
    expect(out.status).toBe('key_expired');
    // 纯函数不接受、不返回任何 refresh 动作字段（铁律：绝不触碰 refresh_token）
    expect(out).not.toHaveProperty('refresh_token');
    expect(out).not.toHaveProperty('refresh_action');
  });
});

// ─── 逐账号状态判定（对模糊现实的判断，登记表见 contract-draft.md）───
describe('classifyAccountStatus', () => {
  it('token 过期/超时 → unknown + last_error（不阻塞整体）', () => {
    const r = classifyAccountStatus({ error: new Error('request timed out') });
    expect(r.status).toBe('unknown');
    expect(r.last_error).toContain('timed out');
  });
  it('凭据文件缺失/损坏 → no_credential', () => {
    const r = classifyAccountStatus({ error: new Error('ENOENT: auth.json not found') });
    expect(r.status).toBe('no_credential');
  });
  it('grok PERMISSION_DENIED → key_expired', () => {
    const r = classifyAccountStatus({ providerStatus: 'key_expired' });
    expect(r.status).toBe('key_expired');
  });
  it('正常 → ok', () => {
    const r = classifyAccountStatus({ providerStatus: 'ok' });
    expect(r.status).toBe('ok');
  });
});

// ─── 静态账号配置（8 条 + forwardable 静态）───
describe('MODEL_ACCOUNTS 静态配置', () => {
  it('恰好 8 个账号：Claude account1/2、Codex team1-5、Grok', () => {
    expect(MODEL_ACCOUNTS).toHaveLength(8);
    const providers = MODEL_ACCOUNTS.map((a) => a.provider).sort();
    expect(providers.filter((p) => p === 'claude')).toHaveLength(2);
    expect(providers.filter((p) => p === 'codex')).toHaveLength(5);
    expect(providers.filter((p) => p === 'grok')).toHaveLength(1);
  });
  it('forwardable 为静态字段：Codex 可转发，Claude/Grok 锁本机', () => {
    const codex = MODEL_ACCOUNTS.find((a) => a.provider === 'codex');
    const grok = MODEL_ACCOUNTS.find((a) => a.provider === 'grok');
    expect(codex.forwardable).toBe(true);
    expect(grok.forwardable).toBe(false);
  });
});

// ─── 采集隔离核心（纯函数，parser↔collector 边不 mock，仅注入最外层 fetch 替身）───
describe('collectAccountSnapshots 逐账号失败隔离', () => {
  const now = new Date('2026-09-19T08:00:00Z');
  const accounts = [
    { provider: 'claude', account_key: 'account1', plan: 'max', host_alias: 'mmv', forwardable: false, forward_targets: [] },
    { provider: 'claude', account_key: 'account2', plan: 'max', host_alias: 'mmv', forwardable: false, forward_targets: [] },
  ];
  it('单账号 fetch 抛错 → 该条 status=unknown+last_error，其余账号正常返回', async () => {
    const fetchUsage = async (acc) => {
      if (acc.account_key === 'account2') throw new Error('request timed out');
      return { five_hour_pct: 20, seven_day_pct: 30, reset_at: '2026-09-19T10:00:00Z', status: 'ok' };
    };
    const snaps = await collectAccountSnapshots(accounts, fetchUsage, now);
    expect(snaps).toHaveLength(2);
    const a1 = snaps.find((s) => s.account_key === 'account1');
    const a2 = snaps.find((s) => s.account_key === 'account2');
    expect(a1.status).toBe('ok');
    expect(a1.five_hour_pct).toBe(20);
    expect(a2.status).toBe('unknown');
    expect(a2.last_error).toContain('timed out');
  });
  it('每条快照字段齐全（含 provider/plan/host_alias/forwardable/last_checked_at）', async () => {
    const fetchUsage = async () => ({ five_hour_pct: 10, seven_day_pct: 15, reset_at: null, status: 'ok' });
    const snaps = await collectAccountSnapshots(accounts, fetchUsage, now);
    for (const s of snaps) {
      for (const k of ['provider', 'plan', 'host_alias', 'forwardable', 'five_hour_pct', 'seven_day_pct', 'status', 'last_checked_at']) {
        expect(s).toHaveProperty(k);
      }
      expect(s.last_checked_at).toBe(now.toISOString());
    }
  });
});

// ─── DB 写边（capturing pool 断言真实 upsert SQL 与逐账号参数）───
describe('writeModelAccountsSnapshot upsert 落库', () => {
  it('对每个账号发 INSERT INTO ops_model_accounts ... ON CONFLICT 幂等 upsert', async () => {
    const pool = capturingPool();
    const snaps = [
      { provider: 'claude', account_key: 'account1', plan: 'max', host_alias: 'mmv', forwardable: false, forward_targets: [], five_hour_pct: 20, seven_day_pct: 30, reset_at: null, status: 'ok', last_error: null, last_checked_at: '2026-09-19T08:00:00.000Z' },
      { provider: 'grok', account_key: 'grok', plan: 'unknown', host_alias: 'mmv', forwardable: false, forward_targets: [], five_hour_pct: null, seven_day_pct: null, reset_at: null, status: 'key_expired', last_error: 'PERMISSION_DENIED', last_checked_at: '2026-09-19T08:00:00.000Z' },
    ];
    await writeModelAccountsSnapshot(pool, snaps);
    const inserts = pool.queries.filter((q) => q.sql.includes('INSERT INTO ops_model_accounts'));
    expect(inserts).toHaveLength(2);
    expect(inserts.every((q) => q.sql.includes('ON CONFLICT'))).toBe(true);
    const grokRow = inserts.find((q) => q.params?.includes('key_expired'));
    expect(grokRow).toBeTruthy();
  });
});

// ─── 只读投影端点 buildModelAccountsPayload ───
describe('buildModelAccountsPayload 只读投影', () => {
  const now = new Date('2026-09-19T12:00:00Z');
  function eightRows() {
    const base = (provider, key, status) => ({ provider, account_key: key, plan: 'max', five_hour_pct: 20, seven_day_pct: 30, reset_at: null, host_alias: 'mmv', forwardable: provider === 'codex', forward_targets: provider === 'codex' ? ['xian-m4', 'xian-m1'] : [], status, last_error: status === 'ok' ? null : 'boom', last_checked_at: now.toISOString() });
    return [
      base('claude', 'account1', 'ok'), base('claude', 'account2', 'unknown'),
      base('codex', 'team1', 'ok'), base('codex', 'team2', 'ok'), base('codex', 'team3', 'ok'),
      base('codex', 'team4', 'ok'), base('codex', 'team5', 'no_credential'), base('grok', 'grok', 'key_expired'),
    ];
  }
  it('返回全部 8 条且每条字段齐全（provider/plan/five_hour_pct/seven_day_pct/reset_at/host_alias/forwardable/forward_targets/status/last_checked_at/last_error）', async () => {
    const p = await buildModelAccountsPayload(poolReturning({ 'FROM ops_model_accounts': eightRows() }), now);
    expect(p.accounts).toHaveLength(8);
    for (const a of p.accounts) {
      for (const k of ['provider', 'plan', 'five_hour_pct', 'seven_day_pct', 'reset_at', 'host_alias', 'forwardable', 'forward_targets', 'status', 'last_checked_at', 'last_error']) {
        expect(a).toHaveProperty(k);
      }
    }
    expect(p.server_now).toBe(now.toISOString());
  });
  it('单账号 status=unknown/key_expired/no_credential 不影响其余，端点不整体抛错（HTTP 200 语义）', async () => {
    const p = await buildModelAccountsPayload(poolReturning({ 'FROM ops_model_accounts': eightRows() }), now);
    expect(p.accounts.filter((a) => a.status === 'ok')).toHaveLength(5);
    expect(p.accounts.find((a) => a.account_key === 'account2').status).toBe('unknown');
    expect(p.accounts.find((a) => a.account_key === 'grok').status).toBe('key_expired');
    expect(p.accounts.find((a) => a.account_key === 'team5').status).toBe('no_credential');
  });
  it('表缺失 42P01 → migration_pending（禁 200 空数组）', async () => {
    const bad = { query: async () => { const e = new Error('relation "ops_model_accounts" does not exist'); e.code = '42P01'; throw e; } };
    await expect(buildModelAccountsPayload(bad, now)).rejects.toMatchObject({ reason_code: 'migration_pending' });
  });
});

// ─── agents 端点追加 model_role（原始 model id + 真实 primary/fallback 计数，不造分层标签）───
describe('attachModelRoles', () => {
  const agents = [
    { name: 'a', meta: { model: 'openai/gpt-5.6-terra', model_fallbacks: ['x-ai/grok-luna'] } },
    { name: 'b', meta: { model: 'openai/gpt-5.6-terra', model_fallbacks: [] } },
    { name: 'c', meta: { model: 'x-ai/grok-luna', model_fallbacks: ['openai/gpt-5.6-terra'] } },
  ];
  it('每条 agent 追加 model_role：原始 model id + 该 model 全局 primary/fallback 真实计数', () => {
    const out = attachModelRoles(agents);
    const a = out.find((x) => x.name === 'a');
    expect(a.model_role.model).toBe('openai/gpt-5.6-terra');
    // terra 被 a、b 设为 primary（2），被 c 设为 fallback（1）
    expect(a.model_role.primary_count).toBe(2);
    expect(a.model_role.fallback_count).toBe(1);
    const c = out.find((x) => x.name === 'c');
    expect(c.model_role.model).toBe('x-ai/grok-luna');
    expect(c.model_role.primary_count).toBe(1);
    expect(c.model_role.fallback_count).toBe(1);
  });
  it('不造分层标签：model_role 只有 model/primary_count/fallback_count，无 tier/level/layer 字段', () => {
    const out = attachModelRoles(agents);
    for (const x of out) {
      expect(Object.keys(x.model_role).sort()).toEqual(['fallback_count', 'model', 'primary_count']);
    }
  });
});

// ─── collector 捕获 model_fallbacks（供 model_role 统计）───
describe('extractOpenclawAgents 捕获 model_fallbacks', () => {
  it('model={primary,fallbacks} → meta.model=primary 且 meta.model_fallbacks=fallbacks', () => {
    const cfg = { agents: { entries: { main: { model: { primary: 'openai/gpt-5.6-terra', fallbacks: ['x-ai/grok-luna', 'anthropic/claude'] }, apiKey: 'SECRET' } } } };
    const rows = extractOpenclawAgents(cfg);
    expect(rows[0].meta.model).toBe('openai/gpt-5.6-terra');
    expect(rows[0].meta.model_fallbacks).toEqual(['x-ai/grok-luna', 'anthropic/claude']);
    expect(JSON.stringify(rows)).not.toContain('SECRET'); // 凭据白名单铁律不回退
  });
  it('model 为纯字符串 → meta.model_fallbacks=[]（无 fallback 不报错）', () => {
    const cfg = { agents: { entries: { solo: { model: 'openai/gpt-5.6-terra' } } } };
    const rows = extractOpenclawAgents(cfg);
    expect(rows[0].meta.model).toBe('openai/gpt-5.6-terra');
    expect(rows[0].meta.model_fallbacks).toEqual([]);
  });
});

// ─── Notion「Agents&机器」库配额列（token-free 纯函数 oracle — PRD Golden Path 第4条 / R1-1）───
// PRD 要求「Notion『Agents&机器』库对应行出现 5h%/7d%/更新时间列，随现有 notion-push-sync 推送」。
// 真 Notion API 推送依赖 token（logic-done-pending，见 contract-draft 未覆盖真实链路清单），
// 但列的产出逻辑由 buildOpsUnitNotionProperties(notion-push-sync.js:1122) 纯函数承担，可 token-free 单测。
// 契约固定三个 Notion 属性名：Quota5h(number)/Quota7d(number)/QuotaUpdatedAt(date)——generator 须字面产出。
describe('buildOpsUnitNotionProperties 配额列（Notion「Agents&机器」5h%/7d%/更新时间）', () => {
  it('含配额的运行单元行产出 5h%/7d%/更新时间三个 Notion 属性', () => {
    const props = buildOpsUnitNotionProperties({
      name: 'openclaw-main', source: 'openclaw', host_alias: 'mmv', status: 'active', role: 'solo',
      five_hour_pct: 42, seven_day_pct: 60, last_checked_at: '2026-09-19T08:00:00.000Z',
    });
    expect(props.Quota5h).toEqual({ number: 42 });
    expect(props.Quota7d).toEqual({ number: 60 });
    expect(props.QuotaUpdatedAt).toEqual({ date: { start: '2026-09-19T08:00:00.000Z' } });
  });
  it('无配额数据的行不产出这三列（缺省/空，不误填 0）', () => {
    const props = buildOpsUnitNotionProperties({
      name: 'no-quota-agent', source: 'openclaw', host_alias: 'xian-m4', status: 'active', role: 'solo',
    });
    expect(props).not.toHaveProperty('Quota5h');
    expect(props).not.toHaveProperty('Quota7d');
    expect(props).not.toHaveProperty('QuotaUpdatedAt');
  });
  it('部分配额（仅 five_hour_pct 有值）只产出已知列，缺的列不误填', () => {
    const props = buildOpsUnitNotionProperties({
      name: 'partial', source: 'openclaw', host_alias: 'mmv', status: 'active', role: 'solo',
      five_hour_pct: 15, seven_day_pct: null, last_checked_at: null,
    });
    expect(props.Quota5h).toEqual({ number: 15 });
    expect(props).not.toHaveProperty('Quota7d');
    expect(props).not.toHaveProperty('QuotaUpdatedAt');
  });
});
