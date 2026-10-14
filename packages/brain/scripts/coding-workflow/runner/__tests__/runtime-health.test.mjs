import { it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanTestEnv } from './helpers/sandbox.mjs';
const entry = fileURLToPath(new URL('../runtime-health.mjs', import.meta.url));
let root, home, account, bin, env;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-health-'));
  home = path.join(root, 'home'); account = path.join(root, 'account'); bin = path.join(root, 'bin');
  for (const dir of [home, account, bin]) fs.mkdirSync(dir);
  env = { ...cleanTestEnv(), HOME: home, CODING_WF_PROVIDER: 'codex', CODING_WF_CODEX_MODEL: 'gpt-6-sol', CODING_WF_JUDGE_MODEL: 'gpt-6-astra', CODING_WF_JUDGE_PROVIDER: 'codex', CODING_WF_CODEX_HOME: account, PATH: `${bin}:/usr/bin:/bin` };
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function fake(body) { fs.writeFileSync(path.join(bin, 'codex'), `#!/bin/sh\n${body}\n`, { mode: 0o755 }); }
const run = (extra = {}) => spawnSync(process.execPath, [entry], { env: { ...env, ...extra }, encoding: 'utf8', timeout: 5000 });
it('真实CLI形状：独立CODEX_HOME且HOME不变，API key不参与登录预检', () => {
  fake(`printf '%s\\n' "$HOME" "$CODEX_HOME" "$OPENAI_API_KEY" "$CODEX_API_KEY" "$CODEX_ACCESS_TOKEN" > "${root}/seen"\nprintf 'Logged in using ChatGPT\\n' >&2`);
  const r = run({ OPENAI_API_KEY: 'must-not-leak', CODEX_API_KEY: 'must-not-leak', CODEX_ACCESS_TOKEN: 'must-not-leak' });
  expect(r.status, r.stderr).toBe(0);
  expect(fs.readFileSync(path.join(root, 'seen'), 'utf8')).toBe(`${home}\n${account}\n\n\n\n`);
  expect(r.stdout + r.stderr).not.toContain('must-not-leak');
});
it.each(['missing-home', 'missing-cli', 'logged-out', 'api-key', 'unknown-output', 'unknown-provider'])('预检 %s 失败关闭', (kind) => {
  fake(kind === 'logged-out' ? 'echo "Not logged in"; exit 1' : kind === 'api-key' ? 'echo "Logged in using an API key: fake-secret"' : kind === 'unknown-output' ? 'echo "unknown fake-secret"' : 'echo "Logged in using ChatGPT"');
  if (kind === 'missing-cli') fs.unlinkSync(path.join(bin, 'codex'));
  const r = run(kind === 'missing-home' ? { CODING_WF_CODEX_HOME: path.join(root, 'missing') } : kind === 'unknown-provider' ? { CODING_WF_PROVIDER: 'oops' } : {});
  expect(r.status).not.toBe(0);
  expect(r.stdout + r.stderr).not.toContain('fake-secret');
});

it.each([
  [{ CODING_WF_CODEX_MODEL: '' }, 'runtime_models_missing'],
  [{ CODING_WF_JUDGE_MODEL: '' }, 'runtime_models_missing'],
  [{ CODING_WF_JUDGE_MODEL: 'gpt-6-sol' }, 'runtime_judge_model_not_independent'],
  [{ CODING_WF_JUDGE_PROVIDER: 'claude' }, 'runtime_judge_provider_not_codex'],
])('模型和judge配置拒绝不明确或不独立的设置', (extra, reason) => {
  fake('echo "Logged in using ChatGPT"');
  const r = run(extra);
  expect(r.status).not.toBe(0);
  expect(r.stderr).toContain(reason);
});

it('预检与真实配置使用同一个Codex binary，不能查错PATH账户', () => {
  fake('echo "Not logged in"; exit 1');
  const selected = path.join(root, 'selected-codex');
  fs.writeFileSync(selected, '#!/bin/sh\necho "Logged in using ChatGPT"\n', { mode: 0o755 });
  expect(run({ CODING_WF_CODEX_BIN: selected }).status).toBe(0);
});

it.each(['missing', 'wrong-version'])('Codex runtime 的 Acorn %s 在领单前拒绝', kind => {
  fake('echo "Logged in using ChatGPT"');
  const isolated = path.join(root, 'isolated');
  fs.mkdirSync(isolated);
  for (const name of ['runtime-health.mjs', 'runtime-process.mjs']) {
    fs.copyFileSync(path.join(path.dirname(entry), name), path.join(isolated, name));
  }
  if (kind === 'wrong-version') {
    const pkg = path.join(isolated, 'node_modules/acorn');
    fs.mkdirSync(pkg, {recursive:true});
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({name:'acorn',version:'8.15.0',type:'module',exports:'./index.mjs'}));
    fs.writeFileSync(path.join(pkg, 'index.mjs'), 'export const version="8.15.0"; export function parse() {}');
  }
  const r = spawnSync(process.execPath, [path.join(isolated, 'runtime-health.mjs')], {env,encoding:'utf8',timeout:5000});
  expect(r.status).not.toBe(0);
  expect(r.stderr).toContain('runtime_acorn_');
});
