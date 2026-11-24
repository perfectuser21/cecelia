export {readInfraConsumerRegistry,registerInfraConsumerSources} from './infra-consumer-source.js';
/** 只读保留既有工厂消费者的身份与历史封印校验。 */
import { EXISTING_OPS_IDENTITIES } from './existing-ops-source.js';
import { stepSha256 } from '../../scripts/sync-steps-from-workspace.mjs';
const ROOT = 'aaaaaaaa-f0f0-4000-8000-000000000001';
const ids = EXISTING_OPS_IDENTITIES.map(i => i.workflow_id);
const fail = code => Object.assign(Error(code), { code, status: 409 });
export async function readExistingOpsRegistry(db) {
  const workflows = (await db.query('SELECT * FROM workflows WHERE id=ANY($1::uuid[]) ORDER BY id', [ids])).rows;
  const references = (await db.query('SELECT * FROM workflow_activity_refs WHERE workflow_id=ANY($1::uuid[]) ORDER BY id', [ids])).rows;
  const activityIds = [...new Set(references.map(r => r.activity_id))];
  const activities = (await db.query('SELECT * FROM activities WHERE id=ANY($1::uuid[]) ORDER BY id', [activityIds])).rows;
  const steps = (await db.query('SELECT * FROM steps WHERE activity_id=ANY($1::uuid[]) ORDER BY id', [activityIds])).rows;
  const capabilities = (await db.query('SELECT * FROM capabilities WHERE id=ANY($1::uuid[]) ORDER BY id', [EXISTING_OPS_IDENTITIES.map(i => i.capability_id)])).rows;
  const valueStreams = (await db.query('SELECT * FROM value_streams WHERE id=$1', [ROOT])).rows;
  const body = JSON.parse(JSON.stringify({ workflows, references, activities, steps, capabilities, value_streams: valueStreams }));
  return { ...body, registry_sha256: stepSha256(body) };
}
export function validateExistingOpsRegistry(registry) {
  if (registry.workflows.length !== 2 || registry.capabilities.length !== 2 || registry.value_streams.length !== 1) throw fail('OPS_REGISTRY_IDENTITY_INVALID');
  for (const identity of EXISTING_OPS_IDENTITIES) {
    const workflow = registry.workflows.find(w => w.id === identity.workflow_id);
    const capability = registry.capabilities.find(c => c.id === identity.capability_id);
    const refs = registry.references.filter(r => r.workflow_id === identity.workflow_id);
    const first = refs.find(r => r.id === identity.reference_id);
    if (!workflow || workflow.key !== identity.workflow_key || workflow.capability_id !== identity.capability_id
      || capability?.parent_journey_id !== ROOT || refs.length !== 4 || !first?.active
      || first.activity_id !== identity.activity_id || first.slot_key !== identity.slot_key || first.sequence_no !== identity.sequence_no
      || identity.unverified_reference_ids.some(id => !refs.some(r => r.id === id))) throw fail('OPS_REGISTRY_IDENTITY_INVALID');
  }
}
