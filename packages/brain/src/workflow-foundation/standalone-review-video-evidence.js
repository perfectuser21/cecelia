import { UUID, requireFoundation } from './contracts.js';

export const collectionReviewVideo = 'standalone-collection-review-video-timeout/v1';

export function collectionReviewVideoCommands({profile,account_evidence_id:accountId,video_id:videoId}, runId, target) {
  requireFoundation(typeof profile==='string' && /^[A-Za-z0-9_-]{1,80}$/.test(profile)
    && typeof accountId==='string' && accountId.startsWith(runId+'-') && /^[A-Za-z0-9_-]{1,120}$/.test(accountId)
    && typeof videoId==='string' && /^[0-9]{16,24}$/.test(videoId), 'standalone_start_review_invalid', 400);
  const version = ['version'];
  const shell = (...args) => [...target,'shell',...args];
  const state = [...target,'get-state'];
  const calls = shell('dumpsys','telephony.registry');
  const window = shell('dumpsys','window','displays');
  const launch = shell('monkey','-p','com.ss.android.ugc.aweme','-c','android.intent.category.LAUNCHER','1');
  const route = [version,version,state,version,shell('getprop','ro.product.model'),version];
  const xml = '/sdcard/douyin-leadgen-ui-'+profile+'.xml';
  const capture = [shell('rm','-f',xml),version,shell('uiautomator','dump','--compressed',xml),version,shell('stat','-c','%s',xml)];
  const proofPath = '/private/tmp/openclaw-phone/evidence/'+profile+'/'+accountId+'-before.xml';
  const open = shell('am','start','-a','android.intent.action.VIEW','-d','snssdk1128://aweme/detail/'+videoId);
  const pause = shell('input','keyevent','127');
  // The last XML size request returned but the native parent lost its acknowledgement.
  return [
    ...route,calls,version,window,version,calls,
    ...route,launch,version,window,
    ...route,window,version,window,version,...capture,version,[...target,'pull',xml,proofPath],
    ...route,open,version,window,version,pause,version,window,version,window,version,pause,version,window,version,...capture,
  ];
}

export async function verifyCollectionReviewVideoOrigin(db, scope, videoId) {
  const {source_run:sourceRun, company, line} = scope;
  const conflict = 'standalone_start_review_video_origin_conflict';
  requireFoundation(UUID.test(sourceRun ?? ''), conflict);
  const {rows} = await db.query(`SELECT t.id, t.result->'foundation_result' AS result
    FROM task_runs r JOIN tasks t ON t.id=r.task_id
    WHERE r.run_id=$1 AND r.status IN ('success','completed','succeeded') AND r.ended_at IS NOT NULL
      AND t.status='completed' AND t.payload->>'workflow_key'='douyin_video_discovery'
    FOR SHARE OF r,t`,[sourceRun]);
  const producer = rows[0], result = producer?.result;
  requireFoundation(rows.length===1 && result?.task_id===producer.id && result.run_id===sourceRun
    && result.status==='completed' && result.business_pass===true && Array.isArray(result.receipts), conflict);
  const receipts = result.receipts.filter(item=>item?.activity_key==='collect_videos' && item.status==='completed');
  requireFoundation(receipts.length===1 && Array.isArray(receipts[0].outputs?.Video), conflict);
  const videos = receipts[0].outputs.Video.filter(item=>item?.video_id===videoId);
  const video = videos[0], metrics = video?.discovery_metrics, binding = metrics?.company_binding;
  requireFoundation(videos.length===1 && video.video_url==='https://www.douyin.com/video/'+videoId && video.line_key===line
    && typeof video.author==='string' && video.author.trim().length>0 && video.author.length<=500
    && /^[a-f0-9]{64}$/.test(metrics?.digest??'') && binding?.line_key===line && binding.run_id===sourceRun
    && ['company_id','tenant_id','version'].every(key=>binding[key]===company[key]), conflict);
}
