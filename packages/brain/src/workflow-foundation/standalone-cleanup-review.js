import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { onlyKeys, requireFoundation } from './contracts.js';

export const desktopCleanupFailure = 'standalone_cleanup_unconfirmed';
export const desktopUnknown = 'DESKTOP_UNKNOWN';
export const collectionOpenAppReview = 'standalone-102-open-app-timeout-review/v1';
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

function readJsonl({raw,sha256}, maxBytes) {
  invalid(typeof raw==='string' && Buffer.byteLength(raw)<=maxBytes && raw.endsWith('\n') && sha(raw)===sha256);
  try { return raw.slice(0,-1).split('\n').map(line=>JSON.parse(line)); } catch { invalid(false); }
}

function verifyLeafLedger(ledger, leaves, commands, terminalAckMissing) {
  onlyKeys(ledger,['raw','sha256']);
  invalid(leaves.length===commands.length && commands.every((argv,index)=>sha(JSON.stringify(argv))===leaves[index].argv_sha256));
  const records=readJsonl(ledger,terminalAckMissing?12288:24576);
  const expected=leaves.flatMap(leaf=>{
    const {sequence,argv_sha256,intent_at,boundary,pid,started_at}=leaf;
    const intent={sequence,argv_sha256,intent_at,boundary};
    return [{...intent,phase:'intent'},{...intent,pid,started_at,phase:'started'},{...leaf,phase:'exit'}];
  });
  // Only the final local version probe lost its response handshake.
  if(terminalAckMissing)expected.push({...leaves.at(-1),phase:'unknown'});
  invalid(isDeepStrictEqual(records,expected));
  return ledger.sha256;
}

function controllerFailure(failed, exitCode) {
  onlyKeys(failed,['operation','code','controller_exit_code','at','diagnostic']);
  onlyKeys(failed.diagnostic,['stdout','stderr']);
  const {stdout,stderr}=failed.diagnostic;
  invalid(failed.operation==='phone' && failed.code==='STANDALONE_NATIVE_COMMAND' && failed.controller_exit_code===exitCode
    && typeof stdout==='string' && typeof stderr==='string');
  return {stdout,stderr};
}

function verifyControllerRevocation(records, expectedOperations, review) {
  for (const [index,row] of records.slice(1).entries()) {
    onlyKeys(row,['operation','code','at']);
    invalid(row.operation===expectedOperations[index] && row.code==='STANDALONE_NATIVE_HOST_REVOKED');
  }
  let previous=Date.parse(review.revocation.observed_at);
  for (const row of records) {
    const at=Date.parse(row.at);
    invalid(validTime(row.at) && at>=previous && at<=Date.parse(review.observed_at));
    previous=at;
  }
}

function verifyCompanySnapshot(snapshot, host) {
  onlyKeys(snapshot,['company_id','tenant_id','version','line_key','run_id','count']);
  invalid(uuid.test(snapshot.company_id??'') && uuid.test(snapshot.tenant_id??'') && Number.isSafeInteger(snapshot.version)
    && snapshot.version>0 && typeof snapshot.line_key==='string' && /^[a-z0-9_-]{1,100}$/.test(snapshot.line_key)
    && snapshot.run_id===host.run_id && snapshot.count===1);
  return snapshot;
}

function verifyPreflightTimeout(proof, review, host, physicalSerial) {
  onlyKeys(proof,['raw','sha256','company_snapshot']);
  const records=readJsonl(proof,4096);
  invalid(records.length===3);
  const {stdout,stderr}=controllerFailure(records[0],124);
  invalid(stdout.split(/\r?\n/).includes('serial='+physicalSerial) && stdout.split(/\r?\n/).includes('call_state=idle')
    && stderr.split(/\r?\n/).includes('NATIVE_INNER_EXECUTION_TERMINATION_UNKNOWN')
    && stderr.split(/\r?\n/).includes('guarded command timeout: whole command and children terminated; owner lock retained'));
  verifyControllerRevocation(records,['phone','inspect'],review);
  return {sha256:proof.sha256,snapshot:verifyCompanySnapshot(proof.company_snapshot,host)};
}

function verifyAccountForegroundRefusal(proof, review, host) {
  onlyKeys(proof,['raw','sha256','company_snapshot','leaf_ledger']);
  const records=readJsonl(proof,4096);
  invalid(records.length===2);
  const {stdout,stderr}=controllerFailure(records[0],2);
  invalid(stdout==='' && stderr==='standalone account entry is not in Douyin foreground; navigation refused\n');
  verifyControllerRevocation(records,['inspect'],review);
  return {sha256:proof.sha256,snapshot:verifyCompanySnapshot(proof.company_snapshot,host)};
}

function verifyCollectionOpenAppTimeout(proof, review, host, target, leaves) {
  onlyKeys(proof,['raw','sha256','leaf_ledger']);
  const records = readJsonl(proof,4096);
  invalid(records.length === 2);
  const {stdout,stderr} = controllerFailure(records[0],124);
  const diagnostic = [
    'args: [-p, com.ss.android.ugc.aweme, -c, android.intent.category.LAUNCHER, 1]',
    ' arg: "-p"',' arg: "com.ss.android.ugc.aweme"',' arg: "-c"',' arg: "android.intent.category.LAUNCHER"',' arg: "1"',
    'data="com.ss.android.ugc.aweme"','data="android.intent.category.LAUNCHER"',
    'NATIVE_INNER_EXECUTION_TERMINATION_UNKNOWN','lock=preserved owner='+host.run_id,
    'guarded command timeout: whole command and children terminated; owner lock retained','',
  ].join('\n');
  invalid(stdout === '' && stderr === diagnostic);
  verifyControllerRevocation(records,['inspect'],review);
  const version = ['version'];
  const launch = [...target,'shell','monkey','-p','com.ss.android.ugc.aweme','-c','android.intent.category.LAUNCHER','1'];
  const foreground = [...target,'shell','dumpsys','window','displays'];
  const commands = [version,version,[...target,'get-state'],version,[...target,'shell','getprop','ro.product.model'],
    version,launch,version,foreground,version,foreground,version];
  return {sha256:proof.sha256,ledgerSha256:verifyLeafLedger(proof.leaf_ledger,leaves,commands,false)};
}

function verifyReturnedLeaves(leaves, cutoff, acceptedArgv = null) {
  let previousEnd = 0;
  for (const [index,leaf] of leaves.entries()) {
    onlyKeys(leaf,['sequence','argv_sha256','intent_at','boundary','pid','started_at','ended_at','code','signal',
      'tainted','dump_crash_returned','request_returned']);
    invalid(leaf.sequence === index + 1 && (!acceptedArgv || acceptedArgv.has(leaf.argv_sha256))
      && leaf.boundary === 'darwin-sandbox-deny-process-fork-v1' && Number.isSafeInteger(leaf.pid) && leaf.pid > 0
      && [leaf.intent_at,leaf.started_at,leaf.ended_at].every(Number.isSafeInteger)
      && leaf.intent_at >= previousEnd && leaf.started_at >= leaf.intent_at && leaf.ended_at >= leaf.started_at
      && leaf.ended_at <= cutoff && leaf.code === 0 && leaf.signal === null
      && leaf.tainted === false && leaf.dump_crash_returned === false && leaf.request_returned === true);
    previousEnd = leaf.ended_at;
  }
}

export function verifyDesktopCleanupProof(review, host) {
  const artifact = review.cleanup_diagnostic;
  onlyKeys(artifact,['raw','sha256','adb_endpoint','adb_serial','central_lease_version','desktop_readback',
    'terminal_ack_ledger','preflight_timeout','account_foreground_refusal','open_app_timeout']);
  const { raw, sha256, adb_endpoint: endpoint, adb_serial: serial, central_lease_version: version, desktop_readback: desktop,
    terminal_ack_ledger:ledger,preflight_timeout:controller,account_foreground_refusal:account,open_app_timeout:openApp } = artifact;
  const collectionOpenApp = review.protocol === collectionOpenAppReview;
  invalid(collectionOpenApp ? openApp !== undefined && account === undefined && ledger === undefined : openApp === undefined);
  const accountRefused=account!==undefined;
  const preflight=review.admission_code===preflightTimeout && !accountRefused && !collectionOpenApp;
  if (collectionOpenApp) invalid(review.admission_code === preflightTimeout);
  invalid((review.admission_code===preflightTimeout || !accountRefused && review.admission_code===desktopUnknown)
    && review.hardware_diagnostic===undefined);
  invalid(preflight ? ledger!==undefined && controller!==undefined
    : controller===undefined && (!accountRefused || ledger===undefined));
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
    && Array.isArray(seal.leaves) && seal.leaves.length > 0 && seal.leaves.length <= (accountRefused ? 16 : collectionOpenApp ? 12 : 10));

  const target=['-H','127.0.0.1','-P',socket[1],'-s',serial];
  const args = [['version'],[...target,'get-state']];
  const readOnly = new Set(args.map(value=>sha(JSON.stringify(value))));
  verifyReturnedLeaves(seal.leaves, Date.parse(review.revocation.observed_at), allReturned && !accountRefused && !collectionOpenApp ? readOnly : null);
  const versionProbe=['version'];
  const model=[...target,'shell','getprop','ro.product.model'],call=[...target,'shell','dumpsys','telephony.registry'];
  const foregroundProbe=[...target,'shell','dumpsys','window','displays'];
  const startup=[versionProbe,versionProbe,[...target,'get-state'],versionProbe];
  let ledgerSha256,accountProof,openAppProof;
  if (collectionOpenApp) {
    openAppProof = verifyCollectionOpenAppTimeout(openApp,review,host,target,seal.leaves);
    ledgerSha256 = openAppProof.ledgerSha256;
  } else if(accountRefused){
    accountProof=verifyAccountForegroundRefusal(account,review,host);
    const commands=[...startup,model,versionProbe,call,versionProbe,foregroundProbe,...startup,model,versionProbe,foregroundProbe];
    ledgerSha256=verifyLeafLedger(account.leaf_ledger,seal.leaves,commands,false);
  }else if(!allReturned){
    const home=[...target,'shell','cmd','package','resolve-activity','-a','android.intent.action.MAIN','-c','android.intent.category.HOME'];
    const key=[...target,'shell','input','keyevent','3'];
    const commands=[...startup,preflight?model:home,versionProbe,preflight?call:key,versionProbe];
    ledgerSha256=verifyLeafLedger(ledger,seal.leaves,commands,true);
  }
  const preflightProof=preflight ? verifyPreflightTimeout(controller,review,host,desktop.serial) : undefined;
  return { sha256, ledgerSha256, preflightProof, accountProof, openAppProof, firstIntentAt: seal.leaves[0].intent_at, serial: desktop.serial, leaseVersion: version };
}

export function verifyReleasedCleanupProof(review, host, blockedAt) {
  const artifact = review.cleanup_diagnostic;
  onlyKeys(artifact, ['raw','sha256','adb_endpoint','adb_serial','central_lease_version','terminal_ack_ledger']);
  const { raw, sha256, adb_endpoint: endpoint, adb_serial: serial, central_lease_version: leaseVersion,
    terminal_ack_ledger: ledger } = artifact;
  const socket = typeof endpoint === 'string' && endpoint.startsWith('tcp:') && localhost.exec(endpoint.slice(4));
  const transport = typeof serial === 'string' && localhost.exec(serial);
  invalid(review.admission_code === 'CLEANUP_VERIFIED_NO_BUSINESS' && review.hardware_diagnostic === undefined
    && typeof raw === 'string' && Buffer.byteLength(raw) <= 8192 && sha(raw) === sha256
    && socket && Number(socket[1]) <= 65535 && transport && Number(transport[1]) <= 65535
    && typeof leaseVersion === 'string' && /^[0-9]{1,12}$/.test(leaseVersion));

  let original;
  try { original = JSON.parse(raw); } catch { invalid(false); }
  onlyKeys(original, ['task_id','run_id','execution_mode','native_return_unknown','quarantine_verified',
    'local_released','central_released','desktop','leaves']);
  const { leaves: seal, desktop } = original;
  onlyKeys(seal, ['complete','empty_complete','requests_returned','empty_requests_returned','epoch_fence_lost','leaves','ledger']);
  const foreground = typeof desktop === 'string' && /^launcher=([^\n]+)\nforeground_package=\1\nforeground= *mCurrentFocus=Window\{[^\n]* ([^\s}]+)\}\n?$/.exec(desktop);
  const ledgerDirectory = host.run_directory + '/standalone-leaves/';
  invalid(original.task_id === host.task_id && original.run_id === host.run_id
    && original.execution_mode === 'codex-direct' && original.native_return_unknown === false
    && original.quarantine_verified === false && original.local_released === true && original.central_released === true
    && foreground && androidComponent(foreground[2]).package === foreground[1]
    && seal.complete === true && seal.empty_complete === false && seal.requests_returned === true
    && seal.empty_requests_returned === false && seal.epoch_fence_lost === false
    && typeof seal.ledger === 'string' && seal.ledger.startsWith(ledgerDirectory)
    && /^collection-leaves-[a-f0-9]+\.jsonl$/.test(seal.ledger.slice(ledgerDirectory.length))
    && Array.isArray(seal.leaves) && seal.leaves.length === 9);
  verifyReturnedLeaves(seal.leaves, Date.parse(blockedAt));
  const target = ['-H','127.0.0.1','-P',socket[1],'-s',serial], version = ['version'];
  const commands = [version,version,[...target,'get-state'],version,
    [...target,'shell','cmd','package','resolve-activity','-a','android.intent.action.MAIN','-c','android.intent.category.HOME'],
    version,[...target,'shell','input','keyevent','3'],version,[...target,'shell','dumpsys','window','displays']];
  return { sha256, ledgerSha256:verifyLeafLedger(ledger,seal.leaves,commands,false),
    firstIntentAt:seal.leaves[0].intent_at, leaseVersion };
}
