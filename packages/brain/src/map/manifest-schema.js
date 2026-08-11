/**
 * Universal Map Manifest JSON Schema (schema_version=1)
 * PRD: Universal Map Projection Engine, 刀1
 *
 * 业务意图输入一次，通过此 schema 校验后激活，不允许逐节点 CRUD。
 */

export const MANIFEST_SCHEMA_V1 = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'MapManifest',
  type: 'object',
  required: ['scope_key', 'schema_version', 'value_streams', 'capabilities', 'boundaries', 'crosscut_pool', 'shared_prerequisites'],
  additionalProperties: false,
  properties: {
    scope_key: {
      type: 'string',
      minLength: 1,
      pattern: '^[a-z0-9_-]+$',
    },
    schema_version: {
      type: 'integer',
      enum: [1],
    },
    source_decision_id: {
      type: 'string',
      pattern: '^[0-9a-f-]{36}$',
    },
    value_streams: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['key', 'name', 'perceiver', 'order'],
        additionalProperties: false,
        properties: {
          key: { type: 'string', pattern: '^[a-z0-9_-]+$', minLength: 1 },
          name: { type: 'string', minLength: 1 },
          perceiver: { type: 'string', minLength: 1 },
          order: { type: 'integer', minimum: 1 },
        },
      },
    },
    capabilities: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['key', 'name', 'value_stream_key', 'order'],
        additionalProperties: false,
        properties: {
          key: { type: 'string', pattern: '^[A-Za-z0-9_-]+$', minLength: 1 },
          name: { type: 'string', minLength: 1 },
          value_stream_key: { type: 'string', pattern: '^[a-z0-9_-]+$', minLength: 1 },
          order: { type: 'integer', minimum: 1 },
          aliases: { type: 'array', items: { type: 'string' }, default: [] },
        },
      },
    },
    boundaries: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key', 'from', 'to', 'statement'],
        additionalProperties: false,
        properties: {
          key: { type: 'string', pattern: '^[A-Za-z0-9_-]+$', minLength: 1 },
          from: { type: 'string', pattern: '^[A-Za-z0-9_-]+$', minLength: 1 },
          to: { type: 'string', pattern: '^[A-Za-z0-9_-]+$', minLength: 1 },
          statement: { type: 'string', minLength: 1 },
        },
      },
    },
    crosscut_pool: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key', 'name', 'serves'],
        additionalProperties: false,
        properties: {
          key: { type: 'string', pattern: '^[a-z0-9_-]+$', minLength: 1 },
          name: { type: 'string', minLength: 1 },
          serves: {
            type: 'array',
            minItems: 1,
            items: { type: 'string', pattern: '^[a-z0-9_-]+$' },
          },
          aliases: { type: 'array', items: { type: 'string' }, default: [] },
          owner: { type: 'string' },
        },
      },
    },
    shared_prerequisites: {
      type: 'object',
      required: ['applicable', 'items'],
      additionalProperties: false,
      properties: {
        applicable: { type: 'boolean' },
        items: { type: 'array' },
        reason: { type: 'string' },
      },
    },
  },
};

/**
 * 校验 manifest 语义完整性（JSON Schema 之外的引用完整性检查）
 * @param {object} manifest - 已通过 JSON Schema 的 manifest 对象
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateManifestSemantics(manifest) {
  const errors = [];

  const vsKeys = new Set(manifest.value_streams.map((v) => v.key));
  const capKeys = new Set(manifest.capabilities.map((c) => c.key));

  // Capability 必须引用已知 value_stream_key
  for (const cap of manifest.capabilities) {
    if (!vsKeys.has(cap.value_stream_key)) {
      errors.push(`capability '${cap.key}' 引用了不存在的 value_stream_key='${cap.value_stream_key}'`);
    }
  }

  // capability key 不能重复
  const capKeyList = manifest.capabilities.map((c) => c.key);
  const dupCaps = capKeyList.filter((k, i) => capKeyList.indexOf(k) !== i);
  if (dupCaps.length > 0) errors.push(`capability key 重复: ${dupCaps.join(', ')}`);

  // value_stream key 不能重复
  const vsKeyList = manifest.value_streams.map((v) => v.key);
  const dupVs = vsKeyList.filter((k, i) => vsKeyList.indexOf(k) !== i);
  if (dupVs.length > 0) errors.push(`value_stream key 重复: ${dupVs.join(', ')}`);

  // boundary from/to 必须引用已知 capability
  for (const b of manifest.boundaries) {
    if (!capKeys.has(b.from)) errors.push(`boundary '${b.key}' from='${b.from}' 不在 capabilities 中`);
    if (!capKeys.has(b.to)) errors.push(`boundary '${b.key}' to='${b.to}' 不在 capabilities 中`);
  }

  // boundary key 不能重复
  const bndKeys = manifest.boundaries.map((b) => b.key);
  const dupBnd = bndKeys.filter((k, i) => bndKeys.indexOf(k) !== i);
  if (dupBnd.length > 0) errors.push(`boundary key 重复: ${dupBnd.join(', ')}`);

  // crosscut serves 必须引用已知 value_stream_key
  for (const cc of manifest.crosscut_pool) {
    for (const s of cc.serves) {
      if (!vsKeys.has(s)) errors.push(`crosscut '${cc.key}' serves 引用了不存在的 value_stream_key='${s}'`);
    }
  }

  // crosscut key 不能重复
  const ccKeys = manifest.crosscut_pool.map((c) => c.key);
  const dupCc = ccKeys.filter((k, i) => ccKeys.indexOf(k) !== i);
  if (dupCc.length > 0) errors.push(`crosscut_pool key 重复: ${dupCc.join(', ')}`);

  // shared_prerequisites: applicable=false 时 items 必须为空
  if (!manifest.shared_prerequisites.applicable && manifest.shared_prerequisites.items.length > 0) {
    errors.push('shared_prerequisites.applicable=false 时 items 必须为空数组');
  }
  if (manifest.shared_prerequisites.applicable && !manifest.shared_prerequisites.reason) {
    // applicable=true 时 reason 不是必须的，但 items 应该有内容
    // 不强制
  }

  return { valid: errors.length === 0, errors };
}
