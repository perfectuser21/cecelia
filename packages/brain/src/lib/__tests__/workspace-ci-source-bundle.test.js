import {it,expect} from 'vitest';
import {extractWorkspaceCiSourceBundle,F3_IDENTITY} from '../workspace-ci-source-bundle.js';

const source=()=>({workspace:{repo:'perfectuser21/zenithjoy-workspace',revision:'a'.repeat(40)},brain:{repo:'perfectuser21/cecelia',revision:'b'.repeat(40)},identity:{...F3_IDENTITY}});
it('错误既有F3身份不能偷偷创建另一Activity，且不读取任何源码',async()=>{
 let reads=0;const options=source();options.identity.activity_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const result=await extractWorkspaceCiSourceBundle({...options,readSource:async()=>{reads++;throw Error('unexpected_source_read');}});
 expect(result.status).toBe('unknown');expect(result.gaps).toEqual(expect.arrayContaining([expect.objectContaining({code:'F3_IDENTITY_MISMATCH'})]));
 expect(result.executable).toBe(false);expect(reads).toBe(0);
});
it('未固定source SHA不读任何源码，保持unknown且不可执行',async()=>{
 let reads=0;const options=source();options.workspace.revision='main';
 const result=await extractWorkspaceCiSourceBundle({...options,readSource:async()=>{reads++;throw Error('unexpected_source_read');}});
 expect(result.status).toBe('unknown');expect(result.gaps).toEqual(expect.arrayContaining([expect.objectContaining({code:'SOURCE_IDENTITY_INVALID'})]));
 expect(result.executable).toBe(false);expect(reads).toBe(0);
});
