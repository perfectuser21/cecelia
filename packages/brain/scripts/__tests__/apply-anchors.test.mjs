import { describe, it, expect } from 'vitest';
import { parseApprovedFile, resolveFeatureId, buildPatchPayload } from '../apply-anchors.mjs';

describe('parseApprovedFile', () => {
  it('解析 entries 数组,每条含 feature_id', () => {
    const json = JSON.stringify({ entries: [{ feature_id: 'abc123', unit_test_path: 'x.ts' }] });
    const entries = parseApprovedFile(json);
    expect(entries).toHaveLength(1);
    expect(entries[0].feature_id).toBe('abc123');
  });

  it('entries 缺失 → 抛错', () => {
    expect(() => parseApprovedFile(JSON.stringify({}))).toThrow(/entries/);
  });

  it('某条缺 feature_id → 抛错', () => {
    const json = JSON.stringify({ entries: [{ unit_test_path: 'x.ts' }] });
    expect(() => parseApprovedFile(json)).toThrow(/feature_id/);
  });
});

describe('buildPatchPayload', () => {
  it('只带非 null 字段', () => {
    const entry = { feature_id: 'abc', unit_test_path: 'x.ts', workflow_ref: null, guard_ref: null };
    expect(buildPatchPayload(entry)).toEqual({ unit_test_path: 'x.ts' });
  });

  it('多字段非 null 都带上', () => {
    const entry = { feature_id: 'abc', unit_test_path: 'x.ts', workflow_ref: 'y.spec.ts', guard_ref: null };
    expect(buildPatchPayload(entry)).toEqual({ unit_test_path: 'x.ts', workflow_ref: 'y.spec.ts' });
  });

  it('三字段全 null → 空对象', () => {
    const entry = { feature_id: 'abc', unit_test_path: null, workflow_ref: null, guard_ref: null };
    expect(buildPatchPayload(entry)).toEqual({});
  });
});

describe('resolveFeatureId', () => {
  it('单条命中 → 返回 uuid', async () => {
    const fakeQuery = async (sql, params) => {
      expect(sql).toContain('ILIKE');
      expect(params[0]).toBe('abc123%');
      return { rows: [{ id: 'abc12345-full-uuid' }] };
    };
    const id = await resolveFeatureId(fakeQuery, 'abc123');
    expect(id).toBe('abc12345-full-uuid');
  });

  it('零命中 → 返回 null', async () => {
    const fakeQuery = async () => ({ rows: [] });
    const id = await resolveFeatureId(fakeQuery, 'zzz999');
    expect(id).toBeNull();
  });

  it('多命中 → 抛错(短id应唯一,防御性检查)', async () => {
    const fakeQuery = async () => ({ rows: [{ id: 'a' }, { id: 'b' }] });
    await expect(resolveFeatureId(fakeQuery, 'dup')).rejects.toThrow(/多条/);
  });
});
