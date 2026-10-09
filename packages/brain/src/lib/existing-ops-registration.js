/** 既有工厂消费者只追加来源历史，不改任何执行登记或 current。 */
import { buildExistingOpsSources, EXISTING_OPS_IDENTITIES, EXISTING_OPS_REPO, EXISTING_OPS_SCOPE } from './existing-ops-source.js';
import { freezeFactoryWorkspaceConsumerPayload, freezeScratchFactoryWorkspaceConsumerPayload } from './consumer-source-set.js';
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
/** Only the two existing factory owners may advance source anchors; no definition is activated. */
export async function prepareExistingOpsManifestAdvance(db, query) {
  if (query.scope !== EXISTING_OPS_SCOPE || query.repo !== EXISTING_OPS_REPO || !/^[a-f0-9]{40}$/.test(query.revision || '')) throw fail('OPS_MANIFEST_IDENTITY_INVALID');
  validateExistingOpsRegistry(await readExistingOpsRegistry(db));
  const rows = (await db.query("SELECT * FROM map_manifest_versions WHERE scope_key=$1 AND status='active'", [EXISTING_OPS_SCOPE])).rows;
  if (rows.length !== 1) throw fail('OPS_MANIFEST_IDENTITY_INVALID');
  const row = rows[0], manifest = structuredClone(row.manifest);
  if (manifest.scope_key !== EXISTING_OPS_SCOPE || manifest.value_streams?.length !== 1 || manifest.capabilities?.length !== 2) throw fail('OPS_MANIFEST_IDENTITY_INVALID');
  const root = manifest.value_streams[0];
  const expected = [[root, 'value_stream', ROOT], ...EXISTING_OPS_IDENTITIES.map(identity => [manifest.capabilities.find(node => node.brain_binding?.entity_id === identity.capability_id), 'capability', identity.capability_id])];
  let changed = false;
  for (const [node, type, id] of expected) {
    const binding = node?.brain_binding;
    if (!binding || binding.entity_id !== id || binding.entity_type !== type || binding.source_repo !== EXISTING_OPS_REPO
      || !/^[a-f0-9]{40}$/.test(binding.source_revision || '') || type === 'capability' && node.value_stream_key !== root.key) throw fail('OPS_MANIFEST_IDENTITY_INVALID');
    changed ||= binding.source_revision !== query.revision;
    binding.source_revision = query.revision;
  }
  return changed ? { manifest, expectedActive: { id: row.id, digest: row.digest } } : null;
}
async function append(db, kind, id, payload, source) {
  const table = kind === 'workflow' ? 'workflow_definition_versions' : 'activity_definition_versions';
  const column = `${kind}_id`, hash = stepSha256({ source, payload });
  await db.query(`INSERT INTO ${table}(${column},payload,payload_sha256,source_repo,source_path,source_commit,contract_sha256)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(${column},source_repo,source_path,payload_sha256) DO NOTHING`,
  [id, payload, hash, source.repo, source.path, source.commit, stepSha256(payload.contract)]);
  const row = (await db.query(`SELECT * FROM ${table} WHERE ${column}=$1 AND payload_sha256=$2 AND source_repo=$3 AND source_path=$4`, [id, hash, source.repo, source.path])).rows[0];
  if (!row) throw fail('OPS_HISTORY_APPEND_FAILED');
  return row;
}
/** checkMain由已有认证的固定main refresh提供；不能把候选当中央当前来源。 */
export async function registerExistingOpsSources(pool, options) {
  const mode=options?.mode||'trusted_main';
  if (options?.scope !== EXISTING_OPS_SCOPE || options.repo !== EXISTING_OPS_REPO || !/^[a-f0-9]{64}$/.test(options.expectedRegistrySha256 || '')
    || !['trusted_main','scratch_candidate'].includes(mode) || mode==='trusted_main'&&typeof options.checkMain !== 'function'
    || typeof options.actor !== 'string' || !options.actor.trim()) throw fail('OPS_REGISTRATION_INPUT_INVALID');
  const checkSource=mode==='trusted_main'?options.checkMain:async()=>{
    const name=(await pool.query('SELECT current_database() name')).rows[0].name;
    if(name!=='cecelia_scratch'&&!(name==='cecelia_test'&&process.env.CI==='true'&&process.env.GITHUB_ACTIONS==='true'))throw fail('OPS_SCRATCH_REQUIRED');
  };
  await checkSource();
  const proof = await buildExistingOpsSources(options);
  if (proof.consumers.some(c => c.status !== 'verified')) throw fail('OPS_SOURCE_UNKNOWN');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('existing-factory-consumer-evidence'))");
    await db.query('SELECT id FROM workflows WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [ids]);
    await db.query('SELECT id FROM workflow_activity_refs WHERE workflow_id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [ids]);
    await db.query('SELECT id FROM activities WHERE id IN (SELECT activity_id FROM workflow_activity_refs WHERE workflow_id=ANY($1::uuid[])) ORDER BY id FOR UPDATE', [ids]);
    await db.query('SELECT id FROM steps WHERE activity_id IN (SELECT activity_id FROM workflow_activity_refs WHERE workflow_id=ANY($1::uuid[])) ORDER BY id FOR UPDATE', [ids]);
    await db.query('SELECT id FROM capabilities WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [EXISTING_OPS_IDENTITIES.map(i => i.capability_id)]);
    await db.query('SELECT id FROM value_streams WHERE id=$1 FOR UPDATE', [ROOT]);
    const before = await readExistingOpsRegistry(db);
    if (before.registry_sha256 !== options.expectedRegistrySha256) throw fail('OPS_REGISTRY_CONFLICT');
    validateExistingOpsRegistry(before);
    const definitions = { workflows: [], activities: [] };
    for (const consumer of proof.consumers) {
      const source = { repo: options.repo, commit: options.revision, path: consumer.workflow_key === 'factory_f2_ops' ? '.github/workflows/brain-ci-deploy.yml' : '.github/workflows/nightly-regression.yml' };
      const contract = { key: consumer.workflow_key, definition_scope: 'consumer_evidence', executable: false, source_basis: 'fixed_git_tree' };
      let activityPayload = {
        activity_id: consumer.activity_id, definition_key: `${consumer.workflow_key}.${consumer.slot_key}`, source_scope: EXISTING_OPS_SCOPE,
        definition_scope: 'consumer_evidence', registration_sha256:before.registry_sha256, contract, steps: [], implementation_bindings: consumer.bindings,
        input_relations: consumer.input_relations, verification: { runtime_status: 'not_evaluated' },
      };
      if(options.workspaceConsumerProof&&consumer.workflow_key==='factory_f3_ops'){
        const freeze=mode==='scratch_candidate'?freezeScratchFactoryWorkspaceConsumerPayload:freezeFactoryWorkspaceConsumerPayload;
        activityPayload=freeze(activityPayload,options.workspaceConsumerProof,{repo:options.repo,revision:options.revision});
      }
      const activity=await append(db,'activity',consumer.activity_id,activityPayload,source);
      definitions.activities.push(activity);
      const workflow = before.workflows.find(w => w.id === consumer.workflow_id);
      definitions.workflows.push(await append(db, 'workflow', consumer.workflow_id, {
        workflow_id: workflow.id, key: workflow.key, name: workflow.name, capability_id: workflow.capability_id,
        channel: workflow.channel, form: workflow.form, source_scope: EXISTING_OPS_SCOPE, definition_scope: 'consumer_evidence',registration_sha256:before.registry_sha256,
        contract, coverage: proof.workflows.find(w => w.workflow_id === workflow.id).coverage,
        activities: [{ reference_id: consumer.reference_id, slot_key: consumer.slot_key, sequence_no: consumer.sequence_no,
          activity_id: consumer.activity_id, activity_version_id: activity.id, source_ref: before.references.find(r => r.id === consumer.reference_id).source_ref }],
      }, source));
    }
    if ((await readExistingOpsRegistry(db)).registry_sha256 !== before.registry_sha256) throw fail('OPS_REGISTRY_CONFLICT');
    await checkSource();
    await db.query('COMMIT');
    return { scope: EXISTING_OPS_SCOPE, repo: options.repo, revision: options.revision, actor: options.actor,
      registration_scope: 'consumer_evidence', source_basis:mode, registry_sha256: before.registry_sha256, source_sha256: stepSha256(proof),
      definitions, executable: false, remaining_unknown_reference_ids: EXISTING_OPS_IDENTITIES.flatMap(i => i.unverified_reference_ids) };
  } catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
}
