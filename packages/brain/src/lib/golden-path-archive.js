import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const syncDirectory = root => {
  const fd = fs.openSync(root, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
};
function readFile(file, maxBytes) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes || (stat.mode & 0o077)) throw new Error('gp_archive_invalid');
    return fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
}
const signed = record => ({ ...record, record_hash: hash(record) });
function verified(value) {
  const { record_hash, ...record } = value;
  if (hash(record) !== record_hash) throw new Error('gp_archive_invalid');
  return record;
}
// 独立于各实例pair的窗口清单；append单次同步写入，半行/重复/缺对象全部拒绝。
export function registerGoldenPathInstance(root, instanceId) {
  const file = path.join(root, 'instances.manifest.jsonl');
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND
    | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077)) throw new Error('gp_archive_invalid');
    fs.writeSync(fd, `${JSON.stringify(signed({ instance_id: instanceId }))}\n`);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  syncDirectory(root);
}
export function readGoldenPathInstances(root) {
  const text = readFile(path.join(root, 'instances.manifest.jsonl'), 1024 * 1024);
  if (!text.endsWith('\n')) throw new Error('gp_archive_invalid');
  const ids = text.split('\n').filter(Boolean).map(line => verified(JSON.parse(line)).instance_id);
  if (!ids.length || ids.length > 1024 || new Set(ids).size !== ids.length
      || ids.some(id => !/^[a-f0-9-]{36}$/.test(id))) throw new Error('gp_archive_invalid');
  return ids;
}
export function readGoldenPathT0Archive(root) {
  return verified(JSON.parse(readFile(path.join(root, 't0-receipt.json'), 64 * 1024)));
}
// 只由server加载真实DB行后调用，caller/任务自报日期从不进入此入口。
export function archiveGoldenPathT0(root, receipt) {
  const normalized = JSON.parse(JSON.stringify(receipt));
  const file = path.join(root, 't0-receipt.json');
  let fd;
  try { fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT
    | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST' || !isDeepStrictEqual(readGoldenPathT0Archive(root), normalized)) {
      throw new Error('gp_t0_archive_conflict');
    }
    return;
  }
  try { fs.writeFileSync(fd, JSON.stringify(signed(normalized))); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  syncDirectory(root);
}

export function registerGoldenPathServing(root, instanceId, windowId) {
  const fd = fs.openSync(path.join(root, 'serving.manifest.jsonl'), fs.constants.O_WRONLY
    | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify(signed({ instance_id: instanceId, window_id: windowId }))}\n`);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  syncDirectory(root);
}
export function readGoldenPathServing(root) {
  const text = readFile(path.join(root, 'serving.manifest.jsonl'), 1024 * 1024);
  if (!text.endsWith('\n')) throw new Error('gp_serving_manifest_invalid');
  const rows = text.split('\n').filter(Boolean).map(line => verified(JSON.parse(line)));
  if (!rows.length || rows.length > 1024 || new Set(rows.map(r => r.instance_id)).size !== rows.length
      || rows.some(r => !/^[a-f0-9-]{36}$/.test(r.instance_id)
        || (r.window_id !== 'unadmitted' && !/^[a-f0-9-]{36}$/.test(r.window_id)))) {
    throw new Error('gp_serving_manifest_invalid');
  }
  return rows;
}
