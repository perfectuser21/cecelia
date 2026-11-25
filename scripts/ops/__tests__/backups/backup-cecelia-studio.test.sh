#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import { runBackup, runCli } from './scripts/ops/backup-cecelia-studio.mjs';

const now = '2026-11-25T04:10:00Z';
const newName = 'cecelia-studio-20261125T041000Z.dump';
const expired = 'cecelia-studio-20261110T041000Z.dump';
const boundary = 'cecelia-studio-20261111T041000Z.dump';
const recent = 'cecelia-studio-20261124T041000Z.dump';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const uid = process.getuid();
const python = '/usr/bin/python3';
const flock = fs.existsSync('/usr/local/bin/flock') ? '/usr/local/bin/flock' : '/usr/bin/flock';

function fixture(t, failure) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cecelia-backup-test-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const local = path.join(home, 'cecelia-backups');
  const remote = path.join(root, 'remote');
  const alias = path.join(root, 'alias');
  fs.mkdirSync(local, { recursive: true, mode: 0o755 });
  fs.mkdirSync(remote, { mode: 0o755 });
  fs.mkdirSync(path.join(home, '.credentials'), { mode: 0o700 });
  fs.writeFileSync(path.join(home, '.credentials/1password.env'), 'FIXTURE_ENV=synthetic\n', { mode: 0o600 });
  fs.symlinkSync(remote, alias);
  const keep = [expired, boundary, recent, 'cecelia-studio-20260230T041000Z.dump',
    'cecelia-studio-20261201T041000Z.dump', 'other-20261101.dump',
    'cecelia-studio-20261101T041000Z.dump.part', 'history-receipt.json',
    'studio-last-success.json', 'cecelia-studio-20261101T041000Z.dump;touch INJECTION'];
  for (const name of keep) {
    fs.writeFileSync(path.join(local, name), `fixture:${name}`, { mode: 0o600 });
    fs.copyFileSync(path.join(local, name), path.join(remote, name));
  }
  const snapshot = file => { const s = fs.lstatSync(file); return [s.dev, s.ino, s.mode, s.size, hash(fs.readFileSync(file))]; };
  const before = Object.fromEntries(keep.map(name => [name, snapshot(path.join(local, name))]));
  const remoteBefore = Object.fromEntries(keep.map(name => [name, snapshot(path.join(remote, name))]));
  const calls = [];
  const requests = [];
  const checked = file => {
    assert.ok(path.resolve(file).startsWith(root + path.sep), 'fixture拒绝访问根目录之外');
    return file;
  };
  let beforeInspect = () => {}, beforePrune = () => {}, afterReservation = false;
  const f = { root, home, local, remote, alias, keep, before, remoteBefore, calls, requests, snapshot,
    set beforeInspect(value) { beforeInspect = value; },
    set beforePrune(value) { beforePrune = value; },
    set afterReservation(value) { afterReservation = value; } };
  const command = (cmd, args, options = {}) => {
    calls.push(path.basename(cmd));
    if (cmd === '/usr/local/bin/flock') {
      assert.deepEqual(args, ['-n', '-E', '75', '3']);
      assert.equal(fs.fstatSync(options.stdio[3]).ino, fs.statSync(path.join(local, '.studio-backup.lock')).ino);
      return execFileSync(flock, args, options);
    }
    if (cmd === '/opt/homebrew/bin/op') {
      assert.deepEqual(args, ['item', 'get', 'plsdvhfe2piyv5dbwixhxq6lbe', '--vault', 'CS', '--format', 'json', '--reveal']);
      if (failure === 'op') throw new Error('synthetic-fixture-only');
      return JSON.stringify({ fields: [
        { id: 'db_user', value: 'cecelia' }, { id: 'db_name', value: 'cecelia' },
        { id: 'db_password', value: 'synthetic-fixture-only' },
      ] });
    }
    if (cmd === '/opt/homebrew/bin/pg_dump') {
      assert.deepEqual(args, ['-h', '127.0.0.1', '-p', '15432', '-U', 'cecelia', '-d', 'cecelia', '-Fc']);
      assert.equal(options.env.PGPASSWORD, undefined);
      assert.equal(fs.statSync(checked(options.env.PGPASSFILE)).mode & 0o777, 0o600);
      if (failure === 'dump') throw new Error('synthetic-fixture-only');
      if (failure !== 'empty') fs.writeSync(options.stdio[1], 'PGDMP:synthetic-valid-archive');
      return Buffer.alloc(0);
    }
    if (cmd === '/opt/homebrew/bin/pg_restore') {
      assert.deepEqual(args.slice(0, 2), ['-f', '/dev/null']);
      assert.equal(fs.readFileSync(checked(args[2]), 'utf8'), 'PGDMP:synthetic-valid-archive');
      if (failure === 'archive') throw new Error('synthetic-fixture-only');
      return Buffer.alloc(0);
    }
    if (cmd === '/usr/bin/rsync') {
      assert.deepEqual(args, ['-az', '--timeout=600', path.join(local, newName), 'us-vps:/root/cecelia-backups-offsite/']);
      if (failure === 'rsync') throw new Error('synthetic-fixture-only');
      fs.copyFileSync(checked(args[2]), path.join(remote, newName));
      if (failure === 'checksum') fs.writeFileSync(path.join(remote, newName), 'bad-archive');
      return Buffer.alloc(0);
    }
    assert.equal(cmd, '/usr/bin/ssh', '拒绝未批准外部命令');
    assert.deepEqual(args, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'us-vps', 'python3', '-']);
    assert.equal(options.encoding, 'utf8');
    assert.ok(options.maxBuffer <= 1024 * 1024);
    assert.ok(options.timeout <= 240000);
    const payload = options.input.match(/\nmain\(json.loads\(base64.b64decode\('([A-Za-z0-9+/=]+)'\)\)\)\n$/);
    assert.ok(payload, 'payload只经stdin的base64字面量传递');
    const request = JSON.parse(Buffer.from(payload[1], 'base64'));
    requests.push(request);
    if (request.action === 'inspect') beforeInspect();
    else { assert.equal(request.action, 'prune'); beforePrune(); }
    if (failure === 'ssh') throw new Error('synthetic-fixture-only');
    // 仅替换受信边界常量；真实hash、flock、dirfd、rename、unlink均执行原Python。
    // 仅将远端wall clock固定在同一fixture时刻，避免真实日历影响测试。
    let program = options.input.replace('time.time() + 300', `${Date.parse(now) / 1000 - (failure === 'clock' ? 301 : 0)} + 300`);
    for (const [key, value] of Object.entries({ CANONICAL: remote, ALIAS: alias, TRUST_ROOT: root,
      DIRECTORY_UID: uid, FILE_UID: uid })) {
      const expression = new RegExp(`^${key} = .+$`, 'm');
      assert.ok(expression.test(program));
      program = program.replace(expression, `${key} = ${JSON.stringify(value)}`);
    }
    if (failure === 'uid' && request.action === 'prune') program = program.replace(`FILE_UID = ${uid}`, `FILE_UID = ${uid + 1}`);
    if (failure === 'budget' && request.action === 'prune') program = program.replace('deadline = time.monotonic() + 180', 'deadline = time.monotonic() - 1');
    if (afterReservation && request.action === 'prune') {
      const marker = "                reserved = file_info(reservation, name, deadline)";
      assert.ok(program.includes(marker));
      program = program.replace(marker, "                changed = os.open(name, os.O_WRONLY | os.O_TRUNC, dir_fd=reservation)\n                os.write(changed, b'changed-after-rename')\n                os.close(changed)\n" + marker);
    }
    return execFileSync(python, ['-'], { input: program, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
  };
  const confined = async operation => {
    const originals = {};
    const violations = [];
    for (const method of ['mkdirSync', 'openSync', 'statSync', 'lstatSync', 'realpathSync',
      'readFileSync', 'writeFileSync', 'unlinkSync', 'copyFileSync', 'renameSync', 'linkSync', 'rmSync']) {
      originals[method] = fs[method];
      fs[method] = (...args) => {
        for (const index of ['copyFileSync', 'renameSync', 'linkSync'].includes(method) ? [0, 1] : [0]) {
          if (typeof args[index] === 'number') continue;
          if (!path.resolve(String(args[index])).startsWith(root + path.sep)) {
            violations.push(method);
            throw Error('fixture拒绝根目录外FS访问');
          }
        }
        return originals[method](...args);
      };
    }
    try { return await operation(); }
    finally {
      Object.assign(fs, originals);
      assert.deepEqual(violations, [], '不得吞掉FS越界拒绝');
    }
  };
  const options = { home, command, expectedUid: uid, now: () => new Date(now) };
  f.run = () => confined(() => runBackup(options));
  f.runCli = () => confined(() => runCli(options));
  f.assertLocal = () => {
    for (const name of keep.filter(n => n !== 'studio-last-success.json')) {
      assert.deepEqual(snapshot(path.join(local, name)), before[name], 'Mac全部历史及回执identity不变');
    }
    const saved = fs.readdirSync(local).filter(name => name.endsWith('-previous-success.json'));
    if (saved.length) assert.equal(hash(fs.readFileSync(path.join(local, saved[0]))), before['studio-last-success.json'][4]);
    else assert.deepEqual(snapshot(path.join(local, 'studio-last-success.json')), before['studio-last-success.json']);
    assert.deepEqual(fs.readdirSync(path.join(home, '.credentials')), ['1password.env'], '运行凭据已清理');
  };
  f.assertRemote = () => {
    for (const name of keep) assert.deepEqual(snapshot(path.join(remote, name)), remoteBefore[name]);
  };
  return f;
}

test('新archive读取及双SHA通过后只回收远端14天外同SHA副本，Mac历史不减', async t => {
  const f = fixture(t);
  const result = await f.run();
  assert.equal(result.offsite_verified, true);
  assert.equal(result.retention.status, 'verified');
  assert.deepEqual(f.calls, ['flock', 'op', 'pg_dump', 'pg_restore', 'rsync', 'ssh', 'ssh']);
  assert.equal(hash(fs.readFileSync(path.join(f.local, newName))), hash(fs.readFileSync(path.join(f.remote, newName))));
  assert.equal(fs.existsSync(path.join(f.remote, expired)), false,
    '本轮新备份已验证，但15天旧远端同SHA副本仍存在：缺少14天保留规则');
  for (const name of f.keep.filter(n => n !== expired)) assert.deepEqual(f.snapshot(path.join(f.remote, name)), f.remoteBefore[name]);
  assert.deepEqual(result.retention.deleted, [{ name: expired, bytes: f.before[expired][3] }]);
  assert.ok(fs.readdirSync(f.local).some(name => name.endsWith('-backup.json')));
  assert.ok(fs.readdirSync(f.local).some(name => name.endsWith('-retention.json')));
  assert.equal(fs.existsSync(path.join(f.root, 'INJECTION')), false);
  f.assertLocal();
});

for (const failure of ['op', 'dump', 'empty', 'archive', 'rsync', 'checksum', 'ssh', 'clock']) {
  test(`${failure}失败时所有远端旧副本和Mac历史完整保留`, async t => {
    const f = fixture(t, failure);
    await assert.rejects(f.run, /^Error: studio_backup_failed:(credentials|archive|transfer|verify)$/);
    assert.ok(!fs.existsSync(path.join(f.local, newName + '.part')));
    assert.ok(f.requests.every(request => request.action !== 'prune'));
    f.assertRemote(); f.assertLocal();
  });
}

for (const situation of ['missing', 'different', 'size', 'symlink', 'hardlink', 'mode']) {
  test(`本地${situation}没有可确认副本时远端保留`, async t => {
    const f = fixture(t);
    const file = path.join(f.local, expired);
    if (['missing', 'symlink', 'hardlink'].includes(situation)) fs.unlinkSync(file);
    if (situation === 'symlink') fs.symlinkSync(path.join(f.local, recent), file);
    if (situation === 'hardlink') fs.linkSync(path.join(f.local, recent), file);
    if (situation === 'different') fs.writeFileSync(file, 'x'.repeat(f.before[expired][3]));
    if (situation === 'size') fs.writeFileSync(file, 'x');
    if (situation === 'mode') fs.chmodSync(file, 0o640);
    const result = await f.run();
    assert.deepEqual(result.retention.deleted, []);
    assert.equal(result.retention.status, 'unconfirmed', '不能把未能核实的旧副本保留报告为全成功');
    assert.ok(result.retention.skipped.includes(expired));
    f.assertRemote();
  });
}

for (const situation of ['symlink', 'hardlink', 'mode', 'inode', 'uid', 'budget', 'alias', 'directory-mode', 'new-copy', 'lock-mode', 'lock-symlink']) {
  test(`远端${situation}变化时禁止误删`, async t => {
    const f = fixture(t, ['uid', 'budget'].includes(situation) ? situation : undefined);
    f.beforePrune = () => {
      const file = path.join(f.remote, expired);
      if (['symlink', 'hardlink', 'inode'].includes(situation)) fs.unlinkSync(file);
      if (situation === 'symlink') fs.symlinkSync(path.join(f.remote, recent), file);
      if (situation === 'hardlink') fs.linkSync(path.join(f.remote, recent), file);
      if (situation === 'inode') fs.writeFileSync(file, fs.readFileSync(path.join(f.local, expired)), { mode: 0o600 });
      if (situation === 'mode') fs.chmodSync(file, 0o640);
      if (situation === 'directory-mode') fs.chmodSync(f.remote, 0o777);
      if (situation === 'alias') { fs.unlinkSync(f.alias); fs.symlinkSync(f.local, f.alias); }
      if (situation === 'new-copy') fs.writeFileSync(path.join(f.remote, newName), 'changed');
      if (situation === 'lock-mode') fs.chmodSync(path.join(f.remote, '.studio-retention.lock'), 0o666);
      if (situation === 'lock-symlink') {
        fs.unlinkSync(path.join(f.remote, '.studio-retention.lock'));
        fs.symlinkSync(path.join(f.remote, recent), path.join(f.remote, '.studio-retention.lock'));
      }
    };
    if (['uid', 'budget', 'alias', 'directory-mode', 'new-copy', 'lock-mode', 'lock-symlink'].includes(situation)) {
      await assert.rejects(f.run, /studio_backup_failed:retention/);
    } else {
      const result = await f.run();
      assert.equal(result.retention.status, 'unconfirmed');
      assert.deepEqual(result.retention.deleted, []);
    }
    assert.ok(fs.existsSync(path.join(f.remote, expired)));
    f.assertLocal();
  });
}

test('私有rename之后内容变动：保留隔离项，不覆盖原位置或误报删除', async t => {
  const f = fixture(t);
  f.afterReservation = true;
  const result = await f.run();
  assert.equal(result.retention.status, 'unconfirmed');
  assert.deepEqual(result.retention.deleted, []);
  const reservation = fs.readdirSync(f.remote).find(name => name.startsWith('.studio-retention-'));
  assert.ok(reservation);
  assert.equal(fs.readFileSync(path.join(f.remote, reservation, expired), 'utf8'), 'changed-after-rename');
  f.assertLocal();
});

test('CLI遇本地无副本时非零退出，但保留新备份已验证事实和历史回执', async t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.local, expired));
  const original = console.log;
  const output = [];
  try {
    console.log = message => output.push(message);
    assert.equal(await f.runCli(), 1);
  } finally { console.log = original; }
  const report = JSON.parse(output[0]);
  assert.equal(report.offsite_verified, true);
  assert.equal(report.retention.status, 'unconfirmed');
  assert.deepEqual(report.retention.skipped, [expired]);
  assert.ok(fs.readdirSync(f.local).some(name => name.endsWith('-backup.json')));
  assert.equal(f.snapshot(path.join(f.local, 'studio-last-success.json'))[4], f.before['studio-last-success.json'][4]);
  f.assertRemote();
});

test('真实flock竞争时拒绝本轮回收，旧副本不动', async t => {
  const f = fixture(t);
  const lock = path.join(f.remote, '.studio-retention.lock');
  fs.writeFileSync(lock, '', { mode: 0o600 });
  const holder = spawn(python, ['-c', 'import fcntl,sys; f=open(sys.argv[1],"r+"); fcntl.flock(f,fcntl.LOCK_EX); print("locked",flush=True); sys.stdin.read()', lock], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    await once(holder.stdout, 'data');
    await assert.rejects(f.run, /studio_backup_failed:verify/);
    f.assertRemote(); f.assertLocal();
  } finally { holder.stdin.end(); await once(holder, 'exit'); }
});

test('已有本地锁不抢占、不删除他人锁，不启动任何外部命令', async t => {
  const f = fixture(t);
  const lock = path.join(f.local, '.studio-backup.lock');
  fs.mkdirSync(lock);
  await assert.rejects(f.run, /studio_backup_failed:prepare/);
  assert.ok(fs.statSync(lock).isDirectory());
  assert.deepEqual(f.calls, []);
  f.assertRemote(); f.assertLocal();
});

test('同名Mac历史不能被本轮时间戳覆盖', async t => {
  const f = fixture(t);
  const file = path.join(f.local, newName);
  fs.writeFileSync(file, 'already-existing-history', { mode: 0o600 });
  const before = f.snapshot(file);
  await assert.rejects(f.run, /studio_backup_failed:prepare/);
  assert.deepEqual(f.snapshot(file), before);
  assert.deepEqual(f.calls, ['flock']);
  f.assertRemote(); f.assertLocal();
});

test('真实本地flock并发拒绝第二执行者，锁持有者退出后可恢复', async t => {
  const f = fixture(t);
  const lock = path.join(f.local, '.studio-backup.lock');
  fs.writeFileSync(lock, '', { mode: 0o600 });
  const holder = spawn(python, ['-c', 'import fcntl,sys; f=open(sys.argv[1],"r+"); fcntl.flock(f,fcntl.LOCK_EX); print("locked",flush=True); sys.stdin.read()', lock], { stdio: ['pipe', 'pipe', 'pipe'] });
  await once(holder.stdout, 'data');
  await assert.rejects(f.run, /studio_backup_failed:prepare/);
  assert.deepEqual(f.calls, ['flock']);
  holder.stdin.end();
  await once(holder, 'exit');
  const result = await f.run();
  assert.equal(result.retention.status, 'verified');
  assert.ok(fs.statSync(lock).isFile(), '只保留自己的锁文件，不依赖删文件解锁');
});

test('备份进程SIGKILL后内核锁自动释放，下轮不需删除旧锁', async t => {
  const f = fixture(t);
  const module = path.resolve('scripts/ops/backup-cecelia-studio.mjs');
  const program = `import {execFileSync} from 'node:child_process'; import {runBackup} from ${JSON.stringify('file://' + module)};
    runBackup({home:${JSON.stringify(f.home)},expectedUid:${uid},now:()=>new Date(${JSON.stringify(now)}),
      command(cmd,args,options){if(cmd==='/usr/local/bin/flock')return execFileSync(${JSON.stringify(flock)},args,options);if(cmd!== '/opt/homebrew/bin/op')throw Error('unexpected');
        process.stdout.write('locked\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}});`;
  const parent = spawn(process.execPath, ['--input-type=module', '-e', program], { stdio: ['ignore', 'pipe', 'pipe'] });
  await once(parent.stdout, 'data');
  assert.equal(execFileSync(python, ['-c', 'import fcntl,sys; f=open(sys.argv[1],"r+");\ntry: fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB); print("unexpected-unlocked")\nexcept BlockingIOError: print("busy")', path.join(f.local, '.studio-backup.lock')], { encoding: 'utf8' }).trim(), 'busy',
    '独立Python确认Node锁住的是实际目标文件');
  parent.kill('SIGKILL');
  await once(parent, 'exit');
  let result;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { result = await f.run(); break; }
    catch (error) {
      assert.match(error.message, /studio_backup_failed:prepare/);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  assert.equal(result?.retention.status, 'verified');
});
JS
