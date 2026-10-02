import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const smoke=name=>readFileSync(join(root,'packages/brain/scripts/smoke',name),'utf8');
const env={...process.env,NODE_ENV:'test',DB_NAME:'cecelia_scratch',TEST_DATABASE_URL:'',SCRIPT_SMOKE_DB_URL:''};
function run(args,cwd=root){
 try{return {code:0,output:execFileSync(process.execPath,args,{cwd,env,encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']})};}
 catch(error){return {code:error.status,output:String(error.stdout)+String(error.stderr)};}
}
it('T1真实Node合同块接受十二种执行器并保留独立手机收口',()=>{
 const code=smoke('executor-liveness-t1-smoke.sh').match(/import \{ EXECUTOR_CONTRACTS, VALID_EXECUTOR_KINDS, assessTaskLiveness \}[\s\S]*?\nEOF/)[0]
  .replace(/\nEOF$/,'').replace('${CONTRACTS_JS}',join(root,'packages/brain/src/executor-contracts.js'));
 const result=run(['--input-type=module','-e',code]);expect(result.code,result.output).toBe(0);
 expect(code).toContain("EXECUTOR_CONTRACTS['phone-ssh-controller']");
});
it('F4真实Node合同块保留精确名单且校验手机不能通用判死',()=>{
 const code=smoke('factory-f4-selfheal-smoke.sh').match(/node -e '\n([\s\S]*?)\n' &&/)[1];
 const result=run(['-e',code]);expect(result.code,result.output).toBe(0);
 expect(code).toContain('EXECUTOR_CONTRACTS["phone-ssh-controller"]');
});
it('script完整shell验证471历史名单叠加507且不弱化payload安全闸',()=>{
 let result;
 try{result={code:0,output:execFileSync('bash',[join(root,'packages/brain/scripts/smoke/script-executor-contract-smoke.sh')],{cwd:root,env,encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']})};}
 catch(error){result={code:error.status,output:String(error.stdout)+String(error.stderr)};}
 expect(result.code,result.output).toBe(0);expect(result.output).toContain('7 类违规输入全部被拒');
});
it('手机持久身份smoke在required ratchet allowlist中只登记一次',()=>{
 const entries=readFileSync(join(root,'packages/quality/smoke-allowlist.txt'),'utf8').split(/\r?\n/).filter(v=>v==='phone-dispatch-identity-smoke.sh');
 expect(entries).toHaveLength(1);
});
