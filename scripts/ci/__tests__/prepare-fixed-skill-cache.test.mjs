import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,symlinkSync,readdirSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const repo='perfectuser21/zenithjoy-workspace',centralRepo='perfectuser21/zenithjoy-skills';
const hash=b=>createHash('sha256').update(b).digest('hex');
const git=(root,...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-C',root,...args],{encoding:'utf8',env:Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('GIT_')))}).trim();
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'skill-cold-cache-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const business=join(root,'business'),central=join(root,'central');
 for(const p of [business,central]){mkdirSync(p);git(p,'init','-q','-b','main');}
 git(business,'remote','add','origin','https://github.com/'+repo+'.git');
 writeFileSync(join(business,'.gitignore'),'.skills-source/\n');
 const commit=p=>{git(p,'add','-A');git(p,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixed fixture');return git(p,'rev-parse','HEAD');};
 const path='.claude/skills/demo/SKILL.md',bodyPath='business-skills/demo/SKILL.md';
 mkdirSync(join(central,'business-skills/demo'),{recursive:true});mkdirSync(join(central,'distribution'));
 const entries=[],versions=[];
 for(const n of [1,2]){
  const body='---\nname: demo\nversion: '+n+'\n---\nfixed '+n+'\n';writeFileSync(join(central,bodyPath),body);
  writeFileSync(join(central,'distribution/catalog.json'),JSON.stringify({version:1,profiles:{zenithjoy:{files:[{path,source:bodyPath,sha256:hash(body)}]}}}));
  const revision=commit(central);versions.push(revision);
  writeFileSync(join(business,'.skills-source.json'),JSON.stringify({version:1,repository:centralRepo,revision,profile:'zenithjoy',loader_sha256:'a'.repeat(64)}));
  const businessRevision=commit(business);entries.push({kind:'skill',scope:'activity',status:'verified',repo,path,revision:businessRevision,digest:'sha256:'+hash(body),resolved_source:{repo:centralRepo,path:bodyPath,revision}});
 }
 const revision=git(business,'rev-parse','HEAD');git(business,'update-ref','refs/remotes/origin/main',revision);
 const row=(kind,payload)=>({id:'00000001-1111-4111-8111-111111111111',source_repo:repo,source_commit:revision,source_path:'contracts/demo.json',payload,payload_sha256:hash(JSON.stringify({}))});
 // Use the actual canonical snapshot seal, not a stub validator.
 const snapshot={schema_version:1,scope:'zenithjoy',repo,revision,status:'verified',gaps:[],definitions:{workflows:[],activities:[row('activity',{implementation_bindings:entries})]},assertions:[]};
 return {root,business,central,commit,path,bodyPath,versions,entries,snapshot,fetches:[]};
}
async function setup(t){
 const f=fixture(t);
 const {stepSha256}=await import('../../../packages/brain/scripts/sync-steps-from-workspace.mjs');
 const a=f.snapshot.definitions.activities[0];a.payload_sha256=stepSha256({source:{repo:a.source_repo,path:a.source_path,commit:a.source_commit},payload:a.payload});
 f.snapshot.snapshot_sha256=stepSha256(f.snapshot);
 f.reseal=()=>{const a=f.snapshot.definitions.activities[0];a.payload_sha256=stepSha256({source:{repo:a.source_repo,path:a.source_path,commit:a.source_commit},payload:a.payload});delete f.snapshot.snapshot_sha256;f.snapshot.snapshot_sha256=stepSha256(f.snapshot);};
 f.advance=()=>{const revision=f.commit(f.business);f.snapshot.revision=revision;f.snapshot.definitions.activities[0].source_commit=revision;f.entries[1].revision=revision;f.reseal();};
 const mod=await import('../prepare-fixed-skill-cache.mjs');
 f.prepare=(options={})=>mod.prepareFixedSkillCache({repoRoot:f.business,snapshot:f.snapshot,cacheBase:f.root,key:'fixture-only-private-key',fetchCommit:async({directory,revision,env,timeoutMs})=>{
  f.fetches.push(revision);assert.ok(timeoutMs>0&&timeoutMs<=60000);assert.equal(env.GIT_CONFIG_GLOBAL,'/dev/null');assert.equal(env.GIT_NO_REPLACE_OBJECTS,'1');assert.equal(env.GIT_CONFIG_COUNT,undefined);
  assert.doesNotMatch(JSON.stringify(env),/fixture-only-private-key/);
  git(directory,'fetch','--quiet','--no-tags',f.central,revision);
 },...options});
 return f;
}
test('cold cache fetches exact HEAD and snapshot historical central commits without a checkout or loader',async t=>{
 const f=await setup(t);assert.equal(existsSync(join(f.business,'.skills-source')),false);
 const r=await f.prepare();assert.deepEqual(new Set(f.fetches),new Set(f.versions));assert.equal(r.status,'prepared');
 for(const revision of f.versions)assert.equal(git(join(f.business,'.skills-source'),'rev-parse',revision+'^{commit}'),revision);
 assert.equal(existsSync(join(f.business,'.skills-source','business-skills')),false);
 assert.equal(existsSync(join(f.business,f.path)),false);
 assert.ok(!readdirSync(f.root).some(p=>p.startsWith('fixed-skill-auth-')));
});
test('missing key refuses before transport and leaves no claimed ready cache',async t=>{const f=await setup(t);await assert.rejects(()=>f.prepare({key:''}),/KEY_REQUIRED/);assert.equal(f.fetches.length,0);assert.equal(existsSync(join(f.business,'.skills-source')),false);});
test('source root and existing cache symlinks are rejected without touching their targets',async t=>{
 const f=await setup(t),outside=join(f.root,'outside');mkdirSync(outside);writeFileSync(join(outside,'protected'),'same');symlinkSync(outside,join(f.business,'.skills-source'),'dir');
 await assert.rejects(()=>f.prepare(),/CACHE_EXISTS|SYMLINK/);assert.equal(readFileSync(join(outside,'protected'),'utf8'),'same');assert.equal(f.fetches.length,0);
 const link=join(f.root,'source-link');symlinkSync(f.business,link,'dir');await assert.rejects(()=>f.prepare({repoRoot:link}),/SYMLINK/);
});
test('invalid fixed lock, source identity or snapshot seal never authorizes a fetch',async t=>{
 for(const patch of [{revision:'main'},{repository:'evil/skills'},{profile:'cecelia'}]){
  const f=await setup(t);const lock=JSON.parse(readFileSync(join(f.business,'.skills-source.json')));writeFileSync(join(f.business,'.skills-source.json'),JSON.stringify({...lock,...patch}));
  f.advance();await assert.rejects(()=>f.prepare(),/LOCK_INVALID/);assert.equal(f.fetches.length,0);
 }
 const f=await setup(t);await assert.rejects(()=>f.prepare({snapshot:{...f.snapshot,snapshot_sha256:'0'.repeat(64)}}),/SNAPSHOT/);assert.equal(f.fetches.length,0);
});
test('unknown historical business object cannot be replaced with HEAD',async t=>{
 const f=await setup(t);f.entries[0].revision='f'.repeat(40);
 const {stepSha256}=await import('../../../packages/brain/scripts/sync-steps-from-workspace.mjs');const a=f.snapshot.definitions.activities[0];a.payload_sha256=stepSha256({source:{repo:a.source_repo,path:a.source_path,commit:a.source_commit},payload:a.payload});delete f.snapshot.snapshot_sha256;f.snapshot.snapshot_sha256=stepSha256(f.snapshot);
 await assert.rejects(()=>f.prepare(),/BUSINESS_OBJECT/);assert.equal(f.fetches.length,0);
});
test('wrong central object, authentication failure and total budget failure leave no ready cache',async t=>{
 const f=await setup(t);await assert.rejects(()=>f.prepare({fetchCommit:async()=>{}}),/OBJECT/);assert.equal(existsSync(join(f.business,'.skills-source')),false);
 await assert.rejects(()=>f.prepare({fetchCommit:async()=>{throw Error('Permission denied (publickey) fixture-only-private-key');}}),e=>/FETCH|AUTH/.test(e.message)&&!e.message.includes('fixture-only-private-key'));
 await assert.rejects(()=>f.prepare({deadline:Date.now()-1}),/BUDGET/);assert.equal(existsSync(join(f.business,'.skills-source')),false);
});
test('central digest is rechecked from fetched Git objects before cache publication',async t=>{
 const f=await setup(t);await assert.rejects(()=>f.prepare({fetchCommit:async args=>{git(args.directory,'fetch','--quiet','--no-tags',f.central,args.revision);f.entries[0].resolved_source.revision=f.versions[1];}}),/SNAPSHOT|SOURCE|BINDING/);
 assert.equal(existsSync(join(f.business,'.skills-source')),false);
});

test('fixed catalog bad digest or traversal fails from actual fetched immutable bytes',async t=>{
 for(const patch of [{sha256:'0'.repeat(64)},{source:'../SKILL.md'},{source:'/absolute.md'}]){
  const f=await setup(t),catalog=JSON.parse(readFileSync(join(f.central,'distribution/catalog.json')));Object.assign(catalog.profiles.zenithjoy.files[0],patch);
  writeFileSync(join(f.central,'distribution/catalog.json'),JSON.stringify(catalog));const cr=f.commit(f.central);
  const lock=JSON.parse(readFileSync(join(f.business,'.skills-source.json')));lock.revision=cr;writeFileSync(join(f.business,'.skills-source.json'),JSON.stringify(lock));f.advance();delete f.entries[1].resolved_source;f.reseal();
  await assert.rejects(()=>f.prepare(),/DIGEST|GIT_LOCATION/);assert.equal(existsSync(join(f.business,'.skills-source')),false);
 }
});
test('version count and expired shared budget stop before extra transport, environment injection is removed',async t=>{
 const f=await setup(t);await assert.rejects(()=>f.prepare({maxVersions:2}),/VERSION_LIMIT/);assert.equal(f.fetches.length,0);
 const old=process.env.GIT_CONFIG_COUNT;process.env.GIT_CONFIG_COUNT='1';process.env.GIT_CONFIG_KEY_0='url.file:///evil.insteadOf';process.env.GIT_CONFIG_VALUE_0='git@github.com:';
 t.after(()=>{if(old===undefined)delete process.env.GIT_CONFIG_COUNT;else process.env.GIT_CONFIG_COUNT=old;delete process.env.GIT_CONFIG_KEY_0;delete process.env.GIT_CONFIG_VALUE_0;});
 await f.prepare();assert.equal(f.fetches.length,2);
});
test('source directory replacement during fetch cannot publish a ready cache',async t=>{
 const f=await setup(t);await assert.rejects(()=>f.prepare({fetchCommit:async args=>{git(args.directory,'fetch','--quiet','--no-tags',f.central,args.revision);renameSync(f.business,f.business+'-moved');mkdirSync(f.business);}}),/REPLACED/);
 assert.equal(existsSync(join(f.business,'.skills-source')),false);assert.ok(!readdirSync(f.root).some(p=>p.startsWith('fixed-skill-auth-')));
});
