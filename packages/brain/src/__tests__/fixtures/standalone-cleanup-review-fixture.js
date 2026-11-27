import { createHash } from 'node:crypto';

export async function prepareDesktopCleanupReview(f, pool, serial) {
  const now = new Date();
  const readOnly = [['version'],['version'],['-H','127.0.0.1','-P','5045','-s','127.0.0.1:15555','get-state']];
  const makeLeaf = (args,index) => {
    const at = +now + index;
    return {sequence:index+1,argv_sha256:createHash('sha256').update(JSON.stringify(args)).digest('hex'),
      intent_at:at,started_at:at,ended_at:at,boundary:'darwin-sandbox-deny-process-fork-v1',pid:40+index,
      code:0,signal:null,tainted:false,dump_crash_returned:false,request_returned:true};
  };
  const cleanup = {task_id:f.task.id,run_id:f.job.run_id,execution_mode:'codex-direct',
    native_return_unknown:true,quarantine_verified:true,local_released:false,central_released:false,desktop:null,
    leaves:{complete:true,empty_complete:false,requests_returned:true,empty_requests_returned:false,epoch_fence_lost:false,
      ledger:f.body.review.host_proof.run_directory+'/standalone-leaves/collection-leaves-abc123.jsonl',
      leaves:readOnly.map(makeLeaf)}};
  const readLock = async () => (await pool.query("SELECT device_name,locked_by,xmin::text AS version FROM device_locks WHERE device_name=$1",[serial])).rows[0];
  const lock = await readLock();
  // Fixture can freeze all observations at one instant. Production requires the original leaves before revocation.
  const cutoff = new Date(+now + readOnly.length).toISOString();
  const touched = await pool.query('UPDATE tasks SET blocked_at=$2 WHERE id=$1 RETURNING blocked_at',[f.task.id,cutoff]);
  Object.assign(f.body,{blocked_at:touched.rows[0].blocked_at.toISOString()});
  Object.assign(f.body.review,{protocol:'standalone-pre-native-cleanup-review/v1',admission_code:'DESKTOP_UNKNOWN',
    observed_at:cutoff,revocation:{...f.body.review.revocation,reason:'DESKTOP_UNKNOWN',observed_at:cutoff}});
  const seal = raw => ({raw,sha256:createHash('sha256').update(raw).digest('hex')});
  f.body.review.cleanup_diagnostic = {
    ...seal(JSON.stringify(cleanup)),adb_endpoint:'tcp:127.0.0.1:5045',adb_serial:'127.0.0.1:15555',central_lease_version:lock.version,
    desktop_readback:{serial,default_home:'com.android.launcher3/.Launcher',focused_activity:'com.android.launcher3/com.android.launcher3.Launcher',observed_at:cutoff},
  };
  return {...f,readLock,cleanup,seal};
}

export function prepareCollectionOpenAppTimeoutReview(f, { uiProfile, accountRead = false } = {}) {
  const { review } = f.body;
  review.protocol = accountRead ? 'standalone-102-account-read-timeout-review/v1' : 'standalone-102-open-app-timeout-review/v1';
  review.admission_code = review.revocation.reason = 'TOOL_RESULT_UNKNOWN';
  const target = ['-H','127.0.0.1','-P','5045','-s','127.0.0.1:15555'];
  const version = ['version'];
  const foreground = [...target,'shell','dumpsys','window','displays'];
  const launch = [...target,'shell','monkey','-p','com.ss.android.ugc.aweme','-c','android.intent.category.LAUNCHER','1'];
  const commands = [version,version,[...target,'get-state'],version,[...target,'shell','getprop','ro.product.model'],
    version,launch,version,foreground,version,foreground,version];
  if (uiProfile) {
    const ui = '/sdcard/douyin-leadgen-ui-'+uiProfile+'.xml';
    const remove = [...target,'shell','rm','-f',ui];
    const dump = [...target,'shell','uiautomator','dump','--compressed',ui];
    const stat = [...target,'shell','stat','-c','%s',ui];
    if (accountRead) {
      commands.splice(9);
      commands.push(version,version,[...target,'get-state'],version,[...target,'shell','getprop','ro.product.model'],
        version,foreground,version,foreground,version,remove,version,dump,version,stat,version,remove,version,dump,version,stat);
    } else commands.push(remove,version,dump,version,stat,version,remove,version,dump);
    Object.assign(f.cleanup.leaves,{complete:false,requests_returned:false});
  }
  const fields = f.cleanup.leaves.leaves[0];
  const leaves = commands.map((argv,index)=>({...fields,sequence:index+1,pid:fields.pid+index,
    argv_sha256:createHash('sha256').update(JSON.stringify(argv)).digest('hex'),code:uiProfile&&(accountRead?[23,29]:[16]).includes(index)?1:0}));
  f.cleanup.leaves.leaves = leaves;
  const rawLines = rows => rows.map(row=>JSON.stringify(row)).join('\n')+'\n';
  const ledger = leaves.flatMap(leaf=>{
    const {sequence,argv_sha256,intent_at,boundary,pid,started_at} = leaf;
    const intent = {sequence,argv_sha256,intent_at,boundary};
    return [{...intent,phase:'intent'},{...intent,pid,started_at,phase:'started'},{...leaf,phase:'exit'}];
  });
  if (uiProfile) ledger.push({...leaves.at(-1),phase:'unknown'});
  Object.assign(review.cleanup_diagnostic,f.seal(JSON.stringify(f.cleanup)),{
    [accountRead?'account_read_timeout':'open_app_timeout']:{
      ...f.seal(rawLines([
        ...(accountRead?[{operation:'business',code:'STANDALONE_COLLECTION_ACCOUNT_REQUIRED',at:review.observed_at}]:[]),
        {operation:'phone',code:'STANDALONE_NATIVE_COMMAND',controller_exit_code:124,at:review.observed_at,
          diagnostic:{stdout:'',stderr:[
            ...(!accountRead?['args: [-p, com.ss.android.ugc.aweme, -c, android.intent.category.LAUNCHER, 1]',
            ' arg: "-p"',' arg: "com.ss.android.ugc.aweme"',' arg: "-c"',' arg: "android.intent.category.LAUNCHER"',' arg: "1"',
            'data="com.ss.android.ugc.aweme"','data="android.intent.category.LAUNCHER"']:[]),
            'NATIVE_INNER_EXECUTION_TERMINATION_UNKNOWN','lock=preserved owner='+f.job.run_id,
            'guarded command timeout: whole command and children terminated; owner lock retained','',
          ].join('\n')}},
        {operation:'inspect',code:'STANDALONE_NATIVE_HOST_REVOKED',at:review.observed_at},
      ])),
      leaf_ledger:f.seal(rawLines(ledger)),
      ...(uiProfile ? { ui_profile: uiProfile } : {}),
    },
  });
  return f;
}
