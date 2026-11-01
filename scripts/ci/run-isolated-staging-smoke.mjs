import {spawn} from 'node:child_process';
import {copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';

const smoke = 'scripts/smoke/dashboard-staging-gate-smoke.sh';
const helpers = ['deploy-local.sh', 'promote-dashboard.sh', 'dashboard-staging-selfcheck.sh', 'dashboard-slot-server.cjs', 'dev-preview.sh'];
const sleep = ms => new Promise(done => setTimeout(done, ms));

async function unusedPortRange() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const servers = [];
    try {
      for (let offset = 0; offset < 4; offset++) {
        const server = createServer();
        servers.push(server);
        const port = offset ? servers[0].address().port + offset : 0;
        if (port > 65535) throw new Error('端口范围越界');
        await new Promise((done, reject) => server.once('error', reject).listen(port, '0.0.0.0', done));
      }
      return servers[0].address().port;
    } catch (error) {
      if (!['EADDRINUSE', 'EACCES'].includes(error.code) && error.message !== '端口范围越界') throw error;
    } finally {
      await Promise.all(servers.filter(server => server.listening).map(server => new Promise(done => server.close(done))));
    }
  }
  throw new Error('无法分配独立staging测试端口');
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== smoke) throw new Error('只允许独立副本中的dashboard staging fixture');
  const source = resolve(process.cwd());
  const isolated = mkdtempSync(join(tmpdir(), 'cecelia-staging-fixture-'));
  let child, timer, cancelled = false;
  const stopGroup = signal => {
    if (child?.pid) {
      try { process.kill(-child.pid, signal); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  };
  const cancel = () => { cancelled = true; stopGroup('SIGTERM'); };
  process.once('SIGTERM', cancel);
  process.once('SIGINT', cancel);
  try {
    // 只复制当前脚本字节，不复制.git、dist、PID、发布指针、node_modules或凭据。
    for (const file of [smoke, ...helpers.map(name => `scripts/${name}`)]) {
      mkdirSync(dirname(join(isolated, file)), {recursive: true});
      copyFileSync(join(source, file), join(isolated, file));
    }
    for (const dir of ['home', 'tmp', 'bin', 'apps/dashboard']) mkdirSync(join(isolated, dir), {recursive: true});
    for (const command of ['docker', 'ssh', 'rsync', 'npm', 'psql', 'gh']) {
      writeFileSync(join(isolated, 'bin', command), `#!/bin/sh\necho '隔离staging禁止外部操作：${command}' >&2\nexit 97\n`, {mode: 0o755});
    }
    const port = await unusedPortRange();
    child = spawn('bash', [join(isolated, smoke)], {
      cwd: isolated, detached: true, stdio: 'inherit',
      env: {
        PATH: `${join(isolated, 'bin')}:${process.env.PATH}`, LANG: process.env.LANG || 'C.UTF-8',
        HOME: join(isolated, 'home'), TMPDIR: join(isolated, 'tmp'),
        SMOKE_STAGING_PORT: String(port), NO_PROXY: '*', no_proxy: '*',
      },
    });
    timer = setTimeout(cancel, 120000);
    const result = await new Promise((done, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => done({code, signal}));
    });
    process.exitCode = cancelled || result.signal ? 1 : result.code ?? 1;
  } finally {
    clearTimeout(timer);
    // detached子进程拥有单独进程组，只终止本人副本启动的staging/dev服务。
    stopGroup('SIGTERM');
    await sleep(50);
    stopGroup('SIGKILL');
    process.removeListener('SIGTERM', cancel);
    process.removeListener('SIGINT', cancel);
    rmSync(isolated, {recursive: true, force: true});
  }
}

main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
