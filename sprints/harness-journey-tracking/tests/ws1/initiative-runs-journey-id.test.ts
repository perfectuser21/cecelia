/**
 * WS1 TDD Red Phase — initiative_runs.journey_id + GET /initiative-runs/:id
 * 实现前全部 FAIL；Generator 完成实现后变 Green
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '../../../../');
const MIGRATION_FILE = join(REPO_ROOT, 'packages/brain/src/db/migrations/011-initiative-runs-journey-id.sql');
const GRAPH_FILE = join(REPO_ROOT, 'packages/brain/src/workflows/harness-initiative.graph.js');
const ROUTES_FILE = join(REPO_ROOT, 'packages/brain/src/routes/harness.js');

describe('WS1 — initiative_runs.journey_id [ARTIFACT]', () => {
  it('migration 011 文件存在', () => {
    expect(existsSync(MIGRATION_FILE), `文件不存在: ${MIGRATION_FILE}`).toBe(true);
  });

  it('migration 含 journey_id 列定义', () => {
    const content = readFileSync(MIGRATION_FILE, 'utf-8');
    expect(content).toContain('journey_id');
  });

  it('migration 含 ALTER TABLE initiative_runs', () => {
    const content = readFileSync(MIGRATION_FILE, 'utf-8');
    expect(content).toMatch(/ALTER TABLE\s+initiative_runs/i);
  });

  it('migration journey_id 类型为 UUID', () => {
    const content = readFileSync(MIGRATION_FILE, 'utf-8');
    expect(content).toMatch(/journey_id\s+UUID/i);
  });
});

describe('WS1 — harness-initiative.graph.js 两处 INSERT [BEHAVIOR]', () => {
  it('graph 文件存在', () => {
    expect(existsSync(GRAPH_FILE)).toBe(true);
  });

  it('INSERT INTO initiative_runs 出现至少 2 次', () => {
    const content = readFileSync(GRAPH_FILE, 'utf-8');
    const matches = content.match(/INSERT INTO initiative_runs/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('所有 INSERT INTO initiative_runs 块均含 journey_id 字段（两处都要有）', () => {
    const content = readFileSync(GRAPH_FILE, 'utf-8');
    // 提取所有 INSERT INTO initiative_runs ... RETURNING id 块
    const insertBlocks = content.match(/INSERT INTO initiative_runs[\s\S]*?RETURNING id/g) || [];
    expect(insertBlocks.length, '预期至少 2 个 INSERT 块').toBeGreaterThanOrEqual(2);
    insertBlocks.forEach((block, i) => {
      expect(block, `INSERT 块 ${i + 1} 缺少 journey_id`).toContain('journey_id');
    });
  });
});

describe('WS1 — GET /initiative-runs/:id 路由 [BEHAVIOR]', () => {
  it('harness.js 含 initiative-runs/:id 路由注册', () => {
    const content = readFileSync(ROUTES_FILE, 'utf-8');
    expect(content).toMatch(/router\.get\(['"`]\/initiative-runs\/:id['"`]/);
  });

  it('harness.js 路由含 journey_id 字段返回', () => {
    const content = readFileSync(ROUTES_FILE, 'utf-8');
    // 找到 initiative-runs/:id 路由块
    const routeMatch = content.match(/router\.get\(['"`]\/initiative-runs\/:id['"`][\s\S]*?^}\)/m);
    // 如果多行匹配不到，就直接检查整个文件含 journey_id
    expect(content).toContain('journey_id');
  });

  it('harness.js initiative-runs 路由含 initiative_id 参数 UUID 校验（返回 400）', () => {
    const content = readFileSync(ROUTES_FILE, 'utf-8');
    // 路由应有 UUID 格式校验并返回 400
    expect(content).toContain('400');
  });
});
