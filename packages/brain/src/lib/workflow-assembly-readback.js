/** 只接受数据库已有的不可变版本；按槽位固定，绝不改共享真身或其他消费者。 */
import {stepSha256} from '../../scripts/sync-steps-from-workspace.mjs';
export async function assertPinnedReference(client,workflowId,slot,version){
 const row=(await client.query('SELECT * FROM activity_definition_versions WHERE id=$1 AND activity_id=$2 FOR SHARE',[version.id,version.activity_id])).rows[0];
 if(!row||stepSha256(row)!==stepSha256(version))throw Error('共享固定版本在核验后变化');
 const refs=(await client.query('SELECT activity_id,activity_definition_version_id FROM workflow_activity_refs WHERE workflow_id=$1 AND slot_key=$2 AND active',[workflowId,slot])).rows;
 if(refs.length!==1||refs[0].activity_id!==row.activity_id||refs[0].activity_definition_version_id!==row.id)throw Error('共享固定引用不一致');
 const build=(await client.query('SELECT activity_version_id FROM activity_version_builds WHERE build_id=$1 AND activity_id=$2',[row.id,row.activity_id])).rows[0];
 if(!build)throw Error('共享固定版本缺少构建映射');
}
export async function verifyAssemblyReadback(client,workflowId,expected){
 const refs=(await client.query(`SELECT r.slot_key,r.activity_id,r.activity_definition_version_id,b.activity_version_id FROM workflow_activity_refs r
 LEFT JOIN activity_version_builds b ON b.build_id=r.activity_definition_version_id AND b.activity_id=r.activity_id
 WHERE r.workflow_id=$1 AND r.active ORDER BY r.sequence_no`,[workflowId])).rows;
 const recipe=(await client.query('SELECT recipe FROM workflow_production_recipes WHERE workflow_id=$1 ORDER BY id DESC LIMIT 1',[workflowId])).rows[0]?.recipe;
 if(!Array.isArray(recipe)||refs.length!==expected.length||recipe.length!==expected.length)throw Error('装配配方或引用缺失');
 for(const e of expected){
  const r=refs.find(r=>r.slot_key===e.slot_key),p=recipe.find(p=>p.slot_key===e.slot_key);
  if(!r||!p||r.activity_id!==e.activity_id||r.activity_definition_version_id!==e.activity_version_id||!r.activity_version_id||p.activity_id!==e.activity_id||p.activity_version_id!==r.activity_version_id)throw Error('装配构建/固定引用/配方回读不一致');
 }
}
