import {it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({max:null,end:vi.fn(),close:vi.fn(),query:vi.fn(async sql=>({rows:/current_schema/.test(sql)?[{name:'versions_fixture'}]:[]}))}));
vi.mock('./implementation-impact-db.js',()=>({IMPACT_REPO:'owner/repo',implementationImpactDatabase:async()=>({db:{query:state.query},ids:{},contracts:{docs:{}},advance:async()=>{},close:state.close})}));
vi.mock('pg',()=>({default:{Pool:class{constructor(config){state.max=config.max;}end(){return state.end();}}}}));
vi.mock('node:fs',()=>({existsSync:()=>false,readFileSync:vi.fn()}));
vi.mock('../../lib/implementation-impact.js',()=>({readImplementationImpact:vi.fn()}));
import {releaseEvidenceDatabase} from './release-evidence-db.js';
it('missing actual515 rejects setup and closes owned native-pool contract instead of silent fallback',async()=>{
 await expect(releaseEvidenceDatabase()).rejects.toThrow('发布证据迁移515必须存在');expect(state.max).toBe(6);expect(state.end).toHaveBeenCalledOnce();expect(state.close).toHaveBeenCalledOnce();expect(state.query.mock.calls.some(([q])=>/INSERT|CREATE TABLE/.test(q))).toBe(false);
});
