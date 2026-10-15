/** MMV既有DB连接/原生证据验证器的只读调用；不传输凭据和评论原文。 */
export function verifyBatchRows(plan,rows,snapshot,validateEvidence,hash,route) {
  if(snapshot?.company_id!==plan.company_id||snapshot.config_status!=='enabled'||snapshot.runtime_config?.routing?.line_key!==route.key)throw Error('COMPANY_SOURCE_MISMATCH');
  if(plan.machine!=='mmv'){
    const accounts=snapshot.runtime_config?.platform_accounts||[];
    if(!accounts.some(a=>a.enabled&&a.verification_status==='verified'&&a.profile===plan.profile&&a.device_serial===plan.serial))throw Error('COMPANY_ACCOUNT_MISMATCH');
  }
  if(plan.workflow_key!=='douyin_comment_scoring')return {company_id:plan.company_id,line_key:route.key,eligible:1};
  if(!plan.env.LEADGEN_SOURCE_RUN)throw Error('SOURCE_REQUIRED');
  for(const row of rows){
    if(row.harvest_batch!==plan.env.LEADGEN_SOURCE_RUN||row.line_key!==route.key||!row.douyin_id||!/^https:\/\/(www\.)?douyin\.com\/user\/[^/?#]+$/.test(row.profile_url||''))throw Error('NATIVE_IDENTITY_REQUIRED');
    validateEvidence(row.recipient_evidence,{line_key:route.key,run:plan.env.LEADGEN_SOURCE_RUN,douyin_id:row.douyin_id,nickname:row.nickname,
      comment_body_sha256:hash(row.comment_body),comment_body:row.comment_body,video_url:row.source_video_url});
  }
  return {company_id:plan.company_id,line_key:route.key,source_run:plan.env.LEADGEN_SOURCE_RUN,eligible:rows.length};
}
export function buildLeadgenBatchProbe(plan){
  const input=`const path=require('node:path');const root=path.join(process.env.HOME,'bin-harvest');
const {getPool}=require(path.join(root,'leadgen-db-connect.js'));
const {routeOf}=require(path.join(root,'line-routes.js'));
const {validateEvidence,hash}=require(path.join(root,'queued-recipient-evidence.js'));
const verify=${verifyBatchRows.toString()};const plan=${JSON.stringify(plan)};
(async()=>{const pool=getPool(),c=await pool.connect();try{
 await c.query('BEGIN READ ONLY');await c.query("SET LOCAL statement_timeout='20s'");
 const route=routeOf(plan.line),source=plan.env.LEADGEN_SOURCE_RUN;
 let snapshot;
 if(source)snapshot=(await c.query('SELECT snapshot FROM zenithjoy.company_config_runs WHERE company_id=$1 AND run_id=$2',[plan.company_id,source])).rows[0]?.snapshot;
 else snapshot=(await c.query('SELECT v.snapshot FROM zenithjoy.tenant_company_profiles p JOIN zenithjoy.company_config_versions v ON v.company_id=p.company_id AND v.version=p.config_version AND v.tenant_id=p.tenant_id WHERE p.company_id=$1 AND p.config_status=$2',[plan.company_id,'enabled'])).rows[0]?.snapshot;
 const rows=plan.workflow_key==='douyin_comment_scoring'?(await c.query("SELECT * FROM zenithjoy.leadgen_comments WHERE line_key=$1 AND harvest_batch=$2 AND process_status='待分拣' AND relevance IS NULL ORDER BY collected_at LIMIT $3",[route.key,source,Number(plan.env.LEADGEN_LIMIT)])).rows:[];
 const result=verify(plan,rows,snapshot,validateEvidence,hash,route);await c.query('ROLLBACK');console.log(JSON.stringify(result));
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await pool.end();}})().catch(()=>{console.error('LEADGEN_COMPANY_OR_BATCH_PROOF_REJECTED');process.exitCode=1;});`;
  return {remote:'bash -lc \'set -a; source "$HOME/.credentials/zenithjoy-db.env"; set +a; export NODE_PATH="$HOME/.openclaw/leadgen-scripts/node_modules:$HOME/.openclaw/node_modules"; node -\'',input};
}
