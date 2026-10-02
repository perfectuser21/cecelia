import { fail, UUID, VERSION, IMAGE } from './policy.mjs';
import { digest } from './storage.mjs';
function current(snapshot) {
  const matches = snapshot.containers.filter(x => x.name === '/cecelia-node-brain' && x.running === true);
  const image = matches.length === 1 && snapshot.images.find(x => x.id === matches[0].image_id);
  if (!image || !IMAGE.test(image.id) || !/^[a-f0-9]{40}$/.test(image.git_sha ?? '')) throw fail('CURRENT_IMAGE_UNKNOWN');
  return image;
}
export function createDeploymentLedger({ store, docker, health, now = Date.now }) {
  const name = id => { if (!UUID.test(id)) throw fail('INVALID_DEPLOYMENT'); return `deployment-${id}.json`; };
  async function state() {
    const value = await store.read('ledger.json');
    if (!value) return { schema_version: 1, generation: 1, pending: null, successes: [] };
    if (value.schema_version !== 1 || !Number.isSafeInteger(value.generation) || value.generation < 1
        || !Array.isArray(value.successes) || value.successes.length > 128 || !Object.hasOwn(value, 'pending')) throw fail('DEPLOY_HISTORY_UNKNOWN');
    return value;
  }
  async function beginLocked(request, lease, target_image_id) {
    const ledger = await state(), old = await store.read(name(request.deployment_id));
    if (old) { if (digest(old.request) !== digest(request) || old.target_image_id !== target_image_id) throw fail('DEPLOYMENT_CONFLICT'); return old; }
    if (ledger.pending && digest(ledger.pending.request) !== digest(request)) throw fail('DEPLOYMENT_PENDING');
    const previous = ledger.pending?.previous ?? current(await docker.snapshot(lease));
    const pending = ledger.pending ?? { deployment_id: request.deployment_id, request, previous: { id: previous.id, git_sha: previous.git_sha, tags: previous.tags }, ...(target_image_id ? { target_image_id } : {}) };
    await store.save('ledger.json', { ...ledger, generation: ledger.generation + 1, pending }, lease);
    const row = { request, previous: pending.previous, ...(pending.target_image_id ? { target_image_id: pending.target_image_id } : {}), receipt: null };
    await store.save(name(request.deployment_id), row, lease); return row;
  }
  function validate(request) {
    if (!request || Object.keys(request).sort().join(',') !== 'deployment_id,git_sha,version'
        || !UUID.test(request.deployment_id) || !VERSION.test(request.version) || !/^[a-f0-9]{40}$/.test(request.git_sha)) throw fail('INVALID_DEPLOYMENT');
  }
  async function begin(request) {
    validate(request); return store.withLock(lease => beginLocked(request, lease));
  }
  async function rollback(input) {
    if (!input || Object.keys(input).sort().join(',') !== 'deployment_id,git_sha,image_id,version' || !IMAGE.test(input.image_id)) throw fail('INVALID_DEPLOYMENT');
    const { image_id, ...request } = input; validate(request);
    return store.withLock(async lease => {
      const ledger = await state();
      const snapshot = await docker.snapshot(lease), target = snapshot.images.find(x => x.id === image_id);
      if (!target || target.git_sha !== request.git_sha || !target.tags.includes(`cecelia-brain:${request.version}`)) throw fail('ROLLBACK_TARGET_MISMATCH');
      if (!ledger.pending) {
        const row = await beginLocked(request, lease, image_id);
        if (row.receipt) throw fail('DEPLOYMENT_ALREADY_FINISHED');
        return { deployment_id: request.deployment_id, outcome: 'success', image_id };
      }
      const pending = ledger.pending;
      if (pending.previous.id !== image_id || pending.previous.git_sha !== request.git_sha
          || !pending.previous.tags.includes(`cecelia-brain:${request.version}`)) throw fail('ROLLBACK_TARGET_MISMATCH');
      const row = await store.read(name(pending.deployment_id));
      if (row?.receipt || (row && digest(row.request) !== digest(pending.request))) throw fail('DEPLOYMENT_CONFLICT');
      if (!row) await store.save(name(pending.deployment_id), { request: pending.request, previous: pending.previous, receipt: null }, lease);
      // 原部署身份保留；进入恢复后迟到的success不能将失败目标记为成功。
      if (!pending.recovering) await store.save('ledger.json', { ...ledger, generation: ledger.generation + 1, pending: { ...pending, recovering: true } }, lease);
      return { deployment_id: pending.deployment_id, outcome: 'recovered', image_id };
    });
  }
  async function finish(id, outcome) {
    if (!['success', 'recovered'].includes(outcome)) throw fail('INVALID_DEPLOY_OUTCOME');
    return store.withLock(async lease => {
      const row = await store.read(name(id)), ledger = await state();
      if (!row || row.request.deployment_id !== id) throw fail('DEPLOYMENT_MISSING');
      if (row.receipt && row.receipt.outcome !== outcome) throw fail('DEPLOYMENT_CONFLICT');
      if (!ledger.pending) {
        if (!row.receipt) throw fail('DEPLOYMENT_CONFLICT'); return row.receipt;
      }
      if (ledger.pending.deployment_id !== id || digest(ledger.pending.request) !== digest(row.request)) throw fail('DEPLOYMENT_CONFLICT');
      if (ledger.pending.recovering && outcome !== 'recovered') throw fail('DEPLOYMENT_RECOVERING');
      let receipt = row.receipt;
      if (!receipt) {
        const before = current(await docker.snapshot(lease)), observed = await health(), after = current(await docker.snapshot(lease));
        const expectedSha = outcome === 'success' ? row.request.git_sha : row.previous.git_sha;
        if (before.id !== after.id || (outcome === 'success' && row.target_image_id && after.id !== row.target_image_id) || after.git_sha !== expectedSha || (outcome === 'recovered' && after.id !== row.previous.id)
            || (outcome === 'success' && !after.tags.includes(`cecelia-brain:${row.request.version}`))) throw fail('DEPLOY_IMAGE_MISMATCH');
        if (observed?.status !== 'healthy' || observed.git_sha !== expectedSha || !VERSION.test(observed.version ?? '')
            || !after.tags.includes(`cecelia-brain:${observed.version}`)
            || (outcome === 'success' && observed.version !== row.request.version)) throw fail('DEPLOY_HEALTH_MISMATCH');
        receipt = { deployment_id: id, outcome, image_id: after.id, version: observed.version, git_sha: expectedSha,
          confirmed_at: new Date(now()).toISOString(), actor: 'brain-deploy:us-vps' };
        await store.save(name(id), { ...row, receipt }, lease);
      }
      const successes = outcome === 'success' ? [receipt, ...ledger.successes.filter(x => x.image_id !== receipt.image_id)].slice(0, 128) : ledger.successes;
      await store.save('ledger.json', { ...ledger, generation: ledger.generation + 1, pending: null, successes }, lease);
      return receipt;
    });
  }
  return Object.freeze({ begin, rollback, finish });
}
