export const POLICY = 'us-brain-image-retention-v1';
export const US_MACHINE_ID = '1a379d80-ad36-47d3-88ba-e545ab299a54';
export const IMAGE = /^sha256:[a-f0-9]{64}$/;
export const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
export const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const GiB = 2 ** 30;
export function fail(code) { return Object.assign(new Error(code), { code }); }
/**
 * 部署收账（ledger.finish）读到的健康口径。
 * /api/brain/health 的 healthy 要求 tick 循环在跑；tick 被有意封停（决策 751f73be）时它恒为 degraded，
 * 收账要求 healthy → 容器已换成功却永远收不了账，台账 pending 卡死后续全部部署（2026-10-04 实证）。
 * 只有当 degraded 的唯一原因是「调度器被有意关闭」才折算为 healthy：scheduler.enabled===false，
 * 且断路器无 OPEN、docker/fleet 均无异常（与 /health 的 healthy 公式逐项对应）。缺字段/形状不明一律不折算。
 * version 与 git_sha 原样返回，收账仍要它们与部署身份逐项相符。
 */
export function deployHealth(value) {
  const sealedOnly = value?.status === 'degraded'
    && value.organs?.scheduler?.enabled === false
    && Array.isArray(value.organs?.circuit_breaker?.open) && value.organs.circuit_breaker.open.length === 0
    && !(value.docker_runtime?.enabled === true && value.docker_runtime?.status === 'unhealthy')
    && !(value.fleet_transport?.enabled === true && value.fleet_transport?.status === 'unavailable');
  return { status: sealedOnly ? 'healthy' : value?.status, version: value?.version, git_sha: value?.git_sha };
}
function disk(value) {
  if (!Number.isSafeInteger(value?.total_bytes) || value.total_bytes <= 0 || !Number.isSafeInteger(value.available_bytes)
      || value.available_bytes < 0 || value.available_bytes > value.total_bytes) throw fail('DISK_SAMPLE_UNKNOWN');
  return value;
}
export function canStart(value) { const d = disk(value); return d.available_bytes <= d.total_bytes * .15 || d.available_bytes < 15 * GiB; }
export function recovered(value) { const d = disk(value); return d.available_bytes >= d.total_bytes * .2 && d.available_bytes >= 20 * GiB; }
export function protectedImages(snapshot, ledger, now = Date.now()) {
  const age = now - Date.parse(snapshot?.observed_at);
  if (snapshot?.machine_registry_id !== US_MACHINE_ID || typeof snapshot.daemon_id !== 'string' || !snapshot.daemon_id
      || typeof snapshot.docker_root_dir !== 'string' || !snapshot.docker_root_dir.startsWith('/')
      || !Number.isSafeInteger(snapshot.volume_dev) || snapshot.volume_dev < 0 || !Number.isFinite(age) || age < -30000 || age > 120000
      || !Array.isArray(snapshot.images) || snapshot.images.length > 10000 || !Array.isArray(snapshot.containers) || snapshot.containers.length > 10000) throw fail('HOST_IDENTITY_UNKNOWN');
  disk(snapshot.disk);
  const ids = new Set();
  for (const image of snapshot.images) {
    if (!IMAGE.test(image.id) || ids.has(image.id) || !Array.isArray(image.tags) || !Array.isArray(image.digests)
        || image.tags.some(x => typeof x !== 'string') || image.digests.some(x => typeof x !== 'string')
        || !Number.isFinite(Date.parse(image.created_at))) throw fail('IMAGE_IDENTITY_UNKNOWN');
    ids.add(image.id);
  }
  const current = snapshot.containers.filter(x => x.name === '/cecelia-node-brain' && x.running === true);
  if (current.length !== 1 || !ids.has(current[0].image_id)) throw fail('CURRENT_IMAGE_UNKNOWN');
  const keep = new Set();
  for (const container of snapshot.containers) {
    if (!/^[a-f0-9]{64}$/.test(container.id) || !IMAGE.test(container.image_id) || typeof container.running !== 'boolean') throw fail('CONTAINER_IDENTITY_UNKNOWN');
    keep.add(container.image_id);
  }
  if (ledger?.schema_version !== 1 || !Number.isSafeInteger(ledger.generation) || ledger.generation < 1
      || !Object.hasOwn(ledger, 'pending') || !Array.isArray(ledger.successes) || ledger.successes.length > 128) throw fail('DEPLOY_HISTORY_UNKNOWN');
  if (ledger.pending) throw fail('DEPLOYMENT_PENDING');
  const history = [];
  for (const entry of ledger.successes) {
    const elapsed = now - Date.parse(entry.confirmed_at);
    if (!UUID.test(entry.deployment_id) || !IMAGE.test(entry.image_id) || !VERSION.test(entry.version)
        || !/^[a-f0-9]{40}$/.test(entry.git_sha) || !Number.isFinite(elapsed) || elapsed < -30000) throw fail('DEPLOY_HISTORY_UNKNOWN');
    history.push(entry);
  }
  const rollback = [...new Set(history.sort((a, b) => Date.parse(b.confirmed_at) - Date.parse(a.confirmed_at))
    .map(x => x.image_id).filter(id => id !== current[0].image_id))].slice(0, 2);
  if (rollback.length !== 2 || rollback.some(id => !ids.has(id))) throw fail('TWO_SUCCESSFUL_ROLLBACKS_REQUIRED');
  for (const id of rollback) keep.add(id);
  for (const image of snapshot.images) if (image.tags.some(tag => ['cecelia-brain:latest', 'cecelia-brain:blue-fallback'].includes(tag))) keep.add(image.id);
  return keep;
}
export function selectImages(snapshot, ledger, now = Date.now(), { continuing = false } = {}) {
  const keep = protectedImages(snapshot, ledger, now);
  if (continuing ? recovered(snapshot.disk) : !canStart(snapshot.disk)) return [];
  return snapshot.images.filter(image => !keep.has(image.id) && image.tags.length === 1 && (image.digests.length === 0 || (image.digests.length === 1 && image.digests[0] === `cecelia-brain@${image.id}`))
    && image.tags[0].startsWith('cecelia-brain:') && VERSION.test(image.tags[0].slice('cecelia-brain:'.length))
    && Date.parse(image.created_at) <= now - 86400000)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id)).slice(0, 2);
}
