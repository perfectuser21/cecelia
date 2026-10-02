/** 定义与工作流关系在同一事务中落库。唯一冲突必须回滚并向上抛出。 */
import { contractPath } from './activity-contract-loader.js';
export async function storeActivityContracts(pool, plans, head, repo) {
  const out = {head_sha:head,updated:[],inserted:[],deprecated:[],unmapped:[]};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['shared-activity-contracts']);
    const rows = (await client.query(`SELECT id,journey_id,capability_key,activity_key,contract_sha256,status FROM journey_steps
      WHERE capability_key IS NOT NULL AND activity_key IS NOT NULL FOR UPDATE`)).rows;
    const definitions = new Map();
    for (const plan of plans) for (const item of plan.activities) {
      const { activity:a,sha256 } = item, key = `${a.from}.${a.key}`;
      if (definitions.has(key)) continue;
      const matches = rows.filter(r=>r.capability_key===a.from && r.activity_key===a.key);
      if (matches.length > 1) throw new Error(`活动定义不唯一: ${key}`);
      const owner = plans.find(p=>p.workflow.source_capability===a.from)?.workflow;
      if (!owner) throw new Error(`活动定义缺少已登记来源工作流: ${a.from}`);
      const {from,...contract} = a;
      const source = `https://github.com/${repo}/blob/${head}/${contractPath(from)}`;
      let row = matches[0];
      if (row) {
        if (row.contract_sha256 !== sha256 || row.status === 'deprecated') {
          await client.query(`UPDATE journey_steps SET name=$2,contract=$3::jsonb,contract_sha256=$4,contract_source=$5,
            status=CASE WHEN status='deprecated' THEN 'planned' ELSE status END,updated_at=NOW() WHERE id=$1`,
          [row.id,a.name,JSON.stringify(contract),sha256,source]);
          out.updated.push(key);
        }
      } else {
        row = (await client.query(`INSERT INTO journey_steps(journey_id,name,step_number,capability_key,activity_key,contract,contract_sha256,contract_source,status,backbone_version)
          VALUES($1,$2,CASE WHEN EXISTS(SELECT 1 FROM journey_steps WHERE journey_id=$1 AND step_number=$3)
            THEN (SELECT COALESCE(max(step_number),0)+1 FROM journey_steps WHERE journey_id=$1) ELSE $3 END,
            $4,$5,$6::jsonb,$7,$8,'planned','3.0') RETURNING id`,
        [owner.capability_id,a.name,a.order,from,a.key,JSON.stringify(contract),sha256,source])).rows[0];
        if (!row) throw new Error(`活动插入未返回身份: ${key}`);
        out.inserted.push(key);
      }
      definitions.set(key,row.id);
    }
    for (const {workflow:w,activities} of plans) {
      // 先释放顺序唯一索引，容许交换两个槽位的顺序；保留旧引用历史。
      await client.query('UPDATE workflow_activity_refs SET active=false WHERE workflow_id=$1 AND active',[w.id]);
      for (const {activity:a,source_ref} of activities) {
        await client.query(`INSERT INTO workflow_activity_refs(workflow_id,slot_key,activity_id,sequence_no,source_ref,source_repo,source_path,source_commit,active)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,true) ON CONFLICT(workflow_id,slot_key) DO UPDATE SET
          activity_id=EXCLUDED.activity_id,sequence_no=EXCLUDED.sequence_no,source_ref=EXCLUDED.source_ref,
          source_repo=EXCLUDED.source_repo,source_path=EXCLUDED.source_path,source_commit=EXCLUDED.source_commit,active=true,
          updated_at=CASE WHEN (workflow_activity_refs.activity_id,workflow_activity_refs.sequence_no,workflow_activity_refs.source_ref,workflow_activity_refs.source_commit)
            IS DISTINCT FROM (EXCLUDED.activity_id,EXCLUDED.sequence_no,EXCLUDED.source_ref,EXCLUDED.source_commit) THEN NOW() ELSE workflow_activity_refs.updated_at END`,
        [w.id,a.key,definitions.get(`${a.from}.${a.key}`),a.order,source_ref,repo,w.source_path,head]);
      }
    }
    const ownedCaps = plans.map(p=>p.workflow.source_capability);
    for (const row of rows) {
      const key = `${row.capability_key}.${row.activity_key}`;
      if (ownedCaps.includes(row.capability_key) && !definitions.has(key) && row.status !== 'deprecated') {
        const result = await client.query(`UPDATE journey_steps SET status='deprecated',updated_at=NOW() WHERE id=$1
          AND NOT EXISTS(SELECT 1 FROM workflow_activity_refs WHERE activity_id=$1 AND active) RETURNING id`,[row.id]);
        if (result.rows.length) out.deprecated.push(key);
      }
    }
    await client.query('COMMIT');
    return out;
  } catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
