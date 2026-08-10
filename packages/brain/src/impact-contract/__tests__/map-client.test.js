/**
 * map-client (MJ5 stub) 测试
 * stub 响应格式验证 — 真实 Mapper 接入后替换为集成测试
 *
 * MJ5 STUB: replace with real Mapper call after MJ5 contract passes
 * sprint: 08110022-relay-d96c9fa0 ws3
 */
import { describe, test, expect } from 'vitest';
import { queryImpactRadius, callMapper } from '../map-client.js';

describe('map-client (MJ5 stub)', () => {
  test('queryImpactRadius 返回 fresh stub 响应', async () => {
    const result = await queryImpactRadius({ repo: 'cecelia', baseRevision: 'abc123' });
    expect(result).toBeDefined();
    expect(result.freshness).toBeDefined();
    expect(result.freshness.status).toBe('fresh');
  });

  test('stub 响应包含 affected_nodes 数组', async () => {
    const result = await queryImpactRadius({ repo: 'cecelia', baseRevision: 'abc123' });
    expect(Array.isArray(result.affected_nodes)).toBe(true);
  });

  test('stub 响应包含 required_assertions 数组', async () => {
    const result = await queryImpactRadius({ repo: 'cecelia', baseRevision: 'abc123' });
    expect(Array.isArray(result.required_assertions)).toBe(true);
  });

  test('callMapper 是 queryImpactRadius 的别名', async () => {
    const r1 = await queryImpactRadius({ repo: 'cecelia', baseRevision: 'abc' });
    const r2 = await callMapper({ repo: 'cecelia', baseRevision: 'abc' });
    expect(r1.freshness.status).toBe(r2.freshness.status);
  });
});
