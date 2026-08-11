import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MAP_MANIFEST_JSON_SCHEMA,
  digestMapManifest,
  validateMapManifest,
  validateMapManifestJsonSchema,
} from '../map-manifest-schema.js';

const fixtureUrl = new URL('../../../config/map-manifests/cecelia.v1.json', import.meta.url);
const loadManifest = () => JSON.parse(readFileSync(fixtureUrl, 'utf8'));

function deepReverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(deepReverseObjectKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).reverse().map(([key, item]) => [key, deepReverseObjectKeys(item)]),
  );
}

describe('Map Manifest JSON Schema', () => {
  it('冻结的 Cecelia v1 输入精确表达 2×11×2×7，且 F5/F6/F7/F8 仅为 alias', () => {
    const manifest = loadManifest();
    const result = validateMapManifest(manifest);

    expect(result).toEqual({ valid: true, errors: [], manifest });
    expect(manifest.value_streams).toHaveLength(2);
    expect(manifest.capabilities).toHaveLength(11);
    expect(manifest.boundaries).toHaveLength(2);
    expect(manifest.crosscut_pool).toHaveLength(7);
    expect(manifest.shared_prerequisites).toMatchObject({ applicable: false, items: [] });
    expect(manifest.source_decision_id).toBe('4bc109e9-3b70-4b17-a1b4-bcd01bfae776');
    expect(manifest.capabilities.map(({ key }) => key)).not.toEqual(
      expect.arrayContaining(['F5', 'F6', 'F7', 'F8']),
    );
    expect(manifest.capabilities.flatMap(({ aliases = [] }) => aliases)).toEqual(['F5', 'F6', 'F7']);
    expect(manifest.crosscut_pool.flatMap(({ aliases = [] }) => aliases)).toEqual(
      expect.arrayContaining(['F8']),
    );
  });

  it('发布机器可读 JSON Schema，并拒绝未知机械字段', () => {
    expect(MAP_MANIFEST_JSON_SCHEMA).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
    });
    expect(MAP_MANIFEST_JSON_SCHEMA.required).toEqual(expect.arrayContaining([
      'scope_key', 'schema_version', 'source_decision_id', 'value_streams', 'capabilities',
      'boundaries', 'crosscut_pool', 'shared_prerequisites',
    ]));

    const invalid = { ...loadManifest(), consumer_color: 'green' };
    const result = validateMapManifest(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'consumer_color', code: 'unrecognized_keys' }),
    ]));
  });

  it('Map core schema 不携带 Cecelia 或 ZenithJoy 领域硬编码', () => {
    expect(JSON.stringify(MAP_MANIFEST_JSON_SCHEMA)).not.toMatch(/cecelia|zenithjoy|\bF[0-9]\b|\bG[0-9]\b/i);
  });

  it('同一次校验返回全部重复 key、悬空引用与不适用合同错误', () => {
    const manifest = loadManifest();
    manifest.value_streams.push({ ...manifest.value_streams[0] });
    manifest.capabilities[0].value_stream_key = 'missing-stream';
    manifest.boundaries[0].from = 'missing-capability';
    manifest.crosscut_pool[0].serves.push('missing-stream');
    manifest.crosscut_pool[1].owner = 'missing-capability';
    manifest.shared_prerequisites.items.push({
      key: 'onboarding', name: '客户入场', serves: ['factory'],
    });
    manifest.shared_prerequisites.reason = '';

    const result = validateMapManifest(manifest);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'value_streams.2.key', code: 'duplicate_key' }),
      expect.objectContaining({ path: 'capabilities.0.value_stream_key', code: 'reference_not_found' }),
      expect.objectContaining({ path: 'boundaries.0.from', code: 'reference_not_found' }),
      expect.objectContaining({ path: 'crosscut_pool.0.serves.2', code: 'reference_not_found' }),
      expect.objectContaining({ path: 'crosscut_pool.1.owner', code: 'reference_not_found' }),
      expect.objectContaining({ path: 'shared_prerequisites.items', code: 'not_applicable_items' }),
      expect.objectContaining({ path: 'shared_prerequisites.reason', code: 'not_applicable_reason' }),
    ]));
  });

  it('未知字段不遮蔽同一请求中的重复 key 与悬空引用', () => {
    const manifest = loadManifest();
    manifest.consumer_color = 'green';
    manifest.capabilities.push({ ...manifest.capabilities[0] });
    manifest.boundaries[0].to = 'missing-capability';

    const result = validateMapManifest(manifest);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'consumer_color', code: 'unrecognized_keys' }),
      expect.objectContaining({ path: 'capabilities.11.key', code: 'duplicate_key' }),
      expect.objectContaining({ path: 'boundaries.0.to', code: 'reference_not_found' }),
    ]));
  });

  it.each([
    ['空白展示名', (manifest) => { manifest.value_streams[0].name = '   '; }],
    ['applicable 但 items 为空', (manifest) => {
      manifest.shared_prerequisites = { applicable: true, items: [] };
    }],
  ])('机器 JSON Schema 与运行时验证一致拒绝：%s', (_name, mutate) => {
    const manifest = loadManifest();
    mutate(manifest);

    expect(validateMapManifestJsonSchema(manifest).valid).toBe(false);
    expect(validateMapManifest(manifest).valid).toBe(false);
  });

  it('拒绝稳定 key/alias 冲突、同组 order 冲突与 Boundary 环', () => {
    const manifest = loadManifest();
    manifest.crosscut_pool[0].aliases = ['F1'];
    manifest.capabilities[1].order = 1;
    manifest.boundaries.push({
      key: 'G1_TO_F0', from: 'G1', to: 'F0', statement: '反向交接形成环',
    });

    const result = validateMapManifest(manifest);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'crosscut_pool.0.aliases.0', code: 'duplicate_alias' }),
      expect.objectContaining({ path: 'capabilities.1.order', code: 'duplicate_order' }),
      expect.objectContaining({ path: 'boundaries', code: 'cycle_detected' }),
    ]));
  });

  it.each([
    ['crosscut', (manifest) => { manifest.crosscut_pool[0].serves = ['factory', 'factory']; }, 'crosscut_pool.0.serves'],
    ['shared prerequisite', (manifest) => {
      manifest.shared_prerequisites = {
        applicable: true,
        items: [{ key: 'bootstrap', name: '共享前置', serves: ['factory', 'factory'] }],
      };
    }, 'shared_prerequisites.items.0.serves'],
  ])('JSON Schema 在投影前拒绝 %s 重复 serves', (_name, mutate, path) => {
    const manifest = loadManifest();
    mutate(manifest);

    const jsonResult = validateMapManifestJsonSchema(manifest);
    const runtimeResult = validateMapManifest(manifest);

    expect(jsonResult.valid).toBe(false);
    expect(runtimeResult.valid).toBe(false);
    expect(runtimeResult.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ path, code: 'uniqueItems' }),
    ]));
  });

  it('Cross-cut serves 可引用 Capability，不局限于 Value Stream', () => {
    const manifest = loadManifest();
    manifest.crosscut_pool[0].serves = ['F1'];

    expect(validateMapManifest(manifest)).toEqual({ valid: true, errors: [], manifest });
  });
});

describe('Map Manifest canonical digest', () => {
  it('忽略 object key 排列差异，但保留 array 业务顺序', () => {
    const manifest = loadManifest();
    const reordered = deepReverseObjectKeys(manifest);
    const arrayReordered = structuredClone(manifest);
    arrayReordered.value_streams.reverse();

    expect(digestMapManifest(reordered)).toBe(digestMapManifest(manifest));
    expect(digestMapManifest(manifest)).toMatch(/^[0-9a-f]{64}$/);
    expect(digestMapManifest(arrayReordered)).not.toBe(digestMapManifest(manifest));
  });
});
