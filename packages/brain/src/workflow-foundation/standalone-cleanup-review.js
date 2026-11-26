import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
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

function verifyTerminalAckLedger(ledger, leaves, target) {
  onlyKeys(ledger,['raw','sha256']);
  const {raw,sha256}=ledger;
  invalid(typeof raw==='string' && Buffer.byteLength(raw)<=12288 && raw.endsWith('\n') && sha(raw)===sha256);
  const commands=[['version'],['version'],[...target,'get-state'],['version'],
    [...target,'shell','cmd','package','resolve-activity','-a','android.intent.action.MAIN','-c','android.intent.category.HOME'],
    ['version'],[...target,'shell','input','keyevent','3'],['version']];
  invalid(leaves.length===commands.length && commands.every((argv,index)=>sha(JSON.stringify(argv))===leaves[index].argv_sha256));
  let records;
  try { records=raw.slice(0,-1).split('\n').map(line=>JSON.parse(line)); } catch { invalid(false); }
  const expected=leaves.flatMap(leaf=>{
    const {sequence,argv_sha256,intent_at,boundary,pid,started_at}=leaf;
    const intent={sequence,argv_sha256,intent_at,boundary};
    return [{...intent,phase:'intent'},{...intent,pid,started_at,phase:'started'},{...leaf,phase:'exit'}];
  });
  // Only the final version probe lost its response handshake. The single HOME had already returned.
  expected.push({...leaves.at(-1),phase:'unknown'});
  invalid(isDeepStrictEqual(records,expected));
  return sha256;
}

export function verifyDesktopCleanupProof(review, host) {
  const artifact = review.cleanup_diagnostic;
  invalid(review.admission_code === desktopUnknown && review.hardware_diagnostic === undefined);
  onlyKeys(artifact,['raw','sha256','adb_endpoint','adb_serial','central_lease_version','desktop_readback','terminal_ack_ledger']);
  const { raw, sha256, adb_endpoint: endpoint, adb_serial: serial, central_lease_version: version, desktop_readback: desktop,terminal_ack_ledger:ledger } = artifact;
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
  const allReturned=ledger===undefined;
  invalid(original.task_id === host.task_id && original.run_id === host.run_id
    && original.execution_mode === 'codex-direct' && original.native_return_unknown === true
    && original.quarantine_verified === true && original.local_released === false
    && original.central_released === false && original.desktop === null
    && seal.complete === allReturned && seal.empty_complete === false && seal.requests_returned === allReturned
    && seal.empty_requests_returned === false && seal.epoch_fence_lost === false
    && typeof seal.ledger === 'string' && seal.ledger.startsWith(host.run_directory + '/standalone-leaves/')
    && /^collection-leaves-[a-f0-9]+\.jsonl$/.test(seal.ledger.split('/').at(-1))
    && Array.isArray(seal.leaves) && seal.leaves.length > 0 && seal.leaves.length <= 10);

  const target=['-H','127.0.0.1','-P',socket[1],'-s',serial];
  const args = [['version'],[...target,'get-state']];
  const readOnly = new Set(args.map(value=>sha(JSON.stringify(value))));
  let previousEnd = 0;
  for (const [index,leaf] of seal.leaves.entries()) {
    onlyKeys(leaf,['sequence','argv_sha256','intent_at','boundary','pid','started_at','ended_at','code','signal',
      'tainted','dump_crash_returned','request_returned']);
    invalid(leaf.sequence === index + 1 && (!allReturned || readOnly.has(leaf.argv_sha256))
      && leaf.boundary === 'darwin-sandbox-deny-process-fork-v1' && Number.isSafeInteger(leaf.pid) && leaf.pid > 0
      && [leaf.intent_at,leaf.started_at,leaf.ended_at].every(Number.isSafeInteger)
      && leaf.intent_at >= previousEnd && leaf.started_at >= leaf.intent_at && leaf.ended_at >= leaf.started_at
      && leaf.ended_at <= Date.parse(review.revocation.observed_at) && leaf.code === 0 && leaf.signal === null
      && leaf.tainted === false && leaf.dump_crash_returned === false && leaf.request_returned === true);
    previousEnd = leaf.ended_at;
  }
  const ledgerSha256=allReturned ? undefined : verifyTerminalAckLedger(ledger,seal.leaves,target);
  return { sha256, ledgerSha256, firstIntentAt: seal.leaves[0].intent_at, serial: desktop.serial, leaseVersion: version };
}
