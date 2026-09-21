import { describe, it, expect, beforeEach } from 'vitest';
import { runOpsCollector, __resetOpsCollectorForTest, OPENCLAW_CONFIG_CMD, OPENCLAW_CRON_CMD } from '../ops-collector.js';

function fakePool() {
  const queries = [];
  return {
    queries,
    query: async (sql, params) => { queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params }); return { rows: [] }; },
  };
}
const LIST_OK = 'PID\tStatus\tLabel\n-\t0\tcom.cecelia.backup-db';
const PLIST_OK = '== /L/a.plist\n{"Label":"com.cecelia.backup-db","StartInterval":300}';
const CLAW_OK = JSON.stringify({ agents: { entries: { main: {}, dev: {} } } });

function fakeExec(map) {
  const calls = [];
  const fn = (cmd) => {
    calls.push(cmd);
    for (const [key, val] of Object.entries(map)) {
      if (cmd.includes(key)) {
        if (val instanceof Error) throw val;
        return val;
      }
    }
    return '';
  };
  fn.calls = calls;
  return fn;
}

beforeEach(() => __resetOpsCollectorForTest());

describe('runOpsCollector', () => {
  it('OpenClaw 命令写死配置路径（禁 find/通配）', () => {
    expect(OPENCLAW_CONFIG_CMD).toContain('.openclaw/clawdbot.json');
    expect(OPENCLAW_CONFIG_CMD).not.toContain('find');
  });

  // ⚠️ 这条断言在 0921 被换过一次，换的理由本身就是教训：
  // 原断言是「不许含 ssh」——它固化的是**上一次迁移的落点**（hk-vps→us-vps 后
  // 改成本机 docker exec）。结果 0920 再迁 MMV，同一行又坏一次，而这条测试全绿
  // 放行了，因为它守的是"用哪种取数方式"，不是"落点会不会写死"。
  //
  // 现在守的是耐用的那条：**落点不许写死，必须走 ssh 别名**。迁移时只改
  // us-vps 的 ~/.ssh/config，代码一行不动。
  it('OpenClaw 取数走 ssh 别名，不写死主机/IP/容器名', async () => {
    for (const cmd of [OPENCLAW_CONFIG_CMD, OPENCLAW_CRON_CMD]) {
      expect(cmd).toMatch(/\bmmv\b/);                       // 走别名
      expect(cmd).not.toContain('docker exec');             // 不绑某台机的容器
      expect(cmd).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/); // 不写死 IP
      expect(cmd).not.toMatch(/\b(hk-vps|us-vps)\b/);       // 不写死历史落点
    }
    const pool = fakePool();
    const exec = fakeExec({ 'launchctl list': LIST_OK, 'plutil': PLIST_OK, 'clawdbot.json': CLAW_OK, 'workflows': '', 'readlink': '/var/db/timezone/zoneinfo/America/Los_Angeles' });
    const r = await runOpsCollector(pool, { exec, inContainer: false, now: Date.now() });
    expect(r.results.openclaw.ok).toBe(true);
    const agentWrites = pool.queries.filter((q) => q.sql.includes('INSERT INTO ops_agents') && q.params?.[0] === 'openclaw');
    expect(agentWrites.length).toBeGreaterThan(0);
    for (const q of agentWrites) expect(q.params[1]).toBe('mmv');
    const hb = pool.queries.filter((q) => q.sql.includes('ops_source_heartbeats') && q.params?.[0] === 'openclaw');
    expect(hb.length).toBeGreaterThan(0);
    for (const q of hb) expect(q.params[1]).toBe('mmv');
  });

  // 端到端：光有 parseOpenclawCrons 的单测不够——把 writeSchedulesSnapshot 那一行
  // 整个删掉时，纯函数测试照样全绿（0921 变异实测）。这条守的是「采集器真的把
  // cron 写进了台账」，而不只是「解析器会解析」。
  it('OpenClaw cron 真的落进 ops_schedule_entries（source=openclaw, host=mmv）', async () => {
    const CRON_OK = JSON.stringify({
      jobs: [
        { id: 'c1', name: 'OPC 下钻式晨报', enabled: true,
          schedule: { kind: 'cron', expr: '25 6 * * 1-5', tz: 'Asia/Shanghai' },
          lastRunStatus: 'error', state: { nextRunAtMs: 1789999999000 } },
        { id: 'c2', name: '悦升云端增长情报日报', enabled: true,
          schedule: { kind: 'cron', expr: '30 7 * * *', tz: 'Asia/Shanghai' },
          lastRunStatus: 'ok', state: {} },
      ],
    });
    const pool = fakePool();
    const exec = fakeExec({
      'launchctl list': LIST_OK, plutil: PLIST_OK, 'clawdbot.json': CLAW_OK,
      'cron list --all --json': CRON_OK, workflows: '',
      readlink: '/var/db/timezone/zoneinfo/America/Los_Angeles',
    });
    const r = await runOpsCollector(pool, { exec, inContainer: false, now: Date.now() });

    const schedWrites = pool.queries.filter(
      (q) => q.sql.includes('INSERT INTO ops_schedule_entries') && q.params?.[0] === 'openclaw',
    );
    expect(schedWrites.length).toBe(2);
    for (const q of schedWrites) expect(q.params[1]).toBe('mmv');
    const labels = schedWrites.map((q) => q.params[2]);
    expect(labels).toContain('OPC 下钻式晨报');
    expect(labels).toContain('悦升云端增长情报日报');
    const brief = schedWrites.find((q) => q.params[2] === 'OPC 下钻式晨报');
    expect(brief.params[3]).toBe('openclaw_cron');          // kind
    expect(brief.params[4]).toContain('25 6 * * 1-5');      // schedule_desc
    expect(brief.params[6]).toBe('error');                  // last_state
    expect(r.results.openclaw_crons).toMatchObject({ ok: true, schedules: 2 });
  });

  it('cron 取数失败不拖垮同腿的 agents（独立 try）', async () => {
    const pool = fakePool();
    const exec = fakeExec({
      'launchctl list': LIST_OK, plutil: PLIST_OK, 'clawdbot.json': CLAW_OK,
      'cron list --all --json': 'not json at all', workflows: '',
      readlink: '/var/db/timezone/zoneinfo/America/Los_Angeles',
    });
    const r = await runOpsCollector(pool, { exec, inContainer: false, now: Date.now() });
    expect(r.results.openclaw.ok).toBe(true);               // agents 仍成功
    expect(r.results.openclaw_crons.ok).toBe(false);        // cron 单独失败并留痕
    expect(r.results.openclaw_crons.error).toContain('parse_error');
  });

  it('全部成功：三路各写快照+心跳 ok', async () => {
    const pool = fakePool();
    const exec = fakeExec({ 'launchctl list': LIST_OK, 'plutil': PLIST_OK, 'clawdbot.json': CLAW_OK, 'workflows': '', 'readlink': '/var/db/timezone/zoneinfo/America/Los_Angeles' });
    const r = await runOpsCollector(pool, { exec, inContainer: false, now: Date.now() });
    expect(r.results.launchd.ok).toBe(true);
    expect(r.results.openclaw.ok).toBe(true);
    const hb = pool.queries.filter((q) => q.sql.includes('ops_source_heartbeats'));
    expect(hb.some((q) => q.params?.includes('openclaw'))).toBe(true);
    expect(pool.queries.some((q) => q.sql.includes('ON CONFLICT (source, host_alias, name)'))).toBe(true);
  });

  it('ssh hk 腿断：openclaw 心跳 unreachable+last_error 双写，launchd 照常 ok（per-source 隔离）', async () => {
    const pool = fakePool();
    const exec = fakeExec({ 'launchctl list': LIST_OK, 'plutil': PLIST_OK, 'clawdbot.json': new Error('ssh: connect timeout'), 'readlink': 'zoneinfo/America/Los_Angeles' });
    const r = await runOpsCollector(pool, { exec, inContainer: false, now: Date.now() });
    expect(r.results.launchd.ok).toBe(true);
    expect(r.results.openclaw.ok).toBe(false);
    const hb = pool.queries.find((q) => q.sql.includes('ops_source_heartbeats') && q.params?.includes('unreachable'));
    expect(hb).toBeTruthy();
    expect(hb.params.join('|')).toContain('connect timeout');
  });

  it('launchctl 解析出 0 行 = parse_error 不是空快照', async () => {
    const pool = fakePool();
    const exec = fakeExec({ 'launchctl list': 'PID\tStatus\tLabel\n', 'clawdbot.json': CLAW_OK });
    const r = await runOpsCollector(pool, { exec, inContainer: false, now: Date.now() });
    expect(r.results.launchd.ok).toBe(false);
    expect(pool.queries.some((q) => q.params?.includes('parse_error'))).toBe(true);
    expect(pool.queries.some((q) => q.sql.includes('INSERT INTO ops_agents') && q.params?.includes('launchd'))).toBe(false);
  });

  it('clawdbot JSON 半写入：整份丢弃走 parse_error', async () => {
    const pool = fakePool();
    const exec = fakeExec({ 'launchctl list': LIST_OK, 'plutil': PLIST_OK, 'clawdbot.json': '{"agents": {"entr', 'readlink': 'zoneinfo/America/Los_Angeles' });
    const r = await runOpsCollector(pool, { exec, inContainer: false, now: Date.now() });
    expect(r.results.openclaw.ok).toBe(false);
    expect(pool.queries.some((q) => q.sql.includes('INSERT INTO ops_agents') && q.params?.includes('openclaw'))).toBe(false);
  });

  it('模块自 gate：间隔内二次调用 skipped', async () => {
    const pool = fakePool();
    const exec = fakeExec({ 'launchctl list': LIST_OK, 'plutil': PLIST_OK, 'clawdbot.json': CLAW_OK, 'readlink': 'zoneinfo/America/Los_Angeles' });
    await runOpsCollector(pool, { exec, inContainer: false, now: 1000000000000 });
    const r2 = await runOpsCollector(pool, { exec, inContainer: false, now: 1000000000000 + 1000 });
    expect(r2.skipped).toBe(true);
  });

  it('快照缺席的 agent 标 offline 不删行', async () => {
    const pool = fakePool();
    const exec = fakeExec({ 'launchctl list': LIST_OK, 'plutil': PLIST_OK, 'clawdbot.json': CLAW_OK, 'readlink': 'zoneinfo/America/Los_Angeles' });
    await runOpsCollector(pool, { exec, inContainer: false, now: Date.now() });
    const off = pool.queries.find((q) => q.sql.includes("SET status='offline'"));
    expect(off).toBeTruthy();
    expect(off.sql).not.toContain('DELETE');
  });

  // —— 腿4: n8n workflow（业务流程，刀4）——
  const N8N_OK = JSON.stringify([
    { id: 'AwrSocialLeadgenV4', name: 'Social Leadgen V4', active: true,
      nodes: [{ name: '阶段 手机预检', type: 'n8n-nodes-base.executeWorkflow', parameters: { workflowId: { value: 'OpcCmdStageCallV4' } } }] },
    { id: 'OpcCmdStageCallV4', name: '通道单点', active: true,
      nodes: [{ name: '调用', type: 'n8n-nodes-base.httpRequest',
        parameters: { headerParameters: { parameters: [{ name: 'x-openclaw-agent-id', value: 'work-commander' }] } } }] },
  ]);

  it('n8n 腿：写 ops_workflows + agent 归属经传递闭包', async () => {
    const pool = fakePool();
    const exec = fakeExec({ 'launchctl list': LIST_OK, 'plutil': PLIST_OK, 'clawdbot.json': CLAW_OK,
      'readlink': 'zoneinfo/America/Los_Angeles', 'n8n export': N8N_OK });
    const r = await runOpsCollector(pool, { exec, inContainer: false, now: Date.now() });
    expect(r.results.n8n.ok).toBe(true);
    expect(r.results.n8n.workflows).toBe(2);
    const ins = pool.queries.filter((q) => q.sql.includes('INSERT INTO ops_workflows'));
    expect(ins.length).toBe(2);
    // 主流程自身无 agentId，经子流程传递闭包解析出 work-commander
    const v4 = ins.find((q) => q.params?.includes('AwrSocialLeadgenV4'));
    expect(v4.params.some((p) => String(p).includes('work-commander'))).toBe(true);
  });

  it('n8n 解析出 0 条 = parse_error，不写空快照', async () => {
    const pool = fakePool();
    const exec = fakeExec({ 'launchctl list': LIST_OK, 'plutil': PLIST_OK, 'clawdbot.json': CLAW_OK,
      'readlink': 'zoneinfo/America/Los_Angeles', 'n8n export': '[]' });
    const r = await runOpsCollector(pool, { exec, inContainer: false, now: Date.now() });
    expect(r.results.n8n.ok).toBe(false);
    expect(pool.queries.some((q) => q.sql.includes('INSERT INTO ops_workflows'))).toBe(false);
    expect(pool.queries.some((q) => q.params?.includes('parse_error'))).toBe(true);
  });

  it('n8n ssh 断腿：只灰 n8n 分区，launchd/openclaw 照常', async () => {
    const pool = fakePool();
    const exec = fakeExec({ 'launchctl list': LIST_OK, 'plutil': PLIST_OK, 'clawdbot.json': CLAW_OK,
      'readlink': 'zoneinfo/America/Los_Angeles', 'n8n export': new Error('ssh: connect timeout') });
    const r = await runOpsCollector(pool, { exec, inContainer: false, now: Date.now() });
    expect(r.results.n8n.ok).toBe(false);
    expect(r.results.launchd.ok).toBe(true);
    expect(r.results.openclaw.ok).toBe(true);
    const hb = pool.queries.find((q) => q.sql.includes('ops_source_heartbeats') && q.params?.includes('n8n'));
    expect(hb.params).toContain('unreachable');
  });
});
