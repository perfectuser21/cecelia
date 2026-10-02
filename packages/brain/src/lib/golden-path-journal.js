import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { registerGoldenPathInstance, readGoldenPathInstances } from './golden-path-archive.js';

const digest = record => createHash('sha256').update(JSON.stringify(record)).digest('hex');
const MAX_BYTES = 64 * 1024 * 1024;
export function listGoldenPathJournals(root) {
  const entries = fs.readdirSync(root);
  const instances = readGoldenPathInstances(root);
  const names = entries.filter(name => /^[a-f0-9-]{36}\.jsonl$/.test(name));
  const registrations = entries.filter(name => /^[a-f0-9-]{36}\.registration\.json$/.test(name));
  if (names.length !== instances.length || instances.some(id => !names.includes(`${id}.jsonl`))
      || names.length > 1024 || names.length !== registrations.length) throw new Error('gp_journal_manifest_missing');
  for (const name of registrations) {
    const { record_hash, ...row } = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
    if (digest(row) !== record_hash || name !== `${row.instance_id}.registration.json`
        || !names.includes(`${row.instance_id}.jsonl`)) throw new Error('gp_journal_manifest_missing');
  }
  return names.map(name => path.join(root, name));
}
export function readGoldenPathJournal(file) {
  if (fs.statSync(file).size > MAX_BYTES) throw new Error('gp_journal_corrupt');
  const text = fs.readFileSync(file, 'utf8');
  if (text && !text.endsWith('\n')) throw new Error('gp_journal_corrupt');
  let previous = null;
  return text.split('\n').filter(Boolean).map((line, index) => {
    let row;
    try { row = JSON.parse(line); } catch { throw new Error('gp_journal_corrupt'); }
    const { record_hash: hash, ...unsigned } = row;
    if (row.seq !== index + 1 || row.previous_hash !== previous || digest(unsigned) !== hash) {
      throw new Error('gp_journal_corrupt');
    }
    previous = hash;
    return row;
  });
}

export function createGoldenPathJournal(root, instanceId = randomUUID()) {
  if (!path.isAbsolute(root) || !/^[a-f0-9-]{36}$/.test(instanceId)) throw new Error('gp_journal_path_invalid');
  const firstCreated = fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const directory of new Set([path.dirname(root), ...(firstCreated ? [path.dirname(firstCreated)] : [])])) {
    const parent = fs.openSync(directory, 'r');
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
  }
  const file = path.join(root, `${instanceId}.jsonl`);
  const fd = fs.openSync(file, 'ax', 0o600);
  fs.fsyncSync(fd);
  const dir = fs.openSync(root, 'r');
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  fs.closeSync(fd);
  const registration = { instance_id: instanceId, journal: `${instanceId}.jsonl` };
  const registered = fs.openSync(path.join(root, `${instanceId}.registration.json`), 'ax', 0o600);
  try {
    fs.writeFileSync(registered, JSON.stringify({ ...registration, record_hash: digest(registration) }));
    fs.fsyncSync(registered);
  } finally { fs.closeSync(registered); }
  const registeredDir = fs.openSync(root, 'r');
  try { fs.fsyncSync(registeredDir); } finally { fs.closeSync(registeredDir); }
  registerGoldenPathInstance(root, instanceId);
  let seq = 0, previous = null;
  return {
    file, instanceId,
    append(record) {
      const unsigned = { ...record, instance_id: instanceId, seq: seq + 1, previous_hash: previous };
      const record_hash = digest(unsigned);
      const handle = fs.openSync(file, 'a');
      try { fs.writeFileSync(handle, `${JSON.stringify({ ...unsigned, record_hash })}\n`); fs.fsyncSync(handle); }
      finally { fs.closeSync(handle); }
      seq += 1; previous = record_hash;
    },
    files: () => listGoldenPathJournals(root),
  };
}
