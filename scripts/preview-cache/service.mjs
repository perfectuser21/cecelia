import { mkdir, readdir, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT, REPO, POLICY, PR, UUID, createStore, fail, stat, save, read, syncDirectory } from './storage.mjs';
export { POLICY } from './storage.mjs';
const exec = promisify(execFile);
const DAY = 86400000;
const TTL = 300000;
export async function github(pr) {
  if (!PR.test(pr)) throw fail('INVALID_PR', 400);
  try {
    const { stdout } = await exec('gh', ['pr', 'view', pr, '--repo', REPO, '--json', 'state,closedAt,mergedAt,headRefOid,updatedAt,url'],
      { timeout: 15000, maxBuffer: 32768, encoding: 'utf8' });
    return JSON.parse(stdout);
  } catch { throw fail('GITHUB_UNAVAILABLE', 503); }
}
export async function disk(root) {
  const { stdout } = await exec('df', ['-Pk', root], { timeout: 5000, maxBuffer: 32768, env: { ...process.env, LC_ALL: 'C' } });
  const cols = stdout.trim().split('\n').at(-1).trim().split(/\s+/);
  const total = Number(cols[1]) * 1024; const available = Number(cols[3]) * 1024;
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(available) || total <= 0 || available < 0) throw fail('DISK_SAMPLE_UNKNOWN');
  return { total_bytes: total, available_bytes: available, observed_at: new Date().toISOString() };
}
function validate(input, planning = false) {
  const fields = planning ? ['policy'] : ['policy', 'resource_id', 'generation', 'task_id', 'intent_id', 'expires_at'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !fields.includes(k))
      || fields.some(k => input[k] == null) || input.policy !== POLICY) throw fail('INVALID_REQUEST', 400);
  if (!planning && (!UUID.test(input.resource_id) || !UUID.test(input.task_id) || !UUID.test(input.intent_id)
      || !Number.isSafeInteger(input.generation) || input.generation < 1
      || !Number.isFinite(Date.parse(input.expires_at)))) throw fail('INVALID_REQUEST', 400);
}
function digest(input) {
  return createHash('sha256').update(JSON.stringify(['policy', 'resource_id', 'generation', 'task_id', 'intent_id', 'expires_at'].map(k => input[k]))).digest('hex');
}
export function createCacheService({ root = ROOT, now = Date.now, github: lookup = github, sample = disk,
  remove = path => rm(path, { recursive: true }) } = {}) {
  const store = createStore(root);
  async function identity(owner, absent = false) {
    if (!owner || !UUID.test(owner.resource_id) || !PR.test(owner.pr) || owner.machine !== 'mmv' || owner.repo !== REPO
        || !Number.isSafeInteger(owner.generation) || owner.generation < 1) throw fail('IDENTITY_CHANGED');
    const path = store.cache(owner.pr); const s = await stat(path);
    if (!s && absent) return null;
    if (!s?.isDirectory() || s.isSymbolicLink() || await realpath(path) !== path
        || s.dev !== owner.dev || s.ino !== owner.ino || s.uid !== owner.uid || (s.mode & 0o022)) throw fail('IDENTITY_CHANGED');
    return s;
  }
  async function terminal(owner) {
    let pr; try { pr = await lookup(owner.pr); } catch { throw fail('GITHUB_UNAVAILABLE', 503); }
    const closed = Date.parse(pr.closedAt); const finished = Date.parse(owner.last_writer_finished_at);
    if (!['CLOSED', 'MERGED'].includes(pr.state) || !Number.isFinite(closed) || !Number.isFinite(finished)
        || !/^[a-f0-9]{40}$/.test(pr.headRefOid) || pr.url !== `https://github.com/${REPO}/pull/${owner.pr}`
        || !Number.isFinite(Date.parse(pr.updatedAt))) throw fail('PR_NOT_TERMINAL');
    if (Math.max(closed, finished) + DAY > now()) throw fail('CACHE_NOT_EXPIRED');
    return { ...pr, observed_at: new Date(now()).toISOString() };
  }
  async function withWriter(pr, fn) {
    return store.lock(pr, async () => {
      let owner = await read(store.ownerPath(pr)); const cache = store.cache(pr); const existing = await stat(cache);
      if (owner?.inflight) {
        const record = await read(store.intentPath(owner.inflight));
        if (record?.status !== 'success') throw fail('RESOURCE_INFLIGHT');
      }
      if (!existing) {
        await mkdir(cache, { mode: 0o700 }); await syncDirectory(root);
        const s = await stat(cache);
        owner = { resource_id: randomUUID(), machine: 'mmv', repo: REPO, pr,
          dev: s.dev, ino: s.ino, uid: s.uid, generation: (owner?.generation || 0) + 1,
          last_writer_finished_at: null };
        await save(store.ownerPath(pr), owner);
      } else if (owner) await identity(owner);
      else if (!existing.isDirectory() || existing.isSymbolicLink() || await realpath(cache) !== cache) throw fail('IDENTITY_CHANGED');
      if (owner) { owner.last_writer_finished_at = null; await save(store.ownerPath(pr), owner); }
      try { return await fn(cache); } finally {
        if (owner) { await identity(owner); owner.last_writer_finished_at = new Date(now()).toISOString(); await save(store.ownerPath(pr), owner); }
      }
    });
  }
  async function listOwners() {
    if (!await store.prepare()) return [];
    const names = (await readdir(store.owners)).filter(name => /^[1-9][0-9]{0,8}\.json$/.test(name)).sort();
    const owners = [];
    for (const name of names) { const owner = await read(join(store.owners, name)); if (owner) owners.push(owner); }
    return owners;
  }
  async function plan(input) {
    validate(input, true); const resources = []; const blocked = [];
    for (const owner of await listOwners()) {
      try {
        if (await stat(join(store.locks, owner.pr))) throw fail('RESOURCE_LOCKED');
        if (owner.inflight) throw fail('RESOURCE_INFLIGHT');
        await identity(owner); const gh = await terminal(owner);
        resources.push({ machine: 'mmv', pr: owner.pr, github: gh,
          request: { policy: POLICY, resource_id: owner.resource_id, generation: owner.generation,
            expires_at: new Date(now() + TTL).toISOString() } });
      } catch (error) { blocked.push({ resource_id: owner.resource_id, code: error.code || 'RESOURCE_UNKNOWN' }); }
      if (resources.length >= 20) break;
    }
    return { policy: POLICY, resources, blocked };
  }
  async function receipt(id) {
    if (!UUID.test(id)) throw fail('INVALID_INTENT', 400);
    if (!await store.prepare()) throw fail('RECEIPT_NOT_FOUND', 404);
    const record = await read(store.intentPath(id)); if (!record) throw fail('RECEIPT_NOT_FOUND', 404);
    return record;
  }
  async function executeUnlocked(input) {
    validate(input); await store.prepare();
    const path = store.intentPath(input.intent_id); const hash = digest(input);
    const previous = await read(path);
    if (previous && previous.digest !== hash) throw fail('INTENT_CONFLICT');
    if (previous?.status === 'success') return previous;
    const owner = (await listOwners()).find(o => o.resource_id === input.resource_id && o.generation === input.generation);
    if (!owner) throw fail('RESOURCE_UNKNOWN', 404);
    return store.lock(owner.pr, async () => {
      const current = await read(store.ownerPath(owner.pr));
      if (current.resource_id !== input.resource_id || current.generation !== input.generation) throw fail('IDENTITY_CHANGED');
      const seen = await read(path);
      if (seen && seen.digest !== hash) throw fail('INTENT_CONFLICT');
      if (seen?.status === 'success') return seen;
      if (seen && (seen.status !== 'executing' || ['resource_id', 'generation', 'machine', 'repo', 'pr', 'dev', 'ino', 'uid']
        .some(key => seen.identity?.[key] !== current[key]))) throw fail('IDENTITY_CHANGED');
      if (current.inflight && current.inflight !== input.intent_id) throw fail('RESOURCE_INFLIGHT');
      const exists = await identity(current, seen?.status === 'executing');
      const expires = Date.parse(input.expires_at);
      if (exists && (expires <= now() || expires > now() + TTL)) throw fail('PLAN_EXPIRED');
      const gh = exists ? await terminal(current) : seen.github;
      let record = seen;
      if (!record) {
        record = { ...input, digest: hash, status: 'executing', actor: 'preview-agent:mmv', identity: current,
          github: gh, before: await sample(root), started_at: new Date(now()).toISOString() };
        // 持久intent先于归属inflight与删除；崩溃后同intent才能恢复。
        current.inflight = input.intent_id; await save(store.ownerPath(owner.pr), current);
        await save(path, record);
      }
      current.inflight = input.intent_id; await save(store.ownerPath(owner.pr), current);
      try {
        if (exists) {
          if (Date.parse(input.expires_at) <= now()) throw fail('PLAN_EXPIRED');
          await identity(current); await remove(store.cache(owner.pr)); await syncDirectory(root);
        }
        if (await stat(store.cache(owner.pr))) throw fail('DELETE_UNCONFIRMED');
        const after = await sample(root);
        record = { ...record, status: 'success', after, evidence: { absent: true, dev: current.dev, ino: current.ino },
          finished_at: new Date(now()).toISOString(), policy_version: POLICY };
        current.inflight = input.intent_id; await save(store.ownerPath(owner.pr), current);
        await save(path, record); return record;
      } catch { throw fail('EXECUTION_UNCONFIRMED', 503); }
    });
  }
  async function execute(input) {
    validate(input);
    return store.lock(`intent-${input.intent_id}`, () => executeUnlocked(input));
  }
  return Object.freeze({ withWriter, plan, execute, receipt });
}
