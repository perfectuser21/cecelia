import request from 'supertest';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { createAcceptancePublicApp, createAcceptancePublicAppV2, createBearerAuth, startAcceptancePublicServer } from '../acceptance-public-server.js';

const TOKEN = 'test-token-abc';

function makePool() {
  return { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() };
}

describe('createAcceptancePublicApp 鉴权', () => {
  it('无 Authorization → 401', async () => {
    const res = await request(createAcceptancePublicApp({ pool: makePool(), token: TOKEN }))
      .get('/acceptance/pending');
    expect(res.status).toBe(401);
  });

  it('错 token → 401', async () => {
    const res = await request(createAcceptancePublicApp({ pool: makePool(), token: TOKEN }))
      .get('/acceptance/pending')
      .set('Authorization', 'Bearer wrong');
    expect(res.status).toBe(401);
  });

  it('对 token → 200 进入业务路由', async () => {
    const res = await request(createAcceptancePublicApp({ pool: makePool(), token: TOKEN }))
      .get('/acceptance/pending')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ runs: [] });
  });

  it('未知路径 → 404（即使带对 token）', async () => {
    const res = await request(createAcceptancePublicApp({ pool: makePool(), token: TOKEN }))
      .get('/api/brain/tasks')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(404);
  });
});

describe('startAcceptancePublicServer fail-closed', () => {
  afterEach(() => { delete process.env.ACCEPTANCE_API_TOKEN; });

  it('ACCEPTANCE_API_TOKEN 未配置 → 返回 null 不监听', () => {
    delete process.env.ACCEPTANCE_API_TOKEN;
    const server = startAcceptancePublicServer({ pool: makePool(), port: 0 });
    expect(server).toBeNull();
  });

  it('配置了 token → 返回 server 并监听', async () => {
    process.env.ACCEPTANCE_API_TOKEN = TOKEN;
    const server = startAcceptancePublicServer({ pool: makePool(), port: 0 });
    expect(server).not.toBeNull();
    await new Promise((r) => server.close(r));
  });
});

describe('安全加固', () => {
  // B7 铁律 [createBearerAuth容错]：空/undefined token 不 throw，返回 null（容错降级）
  // 注：此断言由 acceptance-d3-backtoback.test.js B7 组强化；旧「期望 throw」断言已废弃
  it('createBearerAuth 空/缺 token → 不 throw，返回 null', () => {
    expect(() => createBearerAuth('')).not.toThrow();
    expect(() => createBearerAuth(undefined)).not.toThrow();
    expect(createBearerAuth('')).toBeNull();
    expect(createBearerAuth(undefined)).toBeNull();
  });

  it('malformed JSON（带对 token）→ 400 bad request 不泄堆栈', async () => {
    const res = await request(createAcceptancePublicApp({ pool: makePool(), token: TOKEN }))
      .post('/acceptance/results')
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('Content-Type', 'application/json')
      .send('{bad json');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'bad request' });
  });

  it('响应不带 x-powered-by 指纹', async () => {
    const res = await request(createAcceptancePublicApp({ pool: makePool(), token: TOKEN }))
      .get('/acceptance/pending').set('Authorization', `Bearer ${TOKEN}`);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('无 token 的 POST 大 body → 401（json 解析在鉴权之后）', async () => {
    const res = await request(createAcceptancePublicApp({ pool: makePool(), token: TOKEN }))
      .post('/acceptance/results')
      .send({ results: Array.from({ length: 100 }, (_, i) => ({ check_key: `k${i}`, result: '通过' })) });
    expect(res.status).toBe(401);
  });

  it('malformed JSON + 无 token → 401（证明鉴权先于 json 解析）', async () => {
    const res = await request(createAcceptancePublicApp({ pool: makePool(), token: TOKEN }))
      .post('/acceptance/results')
      .set('Content-Type', 'application/json')
      .send('{bad json');
    expect(res.status).toBe(401);
  });

  it('listener 默认绑定 127.0.0.1', async () => {
    process.env.ACCEPTANCE_API_TOKEN = TOKEN;
    const server = startAcceptancePublicServer({ pool: makePool(), port: 0 });
    await new Promise((r) => server.on('listening', r));
    expect(server.address().address).toBe('127.0.0.1');
    await new Promise((r) => server.close(r));
    delete process.env.ACCEPTANCE_API_TOKEN;
  });
});


describe('现役 V2 公网路由与 listener', () => {
  const tokens = { aiToken: 'ai-test-only', gateToken: 'gate-test-only', apiToken: 'catalog-test-only' };
  const endpoints = [
    ['aiToken', 'post', '/acceptance/ai-results', 501],
    ['gateToken', 'get', '/acceptance/gate', 200],
    ['apiToken', 'get', '/acceptance/catalog', 200],
  ];

  it.each(endpoints.flatMap(([owner, method, path, authorizedStatus]) =>
    Object.entries(tokens).map(([holder, token]) => [owner, method, path, authorizedStatus, holder, token]),
  ))('%s 路由 %s %s，授权状态=%i，持有者=%s', async (owner, method, path, authorizedStatus, holder, token) => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ payload: { golden_paths: ['current'] }, updated_at: 'now' }] }) };
    const app = createAcceptancePublicAppV2({ pool, ...tokens });
    const response = await request(app)[method](path).set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(holder === owner ? authorizedStatus : 401);
    expect(pool.query).toHaveBeenCalledTimes(owner === 'apiToken' && holder === owner ? 1 : 0);
    if (owner === 'apiToken' && holder === owner) expect(response.body.catalog.golden_paths).toEqual(['current']);
  });

  it.each(endpoints)('缺 %s 时对应 %s %s 不挂载', async (owner, method, path) => {
    const pool = makePool();
    const app = createAcceptancePublicAppV2({ pool, ...tokens, [owner]: undefined });
    const response = await request(app)[method](path).set('Authorization', `Bearer ${tokens[owner]}`);
    expect(response.status).toBe(404);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('V2 catalog 的数据库异常只返回 internal_error', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('private-db-detail-never-expose')) };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await request(createAcceptancePublicAppV2({ pool, ...tokens }))
        .get('/acceptance/catalog').set('Authorization', `Bearer ${tokens.apiToken}`);
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'internal_error' });
      expect(response.text).not.toContain('private-db-detail');
      expect(pool.query).toHaveBeenCalledOnce();
    } finally { log.mockRestore(); }
  });

  it('V2 限流耗尽后先返回 429，不进入 JSON 解析或业务查询', async () => {
    const pool = makePool();
    const app = createAcceptancePublicAppV2({ pool, ...tokens });
    for (let index = 0; index < 60; index++) {
      const rejected = await request(app).get('/acceptance/gate');
      expect(rejected.status).toBe(401);
    }
    const limited = await request(app).post('/acceptance/ai-results')
      .set('Authorization', `Bearer ${tokens.aiToken}`)
      .set('Content-Type', 'application/json').send('{malformed');
    expect(limited.status).toBe(429);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('实际 start 在随机 loopback 端口选择 V2，关闭后停止监听', async () => {
    vi.stubEnv('ACCEPTANCE_AI_TOKEN', tokens.aiToken);
    vi.stubEnv('ACCEPTANCE_GATE_TOKEN', tokens.gateToken);
    vi.stubEnv('ACCEPTANCE_API_TOKEN', tokens.apiToken);
    vi.stubEnv('ACCEPTANCE_PUBLIC_HOST', '127.0.0.1');
    let server;
    try {
      server = startAcceptancePublicServer({ pool: makePool(), port: 0 });
      await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
      expect(server.address()).toMatchObject({ address: '127.0.0.1' });
      expect(server.address().port).toBeGreaterThan(0);
      const own = await request(server).get('/acceptance/gate').set('Authorization', `Bearer ${tokens.gateToken}`);
      expect(own.status).toBe(200);
      expect(own.body).toEqual({ status: 'ok', gate: 'open' });
      const crossed = await request(server).get('/acceptance/gate').set('Authorization', `Bearer ${tokens.apiToken}`);
      expect(crossed.status).toBe(401);
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      expect(server.listening).toBe(false);
      expect(server.address()).toBeNull();
    } finally {
      if (server?.listening) await new Promise(resolve => server.close(resolve));
      vi.unstubAllEnvs();
    }
  });

  it('三个 token 全部缺失时不创建 listener', () => {
    for (const key of ['ACCEPTANCE_AI_TOKEN', 'ACCEPTANCE_GATE_TOKEN', 'ACCEPTANCE_API_TOKEN']) vi.stubEnv(key, '');
    try { expect(startAcceptancePublicServer({ pool: makePool(), port: 0 })).toBeNull(); }
    finally { vi.unstubAllEnvs(); }
  });
});
