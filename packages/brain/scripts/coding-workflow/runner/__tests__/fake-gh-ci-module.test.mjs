import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const fixture = fileURLToPath(new URL('./fixtures/fake-gh-ci.mjs', import.meta.url));
const roots = [];
function sandbox() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cw-gh-module-')));
  roots.push(root);
  const state = path.join(root, 'state.json'), log = path.join(root, 'gh.log');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('FAKE_GH')));
  return { root, state, log, env: { ...env, FAKE_GH_CI: state, FAKE_GH_LOG: log } };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
it('真实import只提供CLI自身路径，不读取回放状态、不写调用日志、不退出宿主', () => {
  const s = sandbox();
  const code = `const m=await import(${JSON.stringify(pathToFileURL(fixture).href)}); console.log(JSON.stringify({ returned:true,path:m.FAKE_GH_CI }));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...s.env, FAKE_GH_EXIT: '23' }, encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ returned: true, path: fixture });
  expect(fs.existsSync(s.log)).toBe(false);
  expect(fs.existsSync(s.state)).toBe(false);
});
it('实际绝对路径CLI保留required checks的0/1/8退出码与JSON输出', () => {
  const s = sandbox();
  for (const [bucket, code] of [['pass', 0], ['fail', 1], ['pending', 8]]) {
    const rows = [{ name: 'ci-passed', bucket }];
    fs.writeFileSync(s.state, JSON.stringify({ required: { 77: rows } }));
    const result = spawnSync(process.execPath, [fixture, 'pr', 'checks', '77', '--required'], { env: s.env, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(code);
    expect(JSON.parse(result.stdout)).toEqual(rows);
  }
  expect(fs.readFileSync(s.log, 'utf8').trim().split('\n').map(JSON.parse)).toEqual(Array.from({ length: 3 }, () => ['pr', 'checks', '77', '--required']));
});
it('相对路径与真实可执行软链CLI均运行，import同一软链仍无副作用', () => {
  const s = sandbox();
  fs.writeFileSync(s.state, JSON.stringify({ prs: [{ number: 77 }] }));
  const link = path.join(s.root, 'gh'); fs.symlinkSync(fixture, link);
  for (const command of ['relative', 'symlink']) {
    const result = command === 'relative'
      ? spawnSync(process.execPath, [path.relative(s.root, fixture), 'pr', 'list'], { cwd: s.root, env: s.env, encoding: 'utf8' })
      : spawnSync(link, ['pr', 'list'], { cwd: s.root, env: s.env, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([{ number: 77 }]);
  }
  const before = fs.readFileSync(s.log, 'utf8');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(link).href)});console.log('returned')`], { env: s.env, encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe('returned');
  expect(fs.readFileSync(s.log, 'utf8')).toBe(before);
});
