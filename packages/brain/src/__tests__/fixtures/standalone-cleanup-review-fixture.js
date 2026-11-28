import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

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

export function prepareCollectionOpenAppTimeoutReview(f, { uiProfile, accountRead = false, accountNavigation = false, trailingAttributePadding = 0 } = {}) {
  const { review } = f.body;
  review.protocol = accountRead ? 'standalone-102-account-read-timeout-review/v1' : 'standalone-102-open-app-timeout-review/v1';
  review.admission_code = review.revocation.reason = 'TOOL_RESULT_UNKNOWN';
  const target = ['-H','127.0.0.1','-P','5045','-s','127.0.0.1:15555'];
  const version = ['version'];
  const foreground = [...target,'shell','dumpsys','window','displays'];
  const launch = [...target,'shell','monkey','-p','com.ss.android.ugc.aweme','-c','android.intent.category.LAUNCHER','1'];
  const commands = [version,version,[...target,'get-state'],version,[...target,'shell','getprop','ro.product.model'],
    version,launch,version,foreground,version,foreground,version];
  const hierarchy = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><hierarchy rotation="0"><node bounds="[0,0][720,1280]" text="pass"><node package="com.ss.android.ugc.aweme" enabled="true" content-desc="我，按钮" bounds="[630,1150][660,1190]"' + ' '.repeat(1 + trailingAttributePadding) + '/></node></hierarchy>';
  const evidenceId = f.job.run_id+'-account';
  const ui = '/sdcard/douyin-leadgen-ui-'+uiProfile+'.xml';
  if (uiProfile) {
    const remove = [...target,'shell','rm','-f',ui];
    const dump = [...target,'shell','uiautomator','dump','--compressed',ui];
    const stat = [...target,'shell','stat','-c','%s',ui];
    if (accountNavigation) {
      const state = [...target,'get-state'], model = [...target,'shell','getprop','ro.product.model'];
      const telephony = [...target,'shell','dumpsys','telephony.registry'];
      const pulled = '/private/tmp/openclaw-phone/evidence/'+uiProfile+'/'+evidenceId+'-before.xml';
      commands.splice(9);
      commands.unshift(version,version,state,version,model,version,telephony,version,foreground,version,telephony);
      commands.push(version,version,state,version,model,version,foreground,version,foreground,version,
        remove,version,dump,version,stat,version,[...target,'pull',ui,pulled],
        version,[...target,'shell','input','tap','645','1170'],version,remove,version,dump,version,stat);
    } else if (accountRead) {
      commands.splice(9);
      commands.push(version,version,[...target,'get-state'],version,[...target,'shell','getprop','ro.product.model'],
        version,foreground,version,foreground,version,remove,version,dump,version,stat,version,remove,version,dump,version,stat);
    } else commands.push(remove,version,dump,version,stat,version,remove,version,dump);
    Object.assign(f.cleanup.leaves,{complete:false,requests_returned:false});
  }
  const fields = f.cleanup.leaves.leaves[0];
  const leaves = commands.map((argv,index)=>({...fields,sequence:index+1,pid:fields.pid+index,
    argv_sha256:createHash('sha256').update(JSON.stringify(argv)).digest('hex'),code:uiProfile&&!accountNavigation&&(accountRead?[23,29]:[16]).includes(index)?1:0}));
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
        ...(accountRead&&!accountNavigation?[{operation:'business',code:'STANDALONE_COLLECTION_ACCOUNT_REQUIRED',at:review.observed_at}]:[]),
        {operation:'phone',code:'STANDALONE_NATIVE_COMMAND',controller_exit_code:124,at:review.observed_at,
          diagnostic:{stdout:'',stderr:[
            ...(accountNavigation?[ui+': 1 file pulled, 0 skipped. 0.1 MB/s ('+Buffer.byteLength(hierarchy)+' bytes in 0.505s)']:[]),
            ...(!accountRead?['args: [-p, com.ss.android.ugc.aweme, -c, android.intent.category.LAUNCHER, 1]',
            ' arg: "-p"',' arg: "com.ss.android.ugc.aweme"',' arg: "-c"',' arg: "android.intent.category.LAUNCHER"',' arg: "1"',
            'data="com.ss.android.ugc.aweme"','data="android.intent.category.LAUNCHER"']:[]),
            'NATIVE_INNER_EXECUTION_TERMINATION_UNKNOWN','lock=preserved owner='+f.job.run_id,
            'guarded command timeout: whole command and children terminated; owner lock retained','',
          ].join('\n')}},
        ...(!accountNavigation?[{operation:'inspect',code:'STANDALONE_NATIVE_HOST_REVOKED',at:review.observed_at}]:[]),
      ])),
      leaf_ledger:f.seal(rawLines(ledger)),
      ...(uiProfile ? { ui_profile: uiProfile } : {}),
      ...(accountNavigation ? { account_navigation: { evidence_id:evidenceId, hierarchy:f.seal(hierarchy) } } : {}),
    },
  });
  return f;
}


export function prepareCollectionAccountFallbackDesktopReview(f) {
  const { review } = f.body;
  const profile = 'fixture-cloud';
  const snapshotId = f.job.run_id+'-snapshot';
  const accountId = f.job.run_id+'-account';
  const t = ['-H','127.0.0.1','-P','5045','-s','127.0.0.1:15555'];
  const v = ['version'];
  const xml = '/sdcard/douyin-leadgen-ui-'+profile+'.xml';
  const shot = '/sdcard/douyin-leadgen-shot-'+profile+'.png';
  const location = '/private/tmp/openclaw-phone/evidence/'+profile+'/';
  const state = [...t,'get-state'], model = [...t,'shell','getprop','ro.product.model'];
  const telephony = [...t,'shell','dumpsys','telephony.registry'];
  const window = [...t,'shell','dumpsys','window','displays'];
  const clear = [...t,'shell','rm','-f',xml];
  const dump = [...t,'shell','uiautomator','dump','--compressed',xml];
  const size = [...t,'shell','stat','-c','%s',xml];
  const commands = [
    v,v,state,v,model,v,telephony,v,window,v,telephony,
    v,v,state,v,model,v,[...t,'shell','monkey','-p','com.ss.android.ugc.aweme','-c','android.intent.category.LAUNCHER','1'],v,window,
    v,v,state,v,model,v,window,v,window,v,clear,v,dump,v,size,v,
    [...t,'shell',`if [ ! -e '${xml}' ] && [ ! -L '${xml}' ]; then printf '%s' 'REMOTE_UI_ABSENT_V1'; else exit 1; fi`],
    v,v,state,v,[...t,'shell','screencap','-p',shot],v,[...t,'pull',shot,location+snapshotId+'.png'],
    v,v,state,v,window,v,[...t,'shell','input','tap','648','1173'],
    v,v,state,v,model,v,window,v,window,v,clear,v,dump,v,size,v,[...t,'pull',xml,location+accountId+'-before.xml'],
  ];
  const prototype = f.cleanup.leaves.leaves[0];
  const leaves = commands.map((argv,index)=>({...prototype,sequence:index+1,pid:prototype.pid+index,code:index===34?1:0,
    argv_sha256:createHash('sha256').update(JSON.stringify(argv)).digest('hex')}));
  const ledger = leaves.flatMap(leaf=>{
    const {sequence,argv_sha256,intent_at,boundary,pid,started_at}=leaf;
    const intent={sequence,argv_sha256,intent_at,boundary};
    return [{...intent,phase:'intent'},{...intent,pid,started_at,phase:'started'},{...leaf,phase:'exit'}];
  });
  Object.assign(f.cleanup.leaves,{complete:false,leaves});
  review.protocol = 'standalone-collection-account-fallback-cleanup/v1';
  Object.assign(review.cleanup_diagnostic,f.seal(JSON.stringify(f.cleanup)),{
    terminal_ack_ledger:f.seal(ledger.map(x=>JSON.stringify(x)).join('\n')+'\n'),
    account_fallback:{profile,snapshot_id:snapshotId,account_id:accountId,screen:[720,1280],tap:[648,1173]},
  });
  return f;
}

export function prepareCollectionReviewVideoTimeout(f, recoveredAccount = false, linkAfterOpen = false) {
  const {review} = f.body, profile = 'fixture-cloud', videoId = '1234567890123456789';
  const accountId = f.job.run_id+'-account';
  const t = ['-H','127.0.0.1','-P','5045','-s','127.0.0.1:15555'];
  const v = ['version'], send = (...args) => [...t,'shell',...args];
  const state = [...t,'get-state'], model = send('getprop','ro.product.model');
  const call = send('dumpsys','telephony.registry'), window = send('dumpsys','window','displays');
  const ui = '/sdcard/douyin-leadgen-ui-'+profile+'.xml';
  const remove = send('rm','-f',ui), dump = send('uiautomator','dump','--compressed',ui), size = send('stat','-c','%s',ui);
  const native = [
    v,v,state,v,model,v,call,v,window,v,call,
    v,v,state,v,model,v,send('monkey','-p','com.ss.android.ugc.aweme','-c','android.intent.category.LAUNCHER','1'),v,window,
    v,v,state,v,model,v,window,v,window,v,remove,v,dump,v,size,v,
    [...t,'pull',ui,'/private/tmp/openclaw-phone/evidence/'+profile+'/'+accountId+'-before.xml'],
    v,v,state,v,model,v,send('am','start','-a','android.intent.action.VIEW','-d','snssdk1128://aweme/detail/'+videoId),
    v,window,v,send('input','keyevent','127'),v,window,v,window,v,send('input','keyevent','127'),v,window,v,remove,v,dump,v,size,
  ];
  const mediaDirectory = '/private/tmp/openclaw-phone/evidence/'+profile+'/';
  const navigation = {snapshot_id:f.job.run_id+'-shot',
    back_id:f.job.run_id+'-returned',open_evidence_id:f.job.run_id+'-video-open',screen:[720,1280],tap:[648,1173]};
  const failures = linkAfterOpen ? [35,125,131,137] : recoveredAccount ? [35,106] : [native.length];
  if (recoveredAccount) {
    const route = [v,v,state,v], identify = [...route,model,v];
    const absent = send(`if [ ! -e '${ui}' ] && [ ! -L '${ui}' ]; then printf '%s' 'REMOTE_UI_ABSENT_V1'; else exit 1; fi`);
    const shotPath = '/sdcard/douyin-leadgen-shot-'+profile+'.png';
    const shot = send('screencap','-p',shotPath);
    const pullImage = id => [...t,'pull',shotPath,mediaDirectory+id+'.png'];
    const account = [...identify,window,v,window,v,remove,v,dump,v,size,v,[...t,'pull',ui,mediaDirectory+accountId+'-before.xml']];
    native.splice(35,2,v,absent,
      ...route,shot,v,pullImage(navigation.snapshot_id),
      ...route,window,v,send('input','keyevent','4'),v,window,v,shot,v,pullImage(navigation.back_id),
      ...route,window,v,send('input','tap',...navigation.tap.map(String)),...account);
    if (linkAfterOpen) {
      native.splice(81);
      native.push(...identify,send('am','start','-a','android.intent.action.VIEW','-d','snssdk1128://aweme/detail/'+videoId),
        v,window,v,window,v,send('input','keyevent','127'),v,window,v,remove,v,dump,v,size,v,
        [...t,'pull',ui,mediaDirectory+navigation.open_evidence_id+'-openvideo-w1.xml'],
        v,window,v,[...t,'exec-out','screencap','-p'],v,window,
        ...identify,window,v,send('input','keyevent','127'),v,
        remove,v,dump,v,size,v,remove,v,dump,v,size,v,remove,v,dump,v,size,v,send('input','keyevent','85'),v);
    } else native.push(v,absent,v,send('input','keyevent','85'),v,remove,v,dump);
  }
  const prototype = f.cleanup.leaves.leaves[0];
  const leaves = native.map((argv,index)=>({...prototype,sequence:index+1,pid:prototype.pid+index,code:failures.includes(index+1)?1:0,
    argv_sha256:createHash('sha256').update(JSON.stringify(argv)).digest('hex')}));
  const ledger = leaves.flatMap(leaf=>{
    const {sequence,argv_sha256,intent_at,boundary,pid,started_at}=leaf;
    const intent={sequence,argv_sha256,intent_at,boundary};
    return [{...intent,phase:'intent'},{...intent,pid,started_at,phase:'started'},{...leaf,phase:'exit'}];
  });
  ledger.push(linkAfterOpen ? {phase:'unknown'} : {...leaves.at(-1),phase:'unknown'});
  Object.assign(f.cleanup.leaves,{complete:false,requests_returned:false,leaves});
  const at = review.observed_at;
  Object.assign(review,{protocol:'standalone-collection-review-video-timeout/v1',admission_code:'TOOL_RESULT_UNKNOWN'});
  review.revocation.reason = review.admission_code;
  const controller = [
    {operation:'business',code:'STANDALONE_COLLECTION_ACCOUNT_REQUIRED',at},
    {operation:'phone',code:'STANDALONE_NATIVE_COMMAND',controller_exit_code:124,at,diagnostic:{stdout:'',stderr:[
      'NATIVE_INNER_EXECUTION_TERMINATION_UNKNOWN','lock=preserved owner='+f.job.run_id,
      'guarded command timeout: whole command and children terminated; owner lock retained','',
    ].join('\n')}},
    {operation:'inspect',code:'STANDALONE_NATIVE_HOST_REVOKED',at},
  ];
  if (recoveredAccount) {
    controller.shift();
    if (linkAfterOpen) controller[1].operation='native-readback';
    else controller[0].diagnostic.stderr=`paused-idle: phase=paused-douyin evidence_id=${navigation.open_evidence_id}-gate-fg1 attempt=1 dump_rc=0 elapsed_ms=58766; could not get idle state; no fresh XML; using single toggle-dump-toggle\n`
      +controller[0].diagnostic.stderr;
  }
  const jsonl = rows => rows.map(x=>JSON.stringify(x)).join('\n')+'\n';
  const ledgerProof = f.seal(jsonl(ledger));
  Object.assign(review.cleanup_diagnostic,f.seal(JSON.stringify(f.cleanup)),{
    collection_review_video:{...f.seal(jsonl(controller)),profile,account_evidence_id:accountId,video_id:videoId,
      ...(recoveredAccount?{account_recovery:navigation}:{}),...(linkAfterOpen?{link_after_open:true}:{}),leaf_ledger:recoveredAccount
        ? {gzip_base64:gzipSync(ledgerProof.raw).toString('base64'),sha256:ledgerProof.sha256} : ledgerProof},
  });
  return f;
}
