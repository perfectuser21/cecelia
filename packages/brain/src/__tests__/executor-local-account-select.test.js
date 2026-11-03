import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { readAuth, fetchUsage, forbidden } = vi.hoisted(() => ({
  readAuth: vi.fn(), fetchUsage: vi.fn(),
  forbidden: vi.fn(() => { throw new Error('未授权的外部副作用'); }),
}));
// 只替换 I/O 边界；不复制账号排序算法，不读取机器上的凭据。
vi.mock('os', async original => ({ ...await original(), default: { ...(await original()).default, homedir: () => '/isolated-account-fixture' } }));
vi.mock('fs', async original => ({ ...await original(), readFileSync: (...args) => readAuth(...args) }));
vi.mock('child_process', async original => ({ ...await original(), spawn: forbidden, exec: forbidden, execSync: forbidden }));
vi.mock('../db.js', () => ({ default: { query: forbidden } }));
import { pickLocalAccountByDeficit } from '../executor.js';

const authFor = id => ({ tokens: { access_token: `fixture-${id}`, account_id: `fixture-account-${id}` } });
const usage = (fiveHourPct, sevenDayPct = 0, resetAfter = 302400) => ({
  rate_limit: { primary_window: { used_percent: fiveHourPct }, secondary_window: { used_percent: sevenDayPct, reset_after_seconds: resetAfter } },
});
function respondByAccount(data) {
  fetchUsage.mockImplementation(async (url, options) => {
    expect(url).toBe('https://chatgpt.com/backend-api/wham/usage');
    const id = options.headers['ChatGPT-Account-Id'].replace('fixture-account-', '');
    expect(options.headers.Authorization).toBe(`Bearer fixture-${id}`);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    if (!data[id]) return { ok: false };
    return { ok: true, json: async () => data[id] };
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  readAuth.mockImplementation((file, encoding) => {
    expect(encoding).toBe('utf8');
    const match = /^\/isolated-account-fixture\/\.codex-(team[1-5])\/auth\.json$/.exec(file);
    if (!match) throw new Error('未配置的文件读取');
    return JSON.stringify(authFor(match[1]));
  });
  fetchUsage.mockReset().mockRejectedValue(new Error('未配置的 HTTP 请求'));
  vi.stubGlobal('fetch', fetchUsage);
});
afterEach(() => {
  expect(forbidden).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe('pickLocalAccountByDeficit 真实账号选择器', () => {
  it('同 deficit 按 5h 用量升序，返回原账号认证对象', async () => {
    respondByAccount({ team1: usage(80), team2: usage(10), team3: usage(50), team4: usage(20), team5: usage(90) });
    expect(await pickLocalAccountByDeficit(3)).toEqual(['team2', 'team4', 'team3'].map(id => ({ id, auth: authFor(id) })));
    expect(fetchUsage).toHaveBeenCalledTimes(5);
  });
  it('单账号 HTTP 失败仍保留其余账号', async () => {
    respondByAccount({ team3: usage(50), team4: usage(50), team5: usage(50) });
    expect((await pickLocalAccountByDeficit(5)).map(a => a.id)).toEqual(['team3', 'team4', 'team5']);
  });
  it('全部 HTTP 失败返回空数组', async () => {
    expect(await pickLocalAccountByDeficit()).toEqual([]);
    expect(fetchUsage).toHaveBeenCalledTimes(5);
  });
  it('maxAccounts 限制返回数量', async () => {
    respondByAccount({ team1: usage(10), team2: usage(10), team3: usage(10) });
    expect((await pickLocalAccountByDeficit(2)).map(a => a.id)).toEqual(['team1', 'team2']);
  });
  it('缺少 token 或认证文件损坏的账号不请求用量', async () => {
    readAuth.mockImplementation(file => {
      if (file.includes('team1')) return JSON.stringify({ tokens: {} });
      if (file.includes('team2')) throw new Error('fixture_auth_unreadable');
      return JSON.stringify(authFor(/codex-(team\d)/.exec(file)[1]));
    });
    respondByAccount({ team3: usage(10), team4: usage(10), team5: usage(10) });
    expect((await pickLocalAccountByDeficit(5)).map(a => a.id)).toEqual(['team3', 'team4', 'team5']);
    expect(fetchUsage).toHaveBeenCalledTimes(3);
  });
  it('deficit 排序优先于 5h 用量，95% 可用而超过95%被排除', async () => {
    respondByAccount({ team1: usage(5, 45), team2: usage(95, 5), team3: usage(96, 0), team4: usage(20, 20) });
    expect((await pickLocalAccountByDeficit(5)).map(a => a.id)).toEqual(['team2', 'team4', 'team1']);
  });
});
