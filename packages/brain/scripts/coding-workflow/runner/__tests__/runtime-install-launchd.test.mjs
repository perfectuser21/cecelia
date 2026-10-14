import { it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withInstallation } from '../runtime-install.mjs';
import { cleanTestEnv } from './helpers/sandbox.mjs';

let root, env, dest, state, script, log;
const label = 'com.cecelia.coding-workflow-runner';
const original = '<plist><dict><key>EnvironmentVariables</key><dict><key>CODING_WF_REPOS</key><string>cecelia</string></dict></dict></plist>';
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-launchd-semantics-'));
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  dest = path.join(root, 'runner.plist'); state = path.join(root, 'state.json');
  script = path.join(root, 'prepare.sh'); log = path.join(root, 'commands.jsonl');
  fs.writeFileSync(dest, original);
  fs.writeFileSync(state, JSON.stringify({ disabled: false, loaded: true, format: 'words' }));
  env = { ...cleanTestEnv(), HOME: root, PATH: `${bin}:${process.env.PATH}`, CODING_WF_LOCK_DIR: path.join(root, 'locks') };
  // 模拟实机关键语义：disabled 服务 bootstrap 返回 5；所有操作必须仍持外锁。
  fs.writeFileSync(path.join(bin, 'launchctl'), String.raw`#!${process.execPath}
const fs=require('fs'),args=process.argv.slice(2),file=${JSON.stringify(state)},s=JSON.parse(fs.readFileSync(file));
const save=()=>fs.writeFileSync(file,JSON.stringify(s));
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({op:args[0],locked:fs.existsSync(${JSON.stringify(path.join(env.CODING_WF_LOCK_DIR, 'launcher/coding-workflow-runner.lock'))})})+'\n');
if(args[0]==='print-disabled') console.log('disabled services = {\n "${label}" => '+(s.rawValue??(s.format==='boolean'?s.disabled:(s.disabled?'disabled':'enabled')))+'\n}');
else if(args[0]==='print') {if(!s.loaded){console.error('Could not find service "${label}" in domain for system');process.exit(113);}console.log('active count = 0\nstate = not running');}
else if(args[0]==='disable'||args[0]==='enable') {if(s.failRestore && args[0]==='disable' && s.boots){process.exit(8);}s.disabled=args[0]==='disable';}
else if(args[0]==='bootout'){if(s.failBootout){process.exit(9);}s.loaded=false;}
else if(args[0]==='bootstrap') {
 if(s.disabled){console.error('Bootstrap failed: 5: Input/output error');process.exit(5);}
 s.boots=(s.boots||0)+1;
 if(s.failBoots && s.boots<=s.failBoots){save();process.exit(7);}
 s.loaded=true;s.contents=fs.readFileSync(args[2],'utf8');
}
save();`, { mode: 0o755 });
  fs.writeFileSync(script, `#!/bin/bash\nprintf changed > '${dest}'\nexit 0\n`);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const get = () => JSON.parse(fs.readFileSync(state));
const set = values => fs.writeFileSync(state, JSON.stringify({ ...get(), ...values }));
const run = () => withInstallation({ script, dest, env });
const commands = () => fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);

it.each(['words', 'boolean'])('真实%s格式：成功安装加载新版并保持原disabled', async format => {
  set({ disabled: true, loaded: false, format });
  expect(await run()).toBe(0);
  expect(get()).toMatchObject({ disabled: true, loaded: true, contents: 'changed' });
  const ops = commands(); expect(ops.every(x => x.locked)).toBe(true);
  expect(ops.findIndex(x => x.op === 'enable')).toBeLessThan(ops.findIndex(x => x.op === 'bootstrap'));
});
it('原enabled/loaded：先卸载旧配置再加载新版，仍保持enabled', async () => {
  expect(await run()).toBe(0);
  expect(get()).toMatchObject({ disabled: false, loaded: true, contents: 'changed' });
  expect(commands().filter(x => ['bootout', 'enable', 'bootstrap'].includes(x.op)).map(x => x.op)).toEqual(['bootout', 'enable', 'bootstrap', 'enable']);
});
it.each([false, true])('新bootstrap失败：恢复旧loaded服务和disabled=%s', async disabled => {
  set({ disabled, failBoots: 1 });
  await expect(run()).rejects.toThrow('runtime_install_launchctl_bootstrap_failed');
  expect(get()).toMatchObject({ loaded: true, disabled, contents: original });
  expect(fs.readFileSync(dest, 'utf8')).toBe(original);
});
it('新bootstrap与回滚bootstrap均失败：仍恢复原disabled且明确诊断/保锁', async () => {
  set({ disabled: true, failBoots: 2 });
  await expect(run()).rejects.toThrow('runtime_install_rollback_failed');
  expect(get()).toMatchObject({ disabled: true, loaded: false });
  expect(fs.readFileSync(dest, 'utf8')).toBe(original);
  expect(fs.existsSync(path.join(env.CODING_WF_LOCK_DIR, 'launcher/coding-workflow-runner.lock'))).toBe(true);
});
it('原unloaded，新bootstrap失败不得在回滚时启动旧plist', async () => {
  set({ loaded: false, disabled: true, failBoots: 1 });
  await expect(run()).rejects.toThrow('runtime_install_launchctl_bootstrap_failed');
  expect(get()).toMatchObject({ loaded: false, disabled: true, boots: 1 });
  expect(fs.readFileSync(dest, 'utf8')).toBe(original);
});
it('禁用状态恢复失败也显式失败，回滚文件并保锁', async () => {
  set({ loaded: false, disabled: true, failRestore: true });
  await expect(run()).rejects.toThrow('runtime_install_rollback_failed');
  expect(get()).toMatchObject({ loaded: false });
  expect(fs.readFileSync(dest, 'utf8')).toBe(original);
  expect(fs.existsSync(path.join(env.CODING_WF_LOCK_DIR, 'launcher/coding-workflow-runner.lock'))).toBe(true);
});
it('目标label存在但状态词未知时拒绝，不猜成enabled', async () => {
  set({ rawValue: 'unknown' });
  await expect(run()).rejects.toThrow('runtime_install_disabled_state_unknown');
  expect(commands().map(x => x.op)).toEqual(['print-disabled']);
  expect(fs.readFileSync(dest, 'utf8')).toBe(original);
});
it('回滚读取plist失败：仍恢复原enabled位并保锁，不盲目bootstrap', async () => {
  fs.writeFileSync(script, `#!/bin/bash\nrm '${dest}'\nmkdir '${dest}'\nexit 3\n`);
  await expect(run()).rejects.toThrow('runtime_install_rollback_failed');
  expect(get().disabled).toBe(false);
  expect(commands().some(x => x.op === 'bootstrap')).toBe(false);
  expect(fs.existsSync(path.join(env.CODING_WF_LOCK_DIR, 'launcher/coding-workflow-runner.lock'))).toBe(true);
});
