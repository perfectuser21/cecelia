/** 历史读取只读不可变快照；当前可变定义不参与历史重建。 */
export async function readDefinitionHistory(pool,{kind,id,versionId}) {
  if(!['activity','workflow'].includes(kind)) throw Error('定义类型无效');
  const table=kind==='activity'?'activity_definition_versions':'workflow_definition_versions';
  const object=kind==='activity'?'activities':'workflows';
  const column=kind==='activity'?'activity_id':'workflow_id';
  const result=await pool.query(`SELECT o.id,COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.created_at,v.id) FROM ${table} v
    WHERE v.${column}=o.id ${versionId?'AND v.id=$2':''}),'[]'::jsonb) AS versions FROM ${object} o WHERE o.id=$1`,versionId?[id,versionId]:[id]);
  if(!result.rows.length) return undefined;
  return versionId?result.rows[0].versions[0]:result.rows[0].versions;
}
