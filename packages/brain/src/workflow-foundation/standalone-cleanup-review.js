import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { onlyKeys, requireFoundation } from './contracts.js';

export const desktopCleanupFailure = 'standalone_cleanup_unconfirmed';
export const desktopUnknown = 'DESKTOP_UNKNOWN';
export const preflightTimeout = 'TOOL_RESULT_UNKNOWN';

const sha = value => createHash('sha256').update(value).digest('hex');
const invalid = ok => requireFoundation(ok, 'standalone_start_review_invalid', 400);
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;
const localhost = /^127\.0\.0\.1:([1-9][0-9]{0,4})$/;
const component = /^([a-zA-Z][a-zA-Z0-9_.]+)\/(\.?[a-zA-Z][a-zA-Z0-9_.$]+)$/;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

function androidComponent(name) {
  const match = typeof name === 'string' && name.length <= 240 && component.exec(name);
  invalid(match);
  const [,pkg,activity] = match;
  return { package: pkg, activity: activity.startsWith('.') ? pkg + activity : activity };
}

function verifyTerminalAckLedger(ledger, leaves, target, preflight) {
  onlyKeys(ledger,['raw','sha256']);
  const {raw,sha256}=ledger;
  invalid(typeof raw==='string' && Buffer.byteLength(raw)<=12288 && raw.endsWith('\n') && sha(raw)===sha256);
  const probes=preflight
    ? [[...target,'shell','getprop','ro.product.model'],[...target,'shell','dumpsys','telephony.registry']]
    : [[...target,'shell','cmd','package','resolve-activity','-a','android.intent.action.MAIN','-c','android.intent.category.HOME'],
      [...target,'shell','input','keyevent','3']];
  const commands=[['version'],['version'],[...target,'get-state'],['version'],probes[0],['version'],probes[1],['version']];
  invalid(leaves.length===commands.length && commands.every((argv,index)=>sha(JSON.stringify(argv))===leaves[index].argv_sha256));
  let records;
  try { records=raw.slice(0,-1).split('\n').map(line=>JSON.parse(line)); } catch { invalid(false); }
  const expected=leaves.flatMap(leaf=>{
    const {sequence,argv_sha256,intent_at,boundary,pid,started_at}=leaf;
    const intent={sequence,argv_sha256,intent_at,boundary};
    return [{...intent,phase:'intent'},{...intent,pid,started_at,phase:'started'},{...leaf,phase:'exit'}];
  });
  // Only the final local version probe lost its response handshake.
  expected.push({...leaves.at(-1),phase:'unknown'});
  invalid(isDeepStrictEqual(records,expected));
  return sha256;
}

function verifyPreflightTimeout(proof, review, host, physicalSerial) {
  onlyKeys(proof,['raw','sha256','company_snapshot']);
  const {raw,sha256,company_snapshot:snapshot}=proof;
  invalid(typeof raw==='string' && Buffer.byteLength(raw)<=4096 && raw.endsWith('\n') && sha(raw)===sha256);
  let records;
  try { records=raw.slice(0,-1).split('\n').map(line=>JSON.parse(line)); } catch { invalid(false); }
  invalid(records.length===3);
  const [failed,...revoked]=records;
  onlyKeys(failed,['operation','code','controller_exit_code','at','diagnostic']);
  onlyKeys(failed.diagnostic,['stdout','stderr']);
  const {stdout,stderr}=failed.diagnostic;
  invalid(failed.operation==='phone' && failed.code==='STANDALONE_NATIVE_COMMAND' && failed.controller_exit_code===124
    && typeof stdout==='string' && stdout.split(/\r?\n/).includes('serial='+physicalSerial)
    && stdout.split(/\r?\n/).includes('call_state=idle')
    && typeof stderr==='string' && stderr.split(/\r?\n/).includes('NATIVE_INNER_EXECUTION_TERMINATION_UNKNOWN')
    && stderr.split(/\r?\n/).includes('guarded command timeout: whole command and children terminated; owner lock retained'));
  for (const [index,row] of revoked.entries()) {
    onlyKeys(row,['operation','code','at']);
    invalid(row.operation===['phone','inspect'][index] && row.code==='STANDALONE_NATIVE_HOST_REVOKED');
  }
  let previous=Date.parse(review.revocation.observed_at);
  for (const row of records) {
    const at=Date.parse(row.at);
    invalid(validTime(row.at) && at>=previous && at<=Date.parse(review.observed_at));
    previous=at;
  }
  onlyKeys(snapshot,['company_id','tenant_id','version','line_key','run_id','count']);
  invalid(uuid.test(snapshot.company_id??'') && uuid.test(snapshot.tenant_id??'') && Number.isSafeInteger(snapshot.version)
    && snapshot.version>0 && typeof snapshot.line_key==='string' && /^[a-z0-9_-]{1,100}$/.test(snapshot.line_key)
    && snapshot.run_id===host.run_id && snapshot.count===1);
  return {sha256,snapshot};
}

export function verifyDesktopCleanupProof(review, host) {
  const artifact = review.cleanup_diagnostic;
  const preflight=review.admission_code===preflightTimeout;
  invalid((preflight || review.admission_code === desktopUnknown) && review.hardware_diagnostic === undefined);
  onlyKeys(artifact,['raw','sha256','adb_endpoint','adb_serial','central_lease_version','desktop_readback','terminal_ack_ledger','preflight_timeout']);
  const { raw, sha256, adb_endpoint: endpoint, adb_serial: serial, central_lease_version: version, desktop_readback: desktop,
    terminal_ack_ledger:ledger,preflight_timeout:controller } = artifact;
  invalid(preflight ? ledger!==undefined && controller!==undefined : controller===undefined);
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
  const ledgerSha256=allReturned ? undefined : verifyTerminalAckLedger(ledger,seal.leaves,target,preflight);
  const preflightProof=preflight ? verifyPreflightTimeout(controller,review,host,desktop.serial) : undefined;
  return { sha256, ledgerSha256, preflightProof, firstIntentAt: seal.leaves[0].intent_at, serial: desktop.serial, leaseVersion: version };
}
