/** Activity 单调和 Workflow 整调共用固定装配计划；仅显式纯输入/输出 Skill 可走 research。 */
import Ajv from 'ajv';
import { compileAssemblyPlan } from '../workflow-authoring/assembly-plan.js';
import { authoringError } from '../workflow-authoring/contracts.js';
const ajv = new Ajv({ allErrors: true, strict: true, validateFormats: false });
const STATIC_GAPS = new Set(['implementation_reference_unverified','runtime_admission_unverified','execution_evidence_unverified']);
export function validateInvocationOutput(schema, value) {
  let validate;
  try { validate = ajv.compile(schema); } catch { throw authoringError('JSON schema 不受支持',422,'invocation_schema_invalid'); }
  if (!validate(value)) throw authoringError('结构化输入或产物不符合 schema',422,'invocation_schema_invalid');
  return value;
}
export function compileInvocation(definition, catalog = {}, options = {}) {
  const plan = compileAssemblyPlan(definition,catalog,options);
  plan.gaps = plan.gaps.filter(g=>!STATIC_GAPS.has(g.code));
  const gap = (code,key=null)=>plan.gaps.push({code,activity_key:key});
  plan.input_schema=definition.input_schema;
  plan.output_schema=definition.output_schema;
  try { validateInvocationOutput(plan.input_schema,options.input); }
  catch { gap('input_schema_invalid'); }
  if (definition.status === 'deprecated' || ['scheduler_only','deprecated'].includes(definition.runtime?.mode)) gap('execution_mode_unsupported');
  for (const a of plan.activities) {
    const slot=definition.activities.find(s=>s.key===a.key);
    const contract=slot.reuse_activity_id ? catalog.activity_versions?.find(v=>v.id===slot.reuse_activity_definition_version_id)?.payload?.contract : slot;
    a.input_schema=contract?.input_schema;a.output_schema=contract?.output_schema;
    if (!['none','read_only'].includes(contract?.mutation_intent)) gap('mutation_unsupported',a.key);
    if (contract?.status === 'deprecated' || ['scheduler_only','deprecated'].includes(contract?.runtime?.mode)) gap('execution_mode_unsupported',a.key);
    if (contract?.resources && Object.keys(contract.resources).length) gap('resource_not_connected',a.key);
    if (a.transport !== 'codex-bridge') gap('transport_not_connected',a.key);
    if (a.implementation?.kind !== 'skill') gap('implementation_not_connected',a.key);
    // 保留来源声明摘要，固定引用核验会比对真实文件字节。
    if(a.implementation)for(const key of ['sha256','digest','name','version'])if(contract?.implementation?.[key]!==undefined)a.implementation[key]=contract.implementation[key];
    try { ajv.compile(a.input_schema);ajv.compile(a.output_schema); }
    catch { gap('activity_schema_invalid',a.key); }
  }
  plan.readiness=plan.gaps.length?'blocked':'unverified';
  return plan;
}
