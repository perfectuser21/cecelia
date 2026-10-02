import { z } from 'zod';

const UUID = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
const REPO = '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$';
const REVISION = '^[0-9a-fA-F]{40}$';
export function brainBindingJsonSchema(type) {
  return {
    type: 'object', additionalProperties: false,
    required: ['entity_type', 'entity_id', 'source_repo', 'source_revision'],
    properties: {
      entity_type: { const: type }, entity_id: { type: 'string', pattern: UUID },
      source_repo: { type: 'string', pattern: REPO }, source_revision: { type: 'string', pattern: REVISION },
    },
  };
}
export function brainBindingSchema(type) {
  return z.object({
    entity_type: z.literal(type), entity_id: z.string().regex(new RegExp(UUID)),
    source_repo: z.string().regex(new RegExp(REPO)), source_revision: z.string().regex(new RegExp(REVISION)),
  }).strict();
}
export class MapBrainBindingError extends Error {
  constructor(code, message, details = undefined) {
    super(message); this.name = 'MapBrainBindingError'; this.code = `MAP_BRAIN_BINDING_${code}`;
    this.status = 422; this.details = details;
  }
}
function structuralNodes(manifest) {
  return [...(manifest?.value_streams ?? []).map(node => ({ node, type: 'value_stream' })),
    ...(manifest?.capabilities ?? []).map(node => ({ node, type: 'capability' }))];
}
export function hasBrainBindings(manifest) {
  return structuralNodes(manifest).some(({ node }) => node.brain_binding !== undefined);
}

/** 调用者必须在事务中；与 registerJourney 同序锁住业务层级，阻止并发改父。 */
export async function validateMapBrainBindings(client, manifest, scopeKey = manifest.scope_key) {
  const nodes = structuralNodes(manifest);
  if (!hasBrainBindings(manifest)) return {};
  if (manifest.scope_key !== scopeKey) throw new MapBrainBindingError('SCOPE_MISMATCH', '绑定 scope 与 manifest 不一致');
  const keys = new Set();
  for (const { node, type } of nodes) {
    if (keys.has(node.key)) throw new MapBrainBindingError('DUPLICATE_KEY', `重复结构 key: ${node.key}`);
    keys.add(node.key);
    if (node.brain_binding !== undefined && !brainBindingSchema(type).safeParse(node.brain_binding).success) {
      throw new MapBrainBindingError('INVALID', `绑定格式错误: ${node.key}`);
    }
  }
  await client.query('LOCK TABLE journeys, workflows, areas IN SHARE ROW EXCLUSIVE MODE');
  // SHARE 也保护不存在的登记/header，防止校验后插入或替换事实造成假 verified。
  await client.query('LOCK TABLE map_scope_repositories, fact_snapshot_headers IN SHARE MODE');
  return inspectMapBrainBindings(client, manifest, scopeKey, true);
}

/** 读路径复核当前真身；不信任历史投影里的 verified，也不锁表或写库。 */
export async function readMapBrainBindings(client, manifest, scopeKey = manifest.scope_key) {
  return inspectMapBrainBindings(client, manifest, scopeKey, false);
}

async function inspectMapBrainBindings(client, manifest, scopeKey, strict) {
  const evidence = {};
  const streams = new Map((manifest.value_streams ?? []).map(node => [node.key, node]));
  for (const { node, type } of structuralNodes(manifest)) {
    const binding = node.brain_binding;
    if (!binding) continue;
    const errors = [];
    const reject = (code, message) => {
      const error = new MapBrainBindingError(code, message);
      if (strict) throw error;
      errors.push(error.code);
    };
    if (!brainBindingSchema(type).safeParse(binding).success || manifest.scope_key !== scopeKey) {
      reject('INVALID', `绑定格式或scope错误: ${node.key}`);
      evidence[node.key] = { registration_status: 'unknown', hierarchy_status: 'unknown', source_status: 'unknown', mapping_status: 'unknown', validation_errors: errors };
      continue;
    }
    const { rows: entities } = await client.query('SELECT id, parent_journey_id FROM journeys WHERE id=$1', [binding.entity_id]);
    const entity = entities[0];
    if (!entity) reject('NOT_FOUND', `规范实体不存在: ${binding.entity_id}`);
    const validType = entity && (entity.parent_journey_id ? 'capability' : 'value_stream') === type;
    if (entity && !validType) reject('TYPE_MISMATCH', `规范实体类型不符: ${node.key}`);
    const validParent = type === 'value_stream' || entity?.parent_journey_id === streams.get(node.value_stream_key)?.brain_binding?.entity_id?.toLowerCase();
    if (entity && validType && !validParent) reject('PARENT_MISMATCH', `能力父级与绑定价值流不符: ${node.key}`);
    const { rows: registrations } = await client.query(
      `SELECT repo FROM map_scope_repositories
        WHERE scope_key=$1 AND (repo=$2 OR adapter_config->>'source_repo'=$2) ORDER BY repo`,
      [scopeKey, binding.source_repo],
    );
    if (!registrations.length) reject('REPO_NOT_REGISTERED', `仓库未登记到 scope: ${binding.source_repo}`);
    if (registrations.length > 1) reject('AMBIGUOUS_REPO', `仓库对应多个登记键: ${binding.source_repo}`);
    const { rows: headers } = await client.query(
      `SELECT repo, source_revision, scanned_at FROM fact_snapshot_headers
        WHERE kind='graph' AND repo=ANY($1::text[]) ORDER BY repo`,
      [registrations.map(row => row.repo)],
    );
    const matched = registrations.length === 1 && headers.find(header => header.source_revision.toLowerCase() === binding.source_revision.toLowerCase());
    const registered = Boolean(entity) && registrations.length === 1;
    const hierarchy = validType && validParent;
    evidence[node.key] = {
      registration_status: registered ? 'verified' : 'unknown', hierarchy_status: hierarchy ? 'verified' : 'unknown',
      source_status: matched ? 'verified' : 'unknown', mapping_status: registered && hierarchy && matched ? 'verified' : 'unknown',
      source_evidence: matched ? { repo: matched.repo, source_revision: matched.source_revision, scanned_at: matched.scanned_at instanceof Date ? matched.scanned_at.toISOString() : matched.scanned_at } : null,
      ...(errors.length && { validation_errors: errors }),
    };
  }
  return evidence;
}

/** 无事务证据的纯投影只声明绑定，不能把 SHA 格式校验当成来源核验。 */
export function brainBindingAttributes(node, evidence = {}) {
  if (!node.brain_binding) return {};
  return {
    brain_binding: { ...node.brain_binding }, canonical_entity_id: node.brain_binding.entity_id.toLowerCase(),
    canonical_entity_type: node.brain_binding.entity_type,
    registration_status: 'unknown', hierarchy_status: 'unknown', source_status: 'unknown', mapping_status: 'unknown',
    ...evidence,
  };
}
