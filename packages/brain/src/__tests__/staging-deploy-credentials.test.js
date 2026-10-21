import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, chmodSync, statSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const source = readFileSync(join(root, 'scripts/staging-deploy.sh'), 'utf8');
const helper = readFileSync(join(root, 'scripts/lib/internal-auth-token.sh'), 'utf8');
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
  writeFileSync(join(scripts, 'lib/internal-auth-token.sh'), helper);
  writeFileSync(join(dir, 'packages/brain/package.json'), '{"version":"9.9.9"}\n');
  if (stagingEnv) writeFileSync(join(dir, '.env.staging'), 'DB_PASSWORD=synthetic_fixture_only\n');
  symlinkSync(process.execPath, join(bin, 'node')); symlinkSync('/usr/bin/dirname', join(bin, 'dirname'));
  const executable = (name, text) => writeFileSync(join(bin, name), '#!/bin/sh\n' + text, { mode: 0o755 });
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
function expectAuthenticatedImageCheck(result, selected) {
  // 真实鉴权后只到受控镜像检查，绝不进入DB/容器/网络操作。
  expect(result.status).toBe(1); expect(result.stdout).toContain('镜像 cecelia-brain:9.9.9 不存在');
  expect(result.dockerCalls).toEqual(['image inspect cecelia-brain:9.9.9']); expect(result.selected).toBe(selected);
}
function expectRejected(f, result) {
  expect(result.status).not.toBe(0); expect(result.dockerCalls).toEqual([]); expect(existsSync(f.openssl)).toBe(false);
}

describe('staging调用方既有凭据路径：真实shell，不部署、不生成凭据', () => {
  it.each(['macHome', 'linuxHome'])('%s 默认仅消费HOME内既有缓存并保600语义', key => {
    const f = fixture(), file = cache(homeCache(f[key]), undefined, 0o644);
    expectAuthenticatedImageCheck(run(f, { home: f[key] }), file); expect(statSync(file).mode & 0o777).toBe(0o600);
  });
  it('空override仍走合法HOME默认路径', () => {
    const f = fixture(), file = cache(homeCache(f.linuxHome)); expectAuthenticatedImageCheck(run(f, { override: '' }), file);
  });
  it.each([null, '', 'relative-home'])('显式非空override不依赖HOME=%s且不改写路径', home => {
    const f = fixture(), file = cache(join(f.dir, 'override with spaces.env')); expectAuthenticatedImageCheck(run(f, { home, override: file }), file);
  });
  it('现有相对override仍按原调用cwd读取，不猜HOME或改路径', () => {
    const f = fixture(); cache(join(f.dir, 'relative.env')); expectAuthenticatedImageCheck(run(f, { home: null, override: 'relative.env' }), 'relative.env');
  });
  it.each([null, '', 'relative-home'])('无override且HOME=%s不能猜账户目录', home => {
    const f = fixture(); cache(homeCache(f.macHome)); expectRejected(f, run(f, { home }));
  });
  it('默认缓存缺失拒绝且不创建文件', () => {
    const f = fixture(), file = homeCache(f.linuxHome); mkdirSync(dirname(file), { recursive: true }); cache(homeCache(f.macHome));
    expectRejected(f, run(f)); expect(existsSync(file)).toBe(false);
  });
  it('错override缺文件不能回退有效默认缓存或生成token', () => {
    const f = fixture(), missing = join(f.dir, 'missing.env'); cache(homeCache(f.linuxHome));
    expectRejected(f, run(f, { override: missing })); expect(existsSync(missing)).toBe(false);
  });
  it.each(['', 'CECELIA_INTERNAL_TOKEN=bad\n', `CECELIA_INTERNAL_TOKEN=${fixtureToken}\nCECELIA_INTERNAL_TOKEN=${fixtureToken}\n`])('坏内容不改写、不生成新凭据', content => {
    const f = fixture(), file = cache(join(f.dir, 'bad.env'), content); cache(homeCache(f.linuxHome));
    expectRejected(f, run(f, { override: file })); expect(readFileSync(file, 'utf8')).toBe(content);
  });
  it('目录override不能冒充文件或回退', () => {
    const f = fixture(), dir = join(f.dir, 'credentials-directory'); mkdirSync(dir); cache(homeCache(f.linuxHome)); expectRejected(f, run(f, { override: dir }));
  });
  it('dryrun有效缓存只读且不执行docker或权限写入', () => {
    const f = fixture(), file = cache(homeCache(f.linuxHome), undefined, 0o644), bytes = readFileSync(file);
    const result = run(f, { dry: true }); expect(result.status).toBe(0); expect(result.stdout).toContain(file);
    expect(result.dockerCalls).toEqual([]); expect(readFileSync(file)).toEqual(bytes); expect(statSync(file).mode & 0o777).toBe(0o644); expect(existsSync(f.openssl)).toBe(false);
  });
  it('dryrun也不能把缺缓存报为就绪或创建凭据', () => {
    const f = fixture(), file = homeCache(f.linuxHome); mkdirSync(dirname(file), { recursive: true }); expectRejected(f, run(f, { dry: true })); expect(existsSync(file)).toBe(false);
  });
  it('无docker仍保原快返，不要求HOME或读取凭据', () => {
    const f = fixture({ docker: false }); const r = run(f, { home: null, noDocker: true }); expect(r.status).toBe(0); expect(r.stdout).toContain('STAGING_SKIP_REASON=no_docker'); expect(r.dockerCalls).toEqual([]);
  });
  it('无staging环境仍保原快返，不要求HOME或读取凭据', () => {
    const f = fixture({ stagingEnv: false }); const r = run(f, { home: null }); expect(r.status).toBe(0); expect(r.stdout).toContain('STAGING_SKIP_REASON=no_env'); expect(r.dockerCalls).toEqual([]);
  });
});
