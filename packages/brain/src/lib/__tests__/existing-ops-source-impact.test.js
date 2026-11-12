import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

it('真实当前CLI只有mainScopes缺省才走单scope，false或空值仍进入main拒绝',async()=>{
 const {runImplementationPrGate}=await import('../../../../../scripts/ci/implementation-pr-gate.mjs');
 const dir=mkdtempSync(join(tmpdir(),'legacy-main-contract-'));
 try{for(const [label,extra,code]of [['absent',{},'IMPLEMENTATION_CI_INPUT_INVALID'],['undefined',{mainScopes:undefined},'IMPLEMENTATION_CI_INPUT_INVALID'],['false',{mainScopes:false},'IMPLEMENTATION_MAIN_SCOPES_INVALID'],['empty',{mainScopes:''},'IMPLEMENTATION_MAIN_SCOPES_INVALID']])
  await expect(runImplementationPrGate({mode:'main',scope:'cecelia-kr',outputDir:join(dir,label),...extra})).rejects.toMatchObject({code});
 }finally{rmSync(dir,{recursive:true,force:true});}
});
