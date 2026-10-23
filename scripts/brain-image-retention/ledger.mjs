import { fail, UUID, VERSION, IMAGE } from './policy.mjs';
import { digest } from './storage.mjs';
export const RECONCILE_MIN_AGE_MS = 15 * 60 * 1000;
function current(snapshot, expectedContainerId) {
  const matches = snapshot.containers.filter(x => x.name === '/cecelia-node-brain' && x.running === true);
  if (expectedContainerId !== undefined && (matches.length !== 1 || matches[0].id !== expectedContainerId)) throw fail('DEPLOY_CONTAINER_MISMATCH');
  const image = matches.length === 1 && snapshot.images.find(x => x.id === matches[0].image_id);
  if (!image || !IMAGE.test(image.id) || !/^[a-f0-9]{40}$/.test(image.git_sha ?? '')) throw fail('CURRENT_IMAGE_UNKNOWN');
  return { ...image, container_id: matches[0].id };
}
// 恢复只认可begin封存的previous身份及官方构建的精确保留标签。
function previousVersion(tags, version, gitSha) {
  return tags.includes(`cecelia-brain:${version}`) || tags.includes(`cecelia-brain:prev-${version}-${gitSha.slice(0, 12)}`);
}
export function createDeploymentLedger({ store, docker, health, now = Date.now, expectedContainerId }) {
  if (expectedContainerId !== undefined && !/^[a-f0-9]{64}$/.test(expectedContainerId)) throw fail('INVALID_CONTAINER_ID');
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
    const pending = ledger.pending ?? { deployment_id: request.deployment_id, request, previous: { id: previous.id, git_sha: previous.git_sha, tags: previous.tags }, ...(target_image_id ? { target_image_id } : {}), begun_at: new Date(now()).toISOString() };
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
      const canonicalTarget = target?.tags.includes(`cecelia-brain:${request.version}`);
      const previousTarget = ledger.pending && ledger.pending.previous.id === image_id && ledger.pending.previous.git_sha === request.git_sha
        && target && previousVersion(target.tags, request.version, request.git_sha);
      if (!target || target.git_sha !== request.git_sha || (!canonicalTarget && !previousTarget)) throw fail('ROLLBACK_TARGET_MISMATCH');
      if (!ledger.pending) {
        const row = await beginLocked(request, lease, image_id);
        if (row.receipt) throw fail('DEPLOYMENT_ALREADY_FINISHED');
        return { deployment_id: request.deployment_id, outcome: 'success', image_id };
      }
      const pending = ledger.pending;
      if (canonicalTarget && !pending.recovering && pending.target_image_id === image_id
          && pending.request.git_sha === request.git_sha && pending.request.version === request.version) {
        const row = await store.read(name(pending.deployment_id));
        if (row?.receipt || (row && (digest(row.request) !== digest(pending.request) || row.target_image_id !== image_id))) throw fail('DEPLOYMENT_CONFLICT');
        if (!row) await store.save(name(pending.deployment_id), { request: pending.request, previous: pending.previous, target_image_id: image_id, receipt: null }, lease);
        return { deployment_id: pending.deployment_id, outcome: 'success', image_id };
      }
      if (pending.previous.id !== image_id || pending.previous.git_sha !== request.git_sha
          || !previousVersion(pending.previous.tags, request.version, request.git_sha)) throw fail('ROLLBACK_TARGET_MISMATCH');
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
        const before = current(await docker.snapshot(lease), expectedContainerId), observed = await health(lease), after = current(await docker.snapshot(lease), expectedContainerId);
        if (before.container_id !== after.container_id) throw fail('DEPLOY_CONTAINER_MISMATCH');
        const expectedSha = outcome === 'success' ? row.request.git_sha : row.previous.git_sha;
        if (before.id !== after.id || (outcome === 'success' && row.target_image_id && after.id !== row.target_image_id) || after.git_sha !== expectedSha || (outcome === 'recovered' && after.id !== row.previous.id)
            || (outcome === 'success' && !after.tags.includes(`cecelia-brain:${row.request.version}`))) throw fail('DEPLOY_IMAGE_MISMATCH');
        if (observed?.status !== 'healthy' || observed.git_sha !== expectedSha || !VERSION.test(observed.version ?? '')
            || !(outcome === 'recovered' ? previousVersion(row.previous.tags ?? [], observed.version, expectedSha) : after.tags.includes(`cecelia-brain:${observed.version}`))
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
  // 陈旧 pending 带外补收账（任务 502f2852 / B3）：结算方（部署进程 trap EXIT、sidecar）没跑到时，下一次 begin 抛 DEPLOYMENT_PENDING。
  // 按运行容器镜像分流两个出口，全部核验仍交给 finish，核验不过即抛错、不改状态：
  //   - 容器已是 pending 目标 → success（sidecar 收账失败遗留，任务 502f2852）；
  //   - 容器仍是 previous 镜像（id + git_sha）→ recovered（部署进程在 Brain 容器内被 SIGKILL，a80485b3），只清 pending、不写成功史；
  //   - 其余（未知镜像）→ DEPLOYMENT_RECONCILE_UNKNOWN。
  // 新鲜期内（部署可能在途）与恢复中（rollback 在途）一律拒绝；无 begun_at 的旧格式 pending 视为陈旧。
  async function reconcile() {
    const ledger = await state();
    if (!ledger.pending) return null;
    const pending = ledger.pending, begunAt = Date.parse(pending.begun_at);
    if (pending.recovering) throw fail('DEPLOYMENT_RECOVERING');
    if (pending.begun_at !== undefined && (!Number.isFinite(begunAt) || now() - begunAt < RECONCILE_MIN_AGE_MS)) throw fail('DEPLOYMENT_PENDING_FRESH');
    const running = await store.withLock(async lease => current(await docker.snapshot(lease)));
    const atTarget = pending.target_image_id ? running.id === pending.target_image_id : running.git_sha === pending.request.git_sha;
    const atPrevious = running.id === pending.previous.id && running.git_sha === pending.previous.git_sha;
    if (!atTarget && !atPrevious) throw fail('DEPLOYMENT_RECONCILE_UNKNOWN');
    return finish(pending.deployment_id, atTarget ? 'success' : 'recovered');
  }
  // 只读已完成部署：证明当前实例仍对应最近成功收据，不代表最近请求已成功。
  async function settlement(runtimeSha) {
    if (!/^[a-f0-9]{40}$/.test(runtimeSha ?? '')) throw fail('DEPLOY_RUNTIME_UNKNOWN');
    return store.withLock(async lease => {
      const before = await state(), receipt = before.successes[0];
      if (before.pending !== null || !receipt || receipt.outcome !== 'success'
          || !UUID.test(receipt.deployment_id ?? '') || !IMAGE.test(receipt.image_id ?? '')
          || receipt.git_sha !== runtimeSha || !VERSION.test(receipt.version ?? '')
          || !Number.isFinite(Date.parse(receipt.confirmed_at))) throw fail('DEPLOY_UNSETTLED');
      const row = await store.read(name(receipt.deployment_id));
      if (!row || digest(row.receipt) !== digest(receipt) || row.request.deployment_id !== receipt.deployment_id || row.request.git_sha !== runtimeSha
          || row.request.version !== receipt.version || (row.target_image_id && row.target_image_id !== receipt.image_id)) throw fail('DEPLOY_RECEIPT_MISMATCH');
      const first = current(await docker.snapshot(lease));
      const observed = await docker.containerHealth(first.container_id, lease);
      const last = current(await docker.snapshot(lease));
      if (first.container_id !== last.container_id || first.id !== last.id || last.id !== receipt.image_id
          || first.git_sha !== runtimeSha || last.git_sha !== runtimeSha
          || observed.status !== 'healthy' || observed.git_sha !== runtimeSha || observed.version !== receipt.version)
        throw fail('DEPLOY_CURRENT_MISMATCH');
      const after = await state();
      if (digest(before) !== digest(after)) throw fail('DEPLOY_HISTORY_CHANGED');
      return { ...receipt, container_id: last.container_id };
    });
  }
  return Object.freeze({ begin, rollback, finish, reconcile, settlement });

}
