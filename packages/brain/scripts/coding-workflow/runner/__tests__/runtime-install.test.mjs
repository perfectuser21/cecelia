import { it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanTestEnv } from './helpers/sandbox.mjs';
let root, env, script, dest, state, log;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-runtime-install-'));
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  dest = path.join(root, 'runner.plist'); state = path.join(root, 'state.json'); log = path.join(root, 'commands'); script = path.join(root, 'install.sh');
  fs.writeFileSync(dest, '<?xml version="1.0"?><plist version="1.0"><dict><key>EnvironmentVariables</key><dict><key>CODING_WF_AUTOMERGE</key><string>0</string></dict></dict></plist>');
  fs.writeFileSync(state, JSON.stringify({ disabled: false, active: false, loaded: true }));
  fs.writeFileSync(path.join(bin, 'launchctl'), `#!${process.execPath}
const fs=require('fs');const args=process.argv.slice(2);const s=JSON.parse(fs.readFileSync(${JSON.stringify(state)},'utf8'));
fs.appendFileSync(${JSON.stringify(log)},args.join(' ')+'\\n');
if(args[0]==='print-disabled') console.log('"com.cecelia.coding-workflow-runner" => '+s.disabled);
else if(args[0]==='print' && s.loaded===false) { console.error('Could not find service \"com.cecelia.coding-workflow-runner\" in domain for system'); process.exit(113); }
else if(args[0]==='print') console.log('active count = '+(s.active?1:0)+'\\nstate = '+(s.active?'running':'not running'));
else if(args[0]==='disable') s.disabled=true;
else if(args[0]==='enable') s.disabled=false;
else if(args[0]==='bootstrap') { s.loaded=true; s.contents=fs.readFileSync(args[2],'utf8'); }
else if(args[0]==='bootout') s.loaded=false;
fs.writeFileSync(${JSON.stringify(state)},JSON.stringify(s));`, { mode: 0o755 });
  fs.writeFileSync(script, `#!/bin/bash\nprintf '%s' "$CODING_WF_AUTOMERGE" > '${root}/automerge'\nprintf changed > '${dest}'\nlaunchctl bootout system/com.cecelia.coding-workflow-runner\nlaunchctl bootstrap system '${dest}'\nexit "\${FAIL_INSTALL:-0}"\n`);
  env = { ...cleanTestEnv(), PATH: `${bin}:${process.env.PATH}`, HOME: root, CODING_WF_LOCK_DIR: path.join(root, 'locks') };
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
async function run(extra = {}, signal) {
  const { withInstallation } = await import('../runtime-install.mjs');
  return withInstallation({ script, dest, env: { ...env, ...extra }, signal });
}
it('安装持同一外锁，保留旧AUTOMERGE=0并恢复启用', async () => {
  fs.appendFileSync(script, '');
  expect(await run()).toBe(0);
  expect(fs.readFileSync(path.join(root, 'automerge'), 'utf8')).toBe('0');
  expect(JSON.parse(fs.readFileSync(state)).disabled).toBe(false);
  expect(fs.existsSync(path.join(env.CODING_WF_LOCK_DIR, 'launcher/coding-workflow-runner.lock'))).toBe(false);
});
it('活动daemon拒装，旧plist原样且重新启用', async () => {
  const initial = fs.readFileSync(dest, 'utf8'); fs.writeFileSync(state, JSON.stringify({ disabled: false, active: true }));
  await expect(run()).rejects.toThrow('runtime_install_daemon_active');
  expect(fs.readFileSync(dest, 'utf8')).toBe(initial);
  expect(JSON.parse(fs.readFileSync(state)).disabled).toBe(false);
  expect(fs.readFileSync(log, 'utf8')).not.toContain('bootout');
});
it('启动器外锁已占用则拒装，旧plist不变、不触及launchctl', async () => {
  const initial = fs.readFileSync(dest, 'utf8'); const lock = path.join(env.CODING_WF_LOCK_DIR, 'launcher/coding-workflow-runner.lock'); fs.mkdirSync(lock, { recursive: true });
  fs.writeFileSync(path.join(lock, 'pid'), String(process.pid));
  await expect(run()).rejects.toThrow('runtime_install_launcher_busy');
  expect(fs.readFileSync(dest, 'utf8')).toBe(initial); expect(fs.existsSync(log)).toBe(false);
});
it('安装失败恢复旧plist并显式失败，旧disabled状态也保留', async () => {
  const initial = fs.readFileSync(dest, 'utf8'); fs.writeFileSync(state, JSON.stringify({ disabled: true, active: false }));
  await expect(run({ FAIL_INSTALL: '3' })).rejects.toThrow('runtime_install_failed');
  expect(fs.readFileSync(dest, 'utf8')).toBe(initial);
  expect(JSON.parse(fs.readFileSync(state)).disabled).toBe(true);
  expect(JSON.parse(fs.readFileSync(state)).contents).toBe(initial);
});
it('明确指定AUTOMERGE=1可覆盖旧0', async () => {
  expect(await run({ CODING_WF_AUTOMERGE: '1' })).toBe(0);
  expect(fs.readFileSync(path.join(root, 'automerge'), 'utf8')).toBe('1');
});

it('旧plist存在但原unloaded：前置失败不得bootstrap或改变文件', async () => {
  const initial = fs.readFileSync(dest, 'utf8'); fs.writeFileSync(state, JSON.stringify({ disabled: false, active: false, loaded: false }));
  fs.writeFileSync(script, '#!/bin/bash\nexit 3\n');
  await expect(run()).rejects.toThrow('runtime_install_failed');
  expect(fs.readFileSync(dest, 'utf8')).toBe(initial);
  expect(JSON.parse(fs.readFileSync(state)).loaded).toBe(false);
  expect(fs.readFileSync(log, 'utf8')).not.toContain('bootstrap');
});
it('旧服务loaded但前置失败未修改plist时不重启旧服务', async () => {
  fs.writeFileSync(script, '#!/bin/bash\nexit 3\n');
  await expect(run()).rejects.toThrow('runtime_install_failed');
  expect(fs.readFileSync(log, 'utf8')).not.toContain('bootout');
  expect(fs.readFileSync(log, 'utf8')).not.toContain('bootstrap');
});
it.each(['failed', 'cancelled'])('首次安装已bootstrap后%s，必须卸载新服务再恢复原状态', async kind => {
  fs.unlinkSync(dest); fs.writeFileSync(state, JSON.stringify({ disabled: false, active: false, loaded: false }));
  const control = new AbortController();
  if (kind === 'cancelled') fs.appendFileSync(script, 'sleep 30\n');
  // 原脚本末尾exit需改成等待，让取消发生在bootstrap后。
  if (kind === 'cancelled') fs.writeFileSync(script, fs.readFileSync(script, 'utf8').replace('exit "${FAIL_INSTALL:-0}"', ':'));
  const pending = run({ FAIL_INSTALL: kind === 'failed' ? '3' : '0' }, control.signal);
  if (kind === 'cancelled') {
    for (let i = 0; i < 100 && !JSON.parse(fs.readFileSync(state)).loaded; i++) await new Promise(r => setTimeout(r, 20));
    control.abort();
  }
  await expect(pending).rejects.toThrow('runtime_install_failed');
  expect(fs.existsSync(dest)).toBe(false);
  expect(JSON.parse(fs.readFileSync(state)).loaded).toBe(false);
  expect(JSON.parse(fs.readFileSync(state)).disabled).toBe(false);
  const commands = fs.readFileSync(log, 'utf8').trim().split('\n');
  expect(commands.filter(c => c.startsWith('bootout'))).toHaveLength(2);
}, 10000);
