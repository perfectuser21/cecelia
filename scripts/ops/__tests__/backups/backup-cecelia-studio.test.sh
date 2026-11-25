#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { test } from 'node:test';

// 红阶段显式指定现场旧脚本，只读提取JS，绝不启动其bash或外部命令。
const subjectPath = process.env.BACKUP_LEGACY_SUBJECT;
assert.ok(subjectPath, '红阶段必须显式指定BACKUP_LEGACY_SUBJECT');
const shell = fs.readFileSync(subjectPath, 'utf8');
const subject = shell.match(/<<'JS'\r?\n([\s\S]*?)\r?\nJS\s*$/)?.[1];
assert.ok(subject, '必须取得真实旧脚本内的完整JS');
const now = '2026-11-25T04:10:00Z';
const newName = 'cecelia-studio-20261125T041000Z.dump';
const expired = 'cecelia-studio-20261110T041000Z.dump';
const boundary = 'cecelia-studio-20261111T041000Z.dump';
const recent = 'cecelia-studio-20261124T041000Z.dump';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

function fixture(t, failure) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cecelia-backup-red-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const local = path.join(home, 'cecelia-backups');
  const remote = path.join(root, 'remote');
  fs.mkdirSync(local, { recursive: true });
  fs.mkdirSync(remote);
  const keep = [expired, boundary, recent, 'cecelia-studio-20260230T041000Z.dump',
    'other-20261101.dump', 'cecelia-studio-20261101T041000Z.dump.part', 'history-receipt.json'];
  for (const name of keep) {
    fs.writeFileSync(path.join(local, name), `fixture:${name}`, { mode: 0o600 });
    fs.copyFileSync(path.join(local, name), path.join(remote, name));
  }
  const before = Object.fromEntries(keep.map(name => [name, fs.readFileSync(path.join(local, name))]));
  const calls = [];
  const violations = [];
  const inside = input => {
    if (typeof input === 'number') return input;
    const resolved = path.resolve(String(input));
    if (!resolved.startsWith(root + path.sep)) {
      violations.push('拒绝fixture外FS访问');
      throw new Error('拒绝fixture外FS访问');
    }
    return input;
  };
  // 凭据只提供合成fixture，永远不读取真实HOME或1Password。
  const fakeFs = new Proxy(fs, { get(target, method) {
    if (method === 'readFileSync') return (file, ...args) => {
      inside(file);
      if (!fs.existsSync(file) && path.dirname(file) !== local) return 'FIXTURE_ENV=synthetic\n';
      return fs.readFileSync(file, ...args);
    };
    if (method === 'writeFileSync') return (file, ...args) => {
      inside(file); fs.mkdirSync(path.dirname(file), { recursive: true });
      return fs.writeFileSync(file, ...args);
    };
    if (['mkdirSync', 'openSync', 'statSync', 'chmodSync', 'rmSync'].includes(method)) {
      return (file, ...args) => target[method](inside(file), ...args);
    }
    if (method === 'renameSync') return (from, to) => fs.renameSync(inside(from), inside(to));
    if (['closeSync'].includes(method)) return target[method].bind(target);
    violations.push(`拒绝未批准FS方法:${String(method)}`);
    throw new Error('拒绝未批准FS方法');
  }});
  const fakeExec = (command, args, options = {}) => {
    calls.push(path.basename(command));
    if (command === 'op' && args[0] === 'item' && args[1] === 'get') {
      return JSON.stringify({ fields: [
        { id: 'db_user', value: 'cecelia' }, { id: 'db_name', value: 'cecelia' },
        { id: 'db_password', value: 'synthetic-fixture-only' },
      ] });
    }
    if (command === '/opt/homebrew/bin/pg_dump') {
      assert.deepEqual(Array.from(args), ['-h', '127.0.0.1', '-p', '15432', '-U', 'cecelia', '-d', 'cecelia', '-Fc']);
      assert.equal(options.env.PGPASSWORD, undefined);
      if (failure === 'dump') throw new Error('fixture dump失败');
      fs.writeSync(options.stdio[1], 'PGDMP:synthetic-valid-archive');
      return Buffer.alloc(0);
    }
    if (command === '/opt/homebrew/bin/pg_restore') {
      assert.deepEqual(Array.from(args).slice(0, 2), ['-f', '/dev/null']);
      assert.equal(fs.readFileSync(inside(args[2]), 'utf8'), 'PGDMP:synthetic-valid-archive');
      if (failure === 'archive') throw new Error('fixture archive拒绝');
      return Buffer.alloc(0);
    }
    if (command === 'rsync') {
      assert.deepEqual(Array.from(args), ['-az', '--timeout=600', path.join(local, newName), 'us-vps:/root/cecelia-backups-offsite/']);
      if (failure === 'rsync') throw new Error('fixture rsync失败');
      fs.copyFileSync(inside(args[2]), path.join(remote, newName));
      return Buffer.alloc(0);
    }
    if (command === 'ssh') {
      assert.deepEqual(Array.from(args), ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'us-vps', 'sha256sum', `/root/cecelia-backups-offsite/${newName}`]);
      return `${failure === 'checksum' ? '0'.repeat(64) : digest(fs.readFileSync(path.join(remote, newName)))}  ${newName}\n`;
    }
    violations.push('拒绝未批准外部命令');
    throw new Error('拒绝未批准外部命令');
  };
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return Date.parse(now); }
  }
  const fakeProcess = { env: { HOME: home }, exitCode: 0 };
  vm.runInNewContext(subject, {
    require(name) {
      if (name === 'fs') return fakeFs;
      if (name === 'path') return path;
      if (name === 'crypto') return crypto;
      if (name === 'child_process') return { execFileSync: fakeExec };
      violations.push(`拒绝未批准模块:${name}`);
      throw new Error('拒绝未批准模块');
    },
    process: fakeProcess, Date: FixedDate,
    console: { log() {}, error() {} },
  }, { timeout: 5000, filename: 'isolated-legacy-subject.js' });
  assert.deepEqual(violations, [], 'subject不能越过隔离边界');
  return { local, remote, keep, before, calls, exitCode: fakeProcess.exitCode };
}

test('新archive读取及双SHA通过后只回收远端14天外同SHA副本，Mac历史不减', t => {
  const f = fixture(t);
  assert.equal(f.exitCode, 0, '先证明原备份、archive读取和双SHA均已完成');
  assert.deepEqual(f.calls, ['op', 'pg_dump', 'pg_restore', 'rsync', 'ssh']);
  assert.equal(digest(fs.readFileSync(path.join(f.local, newName))),
    digest(fs.readFileSync(path.join(f.remote, newName))));
  assert.equal(fs.existsSync(path.join(f.remote, expired)), false,
    '本轮新备份已验证，但15天旧远端同SHA副本仍存在：缺少14天保留规则');
  for (const name of f.keep) {
    assert.deepEqual(fs.readFileSync(path.join(f.local, name)), f.before[name], 'Mac全部历史及回执保留');
    if (name !== expired) assert.deepEqual(fs.readFileSync(path.join(f.remote, name)), f.before[name]);
  }
});

for (const failure of ['dump', 'archive', 'rsync', 'checksum']) {
  test(`${failure}失败时所有远端旧副本和Mac历史完整保留`, t => {
    const f = fixture(t, failure);
    assert.equal(f.exitCode, 1);
    assert.ok(!fs.existsSync(path.join(f.local, newName + '.part')));
    for (const name of f.keep) {
      assert.deepEqual(fs.readFileSync(path.join(f.local, name)), f.before[name]);
      assert.deepEqual(fs.readFileSync(path.join(f.remote, name)), f.before[name]);
    }
  });
}
JS
