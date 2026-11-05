import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const dockerfile = new URL('../../../packages/brain/Dockerfile', import.meta.url);
const originalHashes = ['79e89a14af6fc69163aee00e764e86d5809d0c6c77e6f229aebe7a4ed115ee67','bb62c95ecc17a8557a847483ce671bff9909f107ad1961b4efafcd521721c213'];
function assertFixtureDownload(script,port) {
  const matches=[...script.matchAll(/(["'])(https?:\/\/[^"']+)\1/g)];
  assert.equal(matches.length,1,'one quoted download URL is required');
  assert.equal((script.match(/https?:\/\/[^\s"'\\]+/g)||[]).length,1,'no additional URL tokens');
  const actual=new URL(matches[0][2]);
  const expected=new URL('/v${GH_VERSION}/gh_${GH_VERSION}_linux_${GH_ARCH}.tar.gz',`http://127.0.0.1:${port}`);
  for(const field of ['protocol','hostname','port','pathname','username','password','search','hash']){
    assert.equal(actual[field],expected[field],`owned download URL ${field}`);
  }
}
function execute(command,args,options) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,options);let stdout='',stderr='';
    child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
    const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(Error('owned installer exceeded timeout'));},15000);
    child.once('error',reject);child.once('close',code=>{clearTimeout(timeout);resolve({code,stdout,stderr});});
  });
}
async function fixture(t,{arch='x86_64',failures=0,badChecksum=false,version='2.45.0',tmpLayout=false}={}) {
  const parent=await mkdtemp(join(tmpdir(),'brain-gh-install-'));t.after(()=>rm(parent,{recursive:true,force:true}));
  const root=tmpLayout?join(parent,'tmp','fixture'):parent;await mkdir(root,{recursive:true});
  for(const p of ['bin','tmp','out','home','payload'])await mkdir(join(root,p));
  const targetArch=arch==='aarch64'?'arm64':'amd64',folder='gh_2.45.0_linux_'+targetArch;
  await mkdir(join(root,'payload',folder,'bin'),{recursive:true});
  await writeFile(join(root,'payload',folder,'bin/gh'),'#!/bin/sh\nprintf "gh version '+version+' (synthetic)\\n"\n');
  await chmod(join(root,'payload',folder,'bin/gh'),0o755);
  const pack=await execute('/usr/bin/tar',['-czf',join(root,'package.tgz'),'-C',join(root,'payload'),folder],{env:{PATH:'/usr/bin:/bin'}});assert.equal(pack.code,0,pack.stderr);
  const body=await readFile(join(root,'package.tgz'));const hash=badChecksum?'0'.repeat(64):createHash('sha256').update(body).digest('hex');let requests=0;const urls=[];
  const server=createServer((req,res)=>{requests++;urls.push(req.url);if(requests<=failures){res.writeHead(504);res.end('synthetic gateway timeout');}else{res.end(body);}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  await writeFile(join(root,'bin/apk'),'#!/bin/sh\nprintf "'+arch+'\\n"\n');
  // The old wget boundary makes one real HTTP request to this owned listener.
  await writeFile(join(root,'bin/wget'),'#!/bin/sh\nexec /usr/bin/curl --fail --silent --show-error --location "$2"\n');
  for(const p of ['apk','wget'])await chmod(join(root,'bin',p),0o755);
  if(process.platform==='darwin'){await writeFile(join(root,'bin/sha256sum'),'#!/bin/sh\nexec /usr/bin/shasum -a 256 \"$@\"\n');await chmod(join(root,'bin/sha256sum'),0o755);}
  const text=await readFile(dockerfile,'utf8');const match=text.match(/RUN GH_VERSION=2\.45\.0[\s\S]*?(?=\n\n)/);assert.ok(match,'fixed-version installer RUN must exist');
  let shell=match[0].slice(4).replaceAll('\\\n',' ').replaceAll('https://github.com/cli/cli/releases/download',`http://127.0.0.1:${server.address().port}`)
    .replace(/\/usr\/local\/bin|\/tmp/g,token=>join(root,token==='/tmp'?'tmp':'out'));
  for(const pin of originalHashes)shell=shell.replaceAll(pin,hash);
  // Only paths and the artifact bytes/hash are rebound; the actual RUN control flow executes.
  assertFixtureDownload(shell,server.address().port);assert.ok(!shell.includes('/usr/local/bin'));
  const script=join(root,'install.sh');await writeFile(script,'set -e\n'+shell+'\n');
  const result=await execute('/bin/sh',[script],{cwd:root,env:{PATH:join(root,'bin')+':/usr/bin:/bin',HOME:join(root,'home')}});
  return {...result,requests,urls,installed:await readFile(join(root,'out/gh'),'utf8').catch(()=>null)};
}
for(const arch of ['x86_64','aarch64'])test(`actual Docker RUN retries HTTP504 and installs fixed version for ${arch}`,async t=>{
 const x=await fixture(t,{arch,failures:1});assert.equal(x.code,0,x.stderr);assert.equal(x.requests,2);assert.match(x.installed,/2\.45\.0/);assert.ok(x.urls.every(u=>u.endsWith(arch==='aarch64'?'linux_arm64.tar.gz':'linux_amd64.tar.gz')));
});
test('actual RUN refuses corrupt checksum before installing',async t=>{const x=await fixture(t,{badChecksum:true});assert.notEqual(x.code,0);assert.match(x.stdout+x.stderr,/checksum|FAILED/i);assert.equal(x.installed,null);});
test('actual RUN rejects unsupported architecture before HTTP',async t=>{const x=await fixture(t,{arch:'unsupported'});assert.notEqual(x.code,0);assert.equal(x.requests,0);assert.equal(x.installed,null);});
test('actual RUN verifies the installed version',async t=>{const x=await fixture(t,{version:'0.0.0'});assert.notEqual(x.code,0);assert.ok(x.installed?.includes('0.0.0'),'wrong-version archive must reach version gate');});

test('owned path containing /tmp is rebound once, as on Linux runners',async t=>{const x=await fixture(t,{tmpLayout:true});assert.equal(x.code,0,x.stderr);assert.match(x.installed,/2\.45\.0/);});

test('fixture download guard rejects external authorities and path tricks before shell execution',()=>{
 const owned='http://127.0.0.1:12345/v${GH_VERSION}/gh_${GH_VERSION}_linux_${GH_ARCH}.tar.gz';
 assert.doesNotThrow(()=>assertFixtureDownload('curl \"'+owned+'\"',12345));
 for(const url of [owned+'?query=1',owned+'#fragment',owned.replace('http:','https:'),'http://fixture@127.0.0.1:12345/v${GH_VERSION}/gh_${GH_VERSION}_linux_${GH_ARCH}.tar.gz','http://evil.invalid/package.tgz','http://127.0.0.1.evil.invalid:12345/package.tgz','http://evil.invalid/?next=https://github.com/','http://127.0.0.1:5432/package.tgz','http://127.0.0.1:12345/other.tgz']){
   assert.throws(()=>assertFixtureDownload('curl "'+url+'"',12345),{name:'AssertionError'});
 }
});
