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
  env = { ...cleanTestEnv(), HOME: home, CODING_WF_PROVIDER: 'codex', CODING_WF_CODEX_HOME: account, PATH: `${bin}:/usr/bin:/bin` };
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
