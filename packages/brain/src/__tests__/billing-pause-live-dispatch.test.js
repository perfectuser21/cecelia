import {beforeAll,beforeEach,afterAll,it,expect,vi} from 'vitest';
const io=vi.hoisted(()=>({query:vi.fn(),quota:vi.fn(),record:vi.fn(async()=>{}),forbidden:vi.fn(()=>{throw Error('external action forbidden');})}));
vi.mock('../db.js',()=>({default:{query:io.query}}));
vi.mock('child_process',()=>({spawn:io.forbidden,exec:io.forbidden,execSync:io.forbidden,execFile:io.forbidden,execFileSync:io.forbidden}));
vi.mock('node:child_process',()=>({spawn:io.forbidden,exec:io.forbidden,execSync:io.forbidden,execFile:io.forbidden,execFileSync:io.forbidden}));
vi.mock('fs',async original=>{
 const fs=await original();const {resolve}=await import('node:path');const {fileURLToPath}=await import('node:url');const root=resolve(process.cwd(),'../..');
 return {...fs,existsSync:()=>false,readdirSync:()=>[],readFileSync:(file,...args)=>{
  const target=file instanceof URL?fileURLToPath(file):resolve(String(file));
  if(!target.startsWith(root+'/')||target.includes('/.env')||/credential|auth\.json/.test(target))throw Error('host config forbidden');
  return fs.readFileSync(file,...args);
 }};
});
vi.mock('../account-usage.js',async original=>({...await original(),proactiveTokenCheck:vi.fn(async()=>{})}));
vi.mock('../quota-guard.js',()=>({checkQuotaGuard:io.quota}));
vi.mock('../slot-allocator.js',()=>({
 calculateSlotBudget:vi.fn(async()=>({resourceAdmissionBlocked:true})),
 harnessSlotCheck:vi.fn(),
}));
vi.mock('../quota-cooling.js',()=>({isGlobalQuotaCooling:()=>false,getQuotaCoolingState:()=>({active:false})}));
vi.mock('../drain.js',()=>({isDraining:()=>false,getDrainStartedAt:()=>null}));
vi.mock('../guidance.js',()=>({getGuidance:async()=>null}));
vi.mock('../circuit-breaker.js',()=>({isAllowed:()=>true,recordFailure:vi.fn(),recordSuccess:vi.fn()}));
vi.mock('../alertness/index.js',async original=>({...await original(),canDispatch:()=>true}));
vi.mock('../dispatch-stats.js',()=>({recordDispatchResult:io.record}));
let executor,dispatchNextTask,runScheduler;
beforeAll(async()=>{
 vi.stubEnv('BRAIN_MINIMAL_MODE','false');vi.stubGlobal('fetch',io.forbidden);
 executor=await import('../executor.js');
 ({dispatchNextTask}=await import('../dispatcher.js'));
 ({runScheduler}=await import('../tick-scheduler.js'));
});
beforeEach(()=>{
 vi.clearAllMocks();executor.clearBillingPause();
 io.query.mockImplementation(async sql=>({rows:sql.trim().startsWith('SELECT id FROM key_results')?[{id:'owned-goal'}]:[],rowCount:0}));
 io.quota.mockResolvedValue({allow:false,bestPct:100,reason:'owned downstream barrier'});
});
afterAll(()=>{executor.clearBillingPause();vi.unstubAllEnvs();vi.unstubAllGlobals();});

it('真实pause状态进入真实dispatcher非代码lane并阻挡后续quota/派发',async()=>{
 executor.setBillingPause(new Date(Date.now()+60000).toISOString(),'quota_exhausted');
 expect(await dispatchNextTask(['owned-goal'])).toMatchObject({dispatched:false,reason:'billing_pause'});
 expect(io.record).toHaveBeenCalledWith(expect.any(Object),false,'billing_pause');
 expect(io.quota).not.toHaveBeenCalled();expect(io.forbidden).not.toHaveBeenCalled();
});
it('当前默认runScheduler真实调用非代码dispatcher，pause门必达',async()=>{
 executor.setBillingPause(new Date(Date.now()+60000).toISOString(),'quota_exhausted');
 const result=await runScheduler();
 expect(result).toMatchObject({dispatched:false,reason:'billing_pause'});
 expect(io.query.mock.calls.some(([sql])=>sql.trim().startsWith('SELECT id FROM key_results'))).toBe(true);
 expect(io.quota).not.toHaveBeenCalled();expect(io.forbidden).not.toHaveBeenCalled();
});
it('clear后真实dispatcher继续到受控下游资源门，不再因pause短路',async()=>{
 executor.setBillingPause(new Date(Date.now()+60000).toISOString(),'quota_exhausted');
 executor.clearBillingPause();
 expect(await dispatchNextTask(['owned-goal'])).toMatchObject({dispatched:false,reason:'resource_unavailable'});
 const {calculateSlotBudget}=await import('../slot-allocator.js');
 expect(calculateSlotBudget).toHaveBeenCalledTimes(1);
 expect(io.quota).not.toHaveBeenCalled();expect(io.forbidden).not.toHaveBeenCalled();
});
