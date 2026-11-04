import {beforeAll, beforeEach, afterEach, describe, it, expect, vi} from 'vitest';
const boundary = vi.hoisted(() => ({query:vi.fn(() => {throw Error('DB forbidden');}), execute:vi.fn(() => {throw Error('process forbidden');})}));
vi.mock('../db.js', () => ({default:{query:boundary.query}}));
vi.mock('child_process', () => ({spawn:boundary.execute,exec:boundary.execute,execSync:boundary.execute,execFile:boundary.execute,execFileSync:boundary.execute}));
vi.mock('node:child_process', () => ({spawn:boundary.execute,exec:boundary.execute,execSync:boundary.execute,execFile:boundary.execute,execFileSync:boundary.execute}));
vi.mock('fs', async original => {
  const fs = await original();
  return {...fs, existsSync:() => false, readdirSync:() => [], readFileSync:(filename,...args) => {
    if (String(filename).includes('/cecelia-ci-retained-seven-3/')) return fs.readFileSync(filename,...args);
    throw Error('host configuration read forbidden');
  }};
});
let selectBestBridge, directory;
beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(() => {throw Error('network forbidden');}));
  ({selectBestBridge} = await import('../executor.js'));
  ({directory} = await import('../execution-directory/directory.js'));
});
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console,'log').mockImplementation(()=>{});vi.spyOn(console,'warn').mockImplementation(()=>{}); });
afterEach(() => { expect(boundary.query).not.toHaveBeenCalled();expect(boundary.execute).not.toHaveBeenCalled();vi.restoreAllMocks(); });

function snapshot(urls) {
  return {expiresAt:Date.now()+60000,nodes:urls.map((url,i) => ({
    canonical_id:`fixture-${i}`,state:'active',machine_status:'active',
    endpoints:{worker:'http://fixture.worker',legacy_executor:{codex:{executor:'codex',url}}},
    grants:[{surface:'legacy_executor',provider:'codex',state:'active',account_id:'',profile_id:''}],
  }))};
}
const healthy = accounts => ({ok:true,status:'healthy',accounts});
function choose(urls, health) {
  vi.mocked(fetch).mockImplementation(async url => {
    const value = health[url.replace('/health','')];
    if (value instanceof Error) throw value;
    return {ok:value?.httpOk !== false,status:503,json:async () => value};
  });
  return directory.withSnapshot(snapshot(urls), () => selectBestBridge());
}

describe('真实selectBestBridge：当前授权目录→健康探针→额度选择', () => {
  it('忽略过期账号，按可用账号平均额度选择真实目录中的URL', async () => {
    expect(selectBestBridge).toBeTypeOf('function');
    const result = await choose(['http://a.fixture','http://b.fixture'], {
      'http://a.fixture':healthy([{primaryUsedPct:70},{primaryUsedPct:0,tokenExpired:true}]),
      'http://b.fixture':healthy([{primaryUsedPct:40},{primaryUsedPct:50}]),
    });
    expect(result).toBe('http://b.fixture');
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [,options] of vi.mocked(fetch).mock.calls) expect(options.signal).toBeInstanceOf(AbortSignal);
  });
  it.each([{httpOk:false}, {ok:false}, {ok:true,status:'degraded'}, healthy([]), healthy([{tokenExpired:true}]), new Error('probe unavailable')])('坏/无账号探针不能进入候选 %j', async bad => {
    expect(await choose(['http://bad.fixture','http://good.fixture'], {'http://bad.fixture':bad,'http://good.fixture':healthy([{primaryUsedPct:80}])})).toBe('http://good.fixture');
  });
  it('空授权目录不探测、不退回硬编码宿主', async () => {
    await expect(choose([],{})).rejects.toThrow('execution_legacy_grant_unavailable:codex');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('全部探针失败时拒绝，不能返回无授权默认URL', async () => {
    await expect(choose(['http://bad.fixture'],{'http://bad.fixture':new Error('offline')})).rejects.toThrow('execution_legacy_grant_unavailable:codex');
  });
});
