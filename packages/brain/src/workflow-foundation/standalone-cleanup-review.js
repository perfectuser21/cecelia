import { createHash } from 'node:crypto';
import { onlyKeys, requireFoundation } from './contracts.js';

export const desktopCleanupFailure = 'standalone_cleanup_unconfirmed';
export const desktopUnknown = 'DESKTOP_UNKNOWN';

const sha = value => createHash('sha256').update(value).digest('hex');
const invalid = ok => requireFoundation(ok, 'standalone_start_review_invalid', 400);
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;
const localhost = /^127\.0\.0\.1:([1-9][0-9]{0,4})$/;
const component = /^([a-zA-Z][a-zA-Z0-9_.]+)\/(\.?[a-zA-Z][a-zA-Z0-9_.$]+)$/;

function androidComponent(name) {
  const match = typeof name === 'string' && name.length <= 240 && component.exec(name);
  invalid(match);
  const [,pkg,activity] = match;
  return { package: pkg, activity: activity.startsWith('.') ? pkg + activity : activity };
}

export function verifyDesktopCleanupProof(review, host) {
  const artifact = review.cleanup_diagnostic;
  invalid(review.admission_code === desktopUnknown && review.hardware_diagnostic === undefined);
  onlyKeys(artifact,['raw','sha256','adb_endpoint','adb_serial','central_lease_version','desktop_readback']);
  const { raw, sha256, adb_endpoint: endpoint, adb_serial: serial, central_lease_version: version, desktop_readback: desktop } = artifact;
  const socket = typeof endpoint === 'string' && endpoint.startsWith('tcp:') && localhost.exec(endpoint.slice(4));
  const transport = typeof serial === 'string' && localhost.exec(serial);
  invalid(typeof raw === 'string' && Buffer.byteLength(raw) <= 8192 && sha(raw) === sha256
    && socket && Number(socket[1]) <= 65535 && transport && Number(transport[1]) <= 65535
    && typeof version === 'string' && /^[0-9]{1,12}$/.test(version));
  onlyKeys(desktop,['serial','default_home','focused_activity','observed_at']);
  const home = androidComponent(desktop.default_home);
  const foreground = androidComponent(desktop.focused_activity);
  invalid(typeof desktop.serial === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(desktop.serial)
    && foreground.package === home.package && foreground.activity === home.activity
    && validTime(desktop.observed_at) && validTime(review.observed_at)
    && Date.parse(desktop.observed_at) >= Date.parse(review.revocation.observed_at)
    && Date.parse(desktop.observed_at) <= Date.parse(review.observed_at)
    && Date.parse(review.observed_at) - Date.parse(desktop.observed_at) <= 60_000);

  let original;
  try { original = JSON.parse(raw); } catch { invalid(false); }
  onlyKeys(original,['task_id','run_id','execution_mode','native_return_unknown','quarantine_verified',
    'local_released','central_released','desktop','leaves']);
  const seal = original.leaves;
  onlyKeys(seal,['complete','empty_complete','requests_returned','empty_requests_returned','epoch_fence_lost','leaves','ledger']);
  invalid(original.task_id === host.task_id && original.run_id === host.run_id
    && original.execution_mode === 'codex-direct' && original.native_return_unknown === true
    && original.quarantine_verified === true && original.local_released === false
    && original.central_released === false && original.desktop === null
    && seal.complete === true && seal.empty_complete === false && seal.requests_returned === true
    && seal.empty_requests_returned === false && seal.epoch_fence_lost === false
    && typeof seal.ledger === 'string' && seal.ledger.startsWith(host.run_directory + '/standalone-leaves/')
    && /^collection-leaves-[a-f0-9]+\.jsonl$/.test(seal.ledger.split('/').at(-1))
    && Array.isArray(seal.leaves) && seal.leaves.length > 0 && seal.leaves.length <= 10);

  const args = [['version'],['-H','127.0.0.1','-P',socket[1],'-s',serial,'get-state']];
  const readOnly = new Set(args.map(value=>sha(JSON.stringify(value))));
  let previousEnd = 0;
  for (const [index,leaf] of seal.leaves.entries()) {
    onlyKeys(leaf,['sequence','argv_sha256','intent_at','boundary','pid','started_at','ended_at','code','signal',
      'tainted','dump_crash_returned','request_returned']);
    invalid(leaf.sequence === index + 1 && readOnly.has(leaf.argv_sha256)
      && leaf.boundary === 'darwin-sandbox-deny-process-fork-v1' && Number.isSafeInteger(leaf.pid) && leaf.pid > 0
      && [leaf.intent_at,leaf.started_at,leaf.ended_at].every(Number.isSafeInteger)
      && leaf.intent_at >= previousEnd && leaf.started_at >= leaf.intent_at && leaf.ended_at >= leaf.started_at
      && leaf.ended_at <= Date.parse(review.revocation.observed_at) && leaf.code === 0 && leaf.signal === null
      && leaf.tainted === false && leaf.dump_crash_returned === false && leaf.request_returned === true);
    previousEnd = leaf.ended_at;
  }
  return { sha256, firstIntentAt: seal.leaves[0].intent_at, serial: desktop.serial, leaseVersion: version };
}
