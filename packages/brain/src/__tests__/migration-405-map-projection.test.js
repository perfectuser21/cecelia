import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const upSql = readFileSync(
  new URL('../../migrations/405_map_projection_core.sql', import.meta.url),
  'utf8',
);
const downSql = readFileSync(
  new URL('../../migrations/rollback/405_map_projection_core.down.sql', import.meta.url),
  'utf8',
);

describe('migration 405 — rebuildable map projection core', () => {
  it('建立 run、node、edge 三张派生表', () => {
    expect(upSql).toMatch(/CREATE TABLE IF NOT EXISTS map_projection_runs/i);
    expect(upSql).toMatch(/CREATE TABLE IF NOT EXISTS map_projection_nodes/i);
    expect(upSql).toMatch(/CREATE TABLE IF NOT EXISTS map_projection_edges/i);
  });

  it('run 固定 manifest/fact/projector/digest provenance 与单 active 约束', () => {
    expect(upSql).toMatch(/manifest_version_id UUID NOT NULL REFERENCES map_manifest_versions\s*\(id\)/i);
    expect(upSql).toMatch(/manifest_digest TEXT NOT NULL CHECK \(manifest_digest ~ '\^\[0-9a-f\]\{64\}\$'\)/i);
    expect(upSql).toMatch(/fact_revisions JSONB NOT NULL/i);
    expect(upSql).toMatch(/projector_version TEXT NOT NULL/i);
    expect(upSql).toMatch(/projection_digest TEXT NOT NULL CHECK \(projection_digest ~ '\^\[0-9a-f\]\{64\}\$'\)/i);
    expect(upSql).toMatch(/CHECK \(status IN \('building', 'active', 'superseded', 'failed'\)\)/i);
    expect(upSql).toMatch(/CREATE UNIQUE INDEX[\s\S]*ON map_projection_runs\s*\(scope_key\)[\s\S]*WHERE status = 'active'/i);
  });

  it('node/edge 使用 stable id、受限类型与 run-scoped 引用', () => {
    expect(upSql).toMatch(/PRIMARY KEY \(run_id, node_id\)/i);
    expect(upSql).toMatch(/PRIMARY KEY \(run_id, edge_id\)/i);
    expect(upSql).toMatch(/node_id TEXT NOT NULL CHECK \(node_id ~ '\^\[0-9a-f\]\{64\}\$'\)/i);
    expect(upSql).toMatch(/edge_id TEXT NOT NULL CHECK \(edge_id ~ '\^\[0-9a-f\]\{64\}\$'\)/i);
    for (const nodeType of [
      'value_stream', 'capability', 'crosscut', 'prerequisite',
      'backbone', 'feature', 'artifact', 'assertion',
    ]) {
      expect(upSql).toContain(`'${nodeType}'`);
    }
    for (const edgeType of [
      'contains', 'hands_off_to', 'serves', 'requires', 'precedes',
      'implements', 'proves', 'affects', 'owned_by',
    ]) {
      expect(upSql).toContain(`'${edgeType}'`);
    }
    expect(upSql.match(/FOREIGN KEY \(run_id, (?:from|to)_node_id\)[\s\S]*?REFERENCES map_projection_nodes \(run_id, node_id\)/gi)).toHaveLength(2);
  });

  it('rollback 按依赖逆序移除三表并撤销 schema marker', () => {
    expect(downSql.indexOf('map_projection_edges')).toBeLessThan(downSql.indexOf('map_projection_nodes'));
    expect(downSql.indexOf('map_projection_nodes')).toBeLessThan(downSql.indexOf('map_projection_runs'));
    expect(downSql).toMatch(/DELETE FROM schema_version WHERE version = '405'/i);
  });

  it('登记 schema 405', () => {
    expect(upSql).toMatch(/VALUES\s*\(\s*'405'/i);
  });
});
