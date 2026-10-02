import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {root} from './fixtures/smoke-production-guard-fixture.mjs';

test('phone smoke子进程加载私有dotenv后仍使用已核对DB_*，不复活连接串覆盖',async()=>{
 const temp=await mkdtemp(resolve(tmpdir(),'phone-smoke-env-'));
 try{
  const source=await readFile(resolve(root,'packages/brain/scripts/smoke/phone-dispatch-identity-smoke.sh'),'utf8');
  const line=source.match(/^(?:unset|export) TEST_DATABASE_URL(?:=.*)?$/m)?.[0];
  assert.ok(line,'smoke必须显式处理测试连接串覆盖');
  const envFile=resolve(temp,'.env'),checker=resolve(temp,'target-check.mjs');
  // 仅测试自己创建的无凭据文件；不读取仓库.env，不连接任何数据库。
  await writeFile(envFile,'TEST_DATABASE_URL=postgresql://example.invalid/other_scratch\n');
  await writeFile(checker,`import assert from 'node:assert/strict';
const {default:dotenv}=await import(process.argv[2]);
dotenv.config({path:process.argv[3],quiet:true});
const options=process.env.TEST_DATABASE_URL?{connectionString:process.env.TEST_DATABASE_URL}:{database:process.env.DB_NAME,host:process.env.DB_HOST};
assert.deepEqual(options,{database:'cecelia_scratch',host:'127.0.0.1'});
assert.equal(process.env.TEST_DATABASE_URL,'');
`);
  const dotenv=execFileSync(process.execPath,['-p','require.resolve("dotenv")'],{cwd:resolve(root,'packages/brain'),encoding:'utf8'}).trim();
  const result=await new Promise((done,reject)=>{
   const child=spawn('bash',['-c',`${line}\nexec "$GUARD_NATIVE_NODE" "$GUARD_ENV_CHECKER" "$GUARD_DOTENV_MODULE" "$GUARD_PRIVATE_ENV"`],{
    env:{...process.env,TEST_DATABASE_URL:'postgresql://example.invalid/inherited_scratch',DB_NAME:'cecelia_scratch',DB_HOST:'127.0.0.1',
     GUARD_NATIVE_NODE:process.execPath,GUARD_ENV_CHECKER:checker,GUARD_DOTENV_MODULE:dotenv,GUARD_PRIVATE_ENV:envFile},
   });
   let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('error',reject);child.on('close',code=>done({code,output}));
  });
  assert.equal(result.code,0,result.output);
 }finally{await rm(temp,{recursive:true,force:true});}
});
