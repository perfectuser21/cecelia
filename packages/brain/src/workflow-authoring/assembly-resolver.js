import { uuid, requireCondition } from './contracts.js';
import { compileAssemblyPlan } from './assembly-plan.js';

/** 只读取服务器保存的定义与真实目录，不接收调用者传来的 ready、目录或运行证明。 */
export async function resolveAuthoringAssembly(pool, taskId, tenantId = 'default') {
  uuid(taskId, 'taskId');
  requireCondition(typeof tenantId === 'string' && tenantId.trim() && tenantId.length <= 200, '租户身份无效', 400);
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const row = (await client.query('SELECT id,payload,result FROM tasks WHERE id=$1', [taskId])).rows[0];
    requireCondition(row && (row.payload?.tenant_id ?? 'default') === tenantId, '任务不存在', 404);
    requireCondition(row.payload?.workflow_authoring === true, '任务未声明 workflow_authoring', 409);
    const definition = row.result?.workflow_authoring?.outputs?.compose?.definition;
    requireCondition(definition, '管理任务尚未形成组装定义', 409);
    const slots = Array.isArray(definition.activities) ? definition.activities.filter(a => a && typeof a === 'object') : [];
    const versionIds = slots.map(a => a.reuse_activity_definition_version_id).filter(Boolean);
    versionIds.forEach(id => uuid(id, 'activity_definition_version_id'));
    const versions = versionIds.length ? (await client.query(
      'SELECT id,activity_id,payload,contract_sha256,source_repo,source_path,source_commit FROM activity_definition_versions WHERE id=ANY($1::uuid[])',
      [versionIds])).rows : [];
    const contracts = [...slots, ...versions.map(v => v.payload?.contract).filter(Boolean)];
    const skillIds = contracts.map(a => a.implementation?.skill_id).filter(Boolean);
    skillIds.forEach(id => uuid(id, 'skill_id'));
    const skills = skillIds.length ? (await client.query('SELECT id,status FROM skill_registry WHERE id=ANY($1::uuid[])', [skillIds])).rows : [];
    const keys = contracts.flatMap(a => Array.isArray(a.warehouse_dependencies) ? a.warehouse_dependencies.map(w => w?.key).filter(k => typeof k === 'string') : []);
    const warehouse_items = keys.length ? (await client.query('SELECT id,key,active,shelf FROM warehouse_items WHERE key=ANY($1::text[])', [keys])).rows : [];
    const plan = compileAssemblyPlan(definition, { skills, warehouse_items, activity_versions: versions }, { tenantId });
    await client.query('COMMIT');
    return { task_id: taskId, plan };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
