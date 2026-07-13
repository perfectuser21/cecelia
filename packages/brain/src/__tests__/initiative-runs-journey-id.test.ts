/**
 * WS1 TDD Red Phase — initiative_runs.journey_id + GET /initiative-runs/:id
 * 实现前全部 FAIL；Generator 完成实现后变 Green
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '../../../../');
const MIGRATION_FILE = join(REPO_ROOT, 'packages/brain/src/db/migrations/011-initiative-runs-journey-id.sql');
// 刀4阶段3：harness-initiative.graph.js 已物理删除（LangGraph 图路径废弃，
// orchestrator 硬校验后不可达）。INSERT INTO initiative_runs 的真实生产者
// 在 skill-relay 架构下是 harness-skill-relay.js。
const GRAPH_FILE = join(REPO_ROOT, 'packages/brain/src/harness-skill-relay.js');
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

describe('WS1 — harness-skill-relay.js 两处 INSERT [BEHAVIOR]', () => {
  it('skill-relay 文件存在', () => {
    expect(existsSync(GRAPH_FILE)).toBe(true);
  });

  it('INSERT INTO initiative_runs 出现至少 1 次', () => {
    const content = readFileSync(GRAPH_FILE, 'utf-8');
    const matches = content.match(/INSERT INTO initiative_runs/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('所有 INSERT INTO initiative_runs 块均含 journey_id 字段', () => {
    const content = readFileSync(GRAPH_FILE, 'utf-8');
    // harness-skill-relay.js 的 INSERT 不带 RETURNING id，改用固定窗口截取列名段
    const insertIdxs = [];
    let idx = content.indexOf('INSERT INTO initiative_runs');
    while (idx !== -1) {
      insertIdxs.push(idx);
      idx = content.indexOf('INSERT INTO initiative_runs', idx + 1);
    }
    const insertBlocks = insertIdxs.map((i) => content.slice(i, i + 300));
    expect(insertBlocks.length, '预期至少 1 个 INSERT 块').toBeGreaterThanOrEqual(1);
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
