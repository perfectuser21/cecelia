import { POLICY, US_MACHINE_ID, UUID, IMAGE, selectImages, fail } from './policy.mjs';
import { digest } from './storage.mjs';
const ACTOR = 'janitor:us-brain-image-retention';
const identity = x => ({ machine_registry_id: x.machine_registry_id, daemon_id: x.daemon_id, docker_root_dir: x.docker_root_dir, volume_dev: x.volume_dev });
const sample = x => ({ ...x.disk, observed_at: x.observed_at });
function request(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'image_id,intent_id,run_id,task_id'
      || ![value.run_id, value.intent_id, value.task_id].every(x => UUID.test(x)) || !IMAGE.test(value.image_id)) throw fail('INVALID_CLEANUP_INTENT');
  return { run_id: value.run_id, image_id: value.image_id, intent_id: value.intent_id, task_id: value.task_id };
}
function observe(snapshot, expected, now) {
  const age = now - Date.parse(snapshot?.observed_at), disk = snapshot?.disk;
  if (expected.machine_registry_id !== US_MACHINE_ID || digest(identity(snapshot)) !== digest(expected)
      || !Number.isFinite(age) || age < -30000 || age > 120000 || !Array.isArray(snapshot.images) || snapshot.images.length > 10000
      || !Number.isSafeInteger(disk?.total_bytes) || disk.total_bytes <= 0 || !Number.isSafeInteger(disk.available_bytes)
      || disk.available_bytes < 0 || disk.available_bytes > disk.total_bytes) throw fail('OBSERVATION_UNCONFIRMED');
  const ids = new Set();
  for (const image of snapshot.images) { if (!IMAGE.test(image.id) || ids.has(image.id)) throw fail('OBSERVATION_UNCONFIRMED'); ids.add(image.id); }
  return ids;
}
export function createRetentionEngine({ store, docker, now = Date.now }) {
  const name = id => { if (!UUID.test(id)) throw fail('INVALID_RUN'); return `plan-${id}.json`; };
  async function plan(run_id) {
    return store.withLock(async lease => {
      const filename = name(run_id), ledger = await store.read('ledger.json'), old = await store.read(filename);
      if (ledger?.cleanup_run_id && ledger.cleanup_run_id !== run_id) throw fail('CLEANUP_RUN_PENDING');
      if (old?.status !== undefined && old.status !== 'running') return old;
      const snapshot = old ? null : await docker.snapshot(lease);
      const value = old ?? { schema_version: 1, policy: POLICY, run_id, status: 'running', identity: identity(snapshot),
        ledger_generation: ledger?.generation, expires_at: new Date(now() + 300000).toISOString(),
        images: selectImages(snapshot, ledger, now()).map(x => ({ id: x.id, tag: x.tags[0] })), claims: [] };
      if (!old) await store.save(filename, value, lease);
      if (ledger.cleanup_run_id !== run_id) await store.save('ledger.json', { ...ledger, cleanup_run_id: run_id }, lease);
      return value;
    });
  }
  const uncertain = row => ({ status: 'unconfirmed', ...row.request, policy: POLICY });
  async function settle(row, lease) {
    if (row.receipt) return row.receipt;
    if (row.evidence?.attempted === false) return store.complete(row.request.intent_id, { status: 'skipped', ...row.request, policy: POLICY, actor: ACTOR,
      digest: row.digest, identity: row.evidence.identity, attempted: false, reason: row.evidence.reason, confirmed_at: new Date(now()).toISOString() }, lease);
    let snapshot;
    try { snapshot = await docker.snapshot(lease); if (observe(snapshot, row.evidence.identity, now()).has(row.request.image_id) || await docker.absent(row.request.image_id, lease) !== true) return uncertain(row); }
    catch { return uncertain(row); }
    return store.complete(row.request.intent_id, { status: 'success', ...row.request, policy: POLICY, actor: ACTOR,
      digest: row.digest, identity: row.evidence.identity, attempted: true, evidence: { image_id: row.request.image_id, absent: true },
      before: row.evidence.before, after: sample(snapshot), confirmed_at: new Date(now()).toISOString() }, lease);
  }
  async function skip(body, value, reason, lease) {
    const row = await store.claim(body, lease, { attempted: false, identity: value.identity, reason });
    return settle(row, lease);
  }
  async function execute(input) {
    const body = request(input);
    return store.withLock(async lease => {
      const old = await store.intent(body.intent_id);
      if (old) { if (old.digest !== digest(body)) throw fail('INTENT_CONFLICT'); return settle(old, lease); }
      const value = await store.read(name(body.run_id));
      if (!value || !value.images.some(x => x.id === body.image_id)) throw fail('IMAGE_NOT_PLANNED');
      const claim = value.claims.find(x => x.image_id === body.image_id);
      if (claim && digest(claim) !== digest(body)) throw fail('IMAGE_ALREADY_CLAIMED');
      if (claim) return skip(body, value, 'RESERVATION_INTERRUPTED', lease);
      if (value.status !== 'running') throw fail('CLEANUP_PLAN_FINISHED');
      await store.save(name(body.run_id), { ...value, claims: [...value.claims, body] }, lease);
      const ledger = await store.read('ledger.json'); let snapshot, reason;
      if (ledger?.cleanup_run_id !== body.run_id || ledger.generation !== value.ledger_generation) reason = 'DEPLOYMENT_CHANGED';
      else if (now() >= Date.parse(value.expires_at)) reason = 'PLAN_EXPIRED';
      else {
        try {
          snapshot = await docker.snapshot(lease); observe(snapshot, value.identity, now());
          if (!selectImages(snapshot, ledger, now(), { continuing: true }).some(x => x.id === body.image_id)) reason = 'CANDIDATE_CHANGED';
        } catch { reason = 'FINAL_ADMISSION_REJECTED'; }
      }
      if (reason) return skip(body, value, reason, lease);
      // 先原子封存本次真实采样及完整执行身份；之后任何重试只观察，绝不重发删除。
      const row = await store.claim(body, lease, { attempted: true, identity: value.identity, before: sample(snapshot) });
      try { await docker.remove(body.image_id, lease); } catch { /* 删除结果未知，由精确观察裁决。 */ }
      return settle(row, lease);
    });
  }
  async function recover(input) {
    const body = request(input);
    return store.withLock(async lease => {
      const row = await store.intent(body.intent_id);
      if (row) { if (row.digest !== digest(body)) throw fail('INTENT_CONFLICT'); return settle(row, lease); }
      const value = await store.read(name(body.run_id));
      if (!value || !value.images.some(x => x.id === body.image_id)) throw fail('IMAGE_NOT_PLANNED');
      const claim = value.claims.find(x => x.image_id === body.image_id);
      if (claim && digest(claim) !== digest(body)) throw fail('IMAGE_ALREADY_CLAIMED');
      if (!claim && value.status === 'running') await store.save(name(body.run_id), { ...value, claims: [...value.claims, body] }, lease);
      return skip(body, value, 'RESERVATION_INTERRUPTED', lease);
    });
  }
  async function receipt(intent_id) {
    return store.withLock(async lease => { const row = await store.intent(intent_id); return row ? settle(row, lease) : null; });
  }
  async function finishPlan(run_id) {
    return store.withLock(async lease => {
      const value = await store.read(name(run_id));
      if (!value) return { status: 'skipped', run_id, freed_bytes: 0 };
      if (value.status !== 'running') {
        const ledger = await store.read('ledger.json');
        if (ledger?.cleanup_run_id === run_id) await store.save('ledger.json', { ...ledger, cleanup_run_id: null }, lease);
        return value.result;
      }
      const receipts = [];
      for (const body of value.claims) {
        const row = await store.intent(body.intent_id);
        const result = row ? await settle(row, lease) : await skip(body, value, 'RESERVATION_INTERRUPTED', lease);
        if (result.status === 'unconfirmed') return { status: 'unconfirmed', run_id };
        receipts.push(result);
      }
      const result = { status: receipts.some(x => x.status === 'success') ? 'success' : 'skipped', run_id,
        freed_bytes: receipts.reduce((sum, x) => sum + (x.status === 'success' ? Math.max(0, x.after.available_bytes - x.before.available_bytes) : 0), 0) };
      await store.save(name(run_id), { ...value, status: result.status, result, unattempted: value.images.filter(x => !value.claims.some(c => c.image_id === x.id)).map(x => x.id) }, lease);
      const ledger = await store.read('ledger.json');
      if (ledger?.cleanup_run_id === run_id) await store.save('ledger.json', { ...ledger, cleanup_run_id: null }, lease);
      return result;
    });
  }
  return Object.freeze({ plan, execute, recover, receipt, finishPlan });
}
