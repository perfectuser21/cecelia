/** 既有来源台账的只读对账；mapped仅表示明确业务关联，不代表实现或执行通过。 */
import { readMapBrainBindings } from './map-brain-bindings.js';

const SOURCES = [
  ['skills', 'Skill 登记', 'skill_registry 全量；本机路径和内容摘要不能代替固定仓库身份，不按名称配对。'],
  ['repositories', '地图仓库登记', 'map_scope_repositories 全量；逐 scope 复核显式规范能力绑定及 graph 来源，不代表四类事实完整。'],
  ['apis', 'API 登记', 'api_registry 已采集全量；仅明确 scope 来源、固定提交和精确实现绑定可归属，不代表未扫描入口已覆盖。'],
  ['ops_workflows', '调度及运行入口', 'ops_workflows 已登记全量；仅 workflow_id 规范外键归属，不代表未采集 cron 已覆盖。'],
  ['resources', '资源台账', 'resources 全量；area_id 仅证明部门，现无规范 Workflow 关系；不含外部台账未采集资产。'],
  ['legacy_features', '旧 Feature', 'journey_features 全量；仅规范 step_id/journey_id 关联，不将源码 workflow_ref 或名称当业务身份。'],
];
const SHA = /^[0-9a-f]{40}$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const unique = items => [...new Map(items.map(item => [JSON.stringify(item), item])).values()];
const revision = value => typeof value === 'string' && SHA.test(value) ? value : null;
const canonicalRepo = row => {
  const value = row.adapter_config?.source_repo ?? row.repo;
  return typeof value === 'string' && REPO.test(value) ? value : null;
};
function options(input) {
  const { kind = 'skills', coverage = 'all', limit = 20, offset = 0 } = input;
  const number = value => typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value);
  if (!SOURCES.some(([key]) => key === kind) || !['all', 'mapped', 'unknown', 'excluded'].includes(coverage)
    || !number(limit) || !number(offset) || !Number.isSafeInteger(Number(limit)) || !Number.isSafeInteger(Number(offset))
    || Number(limit) < 1 || Number(limit) > 100 || Number(offset) < 0) {
    throw Object.assign(Error('coverage来源、筛选或分页参数无效'), { status: 400 });
  }
  return { kind, coverage, limit: Number(limit), offset: Number(offset) };
}
function item(kind, row, { consumers = [], source = null, reason = 'business_relation_missing', status = row.status ?? null } = {}) {
  return { id: String(row.id), name: row.name, kind, coverage_status: consumers.length ? 'mapped' : 'unknown',
    reason, record_status: status, source, consumers: unique(consumers) };
}
const workflowConsumer = w => ({ capability_id: w.capability_id, workflow_id: w.id });
function sourceIdentity(repo, path, commit, digest = null) {
  return { repo, path: path ?? null, revision: revision(commit), digest: DIGEST.test(digest || '') ? digest : null };
}

async function loadRelations(db) {
  const journeys = (await db.query('SELECT id,parent_journey_id FROM journeys')).rows;
  const workflows = (await db.query(`SELECT w.id,w.capability_id,v.source_repo,v.source_path,v.source_commit
    FROM workflows w JOIN journeys c ON c.id=w.capability_id JOIN journeys p ON p.id=c.parent_journey_id AND p.parent_journey_id IS NULL
    LEFT JOIN workflow_definition_versions v ON v.id=w.current_definition_version_id AND v.workflow_id=w.id`)).rows;
  const usages = (await db.query(`SELECT w.capability_id,w.id workflow_id,r.activity_id,r.id reference_id
    FROM workflow_activity_refs r JOIN workflows w ON w.id=r.workflow_id JOIN journey_steps a ON a.id=r.activity_id WHERE r.active`)).rows;
  const bindings = (await db.query(`SELECT w.capability_id,w.id workflow_id,r.activity_id,r.id reference_id,b.value binding
    FROM workflows w JOIN workflow_definition_versions v ON v.id=w.current_definition_version_id AND v.workflow_id=w.id
    CROSS JOIN LATERAL jsonb_array_elements(v.payload->'activities') ref
    JOIN workflow_activity_refs r ON r.id=(ref->>'reference_id')::uuid AND r.workflow_id=w.id AND r.active
    JOIN activity_definition_versions av ON av.id=(ref->>'activity_version_id')::uuid AND av.activity_id=r.activity_id
      AND r.activity_definition_version_id=av.id
    CROSS JOIN LATERAL jsonb_array_elements(av.payload->'implementation_bindings') b(value)
    WHERE v.payload->>'capability_id'=w.capability_id::text AND b.value->>'status'='verified'`)).rows;
  return { journeys, workflows, usages, bindings };
}

async function repositoryCoverage(db, relations) {
  const registrations = (await db.query('SELECT scope_key,repo,adapter_config FROM map_scope_repositories ORDER BY scope_key,repo')).rows;
  const manifests = (await db.query("SELECT scope_key,manifest FROM map_manifest_versions WHERE status='active'")).rows;
  const headers = (await db.query("SELECT repo,source_revision FROM fact_snapshot_headers WHERE kind='graph'")).rows;
  const verified = new Map();
  for (const m of manifests) verified.set(m.scope_key, await readMapBrainBindings(db, m.manifest, m.scope_key));
  const items = registrations.map(row => {
    const repo = canonicalRepo(row), commit = headers.find(h => h.repo === row.repo)?.source_revision;
    const m = manifests.find(m => m.scope_key === row.scope_key), evidence = verified.get(row.scope_key);
    const caps = (m?.manifest.capabilities || []).filter(n => n.brain_binding?.source_repo === repo && evidence?.[n.key]?.mapping_status === 'verified');
    const consumers = caps.flatMap(n => {
      const id = n.brain_binding.entity_id.toLowerCase(), workflows = relations.workflows.filter(w => w.capability_id === id);
      return workflows.length ? workflows.map(workflowConsumer) : [{ capability_id: id, workflow_id: null }];
    });
    return item('repositories', { id: `${row.scope_key}:${row.repo}`, name: `${row.scope_key} / ${row.repo}` }, {
      consumers, source: repo ? sourceIdentity(repo, null, commit) : null,
      reason: consumers.length ? 'explicit_scope_capability_binding' : 'scope_source_or_binding_unknown',
    });
  });
  return { registrations, items };
}

function apiCoverage(rows, repositories, relations) {
  return rows.map(row => {
    const registered = repositories.registrations.filter(r => r.repo === row.repo);
    const registration = registered.length === 1 ? registered[0] : null, repo = registration && canonicalRepo(registration);
    const source = repo ? sourceIdentity(repo, row.file_path, row.source_revision) : null;
    const scope = registration && repositories.items.find(i => i.id === `${registration.scope_key}:${registration.repo}`);
    const caps = new Set(scope?.consumers.map(c => c.capability_id));
    const matches = source?.revision && row.file_path ? relations.bindings.filter(r => r.binding.kind === 'code'
      && r.binding.repo === source.repo && r.binding.path === source.path && r.binding.revision === source.revision
      && DIGEST.test(r.binding.digest || '') && caps.has(r.capability_id)) : [];
    const digests = new Set(matches.map(r => r.binding.digest));
    const consumers = digests.size === 1 ? matches.map(({ binding: _, ...usage }) => usage) : [];
    if (consumers.length) source.digest = [...digests][0];
    return item('apis', { id: row.id, name: `${row.method} ${row.path}` }, { source, consumers,
      reason: consumers.length ? 'fixed_implementation_identity' : 'fixed_source_or_consumer_missing' });
  });
}

function featureCoverage(rows, relations) {
  const validCaps = new Set(relations.workflows.map(w => w.capability_id));
  for (const j of relations.journeys) if (relations.journeys.some(p => p.id === j.parent_journey_id && p.parent_journey_id === null)) validCaps.add(j.id);
  return rows.map(row => {
    let consumers = [];
    if (row.step_id) consumers = relations.usages.filter(u => u.activity_id === row.step_id && validCaps.has(u.capability_id)
      && (!row.journey_id || row.journey_id === u.capability_id
        || relations.journeys.some(j => j.id === u.capability_id && j.parent_journey_id === row.journey_id)));
    else if (validCaps.has(row.journey_id)) consumers = [{ capability_id: row.journey_id, workflow_id: null }];
    return item('legacy_features', row, { consumers, reason: consumers.length ? 'explicit_business_foreign_key' : 'legacy_feature_mapping_unknown' });
  });
}

/** 调用方用现有一致只读事务；不写台账、不读取任意context/config/命令。 */
export async function readCapabilityCoverage(db, input = {}) {
  const selection = options(input), relations = await loadRelations(db), repositories = await repositoryCoverage(db, relations);
  const skills = (await db.query('SELECT id,name,status FROM skill_registry ORDER BY id')).rows;
  const apis = (await db.query('SELECT id,method,path,file_path,repo,source_revision FROM api_registry ORDER BY id')).rows;
  const schedules = (await db.query('SELECT id,name,active,workflow_id FROM ops_workflows ORDER BY id')).rows;
  const resources = (await db.query('SELECT id,name,category FROM resources ORDER BY id')).rows;
  const features = (await db.query('SELECT id,name,status,journey_id,step_id FROM journey_features ORDER BY id')).rows;
  const sets = {
    skills: skills.map(row => item('skills', row, { reason: 'fixed_skill_identity_missing' })),
    repositories: repositories.items,
    apis: apiCoverage(apis, repositories, relations),
    ops_workflows: schedules.map(row => {
      const w = relations.workflows.find(w => w.id === row.workflow_id);
      return item('ops_workflows', row, { consumers: w ? [workflowConsumer(w)] : [], status: row.active ? 'active' : 'inactive',
        source: w?.source_repo && revision(w.source_commit) ? sourceIdentity(w.source_repo, w.source_path, w.source_commit) : null,
        reason: w ? 'explicit_workflow_foreign_key' : 'workflow_foreign_key_missing' });
    }),
    resources: resources.map(row => item('resources', row, { reason: 'resource_business_relation_missing' })),
    legacy_features: featureCoverage(features, relations),
  };
  const sources = SOURCES.map(([kind, title, scope_note]) => {
    const rows = sets[kind], revisions = new Set(rows.map(r => r.source?.revision || null));
    return { kind, title, total: rows.length, mapped: rows.filter(r => r.coverage_status === 'mapped').length,
      unknown: rows.filter(r => r.coverage_status === 'unknown').length, excluded: 0,
      source_revision: revisions.size === 1 ? [...revisions][0] : null, scope_note: `${scope_note} 保留归档分母；无授权排除规则，excluded=0。mapped不是业务通过。` };
  });
  const filtered = sets[selection.kind].filter(i => selection.coverage === 'all' || i.coverage_status === selection.coverage);
  return { generated_at: new Date().toISOString(), sources, selection: { ...selection, total: filtered.length },
    items: filtered.slice(selection.offset, selection.offset + selection.limit) };
}
