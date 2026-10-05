/** 公司 KR 现有实现的版本化登记；不创建目标、不改变分析配置。 */
import { loadCompanyKrSource,readCompanyKrFile } from './company-kr-source.js';
import { snapshotDefinitions } from './definition-versions.js';
import { validateImplementationBindings } from './implementation-bindings.js';
import { readFileSync } from 'node:fs';
import { canonicalJson, stepSha256, parseStepDod, syncSteps } from '../../scripts/sync-steps-from-workspace.mjs';
import { attachRunsToWorkflow } from './task-run.js';

export const companyKrSpec = JSON.parse(readFileSync(new URL('../../config/company-kr-workflow.json', import.meta.url), 'utf8'));


export function activityContract(activity, order, spec = companyKrSpec) {
  return { name: activity.name, key: activity.key, order, version: spec.version,
    owner: { department: 'Cecelia', agent: activity.executor === 'agent' ? spec.agent : 'Brain' },
    execution: { location: activity.location, ...(!activity.implementation_bindings&&{via:`packages/brain/src/${activity.implementation}`}) },
    ...(activity.implementation_bindings&&{implementation_bindings:activity.implementation_bindings}),
    invokers: [activity.executor],
    steps: spec.steps.filter(s => s.activity === activity.key).map((s, i) => ({
      order: i + 1, key: s.key, name: s.readback.name, check: s.readback.asserts,
      ...(s.implementation_bindings?{implementation_bindings:s.implementation_bindings}:{implementation:{status:'implemented',ref:s.readback.implementation}}), uses_llm: activity.executor === 'agent',
    })),
    known_gaps: [{ gap: '历史运行没有采集逐步骤 span；登记不补造执行事实', task: '6d03b272-26fa-46ea-a86a-4f4091273197' }],
  };
}

export async function registerCompanyKrWorkflow(pool,sourceOptions={}) {
  const s = sourceOptions.spec || companyKrSpec, source=await loadCompanyKrSource(s,sourceOptions), client = await pool.connect();
  const sourceUrl=`https://github.com/${source.repo}/blob/${source.commit}/${source.path}`;
  const bindingsByActivity=new Map();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['company-kr-registration']);
    const caps = (await client.query(`SELECT id, name, parent_journey_id, area_id FROM journeys
      WHERE id=$1 AND capability_code=$2 AND parent_journey_id IS NOT NULL FOR UPDATE`, [s.capability_id, s.capability_code])).rows;
    if (caps.length !== 1) throw new Error('既有 G5 战略 OKR 能力缺失，拒绝另造能力');
    if (![s.capability_name, '管家 · G5 算力与基础设施调度'].includes(caps[0].name)) throw new Error('G5 名称已被另行修改，拒绝覆盖');
    if (caps[0].area_id && caps[0].area_id !== s.area_id) throw new Error('G5 部门归属冲突');
    await client.query(`UPDATE journeys SET name=$2, area_id=$3, updated_at=NOW(), notion_synced_at=NULL
      WHERE id=$1 AND (name IS DISTINCT FROM $2 OR area_id IS DISTINCT FROM $3)`, [s.capability_id, s.capability_name, s.area_id]);
    const w = (await client.query(`INSERT INTO workflows(capability_id,key,name,channel,form,version,source_repo,source_path,source_capability)
      VALUES($1,$2,$3,'notion','api',$4,$5,$6,$7)
      ON CONFLICT(key) DO UPDATE SET name=EXCLUDED.name,version=EXCLUDED.version,source_repo=EXCLUDED.source_repo,source_path=EXCLUDED.source_path,source_capability=EXCLUDED.source_capability,updated_at=NOW()
      WHERE workflows.capability_id=EXCLUDED.capability_id AND workflows.channel='notion' AND workflows.form='api'
        AND (workflows.source_repo IS NULL OR workflows.source_repo=EXCLUDED.source_repo)
        AND (workflows.source_path IS NULL OR workflows.source_path=EXCLUDED.source_path)
      RETURNING id`, [s.capability_id, s.key, s.name, s.version,source.repo,source.path,s.capability])).rows[0];
    if (!w) throw new Error('工作流已有不同归属，拒绝覆盖');
    if(!sourceOptions.definitionsOnly){
    const agent = (await client.query(`SELECT name FROM ops_agents WHERE source='openclaw' AND host_alias='mmv' AND name=$1`, [s.agent])).rows;
    if (agent.length !== 1) throw new Error('公司 KR 分析员登记缺失或重复');
    }
    await client.query('UPDATE workflow_activity_refs SET active=false WHERE workflow_id=$1 AND active',[w.id]);
    for (const [i, activity] of s.activities.entries()) {
      const contract = activityContract(activity, i + 1,s), hash = stepSha256(contract);
      // 位置（能力/流程/顺序）由下面的流程引用决定，不写 journey_id / step_number（迁移 527）；身份 = (capability_key, activity_key)
      const result = await client.query(`INSERT INTO activities
        (name,description,status,capability_key,activity_key,backbone_version,workflow_id,executor_kind,contract,contract_sha256,contract_source)
        VALUES($1,$2,'active',$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
        ON CONFLICT(capability_key,activity_key) WHERE activity_key IS NOT NULL DO UPDATE SET
          name=EXCLUDED.name,description=EXCLUDED.description,
          backbone_version=EXCLUDED.backbone_version,contract=EXCLUDED.contract,
          contract_sha256=EXCLUDED.contract_sha256,contract_source=EXCLUDED.contract_source,
          updated_at=CASE WHEN activities.contract_sha256 IS DISTINCT FROM EXCLUDED.contract_sha256 THEN NOW() ELSE activities.updated_at END
        WHERE activities.workflow_id=EXCLUDED.workflow_id AND activities.executor_kind=EXCLUDED.executor_kind
          AND activities.capability_key=EXCLUDED.capability_key RETURNING id`,
      [activity.name, activity.implementation, s.capability, activity.key, s.version,
        w.id, activity.executor, canonicalJson(contract), hash, sourceUrl]);
      if (!result.rows.length) throw new Error(`活动归属冲突: ${activity.key}`);
      bindingsByActivity.set(result.rows[0].id,await validateImplementationBindings(contract,sourceOptions.readBinding||(b=>readCompanyKrFile(b.revision,b.path)),source));
      await client.query(`INSERT INTO workflow_activity_refs(workflow_id,slot_key,activity_id,sequence_no,source_repo,source_path,source_commit,active)
        VALUES($1,$2,$3,$4,'perfectuser21/cecelia','packages/brain/config/company-kr-workflow.json',$5,true)
        ON CONFLICT(workflow_id,slot_key) DO UPDATE SET activity_id=EXCLUDED.activity_id,sequence_no=EXCLUDED.sequence_no,source_commit=EXCLUDED.source_commit,active=true`,
      [w.id,activity.key,result.rows[0].id,i+1,source.commit]);
    }
    const foreign = (await client.query(`SELECT s.key FROM steps s JOIN activities a ON a.id=s.activity_id
      WHERE s.key=ANY($1::text[]) AND NOT EXISTS(SELECT 1 FROM workflow_activity_refs r WHERE r.activity_id=a.id AND r.workflow_id=$2 AND r.active)`, [s.steps.map(x => x.key), w.id])).rows;
    if (foreign.length) throw new Error('步骤已有其它工作流归属');
    const steps = await syncSteps(client, parseStepDod(JSON.stringify(s)), { manageTransaction: false });
    let runs=null;
    if(!sourceOptions.definitionsOnly){
    const runtime = await client.query(`UPDATE ops_workflows SET workflow_id=$1,stage_count=$2,uses_agents=$3::jsonb,
      updated_at=CASE WHEN workflow_id IS DISTINCT FROM $1 OR stage_count IS DISTINCT FROM $2 OR uses_agents IS DISTINCT FROM $3::jsonb THEN NOW() ELSE updated_at END
      WHERE source='scheduler' AND wf_id=$4 AND (workflow_id IS NULL OR workflow_id=$1) RETURNING id`,
    [w.id, s.activities.length, JSON.stringify([s.agent]), s.runtime]);
    if (runtime.rows.length !== 1) throw new Error('KR 同步作业缺失或归属冲突');
    const tasks = (await client.query(`SELECT id FROM tasks WHERE dept=$1 AND payload->'company_kr_analysis'->>'version'='1'`, [s.agent])).rows;
    runs = await attachRunsToWorkflow({ workflowId: w.id, taskIds: tasks.map(t => t.id) }, { pool: client });
    }
    await snapshotDefinitions(client,{workflowIds:[w.id],source,bindingsByActivity,documentsByWorkflow:new Map([[w.id,s]])});
    if(sourceOptions.beforeCommit)await sourceOptions.beforeCommit();
    await client.query('COMMIT');
    return { workflow_id: w.id, activities: s.activities.length, steps, runs };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
