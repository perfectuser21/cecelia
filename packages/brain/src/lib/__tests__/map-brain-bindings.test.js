import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import { validateMapManifest, validateMapManifestJsonSchema, digestMapManifest } from '../map-manifest-schema.js';
import { buildMapProjection } from '../map-projector.js';
import { MANIFEST_SCHEMA_V1 } from '../../map/manifest-schema.js';
import { buildStructuralProjection } from '../../map/projector.js';
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
function fixture() {
  const bind = (entity_type, entity_id) => ({ entity_type, entity_id, source_repo: 'owner/repo', source_revision: 'a'.repeat(40) });
  return { scope_key: 'scope-a', schema_version: 1, source_decision_id: ids[0],
    value_streams: [{ key: 'flow', name: '流', perceiver: '人', order: 1, brain_binding: bind('value_stream', ids[0]) }],
    capabilities: [{ key: 'F1', name: '能力', value_stream_key: 'flow', order: 1, brain_binding: bind('capability', ids[1]) }],
    boundaries: [], crosscut_pool: [], shared_prerequisites: { applicable: false, items: [], reason: '无' } };
}
const oldValidate = new Ajv().compile(MANIFEST_SCHEMA_V1);
describe('地图规范 UUID 绑定合同', () => {
  it('三套格式校验接受绑定并保留字段', () => {
    const m = fixture();
    expect(validateMapManifest(m)).toMatchObject({ valid: true, manifest: m });
    expect(validateMapManifestJsonSchema(m).valid).toBe(true);
    expect(oldValidate(m)).toBe(true);
  });
  it.each(['entity_id', 'source_repo', 'source_revision', 'entity_type'])('拒绝错误 %s', field => {
    const m = fixture(); m.capabilities[0].brain_binding[field] = 'wrong';
    expect(validateMapManifest(m).valid).toBe(false);
    expect(validateMapManifestJsonSchema(m).valid).toBe(false);
    expect(oldValidate(m)).toBe(false);
  });
  it('拒绝节点与绑定类型不一致和重复结构 key', () => {
    const m = fixture(); m.capabilities[0].brain_binding.entity_type = 'value_stream';
    expect(validateMapManifest(m).valid).toBe(false);
    expect(oldValidate(m)).toBe(false);
    m.capabilities[0].brain_binding.entity_type = 'capability';
    m.capabilities.push({ ...m.capabilities[0], order: 2 });
    expect(validateMapManifest(m).valid).toBe(false);
  });
  it('两个投影保留旧 identity，纯函数不能伪造来源核验', () => {
    const m = fixture(), legacy = structuredClone(m);
    for (const n of [...legacy.value_streams, ...legacy.capabilities]) delete n.brain_binding;
    for (const build of [x => buildStructuralProjection(x, x.scope_key), x => buildMapProjection({ manifest: x, manifestDigest: digestMapManifest(x) })]) {
      const bound = build(m).nodes.find(n => n.node_key === 'F1');
      const old = build(legacy).nodes.find(n => n.node_key === 'F1');
      expect(bound.node_id).toBe(old.node_id);
      expect(bound.attributes).toMatchObject({ canonical_entity_id: ids[1], canonical_entity_type: 'capability', brain_binding: m.capabilities[0].brain_binding, mapping_status: 'unknown', source_status: 'unknown' });
    }
  });
  it('绑定变化改变投影摘要', () => {
    const m = fixture();
    const a = buildMapProjection({ manifest: m, manifestDigest: digestMapManifest(m) });
    m.capabilities[0].brain_binding.entity_id = '33333333-3333-4333-8333-333333333333';
    const b = buildMapProjection({ manifest: m, manifestDigest: digestMapManifest(m) });
    expect(a.projection_digest).not.toBe(b.projection_digest);
  });
});
