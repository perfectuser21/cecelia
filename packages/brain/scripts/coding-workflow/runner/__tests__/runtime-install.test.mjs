import { it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
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
if(['disable','enable','bootstrap','bootout'].includes(args[0])) {
 const target=${JSON.stringify(state)},temporary=target+'.'+process.pid+'.tmp';
 fs.writeFileSync(temporary,JSON.stringify(s));fs.renameSync(temporary,target);
}`, { mode: 0o755 });
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
it('旧disabled状态拒绝安装，旧plist与服务状态不变', async () => {
  const initial = fs.readFileSync(dest, 'utf8'); fs.writeFileSync(state, JSON.stringify({ disabled: true, active: false }));
  await expect(run({ FAIL_INSTALL: '3' })).rejects.toThrow('runtime_install_disabled');
  expect(fs.readFileSync(dest, 'utf8')).toBe(initial);
  expect(JSON.parse(fs.readFileSync(state)).disabled).toBe(true);
  expect(fs.readFileSync(log, 'utf8').trim().split('\n')).toEqual(['print-disabled system']);
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
  // 起跑即观察拒绝；即使轮询或断言失败，也先等安装/回滚结束再删fixture。
  const pending = run({ FAIL_INSTALL: kind === 'failed' ? '3' : '0' }, control.signal)
    .then(value => ({ value }), error => ({ error }));
  try {
    if (kind === 'cancelled') {
      let bootstrapped = false;
      for (let i = 0; i < 100; i++) {
        if (JSON.parse(fs.readFileSync(state)).loaded) { bootstrapped = true; break; }
        await new Promise(r => setTimeout(r, 20));
      }
      expect(bootstrapped).toBe(true);
      control.abort();
    }
    const outcome = await pending;
    expect(outcome.error).toBeInstanceOf(Error);
    expect(outcome.error.message).toContain('runtime_install_failed');
  } finally {
    control.abort();
    await pending;
  }
  expect(fs.existsSync(dest)).toBe(false);
  expect(JSON.parse(fs.readFileSync(state)).loaded).toBe(false);
  expect(JSON.parse(fs.readFileSync(state)).disabled).toBe(false);
  const commands = fs.readFileSync(log, 'utf8').trim().split('\n');
  expect(commands.filter(c => c.startsWith('bootout'))).toHaveLength(2);
}, 10000);
it('回滚子进程失去归属信息时也保留安装外锁，不假称已收尾', async () => {
  const { withProcessEnv } = await import('../../__tests__/helpers/procs.mjs');
  const flag = path.join(root, 'rollback-ps-fail'); const count = path.join(root, 'ps-count');
  fs.writeFileSync(path.join(root, 'bin/ps'), `#!${process.execPath}
const fs=require('fs'),cp=require('child_process');
if(fs.existsSync(${JSON.stringify(flag)})) {
 const file=${JSON.stringify(count)};const n=fs.existsSync(file)?Number(fs.readFileSync(file)):0;fs.writeFileSync(file,String(n+1));if(n>=2)process.exit(7);
}
process.stdout.write(cp.execFileSync('/bin/ps',process.argv.slice(2)));`, { mode: 0o755 });
  fs.writeFileSync(script, `#!/bin/bash\ntouch '${flag}'\nsleep 0.05\nexit 3\n`);
  await withProcessEnv({ PATH: env.PATH }, async () => {
    await expect(run()).rejects.toThrow('runtime_process_cleanup_unverified');
  });
  expect(fs.existsSync(path.join(env.CODING_WF_LOCK_DIR, 'launcher/coding-workflow-runner.lock'))).toBe(true);
});


it('假launchctl慢写状态时公开JSON始终完整，子进程settle后才清理', async () => {
  const stub = path.join(root, 'bin/launchctl'), paused = path.join(root, 'state-write-paused'), release = path.join(root, 'state-write-release');
  const initial = JSON.parse(fs.readFileSync(state));
  const slowWrite = `const write=fs.writeFileSync.bind(fs);
fs.writeFileSync=(file,data,...rest)=>{
 if(!String(file).startsWith(${JSON.stringify(state)})) return write(file,data,...rest);
 const text=String(data),middle=Math.floor(text.length/2),fd=fs.openSync(file,'w');
 fs.writeSync(fd,text.slice(0,middle));write(${JSON.stringify(paused)},'ready');
 const deadline=Date.now()+5000;
 while(!fs.existsSync(${JSON.stringify(release)})){if(Date.now()>deadline)throw Error('fixture_write_barrier_timeout');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}
 fs.writeSync(fd,text.slice(middle));fs.closeSync(fd);
};`;
  fs.writeFileSync(stub, fs.readFileSync(stub, 'utf8').replace("const fs=require('fs');", "const fs=require('fs');" + slowWrite));
  const child = spawn(process.execPath, [stub, 'disable', 'system/com.cecelia.coding-workflow-runner'], { env, stdio: 'ignore' });
  const settled = new Promise(resolve => {
    child.once('error', error => resolve({ error }));
    child.once('close', code => resolve({ code }));
  });
  try {
    for (let i = 0; i < 100 && !fs.existsSync(paused); i++) await new Promise(r => setTimeout(r, 20));
    expect(fs.existsSync(paused)).toBe(true);
    expect(JSON.parse(fs.readFileSync(state))).toEqual(initial);
  } finally {
    fs.writeFileSync(release, 'continue');
    const result = await settled;
    expect(result.error).toBeUndefined(); expect(result.code).toBe(0);
  }
  expect(JSON.parse(fs.readFileSync(state)).disabled).toBe(true);
}, 10000);
