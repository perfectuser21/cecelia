import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { prepareUbuntuSources, assertHostedUbuntu } from '../prepare-ubuntu-archive.mjs';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const workflow = yaml.load(readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8'));

for (const [jobName, installName] of [['checks', 'Install test tools'], ['pwa-upgrade', 'Install Chromium']]) {
  test(`${jobName} prepares Ubuntu package sources before mandatory installation`, () => {
    const job = workflow.jobs[jobName];
    const install = job.steps.findIndex(step => step.name === installName);
    const preparation = job.steps.findIndex(step => step.run === 'node scripts/ci/prepare-ubuntu-archive.mjs');
    assert.ok(preparation >= 0 && preparation < install, 'trusted Ubuntu source validation must run before package installation');
    const step = job.steps[preparation];
    assert.equal(step.if, undefined);
    assert.equal(step['continue-on-error'], undefined);
    assert.equal(step['working-directory'] ?? job.defaults?.run?.['working-directory'] ?? '.', '.');
    assert.equal(job.steps[install].if, undefined);
    assert.equal(job.steps[install]['continue-on-error'], undefined);
    if (jobName === 'pwa-upgrade') assert.equal(job.steps[install].run, 'node e2e/playwright-cli.mjs install chromium --with-deps');
  });
}

const stanza = (suite, uri = 'mirror+file:/etc/apt/apt-mirrors.txt') =>
  `Types: deb\nURIs: ${uri}\nSuites: ${suite}\nComponents: main restricted universe multiverse\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n`;
const thirdParty = '# Separate package owner\nTypes: deb\nURIs: https://packages.example.test/repo\nSuites: stable\nComponents: main\nSigned-By: /usr/share/keyrings/third-party.gpg\n';

test('Ubuntu native mirror selection, suites, signing and third-party sources remain unchanged', () => {
  const primary = stanza('noble noble-updates noble-backports');
  const security = stanza('noble-security', 'mirror+file:/etc/apt/apt-mirrors-security.txt');
  const input = primary + '\n' + security + '\n' + thirdParty;
  const actual = prepareUbuntuSources(input,nativeOptions);
  assert.equal(actual,input);
  assert.equal(prepareUbuntuSources(actual,nativeOptions), actual);
});

test('Azure Ubuntu URI and security suites remain intact', () => {
  assert.equal(prepareUbuntuSources(stanza('noble-security', 'http://azure.archive.ubuntu.com/ubuntu')),
    stanza('noble-security', 'http://azure.archive.ubuntu.com/ubuntu'));
});

test('official Ubuntu archive and security sources remain unchanged', () => {
  const primary = stanza('noble noble-updates noble-backports', 'https://archive.ubuntu.com/ubuntu');
  const security = stanza('noble-security', 'https://security.ubuntu.com/ubuntu');
  const input = primary + '\n' + security + '\n' + thirdParty;
  const actual = prepareUbuntuSources(input);
  assert.equal(actual, input);
  assert.equal(prepareUbuntuSources(actual), actual);
});

test('Windows line endings and comments are retained', () => {
  const input = ('# Ubuntu archive\n' + stanza('noble')).replaceAll('\n', '\r\n');
  assert.equal(prepareUbuntuSources(input,nativeOptions), input);
});

test('unsupported Ubuntu sources fail before any source file can be written', () => {
  for (const input of [
    stanza('noble', 'https://unknown.example/ubuntu'),
    stanza('noble noble-security'),
    stanza('noble').replace('Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n', ''),
    stanza('noble').replace('Suites: noble', 'Suites:'),
    stanza('noble').replace('Types: deb', 'Types: deb\nTypes: deb-src'),
    stanza('noble').replace('Suites: noble', 'Suites: noble\n noble-updates'),
    thirdParty,
  ]) assert.throws(() => prepareUbuntuSources(input), /ubuntu_source/);
});

test('only GitHub-hosted Linux Ubuntu can prepare the fixed package source file', () => {
  const env = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Linux' };
  assert.doesNotThrow(() => assertHostedUbuntu(env, 'linux', 'ID=ubuntu\n'));
  for (const [changedEnv, platform, release] of [
    [{ ...env, GITHUB_ACTIONS: 'false' }, 'linux', 'ID=ubuntu\n'],
    [{ ...env, RUNNER_ENVIRONMENT: 'self-hosted' }, 'linux', 'ID=ubuntu\n'],
    [{ ...env, RUNNER_OS: 'Windows' }, 'linux', 'ID=ubuntu\n'],
    [env, 'darwin', 'ID=ubuntu\n'],
    [env, 'linux', 'ID=debian\n'],
  ]) assert.throws(() => assertHostedUbuntu(changedEnv, platform, release), /github_hosted_ubuntu_required/);
});

test('CLI refuses a non-Actions process with a nonzero exit', () => {
  const child = spawnSync(process.execPath, [new URL('../prepare-ubuntu-archive.mjs', import.meta.url).pathname],
    { env: { PATH: process.env.PATH, GITHUB_ACTIONS: 'false' }, encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
});

test('Ubuntu archive and security native mirror failover stays independent of third-party stanzas', () => {
  const input = stanza('noble noble-updates noble-backports') + '\n'
    + stanza('noble-security', 'mirror+file:/etc/apt/apt-mirrors-security.txt') + '\n' + thirdParty;
  assert.equal(prepareUbuntuSources(input,nativeOptions), input);
  assert.equal(prepareUbuntuSources(input,nativeOptions), input);
});

test('previously prepared kernel mirror sources recover to official endpoints by suite', () => {
  const failedMirror = 'https://mirrors.edge.kernel.org/ubuntu';
  const input = stanza('noble noble-updates', failedMirror) + '\n' + stanza('noble-security', failedMirror);
  assert.equal(prepareUbuntuSources(input), stanza('noble noble-updates', 'https://archive.ubuntu.com/ubuntu')
    + '\n' + stanza('noble-security', 'https://security.ubuntu.com/ubuntu'));
});

const nativeMirrors = 'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n';
const nativeOptions = { readMirrorList: path => {
  assert.ok(['/etc/apt/apt-mirrors.txt', '/etc/apt/apt-mirrors-security.txt'].includes(path));
  return nativeMirrors;
} };
test('trusted Ubuntu26 native failover preserves exact URIs, suites, key and third-party stanzas', () => {
  const input=stanza('resolute resolute-updates resolute-backports')+'\n'+stanza('resolute-security')+'\n'+thirdParty;
  assert.equal(prepareUbuntuSources(input,nativeOptions),input);
  assert.equal(prepareUbuntuSources(input,nativeOptions),input);
});
for(const uri of ['http://azure.archive.ubuntu.com/ubuntu/','https://azure.archive.ubuntu.com/ubuntu'])test(`trusted direct Azure source is preserved without singleton rewrite: ${uri}`,()=>{
 const input=stanza('resolute resolute-updates',uri)+'\n'+stanza('resolute-security',uri);
 assert.equal(prepareUbuntuSources(input),input);
});
test('native indirect source cannot hide an untrusted, malformed or unreadable mirror list',()=>{
 for(const text of [nativeMirrors+'https://evil.invalid/ubuntu/\tpriority:0\n',nativeMirrors.replace('priority:1','priority:0'),nativeMirrors.replace('http://azure.archive.ubuntu.com','http://azure.archive.ubuntu.com.evil.invalid'),'']) {
  assert.throws(()=>prepareUbuntuSources(stanza('resolute'),{readMirrorList:()=>text}),/ubuntu_source/);
 }
 assert.throws(()=>prepareUbuntuSources(stanza('resolute'),{readMirrorList:()=>{throw Error('unreadable');}}),/ubuntu_source/);
});
test('untrusted suite, signing and duplicate fields remain rejected on native sources',()=>{
 for(const input of [stanza('bookworm'),stanza('resolute noble-updates'),stanza('resolute-security resolute'),stanza('resolute').replace('ubuntu-archive-keyring.gpg','wrong.gpg'),stanza('resolute')+'URIs: https://archive.ubuntu.com/ubuntu\n',stanza('resolute','mirror+file:/tmp/apt-mirrors.txt')]) {
  assert.throws(()=>prepareUbuntuSources(input,{...nativeOptions,expectedCodename:'resolute'}),/ubuntu_source/);
 }
});

test('native suites follow actual runner codename without a hardcoded Ubuntu generation list',()=>{
 for(const codename of ['resolute','futureubuntu']){
  const input=stanza(`${codename} ${codename}-updates ${codename}-backports`)+'\n'+stanza(`${codename}-security`);
  assert.equal(prepareUbuntuSources(input,{...nativeOptions,expectedCodename:codename}),input);
  assert.throws(()=>prepareUbuntuSources(input,{...nativeOptions,expectedCodename:'otherubuntu'}),/ubuntu_source_suites/);
 }
});

test('trusted native mirror priority changes remain byte-for-byte upstream-owned',()=>{
 const input=stanza('resolute');const list=nativeMirrors.replace('priority:1','priority:20').replace('priority:2\n','priority:10\n');
 assert.equal(prepareUbuntuSources(input,{readMirrorList:()=>list,expectedCodename:'resolute'}),input);
});

test('rejected public Ubuntu URI reports only safe fixed-file coordinates and URL structure',()=>{
 const uri='http://user:private_token@unrecognized.archive.ubuntu.com/ubuntu/?secret=private_query#private_fragment';
 let rejected;try{prepareUbuntuSources(stanza('resolute',uri));}catch(e){rejected=e;}
 assert.ok(rejected);assert.match(rejected.message,/ubuntu_source_uri_unsupported/);
 assert.match(rejected.message, /"file":"\/etc\/apt\/sources.list.d\/ubuntu.sources"/);
 assert.match(rejected.message,/"line":2/);assert.match(rejected.message,/"protocol":"http:"/);
 assert.match(rejected.message,/"hostname":"unrecognized.archive.ubuntu.com"/);
 assert.match(rejected.message,/"pathname":"\/ubuntu\/"/);
 assert.doesNotMatch(rejected.message,/user|private_token|private_query|private_fragment|secret=/);
});
test('native mirror refusal reports public endpoint and numeric priority without relaxing trust',()=>{
 const text=nativeMirrors+'http://unrecognized.archive.ubuntu.com/ubuntu/\tpriority:1\n';
 let rejected;try{prepareUbuntuSources(stanza('resolute'),{readMirrorList:()=>text});}catch(e){rejected=e;}
 assert.ok(rejected);assert.match(rejected.message,/"file":"\/etc\/apt\/apt-mirrors.txt"/);
 assert.match(rejected.message,/"line":4/);assert.match(rejected.message,/"priority":1/);
 assert.match(rejected.message,/"hostname":"unrecognized.archive.ubuntu.com"/);
});
test('unknown URI diagnostics expose only type and length, not host, path or credentials',()=>{
 const uri='https://unknown_user:private_token@unknown.invalid/private_path?secret=private_query#private_fragment';
 let rejected;try{prepareUbuntuSources(stanza('resolute',uri));}catch(e){rejected=e;}
 assert.ok(rejected);assert.match(rejected.message,/"type":"uri"/);assert.match(rejected.message,new RegExp('"length":'+uri.length));
 assert.doesNotMatch(rejected.message,/unknown_user|private_token|unknown.invalid|private_path|private_query|private_fragment/);
});

// 真实runner诊断：ubuntu26/20261116.88，apt-mirrors.txt:1 priority:1；
// 三源列表的其余两行按runner-images官方main构造，不声称拿到了exact-tag文件。
const awsNativeMirrors = 'http://us-east-2.ec2.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n';
test('confirmed AWS runner native three-source failover remains byte-for-byte intact',()=>{
 const input=stanza('resolute resolute-updates resolute-backports')+'\n'+stanza('resolute-security')+'\n'+thirdParty;
 assert.equal(prepareUbuntuSources(input,{readMirrorList:()=>awsNativeMirrors,expectedCodename:'resolute'}),input);
});
for(const uri of ['http://us-east-2.ec2.archive.ubuntu.com/ubuntu','http://us-east-2.ec2.archive.ubuntu.com/ubuntu/'])test(`exact confirmed AWS direct source remains intact: ${uri}`,()=>{
 const input=stanza('resolute',uri)+'\n'+stanza('resolute-security',uri);
 assert.equal(prepareUbuntuSources(input,{expectedCodename:'resolute'}),input);
});
test('AWS addition does not generalize regions, hostname suffixes or invalid priority',()=>{
 for(const uri of ['http://us-east-1.ec2.archive.ubuntu.com/ubuntu/','http://us-east-2.ec2.archive.ubuntu.com.evil.invalid/ubuntu/']) {
  assert.throws(()=>prepareUbuntuSources(stanza('resolute',uri)),/ubuntu_source_uri_unsupported/);
  assert.throws(()=>prepareUbuntuSources(stanza('resolute'),{readMirrorList:()=>awsNativeMirrors.replace('http://us-east-2.ec2.archive.ubuntu.com/ubuntu/',uri)}),/ubuntu_source/);
 }
 assert.throws(()=>prepareUbuntuSources(stanza('resolute'),{readMirrorList:()=>awsNativeMirrors.replace('priority:1','priority:0')}),/ubuntu_source/);
});
