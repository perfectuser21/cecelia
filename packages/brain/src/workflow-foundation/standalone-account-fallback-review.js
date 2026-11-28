import { onlyKeys, requireFoundation } from './contracts.js';

export const collectionAccountFallbackReview = 'standalone-collection-account-fallback-cleanup/v1';

export function collectionAccountFallbackCommands(proof, runId, target) {
  onlyKeys(proof,['profile','snapshot_id','account_id','screen','tap']);
  const {profile,snapshot_id:snapshotId,account_id:accountId,screen,tap}=proof;
  const evidenceId = value => typeof value==='string' && value.startsWith(runId+'-')
    && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(value);
  const pair = values => Array.isArray(values) && values.length===2
    && values.every(value=>Number.isSafeInteger(value) && value>0 && value<=8192);
  requireFoundation(typeof profile==='string' && /^[a-zA-Z0-9_-]{1,80}$/.test(profile)
    && evidenceId(snapshotId) && evidenceId(accountId) && snapshotId!==accountId
    && pair(screen) && pair(tap) && tap[0]*100>=screen[0]*84 && tap[0]*100<=screen[0]*98
    && tap[1]*100>=screen[1]*88 && tap[1]*100<=screen[1]*95, 'standalone_start_review_invalid', 400);
  const version = ['version'];
  const shell = (...args) => [...target,'shell',...args];
  const state = [...target,'get-state'];
  const model = shell('getprop','ro.product.model');
  const calls = shell('dumpsys','telephony.registry');
  const window = shell('dumpsys','window','displays');
  const app = shell('monkey','-p','com.ss.android.ugc.aweme','-c','android.intent.category.LAUNCHER','1');
  const xml = '/sdcard/douyin-leadgen-ui-'+profile+'.xml';
  const image = '/sdcard/douyin-leadgen-shot-'+profile+'.png';
  const directory = '/private/tmp/openclaw-phone/evidence/'+profile+'/';
  // Every controller operation starts with its own route check. Account navigation is one tap only.
  const route = [version,version,state,version];
  const identify = [...route,model,version];
  const entry = [...identify,window,version,window,version,
    shell('rm','-f',xml),version,shell('uiautomator','dump','--compressed',xml),version,shell('stat','-c','%s',xml),version];
  return [
    ...identify,calls,version,window,version,calls,
    ...identify,app,version,window,
    ...entry,shell(`if [ ! -e '${xml}' ] && [ ! -L '${xml}' ]; then printf '%s' 'REMOTE_UI_ABSENT_V1'; else exit 1; fi`),
    ...route,shell('screencap','-p',image),version,[...target,'pull',image,directory+snapshotId+'.png'],
    ...route,window,version,shell('input','tap',...tap.map(String)),
    ...entry,[...target,'pull',xml,directory+accountId+'-before.xml'],
  ];
}
