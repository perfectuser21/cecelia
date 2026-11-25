import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const remoteSource = fs.readFileSync(path.join(here, 'backup-cecelia-retention.py'), 'utf8');
const REMOTE = '/root/cecelia-backups-offsite';
const UID = 501;
const strictName = /^cecelia-studio-(\d{8})T(\d{6})Z\.dump$/;
const identity = s => [s.dev, s.ino, s.uid, s.mode, s.nlink, s.size,
  s.mtimeNs ?? s.mtimeMs, s.ctimeNs ?? s.ctimeMs].map(String);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function acquireLock(file, uid, command) {
  const fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
  try {
    const original = fs.fstatSync(fd);
    guard(original.isFile() && original.uid === uid && original.nlink === 1
      && (original.mode & 0o777) === 0o600);
    // fd形式不带command；子进程取锁后Node保留同一open-file-description。
    // Node退出/SIGKILL会由内核释放，无TTL抢锁，也不删除锁文件。
    command('/usr/local/bin/flock', ['-n', '-E', '75', '3'], {
      stdio: ['ignore', 'pipe', 'pipe', fd], timeout: 5000, maxBuffer: 4096,
    });
    guard(equal(identity(fs.lstatSync(file)), identity(original)));
    return () => fs.closeSync(fd);
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}

function guard(condition) {
  if (!condition) throw new Error('backup_guard_failed');
}

function timestamp(name) {
  const match = strictName.exec(name);
  if (!match) return null;
  const d = match[1], t = match[2];
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4)}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && new Date(ms).toISOString() === iso.replace('Z', '.000Z') ? ms / 1000 : null;
}

function hashFile(file, expectedUid) {
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    guard(before.isFile() && before.uid === BigInt(expectedUid) && before.nlink === 1n
      && (before.mode & 0o777n) === 0o600n && before.dev === fs.statSync(path.dirname(file), { bigint: true }).dev
      && before.size <= BigInt(Number.MAX_SAFE_INTEGER));
    const sha = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let length;
    while ((length = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) sha.update(buffer.subarray(0, length));
    guard(equal(identity(before), identity(fs.fstatSync(descriptor, { bigint: true })))
      && equal(identity(before), identity(fs.lstatSync(file, { bigint: true }))));
    return { name: path.basename(file), bytes: Number(before.size), sha256: sha.digest('hex'), localIdentity: identity(before) };
  } finally {
    fs.closeSync(descriptor);
  }
}

// 只给测试注入边界依赖；CLI入口不读取任意目标/路径/删除开关。
export async function runBackup({ home = process.env.HOME, now = () => new Date(Math.floor(Date.now() / 1000) * 1000),
  command = execFileSync, expectedUid = UID } = {}) {
  const local = path.join(home, 'cecelia-backups');
  const credentials = path.join(home, '.credentials');
  const runId = crypto.randomUUID();
  const instant = now();
  guard(instant instanceof Date && Number.isFinite(instant.valueOf()) && instant.getUTCMilliseconds() === 0);
  const stamp = instant.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const filename = `cecelia-studio-${stamp}.dump`;
  const output = path.join(local, filename);
  const temporary = output + '.part';
  const passwordFile = path.join(credentials, `cecelia-studio-${runId}.pgpass`);
  const lock = path.join(local, '.studio-backup.lock');
  let releaseLock, descriptor, partIdentity, passwordIdentity;
  let stage = 'prepare';
  const invoke = (cmd, args, options = {}) => command(cmd, args, {
    stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1024 * 1024, ...options,
  });
  const receipt = (kind, value) => fs.writeFileSync(path.join(local, `studio-${runId}-${kind}.json`),
    JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const remote = payload => {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
    const program = `${remoteSource}\nmain(json.loads(base64.b64decode('${encoded}')))\n`;
    const result = JSON.parse(invoke('/usr/bin/ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15',
      'us-vps', 'python3', '-'], { input: program, encoding: 'utf8', timeout: 240000 }));
    guard(result.ok === true && Array.isArray(result.candidates) && Array.isArray(result.unknown)
      && Array.isArray(result.deleted));
    return result;
  };
  try {
    fs.mkdirSync(local, { recursive: true, mode: 0o755 });
    const directory = fs.lstatSync(local);
    guard(directory.isDirectory() && !directory.isSymbolicLink() && directory.uid === expectedUid
      && (directory.mode & 0o022) === 0 && fs.realpathSync(local) === local);
    releaseLock = acquireLock(lock, expectedUid, command);
    guard(!fs.existsSync(output));
    stage = 'credentials';
    const environment = {};
    for (const line of fs.readFileSync(path.join(credentials, '1password.env'), 'utf8').split('\n')) {
      const match = line.match(/^([^=]+)=(.+)/);
      if (match) environment[match[1]] = match[2];
    }
    const item = JSON.parse(invoke('/opt/homebrew/bin/op', ['item', 'get', 'plsdvhfe2piyv5dbwixhxq6lbe',
      '--vault', 'CS', '--format', 'json', '--reveal'], {
      env: { ...process.env, ...environment }, timeout: 30000,
    }));
    const fields = Object.fromEntries(item.fields.map(field => [field.id, field.value]));
    guard(fields.db_user === 'cecelia' && fields.db_name === 'cecelia'
      && typeof fields.db_password === 'string' && fields.db_password.length > 0
      && !/[\r\n\0]/.test(fields.db_password));
    const escaped = fields.db_password.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
    fs.writeFileSync(passwordFile, `127.0.0.1:15432:cecelia:cecelia:${escaped}\n`, { flag: 'wx', mode: 0o600 });
    passwordIdentity = identity(fs.lstatSync(passwordFile)).slice(0, 4);
    const databaseEnvironment = { ...process.env, PGPASSFILE: passwordFile };
    delete databaseEnvironment.PGPASSWORD;
    stage = 'archive';
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    partIdentity = identity(fs.fstatSync(descriptor)).slice(0, 4);
    invoke('/opt/homebrew/bin/pg_dump', ['-h', '127.0.0.1', '-p', '15432', '-U', 'cecelia', '-d', 'cecelia', '-Fc'], {
      env: databaseEnvironment, stdio: ['ignore', descriptor, 'pipe'], timeout: 1800000,
    });
    fs.closeSync(descriptor);
    descriptor = undefined;
    guard(fs.statSync(temporary).size > 0);
    invoke('/opt/homebrew/bin/pg_restore', ['-f', '/dev/null', temporary], { timeout: 1800000 });
    // link 的 EEXIST 语义保护同名历史；不会 rename 覆盖已有Mac备份。
    fs.linkSync(temporary, output);
    fs.unlinkSync(temporary);
    partIdentity = undefined;
    const copy = hashFile(output, expectedUid);
    stage = 'transfer';
    invoke('/usr/bin/rsync', ['-az', '--timeout=600', output, `us-vps:${REMOTE}/`], { timeout: 900000 });
    const request = { run_id: runId, now: instant.valueOf() / 1000,
      cutoff: instant.valueOf() / 1000 - 14 * 86400,
      new: { name: filename, bytes: copy.bytes, sha256: copy.sha256 } };
    stage = 'verify';
    const inspected = remote({ ...request, action: 'inspect' });
    guard(equal(copy, hashFile(output, expectedUid)));
    const success = { observed_at: instant.toISOString(), filename, bytes: copy.bytes,
      sha256: copy.sha256, offsite_verified: true, run_id: runId };
    receipt('backup', success);
    stage = 'retention';
    const approved = [];
    const skipped = [];
    guard(inspected.candidates.length <= 256);
    for (const candidate of inspected.candidates) {
      try {
        const time = timestamp(candidate.name);
        guard(time !== null && time < request.cutoff);
        const evidence = hashFile(path.join(local, candidate.name), expectedUid);
        guard(evidence.bytes === candidate.bytes && evidence.sha256 === candidate.sha256);
        approved.push({ ...candidate, localIdentity: evidence.localIdentity });
      } catch { skipped.push(candidate.name); }
    }
    // 发出删除请求前重核同名Mac路径和内容，不能只靠早期FD/hash缓存。
    const confirmed = approved.filter(candidate => {
      try {
        const evidence = hashFile(path.join(local, candidate.name), expectedUid);
        guard(equal(evidence.localIdentity, candidate.localIdentity)
          && evidence.bytes === candidate.bytes && evidence.sha256 === candidate.sha256);
        return true;
      } catch { skipped.push(candidate.name); return false; }
    });
    guard(equal(copy, hashFile(output, expectedUid)));
    const result = remote({ ...request, action: 'prune', directory: inspected.directory, approved: confirmed });
    const retention = { run_id: runId, backup_verified: true, deleted: result.deleted,
      unknown: [...inspected.unknown, ...result.unknown], skipped,
      status: inspected.unknown.length || result.unknown.length || skipped.length ? 'unconfirmed' : 'verified' };
    receipt('retention', retention);
    if (retention.status === 'verified') {
      // 旧镜像先转为不可变历史回执，之后才更新镜像。
      const mirror = path.join(local, 'studio-last-success.json');
      if (fs.existsSync(mirror)) {
        const previous = hashFile(mirror, expectedUid);
        fs.copyFileSync(mirror, path.join(local, `studio-${runId}-previous-success.json`), fs.constants.COPYFILE_EXCL);
        guard(equal(previous, hashFile(mirror, expectedUid)));
      }
      const mirrorPart = path.join(local, `studio-${runId}-success.part`);
      fs.writeFileSync(mirrorPart, JSON.stringify(success, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      fs.renameSync(mirrorPart, mirror);
    }
    return { ...success, retention };
  } catch {
    // 不把op/pg_dump/SSH原始stderr及其环境、字段值写入日志。
    if (releaseLock) {
      try { receipt('failure', { run_id: runId, stage, code: 'studio_backup_failed' }); } catch {}
    }
    throw new Error(`studio_backup_failed:${stage}`);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    for (const [file, own] of [[temporary, partIdentity], [passwordFile, passwordIdentity]]) {
      if (!own) continue;
      try {
        if (equal(identity(fs.lstatSync(file)).slice(0, 4), own)) fs.unlinkSync(file);
      } catch {}
    }
    if (releaseLock) await releaseLock();
  }
}

export async function runCli(options) {
  try {
    const result = await runBackup(options);
    console.log(JSON.stringify(result));
    return result.retention.status === 'verified' ? 0 : 1;
  } catch {
    console.error('studio_backup_failed');
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // 统一秒精度与既有UTC文件命名；导入模块不会执行任何备份。
  process.exitCode = await runCli();
}
