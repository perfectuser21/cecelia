import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, chmodSync, statSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const source = readFileSync(join(root, 'scripts/staging-deploy.sh'), 'utf8');
const helper = readFileSync(join(root, 'scripts/lib/brain-staging.sh'), 'utf8');
const fixtureToken = 'synthetic_fixture_token_' + 'a'.repeat(40);
const legacyDefault = '/Users/administrator/.credentials/cecelia-internal.env';
const fixtures = [];
afterEach(() => { for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture({ docker = true, stagingEnv = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'staging-credentials-')); fixtures.push(dir);
  const bin = join(dir, 'bin'), scripts = join(dir, 'scripts');
  for (const path of [bin, join(scripts, 'lib'), join(dir, 'packages/brain')]) mkdirSync(path, { recursive: true });
  const f = { dir, bin, macHome: join(dir, 'Users/fixture'), linuxHome: join(dir, 'root'),
    script: join(scripts, 'staging-deploy.sh'), trace: join(dir, 'docker.trace'), selected: join(dir, 'selected.path'), openssl: join(dir, 'openssl.called') };
  // 只机械映射旧Mac绝对常量，防止RED误读本机真凭据；其余脚本与helper原文执行。
  expect(source.split(legacyDefault).length - 1).toBeLessThanOrEqual(1);
  writeFileSync(f.script, source.replace(legacyDefault, join(f.macHome, '.credentials/cecelia-internal.env')));
  writeFileSync(join(scripts, 'lib/brain-staging.sh'), helper);
  writeFileSync(join(dir, 'packages/brain/package.json'), '{"version":"9.9.9"}\n');
  if (stagingEnv) writeFileSync(join(dir, '.env.staging'), 'DB_PASSWORD=synthetic_fixture_only\n');
  symlinkSync(process.execPath, join(bin, 'node')); symlinkSync('/usr/bin/dirname', join(bin, 'dirname')); symlinkSync('/bin/mkdir', join(bin, 'mkdir'));
  writeFileSync(join(scripts,'brain-build.sh'),'echo build-reached\nexit 37\n');
  const executable = (name, text) => writeFileSync(join(bin, name), '#!/bin/sh\n' + text, { mode: 0o755 });
  executable('flock','exit 0\n');
  executable('git',`case "$*" in *rev-parse*) printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n";; *show*) printf '{"version":"9.9.9"}\\n';; *) exit 98;; esac\n`);
  executable('openssl', 'printf called > "$OPENSSL_TRACE"\nexit 97\n');
  executable('psql', 'printf forbidden-db >> "$DOCKER_TRACE"\nexit 98\n');
  if (docker) executable('docker', 'printf "%s\\n" "$*" >> "$DOCKER_TRACE"\nprintf "%s\\n" "$CECELIA_INTERNAL_ENV_FILE" > "$SELECTED_PATH"\n[ "$CECELIA_INTERNAL_TOKEN" = "$EXPECTED_FIXTURE_TOKEN" ] || exit 68\nexit 73\n');
  return f;
}
function cache(path, content = `CECELIA_INTERNAL_TOKEN=${fixtureToken}\n`, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content, { mode }); chmodSync(path, mode); return path;
}
const homeCache = home => join(home, '.credentials/cecelia-internal.env');
function run(f, { home = f.linuxHome, override, dry = false, noDocker = false } = {}) {
  const env = { ...process.env, PATH: f.bin + (noDocker ? '' : ':/usr/bin:/bin'), NODE_OPTIONS: '',
    DOCKER_TRACE: f.trace, SELECTED_PATH: f.selected, OPENSSL_TRACE: f.openssl, EXPECTED_FIXTURE_TOKEN: fixtureToken };
  for (const key of ['BASH_ENV', 'ENV', 'CECELIA_INTERNAL_ENV_FILE', 'CECELIA_INTERNAL_TOKEN']) delete env[key];
  if (home === null) delete env.HOME; else env.HOME = home;
  if (override !== undefined) env.CECELIA_INTERNAL_ENV_FILE = override;
  const result = spawnSync('/bin/bash', [f.script, ...(dry ? ['--dry-run'] : [])], { cwd: f.dir, env, encoding: 'utf8', timeout: 10000 });
  expect(result.error).toBeUndefined(); expect((result.stdout || '') + (result.stderr || '')).not.toContain(fixtureToken);
  return { ...result, dockerCalls: existsSync(f.trace) ? readFileSync(f.trace, 'utf8').trim().split('\n') : [],
    selected: existsSync(f.selected) ? readFileSync(f.selected, 'utf8').trimEnd() : null };
}
function expectBuildWithoutCredentials(f, result) {
  expect(result.status,result.stderr).toBe(37);expect(result.stdout).toContain('build-reached');
  expect(result.dockerCalls).toEqual([]);expect(result.selected).toBe(null);expect(existsSync(f.openssl)).toBe(false);
}
function expectRejected(f, result) {
  expect(result.status).not.toBe(0);expect(result.stdout).not.toContain('build-reached');
  expect(result.dockerCalls).toEqual([]);expect(existsSync(f.openssl)).toBe(false);
}

describe('隔离staging入口不消费宿主凭据：保留上游HOME/override边界的真实shell回归',()=>{
  it.each(['macHome','linuxHome'])('%s已有缓存保持字节与权限、不传入候选',key=>{
    const f=fixture(),file=cache(homeCache(f[key]),undefined,0o644),bytes=readFileSync(file);
    expectBuildWithoutCredentials(f,run(f,{home:f[key]}));expect(readFileSync(file)).toEqual(bytes);expect(statSync(file).mode&0o777).toBe(0o644);
  });
  it('空override不读取默认HOME缓存',()=>{
    const f=fixture(),file=cache(homeCache(f.linuxHome));expectBuildWithoutCredentials(f,run(f,{override:''}));expect(readFileSync(file,'utf8')).toContain(fixtureToken);
  });
  it.each([null,'','relative-home'])('显式override与HOME=%s均不提供候选凭据',home=>{
    const f=fixture(),file=cache(join(f.dir,'override with spaces.env'));expectBuildWithoutCredentials(f,run(f,{home,override:file}));expect(readFileSync(file,'utf8')).toContain(fixtureToken);
  });
  it('相对override不按cwd读取或改写',()=>{
    const f=fixture(),file=cache(join(f.dir,'relative.env'));expectBuildWithoutCredentials(f,run(f,{home:null,override:'relative.env'}));expect(readFileSync(file,'utf8')).toContain(fixtureToken);
  });
  it.each([null,'','relative-home'])('无override且HOME=%s不猜账户目录',home=>{
    const f=fixture(),file=cache(homeCache(f.macHome));expectBuildWithoutCredentials(f,run(f,{home}));expect(readFileSync(file,'utf8')).toContain(fixtureToken);
  });
  it('默认缓存缺失仍可构建隔离候选且不创建文件',()=>{
    const f=fixture(),file=homeCache(f.linuxHome);mkdirSync(dirname(file),{recursive:true});cache(homeCache(f.macHome));
    expectBuildWithoutCredentials(f,run(f));expect(existsSync(file)).toBe(false);
  });
  it('错override不回退默认缓存也不生成token',()=>{
    const f=fixture(),missing=join(f.dir,'missing.env');cache(homeCache(f.linuxHome));expectBuildWithoutCredentials(f,run(f,{override:missing}));expect(existsSync(missing)).toBe(false);
  });
  it.each(['','CECELIA_INTERNAL_TOKEN=bad\n',`CECELIA_INTERNAL_TOKEN=${fixtureToken}\nCECELIA_INTERNAL_TOKEN=${fixtureToken}\n`])('坏内容不消费、不改写、不生成凭据',content=>{
    const f=fixture(),file=cache(join(f.dir,'bad.env'),content);cache(homeCache(f.linuxHome));expectBuildWithoutCredentials(f,run(f,{override:file}));expect(readFileSync(file,'utf8')).toBe(content);
  });
  it('目录override不被读取或替换为凭据文件',()=>{
    const f=fixture(),dir=join(f.dir,'credentials-directory');mkdirSync(dir);cache(homeCache(f.linuxHome));expectBuildWithoutCredentials(f,run(f,{override:dir}));expect(statSync(dir).isDirectory()).toBe(true);
  });
  it('dryrun不伪装验收成功，已有凭据只读保持',()=>{
    const f=fixture(),file=cache(homeCache(f.linuxHome),undefined,0o644),bytes=readFileSync(file);expectRejected(f,run(f,{dry:true}));expect(readFileSync(file)).toEqual(bytes);expect(statSync(file).mode&0o777).toBe(0o644);
  });
  it('dryrun缺缓存也不生成凭据或报告就绪',()=>{
    const f=fixture(),file=homeCache(f.linuxHome);mkdirSync(dirname(file),{recursive:true});expectRejected(f,run(f,{dry:true}));expect(existsSync(file)).toBe(false);
  });
  it('无docker失败关闭，不要求HOME或读取凭据',()=>{
    const f=fixture({docker:false}),result=run(f,{home:null,noDocker:true});expectRejected(f,result);expect(result.stdout).not.toContain('STAGING_SKIP_REASON');
  });
  it('无旧staging环境文件仍构建无凭据隔离候选，不自动生成旧环境',()=>{
    const f=fixture({stagingEnv:false});expectBuildWithoutCredentials(f,run(f,{home:null}));expect(existsSync(join(f.dir,'.env.staging'))).toBe(false);
  });
});
